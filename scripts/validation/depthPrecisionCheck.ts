/** Synthetic depth ordering check, driven by depth-precision.mjs without a server. */
import { Color3, Color4, FreeCamera, MeshBuilder, Scene, StandardMaterial, Vector3, type Engine, type WebGPUEngine } from "@babylonjs/core";
import { bootstrapGlobeRenderer, type RendererMode } from "../../src/engine/babylon/createRendererMode";

const SIZE = 128;
const SAMPLE_SIZE = 16;
const configurations = [
  { name: "conventional", reverse: false, nearMeters: 0.05 },
  { name: "reverse", reverse: true, nearMeters: 0.05 },
  // A diagnostic control; 10 m would clip the cockpit and is not an app fix.
  { name: "near-control", reverse: false, nearMeters: 10 },
] as const;
const separations = [
  { distanceMeters: 1000, gapMeters: 0.1 },
  { distanceMeters: 1000, gapMeters: 1 },
  { distanceMeters: 10000, gapMeters: 1 },
] as const;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function run() {
  const backend = new URLSearchParams(location.search).get("backend") as RendererMode;
  assert(["webgpu", "webgl2", "webgl"].includes(backend), "Unknown backend");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px;display:block`;
  document.body.append(canvas);
  // The runner disables WebGL 2 for the WebGL 1 fallback in its own browser.
  const created = await bootstrapGlobeRenderer(canvas, { force: backend, antialias: false });
  const engine = created.renderer.engine;
  created.scene?.dispose();
  const actual = engine.isWebGPU ? "webgpu" : (engine as Engine).webGLVersion === 1 ? "webgl" : "webgl2";
  assert(actual === backend, `Asked for ${backend}, got ${actual}`);
  const renderer = engine.isWebGPU ? (engine as WebGPUEngine).getInfo() : (engine as Engine).getGlInfo();
  assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(renderer)), `Software renderer: ${JSON.stringify(renderer)}`);
  const bootstrapReverse = engine.useReverseDepthBuffer;
  const viewport = { width: engine.getRenderWidth(), height: engine.getRenderHeight() };
  const results = [];
  try {
    for (const configuration of [{ name: "production", reverse: bootstrapReverse, nearMeters: 0.05 }, ...configurations]) {
      engine.useReverseDepthBuffer = configuration.reverse;
      const scene = new Scene(engine);
      scene.useRightHandedSystem = true;
      scene.clearColor = new Color4(0, 0, 0, 1);
      scene.skipPointerMovePicking = true;
      const camera = new FreeCamera("camera", Vector3.Zero(), scene);
      camera.minZ = configuration.nearMeters;
      camera.maxZ = 250_000;
      camera.setTarget(new Vector3(0, 0, -1));
      scene.activeCamera = camera;
      const foreground = MeshBuilder.CreatePlane("foreground", { size: 1 }, scene);
      const background = MeshBuilder.CreatePlane("background", { size: 1 }, scene);
      for (const [mesh, colour] of [[foreground, Color3.Green()], [background, Color3.Red()]] as const) {
        mesh.rotation.set(0.17, 0.23, 0);
        const material = new StandardMaterial(mesh.name, scene);
        material.disableLighting = true;
        material.emissiveColor = colour;
        material.backFaceCulling = false;
        mesh.material = material;
      }
      let foregroundFirst = true;
      scene.setRenderingOrder(0, (a, b) => {
        const order = a.getMesh() === foreground ? -1 : 1;
        return a === b ? 0 : foregroundFirst ? order : -order;
      });
      try {
        for (const { distanceMeters, gapMeters } of separations) {
          foreground.position.z = -distanceMeters;
          background.position.z = -distanceMeters - gapMeters;
          foreground.scaling.setAll(distanceMeters * 0.5);
          background.scaling.copyFrom(foreground.scaling);
          await scene.whenReadyAsync();
          const samples = [];
          for (const shiftMeters of [0, 0.1, 0.5]) {
            camera.position.set(shiftMeters, shiftMeters / 2, 0);
            for (const order of ["foreground-first", "background-first"] as const) {
              foregroundFirst = order === "foreground-first";
              // Read before presentation; WebGPU releases its canvas texture after endFrame.
              engine.beginFrame();
              scene.render();
              const reading = engine.readPixels(Math.floor((viewport.width - SAMPLE_SIZE) / 2), Math.floor((viewport.height - SAMPLE_SIZE) / 2), SAMPLE_SIZE, SAMPLE_SIZE);
              engine.endFrame();
              const bytes = await reading;
              const rgba = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
              let foregroundPixels = 0;
              let backgroundPixels = 0;
              let unexpectedPixels = 0;
              for (let i = 0; i < rgba.length; i += 4) {
                if (rgba[i + 1] > 200 && rgba[i] < 30 && rgba[i + 2] < 30) foregroundPixels++;
                else if (rgba[i] > 200 && rgba[i + 1] < 30 && rgba[i + 2] < 30) backgroundPixels++;
                else unexpectedPixels++;
              }
              samples.push({ order, shiftMeters, foregroundPixels, backgroundPixels, unexpectedPixels });
            }
          }
          results.push({ configuration: configuration.name, nearMeters: camera.minZ, farMeters: camera.maxZ,
            distanceMeters, gapMeters, samples, correct: samples.every(sample => sample.foregroundPixels === SAMPLE_SIZE ** 2) });
        }
      } finally { scene.dispose(); }
    }
    return { backend, renderer, viewport, bootstrapReverse, samplePixels: SAMPLE_SIZE ** 2, results };
  } finally { engine.dispose(); canvas.remove(); }
}

declare global {
  interface Window { depthPrecisionCheck?: { done: boolean; report?: Awaited<ReturnType<typeof run>>; error?: string } }
}
window.depthPrecisionCheck = { done: false };
void run().then(report => { window.depthPrecisionCheck = { done: true, report }; }, error => {
  window.depthPrecisionCheck = { done: true, error: error instanceof Error ? error.stack : String(error) };
});
