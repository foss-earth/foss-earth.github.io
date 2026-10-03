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
| [scripts/validation/panorama-tiles.mjs](../../scripts/validation/panorama-tiles.mjs) | The whole app with the `umn-tiles` example, no network, on WebGPU, WebGL 2 and WebGL 1 (a second Chrome with `--disable-webgl2`) | Tiled cubes and the whole image against the source at the directions the shader drew, a seam score on tile edges, every crossfade, the outlines and the flight out. Another app's scene too, such as the UMN tour's, against a panorama's whole image (options at the top of the script) |
| [benchmarks/scene-ab/run.mjs](../../benchmarks/scene-ab/run.mjs) | Any built FOSS Earth app with a scene, such as the UMN tour, at a phone's viewport, tiles recorded and replayed | A/B of registry values: pixel equivalence, and CPU and GPU milliseconds per frame. [Details](../../benchmarks/scene-ab/README.md) |
| [benchmarks/map-detail/](../../benchmarks/map-detail/README.md) | The raster runtime on WebGPU, WebGL 2 and WebGL 1 | Map imagery binding and detail sweeps |
| [benchmarks/spherical-image-representation/run-gpu.mjs](../../benchmarks/spherical-image-representation/run-gpu.mjs) | A standalone Babylon page on WebGL 1, WebGL 2 and WebGPU: a panorama held in each of seven spherical grids, drawn by ray lookup and as mesh patches, with tiles decoded and uploaded while it draws | What a representation costs to draw, upload and refine, per frame. [Details](../../benchmarks/spherical-image-representation/README.md) |
| [benchmarks/eac-progressive-prototype/run-gpu-checks.mjs](../../benchmarks/eac-progressive-prototype/run-gpu-checks.mjs) | The progressive 360° prototype's page on WebGL 1, WebGL 2 and WebGPU, put into hard states (seams, cube corners, mixed levels) and read back | What the GPU draws against an independent CPU renderer and a closed-form pattern. [Details](../../benchmarks/eac-progressive-prototype/README.md) |
| [benchmarks/eac-progressive-prototype/run-http.mjs](../../benchmarks/eac-progressive-prototype/run-http.mjs) | The same page over real HTTP/2 from a static server on 127.0.0.1, with Chrome's network emulation, calibrated | Tile delivery against the current whole-image path; frames, caches, failures |
| [scripts/check-shell-layout.mjs](../../scripts/check-shell-layout.mjs) | The shell's dock and log in Chromium through Playwright | Layout regressions |

- A forced WebGL 1 context needs either an engine built with `disableWebGL2Support` (the
  fixtures) or Chrome started with `--disable-webgl2` (`scene-ab --webgl1`). The app's
  `?renderer=webgl` setting alone does not guarantee WebGL 1.
- Chrome rounds `performance.now()` to 100 µs unless the page is cross-origin isolated.
  `scene-ab` serves every response isolated, so its sub-millisecond timings hold.
- A millisecond figure depends on what else the machine was doing: a person using it, other
  load, memory pressure, and whether the processor idles between frames, which alone changed
  the main thread's work per frame 5 to 20 times. [Timing a benchmark on this machine](timing.md)
  has the guards, the two states to measure in, and why `requestAnimationFrame`'s timestamp
  hides a late frame.
- WebGL GPU time comes from the disjoint timer query, which Chrome provides on this Mac.
  It times whole frames, and Babylon samples one frame in every few. On WebGL 1 the frame
  profiler's reading never updates after the first (2026-09-29), so there is no GPU time on
  WebGL 1 until that is fixed; `scene-ab` marks it as stale.
- Playwright is not a dependency. The harnesses that need it say so; install it with
  `npm install --prefix build/tools/playwright playwright`.
- Over HTTPS with a self-signed loopback certificate, Chrome caches nothing in its HTTP cache,
  even with `--ignore-certificate-errors`: a warm-cache measurement needs plain HTTP on
  127.0.0.1 (`run-http.mjs --plain-http`) or a trusted certificate.
- `Network.emulateNetworkConditions` shapes traffic inside the browser, after the server has
  sent each response at full speed: a server's log never shows a transfer cut short, and a
  page's own byte count is the measure. Load the page's script before throttling, or every
  run spends its first seconds downloading the bundle.
- `performance.getEntriesByType("resource")` stops at 250 entries unless the page calls
  `performance.setResourceTimingBufferSize`.
- WebGPU's canvas on this Mac reads back BGRA, WebGL's bottom row first; a comparison across
  backends has to find out which, as `run-gpu-checks.mjs` does.
- `layout` is a reserved word in WGSL as well as in GLSL ES 3.00: a shader parameter of that
  name compiles on WebGL 1 only. WebGPU reports a refused shader as a console warning
  ("WebGPU uncaptured error") and draws nothing with it; a check has to watch the console.
- Babylon gives a texture 4× anisotropic filtering by default. On WebGL, an atlas sampled
  with implicit derivatives then gathers texels from the neighbouring slot wherever two
  pixels of a 2×2 quad read different slots: a one-pixel seam along every tile edge, about
  9% darker on this Mac. Set `anisotropicFilteringLevel = 1` on an atlas. A seam hardly moves
  a whole view's PSNR; `panorama-tiles.mjs` scores the pixels on tile edges apart, against the
  whole image's on the same pixels.
- Close Chrome on every path, with `await chrome.close()` or Playwright's `browser.close()`
  in a `finally`. A Chrome that is killed leaves a 1.4 GB clone of itself under
  `/private/var/folders` until the Mac restarts.
  [Chrome's code-sign clones](chrome-code-sign-clones.md) says why and how to check.
