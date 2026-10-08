/**
 * Imagery continuity on the real GPU, driven by imagery-continuity.mjs without a
 * server. The real raster runtime in atlas mode over flat terrain, with
 * synthetic imagery that names its own level and texels, replays the
 * delayed-fallback sequence of the CPU regressions: a fine region's coarse
 * stand-in is held in flight while the region's own imagery arrives and is
 * drawn, then the source answers that the stand-in does not exist. The ground
 * under the stand-in is read back before and after that answer: the level each
 * pixel shows, and the selected, resident and bound levels there.
 *
 * As in the map-detail binding fixture's gradient mode, red and green are a
 * texel's column and row in its image, and blue is 8 × level plus its tile's
 * parity.
 */
import { Color4, GeospatialCamera, GeospatialClippingBehavior, RenderTargetTexture, Scene, type Engine, type WebGPUEngine } from "@babylonjs/core";
import { ecefToGeodetic } from "../../src/camera/cameraMath";
import { CameraController } from "../../src/camera/cameraState";
import { createRasterTilesRuntime } from "../../src/engine/babylon/createRasterTilesRuntime";
import { bootstrapGlobeRenderer, type RendererMode } from "../../src/engine/babylon/createRendererMode";
import { preparePages } from "../../src/engine/babylon/imagery/imageryPagePreparation";
import { ImageryMissingError, type ImageryLoader, type PreparedImage } from "../../src/engine/babylon/imagery/imageryResidency";
import type { RasterBaseMapSource } from "../../src/engine/babylon/rasterBaseMaps";
import { createSettingsRegistry, FOSS_EARTH_PARAMETERS, readDeviceContext } from "../../src/settings";
import { lonLatToTileXY, tileContains, tileKey, type TileId } from "../../src/terrain/imagery/imageryGeometry";

const WIDTH = 960;
const HEIGHT = 540;
const BACKGROUND = [255, 0, 255] as const;
/** Nearly straight down over flat ground: the regions around the centre are fine ones. */
const VIEW = { latDeg: 36.1, lonDeg: -112.1, zoomMeters: 3000, pitchDeg: 85, headingDeg: 0 };
const SOURCE: RasterBaseMapSource = {
  id: "fixture-levels", label: "Fixture", provider: "Fixture", protocol: "xyz", urlTemplate: "fixture://levels/{z}/{x}/{y}",
  attribution: "Synthetic fixture", kind: "photographic", version: "1", tileSize: { width: 256, height: 256 }, minZoom: 0, maxZoom: 20,
};
/** Longer without any imagery work than the coarsening delay and the pin together. */
const QUIET_MS = 1600;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const parseKey = (key: string): TileId => {
  const [z, x, y] = key.split("/").map(Number);
  return { z, x, y };
};
const ancestorOf = (tile: TileId, levels: number): TileId => ({ z: tile.z - levels, x: tile.x >> levels, y: tile.y >> levels });
/** A point as a level-20 tile, fine enough to lie inside any selected region. */
const pointTile = (latDeg: number, lonDeg: number): TileId => {
  const at = lonLatToTileXY(lonDeg, latDeg, 20);
  return { z: 20, x: Math.floor(at.x), y: Math.floor(at.y) };
};

function levelImage(z: number, x: number, y: number, width: number, height: number): PreparedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const blue = 8 * z + 2 * (y & 1) + (x & 1);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = (row * width + col) * 4;
    data[i] = Math.floor((col * 256) / width);
    data[i + 1] = Math.floor((row * 256) / height);
    data[i + 2] = blue;
    data[i + 3] = 255;
  }
  return { width, height, pages: preparePages(data, width, height), compressedBytes: null };
}

/** Images made on request, none fetched. `hold` names one kept in flight until the page answers it. */
function syntheticImages(hold: string | null) {
  const requested: string[] = [];
  const loaded = new Set<string>();
  let held: { reject(error: Error): void } | null = null;
  let cancelled = false;
  const loader: ImageryLoader = {
    async load(url, { width, height }, signal) {
      const match = /^fixture:\/\/levels\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
      if (!match) throw new Error(`Unexpected image URL ${url}`);
      const [z, x, y] = match.slice(1).map(Number);
      const key = `${z}/${x}/${y}`;
      requested.push(key);
      if (key === hold && !held) {
        return new Promise<PreparedImage>((_resolve, reject) => {
          held = { reject };
          signal.addEventListener("abort", () => {
            cancelled = true;
            reject(new DOMException("The request was cancelled.", "AbortError"));
          }, { once: true });
        });
      }
      // As a download does, answer in a later task.
      await new Promise(resolve => setTimeout(resolve, 0));
      const image = levelImage(z, x, y, width, height);
      loaded.add(key);
      return image;
    },
  };
  return {
    loader, requested, loaded,
    isHeld: () => held !== null,
    wasCancelled: () => cancelled,
    /** The source's answer for the held image: it has no such image. */
    answerMissing() {
      assert(held, "No image is held.");
      held.reject(new ImageryMissingError("Map tile not available (404)"));
    },
  };
}

/** Renders the camera into a single-sample target and reads it back top-down. */
async function capture(scene: Scene): Promise<Uint8Array> {
  const engine = scene.getEngine();
  // Imagery can settle before shaders compile: wait for drawable materials.
  await scene.whenReadyAsync();
  const target = new RenderTargetTexture("check-capture", { width: WIDTH, height: HEIGHT }, scene, false);
  target.renderList = scene.meshes.slice();
  target.activeCamera = scene.activeCamera;
  target.clearColor = scene.clearColor;
  engine.beginFrame();
  target.render(true);
  engine.endFrame();
  const data = await target.readPixels();
  target.dispose();
  assert(data, "No pixels were captured.");
  const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  // Render targets read back bottom-up.
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row++) out.set(source.subarray((HEIGHT - 1 - row) * WIDTH * 4, (HEIGHT - row) * WIDTH * 4), row * WIDTH * 4);
  return out;
}

function toPng(pixels: Uint8Array): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), WIDTH, HEIGHT), 0, 0);
  return canvas.toDataURL("image/png");
}

const isBackground = (pixels: Uint8Array, i: number) =>
  Math.abs(pixels[i] - BACKGROUND[0]) + Math.abs(pixels[i + 1] - BACKGROUND[1]) + Math.abs(pixels[i + 2] - BACKGROUND[2]) < 24;

/** One run of the runtime over the fixture view, with `hold` kept in flight. */
function scenario(engine: Engine | WebGPUEngine, hold: string | null) {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(BACKGROUND[0] / 255, BACKGROUND[1] / 255, BACKGROUND[2] / 255, 1);
  const camera = new GeospatialCamera("check-camera", scene, { planetRadius: 6378137 });
  camera.addBehavior(new GeospatialClippingBehavior());
  const controller = new CameraController(camera);
  const view = { ...VIEW };
  // A fresh camera clamps pitch against its first radius; the second application lands where asked.
  controller.applyViewState(view);
  controller.applyViewState(view);
  const settings = createSettingsRegistry({ storage: null, deviceContext: readDeviceContext() });
  settings.register(FOSS_EARTH_PARAMETERS);
  const images = syntheticImages(hold);
  let renderRequests = 0;
  const runtime = createRasterTilesRuntime({
    scene, source: SOURCE, getViewState: () => view, getSurfaceHeightMeters: () => 0,
    imagery: "atlas", imageryLoader: images.loader, settings, requestRender: () => { renderRequests += 1; },
  });
  const atlas = () => runtime.getImageryDiagnostics().atlas!;
  /** The selected region a point lies in, with the page level the visible patches bind there. */
  const regionAt = (point: TileId) => {
    const region = atlas().plan?.regions.find(candidate => tileContains(parseKey(candidate.key), point));
    return region ? { key: region.key, selected: parseKey(region.key).z, bound: region.delivered } : null;
  };
  /** The finest image downloaded for a point; resident while nothing is evicted, staged or unplaced. */
  const residentAt = (point: TileId): number | null => {
    let finest: number | null = null;
    for (const key of images.loaded) if (tileContains(parseKey(key), point)) finest = Math.max(finest ?? -1, parseKey(key).z);
    return finest;
  };
  const frame = async () => {
    runtime.update();
    engine.beginFrame();
    scene.render();
    engine.endFrame();
    await new Promise(resolve => setTimeout(resolve, 4));
  };
  /**
   * Frames until imagery queues and stages nothing, has `inFlight` downloads,
   * and does no work for QUIET_MS. `each` sees every frame.
   */
  const settle = async (inFlight: number, each?: () => void, limitMs = 60_000) => {
    const started = performance.now();
    let last = "", since = started;
    for (;;) {
      await frame();
      each?.();
      const { counters, residency } = atlas();
      const state = JSON.stringify([counters.selections, counters.uploads, counters.publishes, counters.tableWrites, residency.inFlight, residency.queued, residency.staged]);
      const now = performance.now();
      if (state !== last) {
        last = state;
        since = now;
      } else if (now - since >= QUIET_MS && residency.queued === 0 && residency.staged === 0 && residency.inFlight === inFlight) {
        return Math.round(now - started);
      }
      if (now - started > limitMs) throw new Error(`Imagery did not settle within ${limitMs} ms: ${state}`);
    }
  };
  /** Work done while nothing changes for `ms`. */
  const stationary = async (ms: number) => {
    const before = atlas().counters, requests = renderRequests, started = performance.now();
    let frames = 0;
    for (; performance.now() - started < ms; frames++) await frame();
    const after = atlas().counters;
    return {
      ms, frames, selections: after.selections - before.selections, uploads: after.uploads - before.uploads,
      tableWrites: after.tableWrites - before.tableWrites, publishes: after.publishes - before.publishes, renderRequests: renderRequests - requests,
    };
  };
  /**
   * The ground under a grid of pixels inside `within`: the level and texel each
   * pixel shows, and the selected, bound and resident levels there.
   */
  const readGround = async (within: TileId) => {
    const pixels = await capture(scene);
    let terrainPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (!isBackground(pixels, i)) terrainPixels += 1;
    const samples = [];
    for (let gy = 1; gy < 12; gy++) for (let gx = 1; gx < 20; gx++) {
      const x = Math.round((gx * WIDTH) / 20), y = Math.round((gy * HEIGHT) / 12);
      // Through the pixel's centre, where the capture sampled it.
      const hit = scene.pick(x + 0.5, y + 0.5, mesh => Boolean(mesh.metadata?.mapSurface) && mesh.isEnabled());
      if (!hit?.hit || !hit.pickedPoint) continue;
      const geo = ecefToGeodetic(hit.pickedPoint.x, hit.pickedPoint.y, hit.pickedPoint.z);
      const latDeg = (geo.latRad * 180) / Math.PI, lonDeg = (geo.lonRad * 180) / Math.PI;
      const point = pointTile(latDeg, lonDeg);
      if (!tileContains(within, point)) continue;
      const i = (y * WIDTH + x) * 4;
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      const shown = isBackground(pixels, i) ? null : b >> 3;
      // Texel and parity against the picked point, away from tile edges where filtering wraps.
      let placed: boolean | null = null;
      if (shown !== null) {
        const at = lonLatToTileXY(lonDeg, latDeg, shown);
        const u = (at.x - Math.floor(at.x)) * 256, v = (at.y - Math.floor(at.y)) * 256;
        if (u >= 3 && u <= 253 && v >= 3 && v <= 253) {
          const parity = 2 * (Math.floor(at.y) & 1) + (Math.floor(at.x) & 1);
          // Texel i holds value i at its centre, so a sample at u reads u − 0.5.
          placed = Math.max(Math.abs(r - (u - 0.5)), Math.abs(g - (v - 0.5))) <= 3 && (b & 3) === parity;
        }
      }
      const region = regionAt(point);
      samples.push({ x, y, shown, placed, region: region?.key ?? null, selected: region?.selected ?? null, bound: region?.bound ?? null, resident: residentAt(point) });
    }
    return { terrainPixels, samples, png: toPng(pixels) };
  };
  return {
    scene, runtime, images, atlas, regionAt, residentAt, settle, stationary, readGround,
    dispose() {
      runtime.dispose();
      scene.dispose();
    },
  };
}

const levelCounts = (levels: Array<number | null>) => {
  const counts: Record<string, number> = {};
  for (const level of levels) counts[String(level)] = (counts[String(level)] ?? 0) + 1;
  return counts;
};

async function run() {
  const backend = new URLSearchParams(location.search).get("backend") as RendererMode;
  assert(["webgpu", "webgl2", "webgl"].includes(backend), "Unknown backend");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;display:block`;
  document.body.append(canvas);
  // The runner disables WebGL 2 for the WebGL 1 case in its own browser, so this is the production bootstrap.
  let created: Awaited<ReturnType<typeof bootstrapGlobeRenderer>>;
  try {
    created = await bootstrapGlobeRenderer(canvas, { force: backend, antialias: false });
  } catch (error) {
    canvas.remove();
    return { backend, available: false as const, reason: `The renderer did not start: ${error instanceof Error ? error.message : String(error)}` };
  }
  const engine = created.renderer.engine;
  created.scene?.dispose();
  try {
    const actual = engine.isWebGPU ? "webgpu" : (engine as Engine).webGLVersion === 1 ? "webgl" : "webgl2";
    if (actual !== backend) return { backend, available: false as const, reason: `Asked for ${backend}; the bootstrap started ${actual}.` };
    const renderer = engine.isWebGPU ? (engine as WebGPUEngine).getInfo() : (engine as Engine).getGlInfo();
    if (/swiftshader|llvmpipe|software/i.test(JSON.stringify(renderer))) return { backend, available: false as const, reason: `Software renderer: ${JSON.stringify(renderer)}` };
    engine.setHardwareScalingLevel(1);
    const settings = createSettingsRegistry({ storage: null, deviceContext: readDeviceContext() });
    settings.register(FOSS_EARTH_PARAMETERS);
    const fallbackStep = settings.get<number>("map.imagery.fallbackStep");
    const fallbackGap = settings.get<number>("map.imagery.fallbackGap");
    const centre = pointTile(VIEW.latDeg, VIEW.lonDeg);

    // A dry run, nothing held: the region the view settles on at its centre,
    // and the stand-in asked for ahead of it.
    const dry = scenario(engine, null);
    let probe: TileId, standIn: TileId, dryRun;
    try {
      const settledMs = await dry.settle(0);
      const region = dry.regionAt(centre);
      assert(region, "The settled plan has no region at the view's centre.");
      probe = parseKey(region.key);
      standIn = ancestorOf(probe, fallbackStep);
      dryRun = { settledMs, requests: dry.images.requested.length, centre: region, standInRequested: dry.images.requested.includes(tileKey(standIn)) };
    } finally { dry.dispose(); }

    // The same view again, with that stand-in held until the source says it has no such image.
    const test = scenario(engine, tileKey(standIn));
    try {
      const settledMs = await test.settle(1);
      const before = await test.readGround(standIn);
      const centreBefore = { ...test.regionAt(centre), resident: test.residentAt(centre) };
      const diagnosticsBefore = test.atlas();
      const held = test.images.isHeld() && !test.images.wasCancelled();
      // Every frame from the answer until imagery settles: the level bound at the centre.
      const timeline: Array<number | null> = [];
      if (held) test.images.answerMissing();
      const afterMs = await test.settle(0, () => timeline.push(test.regionAt(centre)?.bound ?? null));
      const after = await test.readGround(standIn);
      const centreAfter = { ...test.regionAt(centre), resident: test.residentAt(centre) };
      const diagnosticsAfter = test.atlas();
      const constraintsAfter = test.runtime.getDetailFeedback().constraints ?? [];
      const still = await test.stationary(3000);

      const shownBefore = before.samples.map(sample => sample.shown);
      const pairs = before.samples.map((sample, index) => ({ before: sample, after: after.samples[index] }));
      const coarser = pairs.filter(pair => pair.after === undefined || pair.after.x !== pair.before.x || pair.after.y !== pair.before.y
        || (pair.after.shown ?? -1) < (pair.before.shown ?? -1));
      const testedBefore = before.samples.filter(sample => sample.placed !== null);
      const mismatchedBefore = testedBefore.filter(sample => sample.shown !== sample.bound);
      const misplaced = [...before.samples, ...after.samples].filter(sample => sample.placed === false);
      const residency = (diagnostics: typeof diagnosticsBefore) => ({
        missing: diagnostics.residency.missing, evictions: diagnostics.residency.evictions, staged: diagnostics.residency.staged,
        unplaced: diagnostics.residency.unplaced, inFlight: diagnostics.residency.inFlight, failed: diagnostics.residency.failed,
      });
      const checks = [
        { name: "the stand-in was asked for and held until the source answered", passed: held, detail: { standIn: tileKey(standIn), cancelled: test.images.wasCancelled() } },
        { name: "both captures show terrain, and the stand-in's ground in at least 20 sampled pixels",
          passed: before.terrainPixels > 0 && after.terrainPixels > 0 && before.samples.length >= 20 && after.samples.length === before.samples.length
            && [...before.samples, ...after.samples].every(sample => sample.shown !== null),
          detail: { terrainPixels: [before.terrainPixels, after.terrainPixels], samples: [before.samples.length, after.samples.length] } },
        { name: "before the answer, the centre shows its own fine imagery: selected, resident and bound at its level",
          passed: centreBefore.selected === probe.z && centreBefore.bound === probe.z && (centreBefore.resident ?? -1) >= probe.z && probe.z > standIn.z,
          detail: centreBefore },
        { name: "each sampled pixel away from tile edges shows the level bound where it lies, at the right texel",
          passed: testedBefore.length >= 20 && mismatchedBefore.length === 0 && misplaced.length === 0,
          detail: { tested: testedBefore.length, mismatched: mismatchedBefore.slice(0, 8), misplaced: misplaced.slice(0, 8) } },
        { name: "the source's answer is recorded, and selection refined past it toward the resident imagery",
          passed: diagnosticsAfter.residency.missing >= 1 && (diagnosticsAfter.plan?.refinedPastMissing ?? 0) >= 1,
          detail: { missing: diagnosticsAfter.residency.missing, refinedPastMissing: diagnosticsAfter.plan?.refinedPastMissing ?? null } },
        { name: "no frame after the answer binds coarser imagery at the centre",
          passed: timeline.length > 0 && timeline.every(level => level !== null && level >= probe.z), detail: { frames: timeline.length, levels: levelCounts(timeline) } },
        { name: "no sampled pixel under the stand-in shows coarser imagery after the answer, and the centre keeps its levels",
          passed: coarser.length === 0 && centreAfter.selected === centreBefore.selected && centreAfter.bound === centreBefore.bound,
          detail: { coarser: coarser.slice(0, 8), before: levelCounts(shownBefore), after: levelCounts(after.samples.map(sample => sample.shown)), centre: centreAfter } },
        { name: "nothing was evicted, and nothing downloaded waits to be placed",
          passed: diagnosticsAfter.residency.evictions === 0 && diagnosticsAfter.residency.staged === 0 && diagnosticsAfter.residency.unplaced === 0,
          detail: { before: residency(diagnosticsBefore), after: residency(diagnosticsAfter) } },
        { name: "the absent stand-in is not reported as a limit on what the view shows",
          passed: !constraintsAfter.some(constraint => constraint.cause === "source" && constraint.missingRegions > 0), detail: constraintsAfter },
        { name: "once settled, a still view selects, uploads, writes and asks for nothing",
          passed: still.selections === 0 && still.uploads === 0 && still.tableWrites === 0 && still.publishes === 0 && still.renderRequests === 0, detail: still },
      ];
      return {
        backend, available: true as const, renderer, reverseDepth: engine.useReverseDepthBuffer,
        inputs: { view: VIEW, viewport: [WIDTH, HEIGHT], source: { kind: SOURCE.kind, maxZoom: SOURCE.maxZoom, tile: 256 }, fallbackStep, fallbackGap,
          centre: tileKey(probe), standIn: tileKey(standIn) },
        dryRun,
        settledMs: { held: settledMs, afterAnswer: afterMs },
        checks, passed: checks.every(check => check.passed),
        screenshots: { before: before.png, after: after.png },
      };
    } finally { test.dispose(); }
  } finally {
    engine.dispose();
    canvas.remove();
  }
}

declare global {
  interface Window { imageryContinuityCheck?: { done: boolean; report?: Awaited<ReturnType<typeof run>>; error?: string } }
}
window.imageryContinuityCheck = { done: false };
void run().then(report => { window.imageryContinuityCheck = { done: true, report }; }, error => {
  window.imageryContinuityCheck = { done: true, error: error instanceof Error ? error.stack : String(error) };
});
