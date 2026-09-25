import { describe, expect, it } from "vitest";
import { fitLogResize } from "./fitLogResize";

const origin = { left: 400, top: 40, width: 200, height: 140 };

describe("log resize", () => {
  it("grows both sides from the center", () => {
    const box = fitLogResize({
      origin, dx: 40, dy: 20,
      minLeft: 12, maxRight: 1000, minWidth: 160, minHeight: 128, maxHeight: 800,
    });
    expect(box).toEqual({ left: 360, top: 40, width: 280, height: 160 });
  });

  it("grows and shrinks a left-anchored log at the same rate as the pointer", () => {
    const input = {
      origin: { ...origin, left: 12 },
      centered: false,
      dy: 0,
      minLeft: -Infinity,
      maxRight: Infinity,
      minWidth: 160,
      minHeight: 128,
      maxHeight: 800,
    };

    expect(fitLogResize({ ...input, dx: 40 })).toEqual({ left: 12, top: 40, width: 240, height: 140 });
    expect(fitLogResize({ ...input, dx: -40 })).toEqual({ left: 12, top: 40, width: 160, height: 140 });
    expect(fitLogResize({ ...input, dx: -41 })).toBeNull();
  });
});
