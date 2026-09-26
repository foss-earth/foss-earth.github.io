/**
 * foss-earth/settings: the parameter registry. See docs/proposals/settings.md.
 *
 * `getAppSettings()` is the page's registry with FOSS Earth's catalogue in it.
 * A host registers its own parameters there, under its own id prefix, and
 * draws them with `createParameterSection` from foss-earth/shell.
 */
export { getAppSettings, resetAppSettings } from "./appSettings";
export {
  createSettingsRegistry,
  SETTINGS_STORAGE_KEY,
  URL_PARAMETER_PREFIX,
  type SettingsRegistry,
  type SettingsRegistryOptions,
  type SettingsStorage,
  type UrlAliasResult,
} from "./registry";
export { FOSS_EARTH_PARAMETERS } from "./catalogue";
export { BUILT_IN_PRESETS } from "./presets";
export { readDeviceContext } from "./deviceContext";
export {
  formatNumber,
  formatQuantity,
  formatValue,
  isNumberRange,
  parseValue,
  sameValue,
  stringifyValue,
  unitSuffix,
  validateValue,
} from "./values";
export type {
  AutoSpec,
  BuiltInParameterUnit,
  CustomParameterUnit,
  DerivedDefault,
  DeviceContext,
  ImportResult,
  LegacyMigration,
  NumberRange,
  ParameterBounds,
  ParameterChoice,
  ParameterHome,
  ParameterKind,
  ParameterLayers,
  ParameterProvenance,
  ParameterSpec,
  ParameterState,
  ParameterUnit,
  ParameterValue,
  PresetChange,
  PresetRejection,
  SetResult,
  SettingsExport,
  SettingsFilter,
  SettingsPreset,
} from "./types";
