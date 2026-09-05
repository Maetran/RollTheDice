/*
 * Zilch PWA worker.
 *
 * This worker deliberately never writes to Cache Storage. Zilch rooms,
 * account data and game state must always be fetched from the network, so an
 * installed app can receive controlled updates without retaining private
 * pages or API responses offline.
 */
const CACHE_VERSION = 'assets-dda0867746c4';

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
