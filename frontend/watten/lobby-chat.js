import { WATTEN_LOBBY_CHAT_MESSAGES } from "../i18n/catalog.js";

const PRODUCTS = Object.freeze(["zdwa", "zilch", "hausdepp", "watten"]);
const LIMIT = 500;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const languageNow = () => globalThis.window?.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";

/** The Watten wire deliberately has no account identifiers or avatar metadata. */
export function lobbyMessage(value) {
  const keys = ["id", "kind", "sender", "is_admin", "game_type", "sent_at", "text"];
  if (!object(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))
      || !Number.isSafeInteger(value.id) || value.id <= 0 || value.kind !== "message"
      || typeof value.sender !== "string" || !value.sender.trim() || value.sender.length > 64
      || typeof value.is_admin !== "boolean" || !PRODUCTS.includes(value.game_type)
      || typeof value.sent_at !== "string" || !/[Tt].*(?:[Zz]|[+-]\d\d:\d\d)$/.test(value.sent_at)
      || !Number.isFinite(Date.parse(value.sent_at)) || typeof value.text !== "string"
      || !value.text.trim() || [...value.text].length > 400) return null;
  return Object.freeze({ id: value.id, kind: "message", sender: value.sender,
    game_type: value.game_type, sent_at: value.sent_at, text: value.text });
}

export function lobbySocketUrl(location, accountId, founderPreview = false) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return null;
  const url = new URL(location.href);
  const host = url.hostname.toLowerCase();
  const local = ["http:", "https:"].includes(url.protocol) && (host === "localhost" || host.endsWith(".localhost")
    || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host));
  const founder = founderPreview === true && url.origin === "https://zockdiewandan.online" && !url.username && !url.password;
  if (!local && !founder) return null;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/lobby-chat"; url.search = ""; url.hash = "";
  url.searchParams.set("context", "watten");
  url.searchParams.set("expected_account_id", String(accountId));
  return url.toString();
}

/** One explicitly opened lobby subscription; all history/drafts stay in RAM. */
export function mountWattenLobbyChat({ container, initialAuth, getExpectedAccountId, isCurrent, onAccountChanged,
  loadAuth, fetcher = globalThis.fetch, createSocket = url => new WebSocket(url), escapeHtml: esc,
  language = languageNow, dom = document, win = window }) {
  const accountId = getExpectedAccountId();
  const localSocketUrl = lobbySocketUrl(win.location, accountId);
  const requiresFounderCapability = localSocketUrl === null;
  const boundAuth = auth => auth?.authenticated === true && auth.user?.id === accountId
    && (!requiresFounderCapability || auth.game_access?.watten_preview === true);
  const socketUrl = localSocketUrl || lobbySocketUrl(win.location, accountId, boundAuth(initialAuth));
  const t = (key, values = {}) => WATTEN_LOBBY_CHAT_MESSAGES[language() === "en" ? "en" : "de"][key]
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  let destroyed = false, serial = 0, socket = null, socketSerial = 0, busy = false, connected = false;
  let enabled = false, muted = false, excluded = false, opened = false, blocked = false;
  let draft = "", pending = null, pendingTimer = null, username = "", filter = "all", status = "consent";
  let messages = [], buffered = [], limited = false, emptyVisible = false;
  const dateFormat = new Intl.DateTimeFormat(language() === "en" ? "en-GB" : "de-CH", { hour: "2-digit", minute: "2-digit" });
  const listeners = new AbortController();
  let request = null;
  const current = () => !destroyed && isCurrent() && getExpectedAccountId() === accountId;
  const field = name => container.querySelector(`[data-watten-lobby-chat-${name}]`);
  const action = name => container.querySelector(`[data-watten-lobby-chat-action="${name}"]`);

  function clearPending() { win.clearTimeout(pendingTimer); pendingTimer = null; pending = null; }
  function closeSocket() {
    connected = false; buffered = []; socketSerial += 1;
    const previous = socket; socket = null; previous?.close();
    if (pending) { clearPending(); status = "uncertain"; }
  }
  function clearPrivate() {
    messages = []; draft = ""; limited = false; clearPending();
    if (field("input")) field("input").value = "";
    field("messages")?.replaceChildren();
  }
  function changed() { destroy(); onAccountChanged(); }
  function preferences(auth) {
    enabled = auth.user.preferences?.lobby_chat_enabled === true;
    muted = auth.user.preferences?.lobby_chat_muted === true;
    excluded = auth.user.preferences?.lobby_chat_excluded === true;
    username = auth.user.username;
    if (!enabled || excluded) {
      closeSocket(); opened = false; clearPrivate(); status = excluded ? "excluded" : "disabled";
    }
  }
  async function verify(token, count = 1) {
    let auth;
    for (let index = 0; index < count; index += 1) {
      auth = await loadAuth({ refresh: true });
      if (!current() || token !== serial) return null;
      if (!boundAuth(auth)) { changed(); return null; }
      preferences(auth);
    }
    return auth;
  }
  function update() {
    if (!current()) return;
    field("status").textContent = t(excluded ? "excluded" : muted && connected ? "muted" : status);
    field("notice").textContent = t(enabled ? "consent" : "disabledConsent");
    action("open").textContent = t(enabled ? "open" : "enable");
    action("open").hidden = opened || excluded || blocked;
    action("open").disabled = busy;
    action("reconnect").hidden = !opened || connected || excluded || blocked;
    action("reconnect").disabled = busy;
    action("close").hidden = !opened;
    action("disable").hidden = !enabled || excluded;
    action("disable").disabled = busy;
    field("body").hidden = !opened;
    field("input").disabled = !connected || busy || muted || !!pending;
    action("send").disabled = field("input").disabled || !draft.trim();
    field("limit").hidden = !limited;
  }
  function messageRow(message) {
    const row = dom.createElement("li");
    row.dataset.messageId = String(message.id);
    row.innerHTML = `<strong translate="no">${esc(message.sender)}</strong> <span class="wt-tag" translate="no">${esc(t(message.game_type))}</span>
      <time datetime="${esc(message.sent_at)}">${esc(dateFormat.format(new Date(message.sent_at)))}</time><p>${esc(message.text)}</p>`;
    return row;
  }
  function renderMessages() {
    const list = field("messages"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    list.replaceChildren();
    for (const message of messages.filter(item => filter === "all" || item.game_type === filter)) {
      list.append(messageRow(message));
    }
    emptyVisible = !list.children.length;
    if (emptyVisible) { const row = dom.createElement("li"); row.textContent = t("empty"); list.append(row); }
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  function accept(message, historical) {
    if (!current() || !opened) return;
    const duplicate = messages.some(item => item.id === message.id);
    if (!duplicate) {
      const previous = messages.at(-1), compare = (a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.id - b.id;
      const inOrder = !previous || compare(previous, message) <= 0;
      messages.push(message); messages.sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.id - b.id);
      const removed = messages.length > LIMIT ? messages.shift() : null;
      if (removed) limited = true;
      if (!inOrder) renderMessages();
      else {
        const list = field("messages"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        if (removed && list.firstElementChild?.dataset.messageId === String(removed.id)) list.firstElementChild.remove();
        if (filter === "all" || message.game_type === filter) {
          if (emptyVisible) { list.replaceChildren(); emptyVisible = false; }
          list.append(messageRow(message));
        }
        if (!list.children.length) renderMessages();
        if (atBottom) list.scrollTop = list.scrollHeight;
      }
    }
    // The shared transport has no command ACK. Only a live own echo can clear
    // this unchanged draft; history/reconnect must never silently resend it.
    if (!historical && !duplicate && pending && message.sender === pending.username && message.text === pending.text
        && message.game_type === "watten") {
      if (draft.trim() === pending.text) { draft = ""; field("input").value = ""; }
      clearPending(); status = "connected";
    }
    update();
  }
  function error(code) {
    if (code === "authentication_required") { changed(); return; }
    if (code === "lobby_chat_disabled" || code === "lobby_chat_excluded") {
      excluded = code === "lobby_chat_excluded"; enabled = code !== "lobby_chat_disabled";
      closeSocket(); clearPrivate(); opened = false; status = excluded ? "excluded" : "disabled";
    } else {
      clearPending();
      if (code === "lobby_chat_muted") muted = true;
      status = ({ lobby_chat_muted: "muted", lobby_chat_message_invalid: "invalid", lobby_chat_rate_limited: "rate",
        lobby_chat_action_unknown: "unavailable" })[code] || "unavailable";
    }
    update();
  }
  async function connect(token) {
    const auth = await verify(token);
    if (!auth || !current() || token !== serial || !enabled || excluded) return;
    closeSocket(); opened = true; status = "connecting";
    const own = ++socketSerial;
    const ws = createSocket(socketUrl); socket = ws;
    const live = () => current() && socket === ws && socketSerial === own;
    ws.addEventListener("open", async () => {
      try {
        if (!live() || !await verify(token, 2) || !live() || !enabled || excluded) return;
        connected = true; status = draft ? "review" : "connected";
        const incoming = buffered; buffered = [];
        for (const item of incoming) accept(item.message, item.historical);
        update();
      } catch { if (live()) { closeSocket(); status = "network"; update(); } }
    });
    ws.addEventListener("message", event => {
      if (!live()) return;
      let payload; try { payload = JSON.parse(event.data); } catch { error("invalid_wire"); return; }
      if (object(payload) && typeof payload.error === "string") { error(payload.error); return; }
      const message = lobbyMessage(payload?.lobby_chat);
      if (!message || (Object.hasOwn(payload, "lobby_chat_history") && payload.lobby_chat_history !== true)) {
        error("invalid_wire"); return;
      }
      const historical = payload.lobby_chat_history === true;
      if (connected) accept(message, historical);
      else { buffered.push({ message, historical }); if (buffered.length > LIMIT) { buffered.shift(); limited = true; } }
    });
    ws.addEventListener("close", event => {
      if (!live()) return;
      closeSocket();
      if (event.code === 1008) { blocked = true; status = "access"; clearPrivate(); }
      else if (status !== "uncertain") status = "network";
      update();
    });
    ws.addEventListener("error", () => { if (live()) { closeSocket(); status = "network"; update(); } });
    update();
  }
  async function setEnabled(value, token) {
    const auth = await verify(token);
    if (!auth || !current() || token !== serial) return false;
    if (typeof auth.user.csrf_token !== "string" || !auth.user.csrf_token) throw new Error("csrf");
    request?.abort(); request = new AbortController();
    const response = await fetcher("/api/auth/preferences/lobby-chat", { method: "PUT", cache: "no-store", credentials: "same-origin",
      signal: request.signal, headers: { "Content-Type": "application/json", "X-CSRF-Token": auth.user.csrf_token,
        "X-Watten-Expected-Account-Id": String(accountId) }, body: JSON.stringify({ lobby_chat_enabled: value }) });
    if (!current() || token !== serial) return false;
    const result = await response.json().catch(() => null);
    if (!current() || token !== serial) return false;
    if (response.status === 401 || response.status === 409 && result?.detail === "watten_account_changed") { changed(); return false; }
    if (!await verify(token, 2)) return false;
    if (!response.ok || !object(result) || result.lobby_chat_enabled !== value || enabled !== value) throw new Error("preference");
    return true;
  }
  async function operate(kind) {
    if (!current() || busy || excluded || blocked) return;
    const consentedEnable = kind === "open" && !enabled;
    const token = ++serial; busy = true; status = "connecting"; update();
    try {
      if (kind === "disable") {
        closeSocket(); clearPrivate(); opened = false;
        if (await setEnabled(false, token)) status = "disabled";
      } else {
        const auth = await verify(token);
        if (!auth || excluded) return;
        // A newer preference from another tab/device needs a new explicit
        // enable click; "Reconnect" must not silently reverse its opt-out.
        if (!enabled && (!consentedEnable || !await setEnabled(true, token))) return;
        await connect(token);
      }
    } catch { if (current() && token === serial) status = "network"; }
    finally { if (current() && token === serial) { busy = false; update(); } }
  }
  async function send() {
    if (!current() || busy || !connected || muted || pending) return;
    const text = draft.trim();
    if (!text || [...text].length > 400 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      status = "invalid"; update(); return;
    }
    const token = ++serial, ws = socket; busy = true; update();
    try {
      const auth = await verify(token);
      if (!auth || !current() || token !== serial || socket !== ws || !connected || muted || excluded) return;
      pending = { text, username };
      ws.send(JSON.stringify({ action: "lobby_chat_message", text }));
      status = "sending";
      pendingTimer = win.setTimeout(() => {
        if (current() && pending?.text === text) { clearPending(); status = "uncertain"; update(); }
      }, 8000);
    } catch { if (current() && token === serial) { clearPending(); status = "uncertain"; } }
    finally { if (current() && token === serial) { busy = false; update(); } }
  }
  function viewport() {
    const height = win.visualViewport?.height || win.innerHeight;
    container.style.setProperty("--wt-lobby-chat-height", `${Math.max(80, Math.floor(height * .4))}px`);
    if (dom.activeElement === field("input")) field("input").scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; serial += 1; request?.abort(); closeSocket(); clearPrivate(); listeners.abort(); container.replaceChildren();
  }

  if (!socketUrl || !boundAuth(initialAuth) || !current()) {
    container.replaceChildren(); return { destroy };
  }
  preferences(initialAuth);
  container.innerHTML = `<section class="wt-card-panel wt-lobby-chat" aria-labelledby="wattenLobbyChatTitle">
    <h2 id="wattenLobbyChatTitle">${esc(t("title"))}</h2><p class="wt-note">${esc(t("privacy"))}</p>
    <p class="wt-note" data-watten-lobby-chat-notice></p><div class="wt-actions">
      <button type="button" data-watten-lobby-chat-action="open"></button>
      <button type="button" data-watten-lobby-chat-action="reconnect">${esc(t("reconnect"))}</button>
      <button type="button" class="wt-button--ghost" data-watten-lobby-chat-action="close">${esc(t("close"))}</button>
      <button type="button" class="wt-button--ghost" data-watten-lobby-chat-action="disable">${esc(t("disable"))}</button></div>
    <p class="wt-note" role="status" data-watten-lobby-chat-status></p>
    <div data-watten-lobby-chat-body hidden>
      <label>${esc(t("filter"))}<select data-watten-lobby-chat-filter>${["all", ...PRODUCTS].map(product => `<option value="${product}">${esc(t(product))}</option>`).join("")}</select></label>
      <ol data-watten-lobby-chat-messages aria-label="${esc(t("messages"))}" aria-live="polite" aria-relevant="additions text"></ol>
      <p class="wt-note" data-watten-lobby-chat-limit hidden>${esc(t("limit", { count: LIMIT }))}</p>
      <form data-watten-lobby-chat-form><label>${esc(t("message"))}<textarea rows="2" maxlength="800" data-watten-lobby-chat-input></textarea></label>
        <button type="submit" data-watten-lobby-chat-action="send">${esc(t("send"))}</button></form>
      <p class="wt-note">${esc(t("rateHelp"))}</p>
    </div></section>`;
  container.addEventListener("click", event => {
    const control = event.target.closest?.("[data-watten-lobby-chat-action]");
    if (!control || control.disabled || !container.contains(control) || !current()) return;
    const kind = control.dataset.wattenLobbyChatAction;
    if (["open", "reconnect", "disable"].includes(kind)) void operate(kind);
    else if (kind === "close") {
      serial += 1; busy = false; closeSocket(); clearPrivate(); opened = false; status = "consent"; update();
      action("open").focus?.({ preventScroll: true });
    }
  }, { signal: listeners.signal });
  container.addEventListener("input", event => { if (event.target === field("input")) { draft = event.target.value; update(); } }, { signal: listeners.signal });
  container.addEventListener("submit", event => {
    if (!event.target.matches?.("[data-watten-lobby-chat-form]")) return;
    event.preventDefault(); void send();
  }, { signal: listeners.signal });
  field("filter").addEventListener("change", () => { filter = field("filter").value; renderMessages(); }, { signal: listeners.signal });
  win.addEventListener("zdwa:auth-state", event => {
    if (!current()) return;
    const auth = event.detail;
    if (!boundAuth(auth)) { changed(); return; }
    preferences(auth); update();
  }, { signal: listeners.signal });
  win.addEventListener("pagehide", destroy, { signal: listeners.signal });
  win.addEventListener("resize", viewport, { signal: listeners.signal });
  win.visualViewport?.addEventListener("resize", viewport, { signal: listeners.signal });
  field("input").addEventListener("focus", viewport, { signal: listeners.signal });
  renderMessages(); update(); viewport();
  return { destroy };
}
