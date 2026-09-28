import type { WindowSlotId, WindowWorkspaceState } from "../windowing/core/types";

const SLOT_IDS: readonly WindowSlotId[] = ["primary", "secondary"];

/** Where a tab was when its context hid it. */
export interface HiddenTab<TabId extends string> {
  tabId: TabId;
  slotId: WindowSlotId;
  index: number;
  /** It was the tab its slot showed. */
  active: boolean;
}

/**
 * Takes the tabs a context does not show out of the workspace, such as the
 * Map tab inside a panorama, and says where each was so it can come back.
 */
export function hideWorkspaceTabs<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  tabIds: ReadonlySet<TabId>,
): { state: WindowWorkspaceState<TabId>; hidden: HiddenTab<TabId>[] } {
  const hidden: HiddenTab<TabId>[] = [];
  for (const slotId of SLOT_IDS) {
    state[slotId].tabs.forEach((tabId, index) => {
      if (tabIds.has(tabId)) hidden.push({ tabId, slotId, index, active: state[slotId].activeTab === tabId });
    });
  }
  if (hidden.length === 0) return { state, hidden };
  const next = { ...state };
  for (const slotId of SLOT_IDS) {
    const slot = state[slotId];
    const tabs = slot.tabs.filter(tabId => !tabIds.has(tabId));
    const activeTab = slot.activeTab && !tabIds.has(slot.activeTab) ? slot.activeTab : tabs[tabs.length - 1] ?? null;
    next[slotId] = { ...slot, tabs, activeTab };
  }
  return { state: next, hidden };
}

/**
 * Puts hidden tabs back where they were, when their context returns. A tab
 * opened again meanwhile keeps its new place. A tab from the left window goes
 * to the right while there is room for only one.
 */
export function restoreWorkspaceTabs<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  hidden: readonly HiddenTab<TabId>[],
  primaryAvailable: boolean,
): WindowWorkspaceState<TabId> {
  const open = new Set(SLOT_IDS.flatMap(slotId => state[slotId].tabs));
  const back = hidden.filter(entry => !open.has(entry.tabId));
  if (back.length === 0) return state;
  const next = { primary: { ...state.primary, tabs: [...state.primary.tabs] }, secondary: { ...state.secondary, tabs: [...state.secondary.tabs] } };
  for (const entry of [...back].sort((a, b) => a.index - b.index)) {
    const slotId = entry.slotId === "primary" && !primaryAvailable ? "secondary" : entry.slotId;
    const slot = next[slotId];
    slot.tabs.splice(Math.min(entry.index, slot.tabs.length), 0, entry.tabId);
    if (entry.active || slot.activeTab === null) slot.activeTab = entry.tabId;
  }
  return next;
}
