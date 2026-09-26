// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobeViewState } from "../engine/types";

// Node 26+ ships an experimental localStorage global that is undefined when
// --localStorage-file is not provided, shadowing jsdom's own implementation.
// Replacing it with an in-memory Map lets beforeEach call .clear() safely.
const _lsStore = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => _lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { _lsStore.set(k, String(v)); },
  removeItem: (k: string) => { _lsStore.delete(k); },
  clear: () => { _lsStore.clear(); },
  key: (i: number) => Array.from(_lsStore.keys())[i] ?? null,
  get length() { return _lsStore.size; },
});

const mockState = vi.hoisted(() => ({
  frameCallback: null as (() => void) | null,
  removeObserver: vi.fn(),
  createBabylonRuntime: vi.fn(),
  runtimeDestroy: vi.fn(),
  getViewState: vi.fn(),
  setViewState: vi.fn(),
  setOrbitMode: vi.fn(),
  setInputMode: vi.fn(),
  setInputSensitivity: vi.fn(),
  configureOrbitTargetHeight: vi.fn(),
  runtimeGetTileMetrics: vi.fn(),
  poiExitTracking: vi.fn(),
  poiGetOrbitTarget: vi.fn(),
  poiDestroy: vi.fn(),
  registryAddLayer: vi.fn(),
  registryRemoveLayer: vi.fn(),
  registryDestroy: vi.fn(),
  compassUpdate: vi.fn(),
  compassDestroy: vi.fn(),
  cullingUpdate: vi.fn(),
  cullingGetStats: vi.fn(),
  cullingDestroy: vi.fn(),
  compassSetScaleParams: vi.fn(),
  perfUpdate: vi.fn(),
  perfFormat: vi.fn(),
  resolveAnchorHeight: vi.fn(),
  resolveAnchorHeightMeters: vi.fn(),
  clearAnchorHeights: vi.fn(),
}));

vi.mock("../engine/babylon/createBabylonRuntime", () => ({
  createBabylonRuntime: mockState.createBabylonRuntime,
}));

vi.mock("../layers/poiTracking", () => ({
  createPoiTracking: () => ({
    setPois: vi.fn(),
    enterTracking: vi.fn(),
    exitTracking: mockState.poiExitTracking,
    isTracking: vi.fn(() => false),
    getOrbitTarget: mockState.poiGetOrbitTarget,
    destroy: mockState.poiDestroy,
  }),
}));

vi.mock("../layers/layerRegistry", () => ({
  createLayerRegistry: () => ({
    addLayer: mockState.registryAddLayer,
    removeLayer: mockState.registryRemoveLayer,
    destroy: mockState.registryDestroy,
  }),
}));

vi.mock("../visualization/orbitCompass", () => ({
  DEFAULT_ORBIT_COMPASS_SCALE_PARAMS: {
    radiusScale: 0.035,
    minRadius: 750,
    maxRadius: 240_000,
    labelSizeScale: 0.16,
  },
  createOrbitCompass: () => ({
    update: mockState.compassUpdate,
    setScaleParams: mockState.compassSetScaleParams,
    isMesh: vi.fn(() => false),
    destroy: mockState.compassDestroy,
  }),
}));

vi.mock("../perf/culling", () => ({
  createHemisphereCulling: () => ({
    setCullables: vi.fn(),
    update: mockState.cullingUpdate,
    getStats: mockState.cullingGetStats,
    destroy: mockState.cullingDestroy,
  }),
}));

vi.mock("../perf/metrics", () => ({
  createPerformanceMetrics: () => ({
    update: mockState.perfUpdate,
    getSnapshot: vi.fn(),
    format: mockState.perfFormat,
  }),
}));

vi.mock("../terrain/anchorHeight", () => ({
  createAnchorHeightResolver: () => ({
    resolve: mockState.resolveAnchorHeight,
    resolveHeight: mockState.resolveAnchorHeightMeters,
    setSample: vi.fn(),
    getCachedHeight: vi.fn(() => null),
    clear: mockState.clearAnchorHeights,
    setHeightOffset: vi.fn(),
  }),
}));

const viewState: GlobeViewState = {
  latDeg: 44.977753,
  lonDeg: -93.265011,
  headingDeg: 17,
  pitchDeg: 71,
  zoomMeters: 600,
};

/** A parameter's input inside a tab section's element. */
function parameterInput(section: HTMLElement | undefined, id: string): HTMLInputElement {
  const input = section?.querySelector<HTMLInputElement>(`[data-parameter="${id}"] input`);
  if (!input) throw new Error(`No control for ${id}`);
  return input;
}

function sectionElement(sections: readonly { id: string; element?: HTMLElement }[], id: string): HTMLElement {
  const element = sections.find(section => section.id === id)?.element;
  if (!element) throw new Error(`No section ${id}`);
  return element;
}

/** Stands in for the WindowOverlay the host mounts, recording what the toolbar asks of it. */
function fakeOverlay() {
  return { current: { openOrSelectTab: vi.fn(), toggleTab: vi.fn() } };
}

async function createAppUnderTest(options: import("./createGlobeApp").GlobeAppOptions = {}) {
  const { createGlobeApp } = await import("./createGlobeApp");
  const root = document.createElement("div");
  document.body.append(root);
  const app = await createGlobeApp(root, options);
  return { app, root };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.frameCallback = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ object: { sha: "8b0ab4ed380c4c57f87a1f0da8830e19e305df70" } }),
  })));

  mockState.getViewState.mockReturnValue(viewState);
  mockState.runtimeGetTileMetrics.mockReturnValue({ visibleTiles: 3, activeTiles: 5 });
  mockState.poiGetOrbitTarget.mockReturnValue(null);
  mockState.cullingUpdate.mockReturnValue({ total: 4, visible: 3, hidden: 1 });
  mockState.cullingGetStats.mockReturnValue({ total: 4, visible: 3, hidden: 1 });
  mockState.perfUpdate.mockReturnValue({
    fps: 60,
    frameMs: 16.7,
    p95FrameMs: 18.2,
    activeMeshes: 42,
    drawCalls: null,
    memoryMb: 43,
    tiles: { visibleTiles: 3, activeTiles: 5 },
    culling: { total: 4, visible: 3, hidden: 1 },
  });
  mockState.perfFormat.mockReturnValue("unused");
  mockState.resolveAnchorHeight.mockReturnValue({ x: 9, y: 0, z: 0 });
  mockState.resolveAnchorHeightMeters.mockReturnValue(264);
  mockState.createBabylonRuntime.mockResolvedValue({
    engine: {
      getFps: () => 60,
      getRenderingCanvas: () => null,
      getRenderWidth: () => 800,
      getRenderHeight: () => 600,
    },
    scene: {
      onBeforeRenderObservable: {
        add: vi.fn((callback: () => void) => {
          mockState.frameCallback = callback;
          return { id: "before-render" };
        }),
        remove: mockState.removeObserver,
      },
    },
    renderer: { mode: "webgl", requested: "auto" },
    status: {
      mode: "raster-basemap",
      message: "USGS Imagery Topo raster basemap active.",
      googleApiKeyProvided: false,
      rasterBaseMap: {
        id: "usgs-imagery-topo",
        label: "USGS Imagery Topo",
        provider: "USGS The National Map",
        protocol: "arcgis-tile",
        urlTemplate: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
        attribution: "USGS The National Map",
        attributionUrl: "https://www.usgs.gov/information-policies-and-instructions/acknowledging-or-crediting-usgs",
      },
      lastError: null,
    },
    geospatialCamera: {
      center: { x: 1, y: 0, z: 0 },
      globalPosition: { x: 2, y: 0, z: 0 },
      radius: 600,
    },
    getViewState: mockState.getViewState,
    setViewState: mockState.setViewState,
    setOrbitMode: mockState.setOrbitMode,
    setInputMode: mockState.setInputMode,
    setInputSensitivity: mockState.setInputSensitivity,
    configureOrbitTargetHeight: mockState.configureOrbitTargetHeight,
    getTileMetrics: mockState.runtimeGetTileMetrics,
    requestRender: vi.fn(),
    beginContinuous: vi.fn(),
    endContinuous: vi.fn(),
    setPaused: vi.fn(),
    isRendering: vi.fn(() => false),
    onActiveRenderChange: vi.fn(() => vi.fn()),
    getMapDownloadBytesPerSecond: vi.fn(() => 0),
    onMapDownloadRateChange: vi.fn(() => vi.fn()),
    isStreamingTiles: vi.fn(() => false),
    onTilesStreamingChange: vi.fn(() => vi.fn()),
    onDetailAdjusted: vi.fn(() => vi.fn()),
    setMapSource: vi.fn(),
    setTerrainSource: vi.fn(),
    getGoogleTerrainDetailState: vi.fn(() => null),
    setGoogleTerrainDetailTarget: vi.fn(),
    setRasterDetailTarget: vi.fn(),
    getRasterDetailFeedback: vi.fn(() => null),
    onRasterDetailFeedback: vi.fn(() => vi.fn()),
    subscribeStatus: vi.fn(() => vi.fn()),
    getGlobeAnchorRotation: vi.fn(() => true),
    setGlobeAnchorRotation: vi.fn(),
    destroy: mockState.runtimeDestroy,
  });
});

describe("createGlobeApp smoke behavior", () => {
  it("boots the raster basemap shell and updates HUD/perf state on the frame callback", async () => {
    const { root } = await createAppUnderTest();

    expect(mockState.createBabylonRuntime).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ googleApiKey: null }),
    );
    expect(root.querySelector(".map-source-hud .map-source-label")?.textContent).toBe("USGS Imagery Topo");
    expect(Array.from(root.querySelector(".hud-bar")?.children ?? []).slice(0, 3).map((el) => el.id)).toEqual([
      "northButton",
      "helpButton",
      "settingsButton",
    ]);
    const hudChildren = Array.from(root.querySelector(".hud-bar")?.children ?? []);
    const inputModeControl = root.querySelector("#inputModeButton")?.closest(".input-mode-control");
    expect(inputModeControl).not.toBeNull();
    expect(hudChildren.indexOf(inputModeControl as Element)).toBe(hudChildren.indexOf(root.querySelector("#themeButton") as Element) + 1);
    expect(hudChildren.indexOf(inputModeControl as Element)).toBe(hudChildren.indexOf(root.querySelector("#rendererModePill") as Element) - 1);
    expect(root.querySelector("#settingsBuildLine")?.textContent).toMatch(
      /^Build: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(root.querySelector("#settingsSourceLine")?.textContent).toMatch(/^Source: [\w.-]+$/);
    expect(root.querySelector("#settingsBundleLine")?.textContent).toMatch(/^Bundle: (dev|index-[\w-]+\.js)$/);
    await vi.waitFor(() => {
      expect(root.querySelector("#settingsDeployLine")?.textContent).toBe("Deploy: 8b0ab4ed380c");
    });
    expect(mockState.configureOrbitTargetHeight).toHaveBeenCalledWith({
      resolveSurfaceHeightMeters: mockState.resolveAnchorHeightMeters,
      initialOffsetMeters: 0,
    });

    mockState.frameCallback?.();

    expect(root.querySelector("#hudStatus")?.textContent).toBe("44.9778°N 93.2650°W h017° p71° z600m");
    expect(Array.from(root.querySelectorAll("#perfMetricsPill .perf-chip")).map((el) => el.textContent)).toEqual([
      "60fps",
      "43MB",
    ]);
    expect(root.querySelector('#perfMetricsPill [data-perf-metric="activeMeshes"]')).toBeNull();
    expect(root.querySelector('#perfMetricsPill [data-perf-metric="tiles"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('#perfMetricsPill [data-perf-metric="memory"]')?.title).toBe(
      "Approximate JavaScript heap memory currently used by the page.",
    );
    expect(mockState.resolveAnchorHeight).toHaveBeenCalledWith({ x: 1, y: 0, z: 0 });
    expect(mockState.compassUpdate).toHaveBeenCalledWith({ x: 9, y: 0, z: 0 }, 600);
  });

  it("keeps the FPS chip mounted across frame updates so its animation can advance", async () => {
    const { root } = await createAppUnderTest();
    mockState.frameCallback?.();
    const group = root.querySelector("#perfMetricsPill")!;
    const fps = group.querySelector('[data-perf-metric="fps"]');
    expect(fps).not.toBeNull();
    const observer = new MutationObserver(() => {});
    observer.observe(group, { childList: true });
    const snapshot = mockState.perfUpdate.mock.results.at(-1)?.value;
    mockState.perfUpdate.mockReturnValueOnce({ ...snapshot, fps: 45 });
    mockState.frameCallback?.();
    expect(group.querySelector('[data-perf-metric="fps"]')).toBe(fps);
    expect(fps?.textContent).toBe("45fps");
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it("toggles hidden performance metrics from settings", async () => {
    const { root, app } = await createAppUnderTest();
    const performance = sectionElement(app.settingsSections, "performance");
    const activeMeshesInput = parameterInput(performance, "interface.performanceHud.activeMeshes");
    const tilesInput = parameterInput(performance, "interface.performanceHud.tiles");

    expect(activeMeshesInput?.checked).toBe(false);
    expect(tilesInput?.checked).toBe(false);

    mockState.frameCallback?.();
    expect(root.querySelector('#perfMetricsPill [data-perf-metric="activeMeshes"]')).toBeNull();
    expect(root.querySelector('#perfMetricsPill [data-perf-metric="tiles"]')).toBeNull();

    if (activeMeshesInput) activeMeshesInput.checked = true;
    activeMeshesInput?.dispatchEvent(new Event("change", { bubbles: true }));
    if (tilesInput) tilesInput.checked = true;
    tilesInput?.dispatchEvent(new Event("change", { bubbles: true }));

    expect(Array.from(root.querySelectorAll("#perfMetricsPill .perf-chip")).map((el) => el.textContent)).toContain("42⬟");
    expect(Array.from(root.querySelectorAll("#perfMetricsPill .perf-chip")).map((el) => el.textContent)).toContain("3/5t");
    expect(root.querySelector<HTMLElement>('#perfMetricsPill [data-perf-metric="activeMeshes"]')?.title).toBe(
      "Babylon meshes currently active in the scene.",
    );
  });

  it("toggles a tab from each toolbar button, and pops up no menu", async () => {
    const overlay = fakeOverlay();
    const { root } = await createAppUnderTest({ overlayApiRef: overlay });

    for (const [button, tab] of [
      ["#settingsButton", "settings"],
      ["#inputModeButton", "controls"],
      ["#hudStatus", "location"],
      ["#rendererModePill", "renderer"],
      [".map-source-hud__provider", "map"],
    ]) {
      root.querySelector<HTMLButtonElement>(button)!.click();
      expect(overlay.current.toggleTab).toHaveBeenLastCalledWith(tab);
    }
    expect(overlay.current.toggleTab).toHaveBeenCalledTimes(5);
    expect(root.querySelector("#hudStatus")).toBeInstanceOf(HTMLButtonElement);
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(root.querySelector("[aria-haspopup]")).toBeNull();
  });

  it("offers the basemap and elevation choice in a Map tab", async () => {
    const { app } = await createAppUnderTest();
    // A radio only reports a change while it is in the document, as it is once the tab is open.
    document.body.append(app.mapTab);
    const checked = (name: string) => app.mapTab.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;

    expect(checked("foss-earth-map-source")).toBe("usgs-imagery-topo");
    expect(app.mapTab.querySelector<HTMLElement>('[aria-label="Elevation provider"]')!.hidden).toBe(false);
    // Detail has its one home in the Map tab, beside the basemap choice.
    expect(app.mapTab.querySelectorAll('[aria-label="Detail"]')).toHaveLength(1);

    // Choosing saves the parameter, which the runtime follows; the old URL parameter goes.
    window.history.replaceState(null, "", "/?mapSource=usgs-topo");
    const google = app.mapTab.querySelector<HTMLInputElement>('input[name="foss-earth-map-source"][value="google"]')!;
    google.click();
    const { getAppSettings } = await import("../settings/appSettings");
    expect(getAppSettings().get("map.source.basemap")).toBe("google");
    expect(new URL(window.location.href).searchParams.has("mapSource")).toBe(false);

    const terrarium = app.mapTab.querySelector<HTMLInputElement>('input[name="foss-earth-elevation-source"][value="aws-terrarium"]')!;
    terrarium.click();
    expect(getAppSettings().get("map.source.elevation")).toBe("aws-terrarium");
    // Keys and the map cache have their homes in the same tab.
    expect(app.mapTab.querySelector('[data-parameter="map.source.googleKey"]')).not.toBeNull();
    expect(app.mapTab.querySelector(".foss-earth-map-cache-section")).not.toBeNull();
    expect([...app.mapTab.querySelectorAll(".foss-earth-panel-section__title")].map(title => title.textContent)).toEqual([
      "Source", "Detail", "Automatic adjustment", "Loading and memory", "Imagery selection", "Terrain selection",
    ]);
  });

  it("ends the bar at the bottom right with the detail rail, then the speed and basemap, then its credit link", async () => {
    const { root } = await createAppUnderTest();
    const bar = root.querySelector(".hud-bar")!;
    const end = bar.lastElementChild!;
    expect(end.id).toBe("mapSourceSlot");
    const chip = end.querySelector(".map-source-hud__chip")!;
    expect(Array.from(chip.children, (child) => child.className)).toEqual([
      "map-source-hud__provider",
      "map-source-hud__credit",
    ]);
    expect(chip.firstElementChild!.firstElementChild!.className).toBe("map-download-speed");
    const credit = chip.querySelector<HTMLAnchorElement>(".map-source-hud__credit")!;
    expect(credit.href).toContain("usgs.gov");
    expect(credit.target).toBe("_blank");
    const rail = chip.previousElementSibling!;
    expect(rail.classList.contains("map-detail-control")).toBe(true);
    expect(rail.classList.contains("is-unavailable")).toBe(true);
    // The rail stays still while the renderer reports no raster detail.
    expect(rail.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(root.textContent).not.toContain("Terrain attribution");
  });

  it("offers the renderer choice in a Renderer tab, and nowhere else", async () => {
    const { app, root } = await createAppUnderTest();

    expect(app.rendererTab.textContent).toContain("Running on WebGL, chosen automatically.");
    expect(app.rendererTab.querySelector<HTMLInputElement>("input:checked")?.value).toBe("auto");
    expect(root.querySelector("#settingsRendererLine")).toBeNull();
  });

  it("toggles globe anchor rotation pan from Controls → Camera", async () => {
    const { app } = await createAppUnderTest();
    const toggle = parameterInput(sectionElement(app.controlsSections, "camera"), "input.globeAnchorRotation");
    const setGlobeAnchorRotation = vi.mocked(app.runtime.setGlobeAnchorRotation);

    expect(toggle?.checked).toBe(true);
    if (toggle) toggle.checked = false;
    toggle?.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setGlobeAnchorRotation).toHaveBeenCalledWith(false);
  });

  it("logs what automatic adjustment did and why", async () => {
    const { app, root } = await createAppUnderTest();
    const adjusted = vi.mocked(app.runtime.onDetailAdjusted).mock.calls[0][0];
    adjusted({ at: 0, from: 0, to: 0.25, meanFrameMs: 23.14, goalMs: 16.7 });
    adjusted({ at: 1, from: 0.25, to: 0, meanFrameMs: 12, goalMs: 16.7 });
    const text = `${root.textContent ?? ""}${document.body.textContent ?? ""}`;
    expect(text).toContain("Map detail coarsened 0.25 levels to hold the frame time: frames averaged 23.1 ms against a 16.7 ms goal.");
    expect(text).toContain("Map detail returned 0.25 levels toward what you asked for");
  });

  it("splits its sections between a Controls tab and a Settings tab", async () => {
    const { app } = await createAppUnderTest();

    expect(app.controlsSections.map(({ id, title, defaultOpen }) => [id, title, defaultOpen])).toEqual([
      ["input-method", "Input method", true],
      ["camera", "Camera", false],
      ["orbit", "Orbit", false],
      ["mouse", "Mouse and trackpad", false],
      ["touch", "Touch", false],
      ["controller", "Controller", false],
    ]);
    // The camera's limits and each device's rates have their controls there.
    const controls = (id: string) => [...sectionElement(app.controlsSections, id).querySelectorAll("[data-parameter]")]
      .map(element => element.getAttribute("data-parameter"));
    expect(controls("camera")).toEqual(expect.arrayContaining([
      "camera.fieldOfView", "camera.pitchLimits", "camera.zoomLimits", "camera.inertiaDecay", "input.globeAnchorRotation", "visualization.compass.heightOffset",
    ]));
    expect(controls("mouse")).toEqual(expect.arrayContaining(["input.mouse.orbitRate", "input.mouse.dragThreshold", "input.wheel.zoomRate"]));
    expect(controls("touch")).toEqual(expect.arrayContaining(["input.touch.orbitRate", "input.touch.panRate", "input.touch.zoomExponent"]));
    expect(controls("controller")).toContain("input.gamepad.deadzone");
    expect(app.settingsSections.map(({ id, title }) => [id, title])).toEqual([
      ["toolbar", "Toolbar"],
      ["performance", "Performance debug"],
      ["saved-settings", "Saved settings"],
      ["about", "About"],
    ]);
    const performance = sectionElement(app.settingsSections, "performance");
    expect(performance.querySelector('[data-parameter="interface.performanceHud.fps"]')).not.toBeNull();
    // Every section can list all its parameters.
    expect(performance.querySelector(".foss-earth-parameter-section__toggle")).not.toBeNull();
  });

  it("shows every toolbar button until one is hidden in Settings, and remembers it", async () => {
    const first = await createAppUnderTest();
    for (const id of ["helpButton", "settingsButton", "themeButton"]) {
      expect(first.root.querySelector<HTMLElement>(`#${id}`)!.hidden).toBe(false);
    }
    expect(first.root.querySelector<HTMLElement>(".input-mode-control")!.hidden).toBe(false);

    // A checkbox only reports a change while it is in the document, as it is once the tab is open.
    document.body.append(sectionElement(first.app.settingsSections, "toolbar"));
    const help = parameterInput(sectionElement(first.app.settingsSections, "toolbar"), "interface.toolbar.help");
    expect(help.checked).toBe(true);
    help.click();
    expect(first.root.querySelector<HTMLElement>("#helpButton")!.hidden).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("foss-earth.settings.v1")!).values).toMatchObject({ "interface.toolbar.help": false });
    first.app.destroy();

    const { resetAppSettings } = await import("../settings/appSettings");
    resetAppSettings();
    const second = await createAppUnderTest();
    expect(second.root.querySelector<HTMLElement>("#helpButton")!.hidden).toBe(true);
    expect(parameterInput(sectionElement(second.app.settingsSections, "toolbar"), "interface.toolbar.help").checked).toBe(false);
    expect(second.root.querySelector<HTMLElement>("#themeButton")!.hidden).toBe(false);
  });

  it("keeps input method settings only in Controls, where its toolbar button leads", async () => {
    const overlay = fakeOverlay();
    const { app, root } = await createAppUnderTest({ overlayApiRef: overlay });

    root.querySelector<HTMLButtonElement>("#inputModeButton")!.click();
    expect(overlay.current.toggleTab).toHaveBeenCalledWith("controls");
    const inputMethod = app.controlsSections.find((section) => section.id === "input-method")!.element!;
    expect(inputMethod.querySelectorAll(".input-mode-inline")).toHaveLength(1);
    expect(root.querySelectorAll(".input-mode-inline")).toHaveLength(0);

    document.body.append(sectionElement(app.settingsSections, "toolbar"));
    parameterInput(sectionElement(app.settingsSections, "toolbar"), "interface.toolbar.inputMode").click();
    expect(root.querySelector<HTMLElement>(".input-mode-control")!.hidden).toBe(true);
    // jsdom reports a fine pointer and no touch: a desktop, so the choice is there.
    const pointer = inputMethod.querySelector<HTMLButtonElement>(".input-mode-toggle-option:not(.is-active)")!;
    pointer.click();
    expect(mockState.setInputMode).toHaveBeenLastCalledWith(pointer.dataset.mode);
  });

  it("keeps controller bindings in the Controls tab, not a corner panel", async () => {
    const overlay = fakeOverlay();
    const { app, root } = await createAppUnderTest({ overlayApiRef: overlay });

    expect(root.querySelector(".gt-launcher")).toBeNull();
    expect(root.querySelector(".gt-host-panel")).toBeNull();
    const controller = app.controlsSections.find((section) => section.id === "controller")!.element!;
    // The binding editor, then the section's own parameters.
    const editor = controller.querySelector(".gt-root");
    expect(editor).not.toBeNull();
    expect(editor!.childElementCount).toBeGreaterThan(0);

    app.openControllerBindings();
    expect(overlay.current.openOrSelectTab).toHaveBeenCalledWith("controls");
    expect(overlay.current.toggleTab).not.toHaveBeenCalled();
  });

  it("mounts the input method button in the HUD bar, with no popup", async () => {
    const { root } = await createAppUnderTest();
    expect(root.querySelector("#inputModeButton")).not.toBeNull();
    expect(root.querySelector("#inputModeMenu")).toBeNull();
  });

  it("shows and applies the compass scale tuner from settings", async () => {
    const { root, app } = await createAppUnderTest();
    const toggle = parameterInput(sectionElement(app.settingsSections, "performance"), "interface.compassScaleTuner");
    const tuner = root.querySelector<HTMLElement>(".compass-scale-tuner");

    expect(toggle?.checked).toBe(false);
    expect(tuner?.hidden).toBe(true);

    if (toggle) toggle.checked = true;
    toggle?.dispatchEvent(new Event("change", { bubbles: true }));

    expect(tuner?.hidden).toBe(false);

    const radiusScaleInput = root.querySelector<HTMLInputElement>('.compass-scale-tuner input[data-field="radiusScale"]');
    const applyButton = root.querySelector<HTMLButtonElement>(".compass-scale-tuner .poi-sprite-tuner-apply");

    if (radiusScaleInput) radiusScaleInput.value = "0.05";
    radiusScaleInput?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(applyButton?.hidden).toBe(false);

    applyButton?.click();

    expect(mockState.compassSetScaleParams).toHaveBeenCalledWith({
      radiusScale: 0.05,
      minRadius: 750,
      maxRadius: 240_000,
      labelSizeScale: 0.16,
    });
  });

  it("passes URL API keys through runtime startup", async () => {
    window.history.replaceState(null, "", "/?key=test-key");

    await createAppUnderTest();

    expect(mockState.createBabylonRuntime).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ googleApiKey: "test-key" }),
    );
  });

  it("lets the map source preference force a raster basemap", async () => {
    window.history.replaceState(null, "", "/?key=test-key&mapSource=usgs-topo");

    await createAppUnderTest();

    expect(mockState.createBabylonRuntime).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({
        googleApiKey: "test-key",
        preferGoogleTiles: false,
        rasterBaseMap: expect.objectContaining({ id: "usgs-topo" }),
      }),
    );
  });

  it("exits POI tracking before north-up reset", async () => {
    const { root } = await createAppUnderTest();

    root.querySelector<HTMLButtonElement>("#northButton")?.click();

    expect(mockState.poiExitTracking).toHaveBeenCalledTimes(1);
    expect(mockState.setViewState).toHaveBeenCalledWith({ headingDeg: 0, pitchDeg: 89 });
  });

  it("delegates layer lifecycle through the registry", async () => {
    const { app } = await createAppUnderTest();
    const layer = {
      id: "smoke-layer",
      setup: vi.fn(() => ({})),
      destroy: vi.fn(),
    };

    app.addLayer(layer);
    app.removeLayer("smoke-layer");

    expect(mockState.registryAddLayer).toHaveBeenCalledWith(layer);
    expect(mockState.registryRemoveLayer).toHaveBeenCalledWith("smoke-layer");
  });

  it("tears down observers, feature handles, runtime, and DOM", async () => {
    const { app, root } = await createAppUnderTest();

    app.destroy();

    expect(mockState.removeObserver).toHaveBeenCalledWith({ id: "before-render" });
    expect(mockState.poiDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.registryDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.cullingDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.compassDestroy).toHaveBeenCalledTimes(1);
    expect(mockState.runtimeDestroy).toHaveBeenCalledTimes(1);
    expect(root.childElementCount).toBe(0);
  });
});
