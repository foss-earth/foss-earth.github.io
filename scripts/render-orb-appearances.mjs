#!/usr/bin/env node
/**
 * Renders the candidate appearances of a panorama "orb" so they can be compared
 * by eye and by number. Research tooling for docs/proposals/research/panorama-scenes-research.md.
 *
 * Run: node scripts/render-orb-appearances.mjs [--contract] [--panorama equirect.png] [--out dir]
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
import { createHash } from "node:crypto";

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
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (v) => v * v * (3 - 2 * v);
const angleDeg = (a, b) => Math.atan2(length(cross(a, b)), dot(a, b)) / DEG;
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
  if (disc < -1e-12) return null;
  const root = Math.sqrt(Math.max(0, disc));
  return { near: -b - root, far: -b + root, inside: c < 0 };
}

function validateWindowOptions({ previewHalfAngleDeg = 45, projection = "rectilinear",
  fisheyeHalfAngleDeg = 90, blendStartHalfAngleDeg = 20, blendEndHalfAngleDeg = previewHalfAngleDeg } = {}) {
  if (!(previewHalfAngleDeg > 0 && previewHalfAngleDeg < 90) && projection !== "orthographic")
    throw new RangeError("rectilinear preview half angle must be in (0, 90) degrees");
  if (!["rectilinear", "orthographic", "orthographic-blend"].includes(projection)) throw new RangeError("unknown projection");
  if (projection === "orthographic" && !(previewHalfAngleDeg > 0 && previewHalfAngleDeg <= 90))
    throw new RangeError("orthographic half angle must be in (0, 90] degrees");
  if (projection === "orthographic-blend" && (!(fisheyeHalfAngleDeg > 0 && fisheyeHalfAngleDeg <= 90)
    || !(blendStartHalfAngleDeg > 0 && blendStartHalfAngleDeg < blendEndHalfAngleDeg && blendEndHalfAngleDeg <= previewHalfAngleDeg)))
    throw new RangeError("blend needs 0 < start < end <= rectilinear half angle and 0 < fisheye half angle <= 90");
}

// Pure radial mapping. rho is the projected disc radius, not angular radius.
// The legacy orthographic branch is retained to reproduce the old figures; it is
// intentionally NOT the validated entry blend.
function windowTheta(delta, alpha, { previewHalfAngleDeg = 45, projection = "rectilinear",
  fisheyeHalfAngleDeg = 90, blendStartHalfAngleDeg = 20, blendEndHalfAngleDeg = previewHalfAngleDeg } = {}) {
  const beta = previewHalfAngleDeg * DEG;
  const weight = projection === "orthographic-blend"
    ? smoothstep(clamp((alpha / DEG - blendStartHalfAngleDeg) / (blendEndHalfAngleDeg - blendStartHalfAngleDeg), 0, 1)) : 1;
  // This branch is essential: neither tan(pi/2) nor 0 * an invalid fisheye is evaluated.
  if (projection !== "orthographic" && weight === 1 && alpha >= beta) return delta;
  const rho = clamp(Math.sin(delta) * Math.cos(alpha) / (Math.cos(delta) * Math.sin(alpha)), 0, 1);
  if (projection === "orthographic") return Math.asin(clamp(rho * Math.sin(Math.max(alpha, beta)), 0, 1));
  const rectilinear = alpha >= beta ? delta : Math.atan2(rho * Math.sin(beta), Math.cos(beta));
  if (weight === 1) return rectilinear;
  const fisheye = Math.asin(clamp(rho * Math.sin(fisheyeHalfAngleDeg * DEG), 0, 1));
  return (1 - weight) * fisheye + weight * rectilinear;
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
  window(origin, ray, options = {}) {
    const { projection = "rectilinear" } = options;
    validateWindowOptions(options);
    const distance = length(origin);
    if (distance < 1) return ray;
    const axis = scale(origin, -1 / distance);
    const cosine = dot(ray, axis);
    const cosineAlpha = Math.sqrt(Math.max(0, distance * distance - 1)) / distance;
    // At the surface only the inward hemisphere belongs to the exterior limit.
    if (cosine < cosineAlpha - 1e-12) return null;
    if (distance === 1 && projection !== "orthographic") return ray;
    const alpha = Math.asin(1 / distance);
    // Exact identity is also a numerical branch, not a reconstructed direction.
    // Validated blended options require blendEnd <= previewHalfAngle.
    if (projection !== "orthographic" && distance <= 1 / Math.sin((options.previewHalfAngleDeg ?? 45) * DEG)) return ray;
    const off = sub(ray, scale(axis, cosine));
    const sine = length(off);
    if (sine < 1e-15) return axis;
    const delta = Math.atan2(sine, cosine);
    const theta = windowTheta(delta, alpha, options);
    return add(scale(axis, Math.cos(theta)), scale(off, Math.sin(theta) / sine));
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
function cameraRays({ position, target, verticalFovDeg, size = TILE, width = size, height = size, rollDeg = 0 }) {
  if (!(verticalFovDeg > 0 && verticalFovDeg < 180) || !(width > 0 && height > 0)) throw new RangeError("perspective viewport needs 0 < vertical FOV < 180 and positive dimensions");
  const forward = normalize(sub(target, position));
  const baseRight = normalize(cross(forward, Math.abs(forward[2]) > 0.9999 ? [0, 1, 0] : [0, 0, 1]));
  const baseUp = cross(baseRight, forward);
  const right = add(scale(baseRight, Math.cos(rollDeg * DEG)), scale(baseUp, Math.sin(rollDeg * DEG)));
  const up = cross(right, forward);
  const tanHalf = Math.tan((verticalFovDeg * DEG) / 2);
  return (x, y) => normalize(add(forward, add(scale(right, (x * 2 - 1) * tanHalf * width / height), scale(up, (1 - y * 2) * tanHalf))));
}

function render(pano, config) {
  const { position, size = TILE, width = size, height = size, mapping, mappingOptions, markerPosition = [0, 0, 0] } = config;
  const rayAt = cameraRays(config);
  const relativePosition = sub(position, markerPosition);
  const rgb = Buffer.alloc(width * height * 3);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const sum = [0, 0, 0];
      for (let sj = 0; sj < SUPERSAMPLE; sj++) {
        for (let si = 0; si < SUPERSAMPLE; si++) {
          const ray = rayAt((i + (si + 0.5) / SUPERSAMPLE) / width, (j + (sj + 0.5) / SUPERSAMPLE) / height);
          const d = mapping ? MAPPINGS[mapping](relativePosition, ray, mappingOptions) : ray;
          const colour = d ? samplePanorama(pano, normalize(d)) : BACKGROUND;
          sum[0] += colour[0]; sum[1] += colour[1]; sum[2] += colour[2];
        }
      }
      const n = SUPERSAMPLE * SUPERSAMPLE;
      rgb.set(sum.map(c => Math.round(c / n)), (j * width + i) * 3);
    }
  }
  return { width, height, rgb };
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

// ---------- visual-contract checks (CPU mathematics, not GPU or usability) ----------
/** Camera at `distance` radii, viewing compass bearing, raised by elevation. */
function orbit(distance, bearingDeg, elevationDeg) {
  const from = direction(bearingDeg * DEG + Math.PI, elevationDeg * DEG);
  return scale(from, distance);
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(`Visual contract failed: ${message}`);
}

function coverage(config) {
  const relative = sub(config.position, config.markerPosition ?? [0, 0, 0]);
  const distance = length(relative);
  if (distance < 1) return { full: true, minimumCornerCosine: null, cosineAlpha: null };
  const axis = scale(relative, -1 / distance);
  const rayAt = cameraRays(config);
  const minimumCornerCosine = Math.min(...[[0, 0], [0, 1], [1, 0], [1, 1]].map(([x, y]) => dot(axis, rayAt(x, y))));
  const cosineAlpha = Math.sqrt(Math.max(0, distance * distance - 1)) / distance;
  return { full: minimumCornerCosine >= cosineAlpha - 1e-12, minimumCornerCosine, cosineAlpha };
}

function contractMetrics(pano, config, mappingOptions) {
  const rayAt = cameraRays(config);
  const relative = sub(config.position, config.markerPosition ?? [0, 0, 0]);
  let covered = 0, errorSum = 0, maximumRayErrorDeg = 0, imageErrorSum = 0, maximumImageChannelError = 0;
  // Fixed quadrature points include all four true viewport corners and boundaries.
  const nx = 49, ny = 37;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const ray = rayAt(x / (nx - 1), y / (ny - 1));
    const mapped = MAPPINGS.window(relative, ray, mappingOptions);
    if (!mapped) continue;
    requireCheck(mapped.every(Number.isFinite) && Math.abs(length(mapped) - 1) < 1e-10, "finite unit direction");
    const error = angleDeg(mapped, ray);
    maximumRayErrorDeg = Math.max(maximumRayErrorDeg, error);
    errorSum += error;
    const actual = samplePanorama(pano, mapped), expected = samplePanorama(pano, ray);
    for (let channel = 0; channel < 3; channel++) {
      const channelError = Math.abs(actual[channel] - expected[channel]);
      imageErrorSum += channelError;
      maximumImageChannelError = Math.max(maximumImageChannelError, channelError);
    }
    covered++;
  }
  const frameCoverage = coverage(config);
  const distance = length(relative);
  const fullRayIdentity = distance < 1 || distance <= 1 / Math.sin(mappingOptions.previewHalfAngleDeg * DEG) + 1e-12;
  const handoff = frameCoverage.full && fullRayIdentity;
  if (handoff) requireCheck(covered === nx * ny && maximumRayErrorDeg < 1e-9 && maximumImageChannelError < 1e-7, "handoff rays and same-source samples agree");
  return { samples: nx * ny, covered, ...frameCoverage, fullRayIdentity, handoff,
    maximumRayErrorDeg, meanCoveredRayErrorDeg: covered ? errorSum / covered : null,
    meanCoveredImageChannelError: covered ? imageErrorSum / (covered * 3) : null, maximumImageChannelError };
}

function runContract(pano, panoramaFile) {
  const flat = { projection: "rectilinear", previewHalfAngleDeg: 45 };
  const blend = { projection: "orthographic-blend", previewHalfAngleDeg: 45, fisheyeHalfAngleDeg: 90,
    blendStartHalfAngleDeg: 20, blendEndHalfAngleDeg: 45 };
  const distanceThreshold = 1 / Math.sin(45 * DEG);
  const distances = [8, 3, 1.58, 1.5, distanceThreshold + 0.01, distanceThreshold + 0.000001,
    distanceThreshold, distanceThreshold - 0.000001, 1.25, 1.000001, 1, 0.999999, 0.6, 0];
  const viewports = [{ name: "square", width: 112, height: 112 }, { name: "landscape", width: 160, height: 90 }, { name: "portrait", width: 90, height: 160 }];
  const poses = [{ name: "center", markerPosition: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 },
    { name: "turning", markerPosition: [0, 0, 0], yaw: 18, pitch: -7, roll: 11 },
    { name: "raised-offset", markerPosition: [0.25, 0, 0.5], yaw: 12, pitch: 8, roll: -9 }];
  const report = { schemaVersion: 1, scriptSha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"),
    input: panoramaFile ? { file: path.basename(panoramaFile), sha256: createHash("sha256").update(readFileSync(panoramaFile)).digest("hex") } : { fixture: "N/E/S/W cardinal text, 30-degree grid, sky/ground, polar details" },
    sampling: { width: pano.width, height: pano.height, rayGrid: [49, 37], includesViewportBoundary: true, imageMetric: "bilinear encoded RGB byte difference on covered rays only; not colorimetric or a GPU filtering test", figureSupersample: SUPERSAMPLE },
    config: { radius: 1, verticalFovDeg: 60, flat, blend, distances, viewports, poses }, rows: [] };
  for (const viewport of viewports) for (const pose of poses) for (const distance of distances) {
    // Rotate while approaching, with a fixed overview position saved independently.
    const progress = clamp((8 - distance) / 8, 0, 1);
    const position = add(pose.markerPosition, [0, -distance, 0]);
    // The offset pose retains a world target so its clipping axis and optical axis differ.
    const look = pose.name === "raised-offset"
      ? normalize(sub([0, 3, 0], position)) : direction(pose.yaw * progress * DEG, pose.pitch * progress * DEG);
    const config = { ...viewport, position, markerPosition: pose.markerPosition,
      target: add(position, look), rollDeg: pose.roll * progress, verticalFovDeg: 60 };
    for (const [appearance, options] of [["flat", flat], ["blend", blend]]) report.rows.push({ viewport: viewport.name, pose: pose.name, distance, appearance, ...contractMetrics(pano, config, options) });
  }
  const alpha = Math.asin(1 / 1.5);
  const counterexample = { distance: 1.5, verticalFovDeg: 60, aspect: 1, alphaDeg: alpha / DEG,
    cornerDeg: Math.atan(Math.sqrt(2) * Math.tan(30 * DEG)) / DEG,
    rayDeg: 30, sampledDeg: windowTheta(30 * DEG, alpha, flat) / DEG };
  requireCheck(counterexample.alphaDeg > counterexample.cornerDeg && counterexample.sampledDeg > 32.8, "coverage is not identity counterexample");
  report.counterexample = counterexample;

  let radialSamples = 0, minimumRadialIncrementDeg = Infinity, maximumEndpointErrorDeg = 0;
  for (const previewHalfAngleDeg of [0.01, 45, 89.9999]) for (const fisheyeHalfAngleDeg of [0.01, 45, 90]) {
    const options = { ...blend, previewHalfAngleDeg, fisheyeHalfAngleDeg, blendStartHalfAngleDeg: previewHalfAngleDeg * 0.4, blendEndHalfAngleDeg: previewHalfAngleDeg };
    validateWindowOptions(options);
    for (const alphaDeg of [0.000001, 0.001, 10, 20, 30, 44.999999, 45, 60, 89.999999]) {
      let previous = -1;
      for (let i = 0; i <= 1024; i++) {
        const delta = alphaDeg * DEG * i / 1024;
        const theta = windowTheta(delta, alphaDeg * DEG, options);
        requireCheck(Number.isFinite(theta) && theta >= previous && theta >= 0 && theta <= Math.PI / 2 + 1e-12, "monotone finite radial blend");
        if (i > 0) minimumRadialIncrementDeg = Math.min(minimumRadialIncrementDeg, (theta - previous) / DEG);
        previous = theta;
        radialSamples++;
        if (alphaDeg <= options.blendStartHalfAngleDeg) {
          const rho = Math.sin(delta) * Math.cos(alphaDeg * DEG) / (Math.cos(delta) * Math.sin(alphaDeg * DEG));
          maximumEndpointErrorDeg = Math.max(maximumEndpointErrorDeg, Math.abs(theta - Math.asin(clamp(rho * Math.sin(fisheyeHalfAngleDeg * DEG), 0, 1))) / DEG);
        } else if (alphaDeg >= options.blendEndHalfAngleDeg) maximumEndpointErrorDeg = Math.max(maximumEndpointErrorDeg, Math.abs(theta - delta) / DEG);
      }
    }
  }
  const rejected = [{ previewHalfAngleDeg: 0 }, { previewHalfAngleDeg: 90 }, { previewHalfAngleDeg: 180 },
    { ...blend, fisheyeHalfAngleDeg: 91 }, { ...blend, blendStartHalfAngleDeg: 46 }, { projection: "orthographic", previewHalfAngleDeg: 91 }];
  for (const options of rejected) {
    let didReject = false;
    try { validateWindowOptions(options); } catch { didReject = true; }
    requireCheck(didReject, "invalid projection FOV rejected");
  }
  let viewportFovRejections = 0;
  for (const verticalFovDeg of [0, 180, 181]) {
    try { cameraRays({ position: [0, -2, 0], target: [0, 0, 0], verticalFovDeg }); } catch { viewportFovRejections++; }
  }
  requireCheck(viewportFovRejections === 3, "invalid viewport FOV rejected");
  let acceptedViewportBoundaryRays = 0;
  for (const verticalFovDeg of [0.01, 60, 179.999]) for (const viewport of viewports) {
    const rayAt = cameraRays({ ...viewport, position: [0, -2, 0], target: [0, 0, 0], verticalFovDeg });
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      const ray = rayAt(x, y);
      requireCheck(ray.every(Number.isFinite) && Math.abs(length(ray) - 1) < 1e-10, "accepted perspective FOV finite");
      acceptedViewportBoundaryRays++;
    }
  }
  const boundary = [0.01, 0.0001, 0.000001].map(epsilonDeg => ({ epsilonDeg,
    maximumInteriorStepDeg: Math.max(...[0, 10, 20, 30, 40].map(delta =>
      Math.abs(windowTheta(delta * DEG, (45 - epsilonDeg) * DEG, blend) - windowTheta(delta * DEG, (45 + epsilonDeg) * DEG, blend)) / DEG)) }));
  report.radial = { radialSamples, minimumRadialIncrementDeg, maximumEndpointErrorDeg, rejectedConfigurations: rejected.length + viewportFovRejections, acceptedViewportBoundaryRays, handoffBoundarySteps: boundary };
  report.legacyFisheyeFailure = [1.0001, 1.000001, 1, 0.999999].map(distance => {
    const mapped = MAPPINGS.window([0, -distance, 0], direction(30 * DEG, 0), { projection: "orthographic", previewHalfAngleDeg: 90 });
    return { distance, sampledDeg: angleDeg(mapped, [0, 1, 0]) };
  });
  const observer = [0, -10, 0], capturePosition = [0, 0, 0], markerPosition = [0, 0, 1];
  report.offset = { observer, capturePosition, markerPosition, axisChangeDeg: angleDeg(normalize(sub(capturePosition, observer)), normalize(sub(markerPosition, observer))) };
  const outward = [0, -1, 0];
  requireCheck(MAPPINGS.window([0, -1, 0], outward, flat) === null, "outward surface ray excluded");
  requireCheck(MAPPINGS.window([0, -0.999999, 0], outward, flat) !== null, "inside ray included");
  requireCheck(MAPPINGS.window([0, 0, 0], outward, blend) === outward, "center has no axis division");
  report.surface = { outwardAtSurfaceCovered: false, outwardJustInsideCovered: true, centerFinite: true,
    caveat: "A trajectory crossing the surface while looking outward has a coverage discontinuity. Complete identity + full-coverage handoff before crossing; inside identity alone cannot repair earlier missing coverage." };

  const figureCases = [
    { label: "square, 1.5 radii: covers but differs", width: 112, height: 112, distance: 1.5, yaw: 0 },
    { label: "landscape, 1.5 radii: uncovered corners", width: 160, height: 90, distance: 1.5, yaw: 0 },
    { label: "portrait, 1.42 radii: near equality", width: 90, height: 160, distance: 1.42, yaw: 0 },
    { label: "landscape, turning 18 degrees at 1.25 radii", width: 160, height: 90, distance: 1.25, yaw: 18 },
    { label: "square, east at 3 radii: active blend", width: 112, height: 112, distance: 3, yaw: 0, bearing: 90 },
    { label: "square, west at 1.000001 radii", width: 112, height: 112, distance: 1.000001, yaw: 0, bearing: 270 },
  ];
  const rows = [];
  for (const fixture of figureCases) {
    const position = orbit(fixture.distance, fixture.bearing ?? 0, 0);
    const config = { ...fixture, position, target: add(position, direction(((fixture.bearing ?? 0) + fixture.yaw) * DEG, 0)), verticalFovDeg: 60 };
    rows.push(strip([render(pano, { ...config, mapping: "window", mappingOptions: flat }), render(pano, { ...config, mapping: "window", mappingOptions: blend }), render(pano, config)]));
  }
  const width = Math.max(...rows.map(row => row.width)), height = rows.reduce((sum, row) => sum + row.height + 4, 0) - 4;
  const rgb = Buffer.alloc(width * height * 3, 24);
  let y0 = 0;
  for (const row of rows) {
    for (let y = 0; y < row.height; y++) row.rgb.copy(rgb, ((y0 + y) * width) * 3, y * row.width * 3, (y + 1) * row.width * 3);
    y0 += row.height + 4;
  }
  writePng(path.join(outDir, "contract.png"), { width, height, rgb });
  report.figure = { file: "contract.png", columns: ["flat", "continuous fisheye blend", "immersive rays"], rows: figureCases.map(row => row.label) };
  report.summary = { configurations: report.rows.length, handoffs: report.rows.filter(row => row.handoff).length,
    maximumHandoffRayErrorDeg: Math.max(...report.rows.filter(row => row.handoff).map(row => row.maximumRayErrorDeg)),
    maximumHandoffImageChannelError: Math.max(...report.rows.filter(row => row.handoff).map(row => row.maximumImageChannelError)),
    allAssertionsPassed: true };
  writeFileSync(path.join(outDir, "contract.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outDir, counterexample, radial: report.radial, summary: report.summary }, null, 2));
}

// ---------- the comparison ----------
const panoramaFile = option("--panorama");
const pano = panoramaFile ? readPng(path.resolve(panoramaFile)) : makeFixture();
if (args.includes("--contract")) {
  runContract(pano, panoramaFile);
} else {
if (!panoramaFile) {
  const small = makeFixture(1024, 512);
  writePng(path.join(outDir, "fixture.png"), small);
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
}
