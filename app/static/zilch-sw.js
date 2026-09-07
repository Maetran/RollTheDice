/*
 * Zilch PWA worker.
 *
 * This worker deliberately never writes to Cache Storage. Zilch rooms,
 * account data and game state must always be fetched from the network, so an
 * installed app can receive controlled updates without retaining private
 * pages or API responses offline.
 */
const CACHE_VERSION = 'assets-278442c078f1';

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function pushNotificationPayload(event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }
  const url = typeof payload.url === "string" ? payload.url : "/";
  return {
    title: typeof payload.title === "string" && payload.title ? payload.title : "Spiel-Update",
    options: {
      body: typeof payload.body === "string" ? payload.body : "",
      icon: typeof payload.icon === "string" ? payload.icon : "/static/icons/zilch-icon-192.png",
      badge: typeof payload.badge === "string" ? payload.badge : "/static/icons/zilch-icon-192.png",
      tag: typeof payload.tag === "string" ? payload.tag : "game-update",
      renotify: false,
      data: { url },
    },
  };
}

self.addEventListener("push", event => {
  const notification = pushNotificationPayload(event);
  event.waitUntil(self.registration.showNotification(notification.title, notification.options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    let target;
    try {
      target = new URL(event.notification.data?.url || "/", self.location.origin).href;
    } catch (_) {
      target = new URL("/", self.location.origin).href;
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url === target);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
