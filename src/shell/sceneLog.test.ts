// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameLog, GAME_LOG_FADE_MS, type GameLogEntry } from "../log/createGameLog";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import type { SceneEntryStatus, SceneFailure, SceneProgress, SceneRuntime, SceneStatus } from "../scenes/loadScene";
import { createSceneController, type SceneController, type SceneControllerState } from "../scenes/sceneController";
import { connectSceneLog } from "./sceneLog";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fakeLog() {
  const lines: (GameLogEntry & { removed: boolean; updates: number })[] = [];
  return {
    entries: () => lines.filter(line => !line.removed),
    shown: () => lines.filter(line => !line.removed).map(line => [line.tone, line.text]),
    print(entry: GameLogEntry) {
      const line = { ...entry, removed: false, updates: 0 };
      lines.push(line);
      return { update(next: GameLogEntry) { Object.assign(line, { progress: undefined, actions: undefined }, next); line.updates++; }, focusAction() {}, remove() { line.removed = true; } };
    },
  };
}

function fakeController() {
  let state: (state: SceneControllerState) => void = () => {};
  let failure: (failure: SceneFailure) => void = () => {};
  let progress: (progress: SceneProgress) => void = () => {};
  const controller = {
    subscribe(listener: typeof state) { state = listener; listener({ loading: null, errors: [], status: null }); return () => {}; },
    onFailure(listener: typeof failure) { failure = listener; return () => {}; },
    onProgress(listener: typeof progress) { progress = listener; return () => {}; },
  } as unknown as SceneController;
  return {
    controller,
    loading: (url: string | null) => state({ loading: url, errors: [], status: null }),
    show: (status: SceneStatus | null, loading: string | null = null) => state({ loading, errors: [], status }),
    fail: (next: SceneFailure) => failure(next),
    progress: (next: SceneProgress) => progress(next),
  };
}

function status(states: SceneEntryStatus["preview"][]): SceneStatus {
  return {
    phase: "overview", sceneId: "campus", generation: 1, title: "Campus", renderingAvailable: true,
    entries: states.map((preview, i) => ({ id: `p${i}`, title: `Place ${i}`, supported: true, preview })),
  } as SceneStatus;
}

const download: SceneProgress = { id: "p0/preview", kind: "preview", title: "Place 0", receivedBytes: 512, totalBytes: 1024, state: "loading" };

const preview = (id: string, title: string): SceneFailure => ({
  kind: "preview", panorama: { id, title }, cause: "Failed to fetch",
  message: `${title}: its preview could not be loaded: Failed to fetch.`,
});

describe("the scene log", () => {
  it("reports an unavailable panorama renderer once, without requiring the Scenes tab", () => {
    const log = fakeLog();
    const { controller, show } = fakeController();
    connectSceneLog(controller, log);
    const unavailable = { ...status(["failed"]), renderingAvailable: false, unavailableReason: "Panoramas need WebGPU." };
    show(unavailable);
    show(unavailable);
    expect(log.shown()).toEqual([["error", "Campus: Panoramas need WebGPU."]]);
  });

  it("updates one preview bar as independent downloads arrive, then lets it finish", () => {
    const log = fakeLog();
    const { controller, show, progress } = fakeController();
    connectSceneLog(controller, log);
    show(status(["loading", "idle"]));
    progress(download);
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({ tone: "progress", progress: 0 });
    expect(log.entries()[0].text).toContain("0 of 2 panorama previews ready · 1 loading (512 B / 1.0 KiB)");
    progress({ ...download, receivedBytes: 1024, state: "ready" });
    show(status(["ready", "loading"]));
    expect(log.entries()[0]).toMatchObject({ progress: 0.5 });
    // Refining an already-visible orb does not count as another ready orb.
    progress({ ...download, id: "p0/sharper", receivedBytes: 1024 });
    expect(log.entries()[0]).toMatchObject({ progress: 0.5 });
    show(status(["ready", "ready"]));
    expect(log.entries()[0]).toMatchObject({ tone: "success", progress: 1 });
    const updates = log.entries()[0].updates;
    progress({ ...download, id: "p0/sharper", receivedBytes: 1024, state: "ready" });
    show(status(["ready", "ready"]));
    expect(log.entries()[0].updates).toBe(updates);
    expect(log.entries()).toHaveLength(1);
  });

  it("keeps unknown byte totals indeterminate and removes cancelled image bars", () => {
    const log = fakeLog();
    const { controller, progress } = fakeController();
    const off = connectSceneLog(controller, log);
    const image = { ...download, kind: "image" as const, totalBytes: null };
    progress(image);
    expect(log.entries()[0]).toMatchObject({ tone: "progress", progress: null });
    expect(log.entries()[0].text).toContain("512 B received");
    progress({ ...image, state: "cancelled" });
    expect(log.entries()).toHaveLength(0);
    progress(image);
    off();
    expect(log.entries()).toHaveLength(0);
  });

  it("removes completed images after the configured duration even in open history while other panoramas keep downloading", () => {
    vi.useFakeTimers();
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    settings.set("interface.log.lineDuration", 2);
    const log = createGameLog(settings);
    log.setOpen(true);
    const { controller, show, progress } = fakeController();
    const off = connectSceneLog(controller, log);
    const rows = () => [...log.element.querySelectorAll<HTMLElement>(".game-log__line")];
    const readyRows = () => rows().filter(row => row.dataset.tone === "success");
    const image = { ...download, kind: "image" as const, id: "p0/image" };
    try {
      show(status(["loading", "idle"]));
      progress(image);
      vi.advanceTimersByTime(2000 + GAME_LOG_FADE_MS);
      expect(rows().every(row => !row.hasAttribute("data-expired"))).toBe(true);

      progress({ ...image, receivedBytes: 1024, state: "ready" });
      vi.advanceTimersByTime(1000);
      progress({ ...image, id: "p1/image", title: "Place 1" });
      progress(download);
      vi.advanceTimersByTime(1000);
      expect(readyRows()[0].hasAttribute("data-fading")).toBe(true);
      progress({ ...image, id: "p1/image", title: "Place 1", receivedBytes: 768 });
      progress({ ...download, receivedBytes: 768 });
      vi.advanceTimersByTime(GAME_LOG_FADE_MS);
      expect(readyRows()).toHaveLength(0);
      expect(rows()).toHaveLength(2);

      progress({ ...image, id: "p1/image", title: "Place 1", receivedBytes: 1024, state: "ready" });
      vi.advanceTimersByTime(1000);
      // Repeated completion and camera status events do not renew finished lines.
      progress({ ...image, id: "p1/image", title: "Place 1", receivedBytes: 1024, state: "ready" });
      show(status(["loading", "idle"]));
      vi.advanceTimersByTime(1000 + GAME_LOG_FADE_MS);
      expect(readyRows()).toHaveLength(0);
      expect(rows()).toHaveLength(1);

      show(status(["ready", "ready"]));
      vi.advanceTimersByTime(1000);
      show(status(["ready", "ready"]));
      vi.advanceTimersByTime(1000 + GAME_LOG_FADE_MS);
      // The scene's preview summary remains available in history.
      expect(rows()).toHaveLength(1);
      expect(rows()[0].hasAttribute("data-expired")).toBe(true);
      expect(rows()[0].textContent).toContain("2 of 2 panorama previews ready");
      expect(log.isOpen()).toBe(true);
    } finally {
      off();
      log.destroy();
    }
  });

  it("finishes metadata only once the scene is mounted, with a byte bar while it arrives", () => {
    const log = fakeLog();
    const { controller, loading, show, progress } = fakeController();
    connectSceneLog(controller, log);
    loading("https://example.test/scene.json");
    progress({ ...download, kind: "manifest", title: "https://example.test/scene.json" });
    expect(log.entries()[0]).toMatchObject({ tone: "progress", progress: 0.5 });
    progress({ ...download, kind: "manifest", state: "ready" });
    expect(log.entries()[0].tone).toBe("progress");
    show(status(["idle", "idle"]));
    expect(log.entries()[0]).toMatchObject({ tone: "success", text: "Campus: 2 panorama locations loaded." });
  });

  it("completes with a warning for failed previews and removes unfinished bars on unload", () => {
    const log = fakeLog();
    const { controller, show } = fakeController();
    connectSceneLog(controller, log);
    show(status(["ready", "failed"]));
    expect(log.entries()[0]).toMatchObject({ tone: "warning", progress: 1 });
    expect(log.entries()[0].text).toContain("1 of 2 panorama previews ready; 1 unavailable");
    show({ ...status(["loading", "idle"]), generation: 2 });
    expect(log.entries()).toHaveLength(2);
    show(null);
    expect(log.entries()).toHaveLength(1);
  });

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

  it("aborts superseded manifests and keeps their late progress out of the current log", async () => {
    const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    const signals = new Map<string, AbortSignal>();
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      signals.set(url.pathname, init.signal!);
      return new Response(new ReadableStream<Uint8Array>({ start(stream) { streams.set(url.pathname, stream); } }));
    }));
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    const heard: SceneProgress[] = [];
    const controller = createSceneController({
      runtime: {} as SceneRuntime, settings, canvas: document.createElement("canvas"), examples: [], baseUrl: "https://foss-earth.test/",
      loadOptions: { onProgress: progress => heard.push(progress) },
    });
    const log = fakeLog();
    const off = connectSceneLog(controller, log);
    const first = controller.load("first.json");
    const second = controller.load("second.json");
    expect(signals.get("/first.json")!.aborted).toBe(true);
    streams.get("/first.json")!.enqueue(new TextEncoder().encode("{}"));
    streams.get("/first.json")!.close();
    expect(await first).toBe(false);
    expect(heard.filter(progress => progress.title.endsWith("first.json"))).toHaveLength(1);
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0].text).toContain("second.json");
    streams.get("/second.json")!.enqueue(new TextEncoder().encode("{}"));
    streams.get("/second.json")!.close();
    expect(await second).toBe(false);
    expect(log.entries().some(line => line.tone === "progress" || line.tone === "success")).toBe(false);
    expect(log.entries().some(line => line.tone === "error")).toBe(true);
    off();
    controller.destroy();
  });
});
