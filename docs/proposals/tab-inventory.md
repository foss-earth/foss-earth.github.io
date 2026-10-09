# Shared tab inventory and repository decisions

Audited against the source on 2026-10-08. This inventories the **13 current
shared tab IDs** and records a decision for each. Repository names below are
proposed extraction targets, not completed packages. The editable architecture
map is [repository-split-graph.json](repository-split-graph.json); its
[graph and ownership notes](repository-graphs.md) explain the wider split.

The default is one feature tab per feature repository. Every departure below
has a specific reason. UI placement alone does not transfer an implementation
to another owner. Each feature supplies its settings, panel and diagnostics
through public contribution contracts.

## All current shared tabs

The complete ID unions are in
[WindowOverlay.tsx, line 31](../../src/shell/WindowOverlay.tsx#L31).
The labels are defined at
[line 181](../../src/shell/WindowOverlay.tsx#L181) and
[line 189](../../src/shell/WindowOverlay.tsx#L189). There are no other production
shared tab definitions hidden in a second host.

| Tab | ID | Current source | Proposed owner and exact decision |
| --- | --- | --- | --- |
| Location | `location` | [Definition](../../src/shell/WindowOverlay.tsx#L189), [panel integration](../../src/shell/WindowOverlay.tsx#L419) | **Provisionally `foss-earth/engine`; separate `foss-earth/location` remains undecided.** Place/airport providers, result persistence and search budgets could form an independently useful package. Camera placement, terrain height/datum conversion and world navigation stay in engine. Establish that provider/result/placement boundary before choosing whether Location gets its own repo; its current imports are not a permanent reason to retain everything together. |
| Controls | `controls` | [Definition](../../src/shell/WindowOverlay.tsx#L181), [globe sections](../../src/app/createGlobeApp.ts#L740) | **Shared contribution tab, initially engine input + gamepad-tools.** Camera motion and world gestures remain globe behavior; controller discovery/device handling remains gamepad-tools. A consuming app can add its own action bindings without either shared owner importing that app. These are separate responsibilities presented in one Controls tab, so a repository named Controls would not own all of them. |
| Interface | `interface` | [Definition](../../src/shell/WindowOverlay.tsx#L181), [sections](../../src/app/createGlobeApp.ts#L752) | **Shared contribution tab: `foss-earth/ui` + `foss-earth/toolbar`, with feature-owned readings/settings.** UI owns generic windows/widgets and theme/presentation mechanics. Toolbar owns bottom-bar layout and registered launchers/values. Position and search services retain their world owners. Putting their controls together does not make the toolbar own navigation or geoid computation. |
| Settings | `settings` | [Definition](../../src/shell/WindowOverlay.tsx#L181), [sections](../../src/app/createGlobeApp.ts#L762) | **Shares `foss-earth/ui`.** Preset application, saved-record validation and import/export are mechanisms over one registered application record, using the same registry/widgets as other panels. Each component still owns the parameters and behavior being saved; a Settings repo must not accumulate all feature implementations. Application preset lists remain host-owned inputs. |
| Map | `map` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [host-supplied panel](../../src/app/createGlobeApp.ts#L953) | **Initially `foss-earth/engine`; a narrower Map/terrain extraction remains undecided.** This tab controls the globe's principal terrain/imagery feature: provider selection, height support, residency, detail and streaming. A candidate extraction must publish explicit surface-query, tile-readiness/revision and renderer-resource interfaces, keeping render scheduling in renderer. Decide its own repo against those responsibilities; the existing file layout is not evidence that separation is impossible. |
| Renderer | `renderer` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [panel construction](../../src/app/createGlobeApp.ts#L769) | **Own repository: `foss-earth/renderer`.** Owns device/scene/backend lifecycle, frame scheduling, readiness and the optional Renderer panel. Globe consumes renderer; renderer never imports globe code. Features may supply renderer-related sections without transferring their implementations. |
| Sky | `sky` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [panel construction](../../src/app/createGlobeApp.ts#L784) | **Own repository: `foss-earth/sky`.** Owns astronomy, clear-atmosphere illumination, stars, physical lighting and its panel. Host-injected scene-time and terrain-lighting ports prevent a dependency back into the globe. |
| Date and time | `time` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [panel construction](../../src/app/createGlobeApp.ts#L785), [parameter homes](../../src/settings/catalogue/sky.ts#L3) | **Shares `foss-earth/sky`.** The existing `sky.time.*` controls and solar-day/year dials edit the astronomy model shown by Sky. They use the same instant and calculations. The host owns its scene clock; a second repo for the dials would divide this one model rather than establish a separate clock owner. |
| Scenes | `scenes` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [panel construction](../../src/app/createGlobeApp.ts#L799) | **Own feature repository: `foss-earth/panorama`, with two companion tabs.** Scene definitions, loading, image resources, viewer transitions and generic preparation/validation tools form this package. Application photographs, placements and platform-specific imports stay in the application's repository. |
| About | `about` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [panel construction](../../src/app/createGlobeApp.ts#L738) | **Own repository: `foss-earth/about`.** Owns generic build identity/provenance and graph presentation. Each host owns its manifest, installed-version data and branding. About reads that data without importing the runtimes it describes. |
| Bug report | `bug-report` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [panel construction](../../src/app/createGlobeApp.ts#L733) | **Shares `foss-earth/ui`.** The generic form, report-provider contracts and visibility lifecycle belong with the diagnostic UI infrastructure. Diagnostic observations, issue destination and app-specific content remain supplied by their owners; the form does not own each subsystem's recorder. |
| Active 360 image, titled `360: <title>` | `panorama` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [dynamic title](../../src/shell/panoramaTabs.ts#L213) | **Shares `foss-earth/panorama`.** This is an instance view of the active image in the same scene controller, not a new implementation for each photograph. It shares entry/exit, resources, links and image-detail state with Scenes and 360 image settings. Closing it exits that viewer. |
| 360 image settings | `panorama-settings` | [Definition](../../src/shell/WindowOverlay.tsx#L183), [sections](../../src/shell/panoramaTabs.ts#L149) | **Shares `foss-earth/panorama`.** Representation, sharpness, looking, levelling and entry controls operate on the same camera/image/loading lifecycle as the active image. They are a separate UI home within one viewer, not an independent resource manager or camera. |

## Which hosts register them

FOSS Earth's standalone page calls
[mountGlobeApp](../../src/main.tsx#L9). Its
[overlay composition](../../src/app/mountGlobeApp.tsx#L31) passes every shared
panel/section and the panorama context. Applications using `mountGlobeApp`,
including the current UMN tour, receive that same set and supply their own scene
content. There are no app-specific additional tab definitions in this host.

| Host/context | Registered IDs | Available in this context |
| --- | ---: | --- |
| Standalone FOSS Earth, globe view | 13 | 11: all except the two panorama-only tabs |
| `mountGlobeApp` tour host, globe view | 13 | The same 11 |
| Either host while entering/showing a panorama | 13 | 9: Location, Map, Sky and Date/time are hidden; the two panorama-only tabs are enabled |
| Flight host's current shared contribution | 9 built-ins | Location, Map, Renderer, Sky, Date/time, Interface, Settings, About and Bug report; flight supplies its own Controls tab |

The flight host adds twelve flight tab IDs, including Controls, for **21 total**
registered IDs. It does not pass Scenes or panorama contents into its overlay.
Those flight-specific definitions belong in the flight application's inventory;
no flight tab becomes a dependency of the standalone globe or campus host.

Registration and context availability do not mean every tab is open or every
React panel is mounted. Selected tabs, saved workspace state and the two window
slots determine what is displayed.
[Context rules](../../src/shell/WindowOverlay.tsx#L38) preserve the hidden tabs'
positions. Entering a panorama
[opens its tab minimized during entry](../../src/shell/WindowOverlay.tsx#L324),
then shows it once the panorama is ready. Closing it exits the panorama. Its
label follows the current image while its ID stays `panorama`.

## Conditional panels and sections are not additional tabs

- **Performance debug** is a Renderer section, explicitly assigned there by
  [createGlobeApp](../../src/app/createGlobeApp.ts#L768). **Frame budget** is
  constructed [within that section](../../src/app/createGlobeApp.ts#L704).
  Their diagnostic contributions remain owned by the components they observe.
- **Sprite Size** and **Compass Scale** are conditional extra panels, created
  [here](../../src/app/createGlobeApp.ts#L512) and shown by settings. They have no
  shared tab ID. Their current detached presentation is not permission to
  invent additional entries in the tab inventory.
- **Presets**, **Saved settings**, **App files** and **Diagnostics** are Settings
  sections, not four more tabs. Their construction is in
  [settingsSections](../../src/app/createGlobeApp.ts#L762).
- **Content**, **Orbs**, **Motion**, **Loading and memory** and **Credits** are
  Scenes sections, as described in
  [scenesPanel](../../src/shell/scenesPanel.ts#L1). Photograph/links/detail are
  active-image sections; image/looking/entering are 360-image-settings sections.
- The help modal, toolbar buttons, panorama link buttons, panel launchers and
  diagnostic overlays are not tab definitions. A button opening an existing tab
  does not create another settings home.
- `?report` shows diagnostics without starting the globe or mounting the tab
  overlay, as handled by
  [mountGlobeApp](../../src/app/mountGlobeApp.tsx#L17). Benchmark and panorama-test
  hooks do not add tabs.

## Proposed additions are separate from this current inventory

There is **no current shared Dev, Weather or Debug tab** in the 13-ID definition.

`foss-earth/dev` is a proposed activation/contribution framework, including
`?dev=1`; each application owns the panels it registers. A future shared Weather
tab belongs to `foss-earth/weather`. The current flight application's Weather
and Debug tabs are host-defined flight contributions. Performance debug in the
standalone globe remains the Renderer section described above until an explicit
UI change is adopted.
