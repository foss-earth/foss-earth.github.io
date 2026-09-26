import type { SettingsRegistry } from "../../settings/registry";
import type { ParameterState, SettingsFilter } from "../../settings/types";
import { formatValue } from "../../settings/values";
import { createExternalLinkIcon } from "../externalLinkIcon";
import { createParameterControl, describeProvenance, sentence, type ParameterControlHandle } from "./controls";

export interface ParameterListHandle {
  element: HTMLElement;
  update(changed?: ReadonlySet<string>): void;
  destroy(): void;
}

function defaultText(state: ParameterState): string {
  const value = state.spec.sensitive ? (state.defaultValue ? "set" : "none") : formatValue(state.spec, state.defaultValue, state.choices);
  return sentence(`Default ${value}: ${state.defaultDerivedFrom}`);
}

interface Row {
  element: HTMLElement;
  control: ParameterControlHandle;
  meta: HTMLElement;
  reset: HTMLButtonElement;
  update(): void;
}

function createRow(settings: SettingsRegistry, id: string): Row {
  const spec = settings.spec(id)!;
  const element = document.createElement("div");
  element.className = "foss-earth-parameter-row";
  element.dataset.parameter = id;
  const control = createParameterControl(settings, id);
  const description = document.createElement("p");
  description.className = "foss-earth-parameter-row__description";
  description.textContent = spec.description;
  const meta = document.createElement("p");
  meta.className = "foss-earth-parameter-row__meta";
  const actions = document.createElement("div");
  actions.className = "foss-earth-parameter-row__actions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "foss-earth-choice foss-earth-parameter__action";
  reset.textContent = "Reset";
  reset.setAttribute("aria-label", `Reset ${spec.label}`);
  const onReset = (): void => { settings.reset(id); };
  reset.addEventListener("click", onReset);
  actions.append(reset);
  const url = settings.sourceUrl(id);
  const path = document.createElement(url ? "a" : "span");
  path.className = "foss-earth-parameter-row__source";
  path.textContent = spec.source;
  if (path instanceof HTMLAnchorElement && url) {
    path.href = url;
    path.target = "_blank";
    path.rel = "noopener noreferrer";
    path.title = `The code that reads ${id}. Opens in a new tab.`;
    path.append(createExternalLinkIcon());
  }
  actions.append(path);
  const code = document.createElement("code");
  code.className = "foss-earth-parameter-row__id";
  code.textContent = id;
  actions.append(code);
  element.append(control.element, description, meta, actions);
  const update = (): void => {
    const state = settings.inspect(id);
    control.update();
    const value = spec.sensitive ? (state.value ? "set" : "not set") : formatValue(spec, state.value, state.choices);
    meta.textContent = `Now ${value} (${describeProvenance(state)}). ${defaultText(state)}${spec.appliesLive ? "" : " Applies on the next start."}`;
    const resettable = state.layers.saved !== undefined || state.layers.url !== undefined;
    reset.disabled = !resettable;
  };
  update();
  return {
    element,
    control,
    meta,
    reset,
    update,
  };
}

/**
 * Every parameter of a section: its control, value, unit, default and what
 * that was derived from, where the value came from, a reset, and a link to the
 * code that reads it. Nothing is reachable only through the URL or the console.
 */
export function createParameterList(settings: SettingsRegistry, filter: SettingsFilter): ParameterListHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter-list";
  const rows = new Map<string, Row>();
  const sync = (): void => {
    const ids = settings.list(filter).map(spec => spec.id);
    for (const [id, row] of rows) {
      if (!ids.includes(id)) { row.control.destroy(); row.element.remove(); rows.delete(id); }
    }
    let previous: HTMLElement | null = null;
    for (const id of ids) {
      let row = rows.get(id);
      if (!row) {
        row = createRow(settings, id);
        rows.set(id, row);
      }
      if (row.element.previousElementSibling !== previous || row.element.parentElement !== element) {
        if (previous) previous.after(row.element); else element.prepend(row.element);
      }
      previous = row.element;
    }
  };
  sync();
  return {
    element,
    update(changed) {
      if (changed && [...changed].some(id => !rows.has(id) && settings.spec(id) && settings.list(filter).some(spec => spec.id === id))) sync();
      for (const [id, row] of rows) if (!changed || changed.has(id)) row.update();
    },
    destroy() {
      for (const row of rows.values()) row.control.destroy();
      rows.clear();
      element.remove();
    },
  };
}

export interface SettingsTransferHandle {
  element: HTMLElement;
  destroy(): void;
}

/**
 * Export, import and reset for a set of parameters: JSON the user can copy or
 * save, and a paste box that applies the valid entries and lists the rest.
 */
export function createSettingsTransfer(settings: SettingsRegistry, filter: SettingsFilter, name: string): SettingsTransferHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-choices foss-earth-settings-transfer";
  const button = (text: string): HTMLButtonElement => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "foss-earth-choice foss-earth-parameter__action";
    item.textContent = text;
    return item;
  };
  const exportButton = button("Export");
  const importButton = button("Import");
  const resetButton = button("Reset all");
  const panel = document.createElement("div");
  panel.className = "foss-earth-settings-transfer__panel";
  panel.hidden = true;
  const text = document.createElement("textarea");
  text.className = "foss-earth-settings-transfer__text";
  text.rows = 6;
  text.spellcheck = false;
  const panelActions = document.createElement("div");
  panelActions.className = "foss-earth-choices";
  const copy = button("Copy");
  const download = document.createElement("a");
  download.className = "foss-earth-choice foss-earth-parameter__action";
  download.textContent = "Save as a file";
  const apply = button("Apply");
  const close = button("Close");
  panelActions.append(copy, download, apply, close);
  const result = document.createElement("p");
  result.className = "foss-earth-choices__note";
  result.setAttribute("role", "status");
  result.hidden = true;
  panel.append(text, panelActions, result);
  element.append(exportButton, importButton, resetButton, panel);

  let confirmReset = false;
  const show = (mode: "export" | "import"): void => {
    panel.hidden = false;
    panel.dataset.mode = mode;
    result.hidden = true;
    copy.hidden = mode !== "export";
    download.hidden = mode !== "export";
    apply.hidden = mode !== "import";
    text.readOnly = mode === "export";
    if (mode === "export") {
      const json = JSON.stringify(settings.export(filter), null, 2);
      text.value = json;
      download.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
      download.download = `foss-earth-settings-${name}.json`;
    } else {
      text.value = "";
      text.placeholder = "Paste exported settings here.";
    }
  };
  const onExport = (): void => show("export");
  const onImport = (): void => show("import");
  const onApply = (): void => {
    const outcome = settings.import(text.value);
    const lines = [`Applied ${outcome.applied.length} ${outcome.applied.length === 1 ? "value" : "values"}.`];
    for (const rejection of outcome.rejected) lines.push(`${rejection.id || "The file"}: ${rejection.reason}`);
    result.textContent = lines.join(" ");
    result.hidden = false;
  };
  const onCopy = (): void => {
    void navigator.clipboard?.writeText(text.value).then(
      () => { result.textContent = "Copied."; result.hidden = false; },
      () => { text.select(); result.textContent = "Select the text and copy it."; result.hidden = false; },
    );
  };
  const onClose = (): void => { panel.hidden = true; };
  const onReset = (): void => {
    if (!confirmReset) {
      confirmReset = true;
      resetButton.textContent = "Reset every value here to its default?";
      return;
    }
    confirmReset = false;
    resetButton.textContent = "Reset all";
    settings.resetAll(filter);
  };
  const onResetBlur = (): void => {
    confirmReset = false;
    resetButton.textContent = "Reset all";
  };
  exportButton.addEventListener("click", onExport);
  importButton.addEventListener("click", onImport);
  apply.addEventListener("click", onApply);
  copy.addEventListener("click", onCopy);
  close.addEventListener("click", onClose);
  resetButton.addEventListener("click", onReset);
  resetButton.addEventListener("blur", onResetBlur);
  return {
    element,
    destroy() {
      exportButton.removeEventListener("click", onExport);
      importButton.removeEventListener("click", onImport);
      apply.removeEventListener("click", onApply);
      copy.removeEventListener("click", onCopy);
      close.removeEventListener("click", onClose);
      resetButton.removeEventListener("click", onReset);
      resetButton.removeEventListener("blur", onResetBlur);
      element.remove();
    },
  };
}
