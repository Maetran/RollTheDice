import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`;
const source = (await readFile(new URL("../frontend/watten/rematch.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(catalogUrl));
const { createRematch, reservationMarkup } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const gameId = "0123456789abcdef", targetId = "fedcba9876543210";
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) {
  for (let index = 0; index < 40 && !condition(); index += 1) await tick();
  assert.ok(condition(), "Rematch controller did not finish the expected transition");
}
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, letter => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[letter]);
const snapshot = () => ({ id: gameId, game_type: "watten", viewer: { participant_id: "p1" },
  room: { revision: 8, status: "finished", host_participant_id: "p1",
    recipe: { password_required: true, cpu_seats: [1], player_count: 4 },
    rematch: { source_game_id: null, game_id: null, can_create: true } } });
const result = () => ({ schema_version: 1, game_type: "watten", source_game_id: gameId,
  game_id: targetId, created: true, source_revision: 9, room_revision: 0 });
const response = (body = result(), status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

class Container {
  hidden = true;
  markup = "";
  writes = 0;
  fields = new Map();
  handlers = new Map();
  set innerHTML(value) {
    this.markup = value; this.writes += 1; this.fields.clear();
    for (const name of ["protection_mode", "rematch_password"]) {
      if (value.includes(`name="${name}"`)) this.fields.set(name, { name, value: "" });
    }
  }
  get innerHTML() { return this.markup; }
  querySelector(selector) { return this.fields.get(selector.match(/name="([^"]+)"/)?.[1]) ?? null; }
  replaceChildren() { this.innerHTML = ""; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  removeEventListener(name, handler) { if (this.handlers.get(name) === handler) this.handlers.delete(name); }
  contains(control) { return control.owner === this; }
  input(name, value) {
    const target = this.fields.get(name); assert.ok(target, name); target.value = value;
    this.handlers.get(name === "protection_mode" ? "change" : "input")?.({ target });
  }
  submit() { this.handlers.get("submit")?.({ target: { matches: () => true }, preventDefault() {} }); }
  click(action) {
    const control = { owner: this, disabled: false, dataset: { wattenRematchAction: action } };
    this.handlers.get("click")?.({ target: { closest: () => control } });
  }
}

function fixture({ fetcher, auth, language = "de" } = {}) {
  const calls = [], navigations = [], handoffs = [], container = new Container();
  let current = true, identity = 1, changed = 0, authReads = 0, commandIds = 0;
  const client = createRematch({ gameId, escapeHtml, language: () => language,
    makeCommandId: () => `rematch-${++commandIds}`,
    getExpectedAccountId: () => 1, isCurrent: () => current,
    onNavigate: id => { assert.equal(navigations.length, 0); handoffs.push(id); },
    navigate: path => { navigations.push(path); current = false; client.destroy(); },
    onAccountChanged: () => { changed += 1; },
    loadAuth: async options => {
      assert.equal(options.refresh, true); authReads += 1;
      return auth ? auth(authReads) : { authenticated: identity !== null, user: { id: identity, csrf_token: `csrf-${authReads}` } };
    },
    fetcher: async (url, options) => {
      calls.push({ url, options }); return fetcher ? fetcher(url, options, calls.length) : response();
    } });
  const update = (extra = {}) => client.update({ container, snapshot: snapshot(), playerId: "p1", spectator: false, ...extra });
  return { client, calls, navigations, handoffs, container, update, changed: () => changed,
    setIdentity: value => { identity = value; }, invalidate: () => { current = false; } };
}

test("terminal own host permission is required; updates never create or navigate automatically", async () => {
  const f = fixture();
  for (const extra of [{ spectator: true }, { playerId: "p2" }, { snapshot: { ...snapshot(), viewer: null } },
    { snapshot: { ...snapshot(), room: { ...snapshot().room, status: "started" } } },
    { snapshot: { ...snapshot(), room: { ...snapshot().room, rematch: { can_create: false, game_id: null } } } }]) {
    f.update(extra); assert.equal(f.container.innerHTML, "");
  }
  f.update(); await tick();
  assert.match(f.container.innerHTML, /Noch ein Spiel\?/);
  assert.doesNotMatch(f.container.innerHTML, /<form|<input|<select|<details|Explicit recipe/);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.navigations, []);
  f.client.destroy();
});

test("one click continues even a protected match without password or settings in the request", async () => {
  const f = fixture(); f.update();
  assert.equal(f.container.fields.size, 0);
  f.container.click("create");
  await until(() => f.navigations.length === 1);
  assert.deepEqual(f.handoffs, [targetId]);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { command_id: "rematch-1", revision: 8 });
  assert.equal(f.calls[0].options.headers["X-Watten-Expected-Account-Id"], "1");
  assert.equal(f.calls[0].options.headers["X-CSRF-Token"], "csrf-1");
  assert.equal(f.calls[0].options.cache, "no-store");
  assert.deepEqual(f.navigations, [`/watten/spiel/${targetId}`]);
});

test("lost ACK retry keeps the identical ID, revision and CSRF without configuration", async () => {
  const f = fixture({ fetcher: async (_url, _options, attempt) => {
    if (attempt === 1) throw new Error("lost response");
    return response({ ...result(), created: false });
  } });
  f.update();
  f.container.click("create"); await until(() => f.container.innerHTML.includes('action="retry"'));
  assert.doesNotMatch(f.container.innerHTML, /Secret/);
  f.update({ snapshot: { ...snapshot(), room: { ...snapshot().room, revision: 9 } } });
  f.container.click("retry"); await until(() => f.navigations.length === 1);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.body, f.calls[1].options.body);
  assert.equal(f.calls[0].options.headers["X-CSRF-Token"], f.calls[1].options.headers["X-CSRF-Token"]);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { command_id: "rematch-1", revision: 8 });
  assert.ok(f.calls.every(call => !call.url.includes("Secret")));
  assert.deepEqual(f.navigations, [`/watten/spiel/${targetId}`]);
});

test("same-container snapshots preserve the controls and remount detaches the old container", () => {
  const f = fixture(); f.update();
  const writes = f.container.writes;
  f.update(); f.update(); assert.equal(f.container.writes, writes);
  const next = new Container(); f.update({ container: next });
  assert.equal(f.container.innerHTML, ""); assert.equal(next.fields.size, 0);
  assert.match(next.innerHTML, /Revanche starten/);
  f.client.destroy(); assert.equal(next.innerHTML, "");
});

test("snapshot's existing target is an explicit navigation with no POST or password request", async () => {
  const f = fixture({ language: "en" });
  f.update({ snapshot: { ...snapshot(), room: { ...snapshot().room, rematch: { can_create: false, game_id: targetId } } } });
  assert.match(f.container.innerHTML, /Go to rematch/); assert.equal(f.container.fields.size, 0);
  assert.deepEqual(f.navigations, []); f.container.click("open");
  await until(() => f.navigations.length === 1);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.navigations, [`/watten/spiel/${targetId}`]);
  assert.deepEqual(f.handoffs, [targetId]);
});

test("closed host uses the same continuation without emitting seat or CPU commands", async () => {
  const f = fixture(); f.update({ snapshot: { ...snapshot(), room: { ...snapshot().room, status: "closed" } } });
  f.container.click("create"); await until(() => f.calls.length === 1);
  assert.ok(f.calls.every(call => call.url.endsWith("/rematch")));
  assert.doesNotMatch(f.container.innerHTML, /watten_start|watten_take_seat|watten_place_cpu/);
});

test("tournament continuations retain server-fixed seats and completed tournaments offer no rematch", () => {
  const f = fixture();
  const tournament = { ...snapshot(), room: { ...snapshot().room, series: { target: 5, teams_locked: true, finished: false } } };
  f.update({ snapshot: tournament });
  assert.match(f.container.innerHTML, /Revanche starten/);
  assert.doesNotMatch(f.container.innerHTML, /<form|<input|<select|<details/);
  assert.equal(f.calls.length, 0);
  f.update({ snapshot: { ...tournament, room: { ...tournament.room, series: { ...tournament.room.series, finished: true },
    rematch: { can_create: false, game_id: null } } } });
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.calls.length, 0);
  f.client.destroy();
});

test("pre-request and decisive post-body auth changes clear controls and suppress navigation", async () => {
  for (const changedAt of [1, 2, 3]) {
    const f = fixture({ auth: async attempt => ({ authenticated: true, user: { id: attempt >= changedAt ? 2 : 1, csrf_token: "csrf" } }) });
    f.update(); f.container.click("create"); await until(() => f.changed() === 1);
    assert.equal(f.container.innerHTML, ""); assert.equal(f.navigations.length, 0);
    assert.equal(f.calls.length, changedAt === 1 ? 0 : 1);
  }
});

test("destroy aborts uncertain request and late responses never navigate or remount", async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const f = fixture({ fetcher: () => pending }); f.update(); f.container.click("create");
  await until(() => f.calls.length === 1); f.client.destroy();
  assert.equal(f.calls[0].options.signal.aborted, true); assert.equal(f.container.innerHTML, "");
  resolve(response()); await tick(); assert.equal(f.navigations.length, 0); assert.equal(f.container.innerHTML, "");
});

test("foreign/malformed success and account-mismatch errors cannot navigate; retry remains bounded", async () => {
  for (const body of [{ ...result(), source_game_id: targetId }, { ...result(), game_id: "//evil.invalid/" },
    { ...result(), game_id: gameId }, { ...result(), created: 1 }]) {
    const f = fixture({ fetcher: async () => response(body) }); f.update(); f.container.click("create");
    await until(() => f.container.innerHTML.includes('action="retry"'));
    assert.deepEqual(f.navigations, []); assert.equal(f.container.fields.size, 0); f.client.destroy();
  }
  const f = fixture({ fetcher: async () => response({ detail: "watten_account_changed" }, 409) });
  f.update(); f.container.click("create"); await until(() => f.changed() === 1);
  assert.equal(f.container.innerHTML, ""); assert.deepEqual(f.navigations, []);
});

test("reservation uses only server's own seat/expiry and never claims or bypasses protection", () => {
  for (const value of [null, {}, { seat: true, expires_at: "2026-10-18T20:00:00Z" }, { seat: 4, expires_at: "bad" }]) {
    assert.equal(reservationMarkup(value, { escapeHtml, language: "de" }), "");
  }
  const value = { seat: 2, expires_at: "2026-10-18T20:00:00Z" };
  assert.match(reservationMarkup(value, { escapeHtml, language: "de" }), /Platz 3/);
  assert.match(reservationMarkup(value, { escapeHtml, language: "en" }), /Seat 3/);
  assert.doesNotMatch(reservationMarkup(value, { escapeHtml, language: "en" }), /account|password=|watten_take_seat/);
});

test("revision is captured at the deliberate submit before a delayed identity read", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ auth: async attempt => attempt === 1 ? pending
    : { authenticated: true, user: { id: 1, csrf_token: "later" } } });
  f.update(); f.container.click("create");
  f.update({ snapshot: { ...snapshot(), room: { ...snapshot().room, revision: 9 } } });
  release({ authenticated: true, user: { id: 1, csrf_token: "initial" } });
  await until(() => f.navigations.length === 1);
  assert.equal(JSON.parse(f.calls[0].options.body).revision, 8);
});

test("busy blocks repeated submits and accepted next-table snapshots recover an uncertain ACK without replay", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ fetcher: () => pending });
  f.update(); f.container.click("create"); f.container.click("create");
  await until(() => f.calls.length === 1);
  f.update({ snapshot: { ...snapshot(), room: { ...snapshot().room, rematch: { can_create: false, game_id: targetId } } } });
  assert.equal(f.container.fields.size, 0);
  release(response(result())); await until(() => f.navigations.length === 1);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.navigations, [`/watten/spiel/${targetId}`]);
});

test("an existing target shown after a lost response needs only explicit open, never another creation", async () => {
  const f = fixture({ fetcher: async () => { throw new Error("lost ACK"); } });
  f.update(); f.container.click("create");
  await until(() => f.container.innerHTML.includes('action="retry"'));
  f.update({ snapshot: { ...snapshot(), room: { ...snapshot().room, rematch: { can_create: false, game_id: targetId } } } });
  assert.equal(f.container.fields.size, 0); f.container.click("open");
  await until(() => f.navigations.length === 1);
  assert.equal(f.calls.length, 1);
});

test("new DE/EN catalogs have identical complete keys and guarded integration never replaces a card view for its slot", async () => {
  const all = await import(catalogUrl);
  assert.deepEqual(Object.keys(all.WATTEN_REMATCH_MESSAGES.de).sort(), Object.keys(all.WATTEN_REMATCH_MESSAGES.en).sort());
  for (const language of ["de", "en"]) for (const text of Object.values(all.WATTEN_REMATCH_MESSAGES[language])) {
    assert.equal(typeof text, "string"); assert.ok(text.trim());
  }
  const table = await readFile(new URL("../frontend/watten/table.js", import.meta.url), "utf8");
  const game = await readFile(new URL("../frontend/watten/game.js", import.meta.url), "utf8");
  assert.match(table, /data-watten-match-result[^]*?<div data-watten-rematch hidden><\/div>[^]*?wt-final-call/);
  assert.match(table, /data-wt-private[^]*?data-wt-history[^]*?data-wt-panel[^]*?data-wt-stake/);
  assert.match(game, /rematch\?\.update\(\{ container: root.querySelector\("\[data-watten-rematch\]"\)/);
  assert.match(game, /Closed rooms need no socket admission/);
});

test("stale revision offers deliberate source reload instead of repeating an obsolete envelope", async () => {
  const f = fixture({ fetcher: async () => response({ detail: "watten_stale_room_revision" }, 409) });
  f.update(); f.container.click("create");
  await until(() => f.container.innerHTML.includes('action="reload"'));
  assert.doesNotMatch(f.container.innerHTML, /action="retry"/);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.navigations, []);

  f.container.click("reload"); await until(() => f.navigations.length === 1);
  assert.deepEqual(f.navigations, [`/watten/spiel/${gameId}`]);
assert.equal(f.container.innerHTML, ""); assert.equal(f.calls.length, 1);
});

test("503 retains the exact original envelope and CSRF until explicit retry", async () => {
  const f = fixture({ fetcher: async (_url, _options, attempt) => attempt === 1
    ? response({ detail: "watten_storage_unavailable" }, 503) : response({ ...result(), created: false }) });
  f.update(); f.container.click("create");
  await until(() => f.container.innerHTML.includes('action="retry"'));
  assert.doesNotMatch(f.container.innerHTML, /action="reload"/);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.navigations, []);
  f.container.click("retry"); await until(() => f.navigations.length === 1);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.body, f.calls[1].options.body);
  assert.equal(f.calls[0].options.headers["X-CSRF-Token"], f.calls[1].options.headers["X-CSRF-Token"]);
  assert.deepEqual(f.navigations, [`/watten/spiel/${targetId}`]);
});

test("same-account session rotation offers source reload after the captured CSRF is rejected", async () => {
  const f = fixture({ fetcher: async (_url, _options, attempt) => attempt === 1
    ? response({ detail: "watten_storage_unavailable" }, 503) : response({ detail: "csrf_rejected" }, 403) });
  f.update(); f.container.click("create");
  await until(() => f.container.innerHTML.includes('action="retry"'));
  f.container.click("retry");
  await until(() => f.container.innerHTML.includes('action="reload"'));
  assert.doesNotMatch(f.container.innerHTML, /action="retry"/);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.body, f.calls[1].options.body);
  assert.equal(f.calls[0].options.headers["X-CSRF-Token"], f.calls[1].options.headers["X-CSRF-Token"]);
  assert.deepEqual(f.navigations, []);
  f.container.click("reload");
  assert.deepEqual(f.navigations, [`/watten/spiel/${gameId}`]);
assert.equal(f.container.innerHTML, "");
  assert.equal(f.calls.length, 2);
});
