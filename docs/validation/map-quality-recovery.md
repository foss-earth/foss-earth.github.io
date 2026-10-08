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

## 2026-10-07: late missing fallback drops resident detail

**Corrected on 2026-10-08; the three regressions pass.** They were run first
and failed as recorded below. Their assertions were kept; the continuity test
now also checks that the absent stand-in is reported as no limit and that the
view then goes idle. The [correction](#correction) and what else the
specified checks found follow the reproduction. Specification:
[Preserve displayed imagery detail and explain delivery limits](../proposals/imagery-detail-continuity.md),
executed from the [work prompt](../imagery-detail-drop-prompt.md).

### Reproduction

The [continuity tests](../../src/engine/babylon/imagery/createImageryRuntime.continuity.test.ts)
use the USGS Imagery descriptor, default imagery budgets and tuning, and a fixed
camera 3,000 m from the ground target at 36.1° N, 112.14° W. Both automatic
adjustments are off. Selection, residency, allocation and material binding are
the real implementations. Downloads are deterministic promises; nothing is
requested from USGS. NullEngine records the page-table uploads instead of
drawing GPU pixels.

The test holds the optional fallback tile `13/1544/3214` in flight while its
selected fine descendants finish. At a fixed on-screen geographic probe, the
material first binds level 16. Rejecting that delayed fallback with
`ImageryMissingError` (the loader's result for a 404, 204 or blank image) triggers
reselection. The next publication binds level 6 at the same point: ten levels,
or 1,024 times coarser linear sampling. The active request remains Normal, the
atlas still has free slots, and its eviction count stays zero. Feedback contains
`source`; the public automatic-adjustment log has no event for this path.

The binding assertion reads copied page-table upload bytes and the material's
actual table/fallback uniforms. It records every requested update, so a later
recovery cannot hide an intervening drop. The clock advances through the
configured reselection interval, and the missing case must actually reselect.

Controls release the same held request successfully or with a transient 503
error: both preserve level 16. Successful loading before the held response is
also checked for monotonic delivery. Two additional
[selector regressions](../../src/terrain/imagery/imagerySelector.test.ts) fail when
an ancestor one or three levels above resident leaves becomes missing. A
passing control preserves the existing limit on speculative refinement where
no finer image has loaded.

The causal chain is in `createImageryRuntime.demand` (optional ancestors are
requested along with fine leaves), `imagerySelector.decide` (a missing ancestor
prunes its subtree), and `buildImageryDisplay` (cached descendants cannot
override the resulting coarse selection). This reproduces one cause with the
reported symptoms. It does not establish the responses in the user's original
session, identify an introducing commit, test real GPU pixels, or rule out
independent budget, projection or terrain-adoption failures.

Run the regressions with:

```sh
npx vitest run --maxWorkers=50% src/engine/babylon/imagery/createImageryRuntime.continuity.test.ts src/terrain/imagery/imagerySelector.test.ts
```

Validation of this tests-only change: incremental `npx tsc -b` and lint pass.
The full `npm run ci` ran once with two Vitest workers: 1,347 tests pass and
the three new regressions above fail, across 153 files. There are no other
test failures. CI stops at those assertions, so its production build does
not run. No application or runtime source was changed for this reproduction.

### Correction

A missing image no longer ends refinement where imagery the last plan showed
lies below it. The [selector](../../src/terrain/imagery/imagerySelector.ts)
gathers that evidence once per traversal from the previous plan's bounded
leaves, for the current source, version and variant, from images resident
now. A plan's split history and requests in flight are not evidence.
Refinement goes on toward that imagery while the image itself stays missing,
and the shortcut for four missing children follows the same rule. Without
evidence, pruning is as conservative as before: the nearest resident ancestor
stands in and nothing below it is asked for. A traversal sliced across updates
takes up again, before it finishes, any region it stopped at a missing image
that imagery arriving meanwhile shows the way into. Level ceilings, budgets,
hysteresis, coarsening the user asks for, source switches, missing-image expiry
and idle settlement are unchanged. The binding still never lets a cached finer
image override a coarser selection.

Each limit on visible imagery is now a structured
[constraint](../../src/terrain/imagery/imageryConstraints.ts) built where the
decision applying it is made:

- the map source: no image, its finest level, its coverage, or the level
  chosen for a readable cartographic scale;
- `map.imagery.gpuBudget`: the pages selection uses of those it may use in the
  atlas, and at least how many more visible regions need. The traversal is
  bounded, so this is a lower bound, never a total;
- a full atlas, whose downloaded images wait for a slot;
- `map.imagery.pageTablePatches`: tables as set and as the atlas layout
  allocates them, against those visible patches need;
- binding depth: a terrain patch addresses imagery at most six levels finer
  than itself;
- `map.imagery.maxNodes`, with the regions examined;
- WebGL 1 without shader texture LOD;
- an atlas reload after a budget, table or context change.

They travel with `getRasterDetailFeedback` and `onRasterDetailFeedback` into
the Map tab's detail status, into readings beside those parameters, and through
`connectMapDetailLog` into the globe's and 0sfs's logs. The log gives one warning
when a limit begins, once delivery has settled. It gives one update when the
limit's configured or effective capacity changes, or when it first takes away
detail already shown, and one line when it ends. A reload is reported as it
starts. Counts that move with the view repeat nothing, and another source
retires the old one's limits without claiming they recovered. Automatic
adjustment keeps its own lines. No message names a URL, key or place.

Two expectations changed with this. A long request queue is reported as
loading, not memory, as specification §5.2 requires ("Queue overflow alone is
not proof that GPU memory forced coarsening"); memory is reported when a
downloaded image finds no slot. The level a region reports as delivered is now
the page level its visible patches bind there, not the finest image resident
for it.

Coverage:

- [Continuity tests](../../src/engine/babylon/imagery/createImageryRuntime.continuity.test.ts):
  - the held stand-in answers with success, a transient error, or missing;
  - imagery arrives while a sliced reselection runs;
  - a resident stand-in sits below a missing ancestor while its leaf still loads;
  - a leaf the source does not have;
  - a late missing answer for the previous source version.
- [Selector tests](../../src/terrain/imagery/imagerySelector.test.ts):
  - resident leaves, and stand-ins for loading ones;
  - four missing children;
  - another source version and evicted imagery give no evidence;
  - variants below a missing standard image, and the reverse;
  - sliced traversals;
  - coarsening the user asks for;
  - page budgets that are reached, and detail they took away;
  - a region around the camera.
- [Runtime tests](../../src/engine/babylon/imagery/createImageryRuntime.test.ts)
  for each kind of limit and reload.
- The [log](../../src/shell/mapDetailLog.test.ts) and
  [panel](../../src/shell/mapDetailPanel.test.ts) tests, and the globe app's.
- [0sfs's flight app](../../../0sfs/src/flight/createFlightSimApp.test.ts): a
  page-table limit reaches its log once and its Map tab. The test fails without
  the log connection.

### Terrain adoption, zoom and a still view

Specification §7's checks are in the
[atlas runtime tests](../../src/engine/babylon/createRasterTilesRuntime.atlas.test.ts).
They run over open ocean at 30° N, 150° W, where the startup surface and every
elevation tile are at sea level, so no point's ground moves while terrain
loads. They read imagery, elevation and patch levels at fixed ground points.
They found three defects, each fixed in FOSS Earth and each failing its test
when the fix is reverted:

- **Patches reverted to a parent whose elevation arrived first.** With
  imagery full at levels 12 and 13 and elevation released a level at a time,
  parents first, the display put already-shown patches back under a parent
  with better elevation. A patch addresses imagery at most six levels finer
  than itself, so a point fell from level 12 to 2 with nothing moved. Shown
  patches now keep their place and take their own elevation as it arrives;
  patches shown for the first time still yield to a better-known parent.
  `boundsFor` was left as it was, and no elevation is loaded to choose
  imagery. The trade-off: a shown patch keeps its coarser elevation until its
  own arrives. Flight readiness still waits for real elevation.
- **Limits on regions around the camera were not reported.** A quad with a
  corner behind the near plane added no screen area, so a region around the
  camera counted as off screen and its binding limit went unreported. The
  selector now measures it by the screen rays that land in it.
- **A still view reloaded terrain without end.** At 2 km the view's 139 tiles
  and the parents above them outnumber the 160 kept by default. Eviction took
  the parents, the next selection loaded them again, and their arrival caused
  the next selection. Over 100 still frames that made 965 elevation requests
  and 2,281 render requests. Eviction now spares the tiles the selection needs
  and their parents. `map.terrain.cachedTiles` bounds what is kept beyond
  that, which its description now says, so the reading can show 180 kept
  against 160.

The zoom check flies from the whole globe to 2 km with no elevation answered,
so the root patches still underneath report their binding limit. Detail then
reaches the source's finest level, 16, at every point. After that come late
answers: elevation over the centre in stages, the centre's stand-in answered
missing, and the rest of the elevation. No point falls a level, and the map
then requests, uploads and draws nothing. Reverting the selector change makes
it fail as reported: "stand-in missing: imagery at point 0 went from level 16
to 12".

### Browser check

[`scripts/validation/imagery-continuity.mjs`](../../scripts/validation/imagery-continuity.mjs)
runs the same delayed-fallback sequence through the real raster runtime and
production renderer bootstrap. It uses flat ground and synthetic imagery that
names its level and texels, so no request leaves the page. A dry run finds the
region the view settles on at its centre and that region's stand-in. A second
run holds the stand-in until the fine imagery is drawn, then answers that it
does not exist. The check captures pixels before and after, and reads the
selected, resident and bound levels where they lie.

The [retained report](../../validation/evidence/map-detail/2026-10-07-imagery-continuity/report.json)
records Chrome 154 on Apple M5: WebGPU on Metal, and WebGL 2 and WebGL 1
through ANGLE's Metal backend. Each passes all ten checks.

- All 133 sampled pixels under stand-in `12/772/1607` show level 15 before and
  after the answer. 131 of them, away from tile edges, are at the right texel.
- Every frame binds level 15 at the centre: 328 to 341 frames per backend.
- The missing image is recorded and selection refines past it.
- Nothing is evicted.
- The still view then does no work for 3 s.
- Before and after captures are byte-identical on every backend.
  [This is WebGPU's](../../validation/evidence/map-detail/2026-10-07-imagery-continuity/webgpu.png).

A [control run](../../validation/evidence/map-detail/2026-10-07-imagery-continuity/control-report.json)
with the selector change reverted fails on WebGPU. The same 133 pixels
[fall to level 2](../../validation/evidence/map-detail/2026-10-07-imagery-continuity/control-webgpu-after.png),
the root coverage, while level-15 imagery stays resident under them. 316 of
318 frames bind level 2, and the source limit is misreported. This is a
correctness check on the recorded device, not a timing or device
qualification.

```sh
node scripts/validation/imagery-continuity.mjs [--backend=webgpu,webgl2,webgl]
```

### Checks

Checks ran one after another with at most five Vitest workers, in working
trees that other sessions were changing at the same time.

- While implementing:
  - the seven raster, imagery and selector test files, 125 tests;
  - the log, panel, runtime readings and globe app files, 74 tests;
  - 0sfs's flight app file, 58 tests;
  - incremental `npx tsc -b` and lint.
- Each fix was reverted once, and its test then failed:
  - the selector's evidence;
  - its reopening of sliced traversals;
  - the display rule;
  - eviction;
  - the area measure;
  - 0sfs's log connection.
- FOSS Earth's `npm run ci` ran once, at `a3c696a`. Lint passes, and 1,379 of
  1,384 tests in 154 files pass.
  - Two failures were this work's. The
    [tuning-constant ledger](../../src/settings/tuningConstants.test.ts) still
    listed the screen-ray grid's old default. It now lists
    `SCREEN_GROUND_RAYS`, and that file passes.
  - The other three are tests not yet updated for night-lights work in
    progress in the same checkout. Two expect the Sky tab without its new
    section, and one expects the terrain light without its new shader define.
  - CI stopped at those failures, before its build. The build then ran on its
    own: `tsc -b` and the production build pass.
- 0sfs's `npm run ci` ran once, at `d92a928a`, against this checkout. Lint
  passes; 45 of 2,045 tests fail, in 11 of 187 files.
  - All 45 are F-35B, F135, engine start, fuel, force observation and SF50
    rollout tests. They ran against a JSBSim build that engine work in
    progress in that checkout had installed minutes before.
  - The flight app file's one failure is its force-observation test. Its
    imagery-limit test passes.
  - The build then ran on its own and passes: the artifact checks, `tsc -b`
    against this checkout, and the production build.

### What this does and does not establish

These checks fix and cover deterministic mechanisms with the reported
symptoms:
- a late missing stand-in;
- shown patches reverting to a parent;
- a still view reloading terrain.

None of them is a capture of the session the user saw on 2026-10-07, which was
not recorded, and none is attributed to a commit. `e900f3a` changed this code
and is only a lead.

Some behaviour stays as designed:
- A limit that applies only while imagery loads is not logged until delivery
  settles.
- Without resident evidence, a missing image still ends refinement.
- At 300 m and below, regions just past the view's edge measure no screen area
  and are not counted.

The existing orbit test settles over 40 real-time rounds. Under heavy load from
another process it once ran out of rounds before loading finished. It passed
three runs in a row once the load eased; the test was not changed.

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
