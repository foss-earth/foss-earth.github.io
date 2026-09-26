import { describe, expect, it } from "vitest";
import {
  evaluateTerrainReadiness,
  terrainReadinessSamples,
  validateTerrainPreparation,
} from "./terrainReadiness";
import type { SurfaceHit } from "./surfaceQuery";

function surface(heightMeters: number, options: Partial<SurfaceHit> = {}): SurfaceHit {
  return {
    point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 },
    distanceMeters: 1, heightMeters, meshId: "terrain", revision: 1, quality: 14,
    ...options,
  };
}

describe("flight terrain readiness", () => {
  it("samples the center and two complete rings inside the requested safe zone", () => {
    const samples = terrainReadinessSamples(44.977753, -93.265011, 1000);
    expect(samples).toHaveLength(25);
    expect(samples[0]).toEqual({ latDeg: 44.977753, lonDeg: -93.265011 });
    expect(new Set(samples.map(sample => `${sample.latDeg.toFixed(8)},${sample.lonDeg.toFixed(8)}`)).size).toBe(25);
  });

  it("checks every local raster sample when the spawn is within 100 m of terrain", () => {
    const samples = Array.from({ length: 25 }, () => surface(300));
    samples[24] = surface(300, { quality: 9 });
    const blocked = evaluateTerrainReadiness({
      latDeg: 45, lonDeg: -93, radiusMeters: 1000, altitudeMeters: 350, clearanceMeters: 0,
    }, samples, false);
    expect(blocked.result).toBeNull();
    expect(blocked.progress).toMatchObject({ phase: "refining", readySamples: 24, totalSamples: 25 });

    const ready = evaluateTerrainReadiness({
      latDeg: 45, lonDeg: -93, altitudeMeters: 350, clearanceMeters: 0,
    }, samples.map(() => surface(300)), false);
    expect(ready.result).toEqual({ groundHeightMeters: 300, altitudeMeters: 350 });
  });

  it("starts at high altitude from the center terrain sample without waiting for the rings", () => {
    const selected = Array.from({ length: 25 }, (_, index) => surface(index === 5 ? 850 : 300, { geometricErrorMeters: 500_000 }));
    const readiness = evaluateTerrainReadiness({
      latDeg: 45, lonDeg: -93, altitudeMeters: 1000, clearanceMeters: 1000,
    }, selected, true);
    expect(readiness.progress).toMatchObject({ readySamples: 1, totalSamples: 1 });
    expect(readiness.result).toEqual({ groundHeightMeters: 300, altitudeMeters: 1300 });
  });

  it("takes no Google surface as ground while the renderer is still loading what it chose", () => {
    // A coarse tile kilometres above the real ground, as a Google start sees before refinement.
    const coarse = Array.from({ length: 25 }, () => surface(4200, { geometricErrorMeters: 20_000 }));
    const options = { latDeg: 45, lonDeg: -93, altitudeAboveGroundMeters: 1524 };
    const loading = evaluateTerrainReadiness(options, coarse, true, false);
    expect(loading.result).toBeNull();
    expect(loading.progress).toMatchObject({ phase: "refining", message: expect.stringMatching(/Google tiles/) });
    const settled = evaluateTerrainReadiness(options, coarse.map(() => surface(300)), true, true);
    expect(settled.result).toEqual({ groundHeightMeters: 300, altitudeMeters: 1824 });
  });

  it("validates geographic and distance inputs before starting any tile work", () => {
    expect(() => validateTerrainPreparation({ latDeg: 91, lonDeg: 0 })).toThrow("latitude");
    expect(() => validateTerrainPreparation({ latDeg: 0, lonDeg: 181 })).toThrow("latitude");
    expect(() => validateTerrainPreparation({ latDeg: 0, lonDeg: 0, radiusMeters: -1 })).toThrow("distances");
  });
});
