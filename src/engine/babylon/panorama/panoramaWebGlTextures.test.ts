import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@babylonjs/core";
import { CUBE_FACE_NAMES, GPU_LAYER_SOURCE_FACES, type CubeFaceName } from "../../../scenes/panoramaMath";
import { createPanoramaUploader } from "./panoramaTextures";

vi.mock("@babylonjs/core", async importOriginal => ({
  ...await importOriginal<typeof import("@babylonjs/core")>(),
  BaseTexture: class {
    private internal: { dispose(): void };
    constructor(_scene: unknown, internal: { dispose(): void }) { this.internal = internal; }
    dispose() { this.internal.dispose(); }
  },
}));

class StagingCanvas {
  readonly context = { globalCompositeOperation: "source-over", imageSmoothingEnabled: true, drawImage: vi.fn<(...args: unknown[]) => void>() };
  width: number;
  height: number;
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  getContext() { return this.context; }
}

function harness(version: 1 | 2, bytesPerFrame = 32, outstandingBytes = 32) {
  vi.stubGlobal("OffscreenCanvas", StagingCanvas);
  const gl = {
    TEXTURE_CUBE_MAP: 34067, TEXTURE_2D: 3553, TEXTURE_CUBE_MAP_POSITIVE_X: 34069,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441, UNPACK_COLORSPACE_CONVERSION_WEBGL: 37443, NONE: 0,
    RGBA: 6408, UNSIGNED_BYTE: 5121, SYNC_GPU_COMMANDS_COMPLETE: 37143, TIMEOUT_EXPIRED: 37147, ALREADY_SIGNALED: 37146,
    getParameter: vi.fn(() => 0), pixelStorei: vi.fn(), texSubImage2D: vi.fn<(...args: unknown[]) => void>(), generateMipmap: vi.fn(),
    fenceSync: vi.fn(() => ({})), clientWaitSync: vi.fn(() => 37147), deleteSync: vi.fn(), flush: vi.fn(),
  };
  const internal = () => ({ isReady: false, generateMipMaps: false, dispose: vi.fn() });
  const engine = {
    _gl: gl, webGLVersion: version,
    createRawCubeTexture: vi.fn(internal), createRawTexture: vi.fn(internal),
    _bindTextureDirectly: vi.fn(), _unpackFlipY: vi.fn(), updateTextureSamplingMode: vi.fn(),
  };
  const requestRender = vi.fn();
  const uploader = createPanoramaUploader({ getEngine: () => engine } as unknown as Scene, { bytesPerFrame, outstandingBytes }, requestRender);
  const bitmap = (width: number, height: number, id = "image") => ({ width, height, id }) as unknown as ImageBitmap;
  return { uploader, engine, gl, requestRender, bitmap };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("WebGL panorama uploads", () => {
  it("uploads bounded strips without reading pixels back and waits for WebGL 2 fences", async () => {
    const h = harness(2);
    const loading = h.uploader.uploadEquirect(h.bitmap(4, 4), "test");
    expect(h.uploader.pump()).toBe(32);
    expect(h.gl.texSubImage2D.mock.calls[0].slice(0, 4)).toEqual([h.gl.TEXTURE_2D, 0, 0, 0]);
    const canvas = h.gl.texSubImage2D.mock.calls[0][6] as unknown as StagingCanvas;
    expect([canvas.width, canvas.height]).toEqual([4, 2]);
    expect(canvas.context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 4, 2, 0, 0, 4, 2]);
    expect(h.uploader.stats().outstandingBytes).toBe(32);
    expect(h.uploader.pump()).toBe(0);
    h.gl.clientWaitSync.mockReturnValue(h.gl.ALREADY_SIGNALED);
    expect(h.uploader.pump()).toBe(32);
    const texture = await loading;
    expect(texture.complete).toBe(true);
    expect(texture.levels).toBe(3);
    expect(texture.gpuBytes).toBe(84);
    expect(h.gl.generateMipmap).toHaveBeenCalledExactlyOnceWith(h.gl.TEXTURE_2D);
    expect(h.gl.texSubImage2D.mock.calls[1][3]).toBe(2);
    expect(h.uploader.stats().uploadedBytes).toBe(64);
    h.uploader.pump();
    expect(h.uploader.stats().outstandingBytes).toBe(0);
    texture.dispose();
    expect(h.engine.createRawTexture.mock.results[0].value.dispose).toHaveBeenCalledOnce();
  });

  it("keeps cube faces in the same GPU layer order as WebGPU and uploads fitting faces directly", async () => {
    const h = harness(1, 4096, 4096);
    const faces = Object.fromEntries(CUBE_FACE_NAMES.map(face => [face, h.bitmap(4, 4, face)])) as Record<CubeFaceName, ImageBitmap>;
    const loading = h.uploader.uploadCube(faces, "cube");
    expect(h.uploader.pump()).toBe(6 * 4 * 4 * 4);
    const texture = await loading;
    expect(h.gl.texSubImage2D.mock.calls.map(call => call[0])).toEqual(GPU_LAYER_SOURCE_FACES.map((_, index) => h.gl.TEXTURE_CUBE_MAP_POSITIVE_X + index));
    expect(h.gl.texSubImage2D.mock.calls.map(call => (call[6] as unknown as { id: string }).id)).toEqual(GPU_LAYER_SOURCE_FACES);
    expect(h.gl.generateMipmap).toHaveBeenCalledExactlyOnceWith(h.gl.TEXTURE_CUBE_MAP);
    expect(texture.gpuBytes).toBe(6 * 84);
    expect(h.gl.fenceSync).not.toHaveBeenCalled();
    texture.dispose();
  });

  it("supports WebGL 1 NPOT images without illegal mipmaps or extra resizing", async () => {
    const h = harness(1, 4096, 4096);
    const loading = h.uploader.uploadEquirect(h.bitmap(6, 3), "npot");
    h.uploader.pump();
    const texture = await loading;
    expect(texture).toMatchObject({ width: 6, height: 3, levels: 1, gpuBytes: 72, complete: true });
    expect(h.gl.generateMipmap).not.toHaveBeenCalled();
    expect(h.engine.updateTextureSamplingMode).not.toHaveBeenCalled();
    texture.dispose();
  });

  it("caps WebGL 1 submissions by the outstanding allowance and releases cancelled uploads", async () => {
    const h = harness(1, 64, 16);
    const loading = h.uploader.uploadEquirect(h.bitmap(4, 4), "cancel");
    expect(h.uploader.pump()).toBe(16);
    expect(h.uploader.stats()).toMatchObject({ queuedJobs: 1, outstandingBytes: 0, uploadedBytes: 16 });
    h.uploader.cancelAll("Scene removed");
    await expect(loading).rejects.toThrow("Scene removed");
    expect(h.engine.createRawTexture.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(h.uploader.busy()).toBe(false);
  });
});
