#!/usr/bin/env node
/** Mesh selection/wireframe correctness on each real GPU backend, without a server.
 * Usage: node scripts/validation/mesh-inspector.mjs [--backend=webgpu,webgl2,webgl]
 * Deliberately makes no timing claims: the user may be using the machine.
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
if (backends.some(backend => !["webgpu", "webgl2", "webgl"].includes(backend))) throw new Error("Unknown backend");
const out = newOutputDirectory("validation", "mesh-inspector");
process.env.TMPDIR = out;
console.log(`Evidence: ${out}`);
await build({ configFile: false, root, logLevel: "warn", publicDir: false,
  build: { outDir: path.join(out, "bundle"), emptyOutDir: false, lib: {
    entry: path.join(root, "scripts/validation/meshInspectorCheck.ts"), formats: ["iife"], name: "MeshInspectorCheck", fileName: () => "check.js",
  } },
});
const bundle = await readFile(path.join(out, "bundle/check.js"));
const sources = {};
for (const name of ["scripts/validation/mesh-inspector.mjs", "scripts/validation/meshInspectorCheck.ts", "src/diagnostics/createMeshInspector.ts", "src/engine/babylon/createRendererMode.ts"]) {
  sources[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
}
const results = [];
for (const backend of backends) {
  const chrome = await openHeadlessChrome(path.join(out, `chrome-profile-${backend}`), undefined,
    ["--enable-unsafe-webgpu", "--enable-gpu", "--disable-software-rasterizer",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []), ...(backend === "webgl" ? ["--disable-webgl2"] : [])]);
  const errors = [];
  const warnings = [];
  let result = { backend, errors, warnings };
  try {
    const browser = (await chrome.send("Browser.getVersion")).product;
    const gpu = (await chrome.send("SystemInfo.getInfo")).gpu;
    const devices = gpu.devices.map(device => `${device.vendorString} ${device.deviceString}`).join(" ");
    if (/swiftshader|llvmpipe|software/i.test(devices)) throw new Error(`Software GPU rejected: ${devices}`);
    console.log(`GPU (${backend}): ${devices}`);
    result = { ...result, browser, gpu: { devices: gpu.devices, featureStatus: gpu.featureStatus } };
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const off = chrome.onEvent(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method === "Runtime.consoleAPICalled" && ["warning", "error"].includes(message.params.type)) {
        const text = message.params.args.map(arg => arg.value ?? arg.description ?? "").join(" ");
        warnings.push(text);
        if (message.params.type === "error" || /webgpu uncaptured error|shader.*error|compilation.*error|validation.*error/i.test(text)) errors.push(text);
      }
      if (message.method !== "Fetch.requestPaused") return;
      const url = new URL(message.params.request.url);
      if (url.origin !== "https://foss-earth.test") {
        errors.push(`Unexpected network request: ${url.origin}${url.pathname}`);
        void send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" }).catch(error => errors.push(String(error)));
        return;
      }
      const body = url.pathname === "/check.js" ? bundle : Buffer.from('<!doctype html><meta charset="utf-8"><body><script src="/check.js"></script>');
      void send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: url.pathname === "/check.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" }, { name: "Cache-Control", value: "no-store" }],
        body: body.toString("base64") }).catch(error => errors.push(String(error)));
    });
    try {
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Emulation.setUserAgentOverride", { userAgent: "foss-earth-check/1.0" });
      await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 930, deviceScaleFactor: 1, mobile: false });
      await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await send("Page.navigate", { url: `https://foss-earth.test/?backend=${backend}` });
      await waitForExpression(chrome, sessionId, "window.meshInspectorCheck?.done", 60_000);
      result = { ...result, ...await evaluate(chrome, sessionId, "window.meshInspectorCheck") };
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(out, `${backend}.png`), Buffer.from(screenshot.data, "base64"));
      console.log(JSON.stringify({ backend, error: result.error, errors, checks: result.report?.checks }));
    } finally {
      off();
      await chrome.send("Target.closeTarget", { targetId });
    }
  } catch (error) {
    result.error = error instanceof Error ? error.stack : String(error);
    console.error(result.error);
  } finally {
    results.push(result);
    try {
      await writeFile(path.join(out, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sources,
        scope: "Real-GPU correctness only; no timing qualification or device performance claim.", results }, null, 2));
    } finally {
      await chrome.close();
    }
  }
}
if (results.length !== backends.length || results.some(result => result.error || result.errors.length || !result.report?.checks.every(check => check.passed))) process.exitCode = 1;
