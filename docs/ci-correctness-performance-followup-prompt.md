# Complete CI dependency coverage and reduce expensive test setup

Date: 2026-10-08. Workhorse implementation handoff following a read-only review
of the current CI optimization. Start in `/Users/felg/gh/foss-earth`; read
`AGENTS.md`, [CI/CD](ci-cd.md), the linked timing/interference policies and the
instructions of every repository edited. Preserve concurrent work and caches.

This shared workflow belongs in **FOSS Earth**. Its consumer-specific test/config
changes belong in **0sfs** or the **UMN tour**. Generic native initialization
improvements belong in **JSBSim**, and are a separate follow-up if needed.
Name the owner before creating any module.

## Starting assessment

The current project-mode incremental `npm run typecheck` scripts and separate
build-info files are useful improvements. 0sfs retains source artifact checks,
typechecking, bundling and emitted-WASM verification. Its new
`forceRerunTriggers` cover aircraft assets and JSBSim data. Preserve these gains.

The review found additional work worth doing:

1. Import-based changed-test selection still misses some filesystem dependencies.
2. TypeScript checking excludes test files.
3. Repeated F-35B setup and a long serial test file dominate the retained suite
   profile. Their cost matters more than subsecond duplicate artifact checks.
4. Some performance probes compare different physical states, so their ratios
   cannot establish a controlled speedup or equivalent initialization.

Read the retained records in
[`0sfs/validation/evidence/ci/2026-10-08`](../../0sfs/validation/evidence/ci/2026-10-08/README.md).
The ~56 s normal-pressure and ~98 s disturbed suite runs are observations under
different conditions, not a before/after optimization result. Some typecheck
invalidation observations lack retained raw results. Do not upgrade those claims
without a reproducible record.

## 1. Correct changed-test selection

Inventory filesystem inputs of tests across the affected repositories, including
helper imports and subprocesses. Cover `readFile`, directories/globs, generated
binary inputs, fixture JSON and public data; do not search only test filenames.

Known examples:

- FOSS Earth `src/scenes/examples.test.ts` and `src/terrain/geoid.test.ts` read
  scene/grid files; `vite.config.ts` currently has no corresponding triggers.
- 0sfs `src/flight/audio/audioSnapshot.test.ts` and `dspProcessor.test.ts` read
  native headers, DSP/worklet inputs; `src/flight/aircraft/engineGasOptics.test.ts`
  reads retained fixtures. The current aircraft/XML trigger list is insufficient.
- Inspect the tour's published scene inputs under its own instructions.

Use conservative `forceRerunTriggers` initially. A more selective dependency
manifest is acceptable only with tests proving complete selection and a safe
full-suite fallback for unknown inputs. Never accept an empty selection for a
known test dependency merely because `--passWithNoTests` returns success.
Preserve defaults from Vitest when extending trigger lists.

Retain runnable isolated regression fixtures proving selection for representative
XML, aircraft asset, DSP binary/header, worklet JS, optical fixture, scene and
geoid changes. Test both `related` and the project's changed workflow where
applicable. Prefer selection inspection over repeatedly executing the full suite.
Keep fixtures in repo `build/` or proper test tooling, and never mutate another
session's working files to create a probe.

## 2. Cover test types and linked-source invalidation

Add an incremental test typecheck using an appropriate dedicated tsconfig and
build-info file. Include test helpers and correct environment types; avoid
leaking jsdom globals into pure Node contracts. Fix legitimate existing errors
or make a documented, bounded migration if the full inventory is substantial;
do not introduce blanket `any`, `@ts-nocheck` or broad exclusions to call it green.
Report the cost of this added correctness check separately from optimization.

Retain isolated fixtures for unchanged warm checks, local source edits, linked
FOSS Earth implementation/type changes and installed SDK declaration changes.
Introduce an intentional type mismatch and demonstrate failure without `--force`
or deleting a cache. Demonstrate recovery after restoring valid input. Use
`tsc -p` through the current `npm run typecheck` workflow, not `tsc -b`.
Keep build mode's behavior as historical evidence; do not rewrite old logs.

Update active workflow instructions as needed, including stale `tsc -b`
instructions in active handoffs; dated command transcripts retain their history.
Do not edit AGENTS.md for narrative detail. The current user-provided rules govern.

## 3. Optimize the expensive F-35B tests

The retained profile identifies
`0sfs/src/flight/jsbsim/f35b.integration.test.ts` as a long serial path. Split it
into coherent independently runnable files after documenting existing cases and
test identities. Retain every scenario, simulated duration, input and assertion.
Splitting must not create many simultaneously expensive setups beyond CPU/memory
limits. Choose file boundaries from responsibilities and measured workloads.

Investigate snapshot-based fixtures for tests whose purpose permits them. A
usable fixture must restore all relevant aircraft, controls, tanks, time, native
histories and plant state, with schema/profile checks and no cross-test leakage.
Engine-only exact restoration does not prove the entire test fixture is reset.
Compare fresh versus restored initial state and subsequent trajectories, including
random seeds, faults, FCS histories and external forces that the scenarios use.
Continue testing real cold/warm startup, reset, load/disposal, fuel depletion and
recovery through fresh lifecycle paths. Never turn a startup test into a replay.

Batch native property reads where appropriate. Preserve checks on every simulated
step while accumulating extrema, counts and the first failure in plain code;
assert at the end with useful failure time/state. Avoid replacing a trajectory
invariant with one final-state assertion or shortening integration windows.

Audit jsdom requirements through imported code before changing environments.
The current large F-35B test uses navigator/input handling, so a text search that
finds few DOM calls does not prove it can run in Node unchanged. Separate pure
native tests from UI/input cases through meaningful boundaries.

Keep timeout changes evidence-based and narrow. Do not hide hangs or regressions
by raising every timeout, disabling checks, weakening tolerances or assuming
repeated clean-cache runs are representative.

## 4. Repair the performance comparison method

The current `0sfs/scripts/validation/ci/jsbsim-fixture.probe.ts` measures bare,
assertion-heavy and batched loops on consecutive 0–10, 10–20 and 20–30 s windows
of one evolving engine. Those states may require different solver work. Reset
each variant to an equivalent captured state or use equivalent fresh instances.
Use the same simulated trajectory, observed properties and correctness checks.
Retain native evaluation/fallback counts so physical workload changes are visible.
Alternate execution order and separate warm-up/compilation from timed work.

Its initialization comparison reads one endpoint after a second `set-running`
and `runIc`, and compares only thrust/N1/N2. Record state immediately after each
declared operation and compare the complete relevant physical/accounting state
and subsequent trajectory. Different zero-time calls may change histories even
when three gauges agree. Treat the apparent ~304 ms versus ~10.5 ms start result
as a lead for native investigation, not an established equivalent shortcut.

Do not add an extra app `RunIC` as a performance workaround. If the native steady
solver's initial guess or repeated work is the cause, prepare a separate focused
JSBSim task with lifecycle/steady/refresh and gas/shaft/fuel/thermal invariants.
Avoid bundling a native engine algorithm change into this CI patch.

## 5. Execution and acceptance

When explicitly invoked, this handoff requests bounded **CPU** performance
comparisons of the changed CI/fixture code. It does not request GPU runs, servers,
deployment, a WASM rebuild, editor reconfiguration or deletion of build folders.
Do useful untimed dependency/correctness work first. Follow the interference
policy before assigning significance to timing; if conditions are unobservable
or disturbed, label the sample unqualified and continue useful work.

Use existing qualified baseline evidence where comparable. Measure targeted
fixtures for candidate iterations and run each owner's full final CI once when
its changes are finished, rather than treating full CI as a repeated benchmark.
Keep maximum workers at half the cores, account for memory before parallel
processes, and do not overlap suites with other sessions. Keep logs under
`build/`, retained evidence in the established CI evidence location and tools
in scripts/tests. No scratch under `/tmp` or the harness's external folders.

Acceptance requires:

- The dependency selection matrix detects every known representative disk input,
  and intentional linked/test type errors fail the incremental checks.
- All existing production artifact/build gates remain and the full suite remains
  independent of changed-test selection.
- Test splitting/setup reuse preserves the scenario/assertion inventory and
  passes fresh-versus-reused state/trajectory and isolation checks.
- Per-step invariant optimizations preserve first-failure detection and useful
  diagnostics, including injected failures within a trajectory.
- Timing comparisons use equivalent work; report candidate revisions, hardware,
  cache/compilation state, counts, repeated samples and interference. Separate
  measured improvement, added coverage cost and unqualified observations.
- Documentation records commands, new coverage and remaining work without
  promising a speedup or device performance qualification absent evidence.

Prepare a scoped change and report correctness first, then measured cost. Leave
unrelated engine behavior, UI, weather, Sky and concurrent changes untouched.
