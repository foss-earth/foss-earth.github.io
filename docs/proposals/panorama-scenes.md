# Custom scenes and panorama navigation: preliminary implementation spec

Status: discussion draft, 2026-09-26. Owner: FOSS Earth.

This is a specification scaffold informed by the
[research review](../360-images-virtual-tour-review.md). It records requirements,
proposed contracts and explicit gaps. It is not yet a handoff-ready implementation
spec: visual semantics, release scope, asset delivery and measured defaults remain
open. No implementation, benchmark or device qualification is claimed.

The [research findings](research/panorama-scenes-research.md) supersede parts of this
draft. They affect these places:

- **Orb appearance:** the window family, which samples by view direction and enters
  continuously. A flat window or a fisheye look is left to the user.
- **Entry animation:** expand the orb in place, with no camera flight, while turning the
  camera toward the initial view.
- **First entity types:** the existing tour carries narration in four languages, photos and
  videos as well as panoramas and links.
- **Initial asset path:** mipmapped cube previews sized to the orb, and tiled cubes above
  about 8K.
- **No WebGPU:** a GLSL orb shader is cheap; some current phones still lack WebGPU.
- **Scene content contract:** WGS84 ellipsoid capture heights, a display height above the
  ground, and the GPano pose convention.
- **Settings inventory:** units, bounds and defaults where the research gives a reason.

## Goal and ownership

Load a custom geographic scene into FOSS Earth; discover 20 or more panorama
markers in the globe; enter a photograph, look around, navigate to another
viewpoint and return to the globe without losing context. Keep the runtime generic
and independent of campus branding.

FOSS Earth owns scene validation/loading, geographic placement, panorama rendering,
resource management, camera/input sessions, activation and the shared scene UI.
An optional tour application owns its branding, editorial content and product
composition, consuming documented FOSS Earth exports. A separate app is not a
prerequisite for the reusable feature. 0SFS needs no tour-specific implementation.

## Requirements carried forward from the request

- Babylon.js with the WebGPU backend is required for the new rendering feature.
- Support camera-responsive floating panorama previews and full-view immersion.
- Preserve a selectable sprite/quad path and a mesh-sphere path with adjustable
  sphere quality. Do not assume the mesh path necessarily costs more.
- Preserve user control over rendered-sprite caching and its memory/compute trade.
- Define an open, versioned scene format and support custom content in the globe.
- Build this in FOSS Earth; do not copy the old viewer implementation.
- Expose all decisions affecting compute, memory and bandwidth through the
  [settings registry](settings.md), with units, bounds, defaults and reasons.

## Decisions needed before the implementation handoff

| Decision | Proposed starting point | Why it matters |
| --- | --- | --- |
| Orb appearance | Directional panorama window inside a circular/spherical boundary; pending user choice | Exterior-ball mapping, optical-bubble mapping and a window show different pixels. |
| First entity types | Panorama markers, labels and viewpoint links first; keep a typed entity envelope | General glTF placement, arbitrary images and authored animation materially expand the release. |
| Marker placement and visibility | Separate capture pose from display offset; depth-tested markers plus a scene list | Interior viewpoints and occluded markers must remain discoverable; exact depth and hit policy need agreement. |
| Entry animation | Preserve preview look direction; reversible expansion/fade; no forced physical flight to the decorative orb center | A single panorama cannot provide correct translational parallax. |
| Input | Drag to look, wheel/pinch to change FOV, explicit enter/exit and keyboard equivalents | Resolve signs, inertia, bounds, touch gestures and browser Back before implementation. |
| Initial asset path | Full monoscopic equirectangular inputs with prepared previews; assess tiled immersion before claiming large-image support | Preview loading and active-view detail need independent budgets. |
| No WebGPU | Keep the globe's current behavior; show scene metadata/list and an explicit unsupported immersive-view state | Actual backend must be checked. A WebGL panorama fallback is an additional scope decision, not an implicit promise. |
| Authoring | Versioned JSON plus a documented preparation/validation workflow first | A graphical scene editor is a separate, unconfirmed deliverable. |
| Comparison mode | Preserve an extension point; do not assume it is required for the tour's first release | Synchronized side-by-side images affect asset, view and interaction contracts. |
| Target hardware and acceptance numbers | Explicitly select devices and numerical budgets before performance acceptance | “Phones” and “60 FPS” alone are not reproducible requirements. |

These are proposals, not user-approved decisions. They can be resolved
independently; shader optimization need not block discussion of scene semantics.

## Scene content contract

Use a project-defined JSON manifest with a published schema and migration rules.
Reference image resources and, when supported, glTF models. Keep 3D Tiles available
as a later collection-indexing adapter; neither it nor KHR_interactivity is needed
to express the initial panorama records. The [review](../360-images-virtual-tour-review.md)
documents why the original portability claims are insufficient.

The format should separate assets from placed entities so one source can be shared
without repeated downloads or embedded copies. Required categories:

| Category | Contract to specify |
| --- | --- |
| Identity | Format identifier, schema version, scene ID/revision and stable asset/entity IDs |
| Scene | Title, description, attribution, initial overview, optional starting panorama |
| Panorama asset | Projection, coverage, actual dimensions, orientation, color encoding, preview and immersion representations, relative URLs and content revision |
| Panorama placement | Capture position, explicit height reference, display offset in local ENU and marker size |
| Viewing | Image pose separately from initial heading/pitch/FOV; FOV axis named explicitly |
| Navigation | Links by stable entity ID; optional arrival view; readable labels |
| Extension | Discriminated entity types, explicit required capabilities and documented unknown-type handling |

For example, this sketches the separation; field names and values are illustrative,
not an implemented schema or settings defaults:

```json
{
  "format": "foss-earth-scene",
  "version": 1,
  "id": "example-tour",
  "assets": {
    "courtyard-photo": {
      "type": "panorama",
      "projection": "equirectangular",
      "coverage": "full-sphere",
      "colorSpace": "srgb",
      "representations": [
        { "role": "preview", "url": "images/courtyard-preview.jpg", "width": 1024, "height": 512 },
        { "role": "immersion", "url": "images/courtyard.jpg", "width": 8192, "height": 4096 }
      ]
    }
  },
  "entities": [
    {
      "id": "courtyard",
      "type": "panorama",
      "asset": "courtyard-photo",
      "label": "Courtyard",
      "capturePosition": { "latDeg": 0, "lonDeg": 0, "ellipsoidHeightMeters": 10 },
      "pose": { "convention": "GPano", "headingDeg": 0, "pitchDeg": 0, "rollDeg": 0 },
      "marker": { "offsetEnuMeters": [0, 0, 4], "radiusMeters": 1 },
      "initialView": { "headingDeg": 0, "pitchDeg": 0, "horizontalFovDeg": 75 },
      "links": []
    }
  ]
}
```

Before freezing v1, specify the following precisely:

- WGS84 geodetic position, east/north/up axes, heading sign and north reference,
  image axes, quaternion/Euler conversion, degrees versus radians, image mirroring
  and cube-face ordering where applicable. GPano has a defined rotation order;
  do not reinterpret its angles as Babylon Euler angles.
  [GPano convention](https://developers.google.com/streetview/spherical-metadata).
- Start with an explicit supported height reference. Never silently interpret
  sea-level height as ellipsoid height. If terrain-relative placement is included,
  define availability, refinement and capture-versus-display behavior.
- Manifest orientation overrides imported metadata explicitly; missing orientation
  must have a visible, documented treatment. Authoring must provide a way to align
  north and level the horizon.
- Relative URLs resolve against the manifest URL, independently of the hosting
  page. Define local-file import/base resolution separately if included.
- Validate IDs/references, finite coordinates, dimensions, projection/coverage,
  supported versions and asset limits before allocating resources. Reject a broken
  required contract; report and skip optional unsupported content predictably.
- Descriptions are text, not executable HTML. The manifest carries no scripts or
  arbitrary shaders. Attribution belongs to its actual content. Scene files do not
  silently replace the user's resource budgets or persist quality preferences.
- Define atomic scene replacement and multiple-scene namespacing if both are in
  scope. Keep save/export and input normalization round-trippable.

## Rendering and visual contract

Separate **appearance**, **geometry implementation**, **source representation**,
and **output caching**. Only the latter three are performance choices. Start from
one agreed appearance, then compare implementations of that appearance.

The first baseline should shade directly from bounded preview textures and use
the same orientation/color functions as immersion. Native WGSL through Babylon is
the proposed implementation route. A compute pass and offscreen sprite targets
are not prerequisites for drawing a camera-responsive quad.

Correctness requirements for every supported path:

- Use render-relative or local coordinates for ray math. Keep authoritative
  geographic position in CPU precision; do not subtract Earth-sized float32
  positions in the fragment shader.
- Specify conservative projected bounds, clipping and behavior when the camera
  approaches or crosses the marker. A sphere-depth impostor writes hit depth in
  the runtime's depth convention; a planar window uses an explicitly chosen depth
  rule. Neither is implicit from using a quad.
- Picking follows the visible shape and occlusion policy. Expanded touch targets
  are a deliberate interaction tolerance; transparent corners are not orb hits.
- Treat silhouette antialiasing, seam derivatives, pole filtering, mipmaps and
  tile borders separately. Test readable text and compass directions for mirroring.
- Photographs are unlit by default. Define texture decoding, linear compositing,
  final display conversion and tone mapping consistently so caching or entry does
  not change exposure/color. [Babylon image processing](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/materials/shaders/image_processing.md).
- Full-view immersion rotates at the capture point. The globe, atmosphere,
  lighting environment and photograph background have separate visibility/state;
  changing `environmentTexture` is not the transition mechanism.

## Resource and cache contract

Track source GPU textures, decoded CPU staging, in-flight decode/upload work,
rendered caches and transition overlap separately. Device memory is generally an
estimate, not an exact browser-visible VRAM reading; label the accounting honestly.
Show panorama usage alongside the globe's existing resource usage. Independent
budgets do not imply independent physical memory; do not silently raise either
budget to accommodate the other subsystem.

Visible markers request preview resources. The active panorama and selected
destination receive higher priority and may refine independently. Pin resources
currently sampled. Under insufficient budget, retain a usable lower-resolution
representation and report the limit; never load every full panorama merely because
its marker is visible. Lowering a budget must evict or reduce work safely.

Choose whether immersion v1 uses whole-image resolution variants or tiled pyramids
before freezing delivery. The simple path is acceptable only within documented
dimensions and budgets. A tiled path must define projection, levels, tile sizes,
borders, visible-region selection, fallback coverage and replacement without holes.
Offline conversion and previews belong in a reproducible asset-preparation tool,
with orientation/color preserved and output independently validated.

For sprite caching, begin evaluation with at most a current cached view per visible
orb rather than precomputing an angular lattice. Cache identity includes asset
revision, source level, visual mapping, relevant relative pose/FOV, output size and
color settings. A perspective sphere also depends on relative distance. Define
allowed visible error and bounded refresh work; expose any approximation. Disabling
caching switches safely to direct rendering and releases its resources.

Every load is cancellable or made harmless when obsolete. Scene teardown and rapid
selection changes must prevent late work from attaching textures or restarting
disposed rendering. Bound requests, decode concurrency, staging and upload work;
do not turn “prefetch neighbors” into unlimited background downloads.

## Navigation and interaction contract

Proposed states:

```text
overview -> preparing -> entering -> immersive -> exiting -> overview
                |            |          |
                +-- cancel --+          +-> preparing another destination
```

This describes user-visible states; loading may continue to refine an already
usable view. Every transition needs an owner and cancellation token.

1. Selection gives immediate feedback and starts loading a usable preview. Keep
   the existing view usable if loading fails. High resolution is not a prerequisite
   for entry, and a failed destination must not destroy a working current panorama.
2. Entry captures the globe camera, navigation mode and focus state; cancels active
   gestures/inertia; acquires camera/input ownership; and transitions only once its
   minimum image coverage is ready. Preserve the chosen look direction/FOV rule.
3. Immersion owns look/zoom input. Define whether hidden globe rendering and terrain
   streaming pause, and how much return-view data is retained inside user budgets.
   If streaming continues, choose its geographic view/focus explicitly; a local
   panorama camera must not accidentally become the globe tile-selection camera.
4. Exit/Back/cancel release ownership and restore a valid overview and focus. Define
   the return view after several linked panoramas, not only after one entry.
5. Rapid re-selection, scene removal, map-source changes, device loss and teardown
   must resolve to a coherent state with no stranded input or continuous render hold.

Tap/click activation must be separated from drag and pinch. Provide named keyboard
actions and a scene list, focus restoration, and reduced-motion entry/exit. Bind
URL identity to scene ID, viewpoint ID and viewing direction, with a deliberate
browser-history policy. Spatial hotspots and tour controls must fit the existing
shell; settings have one tab section, and control groups use paragraph grids.

## Integration with the current repository

These are inspected seams, not promises that the needed API already exists:

Existing public surfaces include `foss-earth/runtime`, `foss-earth/layers`,
`foss-earth/cameraMath`, `foss-earth/settings` and `foss-earth/shell`. The table also
links internal implementation points; those links are not permission for consuming
applications to import them directly.

| Existing code | Proposed work |
| --- | --- |
| [`GlobeLayer`](../../src/engine/types.ts), [`BabylonLayerState`](../../src/layers/types.ts), [`LayerRegistry`](../../src/layers/layerRegistry.ts) | Define asynchronous content readiness/cancellation and dynamic activation registration. Current setup/destroy and captured POI arrays are insufficient for progressive scenes. |
| [`BabylonRuntime`](../../src/engine/babylon/createBabylonRuntime.ts), [`CameraController`](../../src/camera/cameraState.ts), [`inertial input`](../../src/input/inertialCameraController.ts) | Introduce a generic navigation-session contract for input/camera ownership and restoration. Do not repurpose flight `simMode`. Map changes must respect the active session. |
| [`poiTracking`](../../src/layers/poiTracking.ts) | Generalize activation without changing existing track-a-POI behavior. Current tracking is mouse-oriented and is not panorama entry. |
| [`renderScheduler`](../../src/engine/babylon/renderScheduler.ts) | Loads and settings request frames; transitions acquire/release continuous holds; stable immersion and previews return to idle. No second permanent render loop. |
| [`createRendererMode`](../../src/engine/babylon/createRendererMode.ts) | Gate panoramas on actual backend/capabilities. The current WebGPU request can fall back to WebGL. |
| [`imageryResidency`](../../src/engine/babylon/imagery/imageryResidency.ts) | Reuse relevant bounded-resource patterns; do not assume the map page atlas or provider-specific disk cache is a generic panorama store. |
| [`cameraMath`](../../src/camera/cameraMath.ts), [`surfaceQuery`](../../src/terrain/surfaceQuery.ts) | Geographic placement, height queries and compatible local/render-relative transforms. |
| [`settings`](../../src/settings/index.ts), [`shell`](../../src/shell/index.ts) | Register controls and readings in existing sections; expose new public scene APIs when hosts need them. |

Proposed modules belong under FOSS Earth's scene/panorama areas, with pure schema,
projection, selection and lifecycle logic separated from Babylon resources and UI.
Choose final paths/API signatures after the above contracts are settled. Consumers
use public package exports, not deep imports. Preserve existing globe and 0SFS
behavior when no panorama session is active.

## Settings inventory to complete

The final specification must give each implemented control a stable ID, real unit,
hard/device bounds, default, reason, UI home and live reading. This inventory does
not invent measured defaults:

| Group | Required controls/units |
| --- | --- |
| Rendering | Quad/mesh implementation; sphere tessellation count or projected silhouette error in px; preview pixel-density target and resolution bounds in px |
| Source loading | GPU and staging budgets in MiB; request/decode concurrency counts; upload allowance in MiB/frame; prefetch count or byte allowance |
| Output cache | Enabled; budget in MiB; refresh allowance in ms/frame or texels/frame; maximum visible reprojection error in px; target-resolution bounds in px |
| Navigation | Transition duration in ms; FOV range in degrees; look/zoom sensitivity and inertia with defined units; reduced-motion behavior |
| Visibility | Marker screen-size bounds if clamped; visibility/detail cutoffs and their units; selection tolerance in CSS px |

Only include a control when its mechanism exists. Avoid duplicate controls for the
same policy, opaque quality names, hidden thresholds and defaults based on a preset
name. Show automatic values moving only inside a user-set range. Authoring a marker
radius or recommended starting view does not grant the scene control of GPU budgets.

## Implementation stages and acceptance evidence

1. **Resolve semantics and assets.** Choose appearance and first entity types;
   obtain representative image dimensions/orientations; finalize scene v1 and
   preparation workflow; specify entry/exit and unsupported-backend behavior.
2. **One complete vertical slice.** Load a neutral fixture through the manifest,
   render a direct preview, enter, rotate, exit and dispose. Add the generic runtime
   ownership seams and bounded source loading needed for this path.
3. **Scene navigation.** Load 20+ preview markers, links/list, progressive detail,
   interruption/error handling and persistent settings. Verify no hidden full-image
   loading and correct resource accounting.
4. **Equivalent alternatives.** Implement the requested adjustable sphere path and
   optional output cache against the same appearance. Measure before selecting
   optimized defaults or adding an automatic switching policy.
5. **Handoff/release validation.** Record approved target devices, quality settings,
   data fixture and numerical acceptance targets. Run relevant checks as changes
   land and the full repository CI once at completion; check consumers for shared
   API changes. Do not claim qualification on an untested device.

Correctness fixtures must cover cardinal directions, horizon/roll, readable text,
seam and poles, off-axis/near-camera bounds, terrain and orb overlap, portrait/DPR/FOV
changes, identical direct/cached appearance, interrupted navigation, slow/failed
assets, budget reduction, late completions after disposal and renderer recovery.
Use pure math/state tests where possible and focused visual checks where required.

The later performance experiment should compare direct quad, adjustable mesh and
cached output at matched image quality. Separately compare source representations.
Include the actual globe workload, 20+ markers, small and large footprints, camera
rotation/translation, idle periods and transitions. Record CPU/GPU frame-time
distributions, draw calls, pixel coverage, cache refreshes, source/cache/staging
bytes, transferred bytes, first usable image time and transition stalls. Verify
real hardware GPU use and report thermal/sustained behavior on selected phones.

No benchmarks or servers are started by this document. Numerical pass/fail targets
and settings defaults remain explicit gaps; implementation should not inherit the
original research's arbitrary distance tiers to fill them.
