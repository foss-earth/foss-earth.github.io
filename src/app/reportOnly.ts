/**
 * `?report` in the address: the page shows the diagnostics report and starts
 * nothing else (docs/diagnostics.md). It is how the trail of a visit is read
 * when the app stops before Settings → Diagnostics can be reached, as when it
 * stops while starting.
 */
import { buildReport, reportPage } from "../diagnostics/report";
import { createSessionTrail, TRAIL_STEPS_DEFAULT } from "../diagnostics/sessionTrail";
import type { SettingsRegistry } from "../settings/registry";
import { createDiagnosticsSection } from "../shell/diagnosticsSection";
import { settingsNotAtDefaults } from "./appDiagnostics";
import type { AppIdentity } from "./appIdentity";
import { describePublishedVersion, readPublishedVersion } from "./publishedVersion";

/** The address parameter. */
export const REPORT_ONLY_PARAMETER = "report";

export const wantsReportOnly = (search: string): boolean => new URLSearchParams(search).has(REPORT_ONLY_PARAMETER);

/** The same address without the parameter: the app itself. */
export function addressWithoutReport(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(REPORT_ONLY_PARAMETER);
  return url.href;
}

export function showReportOnly(rootElement: HTMLElement, options: { settings: SettingsRegistry; identity: AppIdentity }): void {
  const { settings, identity } = options;
  // Read, not written: the page may be opened again, and the app's next visit is still told of the one that stopped.
  const trail = createSessionTrail({ app: () => "", kept: () => false, limit: () => TRAIL_STEPS_DEFAULT, readOnly: true });
  trail.step(`Opened ${reportPage(location.href)} for the report only: the map was not started`);
  const previous = trail.previous();
  // Asked and never acted on: this page is here to be read, so it does not reload itself.
  const published = readPublishedVersion(settings);
  const report = async (): Promise<string> => {
    const context = settings.getDeviceContext();
    return buildReport({
      at: new Date(),
      page: reportPage(location.href),
      build: identity.build, source: identity.source, fossEarth: identity.fossEarth, bundle: identity.bundle,
      userAgent: navigator.userAgent,
      screen: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, touch: context.touch },
      device: { cores: context.hardwareConcurrency, memoryGiB: context.deviceMemoryGiB },
      renderer: { asked: "not started", mode: "not started", driver: null, maxTextureSize: null, fallbackReason: null, lost: 0 },
      state: [`Published: ${describePublishedVersion(await published, Date.now())}`],
      settings: settingsNotAtDefaults(settings),
      steps: trail.steps(),
      errors: [],
      previous: await previous.catch(() => null),
    });
  };

  const page = document.createElement("main");
  page.className = "foss-earth-report-only";
  const title = document.createElement("h1");
  title.textContent = "Report";
  const why = document.createElement("p");
  why.textContent = "The address asks for the report only (?report), so the map was not started. The report says how the last visit to this page ended and what it had done.";
  const back = document.createElement("a");
  back.href = addressWithoutReport(location.href);
  back.textContent = "Open the app";
  const section = createDiagnosticsSection({ report, previous: () => previous });
  page.append(title, why, section.element, back);
  rootElement.replaceChildren(page);
  // Shown at once: on this page the report is what the person came for.
  section.element.querySelector("button")?.click();
}
