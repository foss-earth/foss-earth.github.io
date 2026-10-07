# Agent Instructions

## Where work belongs

- This package is the owner of the shared globe, a Google Earth clone: terrain,
  height and map sources, rendering, camera and input, windowing, the HUD and log
  shells, and the scene format with its panorama viewer and tools. Applications
  consume it through the `exports` map in `package.json` and its documented scripts,
  and keep only what their own domain needs:
  - `../0sfs` is the flight simulator.
  - `../UMN-VR/UMN-VR.github.io` is the University of Minnesota campus tour. It
    owns the tour's scene, photographs, placements and its conversion from
    YouVisit.
- Content belongs to the application that shows it. A tour's photographs,
  positions and import from another platform go in the tour's repository. FOSS
  Earth keeps the format, the loader and the tools that work on any scene.
- Work that reaches you from a consuming application stays here when it would still
  be correct in a globe with no aircraft, vehicle or mission in the scene. Do not send
  such a change back to the application because only one application needs it today;
  that is how shared code ends up written twice.
- Genuinely application-specific code belongs in that application, not here. That
  means anything naming an aircraft, a flight model, a product mode, or a particular
  tour and its content.
- When a consumer needs something new, export it from a documented surface rather than
  letting the consumer deep-import an internal path, and check the consuming
  repositories still build.

## UI

- Lay out every set of controls as a paragraph grid: items at their own width,
  wrapping like words, as the HUD bar does. Never fixed columns.
- Every setting has one home, a section of a tab. A toolbar button toggles that
  tab, showing it or closing it; nothing pops up a menu or a second copy, and
  nothing floats in a screen corner.
- A dropdown is as wide as its own text, its longest option, and never stretched
  to its row, column or panel.
- A control uses an input or passes it on to the world behind it: swipes and
  pinches no control uses move the camera, and a focused control keeps only the
  keys it uses (`controlTakesKey`). Never a key binding's own list of elements to
  ignore.
- Spec and reasons: [docs/ui-layout.md](docs/ui-layout.md).

## Rendering and compute

- Compute something once; compute it twice only when that is the cheapest way.
  Draw a frame only when what it shows has changed, draw each change once, and
  draw nothing while nothing changes.
- Meshes and lights entering or leaving the scene, and content becoming ready to
  draw, ask for their own frame. Any other change to what is shown calls
  `requestRender()` once; progress and anything hidden ask for none.
- Show new content only when all of it can be drawn: prepare it hidden, wait for
  `whenMeshesReady`, then show it and take away what it replaces in one task.
- Spec, reasons and a checklist: [docs/render-on-demand.md](docs/render-on-demand.md).

## Camera motion

- The camera is a physical thing with mass and momentum. It never jumps: an
  animation cut short stays where it got to, never snapping to its start or end.
- Momentum carries across every handover: whoever takes the camera over keeps its
  velocity and turn and slows it with the one glide, `camera.inertiaDecay`. Never
  a second decay, a fixed ease-out, or a dead stop.
- The person's input acts at once and keeps acting: the gesture that interrupts
  goes on moving the camera. Nothing holds the camera while input waits.
- Only the person's input is input: a trackpad's momentum never interrupts
  anything, and a gesture from before a handover does not follow the camera over.
- Limits bend rather than snap, automatic corrections move at a bounded rate, a
  press that stops motion is not also a click, and reduced motion fades instead.
- Spec, reasons, where it is built and a checklist: [docs/camera-motion.md](docs/camera-motion.md).

## Settings

- The user decides how their machine's compute, memory and bandwidth are spent,
  not the programmer. Anything that decides what is loaded, drawn, kept or
  computed is a named parameter the user can see and change, with a real unit,
  bounds, a default and the reason for it. Never hardcode such a value, and never
  hide values behind an opaque choice such as Low, Medium and High.
- Continuous quantities get continuous controls. A range is one track with two
  thumbs, never two sliders.
- Presets are for people who do not want to tune: JSON lists of parameter
  values, shown in full, copied when applied, and marked Custom after any edit.
  No code branches on a preset's name.
- Automatic behaviour moves a value only inside a range the user sets, and shows
  where the value is and why.
- Spec: [Settings](docs/proposals/settings.md).

## Scratch files and working directories

- Never write outside this repository. No `/tmp`, no `/private/tmp`, no
  `/var/folders`, no harness-provided "scratchpad" directory. macOS empties
  `/private/tmp` on every restart.
- Scratch that must not be committed goes in the gitignored `build/` tree:
  `build/benchmarks/<area>/` for benchmark output that is not a tracked
  `results*.json`, and `build/tools/` for tools that are not dependencies, such
  as Playwright in `build/tools/playwright/`.
- `build/` also holds working material, such as the only copies of the map
  detail runs. Never delete from it without the user agreeing to each folder.
  [0sfs's build scratch list](../0sfs/docs/build-scratch.md) says what the large
  folders are for.

## Testing and computer use

- Prefer terminal commands, scripts, APIs, and headless browser automation for tests and benchmarks, including CPU/GPU comparisons.
- Do not take over the user's cursor or use a visible Chrome/browser GUI when a terminal or headless route can perform the task.
- Use GUI automation only when it is the only viable way to verify the required behavior; explain that necessity before using it.
- For GPU benchmarks, verify that the terminal/headless runtime uses the real hardware GPU rather than a software fallback.
- Headless harnesses already run WebGPU and real WebGL 1 and 2 contexts on this machine's GPU,
  with no server: whole apps with a scene (the UMN tour included), fixtures, A/B comparisons.
  Start from them; [docs/validation/README.md](docs/validation/README.md) lists them.
- Let headless Chrome exit by itself: `await chrome.close()`, or Playwright's `browser.close()`,
  in a `finally`, and no signal after it. A killed Chrome leaves a 1.4 GB clone of itself under
  `/private/var/folders` until the Mac restarts; after stopping a run part way, check for one.
  [docs/validation/chrome-code-sign-clones.md](docs/validation/chrome-code-sign-clones.md).

## Checks

- Check what a change touches, and run the full suite once, when the work is done.
  After an edit: `npx tsc -b`, `npx vitest related --run <changed files>` (or
  `npm run test:changed`) and `npm run lint`. For finished work: `npm run ci`, once.
- `tsc -b` and `npm run lint` are incremental. Never pass `--force` or delete
  `node_modules/.tmp` or `node_modules/.cache` to make them check everything again.
- Documentation-only changes need no typecheck, tests or build.
- Keep each run's output in a log under `build/` and read it again rather than
  rerunning. To look into a failure, rerun that test file, not the suite.
- To check a series of commits, run each commit's related tests and the full suite
  on the last one only. A worktree gets its own `node_modules/.tmp`.
- Cap repeated or background runs at half the cores (`--maxWorkers=50%`), and don't
  run a suite while another session is running one.
- Half the cores is not a memory budget. Before running a script in several processes,
  measure what one needs and start only as many as fit in half the machine's memory.
  How, and what else disturbs a timing: [docs/validation/timing.md](docs/validation/timing.md).
- The user uses this Mac concurrently. Benchmarks must attribute their own work and
  account for interference before timings qualify; otherwise defer those timings
  until the user offers exclusive access and continue useful untimed work. Prefer
  bounded parallel work. On this fanless Mac with performance/efficiency cores,
  observe core scheduling and thermal drift when needed; aggregate load or an
  exclusive session alone cannot qualify isolated CPU cost.
  [Shared benchmark policy](docs/validation/benchmark-interference.md).
- Benchmarks and headless-browser GPU runs only when the task asks for them.

## Personal data

- Never share the user's personal data with a third party without their consent
  for that specific use: name, email, accounts, keys and tokens, location, or
  anything read from their machine outside the task, in any URL, header,
  payload, published page or message. Data the user gave for a service, such as
  their Google key for Google tiles, may go to that service only.
- Identify scripts and requests with a neutral name such as `foss-earth-check/1.0`.
  When a service asks for contact details, ask the user first.
