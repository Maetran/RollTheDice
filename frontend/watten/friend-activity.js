import { WATTEN_FRIEND_MESSAGES } from "../i18n/catalog.js";

const LEGACY_ID = /^[A-Za-z0-9-]{1,64}$/;
// Strict product/route pairing. Unknown products have no fallback route.
const PRODUCTS = Object.freeze({
  watten: Object.freeze({ prefix: "/watten", id: /^[0-9a-f]{16}$/, modes: ["2", "3", "4"], seats: 4 }),
  hausdepp: Object.freeze({ prefix: "/hausdepp", id: LEGACY_ID, modes: ["2", "3", "4", "5", "6"], seats: 6 }),
  zilch: Object.freeze({ prefix: "/zilch", id: LEGACY_ID, modes: ["1", "2", "3", "2v2"], seats: 4 }),
  zdwa: Object.freeze({ prefix: "", id: LEGACY_ID, modes: ["1", "2", "3", "2v2"], seats: 4 }),
});
const KEYS = ["schema_version", "id", "game_id", "game_type", "players", "player_count", "mode", "started_at", "expires_at", "spectator_url"];
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const TTL = 60_000;
const SKEW = 30_000;
const PING = 25_000;
const RECONNECT = Object.freeze([2_000, 5_000, 10_000, 20_000, 30_000]);
const SEEN_LIMIT = 64;
const QUEUE_LIMIT = 20;
const INVALID_LIMIT = 20;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const languageNow = () => globalThis.window?.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";

export function friendText(key, values = {}, language = languageNow()) {
  return WATTEN_FRIEND_MESSAGES[language === "en" ? "en" : "de"][key]
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

export function friendSpectatorPath(product, gameId) {
  const spec = Object.hasOwn(PRODUCTS, product) ? PRODUCTS[product] : null;
  return spec && typeof gameId === "string" && spec.id.test(gameId) ? `${spec.prefix}/spiel/${gameId}/zuschauen` : null;
}

export function friendActivitySocketUrl(location, accountId) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return null;
  const url = new URL(location.href);
  if (!["http:", "https:"].includes(url.protocol)) return null;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/friend-activity"; url.search = ""; url.hash = "";
  url.searchParams.set("context", "watten");
  url.searchParams.set("expected_account_id", String(accountId));
  return url.toString();
}

function timestamp(value) {
  if (typeof value !== "string" || !ISO.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Exactly the ten frozen fields; anything else is dropped before mounting. */
export function validateFriendStart(value, nowMs) {
  if (!object(value) || Object.keys(value).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(value, key))) return null;
  if (value.schema_version !== 1 || typeof value.game_type !== "string" || !Object.hasOwn(PRODUCTS, value.game_type)) return null;
  const spec = PRODUCTS[value.game_type];
  const path = friendSpectatorPath(value.game_type, value.game_id);
  if (!path || value.spectator_url !== path || value.id !== `start:${value.game_type}:${value.game_id}`) return null;
  if (typeof value.mode !== "string" || !spec.modes.includes(value.mode)) return null;
  if (!Number.isSafeInteger(value.player_count) || value.player_count < 1 || value.player_count > spec.seats
      || (value.game_type === "watten" && value.player_count !== Number(value.mode))) return null;
  if (!Array.isArray(value.players) || !value.players.length || value.players.length > value.player_count) return null;
  const names = [];
  for (const player of value.players) {
    if (!object(player) || Object.keys(player).length !== 1 || typeof player.username !== "string") return null;
    const name = player.username;
    if (!name.trim() || [...name].length > 64 || /[\u0000-\u001f\u007f]/.test(name)) return null;
    names.push(name);
  }
  const started = timestamp(value.started_at), expires = timestamp(value.expires_at);
  if (started === null || expires === null || expires - started !== TTL) return null;
  if (!Number.isFinite(nowMs) || nowMs < started - SKEW || nowMs >= expires) return null;
  return Object.freeze({ id: value.id, product: value.game_type, gameId: value.game_id, names: Object.freeze(names),
    playerCount: value.player_count, mode: value.mode, expiresAt: expires, url: path });
}

/**
 * Live-only start notices for the captured native account. It never touches
 * the game socket, never navigates by itself and never moves focus.
 */
export function createFriendActivity({ container, placement = "lobby", getExpectedAccountId, isCurrent, onAccountChanged,
  onWatch, loadAuth, createSocket = url => new WebSocket(url), escapeHtml: esc, language = languageNow, win = window,
  now = () => Date.now() }) {
  const accountId = getExpectedAccountId();
  const socketUrl = friendActivitySocketUrl(win.location, accountId);
  const watchable = placement === "lobby" && typeof onWatch === "function";
  const t = (key, values = {}) => friendText(key, values, language());
  const notices = new Map(), seen = new Map(), listeners = new AbortController();
  let destroyed = false, stopped = false, socket = null, socketSerial = 0, pingTimer = 0, reconnectTimer = 0;
  let attempts = 0, invalid = 0, pendingPresentations = 0;
  const current = () => !destroyed && isCurrent() && getExpectedAccountId() === accountId;

  function closeSocket() {
    socketSerial += 1;
    win.clearInterval(pingTimer); pingTimer = 0;
    const previous = socket; socket = null;
    try { previous?.close(); } catch { /* already closed */ }
  }
  function clearNotices() {
    for (const entry of notices.values()) win.clearTimeout(entry.timer);
    notices.clear();
    container.replaceChildren(); container.hidden = true;
  }
  function stop() {
    stopped = true;
    win.clearTimeout(reconnectTimer); reconnectTimer = 0;
    closeSocket(); clearNotices();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; stop(); seen.clear(); listeners.abort();
  }
  function changed() { destroy(); onAccountChanged(); }

  async function verify(count) {
    let auth;
    for (let index = 0; index < count; index += 1) {
      auth = await loadAuth({ refresh: true });
      if (!current()) return null;
      if (!auth?.authenticated || auth.user?.id !== accountId) { changed(); return null; }
    }
    // Consent is never enabled here; a false or missing grant only stops.
    if (auth.user.preferences?.friend_activity_enabled !== true) { stop(); return null; }
    return auth;
  }

  function names(notice) { return notice.names.join(", "); }
  function summary(notice) {
    const values = { names: names(notice), product: t(notice.product) };
    return t(notice.names.length > 1 ? "startedMany" : "startedOne", values);
  }
  function details(notice) {
    const mode = ["watten", "hausdepp"].includes(notice.product) ? t("modeSeats", { count: notice.mode }) : t("modeNamed", { mode: notice.mode });
    return `${t(notice.product)} · ${mode} · ${t("seats", { count: notice.playerCount })}`;
  }
  function render() {
    if (!current() || !notices.size) { container.replaceChildren(); container.hidden = true; return; }
    const list = [...notices.values()].map(entry => entry.notice);
    container.hidden = false;
    if (!watchable) {
      // Inside a table only plain text: no control can intercept the hand.
      const notice = list.at(-1);
      container.innerHTML = `<p class="wt-friend-activity__info">${esc(t("tableInfo", { text: summary(notice) }))}</p>`;
      return;
    }
    container.innerHTML = `<section class="wt-friend-activity" aria-label="${esc(t("noticesTitle"))}"><ul>${list.map(notice => {
      const values = { names: names(notice), product: t(notice.product) };
      return `<li data-watten-friend-notice="${esc(notice.id)}"><p class="wt-note--strong">${esc(summary(notice))}</p>
        <p class="wt-note">${esc(details(notice))}</p><div class="wt-actions">
        <button type="button" data-watten-friend-action="watch" data-notice-id="${esc(notice.id)}" aria-label="${esc(t("watchLabel", values))}">${esc(t("watch"))}</button>
        <button type="button" class="wt-button--ghost" data-watten-friend-action="dismiss" data-notice-id="${esc(notice.id)}" aria-label="${esc(t("dismissLabel", values))}">${esc(t("dismiss"))}</button></div></li>`;
    }).join("")}</ul></section>`;
  }
  function remove(id) {
    const entry = notices.get(id);
    if (!entry) return;
    win.clearTimeout(entry.timer); notices.delete(id); render();
  }
  function remember(notice) {
    const at = now();
    for (const [id, expires] of seen) if (expires <= at) seen.delete(id);
    if (seen.has(notice.id)) return false;
    seen.set(notice.id, notice.expiresAt);
    while (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value);
    return true;
  }
  async function present(notice, live) {
    if (pendingPresentations >= QUEUE_LIMIT || !remember(notice)) return;
    pendingPresentations += 1;
    try {
      if (!await verify(2) || !live()) return;
      const remaining = notice.expiresAt - now();
      if (remaining <= 0) return;
      const timer = win.setTimeout(() => remove(notice.id), Math.min(remaining, TTL));
      notices.set(notice.id, { notice, timer });
      const visible = watchable ? 3 : 1;
      while (notices.size > visible) {
        const [oldest, entry] = notices.entries().next().value;
        win.clearTimeout(entry.timer); notices.delete(oldest);
      }
      render();
    } catch { /* Optional notices cannot block gameplay when authentication is unavailable. */ }
    finally { pendingPresentations -= 1; }
  }
  function protocol() {
    invalid += 1;
    if (invalid >= INVALID_LIMIT) stop();
  }
  function scheduleReconnect() {
    if (!current() || stopped || reconnectTimer || attempts >= RECONNECT.length) return;
    reconnectTimer = win.setTimeout(() => { reconnectTimer = 0; void connect(); }, RECONNECT[attempts]);
    attempts += 1;
  }

  async function connect() {
    if (!current() || stopped || socket) return;
    let auth;
    try { auth = await verify(1); } catch { scheduleReconnect(); return; }
    if (!auth || !current() || stopped || socket) return;
    const own = ++socketSerial;
    let ws;
    try { ws = createSocket(socketUrl); } catch { scheduleReconnect(); return; }
    socket = ws;
    let verified = false, ready = false;
    const queued = [];
    const live = () => current() && !stopped && socket === ws && socketSerial === own;
    function handle(data) {
      if (!live()) return;
      let payload;
      try { payload = JSON.parse(data); } catch { protocol(); return; }
      const keys = object(payload) ? Object.keys(payload) : [];
      if (keys.length !== 1) { protocol(); return; }
      if (payload.pong === true) return;
      if (keys[0] === "friend_activity_ready") {
        const value = payload.friend_activity_ready;
        if (ready || !object(value) || Object.keys(value).length !== 2 || !Number.isSafeInteger(value.viewer_id)
            || typeof value.enabled !== "boolean") { protocol(); return; }
        if (value.viewer_id !== accountId) { changed(); return; }
        if (!value.enabled) { stop(); return; }
        ready = true; attempts = 0;
        return;
      }
      if (keys[0] === "friend_activity" && ready) {
        const notice = validateFriendStart(payload.friend_activity, now());
        if (notice) void present(notice, live); else protocol();
        return;
      }
      protocol();
    }
    ws.addEventListener("open", async () => {
      if (!live()) return;
      try { if (!await verify(2) || !live()) return; } catch { if (live()) { closeSocket(); scheduleReconnect(); } return; }
      verified = true;
      win.clearInterval(pingTimer);
      pingTimer = win.setInterval(() => {
        if (live() && ws.readyState === 1) ws.send(JSON.stringify({ action: "ping" }));
      }, PING);
      for (const data of queued.splice(0)) handle(data);
    });
    ws.addEventListener("message", event => {
      if (!live()) return;
      if (verified) { handle(event.data); return; }
      if (queued.length < QUEUE_LIMIT) queued.push(event.data); else protocol();
    });
    ws.addEventListener("close", event => {
      if (!live()) return;
      closeSocket();
      if (event.code === 1008) {
        // Access, consent or identity boundary: never retry on its own.
        stop(); void verify(1).catch(() => undefined);
      } else scheduleReconnect();
    });
    ws.addEventListener("error", () => { if (live()) { closeSocket(); scheduleReconnect(); } });
  }

  container.replaceChildren(); container.hidden = true;
  if (!socketUrl || !current()) return { destroy };
  if (watchable) {
    container.addEventListener("click", event => {
      const control = event.target.closest?.("[data-watten-friend-action]");
      if (!control || control.disabled || !container.contains(control) || !current()) return;
      const entry = notices.get(control.dataset.noticeId);
      if (!entry) return;
      if (control.dataset.wattenFriendAction === "dismiss") { remove(entry.notice.id); return; }
      if (control.dataset.wattenFriendAction !== "watch") return;
      if (entry.notice.expiresAt <= now() || friendSpectatorPath(entry.notice.product, entry.notice.gameId) !== entry.notice.url) {
        remove(entry.notice.id); return;
      }
      onWatch(entry.notice.url);
    }, { signal: listeners.signal });
  }
  win.addEventListener("zdwa:auth-state", event => {
    if (destroyed) return;
    const auth = event.detail;
    if (!auth?.authenticated || auth.user?.id !== accountId) { changed(); return; }
    if (auth.user.preferences?.friend_activity_enabled !== true) stop();
  }, { signal: listeners.signal });
  win.addEventListener("pagehide", destroy, { signal: listeners.signal });
  void connect().catch(() => undefined);
  return { destroy };
}
