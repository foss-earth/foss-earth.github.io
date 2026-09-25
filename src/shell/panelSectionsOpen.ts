/**
 * Which tab sections a user opened or closed, remembered per device. A section
 * the user never touched falls back to its own default.
 */
export const PANEL_SECTIONS_OPEN_STORAGE_KEY = "foss-earth.panelSectionsOpen";

export function loadPanelSectionsOpen(): Readonly<Record<string, boolean>> {
  try {
    const raw = window.localStorage.getItem(PANEL_SECTIONS_OPEN_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

export function savePanelSectionsOpen(open: Readonly<Record<string, boolean>>): void {
  try {
    window.localStorage.setItem(PANEL_SECTIONS_OPEN_STORAGE_KEY, JSON.stringify(open));
  } catch {
    // Which sections were open is a convenience; losing it costs a click.
  }
}
