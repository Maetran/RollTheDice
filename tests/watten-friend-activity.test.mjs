import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const source = (await readFile(new URL("../frontend/watten/friend-activity.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`));
const { createFriendActivity, friendActivitySocketUrl, validateFriendStart } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition, message = "condition not reached") {
  for (let index = 0; index < 40 && !condition(); index += 1) await tick();
  assert.ok(condition(), message);
}
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, letter => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[letter]);
const NOW = Date.parse("2026-10-18T12:00:10Z");
const ROUTES = { watten: id => `/watten/spiel/${id}/zuschauen`, hausdepp: id => `/hausdepp/spiel/${id}/zuschauen`,
  zilch: id => `/zilch/spiel/${id}/zuschauen`, zdwa: id => `/spiel/${id}/zuschauen` };
const IDS = { watten: "0123456789abcdef", hausdepp: "hd-42", zilch: "Zx9", zdwa: "abc-123" };
const MODES = { watten: "4", hausdepp: "5", zilch: "2v2", zdwa: "1" };
function start(product = "watten", extra = {}) {
  const gameId = extra.game_id ?? IDS[product];
  return { schema_version: 1, id: `start:${product}:${gameId}`, game_id: gameId, game_type: product,
    players: [{ username: "Anna" }], player_count: product === "watten" ? Number(MODES[product]) : 4, mode: MODES[product],
    started_at: "2026-10-18T12:00:00.123456+00:00", expires_at: "2026-10-18T12:01:00.123456+00:00",
    spectator_url: ROUTES[product]?.(gameId) ?? "/spiel/x/zuschauen", ...extra };
}
const user = (id, enabled = true) => ({ authenticated: true, user: { id, csrf_token: `csrf-${id}`, preferences: { friend_activity_enabled: enabled } } });

class Container extends EventTarget {
  innerHTML = "";
  hidden = false;
  replaceChildren() { this.innerHTML = ""; }
  contains(control) { return control.owner === this; }
  click(action, noticeId) {
    const control = { owner: this, disabled: false, dataset: { wattenFriendAction: action, noticeId } };
    const event = new Event("click");
    Object.defineProperty(event, "target", { value: { closest: () => control } });
    this.dispatchEvent(event);
  }
  get items() { return (this.innerHTML.match(/<li /g) || []).length; }
}

class Socket extends EventTarget {
  readyState = 0;
  sent = [];
  closed = false;
  constructor(url) { super(); this.url = url; }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  frame(value) {
    const event = new Event("message");
    event.data = typeof value === "string" ? value : JSON.stringify(value);
    this.dispatchEvent(event);
  }
  end(code) { const event = new Event("close"); event.code = code; this.dispatchEvent(event); }
}

function makeWindow() {
  const win = new EventTarget();
  let sequence = 0;
  win.location = { href: "https://watten.example/watten?x=1#y" };
  win.timers = new Map();
  win.setTimeout = (fn, ms) => { sequence += 1; win.timers.set(sequence, { fn, ms, kind: "timeout" }); return sequence; };
  win.setInterval = (fn, ms) => { sequence += 1; win.timers.set(sequence, { fn, ms, kind: "interval" }); return sequence; };
  win.clearTimeout = id => { if (win.timers.get(id)?.kind === "timeout") win.timers.delete(id); };
  win.clearInterval = id => { if (win.timers.get(id)?.kind === "interval") win.timers.delete(id); };
  win.of = kind => [...win.timers.entries()].filter(([, timer]) => timer.kind === kind);
  win.fireTimeouts = () => { for (const [id, timer] of win.of("timeout")) { win.timers.delete(id); timer.fn(); } };
  win.fireIntervals = () => { for (const [, timer] of win.of("interval")) timer.fn(); };
  return win;
}

function fixture({ auth, placement = "lobby" } = {}) {
  const container = new Container(), win = makeWindow(), sockets = [], watched = [];
  let changed = 0, current = true, reads = 0, time = NOW;
  const client = createFriendActivity({ container, placement, win, escapeHtml, language: () => "de",
    getExpectedAccountId: () => 7, isCurrent: () => current, now: () => time,
    onAccountChanged: () => { changed += 1; }, onWatch: url => watched.push(url),
    loadAuth: async options => { assert.equal(options.refresh, true); reads += 1; return auth ? auth(reads) : user(7); },
    createSocket: url => { const socket = new Socket(url); sockets.push(socket); return socket; } });
  return { client, container, win, sockets, watched, changed: () => changed, reads: () => reads,
    invalidate: () => { current = false; }, advance: ms => { time += ms; } };
}

async function ready(f, enabled = true, index = 0) {
  await until(() => f.sockets.length === index + 1, "socket not created");
  f.sockets[index].open();
  await until(() => f.win.of("interval").length === 1, "ping timer not started");
  f.sockets[index].frame({ friend_activity_ready: { viewer_id: 7, enabled } });
}

test("socket URL is same-origin, explicit native context and bound to the captured account", () => {
  const url = new URL(friendActivitySocketUrl({ href: "https://watten.example/watten?x=1#y" }, 7));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "watten.example");
  assert.equal(url.pathname, "/ws/friend-activity");
  assert.deepEqual([...url.searchParams], [["context", "watten"], ["expected_account_id", "7"]]);
  assert.equal(friendActivitySocketUrl({ href: "http://localhost:8000/watten" }, 7).startsWith("ws://localhost:8000/"), true);
  assert.equal(friendActivitySocketUrl({ href: "https://watten.example/" }, 0), null);
  assert.equal(friendActivitySocketUrl({ href: "file:///watten" }, 7), null);
});

test("all four products map strictly to their own spectator route", () => {
  for (const product of Object.keys(ROUTES)) {
    const notice = validateFriendStart(start(product), NOW);
    assert.ok(notice, product);
    assert.equal(notice.url, ROUTES[product](IDS[product]));
    assert.deepEqual([...notice.names], ["Anna"]);
    assert.equal(Object.isFrozen(notice), true);
  }
});

test("invalid products, routes, fields, modes and timestamps are dropped", () => {
  const rejected = [
    { ...start("watten"), game_type: "bingo", id: "start:bingo:0123456789abcdef" },
    start("zdwa", { spectator_url: "/zilch/spiel/abc-123/zuschauen" }),
    start("watten", { spectator_url: "/spiel/0123456789abcdef/zuschauen" }),
    start("watten", { game_id: "hd-42" }),
    start("zdwa", { game_id: "a%2Fb" }), start("zdwa", { game_id: "../x" }), start("zdwa", { game_id: "x".repeat(65) }),
    start("zdwa", { spectator_url: "/spiel/abc-123/zuschauen?x=1" }),
    start("zdwa", { spectator_url: "https://evil.example/spiel/abc-123/zuschauen" }),
    start("hausdepp", { id: "start:hausdepp:other" }),
    { ...start("watten"), hardcore: false },
    (() => { const value = start("watten"); delete value.spectator_url; return value; })(),
    start("watten", { schema_version: 2 }),
    start("watten", { mode: "5" }), start("hausdepp", { mode: "2v2" }), start("zilch", { mode: "6" }),
    start("watten", { player_count: 3 }), start("hausdepp", { player_count: 7 }),
    start("zdwa", { players: [] }), start("zdwa", { players: [{ id: 3, username: "Anna" }] }),
    start("zdwa", { players: [{ username: " " }] }), start("zdwa", { players: [{ username: "x".repeat(65) }] }),
    start("zdwa", { player_count: 1, players: [{ username: "A" }, { username: "B" }] }),
    start("watten", { expires_at: "2026-10-18T12:02:00+00:00" }),
    start("watten", { started_at: "yesterday" }), start("watten", { started_at: "2026-10-18T12:00:00" }),
  ];
  for (const value of rejected) assert.equal(validateFriendStart(value, NOW), null, JSON.stringify(value));
  assert.equal(validateFriendStart(start("watten"), Date.parse("2026-10-18T12:01:00.123Z")), null, "expired");
  assert.equal(validateFriendStart(start("watten"), Date.parse("2026-10-18T11:59:00Z")), null, "far future");
  assert.equal(validateFriendStart(start("watten"), Number.NaN), null);
  assert.equal(validateFriendStart(null, NOW), null);
});

test("one exact ping timer; network close reconnects with a fresh socket and still one timer", async () => {
  const f = fixture();
  await ready(f);
  const socket = f.sockets[0];
  assert.equal(new URL(socket.url).searchParams.get("expected_account_id"), "7");
  const [[, ping]] = f.win.of("interval");
  assert.equal(ping.ms, 25_000);
  f.win.fireIntervals();
  assert.deepEqual(socket.sent, ['{"action":"ping"}']);
  socket.frame({ pong: true });
  socket.end(1006);
  assert.equal(socket.closed, true);
  assert.equal(f.win.of("interval").length, 0);
  assert.equal(f.win.of("timeout").length, 1);
  f.win.fireTimeouts();
  await ready(f, true, 1);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.win.of("interval").length, 1);
  f.client.destroy();
  assert.equal(f.win.timers.size, 0);
});

test("reconnects are bounded while the same account stays opted in", async () => {
  const f = fixture();
  await until(() => f.sockets.length === 1);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    f.sockets.at(-1).end(1006);
    f.win.fireTimeouts();
    await tick(); await tick();
  }
  assert.equal(f.sockets.length, 6);
  assert.equal(f.win.timers.size, 0);
});

test("false consent closes and never reconnects or enables itself", async () => {
  const f = fixture();
  await ready(f, false);
  assert.equal(f.sockets[0].closed, true);
  f.sockets[0].end(1000);
  f.win.fireTimeouts(); await tick();
  assert.equal(f.sockets.length, 1);
  assert.equal(f.win.timers.size, 0);

  const disabled = fixture({ auth: () => user(7, false) });
  await until(() => disabled.reads() === 1); await tick();
  assert.equal(disabled.sockets.length, 0);
});

test("an access boundary close (1008) is not retried", async () => {
  const f = fixture();
  await ready(f);
  f.sockets[0].end(1008);
  f.win.fireTimeouts(); await tick(); await tick();
  assert.equal(f.sockets.length, 1);
});

test("a notice burst cannot accumulate unbounded pending presentations behind an unavailable auth read", async () => {
  const releases = [];
  const f = fixture({ auth: reads => reads <= 3 ? user(7) : new Promise(resolve => releases.push(resolve)) });
  await ready(f);
  for (let index = 0; index < 100; index += 1) {
    f.sockets[0].frame({ friend_activity: start("watten", { game_id: index.toString(16).padStart(16, "0") }) });
  }
  await tick();
  assert.equal(releases.length, 20);
  assert.equal(f.container.items, 0);
  f.client.destroy();
  for (const resolve of releases) resolve(user(7));
  await tick(); await tick();
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.win.timers.size, 0);
});

test("account A->B before connecting, after open or before a frame is shown clears without display", async () => {
  const before = fixture({ auth: () => user(8) });
  await until(() => before.changed() === 1);
  assert.equal(before.sockets.length, 0);

  const afterOpen = fixture({ auth: reads => user(reads <= 1 ? 7 : 8) });
  await until(() => afterOpen.sockets.length === 1);
  afterOpen.sockets[0].frame({ friend_activity_ready: { viewer_id: 7, enabled: true } });
  afterOpen.sockets[0].open();
  await until(() => afterOpen.changed() === 1);
  assert.equal(afterOpen.sockets[0].closed, true);
  assert.equal(afterOpen.win.timers.size, 0);

  const frame = fixture({ auth: reads => user(reads <= 3 ? 7 : 8) });
  await ready(frame);
  frame.sockets[0].frame({ friend_activity: start("hausdepp") });
  await until(() => frame.changed() === 1);
  assert.equal(frame.container.innerHTML, "");
  assert.equal(frame.container.hidden, true);
});

test("a ready frame for another viewer is treated as an account change", async () => {
  const f = fixture();
  await until(() => f.sockets.length === 1);
  f.sockets[0].open();
  await until(() => f.win.of("interval").length === 1);
  f.sockets[0].frame({ friend_activity_ready: { viewer_id: 8, enabled: true } });
  assert.equal(f.changed(), 1);
  assert.equal(f.sockets[0].closed, true);
});

test("lobby notices render names literally, dedupe by id and only navigate on an explicit Watch", async () => {
  const f = fixture();
  await ready(f);
  const value = start("zdwa", { players: [{ username: "<img src=x onerror=alert(1)>" }, { username: "Bea" }] });
  f.sockets[0].frame({ friend_activity: value });
  f.sockets[0].frame({ friend_activity: value });
  await until(() => f.container.items === 1);
  await tick(); await tick();
  assert.equal(f.container.items, 1);
  assert.match(f.container.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;, Bea haben gerade eine Partie ZDWA begonnen/);
  assert.ok(!f.container.innerHTML.includes("<img"));
  assert.ok(!f.container.innerHTML.includes("/spiel/abc-123"), "the target is never taken from the DOM");
  assert.equal(f.watched.length, 0);
  assert.deepEqual(f.sockets[0].sent, [], "no table or game action is sent");
  f.container.click("watch", value.id);
  assert.deepEqual(f.watched, ["/spiel/abc-123/zuschauen"]);
});

test("notices expire after their bounded lifetime and can be dismissed", async () => {
  const f = fixture();
  await ready(f);
  f.sockets[0].frame({ friend_activity: start("watten") });
  f.sockets[0].frame({ friend_activity: start("zilch") });
  await until(() => f.container.items === 2);
  const timeouts = f.win.of("timeout").map(([, timer]) => timer.ms);
  assert.ok(timeouts.every(ms => ms > 0 && ms <= 60_000));
  f.container.click("dismiss", start("zilch").id);
  assert.equal(f.container.items, 1);
  f.advance(60_000);
  f.container.click("watch", start("watten").id);
  assert.equal(f.watched.length, 0, "an expired notice offers no navigation");
  f.win.fireTimeouts();
  assert.equal(f.container.innerHTML, "");
});

test("invalid or excessive frames are dropped and bounded without reconnecting", async () => {
  const f = fixture();
  await ready(f);
  f.sockets[0].frame({ friend_activity: start("watten", { spectator_url: "/zuschauen" }) });
  f.sockets[0].frame("not json");
  await tick(); await tick();
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.sockets[0].closed, false);
  for (let index = 0; index < 20; index += 1) f.sockets[0].frame({ unexpected: index });
  assert.equal(f.sockets[0].closed, true);
  f.win.fireTimeouts(); await tick();
  assert.equal(f.sockets.length, 1);
});

test("a table placement shows non-blocking text without any action", async () => {
  const f = fixture({ placement: "table" });
  await ready(f);
  f.sockets[0].frame({ friend_activity: start("watten") });
  f.sockets[0].frame({ friend_activity: start("hausdepp") });
  await until(() => f.container.innerHTML.includes("Hausdepp"));
  assert.ok(!f.container.innerHTML.includes("<button"));
  assert.match(f.container.innerHTML, /Dein Platz an diesem Tisch bleibt unverändert/);
  assert.ok(!f.container.innerHTML.includes("Watten begonnen"), "only the latest notice is shown");
  f.container.click("watch", start("hausdepp").id);
  assert.equal(f.watched.length, 0);
});

test("pagehide clears notices and late frames or auth responses never remount them", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ auth: async reads => { if (reads === 4) await gate; return user(7); } });
  await ready(f);
  f.sockets[0].frame({ friend_activity: start("watten") });
  await until(() => f.reads() === 4);
  f.win.dispatchEvent(new Event("pagehide"));
  release(); await tick(); await tick();
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.sockets[0].closed, true);
  f.sockets[0].frame({ friend_activity: start("zilch") });
  await tick();
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.win.timers.size, 0);
});

test("an opt-out or other account from auth-state clears visible notices", async () => {
  const f = fixture();
  await ready(f);
  f.sockets[0].frame({ friend_activity: start("watten") });
  await until(() => f.container.items === 1);
  f.win.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: user(7, false) }));
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.sockets[0].closed, true);
  f.win.fireTimeouts(); await tick();
  assert.equal(f.sockets.length, 1);
  f.win.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: user(8) }));
  assert.equal(f.changed(), 1);
});
