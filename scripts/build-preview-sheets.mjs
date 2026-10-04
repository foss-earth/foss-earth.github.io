#!/usr/bin/env node
/**
 * Adds preview sheets to a scene on disk (docs/scenes/format.md, "Preview
 * sheets"): one image holding the faces of every panorama's smallest preview
 * cube, so a first visit shows all the scene's orbs after one request, not six
 * an orb. The cubes' own face files stay. Sheets the scene already has are
 * replaced.
 *
 *   node scripts/build-preview-sheets.mjs tour/scene.json
 *
 * Options:
 *   --face-size n     the preview cubes to put in sheets; default: the scene's smallest
 *   --quality q       JPEG quality of the sheet, 1 to 100; default 80
 *   --max-pixels n    the most pixels a sheet holds before another is begun; default 4000000
 *
 * Writes media/previews-<size>.jpg beside the manifest and the manifest itself.
 * The manifest's own `revision` is the caller's to change: a build that
 * derives it from the scene should add the sheets first, with addPreviewSheets
 * from scripts/lib/previewSheet.mjs. Nothing is fetched from the network.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addPreviewSheets, SHEET_PIXELS, sheetsOf } from "./lib/previewSheet.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.findIndex(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (at < 0) return fallback;
  return args[at].includes("=") ? args[at].slice(name.length + 3) : args[at + 1];
};
const manifestPath = args.find((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1].startsWith("--") && !args[index - 1].includes("=")));
if (!manifestPath || args.includes("--help")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(manifestPath ? 0 : 1);
}
const folder = path.dirname(path.resolve(manifestPath));
const faceSize = option("face-size") === undefined ? undefined : Number(option("face-size"));
const before = JSON.parse(readFileSync(manifestPath, "utf8"));
const { document, files, cubes } = addPreviewSheets(before, {
  faceSize,
  quality: Number(option("quality", "80")),
  maxPixels: Number(option("max-pixels", String(SHEET_PIXELS))),
  read(url) {
    const file = path.resolve(folder, decodeURIComponent(url));
    if (!file.startsWith(folder)) throw new Error(`${url} is outside the scene's folder`);
    return existsSync(file) ? readFileSync(file) : null;
  },
});
// A sheet the scene named and no longer does is its own file to remove.
for (const sheet of sheetsOf(before)) {
  const file = path.resolve(folder, decodeURIComponent(sheet.url));
  if (file.startsWith(folder) && !files.some(each => each.url === sheet.url)) rmSync(file, { force: true });
}
for (const { url, bytes } of files) {
  const file = path.join(folder, url);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
writeFileSync(manifestPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(files.length
  ? `${cubes} preview cubes in ${files.length} ${files.length === 1 ? "sheet" : "sheets"}: ${files.map(file => `${file.url} (${(file.bytes.length / 1024).toFixed(0)} KiB)`).join(", ")}`
  : "No preview cubes of that size: the scene is unchanged but for its sheets, which are gone.");
