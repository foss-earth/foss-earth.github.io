// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBugReportPanel, type BugReportPanelHandle } from "./bugReportPanel";

const settle = async (): Promise<void> => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };
let section: BugReportPanelHandle | null = null;
afterEach(() => { section?.destroy(); section = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const reporter = { repository: "UMN-VR/UMN-VR.github.io", appName: "Campus tour" };
const rawReport = "Browser: Android Firefox Mobile\nBuild: abc123\nRenderer: webgl2\nGPU: Adreno 740\nThis visit, oldest first:\n1.0 s FULL_ACTIVITY_MARKER\n2.0 s Failed with opaque-settings-key\n";

function action<T extends HTMLElement = HTMLButtonElement>(name: string): T {
  return [...section!.element.querySelectorAll("button, a")].find(element => element.textContent === name) as T;
}

function fields(): { title: HTMLInputElement; description: HTMLTextAreaElement; report: HTMLTextAreaElement } {
  return {
    title: section!.element.querySelector('input[name="title"]')!,
    description: section!.element.querySelector('textarea[name="description"]')!,
    report: section!.element.querySelector('textarea[name="report"]')!,
  };
}

function describeBug(title = "The panorama goes black", description = "I opened the mall panorama."): void {
  const inputs = fields();
  inputs.title.value = title;
  inputs.description.value = description;
  inputs.description.dispatchEvent(new Event("input", { bubbles: true }));
}

function localDownloads(): { blobs: Map<string, Blob>; create: ReturnType<typeof vi.fn<(blob: Blob) => string>>; revoke: ReturnType<typeof vi.fn<(url: string) => void>> } {
  const blobs = new Map<string, Blob>();
  let next = 0;
  const create = vi.fn((blob: Blob): string => {
    const url = `blob:report-${++next}`;
    blobs.set(url, blob);
    return url;
  });
  const revoke = vi.fn((url: string): void => { blobs.delete(url); });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  });
  return { blobs, create, revoke };
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as string);
    reader.onerror = (): void => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Exercise our click handler while keeping jsdom from trying to save or navigate. */
function activateLink(link: HTMLAnchorElement): void {
  link.addEventListener("click", event => event.preventDefault(), { once: true });
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("static GitHub bug reporting", () => {
  it("collects only when opened and still downloads when a repository is missing or invalid", async () => {
    localDownloads();
    const report = vi.fn(async () => rawReport);
    section = createBugReportPanel({ report, previous: async () => null });
    expect(section.element.textContent).toContain("GitHub issue repository is not configured");
    expect(report).not.toHaveBeenCalled();
    section.show();
    await settle();
    describeBug();
    expect(action<HTMLAnchorElement>("Download report").download).toMatch(/^app-bug-report-/);
    expect(action<HTMLAnchorElement>("Open GitHub issue").hasAttribute("href")).toBe(false);
    section.destroy();
    section = createBugReportPanel({ report, previous: async () => null }, { issueReporter: { repository: "org/app?body=evil" } });
    expect(section.element.textContent).toContain("owner/name");
    expect(report).toHaveBeenCalledTimes(1);
    section.show();
    await settle();
    describeBug();
    expect(action<HTMLAnchorElement>("Download report").download).toMatch(/^app-bug-report-/);
  });

  it("prepares a local editable preview, then saves the complete report and opens only a summary draft", async () => {
    const downloads = localDownloads();
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const report = vi.fn(async () => rawReport);
    section = createBugReportPanel({ report, previous: async () => null, reportSecrets: () => ["opaque-settings-key"] }, { issueReporter: reporter });
    document.body.append(section.element);
    expect(report).not.toHaveBeenCalled();
    expect(section.element.getAttribute("aria-label")).toBe("Bug report");
    section.show();
    section.show();
    const inputs = fields();
    const download = action<HTMLAnchorElement>("Download report");
    const open = action<HTMLAnchorElement>("Open GitHub issue");
    expect(download.hasAttribute("href")).toBe(false);
    expect(open.hasAttribute("href")).toBe(false);
    await settle();
    expect(report).toHaveBeenCalledTimes(1);
    expect(inputs.report.readOnly).toBe(false);
    expect(inputs.report.value).toContain("FULL_ACTIVITY_MARKER");
    expect(inputs.report.value).not.toContain("opaque-settings-key");
    expect(download.hasAttribute("href")).toBe(false);
    describeBug("Problem with opaque-settings-key", "Reproduced using opaque-settings-key");
    expect(inputs.title.value).toBe("Problem with [redacted]");
    expect(inputs.description.value).toBe("Reproduced using [redacted]");
    const url = download.getAttribute("href")!;
    expect(url).toBe("blob:report-1");
    expect(download.download).toMatch(/^UMN-VR\.github\.io-bug-report-\d{4}-\d{2}-\d{2}T.*Z\.txt$/);
    const contents = await blobText(downloads.blobs.get(url)!);
    expect(contents).toContain("Title: Problem with [redacted]");
    expect(contents).toContain(inputs.description.value);
    expect(contents).toContain(inputs.report.value);
    expect(contents).not.toContain("opaque-settings-key");
    expect(open.hasAttribute("href")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    activateLink(download);
    expect(downloads.revoke).not.toHaveBeenCalled();
    const draft = new URL(open.href);
    expect(draft.origin).toBe("https://github.com");
    expect(draft.pathname).toBe("/UMN-VR/UMN-VR.github.io/issues/new");
    expect(draft.searchParams.get("body")).toContain("Android Firefox Mobile");
    expect(draft.searchParams.get("body")).toContain("webgl2");
    expect(draft.searchParams.get("body")).toContain(download.download);
    expect(draft.href).not.toContain("FULL_ACTIVITY_MARKER");
    expect(draft.href).not.toContain("opaque-settings-key");
    expect(open.target).toBe("_blank");
    expect(open.rel).toBe("noopener noreferrer");
    expect(section.element.textContent).toContain("GitHub attachments become public when uploaded");
  });

  it("updates the file and draft after edits, and releases only replaced or closed downloads", async () => {
    const downloads = localDownloads();
    section = createBugReportPanel({ report: async () => rawReport, previous: async () => null }, { issueReporter: reporter });
    section.show();
    await settle();
    describeBug();
    const download = action<HTMLAnchorElement>("Download report");
    const open = action<HTMLAnchorElement>("Open GitHub issue");
    activateLink(download);
    // jsdom freezes its parsed blob href; the content attribute is the updated
    // native download target, and the Blob below proves which report it holds.
    const firstUrl = download.getAttribute("href")!;
    fields().report.value = "Browser: Android Firefox Mobile\nBuild: changed-build\nRenderer: webgl2\nEDITED_ACTIVITY_MARKER\n";
    fields().report.dispatchEvent(new Event("input", { bubbles: true }));
    expect(downloads.revoke).toHaveBeenCalledWith(firstUrl);
    expect(download.getAttribute("href")).not.toBe(firstUrl);
    expect(open.hasAttribute("href")).toBe(false);
    expect(section.element.textContent).toContain("The report changed");
    const edited = await blobText(downloads.blobs.get(download.getAttribute("href")!)!);
    expect(edited).toContain("EDITED_ACTIVITY_MARKER");
    expect(edited).not.toContain("FULL_ACTIVITY_MARKER");
    activateLink(download);
    expect(new URL(open.href).searchParams.get("body")).toContain("changed-build");
    const finalUrl = download.getAttribute("href")!;
    section.destroy();
    expect(downloads.revoke).toHaveBeenCalledWith(finalUrl);
    expect(fields().report.value).toBe("");
    expect(download.hasAttribute("href")).toBe(false);
    expect(open.hasAttribute("href")).toBe(false);
  });

  it("preserves edits when the tab opens again and collects fresh activity only on Refresh", async () => {
    const downloads = localDownloads();
    const report = vi.fn<() => Promise<string>>().mockResolvedValueOnce(rawReport).mockResolvedValue("Browser: Android Firefox\nRenderer: webgl2\nFRESH_ACTIVITY\n");
    section = createBugReportPanel({ report, previous: async () => null }, { issueReporter: reporter });
    section.show();
    await settle();
    describeBug();
    fields().report.value = "REVIEWED_EDIT\n";
    fields().report.dispatchEvent(new Event("input", { bubbles: true }));
    const oldUrl = action<HTMLAnchorElement>("Download report").getAttribute("href")!;
    section.show();
    await settle();
    expect(report).toHaveBeenCalledTimes(1);
    expect(fields().report.value).toBe("REVIEWED_EDIT\n");
    action("Refresh report").click();
    await settle();
    expect(report).toHaveBeenCalledTimes(2);
    expect(fields().title.value).toBe("The panorama goes black");
    expect(fields().description.value).toBe("I opened the mall panorama.");
    expect(fields().report.value).toContain("FRESH_ACTIVITY");
    expect(downloads.revoke).toHaveBeenCalledWith(oldUrl);
    expect(action<HTMLAnchorElement>("Open GitHub issue").hasAttribute("href")).toBe(false);
  });

  it("ignores a destroyed panel's report and clears pending work on destroy", async () => {
    const downloads = localDownloads();
    let first!: (value: string) => void;
    let second!: (value: string) => void;
    const report = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
    section = createBugReportPanel({ report, previous: async () => null }, { issueReporter: reporter });
    section.show();
    await settle();
    const originalReportField = fields().report;
    section.destroy();
    section = createBugReportPanel({ report, previous: async () => null }, { issueReporter: reporter });
    section.show();
    describeBug();
    await settle();
    second("Browser: Android Firefox\nRenderer: webgl2\nNEW_ACTIVITY\n");
    await settle();
    expect(fields().report.value).toContain("NEW_ACTIVITY");
    first("Browser: old-browser\nSTALE_ACTIVITY\n");
    await settle();
    expect(fields().report.value).not.toContain("STALE_ACTIVITY");
    expect(originalReportField.value).toBe("");
    expect(downloads.create).toHaveBeenCalledTimes(1);
    let pending!: (value: string) => void;
    report.mockImplementationOnce(() => new Promise(resolve => { pending = resolve; }));
    action("Refresh report").click();
    await settle();
    section.destroy();
    pending(rawReport);
    await settle();
    expect(fields().report.value).toBe("");
    expect(downloads.create).toHaveBeenCalledTimes(1);
  });

  it("lets a failed report be retried with an actionable message", async () => {
    localDownloads();
    const report = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValue(rawReport);
    section = createBugReportPanel({ report, previous: async () => null }, { issueReporter: reporter });
    section.show();
    await settle();
    expect(section.element.textContent).toContain("The activity report could not be prepared");
    expect(action("Try report again").hasAttribute("disabled")).toBe(false);
    describeBug();
    action("Try report again").click();
    await settle();
    expect(report).toHaveBeenCalledTimes(2);
    expect(action<HTMLAnchorElement>("Download report").href).toBe("blob:report-1");
    expect(action("Refresh report").hasAttribute("disabled")).toBe(false);
  });

  it("offers a copy fallback without downloads and ignores a destroyed panel's pending copy", async () => {
    const downloads = localDownloads();
    downloads.create.mockImplementation(() => { throw new Error("Unavailable"); });
    let copied!: () => void;
    const copy = vi.fn<() => Promise<void>>().mockImplementationOnce(() => new Promise(resolve => { copied = resolve; })).mockResolvedValue(undefined);
    section = createBugReportPanel({ report: async () => rawReport, previous: async () => null, copy }, { issueReporter: reporter });
    section.show();
    await settle();
    describeBug();
    expect(action("Copy reviewed report").hidden).toBe(false);
    expect(section.element.textContent).toContain("File downloads are unavailable");
    action("Copy reviewed report").click();
    await settle();
    expect(action("Copy reviewed report").hasAttribute("disabled")).toBe(true);
    section.destroy();
    section = createBugReportPanel({ report: async () => rawReport, previous: async () => null, copy }, { issueReporter: reporter });
    section.show();
    await settle();
    describeBug();
    expect(action("Copy reviewed report").hasAttribute("disabled")).toBe(false);
    copied();
    await settle();
    expect(action<HTMLAnchorElement>("Open GitHub issue").hasAttribute("href")).toBe(false);
    action("Copy reviewed report").click();
    await settle();
    expect(action<HTMLAnchorElement>("Open GitHub issue").href).toContain("https://github.com/");
    expect(copy).toHaveBeenCalledTimes(2);
  });
});
