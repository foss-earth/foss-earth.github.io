// @vitest-environment jsdom
import { Observable, type AbstractEngine, type Scene } from "@babylonjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameProfiler } from "../perf/frameProfiler";
import { bindFrameProfileSettings, createFrameProfileSession } from "../perf/frameProfileSession";
import { FRAME_PROFILING_IDS, frameProfilingParameters } from "../settings/catalogue/profiling";
import { createSettingsRegistry } from "../settings/registry";
import { createFrameBudgetPanel } from "./frameBudgetPanel";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function setup() {
  const observable = () => new Observable<Scene>();
  const scene = {
    onBeforeAnimationsObservable: observable(), onAfterRenderObservable: observable(),
    onBeforeActiveMeshesEvaluationObservable: observable(), onAfterActiveMeshesEvaluationObservable: observable(),
    onBeforeRenderTargetsRenderObservable: observable(), onAfterRenderTargetsRenderObservable: observable(),
    onBeforeDrawPhaseObservable: observable(), onAfterDrawPhaseObservable: observable(),
  } as unknown as Scene;
  let time = 0;
  const profiler = createFrameProfiler({ now: () => time });
  const session = createFrameProfileSession({ scene, engine: { getCaps: () => ({}) } as unknown as AbstractEngine, profiler });
  const settings = createSettingsRegistry({ storage: null });
  settings.register(frameProfilingParameters({ tab: "renderer", section: "performance" }));
  const unbind = bindFrameProfileSettings(settings, session);
  const frames = (count: number, work: number) => {
    for (let frame = 0; frame < count; frame++) {
      session.frame(time);
      const started = profiler.clock();
      time += work;
      profiler.add("map/raster tiles", started);
      time += 16 - work;
    }
    session.frame(time);
  };
  return { session, settings, unbind, frames };
}

describe("frame budget panel", () => {
  it("is the home of the profiling controls, and says what is not measured rather than 0", () => {
    const { session, settings, unbind } = setup();
    const panel = createFrameBudgetPanel({ session, settings });
    document.body.append(panel.element);
    const ids = [...panel.element.querySelectorAll<HTMLElement>("[data-parameter]")].map(node => node.dataset.parameter);
    for (const id of Object.values(FRAME_PROFILING_IDS)) expect(ids).toContain(id);
    const status = panel.element.querySelector(".foss-earth-frame-budget__status")!.textContent!;
    expect(status).toContain("Not measuring");
    expect(status).toContain("GPU time: not available");
    expect(panel.element.querySelector<HTMLElement>(".foss-earth-frame-budget__results")!.hidden).toBe(true);
    panel.destroy();
    unbind();
  });

  it("shows each section's mean, p95, p99 and share once measuring, and saves a trace only when one is kept", () => {
    vi.useFakeTimers();
    const { session, settings, unbind, frames } = setup();
    const panel = createFrameBudgetPanel({ session, settings, unmeasured: "the browser's own work" });
    document.body.append(panel.element);
    settings.set(FRAME_PROFILING_IDS.enabled, true);
    frames(10, 4);
    vi.advanceTimersByTime(500);
    const results = panel.element.querySelector<HTMLElement>(".foss-earth-frame-budget__results")!;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain("the other");
    expect(results.textContent).toContain("the browser's own work");
    const headings = [...panel.element.querySelectorAll("thead th")].map(node => node.textContent);
    expect(headings).toEqual(["Section", "Mean ms", "p95 ms", "p99 ms", "Max ms", "Of frame"]);
    const rows = [...panel.element.querySelectorAll("tbody tr")].map(row => row.querySelector("th")!.textContent);
    expect(rows).toEqual(["map", "raster tiles"]);
    const save = [...panel.element.querySelectorAll("button")].find(button => button.textContent === "Save trace")!;
    expect(save.hidden).toBe(true);
    settings.set(FRAME_PROFILING_IDS.traceFrames, 100);
    frames(3, 4);
    panel.refresh();
    expect(save.hidden).toBe(false);
    expect(panel.element.querySelector(".foss-earth-frame-budget__status")!.textContent).toMatch(/trace keeps 3 of 100 frames/);
    panel.destroy();
    unbind();
    session.dispose();
  });

  it("shows a value set elsewhere, such as by a script", () => {
    const { session, settings, unbind } = setup();
    const panel = createFrameBudgetPanel({ session, settings });
    document.body.append(panel.element);
    const measure = panel.element.querySelector<HTMLInputElement>(`[data-parameter="${FRAME_PROFILING_IDS.enabled}"] input`)!;
    expect(measure.checked).toBe(false);
    settings.set(FRAME_PROFILING_IDS.enabled, true);
    expect(measure.checked).toBe(true);
    panel.destroy();
    unbind();
    session.dispose();
  });

  it("stops summarising when measuring stops or the panel goes", () => {
    vi.useFakeTimers();
    const { session, settings, unbind } = setup();
    const summary = vi.spyOn(session.profiler, "summary");
    const panel = createFrameBudgetPanel({ session, settings });
    document.body.append(panel.element);
    settings.set(FRAME_PROFILING_IDS.enabled, true);
    summary.mockClear();
    vi.advanceTimersByTime(1000);
    expect(summary).toHaveBeenCalledTimes(2);
    settings.set(FRAME_PROFILING_IDS.enabled, false);
    summary.mockClear();
    vi.advanceTimersByTime(1000);
    expect(summary).not.toHaveBeenCalled();
    settings.set(FRAME_PROFILING_IDS.enabled, true);
    panel.destroy();
    summary.mockClear();
    vi.advanceTimersByTime(1000);
    expect(summary).not.toHaveBeenCalled();
    unbind();
  });
});
