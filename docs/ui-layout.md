# UI Layout

Rules for panels, tabs, menus and the HUD in FOSS Earth and in the applications
built on it, 0sfs included. Read them before adding or changing any on-screen
control.

## Windows and log share one layout

The shell has exactly two arrangements: a window on each side with the log
centered on the viewport, or the log on the left with one window on
the right. The left launcher belongs to the left window and is absent in the
second arrangement. Both arrangements keep the log 12 px below the top safe
area; switching sides never reserves space for a missing launcher above it.

`resolveDockLayout` allocates the windows, log and gaps together. `WindowOverlay`
uses that allocation for both slots and publishes the log geometry before paint.
The log has no separate viewport breakpoint or saved absolute position. Its
startup placeholder stays on the left until the shell takes over.

The most recent manual resize gets priority. Growing the log shrinks each window
as needed, down to 160 px. If its requested width still does not fit with both
windows, the layout switches to the log on the left and one window on the right.
Shrinking the log brings both windows back as soon as they fit. The tabs temporarily
collected on the right return to their former sides; tabs closed or newly opened
in the meantime keep the user's changes.

Growing a window shrinks the log when they meet. In the two-window layout the
log's center stays at half the viewport width, even with unequal windows. Each
half of the log must clear its neighboring window and a 12 px gap. Window resize
handles stop when the log reaches its 160 px minimum so the handle being dragged
does not disappear. In the one-window layout, resizing the right window squeezes
the left log; it does not force a wide log back to the center just to restore a
second window.

These are space constraints based on requested sizes, not a fixed screen-width
breakpoint. Preferences survive fitting, and taking over a resize starts from
the displayed sizes. A log drag keeps the same width calculation across mode
changes so it can reverse through the transition without oscillating. Ordinary
log messages never take resize priority. Minimizing releases the log's requested
space; restoring reapplies its preference. Collapsed tab strips also fit their
allocated widths.

## Paragraph grids, never fixed columns

Lay out every set of controls (toggles, chips, buttons, short fields, cards) as a
**paragraph grid**: each item at its own natural width, placed left to right,
wrapping onto the next line when the row is full, the way words wrap in a
paragraph.

```css
.group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
```

The HUD bar is the reference (`.hud-bar` in `src/styles/hud.css`): north, help,
settings, theme, input method, renderer and position sit side by side at their
own widths and wrap on a narrow screen. In Renderer → Performance debug,
`.settings-metric-menu` does the same for toggles.

Do not lay a set of controls out in fixed columns: no `grid-template-columns:
repeat(n, …)`, no row of `flex: 1` children stretched to equal widths, no table
used for layout. Panels are 320 to 420 px wide and labels run from "Theme" to "POI
sprite size tuner". Equal columns give every item the same share, which leaves
empty space beside short labels, cuts long ones off, and stops at the column count
however much room is left on the line.

Something that needs the whole width takes a whole line, as a paragraph break
does: a group heading (`flex-basis: 100%`), a slider, a text field that needs
room, a sentence of explanation, or a nested paragraph grid such as the
sensitivity cards.

A toggle in a paragraph grid is a pill: the checkbox and its label in one rounded
chip (`.settings-checkbox`), outlined in the accent colour while it is on. A
choice of one among several is the same pill around a radio button
(`.foss-earth-choice`, built by `createChoiceGroup`), as in the Map and Renderer
tabs.

## One home for every control

Every setting lives in exactly one place, a section of a tab.

- A toolbar button is a shortcut that toggles its tab: it shows the tab, and
  closes it when the tab is already the one showing. ⚙ toggles Settings, the
  input-method button Controls, the position readout Location, the renderer chip
  Renderer and the map chip Map. Call `toggleTab` on the overlay handle; keep
  `openOrSelectTab` for links that should only ever open, such as "change
  controller bindings".
- A toolbar button never pops up its own copy of the controls, and never a menu
  of choices either: two copies drift apart and double the space they use. The
  renderer and basemap choices have tabs of their own for that reason, and
  `HudBarMenuItem` is deprecated.
- Nothing floats in a screen corner behind a launcher button. Controls go in a
  tab, where the dock layout manages the space.
- A tab that holds several groups is built from collapsible sections
  (`SectionsPanel` from `foss-earth/shell`, or `createSectionsElement` for a tab
  whose content is an element). A section starts closed unless people usually
  arrive wanting it, as Input method does when its toolbar button opens
  Controls, and Source and Detail do in the Map tab.
- Each section is a parameter section (`createParameterSection`, see the
  [settings spec](proposals/settings.md#implementation)): its own controls,
  then a control for every main-level parameter homed in it that those don't
  cover, hosts' included, then **Show all parameters**. The Map tab
  (`createMapSourcePanel`) is Source, Detail, Automatic adjustment, Loading
  and memory, Imagery selection and Terrain selection; the
  Renderer tab (`createRendererPanel`) is Renderer, Resolution and frame
  rate, Depth range and Performance debug; the Scenes tab is Content, Orbs,
  Motion, Loading and memory, Tiled images, Saved images and Credits; the Controls tab is Input method,
  Camera, Orbit, Mouse and trackpad, Touch and Controller; the Interface tab
  is Toolbar, Log and Search; and the Settings tab is Presets, Saved settings, App files, Diagnostics and About. Map and
  Renderer add a section for
  every section of their tab a host's parameters are homed in, such as 0sfs's
  Renderer → Instruments, so a host never builds a second copy of the tab.
- Controls are drawn from the parameter's kind, and each has one
  implementation: a switch is a pill with a checkbox; a choice is a heading and
  pills; a number is a value track with its readout as a field, the default
  ticked and any named values ("Off", "Normal") as pills; a range is a range
  track; text is a field, never showing a secret. A note under a control says
  what limits it, where its value came from when that is not the user, and
  when it applies only after a restart.
- A range is one track with two thumbs, never two sliders. Choosing an acceptable
  part of one continuous scale is one control: the thumbs are its ends, the part
  outside them stays visible but dimmed, and a default or a host's marker (such
  as 0sfs's flight minimum) sits on the same track. Detail tracks use the HUD
  rail's colours, green for finer through yellow to red for coarser, anchored to
  the scale so a value has the same colour wherever it appears. A host's marker
  is a bar in its own colour, labelled under the track, hollow while waived; a
  requirement stripes the part of the range it refuses. `createTrack` draws all
  of them.
- Every toolbar button is shown until the user hides it in Interface → Toolbar,
  because a first-time visitor does not know that + opens the same tabs. Hiding a
  button never hides what it opened; its tab stays under +.
- The menu under a tab strip's + is drawn outside its panel, in the overlay's own
  layer, fixed to the window where the + button is. The panel clips what passes
  its edges, and with many tabs the + sits at the strip's right end, so a menu
  drawn inside the panel was cut off there and the globe or a panorama showed in
  its place.

## A panorama's tabs

A panorama has no controls floating over it. Entering one opens a tab titled
"360: <title>" (`createPanoramaTabs` in `src/shell/panoramaTabs.ts`, given to
`WindowOverlay` as `panoramaTabs`), selected and in front. While the camera
flies in, or the entry fades in, its panel is minimized, out of the way of the
map the camera flies over. It shows once the panorama is on screen (`onScreen`
in the tabs' snapshot), unless the person showed it or picked another tab in
that panel meanwhile. The tab holds:

- **Photograph:** its title and description, the groups it is in, where it was
  taken and to what accuracy, its pose and whether its north is set, and its
  credit and licence with a link to the source.
- **Links:** a button for each link, as in the view.
- **Image detail:** which image is on screen, why no larger one is (the detail
  asked for, the device's texture limit or a memory budget, each named, or a
  load that failed), the images the panorama offers, and
  `scene.panorama.immersionWidth`, whose one home this is.

A failure also goes to the log as an error line, since a tab can be closed: the
scene file, entering a panorama, a larger image of the one on screen, and orb
previews. Previews fail together when their server stops, so they share one
line that counts the panoramas and moves to the top with each new failure.
Cancelled work and a larger image held back by a limit the user set are not
failures and are not logged.

Following a link retitles the same tab. Closing it leaves the panorama, exactly
as Escape does; while a panorama is still being entered, closing it cancels.
These are the only ways out: there is no close button in the bar.

Tabs belong to a context, the globe or a panorama, and the overlay shows those
of the context on screen:

| Tab | On the globe | In a panorama | Why |
| --- | --- | --- | --- |
| Location | yes | hidden | It moves the globe camera, which the panorama holds; the photograph's place is in its tab |
| Map | yes | hidden | The map is not drawn |
| Renderer | yes | yes | The panorama is drawn by the same renderer, at its resolution and frame-rate cap |
| Controls | yes | yes | The input method and controller bindings drive the panorama's look too |
| Interface, Settings | yes | yes | The toolbar, log, search, presets and saved settings apply anywhere |
| Scenes | yes | yes | Its list enters any other panorama of the scene, and its budgets hold the image on screen |
| 360: <title> | no | yes | The panorama on screen |
| 360 image settings | no | yes | What matters only inside a panorama |

A tab hidden by a context comes back where it was, and selected if it was, when
its context returns, unless it was opened elsewhere meanwhile
(`src/shell/contextTabs.ts`). A panel the panorama's tab opened goes back to
how it was when the panorama is left. The bar hides what is about the map in a
panorama too: the detail rail, the basemap chip, whose place the panorama's
credit takes, and the camera's position, whose Location tab is hidden.

The Scenes tab holds what the globe shows and what both sides share: Content
(choosing a scene, its panoramas and their orbs), Orbs, Motion (hover growth,
flying into and out of 360 images, the entry reveal, fades and reduced motion,
which play on the globe side too),
Loading and memory (one set of budgets: the orbs' previews and the image on
screen come from the same pools) and Credits. 360 image settings holds Image
(the sharpness target), Looking (the field of view, looking up and down, and
every look and zoom rate) and Entering (where you look and how long levelling
takes).

## Map source and credits

The HUD bar ends with the map source, pushed to the bottom-right corner by its
slot: the detail rail, then a chip of two halves
(`createMapSourceHud` in `src/shell/mapSourceHud.ts`, mounted in the bar's last
slot). The first half is one button, the download speed, the provider's logo
when it has a square one and its name, that toggles the Map tab. The second
links to the provider's attribution page, marked with the external-link icon
(`createExternalLinkIcon`: a box open at its top-right corner, an arrow leaving
through the gap). Each half fills the chip to its
rounded edge and lights up whole on hover; nothing underlines. Because it is part of the bar, it wraps with
the bar on a narrow screen instead of covering it.

A provider whose logo spells its name, such as CARTO, shows that logo instead of
the mark and name (`wordmark`), followed by the basemap's own name, "Positron".
Its artwork comes in a dark and a light version, and the theme picks between
them.

Every basemap gives its credit page as `attributionUrl`, and every elevation
provider as `attribution`. In the Map tab, the pill of each source in use, the
basemap and the elevation provider alike, ends in the same icon linking that page
(a choice's `creditUrl`). The other pills have none, and no text names the
credit. Put no other credit link on the map; add the provider's page to its
definition.

The detail rail is the one interactive temporary-detail control: finer to the
left, coarser to the right, and both ends are ordinary values with no reset
meaning. A tick marks the saved default; the blue marker shows a renderer target
only where one number describes it, never a claim that imagery has loaded. The
saved range and default have their one home in the Map tab's Detail group, and
both observe the same `MapDetailController`.

The bar spans the bottom edge and publishes its height as `--foss-hud-bar-height`.
Anything anchored above the bar, such as 0sfs's instruments, clears it with that
variable rather than a fixed guess.

## Input method

The Input method section of the Controls tab shows a **Touch** part on a device
with a touchscreen, then a **Mouse or trackpad** part on a device with a pointer.
A touch laptop, or an iPad with a keyboard and trackpad, gets both.

Touch is not a mode to choose. Touch gestures work whatever the pointer mode is
and use their own sensitivity; the mouse or trackpad choice only decides how
wheel and gesture events are read. `createInputModeHud` in `src/hud/inputModeHud.ts`
draws both the toolbar button and the section; hosts mount the section with
`mountInline` and pass `onToggle` to toggle their Controls tab.
