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
