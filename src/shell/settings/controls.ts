import type { SettingsRegistry } from "../../settings/registry";
import type { NumberRange, ParameterSpec, ParameterState, ParameterValue } from "../../settings/types";
import { formatNumber, formatQuantity, formatValue, isNumberRange, sameValue } from "../../settings/values";
import { createTrack, type TrackHandle } from "./track";

export interface ParameterControlHandle {
  /** The control and its note. Controls that take a whole line say so with their class. */
  element: HTMLElement;
  /** Re-reads the registry. Cheap when nothing changed. */
  update(): void;
  destroy(): void;
}

let controlCount = 0;

/** A position on a parameter's track: the value, or its log2, negated for a reversed track. */
export function trackPosition(spec: ParameterSpec, value: number): number {
  const position = spec.scale === "log2" ? Math.log2(Math.max(value, Number.MIN_VALUE)) : value;
  return spec.track?.reversed ? -position : position;
}

/** The value at a track position, rounded to what the control can show. */
export function valueAtTrackPosition(spec: ParameterSpec, position: number, bounds: NumberRange | null): number {
  const raw = spec.track?.reversed ? -position : position;
  let value: number;
  if (spec.scale === "log2") {
    value = 2 ** raw;
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 3;
    value = Math.round(value * 10 ** digits) / 10 ** digits;
  } else {
    const step = spec.step ?? (spec.unit === "count" ? 1 : 0);
    value = step > 0 ? Math.round(raw / step) * step : raw;
    value = Math.round(value * 1e6) / 1e6;
  }
  if (spec.unit === "count") value = Math.round(value);
  if (bounds) value = Math.max(bounds.min, Math.min(bounds.max, value));
  return Object.is(value, -0) ? 0 : value;
}

export function trackStep(spec: ParameterSpec, bounds: NumberRange | null): number {
  if (spec.scale === "log2") return spec.step ?? 0.05;
  if (spec.step) return spec.step;
  if (spec.unit === "count") return 1;
  return bounds ? (bounds.max - bounds.min) / 200 : 0.01;
}

function trackBounds(spec: ParameterSpec, bounds: NumberRange): { min: number; max: number } {
  const a = trackPosition(spec, bounds.min);
  const b = trackPosition(spec, bounds.max);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Ends a sentence with a full stop unless it already has one. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Where a parameter's value came from, in a few words: "set by you", "from the URL for this visit". */
export function describeProvenance(state: ParameterState): string {
  switch (state.provenance) {
    case "default": return "default";
    case "host-default": return "the app's default";
    case "preset": return `from the preset ${state.preset ?? ""}`.trim();
    case "user": return "set by you";
    case "url": return "from the URL for this visit, not saved";
    case "host": return `set by the app: ${(state.layers.forced?.reason ?? "").replace(/[.]$/, "")}`.replace(/: $/, "");
  }
}

function noteFor(state: ParameterState, startValue: ParameterValue): string {
  const parts: string[] = [];
  if (state.note) parts.push(state.note);
  if (state.provenance === "url" || state.provenance === "host") {
    const words = describeProvenance(state);
    parts.push(sentence(words.charAt(0).toUpperCase() + words.slice(1)));
  }
  if (!state.spec.appliesLive && !sameValue(state.value, startValue)) parts.push("Applies when the app next starts.");
  if (state.spec.readOnly) parts.push(state.spec.readOnly);
  return parts.join(" ");
}

function createNote(): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "foss-earth-choices__note foss-earth-parameter__note";
  note.setAttribute("role", "status");
  note.hidden = true;
  return note;
}

function setNote(note: HTMLElement, text: string): void {
  note.hidden = text === "";
  if (note.textContent !== text) note.textContent = text;
}

function pill(type: "radio" | "checkbox", name: string, value: string, label: string): { element: HTMLLabelElement; input: HTMLInputElement; text: HTMLSpanElement } {
  const element = document.createElement("label");
  element.className = "foss-earth-choice";
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  const text = document.createElement("span");
  text.textContent = label;
  element.append(input, text);
  return { element, input, text };
}

function describeTitle(spec: ParameterSpec): string {
  return spec.description;
}

/** A switch: one pill with a checkbox, outlined while on. */
function createSwitch(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline";
  element.dataset.parameter = spec.id;
  const toggle = pill("checkbox", `foss-earth-parameter-${++controlCount}`, "on", spec.label);
  toggle.element.title = describeTitle(spec);
  const note = createNote();
  element.append(toggle.element, note);
  const start = settings.get(spec.id);
  const onChange = (): void => { settings.set(spec.id, toggle.input.checked); update(); };
  toggle.input.addEventListener("change", onChange);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    toggle.input.checked = state.value === true;
    toggle.input.disabled = Boolean(spec.readOnly) || state.provenance === "host";
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy: () => { toggle.input.removeEventListener("change", onChange); element.remove(); } };
}

/** A heading and pills, one per choice. */
function createChoicePills(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const name = `foss-earth-parameter-${++controlCount}`;
  const element = document.createElement("div");
  element.className = "foss-earth-choices foss-earth-parameter foss-earth-parameter--group";
  element.dataset.parameter = spec.id;
  element.setAttribute("role", "radiogroup");
  element.setAttribute("aria-label", spec.label);
  const heading = document.createElement("div");
  heading.className = "foss-earth-choices__heading";
  heading.textContent = spec.label;
  heading.title = describeTitle(spec);
  const pills = document.createElement("span");
  pills.className = "foss-earth-parameter__pills";
  const note = createNote();
  element.append(heading, pills, note);
  const start = settings.get(spec.id);
  let shownChoices: ParameterState["choices"] | null = null;
  const onChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== name) return;
    settings.set(spec.id, input.value);
    update();
  };
  element.addEventListener("change", onChange);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    if (state.choices !== shownChoices) {
      shownChoices = state.choices;
      pills.replaceChildren(...state.choices.map(choice => {
        const option = pill("radio", name, choice.id, choice.label);
        if (choice.description) option.element.title = choice.description;
        return option.element;
      }));
    }
    for (const input of pills.querySelectorAll<HTMLInputElement>("input")) {
      input.checked = input.value === state.value;
      input.disabled = Boolean(spec.readOnly) || state.provenance === "host";
    }
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy: () => { element.removeEventListener("change", onChange); element.remove(); } };
}

/** The number a field shows: a fraction as a percentage. */
function fieldNumber(spec: ParameterSpec, value: number): string {
  return formatNumber(spec.unit === "fraction" ? value * 100 : value).replace(/,/g, "");
}

function fromField(spec: ParameterSpec, text: string): number | null {
  const value = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(value)) return null;
  return spec.unit === "fraction" ? value / 100 : value;
}

function createHeader(spec: ParameterSpec): { header: HTMLElement; readout: HTMLElement; reading: HTMLElement } {
  const header = document.createElement("div");
  header.className = "foss-earth-parameter__header";
  const label = document.createElement("span");
  label.className = "foss-earth-parameter__label";
  label.textContent = spec.label;
  label.title = describeTitle(spec);
  const readout = document.createElement("span");
  readout.className = "foss-earth-parameter__readout";
  // What the budget bounds right now, beside it, in the same unit.
  const reading = document.createElement("span");
  reading.className = "foss-earth-parameter__reading";
  reading.hidden = true;
  header.append(label, readout, reading);
  return { header, readout, reading };
}

function showReading(settings: SettingsRegistry, id: string, element: HTMLElement): void {
  const text = settings.getReading(id);
  element.hidden = text === null;
  if (text !== null && element.textContent !== text) element.textContent = text;
}

/** A value track: one thumb, the default ticked, named values as pills beside it. */
function createValueTrack(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const name = `foss-earth-parameter-${++controlCount}`;
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--line";
  element.dataset.parameter = spec.id;
  const { header, readout, reading } = createHeader(spec);
  const field = document.createElement("input");
  field.type = "number";
  field.className = "foss-earth-parameter__field";
  field.setAttribute("aria-label", `${spec.label}${spec.unit === "fraction" ? " in percent" : ""}`);
  const unit = document.createElement("span");
  unit.className = "foss-earth-parameter__unit";
  readout.append(field, unit);
  const start = settings.get(spec.id);
  const track: TrackHandle = createTrack({
    ariaLabel: spec.label,
    ramp: spec.track?.ramp ?? "neutral",
    onInput: (_id, position) => {
      const state = settings.inspect(spec.id);
      const value = valueAtTrackPosition(spec, position, state.bounds);
      settings.set(spec.id, value);
      update();
    },
    onCommit: () => update(),
  });
  const named = document.createElement("div");
  named.className = "foss-earth-parameter__named";
  const namedPills = (spec.named ?? []).map(option => pill("radio", name, option.id, option.label));
  const numberPill = spec.named?.length ? pill("radio", name, "", "Value") : null;
  named.hidden = namedPills.length === 0;
  named.append(...namedPills.map(option => option.element), ...(numberPill ? [numberPill.element] : []));
  const note = createNote();
  element.append(header, track.element, named, note);

  const onNamed = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== name) return;
    if (input.value) settings.set(spec.id, input.value);
    else {
      // "Value": start from the number the named value stands for, or the default.
      const state = settings.inspect(spec.id);
      const fallback = typeof state.defaultValue === "number" ? state.defaultValue : state.bounds?.min ?? 0;
      settings.set(spec.id, fallback);
    }
    update();
  };
  named.addEventListener("change", onNamed);
  const onField = (): void => {
    const value = fromField(spec, field.value);
    if (value === null) { update(); return; }
    const result = settings.set(spec.id, value);
    if (!result.ok) setNote(note, result.reason);
    else update();
  };
  field.addEventListener("change", onField);

  const update = (): void => {
    const state = settings.inspect(spec.id);
    const bounds = state.bounds ?? { min: 0, max: 1 };
    const span = trackBounds(spec, bounds);
    const value = state.value;
    const isNamed = typeof value === "string";
    for (const option of namedPills) option.input.checked = option.input.value === value;
    if (numberPill) numberPill.input.checked = !isNamed;
    const locked = Boolean(spec.readOnly) || state.provenance === "host";
    for (const option of [...namedPills, ...(numberPill ? [numberPill] : [])]) option.input.disabled = locked;
    const number = typeof value === "number" ? value : null;
    const defaultNumber = typeof state.defaultValue === "number" ? state.defaultValue : null;
    track.render({
      min: span.min,
      max: span.max,
      step: trackStep(spec, bounds),
      tick: defaultNumber === null ? null : trackPosition(spec, defaultNumber),
      thumbs: number === null ? [] : [{
        id: "value",
        role: "value",
        position: trackPosition(spec, number),
        ariaLabel: spec.label,
        ariaValueText: formatValue(spec, number),
      }],
      disabled: locked,
    });
    track.element.hidden = isNamed && namedPills.length > 0;
    field.hidden = number === null;
    field.disabled = locked;
    if (document.activeElement !== field && number !== null) field.value = fieldNumber(spec, number);
    unit.textContent = number === null ? formatValue(spec, value, state.choices) : spec.unit === "fraction" ? "%" : formatQuantity(spec.unit, 1).replace(/^1\s?/, "");
    showReading(settings, spec.id, reading);
    setNote(note, noteFor(state, start));
  };
  update();
  return {
    element,
    update,
    destroy() {
      named.removeEventListener("change", onNamed);
      field.removeEventListener("change", onField);
      track.destroy();
      element.remove();
    },
  };
}

/** A range track: one track, a thumb for each end; a thumb stops at the other rather than passing it. */
function createRangeTrack(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--line";
  element.dataset.parameter = spec.id;
  const { header, readout, reading } = createHeader(spec);
  const note = createNote();
  const start = settings.get(spec.id);
  // Left and right thumbs; on a reversed track the left one is the range's max.
  const left = spec.track?.reversed ? "max" : "min";
  const track = createTrack({
    ariaLabel: spec.label,
    ramp: spec.track?.ramp ?? "neutral",
    onInput: (id, position) => {
      const state = settings.inspect(spec.id);
      const current = state.value as NumberRange;
      const leftPosition = trackPosition(spec, current[left]);
      const rightPosition = trackPosition(spec, current[left === "min" ? "max" : "min"]);
      const clamped = id === "left" ? Math.min(position, rightPosition) : Math.max(position, leftPosition);
      const value = valueAtTrackPosition(spec, clamped, state.bounds);
      const next = { ...current };
      const end = id === "left" ? left : left === "min" ? "max" : "min";
      next[end] = value;
      if (next.min > next.max) next[end] = end === "min" ? next.max : next.min;
      settings.set(spec.id, next);
      update();
    },
    onCommit: () => update(),
  });
  element.append(header, track.element, note);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    const value = isNumberRange(state.value) ? state.value : { min: 0, max: 0 };
    const bounds = state.bounds ?? value;
    const span = trackBounds(spec, bounds);
    const leftValue = value[left];
    const rightValue = value[left === "min" ? "max" : "min"];
    const locked = Boolean(spec.readOnly) || state.provenance === "host";
    track.render({
      min: span.min,
      max: span.max,
      step: trackStep(spec, bounds),
      range: { low: trackPosition(spec, leftValue), high: trackPosition(spec, rightValue) },
      thumbs: [
        { id: "left", role: "end", position: trackPosition(spec, leftValue), ariaLabel: `${spec.label}: ${left === "min" ? "lower" : "upper"} end`, ariaValueText: formatValue(spec, leftValue) },
        { id: "right", role: "end", position: trackPosition(spec, rightValue), ariaLabel: `${spec.label}: ${left === "min" ? "upper" : "lower"} end`, ariaValueText: formatValue(spec, rightValue) },
      ],
      disabled: locked,
    });
    readout.textContent = formatValue(spec, value);
    showReading(settings, spec.id, reading);
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy: () => { track.destroy(); element.remove(); } };
}

/** A text field. A secret is never shown: typing replaces it, Clear forgets it. */
function createTextField(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--line foss-earth-parameter--text";
  element.dataset.parameter = spec.id;
  const { header, readout } = createHeader(spec);
  const input = document.createElement("input");
  input.type = spec.sensitive ? "password" : "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.className = "foss-earth-parameter__text";
  input.setAttribute("aria-label", spec.label);
  const actions = document.createElement("div");
  actions.className = "foss-earth-parameter__named";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "foss-earth-choice foss-earth-parameter__action";
  save.textContent = "Save";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "foss-earth-choice foss-earth-parameter__action";
  clear.textContent = "Clear";
  actions.append(save, clear);
  const note = createNote();
  element.append(header, input, actions, note);
  const start = settings.get(spec.id);
  const onSave = (): void => {
    const result = settings.set(spec.id, input.value.trim());
    if (!result.ok) { setNote(note, result.reason); return; }
    if (spec.sensitive) input.value = "";
    update();
  };
  const onClear = (): void => { settings.reset(spec.id); input.value = ""; update(); };
  const onKey = (event: KeyboardEvent): void => { if (event.key === "Enter") onSave(); };
  save.addEventListener("click", onSave);
  clear.addEventListener("click", onClear);
  input.addEventListener("keydown", onKey);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    const value = typeof state.value === "string" ? state.value : "";
    readout.textContent = spec.sensitive ? (value ? "Set" : "Not set") : "";
    input.placeholder = spec.sensitive ? (value ? "Enter a new key to replace it" : "Paste the key") : "";
    if (!spec.sensitive && document.activeElement !== input) input.value = value;
    const locked = Boolean(spec.readOnly) || state.provenance === "host";
    input.disabled = locked;
    save.disabled = locked;
    clear.disabled = locked || state.layers.saved === undefined && state.layers.url === undefined;
    setNote(note, noteFor(state, start));
  };
  update();
  return {
    element,
    update,
    destroy() {
      save.removeEventListener("click", onSave);
      clear.removeEventListener("click", onClear);
      input.removeEventListener("keydown", onKey);
      element.remove();
    },
  };
}

/**
 * The control a parameter's spec calls for: a switch, choice pills, a value
 * track, a range track or a text field. Read-only parameters show their value
 * and the reason they cannot change.
 */
export function createParameterControl(settings: SettingsRegistry, id: string): ParameterControlHandle {
  const spec = settings.spec(id);
  if (!spec) throw new Error(`No parameter "${id}" is registered.`);
  let control: ParameterControlHandle;
  switch (spec.kind) {
    case "boolean": control = createSwitch(settings, spec); break;
    case "choice": control = createChoicePills(settings, spec); break;
    case "number": control = createValueTrack(settings, spec); break;
    case "range": control = createRangeTrack(settings, spec); break;
    case "text": control = createTextField(settings, spec); break;
  }
  return control;
}
