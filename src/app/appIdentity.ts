/**
 * Which version of the app runs: when it was built, and from which commits.
 * A device with no console has no other way to say, so the app says it in its
 * log as it opens, and Settings → About and the diagnostics report repeat it
 * (docs/diagnostics.md).
 */

/** Set by the appFiles Vite plugin (vite/appFiles.ts): FOSS Earth's own commit in an app of another repository, else "". */
declare const __FOSS_EARTH_SOURCE__: string | undefined;

export interface AppIdentity {
  /** When the app was built, as an ISO time: the stamp its page carries too (buildStamp.ts). */
  build: string;
  /** The commit of the app's own repository, with "-dirty" where it was built with changes not committed. */
  source: string;
  /** FOSS Earth's commit in an app built on it from another repository; "" in FOSS Earth's own app, whose source it is, and in a build that did not record it. */
  fossEarth: string;
  /** The page's built script: "index-1a2B3c4D.js", or "dev" for one not built. */
  bundle: string;
}

/** FOSS Earth's commit as the build recorded it, or "". */
export const fossEarthSource = (): string => (typeof __FOSS_EARTH_SOURCE__ === "string" ? __FOSS_EARTH_SOURCE__ : "");

/** "App built 2026-10-04T17:33:49.408Z from a2c6c2894e12 with FOSS Earth 35ad0e3f1c2a, bundle twinCities-BVTOJrr3.js". */
export function describeAppIdentity(identity: AppIdentity): string {
  return `App built ${identity.build} from ${identity.source}${identity.fossEarth ? ` with FOSS Earth ${identity.fossEarth}` : ""}, bundle ${identity.bundle}`;
}

/** A build's time to the minute, "2026-10-04 17:33 UTC"; anything that is not a time, as it is. */
export function buildMinute(build: string): string {
  const at = /^\d{4}-\d{2}-\d{2}T/.test(build) ? Date.parse(build) : Number.NaN;
  return Number.isNaN(at) ? build : `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** A commit as `git log --oneline` shortens it, "a2c6c28", keeping "-dirty"; anything else, as it is. */
const short = (commit: string): string => commit.replace(/^([0-9a-f]{7})[0-9a-f]*(-dirty)?$/, "$1$2");

/**
 * The same in the few words a phone's log has room for, enough to tell one
 * release from another: "App built 2026-10-04 17:33 UTC from a2c6c28 with FOSS
 * Earth 35ad0e3". Settings → About and the report have it in full.
 */
export function describeAppIdentityBriefly(identity: AppIdentity): string {
  return `App built ${buildMinute(identity.build)} from ${short(identity.source)}${identity.fossEarth ? ` with FOSS Earth ${short(identity.fossEarth)}` : ""}`;
}
