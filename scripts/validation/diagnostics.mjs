#!/usr/bin/env node
/**
 * The app's diagnostics (docs/diagnostics.md) in headless Chrome on a build of
 * an app, with no network: a visit opens a scene and enters a 360 image, its
 * renderer is killed as a phone's browser kills a page, and the visit after it
 * has to say so, with the step the killed one had reached.
 *
 * It checks that:
 *   - the visit's trail has the page, the renderer, the scene and the 360 image entered;
 *   - Settings → Diagnostics → Copy report copies a report with them, on a phone's screen;
 *   - after the renderer is crashed, the address with ?report shows that visit's trail without
 *     starting the map, and leaves it for the app;
 *   - the app's next visit then says in its log that the last one stopped without being
 *     closed, and its report shows that visit's steps;
 *   - after a visit that was left (the control), the next one says nothing.
 *
 *   node scripts/validation/diagnostics.mjs [--dist=<a build>] [--content=<a folder of the files the build leaves out>]
 *     [--path=/] [--query=scene=umn-tiles] [--orb=umn-tiles-orb] [--out=<folder>]
 *   node scripts/validation/diagnostics.mjs --url=<a live page> [--query=…] [--orb=…]
 *
 * The UMN tour: --dist=<tour>/dist-app --content=<tour>/public --path=/tour/twin-cities/ --query= --orb=<a panorama's id>
 * With --url nothing is built or intercepted: the live site is asked, over the network.
 *
 * Output: build/validation/diagnostics/<date>_<time>/ with report.json, summary.md, the reports copied and a screenshot.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "diagnostics");
mkdirSync(out, { recursive: true });
// Chrome and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;
const live = arg("url") ? new URL(arg("url")) : null;
const dist = arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
const content = arg("content") ? path.resolve(arg("content")) : null;
if (!arg("dist") && !live) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const pagePath = live ? live.pathname : arg("path", "/");
const query = new URLSearchParams(arg("query", live ? live.search.slice(1) : "scene=umn-tiles"));
query.set("panoramaTest", "1");
const orb = arg("orb", "umn-tiles-orb");
// A phone's screen: the report has to be reachable on it.
const VIEWPORT = { width: 414, height: 896 };
const ORIGIN = live ? live.origin : "https://foss-earth.test";
const URL_OF_APP = `${ORIGIN}${pagePath}?${query}`;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const T = "window.__fossEarthPanoramaTest";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const report = { app: URL_OF_APP, browser: null, visits: {}, failures: [] };
const fail = message => { report.failures.push(message); console.log(`  ✗ ${message}`); };
const pass = message => console.log(`  ✓ ${message}`);
const expect = (condition, good, bad) => (condition ? pass(good) : fail(bad));

async function fileFor(url) {
  const relative = decodeURIComponent(url.pathname).slice(1) + (url.pathname.endsWith("/") ? "index.html" : "");
  for (const folder of [dist, content].filter(Boolean)) {
    const file = path.join(folder, relative);
    if (await stat(file).then(info => info.isFile(), () => false)) return file;
  }
  return null;
}

const chrome = await openHeadlessChrome(path.join(out, "chrome-profile"), arg("chrome") ?? process.env.CHROME_BIN, ["--enable-webgpu-developer-features"]);
try {
  const version = await chrome.send("Browser.getVersion");
  report.browser = version.product;
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  const page = expression => evaluate(chrome, sessionId, expression);
  let crashed = false;
  chrome.onEvent(message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Inspector.targetCrashed") crashed = true;
    if (message.method !== "Fetch.requestPaused") return;
    void (async () => {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      if (url.origin !== ORIGIN) { await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return; }
      const file = await fileFor(url);
      if (!file) { await send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" }); return; }
      await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: MIME[path.extname(file)] ?? "application/octet-stream" }, { name: "Cache-Control", value: "no-store" }], body: (await readFile(file)).toString("base64") });
    })().catch(() => {});
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Inspector.enable");
  if (!live) await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setUserAgentOverride", { userAgent: `${version.userAgent} foss-earth-check/1.0` });
  await send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await chrome.send("Browser.grantPermissions", { origin: ORIGIN, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });

  const until = async (expression, what, timeoutMs = 60_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await page(expression).catch(() => null);
      if (value) return value;
      await sleep(200);
    }
    throw new Error(`${what} did not happen in ${timeoutMs / 1000} s`);
  };
  /** Opens the app and waits for its scene; returns what its log says of the visit before, once the trail has been read. */
  const open = async () => {
    await send("Page.navigate", { url: URL_OF_APP });
    await until(`Boolean(${T}?.diagnostics && ${T}.scenes.handle()?.status.entries.some(entry => entry.preview === "ready"))`, "the scene's first orb");
    await page(`window.__previous = undefined; ${T}.diagnostics.previous().then(value => { window.__previous = value ? { ended: value.ended, steps: value.record.steps, app: value.record.app, state: value.record.state } : null; }); true`);
    await until("window.__previous !== undefined", "reading the last visit's trail", 10_000);
    await sleep(300);
    return {
      previous: await page("window.__previous"),
      log: await page(`[...document.querySelectorAll("#app-log .game-log__text")].map(element => element.textContent)`),
    };
  };
  const reportOf = async () => {
    await page(`window.__report = undefined; ${T}.diagnostics.report().then(text => { window.__report = text; }); true`);
    return until("window.__report", "the report", 10_000);
  };
  const stepsOf = () => page(`${T}.diagnostics.trail.steps().map(step => step.text)`);
  const LAST_VISIT = /^The last visit stopped without being closed/;

  // ─── The first visit: a trail, and a report copied from Settings → Diagnostics ───
  console.log(`The first visit, ${URL_OF_APP}`);
  const first = await open();
  await page(`window.__entering = ${T}.scenes.handle().enter(${JSON.stringify(orb)}); true`);
  await until(`${T}.scenes.handle()?.status.active === ${JSON.stringify(orb)}`, `entering ${orb}`);
  const steps = await stepsOf();
  report.visits.first = { previous: first.previous, steps };
  expect(first.previous === null && !first.log.some(text => LAST_VISIT.test(text)), "a first visit has no earlier one to speak of", `a first visit spoke of an earlier one: ${JSON.stringify(first.previous)}`);
  for (const [what, pattern] of [["the page and its build", /^Opened https:\/\/.*; build .*, bundle [\w.]+-[\w-]{8}\.js$/], ["the renderer and its GPU", /^Renderer (webgpu|webgl2|webgl) \(asked for \w+\)/], ["the scene", /^Scene [\w.-]+, revision .+: \d+ 360 images$/], ["the 360 image entered", new RegExp(`^Inside the 360 image ${orb}$`)]]) {
    expect(steps.some(text => pattern.test(text)), `the trail has ${what}`, `the trail lacks ${what}: ${JSON.stringify(steps)}`);
  }
  console.log(`  ${steps.length} steps so far`);

  await page(`document.querySelector("#settingsButton").click(); true`);
  const found = await until(`(() => { const section = document.querySelector(".foss-earth-diagnostics-section"); if (!section) return null; const details = section.closest("details"); if (details) details.open = true; section.scrollIntoView({ block: "start" }); return true; })()`, "Settings → Diagnostics", 10_000).catch(() => false);
  if (!found) fail("Settings has no Diagnostics section");
  else {
    await page(`[...document.querySelectorAll(".foss-earth-diagnostics-section button")].find(button => button.textContent === "Copy report").click(); true`);
    const copied = await until(`(() => { const section = document.querySelector(".foss-earth-diagnostics-section"); const text = section.querySelector("textarea"); const status = section.querySelector("[role=status]").textContent; return text.hidden || !status ? null : { status, text: text.value, button: section.querySelector("button").getBoundingClientRect().toJSON(), viewport: [innerWidth, innerHeight] }; })()`, "the report in the section", 10_000);
    const clipboard = await page("navigator.clipboard.readText().catch(error => `unreadable: ${error.message}`)");
    writeFileSync(path.join(out, "report-first-visit.txt"), copied.text);
    writeFileSync(path.join(out, "settings-diagnostics.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    report.visits.first.copied = { status: copied.status, bytes: Buffer.byteLength(copied.text), clipboardMatches: clipboard === copied.text, button: copied.button };
    expect(/^Copied, /.test(copied.status) && clipboard === copied.text, `Copy report put ${Buffer.byteLength(copied.text)} bytes on the clipboard: "${copied.status.slice(0, 40)}…"`, `Copy report did not copy: "${copied.status}", clipboard ${clipboard === copied.text ? "matches" : "differs"}`);
    expect(copied.button.left >= 0 && copied.button.right <= copied.viewport[0], `its button is on a ${VIEWPORT.width} px wide screen`, `its button runs off a ${VIEWPORT.width} px wide screen: ${JSON.stringify(copied.button)}`);
    for (const [what, pattern] of [["the build and bundle", /^Build: .* · bundle [\w.]+-[\w-]{8}\.js$/m], ["the renderer", /^Renderer: (webgpu|webgl2|webgl) /m], ["the GPU", /^GPU: (?!not named).+/m], ["the scene", /^Scene: [\w.-]+, revision /m], ["the 360 image entered", new RegExp(`Inside the 360 image ${orb}`)], ["the settings the address set", /^ {2}scene\.|^Settings/m]]) {
      expect(pattern.test(copied.text), `the report has ${what}`, `the report lacks ${what}`);
    }
    expect(!/[?&]key=[^…]/.test(copied.text), "the report holds no key", "the report holds a key");
  }

  // ─── The renderer is killed, as a phone kills a page, and the next visit says so ───
  console.log("The renderer is crashed, and the page opened again");
  void send("Page.crash").catch(() => {});
  const crashStarted = Date.now();
  while (!crashed && Date.now() - crashStarted < 15_000) await sleep(100);
  expect(crashed, "Chrome reports the page crashed", "Chrome did not report a crash");

  // The report alone, for an app that stops before its settings can be reached.
  const reportQuery = new URLSearchParams(query);
  reportQuery.set("report", "");
  await send("Page.navigate", { url: `${ORIGIN}${pagePath}?${reportQuery}` });
  const only = await until(`(() => { const text = document.querySelector(".foss-earth-report-only textarea"); return text && !text.hidden && text.value ? { text: text.value, last: document.querySelector(".foss-earth-report-only .foss-earth-diagnostics-section p").textContent, canvas: document.querySelectorAll("canvas").length, hook: Boolean(${T}) } : null; })()`, "the report-only page", 15_000).catch(error => ({ failed: error.message }));
  if (only.failed) fail(`?report: ${only.failed}`);
  else {
    writeFileSync(path.join(out, "report-only.txt"), only.text);
    writeFileSync(path.join(out, "report-only.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    report.visits.reportOnly = { last: only.last, canvases: only.canvas };
    expect(only.canvas === 0 && !only.hook, "?report starts no map", `?report started the app: ${only.canvas} canvases`);
    expect(/^The last visit stopped without being closed/.test(only.last) && only.text.includes(`inside the 360 image ${orb}`) && /Renderer: not started/.test(only.text), `and says: "${only.last.slice(0, 110)}…"`, `and does not show the visit that stopped: "${only.last}"`);
  }

  const second = await open();
  const secondReport = await reportOf();
  writeFileSync(path.join(out, "report-after-crash.txt"), secondReport);
  report.visits.afterCrash = { previous: second.previous, log: second.log };
  expect(second.previous?.ended === "unexpected", "the visit before is read as stopped without being closed", `the visit before is read as ${JSON.stringify(second.previous?.ended ?? null)}`);
  expect(second.previous?.state.endsWith(`inside the 360 image ${orb}`), `and as having been at: ${second.previous?.state}`, `without the 360 image it was in: ${JSON.stringify(second.previous?.state)}`);
  const line = second.log.find(text => LAST_VISIT.test(text));
  expect(Boolean(line), `the log says: "${line}"`, `the log does not say the last visit stopped: ${JSON.stringify(second.log)}`);
  expect(/^The visit before, opened .*, stopped without being closed, while shown\. Build .* renderer (webgpu|webgl2|webgl)\.$/m.test(secondReport) && secondReport.includes(`  It was at: ${second.previous?.state}`), "the report shows the visit before, its renderer and where it was", "the report does not show the visit before");

  // ─── The control: a visit that was left says nothing to the next ───
  console.log("The page is left, and opened again");
  await send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  const third = await open();
  report.visits.afterLeaving = { previous: third.previous, log: third.log };
  expect(third.previous?.ended === "closed", "the visit before is read as closed", `the visit before is read as ${JSON.stringify(third.previous?.ended ?? null)}`);
  expect(!third.log.some(text => LAST_VISIT.test(text)), "and the log says nothing of it", `and the log speaks of it: ${JSON.stringify(third.log)}`);
  await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
} catch (error) {
  fail(error.message);
} finally {
  await chrome.close();
}

report.passed = report.failures.length === 0;
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(out, "summary.md"), [
  "# The app's diagnostics", "",
  `${report.passed ? "Passed" : "Failed"} on ${report.browser ?? "Chrome"}, ${report.app}.`, "",
  `The first visit's trail had ${report.visits.first?.steps.length ?? "no"} steps once inside a 360 image.`, "",
  ...(report.failures.length ? ["## Failures", "", ...report.failures.map(failure => `- ${failure}`), ""] : []),
].join("\n"));
console.log(`${report.passed ? "Passed" : "Failed"}: ${path.relative(root, out)}`);
if (!report.passed) process.exitCode = 1;
