// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { INTERFACE_PARAMETERS } from "../settings/catalogue/interface";
import { createSettingsRegistry, type SettingsRegistry } from "../settings/registry";
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

describe("altitude text", () => {
  it("keeps whole metres to 100 km, then shortens as the zoom distance does", () => {
    expect(formatAltitude(10_668, null, "asl", "m")).toBe("10668m ASL");
    expect(formatAltitude(250_000, null, "asl", "m")).toBe("250km ASL");
    expect(formatAltitude(20_000_000, null, "asl", "m")).toBe("20.0Mm ASL");
  });

  it("reads below zero under sea level or under the ground sampled", () => {
    expect(formatAltitude(-12, null, "asl", "m")).toBe("-12m ASL");
    expect(formatAltitude(95, 100, "agl", "ft")).toBe("-16ft AGL");
  });
});
