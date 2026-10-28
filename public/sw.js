const CACHE_NAME = 'execution-os-cache-v3';
const ASSETS_TO_CACHE = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Do not intercept external requests, auth routes, API endpoints, or database queries
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/rest') ||
    url.pathname.includes('/auth/')
  ) return;

  // Socket.IO long-polling / handshake requests are live, unique-per-request traffic. Never
  // cache them or fetch them twice.
  if (url.pathname.startsWith('/socket.io')) return;

  // Server-function GETs (/_serverFn/...) are data reads. Network first so the page never
  // gets a stale answer, with the last good response as an offline fallback. (They used to be
  // answered from cache and then refetched in the background, i.e. every call ran twice.)
  if (url.pathname.startsWith('/_serverFn')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return Response.error();
        })
    );
    return;
  }

  const isHTMLRequest =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));

  // 1. For HTML document requests: NETWORK FIRST
  if (isHTMLRequest) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch(async () => {
          // If offline, fall back to cached page/shell if available
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return caches.match('/');
        })
    );
    return;
  }

  // 2a. Build output under /assets/ is content-hashed (a changed file gets a new URL), so a
  // cached copy is always current: cache first, no background re-download. This keeps the app
  // available offline and avoids downloading every bundle a second time on each page load.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 2b. Other static files (icons, manifest): serve from cache and refresh in the background.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {/* Offline fallback */});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic' &&
          !url.pathname.endsWith('.html')
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});


