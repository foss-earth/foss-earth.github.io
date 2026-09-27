import type { AbstractEngine, Scene } from "@babylonjs/core";
import type { SettingsRegistry } from "../settings/registry";
import { FRAME_PROFILING_IDS } from "../settings/catalogue/profiling";
import { canTimeGpuFrames, createFrameProfiler, profileBabylonScene, type FrameProfiler, type FrameTrace } from "./frameProfiler";

/**
 * One runtime's frame profiling: one profiler, one frame boundary, and one set
 * of Babylon observers and GPU timers that exist only while measuring is on.
 * The runtime closes each frame; hosts add their own sections to `profiler`.
 * Starting begins a fresh window, stopping detaches everything, and `dispose`
 * releases it for good.
 */
export interface FrameProfileSession {
  readonly profiler: FrameProfiler;
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  /** Resizes the summary window or the trace; either change starts afresh. */
  configure(options: { windowFrames?: number; traceFrames?: number }): void;
  /** The runtime's frame boundary: once per rendered frame, before any section of it. */
  frame(now?: number): void;
  /** Whether this renderer can time GPU work at all. */
  gpuTimed(): boolean;
  /**
   * What the GPU rows can say: `unsupported` when the renderer cannot time,
   * `waiting` until a reading arrives, `measuring` once one has.
   */
  gpuStatus(): GpuTimingStatus;
  trace(): FrameTrace;
  /** Called when measuring starts or stops, or the window or trace changes size. */
  onChange(listener: () => void): () => void;
  dispose(): void;
}

export type GpuTimingStatus = "unsupported" | "waiting" | "measuring";

export interface FrameProfileSessionOptions {
  scene: Scene;
  engine: AbstractEngine;
  /** A profiler to drive; a new one, off, when omitted. */
  profiler?: FrameProfiler;
  /** The GPU section, as `profileBabylonScene` names it. */
  gpuSection?: string;
}

export function createFrameProfileSession(options: FrameProfileSessionOptions): FrameProfileSession {
  const profiler = options.profiler ?? createFrameProfiler();
  const gpuSection = options.gpuSection ?? "gpu/globe";
  const listeners = new Set<() => void>();
  let stopScene: (() => void) | null = null;
  let disposed = false;
  const notify = (): void => { for (const listener of [...listeners]) listener(); };

  const setEnabled = (enabled: boolean): void => {
    if (disposed) return;
    const changed = enabled !== profiler.enabled;
    profiler.enabled = enabled;
    if (enabled && !stopScene) stopScene = profileBabylonScene(profiler, options.scene, options.engine, { gpuSection });
    if (!enabled && stopScene) {
      stopScene();
      stopScene = null;
    }
    if (changed) notify();
  };

  return {
    profiler,
    get enabled() {
      return profiler.enabled;
    },
    setEnabled,
    configure(next) {
      const before = [profiler.windowFrames, profiler.traceFrames];
      profiler.configure(next);
      if (before[0] !== profiler.windowFrames || before[1] !== profiler.traceFrames) notify();
    },
    frame: at => profiler.frame(at),
    gpuTimed: () => canTimeGpuFrames(options.engine),
    gpuStatus() {
      if (!canTimeGpuFrames(options.engine)) return "unsupported";
      return profiler.summary().sections.some(section => section.section === gpuSection && section.activeFrames > 0) ? "measuring" : "waiting";
    },
    trace: () => profiler.trace(),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      setEnabled(false);
      disposed = true;
      listeners.clear();
    },
  };
}

/**
 * Drives the session from the `renderer.profiling.*` parameters, which the
 * app registers with `frameProfilingParameters`. Returns a function that stops.
 */
export function bindFrameProfileSettings(settings: SettingsRegistry, session: FrameProfileSession): () => void {
  const read = (id: string): number => {
    const value = settings.get(id);
    return typeof value === "number" ? value : 0;
  };
  const apply = (): void => {
    session.configure({ windowFrames: read(FRAME_PROFILING_IDS.windowFrames), traceFrames: read(FRAME_PROFILING_IDS.traceFrames) });
    session.setEnabled(settings.get(FRAME_PROFILING_IDS.enabled) === true);
  };
  apply();
  const stops = [FRAME_PROFILING_IDS.enabled, FRAME_PROFILING_IDS.windowFrames, FRAME_PROFILING_IDS.traceFrames]
    .map(id => settings.watch(id, apply));
  return () => { for (const stop of stops) stop(); };
}
