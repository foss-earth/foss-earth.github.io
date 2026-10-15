"use strict";
/** Extracted from Earth App/vite/appFilesWorker.js; host policy controls retention.
 * Pages are always network-first; no media cache or app/runtime is constructed. */
function install(worker, manifest) {
  const files = manifest.files.map(file => file.url);
  const paths = new Set(files.map(name => new URL(name, worker.location.href).pathname));
  // One store for the worker's own address: a build's files, whichever of its pages asked for them.
  const cacheName = `${manifest.cacheNamespace} ${new URL(worker.location.href).pathname}`;
  const base = new URL(manifest.base, worker.location.origin);
  const retained = new Set(manifest.retainedFiles.map(file => new URL(file.url, worker.location.href).pathname));
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
      // Older pages may still request their files. Deletion is an explicit host
      // policy; retained legacy resources survive either activation policy.
      if (manifest.retention === "current-only") for (const request of await cache.keys()) {
        if (!paths.has(new URL(request.url).pathname) && !retained.has(new URL(request.url).pathname)) await cache.delete(request);
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
    if (forgotten) return;
    const path = listed(request.url);
    if (path) { event.respondWith(answer(event, request, path)); return; }
    // Existing older files are usable by still-open pages. Do not acquire an
    // unknown file merely because the worker controls the deployment root.
    const url = new URL(request.url);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
    if (retained.has(url.pathname) || manifest.retention === "retain-older") event.respondWith((async () => {
      const cache = await worker.caches.open(cacheName);
      const old = await cache.match(url.pathname, matchOptions);
      if (old) return old;
      if (retained.has(url.pathname)) return answer(event, request, url.pathname);
      return worker.fetch(request);
    })());
  });

  // The page names what it loaded before this worker controlled it; those files are kept from the browser's cache.
  worker.addEventListener("message", event => {
    const data = event.data;
    if (manifest.identity && data?.identity !== manifest.identity) return;
    if (data?.type === "foss-earth-forget") forgotten = true;
    if (data?.type !== "foss-earth-keep" || !Array.isArray(data.urls)) return;
    forgotten = false;
    event.waitUntil((async () => {
      const cache = await worker.caches.open(cacheName);
      for (const href of data.urls) {
        const path = typeof href === "string" ? listed(href) : null;
        if (forgotten || !path || await cache.match(path, matchOptions)) continue;
        const response = await worker.fetch(path, { cache: "force-cache" }).catch(() => null);
        if (keepable(response)) await cache.put(path, response).catch(() => {});
      }
    })());
  });
}

install(self, {"schemaVersion":1,"base":"/app/","scope":"/app/","workerFile":"foss-earth-sw.js","cacheNamespace":"foss-earth-app-files","identity":null,"retention":"current-only","files":[{"url":"/app/assets/abstractAudioBus-IbX4iSMC.js"},{"url":"/app/assets/abstractAudioNode-DW4VTajR.js"},{"url":"/app/assets/abstractEngine.cubeTexture-CVJbpptm.js"},{"url":"/app/assets/abstractSoundInstance-CuuNUr0j.js"},{"url":"/app/assets/abstractSoundSource-DPuUWwWE.js"},{"url":"/app/assets/animation-CISTNmG2.js"},{"url":"/app/assets/animationGroup-C5touQxJ.js"},{"url":"/app/assets/atlasImagery.worker-B8zvlB9O.js"},{"url":"/app/assets/babylon-shaders-glsl-BDB5h_-g.js"},{"url":"/app/assets/babylon-shaders-wgsl-4lt-j9l0.js"},{"url":"/app/assets/baseTexture.polynomial-DLMxw38J.js"},{"url":"/app/assets/bone-BSAHU30F.js"},{"url":"/app/assets/brdfTextureTools-BEJWZ-IT.js"},{"url":"/app/assets/buffer-DlrLa0kT.js"},{"url":"/app/assets/buffer-UQglctLJ.js"},{"url":"/app/assets/cubemapToSphericalPolynomial-C-s5qtXu.js"},{"url":"/app/assets/dataBuffer-C-wqV4qF.js"},{"url":"/app/assets/dds-DDjadBza.js"},{"url":"/app/assets/decorators-CN1Ng5e5.js"},{"url":"/app/assets/devTools-DmD3AOL3.js"},{"url":"/app/assets/dumpTools-RRPsoo3c.js"},{"url":"/app/assets/easing-Dm9VDgD4.js"},{"url":"/app/assets/editor-1D5c3W5u.css"},{"url":"/app/assets/editor-CqpGlYYw.js"},{"url":"/app/assets/effectRenderer-BUMclq0v.js"},{"url":"/app/assets/egm2008-15-nvvz7MYe.bin"},{"url":"/app/assets/egm2008-30-BpPXoGjA.bin"},{"url":"/app/assets/egm2008-60-bDxgbz8U.bin"},{"url":"/app/assets/engineStore-CKkyXB7S.js"},{"url":"/app/assets/environmentTextureTools-Cv2_FPk-.js"},{"url":"/app/assets/floatingOriginMatrixOverrides-DqSG47nr.js"},{"url":"/app/assets/flowGraphAssetsContext-WtUyuDAI.js"},{"url":"/app/assets/flowGraphAsyncExecutionBlock-Bvl308Y3.js"},{"url":"/app/assets/flowGraphBinaryOperationBlock-DmSGZwyK.js"},{"url":"/app/assets/flowGraphBlock-ERqv2EAF.js"},{"url":"/app/assets/flowGraphCachedOperationBlock-B_GY8dWh.js"},{"url":"/app/assets/flowGraphCoordinator-BO9TQ43j.js"},{"url":"/app/assets/flowGraphEventBlock-BU7xe34R.js"},{"url":"/app/assets/flowGraphExecutionBlock-Dlmpalig.js"},{"url":"/app/assets/flowGraphExecutionBlockWithOutSignal-BCvgF3Qh.js"},{"url":"/app/assets/flowGraphGLTFDataProvider-BSnteXbr.js"},{"url":"/app/assets/flowGraphUnaryOperationBlock-Bwzs7hNO.js"},{"url":"/app/assets/glTFLoaderAnimation-nmvPgb72.js"},{"url":"/app/assets/guid-BXdVC_j_.js"},{"url":"/app/assets/index-BD5YA1Hr.css"},{"url":"/app/assets/index-dsfoL2Iu.js"},{"url":"/app/assets/index.babylonjs-BXOHr79r.js"},{"url":"/app/assets/index.core-plugins-CgMOOvEN.js"},{"url":"/app/assets/lightConstants-DUaNSuF5.js"},{"url":"/app/assets/LoaderBase-ATuDWTDB-Dma9wrKU.js"},{"url":"/app/assets/logger-CuBYPcDK.js"},{"url":"/app/assets/math.axis-B0uJO_Mu.js"},{"url":"/app/assets/math.color-Q4dgtYWM.js"},{"url":"/app/assets/math.frustum-CcMj5eGx.js"},{"url":"/app/assets/math.path-DGvzraWE.js"},{"url":"/app/assets/math.plane-BUns5kps.js"},{"url":"/app/assets/math.scalar.functions-CQA38JRp.js"},{"url":"/app/assets/math.size-BvsHYnOu.js"},{"url":"/app/assets/math.vector-lDpFf2si.js"},{"url":"/app/assets/node-9ZucUUwN.js"},{"url":"/app/assets/observable-CJ4J1f_C.js"},{"url":"/app/assets/openpbrMaterialLoadingAdapter-B2Pk1HVN.js"},{"url":"/app/assets/pbrMaterialLoadingAdapter-FR-IVo1I.js"},{"url":"/app/assets/pickingInfo-DGMxPzFJ.js"},{"url":"/app/assets/pointerEvents-_20Qj9Uk.js"},{"url":"/app/assets/precisionDate-CfCevjl-.js"},{"url":"/app/assets/rgbdTextureTools-DdmpdfPD.js"},{"url":"/app/assets/scene-CzrUaDk5.js"},{"url":"/app/assets/spatialWebAudio-B-bb5ZWA.js"},{"url":"/app/assets/spatialWebAudioUpdaterComponent-DlOLam-_.js"},{"url":"/app/assets/starCatalogue-DSWPyUwb.js"},{"url":"/app/assets/subMesh-DqHJAKnZ.js"},{"url":"/app/assets/texture-BbkUzidn.js"},{"url":"/app/assets/textureTools-fbDCUoGl.js"},{"url":"/app/assets/thinEngine-bHOD-y2H.js"},{"url":"/app/assets/tools-B2YksR7s.js"},{"url":"/app/assets/tools.functions-CpAPkLao.js"},{"url":"/app/assets/typeStore-Cu_sj2zM.js"},{"url":"/app/assets/utils-BAE1Z-JU.js"},{"url":"/app/assets/viewer-CjzKkJp2.js"},{"url":"/app/assets/webAudioBaseSubGraph-DhZYilV5.js"},{"url":"/app/assets/webRequest-dqz0dHXK.js"}],"retainedFiles":[]});
