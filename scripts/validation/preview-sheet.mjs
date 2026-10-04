#!/usr/bin/env node
/**
 * An orb drawn from a preview sheet against the same orb drawn from its own
 * face files (docs/scenes/format.md, "Preview sheets"): the `umn-tiles`
 * example on a build of the app, in headless Chrome or Firefox on this
 * machine's GPU, with no network. The orb is drawn 256 px across with a 150°
 * window and seen from four sides and from above, so every face of its cube is
 * on screen.
 *
 * Each view's orb with sheets on is held against the same view with them off,
 * which must be the same picture but for the sheet's second JPEG encoding, and
 * against the next view, which must not be: the control that shows the
 * comparison can tell two pictures apart. It also checks that the sheet was
 * what loaded: one image request with sheets on, six with them off.
 *
 *   node scripts/validation/preview-sheet.mjs [--browser=chrome|firefox] [--renderers=webgpu,webgl2,webgl1] [--dist=<a build>]
 *     [--out=<folder>] [--min-psnr=40] [--control-margin=10]
 *
 * Firefox runs WebGL 2 and WebGL 1 unless --renderers names others; its WebGL 1 is the
 * preference webgl.enable-webgl2 turned off.
 *
 * Output: build/validation/preview-sheet/<date>_<time>/ with report.json, summary.md and the screenshots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { openHeadlessPage } from "../lib/headlessPage.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";
import { decodePng } from "../lib/panoramaImage.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "preview-sheet");
mkdirSync(out, { recursive: true });
// The browser and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;
const browser = arg("browser", "chrome");
const renderers = arg("renderers", browser === "firefox" ? "webgl2,webgl1" : "webgpu,webgl2,webgl1").split(",");
// The same picture twice encoded stays far above this; another face in its place does not. Test inputs, not runtime tuning.
const minPsnrDb = Number(arg("min-psnr", "40"));
const controlMarginDb = Number(arg("control-margin", "10"));
const dist = arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
if (!arg("dist")) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ORIGIN = "https://foss-earth.test";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const T = "window.__fossEarthPanoramaTest";
// Headings round the orb at the overview's pitch, then from above. With a 150° window the level views reach
// well into the top and bottom faces, and the view from above shows the bottom face whole.
const VIEWS = [[0, null], [90, null], [180, null], [270, null], [45, 75]];

let running = null;
async function capture(renderer, sheets) {
  const shots = [];
  const requests = [];
  const tab = await openHeadlessPage(browser, path.join(out, `${browser}-profile-${renderer}-${sheets}`), {
    width: 600, height: 600, binary: arg(browser),
    chromeArgs: ["--enable-webgpu-developer-features", ...(renderer === "webgl1" ? ["--disable-webgl2"] : [])],
    firefoxPrefs: renderer === "webgl1" ? { "webgl.enable-webgl2": false } : {},
    async respond(url) {
      if (url.origin !== ORIGIN) return null;
      if (/\/media\//.test(url.pathname)) requests.push(url.pathname.replace(/^.*\/media\//, ""));
      const file = path.join(dist, decodeURIComponent(url.pathname).slice(1) + (url.pathname.endsWith("/") ? "index.html" : ""));
      const body = await stat(file).then(info => (info.isFile() ? readFile(file) : null), () => null);
      if (!body) return { status: 404, body: "" };
      return { status: 200, headers: { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }, body };
    },
  });
  try {
    report.browser = tab.product;
    const page = expression => tab.evaluate(expression);
    // The orb as large as it may be drawn, and only its 64 px preview, the one the sheet holds.
    const query = new URLSearchParams({ scene: "umn-tiles", panoramaTest: "1", renderer: renderer === "webgl1" ? "webgl" : renderer, "set.scene.panorama.previewSheets": String(sheets), "set.scene.panorama.savedMiB": "0", "set.scene.panorama.previewFov": "150" });
    await tab.navigate(`${ORIGIN}/?${query}`);
    const started = Date.now();
    while (!(await page(`Boolean(${T}?.renderer && ${T}.scenes.handle()?.status.entries[0]?.preview === "ready" && ${T}.scenes.handle().status.overview !== "pending")`).catch(() => false))) {
      if (Date.now() - started > 60_000) throw new Error("the orb's preview did not load");
      await sleep(200);
    }
    running = `${await page(`${T}.runtime.renderer.mode`)}${renderer === "webgpu" ? "" : ` ${await page(`${T}.runtime.scene.getEngine().webGLVersion`)}`}`;
    await page(`(() => { const style = document.createElement("style"); style.textContent = "body > *:not(canvas), #root > *:not(canvas), .foss-earth-hud, [class*=hud], [class*=dock], [class*=log] { visibility: hidden !important; } canvas { visibility: visible !important; }"; document.head.append(style); const s = ${T}.settings; s.set("scene.panorama.previewFaceRange", { min: 64, max: 64 }); s.set("scene.panorama.markerDiameter", { min: 256, max: 256 }); return true; })()`);
    for (const [headingDeg, pitchDeg] of VIEWS) {
      // Turned about the overview's own centre, which is at the orb: setViewState would put the centre back on the ground.
      await page(`(() => { const camera = ${T}.runtime.geospatialCamera; window.__pitch ??= camera.pitch; camera.yaw = ${headingDeg} * Math.PI / 180; camera.pitch = ${pitchDeg === null ? "window.__pitch" : `(90 - ${pitchDeg}) * Math.PI / 180`}; return true; })()`);
      for (let frame = 0; frame < 12; frame++) { await page(`${T}.runtime.requestRender(); true`); await sleep(40); }
      const detail = await page(`${T}.scenes.handle().status.entries[0].previewDetail`);
      const bytes = await tab.screenshot();
      writeFileSync(path.join(out, `${renderer}-${sheets ? "sheet" : "files"}-${headingDeg}-${pitchDeg ?? "level"}.png`), bytes);
      shots.push({ view: `${headingDeg}°${pitchDeg === null ? "" : `, from ${pitchDeg}° above`}`, image: decodePng(bytes), preview: detail?.representation });
    }
  } finally {
    await tab.close();
  }
  return { shots, requests };
}

/** Over the 240 px square at the canvas's centre, inside the orb's 256 px disc: the orb's image and nothing else. */
function psnr(a, b) {
  let squared = 0, count = 0;
  for (let y = 180; y < 420; y++) for (let x = 180; x < 420; x++) {
    if (Math.hypot(x - 300, y - 300) > 120) continue;
    const i = (y * a.width + x) * 4;
    for (let c = 0; c < 3; c++) { const d = a.rgba[i + c] - b.rgba[i + c]; squared += d * d; count += 1; }
  }
  return squared === 0 ? Infinity : 10 * Math.log10((255 * 255) / (squared / count));
}

const report = { minPsnrDb, controlMarginDb, browser: null, results: [], failures: [] };
for (const renderer of renderers) {
  const on = await capture(renderer, true);
  const off = await capture(renderer, false);
  const rows = on.shots.map((shot, index) => ({
    view: shot.view, preview: shot.preview,
    sameViewDb: Math.round(psnr(shot.image, off.shots[index].image) * 10) / 10,
    nextViewDb: Math.round(psnr(shot.image, off.shots[(index + 1) % off.shots.length].image) * 10) / 10,
  }));
  report.results.push({ renderer, running, sheetRequests: on.requests, fileRequests: off.requests, rows });
  console.log(`${renderer} (${running}): ${on.requests.length} image request with the sheet (${on.requests.join(", ")}), ${off.requests.length} without`);
  if (on.requests.length !== 1 || !/previews-\d+\.jpg$/.test(on.requests[0])) report.failures.push(`${renderer}: with sheets on, the orb asked for ${on.requests.join(", ") || "nothing"}, not the sheet alone`);
  if (off.requests.length !== 6) report.failures.push(`${renderer}: with sheets off, the orb asked for ${off.requests.length} files, not its six faces`);
  for (const row of rows) {
    const good = row.sameViewDb >= minPsnrDb && row.sameViewDb - row.nextViewDb >= controlMarginDb;
    console.log(`  ${row.view}: ${row.sameViewDb} dB against the same view from files, ${row.nextViewDb} dB against the next view ${good ? "✓" : "✗"}`);
    if (row.preview !== "preview-64") report.failures.push(`${renderer}, ${row.view}: the orb showed ${row.preview}, not the 64 px preview the sheet holds`);
    if (row.sameViewDb < minPsnrDb) report.failures.push(`${renderer}, ${row.view}: the orb from the sheet is ${row.sameViewDb} dB from the orb from its files, under ${minPsnrDb} dB`);
    else if (row.sameViewDb - row.nextViewDb < controlMarginDb) report.failures.push(`${renderer}, ${row.view}: the next view is ${row.nextViewDb} dB away, too near the same view's ${row.sameViewDb} dB for the comparison to tell pictures apart`);
  }
}
report.passed = report.failures.length === 0;
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(out, "summary.md"), [
  "# An orb from a preview sheet against the orb from its files", "",
  `${report.passed ? "Passed" : "Failed"} on ${report.browser ?? "Chrome"}: the orb's disc must be within ${minPsnrDb} dB of itself drawn from files, and ${controlMarginDb} dB nearer than the next view is.`, "",
  "| Renderer | View | Same view, dB | Next view, dB |", "| --- | --- | ---: | ---: |",
  ...report.results.flatMap(result => result.rows.map(row => `| ${result.running} | ${row.view} | ${row.sameViewDb} | ${row.nextViewDb} |`)), "",
  ...(report.failures.length ? ["## Failures", "", ...report.failures.map(failure => `- ${failure}`), ""] : []),
].join("\n"));
console.log(`${report.passed ? "Passed" : "Failed"}: ${path.relative(root, out)}`);
for (const failure of report.failures) console.log(`  ${failure}`);
if (!report.passed) process.exitCode = 1;
