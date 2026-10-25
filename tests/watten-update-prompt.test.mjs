import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = (await readFile(new URL("../frontend/watten/pwa.js", import.meta.url), "utf8")).replace(/export /g, "");
class Target {
  listeners = new Map();
  addEventListener(type, fn) { const handlers = this.listeners.get(type) || []; handlers.push(fn); this.listeners.set(type, handlers); }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
}
class Element extends Target {
  children = []; dataset = {}; hidden = false;
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ installControls = false, waiting = true, controller = true, installing = false, updateJob } = {}) {
  const win = new Target(), doc = new Target(), worker = new Target(), registration = new Target(), serviceWorker = new Target();
  const body = new Element(), manifest = new Element();
  manifest.href = "https://watten.zockdiewandan.online/watten-manifest.webmanifest?v=current";
  Object.assign(doc, { body, head: new Element(), documentElement: { dataset: { wattenPublicBeta: "true" } },
    visibilityState: "visible", createElement: () => new Element(), querySelector: selector => selector === "link[rel=manifest]" ? manifest : null });
  let now = 0, serial = 0, reloads = 0, updateCalls = 0;
  const timers = new Map(), messages = [];
  Object.assign(worker, { state: "installed", postMessage: message => messages.push(message) });
  Object.assign(registration, { waiting: waiting ? worker : null, installing: installing ? worker : null,
    update: async () => { updateCalls += 1; if (updateJob) await updateJob(); } });
  serviceWorker.controller = controller ? { scriptURL: "https://watten.zockdiewandan.online/watten-sw.js" } : null;
  serviceWorker.register = async (path, options) => { assert.equal(path, "/watten-sw.js"); assert.equal(options.scope, "/"); return registration; };
  const nav = { serviceWorker, onLine: true };
  Object.assign(win, { name: "", ZDWA_I18N: { t: value => value } });
  const initialize = runInNewContext(`${source}; initializeWattenPwa`, {
    window: win, document: doc, navigator: nav, URL, matchMedia: () => ({ matches: false }),
    sessionStorage: { getItem: () => null, setItem() {} },
    location: { hostname: "watten.zockdiewandan.online", href: "https://watten.zockdiewandan.online/watten/spiel/abcdef0123456789", reload: () => reloads++ },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id),
  });
  initialize({ installControls });
  const button = () => body.children.flatMap(node => node.children).find(node => Object.hasOwn(node.dataset, "wattenUpdate"));
  return { ready: win.WATTEN_PWA.ready, button, messages, worker, registration, doc, win, nav, serviceWorker,
    reloads: () => reloads, updates: () => updateCalls, timers,
    async advance(ms) { now += ms; for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.fn(); } await tick(); },
  };
}

test("active tables expose a waiting update even with install controls disabled; only a deliberate click reloads", async () => {
  const f = fixture(); await f.ready;
  assert.equal(f.button().hidden, false);
  assert.equal(f.button().textContent, "Watten aktualisieren");
  f.serviceWorker.emit("controllerchange");
  assert.equal(f.reloads(), 0); assert.equal(f.messages.length, 0);
  f.button().emit("click"); f.button().emit("click");
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].type, "SKIP_WAITING");
  f.serviceWorker.emit("controllerchange"); f.serviceWorker.emit("controllerchange");
  assert.equal(f.reloads(), 1);
});

test("a worker already installing when registration resolves still reveals its update after installation", async () => {
  const f = fixture({ waiting: false, installing: true }); await f.ready;
  assert.equal(f.button().hidden, true);
  f.registration.waiting = f.worker; f.worker.emit("statechange");
  assert.equal(f.button().hidden, false); assert.equal(f.messages.length, 0);
});

test("first installations never offer a refresh without a previous controlling worker", async () => {
  const f = fixture({ controller: false }); await f.ready;
  assert.equal(f.button().hidden, true);
});

function replacement(f, state = "installed") {
  const worker = new Target(), messages = [];
  Object.assign(worker, { state, postMessage: message => messages.push(message) });
  f.registration.waiting = worker;
  f.registration.installing = worker;
  f.registration.emit("updatefound"); worker.emit("statechange");
  return { worker, messages };
}

test("a requested worker becoming redundant hides its button, cancels reload intent and permits a later update", async () => {
  for (const cleared of [false, true]) {
    const f = fixture(); await f.ready;
    f.button().emit("click"); assert.equal(f.messages.length, 1);
    if (cleared) f.registration.waiting = null;
    f.worker.state = "redundant"; f.worker.emit("statechange");
    assert.equal(f.button().hidden, true);
    f.serviceWorker.emit("controllerchange"); assert.equal(f.reloads(), 0);
    const next = replacement(f);
    assert.equal(f.button().hidden, false); assert.equal(next.messages.length, 0);
    f.button().emit("click"); f.button().emit("click");
    assert.equal(next.messages.length, 1); assert.equal(next.messages[0].type, "SKIP_WAITING");
  }
});

test("a new non-null waiting worker replaces a pending request and requires its own explicit click", async () => {
  for (const cleared of [false, true]) {
    const f = fixture(); await f.ready;
    f.button().emit("click");
    if (cleared) { f.registration.waiting = null; f.worker.state = "activating"; f.worker.emit("statechange"); }
    const next = replacement(f);
    assert.notEqual(f.worker.state, "redundant", "replacement need not first announce redundancy");
    assert.equal(next.messages.length, 0); assert.equal(f.reloads(), 0);
    f.button().emit("click"); f.button().emit("click");
    assert.equal(f.messages.length, 1); assert.equal(next.messages.length, 1);
    f.serviceWorker.emit("controllerchange"); assert.equal(f.reloads(), 1);
  }
});

test("normal activation clears waiting before controllerchange without losing the explicit reload intent", async () => {
  const f = fixture(); await f.ready;
  f.button().emit("click"); f.button().emit("click");
  f.registration.waiting = null;
  f.worker.state = "activating"; f.worker.emit("statechange");
  assert.equal(f.button().hidden, true); assert.equal(f.messages.length, 1); assert.equal(f.reloads(), 0);
  f.serviceWorker.emit("controllerchange"); f.serviceWorker.emit("controllerchange");
  assert.equal(f.reloads(), 1);
});

test("a postMessage race re-arms a still-valid worker for retry without automatically reloading", async () => {
  const f = fixture(); await f.ready;
  let attempts = 0;
  f.worker.postMessage = message => {
    attempts += 1;
    if (attempts === 1) throw new Error("worker changed during activation request");
    f.messages.push(message);
  };
  assert.doesNotThrow(() => f.button().emit("click"));
  assert.equal(f.button().hidden, false); assert.equal(f.messages.length, 0);
  f.serviceWorker.emit("controllerchange"); assert.equal(f.reloads(), 0);
  f.button().emit("click"); f.button().emit("click");
  assert.equal(attempts, 2); assert.equal(f.messages.length, 1);
  f.registration.waiting = null; f.serviceWorker.emit("controllerchange");
  assert.equal(f.reloads(), 1);
});

test("only installed waiting workers expose an update action", async () => {
  for (const state of ["installing", "activating", "activated", "redundant"]) {
    const f = fixture(); f.worker.state = state; await f.ready;
    assert.equal(f.button().hidden, true, state);
    f.button().emit("click"); assert.equal(f.messages.length, 0);
  }
});

test("open visible documents check for updates once per minute, pause hidden/offline and resume on foreground", async () => {
  const f = fixture({ waiting: false }); await f.ready;
  assert.equal(f.updates(), 0);
  await f.advance(60000); assert.equal(f.updates(), 1);
  f.win.emit("focus"); f.doc.emit("visibilitychange"); await tick(); assert.equal(f.updates(), 1);
  f.doc.visibilityState = "hidden"; f.doc.emit("visibilitychange");
  await f.advance(120000); assert.equal(f.updates(), 1); assert.equal(f.timers.size, 0);
  f.doc.visibilityState = "visible"; f.doc.emit("visibilitychange"); await tick(); assert.equal(f.updates(), 2);
  f.nav.onLine = false; await f.advance(60000); assert.equal(f.updates(), 2); assert.equal(f.timers.size, 0);
  f.nav.onLine = true; f.win.emit("online"); await tick(); assert.equal(f.updates(), 3);
  f.win.emit("pagehide"); await f.advance(60000); assert.equal(f.updates(), 3);
  f.win.emit("pageshow"); await tick(); assert.equal(f.updates(), 4);
});

test("overlapping foreground events keep one in-flight update and one future check", async () => {
  let finish;
  const f = fixture({ updateJob: () => new Promise(resolve => { finish = resolve; }) }); await f.ready;
  await f.advance(60000);
  f.win.emit("focus"); f.doc.emit("visibilitychange"); await tick();
  assert.equal(f.updates(), 1); assert.equal(f.timers.size, 0);
  finish(); await tick(); assert.equal(f.timers.size, 1);
});
