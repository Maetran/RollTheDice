// sw.js — Minimaler Service Worker für RollTheDice
// Scope: /static/ (Datei muss unter /static liegen)

const CACHE_VERSION = 'v2';            // <— NEU (vorher v1)
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME = `runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/static/index.html',
  '/static/room.html',
  '/static/rules.html',
  '/static/style.css',
  '/static/game.js',
  '/static/scoreboard.js',
  '/static/emoji.js',
  '/static/room.js',
  '/static/chat.js',
  '/static/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(PRECACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    if (req.destination === 'document') {
      const idx = await cache.match('/static/index.html');
      if (idx) return idx;
    }
    throw;
  }
}

async function networkFirst(req) {
  const runtime = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res && res.ok) runtime.put(req, res.clone());
    return res;
  } catch {
    const cached = await runtime.match(req);
    if (cached) return cached;
    if (req.destination === 'document') {
      const precache = await caches.open(PRECACHE);
      const idx = await precache.match('/static/index.html');
      if (idx) return idx;
    }
    throw;
  }
}