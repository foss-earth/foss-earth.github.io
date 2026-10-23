import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { publishedAppPage, publishSite } from './deploy.mjs'

const fixtures = path.join(fileURLToPath(new URL('../', import.meta.url)), 'build', 'checks')
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const put = (dir, file, contents) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), contents)
}
const repository = dir => {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '--initial-branch=main')
  git(dir, 'config', 'user.name', 'Site deploy tests')
  git(dir, 'config', 'user.email', 'site-deploy@example.invalid')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

/** A site checkout whose origin's gh-pages has an app, the kept pages and an older landing page. */
function fixture(t) {
  mkdirSync(fixtures, { recursive: true })
  const folder = mkdtempSync(path.join(fixtures, 'site-deploy-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const remote = path.join(folder, 'site.git')
  git(folder, 'init', '-q', '--bare', remote)
  const pages = repository(path.join(folder, 'pages'))
  for (const [file, contents] of Object.entries({
    'index.html': 'old landing', 'landing.css': 'old css', 'foss-earth-sw.js': 'old worker', '.gitignore': 'kept\n',
    'app/index.html': '<script src="/app/assets/old.js"></script>', 'app/assets/old.js': 'old app',
    'eac-prototype/index.html': 'prototype', 'examples/tiles/index.html': 'example',
  })) put(pages, file, contents)
  git(pages, 'add', '.')
  git(pages, 'commit', '-q', '-m', 'Published')
  git(pages, 'push', '-q', remote, 'HEAD:refs/heads/gh-pages')
  const site = repository(path.join(folder, 'site'))
  put(site, 'index.html', 'new landing')
  put(site, 'landing.css', 'new css')
  put(site, 'foss-earth-sw.js', 'old worker')
  git(site, 'add', '.')
  git(site, 'commit', '-q', '-m', 'Landing page')
  git(site, 'remote', 'add', 'origin', remote)
  const published = () => Object.fromEntries(git(remote, 'ls-tree', '-r', 'gh-pages').split('\n')
    .map(line => line.split('\t')).map(([info, file]) => [file, git(remote, 'cat-file', 'blob', info.split(' ')[2])]))
  return { folder, remote, site, published, head: () => git(remote, 'rev-parse', 'gh-pages') }
}

test('publishes the landing page over the app gh-pages has, with no Jekyll, and nothing when nothing changed', t => {
  const { site, published, head } = fixture(t)
  assert.match(publishedAppPage({ root: site }), /old\.js/)
  const logs = []
  assert.equal(publishSite({ root: site, message: 'Deploy the landing page', log: line => logs.push(line) }).changed, true)
  assert.deepEqual(published(), {
    '.gitignore': 'kept', '.nojekyll': '', 'app/assets/old.js': 'old app', 'app/index.html': '<script src="/app/assets/old.js"></script>',
    'eac-prototype/index.html': 'prototype', 'examples/tiles/index.html': 'example',
    'foss-earth-sw.js': 'old worker', 'index.html': 'new landing', 'landing.css': 'new css',
  })
  assert.equal(git(site, 'log', '-1', '--format=%s', head()), 'Deploy the landing page')
  assert.match(logs[0], /3 files changed/)
  const before = head()
  assert.equal(publishSite({ root: site, message: 'Again', log: () => {} }).changed, false)
  assert.equal(head(), before)
})

test('replaces all but the kept pages with a new build', t => {
  const { site, published } = fixture(t)
  const dist = path.join(site, 'dist')
  put(dist, 'index.html', 'new landing')
  put(dist, 'app/index.html', '<script src="/app/assets/new.js"></script>')
  put(dist, 'app/assets/new.js', 'new app')
  put(dist, 'app/.vite/manifest.json', '{}')
  publishSite({ root: site, dist, message: 'Deploy the Earth app', log: () => {} })
  assert.deepEqual(Object.keys(published()).sort(), [
    '.gitignore', '.nojekyll', 'app/.vite/manifest.json', 'app/assets/new.js', 'app/index.html',
    'eac-prototype/index.html', 'examples/tiles/index.html', 'index.html',
  ])
})

test('pushes nothing in a dry run, and refuses a build with no app', t => {
  const { site, head } = fixture(t)
  const before = head()
  assert.equal(publishSite({ root: site, message: 'Dry', dryRun: true, log: () => {} }).changed, true)
  assert.equal(head(), before)
  mkdirSync(path.join(site, 'dist'))
  assert.throws(() => publishSite({ root: site, dist: path.join(site, 'dist'), message: 'Empty', log: () => {} }), /No site in dist/)
})
