import { describe, expect, it } from "vitest";
import { describeAppFiles } from "./appFilesSection";

const status = { unavailable: null, installed: true, controlling: true, files: 34, bytes: 7.25 * 1024 * 1024 };

describe("the app files section", () => {
  it("says what is kept and whether this visit was answered from it", () => {
    expect(describeAppFiles(status)).toBe("34 files (7.3 MB) of the app kept on this device. This visit takes them from there.");
    expect(describeAppFiles({ ...status, controlling: false })).toMatch(/The next visit takes them from there\.$/);
    expect(describeAppFiles({ ...status, installed: false, files: 0, bytes: 0 })).toBe("Nothing kept yet: the app's files are kept once this page has loaded.");
    expect(describeAppFiles({ ...status, installed: false })).toMatch(/from before keeping was turned off/);
  });

  it("says why nothing can be kept, in the keeper's words", () => {
    expect(describeAppFiles({ ...status, unavailable: "This build has no worker to keep its files." })).toBe("This build has no worker to keep its files.");
    expect(describeAppFiles(null)).toBe("Reading the app's files…");
  });
});
