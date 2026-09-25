import { describe, expect, it } from "vitest";
import { resolveDockLayout, type DockLayoutInput } from "./dockLayout";

const preferences = { primaryWidth: 320, secondaryWidth: 320, logWidth: null };

describe("shared window and log layout", () => {
  it("switches both windows and log at the space needed for their minimum widths and all four gaps", () => {
    const narrow = resolveDockLayout({ ...preferences, availableWidth: 847 });
    const wide = resolveDockLayout({ ...preferences, availableWidth: 848 });

    expect(narrow.mode).toBe("single");
    expect(narrow.logLeft).toBe(12);
    expect(wide).toEqual({
      mode: "dual",
      primaryWidth: 320,
      secondaryWidth: 320,
      maxWindowWidth: 320,
      logLeft: 344,
      logWidth: 160,
      logCenter: 424,
    });
  });

  it.each([[420, 320], [320, 420]])("keeps the log at viewport center with unequal windows (%s, %s)", (primaryWidth, secondaryWidth) => {
    const input = { ...preferences, primaryWidth, secondaryWidth };
    expect(resolveDockLayout({ ...input, availableWidth: 1047 }).mode).toBe("single");
    const layout = resolveDockLayout({ ...input, availableWidth: 1048 });

    expect(layout.mode).toBe("dual");
    expect(layout.logLeft).toBe(444);
    expect(layout.logWidth).toBe(160);
    expect(layout.logCenter).toBe(524);
    expect(resolveDockLayout({ ...input, availableWidth: 1280 }).logCenter).toBe(640);
  });

  it("gives a manual log resize priority by shrinking windows, then restores their preferences", () => {
    const input = { ...preferences, availableWidth: 1280 };
    const original = resolveDockLayout(input);
    const enlarged = resolveDockLayout({ ...input, logWidth: 640, priority: "log" });

    expect(enlarged).toEqual({
      mode: "dual",
      primaryWidth: 296,
      secondaryWidth: 296,
      maxWindowWidth: 420,
      logLeft: 320,
      logWidth: 640,
      logCenter: 640,
    });
    expect(resolveDockLayout(input)).toEqual(original);
    expect(input.primaryWidth).toBe(320);
    expect(input.secondaryWidth).toBe(320);
  });

  it("folds the left window once the requested log outgrows two minimum-width windows", () => {
    const input = { ...preferences, availableWidth: 1280, priority: "log" as const };
    const lastDual = resolveDockLayout({ ...input, logWidth: 912 });
    const firstSingle = resolveDockLayout({ ...input, logWidth: 913, previousMode: lastDual.mode });

    expect(lastDual).toMatchObject({ mode: "dual", primaryWidth: 160, secondaryWidth: 160, logWidth: 912, logCenter: 640 });
    expect(firstSingle).toMatchObject({ mode: "single", logLeft: 12, logWidth: 913, secondaryWidth: 320 });
    expect(resolveDockLayout({ ...input, logWidth: 912, previousMode: firstSingle.mode })).toEqual(lastDual);
    expect(resolveDockLayout({ ...input, logWidth: 2000 })).toMatchObject({
      mode: "single", logLeft: 12, logWidth: 1084, secondaryWidth: 160,
    });
  });

  it("gives a later window resize priority by squeezing the log and releases space when it retreats", () => {
    const input = { ...preferences, availableWidth: 1280, logWidth: 640, priority: "windows" as const, previousMode: "dual" as const };
    const widened = resolveDockLayout({ ...input, primaryWidth: 420 });
    const retreated = resolveDockLayout({ ...input, primaryWidth: 296, secondaryWidth: 296 });

    expect(widened).toMatchObject({ mode: "dual", primaryWidth: 420, secondaryWidth: 320, logWidth: 392, logCenter: 640 });
    expect(retreated).toMatchObject({ mode: "dual", primaryWidth: 296, secondaryWidth: 296, logWidth: 640, logCenter: 640 });
    expect(input.logWidth).toBe(640);
  });

  it("keeps a wide single log on the left during a window resize until it can center without shrinking", () => {
    const input = { ...preferences, availableWidth: 1280, logWidth: 913 };
    const expandedLog = resolveDockLayout({ ...input, priority: "log" });
    const resizedWindow = resolveDockLayout({ ...input, secondaryWidth: 420, priority: "windows", previousMode: expandedLog.mode });

    expect(expandedLog.mode).toBe("single");
    expect(resizedWindow).toMatchObject({ mode: "single", secondaryWidth: 420, logLeft: 12, logWidth: 824 });
    const untilFits = { ...input, priority: "windows" as const, previousMode: "single" as const };
    expect(resolveDockLayout({ ...untilFits, availableWidth: 1600 }).mode).toBe("single");
    expect(resolveDockLayout({ ...untilFits, availableWidth: 1601 })).toMatchObject({
      mode: "dual", logWidth: 913, logCenter: 800.5,
    });
  });

  it("lets a natural or manually narrowed log return from single to dual layout", () => {
    expect(resolveDockLayout({ ...preferences, availableWidth: 848, previousMode: "single" }).mode).toBe("dual");
    expect(resolveDockLayout({
      ...preferences, availableWidth: 1280, logWidth: 592, priority: "windows", previousMode: "single",
    })).toMatchObject({ mode: "dual", logWidth: 592, logCenter: 640 });
    expect(resolveDockLayout({
      ...preferences, availableWidth: 1280, logWidth: 593, priority: "windows", previousMode: "single",
    }).mode).toBe("single");
  });

  it("never overlaps the log and visible windows for either resize priority or previous arrangement", () => {
    const widths = [280, 320, 528, 640, 700, 847, 848, 849, 1047, 1048, 1049, 1280, 1600, 1601, 1920];
    const dockWidths = [[160, 160], [160, 420], [320, 320], [420, 320], [320, 420], [420, 420]];
    const logWidths = [null, 160, 380, 912, 913, 2000];

    for (const availableWidth of widths) {
      for (const [primaryWidth, secondaryWidth] of dockWidths) {
        for (const logWidth of logWidths) {
          for (const priority of ["log", "windows"] as const) {
            for (const previousMode of [undefined, "single", "dual"] as const) {
              const input: DockLayoutInput = { availableWidth, primaryWidth, secondaryWidth, logWidth, priority, previousMode };
              const layout = resolveDockLayout(input);
              const context = JSON.stringify(input);
              const logRight = layout.logLeft + layout.logWidth;
              const rightDockLeft = availableWidth - 12 - layout.secondaryWidth;

              expect(layout.logWidth, context).toBeGreaterThan(0);
              expect(layout.logLeft, context).toBeGreaterThanOrEqual(12);
              expect(logRight + 12, context).toBeLessThanOrEqual(rightDockLeft + 1e-9);
              expect(layout.secondaryWidth, context).toBeLessThanOrEqual(secondaryWidth);
              if (layout.mode === "dual") {
                expect(layout.logLeft, context).toBeGreaterThanOrEqual(12 + layout.primaryWidth + 12 - 1e-9);
                expect(layout.logCenter, context).toBe(availableWidth / 2);
                expect(layout.primaryWidth, context).toBeGreaterThanOrEqual(160);
                expect(layout.secondaryWidth, context).toBeGreaterThanOrEqual(160);
                expect(layout.primaryWidth, context).toBeLessThanOrEqual(primaryWidth);
                if (priority === "log" && logWidth !== null) expect(layout.logWidth, context).toBe(logWidth);
              } else {
                expect(layout.logLeft, context).toBe(12);
              }
              const repeated = resolveDockLayout({ ...input, previousMode: layout.mode });
              expect(repeated, context).toEqual(layout);
            }
          }
        }
      }
    }
  });
});
