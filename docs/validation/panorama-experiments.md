# Work-saving rendering experiments

Status, 2026-09-29: first pass implemented behind switches, all **off by default**. They were
checked headlessly on the UMN tour and are waiting for device trials. Each should draw the
same picture with less work. The numbers are the candidate IDs in the
[WebGL and panorama performance review](../webgl-panorama-performance-review.md), from its
"Equivalent rendering and less repeated work" group.

| Switch | Parameter | Candidate | What it removes |
| --- | --- | --- | --- |
| Panorama draws without test records | `renderer.experiments.panoramaBookkeeping` | 5 | For every orb or immersion draw: a camera digest formatted as text, a draw record pushed onto a 600-entry list that then shifts every entry, and a history of camera frames. Only the renderer's own checks read these; a check turns recording back on with `captureDraws(true)`. |
| Opaque panorama | `renderer.experiments.opaqueImmersion` | 6 | Blending of the full-screen panorama over the frame behind it once it is fully opaque, crossfades between two of its images included, since those mix inside the shader. Fades from the globe still blend. |
| Simpler panorama shaders | `renderer.experiments.panoramaShaders` | 7 | WebGL only. Each orb's per-draw constants (axis, distance, cap angle, window gain) are worked out once on the CPU instead of in every pixel. The immersive view's rotation into the image's frame moves into the vertex shader, as one matrix. A ray is normalized once where the equirectangular lookup needs it, and not at all for a cube lookup. |
| Skip the hidden globe during a panorama | `renderer.experiments.presentationCandidates` | 3 | While a panorama replaces the globe, Babylon is offered only the meshes that view can draw. Otherwise it checks readiness, updates world matrices and chooses LODs for every retained map tile, twice a frame, and then drops each one on its layer mask. |
| All work-saving experiments | `renderer.experiments.all` | – | Holds every switch above on while it is on. |

## Turning them on

- **In the app:** Renderer tab → Work-saving experiments. Each is a tick box. *All work-saving
  experiments* ticks and locks the rest, and they show "Set by the app: On with All
  work-saving experiments."
- **In the address bar,** for one visit and not saved: `?set.renderer.experiments.all=1`, or
  any single one, such as `?set.renderer.experiments.opaqueImmersion=1`. Settings → Saved
  settings → *Keep these values* saves them.
- All of them apply live; no reload is needed.

Code: [panoramaRenderer.ts](../../src/engine/babylon/panorama/panoramaRenderer.ts),
[panoramaShadersWebGL.ts](../../src/engine/babylon/panorama/panoramaShadersWebGL.ts) (the
`PANORAMA_LEAN` define), [presentationCandidates.ts](../../src/engine/babylon/presentationCandidates.ts),
[parameterGroup.ts](../../src/settings/parameterGroup.ts), and the parameters in
[renderer.ts](../../src/settings/catalogue/renderer.ts). With every switch off, each shader's
text is the same as before, apart from the equirectangular lookup split into two functions,
which compile to the same arithmetic.

## How they were checked

With the [scene A/B benchmark](../../benchmarks/scene-ab/README.md), on the UMN tour's own
build and photographs, in headless Chrome on the machine's GPU:

- **Equivalence:** the canvas is read back with the view held still, under each switch alone
  and all together, against the baseline read twice.
- **Timing:** the switches are changed live in one page, in a new random order each round,
  during scripted touch drags. Each is paired with the same round's baseline, and the
  baseline is measured a second time each round as the noise floor. A stretch with keyboard
  or mouse input, or unusual machine load, during it is run again.

Unit tests cover the switches' mechanics: records only while capturing, the same camera
revision text, the negative control, blending by opacity, the shader variant following the
switch, the lean matrices and constants against the full shader's arithmetic, the candidate
filter's active meshes, and the group holding and releasing its members.

## Results

The runs, their configuration and every number are in
[validation/evidence/panorama-experiments/2026-09-29](../../validation/evidence/panorama-experiments/2026-09-29/README.md).
In short, on an Apple M5 at a phone's viewport (1081 × 2401 px), WebGL 2 and WebGL 1:

- **Equivalence:** the test records, the opaque panorama and skipping the hidden globe are
  pixel-identical. The simpler shaders differ by at most 1/255 in under 0.3% of pixels.
  FOSS Earth's campus check passes on WebGL 2 with every experiment on: the GPU's rays and
  sampled directions match the CPU references as closely as without them, or more closely.
- **Inside a stop:** skipping the hidden globe cuts Babylon's render time on the main thread by
  24–27% (about 0.37 ms of 1.46 ms here), and the main thread's CPU time per frame by 14–17%,
  in every round. Babylon examines 1 mesh a frame instead of 289. All experiments together
  save the same.
- **Overview:** the test records save 4–5% of the main thread on WebGL 2, in every round.
- **GPU:** no experiment moved GPU time by more than this machine's own drift. The opaque
  panorama and the simpler shaders target phone GPUs, and only a phone can show whether they
  help.
- **Cost:** the simpler shaders add about 10–20 µs of CPU a frame for the two matrices they set.

What a phone gains is not established by these runs. On a phone's slower CPU the saving from
skipping the hidden globe should be larger in milliseconds, but that is what the device trials
are for.

## Human validation

On each device, open the tour once without and once with `?set.renderer.experiments.all=1`.
Then, for anything that looks wrong, try one switch at a time. On a phone, scan the codes the
tour's `npm run qr` and `npm run qr -- --query=set.renderer.experiments.all=1` print; see
[Testing on a phone](../development.md#testing-on-a-phone).

1. Enter a stop and drag the view around, including straight up and down (the poles) and
   across the image's back seam. Look for seams, a wrong orientation, flicker, or colours
   that differ from the baseline.
2. Leave a stop and enter another; follow a link. The fade from the globe and the flight out
   should look as before.
3. In the overview, orbs should look as before, hover outlines included, and hide behind
   buildings and terrain as before.
4. Judge smoothness while dragging inside a stop; that is where the phone was slow.
