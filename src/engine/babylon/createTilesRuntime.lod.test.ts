// @vitest-environment jsdom

import { FreeCamera, MeshBuilder, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TilesRenderer } from "3d-tiles-renderer/babylonjs";
import { createGoogleTilesRuntime } from "./createTilesRuntime";

// These checks use the installed Babylon adapter and its real REPLACE
// traversal. Only downloads are excluded; the mesh visibility is real.
interface FixtureTile {
  geometricError: number;
  refine: "REPLACE";
  boundingVolume: { sphere: number[] };
  content?: { uri: string };
  children: FixtureTile[];
  parent?: FixtureTile;
  internal: { loadingState: number };
  engineData: { scene: TransformNode | null };
}
interface FixtureRenderer {
  rootLoadingState: number;
  rootTileset: { root: FixtureTile };
  preprocessNode(tile: FixtureTile, path: string, parent?: FixtureTile): void;
  queueTileForDownload(tile: FixtureTile): void;
  calculateTileViewError(tile: FixtureTile, target: { inView: boolean; error: number; distanceFromCamera: number }): void;
}
const LOADED = 4;
const PARSING = 3;

afterEach(() => vi.restoreAllMocks());

describe("Google replacement LOD visibility", () => {
  it("never draws a parent with its replacement descendants during staggered loads, refinement, coarsening and culling", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.activeCamera = new FreeCamera("test-camera", new Vector3(0, 0, -10), scene);
    let culled = false;
    let errorScale = 1;
    vi.spyOn(TilesRenderer.prototype as unknown as FixtureRenderer, "calculateTileViewError").mockImplementation((tile, target) => Object.assign(target, {
      inView: !culled, error: tile.geometricError * errorScale, distanceFromCamera: 10,
    }));
    const onDetailFeedback = vi.fn();
    const runtime = createGoogleTilesRuntime({ scene, apiKey: "test", onDetailFeedback });
    const renderer = runtime.tiles as unknown as FixtureRenderer;
    const models: TransformNode[] = [];
    const makeTile = (name: string, error: number, children: FixtureTile[] = []): FixtureTile => ({
      geometricError: error,
      refine: "REPLACE",
      boundingVolume: { sphere: [0, 0, 0, 1] },
      content: { uri: `${name}.glb` },
      children,
    } as FixtureTile);
    const left = makeTile("left", 1);
    const right = makeTile("right", 1);
    const middle = makeTile("middle", 10, [left, right]);
    const root = makeTile("root", 100, [middle]);
    const prepare = (tile: FixtureTile, parent?: FixtureTile): void => {
      renderer.preprocessNode(tile, "https://example.test/", parent);
      const model = new TransformNode(tile.content!.uri, scene);
      // Identical coplanar geometry makes simultaneous parent/descendant
      // visibility a deterministic z-fighting hazard, independent of a GPU.
      MeshBuilder.CreatePlane(`${model.name}-ground`, { size: 2 }, scene).parent = model;
      model.setEnabled(false);
      models.push(model);
      tile.engineData.scene = model;
      tile.internal.loadingState = LOADED;
      for (const child of tile.children) prepare(child, tile);
    };
    prepare(root);
    renderer.rootLoadingState = LOADED;
    renderer.rootTileset = { root };
    renderer.queueTileForDownload = () => undefined;
    const check = (expected: FixtureTile[]) => {
      const before = runtime.getTerrainDetailState().loadedErrorTarget;
      onDetailFeedback.mockClear();
      runtime.update();
      expect(new Set(runtime.tiles.visibleTiles)).toEqual(new Set(expected));
      const loaded = expected.length ? Math.max(...expected.map(tile => tile.geometricError * errorScale)) : null;
      expect(runtime.getTerrainDetailState().loadedErrorTarget).toBe(loaded);
      expect(onDetailFeedback).toHaveBeenCalledTimes(before === loaded ? 0 : 1);
      for (const tile of [root, middle, left, right]) {
        expect(tile.engineData.scene!.isEnabled()).toBe(expected.includes(tile));
        if (!tile.engineData.scene!.isEnabled()) continue;
        for (let parent = tile.parent; parent; parent = parent.parent) {
          expect(parent.engineData.scene!.isEnabled(), "coplanar replacement ancestor also drawn").toBe(false);
        }
      }
    };
    try {
      runtime.setTerrainDetailTarget(200);
      check([root]);
      middle.internal.loadingState = PARSING;
      left.internal.loadingState = PARSING;
      right.internal.loadingState = PARSING;
      runtime.setTerrainDetailTarget(5);
      check([root]);
      middle.internal.loadingState = LOADED;
      check([middle]);
      left.internal.loadingState = LOADED;
      check([middle]);
      right.internal.loadingState = LOADED;
      check([left, right]);
      expect(runtime.getTerrainDetailState().errorTarget).toBe(5);
      // The request stayed at 5 px throughout loading, while actual loaded
      // error moved from 100 to 10 to 1 px. A closer camera raises it again.
      errorScale = 2;
      check([left, right]);
      errorScale = 1;
      runtime.setTerrainDetailTarget(20);
      check([middle]);
      runtime.setTerrainDetailTarget(200);
      check([root]);
      culled = true;
      check([]);
      culled = false;
      runtime.setTerrainDetailTarget(5);
      check([left, right]);
      check([left, right]); // No new loaded feedback while nothing changes.
      errorScale = Infinity; // Camera inside a loaded bounding volume.
      check([left, right]);
      errorScale = 0; // A loaded zero-error surface remains measurable.
      check([root]);
    } finally {
      runtime.dispose();
      for (const model of models) model.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
