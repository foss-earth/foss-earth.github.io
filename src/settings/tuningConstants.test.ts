import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FOSS_EARTH_PARAMETERS } from "./catalogue";

/**
 * Every number the source names or gives as a default, and why it is not a
 * parameter, so a new tuning constant cannot hide outside the registry. The
 * scan finds:
 *
 * - `const NAME = …` with a number in it, at any depth (`file#NAME`);
 * - `?? n` and `|| n` defaults (`file@left ?? n`);
 * - function and destructuring defaults (`file@name = n`),
 *
 * where n is a constant other than 0, 1 and -1, which stand for "none". It
 * leaves out src/settings/, where tuning values belong, and tests. A number
 * written inline in an expression is out of its reach: name it.
 */
type Kind =
  /** The default or a bound of this parameter, or what it falls back to where a caller passes none. */
  | "parameter"
  /** Physical and mathematical constants, file and tile formats, and sources' own descriptions. */
  | "fact"
  /** The shape of an algorithm, not a trade-off: a grid, a root level, a sort key. */
  | "structure"
  /** Tolerances and filters against float error, jitter and stalls; at any sensible value the user sees no difference. */
  | "guard"
  /** Where panels and overlays sit and how they look. */
  | "layout"
  /** A default for an argument a host passes in code, which the host decides and may make its own parameter. */
  | "host"
  /** Debugging and measurement tools', not the map's. */
  | "tool";

const LEDGER: Record<string, [Kind, string]> = {
  "src/airports/geometry.ts#EARTH_RADIUS": ["fact", "The mean Earth radius, for great-circle distances."],
  "src/airports/geometry.ts#RAD": ["fact", "Degrees to radians."],
  "src/app/createGlobeApp.ts#PERFORMANCE_METRIC_DEFINITIONS": ["layout", "How the performance HUD formats each reading: its digits and units."],
  "src/app/createGlobeApp.ts#POI_EXIT_BTN_OFFSET_PX": ["layout", "Where the leave-orbit button sits beside a point of interest."],
  "src/camera/anchorPan.ts#ANCHOR_PAN_CHASE": ["guard", "How the grab-pan solver closes the last pixels between the grabbed point and the cursor; the point follows the cursor either way."],
  "src/camera/cameraLimits.ts#DEFAULT_GROUND_FOLLOW": ["parameter", "camera.surfaceFollowSpeed"],
  "src/camera/cameraLimits.ts#MAX_PITCH_DEG": ["parameter", "camera.pitchLimits"],
  "src/camera/cameraLimits.ts#MAX_ZOOM_METERS": ["parameter", "camera.zoomLimits"],
  "src/camera/cameraLimits.ts#MIN_PITCH_DEG": ["parameter", "camera.pitchLimits"],
  "src/camera/cameraLimits.ts#MIN_ZOOM_METERS": ["parameter", "camera.zoomLimits"],
  "src/camera/cameraMath.ts#COMMIT_THRESHOLD_PX": ["guard", "The two-finger classifier: how far fingers move before a gesture counts as a pinch or a pan."],
  "src/camera/cameraMath.ts#DEG_TO_RAD": ["fact", "Degrees to radians."],
  "src/camera/cameraMath.ts#DOMINANCE_RATIO": ["guard", "The two-finger classifier: how much one movement must dominate the other to decide the gesture."],
  "src/camera/cameraMath.ts#N": ["fact", "WGS84's prime vertical radius of curvature."],
  "src/camera/cameraMath.ts#RAD_TO_DEG": ["fact", "Radians to degrees."],
  "src/camera/cameraMath.ts#WGS84_A": ["fact", "WGS84's semi-major axis."],
  "src/camera/cameraMath.ts#WGS84_B": ["fact", "WGS84's semi-minor axis."],
  "src/camera/cameraMath.ts#WGS84_E2": ["fact", "WGS84's first eccentricity squared."],
  "src/camera/cameraMath.ts#WGS84_EP2": ["fact", "WGS84's second eccentricity squared."],
  "src/camera/cameraMath.ts#WGS84_F": ["fact", "WGS84's flattening."],
  "src/camera/cameraMath.ts@singleTouchPinchDistanceThresholdPx = 24": ["guard", "The two-finger classifier: the spread change a one-finger-still pinch needs."],
  "src/camera/cameraState.ts#DEADZONE_DEG": ["guard", "Orbit steps smaller than this are noise in a gesture stream, and would only redraw the map."],
  "src/camera/cameraState.ts#MAX_ORBIT_HEIGHT_SMOOTHING_DELTA_MS": ["guard", "Caps the time step after a stalled frame, so the orbit target does not jump."],
  "src/camera/cameraState.ts@(this.camera as unknown as { fov: number }).fov ?? 0.8": ["parameter", "camera.fieldOfView"],
  "src/engine/babylon/createBabylonRuntime.ts#DEFAULT_CAMERA_ALTITUDE_METERS": ["host", "The start view when the host gives none."],
  "src/engine/babylon/createBabylonRuntime.ts#DEFAULT_CAMERA_LAT_DEG": ["host", "The start view when the host gives none."],
  "src/engine/babylon/navigationLease.ts#NAVIGATION_PRESENTATION_LAYER": ["structure", "A layer bit no other mesh uses, which the globe camera draws alone while a lease presents its own view."],
  "src/engine/babylon/createBabylonRuntime.ts#DEFAULT_CAMERA_LON_DEG": ["host", "The start view when the host gives none."],
  "src/engine/babylon/createBabylonRuntime.ts#DEFAULT_CAMERA_PITCH_RAD": ["host", "The start view when the host gives none."],
  "src/engine/babylon/createBabylonRuntime.ts#DEFAULT_CAMERA_YAW_RAD": ["host", "The start view when the host gives none."],
  "src/engine/babylon/createBabylonRuntime.ts#DEFAULT_FALLBACK_BACKGROUND": ["layout", "The colour behind the globe."],
  "src/engine/babylon/createBabylonRuntime.ts#DEFAULT_GOOGLE_BACKGROUND": ["layout", "The colour behind the globe on Google 3D Tiles."],
  "src/engine/babylon/createBabylonRuntime.ts#PLANET_RADIUS_METERS": ["fact", "WGS84's semi-major axis, Babylon's planet radius."],
  "src/engine/babylon/createBabylonRuntime.ts@request.clearanceMeters ?? 1000": ["host", "Defaults of a terrain readiness request, which the host makes."],
  "src/engine/babylon/createBabylonRuntime.ts@request.radiusMeters ?? 1000": ["host", "Defaults of a terrain readiness request, which the host makes."],
  "src/engine/babylon/createBabylonRuntime.ts@request.timeoutMs ?? 120_000": ["host", "Defaults of a terrain readiness request, which the host makes."],
  "src/engine/babylon/createRasterTilesRuntime.ts#DEFAULT_TILE_SEGMENTS": ["parameter", "map.terrain.tileSegments"],
  "src/engine/babylon/createRasterTilesRuntime.ts@limits.maxZoom ?? 18": ["fact", "The deepest level of the XYZ convention, for a source that does not give its own."],
  "src/engine/babylon/createRendererMode.ts@reference.clientHeight || reference.height || 150": ["fact", "An HTML canvas's size before layout."],
  "src/engine/babylon/createRendererMode.ts@reference.clientWidth || reference.width || 300": ["fact", "An HTML canvas's size before layout."],
  "src/engine/babylon/createTilesRuntime.ts#MAX_TERRAIN_ERROR_TARGET": ["parameter", "map.detail.google.range"],
  "src/engine/babylon/createTilesRuntime.ts#MIN_TERRAIN_ERROR_TARGET": ["parameter", "map.detail.google.range"],
  "src/engine/babylon/imagery/createImageryRuntime.ts#COVERAGE_PRIORITY": ["structure", "Sorts the always-resident coverage tiles ahead of every other request."],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#BYTES_PER_TEXEL": ["fact", "RGBA8: four bytes a texel."],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#IMAGERY_GUTTER": ["structure", "The border each atlas slot keeps, sized so filtering at the deepest sampled mip never reads a neighbour."],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#IMAGERY_MAX_SAMPLED_LOD": ["structure", "The deepest mip level the shader samples, which the gutter is sized for."],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#IMAGERY_PAGE_SIZE": ["fact", "Map tiles are 256 pixels square."],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#IMAGERY_SLOT_SIZE": ["structure", "A page and its gutter on both sides."],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#IMAGERY_TABLE_BLOCK": ["structure", "The page table's allocation block, in cells."],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#IMAGERY_TABLE_MAX_CELLS_LOG2": ["parameter", "map.imagery.pageTableDepth"],
  "src/engine/babylon/imagery/imageryAtlasLayout.ts#MIP_CHAIN_FACTOR": ["fact", "A full mip chain adds a third to a texture."],
  "src/engine/babylon/imagery/imageryMaterialPlugin.ts#CONSTANTS": ["structure", "The atlas layout, copied into the shader."],
  "src/engine/babylon/imagery/imageryMaterialPlugin.ts#MAX_TEXELS_PER_PIXEL": ["structure", "Follows from the deepest sampled mip level."],
  "src/engine/babylon/panorama/panoramaRenderer.ts#NEAR_PLANE_WITHOUT_CAMERA": ["fact", "Babylon's default near plane, for a scene with no camera."],
  "src/engine/babylon/rasterBaseMaps.ts#RASTER_BASE_MAP_SOURCES": ["fact", "Each basemap's own description: address, zoom range and attribution."],
  "src/engine/babylon/webgpuPresentationProbe.ts#PRESENTATION_ERROR_SETTLE_MS": ["guard", "How long the start-up check for a WebGPU canvas that never presents waits for an error."],
  "src/engine/babylon/webgpuPresentationProbe.ts#PRESENTATION_ERROR_SETTLE_RAF_COUNT": ["guard", "How many frames the start-up check for a WebGPU canvas that never presents waits for an error."],
  "src/engine/babylon/webgpuPresentationProbe.ts#PRESENTATION_PROBE_FRAMES": ["guard", "How many frames the start-up check for a WebGPU canvas that never presents draws."],
  "src/hud/inputModeHud.ts#DELTA_EPSILON": ["guard", "Wheel deltas smaller than this are noise when telling a mouse from a trackpad."],
  "src/hud/poiSpriteSizeTuner.ts#DEFAULT_POI_SPRITE_SIZE_PARAMS": ["parameter", "visualization.poiSprite.maxSize"],
  "src/input/globeNavigation.ts#DEFAULT_GLOBE_STICK_DEADZONE": ["parameter", "input.gamepad.deadzone"],
  "src/input/globeNavigation.ts#GLOBE_GAMEPAD_ACTIONS": ["structure", "The navigation actions' axis ranges, -1 to 1."],
  "src/input/globeNavigation.ts#PANORAMA_GAMEPAD_ACTIONS": ["structure", "The panorama actions' axis ranges, -1 to 1."],
  "src/input/inertialCameraController.ts#DEFAULT_INERTIA_DECAY_PER_FRAME": ["parameter", "camera.inertiaDecay"],
  "src/input/inertialCameraController.ts#FRAME_MS": ["fact", "The 60 Hz frame camera.inertiaDecay is given per."],
  "src/input/inertialCameraController.ts#MAX_ORBIT_DELTA_PER_FRAME_DEG": ["guard", "Caps one frame of glide, so one spike in pointer speed cannot fling the view; the glide is camera.inertiaDecay."],
  "src/input/inertialCameraController.ts#MAX_PAN_DELTA_PER_FRAME_PX": ["guard", "Caps one frame of glide, so one spike in pointer speed cannot fling the view; the glide is camera.inertiaDecay."],
  "src/input/inertialCameraController.ts#MAX_ZOOM_LOG_DELTA_PER_FRAME": ["guard", "Caps one frame of glide, so one spike in pointer speed cannot fling the view; the glide is camera.inertiaDecay."],
  "src/input/inertialCameraController.ts#STOP_EPSILON_DEG": ["guard", "A glide slower than this has stopped."],
  "src/input/inertialCameraController.ts#STOP_EPSILON_PX": ["guard", "A glide slower than this has stopped."],
  "src/input/inertialCameraController.ts#STOP_EPSILON_ZOOM_LOG": ["guard", "A glide slower than this has stopped."],
  "src/input/inputRates.ts#DEFAULT_INPUT_RATES": ["parameter", "input.mouse.orbitRate"],
  "src/input/inputSettings.ts#DEFAULT_INPUT_SENSITIVITY": ["parameter", "input.sensitivity.mouse.pan"],
  "src/input/touchController.ts#ORBIT_ACTIVATION_PX": ["guard", "The touch recognizer: how far two fingers move together before the gesture is an orbit."],
  "src/input/touchController.ts#TOUCH_MAX_DELTA_PX": ["guard", "The touch recognizer: a jump larger than this between two events is a lost touch, not a movement."],
  "src/input/touchController.ts#TOUCH_MAX_ZOOM_DELTA_PX": ["guard", "The touch recognizer: a spread change larger than this between two events is a lost touch, not a pinch."],
  "src/input/touchController.ts#TOUCH_PAN_DEADZONE_PX": ["guard", "The touch recognizer: movement smaller than this is a finger's tremor."],
  "src/input/touchController.ts#ZOOM_ACTIVATION_LOG": ["guard", "The touch recognizer: how much the spread changes before the gesture is a pinch."],
  "src/input/touchDebugOverlay.ts#MAX_LOG_ENTRIES": ["tool", "The touch debugging overlay's history."],
  "src/input/wheelController.ts#FRACTIONAL_DELTA_EPSILON": ["guard", "Wheel deltas smaller than this are noise."],
  "src/input/wheelController.ts#WHEEL_GESTURE_IDLE_MS": ["guard", "The pause that ends one wheel gesture, so the next is classified afresh."],
  "src/log/createGameLog.ts#GAME_LOG_FADE_MS": ["layout", "How long a log line takes to fade out."],
  "src/log/createGameLog.ts#MIN_HEIGHT": ["layout", "The log panel's smallest size."],
  "src/log/createGameLog.ts#MIN_WIDTH": ["layout", "The log panel's smallest size."],
  "src/log/createGameLog.ts#PREVIEW_CHARS": ["layout", "How much of a line the collapsed log shows."],
  "src/log/createGameLog.ts#RESIZE_CLICK_PX": ["layout", "How far a press on the resize edge moves before it resizes."],
  "src/log/fitLogResize.ts#LOG_DOCK_GAP": ["layout", "The gap between the log and the dock."],
  "src/log/gameLogDefaults.ts#GAME_LOG_LINE_MS": ["parameter", "interface.log.lineDuration"],
  "src/log/gameLogDefaults.ts#GAME_LOG_MAX_LINES": ["parameter", "interface.log.maxLines"],
  "src/perf/culling.ts#HORIZON_MARGIN": ["guard", "Keeps a marker just past the horizon drawn, so none pops at the edge."],
  "src/perf/frameProfiler.ts#DEFAULT_WINDOW_FRAMES": ["tool", "The frame profiler's window before an app configures it from renderer.profiling.windowFrames."],
  "src/perf/frameProfiler.ts#TRACE_ENTRY_BYTES": ["fact", "A traced section or tag holds a name reference and a float64."],
  "src/perf/frameProfiler.ts#TRACE_FRAME_BYTES": ["fact", "A traced frame holds three float64s: its index, end and interval."],
  "src/perf/metrics.ts#FRAME_SAMPLE_COUNT": ["tool", "The performance HUD's average: the last 120 frames."],
  "src/scenes/budget.ts#BYTES_PER_TEXEL": ["fact", "RGBA8 stores four bytes a texel."],
  "src/scenes/budget.ts#CUBE_LAYERS": ["fact", "A cube has six faces."],
  "src/scenes/budget.ts#MIB": ["fact", "Bytes in a mebibyte."],
  "src/scenes/format.ts#SCENE_FORMAT_VERSION": ["fact", "The version of the scene format this loader reads."],
  "src/scenes/panoramaInput.ts#INERTIA_STOP_DEG_PER_S": ["guard", "A look glide slower than this has stopped."],
  "src/scenes/panoramaInput.ts#PINCH_WHEEL_PX_PER_LOG_SCALE": ["fact", "Browsers report a trackpad pinch as ctrl+wheel with deltaY = -100 ln(scale); `pinchGain` applies to the scale."],
  "src/scenes/panoramaInput.ts#WHEEL_LINE_PX": ["structure", "How a wheel reporting lines is counted in pixels, so every wheel zooms by notches alike."],
  "src/scenes/panoramaInput.ts#WHEEL_NOTCH_PX": ["fact", "Browsers report one wheel notch as 100 CSS px; `zoomPerNotch` is per notch."],
  "src/scenes/panoramaMath.ts#GPU_CUBE_LAYERS": ["fact", "WebGPU's cube face selection table."],
  "src/scenes/panoramaMath.ts#SOURCE_CUBE_FACES": ["fact", "The scene format's cube face table."],
  "src/scenes/panoramaMath.ts#VIEWPORT_CORNERS": ["structure", "The four corners of the view, whose rays decide whether a panorama fills it."],
  "src/scenes/panoramaMath.ts@margin = 1e-4": ["guard", "Keeps the expanded orb just past the corners' rays against float error."],
  "src/scenes/validateScene.ts#DEFAULT_LIMITS": ["parameter", "scene.manifestMiB"],
  "src/scenes/validateScene.ts#HOVER_SCALE": ["fact", "The scene format's bounds on an orb's hover growth, docs/scenes/format.md."],
  "src/scenes/validateScene.ts#OUTLINE_WIDTH_PX": ["fact", "The scene format's bounds on an orb outline's width, docs/scenes/format.md."],
  "src/search/locationSearch.ts#GEOCODER_INTERVAL_MS": ["fact", "The public geocoder's usage policy: at most one request a second."],
  "src/search/searchDefaults.ts#SEARCH_DEFAULTS": ["parameter", "search.cacheDuration"],
  "src/shell/WindowOverlay.tsx#DEFAULT_LOCATION": ["host", "Where the location panel starts when the host gives nothing."],
  "src/shell/WindowOverlay.tsx@workspace.state.primary.width ?? 320": ["layout", "A dock slot's width before it is measured."],
  "src/shell/WindowOverlay.tsx@workspace.state.secondary.width ?? 320": ["layout", "A dock slot's width before it is measured."],
  "src/shell/dockLayout.ts#GAP": ["layout", "The gap between docked panels."],
  "src/shell/dockLayout.ts#MIN_DOCK_WIDTH": ["layout", "A docked panel's smallest width."],
  "src/shell/frameBudgetPanel.ts#BYTES_PER_KIB": ["fact", "A KiB is 1024 bytes."],
  "src/shell/frameBudgetPanel.ts#EDGE_PX": ["layout", "The frame budget table's row inset."],
  "src/shell/frameBudgetPanel.ts#INDENT_PX": ["layout", "The frame budget table's indent per nesting level."],
  "src/shell/dockLayout.ts#MIN_LOG_WIDTH": ["layout", "The docked log's smallest width."],
  "src/shell/dockLayout.ts@input.logWidth ?? 560": ["layout", "The docked log's width before the user resizes it."],
  "src/shell/settings/controls.ts@spec.step ?? 0.05": ["layout", "A log-scale slider's step when its parameter gives none: a twentieth of a doubling."],
  "src/shell/settings/track.ts#DETAIL_COLOURS": ["layout", "The detail track's colours, fine to coarse."],
  "src/shell/viewportInsets.ts#MAX_INSET_FRACTION": ["layout", "The most of the view a panel may cover before the globe stops making room for it."],
  "src/shell/viewportInsets.ts#MAX_INSET_PX": ["layout", "The most of the view a panel may cover before the globe stops making room for it."],
  "src/shell/viewportInsets.ts#SCALE_TOLERANCE": ["guard", "Changes in the page's scale smaller than this are rounding."],
  "src/sprites/positioning.ts#DEFAULT_POI_HEIGHT_REFINEMENT_MAX_ZOOM_M": ["host", "A default for a helper's argument; the caller passes its own."],
  "src/sprites/positioning.ts#DEFAULT_POI_HEIGHT_REFINEMENT_PROBE_DOWN_M": ["host", "A default for a helper's argument; the caller passes its own."],
  "src/sprites/positioning.ts#DEFAULT_POI_HEIGHT_REFINEMENT_PROBE_UP_M": ["host", "A default for a helper's argument; the caller passes its own."],
  "src/sprites/types.ts#DEFAULT_DOT_TEXTURE_SIZE": ["layout", "The resolution a marker dot is drawn at in the sprite atlas."],
  "src/sprites/types.ts#DEFAULT_SPRITE_CAPACITY": ["host", "A floor under the room a caller of createPointSpriteManager asks for; nothing in FOSS Earth or 0sfs creates one."],
  "src/sprites/types.ts#EARTH_RADIUS_METERS": ["fact", "The mean Earth radius."],
  "src/terrain/anchorHeight.ts#DEFAULT_CELL_SIZE_DEG": ["structure", "Groups height lookups into cells about 200 m across, so a miss is retried per cell."],
  "src/terrain/anchorHeight.ts#MAX_SMOOTHING_DELTA_MS": ["guard", "Caps the time step after a stalled frame, so the anchor does not jump."],
  "src/terrain/globalTerrain.ts#GLOBAL_TERRAIN": ["fact", "A baked 64 by 64 grid of the world's heights."],
  "src/terrain/imagery/imageryGeometry.ts#DEG": ["fact", "Degrees to radians."],
  "src/terrain/imagery/imageryGeometry.ts#WEB_MERCATOR_MAX_LAT_DEG": ["fact", "Web Mercator's latitude limit."],
  "src/terrain/imagery/imageryGeometry.ts@columns = 5": ["structure", "The grid of screen rays that finds the ground a view covers."],
  "src/terrain/imagery/imageryGeometry.ts@rows = 3": ["structure", "The grid of screen rays that finds the ground a view covers."],
  "src/terrain/imagery/imagerySelector.ts#GRID": ["structure", "The points on a tile its projected size is measured at."],
  "src/terrain/imagery/imagerySelector.ts#IMAGERY_SELECTION_CONSTANTS": ["structure", "The traversal's root level and the widest tile horizon rejection is trusted for."],
  "src/terrain/imagery/imagerySelector.ts#QUADS": ["structure", "The four quarters of the measuring grid."],
  "src/terrain/imagery/imagerySelector.ts#SLOPE_STEP": ["structure", "The step a tile's slope is measured over."],
  "src/terrain/imagery/imagerySelector.ts#STANDARD_PAGE_SIZE": ["fact", "Map tiles are 256 pixels square."],
  "src/terrain/imagery/imagerySources.ts#PAGE": ["fact", "Map tiles are 256 pixels square."],
  "src/terrain/imagery/imagerySources.ts@descriptor.maxZoom ?? 18": ["fact", "The deepest level of the XYZ convention, for a source that does not give its own."],
  "src/terrain/imagery/imageryTestViews.ts@options.far ?? 5e7": ["tool", "The imagery tests' standard views."],
  "src/terrain/imagery/imageryTestViews.ts@options.fovYDeg ?? 60": ["tool", "The imagery tests' standard views."],
  "src/terrain/imagery/imageryTestViews.ts@options.renderHeight ?? 720": ["tool", "The imagery tests' standard views."],
  "src/terrain/imagery/imageryTestViews.ts@options.renderWidth ?? 1280": ["tool", "The imagery tests' standard views."],
  "src/terrain/mapDetailPolicy.ts#DEFAULT_GOOGLE_DETAIL_POLICY": ["parameter", "map.detail.google.range"],
  "src/terrain/mapDetailPolicy.ts#GOOGLE_DETAIL_STEP": ["parameter", "map.detail.google.range"],
  "src/terrain/mapDetailPolicy.ts#GOOGLE_ERROR_TARGET_BOUNDS": ["parameter", "map.detail.google.range"],
  "src/terrain/mapDetailPolicy.ts#RASTER_DETAIL_ENVELOPE": ["parameter", "map.detail.imagery.range"],
  "src/terrain/mapDetailPolicy.ts#RASTER_DETAIL_STEP": ["parameter", "map.detail.imagery.range"],
  "src/terrain/mapDetailPolicy.ts@hints.hardwareConcurrency ?? 4": ["parameter", "map.detail.google.default"],
  "src/terrain/meshRefinement.ts@duration = 1200": ["host", "A default for a helper's argument; nothing in the runtime morphs meshes with it."],
  "src/terrain/rasterSurfaceSampler.ts#EDGE_EPSILON": ["guard", "Keeps a sample on a tile's edge inside the tile."],
  "src/terrain/rasterSurfaceSampler.ts#MAX_LAT": ["fact", "Web Mercator's latitude limit."],
  "src/terrain/retryDelay.ts#DEFAULT_RETRY_DELAY_MS": ["parameter", "map.retryDelay"],
  "src/terrain/smoothElevation.ts#DEFAULT_MAX_HEIGHT_METERS": ["fact", "The smooth elevation model's range."],
  "src/terrain/smoothElevation.ts#DEFAULT_MIN_HEIGHT_METERS": ["fact", "The smooth elevation model's range."],
  "src/terrain/smoothElevationCoefficients.ts#SMOOTH_ELEVATION_FEATURES": ["fact", "The smooth elevation model's data."],
  "src/terrain/terrainPerformanceCapture.ts@capacity = 3600": ["tool", "The terrain performance capture's length, in frames."],
  "src/terrain/terrainReadiness.ts#TERRAIN_CONTACT_IRRELEVANT_AGL_METERS": ["host", "The terrain readiness check a host asks for: above this height a missing sample cannot matter."],
  "src/terrain/terrainReadiness.ts@options.clearanceMeters ?? 1000": ["host", "Defaults of a terrain readiness request, which the host makes."],
  "src/terrain/terrainSelector.ts#GRID": ["structure", "The points on a tile its projected error is measured at."],
  "src/terrain/terrainSelector.ts#TERRAIN_SELECTION_CONSTANTS": ["structure", "The traversal's root level and the widest tile horizon rejection is trusted for."],
  "src/terrain/terrainSelector.ts#WGS84_A": ["fact", "WGS84's semi-major axis."],
  "src/terrain/terrainTiles.ts#AWS_TERRARIUM": ["fact", "The elevation source's own description: address, zoom range and encoding."],
  "src/terrain/terrainTiles.ts#MAPTERHORN": ["fact", "The elevation source's own description: address, zoom range and encoding."],
  "src/terrain/tileHeightProvider.ts#DEFAULT_PROBE_DEPTH_METERS": ["structure", "A height probe starts above and ends below every terrain on Earth."],
  "src/terrain/tileHeightProvider.ts#DEFAULT_PROBE_HEIGHT_METERS": ["structure", "A height probe starts above and ends below every terrain on Earth."],
  "src/terrain/tileHeightProvider.ts#DEFAULT_SAMPLE_RADIUS_METERS": ["structure", "The ring of samples that finds the lowest ground around the compass anchor."],
  "src/visualization/orbitCompass.ts#ANCHOR_EPSILON_METERS": ["guard", "The compass is redrawn only when its anchor moves further than this."],
  "src/visualization/orbitCompass.ts#COMPASS_OPACITY": ["layout", "How the orbit compass looks."],
  "src/visualization/orbitCompass.ts#DEFAULT_ORBIT_COMPASS_SCALE_PARAMS": ["parameter", "visualization.compass.radiusScale"],
  "src/visualization/orbitCompass.ts#LABEL_RADIUS_SCALE": ["layout", "How the orbit compass looks."],
  "src/visualization/orbitCompass.ts#LINE_FADE_BAND": ["layout", "How the orbit compass looks."],
  "src/visualization/orbitCompass.ts#MAX_SURFACE_LIFT_METERS": ["layout", "How far the orbit compass floats above the ground, for its size."],
  "src/visualization/orbitCompass.ts#MIN_SURFACE_LIFT_METERS": ["layout", "How far the orbit compass floats above the ground, for its size."],
  "src/visualization/orbitCompass.ts#RADIUS_EPSILON_METERS": ["guard", "The compass is rebuilt only when its radius changes by more than this."],
  "src/visualization/orbitCompass.ts#RED_LINE_ALPHA_FACTOR": ["layout", "How the orbit compass looks."],
  "src/visualization/orbitCompass.ts#SURFACE_LIFT_SCALE": ["layout", "How far the orbit compass floats above the ground, for its size."],
  "src/visualization/orbitCompass.ts#WHITE_LINE_ALPHA_FACTOR": ["layout", "How the orbit compass looks."],
  "src/windowing/layout/panelLayout.ts#DEFAULT_DOCK_PANEL_LAYOUT_OPTIONS": ["layout", "Where docked panels sit and how wide they are."],
  "src/windowing/layout/panelLayout.ts#DEFAULT_VIEWPORT_WIDTH_PX": ["layout", "The view's width before it is measured."],
  "src/windowing/layout/viewportPolicy.ts#DEFAULT_MIN_SECONDARY_ASPECT_RATIO": ["layout", "How wide the window must be to hold a second view beside the first."],
  "src/windowing/layout/viewportPolicy.ts#DEFAULT_MIN_SECONDARY_WIDTH": ["layout", "How wide the window must be to hold a second view beside the first."],
  "src/windowing/react/DockPanel.tsx@edgeOffsetPx = 12": ["layout", "A docked panel's placement and sizes."],
  "src/windowing/react/DockPanel.tsx@initialHeight = 512": ["layout", "A docked panel's placement and sizes."],
  "src/windowing/react/DockPanel.tsx@maxHeightPaddingPx = 80": ["layout", "A docked panel's placement and sizes."],
  "src/windowing/react/DockPanel.tsx@minHeight = 128": ["layout", "A docked panel's placement and sizes."],
  "src/windowing/react/DockPanel.tsx@minWidth = 160": ["layout", "A docked panel's placement and sizes."],
  "src/windowing/react/DockPanel.tsx@resizeClickThresholdPx = 6": ["layout", "How far a press on a resize edge moves before it resizes."],
  "src/windowing/react/DockPanel.tsx@topOffsetPx ?? 12": ["layout", "A docked panel's placement and sizes."],
  "src/windowing/react/FloatingWindow.tsx@defaultHeight = 760": ["layout", "A floating window's placement and sizes."],
  "src/windowing/react/FloatingWindow.tsx@defaultWidth = 980": ["layout", "A floating window's placement and sizes."],
  "src/windowing/react/FloatingWindow.tsx@maxHeightViewportPaddingPx = 72": ["layout", "A floating window's placement and sizes."],
  "src/windowing/react/FloatingWindow.tsx@maxWidthViewportPaddingPx = 48": ["layout", "A floating window's placement and sizes."],
  "src/windowing/react/FloatingWindow.tsx@minHeight = 320": ["layout", "A floating window's placement and sizes."],
  "src/windowing/react/FloatingWindow.tsx@minWidth = 400": ["layout", "A floating window's placement and sizes."],
  "src/windowing/react/FloatingWindow.tsx@resizeClickThresholdPx = 6": ["layout", "How far a press on a resize edge moves before it resizes."],
  "src/windowing/react/WorkspaceDockSlot.tsx@dockPanelProps?.initialHeight ?? 512": ["layout", "A docked panel's height before the user resizes it."],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path === join("src", "settings") ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

function hasNumber(node: ts.Node): boolean {
  if (ts.isNumericLiteral(node)) return node.text !== "0";
  return ts.forEachChild(node, child => hasNumber(child) || undefined) ?? false;
}

function isConstant(node: ts.Expression): boolean {
  if (ts.isNumericLiteral(node)) return true;
  if (ts.isPrefixUnaryExpression(node)) return isConstant(node.operand);
  if (ts.isParenthesizedExpression(node)) return isConstant(node.expression);
  if (ts.isBinaryExpression(node)) return isConstant(node.left) && isConstant(node.right);
  return false;
}

const text = (node: ts.Node): string => node.getText().replace(/\s+/g, " ");
const isDefault = (node: ts.Expression): boolean => isConstant(node) && !["0", "1", "-1"].includes(text(node).replace(/ /g, ""));

/** Every number the source names or gives as a default, by key. */
function scan(): Set<string> {
  const keys = new Set<string>();
  for (const path of sourceFiles("src")) {
    const file = path.split("\\").join("/");
    const source = ts.createSourceFile(file, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z][A-Z0-9_]*$/.test(node.name.text)
        && node.initializer && hasNumber(node.initializer)) keys.add(`${file}#${node.name.text}`);
      if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        && isDefault(node.right)) keys.add(`${file}@${text(node)}`);
      if ((ts.isParameter(node) || ts.isBindingElement(node)) && node.initializer && isDefault(node.initializer)) keys.add(`${file}@${text(node.name)} = ${text(node.initializer)}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return keys;
}

describe("tuning constants", () => {
  const found = scan();

  it("are each a parameter, or say why they are not", () => {
    const unexplained = [...found].filter(key => !(key in LEDGER)).sort();
    expect(unexplained, "Make each a parameter, or add it to LEDGER with its kind and reason.").toEqual([]);
  });

  it("are listed only while they exist", () => {
    expect(Object.keys(LEDGER).filter(key => !found.has(key)).sort(), "Remove these from LEDGER.").toEqual([]);
  });

  it("name a registered parameter, or give a reason", () => {
    const ids = new Set(FOSS_EARTH_PARAMETERS.map(spec => spec.id));
    for (const [key, [kind, why]] of Object.entries(LEDGER)) {
      if (kind === "parameter") expect(ids.has(why), `${key}: ${why}`).toBe(true);
      else expect(why.length, key).toBeGreaterThan(10);
    }
  });
});
