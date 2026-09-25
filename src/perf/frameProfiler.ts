import { EngineInstrumentation, type AbstractEngine, type Observable, type Scene, type WebGPUEngine } from "@babylonjs/core";

/**
 * Where a frame's time goes, by named section.
 *
 * Callers bracket their own work:
 *
 *     const started = profiler.clock();
 *     stepPhysics();
 *     profiler.add("flight/physics", started);
 *
 * and call `frame()` once per frame. The profiler keeps each section's total
 * per frame over a rolling window, and summarises it against the frame
 * interval. Disabled, every call returns at once, so instrumented code can
 * stay instrumented.
 *
 * Sections nest by path: "flight/physics" is part of "flight". Only top-level
 * sections are added up against the frame; nested ones break their parent
 * down. Time no section claims is reported as unmeasured: work nobody has
 * instrumented yet, the browser's own work, and idle time waiting for the
 * display. Concurrent sections, "gpu" by default, run alongside the frame
 * rather than in it and are never added to it.
 */

const DEFAULT_WINDOW_FRAMES = 600;

export interface FrameProfiler {
  /** Switchable at any time; turning it on starts a fresh window. */
  enabled: boolean;
  /** A timestamp to hand back to `add`; 0 while disabled. */
  clock(): number;
  /** Adds the time since `startedAt` to the section, for this frame. */
  add(section: string, startedAt: number): void;
  /** Adds a duration measured some other way, such as a GPU timer that reports frames late. */
  addDuration(section: string, milliseconds: number): void;
  /** The section's time so far this frame. */
  current(section: string): number;
  /** Closes the frame begun at the previous call and starts the next. */
  frame(now?: number): void;
  summary(): FrameProfileSummary;
  reset(): void;
}

export interface FrameTimeStats {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface FrameSectionStats extends FrameTimeStats {
  section: string;
  /** The last path segment, for display under its parent. */
  name: string;
  depth: number;
  /** Mean time as a share of the mean frame interval. */
  shareOfFrame: number;
  /** Frames the section did any work in, out of `frames`. */
  activeFrames: number;
}

export interface FrameProfileSummary {
  /** Frames in the window. */
  frames: number;
  /** Time between frames. */
  frame: FrameTimeStats;
  /** Mean of the top-level sections added up, concurrent ones left out. */
  measuredMeanMs: number;
  /** Parents before their children; siblings by mean time, largest first. */
  sections: FrameSectionStats[];
}

interface SectionTrack {
  values: Float64Array;
  current: number;
  /** Frames committed before this section first reported, which it has no values for. */
  bornAtFrame: number;
}

function percentile(sorted: Float64Array, rank: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * rank))];
}

function stats(values: Float64Array): FrameTimeStats {
  if (values.length === 0) return { meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  const sorted = Float64Array.from(values).sort();
  let total = 0;
  for (const value of sorted) total += value;
  return {
    meanMs: total / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

export interface FrameProfilerOptions {
  /** Frames kept for the summary; 600 is ten seconds at 60 fps. */
  windowFrames?: number;
  enabled?: boolean;
  /** Top-level sections that run alongside the frame, such as GPU work. */
  concurrent?: readonly string[];
  now?: () => number;
}

export function createFrameProfiler(options: FrameProfilerOptions = {}): FrameProfiler {
  const capacity = Math.max(1, Math.floor(options.windowFrames ?? DEFAULT_WINDOW_FRAMES));
  const now = options.now ?? (() => performance.now());
  const tracks = new Map<string, SectionTrack>();
  let intervals = new Float64Array(capacity);
  let committed = 0;
  let lastFrameAt: number | null = null;
  let enabled = options.enabled ?? false;
  const concurrent = new Set(options.concurrent ?? ["gpu"]);

  const track = (section: string): SectionTrack => {
    let found = tracks.get(section);
    if (!found) {
      found = { values: new Float64Array(capacity), current: 0, bornAtFrame: committed };
      tracks.set(section, found);
    }
    return found;
  };

  /** The window's values, oldest first, from the frame the track began. */
  const windowOf = (values: Float64Array, bornAtFrame: number): Float64Array => {
    const count = Math.min(committed - bornAtFrame, capacity);
    const out = new Float64Array(Math.max(0, count));
    for (let index = 0; index < out.length; index++) {
      out[index] = values[(committed - out.length + index) % capacity];
    }
    return out;
  };

  const reset = (): void => {
    tracks.clear();
    intervals = new Float64Array(capacity);
    committed = 0;
    lastFrameAt = null;
  };

  return {
    get enabled() {
      return enabled;
    },
    set enabled(next: boolean) {
      if (next === enabled) return;
      enabled = next;
      if (next) reset();
    },
    clock: () => (enabled ? now() : 0),
    add(section, startedAt) {
      if (!enabled) return;
      track(section).current += now() - startedAt;
    },
    addDuration(section, milliseconds) {
      if (!enabled || !Number.isFinite(milliseconds)) return;
      track(section).current += milliseconds;
    },
    current: section => tracks.get(section)?.current ?? 0,
    frame(at = now()) {
      if (!enabled) return;
      if (lastFrameAt !== null) {
        const slot = committed % capacity;
        intervals[slot] = at - lastFrameAt;
        for (const entry of tracks.values()) {
          entry.values[slot] = entry.current;
          entry.current = 0;
        }
        committed++;
      } else {
        for (const entry of tracks.values()) entry.current = 0;
      }
      lastFrameAt = at;
    },
    summary() {
      const frame = stats(windowOf(intervals, 0));
      const children = new Map<string, FrameSectionStats[]>();
      let measuredMeanMs = 0;
      for (const [section, entry] of tracks) {
        const values = windowOf(entry.values, entry.bornAtFrame);
        const slash = section.lastIndexOf("/");
        const parent = slash < 0 ? "" : section.slice(0, slash);
        const sectionStats = stats(values);
        // A section that began partway through the window still costs its share of every frame.
        const meanOverWindow = sectionStats.meanMs * values.length / Math.max(1, Math.min(committed, capacity));
        if (!parent && !concurrent.has(section)) measuredMeanMs += meanOverWindow;
        let activeFrames = 0;
        for (const value of values) if (value > 0) activeFrames++;
        const list = children.get(parent) ?? [];
        list.push({
          ...sectionStats,
          section,
          name: slash < 0 ? section : section.slice(slash + 1),
          depth: section.split("/").length - 1,
          shareOfFrame: frame.meanMs > 0 ? meanOverWindow / frame.meanMs : 0,
          activeFrames,
        });
        children.set(parent, list);
      }
      // A parent that never reports itself, such as "gpu", gets a row that adds its children up.
      for (const parent of [...children.keys()]) {
        if (!parent || tracks.has(parent)) continue;
        const summed = new Float64Array(Math.min(committed, capacity));
        for (const [section, entry] of tracks) {
          if (section.slice(0, section.lastIndexOf("/")) !== parent) continue;
          const values = windowOf(entry.values, entry.bornAtFrame);
          for (let index = 0; index < values.length; index++) summed[summed.length - values.length + index] += values[index];
        }
        const slash = parent.lastIndexOf("/");
        const grandparent = slash < 0 ? "" : parent.slice(0, slash);
        const parentStats = stats(summed);
        let activeFrames = 0;
        for (const value of summed) if (value > 0) activeFrames++;
        if (!grandparent && !concurrent.has(parent)) measuredMeanMs += parentStats.meanMs;
        const list = children.get(grandparent) ?? [];
        list.push({
          ...parentStats,
          section: parent,
          name: slash < 0 ? parent : parent.slice(slash + 1),
          depth: parent.split("/").length - 1,
          shareOfFrame: frame.meanMs > 0 ? parentStats.meanMs / frame.meanMs : 0,
          activeFrames,
        });
        children.set(grandparent, list);
      }
      const sections: FrameSectionStats[] = [];
      const visit = (parent: string): void => {
        for (const child of (children.get(parent) ?? []).sort((left, right) => right.meanMs - left.meanMs)) {
          sections.push(child);
          visit(child.section);
        }
      };
      visit("");
      return { frames: Math.min(committed, capacity), frame, measuredMeanMs, sections };
    },
    reset,
  };
}

/**
 * Times Babylon's scene render on the CPU, with its main phases underneath,
 * and the GPU's frame when the engine can time it: WebGPU needs the
 * "timestamp-query" feature on its device, WebGL the disjoint timer query
 * extension. Returns a function that stops the measuring.
 */
export function profileBabylonScene(
  profiler: FrameProfiler,
  scene: Scene,
  engine: AbstractEngine,
  { section = "render", gpuSection = "gpu/globe" }: { section?: string; gpuSection?: string } = {},
): () => void {
  const phases: [string, Observable<Scene>, Observable<Scene>][] = [
    [section, scene.onBeforeAnimationsObservable, scene.onAfterRenderObservable],
    [`${section}/active meshes`, scene.onBeforeActiveMeshesEvaluationObservable, scene.onAfterActiveMeshesEvaluationObservable],
    [`${section}/render targets`, scene.onBeforeRenderTargetsRenderObservable, scene.onAfterRenderTargetsRenderObservable],
    [`${section}/draw`, scene.onBeforeDrawPhaseObservable, scene.onAfterDrawPhaseObservable],
  ];
  const detach: (() => void)[] = [];
  for (const [name, before, after] of phases) {
    let startedAt = 0;
    const onBefore = (): void => { startedAt = profiler.clock(); };
    const onAfter = (): void => { if (startedAt) profiler.add(name, startedAt); startedAt = 0; };
    const beforeObserver = before.add(onBefore);
    const afterObserver = after.add(onAfter);
    detach.push(() => {
      before.remove(beforeObserver);
      after.remove(afterObserver);
    });
  }

  // GPU readings arrive frames late, and on WebGL Babylon times only one frame
  // in every few. The latest reading stands for every frame until the next
  // arrives, so the mean is per frame rather than per reading.
  const gpu = isWebGpuEngine(engine) ? webGpuPassTimer(engine) : webGlFrameTimer(engine);
  const gpuObserver = scene.onAfterRenderObservable.add(() => {
    const milliseconds = gpu.read(profiler.enabled);
    if (milliseconds > 0) profiler.addDuration(gpuSection, milliseconds);
  });
  detach.push(() => {
    scene.onAfterRenderObservable.remove(gpuObserver);
    gpu.dispose();
  });
  return () => { for (const stop of detach) stop(); };
}

interface GpuTimer {
  /** Switches timing to match `enabled`; while on, the latest per-frame reading in milliseconds, or 0 before the first. */
  read(enabled: boolean): number;
  dispose(): void;
}

function isWebGpuEngine(engine: AbstractEngine): engine is WebGPUEngine {
  return "enableGPUTimingMeasurements" in engine;
}

/**
 * WebGPU: Babylon's frame-level timer writes timestamps on the command
 * encoder, which browsers no longer allow, so it always reads 0. Its per-pass
 * timer uses the render passes' `timestampWrites` and works. Every pass that
 * has no counter of its own lands in the main pass's counter, so the reading is
 * the GPU time of all the frame's render passes; copies and mipmap generation
 * are left out.
 */
function webGpuPassTimer(engine: WebGPUEngine): GpuTimer {
  let owned = false;
  let seenTotal = 0;
  let seenFrames = 0;
  let held = 0;
  const stop = (): void => {
    if (owned) engine.enableGPUTimingMeasurements = false;
    owned = false;
    held = 0;
  };
  return {
    read(enabled) {
      if (!enabled) {
        stop();
        return 0;
      }
      if (!engine.enableGPUTimingMeasurements) {
        engine.enableGPUTimingMeasurements = true;
        owned = true;
        seenTotal = 0;
        seenFrames = 0;
      }
      const counter = engine.gpuTimeInFrameForMainPass?.counter;
      if (!counter) return 0;
      // The counter's newest frame may still be collecting its passes; the ones before it are complete.
      const frames = Math.max(0, counter.count - 1);
      if (frames > seenFrames) {
        held = (counter.total - seenTotal) / (frames - seenFrames) / 1e6;
        seenTotal = counter.total;
        seenFrames = frames;
      }
      return held;
    },
    dispose: stop,
  };
}

/** WebGL: the disjoint timer query times whole frames, one in every few. */
function webGlFrameTimer(engine: AbstractEngine): GpuTimer {
  let instrumentation: EngineInstrumentation | null = null;
  return {
    read(enabled) {
      if (!enabled) {
        if (instrumentation) instrumentation.captureGPUFrameTime = false;
        return 0;
      }
      if (!instrumentation) instrumentation = new EngineInstrumentation(engine);
      if (!instrumentation.captureGPUFrameTime) instrumentation.captureGPUFrameTime = true;
      return instrumentation.gpuFrameTimeCounter.current / 1e6;
    },
    dispose: () => instrumentation?.dispose(),
  };
}

/** Whether this engine can time the GPU's frame, so a report can say why a GPU row is missing. */
export function canTimeGpuFrames(engine: AbstractEngine): boolean {
  const caps = engine.getCaps() as { timerQuery?: unknown; timestampQuery?: unknown };
  return Boolean(caps.timerQuery || caps.timestampQuery);
}
