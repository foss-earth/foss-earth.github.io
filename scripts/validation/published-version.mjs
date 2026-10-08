#!/usr/bin/env node
/**
 * A browser showing its own copy of an older page of the app (docs/app-files.md,
 * "The page, and a browser's copy of it"), on a build in headless Chrome, Firefox
 * or WebKit, with no network. A phone's browser restoring a tab does that: an
 * iPhone ran the UMN tour's app of two days before from Safari's copy of its page.
 *
 * The check is the site and the browser's copy both. A request the browser makes
 * for the page (a navigation) is answered with the copy while the case says the
 * browser still has one: the build's page with an older build stamp. The app's own
 * question, a `fetch` of the page, is always answered with the published page.
 *
 * It checks that:
 *   - a page that is the published one asks once, reloads nothing and says nothing;
 *   - an older copy reloads itself once, before anyone touches it, and the page that
 *     comes says so in its log; the copy's trail ends as closed, with why it went;
 *   - a browser that answers the reload with its copy again is not reloaded forever:
 *     the page says so, with a button, and Settings → App files offers the reload;
 *   - a page a person touched before the answer came is not reloaded: its log says a
 *     newer version is published, with a button that reloads;
 *   - with Reload an older page by itself off the page waits for the button, and
 *     with Ask which version is published off the site is asked nothing;
 *   - a release while the page is open reloads an untouched page at its next question;
 *   - the report-only page (?report) says the page is an older one, and stays;
 *   - in Chrome, with the app's own worker in control of the page, the same reload
 *     happens: the worker lets the question and the reload through.
 *
 *   node scripts/validation/published-version.mjs [--browser=chrome|firefox|webkit] [--dist=<a build>]
 *     [--content=<a folder of the files the build leaves out>] [--path=/] [--query=] [--out=<folder>]
 *
 * The UMN tour: --dist=<tour>/dist-app --content=<tour>/public --path=/tour/twin-cities/
 *
 * Output: build/validation/published-version/<date>_<time>/ with report.json, summary.md and screenshots.
 * What it cannot show is what Safari on a phone does when it restores a tab: that is the phone's to show.
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
const out = arg("out") ? path.resolve(arg("out")) : newOutputDirectory("validation", "published-version");
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
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const T = "window.__fossEarthPanoramaTest";
const META = /(<meta name="foss-earth-build" content=")([^"]*)(")/;
// A phone's screen: the reload has to be reachable on it.
const VIEWPORT = { width: 414, height: 896 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const pageFile = path.join(dist, pagePath.slice(1), "index.html");
const html = await readFile(pageFile, "utf8");
const PUBLISHED = META.exec(html)?.[2];
if (!PUBLISHED) throw new Error(`${path.relative(root, pageFile)} carries no build stamp: is it built with FOSS Earth's appFiles plugin (vite/appFiles.ts)?`);
/** The browser's copy is of two days before, as the iPhone's was; a later release is a day after. */
const OLDER = new Date(Date.parse(PUBLISHED) - 2 * 86_400_000).toISOString();
const NEWER = new Date(Date.parse(PUBLISHED) + 86_400_000).toISOString();
const stamped = stamp => html.replace(META, `$1${stamp}$3`);
/** A build as a log line names it, to the minute. */
const said = stamp => `${stamp.slice(0, 16).replace("T", " ")} UTC`;

const report = { browser: null, page: `${ORIGIN}${pagePath}`, published: PUBLISHED, older: OLDER, cases: [], failures: [] };
let current = null;
const fail = message => { report.failures.push(`${current.name}: ${message}`); current.failures.push(message); console.log(`  ✗ ${message}`); };
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

/** What the page says: its own stamp, what the check knows of the published one, and its log. */
const READ = `(() => {
  const t = ${T};
  if (!t?.publishedVersion) return null;
  return {
    stamp: document.querySelector('meta[name="foss-earth-build"]')?.content ?? null,
    state: t.publishedVersion.state(),
    controlled: Boolean(navigator.serviceWorker?.controller),
    log: [...document.querySelectorAll("#app-log .game-log__line")].map(line => ({ text: line.querySelector(".game-log__text").textContent, tone: line.dataset.tone, actions: [...line.querySelectorAll(".game-log__actions button")].map(button => button.textContent) })),
  };
})()`;
const VERSION_LINE = /older (page|version) of the app|published version of the app/;

/**
 * One case, in a browser of its own. `site` is what the check answers with: `published` to the app's question and to a
 * navigation the browser asks the network for, `copy` to the first `copies` navigations, as a browser that shows its own.
 */
async function run(name, { query = {}, copy = null, copies = 0, workers = false }, work) {
  current = { name, failures: [] };
  report.cases.push(current);
  console.log(name);
  const site = { published: PUBLISHED, copy, copies, navigations: 0, questions: 0, hold: null };
  const tab = await openHeadlessPage(browser, path.join(out, `${browser}-profile-${report.cases.length}`), {
    ...VIEWPORT, binary: arg(browser), workers, chromeArgs: ["--enable-webgpu-developer-features"],
    async respond(url, { navigation }) {
      if (url.origin !== ORIGIN) return null;
      if (url.pathname === pagePath) {
        let stamp = site.published;
        if (navigation) {
          site.navigations += 1;
          if (site.copy && site.copies > 0) { site.copies -= 1; stamp = site.copy; }
        } else {
          site.questions += 1;
          await site.hold;
        }
        return { status: 200, headers: { "Content-Type": "text/html", "Cache-Control": "no-store" }, body: stamped(stamp) };
      }
      const file = await fileFor(url);
      if (!file) return { status: 404, body: "" };
      return { status: 200, headers: { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }, body: await readFile(file) };
    },
  });
  try {
    report.browser = tab.product;
    const page = expression => tab.evaluate(expression);
    const until = async (condition, what, timeoutMs = 60_000) => {
      const started = Date.now();
      for (;;) {
        // A page that is reloading answers nothing for a moment.
        const read = await page(READ).catch(() => null);
        const value = await condition(read);
        if (value) return read ?? value;
        if (Date.now() - started > timeoutMs) throw new Error(`${what} did not happen in ${timeoutMs / 1000} s (${JSON.stringify({ navigations: site.navigations, questions: site.questions, state: read?.state ?? null, log: read?.log.map(line => line.text).filter(text => VERSION_LINE.test(text)) ?? null })})`);
        await sleep(200);
      }
    };
    const address = (extra = {}) => `${ORIGIN}${pagePath}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(arg("query", ""))), panoramaTest: "1", ...query, ...extra })}`;
    const click = label => page(`[...document.querySelectorAll("#app-log .game-log__line button")].find(button => button.textContent === ${JSON.stringify(label)}).click(); true`);
    const shot = async file => writeFileSync(path.join(out, `${browser}-${file}.png`), await tab.screenshot());
    await work({ tab, site, page, until, address, click, shot, versionLines: read => read.log.filter(line => VERSION_LINE.test(line.text)) });
  } catch (error) {
    fail(error.message);
  } finally {
    await tab.close();
  }
}

// ─── A page that is the published one ───
await run("The published page", {}, async ({ tab, site, page, until, address, versionLines, shot }) => {
  await tab.navigate(address());
  const read = await until(value => value?.state.kind === "published", "the site's answer");
  await sleep(1500);
  expect(site.navigations === 1 && site.questions === 1, "the app asked the site once and did not reload", `${site.navigations} navigations and ${site.questions} questions`);
  expect(read.stamp === PUBLISHED && versionLines(read).length === 0, "and its log says nothing of versions", `its log says: ${JSON.stringify(versionLines(read))}`);
  await page(`window.__report = undefined; ${T}.diagnostics.report().then(text => { window.__report = text; }); true`);
  const text = await until(() => page("window.__report"), "the report", 10_000).then(() => page("window.__report"));
  expect(text.includes(`Published: This page is the published version of the app, built ${PUBLISHED}`), "the report says the page is the published version", `the report lacks it: ${/^Published:.*$/m.exec(text)?.[0]}`);

  await page(`document.querySelector("#settingsButton").click(); true`);
  const section = `document.querySelector(".foss-earth-app-files-section")`;
  await until(() => page(`(() => { const section = ${section}; if (!section) return null; const details = section.closest("details"); if (details) details.open = true; section.scrollIntoView({ block: "center" }); return true; })()`), "Settings → App files", 10_000);
  const shown = await page(`(() => { const section = ${section}; return { says: [...section.querySelectorAll("[role=status]")].map(p => p.textContent), buttons: [...section.querySelectorAll("button")].map(b => ({ text: b.textContent, hidden: b.hidden, disabled: b.disabled })) }; })()`);
  expect(shown.says.some(says => says.startsWith("This page is the published version of the app")) && shown.buttons.some(b => b.text === "Ask now" && !b.disabled) && shown.buttons.some(b => /^Reload/.test(b.text) && b.hidden), "Settings → App files says so, and offers to ask again", `Settings → App files shows ${JSON.stringify(shown)}`);
  await page(`[...${section}.querySelectorAll("button")].find(button => button.textContent === "Ask now").click(); true`);
  await until(() => site.questions === 2, "the question Ask now asks", 10_000);
  pass("Ask now asked the site again");
  await shot("app-files-published");
});

// ─── The phone's case: the browser opens its own copy of an older page ───
await run("An older copy, opened once", { copy: OLDER, copies: 1 }, async ({ tab, site, page, until, address, versionLines }) => {
  await tab.navigate(address());
  const read = await until(value => site.navigations >= 2 && value?.state.kind === "published", "the reload and the published page");
  await sleep(1500);
  expect(site.navigations === 2 && read.stamp === PUBLISHED, "the copy reloaded itself once, into the published page", `${site.navigations} navigations, the page is of ${read.stamp}`);
  const lines = versionLines(read);
  expect(lines.length === 1 && lines[0].text === `This browser opened its own copy of an older page of the app, built ${said(OLDER)}. The page reloaded itself, and this is the published version, built ${said(PUBLISHED)}.`, `its log says: "${lines[0]?.text}"`, `its log says ${JSON.stringify(lines)}`);
  await page(`window.__previous = undefined; ${T}.diagnostics.previous().then(value => { window.__previous = value ? { ended: value.ended, steps: value.record.steps.map(step => step.text) } : null; }); true`);
  await until(() => page("window.__previous !== undefined"), "the copy's trail", 10_000);
  const previous = await page("window.__previous");
  // A page runs on for a moment after it asks to be reloaded: being hidden, or a warning, may be a later step.
  expect(previous?.ended === "closed" && previous.steps.some(text => /Reloading to use it\.$/.test(text)), "the copy's trail ended as closed, with why it went", `the copy's trail: ${JSON.stringify(previous)}`);
  expect(!read.log.some(line => /stopped without being closed/.test(line.text)), "and the page does not take the reload for a crash", "the page took the reload for a crash");
  const kept = await page(`Object.entries(sessionStorage).filter(([key]) => key.startsWith("foss-earth.reloaded-for")).map(([, value]) => JSON.parse(value))`);
  expect(kept.length === 1 && kept[0].arrived === true && kept[0].to === PUBLISHED, "the tab remembers that the reload gave the published page", `the tab keeps ${JSON.stringify(kept)}`);
});

// ─── A browser that answers the reload with its copy again ───
await run("An older copy the browser keeps answering with", { copy: OLDER, copies: Infinity }, async ({ tab, site, page, until, address, click, versionLines, shot }) => {
  await tab.navigate(address());
  const read = await until(value => site.navigations >= 2 && value?.state.kind === "older" && versionLines(value).length > 0, "the copy again after its reload");
  await sleep(3000);
  expect(site.navigations === 2, "the copy reloaded itself once and no more", `${site.navigations} navigations`);
  const [line] = versionLines(read);
  expect(line.tone === "warning" && line.text === `This browser still shows its own copy of an older page of the app, built ${said(OLDER)}, after a reload: the published one was built ${said(PUBLISHED)}. Closing this tab and opening the address again gets it.` && line.actions.includes("Reload"), `its log says, with a button: "${line.text.slice(0, 96)}…"`, `its log says ${JSON.stringify(versionLines(read))}`);

  await page(`document.querySelector("#settingsButton").click(); true`);
  const section = `document.querySelector(".foss-earth-app-files-section")`;
  await until(() => page(`(() => { const section = ${section}; if (!section) return null; const details = section.closest("details"); if (details) details.open = true; [...section.querySelectorAll("button")].at(-1).scrollIntoView({ block: "center" }); return true; })()`), "Settings → App files", 10_000);
  const shown = await page(`(() => { const section = ${section}; const reload = [...section.querySelectorAll("button")].find(b => /^Reload/.test(b.textContent)); return { says: [...section.querySelectorAll("[role=status]")].map(p => p.textContent), reload: reload && !reload.hidden ? reload.getBoundingClientRect().toJSON() : null, width: innerWidth }; })()`);
  expect(shown.says.some(says => says.startsWith(`This page is an older version of the app, built ${OLDER}: the published one was built ${PUBLISHED}`)), "Settings → App files says which version this is and which is published", `Settings → App files says ${JSON.stringify(shown.says)}`);
  expect(shown.reload && shown.reload.left >= 0 && shown.reload.right <= shown.width, `and offers the reload, on a ${VIEWPORT.width} px wide screen`, `its reload button: ${JSON.stringify(shown.reload)}`);
  await shot("app-files-older");

  // The browser lets go of its copy: the person's own reload gets the published page.
  site.copies = 0;
  await click("Reload");
  const after = await until(value => site.navigations >= 3 && value?.state.kind === "published", "the published page after the button");
  const lines = versionLines(after);
  expect(after.stamp === PUBLISHED && lines.length === 1 && lines[0].text === `Reloaded: this is the published version of the app, built ${said(PUBLISHED)}; the page before was built ${said(OLDER)}.`, `the button reloaded into the published page: "${lines[0]?.text}"`, `after the button: the page is of ${after.stamp}, its log says ${JSON.stringify(lines)}`);
});

// ─── Touched before the answer came ───
await run("An older copy a person touched first", { copy: OLDER, copies: 1 }, async ({ tab, site, until, address, click, versionLines }) => {
  let release;
  site.hold = new Promise(resolve => { release = resolve; });
  await tab.navigate(address());
  await until(value => site.questions === 1 && value, "the app and its question");
  await tab.touch();
  await sleep(300);
  release();
  const read = await until(value => value?.state.kind === "older" && versionLines(value).length > 0, "the answer, and what the log says of it");
  await sleep(2000);
  expect(site.navigations === 1, "a page that was touched did not reload itself", `${site.navigations} navigations`);
  const [line] = versionLines(read);
  expect(line.tone === "warning" && line.text === `This page is an older version of the app, built ${said(OLDER)}: the published one was built ${said(PUBLISHED)}. Reload to use it.` && line.actions.includes("Reload"), `its log says, with a button: "${line.text}"`, `its log says ${JSON.stringify(versionLines(read))}`);
  site.hold = null;
  await click("Reload");
  const after = await until(value => site.navigations >= 2 && value?.state.kind === "published", "the published page after the button");
  expect(after.stamp === PUBLISHED, "the button reloaded into the published page", `after the button the page is of ${after.stamp}`);
});

// ─── The two switches ───
await run("Reload an older page by itself, off", { copy: OLDER, copies: 1, query: { "set.app.reloadOlderPage": "false" } }, async ({ tab, site, until, address, versionLines }) => {
  await tab.navigate(address());
  const read = await until(value => value?.state.kind === "older" && versionLines(value).length > 0, "the answer, and what the log says of it");
  await sleep(2000);
  expect(site.navigations === 1 && versionLines(read)[0].actions.includes("Reload"), "the page waits for the button", `${site.navigations} navigations, log ${JSON.stringify(versionLines(read))}`);
});

await run("Ask which version is published, off", { copy: OLDER, copies: 1, query: { "set.app.checkPublished": "false" } }, async ({ tab, site, until, address, versionLines }) => {
  await tab.navigate(address());
  const read = await until(value => value, "the app");
  await sleep(3000);
  expect(site.questions === 0 && site.navigations === 1 && read.state.kind === "off" && versionLines(read).length === 0, "the site was asked nothing, and the copy stayed", `${site.questions} questions, ${site.navigations} navigations, ${JSON.stringify(read.state)}`);
});

// ─── A release while the page is open ───
await run("A release while the page is open", {}, async ({ tab, site, page, until, address, versionLines }) => {
  await tab.navigate(address());
  await until(value => value?.state.kind === "published", "the site's answer");
  site.published = NEWER;
  // The question the page asks again after app.checkPublishedEvery, asked now.
  await page(`void ${T}.publishedVersion.ask(); true`);
  const read = await until(value => site.navigations >= 2 && value?.state.kind === "published" && value.stamp === NEWER, "the reload into the release");
  const lines = versionLines(read);
  expect(site.navigations === 2 && lines.length === 1 && /The page reloaded itself, and this is the published version/.test(lines[0].text), "an untouched page reloaded itself into the release, and says so", `${site.navigations} navigations, log ${JSON.stringify(lines)}`);
});

// ─── The report alone, on an older copy ───
await run("The report-only page on an older copy", { copy: OLDER, copies: Infinity }, async ({ tab, site, page, until, address }) => {
  await tab.navigate(address({ report: "" }));
  await until(() => page(`(() => { const text = document.querySelector(".foss-earth-report-only textarea"); return Boolean(text && !text.hidden && text.value); })()`), "the report", 15_000);
  await sleep(1500);
  const text = await page(`document.querySelector(".foss-earth-report-only textarea").value`);
  writeFileSync(path.join(out, `${browser}-report-only.txt`), text);
  expect(text.includes(`Published: This page is an older version of the app, built ${OLDER}: the published one was built ${PUBLISHED}`), "the report says the page is an older version, and which is published", `the report says: ${/^Published:.*$/m.exec(text)?.[0]}`);
  expect(site.navigations === 1 && site.questions === 1, "and the page stayed, to be read", `${site.navigations} navigations, ${site.questions} questions`);
});

// ─── Under the app's own worker ───
if (browser === "chrome") {
  await run("An older copy under the app's worker", { workers: true }, async ({ tab, site, until, address, versionLines }) => {
    await tab.navigate(address());
    await until(value => value?.state.kind === "published" && value.controlled, "the worker taking control of the page", 90_000);
    pass("the app's worker controls the page");
    // Days later, the browser opens its copy of that day's page, through the worker.
    site.copy = OLDER;
    site.copies = 1;
    await tab.navigate("about:blank");
    await sleep(300);
    const before = { navigations: site.navigations, questions: site.questions };
    await tab.navigate(address());
    const read = await until(value => site.navigations >= before.navigations + 2 && value?.state.kind === "published", "the reload and the published page");
    await sleep(1500);
    const lines = versionLines(read);
    expect(site.navigations === before.navigations + 2 && read.controlled && read.stamp === PUBLISHED, "under the worker the copy reloaded itself once, into the published page", `${site.navigations - before.navigations} navigations, controlled ${read.controlled}, the page is of ${read.stamp}`);
    expect(site.questions === before.questions + 2 && lines.length === 1 && /The page reloaded itself/.test(lines[0].text), "the worker let the app's question through, once a page", `${site.questions - before.questions} questions, log ${JSON.stringify(lines)}`);
  });
}

report.passed = report.failures.length === 0;
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(out, "summary.md"), [
  "# A browser's copy of an older page", "",
  `${report.passed ? "Passed" : "Failed"} on ${report.browser ?? browser}, ${report.page}: the published page built ${PUBLISHED}, the browser's copy ${OLDER}.`, "",
  "| Case | |", "| --- | --- |",
  ...report.cases.map(each => `| ${each.name} | ${each.failures.length ? each.failures.join("; ") : "passed"} |`), "",
].join("\n"));
console.log(`${report.passed ? "Passed" : "Failed"}: ${path.relative(root, out)}`);
if (!report.passed) process.exitCode = 1;
