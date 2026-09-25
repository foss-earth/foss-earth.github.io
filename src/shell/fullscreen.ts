/**
 * Page fullscreen, the browser differences around it, and the two per-device
 * choices a host can offer: enter on every visit, and stop asking.
 *
 * The preference keys keep the `osfs.` prefix they were written under before
 * this module moved out of the flight simulator, so a device that already made
 * either choice keeps it. `moir-park.map-input-mode` is retained for the same
 * reason.
 */
const EVERY_VISIT_PREFERENCE_KEY = "osfs.fullscreen-every-visit";
/** A declined offer, remembered per device the way the every-visit choice is. */
const PROMPT_DISMISSED_PREFERENCE_KEY = "osfs.fullscreen-prompt-dismissed";

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?(): Promise<void> | void;
};
type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?(): Promise<void> | void };

/** iPhone Safari has no page fullscreen; older iPad Safari only the prefixed API. */
export function canRequestFullscreen(): boolean {
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Already running without browser bars, e.g. launched from the Home Screen. */
export function isStandaloneDisplay(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return true;
  return typeof window.matchMedia === "function"
    && window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;
}

/** Browsers grant this only during a tap, click or key press. */
export async function enterFullscreen(): Promise<void> {
  const root = document.documentElement as FullscreenRoot;
  if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
  else await root.webkitRequestFullscreen?.();
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (doc.exitFullscreen) await doc.exitFullscreen();
  else await doc.webkitExitFullscreen?.();
}

export function toggleFullscreen(): Promise<void> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

export function onFullscreenChange(listener: () => void): () => void {
  document.addEventListener("fullscreenchange", listener);
  document.addEventListener("webkitfullscreenchange", listener);
  return () => {
    document.removeEventListener("fullscreenchange", listener);
    document.removeEventListener("webkitfullscreenchange", listener);
  };
}

export function readFullscreenEveryVisit(): boolean {
  try { return window.localStorage.getItem(EVERY_VISIT_PREFERENCE_KEY) === "1"; } catch { return false; }
}

export function writeFullscreenEveryVisit(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(EVERY_VISIT_PREFERENCE_KEY, "1");
    else window.localStorage.removeItem(EVERY_VISIT_PREFERENCE_KEY);
  } catch { /* Private browsing: the choice lasts for this visit only. */ }
}

export function readFullscreenPromptDismissed(): boolean {
  try { return window.localStorage.getItem(PROMPT_DISMISSED_PREFERENCE_KEY) === "1"; } catch { return false; }
}

export function writeFullscreenPromptDismissed(dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(PROMPT_DISMISSED_PREFERENCE_KEY, "1");
    else window.localStorage.removeItem(PROMPT_DISMISSED_PREFERENCE_KEY);
  } catch { /* Private browsing: the choice lasts for this visit only. */ }
}

/** Coarse pointer and no page fullscreen: an iPhone, where the Home Screen is the only way. */
export function prefersHomeScreenInstall(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}
