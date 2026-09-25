const GAP = 12;
const MIN_DOCK_WIDTH = 160;
const MIN_LOG_WIDTH = 160;

export type DockLayoutMode = "single" | "dual";
export type DockResizePriority = "log" | "windows";

export interface DockLayoutInput {
  availableWidth: number;
  primaryWidth: number;
  secondaryWidth: number;
  /** A resized log's preferred width; null uses its natural content width. */
  logWidth: number | null;
  /** The most recent manual resize keeps its requested space first. */
  priority?: DockResizePriority;
  previousMode?: DockLayoutMode;
}

/** One allocation for the windows and log, including the gaps between them. */
export function resolveDockLayout(input: DockLayoutInput) {
  const width = Math.max(0, input.availableWidth);
  const primary = Math.max(MIN_DOCK_WIDTH, Math.min(420, input.primaryWidth));
  const secondary = Math.max(MIN_DOCK_WIDTH, Math.min(420, input.secondaryWidth));
  const logPriority = input.priority === "log" && input.logWidth !== null;
  const requestedLog = Math.max(MIN_LOG_WIDTH, input.logWidth ?? 560);
  // A centered log must clear the larger dock on BOTH halves of the viewport.
  const centerCapacity = width - 2 * Math.max(primary, secondary) - GAP * 4;
  const sideCapacity = (width - requestedLog) / 2 - GAP * 2;
  const singleBudget = Math.max(0, width - GAP * 3);
  const singleMinimum = Math.min(MIN_DOCK_WIDTH, singleBudget / 2);
  const singleRight = Math.min(secondary, Math.max(singleMinimum, singleBudget - MIN_LOG_WIDTH));
  const singleLog = Math.min(requestedLog, singleBudget - singleRight);
  const dual = logPriority
    ? sideCapacity >= MIN_DOCK_WIDTH
    : centerCapacity >= MIN_LOG_WIDTH && (
      input.previousMode !== "single" || input.logWidth === null || singleLog <= centerCapacity
    );

  if (dual) {
    const primaryWidth = logPriority ? Math.min(primary, sideCapacity) : primary;
    const secondaryWidth = logPriority ? Math.min(secondary, sideCapacity) : secondary;
    const logWidth = logPriority ? requestedLog : Math.min(requestedLog, centerCapacity);
    return {
      mode: "dual" as const,
      primaryWidth,
      secondaryWidth,
      logLeft: (width - logWidth) / 2,
      logWidth,
      logCenter: width / 2,
      // Keep a dock's captured resize handle present at the log's minimum.
      maxWindowWidth: Math.min(420, (width - MIN_LOG_WIDTH - GAP * 4) / 2),
    };
  }

  const secondaryWidth = logPriority
    ? Math.min(secondary, Math.max(singleMinimum, singleBudget - requestedLog))
    : singleRight;
  const logWidth = Math.min(input.logWidth === null ? 380 : requestedLog, singleBudget - secondaryWidth);
  return {
    mode: "single" as const,
    primaryWidth: primary,
    secondaryWidth,
    logLeft: GAP,
    logWidth,
    logCenter: GAP + logWidth / 2,
    maxWindowWidth: Math.min(420, Math.max(MIN_DOCK_WIDTH, singleBudget - MIN_LOG_WIDTH)),
  };
}
