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

/**
 * Escape closed nothing: the + menu stayed open until a click elsewhere. It
 * now closes the menu and nothing else, so a panorama behind it is not left
 * and no key binding reads the key, and focus goes back to the + button.
 */
it("closes the + menu on Escape, and the key goes no further", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const panel = document.createElement("div");
  document.body.append(panel);
  const onAddMenuOpenChange = vi.fn();
  const behind = vi.fn();
  window.addEventListener("keydown", behind);
  const root = createRoot(panel);
  try {
    await act(async () => root.render(<TabStrip
      openTabs={["map"]}
      activeTab="map"
      availableTabs={["location", "scenes"]}
      addMenuOpen
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onOpenTab={() => {}}
      onAddMenuOpenChange={onAddMenuOpenChange}
      getLabel={(id) => id}
    />));
    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    item.focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    item.dispatchEvent(escape);
    expect(onAddMenuOpenChange).toHaveBeenCalledWith(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(panel.querySelector(".foss-earth-tab-add"));

    // Other keys are the menu's to ignore, as before.
    onAddMenuOpenChange.mockClear();
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(onAddMenuOpenChange).not.toHaveBeenCalled();
    expect(behind).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("keydown", behind);
    await act(async () => root.unmount());
  }
});
