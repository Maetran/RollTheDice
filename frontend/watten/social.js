import { WATTEN_SOCIAL_MESSAGES } from "../i18n/catalog.js";

export const SOCIAL_EMOJIS = Object.freeze(["👍", "😂", "😮", "💩", "🎉", "🤞", "🙏", "😜", "🙄", "🤦", "😭", "🔥"]);
/** The result uses the same public reaction transport as the table chat. */
export function resultReactionsMarkup(language, esc) {
  const messages = WATTEN_SOCIAL_MESSAGES[language === "en" ? "en" : "de"];
  return `<div class="wt-final-reactions" role="group" aria-label="${esc(messages.quick)}">${[0, 1, 4, 6].map(index =>
    `<button type="button" data-watten-result-emoji="${SOCIAL_EMOJIS[index]}" aria-label="${esc(messages[`emoji${index}`])}" disabled>${SOCIAL_EMOJIS[index]}</button>`).join("")}</div>
    <p class="wt-final-reaction-status wt-note" data-watten-result-status role="status"></p>`;
}
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const token = value => typeof value === "string" && value.length > 0 && value.length <= 160;
const nonce = value => Number.isSafeInteger(value) && value >= 1;
const keys = (value, allowed) => Object.keys(value).sort().join("|") === allowed.sort().join("|");
const FRAMES = ["watten_social_history", "watten_social_event", "watten_social_ack", "watten_social_error"];

/** Copy only the public event contract; never retain an unknown/private field. */
export function socialEvent(value) {
  if (!object(value) || !["chat", "emoji"].includes(value.type) || !token(value.id) || !token(value.sender_id)
      || !["member", "spectator"].includes(value.role) || typeof value.display_name !== "string"
      || !value.display_name.trim() || value.display_name.length > 64 || typeof value.time !== "string"
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value.time) || !Number.isFinite(Date.parse(value.time))
      || !keys(value, ["id", "type", "sender_id", "display_name", "role", "time", value.type === "chat" ? "text" : "emoji"])) return null;
  if (value.type === "chat" && (typeof value.text !== "string" || value.text !== value.text.trim()
      || !value.text || value.text.length > 400)) return null;
  if (value.type === "emoji" && !SOCIAL_EMOJIS.includes(value.emoji)) return null;
  return Object.freeze({ ...value });
}

export function createSocialLog() {
  let events = [];
  return {
    values: () => [...events],
    clear() { events = []; },
    replace(values) {
      if (!Array.isArray(values) || values.length > 100) return false;
      const clean = values.map(socialEvent);
      if (clean.some(item => !item) || new Set(clean.map(item => item.id)).size !== clean.length) return false;
      events = clean; return true;
    },
    append(value) {
      const clean = socialEvent(value);
      if (!clean || events.some(item => item.id === clean.id)) return false;
      events = [...events, clean].slice(-100); return true;
    },
  };
}

/** Per-account/table instance. It updates only its public log and controls. */
export function createSocial({ gameId, getExpectedAccountId, isCurrent, send, escapeHtml: esc,
  language = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de",
  dom = document, win = window }) {
  const accountId = getExpectedAccountId(), log = createSocialLog();
  const lifecycle = new AbortController();
  let container = null, ui = null, destroyed = false, authorized = false, bound = false, opened = false;
  let channel = null, next = null, canSend = false, draft = "", pending = null, timer = null, bubbleTimer = null;
  let unread = 0, status = "", requestedHistory = false, focusBefore = null, excluded = false;
  const lang = () => language() === "en" ? "en" : "de";
  const t = (key, values = {}) => WATTEN_SOCIAL_MESSAGES[lang()][key]
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  const current = () => !destroyed && isCurrent() && getExpectedAccountId() === accountId;
  const writable = () => current() && authorized && bound && canSend && token(channel) && nonce(next) && !pending;

  function updateControls() {
    for (const button of dom.querySelectorAll?.("[data-watten-result-emoji]") || []) button.disabled = !writable();
    for (const node of dom.querySelectorAll?.("[data-watten-result-status]") || []) node.textContent = status ? t(status) : "";
    if (!ui) return;
    ui.input.disabled = !writable(); ui.submit.disabled = !writable();
    for (const button of ui.emojis) button.disabled = !writable();
    ui.status.textContent = status ? t(status) : !bound ? t("offline") : !canSend ? t("readOnly") : "";
    ui.retry.hidden = !pending || !status || !bound || !canSend || pending.channel_id !== channel;
    ui.refresh.hidden = !bound || !status || Boolean(channel) || requestedHistory || excluded;
    ui.unread.textContent = String(Math.min(unread, 100)); ui.unread.hidden = unread === 0;
  }
  function viewport() {
    if (!ui) return;
    const view = win.visualViewport;
    ui.drawer.style.setProperty("--wt-chat-height", `${Math.max(80, (view?.height || win.innerHeight) - 16)}px`);
    ui.drawer.style.setProperty("--wt-chat-top", `${(view?.offsetTop || 0) + 8}px`);
    if (opened && dom.activeElement === ui.input) ui.input.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
  }
  function setOpen(value, focus = false) {
    if (!ui) return;
    opened = value;
    ui.drawer.hidden = !opened; ui.backdrop.hidden = !opened;
    ui.toggle.setAttribute("aria-expanded", String(opened));
    if (opened) {
      focusBefore = dom.activeElement;
      unread = 0; viewport(); updateControls();
      if (focus) (writable() ? ui.input : ui.close).focus({ preventScroll: true });
      ui.log.scrollTop = ui.log.scrollHeight;
    } else if (focus) (focusBefore?.isConnected ? focusBefore : ui.toggle).focus({ preventScroll: true });
  }
  function appendRow(event) {
    if (!ui) return;
    const row = dom.createElement("li"); row.dataset.wattenSocialEvent = event.id;
    const date = new Intl.DateTimeFormat(lang() === "de" ? "de-CH" : "en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich",
    }).format(new Date(event.time));
    row.innerHTML = `<time datetime="${esc(event.time)}">${esc(date)}</time> <strong translate="no">${esc(event.display_name)}</strong>
      ${event.role === "spectator" ? `<span class="wt-tag">${esc(t("spectator"))}</span>` : ""}
      <span>${esc(event.type === "chat" ? event.text : event.emoji)}</span>`;
    const atBottom = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 24;
    ui.log.append(row);
    while (ui.log.children.length > 100) ui.log.firstElementChild.remove();
    if (atBottom) ui.log.scrollTop = ui.log.scrollHeight;
  }
  function showBubble(event) {
    if (!ui || event.type !== "emoji") return;
    clearTimeout(bubbleTimer);
    ui.bubble.textContent = `${event.display_name}: ${event.emoji}`; ui.bubble.hidden = false;
    bubbleTimer = setTimeout(() => { if (current() && ui) { ui.bubble.hidden = true; ui.bubble.textContent = ""; } }, 3500);
  }
  function history() {
    if (!current() || !bound || requestedHistory) return;
    requestedHistory = send({ action: "watten_social_history" }) === true;
  }
  function transmit(retry = false, emoji = null) {
    if (!current() || !bound || !canSend) return;
    if (retry) {
      if (!pending || pending.channel_id !== channel) return;
    } else {
      if (!writable()) return;
      const text = draft.trim();
      if (emoji !== null ? !SOCIAL_EMOJIS.includes(emoji) : !text || text.length > 400) return;
      pending = { action: emoji ? "watten_send_emoji" : "watten_chat_message", channel_id: channel, nonce: next,
        ...(emoji ? { emoji } : { text }) };
    }
    status = ""; clearTimeout(timer);
    if (!send({ ...pending })) { status = "uncertain"; updateControls(); return; }
    timer = setTimeout(() => { if (current() && pending) { status = "uncertain"; updateControls(); } }, 8000);
    updateControls();
  }
  function bind() {
    container.innerHTML = `<section class="wt-social" aria-label="${esc(t("title"))}">
      <div class="wt-social-tools"><button type="button" data-watten-social-action="toggle" aria-controls="wattenSocialDrawer" aria-expanded="false">${esc(t("open"))} <span data-watten-social-unread hidden></span></button>
        <p class="wt-social-bubble" data-watten-social-bubble role="status" hidden></p></div>
      <button type="button" class="wt-social-backdrop" data-watten-social-backdrop aria-label="${esc(t("close"))}" hidden></button>
      <section class="wt-social-drawer" id="wattenSocialDrawer" data-watten-social-drawer role="dialog" aria-modal="true" aria-labelledby="wattenSocialTitle" hidden>
        <header><h2 id="wattenSocialTitle">${esc(t("title"))}</h2><button type="button" data-watten-social-action="close">${esc(t("close"))}</button></header>
        <p class="wt-note">${esc(t("rule"))}</p>
        <div class="wt-social-emojis" role="group" aria-label="${esc(t("emojis"))}">${SOCIAL_EMOJIS.map((emoji, index) =>
          `<button type="button" data-watten-social-action="emoji" data-emoji="${emoji}" aria-label="${esc(t(`emoji${index}`))}">${emoji}</button>`).join("")}</div>
        <ol data-watten-social-log role="log" aria-live="polite" aria-relevant="additions"></ol>
        <form data-watten-social-form><label for="wattenSocialInput" class="wt-visually-hidden">${esc(t("message"))}</label>
          <input id="wattenSocialInput" data-watten-social-input maxlength="400" autocomplete="off" placeholder="${esc(t("message"))}">
          <button type="submit" data-watten-social-action="send">${esc(t("send"))}</button></form>
        <p role="status" data-watten-social-status></p><button type="button" data-watten-social-action="retry" hidden>${esc(t("retry"))}</button>
        <button type="button" data-watten-social-action="history" hidden>${esc(t("refresh"))}</button>
      </section></section>`;
    const $ = selector => container.querySelector(selector);
    ui = { toggle: $('[data-watten-social-action="toggle"]'), close: $('[data-watten-social-action="close"]'),
      drawer: $("[data-watten-social-drawer]"), backdrop: $("[data-watten-social-backdrop]"),
      log: $("[data-watten-social-log]"), input: $("[data-watten-social-input]"), submit: $('[data-watten-social-action="send"]'),
      status: $("[data-watten-social-status]"), unread: $("[data-watten-social-unread]"), bubble: $("[data-watten-social-bubble]"),
      retry: $('[data-watten-social-action="retry"]'), refresh: $('[data-watten-social-action="history"]'),
      emojis: [...container.querySelectorAll('[data-watten-social-action="emoji"]')] };
    ui.input.value = draft;
    for (const event of log.values()) appendRow(event);
    setOpen(opened); updateControls();
    container.addEventListener("input", event => { if (event.target === ui.input) draft = ui.input.value; }, { signal: lifecycle.signal });
    container.addEventListener("submit", event => {
      if (!event.target.matches("[data-watten-social-form]")) return;
      event.preventDefault(); transmit();
    }, { signal: lifecycle.signal });
    container.addEventListener("click", event => {
      if (event.target === ui.backdrop) { event.preventDefault(); event.stopPropagation(); setOpen(false, true); return; }
      const control = event.target.closest?.("[data-watten-social-action]");
      if (!control || control.disabled || !container.contains(control)) return;
      const action = control.dataset.wattenSocialAction;
      if (action === "toggle") setOpen(!opened, true);
      if (action === "close") setOpen(false, true);
      if (action === "emoji") transmit(false, control.dataset.emoji);
      if (action === "retry") transmit(true);
      if (action === "history") { status = ""; history(); updateControls(); }
    }, { signal: lifecycle.signal });
  }
  function receive(frame) {
    const key = FRAMES.find(name => object(frame) && name in frame);
    if (!key) return false;
    const value = frame[key];
    if (!current() || !authorized || !bound || !object(value) || value.schema_version !== 1 || value.game_id !== gameId) return true;
    if (key === "watten_social_history") {
      requestedHistory = false;
      if (!token(value.channel_id) || !nonce(value.next_nonce) || typeof value.can_send !== "boolean"
          || value.live_only !== true || !log.replace(value.events)) { status = "unavailable"; updateControls(); return true; }
      next = channel === value.channel_id ? Math.max(next || 1, value.next_nonce) : value.next_nonce;
      channel = value.channel_id; canSend = value.can_send;
      if (!pending && status !== "review") status = "";
      if (pending && pending.channel_id !== channel) { pending = null; clearTimeout(timer); status = "review"; }
      if (ui) { ui.log.replaceChildren(); for (const event of log.values()) appendRow(event); }
    } else if (key === "watten_social_event") {
      const event = socialEvent(value.event);
      if (event && log.append(event)) { appendRow(event); showBubble(event); if (!opened) unread = Math.min(100, unread + 1); }
    } else if (key === "watten_social_ack") {
      if (pending && value.channel_id === pending.channel_id && value.nonce === pending.nonce
          && nonce(value.next_nonce) && value.next_nonce > value.nonce && token(value.event_id) && typeof value.replayed === "boolean") {
        if (pending.action === "watten_chat_message" && draft.trim() === pending.text) { draft = ""; if (ui) ui.input.value = ""; }
        channel = value.channel_id; next = Math.max(next || 1, value.next_nonce); pending = null; clearTimeout(timer); status = "";
      }
    } else {
      if (value.nonce !== null && (!pending || value.nonce !== pending.nonce)) return true;
      if (value.nonce === null) requestedHistory = false;
      clearTimeout(timer); pending = null;
      status = value.code === "watten_social_rate_limited" ? "rate" : value.code === "watten_social_muted" ? "readOnly" : "review";
      if (value.code === "watten_social_excluded") { excluded = true; disconnect(true); return true; }
      if (value.code === "watten_social_muted") canSend = false;
      if (["watten_social_stale_channel", "watten_social_stale_nonce", "watten_social_nonce_conflict"].includes(value.code)) {
        channel = null; next = null; requestedHistory = false; history();
      }
    }
    updateControls(); return true;
  }
  function update({ container: nextContainer, bound: online, authorized: allowed }) {
    if (!current()) return;
    const newlyBound = online && !bound;
    const newlyAuthorized = allowed && online && !authorized && !excluded;
    bound = online;
    if (allowed && online && !excluded) authorized = true;
    if (nextContainer !== container) { if (ui) ui.input.value = ""; container?.replaceChildren(); container = nextContainer; ui = null; }
    if (!container) return;
    container.hidden = !authorized;
    if (authorized && !ui) bind();
    if ((newlyBound || newlyAuthorized) && authorized) { requestedHistory = false; history(); }
    updateControls();
  }
  function disconnect(revoked = false) {
    bound = false; canSend = false; requestedHistory = false; clearTimeout(timer);
    if (revoked) {
      authorized = false; draft = ""; pending = null; channel = null; next = null; unread = 0; log.clear();
      if (ui) { ui.input.value = ""; ui.log.replaceChildren(); setOpen(false); ui.bubble.textContent = ""; ui.bubble.hidden = true; }
      if (container) container.hidden = true;
    } else if (pending) status = "uncertain";
    updateControls();
  }
  dom.addEventListener?.("click", event => {
    const control = event.target.closest?.("[data-watten-result-emoji]");
    if (control && !control.disabled) transmit(false, control.dataset.wattenResultEmoji);
  }, { signal: lifecycle.signal });
  win.addEventListener("keydown", event => {
    if (!opened || !ui) return;
    if (event.key === "Enter" && event.isComposing && event.target === ui.input) { event.preventDefault(); return; }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false, true); }
    if (event.key === "Tab") {
      const nodes = [...ui.drawer.querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled)')];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && dom.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && dom.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, { signal: lifecycle.signal });
  win.addEventListener("resize", viewport, { signal: lifecycle.signal });
  win.visualViewport?.addEventListener("resize", viewport, { signal: lifecycle.signal });
  win.visualViewport?.addEventListener("scroll", viewport, { signal: lifecycle.signal });
  function destroy() {
    disconnect(true); destroyed = true; lifecycle.abort(); clearTimeout(bubbleTimer);
    container?.replaceChildren(); container = null; ui = null;
  }
  return { update, receive, disconnect, destroy };
}
