# Reporting a bug from the app

Open the **Bug report** tab from **+**, or use the **🐞** button at the bottom left
when the toolbar has room. Add a title and describe what
happened. The app prepares the activity report locally. Review it and remove any
details you do not want to share, then choose **Download report** and **Open GitHub
issue**. On GitHub, attach the downloaded `.txt` file using the file control below
the issue text, wait for the upload to finish, and submit the issue. GitHub handles
sign-in. There is no report to paste and no reporting server to operate.

GitHub [supports plain text attachments](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
The report stays on the device until you upload it. Attachments in public
repositories are publicly accessible as soon as they are uploaded; the issue is
published when you submit it. The app cannot select a file in GitHub's file picker
or attach it on your behalf across that site boundary.

The GitHub draft includes a short context summary and the report's filename.
The complete retained report goes in the file, so the draft does not need a long
URL. A long description can be kept in the file and shortened visibly in the
draft. The download contains the reviewed snapshot, including edits made in the
report box. **Refresh report** captures a new snapshot.

The toolbar shortcut defaults to **Auto**: the existing toolbar layout shows it
when it fits. Interface → Toolbar can set it to On, Auto or Off. Diagnostics'
activity-retention controls and Copy report stay in Settings → Diagnostics; the
reporting form has one home, the Bug report tab.

## What the report includes

- App build, app and FOSS Earth commits, bundled component versions and available
  component commits; whether the running page matches the published build.
- Browser user agent and available browser hints, platform, touch points,
  viewport and display dimensions, pixel ratio, orientation and page state.
- Requested and active renderer, fallback reason, GPU/driver details and graphics
  capabilities exposed by the active engine, including context/device losses.
- All effective registered settings, including device-derived defaults and
  provenance; private coordinates and secret values are omitted.
- Retained activity, setting changes, scene and panorama transitions, warnings,
  unhandled errors, and the previous visit's trail, including an interrupted visit.

The report captures what the browser and app expose; it cannot obtain a phone's
OS crash dump or guarantee its exact physical model or RAM. Activity is bounded
by Settings → Diagnostics → Steps kept. It does not turn on performance tracing,
continuous recording or an extra renderer. The
[diagnostics documentation](diagnostics.md) describes local retention and the
report-only `?report` recovery page.

The publication preview removes registered secrets and recognized credentials,
email addresses, URL queries/fragments and keyed coordinates, including values in
error and console text. It remains editable because automatic filtering cannot
recognize every personal detail. No report is sent while it is prepared or
downloaded.

## One implementation, three applications

FOSS Earth owns report capture, sanitization, downloads and the issue-draft UI.
The consuming build's existing `__REPOSITORY_SLUG__` chooses the destination:

| Application | Issue repository |
| --- | --- |
| FOSS Earth | `foss-earth/foss-earth.github.io` |
| 0SFS | `0SFS/0SFS.github.io` |
| UMN tour | `UMN-VR/UMN-VR.github.io` |

`mountGlobeApp` and `createGlobeApp` provide the feature, including the report-only
page. A host can override the repository and display name with `issueReporter:
{ repository, appName }`. A composed app consumes `startAppDiagnostics`,
`getAppIdentity`, `reportSecrets` and `issueReporterFromBuild` from
`foss-earth/diagnostics`, and `createBugReportPanel` from `foss-earth/shell`.
The overlay calls the panel's `show()` only when its Bug report tab opens.
0SFS adds flight and JSBSim state in its own repository. The tour's scene and
photograph revisions are already part of the shared scene diagnostics.

Give an agent the resulting issue URL or a repository-qualified issue number,
such as `UMN-VR/UMN-VR.github.io#123`. A bare `#123` is ambiguous across the three
repositories. The report identifies the code that ran; a globe defect is fixed in
FOSS Earth, a flight defect in 0SFS, and tour content in the tour repository.
