import { getAppSettings } from "../../settings/appSettings";
import type { SettingsRegistry } from "../../settings/registry";
import { formatValue } from "../../settings/values";
import { createSettingsTransfer } from "./parameterList";

export interface SavedSettingsSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

/**
 * Everything saved on this device at once: the values this visit's URL set
 * (with "Keep these values", the only way they are saved), export, import and
 * reset of the whole record, and whether saving works in this browser.
 */
export function createSavedSettingsSection(settings: SettingsRegistry = getAppSettings()): SavedSettingsSectionHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-choices foss-earth-saved-settings";
  const session = document.createElement("div");
  session.className = "foss-earth-choices";
  const heading = document.createElement("div");
  heading.className = "foss-earth-choices__heading";
  heading.textContent = "From the URL for this visit";
  const list = document.createElement("p");
  list.className = "foss-earth-choices__note";
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "foss-earth-choice foss-earth-parameter__action";
  keep.textContent = "Keep these values";
  const kept = document.createElement("p");
  kept.className = "foss-earth-choices__note";
  kept.setAttribute("role", "status");
  kept.hidden = true;
  session.append(heading, list, keep, kept);
  const allHeading = document.createElement("div");
  allHeading.className = "foss-earth-choices__heading";
  allHeading.textContent = "Every saved value";
  const about = document.createElement("p");
  about.className = "foss-earth-choices__note";
  about.textContent = "Only values that differ from their defaults are saved, on this device. Keys and secrets are never exported.";
  const transfer = createSettingsTransfer(settings, {}, "all");
  const storage = document.createElement("p");
  storage.className = "foss-earth-choices__note";
  element.append(session, allHeading, about, transfer.element, storage);

  const update = (): void => {
    const ids = settings.sessionValueIds();
    session.hidden = ids.length === 0 && kept.hidden;
    list.textContent = ids.map(id => {
      const state = settings.inspect(id);
      return `${state.spec.label}: ${state.spec.sensitive ? "set" : formatValue(state.spec, state.value, state.choices)}`;
    }).join("; ");
    keep.hidden = ids.length === 0;
    const error = settings.getStorageError();
    storage.hidden = error === null;
    storage.textContent = error ?? "";
  };
  const onKeep = (): void => {
    const count = settings.sessionValueIds().length;
    const result = settings.keepSessionValues();
    kept.hidden = false;
    kept.textContent = result.ok ? `Saved ${count} ${count === 1 ? "value" : "values"}.` : result.reason;
    update();
  };
  keep.addEventListener("click", onKeep);
  const unsubscribe = settings.subscribe(() => update());
  update();
  return {
    element,
    destroy() {
      unsubscribe();
      keep.removeEventListener("click", onKeep);
      transfer.destroy();
      element.remove();
    },
  };
}
