# FOSS Earth

A browser globe you can fly, with streamed elevation and imagery. Babylon.js renders it, on WebGPU when the browser has it.

### **[Open FOSS Earth](https://foss-earth.github.io/)**

The other Google Earth-style globes I could run without WebGPU were too slow to fly. This is an attempt to make that interaction fast: real terrain, real imagery, a camera that keeps moving.

## What a flight actually measured

The first headless flight does not count. The machine was doing other work while it ran, so the table below is a discarded sample, not a ranking. The repeatable suite and the first optimization pass are in [Performance pass](docs/performance-pass.md). Run it on an idle machine, in a visible Chrome window, more than once.

| Implementation | Renderer | What it drew | fps | Main thread, median | Main thread, p95 |
|---|---|---|---:|---:|---:|
| FOSS Earth | WebGPU | Mapterhorn mesh, USGS imagery | 59 | 2.0 ms | 4.6 ms |
| FOSS Earth | WebGL2 | Mapterhorn mesh, USGS imagery | 60 | 1.2 ms | 4.5 ms |
| [CesiumJS](https://github.com/CesiumGS/cesium) 1.131 | WebGL | Re:Earth quantized-mesh, Esri imagery | 58 | 2.1 ms | 3.1 ms |
| [MapLibre GL](https://maplibre.org/projects/gl-js/) 5.6 | WebGL | Mapterhorn terrain, Esri imagery | 60 | 1.7 ms | 2.4 ms |
| [WorldWindJS](https://github.com/WorldWindEarth/worldwindjs) 1.9 | WebGL | Blue Marble / Landsat | 57 | 5.0 ms | 12.1 ms |

Same viewport, same eight-second camera path, six seconds of warmup, 23 Sep 2026. The script is [`benchmarks/globe-compare/run.mjs`](benchmarks/globe-compare/run.mjs) and the numbers are in [`benchmarks/globe-compare/results.json`](benchmarks/globe-compare/results.json). Chrome reported `ANGLE Metal Renderer: Apple M5`, so this was not a software GPU.

The meshes are not the same. Cesium draws quantized-mesh tiles, MapLibre drapes a raster DEM, FOSS Earth builds a terrarium mesh, WorldWind is a coarser globe. A cheaper callback on a lighter mesh is not a win. On this machine the three modern renderers all finished inside the frame. WebGL2 was slightly cheaper than WebGPU for this particular flight.

[Giro3D](https://giro3d.org/) and [iTowns](https://www.itowns-project.org/) are the other WebGL geospatial globes in this category. They were not in this flight.

## What you can do

- Search a place or coordinates and fly there.
- Terrain comes from streamed elevation, not a flat texture. See [Streamed terrain](docs/streamed-terrain.md).
- Switch basemaps, or supply a Google Maps Tiles API key for Photorealistic 3D Tiles.
- Search an ICAO or IATA code, pick a runway, and start in flight mode. See [Airport locations](docs/airport-locations.md).
- Tiles you have already visited stay cached.
- The HUD shows a live frame-time readout. The renderer chip says WebGPU or WebGL.

## Controls

| | Look around | Orbit | Zoom |
|---|---|---|---|
| **Mouse** | Left drag | Right drag | Wheel |
| **Trackpad** | Drag | Shift + swipe | Pinch |
| **Touch** | One finger | Two fingers | Pinch |
| **Controller** | Left stick | Right stick | Right trigger in, left trigger out |

The **?** button shows this in the app. **N** resets the view to north-up. A controller starts on the built-in Standard profile. Controller bindings can be edited, saved, and imported or exported as JSON.

## Documentation

| Document | What it covers |
|---|---|
| [Deploying to GitHub Pages](docs/deploying.md) | `npm run deploy` |
| [Development](docs/development.md) | Local setup, tests, architecture |
| [Manual QA checklist](docs/manual-qa.md) | What to exercise before a release |
| [Streamed terrain](docs/streamed-terrain.md) | Elevation tiles and surface queries |
| [Airport locations](docs/airport-locations.md) | Airport and runway lookup |
| [Compass height model](docs/compass-height-model.md) | Camera anchor height |
| [Design proposals](docs/proposals/) | Architecture notes |

## Contributing

Bug reports and pull requests are welcome. Start with [Development](docs/development.md).

## License

[AGPL-3.0-only](LICENSE). See [NOTICE](NOTICE) for third-party terms and [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) for commercial arrangements.
