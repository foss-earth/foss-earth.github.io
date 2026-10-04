/**
 * The stamp a build puts in each of its pages: the time it was built, in a
 * `<meta name="foss-earth-build">`. The appFiles Vite plugin
 * (vite/appFiles.ts) writes it and the app reads it (publishedVersion.ts),
 * from the page it was started from and from the page the site publishes, to
 * tell when a browser is showing its own copy of an older page.
 */

/** The `<meta>`'s name. */
export const BUILD_STAMP_META = "foss-earth-build";

/** The stamp in a page's HTML, or null when the page carries none. */
export function buildStampOf(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`\\bname\\s*=\\s*["']?${BUILD_STAMP_META}["']?(?:\\s|/|>)`, "i").test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    return (content?.[1] ?? content?.[2] ?? "").trim() || null;
  }
  return null;
}

/**
 * How two stamps compare, as times: "same", "newer" when `other` was built
 * after `mine`, "older" when before. Stamps that are not both times, and not
 * the same, are "older": nothing says the other is newer.
 */
export function compareBuildStamps(mine: string, other: string): "same" | "newer" | "older" {
  if (mine === other) return "same";
  const [mineAt, otherAt] = [timeOf(mine), timeOf(other)];
  if (mineAt === otherAt) return "same";
  return otherAt > mineAt ? "newer" : "older";
}

/** A time as a build writes it, such as 2026-10-04T17:33:49.408Z. `Date.parse` alone reads a date into almost any text. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const timeOf = (stamp: string): number => (ISO_TIME.test(stamp) ? Date.parse(stamp) : Number.NaN);
