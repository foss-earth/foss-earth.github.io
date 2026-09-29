/**
 * WebGL panorama uploads, in the same row budget as WebGPU. A staging canvas
 * crops a row strip without reading pixels back to JavaScript; complete faces
 * that fit the allowance upload directly from their decoded bitmap.
 *
 * Textures keep their encoded sRGB samples; the WebGL panorama shader handles
 * transfer functions. WebGL 1 NPOT images use clamp + bilinear filtering because
 * that API cannot mipmap them. WebGL 2 uses fences for the outstanding budget;
 * WebGL 1 has no fences, so its synchronous source copy releases staging bytes
 * when texSubImage2D returns, with submissions capped by both limits per frame.
 */
import { BaseTexture, Constants, type Engine, type InternalTexture, type Scene } from "@babylonjs/core";
import { GPU_LAYER_SOURCE_FACES, type CubeFaceName } from "../../../scenes/panoramaMath";
import { mipLevelCount, rgba8Bytes } from "../../../scenes/budget";
import type { PanoramaGpuTexture, PanoramaUploader, PanoramaUploaderLimits } from "./panoramaTextures";

interface GlTexture extends PanoramaGpuTexture {
  internal: InternalTexture;
  markComplete(): void;
}

interface GlUpload {
  texture: GlTexture;
  images: readonly ImageBitmap[];
  layer: number;
  row: number;
  resolve(texture: PanoramaGpuTexture): void;
  reject(error: Error): void;
}

function allocate(scene: Scene, engine: Engine, kind: "cube" | "equirectangular", width: number, height: number, label: string): GlTexture {
  const powerOfTwo = (value: number): boolean => value > 0 && (value & (value - 1)) === 0;
  const mips = engine.webGLVersion >= 2 || (powerOfTwo(width) && powerOfTwo(height));
  const internal = kind === "cube"
    ? engine.createRawCubeTexture(null, width, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, null)
    : engine.createRawTexture(null, width, height, Constants.TEXTUREFORMAT_RGBA, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
  internal.isReady = false;
  internal.label = label;
  internal.generateMipMaps = mips;
  const texture = new BaseTexture(scene, internal);
  texture.name = label;
  texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  if (kind === "cube") texture.coordinatesMode = Constants.TEXTURE_CUBIC_MODE;
  texture.gammaSpace = true;
  const levels = mips ? mipLevelCount(width, height) : 1;
  let complete = false;
  let disposed = false;
  return {
    kind, width, height, levels, texture, internal,
    gpuBytes: rgba8Bytes(width, height, levels, kind === "cube" ? 6 : 1),
    get complete() { return complete; },
    markComplete() { complete = true; internal.isReady = true; },
    dispose() {
      if (disposed) return;
      disposed = true;
      // BaseTexture owns the InternalTexture's one reference.
      texture.dispose();
    },
  };
}

export function createWebGlPanoramaUploader(scene: Scene, initial: PanoramaUploaderLimits, requestRender: () => void): PanoramaUploader {
  const engine = scene.getEngine() as Engine;
  const gl = engine._gl;
  if (!gl || engine.webGLVersion < 1) throw new Error("Panorama uploads need a WebGL or WebGPU renderer.");
  let limits = initial;
  const queue: GlUpload[] = [];
  const flights: { sync: WebGLSync; bytes: number }[] = [];
  let outstanding = 0;
  let uploadedBytes = 0;
  let lastFrameBytes = 0;
  let staging: OffscreenCanvas | HTMLCanvasElement | null = null;
  let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  const enqueue = (kind: "cube" | "equirectangular", images: readonly ImageBitmap[], label: string): Promise<PanoramaGpuTexture> => {
    const texture = allocate(scene, engine, kind, images[0].width, images[0].height, label);
    return new Promise((resolve, reject) => {
      queue.push({ texture, images, layer: 0, row: 0, resolve, reject });
      requestRender();
    });
  };

  const strip = (image: ImageBitmap, row: number, rows: number): TexImageSource => {
    if (row === 0 && rows === image.height) return image;
    if (!staging) staging = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(image.width, rows) : document.createElement("canvas");
    if (staging.width !== image.width || staging.height !== rows) {
      staging.width = image.width;
      staging.height = rows;
      context = null;
    }
    context ??= staging.getContext("2d", { alpha: false }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error("The browser could not create a panorama upload canvas.");
    context.globalCompositeOperation = "copy";
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, row, image.width, rows, 0, 0, image.width, rows);
    return staging;
  };

  function finish(job: GlUpload): void {
    const { texture } = job;
    const target = texture.kind === "cube" ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
    if (texture.levels > 1) {
      engine._bindTextureDirectly(target, texture.internal, true);
      gl.generateMipmap(target);
      engine._bindTextureDirectly(target, null, true);
      engine.updateTextureSamplingMode(Constants.TEXTURE_TRILINEAR_SAMPLINGMODE, texture.internal);
    }
    texture.markComplete();
    job.resolve(texture);
  }

  return {
    uploadCube(faces: Readonly<Record<CubeFaceName, ImageBitmap>>, label) {
      return enqueue("cube", GPU_LAYER_SOURCE_FACES.map(face => faces[face]), label);
    },
    uploadEquirect(image, label) { return enqueue("equirectangular", [image], label); },
    pump() {
      for (let index = flights.length - 1; index >= 0; index--) {
        const flight = flights[index];
        const state = gl.clientWaitSync(flight.sync, 0, 0);
        if (state === gl.TIMEOUT_EXPIRED) continue;
        gl.deleteSync(flight.sync);
        outstanding -= flight.bytes;
        flights.splice(index, 1);
      }
      let submitted = 0;
      // Read the caller's pixel-store state once per frame, not once per
      // strip or cube face. No pixel data is queried from the GPU.
      const premultiply = queue.length > 0 ? gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean : false;
      const conversion = queue.length > 0 ? gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) as number : gl.NONE;
      while (queue.length > 0) {
        const job = queue[0];
        const image = job.images[job.layer];
        const rowBytes = image.width * 4;
        const frameBytes = engine.webGLVersion >= 2 ? limits.bytesPerFrame : Math.min(limits.bytesPerFrame, limits.outstandingBytes);
        const allowed = Math.min(frameBytes - submitted, limits.outstandingBytes - outstanding - submitted);
        const rows = Math.min(image.height - job.row, submitted === 0 && outstanding === 0 ? Math.max(1, Math.floor(allowed / rowBytes)) : Math.floor(allowed / rowBytes));
        if (rows <= 0) break;
        const target = job.texture.kind === "cube" ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
        try {
          const source = strip(image, job.row, rows);
          engine._bindTextureDirectly(target, job.texture.internal, true);
          engine._unpackFlipY(false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
          try {
            gl.texSubImage2D(job.texture.kind === "cube" ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + job.layer : target, 0, 0, job.row, gl.RGBA, gl.UNSIGNED_BYTE, source);
          } finally {
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, conversion);
            engine._bindTextureDirectly(target, null, true);
          }
          const bytes = rows * rowBytes;
          submitted += bytes;
          uploadedBytes += bytes;
          job.row += rows;
          if (job.row === image.height) {
            job.row = 0;
            job.layer += 1;
            if (job.layer === job.images.length) {
              queue.shift();
              finish(job);
            }
          }
        } catch (error) {
          if (queue[0] === job) queue.shift();
          job.texture.dispose();
          job.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (submitted > 0 && engine.webGLVersion >= 2) {
        // One fence covers this frame's strips and mip generation, rather
        // than making six synchronization objects for every small cube.
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) { flights.push({ sync, bytes: submitted }); outstanding += submitted; }
        gl.flush();
      }
      lastFrameBytes = submitted;
      if (queue.length > 0 || flights.length > 0) requestRender();
      return submitted;
    },
    busy: () => queue.length > 0,
    setLimits(next) { limits = next; if (queue.length > 0) requestRender(); },
    stats: () => ({ queuedJobs: queue.length, outstandingBytes: outstanding, lastFrameBytes, uploadedBytes }),
    cancelAll(reason) {
      for (const job of queue.splice(0)) { job.texture.dispose(); job.reject(new Error(reason)); }
      for (const flight of flights.splice(0)) gl.deleteSync(flight.sync);
      outstanding = 0;
      if (staging) { staging.width = 0; staging.height = 0; }
      staging = null;
      context = null;
    },
  };
}
