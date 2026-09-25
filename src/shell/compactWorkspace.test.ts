import { describe, expect, it } from "vitest";
import {
  closeTabInWorkspace,
  createWindowWorkspaceState,
  openTabAndExpandWorkspaceSlot,
  selectTabInWorkspace,
  setWorkspaceSlotCollapsed,
  setWorkspaceSlotSize,
} from "../windowing/core/workspaceState";
import { foldWorkspace, forgetCompactWorkspaceTab, restoreWorkspace } from "./compactWorkspace";

type TabId = "location" | "settings" | "map" | "debug";
const definitions = ["location", "settings", "map", "debug"].map((id) => ({ id: id as TabId, label: id }));
const initial = () => createWindowWorkspaceState<TabId>({
  primary: { tabs: ["location", "settings"], activeTab: "location", collapsed: false, width: 360, height: 480 },
  secondary: { tabs: ["map"], activeTab: "map", collapsed: true, width: 320, height: 420 },
});

describe("temporary compact workspace", () => {
  it("restores both original slots, active tabs, collapsed states and dimensions", () => {
    const original = initial();
    const folded = foldWorkspace(original);

    expect(folded.state.primary.tabs).toEqual([]);
    expect(folded.state.secondary.tabs).toEqual(["map", "location", "settings"]);
    expect(folded.state.secondary.collapsed).toBe(false);
    expect(restoreWorkspace(folded.state, folded.memory)).toEqual(original);
    expect(original).toEqual(initial());
  });

  it("restores only surviving left tabs while retaining new right tabs and selection", () => {
    const folded = foldWorkspace(initial());
    let compact = closeTabInWorkspace(folded.state, "secondary", "location");
    compact = openTabAndExpandWorkspaceSlot(compact, "secondary", "debug", definitions);
    compact = setWorkspaceSlotSize(compact, "secondary", { width: 410 });
    const restored = restoreWorkspace(compact, folded.memory);

    expect(restored.primary.tabs).toEqual(["settings"]);
    expect(restored.primary.activeTab).toBe("settings");
    expect(restored.secondary.tabs).toEqual(["map", "debug"]);
    expect(restored.secondary.activeTab).toBe("debug");
    expect(restored.secondary.collapsed).toBe(false);
    expect(restored.secondary.width).toBe(410);
  });

  it("keeps explicit tab moves and later selections in the primary slot", () => {
    const folded = foldWorkspace(initial());
    let compact = openTabAndExpandWorkspaceSlot(folded.state, "primary", "settings", definitions);
    compact = openTabAndExpandWorkspaceSlot(compact, "primary", "debug", definitions);
    const restored = restoreWorkspace(compact, folded.memory);

    expect(restored.primary.tabs).toEqual(["settings", "debug", "location"]);
    expect(restored.primary.activeTab).toBe("debug");
    expect(restored.secondary.tabs).toEqual(["map"]);
  });

  it("does not send a closed and reopened tab back to its old home", () => {
    const folded = foldWorkspace(initial());
    let compact = closeTabInWorkspace(folded.state, "secondary", "location");
    const memory = forgetCompactWorkspaceTab(folded.memory, "location");
    compact = openTabAndExpandWorkspaceSlot(compact, "secondary", "location", definitions);
    const restored = restoreWorkspace(compact, memory);

    expect(restored.primary.tabs).toEqual(["settings"]);
    expect(restored.secondary.tabs).toEqual(["map", "location"]);
    expect(restored.secondary.activeTab).toBe("location");
  });

  it("leaves deliberately moved tabs on the right when their temporary home is forgotten", () => {
    const folded = foldWorkspace(initial());
    const memory = forgetCompactWorkspaceTab(folded.memory, "settings");
    const restored = restoreWorkspace(folded.state, memory);

    expect(restored.primary.tabs).toEqual(["location"]);
    expect(restored.secondary.tabs).toEqual(["map", "settings"]);
  });

  it("retains a later compact collapse and restores the old right selection after a borrowed tab was selected", () => {
    const original = setWorkspaceSlotCollapsed(initial(), "secondary", false);
    const folded = foldWorkspace(original);
    let compact = selectTabInWorkspace(folded.state, "secondary", "settings");
    compact = setWorkspaceSlotCollapsed(compact, "secondary", true);
    const restored = restoreWorkspace(compact, folded.memory);

    expect(restored.primary.activeTab).toBe("location");
    expect(restored.secondary.activeTab).toBe("map");
    expect(restored.secondary.collapsed).toBe(true);
  });

  it("does not resurrect tabs after all original left tabs have closed", () => {
    const folded = foldWorkspace(initial());
    let compact = closeTabInWorkspace(folded.state, "secondary", "location");
    compact = closeTabInWorkspace(compact, "secondary", "settings");

    expect(restoreWorkspace(compact, folded.memory)).toBe(compact);
  });

  it("leaves an already single-sided workspace alone", () => {
    const original = createWindowWorkspaceState<TabId>({ secondary: { tabs: ["map"], collapsed: true } });
    const folded = foldWorkspace(original);

    expect(folded.state).toBe(original);
    expect(restoreWorkspace(folded.state, folded.memory)).toBe(original);
  });
});
