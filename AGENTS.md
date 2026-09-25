# Agent Instructions

## Where work belongs

- This package is the owner of the shared globe: terrain, height and map sources,
  rendering, camera and input, windowing, the HUD and log shells. Sibling
  applications, `../0sfs` among them, consume it through the `exports` map in
  `package.json` and keep only what their own domain needs.
- Work that reaches you from a consuming application stays here when it would still
  be correct in a globe with no aircraft, vehicle or mission in the scene. Do not send
  such a change back to the application because only one application needs it today;
  that is how shared code ends up written twice.
- Genuinely application-specific code, anything naming an aircraft, a flight model or
  a product mode, belongs in that application, not here.
- When a consumer needs something new, export it from a documented surface rather than
  letting the consumer deep-import an internal path, and check the consuming
  repositories still build.

## UI

- Lay out every set of controls as a paragraph grid: items at their own width,
  wrapping like words, as the HUD bar does. Never fixed columns.
- Every setting has one home, a section of a tab. A toolbar button toggles that
  tab, showing it or closing it; nothing pops up a menu or a second copy, and
  nothing floats in a screen corner.
- Spec and reasons: [docs/ui-layout.md](docs/ui-layout.md).

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

## Testing and computer use

- Prefer terminal commands, scripts, APIs, and headless browser automation for tests and benchmarks, including CPU/GPU comparisons.
- Do not take over the user's cursor or use a visible Chrome/browser GUI when a terminal or headless route can perform the task.
- Use GUI automation only when it is the only viable way to verify the required behavior; explain that necessity before using it.
- For GPU benchmarks, verify that the terminal/headless runtime uses the real hardware GPU rather than a software fallback.

## Personal data

- Never share the user's personal data with a third party without their consent
  for that specific use: name, email, accounts, keys and tokens, location, or
  anything read from their machine outside the task, in any URL, header,
  payload, published page or message. Data the user gave for a service, such as
  their Google key for Google tiles, may go to that service only.
- Identify scripts and requests with a neutral name such as `foss-earth-check/1.0`.
  When a service asks for contact details, ask the user first.
