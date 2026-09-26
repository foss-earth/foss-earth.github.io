import { getAppSettings } from "../settings/appSettings";
import type { SettingsRegistry } from "../settings/registry";

/**
 * Shared theme state. The active theme is reflected on `document.documentElement`
 * via both `data-theme="light|dark"` (for foss-earth's own CSS) and the
 * `.dark` / `.light` classes (so Tailwind-driven consumers like the
 * Moir-Park-Capital frontend automatically follow).
 *
 * The theme is the `interface.theme` parameter. Subscribers hear about changes
 * in this tab and, through the registry following its record, in others, via
 * the `foss-earth:theme-change` custom event.
 */
export type GlobeTheme = "light" | "dark";

const THEME_ID = "interface.theme";
const EVENT_NAME = "foss-earth:theme-change";

let watched: SettingsRegistry | null = null;

function readTheme(settings: SettingsRegistry): GlobeTheme {
  return settings.get(THEME_ID) === "light" ? "light" : "dark";
}

function applyTheme(theme: GlobeTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

/** The app's registry, watched so every change is applied and announced once. */
function settings(): SettingsRegistry {
  const current = getAppSettings();
  if (current !== watched) {
    watched = current;
    current.watch(THEME_ID, () => {
      const theme = readTheme(current);
      applyTheme(theme);
      try {
        window.dispatchEvent(new CustomEvent<GlobeTheme>(EVENT_NAME, { detail: theme }));
      } catch {
        /* ignore */
      }
    });
    applyTheme(readTheme(current));
  }
  return current;
}

settings();

export function getTheme(): GlobeTheme {
  return readTheme(settings());
}

export function setTheme(theme: GlobeTheme): void {
  if (theme !== "light" && theme !== "dark") return;
  settings().set(THEME_ID, theme);
}

export function toggleTheme(): GlobeTheme {
  const next: GlobeTheme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function onThemeChange(cb: (theme: GlobeTheme) => void): () => void {
  settings();
  const onCustom = (e: Event): void => {
    const detail = (e as CustomEvent<GlobeTheme>).detail;
    if (detail === "light" || detail === "dark") cb(detail);
  };
  window.addEventListener(EVENT_NAME, onCustom);
  return () => {
    window.removeEventListener(EVENT_NAME, onCustom);
  };
}
