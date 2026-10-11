// The Earth app used to be served at this site's root, where it kept its files
// on visitors' devices with a service worker at this address. The app now lives
// at /app/, with its own worker there. Browsers fetch this file when they check
// the old worker for updates; this version deletes the files the old worker
// kept and unregisters itself, so nothing at the root is intercepted any more.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // The name the old worker kept its files under (app vite/appFilesWorker.js).
    await caches.delete(`foss-earth-app-files ${self.location.pathname}`)
    await self.registration.unregister()
  })())
})
