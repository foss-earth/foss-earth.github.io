// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getAppSettings } from "../appSettings";
import { createSettingsRegistry, SETTINGS_STORAGE_KEY } from "../registry";
import { FOSS_EARTH_PARAMETERS, PERFORMANCE_HUD_METRICS, TOOLBAR_BUTTONS, TOOLBAR_EDIT_PRIORITIES_ID, TOOLBAR_PRIORITIES, toolbarPriorityParameterId } from ".";

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
    expect(settings.get("interface.toolbar.help")).toBe("off");
    expect(settings.get("interface.toolbar.theme")).toBe("auto");
    expect(settings.get("interface.performanceHud.fps")).toBe("off");
    expect(settings.get("interface.performanceHud.frame")).toBe("on");
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
    expect(record.values["interface.performanceHud.memory"]).toBe("off");
    expect(record.values["interface.performanceHud.activeMeshes"]).toBeUndefined();
    expect(localStorage.getItem("foss-earth.theme")).toBe("light");
  });

  it("gives every toolbar chip one three-way control in Interface → Toolbar", () => {
    const settings = getAppSettings();
    const ids = [
      ...TOOLBAR_BUTTONS.map(([button]) => `interface.toolbar.${button}`),
      ...PERFORMANCE_HUD_METRICS.map(([metric]) => `interface.performanceHud.${metric}`),
    ];
    for (const id of ids) {
      const state = settings.inspect(id);
      expect(state.spec.home, id).toEqual({ tab: "interface", section: "toolbar", level: "main" });
      expect(state.spec.kind, id).toBe("choice");
      expect(state.choices.map(choice => [choice.id, choice.label, choice.icon ?? choice.shortLabel]), id).toEqual([
        ["on", "On", "toggle-on"], ["auto", "Auto", "A"], ["off", "Off", "toggle-off"],
      ]);
      expect(state.value, id).toBe(id.startsWith("interface.toolbar.") || id.endsWith(".fps") ? "auto" : "off");
    }
    expect(settings.spec("interface.poiSpriteTuner")?.home).toMatchObject({ tab: "renderer", section: "performance" });
  });

  it("defaults priorities to Auto and pairs Custom fields with each item's visibility control", () => {
    const settings = getAppSettings();
    expect(settings.get(TOOLBAR_EDIT_PRIORITIES_ID)).toBe(false);
    expect(settings.spec(TOOLBAR_EDIT_PRIORITIES_ID)).toMatchObject({ label: "Priorities", booleanControl: "auto-custom" });
    expect(TOOLBAR_PRIORITIES.slice(0, 10).map(([item]) => item)).toEqual([
      "north", "help", "inputMode", "fullscreen", "fps", "renderer", "position", "theme", "settings", "bugReport",
    ]);
    expect(TOOLBAR_PRIORITIES.map(([item]) => item).sort()).toEqual([
      "north", ...TOOLBAR_BUTTONS.map(([button]) => button), ...PERFORMANCE_HUD_METRICS.map(([metric]) => metric),
    ].sort());
    for (const [item, , priority] of TOOLBAR_PRIORITIES) {
      const state = settings.inspect(toolbarPriorityParameterId(item));
      expect(state.value, item).toBe(priority);
      expect(state.bounds, item).toEqual({ min: 0, max: 99 });
      expect(state.spec.step, item).toBe(1);
      expect(state.spec.visibleWhen, item).toEqual({ id: TOOLBAR_EDIT_PRIORITIES_ID, value: true });
      if (item === "north") expect(state.spec.inlineWith).toBeUndefined();
      else {
        const paired = TOOLBAR_BUTTONS.some(([button]) => button === item)
          ? `interface.toolbar.${item}` : `interface.performanceHud.${item}`;
        expect(state.spec.inlineWith, item).toBe(paired);
        expect(settings.spec(paired)?.home, item).toEqual(state.spec.home);
      }
    }
    const renderer = toolbarPriorityParameterId("renderer");
    expect(settings.set(renderer, 1)).toEqual({ ok: true });
    settings.set(TOOLBAR_EDIT_PRIORITIES_ID, true);
    settings.set(TOOLBAR_EDIT_PRIORITIES_ID, false);
    expect(settings.get(renderer)).toBe(1);
    expect(settings.export().values).toEqual({ [renderer]: 1 });
    expect(settings.set(renderer, -1).ok).toBe(false);
    expect(settings.set(renderer, 100).ok).toBe(false);
  });

  it("migrates stored toolbar booleans and saved presets without changing other settings", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      values: { "interface.toolbar.position": true, "interface.performanceHud.fps": false, "app.keepFiles": false },
      presets: { "interface.toolbar.position": "My toolbar" },
      userPresets: [{
        id: "user:my-toolbar", name: "My toolbar", description: "Saved before three-way controls.",
        values: { "interface.toolbar.position": true, "interface.performanceHud.fps": false, "app.keepFiles": false },
      }],
    }));
    const settings = getAppSettings();
    expect(settings.inspect("interface.toolbar.position")).toMatchObject({ value: "on", provenance: "preset", preset: "My toolbar", note: null });
    expect(settings.inspect("interface.performanceHud.fps")).toMatchObject({ value: "off", provenance: "user", note: null });
    expect(settings.get("app.keepFiles")).toBe(false);
    expect(settings.get("interface.toolbar.help")).toBe("auto");
    const expected = { "interface.toolbar.position": "on", "interface.performanceHud.fps": "off", "app.keepFiles": false };
    expect(settings.export().values).toEqual(expected);
    expect(settings.listPresets().find(preset => preset.id === "user:my-toolbar")?.values).toEqual(expected);
    const record = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(record.values).toEqual(expected);
    expect(record.userPresets[0].values).toEqual(expected);

    // Another tab still running the old app may save booleans later.
    record.values["interface.performanceHud.fps"] = true;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(record));
    settings.reload();
    expect(settings.get("interface.performanceHud.fps")).toBe("on");
  });

  it("migrates old imported settings and presets, with matching and export using the named choices", () => {
    const settings = getAppSettings();
    const oldPreset = {
      id: "old-toolbar", name: "Old toolbar", description: "From the boolean UI.",
      values: { "interface.toolbar.help": false, "interface.performanceHud.fps": true },
    };
    expect(settings.diffPreset(oldPreset)).toEqual({
      changes: [
        { id: "interface.toolbar.help", label: "Help (?)", from: "auto", to: "off" },
        { id: "interface.performanceHud.fps", label: "FPS", from: "auto", to: "on" },
      ], rejected: [],
    });
    const imported = settings.importPreset(oldPreset);
    expect("preset" in imported).toBe(true);
    if (!("preset" in imported)) return;
    expect(imported.preset.values).toEqual({ "interface.toolbar.help": "off", "interface.performanceHud.fps": "on" });
    expect(settings.applyPreset(oldPreset).rejected).toEqual([]);
    expect(settings.matchingPreset({ tab: "interface", section: "toolbar" })?.id).toBe(imported.preset.id);
    expect(settings.export().values).toEqual(imported.preset.values);
    expect(settings.import({ "interface.toolbar.help": true, "interface.performanceHud.fps": false }).rejected).toEqual([]);
    expect(settings.get("interface.toolbar.help")).toBe("on");
    expect(settings.get("interface.performanceHud.fps")).toBe("off");
    expect(settings.set("interface.performanceHud.fps", true).ok).toBe(false);
    expect(() => settings.setHostDefault("interface.performanceHud.fps", true, "Old API")).toThrow();
  });

  it.each([["true", "on"], ["false", "off"], ["1", "on"], ["0", "off"], ["yes", "on"], ["no", "off"], ["auto", "auto"]])(
    "keeps old toolbar URL value %s readable as %s", (given, expected) => {
      const settings = createSettingsRegistry({ storage: null, searchParams: new URLSearchParams({ "set.interface.performanceHud.fps": given }) });
      settings.register(FOSS_EARTH_PARAMETERS);
      expect(settings.inspect("interface.performanceHud.fps")).toMatchObject({ value: expected, provenance: "url", note: null });
    },
  );

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
