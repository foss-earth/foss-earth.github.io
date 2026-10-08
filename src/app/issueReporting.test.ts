import { describe, expect, it } from "vitest";
import { issueReporterFromBuild } from "./issueReporting";

describe("static GitHub reporting", () => {
  it("uses the consuming app's repository without an external service or credentials", () => {
    expect(issueReporterFromBuild()).toEqual({ repository: __REPOSITORY_SLUG__ });
  });
});
