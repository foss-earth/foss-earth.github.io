// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canRequestFullscreen, isStandaloneDisplay, onFullscreenChange, prefersHomeScreenInstall,
  readFullscreenEveryVisit, readFullscreenPromptDismissed, toggleFullscreen,
  writeFullscreenEveryVisit, writeFullscreenPromptDismissed,
} from "./fullscreen";

let fullscreenElement: Element | null = null;
const requestFullscreen = vi.fn(async () => { fullscreenElement = document.documentElement; });
const exitFullscreen = vi.fn(async () => { fullscreenElement = null; });

function stubMedia(matches: (query: string) => boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches(query) }));
}

function stubFullscreenApi(): void {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  document.documentElement.requestFullscreen = requestFullscreen;
  document.exitFullscreen = exitFullscreen;
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  fullscreenElement = null;
  requestFullscreen.mockClear();
  exitFullscreen.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fullscreenEnabled");
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  Reflect.deleteProperty(document, "exitFullscreen");
});

describe("fullscreen capability", () => {
  it("reports no page fullscreen where the browser has none, as iPhone Safari does", () => {
    stubMedia(() => false);
    expect(canRequestFullscreen()).toBe(false);

    stubFullscreenApi();
    expect(canRequestFullscreen()).toBe(true);
  });

  it("treats a coarse pointer as a device that installs to the Home Screen instead", () => {
    stubMedia(query => query === "(pointer: coarse)");
    expect(prefersHomeScreenInstall()).toBe(true);
    expect(isStandaloneDisplay()).toBe(false);
  });

  it("recognises a page already launched without browser bars", () => {
    stubMedia(query => query.includes("display-mode"));
    expect(isStandaloneDisplay()).toBe(true);
  });

  it("toggles in and back out, hiding the navigation UI on the way in", async () => {
    stubMedia(() => false);
    stubFullscreenApi();
    await toggleFullscreen();
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });

    await toggleFullscreen();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("stops listening for fullscreen changes once released", () => {
    const listener = vi.fn();
    const release = onFullscreenChange(listener);
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(listener).toHaveBeenCalledOnce();

    release();
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("fullscreen preferences", () => {
  it("remembers each choice per device and clears it again", () => {
    expect(readFullscreenEveryVisit()).toBe(false);
    writeFullscreenEveryVisit(true);
    expect(window.localStorage.getItem("osfs.fullscreen-every-visit")).toBe("1");
    expect(readFullscreenEveryVisit()).toBe(true);

    writeFullscreenEveryVisit(false);
    expect(readFullscreenEveryVisit()).toBe(false);

    writeFullscreenPromptDismissed(true);
    expect(window.localStorage.getItem("osfs.fullscreen-prompt-dismissed")).toBe("1");
    expect(readFullscreenPromptDismissed()).toBe(true);
  });

  it("answers no, rather than throwing, where storage is refused", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("private browsing"); },
      setItem: () => { throw new Error("private browsing"); },
      removeItem: () => { throw new Error("private browsing"); },
    });

    expect(readFullscreenEveryVisit()).toBe(false);
    expect(readFullscreenPromptDismissed()).toBe(false);
    expect(() => writeFullscreenEveryVisit(true)).not.toThrow();
    expect(() => writeFullscreenPromptDismissed(true)).not.toThrow();
  });
});
