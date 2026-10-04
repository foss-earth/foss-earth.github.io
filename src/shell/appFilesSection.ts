import type { AppFilesStatus } from "../app/appFiles";
import { describePublishedVersion, type PublishedVersionWatch } from "../app/publishedVersion";

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

/** What the section reads of the published version, and asks of it (publishedVersion.ts). */
export type PublishedVersionSource = Pick<PublishedVersionWatch, "state" | "subscribe" | "ask" | "reload" | "now">;

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "foss-earth-choice foss-earth-parameter__action";
  element.textContent = label;
  return element;
}

/**
 * Settings → App files: what of the app's own files this device keeps, and
 * whether this page is the version of the app the site publishes, beside the
 * parameters that decide both (app.*). Laid out as the scene images' section
 * (savedImagesSection.ts).
 */
export function createAppFilesSection(source: { status(): Promise<AppFilesStatus> }, published?: PublishedVersionSource): AppFilesSectionHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-map-cache-section foss-earth-app-files-section";
  element.setAttribute("aria-label", "App files");
  const summary = paragraph(describeAppFiles(null));
  summary.setAttribute("role", "status");
  const how = paragraph("A service worker of this site's own keeps them and answers for them; it lets everything else through. It does not keep the page itself: a browser asks the network for a page it opens, but one that restores a tab may show its own copy from days before, with the app of that day.");
  element.append(summary, how);

  let disposed = false;
  let asking = false;
  let stopVersion = (): void => {};
  let renderVersion = (): void => {};
  if (published) {
    const version = paragraph("");
    version.setAttribute("role", "status");
    const ask = button("Ask now");
    const reload = button("Reload to use the published version");
    renderVersion = (): void => {
      const state = published.state();
      version.textContent = asking ? "Asking the site which version is published…" : describePublishedVersion(state, published.now());
      ask.disabled = asking || state.kind === "unstamped" || state.kind === "off";
      reload.hidden = state.kind !== "older";
    };
    ask.addEventListener("click", () => {
      asking = true;
      renderVersion();
      const done = (): void => {
        asking = false;
        if (!disposed) renderVersion();
      };
      void published.ask().then(done, done);
    });
    reload.addEventListener("click", () => published.reload());
    stopVersion = published.subscribe(() => { if (!disposed) renderVersion(); });
    renderVersion();
    element.append(version, ask, reload);
  }

  const refresh = (): void => {
    // How long ago the site was asked moves on.
    renderVersion();
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
      stopVersion();
      window.clearInterval(timer);
      element.remove();
    },
  };
}
