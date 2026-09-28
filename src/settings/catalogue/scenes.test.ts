import { describe, expect, it } from "vitest";
import { MIB, rgba8Bytes } from "../../scenes/budget";
import { createSettingsRegistry } from "../registry";
import { PANORAMA_SETTINGS_TAB, PANORAMA_TAB, SCENE_PARAMETERS, SCENES_TAB } from "./scenes";

function registry(maxTextureSize: number | null) {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(SCENE_PARAMETERS);
  if (maxTextureSize) settings.setDeviceContext({ maxTextureSize });
  return settings;
}

const number = (settings: ReturnType<typeof registry>, id: string) => settings.get<number>(id);

describe("the scene parameters' defaults", () => {
  it("load the largest image the renderer can hold, next to a scene's worth of previews", () => {
    for (const side of [8192, 16384]) {
      const settings = registry(side);
      const widest = rgba8Bytes(side, side / 2);
      // The campus tour: 60 orbs with 256 px preview faces on a screen of two device pixels per CSS pixel.
      const previews = 60 * rgba8Bytes(256, 256, undefined, 6);
      expect(number(settings, "scene.panorama.immersionWidth")).toBe(side);
      // The image on screen and a sharper one replacing it, beside the previews.
      expect(previews + 2 * widest).toBeLessThanOrEqual(number(settings, "scene.panorama.sourceGpuMiB") * MIB);
      expect(widest).toBeLessThanOrEqual(number(settings, "scene.panorama.overlapMiB") * MIB);
      expect(4 * side * (side / 2)).toBeLessThanOrEqual(number(settings, "scene.panorama.decodedMiB") * MIB);
      expect(settings.inspect("scene.panorama.sourceGpuMiB").defaultDerivedFrom).toContain(`this renderer's ${side} px texture limit`);
      for (const id of ["scene.panorama.sourceGpuMiB", "scene.panorama.overlapMiB", "scene.panorama.decodedMiB"]) {
        expect(settings.inspect(id).note, id).toBeNull();
      }
    }
    // The fixed 128 MiB these replace held those previews with 8 MiB to spare: not even a 2048 px image.
    expect(60 * rgba8Bytes(256, 256, undefined, 6) + rgba8Bytes(2048, 1024)).toBeGreaterThan(128 * MIB);
  });

  it("assume WebGPU's default 8192 px texture limit until the renderer reports its own", () => {
    const settings = registry(null);
    expect(number(settings, "scene.panorama.immersionWidth")).toBe(8192);
    expect(number(settings, "scene.panorama.sourceGpuMiB")).toBe(470);
    expect(number(settings, "scene.panorama.overlapMiB")).toBe(171);
    expect(number(settings, "scene.panorama.decodedMiB")).toBe(144);
  });

  it("stay within their bounds on a renderer with a still larger limit", () => {
    const settings = registry(32768);
    for (const id of ["scene.panorama.sourceGpuMiB", "scene.panorama.overlapMiB", "scene.panorama.decodedMiB", "scene.panorama.immersionWidth"]) {
      const state = settings.inspect(id);
      expect(state.value as number, id).toBeLessThanOrEqual(state.bounds!.max);
      expect(state.note, id).toBeNull();
    }
  });

  it("home what only matters inside a panorama in its tabs, and what the globe shows in Scenes", () => {
    const home = (id: string) => SCENE_PARAMETERS.find(spec => spec.id === id)!.home;
    expect(home("scene.panorama.immersionWidth")).toEqual({ tab: PANORAMA_TAB, section: "detail", level: "main" });
    for (const id of ["immersionDensity", "verticalFovRange", "pitchRange", "dragSensitivity", "lookRate", "entryOrientation", "orientDuration"]) {
      expect(home(`scene.panorama.${id}`).tab, id).toBe(PANORAMA_SETTINGS_TAB);
    }
    for (const id of ["previewFov", "markerDiameter", "hoverDuration", "expandDuration", "reducedMotion", "sourceGpuMiB", "requests"]) {
      expect(home(`scene.panorama.${id}`).tab, id).toBe(SCENES_TAB);
    }
  });
});
