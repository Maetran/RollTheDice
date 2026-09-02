/*
  sw.js — Service Worker (Root-Scope: /)
  --------------------------------------
  Aufgaben:
  - Pre-Caching zentraler Assets für Offline/Low-Connectivity
  - Cleanup alter Cache-Versionen beim Activate-Event
  - Vorsichtiger Fetch-Handler nur für GET-Anfragen der eigenen Origin

  Hinweise zu Entscheidungen:
  - Precache-Fehlschläge (404/Netz) werden bewusst ignoriert, damit eine fehlende
    einzelne Datei die Installation nicht blockiert.
  - Cache-Name und Asset-Querys werden aus dem Dateiinhalt erzeugt; dazu
    `scripts/sync_static_versions.py` ausführen, nicht manuell hochzählen.
*/

const CACHE_VERSION = 'assets-d87e8a21b65c';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME  = `runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/regeln',
  '/spieler',
  '/konto',
  '/admin',
  '/offline',
  '/static/auth.js',
  '/static/ui.js',
  '/static/pwa.js',
  '/static/i18n.js',
  '/static/style.css',
  '/static/theme.js',
  '/static/scoreboard.js',
  '/static/emoji.js',
  '/static/room.js',
  '/static/chat.js',
  '/static/favicon.png',
  '/static/icons/apple-touch-icon-180.png',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/manifest.webmanifest',
  '/manifest-en.webmanifest',
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
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API-Aufrufe dürfen nie aus einem alten Runtime-Cache beantwortet werden.
  // Bei einem nicht erreichbaren Backend liefern wir eine eindeutige 503-Antwort
  // statt eines browserabhängigen "Failed to fetch".
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiNetworkOnly(req));
    return;
  }

  // Nur statische GET-Anfragen und Navigationen cachen.
  if (req.method !== 'GET') return;

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(networkFirst(req));
});

// --- Strategien ---
async function cacheFirst(req) {
  const cache = await caches.open(PRECACHE);
  // Eine neue Versionsnummer muss online wirklich die neue Datei laden.
  // Der kanonische Precache-Eintrag dient nur als Offline-Fallback.
  const url = new URL(req.url);
  const exact = await cache.match(req, { ignoreSearch: false });
  if (exact) return exact;

  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const canonical = await cache.match(url.pathname, { ignoreSearch: true });
    if (canonical) return canonical;
    if (req.destination === 'document') {
      const fallback = await cache.match('/offline');
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function apiNetworkOnly(req) {
  try {
    return await fetch(req);
  } catch (e) {
    return new Response(JSON.stringify({
      detail: 'backend_unavailable',
      message: 'Der Spielserver ist nicht erreichbar.'
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
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
      const fallback = await precache.match('/offline');
      if (fallback) return fallback;
    }
    throw e;
  }
}
