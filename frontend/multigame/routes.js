export const ZDWA_PRODUCTION_ORIGIN = "https://zockdiewandan.online";
export const ZILCH_PRODUCTION_HOST = "zilch.zockdiewandan.online";

const ZDWA_PRODUCTION_HOSTS = new Set([
  "zockdiewandan.online",
  "www.zockdiewandan.online",
  "zdwa.zockdiewandan.online",
]);
const ZILCH_LEGACY_PREFIX = "/zilch";
const ZILCH_PAGE_ROUTE = /^\/(?:$|spiel\/[^/]+|ergebnis\/[^/]+|historie|regeln|statistiken|bestenlisten|erfolge|konto|spieler\/[^/]+)\/?$/;
export const ZDWA_PWA_BRIDGE_PREFIX = "/zdwa";
const ZDWA_PAGE_ROUTE = /^\/(?:$|spiel\/[^/]+(?:\/zuschauen)?|ergebnis(?:\/[^/]+)?|regeln|spieler(?:\/[^/]+)?|rangabzeichen|konto|admin|offline)\/?$/;

function activeLocation(locationLike) {
  return locationLike || window.location;
}

function normalizedRoute(value = "/") {
  let route = String(value || "/").trim();
  if (!route.startsWith("/") || route.startsWith("//")) route = "/";
  if (route === ZILCH_LEGACY_PREFIX) return "/";
  if (route.startsWith(`${ZILCH_LEGACY_PREFIX}/`)) route = route.slice(ZILCH_LEGACY_PREFIX.length);
  return route || "/";
}

function normalizedZdwaRoute(value = "/") {
  let route = String(value || "/").trim();
  if (!route.startsWith("/") || route.startsWith("//")) route = "/";
  if (route === ZDWA_PWA_BRIDGE_PREFIX) return "/";
  if (route.startsWith(`${ZDWA_PWA_BRIDGE_PREFIX}/`)) route = route.slice(ZDWA_PWA_BRIDGE_PREFIX.length);
  return route || "/";
}

export function isProductionZilchLocation(locationLike = window.location) {
  return String(activeLocation(locationLike).hostname || "").toLowerCase() === ZILCH_PRODUCTION_HOST;
}

export function isProductionZdwaLocation(locationLike = window.location) {
  return ZDWA_PRODUCTION_HOSTS.has(String(activeLocation(locationLike).hostname || "").toLowerCase());
}

/**
 * An installed Zilch app cannot follow an Apex navigation without iOS
 * exposing it in a browser sheet. Its private `/zdwa` bridge therefore hosts
 * the established ZDWA documents on the already-installed Zilch origin.
 */
export function isZilchHostedZdwaLocation(locationLike = window.location) {
  const location = activeLocation(locationLike);
  const pathname = String(location.pathname || "/");
  return isProductionZilchLocation(location)
    && (pathname === ZDWA_PWA_BRIDGE_PREFIX || pathname.startsWith(`${ZDWA_PWA_BRIDGE_PREFIX}/`));
}

/**
 * Installed app shells may only keep in-app navigation within their own
 * origin. iOS exposes cross-origin navigation from a standalone PWA as a
 * browser sheet, whose close action returns to the originating app.
 */
export function isStandalonePwa(environmentLike = globalThis) {
  if (environmentLike?.navigator?.standalone === true) return true;
  try {
    return Boolean(environmentLike?.matchMedia?.("(display-mode: standalone)")?.matches);
  } catch (_) {
    return false;
  }
}

/**
 * Return a Zilch page path for the active deployment shape. The production
 * subdomain owns clean root paths; localhost, preview and legacy deployments
 * keep the established /zilch prefix.
 */
export function zilchPath(route = "/", locationLike = window.location) {
  const normalized = normalizedRoute(route);
  if (isProductionZilchLocation(locationLike)) return normalized;
  return normalized === "/" ? ZILCH_LEGACY_PREFIX : `${ZILCH_LEGACY_PREFIX}${normalized}`;
}

/**
 * Project a browser pathname back to the app-relative Zilch route. Legacy
 * prefixed URLs are accepted on the production host as a defensive fallback,
 * but all newly rendered links use its clean root form.
 */
export function zilchRoutePath(pathname = window.location.pathname, locationLike = window.location) {
  const raw = String(pathname || "/");
  if (isProductionZilchLocation(locationLike)) return normalizedRoute(raw);
  if (raw === ZILCH_LEGACY_PREFIX || raw === `${ZILCH_LEGACY_PREFIX}/`) return "/";
  if (!raw.startsWith(`${ZILCH_LEGACY_PREFIX}/`)) return null;
  return normalizedRoute(raw);
}

/**
 * Normalize a same-origin page destination received through return_to or a
 * server result payload. API paths, protocol-relative URLs and unrelated app
 * pages are deliberately rejected.
 */
export function normalizeZilchPageUrl(value, locationLike = window.location) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  let candidate;
  try {
    candidate = new URL(value, "https://zilch-route.invalid");
  } catch {
    return null;
  }
  if (candidate.origin !== "https://zilch-route.invalid") return null;
  const route = zilchRoutePath(candidate.pathname, locationLike);
  if (!route || !ZILCH_PAGE_ROUTE.test(route)) return null;
  return `${zilchPath(route, locationLike)}${candidate.search}${candidate.hash}`;
}

export function applyZilchRouteLinks(scope = document, locationLike = window.location) {
  for (const link of scope.querySelectorAll("[data-zilch-path]")) {
    link.setAttribute("href", zilchPath(link.getAttribute("data-zilch-path") || "/", locationLike));
  }
}

/**
 * Return the ZDWA route that is relative to its current host. On the Zilch
 * PWA bridge the visible page path deliberately keeps the `/zdwa` prefix;
 * canonical ZDWA and local development keep their existing root paths.
 */
export function zdwaPath(route = "/", locationLike = window.location) {
  const normalized = normalizedZdwaRoute(route);
  if (!isZilchHostedZdwaLocation(locationLike)) return normalized;
  return normalized === "/" ? ZDWA_PWA_BRIDGE_PREFIX : `${ZDWA_PWA_BRIDGE_PREFIX}${normalized}`;
}

/**
 * Project a browser pathname back to the app-relative ZDWA route. Returning
 * null for a regular Zilch route keeps the bridge from claiming Zilch pages.
 */
export function zdwaRoutePath(pathname = window.location.pathname, locationLike = window.location) {
  const raw = String(pathname || "/");
  if (!isProductionZilchLocation(locationLike)) return normalizedZdwaRoute(raw);
  if (raw === ZDWA_PWA_BRIDGE_PREFIX || raw === `${ZDWA_PWA_BRIDGE_PREFIX}/`) return "/";
  if (!raw.startsWith(`${ZDWA_PWA_BRIDGE_PREFIX}/`)) return null;
  return normalizedZdwaRoute(raw);
}

/**
 * Static ZDWA documents contain root-relative links. Rewrite only known
 * document routes while rendered inside the bridge; API, worker and asset
 * paths must stay at the real origin root.
 */
export function applyZdwaBridgeLinks(scope = document, locationLike = window.location) {
  if (!isZilchHostedZdwaLocation(locationLike)) return;
  const current = activeLocation(locationLike);
  for (const link of scope.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#")) continue;
    let target;
    try {
      target = new URL(href, current.href);
    } catch {
      continue;
    }
    if (target.origin !== current.origin) continue;
    const route = normalizedZdwaRoute(target.pathname);
    if (!ZDWA_PAGE_ROUTE.test(route)) continue;
    link.setAttribute("href", `${zdwaPath(route, current)}${target.search}${target.hash}`);
  }
}

/**
 * Zilch has a public lobby. Ordinary production navigation reaches its
 * canonical subdomain directly instead of forcing guests through a login
 * handoff. A standalone ZDWA PWA stays on its own origin and uses the legacy
 * /zilch route instead: crossing to a subdomain would make iOS show an
 * external browser sheet rather than hand the user to the game suite.
 */
export function zilchAppEntryUrl(route = "/", locationLike = window.location, environmentLike = globalThis) {
  const destination = normalizedRoute(route);
  if (!isProductionZdwaLocation(locationLike) || isStandalonePwa(environmentLike)) {
    return zilchPath(destination, locationLike);
  }
  return `https://${ZILCH_PRODUCTION_HOST}${destination}`;
}

export function zdwaAppEntryUrl(locationLike = window.location, environmentLike = globalThis) {
  if (isProductionZilchLocation(locationLike) && isStandalonePwa(environmentLike)) {
    return ZDWA_PWA_BRIDGE_PREFIX;
  }
  return isProductionZilchLocation(locationLike) || isProductionZdwaLocation(locationLike)
    ? `${ZDWA_PRODUCTION_ORIGIN}/`
    : "/";
}
