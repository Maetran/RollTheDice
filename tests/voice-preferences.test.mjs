import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = (await readFile(new URL("../frontend/shared/voice-preferences.js", import.meta.url), "utf8"))
  .replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const { VOICE_PREFERENCE_MESSAGES: messages } = await import(
  `data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const auth = (id = 1) => ({ authenticated: true, user: { id, csrf_token: `csrf-${id}` } });

function fixture({ preference, loader, request, language = "en" } = {}) {
  const win = new EventTarget();
  win.ZDWA_I18N = { getLanguage: () => language };
  const select = { value: "", disabled: false };
  const button = { disabled: false };
  const message = { textContent: "" };
  const form = new EventTarget();
  form.elements = { listening: select };
  form.querySelector = selector => selector === "button" ? button : message;
  const mount = { isConnected: true, innerHTML: "", cleared: false,
    querySelector: () => form, replaceChildren() { this.cleared = true; this.innerHTML = ""; } };
  const writes = [];
  const context = { window: win, AbortController, VOICE_PREFERENCE_MESSAGES: messages,
    esc: value => value, loadAuth: loader || (async () => auth()),
    fetch: async (url, options) => {
      writes.push({ url, ...options });
      return request ? request(url, options) : { ok: true, json: async () => JSON.parse(options.body) };
    } };
  const api = runInNewContext(source + "\n({ mountVoicePreferences })", context);
  const controller = api.mountVoicePreferences(mount, { user: { id: 1, preferences: preference } });
  const event = id => {
    const changed = new Event("zdwa:auth-state"); changed.detail = auth(id); win.dispatchEvent(changed);
  };
  const submit = value => { select.value = String(value); form.dispatchEvent(new Event("submit", { cancelable: true })); };
  return { win, mount, form, select, button, message, writes, controller, event, submit };
}

test("missing and false defaults stay off; only an explicit true initializes listening on", () => {
  for (const preference of [undefined, {}, { voice_listening_default: false }, { voice_listening_default: "true" }]) {
    const f = fixture({ preference }); assert.equal(f.select.value, "false"); f.controller.destroy();
  }
  const f = fixture({ preference: { voice_listening_default: true } });
  assert.equal(f.select.value, "true"); f.controller.destroy();
});

test("the real submit handler sends only a boolean and its original viewer's CSRF proof", async () => {
  const f = fixture(); f.submit(true); await settle();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].url, "/api/auth/preferences/voice");
  assert.equal(f.writes[0].method, "PUT");
  assert.equal(f.writes[0].headers["X-CSRF-Token"], "csrf-1");
  assert.deepEqual(JSON.parse(f.writes[0].body), { voice_listening_default: true });
  assert.equal(f.message.textContent, messages.en.saved);
  assert.equal(f.button.disabled, false); f.controller.destroy();
});

test("a failed save retains the choice and allows a successful retry", async () => {
  let fail = true;
  const f = fixture({ request: async () => ({ ok: !fail, json: async () => ({ voice_listening_default: true }) }) });
  f.submit(true); await settle();
  assert.equal(f.message.textContent, messages.en.failed);
  assert.equal(f.select.value, "true"); assert.equal(f.button.disabled, false);
  fail = false; f.submit(true); await settle();
  assert.equal(f.writes.length, 2); assert.equal(f.message.textContent, messages.en.saved);
  f.controller.destroy();
});

test("an account switch during a fresh identity read prevents any mutation", async () => {
  const pending = deferred();
  const f = fixture({ loader: () => pending.promise });
  f.submit(true); f.event(2); pending.resolve(auth(1)); await settle();
  assert.equal(f.writes.length, 0); assert.equal(f.mount.cleared, true);
  assert.equal(f.button.disabled, true);
});

test("a different freshly resolved viewer cannot lend its CSRF token to the original form", async () => {
  const f = fixture({ loader: async () => auth(2) });
  f.submit(true); await settle();
  assert.equal(f.writes.length, 0); assert.equal(f.message.textContent, messages.en.changed);
  f.controller.destroy();
});

for (const retirement of ["identity", "pagehide"]) {
  test(`a late save after ${retirement} cannot restore success or reactivate the retired form`, async () => {
    const pending = deferred();
    const f = fixture({ request: () => pending.promise });
    f.submit(true); await settle(); assert.equal(f.writes.length, 1);
    if (retirement === "identity") f.event(2); else f.win.dispatchEvent(new Event("pagehide"));
    pending.resolve({ ok: true, json: async () => ({ voice_listening_default: true }) });
    await settle();
    assert.notEqual(f.message.textContent, messages.en.saved);
    assert.equal(f.button.disabled, true); assert.equal(f.writes[0].signal.aborted, true);
  });
}
