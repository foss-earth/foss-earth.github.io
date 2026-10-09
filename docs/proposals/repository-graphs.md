# FOSS Earth repository graph

Status: proposal, 2026-10-08. [Open the graph](repository-split-graph.html).
Its authoritative metadata is [repository-split-graph.json](repository-split-graph.json).
The graph describes proposed release boundaries, not current imports or completed
extractions.
The [exhaustive tab inventory](tab-inventory.md) records all 13 current shared
tabs, host/context availability and the reason for every shared-owner exception.

FOSS Earth owns the shared globe, sky/weather, panorama, UI, renderer, toolbar,
generic About viewer, developer contribution framework and generic CI/setup
machinery. The proposed repositories are `foss-earth/engine`, `ui`, `renderer`,
`toolbar`, `about`, `sky`, `weather`, `panorama`, `dev`, `ci` and `dev_installer`. The existing
`foss-earth/foss-earth.github.io` becomes a pinned consumer of the engine rather
than a second source copy. Earth documentation, research, community guidance,
branding, release metadata and workspace metadata remain Earth-owned.

Renderer owns device/scene/backend lifecycle and frame scheduling. Globe engine
consumes renderer; renderer has no import back into globe code. UI owns generic
window/tab/settings primitives. Toolbar owns the bottom HUD and receives its
callbacks and displayed values from each host, consuming UI rather than feature
implementations. Renderer can expose an optional UI panel entry point.

The standalone globe depends on neither the flight application nor a particular
campus tour, including their documentation and setup/build wrappers. Generic
tools accept explicit manifests; they do not hardcode downstream repositories.
The shared `?dev=1` activation contract shows host-registered contributions.
The generic About viewer receives host-owned data without importing the runtimes
that its graph describes.

The shared prototype presentation source is
[repository-graph-template.html](repository-graph-template.html), and the
generator is [build-repository-graph.mjs](../../scripts/build-repository-graph.mjs).
Each application owns its JSON; generated HTML is a self-contained artifact of
that JSON and this shared template. Do not edit the generated HTML directly.
Arrows mean consumer → dependency. Code, content/metadata and
publication/research/tooling relations are distinct. Dataset scope rules reject
ownership inversion for every relation type; literal code cycles are rejected
separately.

From the FOSS Earth checkout:

```sh
node scripts/build-repository-graph.mjs --input=docs/proposals/repository-split-graph.json --out=docs/proposals/repository-split-graph.html
```

Omitting `--out` creates a new dated folder under `build/repository-graphs/` and
rebases documentation links to that location. Generated files include source
hashes and a reproduction command. Opening a graph contacts no service and
creates no repositories. Each application supplies its own data file and can
use the same generator without copying its implementation.
