/**
 * The globe app's one mounted scene: loading from a URL or a registered
 * example, replacing it, and entering an orb by clicking or tapping it. A
 * press that moves past the drag threshold, a second finger or a cancelled
 * pointer never activates. Shareable ids resolve through the registered
 * examples only, never as arbitrary URLs from the address bar.
 */
import { DEFAULT_INPUT_RATES } from "../input/inputRates";
import type { SettingsRegistry } from "../settings/registry";
import type { SceneDiagnostic } from "./format";
import { loadScene, type LoadSceneOptions, type SceneHandle, type SceneRuntime, type SceneStatus } from "./loadScene";

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
  let loadCounter = 0;
  const set = (next: Partial<SceneControllerState>): void => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state);
  };

  const resolveUrl = (input: string, exampleId: boolean): string | null => {
    if (!exampleId) return new URL(input, options.baseUrl).href;
    const example = options.examples.find(entry => entry.id === input);
    return example ? new URL(example.url, options.baseUrl).href : null;
  };

  async function load(input: string, loadOptions: { exampleId?: boolean } = {}): Promise<boolean> {
    const url = resolveUrl(input.trim(), loadOptions.exampleId === true);
    if (!url) {
      set({ errors: [{ path: "$", message: `There is no example scene "${input}".` }] });
      return false;
    }
    const token = ++loadCounter;
    set({ loading: url, errors: [] });
    if (current) {
      const replaced = await current.replace(url);
      if (token !== loadCounter) return false;
      set({ loading: null, errors: replaced.ok ? [] : replaced.errors });
      return replaced.ok;
    }
    const result = await loadScene(runtime, url, { settings, ...options.loadOptions });
    if (token !== loadCounter) {
      if (result.ok) result.handle.dispose();
      return false;
    }
    if (!result.ok) {
      set({ loading: null, errors: result.errors });
      return false;
    }
    current = result.handle;
    offStatus = current.subscribe(status => set({ status }));
    set({ loading: null, errors: [] });
    return true;
  }

  function unload(): void {
    loadCounter += 1;
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
    presses.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false });
    if (presses.size > 1) multiTouch = true;
  };
  const onPointerMove = (event: PointerEvent): void => {
    const press = presses.get(event.pointerId);
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= threshold()) press.moved = true;
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
    destroy() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      unload();
      listeners.clear();
    },
  };
}
