// Minimal service worker — exists so the app is genuinely installable (Add to Home
// Screen / Install app) on any device, not just usable as a plain browser tab. This is a
// prototype: the strategy is deliberately simple (network-first, falling back to a small
// same-origin cache) rather than a full offline-first asset pipeline. The app's own data
// layer already handles offline logging via localStorage (see the Field Device notes in
// the technician screen) — this cache only covers the app shell itself so the page can
// still load if the device has no signal when it's opened.
const CACHE = 'makaman-jobtickets-shell-v6';
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
  // Babel is deliberately not shipped — the app has no .jsx/.tsx x-import, which is the
  // runtime's only use for it, and precaching 3.0 MB per version bump over a field
  // connection to stand ready for that is the most expensive nothing in this app.
  // See the comment beside the script tags in index.html.
  './vendor/fonts.css',
  // Both load at boot, before support.js, so a cold start without signal must find them
  // in the cache or the app comes up with no idea who it trusts to sign anyone in.
  './vendor/supabase.umd.js',
  './config.js',
  // The exporters. Precached but not loaded at boot: a technician at a wellhead with no
  // signal must still be able to produce the sheets, but nobody should pay 500KB of
  // parse time on every launch for something most sessions never use.
  './vendor/jspdf.umd.min.js',
  './vendor/jszip.min.js',
  // The real workbook the Excel export fills. Precached for the same reason as the
  // exporters: the office may be on a thin connection, and a template that does not
  // arrive is an export that cannot happen.
  './uploads/service-ticket-template.xlsx',
  // The Arabic face the PDF embeds. Same reasoning as the exporters themselves: the
  // sheets must be producible with no signal, and a customer's name is not optional.
  './vendor/jspdf-noto-arabic.js',
  // Arabic glyphs for customer names, well names and log notes typed in the field.
  // The Latin faces degrade to a system font, which is cosmetic; a device with no
  // Arabic face at all renders empty boxes instead of a customer's name, which is not.
  // Gated by unicode-range in fonts.css, so it is only *fetched* when Arabic appears —
  // precaching it here is what makes that fetch succeed with no signal.
  './vendor/fonts/NotoSansArabic-arabic.woff2',
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
