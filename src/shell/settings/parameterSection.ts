import { getAppSettings } from "../../settings/appSettings";
import type { SettingsRegistry } from "../../settings/registry";
import { loadPanelSectionsOpen, savePanelSectionsOpen } from "../panelSectionsOpen";
import { createParameterControl, type ParameterControlHandle } from "./controls";
import { createParameterList, createSettingsTransfer, type ParameterListHandle, type SettingsTransferHandle } from "./parameterList";

export interface ParameterSectionOptions {
  tab: string;
  section: string;
  /** The section's own controls, drawn first. */
  main?: HTMLElement;
  /** Main-level parameters `main` already edits; the rest get a control each. */
  covers?: readonly string[];
  /** Drawn after the section's controls, before Show all parameters. */
  footer?: HTMLElement;
  /** Leave out the Show all parameters toggle, for a section with nothing but main controls. */
  showAll?: boolean;
}

export interface ParameterSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

let sectionCount = 0;

/**
 * One section of a tab: its own controls, a control for each main-level
 * parameter homed here that they don't cover (hosts' included), and the Show
 * all parameters toggle, which lists every parameter of the section with its
 * value, default, provenance, reset and source, and exports, imports and resets
 * the section.
 */
export function createParameterSection(settings: SettingsRegistry = getAppSettings(), options: ParameterSectionOptions): ParameterSectionHandle {
  const { tab, section } = options;
  const covered = new Set(options.covers ?? []);
  const element = document.createElement("div");
  element.className = "foss-earth-parameter-section";
  element.dataset.settingsSection = `${tab}/${section}`;
  if (options.main) element.append(options.main);
  const auto = document.createElement("div");
  auto.className = "foss-earth-choices foss-earth-parameter-section__main";
  element.append(auto);
  if (options.footer) element.append(options.footer);
  const controls = new Map<string, ParameterControlHandle>();

  const allKey = `all:${tab}/${section}`;
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "foss-earth-choice foss-earth-parameter-section__toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.name = `foss-earth-show-all-${++sectionCount}`;
  const toggleText = document.createElement("span");
  toggleText.textContent = "Show all parameters";
  toggleLabel.append(toggle, toggleText);
  const toggleRow = document.createElement("div");
  toggleRow.className = "foss-earth-choices foss-earth-parameter-section__footer";
  toggleRow.append(toggleLabel);
  if (options.showAll !== false) element.append(toggleRow);
  let list: ParameterListHandle | null = null;
  let transfer: SettingsTransferHandle | null = null;

  const syncMain = (): void => {
    const ids = settings.list({ tab, section, level: "main" }).map(spec => spec.id).filter(id => !covered.has(id));
    for (const [id, control] of controls) {
      if (!ids.includes(id)) { control.destroy(); controls.delete(id); }
    }
    for (const id of ids) {
      if (controls.has(id)) continue;
      const control = createParameterControl(settings, id);
      controls.set(id, control);
      auto.append(control.element);
    }
    auto.hidden = controls.size === 0;
  };

  const showAll = (open: boolean): void => {
    toggle.checked = open;
    if (open && !list) {
      list = createParameterList(settings, { tab, section });
      transfer = createSettingsTransfer(settings, { tab, section }, `${tab}-${section}`);
      element.append(list.element, transfer.element);
    } else if (!open && list) {
      list.destroy();
      transfer?.destroy();
      list = null;
      transfer = null;
    }
  };
  const onToggle = (): void => {
    savePanelSectionsOpen({ ...loadPanelSectionsOpen(), [allKey]: toggle.checked });
    showAll(toggle.checked);
  };
  toggle.addEventListener("change", onToggle);

  syncMain();
  showAll(loadPanelSectionsOpen()[allKey] ?? false);
  const unsubscribe = settings.subscribe(changed => {
    let registered = false;
    for (const id of changed) {
      const spec = settings.spec(id);
      if (!spec || spec.home.tab !== tab || spec.home.section !== section) continue;
      const control = controls.get(id);
      if (control) control.update();
      else registered = true;
    }
    if (registered) syncMain();
    list?.update(changed);
  });

  return {
    element,
    destroy() {
      unsubscribe();
      toggle.removeEventListener("change", onToggle);
      for (const control of controls.values()) control.destroy();
      controls.clear();
      list?.destroy();
      transfer?.destroy();
      element.remove();
    },
  };
}

export interface SectionsElementEntry {
  id: string;
  title: string;
  element: HTMLElement;
  defaultOpen?: boolean;
}

export interface SectionsElementHandle {
  element: HTMLElement;
  /** Adds a section at the end, such as a host's. */
  append(entry: SectionsElementEntry): void;
  has(id: string): boolean;
  destroy(): void;
}

/**
 * Collapsible sections as plain DOM, for tabs whose content is an element:
 * the same look and remembered open state as SectionsPanel.
 */
export function createSectionsElement(entries: readonly SectionsElementEntry[]): SectionsElementHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-panel-sections foss-earth-panel-sections--inline";
  const ids = new Set<string>();
  const append = (entry: SectionsElementEntry): void => {
    ids.add(entry.id);
    const details = document.createElement("details");
    details.className = "foss-earth-panel-section";
    details.dataset.section = entry.id;
    details.open = loadPanelSectionsOpen()[entry.id] ?? entry.defaultOpen ?? false;
    const summary = document.createElement("summary");
    summary.className = "foss-earth-panel-section__title";
    summary.textContent = entry.title;
    const body = document.createElement("div");
    body.className = "foss-earth-panel-section__body";
    body.append(entry.element);
    details.append(summary, body);
    details.addEventListener("toggle", () => {
      const saved = loadPanelSectionsOpen();
      if ((saved[entry.id] ?? entry.defaultOpen ?? false) === details.open) return;
      savePanelSectionsOpen({ ...saved, [entry.id]: details.open });
    });
    element.append(details);
  };
  for (const entry of entries) append(entry);
  return {
    element,
    append,
    has: (id) => ids.has(id),
    destroy() { element.remove(); },
  };
}

export interface HostSectionsHandle {
  destroy(): void;
}

/**
 * Adds a section for every section of `tab` that parameters are homed in but
 * the tab does not draw itself, so a host's parameters appear in FOSS Earth's
 * tabs: 0sfs's renderer/instruments becomes the Renderer tab's Instruments.
 */
export function appendHostSections(settings: SettingsRegistry, tab: string, sections: SectionsElementHandle, own: readonly string[]): HostSectionsHandle {
  const handles: ParameterSectionHandle[] = [];
  const sync = (): void => {
    for (const section of settings.sections(tab)) {
      const id = `${tab}.${section}`;
      if (own.includes(section) || sections.has(id)) continue;
      const handle = createParameterSection(settings, { tab, section });
      handles.push(handle);
      sections.append({ id, title: settings.getSectionTitle(tab, section), element: handle.element, defaultOpen: false });
    }
  };
  sync();
  const unsubscribe = settings.subscribe(changed => {
    if ([...changed].some(id => settings.spec(id)?.home.tab === tab)) sync();
  });
  return {
    destroy() {
      unsubscribe();
      for (const handle of handles) handle.destroy();
    },
  };
}
