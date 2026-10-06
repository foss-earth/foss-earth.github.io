#!/usr/bin/env node
/** Actual map-detail controller/rail DOM check. No server, network, GPU, or visible browser. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";
import { openHeadlessPage } from "./lib/headlessPage.mjs";
import { newOutputDirectory } from "./lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = newOutputDirectory("validation", "map-detail-marker");
process.env.TMPDIR = output;
const sources = {};
for (const name of ["scripts/check-map-detail-marker.mjs", "src/styles/hud.css", "src/shell/mapDetailSlider.ts", "src/shell/mapDetailController.ts"]) {
  sources[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
}
const fixture = path.join(output, "fixture.ts");
await writeFile(fixture, `
import { createMapDetailController } from ${JSON.stringify(path.join(root, "src/shell/mapDetailController.ts"))};
import { createMapDetailSlider } from ${JSON.stringify(path.join(root, "src/shell/mapDetailSlider.ts"))};
import ${JSON.stringify(path.join(root, "src/styles/base.css"))};
import ${JSON.stringify(path.join(root, "src/styles/hud.css"))};
const key = "raster:usgs-topo";
const rows = [-3, -1, 0].map(loadedTarget => {
  const controller = createMapDetailController({ storage: null });
  controller.setActiveSource({ key, availability: "ready" });
  const rail = createMapDetailSlider({ controller });
  const row = document.createElement("div");
  row.className = "example";
  const label = document.createElement("span");
  label.textContent = loadedTarget === 0 ? "Loaded Normal, same as requested" : "Loaded " + loadedTarget + " levels";
  row.append(rail.element, label);
  document.body.append(row);
  const load = value => controller.reportDelivery(key, { pending: value !== 0, limits: value !== 0 ? ["loading"] : [], activeTarget: 0, effectiveTarget: value === 0 ? 0 : null, loadedTarget: value });
  load(loadedTarget);
  return { controller, rail, load };
});
window.markerFixture = {
  load: value => rows[0].load(value),
  theme: value => { document.documentElement.dataset.theme = value; },
  read() {
    const rail = rows[0].rail.element;
    const marker = rail.querySelector(".map-detail-control__loaded-marker");
    const slider = rail.querySelector("input");
    if (!marker) return { markerExists: false };
    const style = getComputedStyle(marker);
    const cap = pseudo => {
      const value = getComputedStyle(marker, pseudo);
      return { content: value.content, width: parseFloat(value.width), height: parseFloat(value.height), top: value.top, bottom: value.bottom, colour: value.backgroundColor, pointerEvents: value.pointerEvents };
    };
    const box = marker.getBoundingClientRect();
    const track = slider.getBoundingClientRect();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const requestedRatio = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
    const requestedThumbX = track.left + 6 + requestedRatio * (track.width - 12);
    const hit = document.elementFromPoint(Math.max(track.left + .5, Math.min(track.right - .5, center.x)), center.y);
    return { markerExists: true, hidden: marker.hidden, display: style.display, width: box.width, height: box.height,
      x: center.x, y: center.y, requestedThumbX, top: cap("::before"), bottom: cap("::after"), colour: style.backgroundColor,
      outline: style.boxShadow, z: Number(style.zIndex), sliderZ: Number(getComputedStyle(slider).zIndex),
      pointerEvents: style.pointerEvents, hitSlider: hit === slider, requested: rows[0].controller.getState().requestedTarget,
      value: slider.value, title: rail.title };
  },
};
`);
const built = await build({ configFile: false, root, logLevel: "error", publicDir: false,
  build: { write: false, minify: false, cssCodeSplit: false, lib: { entry: fixture, name: "MapDetailMarkerFixture", formats: ["iife"] } },
});
const chunks = (Array.isArray(built) ? built : [built]).flatMap(item => item.output);
const script = chunks.filter(item => item.type === "chunk").map(item => item.code).join("\n");
const css = chunks.filter(item => item.type === "asset" && item.fileName.endsWith(".css")).map(item => item.source).join("\n");
const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${css}</style>
<style>body { margin:24px; font:14px system-ui; background:#0c1420; color:#e2e8f0; }
  :root[data-theme="light"] body { background:#f8fafc; color:#172033; }
  h1 { margin:0 0 12px; font-size:16px; } p { margin:0 0 12px; }
  .example { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin:8px 0; }
</style></head><body><h1>Loaded map detail</h1><p>Requested detail stays at Normal.</p><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
await writeFile(path.join(output, "fixture.html"), html);
const requests = [];
const page = await openHeadlessPage("chrome", path.join(output, "chrome-profile"), {
  width: 480, height: 230, chromeArgs: ["--disable-gpu"],
  respond: async url => {
    if (url.origin !== "https://foss-earth.test") { requests.push(url.origin + url.pathname); return null; }
    return { status: 200, headers: { "content-type": "text/html" }, body: html };
  },
});
const checks = [];
try {
  await page.navigate("https://foss-earth.test/");
  for (let attempts = 0; attempts < 50 && !await page.evaluate("Boolean(window.markerFixture)"); attempts++) await new Promise(resolve => setTimeout(resolve, 50));
  for (const theme of ["dark", "light"]) {
    await page.evaluate(`window.markerFixture.theme(${JSON.stringify(theme)})`);
    let previousX = Infinity;
    for (const loaded of [-3, -1, 0]) {
      await page.evaluate(`window.markerFixture.load(${loaded})`);
      const state = await page.evaluate("window.markerFixture.read()");
      checks.push({ theme, loaded, ...state });
      assert(state.markerExists && !state.hidden && state.display !== "none", "Loaded detail must have a visible marker even at the request or the rail end");
      assert(state.height >= 14 && state.width >= 1 && state.width <= 3, "Loaded marker needs a narrow, tall I-beam stem");
      for (const cap of [state.top, state.bottom]) {
        assert(cap.content !== "none" && cap.width >= 6 && cap.width <= 8 && cap.height >= 1, "Both I-beam caps must be present and wider than the stem");
        assert.equal(cap.colour, state.colour, "Caps and stem must use the same theme colour");
        assert.equal(cap.pointerEvents, "none", "Caps must pass through pointer input");
      }
      assert.equal(state.top.top, "0px");
      assert.equal(state.bottom.bottom, "0px");
      assert.notEqual(state.outline, "none", "The I-beam needs a contrasting outline over the thumb and track");
      assert(state.z > state.sliderZ, "The I-beam must remain above the requested thumb");
      assert.equal(state.pointerEvents, "none");
      assert(state.hitSlider, "The I-beam must not intercept input to the slider");
      assert.equal(state.requested, 0, "Loaded detail must not move the requested target");
      assert.equal(state.value, "0", "The requested thumb must stay still while loading");
      if (loaded === 0) assert(Math.abs(state.x - state.requestedThumbX) <= 0.5, "Equal loaded/requested values must align the I-beam with the native thumb centre");
      assert(state.x < previousX, "Loaded detail must move left as imagery sharpens");
      previousX = state.x;
    }
    await page.evaluate("window.markerFixture.load(-3)");
    await writeFile(path.join(output, `${theme}.png`), await page.screenshot());
    await page.evaluate("window.markerFixture.load(null)");
    const unknown = await page.evaluate("window.markerFixture.read()");
    assert(unknown.hidden && unknown.display === "none", "No loaded detail must hide the I-beam");
  }
  assert.notEqual(checks[0].colour, checks[3].colour, "The I-beam must follow the light/dark theme");
  assert.deepEqual(requests, [], "The check must not request external resources");
  console.log(`Passed ${checks.length} loaded-detail I-beam states, both themes, no server or GPU.`);
} catch (error) {
  await writeFile(path.join(output, "failure.png"), await page.screenshot()).catch(() => {});
  throw error;
} finally {
  try { await writeFile(path.join(output, "report.json"), JSON.stringify({ browser: page.product, sources, checks, requests }, null, 2)); }
  finally { await page.close(); }
  console.log(`Evidence: ${output}`);
}
