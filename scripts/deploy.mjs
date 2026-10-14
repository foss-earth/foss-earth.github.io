// Builds the app and this site, and publishes dist/ to the gh-pages branch,
// which GitHub Pages serves at https://foss-earth.github.io/. gh-pages also
// holds pages that aren't built here, /eac-prototype/ and /examples/; those are
// kept as they are. Everything else on the branch is replaced by dist/.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { recordBuildInputs } from '../../app/vite/index.ts'

const kept = new Set(['.git', '.gitignore', 'eac-prototype', 'examples'])
const root = fileURLToPath(new URL('../', import.meta.url))
const dist = `${root}dist`
const pages = `${root}build/gh-pages`
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

// What the app is built from, in its deployed-from.json, so new code in a checkout
// it is built from is a new version of the app (FOSS Earth About's record).
recordBuildInputs({ root: `${root}../app` })
execFileSync('npm', ['run', 'build'], { cwd: `${root}../app`, stdio: 'inherit' })
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
if (!existsSync(`${dist}/app/index.html`)) throw new Error('No site in dist/: the build made none.')

git(root, 'fetch', 'origin', 'gh-pages')
if (existsSync(pages)) git(root, 'worktree', 'remove', '--force', pages)
git(root, 'worktree', 'add', '--detach', pages, 'origin/gh-pages')
for (const name of await readdir(pages)) if (!kept.has(name)) await rm(`${pages}/${name}`, { recursive: true, force: true })
await cp(dist, pages, { recursive: true })

git(pages, 'add', '--all')
if (!git(pages, 'status', '--porcelain')) {
  console.log('gh-pages already has this site.')
} else {
  const app = git(`${root}../app`, 'rev-parse', '--short', 'HEAD')
  git(pages, 'commit', '--quiet', '-m', `Deploy the Earth app at ${app}`)
  git(pages, 'push', 'origin', 'HEAD:gh-pages')
  console.log(`Deployed the Earth app at ${app} to gh-pages.`)
}
git(root, 'worktree', 'remove', pages)
