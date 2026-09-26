import { FOSS_EARTH_MIGRATIONS, FOSS_EARTH_PARAMETERS, FOSS_EARTH_SECTION_TITLES, fossEarthUrlAliases } from "./catalogue";
import { readDeviceContext } from "./deviceContext";
import { BUILT_IN_PRESETS } from "./presets";
import { createSettingsRegistry, SETTINGS_STORAGE_KEY, type SettingsRegistry } from "./registry";

/** Where FOSS Earth's sources are browsable; hosts add their own prefix with `setSourceBase`. */
export const FOSS_EARTH_SOURCE_BASE = "https://github.com/foss-earth/foss-earth.github.io/blob/main/";

let app: SettingsRegistry | null = null;
let offStorage: (() => void) | null = null;

/**
 * The registry for this page's origin, with FOSS Earth's catalogue registered.
 * Hosts register their own parameters into the same registry, so the whole
 * application has one record and one place to look.
 */
export function getAppSettings(): SettingsRegistry {
  if (app) return app;
  const registry = createSettingsRegistry({
    searchParams: typeof window === "undefined" ? null : new URLSearchParams(window.location.search),
    urlAliases: fossEarthUrlAliases,
    deviceContext: readDeviceContext(),
    sourceBase: FOSS_EARTH_SOURCE_BASE,
  });
  registry.register(FOSS_EARTH_PARAMETERS);
  for (const [tab, section, title] of FOSS_EARTH_SECTION_TITLES) registry.setSectionTitle(tab, section, title);
  registry.migrateLegacy(FOSS_EARTH_MIGRATIONS);
  registry.registerPresets(BUILT_IN_PRESETS);
  // Another tab saved: follow it, as the theme always has.
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === SETTINGS_STORAGE_KEY) registry.reload();
    };
    window.addEventListener("storage", onStorage);
    offStorage = () => window.removeEventListener("storage", onStorage);
  }
  app = registry;
  return registry;
}

/** Forgets the app registry, so the next `getAppSettings` reads storage again. For tests. */
export function resetAppSettings(): void {
  offStorage?.();
  offStorage = null;
  app = null;
}
