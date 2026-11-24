// Killcraft service worker: caches the whole game so it loads and plays solo with no connection.
// Filled in at build time by sw_plugin.ts.
const VERSION = '__VERSION__';
const FILES = [/*__FILES__*/];
const CACHE = `killcraft-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('killcraft-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname === '/ws' || url.pathname === '/status' || url.pathname === '/lobby' || url.pathname === '/health') return;

  // pages (/, /game/<id>, ...): the newest from the network, the cached app when offline
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match('/', { cacheName: CACHE })) ?? Response.error()));
    return;
  }
  // built files have hashed names, so the cached copy is always right
  event.respondWith((async () => {
    const hit = await caches.match(req, { cacheName: CACHE, ignoreSearch: true });
    return hit ?? fetch(req);
  })());
});
