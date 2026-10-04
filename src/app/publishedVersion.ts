/**
 * Notices when the page a browser shows is an older version of the app than
 * the one its site publishes (docs/app-files.md).
 *
 * A browser asks the network for a page it opens, but one that restores a
 * tab, as a phone does, may show its own copy from days before, and with it
 * the app of that day. So the app asks the site for its own page, as
 * Settings → App files → Ask which version is published says, and compares
 * the build stamp in the answer (buildStamp.ts) with the one in the page it
 * was started from. A page that is older reloads itself while nobody has
 * touched it, once for each published version; after that, and where
 * Reload an older page by itself is off, the log says so with a button.
 */
import type { GameLog, GameLogEntry, GameLogLine } from "../log/createGameLog";
import type { SettingsRegistry } from "../settings/registry";
import { buildMinute } from "./appIdentity";
import { BUILD_STAMP_META, buildStampOf, compareBuildStamps } from "./buildStamp";

export const CHECK_PUBLISHED = "app.checkPublished";
export const CHECK_PUBLISHED_EVERY = "app.checkPublishedEvery";
export const RELOAD_OLDER_PAGE = "app.reloadOlderPage";
/** The default of app.checkPublishedEvery, in minutes. */
export const CHECK_PUBLISHED_EVERY_DEFAULT = 10;
/** Where a tab keeps what it was reloaded for, across the reload: this, then the page's path. */
export const RELOADED_FOR_KEY = "foss-earth.reloaded-for";
/** How long the site may take to answer with the page before the question is given up until the next time. */
const ANSWER_WAIT_MS = 20_000;

/** What is known of this page and the one the site publishes. `build` is this page's stamp, `at` when the site was last asked. */
export type PublishedVersion =
  /** The page carries no stamp: there is nothing to compare. */
  | { kind: "unstamped" }
  | { kind: "off"; build: string }
  | { kind: "not-asked"; build: string }
  | { kind: "unanswered"; build: string; why: string; at: number }
  /** This page is the published one. */
  | { kind: "published"; build: string; at: number }
  /** This page is older than the published one, built `published`. */
  | { kind: "older"; build: string; published: string; at: number }
  /** The site answered with an older page than this one, as a host may for a while after a release. */
  | { kind: "ahead"; build: string; published: string; at: number };

/** What a tab was reloaded for, and whether the reload gave that version: the page that came has then said so. */
interface ReloadRecord { from: string; to: string; byItself: boolean; arrived: boolean }

/** The browser as the check uses it, so tests can stand in for it. */
export interface PublishedVersionEnvironment {
  /** The stamp of the page this app was started from, or null when it carries none. */
  build: string | null;
  /** The page's path: two apps of one site each remember their own reload. */
  path: string;
  /** A reload showed this page, the page's own or a person's. */
  reloaded: boolean;
  /** Asks the network for this page as the site publishes it now; resolves with its HTML. */
  readPage(signal: AbortSignal): Promise<string>;
  reload(): void;
  /** Kept for this tab across a reload, or null where the browser gives none. */
  tab: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now(): number;
  shown(): boolean;
  /** Calls `listener` when the page is shown again, or the network is back; returns a stop. */
  onReturn(listener: () => void): () => void;
  /** Calls `listener` the first time the person touches the page; returns a stop. */
  onTouched(listener: () => void): () => void;
  setTimer(work: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface PublishedVersionWatch {
  state(): PublishedVersion;
  subscribe(listener: (state: PublishedVersion) => void): () => void;
  /** Asks the site now, whenever it was last asked. */
  ask(): Promise<PublishedVersion>;
  /** Reloads the page, to use the published version. */
  reload(): void;
  now(): number;
  dispose(): void;
}

export interface PublishedVersionOptions {
  settings: SettingsRegistry;
  /** Where the page says that it is an older version, and that it was reloaded. */
  log: Pick<GameLog, "print">;
  environment?: PublishedVersionEnvironment;
}

/** The stamp of the page this document was loaded from, or null. */
export function documentBuildStamp(): string | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(`meta[name="${BUILD_STAMP_META}"]`)?.getAttribute("content")?.trim() || null;
}

/** Asks the network for the page at `address` as it is published now. */
export async function readPublishedPage(address: string, signal: AbortSignal): Promise<string> {
  // "no-cache": the browser asks the site whether its copy is still the page, and takes the new one when it is not, so the copy it restores a tab from is the published page from then on.
  const response = await fetch(address, { cache: "no-cache", credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`the site answered ${response.status}`);
  return response.text();
}

function tabStorage(): PublishedVersionEnvironment["tab"] {
  try {
    const storage = window.sessionStorage;
    const probe = `${RELOADED_FOR_KEY} probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function browserPublishedVersionEnvironment(): PublishedVersionEnvironment {
  // The page's own address with its query, which is what a browser keeps its copy under.
  const address = window.location.href.split("#")[0];
  return {
    build: documentBuildStamp(),
    path: window.location.pathname,
    reloaded: (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload",
    readPage: signal => readPublishedPage(address, signal),
    reload: () => window.location.reload(),
    tab: tabStorage(),
    now: () => Date.now(),
    shown: () => !document.hidden,
    onReturn(listener) {
      const onVisibility = (): void => { if (!document.hidden) listener(); };
      // A page kept whole by the browser and shown again, as after Back, runs on from where it was.
      const onPageShow = (event: Event): void => { if ((event as PageTransitionEvent).persisted) listener(); };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pageshow", onPageShow);
      window.addEventListener("online", listener);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pageshow", onPageShow);
        window.removeEventListener("online", listener);
      };
    },
    onTouched(listener) {
      const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
      const stop = (): void => { for (const type of events) window.removeEventListener(type, heard, true); };
      const heard = (event: Event): void => {
        // What a script does to the page is not the person's.
        if (!event.isTrusted) return;
        stop();
        listener();
      };
      for (const type of events) window.addEventListener(type, heard, { capture: true, passive: true });
      return stop;
    },
    setTimer: (work, ms) => window.setTimeout(work, ms),
    clearTimer: timer => window.clearTimeout(timer as number),
  };
}

/** "just now", "40 s ago", "12 min ago", "3 h ago". */
function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 90) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** What Settings → App files and the diagnostics report say of `state`. */
export function describePublishedVersion(state: PublishedVersion, now: number): string {
  switch (state.kind) {
    case "unstamped": return "This page does not say which build it is, so the app cannot tell whether it is the published one: a development build, or an app that does not use FOSS Earth's appFiles plugin.";
    case "off": return `This page was built ${state.build}. The site is not asked which version is published: that is turned off.`;
    case "not-asked": return `This page was built ${state.build}. The site has not been asked yet which version is published.`;
    case "unanswered": return `This page was built ${state.build}. The site could not be asked which version is published, ${ago(now - state.at)}: ${state.why}.`;
    case "published": return `This page is the published version of the app, built ${state.build}; the site was asked ${ago(now - state.at)}.`;
    case "older": return `This page is an older version of the app, built ${state.build}: the published one was built ${state.published}; the site was asked ${ago(now - state.at)}.`;
    case "ahead": return `This page was built ${state.build}, after the page the site answered with ${ago(now - state.at)}, built ${state.published}: a host can take a while to publish a release everywhere.`;
  }
}

/** Two builds as a log line names them: to the minute, as the app names itself as it opens, or in full where that is the same minute. */
function named(one: string, other: string): [string, string] {
  const minutes: [string, string] = [buildMinute(one), buildMinute(other)];
  return minutes[0] === minutes[1] ? [one, other] : minutes;
}

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[.\s]+$/, "") || "the request failed";
}

/** Asks the site once which version it publishes, and says how this page compares. Nothing is done about the answer. */
export async function askPublishedVersion(environment: Pick<PublishedVersionEnvironment, "build" | "readPage" | "now" | "setTimer" | "clearTimer">): Promise<PublishedVersion> {
  const { build } = environment;
  if (!build) return { kind: "unstamped" };
  const abort = new AbortController();
  const wait = environment.setTimer(() => abort.abort(), ANSWER_WAIT_MS);
  try {
    const published = buildStampOf(await environment.readPage(abort.signal));
    const at = environment.now();
    if (!published) return { kind: "unanswered", build, why: "the page it answered with does not say which build it is", at };
    const order = compareBuildStamps(build, published);
    return order === "same" ? { kind: "published", build, at } : order === "newer" ? { kind: "older", build, published, at } : { kind: "ahead", build, published, at };
  } catch (error) {
    return { kind: "unanswered", build, why: abort.signal.aborted ? "it did not answer in time" : reasonOf(error), at: environment.now() };
  } finally {
    environment.clearTimer(wait);
  }
}

/** The same question for a page that only reports, as `?report` does: asked once where the setting allows it, and never acted on. */
export function readPublishedVersion(settings: Pick<SettingsRegistry, "get">, environment: PublishedVersionEnvironment = browserPublishedVersionEnvironment()): Promise<PublishedVersion> {
  const { build } = environment;
  if (build && settings.get(CHECK_PUBLISHED) === false) return Promise.resolve({ kind: "off", build });
  return askPublishedVersion(environment);
}

export function watchPublishedVersion(options: PublishedVersionOptions): PublishedVersionWatch {
  const { settings, log } = options;
  const environment = options.environment ?? browserPublishedVersionEnvironment();
  const { build, tab } = environment;
  const recordKey = `${RELOADED_FOR_KEY} ${environment.path}`;
  const enabled = (): boolean => settings.get(CHECK_PUBLISHED) !== false;
  const everyMs = (): number => {
    const minutes = settings.get(CHECK_PUBLISHED_EVERY);
    return (typeof minutes === "number" && minutes > 0 ? minutes : CHECK_PUBLISHED_EVERY_DEFAULT) * 60_000;
  };

  let state: PublishedVersion = !build ? { kind: "unstamped" } : enabled() ? { kind: "not-asked", build } : { kind: "off", build };
  let disposed = false;
  let touched = false;
  let asking: Promise<PublishedVersion> | null = null;
  let askedAt: number | null = null;
  let timer: unknown = null;
  /** The log's line saying this page is older, and the published version it names. */
  let notice: GameLogLine | null = null;
  let noticedFor: string | null = null;
  const listeners = new Set<(state: PublishedVersion) => void>();
  const stops: (() => void)[] = [];

  const set = (next: PublishedVersion): void => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const readRecord = (): ReloadRecord | null => {
    try {
      const parsed: unknown = JSON.parse(tab?.getItem(recordKey) ?? "null");
      if (typeof parsed !== "object" || parsed === null) return null;
      const { from, to, byItself, arrived } = parsed as Record<string, unknown>;
      return typeof from === "string" && typeof to === "string" ? { from, to, byItself: byItself === true, arrived: arrived === true } : null;
    } catch {
      return null;
    }
  };
  /** What this tab was last reloaded for: a page is not reloaded by itself twice for one published version. */
  let reloadedFor = readRecord();
  const remember = (record: ReloadRecord): void => {
    reloadedFor = record;
    try { tab?.setItem(recordKey, JSON.stringify(record)); } catch { /* The next page then knows nothing of this one, and does not reload itself. */ }
  };
  /**
   * Whether this tab can be trusted to remember a reload. A page that a reload showed, in a tab that remembers none, is
   * one whose storage did not outlive the reload, or one a person reloaded: either way it is not reloaded by itself,
   * which could then go on forever.
   */
  const remembers = tab !== null && (!environment.reloaded || reloadedFor !== null);

  const reload = (byItself: boolean): void => {
    if (build && state.kind === "older") {
      remember({ from: build, to: state.published, byItself, arrived: false });
      // The last step of this page's trail: why it went.
      const [mine, published] = named(build, state.published);
      if (byItself) log.print({ text: `This browser opened its own copy of an older page of the app, built ${mine}; the published one was built ${published}. Reloading to use it.`, tone: "info" });
    } else if (reloadedFor && !reloadedFor.arrived) {
      // The button on a page that came from a reload and has not heard from the site yet: this reload is the person's.
      remember({ ...reloadedFor, byItself });
    }
    environment.reload();
  };

  const say = (entry: GameLogEntry): void => {
    if (notice) notice.update(entry);
    else notice = log.print(entry);
  };
  const reloadAction = { label: "Reload", onClick: () => reload(false) };

  /** What an older page does about it: reloads while it may, and says so otherwise. */
  const act = (): void => {
    if (!build || state.kind !== "older") return;
    const { published } = state;
    // Once for a published version, and only where the tab remembers that it did: a browser that answers the reload with its old copy again must not be asked forever.
    if (settings.get(RELOAD_OLDER_PAGE) !== false && !touched && remembers && reloadedFor?.to !== published) {
      reload(true);
      return;
    }
    if (noticedFor === published) return;
    noticedFor = published;
    const [mine, theirs] = named(build, published);
    say({ text: `This page is an older version of the app, built ${mine}: the published one was built ${theirs}. Reload to use it.`, tone: "warning", actions: [reloadAction] });
  };

  const schedule = (): void => {
    if (timer !== null) environment.clearTimer(timer);
    timer = null;
    if (!build || disposed || !enabled()) return;
    timer = environment.setTimer(() => {
      timer = null;
      // A hidden page asks when it is shown again.
      if (environment.shown()) void ask();
    }, everyMs());
  };

  const ask = (): Promise<PublishedVersion> => {
    if (!build || disposed || !enabled()) return Promise.resolve(state);
    asking ??= (async () => {
      askedAt = environment.now();
      const next = await askPublishedVersion(environment);
      asking = null;
      // Turned off, or the app gone, while the site was being asked: the answer is not used.
      if (disposed || !enabled()) return state;
      set(next);
      act();
      schedule();
      return state;
    })();
    return asking;
  };

  if (build) {
    // The page a reload gave: the published one, or the browser's old copy again.
    if (reloadedFor && !reloadedFor.arrived && compareBuildStamps(build, reloadedFor.to) !== "newer") {
      const [before, mine] = named(reloadedFor.from, build);
      log.print({
        text: reloadedFor.byItself
          ? `This browser opened its own copy of an older page of the app, built ${before}. The page reloaded itself, and this is the published version, built ${mine}.`
          : `Reloaded: this is the published version of the app, built ${mine}; the page before was built ${before}.`,
        tone: "info",
      });
      // Kept, as said: the tab has shown that it remembers a reload, and the next page does not say this again.
      remember({ ...reloadedFor, arrived: true });
    } else if (reloadedFor && !reloadedFor.arrived) {
      noticedFor = reloadedFor.to;
      const [mine, published] = named(build, reloadedFor.to);
      say({ text: `This browser still shows its own copy of an older page of the app, built ${mine}, after a reload: the published one was built ${published}. Closing this tab and opening the address again gets it.`, tone: "warning", actions: [reloadAction] });
    }

    stops.push(environment.onTouched(() => { touched = true; }));
    stops.push(environment.onReturn(() => {
      if (!enabled() || !environment.shown()) return;
      // No more often than the setting says, unless the last question got no answer.
      if (askedAt === null || state.kind === "unanswered" || environment.now() - askedAt >= everyMs()) void ask();
    }));
    stops.push(settings.watch(CHECK_PUBLISHED, () => {
      if (enabled()) {
        if (state.kind === "off") set({ kind: "not-asked", build });
        void ask();
      } else {
        set({ kind: "off", build });
        schedule();
      }
    }));
    stops.push(settings.watch(CHECK_PUBLISHED_EVERY, schedule));
    if (enabled()) void ask();
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ask,
    reload: () => reload(false),
    now: () => environment.now(),
    dispose() {
      disposed = true;
      if (timer !== null) environment.clearTimer(timer);
      timer = null;
      for (const stop of stops.splice(0)) stop();
      listeners.clear();
    },
  };
}
