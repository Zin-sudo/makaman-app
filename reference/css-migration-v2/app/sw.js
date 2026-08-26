// ============================================================
// Makaman PWA Service Worker — Cache v5
// Includes makaman-responsive-theme-v2.css
// ============================================================

const CACHE_NAME = 'makaman-v5';
const STATIC_ASSETS = [
  '/',
  '/app/index.html',
  '/app/support.js',
  '/app/permissions.js',
  '/app/admin/permissions.html',
  '/app/vendor/dc-runtime.js',
  '/app/manifest.webmanifest'
  // Add your other assets here:
  // '/app/icons/icon-192x192.png',
  // '/app/icons/icon-512x512.png',
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v5...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v5...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: Cache-first strategy
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached version immediately
        return cached;
      }

      // Fetch from network and cache
      return fetch(event.request).then((response) => {
        // Don't cache non-success responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/app/index.html');
        }
      });
    })
  );
});

// Message handler for skipWaiting
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
