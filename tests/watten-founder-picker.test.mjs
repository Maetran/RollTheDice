import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const routesSource = await read("../frontend/multigame/routes.js");
const routes = await import(url(routesSource));
const appSource = await read("../frontend/multigame/app-mode.js");
let serial = 0;
const publicAccess = { zilch_public: true, hausdepp_public: true };
const auth = (id = 1, access = {}, user = {}) => ({ authenticated: id !== null,
  user: id === null ? null : { id, ...user }, game_access: { ...publicAccess, ...access } });
const founder = () => auth(1, { watten_preview: true }, { is_founder: true });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
class Events {
  listeners = new Map();
  addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(handler); }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
  emit(type, extra = {}) { this.dispatchEvent({ type, ...extra }); }
}
class Element extends Events {
  hidden = false; disabled = false; attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name); }
  closest() { return null; }
}
async function fixture({ state = founder(), mode = "zdwa", language = "de", loader, publicDocument = true, publicWattenDocument = false, beforeInitialize } = {}) {
  const win = new Events(), doc = new Events(), button = new Element(), pickers = [], storage = new Map(), visits = [], utilityHistory = [];
  doc.documentElement = { dataset: { game: mode } }; doc.visibilityState = "visible"; doc.activeElement = null;
  if (publicWattenDocument) doc.documentElement.dataset.wattenPublicBeta = "true";
  doc.querySelectorAll = selector => selector === "[data-game-switch]" ? [button] : [];
  doc.querySelector = selector => selector === "[data-game-switch]" ? button
    : publicDocument && selector.includes('data-hausdepp-public="true"') ? new Element() : null;
  const roots = new Map(); doc.getElementById = id => roots.get(id) || null;
  win.ZDWA_I18N = { getLanguage: () => language }; win.setInterval = () => 1;
  win.location = { hostname: "localhost", pathname: "/", href: "http://localhost:8127/", origin: "http://localhost:8127",
    assign: value => visits.push(["assign", value]), replace: value => visits.push(["replace", value]) };
  globalThis.window = win; globalThis.document = doc; globalThis.Element = Element;
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  let reads = 0, currentState = state, authEpoch = 0;
  const identity = value => value?.authenticated === true ? value.user?.id : null;
  globalThis.__founderPicker = {
    async loadAuth(options) {
      assert.equal(options.refresh, true); reads += 1;
      const requestEpoch = authEpoch;
      const result = loader ? await loader(reads) : currentState;
      // The real shared auth transport returns its current cache and suppresses
      // an older /me notification after login/logout replaces the account.
      if (requestEpoch !== authEpoch) return currentState;
      currentState = result;
      win.emit("zdwa:auth-state", { detail: result });
      return result;
    },
    createGamePicker(options) {
      utilityHistory.push((options.utilities || []).map(entry => entry.id));
      const picker = { ...options, closes: 0, opened: false,
        update({ currentMode = this.currentMode, games = this.games, utilities = this.utilities || [] }) {
          const changed = JSON.stringify(this.games) !== JSON.stringify(games)
            || JSON.stringify(this.utilities || []) !== JSON.stringify(utilities);
          if (changed) this.close();
          this.games = games; this.utilities = utilities; this.currentMode = currentMode;
          utilityHistory.push(utilities.map(entry => entry.id));
        },
        close() { this.closes += 1; this.opened = false; }, toggle() { this.opened = !this.opened; } };
      pickers.push(picker); return picker;
    },
  };
  const source = appSource.replace('"../shared/auth.js"', JSON.stringify(url("export const loadAuth=(...args)=>globalThis.__founderPicker.loadAuth(...args);")))
    .replace('"./routes.js"', JSON.stringify(url(routesSource)))
    .replace('"./game-picker.js"', JSON.stringify(url("export const createGamePicker=(...args)=>globalThis.__founderPicker.createGamePicker(...args);")));
  const { initializeAppMode } = await import(url(`${source}\n// fixture ${++serial}`));
  beforeInitialize?.({ win, visits });
  const controller = initializeAppMode({ mode, refreshOnInitialize: false });
  return { controller, win, doc, button, pickers, storage, visits, roots, utilityHistory, reads: () => reads,
    games: () => pickers.at(-1)?.games || [], utilities: () => pickers.at(-1)?.utilities || [],
    state(value) { currentState = value; },
    event(value) {
      if (identity(value) !== identity(currentState)) authEpoch += 1;
      currentState = value;
      win.emit("zdwa:auth-state", { detail: value });
    } };
}

test("server beta presentation can change without withdrawing the public Watten capability", async () => {
  const state = { ...auth(2, { watten_public: true }), game_presentation: { watten: { beta: false }, hausdepp: { beta: true } } };
  const f = await fixture({ state });
  await f.controller.refresh();
  assert.equal(f.games().find(game => game.id === "watten").publicBeta, true);
  assert.equal(f.games().find(game => game.id === "watten").beta, false);
  assert.equal(f.games().find(game => game.id === "hausdepp").beta, true);
  f.event({ ...state, game_presentation: { watten: { beta: true }, hausdepp: { beta: false } } });
  assert.equal(f.games().find(game => game.id === "watten").beta, true);
  assert.equal(f.games().find(game => game.id === "hausdepp").beta, false);
});

test("canonical preview routes always use the apex on all production suite hosts and stay local in development", () => {
  for (const hostname of ["zockdiewandan.online", "www.zockdiewandan.online", "zdwa.zockdiewandan.online",
    "zilch.zockdiewandan.online", "hausdepp.zockdiewandan.online"]) {
    assert.equal(routes.wattenAppEntryUrl({ hostname }), "https://zockdiewandan.online/watten");
  }
  for (const hostname of ["localhost", "dev.localhost", "127.0.0.1", "::1"]) assert.equal(routes.wattenAppEntryUrl({ hostname }), "/watten");
});

test("DE/EN private entry appears only after a fresh confirmed strict capability and uses no external icon", async () => {
  for (const language of ["de", "en"]) {
    const f = await fixture({ language });
    assert.equal(f.games().some(game => game.id === "watten"), false);
    await f.controller.refresh();
    assert.equal(f.reads(), 2);
    const game = f.games().find(game => game.id === "watten");
    assert.deepEqual(game, { id: "watten", name: "Watten", publicBeta: false, href: "/watten" });
    const pickerSource = await read("../frontend/multigame/game-picker.js"), catalog = await read("../frontend/i18n/catalog.js");
    const picker = await import(url(pickerSource.replace('"../i18n/catalog.js"', JSON.stringify(url(catalog)))));
    assert.notEqual(picker.gameIcon("watten"), picker.gameIcon("zdwa"));
    assert.doesNotMatch(picker.gameIcon("watten"), /<img|href=|https?:|static\//);
  }
});

test("guest, user, admin and delegated-owner identities cannot invent the private option from roles or storage", async () => {
  for (const state of [auth(null, { watten_preview: true }), auth(2), auth(3, {}, { is_admin: true, role: "admin" }),
    auth(4, {}, { is_owner: true, role: "admin" }), auth(1, {}, { is_founder: true }), auth(1, { watten_preview: 1 })]) {
    const f = await fixture({ state }); f.storage.set("zdwa_app_mode", "watten");
    await f.controller.refresh();
    assert.equal(f.games().some(game => game.id === "watten"), false);
    assert.equal(f.controller.set("watten"), false); assert.equal(f.storage.has("zdwa_app_mode"), false);
  }
  const local = await fixture({ state: auth(2, { watten_preview: true }) }); await local.controller.refresh();
  assert.equal(local.games().some(game => game.id === "watten"), true); // The server also supports local authenticated development.
});

test("a pre-switch in-flight founder response is never painted before the decisive fresh user read", async () => {
  const old = deferred(), next = deferred();
  const f = await fixture({ loader: attempt => attempt === 1 ? old.promise : next.promise });
  const pending = f.controller.refresh();
  old.resolve(founder()); await settle();
  assert.equal(f.games().some(game => game.id === "watten"), false);
  next.resolve(auth(2)); await pending;
  assert.equal(f.games().some(game => game.id === "watten"), false);
});

test("an observed account switch invalidates a pending founder proof before any late response can confirm it", async () => {
  const late = deferred();
  const f = await fixture({ loader: attempt => attempt === 1 ? late.promise : auth(2) });
  f.event(auth(1));
  const pending = f.controller.refresh(); await settle();
  f.event(auth(2)); late.resolve(founder()); await pending; await settle();
  assert.equal(f.games().some(game => game.id === "watten"), false);
  assert.equal(f.controller.set("watten"), false);
});

test("fresh login responses may carry the capability only inside their own user projection", async () => {
  const f = await fixture({ state: { authenticated: true, user: { id: 1, game_access: { ...publicAccess, watten_preview: true } } } });
  await f.controller.refresh(); assert.equal(f.games().some(game => game.id === "watten"), true);
});

test("logout and a different account synchronously remove the option, close the modal and invalidate its activity", async () => {
  const f = await fixture(); await f.controller.refresh();
  const picker = f.pickers.at(-1); picker.toggle(); const before = picker.closes;
  f.event(auth(null, { watten_preview: true }));
  assert.equal(f.games().some(game => game.id === "watten"), false);
  assert.equal(picker.opened, false); assert.ok(picker.closes > before);
  f.state(founder()); await f.controller.refresh(); picker.toggle();
  f.event(auth(2)); assert.equal(f.games().some(game => game.id === "watten"), false); assert.equal(picker.opened, false);
  const actual = await read("../frontend/multigame/game-picker.js");
  assert.match(actual, /function stopActivity\(\)[\s\S]*?activityRequest\?\.abort\(\)/);
  assert.match(actual, /function close\([^]*?stopActivity\(\)/);
});

test("network failure drops the private row immediately but retains the public products", async () => {
  let fail = false;
  const f = await fixture({ mode: "hausdepp", loader: async () => { if (fail) throw Error("offline"); return founder(); } });
  await f.controller.refresh(); assert.equal(f.games().length, 4);
  const picker = f.pickers.at(-1); picker.toggle(); fail = true;
  const pending = f.controller.refresh();
  assert.equal(f.games().some(game => game.id === "watten"), false); assert.equal(picker.opened, false);
  assert.equal(await pending, true); assert.equal(f.games().length, 3); assert.deepEqual(f.visits, []);
});

test("routine confirmed same-account refresh preserves menu focus while a refresh error still revokes the private row", async () => {
  let fail = false;
  const f = await fixture({ loader: async () => { if (fail) throw Error("offline"); return founder(); } });
  await f.controller.refresh();
  const picker = f.pickers.at(-1); picker.toggle(); const before = picker.closes;
  await f.controller.refresh({ preserveKnownPrivate: true });
  assert.equal(picker.opened, true); assert.equal(picker.closes, before);
  fail = true; await f.controller.refresh({ preserveKnownPrivate: true });
  assert.equal(picker.opened, false); assert.equal(f.games().some(game => game.id === "watten"), false);
});

test("pagehide, visibility changes and bfcache cannot retain or resurrect a late founder row", async () => {
  const delayed = deferred(); let pendingRead = false;
  const f = await fixture({ loader: () => pendingRead ? delayed.promise : founder() });
  await f.controller.refresh(); pendingRead = true;
  const pending = f.controller.refresh(); f.win.emit("pagehide");
  delayed.resolve(founder()); await pending;
  assert.equal(f.games().some(game => game.id === "watten"), false);
  f.win.emit("pageshow", { persisted: true }); await settle();
  assert.equal(f.games().some(game => game.id === "watten"), true);
  f.doc.visibilityState = "hidden"; f.doc.emit("visibilitychange");
  assert.equal(f.games().some(game => game.id === "watten"), false);
  f.doc.visibilityState = "visible"; f.doc.emit("visibilitychange"); await settle();
  assert.equal(f.games().some(game => game.id === "watten"), true);
});

test("unloading a private page invalidates a cancelled identity read before it can replace the chosen destination", async () => {
  const cancelled = deferred(); let pendingRead = false;
  const f = await fixture({ mode: "watten", publicDocument: false,
    loader: () => pendingRead ? cancelled.promise : founder() });
  await f.controller.refresh();
  let cleared = 0;
  f.roots.set("wattenApp", { replaceChildren() { cleared += 1; } });
  pendingRead = true;
  const pending = f.controller.refresh(); await settle();
  f.win.emit("beforeunload");
  cancelled.reject(new Error("navigation cancelled the old identity request"));
  await pending;
  assert.deepEqual(f.visits, []);
  assert.equal(cleared, 0);
  assert.equal(f.controller.set("watten"), false);
  assert.equal(f.button.hidden, true);
  pendingRead = false;
  // A cancelled departure can focus this same live document again.
  f.win.emit("focus"); await settle();
  assert.equal(f.games().some(game => game.id === "watten"), true);
});

test("a queued app-mode refresh starts no identity read after retirement or an intervening account change", async () => {
  for (const retirement of ["beforeunload", "pagehide", "identity"]) {
    const f = await fixture();
    f.controller.applyAuth(founder());
    const pending = f.controller.refresh();
    if (retirement === "identity") f.event(auth(2));
    else f.win.emit(retirement);
    assert.equal(await pending, false);
    assert.equal(f.reads(), 0, retirement);
    assert.deepEqual(f.visits, []);
  }
});

test("a successful first private identity read cannot start its second confirmation after navigation retirement", async () => {
  for (const retirement of ["beforeunload", "pagehide"]) {
    const reply = deferred();
    const f = await fixture({ loader: () => reply.promise });
    const pending = f.controller.refresh();
    await settle();
    assert.equal(f.reads(), 1);
    f.win.emit(retirement);
    reply.resolve(founder());
    assert.equal(await pending, false);
    assert.equal(f.reads(), 1, retirement);
    assert.deepEqual(f.visits, []);
  }
});

test("an identity error on a live private page still clears its content and redirects", async () => {
  let fail = false;
  const f = await fixture({ mode: "watten", publicDocument: false,
    loader: () => { if (fail) throw new Error("identity unavailable"); return founder(); } });
  await f.controller.refresh();
  let cleared = 0;
  f.roots.set("wattenApp", { replaceChildren() { cleared += 1; } });
  fail = true;
  await f.controller.refresh();
  assert.equal(cleared, 1);
  assert.equal(f.controller.set("watten"), false);
  assert.equal(f.button.hidden, true);
  assert.equal(f.visits.at(-1)[0], "replace");
});

test("Watten's own reload/navigation retires identity callbacks before teardown can reject them", async () => {
  const game = await read("../frontend/watten/game.js");
  const navigation = game.slice(game.indexOf("function navigate(path)"), game.indexOf('window.addEventListener("zdwa:auth-state"'));
  for (const kind of ["reloadFresh", "navigate"]) {
    const cancelled = deferred(); let pendingRead = false;
    const f = await fixture({ mode: "watten", publicDocument: false,
      loader: () => pendingRead ? cancelled.promise : founder() });
    await f.controller.refresh();
    let cleared = 0; f.roots.set("wattenApp", { replaceChildren() { cleared++; } });
    pendingRead = true;
    const pending = f.controller.refresh(); await settle();
    f.win.location.reload = () => f.visits.push(["reload"]);
    const callbacks = runInNewContext(`${navigation}; ({ navigate, reloadFresh });`, {
      window: f.win, location: f.win.location, navigating: false,
      teardown() { cancelled.reject(new Error("navigation cancelled the old identity read before beforeunload")); },
    });
    callbacks[kind]("/watten/regeln");
    await pending;
    // A late account event from the outgoing document cannot choose another
    // destination either. The next document checks the real session afresh.
    f.event(auth(null));
    assert.deepEqual(f.visits, kind === "navigate" ? [["assign", "/watten/regeln"]] : [["reload"]]);
    assert.equal(cleared, 0); assert.equal(f.controller.set("watten"), false);
    assert.equal(f.button.hidden, true);
    // This owner has already destroyed its page. Later lifecycle listeners
    // must not revive that outgoing controller before navigation commits.
    const reads = f.reads(); pendingRead = false;
    f.win.emit("focus"); f.doc.emit("visibilitychange"); f.win.emit("pageshow", { persisted: true }); await settle();
    assert.equal(f.reads(), reads); assert.equal(cleared, 0);
    assert.equal(f.controller.set("watten"), false);
  }
});

test("a Watten BFCache restore listener can request reload before the later app-mode pageshow listener", async () => {
  const game = await read("../frontend/watten/game.js");
  const navigation = game.slice(game.indexOf("function navigate(path)"), game.indexOf('window.addEventListener("zdwa:auth-state"'));
  const restoreStart = game.indexOf('window.addEventListener("pageshow"');
  const restore = game.slice(restoreStart, game.indexOf("\n// ----------------------------------------------------------------", restoreStart));
  let callbacks;
  const f = await fixture({ mode: "watten", publicDocument: false, beforeInitialize({ win, visits }) {
    win.location.reload = () => visits.push(["reload"]);
    callbacks = runInNewContext(`${navigation}\n${restore}; ({ navigate });`, {
      window: win, location: win.location, page: "table", navigating: false, teardown() {},
    });
  } });
  await f.controller.refresh();
  // The real owner first leaves, then returns from BFCache with navigating=true.
  callbacks.navigate("/watten/regeln"); f.win.emit("pagehide");
  const reads = f.reads(); f.win.emit("pageshow", { persisted: true }); await settle();
  f.event(auth(null));
  assert.equal(f.reads(), reads); assert.deepEqual(f.visits, [["assign", "/watten/regeln"], ["reload"]]);
  assert.equal(f.controller.set("watten"), false); assert.equal(f.button.hidden, true);
});

test("a confirmed private selection navigates canonically but remembered mode never grants availability", async () => {
  const f = await fixture(); await f.controller.refresh();
  f.win.location.hostname = "hausdepp.zockdiewandan.online"; f.win.location.href = "https://hausdepp.zockdiewandan.online/hausdepp";
  assert.equal(f.controller.set("watten"), true);
  assert.equal(new URL(f.visits.at(-1)[1]).origin, "https://zockdiewandan.online");
  assert.equal(new URL(f.visits.at(-1)[1]).pathname, "/watten");
  f.event(auth(2)); assert.equal(f.controller.set("watten"), false);
});

test("native entry wiring can mount a Watten current mode and denial redirects before retaining its picker", async () => {
  const f = await fixture({ mode: "watten", publicDocument: false }); await f.controller.refresh();
  assert.equal(f.controller.current, "watten"); assert.equal(f.pickers.at(-1).currentMode, "watten");
  let cleared = 0; f.roots.set("wattenApp", { replaceChildren() { cleared += 1; } });
  f.event(auth(2)); assert.equal(cleared, 1); assert.equal(f.visits.at(-1)[0], "replace");
});

test("shared logout preserves ordinary public capabilities while dropping the private preview marker", async () => {
  const source = await read("../frontend/shared/auth.js");
  const cleaned = source.replace(/^import[\s\S]*?from [^;]+;\n/gm, "").replace(/^export \{ mountPlayerSearch \} from [^;]+;\n/m, "");
  const win = new Events(); win[Symbol.for("rollthedice.auth-state")] = { cache: founder(), request: null, epoch: 0 };
  win[Symbol.for("rollthedice.auth-state")].cache.user.csrf_token = "csrf";
  globalThis.window = win; globalThis.CustomEvent = class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
  globalThis.fetch = async path => { assert.equal(path, "/api/auth/logout"); return { ok: true, status: 200 }; };
  const events = []; win.addEventListener("zdwa:auth-state", event => events.push(event.detail));
  const module = await import(url(`const passkeysSupported=()=>false;\n${cleaned}\n// logout ${++serial}`));
  await module.logout();
  assert.equal(events.at(-1).authenticated, false);
  assert.equal(Object.hasOwn(events.at(-1).game_access, "watten_preview"), false);
  assert.equal(events.at(-1).game_access.hausdepp_public, true); assert.equal(events.at(-1).game_access.zilch_public, true);
});

const utilityAccount = (id = 21, user = { is_admin: true, can_view_analytics: true }) => auth(id, { watten_public: true }, user);
const utilityIds = f => f.utilities().map(entry => entry.id);

test("administration and analytics discovery use independent strict account capabilities after fresh proof", async () => {
  const cases = [
    ["guest", auth(null, { watten_public: true }), []],
    ["ordinary account", utilityAccount(21, {}), []],
    ["administrator without analytics", utilityAccount(21, { is_admin: true }), ["admin"]],
    ["analytics without administrator", utilityAccount(21, { can_view_analytics: true }), ["dashboard"]],
    ["delegated owner without analytics", utilityAccount(21, { is_owner: true, is_admin: true }), ["admin"]],
    ["founder with both server capabilities", utilityAccount(1, { is_founder: true, is_admin: true, can_view_analytics: true }), ["admin", "dashboard"]],
    ["administrator with analytics", utilityAccount(), ["admin", "dashboard"]],
    ["role and owner labels alone", utilityAccount(21, { role: "admin", is_owner: true, is_founder: true }), []],
    ["truthy capability strings", utilityAccount(21, { is_admin: "true", can_view_analytics: "true" }), []],
    ["truthy numeric capabilities", utilityAccount(21, { is_admin: 1, can_view_analytics: 1 }), []],
    ["nonboolean authentication", { ...utilityAccount(), authenticated: "true" }, []],
    ["signed-out identity residue", { ...utilityAccount(), authenticated: false }, []],
    ["string account ID", utilityAccount("21"), []],
    ["zero account ID", utilityAccount(0), []],
    ["unsafe account ID", utilityAccount(Number.MAX_SAFE_INTEGER + 1), []],
    ["capabilities outside user projection", { ...utilityAccount(21, {}), is_admin: true, can_view_analytics: true }, []],
  ];
  for (const [name, state, expected] of cases) {
    const f = await fixture({ state, mode: "hausdepp" });
    f.storage.set("zdwa_app_mode", "admin");
    assert.deepEqual(utilityIds(f), [], `${name}: a public document cannot supply account proof`);
    await f.controller.refresh();
    assert.deepEqual(utilityIds(f), expected, name);
    assert.equal(f.games().some(game => game.id === "watten"), true, `${name}: public Watten remains independent`);
    assert.equal(f.games().some(game => ["admin", "dashboard"].includes(game.id)), false, name);
    assert.equal(f.controller.current, "hausdepp");
    assert.equal(f.controller.set("admin"), false);
    assert.equal(f.controller.set("dashboard"), false);
    assert.deepEqual(f.visits, []);
  }
});

test("logout, account switch and independent permission revocations withdraw utilities while Watten stays public", async () => {
  for (const [name, next, expected] of [
    ["logout", auth(null, { watten_public: true }), []],
    ["ordinary account switch", utilityAccount(22, {}), []],
    ["admin revoked", utilityAccount(21, { can_view_analytics: true }), ["dashboard"]],
    ["analytics revoked", utilityAccount(21, { is_admin: true }), ["admin"]],
  ]) {
    const f = await fixture({ state: utilityAccount(), mode: "hausdepp" });
    await f.controller.refresh();
    assert.deepEqual(utilityIds(f), ["admin", "dashboard"]);
    const picker = f.pickers.at(-1); picker.toggle();
    f.state(next); f.event(next);
    assert.deepEqual(utilityIds(f), expected, `${name}: withdrawal must be synchronous`);
    assert.equal(picker.opened, false, name);
    assert.equal(f.games().find(game => game.id === "watten").publicBeta, true, name);
    assert.equal(f.controller.current, "hausdepp", name);
    assert.deepEqual(f.visits, [], name);
    await settle();
    assert.deepEqual(utilityIds(f), expected, `${name}: a queued refresh cannot restore the old privileges`);
  }
});

test("utility confirmation failures revoke both private entries independently of a public Watten menu", async () => {
  let fail = false;
  const f = await fixture({ mode: "hausdepp", loader: () => {
    if (fail) throw new Error("identity unavailable");
    return utilityAccount();
  } });
  await f.controller.refresh();
  const picker = f.pickers.at(-1); picker.toggle();
  assert.deepEqual(utilityIds(f), ["admin", "dashboard"]);
  fail = true;
  await f.controller.refresh({ preserveKnownPrivate: true });
  assert.deepEqual(utilityIds(f), []);
  assert.equal(picker.opened, false);
  assert.equal(f.games().find(game => game.id === "watten").publicBeta, true);
  assert.equal(f.games().length, 4);
  assert.deepEqual(f.visits, []);
});

test("focus withdraws private utility proof until the current account is freshly confirmed", async () => {
  const fresh = deferred(); let waiting = false;
  const f = await fixture({ mode: "hausdepp", loader: () => waiting ? fresh.promise : utilityAccount() });
  await f.controller.refresh();
  const picker = f.pickers.at(-1); picker.toggle(); waiting = true;
  const reads = f.reads();
  f.win.emit("focus");
  assert.deepEqual(utilityIds(f), []);
  assert.equal(picker.opened, false);
  assert.equal(f.games().find(game => game.id === "watten").publicBeta, true);
  await settle();
  assert.ok(f.reads() > reads, "focus must begin a current identity request");
  assert.deepEqual(utilityIds(f), [], "a pending /me cannot retain the prior focus session's privileges");
  fresh.resolve(utilityAccount()); await settle();
  assert.deepEqual(utilityIds(f), ["admin", "dashboard"]);
});

test("a previous account's delayed utility proof cannot populate the new account's menu", async () => {
  const old = deferred(); let waiting = false, oldReadStarted = false;
  const f = await fixture({ mode: "hausdepp", loader: () => {
    if (!waiting) return utilityAccount();
    if (!oldReadStarted) { oldReadStarted = true; return old.promise; }
    return utilityAccount(22, {});
  } });
  await f.controller.refresh(); waiting = true;
  const pending = f.controller.refresh({ preserveKnownPrivate: true }); await settle();
  assert.equal(oldReadStarted, true);
  f.event(utilityAccount(22, {}));
  assert.deepEqual(utilityIds(f), []);
  const afterSwitch = f.utilityHistory.length;
  old.resolve(utilityAccount()); await pending; await settle();
  assert.deepEqual(utilityIds(f), []);
  assert.equal(f.utilityHistory.slice(afterSwitch).some(entries => entries.length > 0), false,
    "even a transient picker update cannot publish the previous account's private links");
  assert.equal(f.games().find(game => game.id === "watten").publicBeta, true);
  assert.deepEqual(f.visits, []);
});

for (const departure of ["pagehide", "hidden"]) {
  test(`${departure} and page restoration require fresh utility proof without reviving a retired response`, async () => {
    const old = deferred(), restored = deferred(); let phase = "initial";
    const f = await fixture({ mode: "hausdepp", loader: () => phase === "initial" ? utilityAccount()
      : phase === "outgoing" ? old.promise : restored.promise });
    await f.controller.refresh();
    const picker = f.pickers.at(-1); picker.toggle(); phase = "outgoing";
    const reads = f.reads();
    const pending = f.controller.refresh({ preserveKnownPrivate: true }); await settle();
    assert.ok(f.reads() > reads, "the departure must actually interrupt an identity request");
    if (departure === "pagehide") f.win.emit("pagehide");
    else { f.doc.visibilityState = "hidden"; f.doc.emit("visibilitychange"); }
    assert.deepEqual(utilityIds(f), []);
    assert.equal(picker.opened, false);
    old.resolve(utilityAccount()); await pending; await settle();
    assert.deepEqual(utilityIds(f), [], "a response from the retired document cannot revive private links");
    phase = "restoring";
    if (departure === "pagehide") f.win.emit("pageshow", { persisted: true });
    else { f.doc.visibilityState = "visible"; f.doc.emit("visibilitychange"); }
    await settle();
    assert.deepEqual(utilityIds(f), [], "restoration must wait for its own current proof");
    assert.equal(f.games().find(game => game.id === "watten").publicBeta, true);
    restored.resolve(utilityAccount()); await settle();
    assert.deepEqual(utilityIds(f), ["admin", "dashboard"]);
    assert.deepEqual(f.visits, []);
  });
}

test("native utility departure retires old auth callbacks and BFCache return acquires its own current proof", async () => {
  const outgoing = deferred(), restored = deferred(); let phase = "initial";
  const f = await fixture({ mode: "hausdepp", loader: () => phase === "initial" ? utilityAccount()
    : phase === "outgoing" ? outgoing.promise : restored.promise });
  await f.controller.refresh();
  f.storage.set("zdwa_app_mode", "hausdepp");
  const picker = f.pickers.at(-1); picker.toggle(); phase = "outgoing";
  const reads = f.reads();
  const pending = f.controller.refresh({ preserveKnownPrivate: true }); await settle();
  assert.ok(f.reads() > reads, "native departure must interrupt a real identity request");
  let prevented = false;
  picker.onUtilitySelect("admin", f.utilities().find(entry => entry.id === "admin"), {
    button: 0, currentTarget: { target: "" }, preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false);
  assert.equal(picker.opened, false);
  assert.deepEqual(utilityIds(f), []);
  assert.equal(f.storage.get("zdwa_app_mode"), "hausdepp");
  assert.equal(f.controller.current, "hausdepp");
  outgoing.reject(new Error("native navigation cancelled the outgoing identity request"));
  await pending;
  f.event(auth(null, { watten_public: true }));
  const departedReads = f.reads();
  f.win.emit("focus"); f.doc.emit("visibilitychange"); await settle();
  assert.equal(f.reads(), departedReads, "outgoing-page events cannot resume confirmation before navigation commits");
  assert.deepEqual(f.visits, [], "the browser's native link remains the sole navigation owner");
  f.win.emit("pagehide"); phase = "restored";
  f.win.emit("pageshow", { persisted: true }); await settle();
  assert.ok(f.reads() > departedReads, "a restored live page must start a new account confirmation");
  assert.deepEqual(utilityIds(f), [], "old proof stays absent while the restored document is waiting");
  restored.resolve(utilityAccount(21, { can_view_analytics: true })); await settle();
  assert.deepEqual(utilityIds(f), ["dashboard"]);
  assert.equal(f.storage.get("zdwa_app_mode"), "hausdepp");
  assert.equal(f.controller.current, "hausdepp");
  assert.deepEqual(f.visits, []);
});

function mountAccountLifecycle(zilch, f, state) {
  const start = zilch.indexOf("function initializeZilchAccountLifecycle()");
  const lifecycleSource = zilch.slice(start, zilch.indexOf("\nfunction t(", start));
  const lifecycle = runInNewContext(`${lifecycleSource}\ninitializeZilchAccountLifecycle()`, {
    window: f.win, document: f.doc, state, content: { replaceChildren() {} },
    zilchPath: path => routes.zilchPath(path), encodeURIComponent,
  });
  lifecycle.acceptAuth(state.auth);
  return lifecycle;
}

test("Zilch logout owns one navigation despite its auth event and an outgoing identity failure", async () => {
  const zilch = await read("../frontend/zilch/index.js");
  const start = zilch.indexOf('  document.addEventListener("click", async (event) => {', zilch.indexOf("async function initialize()"));
  const handler = zilch.slice(start, zilch.indexOf("\n  if (resultId)", start));
  const shared = await read("../frontend/shared/auth.js");
  const cleaned = shared.replace(/^import[\s\S]*?from [^;]+;\n/gm, "").replace(/^export \{ mountPlayerSearch \} from [^;]+;\n/m, "");
  for (const publicGame of [false, true]) for (const retirement of ["none", "pagehide", "switch", "guest-then-switch"]) for (const status of [200, 401, "preexpired"]) {
    const initial = auth(2, { zilch_public: publicGame, zilch_preview: true });
    initial.user.csrf_token = "csrf";
    const outgoing = deferred(), reply = deferred();
    const f = await fixture({ state: initial, mode: "zilch", publicDocument: false, loader: () => outgoing.promise });
    f.controller.applyAuth(initial);
    const pendingRead = f.controller.refresh(); await settle();
    f.win[Symbol.for("rollthedice.auth-state")] = { cache: status === "preexpired" ? null : initial, request: null, epoch: 0 };
    globalThis.CustomEvent = class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
    let requests = 0;
    globalThis.fetch = async path => {
      if (path === "/api/auth/me") return { ok: true, json: async () => auth(null, { zilch_public: publicGame }) };
      assert.equal(path, "/api/auth/logout"); requests++; return reply.promise;
    };
    const module = await import(url(`const passkeysSupported=()=>false;\n${cleaned}\n// zilch logout ${++serial}`));
    const events = []; f.win.addEventListener("zdwa:auth-state", event => events.push(event.detail));
    f.win.location.reload = () => f.visits.push(["reload"]);
    const accountState = { auth: initial, accountAchievementsRequestVersion: 0 };
    const accountLifecycle = mountAccountLifecycle(zilch, f, accountState);
    runInNewContext(handler, { document: f.doc, window: f.win, Element, state: accountState, appMode: f.controller, accountLifecycle,
      logout: module.logout, zilchPath: path => routes.zilchPath(path), zdwaAppEntryUrl: () => routes.zdwaAppEntryUrl() });
    const button = new Element(); button.closest = () => button;
    const pendingClick = f.doc.listeners.get("click").at(-1)({ target: button }); await settle();
    outgoing.reject(new Error("outgoing identity request was cancelled")); await pendingRead;
    if (retirement === "pagehide") f.win.emit("pagehide");
    if (retirement === "guest-then-switch") f.event(auth(null, { zilch_public: publicGame }));
    if (retirement === "switch" || retirement === "guest-then-switch") f.event(auth(3, { zilch_public: publicGame, zilch_preview: true }));
    reply.resolve({ ok: status === 200, status: status === "preexpired" ? 401 : status }); await pendingClick;
    f.event(auth(null, { zilch_public: publicGame })); await settle();
    assert.equal(requests, 1);
    const guestEvents = events.filter(event => !event.authenticated);
    assert.ok(guestEvents.length >= 1);
    assert.ok(guestEvents.every(event => event.game_access.zilch_public === publicGame));
    assert.equal(button.disabled, true);
    assert.deepEqual(f.visits, retirement === "pagehide" ? []
      : retirement === "switch" || retirement === "guest-then-switch" ? [["reload"]]
      : [["replace", publicGame ? "/zilch" : "/"]]);
  }
});

test("Zilch logout preserves the account on 503, 403 and network failure and permits one successful retry", async () => {
  const zilch = await read("../frontend/zilch/index.js");
  const start = zilch.indexOf('  document.addEventListener("click", async (event) => {', zilch.indexOf("async function initialize()"));
  const handler = zilch.slice(start, zilch.indexOf("\n  if (resultId)", start));
  const shared = await read("../frontend/shared/auth.js");
  const cleaned = shared.replace(/^import[\s\S]*?from [^;]+;\n/gm, "").replace(/^export \{ mountPlayerSearch \} from [^;]+;\n/m, "");
  for (const language of ["de", "en"]) for (const failure of [503, 403, "network"]) for (const publicGame of [false, true]) {
    const initial = auth(2, { zilch_public: publicGame, zilch_preview: true }); initial.user.csrf_token = "csrf";
    const outgoing = deferred(), reply = deferred(); let ready = false;
    const f = await fixture({ state: initial, mode: "zilch", publicDocument: false,
      loader: () => ready ? initial : outgoing.promise });
    f.controller.applyAuth(initial);
    const pendingRead = f.controller.refresh(); await settle();
    const message = new Element(); message.hidden = true; message.textContent = "";
    let cleared = 0; const account = { replaceChildren() { cleared++; } };
    const query = f.doc.querySelector;
    f.doc.querySelector = selector => selector === "[data-zilch-logout-message]" ? message
      : selector === "[data-zilch-root]" ? account : query(selector);
    f.win[Symbol.for("rollthedice.auth-state")] = { cache: initial, request: null, epoch: 0 };
    globalThis.CustomEvent = class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
    let requests = 0;
    globalThis.fetch = async path => { assert.equal(path, "/api/auth/logout"); return ++requests === 1 ? reply.promise : { ok: true, status: 200 }; };
    const module = await import(url(`const passkeysSupported=()=>false;\n${cleaned}\n// failed logout ${++serial}`));
    const accountState = { auth: initial, accountAchievementsRequestVersion: 0 };
    const accountLifecycle = mountAccountLifecycle(zilch, f, accountState);
    runInNewContext(handler, { document: f.doc, window: f.win, Element, state: accountState, appMode: f.controller, accountLifecycle,
      logout: module.logout, zilchPath: path => routes.zilchPath(path), zdwaAppEntryUrl: () => routes.zdwaAppEntryUrl(),
      t: key => language === "en" && key === "Abmelden fehlgeschlagen" ? "Sign-out failed" : key });
    const button = new Element(); button.closest = () => button;
    const click = () => f.doc.listeners.get("click").at(-1)({ target: button });
    const pendingClick = click(); await settle();
    outgoing.reject(new Error("old identity request was cancelled")); await pendingRead;
    ready = true;
    if (failure === "network") reply.reject(new TypeError("network unavailable"));
    else reply.resolve({ ok: false, status: failure });
    await pendingClick; await settle();
    assert.deepEqual(f.visits, []); assert.equal(cleared, 0);
    assert.equal((await module.loadAuth()).authenticated, true);
    assert.equal(button.disabled, false); assert.equal(button.getAttribute("aria-busy"), undefined);
    assert.equal(message.hidden, false); assert.equal(message.textContent, language === "en" ? "Sign-out failed" : "Abmelden fehlgeschlagen");
    const reads = f.reads(); f.win.emit("focus"); await settle(); assert.ok(f.reads() > reads);
    await click();
    assert.equal(requests, 2); assert.equal(button.disabled, true); assert.equal(message.hidden, true);
    assert.deepEqual(f.visits, [["replace", publicGame ? "/zilch" : "/"]]);
  }
});

test("failed owned navigation restores fresh private availability but cannot revive a departed document", async () => {
  const f = await fixture(); await f.controller.refresh();
  const rollback = f.controller.prepareNavigation();
  assert.equal(f.games().some(game => game.id === "watten"), false);
  const reads = f.reads(); assert.equal(rollback(), true); await settle();
  assert.ok(f.reads() > reads); assert.equal(f.games().some(game => game.id === "watten"), true);
  const departed = f.controller.prepareNavigation(); f.win.emit("pagehide");
  const stoppedReads = f.reads(); assert.equal(departed(), false);
  f.win.emit("focus"); f.win.emit("pageshow", { persisted: true }); await settle();
  assert.equal(f.reads(), stoppedReads);
});

test("a failed navigation while hidden resumes a fresh identity read when the tab becomes visible", async () => {
  const f = await fixture(); await f.controller.refresh();
  const rollback = f.controller.prepareNavigation();
  f.doc.visibilityState = "hidden"; f.doc.emit("visibilitychange");
  const reads = f.reads(); assert.equal(rollback(), true); await settle(); assert.equal(f.reads(), reads);
  f.doc.visibilityState = "visible"; f.doc.emit("visibilitychange"); await settle();
  assert.ok(f.reads() > reads); assert.equal(f.games().some(game => game.id === "watten"), true);
});


test("public Watten discovery is independent of the beta label", async () => {
  for (const id of [null, 2]) {
    const f = await fixture({ state: auth(id, { watten_public: true }) });
    await f.controller.refresh();
    assert.equal(f.games().some(game => game.id === "watten"), true);
    assert.equal(f.games().find(game => game.id === "watten").publicBeta, true);
    assert.equal(f.reads(), 1);
    f.win.location.hostname = "hausdepp.zockdiewandan.online";
    f.win.location.href = "https://hausdepp.zockdiewandan.online/hausdepp";
    assert.equal(f.controller.set("watten"), true);
    assert.equal(new URL(f.visits.at(-1)[1]).origin, "https://watten.zockdiewandan.online");
  }
  const source = await read("../frontend/multigame/game-picker.js"), catalog = await read("../frontend/i18n/catalog.js");
  const picker = await import(url(source.replace('"../i18n/catalog.js"', JSON.stringify(url(catalog)))));
  assert.doesNotMatch(picker.gamePickerButtonMarkup({ id: "watten", name: "Watten", publicBeta: true }), /\[BETA\]/);
  assert.match(picker.gamePickerButtonMarkup({ id: "watten", name: "Watten", publicBeta: true, beta: true }), /\[BETA\]/);
  assert.doesNotMatch(picker.gamePickerButtonMarkup({ id: "watten", name: "Watten", publicBeta: true, beta: false }), /\[BETA\]/);
});

test("a public marker comes only from confirmed capability or the server's public document", async () => {
  for (const watten_public of [undefined, false, 1, "true"]) {
    const f = await fixture({ state: auth(1, { watten_preview: true, watten_public }) });
    f.storage.set("watten_public", "true");
    f.win.location.href = "http://localhost:8127/?watten_public=true";
    await f.controller.refresh();
    assert.equal(f.games().find(game => game.id === "watten").publicBeta, false);
  }
  const f = await fixture({ mode: "watten", publicWattenDocument: true, state: auth(null, { watten_public: true }) });
  assert.equal(f.reads(), 0);
  assert.equal(f.games().find(game => game.id === "watten").publicBeta, true);
  f.state(founder()); await f.controller.refresh();
  assert.equal(f.games().find(game => game.id === "watten").publicBeta, false);
});

test("public Watten keeps installed suite navigation on its own origin", () => {
  const desktop = { matchMedia: () => ({ matches: false }) };
  const installed = { navigator: { standalone: true } };
  const watten = { hostname: "watten.zockdiewandan.online", pathname: "/watten" };
  assert.equal(routes.wattenAppEntryUrl(watten, desktop, { publicBeta: true }), "https://watten.zockdiewandan.online/watten");
  assert.equal(routes.wattenAppEntryUrl(watten, installed, { publicBeta: true }), "/watten");
  assert.equal(routes.zdwaAppEntryUrl(watten, installed), "/zdwa");
  assert.equal(routes.zilchAppEntryUrl("/", watten, installed), "/zilch");
  assert.equal(routes.hausdeppAppEntryUrl(watten, installed), "/hausdepp");
});
