/* Local account preview only. No account, token, game or asset enters Cache Storage. */
const CACHE_VERSION = 'assets-50fc0f01030d';

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function connectionNeeded() {
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#26583e">
    <title>Watten · Offline</title><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center;background:#e8ede4;color:#24382e;font:17px/1.6 system-ui,sans-serif}main{max-width:36rem}h1{font:700 36px Georgia,serif}a{display:inline-flex;align-items:center;min-height:44px;padding:10px 16px;border:1px solid currentColor;border-radius:5px;color:#26583e}a:focus-visible{outline:3px solid #996c1f;outline-offset:3px}
    </style></head><body><main><h1>Watten</h1>
    <p>Für diese lokale Kontovorschau brauchst du eine Internetverbindung. Kontodaten werden nicht offline gespeichert.</p>
    <p lang="en">This local account preview needs an internet connection. Account data is never stored for offline use.</p>
    <a href="/watten">Erneut verbinden / Reconnect</a></main></body></html>`, {
    status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow', 'X-Watten-Worker-Version': CACHE_VERSION },
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const ownPage = url.pathname === '/watten' || url.pathname.startsWith('/watten/');
  if (ownPage && request.method === 'GET' && request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(connectionNeeded));
    return;
  }
  // No fallback for APIs, account recovery tokens, assets or another product.
  event.respondWith(fetch(request));
});

const NOTIFICATION_ICON = '/static/watten/icons/watten-icon-192.png';
const NOTIFICATION_FIELDS = new Set(['title', 'body', 'tag', 'url', 'icon', 'badge']);

function notificationTarget(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\s\\%]/u.test(value)) return null;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password || url.search || url.hash
        || !/^\/watten(?:\/spiel\/[0-9a-f]{16}(?:\/zuschauen)?)?$/u.test(url.pathname)) return null;
    // Reject URL normalization tricks, encoded paths, fragments and even empty queries.
    if (value !== url.pathname && value !== `${self.location.origin}${url.pathname}`) return null;
    return url.pathname;
  } catch (_) { return null; }
}

function notificationText(value, maximum, allowEmpty = false) {
  return typeof value === 'string' && (allowEmpty || value.trim().length > 0)
    && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function notificationPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !NOTIFICATION_FIELDS.has(key))
      || !notificationText(value.title, 100) || !notificationText(value.body, 400, true)
      || typeof value.tag !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value.tag)
      || ['icon', 'badge'].some(key => key in value && value[key] !== NOTIFICATION_ICON)) return null;
  const target = notificationTarget(value.url);
  return target ? { title: value.title, body: value.body, tag: value.tag, url: target } : null;
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    // Permission is owned by the browser. A push never requests or assumes consent.
    if (self.Notification?.permission !== 'granted') return;
    let payload;
    try { payload = notificationPayload(event.data?.json()); } catch (_) { return; }
    if (!payload) return;
    await self.registration.showNotification(payload.title, {
      body: payload.body, tag: payload.tag, icon: NOTIFICATION_ICON, badge: NOTIFICATION_ICON,
      renotify: false, data: { url: payload.url },
    });
  })().catch(() => { /* Browser rejection does not create a fallback notification. */ }));
});

self.addEventListener('notificationclick', event => {
  event.waitUntil((async () => {
    event.notification.close();
    const data = event.notification.data;
    if (event.action || !data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).length !== 1 || !Object.hasOwn(data, 'url')) return;
    const target = notificationTarget(data.url);
    if (!target) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => notificationTarget(client.url) === target);
    // Never repurpose another table or another product's existing window.
    if (existing) await existing.focus();
    else await self.clients.openWindow(new URL(target, self.location.origin).href);
  })().catch(() => { /* A rejected browser operation must not navigate a fallback. */ }));
});
