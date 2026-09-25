import { moveTabsBetweenWorkspaceSlots } from "../windowing/core/workspaceState";
import type { WindowSlotState, WindowWorkspaceState } from "../windowing/core/types";

type SlotPresentation<TabId extends string> = Pick<WindowSlotState<TabId>, "activeTab" | "collapsed">;

export interface CompactWorkspaceMemory<TabId extends string> {
  primary: SlotPresentation<TabId> & { tabs: TabId[] };
  secondary: SlotPresentation<TabId>;
  foldedSecondary: SlotPresentation<TabId>;
}

/** Temporarily combine the tabs, retaining their homes for the next wide layout. */
export function foldWorkspace<TabId extends string>(state: WindowWorkspaceState<TabId>): {
  state: WindowWorkspaceState<TabId>;
  memory: CompactWorkspaceMemory<TabId>;
} {
  const folded = moveTabsBetweenWorkspaceSlots(state, "primary", "secondary");
  const secondary = folded === state ? state.secondary : {
    ...folded.secondary,
    collapsed: !(
      (state.primary.tabs.length > 0 && !state.primary.collapsed)
      || (state.secondary.tabs.length > 0 && !state.secondary.collapsed)
    ),
  };
  return {
    state: folded === state ? state : { ...folded, secondary },
    memory: {
      primary: {
        tabs: [...state.primary.tabs],
        activeTab: state.primary.activeTab,
        collapsed: state.primary.collapsed,
      },
      secondary: { activeTab: state.secondary.activeTab, collapsed: state.secondary.collapsed },
      foldedSecondary: { activeTab: secondary.activeTab, collapsed: secondary.collapsed },
    },
  };
}

/** Restore surviving borrowed tabs; new tabs and explicit moves keep their homes. */
export function restoreWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  memory: CompactWorkspaceMemory<TabId>,
): WindowWorkspaceState<TabId> {
  const restoredTabs = memory.primary.tabs.filter((tabId) => (
    state.secondary.tabs.includes(tabId) && !state.primary.tabs.includes(tabId)
  ));
  if (restoredTabs.length === 0) return state;

  const restored = new Set(restoredTabs);
  const primaryTabs = [...state.primary.tabs, ...restoredTabs];
  const secondaryTabs = state.secondary.tabs.filter((tabId) => !restored.has(tabId));
  const primaryActive = state.primary.activeTab ?? memory.primary.activeTab;
  const secondaryActive = state.secondary.activeTab && secondaryTabs.includes(state.secondary.activeTab)
    ? state.secondary.activeTab
    : memory.secondary.activeTab;
  const selectedRightTab = state.secondary.activeTab !== memory.foldedSecondary.activeTab
    && state.secondary.activeTab !== null
    && secondaryTabs.includes(state.secondary.activeTab);
  return {
    primary: {
      ...state.primary,
      tabs: primaryTabs,
      activeTab: primaryActive && primaryTabs.includes(primaryActive)
        ? primaryActive
        : primaryTabs[primaryTabs.length - 1] ?? null,
      collapsed: state.primary.tabs.length > 0 ? state.primary.collapsed : memory.primary.collapsed,
    },
    secondary: {
      ...state.secondary,
      tabs: secondaryTabs,
      activeTab: secondaryActive && secondaryTabs.includes(secondaryActive)
        ? secondaryActive
        : secondaryTabs[secondaryTabs.length - 1] ?? null,
      collapsed: !selectedRightTab && state.secondary.collapsed === memory.foldedSecondary.collapsed
        ? memory.secondary.collapsed
        : state.secondary.collapsed,
    },
  };
}

/** Call after a successful close or explicit move so reopening starts a new home. */
export function forgetCompactWorkspaceTab<TabId extends string>(
  memory: CompactWorkspaceMemory<TabId>,
  tabId: TabId,
): CompactWorkspaceMemory<TabId> {
  return {
    ...memory,
    primary: {
      ...memory.primary,
      tabs: memory.primary.tabs.filter((tab) => tab !== tabId),
      activeTab: memory.primary.activeTab === tabId ? null : memory.primary.activeTab,
    },
    secondary: {
      ...memory.secondary,
      activeTab: memory.secondary.activeTab === tabId ? null : memory.secondary.activeTab,
    },
  };
}
