// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay";
import { GAME_LOG_SIZE_EVENT, type GameLogSizeChange } from "../log/createGameLog";

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
