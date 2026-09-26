import { getAppSettings } from "../../settings/appSettings";
import type { SettingsRegistry } from "../../settings/registry";
import type { ParameterSpec, SettingsFilter, SettingsPreset } from "../../settings/types";
import { formatValue } from "../../settings/values";

function paragraph(className: string, text = ""): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

function action(text: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "foss-earth-choice foss-earth-parameter__action";
  button.textContent = text;
  return button;
}

function inFilter(spec: ParameterSpec, filter: SettingsFilter): boolean {
  return (filter.tab === undefined || spec.home.tab === filter.tab)
    && (filter.section === undefined || spec.home.section === filter.section)
    && (filter.prefix === undefined || spec.id.startsWith(filter.prefix));
}

/** The parameters in `filter` a preset sets, or returns to their defaults, as the registry resolves `reset`. */
function presetParameters(settings: SettingsRegistry, preset: SettingsPreset, filter: SettingsFilter = {}): { set: ParameterSpec[]; reset: ParameterSpec[] } {
  const set: ParameterSpec[] = [];
  const reset: ParameterSpec[] = [];
  for (const spec of settings.list()) {
    if (!inFilter(spec, filter)) continue;
    if (spec.id in preset.values) set.push(spec);
    else if (!spec.sensitive && !spec.readOnly && !spec.session
      && (preset.reset ?? []).some(entry => (entry.endsWith(".") ? spec.id.startsWith(entry) : spec.id === entry))) reset.push(spec);
  }
  return { set, reset };
}

export interface PresetStatusHandle {
  element: HTMLElement;
  update(): void;
}

/**
 * "Matches Sharpest", or "Custom" once any value differs, for the parameters
 * in `filter`. Hidden where no preset has a value.
 */
export function createPresetStatus(settings: SettingsRegistry, filter: SettingsFilter): PresetStatusHandle {
  const element = paragraph("foss-earth-choices__note foss-earth-preset-status");
  element.setAttribute("role", "status");
  const update = (): void => {
    const relevant = settings.listPresets().some(preset => {
      const { set, reset } = presetParameters(settings, preset, filter);
      return set.length + reset.length > 0;
    });
    element.hidden = !relevant;
    if (!relevant) return;
    const match = settings.matchingPreset(filter);
    element.textContent = match ? `Matches ${match.name}` : "Custom";
  };
  update();
  return { element, update };
}

export interface SavePresetHandle {
  element: HTMLElement;
  destroy(): void;
}

/** Save as preset: the current values in `filter` under a name the user gives. */
export function createSavePresetControl(settings: SettingsRegistry, filter: SettingsFilter, what: string): SavePresetHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-choices foss-earth-preset-save";
  const open = action("Save as preset");
  const name = document.createElement("input");
  name.type = "text";
  name.className = "foss-earth-parameter__text";
  name.placeholder = "Preset name";
  name.setAttribute("aria-label", `Name for a preset of ${what}`);
  const save = action("Save");
  const cancel = action("Cancel");
  const status = paragraph("foss-earth-choices__note");
  status.setAttribute("role", "status");
  status.hidden = true;
  element.append(open, name, save, cancel, status);
  const editing = (on: boolean): void => {
    open.hidden = on;
    name.hidden = !on;
    save.hidden = !on;
    cancel.hidden = !on;
    if (on) { name.value = ""; name.focus(); }
  };
  editing(false);
  const onSave = (): void => {
    const text = name.value.trim();
    if (!text) { status.hidden = false; status.textContent = "Give the preset a name."; return; }
    const preset = settings.savePreset(text, filter);
    editing(false);
    status.hidden = false;
    status.textContent = `Saved ${Object.keys(preset.values).length} values of ${what} as “${preset.name}”, in Settings → Presets.`;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Enter") onSave();
    if (event.key === "Escape") editing(false);
  };
  const onOpen = (): void => { status.hidden = true; editing(true); };
  const onCancel = (): void => editing(false);
  open.addEventListener("click", onOpen);
  save.addEventListener("click", onSave);
  cancel.addEventListener("click", onCancel);
  name.addEventListener("keydown", onKey);
  return {
    element,
    destroy() {
      open.removeEventListener("click", onOpen);
      save.removeEventListener("click", onSave);
      cancel.removeEventListener("click", onCancel);
      name.removeEventListener("keydown", onKey);
      element.remove();
    },
  };
}

export interface PresetsSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

/**
 * Settings → Presets: whether every value matches a preset, and each preset,
 * built-in or saved, with everything it sets in full. Applying one lists every
 * value it changes, from and to, and asks once; its values are copied, so a
 * later edit makes them Custom and nothing follows the preset afterwards.
 * Saved presets can be renamed, exported and deleted.
 */
export function createPresetsSection(settings: SettingsRegistry = getAppSettings()): PresetsSectionHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-choices foss-earth-presets";
  const status = createPresetStatus(settings, {});
  const list = document.createElement("div");
  list.className = "foss-earth-presets__list";
  const saveAll = createSavePresetControl(settings, {}, "every setting");
  element.append(status.element, list, saveAll.element);

  const describeValue = (spec: ParameterSpec, value: Parameters<typeof formatValue>[1]): string =>
    spec.sensitive ? "set" : formatValue(spec, value, settings.inspect(spec.id).choices);

  const renderPreset = (preset: SettingsPreset): HTMLElement => {
    const block = document.createElement("div");
    block.className = "foss-earth-choices foss-earth-preset";
    block.dataset.preset = preset.id;
    const own = settings.isUserPreset(preset.id);
    const heading = document.createElement("div");
    heading.className = "foss-earth-choices__heading";
    heading.textContent = own ? `${preset.name} (yours)` : preset.name;
    const description = paragraph("foss-earth-choices__note", preset.description);

    // Everything it sets, in full.
    const values = document.createElement("details");
    values.className = "foss-earth-preset__values";
    const summary = document.createElement("summary");
    const { set, reset } = presetParameters(settings, preset);
    summary.textContent = `Its ${set.length + reset.length} values`;
    const items = document.createElement("ul");
    for (const spec of set) {
      const item = document.createElement("li");
      item.textContent = `${spec.label}: ${describeValue(spec, preset.values[spec.id])}`;
      items.append(item);
    }
    for (const spec of reset) {
      const item = document.createElement("li");
      item.textContent = `${spec.label}: its default, ${describeValue(spec, settings.inspect(spec.id).defaultValue)}`;
      items.append(item);
    }
    values.append(summary, items);

    const actions = document.createElement("div");
    actions.className = "foss-earth-choices";
    const apply = action("Apply…");
    actions.append(apply);
    const confirm = document.createElement("div");
    confirm.className = "foss-earth-choices foss-earth-preset__confirm";
    confirm.hidden = true;
    const done = paragraph("foss-earth-choices__note");
    done.setAttribute("role", "status");
    done.hidden = true;

    apply.addEventListener("click", () => {
      done.hidden = true;
      const diff = settings.diffPreset(preset);
      confirm.replaceChildren();
      confirm.hidden = false;
      if (diff.changes.length === 0) {
        confirm.append(paragraph("foss-earth-choices__note", "Every value already matches."));
      } else {
        confirm.append(paragraph("foss-earth-choices__note", `Applying ${preset.name} changes ${diff.changes.length} ${diff.changes.length === 1 ? "value" : "values"}:`));
        const changes = document.createElement("ul");
        changes.className = "foss-earth-preset__changes";
        for (const change of diff.changes) {
          const spec = settings.spec(change.id)!;
          const item = document.createElement("li");
          item.textContent = `${change.label}: ${describeValue(spec, change.from)} → ${describeValue(spec, change.to)}`;
          changes.append(item);
        }
        confirm.append(changes);
      }
      if (diff.rejected.length > 0) {
        confirm.append(paragraph("foss-earth-choices__note", `Left as they are: ${diff.rejected.map(entry => `${settings.spec(entry.id)?.label ?? entry.id} (${entry.reason})`).join("; ")}`));
      }
      const yes = action(diff.changes.length === 0 ? "Close" : "Apply these changes");
      const no = action("Cancel");
      if (diff.changes.length === 0) no.hidden = true;
      yes.addEventListener("click", () => {
        confirm.hidden = true;
        if (diff.changes.length === 0) return;
        const result = settings.applyPreset(preset);
        done.hidden = false;
        done.textContent = `Applied ${preset.name}: ${result.applied.length} ${result.applied.length === 1 ? "value" : "values"} copied. Editing any of them makes them Custom.`;
      });
      no.addEventListener("click", () => { confirm.hidden = true; });
      confirm.append(yes, no);
    });

    if (own) {
      const rename = action("Rename");
      const field = document.createElement("input");
      field.type = "text";
      field.className = "foss-earth-parameter__text";
      field.setAttribute("aria-label", `New name for ${preset.name}`);
      field.hidden = true;
      rename.addEventListener("click", () => {
        if (field.hidden) { field.hidden = false; field.value = preset.name; field.focus(); return; }
        if (settings.renamePreset(preset.id, field.value)) render();
      });
      field.addEventListener("keydown", event => {
        if (event.key === "Enter" && settings.renamePreset(preset.id, field.value)) render();
        if (event.key === "Escape") field.hidden = true;
      });
      const exported = document.createElement("a");
      exported.className = "foss-earth-choice foss-earth-parameter__action";
      exported.textContent = "Export";
      const { id, name, description } = preset;
      exported.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ id, name, description, values: preset.values }, null, 2))}`;
      exported.download = `foss-earth-preset-${id.replace(/^user:/, "")}.json`;
      const remove = action("Delete");
      remove.addEventListener("click", () => {
        if (remove.dataset.confirm !== "1") { remove.dataset.confirm = "1"; remove.textContent = `Delete ${preset.name}?`; return; }
        if (settings.deletePreset(preset.id)) render();
      });
      actions.append(rename, field, exported, remove);
    }
    block.append(heading, description, values, actions, confirm, done);
    return block;
  };

  let signature = "";
  const render = (): void => {
    const presets = settings.listPresets();
    signature = presets.map(preset => `${preset.id}=${preset.name}`).join("|");
    list.replaceChildren(...presets.map(renderPreset));
    status.update();
  };
  render();
  const unsubscribe = settings.subscribe(() => {
    const next = settings.listPresets().map(preset => `${preset.id}=${preset.name}`).join("|");
    if (next !== signature) render();
    else status.update();
  });
  return {
    element,
    destroy() {
      unsubscribe();
      saveAll.destroy();
      element.remove();
    },
  };
}
