# Image representations and the 360 viewer

Status: proposed repository boundaries, audited against the implementation on
2026-10-08. Extraction has not happened. This replaces the earlier proposal to
put scenes, viewing and every image representation in `foss-earth/panorama`.
The top-level viewer is **`foss-earth/360`**. Image structures have their own
repositories, and scene placement and navigation belong to `foss-earth/scenes`.

The [tab inventory](tab-inventory.md) covers the user interface. The
[dependency graph](repository-split-graph.html) covers these release boundaries.
Existing `foss-earth/scenes` imports are package subpaths in today's single
package; a similarly named proposed repository is a future extraction target.

## Every current 360 image structure

The source of truth is the current [representation types](../../src/scenes/format.ts),
[validator](../../src/scenes/validateScene.ts),
[JSON Schema](../../src/scenes/foss-earth-scene-1.schema.json) and
[format reference](../scenes/format.md). The schema accepting an unknown future
projection does not mean the renderer supports it: the loader skips it with a
warning and can use a known representation of the same asset instead.

| Current structure or variant | Proposed repository | Exact responsibility and boundary |
| --- | --- | --- |
| Whole 2:1 equirectangular image | `foss-earth/equirectangular` | Full spherical image dimensions, longitude/latitude sampling, seam and pole behavior, whole-image resource estimates, preparation and GPU sampling adapter. The current viewer selects this for immersion; its initial orb preview requires a cube. |
| Whole six-face gnomonic cubemap | `foss-earth/cubemap` | Six named square faces, face orientation/order, direction lookup, resource estimates, preparation and cube sampling/upload adapter. Supports preview and immersion roles. Pure cube geometry is exported separately from the GPU adapter. |
| Gnomonic tiled cubemap | `foss-earth/tiled-cubemap` | Six face quadtrees, tile addresses, levels, gutters, byte accounting, selection, cancellation, bounded residency, display table, GPU atlas and format-specific sampling. Each tile contains complete replacement pixels. |
| Equi-angular tiled cubemap (EAC) | `foss-earth/tiled-cubemap` | Same quadtree, tile addressing, storage, scheduling and atlas as the preceding row; its direction mapping uses the equi-angular warp. Both variants retain explicit preparation and sampling support. EAC is currently a warp of the tiled structure, so it does not get a second copy of that structure's scheduler. |
| Preview sheets containing faces of multiple cubemaps | `foss-earth/preview-sheets` | Sheet records, cubemap rectangles, packing/extraction, the `foss-earth.preview-sheets` extension, file verification, shared sheet reads and fallback to the six original face files. Uses cubemap's pure face conventions. It provides a source adapter; cubemap performs the GPU upload. |

These are four representation/packing repositories, covering five rows because
the tiled structure implements two projection variants. Sizes, quality levels,
asset IDs, preview versus immersion roles and individual photographs do not
create new structures or repositories.

JPEG and PNG are the two accepted image codecs. Their headers, dimensions,
orientation checks, color conversion and decode/preparation helpers belong in
`foss-earth/images`, with browser and Node entry points separated. A JPEG
equirectangular image and a PNG equirectangular image share the same spatial
representation. The codec choice does not move the spatial algorithms.

The runtime tile atlas and its lookup table belong to `tiled-cubemap`. A preview
sheet is different: it packs encoded source images to reduce transfers. Whole
cubemap mip levels remain in `cubemap`; ordinary texture mipmaps do not become
another scene representation. Analytic orbs, screen quads and possible sphere
meshes describe how a viewer draws an image, not how the source image is stored.

## Common code and the two feature repositories

| Repository | Owns | Public boundary |
| --- | --- | --- |
| `foss-earth/images` | Common asset/representation interfaces, decoded image records, orientation and color helpers, image headers, resource reservations, transfer/decode limits, shared persistent cache and cancellation contracts | Pure core imports no representation, renderer, viewer, scene or globe. The application creates one broker for the viewing session and passes it to consumers. Browser/Node adapters remain distinct exports. |
| `foss-earth/360` | Representation registration/composition, image selection, orb/immersion drawing and transitions, entry/exit and motion/input through supplied ports, active-image tab and 360 image settings | Accepts image assets plus camera, placement, frame and action ports. It does not resolve scene entity IDs or import the globe engine. Title, credits and link actions arrive as data/callbacks. |
| `foss-earth/scenes` | Versioned scene envelope/schema, assets and entity references, placement, groups and links, scene list, scene replacement, navigation orchestration and Scenes tab | Resolves the scene and asks 360 to show/enter/exit an image. Scene validation composes registered representation validators; representations never import scene types back. World/height/navigation services arrive through host ports. |

One broker accounts for all image representations together: encoded and decoded
bytes, source GPU residency, tile allocations, staging, retained images and
overlap during replacement. A representation reports its estimate and reserves
through that broker before allocating. Separate packages must not each assume
they can spend the entire user-selected limit. The broker's core tracks
reservations without creating GPU objects; renderer adapters perform those
operations under the granted reservation.

Settings retain one visible home. Scenes can display common loading and memory
controls supplied by `images`, and 360 can display representation controls
supplied by their owners. The panel hosting a control does not become the owner
of the algorithm or create another limit. Current setting IDs and saved values
must survive extraction or have an explicit migration.

## Dependency direction

Arrows mean consumer to dependency. These are proposed package contracts, not
claims about today's imports.

| Consumer | Dependencies and why |
| --- | --- |
| `scenes` | `360` for viewing; `images` for shared records/broker; `ui` for the Scenes panel |
| `360` | `images`, `equirectangular`, `cubemap`, `tiled-cubemap`, `preview-sheets`, `renderer`, `ui` |
| `equirectangular` | `images`; `renderer` only through its GPU adapter entry point |
| `cubemap` | `images`; `renderer` only through its GPU adapter entry point |
| `tiled-cubemap` | `images`, `cubemap/core` for pure face geometry, `renderer` for its GPU adapter |
| `preview-sheets` | `images`, `cubemap/core`; no separate GPU scheduler |
| `images` | No representation or renderer dependency |

No representation imports `360`, `scenes` or `engine`. Core/schema/preparation
imports must not pull in renderer code transitively. `360` supplies the built-in
representation registry and can accept additional implementations through the
same common contracts. A representation exposes schema/validation and file
enumeration hooks; `scenes` applies them while validating its containing
document. This keeps scene and format dependencies in one direction.

Globe hosts provide terrain/height and camera ports at composition time. UMN
consumes these Earth packages and owns its campus scene, photographs, placements
and platform-specific import. Flight may opt into scenes without shared Earth
code importing a flight package. There is no ownership move into `0sfs`.

## Current files to split

Several files currently cross these proposed boundaries. They must be separated
by responsibility, rather than assigned whole to whichever repo is named first.

| Existing source | Proposed destination |
| --- | --- |
| [format.ts](../../src/scenes/format.ts), [schema](../../src/scenes/foss-earth-scene-1.schema.json), [validateScene.ts](../../src/scenes/validateScene.ts) | Scene envelope/entity/link records and reference checks to `scenes`; common image identity/interfaces to `images`; individual representation records/schema/validation to the representation owner; registry composition to `360`. Preserve the published version-1 contract. |
| [panoramaMath.ts](../../src/scenes/panoramaMath.ts) | Equirectangular mapping to `equirectangular`; source/GPU cube conventions to `cubemap`; common vectors/image orientation to `images`; orb/view transitions to `360`; placement and geodetic adaptation to scene/host ports. |
| [panoramaResources.ts](../../src/scenes/panoramaResources.ts), [budget.ts](../../src/scenes/budget.ts), [mediaStore.ts](../../src/scenes/mediaStore.ts), [imageHeaders.ts](../../src/scenes/imageHeaders.ts) | Common accounting/cache/header and transport machinery to `images`; structure estimates and acquisitions to each representation; selection/composition to `360`; sheet fetching/extraction/fallback to `preview-sheets`. |
| [cubeTiling.ts](../../src/scenes/tiles/cubeTiling.ts), [tileSelection.ts](../../src/scenes/tiles/tileSelection.ts), [tileScheduler.ts](../../src/scenes/tiles/tileScheduler.ts), [tiledPanorama.ts](../../src/scenes/tiles/tiledPanorama.ts), [sphericalRegions.ts](../../src/scenes/tiles/sphericalRegions.ts) | `tiled-cubemap`, consuming pure face conventions from `cubemap/core` and shared reservations/cache from `images`. |
| [panoramaTextures.ts](../../src/engine/babylon/panorama/panoramaTextures.ts), [panoramaWebGlTextures.ts](../../src/engine/babylon/panorama/panoramaWebGlTextures.ts) | Generic device/upload facilities to `renderer`; cube/equirectangular acquisition adapters to the representation owners. Upload budgets are granted by `images`, not independently multiplied per adapter. |
| [panoramaTileAtlas.ts](../../src/engine/babylon/panorama/panoramaTileAtlas.ts), [WGSL shaders](../../src/engine/babylon/panorama/panoramaShaders.ts), [GLSL shaders](../../src/engine/babylon/panorama/panoramaShadersWebGL.ts) | Tile atlas/lookup to `tiled-cubemap`; source sampling fragments to their representation; orb/immersion draw composition and transition blending to `360`. All use renderer contracts. |
| [panoramaRenderer.ts](../../src/engine/babylon/panorama/panoramaRenderer.ts), [panoramaFlight.ts](../../src/scenes/panoramaFlight.ts), [panoramaInput.ts](../../src/scenes/panoramaInput.ts) | `360` owns viewer drawing, camera handover/momentum and interaction, through supplied renderer/camera/input ports. The file called panoramaFlight describes viewer camera movement, not aircraft flight. |
| [loadScene.ts](../../src/scenes/loadScene.ts), [sceneController.ts](../../src/scenes/sceneController.ts), [sceneHistory.ts](../../src/scenes/sceneHistory.ts), [sceneView.ts](../../src/scenes/sceneView.ts) | Scene selection/replacement/history, entity placement and link orchestration to `scenes`; image lifecycle and active-view state to `360`; resource work delegates to `images` and representations. |
| [scenesPanel.ts](../../src/shell/scenesPanel.ts), [panoramaTabs.ts](../../src/shell/panoramaTabs.ts), [savedImagesSection.ts](../../src/shell/savedImagesSection.ts), [scene settings](../../src/settings/catalogue/scenes.ts) | Scenes panel to `scenes`; two active-view tabs to `360`; cache controls to `images`; structure settings to their owner, contributed to the existing home. |

Tests move with these responsibilities. Mixed integration tests become consumer
contract tests; they must still exercise the combination instead of disappearing
when the files move.

## Preparation and validation tools

| Current tool | Proposed routing |
| --- | --- |
| [prepare-panorama.mjs](../../scripts/prepare-panorama.mjs) | `360` provides the composition CLI, preserving its supported arguments. It decodes via `images`, obtains source sampling from `equirectangular`, and invokes the selected representation's preparation function. The CLI owns no duplicate projection implementation. |
| [panoramaImage.mjs](../../scripts/lib/panoramaImage.mjs) | JPEG/PNG, metadata, orientation and linear-light helpers to `images`; equirectangular pyramid/sampling to `equirectangular`; cube-face output to `cubemap`; tiled face/gutter output to `tiled-cubemap`. Target preparation accepts a source sampler, so cube and equirectangular do not import each other's implementation. |
| [previewSheet.mjs](../../scripts/lib/previewSheet.mjs), [build-preview-sheets.mjs](../../scripts/build-preview-sheets.mjs) | `preview-sheets` owns packing, extension records and verification. The scene-writing CLI composes this in `scenes`/`360` tool entry points; the packing library accepts records and never imports the scene loader. |
| [check-scene.mjs](../../scripts/check-scene.mjs), [checkSceneFiles.ts](../../src/scenes/checkSceneFiles.ts) | `scenes` owns document/reference orchestration; representation hooks enumerate/check files, and `preview-sheets` supplies sheet-to-face equivalence validation. Header/codec checks come from `images`. |
| [build-panorama-examples.mjs](../../scripts/build-panorama-examples.mjs) | `scenes` composes shared examples using the public preparation APIs. Representation-specific fixtures and tests live with the representation. Real application media and import scripts stay application-owned. |

CPU preparation and schema validation must be usable without constructing a
renderer. Source orientation is applied once, color is resampled in linear
light, and asset revisions change whenever generated files change, as the
[current format](../scenes/format.md) requires. Existing public commands and
package exports need compatibility entry points during migration.

## Behavior the split must preserve

- Known version-1 records and existing manifests remain readable. Unknown
  projection handling and optional-extension fallback remain compatible.
- Cubemap face orientation, equirectangular seam/poles, EAC/gnomonic lookup,
  gutters and mixed-level transitions remain consistent across WebGPU, WebGL 2
  and WebGL 1. Existing capability diagnostics remain explicit.
- A sheet failure falls back to the original faces. A missing tile shows the
  available ancestor or preview. A failed sharper source keeps the usable image.
- Shared limits account for concurrent previews, active images, cached tiles and
  replacement overlap. Disposal and scene replacement cancel stale work and
  release reservations; late completions cannot change the current view.
- Image readiness, frame requests and resource handover retain the existing
  render-on-demand contract. Camera entry, interruption and exit preserve motion
  and user input through the host's camera ports.
- A control still has one settings home. Title/credits/links remain visible,
  closing the active image tab exits, and scene context availability remains as
  recorded in the [tab inventory](tab-inventory.md).

## Experiments and other image families

The [progressive-image prototype](../../benchmarks/eac-progressive-prototype/REPORT.md)
compared direct replacement, visiting intermediate levels and residual
refinement. Production has adopted the complete-tile structure with both warps;
the current [scheduler](../../src/scenes/tiles/tileScheduler.ts) requests needed
levels directly. Residual reconstruction remains prototype code, not another
supported version-1 representation. If adopted, its dependent residual data and
reconstruction contract would require its own explicit ownership decision.

KTX2/Basis, WebP and AVIF were discussed in
[research](research/panorama-scenes-research.md); current scene representation
types and [header decoding](../../src/scenes/imageHeaders.ts) accept JPEG and PNG.
Cropped, stereo, HDR, video and depth panoramas are outside the
[current contract](panorama-scenes.md#2-proposed-data-contract). Point clouds,
Gaussian splats and neural radiance representations are also not implemented
by this scene loader. Their possible future repositories must be marked
proposed until an implementation and contract exist.

[Rendering experiments](../validation/panorama-experiments.md) change draw
bookkeeping, shader work, opacity or hidden-globe submission. They are renderer/
viewer variants, not new image structures. The current
[settings catalogue](../../src/settings/catalogue/scenes.ts) separately records
unimplemented mesh-sphere, fisheye and output-cache choices; a repo graph must
not present those as shipped formats.

Geographic map imagery is an additional implemented family outside this 360
split: [XYZ source descriptors](../../src/terrain/imagery/imagerySources.ts),
[map selection](../../src/terrain/imagery/imagerySelector.ts) and
[paged GPU atlas](../../src/engine/babylon/imagery/imageryAtlasLayout.ts).
It remains under the Map/terrain boundary decision in the
[tab inventory](tab-inventory.md); it must not be assigned to `tiled-cubemap`
merely because both fetch image tiles. Geographic coverage/height integration,
imagery pages and panorama face quadtrees have distinct contracts.
