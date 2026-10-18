import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const source = (await readFile(new URL("../frontend/watten/lobby-chat.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`));
const { lobbyMessage, lobbySocketUrl, mountWattenLobbyChat } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) { for (let i = 0; i < 40 && !condition(); i += 1) await tick(); assert.ok(condition(), "Operation did not finish"); }
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const event = (id = 1, extra = {}) => ({ id, kind: "message", sender: "Other player", is_admin: false,
  game_type: "watten", sent_at: "2026-10-18T12:00:00+00:00", text: `Message ${id}`, ...extra });

class Events {
  handlers = new Map();
  addEventListener(name, handler, options = {}) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
    options.signal?.addEventListener("abort", () => this.handlers.get(name).delete(handler), { once: true });
  }
  emit(name, value = {}) { for (const handler of this.handlers.get(name) || []) handler(value); }
}
class Node extends Events {
  innerHTML = ""; textContent = ""; value = ""; hidden = false; disabled = false; children = [];
  dataset = {};
  scrollHeight = 100; scrollTop = 0; clientHeight = 100;
  append(child) { child.parent = this; this.children.push(child); }
  get firstElementChild() { return this.children[0]; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  replaceChildren() { this.children = []; this.innerHTML = ""; }
}
class Container extends Events {
  fields = new Map(); markup = "";
  style = { values: {}, setProperty(key, value) { this.values[key] = value; } };
  set innerHTML(value) {
    this.markup = value; this.fields.clear();
    for (const name of ["notice", "status", "body", "input", "messages", "limit", "filter"]) this.fields.set(`[data-watten-lobby-chat-${name}]`, new Node());
    for (const name of ["open", "close", "reconnect", "disable", "send"]) {
      const control = new Node(); control.owner = this; control.dataset = { wattenLobbyChatAction: name };
      this.fields.set(`[data-watten-lobby-chat-action="${name}"]`, control);
    }
  }
  get innerHTML() { return this.markup; }
  querySelector(selector) { return this.fields.get(selector); }
  contains(control) { return control.owner === this; }
  replaceChildren() { this.markup = ""; this.fields.clear(); }
  click(name) {
    const control = this.querySelector(`[data-watten-lobby-chat-action="${name}"]`);
    this.emit("click", { target: { closest: () => control } });
  }
}
class Socket extends Events {
  sent = []; closed = false;
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; }
  frame(message, historical = false) { this.emit("message", { data: JSON.stringify({ lobby_chat: message, ...(historical ? { lobby_chat_history: true } : {}) }) }); }
  error(code) { this.emit("message", { data: JSON.stringify({ error: code }) }); }
}
const clients = new Set();
test.afterEach(() => { for (const client of clients) client.destroy(); clients.clear(); });
function fixture({ enabled = true, muted = false, excluded = false, language = "de", href = "http://localhost:8127/watten", auth, fetcher, authenticated = true } = {}) {
  const container = new Container(), sockets = [], calls = [], timers = new Map();
  const win = new Events(); win.location = { href }; win.innerHeight = 700; win.visualViewport = new Events(); win.visualViewport.height = 500;
  win.setTimeout = callback => { const id = Symbol(); timers.set(id, callback); return id; };
  win.clearTimeout = id => timers.delete(id);
  const dom = { activeElement: null, createElement: () => new Node() };
  let current = true, changed = 0, reads = 0, expected = 1;
  const identity = () => ({ authenticated, user: { id: 1, username: "Mounted player", csrf_token: "mounted-csrf",
    preferences: { lobby_chat_enabled: enabled, lobby_chat_muted: muted, lobby_chat_excluded: excluded, lobby_chat_popups: false } } });
  const client = mountWattenLobbyChat({ container, initialAuth: identity(), getExpectedAccountId: () => expected,
    isCurrent: () => current, onAccountChanged: () => { changed += 1; }, escapeHtml: esc,
    dom, win, language: () => language,
    loadAuth: async options => { assert.equal(options.refresh, true); reads += 1; return auth ? auth(reads, identity) : identity(); },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (fetcher) return fetcher(url, options, identity);
      enabled = JSON.parse(options.body).lobby_chat_enabled;
      return response({ lobby_chat_enabled: enabled, lobby_chat_popups: false });
    },
    createSocket: url => { const socket = new Socket(); socket.url = url; sockets.push(socket); return socket; },
  });
  clients.add(client);
  const field = name => container.querySelector(`[data-watten-lobby-chat-${name}]`);
  return { client, container, win, dom, sockets, calls, field, timers, changed: () => changed, reads: () => reads,
    draft(value) { field("input").value = value; container.emit("input", { target: field("input") }); },
    submit() { container.emit("submit", { target: { matches: () => true }, preventDefault() {} }); },
    invalidate() { current = false; }, changeExpected() { expected = 2; },
    async open() {
      container.click("open"); await until(() => sockets.length === 1);
      sockets[0].emit("open"); await until(() => !field("input").disabled || muted);
      return sockets[0];
    },
  };
}

test("strict public projection accepts four labels, codepoint400, and rejects identifiers/hidden/unknown fields", () => {
  for (const product of ["zdwa", "zilch", "hausdepp", "watten"]) assert.equal(lobbyMessage(event(1, { game_type: product })).game_type, product);
  assert.equal(lobbyMessage(event(1, { text: "😂".repeat(400) })).text.length, 800);
  assert.ok(Object.isFrozen(lobbyMessage(event())));
  for (const extra of [{ user_id: 4 }, { account_id: 4 }, { hand: ["hearts-A"] }, { avatar: "x" }, { game_type: "unknown" },
    { kind: "presence" }, { id: true }, { is_admin: "yes" }, { text: " " }, { text: "😂".repeat(401) }, { sent_at: "2026-10-18T12:00:00" }]) assert.equal(lobbyMessage(event(1, extra)), null);
  assert.doesNotMatch(JSON.stringify(lobbyMessage(event())), /is_admin|user_id|account_id/);
});

test("only local URL and positive mounted account produce a secret-free expected-account socket URL", () => {
  for (const host of ["localhost:8127", "preview.localhost", "127.0.0.1:8127", "[::1]:8127"]) {
    const url = new URL(lobbySocketUrl({ href: `http://${host}/watten?private=discard#old` }, 7));
    assert.equal(url.pathname, "/ws/lobby-chat"); assert.equal(url.search, "?context=watten&expected_account_id=7");
  }
  for (const host of ["watten.zockdiewandan.online", "zockdiewandan.online", "localhost.attacker.invalid", "192.168.1.2"]) assert.equal(lobbySocketUrl({ href: `https://${host}/watten` }, 1), null);
  for (const id of [true, 0, -1, "1", 1.5]) assert.equal(lobbySocketUrl({ href: "http://localhost/watten" }, id), null);
});

test("no subscription/preference mutation before explicit opening, and no public/anonymous mount", async () => {
  const f = fixture(); await tick(); assert.deepEqual(f.calls, []); assert.deepEqual(f.sockets, []); assert.equal(f.reads(), 0);
  assert.equal(f.field("body").hidden, true); assert.match(f.container.innerHTML, /drei Tagen|three days/);
  for (const args of [{ href: "https://watten.zockdiewandan.online/watten" }, { authenticated: false }]) {
    const blocked = fixture(args); assert.equal(blocked.container.innerHTML, ""); assert.deepEqual(blocked.sockets, []);
  }
  const ws = await f.open(); assert.equal(new URL(ws.url).searchParams.get("expected_account_id"), "1");
  assert.equal(f.calls.length, 0); assert.ok(f.reads() >= 4);
});

test("explicit global enable captures current CSRF/expected account, preserves popup setting and verifies post-body identity twice", async () => {
  const f = fixture({ enabled: false }); assert.match(f.container.querySelector('[data-watten-lobby-chat-action="open"]').textContent, /Aktivieren/);
  await f.open(); assert.equal(f.calls.length, 1);
  const call = f.calls[0]; assert.equal(call.url, "/api/auth/preferences/lobby-chat"); assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.headers["X-CSRF-Token"], "mounted-csrf"); assert.equal(call.options.headers["X-Watten-Expected-Account-Id"], "1");
  assert.deepEqual(JSON.parse(call.options.body), { lobby_chat_enabled: true }); assert.ok(f.reads() >= 7);
});

test("fresh opt-out in another session cannot be silently reversed by open or reconnect", async () => {
  let enabled = true;
  const f = fixture({ auth: (_count, identity) => {
    const auth = identity(); auth.user.preferences.lobby_chat_enabled = enabled; return auth;
  } });
  enabled = false; f.container.click("open"); await until(() => f.reads() > 0); await tick();
  assert.equal(f.calls.length, 0); assert.equal(f.sockets.length, 0);
  assert.match(f.container.querySelector('[data-watten-lobby-chat-action="open"]').textContent, /Aktivieren/);
  const g = fixture({ auth: (_count, identity) => {
    const auth = identity(); auth.user.preferences.lobby_chat_enabled = enabled; return auth;
  } });
  enabled = true; const ws = await g.open(); ws.emit("close", { code: 1006 });
  enabled = false; g.container.click("reconnect"); await tick(); await tick();
  assert.equal(g.calls.length, 0); assert.equal(g.sockets.length, 1);
  assert.equal(g.field("body").hidden, true);
});

test("explicit disable closes and clears this account's log/draft, without changing popup preference", async () => {
  const f = fixture(), ws = await f.open(); ws.frame(event()); f.draft("private draft");
  f.container.click("disable"); await until(() => f.calls.length === 1 && !f.container.querySelector('[data-watten-lobby-chat-action="open"]').disabled);
  assert.ok(ws.closed); assert.equal(f.field("input").value, ""); assert.equal(f.field("messages").children.length, 0);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { lobby_chat_enabled: false }); assert.equal(f.field("body").hidden, true);
});

test("live echo alone clears unchanged own draft; history/other-product and other sender cannot acknowledge it", async () => {
  const f = fixture(), ws = await f.open(); f.draft("  hello  "); f.submit(); await until(() => ws.sent.length === 1);
  assert.deepEqual(ws.sent[0], { action: "lobby_chat_message", text: "hello" }); assert.equal(f.field("input").value, "  hello  ");
  ws.frame(event(1, { sender: "Mounted player", text: "hello" }), true); assert.equal(f.field("input").value, "  hello  ");
  ws.frame(event(2, { sender: "Mounted player", text: "hello", game_type: "zdwa" })); assert.equal(f.field("input").value, "  hello  ");
  ws.frame(event(3, { text: "hello" })); assert.equal(f.field("input").value, "  hello  ");
  ws.frame(event(4, { sender: "Mounted player", text: "hello" })); assert.equal(f.field("input").value, ""); assert.equal(f.field("input").disabled, false);
});

test("unconfirmed text survives disconnect/history and is never retried automatically", async () => {
  const f = fixture(), ws = await f.open(); f.draft("uncertain"); f.submit(); await until(() => ws.sent.length === 1);
  ws.emit("close", { code: 1006 }); assert.equal(f.field("input").value, "uncertain"); assert.match(f.field("status").textContent, /unklar/);
  f.container.click("reconnect"); await until(() => f.sockets.length === 2);
  const next = f.sockets[1]; next.frame(event(10, { sender: "Mounted player", text: "uncertain" }), true);
  next.emit("open"); await until(() => !f.field("input").disabled);
  assert.equal(f.field("input").value, "uncertain"); assert.deepEqual(next.sent, []); assert.equal(ws.sent.length, 1);
  f.submit(); await until(() => next.sent.length === 1); assert.equal(next.sent[0].text, "uncertain");
});

test("pending timeout exposes uncertainty without resending or removing draft", async () => {
  const f = fixture(), ws = await f.open(); f.draft("retain me"); f.submit(); await until(() => ws.sent.length === 1);
  for (const callback of [...f.timers.values()]) callback();
  assert.equal(ws.sent.length, 1); assert.equal(f.field("input").value, "retain me"); assert.match(f.field("status").textContent, /unklar/);
});

test("duplicate old echo cannot acknowledge another send with the same text", async () => {
  const f = fixture(), ws = await f.open(); const old = event(1, { sender: "Mounted player", text: "same text" });
  ws.frame(old); const row = f.field("messages").children[0];
  f.draft("same text"); f.submit(); await until(() => ws.sent.length === 1); ws.frame(old);
  assert.equal(f.field("input").value, "same text"); assert.equal(f.field("input").disabled, true);
  ws.frame(event(2)); assert.equal(f.field("messages").children[0], row);
  ws.frame(event(3, { sender: "Mounted player", text: "same text" })); assert.equal(f.field("input").value, "");
});

test("invalid400plus or control-character drafts never reach socket", async () => {
  const f = fixture(), ws = await f.open();
  for (const text of ["😂".repeat(401), "x\x00y"]) {
    f.draft(text); f.submit(); await tick(); assert.equal(ws.sent.length, 0); assert.equal(f.field("input").value, text);
  }
  f.draft("😂".repeat(400)); f.submit(); await until(() => ws.sent.length === 1);
});

test("history waits for decisive fresh identity and account switch clears RAM/DOM before stale callbacks", async () => {
  let release; let reads = 0;
  const f = fixture({ auth: async (_count, identity) => {
    reads += 1; if (reads === 4) return new Promise(resolve => { release = () => resolve({ authenticated: true, user: { id: 2 } }); });
    return identity();
  } });
  f.container.click("open"); await until(() => f.sockets.length === 1); const ws = f.sockets[0];
  ws.emit("open"); ws.frame(event(1, { text: "OLD ACCOUNT HISTORY" }), true);
  await until(() => release); assert.doesNotMatch(f.field("messages").children.map(row => row.innerHTML).join(""), /OLD ACCOUNT/);
  release(); await until(() => f.changed() === 1); assert.equal(f.container.innerHTML, ""); assert.ok(ws.closed);
  ws.frame(event(2)); assert.equal(f.container.innerHTML, "");
});

test("account change after preference response body cannot expose a new-account socket", async () => {
  let reads = 0;
  const f = fixture({ enabled: false, auth: (_count, identity) => {
    reads += 1; return reads === 4 ? { authenticated: true, user: { id: 2 } } : identity();
  } });
  f.container.click("open"); await until(() => f.changed() === 1);
  assert.equal(f.calls.length, 1); assert.equal(f.sockets.length, 0); assert.equal(f.container.innerHTML, "");
});

test("four-product filter and escaped public rendering never create avatar/profile/identity attributes", async () => {
  const f = fixture(), ws = await f.open();
  ws.frame(event(1, { sender: '<img onerror="x">', text: "<script>bad()</script>" }));
  assert.match(f.field("messages").children[0].innerHTML, /&lt;img/); assert.doesNotMatch(f.field("messages").children[0].innerHTML, /<script>|<img|href=|data-user/);
  ws.frame(event(2, { game_type: "hausdepp" }));
  f.field("filter").value = "hausdepp"; f.field("filter").emit("change");
  assert.equal(f.field("messages").children.length, 1); assert.match(f.field("messages").children[0].innerHTML, /Hausdepp/);
  assert.doesNotMatch(source, /avatarMarkup|playerProfileHref|localStorage|sessionStorage|gameId|_watten|hand|stock|partner_feedback/);
});

test("bounded memory, deduplication and explicit cap notice do not trust malformed/hidden payloads", async () => {
  const f = fixture(), ws = await f.open();
  for (let id = 1; id <= 505; id += 1) ws.frame(event(id), true);
  assert.equal(f.field("messages").children.length, 500); assert.equal(f.field("limit").hidden, false);
  ws.frame(event(505)); assert.equal(f.field("messages").children.length, 500);
  ws.frame(event(506, { user_id: 99 })); assert.equal(f.field("messages").children.length, 500); assert.match(f.field("status").textContent, /sicher/);
});

test("muted accounts read but cannot send; exclusion and global disable clear personal DOM", async () => {
  const f = fixture({ muted: true }), ws = await f.open(); ws.frame(event()); f.draft("blocked"); f.submit();
  await tick(); assert.deepEqual(ws.sent, []); assert.match(f.field("status").textContent, /stummgeschaltet/);
  assert.equal(f.field("messages").children.length, 1); ws.error("lobby_chat_excluded");
  assert.equal(f.field("body").hidden, true); assert.equal(f.field("messages").children.length, 0); assert.equal(f.field("input").value, "");
  const g = fixture(), other = await g.open(); other.frame(event()); other.error("lobby_chat_disabled"); assert.equal(g.field("messages").children.length, 0);
});

test("network and privacy errors are DE/EN, retain recoverable drafts, and never run automatic writes", async () => {
  for (const language of ["de", "en"]) {
    const f = fixture({ language }), ws = await f.open(); f.draft("keep me");
    for (const code of ["lobby_chat_rate_limited", "lobby_chat_message_invalid", "lobby_chat_action_unknown"]) {
      ws.error(code); assert.ok(f.field("status").textContent); assert.equal(f.field("input").value, "keep me");
    }
    ws.emit("close", { code: 1008 }); assert.equal(f.field("input").value, ""); assert.equal(f.calls.length, 0);
    assert.match(f.field("status").textContent, language === "en" ? /access/ : /Zugriff/);
  }
});

test("pagehide closes socket, clears draft/history/timers/listeners and ignores pending auth completions", async () => {
  const f = fixture(), ws = await f.open(); ws.frame(event()); f.draft("private draft"); f.submit(); await until(() => ws.sent.length === 1);
  f.win.emit("pagehide"); assert.equal(f.container.innerHTML, ""); assert.ok(ws.closed); assert.equal(f.timers.size, 0);
  ws.frame(event(2)); f.win.emit("resize"); assert.equal(f.container.innerHTML, "");
});

test("keyboard/rotation changes viewport height without remounting composer or losing draft", async () => {
  const f = fixture(), ws = await f.open(); f.draft("rotate draft"); const input = f.field("input");
  let scrolled = false; input.scrollIntoView = () => { scrolled = true; }; f.dom.activeElement = input;
  f.win.visualViewport.height = 220; f.win.visualViewport.emit("resize");
  assert.equal(f.container.style.values["--wt-lobby-chat-height"], "88px"); assert.equal(f.field("input"), input);
  assert.equal(input.value, "rotate draft"); assert.ok(scrolled); assert.deepEqual(ws.sent, []);
});

test("game integration is confined to authenticated lobby and cleanup, with both catalogs complete", async () => {
  const game = await readFile(new URL("../frontend/watten/game.js", import.meta.url), "utf8");
  const lobby = game.slice(game.indexOf("async function mountLobby()"), game.indexOf("// Table session"));
  assert.ok(lobby.indexOf("if (!auth.authenticated)") < lobby.indexOf("mountWattenLobbyChat("));
  assert.match(lobby, /initialAuth: auth/); assert.match(lobby, /cleanups\.add\(\(\) => lobbyChat\.destroy\(\)\)/);
  const catalogs = await import(`data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`);
  assert.deepEqual(Object.keys(catalogs.WATTEN_LOBBY_CHAT_MESSAGES.de).sort(), Object.keys(catalogs.WATTEN_LOBBY_CHAT_MESSAGES.en).sort());
});
