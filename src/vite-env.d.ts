interface FossEarthBench {
  getViewState(): { latDeg: number; lonDeg: number; headingDeg: number; pitchDeg: number; zoomMeters: number } | null;
  setViewState(partial: {
    latDeg?: number;
    lonDeg?: number;
    headingDeg?: number;
    pitchDeg?: number;
    zoomMeters?: number;
  }): void;
  runtime: { renderer: { mode: string } };
}

interface Window {
  __fossEarthBench?: FossEarthBench;
}

declare const __BUILD_TIME__: string;
declare const __SOURCE_VERSION__: string;
declare const __REPOSITORY_SLUG__: string;