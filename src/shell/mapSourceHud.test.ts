// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { RASTER_BASE_MAP_SOURCES } from "../engine/babylon/rasterBaseMaps";
import { createMapDetailController } from "./mapDetailController";
import { createMapDetailSlider } from "./mapDetailSlider";
import { createMapSourceHud, type MapSourceHudStatus } from "./mapSourceHud";

afterEach(() => document.body.replaceChildren());

const source = (id: string) => RASTER_BASE_MAP_SOURCES.find((entry) => entry.id === id)!;
const raster = (id: string, lastError: string | null = null): MapSourceHudStatus => ({ mode: "raster-basemap", rasterBaseMap: source(id), lastError });

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  let streamingListener: (streaming: boolean) => void = () => {};
  const onProviderClick = vi.fn();
  const hud = createMapSourceHud(container, {
    activity: {
      getMapDownloadBytesPerSecond: () => 2_400_000,
      onMapDownloadRateChange: () => () => {},
      isStreamingTiles: () => false,
      onTilesStreamingChange: (listener) => { streamingListener = listener; return () => {}; },
    },
    onProviderClick,
  });
  const q = <T extends HTMLElement>(selector: string) => hud.element.querySelector<T>(selector)!;
  return { container, hud, onProviderClick, q, stream: (on: boolean) => streamingListener(on) };
}

describe("map source HUD", () => {
  it("makes the speed, logo and name one button that toggles the Map tab, and ends with the credit link", () => {
    const { hud, q, onProviderClick } = mount();
    hud.update(raster("osm-standard"));

    const provider = q<HTMLButtonElement>(".map-source-hud__provider");
    expect(Array.from(provider.children, (child) => child.className))
      .toEqual(["map-download-speed", "map-source-hud__logo", "map-source-hud__wordmark", "map-source-label"]);
    expect(q<HTMLImageElement>(".map-source-hud__logo").hidden).toBe(false);
    expect(q(".map-source-label").textContent).toBe("OpenStreetMap");
    const credit = q<HTMLAnchorElement>(".map-source-hud__credit");
    expect(credit.href).toBe("https://www.openstreetmap.org/copyright");
    expect(credit.rel).toBe("noopener noreferrer");
    expect(credit.querySelector("svg.foss-earth-external-link-icon")).not.toBeNull();
    expect(credit.textContent).toBe("");
    expect(credit.previousElementSibling).toBe(provider);
    expect(credit.nextElementSibling).toBeNull();
    expect(q(".map-download-value").textContent).toBe("002");

    provider.click();
    q(".map-download-speed").click();
    expect(onProviderClick).toHaveBeenCalledTimes(2);
  });

  it("credits every provider, and hides the logo where it has none", () => {
    const { hud, q } = mount();
    for (const entry of RASTER_BASE_MAP_SOURCES) {
      hud.update(raster(entry.id));
      expect(q<HTMLAnchorElement>(".map-source-hud__credit").getAttribute("href")).toMatch(/^https:\/\//);
    }
    hud.update(raster("usgs-imagery"));
    expect(q<HTMLImageElement>(".map-source-hud__logo").hidden).toBe(true);

    hud.update({ mode: "google-tiles", rasterBaseMap: null, lastError: "quota" });
    expect(q(".map-source-label").textContent).toBe("Google 3D Tiles warning");
    expect(q<HTMLAnchorElement>(".map-source-hud__credit").href).toContain("google.com");

    hud.update({ mode: "fallback", rasterBaseMap: null, lastError: null });
    expect(q<HTMLAnchorElement>(".map-source-hud__credit").hidden).toBe(true);
    expect(q(".map-source-hud__chip").classList.contains("hud-chip--fallback")).toBe(true);
  });

  it("shows CARTO as its logo followed by the basemap's own name", () => {
    const { hud, q } = mount();
    hud.update(raster("carto-dark-matter"));

    const wordmark = q(".map-source-hud__wordmark");
    expect(wordmark.hidden).toBe(false);
    expect(q<HTMLImageElement>(".map-source-hud__wordmark-on-dark").getAttribute("src")).toBe(source("carto-dark-matter").wordmark!.onDark);
    expect(q<HTMLImageElement>(".map-source-hud__wordmark-on-light").getAttribute("src")).toBe(source("carto-dark-matter").wordmark!.onLight);
    expect(wordmark.nextElementSibling).toBe(q(".map-source-label"));
    expect(q(".map-source-label").textContent).toBe("Dark Matter");
    expect(q<HTMLImageElement>(".map-source-hud__logo").hidden).toBe(true);
    const provider = q<HTMLButtonElement>(".map-source-hud__provider");
    expect(provider.getAttribute("aria-label")).toBe("Basemap: CARTO Dark Matter. Show or hide the Map tab");
    expect(provider.title).toBe("CARTO Dark Matter. Click to show or hide the Map tab.");

    hud.update(raster("carto-positron", "tile 404"));
    expect(q(".map-source-label").textContent).toBe("Positron warning");

    hud.update(raster("osm-standard"));
    expect(wordmark.hidden).toBe(true);
    expect(q(".map-source-label").textContent).toBe("OpenStreetMap");
    expect(q<HTMLImageElement>(".map-source-hud__logo").hidden).toBe(false);
  });

  it("runs the streaming outline around the whole chip, and leaves nothing behind", () => {
    const { container, hud, q, stream } = mount();
    stream(true);
    expect(q(".map-source-hud__chip").classList.contains("is-streaming")).toBe(true);
    hud.destroy();
    expect(container.childElementCount).toBe(0);
  });
});

describe("map detail rail", () => {
  function google() {
    const controller = createMapDetailController({ storage: null });
    controller.setRecommendationContext({ rendererDefaultErrorPx: 20, rendererMode: "webgl2" });
    controller.updatePolicy({ kind: "google", finestErrorPx: 16, coarsestErrorPx: 4096, defaultValue: 64 });
    controller.setActiveSource({ key: "google", availability: "ready" });
    controller.updatePolicy({ kind: "google", finestErrorPx: 16, coarsestErrorPx: 4096, defaultValue: 64 });
    const rail = createMapDetailSlider({ controller, name: "World detail" });
    const slider = rail.element.querySelector<HTMLInputElement>("input")!;
    const move = (position: number) => {
      slider.value = String(position);
      slider.dispatchEvent(new Event("input"));
    };
    return { controller, rail, slider, move };
  }

  it("treats both ends as ordinary values, finer on the left", () => {
    const { controller, slider, move } = google();
    expect(slider.getAttribute("aria-label")).toBe("World detail for this session");
    expect(slider.min).toBe("4");
    expect(slider.max).toBe("12");
    expect(slider.value).toBe("6");
    move(12);
    expect(controller.getState()).toMatchObject({ sessionOverride: 4096, requestedTarget: 4096 });
    move(4);
    expect(controller.getState()).toMatchObject({ sessionOverride: 16, requestedTarget: 16 });
    expect(slider.getAttribute("aria-valuetext")).toBe("Google error target 16 pixels");
  });

  it("marks the saved default independently of the ends", () => {
    const { rail, move } = google();
    const tick = rail.element.querySelector<HTMLElement>(".map-detail-control__default-tick")!;
    expect(tick.hidden).toBe(false);
    expect(tick.style.left).toBe("25%");
    move(10);
    expect(tick.style.left).toBe("25%");
  });

  it("shows the blue marker only when an app holds the renderer at another target", () => {
    const { controller, rail } = google();
    const marker = rail.element.querySelector<HTMLElement>(".map-detail-control__active-marker")!;
    expect(marker.hidden).toBe(true);
    const lease = controller.acquireRequirement(8);
    expect(marker.hidden).toBe(false);
    expect(marker.classList.contains("is-beyond-range")).toBe(true);
    expect(rail.element.classList.contains("is-limited")).toBe(true);
    lease.release();
    expect(marker.hidden).toBe(true);
  });

  it("keeps a single-value range readable but still", () => {
    const { controller, slider } = google();
    controller.updatePolicy({ kind: "google", finestErrorPx: 32, coarsestErrorPx: 32, defaultValue: 32 });
    expect(slider.disabled).toBe(true);
    expect(slider.getAttribute("aria-valuetext")).toBe("Google error target 32 pixels");
  });

  it("stays still and dimmed while detail is unavailable", () => {
    const controller = createMapDetailController({ storage: null });
    controller.setActiveSource({ key: "raster:osm-standard", availability: "unavailable" });
    const rail = createMapDetailSlider({ controller });
    const slider = rail.element.querySelector<HTMLInputElement>("input")!;
    expect(slider.disabled).toBe(true);
    expect(rail.element.classList.contains("is-unavailable")).toBe(true);
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(controller.getState()?.sessionOverride).toBeNull();
  });

  it("describes raster offsets in levels around Normal", () => {
    const controller = createMapDetailController({ storage: null });
    controller.setActiveSource({ key: "raster:usgs-imagery", availability: "ready" });
    const rail = createMapDetailSlider({ controller });
    const slider = rail.element.querySelector<HTMLInputElement>("input")!;
    expect(slider.min).toBe("-1");
    expect(slider.max).toBe("3");
    expect(slider.step).toBe("0.25");
    slider.value = "-1";
    slider.dispatchEvent(new Event("input"));
    expect(slider.getAttribute("aria-valuetext")).toBe("one level finer than Normal");
    controller.reportDelivery("raster:usgs-imagery", { pending: true, limits: ["source"], effectiveTarget: null });
    expect(slider.getAttribute("aria-valuetext")).toBe("one level finer than Normal. Loading, limited by the map source.");
    rail.destroy();
  });
});
