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

install(self, {"schemaVersion":1,"base":"/app/","scope":"/app/","workerFile":"foss-earth-sw.js","cacheNamespace":"foss-earth-app-files","identity":null,"retention":"current-only","files":[{"url":"/app/assets/abstractAudioBus-BojMHsxs.js"},{"url":"/app/assets/abstractEngine.cubeTexture-BBYFE6mZ.js"},{"url":"/app/assets/abstractSoundInstance-BLnjjf75.js"},{"url":"/app/assets/abstractSoundSource-D6jLmLkF.js"},{"url":"/app/assets/animationGroup-BKfhfRGF.js"},{"url":"/app/assets/atlasImagery.worker-CuTMHTbH.js"},{"url":"/app/assets/babylon-shader-store-D-XQlhUT.js"},{"url":"/app/assets/babylon-shaders-glsl-sEu50yKq.js"},{"url":"/app/assets/babylon-shaders-static-koqd8L8U.js"},{"url":"/app/assets/babylon-shaders-wgsl-BsTQVxIz.js"},{"url":"/app/assets/basisTextureLoader-BAwN7-Nf.js"},{"url":"/app/assets/buffer-Co66ag14.js"},{"url":"/app/assets/compassCenterSphere-6kwtAUBe.js"},{"url":"/app/assets/cubemapToSphericalPolynomial-D5MiWc5-.js"},{"url":"/app/assets/dataBuffer-C-wqV4qF.js"},{"url":"/app/assets/dds-Bm21okW7.js"},{"url":"/app/assets/ddsTextureLoader-Dav6Jy0j.js"},{"url":"/app/assets/decorators-BOtej2xA.js"},{"url":"/app/assets/devTools-DmD3AOL3.js"},{"url":"/app/assets/drawWrapper.functions-t22iQNzU.js"},{"url":"/app/assets/dumpTools-Cv7it3MX.js"},{"url":"/app/assets/editor-CG_htNz5.css"},{"url":"/app/assets/editor-E81_Q7dh.js"},{"url":"/app/assets/effectRenderer-CAWlcAO0.js"},{"url":"/app/assets/egm2008-15-nvvz7MYe.bin"},{"url":"/app/assets/egm2008-30-BpPXoGjA.bin"},{"url":"/app/assets/egm2008-60-bDxgbz8U.bin"},{"url":"/app/assets/engineStore-DYzBhiRl.js"},{"url":"/app/assets/environmentTextureTools-C0DHPwFR.js"},{"url":"/app/assets/envTextureLoader-BCCzbNPJ.js"},{"url":"/app/assets/exrTextureLoader-evr_zjc7.js"},{"url":"/app/assets/floatingOriginMatrixOverrides-DqLXf5j4.js"},{"url":"/app/assets/flowGraphArrayIndexBlock-CZCkl0tQ.js"},{"url":"/app/assets/flowGraphAssetsContext-WtUyuDAI.js"},{"url":"/app/assets/flowGraphAsyncExecutionBlock-DA1hpZd_.js"},{"url":"/app/assets/flowGraphBezierCurveEasingBlock-DrGG1vcs.js"},{"url":"/app/assets/flowGraphBinaryOperationBlock-Dk_wovyj.js"},{"url":"/app/assets/flowGraphBlock-CnCenJAW.js"},{"url":"/app/assets/flowGraphBranchBlock-DspxljjT.js"},{"url":"/app/assets/flowGraphCachedOperationBlock-Dpp_f2zg.js"},{"url":"/app/assets/flowGraphCancelDelayBlock-CiZYZ4Bw.js"},{"url":"/app/assets/flowGraphCodeExecutionBlock-B0W3_hif.js"},{"url":"/app/assets/flowGraphConditionalDataBlock-D-WjLX7I.js"},{"url":"/app/assets/flowGraphConsoleLogBlock-Romlr0s6.js"},{"url":"/app/assets/flowGraphConstantBlock-BPLUKq28.js"},{"url":"/app/assets/flowGraphContextBlock-D14Hewdu.js"},{"url":"/app/assets/flowGraphCounterBlock-DeHmWUjJ.js"},{"url":"/app/assets/flowGraphDataSwitchBlock-B_5Ls7OH.js"},{"url":"/app/assets/flowGraphDebounceBlock-ctLuiH5T.js"},{"url":"/app/assets/flowGraphDoNBlock-DafLLIot.js"},{"url":"/app/assets/flowGraphEasingBlock-BO7bEIhU.js"},{"url":"/app/assets/flowGraphExecutionBlock-BQwplnqf.js"},{"url":"/app/assets/flowGraphExecutionBlockWithOutSignal-CXszdyEO.js"},{"url":"/app/assets/flowGraphFlipFlopBlock-uF8HIiT-.js"},{"url":"/app/assets/flowGraphForLoopBlock-Br06PyAF.js"},{"url":"/app/assets/flowGraphFunctionReferenceBlock-Dv_5crmk.js"},{"url":"/app/assets/flowGraphGetAssetBlock-2ZNfV2nC.js"},{"url":"/app/assets/flowGraphGetPropertyBlock-DyMOeY9F.js"},{"url":"/app/assets/flowGraphGetVariableBlock-BF3A4t8m.js"},{"url":"/app/assets/flowGraphGLTFDataProvider-FH6e5ivR.js"},{"url":"/app/assets/flowGraphIndexOfBlock-DANeRlnC.js"},{"url":"/app/assets/flowGraphInterpolationBlock-Bnjt4qqJ.js"},{"url":"/app/assets/flowGraphJsonPointerParserBlock-CTpXmJs_.js"},{"url":"/app/assets/flowGraphMathBlocks-BnpGV8eA.js"},{"url":"/app/assets/flowGraphMathCombineExtractBlocks-xq8mO_BD.js"},{"url":"/app/assets/flowGraphMatrixMathBlocks-BaMXgJFz.js"},{"url":"/app/assets/flowGraphMeshPickEventBlock-C808N_H3.js"},{"url":"/app/assets/flowGraphMultiGateBlock-rR1P31X2.js"},{"url":"/app/assets/flowGraphPauseAnimationBlock-BW-5AFYH.js"},{"url":"/app/assets/flowGraphPlayAnimationBlock-ByJQs3vp.js"},{"url":"/app/assets/flowGraphPointerOutEventBlock-CGmRKcPm.js"},{"url":"/app/assets/flowGraphPointerOverEventBlock-BQyZs2Ko.js"},{"url":"/app/assets/flowGraphReceiveCustomEventBlock-BI82Pt4X.js"},{"url":"/app/assets/flowGraphSceneReadyEventBlock-B5NwdYeO.js"},{"url":"/app/assets/flowGraphSceneTickEventBlock-DmHHQHE-.js"},{"url":"/app/assets/flowGraphSendCustomEventBlock-BM8VLA74.js"},{"url":"/app/assets/flowGraphSequenceBlock-hJTseNIe.js"},{"url":"/app/assets/flowGraphSetDelayBlock-ClCNX--Z.js"},{"url":"/app/assets/flowGraphSetPropertyBlock-CcmpRMjY.js"},{"url":"/app/assets/flowGraphSetVariableBlock-DfCjhyyB.js"},{"url":"/app/assets/flowGraphStopAnimationBlock-CUXWb-Si.js"},{"url":"/app/assets/flowGraphSwitchBlock-CcZAdrdf.js"},{"url":"/app/assets/flowGraphThrottleBlock-DI7HfdSO.js"},{"url":"/app/assets/flowGraphTransformCoordinatesSystemBlock-CL552VQg.js"},{"url":"/app/assets/flowGraphTypeToTypeBlocks-CgWF94n7.js"},{"url":"/app/assets/flowGraphUnaryOperationBlock-ORnYKHbS.js"},{"url":"/app/assets/flowGraphVectorMathBlocks-_oPmbSQp.js"},{"url":"/app/assets/flowGraphWaitAllBlock-Df55AocL.js"},{"url":"/app/assets/flowGraphWhileLoopBlock-BFBBiyrk.js"},{"url":"/app/assets/glTFLoaderAnimation-BKmxKRJh.js"},{"url":"/app/assets/guid-BXdVC_j_.js"},{"url":"/app/assets/hdrTextureLoader-7SJ7c3aq.js"},{"url":"/app/assets/iesTextureLoader-ELzMbfkv.js"},{"url":"/app/assets/imageProcessing-DVX3Kfaz.js"},{"url":"/app/assets/index-BExz2vNV.css"},{"url":"/app/assets/index-BHPOs1F-.js"},{"url":"/app/assets/index.babylonjs-BFwN0ylv.js"},{"url":"/app/assets/index.core-plugins-CgMOOvEN.js"},{"url":"/app/assets/ktxTextureLoader-Dp5nLecU.js"},{"url":"/app/assets/lightConstants-BQuoJkMN.js"},{"url":"/app/assets/LoaderBase-ATuDWTDB-Dma9wrKU.js"},{"url":"/app/assets/logger-CuBYPcDK.js"},{"url":"/app/assets/math.axis-BC8rv4_x.js"},{"url":"/app/assets/math.color-Ccaij935.js"},{"url":"/app/assets/math.frustum-9t_qwi0P.js"},{"url":"/app/assets/math.path-BnUPJfuR.js"},{"url":"/app/assets/math.plane-DA2QKE_X.js"},{"url":"/app/assets/math.scalar.functions-lnL7TJ7T.js"},{"url":"/app/assets/math.size-D0gDANMB.js"},{"url":"/app/assets/math.vector-cXUysvte.js"},{"url":"/app/assets/math.viewport-1s33kfOs.js"},{"url":"/app/assets/mesh-8DpaRX54.js"},{"url":"/app/assets/mesh.vertexData.functions-CD4JOR2q.js"},{"url":"/app/assets/miniViewerCpu-TKrbo9_z.js"},{"url":"/app/assets/node-ByNcla8-.js"},{"url":"/app/assets/observable-BmPG9gPP.js"},{"url":"/app/assets/openpbrMaterial-ceYxBbP3.js"},{"url":"/app/assets/openpbrMaterialLoadingAdapter-DlXsHguZ.js"},{"url":"/app/assets/pbrMaterialLoadingAdapter-RZnrJgFa.js"},{"url":"/app/assets/pointerEvents-eWS9Fuue.js"},{"url":"/app/assets/precisionDate-CfCevjl-.js"},{"url":"/app/assets/preload-helper-yvApXQsr.js"},{"url":"/app/assets/pushMaterial-mbST6lNq.js"},{"url":"/app/assets/raster-DlwdWSMe.wasm"},{"url":"/app/assets/rgbdTextureTools-CvP7Vd1w.js"},{"url":"/app/assets/rolldown-runtime-BpQH8Ho1.js"},{"url":"/app/assets/scene-5WPw9j_7.js"},{"url":"/app/assets/spatialWebAudio-DBtyT8JJ.js"},{"url":"/app/assets/starCatalogue-DSWPyUwb.js"},{"url":"/app/assets/terrainDecode.worker-B4gkv-yK.js"},{"url":"/app/assets/texture-BFawUibc.js"},{"url":"/app/assets/textureTools-3lliBjnf.js"},{"url":"/app/assets/tgaTextureLoader-CqhhocF6.js"},{"url":"/app/assets/thinEngine-BBN7qNuK.js"},{"url":"/app/assets/thumbnailBackend-55R_r9jj.js"},{"url":"/app/assets/thumbnailOcclusion-Dq7SNB76.js"},{"url":"/app/assets/thumbnailWebGl-D6T6HCF8.js"},{"url":"/app/assets/thumbnailWebGpu-BI-VNb02.js"},{"url":"/app/assets/tools-Dn6DBqCZ.js"},{"url":"/app/assets/tools.functions-Bf64XVYQ.js"},{"url":"/app/assets/typeStore-Cu_sj2zM.js"},{"url":"/app/assets/viewer-BiijRWYh.js"},{"url":"/app/assets/webAudioBaseSubGraph-UguXgu0g.js"},{"url":"/app/assets/webAudioBus-CaIAL3er.js"},{"url":"/app/assets/webAudioMainBus-DdxLyhxf.js"},{"url":"/app/assets/webAudioSoundSource-Ca3veckW.js"},{"url":"/app/assets/webAudioStaticSound-Ck3Oa2sU.js"},{"url":"/app/assets/webAudioStreamingSound-SiLLhylb.js"},{"url":"/app/assets/webRequest-dqz0dHXK.js"},{"url":"/app/assets/workerPool-Dva09jEo.js"}],"retainedFiles":[]});
