import { authError, loadAuth, login, loginWithPasskey, logout, passkeysSupported } from "../shared/auth.js";
import { mountRegistrationForm } from '../shared/registration.js';
import { HAUSDEPP_MESSAGES } from '../i18n/catalog.js';
import {
  applyZilchRouteLinks,
  hausdeppAppEntryUrl,
  hausdeppAccountReturnPath,
  normalizeHausdeppPageUrl,
  isProductionZilchLocation,
  normalizeZilchPageUrl,
  ZDWA_PRODUCTION_ORIGIN,
  zilchPath,
  zilchRoutePath,
} from "../multigame/routes.js";

applyZilchRouteLinks();

const form = document.getElementById("zilchLoginForm");
const passkeyPanel = document.getElementById("zilchPasskeyLogin");
const passkeyButton = document.getElementById("zilchPasskeyLoginButton");
const passkeyUnavailable = document.getElementById("zilchPasskeyUnavailable");
const passwordLogin = document.getElementById("zilchPasswordLogin");
const passwordFallback = document.getElementById("zilchPasswordLoginFallback");
const username = document.getElementById("zilchLoginUsername");
const password = document.getElementById("zilchLoginPassword");
const registrationForm = document.getElementById("zilchRegistrationForm");
const forgotPassword = document.getElementById("zilchForgotPassword");
const message = document.getElementById("zilchLoginMessage");
const signedIn = document.getElementById("zilchSignedIn");
const accountName = document.getElementById("zilchLoginAccountName");
const continueButton = document.getElementById("zilchContinueButton");
const logoutButton = document.getElementById("zilchLoginLogout");

let registrationController;

function t(value) {
  return window.ZDWA_I18N?.t?.(value) || String(value || "");
}

function accountTabHash(route, preferred = "") {
  if (route !== "/konto") return "";
  const hash = preferred || window.location.hash;
  return ["#statistics", "#achievements", "#settings"].includes(hash) ? hash : "";
}

function returnPath() {
  const fallback = document.documentElement.dataset.hausdeppLogin === 'true' ? '/hausdepp' : zilchPath("/");
  const candidate = new URLSearchParams(window.location.search).get("return_to");
  // One fixed, server-protected dashboard destination, never an arbitrary URL.
  if (candidate === "/admin/dashboard") return candidate;
  const directHausdeppPath = normalizeHausdeppPageUrl(candidate);
  if (directHausdeppPath) return directHausdeppPath;
  const directZilchPath = normalizeZilchPageUrl(candidate);
  if (directZilchPath) {
    const destination = new URL(directZilchPath, window.location.origin);
    const route = zilchRoutePath(destination.pathname);
    if (route === "/konto") destination.hash = accountTabHash(route, destination.hash);
    return `${destination.pathname}${destination.search}${destination.hash}`;
  }

  // A first visit to the Zilch subdomain returns through this one fixed Apex
  // endpoint. Rebuild it from validated pieces so `return_to` can never become
  // an external or arbitrary same-origin redirect after login.
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  try {
    const continuation = new URL(candidate, window.location.origin);
    if (continuation.origin !== window.location.origin || continuation.pathname !== "/auth/continue") return fallback;
    if (continuation.searchParams.get("app") === "hausdepp") {
      const path = normalizeHausdeppPageUrl(continuation.searchParams.get("path") || "/hausdepp");
      if (!path) return fallback;
      return `/auth/continue?app=hausdepp&path=${encodeURIComponent(path)}`;
    }
    if (continuation.searchParams.get("app") !== "zilch") return fallback;
    const requestedPath = continuation.searchParams.get("path") || "/";
    const legacyCandidate = requestedPath === "/" ? "/zilch" : `/zilch${requestedPath}`;
    const validatedLegacyPath = normalizeZilchPageUrl(legacyCandidate);
    if (!validatedLegacyPath) return fallback;
    const validated = new URL(validatedLegacyPath, window.location.origin);
    const cleanRoute = zilchRoutePath(validated.pathname);
    if (!cleanRoute) return fallback;
    const cleanPath = `${cleanRoute}${validated.search}`;
    // HTTP redirects inherit the incoming fragment, which the server cannot
    // read. Keep a known account tab outside the handoff's validated path so
    // the browser carries it through the final cross-origin redirect too.
    const hash = accountTabHash(cleanRoute, validated.hash || continuation.hash);
    return `/auth/continue?app=zilch&path=${encodeURIComponent(cleanPath)}${hash}`;
  } catch (_) {
    return fallback;
  }
}

function isHausdeppDestination(destination = returnPath()) {
  if (destination.startsWith("/hausdepp")) return true;
  const target = new URL(destination, window.location.origin);
  return target.pathname === "/auth/continue" && target.searchParams.get("app") === "hausdepp";
}

function setMessage(value, kind = "") {
  message.textContent = value ? t(value) : "";
  message.dataset.kind = kind;
}

function render(auth) {
  const user = auth?.user;
  const dashboardDestination = returnPath() === "/admin/dashboard";
  const hausdeppDestination = isHausdeppDestination();
  if (hausdeppDestination) {
    const messages = HAUSDEPP_MESSAGES[window.ZDWA_I18N?.getLanguage?.() === 'en' ? 'en' : 'de'];
    document.title = messages.signInTitle;
    document.getElementById('zilchLoginTitle').textContent = messages.signInTitle;
    document.querySelector('.zilch-login-intro').textContent = messages.sharedAccountHint;
    const brand = document.querySelector('.zilch-login-brand');
    brand.href = hausdeppAppEntryUrl();
    brand.removeAttribute('data-zilch-path');
    brand.setAttribute('aria-label', 'Hausdepp');
    brand.querySelector('span:last-child').textContent = 'Hausdepp';
    brand.querySelector('.zilch-brand-mark').innerHTML = '<img src="/static/icons/hausdepp-icon-192-v2.png?v=ASSET_VERSION" width="42" height="42" alt="">';
  }
  const access = auth?.game_access || user?.game_access;
  const allowed = dashboardDestination ? Boolean(user) : hausdeppDestination
    ? Boolean(user && (access?.hausdepp_public === true || access?.hausdepp_preview === true)) : user?.game_access?.zilch_preview === true;
  const passkeyAvailable = auth?.passkeys?.enabled && passkeysSupported();
  passkeyPanel.hidden = Boolean(user) || !passkeyAvailable;
  passkeyUnavailable.hidden = Boolean(user) || passkeyAvailable;
  passwordLogin.hidden = Boolean(user);
  passwordFallback.hidden = true;
  if (user) passwordLogin.open = false;
  form.hidden = Boolean(user);
  registrationForm.hidden = Boolean(user);
  registrationController?.render(auth);
  signedIn.hidden = !user;
  if (!user) return;
  accountName.textContent = user.username;
  continueButton.href = returnPath();
  if (dashboardDestination) continueButton.textContent = t("Mission Control öffnen");
  if (hausdeppDestination) continueButton.textContent = t("Hausdepp öffnen");
  continueButton.hidden = !allowed;
  setMessage(hausdeppDestination ? allowed ? "Du bist angemeldet und kannst Hausdepp öffnen." : "Hausdepp ist für dieses Konto nicht verfügbar." : dashboardDestination ? "Du bist angemeldet. Öffne Mission Control." : allowed
    ? "Du bist angemeldet und kannst Zilch öffnen."
    : "Zilch ist für dieses Konto nicht verfügbar.", allowed ? "success" : "info");
}

async function refresh({ redirect = false } = {}) {
  const auth = await loadAuth({ refresh: true });
  // loadAuth schedules a reload when the account language differs. Let that
  // navigation finish before the freshly translated login page continues;
  // competing reload/assign calls can otherwise cancel each other.
  const accountLanguage = auth.user?.preferences?.preferred_language;
  if (accountLanguage && accountLanguage !== document.documentElement.lang) return auth;
  render(auth);
  const destination = returnPath();
  const access = auth?.game_access || auth.user?.game_access;
  const destinationAllowed = isHausdeppDestination(destination)
    ? Boolean(auth.authenticated && (access?.hausdepp_public === true || access?.hausdepp_preview === true))
    : auth.user?.game_access?.zilch_preview === true || (auth.authenticated && destination === "/admin/dashboard");
  if (redirect && destinationAllowed) window.location.assign(destination);
  return auth;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  setMessage("");
  try {
    await login(username.value, password.value);
    password.value = "";
    await refresh({ redirect: true });
  } catch (error) {
    setMessage(error.message || authError(), "error");
  }
});

passwordLogin.addEventListener('toggle', () => {
  if (passwordLogin.open) passwordFallback.hidden = true;
});

passwordFallback.addEventListener('click', () => {
  passwordLogin.open = true;
  username.focus();
  passwordFallback.hidden = true;
});

passkeyButton.addEventListener('click', async () => {
  if (passkeyButton.disabled) return;
  passkeyButton.disabled = true;
  setMessage('');
  passwordFallback.hidden = true;
  try {
    await loginWithPasskey();
    password.value = '';
    await refresh({ redirect: true });
  } catch (error) {
    setMessage(error.message, 'error');
    passwordFallback.hidden = false;
  } finally {
    passkeyButton.disabled = false;
  }
});

registrationController = mountRegistrationForm(registrationForm, {
  onAuthenticated: () => refresh({ redirect: true }),
  onMessage: setMessage,
});

logoutButton.addEventListener("click", async () => {
  try {
    await logout();
    setMessage("Du bist abgemeldet.", "success");
    await refresh();
  } catch (error) {
    setMessage(error.message || authError(), "error");
  }
});

void (async () => {
  try {
    await refresh({ redirect: true });
    const accountOrigin = isHausdeppDestination() ? window.location.origin : isProductionZilchLocation() ? ZDWA_PRODUCTION_ORIGIN : window.location.origin;
    const resetLink = new URL("/passwort-vergessen", accountOrigin);
    resetLink.searchParams.set("app", isHausdeppDestination() ? "hausdepp" : "zilch");
    resetLink.searchParams.set("lang", window.ZDWA_I18N?.getLanguage?.() || "de");
    if (new URLSearchParams(window.location.search).has("return_to")) {
      resetLink.searchParams.set("return_to", isHausdeppDestination()
        ? hausdeppAccountReturnPath(returnPath()) || "/hausdepp" : returnPath());
    }
    forgotPassword.href = resetLink.href;
  } catch {
    setMessage("Der Anmeldestatus konnte nicht geladen werden. Bitte versuche es erneut.", "error");
  }
})();
