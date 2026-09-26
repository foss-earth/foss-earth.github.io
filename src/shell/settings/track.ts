/**
 * One track for every continuous control: a value track (one thumb), a range
 * track (two thumbs, the outside dimmed), and the detail track (two ends, a
 * default and host markers). Thumbs are native range inputs stacked on one
 * track, so each keeps keyboard steps and an accessible value; only their
 * thumbs take the pointer. Positions are in the track's own space (a value, or
 * its log2), increasing to the right.
 */

export type TrackRamp = "detail" | "neutral";

export interface TrackThumb {
  id: string;
  /** "end": a range's end. "value": a value track's thumb. "default": a saved default. "marker": a host's value. */
  role: "end" | "value" | "default" | "marker";
  position: number;
  ariaLabel: string;
  ariaValueText: string;
  /** A marker's colour; other roles take the ramp's colour at their position. */
  colour?: string;
  hollow?: boolean;
  /** Not draggable: drawn as a tick instead of a thumb. */
  fixed?: boolean;
  disabled?: boolean;
  /** Kept in place but not shown, such as a default marked only by the tick. */
  hidden?: boolean;
  /** Shown beside a marker. */
  label?: string;
}

export interface TrackFrame {
  min: number;
  max: number;
  step: number;
  thumbs: readonly TrackThumb[];
  /** The selected part of the scale; the rest is dimmed. */
  range?: { low: number; high: number } | null;
  /** A tick for the default. */
  tick?: number | null;
  /** Striped: allowed by the range but refused by a host's requirement. */
  stripe?: { low: number; high: number } | null;
  disabled?: boolean;
}

export interface TrackHandle {
  element: HTMLElement;
  render(frame: TrackFrame): void;
  /** True while the pointer holds a thumb: callers keep their values out of its way. */
  isDragging(): boolean;
  destroy(): void;
}

export interface TrackOptions {
  ariaLabel: string;
  /** Extra classes for the track element. */
  className?: string;
  ramp: TrackRamp;
  /** A thumb moved; the caller constrains the position and renders again. */
  onInput(id: string, position: number): void;
  /** A drag ended. */
  onCommit?(id: string): void;
}

// The HUD rail's colours, finer to coarser: the same position is the same colour everywhere.
const DETAIL_COLOURS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [0x46, 0xdb, 0x8f]],
  [0.55, [0xf6, 0xd3, 0x65]],
  [1, [0xff, 0x6b, 0x6b]],
];

export function detailColour(fraction: number): string {
  const t = Math.min(1, Math.max(0, fraction));
  let index = 1;
  while (index < DETAIL_COLOURS.length - 1 && t > DETAIL_COLOURS[index][0]) index += 1;
  const [t0, c0] = DETAIL_COLOURS[index - 1];
  const [t1, c1] = DETAIL_COLOURS[index];
  const u = (t - t0) / (t1 - t0);
  return `rgb(${c0.map((value, channel) => Math.round(value + (c1[channel] - value) * u)).join(", ")})`;
}

// Where a thumb's centre sits, as a CSS length along the track.
const along = (fraction: number): string => `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${fraction})`;

export function createTrack(options: TrackOptions): TrackHandle {
  const element = document.createElement("div");
  element.className = `foss-earth-track foss-earth-track--${options.ramp}${options.className ? ` ${options.className}` : ""}`;
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", options.ariaLabel);
  const colours = document.createElement("span");
  colours.className = "foss-earth-track__colours";
  colours.setAttribute("aria-hidden", "true");
  const shadeLow = document.createElement("span");
  shadeLow.className = "foss-earth-track__shade foss-earth-track__shade--low";
  shadeLow.setAttribute("aria-hidden", "true");
  const shadeHigh = document.createElement("span");
  shadeHigh.className = "foss-earth-track__shade foss-earth-track__shade--high";
  shadeHigh.setAttribute("aria-hidden", "true");
  const stripe = document.createElement("span");
  stripe.className = "foss-earth-track__stripe";
  stripe.setAttribute("aria-hidden", "true");
  const tick = document.createElement("span");
  tick.className = "foss-earth-track__tick";
  tick.setAttribute("aria-hidden", "true");
  element.append(colours, shadeLow, shadeHigh, stripe, tick);

  const inputs = new Map<string, HTMLInputElement>();
  const markerTicks = new Map<string, HTMLElement>();
  let dragging: HTMLInputElement | null = null;
  let lastMoved: string | null = null;

  const onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const id = input.dataset.thumb;
    if (!id) return;
    lastMoved = id;
    options.onInput(id, Number(input.value));
  };
  const onPointerDown = (event: Event): void => { dragging = event.target as HTMLInputElement; };
  const onPointerUp = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (dragging === input) dragging = null;
    if (input.dataset.thumb) options.onCommit?.(input.dataset.thumb);
  };

  function thumbInput(thumb: TrackThumb): HTMLInputElement {
    let input = inputs.get(thumb.id);
    if (!input) {
      input = document.createElement("input");
      input.type = "range";
      input.dataset.thumb = thumb.id;
      input.addEventListener("input", onInput);
      input.addEventListener("pointerdown", onPointerDown);
      input.addEventListener("pointerup", onPointerUp);
      input.addEventListener("pointercancel", onPointerUp);
      input.addEventListener("change", onPointerUp);
      element.append(input);
      inputs.set(thumb.id, input);
    }
    return input;
  }

  function markerTick(thumb: TrackThumb): HTMLElement {
    let mark = markerTicks.get(thumb.id);
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "foss-earth-track__marker-tick";
      const text = document.createElement("span");
      text.className = "foss-earth-track__marker-label";
      mark.append(text);
      element.append(mark);
      markerTicks.set(thumb.id, mark);
    }
    return mark;
  }

  return {
    element,
    isDragging: () => dragging !== null,
    render(frame) {
      const span = frame.max - frame.min;
      const fraction = (position: number): number => (span > 0 ? Math.min(1, Math.max(0, (position - frame.min) / span)) : 0.5);
      const colourAt = (position: number): string => options.ramp === "detail" ? detailColour(fraction(position)) : "var(--globe-accent, #60a5fa)";
      element.classList.toggle("is-disabled", Boolean(frame.disabled));

      shadeLow.hidden = !frame.range;
      shadeHigh.hidden = !frame.range;
      if (frame.range) {
        shadeLow.style.right = `calc(100% - ${along(fraction(frame.range.low))})`;
        shadeHigh.style.left = along(fraction(frame.range.high));
      }
      stripe.hidden = !frame.stripe || frame.stripe.high - frame.stripe.low <= 0;
      if (frame.stripe) {
        stripe.style.left = along(fraction(frame.stripe.low));
        stripe.style.right = `calc(100% - ${along(fraction(frame.stripe.high))})`;
      }
      tick.hidden = frame.tick === null || frame.tick === undefined;
      if (frame.tick !== null && frame.tick !== undefined) tick.style.left = along(fraction(frame.tick));

      const seen = new Set<string>();
      const ends = frame.thumbs.filter(thumb => thumb.role === "end");
      const endsTogether = ends.length === 2 && Math.abs(ends[0].position - ends[1].position) < 1e-9;
      for (const thumb of frame.thumbs) {
        seen.add(thumb.id);
        const colour = thumb.colour ?? colourAt(thumb.position);
        if (thumb.role === "marker") {
          const mark = markerTick(thumb);
          mark.style.left = along(fraction(thumb.position));
          mark.style.setProperty("--marker-colour", colour);
          mark.classList.toggle("is-hollow", Boolean(thumb.hollow));
          mark.title = `${thumb.label ?? thumb.ariaLabel}: ${thumb.ariaValueText}`;
          (mark.firstChild as HTMLElement).textContent = thumb.label ?? "";
        }
        if (thumb.fixed) {
          inputs.get(thumb.id)?.remove();
          inputs.delete(thumb.id);
          continue;
        }
        const input = thumbInput(thumb);
        input.className = `foss-earth-track__thumb foss-earth-track__thumb--${thumb.role}${thumb.hollow ? " is-hollow" : ""}`;
        input.min = String(frame.min);
        input.max = String(frame.max);
        input.step = String(frame.step);
        if (dragging !== input) input.value = String(thumb.position);
        input.disabled = Boolean(frame.disabled || thumb.disabled);
        input.hidden = Boolean(thumb.hidden);
        input.setAttribute("aria-label", thumb.ariaLabel);
        input.setAttribute("aria-valuetext", thumb.ariaValueText);
        input.style.setProperty("--thumb-colour", colour);
        let z = thumb.role === "default" ? 5 : thumb.role === "marker" ? 4 : 2;
        // Stacked ends: keep on top the one that can still move.
        if (thumb.role === "end" && ends.length === 2) {
          const top = endsTogether ? (fraction(thumb.position) > 0.5 ? ends[0].id : ends[1].id) : lastMoved;
          z = thumb.id === top ? 3 : 2;
        }
        input.style.zIndex = String(z);
      }
      for (const [id, input] of inputs) {
        if (!seen.has(id)) { input.remove(); inputs.delete(id); }
      }
      for (const [id, mark] of markerTicks) {
        if (!seen.has(id)) { mark.remove(); markerTicks.delete(id); }
      }
    },
    destroy() {
      for (const input of inputs.values()) {
        input.removeEventListener("input", onInput);
        input.removeEventListener("pointerdown", onPointerDown);
        input.removeEventListener("pointerup", onPointerUp);
        input.removeEventListener("pointercancel", onPointerUp);
        input.removeEventListener("change", onPointerUp);
      }
      element.remove();
    },
  };
}
