/**
 * The globe app's one mounted scene: loading from a URL or a registered
 * example, replacing it, and entering an orb by clicking or tapping it. A
 * press that moves past the drag threshold, a second finger or a cancelled
 * pointer never activates. A mouse or pen over an orb shows a pointer and
 * grows the orb if its style asks. Shareable ids resolve through the
 * registered examples only, never as arbitrary URLs from the address bar.
 */
import { DEFAULT_INPUT_RATES } from "../input/inputRates";
import type { SettingsRegistry } from "../settings/registry";
import type { SceneDiagnostic } from "./format";
import { loadScene, type LoadSceneOptions, type SceneFailure, type SceneHandle, type SceneProgress, type SceneRuntime, type SceneStatus } from "./loadScene";

export interface SceneExample {
  /** Stable and shareable: `?scene=<id>`. */
  id: string;
  title: string;
  description: string;
  /** Relative to the app's base URL, or absolute. */
  url: string;
}

export interface SceneControllerState {
  loading: string | null;
  errors: readonly SceneDiagnostic[];
  status: SceneStatus | null;
}

export interface SceneController {
  readonly examples: readonly SceneExample[];
  state(): SceneControllerState;
  handle(): SceneHandle | null;
  /** Loads a manifest URL or a registered example id; replaces the current scene only once the new one validates. */
  load(input: string, options?: { exampleId?: boolean }): Promise<boolean>;
  unload(): void;
  subscribe(listener: (state: SceneControllerState) => void): () => void;
  /** Each failure as it happens, the scene file's included, for the host's log. */
  onFailure(listener: (failure: SceneFailure) => void): () => void;
  /** Manifest and image bytes as they arrive; completed downloads stop updating. */
  onProgress(listener: (progress: SceneProgress) => void): () => void;
  destroy(): void;
}

export interface SceneControllerOptions {
  runtime: SceneRuntime;
  settings: SettingsRegistry;
  canvas: HTMLElement;
  examples: readonly SceneExample[];
  /** What example URLs resolve against: the app's base URL. */
  baseUrl: string;
  loadOptions?: Omit<LoadSceneOptions, "settings" | "baseUrl">;
}

export function createSceneController(options: SceneControllerOptions): SceneController {
  const { runtime, settings, canvas } = options;
  let current: SceneHandle | null = null;
  let offStatus: (() => void) | null = null;
  let state: SceneControllerState = { loading: null, errors: [], status: null };
  const listeners = new Set<(state: SceneControllerState) => void>();
  const failureListeners = new Set<(failure: SceneFailure) => void>();
  const progressListeners = new Set<(progress: SceneProgress) => void>();
  let progressOwner: object | null = null;
  let pendingLoad: AbortController | null = null;
  let loadCounter = 0;
  const set = (next: Partial<SceneControllerState>): void => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state);
  };
  const fail = (failure: SceneFailure): void => {
    options.loadOptions?.onFailure?.(failure);
    for (const listener of [...failureListeners]) listener(failure);
  };
  const progress = (next: SceneProgress, owner: object): void => {
    // A superseded fetch may still finish; its bytes do not belong to the
    // newly requested scene. A handle keeps its owner across replacements.
    if (owner !== progressOwner || (next.kind === "manifest" && next.id !== state.loading)) return;
    options.loadOptions?.onProgress?.(next);
    for (const listener of [...progressListeners]) listener(next);
  };
  /** The first problem, and how many more the Scenes tab lists. */
  const failScene = (url: string, errors: readonly SceneDiagnostic[]): void => {
    if (errors.length === 0) return;
    const [first] = errors;
    const cause = first.path === "$" ? first.message : `${first.path}: ${first.message}`;
    const more = errors.length > 1 ? ` Scenes → Content lists ${errors.length - 1} more.` : "";
    // A fetch's cause names the URL already.
    const scene = cause.includes(url) ? "The scene" : `The scene ${url}`;
    fail({ kind: "scene", panorama: null, cause, message: `${scene} could not be loaded: ${/[.!?]$/.test(cause) ? cause : `${cause}.`}${more}` });
  };

  const resolveUrl = (input: string, exampleId: boolean): string | null => {
    if (!exampleId) return new URL(input, options.baseUrl).href;
    const example = options.examples.find(entry => entry.id === input);
    return example ? new URL(example.url, options.baseUrl).href : null;
  };

  async function load(input: string, loadOptions: { exampleId?: boolean } = {}): Promise<boolean> {
    const url = resolveUrl(input.trim(), loadOptions.exampleId === true);
    if (!url) {
      const errors = [{ path: "$", message: `There is no example scene "${input}".` }];
      set({ errors });
      failScene(input, errors);
      return false;
    }
    const token = ++loadCounter;
    pendingLoad?.abort();
    const request = new AbortController();
    pendingLoad = request;
    const signal = options.loadOptions?.signal ? AbortSignal.any([request.signal, options.loadOptions.signal]) : request.signal;
    set({ loading: url, errors: [] });
    try {
      if (current) {
        const replaced = await current.replace(url, { signal });
        if (token !== loadCounter) return false;
        set({ loading: null, errors: replaced.ok ? [] : replaced.errors });
        if (!replaced.ok) failScene(url, replaced.errors);
        return replaced.ok;
      }
      const owner = {};
      progressOwner = owner;
      const result = await loadScene(runtime, url, { settings, ...options.loadOptions, signal, onFailure: fail, onProgress: next => progress(next, owner) });
      if (token !== loadCounter) {
        if (result.ok) result.handle.dispose();
        return false;
      }
      if (!result.ok) {
        set({ loading: null, errors: result.errors });
        failScene(url, result.errors);
        return false;
      }
      current = result.handle;
      offStatus = current.subscribe(status => set({ status }));
      set({ loading: null, errors: [] });
      return true;
    } finally {
      if (pendingLoad === request) pendingLoad = null;
    }
  }

  function unload(): void {
    loadCounter += 1;
    progressOwner = null;
    pendingLoad?.abort();
    pendingLoad = null;
    offStatus?.();
    offStatus = null;
    current?.dispose();
    current = null;
    set({ loading: null, errors: [], status: null });
  }

  // Click or tap an orb to enter it.
  const presses = new Map<number, { x: number; y: number; moved: boolean }>();
  let multiTouch = false;
  const threshold = (): number => {
    const value = settings.get("input.mouse.dragThreshold");
    return typeof value === "number" ? value : DEFAULT_INPUT_RATES.mouseDragThresholdPx;
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A press during an entry or exit cuts it short, and is not also a click.
    if (current && current.status.phase !== "overview") return;
    presses.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false });
    if (presses.size > 1) multiTouch = true;
  };
  // Babylon sets the canvas cursor back on every move before this runs, so it is set on every move.
  let pointerCursor = false;
  const setHover = (hit: string | null): void => {
    current?.hover(hit);
    if (hit || pointerCursor) canvas.style.cursor = hit ? "pointer" : "";
    pointerCursor = hit !== null;
  };
  const onPointerMove = (event: PointerEvent): void => {
    const press = presses.get(event.pointerId);
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= threshold()) press.moved = true;
    if (event.pointerType !== "touch" && event.buttons === 0) setHover(current?.pick(event.clientX, event.clientY)[0] ?? null);
  };
  const onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") setHover(null);
  };
  const onPointerUp = (event: PointerEvent): void => {
    const press = presses.get(event.pointerId);
    presses.delete(event.pointerId);
    const wasMulti = multiTouch;
    if (presses.size === 0) multiTouch = false;
    if (!press || press.moved || wasMulti || !current) return;
    const status = current.status;
    if (status.phase !== "overview") return;
    const [hit] = current.pick(event.clientX, event.clientY);
    if (hit) void current.enter(hit);
  };
  const onPointerCancel = (event: PointerEvent): void => {
    presses.delete(event.pointerId);
    multiTouch = presses.size > 0 && multiTouch;
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return {
    examples: options.examples,
    state: () => state,
    handle: () => current,
    load,
    unload,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
    onFailure(listener) {
      failureListeners.add(listener);
      return () => { failureListeners.delete(listener); };
    },
    onProgress(listener) {
      progressListeners.add(listener);
      return () => { progressListeners.delete(listener); };
    },
    destroy() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      if (pointerCursor) canvas.style.cursor = "";
      unload();
      listeners.clear();
      failureListeners.clear();
      progressListeners.clear();
    },
  };
}
