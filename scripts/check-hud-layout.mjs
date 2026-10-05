/**
 * Serverless Chromium geometry check for priority-fitted HUD controls.
 * Run: node scripts/check-hud-layout.mjs
 * Tooling: npm install --prefix build/tools/playwright playwright
 * Uses the shared HUD code and CSS, with synthetic map and panorama data.
 * No renderer, network, dev server or GPU is required. Output stays in build/.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { newOutputDirectory } from "./lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = newOutputDirectory("validation", "hud-layout");
// Chromium and its crash handler otherwise use OS temporary directories.
process.env.TMPDIR = output;
process.env.TMP = output;
process.env.TEMP = output;

const fixture = path.join(output, "fixture.ts");
await writeFile(fixture, `
import { createHudBar } from ${JSON.stringify(path.join(root, "src/shell/hudBar.ts"))};
import { fitHudBar } from ${JSON.stringify(path.join(root, "src/shell/hudBarFit.ts"))};
import { createMapSourceHud } from ${JSON.stringify(path.join(root, "src/shell/mapSourceHud.ts"))};
import { createSceneHud } from ${JSON.stringify(path.join(root, "src/shell/scenesPanel.ts"))};
import ${JSON.stringify(path.join(root, "src/styles/base.css"))};
import ${JSON.stringify(path.join(root, "src/styles/hud.css"))};

const bar = createHudBar(document.getElementById("root")!, { items: [
  { kind: "button", id: "north", title: "Reset heading", ariaLabel: "Reset heading", text: "N" },
  { kind: "button", id: "help", title: "Help", ariaLabel: "Help", text: "?" },
  { kind: "slot", id: "performance", className: "hud-chip-group perf-chip-group", ariaLabel: "Performance metrics" },
  { kind: "button", id: "renderer", title: "Renderer", ariaLabel: "Renderer", appearance: "chip", className: "hud-chip-button hud-chip--gpu", text: "WebGPU" },
  { kind: "button", id: "input", title: "Input method", ariaLabel: "Input method", appearance: "chip", className: "hud-chip-button", text: "Touch" },
  // Deliberately differ from priority order, so the check exercises CSS order.
  { kind: "button", id: "settings", title: "Settings", ariaLabel: "Settings", text: "⚙" },
  { kind: "button", id: "theme", title: "Theme", ariaLabel: "Theme", text: "☾" },
  { kind: "button", id: "position", title: "Location", ariaLabel: "Location", appearance: "chip", className: "hud-chip-button hud-status-text", text: "44.973° -93.234° h120° p-35° z250m" },
  { kind: "slot", id: "end", className: "map-source-hud-slot" },
] });
const performance = bar.getElement("performance")!;
const metric = (id: string, text: string) => {
  const element = document.createElement("span");
  element.id = id;
  element.className = "hud-chip perf-chip";
  element.dataset.perfMetric = id;
  element.textContent = text;
  performance.append(element);
  return element;
};
const fps = metric("fps", "60 FPS");
const memory = metric("memory", "GPU memory 256 MiB");
memory.hidden = true;
const elements = new Map([
  ...["north", "help", "renderer", "input", "theme", "settings", "position"].map(id => [id, bar.getElement(id)!] as const),
  ["fps", fps], ["memory", memory],
]);
const priorities = new Map([
  ["north", 0], ["help", 1], ["fps", 2], ["renderer", 3],
  ["input", 4], ["theme", 5], ["settings", 6], ["position", 7], ["memory", 10],
]);
const choices = new Map<string, "auto" | "show" | "hide">();
const end = bar.getElement("end")!;
const map = createMapSourceHud(end, {
  activity: {
    getMapDownloadBytesPerSecond: () => 0,
    onMapDownloadRateChange: () => () => {},
    isStreamingTiles: () => false,
    onTilesStreamingChange: () => () => {},
  },
  onProviderClick: () => {},
  detail: { controller: {
    getState: () => null,
    subscribe: () => () => {},
    setSessionOverride: () => {},
  } as any },
});
map.update({ mode: "google-tiles", rasterBaseMap: null, displayedRasterBaseMap: null, lastError: null });
let sceneListener: (state: any) => void = () => {};
const scene = createSceneHud({
  controller: { subscribe(next: typeof sceneListener) {
    sceneListener = next;
    next({ loading: null, errors: [], status: null });
    return () => {};
  } } as any,
  container: end,
  mapSource: map.element,
  mapOnly: [elements.get("position")!],
});
const descriptors = () => [...elements].map(([id, element]) => ({
  element,
  priority: priorities.get(id)!,
  keepVisible: id === "north" || choices.get(id) === "show",
  onFit: (visible: boolean) => { element.dataset.fitVisible = String(visible); },
}));
const fit = fitHudBar(bar.element, end, descriptors);
let resets = 0;
elements.get("north")!.addEventListener("click", () => { resets++; });
(window as any).hudFixture = {
  bar, end, elements, priorities, choices, descriptors, fit,
  get resets() { return resets; },
  choice(id: string, value: "auto" | "show" | "hide") {
    choices.set(id, value);
    elements.get(id)!.hidden = value === "hide" || (id === "memory" && value === "auto");
    fit.update();
  },
  text(id: string, value: string) { elements.get(id)!.textContent = value; },
  provider(value: string) { map.element.querySelector(".map-source-label")!.textContent = value; },
  panorama(text: string | null) {
    sceneListener({ loading: null, errors: [], status: {
      phase: text === null ? "overview" : "immersive",
      credits: text === null ? [] : [{ assetId: "fixture", text, license: "CC0", url: "https://example.invalid/credit" }],
    } });
    fit.update();
  },
};
`);

const result = await build({
  configFile: false,
  root,
  logLevel: "error",
  build: {
    write: false,
    minify: false,
    cssCodeSplit: false,
    lib: { entry: fixture, name: "HudLayoutFixture", formats: ["iife"] },
  },
});
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
const script = chunks.filter(item => item.type === "chunk").map(item => item.code).join("\n");
const css = chunks.filter(item => item.type === "asset" && item.fileName.endsWith(".css"))
  .map(item => item.source).join("\n");
assert(script && css, "Vite must produce the fixture script and shared CSS");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<style>html,body,#root { margin:0; width:100%; height:100%; overflow:hidden; }</style>
</head><body><div id="root"></div></body></html>`;
await writeFile(path.join(output, "fixture.html"), html.replace("</body>", `<script>${script}</script></body>`));

const { chromium } = await import(pathToFileURL(path.join(root, "build/tools/playwright/node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL ?? "chrome",
  args: ["--disable-gpu"],
});
let page;
const checks = [];
const pageErrors = [];
const networkRequests = [];

async function settle() {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }));
}

async function load(width) {
  await page.goto("about:blank");
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(html);
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => window.hudFixture?.bar.element.classList.contains("hud-bar--fitted"));
  await settle();
}

async function geometry(label) {
  await settle();
  const result = await page.evaluate(() => {
    const fixture = window.hudFixture;
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const visible = element => {
      const style = getComputedStyle(element);
      return !element.closest("[hidden]") && style.display !== "none" && style.visibility !== "hidden"
        && element.getBoundingClientRect().width > 0;
    };
    const creditText = fixture.end.querySelector(".scene-credit-chip__text");
    return {
      width: innerWidth,
      bar: rect(fixture.bar.element),
      publishedHeight: Number.parseFloat(document.documentElement.style.getPropertyValue("--foss-hud-bar-height")),
      end: rect(fixture.end),
      items: fixture.descriptors().map(item => ({
        id: item.element.id,
        priority: item.priority,
        keepVisible: item.keepVisible,
        choice: fixture.choices.get(item.element.id) ?? "auto",
        hidden: !!item.element.closest("[hidden]"),
        overflowHidden: item.element.hasAttribute("data-hud-overflow-hidden"),
        onFit: item.element.dataset.fitVisible,
        visible: visible(item.element),
        ...rect(item.element),
      })),
      right: [...fixture.end.querySelectorAll(".map-detail-control, .map-source-hud__chip, .scene-credit-chip")]
        .filter(visible).map(element => ({ className: element.className, ...rect(element) })),
      credit: creditText && visible(creditText) ? {
        clientWidth: creditText.clientWidth,
        scrollWidth: creditText.scrollWidth,
        textOverflow: getComputedStyle(creditText).textOverflow,
      } : null,
    };
  });
  checks.push({ label, ...result });
  return result;
}

function ids(result) {
  return result.items.filter(item => item.visible).sort((a, b) => a.priority - b.priority).map(item => item.id);
}

function checkGeometry(label, result, { oneRow = true, priority = true } = {}) {
  const detail = `${label}: ${JSON.stringify(result)}`;
  const toolbar = result.items.filter(item => item.visible);
  const all = [...toolbar, ...result.right];
  assert(toolbar.some(item => item.id === "north"), `North must remain accessible. ${detail}`);
  assert.equal(result.publishedHeight, Math.ceil(result.bar.height), `Published bar height must follow wrapping. ${detail}`);
  for (const item of all) {
    assert(item.left >= result.bar.left - 0.5 && item.right <= result.bar.right + 0.5,
      `A control leaves the available bar width. ${detail}`);
  }
  for (let index = 0; index < all.length; index++) {
    for (const other of all.slice(index + 1)) {
      const item = all[index];
      const overlaps = Math.min(item.right, other.right) - Math.max(item.left, other.left) > 0.5
        && Math.min(item.bottom, other.bottom) - Math.max(item.top, other.top) > 0.5;
      assert(!overlaps, `Toolbar, detail rail and attribution must not overlap. ${detail}`);
    }
  }
  if (oneRow) {
    const centers = all.map(item => (item.top + item.bottom) / 2);
    assert(Math.max(...centers) - Math.min(...centers) <= 0.5, `Defaults must occupy one row. ${detail}`);
    const ordered = [...toolbar].sort((a, b) => a.left - b.left);
    assert.deepEqual(ordered.map(item => item.priority), [...ordered.map(item => item.priority)].sort((a, b) => a - b),
      `Displayed controls must follow priority, including the nested FPS chip. ${detail}`);
  }
  if (priority) {
    let omitted = false;
    for (const item of [...result.items].sort((a, b) => a.priority - b.priority)) {
      if (item.hidden || item.keepVisible) continue;
      if (!item.visible) omitted = true;
      else assert(!omitted, `Lower-priority defaults must not displace higher-priority items. ${detail}`);
      assert.equal(item.onFit, String(item.visible), `Fit callbacks must match visibility. ${detail}`);
    }
  }
  return result;
}

async function check(label, options) {
  return checkGeometry(label, await geometry(label), options);
}

try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", route => {
    networkRequests.push(route.request().url());
    return route.abort();
  });

  for (const width of [320, 375, 390, 414, 768, 1280]) {
    await load(width);
    await check(`default map at ${width}`);
  }

  await load(1280);
  const wide = await check("wide toolbar before resize");
  assert.deepEqual(ids(wide), ["north", "help", "fps", "renderer", "input", "theme", "settings", "position"],
    "The wide fixture must show every default item, with FPS inside display:contents");
  await page.setViewportSize({ width: 320, height: 800 });
  const narrow = await check("toolbar after narrowing to 320");
  assert(ids(narrow).length < ids(wide).length, "Narrowing must omit defaults");
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.deepEqual(ids(await check("toolbar restored after widening")), ids(wide));

  await load(768);
  const beforeText = await check("before changing renderer readout");
  await page.evaluate(() => window.hudFixture.text("renderer", "WebGL 2 renderer " + "detail ".repeat(80)));
  const longText = await check("renderer readout grows without resize");
  assert(!ids(longText).includes("renderer"), "A readout that no longer fits must be omitted");
  assert(ids(longText).length < ids(beforeText).length, "A growing readout must refit the default row");
  await page.evaluate(() => window.hudFixture.text("renderer", "WebGPU"));
  assert.deepEqual(ids(await check("renderer readout shrinks without resize")), ids(beforeText));
  await page.evaluate(() => window.hudFixture.provider("Google 3D Tiles with additional provider credit"));
  const longProvider = await check("provider text reserves its actual width");
  assert(longProvider.end.width > beforeText.end.width, "Changing provider text must change the reserved width");
  assert(ids(longProvider).length < ids(beforeText).length, "Wider right-side content must displace lower priorities");
  await page.evaluate(() => window.hudFixture.provider("Google 3D Tiles"));
  assert.deepEqual(ids(await check("provider text shrinks and defaults return")), ids(beforeText));

  await load(320);
  await page.evaluate(() => window.hudFixture.provider("A provider with a very long name ".repeat(20)));
  await check("very long provider credit on a phone");

  await load(1280);
  await page.evaluate(() => window.hudFixture.choice("renderer", "hide"));
  const hidden = await check("explicitly hidden renderer on wide screen");
  assert(!ids(hidden).includes("renderer"), "An explicitly hidden item must stay hidden when there is space");
  await page.setViewportSize({ width: 320, height: 800 });
  await check("explicitly hidden renderer on narrow screen");
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.deepEqual(ids(await check("hidden choice survives widening")), ids(hidden));
  await page.evaluate(() => window.hudFixture.choice("renderer", "auto"));
  assert(ids(await check("automatic renderer visibility restored")).includes("renderer"));

  await load(375);
  const defaultManual = await check("before manually enabling extras");
  const forced = ["help", "fps", "renderer", "input", "theme", "settings", "position", "memory"];
  await page.evaluate(items => items.forEach(id => window.hudFixture.choice(id, "show")), forced);
  const manual = await check("explicitly enabled controls wrap", { oneRow: false });
  assert.deepEqual(ids(manual), ["north", ...forced], "Every explicitly enabled control must remain visible");
  assert(manual.bar.height > defaultManual.bar.height, "Explicit extras must be allowed to use additional rows");
  await page.evaluate(() => window.hudFixture.choice("renderer", "hide"));
  const manualHidden = await check("hidden choice also wins in a wrapped toolbar", { oneRow: false });
  assert(!ids(manualHidden).includes("renderer"));
  assert(ids(manualHidden).includes("memory"), "Hiding another item must not discard a manual extra");

  for (const width of [320, 375, 390, 414, 768, 1280]) {
    await load(width);
    await page.evaluate(() => window.hudFixture.panorama("Panorama photograph credited to an institution with a deliberately very long attribution name ".repeat(10)));
    const panorama = await check(`long panorama attribution at ${width}`);
    assert.equal(panorama.right.length, 1, "The panorama credit must replace map source and detail");
    assert(!ids(panorama).includes("position"), "The map's position readout must be hidden in a panorama");
    assert(panorama.credit?.scrollWidth > panorama.credit?.clientWidth, "Long credit text must be truncated inside its chip");
    assert.equal(panorama.credit.textOverflow, "ellipsis", "Truncated credits must have an ellipsis");
    await page.getByRole("button", { name: "Reset heading", exact: true }).click();
    assert.equal(await page.evaluate(() => window.hudFixture.resets), 1, "North remains clickable beside long panorama attribution");
    await page.evaluate(() => window.hudFixture.panorama(null));
    const returned = await check(`map restored after panorama at ${width}`);
    assert.equal(returned.right.length, 2, "Map detail and source must return when leaving the panorama");
  }

  assert.deepEqual(pageErrors, [], "Fixture must not emit browser errors");
  assert.deepEqual(networkRequests, [], "The fixture must not request any network resources");
  console.log(`Passed ${checks.length} HUD layout geometry checks without a server or GPU.`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, "geometry.json"), JSON.stringify({ checks, pageErrors, networkRequests }, null, 2));
  await browser.close();
  console.log(`Diagnostics: ${path.relative(root, output)}`);
}
