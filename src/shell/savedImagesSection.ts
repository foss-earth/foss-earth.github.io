import { clearSceneMedia, inspectSceneMedia, type MediaStoreSnapshot } from "../scenes/mediaStore";

export interface SavedImagesSectionHandle {
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

/** "412 files (5.2 MB)". */
const counted = (tally: { files: number; bytes: number }): string => `${tally.files} ${tally.files === 1 ? "file" : "files"} (${size(tally.bytes)})`;

/**
 * Scenes → Saved images: the scene images the app keeps between visits, what
 * this visit took from them instead of the network, and a way to clear them.
 * Laid out as the map's saved tiles are (mapCacheSection.ts).
 */
export function createSavedImagesSection(source: { inspect(): Promise<MediaStoreSnapshot>; clear(): Promise<void> } = { inspect: inspectSceneMedia, clear: clearSceneMedia }): SavedImagesSectionHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-map-cache-section foss-earth-saved-images-section";
  element.setAttribute("aria-label", "Saved images");
  const summary = paragraph("Reading saved images…");
  const usage = document.createElement("progress");
  usage.setAttribute("aria-label", "Saved image storage used");
  usage.max = 1;
  usage.value = 0;
  const visit = paragraph("");
  const availability = paragraph("");
  availability.hidden = true;
  const kept = document.createElement("details");
  const keptTitle = document.createElement("summary");
  const keptList = document.createElement("ul");
  kept.append(keptTitle, keptList);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "foss-earth-choice foss-earth-parameter__action";
  clear.textContent = "Clear saved images";
  const how = paragraph("Each file is kept under its image's revision in the scene, so it is downloaded once: a later visit, a reload, or a look back at part of a 360 image reads it from here. An image the scene has changed gets a new revision and is downloaded again; the old files go when room is needed. The browser's own cache is separate, and this page cannot list or clear it.");
  const status = paragraph("");
  status.setAttribute("role", "status");
  element.append(summary, usage, visit, availability, kept, clear, how, status);

  let snapshot: MediaStoreSnapshot | null = null;
  let disposed = false;
  let clearing = false;

  const render = (): void => {
    summary.textContent = snapshot ? `${snapshot.files} ${snapshot.files === 1 ? "file" : "files"} of ${snapshot.groups.length} ${snapshot.groups.length === 1 ? "image" : "images"} · ${size(snapshot.bytes)} of ${size(snapshot.maxBytes)}` : "Reading saved images…";
    usage.max = snapshot?.maxBytes || 1;
    usage.value = snapshot?.bytes ?? 0;
    visit.hidden = !snapshot?.available;
    visit.textContent = snapshot ? `This visit: ${counted(snapshot.reused)} came from saved images instead of the network, and ${counted(snapshot.added)} were added.` : "";
    const trouble = !snapshot ? null : !snapshot.available
      ? "This browser session has no storage for images, so each visit downloads them again; the browser's own cache still applies."
      : snapshot.problem ?? (snapshot.maxBytes <= 0 ? "Nothing is kept: the limit above is 0." : null);
    availability.hidden = trouble === null;
    availability.textContent = trouble ?? "";
    kept.hidden = !snapshot || snapshot.groups.length === 0;
    keptTitle.textContent = `What is kept, most recently used first`;
    keptList.replaceChildren(...(snapshot?.groups ?? []).slice(0, 60).map(group => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "foss-earth-map-cache__tile";
      name.textContent = group.label;
      const meta = document.createElement("small");
      meta.textContent = `${group.files} ${group.files === 1 ? "file" : "files"} · ${size(group.bytes)} · used ${new Date(group.used).toLocaleString()}`;
      item.append(name, meta);
      return item;
    }));
    if (snapshot && snapshot.groups.length > 60) keptList.append(Object.assign(document.createElement("li"), { textContent: `And ${snapshot.groups.length - 60} more.` }));
    clear.disabled = clearing || !snapshot?.available || snapshot.files === 0;
    clear.textContent = clearing ? "Clearing…" : "Clear saved images";
  };

  const refresh = (): void => {
    void source.inspect().then(value => {
      if (disposed) return;
      snapshot = value;
      render();
    }, () => {
      if (disposed) return;
      status.textContent = "Could not read the saved images. Scenes still load.";
    });
  };
  const onClear = (): void => {
    clearing = true;
    render();
    void source.clear().then(async () => {
      snapshot = await source.inspect();
      status.textContent = "Saved images cleared. Images already on screen stay; they are downloaded again when next needed.";
    }, () => {
      status.textContent = "Could not clear the saved images. Check the browser's site storage settings.";
    }).finally(() => {
      clearing = false;
      if (!disposed) render();
    });
  };
  clear.addEventListener("click", onClear);
  render();
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
      clear.removeEventListener("click", onClear);
      element.remove();
    },
  };
}
