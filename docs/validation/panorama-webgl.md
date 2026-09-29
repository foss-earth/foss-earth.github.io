# Panorama WebGL fallback checks

The panorama renderer uses the same analytic orb quad and immersive triangle on
WebGPU, WebGL 2 and capable WebGL 1 contexts. WebGL's shaders and upload path
live beside the WebGPU implementation; scene loading, budgets and controls are
shared. See [the scene format](../scenes/format.md#progressive-delivery-and-progress)
for delivery and capability details.

Run the real-context check without a server:

```sh
node scripts/validation/panorama-webgl.mjs
```

It builds a standalone fixture, launches an isolated headless Chrome profile,
and serves fixture bytes through browser request interception. All scratch goes
in a new dated `build/validation/panorama-webgl/` folder. It checks both forced
WebGL versions and rejects software renderers. This is a renderer check, not a
test of the whole tour, mobile Firefox, network throughput or terrain providers.

The fixture verifies:

- The orb draws with the expected cube color, and foreground geometry hides it
  while background geometry does not.
- Immersion samples all six cube directions correctly.
- Non-power-of-two images display with correct color and top/bottom orientation.
- A cube-to-equirectangular transition blends in linear light.
- Uploads stay within the fixture's 16 KiB frame allowance; WebGL 1's NPOT image
  uses one mip level, while WebGL 2 can build its mip chain.
- Drawing 60 orbs for 120 frames performs no additional pixel uploads and leaves
  no WebGL errors. Reported render durations are CPU submission time for this
  small 256 × 256 fixture, not GPU timings or a phone performance qualification.

The [2026-09-28 retained report](../../validation/evidence/panorama-webgl/2026-09-28/report.json)
passed both WebGL 1 and 2 on Chrome using ANGLE/Metal on Apple M5. It includes
source hashes and the browser version. Android Firefox still requires a device
trial; desktop results do not establish its frame rate or memory behavior.

Unit regressions cover missing capabilities, shader compilation waking a sleeping
renderer, compiler errors reaching the log, bounded uploads, WebGL 2 fence
backpressure, cancellation, streaming progress and independently ready previews.

## Current limits

WebGL 1 requires fragment-depth, derivative and high-precision fragment support.
Contexts missing those capabilities get a visible reason. Non-power-of-two WebGL
1 images use clamp addressing and bilinear filtering without mips. WebGL 1 has
no GPU fence API: its outstanding limit bounds synchronous source-copy batches,
not a measurement of GPU completion. WebGL 2 uses fences.

WebGL textures currently filter and generate mips in encoded sRGB; crossfades
convert samples to linear light. WebGPU's sRGB textures also filter in linear
light. Hardware sRGB storage for the WebGL path is a possible later refinement;
it should be evaluated with image comparisons before replacing this tested path.
