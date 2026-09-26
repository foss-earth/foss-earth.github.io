// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createSettingsRegistry, type SettingsStorage } from "../../settings/registry";
import type { ParameterSpec, SettingsPreset } from "../../settings/types";
import { createParameterSection } from "./parameterSection";
import { createPresetsSection } from "./presetsSection";

afterEach(() => document.body.replaceChildren());

function memoryStorage(): SettingsStorage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const base = { appliesLive: true, source: "src/test.ts", defaultReason: "Chosen for tests." } as const;

const specs: ParameterSpec[] = [
  { ...base, id: "t.budget", label: "Budget", description: "A number.", unit: "MiB", kind: "number", bounds: () => ({ min: 32, max: 1024 }), default: 128, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.cap", label: "Cap", description: "A number or off.", unit: "fps", kind: "number", named: [{ id: "off", label: "Off" }], bounds: () => ({ min: 10, max: 240 }), step: 1, default: "off", home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.key", label: "Key", description: "A secret.", unit: "none", kind: "text", default: "", sensitive: true, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.tilt", label: "Tilt", description: "An angle.", unit: "deg", kind: "number", bounds: () => ({ min: 0, max: 90 }), default: 45, home: { tab: "controls", section: "camera", level: "main" } },
];

const presets: SettingsPreset[] = [
  { id: "defaults", name: "Defaults", description: "Every value at its default, for tests.", values: {}, reset: ["t."] },
  { id: "lean", name: "Lean", description: "A small budget and a frame-rate cap, for tests.", values: { "t.budget": 64, "t.cap": 30 } },
];

function setup() {
  const settings = createSettingsRegistry({ storage: memoryStorage() });
  settings.register(specs);
  settings.registerPresets(presets);
  const panel = createPresetsSection(settings);
  const loading = createParameterSection(settings, { tab: "map", section: "loading" });
  const camera = createParameterSection(settings, { tab: "controls", section: "camera" });
  document.body.append(panel.element, loading.element, camera.element);
  const block = (id: string) => panel.element.querySelector<HTMLElement>(`[data-preset="${id}"]`)!;
  const button = (within: HTMLElement, text: string) =>
    [...within.querySelectorAll<HTMLElement>("button, a")].find(element => element.textContent === text && !element.hidden)!;
  const status = (section: HTMLElement) => section.querySelector<HTMLElement>(".foss-earth-preset-status")!;
  return { settings, panel, loading, camera, block, button, status };
}

describe("presets", () => {
  it("lists each preset with everything it sets, a reset included", () => {
    const { block } = setup();
    expect(block("lean").querySelector("summary")!.textContent).toBe("Its 2 values");
    expect([...block("lean").querySelectorAll(".foss-earth-preset__values li")].map(item => item.textContent))
      .toEqual(["Budget: 64 MiB", "Cap: 30 fps"]);
    // A reset lists what it returns to; a secret is never a preset's.
    expect([...block("defaults").querySelectorAll(".foss-earth-preset__values li")].map(item => item.textContent))
      .toEqual(["Budget: its default, 128 MiB", "Cap: its default, Off", "Tilt: its default, 45°"]);
  });

  it("applies only after listing every change, then says Custom after any edit", () => {
    const { settings, panel, loading, camera, block, button, status } = setup();
    expect(status(panel.element).textContent).toBe("Matches Defaults");
    expect(status(loading.element).textContent).toBe("Matches Defaults");

    button(block("lean"), "Apply…").click();
    const confirm = block("lean").querySelector<HTMLElement>(".foss-earth-preset__confirm")!;
    expect(confirm.hidden).toBe(false);
    expect([...confirm.querySelectorAll("li")].map(item => item.textContent)).toEqual(["Budget: 128 MiB → 64 MiB", "Cap: Off → 30 fps"]);
    button(confirm, "Cancel").click();
    expect(settings.get("t.budget")).toBe(128);

    button(block("lean"), "Apply…").click();
    button(confirm, "Apply these changes").click();
    expect(settings.get("t.budget")).toBe(64);
    expect(settings.get("t.cap")).toBe(30);
    expect(status(panel.element).textContent).toBe("Matches Lean");
    expect(status(loading.element).textContent).toBe("Matches Lean");
    // Lean has no value in the camera section, which still matches Defaults.
    expect(status(camera.element).textContent).toBe("Matches Defaults");

    settings.set("t.budget", 96);
    expect(status(panel.element).textContent).toBe("Custom");
    expect(status(loading.element).textContent).toBe("Custom");

    // Back to the defaults: the reset is listed, from and to, like any change.
    button(block("defaults"), "Apply…").click();
    const back = block("defaults").querySelector<HTMLElement>(".foss-earth-preset__confirm")!;
    expect([...back.querySelectorAll("li")].map(item => item.textContent)).toEqual(["Budget: 96 MiB → 128 MiB", "Cap: 30 fps → Off"]);
    button(back, "Apply these changes").click();
    expect(settings.inspect("t.budget").provenance).toBe("default");
    expect(status(panel.element).textContent).toBe("Matches Defaults");
  });

  it("saves a section as a preset, then renames, exports and deletes it", () => {
    const { settings, panel, loading, block, button, status } = setup();
    settings.set("t.budget", 256);
    settings.set("t.key", "a secret");
    expect(status(loading.element).textContent).toBe("Custom");

    const save = loading.element.querySelector<HTMLElement>(".foss-earth-preset-save")!;
    button(save, "Save as preset").click();
    const name = save.querySelector<HTMLInputElement>("input")!;
    name.value = "Big budget";
    button(save, "Save").click();
    expect(save.querySelector("[role=status]")!.textContent).toMatch(/^Saved 2 values of .+ as “Big budget”/);

    const saved = settings.listPresets().find(preset => preset.name === "Big budget")!;
    expect(saved.values).toEqual({ "t.budget": 256, "t.cap": "off" });
    expect(status(loading.element).textContent).toBe("Matches Big budget");
    // Every value it sets holds, and no preset with more values matches.
    expect(status(panel.element).textContent).toBe("Matches Big budget");
    settings.set("t.tilt", 30);
    expect(status(panel.element).textContent).toBe("Matches Big budget");
    settings.reset("t.tilt");

    expect(block(saved.id).querySelector(".foss-earth-choices__heading")!.textContent).toBe("Big budget (yours)");
    const exported = button(block(saved.id), "Export") as HTMLAnchorElement;
    expect(JSON.parse(decodeURIComponent(exported.href.split(",").slice(1).join(",")))).toMatchObject({ name: "Big budget", values: saved.values });

    button(block(saved.id), "Rename").click();
    const field = block(saved.id).querySelector<HTMLInputElement>(".foss-earth-parameter__text")!;
    field.value = "Roomy";
    button(block(saved.id), "Rename").click();
    expect(block(saved.id).querySelector(".foss-earth-choices__heading")!.textContent).toBe("Roomy (yours)");

    button(block(saved.id), "Delete").click();
    expect(settings.listPresets().some(preset => preset.id === saved.id)).toBe(true);
    button(block(saved.id), "Delete Roomy?").click();
    expect(settings.listPresets().some(preset => preset.id === saved.id)).toBe(false);
    expect(block(saved.id)).toBeNull();
    expect(status(loading.element).textContent).toBe("Custom");
  });

  it("offers no Save as preset where nothing could be saved", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    settings.register([{ ...base, id: "s.key", label: "Key", description: "A secret.", unit: "none", kind: "text", default: "", sensitive: true, home: { tab: "map", section: "source", level: "main" } }]);
    const section = createParameterSection(settings, { tab: "map", section: "source" });
    expect(section.element.querySelector<HTMLElement>(".foss-earth-preset-save")!.hidden).toBe(true);
    expect(section.element.querySelector<HTMLElement>(".foss-earth-preset-status")!.hidden).toBe(true);
  });
});
