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
  const choice = (theme: string) => control.element.querySelector<HTMLInputElement>(`input[value="${theme}"]`)!;
  return { settings, control, choice };
}

describe("Interface theme control", () => {
  it("shows both labeled icons and changes the same setting as the toolbar", () => {
    const { settings, control, choice } = setup();
    expect([...control.element.querySelectorAll(".foss-earth-theme-control__icon")].map(icon => [icon.textContent, icon.getAttribute("aria-hidden")]))
      .toEqual([["\u263E", "true"], ["\u263C", "true"]]);
    expect(control.element.textContent).toContain("Dark");
    expect(control.element.textContent).toContain("Light");
    expect(choice("dark").checked).toBe(true);
    choice("light").click();
    expect(settings.get("interface.theme")).toBe("light");
    expect(choice("light").checked).toBe(true);
    settings.set("interface.theme", "dark");
    expect(choice("dark").checked).toBe(true);
    expect(choice("light").checked).toBe(false);
    control.destroy();
  });

  it("respects a host-forced theme and follows it when released", () => {
    const { settings, control, choice } = setup();
    const releaseCurrent = settings.force("interface.theme", "dark", "keep the current theme");
    expect(choice("dark").disabled).toBe(true);
    expect(control.element.textContent).toContain("Set by the app: keep the current theme.");
    releaseCurrent();
    expect(choice("dark").disabled).toBe(false);
    const release = settings.force("interface.theme", "light", "the host needs it");
    expect(choice("light").checked).toBe(true);
    expect(choice("dark").disabled).toBe(true);
    expect(control.element.textContent).toContain("Set by the app: the host needs it.");
    release();
    expect(choice("dark").disabled).toBe(false);
    expect(choice("dark").checked).toBe(true);
    control.destroy();
    settings.set("interface.theme", "light");
    expect(choice("dark").checked).toBe(true);
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
});
