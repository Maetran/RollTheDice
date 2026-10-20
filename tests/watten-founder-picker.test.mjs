import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  getAttribute(name) { return this.attributes.get(name); }
  closest() { return null; }
}
async function fixture({ state = founder(), mode = "zdwa", language = "de", loader, publicDocument = true } = {}) {
  const win = new Events(), doc = new Events(), button = new Element(), pickers = [], storage = new Map(), visits = [];
  doc.documentElement = { dataset: { game: mode } }; doc.visibilityState = "visible"; doc.activeElement = null;
  doc.querySelectorAll = selector => selector === "[data-game-switch]" ? [button] : [];
  doc.querySelector = selector => selector === "[data-game-switch]" ? button
    : publicDocument && selector.includes('data-hausdepp-public="true"') ? new Element() : null;
  const roots = new Map(); doc.getElementById = id => roots.get(id) || null;
  win.ZDWA_I18N = { getLanguage: () => language }; win.setInterval = () => 1;
  win.location = { hostname: "localhost", pathname: "/", href: "http://localhost:8127/", origin: "http://localhost:8127",
    assign: value => visits.push(["assign", value]), replace: value => visits.push(["replace", value]) };
  globalThis.window = win; globalThis.document = doc; globalThis.Element = Element;
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  let reads = 0, currentState = state;
  globalThis.__founderPicker = {
    async loadAuth(options) {
      assert.equal(options.refresh, true); reads += 1;
      const result = loader ? await loader(reads) : currentState;
      win.emit("zdwa:auth-state", { detail: result });
      return result;
    },
    createGamePicker(options) {
      const picker = { ...options, closes: 0, opened: false,
        update({ currentMode, games }) { const changed = JSON.stringify(this.games) !== JSON.stringify(games); if (changed) this.close(); this.games = games; this.currentMode = currentMode; },
        close() { this.closes += 1; this.opened = false; }, toggle() { this.opened = !this.opened; } };
      pickers.push(picker); return picker;
    },
  };
  const source = appSource.replace('"../shared/auth.js"', JSON.stringify(url("export const loadAuth=(...args)=>globalThis.__founderPicker.loadAuth(...args);")))
    .replace('"./routes.js"', JSON.stringify(url(routesSource)))
    .replace('"./game-picker.js"', JSON.stringify(url("export const createGamePicker=(...args)=>globalThis.__founderPicker.createGamePicker(...args);")));
  const { initializeAppMode } = await import(url(`${source}\n// fixture ${++serial}`));
  const controller = initializeAppMode({ mode, refreshOnInitialize: false });
  return { controller, win, doc, button, pickers, storage, visits, roots, reads: () => reads,
    games: () => pickers.at(-1)?.games || [], state(value) { currentState = value; },
    event(value) { win.emit("zdwa:auth-state", { detail: value }); } };
}

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
    assert.deepEqual(game, { id: "watten", name: "Watten", href: "/watten" });
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


test("public beta discovery is available to guests and ordinary accounts with a clear beta mark", async () => {
  for (const id of [null, 2]) {
    const f = await fixture({ state: auth(id, { watten_public: true }) });
    await f.controller.refresh();
    assert.equal(f.games().some(game => game.id === "watten"), true);
    assert.equal(f.reads(), 1);
    f.win.location.hostname = "hausdepp.zockdiewandan.online";
    f.win.location.href = "https://hausdepp.zockdiewandan.online/hausdepp";
    assert.equal(f.controller.set("watten"), true);
    assert.equal(new URL(f.visits.at(-1)[1]).origin, "https://watten.zockdiewandan.online");
  }
  const source = await read("../frontend/multigame/game-picker.js"), catalog = await read("../frontend/i18n/catalog.js");
  const picker = await import(url(source.replace('"../i18n/catalog.js"', JSON.stringify(url(catalog)))));
  assert.match(picker.gamePickerButtonMarkup({ id: "watten", name: "Watten" }), /\[BETA\]/);
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
