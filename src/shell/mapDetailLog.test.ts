import { describe, expect, it, vi } from "vitest";
import type { RasterDetailFeedback } from "../engine/babylon/createRasterTilesRuntime";
import type { GameLogEntry, GameLogLine } from "../log/createGameLog";
import type { AutoDetailDecision } from "../terrain/autoDetail";
import type { ImageryConstraint } from "../terrain/imagery/imageryConstraints";
import { describeImageryConstraint, describeImageryRecovery } from "./mapDetailExplanations";
import { connectMapDetailLog } from "./mapDetailLog";

const USGS = { id: "usgs-imagery", version: "1", label: "USGS Imagery" };
const BUDGET: ImageryConstraint = {
  cause: "gpu-budget", parameter: "map.imagery.gpuBudget", configuredMiB: 256, atlasMiB: 250, atlasPages: 1600, rendererCapped: false,
  selectablePages: 1344, selectedPages: 1344, morePagesAtLeast: 40, regions: 12, reducedRegions: 0,
};
const TABLES: ImageryConstraint = { cause: "page-tables", parameter: "map.imagery.pageTablePatches", configured: 16, effective: 16, needed: 20, patches: 4 };
const SOURCE: ImageryConstraint = { cause: "source", missingRegions: 3, finestLevelRegions: 0, finestLevel: 16, outsideRegions: 0, scaleRegions: 0 };

function fakeRuntime() {
  const adjusted = new Set<(decision: AutoDetailDecision) => void>();
  const feedbackListeners = new Set<() => void>();
  let feedback: RasterDetailFeedback | null = null;
  const runtime = {
    onDetailAdjusted: vi.fn((listener: (decision: AutoDetailDecision) => void) => { adjusted.add(listener); return () => { adjusted.delete(listener); }; }),
    onRasterDetailFeedback: vi.fn((listener: () => void) => { feedbackListeners.add(listener); return () => { feedbackListeners.delete(listener); }; }),
    getRasterDetailFeedback: vi.fn(() => feedback),
  };
  const lines: GameLogEntry[] = [];
  const log = { print: vi.fn((line: GameLogEntry): GameLogLine => { lines.push(line); return { update: vi.fn(), focusAction: vi.fn(), remove: vi.fn() }; }) };
  return {
    runtime, log, lines, adjusted, feedbackListeners,
    /** The runtime reports new feedback, as it does whenever delivery or support changes. */
    report(next: Partial<RasterDetailFeedback> | null) {
      feedback = next && { support: "ready", pending: false, limits: [], effectiveTarget: null, source: USGS, constraints: [], ...next };
      for (const listener of [...feedbackListeners]) listener();
    },
  };
}

describe("explanations of limits on 2D imagery", () => {
  it("name the limit, its values and what it does, from the runtime's numbers", () => {
    expect(describeImageryConstraint(TABLES)).toBe("2D imagery is limited by the page tables: 16 available, 20 needed by visible patches. 4 patches draw one coarser page instead.");
    expect(describeImageryConstraint({ ...TABLES, configured: 250, effective: 256 })).toContain("256 available, 250 set and rounded by the atlas layout");
    expect(describeImageryConstraint(BUDGET)).toBe("2D imagery is limited by the GPU budget (256 MiB): selection uses 1344 of the 1344 pages it may use in the 1600-page atlas, and 12 visible regions need at least 40 more.");
    // Shown detail it took away is a reduction, not a request it did not meet.
    expect(describeImageryConstraint({ ...BUDGET, reducedRegions: 5 })).toMatch(/^2D imagery detail was reduced by the GPU budget \(256 MiB\):.* 5 regions shown finer before are coarser now\.$/);
    expect(describeImageryConstraint({ ...BUDGET, rendererCapped: true, atlasMiB: 64 })).toContain("This renderer's texture size holds the atlas to 64 MiB.");
    expect(describeImageryConstraint({ cause: "node-cap", parameter: "map.imagery.maxNodes", configured: 12000, examined: 12000, regions: 30, reducedRegions: 0 }))
      .toBe("2D imagery is limited by the selection limit (12000 regions): 12000 were examined and 30 visible regions keep coarser imagery.");
    expect(describeImageryConstraint({ cause: "binding-depth", tableDepth: 6, levels: { min: 15, max: 16 }, regions: 7, cappedPatches: 0 }))
      .toBe("2D imagery is limited by how far terrain patches reach: a patch addresses imagery at most 6 levels finer than itself, so 7 visible regions stop at levels 15 to 16.");
    expect(describeImageryConstraint(SOURCE)).toBe("2D imagery is limited by the map source: it has no imagery for 3 visible regions. Where it has no image, the nearest coarser one it has is shown.");
    expect(describeImageryConstraint({ ...SOURCE, missingRegions: 0, finestLevelRegions: 40 })).toBe("2D imagery is limited by the map source: it has nothing finer than level 16 for 40 regions.");
    expect(describeImageryConstraint({ cause: "atlas-full", parameter: "map.imagery.gpuBudget", configuredMiB: 64, atlasPages: 400, pinnedPages: 390, waitingImages: 3 }))
      .toBe("2D imagery is limited by a full imagery atlas (GPU budget 64 MiB): 390 of its 400 pages are shown and the rest hold more important imagery, so 3 downloaded images wait for a slot.");
    expect(describeImageryConstraint({ cause: "reload", reason: "gpu-budget", parameter: "map.imagery.gpuBudget", value: 128 }))
      .toBe("2D imagery is loading again: the GPU budget changed to 128 MiB, which replaced the imagery atlas.");
    expect(describeImageryRecovery({ cause: "reload", reason: "context-restored", parameter: null, value: null })).toBe("2D imagery has loaded again after the graphics context was lost and restored.");
    expect(describeImageryRecovery(TABLES)).toBe("2D imagery is no longer limited by the page tables.");
    // One of something reads as one.
    expect(describeImageryConstraint({ ...TABLES, needed: 17, patches: 1 })).toContain("1 patch draws one coarser page instead.");
    expect(describeImageryConstraint({ ...BUDGET, regions: 1, reducedRegions: 1 })).toContain("1 visible region needs at least 40 more. 1 region shown finer before is coarser now.");
    expect(describeImageryConstraint({ cause: "binding-depth", tableDepth: 6, levels: { min: 16, max: 16 }, regions: 1, cappedPatches: 1 }))
      .toContain("so 1 visible region stops at level 16 and 1 patch shows coarser pages than it holds.");
  });
});

describe("map detail log", () => {
  it("reports a limit once delivery settles, an update only when its capacity changes, and its end", () => {
    const test = fakeRuntime();
    const disconnect = connectMapDetailLog(test.runtime, test.log);
    // While imagery loads, plans and counts change: nothing is reported yet.
    test.report({ pending: true, limits: ["memory", "loading"], constraints: [BUDGET] });
    expect(test.lines).toEqual([]);
    test.report({ limits: ["memory"], constraints: [BUDGET] });
    expect(test.lines).toEqual([{ text: describeImageryConstraint(BUDGET), tone: "warning" }]);
    // Other counts move with the view; that is the same limit.
    test.report({ limits: ["memory"], constraints: [{ ...BUDGET, regions: 30, morePagesAtLeast: 90 }] });
    test.report({ pending: true, limits: ["memory", "loading"], constraints: [] });
    test.report({ limits: ["memory"], constraints: [{ ...BUDGET, regions: 2 }] });
    expect(test.lines).toHaveLength(1);
    // The user lowers the budget: one update with the new value.
    const lower = { ...BUDGET, configuredMiB: 128, atlasPages: 800, selectablePages: 664, selectedPages: 664 };
    test.report({ limits: ["memory"], constraints: [lower] });
    expect(test.lines[1]).toEqual({ text: describeImageryConstraint(lower, true), tone: "warning" });
    expect(test.lines[1].text).toContain("is still limited by the GPU budget (128 MiB)");
    // It ends only once delivery settles without it.
    test.report({ pending: true, limits: ["loading"], constraints: [] });
    expect(test.lines).toHaveLength(2);
    test.report({ limits: [], constraints: [] });
    expect(test.lines[2]).toEqual({ text: "2D imagery is no longer limited by the GPU budget.", tone: "info" });
    test.report({ limits: [], constraints: [] });
    expect(test.lines).toHaveLength(3);
    disconnect();
  });

  it("aggregates each cause on its own line, never one per region or frame", () => {
    const test = fakeRuntime();
    connectMapDetailLog(test.runtime, test.log);
    for (let frame = 0; frame < 50; frame++) {
      test.report({ limits: ["source", "backend"], constraints: [{ ...SOURCE, missingRegions: 1 + frame }, { ...TABLES, patches: 1 + (frame % 5) }] });
    }
    expect(test.lines.map(line => line.text)).toEqual([
      describeImageryConstraint({ ...SOURCE, missingRegions: 1 }),
      describeImageryConstraint({ ...TABLES, patches: 1 }),
    ]);
  });

  it("reports a reload as it starts and once everything is back", () => {
    const test = fakeRuntime();
    connectMapDetailLog(test.runtime, test.log);
    const reload: ImageryConstraint = { cause: "reload", reason: "page-tables", parameter: "map.imagery.pageTablePatches", value: 512 };
    test.report({ pending: true, limits: ["loading"], constraints: [reload] });
    expect(test.lines).toEqual([{ text: "2D imagery is loading again: the page tables changed to 512, which replaced the imagery atlas.", tone: "warning" }]);
    test.report({ pending: true, limits: ["loading"], constraints: [reload] });
    test.report({ limits: [], constraints: [] });
    expect(test.lines.slice(1)).toEqual([{ text: "2D imagery has loaded again after the page tables changed.", tone: "info" }]);
  });

  it("retires what it reported for a source that is no longer shown, without claiming it recovered", () => {
    const test = fakeRuntime();
    connectMapDetailLog(test.runtime, test.log);
    test.report({ limits: ["backend"], constraints: [TABLES] });
    expect(test.lines).toHaveLength(1);
    // Another source: the old one's limit is neither ended nor carried over.
    test.report({ source: { id: "esri-world-imagery", version: "1", label: "Esri World Imagery" }, limits: [], constraints: [] });
    expect(test.lines).toHaveLength(1);
    test.report({ source: { id: "esri-world-imagery", version: "1", label: "Esri World Imagery" }, limits: ["backend"], constraints: [TABLES] });
    expect(test.lines).toHaveLength(2);
    // Leaving 2D imagery, as for Google 3D Tiles, says nothing either.
    test.report(null);
    test.report({ limits: [], constraints: [] });
    expect(test.lines).toHaveLength(2);
  });

  it("keeps automatic adjustment its own lines, and disconnects both", () => {
    const test = fakeRuntime();
    const disconnect = connectMapDetailLog(test.runtime, test.log);
    for (const listener of test.adjusted) listener({ at: 0, from: 0, to: 0.25, meanFrameMs: 23.14, goalMs: 16.7 });
    expect(test.lines).toEqual([{ text: "Map detail coarsened 0.25 levels to hold the frame time: frames averaged 23.1 ms against a 16.7 ms goal.", tone: "warning" }]);
    disconnect();
    expect(test.adjusted.size).toBe(0);
    expect(test.feedbackListeners.size).toBe(0);
    test.report({ limits: ["backend"], constraints: [TABLES] });
    expect(test.lines).toHaveLength(1);
  });

  it("says nothing about a URL, key or place", () => {
    const sentences = [BUDGET, TABLES, SOURCE].map(constraint => describeImageryConstraint(constraint));
    for (const sentence of sentences) expect(sentence).not.toMatch(/https?:|key=|token|°|lat|lon/i);
  });
});
