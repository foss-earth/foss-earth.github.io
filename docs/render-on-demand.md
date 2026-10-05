# Render on demand

Rules for when FOSS Earth, and the applications built on it, 0sfs and the UMN
tour included, draw a frame and do any other work. Read them before adding
anything that changes what the scene shows, or anything that runs repeatedly.

## The rule

**Compute something once. Compute it twice only when that is the cheapest way to
get it.** A frame is drawn only when what it shows has changed, each change is
drawn once, and nothing is drawn while there is nothing new to show. The same
holds for any work that is not drawing: a value computed every frame that changes
once a minute is computed sixty times a second for nothing.

Switching an aircraft model in 0sfs is the worked example. Choosing another
model, with nothing else changing, costs two frames: one without the old aircraft,
while the log shows the new one's download, and one with the new aircraft,
whole. A model `Auto` switches to as the camera pulls back costs one frame: the
old aircraft stays until the new one is ready, and one frame swaps them. Not a
frame more, and not one that shows the new aircraft half drawn or not at all.

## What asks for a frame

The globe draws only when asked (`src/engine/babylon/renderScheduler.ts`).

| Change | Who asks |
| --- | --- |
| The camera moves, or glides on after input | The camera's controller, for as long as it moves |
| Tiles or images are streaming in | The runtime holds continuous rendering while they do |
| A simulation is running | The host, with `setSimRunning(true)` |
| A mesh or light enters or leaves the scene | Nobody needs to: `sceneUpdates.ts` asks |
| A frame skipped something still compiling or loading | Nobody needs to: `sceneUpdates.ts` asks once it is ready |
| Anything else that changes what is shown: moving, showing, hiding or recolouring something already in the scene, a new theme | Whoever changed it calls `requestRender()` |

Asking is cheap: requests between two frames collapse into one frame, and a frame
already coming makes another request free. Asking when nothing visible changed
is not: it draws a frame that shows nothing new.

### What enters and leaves the scene

`src/engine/babylon/sceneUpdates.ts` watches the scene. A mesh added asks for a
frame only if the picture changes: not if the last frame already drew it, as it
did one added while that frame was being prepared, and not if it is disabled or
invisible, since whoever shows it later asks then. A mesh taken away asks only
if the last frame drew it, and not while a frame is being prepared, which leaves
it out anyway. Babylon reports an addition a millisecond after it happens, so all
of them are judged once the task that reported them is over: a model added and
then parented under a hidden node in the same task asks for nothing.

### What a frame could not draw

Babylon draws nothing whose material is still compiling or whose textures are
still loading: it skips that mesh and draws it on a later frame. With a render
loop that later frame always comes. On demand it comes only if something asks,
so before `sceneUpdates.ts` a model that had just loaded could stay invisible
until the camera moved. Now, whenever the scheduler goes idle, the meshes the
last frame meant to draw are checked; any that were not ready are waited on, and
one frame is asked for when all of them are.

The waiting is done by checking, never by drawing. Checks start a frame apart and
grow apart, to four a second, while nothing gets ready, so something that never
does, such as a texture that failed, costs four cheap checks a second rather than
sixty frames. A frame that starts for another reason ends the wait, and the
meshes are judged again after it.

## Get it ready before you show it

The cheapest way to show new content is to show it only when all of it can be
drawn. Add it to the scene under a disabled node, so its materials compile for
the lights that will shine on it while nothing is drawn; wait for
`whenMeshesReady` from `foss-earth/runtime`; then enable the node and ask for one
frame. Showing it as soon as it loads draws a frame without it, or with parts of
it missing, and then another.

Take away what it replaces in the same task as you show it, so one frame does
both. Keep what it replaces in view meanwhile unless the person asked for it to
go: an automatic change should never leave a gap the person can see.

## What never asks for a frame

- Progress of a download or a load: it is text, in the log or a panel.
- A change to something hidden, or out of view: nobody can see it.
- A setting that does not change the picture until something else does.
- Work done in the frame's own tick before its render: that render draws it.

## Checklist

- Does the change alter what the person sees? If not, ask for no frame.
- Is it a mesh or a light entering or leaving the scene? Then it asks for its
  own frame; do not ask again.
- Is it a change to something already in the scene? Call `requestRender()` once,
  after the change, not in a loop or on every progress event.
- Is it new content? Prepare it hidden, wait for `whenMeshesReady`, show it and
  take away what it replaces in one task.
- Does anything run on a timer or every frame? Make it stop when it has nothing
  left to do, and grow its interval while nothing changes.
