import { describe, expect, it } from "vitest";
import type { ResolvedRepresentation } from "./format";
import { chooseRepresentation, createResourcePools, MIB, mipLevelCount, representationAroundPx, representationDecodedBytes, representationGpuBytes, rgba8Bytes, tileAtlasLayout, tiledCubeTileCount } from "./budget";

const cube = (id: string, faceSize: number): ResolvedRepresentation => ({
  id, role: "preview", projection: "cube", mimeType: "image/jpeg", encodedBytes: 1000, faceSize,
  faces: { px: "a", nx: "a", py: "a", ny: "a", pz: "a", nz: "a" },
});
const equirect = (id: string, width: number): ResolvedRepresentation => ({
  id, role: "immersion", projection: "equirectangular", mimeType: "image/jpeg", encodedBytes: 1000, width, height: width / 2, url: "a",
});

describe("byte arithmetic", () => {
  it("is exact over the allocated levels, not the 4/3 approximation", () => {
    expect(mipLevelCount(4096, 2048)).toBe(13);
    expect(rgba8Bytes(1, 1)).toBe(4);
    expect(rgba8Bytes(4, 2)).toBe(4 * (8 + 2 + 1));
    expect(rgba8Bytes(3, 3)).toBe(4 * (9 + 1));
  });

  it("matches the proposal's worked sizes", () => {
    // 43 mipmapped 128² preview cubes ≈ 21.5 MiB.
    expect(43 * representationGpuBytes(cube("p", 128)) / MIB).toBeCloseTo(21.5, 1);
    // A 4096×2048 whole image ≈ 42.67 MiB with mips; 6144×3072 ≈ 96 MiB.
    expect(representationGpuBytes(equirect("a", 4096)) / MIB).toBeCloseTo(42.67, 1);
    expect(representationGpuBytes(equirect("b", 6144)) / MIB).toBeCloseTo(96, 0);
    expect(representationDecodedBytes(equirect("b", 6144)) / MIB).toBe(72);
  });
});

describe("resource pools", () => {
  const limits = { sourceGpu: 128 * MIB, decoded: 64 * MIB, encoded: 32 * MIB, uploadOutstanding: 16 * MIB, overlap: 48 * MIB };

  it("refuses the 6144 whole image under the default decoded limit, and fits two 4096 images with previews", () => {
    const pools = createResourcePools(limits);
    expect(pools.fits("decoded", representationDecodedBytes(equirect("b", 6144)))).toBe(false);
    const previews = pools.reserve("sourceGpu", 43 * representationGpuBytes(cube("p", 128)), "previews");
    const first = pools.reserve("sourceGpu", representationGpuBytes(equirect("a", 4096)), "first");
    const second = pools.reserve("sourceGpu", representationGpuBytes(equirect("a", 4096)), "second", { overlap: true });
    expect(previews.ok && first.ok && second.ok).toBe(true);
    // A third 4096 image passes the 128 MiB source limit.
    const third = pools.reserve("sourceGpu", representationGpuBytes(equirect("a", 4096)), "third");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.pool).toBe("sourceGpu");
    // A second incoming image would pass the 48 MiB overlap even where source room remains.
    if (first.ok) first.reservation.release();
    const again = pools.reserve("sourceGpu", 10 * MIB, "again", { overlap: true });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.pool).toBe("overlap");
  });

  it("counts overlap as a subset, and settling frees only the overlap share", () => {
    const pools = createResourcePools({ ...limits, overlap: 10 * MIB });
    const incoming = pools.reserve("sourceGpu", 8 * MIB, "incoming", { overlap: true });
    expect(incoming.ok).toBe(true);
    expect(pools.reserve("sourceGpu", 4 * MIB, "another", { overlap: true }).ok).toBe(false);
    if (incoming.ok) incoming.reservation.settle();
    expect(pools.stats().overlap.reserved).toBe(0);
    expect(pools.stats().sourceGpu.reserved).toBe(8 * MIB);
    expect(pools.reserve("sourceGpu", 4 * MIB, "another", { overlap: true }).ok).toBe(true);
  });

  it("grows a streamed reservation only within the limit, and releases once", () => {
    const pools = createResourcePools(limits);
    const body = pools.reserve("encoded", 0, "body");
    if (!body.ok) throw new Error("reserve");
    expect(body.reservation.resize(20 * MIB)).toBe(true);
    expect(body.reservation.resize(40 * MIB)).toBe(false);
    body.reservation.release();
    body.reservation.release();
    expect(pools.stats().encoded).toMatchObject({ reserved: 0, peak: 20 * MIB, reservations: 0 });
    expect(pools.live()).toHaveLength(0);
  });

  it("reports pools over a lowered limit", () => {
    const pools = createResourcePools(limits);
    pools.reserve("decoded", 40 * MIB, "image");
    expect(pools.setLimits({ ...limits, decoded: 32 * MIB })).toEqual(["decoded"]);
    expect(pools.fits("decoded", 1)).toBe(false);
  });
});

describe("choosing a representation", () => {
  const all = [cube("p64", 64), cube("p128", 128), cube("p256", 256)];

  it("takes the smallest that meets the density", () => {
    expect(chooseRepresentation(all, "preview", 100, () => null)?.representation.id).toBe("p128");
    expect(chooseRepresentation(all, "preview", 100, () => null)?.limitation).toBeNull();
  });

  it("falls back to a lower one with the limiting reason", () => {
    const choice = chooseRepresentation(all, "preview", 200, rep => (rep.id === "p256" ? "over the source GPU limit" : null));
    expect(choice?.representation.id).toBe("p128");
    expect(choice?.limitation).toContain("p256: over the source GPU limit");
    expect(choice?.next).toEqual({ representation: all[2], reason: "over the source GPU limit" });
    expect(chooseRepresentation(all, "preview", 1000, () => null)?.limitation).toContain("largest available is 256");
    expect(chooseRepresentation(all, "preview", 1000, () => null)?.next).toBeNull();
    expect(chooseRepresentation(all, "preview", 10, () => "no")).toBeNull();
  });

  it("compares cubes and equirectangular images on face texels", () => {
    const mixed = [equirect("e2048", 2048), equirect("e4096", 4096), cube("c768", 768)];
    expect(chooseRepresentation(mixed, "any", 600, () => null)?.representation.id).toBe("c768");
    expect(chooseRepresentation(mixed, "any", 900, () => null)?.representation.id).toBe("e4096");
    expect(representationAroundPx(mixed[2])).toBe(3072);
    expect(representationAroundPx(mixed[1])).toBe(4096);
  });

  it("asked for the largest, takes the largest admissible and names the first larger one refused", () => {
    const images = [cube("p256", 256), equirect("e2048", 2048), equirect("e4096", 4096), equirect("e6144", 6144)];
    const choice = chooseRepresentation(images, "any", Number.POSITIVE_INFINITY, rep => (representationAroundPx(rep) > 4096 ? "over the detail" : null));
    expect(choice?.representation.id).toBe("e4096");
    expect(choice?.next).toEqual({ representation: images[3], reason: "over the detail" });
    expect(chooseRepresentation(images, "any", Number.POSITIVE_INFINITY, () => null)).toMatchObject({ representation: images[3], next: null });
  });
});

describe("a tiled cube's atlas", () => {
  // As the tools prepare a panorama: 1536-texel faces in 192-texel tiles with a texel of gutter, four levels.
  const prepared = { tileSize: 192, gutter: 1, faceSize: 1536 };
  const tile = 4 * 194 * 194;

  it("counts the tiles of every level", () => {
    expect(tiledCubeTileCount(prepared)).toBe(6 * (1 + 4 + 16 + 64));
    expect(tiledCubeTileCount({ tileSize: 192, faceSize: 192 })).toBe(6);
  });

  it("holds as many tiles as the memory allows, in rows the device's textures can take", () => {
    const layout = tileAtlasLayout(prepared, 196 * tile)!;
    expect(layout).toMatchObject({ stored: 194, slots: 196, perRow: 14, width: 14 * 194, height: 14 * 194 });
    // The atlas, and the display table of 6C × 2C texels for C = 8 cells along a face.
    expect(layout.gpuBytes).toBe(4 * (14 * 194) ** 2 + 4 * 6 * 8 * 2 * 8);
    // A 4096 px limit: 21 tiles a side.
    expect(tileAtlasLayout(prepared, 1024 * MIB, 4096)).toMatchObject({ perRow: 21, slots: 441 });
    expect(tileAtlasLayout(prepared, tile - 1)).toBeNull();
    expect(tileAtlasLayout(prepared, 1024 * MIB, 100)).toBeNull();
  });

  it("never has more slots than the cube has tiles, however much memory it may take", () => {
    const layout = tileAtlasLayout(prepared, 1024 * MIB)!;
    expect(layout.slots).toBe(510);
    expect(layout.perRow * (layout.height / 194)).toBeGreaterThanOrEqual(510);
    expect(layout.gpuBytes).toBeLessThan(80 * MIB);
    // A small cube takes a small atlas.
    expect(tileAtlasLayout({ tileSize: 192, gutter: 1, faceSize: 384 }, 1024 * MIB)).toMatchObject({ slots: 30, perRow: 6, height: 5 * 194 });
  });
});
