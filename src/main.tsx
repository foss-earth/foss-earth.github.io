import "./styles/globe.css";
import "./windowing/styles/windowing.css";
import { createRoot } from "react-dom/client";
import { createGlobeApp } from "./app/createGlobeApp";
import { WindowOverlay } from "./shell/WindowOverlay";
import { trackViewportInsets } from "./shell/viewportInsets";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Expected to find a root element with id "root".');
}

// Lift the fixed HUD clear of any browser toolbar overlaying the page bottom.
trackViewportInsets();

void createGlobeApp(rootElement).then((globeApp) => {
  if (new URLSearchParams(window.location.search).get("bench") === "1") {
    window.__fossEarthBench = globeApp;
  }
  const overlayRoot = document.createElement("div");
  overlayRoot.className = "foss-earth-overlay-root";
  rootElement.querySelector(".globe-shell")?.append(overlayRoot);
  createRoot(overlayRoot).render(
    <WindowOverlay
      getViewState={globeApp.getViewState}
      setViewState={(location) => globeApp.setViewState(location)}
    />,
  );
}).catch((error: unknown) => {
  console.error("Failed to bootstrap FOSS Earth Babylon.", error);
  rootElement.innerHTML = '<div class="boot-error">Failed to initialize FOSS Earth Babylon.</div>';
});
