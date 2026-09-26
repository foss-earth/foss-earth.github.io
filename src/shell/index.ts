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
export { createParameterList, createSettingsTransfer, type ParameterListHandle, type SettingsTransferHandle } from "./settings/parameterList";
export { createTrack, detailColour, type TrackFrame, type TrackHandle, type TrackOptions, type TrackRamp, type TrackThumb } from "./settings/track";
export { createMapCacheSection, type MapCacheSectionHandle } from "./mapCacheSection";
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
export { WindowOverlay, type WindowOverlayHandle, type WindowOverlayProps } from "./WindowOverlay";
export { SectionsPanel, type PanelSection } from "./SectionsPanel";
export { createMapSourcePanel, type MapSourcePanelHandle, type MapSourcePanelOptions, type MapSourceStatus } from "./mapSourcePanel";
export { createRendererPanel, getRendererLabel, type RendererPanelHandle, type RendererPanelOptions } from "./rendererPanel";
export { PANEL_SECTIONS_OPEN_STORAGE_KEY } from "./panelSectionsOpen";
export { trackViewportInsets, VIEWPORT_INSET_BOTTOM_PROPERTY, type ViewportInsetsHandle } from "./viewportInsets";
export { createInputModeHud, type InputModeHudOptions, type InputModeHudHandle } from "../hud/inputModeHud";

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
  type GameLog,
  type GameLogAction,
  type GameLogEntry,
  type GameLogLine,
  type GameLogTone,
} from "../log/createGameLog";
export {
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
