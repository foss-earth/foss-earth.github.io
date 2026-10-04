import type { AppFilesStatus } from "../app/appFiles";

export interface AppFilesSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = "foss-earth-choices__note";
  element.textContent = text;
  return element;
}

/** "34 files (7.2 MB)". */
const counted = (status: AppFilesStatus): string => `${status.files} ${status.files === 1 ? "file" : "files"} (${size(status.bytes)})`;

/** What the section says of `status`, in a sentence or two. */
export function describeAppFiles(status: AppFilesStatus | null): string {
  if (!status) return "Reading the app's files…";
  if (status.unavailable) return status.unavailable;
  if (!status.installed) return status.files ? `${counted(status)} of the app kept, from before keeping was turned off; they go when this page closes.` : "Nothing kept yet: the app's files are kept once this page has loaded.";
  return `${counted(status)} of the app kept on this device. ${status.controlling ? "This visit takes them from there." : "The next visit takes them from there."}`;
}

/**
 * Settings → App files: what of the app's own files this device keeps,
 * beside the switch that turns keeping them on and off (app.keepFiles). Laid
 * out as the scene images' section (savedImagesSection.ts).
 */
export function createAppFilesSection(source: { status(): Promise<AppFilesStatus> }): AppFilesSectionHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-map-cache-section foss-earth-app-files-section";
  element.setAttribute("aria-label", "App files");
  const summary = paragraph(describeAppFiles(null));
  summary.setAttribute("role", "status");
  const how = paragraph("A service worker of this site's own keeps them and answers for them; it lets everything else through. The page itself always comes from the network, so a new version of the app shows on the next visit.");
  element.append(summary, how);

  let disposed = false;
  const refresh = (): void => {
    void source.status().then(status => {
      if (!disposed) summary.textContent = describeAppFiles(status);
    }, () => {
      if (!disposed) summary.textContent = "Could not read the app's kept files.";
    });
  };
  refresh();
  // Read again every two seconds while the section is open; closed sections cost nothing.
  const timer = window.setInterval(() => {
    if (element.isConnected && element.closest("details")?.open !== false) refresh();
  }, 2000);

  return {
    element,
    destroy() {
      disposed = true;
      window.clearInterval(timer);
      element.remove();
    },
  };
}
