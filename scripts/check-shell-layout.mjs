/**
 * Serverless Chromium regression check for the shared dock/log layout.
 * Run: node scripts/check-shell-layout.mjs
 * Tooling: npm install --prefix build/tools/playwright playwright
 * Optional: STARTUP_HTML=../0sfs/index.html includes a host's startup CSS.
 * All generated fixtures, browser profiles, and reports stay under build/.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../", import.meta.url));
const stamp = new Date().toISOString().replaceAll(":", "-");
const output = path.join(root, "build", "validation", "shell-layout", stamp);
await mkdir(output, { recursive: true });
// Chromium and its crash handler otherwise default to OS temporary directories.
process.env.TMPDIR = output;
process.env.TMP = output;
process.env.TEMP = output;

const fixture = path.join(output, "fixture.tsx");
await writeFile(fixture, `
import { createRoot } from "react-dom/client";
import { WindowOverlay } from ${JSON.stringify(path.join(root, "src/shell/WindowOverlay.tsx"))};
import { createGameLog } from ${JSON.stringify(path.join(root, "src/log/createGameLog.ts"))};
import ${JSON.stringify(path.join(root, "src/styles/base.css"))};
import ${JSON.stringify(path.join(root, "src/windowing/styles/windowing.css"))};
import ${JSON.stringify(path.join(root, "src/log/gameLog.css"))};
const log = createGameLog();
log.print({ tone: "progress", progress: 0.42, text: "Downloading terrain and preparing the world. This deliberately long progress message exercises the log's full available width at every viewport size." });
const overlayApiRef = { current: null };
window.shellFixture = { log, overlayApiRef };
createRoot(document.getElementById("root")!).render(
  <WindowOverlay getViewState={() => null} setViewState={() => {}}
    overlayApiRef={overlayApiRef}
    additionalTabs={[{ id: "alpha", label: "Alpha" }, { id: "beta", label: "Beta" }]}
    renderAdditionalTab={id => <p>{id} panel contents</p>} />
);
`);

const result = await build({
  configFile: false,
  root,
  logLevel: "error",
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    write: false,
    minify: false,
    cssCodeSplit: false,
    lib: { entry: fixture, name: "ShellLayoutFixture", formats: ["iife"] },
  },
});
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
const script = chunks.filter(item => item.type === "chunk").map(item => item.code).join("\n");
const css = chunks.filter(item => item.type === "asset" && item.fileName.endsWith(".css"))
  .map(item => item.source).join("\n");
assert(script && css, "Vite must produce the fixture script and runtime CSS");
let startupCss = "";
if (process.env.STARTUP_HTML) {
  const html = await readFile(path.resolve(root, process.env.STARTUP_HTML), "utf8");
  startupCss = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)]
    .map(match => match[1]).join("\n");
  assert(startupCss, "STARTUP_HTML must contain inline startup CSS");
}
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${startupCss}</style><style>${css}</style>
<style>html,body,#root { margin:0; width:100%; height:100%; overflow:hidden; }</style>
</head><body><div id="root"></div></body></html>`;
await writeFile(path.join(output, "fixture.html"), html.replace("</body>", `<script>${script}</script></body>`));

const { chromium } = await import(pathToFileURL(path.join(root, "build/tools/playwright/node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL ?? "chrome",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
page.setDefaultTimeout(5000);
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
const checks = [];

async function settle() {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }));
}

async function load(width) {
  // setContent alone keeps globals and listeners from the previous fixture.
  await page.goto("about:blank");
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(html);
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => window.shellFixture?.overlayApiRef.current && document.documentElement.dataset.dockLayout);
  await settle();
}

async function check(label) {
  await settle();
  const geometry = await page.evaluate(() => {
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
    };
    return {
      width: innerWidth,
      mode: document.documentElement.dataset.dockLayout,
      minimized: window.shellFixture.log.isMinimized(),
      sized: window.shellFixture.log.element.hasAttribute("data-sized"),
      log: rect(window.shellFixture.log.element),
      panels: [...document.querySelectorAll(".foss-earth-dock-panel, .foss-earth-workspace-slot-launcher")].map(element => ({
        side: element.dataset.side ?? (element.classList.contains("foss-earth-workspace-slot-launcher-left") ? "left" : "right"),
        collapsed: element.dataset.collapsed,
        ...rect(element),
      })),
    };
  });
  checks.push({ label, ...geometry });
  const detail = `${label}: ${JSON.stringify(geometry)}`;
  assert(["single", "dual"].includes(geometry.mode), `A shared layout mode is required. ${detail}`);
  assert.equal(geometry.panels.filter(panel => panel.side === "left").length, geometry.mode === "dual" ? 1 : 0, detail);
  assert.equal(geometry.panels.filter(panel => panel.side === "right").length, 1, detail);
  assert(geometry.log.left >= -0.5 && geometry.log.right <= geometry.width + 0.5, `Log leaves viewport. ${detail}`);
  assert(geometry.log.width > 0, `Log must remain visible. ${detail}`);
  assert(Math.abs(geometry.log.top - 12) <= 0.5, `Both log layouts must keep the same top margin. ${detail}`);
  if (geometry.mode === "dual") {
    assert(Math.abs((geometry.log.left + geometry.log.right) / 2 - geometry.width / 2) <= 0.5,
      `Dual-mode log must stay at the screen center. ${detail}`);
  }
  for (const panel of geometry.panels) {
    assert(panel.left >= -0.5 && panel.right <= geometry.width + 0.5, `Panel leaves viewport. ${detail}`);
    assert(panel.side === "left"
      ? panel.right <= geometry.log.left + 0.5
      : geometry.log.right <= panel.left + 0.5, `Log overlaps ${panel.side} UI. ${detail}`);
  }
  return geometry;
}

async function openTab(side, label) {
  const launcher = page.getByRole("button", { name: `Open ${side} panel`, exact: true });
  if (await launcher.count()) await launcher.click();
  else await page.locator(`.foss-earth-dock-panel[data-side="${side}"] .foss-earth-tab-add`).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  await settle();
}

async function drag(selector, dx, dy = 0) {
  const box = await page.locator(selector).boundingBox();
  assert(box, `Missing drag handle ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await settle();
}

try {
  for (const width of [320, 375, 640, 847, 848, 849, 883, 884, 885, 907, 908, 909, 960, 1047, 1048, 1049, 1084, 1088, 1108, 1280, 1600]) {
    await load(width);
    const initial = await check(`empty docks at ${width}`);
    await openTab("right", "Beta");
    if (initial.mode === "dual") await openTab("left", "Alpha");
    await check(`open docks at ${width}`);
  }

  await load(1280);
  await openTab("left", "Alpha");
  await openTab("right", "Beta");
  await drag('.foss-earth-dock-panel[data-side="left"] .foss-earth-dock-panel-resize-handle', 100);
  await check("left dock widened");
  await drag('.foss-earth-dock-panel[data-side="right"] .foss-earth-dock-panel-resize-handle', -100);
  await check("both docks widened");
  for (const [side, label] of [["left", "Alpha"], ["right", "Beta"]]) {
    const panel = page.locator(`.foss-earth-dock-panel[data-side="${side}"]`);
    await panel.locator(".foss-earth-dock-panel-resize-handle").click();
    assert.equal(await panel.getAttribute("data-collapsed"), "true");
    await check(`${side} dock minimized`);
    await panel.locator(".foss-earth-tab-button").filter({ hasText: label }).click();
    assert.equal(await panel.getAttribute("data-collapsed"), "false");
    await check(`${side} dock reopened`);
  }
  for (const width of [1109, 1108, 1089, 1088, 1000, 884, 883, 640, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await check(`widened docks resized to ${width}`);
  }

  await load(1280);
  await openTab("left", "Alpha");
  await openTab("right", "Beta");
  await drag(".game-log__resize", 120, 80);
  const dragged = await check("log resized by dragging");
  assert(dragged.sized, "Dragging must exercise the manually sized log");
  for (const width of [960, 884, 640, 375, 1280, 1600, 907]) {
    await page.setViewportSize({ width, height: 800 });
    await check(`dragged log resized to ${width}`);
  }
  await page.locator(".game-log__resize").click();
  assert((await check("log minimized")).minimized, "Resize handle click must minimize");
  await page.locator(".game-log__peek").click();
  assert(!(await check("log reopened")).minimized, "Peek must reopen the log");
  await page.setViewportSize({ width: 1280, height: 800 });
  await check("reopened log returns to wide viewport");

  await load(640);
  await openTab("right", "Beta");
  const narrow = await check("single-mode log before resize");
  assert.equal(narrow.mode, "single");
  await drag(".game-log__resize", 50);
  const grown = await check("single-mode log dragged right 50px");
  assert(Math.abs(grown.log.width - narrow.log.width - 50) < 0.5, "Single-mode log must grow by the pointer distance");
  await drag(".game-log__resize", -30);
  const shrunk = await check("single-mode log dragged left 30px");
  assert(Math.abs(shrunk.log.width - grown.log.width + 30) < 0.5, "Single-mode log must shrink by the pointer distance");
  assert.equal(shrunk.log.left, narrow.log.left, "Single-mode log keeps its left edge when resized");

  await load(1280);
  await openTab("left", "Alpha");
  await openTab("right", "Beta");
  const beforeReciprocal = await check("reciprocal resize starts with centered log");
  await drag(".game-log__resize", 60, 30);
  const expandedLog = await check("log growth squeezes both docks");
  assert(expandedLog.log.width > beforeReciprocal.log.width, "Log drag must grow the log");
  for (const side of ["left", "right"]) {
    assert(expandedLog.panels.find(panel => panel.side === side).width
      < beforeReciprocal.panels.find(panel => panel.side === side).width, `Log growth must squeeze the ${side} dock`);
  }
  await drag('.foss-earth-dock-panel[data-side="left"] .foss-earth-dock-panel-resize-handle', 80);
  const expandedLeft = await check("left dock growth squeezes previously resized log");
  assert(expandedLeft.panels.find(panel => panel.side === "left").width
    > expandedLog.panels.find(panel => panel.side === "left").width, "Left dock must grow after resizing the log");
  assert(expandedLeft.log.width < expandedLog.log.width, "Left dock growth must squeeze the log");
  await drag('.foss-earth-dock-panel[data-side="right"] .foss-earth-dock-panel-resize-handle', -130);
  const expandedRight = await check("right dock growth squeezes previously resized log");
  assert(expandedRight.panels.find(panel => panel.side === "right").width
    > expandedLeft.panels.find(panel => panel.side === "right").width, "Right dock must grow after resizing the log");
  assert(expandedRight.log.width < expandedLeft.log.width, "Right dock growth must squeeze the log");
  await page.evaluate(() => window.shellFixture.log.print({ text: "Progress while the window owns its size", tone: "progress" }));
  const afterMessage = await check("new log message preserves window resize priority");
  assert(Math.abs(afterMessage.log.width - expandedRight.log.width) < 0.5, "A message must not restore the old log width");
  assert.deepEqual(afterMessage.panels, expandedRight.panels, "A message must not shrink either dock");

  await load(960);
  await openTab("left", "Alpha");
  await openTab("right", "Beta");
  await drag('.foss-earth-dock-panel[data-side="left"] .foss-earth-dock-panel-resize-handle', 200);
  const minimumLog = await check("left window stops at the centered log minimum");
  assert.equal(minimumLog.mode, "dual", "The window being dragged must stay mounted");
  assert(Math.abs(minimumLog.log.width - 160) < 0.5, "Log reaches its minimum width");
  assert(Math.abs(minimumLog.panels.find(panel => panel.side === "left").width - 376) < 0.5);

  await load(1280);
  await openTab("left", "Alpha");
  await openTab("right", "Beta");
  const transitionStart = await check("log mode-transition gesture starts dual");
  assert.equal(transitionStart.mode, "dual");
  assert(Math.abs(transitionStart.log.width - 560) <= 0.5, "Transition fixture starts with a 560px log");
  const transitionGrip = await page.locator(".game-log__resize").boundingBox();
  assert(transitionGrip, "Missing log grip for uninterrupted mode-transition gesture");
  const transitionX = transitionGrip.x + transitionGrip.width / 2;
  const transitionY = transitionGrip.y + transitionGrip.height / 2;
  assert(transitionX + 200 < 1280, "Transition gesture must remain inside the viewport");
  await page.mouse.move(transitionX, transitionY);
  await page.mouse.down();
  await page.mouse.move(transitionX + 200, transitionY, { steps: 16 });
  const transitionSingle = await check("growing log past minimum dock width switches to single");
  assert.equal(transitionSingle.mode, "single", "A 960px log cannot retain two 160px docks");
  assert(Math.abs(transitionSingle.log.width - 960) <= 0.5, "Dual-origin gesture keeps symmetric growth when entering single mode");
  assert.equal(await page.locator('.foss-earth-dock-panel[data-side="right"] .foss-earth-tab-button').filter({ hasText: "Alpha" }).count(), 1,
    "The left tab must remain available in the right dock during single mode");
  await page.mouse.move(transitionX + 150, transitionY, { steps: 8 });
  const transitionDual = await check("reversing same log gesture restores dual mode");
  assert.equal(transitionDual.mode, "dual", "Shrinking to 860px restores both docks in the same gesture");
  assert(Math.abs(transitionDual.log.width - 860) <= 0.5, "Drag direction reversal must preserve the original pointer anchor");
  assert.equal(await page.locator('.foss-earth-dock-panel[data-side="left"] .foss-earth-tab-button').filter({ hasText: "Alpha" }).count(), 1,
    "The original left tab returns to the left dock");
  assert.equal(await page.locator('.foss-earth-dock-panel[data-side="right"] .foss-earth-tab-button').filter({ hasText: "Beta" }).count(), 1,
    "The original right tab stays in the right dock");
  await page.mouse.up();
  await check("restored dual layout persists after releasing the log");

  // Start a fresh drag that forces single mode, then let the right window take over.
  await drag(".game-log__resize", 50);
  const beforeRightResize = await check("oversized log before resizing the single right window");
  assert.equal(beforeRightResize.mode, "single");
  await drag('.foss-earth-dock-panel[data-side="right"] .foss-earth-dock-panel-resize-handle', -80);
  const afterRightResize = await check("single right window squeezes log without relocating it");
  assert.equal(afterRightResize.mode, "single");
  assert.equal(afterRightResize.log.left, beforeRightResize.log.left);
  assert(afterRightResize.log.width < beforeRightResize.log.width);
  assert.deepEqual(pageErrors, [], "Fixture must not emit browser errors");
  console.log(`Passed ${checks.length} shell layout geometry checks${startupCss ? " with host startup CSS" : ""}.`);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  throw error;
} finally {
  await writeFile(path.join(output, "geometry.json"), JSON.stringify({ startupHtml: process.env.STARTUP_HTML ?? null, checks, pageErrors }, null, 2));
  await browser.close();
  console.log(`Diagnostics: ${path.relative(root, output)}`);
}
