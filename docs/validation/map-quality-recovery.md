# Map detail recovery and overlapping surfaces

2026-10-05. FOSS Earth owns these fixes; 0sfs consumes the linked package and
connects its visible log through `connectMapDetailLog`.

## Reproduced failures

The regressions were run before their fixes. They use deterministic downloads
and the actual selectors, residency manager and atlas allocator, so provider
speed is not their correctness oracle.

| Failure | Regression and correction |
| --- | --- |
| Resident detailed imagery stays on a coarse fallback after movement | [Imagery runtime tests](../../src/engine/babylon/imagery/createImageryRuntime.test.ts) exhaust the page-table budget with coarse patches, then move the view. A patch using one page now binds it directly, leaving table blocks for patches needing several pages. |
| A replacement cannot claim a block that becomes free later in cache order | The same tests switch visible patches in reverse cache order. Publication now releases obsolete blocks before allocating replacements. Settled updates perform no additional table writes. |
| A stationary view never retries images previously reported missing | The same tests expire missing-image records without moving the camera. Expiry schedules a wake and invalidates selection once, permitting refinement again. |
| The final stale download leaves current-view work asleep | [Residency tests](../../src/engine/babylon/imagery/imageryResidency.test.ts) release a stale request's concurrency reservation. Admission wakes without invalidating unchanged display pages. |
| A short frame interval permanently poisons Auto's refresh estimate | [Auto tests](../../src/terrain/autoDetail.test.ts) inject one 3 ms interval into healthy 60 Hz frames. The estimate now uses complete-window medians. |
| Enabled Auto coarsens, then never recovers at normal refresh | The same tests exercise the shipped recovery threshold after overload. Its default is now 1.05 times the goal, permitting cautious recovery at the display rate. Suspended observations discard incomplete windows and consecutive counts. |
| The detail cursor does not move as sharper tiles arrive | [HUD tests](../../src/shell/mapSourceHud.test.ts) keep the request fixed while measured loaded detail advances. The I-beam remains visible during loading, at the range ends and above the thumb when delivery reaches it. Runtime and binding tests exercise actual publication and event propagation separately. |
| A source round trip loses the saved target, or feedback is overwritten by a stale snapshot | [Binding tests](../../src/shell/connectMapDetailRuntime.test.ts) exercise source replacement and synchronous feedback. Targets are reapplied and feedback is read after activation. |
| 0sfs silently changes detail | [Flight composition test](../../../0sfs/src/flight/createFlightSimApp.test.ts) verifies a visible reason for adjustments and listener disposal. Both applications use the same shared log connection. Settings-driven restoration is identified separately from frame-time recovery. |
| Old and new ground surfaces overlap while streaming continues | [Runtime handoff tests](../../src/engine/babylon/createBabylonRuntime.sim.test.ts) inspect the first rendered replacement frame in both directions. The old surface is retired in that frame, without waiting for all downloads; subsequent frames do not update its disposed runtime. |
| Tile replacement precedes material readiness | [Google runtime tests](../../src/engine/babylon/createTilesRuntime.test.ts) keep parsing pending until every mesh is drawable and cover eviction/disposal cancellation. The fallback light affects only its globe, keeping incoming tiles' lighting stable across reveal. |

The [USGS runtime test](../../src/engine/babylon/createRasterTilesRuntime.atlas.test.ts)
also feeds two minutes of slow frames to untouched defaults. Neither imagery
nor terrain coarsens, no frame-time limit appears and no adjustment is emitted.
Automatic adjustment remains **off by default**; the streaming failures above
do not require it to be enabled.

## Depth precision

The independent [depth fixture](../../scripts/validation/depth-precision.mjs)
renders tilted, differently colored foreground/background surfaces with the
flight camera's 0.05 m near plane and 250,000 m far plane. It tests 0.1 m and
1 m separations at 1 km, and a 1 m separation at 10 km, with both draw orders
and three camera positions. Every sampled pixel should show the foreground.
Conventional depth is retained as a negative control; a larger near plane is
only a diagnostic control because it would clip the cockpit.

The real-GPU reproduction found wrong depth ordering on WebGPU, WebGL 2 and
WebGL 1. The shared renderer now enables Babylon's reversed depth buffer before
creating its scenes and presentation probe. This uses the existing rendering
pass and projection support; no additional pass is introduced.

The [retained report](../../validation/evidence/map-detail/2026-10-05-depth/report.json)
records Chrome 154 on Apple M5: **0 wrong pixels out of 4,608 per backend**
for the actual production bootstrap, 13,824 in total. The conventional-depth
control fails on all three backends. The
[panorama check](../../validation/evidence/map-detail/2026-10-05-depth/panorama-webgl.json)
also passes custom depth, color and upload assertions on WebGL 1 and 2 with
reversed depth enabled and no GL error. These are correctness checks on the
recorded device, not throughput measurements or universal device qualification.

The [raster binding report](../../validation/evidence/map-detail/2026-10-05-depth/raster-binding.json)
covers overhead, near-horizon and floating-origin views on all three backends:
1,629 placement probes and 2,532,225 terrain pixels, with no placement/color
errors, unchanged terrain during imagery-only changes, and no settled selector,
upload, table-write or publication work. Two initial WebGL overhead captures
were empty because the fixture did not wait for shader readiness. The fixture
now waits and the runner rejects empty captures; affected-only reruns pass.
The retained report distinguishes those runs and source hashes.

Reproduce without a server or Google key:

```sh
node scripts/validation/depth-precision.mjs
```

## Interpretation and limits

The first marker correction tracked the applied target, so it could not show
imagery sharpening with an unchanged request. The follow-up replaces it with
an I-beam driven by measured loaded detail. Raster reports a visible-area
estimate of the displayed image pixel footprint in binary resolution offsets;
Google reports the largest native camera-visible geometric error in pixels.
Neither uses requested detail or a download percentage as a substitute. Mixed
delivery still retains loading/source/memory/backend feedback. Actual
page-table exhaustion reports a backend limit.

The no-server [I-beam check](../../scripts/check-map-detail-marker.mjs) loads
the real controller, slider and CSS. It advances loaded raster detail from
three levels coarse through one level coarse to Normal while the request
stays at Normal. It checks both themes, stem/caps, marker movement, visibility
above the thumb, and pointer hit-through. It needs no GPU or network provider:

```sh
node scripts/check-map-detail-marker.mjs
```

All six states pass in the [retained report](../../validation/evidence/map-detail/2026-10-05-loaded-detail/report.json).
The [dark](../../validation/evidence/map-detail/2026-10-05-loaded-detail/dark.png)
and [light](../../validation/evidence/map-detail/2026-10-05-loaded-detail/light.png)
captures show the I-beam at the coarse end, between ends, and over the request.

The [native-adapter LOD test](../../src/engine/babylon/createTilesRuntime.lod.test.ts)
uses the installed Babylon adapter's REPLACE traversal with coplanar ancestor
and descendant meshes. It checks staggered loads, refinement, coarsening,
culling and reappearance. This test passed the existing traversal: a duplicate
parent/child LOD defect was not reproduced. Surface handoff overlap was
reproduced and corrected separately.

These regressions establish the listed failure mechanisms, not an exact replay
of the original session. No live Google key or tile capture is used. Removing
unnecessary table allocations, writes, lookups and retired-runtime updates is
verified structurally; no FPS or GPU-time improvement is claimed.

The automatic display goal is still an estimate of the fastest sustained rate
observed. A display refresh-rate change during the session is not distinguished
from sustained load; an explicit frame-time goal or frame-rate cap remains
available. Explicitly saved recovery thresholds are preserved.

## Repository checks

- After the loaded-detail follow-up, FOSS Earth `npm run ci` passes:
  129 test files / 1,091 tests, lint, typecheck and production build.
- 0sfs `npm run ci` also passes against the updated linked checkout:
  152 test files / 1,568 tests, lint, typecheck, production build and artifact
  verification. Earlier audio failures are no longer present in this run;
  these map changes did not edit or rebuild the DSP sources.
- Focused follow-up checks passed: 435 shell-related tests, 60 imagery tests,
  36 Google runtime tests and 12 panel tests. The panel's mutation observer
  records no DOM work when only loaded detail changes. The six-state browser
  I-beam check passes in both themes.

Checks ran serially by repository with at most five Vitest workers. Each full
suite ran once after the loaded-detail follow-up; focused regressions were
checked before that final gate.
