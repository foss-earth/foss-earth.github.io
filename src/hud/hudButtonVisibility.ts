/**
 * Which of the globe's toolbar buttons are shown. Every one is shown until the
 * user hides it in Settings, because a first-time visitor cannot be expected to
 * know that + opens the same things.
 */
export type HudButtonId = "help" | "settings" | "theme" | "inputMode";
export type HudButtonVisibility = Record<HudButtonId, boolean>;

export const HUD_BUTTON_IDS: readonly HudButtonId[] = ["help", "settings", "theme", "inputMode"];

export const HUD_BUTTON_VISIBILITY_STORAGE_KEY = "foss-earth.hudButtons";

/** Anything not explicitly hidden is shown, so a button added later starts visible. */
export function loadHudButtonVisibility(): HudButtonVisibility {
  let stored: Partial<Record<string, unknown>> = {};
  try {
    const raw = window.localStorage.getItem(HUD_BUTTON_VISIBILITY_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") stored = parsed as Partial<Record<string, unknown>>;
  } catch {
    // Unreadable storage shows every button.
  }
  return {
    help: stored.help !== false,
    settings: stored.settings !== false,
    theme: stored.theme !== false,
    inputMode: stored.inputMode !== false,
  };
}

export function saveHudButtonVisibility(visibility: HudButtonVisibility): void {
  try {
    window.localStorage.setItem(HUD_BUTTON_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // The choice lasts for this visit only.
  }
}
