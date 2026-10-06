/** Real-backend mesh-inspection fixture, driven by mesh-inspector.mjs. */
import { Camera, Color3, Color4, FreeCamera, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, type Engine, type Mesh, type WebGPUEngine } from "@babylonjs/core";
import { bootstrapGlobeRenderer, type RendererMode } from "../../src/engine/babylon/createRendererMode";
import { createMeshInspector } from "../../src/diagnostics/createMeshInspector";

const SIZE = 384;
const OVERLAY_PREFIX = "mesh-inspector-wireframe:";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function run() {
  const backend = new URLSearchParams(location.search).get("backend") as RendererMode;
  assert(["webgpu", "webgl2", "webgl"].includes(backend), "Unknown backend");
  document.body.style.cssText = "margin:12px;background:#17202b;color:white;font:14px sans-serif";
  const title = document.createElement("h2");
  title.textContent = `Mesh inspector • ${backend} • real GPU correctness`;
  document.body.append(title);
  const gallery = document.createElement("div");
  gallery.style.cssText = "display:flex;flex-wrap:wrap;gap:8px";
  document.body.append(gallery);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px;display:block;position:absolute;left:-10000px`;
  document.body.append(canvas);
  const created = await bootstrapGlobeRenderer(canvas, { force: backend, antialias: false });
  const engine = created.renderer.engine;
  created.scene?.dispose();
  const actual = engine.isWebGPU ? "webgpu" : (engine as Engine).webGLVersion === 1 ? "webgl" : "webgl2";
  assert(actual === backend, `Asked for ${backend}, got ${actual}`);
  const renderer = engine.isWebGPU ? (engine as WebGPUEngine).getInfo() : (engine as Engine).getGlInfo();
  assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(renderer)), `Software renderer: ${JSON.stringify(renderer)}`);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.skipPointerMovePicking = true;
  scene.clearColor = new Color4(0.1, 0.2, 0.3, 1);
  const camera = new FreeCamera("camera", new Vector3(0, 0, 10), scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = camera.orthoBottom = -3;
  camera.orthoRight = camera.orthoTop = 3;
  camera.minZ = 0.05;
  camera.maxZ = 100;
  scene.activeCamera = camera;
  const checks: { name: string; passed: boolean; detail: unknown }[] = [];
  const samples: Record<string, ReturnType<typeof summarize>> = {};
  let requests = 0;
  const inspector = createMeshInspector(scene, { requestRender: () => { requests++; } });
  let redIndex = 0;
  let bottomUp = false;
  let lastPixels = new Uint8ClampedArray();

  function check(name: string, passed: boolean, detail: unknown) {
    checks.push({ name, passed, detail });
  }

  async function readRaw() {
    engine.beginFrame();
    scene.render();
    const reading = engine.readPixels(0, 0, SIZE, SIZE);
    engine.endFrame();
    const bytes = await reading;
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function normalize(raw: Uint8Array) {
    const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) {
      const sourceY = bottomUp ? SIZE - y - 1 : y;
      for (let x = 0; x < SIZE; x++) {
        const source = (sourceY * SIZE + x) * 4;
        const target = (y * SIZE + x) * 4;
        rgba[target] = raw[source + redIndex];
        rgba[target + 1] = raw[source + 1];
        rgba[target + 2] = raw[source + 2 - redIndex];
        rgba[target + 3] = raw[source + 3];
      }
    }
    return rgba;
  }

  function summarize(rgba: Uint8ClampedArray) {
    let orange = 0;
    let green = 0;
    let orangeX = 0;
    let orangeY = 0;
    let minX = SIZE;
    let maxX = -1;
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
      if (r > 180 && g > 30 && g < 210 && b < 90) {
        const x = (i / 4) % SIZE;
        const y = Math.floor(i / 4 / SIZE);
        orange++;
        orangeX += x;
        orangeY += y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      if (g > r * 1.3 && g > b * 1.3 && g > 70) green++;
    }
    return { orange, green, orangeCentroid: orange ? { x: orangeX / orange, y: orangeY / orange } : null,
      orangeBoundsX: orange ? { min: minX, max: maxX } : null };
  }

  async function sample(name: string, screenshot = false) {
    const rgba = normalize(await readRaw());
    lastPixels = rgba;
    const summary = summarize(rgba);
    samples[name] = summary;
    if (screenshot) {
      const figure = document.createElement("figure");
      figure.style.cssText = "margin:0";
      const image = document.createElement("canvas");
      image.width = image.height = SIZE;
      image.style.cssText = `display:block;width:${SIZE}px;height:${SIZE}px`;
      image.getContext("2d")!.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
      const caption = document.createElement("figcaption");
      caption.textContent = `${name}: ${summary.orange} orange / ${summary.green} solid pixels`;
      figure.append(image, caption);
      gallery.append(figure);
    }
    return summary;
  }

  function diagonalCoverage(mesh: Mesh, halfSize: number) {
    const world = mesh.computeWorldMatrix(true);
    const viewport = camera.viewport.toGlobal(SIZE, SIZE);
    const first = Vector3.Project(new Vector3(halfSize, -halfSize, halfSize), world, scene.getTransformMatrix(), viewport);
    const last = Vector3.Project(new Vector3(-halfSize, halfSize, halfSize), world, scene.getTransformMatrix(), viewport);
    let covered = 0;
    const total = 80;
    for (let i = 0; i < total; i++) {
      const t = 0.1 + 0.8 * i / (total - 1);
      const point = Vector3.Lerp(first, last, t);
      let orange = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const index = (Math.round(point.y + dy) * SIZE + Math.round(point.x + dx)) * 4;
        const [r, g, b] = [lastPixels[index], lastPixels[index + 1], lastPixels[index + 2]];
        if (r > 180 && g > 30 && g < 210 && b < 90) orange = true;
      }
      if (orange) covered++;
    }
    return { covered, total, ratio: covered / total, projected: { first: { x: first.x, y: first.y }, last: { x: last.x, y: last.y } } };
  }

  async function settleRemoval() {
    // Babylon's Observable.remove marks immediately and unregisters next task.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  async function ready(count: number) {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      assert(!inspector.getSnapshot().error, `Inspector: ${inspector.getSnapshot().error}`);
      const overlays = scene.meshes.filter(mesh => mesh.name.startsWith(OVERLAY_PREFIX));
      if (overlays.length === count && overlays.every(mesh => mesh.isEnabled())) {
        await scene.whenReadyAsync();
        return;
      }
      // Production's readiness helper can compile without a persistent render loop.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    throw new Error(`Expected ${count} ready overlay meshes; found ${JSON.stringify(scene.meshes.filter(mesh => mesh.name.startsWith(OVERLAY_PREFIX)).map(mesh => ({ name: mesh.name, enabled: mesh.isEnabled() })))}`);
  }

  function resources() {
    return { meshes: scene.meshes.length, geometries: scene.geometries.length, materials: scene.materials.length,
      beforeActiveMeshesObservers: scene.onBeforeActiveMeshesEvaluationObservable.observers.length,
      beforeRenderObservers: scene.onBeforeRenderObservable.observers.length, afterRenderObservers: scene.onAfterRenderObservable.observers.length };
  }

  function solidMaterial(name: string, color: Color3) {
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.emissiveColor = color;
    material.specularColor = Color3.Black();
    return material;
  }

  try {
    // Discover byte order and row orientation independently for each backend.
    const calibration = MeshBuilder.CreatePlane("readback calibration", { size: 0.3 }, scene);
    calibration.position.y = 2;
    const calibrationMaterial = solidMaterial("calibration white", Color3.White());
    calibrationMaterial.backFaceCulling = false;
    calibration.material = calibrationMaterial;
    await scene.whenReadyAsync();
    const calibrationPixels = await readRaw();
    redIndex = calibrationPixels[0] < calibrationPixels[2] ? 0 : 2;
    let whiteY = 0;
    let whitePixels = 0;
    for (let i = 0; i < calibrationPixels.length; i += 4) {
      if (calibrationPixels[i] > 240 && calibrationPixels[i + 1] > 240 && calibrationPixels[i + 2] > 240) {
        whiteY += Math.floor(i / 4 / SIZE);
        whitePixels++;
      }
    }
    assert(whitePixels > 100, "Readback orientation calibration did not draw its white marker");
    bottomUp = whiteY / whitePixels > SIZE / 2;
    calibration.dispose();
    calibrationMaterial.dispose();

    const root = new TransformNode("model root", scene);
    const body = MeshBuilder.CreateBox("solid body", { size: 1.5 }, scene);
    body.parent = root;
    body.position.set(-0.95, -0.15, 0);
    body.rotation.set(0.2, 0.35, 0.05);
    const pivot = new TransformNode("moving nested group", scene);
    pivot.parent = root;
    pivot.position.set(0.7, 0.35, 0);
    const part = MeshBuilder.CreateBox("nested moving part", { size: 0.9 }, scene);
    part.parent = pivot;
    part.position.set(0.3, 0.25, 0);
    part.rotation.set(0.15, 0.25, 0);
    const green = solidMaterial("original solid green", new Color3(0.15, 0.7, 0.25));
    body.material = part.material = green;
    await scene.whenReadyAsync();
    const before = resources();
    inspector.setRoots([root]);
    const tree = inspector.getSnapshot();
    check("hierarchy includes nested groups and meshes", tree.roots.length === 1 && tree.roots[0].id === root.uniqueId
      && tree.roots[0].children.some(node => node.id === pivot.uniqueId && node.children.some(child => child.id === part.uniqueId)), tree);
    const baseline = await sample("Solid baseline", true);
    check("baseline contains solid fill and no orange", baseline.orange === 0 && baseline.green > 5000, baseline);

    inspector.setEnabled(true);
    await ready(2);
    const all = await sample("All meshes selected", true);
    check("selected polygon edges overlay solid fill", all.orange > 300 && all.green > baseline.green * 0.75, { baseline, selected: all });
    const diagonals = { body: diagonalCoverage(body, 0.75), part: diagonalCoverage(part, 0.45) };
    check("front triangle diagonals remain continuous", diagonals.body.ratio > 0.9 && diagonals.part.ratio > 0.9, diagonals);
    const overlays = scene.meshes.filter(mesh => mesh.name.startsWith(OVERLAY_PREFIX)) as Mesh[];
    check("wireframe shares original vertex geometry", scene.geometries.length === before.geometries
      && overlays.every(mesh => mesh.geometry === (mesh.parent as Mesh).geometry),
    { originalGeometryCount: before.geometries, selectedGeometryCount: scene.geometries.length, overlayCount: overlays.length });
    check("source material preserved", body.material === green && part.material === green && !green.wireframe, { sourceWireframe: green.wireframe });

    // Flight cameras use perspective. Keep the object the same angular size at
    // two distances to exercise the bias without confusing it with LOD/pixels.
    inspector.selectAll(false);
    inspector.setSelected(part.uniqueId, true);
    await ready(1);
    const perspectiveOccluder = MeshBuilder.CreateBox("perspective foreground occluder", { width: 1.5, height: 1.5, depth: 0.25 }, scene);
    perspectiveOccluder.parent = root;
    perspectiveOccluder.position.set(1, 0.6, 2);
    perspectiveOccluder.material = green;
    perspectiveOccluder.setEnabled(false);
    camera.mode = Camera.PERSPECTIVE_CAMERA;
    camera.maxZ = 25_000;
    for (const distance of [10, 1000]) {
      camera.position.z = distance;
      root.scaling.setAll(distance / 10);
      const selected = await sample(`Perspective selected at ${distance} m`);
      const coverage = diagonalCoverage(part, 0.45);
      check(`perspective diagonal continuous at ${distance} m`, selected.orange > 70 && coverage.ratio > 0.9, { selected, coverage });
      perspectiveOccluder.setEnabled(true);
      await scene.whenReadyAsync();
      const covered = await sample(`Perspective occluded at ${distance} m`);
      check(`perspective foreground occludes at ${distance} m`, covered.orange === 0 && covered.green > selected.green, { selected, covered });
      perspectiveOccluder.setEnabled(false);
    }
    perspectiveOccluder.dispose();
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.position.z = 10;
    camera.maxZ = 100;
    root.scaling.setAll(1);

    inspector.selectAll(false);
    await ready(0);
    const none = await sample("All meshes deselected", true);
    check("deselect clears polygon edges", none.orange === 0 && none.green === baseline.green, { baseline, deselected: none });

    inspector.setSelected(pivot.uniqueId, true);
    await ready(1);
    const selectedPart = await sample("Nested group selected", true);
    check("group selection isolates its descendant", selectedPart.orange > 100 && (selectedPart.orangeBoundsX?.min ?? 0) > SIZE / 2, selectedPart);
    const beforeMovement = resources();
    const requestsBeforeMovement = requests;
    pivot.position.x += 0.7;
    const moved = await sample("Nested group moved", true);
    const movementPixels = (moved.orangeCentroid?.x ?? 0) - (selectedPart.orangeCentroid?.x ?? 0);
    check("overlay follows nested source motion", movementPixels > 40 && movementPixels < 50 && moved.orange > 100, { movementPixels, expectedPixels: 0.7 * SIZE / 6 });
    check("motion reuses overlay resources", JSON.stringify(resources()) === JSON.stringify(beforeMovement) && requests === requestsBeforeMovement,
      { before: beforeMovement, after: resources(), frameRequestsDuringMotion: requests - requestsBeforeMovement });

    pivot.setEnabled(false);
    const hidden = await sample("Selected group hidden", true);
    check("hidden ancestor leaves no phantom edges", hidden.orange === 0 && hidden.green > 5000, hidden);
    pivot.setEnabled(true);
    const restored = await sample("Selected group restored");
    check("source visibility restored", restored.orange === moved.orange && restored.green === moved.green, { restored, moved });
    part.isVisible = false;
    const invisible = await sample("Selected mesh invisible");
    check("invisible source leaves no phantom edges", invisible.orange === 0, invisible);
    part.isVisible = true;

    const occluder = MeshBuilder.CreateBox("solid foreground occluder", { width: 1.5, height: 1.5, depth: 0.25 }, scene);
    occluder.position.set(1.7, 0.6, 2);
    occluder.material = green;
    await scene.whenReadyAsync();
    const occluded = await sample("Selected mesh behind solid occluder");
    check("solid foreground hides selected edges behind it", occluded.orange === 0 && occluded.green > baseline.green, occluded);
    occluder.dispose();

    inspector.setEnabled(false);
    await ready(0);
    await settleRemoval();
    const disabled = await sample("Inspector disabled");
    const afterDisabled = resources();
    check("disabled inspector removes edges and releases resources", disabled.orange === 0 && JSON.stringify(before) === JSON.stringify(afterDisabled),
      { before, afterDisabled, disabled });
    const requestsBeforeIdle = requests;
    for (let frame = 0; frame < 3; frame++) await sample(`Disabled frame ${frame}`);
    check("disabled inspector requests no recurring frames", requests === requestsBeforeIdle, { additionalRequests: requests - requestsBeforeIdle });

    inspector.setEnabled(true);
    await ready(1);
    const reenabled = await sample("Inspector enabled again");
    check("reenabling preserves selection", reenabled.orange === moved.orange, { reenabled, moved });
    inspector.setRoots([]);
    await ready(0);
    await settleRemoval();
    check("unloading roots releases overlays", resources().meshes === before.meshes && resources().geometries === before.geometries, resources());
    inspector.dispose();
    check("dispose releases inspector material and observers", JSON.stringify(resources()) === JSON.stringify(before), { before, afterDispose: resources() });
    return { backend, actual, renderer, viewport: { width: SIZE, height: SIZE }, reverseDepth: engine.useReverseDepthBuffer,
      readback: { channels: redIndex === 0 ? "RGBA" : "BGRA", bottomUp }, checks, samples, renderRequests: requests };
  } finally {
    inspector.dispose();
    scene.dispose();
    engine.dispose();
    canvas.remove();
  }
}

declare global {
  interface Window { meshInspectorCheck?: { done: boolean; report?: Awaited<ReturnType<typeof run>>; error?: string } }
}
window.meshInspectorCheck = { done: false };
void run().then(report => { window.meshInspectorCheck = { done: true, report }; }, error => {
  window.meshInspectorCheck = { done: true, error: error instanceof Error ? error.stack : String(error) };
});
