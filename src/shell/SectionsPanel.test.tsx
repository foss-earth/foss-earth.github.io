// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionsPanel, type PanelSection } from "./SectionsPanel";
import { PANEL_SECTIONS_OPEN_STORAGE_KEY } from "./panelSectionsOpen";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const section = (id: string) => host.querySelector<HTMLDetailsElement>(`details[data-section="${id}"]`)!;

async function toggle(details: HTMLDetailsElement): Promise<void> {
  await act(async () => {
    details.open = !details.open;
    details.dispatchEvent(new Event("toggle"));
  });
}

describe("SectionsPanel", () => {
  it("starts sections at their default and remembers what the user opened or closed", async () => {
    const sections: PanelSection[] = [
      { id: "input-method", title: "Input method", defaultOpen: true, render: () => <p>Modes</p> },
      { id: "camera", title: "Camera", render: () => <p>Camera settings</p> },
    ];
    await act(async () => root.render(<SectionsPanel sections={sections} />));
    expect(section("input-method").open).toBe(true);
    expect(section("camera").open).toBe(false);
    expect(section("camera").querySelector("summary")?.textContent).toBe("Camera");

    await toggle(section("camera"));
    await toggle(section("input-method"));
    expect(JSON.parse(window.localStorage.getItem(PANEL_SECTIONS_OPEN_STORAGE_KEY)!)).toEqual({ camera: true, "input-method": false });

    await act(async () => root.render(<></>));
    await act(async () => root.render(<SectionsPanel sections={sections} />));
    expect(section("camera").open).toBe(true);
    expect(section("input-method").open).toBe(false);
  });

  it("adopts a host's wired element and gives it back intact when the tab closes", async () => {
    const element = document.createElement("div");
    const input = document.createElement("input");
    input.type = "checkbox";
    const onChange = vi.fn();
    input.addEventListener("change", onChange);
    element.append(input);
    const sections: PanelSection[] = [{ id: "toolbar", title: "Toolbar", element }];

    await act(async () => root.render(<SectionsPanel sections={sections} />));
    expect(section("toolbar").contains(input)).toBe(true);

    await act(async () => root.render(<></>));
    expect(element.isConnected).toBe(false);

    await act(async () => root.render(<SectionsPanel sections={sections} />));
    expect(section("toolbar").contains(input)).toBe(true);
    input.click();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("falls back to each section's default where storage is refused", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("private browsing"); },
      setItem: () => { throw new Error("private browsing"); },
      removeItem: () => { throw new Error("private browsing"); },
    });
    await act(async () => root.render(<SectionsPanel sections={[{ id: "camera", title: "Camera", render: () => null }]} />));
    expect(section("camera").open).toBe(false);
    await toggle(section("camera"));
    expect(section("camera").open).toBe(true);
  });
});

describe("WindowOverlay section tabs", () => {
  type HostTab = "controls" | "settings" | "aircraft";
  const overlay = (props: Partial<Parameters<typeof WindowOverlay<HostTab>>[0]> = {}) => (
    <WindowOverlay<HostTab>
      getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
      setViewState={vi.fn()}
      {...props}
    />
  );

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 1200);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });

  it("offers Controls and Settings from + and opens either from the handle", async () => {
    const api: { current: WindowOverlayHandle<HostTab> | null } = { current: null };
    await act(async () => root.render(overlay({
      controlsSections: [{ id: "input-method", title: "Input method", defaultOpen: true, render: () => <p>Modes</p> }],
      settingsSections: [{ id: "camera", title: "Camera", render: () => <p>Camera settings</p> }],
      overlayApiRef: api,
    })));

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open right panel"]')!.click());
    const labels = Array.from(host.querySelectorAll('[role="menuitem"]'), (item) => item.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Controls", "Settings"]));

    await act(async () => api.current!.openOrSelectTab("controls"));
    expect(host.querySelector('details[data-section="input-method"]')?.textContent).toContain("Modes");
    await act(async () => api.current!.openOrSelectTab("settings"));
    expect(host.querySelector('details[data-section="camera"] summary')?.textContent).toBe("Camera");
  });

  it("leaves a host's own controls and settings tabs alone when it passes no sections", async () => {
    const api: { current: WindowOverlayHandle<HostTab> | null } = { current: null };
    await act(async () => root.render(overlay({
      additionalTabs: [{ id: "controls", label: "Controls" }, { id: "settings", label: "Settings" }],
      renderAdditionalTab: (id) => <p>Host {id}</p>,
      overlayApiRef: api,
    })));

    await act(async () => api.current!.openOrSelectTab("controls"));
    expect(host.textContent).toContain("Host controls");
    expect(host.querySelector(".foss-earth-panel-sections")).toBeNull();
  });
});
