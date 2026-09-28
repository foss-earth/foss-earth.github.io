import { FOSS_EARTH_MIGRATIONS, FOSS_EARTH_PARAMETERS, FOSS_EARTH_SECTION_TITLES, FOSS_EARTH_URL_NAMES, fossEarthUrlAliases } from "./catalogue";
import { readDeviceContext } from "./deviceContext";
import { BUILT_IN_PRESETS } from "./presets";
import { createSettingsRegistry, SETTINGS_STORAGE_KEY, URL_PARAMETER_PREFIX, type SettingsRegistry } from "./registry";
import type { ParameterState } from "./types";
import { stringifyValue } from "./values";

/** Where FOSS Earth's sources are browsable; hosts add their own prefix with `setSourceBase`. */
export const FOSS_EARTH_SOURCE_BASE = "https://github.com/foss-earth/foss-earth.github.io/blob/main/";

/** Parameters the address bar shows once chosen, so a link or a reload opens the same map. */
const LINKED_PARAMETER_IDS = ["map.source.basemap", "map.source.elevation"];

let app: SettingsRegistry | null = null;
let stops: (() => void)[] = [];

/** Every query name a parameter is read from, the one written back first. */
function queryNames(id: string): string[] {
  return [...(FOSS_EARTH_URL_NAMES[id] ?? []), `${URL_PARAMETER_PREFIX}${id}`];
}

/** Edits the page's query in place, keeping the path, the hash and the history entry's state. */
function editQuery(edit: (params: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  const before = url.searchParams.toString();
  const params = new URLSearchParams(url.search);
  edit(params);
  const after = params.toString();
  if (after === before) return;
  url.search = after;
  window.history.replaceState(window.history.state, "", url);
}

/**
 * A secret given in the query, such as `?key=`, is saved on this device and
 * taken off the address bar, so links, bookmarks and history do not carry it.
 */
function saveSecretsFromQuery(registry: SettingsRegistry): void {
  const names: string[] = [];
  for (const spec of registry.list()) {
    if (!spec.sensitive) continue;
    const given = registry.inspect(spec.id).layers.url;
    if (given) registry.set(spec.id, given.value);
    names.push(...queryNames(spec.id));
  }
  editQuery(params => { for (const name of names) params.delete(name); });
}

function unchosen(state: ParameterState): boolean {
  return state.provenance === "default" || state.provenance === "host-default" || state.provenance === "host";
}

/**
 * Writes the value in use into the query under the name FOSS Earth has always
 * read, whenever it changes and whichever control changed it, choosing a
 * default included. When only a default moved, as a host's does at startup,
 * the query follows only if it already names the parameter. A host-forced
 * value leaves the query alone.
 */
function followInQuery(registry: SettingsRegistry, id: string): () => void {
  const [name, ...older] = queryNames(id);
  let last = registry.inspect(id);
  return registry.watch(id, value => {
    const state = registry.inspect(id);
    const defaultsOnly = unchosen(last) && unchosen(state);
    last = state;
    if (state.provenance === "host") return;
    editQuery(params => {
      if (defaultsOnly && !queryNames(id).some(named => params.has(named))) return;
      for (const other of older) params.delete(other);
      params.set(name, stringifyValue(value));
    });
  });
}

/**
 * The registry for this page's origin, with FOSS Earth's catalogue registered.
 * Hosts register their own parameters into the same registry, so the whole
 * application has one record and one place to look. It owns the page's query
 * for its parameters: secrets move from it to this device, and the basemap and
 * elevation provider in use are written back to it.
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
  if (typeof window !== "undefined") {
    saveSecretsFromQuery(registry);
    stops = LINKED_PARAMETER_IDS.map(id => followInQuery(registry, id));
    // Another tab saved: follow it, as the theme always has.
    const onStorage = (event: StorageEvent): void => {
      if (event.key === SETTINGS_STORAGE_KEY) registry.reload();
    };
    window.addEventListener("storage", onStorage);
    stops.push(() => window.removeEventListener("storage", onStorage));
  }
  app = registry;
  return registry;
}

/** Forgets the app registry, so the next `getAppSettings` reads storage again. For tests. */
export function resetAppSettings(): void {
  for (const stop of stops) stop();
  stops = [];
  app = null;
}
