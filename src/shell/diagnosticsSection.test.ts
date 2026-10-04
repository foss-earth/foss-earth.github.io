// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { PreviousVisit } from "../diagnostics/sessionTrail";
import { createDiagnosticsSection, describeLastVisit, type DiagnosticsSectionHandle } from "./diagnosticsSection";

const visit = (ended: PreviousVisit["ended"]): PreviousVisit => ({
  ended,
  record: { version: 1, id: "a", startedAt: 0, app: "", state: "", steps: [{ ms: 42_000, text: "Inside the 360 image northrop-mall" }], closed: ended === "closed", hidden: ended === "hidden" },
});
const settle = async (): Promise<void> => { for (let turn = 0; turn < 6; turn++) await Promise.resolve(); };

let section: DiagnosticsSectionHandle | null = null;
afterEach(() => { section?.destroy(); section = null; });

describe("Settings → Diagnostics", () => {
  it("says how the last visit ended", async () => {
    expect(describeLastVisit(null)).toBe("No trail of an earlier visit on this device.");
    section = createDiagnosticsSection({ report: async () => "", previous: async () => visit("unexpected") });
    document.body.append(section.element);
    await settle();
    expect(section.element.querySelector("p")?.textContent).toBe("The last visit stopped without being closed, 42 s after it opened or later; its last step: Inside the 360 image northrop-mall.");
  });

  it("copies the report and shows what it copied", async () => {
    const copied: string[] = [];
    section = createDiagnosticsSection({ report: async () => "FOSS Earth report\nRenderer: webgpu\n", previous: async () => null, copy: async text => { copied.push(text); } });
    document.body.append(section.element);
    const text = section.element.querySelector("textarea")!;
    const status = section.element.querySelector("[role=status]") as HTMLElement;
    expect(text.hidden).toBe(true);
    expect(status.hidden).toBe(true);
    section.element.querySelector("button")!.click();
    await settle();
    expect(copied).toEqual(["FOSS Earth report\nRenderer: webgpu\n"]);
    expect(text.hidden).toBe(false);
    expect(text.readOnly).toBe(true);
    expect(text.value).toBe("FOSS Earth report\nRenderer: webgpu\n");
    expect(status.textContent).toMatch(/^Copied, 0\.0 KB: paste it where you are reporting the fault\./);
  });

  it("leaves the report to be selected where the browser gives no clipboard", async () => {
    section = createDiagnosticsSection({ report: async () => "FOSS Earth report\n", previous: async () => null, copy: () => Promise.reject(new Error("NotAllowedError")) });
    document.body.append(section.element);
    section.element.querySelector("button")!.click();
    await settle();
    const text = section.element.querySelector("textarea")!;
    expect(text.value).toBe("FOSS Earth report\n");
    expect(document.activeElement).toBe(text);
    expect(section.element.querySelector("[role=status]")?.textContent).toMatch(/^The browser did not let the page copy it\. Select the text below/);
  });
});
