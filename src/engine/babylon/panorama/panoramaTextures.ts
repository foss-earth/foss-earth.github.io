/**
 * Panorama source textures on WebGPU: rgba8unorm-srgb, complete mip chains,
 * uploaded from decoded images in row chunks within a per-frame and an
 * outstanding byte allowance (`scene.panorama.uploadMiBPerFrame`,
 * `scene.panorama.uploadOutstandingMiB`).
 *
 * Faces go into the cube unrotated: layer i holds the format's face
 * GPU_LAYER_SOURCE_FACES[i], and the shaders sample with Y and Z exchanged.
 * Mips are generated on the GPU per face with a 2×2 box filter; they do not
 * cross face edges, which WebGPU's seamless cube filtering blends. Babylon
 * does not rebuild these textures after a device loss; their owner does.
 */
import { BaseTexture, Constants, InternalTexture, InternalTextureSource, type Scene, type WebGPUEngine } from "@babylonjs/core";
import { GPU_LAYER_SOURCE_FACES, type CubeFaceName } from "../../../scenes/panoramaMath";
import { mipLevelCount, rgba8Bytes } from "../../../scenes/budget";

/** The WebGPU objects Babylon keeps behind its engine and textures. */
interface WebGpuInternals {
  _device: GPUDevice;
  _textureHelper: {
    createGPUTextureForInternalTexture(texture: InternalTexture, width?: number, height?: number, depth?: number, flags?: number): unknown;
    generateCubeMipmaps(texture: unknown, mipLevelCount: number): void;
    generateMipmaps(texture: unknown, mipLevelCount: number, faceIndex?: number): void;
  };
}

export type PanoramaImageSource = ImageBitmap;

export interface PanoramaGpuTexture {
  readonly kind: "cube" | "equirectangular";
  /** Face size for a cube; width and height for an equirectangular image. */
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  /** Exact allocated bytes, every mip of every layer. */
  readonly gpuBytes: number;
  readonly texture: BaseTexture;
  /** True once every row and every mip is written. */
  readonly complete: boolean;
  dispose(): void;
}

interface UploadJob {
  texture: PanoramaGpuTexture & { markComplete(): void; gpuTexture: GPUTexture; hardware: unknown; disposed: boolean };
  images: readonly ImageBitmap[];
  layer: number;
  row: number;
  onComplete: () => void;
  onFailed: (error: Error) => void;
}

export interface PanoramaUploaderLimits {
  bytesPerFrame: number;
  outstandingBytes: number;
}

export interface PanoramaUploaderStats {
  queuedJobs: number;
  outstandingBytes: number;
  lastFrameBytes: number;
  uploadedBytes: number;
}

export interface PanoramaUploader {
  /** Allocates a cube for six faces named by the format and queues its upload. */
  uploadCube(faces: Readonly<Record<CubeFaceName, ImageBitmap>>, label: string): Promise<PanoramaGpuTexture>;
  uploadEquirect(image: ImageBitmap, label: string): Promise<PanoramaGpuTexture>;
  /** Submits at most one frame's allowance; returns bytes submitted. Call once per rendered frame. */
  pump(): number;
  busy(): boolean;
  setLimits(limits: PanoramaUploaderLimits): void;
  stats(): PanoramaUploaderStats;
  /** Fails every queued upload, as on disposal or device loss. */
  cancelAll(reason: string): void;
}

export function isWebGpuEngine(engine: unknown): engine is WebGPUEngine {
  return Boolean(engine && (engine as { isWebGPU?: boolean }).isWebGPU && (engine as Partial<WebGpuInternals>)._device);
}

function allocate(scene: Scene, kind: "cube" | "equirectangular", width: number, height: number, label: string) {
  const engine = scene.getEngine() as unknown as WebGPUEngine & WebGpuInternals;
  const internal = new InternalTexture(engine, InternalTextureSource.Unknown);
  internal.isCube = kind === "cube";
  internal.format = Constants.TEXTUREFORMAT_RGBA;
  internal.type = Constants.TEXTURETYPE_UNSIGNED_BYTE;
  internal._useSRGBBuffer = true;
  internal.generateMipMaps = true;
  internal.samplingMode = Constants.TEXTURE_TRILINEAR_SAMPLINGMODE;
  internal.label = label;
  internal.invertY = false;
  engine._textureHelper.createGPUTextureForInternalTexture(internal, width, height, 1, 0);
  const hardware = internal._hardwareTexture as unknown as { underlyingResource: GPUTexture };
  const texture = new BaseTexture(scene, internal);
  texture.name = label;
  texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  texture.gammaSpace = false;
  const levels = mipLevelCount(width, height);
  const layers = kind === "cube" ? 6 : 1;
  let complete = false;
  let disposed = false;
  const result = {
    kind,
    width,
    height,
    levels,
    gpuBytes: rgba8Bytes(width, height, levels, layers),
    texture,
    gpuTexture: hardware.underlyingResource,
    hardware,
    get complete() { return complete; },
    get disposed() { return disposed; },
    set disposed(value: boolean) { disposed = value; },
    markComplete() {
      internal.isReady = true;
      complete = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
      internal.dispose();
    },
  };
  return result;
}

export function createPanoramaUploader(scene: Scene, initial: PanoramaUploaderLimits, requestRender: () => void): PanoramaUploader {
  const engine = scene.getEngine() as unknown as WebGPUEngine & WebGpuInternals;
  let limits = initial;
  const queue: UploadJob[] = [];
  let outstanding = 0;
  let lastFrameBytes = 0;
  let uploadedBytes = 0;

  function enqueue(kind: "cube" | "equirectangular", images: readonly ImageBitmap[], label: string): Promise<PanoramaGpuTexture> {
    const width = images[0].width;
    const height = images[0].height;
    const texture = allocate(scene, kind, width, height, label);
    return new Promise((resolve, reject) => {
      queue.push({
        texture, images, layer: 0, row: 0,
        onComplete: () => resolve(texture),
        onFailed: error => { texture.dispose(); reject(error); },
      });
      requestRender();
    });
  }

  function finish(job: UploadJob): void {
    const { texture } = job;
    if (texture.levels > 1) {
      if (texture.kind === "cube") engine._textureHelper.generateCubeMipmaps(texture.hardware, texture.levels);
      else engine._textureHelper.generateMipmaps(texture.hardware, texture.levels, 0);
    }
    texture.markComplete();
    job.onComplete();
  }

  return {
    uploadCube(faces, label) {
      return enqueue("cube", GPU_LAYER_SOURCE_FACES.map(face => faces[face]), label);
    },
    uploadEquirect(image, label) {
      return enqueue("equirectangular", [image], label);
    },
    pump() {
      let submitted = 0;
      const device = engine._device;
      while (queue.length > 0) {
        const job = queue[0];
        if (job.texture.disposed) { queue.shift(); job.onFailed(new Error("The texture was released before its upload finished.")); continue; }
        const image = job.images[job.layer];
        const rowBytes = image.width * 4;
        const perFrameRows = Math.floor((limits.bytesPerFrame - submitted) / rowBytes);
        const outstandingRows = Math.floor((limits.outstandingBytes - outstanding) / rowBytes);
        // One row always goes, so a small allowance slows an upload but never stops it.
        const nothingSent = submitted === 0 && outstanding === 0;
        const rows = Math.min(image.height - job.row, nothingSent ? Math.max(1, Math.min(perFrameRows, outstandingRows)) : Math.min(perFrameRows, outstandingRows));
        if (rows <= 0) break;
        try {
          device.queue.copyExternalImageToTexture(
            { source: image, origin: { x: 0, y: job.row }, flipY: false },
            { texture: job.texture.gpuTexture, mipLevel: 0, origin: { x: 0, y: job.row, z: job.layer }, colorSpace: "srgb", premultipliedAlpha: false },
            { width: image.width, height: rows, depthOrArrayLayers: 1 },
          );
        } catch (error) {
          queue.shift();
          job.onFailed(error instanceof Error ? error : new Error(String(error)));
          continue;
        }
        const bytes = rows * rowBytes;
        submitted += bytes;
        outstanding += bytes;
        uploadedBytes += bytes;
        void device.queue.onSubmittedWorkDone().then(() => {
          outstanding = Math.max(0, outstanding - bytes);
          if (queue.length > 0) requestRender();
        });
        job.row += rows;
        if (job.row >= image.height) {
          job.row = 0;
          job.layer += 1;
          if (job.layer >= job.images.length) {
            queue.shift();
            finish(job);
          }
        }
      }
      lastFrameBytes = submitted;
      if (queue.length > 0) requestRender();
      return submitted;
    },
    busy: () => queue.length > 0,
    setLimits(next) {
      limits = next;
      if (queue.length > 0) requestRender();
    },
    stats: () => ({ queuedJobs: queue.length, outstandingBytes: outstanding, lastFrameBytes, uploadedBytes }),
    cancelAll(reason) {
      for (const job of queue.splice(0)) job.onFailed(new Error(reason));
    },
  };
}
