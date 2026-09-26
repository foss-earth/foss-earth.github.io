import { describe, expect, it } from "vitest";
import { FOSS_EARTH_PARAMETERS, fossEarthUrlAliases } from "../../settings/catalogue";
import { createSettingsRegistry } from "../../settings/registry";
import { DEFAULT_RASTER_IMAGERY, resolveMapRuntimeConfig } from "./resolveMapRuntimeConfig";

describe("resolveMapRuntimeConfig", () => {
  it("uses Google tiles when a key is present and no map source override exists", () => {
    const config = resolveMapRuntimeConfig({
      googleApiKey: "test-key",
      searchParams: new URLSearchParams(),
    });
    expect(config.googleApiKey).toBe("test-key");
    expect(config.rasterBaseMap.id).toBe("usgs-imagery-topo");
  });

  it("uses a free raster source when mapSource requests it even with a Google key", () => {
    const config = resolveMapRuntimeConfig({
      googleApiKey: "test-key",
      searchParams: new URLSearchParams("mapSource=osm-standard"),
    });
    expect(config.googleApiKey).toBe("test-key");
    expect(config.preferGoogleTiles).toBe(false);
    expect(config.rasterBaseMap.id).toBe("osm-standard");
  });

  it("forces Google when mapSource=google and a key is available", () => {
    const config = resolveMapRuntimeConfig({
      googleApiKey: "test-key",
      searchParams: new URLSearchParams("mapSource=google"),
    });
    expect(config.googleApiKey).toBe("test-key");
  });

  it("defaults to raster basemap when no Google key is provided", () => {
    const config = resolveMapRuntimeConfig({
      searchParams: new URLSearchParams(),
    });
    expect(config.googleApiKey).toBeNull();
    expect(config.rasterBaseMap.id).toBe("usgs-imagery-topo");
  });

  it("restores independent elevation and basemap selections", () => {
    const config = resolveMapRuntimeConfig({
      searchParams: new URLSearchParams("mapSource=usgs-topo&elevationSource=aws-terrarium"),
    });
    expect(config.rasterBaseMap.id).toBe("usgs-topo");
    expect(config.terrainSource.id).toBe("aws-terrarium");
  });

  it("turns the retired ?terrainQuality into terrain detail for the visit, and says so", () => {
    const settings = createSettingsRegistry({
      storage: null, searchParams: new URLSearchParams("terrainQuality=high"), urlAliases: fossEarthUrlAliases,
    });
    settings.register(FOSS_EARTH_PARAMETERS);
    const config = resolveMapRuntimeConfig({ settings });
    expect(config.rasterQuality).toBeUndefined();
    expect(settings.inspect("map.detail.terrain.default")).toMatchObject({ value: 2, provenance: "url" });
    expect(settings.inspect("map.detail.terrain.default")?.note).toMatch(/terrainQuality=high is retired/);
    expect(settings.get("map.auto.terrainDetail")).toBe(false);
    // Only for the visit: nothing is saved.
    expect(settings.sessionValueIds().sort()).toEqual(["map.auto.terrainDetail", "map.detail.terrain.default"]);
    const auto = createSettingsRegistry({ storage: null, searchParams: new URLSearchParams("terrainQuality=auto"), urlAliases: fossEarthUrlAliases });
    auto.register(FOSS_EARTH_PARAMETERS);
    expect(auto.get("map.auto.terrainDetail")).toBe(true);
    expect(auto.get("map.detail.terrain.default")).toBe(4);
  });

  it("draws 2D imagery from the projected atlas unless the URL rolls back to legacy", () => {
    expect(DEFAULT_RASTER_IMAGERY).toBe("atlas");
    expect(resolveMapRuntimeConfig({ searchParams: new URLSearchParams() }).rasterImagery).toBe("atlas");
    expect(resolveMapRuntimeConfig({ searchParams: new URLSearchParams("rasterImagery=legacy") }).rasterImagery).toBe("legacy");
    expect(resolveMapRuntimeConfig({ searchParams: new URLSearchParams("rasterImagery=other") }).rasterImagery).toBe("atlas");
  });
});
