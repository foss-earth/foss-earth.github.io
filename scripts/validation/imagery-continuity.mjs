#!/usr/bin/env node
/**
 * Imagery continuity on the real GPU: a fine region's stand-in that the source
 * answers "missing" after the region's own imagery is drawn must not coarsen what
 * is drawn. WebGPU, WebGL 2 and WebGL 1, synthetic imagery, no network, server or
 * user profile, and no timing claims.
 * Usage: node scripts/validation/imagery-continuity.mjs [--backend=webgpu,webgl2,webgl]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { evaluate, openHeadlessChrome, waitForExpression } from "../lib/headlessChrome.mjs";
import { newOutputDirectory } from "../lib/outputDirectory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const backends = process.argv.find(arg => arg.startsWith("--backend="))?.slice("--backend=".length).split(",") ?? ["webgpu", "webgl2", "webgl"];
const out = newOutputDirectory("validation", "imagery-continuity");
// Chrome's temporary files stay with the run.
process.env.TMPDIR = out;
await build({ configFile: false, root, logLevel: "warn", publicDir: false,
  define: { __BUILD_TIME__: "\"fixture\"", __SOURCE_VERSION__: "\"fixture\"", __REPOSITORY_SLUG__: "\"fixture\"" },
  worker: { format: "iife" },
  build: { outDir: path.join(out, "bundle"), emptyOutDir: false, minify: false, lib: {
    entry: path.join(root, "scripts/validation/imageryContinuityCheck.ts"), formats: ["iife"], name: "ImageryContinuityCheck", fileName: () => "check.js",
  } },
});
const bundle = await readFile(path.join(out, "bundle/check.js"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const source = {
  revision: git("rev-parse", "HEAD").trim(),
  dirtyPaths: git("status", "--porcelain").split("\n").filter(Boolean).map(line => line.slice(3)),
  sha256: {},
};
for (const name of ["scripts/validation/imagery-continuity.mjs", "scripts/validation/imageryContinuityCheck.ts", "src/terrain/imagery/imagerySelector.ts",
  "src/engine/babylon/imagery/createImageryRuntime.ts", "src/engine/babylon/imagery/imageryResidency.ts", "src/engine/babylon/imagery/imageryBinding.ts",
  "src/engine/babylon/createRasterTilesRuntime.ts"]) {
  source.sha256[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
}
const results = [];
for (const backend of backends) {
  // Separate browsers make the WebGL 1 case use the production bootstrap.
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
      // The page and its script are all there is; anything else is a failure.
      if (url.origin !== "https://foss-earth.test") {
        errors.push(`Unexpected network request: ${url.origin}${url.pathname}`);
        void send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" }).catch(error => errors.push(String(error)));
        return;
      }
      const body = url.pathname === "/check.js" ? bundle : Buffer.from('<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="/check.js"></script>');
      void send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: url.pathname === "/check.js" ? "text/javascript" : "text/html" }], body: body.toString("base64") }).catch(error => errors.push(String(error)));
    });
    try {
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Emulation.setUserAgentOverride", { userAgent: "foss-earth-check/1.0" });
      await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false });
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await send("Page.navigate", { url: `https://foss-earth.test/?backend=${backend}` });
      await waitForExpression(chrome, sessionId, "window.imageryContinuityCheck?.done", 240_000);
      const { report, error } = await evaluate(chrome, sessionId, "window.imageryContinuityCheck");
      const result = { backend, browser, gpu: { devices, auxAttributes: gpu.auxAttributes }, error, errors, ...report };
      for (const [moment, png] of Object.entries(result.screenshots ?? {})) {
        const file = `${backend}-${moment}.png`;
        await writeFile(path.join(out, file), Buffer.from(png.split(",")[1], "base64"));
        result.screenshots[moment] = file;
      }
      results.push(result);
    } finally {
      off();
      await chrome.send("Target.closeTarget", { targetId });
    }
  } catch (error) {
    results.push({ backend, error: error instanceof Error ? error.message : String(error), errors: [] });
  } finally {
    try {
      await writeFile(path.join(out, "report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), source, results }, null, 2)}\n`);
    } finally {
      await chrome.close();
    }
  }
}
const status = result => result.error || result.errors.length ? "failed" : result.available === false ? "unavailable" : result.passed ? "passed" : "failed";
console.table(results.map(result => ({
  backend: result.backend, status: status(result), renderer: result.renderer ? JSON.stringify(result.renderer).slice(0, 80) : "-",
  reason: result.reason ?? result.error?.split("\n")[0] ?? result.errors[0] ?? result.checks?.filter(check => !check.passed).map(check => check.name).join("; ") ?? "",
})));
console.log(`Evidence: ${out}`);
// An unavailable backend is recorded as such, never as a pass.
if (results.length !== backends.length || results.some(result => status(result) !== "passed")) process.exitCode = 1;
