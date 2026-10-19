import { apiFetch, loadAuth } from "./auth.js";
import { canUseWebPush, enableGameInvitePush, getGameInvitePushStatus } from "./web-push.js";
import { zdwaPath, zilchPath } from "../multigame/routes.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const PROMPT_DELAY_MS = 1_500;
const DIALOG_RETRY_MS = 2_000;

function settingsUrl(context) {
  if (context === "hausdepp") return "/hausdepp/konto/einstellungen#hausdeppPushSettings";
  const path = context === "zilch" ? zilchPath("/konto") : zdwaPath("/konto");
  const url = new URL(path, window.location.origin);
  url.searchParams.set("push", "1");
  url.hash = "settings";
  return `${url.pathname}${url.search}${url.hash}`;
}

function visibleModalIsOpen() {
  if (window.ZDWA_PWA_INSTALL_BUSY || document.querySelector("[data-pwa-install-hint]")) return true;
  return Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'))
    .some(element => element.getClientRects().length > 0);
}

/**
 * Invite a signed-in lobby visitor to review voluntary Push settings.
 *
 * Permission is never requested during page load.  The only permission call
 * runs inside the primary dialog button's direct click handler; this matters
 * for Safari/iOS and keeps the choice unmistakably deliberate.
 */
export function initializePushOptInPrompt({ context = "zdwa" } = {}) {
  if (window.ZDWA_PUSH_OPT_IN_PROMPT) return window.ZDWA_PUSH_OPT_IN_PROMPT;
  const state = {
    context: ["zilch", "hausdepp"].includes(context) ? context : "zdwa",
    timer: null,
    inFlight: false,
    promptedUserId: null,
    pendingUserId: null,
  };

  const schedule = (delay = PROMPT_DELAY_MS) => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => { void maybePrompt(); }, delay);
  };

  const inviteMessage = status => status.device_subscribed
    ? t("Push ist auf diesem Gerät schon bereit. Wähle jetzt selbst aus, welche Hinweise zu dir passen: Mitspieler-Rufe für freie Plätze, tägliche Spielideen oder Versionshinweise. Mit deiner Spielerauswahl kannst du Mitspieler-Rufe auf bekannte Leute begrenzen.")
    : t("Wenn in einem unserer Spiele ein Platz frei ist, bist du mit einem Tipp dabei. Erlaube Push auf diesem Gerät und wähle danach selbst: Mitspieler-Rufe, tägliche Spielideen oder Versionshinweise. Mit deiner Spielerauswahl kannst du Mitspieler-Rufe auf bekannte Leute begrenzen.");

  async function showPrompt(status, userId) {
    if (state.promptedUserId === userId || document.hidden) return;
    if (!window.ZDWA_UI?.dialog || visibleModalIsOpen() || window.ZDWA_DESIGN_PROMPT?.busy?.()) {
      schedule(DIALOG_RETRY_MS);
      return;
    }
    state.pendingUserId = null;
    state.promptedUserId = userId;
    const destination = settingsUrl(state.context);
    const activateAndOpenSettings = async ({ button }) => {
      // Call this before the first await: its implementation opens the native
      // permission sheet synchronously from this exact user gesture.
      const registration = status.device_subscribed ? null : enableGameInvitePush();
      button.textContent = t(status.device_subscribed ? "Push-Auswahl öffnen …" : "Push wird vorbereitet …");
      try {
        await registration;
      } catch (_) {
        // The account screen explains a denied or unavailable permission and
        // remains the single place where categories are selected.
      }
      window.location.assign(destination);
    };
    await window.ZDWA_UI.dialog({
      id: `push-opt-in-${userId}`,
      title: t("Lust auf eine Runde?"),
      message: inviteMessage(status),
      actions: [
        { id: "later", label: t("Später"), className: "ghost" },
        {
          id: "configure",
          label: t(status.device_subscribed ? "Push-Auswahl öffnen" : "Push zulassen & auswählen"),
          className: "primary",
          onAction: activateAndOpenSettings,
        },
      ],
    });
  }

  async function maybePrompt() {
    if (state.inFlight || document.hidden || !canUseWebPush() || !window.ZDWA_UI?.dialog) return;
    state.inFlight = true;
    try {
      const auth = await loadAuth();
      const userId = auth?.authenticated ? auth.user?.id : null;
      if (state.pendingUserId !== userId) state.pendingUserId = null;
      if (!userId || state.promptedUserId === userId || Notification.permission === "denied") return;
      const status = await getGameInvitePushStatus();
      if (!status.available || !status.browser_supported || status.device_check_failed
          || (status.enabled === true && status.device_subscribed === true) || status.permission === "denied") return;
      if (status.viewer_id != null && status.viewer_id !== userId) return;
      // The one-time design question goes first; claiming now could spend the
      // invitation on a dialog that then has to wait behind it.
      if (visibleModalIsOpen() || window.ZDWA_DESIGN_PROMPT?.busy?.()) {
        schedule(DIALOG_RETRY_MS);
        return;
      }
      if (state.pendingUserId === userId) {
        const current = await loadAuth();
        if (current?.authenticated && current.user?.id === userId && state.pendingUserId === userId) {
          await showPrompt(status, userId);
        }
        return;
      }
      const response = await apiFetch("/api/web-push/opt-in-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Push-Expected-Account-Id": String(userId) },
        body: JSON.stringify({ device_missing: status.device_subscribed !== true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.show !== true) return;
      const current = await loadAuth();
      if (!current?.authenticated || current.user?.id !== userId) return;
      // Keep an authorized invitation while a native sheet, another dialog or
      // a hidden tab delays display. Reclaiming would spend the 14-day cooldown
      // without ever asking. The retry refreshes this device's eligibility.
      state.pendingUserId = userId;
      schedule(0);
    } catch (_) {
      // Push must never disrupt a lobby.  A later lobby visit may retry.
    } finally {
      state.inFlight = false;
    }
  }

  window.addEventListener("zdwa:auth-state", event => {
    const userId = event.detail?.authenticated ? event.detail.user?.id : null;
    if (state.promptedUserId !== userId) state.promptedUserId = null;
    if (state.pendingUserId !== userId) state.pendingUserId = null;
    if (userId) schedule();
  });
  window.addEventListener("online", () => schedule());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
  window.addEventListener("pagehide", () => window.clearTimeout(state.timer), { once: true });

  window.ZDWA_PUSH_OPT_IN_PROMPT = { refresh: () => schedule(0) };
  schedule();
  return window.ZDWA_PUSH_OPT_IN_PROMPT;
}
