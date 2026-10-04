import type { TrailEnvironment } from "./sessionTrail";

/** One browser's storage, shared by the pages opened on it, for tests of the trail. */
export interface FakeBrowser {
  items: Map<string, string>;
  /** A page's view of the browser; `elapsedMs` is how long that page has been open. */
  page(name: string): TrailEnvironment & { elapsedMs: number; flush(): void; close(): void };
  /** Lets every page's waits finish, after the other pages' storage events have been heard. */
  settle(): Promise<void>;
  nowMs: number;
}

export function fakeBrowser(): FakeBrowser {
  const items = new Map<string, string>();
  const listeners = new Map<string, Set<(key: string | null) => void>>();
  const waits: (() => void)[] = [];
  const browser: FakeBrowser = {
    items,
    nowMs: 1_000_000,
    page(name) {
      const deferred: (() => void)[] = [];
      const own = new Set<(key: string | null) => void>();
      listeners.set(name, own);
      // A storage event goes to every page but the one that wrote.
      const tell = (key: string): void => {
        for (const [other, set] of listeners) if (other !== name) for (const listener of [...set]) listener(key);
      };
      const page = {
        elapsedMs: 0,
        storage: {
          getItem: (key: string) => items.get(key) ?? null,
          setItem: (key: string, value: string) => { items.set(key, value); tell(key); },
          removeItem: (key: string) => { if (items.delete(key)) tell(key); },
          key: (index: number) => [...items.keys()][index] ?? null,
          get length() { return items.size; },
        },
        onStorage(listener: (key: string | null) => void) { own.add(listener); return () => { own.delete(listener); }; },
        now: () => browser.nowMs,
        elapsed: () => page.elapsedMs,
        newId: () => name,
        defer: (work: () => void) => { deferred.push(work); },
        wait: () => new Promise<void>(resolve => { waits.push(resolve); }),
        flush() { for (const work of deferred.splice(0)) work(); },
        /** The page is gone without a word: it hears nothing more. */
        close() { listeners.delete(name); },
      };
      return page;
    },
    async settle() {
      for (let round = 0; round < 20; round++) {
        await Promise.resolve();
        for (const resolve of waits.splice(0)) resolve();
        await Promise.resolve();
      }
    },
  };
  return browser;
}
