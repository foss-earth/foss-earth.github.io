import { describe, expect, it } from "vitest";
import type { GameLogEntry } from "../log/createGameLog";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import { BUILD_STAMP_META } from "./buildStamp";
import {
  CHECK_PUBLISHED, CHECK_PUBLISHED_EVERY, describePublishedVersion, readPublishedVersion, RELOAD_OLDER_PAGE, RELOADED_FOR_KEY, watchPublishedVersion,
  type PublishedVersionEnvironment,
} from "./publishedVersion";

/** The tour's app of 2026-10-03, which an iPhone was still running on 2026-10-04, and the one published then. */
const OLD = "2026-10-03T05:33:53.461Z";
const NEW = "2026-10-04T17:33:49.408Z";
const NEWER = "2026-10-05T09:00:00.000Z";
/** As a log line names them, to the minute. */
const OLD_SAID = "2026-10-03 05:33 UTC";
const NEW_SAID = "2026-10-04 17:33 UTC";
const NEWER_SAID = "2026-10-05 09:00 UTC";
const PATH = "/tour/twin-cities/";
const KEY = `${RELOADED_FOR_KEY} ${PATH}`;
const MINUTE = 60_000;

const pageOf = (stamp: string | null): string => `<!doctype html><html><head>${stamp ? `<meta name="${BUILD_STAMP_META}" content="${stamp}">` : ""}</head><body></body></html>`;

/** A tab's storage, which outlives the pages shown in it. */
function tabStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

/** A log that keeps what was printed, each line as it now reads. */
function fakeLog() {
  const lines: GameLogEntry[] = [];
  return {
    lines,
    print(entry: GameLogEntry) {
      const at = lines.push(entry) - 1;
      return { update: (next: GameLogEntry) => { lines[at] = next; }, focusAction: () => {}, remove: () => {} };
    },
  };
}

/** The browser as the check uses it: a page built `build`, a site that publishes `published`, and a clock moved by hand. */
function browser(build: string | null, options: { published?: string | null; tab?: ReturnType<typeof tabStorage> | null; reloaded?: boolean } = {}) {
  const site = { published: options.published === undefined ? build : options.published, fails: null as string | null, hangs: false };
  let now = Date.parse("2026-10-04T18:00:00Z");
  let shown = true;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; work: () => void }>();
  const returns = new Set<() => void>();
  const touches = new Set<() => void>();
  const asked: number[] = [];
  let reloads = 0;
  const environment: PublishedVersionEnvironment = {
    build,
    path: PATH,
    reloaded: options.reloaded ?? false,
    readPage: signal => {
      asked.push(now);
      if (site.hangs) return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted"))); });
      return site.fails ? Promise.reject(new TypeError(site.fails)) : Promise.resolve(pageOf(site.published));
    },
    reload: () => { reloads += 1; },
    tab: options.tab === undefined ? tabStorage() : options.tab,
    now: () => now,
    shown: () => shown,
    onReturn: listener => { returns.add(listener); return () => { returns.delete(listener); }; },
    onTouched: listener => { touches.add(listener); return () => { touches.delete(listener); }; },
    setTimer: (work, ms) => { timers.set(nextTimer, { at: now + ms, work }); return nextTimer++; },
    clearTimer: timer => { timers.delete(timer as number); },
  };
  /** Lets every promise already settled run on. */
  const settle = async (): Promise<void> => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };
  return {
    environment, site, asked, settle,
    reloads: () => reloads,
    listening: () => returns.size + touches.size + timers.size,
    /** Moves the clock, running the timers that come due. */
    async advance(ms: number): Promise<void> {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].work();
        await settle();
      }
      now = until;
    },
    touch(): void { for (const listener of [...touches]) listener(); },
    async show(next: boolean): Promise<void> {
      shown = next;
      if (next) for (const listener of [...returns]) listener();
      await settle();
    },
  };
}

function start(page: ReturnType<typeof browser>, set: Record<string, boolean | number> = {}) {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(FOSS_EARTH_PARAMETERS);
  for (const [id, value] of Object.entries(set)) settings.set(id, value);
  const log = fakeLog();
  const watch = watchPublishedVersion({ settings, log, environment: page.environment });
  return { watch, settings, log };
}

describe("the published version of the app", () => {
  it("asks the site as the app starts, and says nothing of a page that is the published one", async () => {
    const page = browser(NEW);
    const { watch, log } = start(page);
    expect(watch.state()).toEqual({ kind: "not-asked", build: NEW });
    await page.settle();
    expect(page.asked).toHaveLength(1);
    expect(watch.state()).toMatchObject({ kind: "published", build: NEW });
    expect(page.reloads()).toBe(0);
    expect(log.lines).toEqual([]);
    expect(describePublishedVersion(watch.state(), watch.now())).toBe(`This page is the published version of the app, built ${NEW}; the site was asked just now.`);
  });

  it("reloads a page that is older and has not been touched, saying why, and the page that comes says what happened", async () => {
    const tab = tabStorage();
    const old = browser(OLD, { published: NEW, tab });
    const before = start(old);
    await old.settle();
    expect(old.reloads()).toBe(1);
    expect(before.log.lines).toEqual([{ text: `This browser opened its own copy of an older page of the app, built ${OLD_SAID}; the published one was built ${NEW_SAID}. Reloading to use it.`, tone: "info" }]);
    expect(JSON.parse(tab.values.get(KEY)!)).toEqual({ from: OLD, to: NEW, byItself: true, arrived: false });

    // The reload gave the published page.
    const fresh = browser(NEW, { tab, reloaded: true });
    const after = start(fresh);
    expect(after.log.lines).toEqual([{ text: `This browser opened its own copy of an older page of the app, built ${OLD_SAID}. The page reloaded itself, and this is the published version, built ${NEW_SAID}.`, tone: "info" }]);
    await fresh.settle();
    expect(fresh.reloads()).toBe(0);
    expect(after.log.lines).toHaveLength(1);
    expect(JSON.parse(tab.values.get(KEY)!)).toEqual({ from: OLD, to: NEW, byItself: true, arrived: true });

    // Said once: a person's reload of that page says nothing of it.
    const again = browser(NEW, { tab, reloaded: true });
    const later = start(again);
    await again.settle();
    expect(later.log.lines).toEqual([]);

    // The tab has shown that it remembers a reload, so the page it then shows reloads itself for the next release, as a screen left showing the map.
    again.site.published = NEWER;
    await again.advance(10 * MINUTE);
    expect(again.reloads()).toBe(1);
  });

  it("does not reload a page that a reload showed in a tab that remembers none, whose storage did not outlive it: that could go on forever", async () => {
    const page = browser(OLD, { published: NEW, reloaded: true });
    const { log } = start(page);
    await page.settle();
    expect(page.reloads()).toBe(0);
    expect(log.lines).toEqual([expect.objectContaining({ tone: "warning", text: `This page is an older version of the app, built ${OLD_SAID}: the published one was built ${NEW_SAID}. Reload to use it.` })]);
  });

  it("does not reload twice for one published version: a browser that answers with its old copy again is told so, with a button", async () => {
    const tab = tabStorage();
    const first = browser(OLD, { published: NEW, tab });
    start(first);
    await first.settle();
    expect(first.reloads()).toBe(1);

    const again = browser(OLD, { published: NEW, tab, reloaded: true });
    const { log, watch } = start(again);
    await again.settle();
    expect(again.reloads()).toBe(0);
    expect(watch.state()).toMatchObject({ kind: "older", build: OLD, published: NEW });
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({ tone: "warning", text: `This browser still shows its own copy of an older page of the app, built ${OLD_SAID}, after a reload: the published one was built ${NEW_SAID}. Closing this tab and opening the address again gets it.` });
    // The button is the person's own reload, which is always theirs to make.
    log.lines[0].actions![0].onClick();
    expect(again.reloads()).toBe(1);
    expect(JSON.parse(tab.values.get(KEY)!)).toEqual({ from: OLD, to: NEW, byItself: false, arrived: false });

    // A later release is another version: the page may reload itself for that one.
    const later = browser(OLD, { published: NEWER, tab, reloaded: true });
    start(later);
    await later.settle();
    expect(later.reloads()).toBe(1);
  });

  it("takes the button for the person's reload when it is pressed before the site has answered", async () => {
    const tab = tabStorage();
    tab.setItem(KEY, JSON.stringify({ from: OLD, to: NEW, byItself: true, arrived: false }));
    const again = browser(OLD, { published: NEW, tab, reloaded: true });
    again.site.hangs = true;
    const { log } = start(again);
    log.lines[0].actions![0].onClick();
    expect(again.reloads()).toBe(1);
    expect(JSON.parse(tab.values.get(KEY)!)).toEqual({ from: OLD, to: NEW, byItself: false, arrived: false });
    const fresh = browser(NEW, { tab, reloaded: true });
    expect(start(fresh).log.lines[0].text).toBe(`Reloaded: this is the published version of the app, built ${NEW_SAID}; the page before was built ${OLD_SAID}.`);
  });

  it("never reloads a page the person has touched: the log says a newer version is published, once, with a button", async () => {
    const page = browser(NEW);
    const { watch, log } = start(page);
    await page.settle();
    page.touch();
    // A release while the page is open.
    page.site.published = NEWER;
    await page.advance(10 * MINUTE);
    expect(page.asked).toHaveLength(2);
    expect(page.reloads()).toBe(0);
    expect(watch.state()).toMatchObject({ kind: "older", published: NEWER });
    expect(log.lines).toEqual([expect.objectContaining({ tone: "warning", text: `This page is an older version of the app, built ${NEW_SAID}: the published one was built ${NEWER_SAID}. Reload to use it.` })]);
    await page.advance(10 * MINUTE);
    expect(page.asked).toHaveLength(3);
    expect(log.lines).toHaveLength(1);
    log.lines[0].actions![0].onClick();
    expect(page.reloads()).toBe(1);
  });

  it("reloads an untouched page whenever it learns of a newer version, as a screen left showing the map", async () => {
    const page = browser(NEW);
    start(page);
    await page.settle();
    page.site.published = NEWER;
    await page.advance(10 * MINUTE);
    expect(page.reloads()).toBe(1);
  });

  it("names two builds of one minute in full, so the line still tells them apart", async () => {
    const [one, other] = ["2026-10-04T17:33:10.000Z", "2026-10-04T17:33:49.408Z"];
    const page = browser(one, { published: other, tab: null });
    const { log } = start(page);
    await page.settle();
    expect(log.lines[0].text).toBe(`This page is an older version of the app, built ${one}: the published one was built ${other}. Reload to use it.`);
  });

  it("leaves the reload to the button where reloading by itself is off, or the tab cannot remember that it reloaded", async () => {
    for (const [tab, set] of [[tabStorage(), { [RELOAD_OLDER_PAGE]: false }], [null, {}]] as const) {
      const page = browser(OLD, { published: NEW, tab });
      const { log } = start(page, set);
      await page.settle();
      expect(page.reloads()).toBe(0);
      expect(log.lines).toEqual([expect.objectContaining({ tone: "warning", text: expect.stringContaining("Reload to use it.") })]);
      expect(log.lines[0].actions?.map(action => action.label)).toEqual(["Reload"]);
    }
  });

  it("asks again after the time the setting gives while the page is shown, and when it is shown again after that long", async () => {
    const page = browser(NEW);
    const { settings } = start(page, { [CHECK_PUBLISHED_EVERY]: 30 });
    await page.settle();
    await page.advance(29 * MINUTE);
    expect(page.asked).toHaveLength(1);
    await page.advance(MINUTE);
    expect(page.asked).toHaveLength(2);

    // Hidden: the time passes without a question, and being shown again asks at once.
    await page.show(false);
    await page.advance(45 * MINUTE);
    expect(page.asked).toHaveLength(2);
    await page.show(true);
    expect(page.asked).toHaveLength(3);
    // Shown again a moment later: not asked again so soon.
    await page.show(false);
    await page.advance(MINUTE);
    await page.show(true);
    expect(page.asked).toHaveLength(3);

    // A shorter time applies from the change.
    settings.set(CHECK_PUBLISHED_EVERY, 5);
    await page.advance(5 * MINUTE);
    expect(page.asked).toHaveLength(4);
  });

  it("says why the site could not be asked, and asks again when the page returns", async () => {
    const page = browser(NEW);
    page.site.fails = "Failed to fetch";
    const { watch, log } = start(page);
    await page.settle();
    expect(watch.state()).toMatchObject({ kind: "unanswered", why: "Failed to fetch" });
    expect(describePublishedVersion(watch.state(), watch.now())).toBe(`This page was built ${NEW}. The site could not be asked which version is published, just now: Failed to fetch.`);
    expect(log.lines).toEqual([]);
    // The network is back, a moment later.
    page.site.fails = null;
    await page.show(true);
    expect(page.asked).toHaveLength(2);
    expect(watch.state().kind).toBe("published");
  });

  it("gives up a question the site does not answer, until the next time", async () => {
    const page = browser(NEW);
    page.site.hangs = true;
    const { watch } = start(page);
    await page.settle();
    await page.advance(20_000);
    expect(watch.state()).toMatchObject({ kind: "unanswered", why: "it did not answer in time" });
  });

  it("does nothing about a page the site answers with that is older than this one, or that carries no stamp", async () => {
    const lagging = browser(NEW, { published: OLD });
    const a = start(lagging);
    await lagging.settle();
    expect(a.watch.state()).toEqual({ kind: "ahead", build: NEW, published: OLD, at: lagging.environment.now() });
    expect(lagging.reloads()).toBe(0);
    expect(a.log.lines).toEqual([]);

    const other = browser(NEW, { published: null });
    const b = start(other);
    await other.settle();
    expect(b.watch.state()).toMatchObject({ kind: "unanswered", why: "the page it answered with does not say which build it is" });
    expect(other.reloads()).toBe(0);
  });

  it("asks nothing where the setting is off, until it is turned on", async () => {
    const page = browser(OLD, { published: NEW });
    const { watch, settings } = start(page, { [CHECK_PUBLISHED]: false });
    await page.settle();
    await page.advance(60 * MINUTE);
    await page.show(true);
    expect(page.asked).toEqual([]);
    expect(watch.state()).toEqual({ kind: "off", build: OLD });
    expect(await watch.ask()).toEqual({ kind: "off", build: OLD });
    expect(page.asked).toEqual([]);
    page.touch();
    settings.set(CHECK_PUBLISHED, true);
    await page.settle();
    expect(page.asked).toHaveLength(1);
    expect(watch.state().kind).toBe("older");
    settings.set(CHECK_PUBLISHED, false);
    expect(watch.state().kind).toBe("off");
    await page.advance(60 * MINUTE);
    expect(page.asked).toHaveLength(1);
  });

  it("asks nothing of a page with no stamp, as a development build", async () => {
    const page = browser(null, { published: NEW });
    const { watch } = start(page);
    await page.settle();
    await page.advance(60 * MINUTE);
    expect(page.asked).toEqual([]);
    expect(watch.state()).toEqual({ kind: "unstamped" });
    expect(describePublishedVersion(watch.state(), 0)).toMatch(/does not say which build it is/);
    expect(page.listening()).toBe(0);
  });

  it("tells who subscribes of each answer, and stops when disposed", async () => {
    const page = browser(NEW);
    const { watch } = start(page);
    const seen: string[] = [];
    watch.subscribe(state => { seen.push(state.kind); });
    await page.settle();
    expect(seen).toEqual(["published"]);
    watch.dispose();
    expect(page.listening()).toBe(0);
    await page.advance(60 * MINUTE);
    await page.show(true);
    expect(page.asked).toHaveLength(1);
  });

  it("answers a page that only reports with one question, and does nothing about it", async () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    const page = browser(OLD, { published: NEW });
    expect(await readPublishedVersion(settings, page.environment)).toMatchObject({ kind: "older", build: OLD, published: NEW });
    expect(page.reloads()).toBe(0);
    settings.set(CHECK_PUBLISHED, false);
    expect(await readPublishedVersion(settings, page.environment)).toEqual({ kind: "off", build: OLD });
    expect(await readPublishedVersion(settings, browser(null).environment)).toEqual({ kind: "unstamped" });
    expect(page.asked).toHaveLength(1);
  });
});
