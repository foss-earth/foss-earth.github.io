/**
 * The Scenes tab (docs/proposals/panorama-scenes.md §6): Content (load a
 * scene, the examples, its panoramas and their orbs), Orbs, Motion, Loading
 * and memory, and Credits. The panorama on screen has tabs of its own
 * (panoramaTabs.ts). Also the pieces a scene needs over the canvas: link
 * buttons anchored to their directions while a panorama is entered, and the
 * bar's right end while it is: the panorama's credit, in place of the map's.
 */
import type { SettingsRegistry } from "../settings/registry";
import { SCENES_TAB } from "../settings/catalogue/scenes";
import type { SceneController, SceneControllerState } from "../scenes/sceneController";
import type { SceneEntryStatus, SceneStatus } from "../scenes/loadScene";
import { createExternalLinkIcon } from "./externalLinkIcon";
import { createParameterSection, createSectionsElement, type ParameterSectionHandle } from "./settings/parameterSection";

export interface ScenesPanelHandle {
  element: HTMLElement;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function row(heading?: string): HTMLDivElement {
  const element = el("div", "foss-earth-choices");
  if (heading) element.append(el("div", "foss-earth-choices__heading", heading));
  return element;
}

function note(text: string): HTMLParagraphElement {
  return el("p", "foss-earth-choices__note", text);
}

function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const element = el("button", "foss-earth-choice foss-earth-scene-button", label);
  element.type = "button";
  if (title) element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

const PHASE_TEXT: Record<SceneStatus["phase"], string> = {
  overview: "Overview",
  preparing: "Preparing",
  entering: "Entering",
  immersive: "Inside a panorama",
  exiting: "Leaving",
  disposed: "Closed",
};

function entryState(entry: SceneEntryStatus, status: SceneStatus): string {
  if (!entry.supported) return "Not shown here";
  if (status.active === entry.id) return "Entered";
  if (status.target === entry.id) return PHASE_TEXT[status.phase];
  if (entry.preview === "failed") return "Preview unavailable";
  if (entry.preview === "idle") return "Preview queued";
  if (entry.preview === "loading") return "Loading preview";
  if (entry.placement === "pending") return "Preview ready · waiting for the ground";
  return "Ready";
}

function entryDetails(entry: SceneEntryStatus): string[] {
  const lines: string[] = [];
  const { marker, capture } = entry;
  lines.push(`Captured at ${capture.latitudeDeg.toFixed(6)}°, ${capture.longitudeDeg.toFixed(6)}°, ${capture.heightMeters === null ? "height unknown" : `${capture.heightMeters.toFixed(1)} m above the ellipsoid`}.`);
  lines.push(marker.mode === "ground-relative"
    ? `Shown ${marker.offsetM} m above the displayed ground${marker.eastM || marker.northM ? `, ${marker.eastM} m east and ${marker.northM} m north of the capture` : ""}.`
    : `Shown ${marker.offsetM} m above the capture point${marker.eastM || marker.northM ? `, ${marker.eastM} m east and ${marker.northM} m north` : ""}.`);
  lines.push(`Radius ${marker.radiusMeters} m${marker.authoredRadius ? ", as the scene sets it" : ", from Orbs → Orb radius"}; the orb's size on screen bounds it.`);
  if (entry.previewDetail) {
    lines.push(`Preview ${entry.previewDetail.representation}, ${Math.round(entry.previewDetail.faceTexels)} px faces${entry.previewDetail.limitation ? `: ${entry.previewDetail.limitation}` : "."}`);
  }
  if (entry.message) lines.push(entry.message);
  if (entry.description) lines.unshift(entry.description);
  return lines;
}

export function createScenesPanel(options: { settings: SettingsRegistry; controller: SceneController }): ScenesPanelHandle {
  const { settings, controller } = options;
  const sectionHandles: ParameterSectionHandle[] = [];
  const section = (id: string, main?: HTMLElement, showAll = true): HTMLElement => {
    const handle = createParameterSection(settings, { tab: SCENES_TAB, section: id, showAll, ...(main ? { main } : {}) });
    sectionHandles.push(handle);
    return handle.element;
  };

  // ─── Content ──────────────────────────────────────────────────────
  const content = el("div", "foss-earth-choice-panel foss-earth-scenes");
  const loadRow = row("Load scene");
  const urlField = el("input", "foss-earth-scene-url");
  urlField.type = "url";
  urlField.placeholder = "https://…/scene.json";
  urlField.setAttribute("aria-label", "Scene manifest URL");
  const loadButton = button("Load", () => { if (urlField.value.trim()) void controller.load(urlField.value); });
  urlField.addEventListener("keydown", event => { if (event.key === "Enter" && urlField.value.trim()) void controller.load(urlField.value); });
  loadRow.append(urlField, loadButton);
  // The scenes this app offers: FOSS Earth's examples, or a host application's own.
  const offeredRow = row("Scenes");
  for (const offered of controller.examples) offeredRow.append(button(offered.title, () => { void controller.load(offered.id, { exampleId: true }); }, offered.description));
  const messages = el("div", "foss-earth-choices");
  const sceneBlock = el("div", "foss-earth-choice-panel");
  content.append(loadRow, offeredRow, messages, sceneBlock);

  // ─── Credits ──────────────────────────────────────────────────────
  const credits = el("div", "foss-earth-choices");

  function renderMessages(state: SceneControllerState): void {
    messages.replaceChildren();
    if (state.loading) messages.append(note(`Loading ${state.loading}…`));
    for (const error of state.errors.slice(0, 12)) messages.append(note(`${error.path}: ${error.message}`));
    if (state.errors.length > 12) messages.append(note(`and ${state.errors.length - 12} more problems.`));
  }

  function renderScene(status: SceneStatus | null): void {
    const expanded = new Set([...sceneBlock.querySelectorAll<HTMLDetailsElement>("details[open][data-panorama]")].map(item => item.dataset.panorama));
    const focused = document.activeElement instanceof HTMLButtonElement && sceneBlock.contains(document.activeElement)
      ? document.activeElement.dataset.panorama : undefined;
    sceneBlock.replaceChildren();
    credits.replaceChildren();
    if (!status || status.phase === "disposed") {
      sceneBlock.append(note("No scene is loaded."));
      credits.append(note("Nothing from a scene is on screen."));
      return;
    }
    const heading = row(status.title);
    heading.append(note(`${PHASE_TEXT[status.phase]}. ${status.entries.length} ${status.entries.length === 1 ? "entity" : "entities"}, revision ${status.revision}.`));
    const supported = status.entries.filter(entry => entry.supported);
    if (supported.length > 0) {
      const ready = supported.filter(entry => entry.preview === "ready").length;
      const failed = supported.filter(entry => entry.preview === "failed").length;
      heading.append(note(`${ready} of ${supported.length} panorama previews ready${failed ? `; ${failed} unavailable` : ""}. Panoramas appear as each preview arrives. Larger images load when you enter a panorama.`));
    }
    if (!status.renderingAvailable) heading.append(note(status.unavailableReason ?? "Panoramas cannot be drawn here."));
    if (status.overview === "pending") {
      heading.append(note("The overview waits for the map to show the ground at the scene's place."));
      heading.append(button("Go to the scene", () => { void controller.handle()?.showOverview(); }));
    } else if (status.overview === "applied" && status.phase === "overview") {
      heading.append(button("Back to the scene's view", () => { void controller.handle()?.showOverview(); }));
    }
    heading.append(button("Unload", () => controller.unload(), "Removes the scene and everything it loaded."));
    if (status.lastError) heading.append(note(status.lastError));
    sceneBlock.append(heading);

    const list = row("Panoramas");
    for (const entry of status.entries) {
      const item = el("details", "foss-earth-scene-entry");
      item.dataset.panorama = entry.id;
      item.open = expanded.has(entry.id);
      const summary = el("summary", "foss-earth-scene-entry__summary");
      const enter = button(entry.title, () => { void controller.handle()?.enter(entry.id); }, entry.supported ? `Enter ${entry.title}` : entry.message ?? undefined);
      enter.dataset.panorama = entry.id;
      enter.disabled = !entry.supported || !status.renderingAvailable || status.active === entry.id;
      summary.append(enter, el("span", "foss-earth-scene-entry__state", entryState(entry, status)));
      item.append(summary);
      for (const line of entryDetails(entry)) item.append(note(line));
      list.append(item);
    }
    sceneBlock.append(list);
    if (focused) [...list.querySelectorAll<HTMLButtonElement>("button[data-panorama]")].find(each => each.dataset.panorama === focused)?.focus({ preventScroll: true });

    for (const group of status.groups) {
      const groupRow = row(group.title);
      for (const member of group.members) {
        const entry = status.entries.find(each => each.id === member);
        const go = button(entry?.title ?? member, () => { void controller.handle()?.enter(member); });
        go.disabled = !entry?.supported || !status.renderingAvailable;
        groupRow.append(go);
      }
      sceneBlock.append(groupRow);
    }
    if (status.warnings.length > 0) {
      const warnings = row("Warnings");
      for (const warning of status.warnings) warnings.append(note(`${warning.path}: ${warning.message}`));
      sceneBlock.append(warnings);
    }

    if (status.credits.length === 0) credits.append(note("Nothing from this scene is on screen."));
    for (const credit of status.credits) {
      const line = el("p", "foss-earth-choices__note");
      line.append(credit.text);
      if (credit.license) line.append(` · ${credit.license}`);
      if (credit.url) {
        const link = el("a", undefined, "source");
        link.href = credit.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        line.append(" · ", link);
      }
      credits.append(line);
    }
  }

  let lastRendered = "";
  const off = controller.subscribe(state => {
    renderMessages(state);
    // The view changes every frame while looking; redraw the list only when something else does.
    const key = JSON.stringify(state.status ? { ...state.status, view: null, immersionDetail: null } : null);
    if (key === lastRendered) return;
    lastRendered = key;
    renderScene(state.status);
  });

  const sections = createSectionsElement([
    { id: "scenes.content", title: settings.getSectionTitle(SCENES_TAB, "content"), element: section("content", content), defaultOpen: true },
    { id: "scenes.appearance", title: settings.getSectionTitle(SCENES_TAB, "appearance"), element: section("appearance"), defaultOpen: false },
    { id: "scenes.motion", title: settings.getSectionTitle(SCENES_TAB, "motion"), element: section("motion"), defaultOpen: false },
    { id: "scenes.loading", title: settings.getSectionTitle(SCENES_TAB, "loading"), element: section("loading"), defaultOpen: false },
    { id: "scenes.tiles", title: settings.getSectionTitle(SCENES_TAB, "tiles"), element: section("tiles"), defaultOpen: false },
    { id: "scenes.credits", title: settings.getSectionTitle(SCENES_TAB, "credits"), element: section("credits", credits, false), defaultOpen: false },
  ]);

  return {
    element: sections.element,
    destroy() {
      off();
      for (const handle of sectionHandles) handle.destroy();
      sections.destroy();
    },
  };
}

/**
 * Link buttons over the canvas, each at its direction in the entered
 * panorama, repositioned every drawn frame. They are anchored to the view,
 * not to a screen corner, and take keyboard focus like any button.
 */
export function createSceneHotspots(options: { controller: SceneController; container: HTMLElement }): { destroy(): void } {
  const { controller, container } = options;
  const layer = el("div", "foss-earth-scene-hotspots");
  container.append(layer);
  const buttons = new Map<string, HTMLButtonElement>();
  let offFrame: (() => void) | null = null;
  let handleSeen: unknown = null;

  const place = (): void => {
    const handle = controller.handle();
    const spots = handle?.hotspots() ?? [];
    const rect = layer.getBoundingClientRect();
    const seen = new Set<string>();
    for (const spot of spots) {
      seen.add(spot.id);
      let hotspot = buttons.get(spot.id);
      if (!hotspot) {
        hotspot = el("button", "foss-earth-scene-hotspot", spot.label);
        hotspot.type = "button";
        const id = spot.id;
        hotspot.addEventListener("click", () => { void controller.handle()?.follow(id); });
        buttons.set(spot.id, hotspot);
        layer.append(hotspot);
      }
      hotspot.style.transform = `translate(${spot.x - rect.left}px, ${spot.y - rect.top}px) translate(-50%, -50%)`;
    }
    for (const [id, hotspot] of buttons) {
      if (!seen.has(id)) { hotspot.remove(); buttons.delete(id); }
    }
  };

  const off = controller.subscribe(state => {
    const handle = controller.handle();
    if (handle !== handleSeen) {
      offFrame?.();
      offFrame = handle ? handle.onFrame(place) : null;
      handleSeen = handle;
    }
    if (state.status?.phase !== "immersive") place();
  });

  return {
    destroy() {
      off();
      offFrame?.();
      layer.remove();
      buttons.clear();
    },
  };
}

export interface SceneHudHandle {
  element: HTMLElement;
  destroy(): void;
}

/**
 * The HUD bar's right end while a panorama is entered: its credit where the
 * basemap's is. The map is not drawn then, so `mapSource` (the basemap's
 * group) is hidden, and so is whatever else is in `mapOnly`, such as the
 * camera's position, whose Location tab a panorama hides. There is no close
 * button: the panorama's tab and Escape are the ways out.
 */
export function createSceneHud(options: {
  controller: SceneController;
  container: HTMLElement;
  mapSource?: HTMLElement | null;
  /** More of the bar that is about the map, hidden with it. */
  mapOnly?: readonly HTMLElement[];
}): SceneHudHandle {
  const { controller, container } = options;
  const mapElements = [...(options.mapSource ? [options.mapSource] : []), ...(options.mapOnly ?? [])];
  const element = el("span", "scene-hud");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Panorama");
  element.hidden = true;
  const credits = el("span", "hud-chip-group scene-credits-slot");
  credits.id = "sceneCreditsSlot";
  credits.setAttribute("aria-label", "Panorama credits");
  element.append(credits);
  container.prepend(element);

  let shownCredits = "";
  const off = controller.subscribe(state => {
    const inside = state.status?.phase === "immersive";
    for (const mapElement of mapElements) mapElement.hidden = inside;
    const shown = inside ? state.status?.credits ?? [] : [];
    element.hidden = shown.length === 0;
    const key = JSON.stringify(shown);
    if (key === shownCredits) return;
    shownCredits = key;
    credits.replaceChildren(...shown.map(credit => {
      const text = credit.license ? `${credit.text} \u00b7 ${credit.license}` : credit.text;
      if (!credit.url) return el("span", "hud-chip scene-credit-chip", text);
      const link = el("a", "hud-chip hud-chip-button scene-credit-chip", text);
      link.href = credit.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = `Panorama: ${text}. Opens its source.`;
      link.append(createExternalLinkIcon());
      return link;
    }));
  });

  return {
    element,
    destroy() {
      off();
      for (const mapElement of mapElements) mapElement.hidden = false;
      element.remove();
    },
  };
}
