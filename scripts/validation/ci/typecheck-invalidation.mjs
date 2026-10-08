#!/usr/bin/env node
/**
 * Whether a repository's `npm run typecheck` sees a type error wherever it comes
 * from, with no `--force` and no deleted cache, and passes again once the input
 * is put back. Its sources, its tests, a package linked into node_modules as FOSS
 * Earth is linked into 0sfs and the UMN tour, and the declarations of an
 * installed package as JSBSim's SDK is installed into 0sfs are each broken in
 * turn. The check builds a small sandbox app from the repository's own tsconfig
 * files and its own `typecheck` script, so the repository's files are never
 * changed. It runs the script with npm, as a person does.
 *
 * A control shows why the script uses `tsc -p` and not build mode: `tsc -b` with
 * `incremental` on calls the project up to date after the linked package changed.
 *
 *   node scripts/validation/ci/typecheck-invalidation.mjs [--repo=<checkout>] [--out=<folder>]
 *
 * --repo defaults to this checkout. The run's folder (result.json and each run's
 * output) defaults to a new dated folder in that checkout's gitignored scratch,
 * build/ or .local/. Exits 1 when any step did not do what it should.
 * What the checks mean: docs/ci-cd.md#typechecking.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: { repo: { type: "string" }, out: { type: "string" } },
});
const repo = path.resolve(options.repo ?? fileURLToPath(new URL("../../../", import.meta.url)));
const packageJson = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const command = packageJson.scripts?.typecheck;
if (!command) throw new Error(`${repo}/package.json has no typecheck script`);
const configs = [...command.matchAll(/(?:^|\s)-p\s+(\S+)/g)].map(match => match[1]);
const out = path.resolve(options.out ?? newRunDirectory(repo, "validation", "ci", "typecheck-invalidation"));
mkdirSync(out, { recursive: true });

// The sandbox: an app with a local module, a test, a linked package and an installed one.
const sandbox = path.join(out, "sandbox");
const app = path.join(sandbox, "app");
const files = {
  "app/package.json": JSON.stringify({ name: "typecheck-sandbox", private: true, scripts: { typecheck: command } }, null, 2),
  "app/vite.config.ts": "export default {}\n",
  "app/src/util.ts": "export function half(value: number) {\n  return value / 2\n}\n",
  "app/src/main.ts": [
    'import { liftNewtons, type LinkedSettings } from "sandbox-linked"',
    'import { thrustNewtons } from "sandbox-installed"',
    'import { half } from "./util.ts"',
    "",
    "const halved: number = half(4)",
    "const lift: number = liftNewtons(3)",
    "const thrust: number = thrustNewtons(0.5)",
    "const settings: LinkedSettings = { gain: 2 }",
    "export const total = halved + lift + thrust * settings.gain",
    "",
  ].join("\n"),
  "app/src/main.test.ts": [
    'import { expect, it } from "vitest"',
    'import { liftNewtons } from "sandbox-linked"',
    'import { half } from "./util.ts"',
    "",
    'it("adds", () => {',
    "  const lift: number = liftNewtons(2)",
    "  const value: number = half(4)",
    "  expect(value + lift).toBe(6)",
    "})",
    "",
  ].join("\n"),
  "linked/package.json": JSON.stringify({ name: "sandbox-linked", private: true, type: "module", exports: { ".": "./src/index.ts" } }, null, 2),
  "linked/src/index.ts": [
    "export interface LinkedSettings {",
    "  gain: number",
    "}",
    "",
    "export function liftNewtons(mass: number) {",
    "  return mass * 2",
    "}",
    "",
  ].join("\n"),
  "app/node_modules/sandbox-installed/package.json": JSON.stringify({
    name: "sandbox-installed", version: "1.0.0", type: "module",
    exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
  }, null, 2),
  "app/node_modules/sandbox-installed/index.d.ts": "export declare function thrustNewtons(throttle: number): number;\n",
  "app/node_modules/sandbox-installed/index.js": "export function thrustNewtons(throttle) {\n  return throttle * 1000\n}\n",
};
for (const [file, text] of Object.entries(files)) write(path.join(sandbox, file), text);
for (const config of configs) write(path.join(app, config), readFileSync(path.join(repo, config), "utf8"));
// The repository's tsconfig files may extend one another; copy the bases they name too.
for (const name of readdirSync(repo).filter(name => /^tsconfig.*\.json$/.test(name))) {
  if (!configs.includes(name)) write(path.join(app, name), readFileSync(path.join(repo, name), "utf8"));
}
// Every installed package the configs and the tests resolve, as the repository has it,
// except npm's and the checks' own caches; .tmp is the sandbox's own.
const modules = path.join(app, "node_modules");
for (const name of readdirSync(path.join(repo, "node_modules"))) {
  if ([".bin", ".cache", ".tmp", ".vite", ".package-lock.json", "sandbox-installed"].includes(name)) continue;
  symlinkSync(path.join(repo, "node_modules", name), path.join(modules, name));
}
symlinkSync(path.join("..", "..", "linked"), path.join(modules, "sandbox-linked"));
mkdirSync(path.join(modules, ".bin"));
symlinkSync(path.join("..", "typescript", "bin", "tsc"), path.join(modules, ".bin", "tsc"));
mkdirSync(path.join(modules, ".tmp"));

const steps = [];
let failures = 0;

/** Runs the repository's typecheck script in the sandbox and records what it said. */
function typecheck(name, expectation) {
  const started = performance.now();
  const run = spawnSync("npm", ["run", "typecheck"], {
    cwd: app, encoding: "utf8", env: { ...process.env, npm_config_update_notifier: "false", FORCE_COLOR: "0" },
  });
  const ms = Math.round(performance.now() - started);
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  writeFileSync(path.join(out, `${String(steps.length + 1).padStart(2, "0")}-${name}.log`), output);
  const errors = [...output.matchAll(/^(\S+?)\(\d+,\d+\): error (TS\d+)/gm)].map(match => ({ file: match[1], code: match[2] }));
  const failed = run.status !== 0;
  const ok = expectation.fails
    ? failed && errors.some(error => error.code === expectation.code && error.file.endsWith(expectation.file))
    : !failed && errors.length === 0;
  if (!ok) failures++;
  steps.push({ name, expected: expectation.fails ? `fails with ${expectation.code} in ${expectation.file}` : "passes", exitCode: run.status, errors, wallMs: ms, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: exit ${run.status}, ${errors.length} errors, ${ms} ms`);
}

/** Breaks one file, checks that the typecheck fails where it should, puts it back and checks that it passes. */
function breakAndRestore(name, file, from, to, expected) {
  const target = path.join(sandbox, file);
  const original = readFileSync(target, "utf8");
  if (!original.includes(from)) throw new Error(`${file} does not contain ${from}`);
  writeFileSync(target, original.replace(from, to));
  typecheck(`${name}-broken`, { fails: true, ...expected });
  writeFileSync(target, original);
  typecheck(`${name}-restored`, { fails: false });
}

typecheck("cold", { fails: false });
typecheck("warm-unchanged", { fails: false });
breakAndRestore("local-source", "app/src/util.ts", "return value / 2", "return String(value / 2)",
  { code: "TS2322", file: "src/main.ts" });
breakAndRestore("test-file", "app/src/main.test.ts", "const value: number = half(4)", "const value: number = String(half(4))",
  { code: "TS2322", file: "src/main.test.ts" });
breakAndRestore("linked-implementation", "linked/src/index.ts", "return mass * 2", "return `${mass * 2}`",
  { code: "TS2322", file: "src/main.ts" });
breakAndRestore("linked-type", "linked/src/index.ts", "gain: number", "gain: string",
  { code: "TS2322", file: "src/main.ts" });
breakAndRestore("installed-declaration", "app/node_modules/sandbox-installed/index.d.ts",
  "(throttle: number): number", "(throttle: number): string", { code: "TS2322", file: "src/main.ts" });

// The control: build mode with incremental on, on a copy of the app's config.
const control = { config: "tsconfig.build-control.json" };
const appConfig = configs.find(config => config.includes("app")) ?? configs[0];
write(path.join(app, control.config), JSON.stringify({
  extends: `./${appConfig}`,
  compilerOptions: { incremental: true, tsBuildInfoFile: "./node_modules/.tmp/build-control.tsbuildinfo" },
}, null, 2));
const tsc = (...args) => {
  const run = spawnSync(path.join(modules, ".bin", "tsc"), args, { cwd: app, encoding: "utf8" });
  return { exitCode: run.status, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
};
const linked = path.join(sandbox, "linked/src/index.ts");
const linkedOriginal = readFileSync(linked, "utf8");
control.first = tsc("-b", control.config, "--verbose");
writeFileSync(linked, linkedOriginal.replace("return mass * 2", "return `${mass * 2}`"));
control.afterLinkedChange = tsc("-b", control.config, "--verbose");
control.projectMode = tsc("-p", control.config, "--incremental");
writeFileSync(linked, linkedOriginal);
writeFileSync(path.join(out, "control-build-mode.log"),
  Object.entries(control).filter(([, value]) => typeof value === "object").map(([name, value]) => `## ${name} (exit ${value.exitCode})\n${value.output}`).join("\n"));
control.buildModeMissedLinkedChange = control.first.exitCode === 0 && control.afterLinkedChange.exitCode === 0
  && /is up to date/.test(control.afterLinkedChange.output);
control.projectModeCaughtIt = control.projectMode.exitCode !== 0 && /error TS2322/.test(control.projectMode.output);
console.log(`control: tsc -b ${control.buildModeMissedLinkedChange ? "missed" : "did not miss"} the linked change; tsc -p ${control.projectModeCaughtIt ? "caught" : "did not catch"} it`);

const git = args => spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout.trim();
const result = {
  schema: "foss-earth-typecheck-invalidation/1",
  measuredAt: new Date().toISOString(),
  repository: path.basename(repo),
  commit: git(["rev-parse", "--short=12", "HEAD"]),
  configsChanged: git(["status", "--short", "--", "package.json", ...readdirSync(repo).filter(name => /^tsconfig.*\.json$/.test(name))]),
  typecheckScript: command,
  configs,
  typescript: JSON.parse(readFileSync(path.join(repo, "node_modules/typescript/package.json"), "utf8")).version,
  node: process.version,
  cpu: os.cpus()[0]?.model,
  timings: "Wall-clock ms of each npm run, unqualified: other work on the machine was not observed.",
  steps,
  control: {
    buildModeMissedLinkedChange: control.buildModeMissedLinkedChange,
    projectModeCaughtIt: control.projectModeCaughtIt,
    exitCodes: { first: control.first.exitCode, afterLinkedChange: control.afterLinkedChange.exitCode, projectMode: control.projectMode.exitCode },
  },
  ok: failures === 0,
};
writeFileSync(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(`${failures === 0 ? "All steps did what they should" : `${failures} steps did not`}. Wrote ${path.join(out, "result.json")}`);
process.exitCode = failures === 0 ? 0 : 1;

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A new dated folder in the checkout's gitignored scratch: build/ in FOSS Earth and 0sfs, .local/ in the UMN tour. */
function newRunDirectory(checkout, ...where) {
  const scratch = ["build", ".local"].find(name =>
    spawnSync("git", ["check-ignore", "-q", `${name}/x`], { cwd: checkout }).status === 0);
  if (!scratch) throw new Error(`${checkout} ignores neither build/ nor .local/; pass --out`);
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_`
    + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const parent = path.join(checkout, scratch, ...where);
  mkdirSync(parent, { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const directory = path.join(parent, attempt === 1 ? stamp : `${stamp}-${attempt}`);
    try {
      mkdirSync(directory);
      return directory;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
