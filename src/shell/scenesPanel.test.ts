// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SceneStatus } from "../scenes/loadScene";
import type { SceneController, SceneControllerState } from "../scenes/sceneController";
import { createSceneHud } from "./scenesPanel";

afterEach(() => document.body.replaceChildren());

function mount() {
  const slot = document.createElement("span");
  const mapSource = document.createElement("span");
  slot.append(mapSource);
  document.body.append(slot);
  let listener: (state: SceneControllerState) => void = () => {};
  const exit = vi.fn(async () => ({ ok: true as const }));
  const controller = {
    subscribe(next: (state: SceneControllerState) => void) { listener = next; next({ loading: null, errors: [], status: null }); return () => {}; },
    handle: () => ({ exit }),
  } as unknown as SceneController;
  const hud = createSceneHud({ controller, container: slot, mapSource });
  const show = (phase: SceneStatus["phase"], credits: SceneStatus["credits"] = []) =>
    listener({ loading: null, errors: [], status: { phase, credits } as SceneStatus });
  return { slot, mapSource, hud, exit, show };
}

const CREDIT = { assetId: "a", text: "Greg Zaal", license: "CC0", url: "https://polyhaven.com/a/buikslotermeerplein" };

describe("the panorama's end of the HUD bar", () => {
  it("replaces the map's group with a close button and the panorama's credit while entered", () => {
    const { slot, mapSource, hud, exit, show } = mount();
    expect(hud.element.hidden).toBe(true);
    expect(slot.firstElementChild).toBe(hud.element);

    show("immersive", [CREDIT]);
    expect(hud.element.hidden).toBe(false);
    expect(mapSource.hidden).toBe(true);
    const [close, credits] = Array.from(hud.element.children) as HTMLElement[];
    expect(close.id).toBe("sceneExitButton");
    expect(close.getAttribute("aria-label")).toBe("Exit panorama");
    const credit = credits.querySelector<HTMLAnchorElement>("a.scene-credit-chip")!;
    expect(credit.textContent).toBe("Greg Zaal · CC0");
    expect(credit.href).toBe(CREDIT.url);
    expect(credit.rel).toBe("noopener noreferrer");
    expect(credit.querySelector("svg.foss-earth-external-link-icon")).not.toBeNull();
    close.click();
    expect(exit).toHaveBeenCalledTimes(1);

    show("overview", [CREDIT]);
    expect(hud.element.hidden).toBe(true);
    expect(mapSource.hidden).toBe(false);
  });

  it("offers Cancel before the map's group while a panorama is prepared or entered, when the map still shows", () => {
    const { mapSource, hud, show } = mount();
    show("entering", [CREDIT]);
    expect(hud.element.hidden).toBe(false);
    expect(mapSource.hidden).toBe(false);
    expect(hud.element.querySelector("#sceneExitButton")!.getAttribute("aria-label")).toBe("Cancel entering the panorama");
    expect(hud.element.querySelector<HTMLElement>("#sceneCreditsSlot")!.hidden).toBe(true);
    hud.destroy();
    expect(hud.element.isConnected).toBe(false);
    expect(mapSource.hidden).toBe(false);
  });
});
