import { buildMinute, getAppIdentity, type AppIdentity } from "../app/appIdentity";
import { partLinks, readBuiltFrom, shortCommit, type BuiltFrom, type BuiltFromCommit, type BuiltFromPart } from "../app/builtFrom";
import { describePublishedVersion, type PublishedVersionWatch } from "../app/publishedVersion";
import { createExternalLinkIcon } from "./externalLinkIcon";

/**
 * The About tab: which version of the app runs, and everything it is built
 * from as a tree, the app at the top and what each part brings in under it.
 * Each part's line gives its name and version, the app's and a checkout's
 * being its commit's, "26.10.7.3", and whether it had changes not committed
 * or not pushed. Opened, it lists its commits, the one it was built from
 * first and every one alike, and links to that commit, the history up to it
 * and its source. What it shows comes from the page itself
 * (src/app/builtFrom.ts), so a browser's own copy of an older page shows what
 * that page was built from.
 */

export interface AboutPanelOptions {
  /** What the page says it was built from, read from the page by default; null for a page built without the builtFrom plugin. */
  builtFrom?: BuiltFrom | null;
  /** The build as the app's config names it, for a page without the description, and its bundle; the running app's by default. */
  identity?: AppIdentity;
  /** The app's name as people know it; the page's title by default. */
  title?: string;
  /** Whether this page is the version the site publishes, where the app asks (publishedVersion.ts). */
  publishedVersion?: Pick<PublishedVersionWatch, "state" | "subscribe" | "now">;
  /**
   * The site's GitHub repository, "owner/name", whose gh-pages branch is its
   * latest deploy. Asked of GitHub the first time About is shown: it is the
   * site's, not this page's, which may be older.
   */
  site?: string;
  /** How GitHub is asked; `fetch` by default. */
  fetch?: typeof fetch;
}

export interface AboutPanelHandle {
  element: HTMLElement;
  dispose(): void;
}

/** It was "Deploy", which an iPhone running a page four releases old showed with the newest deploy. */
const SITE_DEPLOY_LABEL = "Site's latest deploy";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function externalLink(label: string, href: string): HTMLAnchorElement {
  const link = el("a", "foss-earth-about__link");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(label, createExternalLinkIcon());
  return link;
}

/** "a2c6c28", as `git log --oneline` names it, with the full hash on hover. */
function commitLabel(hash: string): HTMLElement {
  const code = el("code", "foss-earth-about__commit", shortCommit(hash));
  code.title = hash;
  return code;
}

function flag(text: string, title: string): HTMLElement {
  const element = el("span", "foss-earth-about__flag", text);
  element.title = title;
  return element;
}

const FROM_LABELS: Record<BuiltFromPart["from"], string> = {
  app: "the app itself",
  checkout: "linked from its checkout",
  file: "installed from a file",
  registry: "from npm",
};

/** The one line a part shows closed: its name, its version and its flags. Its commit is the first of its commits, inside. */
function partLine(part: BuiltFromPart): HTMLElement[] {
  const items: HTMLElement[] = [el("span", "foss-earth-about__name", part.name)];
  if (part.version) items.push(el("span", "foss-earth-about__version", part.version));
  if (part.dirty) items.push(flag("changes not committed", "Built with changes that were not committed: no commit holds exactly this code."));
  if (part.unpushed) items.push(flag("not pushed when built", "No remote branch held this commit when the app was built, so its links may not open until it is pushed."));
  if (part.anotherCopy) items.push(flag("another copy in this build", "The build holds more than one copy of this package, installed in different places, so the app loads its code twice. Listing it in the app's Vite config resolve.dedupe holds one."));
  return items;
}

/** A commit as a part's list shows it; one a package only names has no time or message. */
type ListedCommit = Pick<BuiltFromCommit, "hash"> & Partial<BuiltFromCommit>;

/**
 * A part's commits, the one it was built from first, then those before it:
 * what a checkout's history gives, or the one commit a package names. Every
 * row is alike: the commit, linked where its source is known, then when it was
 * committed and its message's first line.
 */
function commitsOf(part: BuiltFromPart): ListedCommit[] {
  if (!part.commit) return [];
  const history = part.history ?? [];
  return history.some(commit => commit.hash === part.commit) ? history : [{ hash: part.commit }, ...history];
}

function commitList(commits: readonly ListedCommit[], repository: string | undefined): HTMLElement {
  const list = el("ol", "foss-earth-about__history");
  for (const commit of commits) {
    const item = el("li");
    item.append(repository ? externalLink(shortCommit(commit.hash), `${repository}/commit/${commit.hash}`) : commitLabel(commit.hash));
    if (commit.at) item.append(el("span", "foss-earth-about__when", buildMinute(commit.at)));
    if (commit.subject) item.append(el("span", "foss-earth-about__subject", commit.subject));
    list.append(item);
  }
  return list;
}

/**
 * Starts telling `listener` each time `element` comes on screen, as its tab is
 * shown; once at once where the browser cannot tell. Returns a stop.
 */
function whenShown(element: HTMLElement, listener: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    listener();
    return () => {};
  }
  let shown = false;
  const observer = new IntersectionObserver(entries => {
    const visible = entries.some(entry => entry.isIntersecting);
    if (visible && !shown) listener();
    shown = visible;
  });
  observer.observe(element);
  return () => observer.disconnect();
}

export function createAboutPanel(options: AboutPanelOptions = {}): AboutPanelHandle {
  const builtFrom = options.builtFrom === undefined ? readBuiltFrom(document) : options.builtFrom;
  const identity = options.identity ?? getAppIdentity();
  const element = el("div", "foss-earth-about");
  element.setAttribute("aria-label", "About");
  const stops: (() => void)[] = [];

  // ─── The app as it runs ──────────────────────────────────────────
  const app = el("section", "foss-earth-about__app");
  app.append(el("h2", "foss-earth-about__title", options.title || document.title || builtFrom?.app.name || "This app"));
  const built = builtFrom ? builtFrom.built : identity.build;
  const version = builtFrom?.app.version;
  app.append(el("p", "foss-earth-about__line", builtFrom?.dev
    ? `${version ? `Version ${version}, served` : "Served"} by a development server, started ${buildMinute(identity.build)}: not a build.`
    : `${version ? `Version ${version}, built` : "Built"} ${buildMinute(built)}.`));
  if (!builtFrom) {
    // A build without the description names its commits only.
    app.append(el("p", "foss-earth-about__line", `Source: ${identity.source}`));
    if (identity.fossEarth) app.append(el("p", "foss-earth-about__line", `FOSS Earth: ${identity.fossEarth}`));
  }
  app.append(el("p", "foss-earth-about__line", `Bundle: ${identity.bundle}`));
  if (options.publishedVersion) {
    const watch = options.publishedVersion;
    const line = el("p", "foss-earth-about__line");
    line.setAttribute("role", "status");
    const render = (): void => { line.textContent = describePublishedVersion(watch.state(), watch.now()); };
    render();
    stops.push(watch.subscribe(render));
    app.append(line);
  }
  if (options.site) {
    const site = options.site;
    const line = el("p", "foss-earth-about__line", `${SITE_DEPLOY_LABEL}: asked of GitHub when About is shown`);
    let asked = false;
    stops.push(whenShown(element, () => {
      if (asked) return;
      asked = true;
      line.textContent = `${SITE_DEPLOY_LABEL}: asking GitHub`;
      void (options.fetch ?? fetch)(`https://api.github.com/repos/${site}/git/ref/heads/gh-pages`, { cache: "no-store" })
        .then(response => (response.ok ? response.json() as Promise<{ object?: { sha?: unknown } }> : null))
        .then(payload => (typeof payload?.object?.sha === "string" ? payload.object.sha : null))
        .catch(() => null)
        .then(sha => {
          // The site's, asked of GitHub now: a page a browser kept from before shows this deploy too, so it says nothing of what runs.
          line.textContent = `${SITE_DEPLOY_LABEL}: ${sha ? sha.slice(0, 12) : "unavailable"}`;
        });
    }));
    app.append(line);
  }
  element.append(app);

  // ─── What it is built from ───────────────────────────────────────
  if (builtFrom) {
    element.append(el("h3", "foss-earth-about__heading", "Built from"));
    element.append(el("p", "foss-earth-about__note", builtFrom.dev
      ? "The packages the app and its checkouts declare: a development server has no bundle to list."
      : "Everything this build holds, under the part that brought it in. Open a part for its commits and links to its source."));
    /** Each part listed in full, by name and version, for "same copy as above" to open. */
    const full = new Map<string, HTMLDetailsElement>();
    const keyOf = (part: Pick<BuiltFromPart, "name" | "version">): string => `${part.name}@${part.version ?? ""}`;

    const renderPart = (part: BuiltFromPart, depth: number): HTMLElement => {
      const item = el("li", "foss-earth-about__part");
      if (part.listedAbove) {
        const row = el("div", "foss-earth-about__row");
        row.append(...partLine(part));
        const above = el("button", "foss-earth-about__above", "same copy as above");
        above.type = "button";
        above.title = "Two parts bring this package in, and the build holds it once. Shows where it is listed in full.";
        above.addEventListener("click", () => {
          const target = full.get(keyOf(part));
          if (!target) return;
          for (let open: HTMLElement | null = target; open && open !== element; open = open.parentElement) {
            if (open instanceof HTMLDetailsElement) open.open = true;
          }
          target.scrollIntoView?.({ block: "nearest" });
          target.querySelector<HTMLElement>("summary")?.focus();
        });
        row.append(above);
        item.append(row);
        return item;
      }
      const details = el("details", "foss-earth-about__details");
      // The app opens on its parts; the parts open on request.
      details.open = depth === 0;
      full.set(keyOf(part), details);
      const summary = el("summary", "foss-earth-about__row");
      summary.append(...partLine(part));
      details.append(summary);
      const body = el("div", "foss-earth-about__body");
      const facts: string[] = [];
      if (part.built) facts.push(`Its own build: ${buildMinute(part.built)}.`);
      if (part.from !== "app") facts.push(`${FROM_LABELS[part.from][0].toUpperCase()}${FROM_LABELS[part.from].slice(1)}.`);
      if (facts.length) body.append(el("p", "foss-earth-about__line", facts.join(" ")));
      const links = partLinks(part);
      if (links.length) {
        const row = el("p", "foss-earth-about__links");
        row.append(...links.map(link => externalLink(link.label, link.href)));
        body.append(row);
      }
      const commits = commitsOf(part);
      if (commits.length) {
        body.append(el("p", "foss-earth-about__label", commits.length > 1 ? "Commits, the one it was built from first" : "The commit it was built from"));
        body.append(commitList(commits, part.repository));
      }
      if (part.parts?.length) {
        const list = el("ul", "foss-earth-about__parts");
        list.append(...part.parts.map(child => renderPart(child, depth + 1)));
        body.append(list);
      }
      details.append(body);
      item.append(details);
      return item;
    };
    const tree = el("ul", "foss-earth-about__tree");
    tree.append(renderPart(builtFrom.app, 0));
    element.append(tree);
  }

  return {
    element,
    dispose() {
      for (const stop of stops.splice(0)) stop();
    },
  };
}
