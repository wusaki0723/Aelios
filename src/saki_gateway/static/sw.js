const SW_VERSION = 'saki-sw-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SW_VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Keep the app installable without serving stale assets from an old cache.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
