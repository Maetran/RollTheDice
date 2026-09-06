import { apiFetch, loadAuth } from "./auth.js";
import { zdwaPath, zilchPath } from "../multigame/routes.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const endpoint = "/api/friend-activity/preferences";
const maxNotices = 3;
const ttlMs = 60_000;

function socketUrl() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws/friend-activity`;
}

function currentGameRoom() {
  return /(?:^|\/)spiel\/[^/]+(?:\/zuschauen)?\/?$/.test(location.pathname);
}

function spectatorUrl(game) {
  const id = String(game.game_id || "");
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) return null;
  return game.game_type === "zilch"
    ? zilchPath(`/spiel/${encodeURIComponent(id)}/zuschauen`)
    : zdwaPath(`/spiel/${encodeURIComponent(id)}/zuschauen`);
}

function gameText(game) {
  const players = Math.max(1, Number(game.player_count) || 1);
  const type = game.game_type === "zilch" ? "Zilch" : "ZDWA";
  const typeText = game.game_type === "zilch" ? "Zilch" : "ZDWA";
  const playerText = `${players} ${t(players === 1 ? "Spieler" : "Spielerinnen und Spieler")}`;
  const mode = game.hardcore ? `, ${t("Hardcore")}` : "";
  return { type, typeText, playerText, mode };
}

function eventIsFresh(event) {
  const expiry = Date.parse(String(event.expires_at || ""));
  return Number.isFinite(expiry) && expiry > Date.now() && expiry <= Date.now() + ttlMs + 5_000;
}

function errorText(error) {
  const messages = {
    friend_activity_viewer_changed: "Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.",
    authentication_required: "Bitte melde dich an, um diese Einstellung zu ändern.",
  };
  return t(messages[error?.message] || "Die Startmeldungen sind gerade nicht erreichbar. Bitte versuche es erneut.");
}

async function request(options = {}) {
  const response = await apiFetch(endpoint, { ...options, signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "friend_activity_unavailable");
  return payload;
}

/** Live, account-only start notices. They are intentionally never persisted. */
export function initializeFriendActivity() {
  if (window.__friendActivityController) return window.__friendActivityController;
  const state = { socket: null, reconnect: null, attempts: 0, enabled: false, destroyed: false, seen: new Set() };
  const close = () => {
    window.clearTimeout(state.reconnect);
    state.reconnect = null;
    state.socket?.close(1000, "Preference changed");
    state.socket = null;
  };
  const forget = () => {
    close();
    state.enabled = false;
    state.seen.clear();
  };
  const show = event => {
    const game = event?.friend_activity;
    if (!game || typeof game !== "object" || !eventIsFresh(game) || state.seen.has(game.id)) return;
    state.seen.add(game.id);
    window.setTimeout(() => state.seen.delete(game.id), ttlMs);
    const players = Array.isArray(game.players) ? game.players.map(player => String(player?.username || "").trim()).filter(Boolean).slice(0, 3) : [];
    if (!players.length) return;
    const description = gameText(game);
    const names = players.join(", ");
    const message = `${names} ${t("hat ein Spiel gestartet:")} ${description.typeText} (${description.playerText}${description.mode}).`;
    const href = currentGameRoom() ? null : spectatorUrl(game);
    window.ZDWA_UI?.toast?.(message, href ? {
      kind: "info", duration: 15_000, actionLabel: t("Zuschauen"),
      onAction: () => location.assign(href),
    } : { kind: "info", duration: 8_000 });
  };
  const connect = async () => {
    if (state.destroyed || !state.enabled || state.socket) return;
    let auth;
    try { auth = await loadAuth(); } catch (_) { return; }
    if (!auth?.authenticated || state.destroyed || !state.enabled) return;
    const socket = new WebSocket(socketUrl());
    state.socket = socket;
    socket.addEventListener("message", event => {
      let payload;
      try { payload = JSON.parse(event.data); } catch (_) { return; }
      if (payload.friend_activity_ready) {
        if (!payload.friend_activity_ready.enabled) { state.enabled = false; socket.close(); }
        else state.attempts = 0;
        return;
      }
      if (payload.friend_activity) show(payload);
    });
    const heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "ping" }));
    }, 25_000);
    socket.addEventListener("close", () => {
      window.clearInterval(heartbeat);
      if (state.socket === socket) state.socket = null;
      if (!state.destroyed && state.enabled) {
        state.attempts = Math.min(state.attempts + 1, 5);
        state.reconnect = window.setTimeout(connect, 500 * 2 ** state.attempts);
      }
    }, { once: true });
  };
  const preference = enabled => {
    state.enabled = enabled === true;
    if (state.enabled) void connect(); else forget();
  };
  window.addEventListener("zdwa:friend-activity-preference", event => preference(event.detail?.enabled));
  window.addEventListener("zdwa:auth-state", event => {
    if (!event.detail?.authenticated) forget();
  });
  window.addEventListener("pagehide", () => { state.destroyed = true; forget(); }, { once: true });
  loadAuth().then(auth => preference(auth?.user?.preferences?.friend_activity_enabled !== false)).catch(forget);
  window.__friendActivityController = { preference, destroy: forget };
  return window.__friendActivityController;
}

export function mountFriendActivitySettings(mount) {
  if (!mount || mount.dataset.friendActivityBound) return;
  mount.dataset.friendActivityBound = "true";
  let current = null;
  let busy = false;
  const form = document.createElement("form");
  form.className = "friend-activity-settings";
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "friendActivity";
  label.append(checkbox, ` ${t("Startmeldungen ausgewählter Spieler anzeigen")}`);
  const hint = document.createElement("p");
  hint.className = "friend-activity-settings__hint";
  hint.textContent = t("Wenn jemand aus deiner privaten Spielerauswahl eine öffentliche, zuschauerfähige Partie startet, erscheint eine kurze Meldung in beiden Lobbys. Außerhalb eines Spiels kannst du direkt zuschauen. Keine Push-Nachricht und kein Verlauf.");
  const button = document.createElement("button");
  button.type = "submit";
  button.className = "small primary";
  button.textContent = t("Startmeldungen speichern");
  const message = document.createElement("p");
  message.className = "friend-activity-settings__message";
  message.setAttribute("role", "status");
  form.append(label, hint, button, message);
  mount.replaceChildren(form);
  const controls = () => { checkbox.disabled = busy || !current; button.disabled = busy || !current; };
  async function refresh() {
    busy = true; current = null; controls(); message.textContent = t("Startmeldungen werden geladen …");
    try {
      current = await request();
      checkbox.checked = current.enabled === true;
      message.textContent = "";
    } catch (error) { message.textContent = errorText(error); }
    finally { busy = false; controls(); }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!current || busy) return;
    busy = true; controls(); message.textContent = t("Startmeldungen werden gespeichert …");
    try {
      const result = await request({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viewer_id: current.viewer_id, enabled: checkbox.checked }) });
      if (result.viewer_id !== current.viewer_id) throw new Error("friend_activity_viewer_changed");
      current = result;
      window.dispatchEvent(new CustomEvent("zdwa:friend-activity-preference", { detail: { enabled: result.enabled } }));
      message.textContent = t("Startmeldungen gespeichert.");
    } catch (error) { message.textContent = errorText(error); }
    finally { busy = false; controls(); }
  });
  window.addEventListener("zdwa:auth-state", event => {
    if (!event.detail?.authenticated || event.detail.user?.id !== current?.viewer_id) void refresh();
  });
  void refresh();
}
