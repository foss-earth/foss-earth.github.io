// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitHudBar, type HudBarFitItem } from "./hudBarFit";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function fixture(width = 300, creditWidth = 100) {
  const frames: FrameRequestCallback[] = [];
  const resizeCallbacks: ResizeObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = disconnect;
  });
  const rect = (w: number) => ({ width: w, height: 28, top: 0, left: 0, right: w, bottom: 28, x: 0, y: 0, toJSON() {} });
  const bar = document.createElement("div");
  bar.style.columnGap = "3px";
  bar.getBoundingClientRect = () => rect(width);
  const end = document.createElement("span");
  end.getBoundingClientRect = () => rect(Math.min(creditWidth, end.style.maxWidth ? Number.parseFloat(end.style.maxWidth) : creditWidth));
  const items: HudBarFitItem[] = [];
  const add = (id: string, itemWidth: number, priority: number, keepVisible = false): HTMLElement => {
    const element = document.createElement("button");
    element.id = id;
    element.getBoundingClientRect = () => rect(itemWidth);
    bar.insertBefore(element, end);
    items.push({ element, priority, keepVisible });
    return element;
  };
  bar.append(end);
  document.body.append(bar);
  const north = add("north", 30, 0, true);
  const help = add("help", 30, 1);
  const fps = add("fps", 50, 2);
  const renderer = add("renderer", 65, 3);
  const input = add("input", 30, 4);
  const fitting = fitHudBar(bar, end, () => items);
  const shown = () => items.filter(item => !item.element.hasAttribute("data-hud-overflow-hidden") && !item.element.closest("[hidden]")).map(item => item.element.id);
  const flush = () => { for (const callback of frames.splice(0)) callback(0); };
  return { bar, end, items, north, help, fps, renderer, input, fitting, shown, add, flush, disconnect,
    resize(nextWidth: number, nextCreditWidth = creditWidth) {
      width = nextWidth; creditWidth = nextCreditWidth;
      resizeCallbacks[0]!([], {} as ResizeObserver);
      flush();
    },
  };
}

describe("one-row toolbar fitting", () => {
  it("keeps north, help, FPS and renderer before lower priorities within the attribution's remaining space", () => {
    const f = fixture();
    expect(f.shown()).toEqual(["north", "help", "fps", "renderer"]);
    f.resize(260);
    expect(f.shown()).toEqual(["north", "help", "fps"]);
    f.resize(180);
    expect(f.shown()).toEqual(["north", "help"]);
    f.resize(400);
    expect(f.shown()).toEqual(["north", "help", "fps", "renderer", "input"]);
    f.fitting.destroy();
  });

  it("refits when credits change and reports which automatic controls fit", () => {
    const f = fixture();
    const onFit = vi.fn();
    f.items.find(item => item.element === f.fps)!.onFit = onFit;
    f.resize(300, 180);
    expect(f.shown()).toEqual(["north", "help", "fps"]);
    expect(onFit).toHaveBeenLastCalledWith(true);
    f.resize(300, 200);
    expect(f.shown()).toEqual(["north", "help"]);
    expect(onFit).toHaveBeenLastCalledWith(false);
    f.fitting.destroy();
  });

  it("shortens long credits to keep Help and FPS in the phone's single row", () => {
    const f = fixture(343, 500);
    for (const item of f.items) if (item.priority <= 2) item.reserveSpace = true;
    f.fitting.update(); f.flush();
    expect(f.shown()).toEqual(["north", "help", "fps"]);
    expect(f.end.style.maxWidth).toBe("224px");
    f.resize(288);
    expect(f.shown()).toEqual(["north", "help", "fps"]);
    expect(f.end.style.maxWidth).toBe("169px");
    f.help.hidden = true;
    f.fitting.update(); f.flush();
    expect(f.shown()).toEqual(["north", "fps"]);
    expect(f.end.style.maxWidth).toBe("202px");
    f.fitting.destroy();
  });

  it("honors manual enables even if they need another row, and does not reveal scene-hidden controls", () => {
    const f = fixture(180);
    f.items.find(item => item.element === f.input)!.keepVisible = true;
    f.renderer.hidden = true;
    f.fitting.update(); f.flush();
    expect(f.shown()).toEqual(["north", "input"]);
    expect(f.renderer.hidden).toBe(true);
    f.fitting.destroy();
  });

  it("keeps the core controls when a manually enabled wide readout wraps", () => {
    const f = fixture(343, 500);
    for (const item of f.items) if (item.priority <= 2) item.reserveSpace = true;
    f.add("position", 300, 7, true);
    f.fitting.update(); f.flush();
    expect(f.shown()).toEqual(["north", "help", "fps", "position"]);
    f.fitting.destroy();
  });

  it("fits separately measured performance children added after mount and cleans up observers", () => {
    const f = fixture();
    const memory = f.add("memory", 70, 10, true);
    f.fitting.update(); f.flush();
    expect(f.shown()).toEqual(["north", "help", "fps", "memory"]);
    expect(memory.style.order).toBe("10");
    f.fitting.destroy();
    expect(f.disconnect).toHaveBeenCalledOnce();
    expect(f.bar.classList.contains("hud-bar--fitted")).toBe(false);
    expect(f.input.hasAttribute("data-hud-overflow-hidden")).toBe(false);
    expect(memory.style.order).toBe("");
  });
});
