import { Observable, type AbstractEngine, type Scene } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { createFrameProfiler, profileBabylonScene } from "./frameProfiler";

/** A profiler on a hand-driven clock. */
function manual(windowFrames = 10) {
  let time = 0;
  const profiler = createFrameProfiler({ windowFrames, enabled: true, now: () => time });
  return {
    profiler,
    at: (ms: number) => { time = ms; },
    /** Runs `ms` of work in the section, starting now. */
    work: (section: string, ms: number) => { const started = profiler.clock(); time += ms; profiler.add(section, started); },
  };
}

describe("frame profiler", () => {
  it("adds each section up per frame and holds it against the frame interval", () => {
    const t = manual();
    for (let frame = 0; frame <= 4; frame++) {
      t.at(frame * 16);
      t.profiler.frame();
      t.work("flight", 3);
      t.work("render", 5);
    }
    const summary = t.profiler.summary();
    expect(summary.frames).toBe(4);
    expect(summary.frame.meanMs).toBe(16);
    expect(summary.measuredMeanMs).toBe(8);
    const render = summary.sections.find(section => section.section === "render")!;
    expect(render.meanMs).toBe(5);
    expect(render.shareOfFrame).toBeCloseTo(5 / 16);
  });

  it("nests sections by path, counting only the top level against the frame", () => {
    const t = manual();
    for (let frame = 0; frame <= 2; frame++) {
      t.at(frame * 20);
      t.profiler.frame();
      const started = t.profiler.clock();
      t.work("flight/physics", 4);
      t.work("flight/hud", 1);
      t.profiler.add("flight", started);
    }
    const summary = t.profiler.summary();
    expect(summary.measuredMeanMs).toBe(5);
    expect(summary.sections.map(section => [section.section, section.depth])).toEqual([
      ["flight", 0], ["flight/physics", 1], ["flight/hud", 1],
    ]);
  });

  it("averages a section that runs on some frames only over every frame", () => {
    const t = manual();
    for (let frame = 0; frame <= 4; frame++) {
      t.at(frame * 10);
      t.profiler.frame();
      if (frame % 2 === 0) t.work("panels", 4);
    }
    const panels = t.profiler.summary().sections.find(section => section.section === "panels")!;
    expect(panels.meanMs).toBe(2);
    expect(panels.activeFrames).toBe(2);
  });

  it("keeps only the window", () => {
    const t = manual(3);
    for (let frame = 0; frame <= 6; frame++) {
      t.at(frame * 10);
      t.profiler.frame();
      t.work("tick", frame);
    }
    const tick = t.profiler.summary().sections[0];
    expect(t.profiler.summary().frames).toBe(3);
    expect(tick.maxMs).toBe(5);
    expect(tick.meanMs).toBe(4);
  });

  it("takes durations measured elsewhere, such as GPU timers", () => {
    const t = manual();
    t.at(0);
    t.profiler.frame();
    t.profiler.addDuration("gpu/globe", 2.5);
    t.at(16);
    t.profiler.frame();
    expect(t.profiler.summary().sections.map(section => [section.section, section.meanMs])).toEqual([
      ["gpu", 2.5], ["gpu/globe", 2.5],
    ]);
  });

  it("never adds GPU time to the frame, which it runs alongside", () => {
    const t = manual();
    t.at(0);
    t.profiler.frame();
    t.work("render", 4);
    t.profiler.addDuration("gpu/globe", 6);
    t.at(16);
    t.profiler.frame();
    expect(t.profiler.summary().measuredMeanMs).toBe(4);
  });

  it("does nothing while disabled, and starts a fresh window when enabled", () => {
    let time = 0;
    const profiler = createFrameProfiler({ now: () => time });
    expect(profiler.clock()).toBe(0);
    profiler.add("flight", 0);
    profiler.frame();
    expect(profiler.summary().sections).toEqual([]);
    profiler.enabled = true;
    profiler.frame();
    time = 16;
    profiler.add("flight", 10);
    expect(profiler.current("flight")).toBe(6);
    profiler.frame();
    expect(profiler.summary().frames).toBe(1);
  });

  it("reads a WebGPU engine's render-pass GPU time, and hands the timing back when done", () => {
    const counter = { total: 0, count: 0 };
    let timing = false;
    const engine = {
      get enableGPUTimingMeasurements() { return timing; },
      set enableGPUTimingMeasurements(on: boolean) { timing = on; },
      get gpuTimeInFrameForMainPass() { return timing ? { counter } : undefined; },
    } as unknown as AbstractEngine;
    const observable = () => new Observable<Scene>();
    const scene = {
      onBeforeAnimationsObservable: observable(), onAfterRenderObservable: observable(),
      onBeforeActiveMeshesEvaluationObservable: observable(), onAfterActiveMeshesEvaluationObservable: observable(),
      onBeforeRenderTargetsRenderObservable: observable(), onAfterRenderTargetsRenderObservable: observable(),
      onBeforeDrawPhaseObservable: observable(), onAfterDrawPhaseObservable: observable(),
    } as unknown as Scene;
    const t = manual();
    const stop = profileBabylonScene(t.profiler, scene, engine);
    const render = (at: number) => {
      scene.onAfterRenderObservable.notifyObservers(scene);
      t.at(at);
      t.profiler.frame();
    };
    render(0);
    expect(timing).toBe(true);
    // Two frames complete at 3 ms and 5 ms, and a third is still collecting passes.
    Object.assign(counter, { total: 8e6, count: 3 });
    render(16);
    render(32);
    expect(t.profiler.summary().sections.find(section => section.section === "gpu/globe")?.meanMs).toBe(4);
    stop();
    expect(timing).toBe(false);
  });
});
