import { describe, expect, it } from "vitest";
import { createSessionTrail, describePreviousVisit, tidyStep, TRAIL_KEY_PREFIX, type TrailRecord } from "./sessionTrail";
import { fakeBrowser } from "./testEnvironment";

const options = (environment: ReturnType<ReturnType<typeof fakeBrowser>["page"]>, overrides: { kept?: () => boolean; limit?: () => number } = {}) => ({
  app: () => "Build b, bundle app-1a2b3c4d.js, renderer webgpu.",
  kept: overrides.kept ?? (() => true),
  limit: overrides.limit ?? (() => 5),
  environment,
});
const recordOf = (browser: ReturnType<typeof fakeBrowser>, id: string): TrailRecord => JSON.parse(browser.items.get(`${TRAIL_KEY_PREFIX}${id}`)!) as TrailRecord;

describe("a visit's trail", () => {
  it("writes each step to the device as it happens, several in one task as one write", () => {
    const browser = fakeBrowser();
    const page = browser.page("a");
    const trail = createSessionTrail(options(page));
    page.elapsedMs = 1200;
    trail.step("Renderer webgpu");
    trail.step("Scene tour, revision 1");
    expect(browser.items.size).toBe(0);
    page.flush();
    expect(recordOf(browser, "a")).toEqual({
      version: 1, id: "a", startedAt: 1_000_000, app: "Build b, bundle app-1a2b3c4d.js, renderer webgpu.", state: "", closed: false, hidden: false,
      steps: [{ ms: 1200, text: "Renderer webgpu" }, { ms: 1200, text: "Scene tour, revision 1" }],
    });
  });

  it("holds the latest steps up to the limit, and counts the same step again instead of adding it", () => {
    const browser = fakeBrowser();
    const page = browser.page("a");
    let limit = 3;
    const trail = createSessionTrail(options(page, { limit: () => limit }));
    for (const text of ["one", "two", "two", "two", "three", "four"]) trail.step(text);
    expect(trail.steps()).toEqual([{ ms: 0, text: "two", count: 3 }, { ms: 0, text: "three" }, { ms: 0, text: "four" }]);
    limit = 2;
    trail.step("five");
    expect(trail.steps().map(step => step.text)).toEqual(["four", "five"]);
  });

  it("counts each kind of trouble as one step, whatever address or number it names and whatever comes between, so a visit of them pushes nothing out", () => {
    const browser = fakeBrowser();
    const page = browser.page("a");
    const trail = createSessionTrail(options(page, { limit: () => 4 }));
    trail.step("Renderer webgpu");
    for (let tile = 0; tile < 50; tile++) {
      page.elapsedMs = 1000 + tile * 100;
      trail.trouble(`! Some tiles failed to load: Failed to fetch (https://tiles.test/9/178/${tile})`);
      trail.trouble(`! Some tiles failed to load: Failed to fetch (terrain:9/178/${tile})`);
      if (tile === 10) trail.step("Inside the 360 image northrop-mall");
    }
    expect(trail.steps()).toEqual([
      { ms: 0, text: "Renderer webgpu" },
      { ms: 1000, text: "! Some tiles failed to load: Failed to fetch (https://tiles.test/9/178/49)", count: 50, lastMs: 5900 },
      { ms: 1000, text: "! Some tiles failed to load: Failed to fetch (terrain:9/178/49)", count: 50, lastMs: 5900 },
      { ms: 2000, text: "Inside the 360 image northrop-mall" },
    ]);
    // What the visit did is in its order: the same step later is another step.
    trail.step("Back on the map");
    trail.step("Inside the 360 image northrop-mall");
    expect(trail.steps().map(step => step.text).slice(-3)).toEqual(["Inside the 360 image northrop-mall", "Back on the map", "Inside the 360 image northrop-mall"]);
  });

  it("keeps where the visit is beside its steps", () => {
    const browser = fakeBrowser();
    const page = browser.page("a");
    const trail = createSessionTrail(options(page, { limit: () => 1 }));
    trail.setState("scene tour, revision r1, inside the 360 image northrop-mall");
    trail.step("one");
    trail.step("another");
    page.flush();
    expect(recordOf(browser, "a")).toMatchObject({ state: "scene tour, revision r1, inside the 360 image northrop-mall", steps: [{ text: "another" }] });
  });

  it("makes a step one line without a key from an address", () => {
    expect(tidyStep("Google 3D tiles\n could not be loaded: https://tile.googleapis.com/v1/root.json?key=AIzaSecret&session=1 ")).toBe("Google 3D tiles could not be loaded: https://tile.googleapis.com/v1/root.json?key=…&session=1");
    expect(tidyStep("x".repeat(400))).toHaveLength(300);
  });

  it("says a visit that left a trail neither closed nor hidden stopped without being closed, and reads it once", async () => {
    const browser = fakeBrowser();
    const first = browser.page("a");
    const crashed = createSessionTrail(options(first));
    first.elapsedMs = 42_000;
    crashed.step("Inside the 360 image northrop-mall");
    crashed.setState("scene tour, revision r1, inside the 360 image northrop-mall");
    first.flush();
    first.close();

    const second = browser.page("b");
    const next = createSessionTrail(options(second));
    const asked = next.previous();
    await browser.settle();
    const previous = await asked;
    expect(previous).toMatchObject({ ended: "unexpected", record: { id: "a", steps: [{ ms: 42_000, text: "Inside the 360 image northrop-mall" }] } });
    expect(describePreviousVisit(previous!)).toBe("The last visit stopped without being closed, 42 s after it opened or later; it was at: scene tour, revision r1, inside the 360 image northrop-mall; its last step: Inside the 360 image northrop-mall");
    // It is over and read: the visit after this one is not told of it again.
    expect(browser.items.has(`${TRAIL_KEY_PREFIX}a`)).toBe(false);
    expect(await next.previous()).toBe(previous);
  });

  it("only reads when asked to: it leaves no record and the visit before can be read again", async () => {
    const browser = fakeBrowser();
    const first = browser.page("a");
    const crashed = createSessionTrail(options(first));
    crashed.step("Renderer webgpu");
    first.flush();
    first.close();
    for (const name of ["b", "c"]) {
      const page = browser.page(name);
      const reader = createSessionTrail({ ...options(page), readOnly: true });
      reader.step("Opened with ?report");
      page.flush();
      const asked = reader.previous();
      await browser.settle();
      expect((await asked)?.record.id).toBe("a");
      expect([...browser.items.keys()].filter(key => key.startsWith(TRAIL_KEY_PREFIX))).toEqual([`${TRAIL_KEY_PREFIX}a`]);
      page.close();
    }
  });

  it("says a page that left was closed, and one last heard of hidden was let go", async () => {
    for (const [end, ended, sentence] of [
      ["closed", "closed", "The last visit was closed, 3 s after it opened or later; its last step: Back on the map"],
      ["hidden", "hidden", "The last visit was let go by the browser while it was hidden, 3 s after it opened or later; its last step: Back on the map"],
    ] as const) {
      const browser = fakeBrowser();
      const first = browser.page("a");
      const trail = createSessionTrail(options(first));
      first.elapsedMs = 3000;
      trail.step("Back on the map");
      if (end === "closed") trail.setClosed(true);
      else trail.setHidden(true);
      first.close();
      const next = createSessionTrail(options(browser.page("b")));
      const asked = next.previous();
      await browser.settle();
      const previous = await asked;
      expect(previous?.ended).toBe(ended);
      expect(describePreviousVisit(previous!)).toBe(sentence);
    }
  });

  it("does not take a page open beside it for one that stopped", async () => {
    const browser = fakeBrowser();
    const beside = browser.page("a");
    const open = createSessionTrail(options(beside));
    open.step("Renderer webgl2");
    beside.flush();
    const next = createSessionTrail(options(browser.page("b")));
    const asked = next.previous();
    await browser.settle();
    expect(await asked).toBeNull();
    // Its record is its own, and still there.
    expect(recordOf(browser, "a").steps).toHaveLength(1);
  });

  it("is open again when the page comes back from the browser's page cache", () => {
    const browser = fakeBrowser();
    const page = browser.page("a");
    const trail = createSessionTrail(options(page));
    trail.setClosed(true);
    expect(recordOf(browser, "a").closed).toBe(true);
    trail.setClosed(false);
    expect(recordOf(browser, "a").closed).toBe(false);
  });

  it("keeps nothing on the device when turned off, and still holds this visit's steps", () => {
    const browser = fakeBrowser();
    const page = browser.page("a");
    let kept = true;
    const trail = createSessionTrail(options(page, { kept: () => kept }));
    trail.step("one");
    page.flush();
    expect(browser.items.size).toBe(1);
    kept = false;
    trail.refresh();
    expect(browser.items.size).toBe(0);
    trail.step("two");
    page.flush();
    expect(browser.items.size).toBe(0);
    expect(trail.steps().map(step => step.text)).toEqual(["one", "two"]);
  });

  it("goes on in memory where the device refuses to store it", async () => {
    const browser = fakeBrowser();
    const page = browser.page("a");
    if (!page.storage) throw new Error("Expected the fake page's storage");
    page.storage.setItem = () => { throw new Error("QuotaExceededError"); };
    const trail = createSessionTrail(options(page));
    trail.step("one");
    page.flush();
    expect(trail.steps()).toHaveLength(1);
    const none = createSessionTrail({ ...options(page), environment: { ...page, storage: null } });
    expect(await none.previous()).toBeNull();
  });
});
