#!/usr/bin/env node
/**
 * Renders the candidate appearances of a panorama "orb" so they can be compared
 * by eye and by number. Research tooling for docs/proposals/research/panorama-scenes-research.md.
 *
 * Run: node scripts/render-orb-appearances.mjs [--panorama equirect.png] [--out dir]
 *
 * Without --panorama it draws a synthetic fixture: sky and ground, a 30° grid and
 * the letters N, E and S on the horizon, which read backwards wherever a mapping
 * mirrors the photograph. With --panorama it uses an 8-bit RGB(A), non-interlaced
 * PNG in equirectangular projection whose centre column faces north.
 *
 * Everything is ray cast on the CPU from the definitions in the research document,
 * so the pictures show what each mapping means, not how fast any renderer is.
 * Output defaults to build/research/panorama-orbs/<timestamp>/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(option("--out") ?? path.join(root, "build", "research", "panorama-orbs", stamp));
mkdirSync(outDir, { recursive: true });

const DEG = Math.PI / 180;
const SUPERSAMPLE = 3;
const TILE = 160;
const BACKGROUND = [58, 63, 71];

// ---------- vectors (local east-north-up: x east, y north, z up) ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => scale(a, 1 / length(a));
/** Heading clockwise from north and pitch above the horizon, both in radians. */
const direction = (heading, pitch) => [Math.sin(heading) * Math.cos(pitch), Math.cos(heading) * Math.cos(pitch), Math.sin(pitch)];

// ---------- PNG ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function writePng(file, image) {
  const { width, height, rgb } = image;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}
function readPng(file) {
  const data = readFileSync(file);
  let offset = 8;
  let width = 0, height = 0, channels = 0;
  const idat = [];
  while (offset < data.length) {
    const len = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = body.subarray(8);
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`${file}: needs 8-bit RGB or RGBA without interlacing`);
      channels = color === 2 ? 3 : 4;
    } else if (type === "IDAT") idat.push(body);
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(pixels.subarray(i * channels, i * channels + 3), i * 3);
  return { width, height, rgb };
}

// ---------- fixture panorama ----------
// Stroke letters on a unit box, x to the right and y up, as seen from inside the sphere.
const LETTERS = {
  N: [[[0, 0], [0, 1], [0.7, 0], [0.7, 1]]],
  E: [[[0.7, 1], [0, 1], [0, 0], [0.7, 0]], [[0, 0.5], [0.55, 0.5]]],
  S: [[[0.7, 0.9], [0.55, 1], [0.15, 1], [0, 0.85], [0, 0.62], [0.15, 0.5], [0.55, 0.5], [0.7, 0.38], [0.7, 0.15], [0.55, 0], [0.15, 0], [0, 0.1]]],
  W: [[[0, 1], [0.18, 0], [0.35, 0.6], [0.52, 0], [0.7, 1]]],
};
const LETTER_COLOURS = { N: [230, 57, 70], E: [255, 209, 102], S: [72, 202, 228], W: [239, 131, 255] };

function segmentDistance(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
}

function makeFixture(width = 2048, height = 1024) {
  const rgb = Buffer.alloc(width * height * 3);
  const letters = [["N", 0], ["E", 90], ["S", 180], ["W", 270]];
  const letterSizeDeg = 16;
  for (let y = 0; y < height; y++) {
    const pitch = (0.5 - (y + 0.5) / height) * 180;
    for (let x = 0; x < width; x++) {
      const heading = ((x + 0.5) / width - 0.5) * 360;
      let colour;
      if (pitch >= 0) {
        const t = pitch / 90;
        colour = [150 - 110 * t, 190 - 120 * t, 235 - 60 * t];
      } else {
        const t = -pitch / 90;
        colour = [110 - 60 * t, 135 - 85 * t, 70 - 40 * t];
        // A checker toward the nadir shows pole filtering.
        if (pitch < -60 && (Math.floor(heading / 15) + Math.floor(pitch / 5)) % 2 === 0) colour = colour.map(c => c * 0.75);
      }
      // A star at the zenith, eight spokes, shows pole filtering above.
      if (pitch > 70 && Math.abs(((heading + 360) % 45) - 22.5) > 20) colour = [250, 250, 250];
      const gridHeading = Math.abs(((heading + 360) % 30) - 15);
      const gridPitch = Math.abs(((pitch + 180) % 30) - 15);
      if (gridHeading > 14.6 || gridPitch > 14.6) colour = colour.map(c => c * 0.55);
      if (Math.abs(pitch) < 0.35) colour = [255, 255, 255];
      for (const [name, centre] of letters) {
        let dh = heading - centre;
        dh = ((dh + 540) % 360) - 180;
        const lx = dh / letterSizeDeg + 0.35;
        const ly = (pitch - 4) / letterSizeDeg;
        if (lx < -0.2 || lx > 1 || ly < -0.2 || ly > 1.2) continue;
        let best = Infinity;
        for (const stroke of LETTERS[name]) {
          for (let i = 0; i + 1 < stroke.length; i++) best = Math.min(best, segmentDistance([lx, ly], stroke[i], stroke[i + 1]));
        }
        if (best < 0.075) colour = LETTER_COLOURS[name];
        else if (best < 0.11) colour = [20, 20, 20];
      }
      rgb.set(colour.map(c => Math.max(0, Math.min(255, Math.round(c)))), (y * width + x) * 3);
    }
  }
  return { width, height, rgb };
}

// ---------- sampling ----------
function samplePanorama(pano, d) {
  const heading = Math.atan2(d[0], d[1]);
  const pitch = Math.atan2(d[2], Math.hypot(d[0], d[1]));
  const u = 0.5 + heading / (2 * Math.PI);
  const v = 0.5 - pitch / Math.PI;
  const fx = u * pano.width - 0.5;
  const fy = Math.min(pano.height - 1, Math.max(0, v * pano.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const out = [0, 0, 0];
  for (const [xx, yy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x0 + 1, y0, tx * (1 - ty)], [x0, y0 + 1, (1 - tx) * ty], [x0 + 1, y0 + 1, tx * ty]]) {
    const px = ((xx % pano.width) + pano.width) % pano.width;
    const py = Math.min(pano.height - 1, yy);
    const i = (py * pano.width + px) * 3;
    out[0] += pano.rgb[i] * w;
    out[1] += pano.rgb[i + 1] * w;
    out[2] += pano.rgb[i + 2] * w;
  }
  return out;
}

// ---------- the mappings ----------
// Each returns the panorama direction a camera ray shows, or null where the orb is not drawn.
// The orb is centred at the origin with radius 1; the panorama was captured at its centre.
function hits(origin, ray) {
  const b = dot(origin, ray);
  const c = dot(origin, origin) - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  return { near: -b - root, far: -b + root, inside: c < 0 };
}

const MAPPINGS = {
  /** A view ray inside the orb shows the panorama in that same direction. */
  portal(origin, ray) {
    const h = hits(origin, ray);
    if (!h || h.far < 0) return null;
    return ray;
  },
  /**
   * A fixed-angle window: the view along the orb's direction, widened to at least the
   * preview angle. `projection` spreads that view over the disc: "rectilinear" as a
   * camera would, or "orthographic" as a fisheye, which at 90° is the far bubble.
   */
  window(origin, ray, { previewHalfAngleDeg = 45, projection = "rectilinear" } = {}) {
    const h = hits(origin, ray);
    if (!h || h.far < 0) return null;
    if (h.inside) return ray;
    const distance = length(origin);
    const alpha = Math.asin(1 / distance);
    const beta = Math.max(alpha, previewHalfAngleDeg * DEG);
    const axis = scale(origin, -1 / distance);
    const off = sub(scale(ray, 1 / dot(ray, axis)), axis);
    if (projection === "orthographic") {
      // Radius on the disc, 0 at its centre and 1 at the silhouette.
      const rho = Math.min(1, length(off) / Math.tan(alpha));
      const theta = Math.asin(Math.min(1, rho * Math.sin(beta)));
      const sideways = length(off) > 0 ? normalize(off) : [0, 0, 0];
      return add(scale(axis, Math.cos(theta)), scale(sideways, Math.sin(theta)));
    }
    if (beta === alpha) return ray;
    return normalize(add(axis, scale(off, Math.tan(beta) / Math.tan(alpha))));
  },
  /** The far inside wall of a transparent ball painted inside with the panorama. */
  bubble(origin, ray) {
    const h = hits(origin, ray);
    if (!h || h.far < 0) return null;
    return add(origin, scale(ray, h.far));
  },
  /** The outside of a ball painted with the panorama, as a globe is painted with a map. */
  ball(origin, ray) {
    const h = hits(origin, ray);
    if (!h || h.inside || h.near < 0) return null;
    return add(origin, scale(ray, h.near));
  },
  /** A mirror ball reflecting the photographed surroundings. */
  mirror(origin, ray) {
    const h = hits(origin, ray);
    if (!h || h.inside || h.near < 0) return null;
    const n = add(origin, scale(ray, h.near));
    return sub(ray, scale(n, 2 * dot(ray, n)));
  },
  /** A solid glass ball, refractive index 1.5, in the photographed surroundings. */
  glass(origin, ray) {
    const h = hits(origin, ray);
    if (!h || h.inside || h.near < 0) return null;
    const p = add(origin, scale(ray, h.near));
    const refract = (incident, normal, eta) => {
      const cosi = -dot(incident, normal);
      const k = 1 - eta * eta * (1 - cosi * cosi);
      return k < 0 ? null : normalize(add(scale(incident, eta), scale(normal, eta * cosi - Math.sqrt(k))));
    };
    const inside = refract(ray, p, 1 / 1.5);
    if (!inside) return sub(ray, scale(p, 2 * dot(ray, p)));
    const exitPoint = add(p, scale(inside, -2 * dot(p, inside)));
    return refract(inside, scale(exitPoint, -1), 1.5) ?? inside;
  },
};

// ---------- camera ----------
function render(pano, { position, target, verticalFovDeg, size = TILE, mapping, mappingOptions }) {
  const forward = normalize(sub(target, position));
  const right = normalize(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  const tanHalf = Math.tan((verticalFovDeg * DEG) / 2);
  const rgb = Buffer.alloc(size * size * 3);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const sum = [0, 0, 0];
      for (let sj = 0; sj < SUPERSAMPLE; sj++) {
        for (let si = 0; si < SUPERSAMPLE; si++) {
          const sx = (((i + (si + 0.5) / SUPERSAMPLE) / size) * 2 - 1) * tanHalf;
          const sy = (1 - ((j + (sj + 0.5) / SUPERSAMPLE) / size) * 2) * tanHalf;
          const ray = normalize(add(forward, add(scale(right, sx), scale(up, sy))));
          const d = mapping ? MAPPINGS[mapping](position, ray, mappingOptions) : ray;
          const colour = d ? samplePanorama(pano, normalize(d)) : BACKGROUND;
          sum[0] += colour[0]; sum[1] += colour[1]; sum[2] += colour[2];
        }
      }
      const n = SUPERSAMPLE * SUPERSAMPLE;
      rgb.set(sum.map(c => Math.round(c / n)), (j * size + i) * 3);
    }
  }
  return { width: size, height: size, rgb };
}

function strip(images, gap = 4) {
  const height = Math.max(...images.map(im => im.height));
  const width = images.reduce((w, im) => w + im.width, 0) + gap * (images.length - 1);
  const rgb = Buffer.alloc(width * height * 3, 24);
  let x0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.height; y++) im.rgb.copy(rgb, (y * width + x0) * 3, y * im.width * 3, (y + 1) * im.width * 3);
    x0 += im.width + gap;
  }
  return { width, height, rgb };
}

function meanAbsoluteDifference(a, b) {
  let total = 0;
  for (let i = 0; i < a.rgb.length; i++) total += Math.abs(a.rgb[i] - b.rgb[i]);
  return total / a.rgb.length;
}

// ---------- the comparison ----------
const panoramaFile = option("--panorama");
const pano = panoramaFile ? readPng(path.resolve(panoramaFile)) : makeFixture();
if (!panoramaFile) {
  const small = makeFixture(1024, 512);
  writePng(path.join(outDir, "fixture.png"), small);
}

/** Camera placed at `distance` orb radii, seen from compass `bearingDeg` toward the orb, raised by `elevationDeg`. */
function orbit(distance, bearingDeg, elevationDeg) {
  const from = direction(bearingDeg * DEG + Math.PI, elevationDeg * DEG);
  return scale(from, distance);
}

// Columns of the appearance strips. Each tile is framed to the orb, so a far orb is
// shown enlarged; its content is what that distance shows.
const VIEWS = [
  { label: "north, 1.5 radii", position: orbit(1.5, 0, 0) },
  { label: "north, 3 radii", position: orbit(3, 0, 0) },
  { label: "east, 3 radii", position: orbit(3, 90, 0) },
  { label: "north-east from 35° above, 3 radii", position: orbit(3, 45, 35) },
  { label: "north, 100 radii", position: orbit(100, 0, 0) },
];
const STRIPS = [
  ["window", { previewHalfAngleDeg: 45 }],
  ["portal"],
  ["bubble"],
  ["ball"],
  ["mirror"],
  ["glass"],
  ["window", { previewHalfAngleDeg: 90, projection: "orthographic" }, "window-fisheye"],
];
const report = { panorama: panoramaFile ?? "synthetic fixture", views: VIEWS.map(v => v.label), strips: {}, entry: {} };
const tilesByStrip = {};
for (const [mapping, mappingOptions, name = mapping] of STRIPS) {
  const tiles = VIEWS.map(view => {
    const alpha = Math.asin(1 / length(view.position));
    const verticalFovDeg = (2 * Math.atan(Math.tan(alpha) / 0.9)) / DEG;
    return render(pano, { position: view.position, target: [0, 0, 0], verticalFovDeg, mapping, mappingOptions });
  });
  const file = `orb-${name}.png`;
  writePng(path.join(outDir, file), strip(tiles));
  report.strips[name] = file;
  tilesByStrip[name] = tiles;
}
// How closely the fisheye window reproduces the bubble, view by view.
report.fisheyeWindowVersusBubble = tilesByStrip["window-fisheye"].map((tile, i) =>
  Number(meanAbsoluteDifference(tile, tilesByStrip.bubble[i]).toFixed(1)));

// Entry: the camera flies at the orb's centre, looking north with a 60° vertical field,
// and ends at the capture point, where the immersive view is the reference.
const ENTRY_DISTANCES = [8, 4, 2, 1.25, 1.02, 0.6];
const immersive = render(pano, { position: [0, 0, 0], target: [0, 1, 0], verticalFovDeg: 60 });
for (const [mapping, mappingOptions] of STRIPS.slice(0, 4)) {
  const frames = ENTRY_DISTANCES.map(distance =>
    render(pano, { position: [0, -distance, 0], target: [0, 0, 0], verticalFovDeg: 60, mapping, mappingOptions }));
  const file = `entry-${mapping}.png`;
  writePng(path.join(outDir, file), strip([...frames, immersive]));
  report.entry[mapping] = {
    file,
    distances: ENTRY_DISTANCES,
    meanAbsoluteDifferenceFromImmersive: frames.map(frame => Number(meanAbsoluteDifference(frame, immersive).toFixed(1))),
  };
}
writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outDir}`);
console.log(JSON.stringify(report.entry, null, 2));
