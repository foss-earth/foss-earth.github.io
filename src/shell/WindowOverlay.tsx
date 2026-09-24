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
import { setWorkspaceSlotCollapsed, setWorkspaceSlotSize } from "../windowing/core/workspaceState";

const DEFAULT_LOCATION: GeodeticLocation = {
  latDeg: 44.977753,
  lonDeg: -93.265011,
};

function currentLocation(getViewState: () => GeodeticLocation | null): GeodeticLocation {
  const view = getViewState();
  return view ? { latDeg: view.latDeg, lonDeg: view.lonDeg, ...(view.zoomMeters === undefined ? {} : { zoomMeters: view.zoomMeters }), ...(view.altMeters === undefined ? {} : { altMeters: view.altMeters }) } : DEFAULT_LOCATION;
}

export interface WindowOverlayHandle<TabId extends string = never> {
  openOrSelectTab(tabId: "location" | TabId): void;
}

export interface WindowOverlayProps<TabId extends string = never> {
  getViewState: () => GeodeticLocation | null;
  setViewState: (location: GeodeticLocation) => void;
  /** Hosts supply tab contents; the shared overlay owns both window slots. */
  additionalTabs?: readonly WindowTabDefinition<TabId>[];
  renderAdditionalTab?: (tabId: TabId) => ReactNode;
  locationSearchProvider?: LocationSearchProvider;
  enableAirportPresets?: boolean;
  overlayApiRef?: { current: WindowOverlayHandle<TabId> | null };
  /** Return `false` to keep the tab open. */
  onBeforeCloseTab?: (tabId: "location" | TabId) => boolean | void;
}

export function WindowOverlay<TabId extends string = never>({
  getViewState,
  setViewState,
  additionalTabs = [],
  renderAdditionalTab,
  locationSearchProvider = searchLocations,
  enableAirportPresets = false,
  overlayApiRef,
  onBeforeCloseTab,
}: WindowOverlayProps<TabId>) {
  type OverlayTabId = "location" | TabId;
  const tabDefinitions: readonly WindowTabDefinition<OverlayTabId>[] = [
    { id: "location", label: "Location" },
    ...additionalTabs.filter((tab) => tab.id !== "location"),
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
  const openTabContextRef = useRef({ primaryAvailable, tabDefinitions });
  openTabContextRef.current = { primaryAvailable, tabDefinitions };

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

  useLayoutEffect(() => {
    if (!overlayApiRef) return;
    overlayApiRef.current = {
      openOrSelectTab(tabId) {
        const { primaryAvailable: canUseLeft, tabDefinitions: definitions } = openTabContextRef.current;
        workspace.setState((current) => openOrSelectTabInWorkspace(
          current,
          tabId,
          canUseLeft ? "primary" : "secondary",
          definitions,
        ));
      },
    };
    return () => {
      overlayApiRef.current = null;
    };
  }, [overlayApiRef, workspace]);

  const renderTabContent = (tabId: OverlayTabId) => {
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
