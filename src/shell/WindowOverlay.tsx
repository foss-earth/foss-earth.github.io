import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  LocationPanel,
  openOrSelectTabInWorkspace,
  WorkspaceDockSlot,
  useWindowWorkspace,
  type GeodeticLocation,
  type LocationSearchProvider,
  type WindowTabDefinition,
  type WindowWorkspaceState,
  type WindowSlotId,
} from "../windowing";

import { searchLocations } from "../search/locationSearch";
import { AdoptedElement } from "./AdoptedElement";
import { SectionsPanel, type PanelSection } from "./SectionsPanel";
import { GAME_LOG_SIZE_EVENT, type GameLogSizeChange } from "../log/createGameLog";
import { resolveDockLayout, type DockLayoutMode, type DockResizePriority } from "./dockLayout";
import { foldWorkspace, restoreWorkspace, forgetCompactWorkspaceTab, type CompactWorkspaceMemory } from "./compactWorkspace";
import { hideWorkspaceTabs, restoreWorkspaceTabs, type HiddenTab } from "./contextTabs";
import { loadSavedWorkspace, saveWorkspace } from "./savedWorkspace";
import type { PanoramaTabs, PanoramaTabsSnapshot } from "./panoramaTabs";
import {
  closeTabInWorkspace,
  setWorkspaceSlotCollapsed,
  setWorkspaceSlotSize,
  slotIdForOpenTab,
} from "../windowing/core/workspaceState";

/** Tabs the overlay builds from a host's sections. */
type SectionTabId = "controls" | "interface" | "settings";
/** Tabs that show one element the host built, such as `createMapSourcePanel`'s. */
type ElementTabId = "map" | "renderer" | "scenes" | "about" | "bug-report" | "panorama" | "panorama-settings";
/** Every tab the overlay can offer without the host defining it. */
type BuiltInTabId = "location" | SectionTabId | ElementTabId;

/** Tabs about the map, which a panorama hides: the map is not drawn inside one, and the camera is the panorama's. */
const HIDDEN_IN_PANORAMA: ReadonlySet<string> = new Set(["location", "map"]);
/** Tabs that exist only inside a panorama: its own, and 360 image settings. */
const PANORAMA_ONLY: ReadonlySet<string> = new Set(["panorama", "panorama-settings"]);
const OUTSIDE_PANORAMA: PanoramaTabsSnapshot = { title: null, onScreen: false };
/** Enough of the panorama tab's definition to open it; its label comes from the render. */
const PANORAMA_TAB_DEFINITION: readonly WindowTabDefinition<"panorama">[] = [{ id: "panorama", label: "360" }];

/** Where the tabs a context hid are, so each comes back where it was when its context returns. */
interface PanoramaContextMemory<TabId extends string> {
  globe: HiddenTab<TabId>[];
  panorama: HiddenTab<TabId>[];
  /** The slot the panorama's tab opened in, and whether it was collapsed before. */
  opened: { slotId: WindowSlotId; collapsed: boolean } | null;
  /** The panorama's tab opened minimized, and shows when the panorama is on screen. */
  arriving: boolean;
}

/**
 * The workspace as leaving a panorama leaves it: the panorama's tabs hidden,
 * the map's back where they were, and the panel the panorama's tab opened as
 * it was, if that tab was what it showed. Changes nothing in `memory`.
 */
function globeWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  memory: PanoramaContextMemory<TabId>,
  primaryAvailable: boolean,
): { state: WindowWorkspaceState<TabId>; hidden: HiddenTab<TabId>[] } {
  const hidden = hideWorkspaceTabs(state, PANORAMA_ONLY as ReadonlySet<TabId>);
  const restored = restoreWorkspaceTabs(hidden.state, memory.globe, primaryAvailable);
  const opened = memory.opened;
  const panelBack = opened && hidden.hidden.some((entry) => entry.tabId === "panorama" && entry.slotId === opened.slotId && entry.active);
  return { state: panelBack ? setWorkspaceSlotCollapsed(restored, opened.slotId, opened.collapsed) : restored, hidden: hidden.hidden };
}

const DEFAULT_LOCATION: GeodeticLocation = {
  latDeg: 44.977753,
  lonDeg: -93.265011,
};

function currentLocation(getViewState: () => GeodeticLocation | null): GeodeticLocation {
  const view = getViewState();
  return view ? { latDeg: view.latDeg, lonDeg: view.lonDeg, ...(view.zoomMeters === undefined ? {} : { zoomMeters: view.zoomMeters }), ...(view.altMeters === undefined ? {} : { altMeters: view.altMeters }) } : DEFAULT_LOCATION;
}

export interface WindowOverlayHandle<TabId extends string = never> {
  openOrSelectTab(tabId: BuiltInTabId | TabId): void;
  /**
   * What a toolbar button does: shows the tab, or closes it when it is already
   * the one showing.
   */
  toggleTab(tabId: BuiltInTabId | TabId): void;
}

export interface WindowOverlayProps<TabId extends string = never> {
  getViewState: () => GeodeticLocation | null;
  setViewState: (location: GeodeticLocation) => void;
  /** Hosts supply tab contents; the shared overlay owns both window slots. */
  additionalTabs?: readonly WindowTabDefinition<TabId>[];
  renderAdditionalTab?: (tabId: TabId) => ReactNode;
  /**
   * Adds the shared Controls tab, built from these collapsible sections. A host
   * that already supplies its own `controls` tab leaves this out.
   */
  controlsSections?: readonly PanelSection[];
  /** Adds the shared Settings tab, the same way. */
  settingsSections?: readonly PanelSection[];
  /** The toolbar, theme and what the interface shows, in an Interface tab. */
  interfaceSections?: readonly PanelSection[];
  /** Adds the shared Map tab showing this element, from `createMapSourcePanel`. */
  mapTab?: HTMLElement;
  /** Adds the shared Renderer tab showing this element, from `createRendererPanel`. */
  rendererTab?: HTMLElement;
  /** Adds the shared Scenes tab showing this element, from `createScenesPanel`. */
  scenesTab?: HTMLElement;
  /** Adds the shared About tab showing this element, from `createAboutPanel`: which version runs, and what it is built from. */
  aboutTab?: HTMLElement;
  /** The one Bug report tab, from `createBugReportPanel`; also available under +. */
  bugReportTab?: HTMLElement;
  /** Prepare a report when its tab becomes visible; hidden or minimized tabs do not call it. */
  onBugReportShow?: () => void;
  /**
   * A panorama's tabs, from `createPanoramaTabs`. Entering a panorama opens its
   * tab, titled "360: <title>", minimized while the camera flies in and shown
   * once the panorama is on screen; closing that tab leaves it. Inside one the
   * tabs about the map are hidden and 360 image settings is offered; each
   * comes back where it was when the context returns.
   */
  panoramaTabs?: PanoramaTabs;
  locationSearchProvider?: LocationSearchProvider;
  enableAirportPresets?: boolean;
  overlayApiRef?: { current: WindowOverlayHandle<TabId> | null };
  /** Return `false` to keep the tab open. */
  onBeforeCloseTab?: (tabId: BuiltInTabId | TabId) => boolean | void;
}

export function WindowOverlay<TabId extends string = never>({
  getViewState,
  setViewState,
  additionalTabs = [],
  renderAdditionalTab,
  controlsSections,
  interfaceSections,
  settingsSections,
  mapTab,
  rendererTab,
  scenesTab,
  aboutTab,
  bugReportTab,
  onBugReportShow,
  panoramaTabs,
  locationSearchProvider = searchLocations,
  enableAirportPresets = false,
  overlayApiRef,
  onBeforeCloseTab,
}: WindowOverlayProps<TabId>) {
  type OverlayTabId = BuiltInTabId | TabId;
  const sectionTabs: Partial<Record<SectionTabId, readonly PanelSection[]>> = {
    ...(controlsSections ? { controls: controlsSections } : {}),
    ...(interfaceSections ? { interface: interfaceSections } : {}),
    ...(settingsSections ? { settings: settingsSections } : {}),
  };
  const subscribePanorama = useCallback((listener: () => void) => panoramaTabs?.subscribe(listener) ?? (() => {}), [panoramaTabs]);
  const getPanorama = useCallback(() => panoramaTabs?.getSnapshot() ?? OUTSIDE_PANORAMA, [panoramaTabs]);
  const panorama = useSyncExternalStore(subscribePanorama, getPanorama, getPanorama);
  const inPanorama = panorama.title !== null;
  /** Whether a built-in tab belongs to the context on screen: the globe, or a panorama. */
  const shownHere = (tabId: string): boolean => (PANORAMA_ONLY.has(tabId) ? inPanorama : !(inPanorama && HIDDEN_IN_PANORAMA.has(tabId)));
  const elementTabs: Partial<Record<ElementTabId, HTMLElement>> = {
    ...(mapTab ? { map: mapTab } : {}),
    ...(rendererTab ? { renderer: rendererTab } : {}),
    ...(scenesTab ? { scenes: scenesTab } : {}),
    ...(aboutTab ? { about: aboutTab } : {}),
    ...(bugReportTab ? { "bug-report": bugReportTab } : {}),
    ...(panoramaTabs ? { panorama: panoramaTabs.panorama, "panorama-settings": panoramaTabs.settings } : {}),
  };
  const sectionTabLabels: Record<SectionTabId, string> = { controls: "Controls", interface: "Interface", settings: "Settings" };
  const elementTabLabels: Record<ElementTabId, string> = {
    map: "Map", renderer: "Renderer", scenes: "Scenes", about: "About", "bug-report": "Bug report", panorama: panorama.title ?? "360", "panorama-settings": "360 image settings",
  };
  const builtInSectionTabs = (Object.keys(sectionTabLabels) as SectionTabId[]).filter((id) => sectionTabs[id]);
  const builtInElementTabs = (Object.keys(elementTabLabels) as ElementTabId[]).filter((id) => elementTabs[id]);
  const builtInTabs: readonly string[] = ["location", ...builtInSectionTabs, ...builtInElementTabs];
  const tabDefinitions: readonly WindowTabDefinition<OverlayTabId>[] = [
    { id: "location", label: "Location", available: shownHere("location") },
    ...builtInSectionTabs.map((id) => ({ id, label: sectionTabLabels[id] })),
    ...additionalTabs.filter((tab) => !builtInTabs.includes(tab.id)),
    ...builtInElementTabs.map((id) => ({ id, label: elementTabLabels[id], available: shownHere(id) })),
  ];
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The tab strips' + menus are drawn here, outside the panels that would clip them.
  const [overlayElement, setOverlayElement] = useState<HTMLDivElement | null>(null);
  const setOverlay = useCallback((element: HTMLDivElement | null) => {
    overlayRef.current = element;
    setOverlayElement(element);
  }, []);
  // The + menus end above the HUD bar, which a host may draw over the panels' layer: an item under it is out of reach.
  const hudBarTop = useCallback(() => {
    const bar = document.querySelector(".hud-bar")?.getBoundingClientRect();
    return bar && bar.height > 0 ? bar.top : null;
  }, []);
  // A reload comes back to the tabs that were open on the globe. A saved
  // workspace is always the globe's, so the panorama's own tabs are never in it.
  const [savedWorkspace] = useState(() => loadSavedWorkspace(new Set(tabDefinitions
    .filter((tab) => (builtInTabs.includes(tab.id) ? !PANORAMA_ONLY.has(tab.id) : tab.available !== false))
    .map((tab) => tab.id))));
  const workspace = useWindowWorkspace<OverlayTabId>(savedWorkspace ? { initialState: savedWorkspace } : {});
  const compactMemory = useRef<CompactWorkspaceMemory<OverlayTabId> | null>(null);
  const forgetClosedTabs = (next: WindowWorkspaceState<OverlayTabId>): void => {
    if (!compactMemory.current) return;
    for (const tabId of compactMemory.current.primary.tabs) {
      if (!next.primary.tabs.includes(tabId) && !next.secondary.tabs.includes(tabId)) {
        compactMemory.current = forgetCompactWorkspaceTab(compactMemory.current, tabId);
      }
    }
  };
  const updateWorkspace = (next: WindowWorkspaceState<OverlayTabId>): void => {
    forgetClosedTabs(next);
    workspace.setState(next);
  };
  const [logWidth, setLogWidth] = useState<number | null>(() => {
    const log = document.querySelector<HTMLElement>("#app-log[data-sized]");
    return log ? Number.parseFloat(log.style.width) || null : null;
  });
  const [resizePriority, setResizePriority] = useState<DockResizePriority>(logWidth === null ? "windows" : "log");
  const [layoutMode, setLayoutMode] = useState<DockLayoutMode>("single");

  useLayoutEffect(() => {
    const onSize = (event: Event) => {
      const { width, resized } = (event as CustomEvent<GameLogSizeChange>).detail;
      setLogWidth(width);
      if (resized) setResizePriority("log");
    };
    window.addEventListener(GAME_LOG_SIZE_EVENT, onSize);
    return () => window.removeEventListener(GAME_LOG_SIZE_EVENT, onSize);
  }, []);
  const [primaryAddOpen, setPrimaryAddOpen] = useState(false);
  const [secondaryAddOpen, setSecondaryAddOpen] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);

  useLayoutEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const update = () => setAvailableWidth(element.clientWidth);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const layout = resolveDockLayout({
    availableWidth,
    primaryWidth: workspace.state.primary.width ?? 320,
    secondaryWidth: workspace.state.secondary.width ?? 320,
    logWidth,
    priority: resizePriority,
    previousMode: layoutMode,
  });
  const primaryAvailable = layout.mode === "dual";
  const bugReportVisible = Boolean(bugReportTab) && (
    (primaryAvailable && workspace.state.primary.activeTab === "bug-report" && !workspace.state.primary.collapsed)
    || (workspace.state.secondary.activeTab === "bug-report" && !workspace.state.secondary.collapsed)
  );
  const bugReportWasVisible = useRef(false);
  useLayoutEffect(() => {
    if (bugReportVisible && !bugReportWasVisible.current) onBugReportShow?.();
    bugReportWasVisible.current = bugReportVisible;
  }, [bugReportVisible, onBugReportShow]);
  // Remember actual transitions so resizing a single right window cannot force
  // a wide log into the center by shrinking it solely to create another window.
  if (layoutMode !== layout.mode) setLayoutMode(layout.mode);

  const resizeWindow = (slotId: WindowSlotId, width: number): void => {
    setResizePriority("windows");
    workspace.setState((current) => {
      // Start from what the user sees when switching from resizing the log.
      // Otherwise an untouched dock can jump back to its old preferred width.
      const other = slotId === "primary" ? "secondary" : "primary";
      const baseline = resizePriority === "log"
        ? setWorkspaceSlotSize(current, other, { width: other === "primary" ? layout.primaryWidth : layout.secondaryWidth })
        : current;
      return setWorkspaceSlotSize(baseline, slotId, { width });
    });
  };

  // Publish the same allocation used by the slots before the browser paints.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.dockLayout = layout.mode;
    root.style.setProperty("--foss-log-left", `${layout.logLeft}px`);
    root.style.setProperty("--foss-log-center", `${layout.logCenter}px`);
    root.style.setProperty("--foss-log-width", `${layout.logWidth}px`);
  }, [layout.mode, layout.logLeft, layout.logCenter, layout.logWidth]);

  useLayoutEffect(() => {
    if (availableWidth <= 0) return;
    if (!primaryAvailable && !compactMemory.current) {
      const folded = foldWorkspace(workspace.state);
      compactMemory.current = folded.memory;
      workspace.setState(folded.state);
    } else if (primaryAvailable && compactMemory.current) {
      const memory = compactMemory.current;
      compactMemory.current = null;
      workspace.setState(restoreWorkspace(workspace.state, memory));
    }
  }, [availableWidth, primaryAvailable, workspace]);

  useLayoutEffect(() => () => {
    const root = document.documentElement;
    delete root.dataset.dockLayout;
    root.style.removeProperty("--foss-log-left");
    root.style.removeProperty("--foss-log-center");
    root.style.removeProperty("--foss-log-width");
  }, []);

  // Entering a panorama hides the tabs about the map and opens the panorama's
  // tab; leaving hides the panorama's tabs. Each hidden tab comes back where
  // it was when its context returns.
  const contextMemory = useRef<PanoramaContextMemory<OverlayTabId>>({ globe: [], panorama: [], opened: null, arriving: false });
  const contextShown = useRef(false);
  useLayoutEffect(() => {
    if (contextShown.current === inPanorama) return;
    contextShown.current = inPanorama;
    const memory = contextMemory.current;
    const preferred: WindowSlotId = primaryAvailable ? "primary" : "secondary";
    if (inPanorama) {
      const hidden = hideWorkspaceTabs(workspace.state, HIDDEN_IN_PANORAMA as ReadonlySet<OverlayTabId>);
      memory.globe = hidden.hidden;
      const restored = restoreWorkspaceTabs(hidden.state, memory.panorama, primaryAvailable);
      memory.panorama = [];
      const slotId = slotIdForOpenTab(restored, "panorama") ?? preferred;
      memory.opened = { slotId, collapsed: restored[slotId].collapsed };
      const opened = openOrSelectTabInWorkspace(restored, "panorama", preferred, PANORAMA_TAB_DEFINITION as readonly WindowTabDefinition<OverlayTabId>[]);
      // While the camera flies in, the panel stays out of the way of the map it flies over.
      memory.arriving = !panorama.onScreen;
      workspace.setState(memory.arriving ? setWorkspaceSlotCollapsed(opened, slotId, true) : opened);
      return;
    }
    memory.arriving = false;
    const left = globeWorkspace(workspace.state, memory, primaryAvailable);
    memory.panorama = left.hidden;
    memory.globe = [];
    memory.opened = null;
    workspace.setState(left.state);
  }, [inPanorama, panorama.onScreen, primaryAvailable, workspace]);

  // The panorama on screen: its tab shows, unless the person chose otherwise
  // meanwhile, by showing it themselves or picking another tab in its panel.
  useLayoutEffect(() => {
    const memory = contextMemory.current;
    if (!inPanorama || !panorama.onScreen || !memory.arriving) return;
    memory.arriving = false;
    const slotId = slotIdForOpenTab(workspace.state, "panorama");
    if (slotId && workspace.state[slotId].activeTab === "panorama" && workspace.state[slotId].collapsed) {
      workspace.setState(setWorkspaceSlotCollapsed(workspace.state, slotId, false));
    }
  }, [inPanorama, panorama.onScreen, workspace]);

  // Save the workspace as a wide window on the globe would show it: a
  // panorama is left, then tabs folded onto the right go back to their homes,
  // so a reload outside the panorama or into another width starts from the
  // person's own layout. Written only when the workspace changes.
  useEffect(() => {
    const onGlobe = inPanorama ? globeWorkspace(workspace.state, contextMemory.current, true).state : workspace.state;
    saveWorkspace(compactMemory.current ? restoreWorkspace(onGlobe, compactMemory.current) : onGlobe);
  }, [workspace.state, inPanorama]);

  // Closing the panorama's tab leaves the panorama, as Escape does.
  const beforeCloseTab = (tabId: OverlayTabId): boolean | void => {
    if (onBeforeCloseTab?.(tabId) === false) return false;
    if (tabId === "panorama") panoramaTabs?.leave();
  };

  // Refresh the imperative API with the committed workspace and layout each render.
  useLayoutEffect(() => {
    if (!overlayApiRef) return;
    const openOrSelectTab = (tabId: OverlayTabId): void => {
      workspace.setState((current) => openOrSelectTabInWorkspace(
        current,
        tabId,
        primaryAvailable ? "primary" : "secondary",
        tabDefinitions,
      ));
    };
    overlayApiRef.current = {
      openOrSelectTab,
      toggleTab(tabId) {
        const { state } = workspace;
        const slotId = slotIdForOpenTab(state, tabId);
        if (!slotId || state[slotId].activeTab !== tabId || state[slotId].collapsed) {
          openOrSelectTab(tabId);
          return;
        }
        // Closing from a toolbar button asks first, as the tab's own close button does.
        if (beforeCloseTab(tabId) === false) return;
        updateWorkspace(closeTabInWorkspace(state, slotId, tabId));
      },
    };
    return () => {
      overlayApiRef.current = null;
    };
  });

  const renderTabContent = (tabId: OverlayTabId) => {
    const sections = sectionTabs[tabId as SectionTabId];
    if (sections) return <SectionsPanel sections={sections} />;
    const element = elementTabs[tabId as ElementTabId];
    if (element) return <AdoptedElement element={element} className="foss-earth-element-tab" />;
    if (tabId !== "location") return renderAdditionalTab?.(tabId as TabId) ?? null;
    return (
      <LocationPanel
        initialLocation={currentLocation(getViewState)}
        getCurrentLocation={getViewState}
        onApply={setViewState}
        searchProvider={locationSearchProvider}
        enableAirportPresets={enableAirportPresets}
      />
    );
  };

  return (
    <div ref={setOverlay} className="foss-earth-window-overlay">
      <WorkspaceDockSlot<OverlayTabId>
        side="left"
        slotId="primary"
        visible={primaryAvailable}
        workspaceState={workspace.state}
        onWorkspaceStateChange={updateWorkspace}
        onWidthChange={(width) => resizeWindow("primary", width)}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={layout.primaryWidth}
        maxWidth={layout.maxWindowWidth}
        addMenuOpen={primaryAddOpen}
        onAddMenuOpenChange={(open) => { setPrimaryAddOpen(open); if (open) setSecondaryAddOpen(false); }}
        strings={{ openPanelTabAriaLabel: "Open left panel", openPanelTabTitle: "Open left panel" }}
        onBeforeCloseTab={beforeCloseTab}
        menuContainer={overlayElement}
        menuBottom={hudBarTop}
      />
      <WorkspaceDockSlot<OverlayTabId>
        side="right"
        slotId="secondary"
        workspaceState={workspace.state}
        onWorkspaceStateChange={updateWorkspace}
        onWidthChange={(width) => resizeWindow("secondary", width)}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={layout.secondaryWidth}
        maxWidth={layout.maxWindowWidth}
        addMenuOpen={secondaryAddOpen}
        onAddMenuOpenChange={(open) => { setSecondaryAddOpen(open); if (open) setPrimaryAddOpen(false); }}
        visible
        strings={{ openPanelTabAriaLabel: "Open right panel", openPanelTabTitle: "Open right panel" }}
        onBeforeCloseTab={beforeCloseTab}
        menuContainer={overlayElement}
        menuBottom={hudBarTop}
      />
    </div>
  );
}
