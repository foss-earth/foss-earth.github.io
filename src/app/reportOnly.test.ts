// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TRAIL_KEY_PREFIX } from "../diagnostics/sessionTrail";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import { addressWithoutReport, showReportOnly, wantsReportOnly } from "./reportOnly";

const settle = async (ms = 500): Promise<void> => { await new Promise(resolve => setTimeout(resolve, ms)); };

afterEach(() => { document.body.replaceChildren(); });

describe("the report-only page", () => {
  it("is asked for with ?report, whatever else the address says", () => {
    expect(wantsReportOnly("?report")).toBe(true);
    expect(wantsReportOnly("?renderer=webgl2&report=1")).toBe(true);
    expect(wantsReportOnly("?scene=report")).toBe(false);
    expect(addressWithoutReport("https://tour.test/tour/?renderer=webgl2&report")).toBe("https://tour.test/tour/?renderer=webgl2");
  });

  it("shows how the last visit ended and its steps without starting the app, and leaves its trail for the app's next visit", async () => {
    const key = `${TRAIL_KEY_PREFIX}before`;
    localStorage.setItem(key, JSON.stringify({
      version: 1, id: "before", startedAt: Date.parse("2026-10-04T15:50:00Z"), app: "Build b, bundle twinCities-C9TYTT-e.js, renderer webgpu.",
      state: "scene umn-twin-cities, revision 4b89d4e2af09, inside the 360 image northrop-mall", steps: [{ ms: 42_000, text: "Inside the 360 image northrop-mall" }], closed: false, hidden: false,
    }));
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    const root = document.createElement("div");
    document.body.append(root);
    showReportOnly(root, { settings, identity: { build: "2026-10-04T15:00:00.000Z", source: "1a2b3c4d", fossEarth: "9f8e7d6c5b4a", bundle: "twinCities-DWWktTbX.js" } });
    await settle();
    expect(root.querySelector("h1")?.textContent).toBe("Report");
    expect(root.querySelector(".foss-earth-diagnostics-section p")?.textContent).toMatch(/^The last visit stopped without being closed, 42 s after it opened or later; it was at: scene umn-twin-cities/);
    const report = root.querySelector("textarea")!.value;
    expect(report).toContain("Build: 2026-10-04T15:00:00.000Z · source 1a2b3c4d · FOSS Earth 9f8e7d6c5b4a · bundle twinCities-DWWktTbX.js");
    // This test's page carries no build stamp, as a development build.
    expect(report).toContain("Published: This page does not say which build it is");
    expect(report).toContain("Renderer: not started (asked for not started)");
    expect(report).toContain("for the report only: the map was not started");
    expect(report).toContain("stopped without being closed, while shown. Build b, bundle twinCities-C9TYTT-e.js, renderer webgpu.");
    expect(report).toContain("  It was at: scene umn-twin-cities, revision 4b89d4e2af09, inside the 360 image northrop-mall");
    // The report is there without a press of the button; this test's browser has no clipboard, so it is left selected.
    expect(root.querySelector("[role=status]")?.textContent).toMatch(/^The browser did not let the page copy it/);
    expect(root.querySelector("a")?.getAttribute("href")).toBe(addressWithoutReport(location.href));
    // Still there: the app's next visit says so too, and this page can be opened again.
    expect(localStorage.getItem(key)).not.toBeNull();
    expect([...Array(localStorage.length).keys()].map(index => localStorage.key(index))).toEqual([key]);
  });
});
