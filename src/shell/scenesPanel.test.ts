// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOSS_EARTH_PARAMETERS, FOSS_EARTH_SECTION_TITLES } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import type { SceneEntryStatus, SceneStatus } from "../scenes/loadScene";
import type { SceneController, SceneControllerState } from "../scenes/sceneController";
import { createSceneHud, createScenesPanel } from "./scenesPanel";

afterEach(() => document.body.replaceChildren());

function mount() {
  const slot = document.createElement("span");
  const mapSource = document.createElement("span");
  slot.append(mapSource);
  document.body.append(slot);
  let listener: (state: SceneControllerState) => void = () => {};
  const controller = {
    subscribe(next: (state: SceneControllerState) => void) { listener = next; next({ loading: null, errors: [], status: null }); return () => {}; },
  } as unknown as SceneController;
  const position = document.createElement("button");
  document.body.append(position);
  const hud = createSceneHud({ controller, container: slot, mapSource, mapOnly: [position] });
  const show = (phase: SceneStatus["phase"], credits: SceneStatus["credits"] = []) =>
    listener({ loading: null, errors: [], status: { phase, credits } as SceneStatus });
  return { slot, mapSource, position, hud, show };
}

const CREDIT = { assetId: "a", text: "Greg Zaal", license: "CC0", url: "https://polyhaven.com/a/buikslotermeerplein" };

describe("scene content while previews arrive", () => {
  it("distinguishes queued downloads, shows ready counts and keeps expanded details and keyboard focus", () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    for (const [tab, section, title] of FOSS_EARTH_SECTION_TITLES) settings.setSectionTitle(tab, section, title);
    let listener: (state: SceneControllerState) => void = () => {};
    const enter = vi.fn();
    const controller = {
      examples: [],
      subscribe(next: typeof listener) { listener = next; next({ loading: null, errors: [], status: null }); return () => {}; },
      handle: () => ({ enter }),
    } as unknown as SceneController;
    const panel = createScenesPanel({ settings, controller });
    document.body.append(panel.element);
    const entry = (id: string, preview: SceneEntryStatus["preview"]): SceneEntryStatus => ({
      id, title: id, supported: true, preview, placement: "placed", previewDetail: null, description: null, message: null,
      marker: { mode: "ground-relative", offsetM: 3, eastM: 0, northM: 0, radiusMeters: 2, authoredRadius: false },
      capture: { latitudeDeg: 45, longitudeDeg: -93, heightMeters: null, horizontalAccuracyMeters: null },
      pose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, aligned: false }, attribution: null, images: [], links: [],
    });
    const show = (first: SceneEntryStatus["preview"], second: SceneEntryStatus["preview"]) => listener({
      loading: null, errors: [], status: {
        title: "Campus", sceneId: "campus", revision: "one", generation: 1, phase: "overview", renderingAvailable: true,
        active: null, target: null, overview: "applied", entries: [entry("Library", first), entry("Mall", second)],
        warnings: [], groups: [], credits: [], lastError: null,
      } as unknown as SceneStatus,
    });
    show("loading", "idle");
    expect(panel.element.textContent).toContain("0 of 2 panorama previews ready");
    expect([...panel.element.querySelectorAll(".foss-earth-scene-entry__state")].map(each => each.textContent)).toEqual(["Loading preview", "Preview queued"]);
    const details = panel.element.querySelector<HTMLDetailsElement>('details[data-panorama="Library"]')!;
    details.open = true;
    details.querySelector<HTMLButtonElement>("button")!.focus();
    show("ready", "loading");
    expect(panel.element.textContent).toContain("1 of 2 panorama previews ready");
    expect(panel.element.querySelector<HTMLDetailsElement>('details[data-panorama="Library"]')!.open).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.panorama).toBe("Library");
    (document.activeElement as HTMLButtonElement).click();
    expect(enter).toHaveBeenCalledWith("Library");
    panel.destroy();
  });
});

describe("the panorama's end of the HUD bar", () => {
  it("replaces the map's group with the panorama's credit while entered, with no close button", () => {
    const { slot, mapSource, position, hud, show } = mount();
    expect(hud.element.hidden).toBe(true);
    expect(slot.firstElementChild).toBe(hud.element);

    show("immersive", [CREDIT]);
    expect(hud.element.hidden).toBe(false);
    expect(mapSource.hidden).toBe(true);
    expect(position.hidden).toBe(true);
    expect(hud.element.querySelector("button")).toBeNull();
    const credit = hud.element.querySelector<HTMLAnchorElement>("#sceneCreditsSlot a.scene-credit-chip")!;
    expect(credit.textContent).toBe("Greg Zaal · CC0");
    expect(credit.href).toBe(CREDIT.url);
    expect(credit.rel).toBe("noopener noreferrer");
    expect(credit.querySelector("svg.foss-earth-external-link-icon")).not.toBeNull();

    show("overview", [CREDIT]);
    expect(hud.element.hidden).toBe(true);
    expect(mapSource.hidden).toBe(false);
    expect(position.hidden).toBe(false);
  });

  it("leaves the map's group alone while a panorama is prepared or entered, when the map still shows", () => {
    const { mapSource, hud, show } = mount();
    show("entering", [CREDIT]);
    expect(hud.element.hidden).toBe(true);
    expect(mapSource.hidden).toBe(false);
    hud.destroy();
    expect(hud.element.isConnected).toBe(false);
    expect(mapSource.hidden).toBe(false);
  });
});
