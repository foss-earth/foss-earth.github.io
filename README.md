# FOSS Earth landing page

The site at https://foss-earth.github.io/: a landing page at `/` and the Earth
app at `/app/`. The app itself is developed in
[foss-earth/app](https://github.com/foss-earth/app); this repository only copies
its build into the site.

## Build and preview

With [app](https://github.com/foss-earth/app) checked out next to this
repository (see its README):

```sh
cd ~/gh/foss-earth/app && npm run build
cd ../foss-earth.github.io && npm run build
npm run preview
```

`build` puts the site in `dist/`: `index.html` and `landing.css`, the app's
`dist/` under `app/`, and `foss-earth-sw.js`. `preview` serves `dist/` at
http://127.0.0.1:4174/.

The app used to be served at the root, so two things keep old visitors working:

- Old links to the app carry its state in the query or hash, so the landing page
  sends any URL with a query or hash to `/app/` with them.
- The app kept its files on visitors' devices with a service worker at
  `/foss-earth-sw.js`. The file at that address now deletes those files and
  unregisters the worker; the app's current worker lives under `/app/`.

## Deploy

```sh
cd ~/gh/foss-earth/app && npm run build
cd ../foss-earth.github.io && npm run build && npm run deploy
```

publishes `dist/` to the `gh-pages` branch, which GitHub Pages serves. That
branch also holds pages that aren't built here, `/eac-prototype/` and
`/examples/`; deploying keeps them and replaces everything else. The same
steps are written in
[foss-earth/docs](https://github.com/foss-earth/docs/blob/main/docs/deploying.md)
so the other repositories can find them. Pushing `main` does not run this.

## Project policies

- [Code of conduct](https://github.com/foss-earth/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/foss-earth/.github/blob/main/CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](https://github.com/foss-earth/.github/blob/main/SECURITY.md)

Preserve [NOTICE](NOTICE), [commercial licensing](COMMERCIAL_LICENSE.md) and
asset-specific rights. The project license does not relicense external imagery,
data or inherited assets.
