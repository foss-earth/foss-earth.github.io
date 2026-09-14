# Manual QA checklist

Exercise these by hand before publishing a build. See [Development](development.md) for the
automated checks (`npm run ci`).

- Boot without a key and confirm fallback mode is visible.
- Boot with `?key=...` and confirm Google tiles mode is reported.
- Verify desktop controls: left drag pan, right drag orbit, shift plus trackpad swipe orbit, wheel zoom.
- Verify mobile/touch controls: one-finger pan, two-finger orbit, pinch zoom.
- Verify controller navigation, with a controller the browser reports in its standard layout and
  no saved controller profile:
  - Open **Controller bindings** and confirm **Standard controller** is selected.
  - Left stick pans, and pushing it up moves forward. Right stick orbits in the same directions as
    a right drag. Right trigger zooms in; left trigger zooms out.
  - The top face button (Y on an Xbox layout) resets north-up.
  - Leave the controller untouched until motion settles, then hover the GPU renderer chip and
    confirm its tooltip says it is idle.
  - Click **Bind** on an action, press a different control, apply it, and confirm the new control
    works and is still bound after a reload.
  - While a binding capture is listening, move both sticks and pull both triggers; confirm the
    camera does not move.
- On mobile, confirm the bottom HUD row is fully tappable — browsers with a bottom URL bar
  (Firefox Android) overlay the page, and the HUD offsets itself to clear it.
- Confirm HUD lat/lon/heading/pitch/zoom updates while navigating.
- Click the north button and confirm heading resets and POI tracking exits.
- Add/remove a test layer and confirm POI picking/tracking and cleanup behavior.
- Watch the perf pill for stable frame timing and culling/tile counts during normal navigation.

## Platform coverage log

- macOS desktop: Chrome, Firefox, and Safari — passed 2026-05-17.
