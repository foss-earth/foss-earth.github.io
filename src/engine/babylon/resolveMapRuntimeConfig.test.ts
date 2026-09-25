import { describe, expect, it } from "vitest";
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

  it("restores independent elevation and quality selections", () => {
    const config = resolveMapRuntimeConfig({
      searchParams: new URLSearchParams("mapSource=usgs-topo&elevationSource=aws-terrarium&terrainQuality=high"),
    });
    expect(config.rasterBaseMap.id).toBe("usgs-topo");
    expect(config.terrainSource.id).toBe("aws-terrarium");
    expect(config.rasterQuality).toBe("high");
  });

  it("draws 2D imagery from the projected atlas unless the URL rolls back to legacy", () => {
    expect(DEFAULT_RASTER_IMAGERY).toBe("atlas");
    expect(resolveMapRuntimeConfig({ searchParams: new URLSearchParams() }).rasterImagery).toBe("atlas");
    expect(resolveMapRuntimeConfig({ searchParams: new URLSearchParams("rasterImagery=legacy") }).rasterImagery).toBe("legacy");
    expect(resolveMapRuntimeConfig({ searchParams: new URLSearchParams("rasterImagery=other") }).rasterImagery).toBe("atlas");
  });
});
