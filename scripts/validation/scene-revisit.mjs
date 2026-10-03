#!/usr/bin/env node
/**
 * What a visit to a scene downloads, and what it downloads again
 * (docs/scenes/format.md, "Saved images"). Opens the app in headless Chrome on
 * this machine's GPU with a profile it keeps between its browsers, and counts
 * every image request that leaves the page:
 *
 *   first visit   the map until its orbs' previews stop arriving
 *   reload        the same page reloaded
 *   look          inside a panorama: a view, turns away through --headings, and back
 *   revisit       a new browser on the same profile: the map, then the same looks
 *   cleared       after "Clear saved images": the map once more
 *
 * A build is served to the page by intercepting its requests, with no server
 * and no HTTP cache headers, so a file the app does not keep itself is asked
 * for every time: after the first visit, the reload, the look back and the
 * revisit must ask for nothing, and the cleared visit must ask again. The same
 * run with `--set=scene.panorama.savedMiB=0` is the control: it keeps nothing
 * and must fail those checks. `--latency` holds every response for that long,
 * as a connection's round trip does, so the app's own request limits show.
 *
 * With `--url` it reads a live site instead, from Chrome's network events,
 * where the browser's HTTP cache and the host's headers take part; then it
 * reports and checks nothing, and `--wait-min` lets the host's cached copies
 * go stale before the revisit.
 *
 *   node scripts/validation/scene-revisit.mjs
 *   node scripts/validation/scene-revisit.mjs --dist=../UMN-VR/UMN-VR.github.io/dist-app \
 *     --content=../UMN-VR/UMN-VR.github.io/public --page=/tour/twin-cities/ --scene= --orb=northrop-mall
 *   node scripts/validation/scene-revisit.mjs --url=https://umn-vr.github.io/tour/twin-cities/ --scene= --orb=northrop-mall --wait-min=11
 *
 *   [--out=<folder>] [--dist=<a build>] [--no-build] [--content=<folder>] [--page=/] [--scene=umn-tiles] [--orb=umn-tiles-orb]
 *   [--renderer=webgpu|webgl2|webgl1] [--viewport=1512x900@2] [--headings=0,90,180,270,0] [--latency=0] [--wait-min=0]
 *   [--set=<parameter>=<value>,…] [--phases=first,reload,look,revisit,cleared]
 *
 * Output: build/validation/scene-revisit/<date>_<time>/ with report.json and summary.md.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);

const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "scene-revisit");
await mkdir(out, { recursive: true });
// Chrome and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;

const liveUrl = arg("url", null);
const [size, ratio = "1"] = arg("viewport", "1512x900@2").split("@");
const [width, height] = size.split("x").map(Number);
const config = {
  live: liveUrl,
  page: arg("page", "/"),
  scene: arg("scene", "umn-tiles"),
  orb: arg("orb", "umn-tiles-orb"),
  renderer: arg("renderer", "webgpu"),
  viewport: { width, height, devicePixelRatio: Number(ratio) },
  headings: arg("headings", "0,90,180,270,0").split(",").map(Number),
  latencyMs: Number(arg("latency", "0")),
  waitMinutes: Number(arg("wait-min", "0")),
  phases: arg("phases", "first,reload,look,revisit,cleared").split(","),
  settings: Object.fromEntries(arg("set", "").split(",").filter(Boolean).map(pair => { const at = pair.indexOf("="); return [pair.slice(0, at), pair.slice(at + 1)]; })),
  userAgentSuffix: "foss-earth-check/1.0",
};

// ─── Build ────────────────────────────────────────────────────────────
const dist = liveUrl ? null : arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
if (!liveUrl && !arg("dist") && !flag("no-build")) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const content = arg("content") ? path.resolve(arg("content")) : null;
/** Files the page asks for: the app's build, then the content folder, when the scene is served apart from it. */
async function served(relative) {
  for (const base of [dist, content].filter(Boolean)) {
    const file = path.join(base, relative);
    try { if (file.startsWith(base) && (await stat(file)).isFile()) return file; } catch { /* the next folder */ }
  }
  return null;
}

const ORIGIN = "https://foss-earth.test";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
const T = "window.__fossEarthPanoramaTest";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isMedia = url => /\/media\//.test(url);
// A tile is <folder>/<face>/<level>/<x>/<y>; a preview face <folder>/<face>.
const kindOf = url => (/\/[np][xyz]\/\d+\/\d+\/\d+\.\w+$/.test(url) ? "tiles" : /preview-\d+/.exec(url)?.[0] ?? /immersion-\d+/.exec(url)?.[0] ?? (/previews-\d+(-\d+)?\.\w+$/.test(url) ? "preview sheet" : "other"));
const report = { config, browser: null, gpu: null, phases: [], failures: [] };
const profile = path.join(out, "chrome-profile");

/** One browser on the kept profile. `work` gets the page and the requests that left it. */
async function withBrowser(work) {
  const chrome = await openHeadlessChrome(profile, arg("chrome") ?? process.env.CHROME_BIN, ["--enable-webgpu-developer-features", ...(config.renderer === "webgl1" ? ["--disable-webgl2"] : [])]);
  try {
    const version = await chrome.send("Browser.getVersion");
    report.browser = version.product;
    try { report.gpu ??= (await chrome.send("SystemInfo.getInfo")).gpu?.auxAttributes?.glRenderer ?? null; } catch { /* reported as unknown */ }
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const page = expression => evaluate(chrome, sessionId, expression);
    /** Requests that left the page: every one a build's page makes, or a live page's as Chrome reports them. */
    const requests = [];
    const byId = new Map();
    const errors = [];
    const off = chrome.onEvent(message => {
      if (message.sessionId !== sessionId) return;
      const p = message.params;
      if (message.method === "Runtime.exceptionThrown") errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
      else if (message.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push(p.args.map(entry => entry.value ?? entry.description).join(" "));
      else if (liveUrl && message.method === "Network.requestWillBeSent") {
        const entry = { url: p.request.url, started: Date.now(), done: null, bytes: 0, cached: false, status: null, body: NaN };
        byId.set(p.requestId, entry);
        requests.push(entry);
      } else if (liveUrl && message.method === "Network.requestServedFromCache") { const entry = byId.get(p.requestId); if (entry) entry.cached = true; }
      else if (liveUrl && message.method === "Network.responseReceived") {
        const entry = byId.get(p.requestId);
        if (entry) { entry.status = p.response.status; entry.cached ||= p.response.fromDiskCache === true; entry.body = Number(p.response.headers["content-length"] ?? p.response.headers["Content-Length"] ?? NaN); }
      } else if (liveUrl && message.method === "Network.loadingFinished") { const entry = byId.get(p.requestId); if (entry) { entry.bytes = p.encodedDataLength; entry.done = Date.now(); } }
      else if (liveUrl && message.method === "Network.loadingFailed") { const entry = byId.get(p.requestId); if (entry) { entry.failed = true; entry.done = Date.now(); } }
      else if (!liveUrl && message.method === "Fetch.requestPaused") {
        void (async () => {
          const { requestId, request } = p;
          const url = new URL(request.url);
          // Only the app's own files: no map, no other host.
          if (url.origin !== ORIGIN) { await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return; }
          const entry = { url: request.url, started: Date.now(), done: null, bytes: 0, cached: false, status: null };
          requests.push(entry);
          const file = await served(decodeURIComponent(url.pathname).slice(1) + (url.pathname.endsWith("/") ? "index.html" : ""));
          const body = file ? await readFile(file) : null;
          if (config.latencyMs > 0) await sleep(config.latencyMs);
          entry.done = Date.now();
          entry.status = body ? 200 : 404;
          entry.bytes = body?.length ?? 0;
          if (!body) { await send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" }); return; }
          // No cache headers: what the app does not keep itself is asked for again.
          await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: MIME[path.extname(file)] ?? "application/octet-stream" }, { name: "Cache-Control", value: "no-store" }], body: body.toString("base64") });
        })().catch(error => errors.push(`interception: ${error.message}`));
      }
    });
    await send("Runtime.enable");
    await send("Page.enable");
    if (liveUrl) await send("Network.enable");
    else await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await send("Emulation.setUserAgentOverride", { userAgent: `${version.userAgent} ${config.userAgentSuffix}` });
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: config.viewport.devicePixelRatio, mobile: config.viewport.devicePixelRatio > 2 });
    try {
      await work({ send, page, requests, errors });
    } finally {
      off();
      await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
    }
  } finally {
    await chrome.close();
  }
}

/** The image requests since `since`, and for a live site where their bytes came from. */
function tally(requests, since) {
  const media = requests.filter(entry => entry.started >= since && isMedia(entry.url));
  const fromCache = media.filter(entry => entry.cached && !entry.bytes);
  const revalidated = media.filter(entry => !fromCache.includes(entry) && (entry.status === 304 || (entry.bytes > 0 && Number.isFinite(entry.body) && entry.bytes < entry.body / 2)));
  const network = media.filter(entry => !fromCache.includes(entry) && !revalidated.includes(entry));
  const byKind = {};
  for (const entry of network.concat(revalidated)) byKind[kindOf(entry.url)] = (byKind[kindOf(entry.url)] ?? 0) + 1;
  const sum = list => list.reduce((total, entry) => total + (entry.bytes ?? 0), 0);
  return {
    // Requests that reached the network: for a build, every request the page made.
    requests: network.length + revalidated.length, bytes: sum(network) + sum(revalidated),
    ...(liveUrl ? { downloaded: network.length, revalidated: revalidated.length, browserCache: fromCache.length } : {}),
    byKind,
  };
}

const saved = page => page(`${T}.media ? ${T}.media.inspect().then(s => ({ available: s.available, problem: s.problem, files: s.files, bytes: s.bytes, images: s.groups.length, reused: s.reused, added: s.added })) : null`);

/** Waits for the scene's orbs: the first preview, every preview, and the last image request. */
async function mapPhase(name, { page, requests, errors }, navigate) {
  const started = Date.now();
  await navigate();
  let first = null, all = null, orbs = 0;
  for (;;) {
    const state = await page(`(() => { const s = ${T}?.scenes.handle()?.status; if (!s || !${T}.renderer) return null; return { total: s.entries.filter(e => e.supported).length, ready: s.entries.filter(e => e.preview === "ready").length, failed: s.entries.filter(e => e.preview === "failed").length }; })()`).catch(() => null);
    if (state) {
      orbs = state.total;
      if (state.ready > 0 && first === null) first = Date.now() - started;
      if (state.total > 0 && state.ready + state.failed >= state.total && all === null) all = Date.now() - started;
    }
    const media = requests.filter(entry => entry.started >= started && isMedia(entry.url));
    const latest = Math.max(started, ...media.map(entry => entry.done ?? Number.POSITIVE_INFINITY));
    // Quiet for a while after every orb has its preview: the sharper previews behind them have arrived too.
    if (all !== null && Date.now() - latest > 2500 && Date.now() - started - all > 2500) break;
    if (Date.now() - started > 180_000) { errors.push(`${name}: the orbs' previews did not finish arriving in 3 minutes`); break; }
    await sleep(100);
  }
  const media = requests.filter(entry => entry.started >= started && isMedia(entry.url) && entry.done);
  const entry = {
    phase: name, orbs, firstPreviewMs: first, allPreviewsMs: all, lastImageMs: media.length ? Math.max(...media.map(each => each.done)) - started : null,
    ...tally(requests, started), saved: await saved(page), errors: errors.splice(0),
  };
  report.phases.push(entry);
  console.log(`${name}: ${orbs} orbs; first preview ${first} ms, every preview ${all} ms, last image ${entry.lastImageMs ?? "–"} ms; ${entry.requests} image requests, ${(entry.bytes / 1024).toFixed(0)} KiB ${JSON.stringify(entry.byKind)}${liveUrl ? `; ${entry.downloaded} downloaded, ${entry.revalidated} revalidated, ${entry.browserCache} from the browser's cache` : ""}; saved ${entry.saved ? `${entry.saved.files} files, ${(entry.saved.bytes / 1024).toFixed(0)} KiB, ${entry.saved.reused.files} reused this visit` : "–"}`);
  return entry;
}

/** Inside the panorama: each heading in turn, until its view is complete. */
async function lookPhase(name, { page, requests, errors }) {
  const steps = [];
  for (const [index, headingDeg] of config.headings.entries()) {
    const started = Date.now();
    await page(`window.__entering = ${T}.scenes.handle().enter(${JSON.stringify(config.orb)}, { view: { headingDeg: ${headingDeg}, pitchDeg: 0, verticalFovDeg: 75 } }); true`);
    let detail = null;
    let settledSince = null;
    for (;;) {
      await page(`${T}.runtime.requestRender(); true`);
      await sleep(50);
      const state = await page(`(() => { const s = ${T}.scenes.handle().status; return s.phase === "immersive" ? { detail: s.immersionDetail, heading: s.view?.headingDeg ?? null } : null; })()`);
      detail = state?.detail ?? null;
      // The view has to have turned to the heading asked for, and then a few frames: the tiles' status describes the view of their last frame.
      const turned = state && state.heading !== null && Math.abs(((state.heading - headingDeg + 540) % 360) - 180) < 0.5;
      if (!turned) settledSince = null; else settledSince ??= Date.now();
      if (settledSince !== null && Date.now() - settledSince > 250 && detail && !detail.loading && (detail.tiles ? detail.tiles.complete : !detail.representation.startsWith("preview-"))) break;
      if (Date.now() - started > 60_000) { errors.push(`${name}: the view at ${headingDeg}° was not complete in a minute`); break; }
    }
    // A request for a tile the margin wants may still be on its way.
    await sleep(300);
    const again = config.headings.indexOf(headingDeg) < index;
    const step = { step: index, headingDeg, again, completeMs: Date.now() - started - 300, representation: detail?.representation ?? null, tiles: detail?.tiles ?? null, ...tally(requests, started) };
    steps.push(step);
    console.log(`${name}, ${headingDeg}°${again ? " again" : ""}: ${step.representation} complete after ${step.completeMs} ms; ${step.tiles ? `${step.tiles.shownInView}/${step.tiles.inView} tiles in view at level ${step.tiles.levelWanted}, ${step.tiles.resident}/${step.tiles.slots} held, ${step.tiles.reusedTiles ?? 0} from saved images; ` : ""}${step.requests} image requests, ${(step.bytes / 1024).toFixed(0)} KiB`);
  }
  const entry = { phase: name, steps, saved: await saved(page), errors: errors.splice(0) };
  report.phases.push(entry);
  return entry;
}

const query = new URLSearchParams({ ...(config.scene ? { scene: config.scene } : {}), panoramaTest: "1", renderer: config.renderer === "webgl1" ? "webgl" : config.renderer, "set.scene.panorama.flightDuration": "off", ...Object.fromEntries(Object.entries(config.settings).map(([id, value]) => [`set.${id}`, value])) });
const address = `${liveUrl ?? `${ORIGIN}${config.page}`}?${query}`;
const has = phase => config.phases.includes(phase);
const keeps = config.settings["scene.panorama.savedMiB"] !== "0";
const results = {};

let failedToRun = null;
try {
  await withBrowser(async browser => {
    if (has("first")) results.first = await mapPhase("first visit", browser, () => browser.send("Page.navigate", { url: address }));
    if (has("reload")) results.reload = await mapPhase("reload", browser, () => browser.send("Page.reload", {}));
    if (has("look")) results.look = await lookPhase("look", browser);
  });
  if (has("revisit")) {
    if (config.waitMinutes > 0) { console.log(`Waiting ${config.waitMinutes} min…`); await sleep(config.waitMinutes * 60_000); }
    await withBrowser(async browser => {
      results.revisit = await mapPhase("revisit", browser, () => browser.send("Page.navigate", { url: address }));
      if (has("look")) results.lookAgain = await lookPhase("look on the revisit", browser);
      if (has("cleared") && !liveUrl) {
        await browser.page(`${T}.media.clear().then(() => true)`);
        results.cleared = await mapPhase("after clearing", browser, () => browser.send("Page.reload", {}));
      }
    });
  }
} catch (error) {
  failedToRun = error;
  report.failures.push(`The run did not finish: ${error.message}`);
}

// ─── What must hold ───────────────────────────────────────────────────
// Only for a build, where every request the page makes is counted and nothing but the app can keep a file.
if (!liveUrl && !failedToRun) {
  const fail = message => report.failures.push(message);
  for (const phase of report.phases) for (const error of phase.errors ?? []) fail(`${phase.phase}: ${error}`);
  if (results.first && results.first.requests === 0) fail("The first visit asked for no images: nothing was measured.");
  for (const [key, label] of [["reload", "The reload"], ["revisit", "The revisit"]]) {
    const phase = results[key];
    if (!phase) continue;
    if (phase.requests > 0) fail(`${label} asked the network for ${phase.requests} images it had before (${JSON.stringify(phase.byKind)}).`);
    if (phase.orbs === 0 || phase.allPreviewsMs === null) fail(`${label} did not show every orb's preview.`);
  }
  for (const [key, label] of [["look", "The look around"], ["lookAgain", "The look around on the revisit"]]) {
    const phase = results[key];
    if (!phase) continue;
    for (const step of phase.steps) {
      if ((step.again || key === "lookAgain") && step.requests > 0) fail(`${label}: looking at ${step.headingDeg}°${step.again ? " again" : ""} asked the network for ${step.requests} images it had before.`);
      if (step.tiles && !step.tiles.complete) fail(`${label}: the view at ${step.headingDeg}° was not complete.`);
    }
  }
  if (results.cleared && results.first && results.cleared.requests < results.first.requests) fail(`After clearing, the map asked for ${results.cleared.requests} images, fewer than the first visit's ${results.first.requests}: something else kept them.`);
  if (results.first?.saved && keeps && (!results.first.saved.available || results.first.saved.files === 0)) fail("Nothing was saved on the first visit.");
}
report.passed = report.failures.length === 0;

const row = phase => (phase.steps
  ? phase.steps.map(step => `| ${phase.phase}, ${step.headingDeg}°${step.again ? " again" : ""} | – | – | ${step.completeMs} | ${step.requests} | ${(step.bytes / 1024).toFixed(0)} | ${step.tiles ? `${step.tiles.shownInView}/${step.tiles.inView} at level ${step.tiles.levelWanted}, ${step.tiles.resident}/${step.tiles.slots} held` : step.representation} |`).join("\n")
  : `| ${phase.phase} | ${phase.firstPreviewMs ?? "–"} | ${phase.allPreviewsMs ?? "–"} | ${phase.lastImageMs ?? "–"} | ${phase.requests} | ${(phase.bytes / 1024).toFixed(0)} | ${liveUrl ? `${phase.downloaded} downloaded, ${phase.revalidated} revalidated, ${phase.browserCache} from the browser's cache; ` : ""}${phase.saved ? `${phase.saved.files} files saved, ${phase.saved.reused.files} reused` : "nothing saved"} |`);
await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(out, "summary.md"), [
  "# What a visit downloads, and downloads again", "",
  `${liveUrl ? `Read from ${liveUrl}` : report.passed ? "Passed" : "Failed"} on ${report.browser}, ${report.gpu ?? "GPU not reported"}, ${config.renderer}, at ${width} × ${height} CSS px × ${config.viewport.devicePixelRatio}${config.latencyMs ? `, every response held ${config.latencyMs} ms` : ""}${Object.keys(config.settings).length ? `, with ${Object.entries(config.settings).map(([id, value]) => `${id} = ${value}`).join(", ")}` : ""}.`, "",
  "| Phase | First preview, ms | Every preview, ms | Last image or view complete, ms | Image requests | KiB | |", "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ...report.phases.map(row), "",
  ...(report.failures.length ? ["## Failures", "", ...report.failures.map(failure => `- ${failure}`), ""] : []),
].join("\n"));
console.log(`${liveUrl ? "Read" : report.passed ? "Passed" : "Failed"}: ${path.relative(root, out)}`);
for (const failure of report.failures) console.log(`  ${failure}`);
if (failedToRun) throw failedToRun;
if (!report.passed) process.exitCode = 1;
