#!/usr/bin/env node
/**
 * Rebuilds the example scenes in public/examples/panorama-scenes/ from their
 * sources with scripts/prepare-panorama.mjs, so every file there can be
 * reproduced offline:
 *
 *   umn-single.scene.json    the acceptance fixture: one photograph 30 m above
 *                            the University of Minnesota campus (§7)
 *   umn-cardinal.scene.json  the same placement with the cardinal/text image,
 *                            to see mirroring or a wrong direction by eye
 *   campus-pair.scene.json   two different images, linked both ways, for the
 *                            enter → look → link → exit path, with outlined
 *                            orbs that grow under the pointer, and both orbs'
 *                            64 px previews in one sheet
 *   umn-tiles.scene.json     the cardinal image with equi-angular and ordinary
 *                            tiled cubes as well as a whole image, for the
 *                            tiled path and scripts/validation/panorama-tiles.mjs;
 *                            its 64 px preview is in a sheet too
 *
 * The placements are a synthetic test registration: the photograph was not
 * taken on the campus and its north is not surveyed.
 *
 * Run: node scripts/build-panorama-examples.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addPreviewSheets } from "./lib/previewSheet.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examples = path.join(root, "public", "examples", "panorama-scenes");
const scratch = path.join(root, "build", "panorama-examples");
mkdirSync(scratch, { recursive: true });

/** The research's campus test anchor: an approximate display registration, not a capture location. */
const CAMPUS = { longitudeDeg: -93.235, latitudeDeg: 44.974 };
const PHOTO = "validation/evidence/panorama-scenes/visual-contract-2026-09-27/photo-input.png";

const sources = [
  {
    assetId: "buikslotermeerplein-512",
    input: PHOTO,
    pose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, provenance: "Synthetic test registration: the photograph's north is not surveyed; the zero pose is chosen for the acceptance fixture." },
    previews: "32,64,128",
    immersion: "512",
    attribution: ["--attribution", "Buikslotermeerplein by Greg Zaal, Poly Haven", "--license", "CC0-1.0", "--credit-url", "https://polyhaven.com/a/buikslotermeerplein"],
  },
  {
    assetId: "cardinal-grid",
    input: "synthetic:cardinal:2048",
    pose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, provenance: "Generated with north at the image centre, so the zero pose is exact." },
    previews: "32,64,128,256",
    immersion: "1024,2048",
    attribution: ["--attribution", "Generated cardinal and grid test panorama, FOSS Earth"],
  },
  {
    assetId: "cardinal-tiles",
    input: "synthetic:cardinal:2048",
    pose: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, provenance: "Generated with north at the image centre, so the zero pose is exact." },
    previews: "32,64,128",
    immersion: "2048",
    // 512-texel faces, a quarter of the 2048 width, in tiles of 128: levels 0 to 2.
    tiles: ["--tiles", "eac,cube", "--tile-size", "128"],
    attribution: ["--attribution", "Generated cardinal and grid test panorama, FOSS Earth"],
  },
];

const fragments = {};
for (const source of sources) {
  const media = path.join(examples, "media", source.assetId);
  rmSync(media, { recursive: true, force: true });
  const pose = path.join(scratch, `${source.assetId}.pose.json`);
  writeFileSync(pose, JSON.stringify(source.pose, null, 2));
  execFileSync(process.execPath, [
    path.join(root, "scripts", "prepare-panorama.mjs"),
    "--input", source.input, "--pose", pose, "--asset-id", source.assetId,
    "--preview-face-sizes", source.previews, "--immersion-widths", source.immersion,
    "--encoding", "jpeg", "--quality", "90", "--url-prefix", `media/${source.assetId}/`,
    ...(source.tiles ?? []), ...source.attribution, "--out", media,
  ], { cwd: root, stdio: "inherit" });
  fragments[source.assetId] = JSON.parse(readFileSync(path.join(media, "asset.fragment.json"), "utf8"));
}

const registration = "Synthetic test registration at the research's campus anchor, 44.974°, −93.235°. The photograph was not captured here and its north is not surveyed.";
const fixture = (purpose) => ({ "foss-earth.fixture": { purpose, registration, source: "scripts/build-panorama-examples.mjs" } });
/** Camera south of the orb at its height: 100 m horizontally, looking north toward the ground under it. */
const overview = {
  target: { ...CAMPUS, height: null },
  distanceMeters: Math.round(Math.hypot(100, 30) * 1000) / 1000,
  headingDeg: 0,
  pitchDeg: -Math.round(Math.atan2(30, 100) * 180 / Math.PI * 1e6) / 1e6,
  verticalFovDeg: 60,
};
const orb = (id, assetId, title, description) => ({
  id, type: "panorama", assetId, title, description,
  capture: { ...CAMPUS, height: null },
  imagePose: fragments[assetId].imagePose,
  marker: { mode: "ground-relative", eastM: 0, northM: 0, offsetM: 30, radiusMeters: 2 },
});
const scene = (id, title, purpose, assets, entities, extra = {}) => ({
  format: "foss-earth-scene", version: 1, id, revision: "1", title, requiredExtensions: [],
  extensions: fixture(purpose),
  assets: assets.map(assetId => fragments[assetId].asset),
  entities, ...extra,
});

const write = (name, document) => writeFileSync(path.join(examples, name), `${JSON.stringify(document, null, 2)}\n`);
/** The scene with its 64 px preview cubes, the first an orb asks for, in one sheet named for the scene. */
const writeWithSheet = (name, document) => {
  const added = addPreviewSheets(document, { read: url => readFileSync(path.join(examples, url)), faceSize: 64, quality: 90, urlPrefix: `media/${document.id}-` });
  for (const { url, bytes } of added.files) writeFileSync(path.join(examples, url), bytes);
  write(name, added.document);
};

write("umn-single.scene.json", scene("umn-single", "UMN — test panorama",
  "The acceptance fixture of docs/proposals/panorama-scenes.md §7: one 360° image floating above the Minneapolis campus.",
  ["buikslotermeerplein-512"],
  [orb("umn-test-orb", "buikslotermeerplein-512", "UMN — test panorama", "A test photograph of Buikslotermeerplein, Amsterdam, shown 30 m above the campus. It was not taken here.")],
  { initialPanorama: "umn-test-orb", overview }));

write("umn-cardinal.scene.json", scene("umn-cardinal", "UMN — cardinal test image",
  "The acceptance fixture's placement with the generated N/E/S/W image, to detect mirroring and wrong directions.",
  ["cardinal-grid"],
  [orb("umn-cardinal-orb", "cardinal-grid", "UMN — cardinal test image", "Generated letters N, E, S and W on the horizon and a 30° grid, 30 m above the campus.")],
  { initialPanorama: "umn-cardinal-orb", overview }));

// Two different images 80 m apart, north and south of the anchor, linked both ways.
const pair = [
  { ...orb("pair-photo", "buikslotermeerplein-512", "Test pair: photograph", "The test photograph, 40 m south of the anchor."),
    marker: { mode: "ground-relative", eastM: 0, northM: -40, offsetM: 12, radiusMeters: 2 },
    initialView: { headingDeg: 0, pitchDeg: 0, verticalFovDeg: 60 },
    links: [{ id: "to-grid", target: "pair-grid", label: "Go to the cardinal grid", direction: { headingDeg: 0, pitchDeg: -5 } }] },
  { ...orb("pair-grid", "cardinal-grid", "Test pair: cardinal grid", "The generated cardinal image, 40 m north of the anchor."),
    // Overrides the scene's outline: a wider yellow ring on this orb only.
    marker: { mode: "ground-relative", eastM: 0, northM: 40, offsetM: 12, radiusMeters: 2, style: { outline: { color: "#facc15", widthPx: 3 } } },
    links: [
      { id: "to-photo", target: "pair-photo", label: "Return to the photograph", direction: { headingDeg: 180, pitchDeg: -5 } },
      { id: "to-photo-facing-east", target: "pair-photo", label: "Photograph, facing east", arrivalView: { headingDeg: 90, pitchDeg: 0, verticalFovDeg: 70 } },
    ] },
];
for (const entity of pair) entity.capture = { ...entity.capture, ...(entity.marker.northM < 0 ? { latitudeDeg: CAMPUS.latitudeDeg - 40 / 111_111 } : { latitudeDeg: CAMPUS.latitudeDeg + 40 / 111_111 }) };
for (const entity of pair) entity.marker = { ...entity.marker, northM: 0 };
writeWithSheet("campus-pair.scene.json", scene("campus-pair", "Test pair: two linked panoramas",
  "Two different images linked both ways, for the enter, look, link, exit and dispose path.",
  ["buikslotermeerplein-512", "cardinal-grid"], pair,
  { groups: [{ id: "both", title: "Both test images", members: ["pair-photo", "pair-grid"] }], initialPanorama: "pair-photo",
    overview: { target: { ...CAMPUS, height: null }, distanceMeters: 180, headingDeg: 90, pitchDeg: -25, verticalFovDeg: 60 },
    // Every orb's outline, and growth under the pointer.
    markerStyle: { outline: { color: "#ffffff", widthPx: 2 }, hover: { scale: 1.25 } } }));

// Placed from a stated height rather than the ground, so a check with no map still flies in and out of it.
const tilesHeight = { meters: 250, datum: "WGS84-ellipsoid", source: "A round figure near the campus's ground, for a check that loads no terrain; not measured." };
writeWithSheet("umn-tiles.scene.json", scene("umn-tiles", "UMN — tiled test image",
  "The cardinal image as equi-angular and ordinary tiled cubes beside a whole image, at the acceptance fixture's placement: the tiled path, and the colour check of scripts/validation/panorama-tiles.mjs.",
  ["cardinal-tiles"],
  [{ ...orb("umn-tiles-orb", "cardinal-tiles", "UMN — tiled test image", "Generated letters N, E, S and W on the horizon and a 30° grid, 30 m above a stated height at the campus, as tiles."),
    capture: { ...CAMPUS, height: tilesHeight },
    marker: { mode: "capture-relative", eastM: 0, northM: 0, offsetM: 30, radiusMeters: 2 } }],
  { initialPanorama: "umn-tiles-orb", overview: { ...overview, target: { ...CAMPUS, height: { ...tilesHeight, meters: tilesHeight.meters + 30 } } } }));

console.log(`Wrote the example scenes to ${path.relative(root, examples)}.`);
