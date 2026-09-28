import { describe, expect, it } from "vitest";
import { createWindowWorkspaceState } from "../windowing/core/workspaceState";
import { hideWorkspaceTabs, restoreWorkspaceTabs } from "./contextTabs";

type Tab = "location" | "map" | "scenes" | "settings" | "panorama";

describe("tabs a context hides", () => {
  const state = createWindowWorkspaceState<Tab>({
    primary: { tabs: ["location", "settings"], activeTab: "location" },
    secondary: { tabs: ["scenes", "map"], activeTab: "map", collapsed: true },
  });

  it("go out of the workspace, each remembered with its place", () => {
    const { state: next, hidden } = hideWorkspaceTabs(state, new Set<Tab>(["location", "map"]));
    expect(next.primary).toMatchObject({ tabs: ["settings"], activeTab: "settings" });
    expect(next.secondary).toMatchObject({ tabs: ["scenes"], activeTab: "scenes", collapsed: true });
    expect(hidden).toEqual([
      { tabId: "location", slotId: "primary", index: 0, active: true },
      { tabId: "map", slotId: "secondary", index: 1, active: true },
    ]);
    expect(hideWorkspaceTabs(state, new Set<Tab>(["panorama"]))).toEqual({ state, hidden: [] });
  });

  it("come back where they were, and selected if they were, when the context returns", () => {
    const { state: hiddenState, hidden } = hideWorkspaceTabs(state, new Set<Tab>(["location", "map"]));
    expect(restoreWorkspaceTabs(hiddenState, hidden, true)).toEqual(state);
  });

  it("keep a place the user gave them meanwhile, and go right while only one window fits", () => {
    const { state: hiddenState, hidden } = hideWorkspaceTabs(state, new Set<Tab>(["location", "map"]));
    const reopened = { ...hiddenState, secondary: { ...hiddenState.secondary, tabs: ["scenes", "map"] as Tab[] } };
    const restored = restoreWorkspaceTabs(reopened, hidden, false);
    expect(restored.primary.tabs).toEqual(["settings"]);
    expect(restored.secondary).toMatchObject({ tabs: ["location", "scenes", "map"], activeTab: "location" });
  });
});
