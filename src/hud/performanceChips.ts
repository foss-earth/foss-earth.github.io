import type { PerformanceSnapshot } from "../perf/metrics";

export type PerformanceMetricId = "fps" | "frame" | "p95" | "activeMeshes" | "drawCalls" | "tiles" | "culling" | "memory";

/** How each toolbar reading is drawn; whether it is shown is `interface.performanceHud.<id>`. */
interface PerformanceMetricDefinition {
  id: PerformanceMetricId;
  settingsLabel: string;
  tooltip: string;
  format(snapshot: PerformanceSnapshot): string | null;
}

export const PERFORMANCE_METRIC_DEFINITIONS: readonly PerformanceMetricDefinition[] = [
  {
    id: "fps",
    settingsLabel: "FPS",
    tooltip: "Frames per second rendered by the map.",
    format: (snapshot) => String(Math.round(snapshot.fps)),
  },
  {
    id: "frame",
    settingsLabel: "Frame time",
    tooltip: "Average time spent rendering each frame.",
    format: (snapshot) => `${snapshot.frameMs.toFixed(1)}ms`,
  },
  {
    id: "p95",
    settingsLabel: "P95 frame time",
    tooltip: "95th percentile frame time over the recent sample window.",
    format: (snapshot) => `p95 ${snapshot.p95FrameMs.toFixed(1)}ms`,
  },
  {
    id: "activeMeshes",
    settingsLabel: "Active meshes (#⬟)",
    tooltip: "Babylon meshes currently active in the scene.",
    format: (snapshot) => `${snapshot.activeMeshes}⬟`,
  },
  {
    id: "drawCalls",
    settingsLabel: "Draw calls",
    tooltip: "GPU draw calls submitted for the current frame when the renderer exposes them.",
    format: (snapshot) => snapshot.drawCalls === null ? null : `d${snapshot.drawCalls}`,
  },
  {
    id: "tiles",
    settingsLabel: "Map tiles (#/#t)",
    tooltip: "Visible map tiles over active map tiles managed by the tile runtime.",
    format: (snapshot) => snapshot.tiles ? `${snapshot.tiles.visibleTiles}/${snapshot.tiles.activeTiles}t` : null,
  },
  {
    id: "culling",
    settingsLabel: "Culling",
    tooltip: "Visible tracked objects over total tracked objects after hemisphere culling.",
    format: (snapshot) => snapshot.culling.total > 0 ? `c${snapshot.culling.visible}/${snapshot.culling.total}` : null,
  },
  {
    id: "memory",
    settingsLabel: "Memory",
    tooltip: "Approximate JavaScript heap memory currently used by the page.",
    format: (snapshot) => snapshot.memoryMb === null ? null : `${Math.round(snapshot.memoryMb)}MB`,
  },
];


export function renderPerformanceChips(
  element: HTMLElement,
  snapshot: PerformanceSnapshot,
  visibleMetrics: ReadonlySet<PerformanceMetricId>,
): void {
  const existing = new Map(Array.from(element.children, (child) => [
    (child as HTMLElement).dataset.perfMetric, child as HTMLElement,
  ]));
  const chips = PERFORMANCE_METRIC_DEFINITIONS.flatMap((metric) => {
    if (!visibleMetrics.has(metric.id)) return [];
    const value = metric.format(snapshot);
    if (value === null) return [];

    const chip = existing.get(metric.id) ?? document.createElement("span");
    chip.className = `hud-chip perf-chip${metric.id === "fps" ? " perf-chip--fps" : ""}`;
    chip.dataset.perfMetric = metric.id;
    chip.title = metric.tooltip;
    chip.setAttribute("aria-label", `${metric.settingsLabel}: ${value}`);
    if (metric.id === "fps") {
      let number = chip.querySelector<HTMLElement>(".perf-chip__value");
      if (!number) {
        number = document.createElement("span");
        number.className = "perf-chip__value";
        const unit = document.createElement("span");
        unit.className = "perf-chip__unit";
        unit.textContent = "fps";
        chip.append(number, unit);
      }
      if (number.textContent !== value) number.textContent = value;
    } else if (chip.textContent !== value) chip.textContent = value;
    return chip;
  });

  // Keep retained chips mounted so CSS animations are not restarted each frame.
  const retained = new Set(chips);
  for (const child of existing.values()) {
    if (!retained.has(child)) child.remove();
  }
  let cursor = element.firstChild;
  for (const chip of chips) {
    if (chip === cursor) cursor = cursor.nextSibling;
    else element.insertBefore(chip, cursor);
  }
}
