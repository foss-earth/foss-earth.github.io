import type { SettingsRegistry } from "../../settings/registry";
import type { NumberRange, ParameterChoice, ParameterSpec, ParameterState, ParameterValue } from "../../settings/types";
import { formatNumber, formatQuantity, formatValue, isNumberRange, sameValue } from "../../settings/values";
import { createExternalLinkIcon } from "../externalLinkIcon";
import { createTrack, type TrackHandle } from "./track";
import { createTwoPositionSlider } from "./twoPositionSlider";

export interface ParameterControlHandle {
  /** The control and its compact help and source actions. */
  element: HTMLElement;
  /** Re-reads the registry. Cheap when nothing changed. */
  update(): void;
  destroy(): void;
}

let controlCount = 0;

/** Conditional controls stay out of both section layouts and Show all parameters. */
export function isParameterControlVisible(settings: SettingsRegistry, spec: ParameterSpec): boolean {
  const guard = spec.visibleWhen;
  return !guard || Boolean(settings.spec(guard.id) && sameValue(settings.get(guard.id), guard.value));
}

/** Paired fields belong to the existing control rather than another row. */
export function isStandaloneParameterControl(settings: SettingsRegistry, spec: ParameterSpec): boolean {
  return isParameterControlVisible(settings, spec) && (!spec.inlineWith || !settings.spec(spec.inlineWith));
}

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

function setNote(note: HTMLElement, text: string, reveal = false): void {
  note.hidden = text === "";
  if (note.textContent !== text) note.textContent = text;
  if (reveal && text) note.dispatchEvent(new Event("parameter-invalid", { bubbles: true }));
}

let helpCount = 0;
let closeOpenHelp: (() => void) | null = null;

/** One compact accessory row; explanations stay closed until requested. */
function withParameterActions(settings: SettingsRegistry, spec: ParameterSpec, control: ParameterControlHandle): ParameterControlHandle {
  const help = document.createElement("button");
  help.type = "button";
  help.className = "foss-earth-choice foss-earth-parameter__action foss-earth-parameter__icon-action foss-earth-parameter__help-button";
  help.textContent = "?";
  help.setAttribute("aria-label", `Explain ${spec.label}`);
  help.setAttribute("aria-expanded", "false");
  help.title = `Explain ${spec.label}`;
  const explanation = document.createElement("div");
  explanation.className = "foss-earth-parameter__help";
  explanation.id = `foss-earth-parameter-help-${++helpCount}`;
  explanation.setAttribute("role", "tooltip");
  explanation.hidden = true;
  const nativePopover = typeof explanation.showPopover === "function" && typeof explanation.hidePopover === "function";
  if (nativePopover) explanation.setAttribute("popover", "manual");
  help.setAttribute("aria-controls", explanation.id);
  const description = document.createElement("p");
  description.className = "foss-earth-parameter-row__description";
  description.textContent = spec.description;
  const meta = document.createElement("p");
  meta.className = "foss-earth-parameter-row__meta";
  const code = document.createElement("code");
  code.className = "foss-earth-parameter-row__id";
  code.textContent = spec.id;
  explanation.append(description, meta);
  const note = control.element.querySelector<HTMLElement>(".foss-earth-parameter__note");
  if (note) explanation.append(note);
  explanation.append(code);
  const url = settings.sourceUrl(spec.id);
  const source = document.createElement(url ? "a" : "span");
  source.className = "foss-earth-choice foss-earth-parameter__action foss-earth-parameter__icon-action foss-earth-parameter-row__source";
  source.title = `The code that reads ${spec.id}: ${spec.source}.${url ? " Opens in a new tab." : ""}`;
  source.setAttribute("aria-label", `Source for ${spec.label}: ${spec.source}${url ? ", opens in a new tab" : ""}`);
  source.append(createExternalLinkIcon());
  if (source instanceof HTMLAnchorElement && url) {
    source.href = url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
  }
  let header = control.element.querySelector<HTMLElement>(".foss-earth-parameter__header");
  const heading = control.element.querySelector<HTMLElement>(".foss-earth-choices__heading, .foss-earth-parameter__label");
  if (!header && heading) {
    header = document.createElement("div");
    header.className = "foss-earth-parameter__header";
    heading.before(header);
    header.append(heading);
  }
  if (heading) heading.before(help);
  else (header ?? control.element).append(help);
  (header ?? control.element).append(source);
  control.element.append(explanation);
  const updateActions = (): void => {
    const state = settings.inspect(spec.id);
    const describe = (value: ParameterValue): string => spec.booleanControl === "auto-custom" ? (value === true ? "Custom" : "Auto") : formatValue(spec, value, state.choices);
    const value = spec.sensitive ? (state.value ? "set" : "not set") : describe(state.value);
    const defaultValue = spec.sensitive ? (state.defaultValue ? "set" : "none") : describe(state.defaultValue);
    meta.textContent = `Now ${value} (${describeProvenance(state)}). ${sentence(`Default ${defaultValue}: ${state.defaultDerivedFrom}`)}${spec.appliesLive ? "" : " Applies on the next start."}`;
  };
  const position = (): void => {
    const anchor = help.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    explanation.style.maxWidth = `${Math.max(0, width - 16)}px`;
    explanation.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const box = explanation.getBoundingClientRect();
    explanation.style.left = `${Math.max(left + 8, Math.min(anchor.left, left + width - box.width - 8))}px`;
    explanation.style.top = `${Math.max(top + 8, Math.min(anchor.bottom + 6, top + height - box.height - 8))}px`;
  };
  const close = (): void => {
    if (explanation.hidden) return;
    if (nativePopover && explanation.matches(":popover-open")) explanation.hidePopover();
    explanation.hidden = true;
    if (!nativePopover) control.element.append(explanation);
    help.setAttribute("aria-expanded", "false");
    help.removeAttribute("aria-describedby");
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("scroll", position, true);
    window.removeEventListener("resize", position);
    window.visualViewport?.removeEventListener("resize", position);
    if (closeOpenHelp === close) closeOpenHelp = null;
  };
  const open = (): void => {
    closeOpenHelp?.();
    updateActions();
    if (!nativePopover) document.body.append(explanation);
    explanation.hidden = false;
    if (nativePopover) explanation.showPopover();
    help.setAttribute("aria-expanded", "true");
    help.setAttribute("aria-describedby", explanation.id);
    closeOpenHelp = close;
    position();
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
  };
  const onHelp = (): void => { if (explanation.hidden) open(); else close(); };
  const onOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && !help.contains(event.target) && !explanation.contains(event.target)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { close(); event.preventDefault(); event.stopPropagation(); }
  };
  const onPopoverToggle = (): void => { if (nativePopover && !explanation.matches(":popover-open") && !explanation.hidden) close(); };
  help.addEventListener("click", onHelp);
  explanation.addEventListener("toggle", onPopoverToggle);
  note?.addEventListener("parameter-invalid", open);
  updateActions();
  return {
    element: control.element,
    update() { control.update(); updateActions(); },
    destroy() {
      close();
      help.removeEventListener("click", onHelp);
      explanation.removeEventListener("toggle", onPopoverToggle);
      note?.removeEventListener("parameter-invalid", open);
      control.destroy();
    },
  };
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

function createChoiceIcon(icon: NonNullable<ParameterChoice["icon"]>): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "foss-earth-choice__icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (icon === "toggle-on") {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("fill-rule", "evenodd");
    // Filled track, with the right-hand knob cut out so it contrasts in either theme.
    path.setAttribute("d", "M8 5a7 7 0 0 0 0 14h8a7 7 0 0 0 0-14H8Zm8 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z");
    svg.append(path);
  } else {
    const track = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [name, value] of Object.entries({ x: "2", y: "6", width: "20", height: "12", rx: "6", fill: "none", stroke: "currentColor", "stroke-width": "2" })) track.setAttribute(name, value);
    const knob = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const [name, value] of Object.entries({ cx: "8", cy: "12", r: "3", fill: "currentColor" })) knob.setAttribute(name, value);
    svg.append(track, knob);
  }
  return svg;
}

function choicePill(name: string, choice: ParameterChoice): ReturnType<typeof pill> {
  const option = pill("radio", name, choice.id, choice.icon ? "" : choice.shortLabel ?? choice.label);
  if (choice.icon) option.text.append(createChoiceIcon(choice.icon));
  if (choice.shortLabel !== undefined || choice.icon !== undefined) {
    option.input.setAttribute("aria-label", choice.label);
    option.element.title = choice.description ? `${choice.label}: ${choice.description}` : choice.label;
  } else if (choice.description) option.element.title = choice.description;
  return option;
}

function describeTitle(spec: ParameterSpec): string {
  return spec.description;
}

/** A switch: one pill with a checkbox, outlined while on. */
function createSwitch(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline";
  element.dataset.parameter = spec.id;
  const toggle = pill("checkbox", `foss-earth-parameter-${++controlCount}`, "on", "");
  toggle.element.title = describeTitle(spec);
  toggle.input.setAttribute("aria-label", spec.label);
  toggle.input.id = `${toggle.input.name}-toggle`;
  const heading = document.createElement("label");
  heading.className = "foss-earth-parameter__label";
  heading.htmlFor = toggle.input.id;
  heading.textContent = spec.label;
  const header = document.createElement("div");
  header.className = "foss-earth-parameter__header";
  header.append(toggle.element, heading);
  const note = createNote();
  element.append(header, note);
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

/** Auto uses the defaults; Custom reveals the retained per-item priorities. */
function createAutoCustomSlider(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline";
  element.dataset.parameter = spec.id;
  const { header, readout } = createHeader(spec);
  const slider = createTwoPositionSlider({
    label: spec.label,
    options: [{ label: "Auto" }, { label: "Custom" }],
    onInput: index => { settings.set(spec.id, index === 1); update(); },
  });
  readout.append(slider.element);
  const note = createNote();
  element.append(header, note);
  const start = settings.get(spec.id);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    slider.update(state.value === true ? 1 : 0, Boolean(spec.readOnly) || state.provenance === "host");
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy() { slider.destroy(); element.remove(); } };
}

function createChoiceSlider(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const choices = settings.inspect(spec.id).choices;
  if (choices.length !== 2) return createChoicePills(settings, spec);
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline";
  element.dataset.parameter = spec.id;
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", spec.label);
  const { header, readout } = createHeader(spec);
  const slider = createTwoPositionSlider({
    label: spec.label,
    options: [
      { label: choices[0].label, icon: choices[0].shortLabel },
      { label: choices[1].label, icon: choices[1].shortLabel },
    ],
    onInput: index => { settings.set(spec.id, choices[index].id); update(); },
  });
  readout.append(slider.element);
  const note = createNote();
  element.append(header, note);
  const start = settings.get(spec.id);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    slider.update(state.value === choices[0].id ? 0 : 1, Boolean(spec.readOnly) || state.provenance === "host");
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy() { slider.destroy(); element.remove(); } };
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
  const header = document.createElement("div");
  header.className = "foss-earth-parameter__header";
  header.append(heading);
  const pills = document.createElement("span");
  pills.className = "foss-earth-parameter__pills";
  const note = createNote();
  element.append(header, pills, note);
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
      const compact = state.choices.length > 0 && state.choices.every(choice => choice.shortLabel !== undefined || choice.icon !== undefined);
      element.classList.toggle("foss-earth-parameter--compact-choice", compact);
      if (compact) header.prepend(pills);
      else header.after(pills);
      pills.replaceChildren(...state.choices.map(choice => choicePill(name, choice).element));
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
  header.append(readout, reading, label);
  return { header, readout, reading };
}

function showReading(settings: SettingsRegistry, id: string, element: HTMLElement): void {
  const text = settings.getReading(id);
  element.hidden = text === null;
  if (text !== null && element.textContent !== text) element.textContent = text;
}

/** A compact numeric field for discrete settings that do not need a track. */
function createNumberField(settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline foss-earth-parameter--number-field";
  element.dataset.parameter = spec.id;
  const { header, readout, reading } = createHeader(spec);
  const field = document.createElement("input");
  field.type = "number";
  field.className = "foss-earth-parameter__field";
  field.setAttribute("aria-label", `${spec.label}${spec.unit === "fraction" ? " in percent" : ""}`);
  const step = spec.step ?? (spec.unit === "count" ? 1 : "any");
  field.step = typeof step === "number" && spec.unit === "fraction" ? String(step * 100) : String(step);
  const unit = document.createElement("span");
  unit.className = "foss-earth-parameter__unit";
  unit.textContent = spec.unit === "fraction" ? "%" : formatQuantity(spec.unit, 1).replace(/^1\s?/, "");
  readout.append(field, unit);
  const note = createNote();
  element.append(header, note);
  const start = settings.get(spec.id);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    const value = typeof state.value === "number" ? state.value : 0;
    field.disabled = Boolean(spec.readOnly) || state.provenance === "host";
    field.min = state.bounds ? fieldNumber(spec, state.bounds.min) : "";
    field.max = state.bounds ? fieldNumber(spec, state.bounds.max) : "";
    const digits = Math.max(3, field.min.length, field.max.length, fieldNumber(spec, value).length);
    field.style.width = `calc(${digits}ch + 24px)`;
    if (document.activeElement !== field) field.value = fieldNumber(spec, value);
    showReading(settings, spec.id, reading);
    setNote(note, noteFor(state, start));
  };
  const onChange = (): void => {
    const value = fromField(spec, field.value);
    if (value === null) { update(); return; }
    const result = settings.set(spec.id, value);
    if (!result.ok) setNote(note, result.reason, true);
    else update();
  };
  field.addEventListener("change", onChange);
  update();
  return { element, update, destroy() { field.removeEventListener("change", onChange); element.remove(); } };
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
  const namedPills = (spec.named ?? []).map(option => choicePill(name, option));
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
    if (!result.ok) setNote(note, result.reason, true);
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
    if (!result.ok) { setNote(note, result.reason, true); return; }
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
    case "boolean": control = spec.booleanControl === "auto-custom" ? createAutoCustomSlider(settings, spec) : createSwitch(settings, spec); break;
    case "choice": control = spec.choiceControl === "two-position" ? createChoiceSlider(settings, spec) : createChoicePills(settings, spec); break;
    case "number": control = spec.numberControl === "field" && !spec.named?.length ? createNumberField(settings, spec) : createValueTrack(settings, spec); break;
    case "range": control = createRangeTrack(settings, spec); break;
    case "text": control = createTextField(settings, spec); break;
  }
  const decorated = withParameterActions(settings, spec, control);
  const inline = new Map<string, { control: ParameterControlHandle; detail: HTMLElement; meta: HTMLElement }>();
  const pairedSpecs = (): ParameterSpec[] => settings.list({ tab: spec.home.tab, section: spec.home.section }).filter(candidate => candidate.inlineWith === id);
  const update = (): void => {
    decorated.update();
    const shown = pairedSpecs().filter(candidate => isParameterControlVisible(settings, candidate));
    for (const [childId, child] of inline) {
      if (!shown.some(candidate => candidate.id === childId)) {
        child.control.destroy();
        child.detail.remove();
        inline.delete(childId);
      }
    }
    const header = decorated.element.querySelector<HTMLElement>(".foss-earth-parameter__header")!;
    const help = decorated.element.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
    const explanation = document.getElementById(help.getAttribute("aria-controls")!) ?? decorated.element.querySelector<HTMLElement>(".foss-earth-parameter__help");
    for (const candidate of [...shown].reverse()) {
      let child = inline.get(candidate.id);
      if (!child) {
        const fieldControl = createNumberField(settings, candidate);
        const field = fieldControl.element.querySelector<HTMLInputElement>('input[type="number"]')!;
        const note = fieldControl.element.querySelector<HTMLElement>(".foss-earth-parameter__note")!;
        fieldControl.element.className = "foss-earth-parameter__inline-field";
        fieldControl.element.replaceChildren(field);
        const detail = document.createElement("div");
        const description = document.createElement("p");
        description.textContent = candidate.description;
        const meta = document.createElement("p");
        meta.className = "foss-earth-parameter-row__meta";
        detail.append(description, meta, note);
        explanation?.append(detail);
        // Invalid priority edits use this row's existing explanation button.
        note.addEventListener("parameter-invalid", () => {
          const help = decorated.element.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
          if (help.getAttribute("aria-expanded") !== "true") help.click();
        });
        child = { control: fieldControl, detail, meta };
        inline.set(candidate.id, child);
      }
      child.control.update();
      const state = settings.inspect(candidate.id);
      child.meta.textContent = `${candidate.label}: ${formatValue(candidate, state.value)} (${describeProvenance(state)}). Default ${formatValue(candidate, state.defaultValue)}: ${state.defaultDerivedFrom}`;
      header.prepend(child.control.element);
    }
  };
  update();
  const stopWatching = settings.subscribe(changed => {
    if (pairedSpecs().some(candidate => changed.has(candidate.id) || (candidate.visibleWhen && changed.has(candidate.visibleWhen.id)))) update();
  });
  return {
    element: decorated.element,
    update,
    destroy() {
      stopWatching();
      for (const child of inline.values()) { child.control.destroy(); child.detail.remove(); }
      inline.clear();
      decorated.destroy();
    },
  };
}
