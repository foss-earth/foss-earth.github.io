// Evaluated in the page by scripts/validation/panorama-campus.mjs, which opens
// the app with ?panoramaTest=1. It drives the real globe camera through a
// camera trace, reads back what the orb's production shader drew, and holds
// it against the CPU reference with the same camera, marker and image pose.
// It uses only the test hooks: window.__fossEarthPanoramaTest.
(() => {
  if (window.__campus) return true;
  const T = window.__fossEarthPanoramaTest;
  if (!T) throw new Error("The page was not opened with ?panoramaTest=1.");
  const M = T.math;
  const { runtime } = T;
  const { scene, engine } = runtime;
  const DEG = Math.PI / 180;
  // The globe camera looks no higher than just below the horizon (Babylon's pitch limit is π/2 − 0.01).
  const HIGHEST_LOOK_DEG = -0.7;
  // A probe that has not read back by then is recorded as failed, so one stuck probe cannot stall the run.
  const PROBE_TIMEOUT_MS = 15000;
  // Babylon's GeospatialCamera keeps at least 10 m from the point it orbits.
  const SMALLEST_ORBIT_M = 20;

  let ctx = null;

  // Every automatic map-detail change, on the page's clock, and the two switches that give it room.
  const detailChanges = [];
  runtime.onDetailAdjusted(decision => { detailChanges.push({ ...decision, pageMs: performance.now() }); });
  const AUTO_DETAIL_IDS = ["map.auto.terrainDetail", "map.auto.imageryDetail"];
  let heldDetailSwitches = null;

  function status() {
    const handle = T.scenes.handle();
    const s = handle?.status;
    return {
      now: performance.now(),
      renderer: runtime.renderer.mode,
      hasRenderer: Boolean(T.renderer),
      scene: s ? {
        id: s.sceneId, phase: s.phase, overview: s.overview, renderingAvailable: s.renderingAvailable, lastError: s.lastError,
        entries: s.entries.map(e => ({ id: e.id, placement: e.placement, preview: e.preview, previewDetail: e.previewDetail, message: e.message })),
      } : null,
      loading: T.scenes.state().loading,
      errors: T.scenes.state().errors,
    };
  }

  function ready(orbId) {
    const s = status();
    const entry = s.scene?.entries.find(e => e.id === orbId);
    return Boolean(s.hasRenderer && s.scene && s.scene.overview !== "pending" && entry && entry.placement === "placed" && entry.preview === "ready"
      && T.renderer.inspectOrb(orbId)?.textured);
  }

  function maxMatDifference(a, b) {
    let max = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a[r][c] - b[r][c]));
    return max;
  }

  /** Fixes the orb and the reference: the displayed marker, and the content rotation from the manifest's pose. */
  function prepare(orbId, capture, pose) {
    const orb = T.renderer.inspectOrb(orbId);
    if (!orb?.marker) throw new Error(`The orb ${orbId} has no placed marker.`);
    const enu = M.enuFrame(capture.longitudeDeg, capture.latitudeDeg);
    const content = M.contentMatrix(enu, pose);
    ctx = { orbId, marker: orb.marker, enu, content, fov: runtime.captureNavigationSnapshot()?.camera.fov ?? 60 * DEG };
    return {
      marker: orb.marker,
      markerGeodetic: M.pointGeodetic(orb.marker),
      radiusMeters: orb.radiusMeters,
      // The renderer's own content rotation against the one computed here from the manifest.
      contentDifference: maxMatDifference(content, orb.content),
      fovDeg: ctx.fov / DEG,
    };
  }

  const enuVector = v => M.add(M.scale(ctx.enu.east, v[0]), M.add(M.scale(ctx.enu.north, v[1]), M.scale(ctx.enu.up, v[2])));

  /** A camera `distanceM` from the marker on `bearingDeg`, `heightM` above it, looking at it and then turned by the offsets. */
  function pose(p) {
    const b = p.bearingDeg * DEG;
    const eyeEnu = [p.distanceM * Math.sin(b), p.distanceM * Math.cos(b), p.heightM];
    const look = M.enuHeadingPitch(M.scale(eyeEnu, -1));
    const headingDeg = look.headingDeg + (p.yawOffsetDeg ?? 0);
    const pitchDeg = Math.min(look.pitchDeg + (p.pitchOffsetDeg ?? 0), HIGHEST_LOOK_DEG);
    const eye = M.add(ctx.marker, enuVector(eyeEnu));
    const radius = Math.max(M.length(eyeEnu), SMALLEST_ORBIT_M);
    const center = M.add(eye, M.scale(enuVector(M.enuDirection(headingDeg, pitchDeg)), radius));
    return { eye, center, headingDeg, pitchDeg, radius };
  }

  /** The marker as displayed now: a ground-relative marker follows the terrain as it refines. */
  function markerNow() {
    const marker = T.renderer?.inspectOrb(ctx.orbId)?.marker;
    if (marker) ctx.marker = marker;
    return ctx.marker;
  }

  /**
   * Waits until terrain streaming has stopped and the marker has moved less
   * than `toleranceM` for `stableMs`. Returns how far it travelled, with its
   * height once a second.
   */
  async function settleMarker(stableMs, toleranceM, timeoutMs) {
    const started = performance.now();
    const first = markerNow();
    let last = first;
    let since = performance.now();
    const history = [];
    let nextSample = 0;
    const result = settled => ({ settled, seconds: (performance.now() - started) / 1000, travelM: M.length(M.sub(markerNow(), first)), marker: markerNow(), geodetic: M.pointGeodetic(markerNow()), history });
    while (performance.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
      runtime.requestRender();
      const now = markerNow();
      const streaming = runtime.isStreamingTiles();
      if (performance.now() - started >= nextSample) {
        history.push({ t: (performance.now() - started) / 1000, heightM: M.pointGeodetic(now).heightMeters, streaming });
        nextSample += 1000;
      }
      if (streaming || M.length(M.sub(now, last)) > toleranceM) { last = now; since = performance.now(); }
      if (performance.now() - since >= stableMs) return result(true);
    }
    return result(false);
  }

  function apply(p) {
    markerNow();
    const q = pose(p);
    const ok = runtime.restoreNavigationSnapshot({
      version: 1,
      view: { latDeg: 0, lonDeg: 0, headingDeg: q.headingDeg, pitchDeg: -q.pitchDeg, zoomMeters: q.radius },
      camera: { center: { x: q.center[0], y: q.center[1], z: q.center[2] }, yaw: q.headingDeg * DEG, pitch: (Math.PI / 2) * (1 + q.pitchDeg / 90), radius: q.radius, fov: ctx.fov },
    });
    if (!ok) throw new Error("The globe camera refused the pose: something holds navigation.");
    return q;
  }

  // ─── Segments ───────────────────────────────────────────────────────
  const smooth = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  function segmentPose(segment, t) {
    const u = t / segment.seconds;
    switch (segment.type) {
      case "orbit": return { bearingDeg: segment.fromBearingDeg + segment.turnDeg * u, distanceM: segment.distanceM, heightM: segment.heightM };
      case "sweep": {
        // Near to far and back.
        const s = u < 0.5 ? smooth(u * 2) : 1 - smooth(u * 2 - 1);
        return { bearingDeg: segment.bearingDeg, distanceM: segment.nearM + (segment.farM - segment.nearM) * s, heightM: segment.heightM };
      }
      case "look": return {
        bearingDeg: segment.bearingDeg, distanceM: segment.distanceM, heightM: segment.heightM,
        yawOffsetDeg: segment.yawAmplitudeDeg * Math.sin(2 * Math.PI * u),
        pitchOffsetDeg: segment.pitchAmplitudeDeg * Math.sin(4 * Math.PI * u),
      };
      case "hold": return segment.pose;
      default: throw new Error(`Unknown segment type ${segment.type}`);
    }
  }

  /** The eye a draw used, from its camera revision's first three numbers. */
  const revisionEye = revision => revision.split(",").slice(0, 3).map(Number);

  /**
   * Replays `segments` on the globe camera, one pose per frame from the time
   * since the start, and records every frame. A "stop" segment releases
   * continuous rendering so the scheduler can idle, as when input stops.
   * Options: probeEverySeconds (0: none), delay: { segment, frames } (the
   * negative control), correlate (per-frame draw records).
   */
  function runTrace(segments, options = {}) {
    const renderer = T.renderer;
    const target = `orb:${ctx.orbId}`;
    const frames = [];
    const probes = [];
    const pendingProbes = [];
    const segmentStart = () => document.timeline?.currentTime ?? performance.now();
    const correlation = { frames: 0, orbDrawFrames: 0, staleUniformFrames: 0, missingDrawFrames: 0, multipleDrawFrames: 0, maxDrawVsLiveEyeM: 0, worstDrawVsLive: null, maxLiveVsPlannedEyeM: 0, markerTravelM: 0, staleSegments: {} };
    const markerAtStart = ctx.marker;
    const ends = [];
    let total = 0;
    for (const segment of segments) { total += segment.seconds; ends.push(total); }
    let start = null;
    let index = 0;
    let continuous = false;
    let planned = null;
    let nextProbe = options.probeEverySeconds > 0 ? options.probeEverySeconds / 2 : Infinity;
    let probing = false;
    let resumeRequestedAt = null;
    const resumes = [];
    let done;
    const finished = new Promise(resolve => { done = resolve; });
    // Records are kept only while a check captures once the renderer's bookkeeping experiment is on.
    const capturing = Boolean(options.correlate || options.delay);
    if (capturing) renderer.captureDraws?.(true);

    const hold = on => {
      if (on && !continuous) runtime.beginContinuous();
      if (!on && continuous) runtime.endContinuous();
      continuous = on;
    };

    const before = scene.onBeforeAnimationsObservable.add(() => {
      // The animation frame's own time, shared by everything drawn in it: the
      // frame interval is measured on it, so work done before the render
      // starts does not jitter it. How late the render starts is kept apart.
      const now = performance.now();
      const frameTime = document.timeline?.currentTime ?? now;
      if (start === null) start = frameTime;
      const t = frameTime - start;
      while (index < segments.length && t >= ends[index] * 1000) index++;
      if (index >= segments.length) return;
      const segment = segments[index];
      const t0 = (index === 0 ? 0 : ends[index - 1]) * 1000;
      if (resumeRequestedAt !== null) {
        resumes.push({ segment: segment.name, firstFrameAfterMs: frameTime - resumeRequestedAt });
        resumeRequestedAt = null;
      }
      frames.push([t, engine.frameId, index, now - frameTime]);
      window.__campusProgress = { segment: segments[index]?.name, t: t / 1000, frames: frames.length, probesDone: probes.length, probing };
      if (segment.type === "stop") return;
      planned = apply(segmentPose(segment, (t - t0) / 1000));
      if (options.delay) renderer.setUniformDelayFrames(options.delay.segment === segment.name ? options.delay.frames : 0);
      if (t / 1000 >= nextProbe && !probing) {
        probing = true;
        nextProbe += options.probeEverySeconds;
        const probe = probeOrb(segment.name, t / 1000).then(result => { probes.push(result); }, error => { probes.push({ segment: segment.name, t: t / 1000, error: String(error) }); })
          .finally(() => { probing = false; });
        pendingProbes.push(probe);
      }
    });

    const after = scene.onAfterRenderObservable.add(() => {
      if (start === null || !planned || index >= segments.length || segments[index].type === "stop" || !options.correlate) return;
      const frameId = engine.frameId;
      const records = renderer.drawRecords();
      correlation.frames++;
      let draws = 0;
      let stale = false;
      for (let i = records.length - 1; i >= 0 && records[i].frameId >= frameId; i--) {
        const record = records[i];
        if (record.frameId !== frameId || record.target !== target) continue;
        draws++;
        if (record.cameraRevision !== record.uniformRevision) stale = true;
        const live = scene.activeCamera.globalPosition;
        const drawn = revisionEye(record.cameraRevision);
        const gap = M.length(M.sub(drawn, [live.x, live.y, live.z]));
        if (gap > correlation.maxDrawVsLiveEyeM) {
          correlation.maxDrawVsLiveEyeM = gap;
          correlation.worstDrawVsLive = { segment: segments[index].name, t: ((document.timeline?.currentTime ?? performance.now()) - start) / 1000, frameId, drawsThisFrame: records.filter(r => r.frameId === frameId && r.target === target).length, activeCameras: scene.activeCameras?.length ?? 0 };
        }
      }
      if (draws > 1) correlation.multipleDrawFrames++;
      if (draws > 0) correlation.orbDrawFrames++;
      else correlation.missingDrawFrames++;
      if (stale) {
        correlation.staleUniformFrames++;
        const name = segments[index].name;
        correlation.staleSegments[name] = (correlation.staleSegments[name] ?? 0) + 1;
      }
      if (ctx.marker !== markerAtStart) correlation.markerTravelM = Math.max(correlation.markerTravelM, M.length(M.sub(ctx.marker, markerAtStart)));
      const live = scene.activeCamera.globalPosition;
      correlation.maxLiveVsPlannedEyeM = Math.max(correlation.maxLiveVsPlannedEyeM, M.length(M.sub([live.x, live.y, live.z], planned.eye)));
    });

    // Segment boundaries on a clock, so an idle scheduler still reaches the next one.
    let clock = 0;
    const timers = [];
    segments.forEach((segment, i) => {
      const at = clock;
      timers.push(window.setTimeout(() => {
        if (segment.type === "stop") { hold(false); return; }
        if (i > 0 && segments[i - 1].type === "stop") resumeRequestedAt = segmentStart();
        hold(true);
        runtime.requestRender();
      }, at * 1000));
      clock += segment.seconds;
    });
    timers.push(window.setTimeout(async () => {
      window.__campusProgress = { ...window.__campusProgress, ending: true, pendingProbes: pendingProbes.length, probesDone: probes.length };
      hold(false);
      scene.onBeforeAnimationsObservable.remove(before);
      scene.onAfterRenderObservable.remove(after);
      await Promise.allSettled(pendingProbes);
      renderer.setUniformDelayFrames(0);
      if (capturing) renderer.captureDraws?.(false);
      done({ seconds: total, frames, probes, correlation, resumes, segments: segments.map(s => s.name) });
    }, total * 1000 + 50));
    return finished;
  }

  // ─── Probes ─────────────────────────────────────────────────────────
  function analyseRay(width, height, data, frame) {
    let best = null;
    for (const order of ["top-down", "bottom-up"]) {
      let max = 0, count = 0;
      for (let i = 0; i < width * height && count < 4000; i++) {
        if (data[i * 4 + 3] < 0.999) continue;
        const x = (i % width + 0.5) / width;
        const row = (Math.floor(i / width) + 0.5) / height;
        const cpu = M.viewRay(frame.view, x, order === "top-down" ? row : 1 - row);
        max = Math.max(max, M.angleDeg(cpu, [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]));
        count++;
      }
      if (!best || max < best.maxDeg) best = { order, maxDeg: max, pixels: count };
    }
    return best;
  }

  /**
   * One frame's orb read back twice: the view ray each pixel drew with, and
   * the image direction it sampled. Three measures, kept apart:
   *  - mapping: the CPU window and pose applied to the GPU's own ray, against
   *    the GPU's direction. The GPU port of the CPU contract; the tolerance
   *    applies here.
   *  - rays: the GPU's rays against the CPU's pixel-centre rays: where the
   *    rasteriser put each pixel, to within its interpolation precision.
   *  - end to end: the CPU window of the CPU ray against the GPU's direction.
   *    The flat window magnifies ray differences by tan β / tan α, so this is
   *    reported with that gain.
   */
  /**
   * Reads a probe back while holding continuous rendering: its GPU work is
   * submitted with a later frame, which an idle scheduler would never draw.
   */
  async function readProbe(target, outputs) {
    runtime.beginContinuous();
    let timer;
    try {
      return await Promise.race([
        T.renderer.probe(target, outputs),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`the probe did not read back within ${PROBE_TIMEOUT_MS} ms`)), PROBE_TIMEOUT_MS); }),
      ]);
    } finally {
      clearTimeout(timer);
      runtime.endContinuous();
    }
  }

  async function probeOrb(segment, t) {
    const renderer = T.renderer;
    const previewHalf = (options_.previewFovDeg / 2) * DEG;
    const { width, height, outputs, frame } = await readProbe({ orb: ctx.orbId }, ["ray", "direction"]);
    const rays = outputs.ray, directions = outputs.direction;
    const ray = analyseRay(width, height, rays, frame);
    const orb = renderer.inspectOrb(ctx.orbId, frame);
    const rel = M.sub(orb.marker, frame.eye);
    const distance = M.length(rel);
    const geometry = M.orbGeometry(rel, orb.effectiveRadius);
    const gain = geometry.inside || geometry.alpha >= previewHalf ? 1 : Math.tan(previewHalf) / Math.tan(geometry.alpha);
    const pixelRad = (2 * Math.tan(frame.view.verticalFovRad / 2)) / height;
    const cosAlpha = Math.cos(geometry.alpha);
    const topDown = !ray || ray.order === "top-down";
    const readIndex = (col, row) => (topDown ? row : height - 1 - row) * width + col;
    // Only the orb's square is compared ray by ray; anything drawn outside it is counted.
    const rect = engine.getRenderingCanvas().getBoundingClientRect();
    const centre = renderer.project(geometry.axis, frame);
    const diameterPx = M.projectedDiameterPx(orb.effectiveRadius, distance, frame.view.verticalFovRad, height);
    const half = diameterPx / 2 + 4;
    const box = centre ? {
      x0: Math.max(0, Math.floor((centre.x - rect.left) * (width / rect.width) - half)),
      x1: Math.min(width - 1, Math.ceil((centre.x - rect.left) * (width / rect.width) + half)),
      y0: Math.max(0, Math.floor((centre.y - rect.top) * (height / rect.height) - half)),
      y1: Math.min(height - 1, Math.ceil((centre.y - rect.top) * (height / rect.height) + half)),
    } : null;
    let outside = 0;
    for (let i = 0; i < width * height; i++) {
      if (directions[i * 4 + 3] <= 0) continue;
      const col = i % width;
      const row = topDown ? Math.floor(i / width) : height - 1 - Math.floor(i / width);
      if (!box || col < box.x0 || col > box.x1 || row < box.y0 || row > box.y1) outside++;
    }
    const mapping = [], endToEnd = [], rayErrors = [];
    let worst = { deg: 0, x: -1, y: -1 };
    let edge = 0, gpuOnly = 0, cpuOnly = 0;
    if (box) {
      for (let row = box.y0; row <= box.y1; row++) {
        for (let col = box.x0; col <= box.x1; col++) {
          const i = readIndex(col, row);
          const coverage = directions[i * 4 + 3];
          const v = M.viewRay(frame.view, (col + 0.5) / width, (row + 0.5) / height);
          const c = M.dot(geometry.axis, v);
          // Rays within a pixel and a half of the silhouette are its antialiased edge, counted apart.
          if (Math.abs(Math.acos(Math.min(1, c)) - geometry.alpha) < 1.5 * pixelRad) { if (coverage > 0) edge++; continue; }
          const cpuCovered = c >= cosAlpha;
          if (coverage > 0 && !cpuCovered) { gpuOnly++; continue; }
          if (coverage <= 0 && cpuCovered) { cpuOnly++; continue; }
          if (coverage < 0.999) continue;
          const drawn = [directions[i * 4], directions[i * 4 + 1], directions[i * 4 + 2]];
          const gpuRay = M.normalize([rays[i * 4], rays[i * 4 + 1], rays[i * 4 + 2]]);
          const mapped = M.flatWindowDirection(geometry, gpuRay, previewHalf);
          if (mapped) {
            const deg = M.angleDeg(M.mulMat3(ctx.content, mapped), drawn);
            mapping.push(deg);
            if (deg > worst.deg) worst = { deg, x: col, y: row };
          }
          endToEnd.push(M.angleDeg(M.mulMat3(ctx.content, M.flatWindowDirection(geometry, v, previewHalf)), drawn));
          rayErrors.push(M.angleDeg(v, gpuRay));
        }
      }
    }
    const summarise = values => {
      values.sort((a, b) => a - b);
      return values.length ? { pixels: values.length, maxDeg: values[values.length - 1], meanDeg: values.reduce((sum, e) => sum + e, 0) / values.length, p99Deg: values[Math.floor((values.length - 1) * 0.99)] } : { pixels: 0, maxDeg: 0, meanDeg: 0, p99Deg: 0 };
    };
    const contentPerPixelDeg = (gain > 0 ? pixelRad * gain : pixelRad) / DEG;
    return {
      segment, t,
      frameEye: frame.eye,
      distanceM: distance,
      effectiveRadiusM: orb.effectiveRadius,
      projectedDiameterPx: diameterPx,
      windowGain: gain,
      contentPerPixelDeg,
      viewport: { width, height },
      ray: { ...ray, orb: summarise(rayErrors) },
      interior: { ...summarise(mapping), maxAt: [worst.x, worst.y] },
      endToEnd: summarise(endToEnd),
      coverage: { edgePixels: edge, gpuOnlyPixels: gpuOnly, cpuOnlyPixels: cpuOnly, drawnOutsideOrbPixels: outside },
    };
  }

  /**
   * The entered panorama as drawn: every fourth pixel's image direction,
   * against the CPU's, which inside the sphere is the view ray itself turned
   * into the image by the panorama's content rotation.
   */
  async function probeImmersion(capture, pose) {
    const renderer = T.renderer;
    const content = M.contentMatrix(M.enuFrame(capture.longitudeDeg, capture.latitudeDeg), pose);
    const { width, height, outputs, frame } = await readProbe({ immersion: true }, ["ray", "direction"]);
    const data = outputs.direction;
    const ray = analyseRay(width, height, outputs.ray, frame);
    const topDown = !ray || ray.order === "top-down";
    let max = 0, pixels = 0;
    for (let row = 0; row < height; row += 4) {
      for (let col = 0; col < width; col += 4) {
        const i = (topDown ? row : height - 1 - row) * width + col;
        const v = M.viewRay(frame.view, (col + 0.5) / width, (row + 0.5) / height);
        max = Math.max(max, M.angleDeg(M.mulMat3(content, v), [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]));
        pixels++;
      }
    }
    return { ray, pixels, maxDeg: max, viewport: { width, height } };
  }

  /** How far the globe camera is from a snapshot taken earlier. */
  function cameraDifference(before) {
    const now = runtime.captureNavigationSnapshot()?.camera;
    if (!before || !now) return null;
    return {
      centerM: M.length(M.sub([now.center.x, now.center.y, now.center.z], [before.center.x, before.center.y, before.center.z])),
      yawRad: Math.abs(now.yaw - before.yaw), pitchRad: Math.abs(now.pitch - before.pitch),
      radiusM: Math.abs(now.radius - before.radius), fovRad: Math.abs(now.fov - before.fov),
    };
  }

  /** Waits until the scene's status satisfies `test`, or `timeoutMs` passes. */
  async function until(test, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const s = T.scenes.handle()?.status;
      if (s && test(s)) return s;
      runtime.requestRender();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting; status ${JSON.stringify(T.scenes.handle()?.status?.phase)}, active ${T.scenes.handle()?.status?.active}`);
  }

  // ─── Colour samples ─────────────────────────────────────────────────
  const HYPOTHESES = {
    correct: d => d,
    mirrored: d => [-d[0], d[1], d[2]],
    "turned 90°": d => [d[1], -d[0], d[2]],
    "turned 180°": d => [-d[0], -d[1], d[2]],
    "turned 270°": d => [-d[1], d[0], d[2]],
  };

  /** Canvas points inside the orb, and where each hypothesis says they sample the source cube. */
  function colourSamples(stepCssPx) {
    const renderer = T.renderer;
    const frame = renderer.cameraFrame();
    const orb = renderer.inspectOrb(ctx.orbId, frame);
    const canvas = engine.getRenderingCanvas();
    const rect = canvas.getBoundingClientRect();
    const rel = M.sub(orb.marker, frame.eye);
    const geometry = M.orbGeometry(rel, orb.effectiveRadius);
    const previewHalf = (options_.previewFovDeg / 2) * DEG;
    const centre = renderer.project(geometry.axis, frame);
    if (!centre) {
      throw new Error(`The orb is not in view: axis·forward ${M.dot(geometry.axis, frame.view.forward).toFixed(4)}, `
        + `distance ${M.length(rel).toFixed(1)} m, canvas ${rect.width}×${rect.height}`);
    }
    const radiusCss = M.projectedDiameterPx(orb.effectiveRadius, M.length(rel), frame.view.verticalFovRad, rect.height) / 2;
    const samples = [];
    for (let dy = -radiusCss; dy <= radiusCss; dy += stepCssPx) {
      for (let dx = -radiusCss; dx <= radiusCss; dx += stepCssPx) {
        const x = centre.x + dx, y = centre.y + dy;
        const v = M.viewRay(frame.view, (x - rect.left) / rect.width, (y - rect.top) / rect.height);
        // Two pixels inside the silhouette, clear of its antialiased edge.
        if (Math.acos(Math.min(1, M.dot(geometry.axis, v))) > geometry.alpha * (1 - 4 / Math.max(8, 2 * radiusCss))) continue;
        const world = M.flatWindowDirection(geometry, v, previewHalf);
        if (!world) continue;
        const image = M.mulMat3(ctx.content, world);
        const lookups = {};
        for (const [name, turn] of Object.entries(HYPOTHESES)) lookups[name] = M.sourceCubeLookup(turn(image));
        samples.push({ x, y, lookups });
      }
    }
    return { centre, radiusCss, samples, devicePixelRatio: window.devicePixelRatio };
  }

  /** Waits for `count` rendered frames. */
  function frames(count) {
    return new Promise(resolve => {
      let left = count;
      const observer = scene.onAfterRenderObservable.add(() => {
        if (--left > 0) { runtime.requestRender(); return; }
        scene.onAfterRenderObservable.remove(observer);
        resolve();
      });
      runtime.requestRender();
    });
  }

  async function adapter() {
    const found = await navigator.gpu?.requestAdapter();
    const info = found?.info;
    return info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: Boolean(info.isFallbackAdapter ?? found.isFallbackAdapter) } : null;
  }

  const options_ = { previewFovDeg: 90 };
  window.__campus = {
    status, ready, prepare, pose, apply, settleMarker, probeImmersion, cameraDifference, until, runTrace, probeOrb, colourSamples, frames, adapter,
    configure(next) { Object.assign(options_, next); },
    // Frame intervals and sections from the runtime's profiler.
    profile: {
      start(traceFrames) {
        const session = runtime.frameProfile;
        session.configure({ windowFrames: Math.max(1, Math.min(36000, traceFrames)), traceFrames });
        session.setEnabled(true);
        session.profiler.reset();
      },
      stop() {
        const session = runtime.frameProfile;
        const result = { summary: session.profiler.summary(), trace: session.trace(), gpu: session.gpuStatus() };
        session.setEnabled(false);
        return result;
      },
    },
    streaming: () => ({ streaming: runtime.isStreamingTiles?.() ?? null, tiles: runtime.getTileMetrics?.() ?? null }),
    /**
     * The panorama's tab, whose close button is the way out, and its credit in
     * the HUD, as the browser lays them out, style sheets included.
     */
    hudChips() {
      const shown = element => Boolean(element) && getComputedStyle(element).display !== "none";
      const tab = [...document.querySelectorAll(".foss-earth-tab-button")].find(button => button.textContent.startsWith("360: "));
      const credits = document.querySelector("#sceneCreditsSlot");
      return { exit: shown(tab), exitText: tab?.textContent ?? null, credits: shown(credits) ? credits.querySelectorAll(".scene-credit-chip").length : 0 };
    },
    // Automatic map detail: what it changed, and holding the map at the detail asked for.
    detail: {
      changes: (sinceMs = 0) => detailChanges.filter(change => change.pageMs >= sinceMs),
      /**
       * With both switches off, automatic adjustment has no room, which returns
       * the map to the detail asked for at once. Returns how many levels coarser
       * it had made it.
       */
      hold() {
        const before = detailChanges.at(-1)?.to ?? 0;
        heldDetailSwitches ??= AUTO_DETAIL_IDS.map(id => T.settings.get(id));
        for (const id of AUTO_DETAIL_IDS) T.settings.set(id, false);
        if ((detailChanges.at(-1)?.to ?? 0) !== 0) throw new Error("Map detail did not return to the detail asked for.");
        return before;
      },
      release() {
        if (heldDetailSwitches) AUTO_DETAIL_IDS.forEach((id, i) => T.settings.set(id, heldDetailSwitches[i]));
        heldDetailSwitches = null;
      },
    },
  };
  return true;
})();
