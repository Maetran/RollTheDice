import { authError, loadAuth, login, logout, register } from "../shared/auth.js";

const form = document.getElementById("zilchLoginForm");
const username = document.getElementById("zilchLoginUsername");
const password = document.getElementById("zilchLoginPassword");
const registerButton = document.getElementById("zilchRegisterButton");
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
  const candidate = new URLSearchParams(window.location.search).get("return_to") || "/zilch";
  if (!candidate.startsWith("/zilch") || candidate.startsWith("/zilch/anmelden") || candidate.startsWith("//")) return "/zilch";
  return candidate;
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
  form.hidden = Boolean(user);
  signedIn.hidden = !user;
  if (!user) return;
  accountName.textContent = user.username;
  continueButton.href = returnPath();
  continueButton.hidden = !allowed;
  setMessage(allowed
    ? "Du bist angemeldet und kannst Zilch öffnen."
    : "Dein Konto ist angemeldet. Zilch ist derzeit nur für eingeladene Testpersonen freigeschaltet.", allowed ? "success" : "info");
}

async function refresh({ redirect = false } = {}) {
  const auth = await loadAuth({ refresh: true });
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

registerButton.addEventListener("click", async () => {
  setMessage("");
  if (turnstile.enabled && !turnstile.token) {
    setMessage("Bitte bestätige zuerst, dass du kein Bot bist.", "error");
    return;
  }
  try {
    await register(username.value, password.value, turnstile.token);
    password.value = "";
    await refresh({ redirect: true });
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
    const auth = await refresh();
    await initializeRegistrationProtection(auth);
  } catch {
    setMessage("Der Anmeldestatus konnte nicht geladen werden. Bitte versuche es erneut.", "error");
  }
})();
