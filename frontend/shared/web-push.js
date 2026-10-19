import { apiFetch } from "./auth.js";

let lastPushStatus = null;
let accountGeneration = 0;
const initialAuth = window[Symbol.for("rollthedice.auth-state")]?.cache;
let accountId = initialAuth ? (initialAuth.authenticated ? initialAuth.user?.id : null) : undefined;
window.addEventListener("zdwa:auth-state", event => {
  const next = event.detail?.authenticated ? event.detail.user?.id : null;
  // Another bundle can hydrate our shared auth cache after this module loads.
  // The first identity is checked against the response's viewer_id below.
  if (accountId === undefined) { accountId = next; return; }
  if (next !== accountId) {
    accountId = next;
    accountGeneration += 1;
    lastPushStatus = null;
  }
});

function requireSameAccount(generation) {
  if (generation !== accountGeneration) throw apiError({ detail: "web_push_account_changed" });
}

function accountHeaders(status) {
  return {
    "Content-Type": "application/json",
    ...(status.viewer_id != null ? { "X-Push-Expected-Account-Id": String(status.viewer_id) } : {}),
  };
}

function translated(value) {
  return window.ZDWA_I18N?.t?.(value) || value;
}

function apiError(data, fallback = "Push-Benachrichtigungen sind gerade nicht verfügbar.") {
  const detail = data?.detail;
  const code = typeof detail === "object" && detail ? detail.code : detail;
  const error = new Error(String(code || fallback));
  error.code = String(code || "");
  error.retryAfterSeconds = Number(detail?.retry_after_seconds || 0);
  return error;
}

function applicationServerKey(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function canUseWebPush() {
  return Boolean(
    window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window,
  );
}

export async function getGameInvitePushStatus() {
  const generation = accountGeneration;
  const response = await apiFetch("/api/web-push/subscription");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data);
  requireSameAccount(generation);
  if (data.viewer_id != null) {
    if (accountId !== undefined && accountId !== data.viewer_id) throw apiError({ detail: "web_push_account_changed" });
    accountId = data.viewer_id;
  }
  const status = {
    ...data,
    browser_supported: canUseWebPush(),
    permission: "Notification" in window ? Notification.permission : "unsupported",
    device_subscribed: false,
  };
  // Account preferences and this browser's transport are independent. Reading
  // status never subscribes, transfers an endpoint or undoes an account opt-out.
  try {
    if (status.browser_supported && status.permission === "granted") {
      const registration = await pushRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      requireSameAccount(generation);
      if (subscription) {
        const check = await apiFetch("/api/web-push/subscription/check", {
          method: "POST", headers: accountHeaders(status),
          body: JSON.stringify({ ...subscription.toJSON(), product_context: registrationContext(registration) }),
        });
        const checked = await check.json().catch(() => ({}));
        if (!check.ok) throw apiError(checked);
        requireSameAccount(generation);
        status.device_subscribed = checked.device_subscribed === true;
      }
    }
  } catch (error) {
    requireSameAccount(generation);
    if (error.code === "web_push_account_changed") throw error;
    status.device_check_failed = true;
  }
  requireSameAccount(generation);
  lastPushStatus = status;
  return lastPushStatus;
}

export function devicePushStatusMessage(status) {
  if (status.device_check_failed) return "Die Push-Anmeldung dieses Geräts konnte nicht geprüft werden. Bitte versuche es erneut.";
  if (!status.device_subscribed) return status.subscribed
    ? "Dieses Gerät ist für dieses Spiel noch nicht angemeldet. Melde es für Push an; deine Auswahl bleibt erhalten."
    : "Push-Benachrichtigungen sind ausgeschaltet.";
  return status.enabled
    ? "Push-Benachrichtigungen sind aktiviert."
    : "Push ist für dieses Gerät bereit. Wähle unten aus, wofür du benachrichtigt werden möchtest.";
}

function registrationContext(registration) {
  try {
    const worker = new URL(registration.active.scriptURL, location.href);
    const scope = new URL(registration.scope, location.href);
    if (worker.origin !== location.origin || scope.origin !== location.origin) return null;
    if (worker.pathname === "/hausdepp-sw.js" && scope.pathname === "/hausdepp") return "hausdepp";
    if (scope.pathname !== "/") return null;
    return { "/sw.js": "zdwa", "/zilch-sw.js": "zilch" }[worker.pathname] || null;
  } catch (_) { return null; }
}

function usesHausdeppRegistration() {
  const manifest = document.querySelector('link[rel="manifest"]');
  if (window.HAUSDEPP_PWA || manifest?.dataset.pwaProduct === "hausdepp") return true;
  try {
    return /^\/hausdepp-manifest(?:-en)?\.webmanifest$/.test(new URL(manifest?.href || "", location.href).pathname);
  } catch (_) { return false; }
}

async function pushRegistration({ wait = false } = {}) {
  if (!usesHausdeppRegistration()) {
    const registration = await (wait ? navigator.serviceWorker.ready : navigator.serviceWorker.getRegistration());
    if (registrationContext(registration)) return registration;
    if (!wait) return null;
    throw apiError({ detail: "web_push_unavailable" });
  }
  // Shared account settings sit outside /hausdepp. A fresh installed Hausdepp
  // app has no worker controlling that document, so its `ready` never resolves.
  // Reuse the narrowly scoped registration without widening private caching.
  const deadline = Date.now() + 15_000;
  do {
    const registration = await navigator.serviceWorker.getRegistration("/hausdepp");
    const worker = registration?.active;
    const belongsToHausdepp = registrationContext(registration) === "hausdepp";
    if (belongsToHausdepp && (!wait || worker?.state === "activated")) return registration;
    if (!wait) return null;
    await new Promise(resolve => window.setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw apiError({ detail: "web_push_unavailable" });
}

export async function enableGameInvitePush() {
  // Settings preload the server configuration. Do not put a network await
  // before the permission prompt: Safari requires this user-click gesture.
  if (!canUseWebPush()) throw apiError({ detail: "web_push_browser_unsupported" });
  const status = lastPushStatus;
  if (!status?.available) throw apiError({ detail: "web_push_unavailable" });
  const generation = accountGeneration;
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") throw apiError({ detail: "web_push_permission_denied" });
  requireSameAccount(generation);
  let readyTimeout;
  const registration = await Promise.race([
    pushRegistration({ wait: true }),
    new Promise((_, reject) => {
      readyTimeout = window.setTimeout(() => reject(apiError({ detail: "web_push_unavailable" })), 15000);
    }),
  ]).finally(() => window.clearTimeout(readyTimeout));
  requireSameAccount(generation);
  let subscription = await registration.pushManager.getSubscription();
  requireSameAccount(generation);
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(status.public_key),
    });
  }
  requireSameAccount(generation);
  const response = await apiFetch("/api/web-push/subscription", {
    method: "PUT",
    headers: accountHeaders(status),
    body: JSON.stringify({
      ...subscription.toJSON(),
      product_context: registrationContext(registration),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data);
  requireSameAccount(generation);
  return data;
}

export async function disableGameInvitePush() {
  // The account-wide opt-out must succeed even if this browser cannot access
  // its worker or no longer permits local subscription operations.
  const response = await apiFetch("/api/web-push/subscription", { method: "DELETE" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data);
  try {
    if (canUseWebPush()) {
      const registration = await pushRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    }
  } catch {
    // Delivery has already been disabled and all endpoints removed server-side.
  }
  return data;
}

export async function requestGameInvitePush(gameId) {
  const response = await apiFetch(`/api/games/${encodeURIComponent(gameId)}/notify-open-seat`, {
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data);
  return data;
}

export function syncPushPreferences(form, status) {
  if (!form) return;
  form.hidden = !status.subscribed;
  form.elements.gameInvites.checked = status.game_invites_enabled ?? status.enabled ?? false;
  form.elements.dailyReminder.checked = status.daily_reminder_enabled === true;
  if (form.elements.releaseNotifications) form.elements.releaseNotifications.checked = status.release_notifications_enabled === true;
  const adminHelpSetting = form.querySelector("[data-admin-help-push-setting]");
  if (adminHelpSetting) {
    adminHelpSetting.hidden = status.is_admin !== true;
    form.elements.adminHelp.checked = status.admin_help_enabled !== false;
    form.elements.adminHelp.disabled = adminHelpSetting.hidden;
  }
  const schedule = form.querySelector("[data-push-reminder-schedule]");
  if (schedule) schedule.textContent = translated("Nur wenn du heute noch keines unserer Spiele gespielt hast: höchstens einmal, zufällig zwischen {start} und {end} Uhr (Schweizer Zeit).")
    .replace("{start}", status.daily_reminder_window_start || "17:00")
    .replace("{end}", status.daily_reminder_window_end || "21:00");
}

export function bindPushPreferences(form, refresh) {
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const message = form.querySelector("[data-push-preferences-message]");
    button.disabled = true;
    message.textContent = translated("Push-Einstellung wird gespeichert …");
    try {
      const response = await apiFetch("/api/web-push/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game_invites_enabled: form.elements.gameInvites.checked,
          daily_reminder_enabled: form.elements.dailyReminder.checked,
          ...(form.elements.releaseNotifications ? { release_notifications_enabled: form.elements.releaseNotifications.checked } : {}),
          ...(form.elements.adminHelp && !form.elements.adminHelp.disabled ? { admin_help_enabled: form.elements.adminHelp.checked } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw apiError(data);
      await refresh();
      message.textContent = translated("Push-Auswahl gespeichert.");
    } catch (error) {
      message.textContent = webPushErrorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
}

export function webPushErrorMessage(error) {
  const messages = {
    web_push_unavailable: "Push-Benachrichtigungen sind gerade nicht eingerichtet.",
    web_push_browser_unsupported: "Dieser Browser unterstützt keine Push-Benachrichtigungen.",
    web_push_permission_denied: "Die Push-Berechtigung wurde nicht erteilt.",
    web_push_subscription_invalid: "Die Push-Anmeldung konnte nicht gespeichert werden.",
    web_push_device_required: "Bitte aktiviere zuerst Push auf einem deiner Geräte.",
    web_push_account_changed: "Dein Konto hat sich geändert. Öffne die Push-Einstellungen erneut.",
    push_allowlist_invalid: "Bitte verwende nur bestehende, aktive Benutzernamen und nicht deinen eigenen Namen.",
    push_allowlist_limit: "Du kannst höchstens 100 Spieler auswählen.",
    game_invite_private_room: "Für geschützte Spielräume können keine Einladungen gesendet werden.",
    game_invite_not_waiting: "Diese Partie wartet nicht mehr auf Mitspieler.",
    game_invite_not_player: "Nur Spieler in dieser Partie können eine Einladung senden.",
    game_invite_no_open_seat: "In dieser Partie ist kein Platz mehr frei.",
    game_invite_cooldown: "Für diese Partie wurde gerade erst eine Einladung gesendet.",
    game_invite_account_cooldown: "Du kannst höchstens eine Einladung pro Minute senden – auch über mehrere Spielräume hinweg.",
  };
  return translated(messages[error?.code] || "Push-Benachrichtigungen sind gerade nicht verfügbar.");
}
