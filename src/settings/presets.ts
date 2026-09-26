import type { SettingsPreset } from "./types";

/**
 * Built-in presets, one JSON file each in ./presets/. They are lists of
 * values, applied by copying; no code branches on a preset's name.
 */
const files = import.meta.glob<SettingsPreset>("./presets/*.json", { eager: true, import: "default" });

export const BUILT_IN_PRESETS: readonly SettingsPreset[] = Object.keys(files)
  .sort()
  .map(path => files[path]);
