import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../frontend/watten/feature-controls.js", import.meta.url), "utf8");
const context = { AbortController, window: { ZDWA_I18N: { t: value => value } },
  esc: value => String(value).replaceAll('"', "&quot;"), t: value => value, lt: value => value };
runInNewContext(source.replace(/^import .*;\n/gm, "").replaceAll("export function ", "function ")
  .replaceAll("export const ", "const ") + "\nObject.assign(this, { fields: WATTEN_FEATURE_FIELDS, restrictCreatorFeatures, waitingFeatureControlsMarkup, createCreatorFeaturePolicy });", context);
const { fields, restrictCreatorFeatures, waitingFeatureControlsMarkup, createCreatorFeaturePolicy } = context;
const entries = (status = "internal", can_select = false, beta = false) => Object.fromEntries(Object.keys(fields)
  .map(key => [key, { status, can_select, beta }]));
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function creator() {
  const rows = {}, badges = {};
  const elements = Object.fromEntries(Object.entries(fields).map(([key, name]) => {
    rows[key] = { hidden: false }; badges[key] = { hidden: false };
    return [name, { checked: true, disabled: false, closest: () => rows[key] }];
  }));
  return { elements, rows, badges, querySelector: selector => selector === "[data-watten-advanced]" ? null : badges[selector.match(/="([^"]+)"/)[1]] };
}

test("missing or forbidden policy removes every selected feature, including saved favorites", () => {
  for (const policy of [null, entries("off"), entries("internal")]) {
    const form = creator();
    assert.equal(restrictCreatorFeatures(form, policy).length, 6);
    for (const [key, name] of Object.entries(fields)) {
      assert.equal(form.rows[key].hidden, true);
      assert.equal(form.elements[name].checked, false);
      assert.equal(form.elements[name].disabled, true);
    }
  }
});

test("public beta and staff controls preserve independent game constraints", () => {
  const form = creator(); form.elements.partner_hand.disabled = true;
  const policy = entries("public", true, true);
  policy["watten.critical"] = { status: "internal", can_select: true, beta: false };
  assert.equal(restrictCreatorFeatures(form, policy).length, 0);
  assert.equal(form.elements.partner_hand.disabled, true);
  assert.equal(form.rows["watten.critical"].hidden, false);
  assert.equal(form.badges["watten.critical"].hidden, true);
  assert.equal(form.badges["watten.schoeneres"].hidden, false);
});

test("waiting-room controls follow the viewer projection and still permit clearing a revoked flag", () => {
  const room = { status: "waiting", feature_controls: {
    "watten.schoeneres": { can_select: false, enabled: true, status: "internal", beta: false },
    "watten.critical": { can_select: true, can_enable: false, enabled: true, status: "off", beta: false },
    "watten.show_rechter": { can_select: true, can_enable: true, enabled: false, status: "public", beta: true },
    "watten.open_partner_hand": { can_select: true, can_enable: false, enabled: false, status: "internal", beta: false },
    "watten.trick_history": { can_select: true, enabled: false, status: "internal", beta: false },
  } };
  const html = waitingFeatureControlsMarkup(room, { member: true });
  assert.doesNotMatch(html, /data-feature="watten.schoeneres"/);
  assert.match(html, /data-feature="watten.critical"\s+data-enabled="false" checked>/);
  assert.match(html, /data-feature="watten.show_rechter"\s+data-enabled="true">/);
  assert.match(html, /data-feature="watten.open_partner_hand"\s+data-enabled="true" disabled>/);
  assert.match(html, /data-feature="watten.trick_history"\s+data-enabled="true" disabled>/);
  assert.match(html, /data-watten-feature-beta="watten.show_rechter">Beta/);
  assert.equal(waitingFeatureControlsMarkup(room), "");
  assert.equal(waitingFeatureControlsMarkup({ ...room, status: "started" }, { member: true }), "");
});

function fixture({ fetcher, auth } = {}) {
  const states = [], requests = [];
  let changed = 0, current = true, reads = 0;
  const client = createCreatorFeaturePolicy({ accountId: 7, isCurrent: () => current,
    onAccountChanged: () => { changed += 1; }, onChange: state => states.push(state),
    loadAuth: async () => { reads += 1; return auth ? auth(reads) : { authenticated: true, user: { id: 7 } }; },
    fetcher: async (path, options) => { requests.push({ path, options }); return fetcher
      ? fetcher(requests.length) : response({ viewer_id: 7, features: entries("internal", true) }); } });
  return { client, states, requests, changed: () => changed, invalidate: () => { current = false; } };
}

test("each refresh binds the policy to the mounted account and first closes existing selectors", async () => {
  const f = fixture(); await f.client.refresh();
  assert.equal(f.states[0].features, null);
  assert.equal(f.states[0].loading, true);
  assert.equal(f.client.getState().features["watten.schoeneres"].can_select, true);
  assert.equal(f.requests[0].path, "/api/features");
  assert.equal(f.requests[0].options.headers["X-Watten-Expected-Account-Id"], "7");
  assert.equal(f.requests[0].options.cache, "no-store");
  await f.client.refresh();
  assert.equal(f.states[2].features, null);
  assert.equal(f.requests.length, 2);
});

test("network failure and malformed successful policy fail closed and a fresh retry can recover", async () => {
  const f = fixture({ fetcher: attempt => {
    if (attempt === 1) throw new Error("offline");
    if (attempt === 2) return response({ viewer_id: 7, features: entries("off", true) });
    return response({ viewer_id: 7, features: entries("public", true, true) });
  } });
  await f.client.refresh();
  assert.equal(f.client.getState().failed, true); assert.equal(f.client.getState().features, null);
  await f.client.refresh();
  assert.equal(f.client.getState().failed, true); assert.equal(f.client.getState().features, null);
  await f.client.refresh();
  assert.equal(f.client.getState().failed, false);
  assert.equal(f.client.getState().features["watten.schoeneres"].beta, true);
});

test("a changed authenticated account or mismatched policy never exposes private availability", async () => {
  for (const overrides of [
    { auth: reads => ({ authenticated: true, user: { id: reads === 1 ? 7 : 8 } }) },
    { fetcher: () => response({ viewer_id: 8, features: entries("internal", true) }) },
    { fetcher: () => response({ detail: "account_changed" }, 409) },
  ]) {
    const f = fixture(overrides); await f.client.refresh();
    assert.equal(f.changed(), 1);
    assert.equal(f.client.getState().features, null);
    assert.equal(f.states.some(state => state.features), false);
  }
});

test("replaced and destroyed requests cannot restore old policy", async () => {
  const old = deferred();
  const f = fixture({ fetcher: attempt => attempt === 1 ? old.promise : response({ viewer_id: 7, features: entries("off") }) });
  const first = f.client.refresh();
  await new Promise(resolve => setImmediate(resolve));
  await f.client.refresh();
  old.resolve(response({ viewer_id: 7, features: entries("internal", true) })); await first;
  assert.equal(f.client.getState().features["watten.schoeneres"].can_select, false);
  const late = deferred(), destroyed = fixture({ fetcher: () => late.promise });
  const pending = destroyed.client.refresh();
  await new Promise(resolve => setImmediate(resolve));
  destroyed.client.destroy(); late.resolve(response({ viewer_id: 7, features: entries("internal", true) })); await pending;
  assert.equal(destroyed.client.getState().features, null);
});
