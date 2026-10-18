import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/watten/api.js", import.meta.url), "utf8");
const { loadWattenDetail } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const gameId = "0123456789abcdef";
const response = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const own = { exists: true, id: gameId, room: { status: "closed", rematch: { can_create: true } }, viewer: { participant_id: "p1" } };

function fixture({ fetcher, auth } = {}) {
  let current = true, changed = 0, authReads = 0;
  const calls = [];
  const load = () => loadWattenDetail({ gameId, accountId: 1, isCurrent: () => current,
    onAccountChanged: () => { changed += 1; current = false; },
    fetcher: async (url, options) => { calls.push({ url, options }); return fetcher ? fetcher(url, options) : response(own); },
    loadAuth: async options => {
      assert.equal(options.refresh, true); authReads += 1;
      return auth ? auth(authReads) : { authenticated: true, user: { id: 1 } };
    } });
  return { load, calls, changed: () => changed, authReads: () => authReads, invalidate: () => { current = false; } };
}

test("native detail GET pins the captured account before exposing its closed-room projection", async () => {
  const f = fixture();
  assert.deepEqual(await f.load(), { ok: true, data: own });
  assert.deepEqual(f.calls[0], { url: `/api/games/${gameId}`, options: { cache: "no-store", credentials: "same-origin",
    headers: { "X-Watten-Expected-Account-Id": "1" } } });
  assert.equal(f.authReads(), 2);
});

test("a cookie A to B to A switch cannot relabel B's HTTP viewer after fresh /me returns A", async () => {
  const f = fixture({ fetcher: async (_url, options) => {
    // Native HTTP sees cookie B during this GET. The captured header still
    // expects A, so its 409 contains no B viewer/reservation to commit.
    assert.equal(options.headers["X-Watten-Expected-Account-Id"], "1");
    return response({ detail: "watten_account_changed" }, 409);
  }, auth: async () => ({ authenticated: true, user: { id: 1 } }) });
  assert.equal(await f.load(), null);
  assert.equal(f.changed(), 1);
  assert.equal(f.authReads(), 0);
});

test("the decisive second post-body auth read rejects a coalesced older identity", async () => {
  const f = fixture({ auth: async attempt => ({ authenticated: true, user: { id: attempt === 1 ? 1 : 2 } }) });
  assert.equal(await f.load(), null);
  assert.equal(f.changed(), 1);
  assert.equal(f.authReads(), 2);
});

test("lifecycle invalidation while the JSON body is pending cannot commit private detail state", async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ fetcher: async () => ({ status: 200, ok: true, json: () => { entered(); return pending; } }) });
  const result = f.load(); await started;
  f.invalidate(); release(own);
  assert.equal(await result, null);
  assert.equal(f.authReads(), 0);
  assert.equal(f.changed(), 0);
});

test("a revoked native session reloads while a genuine 404 stays a missing detail", async () => {
  const signedOut = fixture({ fetcher: async () => response({ detail: "authentication_required" }, 401) });
  assert.equal(await signedOut.load(), null);
  assert.equal(signedOut.changed(), 1);
  const missing = fixture({ fetcher: async () => response({ detail: "game_not_found" }, 404) });
  assert.deepEqual(await missing.load(), { ok: false, data: { detail: "game_not_found" } });
  assert.equal(missing.changed(), 0);
});
