// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fakeBrowser } from "../diagnostics/testEnvironment";
import { createSessionTrail } from "../diagnostics/sessionTrail";
import type { GameLog, GameLogEntry } from "../log/createGameLog";
import type { SceneControllerState } from "../scenes/sceneController";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import { startAppDiagnostics, TRAIL_KEPT, type DiagnosedRuntime } from "./appDiagnostics";

/** A log that keeps what was printed, newest last, each line as it now reads. */
function fakeLog() {
  const lines: GameLogEntry[] = [];
  const log: GameLog = {
    element: document.createElement("div"),
    print(entry) {
      const at = lines.push(entry) - 1;
      return { update: next => { lines[at] = next; }, focusAction: () => {}, remove: () => {} };
    },
    setBusy: () => {}, setOpen: () => {}, isOpen: () => false, minimize: () => {}, isMinimized: () => false, destroy: () => {},
  };
  return { log, lines };
}

function fakeTarget() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    addEventListener: (type: string, listener: (event: Event) => void) => { listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)); },
    removeEventListener: (type: string, listener: (event: Event) => void) => { listeners.get(type)?.delete(listener); },
    fire: (type: string, detail: object = {}) => { for (const listener of [...(listeners.get(type) ?? [])]) listener(detail as Event); },
  };
}

function start(browser = fakeBrowser(), name = "a") {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(FOSS_EARTH_PARAMETERS);
  const { log, lines } = fakeLog();
  const page = fakeTarget();
  const written: string[] = [];
  const fakeConsole = { warn: (...values: unknown[]) => { written.push(values.join(" ")); }, error: (...values: unknown[]) => { written.push(values.join(" ")); } };
  const environment = browser.page(name);
  const diagnostics = startAppDiagnostics({
    log, settings, identity: { build: "2026-10-04T15:00:00.000Z", source: "1a2b3c4d", fossEarth: "9f8e7d6c5b4a", bundle: "twinCities-C9TYTT-e.js" },
    trailEnvironment: environment, page: page as unknown as Window, console: fakeConsole,
  });
  const texts = (): string[] => diagnostics.trail.steps().map(step => `${step.text}${step.count ? ` ×${step.count}` : ""}`);
  /** The log's lines after the first, which says which version of the app this is. */
  const said = (): GameLogEntry[] => lines.slice(1);
  return { diagnostics, settings, lines, said, page, fakeConsole, written, environment, browser, texts };
}

/** What the app says of itself as it opens, and what its trail's record says in full. */
const WHO = "App built 2026-10-04 15:00 UTC from 1a2b3c4 with FOSS Earth 9f8e7d6";
const WHO_IN_FULL = "App built 2026-10-04T15:00:00.000Z from 1a2b3c4d with FOSS Earth 9f8e7d6c5b4a, bundle twinCities-C9TYTT-e.js";

function fakeRuntime(over: Partial<DiagnosedRuntime["renderer"]> = {}) {
  const lost = new Set<() => void>();
  const restored = new Set<() => void>();
  const runtime: DiagnosedRuntime = {
    renderer: { requested: "auto", mode: "webgpu", engine: { getInfo: () => ({ vendor: "apple", renderer: "metal-3", version: "" }) }, ...over },
    onDeviceLost: listener => { lost.add(listener); return () => lost.delete(listener); },
    onDeviceRestored: listener => { restored.add(listener); return () => restored.delete(listener); },
  };
  return { runtime, lose: () => lost.forEach(listener => listener()), restore: () => restored.forEach(listener => listener()) };
}

const sceneState = (active: string | null, revision = "r1"): SceneControllerState => ({
  loading: null, errors: [],
  status: { sceneId: "tour", revision, entries: [{}, {}, {}], active, phase: active ? "immersive" : "overview", warnings: [], lastError: null } as unknown as SceneControllerState["status"],
});

describe("the app's diagnostics", () => {
  it("says which version of the app runs as it opens, in the log and the trail", () => {
    const { lines, texts } = start();
    expect(lines).toEqual([{ text: `${WHO}.` }]);
    expect(texts()).toEqual(["Opened http://localhost:3000/", `› ${WHO}.`]);
  });

  it("makes a step of the page, the renderer, each log line and the end of a download, not of its progress", () => {
    const { diagnostics, said, texts } = start();
    diagnostics.attachRuntime(fakeRuntime().runtime);
    const line = diagnostics.log.print({ text: "Loading the tour", tone: "progress", progress: 0.1 });
    line.update({ text: "Loading the tour: 30 of 60", tone: "progress", progress: 0.5 });
    line.update({ text: "The tour: 60 of 60 panorama previews", tone: "success" });
    diagnostics.log.print({ text: "Google 3D tiles could not be loaded", tone: "warning" });
    expect(texts()).toEqual([
      "Opened http://localhost:3000/",
      `› ${WHO}.`,
      "Renderer webgpu (asked for auto); apple, metal-3",
      "› Loading the tour",
      "✓ The tour: 60 of 60 panorama previews",
      "! Google 3D tiles could not be loaded",
    ]);
    // The log shows what it was given.
    expect(said().map(entry => entry.text)).toEqual(["The tour: 60 of 60 panorama previews", "Google 3D tiles could not be loaded"]);
  });

  it("prints an error nothing handled once, counts it when it comes again, and keeps console warnings out of the log", () => {
    const { diagnostics, said, page, fakeConsole, written, texts } = start();
    for (let turn = 0; turn < 5; turn++) page.fire("error", { message: "Uncaught TypeError: x is not a function", filename: "https://tour.test/assets/app-1a2b3c4d.js", lineno: 1, colno: 2, error: new TypeError("x is not a function") });
    expect(said()).toEqual([{ text: "The app met an error it did not handle, 4 times: TypeError: x is not a function (app-1a2b3c4d.js:1:2). Settings → Diagnostics has a report to copy.", tone: "error" }]);
    fakeConsole.warn("WebGPU uncaptured error (1): shader refused");
    expect(written).toEqual(["WebGPU uncaptured error (1): shader refused"]);
    expect(said()).toHaveLength(1);
    expect(texts().slice(2)).toEqual(["Unhandled error: TypeError: x is not a function at app-1a2b3c4d.js:1:2 ×5", "console.warn: WebGPU uncaptured error (1): shader refused"]);
    diagnostics.destroy();
    fakeConsole.warn("after");
    expect(texts()).toHaveLength(4);
  });

  it("says in the log when the GPU's device is lost and when it is back", () => {
    const { diagnostics, said } = start();
    const gpu = fakeRuntime({ requested: "webgpu", mode: "webgl2", fallbackReason: "WebGPU is not available" });
    diagnostics.attachRuntime(gpu.runtime);
    expect(diagnostics.trail.steps().at(-1)?.text).toBe("Renderer webgl2 (asked for webgpu); fell back: WebGPU is not available; apple, metal-3");
    gpu.lose();
    gpu.restore();
    expect(said().map(entry => [entry.tone, entry.text.split(":")[0].split(".")[0]])).toEqual([["warning", "The GPU stopped drawing for this page"], ["success", "The GPU is drawing for this page again"]]);
  });

  it("makes a step of the scene, of each 360 image entered and of coming back to the map", () => {
    const { diagnostics, texts } = start();
    diagnostics.sceneChanged({ loading: "https://tour.test/scene.json", errors: [], status: null });
    diagnostics.sceneChanged(sceneState(null));
    diagnostics.sceneChanged(sceneState(null));
    diagnostics.sceneChanged(sceneState("northrop-mall"));
    diagnostics.sceneChanged(sceneState("northrop-mall"));
    diagnostics.sceneChanged(sceneState(null));
    expect(texts().slice(2)).toEqual(["Scene tour, revision r1: 3 360 images", "Inside the 360 image northrop-mall", "Back on the map"]);
  });

  it("keeps where the visit is in its record, for the visit after a page that stops", () => {
    const { diagnostics, browser, environment } = start();
    diagnostics.sceneChanged(sceneState("northrop-mall"));
    environment.flush();
    expect(JSON.parse([...browser.items.values()][0])).toMatchObject({ state: "scene tour, revision r1, inside the 360 image northrop-mall" });
    diagnostics.sceneChanged(sceneState(null));
    environment.flush();
    expect(JSON.parse([...browser.items.values()][0])).toMatchObject({ state: "scene tour, revision r1, on the map" });
  });

  it("marks the trail hidden and closed as the page says, so the next visit can tell how this one ended", () => {
    const { page, browser, environment } = start();
    environment.flush();
    const record = () => JSON.parse([...browser.items.values()][0]) as { closed: boolean; hidden: boolean; app: string };
    expect(record()).toMatchObject({ closed: false, hidden: false, app: `${WHO_IN_FULL}, renderer not started.` });
    page.fire("pagehide");
    expect(record().closed).toBe(true);
    page.fire("pageshow", { persisted: true });
    expect(record().closed).toBe(false);
  });

  it("warns in the log when the visit before stopped while shown, and not when it was closed or hidden", async () => {
    for (const [end, warned] of [["unexpected", true], ["closed", false], ["hidden", false]] as const) {
      const browser = fakeBrowser();
      const before = browser.page("before");
      const trail = createSessionTrail({ app: () => "Build b.", kept: () => true, limit: () => 10, environment: before });
      before.elapsedMs = 42_000;
      trail.step("Inside the 360 image northrop-mall");
      trail.setState("scene tour, revision r1, inside the 360 image northrop-mall");
      before.flush();
      if (end === "closed") trail.setClosed(true);
      if (end === "hidden") trail.setHidden(true);
      before.close();
      const { diagnostics, said } = start(browser, "after");
      await browser.settle();
      expect((await diagnostics.previous())?.ended).toBe(end);
      expect(said().map(entry => entry.text)).toEqual(warned
        ? ["The last visit stopped without being closed, 42 s after it opened or later; it was at: scene tour, revision r1, inside the 360 image northrop-mall; its last step: Inside the 360 image northrop-mall. Settings → Diagnostics has a report to copy."]
        : []);
    }
  });

  it("removes the trail from the device when keeping it is turned off", () => {
    const { settings, browser, environment } = start();
    environment.flush();
    expect(browser.items.size).toBe(1);
    settings.set(TRAIL_KEPT, false);
    expect(browser.items.size).toBe(0);
  });

  it("reports the settings that are not at their defaults, a key only as set, and what the host adds", async () => {
    const { diagnostics, settings, browser } = start();
    settings.set("scene.panorama.previewSheets", false);
    settings.set("map.source.googleKey", "AIzaSecret");
    diagnostics.attachRuntime(fakeRuntime().runtime);
    diagnostics.sceneChanged(sceneState("northrop-mall"));
    diagnostics.addState(() => "App files: 63 files (1.7 MB) of the app kept on this device.");
    diagnostics.addState(() => { throw new Error("unreadable"); });
    const asked = diagnostics.report();
    await browser.settle();
    const report = await asked;
    expect(report).toContain("Renderer: webgpu (asked for auto)");
    expect(report).toContain("GPU: apple, metal-3");
    expect(report).toContain("Scene: tour, revision r1, 3 360 images, immersive, inside northrop-mall; 0 warnings");
    expect(report).toContain("App files: 63 files (1.7 MB) of the app kept on this device.");
    expect(report).toContain("  scene.panorama.previewSheets = off (saved on this device; default on)");
    expect(report).toContain("  map.source.googleKey = set (saved on this device; default not set)");
    expect(report).not.toContain("AIzaSecret");
    expect(report).toContain("Inside the 360 image northrop-mall");
    expect(report).toContain("The visit before: no trail of one on this device.");
  });
});
