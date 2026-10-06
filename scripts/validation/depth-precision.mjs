#!/usr/bin/env node
/** Synthetic z-fighting reproduction on the real GPU. No network/server or timing claims.
 * Usage: node scripts/validation/depth-precision.mjs [--backend=webgpu,webgl2,webgl]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";
import { openHeadlessChrome, evaluate, waitForExpression } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const backends = process.argv.find(arg => arg.startsWith("--backend="))?.slice("--backend=".length).split(",") ?? ["webgpu", "webgl2", "webgl"];
const out = newOutputDirectory("validation", "depth-precision");
process.env.TMPDIR = out;
await build({ configFile: false, root, logLevel: "warn", publicDir: false,
  build: { outDir: path.join(out, "bundle"), emptyOutDir: false, lib: {
    entry: path.join(root, "scripts/validation/depthPrecisionCheck.ts"), formats: ["iife"], name: "DepthPrecisionCheck", fileName: () => "check.js",
  } },
});
const bundle = await readFile(path.join(out, "bundle/check.js"));
const sources = {};
for (const name of ["scripts/validation/depth-precision.mjs", "scripts/validation/depthPrecisionCheck.ts", "src/engine/babylon/createRendererMode.ts"]) {
  sources[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
}
const results = [];
for (const backend of backends) {
  // Separate browsers make the WebGL 1 path use the actual production bootstrap.
  const chrome = await openHeadlessChrome(path.join(out, `chrome-profile-${backend}`), undefined,
    ["--enable-unsafe-webgpu", "--enable-gpu", "--disable-software-rasterizer",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []), ...(backend === "webgl" ? ["--disable-webgl2"] : [])]);
  try {
    const browser = (await chrome.send("Browser.getVersion")).product;
    const gpu = (await chrome.send("SystemInfo.getInfo")).gpu;
    const devices = gpu.devices.map(device => `${device.vendorString} ${device.deviceString}`).join(" ");
    if (/swiftshader|llvmpipe|software/i.test(devices)) throw new Error(`Software GPU rejected: ${devices}`);
    console.log(`GPU (${backend}): ${devices}`);
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const errors = [];
    const off = chrome.onEvent(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method !== "Fetch.requestPaused") return;
      const url = new URL(message.params.request.url);
      if (url.origin !== "https://foss-earth.test") {
        errors.push(`Unexpected network request: ${url.origin}${url.pathname}`);
        void send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" }).catch(error => errors.push(String(error)));
        return;
      }
      const body = url.pathname === "/check.js" ? bundle : Buffer.from('<!doctype html><body><script src="/check.js"></script>');
      void send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: url.pathname === "/check.js" ? "text/javascript" : "text/html" }], body: body.toString("base64") }).catch(error => errors.push(String(error)));
    });
    try {
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Emulation.setUserAgentOverride", { userAgent: "foss-earth-check/1.0" });
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await send("Page.navigate", { url: `https://foss-earth.test/?backend=${backend}` });
      await waitForExpression(chrome, sessionId, "window.depthPrecisionCheck?.done", 60_000);
      results.push({ backend, browser, gpu: { devices: gpu.devices, featureStatus: gpu.featureStatus },
        ...await evaluate(chrome, sessionId, "window.depthPrecisionCheck"), errors });
      const result = results.at(-1);
      console.log(JSON.stringify({ backend, error: result.error, errors,
        cases: result.report?.results.map(entry => ({ configuration: entry.configuration, distanceMeters: entry.distanceMeters,
          gapMeters: entry.gapMeters, correct: entry.correct, wrongPixels: entry.samples.reduce((sum, sample) => sum + sample.backgroundPixels + sample.unexpectedPixels, 0) })) }));
    } finally {
      off();
      await chrome.send("Target.closeTarget", { targetId });
    }
  } finally {
    try {
      await writeFile(path.join(out, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sources, results }, null, 2));
    } finally {
      await chrome.close();
    }
  }
}
console.log(`Evidence: ${out}`);
// The conventional case is a negative control; the production bootstrap must
// keep the foreground in front for every draw order, shift and separation.
if (results.length !== backends.length || results.some(result => result.error || result.errors.length
  || result.report?.results.filter(entry => entry.configuration === "production").length !== 3
  || result.report.results.some(entry => entry.configuration === "production" && !entry.correct)
  || !result.report.results.some(entry => entry.configuration === "conventional" && !entry.correct))) process.exitCode = 1;
