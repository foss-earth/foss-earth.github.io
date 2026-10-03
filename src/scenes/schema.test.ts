import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import schema from "./foss-earth-scene-1.schema.json";
import { validateScene } from "./validateScene";

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const check = ajv.compile(schema);
const BASE = "https://scenes.example/neutral/scene.json";

const examples = fileURLToPath(new URL("../../public/examples/panorama-scenes/", import.meta.url));
const documents: [string, string][] = [
  ["proposal example", readFileSync(new URL("./fixtures/proposal-example.scene.json", import.meta.url), "utf8")],
  ...readdirSync(examples).filter(name => name.endsWith(".scene.json")).map(name => [name, readFileSync(path.join(examples, name), "utf8")] as [string, string]),
];

function parsed(): Record<string, unknown> {
  return JSON.parse(documents[0][1]) as Record<string, unknown>;
}

type Mutation = [string, (doc: Record<string, unknown>) => void];
const entity = (doc: Record<string, unknown>, index: number) => (doc.entities as Record<string, unknown>[])[index];
const asset = (doc: Record<string, unknown>, index: number) => (doc.assets as Record<string, unknown>[])[index];
const representation = (doc: Record<string, unknown>, a: number, r: number) => (asset(doc, a).representations as Record<string, unknown>[])[r];

/** Changes the schema can see, each of which validateScene also refuses. */
const INVALID: Mutation[] = [
  ["another version", doc => { doc.version = 2; }],
  ["an unknown top-level property", doc => { doc.tour = {}; }],
  ["an unknown marker property", doc => { (entity(doc, 0).marker as Record<string, unknown>).height = 4; }],
  ["a latitude out of range", doc => { (entity(doc, 0).capture as Record<string, unknown>).latitudeDeg = 91; }],
  ["longitude 180", doc => { (entity(doc, 0).capture as Record<string, unknown>).longitudeDeg = 180; }],
  ["roll -180", doc => { (entity(doc, 1).imagePose as Record<string, unknown>).rollDeg = -180; }],
  ["north alignment as text", doc => { (entity(doc, 1).imagePose as Record<string, unknown>).aligned = "yes"; }],
  ["a 180° field of view", doc => { (entity(doc, 1).initialView as Record<string, unknown>).verticalFovDeg = 180; }],
  ["a missing cube face", doc => { delete (representation(doc, 1, 0).faces as Record<string, unknown>).nz; }],
  ["an equirect with faces", doc => { representation(doc, 0, 1).faces = {}; }],
  ["an id with a space", doc => { asset(doc, 1).id = "bad id"; }],
  ["no preview cube", doc => { asset(doc, 0).representations = [representation(doc, 0, 1)]; }],
  ["an unnamespaced extension", doc => { doc.extensions = { plain: {} }; }],
  ["a fractional byte count", doc => { representation(doc, 0, 0).encodedBytes = 1.5; }],
  ["an unknown height datum", doc => { (entity(doc, 1).capture as Record<string, unknown>).height = { meters: 2, datum: "EGM96" }; }],
  ["a zero radius", doc => { (entity(doc, 0).marker as Record<string, unknown>).radiusMeters = 0; }],
  ["a link with no label", doc => { delete ((entity(doc, 0).links as Record<string, unknown>[])[0]).label; }],
  ["an outline colour by name", doc => { doc.markerStyle = { outline: { color: "gold", widthPx: 2 } }; }],
  ["an outline wider than 32 px", doc => { (entity(doc, 0).marker as Record<string, unknown>).style = { outline: { color: "#ffffff", widthPx: 33 } }; }],
  ["a hover that shrinks", doc => { doc.markerStyle = { hover: { scale: 0.9 } }; }],
  ["a tiled cube as a preview", doc => { (asset(doc, 0).representations as unknown[]).push({ id: "t", role: "preview", projection: "tiled-cube", warp: "gnomonic", mimeType: "image/jpeg", encodedBytes: 3, faceSize: 4, tileSize: 4, gutter: 0, levelBytes: [3], url: "t/" }); }],
  ["a tiled cube whose folder is a file", doc => { (asset(doc, 0).representations as unknown[]).push({ id: "t", role: "immersion", projection: "tiled-cube", warp: "gnomonic", mimeType: "image/jpeg", encodedBytes: 3, faceSize: 4, tileSize: 4, gutter: 0, levelBytes: [3], url: "t.jpg" }); }],
  ["a tiled cube with a projection's warp missing", doc => { (asset(doc, 0).representations as unknown[]).push({ id: "t", role: "immersion", projection: "tiled-cube", mimeType: "image/jpeg", encodedBytes: 3, faceSize: 4, tileSize: 4, gutter: 0, levelBytes: [3], url: "t/" }); }],
];

describe("the published JSON Schema", () => {
  it("is a valid 2020-12 schema", () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  for (const [name, text] of documents) {
    it(`accepts ${name}`, () => {
      expect(check(JSON.parse(text)) ? [] : check.errors).toEqual([]);
    });
  }

  it("accepts a tiled cube, and a representation of a later projection, which the loader skips", () => {
    const doc = parsed();
    (asset(doc, 0).representations as unknown[]).push(
      { id: "eac-tiles", role: "immersion", projection: "tiled-cube", warp: "equi-angular", mimeType: "image/jpeg", encodedBytes: 600, faceSize: 768, tileSize: 192, gutter: 1, levelBytes: [100, 200, 300], url: "media/eac-tiles/" },
      { id: "octahedral", role: "immersion", projection: "octahedral", mimeType: "image/jpeg", encodedBytes: 5 },
    );
    expect(check(doc) ? [] : check.errors).toEqual([]);
    expect(validateScene(doc, { baseUrl: BASE }).ok).toBe(true);
  });

  it("keeps a later entity or asset type by id, as the loader lists it unsupported", () => {
    const doc = parsed();
    (doc.entities as unknown[]).push({ id: "statue", type: "model", modelUrl: "statue.glb" });
    (doc.assets as unknown[]).push({ id: "statue-mesh", type: "mesh", url: "statue.glb" });
    expect(check(doc) ? [] : check.errors).toEqual([]);
    expect(validateScene(doc, { baseUrl: BASE }).ok).toBe(true);
  });

  for (const [what, mutate] of INVALID) {
    it(`and validateScene both refuse ${what}`, () => {
      const doc = parsed();
      mutate(doc);
      expect(check(doc), what).toBe(false);
      expect(validateScene(doc, { baseUrl: BASE }).ok, what).toBe(false);
    });
  }
});
