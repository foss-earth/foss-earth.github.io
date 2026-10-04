import { describe, expect, it } from "vitest";
import { FOSS_EARTH_PARAMETERS } from "../settings/catalogue";
import { createSettingsRegistry } from "../settings/registry";
import { KEEP_APP_FILES, keepAppFiles, type AppFilesEnvironment } from "./appFiles";

const WORKER = "https://tour.test/foss-earth-sw.js";
const STORE = "foss-earth-app-files /foss-earth-sw.js";
const LOADED = ["https://tour.test/assets/twinCities-SkvAwjjw.js", "https://tour.test/tour/twin-cities/scene.json"];

/** A browser as the page sees it, with service workers and Cache Storage stood in for. */
function browser(worker: AppFilesEnvironment["worker"] = { url: WORKER }) {
  const posted: unknown[] = [];
  const registered: { url: string; options: RegistrationOptions | undefined }[] = [];
  const active = { scriptURL: WORKER, postMessage: (message: unknown) => { posted.push(message); } };
  let registration: { active: typeof active; unregister(): Promise<boolean> } | undefined;
  const stores = new Map<string, Map<string, Blob>>();
  let finishLoading: (() => void) | null = null;
  let observing = 0;
  const container = {
    controller: null,
    async register(url: string, options?: RegistrationOptions) {
      registered.push({ url, options });
      registration = { active, unregister: async () => { registration = undefined; return true; } };
      return registration;
    },
    getRegistration: async () => registration,
    get ready() { return Promise.resolve(registration); },
  };
  const environment: AppFilesEnvironment = {
    worker,
    scope: "/",
    container: container as unknown as AppFilesEnvironment["container"],
    caches: {
      has: async (name: string) => stores.has(name),
      delete: async (name: string) => stores.delete(name),
      open: async (name: string) => {
        const files = stores.get(name) ?? new Map<string, Blob>();
        stores.set(name, files);
        return {
          keys: async () => [...files.keys()].map(url => new Request(url)),
          match: async (request: Request) => new Response(files.get(request.url)),
        } as unknown as Cache;
      },
    },
    observeLoaded: listener => { observing += 1; listener(LOADED); return () => { observing -= 1; }; },
    afterLoad: work => { finishLoading = work; },
  };
  return { environment, posted, registered, stores, registration: () => registration, load: () => finishLoading?.(), observing: () => observing };
}

function registry() {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(FOSS_EARTH_PARAMETERS);
  return settings;
}

describe("keeping the app's files", () => {
  it("registers the worker once the page has loaded, for the app's base, and names what the page loaded", async () => {
    const b = browser();
    const keeper = keepAppFiles(registry(), b.environment);
    await keeper.settled();
    expect(b.registered).toEqual([]);
    b.load();
    await keeper.settled();
    expect(b.registered).toEqual([{ url: WORKER, options: { scope: "/", updateViaCache: "none" } }]);
    expect(b.posted).toEqual([{ type: "foss-earth-keep", urls: LOADED }]);
    expect(b.observing()).toBe(1);
    keeper.dispose();
    expect(b.observing()).toBe(0);
  });

  it("turned off, tells the worker to stop, unregisters it and deletes what it kept; turned on, registers it again", async () => {
    const b = browser();
    const settings = registry();
    const keeper = keepAppFiles(settings, b.environment);
    b.load();
    await keeper.settled();
    b.stores.set(STORE, new Map([["https://tour.test/assets/twinCities-SkvAwjjw.js", new Blob(["0123456789"])]]));
    expect(await keeper.status()).toEqual({ unavailable: null, installed: true, controlling: false, files: 1, bytes: 10 });

    settings.set(KEEP_APP_FILES, false);
    await keeper.settled();
    expect(b.posted.at(-1)).toEqual({ type: "foss-earth-forget" });
    expect(b.observing()).toBe(0);
    expect(b.registration()).toBeUndefined();
    expect(b.stores.has(STORE)).toBe(false);
    expect(await keeper.status()).toMatchObject({ installed: false, files: 0 });

    settings.set(KEEP_APP_FILES, true);
    await keeper.settled();
    expect(b.registered).toHaveLength(2);
    keeper.dispose();
  });

  it("says why nothing is kept where the build has no worker, and asks the browser for nothing", async () => {
    const reason = "This build has no worker to keep its files.";
    const b = browser({ unavailable: reason });
    const keeper = keepAppFiles(registry(), b.environment);
    b.load();
    await keeper.settled();
    expect(b.registered).toEqual([]);
    expect(await keeper.status()).toEqual({ unavailable: reason, installed: false, controlling: false, files: 0, bytes: 0 });
    keeper.dispose();
  });
});
