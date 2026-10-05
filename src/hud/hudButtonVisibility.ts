import { getAppSettings } from "../settings/appSettings";
import type { ToolbarVisibility } from "../settings/catalogue";

/**
 * Which of the globe's toolbar buttons are shown: the `interface.toolbar.*`
 * parameters. Auto fits in one row by priority, On stays shown and may wrap,
 * and Off stays hidden. The tabs remain available under +.
 */
export type HudButtonId = "help" | "renderer" | "inputMode" | "theme" | "settings" | "fullscreen" | "position";
export type HudVisibilityMode = ToolbarVisibility;
export type HudButtonVisibility = Record<HudButtonId, HudVisibilityMode>;

export const HUD_BUTTON_IDS: readonly HudButtonId[] = ["help", "renderer", "inputMode", "theme", "settings", "fullscreen", "position"];

/** @deprecated The record key before the settings registry; migrated into `interface.toolbar.*`. */
export const HUD_BUTTON_VISIBILITY_STORAGE_KEY = "foss-earth.hudButtons";

export function hudButtonParameterId(id: HudButtonId): string {
  return `interface.toolbar.${id}`;
}

export function loadHudButtonVisibility(): HudButtonVisibility {
  const settings = getAppSettings();
  return Object.fromEntries(HUD_BUTTON_IDS.map(id => [id, settings.get(hudButtonParameterId(id))])) as HudButtonVisibility;
}

export function saveHudButtonVisibility(visibility: HudButtonVisibility): void {
  getAppSettings().setMany(Object.fromEntries(HUD_BUTTON_IDS.map(id => [hudButtonParameterId(id), visibility[id]])));
}
