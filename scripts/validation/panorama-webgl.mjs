#!/usr/bin/env node
/** Real GPU checks of WebGL 1/2 panorama color, depth, upload bounds and steady drawing; no server. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";
import { openHeadlessChrome, evaluate, waitForExpression } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = newOutputDirectory("validation", "panorama-webgl");
await mkdir(out, { recursive: true });
process.env.TMPDIR = out;
await build({
  configFile: false, root, logLevel: "warn",
  build: { outDir: path.join(out, "bundle"), emptyOutDir: false, lib: {
    entry: path.join(root, "scripts/validation/panoramaWebglCheck.ts"), formats: ["iife"], name: "PanoramaCheck", fileName: () => "check.js",
  } },
});
const bundle = await readFile(path.join(out, "bundle/check.js"));
const chrome = await openHeadlessChrome(path.join(out, "chrome-profile"));
const results = [];
const browser = await chrome.send("Browser.getVersion");
const sources = {};
for (const name of ["scripts/validation/panorama-webgl.mjs", "scripts/validation/panoramaWebglCheck.ts", "src/engine/babylon/panorama/panoramaRenderer.ts", "src/engine/babylon/panorama/panoramaShadersWebGL.ts", "src/engine/babylon/panorama/panoramaTextures.ts", "src/engine/babylon/panorama/panoramaWebGlTextures.ts"]) {
  sources[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
}
try {
  for (const backend of ["webgl1", "webgl2"]) {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const errors = [];
    const off = chrome.onEvent(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map(value => value.value ?? value.description).join(" "));
      if (message.method !== "Fetch.requestPaused") return;
      const url = new URL(message.params.request.url);
      const body = url.pathname === "/check.js" ? bundle : Buffer.from('<!doctype html><body><script src="/check.js"></script>');
      void send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: url.pathname === "/check.js" ? "text/javascript" : "text/html" }], body: body.toString("base64") }).catch(error => errors.push(String(error)));
    });
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setUserAgentOverride", { userAgent: "foss-earth-check/1.0" });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await send("Page.navigate", { url: `https://foss-earth.test/?backend=${backend}` });
    await waitForExpression(chrome, sessionId, "window.panoramaCheck?.done", 60_000);
    const result = await evaluate(chrome, sessionId, "window.panoramaCheck");
    results.push({ backend, ...result, errors });
    console.log(JSON.stringify(results.at(-1)));
    off();
    await chrome.send("Target.closeTarget", { targetId });
  }
} finally {
  try {
    await writeFile(path.join(out, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), browser: browser.product, sources, results }, null, 2));
  } finally {
    await chrome.close();
    console.log(`Evidence: ${out}`);
  }
}
if (results.length !== 2 || results.some(result => !result.ok || result.errors.length || /swiftshader|llvmpipe|software/i.test(result.report?.renderer ?? "software"))) process.exitCode = 1;
