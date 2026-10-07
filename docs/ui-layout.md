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

The workspace is remembered per device. After a reload each window holds the
tabs it held, shows the one it showed, and keeps its width and whether it was
minimized (`src/shell/savedWorkspace.ts`); the sections open inside each tab
are remembered the same way (`panelSectionsOpen.ts`). What is saved is the
layout a wide window on the globe would show: tabs folded onto the right are
saved on their own sides, and inside a panorama the map's tabs are saved where
they were and the panorama's own tabs not at all. A saved tab the application no
longer offers is dropped.

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

The HUD bar is the reference (`.hud-bar` in `src/styles/hud.css`): its items
sit side by side at their own widths, with default visibility fitted to one row
as described below. Items set to On can wrap. Interface → Toolbar keeps its
three-way visibility controls in the same paragraph layout.

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

### Dropdowns fit their own text

A dropdown (`<select>`) is as wide as its own text, which is its longest option
and its arrow, and no wider: it is a word in the paragraph, not a bar across it.
Never stretch one to its row, its column or its panel: no `width: 100%`, no
`flex: 1`, no grid column that sizes it. Inside a grid cell or a flex column, set
`justify-self: start` or `align-self: flex-start` with `width: auto`, because both
layouts stretch their items by default.

```css
select {
  justify-self: start;
  width: auto;
  max-width: 100%;
}
```

`max-width: 100%` lets it shrink on a panel too narrow for its longest option,
where the browser cuts the shown option short; that is the only width change
allowed. A dropdown sized to its row leaves a long empty box after "Auto", reads
as a text field, and puts its arrow a panel's width away from the word it
changes. It is sized by its options, not by the one showing, so choosing a
longer one does not move the controls after it. 0sfs's aircraft level of detail,
FOSS Earth's airport position and runway, and gamepad-tools' profile and
controller lists follow it.

## The HUD defaults to one row

The bottom-left toolbar fits its default items into one row, using the space
between the screen's left safe edge and the detail rail and attribution chip
on the right. Measure the widths of those items and their gaps; the available
space changes with the provider, its attribution, the current view and the
viewport. Do not use a phone breakpoint or a fixed estimate of the chip's
width.

Default visibility follows this priority, highest first:

| Priority | Item | Why |
| --- | --- | --- |
| 0 | North (`N`) | The only shortcut for resetting heading |
| 1 | Help (`?`) | A new visitor needs to learn the controls and tabs |
| 2 | Input method | Keeps the current controls visible and accessible immediately after Help |
| 3 | Fullscreen | Enters or leaves fullscreen where the browser supports it |
| 4 | FPS | Useful feedback for anyone |
| 5 | WebGPU / WebGL 1 / WebGL 2 | Explains which renderer is drawing when FPS is low |
| 6 | Camera position (latitude, longitude, altitude, `h/p/z`) | Opens the Location tab |
| 7 | Theme | Also available in Interface → Toolbar |
| 8 | Settings | Also available as a tab under + |

Each configurable toolbar item has an On / Auto / Off choice in Interface →
Toolbar, including FPS and every other performance reading. On uses a filled
switch icon, Auto uses `A`, and Off uses an outlined switch icon; hover and
accessible names give the full words. On stays shown, wrapping when needed;
Auto fits in the available row by priority; Off stays hidden. These are stored
values, independent of whether they came from a default or a saved choice.
Toolbar buttons and FPS default to Auto; other performance readings default
to Off. Existing saved checkbox values migrate
to On or Off.

**Priorities** is one Auto / Custom slider, starting in Auto. Auto uses the default
order above. Custom applies the saved priorities and reveals each item's compact
number field at the left of its existing visibility row, including in Show all
parameters. North has its own field because it has no visibility switch. Lower
numbers come first, with the default order breaking ties. Returning to Auto hides
the numbers and uses the default order, retaining the custom values for later.
North always remains available even when its position in the row changes.

Hide the lowest-priority Auto items first until the row fits, and bring
them back in priority order when space returns. Reserve room for North and the
first two available items after North (Help and Input method by default), shortening long attribution
text inside its chip when needed. Then measure the detail rail and attribution
chip and fit the remaining defaults into the space left over. The credit link
and detail rail stay accessible beside the core controls.

Auto stays selected even when its chip does not fit, including Camera position.
Fitting changes only what is drawn. FPS shows its number above a smaller gray
`fps` label, within the same toolbar row height.

The position readout (`createPositionReadout`, shared with 0sfs's flight chip)
writes the latitude, the longitude and the altitude, then what its host adds:
heading, pitch and zoom distance on the globe, heading in the flight. By default
a globe drawn with only its parallels marks the latitude, and one drawn with only
its meridians the longitude, each in the text colour at 1.2em; Interface →
Position readout can write `lat` and `lon` instead, or nothing beyond the N/S and
E/W. The same section says what the altitude is measured from, above sea level
(the WGS84 ellipsoid) or above the terrain below, and whether it is in metres or
feet. On the globe it is the camera's own altitude, not that of the point it
looks at. Digits are tabular, so a changing number does not shift what follows.

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
  is Toolbar, Position readout, Log and Search; and the Settings tab is Presets, Saved settings, App files and Diagnostics. About is
  a tab of its own (`createAboutPanel`): which version runs and what it is built from, as a tree from the app
  down, where someone looking for the version looks for it, under +. Map and
  Renderer add a section for
  every section of their tab a host's parameters are homed in, such as 0sfs's
  Renderer → Instruments, so a host never builds a second copy of the tab.
- Controls are drawn from the parameter's kind, and each has one
  implementation: a switch is a pill with a checkbox; a choice is a heading and
  pills; a number is a value track with its readout as a field, the default
  ticked and any named values ("Off", "Normal") as pills; discrete priorities use
  compact numeric fields; a range is a range
  track; text is a field, never showing a secret. Beside each control are a
  `?` button, label and source-link icon, at their own widths in that order in
  the same wrapping row. Controls precede text so changing label lengths cannot
  move their buttons in a single-column view. A custom priority field comes
  before the visibility buttons; the source icon stays last. `?` opens an
  explanation tooltip with the description,
  default and its reason, current value and provenance, parameter ID, limits
  and restart notes. It closes on another click, Escape or a click outside.
  The tooltip contains explanation only; the setting keeps its single home.
  An invalid edit opens its explanation so the rejection is visible. The source
  icon retains its accessible name and opens the code in a new tab. Per-setting
  reset buttons are removed; Reset all remains in the section's transfer controls.
- A range is one track with two thumbs, never two sliders. Choosing an acceptable
  part of one continuous scale is one control: the thumbs are its ends, the part
  outside them stays visible but dimmed, and a default or a host's marker (such
  as 0sfs's flight minimum) sits on the same track. Detail tracks use the HUD
  rail's colours, green for finer through yellow to red for coarser, anchored to
  the scale so a value has the same colour wherever it appears. A host's marker
  is a bar in its own colour, labelled under the track, hollow while waived; a
  requirement stripes the part of the range it refuses. `createTrack` draws all
  of them.
- Interface → Toolbar holds all configurable toolbar visibility, including
  performance readouts. Renderer → Performance debug holds tuners and profiling.
  Auto items fit by the priority above; On and Off take precedence.
  Hiding a button never hides what it opened; its tab stays under
  +. The same section holds one two-position theme slider, with sun and moon icons,
  so theme remains changeable when its toolbar shortcut does not fit.
- The menu under a tab strip's + closes on Escape, as on a click outside it, and
  the key goes no further: no panorama is left and no binding reads it. Focus goes
  back to the + button.
- The menu under a + ends above the HUD bar, and takes another column for the tabs
  that do not fit between its button and the bar, so none is out of sight
  (`menuFit.ts`; the overlay gives the bar's top as `menuBottom`). A host may draw
  the bar over the panels' layer, as 0sfs does, and a menu that ran under it hid its
  last tabs: on 2026-10-07 About, last in the menu, read as not there.
- The menu under a tab strip's + is drawn outside its panel, in the overlay's own
  layer, fixed to the window where the + button is. The panel clips what passes
  its edges, and with many tabs the + sits at the strip's right end, so a menu
  drawn inside the panel was cut off there and the globe or a panorama showed in
  its place.

## A control uses its input or passes it on

Every control over the world either uses an input or passes it to the world behind
it, the same way for every control, so that nothing in between swallows a gesture
or a key meant for the camera or the vehicle.

- **Swipes and pinches.** A two-finger swipe over a panel that cannot scroll that
  way, over the HUD bar or over an instrument moves the camera as it would over the
  map, and a pinch zooms it, whichever camera has the canvas
  (`passUnusedInputToWorld` in `src/input/passToWorld.ts`, which the runtime
  starts). A panel keeps the swipes it scrolls with, along its own axis; a listener
  that calls `preventDefault` keeps the events it uses. The first event of a
  gesture decides for all of it. Nothing unused reaches the browser, where a
  sideways swipe went Back a page and a pinch zoomed the page, and the page itself
  never overscrolls (`overscroll-behavior: none` on `html` and `body` in the shell's
  stylesheet).
- **Keys.** A focused control keeps the keys it uses and the bindings behind it
  take the rest: a text field or a dropdown every key, a slider its arrows, Page and
  Home/End keys, a checkbox Space, a button Space and Enter (`controlTakesKey` from
  `@felipegalind0/gamepad-tools/browser`). A control whose keys none of these
  describe names them in `data-takes-keys`. A trim slider just dragged therefore
  still lets W, A, S and D fly, as the custom throttle lever always did, and a
  focused slider's arrow keys move its thumb without also turning a panorama. Every
  key binding asks this one rule, never a list of its own of which elements to
  ignore.
- **Escape** closes what is open over the world, such as the + menu, before it
  reaches anything behind it.

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
| About | yes | yes | Which version runs is the same anywhere |
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
rounded edge and lights up whole on hover; nothing underlines. It reserves its
width beside the default toolbar's single row. When the person's explicit
toolbar choices require wrapping, it remains part of the bar's layout rather
than covering other controls.

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
