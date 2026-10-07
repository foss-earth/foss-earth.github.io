/**
 * `foss-earth/vite`: what an app built on FOSS Earth adds to its Vite
 * config. `appFiles()` keeps the app's own files on the visitor's device and
 * stamps each page with its build; `builtFrom()` writes what the app is built
 * from into each page, for its About tab.
 */
export * from "./appFiles.ts";
export * from "./builtFrom.ts";
