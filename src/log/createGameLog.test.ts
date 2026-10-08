// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry } from "../settings/registry";
import { INTERFACE_PARAMETERS } from "../settings/catalogue/interface";
import { createGameLog, GAME_LOG_FADE_MS, GAME_LOG_LINE_MS, GAME_LOG_SIZE_EVENT, type GameLog, type GameLogSizeChange } from "./createGameLog";

let log: GameLog;
const rows = () => [...log.element.querySelectorAll<HTMLElement>(".game-log__line")];
const showing = () => rows().filter(row => !row.hasAttribute("data-expired")).map(row => row.textContent);

beforeEach(() => {
  document.body.innerHTML = '<main id="root"></main><div id="app-log"><div class="game-log__line">Downloading the application…</div></div>';
});

afterEach(() => {
  log?.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "execCommand");
  document.body.replaceChildren();
  delete document.documentElement.dataset.dockLayout;
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
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    log = createGameLog();
    const onClick = vi.fn();
    log.print({ text: "Offer", actions: [{ label: "Go", onClick }, { label: "Every visit", pressed: false, onClick: vi.fn() }] });
    const [go, toggle] = rows()[0].querySelectorAll(".game-log__actions button");

    go.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(go.hasAttribute("aria-pressed")).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not copy when an action updates its own message before the click bubbles", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    log = createGameLog();
    const line = log.print({ text: "Offer", actions: [{ label: "Go", onClick: () => line.update({ text: "Accepted" }) }] });
    rows()[0].querySelector<HTMLButtonElement>(".game-log__actions button")!.click();
    expect(rows()[0].textContent).toBe("›Accepted");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the message content and confirms only after copying succeeds", async () => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    log = createGameLog();
    const line = log.print({ text: "Terrain <img src=x>\nReady", tone: "success", progress: 1 });
    const text = rows()[0].querySelector<HTMLButtonElement>(".game-log__text")!;
    text.click();
    expect(writeText).toHaveBeenCalledWith("Terrain <img src=x>\nReady");
    expect(text.textContent).not.toContain("copied 2 clipboard");
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(text.textContent).toBe("Terrain <img src=x>\nReady (copied 2 clipboard)");
    expect(rows()[0].querySelector("img")).toBeNull();

    // Clicking the icon also copies, without including the confirmation or 100% bar.
    rows()[0].querySelector<HTMLElement>(".game-log__icon")!.click();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenLastCalledWith("Terrain <img src=x>\nReady");
    expect(text.textContent).toBe("Terrain <img src=x>\nReady (copied 2 clipboard)");
    line.update({ text: "New content" });
    expect(text.textContent).toBe("New content");
  });

  it.each(["update", "remove", "destroy"] as const)("ignores a clipboard completion after %s", async change => {
    let finish!: () => void;
    vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>(resolve => { finish = resolve; }) } });
    log = createGameLog();
    const line = log.print({ text: "Loading" });
    const text = rows()[0].querySelector<HTMLButtonElement>(".game-log__text")!;
    text.click();
    if (change === "update") line.update({ text: "Ready" });
    else if (change === "remove") line.remove();
    else log.destroy();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(text.textContent).toBe(change === "update" ? "Ready" : "Loading");
  });

  it.each(["unavailable", "denied"])("copies through a selection when the clipboard API is %s", async state => {
    vi.stubGlobal("navigator", state === "unavailable" ? {} : { clipboard: { writeText: async () => { throw new Error("Denied"); } } });
    const execCommand = vi.fn(() => {
      expect((document.activeElement as HTMLTextAreaElement).value).toBe("Terrain ready");
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    log = createGameLog();
    log.print({ text: "Terrain ready" });
    const text = rows()[0].querySelector<HTMLButtonElement>(".game-log__text")!;
    text.focus();
    text.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(text.textContent).toBe("Terrain ready (copied 2 clipboard)");
    expect(document.activeElement).toBe(text);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports a failed copy without confirming success or leaving a temporary field", async () => {
    vi.stubGlobal("navigator", {});
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    log = createGameLog();
    log.print({ text: "Terrain ready" });
    rows()[0].click();
    await Promise.resolve();
    expect(rows()[0].textContent).toBe("›Terrain ready (could not copy)");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("lets copied messages and errors expire while busy without renewing their TTL", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    log = createGameLog();
    log.setBusy(true);
    log.print({ text: "Failed", tone: "error" });
    log.print({ text: "Ready", tone: "success" });
    vi.advanceTimersByTime(GAME_LOG_LINE_MS / 2);
    rows()[0].click();
    await Promise.resolve();
    await Promise.resolve();
    expect(showing()[0]).toContain("(copied 2 clipboard)");
    vi.advanceTimersByTime(GAME_LOG_LINE_MS / 2 + GAME_LOG_FADE_MS);
    expect(showing()).toHaveLength(0);
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

  it("removes transient notices on expiry even in history, and updates the minimized preview", () => {
    vi.useFakeTimers();
    log = createGameLog();
    const older = log.print({ text: "Older" });
    log.print({ text: "Panorama ready", tone: "success", keepInHistory: false });
    log.setOpen(true);
    vi.advanceTimersByTime(GAME_LOG_LINE_MS + GAME_LOG_FADE_MS);
    expect(rows().map(row => row.textContent)).toEqual(["›Older"]);
    log.setOpen(false);
    log.minimize();
    expect(log.element.querySelector(".game-log__peek")!.textContent).toBe("›Older");

    older.remove();
    log.print({ text: "Last transient", keepInHistory: false });
    vi.advanceTimersByTime(GAME_LOG_LINE_MS + GAME_LOG_FADE_MS);
    expect(rows()).toHaveLength(0);
    expect(log.isMinimized()).toBe(false);
    expect(log.element.querySelector<HTMLButtonElement>(".game-log__peek")!.hidden).toBe(true);
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

  it("keeps each line interface.log.lineDuration, and interface.log.maxLines lines", () => {
    vi.useFakeTimers();
    const data = new Map<string, string>();
    const settings = createSettingsRegistry({ storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } } });
    settings.register(INTERFACE_PARAMETERS);
    settings.set("interface.log.lineDuration", 2);
    settings.set("interface.log.maxLines", 5);
    log = createGameLog(settings);
    log.print({ text: "Short" });
    vi.advanceTimersByTime(2000 + GAME_LOG_FADE_MS);
    expect(showing()).toHaveLength(0);

    for (let i = 0; i < 8; i++) log.print({ text: `Line ${i}` });
    expect(rows()).toHaveLength(5);
    // A change applies to the next line printed.
    settings.set("interface.log.maxLines", 6);
    log.print({ text: "Line 8" });
    expect(rows()).toHaveLength(6);
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
    // A saved size must never pin the log on the left after the layout changes.
    expect(log.element.style.left).toBe("");
    expect(log.element.style.top).toBe("");
    expect(log.element.style.transform).toBe("");
  });

  it("releases and restores its preferred width on minimize, reopen, and destroy", () => {
    const widths: Array<number | null> = [];
    const onSize = (event: Event) => widths.push((event as CustomEvent<GameLogSizeChange>).detail.width);
    window.addEventListener(GAME_LOG_SIZE_EVENT, onSize);
    try {
      log = createGameLog();
      log.print({ text: "Terrain loading", tone: "progress" });
      log.element.getBoundingClientRect = () => ({ left: 400, top: 12, width: 220, height: 140, right: 620, bottom: 152, x: 400, y: 12, toJSON() {} });
      const grip = log.element.querySelector<HTMLElement>(".game-log__resize")!;
      grip.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 620, clientY: 152, pointerId: 1 }));
      grip.dispatchEvent(new PointerEvent("pointermove", { button: 0, clientX: 700, clientY: 212, pointerId: 1 }));
      grip.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: 700, clientY: 212, pointerId: 1 }));
      expect(widths.at(-1)).toBe(380);
      log.minimize();
      expect(widths.at(-1)).toBeNull();
      log.setOpen(true);
      expect(widths.at(-1)).toBe(380);
      log.minimize();
      log.print({ text: "Terrain ready" });
      expect(widths.at(-1)).toBe(380);
      log.destroy();
      expect(widths.at(-1)).toBeNull();
    } finally {
      window.removeEventListener(GAME_LOG_SIZE_EVENT, onSize);
    }
  });

  it("keeps one resize scale across a mode change and distinguishes messages from manual resizing", () => {
    const changes: GameLogSizeChange[] = [];
    const onSize = (event: Event) => changes.push((event as CustomEvent<GameLogSizeChange>).detail);
    window.addEventListener(GAME_LOG_SIZE_EVENT, onSize);
    try {
      log = createGameLog();
      log.print({ text: "Loading", tone: "progress" });
      document.documentElement.dataset.dockLayout = "dual";
      log.element.getBoundingClientRect = () => ({ left: 360, top: 12, width: 560, height: 140, right: 920, bottom: 152, x: 360, y: 12, toJSON() {} });
      const grip = log.element.querySelector<HTMLElement>(".game-log__resize")!;
      grip.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 920, clientY: 152, pointerId: 1 }));
      grip.dispatchEvent(new PointerEvent("pointermove", { button: 0, clientX: 1120, clientY: 152, pointerId: 1 }));
      expect(changes.at(-1)).toEqual({ width: 960, resized: true });
      document.documentElement.dataset.dockLayout = "single";
      grip.dispatchEvent(new PointerEvent("pointermove", { button: 0, clientX: 1070, clientY: 152, pointerId: 1 }));
      expect(changes.at(-1)).toEqual({ width: 860, resized: true });
      grip.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: 1070, clientY: 152, pointerId: 1 }));
      log.print({ text: "Another update" });
      expect(changes.at(-1)).toEqual({ width: 860, resized: false });
    } finally {
      window.removeEventListener(GAME_LOG_SIZE_EVENT, onSize);
    }
  });
});
