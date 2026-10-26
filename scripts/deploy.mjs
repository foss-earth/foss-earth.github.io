// Publishes the site to the gh-pages branch, which GitHub Pages serves at
// https://foss-earth.github.io/. It builds the Earth app only when the app has
// something new since the one gh-pages has (About's rebuildReason); otherwise
// it keeps gh-pages' app and publishes the landing page beside it. gh-pages
// also holds pages that aren't built here, /eac-prototype/ and /examples/;
// those are kept as they are. Everything else on the branch is replaced. The
// new tree is put together from git objects in an index of its own, so nothing
// is checked out, and a deploy that would change nothing pushes nothing.
//
// Usage: node scripts/deploy.mjs [--force] [--dry-run]
//   --force builds the app even when gh-pages has it; --dry-run records,
//   commits and pushes nothing.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandPalette, LANDING } from './build.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const BRANCH = 'refs/heads/gh-pages'
/** What gh-pages holds that this site does not build. */
const KEPT = ['.gitignore', 'eac-prototype', 'examples']

/** Every file under `base`, `[path on the site, file]`, refusing what a site cannot publish. */
function filesOf(base, under = '') {
  return readdirSync(path.join(base, under), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.DS_Store') return []
    const name = path.posix.join(under, entry.name)
    if (/[\r\n\t\0]/.test(name)) throw new Error(`Refusing an invalid filename: ${name}`)
    if (entry.isDirectory()) return filesOf(base, name)
    if (!entry.isFile()) throw new Error(`Not a regular file: ${name}`)
    return [[name, path.join(base, name)]]
  })
}

const run = (root, args, quiet = false) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'],
}).trim()

/** gh-pages' app page, fetched from `remote`; null when nothing is published there. */
export function publishedAppPage({ root = ROOT, remote = 'origin' } = {}) {
  run(root, ['fetch', '--no-tags', '--', remote, BRANCH])
  try { return run(root, ['show', 'FETCH_HEAD:app/index.html'], true) } catch { return null }
}

/**
 * Puts the site together on gh-pages and pushes it when it changed: a new
 * build, `dist`, in place of all but the kept pages, or else the landing page's
 * files alone over what gh-pages has, and `.nojekyll` either way.
 */
export function publishSite({ root = ROOT, remote = 'origin', dist, message, dryRun = false, log = console.log }) {
  const stateRoot = path.join(root, 'build')
  mkdirSync(stateRoot, { recursive: true })
  const state = mkdtempSync(path.join(stateRoot, 'deploy-'))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(state, 'index') }
  const git = (args, input) => execFileSync('git', args, {
    cwd: root, env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'inherit'],
  }).trim()
  /** Stores files in git and lists them in the deploy's index at their paths on the site. */
  const add = files => {
    const hashes = git(['hash-object', '-w', '--stdin-paths'], files.map(([, file]) => file).join('\n')).split('\n')
    git(['update-index', '--add', '--index-info'], files.map(([name], i) => `100644 ${hashes[i]}\t${name}`).join('\n') + '\n')
  }
  try {
    git(['fetch', '--no-tags', '--', remote, BRANCH])
    const parent = git(['rev-parse', 'FETCH_HEAD'])
    if (dist) {
      if (!existsSync(path.join(dist, 'app', 'index.html'))) throw new Error('No site in dist/: the build made none.')
      git(['read-tree', '--empty'])
      const keep = git(['ls-tree', '-r', '-z', parent, '--', ...KEPT])
      if (keep) git(['update-index', '-z', '--index-info'], keep)
      add(filesOf(dist))
    } else {
      git(['read-tree', parent])
      add(LANDING.map(name => [name, path.join(root, name)]))
    }
    // No Jekyll: Pages serves the files as they are, without a build over thousands of them first.
    const empty = git(['hash-object', '-w', '--stdin'], '')
    git(['update-index', '--add', '--cacheinfo', `100644,${empty},.nojekyll`])
    const tree = git(['write-tree'])
    if (tree === git(['rev-parse', `${parent}^{tree}`])) {
      log('gh-pages already has this site.')
      return { changed: false, commit: parent, tree }
    }
    const commit = git(['commit-tree', tree, '-p', parent, '-m', message])
    const changed = git(['diff-tree', '--no-commit-id', '--name-only', '-r', parent, tree]).split('\n').filter(Boolean).length
    if (dryRun) log(`Prepared ${commit}: ${message}, ${changed} files changed. Nothing was pushed.`)
    else {
      git(['push', '--', remote, `${commit}:${BRANCH}`])
      log(`${message}: pushed to gh-pages, ${changed} files changed.`)
    }
    return { changed: true, commit, tree }
  } finally {
    rmSync(state, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--force' && arg !== '--dry-run')) throw new Error('Usage: npm run deploy -- [--force] [--dry-run]')
  const dryRun = args.includes('--dry-run')
  const appRoot = path.resolve(ROOT, '../app')
  const { rebuildReason, recordBuildInputs } = await import('../../app/vite/index.ts')
  const page = publishedAppPage()
  // What the app is built from, in its deployed-from.json, so new code in a checkout
  // it is built from is a new version of the app (FOSS Earth About's record).
  const inputs = recordBuildInputs({ root: appRoot, dryRun })
  // An app gh-pages has in a brand palette is replaced even when its source is unchanged, and build.mjs refuses one.
  const branded = page === null ? null : brandPalette(page)
  const why = args.includes('--force') ? 'asked to with --force'
    : rebuildReason({ root: appRoot, page, inputs }) ?? (branded === null ? undefined : `gh-pages' app names the ${JSON.stringify(branded)} palette`)
  if (why) {
    console.log(`Building the Earth app: ${why}.`)
    execFileSync('npm', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' })
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
    publishSite({ dist: path.join(ROOT, 'dist'), message: `Deploy the Earth app at ${run(appRoot, ['rev-parse', '--short', 'HEAD'])}`, dryRun })
  } else {
    console.log('gh-pages has the Earth app as it is here: keeping it, and publishing the landing page beside it.')
    publishSite({ message: `Deploy the landing page at ${run(ROOT, ['rev-parse', '--short', 'HEAD'])}, keeping the Earth app`, dryRun })
  }
}
