import { describe, expect, it } from "vitest";
import { describeAppIdentity, describeAppIdentityBriefly, fossEarthSource } from "./appIdentity";

describe("the app's identity", () => {
  it("names the build, the app's commit, FOSS Earth's in an app of another repository, and the bundle", () => {
    expect(describeAppIdentity({ build: "2026-10-04T17:33:49.408Z", source: "a2c6c2894e12", fossEarth: "35ad0e3f1c2a", bundle: "twinCities-BVTOJrr3.js" }))
      .toBe("App built 2026-10-04T17:33:49.408Z from a2c6c2894e12 with FOSS Earth 35ad0e3f1c2a, bundle twinCities-BVTOJrr3.js");
    // FOSS Earth's own app: its source is the app's.
    expect(describeAppIdentity({ build: "2026-10-04T17:32:10.000Z", source: "35ad0e3f1c2a-dirty", fossEarth: "", bundle: "index-BuB4WdFu.js" }))
      .toBe("App built 2026-10-04T17:32:10.000Z from 35ad0e3f1c2a-dirty, bundle index-BuB4WdFu.js");
  });

  it("says the same in the few words a phone's log has room for", () => {
    expect(describeAppIdentityBriefly({ build: "2026-10-04T17:33:49.408Z", source: "a2c6c2894e12", fossEarth: "35ad0e3f1c2a-dirty", bundle: "twinCities-BVTOJrr3.js" }))
      .toBe("App built 2026-10-04 17:33 UTC from a2c6c28 with FOSS Earth 35ad0e3-dirty");
    expect(describeAppIdentityBriefly({ build: "2026-10-04T12:33:49-05:00", source: "35ad0e3f1c2a", fossEarth: "", bundle: "index-BuB4WdFu.js" }))
      .toBe("App built 2026-10-04 17:33 UTC from 35ad0e3");
    // What is not a time or a commit is said as it is.
    expect(describeAppIdentityBriefly({ build: "a development server", source: "unknown", fossEarth: "", bundle: "dev" })).toBe("App built a development server from unknown");
  });

  it("has no commit of FOSS Earth's where the build recorded none, as these tests", () => {
    expect(fossEarthSource()).toBe("");
  });
});
