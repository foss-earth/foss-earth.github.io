import { getAppSettings } from "../settings/appSettings";

/**
 * Which of the globe's toolbar buttons are shown: the `interface.toolbar.*`
 * parameters. Unchosen buttons fit in one row by priority; explicit choices
 * stay shown or hidden. The tabs remain available under +.
 */
export type HudButtonId = "help" | "renderer" | "inputMode" | "theme" | "settings" | "position";
export type HudButtonVisibility = Record<HudButtonId, boolean>;

export const HUD_BUTTON_IDS: readonly HudButtonId[] = ["help", "renderer", "inputMode", "theme", "settings", "position"];

/** @deprecated The record key before the settings registry; migrated into `interface.toolbar.*`. */
export const HUD_BUTTON_VISIBILITY_STORAGE_KEY = "foss-earth.hudButtons";

export function hudButtonParameterId(id: HudButtonId): string {
  return `interface.toolbar.${id}`;
}

export function loadHudButtonVisibility(): HudButtonVisibility {
  const settings = getAppSettings();
  return Object.fromEntries(HUD_BUTTON_IDS.map(id => [id, settings.get(hudButtonParameterId(id)) !== false])) as HudButtonVisibility;
}

export function saveHudButtonVisibility(visibility: HudButtonVisibility): void {
  getAppSettings().setMany(Object.fromEntries(HUD_BUTTON_IDS.map(id => [hudButtonParameterId(id), visibility[id]])));
}
