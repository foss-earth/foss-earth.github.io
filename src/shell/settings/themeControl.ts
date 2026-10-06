import type { SettingsRegistry } from "../../settings/registry";
import { createParameterControl, type ParameterControlHandle } from "./controls";

const THEME_ID = "interface.theme";

/** A sun/moon slider in the theme's home, Interface → Toolbar. */
export function createThemeControl(settings: SettingsRegistry): ParameterControlHandle {
  const control = createParameterControl(settings, THEME_ID);
  control.element.classList.add("foss-earth-theme-control");
  const update = (): void => { control.update(); };
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
