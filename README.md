# FOSS Earth landing page

This repository owns the thin public landing page. The standard globe application
is developed in [foss-earth/app](https://github.com/foss-earth/app) and served from
this site's `/app/` path as an exact compiled artifact. Application and provider
source belongs in its independent checkout.

## Assemble and check

`app-release.json` records the app source revision, `/app/` base, immutable archive
path, SHA256, byte count and every compiled file's identity. Place the exact
archive at its recorded repository-local `deps/` path. Assembly verifies the
archive and all entries before publishing the local output; links, unsafe paths,
extra files and missing files are rejected. It preserves prior owned assemblies
under ignored `build/assembly-retained/` and refuses to replace unmarked output.

```sh
npm ci
npm run ci
npm run dev -- --port 4174
```

`build` assembles the landing page and app under `dist/`. `dev` explicitly serves
that existing output at `http://127.0.0.1:4174/`; it does not compile the app or
start another process. `test` exercises exact artifact verification and local
route/worker boundaries with Node's built-in test runner. `check:conformance`
uses the same pinned shared CI component as the app and component owners.
Migration checks and servers follow the coordinator's shared verification grant.

The app archive is consumed unchanged: app assets and its service worker stay
inside `/app/`, and the landing page links to `/app/`. Local verification does not
establish remote admission or authorize Pages deployment. Exact release receipts
and rollout decisions remain separate from source preparation.

The shared `@foss-earth/dev-installer` owns source/package/hybrid workspace
selection. Run application development in the real app checkout, with one public
provider per independent component checkout. This landing assembly adds no
provider dependency or alternative setup machinery.

## Project policies

- [Code of conduct](https://github.com/foss-earth/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/foss-earth/.github/blob/main/CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](https://github.com/foss-earth/.github/blob/main/SECURITY.md)

Preserve [NOTICE](NOTICE), [commercial licensing](COMMERCIAL_LICENSE.md) and
asset-specific rights. The project license does not relicense external imagery,
data or inherited assets.
