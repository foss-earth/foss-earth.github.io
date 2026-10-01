# Chrome's code-sign clones

A headless run that does not let Chrome shut down by itself leaves a full copy of the Chrome
app under `/private/var/folders`, and nothing removes it until the Mac restarts. This page
says what those folders are, how a script strands one, and how to check for them. It applies
to every repository that drives the installed Google Chrome, 0sfs and the UMN tour included.

## What they are

The folders look like this, one per stranded launch, 1.4 GB each by `du`:

```
/private/var/folders/…/X/com.google.Chrome.code_sign_clone/code_sign_clone.kxcWJv/Google Chrome.app.bundle
```

They are not downloads. Every time the installed Google Chrome starts, headless or not, it
makes a copy-on-write clone of its own app bundle, so that its code signature stays valid if
an update replaces the app while it is running. The code is
`chrome/browser/mac/code_sign_clone_manager.mm` in Chromium.

- Chrome deletes the clone only on a clean shutdown. Its shutdown path starts a small helper
  process (`--type=code-sign-clone-cleanup`) that waits for the browser to exit and then
  deletes the folder. A Chrome that is killed never starts the helper.
- macOS empties the `X` folder at boot and at no other time, so on a machine that stays up
  for weeks the stranded clones add up.
- Chromium turns the feature off for Chrome for Testing, the browser Playwright downloads.
  Only runs that use the installed `/Applications/Google Chrome.app` make clones, which is
  every harness here, since they need the real GPU.
- `du` counts each clone in full. They are copy-on-write, so they share their blocks with the
  installed app for as long as that version is installed. The real cost was not measured.

## What strands one

Measured on 2026-10-01 with Chrome 154 on `about:blank`, each launch held open for four
seconds:

| How Chrome was closed | Clones left |
| --- | --- |
| `Browser.close`, then `SIGTERM` at once (the helper before the fix) | 3 of 3 |
| `Browser.close`, then wait for Chrome to exit | 0 of 6 |
| `SIGKILL` | 1 of 1 |

`Browser.close` answers before Chrome has exited. A signal sent straight after it lands in
the middle of the shutdown, and Chrome dies before it starts the cleanup helper.

## Rules for a script that launches Chrome

- Drive Chrome through [scripts/lib/headlessChrome.mjs](../../scripts/lib/headlessChrome.mjs)
  (in 0sfs, `scripts/headless-chrome.mjs`) and `await chrome.close()` on every path, in a
  `finally`. `close()` sends `Browser.close` and waits up to 10 seconds for Chrome to exit
  before it signals; a normal exit takes about 100 ms.
- With Playwright and the installed Chrome (`executablePath` or `channel: "chrome"`), put
  `await browser.close()` in a `finally`. Playwright kills the browser when its script dies
  without closing it, so an uncaught error strands a clone.
- Never send Chrome a signal after `Browser.close`. Wait for the process to exit.
- Stopping a run part way (`pkill`, a stopped background task, a tool timeout) strands a
  clone, and no script can prevent that. Let a run finish when you can. When you have to
  stop one, check afterwards.

## Checking and clearing

```sh
ls "$(getconf DARWIN_USER_TEMP_DIR)../X/com.google.Chrome.code_sign_clone" | wc -l
```

Each running Chrome owns one clone. With no Chrome running the count should be zero, and
anything there is stranded. To clear them, first confirm nothing is running
(`pgrep -fl "Google Chrome"` prints nothing), then:

```sh
rm -rf "$(getconf DARWIN_USER_TEMP_DIR)../X/com.google.Chrome.code_sign_clone"/code_sign_clone.*
```

This folder is outside every repository. Remove a clone your own run just stranded, which
its creation time identifies; for older ones, tell the user the count and give them the
command.

## What happened

On 2026-10-01 there were 16 clones, 23 GB by `du`, on a Mac that had been up since
September 20. Each was created within seconds of an agent command that launched Chrome:

| Date | Clones | Scripts | Cause |
| --- | --- | --- | --- |
| September 25 | 4 | `benchmarks/map-detail/run-binding.mjs`, `run-sweep.mjs` (Playwright) | Not established for each run. They were long background runs, and some were stopped. |
| September 27 | 2 | The UMN tour's `capture-ada.mjs`, `capture-viewer.mjs` (Playwright) | The scripts died on an uncaught `TimeoutError` before `browser.close()`. |
| September 29 | 10 | `benchmarks/scene-ab/run.mjs`, `scripts/validation/panorama-campus.mjs` | The helper sent `SIGTERM` straight after `Browser.close`. |

The helper was fixed in both repositories that day, and `benchmarks/globe-compare/run.mjs`
was given the `finally` it lacked. One thing is unexplained: the same helper ran dozens of
times on September 26 and 27 under Chrome 153 and left nothing. Chrome updated to 154 at
18:11 on September 29, and the first of that day's clones appeared a minute later.
