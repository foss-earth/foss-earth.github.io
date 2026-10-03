# The north button does not follow the view inside a 360 image

Status: open. Reported on 2026-10-03 from use of the deployed tour, and confirmed
the same day on the live site, <https://foss-earth.github.io/?scene=umn-tiles>.

## What happens

Inside a 360 image the north button on the HUD bar, the N under a red needle,
keeps the heading the map had when the image was entered:

- Turning the view does not turn the needle.
- Pressing the button does not turn the view. The needle jumps to north-up, and
  goes back to the map's heading when the image is left.

Nothing else inside a 360 image shows which way the view faces: the compass drawn
on the ground is hidden with the globe.

Measured in headless Chrome, the map turned to a heading of 60° before entering:

| Step | The view's heading | The needle | The map camera, hidden |
| --- | ---: | --- | --- |
| On the map | – | `rotate(-60deg)` | heading 60°, pitch 16.7° |
| Inside, looking north | 0° | `rotate(-60deg)` | the same |
| Inside, looking east | 90° | `rotate(-60deg)` | the same |
| Inside, looking 200° | 200° | `rotate(-60deg)` | the same |
| Inside, after pressing the button | 200° | `rotate(0deg)` | heading 0°, pitch 89° |
| Back on the map | – | `rotate(-60deg)` | heading 60°, pitch 16.7° |

## Why

The button reads and moves the globe camera, and a 360 image is not drawn by the
globe camera. Entering one takes a navigation lease
([navigationLease.ts](../src/engine/babylon/navigationLease.ts)), and the lease
presents its own view while the globe camera stays where it was.

- The needle: the HUD's frame callback in
  [`createGlobeApp`](../src/app/createGlobeApp.ts) calls
  `northButton.update(runtime.getViewState().headingDeg)`, the globe camera's
  heading. The heading of the view on screen is `SceneStatus.view.headingDeg`, and
  the runtime has the same view as `getPresentationView()`.
- The press: `resetNorth` in the same file calls
  `runtime.setViewState({ headingDeg: 0, pitchDeg: MAX_PITCH_DEG })` whoever holds
  navigation. It turns the hidden globe camera north-up and tilts it straight
  down. Leaving restores the snapshot the lease took, so nothing of it is seen
  but the needle. The controller's `globe.resetNorth` does not have this fault:
  it is bound in the `globe` context only.

## Fixing it

1. The needle follows the view on screen. When `runtime.getPresentationView()`
   is not null, take the heading from it: its `forward` in the east-north-up
   frame at its `position`, and its `up` instead when the view looks straight up
   or down. That needs nothing from the scenes code, so it holds for any lease.
2. Inside a 360 image, pressing the button turns the view to north. The lease's
   holder has to do it, since only it can move its view:
   - Add a `panorama.lookNorth` action beside `panorama.exit` in
     [globeNavigation.ts](../src/input/globeNavigation.ts), bound to the same
     controller button as `globe.resetNorth`.
   - Send the button's click through `runtime.applyNavigationIntents` as that
     action while a lease is held.
   - [panoramaInput.ts](../src/scenes/panoramaInput.ts) turns the view to a
     heading of 0° with its pitch and zoom kept, as a motion and never a jump
     ([camera-motion.md](../docs/camera-motion.md)).
   - While a lease is held, the click must not call `setViewState`.
3. Say when north means nothing. A panorama whose `imagePose.aligned` is false or
   absent faces an arbitrary direction, so its heading is not a compass bearing;
   all 60 of the UMN tour's are like that today. The button's title should say so
   there, as the panorama's tab already does ("North is not set").
4. Tests: the heading of a presented view, looking level, up and down; the
   needle following a presented view; a press inside a panorama moving the view
   and not the globe camera.
