# Custom scenes and panorama navigation

Status: stage 1 implemented, 2026-09-27. On one desktop configuration, every orb
check of the automated campus check passes, but the globe alone misses the frame
budget at the map detail asked for, so the check as a whole does not pass. Manual
acceptance is pending (see [Stage 1 as built](#stage-1-as-built)).
Stages 2–5 remain proposals. Owner: FOSS Earth.

This consolidates the [initial review](../360-images-virtual-tour-review.md),
[research](research/panorama-scenes-research.md) and
[correction review](research/panorama-scenes-research-review.md). It replaces the
preliminary scaffold. Historical research is evidence, not a competing specification.
No production panorama feature or GPU/device qualification is claimed.

The [2026-09-28 WebGL performance review](../webgl-panorama-performance-review.md)
records the subsequent low-end-device findings, panorama-first priorities, and
optimization candidates with their UX costs. It is a review for selection, not an
implemented optimization pass or a replacement for this specification.

**Requirements** below come from the user's instructions. **Proposed decisions**
are the recommended implementation contract, open to review. **Evidence** is
exercised CPU behavior or inspected current code. **Provisional defaults** are
unmeasured development choices with explicit reasons, not user approvals.

## 1. Scope, ownership and public surfaces

Requirements: Babylon.js with the actual WebGPU backend; camera-responsive panorama
orbs, immersion and reversible navigation; selectable quad/sprite and mesh-sphere
implementations with adjustable sphere quality; user-controlled output caching;
a documented versioned scene format; and visible controls over resource spending.
Appearance, geometry, source representation and output caching are independent.

The first useful release loads a neutral scene, discovers multiple distinct
panoramas through markers and an accessible list, enters, looks around, follows
links, exits to the saved globe overview and disposes scene-owned work. Plain
text, attribution and optional stop/group lists ship with this path. The complete
release includes the requested mesh/cache alternatives; the first implementation
stage is deliberately smaller.

The user's concrete acceptance scene is **one test 360° image floating above the
University of Minnesota's Minneapolis campus**. Moving the globe camera around it
must update the orb's directional image immediately. The implementation agent runs
the reproducible check first, then supplies the same scene for the user's manual
test. This is a required acceptance fixture, not campus branding or tour migration;
it supplements the multi-panorama lifecycle path. The procedure is specified below.

FOSS Earth owns this feature and its preparation tools. Proposed new modules belong
in `src/scenes/` (format, loading, pure math/state and navigation),
`src/engine/babylon/panorama/` (GPU resources/rendering), and
`scripts/prepare-panorama.mjs` (offline preparation). These are future paths.
Publish `foss-earth/scenes` for validation, scene handles and format types; extend
`foss-earth/runtime` for generic navigation ownership and `foss-earth/shell` for
scene UI. Use existing `/settings`, `/input`, `/layers` and `/cameraMath` surfaces;
consumers never deep-import internal Babylon files. Controller device handling
stays in gamepad-tools. No tour-specific code belongs in 0sfs.

Deferred: general model placement, cropped/stereo/HDR/video panoramas, narration,
multilingual editorial workflows, comparison mode, graphical authoring, arbitrary
animation/scripts/shaders and collection indexing through 3D Tiles. Optional tour
branding, registration, analytics and content migration are separate product work.
Existing tour media informs later scope; it does not authorize migration. A stop
can contain several panoramas and is never an alias for an image.

Proposed backend policy: if actual WebGPU initialization fails, preserve the globe's
existing fallback and scene metadata/list, report panorama rendering unavailable,
and disable entry. A WebGL panorama path is additional scope with its own resource,
recovery and validation work. Prior-art discussion establishes neither clearance
nor a new implementation prerequisite.

## 2. Proposed data contract

FOSS Earth owns `foss-earth-scene`, version `1`, and its published JSON Schema.
This is a proposed contract for implementation, not an already supported loader.
Version 1 accepts full, monoscopic, opaque SDR panoramas: a 2:1 equirectangular
image or six equal square cube faces. Cropped images, stereo, HDR, video, depth,
models, authored scripts and arbitrary shaders are outside this first contract.
Namespaced extensions preserve room for later entity types without executing code.

Assets identify pixel content and its representations; panorama entities place and
orient that content. A representation is one complete resolution of the same image,
not another photograph. All variants share normalized coverage, orientation and
color treatment. Different instances can reference one asset without downloading it
twice. A stop/group is an ordered collection of entity IDs, not an image container.
Navigation links target a specific panorama entity, never an ambiguous group.

The following is a fictional two-panorama scene. URLs and byte counts illustrate
the contract; they are not claims that these files already exist.

```json
{
  "format": "foss-earth-scene",
  "version": 1,
  "id": "neutral-garden",
  "revision": "1",
  "title": "Garden and courtyard",
  "requiredExtensions": [],
  "assets": [
    {
      "id": "garden-image", "revision": "1", "type": "panorama-image",
      "colorSpace": "srgb", "alpha": "opaque",
      "attribution": { "text": "Example garden photograph", "license": "CC0-1.0" },
      "representations": [
        {
          "id": "preview-128", "role": "preview", "projection": "cube",
          "faceSize": 128, "mimeType": "image/jpeg", "encodedBytes": 36000,
          "faces": {
            "px": "media/garden/128/px.jpg", "nx": "media/garden/128/nx.jpg",
            "py": "media/garden/128/py.jpg", "ny": "media/garden/128/ny.jpg",
            "pz": "media/garden/128/pz.jpg", "nz": "media/garden/128/nz.jpg"
          }
        },
        {
          "id": "whole-4096", "role": "immersion", "projection": "equirectangular",
          "width": 4096, "height": 2048, "mimeType": "image/jpeg",
          "encodedBytes": 2400000, "url": "media/garden/4096.jpg"
        }
      ]
    },
    {
      "id": "courtyard-image", "revision": "1", "type": "panorama-image",
      "colorSpace": "srgb", "alpha": "opaque",
      "attribution": { "text": "Example courtyard photograph", "license": "CC0-1.0" },
      "representations": [
        {
          "id": "preview-128", "role": "preview", "projection": "cube",
          "faceSize": 128, "mimeType": "image/jpeg", "encodedBytes": 42000,
          "faces": {
            "px": "media/courtyard/128/px.jpg", "nx": "media/courtyard/128/nx.jpg",
            "py": "media/courtyard/128/py.jpg", "ny": "media/courtyard/128/ny.jpg",
            "pz": "media/courtyard/128/pz.jpg", "nz": "media/courtyard/128/nz.jpg"
          }
        },
        {
          "id": "whole-4096", "role": "immersion", "projection": "equirectangular",
          "width": 4096, "height": 2048, "mimeType": "image/jpeg",
          "encodedBytes": 2800000, "url": "media/courtyard/4096.jpg"
        }
      ]
    }
  ],
  "entities": [
    {
      "id": "garden", "type": "panorama", "assetId": "garden-image",
      "title": "Garden", "description": "A fictional open garden fixture.",
      "capture": { "longitudeDeg": 0, "latitudeDeg": 0, "height": null },
      "imagePose": { "headingDeg": 0, "pitchDeg": 0, "rollDeg": 0 },
      "marker": { "mode": "ground-relative", "eastM": 0, "northM": 0, "offsetM": 4 },
      "initialView": { "headingDeg": 0, "pitchDeg": 0, "verticalFovDeg": 60 },
      "links": [{ "id": "to-courtyard", "target": "courtyard", "label": "Go to courtyard" }]
    },
    {
      "id": "courtyard", "type": "panorama", "assetId": "courtyard-image",
      "title": "Courtyard", "description": "A different fictional photograph.",
      "capture": {
        "longitudeDeg": 0.0002, "latitudeDeg": 0,
        "height": { "meters": 2, "datum": "WGS84-ellipsoid", "source": "synthetic fixture" }
      },
      "imagePose": { "headingDeg": 90, "pitchDeg": 0, "rollDeg": 0 },
      "marker": { "mode": "capture-relative", "eastM": 0, "northM": 0, "offsetM": 4 },
      "initialView": { "headingDeg": 270, "pitchDeg": 0, "verticalFovDeg": 60 },
      "links": [{ "id": "to-garden", "target": "garden", "label": "Return to garden" }]
    }
  ],
  "groups": [{ "id": "outdoor-spaces", "title": "Outdoor spaces", "members": ["garden", "courtyard"] }],
  "initialPanorama": "garden"
}
```

**Exact semantics.** Scene, asset, entity, group and representation IDs are nonempty,
case-sensitive ASCII strings matching `[A-Za-z0-9._-]+`, unique in their respective
scopes; representation IDs are unique within an asset and link IDs within a source
entity. Runtime keys include the scene namespace and its generation. References
never depend on array position. Scene revision
changes on editorial/placement changes; asset revision changes whenever pixels,
representations or their interpretation change. Cache identity includes resolved
asset URLs, asset revision, representation ID and renderer generation. The initial
panorama is a suggested destination; loading a scene still opens its overview unless
the host explicitly requests immersion. An optional `overview` is `{target:{longitudeDeg,latitudeDeg,height},
distanceMeters,headingDeg,pitchDeg,verticalFovDeg}`. Its target uses the capture
coordinate/height convention below; null height resolves to displayed ground, or
remains pending with the host view retained. Distance is positive camera-to-target
metres; heading/pitch describe camera forward (negative pitch looks down), and
vertical FOV is strictly between 0 and 180 degrees. With no overview, preserve the
host view. This authored view is separate from the full runtime snapshot saved at
entry. A scene document never replaces user quality budgets or persisted settings.

Longitude is in `[-180,180)`, latitude in `[-90,90]`, degrees on WGS84. Capture
height is absent/null when unknown, never silently zero. Known height is metres
above the WGS84 ellipsoid; optional accuracy and provenance describe uncertainty.
Orthometric inputs must be converted during preparation with a named source datum
and model, retaining their provenance. Terrarium is an encoding, not a datum claim.
At a geographic pole, the supplied longitude defines the otherwise ambiguous ENU
meridian for this format; authors must provide it consistently across representations.

Marker east/north offsets are metres in capture-location ENU, independent of image
pose. `capture-relative` requires known capture height and adds `offsetM` vertically.
`ground-relative` samples the displayed surface at the offset horizontal location
and adds `offsetM`; its sampled surface height is never written into capture data.
Until that surface is available, the marker remains pending and the panorama stays
accessible in the scene list. For ground-relative horizontal offsets, construct
the ENU anchor on the WGS84 ellipsoid at the capture longitude/latitude
(computational height zero), apply east/north displacement in CPU float64 ECEF,
then convert to longitude/latitude for the ground query. That computational zero
is never a capture-height estimate or stored metadata. Capture-relative offsets
use known capture ECEF instead. A changed surface can update the marker,
but cannot alter the capture record. Freeze the selected marker placement during
entry; re-resolve on exit or source change. Optional `marker.radiusMeters` is positive
and overrides the fallback radius setting; screen-size bounds still apply.
The marker position, clipping axis and content direction
remain distinct inputs to the visual contract below.

Image-local axes are right-handed: `X` right/east at zero pose, `Y` forward/north,
`Z` up. Equirectangular coordinates have `u` right and `v` down, with image center
forward. Define `theta=2π(u−1/2)`, `phi=π(1/2−v)` and
`d=(sin(theta)cos(phi), cos(theta)cos(phi), sin(phi))`. Image pose maps this direction
to capture ENU using `R=Rz(−heading) Rx(pitch) Ry(roll)`, with right-handed rotations
and column vectors. Sampling applies `R⁻¹`. Heading is clockwise from true north,
pitch is positive above the horizon, and roll follows that exact matrix, matching
[GPano's convention](https://developers.google.com/streetview/spherical-metadata).
Headings are in [0,360), pose pitch in [−90,90], roll in (−180,180]; view pitch
is in [−90,90] and vertical FOV strictly in (0,180), with navigation settings
limiting the eventual view as specified below. Version 1 accepts these Euler
fields only; a future quaternion form needs its own
explicit discriminator and equivalence fixtures, not a second simultaneous pose.
`imagePose` is required. Missing source orientation needs authored alignment with
approximate provenance; the viewer never invents survey-aligned north. Optional
`initialView` falls back to the navigation policy when absent. Optional uncertainty
fields are `capture.horizontalAccuracyMeters` and `capture.height.uncertaintyMeters`,
each finite and nonnegative. Height `source` records provenance, not an inferred
conversion.

Cube face names refer to these source axes, independent of Babylon texture order.
For face coordinates `u,v` in `[0,1]`, use
`normalize(f+(2u−1)r+(1−2v)t)`, where `t` points toward the image's top edge:

| Source face | Forward `f` | Right `r` | Top `t` |
| --- | --- | --- | --- |
| `px` | `+X` | `−Y` | `+Z` |
| `nx` | `−X` | `+Y` | `+Z` |
| `py` | `+Y` | `+X` | `+Z` |
| `ny` | `−Y` | `−X` | `+Z` |
| `pz` | `+Z` | `+X` | `−Y` |
| `nz` | `−Z` | `+X` | `+Y` |

Preparation/upload must explicitly translate that table to the renderer's cube
convention; copying filenames into a native face array does not establish matching
orientation. Cardinal labels, readable text and shared edges verify the conversion.
Initial view is world ENU heading/pitch and **vertical** rectilinear FOV, independent
of image pose. It is an authored arrival suggestion, not the transform of the image.
An optional link `direction:{headingDeg,pitchDeg}` places a hotspot in the source
panorama's ENU view; `arrivalView` may override the destination's initial view. A
link without direction remains in the list; unknown heights do not invent a hotspot.

JPEG and PNG decode to normalized opaque sRGB pixels; preparation applies EXIF
orientation, converts color profiles and imports GPano once. Runtime manifest fields
then govern all representations; embedded metadata cannot apply another rotation.
Attribution contains plain text, optional license and optional link, displayed while
the asset is visible; arbitrary HTML is not rendered. All relative media and credit
URLs resolve against the manifest's final response URL. Programmatic JSON requires
an explicit `baseUrl`. Browser fetch/CORS rules apply; fetch uses `credentials:"omit"`
unless a service-specific host resolver explicitly owns authorization. The loader
adds no credentials or user-specific headers to third-party hosts. Manifest URLs use HTTP(S); local file
selection is a separately owned blob resolver whose URLs are revoked on disposal.

Validation checks finite numbers, angle ranges, positive integral dimensions and
byte counts, 2:1/full coverage, six complete square faces, unique IDs and references.
Each supported panorama requires at least one complete preview cube. Immersion
representations are optional; their absence permits preview-only entry with an
explicit detail limitation. PNG pixels must be opaque after preparation.
Declared encoded bytes are the prepared files' total bytes, six faces summed for a
cube; actual responses and decoded dimensions must match before publication. MIME
and image signatures must agree. Unknown properties in known v1 records fail with
paths; namespaced `extensions` are the explicit extensibility container. Unknown
entity types are retained as unsupported list items with diagnostics; unsupported
required extensions, malformed known records and broken references fail the scene.
`requiredExtensions` names keys in `extensions`; unknown required names fail. An
entity may set `required:true`; an unsupported required entity fails instead of
being skipped. Links to optional unsupported entities are listed disabled. Validate
manifest byte/count settings before allocating resources; check response lengths
and decoded dimensions independently of untrusted declarations.
Unknown format versions fail before media requests; migrations are explicit tools.
One active revision is mounted per handle; multiple handles have independent
scene namespaces but share global resource caps. Replacement validates a candidate
before an atomic metadata/entity swap; reuse unchanged immutable resources and
load new previews progressively within caps, without duplicating every texture. Cancel
the previous generation, release reference-counted resources and ignore stale
arrivals. Validation/pre-swap failure preserves the previous scene. Post-swap media
failures leave affected entities unavailable in the list, without an unbudgeted
rollback copy, and each is logged as it happens (`SceneController.onFailure`,
printed by `connectSceneLog`). Disposal is idempotent and releases
listeners, camera ownership, GPU resources, decoded images, requests and blob URLs.

## 3. Visual contract and corrected evidence

Proposed default: a 90° rectilinear window. Offer the orthographic-fisheye window
as a selectable appearance after porting and checking the blend below. Mesh spheres
can shade either window mapping; UV-ball, reflection and refraction are different
appearances, not equivalent renderer alternatives.

The [CPU contract and evidence](../validation/panorama-visual-contract.md) and
[reference script](../../scripts/render-orb-appearances.mjs) establish ray behavior.
They do not establish GPU cost, interactive preference, production mip filtering
or equivalence of the proposed transition compositor.

### Coverage is separate from ray equivalence

Let camera O, displayed marker M, radius R>0, d=|M−O|, axis a=(M−O)/d and normalized
view ray v. For d>R, the forward silhouette is the cap δ=acos(a·v)≤α, where
α=asin(R/d)<π/2. A rectangular perspective viewport with both FOV axes <π is fully
covered iff all four corner rays satisfy `a·v ≥ cos α`. Production must cover the
whole pixel/filter footprint, not just pixel centers. At d=R the exterior limit
covers the inward hemisphere `a·v≥0`. At d<R all directions are covered and the
reference returns v, including at d=0 without evaluating an undefined axis.
Crossing inside while looking outward can abruptly reveal uncovered rays; it is
not a universally continuous silhouette transition.

For rectilinear preview half-angle βR, strictly `0<βR<π/2`, the external covered ray
samples `atan(tan δ · tan βR / tan α)` while α<βR, and v exactly when α≥βR. Thus
nondegenerate full-frame handoff needs **coverage AND α≥βR**, or an inside view
already fully revealed. Axis equality alone does not suffice. At the surface use
the identity branch before tangent/division operations; outward coverage still fails.

Required counterexample: square 60° vertical-FOV viewport, 90° preview, d/R=1.5.
α=41.810315° exceeds the corner angle 39.231520°, so coverage passes. But a 30° view
ray samples 32.842130°, so directional equivalence fails. The previous coarse
entry sequence skipped this interval.

An actual renderer handoff also preserves image pose, camera orientation/FOV,
source/mip/filter state, color/exposure path, full opacity and source readiness.
Freeze source LOD at handoff and refine afterward. Equal rays alone cannot guarantee
equal pixels across different textures or postprocessing. Depth and near-plane
clipping must not remove fullscreen handoff pixels.

### Continuous fisheye-to-rectilinear mapping

The old orthographic mapping collapsed toward the axis near the surface, then
jumped to view rays inside. The new reference blends angles on covered external rays:

```text
ρ = sin δ cos α / (cos δ sin α)             [0,1]
θF = asin(ρ sin βF)                        0 < βF ≤ π/2
θR = δ                                    if α ≥ βR
     atan2(ρ sin βR, cos βR)               otherwise
q = clamp((α − αstart)/(αend − αstart), 0, 1)
λ = q²(3 − 2q)
θ = (1 − λ) θF + λ θR
D = cos θ · a + sin θ · normalize(v − (a·v)a)
```

At δ=0 return a; at λ=1 bypass θF. Development defaults: αstart=20°, αend=45°,
βR=45°, βF=90°, enforcing `0<αstart<αend≤βR`. λ=0 retains the fisheye endpoint;
λ=1 is the flat endpoint, which becomes identity at α≥βR. Both radial functions
are monotone, so their convex angle blend is monotone; evaluated directions remain
finite. Near the surface take the identity branch, never `tan(π/2)` or `0×infinity`.
This is C0 continuity: the flat rule has a time-derivative kink at α=βR even with
smoothstep blending. Its perceptual velocity change remains a usability question.

For βF=π/2 and λ<1, `dθF/dρ=1/sqrt(1−ρ²)` diverges at the rim. The direction has
a finite one-sided limit, but no bounded derivative. Full FOV 180° is valid only
for this fisheye, never rectilinear. CPU supersampling is not GPU filtering evidence:
production needs valid-side footprint evaluation, conservative rim LOD, silhouette
antialiasing and seam-aware mips. Do not evaluate invalid neighboring rays and rely
on fragment discard to hide NaNs. Edge text and pole detail are acceptance cases.

### Capture, marker, clipping and content

Keep capture C (metadata, possibly unknown height), displayed marker M (renderable
placement), clipping axis a (camera-to-M), and sampled content D (window mapping,
then inverse image pose) separate. Proposed policy uses the **displayed marker
axis for content as well as clipping**, matching this reference. Raising M changes
preview content: 4 m at 30 m horizontal distance changes the axis by atan(4/30),
7.595°. A photograph supplies no translated parallax. Capture still defines the
geographic tangent frame and link bearings. A capture-locked content axis would
need a different transported-frame blend and separate validation.

### Depth, picking, transitions and color

Overview quads use conservative sphere projection bounds, analytic ray/sphere
coverage and intersection depth, and render-relative positions computed from CPU
float64 geographic coordinates. Transparent corners are not hits. Mesh spheres
use the same fragment direction mapping with adjustable geometry; silhouette and
depth approximation must be declared and checked. Small on-axis projected diameter
`H R/(d tan(vFov/2))` and cube-face rule `facePx ≈ diameterPx/tan βR` are
**center-density approximations**, not conservative texel-density bounds.
Off-axis footprints, cube seams and fisheye rims need independent checks.

Markers are depth-tested against terrain/tiles and each other. Hidden markers
remain in the list. Picking follows the visible silhouette and nearest unoccluded
depth; enlarged hit targets are an explicit separate tolerance. Ambiguous expanded
hits focus a candidate list ordered by depth, then stable ID. Decluttering retains
selected/focused markers first, then nearer markers, then stable ID, with a visible
count and screen-spacing control; omitted markers stay list-accessible. Clustering
is deferred. Movement beyond the existing drag threshold cancels activation.

Proposed entry: preserve overview camera position and snapshot; expand a selected
portal overlay using virtual sphere-ray geometry rather than grow world geometry
through buildings. Initially match the selected orb's depth-clipped image, then
blend its depth mask toward unoccluded coverage with expansion progress. Other
markers stay with the globe layer. Hold presentation orientation until coverage
and ray equality pass; switch to fullscreen directional rendering, then level/turn
the view. This keeps an off-center orb visible before camera rotation. Rotation
preserves identity directions once the equality condition holds, but coverage must
still be checked while any boundary remains. If any corner has `a·v≤0`, exterior
expansion with this fixed axis cannot finish before the surface; use the explicit
fade/cut path instead of crossing inside and claiming continuous reveal. A list
entry without a visible marker also uses a fade. Reduced motion uses a cut or the
user's short fade once coverage is ready.

The CPU sphere reference includes concurrent camera rotation but does **not** test
this depth-mask overlay, terrain composite, timing, pointer feel or phone readability.
Those are stage 1 visual/usability checks. No user camera translation or claim of
photographic parallax accompanies expansion. The flight into and out of an orb,
which the user asked for later, does move the camera; it still claims no
parallax: see **Flying in and out** under stage 1 as built.

Preparation applies EXIF orientation once and normalizes to opaque sRGB. Decode
samples to linear light, composite/crossfade in linear light, then perform exactly
one output conversion. Panoramas are unlit and independent of globe lighting or
exposure. Direct, mesh, cache and immersion paths share the same treatment; test
RGBA8 sRGB cache storage explicitly. Build cross-face cube mips; wrap equirectangular
longitude and filter poles deliberately. Native seamless cube sampling cannot
repair misoriented faces or bad mips.

Keep old usable LOD until its replacement is complete. Crossfade only if both fit
source and overlap caps; otherwise retain lower detail or use a documented atomic
replacement. Freeze LOD on the exact handoff frame. Photographic similarity does
not replace cardinal/text and angular-ray checks.

## 4. Asset delivery, binding and residency

**Proposed baseline:** flat 90-degree windows, analytic quads, rendered-output cache
off, and uncompressed RGBA8 cube textures prepared from JPEG/PNG preview faces.
Source compression in JPEG is distinct from GPU texture compression. An offline
preparation command validates input/pose/color, produces the cube convention above,
emits declared dimensions and byte counts, and makes preview and whole immersion
variants from one normalized image. It records tool version/options/source identity.
Do not download a full-size original to prepare an overview preview in the browser.
The first working scene includes genuinely different images, not duplicate textures.
Proposed CLI shape (to implement in stage 1):

```sh
node scripts/prepare-panorama.mjs --input garden.jpg --pose garden-pose.json \
  --preview-face-sizes 64,128,256 --immersion-widths 2048,4096 \
  --out build/prepared-scenes/garden
```

Dimensions and output encoding are explicit tool options; omitted output paths
use a new dated directory under `build/`. Emit faces, variants and a manifest
fragment, and require an explicit choice before replacing existing output.
This preparation command is not available in the current repository yet.


Load metadata first, then eligible previews under budget; retain a named loading or
failure state in the list. Queue selected/visible work ahead of optional background
work. Enter using a resident representation, keep it until the replacement is fully
uploaded, and refine without changing view rays. A lower-resolution representation
can serve immersion with a visible source/budget limitation. No partially uploaded
cube, blank frame or unannounced panorama change counts as a ready replacement.

For RGBA8, exact GPU source bytes are `4×sum(W_l×H_l)` over allocated mip levels;
multiply by six for a cube face chain. The familiar `4/3` multiplier is approximate.
Admission separately reserves encoded bodies, decoded pixels, uploads and old/new
transition overlap. Check dimensions against actual `device.limits` before decode or
allocation. Choose the smallest whole variant meeting the requested density that
fits every reservation; otherwise deliver a lower variant and expose the limiting
budget. Center-density formulas are heuristics, not conservative whole-image bounds.

These are **provisional development defaults**, selected to exercise bounded paths,
not measured safe totals for a phone. Their controls/readings belong in §6. The
first three are derived from the renderer's texture limit W (8192 px until it
reports one) since 2026-09-27, so the default loads the largest image a scene
offers that the renderer can hold:

| Independent allowance | Initial value | Purpose |
| --- | ---: | --- |
| Source GPU textures, including mips | 128 MiB of previews + two W × W/2 images: 470 MiB at 8192 px | Previews plus active/transition images |
| Transition overlap, a subset of source/cache GPU bytes | one W × W/2 image: 171 MiB at 8192 px | Cap extra incoming/outgoing coexistence |
| Decoded images plus CPU staging | one W × W/2 image + 16 MiB: 144 MiB at 8192 px | Reserve simultaneous application-owned copies |
| Retained/in-flight encoded response bodies | 32 MiB | Bound downloaded bytes waiting for decode |
| One encoded HTTP response | 16 MiB | Stop an oversized response while reading |
| Concurrent requests / decodes | 4 / 1 | Bound independent loading work |
| Upload bytes submitted per rendered frame | 4 MiB | Spread upload work across frames |
| Upload bytes submitted but not completed | 16 MiB | Bound outstanding staging reservations |
| Rendered output cache | 32 MiB; disabled initially | Independent optional view-cache memory |
| Linked-destination prefetch | 0 destinations / 0 MiB | No speculative immersion transfer by default |

For scale, 43 mipmapped 128² preview cubes need approximately 21.5 MiB. A 4096×2048
whole image needs about 42.67 MiB with mips; 6144×3072 needs 96 MiB. The first
defaults, 128 MiB of source memory, 48 MiB of overlap and 64 MiB of decoded
images, refused the latter: its decoded 72 MiB exceeded decoded64. On a screen of
two device pixels per CSS pixel they refused far less as well: 60 orbs take
256 px preview cubes, 2 MiB each, and their 120 MiB left 8 MiB, not enough for
even a 2048×1024 image (10.67 MiB), so the campus tour stayed on its previews. Reservation
checks, not filename dimensions or an unexplained “8K” cutoff, determine admission.
If overlap cannot fit, switch using a resident preview, release the outgoing source,
then refine; reduced motion may cut between ready representations. Never exceed the
budget to preserve an animation. Chunk row/face uploads so an image larger than the
per-frame allowance neither starves nor bypasses it. Browser/driver transient memory
is not fully observable; readings identify these as logical application allocations.

Whole variants are sufficient while requested useful detail, decode/upload peak and
delivery bytes fit these choices. Tiled immersion is a later required capability
when that detail cannot fit a whole variant or whole transfer misses the selected
delivery target. Its own versioned representation must specify tile dimensions,
levels, borders, mip policy and URL addressing. It must reserve coarse fallback,
visible fine tiles, bounded look-ahead and old/new overlap; rotation may reveal coarse
detail temporarily, never holes. Missing tiling initially means a reported detail
limit, not an attempt to load an oversized original. Compression is a separate stage
with loader, enabled-device-format, quality, fallback and recovery tests.

A first benchmark of what that representation could be, on a desktop only, is the
[spherical image representation report](../../benchmarks/spherical-image-representation/REPORT.md)
(2026-10-02): eleven spherical grids and the ways of refining them, on six of the UMN
tour's panoramas. Sending the tiles under the view first reached within 1 dB of the final
view with 2.0 to 3.8 times fewer bytes than sending whole levels, on every grid; the
equi-angular cube needed about 20% fewer JPEG bytes than equirectangular for the same
view quality. It chooses no representation, measured nothing on a phone, and names the
trial on phones that should come before one is chosen.

The [progressive 360° prototype](../../benchmarks/eac-progressive-prototype/REPORT.md)
(2026-10-02, Phase 2) built that tiling end to end on the same desktop: equi-angular cube
faces of 1536 texels in 192-texel JPEG tiles with a one-texel gutter, a one-image bootstrap,
exact view selection, bounded caches and one draw on WebGL 1, WebGL 2 and WebGPU. Fetching
the level the view needs directly beat visiting every level and residual refinement; over
real HTTP/2 at 2 Mbit/s a forward view was sharp after 1.3 s, where the current path showed
its preview for the whole 10-second trace. It supports that design on a desktop only;
nothing has run on a phone, which is the experiment it names next.

**Built (2026-10-03).** After the prototype's published package was tried by hand and
reported working (the device and the results were not recorded), tiled immersion went into production as the format's `tiled-cube` representation
([format](../scenes/format.md#tiled-cubes)), in both warps: equi-angular, the default, and
gnomonic, an ordinary cube map in the same tiles. The person chooses between them and the
whole image with 360 image settings → Image → **Representation**. What changed from the
prototype:

- **The orb's preview cube is the bootstrap.** It is on the GPU already when the panorama is
  entered, so no separate bootstrap image is fetched; a cell with no tile shows it.
- **Tiles fade in** over `scene.panorama.fadeDuration` instead of snapping: the display table
  keeps each cell's previous tile beside its new one, and the shader mixes them in linear
  light.
- **Only direct replacement**, the policy the report recommends: no residual tiles, no
  insurance. A tiled cube is cached like any source, so a panorama entered again shows its
  tiles at once.
- **Tiles are decoded by the browser and copied from the bitmap into the atlas**, with
  nothing read back to JavaScript, under the same colour contract as whole images (sRGB
  texture on WebGPU, decoded in the shader on WebGL).
- **Preparation is `prepare-panorama.mjs --tiles`**, with the repository's JPEG encoder
  (jpeg-js: 4:4:4, standard Huffman tables) at the tour's quality 80. On the three
  photographs the prototype measured, its tiles are 22% (Northrop Mall), 28% (Superblock)
  and 35 to 37% (the bookstore) larger than the prototype's libjpeg-turbo 4:2:0 tiles with
  optimized tables at the same quality, so a view takes about that much longer to sharpen
  than the report's times. Encoding tiles 4:2:0 with optimized tables is the first thing to
  win back.
- **Its parameters** (Scenes → Tiled images) are the prototype's measured values: six
  requests, two uploads a frame, a 5° margin. Its 196 tiles of atlas became 510 where the
  device has room; see "Loading once" and "What stays on the GPU" below.

`src/scenes/tiles/` holds the geometry, the exact selection, the scheduler and the tiled
source; `src/engine/babylon/panorama/panoramaTileAtlas.ts` the atlas. The whole app was
checked headlessly on this machine's GPU with
[scripts/validation/panorama-tiles.mjs](../../scripts/validation/panorama-tiles.mjs): both
warps and the whole image, four views each, on WebGPU, WebGL 2 and WebGL 1, against the
source image, with a seam score on tile edges, every crossfade and the flight out; and on the
UMN tour's own build, entering Northrop Mall, against its 6144 px image: 27 to 35 dB on every
renderer, tile edges within 1.3 dB of the whole image's on the same pixels. It found
two defects the prototype's own page could not have: a shader parameter named `layout`,
reserved in WGSL as in GLSL ES 3.00, and WebGL's default anisotropic filtering gathering
texels from neighbouring atlas slots along tile edges. The production version has not yet
been tried on a phone.

**Deployed in the UMN tour (2026-10-03).** Every photograph offers both warps, 1536-texel
faces in 192-texel tiles, beside its whole images. On the live site, headlessly from a
desktop's connection at a phone's viewport, Northrop Mall's view was covered by its tiles in
0.5 to 1.1 s on WebGPU, WebGL 2 and WebGL 1. A scene that lists tiled cubes is refused by a
loader from before them, which validated every projection strictly; the loader now skips a
projection it does not know, so a later kind of image needs no ordering of releases.

**Deployed on FOSS Earth's own site (2026-10-03).** <https://foss-earth.github.io/?scene=umn-tiles>
opens the tiled test image. On the live site, headlessly at a phone's viewport, its view was
covered by 6 to 8 tiles in 0.5 to 0.7 s on WebGPU, WebGL 2 and WebGL 1, with either warp, for 23
to 46 KiB; the whole image took 0.7 to 0.8 s and 227 KiB. It is a small generated image on a
desktop's connection, so this shows that the deployed path works, not how fast a photograph is.

**Loading once (2026-10-03).** Use of the deployed tour showed three things the tiles had
not fixed: looking away from part of a 360 image and back loaded it again; every reload
downloaded the orbs' previews again; and the map loaded far more than it showed. Measured on
the live tour in headless Chrome, a laptop's window (1512 × 900 CSS px at 2 device pixels),
this machine's connection:

| Visit | Image requests | On the wire | Every orb's first preview | Last image |
| --- | ---: | ---: | ---: | ---: |
| First, four runs | 720 | 6.4 MiB | 6.4 to 19.2 s | 20.6 to 50.0 s |
| Reload within ten minutes | 720, all from the browser's cache | 0 | 2.0 s | 2.0 s |
| Revisit after 11 minutes | 720: 306 downloaded again, 414 revalidated | 2.8 MiB | 12.4 s | 21.0 s |

- **The map asked for every orb's largest preview.** Each of the 60 orbs loaded its 64 px
  cube and then its 256 px cube, the preview for the largest an orb may be drawn, four
  requests at a time, whether or not the orb was on screen or larger than 24 px.
- **GitHub Pages lets a file go stale after ten minutes** (`Cache-Control: max-age=600`), and
  then each one is asked for again. Its answer was the whole file for 306 of the 720, not
  "unchanged", and the same for the app's own files: 1.55 of 1.72 MiB of them came again.
- **The atlas held 196 tiles**, the prototype's phone-sized setting, and a laptop's view needs
  80 at the finest level. After a turn right round, 60 of the first view's tiles had given
  up their slots, and looking back fetched, decoded and uploaded them again in 0.7 s.

What was built for it, all in `src/scenes/`:

- **Saved images** ([format.md](../scenes/format.md#saved-images), `mediaStore.ts`). Every
  preview, whole image and tile is kept in IndexedDB under its asset's revision and read from
  there before the network is asked. Scenes → Saved images holds the limit, what is kept and
  the clear button.
- **An atlas with a slot for every tile**, up to the tile memory, whose default holds all 510
  tiles of a prepared cube (73.25 MiB, about what the 6144 px whole image takes) where the
  device has room for them. Within such a panorama nothing is evicted, so nothing is loaded
  twice; on a device with less, see "What stays on the GPU" below.
- **Orbs load what they are drawn at.** An orb keeps its smallest preview until it is drawn,
  on screen, with more pixels than that has texels; then it loads the preview its size asks
  for, the largest orb first. Entering asks for the largest as the entry begins.
- **One sheet for every orb's first preview** ([format.md](../scenes/format.md#preview-sheets)).
  A scene may put its orbs' 64 px cubes into one image; the loader cuts each cube's six
  faces out of it. The tour's is 445 KiB for 60 cubes, against 659 KiB in 360 files, and one
  request. Each cube keeps its own files, which load if the sheet fails or is turned off.
  [scripts/validation/preview-sheet.mjs](../../scripts/validation/preview-sheet.mjs) drew
  an orb from a sheet and from its files on WebGPU, WebGL 2 and WebGL 1: 50.6 to 51.0 dB
  apart from every side, where the next view was 11.8 to 28.6 dB away.
- **Sixteen image requests at once**, from four. With 16 the live tour's 360 first-preview
  files arrived in 2.9 and 3.1 s; with 8 in 9.0 s; with 4 in 6.4 to 19.2 s. They are 2 KB
  files that wait on round trips, not bandwidth. The same test on tiles showed little (1.2,
  0.9 and 1.3 s a view at 16 against 1.6, 1.2 and 1.3 s at 6), so tiles stay at six.
- **Tiles load during the flight in.** The view a panorama opens on is known when the flight
  begins, so its tiles load into the panorama's own atlas over that second. On the tiled
  example, with responses held 100 ms, the view was complete 1.3 s after the click, as the
  flight and levelling end, where it had taken 1.6 s.

On the tour's build, served to headless Chrome with every response held 100 ms and no HTTP
cache, by [scripts/validation/scene-revisit.mjs](../../scripts/validation/scene-revisit.mjs):

| Visit | Image requests | Bytes | Every orb's first preview | Last image |
| --- | ---: | ---: | ---: | ---: |
| First, before | 720 | 6.2 MiB | 10.5 to 10.8 s | 19.8 to 20.2 s |
| First, orbs loading what they are drawn at, 16 at once | 360 | 0.66 MiB | 4.0 s | 3.9 s |
| First, with the sheet | 1 | 0.43 MiB | 1.5 s | 1.3 s |
| Reload | 0 | 0 | 1.2 s | – |
| Revisit in a new browser | 0 | 0 | 1.3 s | – |

About 1.2 s of each is the app starting: with the sheet, the orbs are there when the app is. Inside Northrop Mall, four views a quarter turn apart
asked for 98, 64, 64 and 36 tiles and held 256 of the atlas's 510; the first view again asked
for nothing and loaded nothing. On the revisit all five views asked the network for nothing
and were complete in 0.5 to 0.75 s from the saved images. The same check with the limit at 0
fails, as it should: every reload and revisit asks again.

What it does not cover: the orbs' fly-in could not be timed on the tour's build, since the
harness serves no map and the tour's orbs stand on its ground; nothing here has run on a
phone; and the app's own files were still downloaded again after ten minutes on GitHub Pages,
1.5 MiB a visit, until a service worker kept them (below).

**What stays on the GPU (2026-10-03).** On a device with little graphics memory the GPU should
hold what is looked at, and the disk the rest. Every part of that is a setting, with a default
from what the browser says of the device:

- **Tile memory** (Scenes → Tiled images) holds every tile of a panorama where 1/32 of the
  device's memory, as the browser reports it, holds them: as the map's imagery takes for its
  own budget. Below that it is that share, and never less than the prototype's 196 tiles, a
  phone's view and its margin. A browser that does not report its memory gets every tile,
  unless it is a touch screen's, which is most often a phone's. Tiles out of the view then
  give up their slots, and a look back reads them from the saved images.
- **Kept on the GPU when not shown** (Scenes → Loading and memory) is what images nobody shows
  may keep, the least recently used given up first: the tiles of the panorama left, a preview
  an orb no longer shows. Its default keeps the panorama left where the tile memory holds
  every tile, and nothing otherwise. Before it, such images stayed until their room was
  needed, which on a renderer with 16384 px textures could be 1.5 GiB.
- **Sharper orb previews kept for** (Scenes → Orbs): an orb drawn smaller again, or off the
  screen, goes back to the preview its size needs after 10 s, and gives the sharper one up.

On the tour's build with responses held 100 ms, with the tile memory at 196 tiles and nothing
kept, Northrop Mall's four views held 82 to 86 tiles each. Turning back to the first asked the
network for nothing: its tiles came back from the saved images, and the view was complete in
0.9 s. On a revisit, every view asked for nothing and was complete in 0.8 to 0.9 s
([scripts/validation/scene-revisit.mjs](../../scripts/validation/scene-revisit.mjs) with
`--set=scene.panorama.tileMemoryMiB=28.25,scene.panorama.keptGpuMiB=0`).

**The app's own files (2026-10-03).** A service worker keeps them on the device, so a visit
asks the network for none of them however long ago the last one was
([docs/app-files.md](../app-files.md)). On the tour's build in headless Chrome, its first visit
kept all 63 files it loaded, and the reload and a revisit in a new browser asked for none.

Bind each baseline orb's own cube texture/material in a per-orb draw; group only
orbs that actually share compatible resources. Thin instances alone cannot choose
arbitrary independent textures. Later cube arrays need six layers per panorama:
the default 256-layer limit admits 42 cubes, not 43. Group arrays by face resolution,
format and mip count, allocate inside the same budgets, and use revision/generation
handles for slots. Eviction must wait for draws/uploads using a slot before reuse;
reuse and device loss invalidate dependent bindings and cached views. These are
future implementation obligations, not promised current batching. Read actual limits;
request a larger supported limit only when needed. Resolution/format groups can
span several arrays/draws. Allocate complete mip chains, charge unused slots as
allocated storage, and free arrays at array granularity unless compaction itself
fits overlap caps.
[WebGPU limits](https://gpuweb.github.io/gpuweb/#limits),
[cube views](https://www.w3.org/TR/webgpu/#dom-gputextureviewdimension-cube).

Pin resources while sampled by submitted work and across active transitions;
evict unpinned least-recently-used sources first. Reference counts share assets
among instances. Priority is current complete coverage, selected destination's
usable preview, visible markers, active refinement, then enabled prefetch. Source
GPU, CPU staging, encoded data, outstanding uploads and output-cache reservations
are separate even when one operation consumes several. Overlap is a subset cap,
not permission to add memory above ordinary totals. Show combined globe/panorama
estimates without silently borrowing the map budget; VRAM usage is an estimate.

Stream-count unknown response lengths and abort at the response/encoded caps.
Enforce request timeout; retry is manual in v1. Decodes require header-verified
pixel reservations including app-owned simultaneous copies; opaque decoder/driver
extra allocations remain an explicit measurement limitation. Bound uploads by
bytes/frame and outstanding submitted bytes; release staging only after completion.
Close decoded images once their last upload finishes. Keeping them for recovery
still consumes the decoded cap; recovery may instead refetch from descriptors.
Prefetch must satisfy both neighbor count and cumulative encoded-byte allowances
per active destination, as well as every ordinary pool cap. Never load all full
images because their markers are visible. Lowering a budget cancels queued work,
evicts unpinned data and reduces active detail to a fitting preview; if even that
cannot fit, report unavailable and release it. Do not evade the cap because all
resources are pinned. Dispose and every error path release reservations once.

Output caching begins with one current output per visible orb, disabled by default
for simplicity. One texture instruction is not a proof about physical reads, timing
or whether caching can help. Cache identity includes asset/device generation,
source representation/mip level, image pose, appearance/blend parameters, relative
camera/marker pose and distance, FOV/projection, viewport/render scale, output size
and color treatment. Baseline reuse requires an unchanged key. Any change refreshes
within the texels/frame allowance or falls back to direct shading; never show stale
content while waiting. A cache too small for matched output also uses direct
rendering. Charge targets, allocated mips and auxiliary/depth buffers to cache
memory. Disabling caching releases them. Approximate reprojection is deferred until
a conservative output-error criterion exists and has its own visible pixel-error
control; average angular density is not that criterion. Static direct and cached
views both return to scheduler idle. Scene replacement, slot reuse and device loss
invalidate dependent results before publication.

## 5. Navigation and runtime integration

Everything in this section is a proposed API or behavior unless identified as an
existing seam. It does not claim that camera ownership, panorama history or
terrain suspension already exists.

### One cancellable owner

Add a generic runtime navigation lease, exported through `foss-earth/runtime`:

```ts
interface NavigationLease {
  readonly signal: AbortSignal;
  readonly overview: NavigationSnapshot;
  setPresentationView(view: NavigationPresentation): void;
  requestRender(): void;
  holdRendering(): () => void;
  release(reason: NavigationEndReason): void;
}
acquireNavigation(request: NavigationRequest):
  | { ok: true; lease: NavigationLease }
  | { ok: false; reason: "busy" | "disposed" | "aborted" };
```

These names are proposed signatures, to be finalized with the runtime tests.
`NavigationRequest` identifies the owner and input context, accepts an external
`AbortSignal`, and declares the terrain-selection policy. At most one lease owns
navigation. Acquisition while another owner (including a flight host) holds navigation returns
a typed busy result unless that owner explicitly yields. Within one owner, a new
transition cancels the previous transition generation. Lease release and each
returned rendering-release function are idempotent. A lease
cannot replace the active camera or request work after release. A monotonically
increasing generation identifies every acquisition and scene replacement.
`NavigationPresentation` describes orientation, position and projection; a runtime
renderer adapter owns the camera object. Applications do not construct a private
Babylon camera to obtain generic navigation ownership.

Capture `NavigationSnapshot` before entry changes the view: the globe view,
actual ECEF orbit target and height policy, camera orientation, FOV/projection and
clipping state if changed, tracking target identity, orbit/input context, selected
focus identity, and the element to regain keyboard focus. A plain `GlobeViewState`
is insufficient: it omits target height and FOV, and restoring it currently
recomputes the target height. Store values and stable identities, not a Babylon
camera pointer as the only restoration record. A removed tracking target restores
free orbit at the saved target. An unavailable DOM target restores the scene list.

The original overview snapshot is immutable for the immersion session. Visiting
B from A replaces the active panorama, not that snapshot. Exit from B returns to
the overview from which A was entered. Return geometry may have refined while
away; retain the saved pose, apply only required safe camera constraints, and
report any resulting adjustment. Do not silently frame B on Exit.

The flight out of an orb, which the user asked for, is the exception, and says
so: with `flightDuration` on, Exit backs out of the orb on screen facing the way
the view faces, and ends looking at that orb with the snapshot's pitch, distance
and field of view. A flight cut short, in or out, is the other exception: the
globe camera takes over where the flight got to, still moving, rather than
jumping back to the snapshot or on to the flight's end ("Cut short" under
Flying in and out). Device loss still restores the snapshot, and with the flight
off, cancellation and Exit restore it as above.

The lease suspends the globe's input handlers and POI tracking, ends anchor drags
and pointer capture, and cancels all inertial velocities. New panorama handlers
use a shared router. Pointer/touch look, wheel/pinch FOV, keyboard look/zoom,
destination activation and Exit reach the active context exactly once. Text
fields and binding capture retain input ownership. Escape cancels entry or exits
immersion; named scene-list/link buttons provide equivalent keyboard operation.
Touch tap must not activate after a drag, pinch, cancellation or second contact.

Keep the existing browser input source and `BindingRuntime`. Add panorama action
descriptors and bindings in FOSS Earth's adapter; route its `getContext` through
the lease. Preserve gamepad-tools' binding capture, selected device and deadzone
behavior. Controller handling remains gamepad-tools' responsibility. Do not add
a second poller or map panorama look to globe pan behind the immersive camera.
Look inertia, if enabled, belongs to this context and is cancelled on every transfer;
so is a wheel gesture's momentum, which the system sends as wheel events: whoever
takes input ignores a wheel gesture already under way, to its end, except one the
person began to take the camera over from a flight.
Dragging the image right looks left; dragging it down looks up. Wheel-up/pinch-out
narrows vertical FOV. Wheel events are read as the globe reads them, by `input.mode`
and the globe's own gesture classifier: in trackpad mode a two-finger swipe moves
the image as a drag does and a pinch zooms; in mouse mode the wheel zooms. Arrow keys and gamepad look turn in the named direction;
translation is disabled. Enter/Space activates focused destinations, Tab navigates
DOM controls, and Escape cancels preparation/entry or exits. Pointer look during
expansion cancels the expansion to its prior usable state; during arrival leveling
it cancels leveling and starts looking. Inertia has an exposed exponential half-life.

While it holds the lease, the owner may also move the globe camera itself:
`placeNavigationCamera(lease, view)` puts its eye at a presentation's position
and orientation, roll included, nearer than the zoom limit, at any pitch and
through the ground, as a flight into an orb needs. The camera's limits and
collisions return when a snapshot is restored or the lease ends. To give it
back still moving, `glideNavigationCamera(lease, view, pivot, motion)` holds
that eye and look as the globe camera's own orbit and starts its glide with
the motion, before the owner releases the lease; `getCameraHandling()` says
the limits and glide the globe camera keeps to.

Entry, exit and animated arrival acquire a rendering hold and release it in a
`finally` path. Asset completion and settings changes request a frame. Still
panoramas and previews return to the existing scheduler's idle state. No second
permanent render loop is introduced. Do not use flight `simMode`, `setSimTick` or
`setSimViewState` as panorama APIs; their camera, lighting and world-root effects
are a different contract.

### Pose and arrival policy

Keep capture position, displayed marker center, clipping axis and panorama image
orientation separate. Convert each asset's declared source frame once to the
manifest's canonical image frame, then apply its image-pose rotation into local
geographic ENU and ECEF. That conversion includes cube-face orientation and
equirectangular seam/pole conventions; it is not an undocumented shader flip.
Image pose corrects the source; an initial view chooses where the viewer looks.

Recommended development default: `level-current`. Entry carries the actual
preview ray field through the exact coverage-and-ray-equality handoff. Only after
that handoff does a distinct arrival motion keep the current geographic heading
and level pitch and roll to zero. Thus leveling is a deliberate camera rotation,
not a claim that two differently oriented frames match. At a vertical look,
preserve the last defined transported heading instead of deriving it from a
zero-length horizontal vector. Concurrent user look updates the current pose;
user input cancels the optional arrival motion without cancelling immersion.
Incoming globe pitch/FOV can exceed the panorama's allowed look range. Preserve
that projection through handoff; apply and display the panorama range limitation
during the subsequent arrival motion (or reduced-motion cut), never by silently
clamping the incoming handoff frame.

Provide an authored-arrival choice using the destination's initial view. An
explicit link arrival or deep-link view overrides that choice for that arrival;
otherwise the first entry uses the selected entry policy and linked navigation
preserves geographic azimuth/pitch/FOV. Do not level again on every link. Express linked heading in the destination's
ENU frame, not as an unchanged quaternion in the previous site's local frame.
Direct URLs with no prior overview use the manifest's validated overview as their
return snapshot, or a documented runtime default when the manifest omits it.
Reduced motion skips travel/arrival animation and applies the selected final view
as an explicit cut. Neither leveling nor an authored arrival proves seamlessness.

### Scene and asynchronous lifecycle

```text
overview → preparing → entering → immersive → exiting → overview
              ↓           ↓
            cancel → prior usable view
immersive → preparing destination → entering destination → immersive
```

Preparation keeps the prior view usable. Entering acquires transition ownership
only after minimum coverage is ready; each failed/cancelled destination retains
the previous panorama, and disposal can terminate every state.

`loadScene(runtime, input, { baseUrl, signal })` validates a complete candidate and
returns a disposable scene handle with status subscriptions and explicit
readiness. `SceneHandle` exposes `enter(instanceId, {signal?, view?})`,
`follow(linkId)`, `exit()`, `replace(input, {baseUrl?, signal?})`, `subscribe(listener)` and
idempotent `dispose()`. Calls after disposal return a typed disposed error.
`validateScene(input, {baseUrl?})` is pure and allocates no GPU resources.
The handle owns activation registrations, fetches, decoded images,
GPU resources and frame subscriptions. Minimum usable coverage, not full source
resolution, gates entry. Entry failure retains the current overview or working panorama.
Programmatic replacement inherits the current base unless `baseUrl` is provided;
URL replacement uses its own final response URL. Pure JSON validation requires
a known base for relative URLs.

Replacing a scene first validates its candidate, then atomically changes scene
ownership and aborts the old generation. Abort every cancellable operation; every
uncancellable decode/upload completion checks scene, asset and lease generation
before publishing. Obsolete images close and allocations release. Disposal is
idempotent and releases links, observers, GPU/cache bindings and render holds.
Removing the active scene aborts navigation and restores a valid overview.

Map-source changes may proceed while immersed, but cannot assign the geospatial
camera over the lease or start hidden refinement. Invalidate surface-relative
marker placements against the new source/revision. On exit, resolve them against
the displayed source without rewriting authored capture coordinates.

### Terrain while immersed

Default: pause terrain selection and new request admission for both raster and
Google maps. Existing admitted requests may finish only within their reservations;
completion cannot trigger a refinement/request chain while paused. Cancel queued
unadmitted work. Existing budgets still govern return-view residency and eviction;
the panorama session does not promise to pin the whole overview indefinitely.
Disable hidden globe drawing separately from suspending selection. On exit,
restore the overview selection view, resume admission and request a frame.

This needs a real suspension seam in both adapters: raster selection and imagery
read `scene.activeCamera`, as does Google's visibility/error calculation. A local
panorama camera must never become either map's geographic selection view. The
deprecated raster `getViewState` option and `setSimViewState` cannot solve this.
An optional user-selected continue-at-overview policy is later work: inject a
detached saved camera/view, projection, viewport and focus into both selectors.
Never temporarily swap `scene.activeCamera` around unrelated callbacks.

### Browser history and recovery

Use a host-cooperative adapter that merges a `fossEarthScene` namespace into
`history.state` and preserves unrelated URL parameters and state. On the first
entry, `replaceState` records the current overview; push only once entry completes
and commits navigation, not when its minimum source merely becomes ready. Each
committed link pushes a destination entry. Failed
or cancelled loads push nothing. Look/FOV changes replace the current entry after
the gesture settles; they do not create one entry per frame.

Back/Forward restores the recorded destination and view through the same
cancellable path; it never pushes another entry. An overview entry restores that
session's original snapshot. Explicit Exit restores the original snapshot and
pushes an overview entry, so browser Back intentionally reopens the destination
just left. This simple policy avoids guessing history depth or jumping across
host-owned entries. Namespaced state carries schema version, scene/revision,
destination, view and session identity; URLs carry only shareable scene identity
and view, never credentials or arbitrary local filesystem paths.
Only serializable snapshot fields and stable focus IDs enter history.state; DOM
elements, camera objects and AbortSignals stay in the live lease.
The host resolves shareable scene IDs through a registered scene resolver, not
arbitrary URL fetches. Missing/revised history destinations produce an unavailable
notice and the last valid overview, without a push/reload loop; restoring an old
revision requires that exact revision to remain available. With no history adapter,
navigation has the same in-memory stack without mutating host history.

On device loss, abort the lease and every resource generation, cancel animation
and inertia, release rendering holds, and restore navigation ownership. Preserve
only CPU descriptors and history intent that budgets allow; invalidate source GPU
bindings, output caches and slot generations. After actual WebGPU recovery,
rebuild minimum coverage before allowing re-entry. If recovery fails, retain the
overview shell with an unavailable explanation. Do not silently run the feature
on the runtime's WebGL fallback. Teardown removes loss/recovery subscriptions.

### Existing seams and required changes

| Existing owning surface | Required integration |
| --- | --- |
| [`BabylonRuntime`](../../src/engine/babylon/createBabylonRuntime.ts), [`CameraController`](../../src/camera/cameraState.ts) | Generic lease, full snapshot, map transitions respecting active ownership; preserve simulation behavior. |
| [`input controller`](../../src/input/createInputController.ts), [`globe adapter`](../../src/input/globeNavigation.ts), [`app wiring`](../../src/app/createGlobeApp.ts) | Cancellable routing and shared keyboard/gamepad context; existing controller exposes settings and destroy, not suspension. |
| [`layer registry`](../../src/layers/layerRegistry.ts), [`POI tracking`](../../src/layers/poiTracking.ts) | Async scene lifecycle and dynamic activation registrations; do not equate mouse-only camera tracking with panorama entry. |
| [`raster runtime`](../../src/engine/babylon/createRasterTilesRuntime.ts), [`imagery view`](../../src/engine/babylon/imagery/imageryView.ts), [`Google runtime`](../../src/engine/babylon/createTilesRuntime.ts) | Real selection/admission suspension; optional detached overview selection requires both adapters. |
| [`render scheduler`](../../src/engine/babylon/renderScheduler.ts), [`renderer selection`](../../src/engine/babylon/createRendererMode.ts) | Balanced holds, actual-backend capability gate and device-loss lifecycle. |
| [`imagery residency`](../../src/engine/babylon/imagery/imageryResidency.ts), [`imagery restoration`](../../src/engine/babylon/imagery/createImageryRuntime.ts) | Reuse reservation/pinning/generation patterns; map page atlas is not a panorama store or its color contract. |
| [`settings registry`](../../src/settings/registry.ts), [`shell exports`](../../src/shell/index.ts), [`WindowOverlay`](../../src/shell/WindowOverlay.tsx) | Registry homes/readings and a Scenes tab via existing shell composition; toolbar toggles that tab. |
| [`package exports`](../../package.json), [`runtime exports`](../../src/runtime/index.ts) | Public scene and panorama surfaces; consumers never deep-import these implementation seams. |

### Shared frame-budget instrumentation

Inspection of current code establishes that the timing engine is **already in
FOSS Earth**: [`frameProfiler.ts`](../../src/perf/frameProfiler.ts) exports
`createFrameProfiler`, `profileBabylonScene` and `canTimeGpuFrames` through
[`foss-earth/perf`](../../src/perf/index.ts). 0sfs imports those functions. The
standalone globe's Renderer → Performance debug currently configures HUD readings
and tuners; it does not yet expose this section-by-section frame-budget panel.

The remaining generic presentation lives in 0sfs:
[`FrameBudgetPanel.tsx`](../../../0sfs/src/flight/hud/FrameBudgetPanel.tsx),
[`frameBudget.css`](../../../0sfs/src/flight/hud/frameBudget.css), and the profiling
attachment/control wiring in
[`createFlightSimApp.ts`](../../../0sfs/src/flight/createFlightSimApp.ts).
Extract the generic display and session control into FOSS Earth before the campus
acceptance run, export them through `/shell` and `/perf`, and accept an explicit
profile handle instead of copying the flight module's global singleton. Give the
globe one instance in Renderer → Performance debug. Keep 0sfs's existing
Debug → Frame budget location through a thin wrapper consuming the shared component;
each application mounts one control home, with host-specific explanatory text and
styling adapters. Do not require users to learn a new 0sfs debugging workflow.

Preserve 0sfs functionality while doing this:

- Keep flight/physics/input/instrument spans and flight-specific capture in 0sfs.
  Its `flightPerf=1`, `window.osfsFrameProfiler`, `window.osfsFrameProfile`, existing
  summary keys, enable/reset behavior and Copy frame budget remain compatible.
  [`profile-flight.mjs`](../../../0sfs/scripts/profile-flight.mjs) is an existing
  consumer of those interfaces; leave it working.
- Own one profiler, one frame boundary and one Babylon observer/timer set per
  runtime. If the shared runtime takes over the frame boundary, remove the host's
  duplicate `frame()` call in the same change. Disabling profiling detaches
  observers/timers; enabling starts a fresh window; teardown releases everything.
  Do not add a second render loop or alter flight update order or simulation timing.
- Add explicit CPU spans for map selection/update and panorama direction/parameter
  preparation, decode completion work, upload submission and cache refresh. Label
  background decode wall time separately from main-thread CPU work. Nest related
  spans so parent and child durations are not counted twice. Show source/cache
  bytes alongside timings so an allocation stall is distinguishable from shading.
- Run related profiler, panel and lifecycle checks, then both repositories' CI
  after extraction. Verify 0sfs's Debug toggle/copy, URL opt-in, aliases, flight
  metrics and disabled-mode cleanup through the public exports. This is an
  implementation prerequisite, not a move performed by this proposal edit.

Measurement semantics must remain explicit. The existing profiler reports CPU
JavaScript sections and frame intervals, with mean/p50/p95/max; it does not expose
p99 or a raw per-frame trace today. Add bounded, opt-in trace export in FOSS Earth
when the acceptance harness needs p99 and camera/frame revision correlation.
Babylon's current WebGPU timing path reports timed render-pass work, excluding
copies/mipmap generation. Results arrive late and the current implementation holds
the last reading between updates. Label those summaries accordingly; they cannot
be treated as exact per-frame GPU latency or a separate orb-only GPU measurement.
CPU/GPU run concurrently and are never added together. GPU capability, an actual
valid reading, and hardware-adapter verification are separate statuses. Missing
measurements say unavailable, not zero. Use controlled globe-only versus globe-plus-
orb comparisons initially; add isolated GPU pass timing only when it is actually
supported and does not change the measured rendering path.

## 6. Settings and UI

Use the existing registry, provenance, preset and parameter-section controls.
Three tabs hold them (as built, 2026-09-27; [UI layout](../ui-layout.md#a-panoramas-tabs)).
The Scenes tab holds what the globe shows and what both sides share: Content,
Orbs, Motion, Loading and memory, Credits, and Cache when it lands. The
panorama's own tab, "360: <title>", holds its image detail. 360 image settings,
shown only inside a panorama, holds Image, Looking and Entering. Every setting
has one home; a toolbar button toggles its tab.
Controller bindings stay in Controls → Controller. Use [paragraph grids](../ui-layout.md),
continuous tracks and one two-thumb track per range. Presets display/copy their
values and become Custom on edits; no code branches on preset names.

All defaults below are **provisional development values**, not measured device
recommendations. Each implemented mechanism must register its controls, source
path, reason and live readings in the same stage. Device/source hard limits narrow
bounds visibly; requested values, effective values and limitations remain distinct.
Counts/dimensions are discrete; continuous budgets and gains are continuous.
No frame-time auto-tuner or hidden quality tiers are proposed.

IDs below have prefix `scene.panorama.` unless fully qualified. CSS pixels and
rendered device pixels are different units. A range means one two-thumb control.

| ID | Unit; bounds | Default and reason | Home; reading / validation |
| --- | --- | --- | --- |
| `implementation` | quad / mesh | quad; simple reference port | Appearance; draws/triangles; stage 3 |
| `appearance` | rectilinear / fisheye | rectilinear; simple identity endpoint | Appearance; active mapping; usability |
| `previewFov` | full deg, 30–150 | 90; reference baseline | Orbs; actual FOV; text checks |
| `fisheyeFov` | full deg, 30–180 | 180; original candidate endpoint | Appearance; rim filtering |
| `fisheyeBlendAngles` | half-angle deg range, 1–previewFov/2, min<max | [20,45]; finish by identity | Appearance; α/λ; validate edits together |
| `sphereSilhouetteError` | rendered px, 0.1–4 | 0.5; subpixel target | Appearance; achieved error/segments |
| `sphereSegments` | count range, 8–256 | [16,128]; bounded mesh search | Appearance; actual rings/segments, cap warning |
| `previewDensity` | texels/rendered px at center, 0.25–4 | 1; understandable heuristic | Orbs; source/limiter, rim checks |
| `previewFaceRange` | px range, 16–min(2048, device limit) | [64,256]; small previews | Orbs; actual face dimensions |
| `markerRadiusMeters` | m, 0.1–100 | 1; fallback for absent authored radius | Orbs; authored/effective radius |
| `markerDiameter` | CSS px range, 4–256 | [24,96]; prototype discoverability | Orbs; effective diameter; portrait trial |
| `hitTargetDiameter` | CSS px, 24–96 | 44; generous separate pointer target | Orbs; overlap/list fallback |
| `declutterSpacing` | CSS px, 0–128 | 12; prototype spacing | Appearance; omitted count; dense fixture |
| `visibleMarkers` | count, 0–2000 | 200; scale-fixture ceiling | Appearance; rendered/eligible counts |
| `immersionDensity` | texels/rendered px, 0.25–4, or Off | Off: the largest image the detail allows (was 1) | 360 image settings → Image; footprint and limited regions |
| `immersionWidth` | px around the turn, 256–device limit | the device limit: the largest image offered (replaced `immersionMaxSide`, a texture-side cap defaulting to min(8192, limit)) | The panorama's tab → Image detail; image on screen and why no larger one |
| `sourceGpuMiB` | MiB, 1–4096 | 128 of previews + two images as wide as the texture limit (was 128 in all) | Loading; source+mip reservations; stress |
| `decodedMiB` | MiB, 1–2048 | one image as wide as the texture limit + 16 (was 64) | Loading; reserved/actual, decoder limitation |
| `encodedMiB` | MiB, 1–512 | 32; bounded response storage | Loading; retained/in-flight bytes |
| `responseMiB` | MiB, 0.25–256, ≤encodedMiB | 16; catch oversized responses | Loading; largest response/rejections |
| `requests` | count, 1–16 | 4; permit previews without fan-out | Loading; active/queued requests |
| `decodes` | count, 1–8 | 1; prevent decode bursts | Loading; active/queued decodes |
| `uploadMiBPerFrame` | MiB/frame, 0.25–64 | 4; bound upload work, not timing | Loading; bytes/frame, measured stalls |
| `uploadOutstandingMiB` | MiB, 0.25–256 | 16; bound submitted pending work | Loading; outstanding bytes/completions |
| `requestTimeout` | s, 1–120 | 30; recover hanging loads | Loading; elapsed/errors; cancellation |
| `overlapMiB` | MiB, 0–4096, ≤source+cache caps | one image as wide as the texture limit (was 48, one 4K replacement) | Loading; extra pinned subset, not extra permission |
| `prefetchCount` | count, 0–8 | 0; no speculative destinations | Loading; requested neighbors |
| `prefetchMiB` | encoded MiB, 0–128 | 0; no speculative transfer | Loading; bytes; both caps required |
| `terrainStreaming` | paused / saved-overview | paused; no hidden immersion requests | Loading; selection view and request count |
| `cacheEnabled` | boolean | false; simplicity, not proven speed | Cache; hits/misses/direct fallback |
| `cacheMiB` | MiB, 0–1024 | 32; bounded enabled experiment | Cache; allocated/used estimates |
| `cacheSizeRange` | output px range, 16–min(2048, device limit) | [32,256]; overview-scale outputs | Cache; output dimensions; quality comparison |
| `cacheRefreshTexels` | texels/frame, 0–16777216 | 262144; four 256² outputs | Cache; texels/time; direct fallback |
| `verticalFovRange` | deg range, 20–120 | [35,90]; prototype look range | 360 image settings → Looking; current/limited FOV |
| `pitchRange` | deg range, −89.9–89.9 | [−85,85]; avoid look-axis degeneracy | 360 image settings → Looking; current pitch; pole-content trial |
| `entryOrientation` | level-current / authored | level-current; preserve azimuth, level pitch | 360 image settings → Entering; target/provenance |
| `flightDuration` | ms, 100–5000, or Off | 1000, on as the user asked; long enough to follow, short enough not to wait on | Scenes → Motion ("Fly into and out of 360 images"); phase; motion trial |
| `expandDuration` | ms, 0–2000 | 350; short reveal prototype, when the camera does not fly in | Scenes → Motion; phase/progress; motion trial |
| `orientDuration` | ms, 0–2000 | 250; separate leveling phase | 360 image settings → Entering; current/target orientation |
| `fadeDuration` | ms, 0–1000 | 150; exit/LOD/fallback blend | Scenes → Motion; overlap/phase; visual check |
| `hoverDuration` | ms, 0–1000 | 120; growth under the pointer, when the scene's style asks | Scenes → Motion; visual check |
| `reducedMotion` | system / reduce | system; respect OS, allow stricter user choice | Scenes → Motion; effective state |
| `reducedFadeDuration` | ms, 0–250 | 0; cut avoids animation | Scenes → Motion; effective duration |
| `dragSensitivity` | deg/CSS px, 0.01–2 | 0.15; starting pointer gain | 360 image settings → Looking; angular response; user trial |
| `swipeSensitivity` | deg/CSS px of scroll, 0.01–2 | 0.15; as dragging, in trackpad mode | 360 image settings → Looking; angular response; user trial |
| `lookRate` | deg/s, 1–360 | 90; key/full gamepad rate | 360 image settings → Looking; actual rate |
| `zoomPerNotch` | log-tangent-FOV fraction/notch, 0.01–1 | 0.1; multiplicative wheel change | 360 image settings → Looking; actual FOV |
| `zoomRate` | log-tangent-FOV fraction/s, 0.01–4 | 0.5; held key/gamepad zoom | 360 image settings → Looking; rate |
| `pinchGain` | ratio, 0.1–4 | 1; inverse finger-separation ratio | 360 image settings → Looking; gain |
| `inertiaHalfLife` | ms, 0–1000 | 100; brief optional continuation, 0 off | 360 image settings → Looking; angular speed; cancellation |
| `scene.manifestMiB` | MiB, 0.1–16 | 2; bounded parse | Content; parsed bytes; oversized fixture |
| `scene.entityLimit` | count, 1–100000 | 2000; bounded discovery data | Content; entity count |
| `scene.assetLimit` | count, 1–100000 | 2000; bound resource descriptors | Content; asset count |
| `scene.linkLimit` | count, 0–1000000 | 10000; bound navigation graph | Content; link count |

Authored radius/offsets are shown as metres in scene details; screen-size clamping
produces an effective radius used consistently for silhouette, depth and picking.
The segment policy uses `Rpx(1−cos(π/n))` as a circle-chord error estimate, checks
both angular mesh directions and reports when the segment cap prevents the target;
it is not a proof of perspective depth equivalence. Blend/FOV edits are validated
atomically; incompatible ranges produce a visible error, not an invisible repair.

Pinch and zoom operate on `tan(verticalFov/2)`; wheel/key changes are exponential,
then clamped to the same FOV range. Existing controller dead zones, wheel
normalization and gesture drag thresholds retain their existing homes. Reduced
motion disables inertial continuation and animated orientation. Tile support must
add `tileResidentCount` (count 1–4096, default 128), `tileLookahead` (deg 0–45,
default 5) and `tileLevelRange` (0–source maximum, default full available range)
in Loading before it lands. These are provisional and bounded additionally by
byte budgets; tile dimensions/borders are representation facts. New automatic
behavior must expose its permitted range and current reason before spending work.

Shared profiling controls are session-only, default off, and have one home per
application as described above. Register `renderer.profiling.enabled` (boolean,
false), `.windowFrames` (count, 1–36000, default 600), `.refreshMs` (ms, 100–5000,
default 500), and `.traceFrames` (count, 0–36000, default 0/off). The 600-frame
window and 500 ms display refresh preserve existing 0sfs defaults; bounded trace
retention is opt-in. Show collected/window frames, retained trace bytes and GPU
availability next to the controls. Test runs explicitly select enough trace
capacity and record it; they do not silently enable permanent recording. Control
groups use paragraph grids; the measured numbers may use a semantic data table.

## 7. Implementation stages and acceptance

### Stage 0: CPU contract (this task)

Retain reproducible ray/image checks for the counterexample, finite monotone blend,
FOV bounds, aspect ratios, off-center views, near-handoff interval, rotation,
marker offsets and inside/surface domains. The [evidence document](../validation/panorama-visual-contract.md)
states exact runs/results and filtering limits. This is design evidence, not
production feature work or hardware qualification.

### Stage 1: one complete neutral path

Depends on the proposed v1/visual contracts. Implement schema/validation, preparation
CLI and multiple genuinely different preview assets; the direct rectilinear quad,
bounded uncompressed loading, generic lease/input routing, minimal Scenes list,
credits/settings and public exports. Complete **previews → enter → look → link →
exit → dispose**. Do not stop at one isolated orb or omit navigation/disposal.
Include the shared profiling extraction and single-image campus gate below in this
stage. The campus scene is the first practical orbit check, then the neutral
multi-image scene proves navigation and resource independence.

Acceptance: distinct cardinal/text and photographic sources obey pose and cube
conventions; invalid versions/references fail before allocation; actual compositor
handoff matches CPU rays and preserves source/color; terrain/depth-mask behavior
works off-center; keyboard/gamepad and reduced motion work; cancellation restores
the prior usable state, Back from B returns to A, and Exit from B restores the
original overview. Minimal history and device-loss lease release land here;
late decodes cannot resurrect
disposed scenes; reservations/listeners/holds return to baseline and static views
idle. Unsupported-backend state remains usable. Build a public consumer fixture and
0sfs without panorama activation, including its existing simulation checks. This
proves the generic lifecycle/integration, not large scenes or phone FPS.

#### Stage 1 as built

**Where the code is.**

| Part | Code |
| --- | --- |
| Format and validation | [`src/scenes/`](../../src/scenes/): `format.ts`, `validateScene.ts` and the JSON Schema, published as `foss-earth/scenes/schema.json`; the reference is [docs/scenes/format.md](../scenes/format.md) |
| Loading and navigation | `loadScene.ts`, with `panoramaResources.ts`, `panoramaInput.ts`, `sceneHistory.ts` and `sceneController.ts` |
| Rendering | [`src/engine/babylon/panorama/`](../../src/engine/babylon/panorama/) |
| Navigation lease, input and terrain suspension | [`navigationLease.ts`](../../src/engine/babylon/navigationLease.ts) and the runtime |
| Scenes tab | [`src/shell/scenesPanel.ts`](../../src/shell/scenesPanel.ts) |
| Frame budget | `createFrameProfileSession` in `foss-earth/perf` and `createFrameBudgetPanel` in `foss-earth/shell`. The globe shows it in Renderer → Performance debug and 0SFS in Debug → Frame budget. |
| Preparation | [`scripts/prepare-panorama.mjs`](../../scripts/prepare-panorama.mjs); the examples come from [`scripts/build-panorama-examples.mjs`](../../scripts/build-panorama-examples.mjs) |

**The campus check.** [`scripts/validation/panorama-campus.mjs`](../../scripts/validation/panorama-campus.mjs)
runs the gate below in headless Chrome, on the machine's own GPU. Its retained run
is in [campus-2026-09-27](../../validation/evidence/panorama-scenes/campus-2026-09-27/README.md).
It measures directions three ways, kept separate:

- **Mapping:** does the shader implement the CPU contract? The CPU window and
  pose are applied to each pixel's GPU ray and compared with the direction the
  GPU sampled. The 0.01° tolerance applies here.
- **Rays:** where did the rasteriser put each pixel's ray, compared with the
  CPU's pixel-centre ray?
- **End to end:** how far is the displayed content from the CPU's? The flat
  window magnifies ray differences by tan β / tan α, which is about 50 for a 2 m
  orb at 100 m. A ray difference of 1/40 of a pixel can therefore become 0.009°
  of content, while still being under 1% of what one pixel shows. The first runs
  compared end to end only, and so came within 11% of the tolerance.

In the retained run, every check of the orb passes: directions, draws, the
negative control, colour and orientation, entering, links, Back and Exit. The
frame intervals do not. With the map at the detail asked for, the globe alone
has p95 66.7 ms and p99 83.4 ms during the trace, against 20 and 33.3 ms. The
orb adds nothing measurable: −0.1 ms at p95 and 0 at p99. The time is in the
map's raster-tile update, 7.4 ms a frame on average and 28 ms at p95. As the
acceptance gate asks, this is reported as the globe's miss, with the orb's
increment. Whether to change the targets, the default map detail or the globe's
tile work is the user's decision.

**Found and fixed by running it.**

- **Stale camera:** the orb's camera frame was cached per engine frame. Code that
  read it before the camera moved in the same frame (the check's own agent did)
  froze the old eye for that frame's draws: the orb then drew one frame late. The
  cache is now keyed to the camera's matrices and the presented view, and the eye
  is read after the view matrix is brought up to date. A regression test covers
  it.
- **Probe clearing:** the probe's render target was not cleared to zero coverage.
- **Exit chip:** the chip's own display rule overrode the `hidden` attribute, so
  the Exit chip showed as Cancel in the overview. The check now looks at the
  chip as the browser lays it out.
- **Timing on a lighter map:** automatic detail adjustment coarsened the map
  after the check's slow screenshot frames, by up to 1.75 levels. At a
  frame-rate cap it does not refine again, so the first timing runs passed on a
  map lighter than the one asked for. The check now holds the detail asked for
  while it times frames.
- **Machine sleep:** two runs stopped when the unattended Mac went to sleep
  mid-trace. On macOS the check now holds off idle sleep, and stops with that
  reason if a step was slept through.
- **Frame timing:** frame intervals are measured on the animation frame's own
  time. Measured inside the render, they include the raster-tile update that runs
  first, whose length varies from frame to frame. That work shifts when the
  render starts, not when the frame is shown.

**Known behaviour, not yet changed.** A ground-relative marker follows the terrain
the map displays, and that includes tiles drawn flat until their elevation
arrives. While terrain streams in, the orb can drop by hundreds of metres for a
moment. In the retained run it travelled 105 m while the campus loaded, and one
earlier run saw 71 m during the fast near/far sweep. Holding
the marker until the terrain under it is final belongs with stage 2's placement
work.

**After the first user trial.**

- **Drag inside a panorama:** the view moved only on release, jumped there, and
  then kept turning with the pointer. The globe's mouse, wheel, touch and Safari
  gesture controllers listen in the capture phase and stop the events they use.
  Suspension gated only their effect on the camera, so they still stopped the
  panorama's moves, its release and every wheel event. They are now detached
  while a lease holds navigation and attached again afterwards. A unit test
  drives a drag through both, on the capture-first order browsers use.
- **Keys, sticks and glide:** nothing in the app stepped the look model, so held
  arrow keys and controller sticks did not turn the view, and a drag never
  glided; the unit tests had stepped the model themselves. The loader now steps
  it every frame while anything moves, holding rendering only meanwhile. A drag's
  speed waits for its release, and a drag held still for more than 80 ms before
  it has none.
- **Trackpad:** in trackpad mode a two-finger swipe looks around
  (`scene.panorama.swipeSensitivity`) and a pinch zooms, and in mouse mode the
  wheel zooms, as the globe classifies the same events. Safari's gesture events
  pinch too.
- **Orb style:** a scene's `markerStyle`, or a marker's own `style`, gives orbs an
  outline in a colour and a width in CSS px, and growth under the pointer
  (docs/scenes/format.md). The outline is drawn by the orb's shader, measured in
  rendered pixels, and left out of the probes' outputs. The linked pair example
  uses both.
- **The bar while entered:** the map's detail rail and basemap chip are hidden,
  since the map is not drawn. The panorama's credit takes the chip's place. The
  close button that sat where the rail was is gone since the second trial,
  below.
- **The input check:** [`scripts/validation/panorama-input.mjs`](../../scripts/validation/panorama-input.mjs)
  checks all of this with real mouse, wheel and key events from headless Chrome,
  on the GPU. Its retained run passed:
  [input-2026-09-27](../../validation/evidence/panorama-scenes/input-2026-09-27/README.md).

**After the second user trial (2026-09-27).** The user found every image soft,
wanted a quality control and a tab for the panorama in place of the close button,
different tabs inside a panorama, and a + menu that stays in front.

- **Why the images were soft.** Not only the tour's 4096 px ceiling: on the
  user's screen, two device pixels per CSS pixel, the tour's 60 orbs chose 256 px
  preview cubes, and their 120 MiB left 8 MiB of the 128 MiB GPU budget. No whole
  image fit, not even 2048 px, so every panorama stayed on its 1024 px preview.
  The loader also asked only for the smallest image meeting one texel per pixel.
- **The largest image by default.** The loader now shows the largest immersion
  image within `scene.panorama.immersionWidth` (the image detail, px around the
  turn, defaulting to the renderer's texture limit), the device and the budgets.
  The sharpness target, `immersionDensity`, is Off by default; a number brings
  back the smallest image meeting it. Moving either, or a GPU budget, chooses
  again at once. `sourceGpuMiB`, `overlapMiB` and `decodedMiB` are derived from the
  texture limit, §4. The status gives which image is shown, one on its way, and
  why no larger one is, naming the detail, the device or the budget.
- **The panorama's tab.** Entering opens "360: <title>" with the photograph's
  details, its links and the image detail; a link retitles it; closing it leaves,
  as Escape does. The Scenes tab no longer shows the panorama on screen or an
  Exit button, and the bar has no close button.
- **Tabs by context.** Inside a panorama, Location and Map are hidden and 360
  image settings is offered; hidden tabs return to their places afterwards. The
  bar hides the camera's position there too.
- **The + menu.** Its panel clips what passes its edges, and with many tabs the
  + sits at the strip's right end, so the menu was cut off at the panel's edge,
  showing the globe or the panorama in its place. It is now drawn in the
  overlay's own layer, fixed to the window at the button.
- **The format.** `imagePose.aligned` says whether an image's north is set; the
  tab shows it.
- **Not re-run:** the campus and input checks follow the change (the panorama's
  tab replaces the close button), but no GPU run was made for it.

**Flying in and out (2026-09-27).** The user asked for the camera to move into
a 360 image when it is entered and back out of it when it is left, "pulling out
from the direction it is currently facing", as a setting on by default. It is
`scene.panorama.flightDuration`, "Fly into and out of 360 images" in Scenes →
Motion: 1000 ms, or Off. The poses are pure functions in
[`panoramaFlight.ts`](../../src/scenes/panoramaFlight.ts); the loader drives them
and the runtime's `placeNavigationCamera` moves the globe camera (§5).

- **In.** The camera flies straight at the orb's marker while turning to face
  it, and the orb becomes a sphere of the size it had on screen when the flight
  began, solid where terrain does not hide it and revealed over everything as
  the camera closes in. The distance shrinks by the same factor each moment, so
  the orb grows at a steady rate. The flight ends inside the sphere, at half its
  radius, where every ray shows the image itself; the fullscreen image takes over
  there with the camera's own view, then levelling runs as before.
- **Out.** The reverse: the camera starts inside the sphere, which draws the
  image on screen (the sharp one, not the orb's preview) over everything with the
  view's own rays, so its first frame equals the image's last. It backs away
  keeping the heading the view faces, always looking at the orb, while its pitch,
  distance and field of view move to those of the view the panorama was entered
  from, and the roll unwinds. The sphere is the size the orb has on screen there,
  so it becomes the orb itself; its overlay fades as it goes, and the camera ends
  as the globe's ordinary orbit of the orb.
- **Where Exit ends, and why.** It ends facing the way the view faced, centred on
  the orb, at the entry view's pitch, distance and field of view, not at the saved
  view. Pulling out is backing away along the look; ending anywhere else needs a
  turn on the way out. Keeping the pitch, distance and field of view keeps the map
  at the scale the user chose. The cost: facing elsewhere than when entering, the
  map there may not have loaded, since maps stay paused while a panorama holds
  navigation; they stream once the flight ends. With the flight off, Exit fades
  back to the saved view as before.
- **Input.** Escape, a press or a new wheel gesture on the canvas cut a flight
  short, and so do Back and `exit()` during an entry. Looking stops as the exit
  begins. Back during an exit joins it, and links are not followed on the way
  out.
- **Cut short (2026-09-27, after the user's trials).** The user found that
  cutting a flight short snapped the camera back to where the entry began, or
  on to where the exit would end, and asked instead for it to "switch from
  moving in the animation to slowing down to standstill", with momentum. A
  first version braked along the flight's path while the scene still held the
  camera, then gave it back; the user found their swipe ignored until they
  lifted and swiped again, and asked for input to work at once. So a flight
  cut short gives the camera straight back to the globe where it got to, moving
  as it was (`flightMotion` in `panoramaFlight.ts`), and the globe's own glide
  slows it, keeping `camera.inertiaDecay` of its speed each 60 Hz frame as after
  a flick (`glideNavigationCamera`, §5). The input that cut it short goes on
  moving the camera: a wheel gesture begun during the flight is the globe's
  from its next event, and a mouse press becomes a drag from where the pointer
  is. The entry is cancelled; the exit completes. The rules this follows,
  for every camera, are in [Camera motion](../camera-motion.md).
  - **The orbit handed back.** The eye and look stay exactly where the flight
    had them, orbiting the point where the line of sight comes down to the
    orbit target's height near the orb, so ground following has nothing to
    correct. That point is often nearer than `camera.zoomLimits` allows, which
    much of each flight is; the camera may then come as near as its glide takes
    it and no nearer, and the limit holds again once it is out past it. A tilt
    outside `camera.pitchLimits` comes inside at once, and the roll levels; both
    jump by what is left of them, which is little except when an exit is cut
    short early from a view looking above the horizon. The field of view eases
    back to the overview's at the glide's rate.
  - **The motion handed back.** The eye's velocity and the look's turn become
    the globe's own pan, orbit and zoom rates (`orbitGlideRates` in
    `cameraGlide.ts`): the turn is the orbit's, the part of the eye's motion
    along the look the zoom's, and the rest the pan's, across the ground. A
    glide into the orb stops short of its sphere; the rest of that way is the
    flight's, not the map's. The glide's caps on one frame's pan, orbit and zoom
    apply, as they do to a flick.
  - **The orb.** The sphere turns back into the orb on the glide's curve, to the
    orb's own size from wherever the camera is and without its overlay; the
    image an exit showed stays loaded until then. Entering again, or a new
    scene, ends that at once.
  - **Clicks.** A press during an entry or exit is not also a click on an orb
    when released, which would enter the orb just flown away from.
  - Another navigation, such as entering another panorama, or a new scene,
    takes the camera where the flight got to, at rest.
- **Momentum is not input (2026-09-27).** The user found that pressing Escape
  while a trackpad swipe's glide was still turning the image skipped the flight
  out. A trackpad's glide after the fingers lift is the system's: a stream of
  wheel events, which the flight took for input cutting it short. A wheel event
  within `WHEEL_GESTURE_IDLE_MS` of the one before continues its gesture, as the
  wheel handlers already read gestures; now only a gesture that begins after a
  flight began cuts it short. Whoever takes input next ignores a wheel gesture
  that was under way before, to its end: the globe after a panorama gives
  navigation back, and a panorama's look after an entry, so neither the image's
  glide pans the map nor the map's turns the image. A gesture that began during
  a flight and cut it short is the exception above: it goes on.
- **The panel during a flight (2026-09-28).** The user asked for the
  panorama's tab to start minimized while the flight runs, and to show only
  once in the image. Entering opens the tab selected with its panel minimized,
  out of the way of the map the camera flies over, and the panel shows when the
  panorama is on screen, unless the person showed it or picked another tab in
  that panel meanwhile ([UI layout](../ui-layout.md#a-panoramas-tabs)). The
  same holds through the entry reveal when the flight is off. Following a link
  leaves the panel as it is, and a flight cut short puts it back as it was.
- **Off, reduced motion, or a runtime that cannot move its camera:** the entry
  reveal (`expandDuration`) and the exit fade, as before.
- **The handoffs** are in the [visual contract](../validation/panorama-visual-contract.md#flights-and-the-exit-handoff).
  Tests check both flights' ends against `handoffReady`, that the placed camera
  has the pose asked, roll included, on Babylon's own camera, and that the exit
  ends as the globe camera's orbit at the heading faced. The campus check now
  expects that end view; it was not run for this change, and no GPU or motion
  trial was made. For flights cut short, tests check the flight's velocity and
  turn where it got to; that the pan, orbit and zoom rates reproduce that motion,
  pulling out, flying in and sideways; that Babylon's camera keeps the eye and
  look at the handover, orbits nearer than the zoom limit, glides on outward and
  eases its field of view; that the zoom limit holds again once out past it;
  that a swipe begun during the flight and a held mouse press carry on while a
  swipe's momentum from before does not; and that the sphere turns back into
  the orb. Not tried on a GPU or by the user.

**Not covered.**

- The check runs on one desktop GPU in headless Chrome, not on a phone, and says
  nothing about the mesh, cache or appearance alternatives of stage 3.
- These are covered by unit tests with fake GPUs and inputs, not on a GPU:
  gamepad look, reduced motion, device loss, cancellation, and late decodes after
  disposal. The input check covers mouse, wheel, trackpad and arrow keys.
- The public consumer fixture is 0SFS itself: it imports FOSS Earth's public
  exports without activating panoramas, and its checks pass.

### Required acceptance gate: one 360° orb above UMN, then user testing

The same reproducible scene must be usable by the implementing workhorse and by
the user. Deliver the following as part of stage 1, and repeat the gate for the
mesh/cache/appearance alternatives when stage 3 lands.

**Scene and image.** Add a normal v1 manifest at the proposed published example
path `public/examples/panorama-scenes/umn-single.scene.json`, selectable through
Scenes → Content → Load scene. It uses the ordinary loader, preparation and
renderer, without special panorama behavior keyed to the fixture name. Use the
existing [photographic test input](../../validation/evidence/panorama-scenes/visual-contract-2026-09-27/photo-input.png)
and retain its [provenance](../../validation/evidence/panorama-scenes/visual-contract-2026-09-27/README.md).
Prepare and package its preview cube locally; the test must not need to fetch the
photograph from an external host. The retained 512×256 image is enough to test
direction and responsiveness, but is not evidence of full-resolution photo quality.

Reuse the research's campus test anchor, latitude **44.974°**, longitude
**−93.235°**, as an approximate display registration. Label the scene “UMN — test
panorama” and state plainly that the photograph was not captured there. Keep
capture altitude unknown and record this synthetic test registration in optional
fixture metadata; do not invent surveyed campus/photo alignment. Use ground-relative
placement with provisional **30 m above the displayed surface**, zero east/north
offset, and **2 m authored radius** so the orb is easy to find above the campus.
These are editable manifest fixture values shown in scene details, not new global
defaults. Show pending placement until the displayed surface is ready. Start with
the real globe/map visible, the camera south of the orb looking toward it, 100 m
horizontal separation and 60° vertical FOV. Resolve camera height from the same
displayed surface/marker placement. Record the map provider and settings; use an
available provider without introducing a new account or credential requirement.

**Directional correctness.** With rectilinear 90°, direct quad rendering and cache
off, translate/orbit the camera around the fixed marker through a full circle;
also move nearer/farther, above/below its height where unobstructed, and turn the
camera without translating. The clipping/content axis is camera-to-displayed-marker
as specified in §3. At zero image pose, a camera south of the marker looking north
shows the image's north direction; from west looking east it shows east. Pure
camera rotation reprojects the world-locked content; it must not spin the photo as
if it were a UV-painted ball. Repeat with the generated cardinal/text panorama as
a temporary source on the same marker to detect mirroring and incorrect direction;
the user-facing default remains the photograph. Report deliberate terrain occlusion
separately from failed image coverage.

**Automated workhorse check.** Add
`scripts/validation/panorama-campus.mjs` with configurable duration, viewport/DPR,
camera trace, settings, output directory and explicit build/fixture inputs. Default
outputs use a new dated `build/validation/panorama-campus/` directory. Drive a
headless browser through the actual globe input/camera and scene-loading path,
including pointer drags as well as a deterministic camera replay. Reuse the
serverless built-asset request-interception pattern of 0sfs's `profile-flight.mjs`;
keep the new generic harness in FOSS Earth, with no persistent dev/preview server.
Confirm the actual WebGPU backend and hardware GPU; if unavailable, report that
limitation and do not mark performance accepted.

Use a recorded development trace: one 20 s orbit in each direction, a 10 s
near/far sweep (30–200 m horizontal separation), a 10 s elevated/off-center look
segment, and stop/restart input to expose queued or stale updates. These are
configurable test inputs, not runtime tuning constants. Capture landscape and
portrait correctness frames. Compare sampled directions at selected frames to the
CPU reference with the *same current* camera, marker and image-pose transforms;
use a provisional 0.01° maximum interior-ray error tolerance for the GPU port,
report coverage/silhouette error separately, and retain actual maxima and sampled
locations. Use cardinal/text images as well as photographs; an FPS counter alone
does not establish correct content.

Obtain measured directions from GPU output/readback using the production shader's
sampling function and the captured draw/frame revision, alongside the actual
displayed image. Recomputing expected directions in JavaScript or inspecting
uniform values alone cannot prove what the GPU displayed. For cached output,
check the final displayed result as well as the cache's source revision. Include
a test-only negative control that delays panorama uniforms or cached output by
one frame while the camera moves; the correctness harness must reject it. This
demonstrates that the test detects stale imagery rather than just valid arithmetic.

**Responsiveness and timing.** “No lag” requires the orb's parameters and globe
camera matrices to use the same camera revision in every submitted frame, with
no extra queued-frame delay for updating panorama direction. Once the source is
ready, camera motion must not require a network request or a new photo decode.
With caching on, an invalid view falls back to current direct rendering until
refresh completes; stale cached output is a failure. Correlate input events,
camera revisions and submitted draw revisions; screenshots/ray checks must detect
stale output too. This is an application-frame guarantee, not a claim of zero
physical input-to-display latency. User testing still judges perceived lag.

Run image/direction readbacks in a correctness replay, then run the identical
camera trace separately for timing with diagnostic readbacks and screenshots
disabled. GPU readback can stall a frame and must not contaminate the responsiveness
measurement. Record profiling overhead with a profiling-off comparison and keep
test-only fault injection out of the ordinary scene/UI.

Measure cold load separately. For warm motion, compare the same camera trace and
globe settings with the orb hidden and shown, after preview and map warm-up; record
remaining streaming activity rather than pretending the globe is idle. Initial
development acceptance targets for this one-orb check are p95 frame interval
≤20 ms, p99 ≤33.3 ms and no interval >100 ms during continuous motion on the
recorded desktop configuration, with a 60 fps test cap. Report whole-frame and
per-section distributions and their baseline difference; do not infer causation
solely by subtracting two GPU summaries. These thresholds are provisional, visible
test configuration. If the globe-only baseline misses them, report that failure
separately and the orb's incremental cost; do not claim “no lag” or silently lower
quality. Exclude deliberate scheduler-idle gaps from motion percentiles and measure
the first frame after resumed input separately. The user can revise these targets;
they are not phone qualification or universal hardware promises.

**Handoff to the user.** Retain manifest/settings/source hashes, browser/GPU identity,
the trace, screenshots and timing/ray results under `validation/evidence/panorama-scenes/`.
Deliver a working scene link (or exact launch command plus relative scene path),
instructions to load it, reset the campus view and open the frame-budget panel,
and the expected north/east views. The user should need no DevTools or source edit
to load the one-image scene and move around it. The implementing agent reports
“automated check passed on [recorded configuration]; manual acceptance pending,”
then the user tests orbiting, looking and near/far motion themselves. Do not record
manual acceptance on their behalf or call a CPU-only run the finished feature.
This gate is required even if later 20/200-marker benchmarks pass.

### Stage 2: bounded scale and failure behavior

Depends on stage 1. Add 20/200-distinct-asset scenes, progressive whole-image detail,
size clamping, decluttering, replacement/history stress and telemetry, independent
budget stress, source failures, map changes and saved-overview streaming option.
Exercise portrait/DPR/FOV changes, unknown heights, rapid selection, and lowering
every resource cap. Acceptance: no hidden all-source downloads, no stranded input,
no cap bypass by pinned resources, list access to all omitted/occluded markers,
complete low-detail fallback during pressure. Record dimensions/bytes that prevent
requested quality as input to delivery optimization.

### Stage 3: requested renderer/cache alternatives

Depends on stage 1 geometry/color and stage 2 accounting. Add adjustable mesh-sphere
window rendering, fisheye appearance/blend and exact-invalidation output caching,
with their settings. No automatic switching or claim of a proven fastest path.
Acceptance: same ray/pose/color/picking/depth semantics within declared geometry
error, safe cache invalidation on every dependency, budgets/refresh limits respected,
no stale output, and implementation selection does not change appearance. Use
interactive trials to choose appearance/orientation/timing defaults.

### Stage 4: justified delivery/binding optimization

Depends on measured stage 2 limits and stage 3's equivalent outputs. Add tiled
immersion for documented quality/budget needs, compression through a tested loader
and capability path, or cube arrays for demonstrated binding overhead. Each is
independent. Acceptance includes fallback coverage/missing tiles, edge mips,
compressed format fallback, array slot reuse races, bounded overlap and device
loss of these added resources. Do not claim large-source tiled quality before
implementing this stage.

### Stage 5: matched-output GPU experiment and qualification

Run later with the actual globe and real hardware GPU. Use 20/200 **different
panorama assets**, marker footprints 32/96/256 rendered px, near-fullscreen entry,
idle, rotation, translation, linking and pressure. Compare quad, mesh and cache
at matched appearance, source LOD, color, depth and output size; compare source
compression/tiling separately. Record device/GPU, browser/OS, thermal/battery state,
settings JSON, source hashes, globe workload, camera trace, output errors, warmup
and duration. A phone-sized desktop viewport is not a phone measurement.

Report CPU/GPU p50/p95/p99, draw calls, coverage, cache refresh cost, decode/upload
stalls, pool peaks, transferred bytes, cold/warm usable-image times, transition
hitches and return delay. Verify hardware rather than software rendering; absent
GPU timestamps are unavailable data, not zero time. Provisional development goals:
p95 frame interval ≤33.3 ms with globe+20 markers, no interaction stall >100 ms,
cold selected usable preview ≤2 s on a recorded 10 Mbit/s, 50 ms RTT profile, and
zero application-budget overruns/unbounded retention. These are experiment targets,
not release promises. Report 200-marker results without silently lowering quality.

## 8. Validation and decisions still needed

Pure fixtures cover schema/URL/IDs, pose inverse, cube axes, coverage/handoff,
monotonicity/finiteness, FOV limits, budget admission/eviction/release, async
generations, lease/history state and cancellation. Targeted visuals cover readable
text/cardinals, seams/poles/roll, off-center/near-plane cases, portrait/DPR, marker
height, depth overlap, rotation, LOD changes and reduced motion. Compare ray error
and images; report maxima and coverage separately so background cannot dilute an
error. Future GPU screenshots must reuse CPU fixtures.

Run incremental typecheck, related tests and lint for edits, and full `npm run ci`
once at finished implementation stages; preserve logs under dated `build/` and
inspect them rather than repeat. Check consumers when public surfaces change.
Selected records belong in top-level `validation/evidence/panorama-scenes/`,
explanations in docs, tools in scripts/tests. Preserve previous runs. This task
starts no GPU benchmark or dev/preview/watch server.

Ready-to-implement proposals: generic v1 ownership/scope; explicit image/capture/
display semantics; flat-window baseline and finite fisheye candidate; separate
coverage/equality handoff; prepared uncompressed previews and per-orb bindings;
byte/dimension-based loading; cancellable navigation with the original overview;
and staged mesh/cache alternatives. Unmeasured defaults remain provisional.

Genuine release decisions: name actual phone/laptop models and OS/browser versions,
and accept numerical performance/loading targets. Recommend one constrained WebGPU
phone, a second mobile browser/GPU family and one laptop; exact models belong to
the release owner. Missing phone measurements block phone qualification, not
proposal completion or stage 1. Appearance, leveling versus authored entry and
timing remain adjustable usability preferences with explicit defaults. WebGL
panoramas, tour migration/media, branding and registration need separate scope
decisions only if requested; none blocks the neutral scene path.
