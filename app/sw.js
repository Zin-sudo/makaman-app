// Minimal service worker — exists so the app is genuinely installable (Add to Home
// Screen / Install app) on any device, not just usable as a plain browser tab. This is a
// prototype: the strategy is deliberately simple (network-first, falling back to a small
// same-origin cache) rather than a full offline-first asset pipeline. The app's own data
// layer already handles offline logging via localStorage (see the Field Device notes in
// the technician screen) — this cache only covers the app shell itself so the page can
// still load if the device has no signal when it's opened.
const CACHE = 'makaman-jobtickets-shell-v2';
// The React/Babel bundles and the fonts are part of the shell now, not remote assets.
// Without them precached the app would show a blank page on an offline cold start, since
// support.js cannot boot without React. Bumping the cache name retires the v1 shell,
// which cached neither.
const SHELL = [
  './',
  './index.html',
  './support.js',
  './manifest.webmanifest',
  './vendor/react.production.min.js',
  './vendor/react-dom.production.min.js',
  './vendor/babel.min.js',
  './vendor/fonts.css',
  './uploads/icon-192.png',
  './uploads/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
