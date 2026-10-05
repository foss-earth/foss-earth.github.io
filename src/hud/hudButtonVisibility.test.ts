// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HUD_BUTTON_VISIBILITY_STORAGE_KEY, loadHudButtonVisibility, saveHudButtonVisibility } from "./hudButtonVisibility";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("toolbar button visibility", () => {
  it("shows every button on a first visit", () => {
    expect(loadHudButtonVisibility()).toEqual({ help: "auto", renderer: "auto", settings: "auto", theme: "auto", inputMode: "auto", fullscreen: "auto", position: "auto" });
  });

  it("keeps a hidden button hidden, and shows one it has never heard of", () => {
    values.set(HUD_BUTTON_VISIBILITY_STORAGE_KEY, JSON.stringify({ theme: false }));
    expect(loadHudButtonVisibility()).toEqual({ help: "auto", renderer: "auto", settings: "auto", theme: "off", inputMode: "auto", fullscreen: "auto", position: "auto" });
  });

  it("round-trips a choice", () => {
    saveHudButtonVisibility({ help: "off", renderer: "on", settings: "auto", theme: "on", inputMode: "off", fullscreen: "auto", position: "auto" });
    expect(loadHudButtonVisibility()).toEqual({ help: "off", renderer: "on", settings: "auto", theme: "on", inputMode: "off", fullscreen: "auto", position: "auto" });
  });

  it("shows everything rather than throwing on unreadable storage", () => {
    values.set(HUD_BUTTON_VISIBILITY_STORAGE_KEY, "{not json");
    expect(loadHudButtonVisibility().help).toBe("auto");
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("private browsing"); },
      setItem: () => { throw new Error("private browsing"); },
    });
    expect(loadHudButtonVisibility().settings).toBe("auto");
    expect(() => saveHudButtonVisibility({ help: "off", renderer: "off", settings: "off", theme: "off", inputMode: "off", fullscreen: "auto", position: "off" })).not.toThrow();
  });
});
