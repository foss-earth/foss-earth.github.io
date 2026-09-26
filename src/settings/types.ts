/**
 * Parameters: every choice that decides what is loaded, drawn, kept, computed
 * or shown, named with a unit, bounds, a default and the reason for it.
 * See docs/proposals/settings.md.
 */

/**
 * Real units. "ratio" is a scale factor shown as "0.5×"; "fraction" is a part
 * of a whole stored from 0 to 1 and shown as a percentage. "none" is for values
 * without one, such as a map source id.
 */
export type BuiltInParameterUnit =
  | "MiB"
  | "px"
  | "ms"
  | "s"
  | "m"
  | "Hz"
  | "count"
  | "levels"
  | "ratio"
  | "fraction"
  | "deg"
  | "deg/px"
  | "deg/s"
  | "fps"
  | "samples"
  | "per-frame"
  | "per-notch"
  | "per-px"
  | "per-s"
  | "none";

/** A host's own unit, such as `{ id: "psf", text: "psf" }` for dynamic pressure. */
export interface CustomParameterUnit {
  id: string;
  /** Shown after the number, separated by a space. */
  text: string;
}

export type ParameterUnit = BuiltInParameterUnit | CustomParameterUnit;

export type ParameterKind = "number" | "range" | "choice" | "boolean" | "text";

/** Two ends of an acceptable part of one scale, `min <= max`. */
export interface NumberRange {
  min: number;
  max: number;
}

/**
 * number: a number in the unit, or the id of one of the spec's named values.
 * range: a NumberRange. choice and text: a string. boolean: a boolean.
 */
export type ParameterValue = number | string | boolean | NumberRange;

export interface ParameterBounds {
  min: number;
  max: number;
  /** Why the bounds are what they are, when a device or renderer sets them. */
  reason?: string;
}

/** What defaults and bounds may depend on. Unknown values are null. */
export interface DeviceContext {
  rendererMode: string | null;
  /** The renderer's largest 2D texture side, in px. */
  maxTextureSize: number | null;
  devicePixelRatio: number;
  hardwareConcurrency: number | null;
  /** `navigator.deviceMemory`: a rounded lower bound in GiB. */
  deviceMemoryGiB: number | null;
  touch: boolean;
  /** Measured mean frame time once running, in ms. */
  frameTimeMs: number | null;
  /** The display's measured refresh interval, in ms. */
  refreshIntervalMs: number | null;
  /** Whether the renderer started drawing a pixel per device pixel; false on the safe WebGPU fallback. */
  rendererDevicePixels: boolean | null;
}

export interface DerivedDefault<T> {
  value: T;
  /** What the default was derived from, in words: "a quarter of 8 GiB of device memory". */
  derivedFrom: string;
}

export interface ParameterHome {
  /** A tab id: "map", "renderer", "controls", "interface", or a host's own. */
  tab: string;
  /** A section id inside that tab: "detail", "loading", "instruments". */
  section: string;
  /** "main" controls show in the section; "all" ones only under Show all parameters. */
  level: "main" | "all";
}

export interface ParameterChoice {
  id: string;
  label: string;
  description?: string;
}

/** Present when the automatic controller may move this parameter. */
export interface AutoSpec {
  /** Enabled for the controller unless the user turns it off. */
  enabledByDefault: boolean;
  /** Which end of the value's scale costs less work: the controller moves toward it under load. */
  cheaperEnd: "min" | "max";
}

export interface ParameterSpec<T extends ParameterValue = ParameterValue> {
  /** Stable, dotted and prefixed by owner: "map.imagery.gpuBudget", "osfs.flight.minimum". */
  id: string;
  label: string;
  /** One sentence: what changes when this changes. */
  description: string;
  unit: ParameterUnit;
  kind: ParameterKind;
  /** number and range: the accepted values, which may depend on the device. */
  bounds?: (context: DeviceContext) => ParameterBounds;
  /** number and range: the control's step in the unit (or in log2 of it for a log2 scale). */
  step?: number;
  /** number and range: how the control spaces values. */
  scale?: "linear" | "log2";
  /**
   * number and range: how the track is drawn. `reversed` puts larger values on
   * the left, as finer detail is on the detail tracks; `ramp: "detail"` colours
   * the track green (more work) to red (less work) like the HUD rail.
   */
  track?: { reversed?: boolean; ramp?: "detail" | "neutral" };
  /** choice: the options. Leave empty and set `dynamicChoices` for options known only at run time. */
  choices?: readonly ParameterChoice[];
  /** choice: options arrive with `setChoices`; a saved value waits for its option instead of being dropped. */
  dynamicChoices?: boolean;
  /** number: named values the parameter may take instead of a number, such as "off" or "normal". */
  named?: readonly ParameterChoice[];
  default: T | ((context: DeviceContext) => DerivedDefault<T>);
  /** Why the default is what it is. */
  defaultReason: string;
  home: ParameterHome;
  auto?: AutoSpec;
  /** False: the value takes effect on the next start, and the UI says so. */
  appliesLive: boolean;
  /** Repository path of the code that reads it, from the repository root. */
  source: string;
  /** Never saved: it lasts for this session. */
  session?: boolean;
  /** A secret such as an API key: never exported, never shown in full. */
  sensitive?: boolean;
  /** Set when the value cannot be changed, with the reason. */
  readOnly?: string;
}

/** Where the effective value came from. */
export type ParameterProvenance = "default" | "host-default" | "preset" | "user" | "url" | "host";

export interface ParameterLayers {
  default: { value: ParameterValue; derivedFrom: string };
  hostDefault?: { value: ParameterValue; derivedFrom: string };
  saved?: { value: ParameterValue; preset?: string };
  url?: { value: ParameterValue };
  forced?: { value: ParameterValue; reason: string };
}

export interface ParameterState {
  spec: ParameterSpec;
  value: ParameterValue;
  provenance: ParameterProvenance;
  /** The preset that set the saved value, until it is edited. */
  preset?: string;
  /** The value when nothing is saved, set or forced, and what it was derived from. */
  defaultValue: ParameterValue;
  defaultDerivedFrom: string;
  bounds: ParameterBounds | null;
  choices: readonly ParameterChoice[];
  layers: ParameterLayers;
  /** What limits or explains the value right now, from `setNote` or a dropped saved value. */
  note: string | null;
}

export type SetResult = { ok: true } | { ok: false; reason: string };

export interface SettingsFilter {
  tab?: string;
  section?: string;
  /** Ids starting with this, such as "osfs." or "map.imagery.". */
  prefix?: string;
  /** Only parameters shown at this level; "main" excludes "all"-level ones. */
  level?: "main";
}

/** A preset: a named list of parameter values, copied when applied. */
export interface SettingsPreset {
  id: string;
  name: string;
  /** What it trades, in a sentence. */
  description: string;
  values: Readonly<Record<string, ParameterValue>>;
}

export interface PresetChange {
  id: string;
  label: string;
  from: ParameterValue;
  to: ParameterValue;
}

export interface PresetRejection {
  id: string;
  reason: string;
}

export interface SettingsExport {
  format: "foss-earth.settings";
  version: 1;
  values: Record<string, ParameterValue>;
}

export interface ImportResult {
  applied: string[];
  rejected: PresetRejection[];
}

export interface LegacyMigration {
  /** The old localStorage key. */
  key: string;
  /**
   * Values for the new parameters from the old raw string. Entries are
   * validated like any saved value and fill only parameters with no saved
   * value yet. Return null when the old value means nothing.
   */
  migrate(raw: string): Record<string, ParameterValue> | null;
}
