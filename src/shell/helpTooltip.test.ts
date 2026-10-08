// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHelpTooltip, closeHelpTooltipWithin, type HelpTooltipHandle } from "./helpTooltip";
import { createParameterControl, type ParameterControlHandle } from "./settings/controls";
import { createSettingsRegistry } from "../settings/registry";

const handles: (HelpTooltipHandle | ParameterControlHandle)[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function help(label = "Terrain observation help", onOpen?: () => void): HelpTooltipHandle {
  const content = document.createElement("div");
  content.textContent = "The range is an observation, with its source and meaning.";
  const tooltip = createHelpTooltip({ label, content, onOpen });
  handles.push(tooltip); document.body.append(tooltip.element); return tooltip;
}

describe("help tooltip", () => {
  it("opens only on click, exposes accessible text, and closes on click, Escape or outside without taking unrelated keys", () => {
    const opened = vi.fn(), tooltip = help("Terrain observation help", opened);
    expect(tooltip.button.getAttribute("aria-label")).toBe("Terrain observation help");
    expect(tooltip.content.hidden).toBe(true);
    tooltip.button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(tooltip.content.hidden).toBe(true);
    tooltip.button.focus(); tooltip.button.click();
    expect(opened).toHaveBeenCalledOnce();
    expect(tooltip.content.hidden).toBe(false);
    expect(tooltip.content.getAttribute("role")).toBe("tooltip");
    expect(tooltip.button.getAttribute("aria-expanded")).toBe("true");
    expect(tooltip.button.getAttribute("aria-describedby")).toBe(tooltip.content.id);
    expect(document.activeElement).toBe(tooltip.button);
    const unused = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    tooltip.button.dispatchEvent(unused);
    expect(unused.defaultPrevented).toBe(false);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    tooltip.button.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(tooltip.content.hidden).toBe(true);
    expect(tooltip.button.getAttribute("aria-expanded")).toBe("false");
    expect(tooltip.button.hasAttribute("aria-describedby")).toBe(false);
    tooltip.button.click(); tooltip.button.click();
    expect(tooltip.content.hidden).toBe(true);
    tooltip.open(); tooltip.content.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(tooltip.content.hidden).toBe(false);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(tooltip.content.hidden).toBe(true);
  });

  it("shares the single open explanation with parameter controls", () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register([{ id: "test.flag", label: "Flag", description: "A switch.", unit: "none", kind: "boolean", default: false,
      defaultReason: "Test only.", home: { tab: "map", section: "loading", level: "main" }, appliesLive: true, source: "src/test.ts" }]);
    const parameter = createParameterControl(settings, "test.flag");
    handles.push(parameter); document.body.append(parameter.element);
    const button = parameter.element.querySelector<HTMLButtonElement>('[aria-label="Explain Flag"]')!;
    const content = parameter.element.querySelector<HTMLElement>('[role="tooltip"]')!;
    const tooltip = help();
    button.click(); expect(content.hidden).toBe(false);
    tooltip.open(); expect(content.hidden).toBe(true); expect(tooltip.content.hidden).toBe(false);
    button.click(); expect(content.hidden).toBe(false); expect(tooltip.content.hidden).toBe(true);
  });

  it("closes an explanation within a collapsing panel by its trigger, without closing another panel's explanation", () => {
    const first = help("First panel explanation"), second = help("Second panel explanation");
    const firstPanel = document.createElement("section"), secondPanel = document.createElement("section");
    firstPanel.append(first.element); secondPanel.append(second.element);
    document.body.append(firstPanel, secondPanel);
    first.open();
    expect(first.content.parentElement).toBe(document.body);
    closeHelpTooltipWithin(secondPanel);
    expect(first.content.hidden).toBe(false);
    closeHelpTooltipWithin(firstPanel);
    expect(first.content.hidden).toBe(true);
    expect(first.button.getAttribute("aria-expanded")).toBe("false");
    expect(first.content.parentElement).toBe(first.element);
    second.open();
    closeHelpTooltipWithin(firstPanel);
    expect(second.content.hidden).toBe(false);
    secondPanel.remove(); closeHelpTooltipWithin(secondPanel);
    expect(second.content.hidden).toBe(true);
    expect(document.body.contains(second.content)).toBe(false);
  });

  it("restores moved content to its exact home beyond clipped panels and disposes an open tooltip safely", () => {
    const tooltip = help();
    const panel = document.createElement("div");
    panel.style.overflow = "hidden";
    const before = document.createElement("span"), after = document.createElement("span");
    panel.append(tooltip.button, before, tooltip.content, after);
    document.body.append(panel);
    tooltip.open();
    expect(tooltip.content.parentElement).toBe(document.body);
    expect(panel.contains(tooltip.content)).toBe(false);
    tooltip.close();
    expect([...panel.children]).toEqual([tooltip.button, before, tooltip.content, after]);
    tooltip.open(); tooltip.destroy();
    expect(tooltip.content.isConnected).toBe(false);
    expect(document.getElementById(tooltip.content.id)).toBeNull();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    tooltip.open(); tooltip.button.click();
    expect(tooltip.content.isConnected).toBe(false);
  });

  it("clamps to the visible viewport and repositions for its scroll and resize", () => {
    const tooltip = help();
    const viewport = new EventTarget() as EventTarget & { offsetLeft: number; offsetTop: number; width: number; height: number };
    Object.assign(viewport, { offsetLeft: 20, offsetTop: 30, width: 200, height: 160 });
    vi.stubGlobal("visualViewport", viewport);
    vi.spyOn(tooltip.button, "getBoundingClientRect").mockReturnValue({ left: 190, bottom: 175 } as DOMRect);
    vi.spyOn(tooltip.content, "getBoundingClientRect").mockReturnValue({ width: 120, height: 90 } as DOMRect);
    tooltip.open();
    expect(tooltip.content.style.maxWidth).toBe("184px");
    expect(tooltip.content.style.maxHeight).toBe("144px");
    expect(tooltip.content.style.left).toBe("92px");
    expect(tooltip.content.style.top).toBe("92px");
    viewport.offsetLeft = 40; viewport.dispatchEvent(new Event("scroll"));
    expect(tooltip.content.style.left).toBe("112px");
    viewport.height = 200; viewport.dispatchEvent(new Event("resize"));
    expect(tooltip.content.style.maxHeight).toBe("184px");
    expect(tooltip.content.style.top).toBe("132px");
  });
});
