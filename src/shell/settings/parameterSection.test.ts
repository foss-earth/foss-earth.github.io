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
    expect(control("t.budget").querySelector(".foss-earth-parameter__note")!.textContent).toMatch(/outside 32 MiB to 1,024 MiB/);

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

  it("draws a host's parameter registered after the section exists", () => {
    const { settings, control } = setup();
    settings.register([{ ...base, id: "host.waiver", label: "Waiver", description: "A host switch.", unit: "none", kind: "boolean", default: false, session: true, home: { tab: "map", section: "loading", level: "main" } }]);
    expect(control("host.waiver")).not.toBeNull();
  });

  it("lists every parameter under Show all parameters, with its default, provenance, reset and source", () => {
    const { settings, section } = setup();
    const toggle = section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!;
    toggle.click();
    const rows = [...section.element.querySelectorAll<HTMLElement>(".foss-earth-parameter-row")];
    expect(rows.map(row => row.dataset.parameter)).toEqual(specs.map(spec => spec.id));
    const hidden = rows.find(row => row.dataset.parameter === "t.hidden")!;
    expect(hidden.querySelector(".foss-earth-parameter-row__meta")!.textContent).toBe("Now 2 ms (default). Default 2 ms: Chosen for tests.");
    const link = hidden.querySelector<HTMLAnchorElement>(".foss-earth-parameter-row__source")!;
    expect(link.href).toBe("https://example.test/blob/main/src/test.ts");
    const reset = hidden.querySelector<HTMLButtonElement>("button")!;
    expect(reset.disabled).toBe(true);
    settings.set("t.hidden", 5);
    expect(hidden.querySelector(".foss-earth-parameter-row__meta")!.textContent).toMatch(/^Now 5 ms \(set by you\)\./);
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(settings.get("t.hidden")).toBe(2);
    toggle.click();
    expect(section.element.querySelector(".foss-earth-parameter-row")).toBeNull();
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
