import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSceneFiles } from "./checkSceneFiles";
import { validateScene } from "./validateScene";

const directory = fileURLToPath(new URL("../../public/examples/panorama-scenes/", import.meta.url));
const manifests = readdirSync(directory).filter(name => name.endsWith(".scene.json"));

/** The file a resolved example URL names, from the served origin back to public/. */
function localFile(url: string): string {
  return path.join(directory, decodeURIComponent(new URL(url).pathname.replace("/examples/panorama-scenes/", "")));
}

describe("published example scenes", () => {
  it("exist", () => {
    expect(manifests).toEqual(expect.arrayContaining(["umn-single.scene.json", "umn-cardinal.scene.json", "campus-pair.scene.json"]));
  });

  for (const name of manifests) {
    it(`${name} validates, and its files are what it declares`, () => {
      const result = validateScene(readFileSync(path.join(directory, name), "utf8"), { baseUrl: `https://foss-earth.test/examples/panorama-scenes/${name}` });
      expect(result.ok ? [] : result.errors).toEqual([]);
      if (!result.ok) return;
      const report = checkSceneFiles(result.scene, url => (existsSync(localFile(url)) ? new Uint8Array(readFileSync(localFile(url))) : null));
      expect(report.problems).toEqual([]);
      expect(report.files).toBeGreaterThan(0);
    });
  }

  it("places the acceptance orb 30 m above the displayed ground at the campus anchor, with an unknown capture height", () => {
    const result = validateScene(readFileSync(path.join(directory, "umn-single.scene.json"), "utf8"), { baseUrl: "https://foss-earth.test/examples/panorama-scenes/umn-single.scene.json" });
    if (!result.ok) throw new Error("invalid");
    const orb = result.scene.panoramas.get("umn-test-orb")!;
    expect(orb.capture).toEqual({ longitudeDeg: -93.235, latitudeDeg: 44.974, height: null });
    expect(orb.marker).toEqual({ mode: "ground-relative", eastM: 0, northM: 0, offsetM: 30, radiusMeters: 2 });
    expect(result.scene.title).toBe("UMN — test panorama");
    expect(result.scene.overview?.verticalFovDeg).toBe(60);
  });
});
