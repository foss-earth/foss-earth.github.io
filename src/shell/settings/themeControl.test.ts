// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { INTERFACE_PARAMETERS } from "../../settings/catalogue/interface";
import { createSettingsRegistry } from "../../settings/registry";
import { createParameterSection } from "./parameterSection";
import { createThemeControl } from "./themeControl";

afterEach(() => document.body.replaceChildren());

function setup() {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(INTERFACE_PARAMETERS);
  const control = createThemeControl(settings);
  document.body.append(control.element);
  const slider = control.element.querySelector<HTMLInputElement>('input[type="range"]')!;
  const choose = (theme: "light" | "dark") => {
    slider.value = theme === "light" ? "0" : "1";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return { settings, control, slider, choose };
}

describe("Interface theme control", () => {
  it("shows one sun/moon slider and changes the same setting as the toolbar", () => {
    const { settings, control, slider, choose } = setup();
    expect([...control.element.querySelectorAll<HTMLElement>(".foss-earth-two-position-slider__option")].map(icon => [icon.textContent, icon.title, icon.getAttribute("aria-hidden")]))
      .toEqual([["\u263C", "Light", "true"], ["\u263E", "Dark", "true"]]);
    expect(control.element.querySelectorAll('input[type="radio"], input[type="checkbox"]')).toHaveLength(0);
    expect(control.element.getAttribute("role")).toBe("group");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("1");
    expect(slider.step).toBe("1");
    expect(slider.getAttribute("aria-label")).toBe("Theme");
    expect(slider.value).toBe("1");
    expect(slider.getAttribute("aria-valuetext")).toBe("Dark");
    choose("light");
    expect(settings.get("interface.theme")).toBe("light");
    expect(slider.value).toBe("0");
    expect(slider.getAttribute("aria-valuetext")).toBe("Light");
    settings.set("interface.theme", "dark");
    expect(slider.value).toBe("1");
    expect(slider.getAttribute("aria-valuetext")).toBe("Dark");
    control.destroy();
  });

  it("respects a host-forced theme and follows it when released", () => {
    const { settings, control, slider, choose } = setup();
    const releaseCurrent = settings.force("interface.theme", "dark", "keep the current theme");
    expect(slider.disabled).toBe(true);
    expect(control.element.textContent).toContain("Set by the app: keep the current theme.");
    choose("light");
    expect(settings.get("interface.theme")).toBe("dark");
    releaseCurrent();
    expect(slider.disabled).toBe(false);
    const release = settings.force("interface.theme", "light", "the host needs it");
    expect(slider.value).toBe("0");
    expect(slider.disabled).toBe(true);
    expect(control.element.textContent).toContain("Set by the app: the host needs it.");
    release();
    expect(slider.disabled).toBe(false);
    expect(slider.value).toBe("1");
    control.destroy();
    settings.set("interface.theme", "light");
    expect(slider.value).toBe("1");
    choose("dark");
    expect(settings.get("interface.theme")).toBe("light");
  });

  it("has one visible home in the Interface toolbar section", () => {
    const { settings, control } = setup();
    const section = createParameterSection(settings, {
      tab: "interface",
      section: "toolbar",
      main: control.element,
      covers: ["interface.theme"],
    });
    document.body.append(section.element);
    expect(section.element.querySelectorAll('[data-parameter="interface.theme"]')).toHaveLength(1);
    section.destroy();
    control.destroy();
  });

  it("keeps the same icon slider under Show all parameters", () => {
    const { settings, control, slider } = setup();
    const section = createParameterSection(settings, {
      tab: "interface",
      section: "toolbar",
      main: control.element,
      covers: ["interface.theme"],
    });
    document.body.append(section.element);
    const showAll = section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!;
    if (!showAll.checked) showAll.click();
    const expandedTheme = section.element.querySelector<HTMLElement>('.foss-earth-parameter-list [data-parameter="interface.theme"]')!;
    expect(expandedTheme.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(expandedTheme.querySelectorAll('input[type="radio"], input[type="checkbox"]')).toHaveLength(0);
    expect([...expandedTheme.querySelectorAll(".foss-earth-two-position-slider__option")].map(option => option.textContent))
      .toEqual(["\u263C", "\u263E"]);
    const expandedSlider = expandedTheme.querySelector<HTMLInputElement>('input[type="range"]')!;
    expandedSlider.value = "0";
    expandedSlider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(settings.get("interface.theme")).toBe("light");
    expect(slider.value).toBe("0");
    settings.set("interface.theme", "dark");
    expect(slider.value).toBe("1");
    expect(expandedSlider.value).toBe("1");
    section.destroy();
    control.destroy();
  });
});
