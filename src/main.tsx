import { mountGlobeApp } from "./app/mountGlobeApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Expected to find a root element with id "root".');
}

void mountGlobeApp(rootElement).then((globeApp) => {
  if (new URLSearchParams(window.location.search).get("bench") === "1") {
    window.__fossEarthBench = globeApp;
  }
}).catch((error: unknown) => {
  console.error("Failed to bootstrap FOSS Earth Babylon.", error);
  rootElement.innerHTML = '<div class="boot-error">Failed to initialize FOSS Earth Babylon.</div>';
});
