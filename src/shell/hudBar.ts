export interface HudBarButtonItem {
  kind: "button";
  id: string;
  title: string;
  ariaLabel: string;
  /** For a readout that is also a button, such as the position that toggles Location. */
  ariaLive?: "off" | "polite" | "assertive";
  appearance?: "circle" | "chip";
  className?: string;
  text?: string;
  content?: () => Node;
}

export interface HudBarMenuOption {
  id: string;
  label: string;
}

/**
 * @deprecated A toolbar button toggles the tab that holds its settings; it
 * never pops up a menu of its own. See docs/ui-layout.md.
 */
export interface HudBarMenuItem {
  kind: "menu";
  id: string;
  className?: string;
  button: HudBarButtonItem;
  menuId: string;
  menuClassName: string;
  optionClassName: string;
  optionDataAttribute: string;
  options: readonly HudBarMenuOption[];
}

export interface HudBarSlotItem {
  kind: "slot";
  id: string;
  className?: string;
  ariaLabel?: string;
  ariaLive?: "off" | "polite" | "assertive";
  title?: string;
}

export type HudBarItem = HudBarButtonItem | HudBarMenuItem | HudBarSlotItem;

export interface HudBarOptions {
  items: readonly HudBarItem[];
  className?: string;
  ariaLabel?: string;
}

export interface HudBarHandle {
  element: HTMLElement;
  getElement<T extends HTMLElement = HTMLElement>(id: string): T | null;
  destroy(): void;
}

function applyClassNames(element: HTMLElement, ...classNames: Array<string | undefined>): void {
  element.className = classNames.filter(Boolean).join(" ");
}

function createButton(item: HudBarButtonItem): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = item.id;
  button.type = "button";
  button.title = item.title;
  button.setAttribute("aria-label", item.ariaLabel);
  if (item.ariaLive) button.setAttribute("aria-live", item.ariaLive);
  applyClassNames(button, item.appearance === "chip" ? "hud-chip" : "hud-circle-button", item.className);
  if (item.content) {
    button.append(item.content());
  } else {
    button.textContent = item.text ?? "";
  }
  return button;
}

function createMenu(item: HudBarMenuItem): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.id = item.id;
  applyClassNames(wrapper, item.className);

  const button = createButton(item.button);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", item.menuId);
  wrapper.append(button);

  const menu = document.createElement("div");
  menu.id = item.menuId;
  menu.className = item.menuClassName;
  menu.role = "menu";
  menu.hidden = true;

  for (const option of item.options) {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.role = "menuitem";
    optionButton.className = item.optionClassName;
    optionButton.dataset[item.optionDataAttribute] = option.id;
    optionButton.textContent = option.label;
    menu.append(optionButton);
  }

  wrapper.append(menu);
  return wrapper;
}

function createSlot(item: HudBarSlotItem): HTMLElement {
  const slot = document.createElement("span");
  slot.id = item.id;
  applyClassNames(slot, item.className);
  if (item.ariaLabel) slot.setAttribute("aria-label", item.ariaLabel);
  if (item.ariaLive) slot.setAttribute("aria-live", item.ariaLive);
  if (item.title) slot.title = item.title;
  return slot;
}

/**
 * Set on the root while a HUD bar is mounted: the bar's height, which grows as
 * it wraps on a narrow screen. Hosts lift anything anchored above the bar by it.
 */
export const HUD_BAR_HEIGHT_PROPERTY = "--foss-hud-bar-height";

export function createHudBar(container: HTMLElement, options: HudBarOptions): HudBarHandle {
  const element = document.createElement("div");
  const elementsById = new Map<string, HTMLElement>();
  applyClassNames(element, "hud-bar", options.className);
  element.setAttribute("aria-label", options.ariaLabel ?? "Application controls");

  for (const item of options.items) {
    const itemElement = item.kind === "button"
      ? createButton(item)
      : item.kind === "menu"
        ? createMenu(item)
        : createSlot(item);
    element.append(itemElement);
    for (const identifiedElement of [itemElement, ...itemElement.querySelectorAll<HTMLElement>("[id]")]) {
      elementsById.set(identifiedElement.id, identifiedElement);
    }
  }

  container.replaceChildren(element);
  const root = document.documentElement;
  const publishHeight = (): void => {
    root.style.setProperty(HUD_BAR_HEIGHT_PROPERTY, `${Math.ceil(element.getBoundingClientRect().height)}px`);
  };
  const heightObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publishHeight);
  heightObserver?.observe(element);
  publishHeight();

  return {
    element,
    getElement<T extends HTMLElement = HTMLElement>(id: string): T | null {
      return (elementsById.get(id) as T | undefined) ?? null;
    },
    destroy(): void {
      heightObserver?.disconnect();
      root.style.removeProperty(HUD_BAR_HEIGHT_PROPERTY);
      element.remove();
    },
  };
}