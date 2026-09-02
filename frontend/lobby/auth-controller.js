import { loadAuth, login, logout, register } from "../shared/auth.js";
import { dom, storageKeys } from "./context.js";

const turnstileState = {
  enabled: false,
  token: null,
  widgetId: null,
};

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-rollthedice-turnstile]");
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.rollthediceTurnstile = "1";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
}

async function initializeRegistrationProtection() {
  try {
    const auth = await loadAuth();
    const config = auth?.registration || {};
    if (!config.turnstile_enabled) return;
    turnstileState.enabled = true;
    dom.registrationChallenge.hidden = false;
    await loadTurnstileScript();
    turnstileState.widgetId = window.turnstile.render(dom.registrationChallenge, {
      sitekey: config.turnstile_site_key,
      action: "register",
      callback: (token) => { turnstileState.token = token; },
      "expired-callback": () => { turnstileState.token = null; },
      "error-callback": () => { turnstileState.token = null; },
    });
  } catch {
    dom.registerButton.disabled = true;
    dom.loginError.textContent = "Registrierung ist momentan nicht verfügbar. Die Anmeldung funktioniert weiterhin.";
  }
}

function resetRegistrationChallenge() {
  turnstileState.token = null;
  if (turnstileState.widgetId !== null && window.turnstile) {
    window.turnstile.reset(turnstileState.widgetId);
  }
}

async function refreshAuthUi(refresh = false) {
  try {
    const auth = await loadAuth({ refresh });
    const user = auth?.user;
    dom.loginForm.hidden = Boolean(user);
    dom.authActions.hidden = !user;
    dom.authBadge.hidden = !user;
    dom.adminLink.hidden = !user?.is_admin;
    dom.playerSetupCard.classList.toggle("authenticated", Boolean(user));
    dom.playerSectionTitle.hidden = Boolean(user);
    dom.playerNameRow.hidden = Boolean(user);
    if (user) {
      dom.headerAccountLink.href = "/konto";
      dom.authBadge.textContent = user.is_admin ? `${user.username} · Admin` : user.username;
      dom.nameInput.value = user.username;
      dom.nameInput.disabled = true;
      localStorage.setItem(storageKeys.name, user.username);
    } else {
      dom.headerAccountLink.href = "#loginForm";
      dom.nameInput.disabled = false;
      dom.nameInput.value = localStorage.getItem(storageKeys.name) || "";
    }
  } catch {
    dom.loginError.textContent = "Anmeldestatus konnte nicht geladen werden.";
  }
}

export function initializeAuthentication() {
  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    dom.loginError.textContent = "";
    try {
      await login(dom.loginUsername.value, dom.loginPassword.value);
      dom.loginPassword.value = "";
      await refreshAuthUi();
    } catch (error) {
      dom.loginError.textContent = error.message;
      dom.loginError.classList.add("connection-error");
    }
  });

  dom.registerButton.addEventListener("click", async () => {
    dom.loginError.textContent = "";
    if (turnstileState.enabled && !turnstileState.token) {
      dom.loginError.textContent = "Bitte bestätige zuerst, dass du kein Bot bist.";
      return;
    }
    try {
      await register(
        dom.loginUsername.value,
        dom.loginPassword.value,
        turnstileState.token,
      );
      dom.loginPassword.value = "";
      await refreshAuthUi();
    } catch (error) {
      dom.loginError.textContent = error.message;
      dom.loginError.classList.add("connection-error");
    } finally {
      resetRegistrationChallenge();
    }
  });

  dom.logoutButton.addEventListener("click", async () => {
    dom.loginError.textContent = "";
    try {
      await logout();
      await refreshAuthUi(true);
    } catch (error) {
      dom.loginError.textContent = error.message;
    }
  });

  void refreshAuthUi();
  void initializeRegistrationProtection();
}
