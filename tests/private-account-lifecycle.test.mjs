import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const zilch = await readFile(new URL("../frontend/zilch/index.js", import.meta.url), "utf8");
const zdwa = await readFile(new URL("../app/static/account.html", import.meta.url), "utf8");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `source boundary: ${start}`);
  const until = source.indexOf(end, from + start.length);
  assert.notEqual(until, -1, `source boundary: ${end}`);
  return source.slice(from, until);
};
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  emit(type, extra = {}) { for (const callback of this.listeners.get(type) || []) callback({ type, ...extra }); }
}
class PrivateNode {
  innerHTML = "private viewer A";
  removed = false;
  replaceChildren() { this.innerHTML = ""; }
  remove() { this.removed = true; this.replaceChildren(); }
}
const auth = id => ({ authenticated: id !== null, user: id === null ? null : { id, username: id === 1 ? "A" : "B" } });
function fixture() {
  const window = new Events(), main = new PrivateNode(), header = new PrivateNode(), prompt = new PrivateNode(), dialog = new PrivateNode();
  const visits = [];
  const assertCleared = () => {
    assert.equal(main.innerHTML, "");
    assert.equal(dialog.removed, true);
  };
  window.location = { reload() { assertCleared(); visits.push("reload"); }, replace(path) { assertCleared(); visits.push(path); }, hash: "" };
  window.ZDWA_APP_MODE = { prepareNavigation() { assertCleared(); } };
  const document = {
    querySelector: selector => selector === "main.profile-shell" ? main : selector === "[data-passkey-prompt]" ? prompt : null,
    getElementById: id => id === "zilchAccount" ? header : id === "appDialogBackdrop" ? dialog : null,
  };
  return { window, document, content: main, main, header, prompt, dialog, visits };
}
const zilchLifecycle = between(zilch, "function initializeZilchAccountLifecycle()", "\nfunction t(");
const zdwaLifecycle = between(zdwa, "    let viewerId = null;", "    async function initializeAccountPage()");
function mountZilch(f) {
  const state = { auth: auth(1), accountAchievementsRequestVersion: 0, statistics: { private: true }, achievements: { private: true } };
  const context = { ...f, state, zilchPath: path => `/zilch${path}`, encodeURIComponent };
  const lifecycle = runInNewContext(`${zilchLifecycle}\ninitializeZilchAccountLifecycle()`, context);
  lifecycle.acceptAuth(auth(1));
  return { state, context, lifecycle };
}

for (const product of ["zdwa", "zilch"]) {
  test(`${product} account retires before identity navigation and never accepts a later A event`, () => {
    for (const next of [auth(null), auth(2)]) {
      const f = fixture();
      let lifecycle;
      if (product === "zilch") lifecycle = mountZilch(f).lifecycle;
      else runInNewContext(`${zdwaLifecycle}\nviewerId = 1;`, { ...f, location: f.window.location });
      f.window.emit("zdwa:auth-state", { detail: auth(1) });
      assert.notEqual(f.main.innerHTML, "");
      f.window.emit("zdwa:auth-state", { detail: next });
      assert.equal(f.main.innerHTML, "");
      assert.deepEqual(f.visits, [next.authenticated ? "reload" : product === "zilch" ? "/zilch/anmelden?return_to=%2Fzilch%2Fkonto" : "/"]);
      if (lifecycle) {
        assert.equal(f.header.innerHTML, "");
        assert.equal(f.prompt.removed, true);
        assert.equal(lifecycle.acceptAuth(auth(1)), false);
      }
      f.window.emit("zdwa:auth-state", { detail: auth(1) });
      assert.equal(f.visits.length, 1);
      assert.equal(f.main.innerHTML, "");
    }
  });

  test(`${product} pagehide clears immediately and synthetic persisted pageshow requests a fresh document`, () => {
    const f = fixture();
    if (product === "zilch") mountZilch(f);
    else runInNewContext(`${zdwaLifecycle}\nviewerId = 1;`, { ...f, location: f.window.location });
    f.window.emit("pagehide", { persisted: true });
    assert.equal(f.main.innerHTML, "");
    assert.deepEqual(f.visits, []);
    f.window.emit("pageshow", { persisted: false });
    assert.deepEqual(f.visits, []);
    f.window.emit("pageshow", { persisted: true });
    assert.deepEqual(f.visits, ["reload"]);
  });
}

test("ZDWA initial auth completing after pagehide cannot initialize private controls", async () => {
  const f = fixture(), pending = deferred();
  const inline = between(zdwa, '  <script type="module">', "  </script>")
    .replace('  <script type="module">', "").replace(/^    import .*;$/gm, "");
  runInNewContext(`(async () => { ${inline} })()`, { ...f, location: f.window.location, loadAuth: () => pending.promise });
  f.window.emit("pagehide");
  assert.equal(f.main.innerHTML, "");
  // No imported control initializer is supplied: any post-retirement mount is a failure.
  pending.resolve(auth(1));
  await settle();
  assert.equal(f.main.innerHTML, "");
});

test("ZDWA statistics JSON completing after pagehide cannot restore names or statistics", async () => {
  const f = fixture(), payload = deferred();
  const statistics = between(zdwa, "    async function loadAccountStatistics()", "    if (!accountTabs.statistics.panel.hidden)");
  const context = { ...f, location: f.window.location, fetch: async () => ({ ok: true, json: () => payload.promise }),
    accountTabs: { statistics: { panel: { hidden: false } } } };
  const load = runInNewContext(`${zdwaLifecycle}\nviewerId = 1; let statisticsLoaded = false, statisticsLoading = false;\n${statistics}\nloadAccountStatistics`, context);
  const pending = load();
  await settle();
  f.window.emit("pagehide");
  payload.resolve({ player: { username: "A", statistics: { private: true } } });
  await pending;
  assert.equal(f.main.innerHTML, "");
});

test("Zilch account's actual pending renderer cannot restore either private projection after retirement", async () => {
  for (const retire of ["pagehide", "identity"]) {
    const f = fixture(), projection = deferred();
    const { context, state, lifecycle } = mountZilch(f);
    const renderer = between(zilch, "async function renderAccount()", "\nasync function fetchZilchPlayerAchievements");
    const render = runInNewContext(`${renderer}\nrenderAccount`, { ...context, accountLifecycle: lifecycle,
      normalizedZilchAccountTab: () => "statistics", t: key => key, escapeHtml: value => value,
      avatarMarkup: () => "", adminProfileMarkup: () => "", zilchAccountTabsMarkup: () => "",
      zilchAccountStatisticsLoadingMarkup: () => "", zilchAccountAchievementsLoadingMarkup: () => "",
      zilchAccountSettingsMarkup: () => "", bindZilchAccountTabs() {}, bindZilchAccountSettings() {},
      fetchZilchStatistics: () => projection.promise, fetchZilchAchievements: () => projection.promise,
      fetchZilchAchievementRanks: async () => null,
      renderStatisticsBody() { assert.fail("retired account statistics rendered"); },
      renderZilchAccountRank() { assert.fail("retired account rank rendered"); },
      renderAchievementsBody() { assert.fail("retired account achievements rendered"); },
    });
    const pending = render();
    if (retire === "pagehide") f.window.emit("pagehide");
    else f.window.emit("zdwa:auth-state", { detail: auth(2) });
    projection.resolve({ private: "A" });
    await pending;
    assert.equal(f.main.innerHTML, "");
    assert.equal(f.header.innerHTML, "");
    assert.equal(state.auth, null);
    assert.equal(state.statistics, null);
    assert.equal(state.achievements, null);
  }
});

test("Zilch own logout owns one destination, while pagehide or another identity retires its completion", () => {
  for (const outcome of ["success", "expired-failure", "pagehide", "switch", "guest-then-switch"]) {
    const f = fixture(), { lifecycle } = mountZilch(f);
    lifecycle.beginLogout();
    if (outcome === "switch") f.window.emit("zdwa:auth-state", { detail: auth(2) });
    else f.window.emit("zdwa:auth-state", { detail: auth(null) });
    if (outcome === "pagehide") f.window.emit("pagehide");
    if (outcome === "guest-then-switch") f.window.emit("zdwa:auth-state", { detail: auth(2) });
    assert.equal(lifecycle.canFinishLogout(), outcome === "success" || outcome === "expired-failure");
    if (outcome === "expired-failure") {
      assert.equal(lifecycle.cancelLogout(), false);
      assert.deepEqual(f.visits, ["/zilch/anmelden?return_to=%2Fzilch%2Fkonto"]);
    } else assert.deepEqual(f.visits, (outcome === "switch" || outcome === "guest-then-switch") ? ["reload"] : []);
  }
});
