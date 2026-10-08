/**
 * The report a person copies when something went wrong (docs/diagnostics.md):
 * what ran, on what, how it was set, what this visit did and how the one
 * before it ended, as text. It is made on this device and goes nowhere by
 * itself; secrets are left out of it.
 */
import type { CapturedError } from "./errorCapture";
import { tidyStep, type PreviousVisit, type TrailStep } from "./sessionTrail";

export interface ReportSetting {
  id: string;
  /** As Settings shows it; a secret says only whether it is set. */
  value: string;
  /** Where the value came from: saved by the person, the address, a preset, the host. */
  from: string;
  defaultValue: string;
}

export interface ReportParts {
  at: Date;
  /** The page's address. A key in its query is left out. */
  page: string;
  build: string;
  source: string;
  /** FOSS Earth's commit, in an app built on it from another repository. */
  fossEarth?: string;
  bundle: string;
  userAgent: string;
  screen: { width: number; height: number; devicePixelRatio: number; touch: boolean };
  device: { cores: number | null; memoryGiB: number | null };
  environment?: readonly string[];
  renderer: {
    asked: string;
    mode: string;
    /** The GPU and driver, as the renderer names them. */
    driver: string | null;
    maxTextureSize: number | null;
    fallbackReason: string | null;
    /** Times the GPU's context or device was lost this visit. */
    lost: number;
    capabilities?: readonly string[];
  };
  /** One line each, as the host words them: the app's kept files, the scene, what is saved. */
  state: readonly string[];
  /** Every parameter that is not at its default. */
  settings: readonly ReportSetting[];
  settingsComplete?: boolean;
  steps: readonly TrailStep[];
  errors: readonly (CapturedError & { count: number })[];
  previous: PreviousVisit | null;
}

const clock = (ms: number): string => `${(ms / 1000).toFixed(1).padStart(7)} s`;
const stepLine = (step: TrailStep): string =>
  `${clock(step.ms)}  ${step.text}${step.count ? ` (${step.count} times${step.lastMs === undefined ? "" : `, the last at ${(step.lastMs / 1000).toFixed(1)} s`})` : ""}`;

/** The address without its secrets: the same rule as a step's text. */
export function reportPage(href: string): string {
  return tidyStep(href);
}

export function buildReport(parts: ReportParts): string {
  const { screen, device, renderer, previous } = parts;
  const lines: string[] = [
    `FOSS Earth report, ${parts.at.toISOString()}`,
    `Page: ${parts.page}`,
    `Build: ${parts.build} · source ${parts.source}${parts.fossEarth ? ` · FOSS Earth ${parts.fossEarth}` : ""} · bundle ${parts.bundle}`,
    `Browser: ${parts.userAgent}`,
    `Screen: ${screen.width} × ${screen.height} CSS px at ${screen.devicePixelRatio}×, ${screen.touch ? "touch" : "no touch"}; ${device.cores ?? "unknown"} cores; memory ${device.memoryGiB === null ? "not reported" : `${device.memoryGiB} GiB or more`}`,
    ...(parts.environment ?? []),
    `Renderer: ${renderer.mode} (asked for ${renderer.asked})${renderer.fallbackReason ? `; fell back: ${renderer.fallbackReason}` : ""}; largest texture ${renderer.maxTextureSize ?? "unknown"} px; lost ${renderer.lost} ${renderer.lost === 1 ? "time" : "times"} this visit`,
    `GPU: ${renderer.driver ?? "not named"}`,
    ...(renderer.capabilities ?? []),
    ...parts.state,
    "",
    parts.settingsComplete ? "Settings (all effective values):" : parts.settings.length ? "Settings not at their defaults:" : "Settings: all at their defaults.",
    ...parts.settings.map(setting => `  ${setting.id} = ${setting.value} (${setting.from}; default ${setting.defaultValue})`),
    "",
    parts.errors.length ? "Errors nothing handled:" : "Errors nothing handled: none.",
    ...parts.errors.flatMap(error => [
      `  ${error.message}${error.where ? ` at ${error.where}` : ""}${error.count > 1 ? ` (${error.count} times)` : ""}`,
      ...(error.stack ? error.stack.split("\n").slice(1).map(line => `      ${tidyStep(line)}`) : []),
    ]),
    "",
    "This visit, oldest first:",
    ...parts.steps.map(step => `  ${stepLine(step)}`),
    "",
  ];
  if (!previous) lines.push("The visit before: no trail of one on this device.");
  else {
    const how = previous.ended === "unexpected" ? "stopped without being closed, while shown"
      : previous.ended === "hidden" ? "was let go by the browser while hidden" : "was closed";
    lines.push(
      `The visit before, opened ${new Date(previous.record.startedAt).toISOString()}, ${how}. ${previous.record.app}`,
      ...(previous.record.state ? [`  It was at: ${previous.record.state}`] : []),
      ...previous.record.steps.map(step => `  ${stepLine(step)}`),
    );
  }
  return `${lines.join("\n")}\n`;
}
