import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/watten/open-seat-notify.js", import.meta.url), "utf8");
const { canNotifyOpenSeat, openSeatNotifyMarkup, createOpenSeatNotifications } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const id = "0123456789abcdef";
const snapshot = () => ({ id, started: false, viewer: { participant_id: "host" }, room: {
  status: "waiting", revision: 8, host_participant_id: "host", recipe: { player_count: 2, password_required: false },
  members: [{ participant_id: "host", seat: 0 }], seats: [{ participant_id: "host" }, { participant_id: null }],
} });
const response = (body, status = 200, retry) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: name => name === "Retry-After" ? retry ?? null : null }, json: async () => body });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 30 && !predicate(); i += 1) await tick(); assert.ok(predicate()); }
function fixture({ fetcher, auth, language = "de" } = {}) {
  const calls = [], timers = new Map(), handlers = new Map();
  const button = { disabled: false, hidden: false, textContent: "" }, output = { textContent: "" }, cooldown = { textContent: "" };
  const root = { querySelector: selector => selector.endsWith("open-seat]") ? button : selector.endsWith("status]") ? output : cooldown,
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => { if (handlers.get(name) === fn) handlers.delete(name); },
    contains: node => node === button };
  let state = snapshot(), mounted = true, account = 1, changed = 0, reads = 0, time = 0, busy = false;
  const client = createOpenSeatNotifications({ root, gameId: id, language: () => language,
    getSnapshot: () => state, getExpectedAccountId: () => account, isCurrent: () => mounted,
    isBusy: () => busy, onAccountChanged: () => { changed += 1; },
    win: { setTimeout: fn => { const timer = Symbol(); timers.set(timer, fn); return timer; }, clearTimeout: timer => timers.delete(timer) },
    now: () => time,
    loadAuth: async options => { assert.equal(options.refresh, true); reads += 1;
      return auth ? auth(reads) : { authenticated: true, user: { id: 1 } }; },
    apiFetch: async (url, options) => { calls.push({ url, options });
      return fetcher ? fetcher(url, options) : response({ ok: true, notified: true, retry_after_seconds: 5 }); },
  });
  const click = () => handlers.get("click")?.({ target: { closest: () => button } });
  return { client, calls, timers, button, output, cooldown, handlers, click, changed: () => changed,
    state: value => { state = value; client.update(); }, invalidate: () => { mounted = false; },
    account: value => { account = value; }, busy: value => { busy = value; client.update(); },
    advance: value => { time += value; for (const [timer, fn] of [...timers]) { timers.delete(timer); fn(); } },
  };
}

test("only an open normal waiting table's seated host sees the translated explicit control", () => {
  assert.equal(canNotifyOpenSeat(snapshot()), true);
  const own = { member: true, viewerId: "host" };
  assert.match(openSeatNotifyMarkup(snapshot(), { ...own, language: "de" }), /Mitspieler benachrichtigen/);
  assert.match(openSeatNotifyMarkup(snapshot(), { ...own, language: "en" }), /Notify players/);
  assert.equal(openSeatNotifyMarkup(snapshot(), { ...own, member: false }), "");
  for (const mutate of [
    state => { state.viewer.participant_id = "guest"; },
    state => { state.room.members[0].seat = null; },
    state => { state.room.status = "running"; },
    state => { state.started = true; },
    state => { state.room.recipe.password_required = true; },
    state => { state.room.series = { target: null, teams_locked: true }; },
    state => { state.room.seats[1] = { is_cpu: true }; },
    state => { state.room.members.push({ participant_id: "unseated", seat: null }); },
  ]) {
    const state = snapshot(); mutate(state);
    assert.equal(canNotifyOpenSeat(state), false);
  }
});

test("updates never send; one deliberate click posts only revision with account binding and a visible cooldown", async () => {
  const f = fixture(); f.client.update(); f.client.update();
  assert.equal(f.calls.length, 0);
  f.click(); f.click(); await until(() => f.output.textContent.includes("gesendet"));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `/api/games/${id}/notify-open-seat`);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { revision: 8 });
  assert.equal(f.calls[0].options.headers["X-Watten-Expected-Account-Id"], "1");
  assert.equal(f.calls[0].options.credentials, "same-origin");
  assert.equal(f.button.disabled, true); assert.match(f.cooldown.textContent, /5 Sekunden/);
  f.client.update(); f.click(); assert.equal(f.calls.length, 1);
  f.advance(5000); assert.equal(f.button.disabled, false); assert.equal(f.cooldown.textContent, "");
  f.client.destroy(); assert.equal(f.handlers.size, 0); assert.equal(f.timers.size, 0);
});

test("429 Retry-After survives accepted repaints without resending and later re-enables the button", async () => {
  const f = fixture({ language: "en", fetcher: async () => response({ detail: "game_invite_cooldown" }, 429, "12") });
  f.client.update(); f.click(); await until(() => f.cooldown.textContent.includes("12 seconds"));
  f.client.update(); f.click(); assert.equal(f.calls.length, 1);
  f.advance(11000); assert.equal(f.button.disabled, true); assert.match(f.cooldown.textContent, /1 seconds/);
  f.advance(1000); assert.equal(f.button.disabled, false);
  f.client.destroy();
});

test("a locked rematch or pending room command blocks even a stale control's direct click", async () => {
  const f = fixture(); const locked = snapshot(); locked.room.series = { teams_locked: true };
  f.state(locked); f.click(); await tick(); assert.equal(f.calls.length, 0); assert.equal(f.button.hidden, true);
  f.state(snapshot()); f.busy(true); f.click(); await tick(); assert.equal(f.calls.length, 0);
  f.client.destroy();
});

test("preflight or decisive post-body account changes suppress notification status and tear down callbacks", async () => {
  for (const changedAt of [1, 3]) {
    const f = fixture({ auth: async read => ({ authenticated: true, user: { id: read >= changedAt ? 2 : 1 } }) });
    f.client.update(); f.click(); await until(() => f.changed() === 1);
    assert.equal(f.calls.length, changedAt === 1 ? 0 : 1);
    assert.equal(f.output.textContent, ""); assert.equal(f.handlers.size, 0); assert.equal(f.timers.size, 0);
  }
});

test("destroy aborts an uncertain notification and a late server response cannot remount status or timers", async () => {
  let release;
  const f = fixture({ fetcher: () => new Promise(resolve => { release = resolve; }) });
  f.client.update(); f.click(); await until(() => f.calls.length === 1);
  f.client.destroy(); assert.equal(f.calls[0].options.signal.aborted, true);
  release(response({ ok: true, notified: true, retry_after_seconds: 10 })); await tick();
  assert.equal(f.output.textContent, ""); assert.equal(f.timers.size, 0); assert.equal(f.handlers.size, 0);
});

test("an unreachable recipient or rejected transport is reported locally and never retried automatically", async () => {
  const empty = fixture({ language: "en", fetcher: async () => response({ ok: true, notified: false, retry_after_seconds: 1 }) });
  empty.client.update(); empty.click(); await until(() => empty.output.textContent.includes("No players"));
  empty.advance(1000); await tick(); assert.equal(empty.calls.length, 1); empty.client.destroy();
  const failed = fixture({ fetcher: async () => { throw new Error("network"); } });
  failed.client.update(); failed.click(); await until(() => failed.output.textContent.includes("nicht möglich"));
  failed.client.update(); await tick(); assert.equal(failed.calls.length, 1); failed.client.destroy();
});
