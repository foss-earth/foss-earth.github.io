import type { GlobeViewState } from "../engine/types";
import type { SettingsRegistry } from "../settings/registry";
import type { HeightDatum } from "../terrain/geoid";
import { createPositionReadout, formatDistance } from "./positionReadout";

/** The camera's own height, as distinct from the point it looks at. */
export interface CameraAltitude {
  /** In metres, measured as the drawn world's heights are. */
  altitudeMeters: number;
  /** The ground's height directly below the camera; null while unknown or not asked for. */
  groundHeightMeters: number | null;
  /** What the drawn world's heights are measured from. */
  heightDatum: HeightDatum;
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
      heightDatum: camera?.heightDatum,
      rest: `${hdgStr} ${pitchStr} ${zoomStr}`,
    });
  }

  return { update, needsGroundHeight: readout.needsGroundHeight, destroy: readout.destroy };
}
