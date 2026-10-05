import type { SettingsRegistry } from "../../settings/registry";
import { createParameterControl, type ParameterControlHandle } from "./controls";

const THEME_ID = "interface.theme";

/** Light and dark icon choices in the theme's home, Interface → Toolbar. */
export function createThemeControl(settings: SettingsRegistry): ParameterControlHandle {
  const control = createParameterControl(settings, THEME_ID);
  control.element.classList.add("foss-earth-theme-control");
  const update = (): void => {
    control.update();
    for (const input of control.element.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const text = input.nextElementSibling;
      if (!text || text.querySelector(".foss-earth-theme-control__icon")) continue;
      const icon = document.createElement("span");
      icon.className = "foss-earth-theme-control__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = input.value === "light" ? "\u263C" : "\u263E";
      text.prepend(icon, " ");
    }
  };
  update();
  const stopWatching = settings.subscribe(changed => { if (changed.has(THEME_ID)) update(); });
  return {
    element: control.element,
    update,
    destroy() {
      stopWatching();
      control.destroy();
    },
  };
}
