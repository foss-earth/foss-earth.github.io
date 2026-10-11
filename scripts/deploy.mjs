// Publishes dist/ to the gh-pages branch, which GitHub Pages serves at
// https://foss-earth.github.io/. gh-pages also holds pages that aren't built
// here, /eac-prototype/ and /examples/; those are kept as they are. Everything
// else on the branch is replaced by dist/. Run npm run build first.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const kept = new Set(['.git', '.gitignore', 'eac-prototype', 'examples'])
const root = fileURLToPath(new URL('../', import.meta.url))
const dist = `${root}dist`
const pages = `${root}build/gh-pages`
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

if (!existsSync(`${dist}/app/index.html`)) throw new Error('No site in dist/: run npm run build first.')

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
