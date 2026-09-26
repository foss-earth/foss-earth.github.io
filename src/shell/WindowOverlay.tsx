import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import {
  closeTabInWorkspace,
  setWorkspaceSlotSize,
  slotIdForOpenTab,
} from "../windowing/core/workspaceState";

/** Tabs the overlay builds from a host's sections. */
type SectionTabId = "controls" | "interface" | "settings";
/** Tabs that show one element the host built, such as `createMapSourcePanel`'s. */
type ElementTabId = "map" | "renderer";
/** Every tab the overlay can offer without the host defining it. */
type BuiltInTabId = "location" | SectionTabId | ElementTabId;

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
  const elementTabs: Partial<Record<ElementTabId, HTMLElement>> = {
    ...(mapTab ? { map: mapTab } : {}),
    ...(rendererTab ? { renderer: rendererTab } : {}),
  };
  const sectionTabLabels: Record<SectionTabId, string> = { controls: "Controls", interface: "Interface", settings: "Settings" };
  const elementTabLabels: Record<ElementTabId, string> = { map: "Map", renderer: "Renderer" };
  const builtInSectionTabs = (Object.keys(sectionTabLabels) as SectionTabId[]).filter((id) => sectionTabs[id]);
  const builtInElementTabs = (Object.keys(elementTabLabels) as ElementTabId[]).filter((id) => elementTabs[id]);
  const builtInTabs: readonly string[] = ["location", ...builtInSectionTabs, ...builtInElementTabs];
  const tabDefinitions: readonly WindowTabDefinition<OverlayTabId>[] = [
    { id: "location", label: "Location" },
    ...builtInSectionTabs.map((id) => ({ id, label: sectionTabLabels[id] })),
    ...additionalTabs.filter((tab) => !builtInTabs.includes(tab.id)),
    ...builtInElementTabs.map((id) => ({ id, label: elementTabLabels[id] })),
  ];
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const workspace = useWindowWorkspace<OverlayTabId>();
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
        if (onBeforeCloseTab?.(tabId) === false) return;
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
    <div ref={overlayRef} className="foss-earth-window-overlay">
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
        onBeforeCloseTab={onBeforeCloseTab}
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
        onBeforeCloseTab={onBeforeCloseTab}
      />
    </div>
  );
}
