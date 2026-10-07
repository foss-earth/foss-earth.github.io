/**
 * Makes the sea level grids the position readout uses (src/terrain/geoid.ts)
 * from NGA's EGM2008 geoid, and measures each against it.
 *
 * Run: node scripts/geoid/build-geoid-grids.mjs [path/to/egm2008-5.pgm]
 *
 * The source is GeographicLib's 5′ grid of EGM2008, its values exact at its
 * points to the file's 3 mm step. Without a path the archive is downloaded once
 * into build/geoid/source/ and checked against the hash below. Each grid takes
 * the source's values at its own points, so the 60′, 30′ and 15′ grids are
 * EGM2008 at those points to the centimetre. The errors written to
 * provenance.json are the shipped decoder's bicubic interpolation against
 * every point of the source, the rms weighted by area.
 *
 * EGM2008 is NGA's, a work of the United States government, in the public domain.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readGeoidGrid } from "../../src/terrain/geoid.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ARCHIVE_URL = "https://sourceforge.net/projects/geographiclib/files/geoids-distrib/egm2008-5.tar.bz2/download";
const ARCHIVE_SHA256 = "9a57c14330ac609132d324906822a9da9de265ad9b9087779793eb7080852970";
const SOURCE_MINUTES = 5;
const GRIDS = [60, 30, 15];
const output = path.join(root, "src/terrain/geoidGrids");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function sourcePath() {
  if (process.argv[2]) return { pgm: path.resolve(process.argv[2]), archive: null };
  const folder = path.join(root, "build/geoid/source");
  const archive = path.join(folder, "egm2008-5.tar.bz2");
  const pgm = path.join(folder, "geoids/egm2008-5.pgm");
  if (!existsSync(archive)) {
    mkdirSync(folder, { recursive: true });
    const response = await fetch(ARCHIVE_URL, { headers: { "User-Agent": "foss-earth-check/1.0" } });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    writeFileSync(archive, new Uint8Array(await response.arrayBuffer()));
  }
  const hash = sha256(readFileSync(archive));
  if (hash !== ARCHIVE_SHA256) throw new Error(`${archive} is not the archive this script was written for: sha256 ${hash}.`);
  if (!existsSync(pgm)) execFileSync("tar", ["-xjf", archive, "-C", folder]);
  return { pgm, archive: { url: ARCHIVE_URL, sha256: hash } };
}

function readPgm(bytes) {
  const header = [];
  let position = 0;
  // "P5", the width and height, and the largest value, each on a line of its own among the comments.
  for (let lines = 0; lines < 3;) {
    const end = bytes.indexOf(10, position);
    const line = bytes.subarray(position, end).toString();
    position = end + 1;
    header.push(line);
    if (!line.startsWith("#")) lines++;
  }
  const field = name => header.find(line => line.startsWith(`# ${name} `))?.slice(name.length + 3);
  const [width, height] = header.at(-2).trim().split(/\s+/).map(Number);
  const offset = Number(field("Offset")), scale = Number(field("Scale"));
  if (width * SOURCE_MINUTES !== 360 * 60 || (height - 1) * SOURCE_MINUTES !== 180 * 60 || field("Origin") !== "90N 0E") {
    throw new Error("Expected a 5′ grid from 90°N, 0°E.");
  }
  const values = new Float64Array(width * height);
  for (let index = 0; index < values.length; index++) values[index] = offset + scale * bytes.readUInt16BE(position + 2 * index);
  return { header: header.filter(line => line.startsWith("#")), width, height, values };
}

function encode(source, minutes) {
  const step = minutes / SOURCE_MINUTES;
  const width = source.width / step, height = (source.height - 1) / step + 1;
  const centimetres = new Int16Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      centimetres[row * width + column] = Math.round(source.values[row * step * source.width + column * step] * 100);
    }
  }
  const bytes = Buffer.alloc(12 + 2 * centimetres.length);
  bytes.write("FEGD", 0, "ascii");
  bytes.writeUInt16LE(width, 4);
  bytes.writeUInt16LE(height, 6);
  bytes.writeUInt16LE(minutes, 8);
  for (let index = 0; index < centimetres.length; index++) {
    const column = index % width;
    const previous = column > 0 ? centimetres[index - 1] : index >= width ? centimetres[index - width] : 0;
    bytes.writeInt16LE(centimetres[index] - previous, 12 + 2 * index);
  }
  return { width, height, file: gzipSync(bytes, { level: 9 }) };
}

function measure(model, source) {
  let max = 0, at = null, squares = 0, area = 0, overHalf = 0;
  for (let row = 0; row < source.height; row++) {
    const latDeg = 90 - row * SOURCE_MINUTES / 60;
    const weight = Math.cos(latDeg * Math.PI / 180);
    for (let column = 0; column < source.width; column++) {
      const lonDeg = column * SOURCE_MINUTES / 60;
      const error = Math.abs(model.heightMeters(latDeg, lonDeg) - source.values[row * source.width + column]);
      if (error > max) { max = error; at = [latDeg, lonDeg > 180 ? lonDeg - 360 : lonDeg]; }
      squares += error * error * weight;
      area += weight;
      if (error > 0.5) overHalf += weight;
    }
  }
  const round = (value, digits) => Number(value.toFixed(digits));
  return {
    maxErrorMeters: round(max, 2),
    maxErrorAt: at.map(value => round(value, 3)),
    rmsErrorMeters: round(Math.sqrt(squares / area), 3),
    areaOverHalfMeter: round(overHalf / area, 5),
  };
}

const { pgm, archive } = await sourcePath();
const pgmBytes = readFileSync(pgm);
const source = readPgm(pgmBytes);
mkdirSync(output, { recursive: true });
const grids = [];
for (const minutes of GRIDS) {
  const { width, height, file } = encode(source, minutes);
  const name = `egm2008-${minutes}.bin`;
  writeFileSync(path.join(output, name), file);
  const accuracy = measure(await readGeoidGrid(new Uint8Array(file)), source);
  grids.push({ file: name, spacingMinutes: minutes, width, height, bytes: file.length, sha256: sha256(file), ...accuracy });
  console.log(`${name}: ${width}×${height}, ${(file.length / 1024).toFixed(0)} KiB, within ${accuracy.maxErrorMeters} m `
    + `(at ${accuracy.maxErrorAt.join(", ")}), ${(accuracy.rmsErrorMeters * 100).toFixed(1)} cm rms, `
    + `${(accuracy.areaOverHalfMeter * 100).toFixed(3)}% of the globe off by more than 0.5 m`);
}
writeFileSync(path.join(output, "provenance.json"), `${JSON.stringify({
  model: "EGM2008, NGA: the geoid's height above the WGS84 ellipsoid (tide free)",
  licence: "Public domain: a work of the United States government (NGA).",
  source: { file: "egm2008-5.pgm", sha256: sha256(pgmBytes), header: source.header, archive },
  generator: "scripts/geoid/build-geoid-grids.mjs",
  format: "gzip of: \"FEGD\", then width, height and spacing in arc minutes as little-endian uint16 and a reserved uint16; then width × height little-endian int16 centimetres, rows from 90°N to 90°S, each from 0°E eastward, each value less the one before it, a row's first less the first of the row above.",
  interpolation: "Bicubic (Catmull-Rom) through the grid's points: src/terrain/geoid.ts.",
  evaluation: "Against every point of the 5′ source grid; rms and the share of the globe off by more than 0.5 m are weighted by area.",
  grids,
}, null, 2)}\n`);
