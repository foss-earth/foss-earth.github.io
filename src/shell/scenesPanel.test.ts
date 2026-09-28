// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
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
