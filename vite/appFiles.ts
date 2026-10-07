/**
 * Keeps an app's own files on the visitor's device (docs/app-files.md): a
 * Vite plugin that writes FOSS Earth's service worker (appFilesWorker.js)
 * into a build, with the build's file list, and tells the app where it is.
 * An app built on FOSS Earth adds it to its vite.config.ts:
 *
 *   import { appFiles } from "foss-earth/vite";
 *   export default defineConfig({ plugins: [appFiles()] });
 *
 * The app registers the worker itself (src/app/appFiles.ts), as Settings →
 * App files asks. Without the plugin, nothing is kept and the browser's own
 * cache applies.
 *
 * It also stamps each page of a build with the time it was built, which is
 * how the app tells a browser's own copy of an older page from the page the
 * site publishes (src/app/publishedVersion.ts), and with the commits it was
 * built from: the app's own, and FOSS Earth's in an app of another
 * repository, which the app shows too (src/app/appIdentity.ts). The page's
 * source then says which version a site publishes, and the app which one a
 * device runs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { BUILD_STAMP_META } from "../src/app/buildStamp.ts";

/** The worker's file, at the build's root beside its pages. */
export const APP_FILES_WORKER = "foss-earth-sw.js";
/** A built file whose name carries its content's hash, as Vite names them: `index-BTEeolEJ.js`. */
const HASHED = /-[\w-]{8}\.[a-z0-9]+$/i;

/** The worker for a build of `fileNames`, as the bundle names them. Only names with a content hash are kept; the others are returned too. */
export function appFilesWorker(fileNames: readonly string[]): { source: string; kept: string[]; unhashed: string[] } {
  const files = fileNames.filter(name => !name.endsWith(".html") && !name.endsWith(".map") && name !== APP_FILES_WORKER);
  const kept = files.filter(name => HASHED.test(name)).sort();
  const unhashed = files.filter(name => !HASHED.test(name)).sort();
  const worker = readFileSync(new URL("./appFilesWorker.js", import.meta.url), "utf8");
  return { source: `"use strict";\n${worker}\ninstall(self, ${JSON.stringify(kept)});\n`, kept, unhashed };
}

/** The names of the page's other two stamps: the app's own commit, and FOSS Earth's. */
export const APP_SOURCE_META = "foss-earth-app-source";
export const FOSS_EARTH_SOURCE_META = "foss-earth-source";
/** FOSS Earth's checkout: the folder above this one. */
const FOSS_EARTH_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** What of FOSS Earth an app is built from: a change to anything else, as its docs, does not change the app. */
const BUILT_FROM = ["src", "vite", "package.json", "package-lock.json"];

/** A folder's own path, whatever link it was reached through; as given where it does not exist. */
function real(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    return path.resolve(folder);
  }
}

/** A string the app's config defined, as `__BUILD_TIME__: JSON.stringify(…)`, or null. */
export function definedString(define: Record<string, unknown> | undefined, name: string): string | null {
  try {
    const value: unknown = typeof define?.[name] === "string" ? JSON.parse(define[name]) : null;
    return typeof value === "string" && value ? value : null;
  } catch {
    // Not a string the config wrote as JSON.
    return null;
  }
}

/** A build's stamp: the time its About shows (`__BUILD_TIME__`) where the app's config defines one, so the page and the app name the build alike; else now. */
export function buildStamp(define: Record<string, unknown> | undefined): string {
  return definedString(define, "__BUILD_TIME__") ?? new Date().toISOString();
}

/**
 * The commit of the FOSS Earth checkout at `root`, as "35ad0e3f1c2a", with
 * "-dirty" where what an app is built from has changes not committed; "" where
 * `root` is not a git checkout, as a copy installed from a package.
 */
export function fossEarthSource(root: string = FOSS_EARTH_ROOT): string {
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    // Only where `root` is the checkout itself: inside another repository's folder, git would answer with that one's commit.
    if (real(git("rev-parse", "--show-toplevel")) !== real(root)) return "";
    const commit = git("rev-parse", "--short=12", "HEAD");
    return commit ? `${commit}${git("status", "--short", "--", ...BUILT_FROM) ? "-dirty" : ""}` : "";
  } catch {
    return "";
  }
}

export function appFiles(): Plugin {
  /** Empty while developing: a page that is not a build has no version to compare. */
  let stamp = "";
  let appSource: string | null = null;
  let fossEarth = "";
  return {
    name: "foss-earth-app-files",
    // Where the app finds the worker: none while developing, where nothing is hashed.
    config(config, env) {
      stamp = env.command === "build" ? buildStamp(config.define) : "";
      appSource = definedString(config.define, "__SOURCE_VERSION__");
      // FOSS Earth's own app is built from its own repository: its source is the app's.
      const own = real(config.root ?? process.cwd()) === real(FOSS_EARTH_ROOT);
      fossEarth = own ? "" : fossEarthSource();
      return { define: { __FOSS_EARTH_APP_FILES__: JSON.stringify(env.command === "build" ? APP_FILES_WORKER : ""), __FOSS_EARTH_SOURCE__: JSON.stringify(fossEarth) } };
    },
    // Every page of the build says which build wrote it, and from which commits.
    transformIndexHtml: () => (stamp ? Object.entries({ [BUILD_STAMP_META]: stamp, [APP_SOURCE_META]: appSource, [FOSS_EARTH_SOURCE_META]: fossEarth })
      .flatMap(([name, content]) => (content ? [{ tag: "meta", attrs: { name, content }, injectTo: "head" as const }] : [])) : []),
    generateBundle(_options, bundle) {
      const { source, unhashed } = appFilesWorker(Object.keys(bundle));
      // Kept forever under a name that does not change with it, such a file would go stale: it is left to the browser's cache.
      if (unhashed.length) this.warn(`${unhashed.length} built file(s) have no content hash in their names, so the app's worker does not keep them: ${unhashed.slice(0, 5).join(", ")}`);
      this.emitFile({ type: "asset", fileName: APP_FILES_WORKER, source });
    },
  };
}
