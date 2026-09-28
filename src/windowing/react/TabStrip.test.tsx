// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TabStrip } from "./TabStrip";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/**
 * The panel around a tab strip clips what passes its edges (overflow: hidden).
 * With many tabs the + button sits at the strip's right end, so a menu drawn
 * inside the panel was cut off there, and the globe or the panorama showed
 * where it should have been.
 */
it("draws the + menu outside the panel that clips it, fixed to the window where the button is", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 700);
  const layer = document.createElement("div");
  const panel = document.createElement("div");
  panel.style.overflow = "hidden";
  document.body.append(layer, panel);
  let buttonLeft = 300;
  vi.spyOn(HTMLButtonElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLButtonElement) {
    return this.classList.contains("foss-earth-tab-add")
      ? { left: buttonLeft, right: buttonLeft + 30, top: 12, bottom: 42, width: 30, height: 30, x: buttonLeft, y: 12, toJSON() {} } as DOMRect
      : new DOMRect();
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(150);
  const root = createRoot(panel);
  const render = (open: boolean) => act(async () => root.render(<TabStrip
    openTabs={["map", "scenes"]}
    activeTab="map"
    availableTabs={["location"]}
    addMenuOpen={open}
    onSelectTab={() => {}}
    onCloseTab={() => {}}
    onOpenTab={() => {}}
    onAddMenuOpenChange={() => {}}
    getLabel={(id) => id}
    menuContainer={layer}
  />));
  try {
    await render(true);
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(panel.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(layer);
    expect(menu.classList.contains("foss-earth-window-menu-floating")).toBe(true);
    expect(menu.style).toMatchObject({ position: "fixed", top: "12px", left: "300px", visibility: "" });

    // Near the window's right edge it ends at the button's right edge instead.
    await render(false);
    buttonLeft = 900;
    await render(true);
    const flipped = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(flipped.style.right).toBe("70px");
    expect(flipped.style.left).toBe("");
    expect(flipped.classList.contains("foss-earth-window-menu-align-right")).toBe(true);
  } finally { await act(async () => root.unmount()); }
});
