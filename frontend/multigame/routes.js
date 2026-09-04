export const ZDWA_PRODUCTION_ORIGIN = "https://zockdiewandan.online";
export const ZILCH_PRODUCTION_HOST = "zilch.zockdiewandan.online";

const ZDWA_PRODUCTION_HOSTS = new Set([
  "zockdiewandan.online",
  "www.zockdiewandan.online",
  "zdwa.zockdiewandan.online",
]);
const ZILCH_LEGACY_PREFIX = "/zilch";
const ZILCH_PAGE_ROUTE = /^\/(?:$|spiel\/[^/]+|ergebnis\/[^/]+|historie|regeln|statistiken|bestenlisten|erfolge|konto|spieler\/[^/]+)\/?$/;

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

export function isProductionZilchLocation(locationLike = window.location) {
  return String(activeLocation(locationLike).hostname || "").toLowerCase() === ZILCH_PRODUCTION_HOST;
}

export function isProductionZdwaLocation(locationLike = window.location) {
  return ZDWA_PRODUCTION_HOSTS.has(String(activeLocation(locationLike).hostname || "").toLowerCase());
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
 * Production enters Zilch through the apex continuation endpoint so an
 * existing host-only login can be upgraded to the shared domain cookie before
 * the handoff to the subdomain. Local and legacy installs navigate directly.
 */
export function zilchAppEntryUrl(route = "/", locationLike = window.location) {
  const destination = normalizedRoute(route);
  if (!isProductionZdwaLocation(locationLike)) return zilchPath(destination, locationLike);
  return `${ZDWA_PRODUCTION_ORIGIN}/auth/continue?app=zilch&path=${encodeURIComponent(destination)}`;
}

export function zdwaAppEntryUrl(locationLike = window.location) {
  return isProductionZilchLocation(locationLike) || isProductionZdwaLocation(locationLike)
    ? `${ZDWA_PRODUCTION_ORIGIN}/`
    : "/";
}
