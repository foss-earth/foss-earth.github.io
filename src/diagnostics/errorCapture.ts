/**
 * What goes wrong without anyone being told (docs/diagnostics.md): errors and
 * promise rejections that nothing handled, and the warnings and errors that
 * code writes to the console, which a phone has no window to show.
 */

export interface CapturedError {
  kind: "error" | "rejection";
  /** "TypeError: x is not a function". */
  message: string;
  /** The file and place, "app-1a2b3c.js:12:345", where the browser says. */
  where: string | null;
  /** The first lines of its stack, where it has one. */
  stack: string | null;
}

/** A stack's first lines: where it was thrown and who called that. */
const STACK_LINES = 6;

const fileOf = (url: string): string => url.split(/[?#]/)[0].split("/").pop() || url;

function describe(reason: unknown): { message: string; stack: string | null } {
  if (reason instanceof Error) {
    const stack = typeof reason.stack === "string" ? reason.stack.split("\n").slice(0, STACK_LINES).join("\n") : null;
    return { message: `${reason.name}: ${reason.message}`, stack };
  }
  if (typeof reason === "string") return { message: reason, stack: null };
  try { return { message: JSON.stringify(reason) ?? String(reason), stack: null }; } catch { return { message: String(reason), stack: null }; }
}

/** A load given up on purpose, as when a scene is left while its images arrive: not a fault. */
const isAbort = (reason: unknown): boolean => reason instanceof Error && reason.name === "AbortError";
/** Browsers report a layout that did not settle in one frame as an error; it is not one of the app's. */
const RESIZE_OBSERVER_NOTICE = /^ResizeObserver loop /;

/** Calls `onError` with each error and rejection nothing handled; returns a stop. */
export function captureErrors(target: Pick<Window, "addEventListener" | "removeEventListener">, onError: (error: CapturedError) => void): () => void {
  const onErrorEvent = (event: Event): void => {
    const detail = event as ErrorEvent;
    // A file that failed to load is an event with no message, and its element's own business.
    if (typeof detail.message !== "string" || !detail.message || RESIZE_OBSERVER_NOTICE.test(detail.message)) return;
    const described = detail.error === undefined || detail.error === null ? { message: detail.message, stack: null } : describe(detail.error);
    const where = detail.filename ? `${fileOf(detail.filename)}:${detail.lineno}:${detail.colno}` : null;
    onError({ kind: "error", message: described.message || detail.message, where, stack: described.stack });
  };
  const onRejection = (event: Event): void => {
    const reason = (event as PromiseRejectionEvent).reason as unknown;
    if (isAbort(reason)) return;
    onError({ kind: "rejection", where: null, ...describe(reason) });
  };
  target.addEventListener("error", onErrorEvent);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onErrorEvent);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

function consoleText(values: readonly unknown[]): string {
  return values.map(value => (typeof value === "string" ? value : describe(value).message)).join(" ");
}

/**
 * Calls `onMessage` with each warning and error written to `target`, which
 * still writes them as before; returns a stop. The renderer reports a shader
 * it refused, an error of the GPU's and a lost device this way and no other.
 */
export function tapConsole(target: Pick<Console, "warn" | "error">, onMessage: (level: "warn" | "error", text: string) => void): () => void {
  const original = { warn: target.warn, error: target.error };
  let telling = false;
  const tap = (level: "warn" | "error") => function (this: unknown, ...values: unknown[]): void {
    original[level].apply(target, values);
    // What the listener itself writes to the console is not told back to it.
    if (telling) return;
    telling = true;
    try { onMessage(level, consoleText(values)); } catch { /* A listener's fault must not become the caller's. */ } finally { telling = false; }
  };
  const taps = { warn: tap("warn"), error: tap("error") };
  target.warn = taps.warn;
  target.error = taps.error;
  return () => {
    // Only where nothing else has wrapped them since.
    if (target.warn === taps.warn) target.warn = original.warn;
    if (target.error === taps.error) target.error = original.error;
  };
}
