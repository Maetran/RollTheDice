// sw.js — Minimaler Service Worker für RollTheDice (Root-Scope: /)

const CACHE_VERSION = 'v31';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME  = `runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/static/index.html',
  '/static/room.html',
  '/static/rules.html',
  '/static/style.css',
  '/static/scoreboard.js',
  '/static/emoji.js',
  '/static/room.js',
  '/static/chat.js',
  '/manifest.webmanifest',
];

// — Install: robust gegen einzelne 404/Netzfehler
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await Promise.all(
      PRECACHE_URLS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res && res.ok) await cache.put(url, res.clone());
        } catch (e) {
          // fehlende/temporär nicht erreichbare Dateien ignorieren
        }
      })
    );
  })());
  self.skipWaiting();
});

// — Activate: alte Caches aufräumen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// — Fetch-Routing
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // nur GET cachen
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(networkFirst(req));
});

// --- Strategien ---
async function cacheFirst(req) {
  const cache = await caches.open(PRECACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    if (req.destination === 'document') {
      const fallback = await cache.match('/static/index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function networkFirst(req) {
  const runtime = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res && res.ok) runtime.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await runtime.match(req);
    if (cached) return cached;

    if (req.destination === 'document') {
      const precache = await caches.open(PRECACHE);
      const fallback = await precache.match('/static/index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}