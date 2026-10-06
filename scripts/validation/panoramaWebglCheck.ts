/** Real-context panorama checks; driven by panorama-webgl.mjs without a server. */
import { Color3, Color4, Engine, FreeCamera, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { createPanoramaRenderer } from "../../src/engine/babylon/panorama/panoramaRenderer";
import { createPanoramaUploader } from "../../src/engine/babylon/panorama/panoramaTextures";
import { CUBE_FACE_NAMES, ecef, type CubeFaceName, type Mat3, type Vec3 } from "../../src/scenes/panoramaMath";

const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const COLORS: Record<CubeFaceName, [number, number, number]> = {
  px: [220, 32, 32], nx: [32, 220, 32], py: [32, 32, 220],
  ny: [220, 220, 32], pz: [220, 32, 220], nz: [32, 220, 220],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function bitmap(width: number, height: number, color: readonly number[], bottom?: readonly number[]): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.fillStyle = `rgb(${color.join(",")})`;
  context.fillRect(0, 0, width, height);
  if (bottom) {
    context.fillStyle = `rgb(${bottom.join(",")})`;
    context.fillRect(0, height / 2, width, height / 2);
  }
  return createImageBitmap(canvas);
}

async function run() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.style.cssText = "width:256px;height:256px";
  document.body.append(canvas);
  const webgl1 = new URLSearchParams(location.search).get("backend") === "webgl1";
  const engine = new Engine(canvas, false, { disableWebGL2Support: webgl1, preserveDrawingBuffer: true });
  // Match the globe's reversed depth while testing the custom fragment-depth shaders.
  engine.useReverseDepthBuffer = true;
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 1);
  const camera = new FreeCamera("camera", new Vector3(0, 0, -10), scene);
  camera.minZ = 0.1;
  camera.maxZ = 100;
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  const renderer = createPanoramaRenderer(scene, { getPresentationView: () => null, requestRender() {} });
  const allowance = 16 * 1024;
  const uploader = createPanoramaUploader(scene, { bytesPerFrame: allowance, outstandingBytes: allowance * 2 }, () => {});
  let maxUploadedPerFrame = 0;
  let frame = 0;
  const renderCosts: number[] = [];
  engine.runRenderLoop(() => {
    const start = performance.now();
    maxUploadedPerFrame = Math.max(maxUploadedPerFrame, uploader.pump());
    scene.render();
    renderCosts.push(performance.now() - start);
    frame++;
  });
  async function frames(count = 5) {
    const end = frame + count;
    while (frame < end) await new Promise(resolve => requestAnimationFrame(resolve));
  }
  async function pixel(x = 128, y = 128) {
    await frames();
    await scene.whenReadyAsync();
    await frames(2);
    return Array.from(new Uint8Array((await engine.readPixels(x, y, 1, 1)).buffer)).slice(0, 3);
  }
  const close = (actual: number[], expected: readonly number[], label: string) => {
    assert(actual.every((value, index) => Math.abs(value - expected[index]) <= 5), `${label}: ${actual} != ${expected}`);
  };
  try {
    assert(engine.webGLVersion === (webgl1 ? 1 : 2), "Requested WebGL context was not selected");
    assert(renderer.available, renderer.unavailableReason ?? "Renderer unavailable");
    const faces = {} as Record<CubeFaceName, ImageBitmap>;
    for (const face of CUBE_FACE_NAMES) faces[face] = await bitmap(64, 64, COLORS[face]);
    const cube = await uploader.uploadCube(faces, "test cube");
    for (const face of Object.values(faces)) face.close();
    const orb = renderer.addOrb("test", {
      marker: [0, 0, 0], radiusMeters: 1, content: IDENTITY, texture: cube.texture,
      visible: true, outline: null, displayScale: 1,
    });
    const orbPixel = await pixel();
    if (orbPixel.every(value => value === 0)) {
      const gl = engine._gl;
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X, cube.texture.getInternalTexture()!._hardwareTexture!.underlyingResource, 0);
      const uploadedPixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, uploadedPixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      throw new Error(JSON.stringify({ blackOrb: true, uploadedPixel: [...uploadedPixel], glError: gl.getError(), size: [engine.getRenderWidth(), engine.getRenderHeight()], draws: renderer.drawRecords().length, frame: renderer.cameraFrame(), textures: cube.texture.isReady(), meshes: scene.meshes.map(mesh => ({ name: mesh.name, ready: mesh.isReady(), enabled: mesh.isEnabled(), effect: mesh.material?.getEffect()?.getCompilationError() })) }));
    }
    close(orbPixel, COLORS.pz, "Orb cube orientation / color");

    // An opaque surface in front must hide the analytic sphere; one behind must not.
    const plane = MeshBuilder.CreatePlane("ground", { size: 20 }, scene);
    const material = new StandardMaterial("ground", scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.FromInts(64, 64, 64);
    material.backFaceCulling = false;
    plane.material = material;
    plane.position.z = -2;
    const occluded = await pixel();
    assert(occluded.every(value => Math.abs(value - occluded[0]) < 3), `Foreground did not hide orb: ${occluded}`);
    plane.position.z = 2;
    close(await pixel(), COLORS.pz, "Orb depth in front of ground");
    plane.dispose();
    material.dispose();

    renderer.immersion.show({ source: { texture: cube.texture, kind: "cube", content: IDENTITY } });
    close(await pixel(), COLORS.pz, "Immersive cube color");
    const directions: Record<CubeFaceName, Vec3> = { px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0], pz: [0, 0, 1], nz: [0, 0, -1] };
    for (const face of CUBE_FACE_NAMES) {
      const direction = directions[face];
      renderer.immersion.show({ source: { texture: cube.texture, kind: "cube", content: IDENTITY }, view: {
        position: ecef([0, 0, -10]), forward: ecef(direction), up: ecef(Math.abs(direction[2]) === 1 ? [0, 1, 0] : [0, 0, 1]), verticalFovRad: Math.PI / 3,
      } });
      close(await pixel(), COLORS[face], `Immersive cube face ${face}`);
    }
    // NPOT is intentional: WebGL1 must clamp/filter correctly without forbidden mips.
    const image = await bitmap(300, 150, [128, 128, 128]);
    const whole = await uploader.uploadEquirect(image, "NPOT whole image");
    image.close();
    renderer.immersion.show({ source: { texture: whole.texture, kind: "equirectangular", content: IDENTITY } });
    close(await pixel(), [128, 128, 128], "NPOT equirectangular gamma");
    renderer.immersion.show({ source: { texture: cube.texture, kind: "cube", content: IDENTITY }, next: { texture: whole.texture, kind: "equirectangular", content: IDENTITY }, mix: 0.5 });
    const linear = (value: number) => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
    const encoded = (value: number) => 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
    close(await pixel(), COLORS.pz.map(value => encoded((linear(value) + linear(128)) / 2)), "Linear-light crossfade");
    const orientedImage = await bitmap(300, 150, [220, 32, 32], [32, 32, 220]);
    const oriented = await uploader.uploadEquirect(orientedImage, "Top and bottom");
    orientedImage.close();
    renderer.immersion.show({ source: { texture: oriented.texture, kind: "equirectangular", content: IDENTITY }, view: {
      position: ecef([0, 0, -10]), forward: ecef([0, 1, 0]), up: ecef([0, 0, 1]), verticalFovRad: Math.PI / 3,
    } });
    close(await pixel(128, 192), [220, 32, 32], "Equirectangular upper rows");
    close(await pixel(128, 64), [32, 32, 220], "Equirectangular lower rows");
    renderer.immersion.show(null);
    for (let index = 1; index < 60; index++) renderer.addOrb(`orb-${index}`, {
      marker: [((index % 10) - 4.5) * 0.45, (Math.floor(index / 10) - 2.5) * 0.45, 0],
      radiusMeters: 0.1, content: IDENTITY, texture: cube.texture, visible: true, outline: null, displayScale: 1,
    });
    const uploaded = uploader.stats().uploadedBytes;
    renderCosts.length = 0;
    await frames(120);
    assert(uploader.stats().uploadedBytes === uploaded, "Steady-state drawing reuploaded image pixels");
    assert(maxUploadedPerFrame <= allowance, `Upload exceeded frame allowance: ${maxUploadedPerFrame}`);
    const costs = [...renderCosts].sort((a, b) => a - b);
    const gl = canvas.getContext(webgl1 ? "webgl" : "webgl2") as WebGLRenderingContext | WebGL2RenderingContext;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const report = {
      backend: `webgl${engine.webGLVersion}`, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      reverseDepth: engine.useReverseDepthBuffer,
      orbPixel, occluded, maxUploadedPerFrame, uploadAllowance: allowance,
      npotMipLevels: whole.levels, steadyFrames: renderCosts.length,
      cpuRenderP50Ms: costs[Math.floor(costs.length * 0.5)], cpuRenderP95Ms: costs[Math.floor(costs.length * 0.95)],
      glError: gl.getError(),
    };
    assert(report.glError === gl.NO_ERROR, `WebGL error: ${report.glError}`);
    orb.dispose();
    cube.dispose();
    whole.dispose();
    oriented.dispose();
    return report;
  } finally {
    uploader.cancelAll("Check complete");
    renderer.dispose();
    engine.stopRenderLoop();
    scene.dispose();
    engine.dispose();
  }
}

Object.assign(window, { panoramaCheck: { done: false } });
void run().then(
  report => Object.assign(window, { panoramaCheck: { done: true, ok: true, report } }),
  error => Object.assign(window, { panoramaCheck: { done: true, ok: false, error: String(error?.stack ?? error) } }),
);
