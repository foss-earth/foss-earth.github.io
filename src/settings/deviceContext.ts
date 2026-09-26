import type { DeviceContext } from "./types";

/** What the browser says about this device before a renderer starts. */
export function readDeviceContext(): Partial<DeviceContext> {
  if (typeof navigator === "undefined") return {};
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGiB: typeof memory === "number" && memory > 0 ? memory : null,
    touch: (navigator.maxTouchPoints ?? 0) > 0,
  };
}
