import { describe, expect, it } from "vitest";
import { fitLogResize, nextLeftDock, nextRightDock } from "./fitLogResize";

const origin = { left: 400, top: 40, width: 200, height: 140 };

describe("log resize", () => {
  it("grows both sides from the center", () => {
    const box = fitLogResize({
      origin, dx: 40, dy: 20,
      minLeft: 12, maxRight: 1000, minWidth: 160, minHeight: 128, maxHeight: 800,
    });
    expect(box).toEqual({ left: 360, top: 40, width: 280, height: 160 });
  });

  it("stops at the right edge of the expand button and gives that space back when the log retreats", () => {
    const pushed = nextRightDock({
      logRight: 788, dockRight: 1000, currentWidth: 320, currentCollapsed: false, saved: null,
    });
    expect(pushed.collapsed).toBe(false);
    expect(pushed.width).toBe(200);
    expect(pushed.saved).toEqual({ width: 320, collapsed: false });

    const minimized = nextRightDock({
      logRight: 980, dockRight: 1000, currentWidth: 200, currentCollapsed: false, saved: pushed.saved,
    });
    expect(minimized.collapsed).toBe(true);

    const restored = nextRightDock({
      logRight: null, dockRight: 1000, currentWidth: 88, currentCollapsed: true, saved: minimized.saved,
    });
    expect(restored).toMatchObject({ width: 320, collapsed: false, saved: null });
  });

  it("shrinks the left dock the same way, then restores it", () => {
    const pushed = nextLeftDock({
      logLeft: 224, dockLeft: 12, currentWidth: 320, currentCollapsed: false, saved: null,
    });
    expect(pushed).toMatchObject({ width: 200, collapsed: false });
    const minimized = nextLeftDock({
      logLeft: 34, dockLeft: 12, currentWidth: 200, currentCollapsed: false, saved: pushed.saved,
    });
    expect(minimized.collapsed).toBe(true);
    const restored = nextLeftDock({
      logLeft: null, dockLeft: 12, currentWidth: 200, currentCollapsed: true, saved: minimized.saved,
    });
    expect(restored).toMatchObject({ width: 320, collapsed: false, saved: null });
  });
});
