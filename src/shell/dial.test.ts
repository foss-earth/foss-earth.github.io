// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDial, placeLabels, type DialFrame, type DialOptions } from "./dial";

afterEach(() => document.body.replaceChildren());

/** The dial's middle and its track's radius, in px of its own size. */
const MIDDLE = 70;
const TRACK = 46;
const point = (turn: number, radius = TRACK): { clientX: number; clientY: number } => ({
  clientX: MIDDLE + radius * Math.sin(turn * 2 * Math.PI),
  clientY: MIDDLE - radius * Math.cos(turn * 2 * Math.PI),
});

const FRAME: DialFrame = {
  turn: 0.25,
  valueNow: 360,
  valueText: "06:00",
  arcs: [{ from: 0, to: 1, colour: "#101b3b" }, { from: 0.75, to: 1.25, colour: "#a9cff6" }],
  ticks: [{ turn: 0, major: true }, { turn: 0.5, major: true }, { turn: 0.25 }],
  marks: [
    { id: "noon", label: "Noon", turn: 0, title: "Noon" },
    { id: "midnight", label: "Midnight", turn: 0.5, title: "Midnight" },
  ],
};

function mount(overrides: Partial<DialOptions> = {}) {
  const options: DialOptions = {
    ariaLabel: "Time of day",
    valueMax: 1439,
    centre: document.createElement("div"),
    onPress: vi.fn(),
    onDragStart: vi.fn(),
    onDrag: vi.fn(),
    onDragEnd: vi.fn(),
    onKey: vi.fn(),
    onMark: vi.fn(),
    ...overrides,
  };
  const dial = createDial(options);
  document.body.append(dial.element);
  const face = dial.element.querySelector<SVGSVGElement>(".foss-earth-dial__face")!;
  face.getBoundingClientRect = () => ({ left: 0, top: 0, width: 140, height: 140, right: 140, bottom: 140, x: 0, y: 0, toJSON: () => ({}) });
  const knob = dial.element.querySelector<SVGCircleElement>('[role="slider"]')!;
  const pointer = (type: string, target: Element, at: { clientX: number; clientY: number }) =>
    target.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, bubbles: true, cancelable: true, ...at }));
  return { dial, options, face, knob, pointer };
}

describe("dial", () => {
  it("draws its arcs, ticks, marks and knob, and names the knob's value", () => {
    const { dial, knob } = mount();
    dial.render(FRAME);
    expect(dial.element.querySelectorAll(".foss-earth-dial__arcs path")).toHaveLength(2);
    expect(dial.element.querySelectorAll(".foss-earth-dial__tick")).toHaveLength(3);
    expect(dial.element.querySelectorAll(".foss-earth-dial__tick.is-major")).toHaveLength(2);
    expect([...dial.element.querySelectorAll("[data-mark] textPath")].map(label => label.textContent)).toEqual(["Noon", "Midnight"]);
    expect(dial.element.querySelector('[data-mark="noon"]')!.getAttribute("aria-label")).toBe("Noon");
    // A quarter turn round from the top is the right of the track.
    expect(Number(knob.getAttribute("cx"))).toBeCloseTo(MIDDLE + TRACK, 1);
    expect(Number(knob.getAttribute("cy"))).toBeCloseTo(MIDDLE, 1);
    expect(knob.getAttribute("aria-valuenow")).toBe("360");
    expect(knob.getAttribute("aria-valuemax")).toBe("1439");
    expect(knob.getAttribute("aria-valuetext")).toBe("06:00");
  });

  it("keeps each mark's element while it stays, so focus on it survives a redraw", () => {
    const { dial } = mount();
    dial.render(FRAME);
    const noon = dial.element.querySelector('[data-mark="noon"]');
    dial.render({ ...FRAME, turn: 0.3, marks: [...FRAME.marks, { id: "sunset", label: "Sunset", turn: 0.3, title: "Sunset" }] });
    expect(dial.element.querySelector('[data-mark="noon"]')).toBe(noon);
    expect(dial.element.querySelector('[data-mark="sunset"]')).not.toBeNull();
    dial.render({ ...FRAME, marks: FRAME.marks.slice(0, 1) });
    expect(dial.element.querySelector('[data-mark="midnight"]')).toBeNull();
  });

  it("turns its knob with the keys a slider takes", () => {
    const { dial, knob, options } = mount();
    dial.render(FRAME);
    const keys = ["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "PageUp", "PageDown", "Home", "End", "w"];
    for (const key of keys) knob.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    expect(vi.mocked(options.onKey).mock.calls.map(([key]) => key)).toEqual(["next", "next", "previous", "previous", "pageNext", "pagePrevious", "start", "end"]);
  });

  it("takes the knob where the track is pressed, and counts a drag's turns past the top", () => {
    const { dial, face, pointer, options } = mount();
    dial.render(FRAME);
    pointer("pointerdown", face, point(0.75));
    expect(options.onPress).toHaveBeenCalledTimes(1);
    expect(vi.mocked(options.onPress).mock.calls[0][0]).toBeCloseTo(0.75, 6);
    expect(options.onDragStart).toHaveBeenCalledTimes(1);
    expect(dial.isDragging()).toBe(true);
    // Round once and a quarter more, clockwise, in eighths.
    for (let step = 1; step <= 10; step++) pointer("pointermove", face, point(0.75 + step / 8));
    const travel = vi.mocked(options.onDrag).mock.calls.at(-1)![0];
    expect(travel).toBeCloseTo(1.25, 6);
    // And back the other way past where it started.
    for (let step = 9; step >= -4; step--) pointer("pointermove", face, point(0.75 + step / 8));
    expect(vi.mocked(options.onDrag).mock.calls.at(-1)![0]).toBeCloseTo(-0.5, 6);
    pointer("pointerup", face, point(0.25));
    expect(options.onDragEnd).toHaveBeenCalledTimes(1);
    expect(dial.isDragging()).toBe(false);
  });

  it("drags from the knob without moving it first, and ignores presses off the track", () => {
    const { dial, face, knob, pointer, options } = mount();
    dial.render(FRAME);
    pointer("pointerdown", knob, point(0.25));
    expect(options.onPress).not.toHaveBeenCalled();
    expect(options.onDragStart).toHaveBeenCalledTimes(1);
    pointer("pointerup", face, point(0.25));
    // The middle, where the readout is, and the far corner are not the track.
    pointer("pointerdown", face, point(0.4, 10));
    pointer("pointerdown", face, { clientX: 1, clientY: 1 });
    expect(options.onPress).not.toHaveBeenCalled();
    expect(options.onDragStart).toHaveBeenCalledTimes(1);
  });

  it("presses a mark by click or key, and nothing while disabled", () => {
    const { dial, face, pointer, options } = mount();
    dial.render(FRAME);
    const midnight = dial.element.querySelector<SVGGElement>('[data-mark="midnight"]')!;
    expect(midnight.getAttribute("role")).toBe("button");
    // A press on a mark is the mark's, not the track's.
    pointer("pointerdown", midnight, point(0.5, 61));
    expect(options.onDragStart).not.toHaveBeenCalled();
    midnight.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    midnight.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    midnight.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(vi.mocked(options.onMark).mock.calls).toEqual([["midnight"], ["midnight"], ["midnight"]]);
    dial.render({ ...FRAME, disabled: true });
    midnight.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    pointer("pointerdown", face, point(0.75));
    expect(options.onMark).toHaveBeenCalledTimes(3);
    expect(options.onPress).not.toHaveBeenCalled();
    expect(dial.element.classList.contains("is-disabled")).toBe(true);
  });

  it("writes labels upright, along the bottom anticlockwise", () => {
    const { dial } = mount();
    dial.render(FRAME);
    const line = (id: string) => dial.element.querySelector(`[data-mark="${id}"] textPath`)!.getAttribute("href")!;
    expect(line("noon")).toMatch(/-upper$/);
    expect(line("midnight")).toMatch(/-lower$/);
  });

  it("pushes labels that would overlap apart, each side alike", () => {
    const placed = placeLabels([
      { id: "a", label: "Midnight", turn: 0.5, title: "" },
      { id: "b", label: "Sunrise", turn: 0.52, title: "" },
      { id: "c", label: "Noon", turn: 0, title: "" },
    ]);
    const [a, b] = [placed.find(label => label.mark.id === "a")!, placed.find(label => label.mark.id === "b")!];
    expect(b.middle - a.middle).toBeGreaterThanOrEqual(a.half + b.half - 1e-9);
    expect((a.middle + b.middle) / 2).toBeCloseTo(0.51, 6);
    expect(placed.find(label => label.mark.id === "c")!.middle).toBe(0);
  });
});
