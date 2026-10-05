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
import { createSettingsRegistry } from ${JSON.stringify(path.join(root, "src/settings/registry.ts"))};
import { INTERFACE_PARAMETERS } from ${JSON.stringify(path.join(root, "src/settings/catalogue/interface.ts"))};
import { createParameterSection } from ${JSON.stringify(path.join(root, "src/shell/settings/parameterSection.ts"))};
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
const fps = metric("fps", "60fps");
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
  reserveSpace: priorities.get(id)! <= 2,
  keepVisible: id === "north" || choices.get(id) === "show",
  onFit: (visible: boolean) => { element.dataset.fitVisible = String(visible); },
}));
const fit = fitHudBar(bar.element, end, descriptors);
const settings = createSettingsRegistry({ storage: null, sourceBase: "https://example.invalid/blob/main/" });
settings.register(INTERFACE_PARAMETERS.filter(spec => spec.id === "interface.toolbar.position"));
const section = createParameterSection(settings, { tab: "interface", section: "toolbar" });
section.element.id = "settingsFixture";
section.element.hidden = true;
section.element.style.display = "none";
section.element.style.margin = "16px";
document.getElementById("root")!.append(section.element);
let resets = 0;
elements.get("north")!.addEventListener("click", () => { resets++; });
(window as any).hudFixture = {
  bar, end, elements, priorities, choices, descriptors, fit, section, settings,
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
      credits: text === null ? [] : [{ assetId: "fixture", text, url: "https://example.invalid/credit" }],
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

async function load(width, legacyHelp = false) {
  await page.goto("about:blank");
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(html);
  if (legacyHelp) await page.evaluate(() => {
    Object.defineProperty(HTMLElement.prototype, "showPopover", { value: undefined, configurable: true });
    Object.defineProperty(HTMLElement.prototype, "hidePopover", { value: undefined, configurable: true });
  });
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
    for (const id of ["help", "fps"]) {
      if (!result.items.find(item => item.id === id)?.hidden) {
        assert(toolbar.some(item => item.id === id), `Core control ${id} must remain visible. ${detail}`);
      }
    }
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
  await page.evaluate(() => window.hudFixture.choice("position", "show"));
  const pinnedPosition = await check("only position manually enabled", { oneRow: false });
  assert.deepEqual(ids(pinnedPosition), ["north", "help", "fps", "position"],
    "A manually enabled position must wrap without removing Help or FPS");
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
    await page.evaluate(() => window.hudFixture.panorama("© Regents of the University of Minnesota"));
    await check(`UMN panorama attribution at ${width}`);
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

  for (const width of [320, 375, 390, 1280]) {
    await load(width);
    await page.evaluate(() => {
      window.hudFixture.section.element.hidden = false;
      window.hudFixture.section.element.style.removeProperty("display");
    });
    const row = page.locator('#settingsFixture .foss-earth-parameter-section__main [data-parameter="interface.toolbar.position"]');
    const input = row.locator('input[type="checkbox"]');
    const help = row.getByRole("button", { name: "Explain Camera position", exact: true });
    const reset = row.getByRole("button", { name: "Reset Camera position", exact: true });
    const tooltip = row.locator('.foss-earth-parameter__help');
    const layout = await row.evaluate(element => {
      const parts = [element.querySelector('label'), ...element.querySelectorAll('.foss-earth-parameter__actions > *')];
      return parts.map(part => {
        const box = part.getBoundingClientRect();
        return { left: box.left, right: box.right, center: (box.top + box.bottom) / 2, text: part.textContent };
      });
    });
    assert.equal(layout.length, 4, "Checkbox, help, reset and source must be four compact items");
    assert(Math.max(...layout.map(part => part.center)) - Math.min(...layout.map(part => part.center)) < 0.5,
      `Checkbox accessories must be on one row at ${width}px`);
    assert(layout.every(part => part.left >= 16 && part.right <= width - 16), "Checkbox row must fit its panel");
    assert.equal(layout[2].text, "", "Reset must show only its icon");
    assert.equal(layout[3].text, "", "Source must show only its icon");
    assert.equal(await input.isChecked(), true, "Camera position must start enabled");
    assert.equal(await tooltip.isVisible(), false, "Explanation must start hidden");
    await help.click();
    assert.equal(await tooltip.isVisible(), true, "Clicking ? must open the explanation");
    assert((await tooltip.textContent()).includes("latitude, longitude"), "Help must explain the control");
    const box = await tooltip.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width, "Tooltip must stay within the phone viewport");
    await help.click();
    assert.equal(await tooltip.isVisible(), false, "Clicking ? again must close the explanation");
    await help.click();
    await page.keyboard.press("Escape");
    assert.equal(await tooltip.isVisible(), false, "Escape must close the explanation");
    await help.click();
    await page.getByRole("button", { name: "Reset heading", exact: true }).click();
    assert.equal(await tooltip.isVisible(), false, "Clicking outside must close the explanation");
    await input.uncheck();
    assert.equal(await reset.isEnabled(), true, "An explicit choice must be resettable");
    await reset.click();
    assert.equal(await input.isChecked(), true, "Reset must restore the enabled default");
    await page.locator('#settingsFixture').getByLabel("Show all parameters", { exact: true }).check();
    const expanded = page.locator('#settingsFixture .foss-earth-parameter-list > [data-parameter="interface.toolbar.position"]');
    assert.equal(await expanded.locator('.foss-earth-parameter__actions > *').count(), 3,
      "Show all must reuse one set of help/reset/source actions");
    console.log(`Passed compact checkbox row and tooltip check at ${width}px.`);
  }

  await load(375, true);
  await page.evaluate(() => {
    const dock = document.createElement("div");
    dock.style.cssText = "position:absolute;left:32px;top:64px;width:311px;height:120px;overflow:hidden;backdrop-filter:blur(8px)";
    document.getElementById("root").append(dock);
    const section = window.hudFixture.section.element;
    section.hidden = false;
    section.style.removeProperty("display");
    dock.append(section);
  });
  const fallbackHelp = page.locator('#settingsFixture .foss-earth-parameter-section__main')
    .getByRole("button", { name: "Explain Camera position", exact: true });
  const fallbackId = await fallbackHelp.getAttribute("aria-controls");
  const fallbackTooltip = page.locator(`#${fallbackId}`);
  await fallbackHelp.click();
  assert.equal(await fallbackTooltip.isVisible(), true, "Fallback explanation must open without native popovers");
  assert.equal(await fallbackTooltip.evaluate(element => element.parentElement === document.body), true,
    "Fallback tooltip must escape its clipped dock panel");
  const fallbackBox = await fallbackTooltip.boundingBox();
  assert(fallbackBox.x >= 0 && fallbackBox.x + fallbackBox.width <= 375 && fallbackBox.y >= 0,
    "Fallback tooltip must use viewport coordinates");
  await page.keyboard.press("Escape");
  assert.equal(await fallbackTooltip.isVisible(), false, "Fallback Escape must close help");
  assert.equal(await fallbackTooltip.evaluate(element => element.parentElement.dataset.parameter), "interface.toolbar.position",
    "Closing fallback help must restore it to its control");
  console.log("Passed fallback explanation inside a filtered, clipped dock panel.");

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
