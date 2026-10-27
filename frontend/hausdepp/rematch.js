import { apiFetch } from "../shared/auth.js";

const validId = value => typeof value === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(value);
const room = data => {
  if (!validId(data?.game_id)) throw new Error("hausdepp_rematch_unavailable");
  return `/hausdepp/spiel/${encodeURIComponent(data.game_id)}`;
};

async function request(path, { method = "GET", signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 20_000);
  try {
    const response = await apiFetch(path, { method, cache: "no-store", signal: controller.signal,
      ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (controller.signal.aborted) throw new DOMException("Request aborted", "AbortError");
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : data.detail?.code || "hausdepp_rematch_failed");
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export function rematchError(error, t) {
  return t(/closed|expired|unavailable|not_found|not_waiting|not_participant|full|declined|finished|not_finished/.test(error?.message || "")
    ? "rematchUnavailable" : "rematchFailed");
}

export async function createRematch(sourceId, { signal } = {}) {
  if (!validId(sourceId)) throw new Error("hausdepp_rematch_unavailable");
  let data = await request(`/api/hausdepp/games/${encodeURIComponent(sourceId)}/rematch`, { method: "POST", signal });
  if (data.requires_acceptance) {
    if (!validId(data.invitation_id)) throw new Error("hausdepp_rematch_unavailable");
    // Clicking Create again is this player's explicit request for a new seat.
    data = await request(`/api/hausdepp/invitations/${encodeURIComponent(data.invitation_id)}/accept`, { method: "POST", signal });
  }
  return room(data);
}

/** Direct, account-bound invitations. Opening the prompt never joins a table. */
export function mountRematchInvitations({ userId, t, canPresent = () => true, navigate = path => location.assign(path) }) {
  let destroyed = false, reading = false, presenting = false, timer, activeId, activeInvitation, interrupted = false;
  let pending = [];
  const snoozed = new Map();
  const controller = new AbortController();
  const blocked = () => document.hidden || !canPresent() || !window.ZDWA_UI?.dialog
    || Boolean(document.querySelector('[data-game-tour], .game-tour-entry, dialog[open]'));
  const usable = invitation => validId(invitation?.id) && validId(invitation?.game_id)
    && Number.isFinite(Date.parse(invitation.expires_at)) && Date.parse(invitation.expires_at) > Date.now();
  const pause = () => {
    if (activeId) { interrupted = true; window.ZDWA_UI?.dismiss?.(activeId); }
  };
  const later = () => {
    clearTimeout(timer);
    if (!destroyed) timer = setTimeout(() => { void poll(); }, 5_000);
  };

  async function prompt(invitation) {
    if (destroyed || blocked() || !usable(invitation)) return;
    interrupted = false;
    activeInvitation = invitation.id;
    activeId = `hausdepp-invitation-${invitation.id}`;
    let errorElement, acted = false;
    const options = {
      id: activeId, kind: "hausdepp-rematch", title: t("rematchInvitationTitle"),
      message: t("rematchInvitationConsent", { time: "…" }), dismissible: true,
      onOpen: ({ message }) => {
        message.replaceChildren();
        const line = (text, className = "") => {
          const node = document.createElement("p"); node.textContent = text; node.className = className; message.append(node); return node;
        };
        line(t("rematchInvitationBody", { name: invitation.sender?.username || t("rematchSenderFallback"), table: invitation.name || "Hausdepp" }));
        line(t("rematchParameters", { players: invitation.players, cpus: invitation.cpu_count,
          format: t(invitation.tournament ? "tournament" : "singleRound") }), "hd-fine");
        if (invitation.four_of_a_kind_as_ten === true) line(t("fourKindRuleLabel"), "hd-fine");
        const time = new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-GB" : "de-CH", { timeStyle: "short" }).format(new Date(invitation.expires_at));
        line(t("rematchInvitationConsent", { time }));
        if (invitation.locked) line(t("rematchPrivateHint"), "hd-fine");
        errorElement = line(""); errorElement.setAttribute("role", "alert"); errorElement.hidden = true;
      },
    };
    const action = type => async ({ dialog }) => {
      options.dismissible = false;
      const buttons = [...dialog.querySelectorAll("button")];
      buttons.forEach(button => { button.disabled = true; });
      try {
        const data = await request(`/api/hausdepp/invitations/${encodeURIComponent(invitation.id)}/${type}`, { method: "POST", signal: controller.signal });
        acted = true;
        pending = pending.filter(item => item.id !== invitation.id);
        if (type === "accept" && !destroyed) navigate(room(data), {
          sourceGameId: data.source_game_id || invitation.source_game_id,
        });
      } catch (error) {
        if (errorElement?.isConnected) { errorElement.textContent = rematchError(error, t); errorElement.hidden = false; }
        options.dismissible = true;
        buttons.forEach(button => { button.disabled = false; });
        throw error;
      }
    };
    options.actions = [
      { id: "decline", label: t("rematchDecline"), className: "ghost", onAction: action("decline") },
      { id: "accept", label: t("rematchAccept"), className: "primary", onAction: action("accept") },
    ];
    await window.ZDWA_UI.dialog(options);
    if (!acted && !interrupted) snoozed.set(invitation.id, Date.now() + 5 * 60_000);
    activeId = null; activeInvitation = null;
  }

  async function show() {
    if (destroyed || presenting || blocked()) return;
    const next = pending.find(item => usable(item) && (snoozed.get(item.id) || 0) <= Date.now());
    if (!next) return;
    presenting = true;
    try {
      const underLock = async () => {
        const data = await request("/api/hausdepp/invitations", { signal: controller.signal });
        const fresh = data.invitations?.find(item => item.id === next.id);
        if (fresh) await prompt(fresh);
      };
      if (navigator.locks?.request) await navigator.locks.request(`hausdepp-invitations-${userId}`, { ifAvailable: true }, async lock => { if (lock) await underLock(); });
      else await underLock();
    } catch { /* Leave the server invitation pending for the next safe entry. */ }
    finally { presenting = false; }
  }

  async function poll() {
    if (destroyed || reading || document.hidden) { later(); return; }
    reading = true;
    try {
      const data = await request("/api/hausdepp/invitations", { signal: controller.signal });
      if (destroyed) return;
      pending = Array.isArray(data.invitations) ? data.invitations.filter(usable).slice(0, 16) : [];
      if (activeInvitation && !pending.some(item => item.id === activeInvitation)) pause();
      void show();
    } catch { /* Invitations are optional; network failure never blocks play. */ }
    finally { reading = false; later(); }
  }
  const refresh = () => { if (!destroyed) { if (activeId && blocked()) pause(); void show(); } };
  const visibility = () => { if (document.hidden) pause(); else void poll(); };
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "data-phase"] });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", visibility);
  void poll();
  return { refresh(invitation) {
    if (destroyed) return;
    if (usable(invitation) && !pending.some(item => item.id === invitation.id)) pending.unshift(invitation);
    refresh();
    void poll();
  }, destroy() {
    destroyed = true; controller.abort(); pause(); clearTimeout(timer); observer.disconnect();
    document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", visibility);
  } };
}
