import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSceneFiles } from "./checkSceneFiles";
import { validateScene } from "./validateScene";

const examples = new URL("../../public/examples/panorama-scenes/", import.meta.url);
const manifest = readFileSync(new URL("umn-cardinal.scene.json", examples), "utf8");
const base = "https://foss-earth.test/examples/panorama-scenes/umn-cardinal.scene.json";

function scene() {
  const result = validateScene(manifest, { baseUrl: base });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.scene;
}

/** The example's own files, keyed by resolved URL, with `change` applied to some of them. */
function reader(change: (url: string, bytes: Uint8Array) => Uint8Array | null = (_url, bytes) => bytes) {
  return (url: string) => {
    const relative = new URL(url).pathname.replace("/examples/panorama-scenes/", "");
    return change(url, new Uint8Array(readFileSync(new URL(relative, examples))));
  };
}

describe("checkSceneFiles", () => {
  it("passes the example's own files and counts them", () => {
    const report = checkSceneFiles(scene(), reader());
    expect(report.problems).toEqual([]);
    // Four preview cubes of six faces and two whole images.
    expect(report.files).toBe(26);
    expect(report.largestFile?.url).toMatch(/immersion-2048\.jpg$/);
  });

  it("names a missing file, and does not also report its representation's total", () => {
    const report = checkSceneFiles(scene(), reader((url, bytes) => (url.endsWith("preview-64/px.jpg") ? null : bytes)));
    expect(report.problems).toEqual([
      { path: "$.assets[cardinal-grid].representations[preview-64].faces.px", message: expect.stringMatching(/preview-64\/px\.jpg does not exist$/) },
    ]);
  });

  it("reports a representation whose files do not add up to its declared bytes", () => {
    const report = checkSceneFiles(scene(), reader((url, bytes) => (url.endsWith("immersion-1024.jpg") ? new Uint8Array([...bytes, 0]) : bytes)));
    expect(report.problems).toEqual([
      { path: "$.assets[cardinal-grid].representations[whole-1024].encodedBytes", message: expect.stringMatching(/the files hold \d+$/) },
    ]);
  });

  it("reports a file whose header disagrees with its representation", () => {
    const bigger = new Uint8Array(readFileSync(new URL("media/cardinal-grid/preview-128/px.jpg", examples)));
    const report = checkSceneFiles(scene(), reader((url, bytes) => (url.endsWith("preview-64/nz.jpg") ? bigger : bytes)));
    expect(report.problems.map(problem => problem.path)).toEqual([
      "$.assets[cardinal-grid].representations[preview-64].faces.nz",
      "$.assets[cardinal-grid].representations[preview-64].encodedBytes",
    ]);
    expect(report.problems[0].message).toMatch(/is 128×128 pixels, declared 64×64/);
  });
});
