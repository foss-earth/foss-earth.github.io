// Builds the site into dist/: the landing page at /, the Earth app at /app/ and
// foss-earth-sw.js, which retires the service worker the app had when it was
// served from the root. The app is copied from ../app/dist, so build it first
// (README).
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const app = new URL('../app/dist/', root)
const dist = new URL('dist/', root)
/** The landing page's files, at the site's root as in this checkout. */
export const LANDING = ['index.html', 'landing.css', 'foss-earth-sw.js']

/**
 * The brand palette a page's <html> names (data-ui-theme), such as the UMN
 * tour's, or null for FOSS Earth's own colors ("earth" or none).
 */
export function brandPalette(page) {
  const root = /<html\b[^>]*>/i.exec(page)?.[0] ?? ''
  const named = /\sdata-ui-theme\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(root)
  if (!named) return null
  const palette = named[1] ?? named[2] ?? named[3]
  return palette === 'earth' ? null : palette
}

/**
 * Why the app's built page cannot be published at /app/, or null. From 11 to 26
 * October 2026 the app's pages named the UMN palette, and the site showed FOSS
 * Earth in maroon and gold.
 */
export function appPageProblem(page) {
  if (!page.includes('/app/assets/')) return 'The app build is not for /app/; build it with its own vite.config.ts.'
  const palette = brandPalette(page)
  if (palette !== null) return `The app build's <html> names the ${JSON.stringify(palette)} palette (data-ui-theme), so the site would show FOSS Earth in it. FOSS Earth's own pages name none: remove it from app/index.html.`
  return null
}

export async function buildSite() {
  let appPage
  try {
    appPage = await readFile(new URL('index.html', app), 'utf8')
  } catch {
    throw new Error(`No app build in ${fileURLToPath(app)}: run npm run build in app first.`)
  }
  const problem = appPageProblem(appPage)
  if (problem) throw new Error(problem)

  await rm(dist, { recursive: true, force: true })
  await mkdir(dist)
  for (const file of LANDING) await cp(new URL(file, root), new URL(file, dist))
  await cp(app, new URL('app/', dist), { recursive: true })
  console.log(`Built dist/ with the app from ${fileURLToPath(app)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildSite()
