# Checks on a real GPU

FOSS Earth already has headless harnesses that run the renderer on this machine's own GPU,
with no HTTP server and no visible browser. Use one of these, or extend it, before writing
another. Each takes its own options, listed at the top of its script, and writes to a new
dated folder under `build/`. Retained runs are copied to `validation/evidence/`.

All of them drive Chrome through the DevTools protocol over pipes
([scripts/lib/headlessChrome.mjs](../../scripts/lib/headlessChrome.mjs)) and refuse to count
a software renderer (SwiftShader, llvmpipe) as a result. The page's own files are served
through request interception.

| Harness | What it runs | Use it for |
| --- | --- | --- |
| [scripts/validation/panorama-webgl.mjs](../../scripts/validation/panorama-webgl.mjs) | A standalone fixture: the panorama renderer and uploader in forced WebGL 1 and WebGL 2 contexts | Shader colour, orientation, depth and upload bounds on each WebGL version. [Details](panorama-webgl.md) |
| [scripts/validation/panorama-campus.mjs](../../scripts/validation/panorama-campus.mjs) | The whole app with FOSS Earth's example scenes, map tiles from the network; WebGPU by default, WebGL with `--query=renderer=webgl2`, registry values with `--query=set.<id>=…` | Orb and immersion correctness against CPU references, a negative control, colour, entering and leaving, timing |
| [scripts/validation/panorama-input.mjs](../../scripts/validation/panorama-input.mjs) | The whole app with real mouse, wheel and trackpad events | Panorama input, hover, outlines, the panorama tab |
| [benchmarks/scene-ab/run.mjs](../../benchmarks/scene-ab/run.mjs) | Any built FOSS Earth app with a scene, such as the UMN tour, at a phone's viewport, tiles recorded and replayed | A/B of registry values: pixel equivalence, and CPU and GPU milliseconds per frame. [Details](../../benchmarks/scene-ab/README.md) |
| [benchmarks/map-detail/](../../benchmarks/map-detail/README.md) | The raster runtime on WebGPU, WebGL 2 and WebGL 1 | Map imagery binding and detail sweeps |
| [scripts/check-shell-layout.mjs](../../scripts/check-shell-layout.mjs) | The shell's dock and log in Chromium through Playwright | Layout regressions |

- A forced WebGL 1 context needs either an engine built with `disableWebGL2Support` (the
  fixtures) or Chrome started with `--disable-webgl2` (`scene-ab --webgl1`). The app's
  `?renderer=webgl` setting alone does not guarantee WebGL 1.
- Chrome rounds `performance.now()` to 100 µs unless the page is cross-origin isolated.
  `scene-ab` serves every response isolated, so its sub-millisecond timings hold.
- WebGL GPU time comes from the disjoint timer query, which Chrome provides on this Mac.
  It times whole frames, and Babylon samples one frame in every few. On WebGL 1 the frame
  profiler's reading never updates after the first (2026-09-29), so there is no GPU time on
  WebGL 1 until that is fixed; `scene-ab` marks it as stale.
- Playwright is not a dependency. The harnesses that need it say so; install it with
  `npm install --prefix build/tools/playwright playwright`.
- Close Chrome on every path, with `await chrome.close()` or Playwright's `browser.close()`
  in a `finally`. A Chrome that is killed leaves a 1.4 GB clone of itself under
  `/private/var/folders` until the Mac restarts.
  [Chrome's code-sign clones](chrome-code-sign-clones.md) says why and how to check.
