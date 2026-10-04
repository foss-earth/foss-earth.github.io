import { describe, expect, it } from "vitest";
import { buildReport, reportPage, type ReportParts } from "./report";

const parts = (over: Partial<ReportParts> = {}): ReportParts => ({
  at: new Date("2026-10-04T16:00:00Z"),
  page: reportPage("https://umn-vr.github.io/tour/twin-cities/?renderer=webgpu&key=AIzaSecret"),
  build: "2026-10-04T15:00:00.000Z", source: "1a2b3c4d5e6f", bundle: "twinCities-C9TYTT-e.js",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2_1 like Mac OS X)",
  screen: { width: 414, height: 896, devicePixelRatio: 3, touch: true },
  device: { cores: 6, memoryGiB: null },
  renderer: { asked: "auto", mode: "webgpu", driver: "Apple GPU", maxTextureSize: 8192, fallbackReason: null, lost: 1 },
  state: ["Scene: umn-twin-cities, revision 4b89d4e2af09, 60 360 images, immersive, inside northrop-mall; 0 warnings", "App files: 63 files (1.7 MB) of the app kept on this device."],
  settings: [{ id: "scene.panorama.tileMemoryMiB", value: "28.25 MiB", from: "saved on this device", defaultValue: "73.25 MiB" }, { id: "map.source.googleKey", value: "set", from: "from the address", defaultValue: "not set" }],
  steps: [{ ms: 0, text: "Opened https://umn-vr.github.io/tour/twin-cities/" }, { ms: 1234, text: "console.warn: WebGPU uncaptured error", count: 3, lastMs: 9876 }, { ms: 2000, text: "Back on the map", count: 2 }],
  errors: [{ kind: "error", message: "TypeError: x is not a function", where: "twinCities-C9TYTT-e.js:1:2", stack: "TypeError: x is not a function\n    at draw (https://umn-vr.github.io/assets/a.js?key=AIzaSecret:1:2)", count: 4 }],
  previous: { ended: "unexpected", record: { version: 1, id: "a", startedAt: Date.parse("2026-10-04T15:50:00Z"), app: "Build b, bundle twinCities-C9TYTT-e.js, renderer webgpu.", state: "scene umn-twin-cities, revision 4b89d4e2af09, inside the 360 image northrop-mall", steps: [{ ms: 42_000, text: "Inside the 360 image northrop-mall" }], closed: false, hidden: false } },
  ...over,
});

describe("the report", () => {
  it("says what ran, on what, how it is set, what this visit did and how the one before ended", () => {
    expect(buildReport(parts())).toBe([
      "FOSS Earth report, 2026-10-04T16:00:00.000Z",
      "Page: https://umn-vr.github.io/tour/twin-cities/?renderer=webgpu&key=…",
      "Build: 2026-10-04T15:00:00.000Z · source 1a2b3c4d5e6f · bundle twinCities-C9TYTT-e.js",
      "Browser: Mozilla/5.0 (iPhone; CPU iPhone OS 18_2_1 like Mac OS X)",
      "Screen: 414 × 896 CSS px at 3×, touch; 6 cores; memory not reported",
      "Renderer: webgpu (asked for auto); largest texture 8192 px; lost 1 time this visit",
      "GPU: Apple GPU",
      "Scene: umn-twin-cities, revision 4b89d4e2af09, 60 360 images, immersive, inside northrop-mall; 0 warnings",
      "App files: 63 files (1.7 MB) of the app kept on this device.",
      "",
      "Settings not at their defaults:",
      "  scene.panorama.tileMemoryMiB = 28.25 MiB (saved on this device; default 73.25 MiB)",
      "  map.source.googleKey = set (from the address; default not set)",
      "",
      "Errors nothing handled:",
      "  TypeError: x is not a function at twinCities-C9TYTT-e.js:1:2 (4 times)",
      // The key goes with whatever follows it up to the next parameter or space: more is left out rather than less.
      "      at draw (https://umn-vr.github.io/assets/a.js?key=…)",
      "",
      "This visit, oldest first:",
      "      0.0 s  Opened https://umn-vr.github.io/tour/twin-cities/",
      "      1.2 s  console.warn: WebGPU uncaptured error (3 times, the last at 9.9 s)",
      "      2.0 s  Back on the map (2 times)",
      "",
      "The visit before, opened 2026-10-04T15:50:00.000Z, stopped without being closed, while shown. Build b, bundle twinCities-C9TYTT-e.js, renderer webgpu.",
      "  It was at: scene umn-twin-cities, revision 4b89d4e2af09, inside the 360 image northrop-mall",
      "     42.0 s  Inside the 360 image northrop-mall",
      "",
    ].join("\n"));
  });

  it("says so when there is nothing to list", () => {
    const report = buildReport(parts({ settings: [], errors: [], previous: null, renderer: { asked: "webgpu", mode: "webgl2", driver: null, maxTextureSize: null, fallbackReason: "WebGPU is not available", lost: 0 } }));
    expect(report).toContain("Settings: all at their defaults.");
    expect(report).toContain("Errors nothing handled: none.");
    expect(report).toContain("The visit before: no trail of one on this device.");
    expect(report).toContain("Renderer: webgl2 (asked for webgpu); fell back: WebGPU is not available; largest texture unknown px; lost 0 times this visit");
    expect(report).toContain("GPU: not named");
    expect(report).not.toContain("AIzaSecret");
  });
});
