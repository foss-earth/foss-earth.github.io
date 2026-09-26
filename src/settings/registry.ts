import type {
  DeviceContext,
  ImportResult,
  LegacyMigration,
  ParameterBounds,
  ParameterChoice,
  ParameterLayers,
  ParameterProvenance,
  ParameterSpec,
  ParameterState,
  ParameterValue,
  PresetChange,
  PresetRejection,
  SetResult,
  SettingsExport,
  SettingsFilter,
  SettingsPreset,
} from "./types";
import { copyValue, formatValue, isNumberRange, parseValue, sameValue, validateValue } from "./values";

/** One versioned record per application origin, holding values that differ from their defaults. */
export const SETTINGS_STORAGE_KEY = "foss-earth.settings.v1";
const RECORD_VERSION = 1;
/** `?set.<id>=<value>` sets a parameter for this session. */
export const URL_PARAMETER_PREFIX = "set.";

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface UrlAliasResult {
  /** Registry ids and their values as text, as if given with `?set.<id>=`. */
  values: Record<string, string>;
  /** Notes for the section of each id, such as "?terrainQuality is retired". */
  notes?: Record<string, string>;
}

export interface SettingsRegistryOptions {
  /**
   * Where the record persists. Omitted, the browser's localStorage when it can
   * be reached; null keeps everything in memory.
   */
  storage?: SettingsStorage | null;
  /** The page's query: `?set.<id>=` values apply for this session only. Omitted, none. */
  searchParams?: URLSearchParams | null;
  /** Older URL parameters that map onto registry ids. */
  urlAliases?: (params: URLSearchParams) => UrlAliasResult;
  deviceContext?: Partial<DeviceContext>;
  /** Where source paths are browsable, such as a repository's blob URL ending in "/". */
  sourceBase?: string;
}

interface SettingsRecord {
  version: 1;
  values: Record<string, unknown>;
  /** The preset that set each saved value, until it is edited. */
  presets?: Record<string, string>;
  /** Legacy keys already migrated. */
  migrated?: string[];
  /** Presets the user saved. */
  userPresets?: SettingsPreset[];
}

export interface SettingsRegistry {
  /** Adds parameters. Saved and URL values for them are validated now; invalid ones are dropped with a note. */
  register(specs: readonly ParameterSpec[]): void;
  has(id: string): boolean;
  spec(id: string): ParameterSpec | undefined;
  /** Registered parameters in registration order. */
  list(filter?: SettingsFilter): ParameterSpec[];
  /** Section ids of a tab, in the order their first parameter was registered. */
  sections(tab: string): string[];
  setSectionTitle(tab: string, section: string, title: string): void;
  getSectionTitle(tab: string, section: string): string;
  /** The effective value after every layer. Cached: cheap enough for every frame. */
  get<T extends ParameterValue = ParameterValue>(id: string): T;
  inspect(id: string): ParameterState;
  /** Saves a value the user chose. Refused, never repaired, when invalid. */
  set(id: string, value: ParameterValue, options?: { preset?: string }): SetResult;
  /** Saves several values at once: all or none, with one notification. */
  setMany(values: Readonly<Record<string, ParameterValue>>, options?: { preset?: string }): SetResult;
  /** Forgets the saved and URL values of a parameter. */
  reset(id: string): void;
  resetAll(filter?: SettingsFilter): void;
  /**
   * A value the host requires. It wins over every other layer until released,
   * and the UI shows the reason. Throws on an invalid value.
   */
  force(id: string, value: ParameterValue, reason: string): () => void;
  /**
   * Replaces the registered default for this app, saying why. Saved values,
   * migrated ones included, still win. Throws on an invalid value.
   */
  setHostDefault(id: string, value: ParameterValue, derivedFrom: string): void;
  /** Options for a parameter with `dynamicChoices`. */
  setChoices(id: string, choices: readonly ParameterChoice[]): void;
  /** Explains what limits a parameter now, shown under its control; null clears it. */
  setNote(id: string, note: string | null): void;
  /**
   * The live measurement a budget bounds, such as "118 MiB in use", read
   * beside its control while it is shown. Null removes it. Returns a function
   * that removes this source.
   */
  setReadingSource(id: string, read: (() => string | null) | null): () => void;
  /** The current reading, or null when there is no source or nothing to say. */
  getReading(id: string): string | null;
  hasReading(id: string): boolean;
  setDeviceContext(context: Partial<DeviceContext>): void;
  getDeviceContext(): DeviceContext;
  /** Called with the ids whose state changed, or that were just registered. Returns an unsubscribe function. */
  subscribe(listener: (changed: ReadonlySet<string>) => void): () => void;
  /** Called when the effective value of `id` changes, through any layer. */
  watch<T extends ParameterValue = ParameterValue>(id: string, listener: (value: T) => void): () => void;
  /** Ids with a value from the URL this session. */
  sessionValueIds(): string[];
  /** Saves the URL's values: "Keep these values". */
  keepSessionValues(): SetResult;
  export(filter?: SettingsFilter): SettingsExport;
  /** Applies each valid entry and lists the rest with the reason. */
  import(data: unknown): ImportResult;
  /**
   * Migrates old keys once each; the old keys stay for rollback. Every valid
   * migrated value is saved as the user's, even one equal to a default, so a
   * migration should return only values the user chose.
   */
  migrateLegacy(migrations: readonly LegacyMigration[]): void;
  registerPresets(presets: readonly SettingsPreset[]): void;
  listPresets(): SettingsPreset[];
  /** What applying a preset would change, and the values it cannot apply here. */
  diffPreset(preset: SettingsPreset, filter?: SettingsFilter): { changes: PresetChange[]; rejected: PresetRejection[] };
  /** Copies a preset's values; nothing keeps a link to the preset afterwards. */
  applyPreset(preset: SettingsPreset, filter?: SettingsFilter): ImportResult;
  /** The first preset whose values in `filter` all match the effective values, or null: "Custom". */
  matchingPreset(filter?: SettingsFilter): SettingsPreset | null;
  /** Saves the current values of `filter` as a preset of the user's. */
  savePreset(name: string, filter?: SettingsFilter): SettingsPreset;
  renamePreset(id: string, name: string): boolean;
  deletePreset(id: string): boolean;
  isUserPreset(id: string): boolean;
  /** Where the sources of ids starting with `prefix` are browsable; the longest prefix wins. */
  setSourceBase(prefix: string, baseUrl: string): void;
  /** A link to the file that reads a parameter, or null when no base is known. */
  sourceUrl(id: string): string | null;
  /** Re-reads the record, as after another tab saved it. */
  reload(): void;
  /** Null after a storage failure: settings still apply but will not survive a reload. */
  getStorageError(): string | null;
}

/** Shared, so an unchanged parameter compares equal to itself. */
const NO_CHOICES: readonly ParameterChoice[] = Object.freeze([]);

const DEFAULT_CONTEXT: DeviceContext = {
  rendererMode: null,
  maxTextureSize: null,
  devicePixelRatio: 1,
  hardwareConcurrency: null,
  deviceMemoryGiB: null,
  touch: false,
  frameTimeMs: null,
  refreshIntervalMs: null,
  rendererDevicePixels: null,
};

function defaultStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreset(value: unknown): value is SettingsPreset {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
    && typeof value.description === "string" && isRecord(value.values);
}

function matches(spec: ParameterSpec, filter: SettingsFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.tab !== undefined && spec.home.tab !== filter.tab) return false;
  if (filter.section !== undefined && spec.home.section !== filter.section) return false;
  if (filter.prefix !== undefined && !spec.id.startsWith(filter.prefix)) return false;
  if (filter.level === "main" && spec.home.level !== "main") return false;
  return true;
}

function clampToBounds(spec: ParameterSpec, value: ParameterValue, bounds: ParameterBounds | null): ParameterValue {
  if (!bounds) return value;
  const clamp = (x: number) => Math.max(bounds.min, Math.min(bounds.max, x));
  if (spec.kind === "number" && typeof value === "number") return clamp(value);
  if (spec.kind === "range" && isNumberRange(value)) {
    const min = clamp(value.min);
    return { min, max: Math.max(min, clamp(value.max)) };
  }
  return value;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset";
}

export function createSettingsRegistry(options: SettingsRegistryOptions = {}): SettingsRegistry {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  let storageError: string | null = storage === null && options.storage === undefined
    ? "Browser storage is unavailable, so settings last only until the page reloads."
    : null;
  let context: DeviceContext = { ...DEFAULT_CONTEXT, ...options.deviceContext };

  const specs = new Map<string, ParameterSpec>();
  const sectionTitles = new Map<string, string>();
  let record = readRecord();
  const sessionValues = new Map<string, ParameterValue>();
  const urlText = new Map<string, string>();
  const urlNotes = new Map<string, string>();
  const urlValues = new Map<string, ParameterValue>();
  const forced = new Map<string, Array<{ value: ParameterValue; reason: string; token: object }>>();
  const hostDefaults = new Map<string, { value: ParameterValue; derivedFrom: string }>();
  const choices = new Map<string, readonly ParameterChoice[]>();
  const notes = new Map<string, string>();
  const readings = new Map<string, () => string | null>();
  const droppedNotes = new Map<string, string>();
  const presets = new Map<string, SettingsPreset>();
  const sourceBases = new Map<string, string>(options.sourceBase ? [["", options.sourceBase]] : []);
  const cache = new Map<string, ParameterState>();
  const listeners = new Set<(changed: ReadonlySet<string>) => void>();
  const watchers = new Map<string, Set<(value: ParameterValue) => void>>();

  if (options.searchParams) {
    for (const [key, value] of options.searchParams) {
      if (key.startsWith(URL_PARAMETER_PREFIX) && key.length > URL_PARAMETER_PREFIX.length) {
        urlText.set(key.slice(URL_PARAMETER_PREFIX.length), value);
      }
    }
    if (options.urlAliases) {
      const aliases = options.urlAliases(options.searchParams);
      for (const [id, value] of Object.entries(aliases.values)) if (!urlText.has(id)) urlText.set(id, value);
      for (const [id, note] of Object.entries(aliases.notes ?? {})) urlNotes.set(id, note);
    }
  }

  function readRecord(): SettingsRecord {
    const empty: SettingsRecord = { version: RECORD_VERSION, values: {} };
    if (!storage) return empty;
    let raw: string | null;
    try {
      raw = storage.getItem(SETTINGS_STORAGE_KEY);
    } catch {
      storageError = "Browser storage could not be read, so saved settings were not loaded.";
      return empty;
    }
    if (raw === null) return empty;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && parsed.version === RECORD_VERSION && isRecord(parsed.values)) {
        return {
          version: RECORD_VERSION,
          values: { ...parsed.values },
          presets: isRecord(parsed.presets)
            ? Object.fromEntries(Object.entries(parsed.presets).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
            : undefined,
          migrated: Array.isArray(parsed.migrated) ? parsed.migrated.filter((key): key is string => typeof key === "string") : undefined,
          userPresets: Array.isArray(parsed.userPresets) ? parsed.userPresets.filter(isPreset) : undefined,
        };
      }
    } catch {
      // A corrupt record is replaced by the next save.
    }
    storageError = "Saved settings could not be read and were set aside; the next change replaces them.";
    return empty;
  }

  function writeRecord(): void {
    if (!storage) return;
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(record));
      storageError = null;
    } catch {
      storageError = "Settings could not be saved in this browser. They apply until the page reloads.";
    }
  }

  function requireSpec(id: string): ParameterSpec {
    const spec = specs.get(id);
    if (!spec) throw new Error(`No parameter "${id}" is registered.`);
    return spec;
  }

  function boundsOf(spec: ParameterSpec): ParameterBounds | null {
    return spec.bounds ? spec.bounds(context) : null;
  }

  function choicesOf(spec: ParameterSpec): readonly ParameterChoice[] {
    return choices.get(spec.id) ?? spec.choices ?? NO_CHOICES;
  }

  function registeredDefault(spec: ParameterSpec): { value: ParameterValue; derivedFrom: string } {
    if (typeof spec.default === "function") {
      const derived = spec.default(context);
      return { value: derived.value, derivedFrom: derived.derivedFrom };
    }
    return { value: spec.default, derivedFrom: spec.defaultReason };
  }

  /** Bounds a device or renderer sets limit a value; bounds without a reason make it invalid. */
  function validateStored(spec: ParameterSpec, value: unknown): string | null {
    const bounds = boundsOf(spec);
    const lenient = bounds?.reason ? null : bounds;
    if (spec.dynamicChoices && spec.kind === "choice") return typeof value === "string" ? null : "Expected one of the choices.";
    return validateValue(spec, value, lenient, choicesOf(spec));
  }

  function savedValue(spec: ParameterSpec): ParameterValue | undefined {
    if (spec.session) return sessionValues.get(spec.id);
    if (!(spec.id in record.values)) return undefined;
    return record.values[spec.id] as ParameterValue;
  }

  function computeState(spec: ParameterSpec): ParameterState {
    const bounds = boundsOf(spec);
    const specChoices = choicesOf(spec);
    const base = registeredDefault(spec);
    const host = hostDefaults.get(spec.id);
    const saved = savedValue(spec);
    const url = urlValues.get(spec.id);
    const force = forced.get(spec.id)?.at(-1);
    const layers: ParameterLayers = { default: { value: base.value, derivedFrom: base.derivedFrom } };
    if (host) layers.hostDefault = { value: host.value, derivedFrom: host.derivedFrom };
    const presetName = spec.session ? undefined : record.presets?.[spec.id];
    if (saved !== undefined) layers.saved = { value: saved, ...(presetName ? { preset: presetName } : {}) };
    if (url !== undefined) layers.url = { value: url };
    if (force) layers.forced = { value: force.value, reason: force.reason };

    const usable = (value: ParameterValue | undefined): boolean => {
      if (value === undefined) return false;
      // A saved dynamic choice waits for its option.
      if (spec.kind === "choice" && spec.dynamicChoices) return specChoices.some(choice => choice.id === value);
      return true;
    };
    let value: ParameterValue;
    let provenance: ParameterProvenance;
    if (force) { value = force.value; provenance = "host"; }
    else if (usable(url)) { value = url!; provenance = "url"; }
    else if (usable(saved)) { value = saved!; provenance = presetName ? "preset" : "user"; }
    else if (host && usable(host.value)) { value = host.value; provenance = "host-default"; }
    else { value = base.value; provenance = "default"; }

    const noteParts: string[] = [];
    const dropped = droppedNotes.get(spec.id);
    if (dropped) noteParts.push(dropped);
    const urlNote = urlNotes.get(spec.id);
    if (urlNote) noteParts.push(urlNote);
    if (saved !== undefined && !usable(saved) && spec.kind === "choice") {
      noteParts.push(`The saved choice "${saved}" is not available now.`);
    }
    const limited = clampToBounds(spec, value, bounds);
    if (!sameValue(limited, value)) {
      noteParts.push(`${formatValue(spec, value, specChoices)} is limited to ${formatValue(spec, limited, specChoices)}${bounds?.reason ? `: ${bounds.reason}` : "."}`);
      value = limited;
    }
    const note = notes.get(spec.id);
    if (note) noteParts.push(note);
    const defaultValue = host?.value ?? base.value;
    return {
      spec,
      value: copyValue(value),
      provenance,
      ...(provenance === "preset" && presetName ? { preset: presetName } : {}),
      defaultValue: clampToBounds(spec, defaultValue, bounds),
      defaultDerivedFrom: host?.derivedFrom ?? base.derivedFrom,
      bounds,
      choices: specChoices,
      layers,
      note: noteParts.length > 0 ? noteParts.join(" ") : null,
    };
  }

  function stateOf(id: string): ParameterState {
    const cached = cache.get(id);
    if (cached) return cached;
    const state = computeState(requireSpec(id));
    cache.set(id, state);
    return state;
  }

  function sameState(a: ParameterState, b: ParameterState): boolean {
    return sameValue(a.value, b.value) && a.provenance === b.provenance && a.preset === b.preset
      && sameValue(a.defaultValue, b.defaultValue) && a.defaultDerivedFrom === b.defaultDerivedFrom
      && a.note === b.note && a.bounds?.min === b.bounds?.min && a.bounds?.max === b.bounds?.max
      && a.bounds?.reason === b.bounds?.reason && a.choices === b.choices
      && JSON.stringify(a.layers) === JSON.stringify(b.layers);
  }

  /** Runs a change to some ids' layers, then notifies about what actually changed. */
  function mutate(ids: Iterable<string>, change: () => void): void {
    const affected = [...new Set(ids)].filter(id => specs.has(id));
    const before = new Map(affected.map(id => [id, stateOf(id)]));
    change();
    for (const id of affected) cache.delete(id);
    const changed = new Set<string>();
    const valueChanged: string[] = [];
    for (const id of affected) {
      const next = stateOf(id);
      const previous = before.get(id)!;
      if (!sameState(previous, next)) changed.add(id);
      if (!sameValue(previous.value, next.value)) valueChanged.push(id);
    }
    if (changed.size === 0) return;
    for (const listener of [...listeners]) listener(changed);
    for (const id of valueChanged) {
      const value = stateOf(id).value;
      for (const watcher of [...(watchers.get(id) ?? [])]) watcher(copyValue(value));
    }
  }

  function currentDefault(spec: ParameterSpec): ParameterValue {
    return hostDefaults.get(spec.id)?.value ?? registeredDefault(spec).value;
  }

  function checkWritable(spec: ParameterSpec, value: unknown): string | null {
    if (spec.readOnly) return spec.readOnly;
    return validateValue(spec, value, boundsOf(spec), choicesOf(spec));
  }

  /** Writes a checked value into the saved layer. The caller notifies and persists. */
  function writeSaved(spec: ParameterSpec, value: ParameterValue, preset: string | undefined): void {
    urlValues.delete(spec.id);
    droppedNotes.delete(spec.id);
    if (spec.session) {
      if (sameValue(value, currentDefault(spec))) sessionValues.delete(spec.id);
      else sessionValues.set(spec.id, copyValue(value));
      return;
    }
    const presetsById = { ...(record.presets ?? {}) };
    if (sameValue(value, currentDefault(spec))) {
      delete record.values[spec.id];
      delete presetsById[spec.id];
    } else {
      record.values[spec.id] = copyValue(value);
      if (preset) presetsById[spec.id] = preset;
      else delete presetsById[spec.id];
    }
    record.presets = Object.keys(presetsById).length > 0 ? presetsById : undefined;
  }

  function setMany(values: Readonly<Record<string, ParameterValue>>, setOptions?: { preset?: string }): SetResult {
    const entries = Object.entries(values);
    for (const [id, value] of entries) {
      const spec = specs.get(id);
      if (!spec) return { ok: false, reason: `No parameter "${id}" is registered.` };
      const problem = checkWritable(spec, value);
      if (problem) return { ok: false, reason: `${spec.label}: ${problem}` };
    }
    mutate(entries.map(([id]) => id), () => {
      for (const [id, value] of entries) writeSaved(specs.get(id)!, value, setOptions?.preset);
      writeRecord();
    });
    return { ok: true };
  }

  /** Checks saved and URL values of newly registered parameters. */
  function adopt(spec: ParameterSpec): void {
    if (!spec.session && spec.id in record.values) {
      const problem = validateStored(spec, record.values[spec.id]);
      if (problem) {
        droppedNotes.set(spec.id, `The saved value was dropped: ${problem}`);
        delete record.values[spec.id];
        if (record.presets) delete record.presets[spec.id];
        writeRecord();
      }
    }
    const text = urlText.get(spec.id);
    if (text !== undefined) {
      const parsed = parseValue(spec, text);
      const problem = parsed === null ? "it could not be read." : checkWritable(spec, parsed);
      if (parsed !== null && !problem) urlValues.set(spec.id, parsed);
      else urlNotes.set(spec.id, `The URL value "${text}" was ignored: ${problem}`);
    }
  }

  function exportValues(filter?: SettingsFilter): Record<string, ParameterValue> {
    const values: Record<string, ParameterValue> = {};
    for (const spec of specs.values()) {
      if (!matches(spec, filter) || spec.session || spec.sensitive) continue;
      if (spec.id in record.values) values[spec.id] = copyValue(record.values[spec.id] as ParameterValue);
    }
    return values;
  }

  function applyEntries(entries: Iterable<[string, unknown]>, preset?: string, filter?: SettingsFilter): ImportResult {
    const accepted: Record<string, ParameterValue> = {};
    const rejected: PresetRejection[] = [];
    for (const [id, value] of entries) {
      const spec = specs.get(id);
      if (!spec) { rejected.push({ id, reason: "Not a parameter of this app." }); continue; }
      if (!matches(spec, filter)) continue;
      if (spec.sensitive) { rejected.push({ id, reason: "Secrets are never imported." }); continue; }
      const problem = checkWritable(spec, value);
      if (problem) { rejected.push({ id, reason: problem }); continue; }
      accepted[id] = value as ParameterValue;
    }
    if (Object.keys(accepted).length > 0) setMany(accepted, preset ? { preset } : undefined);
    return { applied: Object.keys(accepted), rejected };
  }

  const registry: SettingsRegistry = {
    register(newSpecs) {
      for (const spec of newSpecs) {
        if (specs.has(spec.id)) throw new Error(`Parameter "${spec.id}" is already registered.`);
      }
      for (const spec of newSpecs) {
        specs.set(spec.id, spec);
        adopt(spec);
      }
      // New parameters are new state: sections that list them draw them.
      if (newSpecs.length > 0) {
        const added = new Set(newSpecs.map(spec => spec.id));
        for (const listener of [...listeners]) listener(added);
      }
    },
    has: (id) => specs.has(id),
    spec: (id) => specs.get(id),
    list: (filter) => [...specs.values()].filter(spec => matches(spec, filter)),
    sections(tab) {
      const result: string[] = [];
      for (const spec of specs.values()) {
        if (spec.home.tab === tab && !result.includes(spec.home.section)) result.push(spec.home.section);
      }
      return result;
    },
    setSectionTitle(tab, section, title) {
      sectionTitles.set(`${tab}/${section}`, title);
    },
    getSectionTitle(tab, section) {
      return sectionTitles.get(`${tab}/${section}`) ?? section.charAt(0).toUpperCase() + section.slice(1);
    },
    get<T extends ParameterValue = ParameterValue>(id: string): T {
      return stateOf(id).value as T;
    },
    inspect: stateOf,
    set(id, value, setOptions) {
      return setMany({ [id]: value }, setOptions);
    },
    setMany,
    reset(id) {
      const spec = requireSpec(id);
      mutate([id], () => {
        urlValues.delete(id);
        urlNotes.delete(id);
        droppedNotes.delete(id);
        if (spec.session) { sessionValues.delete(id); return; }
        delete record.values[id];
        if (record.presets) delete record.presets[id];
        writeRecord();
      });
    },
    resetAll(filter) {
      const ids = registry.list(filter).map(spec => spec.id);
      mutate(ids, () => {
        for (const id of ids) {
          urlValues.delete(id);
          urlNotes.delete(id);
          droppedNotes.delete(id);
          sessionValues.delete(id);
          delete record.values[id];
          if (record.presets) delete record.presets[id];
        }
        writeRecord();
      });
    },
    force(id, value, reason) {
      const spec = requireSpec(id);
      const problem = validateValue(spec, value, boundsOf(spec), choicesOf(spec));
      if (problem && !(spec.dynamicChoices && typeof value === "string")) throw new RangeError(`Cannot force ${id}: ${problem}`);
      const token = {};
      mutate([id], () => {
        const stack = forced.get(id) ?? [];
        stack.push({ value: copyValue(value), reason, token });
        forced.set(id, stack);
      });
      return () => {
        mutate([id], () => {
          const stack = forced.get(id)?.filter(entry => entry.token !== token) ?? [];
          if (stack.length > 0) forced.set(id, stack); else forced.delete(id);
        });
      };
    },
    setHostDefault(id, value, derivedFrom) {
      const spec = requireSpec(id);
      const problem = validateValue(spec, value, boundsOf(spec), choicesOf(spec));
      if (problem && !(spec.dynamicChoices && typeof value === "string")) throw new RangeError(`Cannot set the default of ${id}: ${problem}`);
      mutate([id], () => { hostDefaults.set(id, { value: copyValue(value), derivedFrom }); });
    },
    setChoices(id, next) {
      requireSpec(id);
      mutate([id], () => { choices.set(id, [...next]); });
    },
    setNote(id, note) {
      if (!specs.has(id)) return;
      mutate([id], () => {
        if (note) notes.set(id, note); else notes.delete(id);
      });
    },
    setReadingSource(id, read) {
      if (read) readings.set(id, read); else readings.delete(id);
      return () => { if (readings.get(id) === read) readings.delete(id); };
    },
    getReading(id) {
      const read = readings.get(id);
      if (!read) return null;
      try { return read(); } catch { return null; }
    },
    hasReading: (id) => readings.has(id),
    setDeviceContext(partial) {
      const next = { ...context, ...partial };
      if (JSON.stringify(next) === JSON.stringify(context)) return;
      mutate(specs.keys(), () => { context = next; });
    },
    getDeviceContext: () => ({ ...context }),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    watch<T extends ParameterValue = ParameterValue>(id: string, listener: (value: T) => void) {
      const set = watchers.get(id) ?? new Set();
      const wrapped = listener as (value: ParameterValue) => void;
      set.add(wrapped);
      watchers.set(id, set);
      return () => { set.delete(wrapped); };
    },
    sessionValueIds: () => [...urlValues.keys()],
    keepSessionValues() {
      const values = Object.fromEntries(urlValues);
      return setMany(values);
    },
    export(filter) {
      return { format: "foss-earth.settings", version: 1, values: exportValues(filter) };
    },
    import(data) {
      let values: unknown = data;
      if (typeof data === "string") {
        try { values = JSON.parse(data); } catch { return { applied: [], rejected: [{ id: "", reason: "The text is not JSON." }] }; }
      }
      if (isRecord(values) && values.format === "foss-earth.settings") {
        if (values.version !== 1) return { applied: [], rejected: [{ id: "", reason: `Version ${String(values.version)} is not supported.` }] };
        values = values.values;
      }
      if (!isRecord(values)) return { applied: [], rejected: [{ id: "", reason: "Expected an object of parameter values." }] };
      return applyEntries(Object.entries(values));
    },
    migrateLegacy(migrations) {
      if (!storage) return;
      const done = new Set(record.migrated ?? []);
      const pending = migrations.filter(migration => !done.has(migration.key));
      if (pending.length === 0) return;
      const touched: string[] = [];
      for (const migration of pending) {
        let raw: string | null = null;
        try { raw = storage.getItem(migration.key); } catch { continue; }
        done.add(migration.key);
        if (raw === null) continue;
        let values: Record<string, ParameterValue> | null = null;
        try { values = migration.migrate(raw); } catch { values = null; }
        for (const [id, value] of Object.entries(values ?? {})) {
          if (id in record.values) continue;
          const spec = specs.get(id);
          // Values for parameters not registered yet wait in the record for their spec.
          // A migrated value is the user's old choice: it is kept even where it equals
          // today's default, so a host default set later does not replace it.
          if (spec) {
            if (spec.session) continue;
            if (validateStored(spec, value)) continue;
          }
          record.values[id] = copyValue(value);
          touched.push(id);
        }
      }
      mutate(touched, () => {
        record.migrated = [...done];
        writeRecord();
      });
    },
    registerPresets(newPresets) {
      for (const preset of newPresets) {
        if (!isPreset(preset)) throw new Error("A preset needs an id, a name, a description and values.");
        presets.set(preset.id, preset);
      }
    },
    listPresets: () => [...presets.values(), ...(record.userPresets ?? [])],
    diffPreset(preset, filter) {
      const changes: PresetChange[] = [];
      const rejected: PresetRejection[] = [];
      for (const [id, value] of Object.entries(preset.values)) {
        const spec = specs.get(id);
        if (!spec) { rejected.push({ id, reason: "Not a parameter of this app." }); continue; }
        if (!matches(spec, filter)) continue;
        const problem = checkWritable(spec, value);
        if (problem) { rejected.push({ id, reason: problem }); continue; }
        const from = stateOf(id).value;
        if (!sameValue(from, value)) changes.push({ id, label: spec.label, from, to: copyValue(value) });
      }
      return { changes, rejected };
    },
    applyPreset(preset, filter) {
      return applyEntries(Object.entries(preset.values), preset.name, filter);
    },
    matchingPreset(filter) {
      for (const preset of registry.listPresets()) {
        let relevant = 0;
        let all = true;
        for (const [id, value] of Object.entries(preset.values)) {
          const spec = specs.get(id);
          if (!spec || !matches(spec, filter)) continue;
          relevant += 1;
          if (!sameValue(stateOf(id).value, value)) { all = false; break; }
        }
        if (relevant > 0 && all) return preset;
      }
      return null;
    },
    savePreset(name, filter) {
      const values: Record<string, ParameterValue> = {};
      for (const spec of registry.list(filter)) {
        if (spec.session || spec.sensitive || spec.readOnly) continue;
        values[spec.id] = stateOf(spec.id).value;
      }
      const existing = new Set(registry.listPresets().map(preset => preset.id));
      let id = `user:${slug(name)}`;
      for (let n = 2; existing.has(id); n++) id = `user:${slug(name)}-${n}`;
      const preset: SettingsPreset = { id, name, description: "Saved from this device's values.", values };
      record.userPresets = [...(record.userPresets ?? []), preset];
      writeRecord();
      return preset;
    },
    renamePreset(id, name) {
      const list = record.userPresets ?? [];
      const index = list.findIndex(preset => preset.id === id);
      if (index < 0 || !name.trim()) return false;
      record.userPresets = list.map((preset, i) => i === index ? { ...preset, name: name.trim() } : preset);
      writeRecord();
      return true;
    },
    deletePreset(id) {
      const list = record.userPresets ?? [];
      if (!list.some(preset => preset.id === id)) return false;
      record.userPresets = list.filter(preset => preset.id !== id);
      if (record.userPresets.length === 0) record.userPresets = undefined;
      writeRecord();
      return true;
    },
    isUserPreset: (id) => (record.userPresets ?? []).some(preset => preset.id === id),
    setSourceBase(prefix, baseUrl) {
      sourceBases.set(prefix, baseUrl);
    },
    sourceUrl(id) {
      const spec = specs.get(id);
      if (!spec) return null;
      let best: string | null = null;
      let length = -1;
      for (const [prefix, base] of sourceBases) {
        if (id.startsWith(prefix) && prefix.length > length) { best = base; length = prefix.length; }
      }
      return best === null ? null : `${best}${spec.source}`;
    },
    reload() {
      mutate(specs.keys(), () => {
        record = readRecord();
        for (const spec of specs.values()) {
          if (spec.id in record.values && validateStored(spec, record.values[spec.id])) delete record.values[spec.id];
        }
      });
    },
    getStorageError: () => storageError,
  };
  return registry;
}
