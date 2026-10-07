// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILT_FROM_ID, type BuiltFrom } from "../app/builtFrom";
import type { PublishedVersion } from "../app/publishedVersion";
import { createAboutPanel } from "./aboutPanel";

const APP = "7e80fdc8a1b2c3d4e5f60718293a4b5c6d7e8f90";
const EARLIER = "9c195634a1b2c3d4e5f60718293a4b5c6d7e8f90";
const EARTH = "e88e7ea93f53124ba31c9d448f4e6445fc48f95b";
const PADS = "fd1a3e657401c4078c5bc293fa42a1da5ad9ac00";
const IDENTITY = { build: "2026-10-07T18:20:00.000Z", source: "7e80fdc8a1b2", fossEarth: "e88e7ea93f53", bundle: "index-AbCd1234.js" };

/** The flight simulator as its build describes itself. */
const FLIGHT: BuiltFrom = {
  built: "2026-10-07T18:20:00.000Z",
  app: {
    name: "osfs",
    from: "app",
    commit: APP,
    repository: "https://github.com/0SFS/0SFS.github.io",
    dirty: true,
    unpushed: true,
    history: [
      { hash: APP, at: "2026-10-07T11:10:00-05:00", subject: "Draw each control surface's force" },
      { hash: EARLIER, at: "2026-10-07T09:00:00-05:00", subject: "Correct F135 particle optics" },
    ],
    parts: [
      { name: "@felipegalind0/gamepad-tools", version: "0.1.0", from: "checkout", commit: PADS, repository: "https://github.com/Felipegalind0/gamepad-tools", built: "2026-10-07T18:10:34.467Z",
        history: [{ hash: PADS, at: "2026-10-05T01:58:11-05:00", subject: "Size the dropdowns to their own text" }] },
      { name: "foss-earth", version: "0.0.0", from: "checkout", commit: EARTH, repository: "https://github.com/foss-earth/foss-earth.github.io",
        history: [{ hash: EARTH, at: "2026-10-07T11:00:39-05:00", subject: "Draw rotations as arcs" }],
        parts: [{ name: "@felipegalind0/gamepad-tools", version: "0.1.0", from: "checkout", listedAbove: true }] },
      { name: "react", version: "19.2.6", from: "registry", repository: "https://github.com/facebook/react" },
    ],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const lines = (element: HTMLElement): string[] => [...element.querySelectorAll(".foss-earth-about__app .foss-earth-about__line")].map(line => line.textContent ?? "");

describe("createAboutPanel", () => {
  it("names the build, then everything it is built from as a tree with the app at the top", () => {
    const about = createAboutPanel({ builtFrom: FLIGHT, identity: IDENTITY, title: "0SFS" });
    document.body.append(about.element);
    expect(about.element.querySelector("h2")?.textContent).toBe("0SFS");
    expect(lines(about.element)).toEqual(["Built 2026-10-07 18:20 UTC.", "Bundle: index-AbCd1234.js"]);

    const app = about.element.querySelector<HTMLDetailsElement>(".foss-earth-about__tree > li > details")!;
    // The app opens on its parts, each a line; a part opens on request.
    expect(app.open).toBe(true);
    expect(app.querySelector("summary")?.textContent).toBe("osfs7e80fdcchanges not committednot pushed when built");
    const parts = [...app.querySelectorAll(":scope > .foss-earth-about__body > .foss-earth-about__parts > li")];
    expect(parts.map(part => part.querySelector(".foss-earth-about__row")?.textContent)).toEqual([
      "@felipegalind0/gamepad-tools0.1.0fd1a3e6",
      "foss-earth0.0.0e88e7ea",
      "react19.2.6",
    ]);
    expect(parts.every(part => !part.querySelector("details")?.open)).toBe(true);
    expect(app.querySelector(".foss-earth-about__body > .foss-earth-about__line")?.textContent)
      .toBe("“Draw each control surface's force”, committed 2026-10-07 16:10 UTC.");
  });

  it("links each part's commit, its history up to it, its source and its npm page", () => {
    const about = createAboutPanel({ builtFrom: FLIGHT, identity: IDENTITY });
    const linksOf = (index: number) => [...about.element.querySelectorAll<HTMLDetailsElement>("details")[index]
      .querySelectorAll<HTMLAnchorElement>(":scope > .foss-earth-about__body > .foss-earth-about__links a")]
      .map(link => [link.textContent, link.href]);
    expect(linksOf(0)).toEqual([
      ["Commit", `https://github.com/0SFS/0SFS.github.io/commit/${APP}`],
      ["History", `https://github.com/0SFS/0SFS.github.io/commits/${APP}`],
      ["Source", `https://github.com/0SFS/0SFS.github.io/tree/${APP}`],
    ]);
    expect(linksOf(3)).toEqual([
      ["Source", "https://github.com/facebook/react"],
      ["npm", "https://www.npmjs.com/package/react/v/19.2.6"],
    ]);
    for (const link of about.element.querySelectorAll("a")) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    }
    // The commits before the built one, each linked.
    const earlier = [...about.element.querySelectorAll("details")[0].querySelectorAll(":scope > .foss-earth-about__body > .foss-earth-about__history li")];
    expect(earlier.map(item => item.textContent)).toEqual(["9c195632026-10-07 14:00 UTCCorrect F135 particle optics"]);
    // Built on its own before the app: when.
    expect(about.element.querySelectorAll("details")[1].textContent).toContain("Its own build: 2026-10-07 18:10 UTC.");
  });

  /**
   * gamepad-tools is linked into the app and into FOSS Earth, and the build
   * holds one copy: listed in full once, and pointed to where else it is
   * brought in, never as a second package of the same name.
   */
  it("points a package brought in twice to its one full entry, and opens it", () => {
    const about = createAboutPanel({ builtFrom: FLIGHT, identity: IDENTITY });
    document.body.append(about.element);
    const above = about.element.querySelector<HTMLButtonElement>(".foss-earth-about__above")!;
    expect(above.closest(".foss-earth-about__row")?.textContent).toBe("@felipegalind0/gamepad-tools0.1.0same copy as above");
    const full = about.element.querySelectorAll<HTMLDetailsElement>("details")[1];
    expect(full.open).toBe(false);
    above.click();
    expect(full.open).toBe(true);
    expect(document.activeElement).toBe(full.querySelector("summary"));
  });

  it("says when a dev server served the page, and that its list is declared", () => {
    const about = createAboutPanel({ builtFrom: { ...FLIGHT, built: "", dev: true }, identity: { ...IDENTITY, bundle: "dev" } });
    expect(lines(about.element)[0]).toBe("Served by a development server, started 2026-10-07 18:20 UTC: not a build.");
    expect(about.element.querySelector(".foss-earth-about__note")?.textContent).toContain("a development server has no bundle to list");
  });

  it("names the commits from the app's config where the page does not describe its build", () => {
    const about = createAboutPanel({ builtFrom: null, identity: IDENTITY });
    expect(lines(about.element)).toEqual([
      "Built 2026-10-07 18:20 UTC.",
      "Source: 7e80fdc8a1b2",
      "FOSS Earth: e88e7ea93f53",
      "Bundle: index-AbCd1234.js",
    ]);
    expect(about.element.querySelector(".foss-earth-about__tree")).toBeNull();
  });

  it("follows whether the page is the published version", () => {
    let state: PublishedVersion = { kind: "not-asked", build: IDENTITY.build };
    const listeners = new Set<() => void>();
    const about = createAboutPanel({
      builtFrom: FLIGHT,
      identity: IDENTITY,
      publishedVersion: { state: () => state, now: () => 0, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
    });
    const status = about.element.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("has not been asked yet");
    state = { kind: "published", build: IDENTITY.build, at: 0 };
    for (const listener of listeners) listener();
    expect(status.textContent).toContain("This page is the published version");
    about.dispose();
    expect(listeners.size).toBe(0);
  });

  it("asks GitHub for the site's latest deploy once About is shown", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ object: { sha: "8b0ab4ed380c4c57f87a1f0da8830e19e305df70" } })));
    const about = createAboutPanel({ builtFrom: FLIGHT, identity: IDENTITY, site: "0SFS/0SFS.github.io", fetch: fetcher as unknown as typeof fetch });
    // jsdom cannot tell when an element is on screen, so it is asked at once.
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/0SFS/0SFS.github.io/git/ref/heads/gh-pages", { cache: "no-store" });
    await vi.waitFor(() => expect(lines(about.element)).toContain("Site's latest deploy: 8b0ab4ed380c"));
  });

  it("reads the page's own description when given none", () => {
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = BUILT_FROM_ID;
    script.textContent = JSON.stringify(FLIGHT);
    document.head.append(script);
    try {
      const about = createAboutPanel({ identity: IDENTITY });
      expect(about.element.querySelector(".foss-earth-about__name")?.textContent).toBe("osfs");
    } finally {
      script.remove();
    }
  });
});
