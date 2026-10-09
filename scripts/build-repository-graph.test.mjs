import { describe, expect, it } from "vitest";
import { rebaseGraphLinks, renderRepositoryGraph, validateGraphData } from "./build-repository-graph.mjs";

function fixture() {
  return {
    schemaVersion: 1, owner: "world", title: "World graph", date: "2026-10-08", summary: "Proposal", sourceDocument: "proposal.md", sourceLabel: "Proposal", dataFile: "graph.json",
    relatedGraphs: [{ label: "Other app", href: "../other/graph.html" }],
    scope: { owner: "world", allowedOwners: ["world", "flight"], dependencyOwners: { world: ["world"], flight: ["world", "flight"] } },
    groups: [{ id: "modules", title: "Modules" }],
    nodes: [{ id: "a", name: "world/a", owner: "world", group: "modules", tab: "A", detail: "A" }, { id: "b", name: "world/b", owner: "world", group: "modules", tab: "B", detail: "B" }],
    edges: [{ from: "a", to: "b", type: "code", reason: "Uses B" }],
  };
}

describe("application-owned repository graph generation", () => {
  it.each(["code", "content", "reference"])("rejects ownership inversion for %s relations", type => {
    const data = fixture();
    data.nodes[1].owner = "flight";
    data.edges[0].type = type;
    expect(() => validateGraphData(data)).toThrow("Ownership inversion");
  });

  it("rejects a literal code cycle separately from reference links", () => {
    const data = fixture();
    data.edges.push({ from: "b", to: "a", type: "reference", reason: "Documents A" });
    expect(() => validateGraphData(data)).not.toThrow();
    data.edges[1].type = "code";
    expect(() => validateGraphData(data)).toThrow("Code dependency cycle");
  });

  it("keeps links rooted at the authoritative input when output moves", () => {
    const rebased = rebaseGraphLinks(fixture(), "/project/docs", "/project/build/run");
    expect(rebased.sourceDocument).toBe("../../docs/proposal.md");
    expect(rebased.dataFile).toBe("../../docs/graph.json");
    expect(rebased.relatedGraphs[0].href).toBe("../../other/graph.html");
  });

  it("escapes rendered labels and prevents metadata from closing its JSON script", () => {
    const data = fixture();
    data.title = "<img src=x>";
    data.nodes[0].detail = "</script><script>throw 1</script>";
    const output = renderRepositoryGraph(data, "<h1>__GRAPH_TITLE__</h1><script type=application/json>__GRAPH_DATA__</script>");
    expect(output).toContain("&lt;img src=x&gt;");
    expect(output).not.toContain("</script><script>throw");
    expect(output).toContain("\\u003c/script>");
  });

  it("rejects owner labels that escape the default build output folder", () => {
    const data = fixture();
    data.owner = data.scope.owner = "../outside";
    expect(() => validateGraphData(data)).toThrow("safe organization label");
  });
});
