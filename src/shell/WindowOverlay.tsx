import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  LocationPanel,
  canFitSecondarySlot,
  moveTabsBetweenWorkspaceSlots,
  openOrSelectTabInWorkspace,
  WorkspaceDockSlot,
  useWindowWorkspace,
  type GeodeticLocation,
  type LocationSearchProvider,
  type WindowTabDefinition,
} from "../windowing";

import { searchLocations } from "../search/locationSearch";
import { GAME_LOG_BOUNDS_EVENT } from "../log/createGameLog";
import { nextLeftDock, nextRightDock } from "../log/fitLogResize";
import { AdoptedElement } from "./AdoptedElement";
import { SectionsPanel, type PanelSection } from "./SectionsPanel";
import { closeTabInWorkspace, setWorkspaceSlotCollapsed, setWorkspaceSlotSize, slotIdForOpenTab } from "../windowing/core/workspaceState";

/** Tabs the overlay builds from a host's sections. */
type SectionTabId = "controls" | "settings";
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
    ...(settingsSections ? { settings: settingsSections } : {}),
  };
  const elementTabs: Partial<Record<ElementTabId, HTMLElement>> = {
    ...(mapTab ? { map: mapTab } : {}),
    ...(rendererTab ? { renderer: rendererTab } : {}),
  };
  const sectionTabLabels: Record<SectionTabId, string> = { controls: "Controls", settings: "Settings" };
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
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const leftDockMemory = useRef<{ width: number; collapsed: boolean } | null>(null);
  const rightDockMemory = useRef<{ width: number; collapsed: boolean } | null>(null);

  useEffect(() => {
    const onBounds = (event: Event) => {
      const edge = (event as CustomEvent<{ left: number; right: number } | null>).detail;
      const { state, setState } = workspaceRef.current;
      const fits: Array<{ slot: "primary" | "secondary"; width: number; collapsed: boolean }> = [];
      const remember = (
        slot: "primary" | "secondary",
        memory: { current: { width: number; collapsed: boolean } | null },
        next: { width: number; collapsed: boolean; saved: { width: number; collapsed: boolean } | null },
        currentWidth: number,
        currentCollapsed: boolean,
      ) => {
        memory.current = next.saved;
        if (next.width === currentWidth && next.collapsed === currentCollapsed) return;
        fits.push({ slot, width: next.width, collapsed: next.collapsed });
      };
      const leftPanel = document.querySelector<HTMLElement>('.foss-earth-dock-panel[data-side="left"]');
      if (leftPanel) {
        const slot = state.primary;
        remember("primary", leftDockMemory, nextLeftDock({
          logLeft: edge?.left ?? null,
          dockLeft: leftPanel.dataset.collapsed === "false" ? leftPanel.getBoundingClientRect().left : 12,
          currentWidth: slot.width ?? 320,
          currentCollapsed: slot.collapsed,
          saved: leftDockMemory.current,
        }), slot.width ?? 320, slot.collapsed);
      }
      const rightPanel = document.querySelector<HTMLElement>('.foss-earth-dock-panel[data-side="right"]');
      const rightSlot = state.secondary;
      remember("secondary", rightDockMemory, nextRightDock({
        logRight: edge?.right ?? null,
        dockRight: rightPanel && rightPanel.dataset.collapsed === "false"
          ? rightPanel.getBoundingClientRect().right
          : window.innerWidth - 12,
        currentWidth: rightSlot.width ?? 320,
        currentCollapsed: rightSlot.collapsed,
        saved: rightDockMemory.current,
      }), rightSlot.width ?? 320, rightSlot.collapsed);
      if (fits.length === 0) return;
      setState((current) => fits.reduce((next, fit) => {
        const sized = setWorkspaceSlotSize(next, fit.slot, { width: fit.width });
        return sized[fit.slot].collapsed === fit.collapsed
          ? sized
          : setWorkspaceSlotCollapsed(sized, fit.slot, fit.collapsed);
      }, current));
    };
    window.addEventListener(GAME_LOG_BOUNDS_EVENT, onBounds);
    return () => window.removeEventListener(GAME_LOG_BOUNDS_EVENT, onBounds);
  }, []);
  const [primaryAddOpen, setPrimaryAddOpen] = useState(false);
  const [secondaryAddOpen, setSecondaryAddOpen] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
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

  const primaryAvailable = canFitSecondarySlot({
    availableWidth,
    primaryMinWidth: Math.max(320, workspace.state.primary.width ?? 320),
    secondaryMinWidth: Math.max(320, workspace.state.secondary.width ?? 320),
    centerGap: 220,
    edgeGap: 12,
  });

  useEffect(() => {
    if (availableWidth <= 0) return;
    document.documentElement.dataset.dockLayout = primaryAvailable ? "dual" : "single";
  }, [availableWidth, primaryAvailable]);

  useEffect(() => {
    if (availableWidth <= 0 || primaryAvailable || workspace.state.primary.tabs.length === 0) return;
    workspace.setState((current) => moveTabsBetweenWorkspaceSlots(current, "primary", "secondary"));
  }, [availableWidth, primaryAvailable, workspace]);

  useEffect(() => {
    return () => {
      delete document.documentElement.dataset.dockLayout;
    };
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
        workspace.setState(closeTabInWorkspace(state, slotId, tabId));
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
        onWorkspaceStateChange={workspace.setState}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={workspace.state.primary.width ?? 320}
        maxWidth={420}
        addMenuOpen={primaryAddOpen}
        onAddMenuOpenChange={(open) => { setPrimaryAddOpen(open); if (open) setSecondaryAddOpen(false); }}
        strings={{ openPanelTabAriaLabel: "Open left panel", openPanelTabTitle: "Open left panel" }}
        onBeforeCloseTab={onBeforeCloseTab}
      />
      <WorkspaceDockSlot<OverlayTabId>
        side="right"
        slotId="secondary"
        workspaceState={workspace.state}
        onWorkspaceStateChange={workspace.setState}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={workspace.state.secondary.width ?? 320}
        maxWidth={420}
        addMenuOpen={secondaryAddOpen}
        onAddMenuOpenChange={(open) => { setSecondaryAddOpen(open); if (open) setPrimaryAddOpen(false); }}
        visible
        strings={{ openPanelTabAriaLabel: "Open right panel", openPanelTabTitle: "Open right panel" }}
        onBeforeCloseTab={onBeforeCloseTab}
      />
    </div>
  );
}
