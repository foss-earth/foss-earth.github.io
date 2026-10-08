# CI/CD

FOSS Earth, [0sfs](../../0sfs) and the [UMN tour](../../UMN-VR/UMN-VR.github.io) check and
deploy their code the same way. This page lives here because FOSS Earth is the part the other two
build on. There is no hosted CI, and nothing runs on a push. The checks are npm scripts from one
Vite template, run on the developer's Mac by people and agents. A deploy is a build pushed to
GitHub Pages from that Mac.

## The pipeline

| | FOSS Earth | 0sfs | UMN tour |
| --- | --- | --- | --- |
| `npm run ci` | `lint`, `test`, `build` | the same | the same |
| `npm run build` | `typecheck`, `vite build` | artifact checks, `typecheck`, `vite build`, checks of the built WASM | `typecheck`, `vite build` |
| Deploy | `npm run deploy`: [deploying.md](deploying.md) | `npm run deploy`: [its deploying.md](../../0sfs/docs/deploying.md) | `npm run deploy:app`, `deploy:content` or `deploy:full` |

- **`lint`** is ESLint with a content-hashed cache in `node_modules/.cache/eslint/`, so it reads
  only the files that changed.
- **`typecheck`** runs `tsc -p` on each tsconfig, incrementally
  (see [Typechecking](#typechecking)).
- **`test`** runs every test file with Vitest. Vitest caches no results. It keeps each file's last
  duration in `node_modules/.vite/vitest/`, only so it can start the slowest files first.
- **`vite build`** bundles the app from scratch. Nothing is cached between builds.

## When to run what

- **After an edit:** `npm run typecheck`, `npx vitest related --run <changed files>` and
  `npm run lint`.
- **When the work is done:** `npm run ci`, once. A change to FOSS Earth also needs the checks of
  each app that uses it, since they import its source.
- **Documentation only:** nothing.

## What each step costs

These were measured on 2026-10-07 and 08, on an Apple M5 with 4 performance cores, 6 efficiency
cores and 16 GB. The records, and how far each can be trusted, are in 0sfs's
[validation/evidence/ci/2026-10-08](../../0sfs/validation/evidence/ci/2026-10-08/README.md).

| Step | FOSS Earth | 0sfs | UMN tour |
| --- | --- | --- | --- |
| `lint`, warm cache | | 1.8 s | |
| `typecheck`, nothing changed | 1.0 s | 1.3 s | 1.0 s |
| `typecheck`, cold | 2.1 s | 3.3 s | 2.0 s |
| `tsc -b`, which `typecheck` replaced, every run | 8 s | 5.5–6.8 s | 6 s |
| `test` | 12.9 s, 145 files | 56 s, 190 files; 98 s on a busy machine | 5.9 s, 2 files |
| `vite build` | 0.9 s | 0.6–2.0 s | 12.2 s |
| Artifact checks | | 1.5 s, all six | |

Tests are most of `npm run ci` in 0sfs, and they are growing fastest. They took 10 s for 125 files
on 2026-09-28, 17 s for 153 files on 10-05 and 29 s for 187 files on 10-07. On 10-08 they took
56 s for 190 files, after the F135 became JSBSim's coupled engine plant. The F-35B, F135 and
engine test files took 79 s of the 118 s that all the files' tests took together.

The tour's build copies `public/` (780 MB in 62,582 files) into `dist/` every time. That copy is
most of its 12 s.

## Typechecking

The template's tsconfigs set `noEmit` and a `tsBuildInfoFile`, but not `incremental`. As a
result, `tsc -b` never finds a project up to date: it looks for the JavaScript that `noEmit`
never writes.

```text
Project 'tsconfig.app.json' is out of date because output file 'src/appRoute.js' does not exist
```

So every `tsc -b` checked every file. That took 6 to 8 s, after every edit and in every build.

Turning on `incremental` would make `tsc -b` fast but wrong. In build mode, tsc decides whether a
project is up to date from the timestamps of its own `include` files. 0sfs and the tour check
FOSS Earth's source through the `file:` link, and 0sfs checks the JSBSim SDK's types from its
tarball. Neither is in their `include`. To test this, a linked package's function was changed
from returning a number to returning a string. Incremental `tsc -b` called the project up to
date, and only `--force` showed the error.

`npm run typecheck` runs `tsc -p` on each tsconfig with `--incremental` instead. Project mode
reads every file of the program, linked packages included. It compares each file with the hash
in its build info, and checks again only what the change can affect. The same test failed, as
it should. Its build info has file names of its own, so it does not conflict with anyone still
running `tsc -b`.

No test file is typechecked. Each `tsconfig.app.json` excludes `*.test.ts`, and Vitest strips
types without checking them, so a type error in a test fails nothing.

## Choosing tests

`vitest related <files>` and `--changed` choose tests by walking each test file's imports,
static and dynamic. A file that a test reads from disk with `readFileSync` is not an import. A
change to such a file selects no tests, and `--passWithNoTests` turns that into a pass. In 0sfs,
a change to the F135 engine definition selected no test files at all.

`forceRerunTriggers` in `vite.config.ts` lists the folders that tests read from disk, and a
change there runs every test. 0sfs lists `public/jsbsim-data` and `public/aircraft`, which 33
test files read. A change to the F135 engine definition now runs all 190 files.

FOSS Earth's tests read scene files, the example scenes in `public/` and the EGM2008 grids from
disk, and the tour's test reads its published scene. Neither repository lists those folders yet.
After changing one of those files there, run the tests that read it.

## What makes the tests slow

**The longest file sets the time.** Vitest runs files in parallel, one per worker, and runs a
file's tests one after another. On 2026-10-08, `f35b.integration.test.ts`
took 35 s on its own (95 s on a busy machine), and no number of workers could finish the suite
sooner. Split a file that takes much longer than the rest.

**A fixture is built again for every test.** Each F-35B test creates a JSBSim instance, loads
the aircraft and starts the F135. Each part was measured on one worker with
[jsbsim-fixture.probe.ts](../../0sfs/scripts/validation/ci/jsbsim-fixture.probe.ts):

| Part | F-35B, coupled plant | F-35B, empirical engine | Cessna 172 |
| --- | --- | --- | --- |
| New WASM instance | 5 ms (14 ms for a worker's first, which compiles the WASM) | 5 ms | 4 ms |
| Data files | 0.6 ms | 0.6 ms | 0.3 ms |
| Bootstrap with the engine left stopped | 14 ms | 11 ms | 5 ms |
| Starting the engine, in the bootstrap | 304 ms | none measurable | none measurable |
| One step at 120 Hz | 0.088 ms | 0.025 ms | 0.012 ms |

The bootstrap starts the engine straight after its first RunIC, and the coupled plant then solves
its steady state beginning at its design point. That is as much work as 3,450 steps, or 29
simulated seconds. An engine that is already running starts again in 2.6 ms.

At 5,000 ft and the default airspeed, starting the plant after a RunIC with the engine stopped
took 10.5 ms instead of 304 ms. It ended at the same operating point, with thrust, N1 and N2
agreeing to a relative 5×10⁻¹¹. Only that one condition was compared: at 0 kt, with no airflow,
there may be no windmilling state to start from. Making the start fast is a change to the plant
in JSBSim, not a workaround in the app.

Until then, a test file could keep one instance and restore a started state captured once for
each condition, instead of creating and starting a new one for every test. The snapshot tests
already show that a restore brings back the engine's exact state. How much this saves has not
been measured yet.

**An assertion runs on every step.** An `expect()` costs about 2.7 µs and reading a property by
name about 0.6 µs. Four `expect`s and three reads on every step made a Cessna loop 2.2 times
slower, the empirical F-35B 1.6 times, and the coupled plant 14%. Instead, read the properties
with `createPropertyBatch`, check them in plain code and assert once.

**jsdom is set up where no DOM is used.** 59 test files ask for jsdom, which takes about 0.3 s
per file to set up. A text search finds 14 of them, including the heaviest JSBSim tests, that
use no DOM API in the test itself. Check what they import before moving them to Node.

**Every file imports its modules again.** On 2026-10-07, imports took 46 s of the 123 s the
workers spent.

0sfs also generates the exhaust optics and the F135 engine assets twice: once in a test and
again in `build`. That duplicate work costs under a second.

## Hardware

Everything runs on the CPU, and none of it could use the GPU:

- Linting, typechecking and bundling are branching, single-threaded JavaScript.
- The flight model steps one aircraft at a time, and each step depends on the last.
- jsdom has no WebGL, so code that draws runs against stubs in tests.

Runs on a real GPU are benchmarks, done only when a task asks for one
([validation](validation/README.md)). They are not part of `npm run ci`.

The M5 has 4 performance cores and 6 efficiency cores, and macOS cannot pin a process to either
kind. 0sfs runs at most 5 Vitest workers (`maxWorkers: '50%'`). FOSS Earth and the tour use
Vitest's default for a run, one fewer than the cores, which is 9 here. With the editor and agents
also running, some workers end up on efficiency cores, which are slower per thread.

A busy machine slows everything down. On 2026-10-08 the 0sfs suite took 98 s. jsdom setup went
from 15 s to 39 s and transforms from 3.7 s to 9 s, though no change had touched that work, and
one test went past Vitest's 5 s timeout and failed the run. The fixture probe, run while memory
pressure was at warning, measured everything twice as slow, the Cessna included. Before reading a
slow run as a regression, check memory pressure and what else is running: see
[timing](validation/timing.md#memory).

## The editor's share of memory

VS Code's language servers index every folder of a workspace, including `node_modules` and
scratch folders. This was measured on 2026-10-08, with these three repositories, JSBSim and
gamepad-tools open in one window:

| Server | Before | After |
| --- | --- | --- |
| C/C++ (cpptools) | 3.6 GB, with a 5.1 GB index | 69 MB, with a 36 MB index |
| Python (Pylance) | 1.5 GB | 0.6 GB, then none once turned off |

cpptools' heap held 1,279,213 file nodes and 203,304 directory nodes. With no C++ configuration,
its include path is every workspace folder, searched recursively, and it keeps a node for every
file it finds. Excluding folders shrank the index but not the heap. Narrowing the include path to
JSBSim's source took the heap from 2.6 GB to 69 MB. These are the settings, in the workspace
file:

```jsonc
"C_Cpp.files.exclude": {
  "**/.vscode": true, "**/.vs": true, "**/build": true, "**/.local": true, "**/dist": true,
  "**/dist-app": true, "**/node_modules": true, "**/.delta": true, "**/.venv": true
},
"C_Cpp.default.includePath": ["<path to jsbsim>/src"],
"C_Cpp.default.browse.path": ["<path to jsbsim>/src"],
"python.analysis.exclude": ["**/node_modules", "**/__pycache__", "**/.*", "**/build", "**/dist"],
"python.languageServer": "None"
```

Agents do not need either server: they read the files and run the compilers and tests
themselves. `"python.languageServer": "None"` stops Pylance at once; set it to `"Default"` to
edit Python by hand. If you don't edit C++ by hand either, you can disable the C/C++
extensions. Disabling an extension restarts the extension host, and with it every agent session
in the window, so do it when no agent is mid-task.

VS Code's own processes also grow over a day of agent sessions. After a day with nine Claude
Code sessions open, these were the largest:

| Process | Footprint | Of which JavaScript heap |
| --- | --- | --- |
| The renderer of the Claude Code panel | 1.4 GB | 1.2 GB |
| The renderer of an idle side panel | 0.9 GB | 0.6 GB |
| The extension host, where every extension and agent session runs | 0.7 GB | 0.6 GB |

Quitting and reopening VS Code reset all three. To see what a process holds, use
`footprint <pid>` and `heap -s <pid>`. In a VS Code or Chrome process, `footprint` shows V8's
pages as "App-Specific Tag 16" and PartitionAlloc's as "Tag 14".

## Not covered yet

- **Memory leaks.** Nothing checks that memory stops growing, and the app is meant to run for
  hours. A check would repeat the operations that allocate: a scene reload and a flight over
  streamed terrain, plus, in 0sfs, an aircraft switch and a phone reconnect. Between rounds it
  would force a garbage collection in headless Chrome. It would fail when the heap, or the counts
  of meshes, textures and JSBSim instances, keep growing after the first rounds. The harness
  would live here, and each app would add the operations it allocates in.
- **Typechecking the tests**, described [above](#typechecking).
- **Triggers in FOSS Earth and the tour** for the files their tests read from disk, described
  [above](#choosing-tests).
- **The F135's start**, in JSBSim's plant, described [above](#what-makes-the-tests-slow).
- **The F-35B tests:** restore started engines instead of starting one for every test, and split
  `f35b.integration.test.ts`.
- **A report folder for every check.** `verify:exhaust` writes a dated folder under
  `build/exhaust-optics/` even when it only checks, so every build adds one. 89 had piled up by
  2026-10-08.
