import { describe, expect, it } from "vitest";
import type { ResolvedRepresentation } from "./format";
import { chooseRepresentation, createResourcePools, MIB, mipLevelCount, representationDecodedBytes, representationGpuBytes, rgba8Bytes } from "./budget";

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
    expect(chooseRepresentation(all, "preview", 1000, () => null)?.limitation).toContain("largest available is 256");
    expect(chooseRepresentation(all, "preview", 10, () => "no")).toBeNull();
  });

  it("compares cubes and equirectangular images on face texels", () => {
    const mixed = [equirect("e2048", 2048), equirect("e4096", 4096), cube("c768", 768)];
    expect(chooseRepresentation(mixed, "any", 600, () => null)?.representation.id).toBe("c768");
    expect(chooseRepresentation(mixed, "any", 900, () => null)?.representation.id).toBe("e4096");
  });
});
