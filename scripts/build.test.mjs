import assert from 'node:assert/strict'
import test from 'node:test'
import { appPageProblem, brandPalette } from './build.mjs'

/** An app page as the app's build writes it, with `attributes` on its <html>. */
const page = attributes => `<!doctype html>
<html lang="en"${attributes}>
  <head><script type="module" crossorigin src="/app/assets/index-abc123.js"></script></head>
  <body><div id="root"></div></body>
</html>
`

test('publishes an app page that names no palette, or Earth\'s', () => {
  assert.equal(appPageProblem(page('')), null)
  assert.equal(appPageProblem(page(' data-ui-theme="earth"')), null)
  assert.equal(brandPalette(page('')), null)
  assert.equal(brandPalette(page(' data-theme="dark"')), null)
})

test('refuses an app page whose <html> names a brand palette, as the UMN tour\'s pages do', () => {
  // As https://foss-earth.github.io/app/ was published from 11 to 26 October 2026.
  assert.equal(brandPalette(page(' data-ui-theme="umn"')), 'umn')
  assert.match(appPageProblem(page(' data-ui-theme="umn"')), /names the "umn" palette .*app\/index\.html/)
  assert.equal(brandPalette(page(" data-theme='light' data-ui-theme='umn'")), 'umn')
  assert.equal(brandPalette(page(' DATA-UI-THEME=umn')), 'umn')
  // An empty name is not Earth's: the palette's shared rules would apply with no colors.
  assert.equal(brandPalette(page(' data-ui-theme=""')), '')
  assert.notEqual(appPageProblem(page(' data-ui-theme=""')), null)
})

test('reads the palette from <html> alone', () => {
  assert.equal(brandPalette('<html lang="en"><body><div data-ui-theme="umn"></div></body></html>'), null)
  assert.equal(brandPalette('<html lang="en" data-ui-themes="umn">'), null)
})

test('refuses an app page built for another base than /app/', () => {
  assert.match(appPageProblem('<html lang="en"><script src="/assets/index.js"></script></html>'), /not for \/app\//)
})
