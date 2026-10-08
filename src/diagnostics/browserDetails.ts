/** Browser-provided details only: no geolocation, extra context or hardware probe. */
export function readBrowserReportDetails(): string[] {
  if (typeof navigator === "undefined" || typeof window === "undefined") return [];
  const display = window.screen;
  const viewport = window.visualViewport;
  const hints = navigator as Navigator & {
    userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string; mobile?: boolean };
  };
  return [
    `Browser platform: ${navigator.platform || "not reported"}; language ${navigator.language || "not reported"}; maximum touch points ${navigator.maxTouchPoints ?? 0}`,
    ...(hints.userAgentData ? [`Browser hints: ${hints.userAgentData.brands?.map(({ brand, version }) => `${brand} ${version}`).join(", ") || "brands not reported"}; platform ${hints.userAgentData.platform || "not reported"}; mobile ${hints.userAgentData.mobile ?? "not reported"}`] : []),
    `Display: ${display.width} × ${display.height} CSS px; available ${display.availWidth} × ${display.availHeight}; color depth ${display.colorDepth}; orientation ${display.orientation?.type ?? "not reported"}`,
    ...(viewport ? [`Visual viewport: ${viewport.width} × ${viewport.height} CSS px; scale ${viewport.scale}`] : []),
    `Page environment: ${window.isSecureContext ? "secure" : "not secure"}; ${navigator.onLine ? "online" : "offline"}; visibility ${document.visibilityState}`,
    "Device details are browser reports; exact model and physical RAM may be unavailable or reduced for privacy.",
  ];
}
