import { describe, expect, it } from "vitest";
import {
  applyOrientation,
  colourIsSrgb,
  CUBE_FACES,
  CUBE_FACE_NAMES,
  decodePng,
  dropOpaqueAlpha,
  encodeJpeg,
  decodeJpeg,
  encodePng,
  equirectPyramid,
  equirectUv,
  linearToSrgb,
  readGPano,
  renderCubeFace,
  resizeArea,
  sniffImage,
  srgbToLinear,
} from "./panoramaImage.mjs";

describe("codecs", () => {
  it("round-trips RGB through PNG with an sRGB chunk", () => {
    const rgb = Buffer.from(Array.from({ length: 5 * 3 * 3 }, (_, i) => (i * 37) % 256));
    const png = encodePng({ width: 5, height: 3, rgb });
    expect(sniffImage(png)).toBe("image/png");
    const decoded = decodePng(png);
    expect(decoded.colour.srgbChunk).toBe(true);
    expect(dropOpaqueAlpha(decoded).rgb.equals(rgb)).toBe(true);
  });

  it("encodes JPEG without orientation metadata", () => {
    const rgb = Buffer.alloc(16 * 16 * 3, 128);
    const bytes = encodeJpeg({ width: 16, height: 16, rgb }, 90);
    expect(sniffImage(bytes)).toBe("image/jpeg");
    const decoded = decodeJpeg(bytes);
    expect(decoded.orientation).toBe(1);
    expect(decoded.width).toBe(16);
  });

  it("refuses transparent pixels and non-sRGB colour", () => {
    const rgba = Buffer.from([1, 2, 3, 255, 4, 5, 6, 254]);
    expect(() => dropOpaqueAlpha({ width: 2, height: 1, rgba })).toThrow(/not opaque/);
    expect(colourIsSrgb({ iccProfileName: "Display P3", srgbChunk: false, gamma: null }).ok).toBe(false);
    expect(colourIsSrgb({ iccProfileName: "sRGB IEC61966-2.1", srgbChunk: false, gamma: null }).ok).toBe(true);
    expect(colourIsSrgb({ iccProfileName: null, srgbChunk: false, gamma: 1 }).ok).toBe(false);
  });

  it("reads GPano pose and crop fields from XMP", () => {
    const xmp = '<rdf:Description GPano:PoseHeadingDegrees="45.5" GPano:ProjectionType="equirectangular"><GPano:FullPanoWidthPixels>8000</GPano:FullPanoWidthPixels></rdf:Description>';
    expect(readGPano(xmp)).toEqual({ PoseHeadingDegrees: 45.5, ProjectionType: "equirectangular", FullPanoWidthPixels: 8000 });
    expect(readGPano(null)).toBeNull();
  });
});

describe("EXIF orientation", () => {
  // A 3×2 image whose pixels are numbered 0..5 in the red channel.
  const image = { width: 3, height: 2, rgba: Buffer.from([0, 1, 2, 3, 4, 5].flatMap(n => [n, 0, 0, 255])) };
  const reds = ({ width, height, rgba }) => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => rgba[(y * width + x) * 4]));

  it("mirrors, rotates and transposes as the tag says", () => {
    expect(reds(applyOrientation(image, 1))).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(reds(applyOrientation(image, 2))).toEqual([[2, 1, 0], [5, 4, 3]]);
    expect(reds(applyOrientation(image, 3))).toEqual([[5, 4, 3], [2, 1, 0]]);
    expect(reds(applyOrientation(image, 4))).toEqual([[3, 4, 5], [0, 1, 2]]);
    // 6: stored rotated 90° counter-clockwise; displayed after a clockwise turn.
    expect(reds(applyOrientation(image, 6))).toEqual([[3, 0], [4, 1], [5, 2]]);
    expect(reds(applyOrientation(image, 8))).toEqual([[2, 5], [1, 4], [0, 3]]);
  });
});

describe("linear-light resampling", () => {
  it("round-trips every sRGB byte", () => {
    for (let i = 0; i < 256; i++) expect(linearToSrgb(srgbToLinear(i))).toBe(i);
  });

  it("preserves the mean when averaging areas", () => {
    const data = new Float32Array(Array.from({ length: 12 * 6 * 3 }, (_, i) => (i % 7) / 7));
    const mean = image => image.data.reduce((sum, value) => sum + value, 0) / image.data.length;
    const out = resizeArea({ width: 12, height: 6, data }, 5, 4);
    expect(mean(out)).toBeCloseTo(mean({ data }), 5);
  });

  it("puts each cube face's texels in their own direction", () => {
    // An equirectangular image whose red is u and green is v.
    const width = 256, height = 128;
    const data = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      data[(y * width + x) * 3] = (x + 0.5) / width;
      data[(y * width + x) * 3 + 1] = (y + 0.5) / height;
    }
    const pyramid = equirectPyramid({ width, height, data });
    for (const face of CUBE_FACE_NAMES) {
      const size = 16;
      const out = renderCubeFace(pyramid, face, size);
      // Away from the equirectangular seam and the poles, red and green are the texel's (u, v).
      const { f, r, t } = CUBE_FACES[face];
      for (const [i, j] of [[8, 8], [4, 10], [12, 5]]) {
        const a = 2 * ((i + 0.5) / size) - 1, b = 1 - 2 * ((j + 0.5) / size);
        const [u, v] = equirectUv(f[0] + a * r[0] + b * t[0], f[1] + a * r[1] + b * t[1], f[2] + a * r[2] + b * t[2]);
        if (u < 0.05 || u > 0.95 || v < 0.1 || v > 0.9) continue;
        expect(out.data[(j * size + i) * 3]).toBeCloseTo(u, 1);
        expect(out.data[(j * size + i) * 3 + 1]).toBeCloseTo(v, 1);
      }
    }
  });
});
