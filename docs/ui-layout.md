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
  rate, Depth range and Performance debug; the Controls tab is Input method,
  Camera, Orbit, Mouse and trackpad, Touch and Controller; the Interface tab
  is Toolbar; and the Settings tab is Saved settings and About. Map and
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
