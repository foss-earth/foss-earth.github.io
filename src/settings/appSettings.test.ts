// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getAppSettings } from "./appSettings";
import { SETTINGS_STORAGE_KEY } from "./registry";

function savedValues(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}").values ?? {};
}

afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("the app registry and the address bar", () => {
  it("saves a key given in the query on this device and takes it off the address bar", () => {
    const state = { fossEarthScene: { id: "campus" } };
    window.history.replaceState(state, "", "/fly/?key=abc&scene=campus&set.map.source.cartoKey=c#invite");
    const settings = getAppSettings();

    expect(settings.inspect("map.source.googleKey")).toMatchObject({ value: "abc", provenance: "user" });
    expect(settings.get("map.source.cartoKey")).toBe("c");
    expect(savedValues()).toMatchObject({ "map.source.googleKey": "abc", "map.source.cartoKey": "c" });
    expect(settings.sessionValueIds()).toEqual([]);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/fly/?scene=campus#invite");
    expect(window.history.state).toEqual(state);
  });

  it("replaces a saved key with one from the query", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { "map.source.googleKey": "old" } }));
    window.history.replaceState(null, "", "/?googleKey=new");

    expect(getAppSettings().get("map.source.googleKey")).toBe("new");
    expect(window.location.search).toBe("");
  });

  it("writes the basemap and elevation provider chosen anywhere to the query, under the names it reads", () => {
    window.history.replaceState(null, "", "/?tiles=usgs-topo&set.map.source.elevation=aws-terrarium&scene=campus");
    const settings = getAppSettings();
    // Read as given: nothing changed, so nothing is rewritten.
    expect(window.location.search).toBe("?tiles=usgs-topo&set.map.source.elevation=aws-terrarium&scene=campus");

    settings.set("map.source.basemap", "osm-standard");
    // Mapterhorn is the default: choosing it is still a choice.
    settings.set("map.source.elevation", "mapterhorn");
    expect(window.location.search).toBe("?scene=campus&mapSource=osm-standard&elevationSource=mapterhorn");

    settings.reset("map.source.basemap");
    expect(window.location.search).toBe("?scene=campus&mapSource=usgs-imagery-topo&elevationSource=mapterhorn");
  });

  it("names nothing while only a default moves, and names the default once it is chosen", () => {
    window.history.replaceState(null, "", "/?scene=campus");
    const settings = getAppSettings();
    settings.setHostDefault("map.source.basemap", "google", "a Google Maps API key was given");
    expect(window.location.search).toBe("?scene=campus");

    settings.set("map.source.basemap", "osm-standard");
    settings.set("map.source.basemap", "google");
    expect(settings.inspect("map.source.basemap").provenance).toBe("host-default");
    expect(window.location.search).toBe("?scene=campus&mapSource=google");
  });

  it("leaves the query alone while a host forces the basemap", () => {
    window.history.replaceState(null, "", "/?mapSource=usgs-topo");
    const release = getAppSettings().force("map.source.basemap", "osm-standard", "a test");
    expect(window.location.search).toBe("?mapSource=usgs-topo");
    release();
    expect(window.location.search).toBe("?mapSource=usgs-topo");
  });
});
