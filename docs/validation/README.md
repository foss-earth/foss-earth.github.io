# Checks on a real GPU

FOSS Earth already has headless harnesses that run the renderer on this machine's own GPU,
with no HTTP server and no visible browser. Use one of these, or extend it, before writing
another. Each takes its own options, listed at the top of its script, and writes to a new
dated folder under `build/`. Retained runs are copied to `validation/evidence/`.

All of them drive Chrome through the DevTools protocol over pipes
([scripts/lib/headlessChrome.mjs](../../scripts/lib/headlessChrome.mjs)) and refuse to count
a software renderer (SwiftShader, llvmpipe) as a result. The page's own files are served
through request interception.

A check can run in Firefox and in WebKit, Safari's engine, too.
[scripts/lib/headlessPage.mjs](../../scripts/lib/headlessPage.mjs) gives a check one page, with
its requests answered by the check, a viewport, evaluation, a screenshot and a key pressed as
a person presses one, the same in all three. The check is told which requests are the
browser's for a page and which a page's own `fetch`, so it can answer a reload and a question
differently; in Chrome it can answer a service worker's requests too. Firefox is the installed one, which
[scripts/lib/headlessFirefox.mjs](../../scripts/lib/headlessFirefox.mjs) drives headless over
WebDriver BiDi with a profile of its own in the run's folder. WebKit is Playwright's build,
installed as below. `preview-sheet.mjs` and `published-version.mjs` use it; a check that reaches
for Chrome's protocol directly runs in Chrome only. Every check passed in Chrome on the day
Firefox drew every orb of the UMN tour black.

WebKit here is not Safari on a phone. It draws with WebGL 2 on this Mac's GPU, has no WebGPU
(`navigator.gpu` is absent) and nothing that turns its WebGL 2 off, and its memory is this
Mac's: it shows what Safari's engine does with the app's code, not what an iPhone's limits do.
To install it inside the checkout (Playwright 1.55 brings WebKit 26.0, 268 MB):

```sh
npm install --prefix build/tools/playwright playwright
PLAYWRIGHT_BROWSERS_PATH="$PWD/build/tools/playwright/browsers" build/tools/playwright/node_modules/.bin/playwright install webkit
```

On macOS 27 that second command downloaded the archive and then stopped while unpacking it.
Unpacking by hand worked: `unzip` the `playwright-download-webkit-*.zip` it left in the
temporary folder into `build/tools/playwright/browsers/webkit-2203/`, and add an empty file
named `INSTALLATION_COMPLETE` there.

| Harness | What it runs | Use it for |
| --- | --- | --- |
| [scripts/validation/panorama-webgl.mjs](../../scripts/validation/panorama-webgl.mjs) | A standalone fixture: the panorama renderer and uploader in forced WebGL 1 and WebGL 2 contexts | Shader colour, orientation, depth and upload bounds on each WebGL version. [Details](panorama-webgl.md) |
| [scripts/validation/panorama-campus.mjs](../../scripts/validation/panorama-campus.mjs) | The whole app with FOSS Earth's example scenes, map tiles from the network; WebGPU by default, WebGL with `--query=renderer=webgl2`, registry values with `--query=set.<id>=…` | Orb and immersion correctness against CPU references, a negative control, colour, entering and leaving, timing |
| [scripts/validation/panorama-input.mjs](../../scripts/validation/panorama-input.mjs) | The whole app with real mouse, wheel and trackpad events | Panorama input, hover, outlines, the panorama tab |
| [scripts/validation/panorama-tiles.mjs](../../scripts/validation/panorama-tiles.mjs) | The whole app with the `umn-tiles` example, no network, on WebGPU, WebGL 2 and WebGL 1 (a second Chrome with `--disable-webgl2`) | Tiled cubes and the whole image against the source at the directions the shader drew, a seam score on tile edges, every crossfade, the outlines and the flight out. Another app's scene too, such as the UMN tour's, against a panorama's whole image (options at the top of the script) |
| [scripts/validation/scene-revisit.mjs](../../scripts/validation/scene-revisit.mjs) | The whole app with a scene, a Chrome profile kept between its browsers: a build served by intercepting requests, with no HTTP cache and every response held as long as asked, or a live site read from Chrome's network events | What a first visit, a reload, a look around a panorama and a revisit ask the network for, and how long each takes. On a build it fails when anything is asked for twice; `--set=scene.panorama.savedMiB=0` is its control. On a live site it reports how the host's cache headers behave, with `--wait-min` to let them go stale |
| [scripts/validation/app-files.mjs](../../scripts/validation/app-files.mjs) | The whole app, a Chrome profile kept between its browsers: a build served by intercepting every request of the browser, its service worker's too, with no HTTP cache, or a live site read from Chrome's network events with the HTTP cache off | Which of the app's own files a first visit, a reload and a revisit ask the network for, and that its worker took over and kept them. On a build it fails when the reload or the revisit asks for one ([docs/app-files.md](../app-files.md)) |
| [scripts/validation/diagnostics.mjs](../../scripts/validation/diagnostics.mjs) | The whole app with the `umn-tiles` example, or another app's build, no network, at a phone's screen size, one Chrome profile through a visit, a crash of its renderer (`Page.crash`) and the visits after | That the trail has the build, renderer, scene and 360 image entered; that Copy report copies them; that after the crash `?report` shows the stopped visit without starting a map and the next visit's log says so; and that a visit that was left says nothing ([docs/diagnostics.md](../diagnostics.md)) |
| [scripts/validation/published-version.mjs](../../scripts/validation/published-version.mjs) | The whole app, or another app's build, no network, at a phone's screen size, in Chrome, with `--browser=` in Firefox or WebKit: the check answers the browser's requests for the page with an older copy of it, and the app's own question with the published page | A browser showing its own copy of an older page ([docs/app-files.md](../app-files.md#the-page-and-a-browsers-copy-of-it)): one reload by itself and no more, none once the page is touched, the log's lines and buttons, the two switches, a release while the page is open, `?report`, and in Chrome the same under the app's worker |
| [scripts/validation/preview-sheet.mjs](../../scripts/validation/preview-sheet.mjs) | The whole app with the `umn-tiles` example, no network, on WebGPU, WebGL 2 and WebGL 1 in Chrome, with `--browser=firefox` on WebGL 2 and WebGL 1 in Firefox, or with `--browser=webkit` on WebGL 2 in WebKit, its orb drawn 256 px across from four sides and from above | An orb drawn from a preview sheet against the same orb from its own face files, with the next view as the control, and that the sheet was the one request made |
| [benchmarks/scene-ab/run.mjs](../../benchmarks/scene-ab/run.mjs) | Any built FOSS Earth app with a scene, such as the UMN tour, at a phone's viewport, tiles recorded and replayed | A/B of registry values: pixel equivalence, and CPU and GPU milliseconds per frame. [Details](../../benchmarks/scene-ab/README.md) |
| [benchmarks/map-detail/](../../benchmarks/map-detail/README.md) | The raster runtime on WebGPU, WebGL 2 and WebGL 1 | Map imagery binding and detail sweeps |
| [scripts/validation/depth-precision.mjs](../../scripts/validation/depth-precision.mjs) | Separated opaque surfaces through the production renderer on WebGPU, WebGL 2 and WebGL 1; no network or server | Pixel-level depth ordering at flight camera distances, with conventional depth as a negative control. [Map quality recovery](map-quality-recovery.md) also records streaming, LOD and live-indicator regressions. |
| [scripts/validation/mesh-inspector.mjs](../../scripts/validation/mesh-inspector.mjs) | Solid cubes and a moving nested mesh through the production renderer on real WebGPU, WebGL 2 and WebGL 1; no network or server | Orange triangle-edge continuity, preserved solid fill, hierarchy selection, motion, visibility and occlusion, shared geometry, and resources released while off. Correctness only; no timing claim. |
| [benchmarks/spherical-image-representation/run-gpu.mjs](../../benchmarks/spherical-image-representation/run-gpu.mjs) | A standalone Babylon page on WebGL 1, WebGL 2 and WebGPU: a panorama held in each of seven spherical grids, drawn by ray lookup and as mesh patches, with tiles decoded and uploaded while it draws | What a representation costs to draw, upload and refine, per frame. [Details](../../benchmarks/spherical-image-representation/README.md) |
| [benchmarks/eac-progressive-prototype/run-gpu-checks.mjs](../../benchmarks/eac-progressive-prototype/run-gpu-checks.mjs) | The progressive 360° prototype's page on WebGL 1, WebGL 2 and WebGPU, put into hard states (seams, cube corners, mixed levels) and read back | What the GPU draws against an independent CPU renderer and a closed-form pattern. [Details](../../benchmarks/eac-progressive-prototype/README.md) |
| [benchmarks/eac-progressive-prototype/run-http.mjs](../../benchmarks/eac-progressive-prototype/run-http.mjs) | The same page over real HTTP/2 from a static server on 127.0.0.1, with Chrome's network emulation, calibrated | Tile delivery against the current whole-image path; frames, caches, failures |
| [scripts/check-shell-layout.mjs](../../scripts/check-shell-layout.mjs) | The shell's dock and log in Chromium through Playwright | Layout regressions |
| [scripts/check-hud-layout.mjs](../../scripts/check-hud-layout.mjs) | The shared toolbar, detail rail, map or panorama attribution and settings controls in headless Chromium, with synthetic data and no server or GPU | Editable priorities, visible Help/Input method at phone widths, one-row defaults, refitting, explicit wrapping, long credit truncation, compact On/Auto/Off controls before variable labels, inline Custom priority fields, sun/moon and Auto/Custom sliders, stacked FPS and tooltip dismissal, including the fallback inside a clipped panel |

The no-GPU [loaded-detail I-beam check](../../scripts/check-map-detail-marker.mjs)
drives the actual controller, rail and CSS through a fixed-request loading sequence,
checking marker movement, thumb alignment and hit-through in both themes. Its
[retained report](../../validation/evidence/map-detail/2026-10-05-loaded-detail/report.json)
and [screenshot](../../validation/evidence/map-detail/2026-10-05-loaded-detail/dark.png)
cover the shared control used by 0sfs.

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
- Every DevTools call through `scripts/lib/headlessChrome.mjs` gives up after 15 s, and an
  awaited `Runtime.evaluate` holds its call open until the page's promise settles. Start a long
  page task, store its result on `window`, and poll for it, as `panorama-campus.mjs`'s `job`
  and `panorama-tiles.mjs`'s do; the prototype's calibration hit the same limit.
- `performance.getEntriesByType("resource")` stops at 250 entries unless the page calls
  `performance.setResourceTimingBufferSize`. A scene's 720 preview requests need Chrome's
  `Network` events instead, which also say what came from the browser's cache
  (`requestServedFromCache`) and how many bytes crossed the wire (`loadingFinished`).
- A request fulfilled through `Fetch.fulfillRequest` is kept by the HTTP cache like any other
  response. To count what a page asks for itself, answer with `Cache-Control: no-store`, as
  `scene-revisit.mjs` does.
- GitHub Pages lets every file go stale after ten minutes, and its answer to "has this
  changed?" is often the whole file again: on the UMN tour, 306 of 720 images and 1.55 of
  1.72 MiB of the app. A measurement of a second visit has to say how long after the first
  it was; inside ten minutes it shows the browser's cache, not the site.
- `runtime.setViewState` puts the orbit centre back on the ground. With no terrain that is
  the ellipsoid, and an orb at a stated height leaves the frame. To orbit an orb, set the
  globe camera's `yaw` and `pitch` and leave its centre where the scene's overview put it,
  as `preview-sheet.mjs` does.
- The ground compass's N, E, S and W are drawn in the canvas, and turn with the heading. A
  comparison of two headings sees them unless it looks only at the orb's own pixels.
- A harness that serves no map leaves ground-relative orbs unplaced, and an unplaced orb is
  entered with a fade, not a flight. To time a flight in, use a scene whose orbs are
  capture-relative with a height, such as `umn-tiles`.
- `Fetch.enable` on a page's session does not reach a service worker: not the request for its
  script, so it fails to register and the app runs without it, nor the worker's own requests.
  On the browser's own session, with no session id, it reaches both; `app-files.mjs` does
  that. Do not watch a worker's own session with the `Network` domain: once a new version of
  the worker took over, the page it controlled stopped answering. A page's resource timing
  says what crossed the network instead: `transferSize` counts a file's bytes whether the page
  or its worker fetched it, and `workerStart` says the worker answered. A worker's navigation preload request is out of its reach either way, and fails as a
  network error; the app's worker then asks for the page itself. So is the browser's check of
  a worker's script for a new version, so a build cannot show one version taking over from
  another: that is checked on the live site, from a copy of the profile of a run against the
  version before (`app-files.mjs --out=` a folder holding it).
- In Firefox, a bitmap made with `createImageBitmap(bitmap, x, y, width, height)` reports the
  rectangle's size, but WebGL uploads the whole image behind it: `texSubImage2D` without a
  size fails with `INVALID_VALUE`, leaving the texture empty, and with a size it uploads the
  image's top left corner, the wrong picture and no error. Chrome uploads the rectangle. A
  bitmap drawn into a canvas and taken from it (`transferToImageBitmap`) is its own pixels in
  both (Firefox 157, 2026-10-03).
- Firefox's WebGL 1 is the preference `webgl.enable-webgl2` set to false. Its resource timing
  gives `transferSize` but leaves `workerStart` at 0 for a file its service worker answered.
- Firefox's WebDriver BiDi answers a request with `network.provideResponse` at the
  `beforeRequestSent` phase, for a host that does not exist too, and the page is a secure
  context by its `https:` address, as with Chrome's `Fetch.fulfillRequest`. Ask Firefox to
  quit with `browser.close` and wait for it.
- Playwright's `page.route` does not reach the requests a worker makes in WebKit: the app's
  tile workers asked the real network, and two runs of one view then differed by the map
  behind the orb (18 to 30 dB where they should be 51). `headlessPage.mjs` starts WebKit with a
  proxy at an address nothing listens on, which refuses whatever the routing does not answer.
  Playwright reads `PLAYWRIGHT_BROWSERS_PATH` as its module loads, so set it before that.
  A service worker is out of the routing's reach too, and once the app's worker takes control
  of the page, so is every request the page makes: inside a 360 image WebKit asked for no
  tile, where Chrome asked for 24. `headlessPage.mjs` blocks service workers in WebKit. The
  worker itself is tried against a live site, with the real network.
- `Page.crash` kills a page's renderer as a phone's browser kills a page: no `pagehide`, no
  code. The command never answers, so do not await it; `Inspector.targetCrashed` says it
  happened, and `Page.navigate` on the same target then starts a new renderer with the
  profile's `localStorage` as the crashed page left it. `diagnostics.mjs` does this.
- A navigation and a page's own `fetch` of the same address are told apart by Chrome's
  `resourceType` (`Document`), Firefox's `destination` (`document`) and Playwright's
  `isNavigationRequest()`. Under a service worker, intercepted on the browser's session, a
  navigation arrives as the worker's own request, which is none of those: its `Accept` header
  still asks for `text/html`, where a page's `fetch` asks for `*/*`.
- What a script does to a page is not a person's: `element.click()` and `dispatchEvent` make
  events with `isTrusted` false, which the app does not count as the page being touched. A
  key pressed through the browser's own input is trusted: `Input.dispatchKeyEvent` in Chrome,
  `input.performActions` in Firefox, Playwright's keyboard in WebKit. `headlessPage.mjs`
  presses Shift, which no app acts on.
- A page runs on for a moment after `location.reload()`: in Firefox its trail gained two
  steps after the one that said why it was reloading. Look for a step, not for the last one.
- With every other origin blocked, the map's tiles fail by the hundred, each with its own
  address in the message. A check that reads the log or counts its lines has to expect one
  line a kind of trouble, updated, which is what the app's `logStatus` keeps.
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
