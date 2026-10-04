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
 */
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

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

export function appFiles(): Plugin {
  return {
    name: "foss-earth-app-files",
    // Where the app finds the worker: none while developing, where nothing is hashed.
    config: (_config, env) => ({ define: { __FOSS_EARTH_APP_FILES__: JSON.stringify(env.command === "build" ? APP_FILES_WORKER : "") } }),
    generateBundle(_options, bundle) {
      const { source, unhashed } = appFilesWorker(Object.keys(bundle));
      // Kept forever under a name that does not change with it, such a file would go stale: it is left to the browser's cache.
      if (unhashed.length) this.warn(`${unhashed.length} built file(s) have no content hash in their names, so the app's worker does not keep them: ${unhashed.slice(0, 5).join(", ")}`);
      this.emitFile({ type: "asset", fileName: APP_FILES_WORKER, source });
    },
  };
}
