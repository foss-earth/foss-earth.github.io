import type { FrameProfileSummary, FrameSectionStats } from "../perf/frameProfiler";
import type { FrameProfileSession, GpuTimingStatus } from "../perf/frameProfileSession";
import { getAppSettings } from "../settings/appSettings";
import { FRAME_PROFILING_IDS } from "../settings/catalogue/profiling";
import type { SettingsRegistry } from "../settings/registry";
import { createParameterControl, type ParameterControlHandle } from "./settings/controls";

export interface FrameBudgetPanelOptions {
  /** The runtime's `frameProfile`. */
  session: FrameProfileSession;
  /** Where `frameProfilingParameters` are registered; the app's when omitted. */
  settings?: SettingsRegistry;
  /** What frame time no section claims is, in this app: ends "the other 4.2 ms is …". */
  unmeasured?: string;
  /** Sentences under the table, such as what a host's sections leave out. */
  notes?: readonly string[];
  /** Parameters whose readings show beside the timings, such as memory in use. */
  readings?: readonly string[];
  /** Added to the root's class, for a host's styling. */
  className?: string;
  /** Name for a saved trace; "frame-trace" when omitted. */
  traceFileName?: string;
}

export interface FrameBudgetPanelHandle {
  element: HTMLElement;
  /** Summarises again now, as the timer does while it is shown. */
  refresh(): void;
  destroy(): void;
}

const BYTES_PER_KIB = 1024;
/** A row's indent per nesting level, and at the edge, in CSS px. */
const INDENT_PX = 12;
const EDGE_PX = 4;

function ms(value: number): string {
  return value >= 10 ? value.toFixed(1) : value >= 1 ? value.toFixed(2) : value.toFixed(3);
}

function percent(share: number): string {
  return `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const GPU_STATUS: Record<GpuTimingStatus | "off", string> = {
  unsupported: "GPU time: not available; this renderer cannot time GPU work, which needs WebGPU with timestamp queries",
  waiting: "GPU time: waiting for the first reading",
  measuring: "GPU time: measured per render pass, arriving a few frames late; copies and mipmaps are not included",
  off: "GPU time: available once measuring",
};

/**
 * The frame budget: its profiling controls, then where each frame's time
 * goes, section by section, with the frame interval's mean and percentiles.
 * It is the one home of the `renderer.profiling.*` parameters, so a host
 * shows it once and draws those parameters nowhere else. CPU rows are the
 * page's JavaScript; GPU and background rows run alongside the frame and are
 * never added to it. A measurement not available says so rather than 0.
 */
export function createFrameBudgetPanel(options: FrameBudgetPanelOptions): FrameBudgetPanelHandle {
  const settings = options.settings ?? getAppSettings();
  const { session } = options;
  const element = el("div", `foss-earth-frame-budget-panel${options.className ? ` ${options.className}` : ""}`);
  const controlsRow = el("div", "foss-earth-choices");
  const controls = new Map<string, ParameterControlHandle>();
  for (const id of Object.values(FRAME_PROFILING_IDS)) {
    const control = createParameterControl(settings, id);
    controls.set(id, control);
    controlsRow.append(control.element);
  }
  // A value set elsewhere, such as a URL switch or a script, shows here too.
  const offControls = settings.subscribe(changed => {
    for (const id of changed) controls.get(id)?.update();
  });
  const status = el("p", "foss-earth-choices__note foss-earth-frame-budget__status");
  const overview = el("p", "foss-earth-choices__note");
  const table = el("table", "foss-earth-frame-budget");
  table.setAttribute("aria-label", "Frame budget");
  const head = el("thead");
  const headRow = el("tr");
  for (const label of ["Section", "Mean ms", "p95 ms", "p99 ms", "Max ms", "Of frame"]) headRow.append(el("th", undefined, label));
  head.append(headRow);
  const body = el("tbody");
  table.append(head, body);
  const readings = el("p", "foss-earth-choices__note");
  const notes = el("div", "foss-earth-choices");
  for (const text of options.notes ?? []) notes.append(el("p", "foss-earth-choices__note", text));
  const actions = el("div", "foss-earth-choices");
  const copy = el("button", "foss-earth-choice foss-earth-parameter__action", "Copy frame budget");
  copy.type = "button";
  const save = el("button", "foss-earth-choice foss-earth-parameter__action", "Save trace");
  save.type = "button";
  actions.append(copy, save);
  const results = el("div", "foss-earth-frame-budget__results");
  // A narrow panel scrolls the table, not the page.
  const scroller = el("div", "foss-earth-frame-budget__scroll");
  scroller.append(table);
  results.append(overview, scroller, readings, notes, actions);
  element.append(controlsRow, status, results);

  const row = (section: FrameSectionStats, indent: number): HTMLTableRowElement => {
    const tr = el("tr");
    const name = el("th", undefined, section.name);
    name.scope = "row";
    name.style.paddingLeft = `${indent}px`;
    tr.append(name);
    for (const value of [section.meanMs, section.p95Ms, section.p99Ms, section.maxMs]) tr.append(el("td", undefined, ms(value)));
    tr.append(el("td", undefined, percent(section.shareOfFrame)));
    return tr;
  };
  const groupRow = (label: string): HTMLTableRowElement => {
    const tr = el("tr", "foss-earth-frame-budget__group");
    const th = el("th", undefined, label);
    th.scope = "row";
    th.colSpan = 6;
    tr.append(th);
    return tr;
  };
  const describe = (summary: FrameProfileSummary): string => {
    const unmeasured = Math.max(0, summary.frame.meanMs - summary.measuredMeanMs);
    const fps = summary.frame.meanMs > 0 ? `${(1000 / summary.frame.meanMs).toFixed(0)} fps` : "no rate yet";
    return `Last ${summary.frames} frames: ${ms(summary.frame.meanMs)} ms apart on average (${fps}), `
      + `p95 ${ms(summary.frame.p95Ms)} ms, p99 ${ms(summary.frame.p99Ms)} ms, longest ${ms(summary.frame.maxMs)} ms. `
      + `Measured work ${ms(summary.measuredMeanMs)} ms; the other ${ms(unmeasured)} ms is `
      + `${options.unmeasured ?? "work nobody has timed, the browser's own, and waiting for the display"}.`;
  };

  const refresh = (): void => {
    const enabled = session.enabled;
    const summary = enabled ? session.profiler.summary() : null;
    const trace = session.trace();
    const traceText = trace.capacity > 0
      ? `trace keeps ${trace.frames.length} of ${trace.capacity} frames (${(trace.bytes / BYTES_PER_KIB).toFixed(0)} KiB)`
      : "no trace kept";
    status.textContent = enabled
      ? `Collected ${summary!.frames} of ${session.profiler.windowFrames} frames; ${traceText}. ${GPU_STATUS[session.gpuStatus()]}.`
      : `Not measuring. ${GPU_STATUS[session.gpuTimed() ? "off" : "unsupported"]}.`;
    save.hidden = trace.frames.length === 0;
    results.hidden = !summary || summary.frames === 0;
    if (!summary || summary.frames === 0) {
      if (enabled) status.textContent += " Collecting frames…";
      return;
    }
    overview.textContent = describe(summary);
    const cpu = summary.sections.filter(section => !section.section.startsWith("gpu") && !section.section.startsWith("background"));
    const gpu = summary.sections.filter(section => section.section.startsWith("gpu/"));
    const background = summary.sections.filter(section => section.section.startsWith("background/"));
    const rows: HTMLTableRowElement[] = cpu.map(section => row(section, section.depth * INDENT_PX + EDGE_PX));
    if (gpu.length > 0) rows.push(groupRow("GPU, alongside the frame"), ...gpu.map(section => row(section, INDENT_PX + EDGE_PX)));
    if (background.length > 0) rows.push(groupRow("Off the main thread, alongside the frame"), ...background.map(section => row(section, INDENT_PX + EDGE_PX)));
    body.replaceChildren(...rows);
    const lines = (options.readings ?? [])
      .map(id => [settings.spec(id)?.label, settings.getReading(id)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
      .map(([label, value]) => `${label}: ${value}`);
    readings.textContent = lines.join(" · ");
    readings.hidden = lines.length === 0;
  };

  const onCopy = (): void => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(JSON.stringify(session.profiler.summary(), null, 2));
  };
  const onSave = (): void => {
    const blob = new Blob([JSON.stringify(session.trace(), null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = `${options.traceFileName ?? "frame-trace"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  copy.addEventListener("click", onCopy);
  save.addEventListener("click", onSave);

  // Summarised again only while measuring and while the panel can be seen.
  let timer: number | null = null;
  const schedule = (): void => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    refresh();
    if (!session.enabled) return;
    const period = settings.get(FRAME_PROFILING_IDS.refreshMs);
    timer = window.setInterval(() => {
      if (!element.isConnected || element.closest("details")?.open === false) return;
      refresh();
    }, typeof period === "number" ? period : 0);
  };
  schedule();
  const offSession = session.onChange(schedule);
  const offRefresh = settings.watch(FRAME_PROFILING_IDS.refreshMs, schedule);

  return {
    element,
    refresh,
    destroy() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      offSession();
      offRefresh();
      offControls();
      copy.removeEventListener("click", onCopy);
      save.removeEventListener("click", onSave);
      for (const control of controls.values()) control.destroy();
      element.remove();
    },
  };
}
