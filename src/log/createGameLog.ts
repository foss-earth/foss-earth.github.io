import { fitLogResize, LOG_DOCK_GAP } from "./fitLogResize";

export type GameLogTone = "info" | "progress" | "success" | "warning" | "error";

export interface GameLogAction {
  label: string;
  onClick(): void;
  /** Set for toggles; exposed as aria-pressed. */
  pressed?: boolean;
  disabled?: boolean;
}

export interface GameLogEntry {
  text: string;
  tone?: GameLogTone;
  /** Omit for no bar, null when the total is unknown, else completion from 0 to 1. */
  progress?: number | null;
  actions?: readonly GameLogAction[];
}

export interface GameLogLine {
  update(entry: GameLogEntry): void;
  focusAction(): void;
  remove(): void;
}

export interface GameLog {
  readonly element: HTMLElement;
  print(entry: GameLogEntry): GameLogLine;
  /** While busy, lines offering an action (such as fullscreen) stay on screen. */
  setBusy(busy: boolean): void;
  /** Shows the whole scrollable history, including lines that have faded. */
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** Collapse to the latest line's icon and a short preview. */
  minimize(): void;
  isMinimized(): boolean;
  destroy(): void;
}

/** How long a finished line stays on screen after its last change. */
export const GAME_LOG_LINE_MS = 8000;
export const GAME_LOG_FADE_MS = 500;
/** Preferred log width, or null when the shell can use its natural width. */
export const GAME_LOG_SIZE_EVENT = "foss-earth-game-log-size";
export interface GameLogSizeChange {
  width: number | null;
  /** Ordinary log messages and restore calls must not steal resize priority. */
  resized: boolean;
}

/** Resizing remembers dimensions; the shell always owns placement. */
interface LogSize { width: number; height: number }
const MAX_LINES = 40;
const PREVIEW_CHARS = 28;
const RESIZE_CLICK_PX = 6;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 128;
const ICONS: Record<GameLogTone, string> = { info: "›", progress: "›", success: "✓", warning: "!", error: "✕" };

function span(className: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  return element;
}

function previewText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_CHARS - 1)}…`;
}

/**
 * A chat-style log beside #root, so mounting the renderer cannot erase it.
 * Newest first. Each line fades on its own once finished, so a new message
 * appears alone rather than bringing the whole history back over the world.
 */
export function createGameLog(): GameLog {
  const element = document.getElementById("app-log") ?? document.createElement("div");
  element.id = "app-log";
  element.className = "game-log";
  element.setAttribute("role", "log");
  element.setAttribute("aria-label", "Game log");
  // Progress lines update in place; only new lines are announced.
  element.setAttribute("aria-relevant", "additions");
  element.replaceChildren();
  element.hidden = false;
  if (!element.isConnected) document.body.append(element);

  const lines = document.createElement("div");
  lines.className = "game-log__lines";
  const peek = document.createElement("button");
  peek.type = "button";
  peek.className = "game-log__peek";
  peek.hidden = true;
  const peekIcon = span("game-log__icon");
  peekIcon.setAttribute("aria-hidden", "true");
  const peekText = span("game-log__peek-text");
  peek.append(peekIcon, peekText);
  const resize = document.createElement("div");
  resize.className = "game-log__resize";
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", "Resize log, click to minimize");
  resize.title = "Drag to resize, click to minimize";
  resize.innerHTML = `<svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="8" cy="5" r="1.2"/></svg>`;
  element.append(peek, lines, resize);

  let busy = false;
  let open = false;
  let minimized = false;
  let destroyed = false;
  let sized: LogSize | null = null;
  let drag: {
    startX: number; startY: number; startW: number; startH: number;
    originLeft: number; originTop: number; pointerId: number; moved: boolean;
    previous: LogSize | null; centered: boolean;
  } | null = null;
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();

  const requestWidth = (width: number | null, resized = false): void => {
    window.dispatchEvent(new CustomEvent<GameLogSizeChange>(GAME_LOG_SIZE_EVENT, { detail: { width, resized } }));
  };

  const applySize = (resized = false): void => {
    element.style.left = "";
    element.style.top = "";
    element.style.transform = "";
    if (!sized || minimized) {
      element.style.width = "";
      element.style.height = "";
      element.removeAttribute("data-sized");
      requestWidth(null);
      return;
    }
    element.style.width = `${sized.width}px`;
    element.style.height = `${sized.height}px`;
    element.setAttribute("data-sized", "");
    requestWidth(sized.width, resized);
  };

  const syncScrollable = (): void => {
    lines.toggleAttribute("data-scrollable", lines.scrollHeight > lines.clientHeight + 1);
  };

  const syncPeek = (): void => {
    const newest = lines.querySelector<HTMLElement>(":scope > .game-log__line");
    if (!newest) {
      peek.hidden = true;
      return;
    }
    peek.hidden = false;
    peek.dataset.tone = newest.dataset.tone ?? "info";
    peekIcon.textContent = newest.querySelector(".game-log__icon")?.textContent ?? "›";
    const text = newest.querySelector(".game-log__text")?.textContent ?? "";
    peekText.textContent = previewText(text);
    peek.setAttribute("aria-label", `Show log: ${text}`);
  };

  const setMinimized = (next: boolean): void => {
    minimized = next && lines.childElementCount > 0;
    element.toggleAttribute("data-minimized", minimized);
    if (minimized) {
      open = false;
      element.removeAttribute("data-open");
    }
    applySize();
    syncPeek();
  };

  const canFade = (row: HTMLElement): boolean => {
    if (row.dataset.tone === "progress") return false;
    if (!row.querySelector("button:not(:disabled)")) return true;
    return !busy && row.dataset.tone !== "error";
  };

  const maybeMinimize = (): void => {
    if (open || minimized) return;
    const rows = [...lines.children] as HTMLElement[];
    if (rows.length > 0 && rows.every((row) => row.hasAttribute("data-expired"))) setMinimized(true);
  };

  const schedule = (row: HTMLElement): void => {
    clearTimeout(timers.get(row));
    timers.delete(row);
    row.removeAttribute("data-fading");
    if (destroyed || row.hasAttribute("data-expired") || !canFade(row)) return;
    timers.set(row, setTimeout(() => {
      row.setAttribute("data-fading", "");
      timers.set(row, setTimeout(() => {
        timers.delete(row);
        row.removeAttribute("data-fading");
        row.setAttribute("data-expired", "");
        syncScrollable();
        maybeMinimize();
      }, GAME_LOG_FADE_MS));
    }, GAME_LOG_LINE_MS));
  };

  const print = (entry: GameLogEntry): GameLogLine => {
    const row = document.createElement("div");
    row.className = "game-log__line";
    const icon = span("game-log__icon");
    icon.setAttribute("aria-hidden", "true");
    const text = span("game-log__text");
    const value = span("game-log__value");
    const actions = span("game-log__actions");
    const bar = span("game-log__bar");
    row.append(icon, text, value, actions, bar);

    const update = (next: GameLogEntry): void => {
      if (destroyed) return;
      const tone = next.tone ?? "info";
      row.dataset.tone = tone;
      icon.textContent = ICONS[tone];
      text.textContent = next.text;

      const measured = typeof next.progress === "number" && Number.isFinite(next.progress)
        ? Math.max(0, Math.min(1, next.progress)) : null;
      bar.hidden = next.progress === undefined;
      if (bar.hidden) {
        bar.removeAttribute("role");
      } else {
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", next.text);
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        if (measured === null) bar.removeAttribute("aria-valuenow");
        else bar.setAttribute("aria-valuenow", String(Math.round(measured * 100)));
        bar.style.setProperty("--game-log-progress", `${(measured ?? 0) * 100}%`);
      }
      value.textContent = !bar.hidden && measured !== null ? `${Math.round(measured * 100)}%` : "";
      value.hidden = !value.textContent;

      actions.replaceChildren(...(next.actions ?? []).map(action => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.disabled = Boolean(action.disabled);
        if (action.pressed !== undefined) button.setAttribute("aria-pressed", String(action.pressed));
        button.addEventListener("click", () => action.onClick());
        return button;
      }));
      actions.hidden = actions.childElementCount === 0;

      // A changed line is news again.
      row.removeAttribute("data-expired");
      setMinimized(false);
      schedule(row);
      syncPeek();
      syncScrollable();
    };

    if (!destroyed) {
      const readingHistory = lines.scrollTop > 0;
      const previousHeight = lines.scrollHeight;
      lines.prepend(row);
      update(entry);
      if (readingHistory) lines.scrollTop += lines.scrollHeight - previousHeight;
      while (lines.childElementCount > MAX_LINES) {
        const oldest = lines.lastElementChild!;
        clearTimeout(timers.get(oldest));
        timers.delete(oldest);
        oldest.remove();
      }
      syncScrollable();
    }
    return {
      update,
      focusAction: () => actions.querySelector("button")?.focus({ preventScroll: true }),
      remove: () => {
        clearTimeout(timers.get(row));
        timers.delete(row);
        row.remove();
        syncPeek();
        syncScrollable();
        if (lines.childElementCount === 0) setMinimized(false);
      },
    };
  };

  peek.addEventListener("click", () => {
    setMinimized(false);
    open = true;
    element.setAttribute("data-open", "");
    lines.scrollTop = 0;
    syncScrollable();
  });

  const releaseDrag = (target: HTMLElement, pointerId: number): void => {
    drag = null;
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  };

  resize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      originLeft: rect.left,
      originTop: rect.top,
      pointerId: event.pointerId,
      moved: false,
      previous: sized,
      // Keep the width request continuous if this drag changes the layout mode.
      centered: document.documentElement.dataset.dockLayout !== "single",
    };
    resize.setPointerCapture?.(event.pointerId);
  });
  resize.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) > RESIZE_CLICK_PX || Math.abs(event.clientY - drag.startY) > RESIZE_CLICK_PX) {
      drag.moved = true;
    }
    const next = fitLogResize({
      origin: { left: drag.originLeft, top: drag.originTop, width: drag.startW, height: drag.startH },
      dx: event.clientX - drag.startX,
      dy: event.clientY - drag.startY,
      // Request dimensions only. The shell fits both docks and the log together.
      centered: drag.centered,
      minLeft: -Infinity,
      maxRight: Infinity,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      maxHeight: Math.max(MIN_HEIGHT, window.innerHeight - drag.originTop - LOG_DOCK_GAP),
    });
    if (!next) {
      releaseDrag(resize, event.pointerId);
      setMinimized(true);
      return;
    }
    sized = { width: next.width, height: next.height };
    applySize(true);
  });
  resize.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    const previous = drag.previous;
    releaseDrag(resize, event.pointerId);
    if (!moved) {
      sized = previous;
      setMinimized(true);
    }
  });
  resize.addEventListener("pointercancel", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    releaseDrag(resize, event.pointerId);
  });

  return {
    element,
    print,
    setBusy(next) {
      busy = next;
      for (const row of lines.children) schedule(row as HTMLElement);
    },
    setOpen(next) {
      open = next;
      element.toggleAttribute("data-open", open);
      if (open) setMinimized(false);
      if (open) lines.scrollTop = 0;
      syncScrollable();
    },
    isOpen: () => open,
    minimize() {
      setMinimized(true);
    },
    isMinimized: () => minimized,
    destroy() {
      destroyed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      element.remove();
      requestWidth(null);
    },
  };
}
