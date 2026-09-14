# FOSS Earth

A photorealistic 3D globe that runs in your browser. Fly anywhere on Earth over real terrain and
real imagery — no install, no account, no sign-up.

### **[→ Open FOSS Earth](https://foss-earth.github.io/)**

That link is the app. It is free, it works on phones and desktops, and it stays up to date on its
own. There is nothing to download.

## What you can do

- **Go anywhere.** Search a place name or coordinates and fly to it.
- **Real terrain.** Mountains, valleys and coastlines are built from streamed global elevation
  data, not a flat texture.
- **Pick your map.** Switch between free open basemaps, or bring your own Google Maps Tiles API key
  for Google's Photorealistic 3D Tiles.
- **Airports and flight mode.** Search an ICAO or IATA code, pick a runway and a direction, and
  start there — see [Airport locations](docs/airport-locations.md).
- **Works offline-ish.** Tiles you have already visited are cached, so revisiting an area is fast.
- **Light and dark themes**, a live performance readout, and WebGPU rendering where your browser
  supports it.

## Controls

| | Look around | Orbit | Zoom |
|---|---|---|---|
| **Mouse** | Left drag | Right drag | Wheel |
| **Trackpad** | Drag | Shift + swipe | Pinch |
| **Touch** | One finger | Two fingers | Pinch |

The **?** button in the bottom bar shows this in the app. The **N** button resets the view to
north-up.

## Documentation

| Document | What it covers |
|---|---|
| [Deploying to GitHub Pages](docs/deploying.md) | Publishing the live site — one command, `npm run deploy` |
| [Development](docs/development.md) | Running the code locally, tests, and building your own copy |
| [Manual QA checklist](docs/manual-qa.md) | What to exercise by hand before a release |
| [Streamed terrain](docs/streamed-terrain.md) | How elevation tiles are streamed and queried |
| [Airport locations](docs/airport-locations.md) | Airport and runway lookup in flight mode |
| [Compass height model](docs/compass-height-model.md) | How camera anchor height is resolved and smoothed |
| [Design proposals](docs/proposals/) | Architecture proposals and implementation appendices |

## Contributing

Bug reports and pull requests are welcome. Start with [Development](docs/development.md) for setup,
the test suite, and architecture notes.

## License

FOSS Earth is licensed under [AGPL-3.0-only](LICENSE). See [NOTICE](NOTICE) for third-party terms
and [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) for commercial arrangements.
