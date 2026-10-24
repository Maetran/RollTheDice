import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(new URL("../frontend/shared/auth.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from [^;]+;\n/gm, "")
  .replace(/^export \{ mountPlayerSearch \} from [^;]+;\n/m, "");
let serial = 0;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const signed = () => ({ authenticated: true, user: { id: 17, csrf_token: "csrf" },
  game_access: { zilch_public: true, hausdepp_public: true, watten_preview: true } });
async function fixture(fetch) {
  const events = [], identity = { cache: signed(), request: null, epoch: 0 };
  globalThis.window = { [Symbol.for("rollthedice.auth-state")]: identity, dispatchEvent: event => events.push(event.detail) };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
  globalThis.fetch = fetch;
  const module = await import(`data:text/javascript;base64,${Buffer.from(`const passkeysSupported=()=>false;\n${source}\n// shared logout ${++serial}`).toString("base64")}`);
  return { module, identity, events };
}

test("shared logout treats HTTP 401 as already signed out and retires any older identity reply", async () => {
  const oldRead = deferred();
  let reads = 0, posts = 0;
  const guest = { authenticated: false, user: null, game_access: { zilch_public: true, hausdepp_public: true } };
  const f = await fixture(async (path, options) => {
    if (path === "/api/auth/me") {
      reads += 1;
      return reads === 1 ? oldRead.promise : { ok: true, json: async () => guest };
    }
    assert.equal(path, "/api/auth/logout");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("X-CSRF-Token"), "csrf");
    posts += 1;
    return { ok: false, status: 401 };
  });
  const pending = f.module.loadAuth({ refresh: true });
  await f.module.logout();
  assert.equal(posts, 1);
  assert.equal(f.identity.cache, null);
  assert.equal(f.identity.request, null);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].authenticated, false);
  assert.deepEqual(f.events[0].game_access, guest.game_access);
  oldRead.resolve({ ok: true, json: async () => signed() });
  assert.deepEqual(await pending, guest);
  assert.equal((await f.module.loadAuth()).authenticated, false);
  assert.ok(f.events.every(event => !event.authenticated && !event.user));
});

test("shared logout keeps 403, 503 and network failures as errors with the current identity available for retry", async () => {
  for (const failure of [403, 503, "network"]) {
    const f = await fixture(async path => {
      assert.equal(path, "/api/auth/logout");
      if (failure === "network") throw new TypeError("offline");
      return { ok: false, status: failure };
    });
    await assert.rejects(f.module.logout(), failure === "network" ? /offline/ : /Abmelden fehlgeschlagen/);
    assert.equal((await f.module.loadAuth()).user.id, 17);
    assert.deepEqual(f.events, []);
  }
});

test("shared logout finishes when the browser cache was already cleared and /me confirms guest before the 401", async () => {
  const guest = { authenticated: false, user: null, game_access: { zilch_public: true } };
  let posts = 0;
  const f = await fixture(async (path, options) => {
    if (path === "/api/auth/me") return { ok: true, json: async () => guest };
    assert.equal(path, "/api/auth/logout");
    assert.equal(options.headers.has("X-CSRF-Token"), false);
    posts += 1;
    return { ok: false, status: 401 };
  });
  f.identity.cache = null;
  await f.module.logout();
  assert.equal(posts, 1);
  assert.equal(f.identity.cache, null);
  assert.ok(f.events.length >= 1);
  assert.ok(f.events.every(event => !event.authenticated && event.user === null));
});
