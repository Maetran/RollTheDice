import { apiFetch } from "./auth.js";

let lastPushStatus = null;

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

function browserPushAvailable() {
  return Boolean(
    window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window,
  );
}

export async function getGameInvitePushStatus() {
  const response = await apiFetch("/api/web-push/subscription");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data);
  lastPushStatus = {
    ...data,
    browser_supported: browserPushAvailable(),
    permission: "Notification" in window ? Notification.permission : "unsupported",
  };
  return lastPushStatus;
}

export async function enableGameInvitePush() {
  // Settings preload the server configuration. Do not put a network await
  // before the permission prompt: Safari requires this user-click gesture.
  if (!browserPushAvailable()) throw apiError({ detail: "web_push_browser_unsupported" });
  const status = lastPushStatus;
  if (!status?.available) throw apiError({ detail: "web_push_unavailable" });
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") throw apiError({ detail: "web_push_permission_denied" });
  let readyTimeout;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => {
      readyTimeout = window.setTimeout(() => reject(apiError({ detail: "web_push_unavailable" })), 15000);
    }),
  ]).finally(() => window.clearTimeout(readyTimeout));
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(status.public_key),
    });
  }
  const response = await apiFetch("/api/web-push/subscription", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data);
  return data;
}

export async function disableGameInvitePush() {
  // The account-wide opt-out must succeed even if this browser cannot access
  // its worker or no longer permits local subscription operations.
  const response = await apiFetch("/api/web-push/subscription", { method: "DELETE" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(data);
  try {
    if (browserPushAvailable()) {
      const registration = await navigator.serviceWorker.getRegistration();
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

export function webPushErrorMessage(error) {
  const messages = {
    web_push_unavailable: "Push-Benachrichtigungen sind gerade nicht eingerichtet.",
    web_push_browser_unsupported: "Dieser Browser unterstützt keine Push-Benachrichtigungen.",
    web_push_permission_denied: "Die Push-Berechtigung wurde nicht erteilt.",
    web_push_subscription_invalid: "Die Push-Anmeldung konnte nicht gespeichert werden.",
    game_invite_private_room: "Für geschützte Spielräume können keine Einladungen gesendet werden.",
    game_invite_not_waiting: "Diese Partie wartet nicht mehr auf Mitspieler.",
    game_invite_not_player: "Nur Spieler in dieser Partie können eine Einladung senden.",
    game_invite_no_open_seat: "In dieser Partie ist kein Platz mehr frei.",
    game_invite_cooldown: "Für diese Partie wurde gerade erst eine Einladung gesendet.",
    game_invite_account_cooldown: "Du kannst höchstens eine Einladung pro Minute senden – auch über mehrere Spielräume hinweg.",
  };
  return translated(messages[error?.code] || "Push-Benachrichtigungen sind gerade nicht verfügbar.");
}
