import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`;
const source = (await readFile(new URL("../frontend/watten/social.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(catalogUrl));
const { createSocial, createSocialLog, socialEvent, SOCIAL_EMOJIS, resultReactionsMarkup } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const gameId = "0123456789abcdef";
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const event = (index = 1, extra = {}) => ({ id: `event-${index}`, type: "chat", sender_id: "p1", display_name: "Public player",
  role: "member", text: `Message ${index}`, time: "2026-10-18T12:00:00+00:00", ...extra });
const history = (extra = {}) => ({ watten_social_history: { schema_version: 1, game_id: gameId, events: [],
  channel_id: "own-channel", next_nonce: 1, can_send: true, live_only: true, ...extra } });
const frame = item => ({ watten_social_event: { schema_version: 1, game_id: gameId, event: item } });
const ack = (extra = {}) => ({ watten_social_ack: { schema_version: 1, game_id: gameId, channel_id: "own-channel",
  nonce: 1, next_nonce: 2, event_id: "event-1", replayed: false, ...extra } });
const error = (code, value = 1) => ({ watten_social_error: { schema_version: 1, game_id: gameId, nonce: value, code } });

class Events {
  handlers = new Map();
  addEventListener(name, handler, options = {}) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
    options.signal?.addEventListener("abort", () => this.handlers.get(name).delete(handler), { once: true });
  }
  emit(name, event) { for (const handler of this.handlers.get(name) || []) handler(event); }
}
class Node extends Events {
  constructor(dom) { super(); this.dom = dom; }
  hidden = false; disabled = false; isConnected = true; value = ""; textContent = ""; innerHTML = "";
  dataset = {}; children = []; attributes = {}; scrollTop = 0; scrollHeight = 100; clientHeight = 100;
  style = { values: {}, setProperty(key, value) { this.values[key] = value; } };
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { this.dom.activeElement = this; }
  append(child) { child.parent = this; this.children.push(child); this.scrollHeight = this.children.length * 20; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  get firstElementChild() { return this.children[0]; }
  replaceChildren() { this.children = []; this.innerHTML = ""; }
}
class Root extends Events {
  constructor(dom) { super(); this.dom = dom; }
  hidden = true; fields = new Map(); markup = "";
  set innerHTML(value) {
    this.markup = value; this.fields.clear();
    for (const name of ["drawer", "backdrop", "log", "input", "status", "unread", "bubble"]) {
      this.fields.set(`[data-watten-social-${name}]`, new Node(this.dom));
    }
    for (const action of ["toggle", "close", "send", "retry", "history"]) {
      const node = new Node(this.dom); node.owner = this; node.dataset.wattenSocialAction = action;
      this.fields.set(`[data-watten-social-action="${action}"]`, node);
    }
    this.emojis = SOCIAL_EMOJIS.map(emoji => {
      const node = new Node(this.dom); node.owner = this; node.dataset = { wattenSocialAction: "emoji", emoji }; return node;
    });
    this.querySelector("[data-watten-social-drawer]").querySelectorAll = () => [
      this.querySelector('[data-watten-social-action="close"]'), ...this.emojis,
      this.querySelector("[data-watten-social-input]"), this.querySelector('[data-watten-social-action="send"]'),
      this.querySelector('[data-watten-social-action="retry"]'), this.querySelector('[data-watten-social-action="history"]'),
    ].filter(node => !node.hidden && !node.disabled);
  }
  get innerHTML() { return this.markup; }
  querySelector(selector) { return this.fields.get(selector); }
  querySelectorAll() { return this.emojis; }
  contains(control) { return control.owner === this; }
  replaceChildren() { this.markup = ""; this.fields.clear(); }
  click(action, emoji = null) {
    const control = emoji ? this.emojis.find(node => node.dataset.emoji === emoji)
      : this.querySelector(`[data-watten-social-action="${action}"]`);
    this.emit("click", { target: { closest: () => control }, preventDefault() {}, stopPropagation() {} });
  }
}
const clients = new Set();
test.afterEach(() => { for (const client of clients) client.destroy(); clients.clear(); });
function fixture({ language = "de", connected = true } = {}) {
  const dom = Object.assign(new Events(), { activeElement: null, createElement: () => new Node(dom) });
  const win = new Events(); win.innerHeight = 700; win.visualViewport = new Events(); win.visualViewport.height = 500;
  const root = new Root(dom), calls = [];
  let current = true, account = 1;
  const client = createSocial({ gameId, escapeHtml, language: () => language, dom, win,
    getExpectedAccountId: () => account, isCurrent: () => current, send: value => { calls.push(value); return true; } });
  clients.add(client);
  const update = (extra = {}) => client.update({ container: root, authorized: true, bound: true, ...extra });
  if (connected) { update(); client.receive(history()); }
  return { client, root, calls, dom, win, update, field: key => root.querySelector(`[data-watten-social-${key}]`),
    draft(text) { const input = root.querySelector("[data-watten-social-input]"); input.value = text; root.emit("input", { target: input }); },
    submit() { root.emit("submit", { target: { matches: () => true }, preventDefault() {} }); },
    invalidate() { current = false; }, changeAccount() { account = 2; } };
}

test("public event normalization is strict, finite and never retains hidden fields", () => {
  assert.equal(SOCIAL_EMOJIS.length, 12); assert.equal(new Set(SOCIAL_EMOJIS).size, 12);
  assert.ok(Object.isFrozen(socialEvent(event())));
  for (const extra of [{ account_id: 42 }, { hand: ["hearts-A"] }, { role: "cpu" }, { type: "cards" },
    { text: " " }, { text: "x".repeat(401) }, { time: "2026-10-18" }, { display_name: "" }]) assert.equal(socialEvent(event(1, extra)), null);
  for (const emoji of SOCIAL_EMOJIS) {
    const item = event(1, { type: "emoji", emoji }); delete item.text; assert.ok(socialEvent(item));
  }
  const bad = event(1, { type: "emoji", emoji: "🃏" }); delete bad.text; assert.equal(socialEvent(bad), null);
});

test("room memory is bounded100, deduplicated, rejects bad history atomically and makes no browser storage calls", () => {
  const log = createSocialLog();
  for (let index = 0; index < 110; index += 1) assert.equal(log.append(event(index)), true);
  assert.equal(log.values().length, 100); assert.equal(log.values()[0].id, "event-10");
  assert.equal(log.append(event(109)), false);
  assert.equal(log.replace([event(1), event(1)]), false); assert.equal(log.values().length, 100);
  assert.equal(log.replace([event(1, { account_id: 2 })]), false);
  assert.equal(log.replace([event(3)]), true); assert.deepEqual(log.values(), [event(3)]);
  assert.doesNotMatch(source, /localStorage|sessionStorage|avatarMarkup|playerProfileHref/);
});

test("only an admitted bound account mounts or requests history; closed HTTP cannot send", () => {
  const f = fixture({ connected: false });
  f.update({ bound: false }); assert.equal(f.root.innerHTML, ""); assert.deepEqual(f.calls, []);
  f.update({ authorized: false }); assert.equal(f.root.innerHTML, ""); assert.deepEqual(f.calls, []);
  f.update(); assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0], { action: "watten_social_history" });
  f.client.receive(history()); f.client.disconnect(); f.draft("offline"); f.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.field("input").value, "offline"); assert.equal(f.field("input").disabled, true);
});

test("public event updates append escaped log and toolbar bubble only, bounded and deduplicated", () => {
  const f = fixture();
  f.client.receive(frame(event(1, { display_name: '<img onerror="bad()">', text: "<script>bad()</script>" })));
  assert.match(f.field("log").children[0].innerHTML, /&lt;img/); assert.doesNotMatch(f.field("log").children[0].innerHTML, /<script>|<img/);
  assert.equal(f.field("unread").textContent, "1");
  f.client.receive(frame(event(1))); assert.equal(f.field("log").children.length, 1);
  const emoji = event(2, { type: "emoji", emoji: "🎉", role: "spectator" }); delete emoji.text;
  f.client.receive(frame(emoji)); assert.equal(f.field("bubble").textContent, "Public player: 🎉");
  assert.match(f.field("log").children[1].innerHTML, /Zuschauer/);
  for (let index = 3; index < 120; index += 1) f.client.receive(frame(event(index)));
  assert.equal(f.field("log").children.length, 100); assert.equal(f.field("unread").textContent, "100");
});

test("text send is independent from gameplay phase, captures nonce, waits ACK and handles public echo once", () => {
  const f = fixture(); f.draft("  hello  "); f.submit(); f.submit();
  assert.deepEqual(f.calls[1], { action: "watten_chat_message", channel_id: "own-channel", nonce: 1, text: "hello" });
  assert.equal(f.calls.length, 2); assert.equal(f.field("input").value, "  hello  "); assert.equal(f.field("input").disabled, true);
  f.client.receive(frame(event(1, { text: "hello" }))); f.client.receive(frame(event(1, { text: "hello" })));
  assert.equal(f.field("log").children.length, 1);
  f.client.receive(ack()); assert.equal(f.field("input").value, ""); assert.equal(f.field("input").disabled, false);
  f.root.click("emoji", "🔥"); assert.deepEqual(f.calls.at(-1), { action: "watten_send_emoji", channel_id: "own-channel", nonce: 2, emoji: "🔥" });
  assert.doesNotMatch(source, /engine\.actions|card_turn|gestrichen|partner_feedback|renderHand|createTableView/);
});

test("result reactions reuse the authenticated public channel and remain disabled offline or revoked", () => {
  const f = fixture(), button = new Node(f.dom), status = new Node(f.dom);
  button.dataset.wattenResultEmoji = "🎉";
  f.dom.querySelectorAll = selector => selector === "[data-watten-result-emoji]" ? [button] : [status];
  f.update(); assert.equal(button.disabled, false);
  f.dom.emit("click", { target: { closest: () => button } });
  assert.deepEqual(f.calls.at(-1), { action: "watten_send_emoji", channel_id: "own-channel", nonce: 1, emoji: "🎉" });
  assert.equal(button.disabled, true);
  f.client.receive(ack()); assert.equal(button.disabled, false);
  f.client.disconnect(); assert.equal(button.disabled, true);
  f.dom.emit("click", { target: { closest: () => button } });
  assert.equal(f.calls.length, 2);
  f.client.disconnect(true); f.update(); assert.equal(button.disabled, true);
  for (const language of ["de", "en"]) {
    const markup = resultReactionsMarkup(language, escapeHtml);
    assert.equal((markup.match(/data-watten-result-emoji=/g) || []).length, 4);
    assert.match(markup, language === "de" ? /Schnelle Reaktionen/ : /Quick reactions/);
  }
});

test("stale nonce refreshes history with draft retained and no automatic resend", () => {
  const f = fixture(); f.draft("review me"); f.submit(); f.client.receive(error("watten_social_nonce_conflict"));
  assert.deepEqual(f.calls.map(value => value.action), ["watten_social_history", "watten_chat_message", "watten_social_history"]);
  f.client.receive(history({ next_nonce: 5 })); assert.equal(f.field("input").value, "review me");
  assert.equal(f.calls.length, 3); assert.match(f.field("status").textContent, /Prüfe/);
  f.submit(); assert.equal(f.calls.at(-1).nonce, 5);
});

test("uncertain reconnect retry is explicit and repeats only its own original envelope", () => {
  const f = fixture(); f.draft("uncertain"); f.submit(); const original = f.calls[1];
  f.client.disconnect(); f.update(); f.client.receive(history({ next_nonce: 2 }));
  assert.equal(f.calls.filter(value => value.action === "watten_chat_message").length, 1);
  assert.equal(f.root.querySelector('[data-watten-social-action="retry"]').hidden, false);
  f.root.click("retry"); assert.deepEqual(f.calls.at(-1), original);
  f.client.receive(ack({ replayed: true })); assert.equal(f.field("input").value, "");
});

test("a new channel discards uncertain transport without resending or losing the editable draft", () => {
  const f = fixture(); f.draft("check history first"); f.submit(); f.client.disconnect(); f.update();
  f.client.receive(history({ channel_id: "new-channel", next_nonce: 1 }));
  assert.equal(f.field("input").value, "check history first"); assert.equal(f.field("input").disabled, false);
  assert.equal(f.calls.filter(value => value.action === "watten_chat_message").length, 1);
  f.submit(); assert.equal(f.calls.at(-1).channel_id, "new-channel");
});

test("muted is read-only; exclusion/revocation clears history, draft and drawer without reactivating on game updates", () => {
  const f = fixture(); f.client.receive(history({ can_send: false, events: [event()] }));
  assert.equal(f.field("input").disabled, true); assert.equal(f.field("log").children.length, 1);
  f.client.receive(history()); f.draft("private draft"); f.root.click("toggle");
  f.client.receive(error("watten_social_excluded", null));
  assert.equal(f.root.hidden, true); assert.equal(f.field("input").value, ""); assert.equal(f.field("log").children.length, 0);
  assert.equal(f.field("drawer").hidden, true); const before = f.calls.length;
  f.update(); assert.equal(f.root.hidden, true); assert.equal(f.calls.length, before);
});

test("drawer starts collapsed, resets unread, handles escape/backdrop, traps focus and retains draft on keyboard resize", () => {
  const f = fixture(); assert.equal(f.field("drawer").hidden, true);
  f.client.receive(frame(event())); f.root.click("toggle"); assert.equal(f.field("drawer").hidden, false);
  assert.equal(f.field("unread").hidden, true); assert.equal(f.dom.activeElement, f.field("input"));
  let composerPositioned = false; f.field("input").scrollIntoView = () => { composerPositioned = true; };
  f.draft("rotate me"); f.win.visualViewport.height = 240; f.win.visualViewport.emit("resize", {});
  assert.equal(f.field("drawer").style.values["--wt-chat-height"], "224px"); assert.equal(f.field("input").value, "rotate me");
  assert.equal(composerPositioned, true);
  let prevented = false;
  f.win.emit("keydown", { key: "Escape", preventDefault() { prevented = true; } });
  assert.ok(prevented); assert.equal(f.field("drawer").hidden, true);
  assert.equal(f.dom.activeElement, f.root.querySelector('[data-watten-social-action="toggle"]'));
  f.root.click("toggle"); const submit = f.root.querySelector('[data-watten-social-action="send"]'); submit.focus();
  f.win.emit("keydown", { key: "Tab", shiftKey: false, preventDefault() {} });
  assert.equal(f.dom.activeElement, f.root.querySelector('[data-watten-social-action="close"]'));
  f.root.emit("click", { target: f.field("backdrop"), preventDefault() {}, stopPropagation() {} });
  assert.equal(f.field("drawer").hidden, true); assert.equal(f.field("input").value, "rotate me");
});

test("other-table, malformed and late previous-account frames never mount; destroy removes instance listeners", () => {
  const f = fixture(); assert.equal(f.client.receive({ scoreboard: {} }), false);
  assert.equal(f.client.receive({ watten_social_event: { ...frame(event()).watten_social_event, game_id: "other" } }), true);
  f.client.receive(frame(event(1, { account_id: 9 }))); assert.equal(f.field("log").children.length, 0);
  f.draft("clear me"); f.client.destroy(); assert.equal(f.root.innerHTML, "");
  assert.equal([...f.win.handlers.values()].every(handlers => handlers.size === 0), true);
  f.client.receive(frame(event())); assert.equal(f.root.innerHTML, "");
});

test("history errors expose an explicit read retry and all DE/EN keys agree", async () => {
  const f = fixture({ connected: false }); f.update(); f.client.receive(error("watten_social_busy", null));
  assert.equal(f.root.querySelector('[data-watten-social-action="history"]').hidden, false);
  f.root.click("history"); assert.deepEqual(f.calls.at(-1), { action: "watten_social_history" });
  const values = await import(catalogUrl);
  assert.deepEqual(Object.keys(values.WATTEN_SOCIAL_MESSAGES.de).sort(), Object.keys(values.WATTEN_SOCIAL_MESSAGES.en).sort());
  for (const language of ["de", "en"]) assert.match(values.WATTEN_SOCIAL_MESSAGES[language].rule, language === "de" ? /Keine Kartenhinweise/ : /No card hints/);
  const game = await readFile(new URL("../frontend/watten/game.js", import.meta.url), "utf8");
  assert.ok(game.indexOf("if (social?.receive(data)) return;") < game.indexOf("if (data.scoreboard) adopt"));
  assert.match(game, /data-watten-view><\/div>\s*<div data-watten-social hidden>/);
  const css = await readFile(new URL("../frontend/styles/watten-game.css", import.meta.url), "utf8");
  assert.match(css, /\.wt-social-emojis button[^}]*44px/); assert.match(css, /prefers-reduced-motion/);
});

test("a delayed cached ACK cannot lower a newer same-channel nonce", () => {
  const f = fixture(); f.draft("first"); f.submit();
  f.client.receive(history({ next_nonce: 5 })); f.client.receive(ack({ next_nonce: 2 }));
  f.draft("second"); f.submit(); assert.equal(f.calls.at(-1).nonce, 5);
});
