import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../frontend/watten/push-settings.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from "\.\.\/shared\/[^\"]+";\n/gm, "").replace(/export function /g, "function ");
const context = vm.createContext({ AbortController });
vm.runInContext(`${source}\nglobalThis.settings = { mountWattenPushSettings, pushSettingsMarkup };`, context);
const { mountWattenPushSettings, pushSettingsMarkup } = context.settings;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 40 && !predicate(); i += 1) await tick(); assert.ok(predicate()); }
class Node {
  hidden = false; disabled = false; textContent = ""; isConnected = true; handlers = new Map();
  addEventListener(name, fn) { this.handlers.set(name, fn); }
  removeEventListener(name, fn) { if (this.handlers.get(name) === fn) this.handlers.delete(name); }
  fire(name) { this.handlers.get(name)?.({ preventDefault() {} }); }
}
function fixture({ statusHook, enableHook, auth, fetcher } = {}) {
  const container = new Node(), form = new Node(), save = new Node(), saved = new Node();
  const enable = new Node(), disable = new Node(), retry = new Node(), output = new Node();
  const fields = new Map([["[data-watten-push-enable]", enable], ["[data-watten-push-disable]", disable],
    ["[data-watten-push-retry]", retry], ["[data-watten-push-status]", output], ["[data-watten-push-preferences]", form]]);
  container.querySelector = key => fields.get(key);
  container.replaceChildren = () => { container.cleared = true; for (const node of fields.values()) node.textContent = ""; };
  form.querySelector = key => key === "button[type=submit]" ? save : saved;
  form.elements = { gameInvites: { checked: false }, dailyReminder: { checked: false }, releaseNotifications: { checked: false } };
  const calls = { status: 0, enable: 0, disable: 0, preferences: [] };
  let changed = 0, reads = 0, current = true;
  let status = { viewer_id: 1, available: true, browser_supported: true, permission: "default", subscribed: false,
    device_subscribed: false, game_invites_enabled: false, daily_reminder_enabled: false, release_notifications_enabled: false };
  const client = mountWattenPushSettings({ container, viewerId: 1, isCurrent: () => current,
    onAccountChanged: () => { changed += 1; }, translate: value => value,
    loadAuth: async options => { assert.equal(options.refresh, true); reads += 1;
      return auth ? auth(reads) : { authenticated: true, user: { id: 1 } }; },
    fetcher: async (url, options) => { calls.preferences.push({ url, options });
      if (fetcher) return fetcher(url, options);
      const values = JSON.parse(options.body); status = { ...status, ...values };
      return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
    push: {
      status: async options => { calls.status += 1; return statusHook ? statusHook(options, status) : { ...status }; },
      enable: options => { calls.enable += 1; if (enableHook) return enableHook(options);
        status = { ...status, subscribed: true, device_subscribed: true, permission: "granted" }; return Promise.resolve(); },
      disable: async () => { calls.disable += 1; status = { ...status, subscribed: false, device_subscribed: false }; },
      sync: (target, value) => { target.hidden = !value.subscribed;
        target.elements.gameInvites.checked = value.game_invites_enabled;
        target.elements.dailyReminder.checked = value.daily_reminder_enabled;
        target.elements.releaseNotifications.checked = value.release_notifications_enabled; },
      message: value => value.subscribed ? "Ready" : "Disabled", error: error => error.code || "Unavailable",
    },
  });
  return { client, container, form, save, saved, enable, disable, retry, output, calls,
    changed: () => changed, invalidate: () => { current = false; } };
}

test("account push markup offers separate invite, daily and release choices", () => {
  const markup = pushSettingsMarkup(value => value);
  for (const name of ["gameInvites", "dailyReminder", "releaseNotifications"]) assert.match(markup, new RegExp(`name="${name}"`));
  assert.match(markup, /data-watten-push-enable disabled/);
  assert.match(markup, /data-watten-push-preferences hidden/);
});

test("loading reads status only; the enable function runs synchronously within the click gesture", async () => {
  const f = fixture(); await until(() => f.output.textContent === "Disabled");
  assert.equal(f.calls.enable, 0); assert.equal(f.calls.disable, 0); assert.equal(f.calls.preferences.length, 0);
  assert.equal(f.form.hidden, true); assert.equal(f.enable.disabled, false);
  f.enable.fire("click");
  assert.equal(f.calls.enable, 1, "no auth await can precede Safari's explicit permission gesture");
  await until(() => f.output.textContent === "Ready" && !f.disable.disabled);
  assert.equal(f.form.hidden, false); assert.equal(f.enable.hidden, true);
  assert.equal(f.calls.preferences.length, 0, "device registration never silently enables notification categories");
  f.client.destroy();
});

test("preference submit transmits exactly the three explicit choices with the mounted account", async () => {
  const f = fixture(); await until(() => f.output.textContent === "Disabled");
  f.enable.fire("click"); await until(() => !f.form.hidden && !f.save.disabled);
  f.form.elements.gameInvites.checked = true; f.form.elements.dailyReminder.checked = true;
  f.form.fire("submit"); await until(() => f.saved.textContent === "Push-Auswahl gespeichert.");
  const [call] = f.calls.preferences;
  assert.equal(call.url, "/api/web-push/preferences"); assert.equal(call.options.method, "PUT");
  assert.equal(call.options.headers["X-Push-Expected-Account-Id"], "1");
  assert.deepEqual(JSON.parse(call.options.body), { game_invites_enabled: true, daily_reminder_enabled: true, release_notifications_enabled: false });
  f.disable.fire("click"); await until(() => f.calls.disable === 1 && f.form.hidden);
  f.client.destroy();
});

test("an account change after status retrieval clears controls before any private settings can mount", async () => {
  const f = fixture({ auth: async count => ({ authenticated: true, user: { id: count === 1 ? 1 : 2 } }) });
  await until(() => f.changed() === 1);
  assert.equal(f.container.cleared, true); assert.equal(f.enable.handlers.size, 0); assert.equal(f.form.handlers.size, 0);
  assert.equal(f.calls.enable, 0); assert.equal(f.calls.preferences.length, 0);
});

test("destroy aborts pending enable work and prevents late status refresh or listener resurrection", async () => {
  let release, signal;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ enableHook: options => { signal = options.signal; return pending; } });
  await until(() => f.output.textContent === "Disabled");
  f.enable.fire("click"); assert.equal(f.calls.enable, 1);
  f.client.destroy(); assert.equal(signal.aborted, true); release(); await tick();
  assert.equal(f.calls.status, 1); assert.equal(f.output.textContent, ""); assert.equal(f.form.handlers.size, 0);
});
