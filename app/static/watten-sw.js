/* Local account preview only. No account, token, game or asset enters Cache Storage. */
const CACHE_VERSION = 'assets-d063d2c00223';

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
