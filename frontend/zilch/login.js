import { authError, loadAuth, login, loginWithPasskey, logout, passkeysSupported, register } from "../shared/auth.js";
import {
  applyZilchRouteLinks,
  normalizeZilchPageUrl,
  zdwaAppEntryUrl,
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
const registrationUsername = document.getElementById("zilchRegistrationUsername");
const registrationEmail = document.getElementById("zilchRegistrationEmail");
const registrationPassword = document.getElementById("zilchRegistrationPassword");
const registerButton = document.getElementById("zilchRegisterButton");
const forgotPassword = document.getElementById("zilchForgotPassword");
const message = document.getElementById("zilchLoginMessage");
const challenge = document.getElementById("zilchRegistrationChallenge");
const signedIn = document.getElementById("zilchSignedIn");
const accountName = document.getElementById("zilchLoginAccountName");
const continueButton = document.getElementById("zilchContinueButton");
const logoutButton = document.getElementById("zilchLoginLogout");

const turnstile = { enabled: false, token: null, widgetId: null };

function t(value) {
  return window.ZDWA_I18N?.t?.(value) || String(value || "");
}

function returnPath() {
  const fallback = zilchPath("/");
  const candidate = new URLSearchParams(window.location.search).get("return_to");
  const directZilchPath = normalizeZilchPageUrl(candidate);
  if (directZilchPath) return directZilchPath;

  // A first visit to the Zilch subdomain returns through this one fixed Apex
  // endpoint. Rebuild it from validated pieces so `return_to` can never become
  // an external or arbitrary same-origin redirect after login.
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  try {
    const continuation = new URL(candidate, window.location.origin);
    if (continuation.origin !== window.location.origin
      || continuation.pathname !== "/auth/continue"
      || continuation.searchParams.get("app") !== "zilch") return fallback;
    const requestedPath = continuation.searchParams.get("path") || "/";
    const legacyCandidate = requestedPath === "/" ? "/zilch" : `/zilch${requestedPath}`;
    const validatedLegacyPath = normalizeZilchPageUrl(legacyCandidate);
    if (!validatedLegacyPath) return fallback;
    const validated = new URL(validatedLegacyPath, window.location.origin);
    const cleanRoute = zilchRoutePath(validated.pathname);
    if (!cleanRoute) return fallback;
    const cleanPath = `${cleanRoute}${validated.search}`;
    return `/auth/continue?app=zilch&path=${encodeURIComponent(cleanPath)}`;
  } catch (_) {
    return fallback;
  }
}

function setMessage(value, kind = "") {
  message.textContent = value ? t(value) : "";
  message.dataset.kind = kind;
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
}

async function initializeRegistrationProtection(auth) {
  const config = auth?.registration || {};
  if (!config.turnstile_enabled) return;
  turnstile.enabled = true;
  challenge.hidden = false;
  try {
    await loadTurnstileScript();
    turnstile.widgetId = window.turnstile.render(challenge, {
      sitekey: config.turnstile_site_key,
      action: "register",
      callback: token => { turnstile.token = token; },
      "expired-callback": () => { turnstile.token = null; },
      "error-callback": () => { turnstile.token = null; },
    });
  } catch {
    registerButton.disabled = true;
    setMessage("Registrierung ist momentan nicht verfügbar. Die Anmeldung funktioniert weiterhin.", "error");
  }
}

function resetChallenge() {
  turnstile.token = null;
  if (turnstile.widgetId !== null && window.turnstile) window.turnstile.reset(turnstile.widgetId);
}

function render(auth) {
  const user = auth?.user;
  const allowed = user?.game_access?.zilch_preview === true;
  const passkeyAvailable = auth?.passkeys?.enabled && passkeysSupported();
  passkeyPanel.hidden = Boolean(user) || !passkeyAvailable;
  passkeyUnavailable.hidden = Boolean(user) || passkeyAvailable;
  passwordLogin.hidden = Boolean(user);
  passwordFallback.hidden = true;
  if (user) passwordLogin.open = false;
  form.hidden = Boolean(user);
  registrationForm.hidden = Boolean(user);
  const emailEnabled = auth?.registration?.email_enabled !== false;
  registrationEmail.closest('label').hidden = !emailEnabled;
  registrationEmail.required = emailEnabled;
  registrationPassword.closest('label').hidden = emailEnabled;
  registrationPassword.required = !emailEnabled;
  registrationForm.querySelector('p').textContent = t(emailEnabled ? 'Neues Konto per E-Mail bestätigen' : 'Konto erstellen');
  signedIn.hidden = !user;
  if (!user) return;
  accountName.textContent = user.username;
  continueButton.href = returnPath();
  continueButton.hidden = !allowed;
  setMessage(allowed
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
  if (redirect && auth.user?.game_access?.zilch_preview === true) window.location.assign(returnPath());
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

registrationForm.addEventListener("submit", async event => {
  event.preventDefault();
  setMessage("");
  if (!turnstile.enabled && turnstile.widgetId === null) {
    try {
      await initializeRegistrationProtection(await loadAuth());
    } catch {
      setMessage("Registrierung ist momentan nicht verfügbar. Die Anmeldung funktioniert weiterhin.", "error");
      return;
    }
  }
  if (turnstile.enabled && !turnstile.token) {
    setMessage("Bitte bestätige zuerst, dass du kein Bot bist.", "error");
    return;
  }
  try {
    const result = await register(registrationUsername.value, registrationEmail.value, turnstile.token,
      registrationPassword.required ? registrationPassword.value : null);
    registrationForm.reset();
    if (result.authenticated) await refresh({ redirect: true });
    else setMessage('Wenn diese Adresse noch kein Konto hat, erhältst du einen Bestätigungslink. Öffne ihn, um dein Passwort festzulegen.', 'success');
  } catch (error) {
    setMessage(error.message || authError(), "error");
  } finally {
    resetChallenge();
  }
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
    const entry = zdwaAppEntryUrl();
    forgotPassword.href = `${entry.replace(/\/$/, "")}/passwort-vergessen`;
  } catch {
    setMessage("Der Anmeldestatus konnte nicht geladen werden. Bitte versuche es erneut.", "error");
  }
})();
