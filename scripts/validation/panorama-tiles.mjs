#!/usr/bin/env node
/**
 * The tiled panorama check: FOSS Earth's own app in headless Chrome on this
 * machine's GPU, with the umn-tiles example (the cardinal image as
 * equi-angular and ordinary tiled cubes beside a whole image), entered on
 * every renderer and shown in every representation, switched live as a
 * person switches it in 360 image settings.
 *
 * For each view it waits until every tile the view needs is on screen, takes a
 * screenshot, reads back the image direction the immersion shader drew at each
 * pixel (the renderer's own probe), and holds the screenshot against the
 * source image sampled at those directions. A wrong face, warp, slot, gutter,
 * level or table entry draws the wrong part of the image there, which shows as
 * a low PSNR; the same screenshot against the source turned 13° and tipped 7°
 * is the negative control, which must be far worse. Pixels on the tiles' cell
 * edges are scored apart, since a seam there hardly moves the whole view's. The images are the example's files, so
 * nothing here reads the network: requests leave only for the app's own
 * origin, and the map stays empty.
 *
 * WebGL 1 runs in a second Chrome started with WebGL 2 disabled, as the
 * other harnesses force it (docs/validation/README.md).
 *
 * Then it crossfades between the representations, and from one tiled cube
 * to the other, draws the tile outlines, and flies out of the orb, which
 * draws the tiles on its sphere: every shader variant compiles, and any the
 * GPU refuses fails the check.
 *
 * Usage: node scripts/validation/panorama-tiles.mjs [--out=dir] [--dist=dir | --no-build]
 *   [--renderers=webgpu,webgl2,webgl1] [--representations=whole,equi-angular-tiles,cube-tiles]
 *   [--viewport=540x960] [--min-psnr=24] [--control-margin=6] [--seam-margin=2.5] [--step=3]
 * Output: build/validation/panorama-tiles/<local time>/ with report.json,
 * summary.md and screenshots/.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";
import { decodePng, equirectUv, makeCardinalPanorama } from "../lib/panoramaImage.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);

const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "panorama-tiles");
await mkdir(path.join(out, "screenshots"), { recursive: true });
// Chrome and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;

const [viewportWidth, viewportHeight] = arg("viewport", "540x960").split("x").map(Number);
const config = {
  renderers: arg("renderers", "webgpu,webgl2,webgl1").split(","),
  // The whole image first: its tile-edge pixels are the reference a seam is judged against.
  representations: arg("representations", "whole,equi-angular-tiles,cube-tiles").split(",").sort((a, b) => Number(b === "whole") - Number(a === "whole")),
  viewport: { width: viewportWidth, height: viewportHeight },
  // The cardinal image's sharp letters and grid lines, resampled to faces of its own density, stay above this; a
  // wrong lookup does not. Test inputs, not runtime tuning.
  minPsnrDb: Number(arg("min-psnr", "24")),
  controlMarginDb: Number(arg("control-margin", "6")),
  // Pixels on tile edges are worse than the rest where the image is busy there, as the whole image shows on the
  // same pixels; a seam makes them worse than that. With no whole image to compare, the edges' own deficit counts.
  seamMarginDb: Number(arg("seam-margin", "2.5")),
  seamAloneDb: 6,
  stepPx: Number(arg("step", "3")),
  userAgentSuffix: "foss-earth-check/1.0",
};
// Straight ahead, a cube corner, straight down, and zoomed in to the finest level across a face edge.
const VIEWS = [
  { name: "north", view: { headingDeg: 0, pitchDeg: 0, verticalFovDeg: 75 } },
  { name: "corner", view: { headingDeg: 45, pitchDeg: 35, verticalFovDeg: 60 } },
  { name: "down", view: { headingDeg: 200, pitchDeg: -80, verticalFovDeg: 90 } },
  { name: "zoomed", view: { headingDeg: 135, pitchDeg: 10, verticalFovDeg: 30 } },
];
const SCENE = "umn-tiles";
const ORB = "umn-tiles-orb";
const TILE_IDS = { "equi-angular-tiles": "eac-tiles", "cube-tiles": "cube-tiles" };

// ─── Build ────────────────────────────────────────────────────────────
const dist = arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
if (!arg("dist") && !flag("no-build")) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const manifest = JSON.parse(await readFile(path.join(dist, "examples/panorama-scenes/umn-tiles.scene.json"), "utf8"));
const source = makeCardinalPanorama(2048);

/** The control's lookup: the direction turned 13° about the vertical and tipped 7°, which moves every grid line and letter. */
const TURN = 13 * Math.PI / 180, TIP = 7 * Math.PI / 180;
function turned(x, y, z) {
  const x1 = x * Math.cos(TURN) - y * Math.sin(TURN), y1 = x * Math.sin(TURN) + y * Math.cos(TURN);
  return [x1, y1 * Math.cos(TIP) - z * Math.sin(TIP), y1 * Math.sin(TIP) + z * Math.cos(TIP)];
}

/** The source's colour in a direction of the image's axes, bilinear in its stored bytes, as the GPU filters a WebGL texture; or the control's. */
function sourceColour(x, y, z, control) {
  const [u, v] = control ? equirectUv(...turned(x, y, z)) : equirectUv(x, y, z);
  const fx = u * source.width - 0.5, fy = Math.min(source.height - 1, Math.max(0, v * source.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, y1 = Math.min(source.height - 1, y0 + 1);
  const xa = ((x0 % source.width) + source.width) % source.width, xb = (xa + 1) % source.width;
  const at = (px, py, c) => source.rgb[(py * source.width + px) * 3 + c];
  return [0, 1, 2].map(c => (at(xa, y0, c) * (1 - tx) + at(xb, y0, c) * tx) * (1 - ty) + (at(xa, y1, c) * (1 - tx) + at(xb, y1, c) * tx) * ty);
}
const psnr = squared => (squared > 0 ? 10 * Math.log10((255 * 255) / squared) : Number.POSITIVE_INFINITY);

// ─── Browser ──────────────────────────────────────────────────────────
const ORIGIN = "https://foss-earth.test";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
const report = { config, views: VIEWS, browser: null, gpu: null, results: [], failures: [] };
const fail = message => { report.failures.push(message); console.log(`  ✗ ${message}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** In the page: waits for the representation to cover the view, and reads back the directions drawn. */
const AGENT = `(() => {
  if (window.__tiles) return true;
  const T = window.__fossEarthPanoramaTest;
  const frame = () => new Promise(resolve => { T.runtime.requestRender(); requestAnimationFrame(() => resolve()); });
  window.__tiles = {
    async settled(representation, tilesId, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      // A few frames first: the tiles' status describes the view of their last frame.
      for (let i = 0; i < 3; i++) await frame();
      for (;;) {
        const s = T.scenes.handle()?.status;
        const d = s?.immersionDetail;
        const done = s?.phase === "immersive" && d && !d.loading
          && (representation === "whole" ? d.representation.startsWith("whole-") : d.representation === tilesId && d.tiles?.complete);
        if (done) break;
        if (performance.now() > deadline) throw new Error("Timed out: " + JSON.stringify({ phase: s?.phase, detail: d, error: s?.lastError }));
        await frame();
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      // The last table upload and any fade, then a frame to show them.
      for (let i = 0; i < 6; i++) await frame();
      return T.scenes.handle().status.immersionDetail;
    },
    async directions(step, cells, warp) {
      const { width, height, outputs, frame: drawn } = await T.renderer.probe({ immersion: true }, ["ray", "direction"]);
      const ray = outputs.ray, direction = outputs.direction;
      // WebGL reads render targets bottom row first; decide from the rays the frame was drawn with.
      const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))));
      const cpuTop = T.math.viewRay(drawn.view, 0.5 / width, 0.5 / height);
      const topDown = angle(cpuTop, [ray[0], ray[1], ray[2]]) < angle(cpuTop, [ray[(height - 1) * width * 4], ray[(height - 1) * width * 4 + 1], ray[(height - 1) * width * 4 + 2]]);
      const samples = [];
      for (let row = Math.floor(step / 2); row < height; row += step) {
        for (let col = Math.floor(step / 2); col < width; col += step) {
          const i = (topDown ? row : height - 1 - row) * width + col;
          samples.push(col, row, direction[i * 4], direction[i * 4 + 1], direction[i * 4 + 2]);
        }
      }
      // Every pixel on a cell's edge: its cell differs from a neighbour's. A seam shows there and hardly anywhere else.
      const cellOf = i => {
        const x = direction[i * 4], y = direction[i * 4 + 1], z = direction[i * 4 + 2];
        const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
        let face, s, t, depth;
        if (ax >= ay && ax >= az) { face = x > 0 ? 0 : 1; s = x > 0 ? -y : y; t = z; depth = ax; }
        else if (ay >= az) { face = y > 0 ? 2 : 3; s = y > 0 ? x : -x; t = z; depth = ay; }
        else { face = z > 0 ? 4 : 5; s = x; t = z > 0 ? -y : y; depth = az; }
        s /= depth; t /= depth;
        if (warp === "equi-angular") { s = Math.atan(s) * 4 / Math.PI; t = Math.atan(t) * 4 / Math.PI; }
        const u = Math.min(cells - 1, Math.floor((s + 1) / 2 * cells)), v = Math.min(cells - 1, Math.floor((1 - t) / 2 * cells));
        return (face * cells + v) * cells + u;
      };
      const edges = [];
      for (let row = 1; row < height - 1; row++) {
        for (let col = 1; col < width - 1; col++) {
          const at = r => (topDown ? r : height - 1 - r) * width;
          const i = at(row) + col;
          const own = cellOf(i);
          if (own !== cellOf(i + 1) || own !== cellOf(i - 1) || own !== cellOf(at(row + 1) + col) || own !== cellOf(at(row - 1) + col)) {
            edges.push(col, row, direction[i * 4], direction[i * 4 + 1], direction[i * 4 + 2]);
          }
        }
      }
      return { width, height, topDown, samples, edges };
    },
  };
  return true;
})()`;

let failedToRun = null;
for (const renderer of config.renderers) {
  console.log(`${renderer}…`);
  const webgl1 = renderer === "webgl1";
  const chrome = await openHeadlessChrome(path.join(out, `chrome-profile-${renderer}`), arg("chrome") ?? process.env.CHROME_BIN, ["--enable-webgpu-developer-features", ...(webgl1 ? ["--disable-webgl2"] : [])]);
  const console_ = [];
  try {
    const browserVersion = await chrome.send("Browser.getVersion");
    report.browser = browserVersion.product;
    try { report.gpu ??= (await chrome.send("SystemInfo.getInfo")).gpu?.auxAttributes?.glRenderer ?? null; } catch { /* reported as unknown */ }
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const page = expression => evaluate(chrome, sessionId, expression);
    /** A long page task, polled rather than held in one protocol call, which Chrome's pipe limits to 15 s. */
    const job = async (expression, timeoutMs = 90_000) => {
      await page(`window.__job = undefined; (async () => ${expression})().then(value => { window.__job = { ok: true, value }; }, error => { window.__job = { ok: false, error: String(error && error.message || error) }; }); true`);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(100);
        const result = await page("window.__job");
        if (result) { if (!result.ok) throw new Error(result.error); return result.value; }
      }
      throw new Error(`Timed out: ${expression.slice(0, 120)}`);
    };
    const exceptions = [];
    const off = chrome.onEvent(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method === "Runtime.consoleAPICalled") {
        const text = message.params.args.map(entry => entry.value ?? entry.description).join(" ");
        console_.push(`${message.params.type}: ${text}`);
        // Babylon reports a shader or pipeline the GPU refused as a warning, and draws nothing with it.
        if (message.params.type === "error" || /uncaptured error|error compiling|failed to compile|shader error/i.test(text)) exceptions.push(text);
      }
      if (message.method !== "Fetch.requestPaused") return;
      void (async () => {
        const { requestId, request } = message.params;
        const url = new URL(request.url);
        // Only the app's own files: no map, no other host.
        if (url.origin !== ORIGIN) { await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return; }
        let file = path.join(dist, decodeURIComponent(url.pathname));
        if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
        let body = null;
        try { if (file.startsWith(dist) && (await stat(file)).isFile()) body = await readFile(file); } catch { /* 404 below */ }
        if (!body) { await send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" }); return; }
        await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: MIME[path.extname(file)] ?? "application/octet-stream" }], body: body.toString("base64") });
      })().catch(error => exceptions.push(`interception: ${error.message}`));
    });
    try {
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await send("Emulation.setUserAgentOverride", { userAgent: `${browserVersion.userAgent} ${config.userAgentSuffix}` });
      await send("Emulation.setDeviceMetricsOverride", { width: config.viewport.width, height: config.viewport.height, deviceScaleFactor: 1, mobile: false });
      // Cuts instead of animations, so each view is the one asked for when it is measured.
      const query = new URLSearchParams({
        scene: SCENE, panoramaTest: "1", renderer: webgl1 ? "webgl" : renderer,
        "set.scene.panorama.representation": config.representations[0],
        "set.scene.panorama.flightDuration": "off", "set.scene.panorama.expandDuration": "0", "set.scene.panorama.fadeDuration": "0", "set.scene.panorama.orientDuration": "0",
      });
      await send("Page.navigate", { url: `${ORIGIN}/?${query}` });
      const deadline = Date.now() + 60_000;
      while (!(await page(`Boolean(window.__fossEarthPanoramaTest?.renderer && window.__fossEarthPanoramaTest.scenes.handle()?.status.entries[0]?.preview === "ready")`).catch(() => false))) {
        if (Date.now() > deadline) throw new Error(`The ${SCENE} scene's preview did not load: ${exceptions.slice(-3).join(" | ")}`);
        await sleep(200);
      }
      const running = await page("window.__fossEarthPanoramaTest.runtime.renderer.mode") + (webgl1 ? ` ${await page("window.__fossEarthPanoramaTest.runtime.scene.getEngine().webGLVersion")}` : "");
      console.log(`  running on ${running}`);
      if (running !== (webgl1 ? "webgl 1" : renderer)) fail(`${renderer} was asked for; the app runs on ${running}.`);
      await page(AGENT);
      // Only the canvas: the panorama's tab and the HUD would cover the view the check compares.
      await page(`(() => { const style = document.createElement("style"); style.textContent = "* { visibility: hidden !important; } canvas { visibility: visible !important; }"; document.head.append(style); return true; })()`);
      let entered = false;
      for (const representation of config.representations) {
        await page(`window.__fossEarthPanoramaTest.settings.set("scene.panorama.representation", ${JSON.stringify(representation)})`);
        for (const { name, view } of VIEWS) {
          // The first view enters; the rest move within the panorama, as a link to it with an arrival view does.
          const result = await page(`window.__fossEarthPanoramaTest.scenes.handle().enter(${JSON.stringify(ORB)}, { view: ${JSON.stringify(view)} })`);
          if (!result?.ok) throw new Error(`Entering ${ORB} looking ${name}: ${JSON.stringify(result)}`);
          entered = true;
          const detail = await job(`window.__tiles.settled(${JSON.stringify(representation)}, ${JSON.stringify(TILE_IDS[representation] ?? null)}, 60000)`);
          const shot = await send("Page.captureScreenshot", { format: "png" });
          // Cell edges of the tiles shown, or for a whole image the equi-angular cube's, as a reference.
          const tiled = manifest.assets[0].representations.find(entry => entry.id === (TILE_IDS[representation] ?? "eac-tiles"));
          const directions = await job(`window.__tiles.directions(${config.stepPx}, ${tiled.faceSize / tiled.tileSize}, ${JSON.stringify(tiled.warp)})`);
          const label = `${renderer}-${representation}-${name}`;
          const png = Buffer.from(shot.data, "base64");
          await writeFile(path.join(out, "screenshots", `${label}.png`), png);
          const screen = decodePng(png);
          if (screen.width !== directions.width || screen.height !== directions.height) fail(`${label}: the screenshot is ${screen.width}×${screen.height}, the drawing buffer ${directions.width}×${directions.height}.`);
          let error = 0, control = 0, samples = 0;
          const values = directions.samples;
          for (let k = 0; k < values.length; k += 5) {
            const [col, row, x, y, z] = values.slice(k, k + 5);
            const shown = screen.rgba.subarray((row * screen.width + col) * 4, (row * screen.width + col) * 4 + 3);
            const expected = sourceColour(x, y, z, false);
            const wrong = sourceColour(x, y, z, true);
            for (let c = 0; c < 3; c++) { error += (shown[c] - expected[c]) ** 2; control += (shown[c] - wrong[c]) ** 2; }
            samples += 1;
          }
          const measured = psnr(error / (3 * samples)), againstControl = psnr(control / (3 * samples));
          let edgeError = 0, edgeSamples = 0;
          for (let k = 0; k < directions.edges.length; k += 5) {
            const [col, row, x, y, z] = directions.edges.slice(k, k + 5);
            const shown = screen.rgba.subarray((row * screen.width + col) * 4, (row * screen.width + col) * 4 + 3);
            const expected = sourceColour(x, y, z, false);
            for (let c = 0; c < 3; c++) edgeError += (shown[c] - expected[c]) ** 2;
            edgeSamples += 1;
          }
          const atEdges = edgeSamples ? psnr(edgeError / (3 * edgeSamples)) : null;
          // A probe that drew nothing reads back zeros, which are no direction at all.
          if (!Number.isFinite(error) || samples === 0) fail(`${renderer}-${representation}-${name}: no pixel could be compared; the immersion drew nothing the probe could read.`);
          const entry = { renderer, running, representation, view: name, detail, samples, psnrDb: measured, turnedPsnrDb: againstControl, edgePixels: edgeSamples, edgePsnrDb: atEdges, edgeExcessDb: null, rowsTopDown: directions.topDown, screenshot: `screenshots/${label}.png` };
          report.results.push(entry);
          const tiles = detail.tiles ? `, ${detail.tiles.shownInView}/${detail.tiles.inView} tiles at level ${detail.tiles.levelWanted}` : "";
          // A seam: the tiles' edges fall further below the rest of the view than the whole image's do on the same pixels.
          const whole = report.results.find(other => other.renderer === renderer && other.view === name && other.representation === "whole");
          const deficit = atEdges === null ? 0 : measured - atEdges;
          const excess = whole && whole.edgePsnrDb !== null ? deficit - (whole.psnrDb - whole.edgePsnrDb) : null;
          const seam = representation !== "whole" && (excess !== null ? excess > config.seamMarginDb : deficit > config.seamAloneDb);
          const ok = measured >= config.minPsnrDb && measured - againstControl >= config.controlMarginDb && !seam;
          console.log(`  ${representation} ${name}: ${detail.representation}${tiles}; ${measured.toFixed(1)} dB, ${atEdges?.toFixed(1)} dB on ${edgeSamples} tile-edge pixels${excess !== null ? ` (${excess >= 0 ? "+" : ""}${excess.toFixed(1)} dB below the whole image's there)` : ""}, turned ${againstControl.toFixed(1)} dB ${ok ? "✓" : "✗"}`);
          entry.edgeExcessDb = excess;
          if (seam) fail(`${label}: ${atEdges.toFixed(1)} dB on tile edges against ${measured.toFixed(1)} dB overall${excess !== null ? `, ${excess.toFixed(1)} dB more of a drop than the whole image's` : ""}: a seam.`);
          if (measured < config.minPsnrDb) fail(`${label}: ${measured.toFixed(1)} dB against the source, below ${config.minPsnrDb} dB.`);
          if (measured - againstControl < config.controlMarginDb) fail(`${label}: only ${(measured - againstControl).toFixed(1)} dB better than the turned source; the check cannot tell them apart.`);
        }
      }
      if (entered) {
        // Transitions, as people meet them with animations on: crossfades from tiles to a whole image, back to
        // tiles, and from one tiled cube to the other with both atlases bound; the outlines; then the flight out,
        // which draws the tiles on the orb's sphere. Each shader variant compiles here, and a refused one is logged.
        const T = "window.__fossEarthPanoramaTest";
        const shoot = async label => {
          const shot = await send("Page.captureScreenshot", { format: "png" });
          await writeFile(path.join(out, "screenshots", `${renderer}-${label}.png`), Buffer.from(shot.data, "base64"));
        };
        await page(`${T}.settings.set("scene.panorama.fadeDuration", 300)`);
        const transitions = [];
        const order = ["whole", "cube-tiles", "equi-angular-tiles"].filter(each => config.representations.includes(each));
        for (const representation of order) {
          await page(`${T}.settings.set("scene.panorama.representation", ${JSON.stringify(representation)})`);
          const detail = await job(`window.__tiles.settled(${JSON.stringify(representation)}, ${JSON.stringify(TILE_IDS[representation] ?? null)}, 60000)`);
          transitions.push(detail.representation);
        }
        const last = order.at(-1);
        await page(`${T}.settings.set("scene.panorama.tileOutlines", true)`);
        await job(`window.__tiles.settled(${JSON.stringify(last)}, ${JSON.stringify(TILE_IDS[last] ?? null)}, 60000)`);
        await shoot("outlines");
        await page(`${T}.settings.set("scene.panorama.tileOutlines", false)`);
        await page(`${T}.settings.set("scene.panorama.flightDuration", 1000)`);
        await page(`window.__exiting = ${T}.scenes.handle().exit(); true`);
        await sleep(450);
        await shoot("flight-out");
        const exiting = await job("window.__exiting");
        if (!exiting?.ok) fail(`${renderer}: exiting failed: ${JSON.stringify(exiting)}`);
        report.transitions ??= {};
        report.transitions[renderer] = { crossfadedTo: transitions, exit: exiting, screenshots: [`screenshots/${renderer}-outlines.png`, `screenshots/${renderer}-flight-out.png`] };
        console.log(`  transitions: crossfaded to ${transitions.join(", ")}; outlines; flew out ${exiting?.ok ? "✓" : "✗"}`);
      }
      if (exceptions.length) fail(`${renderer}: the page reported ${exceptions.length} errors, the first: ${exceptions[0]}`);
    } catch (error) {
      fail(`${renderer}: ${error.message}`);
    } finally {
      off();
      await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
    }
  } catch (error) {
    failedToRun ??= error;
  } finally {
    await writeFile(path.join(out, `console-${renderer}.txt`), console_.join("\n"));
    await chrome.close();
  }
}
if (failedToRun) throw failedToRun;

// ─── Report ───────────────────────────────────────────────────────────
report.passed = report.failures.length === 0 && report.results.length === config.renderers.length * config.representations.length * VIEWS.length;
report.manifest = { id: manifest.id, revision: manifest.revision };
await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const rows = report.results.map(entry => `| ${entry.running} | ${entry.representation} | ${entry.view} | ${entry.detail.tiles ? `${entry.detail.tiles.shownInView}/${entry.detail.tiles.inView} at level ${entry.detail.tiles.levelWanted}` : entry.detail.representation} | ${entry.psnrDb.toFixed(1)} | ${entry.edgePsnrDb?.toFixed(1) ?? "–"} | ${entry.turnedPsnrDb.toFixed(1)} |`);
await writeFile(path.join(out, "summary.md"), [
  `# Tiled panorama check`, "",
  `${report.passed ? "Passed" : "Failed"} on ${report.browser}, ${report.gpu ?? "GPU not reported"}, at ${config.viewport.width} × ${config.viewport.height} CSS px.`, "",
  "| Renderer | Representation | View | Tiles on screen | PSNR against the source, dB | On tile edges, dB | Against it turned, dB |", "| --- | --- | --- | --- | ---: | ---: | ---: |", ...rows, "",
  ...(report.failures.length ? ["Failures:", "", ...report.failures.map(item => `- ${item}`), ""] : []),
].join("\n"));
console.log(`${report.passed ? "Passed" : "Failed"}: ${report.results.length} views; ${path.relative(root, out)}`);
process.exitCode = report.passed ? 0 : 1;
