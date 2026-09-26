import { describe, expect, it } from "vitest";
import { FOSS_EARTH_PARAMETERS } from "./catalogue";
import { BUILT_IN_PRESETS } from "./presets";
import { createSettingsRegistry, type SettingsStorage } from "./registry";

function registry() {
  const data = new Map<string, string>();
  const storage: SettingsStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
  const settings = createSettingsRegistry({ storage, deviceContext: { maxTextureSize: 16384, rendererMode: "webgl2" } });
  settings.register(FOSS_EARTH_PARAMETERS);
  settings.registerPresets(BUILT_IN_PRESETS);
  return settings;
}

describe("built-in presets", () => {
  it("are the four the spec names, each a description and values the catalogue accepts", () => {
    expect(BUILT_IN_PRESETS.map(preset => preset.name)).toEqual(["This device", "Save battery and data", "Sharpest", "Smooth motion"]);
    const settings = registry();
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.description.length, preset.id).toBeGreaterThan(20);
      expect(settings.diffPreset(preset).rejected, preset.id).toEqual([]);
      for (const entry of preset.reset ?? []) {
        expect(FOSS_EARTH_PARAMETERS.some(spec => (entry.endsWith(".") ? spec.id.startsWith(entry) : spec.id === entry)), entry).toBe(true);
      }
    }
  });

  it("apply by copying, match until a value changes, and This device returns every value it lists to its default", () => {
    const settings = registry();
    const [thisDevice, battery, sharpest] = BUILT_IN_PRESETS;
    // Nothing changed yet: the device's own values.
    expect(settings.matchingPreset()?.id).toBe(thisDevice.id);
    settings.set("map.source.googleKey", "a key the presets never touch");

    const diff = settings.diffPreset(battery);
    expect(diff.changes.map(change => change.id)).toContain("renderer.frameRateCap");
    settings.applyPreset(battery);
    expect(settings.get("renderer.frameRateCap")).toBe(30);
    expect(settings.inspect("renderer.frameRateCap")).toMatchObject({ provenance: "preset", preset: battery.name });
    expect(settings.matchingPreset()?.id).toBe(battery.id);

    // Any edit makes it Custom.
    settings.set("map.imagery.gpuBudget", 96);
    expect(settings.matchingPreset()).toBeNull();

    settings.applyPreset(sharpest);
    expect(settings.get("map.focus.mode")).toBe("both");

    // Back to the device's defaults: every value that differs is listed, then reset.
    const back = settings.diffPreset(thisDevice);
    expect(back.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "map.imagery.gpuBudget", from: 512, to: settings.inspect("map.imagery.gpuBudget").defaultValue }),
      expect.objectContaining({ id: "renderer.frameRateCap", from: 30, to: "off" }),
    ]));
    expect(back.changes.some(change => change.id === "map.source.googleKey")).toBe(false);
    settings.applyPreset(thisDevice);
    expect(settings.inspect("map.imagery.gpuBudget").provenance).toBe("default");
    expect(settings.get("renderer.frameRateCap")).toBe("off");
    expect(settings.get("map.source.googleKey")).toBe("a key the presets never touch");
    expect(settings.matchingPreset()?.id).toBe(thisDevice.id);
  });
});
