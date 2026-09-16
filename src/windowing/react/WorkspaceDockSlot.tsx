import type { ReactNode } from "react";
import {
  allWorkspaceOpenTabs,
  closeTabInWorkspace,
  openTabAndExpandWorkspaceSlot,
  openTabInWorkspace,
  selectTabInWorkspace,
  selectTabAndToggleWorkspaceSlot,
  setWorkspaceSlotCollapsed,
  setWorkspaceSlotSize,
} from "../core/workspaceState";
import type {
  WindowSlotId,
  WindowTabDefinition,
  WindowWorkspaceState,
} from "../core/types";
import {
  DockPanel,
  type DockPanelClassNames,
  type DockPanelProps,
} from "./DockPanel";
import {
  PanelLauncher,
  type PanelLauncherClassNames,
} from "./PanelLauncher";
import {
  TabStrip,
  type TabStripClassNames,
} from "./TabStrip";

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export type WorkspaceDockPanelOverrides = Partial<Omit<
  DockPanelProps,
  | "side"
  | "width"
  | "maxWidth"
  | "onWidthChange"
  | "collapsed"
  | "onCollapsedChange"
  | "addMenuOpen"
  | "header"
  | "children"
  | "classNames"
>>;

export interface WorkspaceDockSlotClassNames {
  launcherRoot?: string;
  dockPanel?: DockPanelClassNames;
  panelLauncher?: PanelLauncherClassNames;
  tabStrip?: TabStripClassNames;
}

export interface WorkspaceDockSlotStrings {
  allTabsOpenText?: string;
  openPanelTabAriaLabel?: string;
  openPanelTabTitle?: string;
  openNewTabAriaLabel?: string;
  openNewTabTitle?: string;
  closeTabAriaLabel?: (tabLabel: string) => string;
}

export interface WorkspaceDockSlotProps<TabId extends string> {
  side: "left" | "right";
  slotId: WindowSlotId;
  workspaceState: WindowWorkspaceState<TabId>;
  onWorkspaceStateChange: (next: WindowWorkspaceState<TabId>) => void;
  tabDefinitions: readonly WindowTabDefinition<TabId>[];
  getTabLabel: (tabId: TabId) => string;
  renderTabContent: (tabId: TabId) => ReactNode;
  width: number;
  maxWidth: number;
  addMenuOpen: boolean;
  onAddMenuOpenChange: (open: boolean) => void;
  visible?: boolean;
  showLauncherWhenEmpty?: boolean;
  compactWhenCollapsed?: boolean;
  restoreOnTabSelect?: boolean;
  restoreOnTabOpen?: boolean;
  classNames?: WorkspaceDockSlotClassNames;
  strings?: WorkspaceDockSlotStrings;
  renderLauncherButtonContent?: ReactNode;
  renderTabAddButtonContent?: ReactNode;
  renderTabCloseButtonContent?: (tabId: TabId) => ReactNode;
  dockPanelProps?: WorkspaceDockPanelOverrides;
  /** Return `false` to keep the tab open. */
  onBeforeCloseTab?: (tabId: TabId) => boolean | void;
}

function availableTabsFromWorkspace<TabId extends string>(
  workspaceState: WindowWorkspaceState<TabId>,
  tabDefinitions: readonly WindowTabDefinition<TabId>[],
): TabId[] {
  const openTabs = new Set(allWorkspaceOpenTabs(workspaceState));
  return tabDefinitions
    .filter((tab) => tab.available !== false && !openTabs.has(tab.id))
    .map((tab) => tab.id);
}

export function WorkspaceDockSlot<TabId extends string>(props: WorkspaceDockSlotProps<TabId>) {
  const {
    side,
    slotId,
    workspaceState,
    onWorkspaceStateChange,
    tabDefinitions,
    getTabLabel,
    renderTabContent,
    width,
    maxWidth,
    addMenuOpen,
    onAddMenuOpenChange,
    visible = true,
    showLauncherWhenEmpty = true,
    compactWhenCollapsed = true,
    restoreOnTabSelect = false,
    restoreOnTabOpen = true,
    classNames,
    strings,
    renderLauncherButtonContent,
    renderTabAddButtonContent,
    renderTabCloseButtonContent,
    dockPanelProps,
    onBeforeCloseTab,
  } = props;

  if (!visible) return null;

  const slotState = workspaceState[slotId];
  const openTabs = slotState.tabs;
  const activeTab = slotState.activeTab ?? slotState.tabs[slotState.tabs.length - 1] ?? null;
  const availableTabs = availableTabsFromWorkspace(workspaceState, tabDefinitions);

  const handleOpenTab = (tabId: TabId) => {
    const next = restoreOnTabOpen
      ? openTabAndExpandWorkspaceSlot(workspaceState, slotId, tabId, tabDefinitions)
      : openTabInWorkspace(workspaceState, slotId, tabId, tabDefinitions);
    onWorkspaceStateChange(next);
    onAddMenuOpenChange(false);
  };

  const handleSelectTab = (tabId: TabId) => {
    const next = restoreOnTabSelect
      ? selectTabAndToggleWorkspaceSlot(workspaceState, slotId, tabId)
      : selectTabInWorkspace(workspaceState, slotId, tabId);
    onWorkspaceStateChange(next);
  };

  const handleCloseTab = (tabId: TabId) => {
    if (onBeforeCloseTab?.(tabId) === false) return;
    onWorkspaceStateChange(closeTabInWorkspace(workspaceState, slotId, tabId));
  };

  const handleMoveTab = (tabId: TabId) => {
    onWorkspaceStateChange(openTabAndExpandWorkspaceSlot(workspaceState, slotId, tabId, tabDefinitions));
  };

  const handleTabDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleTabDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new Event("foss-earth-tab-drag-end"));
    const tabId = event.dataTransfer.getData("text/plain") as TabId;
    if (tabId && !openTabs.includes(tabId)) handleMoveTab(tabId);
  };

  const hasCustomLauncherRoot = Boolean(
    classNames?.launcherRoot || classNames?.panelLauncher?.root,
  );

  const launcherClassNames: PanelLauncherClassNames = {
    ...classNames?.panelLauncher,
    root: cx(
      "foss-earth-workspace-slot-launcher",
      hasCustomLauncherRoot
        ? undefined
        : side === "right"
          ? "foss-earth-workspace-slot-launcher-right"
          : "foss-earth-workspace-slot-launcher-left",
      classNames?.launcherRoot,
      classNames?.panelLauncher?.root,
    ),
  };

  if (openTabs.length === 0) {
    if (!showLauncherWhenEmpty) return null;

    return (
      <PanelLauncher<TabId>
        open={addMenuOpen}
        side={side}
        availableTabs={availableTabs}
        onOpenChange={onAddMenuOpenChange}
        onOpenTab={handleOpenTab}
        onMoveTab={handleMoveTab}
        dropWidth={width}
        dropMaxWidth={maxWidth}
        dropHeight={dockPanelProps?.initialHeight ?? 512}
        getLabel={getTabLabel}
        classNames={launcherClassNames}
        strings={{
          allTabsOpenText: strings?.allTabsOpenText,
        }}
        renderButtonContent={renderLauncherButtonContent}
        buttonAriaLabel={strings?.openPanelTabAriaLabel}
        buttonTitle={strings?.openPanelTabTitle}
      />
    );
  }

  if (!activeTab) return null;

  return (
    <DockPanel
      side={side}
      width={width}
      maxWidth={maxWidth}
      onWidthChange={(nextWidth) => {
        onWorkspaceStateChange(setWorkspaceSlotSize(workspaceState, slotId, { width: nextWidth }));
      }}
      collapsed={slotState.collapsed}
      onCollapsedChange={(collapsed) => {
        onWorkspaceStateChange(setWorkspaceSlotCollapsed(workspaceState, slotId, collapsed));
      }}
      addMenuOpen={addMenuOpen}
      onDragOver={handleTabDragOver}
      onDrop={handleTabDrop}
      classNames={classNames?.dockPanel}
      header={(
        <TabStrip<TabId>
          openTabs={openTabs}
          activeTab={activeTab}
          addMenuOpen={addMenuOpen}
          availableTabs={availableTabs}
          side={side}
          compact={compactWhenCollapsed && slotState.collapsed}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onOpenTab={handleOpenTab}
          onMoveTab={handleMoveTab}
          onAddMenuOpenChange={onAddMenuOpenChange}
          getLabel={getTabLabel}
          classNames={classNames?.tabStrip}
          strings={{
            allTabsOpenText: strings?.allTabsOpenText,
            addButtonAriaLabel: strings?.openNewTabAriaLabel,
            addButtonTitle: strings?.openNewTabTitle,
            closeTabAriaLabel: strings?.closeTabAriaLabel,
          }}
          renderAddButtonContent={renderTabAddButtonContent}
          renderCloseButtonContent={renderTabCloseButtonContent}
        />
      )}
      {...dockPanelProps}
    >
      {renderTabContent(activeTab)}
    </DockPanel>
  );
}
