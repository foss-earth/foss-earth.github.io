import { describe, expect, it } from "vitest";
import { linkParameterGroup } from "./parameterGroup";
import { createSettingsRegistry } from "./registry";
import type { ParameterSpec } from "./types";

const flag = (id: string, label = id): ParameterSpec => ({
  id,
  label,
  description: "A switch.",
  unit: "none",
  kind: "boolean",
  default: false,
  defaultReason: "Off until asked.",
  home: { tab: "renderer", section: "experiments", level: "main" },
  appliesLive: true,
  source: "src/test.ts",
});

function setup(query = "") {
  const registry = createSettingsRegistry({ storage: null, searchParams: new URLSearchParams(query) });
  registry.register([flag("group", "Every switch"), flag("a"), flag("b")]);
  return registry;
}

describe("linkParameterGroup", () => {
  it("holds every member on while the group is on, then gives each its own value back", () => {
    const registry = setup();
    registry.set("b", true);
    const stop = linkParameterGroup(registry, "group", ["a", "b"]);
    expect([registry.get("a"), registry.get("b")]).toEqual([false, true]);

    registry.set("group", true);
    expect([registry.get("a"), registry.get("b")]).toEqual([true, true]);
    expect(registry.inspect("a").provenance).toBe("host");
    expect(registry.inspect("a").layers.forced?.reason).toBe("On with Every switch.");
    // A held member keeps what the user chose underneath.
    expect(registry.set("a", false)).toEqual({ ok: true });
    expect(registry.get("a")).toBe(true);

    registry.set("group", false);
    expect([registry.get("a"), registry.get("b")]).toEqual([false, true]);
    stop();
  });

  it("follows a group turned on in the URL from the start, and releases the members when stopped", () => {
    const registry = setup("set.group=1");
    const stop = linkParameterGroup(registry, "group", ["a", "b"]);
    expect([registry.get("a"), registry.get("b")]).toEqual([true, true]);
    stop();
    expect([registry.get("a"), registry.get("b")]).toEqual([false, false]);
    registry.set("group", false);
    registry.set("group", true);
    expect(registry.get("a")).toBe(false);
  });
});
