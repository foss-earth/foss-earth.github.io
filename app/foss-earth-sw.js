"use strict";
/** Extracted from Earth App/vite/appFilesWorker.js; host policy controls retention.
 * Pages are always network-first; no media cache or app/runtime is constructed.
 * Cross-origin isolation (docs/docs/proposals/webassembly.md, step 3): the build
 * says whether it may isolate (manifest.isolation), the page says whether it
 * wants to in the worker's own address, `?keep=1&isolate=1`, which survives the
 * worker being stopped; a page changes either by registering another address. */
function install(worker, manifest) {
  const policy = new URL(worker.location.href).searchParams;
  // An address without a policy is an older page's: it kept files and did not isolate. A build that keeps nothing never does.
  const keeping = manifest.keepFiles !== false && policy.get("keep") !== "0";
  const isolation = manifest.isolation ?? "off";
  const isolating = isolation !== "off" && policy.get("isolate") === "1";
  const suffix = isolation === "report-only" ? "-Report-Only" : "";
  // COEP require-corp, not credentialless, which Safari may lack; CORP so an isolated page elsewhere may load these files.
  const isolationHeaders = isolating ? [[`Cross-Origin-Opener-Policy${suffix}`, "same-origin"],
    [`Cross-Origin-Embedder-Policy${suffix}`, "require-corp"], ["Cross-Origin-Resource-Policy", "cross-origin"]] : [];
  // Bodiless statuses: a Response with one of these cannot be given a body, even an empty stream.
  const bodiless = new Set([101, 103, 204, 205, 304]);
  /** The response as served, with the isolation headers; stored responses keep what the server sent. Status 0 and opaque redirects cannot be rebuilt. */
  const served = response => {
    if (!isolationHeaders.length || !response || response.status === 0 || response.type === "opaqueredirect" || response.type === "opaque") return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of isolationHeaders) headers.set(name, value);
    return new Response(bodiless.has(response.status) ? null : response.body, { status: response.status, statusText: response.statusText, headers });
  };
  // Documents and workers carry the page's isolation; other same-origin loads need no headers, so they pass by unless kept.
  const needsHeaders = request => request.mode === "navigate" || request.destination === "worker" || request.destination === "sharedworker";
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
      // A worker that keeps nothing has no store: what an earlier one kept goes, as the page that turned keeping off asks.
      if (!keeping) await worker.caches.delete(cacheName).catch(() => {});
      else {
        const cache = await worker.caches.open(cacheName);
        // Older pages may still request their files. Deletion is an explicit host
        // policy; retained legacy resources survive either activation policy.
        if (manifest.retention === "current-only") for (const request of await cache.keys()) {
          if (!paths.has(new URL(request.url).pathname) && !retained.has(new URL(request.url).pathname)) await cache.delete(request);
        }
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
        return served(preloaded || await worker.fetch(request));
      })());
      return;
    }
    // As coi-serviceworker: a request that may only be answered from the browser's cache is not this worker's to fetch.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
    let url;
    try { url = new URL(request.url); } catch { return; }
    const own = url.origin === worker.location.origin;
    const isolate = () => { if (isolationHeaders.length && own && needsHeaders(request)) event.respondWith(worker.fetch(request).then(served)); };
    if (forgotten || !keeping) { isolate(); return; }
    const path = listed(request.url);
    if (path) { event.respondWith(answer(event, request, path).then(served)); return; }
    // Existing older files are usable by still-open pages. Do not acquire an
    // unknown file merely because the worker controls the deployment root.
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) { isolate(); return; }
    if (retained.has(url.pathname) || manifest.retention === "retain-older") event.respondWith((async () => {
      const cache = await worker.caches.open(cacheName);
      const old = await cache.match(url.pathname, matchOptions);
      if (old) return served(old);
      if (retained.has(url.pathname)) return served(await answer(event, request, url.pathname));
      return served(await worker.fetch(request));
    })());
    else isolate();
  });

  // The page names what it loaded before this worker controlled it; those files are kept from the browser's cache.
  worker.addEventListener("message", event => {
    const data = event.data;
    if (manifest.identity && data?.identity !== manifest.identity) return;
    if (data?.type === "foss-earth-forget") forgotten = true;
    if (!keeping || data?.type !== "foss-earth-keep" || !Array.isArray(data.urls)) return;
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

install(self, {"schemaVersion":1,"base":"/app/","scope":"/app/","workerFile":"foss-earth-sw.js","cacheNamespace":"foss-earth-app-files","identity":null,"retention":"current-only","isolation":"enforce","keepFiles":true,"files":[{"url":"/app/assets/abstractAudioBus-CIfPVnAK.js"},{"url":"/app/assets/abstractAudioNode-C2TJZxQY.js"},{"url":"/app/assets/abstractEngine.cubeTexture-BfCPrQ5R.js"},{"url":"/app/assets/abstractSoundInstance-D-nFsAP0.js"},{"url":"/app/assets/abstractSoundSource-BjQUHXmI.js"},{"url":"/app/assets/animationGroup-8AgBRbor.js"},{"url":"/app/assets/atlasImagery.worker-DUeB22SI.js"},{"url":"/app/assets/authoring-Cx8_Uzqp.js"},{"url":"/app/assets/babylon-shader-store-D-XQlhUT.js"},{"url":"/app/assets/babylon-shaders-glsl-CovYPAox.js"},{"url":"/app/assets/babylon-shaders-static-B5ITpmlb.js"},{"url":"/app/assets/babylon-shaders-wgsl-CmAujgXY.js"},{"url":"/app/assets/baseTexture.polynomial-BVBk1TUM.js"},{"url":"/app/assets/basisTextureLoader-BAwN7-Nf.js"},{"url":"/app/assets/browser-BksWRbtC.js"},{"url":"/app/assets/buffer-BwIgBsqV.js"},{"url":"/app/assets/buffer-Co66ag14.js"},{"url":"/app/assets/cameraMath-DfPPPPhe.js"},{"url":"/app/assets/client-DDzCAIBa.js"},{"url":"/app/assets/compassCenterSphere-7otZtWjz.js"},{"url":"/app/assets/cubemapToSphericalPolynomial-NcRVidV7.js"},{"url":"/app/assets/dataBuffer-C-wqV4qF.js"},{"url":"/app/assets/dds-D_5drp2r.js"},{"url":"/app/assets/ddsTextureLoader-CQV_PQaM.js"},{"url":"/app/assets/decorators-BOtej2xA.js"},{"url":"/app/assets/devTools-DmD3AOL3.js"},{"url":"/app/assets/drawWrapper.functions-t22iQNzU.js"},{"url":"/app/assets/dumpTools-BX_Q-rKX.js"},{"url":"/app/assets/editor-BWtJD_zx.js"},{"url":"/app/assets/editor-Ct7kpRfh.css"},{"url":"/app/assets/effectRenderer-jsQImlJ-.js"},{"url":"/app/assets/egm2008-15-nvvz7MYe.bin"},{"url":"/app/assets/egm2008-30-BpPXoGjA.bin"},{"url":"/app/assets/egm2008-60-bDxgbz8U.bin"},{"url":"/app/assets/engineStore-DYzBhiRl.js"},{"url":"/app/assets/environmentTextureTools-3LLexv9E.js"},{"url":"/app/assets/envTextureLoader-CYSe89lF.js"},{"url":"/app/assets/exrTextureLoader-evr_zjc7.js"},{"url":"/app/assets/floatingOriginMatrixOverrides-DqLXf5j4.js"},{"url":"/app/assets/flowGraphArrayIndexBlock-BFegLPli.js"},{"url":"/app/assets/flowGraphAssetsContext-WtUyuDAI.js"},{"url":"/app/assets/flowGraphAsyncExecutionBlock-DA1hpZd_.js"},{"url":"/app/assets/flowGraphBezierCurveEasingBlock-CtHUmWZ_.js"},{"url":"/app/assets/flowGraphBinaryOperationBlock-Dk_wovyj.js"},{"url":"/app/assets/flowGraphBlock-CnCenJAW.js"},{"url":"/app/assets/flowGraphBranchBlock-DspxljjT.js"},{"url":"/app/assets/flowGraphCachedOperationBlock-Dpp_f2zg.js"},{"url":"/app/assets/flowGraphCancelDelayBlock-Bj4Ue7VT.js"},{"url":"/app/assets/flowGraphCodeExecutionBlock-B0W3_hif.js"},{"url":"/app/assets/flowGraphConditionalDataBlock-D-WjLX7I.js"},{"url":"/app/assets/flowGraphConsoleLogBlock-Romlr0s6.js"},{"url":"/app/assets/flowGraphConstantBlock-BPLUKq28.js"},{"url":"/app/assets/flowGraphContextBlock-D14Hewdu.js"},{"url":"/app/assets/flowGraphCounterBlock-DeHmWUjJ.js"},{"url":"/app/assets/flowGraphDataSwitchBlock-wd2TF9su.js"},{"url":"/app/assets/flowGraphDebounceBlock-ctLuiH5T.js"},{"url":"/app/assets/flowGraphDoNBlock-DafLLIot.js"},{"url":"/app/assets/flowGraphEasingBlock-Ce-0-bhm.js"},{"url":"/app/assets/flowGraphExecutionBlock-BQwplnqf.js"},{"url":"/app/assets/flowGraphExecutionBlockWithOutSignal-CXszdyEO.js"},{"url":"/app/assets/flowGraphFlipFlopBlock-uF8HIiT-.js"},{"url":"/app/assets/flowGraphForLoopBlock-CM5OcNQm.js"},{"url":"/app/assets/flowGraphFunctionReferenceBlock-Dv_5crmk.js"},{"url":"/app/assets/flowGraphGetAssetBlock-D17n03Zf.js"},{"url":"/app/assets/flowGraphGetPropertyBlock-DyMOeY9F.js"},{"url":"/app/assets/flowGraphGetVariableBlock-BF3A4t8m.js"},{"url":"/app/assets/flowGraphGLTFDataProvider-omsVu68d.js"},{"url":"/app/assets/flowGraphIndexOfBlock-DANeRlnC.js"},{"url":"/app/assets/flowGraphInterpolationBlock-CJUxyXZ4.js"},{"url":"/app/assets/flowGraphJsonPointerParserBlock-CTpXmJs_.js"},{"url":"/app/assets/flowGraphMathBlocks-DSGY1j6C.js"},{"url":"/app/assets/flowGraphMathCombineExtractBlocks-xq8mO_BD.js"},{"url":"/app/assets/flowGraphMatrixMathBlocks-BaMXgJFz.js"},{"url":"/app/assets/flowGraphMeshPickEventBlock-64kGspkO.js"},{"url":"/app/assets/flowGraphMultiGateBlock-rR1P31X2.js"},{"url":"/app/assets/flowGraphPauseAnimationBlock-BW-5AFYH.js"},{"url":"/app/assets/flowGraphPlayAnimationBlock-BXsRMP05.js"},{"url":"/app/assets/flowGraphPointerOutEventBlock-8-I0Mm_t.js"},{"url":"/app/assets/flowGraphPointerOverEventBlock-CuRoqw_3.js"},{"url":"/app/assets/flowGraphReceiveCustomEventBlock-CCnKD-fH.js"},{"url":"/app/assets/flowGraphSceneReadyEventBlock-DqsfSbAm.js"},{"url":"/app/assets/flowGraphSceneTickEventBlock-DL9uUy4p.js"},{"url":"/app/assets/flowGraphSendCustomEventBlock-BM8VLA74.js"},{"url":"/app/assets/flowGraphSequenceBlock-hJTseNIe.js"},{"url":"/app/assets/flowGraphSetDelayBlock-ClCNX--Z.js"},{"url":"/app/assets/flowGraphSetPropertyBlock-CcmpRMjY.js"},{"url":"/app/assets/flowGraphSetVariableBlock-DfCjhyyB.js"},{"url":"/app/assets/flowGraphStopAnimationBlock-CUXWb-Si.js"},{"url":"/app/assets/flowGraphSwitchBlock-BYt1ovpe.js"},{"url":"/app/assets/flowGraphThrottleBlock-DI7HfdSO.js"},{"url":"/app/assets/flowGraphTransformCoordinatesSystemBlock-CL552VQg.js"},{"url":"/app/assets/flowGraphTypeToTypeBlocks-CgWF94n7.js"},{"url":"/app/assets/flowGraphUnaryOperationBlock-ORnYKHbS.js"},{"url":"/app/assets/flowGraphVectorMathBlocks-C4lqLfr9.js"},{"url":"/app/assets/flowGraphWaitAllBlock-Df55AocL.js"},{"url":"/app/assets/flowGraphWhileLoopBlock-BFBBiyrk.js"},{"url":"/app/assets/GlobeOverlay-DzP6jp8n.css"},{"url":"/app/assets/GlobeOverlay-QxzK7yrf.js"},{"url":"/app/assets/glTFLoaderAnimation-BmOQlFQk.js"},{"url":"/app/assets/google-CqnBr5HA.js"},{"url":"/app/assets/google-xHymeLgs.wasm"},{"url":"/app/assets/googlePreparation.worker-sGqikEbA.js"},{"url":"/app/assets/ground-CF29-xhB.wasm"},{"url":"/app/assets/groundBvh.worker-OC4WvYEn.js"},{"url":"/app/assets/guid-BXdVC_j_.js"},{"url":"/app/assets/hdrTextureLoader-7SJ7c3aq.js"},{"url":"/app/assets/iesTextureLoader-ELzMbfkv.js"},{"url":"/app/assets/imageProcessing-DVX3Kfaz.js"},{"url":"/app/assets/index-CwpOWNwD.css"},{"url":"/app/assets/index-DLJ_DFd4.js"},{"url":"/app/assets/index.babylonjs-Cb1Br29m.js"},{"url":"/app/assets/index.core-plugins-6SPqBI3G.js"},{"url":"/app/assets/instancedMesh-D9N6Z3OI.js"},{"url":"/app/assets/ktxTextureLoader-Dp5nLecU.js"},{"url":"/app/assets/light-CL9GVEpt.js"},{"url":"/app/assets/lightConstants-BQuoJkMN.js"},{"url":"/app/assets/LoaderBase-ATuDWTDB-Dma9wrKU.js"},{"url":"/app/assets/logger-CuBYPcDK.js"},{"url":"/app/assets/material.detailMapConfiguration-B1CN_4Am.js"},{"url":"/app/assets/math.axis-BC8rv4_x.js"},{"url":"/app/assets/math.color-Ccaij935.js"},{"url":"/app/assets/math.frustum-9t_qwi0P.js"},{"url":"/app/assets/math.path-BnUPJfuR.js"},{"url":"/app/assets/math.plane-DA2QKE_X.js"},{"url":"/app/assets/math.scalar.functions-lnL7TJ7T.js"},{"url":"/app/assets/math.size-D0gDANMB.js"},{"url":"/app/assets/math.vector-cXUysvte.js"},{"url":"/app/assets/math.viewport-1s33kfOs.js"},{"url":"/app/assets/mesh-8DpaRX54.js"},{"url":"/app/assets/mesh.vertexData.functions-CD4JOR2q.js"},{"url":"/app/assets/miniViewerCpu-DRkiY_In.js"},{"url":"/app/assets/node-ByNcla8-.js"},{"url":"/app/assets/observable-BmPG9gPP.js"},{"url":"/app/assets/openpbrMaterial-tIHTlTAJ.js"},{"url":"/app/assets/openpbrMaterialLoadingAdapter-DwCyMh89.js"},{"url":"/app/assets/pbrMaterial-tExtV4Su.js"},{"url":"/app/assets/pbrMaterialLoadingAdapter-DyQX0BsB.js"},{"url":"/app/assets/pointerEvents-eWS9Fuue.js"},{"url":"/app/assets/poseEditTab-0T241VFP.js"},{"url":"/app/assets/precisionDate-CfCevjl-.js"},{"url":"/app/assets/preload-helper-yvApXQsr.js"},{"url":"/app/assets/pushMaterial-mbST6lNq.js"},{"url":"/app/assets/raster-DlwdWSMe.wasm"},{"url":"/app/assets/react-dom-ByqcrMAm.js"},{"url":"/app/assets/rolldown-runtime-hePW80VL.js"},{"url":"/app/assets/scene-5WPw9j_7.js"},{"url":"/app/assets/scenes-B6WJOika.js"},{"url":"/app/assets/shaderLanguage-CsgORKnQ.js"},{"url":"/app/assets/shaderMaterial-CtyhxAGG.js"},{"url":"/app/assets/sky-CRaPsUzR.wasm"},{"url":"/app/assets/sky-shared-D-4V-MY1.wasm"},{"url":"/app/assets/skyEvaluation.worker-wkjYbKFh.js"},{"url":"/app/assets/skySharedHelper.worker-BqIP9ECd.js"},{"url":"/app/assets/spatialWebAudio-DmiRWwlf.js"},{"url":"/app/assets/spatialWebAudioUpdaterComponent-DwwURXSX.js"},{"url":"/app/assets/src-B5WrQm67.js"},{"url":"/app/assets/src-YIlhAeQk.js"},{"url":"/app/assets/standardMaterial-CGA_HzPq.js"},{"url":"/app/assets/starCatalogue-DSWPyUwb.js"},{"url":"/app/assets/terrain-Dz5EuTp6.wasm"},{"url":"/app/assets/terrainDecode.worker-Dr5ZvJKo.js"},{"url":"/app/assets/terrainHeights.worker-DbQgTrAC.js"},{"url":"/app/assets/terrainMesh.worker-BuSR5OWE.js"},{"url":"/app/assets/terrainRegionOverlay-CWEHtw0q.js"},{"url":"/app/assets/texture-BFawUibc.js"},{"url":"/app/assets/textureTools-k0GoRu7f.js"},{"url":"/app/assets/tgaTextureLoader-CqhhocF6.js"},{"url":"/app/assets/thinEngine-DYkgvbIo.js"},{"url":"/app/assets/thumbnailBackend-DYTcQKJ1.js"},{"url":"/app/assets/thumbnailOcclusion-Dq7SNB76.js"},{"url":"/app/assets/thumbnailWebGl-D6T6HCF8.js"},{"url":"/app/assets/thumbnailWebGpu-BSNVReZJ.js"},{"url":"/app/assets/tools-Dn6DBqCZ.js"},{"url":"/app/assets/tools.functions-Bf64XVYQ.js"},{"url":"/app/assets/typeStore-Cu_sj2zM.js"},{"url":"/app/assets/ui-BMJ0-rIn.js"},{"url":"/app/assets/viewer-B60pNNZA.js"},{"url":"/app/assets/webAudioBaseSubGraph-2eYQOAG9.js"},{"url":"/app/assets/webAudioBus-Dui7VtRj.js"},{"url":"/app/assets/webAudioMainBus-DWbBAVhd.js"},{"url":"/app/assets/webAudioSoundSource-DZD4A5NC.js"},{"url":"/app/assets/webAudioStaticSound-B7fh76J9.js"},{"url":"/app/assets/webAudioStreamingSound-DYgvPJFz.js"},{"url":"/app/assets/webRequest-dqz0dHXK.js"},{"url":"/app/assets/workerPool-Dva09jEo.js"}],"retainedFiles":[]});
