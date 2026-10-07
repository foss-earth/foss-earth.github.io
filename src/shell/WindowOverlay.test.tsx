// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay";
import type { PanoramaTabs, PanoramaTabsSnapshot } from "./panoramaTabs";
import { SAVED_WORKSPACE_STORAGE_KEY } from "./savedWorkspace";
import { GAME_LOG_SIZE_EVENT, type GameLogSizeChange } from "../log/createGameLog";

// Each test starts from a device with nothing saved.
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("owns responsive launchers, cross-side tab moves, minimize/restore, and Location search", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let width = 1200;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const apply = vi.fn();
  const click = async (selector: string) => {
    const button = host.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  };
  const open = async (side: string, label: string) => {
    await click(`[aria-label="Open ${side} panel"]`);
    const item = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent === label)!;
    await act(async () => item.click());
  };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={apply}
    additionalTabs={[{ id: "aircraft", label: "Aircraft" }]}
    renderAdditionalTab={() => <p>Aircraft controls</p>}
  />));
  try {
    expect(host.querySelector('[aria-label="Open left panel"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Open right panel"]')).not.toBeNull();
    await open("left", "Location");
    await open("right", "Aircraft");
    const right = host.querySelector<HTMLElement>('[data-side="right"]')!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "location" } });
    await act(async () => right.dispatchEvent(drop));
    expect(host.querySelector('[aria-label="Open left panel"]')).not.toBeNull();
    expect(right.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
    await click('[data-side="right"] .foss-earth-tab-shell-selected .foss-earth-tab-button');
    expect(right.dataset.collapsed).toBe("true");
    await click('[data-side="right"] .foss-earth-tab-shell-selected .foss-earth-tab-button');
    expect(right.dataset.collapsed).toBe("false");
    await click('[aria-label="Close Location tab"]');
    await open("left", "Location");
    width = 700;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[aria-label="Open left panel"]')).toBeNull();
    expect(host.querySelector('[data-side="left"]')).toBeNull();
    expect(right.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
    const locationTab = Array.from(right.querySelectorAll<HTMLButtonElement>(".foss-earth-tab-button")).find(button => button.textContent === "Location")!;
    if (!host.querySelector(".foss-earth-location-panel")) await act(async () => locationTab.click());
    const query = host.querySelector<HTMLInputElement>('.foss-earth-location-panel input')!;
    expect(query.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(query, "46, -92");
      query.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => query.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const result = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "46, -92")!;
    await act(async () => result.click());
    expect(apply).toHaveBeenLastCalledWith({ latDeg: 46, lonDeg: -92 });
    width = 1200;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Location");
    await click('[aria-label="Close Location tab"]');
    await click('[aria-label="Close Aircraft tab"]');
    expect(host.querySelector('[aria-label="Open right panel"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
  expect(disconnect).toHaveBeenCalledOnce();
});

it("folds tabs for a growing log and restores their homes without resurrecting closed tabs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const api: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  const logSize = async (width: number) => act(async () => {
    window.dispatchEvent(new CustomEvent<GameLogSizeChange>(GAME_LOG_SIZE_EVENT, { detail: { width, resized: true } }));
  });
  await act(async () => root.render(<WindowOverlay
    getViewState={() => null} setViewState={() => {}} overlayApiRef={api}
    additionalTabs={[{ id: "debug", label: "Debug" }]} renderAdditionalTab={() => <p>Debug</p>}
  />));
  try {
    await act(async () => api.current!.openOrSelectTab("debug"));
    await logSize(960);
    expect(document.documentElement.dataset.dockLayout).toBe("single");
    expect(host.querySelector('[data-side="left"]')).toBeNull();
    expect(host.querySelector('[data-side="right"] .foss-earth-tab-button')?.textContent).toBe("Debug");
    await logSize(860);
    expect(document.documentElement.dataset.dockLayout).toBe("dual");
    expect(document.documentElement.style.getPropertyValue("--foss-log-center")).toBe("640px");
    expect(host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Debug");
    await logSize(960);
    await act(async () => api.current!.toggleTab("debug"));
    await act(async () => api.current!.openOrSelectTab("debug"));
    await logSize(860);
    expect(host.querySelector('[aria-label="Open left panel"]')).not.toBeNull();
    expect(host.querySelector('[data-side="right"] .foss-earth-tab-button')?.textContent).toBe("Debug");
  } finally { await act(async () => root.unmount()); }
});

it("opens or selects a tab on the left when both slots fit, and on the right when they do not", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let width = 1200;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const overlayApiRef: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    additionalTabs={[{ id: "debug", label: "Debug" }]}
    renderAdditionalTab={() => <p>Debug panel</p>}
    overlayApiRef={overlayApiRef}
  />));
  try {
    expect(overlayApiRef.current).not.toBeNull();
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    const left = host.querySelector<HTMLElement>('[data-side="left"]')!;
    expect(left.querySelector(".foss-earth-tab-button")?.textContent).toBe("Debug");
    expect(document.documentElement.dataset.dockLayout).toBe("dual");
    expect(left.dataset.collapsed).toBe("false");
    await act(async () => left.querySelector<HTMLButtonElement>(".foss-earth-tab-button")!.click());
    expect(left.dataset.collapsed).toBe("true");
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    expect(left.dataset.collapsed).toBe("false");
    expect(left.querySelector(".foss-earth-tab-shell-selected .foss-earth-tab-button")?.textContent).toBe("Debug");
    width = 700;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[data-side="left"]')).toBeNull();
    expect(document.documentElement.dataset.dockLayout).toBe("single");
    const right = host.querySelector<HTMLElement>('[data-side="right"]')!;
    expect(right.querySelector(".foss-earth-tab-button")?.textContent).toBe("Debug");
    await act(async () => right.querySelector<HTMLButtonElement>('[aria-label="Close Debug tab"]')!.click());
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    expect(host.querySelector('[data-side="left"]')).toBeNull();
    expect(host.querySelector('[data-side="right"] .foss-earth-tab-button')?.textContent).toBe("Debug");
  } finally { await act(async () => root.unmount()); }
});

it("lets the host veto a tab close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const allowClose = vi.fn(() => false);
  const overlayApiRef: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    additionalTabs={[{ id: "debug", label: "Debug" }]}
    renderAdditionalTab={() => <p>Debug panel</p>}
    overlayApiRef={overlayApiRef}
    onBeforeCloseTab={allowClose}
  />));
  try {
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Debug tab"]')!.click());
    expect(allowClose).toHaveBeenCalledWith("debug");
    expect(host.querySelector(".foss-earth-tab-button")?.textContent).toBe("Debug");
    allowClose.mockReturnValueOnce(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Debug tab"]')!.click());
    expect(host.querySelector(".foss-earth-tab-button")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("toggles a tab for a toolbar button: shows it, then closes it once it is showing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const allowClose = vi.fn((): boolean | void => undefined);
  const overlayApiRef: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    additionalTabs={[{ id: "debug", label: "Debug" }]}
    renderAdditionalTab={() => <p>Debug panel</p>}
    overlayApiRef={overlayApiRef}
    onBeforeCloseTab={allowClose}
  />));
  const toggle = async (tabId: "location" | "debug") => act(async () => overlayApiRef.current!.toggleTab(tabId));
  const tabs = () => Array.from(host.querySelectorAll(".foss-earth-tab-button"), (button) => button.textContent);
  const selected = () => host.querySelector(".foss-earth-tab-shell-selected .foss-earth-tab-button")?.textContent;
  try {
    await toggle("location");
    expect(tabs()).toEqual(["Location"]);
    await toggle("debug");
    expect(tabs()).toEqual(["Location", "Debug"]);
    expect(selected()).toBe("Debug");

    // Open but behind another tab: the button brings it forward rather than closing it.
    await toggle("location");
    expect(tabs()).toEqual(["Location", "Debug"]);
    expect(selected()).toBe("Location");
    await toggle("location");
    expect(tabs()).toEqual(["Debug"]);
    expect(allowClose).toHaveBeenLastCalledWith("location");

    // A collapsed panel is not showing its tab either, so the button restores it.
    const left = host.querySelector<HTMLElement>('[data-side="left"]')!;
    await act(async () => left.querySelector<HTMLButtonElement>(".foss-earth-tab-button")!.click());
    expect(left.dataset.collapsed).toBe("true");
    await toggle("debug");
    expect(left.dataset.collapsed).toBe("false");
    expect(tabs()).toEqual(["Debug"]);

    allowClose.mockReturnValueOnce(false);
    await toggle("debug");
    expect(tabs()).toEqual(["Debug"]);
    await toggle("debug");
    expect(tabs()).toEqual([]);
  } finally { await act(async () => root.unmount()); }
});

it("adds Map and Renderer tabs showing the elements a host hands over", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const mapTab = document.createElement("div");
  mapTab.textContent = "Basemaps";
  const rendererTab = document.createElement("div");
  rendererTab.textContent = "Renderers";
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    mapTab={mapTab}
    rendererTab={rendererTab}
    overlayApiRef={overlayApiRef}
  />));
  try {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open right panel"]')!.click());
    expect(Array.from(host.querySelectorAll('[role="menuitem"]'), (item) => item.textContent))
      .toEqual(expect.arrayContaining(["Map", "Renderer"]));
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    expect(host.contains(mapTab)).toBe(true);
    await act(async () => overlayApiRef.current!.toggleTab("renderer"));
    expect(host.contains(rendererTab)).toBe(true);
    await act(async () => overlayApiRef.current!.toggleTab("renderer"));
    expect(rendererTab.isConnected).toBe(false);
    expect(host.contains(mapTab)).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

it("opens a panorama's tab on entering, hides the map's tabs meanwhile, and leaves the panorama when the tab closes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const element = (text: string) => Object.assign(document.createElement("div"), { textContent: text });
  const [mapTab, scenesTab, panoramaTab, settingsTab] = ["Basemaps", "Scenes list", "Photograph", "Looking"].map(element);
  let snapshot: PanoramaTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const leave = vi.fn();
  const panoramaTabs: PanoramaTabs = {
    panorama: panoramaTab, settings: settingsTab, leave, destroy() {},
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const enter = (title: string | null) => act(async () => { snapshot = { title, onScreen: title !== null }; for (const listener of listeners) listener(); });
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    mapTab={mapTab}
    scenesTab={scenesTab}
    panoramaTabs={panoramaTabs}
    overlayApiRef={overlayApiRef}
  />));
  const side = (name: "left" | "right") => Array.from(host.querySelectorAll(`[data-side="${name}"] .foss-earth-tab-button`), (button) => button.textContent);
  const selected = (name: "left" | "right") => host.querySelector(`[data-side="${name}"] .foss-earth-tab-shell-selected .foss-earth-tab-button`)?.textContent;
  const menu = async (name: "left" | "right") => {
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-side="${name}"] [aria-label="Open new tab"]`)!.click());
    const items = Array.from(host.querySelectorAll('[role="menuitem"]'), (item) => item.textContent);
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-side="${name}"] [aria-label="Open new tab"]`)!.click());
    return items;
  };
  try {
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    await act(async () => overlayApiRef.current!.toggleTab("location"));
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    expect(side("left")).toEqual(["Map", "Location"]);
    expect(selected("left")).toBe("Map");
    expect(await menu("left")).not.toContain("360 image settings");

    // Entering: the map's tabs go, the panorama's opens and shows.
    await enter("360: Northrop Mall");
    expect(side("left")).toEqual(["360: Northrop Mall"]);
    expect(host.contains(panoramaTab)).toBe(true);
    expect(await menu("left")).toEqual(expect.arrayContaining(["360 image settings", "Scenes"]));
    expect(await menu("left")).not.toEqual(expect.arrayContaining(["Map"]));
    expect(await menu("left")).not.toEqual(expect.arrayContaining(["Location"]));
    await act(async () => overlayApiRef.current!.openOrSelectTab("panorama-settings"));
    expect(side("left")).toEqual(["360: Northrop Mall", "360 image settings"]);

    // Following a link retitles the same tab.
    await enter("360: Walter Library");
    expect(side("left")).toEqual(["360: Walter Library", "360 image settings"]);

    // Escape: the panorama's tabs go and the map's come back where they were.
    await enter(null);
    expect(side("left")).toEqual(["Map", "Location"]);
    expect(selected("left")).toBe("Map");
    expect(leave).not.toHaveBeenCalled();

    // Entering again brings back 360 image settings too; closing the panorama's tab leaves it.
    await enter("360: Northrop Mall");
    expect(side("left")).toEqual(["360: Northrop Mall", "360 image settings"]);
    expect(selected("left")).toBe("360: Northrop Mall");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close 360: Northrop Mall tab"]')!.click());
    expect(leave).toHaveBeenCalledOnce();
    await enter(null);
    expect(side("left")).toEqual(["Map", "Location"]);
  } finally { await act(async () => root.unmount()); }
});

it("opens a panorama's tab minimized while the camera flies in, and shows it once the panorama is on screen", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const element = (text: string) => Object.assign(document.createElement("div"), { textContent: text });
  const [mapTab, scenesTab, panoramaTab, settingsTab] = ["Basemaps", "Scenes list", "Photograph", "Looking"].map(element);
  let snapshot: PanoramaTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const panoramaTabs: PanoramaTabs = {
    panorama: panoramaTab, settings: settingsTab, leave() {}, destroy() {},
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const show = (next: PanoramaTabsSnapshot) => act(async () => { snapshot = next; for (const listener of listeners) listener(); });
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    mapTab={mapTab}
    scenesTab={scenesTab}
    panoramaTabs={panoramaTabs}
    overlayApiRef={overlayApiRef}
  />));
  const left = () => host.querySelector<HTMLElement>('[data-side="left"]')!;
  const selected = () => host.querySelector('[data-side="left"] .foss-earth-tab-shell-selected .foss-earth-tab-button')?.textContent;
  const flying = { title: "360: Northrop Mall", onScreen: false };
  const inside = { title: "360: Northrop Mall", onScreen: true };
  const outside = { title: null, onScreen: false };
  try {
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    expect(left().dataset.collapsed).toBe("false");

    // Flying in: the tab is there and selected, its panel minimized; on screen, it shows.
    await show(flying);
    expect(selected()).toBe("360: Northrop Mall");
    expect(left().dataset.collapsed).toBe("true");
    await show(inside);
    expect(left().dataset.collapsed).toBe("false");
    // Following a link keeps it showing.
    await show({ title: "360: Walter Library", onScreen: true });
    expect(left().dataset.collapsed).toBe("false");
    await show(outside);
    expect(selected()).toBe("Map");
    expect(left().dataset.collapsed).toBe("false");

    // A flight cut short: the panel comes back as it was, not minimized.
    await show(flying);
    expect(left().dataset.collapsed).toBe("true");
    await show(outside);
    expect(selected()).toBe("Map");
    expect(left().dataset.collapsed).toBe("false");

    // Arriving in one step, with no flight: it shows at once.
    await show(inside);
    expect(left().dataset.collapsed).toBe("false");
    await show(outside);

    // What the person chose during the flight stands.
    await show(flying);
    await act(async () => overlayApiRef.current!.openOrSelectTab("scenes"));
    expect(selected()).toBe("Scenes");
    await show(inside);
    expect(selected()).toBe("Scenes");
    expect(left().dataset.collapsed).toBe("false");
  } finally { await act(async () => root.unmount()); }
});

it("comes back after a reload with the same tabs in the same windows, dropping tabs the app no longer offers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  type Tab = "aircraft" | "debug";
  const mount = async (tabs: readonly { id: Tab; label: string }[]) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
    await act(async () => root.render(<WindowOverlay<Tab>
      getViewState={() => ({ latDeg: 45, lonDeg: -93 })} setViewState={() => {}} overlayApiRef={api}
      additionalTabs={tabs} renderAdditionalTab={(tabId) => <p>{tabId}</p>}
    />));
    return { host, root, api };
  };
  const side = (host: HTMLElement, name: "left" | "right") => Array.from(host.querySelectorAll(`[data-side="${name}"] .foss-earth-tab-button`), (button) => button.textContent);
  const selected = (host: HTMLElement, name: "left" | "right") => host.querySelector(`[data-side="${name}"] .foss-earth-tab-shell-selected .foss-earth-tab-button`)?.textContent;

  const first = await mount([{ id: "aircraft", label: "Aircraft" }, { id: "debug", label: "Debug" }]);
  try {
    await act(async () => first.api.current!.openOrSelectTab("location"));
    await act(async () => first.api.current!.openOrSelectTab("debug"));
    await act(async () => first.host.querySelector<HTMLButtonElement>('[aria-label="Open right panel"]')!.click());
    const aircraft = Array.from(first.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === "Aircraft")!;
    await act(async () => aircraft.click());
    await act(async () => first.host.querySelector<HTMLButtonElement>('[data-side="right"] .foss-earth-tab-shell-selected .foss-earth-tab-button')!.click());
    expect(side(first.host, "left")).toEqual(["Location", "Debug"]);
    expect(selected(first.host, "left")).toBe("Debug");
    expect(side(first.host, "right")).toEqual(["Aircraft"]);
    expect(first.host.querySelector<HTMLElement>('[data-side="right"]')!.dataset.collapsed).toBe("true");
  } finally { await act(async () => first.root.unmount()); }

  // The reload: the same windows, the same tab showing, the right one still minimized.
  const second = await mount([{ id: "aircraft", label: "Aircraft" }, { id: "debug", label: "Debug" }]);
  try {
    expect(side(second.host, "left")).toEqual(["Location", "Debug"]);
    expect(selected(second.host, "left")).toBe("Debug");
    expect(side(second.host, "right")).toEqual(["Aircraft"]);
    expect(second.host.querySelector<HTMLElement>('[data-side="right"]')!.dataset.collapsed).toBe("true");
  } finally { await act(async () => second.root.unmount()); }

  // A version without Debug: its tab is gone and its window shows the one beside it.
  const third = await mount([{ id: "aircraft", label: "Aircraft" }]);
  try {
    expect(side(third.host, "left")).toEqual(["Location"]);
    expect(selected(third.host, "left")).toBe("Location");
    expect(side(third.host, "right")).toEqual(["Aircraft"]);
  } finally { await act(async () => third.root.unmount()); }
});

it("saves the layout a wide window on the globe would show, even while folded or inside a panorama", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const element = (text: string) => Object.assign(document.createElement("div"), { textContent: text });
  const [mapTab, panoramaTab, settingsTab] = ["Basemaps", "Photograph", "Looking"].map(element);
  let snapshot: PanoramaTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const panoramaTabs: PanoramaTabs = {
    panorama: panoramaTab, settings: settingsTab, leave() {}, destroy() {},
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const show = (next: PanoramaTabsSnapshot) => act(async () => { snapshot = next; for (const listener of listeners) listener(); });
  const mount = async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const api: { current: WindowOverlayHandle | null } = { current: null };
    await act(async () => root.render(<WindowOverlay
      getViewState={() => ({ latDeg: 45, lonDeg: -93 })} setViewState={() => {}}
      mapTab={mapTab} panoramaTabs={panoramaTabs} overlayApiRef={api}
    />));
    return { host, root, api };
  };
  const saved = () => JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!) as { primary: { tabs: string[]; activeTab: string | null }; secondary: { tabs: string[] } };

  const first = await mount();
  try {
    await act(async () => first.api.current!.openOrSelectTab("location"));
    await act(async () => first.api.current!.openOrSelectTab("map"));
    // A wide log folds both tabs onto the right; what is saved keeps them on the left.
    await act(async () => {
      window.dispatchEvent(new CustomEvent<GameLogSizeChange>(GAME_LOG_SIZE_EVENT, { detail: { width: 960, resized: true } }));
    });
    expect(first.host.querySelector('[data-side="left"]')).toBeNull();
    expect(saved().primary).toMatchObject({ tabs: ["location", "map"], activeTab: "map" });
    // Inside a panorama the map's tabs are hidden; what is saved still has them.
    await show({ title: "360: Northrop Mall", onScreen: true });
    expect(first.host.querySelector('[data-side="right"] .foss-earth-tab-button')?.textContent).toBe("360: Northrop Mall");
    expect(saved().primary).toMatchObject({ tabs: ["location", "map"], activeTab: "map" });
    expect(saved().secondary.tabs).toEqual([]);
  } finally { await act(async () => first.root.unmount()); }

  // The reload lands on the globe in a wide window.
  snapshot = { title: null, onScreen: false };
  const second = await mount();
  try {
    expect(Array.from(second.host.querySelectorAll('[data-side="left"] .foss-earth-tab-button'), (button) => button.textContent)).toEqual(["Location", "Map"]);
    expect(second.host.querySelector('[data-side="left"] .foss-earth-tab-shell-selected .foss-earth-tab-button')?.textContent).toBe("Map");
    expect(second.host.querySelector('[data-side="right"] .foss-earth-tab-button')).toBeNull();
  } finally { await act(async () => second.root.unmount()); }
});
