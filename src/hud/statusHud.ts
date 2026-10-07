import type { GlobeViewState } from "../engine/types";
import type { SettingsRegistry } from "../settings/registry";
import { createPositionReadout, formatDistance } from "./positionReadout";

/** The camera's own height, as distinct from the point it looks at. */
export interface CameraAltitude {
  /** Above mean sea level, in metres. */
  altitudeMeters: number;
  /** The ground's height directly below the camera; null while unknown or not asked for. */
  groundHeightMeters: number | null;
}

export interface StatusHudHandle {
  update(state: GlobeViewState, camera?: CameraAltitude | null): void;
  /** Whether the altitude shown needs the ground's height below the camera. */
  needsGroundHeight(): boolean;
  destroy(): void;
}

export function createStatusHud(element: HTMLElement, settings: SettingsRegistry): StatusHudHandle {
  const readout = createPositionReadout(element, settings);

  function update(state: GlobeViewState, camera?: CameraAltitude | null): void {
    const { latDeg, lonDeg, headingDeg, pitchDeg, zoomMeters } = state;
    const hdgStr = `h${String(Math.round(((headingDeg % 360) + 360) % 360)).padStart(3, "0")}\u00B0`;
    const pitchStr = `p${String(Math.round(pitchDeg)).padStart(2, "0")}\u00B0`;
    const zoomStr = `z${formatDistance(zoomMeters)}`;
    readout.update({
      latDeg,
      lonDeg,
      altitudeMeters: camera?.altitudeMeters,
      groundHeightMeters: camera?.groundHeightMeters,
      rest: `${hdgStr} ${pitchStr} ${zoomStr}`,
    });
  }

  return { update, needsGroundHeight: readout.needsGroundHeight, destroy: readout.destroy };
}
