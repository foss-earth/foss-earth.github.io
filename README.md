# FOSS Earth

[![Live site](https://img.shields.io/badge/live-foss--earth.github.io-2ea44f)](https://foss-earth.github.io/)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue)](LICENSE)

FOSS Earth is a 3D globe that runs in a web browser. It streams real elevation and imagery from open tile services and builds a terrain mesh from them. You can fly over it with a mouse, trackpad, touch screen or game controller. [Babylon.js](https://www.babylonjs.com/) renders it on WebGPU, falling back to WebGL2 or WebGL where WebGPU is missing.

The aim is Google Earth–style flying in an ordinary browser tab, with real terrain and real imagery under a camera that keeps up. You don't need an account or an API key, and there is no backend: the app is a static site that reads free public tile services.

**[Open FOSS Earth](https://foss-earth.github.io/)** · [Run it locally](#run-it-locally) · [Use it in your app](#use-it-in-your-app) · [Documentation](#documentation) · [How it compares](docs/globe-comparison.md) · [Issues](https://github.com/foss-earth/foss-earth.github.io/issues)

## Features

- **Streamed terrain.** Elevation tiles from Mapterhorn or AWS Terrain Tiles are turned into a mesh. The mesh gets finer as you get closer, and neighboring tiles are stitched together at their edges. A detail setting trades sharpness for speed, or chooses automatically. See [Streamed terrain](docs/streamed-terrain.md).
- **Seven basemaps, no key:** USGS imagery, imagery with topo labels, and topo; OpenStreetMap; CARTO Positron and Dark Matter; OpenTopoMap. With your own Google Maps Tiles API key, you can use Google Photorealistic 3D Tiles instead.
- **Search** for a place, a pair of coordinates, or an airport's ICAO or IATA code. A city result lists the airports near it. See [Airport locations](docs/airport-locations.md).
- **Mouse, trackpad, touch and game controller.** Trackpad input includes Safari gestures. You can edit controller bindings, save them, and import or export them as JSON.
- **Cached tiles.** Terrain and imagery you have visited stay in the browser cache, up to 128 MB, for as long as each provider's HTTP headers allow.
- **Renders only when something changes.** The HUD shows the frame rate, memory use and the active renderer. The Renderer tab can switch between WebGPU, WebGL2 and WebGL.
- **Light and dark themes.**

## Controls

| | Look around | Orbit | Zoom |
|---|---|---|---|
| **Mouse** | Left drag | Right drag | Wheel |
| **Trackpad** | Drag | Shift + swipe | Pinch |
| **Touch** | One finger | Two fingers | Pinch |
| **Controller** | Left stick | Right stick | Right trigger in, left trigger out |

The **?** button shows these controls in the app. **N** resets the view to north-up. A controller starts on the built-in Standard profile.

## Data sources

| Source | Provides | Key |
|---|---|---|
| [Mapterhorn](https://mapterhorn.com/) | Elevation (default) | No |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Elevation | No |
| [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) | USGS Imagery, USGS Imagery Topo (default basemap), USGS Topo | No |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Standard map | No |
| [CARTO](https://carto.com/attributions) | Positron, Dark Matter | No |
| [OpenTopoMap](https://opentopomap.org/about) | Topographic map | No |
| [Google Map Tiles API](https://developers.google.com/maps/documentation/tile/3d-tiles) | Photorealistic 3D Tiles | Yours |
| [Nominatim](https://nominatim.org/) | Place search | No |
| [Overpass API](https://overpass-api.de/), [FreeAirportDB](https://freeairportdb.com/) | Airports and runways | No |

USGS imagery is high-resolution only within the United States. Each service sets its own terms of use. The HUD credits whichever map source is active.

## URL parameters

Settings you change in the app are written back to the URL, so a link reproduces your setup.

| Parameter | Values | Effect |
|---|---|---|
| `key` | A Google Maps Tiles API key | Turns on Photorealistic 3D Tiles |
| `mapSource` | `google`, `usgs-imagery`, `usgs-imagery-topo`, `usgs-topo`, `osm-standard`, `carto-positron`, `carto-dark-matter`, `open-topo-map` | Basemap |
| `elevationSource` | `mapterhorn`, `aws-terrarium` | Elevation source |
| `terrainQuality` | `auto`, `low`, `balanced`, `high` | Terrain detail |
| `renderer` | `webgpu`, `webgl2`, `webgl` | Forces a renderer |

For example: `https://foss-earth.github.io/?mapSource=open-topo-map&renderer=webgl2`. Your Google key stays in your browser and is sent only to Google.

## Run it locally

FOSS Earth needs Node.js 22 or newer. It takes its controller handling from [gamepad-tools](https://github.com/Felipegalind0/gamepad-tools), which must be checked out and built next to it:

```sh
git clone https://github.com/Felipegalind0/gamepad-tools.git Felipegalind0/gamepad-tools
(cd Felipegalind0/gamepad-tools && npm install && npm run build)
git clone https://github.com/foss-earth/foss-earth.github.io.git foss-earth
cd foss-earth
npm ci
npm run dev
```

Then open the URL Vite prints. [Development](docs/development.md) explains the folder layout, the checks CI runs, and how to host your own build.

## Use it in your app

FOSS Earth is also a TypeScript package. [0SFS](https://0sfs.github.io/), a flight simulator that runs in the browser, is built on it ([source](https://github.com/0SFS/0SFS.github.io)). The package is not on npm yet. Link it from a sibling checkout:

```json
"dependencies": {
  "foss-earth": "file:../foss-earth"
}
```

```ts
import { createGlobe } from "foss-earth";

const globe = await createGlobe({
  container: "globe", // an element, or its id
  baseMap: "open-topo-map",
  terrainSource: "mapterhorn",
});

globe.setViewState({ latDeg: 36.1, lonDeg: -112.14, zoomMeters: 4000, pitchDeg: 60 });
```

The exports point at TypeScript source, so build your app with a bundler that compiles TypeScript, such as Vite.

| Export | What it provides |
|---|---|
| `foss-earth` | `createGlobe`, the view API, the basemap and elevation source lists, and point sprites |
| `foss-earth/runtime` | The Babylon runtime, renderer and map configuration, surface queries and terrain readiness |
| `foss-earth/layers` | Types for adding your own Babylon content to the scene |
| `foss-earth/shell` | HUD bar, docked tab overlay, location search, status log, tile cache panel and fullscreen |
| `foss-earth/windowing` | Panel, tab and workspace primitives |
| `foss-earth/input` | Input modes, sensitivity, Safari gestures and controller navigation |
| `foss-earth/cameraMath` | WGS84 and ECEF conversion |
| `foss-earth/smoothElevation` | Smoothed surface height at a latitude and longitude |
| `foss-earth/style.css`, `shell.css`, `windowing.css`, `input-mode.css` | Styles for the matching modules |

## Browser support

FOSS Earth uses WebGPU where the browser offers it and falls back to WebGL2, then WebGL. The most recent manual pass covered Chrome, Firefox and Safari on macOS on 17 May 2026. See the [Manual QA checklist](docs/manual-qa.md).

## Project status

Early. There are no releases yet, and the package API changes as FOSS Earth and 0sfs grow. [TODO.md](TODO.md) lists known bugs.

## Documentation

| Document | What it covers |
|---|---|
| [Development](docs/development.md) | Local setup, tests, self-hosting, architecture notes |
| [Deploying to GitHub Pages](docs/deploying.md) | `npm run deploy` |
| [Manual QA checklist](docs/manual-qa.md) | What to exercise before a release |
| [Globe comparison](docs/globe-comparison.md) | FOSS Earth, CesiumJS, MapLibre and WorldWind flying the same path |
| [Performance pass](docs/performance-pass.md) | What was made cheaper, and how to measure again |
| [Streamed terrain](docs/streamed-terrain.md) | Elevation tiles and surface queries |
| [Airport locations](docs/airport-locations.md) | Airport and runway lookup |
| [Compass height model](docs/compass-height-model.md) | Camera anchor height |
| [UI layout](docs/ui-layout.md) | How controls, tabs and docks are laid out |
| [Map detail implementation spec](docs/proposals/map-detail-control.md) | Projected raster imagery, shared detail controls and 0sfs migration |
| [Design proposals](docs/proposals/) | Architecture notes |

## Built with

[Babylon.js](https://www.babylonjs.com/) for rendering, [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) for Google Photorealistic 3D Tiles, [React](https://react.dev/) for the panels, and [Vite](https://vite.dev/) for the build. Controller handling comes from [gamepad-tools](https://github.com/Felipegalind0/gamepad-tools).

## Contributing

Bug reports and pull requests are welcome. Start with [Development](docs/development.md).

## License

[AGPL-3.0-only](LICENSE). If you run a modified copy as a public service, you must offer its users the source. See [NOTICE](NOTICE) for third-party terms, and [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) for commercial arrangements.
