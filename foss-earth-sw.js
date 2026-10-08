"use strict";
/**
 * The service worker that keeps an app's own files on the visitor's device
 * (docs/app-files.md). The appFiles Vite plugin (appFiles.ts) writes it into
 * a build as `foss-earth-sw.js`, calling `install(self, files)` with the
 * build's file names, relative to the worker.
 *
 * Each of those names carries its file's content hash, so a kept copy is
 * never out of date: it is answered from the device without asking the
 * network, however long ago it was kept. The page itself is never kept: it
 * comes from the network every time, asked for while the worker starts, so
 * a new version shows on the next visit, and its new file names are
 * downloaded once. Every other request passes by: scene images are kept by
 * the scene loader, under their revisions.
 */
function install(worker, files) {
  const paths = new Set(files.map(name => new URL(name, worker.location.href).pathname));
  // One store for the worker's own address: a build's files, whichever of its pages asked for them.
  const cacheName = `foss-earth-app-files ${new URL(worker.location.href).pathname}`;
  const matchOptions = { ignoreVary: true, ignoreSearch: true };
  // Set when the page turns keeping off: until the page closes, this worker still sees its requests, and passes them by.
  let forgotten = false;

  /** A response worth keeping: the file itself, from this site. */
  const keepable = response => Boolean(response) && response.ok && response.status === 200 && response.type === "basic" && !response.redirected;

  /** The path of a URL this build lists, or null. */
  const listed = href => {
    let url;
    try { url = new URL(href, worker.location.href); } catch { return null; }
    return url.origin === worker.location.origin && paths.has(url.pathname) ? url.pathname : null;
  };

  async function answer(event, request, path) {
    const cache = await worker.caches.open(cacheName);
    const kept = await cache.match(path, matchOptions);
    if (kept) return kept;
    const response = await worker.fetch(request);
    if (keepable(response)) event.waitUntil(cache.put(path, response.clone()).catch(() => {}));
    return response;
  }

  worker.addEventListener("install", event => {
    // Nothing is fetched ahead: files are kept as the app asks for them. The new list takes over at once.
    event.waitUntil(worker.skipWaiting());
  });

  worker.addEventListener("activate", event => {
    event.waitUntil((async () => {
      // The page is asked for while the worker starts, not after.
      await worker.registration.navigationPreload?.enable().catch(() => {});
      const cache = await worker.caches.open(cacheName);
      // A file this version does not list belongs to an older one: its name will not be asked for again.
      for (const request of await cache.keys()) {
        if (!paths.has(new URL(request.url).pathname)) await cache.delete(request);
      }
      await worker.clients.claim();
    })());
  });

  worker.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    if (request.mode === "navigate") {
      event.respondWith((async () => {
        // The request made while the worker started, if the browser made one; a failed one is asked again, as a page without this worker would be.
        const preloaded = await Promise.resolve(event.preloadResponse).catch(() => undefined);
        return preloaded || worker.fetch(request);
      })());
      return;
    }
    const path = forgotten ? null : listed(request.url);
    if (path) event.respondWith(answer(event, request, path));
  });

  // The page names what it loaded before this worker controlled it; those files are kept from the browser's cache.
  worker.addEventListener("message", event => {
    const data = event.data;
    if (data?.type === "foss-earth-forget") forgotten = true;
    if (data?.type !== "foss-earth-keep" || !Array.isArray(data.urls)) return;
    forgotten = false;
    event.waitUntil((async () => {
      const cache = await worker.caches.open(cacheName);
      for (const href of data.urls) {
        const path = typeof href === "string" ? listed(href) : null;
        if (!path || await cache.match(path, matchOptions)) continue;
        const response = await worker.fetch(path, { cache: "force-cache" }).catch(() => null);
        if (keepable(response)) await cache.put(path, response).catch(() => {});
      }
    })());
  });
}

install(self, ["assets/egm2008-15-nvvz7MYe.bin","assets/egm2008-30-BpPXoGjA.bin","assets/egm2008-60-bDxgbz8U.bin","assets/imageryDecodeWorker-CNZt1PLg.js","assets/index-D2HJPXrA.css","assets/index-DLV0-69l.js","assets/oitFinalSimpleBlend.fragment-BpPjhBR1.js","assets/oitFinalSimpleBlend.fragment-DUZjvXbI.js","assets/screenSpaceCurvature.fragment-CatjwMVM.js","assets/searchAirports-CbzQ_A73.js","assets/selection.fragment-BPY6pTrc.js","assets/selection.fragment-C0ar99v0.js","assets/selection.vertex-CrZhe3wt.js","assets/selection.vertex-xY0FVpP_.js","assets/selectionOutline.fragment-Btq5T3VB.js","assets/selectionOutline.fragment-DMCJXsNy.js","assets/viewer-BG_kQ39M.js","assets/volumetricLightingBlendVolume.fragment-DygGw-A_.js","assets/volumetricLightingBlendVolume.fragment-Eq7vNEsT.js","assets/volumetricLightingRenderVolume.fragment-CVSGsgGc.js","assets/volumetricLightingRenderVolume.fragment-DXUznkH5.js","assets/volumetricLightingRenderVolume.vertex-Dc7QuFnb.js","assets/volumetricLightingRenderVolume.vertex-DtSKNEtE.js"]);
