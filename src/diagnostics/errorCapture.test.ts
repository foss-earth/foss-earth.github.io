import { describe, expect, it } from "vitest";
import { captureErrors, tapConsole, type CapturedError } from "./errorCapture";

/** A window as far as its events go. */
function fakeTarget() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    addEventListener: (type: string, listener: (event: Event) => void) => { listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)); },
    removeEventListener: (type: string, listener: (event: Event) => void) => { listeners.get(type)?.delete(listener); },
    fire: (type: string, detail: object) => { for (const listener of [...(listeners.get(type) ?? [])]) listener(detail as Event); },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

describe("captureErrors", () => {
  it("reports an error nothing handled with its file, place and the top of its stack", () => {
    const target = fakeTarget();
    const seen: CapturedError[] = [];
    const stop = captureErrors(target as unknown as Window, error => seen.push(error));
    const error = new TypeError("tiles is not iterable");
    error.stack = ["TypeError: tiles is not iterable", ...Array.from({ length: 9 }, (_, index) => `    at frame${index} (app.js:${index}:1)`)].join("\n");
    target.fire("error", { message: "Uncaught TypeError: tiles is not iterable", filename: "https://tour.test/assets/twinCities-C9TYTT-e.js?v=1", lineno: 12, colno: 345, error });
    expect(seen).toEqual([{ kind: "error", message: "TypeError: tiles is not iterable", where: "twinCities-C9TYTT-e.js:12:345", stack: error.stack.split("\n").slice(0, 6).join("\n") }]);
    // Another origin's script says only this much.
    target.fire("error", { message: "Script error.", filename: "", lineno: 0, colno: 0, error: null });
    expect(seen[1]).toEqual({ kind: "error", message: "Script error.", where: null, stack: null });
    stop();
    expect(target.count()).toBe(0);
  });

  it("reports a rejection nothing handled, whatever was thrown", () => {
    const target = fakeTarget();
    const seen: CapturedError[] = [];
    captureErrors(target as unknown as Window, error => seen.push(error));
    target.fire("unhandledrejection", { reason: new RangeError("too large") });
    target.fire("unhandledrejection", { reason: "plain text" });
    target.fire("unhandledrejection", { reason: { code: 7 } });
    expect(seen.map(error => [error.kind, error.message])).toEqual([["rejection", "RangeError: too large"], ["rejection", "plain text"], ["rejection", "{\"code\":7}"]]);
  });

  it("leaves out what is not a fault: a load given up, a file that did not load, and the browser's layout notice", () => {
    const target = fakeTarget();
    const seen: CapturedError[] = [];
    captureErrors(target as unknown as Window, error => seen.push(error));
    target.fire("unhandledrejection", { reason: new DOMException("The scene was left.", "AbortError") });
    target.fire("error", { type: "error" });
    target.fire("error", { message: "ResizeObserver loop completed with undelivered notifications.", filename: "", lineno: 0, colno: 0 });
    expect(seen).toEqual([]);
  });
});

describe("tapConsole", () => {
  it("tells of each warning and error, which are still written, and puts the console back", () => {
    const written: string[] = [];
    const target = { warn: (...values: unknown[]) => { written.push(`warn ${values.join(" ")}`); }, error: (...values: unknown[]) => { written.push(`error ${values.join(" ")}`); } };
    const original = { ...target };
    const told: string[] = [];
    const stop = tapConsole(target, (level, text) => told.push(`${level}: ${text}`));
    target.warn("WebGPU uncaptured error (1):", new Error("shader refused"));
    target.error("lost", { reason: "destroyed" });
    expect(told).toEqual(["warn: WebGPU uncaptured error (1): Error: shader refused", "error: lost {\"reason\":\"destroyed\"}"]);
    expect(written).toHaveLength(2);
    stop();
    expect(target.warn).toBe(original.warn);
    expect(target.error).toBe(original.error);
  });

  it("does not tell a listener of what the listener itself writes, nor fail the caller when the listener does", () => {
    const target = { warn: (): void => {}, error: (): void => {} };
    const told: string[] = [];
    tapConsole(target, (_level, text) => {
      told.push(text);
      target.warn("from the listener");
      throw new Error("the listener's own fault");
    });
    expect(() => target.warn("first")).not.toThrow();
    expect(told).toEqual(["first"]);
  });
});
