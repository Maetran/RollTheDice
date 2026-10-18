/* Hausdepp is an online multiplayer game. Nothing enters Cache Storage.
   Public artwork uses the browser's HTTP image cache; private content stays online-only. */
const CACHE_VERSION = 'assets-aee7e5811857';

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function connectionNeeded() {
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#173e34">
    <title>Hausdepp · Offline</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#173e34;color:#f5f0de;font:17px/1.6 system-ui,sans-serif}
    main{max-width:36rem}h1{font:700 42px Georgia,serif}p[lang=en]{color:#d7dfd3}a{display:inline-flex;align-items:center;min-height:44px;padding:10px 18px;background:#f5f0de;color:#173e34;border:1px solid currentColor;border-radius:4px;font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid #d8b875;outline-offset:4px}
    </style></head><body><main><h1>Hausdepp</h1>
    <p>Für Hausdepp brauchst du eine Internetverbindung. Deine Karten und Kontodaten werden nicht offline gespeichert.</p>
    <p lang="en">Hausdepp needs an internet connection. Your cards and account data are never stored for offline use.</p>
    <a href="/hausdepp">Erneut verbinden / Reconnect</a></main></body></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow', 'X-Hausdepp-Worker-Version': CACHE_VERSION },
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // These public, versioned pictures contain no dealt cards or account state.
  // Native image loading keeps a warm Safari SVG image out of the worker's
  // second fetch/cache boundary. It also reuses the ordinary HTTP image cache.
  if (request.method === 'GET' && [
    '/static/hausdepp/cards-atlas.webp',
    '/static/hausdepp/card-back.webp',
  ].includes(url.pathname)) return;
  // A worker registered for /hausdepp must never supply another game's
  // navigation, even if the registration is inspected outside its scope.
  const hausdeppPage = url.pathname === '/hausdepp' || url.pathname.startsWith('/hausdepp/');
  if (request.method === 'GET' && request.mode === 'navigate' && hausdeppPage) {
    event.respondWith(fetch(request).catch(connectionNeeded));
    return;
  }
  event.respondWith(fetch(request));
});

function notificationTarget(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/hausdepp', self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch (_) { /* A malformed destination opens the game lobby. */ }
  return new URL('/hausdepp', self.location.origin).href;
}

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) { /* Keep a neutral notification. */ }
  event.waitUntil(self.registration.showNotification(
    typeof payload.title === 'string' && payload.title ? payload.title : 'Hausdepp', {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: '/static/icons/hausdepp-icon-192-v2.png', badge: '/static/icons/hausdepp-icon-192-v2.png',
      tag: typeof payload.tag === 'string' ? payload.tag : 'game-update', renotify: false,
      data: { url: notificationTarget(payload.url) },
    },
  ));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = notificationTarget(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === target);
    return existing ? existing.focus() : self.clients.openWindow(target);
  })());
});
