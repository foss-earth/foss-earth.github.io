# Camera motion

The camera is a physical thing with mass and momentum. It never jumps, it
never stops dead, and it never ignores the person moving it. These rules hold for
the globe camera and for every camera a person steers in FOSS Earth and in the
applications built on it, 0SFS and the campus tour included. Read them before you
add or change a camera animation, a transition between modes, a handover of the
camera from one owner to another, or an input handler.

They come from the flights into and out of 360 images (September 2026). The user
asked for a flight cut short to "switch from moving in the animation to slowing
down to standstill" and said it had to "respect conservation of momentum". A first
version braked while the scene still held the camera, and ignored the swipe that
cut it short until the user lifted and swiped again, which was "very frustrating".
The version that follows these rules is the one the user called "so real, so
intuitive, so physical": "the camera really feels like a physical thing with mass
and momentum". The history and the tests are in
[panorama-scenes.md](proposals/panorama-scenes.md) under "Flying in and out".

## The rules

### 1. It never jumps

Position, look direction, roll and field of view change continuously while a
person watches. An animation that is cut short does not snap back to where it
began or on to where it would have ended. It stops where it got to and goes on
from there under rules 2 and 3.

A cut, meaning a fade to a different view, is honest where the motion would be
impossible or unwanted: reduced motion, a place the camera cannot reach, or a
view behind the camera. A snap between two poses that looks like motion is not.

### 2. It keeps its momentum at every handover

When control of the camera passes to another owner, the camera keeps the
velocity and turn it had. The owners include an animation, the person, a
panorama holding navigation, and the globe's own glide. Whoever takes over
slows it, and does not stop it cold or start it over.

When a flight is cut short, its eye velocity (m/s) and look turn (1/s) become the
globe's own pan, orbit and zoom rates, and its glide slows them as it slows a flick.

### 3. The person's input acts at once, and keeps acting

The moment the person gives input, the camera is theirs. Nothing holds the camera
while their input waits. For example, braking out an animation first and handing
over later is wrong. The input that interrupts something is not spent on
interrupting it: a swipe goes on panning, and a press becomes a drag from where
the pointer is. The person never has to lift and start again because the program
was busy.

### 4. Only the person's input is input

A trackpad's glide after the fingers lift is the system's: a stream of wheel
events that belongs to the gesture that started it. A wheel event within
`WHEEL_GESTURE_IDLE_MS` of the previous one continues its gesture.

- **Gestures already under way are not new input.** An animation is cut short only
  by a gesture that began after the animation did. A glide still arriving from
  before it never interrupts it.
- **A gesture from before a handover does not follow the camera over.** It belonged
  to the previous owner, so the new owner ignores it to its end. Momentum from
  turning a 360 image never pans the map, and momentum from panning the map
  never turns the image.
- **The gesture that took the camera over does follow.** That is rule 3.
- **A swipe over the controls is input too.** A two-finger swipe or a pinch over a
  panel that cannot scroll that way, over the HUD bar or over an instrument moves
  the camera as it would over the map, whichever camera has the canvas
  (`passToWorld.ts`). A camera swipe that drifts over a panel stays the camera's
  to its end, and a scroll that drifts off its panel stays a scroll; the first
  event of a gesture decides. On 2026-10-07 a sideways swipe over the Debug tab,
  meant for the camera, went Back a page.

### 5. One friction

Every glide slows by the same share of its speed each 60 Hz frame:
`camera.inertiaDecay`, Controls → Camera → Glide. Anything that changes alongside a
glide follows the same curve, so everything settles together and the person tunes
it in one place. Examples are a field of view easing back to the globe's, and a
sphere shrinking back into its orb.

Do not add a second decay, a fixed-duration ease-out or a separate stopping time
for camera motion.

### 6. Limits bend; they don't snap

A camera handed back where a limit would not allow it may stay there. It comes no
further past the limit than its glide takes it, and the limit holds again once it
is back inside. The zoom limit works this way after a flight ends near an orb.

Where a limit cannot bend, the camera jumps to the nearest allowed pose. That
happens when the globe camera cannot look above the horizon, or cannot roll. Keep
such cases rare and say so in the feature's documentation.

### 7. Automatic corrections are continuous, and avoided at handovers

Ground following, the orbit target's height and similar corrections move the
camera at a bounded rate, never in one step. At a handover, choose the state that
needs no correction. For example, a camera handed back orbits the point where its
line of sight comes down to the height the globe keeps its orbit target at, so
ground following has nothing to fix.

### 8. Motion reads as steady

Motion should look like one object moving, not like several animations running
side by side.

- Distance toward or away from a thing changes by the same factor each moment,
  so it grows or shrinks on screen at a steady rate.
- Turning and travelling happen together.
- Easing starts and ends at rest; smoothstep is the default.
- Durations are parameters with units, bounds and reasons ([Settings](proposals/settings.md)).

### 9. Stopping something is not also clicking it

A press that interrupts an animation or a glide is the person grabbing the
camera, so it is not also a click on whatever lies under the pointer. Otherwise,
stopping a flight into an orb would enter the orb again.

### 10. Reduced motion is honoured

Under `prefers-reduced-motion`, or the scene's Reduce setting, the camera does not
travel. It cuts with a short fade, and nothing glides.

## Where it is built

| Piece | Where |
| --- | --- |
| The globe's glide, and its caps per frame | `createInertialCameraController` in `src/input/inertialCameraController.ts`, decay `camera.inertiaDecay` |
| Placing the camera anywhere while an owner holds navigation | `placeNavigationCamera` in `src/engine/babylon/createBabylonRuntime.ts` |
| Handing it back moving: orbit, glide, field of view, input carried on | `glideNavigationCamera` there, with `NavigationGlide` in `navigationLease.ts` |
| The orbit that holds an eye and look, and motion as pan, orbit and zoom rates | `orbitCenterOnSight`, `orbitGlideRates` and `withinTilt` in `src/camera/cameraGlide.ts` |
| A closer zoom limit after a handback, until the camera is back outside it | `CameraController.allowNearer` in `src/camera/cameraState.ts` |
| Which wheel event begins a gesture, and when | `watchWheelGestures` in `src/input/wheelController.ts` |
| Swipes and pinches over the controls that none of them uses, handed to the canvas | `passUnusedInputToWorld` in `src/input/passToWorld.ts`, started by the runtime |
| Input carried on, or ignored, when the globe gets input back | `InputHandback` in `src/input/createInputController.ts`, `heldPress` in `mouseController.ts` |
| A flight's velocity where it got to, and the glide's settling curve | `flightMotion` and `glideSettling` in `src/scenes/panoramaFlight.ts` |
| The flights, their cuts and the orb's return | `enter`, `leave`, `handBack` and `fadeSphere` in `src/scenes/loadScene.ts` |

## Checklist for camera work

Before calling a camera change done, check each of these, and write a test for it
where a unit test can express it:

1. **Cut short at any moment:** what happens if the person interrupts at 10 %, 50 % and 90 %? The camera stays where it got to, and the first pose after the handover equals the last pose before it.
2. **Momentum:** the camera carries the velocity and turn it had, in direction and size, and slows by `camera.inertiaDecay`.
3. **Input:** a swipe or a mouse drag that interrupts acts on the camera at once and keeps acting; Escape leaves it gliding. Touch should carry on too; see "Known gaps".
4. **Momentum is not input:** a trackpad glide still arriving from before neither interrupts the animation nor moves the camera after a handover.
5. **Nothing snaps:** check field of view, roll, tilt, distance limits and the orbit target's height across every handover. List any snap that cannot be avoided in the feature's docs.
6. **Clicks:** the press that stopped something did not also activate what was under it.
7. **Reduced motion:** a cut with a fade, no travel.
8. **Parameters:** every duration and rate is a setting with unit, bounds, default and reason. Friction is `camera.inertiaDecay`, not a new constant.

## Known gaps

- **Touch.** A touch that interrupts a flight does not carry on as a globe gesture;
  only wheel gestures and mouse presses do.
- **Looking up.** The globe camera cannot look above the horizon. An exit from a
  360 image cut short in its first moments, from a view looking up, snaps the tilt
  to the horizon.
- **Only the panorama flights so far.** They are the only animations built this
  way. Map transitions elsewhere, such as the overview a scene applies or the
  camera moves in 0SFS, have not been checked against these rules. Bring each one
  in line when you next work on it.
