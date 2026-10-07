#!/usr/bin/env node
/**
 * The About tab and the controls over the world (docs/ui-layout.md, "A control
 * uses its input or passes it on"), on a build in a headless browser with no
 * network, at a window short enough that the + menu cannot be one column.
 *
 * It checks that:
 *   - the + menu lists About, and every item of it is inside the window and
 *     above the HUD bar, in as many columns as that takes: on 2026-10-07 its
 *     last items ran under the map source chip, and About read as not there;
 *   - Escape closes the menu;
 *   - About names the app's version, as its commit's (26.10.7.3), beside the
 *     name of each checkout with no commit hash there, and lists each
 *     checkout's commits alike, the one it was built from first;
 *   - a sideways swipe over the About tab is kept from the browser and handed
 *     to the canvas, and one along the tab's own scroll is left to it.
 *
 *   node scripts/validation/about-and-controls.mjs [--browser=chrome|firefox|webkit] [--dist=<a build>]
 *     [--content=<a folder of the files the build leaves out>] [--path=/] [--width=1100] [--height=560] [--out=<folder>]
 *
 * 0sfs: --dist=<0sfs>/dist --path=/fly/
 *
 * Output: build/validation/about-and-controls/<date>_<time>/ with report.json and screenshots.
 * The events are the page's own, not a trackpad's: what a browser does with a swipe nothing
 * prevents, going Back a page, is a person's to see.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { openHeadlessPage } from "../lib/headlessPage.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "about-and-controls");
mkdirSync(out, { recursive: true });
// The browser and its crash handler otherwise write to the system's temporary directory.
process.env.TMPDIR = out;
const browser = arg("browser", "chrome");
const dist = arg("dist") ? path.resolve(arg("dist")) : path.join(out, "dist");
const content = arg("content") ? path.resolve(arg("content")) : null;
if (!arg("dist")) {
  console.log("Building the app…");
  await build({ root, logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
}
const pagePath = arg("path", "/");
const ORIGIN = "https://foss-earth.test";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".xml": "application/xml", ".glb": "model/gltf-binary" };
const VIEWPORT = { width: Number(arg("width", 1100)), height: Number(arg("height", 560)) };
const VERSION = /^\d{2}\.\d{1,2}\.\d{1,2}\.\d+$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fileFor(url) {
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  for (const folder of [dist, content]) {
    if (!folder) continue;
    for (const candidate of [path.join(folder, relative), path.join(folder, relative, "index.html")]) {
      if (!candidate.startsWith(folder)) continue;
      if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
    }
  }
  return null;
}

const report = { browser: null, dist: path.relative(root, dist), path: pagePath, viewport: VIEWPORT, failures: [] };
const fail = message => { report.failures.push(message); console.log(`  FAILED: ${message}`); };
const check = (condition, message) => { if (!condition) fail(message); };

const tab = await openHeadlessPage(browser, path.join(out, `${browser}-profile`), {
  ...VIEWPORT, binary: arg(browser), chromeArgs: ["--enable-webgpu-developer-features"],
  async respond(url) {
    if (url.origin !== ORIGIN) return null;
    const file = await fileFor(url);
    if (!file) return { status: 404, body: "" };
    return { status: 200, headers: { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }, body: await readFile(file) };
  },
});
try {
  report.browser = tab.product;
  const page = expression => tab.evaluate(expression);
  const until = async (condition, what, timeoutMs = 90_000) => {
    const started = Date.now();
    for (;;) {
      if (await page(condition).catch(() => false)) return;
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}.`);
      await sleep(200);
    }
  };
  const shot = async file => writeFileSync(path.join(out, `${browser}-${file}.png`), await tab.screenshot());
  const PLUS = `document.querySelector('[data-side="right"] [aria-label="Open new tab"], [aria-label="Open right panel"]')`;
  /** The + menu as it lies: its items, each one's box, and the HUD bar's top. */
  const MENU = `(() => {
    const menu = document.querySelector('[role="menu"]');
    const bar = document.querySelector(".hud-bar")?.getBoundingClientRect();
    const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return menu && {
      box: box(menu),
      columns: getComputedStyle(menu).gridAutoFlow,
      barTop: bar && bar.height > 0 ? bar.top : null,
      window: { width: innerWidth, height: innerHeight },
      items: [...menu.querySelectorAll('[role="menuitem"]')].map(item => ({ label: item.textContent, ...box(item) })),
    };
  })()`;

  await tab.navigate(`${ORIGIN}${pagePath}${arg("query") ? `?${arg("query")}` : ""}`);
  await until(`Boolean(${PLUS})`, "the + button of the right panel");
  await until(`Boolean(document.querySelector(".hud-bar")) && document.querySelector(".hud-bar").getBoundingClientRect().height > 0`, "the HUD bar");

  console.log("The + menu");
  await page(`${PLUS}.click()`);
  await until(`Boolean(document.querySelector('[role="menu"]')) && document.querySelector('[role="menu"]').style.visibility !== "hidden"`, "the + menu");
  await sleep(100);
  const menu = await page(MENU);
  report.menu = menu;
  await shot("menu");
  const labels = menu.items.map(item => item.label);
  check(labels.includes("About"), `the + menu does not list About: ${labels.join(", ")}`);
  const limit = Math.min(menu.window.height, menu.barTop ?? Infinity);
  for (const item of menu.items) {
    check(item.bottom <= limit + 0.5, `"${item.label}" ends at ${item.bottom.toFixed(1)}, below ${menu.barTop === null ? "the window's edge" : "the HUD bar's top"} at ${limit.toFixed(1)}`);
    check(item.top >= -0.5 && item.left >= -0.5 && item.right <= menu.window.width + 0.5, `"${item.label}" is not wholly inside the window`);
  }
  console.log(`  ${menu.items.length} tabs, ${new Set(menu.items.map(item => Math.round(item.left))).size} column(s), the last ending ${(limit - Math.max(...menu.items.map(item => item.bottom))).toFixed(0)} px above ${menu.barTop === null ? "the window's edge" : "the HUD bar"}`);

  console.log("Escape");
  await page(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))`);
  await sleep(100);
  check(await page(`!document.querySelector('[role="menu"]')`), "Escape left the + menu open");

  console.log("About");
  await page(`${PLUS}.click()`);
  await until(`Boolean(document.querySelector('[role="menu"]'))`, "the + menu again");
  await page(`[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === "About").click()`);
  await until(`Boolean(document.querySelector(".foss-earth-about__tree"))`, "the About tab", 20_000);
  await sleep(300);
  const about = await page(`(() => {
    const element = document.querySelector(".foss-earth-about");
    const part = details => ({
      line: [...details.querySelectorAll(":scope > summary > *")].map(item => ({ kind: item.className.replace("foss-earth-about__", ""), text: item.textContent })),
      commits: [...details.querySelectorAll(":scope > .foss-earth-about__body > .foss-earth-about__history > li")].map(row => [...row.children].map(cell => cell.textContent)),
    });
    const app = element.querySelector(".foss-earth-about__tree > li > details");
    return {
      title: element.querySelector("h2").textContent,
      lines: [...element.querySelectorAll(".foss-earth-about__app .foss-earth-about__line")].map(line => line.textContent),
      app: part(app),
      parts: [...app.querySelectorAll(":scope > .foss-earth-about__body > .foss-earth-about__parts > li > details")].map(part),
      scrolls: (() => { const body = element.closest(".foss-earth-dock-panel-body") ?? element.parentElement; return body.scrollHeight > body.clientHeight + 1; })(),
    };
  })()`);
  report.about = about;
  await shot("about");
  console.log(`  ${about.lines[0]}`);
  const appVersion = about.app.line.find(item => item.kind === "version")?.text;
  check(VERSION.test(appVersion ?? ""), `the app's version is "${appVersion}", not its commit's, as 26.10.7.3`);
  check(about.lines[0]?.startsWith(`Version ${appVersion}, `), `About's first line does not name the version: "${about.lines[0]}"`);
  check(!about.app.line.some(item => item.kind === "commit"), "a commit's hash stands beside the app's name");
  check(about.app.commits.length >= 1 && about.app.commits.every(row => row.length === 3), `the app's commits are not listed alike: ${JSON.stringify(about.app.commits.slice(0, 2))}`);
  console.log(`  ${about.app.line.map(item => item.text).join(" ")}; ${about.app.commits.length} commit(s), the first ${about.app.commits[0]?.[0]}; ${about.parts.length} part(s)`);
  // Each part opened in turn, to see its commits as a person would.
  await page(`document.querySelectorAll(".foss-earth-about__parts > li > details").forEach(details => { details.open = true; })`);
  await sleep(200);
  await shot("about-open");

  console.log("Swipes over the tab");
  const swipes = await page(`(() => {
    const canvas = document.querySelector("canvas");
    let handed = 0;
    const watch = event => { if (event.target === canvas) handed += 1; };
    window.addEventListener("wheel", watch, true);
    const target = document.querySelector(".foss-earth-about__title");
    const send = (deltaX, deltaY) => { const event = new WheelEvent("wheel", { deltaX, deltaY, clientX: 10, clientY: 10, bubbles: true, cancelable: true }); target.dispatchEvent(event); return event.defaultPrevented; };
    const sideways = { prevented: send(-40, 1), handed };
    handed = 0;
    window.removeEventListener("wheel", watch, true);
    return { sideways };
  })()`);
  // A swipe along the tab's scroll begins a gesture of its own, after the sideways one has ended.
  await sleep(400);
  swipes.along = await page(`(() => {
    const canvas = document.querySelector("canvas");
    let handed = 0;
    const watch = event => { if (event.target === canvas) handed += 1; };
    window.addEventListener("wheel", watch, true);
    const event = new WheelEvent("wheel", { deltaX: 0, deltaY: 40, clientX: 10, clientY: 10, bubbles: true, cancelable: true });
    document.querySelector(".foss-earth-about__title").dispatchEvent(event);
    window.removeEventListener("wheel", watch, true);
    return { prevented: event.defaultPrevented, handed };
  })()`);
  report.swipes = swipes;
  check(swipes.sideways.prevented && swipes.sideways.handed === 1, `a sideways swipe over the tab was not handed to the canvas: ${JSON.stringify(swipes.sideways)}`);
  if (about.scrolls) check(!swipes.along.prevented && swipes.along.handed === 0, `a swipe along the tab's scroll was taken from it: ${JSON.stringify(swipes.along)}`);
  else check(swipes.along.prevented && swipes.along.handed === 1, `the tab does not scroll, and a swipe down it was not handed to the canvas: ${JSON.stringify(swipes.along)}`);
  console.log(`  sideways: handed to the canvas; along it: ${about.scrolls ? "left to the tab, which scrolls" : "handed to the canvas, since the tab does not scroll"}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await tab.close();
}

writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(report.failures.length ? `\n${report.failures.length} failure(s). ${path.relative(root, out)}` : `\nPassed in ${report.browser}. ${path.relative(root, out)}`);
process.exitCode = report.failures.length ? 1 : 0;
