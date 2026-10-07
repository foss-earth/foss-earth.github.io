import {
  POSITION_ALTITUDE_ID,
  POSITION_ALTITUDE_UNIT_ID,
  POSITION_COORDINATE_LABELS_ID,
  POSITION_SEA_LEVEL_GRID_ID,
  type AltitudeReference,
  type AltitudeUnit,
  type CoordinateLabels,
} from "../settings/catalogue";
import type { SettingsRegistry } from "../settings/registry";
import { loadGeoid, type GeoidGridId, type GeoidModel, type HeightDatum } from "../terrain/geoid";

const SVG_NS = "http://www.w3.org/2000/svg";
const METERS_PER_FOOT = 0.3048;

export interface PositionReading {
  latDeg: number;
  lonDeg: number;
  /** The height, in metres, measured as the drawn world's heights are (`heightDatum`). Left out, the readout shows no altitude. */
  altitudeMeters?: number;
  /** The height of the ground directly below, measured the same way; null while no terrain there has loaded. */
  groundHeightMeters?: number | null;
  /**
   * What the drawn world's heights are measured from (`surfaceHeightDatum`).
   * Over the ellipsoid, the altitude above sea level takes the geoid's height
   * away. Sea level when left out.
   */
  heightDatum?: HeightDatum;
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

export interface PositionReadoutOptions {
  /** Where the sea level grids come from; the app's own files unless a test gives its own. */
  loadGeoid?(grid: GeoidGridId): Promise<GeoidModel>;
}

/**
 * The altitude as the readout writes it, such as "1250m ASL" or "410ft AGL":
 * `altitudeMeters` less `baseMeters`, the height of sea level or of the ground
 * there, or a dash while that is not known. Metres stay whole to 100 km, the
 * range a height is read to the metre in.
 */
export function formatAltitude(altitudeMeters: number, baseMeters: number | null, reference: AltitudeReference, unit: AltitudeUnit): string {
  const suffix = reference === "asl" ? "ASL" : "AGL";
  if (baseMeters === null) return `\u2014${unit} ${suffix}`;
  const meters = altitudeMeters - baseMeters;
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
export function createPositionReadout(element: HTMLElement, settings: SettingsRegistry, options: PositionReadoutOptions = {}): PositionReadoutHandle {
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
  let destroyed = false;
  // The grid the altitude above sea level is measured with, asked for the first time it is needed.
  let geoid: { grid: GeoidGridId; model: GeoidModel | null; error: string | null } | null = null;

  /** The height of sea level at the reading, measured as its altitude is; null while its grid loads. */
  function seaLevel(reading: PositionReading): number | null {
    if ((reading.heightDatum ?? "geoid") === "geoid") return 0;
    const grid = settings.get<GeoidGridId>(POSITION_SEA_LEVEL_GRID_ID);
    if (geoid?.grid !== grid) {
      const asked: NonNullable<typeof geoid> = { grid, model: null, error: null };
      geoid = asked;
      (options.loadGeoid ?? loadGeoid)(grid).then(
        model => { asked.model = model; },
        (error: unknown) => { asked.error = error instanceof Error ? error.message : String(error); },
      ).finally(() => { if (geoid === asked && !destroyed) draw(); });
    }
    return geoid.model?.heightMeters(reading.latDeg, reading.lonDeg) ?? null;
  }

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
      const reference = settings.get<AltitudeReference>(POSITION_ALTITUDE_ID);
      const base = reference === "agl" ? last.groundHeightMeters ?? null : seaLevel(last);
      setText(altitude, formatAltitude(last.altitudeMeters, base, reference, settings.get<AltitudeUnit>(POSITION_ALTITUDE_UNIT_ID)));
      // Why a dash, for whoever points at it.
      const note = base !== null ? "" : reference === "agl" ? "No terrain below has loaded yet."
        : geoid?.error ? `The sea level grid could not load: ${geoid.error}` : "Loading the sea level grid.";
      if (altitude.element.title !== note) altitude.element.title = note;
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

  const stopWatching = [POSITION_COORDINATE_LABELS_ID, POSITION_ALTITUDE_ID, POSITION_ALTITUDE_UNIT_ID, POSITION_SEA_LEVEL_GRID_ID]
    .map(id => settings.watch(id, draw));

  return {
    update(reading) {
      last = reading;
      draw();
    },
    needsGroundHeight: () => settings.get<AltitudeReference>(POSITION_ALTITUDE_ID) === "agl",
    destroy() {
      destroyed = true;
      for (const stop of stopWatching) stop();
      element.replaceChildren();
    },
  };
}
