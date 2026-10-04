# Diagnostics

When the app goes wrong on a device with no console, a phone above all, the app itself has to
say what happened. It keeps a trail of each visit, tells the next visit when one stopped
without being closed, and gives a report to copy.

## Why

On 2026-10-03 the UMN tour was tried on two phones. One drew every orb black; the other kept
crashing, and then showed a scene error that only an older version of the app could give.
Nothing said which version had run, on which renderer, or what the page had been doing when it
stopped. A page that a browser kills, as a phone does to one that takes too much memory, runs
no code as it goes, so there is nothing to ask afterwards unless it wrote things down first.
Until then the app caught no unhandled error, said nothing when the GPU's device was lost, and
left the renderer's warnings (a refused shader, a GPU error) in a console a phone does not show.

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
FOSS Earth report, 2026-10-04T16:58:58.569Z
Page: https://example.org/?scene=umn-tiles
Build: 2026-10-04T16:58:54.282Z · source 4be0fffd7ed6 · bundle index-DK8y-rWx.js
Browser: Mozilla/5.0 (…)
Screen: 414 × 896 CSS px at 2×, touch; 10 cores; memory 16 GiB or more
Renderer: webgpu (asked for auto); largest texture 8192 px; lost 0 times this visit
GPU: apple, metal-3, Apple M5
Scene: umn-tiles, revision 1, 1 360 images, immersive, inside umn-tiles-orb; 0 warnings
App files: 3 files (1.6 MB) of the app kept on this device. This visit takes them from there.

Settings: all at their defaults.

Errors nothing handled: none.

This visit, oldest first:
      0.2 s  Opened https://example.org/?scene=umn-tiles; build …, bundle index-DK8y-rWx.js
      0.8 s  Renderer webgpu (asked for auto); apple, metal-3, Apple M5
      0.8 s  Scene umn-tiles, revision 1: 1 360 images
      0.9 s  ! USGS Imagery Topo is active, but some tiles failed to load: Failed to fetch (…/8/92/61) (167 times, the last at 1.3 s)
      2.3 s  Inside the 360 image umn-tiles-orb

The visit before, opened 2026-10-04T16:58:55.632Z, stopped without being closed, while shown. Build …, bundle index-DK8y-rWx.js, renderer webgpu.
  It was at: scene umn-tiles, revision 1, inside the 360 image umn-tiles-orb
      0.2 s  Opened …
```

- **Build, source and bundle** say which version ran. A browser can show a page it kept from
  an earlier day, with that day's app.
- **Settings not at their defaults** are the parameters a person, the address or a preset set:
  what makes this visit differ from a first one.
- **The steps** are what the visit did, in order: the page opened, the renderer and its GPU,
  the scene, each 360 image entered and left, each line of the log, the page hidden and shown.
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
| Steps kept (`diagnostics.trailSteps`) | 80 | A step is one line of at most 300 characters, 24 KB at most in all. Opening an example scene and entering its 360 image is 15 steps |

## Using it in an app

`mountGlobeApp` and `createGlobeApp` do all of the above. An app that composes its own shell
uses the parts from `foss-earth/diagnostics`: `createSessionTrail`, `captureErrors`,
`tapConsole` and `buildReport`.

## Checked

[scripts/validation/diagnostics.mjs](../scripts/validation/diagnostics.mjs) runs a build in
headless Chrome at a phone's screen size: a visit enters a 360 image, and Settings →
Diagnostics → Copy report copies a report with the build, the renderer, the GPU, the scene and
the image entered. Chrome's own `Page.crash` then kills the renderer. The address with
`?report` shows the trail of the visit that stopped and starts no map; the app's next visit
says in its log that the last one stopped without being closed, inside that image, and its
report shows that visit's renderer and steps. A visit that was left, the control, makes the
next one say nothing.

Not checked: any of it in Safari or on a phone. A page hidden and then let go is tested with a
stand-in for the browser, not in one.

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
