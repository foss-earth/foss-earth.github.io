// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry, type SettingsStorage } from "../../settings/registry";
import type { ParameterSpec } from "../../settings/types";
import { appendHostSections, createParameterSection, createSectionsElement } from "./parameterSection";
import { createSavedSettingsSection } from "./savedSettings";

afterEach(() => document.body.replaceChildren());

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const base = { appliesLive: true, source: "src/test.ts", defaultReason: "Chosen for tests." } as const;

const specs: ParameterSpec[] = [
  { ...base, id: "t.flag", label: "Flag", description: "A switch.", unit: "none", kind: "boolean", default: false, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.mode", label: "Mode", description: "A choice.", unit: "none", kind: "choice", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], default: "a", home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.budget", label: "Budget", description: "A number.", unit: "MiB", kind: "number", bounds: () => ({ min: 32, max: 1024 }), scale: "log2", default: 128, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.cap", label: "Cap", description: "A number or off.", unit: "fps", kind: "number", named: [{ id: "off", label: "Off" }], bounds: () => ({ min: 10, max: 240 }), step: 1, default: "off", home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.range", label: "Range", description: "A range.", unit: "count", kind: "range", bounds: () => ({ min: 0, max: 100 }), default: { min: 10, max: 60 }, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.key", label: "Key", description: "A secret.", unit: "none", kind: "text", default: "", sensitive: true, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.hidden", label: "Hidden", description: "Only under Show all.", unit: "ms", kind: "number", bounds: () => ({ min: 0, max: 10 }), default: 2, home: { tab: "map", section: "loading", level: "all" } },
];

function setup(searchParams?: URLSearchParams) {
  const storage = memoryStorage();
  const settings = createSettingsRegistry({ storage, searchParams, sourceBase: "https://example.test/blob/main/" });
  settings.register(specs);
  const section = createParameterSection(settings, { tab: "map", section: "loading" });
  document.body.append(section.element);
  const control = (id: string) => section.element.querySelector<HTMLElement>(`[data-parameter="${id}"]`)!;
  return { settings, section, control, storage };
}

function input(element: HTMLElement, selector: string): HTMLInputElement {
  return element.querySelector<HTMLInputElement>(selector)!;
}

function drag(thumb: HTMLInputElement, value: number): void {
  thumb.value = String(value);
  thumb.dispatchEvent(new Event("input"));
}

describe("parameter section", () => {
  it("draws a control for each main-level parameter, and none for the rest", () => {
    const { section, control } = setup();
    expect([...section.element.querySelectorAll(".foss-earth-parameter-section__main > [data-parameter]")].map(element => (element as HTMLElement).dataset.parameter))
      .toEqual(["t.flag", "t.mode", "t.budget", "t.cap", "t.range", "t.key"]);
    expect(control("t.hidden")).toBeNull();
  });

  it("puts the checkbox and help before its label, with the source last", () => {
    const { settings, control } = setup();
    const flag = control("t.flag");
    const header = flag.querySelector(".foss-earth-parameter__header")!;
    expect([...header.children].map(item => item.tagName)).toEqual(["LABEL", "BUTTON", "LABEL", "A"]);
    const help = header.querySelector<HTMLButtonElement>('[aria-label="Explain Flag"]')!;
    expect(flag.querySelector('[aria-label="Reset Flag"]')).toBeNull();
    const source = header.querySelector<HTMLAnchorElement>("a")!;
    expect(source.textContent).toBe("");
    expect(source.href).toBe("https://example.test/blob/main/src/test.ts");
    expect(source.getAttribute("aria-label")).toContain("src/test.ts");
    expect(source.title).toContain("The code that reads t.flag");
    expect(help.textContent).toBe("?");
    input(flag, "input").click();
    expect(settings.get("t.flag")).toBe(true);
    flag.querySelector<HTMLLabelElement>(".foss-earth-parameter__label")!.click();
    expect(settings.get("t.flag")).toBe(false);
  });

  it("shows compact choice icons and symbols in one control row with full accessible and help labels", () => {
    const { settings, section, control } = setup();
    settings.register([{
      ...base,
      id: "t.visibility", label: "Visibility", description: "Show, fit automatically, or hide.", unit: "none", kind: "choice", default: "auto",
      choices: [{ id: "on", label: "On", icon: "toggle-on" }, { id: "auto", label: "Auto", shortLabel: "A" }, { id: "off", label: "Off", icon: "toggle-off" }],
      home: { tab: "map", section: "loading", level: "main" },
    }]);
    const visibility = control("t.visibility");
    const header = visibility.querySelector(".foss-earth-parameter__header")!;
    expect(visibility.classList.contains("foss-earth-parameter--compact-choice")).toBe(true);
    expect([...header.children].map(child => child.className)).toEqual([
      "foss-earth-parameter__pills",
      "foss-earth-choice foss-earth-parameter__action foss-earth-parameter__icon-action foss-earth-parameter__help-button",
      "foss-earth-choices__heading",
      "foss-earth-choice foss-earth-parameter__action foss-earth-parameter__icon-action foss-earth-parameter-row__source",
    ]);
    const labels = [...visibility.querySelectorAll<HTMLLabelElement>(".foss-earth-parameter__pills label")];
    expect(labels.map(label => label.textContent)).toEqual(["", "A", ""]);
    expect(labels.map(label => Boolean(label.querySelector('svg[aria-hidden="true"]')))).toEqual([true, false, true]);
    expect(labels.map(label => label.title)).toEqual(["On", "Auto", "Off"]);
    expect(labels.map(label => label.querySelector("input")!.getAttribute("aria-label"))).toEqual(["On", "Auto", "Off"]);
    expect(input(visibility, 'input[value="auto"]').checked).toBe(true);
    input(visibility, 'input[value="on"]').click();
    expect(settings.get("t.visibility")).toBe("on");
    visibility.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!.click();
    const explanation = document.getElementById(visibility.querySelector(".foss-earth-parameter__help-button")!.getAttribute("aria-controls")!)!;
    expect(explanation.textContent).toContain("Now On (set by you). Default Auto:");
    settings.reset("t.visibility");
    expect(settings.get("t.visibility")).toBe("auto");
    expect(input(visibility, 'input[value="auto"]').checked).toBe(true);
    // Ordinary choice groups keep their full labels and separate row of pills.
    expect(control("t.mode").classList.contains("foss-earth-parameter--compact-choice")).toBe(false);
    expect(control("t.mode").querySelector(".foss-earth-parameter__pills")!.parentElement).toBe(control("t.mode"));
    section.destroy();
  });

  it("shows explanation and defaults only on help, closing on re-click, Escape or outside", () => {
    const { settings, section, control } = setup();
    const flag = control("t.flag");
    const help = flag.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
    const explanation = flag.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(explanation.hidden).toBe(true);
    expect(help.getAttribute("aria-expanded")).toBe("false");
    settings.force("t.flag", true, "a test needs it");
    help.click();
    expect(explanation.hidden).toBe(false);
    expect(explanation.textContent).toContain("A switch.");
    expect(explanation.textContent).toContain("Now on (set by the app: a test needs it)");
    expect(explanation.textContent).toContain("Default off: Chosen for tests.");
    expect(explanation.textContent).toContain("t.flag");
    expect(help.getAttribute("aria-describedby")).toBe(explanation.id);
    help.click();
    expect(explanation.hidden).toBe(true);
    help.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(explanation.hidden).toBe(true);
    expect(help.hasAttribute("aria-describedby")).toBe(false);
    help.click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(explanation.hidden).toBe(true);
    help.click();
    control("t.mode").querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!.click();
    expect(explanation.hidden).toBe(true);
    help.click();
    section.destroy();
    expect(explanation.hidden).toBe(true);
  });

  it("portals fallback help beyond clipped panels, restores it on close, and removes it on destroy", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "showPopover");
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: undefined });
    try {
      const { settings, section, control } = setup();
      const flag = control("t.flag");
      const help = flag.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
      const explanation = flag.querySelector<HTMLElement>('[role="tooltip"]')!;
      const ancestorKey = vi.fn();
      section.element.addEventListener("keydown", ancestorKey);
      help.click();
      expect(explanation.parentElement).toBe(document.body);
      settings.set("t.flag", true);
      expect(explanation.textContent).toContain("Now on (set by you)");
      help.click();
      expect(explanation.parentElement).toBe(flag);
      help.click();
      help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(ancestorKey).not.toHaveBeenCalled();
      expect(explanation.hidden).toBe(true);
      expect(explanation.parentElement).toBe(flag);
      help.click();
      section.destroy();
      expect(explanation.hidden).toBe(true);
      expect(explanation.parentElement).toBeNull();
      expect(document.body.contains(explanation)).toBe(false);
      expect(document.getElementById(explanation.id)).toBeNull();
      expect(help.getAttribute("aria-expanded")).toBe("false");
      expect(help.hasAttribute("aria-describedby")).toBe(false);
      help.click();
      expect(explanation.isConnected).toBe(false);
      expect(explanation.hidden).toBe(true);
      const unusedEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(unusedEscape);
      expect(unusedEscape.defaultPrevented).toBe(false);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "showPopover", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
    }
  });

  it("writes each kind of control to the registry", () => {
    const { settings, control } = setup();
    input(control("t.flag"), "input").click();
    expect(settings.get("t.flag")).toBe(true);
    input(control("t.mode"), 'input[value="b"]').click();
    expect(settings.get("t.mode")).toBe("b");

    const budget = input(control("t.budget"), 'input[type="range"]');
    expect(Number(budget.min)).toBeCloseTo(5);
    expect(Number(budget.max)).toBeCloseTo(10);
    drag(budget, 9);
    expect(settings.get("t.budget")).toBe(512);
    const field = input(control("t.budget"), ".foss-earth-parameter__field");
    field.value = "300";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.budget")).toBe(300);
    field.value = "5000";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.budget")).toBe(300);
    const helpId = control("t.budget").querySelector(".foss-earth-parameter__help-button")!.getAttribute("aria-controls")!;
    expect(document.getElementById(helpId)!.querySelector(".foss-earth-parameter__note")!.textContent).toMatch(/outside 32 MiB to 1,024 MiB/);

    // A named value hides the track; "Value" brings the number back.
    expect(input(control("t.cap"), 'input[value="off"]').checked).toBe(true);
    expect(control("t.cap").querySelector<HTMLElement>(".foss-earth-track")!.hidden).toBe(true);
    input(control("t.cap"), 'input[value=""]').click();
    expect(typeof settings.get("t.cap")).toBe("number");
    drag(input(control("t.cap"), 'input[type="range"]'), 60);
    expect(settings.get("t.cap")).toBe(60);
  });

  it("keeps a range's thumbs from passing each other", () => {
    const { settings, control } = setup();
    const [low, high] = [...control("t.range").querySelectorAll<HTMLInputElement>('input[type="range"]')];
    drag(low, 80);
    expect(settings.get("t.range")).toEqual({ min: 60, max: 60 });
    drag(high, 90);
    drag(low, 20);
    expect(settings.get("t.range")).toEqual({ min: 20, max: 90 });
    expect(control("t.range").querySelector(".foss-earth-parameter__readout")!.textContent).toBe("20 to 90");
  });

  it("never shows a secret, and forgets it on Clear", () => {
    const { settings, control } = setup();
    const field = input(control("t.key"), "input");
    expect(field.type).toBe("password");
    field.value = "abc";
    [...control("t.key").querySelectorAll("button")].find(button => button.textContent === "Save")!.click();
    expect(settings.get("t.key")).toBe("abc");
    expect(field.value).toBe("");
    expect(control("t.key").textContent).toContain("Set");
    [...control("t.key").querySelectorAll("button")].find(button => button.textContent === "Clear")!.click();
    expect(settings.get("t.key")).toBe("");
  });

  it("says where a value came from when it is not the user's", () => {
    const { settings, control } = setup(new URLSearchParams("set.t.mode=b"));
    expect(control("t.mode").querySelector(".foss-earth-parameter__note")!.textContent).toMatch(/From the URL for this visit/);
    const release = settings.force("t.flag", true, "the flight needs it");
    expect(input(control("t.flag"), "input").disabled).toBe(true);
    expect(control("t.flag").textContent).toMatch(/Set by the app: the flight needs it/);
    release();
    expect(input(control("t.flag"), "input").disabled).toBe(false);
  });

  it("shows what a budget bounds beside it, read again every second while it is shown", () => {
    vi.useFakeTimers();
    try {
      const { settings, control } = setup();
      let used = 100;
      const remove = settings.setReadingSource("t.budget", () => `${used} MiB in use`);
      settings.set("t.budget", 256);
      const reading = control("t.budget").querySelector<HTMLElement>(".foss-earth-parameter__reading")!;
      expect(reading.textContent).toBe("100 MiB in use");
      used = 180;
      vi.advanceTimersByTime(1000);
      expect(reading.textContent).toBe("180 MiB in use");
      remove();
      vi.advanceTimersByTime(1000);
      expect(reading.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws a host's parameter registered after the section exists", () => {
    const { settings, control } = setup();
    settings.register([{ ...base, id: "host.waiver", label: "Waiver", description: "A host switch.", unit: "none", kind: "boolean", default: false, session: true, home: { tab: "map", section: "loading", level: "main" } }]);
    expect(control("host.waiver")).not.toBeNull();
  });

  it("shows guarded numeric fields only while their editor is enabled, including Show all", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    settings.register([
      { ...base, id: "t.editPriorities", label: "Edit priorities", description: "Show priorities.", unit: "none", kind: "boolean", default: false, home: { tab: "other", section: "external", level: "main" } },
      { ...base, id: "t.priority", label: "Priority", description: "Lower comes first.", unit: "count", kind: "number", numberControl: "field", bounds: () => ({ min: 0, max: 99 }), step: 1, default: 2, visibleWhen: { id: "t.editPriorities", value: true }, home: { tab: "interface", section: "guarded", level: "main" } },
      { ...base, id: "t.extraPriority", label: "Extra priority", description: "Lower comes first.", unit: "count", kind: "number", numberControl: "field", default: 4, visibleWhen: { id: "t.editPriorities", value: true }, home: { tab: "interface", section: "guarded", level: "all" } },
    ]);
    const section = createParameterSection(settings, { tab: "interface", section: "guarded" });
    document.body.append(section.element);
    const main = section.element.querySelector<HTMLElement>(".foss-earth-parameter-section__main")!;
    const showAll = section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!;
    if (!showAll.checked) showAll.click();
    expect(section.element.querySelector('[data-parameter="t.priority"]')).toBeNull();
    expect(section.element.querySelector('[data-parameter="t.extraPriority"]')).toBeNull();
    expect(settings.list({ tab: "interface", section: "guarded" })).toHaveLength(2);
    // The guard is in another tab: its change still rebuilds both views.
    settings.set("t.editPriorities", true);
    const priority = main.querySelector<HTMLElement>('[data-parameter="t.priority"]')!;
    expect(priority).not.toBeNull();
    expect(priority.querySelector('input[type="range"]')).toBeNull();
    const field = input(priority, 'input[type="number"]');
    expect([field.value, field.min, field.max, field.step]).toEqual(["2", "0", "99", "1"]);
    const list = section.element.querySelector(".foss-earth-parameter-list")!;
    expect(list.querySelector('[data-parameter="t.priority"]')).not.toBeNull();
    expect(list.querySelector('[data-parameter="t.extraPriority"]')).not.toBeNull();
    field.value = "7";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(7);
    field.value = "100";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(7);
    const tooltipId = priority.querySelector(".foss-earth-parameter__help-button")!.getAttribute("aria-controls")!;
    expect(document.getElementById(tooltipId)!.hidden).toBe(false);
    settings.set("t.editPriorities", false);
    expect(section.element.querySelector('[data-parameter="t.priority"]')).toBeNull();
    expect(section.element.querySelector('[data-parameter="t.extraPriority"]')).toBeNull();
    expect(document.getElementById(tooltipId)).toBeNull();
    expect(settings.get("t.priority")).toBe(7);
    expect(settings.export().values["t.priority"]).toBe(7);
    settings.set("t.editPriorities", true);
    expect(input(main.querySelector<HTMLElement>('[data-parameter="t.priority"]')!, 'input[type="number"]').value).toBe("7");
    section.destroy();
  });

  it("lists every parameter under Show all parameters, with its default, provenance and source", () => {
    const { settings, section } = setup();
    const toggle = section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!;
    toggle.click();
    const rows = [...section.element.querySelectorAll<HTMLElement>(".foss-earth-parameter-row")];
    expect(rows.map(row => row.dataset.parameter)).toEqual(specs.map(spec => spec.id));
    const hidden = rows.find(row => row.dataset.parameter === "t.hidden")!;
    expect(hidden.querySelector(".foss-earth-parameter-row__meta")!.textContent).toBe("Now 2 ms (default). Default 2 ms: Chosen for tests.");
    const link = hidden.querySelector<HTMLAnchorElement>(".foss-earth-parameter-row__source")!;
    expect(link.href).toBe("https://example.test/blob/main/src/test.ts");
    expect(hidden.querySelector(".foss-earth-parameter__reset")).toBeNull();
    settings.set("t.hidden", 5);
    expect(hidden.querySelector(".foss-earth-parameter-row__meta")!.textContent).toMatch(/^Now 5 ms \(set by you\)\./);
    toggle.click();
    expect(section.element.querySelector(".foss-earth-parameter-row")).toBeNull();
  });

  it("edits paired priorities in the existing row and retains them across Auto and Custom", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    const home = { tab: "interface", section: "toolbar", level: "main" } as const;
    settings.register([
      { ...base, id: "t.custom", label: "Priorities", description: "Auto or Custom.", unit: "none", kind: "boolean", booleanControl: "auto-custom", default: false, home },
      { ...base, id: "t.visibility", label: "Camera position", description: "Visibility.", unit: "none", kind: "choice", choices: [{ id: "auto", label: "Auto", shortLabel: "A" }], default: "auto", home },
      { ...base, id: "t.priority", label: "Camera position priority", description: "Lower comes first.", unit: "count", kind: "number", numberControl: "field", bounds: () => ({ min: 0, max: 99 }), step: 1, default: 8, visibleWhen: { id: "t.custom", value: true }, inlineWith: "t.visibility", home },
    ]);
    const section = createParameterSection(settings, { tab: home.tab, section: home.section });
    document.body.append(section.element);
    const toggle = input(section.element, ".foss-earth-parameter-section__toggle input");
    if (!toggle.checked) toggle.click();
    const main = section.element.querySelector<HTMLElement>(".foss-earth-parameter-section__main")!;
    const list = section.element.querySelector<HTMLElement>(".foss-earth-parameter-list")!;
    const mode = input(main, '[data-parameter="t.custom"] input[type="range"]');
    expect(mode.getAttribute("aria-valuetext")).toBe("Auto");
    expect(section.element.querySelector('input[type="number"]')).toBeNull();
    drag(mode, 1);
    const row = main.querySelector<HTMLElement>('[data-parameter="t.visibility"]')!;
    const field = input(row, 'input[type="number"]');
    expect(row.querySelector(".foss-earth-parameter__header")!.firstElementChild!.getAttribute("data-parameter")).toBe("t.priority");
    expect(main.querySelector(':scope > [data-parameter="t.priority"]')).toBeNull();
    expect(list.querySelector(':scope > [data-parameter="t.priority"]')).toBeNull();
    const mirroredField = input(list, '[data-parameter="t.priority"] input');
    field.value = "3";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(3);
    expect(mirroredField.value).toBe("3");
    field.value = "100";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(3);
    const help = row.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
    expect(help.getAttribute("aria-expanded")).toBe("true");
    const tooltip = document.getElementById(help.getAttribute("aria-controls")!)!;
    expect(tooltip.textContent).toContain("Camera position priority: 3");
    drag(mode, 0);
    expect(section.element.querySelector('input[type="number"]')).toBeNull();
    expect(settings.export().values["t.priority"]).toBe(3);
    drag(mode, 1);
    expect(input(row, 'input[type="number"]').value).toBe("3");
    section.destroy();
  });

  it("exports, imports and resets the section", () => {
    const { settings, section } = setup();
    section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!.click();
    settings.set("t.budget", 256);
    settings.set("t.key", "secret");
    const button = (text: string) => [...section.element.querySelectorAll<HTMLButtonElement>(".foss-earth-settings-transfer button")].find(item => item.textContent === text)!;
    button("Export").click();
    const text = section.element.querySelector<HTMLTextAreaElement>(".foss-earth-settings-transfer__text")!;
    expect(JSON.parse(text.value)).toEqual({ format: "foss-earth.settings", version: 1, values: { "t.budget": 256 } });
    button("Import").click();
    text.value = JSON.stringify({ "t.mode": "b", "t.flag": "yes" });
    button("Apply").click();
    expect(settings.get("t.mode")).toBe("b");
    expect(section.element.querySelector(".foss-earth-settings-transfer [role=status]")!.textContent).toMatch(/Applied 1 value\. t\.flag: Expected on or off\./);
    button("Reset all").click();
    expect(settings.get("t.mode")).toBe("b");
    button("Reset every value here to its default?").click();
    expect(settings.get("t.mode")).toBe("a");
    expect(settings.get("t.budget")).toBe(128);
  });
});

describe("host sections in FOSS Earth's tabs", () => {
  it("adds a section for each host section of a tab, titled by the host", () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register(specs);
    const sections = createSectionsElement([{ id: "renderer.backend", title: "Renderer", element: document.createElement("div"), defaultOpen: true }]);
    const hosts = appendHostSections(settings, "renderer", sections, ["backend"]);
    settings.setSectionTitle("renderer", "instruments", "Instruments");
    settings.register([{ ...base, id: "osfs.renderer.attitudeIndicator", label: "Attitude indicator", description: "Its renderer.", unit: "none", kind: "choice", choices: [{ id: "auto", label: "Auto" }, { id: "canvas2d", label: "Canvas 2D" }], default: "auto", home: { tab: "renderer", section: "instruments", level: "main" } }]);
    settings.setNote("osfs.renderer.attitudeIndicator", "Drawing with Canvas 2D.");
    const titles = [...sections.element.querySelectorAll(".foss-earth-panel-section__title")].map(title => title.textContent);
    expect(titles).toEqual(["Renderer", "Instruments"]);
    expect(sections.element.textContent).toContain("Drawing with Canvas 2D.");
    hosts.destroy();
  });
});

describe("saved settings", () => {
  it("keeps this visit's URL values only when asked", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage, searchParams: new URLSearchParams("set.t.budget=512") });
    settings.register(specs);
    const saved = createSavedSettingsSection(settings);
    document.body.append(saved.element);
    expect(saved.element.textContent).toContain("Budget: 512 MiB");
    const keep = [...saved.element.querySelectorAll("button")].find(button => button.textContent === "Keep these values")!;
    keep.click();
    expect(JSON.parse(storage.data.get("foss-earth.settings.v1")!).values).toEqual({ "t.budget": 512 });
    expect(saved.element.textContent).toContain("Saved 1 value.");
    expect(keep.hidden).toBe(true);
    saved.destroy();
  });

  it("copies an export", async () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register(specs);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const saved = createSavedSettingsSection(settings);
    document.body.append(saved.element);
    [...saved.element.querySelectorAll("button")].find(button => button.textContent === "Export")!.click();
    [...saved.element.querySelectorAll("button")].find(button => button.textContent === "Copy")!.click();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"format\": \"foss-earth.settings\""));
    vi.unstubAllGlobals();
    saved.destroy();
  });
});
