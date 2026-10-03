// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaStoreSnapshot } from "../scenes/mediaStore";
import { createSavedImagesSection, type SavedImagesSectionHandle } from "./savedImagesSection";

const MIB = 1024 * 1024;
const snapshot = (over: Partial<MediaStoreSnapshot> = {}): MediaStoreSnapshot => ({
  available: true, problem: null, bytes: 3 * MIB, files: 412, maxBytes: 256 * MIB,
  groups: [
    { id: "northrop-mall@ac69/eac-tiles", label: "northrop-mall · eac-tiles", bytes: 2.5 * MIB, files: 352, used: Date.UTC(2026, 9, 3, 21) },
    { id: "northrop-mall@ac69/preview-64", label: "northrop-mall · preview-64", bytes: 0.5 * MIB, files: 60, used: Date.UTC(2026, 9, 3, 20) },
  ],
  reused: { files: 120, bytes: 1.5 * MIB }, added: { files: 292, bytes: 1.5 * MIB },
  ...over,
});

describe("the saved images section", () => {
  let section: SavedImagesSectionHandle | null = null;
  afterEach(() => { section?.destroy(); section = null; vi.useRealTimers(); });
  const text = (): string => section!.element.textContent ?? "";
  const settle = async (): Promise<void> => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };

  it("says what is kept, what this visit took from it, and lists the images", async () => {
    section = createSavedImagesSection({ inspect: async () => snapshot(), clear: async () => {} });
    document.body.append(section.element);
    await settle();
    expect(text()).toContain("412 files of 2 images · 3.0 MB of 256.0 MB");
    expect(text()).toContain("This visit: 120 files (1.5 MB) came from saved images instead of the network, and 292 files (1.5 MB) were added.");
    expect([...section.element.querySelectorAll("li span")].map(item => item.textContent)).toEqual(["northrop-mall · eac-tiles", "northrop-mall · preview-64"]);
    const usage = section.element.querySelector("progress")!;
    expect([usage.value, usage.max]).toEqual([3 * MIB, 256 * MIB]);
    expect(section.element.querySelector("button")!.disabled).toBe(false);
  });

  it("clears, and says what that does to the images on screen", async () => {
    let kept = snapshot();
    const clear = vi.fn(async () => { kept = snapshot({ bytes: 0, files: 0, groups: [] }); });
    section = createSavedImagesSection({ inspect: async () => kept, clear });
    document.body.append(section.element);
    await settle();
    section.element.querySelector("button")!.click();
    await settle();
    expect(clear).toHaveBeenCalledOnce();
    expect(text()).toContain("0 files of 0 images · 0.0 KB of 256.0 MB");
    expect(section.element.querySelector("[role=status]")!.textContent).toMatch(/^Saved images cleared\./);
    expect(section.element.querySelector("button")!.disabled).toBe(true);
  });

  it("says why nothing is kept: no storage, a refusal, or a limit of nothing", async () => {
    for (const [over, said] of [
      [{ available: false, files: 0, bytes: 0, groups: [] }, /no storage for images/],
      [{ problem: "The browser has no more room for this site's images, so nothing more is kept this visit." }, /no more room/],
      [{ maxBytes: 0, files: 0, bytes: 0, groups: [] }, /the limit above is 0/],
    ] as const) {
      section = createSavedImagesSection({ inspect: async () => snapshot(over), clear: async () => {} });
      document.body.append(section.element);
      await settle();
      expect(text()).toMatch(said);
      section.destroy();
      section = null;
    }
  });
});
