import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newOutputDirectory } from "./lib/outputDirectory.mjs";

const templatePath = fileURLToPath(new URL("../docs/proposals/repository-graph-template.html", import.meta.url));
const edgeTypes = new Set(["code", "content", "reference"]);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const hash = value => createHash("sha256").update(value).digest("hex");
const localLink = value => typeof value === "string" && value.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value);
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

/** Validate application-owned metadata without embedding organization rules in the viewer. */
export function validateGraphData(data) {
  if (data.schemaVersion !== 1 || !data.owner || !data.title || !data.scope) throw new Error("Expected graph schemaVersion 1, owner, title and scope.");
  if (!/^[a-z\d][a-z\d._-]*$/i.test(data.owner)) throw new Error("Expected a safe organization label for owner.");
  if (data.scope.owner !== data.owner) throw new Error("Graph owner and scope owner differ.");
  if (!Array.isArray(data.scope.allowedOwners) || !data.scope.dependencyOwners) throw new Error("Expected explicit allowed owners and dependency-owner rules.");
  if (!Array.isArray(data.groups) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("Expected groups, nodes and edges arrays.");
  const groups = new Set(data.groups.map(group => group.id));
  if (groups.size !== data.groups.length) throw new Error("Duplicate group id.");
  const nodes = new Map();
  for (const node of data.nodes) {
    if (!node.id || !node.name || !node.owner || !node.detail || !node.tab || !groups.has(node.group)) throw new Error(`Invalid node: ${node.id ?? "unnamed"}.`);
    if (nodes.has(node.id)) throw new Error(`Duplicate node: ${node.id}.`);
    if (!data.scope.allowedOwners.includes(node.owner)) throw new Error(`Node owner outside scope: ${node.owner}.`);
    nodes.set(node.id, node);
  }
  for (const edge of data.edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to || !edgeTypes.has(edge.type) || !edge.reason || edge.from === edge.to) throw new Error(`Invalid relation: ${edge.from} → ${edge.to}.`);
    const allowed = data.scope.dependencyOwners[from.owner];
    if (!allowed?.includes(to.owner)) throw new Error(`Ownership inversion (${edge.type}): ${from.name} → ${to.name}.`);
  }
  const active = new Set(), complete = new Set();
  function visit(id) {
    if (active.has(id)) throw new Error(`Code dependency cycle at ${id}.`);
    if (complete.has(id)) return;
    active.add(id);
    for (const edge of data.edges) if (edge.type === "code" && edge.from === id) visit(edge.to);
    active.delete(id);
    complete.add(id);
  }
  for (const id of nodes.keys()) visit(id);
  for (const link of [data.sourceDocument, data.dataFile, ...(data.relatedGraphs ?? []).map(item => item.href)]) {
    if (!localLink(link)) throw new Error(`Expected local documentation link: ${link}.`);
  }
  return data;
}

/** Local links in metadata are relative to its JSON, even for dated build outputs. */
export function rebaseGraphLinks(data, inputDirectory, outputDirectory) {
  const rebase = value => {
    const [, pathname, suffix] = value.match(/^([^?#]*)(.*)$/);
    return (path.relative(outputDirectory, path.resolve(inputDirectory, pathname)).split(path.sep).join("/") || ".") + suffix;
  };
  return { ...data, sourceDocument: rebase(data.sourceDocument), dataFile: rebase(data.dataFile), relatedGraphs: (data.relatedGraphs ?? []).map(link => ({ ...link, href: rebase(link.href) })) };
}

/** Generate a self-contained artifact; the JSON remains its application's source of truth. */
export function renderRepositoryGraph(data, template, provenance = "Generated from application-owned graph JSON.") {
  validateGraphData(data);
  const staticIndex = data.groups.map(group => `<h3>${escapeHtml(group.title)}</h3><ul>${data.nodes.filter(node => node.group === group.id).map(node => {
    const relations = data.edges.filter(edge => edge.from === node.id).map(edge => `${data.nodes.find(target => target.id === edge.to).name} (${edge.type})`).join("; ");
    return `<li><strong>${escapeHtml(node.name)}</strong> · ${escapeHtml(node.owner)} · ${node.existing ? "existing repository, proposed boundary" : node.kind === "contract" ? "proposed data contract" : "planned repository"}<p>${escapeHtml(node.detail)}</p><p>Consumes: ${escapeHtml(relations || "none in this proposal")}</p></li>`;
  }).join("")}</ul>`).join("");
  const values = {
    GRAPH_TITLE: escapeHtml(data.title), GRAPH_OWNER: escapeHtml(data.owner), GRAPH_DATE: escapeHtml(data.date),
    GRAPH_SUMMARY: escapeHtml(data.summary), SOURCE_URL: escapeHtml(data.sourceDocument), SOURCE_LABEL: escapeHtml(data.sourceLabel),
    DATA_URL: escapeHtml(data.dataFile), RELATED_LINKS: (data.relatedGraphs ?? []).map(link => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join(" · "),
    STATIC_INDEX: staticIndex, GENERATION_PROVENANCE: provenance.replaceAll("-->", "-- >"),
    GRAPH_DATA: JSON.stringify(data).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029"),
  };
  return template.replace(/__([A-Z_]+)__/g, (placeholder, key) => {
    if (!(key in values)) throw new Error(`Unknown template placeholder: ${placeholder}.`);
    return values[key];
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write("Usage: node scripts/build-repository-graph.mjs --input=path/to/graph.json [--out=path/to/graph.html]\nWithout --out, output goes to a new dated build/repository-graphs/ folder.\n");
    return;
  }
  for (const arg of args) if (!/^--(?:input|out)=.+/.test(arg)) throw new Error(`Unknown argument: ${arg}.`);
  const inputArg = args.find(arg => arg.startsWith("--input="))?.slice(8);
  if (!inputArg) throw new Error("--input=path/to/application-owned.json is required.");
  const input = path.resolve(inputArg), raw = readFileSync(input, "utf8"), data = JSON.parse(raw);
  validateGraphData(data);
  const outArg = args.find(arg => arg.startsWith("--out="))?.slice(6);
  const out = outArg ? path.resolve(outArg) : path.join(newOutputDirectory("repository-graphs", data.owner), "repository-split-graph.html");
  const template = readFileSync(templatePath, "utf8");
  const relative = target => path.relative(path.dirname(out), target).split(path.sep).join("/");
  const command = `node ${shellQuote(relative(fileURLToPath(import.meta.url)))} --input=${shellQuote(relative(input))} --out=${shellQuote(path.basename(out))}`;
  const provenance = `Generated artifact. Shared source: foss-earth/docs/proposals/repository-graph-template.html + foss-earth/scripts/build-repository-graph.mjs. Data owner: ${data.owner}. Data SHA256: ${hash(raw)}. Template SHA256: ${hash(template)}. Rebuild from this directory: ${command}. Edit the JSON or shared template, not this generated file.`;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, renderRepositoryGraph(rebaseGraphLinks(data, path.dirname(input), path.dirname(out)), template, provenance));
  process.stdout.write(JSON.stringify({ owner: data.owner, out: outArg ?? relative(out), nodes: data.nodes.length, edges: data.edges.length }) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
