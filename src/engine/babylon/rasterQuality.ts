export type RasterQualitySetting = "auto" | "low" | "balanced" | "high";
export type RasterQualityProfileId = Exclude<RasterQualitySetting, "auto">;

export interface RasterQualityProfile {
  id: RasterQualityProfileId;
  zoomBias: number;
  baseZoom: number;
  ringRadius: number;
  corridorSteps: number;
  minSegments: number;
  maxSegments: number;
}

export interface RasterQualityState {
  setting: RasterQualitySetting;
  activeProfile: RasterQualityProfileId;
}

export const RASTER_QUALITY_PROFILES: Readonly<Record<RasterQualityProfileId, RasterQualityProfile>> = {
  low: { id: "low", zoomBias: -2, baseZoom: 1, ringRadius: 1, corridorSteps: 0, minSegments: 16, maxSegments: 32 },
  balanced: { id: "balanced", zoomBias: -1, baseZoom: 1, ringRadius: 2, corridorSteps: 1, minSegments: 16, maxSegments: 64 },
  high: { id: "high", zoomBias: 0, baseZoom: 2, ringRadius: 3, corridorSteps: 2, minSegments: 32, maxSegments: 128 },
};

function initialAutoProfile(): RasterQualityProfileId {
  const cores = typeof navigator === "undefined" ? 0 : navigator.hardwareConcurrency ?? 0;
  const memory = typeof navigator === "undefined" ? 0 : (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;
  if ((cores > 0 && cores <= 4) || (memory > 0 && memory <= 4)) return "low";
  // Start conservatively even on a fast machine; normal frame pacing must earn
  // an upgrade and a stable frame cap cannot be mistaken for spare GPU capacity.
  return "balanced";
}

export function resolveRasterQualityState(setting: RasterQualitySetting | null | undefined): RasterQualityState {
  const selected = setting === "low" || setting === "balanced" || setting === "high" || setting === "auto" ? setting : "auto";
  return { setting: selected, activeProfile: selected === "auto" ? initialAutoProfile() : selected };
}

/** Bounded, slow feedback for Auto. It never runs a startup stress test. */
export function createRasterQualityController(initial: RasterQualityState) {
  let state = initial;
  let windowStartedAt = 0;
  let totalFrameMs = 0;
  let frameCount = 0;
  let overloadedWindows = 0;
  let healthyWindows = 0;
  let nextChangeAt = 0;
  const order: RasterQualityProfileId[] = ["low", "balanced", "high"];
  function setSetting(setting: RasterQualitySetting): RasterQualityState {
    state = resolveRasterQualityState(setting);
    windowStartedAt = 0; totalFrameMs = 0; frameCount = 0;
    overloadedWindows = 0; healthyWindows = 0; nextChangeAt = 0;
    return state;
  }
  function observe(now: number, frameMs: number, suspended: boolean): RasterQualityState | null {
    if (state.setting !== "auto" || suspended || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return null;
    if (windowStartedAt === 0) windowStartedAt = now;
    totalFrameMs += frameMs; frameCount++;
    if (now - windowStartedAt < 1000) return null;
    const mean = totalFrameMs / Math.max(1, frameCount);
    windowStartedAt = now; totalFrameMs = 0; frameCount = 0;
    const index = order.indexOf(state.activeProfile);
    if (mean > 20) {
      overloadedWindows++; healthyWindows = 0;
      if (overloadedWindows >= 2 && now >= nextChangeAt && index > 0) {
        state = { ...state, activeProfile: order[index - 1] };
        overloadedWindows = 0; nextChangeAt = now + 5000;
        return state;
      }
      return null;
    }
    // A capped 60 FPS normally reports about 16.7ms, which is intentionally not
    // treated as a reason to increase detail without an independent GPU metric.
    if (mean < 14) {
      healthyWindows++; overloadedWindows = 0;
      if (healthyWindows >= 10 && now >= nextChangeAt && index < order.length - 1) {
        state = { ...state, activeProfile: order[index + 1] };
        healthyWindows = 0; nextChangeAt = now + 5000;
        return state;
      }
    } else { healthyWindows = 0; overloadedWindows = 0; }
    return null;
  }
  return { getState: () => state, setSetting, observe };
}
