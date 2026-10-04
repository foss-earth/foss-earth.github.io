import { describe, expect, it, vi } from "vitest";
import { APP_FILES_WORKER, appFiles, appFilesWorker } from "./appFiles";

const ORIGIN = "https://tour.test";
const SCRIPT = "assets/twinCities-SkvAwjjw.js";
const STYLE = "assets/twinCities-_gKKIrgC.css";
const LAZY = "assets/shadowsFragmentFunctions-BOeOG7TJ.js";
const BUNDLE = [SCRIPT, STYLE, LAZY, "tour/twin-cities/index.html", `${SCRIPT}.map`, "assets/logo.svg"];

/** A response as a browser gives a same-origin request: of type "basic". */
function basic(body: string, status = 200): Response {
  const response = new Response(body, { status });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

/** Cache Storage's cache as far as the worker uses it, keyed by URL without its query. */
class MemoryCache {
  readonly entries = new Map<string, Response>();
  private readonly base: string;
  constructor(base: string) { this.base = base; }
  private key(request: string | Request): string {
    const url = new URL(typeof request === "string" ? request : request.url, this.base);
    return `${url.origin}${url.pathname}`;
  }
  async match(request: string | Request): Promise<Response | undefined> { return this.entries.get(this.key(request))?.clone(); }
  async put(request: string | Request, response: Response): Promise<void> { this.entries.set(this.key(request), response); }
  async keys(): Promise<Request[]> { return [...this.entries.keys()].map(url => new Request(url)); }
  async delete(request: string | Request): Promise<boolean> { return this.entries.delete(this.key(request)); }
}

type Listener = (event: Record<string, unknown>) => void;

/** The worker the plugin writes, run against a stand-in for a browser's service worker global. */
function worker(network: (url: string, init?: RequestInit) => Response = url => basic(`body of ${url}`)) {
  const location = new URL(`${ORIGIN}/${APP_FILES_WORKER}`);
  const listeners = new Map<string, Listener[]>();
  const stores = new Map<string, MemoryCache>();
  const fetched: { url: string; init?: RequestInit }[] = [];
  const calls = { skipWaiting: 0, claim: 0, preload: 0 };
  const self = {
    location,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    skipWaiting: async () => { calls.skipWaiting += 1; },
    clients: { claim: async () => { calls.claim += 1; } },
    registration: { navigationPreload: { enable: async () => { calls.preload += 1; } } },
    caches: {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new MemoryCache(location.href));
        return stores.get(name)!;
      },
    },
    fetch: async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href).href;
      fetched.push({ url, ...(init ? { init } : {}) });
      return network(url, init);
    },
  };
  new Function("self", appFilesWorker(BUNDLE).source)(self);

  /** Dispatches one event; resolves with what it answered, null if it let the request by, once every waitUntil settles. */
  async function dispatch(type: string, fields: Record<string, unknown> = {}): Promise<Response | null> {
    const waits: Promise<unknown>[] = [];
    let answered: Promise<Response> | null = null;
    const event = { ...fields, waitUntil: (promise: Promise<unknown>) => { waits.push(promise); }, respondWith: (response: Promise<Response>) => { answered = response; } };
    for (const listener of listeners.get(type) ?? []) listener(event);
    const response = answered ? await answered : null;
    // waitUntil may be called while the answer is being made.
    for (let index = 0; index < waits.length; index++) await waits[index];
    return response;
  }
  const request = (path: string, init: { method?: "GET" | "POST"; mode?: "cors" | "navigate" } = {}) => {
    const value = new Request(new URL(path, location.href), init.method === "POST" ? { method: "POST", body: "x" } : {});
    // A Request made here cannot say "navigate"; the worker reads only these fields.
    return { url: value.url, method: value.method, mode: init.mode ?? "cors" } as Request;
  };
  const store = () => stores.get(`foss-earth-app-files /${APP_FILES_WORKER}`);
  return { dispatch, request, fetched, calls, store };
}

describe("the app files worker", () => {
  it("lists only the build's files whose names carry their content hash", () => {
    const { kept, unhashed, source } = appFilesWorker(BUNDLE);
    expect(kept).toEqual([LAZY, STYLE, SCRIPT].sort());
    expect(unhashed).toEqual(["assets/logo.svg"]);
    expect(source).toContain(`install(self, ${JSON.stringify(kept)});`);
  });

  it("keeps a listed file the first time the app asks for it, and answers it from the device after that", async () => {
    const w = worker();
    await w.dispatch("install");
    await w.dispatch("activate");
    expect(w.calls).toEqual({ skipWaiting: 1, claim: 1, preload: 1 });
    const first = await w.dispatch("fetch", { request: w.request(`/${SCRIPT}`) });
    expect(await first!.text()).toBe(`body of ${ORIGIN}/${SCRIPT}`);
    expect(w.fetched).toHaveLength(1);
    const again = await w.dispatch("fetch", { request: w.request(`/${SCRIPT}?v=2`) });
    expect(await again!.text()).toBe(`body of ${ORIGIN}/${SCRIPT}`);
    expect(w.fetched).toHaveLength(1);
  });

  it("lets by what the build does not list: scene images, other hosts, unhashed files and anything but GET", async () => {
    const w = worker();
    for (const request of [
      w.request("/tour/twin-cities/scene.json"),
      w.request("/tour/twin-cities/media/northrop-mall/eac-tiles/px/0/0/0.jpg"),
      { url: `https://tile.openstreetmap.org/${SCRIPT}`, method: "GET", mode: "cors" } as Request,
      w.request("/assets/logo.svg"),
      w.request(`/${SCRIPT}`, { method: "POST" }),
    ]) expect(await w.dispatch("fetch", { request }), request.url).toBeNull();
    expect(w.fetched).toHaveLength(0);
  });

  it("does not keep a failed answer", async () => {
    let status = 404;
    const w = worker(url => basic(`body of ${url}`, status));
    expect((await w.dispatch("fetch", { request: w.request(`/${STYLE}`) }))!.status).toBe(404);
    status = 200;
    expect((await w.dispatch("fetch", { request: w.request(`/${STYLE}`) }))!.status).toBe(200);
    expect(w.fetched).toHaveLength(2);
    expect(w.store()!.entries.size).toBe(1);
  });

  it("answers the page itself from the network, with the request made while it started", async () => {
    const w = worker();
    const page = await w.dispatch("fetch", { request: w.request("/tour/twin-cities/", { mode: "navigate" }), preloadResponse: Promise.resolve(basic("the page")) });
    expect(await page!.text()).toBe("the page");
    expect(w.fetched).toHaveLength(0);
    // Without navigation preload it asks the network itself, and keeps nothing.
    const fetchedPage = await w.dispatch("fetch", { request: w.request("/tour/twin-cities/", { mode: "navigate" }), preloadResponse: Promise.resolve(undefined) });
    expect(await fetchedPage!.text()).toBe(`body of ${ORIGIN}/tour/twin-cities/`);
    // A browser without it gives no promise at all; a preload that failed is asked again.
    for (const preloadResponse of [undefined, Promise.reject(new TypeError("The service worker navigation preload request failed"))]) {
      const page = await w.dispatch("fetch", { request: w.request("/tour/twin-cities/", { mode: "navigate" }), preloadResponse });
      expect(page!.status).toBe(200);
    }
    expect(w.fetched).toHaveLength(3);
    expect(w.store()?.entries.size ?? 0).toBe(0);
  });

  it("gives up an older version's files when it takes over", async () => {
    const w = worker();
    await w.dispatch("fetch", { request: w.request(`/${SCRIPT}`) });
    await w.store()!.put(`${ORIGIN}/assets/twinCities-OLDHASH0.js`, basic("old"));
    await w.dispatch("activate");
    expect([...w.store()!.entries.keys()]).toEqual([`${ORIGIN}/${SCRIPT}`]);
  });

  it("keeps what the page loaded before it took over, from the browser's cache, and only the build's files", async () => {
    const w = worker();
    await w.dispatch("message", { data: { type: "foss-earth-keep", urls: [`${ORIGIN}/${SCRIPT}`, `${ORIGIN}/${LAZY}`, `${ORIGIN}/tour/twin-cities/scene.json`, `https://elsewhere.test/${STYLE}`, 42, "::"] } });
    expect(w.fetched.map(each => each.url)).toEqual([`${ORIGIN}/${SCRIPT}`, `${ORIGIN}/${LAZY}`]);
    expect(w.fetched.every(each => each.init?.cache === "force-cache")).toBe(true);
    expect(w.store()!.entries.size).toBe(2);
    // Already kept: not asked for again.
    await w.dispatch("message", { data: { type: "foss-earth-keep", urls: [`${ORIGIN}/${SCRIPT}`] } });
    expect(w.fetched).toHaveLength(2);
  });

  it("lets everything by once the page turns keeping off, until it is turned on again", async () => {
    const w = worker();
    await w.dispatch("message", { data: { type: "foss-earth-forget" } });
    expect(await w.dispatch("fetch", { request: w.request(`/${SCRIPT}`) })).toBeNull();
    await w.dispatch("message", { data: { type: "foss-earth-keep", urls: [] } });
    expect(await w.dispatch("fetch", { request: w.request(`/${SCRIPT}`) })).not.toBeNull();
  });
});

describe("the appFiles Vite plugin", () => {
  type ConfigHook = (config: object, env: { command: "build" | "serve"; mode: string }) => { define: Record<string, string> };
  type BundleHook = (this: { warn(message: string): void; emitFile(file: { type: string; fileName: string; source: string }): void }, options: object, bundle: Record<string, unknown>) => void;

  it("tells the app where the worker is in a build, and that there is none while developing", () => {
    const config = appFiles().config as unknown as ConfigHook;
    expect(config({}, { command: "build", mode: "production" }).define.__FOSS_EARTH_APP_FILES__).toBe(JSON.stringify(APP_FILES_WORKER));
    expect(config({}, { command: "serve", mode: "development" }).define.__FOSS_EARTH_APP_FILES__).toBe('""');
  });

  it("writes the worker beside the build's pages, and warns of files it cannot keep", () => {
    const emitted: { type: string; fileName: string; source: string }[] = [];
    const warn = vi.fn();
    (appFiles().generateBundle as unknown as BundleHook).call({ warn, emitFile: file => { emitted.push(file); } }, {}, Object.fromEntries(BUNDLE.map(name => [name, {}])));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "asset", fileName: APP_FILES_WORKER });
    expect(emitted[0].source).toContain(SCRIPT);
    expect(emitted[0].source).not.toContain("index.html");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("assets/logo.svg"));
  });
});
