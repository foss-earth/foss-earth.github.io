export const LOG_DOCK_GAP = 12;
export const LOG_DOCK_MIN_WIDTH = 160;

export interface LogResizeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Grow from the center: the right edge follows the pointer and the left edge mirrors it. */
export function fitLogResize(input: {
  origin: LogResizeBox;
  dx: number;
  dy: number;
  minLeft: number;
  maxRight: number;
  minWidth: number;
  minHeight: number;
  maxHeight: number;
}): LogResizeBox | null {
  const right = Math.min(input.maxRight, input.origin.left + input.origin.width + input.dx);
  const left = Math.max(input.minLeft, input.origin.left - input.dx);
  const width = right - left;
  if (width < input.minWidth) return null;
  const height = Math.max(
    input.minHeight,
    Math.min(input.maxHeight, input.origin.height + input.dy),
  );
  return { left, top: input.origin.top, width, height };
}

export interface DockFit {
  width: number;
  collapsed: boolean;
  saved: { width: number; collapsed: boolean } | null;
}

/** The log claims space from a dock. The dock shrinks, then collapses. A null edge gives it back. */
export function nextAnchoredDock(input: {
  side: "left" | "right";
  logEdge: number | null;
  dockOuter: number;
  currentWidth: number;
  currentCollapsed: boolean;
  saved: { width: number; collapsed: boolean } | null;
  minWidth?: number;
  gap?: number;
}): DockFit {
  const minWidth = input.minWidth ?? LOG_DOCK_MIN_WIDTH;
  const gap = input.gap ?? LOG_DOCK_GAP;
  const fromRight = input.side === "right";
  if (input.logEdge == null) {
    if (!input.saved) {
      return { width: input.currentWidth, collapsed: input.currentCollapsed, saved: null };
    }
    return { width: input.saved.width, collapsed: input.saved.collapsed, saved: null };
  }
  if (input.saved?.collapsed || (!input.saved && input.currentCollapsed)) {
    return { width: input.currentWidth, collapsed: true, saved: null };
  }
  const saved = input.saved ?? { width: input.currentWidth, collapsed: false };
  const originalInner = fromRight ? input.dockOuter - saved.width : input.dockOuter + saved.width;
  const clear = fromRight ? input.logEdge + gap <= originalInner : input.logEdge - gap >= originalInner;
  if (clear) return { width: saved.width, collapsed: false, saved: null };
  const room = fromRight
    ? input.dockOuter - gap - input.logEdge
    : input.logEdge - gap - input.dockOuter;
  if (room < minWidth) return { width: saved.width, collapsed: true, saved };
  return { width: Math.round(room), collapsed: false, saved };
}

export function nextRightDock(input: Omit<Parameters<typeof nextAnchoredDock>[0], "side" | "logEdge" | "dockOuter"> & {
  logRight: number | null;
  dockRight: number;
}): DockFit {
  return nextAnchoredDock({ ...input, side: "right", logEdge: input.logRight, dockOuter: input.dockRight });
}

export function nextLeftDock(input: Omit<Parameters<typeof nextAnchoredDock>[0], "side" | "logEdge" | "dockOuter"> & {
  logLeft: number | null;
  dockLeft: number;
}): DockFit {
  return nextAnchoredDock({ ...input, side: "left", logEdge: input.logLeft, dockOuter: input.dockLeft });
}
