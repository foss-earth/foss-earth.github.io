/**
 * FOSS Earth's whole app in one call: the globe with its HUD bar and toolbar,
 * the docked tab overlay the toolbar toggles, and the page's viewport insets.
 * FOSS Earth's own page is this call. An application that shows the globe as
 * it is, with its own scenes, makes the same call with its options.
 */
import "../styles/globe.css";
import "../windowing/styles/windowing.css";
import { createRoot } from "react-dom/client";
import { WindowOverlay, type WindowOverlayHandle } from "../shell/WindowOverlay";
import { trackViewportInsets } from "../shell/viewportInsets";
import { getAppSettings } from "../settings/appSettings";
import { createGlobeApp, getAppIdentity, type GlobeAppHandle, type GlobeAppOptions } from "./createGlobeApp";
import { showReportOnly, wantsReportOnly } from "./reportOnly";

export async function mountGlobeApp(rootElement: HTMLElement, options: Omit<GlobeAppOptions, "overlayApiRef"> = {}): Promise<GlobeAppHandle> {
  // `?report`: the diagnostics report and nothing else, for an app that stops before its settings can be reached. The app never starts.
  if (wantsReportOnly(window.location.search)) {
    showReportOnly(rootElement, { settings: getAppSettings(), identity: getAppIdentity() });
    return new Promise<GlobeAppHandle>(() => {});
  }
  // Lift the fixed HUD clear of any browser toolbar overlaying the page bottom.
  trackViewportInsets();
  // Filled once the overlay mounts; the toolbar buttons read it when clicked.
  const overlayApi: { current: WindowOverlayHandle | null } = { current: null };
  const globeApp = await createGlobeApp(rootElement, { ...options, overlayApiRef: overlayApi });
  const overlayRoot = document.createElement("div");
  overlayRoot.className = "foss-earth-overlay-root";
  rootElement.querySelector(".globe-shell")?.append(overlayRoot);
  createRoot(overlayRoot).render(
    <WindowOverlay
      getViewState={globeApp.getViewState}
      setViewState={(location) => globeApp.setViewState(location)}
      controlsSections={globeApp.controlsSections}
      interfaceSections={globeApp.interfaceSections}
      settingsSections={globeApp.settingsSections}
      mapTab={globeApp.mapTab}
      rendererTab={globeApp.rendererTab}
      scenesTab={globeApp.scenesTab}
      aboutTab={globeApp.aboutTab}
      panoramaTabs={globeApp.panoramaTabs}
      overlayApiRef={overlayApi}
    />,
  );
  return globeApp;
}
