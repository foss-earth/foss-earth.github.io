import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_FROM_ID, type BuiltFrom, type BuiltFromPart } from "../src/app/builtFrom";
import { builtFrom, bundledPackages, commitVersion, describeBuild, webRepository, type BuildReader, type PackageManifest } from "./builtFrom";

const HEAD = "a2c6c2894e12a2c6c2894e12a2c6c2894e12a2c6";
const EARTH = "35ad0e3f1c2a35ad0e3f1c2a35ad0e3f1c2a35ad";
const PADS = "fd1a3e657401c4078c5bc293fa42a1da5ad9ac00";

interface Checkout {
  head: string;
  remote?: string;
  pushed?: boolean;
  changed?: string;
  tracked?: readonly string[];
  log?: string;
}

/** A stand-in for a workspace: package.json files by folder, lockfiles, links, and git checkouts. */
function workspace(options: {
  manifests: Record<string, PackageManifest>;
  locks?: Record<string, { packages: Record<string, { resolved?: string; link?: boolean }> }>;
  links?: Record<string, string>;
  checkouts?: Record<string, Checkout>;
  files?: readonly string[];
  modified?: Record<string, number>;
}): BuildReader & { calls: string[][] } {
  const calls: string[][] = [];
  const real = (dir: string): string => options.links?.[dir] ?? dir;
  return {
    calls,
    manifest: dir => options.manifests[dir] ?? null,
    lock: dir => options.locks?.[dir] ?? null,
    real,
    exists: file => (path.basename(file) === "package.json"
      ? path.dirname(file) in options.manifests || path.dirname(file) in (options.links ?? {})
      : options.files?.some(known => known === file || known.startsWith(`${file}/`)) ?? false),
    modified: file => options.modified?.[file] ?? null,
    git(dir, args) {
      calls.push([dir, ...args]);
      const checkout = Object.entries(options.checkouts ?? {}).find(([top]) => dir === top || dir.startsWith(`${top}/`));
      if (!checkout) return null;
      const [top, info] = checkout;
      const [command, ...rest] = args;
      if (command === "rev-parse") return rest[0] === "--show-toplevel" ? top : info.head;
      if (command === "remote") return info.remote ?? null;
      if (command === "status") return info.changed ?? "";
      if (command === "branch") return info.pushed === false ? "" : "  origin/main";
      if (command === "log") return info.log ?? `${info.head}\x1f2026-10-07T11:00:39-05:00\x1f2026-10-07\x1fThe latest change`;
      if (command === "ls-files") return info.tracked?.includes(rest.at(-1)!) ? rest.at(-1)! : null;
      return null;
    },
  };
}

/** The tree as lines, a part per line and its parts indented under it, for comparing at a glance. */
function outline(part: BuiltFromPart, depth = 0): string[] {
  const words = [part.name, part.version, part.from, part.commit?.slice(0, 7), part.dirty && "dirty", part.unpushed && "unpushed", part.listedAbove && "listed above"];
  return [`${"  ".repeat(depth)}${words.filter(Boolean).join(" ")}`, ...(part.parts ?? []).flatMap(child => outline(child, depth + 1))];
}

/**
 * The flight simulator's shape: the app links FOSS Earth and gamepad-tools
 * from their checkouts, FOSS Earth links gamepad-tools too, the engine comes
 * from a packed tarball, and the rest from npm. FOSS Earth's own copy of
 * React is deduplicated to the app's.
 */
function flightWorkspace(pushed = true) {
  const app = "/w/0sfs";
  const modules = `${app}/node_modules`;
  return workspace({
    manifests: {
      [app]: { name: "osfs", version: "0.0.0", private: true, dependencies: { "foss-earth": "file:../foss-earth", "@felipegalind0/gamepad-tools": "file:../pads", "@felipegalind0/jsbsim": "file:deps/jsbsim.tgz", react: "^19", peerjs: "1.5.5", unused: "1" } },
      "/w/foss-earth": { name: "foss-earth", version: "0.0.0", private: true, dependencies: { "@felipegalind0/gamepad-tools": "file:../pads", react: "^19" } },
      "/w/pads": { name: "@felipegalind0/gamepad-tools", version: "0.1.0", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }, files: ["dist", "src"], peerDependencies: { "@babylonjs/core": "^8" } },
      [`${modules}/@felipegalind0/jsbsim`]: { name: "@felipegalind0/jsbsim", version: "1.2.4-fork.16", repository: { url: "git+https://github.com/Felipegalind0/jsbsim.git" } },
      [`${modules}/react`]: { name: "react", version: "19.2.6", repository: { url: "https://github.com/facebook/react.git" }, dependencies: { scheduler: "^0.27" } },
      [`${modules}/scheduler`]: { name: "scheduler", version: "0.27.0", repository: "facebook/react" },
      [`${modules}/peerjs`]: { name: "peerjs", version: "1.5.5", repository: "github:peers/peerjs", gitHead: "0b5e4b2a1a7b1d2c0b5e4b2a1a7b1d2c0b5e4b2a" },
      [`${modules}/unused`]: { name: "unused", version: "1.0.0" },
      [`${modules}/@babylonjs/core`]: { name: "@babylonjs/core", version: "8.56.2" },
      "/w/foss-earth/node_modules/react": { name: "react", version: "19.2.6" },
    },
    links: { [`${modules}/foss-earth`]: "/w/foss-earth", [`${modules}/@felipegalind0/gamepad-tools`]: "/w/pads", "/w/foss-earth/node_modules/@felipegalind0/gamepad-tools": "/w/pads" },
    locks: {
      [app]: { packages: {
        "node_modules/@felipegalind0/jsbsim": { resolved: "file:deps/jsbsim.tgz" },
        "node_modules/react": { resolved: "https://registry.npmjs.org/react/-/react-19.2.6.tgz" },
        "node_modules/scheduler": { resolved: "https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz" },
        "node_modules/peerjs": { resolved: "https://registry.npmjs.org/peerjs/-/peerjs-1.5.5.tgz" },
        "node_modules/@babylonjs/core": { resolved: "https://registry.npmjs.org/@babylonjs/core/-/core-8.56.2.tgz" },
      } },
    },
    checkouts: {
      [app]: { head: HEAD, remote: "https://someone:ghp_secret@github.com/0SFS/0SFS.github.io.git", pushed },
      "/w/foss-earth": { head: EARTH, remote: "git@github.com:foss-earth/foss-earth.github.io.git", log: [
        `${EARTH}\x1f2026-10-07T11:00:39-05:00\x1f2026-10-07\x1fThe latest change`,
        `${"1".repeat(40)}\x1f2026-10-07T09:12:00-05:00\x1f2026-10-07\x1fThe one before it`,
        `${"2".repeat(40)}\x1f2026-10-07T00:13:01-05:00\x1f2026-10-07\x1fThe day's first`,
        `${"3".repeat(40)}\x1f2026-10-06T17:58:57-05:00\x1f2026-10-06\x1fThe day before's`,
      ].join("\n") },
      "/w/pads": { head: PADS, remote: "https://github.com/Felipegalind0/gamepad-tools.git", changed: " M src/browser/source.ts", tracked: [] },
    },
    files: ["/w/pads/dist/index.js", "/w/pads/src/index.ts"],
    modified: { "/w/pads/dist/index.js": Date.parse("2026-10-07T18:10:34.467Z") },
  });
}

const BUNDLED = ["/w/0sfs", "/w/foss-earth", "/w/pads", "/w/0sfs/node_modules/@felipegalind0/jsbsim", "/w/0sfs/node_modules/react",
  "/w/0sfs/node_modules/scheduler", "/w/0sfs/node_modules/peerjs", "/w/0sfs/node_modules/@babylonjs/core"];

describe("describeBuild", () => {
  it("lists what the bundle holds as a tree from the app down, each copy in full once", () => {
    const reader = flightWorkspace();
    const tree = describeBuild({ root: "/w/0sfs", built: "2026-10-07T18:20:00.000Z", bundled: new Set(BUNDLED), appSource: `${HEAD.slice(0, 12)}-dirty`, reader });
    expect(tree.built).toBe("2026-10-07T18:20:00.000Z");
    expect(tree.dev).toBeUndefined();
    expect(outline(tree.app)).toEqual([
      // The app's and each checkout's version is its commit's: the day, then the commit's count that day.
      "osfs 26.10.7.1 app a2c6c28 dirty",
      // Checkouts first, then packages, each by name.
      "  @felipegalind0/gamepad-tools 26.10.7.1 checkout fd1a3e6 dirty",
      "    @babylonjs/core 8.56.2 registry",
      "  foss-earth 26.10.7.3 checkout 35ad0e3",
      "    @felipegalind0/gamepad-tools 26.10.7.1 checkout listed above",
      // FOSS Earth's own React is not in the bundle: the app's is.
      "    react 19.2.6 registry listed above",
      "  @felipegalind0/jsbsim 1.2.4-fork.16 file",
      "  peerjs 1.5.5 registry 0b5e4b2",
      "  react 19.2.6 registry",
      "    scheduler 0.27.0 registry",
    ]);
    const [pads, earth, engine, peerjs] = tree.app.parts!;
    // Never the name and password a remote's address may carry.
    expect(tree.app.repository).toBe("https://github.com/0SFS/0SFS.github.io");
    expect(JSON.stringify(tree)).not.toContain("ghp_secret");
    expect(earth.repository).toBe("https://github.com/foss-earth/foss-earth.github.io");
    expect(engine.repository).toBe("https://github.com/Felipegalind0/jsbsim");
    expect(peerjs.repository).toBe("https://github.com/peers/peerjs");
    // Built apart from the app, from a dist/ that git does not track.
    expect(pads.built).toBe("2026-10-07T18:10:34.467Z");
    expect(earth.built).toBeUndefined();
    expect(earth.history!.map(commit => commit.subject)).toEqual(["The latest change", "The one before it", "The day's first", "The day before's"]);
    expect(earth.history![0]).toEqual({ hash: EARTH, at: "2026-10-07T11:00:39-05:00", subject: "The latest change" });
    // A package not in the bundle is not listed, though the app declares it.
    expect(JSON.stringify(tree)).not.toContain("unused");
  });

  it("says when a commit was on no remote branch, as the build's checkout last heard", () => {
    const tree = describeBuild({ root: "/w/0sfs", built: "", bundled: new Set(BUNDLED), reader: flightWorkspace(false) });
    expect(tree.app.unpushed).toBe(true);
    expect(tree.app.parts![1].unpushed).toBeUndefined();
  });

  it("checks a checkout for changes in what it publishes, and the app wherever its config says", () => {
    const reader = flightWorkspace();
    describeBuild({ root: "/w/0sfs", built: "", bundled: new Set(BUNDLED), reader });
    expect(reader.calls).toContainEqual(["/w/pads", "status", "--porcelain", "--", "dist", "src"]);
    // No __SOURCE_VERSION__: the app's whole checkout.
    expect(reader.calls).toContainEqual(["/w/0sfs", "status", "--porcelain", "--", "."]);
  });

  it("without a bundle lists what is declared, following only checkouts, and says so", () => {
    const tree = describeBuild({ root: "/w/0sfs", built: "", bundled: null, dedupe: ["react"], reader: flightWorkspace() });
    expect(tree.dev).toBe(true);
    expect(outline(tree.app)).toEqual([
      "osfs 26.10.7.1 app a2c6c28",
      "  @felipegalind0/gamepad-tools 26.10.7.1 checkout fd1a3e6 dirty",
      // A peer is the app's copy.
      "    @babylonjs/core 8.56.2 registry",
      "  foss-earth 26.10.7.3 checkout 35ad0e3",
      "    @felipegalind0/gamepad-tools 26.10.7.1 checkout listed above",
      // Deduplicated by the app's config: its copy.
      "    react 19.2.6 registry listed above",
      "  @felipegalind0/jsbsim 1.2.4-fork.16 file",
      "  peerjs 1.5.5 registry 0b5e4b2",
      "  react 19.2.6 registry",
      "  unused 1.0.0 registry",
    ]);
  });

  it("takes what a package says of itself that cannot be read, such as a packed build's commit", () => {
    const tree = describeBuild({
      root: "/w/0sfs", built: "", bundled: new Set(BUNDLED), reader: flightWorkspace(),
      describe: ({ name }) => (name === "@felipegalind0/jsbsim" ? { commit: "97fe6ddf1c8a7d9e10dad46a88e60e79e69fae28", dirty: false } : undefined),
    });
    const engine = tree.app.parts!.find(part => part.name === "@felipegalind0/jsbsim")!;
    expect(engine).toMatchObject({ commit: "97fe6ddf1c8a7d9e10dad46a88e60e79e69fae28", dirty: false, from: "file" });
  });

  it("keeps a commit's first line short", () => {
    const reader = flightWorkspace();
    const long = "Size the profile and controller dropdowns to their own text ".repeat(6);
    reader.git = (dir, args) => (args[0] === "log" ? `${HEAD}\x1f2026-10-07T11:00:39-05:00\x1f2026-10-07\x1f${long}` : flightWorkspace().git(dir, args));
    const tree = describeBuild({ root: "/w/0sfs", built: "", bundled: new Set(["/w/0sfs"]), reader });
    const subject = tree.app.history![0].subject;
    expect(subject.length).toBeLessThanOrEqual(160);
    expect(subject.endsWith("…")).toBe(true);
  });
});

describe("describeBuild with two installs of one package", () => {
  /**
   * FOSS Earth's own build held two copies of Babylon on 2026-10-07: its own,
   * and the one gamepad-tools installs for itself, which its viewer's imports
   * found first, since the app's config deduplicated nothing.
   */
  it("says which copy is another, so two lines of one name do not read as one package listed twice", () => {
    const reader = workspace({
      manifests: {
        "/w/earth": { name: "foss-earth", version: "0.0.0", private: true, dependencies: { "@felipegalind0/gamepad-tools": "file:../pads", "@babylonjs/core": "^8" } },
        "/w/pads": { name: "@felipegalind0/gamepad-tools", version: "0.1.0", peerDependencies: { "@babylonjs/core": "^8" } },
        "/w/earth/node_modules/@babylonjs/core": { name: "@babylonjs/core", version: "8.56.2" },
        "/w/pads/node_modules/@babylonjs/core": { name: "@babylonjs/core", version: "8.56.2" },
      },
      links: { "/w/earth/node_modules/@felipegalind0/gamepad-tools": "/w/pads" },
      checkouts: { "/w/earth": { head: EARTH }, "/w/pads": { head: PADS } },
    });
    const tree = describeBuild({
      root: "/w/earth", built: "", reader,
      bundled: new Set(["/w/earth", "/w/pads", "/w/earth/node_modules/@babylonjs/core", "/w/pads/node_modules/@babylonjs/core"]),
    });
    expect(outline(tree.app)).toEqual([
      "foss-earth 26.10.7.1 app 35ad0e3",
      "  @felipegalind0/gamepad-tools 26.10.7.1 checkout fd1a3e6",
      "    @babylonjs/core 8.56.2 registry listed above",
      "  @babylonjs/core 8.56.2 registry",
      "  @babylonjs/core 8.56.2 registry",
    ]);
    expect(tree.app.parts!.map(part => part.anotherCopy ?? false)).toEqual([false, false, true]);
  });
});

describe("commitVersion", () => {
  /**
   * FOSS Earth, 0sfs and gamepad-tools name their versions alike: the last two
   * digits of the year, the month, the day, and the commit's count that day.
   */
  it("is the commit's day and its count among that day's commits", () => {
    expect(commitVersion(["2026-10-07", "2026-10-07", "2026-10-07", "2026-10-06", "2026-10-06"])).toBe("26.10.7.3");
    expect(commitVersion(["2026-10-07"])).toBe("26.10.7.1");
    // Two digits of the year, and no zeros before a month or a day.
    expect(commitVersion(["2105-01-09", "2105-01-09"])).toBe("05.1.9.2");
  });

  it("is nothing without a date", () => {
    expect(commitVersion([])).toBeUndefined();
    expect(commitVersion(["yesterday"])).toBeUndefined();
  });
});

describe("bundledPackages", () => {
  it("finds each module's and asset's package, skipping virtual modules and folders without a name", () => {
    const reader = workspace({
      manifests: {
        "/w/0sfs": { name: "osfs" },
        "/w/0sfs/node_modules/react": { name: "react" },
        // A marker a package ships to say its files are modules: not a package of its own.
        "/w/0sfs/node_modules/react/esm": {},
        "/w/0sfs/node_modules/@felipegalind0/jsbsim": { name: "@felipegalind0/jsbsim" },
      },
      links: { "/w/0sfs/node_modules/foss-earth": "/w/foss-earth" },
    });
    const bundle = {
      "assets/index-AbCd1234.js": { type: "chunk", moduleIds: ["\0vite/preload-helper", "/w/0sfs/src/main.tsx", "/w/0sfs/node_modules/react/esm/index.js?commonjs-proxy", "virtual:pwa"] },
      "assets/jsbsim_wasm-AbCd1234.wasm": { type: "asset", originalFileNames: ["node_modules/@felipegalind0/jsbsim/dist/wasm/jsbsim_wasm.wasm"] },
    };
    expect([...bundledPackages(bundle, "/w/0sfs", reader)].sort()).toEqual(["/w/0sfs", "/w/0sfs/node_modules/@felipegalind0/jsbsim", "/w/0sfs/node_modules/react"]);
  });
});

describe("webRepository", () => {
  it("gives the web page of a repository however it is written, never with a credential", () => {
    expect(webRepository("git+https://github.com/BabylonJS/Babylon.js.git")).toBe("https://github.com/BabylonJS/Babylon.js");
    expect(webRepository({ url: "git://github.com/soldair/node-qrcode.git" })).toBe("https://github.com/soldair/node-qrcode");
    expect(webRepository("git@github.com:foss-earth/foss-earth.github.io.git")).toBe("https://github.com/foss-earth/foss-earth.github.io");
    expect(webRepository("ssh://git@github.com/Felipegalind0/jsbsim.git")).toBe("https://github.com/Felipegalind0/jsbsim");
    expect(webRepository("github:peers/peerjs")).toBe("https://github.com/peers/peerjs");
    expect(webRepository("gitlab:group/project")).toBe("https://gitlab.com/group/project");
    expect(webRepository("facebook/react")).toBe("https://github.com/facebook/react");
    expect(webRepository("https://user:token@github.com/0SFS/0SFS.github.io.git")).toBe("https://github.com/0SFS/0SFS.github.io");
    expect(webRepository("/Users/someone/repo")).toBeUndefined();
    expect(webRepository("file:../foss-earth")).toBeUndefined();
    expect(webRepository("")).toBeUndefined();
    expect(webRepository(undefined)).toBeUndefined();
  });
});

describe("builtFrom", () => {
  type Hook = (...args: unknown[]) => unknown;
  /** The plugin as Vite runs it for a build of FOSS Earth itself. */
  function runPlugin(bundle: Record<string, unknown> | undefined) {
    const plugin = builtFrom({ history: 2 });
    const root = path.resolve(import.meta.dirname, "..");
    (plugin.config as Hook)({ define: { __BUILD_TIME__: JSON.stringify("2026-10-04T17:33:49.408Z"), __SOURCE_VERSION__: JSON.stringify("e88e7ea93f53") } }, { command: bundle ? "build" : "serve" });
    (plugin.configResolved as Hook)({ root, resolve: { dedupe: [] } });
    return (plugin.transformIndexHtml as Hook)("<html></html>", { path: "/index.html", filename: path.join(root, "index.html"), bundle }) as { tag: string; attrs: Record<string, string>; children: string }[];
  }

  it("writes the description into the page as JSON that no part of it can end early", () => {
    const [tag] = runPlugin({});
    expect(tag).toMatchObject({ tag: "script", attrs: { type: "application/json", id: BUILT_FROM_ID } });
    expect(tag.children).not.toContain("<");
    const tree = JSON.parse(tag.children) as BuiltFrom;
    expect(tree.built).toBe("2026-10-04T17:33:49.408Z");
    expect(tree.app.name).toBe("foss-earth");
    expect(tree.app.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(tree.app.version).toMatch(/^\d{2}\.\d{1,2}\.\d{1,2}\.\d+$/);
    expect(tree.app.dirty).toBeUndefined();
  });

  it("serves a dev server's pages a declared list, with no build time", () => {
    const [tag] = runPlugin(undefined);
    const tree = JSON.parse(tag.children) as BuiltFrom;
    expect(tree).toMatchObject({ built: "", dev: true, app: { name: "foss-earth" } });
    expect(tree.app.parts?.some(part => part.name === "@felipegalind0/gamepad-tools")).toBe(true);
  });
});
