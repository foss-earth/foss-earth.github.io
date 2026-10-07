import { createWindowWorkspaceState } from "../windowing/core/workspaceState";
import type { WindowSlotState, WindowWorkspaceState } from "../windowing/core/types";

/**
 * Which tabs a user had open, in which window, which one each window showed,
 * whether it was minimized and how wide it was, remembered per device so a
 * reload comes back to the same workspace.
 */
export const SAVED_WORKSPACE_STORAGE_KEY = "foss-earth.workspace";

const SLOT_IDS = ["primary", "secondary"] as const;

const size = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/**
 * The saved workspace, keeping only the tabs in `restorable`, each once. Null
 * when nothing was saved or it cannot be read.
 */
export function loadSavedWorkspace<TabId extends string>(restorable: ReadonlySet<TabId>): WindowWorkspaceState<TabId> | null {
  try {
    const raw = window.localStorage.getItem(SAVED_WORKSPACE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    const seen = new Set<TabId>();
    const slots: Partial<Record<(typeof SLOT_IDS)[number], Partial<WindowSlotState<TabId>>>> = {};
    for (const slotId of SLOT_IDS) {
      const saved: unknown = (parsed as Record<string, unknown>)[slotId];
      if (!saved || typeof saved !== "object") continue;
      const { tabs, activeTab, collapsed, width, height } = saved as Record<string, unknown>;
      const kept = (Array.isArray(tabs) ? tabs : []).filter((tabId): tabId is TabId => (
        typeof tabId === "string" && restorable.has(tabId as TabId) && !seen.has(tabId as TabId)
      ));
      for (const tabId of kept) seen.add(tabId);
      slots[slotId] = {
        tabs: kept,
        activeTab: typeof activeTab === "string" && kept.includes(activeTab as TabId) ? activeTab as TabId : null,
        collapsed: collapsed === true,
        width: size(width),
        height: size(height),
      };
    }
    return createWindowWorkspaceState(slots);
  } catch {
    return null;
  }
}

export function saveWorkspace(state: WindowWorkspaceState<string>): void {
  try {
    window.localStorage.setItem(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Which tabs were open is a convenience; losing it costs a few clicks.
  }
}
