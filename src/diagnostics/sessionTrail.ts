/**
 * What a visit did, step by step, kept on this device so that the next visit
 * can say how it ended (docs/diagnostics.md). A page that a browser kills, as
 * a phone does to one that takes too much memory, runs no code as it goes:
 * the trail written before then is all that is left of it. Closing or leaving
 * the page marks its trail closed; a trail that is neither closed nor hidden
 * is of a page that stopped while someone was looking at it.
 *
 * Nothing is sent anywhere: the trail is in this browser's localStorage, and
 * the report (report.ts) that shows it is copied by the person.
 */

/** Each visit's record is one item, named by the visit. */
export const TRAIL_KEY_PREFIX = "foss-earth.visit ";
/** A visit that finds another's record asks here whether that visit is still open; its page answers by writing its record again. */
export const TRAIL_PING_KEY = "foss-earth.visit-ping";
/** How long an open page is given to answer. It answers from a storage event, in a few milliseconds; a page the browser has frozen does not, and its record says it was hidden. */
const PING_WAIT_MS = 400;
/** A step's text is one line: a console message can be pages long. */
const STEP_CHARS = 300;
/** `diagnostics.trailSteps` where nothing is set: the catalogue's default, and its reason. */
export const TRAIL_STEPS_DEFAULT = 80;

export interface TrailStep {
  /** Milliseconds since the page opened. */
  ms: number;
  text: string;
  /** How many times, when more than once: in a row, or for a trouble at any time since. */
  count?: number;
  /** When it last happened, where that is later than `ms`. */
  lastMs?: number;
}

export interface TrailRecord {
  version: 1;
  id: string;
  /** When the page opened, ms since the epoch. */
  startedAt: number;
  /** The app that ran: its build, bundle and renderer, as the host names them. */
  app: string;
  /** Where the visit was when last written, as the host words it: its scene and the 360 image it was in. Not a step, so no run of steps pushes it out. */
  state: string;
  /** The latest steps, oldest first. */
  steps: TrailStep[];
  /** The page said it was going: it was closed, reloaded or left. */
  closed: boolean;
  /** The page was hidden when the record was last written: a browser may let a hidden page go. */
  hidden: boolean;
}

/** How the visit before this one ended. "unexpected": it stopped while shown, without saying it was going. */
export interface PreviousVisit {
  record: TrailRecord;
  ended: "closed" | "hidden" | "unexpected";
}

/** The browser as the trail uses it, so tests can stand in for it. */
export interface TrailEnvironment {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null;
  /** Calls `listener` with the key of each item another page of this site writes; returns a stop. */
  onStorage(listener: (key: string | null) => void): () => void;
  /** Milliseconds since the epoch, and since the page opened. */
  now(): number;
  elapsed(): number;
  newId(): string;
  /** Runs `work` once this task's other steps are in: several steps are one write. */
  defer(work: () => void): void;
  wait(ms: number): Promise<void>;
}

export interface SessionTrailOptions {
  /** Names the app that runs, for the record. */
  app: () => string;
  /** `diagnostics.trail`: whether the trail is kept on this device. Off, the steps are still held for this visit's report. */
  kept: () => boolean;
  /** `diagnostics.trailSteps`: how many steps are held. */
  limit: () => number;
  /** Only reads: this page leaves no record of its own and removes none, as the `?report` page, which may be opened again. */
  readOnly?: boolean;
  environment?: TrailEnvironment;
}

export interface SessionTrail {
  /** The latest visit before this one that is over; null when there was none, or its trail was not kept. */
  previous(): Promise<PreviousVisit | null>;
  /** Something the visit did, in the order it did it. */
  step(text: string): void;
  /**
   * Something that went wrong, which may go wrong again: a warning, an error. Each kind is one step, at the place of
   * its first time, with how many times and when last, so that a trouble repeated for a whole visit leaves the rest in view.
   */
  trouble(text: string): void;
  steps(): readonly TrailStep[];
  /** Where the visit is now, kept beside the steps. */
  setState(state: string): void;
  setHidden(hidden: boolean): void;
  /** The page is going, or (false) has come back from the browser's page cache. */
  setClosed(closed: boolean): void;
  /** Applies a change of `kept`: turned off, this visit's record is removed from the device. */
  refresh(): void;
  dispose(): void;
}

/** What a step says apart from which address or number it names: a tile that failed is the same step as the tile before it. */
export const stepKind = (text: string): string => text.replace(/https?:\/\/[^\s)"']+/g, "URL").replace(/\d+(?:\.\d+)?/g, "N");

/** One line, without a secret: a key in a URL's query is left out. */
export function tidyStep(text: string): string {
  const line = text.replace(/\s+/g, " ").trim().replace(/([?&](?:key|token|access_token)=)[^&\s"')]+/gi, "$1…");
  return line.length > STEP_CHARS ? `${line.slice(0, STEP_CHARS - 1)}…` : line;
}

export function browserTrailEnvironment(): TrailEnvironment {
  let storage: TrailEnvironment["storage"] = null;
  // Reading localStorage throws where the browser forbids it, as some private windows do.
  try { storage = typeof localStorage === "undefined" ? null : localStorage; } catch { storage = null; }
  return {
    storage,
    onStorage(listener) {
      if (typeof window === "undefined") return () => {};
      const onEvent = (event: StorageEvent): void => listener(event.key);
      window.addEventListener("storage", onEvent);
      return () => window.removeEventListener("storage", onEvent);
    },
    now: () => Date.now(),
    elapsed: () => (typeof performance === "undefined" ? 0 : performance.now()),
    newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    defer: work => queueMicrotask(work),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

function parseRecord(raw: string | null): TrailRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TrailRecord> | null;
    if (!value || value.version !== 1 || typeof value.id !== "string" || typeof value.startedAt !== "number" || !Array.isArray(value.steps)) return null;
    return {
      version: 1, id: value.id, startedAt: value.startedAt, app: typeof value.app === "string" ? value.app : "", state: typeof value.state === "string" ? value.state : "",
      steps: value.steps.filter((step): step is TrailStep => typeof step?.ms === "number" && typeof step?.text === "string"),
      closed: value.closed === true, hidden: value.hidden === true,
    };
  } catch {
    return null;
  }
}

export function createSessionTrail(options: SessionTrailOptions): SessionTrail {
  const environment = options.environment ?? browserTrailEnvironment();
  const { storage } = environment;
  const id = environment.newId();
  const key = `${TRAIL_KEY_PREFIX}${id}`;
  const record: TrailRecord = { version: 1, id, startedAt: environment.now(), app: "", state: "", steps: [], closed: false, hidden: false };
  let writing = false;
  let broken = false;
  let disposed = false;

  const readOnly = options.readOnly === true;
  const write = (): void => {
    writing = false;
    if (disposed || broken || readOnly || !storage) return;
    try {
      if (!options.kept()) { storage.removeItem(key); return; }
      record.app = options.app();
      storage.setItem(key, JSON.stringify(record));
    } catch {
      // Full, or forbidden: the steps stay in memory for this visit's report.
      broken = true;
    }
  };
  const schedule = (): void => {
    if (writing) return;
    writing = true;
    environment.defer(write);
  };

  // Another page asking whether this visit is still open: writing the record again is the answer it waits for.
  const stopListening = environment.onStorage(changed => {
    if (changed !== TRAIL_PING_KEY || !storage) return;
    let asked: string | null = null;
    try { asked = storage.getItem(TRAIL_PING_KEY); } catch { /* No answer: this page cannot read it. */ }
    if (asked === id) write();
  });

  /** Other visits' records, read once: answering `previous` removes those that are over. */
  let found: Promise<PreviousVisit | null> | null = null;
  async function findPrevious(): Promise<PreviousVisit | null> {
    if (!storage) return null;
    const others: TrailRecord[] = [];
    try {
      // The names first: removing an item moves the ones after it.
      const names: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index);
        if (name?.startsWith(TRAIL_KEY_PREFIX) && name !== key) names.push(name);
      }
      for (const name of names) {
        const other = parseRecord(storage.getItem(name));
        if (other) others.push(other);
        else storage.removeItem(name);
      }
    } catch {
      return null;
    }
    others.sort((a, b) => b.startedAt - a.startedAt);
    // A record neither closed nor hidden is of a page that stopped, or of one open beside this: ask it.
    const open = new Set<string>();
    for (const other of others.filter(each => !each.closed && !each.hidden)) {
      let answered = false;
      const stop = environment.onStorage(changed => { if (changed === `${TRAIL_KEY_PREFIX}${other.id}`) answered = true; });
      try {
        storage.setItem(TRAIL_PING_KEY, other.id);
        await environment.wait(PING_WAIT_MS);
      } catch { /* Unasked: it counts as stopped. */ } finally {
        stop();
      }
      if (answered) open.add(other.id);
    }
    try { storage.removeItem(TRAIL_PING_KEY); } catch { /* It is overwritten by the next question. */ }
    const over = others.filter(other => !open.has(other.id));
    for (const other of readOnly ? [] : over) {
      try { storage.removeItem(`${TRAIL_KEY_PREFIX}${other.id}`); } catch { /* It is read again next time. */ }
    }
    const [latest] = over;
    return latest ? { record: latest, ended: latest.closed ? "closed" : latest.hidden ? "hidden" : "unexpected" } : null;
  }

  /** Counts `text` on `step` when it is the same kind of thing, with its latest wording; written with the next step, not once each. */
  const again = (step: TrailStep | undefined, text: string): boolean => {
    if (disposed || !text) return true;
    if (!step || stepKind(step.text) !== stepKind(text)) return false;
    step.count = (step.count ?? 1) + 1;
    step.text = text;
    const ms = Math.round(environment.elapsed());
    if (ms > step.ms) step.lastMs = ms;
    return true;
  };
  const add = (text: string): void => {
    record.steps.push({ ms: Math.round(environment.elapsed()), text });
    const limit = Math.max(1, Math.round(options.limit()));
    if (record.steps.length > limit) record.steps.splice(0, record.steps.length - limit);
    schedule();
  };

  schedule();
  return {
    previous: () => (found ??= findPrevious()),
    step(text) {
      const tidy = tidyStep(text);
      // The same thing again at once is counted, not added.
      if (!again(record.steps.at(-1), tidy)) add(tidy);
    },
    trouble(text) {
      const tidy = tidyStep(text);
      const kind = stepKind(tidy);
      if (!again(record.steps.findLast(step => stepKind(step.text) === kind), tidy)) add(tidy);
    },
    steps: () => record.steps,
    setState(state) {
      const tidy = tidyStep(state);
      if (record.state === tidy) return;
      record.state = tidy;
      schedule();
    },
    setHidden(hidden) {
      if (record.hidden === hidden) return;
      record.hidden = hidden;
      // At once: a hidden page may be let go before another task runs.
      write();
    },
    setClosed(closed) {
      record.closed = closed;
      write();
    },
    refresh: () => write(),
    dispose() {
      // Not a close: the record stays as it is, for a host that takes the app down without the page going.
      disposed = true;
      stopListening();
    },
  };
}

const seconds = (ms: number): string => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** "The last visit stopped without being closed, 42 s after it opened or later; its last step: …". */
export function describePreviousVisit(previous: PreviousVisit): string {
  const { record } = previous;
  const last = record.steps.at(-1);
  const after = `${last ? `, ${seconds(last.ms)} after it opened or later` : ""}${record.state ? `; it was at: ${record.state}` : ""}${last ? `; its last step: ${last.text}` : ""}`;
  if (previous.ended === "unexpected") return `The last visit stopped without being closed${after}`;
  if (previous.ended === "hidden") return `The last visit was let go by the browser while it was hidden${after}`;
  return `The last visit was closed${after}`;
}
