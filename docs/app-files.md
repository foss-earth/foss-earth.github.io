# The app's own files

FOSS Earth keeps an app's own files (its scripts, styles and workers) on the visitor's device
once they have been downloaded, so a later visit asks the network for none of them, however
long ago the last one was. A service worker does it, as Settings → App files → Keep the app's
files asks. Scene images are kept apart, by the scene loader under their revisions
([scenes/format.md](scenes/format.md#saved-images)).

The page itself is not kept, and a browser may still show its own copy of an older one: the
app asks the site which version it publishes and reloads a page that is older
([The page, and a browser's copy of it](#the-page-and-a-browsers-copy-of-it)).

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
- **It never keeps the page.** The page is the browser's to ask the network for, so a new
  version of the app shows on a visit that asks. Its new file names are downloaded once, and
  when the new worker takes over it deletes the files only the old version listed. Navigation
  preload asks for the page while the worker starts, so the worker adds no wait before it; if
  that request fails, the worker asks once more, as a page without it would. A browser does not
  always ask: see below.
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

## The page, and a browser's copy of it

A browser asks the network for a page it opens, and GitHub Pages lets it use its copy for ten
minutes. A browser that restores a tab does not ask: it shows the copy it has, however old, and
with it the app of that day, whose files are still published. A phone does this whenever it
comes back to a tab it had let go.

On 2026-10-03 an iPhone showed the UMN tour's page of the day before, an hour after a release,
and that app refused the new scene. On 2026-10-04 the same phone, tried again after another
release, was still running the app built on 2026-10-03 at 05:33 UTC, four releases old: its
Settings tab had three sections, where every app since that evening has App files and that
day's has Diagnostics too. The tour worked, since its scene had been rewritten for old apps,
and nothing said that none of two days' work was running: the trial of that app's crashes was
a trial of the old one.

So the app asks, and a build says which build it is:

- **Each page of a build carries its build's time**, in `<meta name="foss-earth-build">`,
  written by the `appFiles` plugin. It is the time Settings → About shows.
- **The app asks the site for its own page** (`fetch` with `cache: "no-cache"`), as it starts,
  when the page is shown again or the network is back, and every ten minutes while it is
  shown, and compares the stamp in the answer with its own page's. The answer is the page, a
  few kilobytes, or a few hundred bytes when it has not changed; asking also replaces the
  browser's copy with the published page.
- **A page that is older and that nobody has touched reloads itself**, and the page that comes
  says so in its log: "This browser opened its own copy of an older page of the app, built
  2026-10-03 05:33 UTC. The page reloaded itself, and this is the published version, built
  2026-10-04 17:33 UTC."
- **It reloads itself once for a published version.** A browser that answers the reload with
  its old copy again is not asked forever: the tab remembers, in `sessionStorage`, what it was
  reloaded for, and the page says "This browser still shows its own copy of an older page",
  with a Reload button. A page that a reload showed, in a tab that remembers no reload, does
  not reload itself either: the tab's storage did not outlive the reload, or a person
  reloaded.
- **A page that has been touched is never reloaded by itself.** Its log says "This page is an
  older version of the app, built …: the published one was built …. Reload to use it.", with
  a button. A release while a person is looking at a photograph does not take it away.
- **A page the site answers with that is older than this one** is left alone: a host can take
  a while to publish a release everywhere.
- **Settings → App files** says which of these the page is, when the site was asked, and has
  Ask now, and Reload to use the published version on an older page. The diagnostics report
  has the same line, and so has the report-only page (`?report`), which asks and stays.

| Parameter | Default | |
| --- | --- | --- |
| Ask which version is published (`app.checkPublished`) | on | Off asks nothing; the app is whichever one the browser shows |
| Ask again after (`app.checkPublishedEvery`) | 10 min | GitHub Pages' own time for a browser's copy of a page |
| Reload an older page by itself (`app.reloadOlderPage`) | on | Off always leaves it to the button |

A page with no stamp asks nothing: a development server's, or an app built without the plugin.
An app that was published before this cannot be reached by it: a browser that holds a copy of
such a page shows it until a person reloads the tab, or opens the address in a new one.

### What a published page says

The plugin also writes the commits a build was made from, so the page's source says what a
site publishes, and the app what a device runs ([diagnostics.md](diagnostics.md#which-version-runs)):

```sh
curl -s -A foss-earth-check/1.0 https://umn-vr.github.io/tour/twin-cities/ | grep -o '<meta name="foss-earth[^>]*>'
```

```html
<meta name="foss-earth-build" content="2026-10-04T19:45:33.269Z">
<meta name="foss-earth-app-source" content="a2c6c2894d5b">
<meta name="foss-earth-source" content="35ad0e3f8037">
```

`foss-earth-app-source` is the app's own commit, where its Vite config defines
`__SOURCE_VERSION__`, and `foss-earth-source` FOSS Earth's, in an app of another repository.
A commit ends in `-dirty` where the build had changes not committed: for FOSS Earth, changes
to what an app is built from (`src`, `vite`, `package.json`, `package-lock.json`).

## Using it in an app

The worker is written into a build by a Vite plugin, `appFiles` in
[vite/appFiles.ts](../vite/appFiles.ts), which an app adds to its `vite.config.ts`:

```ts
import { appFiles } from "foss-earth/vite";

export default defineConfig({ plugins: [react(), appFiles()] });
```

It writes `foss-earth-sw.js` at the root of the build, listing every built file with a hash in
its name, and tells the app where it is; [src/app/appFiles.ts](../src/app/appFiles.ts)
registers it. A development server gets no worker and no stamp. An app built without the
plugin keeps nothing, cannot tell an older page from the published one, and says both in
Settings → App files. The worker needs a secure page (https, or
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

On 2026-10-04 the tour's app was deployed again, and a visitor holding the worker of the
evening before took the 6 files that deploy changed from the network, 1.50 MiB, and 57 from
the old worker; the new worker kept all 63, and the reload and the revisit took none from the
network (`2026-10-04_123800-update-path`). At 15:32 that day it was deployed with the version
check below, and a visitor holding the 12:33 worker took the 5 files that deploy changed,
1.49 MiB, and 58 from the old worker; the reload and the revisit took none
(`2026-10-04_153700-update-path`).

It was tried in WebKit 26.0, Safari's engine as Playwright builds it, on 2026-10-04, by hand
against the live tour: after the first visit the worker controlled the page and had kept all
63 files, a reload took none of them from the network, and inside a 360 image entered then
all 28 tiles in view loaded, which the worker lets by. That was so in five runs, three on the
app of the evening before and two on that day's. In one other, the first after WebKit was
installed, the first visit stayed at 4 of its 60 orbs; it did not happen again and is not
explained. The worker has not been run in Safari itself, nor
on a phone.

### An older copy of the page

[scripts/validation/published-version.mjs](../scripts/validation/published-version.mjs) is the
site and the browser's copy both. It answers the browser's requests for the page, navigations,
with the build's page under a stamp two days older, for as long as the case says the browser
still has that copy, and the app's own question with the published page. On 2026-10-04, at a
phone's screen size, on FOSS Earth's own build and on the UMN tour's:

| Case | What happened |
| --- | --- |
| The published page | asked the site once, reloaded nothing, and its log said nothing of versions; Settings → App files said so, and Ask now asked again |
| An older copy, opened once | reloaded itself once into the published page, whose log said so; the copy's trail ended as closed, with why it went, and was not taken for a crash |
| An older copy the browser keeps answering with | reloaded itself once and no more; its log said the browser still shows its copy, with a button, and Settings → App files offered the reload, inside a 414 px wide screen; once the browser let go of the copy, the button reloaded into the published page |
| An older copy a person touched before the answer came | did not reload itself; its log said a newer version is published, and its button reloaded |
| Reload an older page by itself, off | waited for the button |
| Ask which version is published, off | asked the site nothing |
| A release while the page is open | an untouched page reloaded itself into the release at its next question |
| The report-only page (`?report`) on an older copy | said which version it is and which is published, and stayed |
| An older copy under the app's worker | Chrome only: the worker let the question and the reload through, and the copy reloaded itself once |

All of them passed in Chrome 154, Firefox 157 and WebKit 26.0, the last case in Chrome, which
alone lets the check answer a service worker's requests, on the code as committed (FOSS Earth's
build: `2026-10-04_152138`, `_152210`, `_152242`; the tour's: `_152330`, `_152400`,
`_152432`). With the question asked on every visit, `app-files.mjs` on the tour's build still
counted no app file from the network on a reload and a revisit (`2026-10-04_152504`).

The browser's copy here is the check's stand-in. What Safari on a phone does when it restores
a tab, and whether a page there reloads itself out of that copy, has not been seen: the
iPhone that showed the fault holds a page from before this, which cannot do it.

It was deployed on 2026-10-04 at 15:32, on this site and the UMN tour. On the live tour, at a
phone's viewport in Chrome 154, Firefox 157 and WebKit 26, the page found itself to be the
published version, and its log's first line said "App built 2026-10-04 20:32 UTC from 54b9bea
with FOSS Earth d538bfa". Asking cost 300 bytes in Chrome, which was told the page had not
changed, and 1.7 KiB in Firefox and WebKit, which took the page again; on this site, 300
bytes in Chrome. A page reloading itself out of an older copy is first possible at the release
after this one.
