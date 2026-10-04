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

The free raster basemaps need no key. To enable Google's Photorealistic 3D Tiles, paste your own
Maps Tiles API key in Map → Source, or pass it once as a query parameter:

```text
http://127.0.0.1:5173/?key=YOUR_GOOGLE_MAPS_API_KEY
```

The app saves the key in this origin's local storage and removes it from the address bar, so later
visits need no `?key=` and links you copy do not carry it. Without a key the app starts in fallback
mode and shows the fallback notice in the lower-left corner. The key is never committed or sent
anywhere but Google.

## Testing on a phone

To open a local server on a phone without typing its address, serve on the local network and
scan a QR code:

```sh
npm run dev -- --host        # or: npm run build && npm run preview -- --host
npm run qr                   # in another terminal
```

`npm run qr` ([scripts/lan-qr.mjs](../scripts/lan-qr.mjs)) draws the code in the terminal. The
code opens this computer's Wi-Fi or Ethernet address, at the port of whichever server answers
there: 5173 for dev, 4173 for preview. It includes your Google key, which the app saves on the
phone as it would from any `?key=`. The code is made on this computer, with nothing sent
anywhere. `--path=/some/page/` opens another page. `--query=set.<id>=<value>` adds a parameter,
and can be repeated. `--port` and `--host=<address>` override the port and the address, when the
one chosen is not the phone's network. `--no-key` leaves the key out, and `--help` lists all of
them.

The key comes from `FOSS_EARTH_GOOGLE_KEY` in the environment, or else from that line in this
checkout's `.env.local`, which git ignores and Vite refuses to serve. With neither, the first run
asks for the key and saves it there. The printed address hides the key, but the code carries it,
so don't share a picture of the code.

An application that links FOSS Earth gets the same command as `foss-earth-qr`, such as the UMN
tour's `npm run qr`. It reads the key from FOSS Earth's `.env.local` wherever it runs. An
application installed before the command existed needs `npm rebuild foss-earth` to link it.

- A phone's browser gives no WebGPU over plain HTTP, since WebGPU needs a secure context, so
  the app draws with WebGL there.
- If your key is restricted to certain websites, Google refuses it from this computer's LAN
  address until you add the address to the key's restrictions.
- If the macOS firewall is on, allow Node's incoming connections when asked, or the phone
  cannot connect.

The log's first line says which version the phone runs: the build's time and its commits. A
phone that comes back to a tab may show its own copy of an older page; a page built with the
`appFiles` plugin notices and reloads itself ([app-files.md](app-files.md#the-page-and-a-browsers-copy-of-it)).
When something goes wrong on the phone, Settings → Diagnostics → Copy report gives what the app
knows as text, and `?report` in the address shows it when the app does not stay open:
[diagnostics.md](diagnostics.md), which also says how to attach a browser's inspector to a phone.

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
startup, URL key parsing, north-up reset behavior, layer lifecycle delegation, and cleanup. The
built-in controller profile is tested against simulated gamepad input: stick, trigger and button
directions, the deadzone, and capture suppression.
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
