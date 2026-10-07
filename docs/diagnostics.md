# Diagnostics

When the app goes wrong on a device with no console, a phone above all, the app itself has to
say what happened. It says which version it is as it opens, keeps a trail of each visit, tells
the next visit when one stopped without being closed, and gives a report to copy.

## World vector drawing

`createVectorDebugDrawing(scene, parent, options)` from `foss-earth/diagnostics`
draws named, colored vectors and optional magnitude labels in the supplied parent's
local coordinates. Anchors and directions follow its world transform, including a
host application's floating-origin updates. It has no aircraft or physics model
dependencies; the caller supplies observed vectors and the settings' UI home.

The caller provides `enabled`, `valuePerMeter`, `maxArrowMeters`, `labels`, and
`labelRefreshHz`, plus a label conversion `valueDisplayScale` and `valueUnit`.
Arrow geometry uses the input magnitude divided by `valuePerMeter`; labels retain
the full magnitude even when the arrow is capped. Zero, missing or nonfinite
vectors are hidden. Glyphs currently draw through other geometry for diagnostics.

A vector with `shape: "arc"` is a rotation, such as a moment, a torque or an
angular velocity. It draws as an arc about the vector's direction through its
anchor, swept by the right-hand rule, with an arrowhead showing the sense. The
optional `arcs` settings give its `valuePerDegree`, `radiusMeters` and
`maxSweepDegrees` (at most a full turn); without them arcs stay hidden and the
drawing reports it once. `arcValueDisplayScale` and `arcValueUnit` label arcs
in their own unit. An arc starts from the parent's local up projected onto its
plane, or from local forward when its axis is within 30° of up, so a reversed
rotation starts at the same place and only its sense changes. Arrows and arcs
share one drawing, its readiness and its label clock.

Call `update(vectors, timeSeconds, withinScheduledFrame = false)` when the observed
values change. Label refresh follows the supplied clock and holds when it holds;
no internal timer runs. A scheduled scene tick passes `true` to avoid requesting
another frame for its synchronous changes. Unchanged vectors ask for no frame.
New glyphs prepare hidden with `whenMeshesReady`, then reveal together and request
their own frame. `setSettings` applies live changes, and disabling or `dispose()`
frees geometry, materials and label textures and cancels pending readiness.

Tests cover transformed anchors/directions, readiness, paused rendering, scale
caps, label units/rate, invalid data and disposal with Babylon's NullEngine, and
an arc's plane, radius, sense, start, sweep cap and shape changes. They
do not qualify a device's renderer or graphics cost.

## Mesh tree and polygon edges

`createMeshInspector(scene, { requestRender })` from `foss-earth/diagnostics`
inspects only the roots the caller supplies with `setRoots`. Its stable
`getSnapshot()` and `subscribe()` pair expose a hierarchy of names and mesh IDs,
selection, and mixed branch selection. `setSelected(id, selected)` selects that
node's geometry and every mesh below it; `selectAll(selected)` affects all roots.
Selecting meshes never changes their visibility or materials. New models start
fully selected; rebuilding the tree with the same nodes preserves selection.

`setEnabled(true)` adds orange triangle edges for the selected meshes. The helper
shares the original geometry buffers, skeleton, bind pose and morph targets, and
parents each overlay to its source so moving parts remain aligned. A single
observer, present only while overlays exist, respects independently hidden parts,
opacity, rendering groups and camera layer masks before each active-mesh pass.
Overlays prepare hidden with `whenMeshesReady` and reveal together. Selection
changes request a frame only when they change visible edges; no timer or render
loop runs while idle.

Each selected mesh adds one native wireframe draw and one cached line index
buffer: six 16-bit or 32-bit indices per triangle, 12 or 24 bytes. Vertices and
textures are not copied and no adjacency search or edge geometry expansion runs.
The line path is Babylon's WebGPU/WebGL 2/WebGL 1 implementation. A small GLSL/WGSL
vertex adjustment biases edge depth by one camera-plane pixel, scaled by the
projection and viewport height; this avoids broken coplanar lines without disabling
depth tests. Native polygon depth bias does not affect WebGL lines and is rejected
for WebGPU line lists. Edges follow the
asset's triangles, including triangulation diagonals; original Blender quad
boundaries are not stored in a triangulated glTF. Disabling or disposing releases
the overlays, line buffers, material and observer. Selection remains available
while disabled. The caller owns the setting and its UI home; 0SFS places it in
Aircraft, and supplies only aircraft model roots, leaving effects outside the tree.

[The real-GPU fixture](../scripts/validation/mesh-inspector.mjs) passed 23 checks
on each of WebGPU, WebGL 2 and forced WebGL 1 in Chrome 154 on an Apple M5 on
2026-10-05. It checks continuous triangle edges with preserved solid fill,
orthographic and perspective depth/occlusion at 10 m and 1,000 m, nested selection
and motion, hidden sources, shared geometry and resources released while off.
The [retained report and screenshots](../validation/evidence/mesh-inspector/2026-10-05/README.md)
record the exact conditions. This is a correctness check, without a timing or
device-performance qualification.

## Why

On 2026-10-03 the UMN tour was tried on two phones. One drew every orb black; the other kept
crashing, and then showed a scene error that only an older version of the app could give.
Nothing said which version had run, on which renderer, or what the page had been doing when it
stopped. A page that a browser kills, as a phone does to one that takes too much memory, runs
no code as it goes, so there is nothing to ask afterwards unless it wrote things down first.
Until then the app caught no unhandled error, said nothing when the GPU's device was lost, and
left the renderer's warnings (a refused shader, a GPU error) in a console a phone does not show.

## Which version runs

A device shows what it has, which is not always what was published: on 2026-10-04 an iPhone
was still running the UMN tour's app of two days and four releases before, from Safari's copy
of the page, and it took the sections missing from its Settings tab to tell
([app-files.md](app-files.md#the-page-and-a-browsers-copy-of-it)). So the app says which
build it is, in four places:

- **The log's first line, as the app opens**: "App built 2026-10-04 19:45 UTC from a2c6c28
  with FOSS Earth 35ad0e3." The time is the build's, to the minute; the first commit is the
  app's own repository's and the second FOSS Earth's, in an app built on it from another
  repository. `-dirty` after a commit says the build had changes not committed.
- **About**, a tab of its own under +: the build's time and bundle, whether the page is the
  published version, and everything the app is built from as a tree, the app at the top and
  what each part brings in under it. A checkout linked into the app, as FOSS Earth and
  gamepad-tools are, gives its commit, whether it had changes not committed or was not
  pushed when the app was built, its latest commits and, where it is built on its own, when;
  a package gives its version. Each links to its commit, its history up to that commit and
  its source. A package two parts bring in is listed in full once and pointed to from the
  other, since the build holds one copy. It is read from the page itself, written there by
  `builtFrom()` from `foss-earth/vite`, so a browser's own copy of an older page shows what
  that page was built from. An app built without the plugin names its two commits there
  instead. Its last line, the site's latest deploy, is asked of GitHub the first time About
  is shown and is the site's, not this page's: a page a browser kept from days before shows
  the newest deploy there too. Until 2026-10-04 it was labelled "Deploy", and an iPhone
  running the UMN tour's app of 2026-10-03 showed that day's deploy under it. Until
  2026-10-07 About was the last section of Settings, where someone looking for which version
  runs did not find it.
- **The report**, in its `Build:` line, with whether the page is the published one.
- **The page's source**, for the version a site publishes
  ([app-files.md](app-files.md#what-a-published-page-says)).

A page that is older than the published one reloads itself, or says so
([app-files.md](app-files.md#the-page-and-a-browsers-copy-of-it)).

## Getting a report

- **Settings → Diagnostics → Copy report.** The report is put on the clipboard and shown in
  the section, so the person sees what they are passing on. Where the browser gives the page no
  clipboard, the text is left selected to copy by hand.
- **`?report` in the address**, such as `https://example.org/tour/?report`. The page shows the
  report and starts nothing else: no renderer, no map, no scene. It is for an app that stops
  before its settings can be reached, as one that stops while starting. It reads the trail and
  leaves it, so the page can be opened again and the app's next visit still says what happened.

The report is made on the device and sent nowhere. A key in an address is left out
(`?key=…`), and a setting that holds a secret says only whether it is set.

## What a report holds

```text
FOSS Earth report, 2026-10-04T19:47:20.124Z
Page: https://example.org/tour/
Build: 2026-10-04T19:45:33.269Z · source a2c6c2894d5b · FOSS Earth 35ad0e3f8037 · bundle twinCities-BAnPt2WQ.js
Browser: Mozilla/5.0 (…)
Screen: 414 × 896 CSS px at 2×, touch; 10 cores; memory 16 GiB or more
Renderer: webgpu (asked for auto); largest texture 8192 px; lost 0 times this visit
GPU: apple, metal-3, Apple M5
Scene: umn-twin-cities, revision 4b89d4e2af09, 60 360 images, immersive, inside northrop-mall; 0 warnings
Published: This page is the published version of the app, built 2026-10-04T19:45:33.269Z; the site was asked 12 s ago.
App files: 63 files (1.7 MB) of the app kept on this device. This visit takes them from there.

Settings: all at their defaults.

Errors nothing handled: none.

This visit, oldest first:
      0.2 s  Opened https://example.org/tour/
      0.2 s  › App built 2026-10-04 19:45 UTC from a2c6c28 with FOSS Earth 35ad0e3.
      0.8 s  Renderer webgpu (asked for auto); apple, metal-3, Apple M5
      0.8 s  Scene umn-twin-cities, revision 4b89d4e2af09: 60 360 images
      0.9 s  ! USGS Imagery Topo is active, but some tiles failed to load: Failed to fetch (…/8/92/61) (167 times, the last at 1.3 s)
      2.3 s  Inside the 360 image northrop-mall

The visit before, opened 2026-10-04T19:46:55.632Z, stopped without being closed, while shown. App built 2026-10-04T19:45:33.269Z from a2c6c2894d5b with FOSS Earth 35ad0e3f8037, bundle twinCities-BAnPt2WQ.js, renderer webgpu.
  It was at: scene umn-twin-cities, revision 4b89d4e2af09, inside the 360 image northrop-mall
      0.2 s  Opened …
```

- **Build, source, FOSS Earth and bundle** say which version ran: the build's time, the
  commit of the app's own repository, FOSS Earth's in an app of another repository, and the
  page's built script. **Published** says whether that is the version the site publishes: a
  browser can show a page it kept from an earlier day, with that day's app.
- **Settings not at their defaults** are the parameters a person, the address or a preset set:
  what makes this visit differ from a first one.
- **The steps** are what the visit did, in order: the page opened, which version it is, the
  renderer and its GPU, the scene, each 360 image entered and left, each line of the log, the
  page hidden and shown.
- **Troubles** are steps too: a warning or an error of the log, an unhandled error or promise
  rejection, a warning or an error written to the console. Each kind is one step, at the place
  of its first time, with how many times and when last, whatever address or number it names, so
  a tile that fails five hundred times is one line and leaves the rest in view.
- **The visit before** is its trail as it was last written.

## The trail, and the next visit

Each step is written to the browser's `localStorage` as it happens
([src/diagnostics/sessionTrail.ts](../src/diagnostics/sessionTrail.ts)), with the build, the
renderer and where the visit is: its scene and the 360 image it is in. A page that is closed,
reloaded or left marks its trail closed. One that is hidden marks it hidden, since a browser
may let a hidden page go. The next visit reads the trail of the one before it:

| The trail was | The visit before | The next visit |
| --- | --- | --- |
| Closed | was closed, reloaded or left | says nothing; the report has it |
| Hidden, not closed | was let go by the browser in the background, or its browser was closed | says nothing; the report has it |
| Neither | stopped while it was shown: the browser killed the page, or the browser itself stopped | says so in the log, with where it was and its last step |

A page of the same app open in another tab is not taken for one that stopped: the new visit
asks, through `localStorage`, and an open page answers.

The time of the last step is the latest the trail knows. A page killed a minute after its last
step reads as stopped "42 s after it opened or later".

## What the app says as it happens

- **An error nothing handled** is a line of the log, once, counted when it comes again.
- **The GPU's device lost**, and given back, is a line each.
- **Console warnings and errors** are steps of the trail and not lines of the log, which is
  for the person using the app.
- The same trouble with another tile's address updates its line of the log; it does not add one.

## Settings

Settings → Diagnostics:

| Parameter | Default | |
| --- | --- | --- |
| Remember how a visit ended (`diagnostics.trail`) | on | Off removes this visit's trail from the device; this visit's report still has its steps |
| Steps kept (`diagnostics.trailSteps`) | 80 | A step is one line of at most 300 characters, 24 KB at most in all. Opening an example scene and entering its 360 image is 16 steps |

## Using it in an app

`mountGlobeApp` and `createGlobeApp` do all of the above. An app that composes its own shell
uses the parts from `foss-earth/diagnostics`: `createSessionTrail`, `captureErrors`,
`tapConsole` and `buildReport`.

## Checked

[scripts/validation/diagnostics.mjs](../scripts/validation/diagnostics.mjs) runs a build in
headless Chrome at a phone's screen size: a visit's log says which version runs, it enters a
360 image, and Settings → Diagnostics → Copy report copies a report with the build, the
renderer, the GPU, the scene and the image entered. Chrome's own `Page.crash` then kills the renderer. The address with
`?report` shows the trail of the visit that stopped and starts no map; the app's next visit
says in its log that the last one stopped without being closed, inside that image, and its
report shows that visit's renderer and steps. A visit that was left, the control, makes the
next one say nothing.

With `--url` the same check runs against a live site over the network. On 2026-10-04 it
passed on <https://foss-earth.github.io/?scene=umn-tiles> and on the UMN tour, where the visit
after the crash said: "The last visit stopped without being closed, 11 s after it opened or
later; it was at: scene umn-twin-cities, revision 4b89d4e2af09, inside the 360 image
northrop-mall". Opening the tour and entering a photograph was 12 steps there, 15 with the
network cut off, and the report 2 KB.

In WebKit, Safari's engine as Playwright builds it, the live tour's log had no error line and
its report said "Errors nothing handled: none" through a first visit and a reload, though
WebKit reports each request a reload cuts off as a failed load: those are handled.

After the release of 2026-10-04 at 15:32 it passed again on the live tour, whose log's first
line said "App built 2026-10-04 20:32 UTC from 54b9bea with FOSS Earth d538bfa"
(`2026-10-04_153525`).

Not checked: the crash itself in any browser but Chrome, which alone has a command for it;
any of it in Safari or on a phone. A page hidden and then let go is tested with a stand-in for
the browser, not in one.

## A browser's own tools

The report says what the app knows. A browser's inspector, over a cable, says the rest: the
console, the network, and for Safari the page's memory. Neither was tried from this repository.

- **iPhone or iPad.** On the device, Settings → Apps → Safari → Advanced → Web Inspector. On a
  Mac, Safari → Settings → Advanced → Show features for web developers; with the device
  connected, the Develop menu lists it and its open pages. When a page was killed, the device's
  Settings → Privacy & Security → Analytics & Improvements → Analytics Data holds the system's
  own records: one named `JetsamEvent` is the system stopping a process for memory, and those
  beginning `com.apple.WebKit` are Safari's page and GPU processes.
- **Firefox for Android.** On the phone, enable USB debugging in the developer options and
  Remote debugging via USB in Firefox's settings. On a computer, Firefox's `about:debugging`
  lists the phone and its tabs.
