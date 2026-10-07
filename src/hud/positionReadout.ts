import {
  POSITION_ALTITUDE_ID,
  POSITION_ALTITUDE_UNIT_ID,
  POSITION_COORDINATE_LABELS_ID,
  type AltitudeReference,
  type AltitudeUnit,
  type CoordinateLabels,
} from "../settings/catalogue";
import type { SettingsRegistry } from "../settings/registry";

const SVG_NS = "http://www.w3.org/2000/svg";
const METERS_PER_FOOT = 0.3048;

export interface PositionReading {
  latDeg: number;
  lonDeg: number;
  /** Height above mean sea level, in metres. Left out, the readout shows no altitude. */
  altitudeMeters?: number;
  /** The ground's height above mean sea level directly below, in metres; null while no terrain there has loaded. */
  groundHeightMeters?: number | null;
  /** What follows the position, such as "h017° p71° z600m". */
  rest?: string;
}

export interface PositionReadoutHandle {
  update(reading: PositionReading): void;
  /** Whether the altitude shown needs `groundHeightMeters`: `interface.position.altitude` is above ground. */
  needsGroundHeight(): boolean;
  destroy(): void;
}

/** A length as the toolbar writes it: whole metres, then km and Mm as it grows. */
export function formatDistance(meters: number): string {
  if (meters >= 1_000_000) return `${(meters / 1_000_000).toFixed(1)}Mm`;
  if (meters >= 1_000) return `${(meters / 1_000).toFixed(0)}km`;
  return `${meters.toFixed(0)}m`;
}

/**
 * The altitude as the readout writes it, such as "1250m ASL" or "410ft AGL".
 * Above ground shows a dash while the ground's height is unknown. Metres stay
 * whole to 100 km, the range a height is read to the metre in.
 */
export function formatAltitude(altitudeMeters: number, groundHeightMeters: number | null, reference: AltitudeReference, unit: AltitudeUnit): string {
  const suffix = reference === "asl" ? "ASL" : "AGL";
  if (reference === "agl" && groundHeightMeters === null) return `\u2014${unit} ${suffix}`;
  const meters = altitudeMeters - (reference === "agl" ? groundHeightMeters! : 0);
  const value = unit === "ft" ? `${Math.round(meters / METERS_PER_FOOT)}ft`
    : Math.abs(meters) < 100_000 ? `${Math.round(meters)}m` : formatDistance(meters);
  return `${value} ${suffix}`;
}

function createIcon(build: (svg: SVGSVGElement) => void): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "hud-position__icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("aria-hidden", "true");
  const globe = document.createElementNS(SVG_NS, "circle");
  globe.setAttribute("cx", "12");
  globe.setAttribute("cy", "12");
  globe.setAttribute("r", "10");
  svg.append(globe);
  build(svg);
  return svg;
}

/** A globe with only its parallels: the equator and the circles 30° either side of it. */
export function createLatitudeIcon(): SVGSVGElement {
  return createIcon(svg => {
    const parallels = document.createElementNS(SVG_NS, "path");
    parallels.setAttribute("d", "M2 12h20M3.34 7h17.32M3.34 17h17.32");
    svg.append(parallels);
  });
}

/** A globe with only its meridians: the one facing the viewer and the pair 30° either side of it. */
export function createLongitudeIcon(): SVGSVGElement {
  return createIcon(svg => {
    const central = document.createElementNS(SVG_NS, "path");
    central.setAttribute("d", "M12 2v20");
    const pair = document.createElementNS(SVG_NS, "ellipse");
    pair.setAttribute("cx", "12");
    pair.setAttribute("cy", "12");
    pair.setAttribute("rx", "5");
    pair.setAttribute("ry", "10");
    svg.append(central, pair);
  });
}

interface Part {
  element: HTMLSpanElement;
  text: Text;
}

function createPart(name: string): Part {
  const element = document.createElement("span");
  element.className = "hud-position__part";
  element.dataset.positionPart = name;
  const text = document.createTextNode("");
  element.append(text);
  return { element, text };
}

function setText(part: Part, value: string): void {
  if (part.text.data !== value) part.text.data = value;
}

/**
 * The toolbar's position: latitude, longitude, altitude, then whatever the host
 * adds. How the first two are marked, and what the altitude is measured from
 * and written in, are the `interface.position.*` parameters, followed live.
 */
export function createPositionReadout(element: HTMLElement, settings: SettingsRegistry): PositionReadoutHandle {
  const latitude = createPart("latitude");
  const longitude = createPart("longitude");
  const altitude = createPart("altitude");
  const rest = createPart("rest");
  // One line of text inside the chip, so the spaces between readings are the font's own.
  const line = document.createElement("span");
  line.className = "hud-position";
  element.replaceChildren(line);
  let last: PositionReading | null = null;
  let drawnLabels: CoordinateLabels | null = null;
  let drawnParts = "";

  function draw(): void {
    if (!last) return;
    const labels = settings.get<CoordinateLabels>(POSITION_COORDINATE_LABELS_ID);
    if (labels !== drawnLabels) {
      drawnLabels = labels;
      latitude.element.replaceChildren(...(labels === "icons" ? [createLatitudeIcon()] : []), latitude.text);
      longitude.element.replaceChildren(...(labels === "icons" ? [createLongitudeIcon()] : []), longitude.text);
    }
    const { latDeg, lonDeg } = last;
    setText(latitude, `${labels === "words" ? "lat " : ""}${Math.abs(latDeg).toFixed(4)}°${latDeg >= 0 ? "N" : "S"}`);
    setText(longitude, `${labels === "words" ? "lon " : ""}${Math.abs(lonDeg).toFixed(4)}°${lonDeg >= 0 ? "E" : "W"}`);
    const shown = [latitude, longitude];
    if (last.altitudeMeters !== undefined) {
      setText(altitude, formatAltitude(last.altitudeMeters, last.groundHeightMeters ?? null,
        settings.get<AltitudeReference>(POSITION_ALTITUDE_ID), settings.get<AltitudeUnit>(POSITION_ALTITUDE_UNIT_ID)));
      shown.push(altitude);
    }
    if (last.rest) {
      setText(rest, last.rest);
      shown.push(rest);
    }
    const parts = shown.map(part => part.element.dataset.positionPart).join(" ");
    if (parts !== drawnParts) {
      drawnParts = parts;
      line.replaceChildren(...shown.flatMap((part, index) => index === 0 ? [part.element] : [" ", part.element]));
    }
  }

  const stopWatching = [POSITION_COORDINATE_LABELS_ID, POSITION_ALTITUDE_ID, POSITION_ALTITUDE_UNIT_ID]
    .map(id => settings.watch(id, draw));

  return {
    update(reading) {
      last = reading;
      draw();
    },
    needsGroundHeight: () => settings.get<AltitudeReference>(POSITION_ALTITUDE_ID) === "agl",
    destroy() {
      for (const stop of stopWatching) stop();
      element.replaceChildren();
    },
  };
}
