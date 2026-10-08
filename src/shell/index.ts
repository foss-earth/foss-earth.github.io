export type {
  HudBarButtonItem,
  HudBarHandle,
  HudBarItem,
  HudBarMenuItem,
  HudBarMenuOption,
  HudBarOptions,
  HudBarSlotItem,
} from "./hudBar";
export { createHudBar, HUD_BAR_HEIGHT_PROPERTY } from "./hudBar";
export { createAboutPanel, type AboutPanelHandle, type AboutPanelOptions } from "./aboutPanel";
export { createDiagnosticsSection, type DiagnosticsSectionHandle, type DiagnosticsSource } from "./diagnosticsSection";
export { createBugReportPanel, type BugReportPanelHandle, type BugReportPanelOptions } from "./bugReportPanel";
export { fitHudBar, type HudBarFitItem } from "./hudBarFit";
export type { BuiltFrom, BuiltFromCommit, BuiltFromPart, BuiltFromSource } from "../app/builtFrom";
export { createMapSourceHud, type MapSourceHudHandle, type MapSourceHudOptions, type MapSourceHudStatus } from "./mapSourceHud";
export { createMapDetailSlider, describeDetailStatus, type MapDetailSliderHandle, type MapDetailSliderOptions } from "./mapDetailSlider";
export {
  createMapDetailController,
  detailPolicyFromValues,
  detailPolicyValues,
  MAP_DETAIL_PARAMETER_IDS,
  MAP_DETAIL_STORAGE_KEY,
  type MapDetailActiveSource,
  type MapDetailController,
  type MapDetailControllerOptions,
  type MapDetailDelivery,
  type MapDetailRequirement,
  type MapDetailSeedResult,
  type MapDetailStorage,
} from "./mapDetailController";
export { createMapDetailPanel, type MapDetailPanelHandle, type MapDetailPanelOptions } from "./mapDetailPanel";
export type { DetailTrackMarker } from "../terrain/mapDetailPolicy";
export {
  appendHostSections,
  createParameterSection,
  createSectionsElement,
  type HostSectionsHandle,
  type ParameterSectionHandle,
  type ParameterSectionOptions,
  type SectionsElementEntry,
  type SectionsElementHandle,
} from "./settings/parameterSection";
export { createParameterControl, describeProvenance, type ParameterControlHandle } from "./settings/controls";
export { createHelpTooltip, closeHelpTooltipWithin, type HelpTooltipHandle, type HelpTooltipOptions } from "./helpTooltip";
export { createParameterList, createSettingsTransfer, type ParameterListHandle, type SettingsTransferHandle } from "./settings/parameterList";
export { createTrack, detailColour, type TrackFrame, type TrackHandle, type TrackOptions, type TrackRamp, type TrackThumb } from "./settings/track";
export { createMapCacheSection, type MapCacheSectionHandle } from "./mapCacheSection";
export { createSavedImagesSection, type SavedImagesSectionHandle } from "./savedImagesSection";
export { createSavedSettingsSection, type SavedSettingsSectionHandle } from "./settings/savedSettings";
export {
  createPresetStatus,
  createPresetsSection,
  createSavePresetControl,
  type PresetStatusHandle,
  type PresetsSectionHandle,
  type SavePresetHandle,
} from "./settings/presetsSection";
export { connectMapDetailRuntime, type MapDetailRuntime } from "./connectMapDetailRuntime";
export { connectMapDetailLog } from "./mapDetailLog";
export { WindowOverlay, type WindowOverlayHandle, type WindowOverlayProps } from "./WindowOverlay";
export { SectionsPanel, type PanelSection } from "./SectionsPanel";
export { MeshInspectorPanel, type MeshInspectorPanelProps } from "./MeshInspectorPanel";
export { createMapSourcePanel, type MapSourcePanelHandle, type MapSourcePanelOptions, type MapSourceStatus } from "./mapSourcePanel";
export { createRendererPanel, getRendererLabel, type RendererPanelHandle, type RendererPanelOptions } from "./rendererPanel";
export { createSkyPanel, describeSun, type SkyPanelHandle, type SkyPanelOptions } from "./skyPanel";
export { createDateTimePanel, fixedTimeValues, instantInUse, type DateTimePanelHandle, type DateTimePanelOptions } from "./dateTimePanel";
export { createFrameBudgetPanel, type FrameBudgetPanelHandle, type FrameBudgetPanelOptions } from "./frameBudgetPanel";
export { createSceneHotspots, createSceneHud, createScenesPanel, type SceneHudHandle, type ScenesPanelHandle } from "./scenesPanel";
export { createPanoramaTabs, type PanoramaTabs, type PanoramaTabsOptions, type PanoramaTabsSnapshot } from "./panoramaTabs";
export { connectSceneLog } from "./sceneLog";
export { PANEL_SECTIONS_OPEN_STORAGE_KEY } from "./panelSectionsOpen";
export { SAVED_WORKSPACE_STORAGE_KEY } from "./savedWorkspace";
export { trackViewportInsets, VIEWPORT_INSET_BOTTOM_PROPERTY, type ViewportInsetsHandle } from "./viewportInsets";
export { createInputModeHud, type InputModeHudOptions, type InputModeHudHandle } from "../hud/inputModeHud";
export { createPositionReadout, type PositionReading, type PositionReadoutHandle, type PositionReadoutOptions } from "../hud/positionReadout";
export { surfaceHeightDatum, type HeightDatum } from "../terrain/geoid";

export { attachRendererActivity, attachTileStreamingActivity, type RenderActivitySource, type TileStreamingSource } from "./rendererActivity";

export { attachMapDownloadSpeed, setMapSourceLabel, type MapDownloadSource } from "./mapDownloadHud";

export { searchLocations, nearbyAirports } from "../search/locationSearch";
/** @deprecated The Map tab's Loading and memory section shows the cache; see createMapCacheSection. */
export { MapCachePanel } from "./MapCachePanel";
export { inspectMapCache, clearMapCache, type MapCacheSnapshot, type MapCacheEntry } from "../terrain/mapCache";
export {
  createGameLog,
  GAME_LOG_FADE_MS,
  GAME_LOG_LINE_MS,
  GAME_LOG_MAX_LINES,
  type GameLog,
  type GameLogAction,
  type GameLogEntry,
  type GameLogLine,
  type GameLogTone,
} from "../log/createGameLog";
export {
  attachFullscreenButton,
  canRequestFullscreen,
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  isStandaloneDisplay,
  onFullscreenChange,
  prefersHomeScreenInstall,
  readFullscreenEveryVisit,
  readFullscreenPromptDismissed,
  toggleFullscreen,
  writeFullscreenEveryVisit,
  writeFullscreenPromptDismissed,
} from "./fullscreen";
