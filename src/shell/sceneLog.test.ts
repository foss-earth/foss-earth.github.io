// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameLogEntry } from "../log/createGameLog";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import type { SceneFailure, SceneRuntime } from "../scenes/loadScene";
import { createSceneController, type SceneController, type SceneControllerState } from "../scenes/sceneController";
import { connectSceneLog } from "./sceneLog";

afterEach(() => { vi.unstubAllGlobals(); });

function fakeLog() {
  const lines: { text: string; tone: GameLogEntry["tone"]; removed: boolean }[] = [];
  return {
    shown: () => lines.filter(line => !line.removed).map(line => [line.tone, line.text]),
    print(entry: GameLogEntry) {
      const line = { text: entry.text, tone: entry.tone, removed: false };
      lines.push(line);
      return { update() {}, focusAction() {}, remove() { line.removed = true; } };
    },
  };
}

function fakeController() {
  let state: (state: SceneControllerState) => void = () => {};
  let failure: (failure: SceneFailure) => void = () => {};
  const controller = {
    subscribe(listener: typeof state) { state = listener; listener({ loading: null, errors: [], status: null }); return () => {}; },
    onFailure(listener: typeof failure) { failure = listener; return () => {}; },
  } as unknown as SceneController;
  return { controller, loading: (url: string | null) => state({ loading: url, errors: [], status: null }), fail: (next: SceneFailure) => failure(next) };
}

const preview = (id: string, title: string): SceneFailure => ({
  kind: "preview", panorama: { id, title }, cause: "Failed to fetch",
  message: `${title}: its preview could not be loaded: Failed to fetch.`,
});

describe("the scene log", () => {
  it("prints each failure as an error, and counts the panoramas whose previews failed on one line", () => {
    const log = fakeLog();
    const { controller, loading, fail } = fakeController();
    connectSceneLog(controller, log);
    fail({ kind: "image", panorama: { id: "mall", title: "Mall" }, cause: "x", message: "Mall: the 6144 px image could not be loaded." });
    fail(preview("mall", "Mall"));
    fail(preview("walter", "Walter"));
    fail(preview("mall", "Mall"));
    expect(log.shown()).toEqual([
      ["error", "Mall: the 6144 px image could not be loaded."],
      ["error", "The previews of 2 panoramas could not be loaded. The latest, Mall: its preview could not be loaded: Failed to fetch."],
    ]);
    // Another scene counts afresh, and the last scene's line stays.
    loading("https://foss-earth.test/other.scene.json");
    loading(null);
    fail(preview("dome", "Dome"));
    expect(log.shown().slice(1)).toEqual([
      ["error", "The previews of 2 panoramas could not be loaded. The latest, Mall: its preview could not be loaded: Failed to fetch."],
      ["error", "Dome: its preview could not be loaded: Failed to fetch."],
    ]);
  });

  it("prints a scene file that could not be fetched, naming its URL once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    const controller = createSceneController({
      runtime: {} as SceneRuntime, settings, canvas: document.createElement("canvas"), examples: [], baseUrl: "https://foss-earth.test/",
    });
    const log = fakeLog();
    const off = connectSceneLog(controller, log);
    expect(await controller.load("tour/scene.json")).toBe(false);
    expect(log.shown()).toEqual([["error", "The scene could not be loaded: https://foss-earth.test/tour/scene.json could not be fetched: Failed to fetch."]]);
    off();
    controller.destroy();
  });
});
