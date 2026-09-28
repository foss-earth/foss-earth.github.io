import { getAppSettings } from "../settings/appSettings";

/**
 * Which of the globe's toolbar buttons are shown: the `interface.toolbar.*`
 * parameters. Every one is shown until the user hides it in Settings, because
 * a first-time visitor cannot be expected to know that + opens the same things.
 */
export type HudButtonId = "help" | "settings" | "theme" | "inputMode";
export type HudButtonVisibility = Record<HudButtonId, boolean>;

export const HUD_BUTTON_IDS: readonly HudButtonId[] = ["help", "settings", "theme", "inputMode"];

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
