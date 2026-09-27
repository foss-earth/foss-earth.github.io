#!/usr/bin/env node
/**
 * The panorama input check: real mouse, wheel and trackpad events from
 * headless Chrome, through the app's own listeners, on this machine's GPU.
 * It opens the linked pair (`?scene=campus-pair&panoramaTest=1`), whose
 * scene outlines its orbs and grows them under the pointer, and checks:
 *
 *  1. The outline: a ring just outside each orb is the style's colour, and
 *     neither the pixels beyond it nor the same ring without the style are.
 *  2. Hover: the pointer over an orb grows it to the hover scale with a
 *     pointer cursor, and moving away shrinks it back.
 *  3. A click enters. While entered, the bar's right end is the close button
 *     and the panorama's credit; the map's group is hidden.
 *  4. A mouse drag turns the view while the button is held, not only on
 *     release, and hovering after the release turns nothing.
 *  5. In trackpad mode a two-finger swipe looks around and a pinch zooms;
 *     in mouse mode the wheel zooms. A held arrow key turns the view.
 *  6. The close button leaves, and the map's group returns.
 *
 * It builds the app and serves the build through request interception (no
 * HTTP server). Map tiles come from the default keyless providers, with the
 * browser identified as foss-earth-check/1.0.
 *
 * Usage: node scripts/validation/panorama-input.mjs [--out=dir] [--dist=dir | --no-build] [--viewport=1440x900]
 * Output: build/validation/panorama-input/<local time>/ with report.json,
 * summary.md and screenshots/.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";
import { decodePng } from "../lib/panoramaImage.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);
const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "panorama-input");
await mkdir(path.join(out, "screenshots"), { recursive: true });
// Chrome and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;

const [width, height] = arg("viewport", "1440x900").split("x").map(Number);
const config = {
  viewport: { width, height },
  userAgentSuffix: "foss-earth-check/1.0",
  sceneId: "campus-pair",
  manifest: "examples/panorama-scenes/campus-pair.scene.json",
  // The ring's whole pixels are the style's colour within this, 0–255.
  colourLevels: 20,
  // How far each antialiased edge of the ring reaches into it, CSS px: the image's edge is up to √2 × half a pixel.
  edgePx: 0.75,
  // Past the ring by this much, CSS px, antialiasing and rounding are over: nothing there is the ring's.
  ringSlackPx: 1,
  dragStepPx: 20,
  dragSteps: 10,
  // Longer than the look model's release window, so the drag ends without a glide.
  stillBeforeReleaseMs: 250,
  swipeDeltaPx: 20,
  keyHoldMs: 500,
  angleToleranceDeg: 0.01,
};

// ─── Build and browser ────────────────────────────────────────────────
const dist = arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
if (!arg("dist") && !flag("no-build")) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const ORIGIN = "https://foss-earth.test";
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".txt": "text/plain",
};
const chrome = await openHeadlessChrome(path.join(out, "chrome-profile"), arg("chrome") ?? process.env.CHROME_BIN, ["--enable-webgpu-developer-features"]);
const browserVersion = await chrome.send("Browser.getVersion");
const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
const send = (method, params = {}) => chrome.send(method, params, sessionId);
const exceptions = [];
chrome.onEvent(message => {
  if (message.sessionId !== sessionId) return;
  if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  if (message.method !== "Fetch.requestPaused") return;
  void (async () => {
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
    let body = null;
    try { if (file.startsWith(dist) && (await stat(file)).isFile()) body = await readFile(file); } catch { /* 404 below */ }
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
await send("Fetch.enable", { patterns: [{ urlPattern: `${ORIGIN}/*` }] });
// A neutral name on every request, the tile servers' included; nothing about the person running it.
await send("Emulation.setUserAgentOverride", { userAgent: `${browserVersion.userAgent} ${config.userAgentSuffix}` });
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

const page = expression => evaluate(chrome, sessionId, expression);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page(expression)) return;
    await sleep(250);
  }
  throw new Error(`Timed out after ${timeoutMs / 1000} s waiting for ${what}`);
}
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "none", buttons: 0, ...extra });
const press = (x, y) => mouse("mousePressed", x, y, { button: "left", buttons: 1, clickCount: 1 });
const release = (x, y) => mouse("mouseReleased", x, y, { button: "left", buttons: 0, clickCount: 1 });
const wheel = (x, y, deltaX, deltaY, modifiers = 0) => mouse("mouseWheel", x, y, { deltaX, deltaY, modifiers });
async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const bytes = Buffer.from(shot.data, "base64");
  await writeFile(path.join(out, "screenshots", `${name}.png`), bytes);
  return decodePng(bytes);
}

const git = (...args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); } catch { return null; } };
const report = {
  generatedAt: new Date().toISOString(),
  config,
  inputs: { commit: git("rev-parse", "HEAD"), uncommittedFiles: (git("status", "--porcelain") ?? "").split("\n").filter(Boolean).length },
  browser: { product: browserVersion.product },
};
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); console.log(`  ${ok ? "✓" : "✗"} ${message}`); return ok; };

// In-page helpers, on the test hooks only.
const HELPERS = `(() => {
  const T = window.__fossEarthPanoramaTest, M = T.math;
  const canvas = T.runtime.scene.getEngine().getRenderingCanvas();
  const shown = el => Boolean(el) && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  window.__input = {
    status() {
      const s = T.scenes.handle()?.status;
      return s ? { phase: s.phase, hovered: s.hovered, view: s.view, overview: s.overview, entries: s.entries.map(e => ({ id: e.id, placement: e.placement, preview: e.preview })) } : null;
    },
    ready() {
      const s = this.status();
      return Boolean(s && s.overview === "applied" && s.entries.every(e => e.placement === "placed" && e.preview === "ready") && T.renderer);
    },
    streaming: () => T.runtime.isStreamingTiles?.() ?? false,
    /** Each orb's centre on screen and drawn radius, CSS px. */
    orbs() {
      const frame = T.renderer.cameraFrame();
      return T.scenes.handle().status.entries.map(e => {
        const orb = T.renderer.inspectOrb(e.id, frame);
        const rel = M.sub(orb.marker, frame.eye), d = M.length(rel);
        const centre = T.renderer.project(M.scale(rel, 1 / d), frame);
        return { id: e.id, x: centre.x, y: centre.y, radiusPx: M.projectedDiameterPx(orb.effectiveRadius, d, frame.view.verticalFovRad, canvas.clientHeight) / 2, radiusM: orb.effectiveRadius };
      });
    },
    /** Each orb's silhouette on screen, CSS px: where the cone tangent to its sphere meets the view, all round. */
    silhouettes(points = 180) {
      const frame = T.renderer.cameraFrame();
      return T.scenes.handle().status.entries.map(e => {
        const orb = T.renderer.inspectOrb(e.id, frame);
        const rel = M.sub(orb.marker, frame.eye), d = M.length(rel), a = M.scale(rel, 1 / d);
        const alpha = Math.asin(orb.effectiveRadius / d);
        const u = M.normalize(M.cross(a, Math.abs(M.dot(a, frame.view.up)) < 0.9 ? frame.view.up : frame.view.right));
        const w = M.cross(u, a);
        const centre = T.renderer.project(a, frame);
        const outline = [];
        for (let i = 0; i < points; i++) {
          const phi = (2 * Math.PI * i) / points;
          const side = M.add(M.scale(u, Math.cos(phi)), M.scale(w, Math.sin(phi)));
          outline.push(T.renderer.project(M.add(M.scale(a, Math.cos(alpha)), M.scale(side, Math.sin(alpha))), frame));
        }
        return { id: e.id, centre, outline };
      });
    },
    cursor: () => getComputedStyle(canvas).cursor,
    onCanvas: (x, y) => document.elementFromPoint(x, y) === canvas,
    hud() {
      const close = document.querySelector("#sceneExitButton");
      const map = document.querySelector(".map-source-hud");
      const credits = [...document.querySelectorAll(".scene-credit-chip")].filter(shown);
      return {
        close: shown(close) ? { ...rect(close), label: close.getAttribute("aria-label") } : null,
        map: shown(map),
        credits: credits.map(el => ({ ...rect(el), text: el.textContent })),
        viewport: { width: innerWidth, height: innerHeight },
      };
    },
    setMode(mode) { T.runtime.setInputMode(mode); return T.runtime.getInputMode(); },
    async adapter() {
      const found = await navigator.gpu?.requestAdapter();
      const info = found?.info;
      return info ? { vendor: info.vendor, architecture: info.architecture, isFallbackAdapter: Boolean(info.isFallbackAdapter ?? found.isFallbackAdapter) } : null;
    },
  };
  return true;
})()`;

const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;

try {
  await send("Page.navigate", { url: `${ORIGIN}/?scene=${config.sceneId}&panoramaTest=1&set.input.mode=trackpad` });
  console.log("Loading the scene and the map…");
  await until("Boolean(window.__fossEarthPanoramaTest?.scenes?.handle())", 60_000, "the app and the scene");
  await page(HELPERS);
  await until("window.__input.ready()", 180_000, "both orbs placed with their previews, at the scene's overview");
  report.environment = { renderer: await page("window.__fossEarthPanoramaTest.runtime.renderer.mode"), adapter: await page("window.__input.adapter()"), inputMode: await page("window.__fossEarthPanoramaTest.runtime.getInputMode()") };
  console.log(`Renderer ${report.environment.renderer}; adapter ${JSON.stringify(report.environment.adapter)}; input mode ${report.environment.inputMode}`);
  if (!check(report.environment.renderer === "webgpu" && report.environment.adapter && !report.environment.adapter.isFallbackAdapter, "WebGPU on a hardware adapter")) throw new Error("No hardware WebGPU: nothing here can be checked.");
  // The map settles, so screenshots differ only where the orbs' style does.
  const settle = async () => {
    await until("!window.__input.streaming()", 120_000, "the map to stop streaming");
    await sleep(1500);
  };
  await settle();
  await mouse("mouseMoved", 5, 5);

  // ─── 1. Outline ─────────────────────────────────────────────────────
  // Each screenshot is measured on its own orbs' silhouettes: the map may redraw in between.
  console.log("Outline");
  const manifest = JSON.parse(await readFile(path.join(dist, config.manifest), "utf8"));
  const styledOrbs = await page("window.__input.silhouettes()");
  const styled = await screenshot("overview-styled");
  const plain = structuredClone(manifest);
  delete plain.markerStyle;
  for (const entity of plain.entities) delete entity.marker.style;
  await page(`window.__fossEarthPanoramaTest.scenes.handle().replace(${JSON.stringify(plain)}, { baseUrl: ${JSON.stringify(`${ORIGIN}/${config.manifest}`)} }).then(r => r.ok)`);
  await until("window.__input.ready()", 60_000, "the scene without its style");
  await settle();
  const unstyledOrbs = await page("window.__input.silhouettes()");
  const unstyled = await screenshot("overview-unstyled");
  const styleOf = id => {
    const own = manifest.entities.find(entity => entity.id === id).marker.style?.outline;
    return own === undefined ? manifest.markerStyle.outline : own;
  };
  /** How far a point lies outside the silhouette, CSS px, measured out from the centre. */
  const beyondOf = orb => {
    const polar = orb.outline.map(p => ({ angle: Math.atan2(p.y - orb.centre.y, p.x - orb.centre.x), radius: Math.hypot(p.x - orb.centre.x, p.y - orb.centre.y) }))
      .sort((p, q) => p.angle - q.angle);
    return (x, y) => {
      const angle = Math.atan2(y - orb.centre.y, x - orb.centre.x);
      let next = polar.findIndex(p => p.angle >= angle);
      if (next < 0) next = 0;
      const prev = polar[(next + polar.length - 1) % polar.length], after = polar[next];
      const span = ((after.angle - prev.angle) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      const t = (((angle - prev.angle) + 2 * Math.PI) % (2 * Math.PI)) / span;
      return Math.hypot(x - orb.centre.x, y - orb.centre.y) - (prev.radius + (after.radius - prev.radius) * t);
    };
  };
  /** The share of pixels whose centres lie in each band beyond the silhouette that are within `colourLevels` of `want`. */
  const bands = (image, orb, want, ranges) => {
    const beyond = beyondOf(orb);
    const extent = Math.ceil(Math.max(...orb.outline.map(p => Math.hypot(p.x - orb.centre.x, p.y - orb.centre.y))) + Math.max(...ranges.map(r => r[1])) + 2);
    return ranges.map(([from, to]) => {
      let near = 0, count = 0;
      for (let y = Math.floor(orb.centre.y) - extent; y <= Math.floor(orb.centre.y) + extent; y++) {
        for (let x = Math.floor(orb.centre.x) - extent; x <= Math.floor(orb.centre.x) + extent; x++) {
          if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
          const b = beyond(x + 0.5, y + 0.5);
          if (b < from || b > to) continue;
          const i = (y * image.width + x) * 4;
          count++;
          if ([0, 1, 2].every(c => Math.abs(image.rgba[i + c] - want[c]) <= config.colourLevels)) near++;
        }
      }
      return { from, to, pixels: count, share: count ? near / count : null };
    });
  };
  report.outline = styledOrbs.map(orb => {
    const outline = styleOf(orb.id);
    const want = [1, 3, 5].map(index => parseInt(outline.color.slice(index, index + 2), 16));
    // Where the ring covers whole pixels, clear of both antialiased edges; and past it.
    const ring = [config.edgePx, outline.widthPx - config.edgePx], past = [outline.widthPx + config.ringSlackPx, outline.widthPx + config.ringSlackPx + 3];
    const [styledRing, styledPast] = bands(styled, orb, want, [ring, past]);
    const [unstyledRing] = bands(unstyled, unstyledOrbs.find(o => o.id === orb.id), want, [ring]);
    return { id: orb.id, centre: orb.centre, outline, styledRing, styledPast, unstyledRing };
  });
  const pct = share => `${Math.round((share ?? 0) * 100)}%`;
  for (const o of report.outline) {
    check(o.styledRing.pixels > 0 && o.styledRing.share >= 0.9, `${o.id}: ${pct(o.styledRing.share)} of ${o.styledRing.pixels} pixels in its ${o.outline.widthPx} px ring are ${o.outline.color}`);
    check(o.styledPast.share <= 0.1, `${o.id}: past the ring, ${pct(o.styledPast.share)} are`);
    check(o.unstyledRing.share <= 0.1, `${o.id}: without the style, ${pct(o.unstyledRing.share)} of the same ring are`);
  }
  // Back to the scene as served, with its style.
  await page(`window.__fossEarthPanoramaTest.scenes.handle().replace(${JSON.stringify(manifest)}, { baseUrl: ${JSON.stringify(`${ORIGIN}/${config.manifest}`)} }).then(r => r.ok)`);
  await until("window.__input.ready()", 60_000, "the styled scene again");
  await settle();

  // ─── 2. Hover ───────────────────────────────────────────────────────
  console.log("Hover");
  const [target] = await page("window.__input.orbs()");
  const hoverScale = manifest.markerStyle.hover.scale;
  await mouse("mouseMoved", target.x, target.y);
  await sleep(600);
  const over = { status: await page("window.__input.status()"), orb: (await page("window.__input.orbs()")).find(o => o.id === target.id), cursor: await page("window.__input.cursor()") };
  await screenshot("overview-hovered");
  await mouse("mouseMoved", 5, 5);
  await sleep(600);
  const away = { status: await page("window.__input.status()"), orb: (await page("window.__input.orbs()")).find(o => o.id === target.id), cursor: await page("window.__input.cursor()") };
  report.hover = { orb: target.id, before: target.radiusM, over: { hovered: over.status.hovered, radiusM: over.orb.radiusM, cursor: over.cursor }, away: { hovered: away.status.hovered, radiusM: away.orb.radiusM, cursor: away.cursor } };
  check(over.status.hovered === target.id && over.cursor === "pointer", `over ${target.id}: hovered ${over.status.hovered}, cursor ${over.cursor}`);
  check(Math.abs(over.orb.radiusM / target.radiusM - hoverScale) < 1e-6, `it grew ${(over.orb.radiusM / target.radiusM).toFixed(4)} times, for a hover scale of ${hoverScale}`);
  check(away.status.hovered === null && away.cursor !== "pointer" && Math.abs(away.orb.radiusM / target.radiusM - 1) < 1e-6, `away: hovered ${away.status.hovered}, cursor ${away.cursor}, ${(away.orb.radiusM / target.radiusM).toFixed(4)} times`);

  // ─── 3. Click to enter, and the bar's right end ─────────────────────
  console.log("Entering");
  const hudBefore = await page("window.__input.hud()");
  check(hudBefore.map && !hudBefore.close, `overview: the map's group ${hudBefore.map ? "shown" : "hidden"}, no close button`);
  const at = (await page("window.__input.orbs()")).find(o => o.id === target.id);
  await mouse("mouseMoved", at.x, at.y);
  await press(at.x, at.y);
  await release(at.x, at.y);
  await until("window.__input.status().phase === 'immersive'", 60_000, "immersion after a click");
  await sleep(1000);
  const hud = await page("window.__input.hud()");
  await screenshot("immersive-hud");
  report.hud = hud;
  const credit = hud.credits.at(-1);
  check(!hud.map, "entered: the map's group is hidden");
  check(Boolean(hud.close) && hud.close.label === "Exit panorama", `entered: a close button, "${hud.close?.label}"`);
  check(Boolean(credit) && hud.viewport.width - credit.right <= 24 && hud.viewport.height - credit.bottom <= 24, `the credit "${credit?.text}" ends in the bottom-right corner (${credit ? `${(hud.viewport.width - credit.right).toFixed(0)} px from the right, ${(hud.viewport.height - credit.bottom).toFixed(0)} from the bottom` : "none"})`);
  check(Boolean(hud.close && credit) && hud.close.right <= hud.credits[0].left && Math.abs((hud.close.top + hud.close.bottom) / 2 - (credit.top + credit.bottom) / 2) < 4, "the close button sits left of the credit, on its row");

  // ─── 4. Mouse drag ──────────────────────────────────────────────────
  console.log("Mouse drag");
  const x0 = Math.round(width * 0.6), y0 = Math.round(height * 0.45);
  check(await page(`window.__input.onCanvas(${x0}, ${y0})`), "the drag starts on the canvas, not on a link button");
  const heading = async () => (await page("window.__input.status()")).view.headingDeg;
  const h0 = await heading();
  const dragSensitivity = await page("window.__fossEarthPanoramaTest.settings.get('scene.panorama.dragSensitivity')");
  await mouse("mouseMoved", x0, y0);
  await press(x0, y0);
  const during = [];
  for (let step = 1; step <= config.dragSteps; step++) {
    await mouse("mouseMoved", x0 - step * config.dragStepPx, y0, { button: "left", buttons: 1 });
    during.push(angleDiff(await heading(), h0));
  }
  const xEnd = x0 - config.dragSteps * config.dragStepPx;
  // Held still before the release, the drag has no glide to wait for.
  await sleep(config.stillBeforeReleaseMs);
  await release(xEnd, y0);
  await sleep(500);
  const afterRelease = angleDiff(await heading(), h0);
  for (let step = 1; step <= config.dragSteps; step++) await mouse("mouseMoved", xEnd + step * config.dragStepPx, y0);
  await sleep(500);
  const afterHover = angleDiff(await heading(), h0);
  const expected = during.map((_, index) => (index + 1) * config.dragStepPx * dragSensitivity);
  report.drag = { startHeadingDeg: h0, dragSensitivity, duringDeg: during, expectedDeg: expected, afterReleaseDeg: afterRelease, afterHoverDeg: afterHover };
  check(during.every((value, index) => Math.abs(value - expected[index]) <= config.angleToleranceDeg), `while held, the view turned with every move: ${during.map(v => v.toFixed(2)).join(", ")}°`);
  check(Math.abs(afterRelease - expected.at(-1)) <= config.angleToleranceDeg, `held still before the release, it did not glide (${(afterRelease - expected.at(-1)).toFixed(3)}°)`);
  check(Math.abs(afterHover - afterRelease) <= config.angleToleranceDeg, `after the release, hovering turned ${(afterHover - afterRelease).toFixed(3)}°`);

  // ─── 5. Trackpad swipe and pinch; mouse wheel ───────────────────────
  console.log("Wheel");
  const view = async () => (await page("window.__input.status()")).view;
  const swipeSensitivity = await page("window.__fossEarthPanoramaTest.settings.get('scene.panorama.swipeSensitivity')");
  check(await page("window.__input.setMode('trackpad')") === "trackpad", "trackpad mode");
  await sleep(300);
  const v0 = await view();
  for (let i = 0; i < 3; i++) await wheel(x0, y0, config.swipeDeltaPx, 0);
  for (let i = 0; i < 2; i++) await wheel(x0, y0, 0, config.swipeDeltaPx);
  const v1 = await view();
  await sleep(400);
  await wheel(x0, y0, 0, -config.swipeDeltaPx, 2);
  const v2 = await view();
  await sleep(400);
  check(await page("window.__input.setMode('mouse')") === "mouse", "mouse mode");
  await wheel(x0, y0, 0, -100);
  const v3 = await view();
  await page("window.__input.setMode('trackpad')");
  const zoom = await page(`(() => { const s = window.__fossEarthPanoramaTest.settings; return { pinchGain: s.get('scene.panorama.pinchGain'), zoomPerNotch: s.get('scene.panorama.zoomPerNotch') }; })()`);
  const zoomFov = (fov, amount) => 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * Math.exp(-amount)) * 180 / Math.PI;
  report.wheel = { swipeSensitivity, zoom, start: v0, afterSwipe: v1, afterPinch: v2, afterMouseWheel: v3 };
  check(Math.abs(angleDiff(v1.headingDeg, v0.headingDeg) - 3 * config.swipeDeltaPx * swipeSensitivity) <= config.angleToleranceDeg
    && Math.abs(v1.pitchDeg - v0.pitchDeg + 2 * config.swipeDeltaPx * swipeSensitivity) <= config.angleToleranceDeg
    && v1.verticalFovDeg === v0.verticalFovDeg,
  `a swipe right and down looked right ${angleDiff(v1.headingDeg, v0.headingDeg).toFixed(2)}° and down ${(v0.pitchDeg - v1.pitchDeg).toFixed(2)}°, without zooming`);
  check(Math.abs(v2.verticalFovDeg - zoomFov(v1.verticalFovDeg, (config.swipeDeltaPx / 100) * zoom.pinchGain)) <= config.angleToleranceDeg && v2.headingDeg === v1.headingDeg,
    `a pinch out narrowed the view from ${v1.verticalFovDeg.toFixed(2)}° to ${v2.verticalFovDeg.toFixed(2)}°`);
  check(Math.abs(v3.verticalFovDeg - zoomFov(v2.verticalFovDeg, zoom.zoomPerNotch)) <= config.angleToleranceDeg && v3.headingDeg === v2.headingDeg,
    `in mouse mode a wheel notch zoomed from ${v2.verticalFovDeg.toFixed(2)}° to ${v3.verticalFovDeg.toFixed(2)}°, without turning`);

  // ─── Keys ───────────────────────────────────────────────────────────
  console.log("Keys");
  const lookRate = await page("window.__fossEarthPanoramaTest.settings.get('scene.panorama.lookRate')");
  const key = type => send("Input.dispatchKeyEvent", { type, key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  const k0 = await heading();
  const pressedAt = performance.now();
  await key("keyDown");
  await sleep(config.keyHoldMs);
  await key("keyUp");
  const heldMs = performance.now() - pressedAt;
  const turned = angleDiff(await heading(), k0);
  await sleep(300);
  const settled = angleDiff(await heading(), k0);
  report.keys = { lookRate, heldMs, turnedDeg: turned, afterKeyUpDeg: settled };
  // The page's frames and the key events' delivery bound how exactly a wall-clock hold turns.
  check(turned >= 0.5 * lookRate * (config.keyHoldMs / 1000) && turned <= lookRate * (heldMs / 1000) + 1, `a held arrow key turned ${turned.toFixed(1)}° in ${heldMs.toFixed(0)} ms, at ${lookRate}°/s`);
  check(Math.abs(settled - turned) <= config.angleToleranceDeg, `and stopped when released (${(settled - turned).toFixed(3)}° after)`);

  // ─── 6. Close ───────────────────────────────────────────────────────
  console.log("Close");
  const close = (await page("window.__input.hud()")).close;
  await mouse("mouseMoved", (close.left + close.right) / 2, (close.top + close.bottom) / 2);
  await press((close.left + close.right) / 2, (close.top + close.bottom) / 2);
  await release((close.left + close.right) / 2, (close.top + close.bottom) / 2);
  await until("window.__input.status().phase === 'overview'", 30_000, "the overview after the close button");
  await sleep(500);
  const hudAfter = await page("window.__input.hud()");
  report.hudAfterClose = hudAfter;
  check(hudAfter.map && !hudAfter.close && hudAfter.credits.length === 0, "after closing: the map's group is back, and no close button or credit");
} catch (error) {
  failures.push(`The check stopped: ${error.message}`);
  console.log(`  ✗ ${error.message}`);
} finally {
  report.exceptions = exceptions;
  report.failures = failures;
  report.passed = failures.length === 0 && exceptions.length === 0;
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    `# Panorama input check, ${report.generatedAt}`, "",
    `Result: ${report.passed ? "passed" : "failed"}. Commit ${report.inputs.commit} with ${report.inputs.uncommittedFiles} uncommitted files. Browser ${report.browser.product}; renderer ${report.environment?.renderer ?? "?"}; adapter ${JSON.stringify(report.environment?.adapter ?? null)}.`, "",
    ...(failures.length ? ["Failures:", "", ...failures.map(failure => `- ${failure}`), ""] : []),
    ...(exceptions.length ? ["Page exceptions:", "", ...exceptions.map(text => `- ${text.split("\n")[0]}`), ""] : []),
    "Screenshots: overview-styled.png, overview-unstyled.png, overview-hovered.png, immersive-hud.png.", "",
  ];
  await writeFile(path.join(out, "summary.md"), lines.join("\n"));
  await chrome.close();
  console.log(`${report.passed ? "Passed" : "Failed"}. Report: ${path.relative(root, out)}/report.json`);
  process.exitCode = report.passed ? 0 : 1;
}
