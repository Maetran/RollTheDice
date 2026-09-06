import { apiFetch, loadAuth } from "./auth.js";
import { canUseWebPush, enableGameInvitePush, getGameInvitePushStatus } from "./web-push.js";
import { zdwaPath, zilchPath } from "../multigame/routes.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const PROMPT_DELAY_MS = 1_500;
const DIALOG_RETRY_MS = 2_000;

function settingsUrl(context) {
  const path = context === "zilch" ? zilchPath("/konto") : zdwaPath("/konto");
  const url = new URL(path, window.location.origin);
  url.searchParams.set("push", "1");
  url.hash = "settings";
  return `${url.pathname}${url.search}${url.hash}`;
}

function visibleModalIsOpen() {
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
    context: context === "zilch" ? "zilch" : "zdwa",
    timer: null,
    inFlight: false,
    promptedUserId: null,
  };

  const schedule = (delay = PROMPT_DELAY_MS) => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => { void maybePrompt(); }, delay);
  };

  const inviteMessage = status => status.subscribed
    ? t("Push ist auf diesem Gerät schon bereit. Wähle jetzt selbst aus, welche Hinweise zu dir passen: Mitspieler-Rufe für freie Plätze, tägliche Spielideen oder Versionshinweise. Mit deiner Spielerauswahl kannst du Mitspieler-Rufe auf bekannte Leute begrenzen.")
    : t("Wenn in ZDWA oder Zilch ein Platz frei ist, bist du mit einem Tipp dabei. Erlaube Push auf diesem Gerät und wähle danach selbst: Mitspieler-Rufe, tägliche Spielideen oder Versionshinweise. Mit deiner Spielerauswahl kannst du Mitspieler-Rufe auf bekannte Leute begrenzen.");

  async function showPrompt(status, userId) {
    if (state.promptedUserId === userId) return;
    if (!window.ZDWA_UI?.dialog || visibleModalIsOpen()) {
      schedule(DIALOG_RETRY_MS);
      return;
    }
    state.promptedUserId = userId;
    const destination = settingsUrl(state.context);
    const activateAndOpenSettings = async ({ button }) => {
      // Call this before the first await: its implementation opens the native
      // permission sheet synchronously from this exact user gesture.
      const registration = status.subscribed ? null : enableGameInvitePush();
      button.textContent = t(status.subscribed ? "Push-Auswahl öffnen …" : "Push wird vorbereitet …");
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
          label: t(status.subscribed ? "Push-Auswahl öffnen" : "Push zulassen & auswählen"),
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
      if (!userId || state.promptedUserId === userId || Notification.permission === "denied") return;
      const status = await getGameInvitePushStatus();
      if (!status.available || !status.browser_supported || status.enabled === true || status.permission === "denied") return;
      if (visibleModalIsOpen()) {
        schedule(DIALOG_RETRY_MS);
        return;
      }
      const response = await apiFetch("/api/web-push/opt-in-prompt", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.show !== true || document.hidden) return;
      await showPrompt(status, userId);
    } catch (_) {
      // Push must never disrupt a lobby.  A later lobby visit may retry.
    } finally {
      state.inFlight = false;
    }
  }

  window.addEventListener("zdwa:auth-state", event => {
    const userId = event.detail?.authenticated ? event.detail.user?.id : null;
    if (state.promptedUserId !== userId) state.promptedUserId = null;
    if (userId) schedule();
  });
  window.addEventListener("online", () => schedule());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
  window.addEventListener("pagehide", () => window.clearTimeout(state.timer), { once: true });

  window.ZDWA_PUSH_OPT_IN_PROMPT = { refresh: () => schedule(0) };
  schedule();
  return window.ZDWA_PUSH_OPT_IN_PROMPT;
}
