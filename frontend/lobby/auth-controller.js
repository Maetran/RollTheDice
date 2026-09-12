import { loadAuth, login, loginWithPasskey, logout, mountPasskeyPrompt, passkeysSupported, playerNameMarkup, register } from "../shared/auth.js";
import { zdwaPath } from "../multigame/routes.js";
import { dom, storageKeys } from "./context.js";

const turnstileState = {
  enabled: false,
  token: null,
  widgetId: null,
  scriptPromise: null,
  cancelScript: null,
  initializationPromise: null,
  registering: false,
  authenticated: false,
  epoch: 0,
};

function loadTurnstileScript() {
  if (typeof window.turnstile?.render === "function") return Promise.resolve();
  if (turnstileState.scriptPromise) return turnstileState.scriptPromise;
  turnstileState.scriptPromise = new Promise((resolve, reject) => {
    const script = document.querySelector("script[data-rollthedice-turnstile]")
      || document.createElement("script");
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
      if (turnstileState.cancelScript === failed) turnstileState.cancelScript = null;
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("Die Sicherheitsprüfung ist momentan nicht erreichbar. Bitte versuche es später erneut."));
    };
    const loaded = () => {
      if (typeof window.turnstile?.render !== "function") {
        failed();
        return;
      }
      cleanup();
      resolve();
    };
    const timeout = window.setTimeout(failed, 15000);
    turnstileState.cancelScript = failed;
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (script.isConnected) return;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.rollthediceTurnstile = "1";
    document.head.appendChild(script);
  }).catch((error) => {
    // A failed request must not permanently block registration for this page.
    turnstileState.scriptPromise = null;
    throw error;
  });
  return turnstileState.scriptPromise;
}

function initializeRegistrationProtection() {
  if (turnstileState.authenticated) return Promise.resolve(false);
  if (turnstileState.widgetId !== null) return Promise.resolve(true);
  if (turnstileState.initializationPromise) return turnstileState.initializationPromise;
  const epoch = turnstileState.epoch;
  const isCurrent = () => epoch === turnstileState.epoch && !turnstileState.authenticated;
  const request = (async () => {
    const auth = await loadAuth();
    if (!isCurrent() || auth?.authenticated || auth?.user) return false;
    const config = auth?.registration || {};
    if (typeof config.turnstile_enabled !== "boolean"
      || (config.turnstile_enabled && (typeof config.turnstile_site_key !== "string" || !config.turnstile_site_key.trim()))) {
      throw new Error("Die Sicherheitsprüfung ist momentan nicht erreichbar. Bitte versuche es später erneut.");
    }
    if (!config.turnstile_enabled) return true;
    turnstileState.enabled = true;
    dom.registrationChallenge.hidden = false;
    await loadTurnstileScript();
    if (!isCurrent()) return false;
    turnstileState.widgetId = window.turnstile.render(dom.registrationChallenge, {
      sitekey: config.turnstile_site_key,
      action: "register",
      callback: (token) => { if (isCurrent()) turnstileState.token = token; },
      "expired-callback": () => { if (isCurrent()) turnstileState.token = null; },
      "error-callback": () => { if (isCurrent()) turnstileState.token = null; },
      "timeout-callback": () => { if (isCurrent()) turnstileState.token = null; },
    });
    return true;
  })().catch((error) => {
    if (!isCurrent()) return false;
    throw error;
  }).finally(() => {
    if (turnstileState.initializationPromise === request) turnstileState.initializationPromise = null;
  });
  turnstileState.initializationPromise = request;
  return request;
}

function discardRegistrationProtection() {
  // A login can finish while /me, the script or a widget callback is pending.
  // Invalidate all of them before removing the widget; never reset a hidden
  // challenge and accidentally start another round of background work.
  turnstileState.epoch += 1;
  turnstileState.token = null;
  turnstileState.enabled = false;
  turnstileState.cancelScript?.();
  if (turnstileState.widgetId !== null) window.turnstile?.remove(turnstileState.widgetId);
  turnstileState.widgetId = null;
  dom.registrationChallenge.replaceChildren();
  dom.registrationChallenge.hidden = true;
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
    const passkeyAvailable = auth?.passkeys?.enabled && passkeysSupported();
    dom.passkeyLogin.hidden = Boolean(user) || !passkeyAvailable;
    dom.passkeyUnavailable.hidden = Boolean(user) || passkeyAvailable;
    dom.passwordLogin.hidden = Boolean(user);
    dom.passwordLoginFallback.hidden = true;
    if (user) dom.passwordLogin.open = false;
    dom.loginForm.hidden = Boolean(user);
    dom.registrationForm.hidden = Boolean(user);
    const emailEnabled = auth?.registration?.email_enabled !== false;
    dom.registrationEmail.closest('label').hidden = !emailEnabled;
    dom.registrationEmail.required = emailEnabled;
    dom.registrationPassword.closest('label').hidden = emailEnabled;
    dom.registrationPassword.required = !emailEnabled;
    dom.registerButton.textContent = emailEnabled ? 'Konto per E-Mail erstellen' : 'Konto erstellen';
    dom.authActions.hidden = !user;
    dom.authBadge.hidden = !user;
    dom.adminLink.hidden = !user?.is_admin;
    dom.playerSetupCard.classList.toggle("authenticated", Boolean(user));
    dom.playerSectionTitle.hidden = Boolean(user);
    dom.playerNameRow.hidden = Boolean(user);
    if (user) {
      dom.headerAccountLink.href = zdwaPath("/konto");
      dom.authBadge.innerHTML = `${playerNameMarkup(user, { compactRank: true })}${user.is_admin ? ' <span class="badge">Admin</span>' : ''}`;
      dom.nameInput.value = user.username;
      dom.nameInput.disabled = true;
      localStorage.setItem(storageKeys.name, user.username);
    } else {
      dom.headerAccountLink.href = "#accountLogin";
      dom.nameInput.disabled = false;
      dom.nameInput.value = localStorage.getItem(storageKeys.name) || "";
    }
    mountPasskeyPrompt(dom.passkeyPrompt, { auth, accountUrl: zdwaPath('/konto?passkey=1#settings') });
  } catch {
    dom.loginError.textContent = "Anmeldestatus konnte nicht geladen werden.";
  }
}

export function initializeAuthentication() {
  dom.passwordLogin.addEventListener('toggle', () => {
    if (dom.passwordLogin.open) dom.passwordLoginFallback.hidden = true;
  });
  dom.passwordLoginFallback.addEventListener('click', () => {
    dom.passwordLogin.open = true;
    dom.loginUsername.focus();
    dom.passwordLoginFallback.hidden = true;
  });
  dom.passkeyLoginButton.addEventListener('click', async () => {
    if (dom.passkeyLoginButton.disabled) return;
    dom.passkeyLoginButton.disabled = true;
    dom.loginError.textContent = '';
    dom.passwordLoginFallback.hidden = true;
    try {
      await loginWithPasskey();
      dom.loginPassword.value = '';
      await refreshAuthUi(true);
    } catch (error) {
      dom.loginError.textContent = error.message;
      dom.passwordLoginFallback.hidden = false;
    } finally {
      dom.passkeyLoginButton.disabled = false;
    }
  });
  // Only explicit registration needs CAPTCHA. Login-field focus may be
  // restored by the browser before /me reveals an existing signed-in user.
  window.addEventListener("zdwa:auth-state", (event) => {
    turnstileState.authenticated = Boolean(event.detail?.authenticated || event.detail?.user);
    if (turnstileState.authenticated) discardRegistrationProtection();
  });

  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    dom.loginError.textContent = "";
    try {
      await login(dom.loginUsername.value, dom.loginPassword.value);
      dom.loginPassword.value = "";
      await refreshAuthUi(true);
    } catch (error) {
      dom.loginError.textContent = error.message;
      dom.loginError.classList.add("connection-error");
    }
  });

  dom.registrationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (turnstileState.registering) return;
    turnstileState.registering = true;
    dom.registerButton.disabled = true;
    dom.loginError.textContent = "";
    try {
      try {
        // Even a click before /auth/me completes must wait for its protection
        // configuration; unknown or unavailable configuration fails closed.
        if (!await initializeRegistrationProtection()) return;
      } catch {
        dom.loginError.textContent = "Die Sicherheitsprüfung ist momentan nicht erreichbar. Bitte versuche es später erneut.";
        return;
      }
      if (turnstileState.enabled && !turnstileState.token) {
        dom.loginError.textContent = "Bitte bestätige zuerst, dass du kein Bot bist.";
        return;
      }
      try {
        const result = await register(
          dom.registrationUsername.value,
          dom.registrationEmail.value,
          turnstileState.token,
          dom.registrationPassword.required ? dom.registrationPassword.value : null,
        );
        dom.registrationForm.reset();
        if (result.authenticated) {
          await refreshAuthUi(true);
        } else {
          dom.loginError.textContent = 'Wenn diese Adresse noch kein Konto hat, erhältst du einen Bestätigungslink. Öffne ihn, um dein Passwort festzulegen.';
        }
      } finally {
        // Tokens are single-use, including a rejected registration attempt.
        resetRegistrationChallenge();
      }
    } catch (error) {
      dom.loginError.textContent = error.message;
      dom.loginError.classList.add("connection-error");
    } finally {
      turnstileState.registering = false;
      dom.registerButton.disabled = false;
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
}
