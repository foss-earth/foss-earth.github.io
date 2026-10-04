import { describe, expect, it } from "vitest";
import { BUILD_STAMP_META, buildStampOf, compareBuildStamps } from "./buildStamp";

const page = (head: string): string => `<!doctype html><html><head><meta charset="UTF-8" />${head}<title>Tour</title></head><body><div id="root"></div></body></html>`;

describe("a page's build stamp", () => {
  it("is read from the meta the build wrote, however its attributes are written", () => {
    expect(buildStampOf(page(`<meta name="${BUILD_STAMP_META}" content="2026-10-04T17:33:49.408Z">`))).toBe("2026-10-04T17:33:49.408Z");
    expect(buildStampOf(page(`<meta content='2026-10-04T17:33:49.408Z' name='${BUILD_STAMP_META}' />`))).toBe("2026-10-04T17:33:49.408Z");
    expect(buildStampOf(page(`<META NAME="${BUILD_STAMP_META}" CONTENT=" 2026-10-04T17:33:49.408Z ">`))).toBe("2026-10-04T17:33:49.408Z");
  });

  it("is null for a page without one: another site's page, an error page, a page built before stamps", () => {
    expect(buildStampOf(page(""))).toBeNull();
    expect(buildStampOf(page(`<meta name="description" content="2026-10-04T17:33:49.408Z">`))).toBeNull();
    expect(buildStampOf(page(`<meta name="${BUILD_STAMP_META}-of-another" content="x">`))).toBeNull();
    expect(buildStampOf(page(`<meta name="${BUILD_STAMP_META}" content="">`))).toBeNull();
    expect(buildStampOf("Not Found")).toBeNull();
  });

  it("compares as the time it is", () => {
    expect(compareBuildStamps("2026-10-03T05:33:53.461Z", "2026-10-04T17:33:49.408Z")).toBe("newer");
    expect(compareBuildStamps("2026-10-04T17:33:49.408Z", "2026-10-03T05:33:53.461Z")).toBe("older");
    expect(compareBuildStamps("2026-10-04T17:33:49.408Z", "2026-10-04T17:33:49.408Z")).toBe("same");
    // The same instant written another way.
    expect(compareBuildStamps("2026-10-04T17:33:49.408Z", "2026-10-04T12:33:49.408-05:00")).toBe("same");
  });

  it("does not call a stamp newer that is not a time", () => {
    expect(compareBuildStamps("2026-10-04T17:33:49.408Z", "release-7")).toBe("older");
    expect(compareBuildStamps("release-6", "release-7")).toBe("older");
    expect(compareBuildStamps("release-7", "release-7")).toBe("same");
  });
});
