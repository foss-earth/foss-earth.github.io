/**
 * Keeps the app's own files on this device (docs/app-files.md), as Settings
 * → App files → Keep the app's files asks: registers the service worker the
 * build's appFiles plugin (vite/appFiles.ts) wrote, or unregisters it and
 * deletes what it kept.
 */
import type { SettingsRegistry } from "../settings/registry";

/** Set by the appFiles Vite plugin: the worker's file at the build's root, or "" where there is none to keep files. */
declare const __FOSS_EARTH_APP_FILES__: string | undefined;

export const KEEP_APP_FILES = "app.keepFiles";
/** What the page tells the worker: the files it loaded before the worker controlled it, or to stop keeping any. */
const KEEP_MESSAGE = "foss-earth-keep";
const FORGET_MESSAGE = "foss-earth-forget";

export interface AppFilesStatus {
  /** Why nothing can be kept here, or null. */
  unavailable: string | null;
  /** A worker is installed for this page, and controls it now. */
  installed: boolean;
  controlling: boolean;
  /** The files it keeps and their bytes, of every version it has kept. */
  files: number;
  bytes: number;
}

/** The browser as appFiles uses it, so tests can stand in for it. */
export interface AppFilesEnvironment {
  /** The worker's address, or why there is none. */
  worker: { url: string } | { unavailable: string };
  /** What it controls: everything under the app's base, where its files are, so that the workers the app starts from there are answered too. */
  scope: string;
  container: Pick<ServiceWorkerContainer, "register" | "getRegistration" | "ready" | "controller"> | null;
  caches: Pick<CacheStorage, "open" | "has" | "delete"> | null;
  /** Calls `listener` with the app's files the page has loaded, then with each it loads later; returns a stop. */
  observeLoaded(listener: (urls: string[]) => void): () => void;
  /** Calls `listener` when another worker takes control of the page, as a new version does; returns a stop. */
  onControllerChange(listener: () => void): () => void;
  /** Runs `work` once the page has finished loading. */
  afterLoad(work: () => void): void;
}

export interface AppFilesKeeper {
  status(): Promise<AppFilesStatus>;
  /** Settles once the worker is registered, or removed, as the setting last asked. */
  settled(): Promise<void>;
  dispose(): void;
}

const cacheNameOf = (workerUrl: string): string => `foss-earth-app-files ${new URL(workerUrl).pathname}`;

export function browserAppFilesEnvironment(): AppFilesEnvironment {
  const file = typeof __FOSS_EARTH_APP_FILES__ === "string" ? __FOSS_EARTH_APP_FILES__ : "";
  const secure = typeof window !== "undefined" && window.isSecureContext && typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";
  const base = typeof window === "undefined" ? null : new URL(import.meta.env.BASE_URL ?? "/", window.location.href);
  const worker = !file || !base
    ? { unavailable: "This build has no worker to keep its files: a development build, or an app that does not use FOSS Earth's appFiles plugin." }
    : !secure
      ? { unavailable: "This browser cannot keep the app's files for this page: it needs a secure (https) page with service workers, which some private windows turn off." }
      : { url: new URL(file, base).href };
  return {
    worker,
    scope: base?.pathname ?? "/",
    container: secure ? navigator.serviceWorker : null,
    caches: secure ? caches : null,
    observeLoaded(listener) {
      if (typeof PerformanceObserver === "undefined") return () => {};
      // The folder this module was built into holds the app's files; scene images and map tiles are elsewhere.
      const folder = new URL(".", import.meta.url).href;
      const observer = new PerformanceObserver(list => {
        const urls = list.getEntries().map(entry => entry.name).filter(url => url.startsWith(folder));
        if (urls.length) listener(urls);
      });
      // Buffered: what loaded before the worker took over, too.
      observer.observe({ type: "resource", buffered: true });
      return () => observer.disconnect();
    },
    onControllerChange(listener) {
      if (!secure) return () => {};
      navigator.serviceWorker.addEventListener("controllerchange", listener);
      return () => navigator.serviceWorker.removeEventListener("controllerchange", listener);
    },
    afterLoad(work) {
      if (document.readyState === "complete") queueMicrotask(work);
      else window.addEventListener("load", () => work(), { once: true });
    },
  };
}

export function keepAppFiles(settings: SettingsRegistry, environment: AppFilesEnvironment = browserAppFilesEnvironment()): AppFilesKeeper {
  const { container, caches: storage, scope } = environment;
  const workerUrl = "url" in environment.worker ? environment.worker.url : null;
  const unavailable = "unavailable" in environment.worker ? environment.worker.unavailable : null;
  const cacheName = workerUrl ? cacheNameOf(workerUrl) : null;
  let disposed = false;
  let started = false;
  let stopObserving = (): void => {};
  let stopLoaded = (): void => {};
  // One change at a time, in the order the setting asked for them.
  let queue: Promise<void> = Promise.resolve();

  const ours = (registration: ServiceWorkerRegistration | undefined): registration is ServiceWorkerRegistration => {
    const script = registration?.active ?? registration?.waiting ?? registration?.installing;
    return Boolean(registration) && (!script || script.scriptURL === workerUrl);
  };

  async function keep(): Promise<void> {
    await container!.register(workerUrl!, { scope, updateViaCache: "none" });
    const ready = await container!.ready;
    if (disposed || settings.get(KEEP_APP_FILES) !== true) return;
    // What the page loaded before the worker controlled it, or around it, is in the browser's cache: the worker keeps it from there.
    stopObserving();
    const observe = (): void => {
      stopLoaded();
      stopLoaded = environment.observeLoaded(urls => ready.active?.postMessage({ type: KEEP_MESSAGE, urls }));
    };
    observe();
    // After a new version, the page loads the new files while the old worker still controls it, which does not list them; when the new one takes over, they are named again to it.
    const stopChanges = environment.onControllerChange(observe);
    stopObserving = () => {
      stopLoaded();
      stopLoaded = () => {};
      stopChanges();
    };
  }

  async function forget(): Promise<void> {
    stopObserving();
    stopObserving = () => {};
    const registration = await container!.getRegistration(scope);
    if (!ours(registration)) return;
    // It goes when this page closes; until then it still sees the page's requests, and passes them by.
    registration.active?.postMessage({ type: FORGET_MESSAGE });
    await registration.unregister();
    await storage!.delete(cacheName!);
  }

  const apply = (): void => {
    if (!started || disposed || !workerUrl || !container || !storage) return;
    const wanted = settings.get(KEEP_APP_FILES) === true;
    queue = queue.then(() => (wanted ? keep() : forget())).catch(error => {
      console.warn("The app's files could not be kept as Settings → App files asks.", error);
    });
  };

  // After the page has loaded, so installing the worker does not compete with starting the app.
  environment.afterLoad(() => {
    started = true;
    apply();
  });
  const offWatch = settings.watch(KEEP_APP_FILES, apply);

  return {
    async status() {
      if (unavailable || !container || !storage || !cacheName) {
        return { unavailable: unavailable ?? "This browser cannot keep the app's files for this page.", installed: false, controlling: false, files: 0, bytes: 0 };
      }
      const registration = await container.getRegistration(scope);
      let files = 0;
      let bytes = 0;
      if (await storage.has(cacheName)) {
        const cache = await storage.open(cacheName);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          files += 1;
          bytes += response ? (await response.blob()).size : 0;
        }
      }
      return { unavailable: null, installed: ours(registration) && Boolean(registration.active), controlling: container.controller?.scriptURL === workerUrl, files, bytes };
    },
    settled: () => queue,
    dispose() {
      disposed = true;
      offWatch();
      stopObserving();
    },
  };
}
