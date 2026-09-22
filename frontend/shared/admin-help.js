import { apiFetch, loadAuth } from "./auth.js";
import { zdwaPath, zilchPath } from "../multigame/routes.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const endpoint = "/api/admin-help";
const active = request => request && ["open", "claimed"].includes(request.status);

function roomContext() {
  const match = location.pathname.match(/\/spiel\/([^/]+)(\/zuschauen)?\/?$/);
  return { gameId: match ? decodeURIComponent(match[1]) : "", spectator: Boolean(match?.[2]), canRequest: false };
}

function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function navigationUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    const sameOrigin = url.origin === location.origin;
    const productHost = ["zockdiewandan.online", "zdwa.zockdiewandan.online", "zilch.zockdiewandan.online"].includes(url.hostname);
    return (sameOrigin || productHost && url.protocol === "https:") && ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function errorMessage(error) {
  return t({
    authentication_required: "Bitte melde dich an, um einen Admin zu rufen.",
    admin_help_blocked: "Du kannst derzeit keine Adminhilfe anfordern.",
    admin_help_cooldown: "Bitte warte kurz, bevor du erneut einen Admin rufst.",
    admin_help_not_player: "Adminhilfe kannst du aus deiner eigenen laufenden Partie anfordern.",
    admin_help_game_unavailable: "Diese Partie ist nicht mehr für Adminhilfe verfügbar.",
    admin_help_already_claimed: "Ein anderer Admin kümmert sich bereits um diesen Hilferuf.",
    admin_help_not_found: "Dieser Hilferuf ist nicht mehr verfügbar.",
    admin_help_not_claimed: "Bitte übernimm den Hilferuf zuerst.",
    admin_help_not_assigned: "Bitte übernimm den Hilferuf zuerst.",
    admin_help_already_open: "Dein Hilferuf ist bereits offen. Du kannst weiterspielen.",
    admin_help_resolved: "Dieser Hilferuf wurde bereits abgeschlossen.",
    admin_help_own_request: "Deinen eigenen Hilferuf kann ein anderer Admin übernehmen.",
    admin_help_invalid_origin: "Deine eigene Partie konnte nicht für den Admin-Einsatz pausiert werden.",
    admin_help_admin_busy: "Schließe zuerst deinen aktuellen Hilferuf ab.",
    admin_ban_requires_role_change: "Admin-Konten können nicht über einen Hilferuf gesperrt werden.",
    play_banned: "Dein Konto ist für das Spielen gesperrt. Details findest du im Konto.",
    admin_required: "Admin-Berechtigung erforderlich.",
  }[error?.code] || "Die Adminhilfe ist gerade nicht erreichbar. Bitte versuche es erneut.");
}

async function request(path, body) {
  const response = await apiFetch(`${endpoint}${path}`, {
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("admin_help_unavailable");
    error.code = payload.detail?.code || payload.detail || "admin_help_unavailable";
    throw error;
  }
  return payload;
}

export function initializeAdminHelp() {
  if (window.__adminHelpController) return window.__adminHelpController;
  const state = { auth: null, context: roomContext(), status: null, busy: false, fetching: false, epoch: 0, dismissed: new Set(), stopped: false };
  let banner;
  let bannerSignature = "";
  const isAdmin = () => state.auth?.authenticated && state.auth.user?.is_admin === true;
  const ownRequest = () => state.status?.request || state.status?.own_request;
  const announce = (message, kind = "info") => window.ZDWA_UI?.toast?.(t(message), { kind, duration: 5000 });

  function action(label, handler, className = "small ghost") {
    const button = node("button", t(label), className);
    button.type = "button";
    button.disabled = state.busy;
    button.addEventListener("click", handler);
    return button;
  }

  function returnUrl(help) {
    if (help?.return_url) return navigationUrl(help.return_url);
    if (Object.prototype.hasOwnProperty.call(help || {}, "origin_game_id") && !help.origin_game_id) return null;
    try {
      const saved = JSON.parse(sessionStorage.getItem("rtd_admin_help_return") || "null");
      return saved?.id === help?.id ? navigationUrl(saved.url) : null;
    } catch { return null; }
  }

  async function resolve(help) {
    const outcome = await window.ZDWA_UI?.dialog?.({
      title: t("Hilferuf abschließen"),
      message: t("Wie ist die Hilfe ausgegangen? Versehentliche Hilferufe sind kein Missbrauch."),
      actions: [
        { id: "cancel", label: t("Abbrechen"), className: "ghost" },
        { id: "resolved", label: t("Problem gelöst"), className: "primary" },
        { id: "accidental", label: t("Versehentlich gerufen"), className: "secondary" },
        { id: "misuse", label: t("Missbrauch melden"), className: "danger ghost" },
      ],
    });
    if (!["resolved", "accidental", "misuse"].includes(outcome)) return;
    if (outcome === "misuse" && !await window.ZDWA_UI?.confirm?.({
      title: t("Missbrauch melden"),
      message: t("Melde nur absichtlichen Missbrauch. Ein Versehen zählt nicht dazu. Das sperrt weitere Hilferufe für dieses Konto, bis ein Admin die Sperre aufhebt."),
      confirmLabel: t("Missbrauch melden"),
    })) return;
    await mutate(async () => {
      await request(`/${encodeURIComponent(help.id)}/resolve`, { outcome });
    });
  }

  async function claim(help) {
    await mutate(async () => {
      const result = await request(`/${encodeURIComponent(help.id)}/claim`, {
        ...(state.context.gameId && !state.context.spectator ? { current_game_id: state.context.gameId } : {}),
      });
      const destination = navigationUrl(result.help_url || result.request?.help_url);
      const back = navigationUrl(result.return_url || result.request?.return_url);
      if (back) {
        try { sessionStorage.setItem("rtd_admin_help_return", JSON.stringify({ id: help.id, url: back })); } catch { /* Optional local return hint. */ }
      }
      if (destination) {
        const url = new URL(destination);
        url.searchParams.set("help_request", help.id);
        location.assign(url.href);
      }
      else announce("Hilferuf übernommen.", "success");
    });
  }

  async function returnToGame(help) {
    await mutate(async () => {
      const result = await request(`/${encodeURIComponent(help.id)}/return`, {});
      const destination = navigationUrl(result.return_url) || returnUrl(help);
      if (destination) {
        try { sessionStorage.removeItem("rtd_admin_help_return"); } catch { /* Optional local return hint. */ }
        location.assign(destination);
      }
    });
  }

  function renderBanner() {
    const header = document.querySelector(".room-header, .zilch-header, .app-nav");
    if (!header) return;
    const claims = (Array.isArray(state.status?.requests) ? state.status.requests : [])
      .filter(item => Number(item.requester_user_id ?? item.requester?.id) !== Number(state.auth?.user?.id));
    const returning = isAdmin() && !state.status?.active_claim && state.status?.return_to_game;
    const query = new URLSearchParams(location.search);
    const helpId = query.get("help_request") || query.get("admin_help");
    const selected = isAdmin() && (state.status?.active_claim || claims.find(item => String(item.id) === helpId)
      || claims.find(item => active(item) && !state.dismissed.has(String(item.id))));
    const own = ownRequest();
    const ownActive = !selected && active(own);
    if (!selected && !ownActive && !returning) { banner?.remove(); banner = null; bannerSignature = ""; return; }
    if (!banner) {
      banner = node("aside", "", "admin-help-bar");
      banner.setAttribute("aria-label", t("Adminhilfe"));
      header.after(banner);
    }
    const signature = JSON.stringify([selected, own, returning, state.busy, state.context.gameId, claims.filter(item => item.status === "open").length, document.documentElement.lang]);
    if (signature === bannerSignature) return;
    bannerSignature = signature;
    const message = node("span", "", "admin-help-bar__message");
    message.setAttribute("role", "status");
    const buttons = node("div", "", "admin-help-bar__actions");
    if (returning) {
      message.textContent = t("Deine Partie wartet auf dich.");
      buttons.append(action("Zur eigenen Partie", () => returnToGame({ id: returning.request_id, return_url: returning.url }), "small primary"));
    } else if (selected) {
      const claimedByMe = Number(selected.claimed_by?.id) === Number(state.auth?.user?.id);
      const requester = selected.requester?.username || t("Spieler");
      const game = selected.game_type === "zilch" ? "Zilch" : "ZDWA";
      message.textContent = `${requester} · ${game} · ${t(selected.status === "claimed" ? "Adminhilfe läuft" : "braucht Hilfe")}`;
      const pending = claims.filter(item => item.status === "open").length;
      if (pending > 1) message.append(` (${pending} ${t("offene Hilferufe")})`);
      if (selected.status === "open") buttons.append(action("Übernehmen", () => claim(selected), "small primary"));
      else if (claimedByMe && active(selected)) {
        const here = helpId === String(selected.id) && state.context.gameId === selected.game_id;
        // Reclaim also pauses a game the admin has resumed since this request.
        if (!here) buttons.append(action("Zur Hilfe", () => claim(selected)));
        buttons.append(action("Abschließen", () => resolve(selected), "small primary"));
      }
      const back = returnUrl(selected);
      if (claimedByMe && (back || selected.origin_game_id)) buttons.append(action("Zur eigenen Partie", () => returnToGame(selected)));
      if (!claimedByMe) {
        const close = action("Hinweis schließen", () => { state.dismissed.add(String(selected.id)); renderBanner(); }, "admin-help-bar__close");
        close.textContent = "×";
        close.setAttribute("aria-label", t("Hinweis schließen"));
        buttons.append(close);
      }
    } else {
      message.textContent = t(own.status === "claimed" ? "Ein Admin kümmert sich um deine Anfrage." : "Dein Hilferuf ist offen. Du kannst weiterspielen.");
    }
    banner.replaceChildren(message, buttons);
  }

  function renderControls() {
    const pending = active(ownRequest());
    for (const button of document.querySelectorAll("[data-admin-help-call]")) {
      button.hidden = !state.context.gameId || state.context.spectator || !state.context.canRequest;
      button.disabled = state.busy || pending;
      const label = button.querySelector("[data-admin-help-label]") || button;
      label.textContent = t(pending ? "Admin ist informiert" : "Admin rufen");
      button.setAttribute("aria-label", label.textContent);
      button.title = label.textContent;
    }
    renderBanner();
  }

  async function refresh() {
    if (state.fetching || state.stopped || document.hidden || !state.auth?.authenticated) return;
    if (!isAdmin() && !state.context.gameId) return;
    state.fetching = true;
    const epoch = state.epoch;
    try {
      const query = state.context.gameId ? `?game_id=${encodeURIComponent(state.context.gameId)}` : "";
      const status = await request(`/status${query}`);
      if (epoch === state.epoch) { state.status = status; renderControls(); }
    } catch { /* Keep useful state through temporary network failures. */ }
    finally { state.fetching = false; }
  }

  async function mutate(task) {
    if (state.busy) return;
    state.busy = true;
    renderControls();
    try { await task(); }
    catch (error) { announce(errorMessage(error), "error"); }
    finally { state.busy = false; await refresh(); renderControls(); }
  }

  async function callAdmin() {
    if (!state.context.canRequest || state.context.spectator) return;
    if (!state.auth?.authenticated) {
      const answer = await window.ZDWA_UI?.dialog?.({
        title: t("Adminhilfe mit Spielerkonto"), message: t("Bitte melde dich an, um einen Admin zu rufen."),
        actions: [{ id: "cancel", label: t("Abbrechen"), className: "ghost" }, { id: "login", label: t("Anmelden"), className: "primary" }],
      });
      if (answer === "login") location.assign(document.documentElement.dataset.game === "zilch"
        ? `${zilchPath("/anmelden")}?return_to=${encodeURIComponent(location.pathname)}` : `${zdwaPath("/")}#accountLogin`);
      return;
    }
    if (state.status?.blocked) { announce("Du kannst derzeit keine Adminhilfe anfordern.", "error"); return; }
    await mutate(async () => {
      const result = await request("", { game_id: state.context.gameId });
      state.status = { ...state.status, request: result.request || result };
    });
  }

  function authChanged(auth) {
    if (state.auth?.user?.id !== auth?.user?.id) {
      state.epoch += 1;
      state.status = null;
      state.dismissed.clear();
    }
    state.auth = auth;
    renderAccountBans(document.querySelector("[data-account-bans]"), auth?.user);
    renderControls();
    void refresh();
  }

  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest("[data-admin-help-call]")) void callAdmin();
  });
  window.addEventListener("zdwa:auth-state", event => authChanged(event.detail));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  window.addEventListener("focus", () => { void refresh(); });
  const timer = window.setInterval(refresh, 10_000);
  window.addEventListener("pagehide", () => { state.stopped = true; window.clearInterval(timer); }, { once: true });
  const controller = {
    refresh,
    renderAccountBans: user => renderAccountBans(document.querySelector("[data-account-bans]"), user || state.auth?.user),
    setGame(context) {
      const changed = context.gameId !== state.context.gameId;
      state.context = { ...state.context, ...context };
      if (changed) { state.epoch += 1; state.status = null; void refresh(); }
      renderControls();
    },
  };
  window.__adminHelpController = controller;
  loadAuth().then(authChanged).catch(() => authChanged({ authenticated: false }));
  return controller;
}

export function setAdminHelpGameContext(context) {
  initializeAdminHelp().setGame(context);
}

export function renderAccountBans(container, user) {
  if (!container) return;
  const bans = Array.isArray(user?.bans) ? user.bans : [];
  container.hidden = bans.length === 0;
  container.replaceChildren();
  for (const ban of bans) {
    const item = node("p", "", "admin-help-account-ban");
    const label = t(ban.scope === "play" ? "Spielen gesperrt" : "Adminhilfe gesperrt");
    const expiry = ban.expires_at ? new Date(ban.expires_at) : null;
    const until = expiry && Number.isFinite(expiry.getTime())
      ? `${t("Bis")} ${new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-GB" : "de-CH", { dateStyle: "medium", timeStyle: "short" }).format(expiry)}`
      : t("Dauerhaft");
    const reason = ban.reason === "admin_help_misuse" ? t("Missbrauch der Adminhilfe") : String(ban.reason || "");
    item.append(node("strong", label), ` · ${until}${reason ? ` · ${t("Grund")}: ${reason}` : ""}`);
    container.append(item);
  }
}
