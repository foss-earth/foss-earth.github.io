#!/usr/bin/env node
/**
 * Whether the app's own files are downloaded once (docs/app-files.md): opens
 * the app in headless Chrome with a profile it keeps between its browsers,
 * and counts every request for a file the build's worker lists that reaches
 * the network:
 *
 *   first visit   the page loads; its worker installs, takes over and keeps what the page loaded
 *   reload        the same page reloaded
 *   revisit       a new browser on the same profile
 *
 * A build is served by intercepting every request of the browser, the
 * worker's as well as the page's, with no server and no cache headers, so a
 * file the worker does not keep is asked for every time: the reload and the
 * revisit must ask for none of the app's files. With `--url` it reads a live
 * site from the page's resource timing, which counts the bytes a file took
 * over the network whether the page or the worker asked for them; the reload
 * and the revisit then run with the browser's HTTP cache turned off, as a
 * visit after the host's cached copies have gone stale, unless `--wait-min`
 * waits for that instead. To check a new version taking over, give `--out` a
 * folder holding a copy of the `chrome-profile` of a run against the version
 * before.
 *
 *   node scripts/validation/app-files.mjs
 *   node scripts/validation/app-files.mjs --dist=../UMN-VR/UMN-VR.github.io/dist-app \
 *     --content=../UMN-VR/UMN-VR.github.io/public --page=/tour/twin-cities/
 *   node scripts/validation/app-files.mjs --url=https://umn-vr.github.io/tour/twin-cities/
 *
 *   [--out=<folder>] [--dist=<a build>] [--content=<folder>] [--page=/] [--url=<live page>]
 *   [--renderer=webgpu|webgl2|webgl1] [--viewport=1512x900@2] [--latency=0] [--wait-min=0]
 *
 * Output: build/validation/app-files/<date>_<time>/ with report.json and summary.md.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "app-files");
await mkdir(out, { recursive: true });
// Chrome and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;

const liveUrl = arg("url", null);
const [size, ratio = "1"] = arg("viewport", "1512x900@2").split("@");
const [width, height] = size.split("x").map(Number);
const config = {
  live: liveUrl,
  page: arg("page", "/"),
  renderer: arg("renderer", "webgpu"),
  viewport: { width, height, devicePixelRatio: Number(ratio) },
  latencyMs: Number(arg("latency", "0")),
  waitMinutes: Number(arg("wait-min", "0")),
  userAgentSuffix: "foss-earth-check/1.0",
};
const WORKER = "foss-earth-sw.js";
const ORIGIN = "https://foss-earth.test";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm", ".ico": "image/x-icon" };
const T = "window.__fossEarthPanoramaTest";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─── The build, and the files its worker lists ───────────────────────
const dist = liveUrl ? null : arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
if (!liveUrl && !arg("dist")) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const content = arg("content") ? path.resolve(arg("content")) : null;
async function served(relative) {
  for (const base of [dist, content].filter(Boolean)) {
    const file = path.join(base, relative);
    try { if (file.startsWith(base) && (await stat(file)).isFile()) return file; } catch { /* the next folder */ }
  }
  return null;
}
const pageUrl = new URL(liveUrl ?? `${ORIGIN}${config.page}`);
// The worker sits at the app's base; the page may be below it. A live site is asked for it once, as the browser would.
const workerSource = liveUrl
  ? await (async () => {
    for (let at = new URL("./", pageUrl); ; at = new URL("../", at)) {
      const response = await fetch(new URL(WORKER, at), { headers: { "user-agent": config.userAgentSuffix } }).catch(() => null);
      if (response?.ok) return { url: new URL(WORKER, at), text: await response.text() };
      if (at.pathname === "/") return null;
    }
  })()
  : await readFile(path.join(dist, WORKER), "utf8").then(text => ({ url: new URL(`/${WORKER}`, ORIGIN), text }), () => null);
if (!workerSource) throw new Error(`No ${WORKER} beside the app: is it built with FOSS Earth's appFiles plugin (vite/appFiles.ts)?`);
const listed = new Set(JSON.parse(/install\(self, (\[.*\])\);/s.exec(workerSource.text)[1]).map(name => new URL(name, workerSource.url).pathname));
const isAppFile = url => { try { const parsed = new URL(url); return parsed.origin === pageUrl.origin && listed.has(parsed.pathname); } catch { return false; } };
const STORE = `foss-earth-app-files ${workerSource.url.pathname}`;

const report = { config, browser: null, gpu: null, listedFiles: listed.size, phases: [], failures: [] };
const profile = path.join(out, "chrome-profile");

/** One browser on the kept profile. `work` gets the page, the app files' requests and its errors. */
async function withBrowser(work) {
  const chrome = await openHeadlessChrome(profile, arg("chrome") ?? process.env.CHROME_BIN, ["--enable-webgpu-developer-features", ...(config.renderer === "webgl1" ? ["--disable-webgl2"] : [])]);
  try {
    const version = await chrome.send("Browser.getVersion");
    report.browser = version.product;
    try { report.gpu ??= (await chrome.send("SystemInfo.getInfo")).gpu?.auxAttributes?.glRenderer ?? null; } catch { /* reported as unknown */ }
    /** On a build, every request for an app file that reached the network: the page's and its worker's. */
    const requests = [];
    const errors = [];
    let sessionId = null;
    const off = chrome.onEvent(message => {
      const p = message.params;
      if (message.sessionId === sessionId && message.method === "Runtime.exceptionThrown") errors.push(`page: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
      else if (message.sessionId === sessionId && message.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push(`page: ${p.args.map(entry => entry.value ?? entry.description).join(" ")}`);
      else if (!liveUrl && message.method === "Fetch.requestPaused") {
        // Browser-wide interception: no session.
        void (async () => {
          const { requestId, request } = p;
          const url = new URL(request.url);
          // Only the app's own host: no map, no other site.
          if (url.origin !== ORIGIN) { await chrome.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return; }
          const entry = isAppFile(request.url) ? { url: url.pathname, from: "network", at: Date.now(), answer: "network", bytes: 0 } : null;
          if (entry) requests.push(entry);
          const file = await served(decodeURIComponent(url.pathname).slice(1) + (url.pathname.endsWith("/") ? "index.html" : ""));
          const body = file ? await readFile(file) : null;
          if (entry) entry.bytes = body?.length ?? 0;
          if (config.latencyMs > 0) await sleep(config.latencyMs);
          if (!body) { await chrome.send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" }); return; }
          // No cache headers: what the worker does not keep is asked for again.
          await chrome.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: MIME[path.extname(file)] ?? "application/octet-stream" }, { name: "Cache-Control", value: "no-store" }], body: body.toString("base64") });
        })().catch(error => { if (!/Invalid InterceptionId/.test(error.message)) errors.push(`interception: ${error.message}`); });
      }
    });
    // Nothing attaches to the worker: DevTools' network events on a worker's session held up the pages it controls once a new version took over.
    if (!liveUrl) await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true }));
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const page = expression => evaluate(chrome, sessionId, expression);
    await send("Runtime.enable");
    await send("Page.enable");
    // Only for turning the HTTP cache off; what reached the network is read from the page's resource timing.
    if (liveUrl) await send("Network.enable");
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

const state = `(async () => {
  const registration = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
  const store = typeof caches === "undefined" || !(await caches.has(${JSON.stringify(STORE)})) ? null : await caches.open(${JSON.stringify(STORE)});
  const kept = store ? (await store.keys()).map(request => new URL(request.url).pathname) : [];
  return {
    href: location.href, started: Boolean(${T}?.runtime),
    controlled: navigator.serviceWorker?.controller?.scriptURL ?? null, scope: registration?.scope ?? null, kept,
    loaded: performance.getEntriesByType("resource").map(entry => entry.name),
    // Bytes over the network (transferSize), whoever asked for them, and whether the worker answered (workerStart).
    timing: performance.getEntriesByType("resource").map(entry => ({ name: entry.name, transferSize: entry.transferSize, workerStart: entry.workerStart })),
  };
})()`;

/** One phase: navigate, wait for the app to start (and on the first visit for the worker to keep what the page loaded), then count. */
async function phase(name, { send, page, requests, errors }, navigate, { awaitKept = false, cacheDisabled = false } = {}) {
  await send("Network.setCacheDisabled", { cacheDisabled }).catch(() => {});
  const started = Date.now();
  await navigate();
  let last = null;
  let startedMs = null;
  for (;;) {
    await sleep(250);
    last = await page(state).catch(error => ({ error: error.message }));
    if (last?.started && startedMs === null) startedMs = Date.now() - started;
    const loadedApp = (last?.loaded ?? []).filter(isAppFile).map(url => new URL(url).pathname);
    const done = last?.started && (!awaitKept || (last.controlled && loadedApp.every(file => last.kept.includes(file))));
    if (done) break;
    if (Date.now() - started > 90_000) { errors.push(`${name}: ${awaitKept ? "the worker did not take over and keep what the page loaded" : "the app did not start"} in 90 s (${JSON.stringify({ ...last, loaded: last?.loaded?.length, kept: last?.kept?.length })})`); break; }
  }
  // Files the app loads a little later, its workers' and its lazy parts', are counted too.
  await sleep(3000);
  last = await page(state).catch(error => ({ error: error.message }));
  // A build counts what reached its interception; a live site, what the page's resource timing says crossed the network.
  const timing = (last?.timing ?? []).filter(each => isAppFile(each.name)).map(each => ({ url: new URL(each.name).pathname, bytes: each.transferSize, worker: each.workerStart > 0 }));
  const reached = liveUrl ? timing.filter(each => each.bytes > 0) : requests.filter(each => each.at >= started);
  const entry = {
    phase: name, startedMs, href: last?.href ?? null, controlled: Boolean(last?.controlled), scope: last?.scope ?? null,
    appFilesLoaded: (last?.loaded ?? []).filter(isAppFile).length, kept: last?.kept?.length ?? 0,
    fromNetwork: reached.length, networkBytes: reached.reduce((sum, each) => sum + (each.bytes ?? 0), 0),
    ...(liveUrl ? { fromWorker: timing.filter(each => each.worker && each.bytes === 0).length, fromBrowserCache: timing.filter(each => !each.worker && each.bytes === 0).length } : {}),
    networkFiles: [...new Set(reached.map(each => each.url))].slice(0, 20),
    cacheDisabled, errors: errors.splice(0),
  };
  report.phases.push(entry);
  console.log(`${name}: app started after ${startedMs ?? "–"} ms; ${entry.appFilesLoaded} app files loaded, ${entry.fromNetwork} from the network (${(entry.networkBytes / 1024).toFixed(0)} KiB)${liveUrl ? `, ${entry.fromWorker} from the worker, ${entry.fromBrowserCache} from the browser's cache` : ""}; worker ${entry.controlled ? "in control" : "not in control"}, ${entry.kept} kept`);
  return entry;
}

const address = new URL(pageUrl);
address.searchParams.set("panoramaTest", "1");
address.searchParams.set("renderer", config.renderer === "webgl1" ? "webgl" : config.renderer);
const results = {};
let failedToRun = null;
try {
  await withBrowser(async browser => {
    results.first = await phase("first visit", browser, () => browser.send("Page.navigate", { url: address.href }), { awaitKept: true });
    results.reload = await phase("reload", browser, () => browser.send("Page.reload", {}), { cacheDisabled: Boolean(liveUrl) });
  });
  if (config.waitMinutes > 0) { console.log(`Waiting ${config.waitMinutes} min…`); await sleep(config.waitMinutes * 60_000); }
  await withBrowser(async browser => {
    results.revisit = await phase("revisit", browser, () => browser.send("Page.navigate", { url: address.href }), { cacheDisabled: Boolean(liveUrl) && config.waitMinutes === 0 });
  });
} catch (error) {
  failedToRun = error;
  report.failures.push(`The run did not finish: ${error.message}`);
}

// ─── What must hold ───────────────────────────────────────────────────
if (!failedToRun) {
  const fail = message => report.failures.push(message);
  for (const each of report.phases) for (const error of each.errors) fail(`${each.phase}: ${error}`);
  for (const [key, label] of [["first", "The first visit"], ["reload", "The reload"], ["revisit", "The revisit"]]) {
    const each = results[key];
    if (!each) continue;
    if (!each.startedMs) fail(`${label}: the app did not start (${each.href}).`);
    if (key !== "first" && !each.controlled) fail(`${label}: no worker controlled the page.`);
    if (key !== "first" && each.fromNetwork > 0) fail(`${label} asked the network for ${each.fromNetwork} of the app's files it had kept: ${each.networkFiles.join(", ")}.`);
  }
  if (results.first && results.first.appFilesLoaded === 0) fail("The first visit loaded none of the files the worker lists: nothing was measured.");
}
report.passed = report.failures.length === 0;

await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(out, "summary.md"), [
  "# The app's own files, downloaded once", "",
  `${report.passed ? "Passed" : "Failed"} ${liveUrl ? `on ${liveUrl}` : "on a build"} with ${report.browser}, ${report.gpu ?? "GPU not reported"}, ${config.renderer}, at ${width} × ${height} CSS px × ${config.viewport.devicePixelRatio}${config.latencyMs ? `, every response held ${config.latencyMs} ms` : ""}. The worker lists ${listed.size} files.${liveUrl ? ` The reload and the revisit ran with the HTTP cache ${config.waitMinutes ? `on, the revisit ${config.waitMinutes} min later` : "off"}.` : ""}`, "",
  `| Phase | App started, ms | App files loaded | From the network | KiB |${liveUrl ? " From the worker | From the browser's cache |" : ""} Worker in control | Kept |`,
  `| --- | ---: | ---: | ---: | ---: |${liveUrl ? " ---: | ---: |" : ""} --- | ---: |`,
  ...report.phases.map(each => `| ${each.phase} | ${each.startedMs ?? "–"} | ${each.appFilesLoaded} | ${each.fromNetwork} | ${(each.networkBytes / 1024).toFixed(0)} |${liveUrl ? ` ${each.fromWorker} | ${each.fromBrowserCache} |` : ""} ${each.controlled ? "yes" : "no"} | ${each.kept} |`), "",
  ...(report.failures.length ? ["## Failures", "", ...report.failures.map(failure => `- ${failure}`), ""] : []),
].join("\n"));
console.log(`${report.passed ? "Passed" : "Failed"}: ${path.relative(root, out)}`);
for (const failure of report.failures) console.log(`  ${failure}`);
if (failedToRun) throw failedToRun;
if (!report.passed) process.exitCode = 1;
