#!/usr/bin/env node
/**
 * The panorama campus check (docs/proposals/panorama-scenes.md §7): one 360°
 * orb 30 m above the University of Minnesota campus, driven through the real
 * globe camera and scene loader in headless Chrome, on this machine's GPU.
 *
 * It builds the app, serves the build through request interception (no HTTP
 * server) and opens `?scene=umn-single&panoramaTest=1`. Map and elevation
 * tiles come from the network, from the default keyless providers, with the
 * browser identified as foss-earth-check/1.0. Then:
 *
 *  1. Cold load: the time to the app, the scene, the placed marker and the preview.
 *  2. Correctness replay: the camera trace with the orb's own shader read
 *     back as rays and as the image directions it samples, each held against
 *     the CPU reference with the same camera frame, marker and image pose.
 *     Every frame's orb draw is matched with the live camera.
 *  3. Negative control: the same check with the orb's uniforms one frame
 *     late while the camera moves. The check must reject it.
 *  4. Pointer drags through the globe's own input, then a probe.
 *  5. Colour: landscape and portrait screenshots looking north from the
 *     south and east from the west, of the photograph and the cardinal
 *     image, each pixel held against the source sampled at the CPU direction,
 *     and against the same sampled mirrored or turned.
 *  6. Timing: the same trace without readbacks, with the orb shown, hidden
 *     (scene unloaded), and shown with profiling off, at a 60 fps cap, the
 *     map held at the detail asked for.
 *  7. Entering: the orb's immersion read back against the CPU rays, and Exit
 *     restoring the camera; then the linked pair: enter, follow, Back, Exit.
 *
 * On macOS it holds off idle sleep while it runs, and a step the machine
 * slept through stops the check, since its clocks stopped with it.
 *
 * The camera trace, durations, viewports and thresholds are test inputs, not
 * runtime tuning. Nothing here is manual acceptance: the report says
 * "automated check passed on <configuration>; manual acceptance pending".
 *
 * Usage: node scripts/validation/panorama-campus.mjs [--out=dir] [--dist=dir | --no-build]
 *   [--viewport=1440x900] [--portrait=720x1280] [--dpr=1] [--scale=1] [--fps=60]
 *   [--tolerance=0.01] [--p95=20] [--p99=33.3] [--max-interval=100] [--trace=file.json]
 *   [--skip-correctness] [--skip-colour] [--skip-timing] [--skip-navigation]
 * Output: build/validation/panorama-campus/<local time>/ with report.json,
 * summary.md, screenshots/ and traces/.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";
import { decodeJpeg, decodePng } from "../lib/panoramaImage.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);
const size = text => { const [width, height] = text.split("x").map(Number); return { width, height }; };

const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "panorama-campus");
await mkdir(path.join(out, "screenshots"), { recursive: true });
await mkdir(path.join(out, "traces"), { recursive: true });
// Chrome and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;

const config = {
  landscape: size(arg("viewport", "1440x900")),
  portrait: size(arg("portrait", "720x1280")),
  dpr: Number(arg("dpr", "1")),
  scale: Number(arg("scale", "1")),
  fps: Number(arg("fps", "60")),
  // The CPU window and pose applied to the GPU's own ray, against what the GPU sampled.
  toleranceDeg: Number(arg("tolerance", "0.01")),
  // Each pixel's ray against the CPU's pixel-centre ray: the rasteriser's interpolation precision, 1/36 of a 900 px view's pixel.
  rayToleranceDeg: Number(arg("ray-tolerance", "0.002")),
  // End to end, as a share of the panorama one pixel shows: sub-pixel.
  endToEndPixelShare: 0.1,
  budget: { p95Ms: Number(arg("p95", "20")), p99Ms: Number(arg("p99", "33.3")), maxIntervalMs: Number(arg("max-interval", "100")) },
  previewFovDeg: 90,
  probeEverySeconds: 1,
  colourStepCssPx: 1,
  // Only pixels where two orientations predict colours this far apart (0–255) can tell them apart.
  colourDistinctLevels: 24,
  colourMinimumDistinctPixels: 20,
  userAgentSuffix: "foss-earth-check/1.0",
  // Asleep for longer than this during a step, the step measured nothing and the check stops.
  suspendedMs: 2000,
  // macOS idle-sleeps an unattended machine and stops the page's clocks mid-trace; closing the lid still does.
  preventIdleSleep: process.platform === "darwin" ? "caffeinate -i, for this process's lifetime" : null,
};
const SUSPENDED_MS = config.suspendedMs;
if (process.platform === "darwin") {
  const awake = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  awake.on("error", () => { /* without it, a sleep still stops the check with its reason */ });
  awake.unref();
}

// One 20 s orbit each way, a 10 s near/far sweep, 10 s of elevated and
// off-centre looking, a stop and a restart. Heights are above the marker.
const DEFAULT_TRACE = [
  { name: "orbit-clockwise", type: "orbit", seconds: 20, fromBearingDeg: 180, turnDeg: 360, distanceM: 100, heightM: 3 },
  { name: "orbit-counterclockwise", type: "orbit", seconds: 20, fromBearingDeg: 180, turnDeg: -360, distanceM: 100, heightM: 3 },
  { name: "near-far", type: "sweep", seconds: 10, bearingDeg: 180, nearM: 30, farM: 200, heightM: 3 },
  { name: "look-above", type: "look", seconds: 10 / 3, bearingDeg: 225, distanceM: 100, heightM: 40, yawAmplitudeDeg: 20, pitchAmplitudeDeg: 8 },
  { name: "look-below", type: "look", seconds: 10 / 3, bearingDeg: 135, distanceM: 100, heightM: -15, yawAmplitudeDeg: 20, pitchAmplitudeDeg: 4 },
  { name: "look-near", type: "look", seconds: 10 / 3, bearingDeg: 300, distanceM: 50, heightM: 10, yawAmplitudeDeg: 25, pitchAmplitudeDeg: 10 },
  { name: "stop", type: "stop", seconds: 2 },
  { name: "restart", type: "orbit", seconds: 5, fromBearingDeg: 300, turnDeg: 90, distanceM: 50, heightM: 10 },
];
const trace = (arg("trace") ? JSON.parse(await readFile(path.resolve(arg("trace")), "utf8")) : DEFAULT_TRACE)
  .map(segment => ({ ...segment, seconds: segment.seconds * config.scale }));
const CONTROL_TRACE = [{ name: "control", type: "orbit", seconds: 4 * config.scale, fromBearingDeg: 180, turnDeg: 90, distanceM: 100, heightM: 3 }];
const WARMUP_TRACE = trace.filter(segment => segment.type !== "stop").map(segment => ({ ...segment, seconds: segment.seconds / 4 }));
const VIEWS = [
  { name: "north", note: "south of the marker, looking north", pose: { bearingDeg: 180, distanceM: 40, heightM: 3 } },
  { name: "east", note: "west of the marker, looking east", pose: { bearingDeg: 270, distanceM: 40, heightM: 3 } },
];
const SOURCES = [
  { name: "photograph", sceneId: "umn-single", manifest: "examples/panorama-scenes/umn-single.scene.json" },
  { name: "cardinal", sceneId: "umn-cardinal", manifest: "examples/panorama-scenes/umn-cardinal.scene.json" },
];
// Two different images, linked both ways: enter, follow, Back, Exit.
const PAIR = { name: "pair", sceneId: "campus-pair", manifest: "examples/panorama-scenes/campus-pair.scene.json" };

// ─── Build and inputs ─────────────────────────────────────────────────
const dist = arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
if (!arg("dist") && !flag("no-build")) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); } catch { return null; } };
const manifests = {};
const inputs = { commit: git("rev-parse", "HEAD"), uncommittedFiles: (git("status", "--porcelain") ?? "").split("\n").filter(Boolean).length, files: {} };
for (const source of [...SOURCES, PAIR]) {
  const text = await readFile(path.join(dist, source.manifest));
  manifests[source.sceneId] = JSON.parse(text);
  inputs.files[source.manifest] = sha256(text);
  const base = path.dirname(source.manifest);
  for (const asset of manifests[source.sceneId].assets) {
    for (const representation of asset.representations) {
      for (const file of Object.values(representation.faces ?? { image: representation.url })) {
        if (file) inputs.files[path.posix.join(base, file)] = sha256(await readFile(path.join(dist, base, file)));
      }
    }
  }
}
for (const file of ["scripts/validation/panorama-campus.mjs", "scripts/validation/panoramaCampusAgent.js"]) inputs.files[file] = sha256(await readFile(path.join(root, file)));
const agentSource = await readFile(path.join(root, "scripts/validation/panoramaCampusAgent.js"), "utf8");

// ─── Browser ──────────────────────────────────────────────────────────
const ORIGIN = "https://foss-earth.test";
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".txt": "text/plain",
};
const chrome = await openHeadlessChrome(path.join(out, "chrome-profile"), arg("chrome") ?? process.env.CHROME_BIN, ["--enable-webgpu-developer-features"]);
const browserVersion = await chrome.send("Browser.getVersion");
let systemInfo = null;
try { systemInfo = await chrome.send("SystemInfo.getInfo"); } catch (error) { systemInfo = { error: error.message }; }
const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
const send = (method, params = {}) => chrome.send(method, params, sessionId);
const exceptions = [];
const requests = { phase: "cold load", byPhase: {} };
const count = (key) => {
  const phase = requests.byPhase[requests.phase] ??= { own: 0, panoramaMedia: 0, externalByHost: {} };
  if (key === "own" || key === "panoramaMedia") phase[key]++;
  else phase.externalByHost[key] = (phase.externalByHost[key] ?? 0) + 1;
};
chrome.onEvent(message => {
  if (message.sessionId !== sessionId) return;
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
  if (message.method === "Network.requestWillBeSent") {
    const url = new URL(message.params.request.url);
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.origin === ORIGIN) count(url.pathname.includes("/panorama-scenes/media/") ? "panoramaMedia" : "own");
    else count(url.host);
  }
  if (message.method !== "Fetch.requestPaused") return;
  void (async () => {
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(dist)) file = null;
    let body = null;
    try { if (file && (await stat(file)).isFile()) body = await readFile(file); } catch { /* 404 below */ }
    if (!body) {
      await chrome.send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" }, sessionId);
      return;
    }
    await chrome.send("Fetch.fulfillRequest", {
      requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: MIME[path.extname(file)] ?? "application/octet-stream" }],
      body: body.toString("base64"),
    }, sessionId);
  })().catch(error => exceptions.push(`interception: ${error.message}`));
});
await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: `${ORIGIN}/*` }] });
// A neutral name on every request, the tile servers' included; nothing about the person running it.
await send("Emulation.setUserAgentOverride", { userAgent: `${browserVersion.userAgent} ${config.userAgentSuffix}` });
const setViewport = ({ width, height }) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: config.dpr, mobile: false });
await setViewport(config.landscape);

const page = expression => evaluate(chrome, sessionId, expression);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Runs a long page task without holding one protocol call open, checking every
 * `pollMs`. Time is kept on the monotonic clock, which stops while the machine
 * sleeps; the wall clock does not, so the two part by the time it was asleep.
 */
async function job(expression, timeoutMs, pollMs = 1000) {
  const wallStart = Date.now(), awakeStart = performance.now();
  const checkAwake = () => {
    const asleepMs = Date.now() - wallStart - (performance.now() - awakeStart);
    if (asleepMs > SUSPENDED_MS) throw new Error(`The machine was asleep for about ${Math.round(asleepMs / 1000)} s during ${expression.slice(0, 80)}, so that step measured nothing. Keep it awake (the lid open) and rerun.`);
  };
  await page(`window.__campusResult = undefined; (async () => ${expression})().then(value => { window.__campusResult = { ok: true, value }; }, error => { window.__campusResult = { ok: false, error: String(error && error.stack || error) }; }); true`);
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    await sleep(pollMs);
    checkAwake();
    if (await page("window.__campusResult !== undefined")) {
      const result = await page("window.__campusResult");
      if (!result.ok) throw new Error(result.error);
      checkAwake();
      return result.value;
    }
  }
  let progress = null;
  try { progress = await page("window.__campusProgress ?? null"); } catch { /* the page is gone */ }
  throw new Error(`Timed out: ${expression.slice(0, 120)}; progress ${JSON.stringify(progress)}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  config: { ...config, trace, controlTrace: CONTROL_TRACE, views: VIEWS },
  inputs,
  browser: { product: browserVersion.product, userAgent: `${browserVersion.userAgent} ${config.userAgentSuffix}`, gpu: systemInfo?.gpu ?? systemInfo },
};
const failures = [];
const fail = message => { failures.push(message); console.log(`  ✗ ${message}`); };

try {
  // ─── 1. Cold load ───────────────────────────────────────────────────
  const settingsQuery = `set.renderer.frameRateCap=${config.fps}&set.scene.panorama.previewFov=${config.previewFovDeg}`;
  await send("Page.navigate", { url: `${ORIGIN}/?scene=umn-single&panoramaTest=1&${settingsQuery}` });
  console.log("Cold load…");
  const cold = {};
  const coldDeadline = Date.now() + 180_000;
  const COLD = `(() => { const T = window.__fossEarthPanoramaTest; if (!T) return { now: performance.now() };
    const s = T.scenes.handle()?.status; const e = s?.entries?.[0];
    return { now: performance.now(), app: true, scene: Boolean(s), overview: s?.overview ?? null, placement: e?.placement ?? null, preview: e?.preview ?? null, errors: T.scenes.state().errors }; })()`;
  while (!cold.previewReadyMs || !cold.markerPlacedMs) {
    if (Date.now() > coldDeadline) throw new Error(`The scene never became ready: ${JSON.stringify(cold)}; exceptions: ${exceptions.join(" | ")}`);
    let state = null;
    try { state = await page(COLD); } catch { /* the document is still loading */ }
    if (state?.errors?.length) throw new Error(`The scene did not load: ${JSON.stringify(state.errors)}`);
    if (state?.app) cold.appMs ??= state.now;
    if (state?.scene) cold.sceneMs ??= state.now;
    if (state?.overview === "applied") cold.overviewAppliedMs ??= state.now;
    if (state?.placement === "placed") cold.markerPlacedMs ??= state.now;
    if (state?.preview === "ready") cold.previewReadyMs ??= state.now;
    await sleep(50);
  }
  report.coldLoad = { ...cold, pollIntervalMs: 50, note: "Page time from navigation, with an empty browser profile and cache." };
  console.log(`  app ${cold.appMs?.toFixed(0)} ms, scene ${cold.sceneMs?.toFixed(0)} ms, marker ${cold.markerPlacedMs?.toFixed(0)} ms, preview ${cold.previewReadyMs.toFixed(0)} ms`);

  await page(agentSource);
  await page(`window.__campus.configure({ previewFovDeg: ${config.previewFovDeg} })`);
  const environment = await job(`({
    adapter: await window.__campus.adapter(),
    renderer: window.__fossEarthPanoramaTest.runtime.renderer.mode,
    map: (s => ({ mode: s.mode, basemap: s.rasterBaseMap?.id ?? null, basemapProvider: s.rasterBaseMap?.provider ?? null, elevation: s.terrainSource?.id ?? null }))(window.__fossEarthPanoramaTest.runtime.status),
    gpuTiming: window.__fossEarthPanoramaTest.runtime.frameProfile.gpuTimed(),
    devicePixelRatio: window.devicePixelRatio,
  })`, 30_000, 100);
  report.environment = environment;
  const hardware = environment.renderer === "webgpu" && environment.adapter && !environment.adapter.isFallbackAdapter;
  report.hardwareVerified = Boolean(hardware);
  console.log(`Renderer ${environment.renderer}; adapter ${JSON.stringify(environment.adapter)}; map ${JSON.stringify(environment.map)}`);
  if (environment.renderer !== "webgpu") throw new Error("WebGPU did not start: panoramas cannot be drawn, so nothing can be checked.");
  if (!hardware) fail("The WebGPU adapter is a software fallback or unknown: timing cannot be accepted on it.");

  const prepare = async source => {
    const manifest = manifests[source.sceneId];
    const entity = manifest.entities.find(entry => entry.id === manifest.initialPanorama);
    await job(`(async () => { const deadline = performance.now() + 120000;
      while (!window.__campus.ready(${JSON.stringify(entity.id)})) { if (performance.now() > deadline) throw new Error("not ready: " + JSON.stringify(window.__campus.status())); await new Promise(r => setTimeout(r, 100)); }
      return true; })()`, 130_000, 250);
    const prepared = await page(`window.__campus.prepare(${JSON.stringify(entity.id)}, ${JSON.stringify(entity.capture)}, ${JSON.stringify(entity.imagePose)})`);
    const detail = await page(`window.__campus.status().scene.entries.find(e => e.id === ${JSON.stringify(entity.id)}).previewDetail`);
    // A ground-relative marker follows the displayed terrain as it refines: look at it from the trace's start until it holds still.
    await page(`window.__campus.apply(${JSON.stringify(trace[0].type === "orbit" ? { bearingDeg: trace[0].fromBearingDeg, distanceM: trace[0].distanceM, heightM: trace[0].heightM } : { bearingDeg: 180, distanceM: 100, heightM: 3 })})`);
    const settle = await job("window.__campus.settleMarker(5000, 0.05, 90000)", 100_000, 250);
    if (!settle.settled) fail(`The ${source.name} marker was still moving, or terrain still streaming, after 90 s.`);
    return { entity, prepared: { ...prepared, marker: settle.marker, markerGeodetic: settle.geodetic, markerSettle: { settled: settle.settled, seconds: settle.seconds, travelM: settle.travelM, history: settle.history } }, previewDetail: detail };
  };
  const loadSource = async source => {
    requests.phase = `load ${source.name}`;
    const ok = await job(`window.__fossEarthPanoramaTest.scenes.load(${JSON.stringify(source.sceneId)}, { exampleId: true })`, 60_000, 250);
    if (!ok) throw new Error(`Could not load ${source.sceneId}`);
    return prepare(source);
  };

  let current = await prepare(SOURCES[0]);
  report.scene = { photograph: { entity: current.entity.id, ...current.prepared, previewDetail: current.previewDetail } };
  const g = current.prepared.markerGeodetic;
  console.log(`Marker at ${g.latitudeDeg.toFixed(6)}, ${g.longitudeDeg.toFixed(6)}, ${g.heightMeters.toFixed(1)} m; content rotation differs from the manifest's by ${current.prepared.contentDifference.toExponential(2)}`);
  if (current.prepared.contentDifference > 1e-9) fail(`The renderer's content rotation differs from the manifest pose by ${current.prepared.contentDifference}`);

  const traceSeconds = segments => segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const runTrace = (segments, options) => job(`window.__campus.runTrace(${JSON.stringify(segments)}, ${JSON.stringify(options)})`, (traceSeconds(segments) + 120) * 1000);

  // ─── 2. Correctness replay ──────────────────────────────────────────
  if (!flag("skip-correctness")) {
    console.log("Correctness replay…");
    requests.phase = "correctness";
    const run = await runTrace(trace, { probeEverySeconds: config.probeEverySeconds, correlate: true });
    const probes = run.probes;
    const failed = probes.filter(probe => probe.error);
    const measured = probes.filter(probe => !probe.error && probe.interior.pixels > 0);
    const worst = measured.reduce((a, b) => (!a || b.interior.maxDeg > a.interior.maxDeg ? b : a), null);
    const rayWorst = measured.reduce((max, probe) => Math.max(max, probe.ray?.orb.maxDeg ?? 0), 0);
    const endWorst = measured.reduce((a, b) => (!a || b.endToEnd.maxDeg / b.contentPerPixelDeg > a.endToEnd.maxDeg / a.contentPerPixelDeg ? b : a), null);
    report.correctness = {
      probes: probes.length, measured: measured.length, failedProbes: failed,
      interiorMaxDeg: worst?.interior.maxDeg ?? null, worst,
      rayMaxDeg: rayWorst,
      endToEnd: endWorst ? { maxDeg: endWorst.endToEnd.maxDeg, windowGain: endWorst.windowGain, contentPerPixelDeg: endWorst.contentPerPixelDeg, pixelShare: endWorst.endToEnd.maxDeg / endWorst.contentPerPixelDeg, segment: endWorst.segment, t: endWorst.t } : null,
      readbackRowOrder: [...new Set(measured.map(probe => probe.ray?.order))],
      coverage: measured.reduce((sum, probe) => ({
        edgePixels: sum.edgePixels + probe.coverage.edgePixels, gpuOnlyPixels: sum.gpuOnlyPixels + probe.coverage.gpuOnlyPixels,
        cpuOnlyPixels: sum.cpuOnlyPixels + probe.coverage.cpuOnlyPixels, drawnOutsideOrbPixels: sum.drawnOutsideOrbPixels + probe.coverage.drawnOutsideOrbPixels,
      }), { edgePixels: 0, gpuOnlyPixels: 0, cpuOnlyPixels: 0, drawnOutsideOrbPixels: 0 }),
      bySegment: Object.fromEntries(trace.map(segment => [segment.name, measured.filter(probe => probe.segment === segment.name)
        .reduce((a, probe) => ({ probes: a.probes + 1, maxDeg: Math.max(a.maxDeg, probe.interior.maxDeg), minDiameterPx: Math.min(a.minDiameterPx, probe.projectedDiameterPx), maxDiameterPx: Math.max(a.maxDiameterPx, probe.projectedDiameterPx) }),
          { probes: 0, maxDeg: 0, minDiameterPx: Infinity, maxDiameterPx: 0 })])),
      correlation: run.correlation,
      frames: run.frames.length,
    };
    await writeFile(path.join(out, "traces", "correctness-probes.json"), JSON.stringify(probes, null, 1));
    console.log(`  ${measured.length} of ${probes.length} probes measured; mapping max ${worst?.interior.maxDeg.toExponential(3)}° (tolerance ${config.toleranceDeg}°), `
      + `rays max ${rayWorst.toExponential(3)}° (tolerance ${config.rayToleranceDeg}°), end to end ${endWorst?.endToEnd.maxDeg.toExponential(3)}° at gain ${endWorst?.windowGain.toFixed(1)} = ${(100 * (endWorst?.endToEnd.maxDeg ?? 0) / (endWorst?.contentPerPixelDeg ?? 1)).toFixed(2)}% of a pixel`);
    console.log(`  correlation: ${JSON.stringify(run.correlation)}`);
    if (failed.length) fail(`${failed.length} probes failed: ${failed[0].error}`);
    if (measured.length < probes.length / 2) fail(`Only ${measured.length} of ${probes.length} probes saw the orb.`);
    if (!worst || worst.interior.maxDeg > config.toleranceDeg) fail(`GPU image directions differ from the CPU mapping of the same rays by up to ${worst?.interior.maxDeg}°.`);
    if (rayWorst > config.rayToleranceDeg) fail(`Pixels drew with rays up to ${rayWorst}° from the CPU's.`);
    if (endWorst && endWorst.endToEnd.maxDeg > config.endToEndPixelShare * endWorst.contentPerPixelDeg) fail(`End to end, the orb shows content ${endWorst.endToEnd.maxDeg}° away: over ${config.endToEndPixelShare} of a pixel.`);
    if (run.correlation.staleUniformFrames > 0) fail(`${run.correlation.staleUniformFrames} frames drew the orb with an earlier camera than the globe's.`);
    if (run.correlation.maxDrawVsLiveEyeM > 1e-3) fail(`An orb draw's eye was ${run.correlation.maxDrawVsLiveEyeM} m from the live camera's.`);

    // ─── 3. Negative control ──────────────────────────────────────────
    console.log("Negative control: uniforms one frame late…");
    requests.phase = "negative control";
    const control = await runTrace(CONTROL_TRACE, { probeEverySeconds: 0.5 * config.scale, correlate: true, delay: { segment: "control", frames: 1 } });
    const controlMeasured = control.probes.filter(probe => !probe.error && probe.interior.pixels > 0);
    const controlMax = controlMeasured.reduce((max, probe) => Math.max(max, probe.interior.maxDeg), 0);
    const rejected = controlMax > config.toleranceDeg;
    report.negativeControl = { delayFrames: 1, probes: control.probes.length, measured: controlMeasured.length, interiorMaxDeg: controlMax, rejectedByDirections: rejected, staleUniformFrames: control.correlation.staleUniformFrames, correlation: control.correlation };
    console.log(`  interior max ${controlMax.toFixed(4)}°: ${rejected ? "rejected, as it must be" : "NOT rejected"}; stale frames ${control.correlation.staleUniformFrames}`);
    if (!rejected) fail("The negative control passed the direction check: the check cannot see a one-frame-late orb.");
    if (control.correlation.staleUniformFrames === 0) fail("The negative control's late uniforms were not seen in the draw records.");

    // ─── 4. Pointer drags ─────────────────────────────────────────────
    console.log("Pointer drags…");
    requests.phase = "pointer drags";
    await page(`window.__campus.apply({ bearingDeg: 180, distanceM: 100, heightM: 3 })`);
    await job("window.__campus.frames(3)", 10_000, 100);
    const drags = [];
    for (const button of ["left", "right"]) {
      const before = await page("window.__fossEarthPanoramaTest.runtime.captureNavigationSnapshot()?.camera");
      const { width, height } = config.landscape;
      const from = { x: width / 2 + 160, y: height / 2 + 120 };
      const buttons = button === "left" ? 1 : 2;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button, buttons, clickCount: 1 });
      for (let step = 1; step <= 24; step++) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x - step * 12, y: from.y - step * 3, button, buttons });
        await sleep(16);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x - 288, y: from.y - 72, button, buttons: 0, clickCount: 1 });
      await sleep(1500);
      const after = await page("window.__fossEarthPanoramaTest.runtime.captureNavigationSnapshot()?.camera");
      const phase = await page("window.__campus.status().scene.phase");
      let probe = null;
      try { probe = await job(`window.__campus.probeOrb("drag-${button}", 0)`, 30_000, 100); } catch (error) { probe = { error: error.message }; }
      const moved = before && after && (Math.hypot(after.center.x - before.center.x, after.center.y - before.center.y, after.center.z - before.center.z) > 0.01
        || Math.abs(after.yaw - before.yaw) > 1e-4 || Math.abs(after.pitch - before.pitch) > 1e-4 || Math.abs(after.radius - before.radius) > 1e-3);
      drags.push({ button, cameraMoved: Boolean(moved), phaseAfter: phase, before, after, probe });
      const visible = probe && !probe.error && probe.interior?.pixels > 0;
      console.log(`  ${button} drag: camera ${moved ? "moved" : "did not move"}, phase ${phase}, ${visible ? `orb max ${probe.interior.maxDeg.toExponential(3)}°` : "orb not in view"}`);
      if (!moved) fail(`A ${button} drag did not move the globe camera.`);
      if (phase !== "overview") fail(`A ${button} drag changed the scene to ${phase}: a drag must never enter an orb.`);
      if (visible && probe.interior.maxDeg > config.toleranceDeg) fail(`After a ${button} drag the orb's directions differ by ${probe.interior.maxDeg}°.`);
    }
    report.pointerDrags = drags;
  }

  // ─── 5. Colour and screenshots ──────────────────────────────────────
  const faceCache = new Map();
  const faces = async (sceneId, representationId) => {
    const key = `${sceneId}/${representationId}`;
    if (faceCache.has(key)) return faceCache.get(key);
    const manifest = manifests[sceneId];
    const entity = manifest.entities.find(entry => entry.id === manifest.initialPanorama);
    const representation = manifest.assets.find(asset => asset.id === entity.assetId).representations.find(entry => entry.id === representationId);
    if (!representation?.faces) throw new Error(`${representationId} is not a cube representation`);
    const images = {};
    for (const [face, file] of Object.entries(representation.faces)) images[face] = decodeJpeg(await readFile(path.join(dist, "examples/panorama-scenes", file)));
    faceCache.set(key, images);
    return images;
  };
  const sampleFace = (image, u, v) => {
    const x = Math.min(image.width - 1, Math.max(0, u * image.width - 0.5));
    const y = Math.min(image.height - 1, Math.max(0, v * image.height - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const at = (px, py, c) => image.rgba[(py * image.width + px) * 4 + c];
    return [0, 1, 2].map(c => (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy);
  };
  if (!flag("skip-colour")) {
    console.log("Colour and orientation…");
    report.colour = [];
    for (const source of SOURCES) {
      if (source === SOURCES[0]) requests.phase = "colour photograph";
      else {
        current = await loadSource(source);
        report.scene[source.name] = { entity: current.entity.id, ...current.prepared, previewDetail: current.previewDetail };
      }
      for (const [orientation, viewport] of [["landscape", config.landscape], ["portrait", config.portrait]]) {
        await setViewport(viewport);
        await sleep(400);
        for (const view of VIEWS) {
          // The orb follows the displayed ground, which refines after a viewport change or a
          // new pose. The reference is taken a moment before the screenshot, so both need the
          // marker to hold still: wait for it, pose, and take the pair again if it moved.
          const markerNow = () => page(`window.__fossEarthPanoramaTest.renderer.inspectOrb(${JSON.stringify(current.entity.id)}).marker`);
          let samples, shot, markerMovedM;
          for (let attempt = 0; attempt < 3; attempt++) {
            await page(`window.__campus.apply(${JSON.stringify(view.pose)})`);
            await job("window.__campus.settleMarker(1000, 0.05, 30000)", 40_000, 250);
            await page(`window.__campus.apply(${JSON.stringify(view.pose)})`);
            await job("window.__campus.frames(4)", 10_000, 100);
            const markerBefore = await markerNow();
            samples = await page(`window.__campus.colourSamples(${config.colourStepCssPx})`);
            shot = await send("Page.captureScreenshot", { format: "png" });
            const markerAfter = await markerNow();
            markerMovedM = Math.hypot(...markerAfter.map((value, i) => value - markerBefore[i]));
            if (markerMovedM <= 0.05) break;
          }
          if (markerMovedM > 0.05) fail(`${source.name} looking ${view.name} (${orientation}): the marker kept moving, ${markerMovedM.toFixed(2)} m between the reference and the screenshot.`);
          const detail = await page(`window.__campus.status().scene.entries.find(e => e.id === ${JSON.stringify(current.entity.id)}).previewDetail`);
          const name = `${source.name}-${view.name}-${orientation}.png`;
          const png = Buffer.from(shot.data, "base64");
          await writeFile(path.join(out, "screenshots", name), png);
          const screen = decodePng(png);
          const images = await faces(source.sceneId, detail.representation);
          // Each alternative orientation is judged only where it predicts a clearly different colour.
          const difference = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
          const rows = samples.samples.map(sample => {
            const px = Math.min(screen.width - 1, Math.floor(sample.x * samples.devicePixelRatio));
            const py = Math.min(screen.height - 1, Math.floor(sample.y * samples.devicePixelRatio));
            const shown = [0, 1, 2].map(c => screen.rgba[(py * screen.width + px) * 4 + c]);
            const expected = Object.fromEntries(Object.entries(sample.lookups).map(([hypothesis, lookup]) => [hypothesis, sampleFace(images[lookup.face], lookup.u, lookup.v)]));
            return { shown, expected };
          });
          const overall = rows.reduce((sum, row) => sum + difference(row.shown, row.expected.correct), 0) / Math.max(1, rows.length);
          const alternatives = {};
          for (const hypothesis of Object.keys(samples.samples[0]?.lookups ?? {}).filter(key => key !== "correct")) {
            const distinct = rows.filter(row => difference(row.expected.correct, row.expected[hypothesis]) > config.colourDistinctLevels);
            const correct = distinct.reduce((sum, row) => sum + difference(row.shown, row.expected.correct), 0) / Math.max(1, distinct.length);
            const alternative = distinct.reduce((sum, row) => sum + difference(row.shown, row.expected[hypothesis]), 0) / Math.max(1, distinct.length);
            const distinguishable = distinct.length >= config.colourMinimumDistinctPixels;
            alternatives[hypothesis] = { distinctPixels: distinct.length, correctError: correct, alternativeError: alternative, distinguishable, rejected: distinguishable && correct < 0.5 * alternative };
          }
          const untested = Object.entries(alternatives).filter(([, entry]) => !entry.distinguishable).map(([name]) => name);
          const accepted = Object.entries(alternatives).filter(([, entry]) => entry.distinguishable && !entry.rejected).map(([name]) => name);
          const passed = rows.length >= 50 && accepted.length === 0 && alternatives.mirrored?.distinguishable === true;
          const nearestName = accepted[0] ?? untested[0] ?? "none";
          report.colour.push({ source: source.name, view: view.name, note: view.note, orientation, viewport, screenshot: `screenshots/${name}`, representation: detail.representation,
            samples: rows.length, orbDiameterCssPx: samples.radiusCss * 2, markerMovedM, meanAbsoluteError: overall, alternatives, notRejected: accepted, indistinguishable: untested, passed });
          const worstRatio = Math.max(...Object.values(alternatives).filter(entry => entry.distinguishable).map(entry => entry.correctError / Math.max(1e-9, entry.alternativeError)));
          console.log(`  ${source.name} ${view.name} ${orientation}: ${rows.length} samples, error ${overall.toFixed(1)}; worst correct/alternative ratio ${worstRatio.toFixed(2)}${untested.length ? `; cannot tell from ${untested.join(", ")}` : ""} ${passed ? "✓" : "✗"}`);
          if (!passed) fail(`${source.name} looking ${view.name} (${orientation}) is not told apart from ${nearestName}.`);
        }
      }
    }
    await setViewport(config.landscape);
    await sleep(400);
    if (current.entity.id !== manifests[SOURCES[0].sceneId].initialPanorama) current = await loadSource(SOURCES[0]);
  }

  // ─── 6. Timing ──────────────────────────────────────────────────────
  const intervalsOf = run => {
    const byName = {};
    const motion = [];
    const resumes = [];
    const renderStartDelays = [];
    for (let i = 1; i < run.frames.length; i++) {
      const [t, , index] = run.frames[i];
      const [tPrevious, , previousIndex] = run.frames[i - 1];
      const segment = run.segments[index];
      const kind = trace.find(entry => entry.name === segment)?.type;
      const previousKind = trace.find(entry => entry.name === run.segments[previousIndex])?.type;
      const interval = t - tPrevious;
      // A deliberate idle gap is not motion; the first frame after it is measured on its own.
      if (kind === "stop") continue;
      if (previousKind === "stop") { resumes.push({ segment, intervalMs: interval }); continue; }
      (byName[segment] ??= []).push(interval);
      motion.push(interval);
      if (run.frames[i][3] !== undefined) renderStartDelays.push(run.frames[i][3]);
    }
    return { motion, byName, resumes, renderStartDelays };
  };
  const stats = values => {
    if (values.length === 0) return null;
    const sorted = Float64Array.from(values).sort();
    const at = rank => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * rank))];
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    return { frames: sorted.length, meanMs: mean, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: sorted[sorted.length - 1], over33Ms: values.filter(v => v > 33.3).length, over100Ms: values.filter(v => v > 100).length };
  };
  const within = s => s && s.p95Ms <= config.budget.p95Ms && s.p99Ms <= config.budget.p99Ms && s.maxMs <= config.budget.maxIntervalMs;
  if (!flag("skip-timing")) {
    // The map stays at the detail asked for while frames are timed. Automatic detail would
    // lighten it after slow frames, such as the screenshots', and held at the cap it never
    // returns, so the runs would not draw the same map, nor the one asked for.
    const coarserBefore = await page("window.__campus.detail.hold()");
    console.log(`Timing: automatic map detail off, the map at the detail asked for (it had been ${coarserBefore} levels coarser); warm-up pass…`);
    requests.phase = "timing warm-up";
    await runTrace(WARMUP_TRACE, { correlate: false });
    const traceFrames = Math.ceil(traceSeconds(trace) * config.fps * 1.25);
    const timed = async (name, { profiled, correlate }) => {
      requests.phase = `timing ${name}`;
      // Timed once the map has stopped streaming: the warm-up loaded what the trace shows.
      const settle = await job("window.__campus.settleMarker(2000, 0.05, 90000)", 100_000, 250);
      const startedAt = await page("performance.now()");
      const streamingBefore = await page("window.__campus.streaming()");
      if (profiled) await page(`window.__campus.profile.start(${traceFrames})`);
      const run = await runTrace(trace, { correlate });
      const profile = profiled ? await page("window.__campus.profile.stop()") : null;
      const streamingAfter = await page("window.__campus.streaming()");
      const detailChanges = await page(`window.__campus.detail.changes(${startedAt})`);
      const { motion, byName, resumes, renderStartDelays } = intervalsOf(run);
      const result = {
        profiled, motion: stats(motion),
        // From the animation frame's start to the scene render's: the map's own work in the frame, which does not move the frame's time.
        renderStartDelay: stats(renderStartDelays), bySegment: Object.fromEntries(Object.entries(byName).map(([key, values]) => [key, stats(values)])),
        firstFrameAfterResume: resumes, resumeLatency: run.resumes, correlation: correlate ? run.correlation : null,
        streaming: { before: streamingBefore, after: streamingAfter }, requests: requests.byPhase[requests.phase] ?? null,
        mapDetail: { streamingStoppedBefore: settle.settled, waitedSeconds: settle.seconds, changesDuring: detailChanges },
        profiler: profile ? { gpu: profile.gpu, frames: profile.summary.frames, frame: profile.summary.frame, measuredMeanMs: profile.summary.measuredMeanMs, sections: profile.summary.sections } : null,
      };
      await writeFile(path.join(out, "traces", `timing-${name}-frames.json`), JSON.stringify({ segments: run.segments, frames: run.frames }));
      if (profile) await writeFile(path.join(out, "traces", `timing-${name}-profile.json`), JSON.stringify(profile.trace));
      const m = result.motion;
      console.log(`  ${name}: ${m.frames} motion frames, p50 ${m.p50Ms.toFixed(2)} p95 ${m.p95Ms.toFixed(2)} p99 ${m.p99Ms.toFixed(2)} max ${m.maxMs.toFixed(1)} ms; >100 ms: ${m.over100Ms}; ${within(m) ? "within" : "OUTSIDE"} the budget`);
      if (!settle.settled) console.log(`    the map was still streaming when this run started, after ${settle.seconds.toFixed(0)} s`);
      if (detailChanges.length > 0) fail(`Map detail changed during the ${name} run although automatic adjustment was off.`);
      return result;
    };
    report.timing = { mapDetail: { automatic: "off while timing", levelsCoarserBefore: coarserBefore } };
    report.timing.shown = await timed("shown", { profiled: true, correlate: true });
    console.log("  hiding the orb: unloading the scene…");
    await page("window.__fossEarthPanoramaTest.scenes.unload()");
    await job("window.__campus.frames(10)", 10_000, 100);
    report.timing.hidden = await timed("hidden", { profiled: true, correlate: false });
    current = await loadSource(SOURCES[0]);
    await runTrace(WARMUP_TRACE.slice(0, 1), { correlate: false });
    report.timing.shownUnprofiled = await timed("shown-unprofiled", { profiled: false, correlate: true });
    await page("window.__campus.detail.release()");
    const { shown, hidden, shownUnprofiled } = report.timing;
    report.timing.orbIncrement = {
      p50Ms: shown.motion.p50Ms - hidden.motion.p50Ms, p95Ms: shown.motion.p95Ms - hidden.motion.p95Ms, p99Ms: shown.motion.p99Ms - hidden.motion.p99Ms,
      note: "Shown minus hidden on the same trace; a difference of distributions, not a cost the orb alone causes.",
    };
    report.timing.profilingOverhead = { p50Ms: shown.motion.p50Ms - shownUnprofiled.motion.p50Ms, p95Ms: shown.motion.p95Ms - shownUnprofiled.motion.p95Ms, note: "Profiled minus unprofiled, orb shown." };
    report.timing.budget = config.budget;
    report.timing.shownWithinBudget = within(shown.motion) && within(shownUnprofiled.motion);
    report.timing.hiddenWithinBudget = within(hidden.motion);
    if (!report.timing.hiddenWithinBudget) fail("The globe alone, with no orb, misses the frame budget on this trace (reported separately from the orb).");
    if (!report.timing.shownWithinBudget) fail("With the orb shown, the frame interval misses the budget.");
    for (const run of [shown, shownUnprofiled]) {
      if (run.correlation?.staleUniformFrames > 0) fail(`Timing run drew ${run.correlation.staleUniformFrames} orb frames with an earlier camera.`);
      if (run.requests?.panoramaMedia > 0) fail(`The orb requested panorama images ${run.requests.panoramaMedia} times while the camera moved.`);
    }
  }
  // ─── 7. Entering, links, Back and Exit ──────────────────────────────
  if (!flag("skip-navigation")) {
    console.log("Entering, links, Back and Exit…");
    const navigation = {};
    const snapshot = () => page("window.__fossEarthPanoramaTest.runtime.captureNavigationSnapshot()?.camera");
    // Exit flies back out of the orb (scene.panorama.flightDuration, on by default): it ends facing the way the
    // view faced, centred on the orb, at the pitch, distance and field of view the panorama was entered from.
    const facing = () => page("window.__fossEarthPanoramaTest.scenes.handle().status.view.headingDeg");
    const pulledOut = (difference, after, facedDeg) => {
      if (!difference || !after || typeof facedDeg !== "number") return false;
      const turn = Math.abs(((((after.yaw - (facedDeg * Math.PI) / 180) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      // The globe camera's heading is about the geocentric vertical, the view's about the geodetic: up to 0.2° apart.
      return difference.pitchRad < 1e-6 && difference.radiusM < 1e-3 && difference.fovRad < 1e-6 && turn < 0.01;
    };
    const act = async (label, expression) => {
      const result = await job(`window.__fossEarthPanoramaTest.scenes.handle().${expression}`, 60_000, 100);
      if (!result?.ok) throw new Error(`${label}: ${JSON.stringify(result)}`);
    };
    const immersion = async (entity, label) => {
      await job(`window.__campus.until(s => s.phase === "immersive" && s.active === ${JSON.stringify(entity.id)}, 30000)`, 40_000, 100);
      await job("window.__campus.frames(10)", 10_000, 100);
      const probe = await job(`window.__campus.probeImmersion(${JSON.stringify(entity.capture)}, ${JSON.stringify(entity.imagePose)})`, 60_000, 250);
      console.log(`  ${label}: immersion max ${probe.maxDeg.toExponential(3)}° over ${probe.pixels} pixels`);
      if (probe.maxDeg > config.toleranceDeg) fail(`${label}: the immersion's directions differ from the CPU rays by ${probe.maxDeg}°.`);
      return probe;
    };

    // The photograph above the campus: enter it, check what it draws, exit.
    current = await loadSource(SOURCES[0]);
    await page(`window.__campus.apply({ bearingDeg: 180, distanceM: 100, heightM: 3 })`);
    await job("window.__campus.frames(3)", 10_000, 100);
    let before = await snapshot();
    const chips = () => page("window.__campus.hudChips()");
    const chipsInOverview = await chips();
    await act("enter", `enter(${JSON.stringify(current.entity.id)})`);
    navigation.single = { immersion: await immersion(current.entity, "umn-single entered") };
    const chipsInside = await chips();
    let faced = await facing();
    await act("exit", "exit()");
    await job(`window.__campus.until(s => s.phase === "overview", 30000)`, 40_000, 100);
    navigation.single.cameraAfterExit = await page(`window.__campus.cameraDifference(${JSON.stringify(before)})`);
    navigation.single.facedDeg = faced;
    console.log(`  exit pulls out facing ${faced}°: ${JSON.stringify(navigation.single.cameraAfterExit)}`);
    if (!pulledOut(navigation.single.cameraAfterExit, await snapshot(), faced)) fail("Exit did not end facing the way the view faced, at the pitch, distance and field of view it was entered from.");
    // The panorama's tab, the way out, and its credit are there only while a panorama is entered.
    navigation.single.hudChips = { overview: chipsInOverview, immersive: chipsInside, afterExit: await chips() };
    const { overview: o, immersive: i, afterExit: x } = navigation.single.hudChips;
    console.log(`  Panorama tab: overview ${o.exit}; entered ${i.exit} ("${i.exitText}"), credits ${i.credits}; after Exit ${x.exit}, credits ${x.credits}`);
    if (o.exit || x.exit) fail("The panorama's tab shows in the overview, where there is nothing to leave.");
    if (!i.exit) fail("The panorama's tab is missing while a panorama is entered.");
    if (i.credits < 1) fail("The photograph's credit is missing while it is on screen.");
    if (o.credits > 0 || x.credits > 0) fail("A panorama credit shows in the overview.");

    // The pair: enter A, follow its link to B, Back to A, Exit to the overview.
    const pair = await loadSource(PAIR);
    const manifest = manifests[PAIR.sceneId];
    const a = manifest.entities.find(entry => entry.id === manifest.initialPanorama);
    const link = a.links[0];
    const b = manifest.entities.find(entry => entry.id === link.target);
    before = await snapshot();
    await act("enter A", `enter(${JSON.stringify(a.id)})`);
    navigation.pair = { a: await immersion(a, `${a.id} entered`) };
    await act("follow", `follow(${JSON.stringify(link.id)})`);
    navigation.pair.b = await immersion(b, `${b.id} after following ${link.id}`);
    await page("history.back(), true");
    await job(`window.__campus.until(s => s.phase === "immersive" && s.active === ${JSON.stringify(a.id)}, 30000)`, 40_000, 100);
    navigation.pair.backReturnsToA = true;
    console.log(`  Back returns to ${a.id}`);
    faced = await facing();
    await act("exit", "exit()");
    await job(`window.__campus.until(s => s.phase === "overview", 30000)`, 40_000, 100);
    navigation.pair.cameraAfterExit = await page(`window.__campus.cameraDifference(${JSON.stringify(before)})`);
    navigation.pair.facedDeg = faced;
    console.log(`  Exit from the pair pulls out facing ${faced}°: ${JSON.stringify(navigation.pair.cameraAfterExit)}`);
    if (!pulledOut(navigation.pair.cameraAfterExit, await snapshot(), faced)) fail("Exit from the pair did not end facing the way the view faced, at the pitch, distance and field of view it was entered from.");
    navigation.pair.entity = pair.entity.id;
    report.navigation = navigation;
  }
} catch (error) {
  failures.push(`The check stopped: ${error.message}`);
  console.error(error);
  try {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(out, "screenshots", "stopped.png"), Buffer.from(shot.data, "base64"));
  } catch { /* the page is gone */ }
} finally {
  report.requests = requests.byPhase;
  report.exceptions = exceptions;
  try { report.mapDetailChanges = await page("window.__campus?.detail.changes() ?? null"); } catch { /* the page is gone */ }
  await chrome.close();
}

// ─── Report ───────────────────────────────────────────────────────────
report.failures = failures;
const configuration = report.environment
  ? `${report.environment.adapter?.vendor ?? "unknown"} ${report.environment.adapter?.architecture ?? ""} (${report.environment.adapter?.description || "no description"}), `
    + `${report.browser.product}, WebGPU, ${config.landscape.width}×${config.landscape.height} at DPR ${config.dpr}, ${config.fps} fps cap, `
    + `${report.environment.map?.basemap ?? "?"} imagery with ${report.environment.map?.elevation ?? "?"} elevation`
  : "no WebGPU configuration";
report.configuration = configuration;
report.verdict = failures.length === 0
  ? `automated check passed on ${configuration}; manual acceptance pending`
  : `automated check FAILED on ${configuration}: ${failures.length} failure(s)`;
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 1));

const fmt = (value, digits = 2) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—");
const lines = [
  "# Panorama campus check", "", `**${report.verdict}.**`, "",
  `Generated ${report.generatedAt} from commit ${inputs.commit ?? "unknown"}${inputs.uncommittedFiles ? ` with ${inputs.uncommittedFiles} uncommitted files` : ""}.`, "",
  "## Configuration", "",
  `- Browser: ${report.browser.product}; renderer ${report.environment?.renderer ?? "?"}; GPU timing ${report.environment?.gpuTiming ? "available" : "unavailable"}.`,
  `- Adapter: ${JSON.stringify(report.environment?.adapter ?? null)}; hardware verified: ${report.hardwareVerified ? "yes" : "no"}.`,
  `- Map: ${JSON.stringify(report.environment?.map ?? null)}.`,
  `- Viewports ${config.landscape.width}×${config.landscape.height} and ${config.portrait.width}×${config.portrait.height} at DPR ${config.dpr}; ${config.fps} fps cap; flat window ${config.previewFovDeg}°; direct rendering, no cache.`, "",
];
if (report.coldLoad) lines.push("## Cold load", "", `App ${fmt(report.coldLoad.appMs, 0)} ms, scene ${fmt(report.coldLoad.sceneMs, 0)} ms, marker placed ${fmt(report.coldLoad.markerPlacedMs, 0)} ms, preview ready ${fmt(report.coldLoad.previewReadyMs, 0)} ms after navigation.`, "");
if (report.correctness) {
  const c = report.correctness;
  lines.push("## Directions", "",
    `${c.measured} of ${c.probes} probes saw the orb, each reading back one frame's rays and sampled image directions.`, "",
    `- Mapping: the CPU window and pose applied to each pixel's GPU ray differ from the direction the GPU sampled by at most **${c.interiorMaxDeg?.toExponential(3)}°** (tolerance ${config.toleranceDeg}°), in ${c.worst?.segment} at ${fmt(c.worst?.t, 1)} s.`,
    `- Rays: each pixel's GPU ray is within ${c.rayMaxDeg.toExponential(3)}° of the CPU's pixel-centre ray (tolerance ${config.rayToleranceDeg}°).`,
    `- End to end: the CPU mapping of the CPU ray differs by at most ${c.endToEnd?.maxDeg.toExponential(3)}°. The flat window magnifies ray differences by ${fmt(c.endToEnd?.windowGain, 1)} there, and that is ${fmt(100 * (c.endToEnd?.pixelShare ?? 0), 2)}% of the panorama one pixel shows (limit ${100 * config.endToEndPixelShare}%).`, "",
    `Coverage, reported apart: ${c.coverage.edgePixels} edge pixels, ${c.coverage.gpuOnlyPixels} drawn where the reference has no orb, ${c.coverage.cpuOnlyPixels} missing where it has, ${c.coverage.drawnOutsideOrbPixels} outside the orb's square.`,
    `Draws: ${c.correlation.orbDrawFrames} frames drew the orb, ${c.correlation.staleUniformFrames} with an earlier camera; largest eye difference between a draw and the live camera ${c.correlation.maxDrawVsLiveEyeM.toExponential(2)} m.`, "");
}
if (report.negativeControl) lines.push(`Negative control (uniforms one frame late): interior difference up to ${fmt(report.negativeControl.interiorMaxDeg, 4)}°, ${report.negativeControl.rejectedByDirections ? "rejected" : "**not rejected**"}; ${report.negativeControl.staleUniformFrames} stale frames seen.`, "");
if (report.colour) {
  lines.push("## Colour and orientation", "", "| Source | View | Orientation | Samples | Error | Mirrored: pixels, error as drawn / as mirrored | Result |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of report.colour) {
    const m = entry.alternatives.mirrored;
    lines.push(`| ${entry.source} | ${entry.view} | ${entry.orientation} | ${entry.samples} | ${fmt(entry.meanAbsoluteError, 1)} | ${m ? `${m.distinctPixels}, ${fmt(m.correctError, 1)} / ${fmt(m.alternativeError, 1)}` : "—"} | ${entry.passed ? "pass" : "fail"} |`);
  }
  lines.push("", "Error is the mean absolute difference, 0–255, between the screenshot and the source sampled at the CPU direction. Each wrong orientation (mirrored, turned 90°, 180°, 270°) is judged only on the pixels where it predicts a colour more than "
    + `${config.colourDistinctLevels} levels from the correct one, and must fit them less than half as well.`, "");
}
if (report.timing) {
  lines.push("## Frame intervals during motion", "", "| Run | Frames | p50 ms | p95 ms | p99 ms | Max ms | >100 ms |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const [name, run] of [["orb shown", report.timing.shown], ["orb hidden", report.timing.hidden], ["shown, profiling off", report.timing.shownUnprofiled]]) {
    const m = run.motion;
    lines.push(`| ${name} | ${m.frames} | ${fmt(m.p50Ms)} | ${fmt(m.p95Ms)} | ${fmt(m.p99Ms)} | ${fmt(m.maxMs, 1)} | ${m.over100Ms} |`);
  }
  const runs = [report.timing.shown, report.timing.hidden, report.timing.shownUnprofiled];
  lines.push("", `Every run drew the map at the detail asked for, with automatic adjustment off; before timing, the slow screenshot frames had led it to coarsen the map ${report.timing.mapDetail.levelsCoarserBefore} levels, which it does not undo while frames are held at the cap. Each run started once the map had stopped streaming${runs.every(run => run.mapDetail.streamingStoppedBefore) ? "" : " (except where the report says otherwise)"}.`);
  lines.push("", `Budget: p95 ≤ ${config.budget.p95Ms} ms, p99 ≤ ${config.budget.p99Ms} ms, none over ${config.budget.maxIntervalMs} ms. First frames after the stop: ${report.timing.shown.firstFrameAfterResume.map(entry => `${fmt(entry.intervalMs, 1)} ms`).join(", ")} (excluded from motion).`, "");
}
if (report.navigation) {
  const n = report.navigation;
  const camera = d => (d ? `pitch ${d.pitchRad.toExponential(1)} rad, distance ${d.radiusM.toExponential(1)} m and field of view ${d.fovRad.toExponential(1)} rad of the view it was entered from` : "not measured");
  lines.push("## Entering, links, Back and Exit", "",
    `- The entered photograph's immersion differs from the CPU rays by up to ${n.single?.immersion.maxDeg.toExponential(3)}°; after Exit the globe camera faces ${n.single?.facedDeg}°, as the view did, within ${camera(n.single?.cameraAfterExit)}.`,
    `- The pair: A entered ${n.pair?.a.maxDeg.toExponential(3)}°, B after the link ${n.pair?.b.maxDeg.toExponential(3)}°; Back returned to A: ${n.pair?.backReturnsToA ? "yes" : "no"}; after Exit the camera faces ${n.pair?.facedDeg}°, within ${camera(n.pair?.cameraAfterExit)}.`,
    `- The panorama's tab, as laid out: ${n.single?.hudChips ? `hidden in the overview ${!n.single.hudChips.overview.exit ? "yes" : "no"}, shown while entered ${n.single.hudChips.immersive.exit ? "yes" : "no"}, hidden after Exit ${!n.single.hudChips.afterExit.exit ? "yes" : "no"}; credits while entered: ${n.single.hudChips.immersive.credits}` : "not checked"}.`, "");
}
if (failures.length) lines.push("## Failures", "", ...failures.map(entry => `- ${entry}`), "");
await writeFile(path.join(out, "summary.md"), lines.join("\n"));
console.log(`\n${report.verdict}`);
console.log(`Report: ${path.relative(root, path.join(out, "report.json"))}`);
process.exitCode = failures.length === 0 ? 0 : 1;
