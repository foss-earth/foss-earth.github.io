# Weather: one world for the globe and the aircraft

Status: **draft implementation specification, 2026-10-08**. Nothing in this document is an implementation or qualification claim. Owner: FOSS Earth for world weather, sources, drawing and the shared tab; 0sfs for aircraft integration; JSBSim for flight dynamics and atmosphere/wind defects.

Evidence and provider investigations are in [weather research](research/weather-research.md), including the supplied deep-research report's audit. This spec chooses an implementable baseline, defines the interfaces and acceptance gates, and leaves the product choices visible. It follows [Sky](sky.md), [Settings](settings.md) and [render on demand](../render-on-demand.md). No code from the studied simulators is proposed for copying.

## Outcome and first release

A user sets wind at several heights, temperature, pressure, visibility and cloud layers in one **Weather** tab. The globe draws that world. The flight samples it at each accepted physics step. Crossing a cloud's drawn base enters the same canonical cloud; wind that moves its resolved structure is the wind sampled by the aircraft. Weather changes the incident light used by the sky, ground, aircraft and meter. Changing aircraft keeps world weather. A saved flight retains enough weather to reconstruct it.

The proposed first release is offline: **manual and seeded profiles, temperature/pressure, explicit humidity where the engine supports it consistently, visibility, and simple coherent cloud layers**. It does not need a server, account or third-party weather request. Mean-wind aircraft coupling can ship before turbulence. Live sources, detailed volumes, precipitation and aircraft hazards are separate stages with their own gates. This is a drafting assumption pending the user's scope choice, not permission to enable a provider or claim validated icing.

The initial authored world is clear, calm and dry, with JSBSim's standard temperature/pressure profile. Existing saved sky and display settings remain unchanged. Existing flight wind controls migrate to the shared tab; no duplicate sliders remain in the flight panel.

### Decisions to resolve when adopting this draft

| Decision | Draft choice | Cost of another choice |
| --- | --- | --- |
| First-release phenomena | Offline profiles, visibility, simple clouds; engine-validated humidity and gust/turbulence added independently | Live data adds terms/privacy/decoder work; storms, icing and contaminated braking add independent physical validation |
| Network weather | Disabled until an explicit provider choice and disclosure | Automatic live data reveals IP and requested area/time; paid/proxy modes need operator infrastructure |
| Historical scene time | Weather follows the scene time only when its input covers that instant; otherwise show the mismatch and keep the selected snapshot | Real historical coverage needs archives, storage and variable-specific validation |
| Cloud motion on a still globe | No weather-only redraw timer by default; presentation freezes between other requested frames | Continuous motion costs frames; the user sets Hz and error bounds |
| Detailed clouds | Simple common representation first; fragment ray marching and WebGPU detail later | A detailed first release requires backend/height/device evidence before usable weather |
| Save guarantee | Reproduce world inputs and replay from an initial state with pinned versions | Exact mid-flight stochastic-filter resume needs a verified engine checkpoint |
| Adverse aircraft hazards | Deferred; never inferred qualified from a visual effect | Each selected hazard needs aircraft-specific inputs, response and held-out references |

## Current baseline, to recheck before implementation

The research's installed-WASM findings concern **fork.16 / 97fe6ddf…**. At drafting, [0sfs's package procedure](../../../0sfs/docs/jsbsim.md) records **fork.20 / ea6956b4…**, with an optional coupled turbine plant now used by the F135. Those earlier weather observations are regression leads, not evidence that fork.20 has identical behaviour. Stage 0 must run identity checks and the bounded atmosphere/wind probes against the active artifact; never infer the installed engine from the working checkout.

The sky's rungs 0–2 exist as uncommitted work with CPU and software-rendered checks. Its per-pixel aerial perspective and cloud rungs remain planned. The sky presently normalizes physical quantities by `whiteLuminance` at their output writers and applies display compensation separately. Weather preserves that contract. No part of this spec claims real-GPU appearance or cost.

The [terrain datum contract](../streamed-terrain.md) also matters: raster terrain places source sea-level heights directly into scene geometry, while Google tiles have ellipsoid heights. The EGM2008 readout helper does not itself correct all terrain geometry. Stage 0 must establish one shared physical-to-scene height adapter before promising report ceilings and drawn cloud entry agree. Do not repair that mismatch only inside weather.

## Ownership and package surfaces

| Piece | Owner | Public boundary |
| --- | --- | --- |
| Field definition, thermodynamic profiles, geometry, seed, clocks, revision timeline, provenance | FOSS Earth | Proposed `foss-earth/weather`, pure TypeScript and no Babylon/aircraft imports |
| Import, source adapters, optional retrieval/worker/cache, world snapshot format | FOSS Earth | Same weather surface; deployment proxy/preparation content belongs to its operator |
| Cloud/fog/precipitation/lightning drawing, lighting and scheduling | FOSS Earth | `BabylonRuntime.weather`, integrated with sky and imagery |
| Shared Weather sections, settings and source/age diagnostics | FOSS Earth | `foss-earth/shell` weather panel and host-section extension |
| Point queries at fixed steps, JSBSim conversion/property order, flight generation and observations | 0sfs | Aircraft adapter consumes the weather export; no deep imports |
| Turbulence/filter/thermodynamic defects, shear-force semantics, generic engine checkpoint support | JSBSim | Upstream tests/patches and adopted SDK artifact |
| Instruments, cockpit/airframe sound, icing collection/protection, runway scenario and contact configuration | 0sfs | Host sections and flight observations; generic force/contact laws stay in JSBSim |

The two ownership questions are applied to each piece: correct without an aircraft, and wanted by a globe. Environmental events, shared terrain wetness and world sound pass; aircraft impacts and runway operational response do not. Environmental audio is a later optional FOSS Earth capability, not a new dependency of the offline baseline.

Proposed exports are `createWeatherWorld`, `createWeatherSampler`, `prepareWeatherRevision`, `validateWeatherDefinition`, `encodeWeatherSnapshot`, `decodeWeatherSnapshot`, the thermodynamic/conversion helpers and their types. `createWeatherPanel` accepts settings, world commands, current source status and host sections. `BabylonRuntime.weather` exposes `getStatus`, `subscribe`, `setWorld`, and disposal. Exact file names may follow repository conventions; these are required responsibilities, not existing APIs.

## The canonical state

Weather is a versioned definition plus immutable inputs and an accepted revision timeline. It is not one global 3D texture. Manual input is a column and optional authored regions; imported model input retains its native grid and vertical coordinates; seeded input is a versioned coarse generator plus local feature catalogue. Renderer textures and meshes cache this definition and never decide aircraft conditions.

There is always an explicit global offline baseline. Imported/live overlays have declared geographical footprints and valid-time bounds over it; outside those bounds the recorded footprint/valid-time policy applies: declared baseline, endpoint-field hold where defined, or host pause. An incidental cache miss never selects that baseline: accepted inputs are pinned, and camera-driven downloads cannot decide aircraft weather. Stale source responses are rejected by source/world generation and refresh sequence.

Every field carries validity, datum, source time and an observation/inference flag. Missing is distinct from zero. Density, RH and dew point derive from pressure, temperature and water vapor; independently contradictory triples are rejected. Optical cloud proxies remain explicitly separate from measured liquid-water content.

| Quantity | Canonical unit and convention | Required information |
| --- | --- | --- |
| Physical position | WGS84 lat/lon degrees, ellipsoid height m, double precision | Conversion to source MSL/geopotential/AGL uses a named versioned adapter |
| Wind | Local east/north/up m/s; velocity **towards** | Transform to ECEF before interpolating distant local frames, then back at query point |
| Temperature / pressure | K / Pa, at the sampled height | Reference surface, profile model and valid height envelope |
| Water vapor | kg vapor/kg moist air, `q` | Derive mixing ratio `q/(1−q)`, RH, dew point and moist density |
| Cloud layers | Base/top m in declared datum, coverage 0–1, kind and phase | Stable occupancy definition/feature seed; base/top not merely a draw offset |
| Cloud condensate | Liquid/ice kg/m³, optional effective radius µm | Null/unknown if only optical proxy exists; never invent icing input |
| Extinction / scattering | m⁻¹ in the sky's three bands, albedo and phase fraction | Aerosol, fog, cloud and precipitation contributions identified separately |
| Visibility report | m, convention, lower/upper censoring, uncertainty | MOR, prevailing visibility and RVR remain distinct |
| Precipitation | Liquid-equivalent mm/h at declared level, phase | Parent/source volume and fall/advection model, not independent random screen rain |
| Resolved gust/lift cells | m/s, size m, age/lifetime s, stable ID | Their coherent field is sampled by both consumers |
| Aircraft subgrid turbulence | Named spectrum inputs, variance m²/s², length m and envelope | Descriptor only; trajectory filter belongs to the flight engine |
| Surface water/snow/ice | Depth m, surface temperature K, class and history | Deferred baseline; accumulation is not instantaneous precipitation |
| Events | Stable ID, UTC/elapsed start and duration, world bounds | Storm/lightning/surface events use the same timeline |
| Provenance | Provider/model/edition, run/valid/received times, units, licence/credit, hashes | Original, transformed, inferred and missing fields distinguishable |

### Height and thermodynamic rules

For an orthometric source height `H` and geoid undulation `N`, physical ellipsoid height is `h = H + N`. Geopotential height is a separate coordinate; pressure levels become geometric positions through supplied geopotential and declared conversion. METAR cloud bases are station-relative AGL; add the station elevation in its stated datum before converting. Terrain-relative features use a pinned surface sampler/identity and report missing terrain instead of guessing it is sea level.

Both aircraft and renderer use the same `PhysicalHeightAdapter`. For the current raster scene convention it may map a physical orthometric height back to source-sea-level scene coordinates; Google needs ellipsoid coordinates. This is a FOSS Earth coordinate/terrain concern, shared by skies, labels, weather and flight. Tests must include a nonzero geoid, both surface modes and an origin change. Do not change unrelated terrain geometry silently as part of a weather adapter.

The baseline atmosphere is hydrostatic: integrate `dP/dz = −ρg` using temperature and vapor profile, preserving an explicit pressure reference. Density derives from the moist gas law. A uniform temperature bias and a user-authored inversion are different profiles. Surface-pressure/QNH controls state their conventions; QNH is not substituted for a forecast MSL pressure without a named reduction. Air above the declared weather envelope uses the common standard background atmosphere, with continuous transitions; imported below-ground pressure-level values remain masked.

### A concrete model boundary

The following type sketch fixes meanings, not storage layout. A schema implementation must include the fields' validation and provenance rather than treating this sketch as complete serialization code.

```ts
type WeatherPosition = {
  latitudeDeg: number; longitudeDeg: number; ellipsoidHeightM: number;
};
type WeatherTime = {
  weatherValidUtcMs: number;
  elapsedSeconds: number; epoch: number; tick: number;
  timestepEpoch: number; dtSeconds: number; acceptedStep: number | null;
};
type WeatherSample = {
  revisionId: string;
  valid: boolean; flags: number;
  eastMps: number; northMps: number; upMps: number;
  temperatureK: number; pressurePa: number; specificHumidity: number;
  densityKgM3: number;
  cloudOccupancy: number; cloudExtinctionPerM: number;
  liquidWaterKgM3: number | null; iceWaterKgM3: number | null;
  fogExtinctionPerM: number; aerosolExtinctionPerM: number;
  precipitationMmPerHour: number;
};
interface WeatherSampler {
  sampleInto(position: WeatherPosition, time: WeatherTime,
    out: WeatherSample): void;
}
```

The sampler returns into caller-owned storage. No fetch, worker message, scene query, allocation or renderer readback occurs inside it. A world volume request uses the same definition/revision/time to fill bounded renderer-owned buffers or obtain analytic layer descriptors. It cannot replace cloud occupancy with an unrelated noise shader.

## Resolution, interpolation and deterministic synthesis

There is no mandatory 0.25° grid and no claim of wing-scale forecast detail. Initial normalized import limits are a bounded region, up to 64×64 horizontal nodes, up to 64 vertical levels and two bracketing source times; extra times stream within the same byte cap. Native metadata is retained. Stage 0 settles packing and peak residency under the catalogued caps. Manual columns do not allocate such a grid.

Point sampling caches cell indices and corner values where profitable. Interpolation weights change as the query moves inside the cell. Interpolate vectors rather than compass headings, pressure in a positive/log-compatible representation, and bounded moisture/optics with a monotone scheme. Handle longitude wrapping, poles, native rotated/projected vectors, below-ground masks and missing values explicitly. Hold only within the declared extrapolation envelope; do not claim invented observations.

Seeded baseline v1 produces bounded profiles and moving cloud footprints from authored inputs. It is **plausible authored synthesis**, not numerical weather forecasting. Use counter/hash-based random inputs keyed by generator version, seed, feature/cell ID and time epoch. No shared mutable RNG depends on query order, frame rate, floating origin or network arrivals. Feature overlap uses stable ordering; geographic cell boundaries blend continuously. A cloud mask has smooth density edges and the same CPU/GPU reference definition. Future noise refinement must match the reference within a declared error, not move physical cloud entry according to visual quality.

Initial cloud drift is evaluated in a local geographic region with a uniform resolved horizontal wind, or a declared deterministic integration trajectory through the spatial field. A different wind at each altitude deforms layer evolution accordingly. Feature creation/lifetime and compensating fluxes are part of the versioned generator. Do not independently scroll cloud textures by a different wind. Stage 0 chooses closed-form advection versus bounded checkpoints for nonuniform wind and proves seam/time-seek behaviour.

Determinism means identical canonical samples for identical versioned inputs on the declared CPU runtime. Pin transcendental/noise conventions where required. GPU numeric differences have explicit tolerances; bit-identical shaders across vendors are not promised. CPU cloud entry and aircraft air data do not depend on those differences.

### Reports and model grids

A model supplies the resolved column/field; a report is a constraint at its station/time. Each report correction has a named horizontal radius, vertical influence, lifetime and confidence. Wind corrections operate on vectors; pressure/temperature changes rebuild a consistent column; cloud/visibility corrections preserve censoring and uncertainty. No nearest-station discontinuity or unconstrained IDW is the default.

A report-only world fills unknown aloft values from an explicitly labelled standard/authored/seeded background. Cloud tops, thickness, morphology and precipitation volumes inferred from METAR must remain marked inferred. TAF groups are forecast intervals/scenarios, not observations. Rain must come from an accepted parent cloud/shaft definition; reported rain with unknown cloud structure requires an inferred source, shown as such.

Stage 0 implements the normalization/validation boundary and synthetic report fixtures. The first live adapter is chosen only after the source experiment. Do not build a general worldwide METAR assimilation system merely to replace two sliders.

## Time, revision acceptance and the host

There are three clocks: **scene UTC** for Sun/Moon and Date and time; **weather valid UTC** for source samples; **weather elapsed time** for deterministic evolution. Their mapping is explicit and saved. In flight, **Follow scene adopts the selected scene instant at start or an explicit seek**, then weather valid UTC advances from accepted simulated elapsed time; it never resamples the sky's wall-clock Now on each physics tick. If astronomy remains wall-clock-driven, show its divergence from weather time. A flight pins origins and derives elapsed time from accepted fixed steps; a globe has a host clock mapping with pause/rate/seek commands. `Date.now()` may discover new sources but never advances aircraft gusts or overwrites a pinned replay. Preserve an elapsed-world offset across driver replacement/reset-to-zero; a timestep change begins a named epoch, not `current dt × all previous steps`.

| Operation | Required result |
| --- | --- |
| Accepted flight step | Sample wind/T/P at its beginning position and time; publish that input receipt (start position/time) alongside completed engine air data (end time) with the same revision ID |
| Wall-clock stall, hidden tab, dropped render frame | Driver overload/pause rules apply; no simulated step is invented and wind never decays because the machine stalled |
| Date-and-time seek | Propose an explicit new mapping/epoch; preserve a snapshot if no source covers the date and show mismatch. A live flight does not reset without its host's safe boundary |
| New report/model run arrives | Prepare a complete candidate, validate, then accept at a recorded host boundary; receipt time is not its meteorological valid time |
| Manual edit | Validate a complete revision; apply at the next safe boundary, with a recorded transition or an explicit immediate scenario change |
| Aircraft change/reset | World revision and its independent epoch persist unless the user requested a world reset; old driver callbacks cannot write new state |
| Source outage | Keep last accepted state and show stale/uncovered status; no silent calm/clear/ISA substitution |

A canonical revision includes a minimum analytic cloud/extinction representation available on the CPU. Stage 0 proves a **resident, precompiled common rendering path for every admitted v1 definition**, including WebGL 1 descriptor/uniform bounds. Initial imports may contain gridded thermodynamics/wind but their optical geometry must normalize to the bounded common layer/feature recipe; arbitrary optical voxel grids requiring a new shader/upload before any representation exists are not admitted to v1. Later schemas require a new minimum-path gate. Uniform/buffer updates for the current frame do not depend on asynchronously prepared detail textures or new material compilation. **Physics acceptance never waits for a chosen rendering rung, detailed GPU cache, viewport or texture upload.** Accept the revision at the recorded step boundary, and draw that revision using the common representation. Prepare detailed assets hidden, validate their revision/time keys, and replace the representation atomically after readiness. Until then the detail status says pending; the renderer never shows the previous revision under the current revision's label. This refines the research's prepare-before-publish wording to keep physics independent of rendering.

A transition is a versioned field between two revisions with recorded start/duration and deterministic interpolation. Discrete events, missing flags and feature identities use explicit rules. Cross-fades between two independent cloud occupancy fields cannot redefine aircraft occupancy. State acceptance includes the full transition definition; it is not a series of slider writes spread across ticks.

### Visible time and bounded presentation

Every frame declares a presentation time. All weather geometry, fog, shafts, shadows and sky light in that frame use that time/revision. During flight it is the driver's interpolated completed time; each actual globe frame samples its current host-mapped time unless the world clock is explicitly frozen. Between frames, the tab shows last-presented time/age; zero weather-only redraw Hz is not a permanent pinned time. Turning evolution off pins the **world clock**, while setting motion redraw Hz to zero only suppresses weather-only frame requests. These are separate controls.

While flying, the host already requests simulation frames; weather is sampled for each shown frame even if its own redraw rate is zero. Do not freeze cloud geometry while the aircraft continues through a moving physical cloud. Reuse visual-detail caches with their declared approximation error, not stale occupancy/light. A maximum visual-state age bounds fallback selection; exceeding it chooses the current simple representation rather than delaying physics.

## Sources, import and privacy

The baseline ships no third-party retrieval. User imports can contain normalized profiles, bounded model slabs, parsed aviation reports or versioned seeded definitions. Imported files never fetch arbitrary referenced URLs automatically. External members require a separate explicit source selection and disclosure.

The format is a versioned manifest plus little-endian float32 array members, explicit axes/units/datums/masks, hashes and source/licence records. An import validates sizes before allocation, finite/range constraints, monotone axes, ZIP/decompression expansion if packaging uses it, and complete required fields. Reject unsupported format versions or contradictory fields atomically with a useful reason.

| Optional source | Implementation path and gate |
| --- | --- |
| Open-Meteo JSON | Candidate small-area/profile adapter, worker normalization; free hosted terms currently restrict noncommercial use and coordinate logs matter. No default adoption before terms and browser tests |
| NOAA GFS/HRRR | Bounded locally prepared subsets initially; later worker GRIB decoding only after template/projection/range/peak-memory tests. HTTP ranges select messages, not geographic cells inside one message |
| AWC reports | Import or manually prepared static snapshots; direct tested API lacks CORS. Proxy is a separately operated service, not GitHub Pages functionality |
| DWD/ECMWF | Candidate import/preparation paths; exact field/product, licence, public endpoint, history and decoder support verified before enabling |
| GIBS/radar | Optional explicitly labelled imagery overlays; not cloud volume, turbulence or aircraft precipitation truth without an independently justified reconstruction |

Requests use `credentials: omit` and suppress referrers where supported. The section names the destination, requested area/time, terms and what it learns; IP/Origin/request paths cannot be made anonymous by these options. Enabling a provider is explicit and persists that choice. No embedded shared key, account creation or operator proxy is part of this draft. Commercial distribution must separately resolve hosted terms and exported-data licences.

Forecast/model run, issue, observation, valid and received times remain separate. Choose complete published runs and retain immutable accepted inputs. Source refresh cannot mix partially available runs into a column. Footprint exit uses the declared outside-footprint policy; forecast-horizon expiry uses outside-valid-time policy. Hold clamps source-valid time for the retained **field** while deterministic features follow their declared lifecycle, evaluated at the current point. A failed refresh simply retains the accepted field; it does not invoke either boundary until coverage actually expires. Policy changes and baseline transitions are recorded events. Refresh failures honour rate limits and bounded backoff; no progress callback asks for a frame. Persistent cache use is explicit, byte-capped and evicts only unreferenced inputs. Accepted revisions hold required inputs independently of cache eviction.

## Aircraft adapter and engine gates

0sfs owns the adapter and reads the shared point sampler immediately before each fixed-step `run`. It uses the current driver generation and position, not the rendering camera. Conversion from SI is centralized and tested. The world keeps ENU; the engine receives NED ft/s. UI wind is meteorological **from**, true north, so a north wind has negative northward velocity.

The adapter starts with mean/resolved wind plus point ambient T/P. Unresolved aircraft turbulence is disabled until its engine gate passes. It does not count the same random gust through both world wind and `gust-*` or built-in turbulence. Authorable coherent gust cells and the engine cosine test pulse are distinct paths.

The active app still steps through `src/flight/physics/fixedStepLoop.ts` with direct SDK access; `FlightModelDriver` exists separately. Implementation must either migrate to the driver or add an equivalent exclusive environment hook at the actual accepted-step boundary. This spec does not assume that migration is already done.

Required sequence:

1. Resolve active driver generation, world revision, time and physical/scene height adapter. Acquire one immutable sampler handle for that step.
2. Sample into fixed storage and validate the requested atmosphere lies within its envelope. On an invalid required sample, evaluate the retained accepted field at the **current position** with its declared valid-time policy, or pause with status; never hold the previous aircraft-point T/P/wind while position changes. If no valid retained field covers the point, pause; never write NaN or invented zero.
3. Write all three wind components and required point ambient inputs in a tested order. Complete this before engine Advance; cancel the entire stale-generation operation, not individual components.
4. Advance once. Read actual engine T/P/density/sound speed/air velocities and status, validate against the input/derived contract, then publish the start-position/time ambient receipt and completed end-step observations with revision/generation. Commit accepted time/events only after validation; keep those two sample times distinguishable.
5. On failed native advance or post-step validation, commit no accepted-step/event receipt or completed observation. Retain last accepted weather time, fault/pause safely, restore declared pre-step ambient before recovery evaluations, and record failure/recovery. Exact stochastic retry is not promised without engine RNG/filter checkpoints.
6. Instruments, autopilot, sound and physical effects consume those completed observations. Rendering may interpolate them; it never writes atmosphere or integrates engine state.

The fork.16 probe established `override/temperature` in absolute °R, `override/pressure` in lbf/ft² and optional `override/density` in slug/ft³; `T-R`, `P-psf`, `rho-slugs_ft3` were getter-only. Reconfirm these in the current artifact. Default is to let JSBSim derive density from consistent T/P/moist composition, not overwrite an inconsistent triple. Humidity setters/filtering and derived gas-constant/sound-speed update order require a dedicated gate; until passed, the default flight policy rejects nonzero canonical q at revision admission. A separately selected dry-air approximation records effective aircraft q=0, derives expected engine density from that effective contract, and displays the difference from canonical moist weather. It must not compare dry engine density to moist canonical density or claim full thermodynamic agreement. A written RH property alone does not qualify coupling.

Remove the current unconditional start-time zeroing of world wind/temperature only when the new initialization order applies the world before initial-condition solving. Initial conditions, warm starts, relocation, recovery and aircraft replacement must sample the correct point before **every** atmosphere-dependent `RunIC`, initialization or trim. Zero-time refreshes do not advance world events or accepted-step receipts; engine turbulence/reset history must be tested rather than assumed. Fork.20 plant staging/restore is separate from Dryden checkpoint support. The world is retained; any required new engine filter state follows the defined aircraft replacement policy and is recorded.

### Turbulence and shear

The research found unsupported type 1, Dryden near-ground height fed from ASL, stale pure-east heading and retained angular turbulence after disabling. Stage 0 rechecks the active build. If still present, patches and native/SDK regression tests belong to JSBSim under [the contribution policy](../../../0sfs/docs/jsbsim-upstream-contribution-policy.md). Do not work around them by falsifying aircraft altitude, inventing heading offsets or switching severity to conceal uncleared state.

After fixes, Dryden Tustin is the proposed first aircraft filter. Admit only tested heights/airspeeds/step rates and expose the named inputs/seed and validation status. “Severity 3” is a model probability curve, not a qualified pilot “moderate” category. A forecast gust does not determine its spectrum. Variance/PSD, transition continuity and seed reproducibility require statistical evidence. Filter histories/RNG are engine state; a weather seed alone cannot checkpoint them.

Spatial wind at the aircraft naturally changes relative airspeed, but one point does not represent finite-wing gradients or prove complete shear derivatives. Use analytic uniform, vertical-gradient, frontal and material-derivative test cases before claims about shear/microbursts. The experiment decides whether extra upstream force/derivative support is necessary. A renderer or provider transition must not introduce unintended impulses.

### Ambient conditions and propulsion

The [installed coupled-plant contract](../../../Felipegalind0/jsbsim/doc/turbine-plant-model.md) now specifies local static and total T/P from FGAtmosphere/FGAuxiliary; it does not read `delta-T`, and corrected speed uses a fixed 288.15 K reference. This settles the F135 input convention, not the SF50 legacy schedule. The plant presently uses a fixed inlet gas mixture; humidity-dependent ingestion/composition is not part of its qualified contract.

Both empirical SF50 and the installed optional F135 plant must read one ambient sample. Local static T/P/composition, density, Mach/air-relative velocity and any deviation from ISA are semantically identified. A point temperature does not automatically update `atmosphere/delta-T`, which the research's empirical FJ33 schedule used. The adapter must not guess a second hot-day correction or feed static temperature as a stagnation temperature.

Before flight adoption, audit the active aircraft XML and plant contract, then run held-out temperature/pressure/altitude/Mach cases. Coordinate any missing engine ambient API upstream; 0sfs supplies world inputs, not a propulsion workaround. Existing calibration remains qualified only over its stated envelope. Nonstandard atmosphere finite outputs are not validation of SF50 takeoff/climb or F135 hardware performance.


## Weather in the sky ladder

Weather state is independent of drawing capability. Keep the existing `sky.model` meanings; this spec extends their responsibilities rather than adding opaque weather quality presets. `sky.model=off` is an explicit visual/debug opt-out: physics and saved weather remain active, and the tab says weather light/visibility are not represented. Clouds never render with arbitrary unlit brightness while the physical sky is off.

| Effective sky rung | Weather held by that rung | Required backend and limitations |
| --- | --- | --- |
| Off | State/flight samples only; existing background/fill retained | All; no claim of displayed weather or physical light |
| Lights | Weather-modified Sun/Moon/sky lux, background and exposure; material-path haze/fog and finite cloud-interior attenuation | WebGL 1/2/WebGPU; no detailed cloud silhouette, status says light/extinction only |
| Dome | Lights plus curved layer upper/lower surfaces and canonical holes; distant cloud coverage and basic in-cloud representation | All; finite layers and common occupancy, no detailed billows |
| Per-pixel, planned sky rung 3 | View-ray atmosphere/weather transport and aerial perspective; depth/froxel integration where supported | WebGL 2/WebGPU; integrate with planned sky transport rather than running two independent fog systems |
| Volume, planned sky rung 4 | Detailed cloud density/scattering, bounded temporal reconstruction and local shadows from common state | WebGPU initial implementation; WebGL 2 fragment path only after explicit qualification, not a prerequisite claim |

The first release implements Lights/Dome weather on all three backends. The spec expands the sky's planned rung 4 to permit a later proven WebGL 2 implementation; it does not claim it exists today or require a Babylon upgrade. Preserve requested and effective representations with a limiting reason. No device-name heuristic silently raises or lowers the rung. A resource limit can choose the selected fallback inside user policy, but cannot change world weather.

### Common cloud representation and visibility

The baseline is a curved layer in physical geographic coordinates with both top and underside. A stable analytic occupancy/density function defines holes and smooth edges. The CPU sample, mesh/material and future volume use it. Intersect camera and light rays with the finite layer interval, including when the camera is inside. Do not draw infinite flat planes, assume the viewer is always below cloud, or make alpha sprites define a different ceiling.

At ground level, bases and distant coverage establish the scene; in cloud, integrated finite extinction and in-scatter remove visual references; above cloud, upper surfaces and Earth occlusion are visible. From orbit, derive coarse coverage/optical-depth tiles or curved shells from the same definition, with Earth occlusion, terminator/light paths and polar/dateline handling. Local billows/particles become subpixel and are culled at a named projected-size threshold. A renderer cache's coarsening error is visible as an approximation status; it cannot quietly alter cloud occupancy sampled by the aircraft.

Local layer tessellation is **per bounded geographic tile**, with explicit extent and measured geometric error. A coarse global shell cannot meet a metre-scale local ceiling: curvature chord sag must be included in the error bound. Keep the canonical analytic ray/entry boundary authoritative; coarse orbital appearance has a separate projected-error declaration.

Use camera-relative GPU coordinates and bounded cell origins derived from CPU float64 world coordinates. Cloud IDs, noise phases and advection remain in stable physical coordinates. Floating-origin translation, world rotation/reflection and camera changes alter transforms, not seeds or feature identities. Every cached geometry/history product carries the source revision, coordinate-adapter and transform identity.

The WebGL 1 baseline applies view-segment extinction in material paths that already have fragment position; it must not depend on a universally available depth texture. Extend imagery, aircraft/glTF, transparent/emissive materials and relevant point-light paths through explicit plugins/interfaces. A later full-screen depth/froxel compositor treats background, opaque, transparent, particles and emitters in an audited order. Built-in scene fog may be an implementation aid only if it meets the same units, finite-layer and luminance checks.

Visibility is a contrast/extinction observation, not a terrain clip distance. Initial authored convention is **total** MOR at the declared reference point/band, with a **5% contrast threshold**, `V = −ln(0.05)/β` for constant extinction; censored METAR visibility remains a bound and prevailing visibility/RVR are not reclassified as MOR. Derive added local extinction as the nonnegative residual after the existing clear-air contribution at that reference; if the requested MOR is clearer than that background permits, report a conflict instead of silently adding another medium or changing the global AOD. Cloud/fog at the reference contributes to the total. Show the inference when using a report to select extinction. Apply heterogeneous optical depth along the actual path; low fog must not dim terrain above its layer as if it filled the planet. Maximum fog/cloud detail distances bound expensive work only: integrate remaining finite-shell optical depth analytically/coarsely beyond them, including orbital limb paths; do not become transparent at a distance cutoff.

### One transport and one exposure

In physical three-band units, integrate `τ = ∫βext ds`, `T = exp(−τ)` and `Lout = T Lin + Lscatter`. For a constant source radiance over a segment, accumulate `T_before × S × (1−T_segment)`, then update cumulative T. Coverage, opacity, optical depth and water content are different quantities. A parameter changed to reduce ray cost must not change canonical extinction.

Direct light at a receiver is clear-air celestial light multiplied by transmittance along that receiver's Sun/Moon path. Diffuse sky/cloud light is an angular radiance integral with a named bounded scattering approximation. Stage 0 establishes an analytic/reference implementation; Stage 2's cheap layer uses it, including an explicitly approximate cloud multiple-scattering closure. Do not dim all incident lux by one Sun-path opacity. A photometric comparison must account for redistributed diffuse light as well as blocked direct light.

Retain separate Sun/Moon terms through transport. The present runtime shows only the brighter body's directional light; choose it **after** weather attenuation. Two independent shadowed directional lights need a separate tested runtime change; they are not assumed by this draft. The meter receives weather-modified incident lux at its viewpoint. Keep `zenithMeteredLux` as the common **clear-air overhead reference** for the current exposure adaptation, so local overcast does not automatically become its own noon reference and compensate away the change.

Preserve Sky's one exposure contract: compute lux/cd/m² physically; normalize by `whiteLuminance` once at each established output writer; apply Babylon/display compensation once afterward; encode once. Do not divide again in a weather compositor or sneak a second tone mapper into cloud materials. In-scatter must be converted to the same scene-linear scale as the attenuated source. The current star-specific exposure policy is preserved, with weather extinction applied to physical star illuminance before its own documented display mapping.

Current clear-air density transport/refraction assumes a global standard atmosphere. The initial weather release explicitly retains this approximation while adding local cloud/aerosol/fog transport and aircraft T/P; local water-vapor absorption and molecular-profile transport are not implied. Stage 0 tests whether local T/P refraction is a bounded separate extension. Do not recolor sky merely because RH changed. Any later molecular-density treatment must preserve the clear reference and avoid double counting existing global aerosol optical depth.

### Ground, lamps and light returned from the ground

Weather lighting is evaluated at each ground point, not by multiplying an orbital globe with the camera's local weather. Split the existing 27-sample terrain **total direct-plus-diffuse** light table before adding directional cloud shadows. Preserve direct Sun, direct Moon and diffuse components; apply each path's weather transport, then form the local total. Ground height semantics remain explicit: current sky values include sea-level ground below the observer; a terrain-altitude refinement must be declared and tested.

Rendered ground probes see already weather-lit terrain. Tag each asynchronous reading with receiver, weather revision/time, transform, white luminance and compensation; discard obsolete readings and unnormalize exactly as the current probe requires. Do not attenuate an already weather-lit reading a second time. Separate approximated cloud-to-ground diffuse transport from a probe feedback loop. Analytic ground-light mode computes from the same local illumination/albedo convention.

Lamp intensity stays in cd. Fog/cloud attenuation of lamp-to-surface and surface/point-to-camera paths is separate from the Sun/Moon path. Runway lights need legible, correctly attenuated points and later optional scatter halos; MOR does not predict RVR without its own lighting/contrast model. `As photographed` imagery remains an explicit appearance mode: it can receive view-path weather, but bypasses physical surface illumination and says so.

### Work and memory accounting

These formulas guide implementation; they are not measured browser budgets. Report actual resident and replacement bytes, preparation work, last costs and qualification conditions in the tab/log.

| Representation | Per shown frame | Per revision/changed region | GPU accounting |
| --- | --- | --- | --- |
| Analytic column/layer light + material extinction | Receiver/path samples and a bounded small number of layer intervals per fragment | Column/illumination coefficients, layer descriptors and invalidated table split | Uniform/descriptors + layer buffers; no required 3D texture |
| Curved layer meshes | Draw/overdraw of selected visible cells, canonical occupancy and finite view/light intervals | Coverage mesh/texture and geographic tiles prepared once per dirty region | Sum vertex/index bytes and `width×height×bytesPerTexel` with mips if present |
| Per-pixel sky/fog | Lookups or `pixels×integrationSamples` | Dirty LUT/froxel cells from the accepted definition | All attachments/froxels, depth, formats, staging and old/new coexistence |
| Volume cloud ray march | Reduced pixels × view samples × density/noise fetches; light samples and reprojection separate | Density/noise/lighting cache generation and bounded dirty region updates | `Nx×Ny×Nz×bytesPerVoxel` per field, all noise levels, histories, depth, light/shadow targets and replacement peak |
| Cloud shadow | Receiver lookup or direct bounded path integration | Directional transmittance map update over selected extent | Shadow dimensions×format×light count; mean/global attenuation is accounted separately |
| Near precipitation | Selected particles/overdraw; analytic position at frame time | Instance/seed buffers when region/definition changes | Instance bytes, sprites/materials; visual count never changes precipitation flux |

Hard admission limits include replacement/staging peaks. Reserve before preparing. If detail cannot fit, keep the current common representation and say why; do not evict canonical data required by accepted physics. Cancellation releases only candidate resources. Cached products with identical input keys are reused, and changing exposure updates values without rebuilding density or shaders.

### Motion, readiness and history

A weather-only redraw timer exists only when enabled, weather is visible, the page is shown and projected change exceeds the user's pixel-error bound or maximum age. `0 Hz` asks for no additional weather frames. Existing flight/camera frames sample current presentation time. State changes, ready visible content and bounded history convergence coalesce with existing requests; hidden work and progress ask for none.

History may request at most the named convergence-frame count after a visible invalidation. Stop when converged or capped. Reject/reproject history correctly on revision/time seek, camera discontinuity, transform change, depth mismatch, large light change and lightning. Noise/history must not leak old weather into a new cloud entry. All passes in one shown frame use a coherent weather time; independent shadow refresh rates are approximations with explicit age/error bounds and current-state fallback.

Do not start a perpetual Babylon loop for clouds. Weather-render timers/listeners/detail workers stop on disposal, hidden/off states and when there is nothing visible to update. World sampling/source lifecycles remain governed independently; sky Off does not stop aircraft weather or an explicitly enabled source. Prepare meshes/materials hidden, use the repository's readiness helper, and swap representations in one task. A detailed cache becoming ready changes the image once; it does not republish the weather revision or restart its events.

## Precipitation, storms and surface hazards

These are extensions, not necessary to declare baseline weather finished.

Rain/snow/hail use one canonical source volume, phase and liquid-equivalent flux. Distant shafts contribute finite extinction; near particles use the same wind/time and a declared fall-speed law. Particle density is a drawing approximation with weight/flux normalization; increasing particle count does not increase rain. Clip particles to cloud-source and terrain boundaries. Snow depth/accumulation and melt require surface history; instantaneous METAR rain cannot set runway contamination. Cockpit exclusion and windshield impacts belong to 0sfs.

A storm cell links cloud, up/down drafts, radial outflow, precipitation and bounded lightning events. Start with authored cells; observations do not supply exact geometry. Lightning positions/times are deterministic, transport joins the common luminance/light model and thunder uses propagation delay. Visible-flash suppression is independent of event/state identity. Do not implement lightning as an unrelated random full-screen white flash.

Thermals/ridge lift require cached physical terrain data and a declared model envelope; mountain waves also require vertical stability and wind. Cells include compensating sink/outflow and finite age, not unbounded vertical cylinders. No terrain fetch/raycast work is added to each physics step. Microburst response passes shear/engine tests before any hazard claim.

Icing potential requires supercooled liquid water, temperature and exposure. Aircraft collection/accretion, geometry, aerodynamic changes and protection require aircraft-specific evidence. A generic drag/lift penalty is only an authored scenario approximation, labelled as such; humidity alone is insufficient. Wet/contaminated contact response needs accumulated depth, material and wheel/load/speed/friction evidence. Engine-law changes go upstream. Leave these responses disabled rather than advertise fidelity from visual frost or rain.

## Instruments, sound and the shared tab

OAT identifies ambient versus total/probe temperature. Altimeter setting is a cockpit/instrument reference in hPa/inHg; it never changes world pressure. IAS/TAS/ground speed and wind display use completed JSBSim air data and declared sensor models. Autopilot truth remains the same engine data, as required by [ArduPilot](../../../0sfs/docs/proposals/ardupilot-sitl.md). No independent weather in SITL or audio.

Keep existing airframe wind sound tied to air data under [Sound](../../../0sfs/docs/sound.md). Environmental wind uses world/surface context, precipitation impacts use relative flux and surface, and thunder uses the shared event. New environmental voices/updates/assets receive explicit caps; do not silently consume the engine audio budget. No audio fidelity is claimed until listening evidence exists.

The shared Weather tab has **World**, **Wind and atmosphere**, **Clouds and visibility**, **Sources and time**, **Motion and resources**, and **Status/provenance** sections. The globe wants them all. 0sfs adds **Aircraft atmosphere/turbulence**, **Instruments**, and later **Hazards**. Provider/source diagnostics show valid/issue time and stale/inferred/coverage flags in plain terms. Hide controls that cannot apply with an explanation in All parameters; preserve requested values when backend support changes.

Controls wrap in the shared paragraph grid and pass unused gestures/keys to the world. Each parameter has one registry owner/home; Sky retains exposure and celestial parameters, Date and time retains scene time, Weather retains weather mapping and resources. Cross-links open those tabs without duplicating their controls. Presets are visible JSON values, copied on application and marked Custom after edits; no branches depend on preset names.


## Parameter catalogue

All values below are **proposed registry defaults**, not measured optimal budgets. Stage 0 may revise them with evidence before code lands; it must update this spec and the registry together. Bounds are valid input envelopes/admission limits, not permission to clamp source physics silently. Backend limits narrow allocation bounds with a displayed reason. Physical constants and unit conversions are named/model-versioned, not user tuning knobs.

### World and source controls (Weather)

| ID / section | Unit or choice, bounds | Default and reason |
| --- | --- | --- |
| `weather.mode` / World | Manual, Seeded, Imported; Live exposed only after source adoption | Manual: offline and explicit |
| `weather.seed` / World | Integer, 0–4,294,967,295 | 0; stable deterministic identity, not random on reload |
| `weather.evolution.rate` / World | Simulated s per host simulated s, 0–10 | 1; 0 pins evolution, changes recorded |
| `weather.time.mapping` / Sources and time | Follow scene, Pinned snapshot | Follow scene for authored definitions; imported defaults Pinned snapshot unless coverage permits follow |
| `weather.time.originUtc` / Sources and time | UTC ISO instant, supported input envelope | Set from host at world creation and saved, not recomputed on reload |
| `weather.coverage.outsideFootprint` / Sources and time | Declared baseline, Pause flight | Declared baseline; selected as state, never cache-driven |
| `weather.sources.networkEnabled` / Sources and time | Boolean | False; destination/terms disclosure precedes enablement |
| `weather.sources.provider` / Sources and time | None and adopted provider IDs | None; no silently selected service |
| `weather.sources.refreshInterval` | s, 60–86,400, further restricted by provider | 900; avoids repeated identical forecast fetches; observation adapter can declare a different exposed value |
| `weather.sources.requestTimeout` | s, 1–120 | 20; bounded pending work |
| `weather.sources.concurrentRequests` | count, 1–8 | 2; bounded service/load concurrency |
| `weather.sources.retryInitial`, `retryMaximum`, `retryAttempts` | s 1–300 / s 10–3,600 / count 0–8 | 30 / 900 / 2; respect Retry-After, retain status rather than storm requests |
| `weather.coverage.outsideValidTime` | Hold field at endpoint, Declared baseline, Pause flight | Hold field at endpoint and mark stale; evaluate at current position, not hold aircraft sample |
| `weather.sources.maximumStaleAge` | s, 0–604,800 | 21,600; status threshold, not forced calm/weather erasure |
| `weather.sources.persistentCache` | Boolean | False; deliberate local storage choice |
| `weather.sources.cacheMiB` | MiB, 0–512 | 32; optional retained source input cache, admitted revisions separately pinned |
| `weather.import.compressedMiB`, `decodedMiB` | MiB, 1–512 / 1–1,024 | 16 / 64; validate before expansion; reject oversized imports without partial publication |
| `weather.import.horizontalNodes`, `verticalLevels`, `timeSlices` | counts/axis 2–256 / count 2–128 / count 1–24 | 64 / 64 / 2; bounded normalization, known axes and selected region |
| `weather.import.fieldCount` | count, 1–64 | 12; cap complete slab width and report unsupported fields |
| `weather.assimilation.radius`, `height`, `transitionSeconds` | km 1–250 / m 100–10,000 / s 0–600 | 50 / 2,000 / 120; explicit correction influence and recorded transitions |
| `weather.world.cpuMiB`, `replacementMiB` | MiB, 1–1,024 / 1–1,024 | 64 / 128; include pinned inputs, workers, old/new overlap and decoder heaps; total cap applies concurrently |
| `weather.prepare.workerCount`, `taskMilliseconds`, `taskCells` | count 0–4 / ms 0.1–20 / cells 1–262,144 | 1 / 4 / 4,096; bounded preparation, cancellation and yield; 0 uses cooperative main-thread preparation |
| `weather.replay.historyMiB`, `revisionCount` / Status/provenance | MiB 1–512 / count 1–1,024 | 32 / 64; bounded canonical world-revision history, included in world CPU peak; aircraft command traces have a separate host cap |
| `weather.replay.onLimit` | Stop recording, Pause before unrecorded input | Stop recording with last-complete-step status; never silently evict history |
| `weather.features.cellSize`, `lifetime` / World | km 1–250 / s 1–86,400 | 25 / 3,600; seeded synthesis scale, affects world physics and is saved |
| `weather.definition.maximumKnots`, `maximumLayers`, `maximumFeaturesPerCell` | count 2–128 / 0–16 / 0–64 | 64 / 8 / 16; reject over-complex authored definitions instead of query-dependent truncation |

A provider's geographic extent/request spacing and the import's region/time window are explicit source parameters with degrees/km and UTC units. The initial offline release makes no request, so no hidden live geographic spacing default is needed. When an adapter is adopted, its interval/region controls and all decoder/template limits must be added before enabling it.

### Authored physical values

Each profile knot/layer/feature has a stable ID. Add/remove controls and indexed parameter descriptors are generated from that definition; every editable quantity is visible with units/bounds. Structured definitions are versioned world data, not one opaque JSON setting. Registry exports can retain selected controls; world export retains complete definitions.

| Quantity | Unit, validated authoring envelope | Default |
| --- | --- | --- |
| Profile knot height and datum | m −1,000–80,000; MSL/ellipsoid/AGL; sorted knots and named reference | Standard column, explicit datum; cloud/flight baseline admitted below 20 km until wider tests |
| Wind components or speed/from display | m/s −150–150 each; kt 0–290; true degrees 0–360 | Zero in the standard column; edit either representation with one canonical vector |
| Temperature knots | K 150–350 (display °C optional) | Common standard profile; values outside admitted aircraft envelope say unqualified |
| Pressure reference | Pa 0.01–120,000 at named height/datum | 101,325 Pa at standard sea level; derived aloft, never independent arbitrary slider per layer |
| Specific humidity | kg/kg 0–0.05 (RH/dew-point alternate inputs converted) | 0; oversaturation needs an explicit condensate model or input rejection |
| Cloud base/top | m −1,000–20,000 in selected datum; top > base | No layers initially; adding one uses authored 1,000–2,000 m MSL and says authored |
| Coverage / cloud optics | fraction 0–1 / extinction m⁻¹ 0–1 / albedo 0–1 / asymmetry −0.99–0.99 | Added layer 0.5 / 0.003 / 0.999 / 0.8 as declared optical approximation; validate photometry before adoption |
| Local haze/fog interval | m −1,000–20,000; extinction m⁻¹ 0–1 | Absent; adds locally to the existing global clear-air model without double counting |
| MOR/contrast convention | m 1–200,000; threshold fraction 0.001–0.5 | No added extinction by default; MOR interpretation threshold 0.05, not recoding a report |
| Precipitation rate / phase | mm/h 0–300; rain/snow/hail/mixed | 0; later stage needs source volume and admitted phase model |

Importer bounds and model envelopes are distinct from editor controls. Do not clamp a real extreme, orbital pressure or observed lower-bound visibility into these defaults and call it the original data. Reject or flag unsupported input and retain its provenance. Feature/hazard descriptors receive a complete parameter catalogue in their adopting stage; they cannot ship with hidden hardcoded sizes, rates or update loops.

### Drawing and light resources (Weather → Motion and resources)

| ID | Unit, bounds | Default and reason |
| --- | --- | --- |
| `weather.motion.redrawHz` | Hz, 0–60 | 0 globe; host flight frames already exist. No extra idle weather loop |
| `weather.motion.pixelError` | px, 0.1–8 | 0.5; projected visible-change threshold |
| `weather.motion.maximumVisibleAge` | s, 0.01–10 | 0.25; current common fallback when detail exceeds age; no override of disabled weather-only redraws |
| `weather.clouds.representation` | Layer; Volume when implemented | Layer; all-backend base and ceiling |
| `weather.clouds.maximumDistance`, `minimumProjectedSize` | km 1–1,000 / px 0.1–16 | 100 / 0.5; local detail bound; coarse global shell remains for orbit |
| `weather.clouds.layerLatitudeSegments`, `layerLongitudeSegments` | count, 8–256 | 32 / 64 per tile; explicit curvature mesh work, never a global shell at these counts |
| `weather.clouds.tileExtent`, `geometricError` | km 1–100 / m 0.1–100 | 25 / 0.5; bound local chord/height error; resource admission can select a labelled coarser orbital path |
| `weather.clouds.coverageDimension` | texels/axis, 16–1,024 | 128; shared-field cache resolution/error shown |
| `weather.clouds.renderScale` | fraction, 0.125–1 | 0.5; volume path quarter pixel count |
| `weather.clouds.raySamples`, `lightSamples`, `stepLength` | count 8–512 / count 0–32 / m 1–2,000 | 64 / 6 / 100; distinct path/work limits; 0 light samples only a named precomputed approximation |
| `weather.clouds.volumeDimension` | voxels/axis, 16–256 | 64; selected format/fields shown with computed bytes |
| `weather.render.gpuMiB`, `replacementMiB` | MiB, 1–512 / 1–1,024, adapter limited | 32 / 64; include all weather resources and peak overlap, not one density volume |
| `weather.clouds.historyFrames`, `convergenceFrames`, `historyDepthTolerance` | frames 0–64 / frames 0–32 / m 0.1–1,000 | 16 / 16 / 10; bound residency/idle convergence and rejection; 0 history disables it |
| `weather.clouds.dirtyVoxelsPerTask` | voxels, 1–262,144 | 4,096; bounded cache preparation |
| `weather.fog.integrationSamples`, `maximumDistance` | count 1–128 / km 0.1–1,000 | 16 / 100; analytic finite intervals preferred in baseline |
| `weather.fog.froxelWidth`, `froxelHeight`, `froxelDepth` | cells, 8–256 / 8–256 / 8–128 | 64 / 36 / 32; planned per-pixel path only |
| `weather.light.angularSamples`, `pathSamples`, `changeThreshold` | count 8–512 / count 2–128 / fraction 0.001–0.2 | 64 / 16 / 0.02; incident diffuse integral/reference cost and visible-light invalidation |
| `weather.shadows.mode` | Canonical analytic path, Local map | Canonical analytic path until local map tested; mean attenuation may only be an explicitly bounded coarse approximation |
| `weather.shadows.dimension`, `extent`, `refreshSeconds` | px 64–2,048 / km 1–500 / s 0.05–60 | 512 / 50 / 0.5; local shadow work separate from global path transport; age/error failure uses current analytic fallback |
| `weather.precipitation.particleCount`, `radius`, `updateHz` | count 0–50,000 / m 1–500 / Hz 0–60 | 0 / 50 / 20; precipitation stage chooses visible count, default spends no particle work |
| `weather.lightning.visibleFlashes` | Boolean | False before storm stage/accessibility choice; suppression does not remove world event identity |

Volume/froxel/history/shadow parameters have no cost until their implementation is selected; the tab lists applicability, requested/effective values and actual resources. New shader variants/attachment formats and workload caps need named choices/limits rather than invisible constant branches. Default values are candidates; no numerical GPU timing promise follows from them. Automatic adjustment is not in the first release. A future controller needs a visible two-thumb allowed range and current value/reason under Settings.

### Aircraft controls (0sfs registry)

| ID / Weather host section | Unit or choice, bounds | Default |
| --- | --- | --- |
| `osfs.weather.turbulenceModel` / Aircraft atmosphere | Off, Dryden Tustin after gate | Off; blocked unsupported selections report reason |
| `osfs.weather.turbulenceSeed` | uint32 | 0; flight-filter seed separate from spatial generator identity |
| `osfs.weather.windAt20Ft` | m/s, 0–75 | 0; Milspec near-ground descriptor, not arbitrary gust forecast mapping |
| `osfs.weather.exceedanceCurve` | named indexed curve 0–7 with meaning shown | 0; noncontinuous categorical input, not quality tier |
| `osfs.weather.altimeterSetting` / Instruments | hPa 800–1,100 (inHg alternate display) | 1,013.25 until pilot chooses report setting; must not set world pressure |
| `osfs.weather.humidityPolicy` / Aircraft atmosphere | Require qualified moisture, Explicit dry-air approximation | Require qualified moisture; nonzero q unavailable until gate passes |
| `osfs.weather.replay.commandHistoryMiB` / Flight replay | MiB, 1–512 | 32; bound aircraft input/event trace bytes separately from shared world inputs |
| `osfs.weather.diagnostics` / Aircraft atmosphere | Boolean | False; when enabled exposes sample/engine differences and status, not per-tick logging by default |

Physics rate and catch-up budget remain in their existing flight settings home. Weather does not introduce a second physics scheduler. Audio and hazards add their own complete resource/physical catalogues only in their adopting stage.

## Saving, replay and migration

Add a `weather` member with its own schema version to the saved-flight record; preserve the existing exclusion of `atmosphere/*` from ordinary engine control properties. The shared world snapshot contains normalized definition/array bytes, source licence records, seed/generator versions, height adapter/surface dependencies, explicit baseline/coverage, clock mappings, accepted revision/transition/event history and content hashes. No credentials, renderer histories or arbitrary mutable URLs serve as required canonical data.

Flight replay also pins installed engine/build identity, aircraft hashes, initial state, timestep epochs, controls, generation changes and every accepted external-input boundary. Scope export to a declared region/time range and show bytes before saving. Canonical world-revision history has a byte/revision cap inside the world CPU/replacement budgets; 0sfs command/event recording has its own host byte cap. The complete replay interval ends at the earliest limit of either record. On its limit, stop recording **before** losing an input and expose the last complete replay step, or use the selected pause policy before accepting an unrecorded boundary. World restore at the current state remains possible. Do not claim a full-session replay after recording stopped, silently evict its required canonical bytes, or pin history without bound. Optional immutable local archival requires an explicit later storage cap/consent and evidence. Required inputs are embedded or retained as locally accessible immutable members; fetching a changed URL during replay is a failure, not a replacement. Validate the whole snapshot before publishing a restored world, then initialize aircraft against it.

Guarantee **same world restore** and **replay over the retained complete interval from a pinned initial state** first. The exported replay range and last-complete step are visible; recording limits do not invalidate a current-world snapshot. Exact mid-flight Dryden continuation is unavailable until filter/RNG checkpointing is implemented and verified. Fork.20's complete plant staging improves that engine's recovery but does not prove universal aircraft resume. A restore that cannot reproduce a required version/terrain/model dependency shows the mismatch and offers a labelled restart; it never quietly upgrades the generator.

Old saves without weather migrate to the clear/calm standard-world baseline and record that absence. The current two-slider wind state has no persistent registry home; migrate only an actually present explicit session value, never invent a saved historical wind. **Clear wind** edits the relevant mean-wind profile to zero; it does not erase temperature, clouds, gusts or the seed. Full reset is a separate World command. Rung/resource/presentation changes do not alter saved physical inputs.

## Stages and acceptance gates

A stage is complete when its code, owner checks, exported boundary and retained evidence pass. Filling a document ledger with “implemented” does not qualify a device or aircraft. Record tests and any failed/deferred gate under top-level `validation/evidence/`; runnable tools live in the owning `scripts/`/tests tree and scratch/logs in `build/`.

| Stage | Deliverable | Gate before proceeding |
| --- | --- | --- |
| 0 — Contract fixtures and feasibility | Isolated state/height/time prototype, normalized import fixtures, current-artifact weather probes, CPU light/extinction reference and bounded renderer fixture | Resolve datum mapping, minimum representation, current atmosphere property order/limitations, intended optical approximation and memory admission. Retain results; settle below-listed experiments/defaults |
| 1 — Offline state and mean aircraft atmosphere | Pure weather package, manual/seeded columns/features, shared tab/registry, exclusive fixed-step adapter, world save/restore plus accepted-command/revision recorder and pinned-initial-state replay | Point/order/time determinism, hydrostatic consistency, generation-safe RunIC/reset and baseline migration; actual installed package regressions; matching weather and aircraft replay traces within declared pinned-runtime tolerances; clear-sky parity |
| 2 — Common clouds, visibility and light | Layer representation on all backends, material-path extinction, local direct/diffuse split, meter/ground/probe integration, no idle motion by default | CPU/reference and rendered-pixel fixtures at all heights/backends, in-cloud agreement, photometric/exposure audit, origin changes, replacement/idle/resource bounds |
| 3 — Validated gust/filter coupling and optional data | Upstream atmosphere/wind corrections where needed; admitted Tustin modes; a separately selected source/import/preparation adapter | Statistical/installed-runtime and aircraft-envelope evidence; browser CORS/terms/privacy/decoder gate; replay accepted source revisions. Neither component blocks the other |
| 4 — Per-pixel transport and detailed cloud option | Planned sky rung 3 integration, optional WebGPU volume/history; separately qualified WebGL 2 volume | Real-GPU backend/device/resolution qualification and bounded history; common state/light fidelity preserved. No minimum-weather dependency on this stage |
| 5 — Precipitation, world sound and surface state | Source-linked shafts/particles, phase/history, optional environmental audio | Flux/source coherence, terrain clip, bounded updates/memory, listening/visual evidence and no unqualified braking response |
| 6 — Selected lift/storm/hazard responses | Individually adopted terrain lift, storm/lightning, icing or contamination | Each has user-selected scope, complete catalogue, independent physical references and aircraft/system validation; omission is an acceptable outcome |

### Stage 0 experiments and required decisions

| Experiment | Run and retain | Settles |
| --- | --- | --- |
| Source/import feasibility | Normalized offline import fixtures first; if an optional provider is selected, chosen static-origin browser requests and worker decode of exact small fields/templates, no-key/failed/stale cases, compressed/decoded/peak bytes and cancellation | Optional direct adapter versus local preparation/proxy, storage packing and caps; no adoption from terminal CORS alone |
| Point/volume/clock fixture | Analytic column/front/shear and moving cloud, repeated query orders, time seeks, fixed-step epochs, CPU/GPU occupancy comparison, raster/Google/geoid/origin cases | World schema/height adapter, interpolation/advection and presentation error rules |
| Installed engine regression | Current package identity plus wind/T/P/moisture/seed/type-off/AGL/east-heading/reset probes; source comparison; analytic air-relative response | Active defects/API semantics, upstream patch scope, adapter writes and admissible flight modes |
| Optical/light fixture | Finite extinction slab and layer under Sun/Moon/night, direct/diffuse reference, visibility, meter, terrain table and probe treatment | Common layer transport/scattering approximation, local pressure/refraction scope, exposure integration |
| Export/lifecycle fixture | Reorder source completion, reset/aircraft change, restore pinned inputs, reject unsupported/corrupt/oversized/missing members | Revision acceptance, generation cancellation, replay promise and fail-safe status |

These experiments are bounded correctness/feasibility work before a large feature build. Device timing budgets require separate authorised measured runs under the repository interference policy. A failed turbulence or live-source gate narrows that optional stage; it does not justify inventing data or delaying offline basic weather.

### Quantitative acceptance, proposed before measurement

The following are engineering targets for implementation tests, not measured results. Report maxima, distributions and scope; adjust a target only with a stated reason and reviewable evidence.

| Contract | Proposed check |
| --- | --- |
| Canonical determinism | Byte-identical serialized revision/sample traces on the same pinned CPU runtime for repeated/randomized query order and renderer/backend/resource changes; record tolerances for cross-runtime floating point |
| Units and analytic atmosphere | Conversion round trips ≤1e−9 relative in double precision; analytic constant-T hydrostatic pressure/density ≤1e−6 relative; independent standard-profile fixtures with source precision retained |
| Cloud agreement | Analytic CPU and minimum-renderer entry/base/top within 1 m in the admitted local baseline envelope after datum conversion and tile geometric-error checks; coarse orbital geometry has a declared projected/error bound; detailed visual cache occupancy error ≤0.01 fraction away from declared discontinuities; never promise sharper than source/terrain uncertainty |
| Analytic extinction | Transmittance ≤1e−6 absolute CPU error for homogeneous slabs; shader/reference ≤1% relative or 1e−4 absolute near zero, report band/path/height |
| Light/exposure plumbing | With weather absent, existing sky fixtures within their retained tolerances; controlled weather lux/luminance within 2% of the chosen CPU reference and EV within 0.03, excluding explicitly bounded scattering approximation error |
| No double exposure | Fixed physical emitter under fixed weather, independent compensation/white tests; ratios follow sky contract exactly within pixel precision |
| State/time publication | No callback to retired world/driver generation; no partially updated ambient triple; repeated zero-time reads/RunIC do not advance weather/event receipts; accepted timeline restored identically |
| Resource/idle behaviour | No cap exceeded including staging/replacement; zero weather-render-only frames/work/timers after bounded visible convergence with extra motion disabled or hidden/off disposal; convergence never exceeds named frame limit |
| Invalid source/input | No NaN write, unsolicited fallback or automatic arbitrary URL; oversized/corrupt/unsupported input rejected before publication; stale/missing status retained |

Statistical turbulence acceptance is specified from the documented spectrum after upstream fixes, with confidence intervals/sample length and reference envelope chosen before collecting traces. Aircraft performance tolerances come from the existing aircraft calibration/held-out reference policy, not the generic table. GPU timings have no default acceptance value until device/resolution/interference conditions are available.

### Images, devices and flight evidence

The rendered fixture matrix covers runway, cloud entry/interior/exit, above cloud and **20,000 km**; clear/overcast/fog, daylight/twilight/Moon/night; poles/dateline/Earth limb; origin translation/rotation/reflection; Sun/Moon dominance after attenuation; ground lamps through fog; glTF/imagery/transparent/emissive materials; exposure compensation; stale ground probe; state changes during preparation; context/resource loss; and all three backends. Report requested/effective capability and physical approximation in each fixture.

Software-rendered pixels are regression evidence only. Real-GPU qualification names adapter/backend, device, browser, viewport and output/render resolutions, samples, source conditions, memory residency/peaks, idle/animated frames, CPU/GPU costs and interference/thermal qualifications. No result from below a cloud qualifies orbit; no WebGPU result qualifies WebGL 1. Listening and user flight reviews are separate, reproducible when possible and explicit when subjective.

JSBSim response tests include steady vector wind, smooth/deliberate shear, coordinate axes, zero/tiny speed, profile changes, temperature/pressure/humidity, sea-level/high terrain AGL, generation overlap, resets/teleport/trim, paused/rejected steps and admitted timestep changes. Validate SF50 empirical and F135 plant separately. Engine finite values are a functional result; they are not independent evidence of hot-day takeoff, icing or braking fidelity.

## Implementation map and execution limits

Suggested FOSS Earth areas are `src/weather/` for the pure model/import/state, a settings catalogue owned here, shared shell panel, and renderer modules consumed by `createSkyRuntime`. Extend `src/sky/skyState.ts` for weather-modified illumination/reference transport, `imagery/terrainLightPlugin.ts` for split per-point light/view-path weather, and `createGroundLightProbe.ts` for tagged readings. Runtime frame preparation supplies a coherent weather sample before sky light/exposure updates. These paths are planning guidance; establish public exports before 0sfs consumes them.

In 0sfs, the composition root mounts the shared tab and owns flight weather lifecycle; the native step boundary and `flightModelDriver`/recovery paths take an explicit environment command; saved-flight and instruments consume the new record/observations. No FOSS Earth module imports JSBSim or an aircraft. Native defects/ambient/checkpoint APIs remain in JSBSim and follow its upstream process, build identity and tarball adoption gate.

For each implementation stage, run related owner tests/typecheck/lint, then the completed owners' full CI once under their AGENTS rules. Documentation drafting needs no application tests/build. Do not start a dev/preview/watch server, visible browser, native/WASM build or GPU benchmark merely to write or review this draft. Later execution obtains the task's authorization for those runs and uses existing terminal/headless harnesses. No commit/push is part of this drafting task.

## Risks, declared approximations and completion record

The live-source terms, exact browser decoder/template coverage, source archives and real-device costs remain adoption gates. Terrain height conventions and the uncommitted sky can change during implementation; recheck their identities first. A pipeline that renders detailed cloud billows without the shared field, source/clock/save contracts or usable low rungs does not satisfy this spec.

The initial limitations are deliberate: authored/seeded inference rather than observed local truth; standard clear molecular atmosphere/refraction; bounded optical cloud scattering rather than full moist meteorology; unresolved aircraft turbulence/hazards disabled until qualified; no promise of exact mid-flight filter resume. Show the relevant limitation near its mode, without scattering implementation jargon through ordinary controls.

Maintain an implementation ledger when work starts, with stage, source/package identities, owner files, passed/failed evidence links, physical envelope, backend/device status and remaining gate. This draft has **no completed stages**. Completion of the first release means Stages 0–2 and their baseline gates are met, with optional Stage 3 features either qualified or visibly unavailable. Stages 4–6 are not silently required to finish basic weather.

## References

The primary-source findings, request headers, installed fork.16 probes, implementation licences and external-report corrections are retained in [weather research](research/weather-research.md). Provider facts in that document were read on 2026-10-08 and must be rechecked at adoption. This specification's choices/tolerances are engineering requirements, not findings attributed to those sources.

Local contracts read for drafting on 2026-10-08: [FOSS Earth AGENTS](../../AGENTS.md), [0sfs AGENTS](../../../0sfs/AGENTS.md), [Sky](sky.md), [Settings](settings.md), [render on demand](../render-on-demand.md), [streamed terrain](../streamed-terrain.md), [geoid helper](../../src/terrain/geoid.ts), [SF50 lifecycle/calibration](../../../0sfs/docs/proposals/sf50-flight-model-v2.md), [engine plant spec](../../../0sfs/docs/proposals/engine-plant-implementation.md), [native plant ambient contract](../../../Felipegalind0/jsbsim/doc/turbine-plant-model.md), [JSBSim adoption](../../../0sfs/docs/jsbsim.md), [upstream policy](../../../0sfs/docs/jsbsim-upstream-contribution-policy.md), [Sound](../../../0sfs/docs/sound.md) and [ArduPilot](../../../0sfs/docs/proposals/ardupilot-sitl.md).
