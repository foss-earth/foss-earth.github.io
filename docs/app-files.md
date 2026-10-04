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
  host that lets the browser keep a file for a while, as GitHub Pages does. After a new
  version, the page loads its new files while the old worker still controls it, and the old
  worker does not list them; when the new one takes over, the page names them again, to it.
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

| Where | App files loaded | First visit | Reload | Revisit |
| --- | ---: | --- | --- | --- |
| The UMN tour's build (`dist-app`) | 63 | all from the network, and again for the worker to keep, since the check sends no cache headers; all 63 kept | none from the network | none from the network |
| <https://umn-vr.github.io/tour/twin-cities/>, a new visitor | 63 | 1.66 MiB from the network; all 63 kept | all 63 from the worker, none from the network | all 63 from the worker, none from the network |
| The same, a visitor back after a deploy, with the old version's worker | 63 | the 5 files the deploy changed from the network, 1.48 MiB, and 58 from the old worker; the new one took over and kept all 63 | all 63 from the worker | all 63 from the worker |
| <https://foss-earth.github.io/>, a new visitor | 3 | 1.64 MiB from the network; kept | all 3 from the worker | all 3 from the worker |

The live reloads and revisits ran with the browser's HTTP cache off, as a visit after its ten
minutes would find it. Every deploy of an app changes five of the tour's files: its main
script carries the time it was built, and four others import it by its hashed name. A visitor
back after a deploy downloads those, about 1.5 MiB, once.

The check runs in Chrome only. The live tour's worker was also tried in headless Firefox 157
that day, by hand: the first visit downloaded the 63 files, 1.66 MiB, and the worker took
control and kept all 63; two reloads started the app under the worker with nothing from the
network. Firefox's resource timing does not say that its worker answered a file, so the kept
files were counted in its cache.

It was tried in WebKit 26.0, Safari's engine as Playwright builds it, on 2026-10-04, by hand
against the live tour: after the first visit the worker controlled the page and had kept all
63 files, a reload took none of them from the network, and inside a 360 image entered then
all 28 tiles in view loaded, which the worker lets by. That was so in three runs. In one
other, the first after WebKit was installed, the first visit stayed at 4 of its 60 orbs; it
did not happen again and is not explained. The worker has not been run in Safari itself, nor
on a phone.
