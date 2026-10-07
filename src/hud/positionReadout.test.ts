// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTERFACE_PARAMETERS } from "../settings/catalogue/interface";
import { createSettingsRegistry, type SettingsRegistry } from "../settings/registry";
import type { GeoidGridId, GeoidModel } from "../terrain/geoid";
import { createPositionReadout, formatAltitude, type PositionReadoutHandle } from "./positionReadout";

let settings: SettingsRegistry;
let chip: HTMLButtonElement;
let readout: PositionReadoutHandle;

const MINNEAPOLIS = { latDeg: 44.9778, lonDeg: -93.265 };
const part = (name: string): HTMLElement | null => chip.querySelector<HTMLElement>(`[data-position-part="${name}"]`);

beforeEach(() => {
  settings = createSettingsRegistry({ storage: null });
  settings.register(INTERFACE_PARAMETERS);
  chip = document.createElement("button");
  readout = createPositionReadout(chip, settings);
});

describe("position readout", () => {
  it("marks the latitude and the longitude with their icons unless asked otherwise", () => {
    readout.update(MINNEAPOLIS);

    expect(settings.get("interface.position.coordinateLabels")).toBe("icons");
    expect(chip.textContent).toBe("44.9778°N 93.2650°W");
    // Parallels are straight lines across the globe; meridians close into an ellipse.
    expect(part("latitude")!.querySelector("svg.hud-position__icon path")?.getAttribute("d")).toContain("h20");
    expect(part("latitude")!.querySelector("ellipse")).toBeNull();
    expect(part("longitude")!.querySelector("svg.hud-position__icon ellipse")).not.toBeNull();
    expect(chip.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(2);
  });

  it("writes lat and lon, or nothing, the moment the setting changes", () => {
    readout.update(MINNEAPOLIS);

    settings.set("interface.position.coordinateLabels", "words");
    expect(chip.textContent).toBe("lat 44.9778°N lon 93.2650°W");
    expect(chip.querySelector("svg")).toBeNull();

    settings.set("interface.position.coordinateLabels", "none");
    expect(chip.textContent).toBe("44.9778°N 93.2650°W");
    expect(chip.querySelector("svg")).toBeNull();

    settings.set("interface.position.coordinateLabels", "icons");
    expect(chip.querySelectorAll("svg")).toHaveLength(2);
  });

  it("shows the altitude after the position, and the host's readings after that", () => {
    readout.update({ latDeg: -33.8568, lonDeg: 151.2153, altitudeMeters: 1250.4, rest: "h017°" });

    expect(chip.textContent).toBe("33.8568°S 151.2153°E 1250m ASL h017°");
    expect(readout.needsGroundHeight()).toBe(false);
  });

  it("measures the altitude from the ground below when set to, and says when it cannot", () => {
    settings.set("interface.position.altitude", "agl");
    expect(readout.needsGroundHeight()).toBe(true);

    readout.update({ ...MINNEAPOLIS, altitudeMeters: 1250, groundHeightMeters: 250 });
    expect(part("altitude")!.textContent).toBe("1000m AGL");

    readout.update({ ...MINNEAPOLIS, altitudeMeters: 1250, groundHeightMeters: null });
    expect(part("altitude")!.textContent).toBe("—m AGL");

    settings.set("interface.position.altitude", "asl");
    expect(part("altitude")!.textContent).toBe("1250m ASL");
  });

  it("writes the altitude in feet when set to", () => {
    settings.set("interface.position.altitudeUnit", "ft");
    readout.update({ ...MINNEAPOLIS, altitudeMeters: 304.8, groundHeightMeters: 0 });

    expect(part("altitude")!.textContent).toBe("1000ft ASL");
  });

  it("keeps its elements while only the numbers change", () => {
    readout.update({ ...MINNEAPOLIS, altitudeMeters: 100 });
    const icon = chip.querySelector("svg");
    const altitude = part("altitude");

    readout.update({ latDeg: 45, lonDeg: -93, altitudeMeters: 200 });

    expect(chip.querySelector("svg")).toBe(icon);
    expect(part("altitude")).toBe(altitude);
    expect(chip.textContent).toBe("45.0000°N 93.0000°W 200m ASL");
  });

  it("stops following the settings and empties the chip when destroyed", () => {
    readout.update(MINNEAPOLIS);
    readout.destroy();
    settings.set("interface.position.coordinateLabels", "words");

    expect(chip.childNodes).toHaveLength(0);
  });
});

describe("altitude above sea level over Google 3D Tiles", () => {
  // Sea level 27.3 m below the ellipsoid, as in Minneapolis.
  const MODEL: GeoidModel = { spacingMinutes: 15, heightMeters: () => -27.3 };
  const OVER_TILES = { ...MINNEAPOLIS, altitudeMeters: 1000, groundHeightMeters: 230, heightDatum: "ellipsoid" as const };

  function withGrids(load: (grid: GeoidGridId) => Promise<GeoidModel>) {
    readout.destroy();
    const asked: GeoidGridId[] = [];
    readout = createPositionReadout(chip, settings, { loadGeoid: grid => { asked.push(grid); return load(grid); } });
    return asked;
  }

  it("takes away the geoid's height once the sea level grid has loaded, and asks for it once", async () => {
    let arrive!: (model: GeoidModel) => void;
    const asked = withGrids(() => new Promise(resolve => { arrive = resolve; }));

    readout.update(OVER_TILES);
    expect(part("altitude")!.textContent).toBe("—m ASL");
    expect(part("altitude")!.title).toBe("Loading the sea level grid.");

    arrive(MODEL);
    await vi.waitFor(() => expect(part("altitude")!.textContent).toBe("1027m ASL"));
    expect(part("altitude")!.title).toBe("");
    readout.update({ ...OVER_TILES, altitudeMeters: 1001 });
    expect(part("altitude")!.textContent).toBe("1028m ASL");
    expect(asked).toEqual(["15"]);
  });

  it("loads the grid chosen, when it is chosen", async () => {
    const asked = withGrids(async () => MODEL);
    readout.update(OVER_TILES);
    await vi.waitFor(() => expect(part("altitude")!.textContent).toBe("1027m ASL"));

    settings.set("interface.position.seaLevelGrid", "60");
    expect(part("altitude")!.textContent).toBe("—m ASL");
    await vi.waitFor(() => expect(part("altitude")!.textContent).toBe("1027m ASL"));
    expect(asked).toEqual(["15", "60"]);
  });

  it("needs no grid over raster terrain, nor above ground", () => {
    const asked = withGrids(async () => MODEL);
    readout.update({ ...OVER_TILES, heightDatum: "geoid" });
    expect(part("altitude")!.textContent).toBe("1000m ASL");
    readout.update({ ...MINNEAPOLIS, altitudeMeters: 1000 });
    expect(part("altitude")!.textContent).toBe("1000m ASL");

    settings.set("interface.position.altitude", "agl");
    readout.update(OVER_TILES);
    expect(part("altitude")!.textContent).toBe("770m AGL");
    expect(asked).toEqual([]);
  });

  it("says why it shows a dash when the grid cannot load", async () => {
    withGrids(async () => { throw new Error("HTTP 404"); });
    readout.update(OVER_TILES);
    await vi.waitFor(() => expect(part("altitude")!.title).toBe("The sea level grid could not load: HTTP 404"));
    expect(part("altitude")!.textContent).toBe("—m ASL");
  });

  it("draws nothing for a grid that arrives after it is destroyed", async () => {
    let arrive!: (model: GeoidModel) => void;
    withGrids(() => new Promise(resolve => { arrive = resolve; }));
    readout.update(OVER_TILES);
    readout.destroy();
    arrive(MODEL);
    await Promise.resolve();
    expect(chip.childNodes).toHaveLength(0);
  });
});

describe("altitude text", () => {
  it("keeps whole metres to 100 km, then shortens as the zoom distance does", () => {
    expect(formatAltitude(10_668, 0, "asl", "m")).toBe("10668m ASL");
    expect(formatAltitude(250_000, 0, "asl", "m")).toBe("250km ASL");
    expect(formatAltitude(20_000_000, 0, "asl", "m")).toBe("20.0Mm ASL");
  });

  it("reads below zero under sea level or under the ground sampled", () => {
    expect(formatAltitude(-12, 0, "asl", "m")).toBe("-12m ASL");
    expect(formatAltitude(95, 100, "agl", "ft")).toBe("-16ft AGL");
  });

  it("measures from sea level's height where it is not zero, and shows a dash while that is unknown", () => {
    expect(formatAltitude(100, -27.3, "asl", "m")).toBe("127m ASL");
    expect(formatAltitude(100, null, "asl", "ft")).toBe("—ft ASL");
  });
});
