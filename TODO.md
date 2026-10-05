# foss-earth TODO


bugs

when hover over POI and move mouse into overlaid UI the tooltip remains active until the cursor goes over the map again. in other words it only clears the tooltip if the cursor is pointing elsewhere in the map, but if it is over UI it will not clear until the map layer is hovered over again. s

After a pan at a fixed zoom, the orbit pivot keeps the old ground height, so orbiting can take the camera underground until the next zoom. Prompt: [docs/camera-pivot-and-zoom-prompt.md](docs/camera-pivot-and-zoom-prompt.md).

Automatic detail adjustment coarsens the map to its lowest detail: one short interval between frames sets its measured goal to 2 ms. Off by default until fixed. Report: [bugs/auto-detail-measured-goal.md](bugs/auto-detail-measured-goal.md).

Inside a 360 image the north button keeps the map's heading: turning the view does not turn its needle, and pressing it does not turn the view. Report: [bugs/north-button-in-panorama.md](bugs/north-button-in-panorama.md).

On an iPhone XS Max (iOS 18.2.1, WebGPU turned on in Safari's feature flags) the UMN tour's page kept crashing on 2026-10-03, and stopped after five minutes on 2026-10-04. Both times it was the app built on 2026-10-03 at 05:33 UTC, from Safari's copy of the page: its Settings tab had no App files and no Diagnostics section. No app since has been tried on that phone, so whether the limits on what the GPU holds stop the crashes is not known; the WebKit the checks run has no WebGPU and a Mac's memory. The app now says which version it is in the first line of its log, and what it was doing ([docs/diagnostics.md](docs/diagnostics.md)): after a crash, the next visit's log names the 360 image and the renderer, and Settings → Diagnostics → Copy report, or `?report` in the address, gives the trail. To find out first, with the tab reloaded so that it is the published app: that report from the phone, and whether `?renderer=webgl2` still crashes.

Whether Safari on a phone lets a page reload itself out of its own copy has not been seen. A page a browser shows from its cache is an older version of the app for as long as the browser keeps it: an iPhone ran the app of two days and four releases before on 2026-10-04. A page built since asks the site which version it publishes and reloads itself, once, while nobody has touched it ([docs/app-files.md](docs/app-files.md#the-page-and-a-browsers-copy-of-it)), which Chrome, Firefox and WebKit do on a build with a stand-in for the browser's copy. To find out: after the release that follows the first with this, come back to the tab on the phone and read the log's first lines. An app published before it cannot be reached: its tab has to be reloaded by hand.

In Firefox every orb drawn from a preview sheet was black, and a viewer from before preview sheets refused a scene that had them. Fixed on 2026-10-03: [docs/proposals/panorama-scenes.md](docs/proposals/panorama-scenes.md), "Two phones, the evening of the release".

A 360 image looked away from and back at loaded its tiles again, a reload downloaded every orb's previews again, and the map loaded every orb's largest preview. Fixed on 2026-10-03: [docs/proposals/panorama-scenes.md](docs/proposals/panorama-scenes.md), "Loading once".

The dropdown on the tab strip draws behind the globe and the panorama viewer once many tabs push it out of the tab window. Fixed as part of [docs/panorama-mode-prompt.md](docs/panorama-mode-prompt.md).

features

A panorama opens as a tab, "360: <title>", with its details and a detail slider that defaults to the most detailed image. Closing the tab or Esc leaves it, and the × goes. A panorama shows its own set of tabs, and a "360 image settings" tab takes the viewing settings out of Scenes. This blocks the UMN tour. Prompt: [docs/panorama-mode-prompt.md](docs/panorama-mode-prompt.md).

Leaving a panorama pulls back out of it, away from the direction the viewer faces. It is a setting, on by default. Prompt: [docs/panorama-exit-animation-prompt.md](docs/panorama-exit-animation-prompt.md).

Zoom toward the pointer, or toward the centre of a pinch, as a setting beside today's zoom toward the view's centre. Prompt: [docs/camera-pivot-and-zoom-prompt.md](docs/camera-pivot-and-zoom-prompt.md).

The log becomes a tab where the screen is too narrow for it beside the tab window: on an iPhone XS Max there is not room for both. Three layouts by width: two tab windows with the log between them where there is room for all three; else the log on the left and one tab window on the right; else one tab window with the log as one of its tabs.

No check runs the app already published against a scene about to be, and only the orb check runs in Firefox and WebKit: both faults of 2026-10-03's phone trial were of those kinds. Have a content release load the new scene in the bundle that is live, and move the checks that reach for Chrome's protocol (`panorama-tiles.mjs`, `scene-revisit.mjs`) onto `scripts/lib/headlessPage.mjs` so they run in all three.

Google 3D tiles step through every level of detail on the way down. Add a setting for loading only the level the view needs, which the user wants as the default. Also add an optional pulse on tiles still loading, and a loading bar, perhaps the outline of the map-source chip. Prompt: [docs/tile-loading-prompt.md](docs/tile-loading-prompt.md).

A button that copies the camera's state (position, heading, pitch, distance, field of view) as text, for pasting into a script or sharing a view. Nothing records the camera in the URL today. 0SFS wants it for a script that renders its logo (its TODO.md, "branding").

The app's own files were downloaded again on a visit more than ten minutes after the last: GitHub Pages lets them go stale then, and sent 1.55 of the UMN tour's 1.72 MiB again. Done on 2026-10-03: a service worker keeps them, and Settings → App files turns it off ([docs/app-files.md](docs/app-files.md)).

Compare two things in one 360 view: two 360 images, or a 360 image and the map behind it, seen from the same camera. There are two ways to mix them. One is a divider dragged across the view, with one source on each side. The other is a blend from one source to the other on a continuous control. The divider is how the user's old viewer, [360-Side-By-Side](https://github.com/Felipegalind0/360-Side-By-Side), compared two photographs: one three.js sphere and one camera, whose shader picks image A or B by which side of the divider a pixel is on (`components/panorama-viewer.tsx`). Here, immersion is already one triangle covering the view (`src/engine/babylon/panorama/panoramaRenderer.ts`), so a second photograph is a second set of tiles in the same draw. Comparing with the map needs the map drawn while a panorama is entered, which it is not today. The map is drawn from the capture point, with the panorama's heading, pitch and field of view; where the capture height is unknown, the ground plus an eye height that is a setting. The blend is how a placement gets checked against Google 3D tiles, and the UMN tour needs that for each of its 60 photographs (its `docs/placements-prompt.md`). Two panoramas held at once count twice against the panorama budget (`src/scenes/budget.ts`). Build the comparison with the map first, because the tour waits on it. Wants deciding before it is built: which tab section it lives in, how the second photograph is picked, and whether a third way is wanted, two views side by side with linked cameras.

The claim that FOSS Earth's 360 viewer outperforms the old side-by-side viewer has not been measured. It is likely for large photographs. The old viewer loads both whole equirectangular images as three.js textures, so it downloads everything before anything is sharp, and it can exceed a phone's largest texture size. FOSS Earth loads only the tiles in view. To measure: the same two photographs in both viewers, at a phone's viewport, on the real GPU. Record the bytes downloaded before the view is sharp, the time to the first frame, the frame time while turning, and the GPU memory. The scene A/B benchmark ([benchmarks/scene-ab/README.md](benchmarks/scene-ab/README.md)) measures FOSS Earth's side, and the old viewer is built in `build/`. Report which wins where: a small image may favour the old viewer.

Move a 360 image on the map with handles, as KSP's part editor moves a part. Selecting an orb shows: a handle to drag it along the ground, one to raise or lower it, and a ring to turn its heading; fields for the same values; a modifier key for fine movement and a setting for snapping (in metres and degrees); and a circle of its `horizontalAccuracyMeters`. Edits can be undone and redone. An edit stays a draft in the browser until it is exported. Export gives the changed entities' `capture` and `imagePose` as JSON keyed by entity id, for an app to merge into its own files; the UMN tour merges them into its `tools/twin-cities/placements.json` (its roadmap). Editing is off for visitors. Drawing areas, if it lands first, drags corners in the same way: build the handles once. Wants deciding before it is built: whether editing is switched on in Settings, by `?edit` in the address, or both; and which tab it lives in.

Set a 360 image's heading and position from inside it. There are three ways. First, with the map blended in (the comparison above), grab the photograph and turn it against the world until a building's edge lines up with Google's; with a modifier key, tilt it to set pitch and roll. Second, nudge the capture point with keys or a pad. That moves the camera with it, so it follows [docs/camera-motion.md](docs/camera-motion.md). Third, and quickest: click a point in the photograph and the same point on the map or the 3D tiles. One pair sets the heading. More pairs solve the position as well, by least squares, with each pair's residual shown in degrees. That is the method the UMN tour's placements prompt describes doing by hand. Edits go into the same draft, and are exported the same way, as the map editor's. This needs the comparison and the map editor's draft first.

Debug drawing: arrows, markers, line segments and text labels drawn over the scene in world coordinates that survive the floating origin, either on top of everything or depth-tested, as each caller asks. Also a strip chart panel for any number over time. FOSS Earth has two overlays of its own (`src/input/touchDebugOverlay.ts`, `src/input/anchorPanDebugOverlay.ts`). 0SFS draws its collision overlay with Babylon directly, and wants arrows for its aero forces and a chart for JSBSim's properties (its TODO.md, "debug views"). A globe app wants markers where surface queries hit, and a chart of frame times.

Developer views, each a switch in Settings → Diagnostics:
- Babylon's Inspector, loaded only when asked for: the scene graph, materials and wireframe.
- Freezing the culling camera, then flying out to see what is loaded and drawn for that view.
- Tile bounds coloured by level of detail.
- The floating origin's offset.
- GPU memory by kind of resource.
None of these exist today.
