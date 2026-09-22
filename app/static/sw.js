/* ZDWA PWA: cache only the explicit local-play package. */
const CACHE_VERSION = 'assets-6064ef46b35e';
const PRECACHE = `offline-zdwa-${CACHE_VERSION}`;
const OFFLINE_PAGES = new Set([
  "/offline-spielen",
  "/zilch/offline-spielen",
]);
const OFFLINE_ASSETS = new Set([
  "/static/style.css",
  "/static/offline-play.css",
  "/static/offline-play.js",
  "/static/favicon.png",
  "/static/icons/apple-touch-icon-180.png",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/kalam-classic-latin-regular-v1.woff2",
  "/static/kalam-classic-latin-bold-v1.woff2",
]);
const PRECACHE_URLS = [...OFFLINE_PAGES, ...OFFLINE_ASSETS];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    // A complete package is required before the new worker can activate.
    // These documents carry no account data and do not need credentials.
    await cache.addAll(PRECACHE_URLS.map(url => new Request(url, { credentials: 'omit', cache: 'reload' })));
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    const assets = await Promise.all(PRECACHE_URLS.map(url => cache.match(url)));
    event.ports[0].postMessage({ ready: assets.every(Boolean), version: CACHE_VERSION });
  })());
});

function pushNotificationPayload(event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }
  const url = typeof payload.url === 'string' ? payload.url : '/';
  return {
    title: typeof payload.title === 'string' && payload.title ? payload.title : 'Spiel-Update',
    options: {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: typeof payload.icon === 'string' ? payload.icon : '/static/icons/icon-192.png',
      badge: typeof payload.badge === 'string' ? payload.badge : '/static/icons/icon-192.png',
      tag: typeof payload.tag === 'string' ? payload.tag : 'game-update',
      renotify: false,
      data: { url },
    },
  };
}

self.addEventListener('push', (event) => {
  const notification = pushNotificationPayload(event);
  event.waitUntil(self.registration.showNotification(notification.title, notification.options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let target;
    try {
      target = new URL(event.notification.data?.url || '/', self.location.origin).href;
    } catch (_) {
      target = new URL('/', self.location.origin).href;
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === target);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});


self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== PRECACHE && /^(?:precache-|runtime-|offline-zdwa-|offline-zilch-)/.test(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});


const ACCOUNT_ACTION_PATHS = new Set(['/registrierung/bestaetigen', '/passwort-vergessen', '/passwort-zuruecksetzen', '/email-bestaetigen']);
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) { event.respondWith(apiNetworkOnly(req)); return; }
  if (req.method !== 'GET' || ACCOUNT_ACTION_PATHS.has(url.pathname)) { event.respondWith(fetch(req)); return; }
  if (OFFLINE_ASSETS.has(url.pathname)) { event.respondWith(offlineAsset(req)); return; }
  if (req.mode === 'navigate') {
    const zilch = url.pathname === '/zilch' || url.pathname.startsWith('/zilch/');
    event.respondWith(offlineNavigation(req, zilch ? '/zilch/offline-spielen' : '/offline-spielen'));
    return;
  }
  event.respondWith(fetch(req));
});


// Only the explicit offline package enters Cache Storage. Online rooms,
// account documents, result pages and every API response stay network-only.
async function offlineAsset(req) {
  const cache = await caches.open(PRECACHE);
  const exact = await cache.match(req);
  if (exact) return exact;
  try {
    const response = await fetch(req, { cache: 'no-cache' });
    if (response.ok) {
      try { await cache.put(req, response.clone()); } catch (_) { /* Keep the good network response. */ }
    }
    return response;
  } catch (error) {
    const fallback = await cache.match(new URL(req.url).pathname);
    if (fallback) return fallback;
    throw error;
  }
}

async function offlineNavigation(req, fallbackPath) {
  try {
    return await fetch(req);
  } catch (error) {
    const cache = await caches.open(PRECACHE);
    // This is only an entry/confirmation screen, never a continuation of the
    // online game whose document could not be reached.
    const fallback = await cache.match(fallbackPath);
    if (fallback) return fallback;
    throw error;
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
