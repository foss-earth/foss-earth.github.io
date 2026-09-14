# Development

This page is for people who want to change the code. If you just want to use FOSS Earth, open
[the live site](https://foss-earth.github.io/) — it is the same build, always current,
and needs no setup.

## Requirements

- Node.js 22 or newer
- npm
- A built checkout of [gamepad-tools](https://github.com/Felipegalind0/gamepad-tools) beside this
  one (see below)
- Optional: a Google Maps Tiles API key with the Maps Tiles API enabled

## Running locally

FOSS Earth takes its controller and keyboard bindings from gamepad-tools, linked from a sibling
folder: `package.json` depends on `file:../Felipegalind0/gamepad-tools`. A fresh clone of this
repository alone fails `npm ci`. Clone both into the same parent folder:

```text
<parent>/
├── foss-earth/              this repository
└── Felipegalind0/
    └── gamepad-tools/
```

gamepad-tools does not commit its compiled output. Its package exports point at `dist/`, which is
gitignored, so build it before installing here:

```sh
git clone https://github.com/Felipegalind0/gamepad-tools.git Felipegalind0/gamepad-tools
(cd Felipegalind0/gamepad-tools && npm install && npm run build)
git clone https://github.com/foss-earth/foss-earth.github.io.git foss-earth
cd foss-earth
npm ci
npm run dev
```

Open the Vite URL printed by the dev server.

npm links the sibling folder instead of copying it, so FOSS Earth sees changes there without
reinstalling. But its code is read from `dist/`, so run `npm run build` in gamepad-tools after
changing its source. Its `styles.css` is the one export read straight from `src/`.

## Google Photorealistic 3D Tiles

The free raster basemaps need no key. To enable Google's Photorealistic 3D Tiles, pass your own
Maps Tiles API key as a query parameter:

```text
http://127.0.0.1:5173/?key=YOUR_GOOGLE_MAPS_API_KEY
```

Without a key the app starts in fallback mode and shows the fallback notice in the lower-left
corner. The key stays in your browser; it is never committed or sent anywhere but Google.

## Quality checks

```sh
npm run lint
npm run test
npm run build
```

Or the exact sequence CI uses:

```sh
npm run ci
```

The suite covers camera and geodetic math, terrain streaming, and jsdom smoke tests for app
startup, URL key parsing, north-up reset behavior, layer lifecycle delegation, and cleanup.
`npm run test:watch` reruns on change.

See [Manual QA checklist](manual-qa.md) for what to exercise by hand before a release.

## Running your own copy

You generally should not need to. The hosted site is the same code, it updates automatically, and
self-hosting gains you nothing unless you are modifying the source. If you are modifying the
source — or you want a copy that will not change under you — build the static bundle:

```sh
npm run build
npx vite preview
```

`dist/` is a plain static directory. Any static host will serve it, so long as the Vite `base` in
`vite.config.ts` matches the path it is served from. For GitHub Pages specifically, see
[Deploying to GitHub Pages](deploying.md).

Note the license terms in [NOTICE](../NOTICE) before publishing a modified copy: FOSS Earth is
AGPL-3.0-only, so a network-accessible deployment must offer its users the corresponding source.

## Architecture notes

- [Streamed terrain and visible-surface queries](streamed-terrain.md)
- [Compass height model](compass-height-model.md)
- [Airport locations](airport-locations.md)
- [Design proposals](proposals/)

## Asset sources

- Non-clicked gesture icons (outline/no fill, for example 2-finger swipe):
  https://www.svgrepo.com/collection/mobile-gestures-with-arrows/
- Click gesture icons: https://www.svgrepo.com/collection/libre-variety-filled-icons/
