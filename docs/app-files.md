# The app's own files

FOSS Earth keeps an app's own files (its scripts, styles and workers) on the visitor's device
once they have been downloaded, so a later visit asks the network for none of them, however
long ago the last one was. A service worker does it, as Settings → App files → Keep the app's
files asks. Scene images are kept apart, by the scene loader under their revisions
([scenes/format.md](scenes/format.md#saved-images)).

## Why

GitHub Pages sends every file with `Cache-Control: max-age=600`: the browser may use its copy
for ten minutes and must then ask again. Its answer to that question was often the whole file
rather than "unchanged". On a visit to the UMN tour 11 minutes after the last, the browser asked
for every file of the app again, and 1.55 of its 1.72 MiB came again in full
([proposals/panorama-scenes.md](proposals/panorama-scenes.md), "Loading once"). A host's
headers are not the app's to change, and a page cannot make the browser trust its copy for
longer. A service worker can, for files that cannot change: every file Vite builds carries its
content's hash in its name (`index-BTEeolEJ.js`), so a copy kept under that name is the file.

## What it does

- **It answers the build's files from the device.** The worker lists the build's file names.
  The first time the app asks for one, the worker fetches it and keeps it in Cache Storage;
  from then on it answers from there without asking the network. A file it does not list
  passes by untouched: scene manifests and images, map tiles, other sites, and any file whose
  name has no hash.
- **It never keeps the page.** The page always comes from the network, so a new version of the
  app shows on the next visit. Its new file names are downloaded once, and when the new worker
  takes over it deletes the files only the old version listed. Navigation preload asks for the
  page while the worker starts, so the worker adds no wait before it; if that request fails,
  the worker asks once more, as a page without it would.
- **It keeps what loaded before it.** The worker installs after the page has loaded, so as not
  to compete with the app starting, and so it does not see the files the first visit loaded.
  The page tells it which of the app's files it loaded, then and later, and the worker keeps
  them from the browser's own cache, where they still are: nothing is downloaded twice on a
  host that lets the browser keep a file for a while, as GitHub Pages does.
- **It covers the app's base.** It is registered for the folder the app is built for
  (`import.meta.env.BASE_URL`), not the page's own folder, so the workers the app starts from
  its `assets/` folder are answered too. On the UMN tour that is the whole site: the club's
  landing page passes through it untouched.
- **Off removes it.** Turning the setting off tells the worker to stop keeping, unregisters it
  and deletes what it kept; the page keeps working, and the browser's own cache applies again.
  Settings → App files shows what is kept and whether this visit was answered from it.

Nothing is fetched ahead: a file is kept when the app first asks for it, so a visit downloads
only what it uses, once.

## Using it in an app

The worker is written into a build by a Vite plugin, `appFiles` in
[vite/appFiles.ts](../vite/appFiles.ts), which an app adds to its `vite.config.ts`:

```ts
import { appFiles } from "foss-earth/vite";

export default defineConfig({ plugins: [react(), appFiles()] });
```

It writes `foss-earth-sw.js` at the root of the build, listing every built file with a hash in
its name, and tells the app where it is; [src/app/appFiles.ts](../src/app/appFiles.ts)
registers it. A development server gets no worker. An app built without the plugin keeps
nothing and says so in Settings → App files. The worker needs a secure page (https, or
localhost), and some private windows turn service workers off.

## Checking it

[scripts/validation/app-files.mjs](../scripts/validation/app-files.mjs) opens a build in
headless Chrome, serves it by intercepting every request of the browser (the worker's as well
as the page's) with no cache headers, and counts which of the app's files reach the network on
a first visit, a reload and a visit in a new browser on the same profile. With `--url` it reads
a live site, with the browser's HTTP cache turned off for the reload and the revisit, as a visit
after the host's ten minutes. Intercepting requests per page, as the other validation scripts
do, does not reach the worker's own requests: there the worker fails to register, and the app
runs without it.

On 2026-10-03, on this machine's Chrome 154:

| Build | App files loaded | First visit | Reload | Revisit |
| --- | ---: | --- | --- | --- |
| UMN tour (`dist-app`) | 63 | all from the network; the worker kept all 63 | none from the network | none from the network |
| FOSS Earth, no scene | 3 | all from the network; kept | none | none |

The first visit's files were each asked for twice in that check, once by the page and once by
the worker keeping them, because the check sends no cache headers; on a host that does, the
worker's copy comes from the browser's cache.
