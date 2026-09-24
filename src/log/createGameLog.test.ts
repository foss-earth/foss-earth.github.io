// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameLog, GAME_LOG_FADE_MS, GAME_LOG_LINE_MS, type GameLog } from "./createGameLog";

let log: GameLog;
const rows = () => [...log.element.querySelectorAll<HTMLElement>(".game-log__line")];
const showing = () => rows().filter(row => !row.hasAttribute("data-expired")).map(row => row.textContent);

beforeEach(() => {
  document.body.innerHTML = '<main id="root"></main><div id="app-log"><div class="game-log__line">Downloading the application…</div></div>';
});

afterEach(() => {
  log?.destroy();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("game log", () => {
  it("adopts the first-paint log beside the renderer root and replaces its placeholder lines", () => {
    const firstPaint = document.getElementById("app-log");
    log = createGameLog();

    expect(log.element).toBe(firstPaint);
    expect(document.getElementById("root")!.contains(log.element)).toBe(false);
    expect(log.element.getAttribute("role")).toBe("log");
    expect(log.element.querySelector(".game-log__lines")!.textContent).toBe("");
  });

  it("renders untrusted text as text and updates a line in place", () => {
    log = createGameLog();
    const line = log.print({ text: "Terrain <img src=x>", tone: "progress", progress: null });
    const bar = log.element.querySelector('[role="progressbar"]')!;
    expect(log.element.querySelector("img")).toBeNull();
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);

    line.update({ text: "Terrain", tone: "progress", progress: 0.42 });
    expect(rows()).toHaveLength(1);
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(log.element.textContent).toContain("42%");

    line.update({ text: "Terrain", tone: "progress", progress: Number.NaN });
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);

    line.update({ text: "Terrain ready", tone: "success" });
    expect(log.element.querySelector('[role="progressbar"]')).toBeNull();
    expect(rows()[0].textContent).toBe("✓Terrain ready");
  });

  it("runs actions and exposes toggles as pressed buttons", () => {
    log = createGameLog();
    const onClick = vi.fn();
    log.print({ text: "Offer", actions: [{ label: "Go", onClick }, { label: "Every visit", pressed: false, onClick: vi.fn() }] });
    const [go, toggle] = rows()[0].querySelectorAll("button");

    go.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(go.hasAttribute("aria-pressed")).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a new message alone instead of bringing the history back", () => {
    vi.useFakeTimers();
    log = createGameLog();
    log.print({ text: "Older" });
    vi.advanceTimersByTime(GAME_LOG_LINE_MS + GAME_LOG_FADE_MS);
    expect(showing()).toHaveLength(0);
    expect(log.isMinimized()).toBe(true);
    const peek = log.element.querySelector<HTMLButtonElement>(".game-log__peek")!;
    expect(peek.hidden).toBe(false);
    expect(peek.textContent).toBe("›Older");
    peek.click();
    expect(log.isMinimized()).toBe(false);
    expect(log.isOpen()).toBe(true);

    log.print({ text: "Newer" });
    expect(showing()).toEqual(["›Newer"]);

    log.setOpen(true);
    expect(log.element.hasAttribute("data-open")).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it("keeps work in progress, unanswered errors and offers made during loading", () => {
    vi.useFakeTimers();
    log = createGameLog();
    log.setBusy(true);
    const work = log.print({ text: "Terrain", tone: "progress", progress: 0.2 });
    const failure = log.print({ text: "Failed", tone: "error", actions: [{ label: "Try again", onClick: vi.fn() }] });
    log.print({ text: "Fullscreen?", actions: [{ label: "Fullscreen", onClick: vi.fn() }] });
    vi.advanceTimersByTime(GAME_LOG_LINE_MS * 3);
    expect(showing()).toHaveLength(3);

    // The offer has waited out the loading it was shown during.
    log.setBusy(false);
    vi.advanceTimersByTime(GAME_LOG_LINE_MS + GAME_LOG_FADE_MS);
    expect(showing()).toEqual(["✕FailedTry again", "›Terrain20%"]);

    work.update({ text: "Terrain ready", tone: "success" });
    failure.update({ text: "Failed", tone: "error" });
    vi.advanceTimersByTime(GAME_LOG_LINE_MS + GAME_LOG_FADE_MS);
    expect(showing()).toHaveLength(0);
  });

  it("keeps a history reader's place and only takes input when it can scroll", () => {
    log = createGameLog();
    const lines = log.element.querySelector<HTMLElement>(".game-log__lines")!;
    Object.defineProperty(lines, "scrollHeight", { configurable: true, get: () => lines.childElementCount * 28 });
    Object.defineProperty(lines, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(lines, "scrollTop", { configurable: true, writable: true, value: 0 });

    for (let i = 0; i < 3; i++) log.print({ text: `Line ${i}` });
    expect(lines.hasAttribute("data-scrollable")).toBe(false);
    log.print({ text: "Line 3" });
    expect(lines.hasAttribute("data-scrollable")).toBe(true);

    lines.scrollTop = 40;
    log.print({ text: "Line 4" });
    expect(lines.scrollTop).toBe(68);

    lines.scrollTop = 0;
    log.print({ text: "Line 5" });
    expect(lines.scrollTop).toBe(0);
  });

  it("keeps a bounded history with the newest line first", () => {
    log = createGameLog();
    for (let i = 0; i < 60; i++) log.print({ text: `Line ${i}` });

    expect(rows()).toHaveLength(40);
    expect(rows()[0].textContent).toContain("Line 59");
    expect(rows()[39].textContent).toContain("Line 20");
  });

  it("minimizes from the corner grip and that chip opens the log", () => {
    log = createGameLog();
    log.print({ text: "Google 3D Tiles need an API key before the globe can load them.", tone: "warning" });
    const grip = log.element.querySelector<HTMLElement>(".game-log__resize")!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1, bubbles: true }));
    grip.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: 10, clientY: 10, pointerId: 1, bubbles: true }));
    const peek = log.element.querySelector<HTMLButtonElement>(".game-log__peek")!;
    expect(log.isMinimized()).toBe(true);
    expect(peek.textContent).toBe("!Google 3D Tiles need an API…");
    expect(log.element.querySelector(".game-log__minimize")).toBeNull();
  });

  it("grows from the same corner grip the left dock uses", () => {
    log = createGameLog();
    log.print({ text: "Terrain ready", tone: "success" });
    log.element.getBoundingClientRect = () => ({ left: 400, top: 84, width: 220, height: 140, right: 620, bottom: 224, x: 400, y: 84, toJSON() {} });
    const grip = log.element.querySelector<HTMLElement>(".game-log__resize")!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 200, clientY: 200, pointerId: 1, bubbles: true }));
    grip.dispatchEvent(new PointerEvent("pointermove", { button: 0, clientX: 280, clientY: 260, pointerId: 1, bubbles: true }));
    grip.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: 280, clientY: 260, pointerId: 1, bubbles: true }));
    expect(log.isMinimized()).toBe(false);
    expect(log.element.style.width).toBe("380px");
    expect(log.element.style.height).toBe("200px");
    expect(log.element.style.left).toBe("320px");
  });
});
