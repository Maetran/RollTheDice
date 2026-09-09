import { loadAuth, login, logout, playerNameMarkup, register } from "../shared/auth.js";
import { zdwaPath } from "../multigame/routes.js";
import { dom, storageKeys } from "./context.js";

const turnstileState = {
  enabled: false,
  token: null,
  widgetId: null,
  scriptPromise: null,
  initializationPromise: null,
  registering: false,
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
  if (turnstileState.widgetId !== null) return Promise.resolve();
  if (turnstileState.initializationPromise) return turnstileState.initializationPromise;
  turnstileState.initializationPromise = (async () => {
    const auth = await loadAuth();
    const config = auth?.registration || {};
    if (typeof config.turnstile_enabled !== "boolean"
      || (config.turnstile_enabled && (typeof config.turnstile_site_key !== "string" || !config.turnstile_site_key.trim()))) {
      throw new Error("Die Sicherheitsprüfung ist momentan nicht erreichbar. Bitte versuche es später erneut.");
    }
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
      "timeout-callback": () => { turnstileState.token = null; },
    });
  })().finally(() => {
    turnstileState.initializationPromise = null;
  });
  return turnstileState.initializationPromise;
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
      dom.headerAccountLink.href = zdwaPath("/konto");
      dom.authBadge.innerHTML = `${playerNameMarkup(user, { compactRank: true })}${user.is_admin ? ' <span class="badge">Admin</span>' : ''}`;
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
  // Account intent starts the optional registration challenge. Guest play and
  // the first lobby paint do not need to download or execute Turnstile.
  for (const input of [dom.loginUsername, dom.loginPassword]) {
    input.addEventListener("focus", () => {
      void initializeRegistrationProtection().catch(() => {
        dom.loginError.textContent = "Die Sicherheitsprüfung ist momentan nicht erreichbar. Bitte versuche es später erneut.";
      });
    });
  }

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
    if (turnstileState.registering) return;
    turnstileState.registering = true;
    dom.registerButton.disabled = true;
    dom.loginError.textContent = "";
    try {
      try {
        // Even a click before /auth/me completes must wait for its protection
        // configuration; unknown or unavailable configuration fails closed.
        await initializeRegistrationProtection();
      } catch {
        dom.loginError.textContent = "Die Sicherheitsprüfung ist momentan nicht erreichbar. Bitte versuche es später erneut.";
        return;
      }
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
