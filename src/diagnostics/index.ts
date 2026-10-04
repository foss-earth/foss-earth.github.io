/** What an app needs to say what went wrong on a device with no console (docs/diagnostics.md). */
export { captureErrors, tapConsole, type CapturedError } from "./errorCapture";
export { buildReport, reportPage, type ReportParts, type ReportSetting } from "./report";
export {
  browserTrailEnvironment, createSessionTrail, describePreviousVisit, stepKind, tidyStep, TRAIL_KEY_PREFIX, TRAIL_PING_KEY, TRAIL_STEPS_DEFAULT,
  type PreviousVisit, type SessionTrail, type SessionTrailOptions, type TrailEnvironment, type TrailRecord, type TrailStep,
} from "./sessionTrail";
