# Automatic detail adjustment coarsens the map to its lowest detail

Status: open. Worked around on 2026-09-27 by turning the adjustment off by
default (e942328).

## What happens

With either switch in Map → Automatic adjustment on and the frame time goal
left at "The display's refresh interval, measured", the log fills with:

> Map detail coarsened 0.25 levels to hold the frame time: frames averaged
> 16.7 ms against a 2.0 ms goal.

It repeats every 5 s until terrain and 2D imagery reach the coarse end of their
ranges, and it never refines again. Seen in 0sfs.

## Why

[`createAutoDetailController`](../src/terrain/autoDetail.ts) measures the goal
in `observe()` as the shortest interval between frames seen so far, ignoring
anything under 2 ms. That value can only go down. Once a single pair of frames
lands 2 ms apart, the goal is 2.0 ms for the rest of the session:

- Windows count as slow above 1.2 × 2.0 = 2.4 ms. A 60 Hz display gives
  16.7 ms, so every window is slow, and it steps a quarter level down every
  `map.auto.interval` (5 s).
- Windows count as fast below 0.84 × 2.0 = 1.7 ms, which no frame meets, so it
  never steps back.

The interval comes from `reportFrame(frameNow, frameNow - lastRasterFrameAt, …)`
in the scheduler's tick in
[`createBabylonRuntime`](../src/engine/babylon/createBabylonRuntime.ts), where
`frameNow` is `performance.now()` at the start of the tick. That is when this
callback started running, not when the display's frame began. A tick that starts
late, because the main thread was busy, followed by one on time, gives a short
interval. This is the likely source of the 2 ms; it has not been confirmed.

## Until it is fixed

- Both switches, `map.auto.terrainDetail` and `map.auto.imageryDetail`, default
  to off.
- The Smooth motion preset and `?terrainQuality=auto` still turn them on, and
  still hit this bug.
- Setting `map.auto.frameTimeGoal` to a number, such as 16.7 ms, skips the
  measurement, so the adjustment works as intended.

## Fixing it

1. Measure frame intervals from the `requestAnimationFrame` timestamp.
   [`createRenderScheduler`](../src/engine/babylon/renderScheduler.ts) already
   receives it as `tick(time)` but calls `options.tick()` without it. The
   timestamp is the same for every callback in a frame, so intervals between
   them should be whole display frames. Check that in Chrome, Safari and
   Firefox.
2. Estimate the refresh interval so one outlier cannot set it, and so it can
   rise again: for example, the median interval of recent windows, or a low
   percentile rather than the lowest value ever seen.
3. Add a case to [autoDetail.test.ts](../src/terrain/autoDetail.test.ts): steady
   16.7 ms frames with one 2 ms interval among them must not coarsen.
4. Then decide whether the switches go back to on by default. If they do, change
   the defaults and their reasons in
   [catalogue/auto.ts](../src/settings/catalogue/auto.ts) and the Automatic
   adjustment entry in [docs/proposals/settings.md](../docs/proposals/settings.md).
