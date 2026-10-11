// Builds the site into dist/: the landing page at /, the Earth app at /app/ and
// foss-earth-sw.js, which retires the service worker the app had when it was
// served from the root. The app is copied from ../app/dist, so build it first
// (README).
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const app = new URL('../app/dist/', root)
const dist = new URL('dist/', root)

let appPage
try {
  appPage = await readFile(new URL('index.html', app), 'utf8')
} catch {
  throw new Error(`No app build in ${fileURLToPath(app)}: run npm run build in app first.`)
}
if (!appPage.includes('/app/assets/')) throw new Error('The app build is not for /app/; build it with its own vite.config.ts.')

await rm(dist, { recursive: true, force: true })
await mkdir(dist)
for (const file of ['index.html', 'landing.css', 'foss-earth-sw.js']) await cp(new URL(file, root), new URL(file, dist))
await cp(app, new URL('app/', dist), { recursive: true })
console.log(`Built dist/ with the app from ${fileURLToPath(app)}`)
