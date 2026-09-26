// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getAppSettings } from "../appSettings";
import { SETTINGS_STORAGE_KEY } from "../registry";
import { FOSS_EARTH_PARAMETERS } from ".";

describe("FOSS Earth's catalogue", () => {
  it("gives every parameter a unit, a default, a reason, a home and a source", () => {
    const ids = new Set<string>();
    for (const spec of FOSS_EARTH_PARAMETERS) {
      expect(ids.has(spec.id), spec.id).toBe(false);
      ids.add(spec.id);
      expect(spec.label.length, spec.id).toBeGreaterThan(0);
      expect(spec.description.length, spec.id).toBeGreaterThan(0);
      expect(spec.defaultReason.length, spec.id).toBeGreaterThan(0);
      expect(spec.source, spec.id).toMatch(/^src\/.+\.tsx?$/);
      expect(spec.home.tab.length, spec.id).toBeGreaterThan(0);
      if (spec.kind === "number" || spec.kind === "range") expect(spec.bounds, spec.id).toBeTypeOf("function");
      if (spec.kind === "choice") expect(spec.choices?.length ?? 0, spec.id).toBeGreaterThan(0);
    }
    const settings = getAppSettings();
    for (const spec of FOSS_EARTH_PARAMETERS) expect(settings.inspect(spec.id).note, spec.id).toBeNull();
  });

  it("migrates the scattered keys into one record, and leaves them for rollback", () => {
    localStorage.setItem("foss-earth.map-detail.v1", JSON.stringify({ version: 1, policies: {
      google: { kind: "google", finestErrorPx: 2, coarsestErrorPx: 128, defaultValue: { mode: "recommended", policy: "device-hints" } },
      "raster:osm-standard": { kind: "raster", coarseOffset: -2, fineOffset: 0.5, defaultValue: 0.25 },
    } }));
    localStorage.setItem("foss-earth.theme", "light");
    localStorage.setItem("foss-earth.hudButtons", JSON.stringify({ help: false, theme: true }));
    localStorage.setItem("foss-earth.performanceMetricVisibility", JSON.stringify(["frame"]));
    localStorage.setItem("foss-earth.compassHeightOffsetMeters", "5000");
    localStorage.setItem("foss-earth.globeAnchorRotation", "false");
    localStorage.setItem("foss-earth.inputMode", "mouse");
    localStorage.setItem("foss-earth.inputSensitivity", JSON.stringify({ mouse: { pan: 2, zoom: 3 }, touch: { orbit: 0.5 } }));
    localStorage.setItem("foss-earth.inputSensitivityVersion", "1");
    localStorage.setItem("osfs.orbit-invert", JSON.stringify({ invertYaw: true, recenterMode: "recenter" }));
    localStorage.setItem("foss-earth.compass-scale-defaults", JSON.stringify({ radiusScale: 0.05, minRadius: 750, maxRadius: 240000, labelSizeScale: 0.2 }));

    const settings = getAppSettings();
    expect(settings.get("map.detail.google.range")).toEqual({ min: 2, max: 128 });
    expect(settings.get("map.detail.google.default")).toBe("device-hints");
    expect(settings.get("map.detail.imagery.range")).toEqual({ min: -2, max: 0.5 });
    expect(settings.get("map.detail.imagery.default")).toBe(0.25);
    expect(settings.get("interface.theme")).toBe("light");
    expect(settings.get("interface.toolbar.help")).toBe(false);
    expect(settings.get("interface.toolbar.theme")).toBe(true);
    expect(settings.get("interface.performanceHud.fps")).toBe(false);
    expect(settings.get("interface.performanceHud.frame")).toBe(true);
    expect(settings.get("visualization.compass.heightOffset")).toBe(1000);
    expect(settings.get("input.globeAnchorRotation")).toBe(false);
    expect(settings.get("input.mode")).toBe("mouse");
    expect(settings.get("input.sensitivity.mouse.pan")).toBe(2);
    expect(settings.get("input.sensitivity.mouse.zoom")).toBe(3);
    expect(settings.get("input.sensitivity.touch.orbit")).toBe(0.5);
    expect(settings.get("input.orbit.invertYaw")).toBe(true);
    expect(settings.get("input.orbit.invertPitch")).toBe(false);
    expect(settings.get("input.orbit.recenterMode")).toBe("recenter");
    expect(settings.get("visualization.compass.radiusScale")).toBe(0.05);
    expect(settings.get("visualization.compass.minRadius")).toBe(750);

    const record = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    // The tuner saved its four values together, as the user's own defaults.
    expect(record.values["visualization.compass.minRadius"]).toBe(750);
    expect(record.values["interface.performanceHud.memory"]).toBe(false);
    expect(record.values["interface.performanceHud.activeMeshes"]).toBeUndefined();
    expect(localStorage.getItem("foss-earth.theme")).toBe("light");
  });

  it("resets older zoom and touch sensitivities, as the old loader did", () => {
    localStorage.setItem("foss-earth.inputSensitivity", JSON.stringify({ mouse: { pan: 2, zoom: 3 }, touch: { pan: 4 } }));
    const settings = getAppSettings();
    expect(settings.get("input.sensitivity.mouse.pan")).toBe(2);
    expect(settings.get("input.sensitivity.mouse.zoom")).toBe(1);
    expect(settings.get("input.sensitivity.touch.pan")).toBe(1);
  });

  it("reads the URL parameters FOSS Earth has always read", () => {
    window.history.replaceState(null, "", "/?mapSource=google-3d-tiles&elevationSource=aws-terrarium&renderer=webgl2&rasterImagery=legacy&key=abc");
    try {
      const settings = getAppSettings();
      expect(settings.inspect("map.source.basemap")).toMatchObject({ value: "google", provenance: "url" });
      expect(settings.get("map.source.elevation")).toBe("aws-terrarium");
      expect(settings.get("renderer.backend")).toBe("webgl2");
      expect(settings.get("map.detail.imageryPath")).toBe("legacy");
      expect(settings.get("map.source.googleKey")).toBe("abc");
      expect(settings.export().values).toEqual({});
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
