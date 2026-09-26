import { describe, expect, it, vi } from "vitest";
import { createSettingsRegistry, SETTINGS_STORAGE_KEY, type SettingsStorage } from "./registry";
import type { ParameterSpec } from "./types";

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const budget: ParameterSpec = {
  id: "test.budget",
  label: "Budget",
  description: "How much may be kept.",
  unit: "MiB",
  kind: "number",
  bounds: context => ({ min: 32, max: context.maxTextureSize ? context.maxTextureSize / 16 : 4096, ...(context.maxTextureSize ? { reason: "the renderer's texture limit" } : {}) }),
  default: context => ({ value: context.deviceMemoryGiB ? context.deviceMemoryGiB * 32 : 128, derivedFrom: context.deviceMemoryGiB ? `${context.deviceMemoryGiB} GiB of memory` : "no memory hint" }),
  defaultReason: "A share of memory.",
  home: { tab: "map", section: "loading", level: "main" },
  appliesLive: true,
  source: "src/test.ts",
};

const range: ParameterSpec = {
  id: "test.range",
  label: "Range",
  description: "An acceptable part of a scale.",
  unit: "px",
  kind: "range",
  bounds: () => ({ min: 1, max: 1024 }),
  scale: "log2",
  default: { min: 4, max: 64 },
  defaultReason: "Typical.",
  home: { tab: "map", section: "detail", level: "main" },
  appliesLive: true,
  source: "src/test.ts",
};

const mode: ParameterSpec = {
  id: "test.mode",
  label: "Mode",
  description: "Which mode.",
  unit: "none",
  kind: "choice",
  choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  default: "a",
  defaultReason: "A is simpler.",
  home: { tab: "map", section: "detail", level: "all" },
  appliesLive: true,
  source: "src/test.ts",
};

const cap: ParameterSpec = {
  id: "test.cap",
  label: "Cap",
  description: "A rate or off.",
  unit: "fps",
  kind: "number",
  named: [{ id: "off", label: "Off" }],
  bounds: () => ({ min: 10, max: 240 }),
  default: "off",
  defaultReason: "No cap.",
  home: { tab: "renderer", section: "frame", level: "main" },
  appliesLive: true,
  source: "src/test.ts",
};

const waiver: ParameterSpec = {
  id: "host.waiver",
  label: "Waiver",
  description: "For this session.",
  unit: "none",
  kind: "boolean",
  default: false,
  defaultReason: "Off.",
  home: { tab: "map", section: "detail", level: "main" },
  appliesLive: true,
  source: "src/host.ts",
  session: true,
};

const secret: ParameterSpec = {
  id: "test.key",
  label: "Key",
  description: "A key.",
  unit: "none",
  kind: "text",
  default: "",
  defaultReason: "None.",
  home: { tab: "map", section: "source", level: "main" },
  appliesLive: false,
  source: "src/test.ts",
  sensitive: true,
};

const all = [budget, range, mode, cap, waiver, secret];

function registry(storage = memoryStorage(), extra: Parameters<typeof createSettingsRegistry>[0] = {}) {
  const settings = createSettingsRegistry({ storage, ...extra });
  settings.register(all);
  return settings;
}

function record(storage: { data: Map<string, string> }) {
  return JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY) ?? "null");
}

describe("settings registry", () => {
  it("resolves defaults, including ones derived from the device", () => {
    const settings = registry();
    expect(settings.get("test.budget")).toBe(128);
    expect(settings.inspect("test.budget")).toMatchObject({ provenance: "default", defaultDerivedFrom: "no memory hint" });
    const onChange = vi.fn();
    settings.watch("test.budget", onChange);
    settings.setDeviceContext({ deviceMemoryGiB: 8 });
    expect(settings.get("test.budget")).toBe(256);
    expect(onChange).toHaveBeenCalledWith(256);
    expect(settings.inspect("test.budget").defaultDerivedFrom).toBe("8 GiB of memory");
  });

  it("saves only values that differ from their defaults, in one versioned record", () => {
    const storage = memoryStorage();
    const settings = registry(storage);
    expect(settings.set("test.budget", 512)).toEqual({ ok: true });
    expect(settings.set("test.range", { min: 2, max: 32 })).toEqual({ ok: true });
    expect(record(storage)).toEqual({ version: 1, values: { "test.budget": 512, "test.range": { min: 2, max: 32 } } });
    settings.set("test.budget", 128);
    expect(record(storage).values).toEqual({ "test.range": { min: 2, max: 32 } });
    const reloaded = registry(storage);
    expect(reloaded.get("test.range")).toEqual({ min: 2, max: 32 });
    expect(reloaded.inspect("test.range").provenance).toBe("user");
  });

  it("refuses invalid values instead of repairing them", () => {
    const settings = registry();
    expect(settings.set("test.budget", 8)).toMatchObject({ ok: false });
    expect(settings.set("test.range", { min: 64, max: 4 })).toEqual({ ok: false, reason: "Range: The range's ends are reversed." });
    expect(settings.set("test.mode", "c")).toMatchObject({ ok: false });
    expect(settings.set("test.cap", "sometimes")).toMatchObject({ ok: false });
    expect(settings.set("test.cap", "off")).toEqual({ ok: true });
    expect(settings.set("test.cap", 60)).toEqual({ ok: true });
    expect(settings.setMany({ "test.budget": 256, "test.mode": "z" })).toMatchObject({ ok: false });
    expect(settings.get("test.budget")).toBe(128);
  });

  it("drops an invalid saved value with a note, and keeps the valid ones", () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, values: { "test.mode": "zzz", "test.range": { min: 2, max: 8 } } }),
    });
    const settings = registry(storage);
    expect(settings.get("test.mode")).toBe("a");
    expect(settings.inspect("test.mode").note).toMatch(/dropped/);
    expect(settings.get("test.range")).toEqual({ min: 2, max: 8 });
    expect(record(storage).values).toEqual({ "test.range": { min: 2, max: 8 } });
  });

  it("keeps a value a device limits, and says what limited it", () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, values: { "test.budget": 2048 } }) });
    const settings = registry(storage, { deviceContext: { maxTextureSize: 8192 } });
    expect(settings.get("test.budget")).toBe(512);
    expect(settings.inspect("test.budget").note).toMatch(/limited to 512 MiB: the renderer's texture limit/);
    expect(record(storage).values["test.budget"]).toBe(2048);
    settings.setDeviceContext({ maxTextureSize: 65536 });
    expect(settings.get("test.budget")).toBe(2048);
    expect(settings.inspect("test.budget").note).toBeNull();
  });

  it("orders layers: default, host default, saved, URL, forced", () => {
    const storage = memoryStorage();
    const settings = registry(storage, { searchParams: new URLSearchParams("set.test.mode=b&set.test.range=8..16") });
    expect(settings.inspect("test.mode")).toMatchObject({ value: "b", provenance: "url" });
    expect(settings.get("test.range")).toEqual({ min: 8, max: 16 });
    expect(settings.sessionValueIds().sort()).toEqual(["test.mode", "test.range"]);
    expect(record(storage)).toBeNull();

    settings.setHostDefault("test.budget", 64, "the host's choice");
    expect(settings.inspect("test.budget")).toMatchObject({ value: 64, provenance: "host-default", defaultDerivedFrom: "the host's choice" });
    settings.set("test.budget", 96);
    expect(settings.inspect("test.budget").provenance).toBe("user");

    const watcher = vi.fn();
    settings.watch("test.budget", watcher);
    const release = settings.force("test.budget", 40, "a flight needs it");
    expect(settings.inspect("test.budget")).toMatchObject({ value: 40, provenance: "host", layers: { forced: { value: 40, reason: "a flight needs it" } } });
    expect(watcher).toHaveBeenLastCalledWith(40);
    release();
    expect(settings.get("test.budget")).toBe(96);
    expect(watcher).toHaveBeenLastCalledWith(96);
    expect(() => settings.force("test.budget", 1, "too small")).toThrow(RangeError);
  });

  it("lets an edit replace a URL value, and saves URL values only when asked", () => {
    const storage = memoryStorage();
    const settings = registry(storage, { searchParams: new URLSearchParams("set.test.mode=b&set.test.budget=512") });
    settings.set("test.mode", "a");
    expect(settings.inspect("test.mode").provenance).toBe("default");
    expect(settings.keepSessionValues()).toEqual({ ok: true });
    expect(record(storage).values).toEqual({ "test.budget": 512 });
    expect(settings.sessionValueIds()).toEqual([]);
  });

  it("ignores an unreadable URL value with a note", () => {
    const settings = registry(memoryStorage(), { searchParams: new URLSearchParams("set.test.budget=lots&set.unknown.id=1") });
    expect(settings.get("test.budget")).toBe(128);
    expect(settings.inspect("test.budget").note).toMatch(/URL value "lots" was ignored/);
  });

  it("maps older URL parameters onto ids", () => {
    const settings = registry(memoryStorage(), {
      searchParams: new URLSearchParams("oldMode=b"),
      urlAliases: params => ({ values: params.get("oldMode") ? { "test.mode": params.get("oldMode")! } : {} }),
    });
    expect(settings.inspect("test.mode")).toMatchObject({ value: "b", provenance: "url" });
  });

  it("never saves a session parameter", () => {
    const storage = memoryStorage();
    const settings = registry(storage);
    settings.set("host.waiver", true);
    expect(settings.get("host.waiver")).toBe(true);
    expect(record(storage)).toEqual({ version: 1, values: {} });
    expect(registry(storage).get("host.waiver")).toBe(false);
  });

  it("holds a dynamic choice until its option exists", () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, values: { "test.focus": "aircraft" } }) });
    const settings = createSettingsRegistry({ storage });
    settings.register([{ ...mode, id: "test.focus", choices: [{ id: "target", label: "Orbit target" }], dynamicChoices: true, default: "target" }]);
    expect(settings.get("test.focus")).toBe("target");
    expect(settings.inspect("test.focus").note).toMatch(/not available/);
    settings.setChoices("test.focus", [{ id: "target", label: "Orbit target" }, { id: "aircraft", label: "Aircraft" }]);
    expect(settings.inspect("test.focus")).toMatchObject({ value: "aircraft", provenance: "user", note: null });
  });

  it("keeps values for parameters a host registers later", () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, values: { "host.gain": 3, "host.bad": "x" } }) });
    const settings = createSettingsRegistry({ storage });
    settings.register([{ ...budget, id: "host.gain", unit: { id: "psf", text: "psf" }, bounds: () => ({ min: 0, max: 10 }), default: 1 }]);
    expect(settings.get("host.gain")).toBe(3);
    expect(record(storage).values).toEqual({ "host.gain": 3, "host.bad": "x" });
  });

  it("exports saved values without secrets, and imports what is valid", () => {
    const storage = memoryStorage();
    const settings = registry(storage);
    settings.set("test.budget", 512);
    settings.set("test.key", "secret");
    settings.set("test.cap", 60);
    expect(settings.export()).toEqual({ format: "foss-earth.settings", version: 1, values: { "test.budget": 512, "test.cap": 60 } });
    expect(settings.export({ tab: "renderer" }).values).toEqual({ "test.cap": 60 });

    const other = registry(memoryStorage());
    const result = other.import(JSON.stringify({ format: "foss-earth.settings", version: 1, values: { "test.budget": 512, "test.mode": "q", "nope": 1, "test.key": "k" } }));
    expect(result.applied).toEqual(["test.budget"]);
    expect(result.rejected.map(entry => entry.id)).toEqual(["test.mode", "nope", "test.key"]);
    expect(other.get("test.budget")).toBe(512);
    expect(other.import("not json").rejected[0].reason).toMatch(/not JSON/);
  });

  it("migrates legacy keys once, filling only what has no saved value", () => {
    const storage = memoryStorage({ "old.mode": "b", "old.budget": "900", "old.host": "5" });
    const settings = registry(storage);
    settings.set("test.budget", 256);
    const migrations = [
      { key: "old.mode", migrate: (raw: string) => ({ "test.mode": raw }) },
      { key: "old.budget", migrate: (raw: string) => ({ "test.budget": Number(raw) }) },
      { key: "old.host", migrate: (raw: string) => ({ "host.later": Number(raw) }) },
      { key: "old.missing", migrate: () => ({ "test.mode": "a" }) },
    ];
    settings.migrateLegacy(migrations);
    expect(settings.get("test.mode")).toBe("b");
    expect(settings.get("test.budget")).toBe(256);
    expect(record(storage).values["host.later"]).toBe(5);
    expect(record(storage).migrated.sort()).toEqual(["old.budget", "old.host", "old.missing", "old.mode"]);
    // A migrated value equal to today's default is still the user's choice.
    const later = registry(memoryStorage({ "old.mode": "a" }));
    later.migrateLegacy([{ key: "old.mode", migrate: (raw: string) => ({ "test.mode": raw }) }]);
    later.setHostDefault("test.mode", "b", "the host");
    expect(later.inspect("test.mode")).toMatchObject({ value: "a", provenance: "user" });
    expect(storage.data.get("old.mode")).toBe("b");
    settings.set("test.mode", "a");
    storage.data.set("old.mode", "b");
    settings.migrateLegacy(migrations);
    expect(settings.get("test.mode")).toBe("a");
  });

  it("applies presets by copying, and says Custom after an edit", () => {
    const storage = memoryStorage();
    const settings = registry(storage);
    const sharp = { id: "sharp", name: "Sharpest", description: "More work.", values: { "test.budget": 1024, "test.range": { min: 1, max: 16 }, "test.missing": 3 } };
    const cheap = { id: "cheap", name: "Save battery", description: "Less work.", values: { "test.budget": 64 } };
    settings.registerPresets([sharp, cheap]);
    const diff = settings.diffPreset(sharp);
    expect(diff.changes.map(change => [change.id, change.from, change.to])).toEqual([
      ["test.budget", 128, 1024],
      ["test.range", { min: 4, max: 64 }, { min: 1, max: 16 }],
    ]);
    expect(diff.rejected).toEqual([{ id: "test.missing", reason: "Not a parameter of this app." }]);
    const result = settings.applyPreset(sharp);
    expect(result.applied).toEqual(["test.budget", "test.range"]);
    expect(settings.inspect("test.budget")).toMatchObject({ provenance: "preset", preset: "Sharpest" });
    expect(settings.matchingPreset()?.id).toBe("sharp");
    expect(settings.matchingPreset({ section: "detail" })?.id).toBe("sharp");
    settings.set("test.budget", 512);
    expect(settings.inspect("test.budget").provenance).toBe("user");
    expect(settings.matchingPreset()).toBeNull();
    expect(settings.matchingPreset({ section: "detail" })?.id).toBe("sharp");

    const saved = settings.savePreset("Mine", { tab: "map" });
    expect(saved.values).toEqual({ "test.budget": 512, "test.range": { min: 1, max: 16 }, "test.mode": "a" });
    expect(settings.isUserPreset(saved.id)).toBe(true);
    expect(settings.renamePreset(saved.id, "Mine, renamed")).toBe(true);
    const reloaded = registry(storage);
    expect(reloaded.listPresets().map(preset => preset.name)).toEqual(["Mine, renamed"]);
    expect(reloaded.deletePreset(saved.id)).toBe(true);
    expect(reloaded.listPresets()).toEqual([]);
  });

  it("returns a preset's reset list to defaults, matches the preset with the most values, and says when saved presets change", () => {
    const settings = registry();
    const device = { id: "device", name: "This device", description: "Defaults.", values: {}, reset: ["test.", "test.cap"] };
    const budgetOnly = { id: "budget", name: "Budget only", description: "One value.", values: { "test.budget": 128 } };
    settings.registerPresets([budgetOnly, device]);
    // Both match; the one that covers more values stands for the whole.
    expect(settings.matchingPreset()?.id).toBe("device");

    settings.set("test.budget", 512);
    settings.set("test.cap", 60);
    const release = settings.force("test.range", { min: 2, max: 8 }, "The app draws a fixed range here.");
    const diff = settings.diffPreset(device);
    expect(diff.changes.map(change => [change.id, change.from, change.to])).toEqual([
      ["test.budget", 512, 128],
      ["test.cap", 60, "off"],
    ]);
    expect(diff.rejected).toEqual([{ id: "test.range", reason: "The app holds this value." }]);
    // Every value under its reset list, the secret and the held value aside.
    expect(settings.applyPreset(device)).toEqual({
      applied: ["test.budget", "test.mode", "test.cap"],
      rejected: [{ id: "test.range", reason: "The app holds this value." }],
    });
    expect(settings.inspect("test.budget").provenance).toBe("default");
    expect(settings.inspect("test.cap").provenance).toBe("default");
    release();
    expect(settings.matchingPreset()?.id).toBe("device");

    const listener = vi.fn();
    settings.subscribe(listener);
    const saved = settings.savePreset("Mine");
    settings.renamePreset(saved.id, "Mine, renamed");
    settings.deletePreset(saved.id);
    expect(listener).toHaveBeenCalledTimes(3);
    for (const [changed] of listener.mock.calls) expect(changed.size).toBe(0);
  });

  it("notifies subscribers of changed ids and reloads another tab's record", () => {
    const storage = memoryStorage();
    const settings = registry(storage);
    const listener = vi.fn();
    settings.subscribe(listener);
    settings.setNote("test.mode", "Waiting for the renderer.");
    expect(listener).toHaveBeenLastCalledWith(new Set(["test.mode"]));
    expect(settings.inspect("test.mode").note).toBe("Waiting for the renderer.");
    storage.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { "test.mode": "b" } }));
    settings.reload();
    expect(settings.get("test.mode")).toBe("b");
  });

  it("lists parameters and sections in registration order", () => {
    const settings = registry();
    expect(settings.sections("map")).toEqual(["loading", "detail", "source"]);
    expect(settings.list({ tab: "map", section: "detail", level: "main" }).map(spec => spec.id)).toEqual(["test.range", "host.waiver"]);
    expect(settings.getSectionTitle("map", "detail")).toBe("Detail");
    settings.setSectionTitle("renderer", "frame", "Frame rate");
    expect(settings.getSectionTitle("renderer", "frame")).toBe("Frame rate");
    expect(() => settings.register([budget])).toThrow(/already registered/);
  });

  it("works without storage and says so", () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register([budget]);
    expect(settings.set("test.budget", 256)).toEqual({ ok: true });
    expect(settings.getStorageError()).toBeNull();
    const failing = createSettingsRegistry({ storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } } });
    failing.register([budget]);
    failing.set("test.budget", 256);
    expect(failing.get("test.budget")).toBe(256);
    expect(failing.getStorageError()).toMatch(/could not be saved/);
  });
});
