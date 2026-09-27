/**
 * Browser history for scene navigation (§5), cooperating with the host:
 * each entry is merged into `history.state` under `fossEarthScene`, leaving
 * the host's own state and the URL as they are. Only serializable values go
 * in: the scene's identity, the destination and its view. Back and Forward
 * report the entry; the scene handle navigates without pushing again.
 */
import type { LookState } from "./panoramaInput";

export const SCENE_HISTORY_KEY = "fossEarthScene";

export interface SceneHistoryEntry {
  v: 1;
  /** One loaded scene's session, so another page's entries are not followed. */
  session: string;
  sceneId: string;
  revision: string;
  /** The panorama shown, or null for the overview. */
  destination: string | null;
  view: LookState | null;
}

export interface SceneHistoryAdapter {
  record(entry: SceneHistoryEntry, mode: "push" | "replace"): void;
  /** Called on Back and Forward with the entry navigated to, or null when it has none. */
  subscribe(listener: (entry: SceneHistoryEntry | null) => void): () => void;
}

function isEntry(value: unknown): value is SceneHistoryEntry {
  const entry = value as Partial<SceneHistoryEntry> | null;
  return Boolean(entry && entry.v === 1 && typeof entry.session === "string" && typeof entry.sceneId === "string");
}

export function createBrowserSceneHistory(target: Window = window): SceneHistoryAdapter {
  return {
    record(entry, mode) {
      const current = target.history.state;
      const state = { ...(current && typeof current === "object" ? current : {}), [SCENE_HISTORY_KEY]: entry };
      if (mode === "push") target.history.pushState(state, "");
      else target.history.replaceState(state, "");
    },
    subscribe(listener) {
      const onPopState = (event: PopStateEvent): void => {
        const value = (event.state as Record<string, unknown> | null)?.[SCENE_HISTORY_KEY];
        listener(isEntry(value) ? value : null);
      };
      target.addEventListener("popstate", onPopState);
      return () => target.removeEventListener("popstate", onPopState);
    },
  };
}

/** The same stack in memory, for hosts that do not want browser history. */
export function createMemorySceneHistory(): SceneHistoryAdapter & { back(): void; forward(): void; entries(): readonly SceneHistoryEntry[] } {
  const stack: SceneHistoryEntry[] = [];
  let index = -1;
  const listeners = new Set<(entry: SceneHistoryEntry | null) => void>();
  const emit = () => { for (const listener of listeners) listener(stack[index] ?? null); };
  return {
    record(entry, mode) {
      if (mode === "replace" && index >= 0) stack[index] = entry;
      else { stack.splice(index + 1); stack.push(entry); index = stack.length - 1; }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    back() { if (index > 0) { index -= 1; emit(); } },
    forward() { if (index < stack.length - 1) { index += 1; emit(); } },
    entries: () => stack.slice(0, index + 1),
  };
}
