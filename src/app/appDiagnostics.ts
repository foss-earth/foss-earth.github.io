/**
 * What the app records of a visit so that a fault can be looked into on a
 * device with no console (docs/diagnostics.md): every log line, console
 * warning, unhandled error, lost GPU device and 360 image entered becomes a
 * step of the visit's trail, which Settings → Diagnostics copies as a report
 * and the next visit reads when this one stopped without being closed.
 */
import { captureErrors, tapConsole, type CapturedError } from "../diagnostics/errorCapture";
import { buildReport, reportPage, type ReportSetting } from "../diagnostics/report";
import { createSessionTrail, describePreviousVisit, TRAIL_STEPS_DEFAULT, type PreviousVisit, type SessionTrail, type TrailEnvironment } from "../diagnostics/sessionTrail";
import type { RendererSelection } from "../engine/babylon/createRendererMode";
import type { GameLog, GameLogEntry, GameLogLine } from "../log/createGameLog";
import type { SceneControllerState } from "../scenes/sceneController";
import type { SettingsRegistry } from "../settings/registry";
import { formatValue } from "../settings/values";

export const TRAIL_KEPT = "diagnostics.trail";
export const TRAIL_STEPS = "diagnostics.trailSteps";

/** A provenance as the report words it. */
const FROM: Record<string, string> = { user: "saved on this device", url: "from the address", preset: "from a preset", host: "set by the app" };

/** Every parameter that someone or something set: what makes this visit differ from a first one. A secret says only whether it is set. */
export function settingsNotAtDefaults(settings: SettingsRegistry): ReportSetting[] {
  const changed: ReportSetting[] = [];
  for (const spec of settings.list()) {
    const state = settings.inspect(spec.id);
    const from = FROM[state.provenance];
    if (from) changed.push({ id: spec.id, value: formatValue(spec, state.value, state.choices), from, defaultValue: formatValue(spec, state.defaultValue, state.choices) });
  }
  return changed;
}

export interface AppDiagnosticsOptions {
  /** The app's log. The diagnostics' own `log` prints to it and records each line. */
  log: GameLog;
  settings: SettingsRegistry;
  identity: { build: string; source: string; bundle: string };
  /** For tests: the browser as the trail uses it. */
  trailEnvironment?: TrailEnvironment;
  /** For tests: where errors, the console, visibility and leaving are heard. */
  page?: Pick<Window, "addEventListener" | "removeEventListener">;
  console?: Pick<Console, "warn" | "error">;
}

/** What of the renderer the diagnostics read; BabylonRuntime gives it. */
export interface DiagnosedRuntime {
  renderer: Pick<RendererSelection, "requested" | "mode" | "fallbackReason"> & { engine: { getInfo?(): { vendor: string; renderer: string; version: string } } };
  onDeviceLost(listener: () => void): () => void;
  onDeviceRestored(listener: () => void): () => void;
}

export interface AppDiagnostics {
  /** Prints to the app's log, and adds each line to the trail. */
  log: GameLog;
  trail: SessionTrail;
  attachRuntime(runtime: DiagnosedRuntime): void;
  /** Call with each state of the scene controller. */
  sceneChanged(state: SceneControllerState): void;
  /** More lines for the report, such as what of the app is kept on the device. */
  addState(read: () => Promise<string | null> | string | null): void;
  report(): Promise<string>;
  previous(): Promise<PreviousVisit | null>;
  destroy(): void;
}

const ICON: Record<string, string> = { info: "›", progress: "›", success: "✓", warning: "!", error: "✕" };

export function startAppDiagnostics(options: AppDiagnosticsOptions): AppDiagnostics {
  const { settings, identity } = options;
  const page = options.page ?? window;
  let runtime: DiagnosedRuntime | null = null;
  let lost = 0;
  let scene: SceneControllerState | null = null;
  const stateReaders: (() => Promise<string | null> | string | null)[] = [];
  const stops: (() => void)[] = [];

  const trail = createSessionTrail({
    app: () => `Build ${identity.build}, bundle ${identity.bundle}, renderer ${runtime?.renderer.mode ?? "not started"}.`,
    kept: () => settings.get(TRAIL_KEPT) !== false,
    limit: () => { const steps = settings.get(TRAIL_STEPS); return typeof steps === "number" ? steps : TRAIL_STEPS_DEFAULT; },
    ...(options.trailEnvironment ? { environment: options.trailEnvironment } : {}),
  });
  stops.push(settings.watch(TRAIL_KEPT, () => trail.refresh()));

  // The log's lines are the visit's story: each is a step, and so is a line that changes its tone, as a download that ends.
  // A warning or an error may come again and again, as a tile that fails does: those are troubles, counted by kind.
  const logStep = (entry: GameLogEntry): void => {
    const text = `${ICON[entry.tone ?? "info"]} ${entry.text}`;
    if (entry.tone === "warning" || entry.tone === "error") trail.trouble(text);
    else trail.step(text);
  };
  const log: GameLog = {
    ...options.log,
    get element() { return options.log.element; },
    print(entry) {
      logStep(entry);
      const line = options.log.print(entry);
      let tone = entry.tone ?? "info";
      const recording: GameLogLine = {
        ...line,
        update(next) {
          const nextTone = next.tone ?? "info";
          // Progress moving on is not a step; its end is.
          if (nextTone !== tone || nextTone !== "progress") logStep(next);
          tone = nextTone;
          line.update(next);
        },
      };
      return recording;
    },
  };

  trail.step(`Opened ${reportPage(typeof location === "undefined" ? "" : location.href)}; build ${identity.build}, bundle ${identity.bundle}`);

  // An error nothing handled: one log line each, counted when it comes again.
  const errors = new Map<string, { error: CapturedError; count: number; line: GameLogLine }>();
  const errorText = (error: CapturedError, count: number): string =>
    `The app met an error it did not handle${count > 1 ? `, ${count} times` : ""}: ${error.message}${error.where ? ` (${error.where})` : ""}. Settings → Diagnostics has a report to copy.`;
  stops.push(captureErrors(page, error => {
    const key = `${error.message} ${error.where ?? ""}`;
    trail.trouble(`Unhandled ${error.kind}: ${error.message}${error.where ? ` at ${error.where}` : ""}`);
    const seen = errors.get(key);
    if (!seen) {
      errors.set(key, { error, count: 1, line: options.log.print({ text: errorText(error, 1), tone: "error" }) });
      return;
    }
    seen.count += 1;
    // An error every frame must not redraw the log every frame: the line is updated as its count doubles.
    if ((seen.count & (seen.count - 1)) === 0) seen.line.update({ text: errorText(error, seen.count), tone: "error" });
  }));
  // The console is where the renderer reports a refused shader or a GPU error. It stays out of the log, which is for the person.
  stops.push(tapConsole(options.console ?? console, (level, text) => trail.trouble(`console.${level}: ${text}`)));

  const onVisibility = (): void => {
    const hidden = typeof document !== "undefined" && document.hidden;
    trail.step(hidden ? "The page was hidden" : "The page was shown again");
    trail.setHidden(hidden);
  };
  const onPageHide = (): void => trail.setClosed(true);
  const onPageShow = (event: Event): void => { if ((event as PageTransitionEvent).persisted) trail.setClosed(false); };
  const visibilityTarget = typeof document === "undefined" ? null : document;
  visibilityTarget?.addEventListener("visibilitychange", onVisibility);
  page.addEventListener("pagehide", onPageHide);
  page.addEventListener("pageshow", onPageShow);
  stops.push(() => {
    visibilityTarget?.removeEventListener("visibilitychange", onVisibility);
    page.removeEventListener("pagehide", onPageHide);
    page.removeEventListener("pageshow", onPageShow);
  });

  // A visit that stopped while it was shown is worth a line; one let go while hidden is what browsers do, and is in the report.
  const previous = trail.previous();
  void previous.then(visit => {
    if (visit?.ended === "unexpected") log.print({ text: `${describePreviousVisit(visit)}. Settings → Diagnostics has a report to copy.`, tone: "warning" });
  }, () => {});

  /** The GPU as the renderer names it: WebGL's vendor, renderer and version strings, or WebGPU's adapter. */
  const driverOf = (): string | null => {
    try {
      const info = runtime?.renderer.engine.getInfo?.();
      return info ? [info.vendor, info.renderer, info.version].filter(Boolean).join(", ") || null : null;
    } catch { return null; }
  };

  let sceneKey = "";
  let inside: string | null = null;

  return {
    log,
    trail,
    attachRuntime(next) {
      runtime = next;
      const { renderer } = next;
      trail.step(`Renderer ${renderer.mode} (asked for ${renderer.requested})${renderer.fallbackReason ? `; fell back: ${renderer.fallbackReason}` : ""}; ${driverOf() ?? "GPU not named"}`);
      // The record names the renderer from now on.
      trail.refresh();
      stops.push(next.onDeviceLost(() => {
        lost += 1;
        log.print({ text: "The GPU stopped drawing for this page: the browser took its device away. The picture returns if the browser gives it back; reloading the page starts again.", tone: "warning" });
      }));
      stops.push(next.onDeviceRestored(() => {
        log.print({ text: "The GPU is drawing for this page again.", tone: "success" });
      }));
    },
    sceneChanged(state) {
      scene = state;
      const status = state.status;
      const key = status ? `${status.sceneId} ${status.revision}` : "";
      if (key !== sceneKey) {
        sceneKey = key;
        inside = null;
        if (status) trail.step(`Scene ${status.sceneId}, revision ${status.revision}: ${status.entries.length} 360 images`);
      }
      const active = status?.active ?? null;
      if (active !== inside) {
        inside = active;
        trail.step(active ? `Inside the 360 image ${active}` : "Back on the map");
      }
      trail.setState(status ? `scene ${status.sceneId}, revision ${status.revision}, ${active ? `inside the 360 image ${active}` : "on the map"}` : "");
    },
    addState(read) { stateReaders.push(read); },
    previous: () => previous,
    async report() {
      const context = settings.getDeviceContext();
      const status = scene?.status ?? null;
      const state: string[] = [
        status
          ? `Scene: ${status.sceneId}, revision ${status.revision}, ${status.entries.length} 360 images, ${status.phase}${status.active ? `, inside ${status.active}` : ""}; ${status.warnings.length} warnings${status.lastError ? `; last error: ${status.lastError}` : ""}`
          : scene?.loading ? `Scene: loading ${reportPage(scene.loading)}`
            : scene?.errors.length ? `Scene: not loaded, ${scene.errors.length} problems; the first: ${scene.errors[0].path}: ${scene.errors[0].message}` : "Scene: none",
      ];
      for (const read of stateReaders) {
        const line = await Promise.resolve().then(read).catch(() => null);
        if (line) state.push(line);
      }
      return buildReport({
        at: new Date(),
        page: reportPage(location.href),
        build: identity.build,
        source: identity.source,
        bundle: identity.bundle,
        userAgent: navigator.userAgent,
        screen: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, touch: context.touch },
        device: { cores: context.hardwareConcurrency, memoryGiB: context.deviceMemoryGiB },
        renderer: {
          asked: runtime?.renderer.requested ?? "not started", mode: runtime?.renderer.mode ?? "not started", driver: driverOf(),
          maxTextureSize: context.maxTextureSize, fallbackReason: runtime?.renderer.fallbackReason ?? null, lost,
        },
        state,
        settings: settingsNotAtDefaults(settings),
        steps: trail.steps(),
        errors: [...errors.values()].map(({ error, count }) => ({ ...error, count })),
        previous: await previous.catch(() => null),
      });
    },
    destroy() {
      for (const stop of stops.splice(0)) stop();
      trail.dispose();
    },
  };
}
