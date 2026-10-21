import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const catalog = dataURL(await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8"));
const source = (await readFile(new URL("../frontend/shared/deployment-notice.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(catalog));
const { initializeDeploymentNotice, normalizeDeploymentNotice } = await import(dataURL(source));
const { DEPLOYMENT_NOTICE_MESSAGES } = await import(catalog);
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element extends EventTarget {
  children = [];
  attributes = new Map();
  parent = null;
  get parentElement() { return this.parent; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}

function setup(language = "de", { storageBlocked = false, offlineMarker = false, legacyOffline = false, path = "/regeln" } = {}) {
  let clock = Date.parse("2026-10-21T18:00:00Z"), timerId = 0;
  const timers = new Map(), requests = [], saved = new Map(), session = new Map();
  const host = new EventTarget(), doc = new EventTarget();
  doc.body = new Element(); doc.createElement = () => new Element(); doc.visibilityState = "visible";
  doc.documentElement = { dataset: { offlinePractice: String(offlineMarker) } };
  doc.body.classList = { contains: name => legacyOffline && name === "practice-page" };
  const storage = values => ({
    getItem(key) { if (storageBlocked) throw new Error("blocked"); return values.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw new Error("blocked"); values.set(key, value); },
  });
  Object.assign(host, {
    navigator: { onLine: true }, AbortController,
    location: { pathname: path },
    localStorage: storage(saved), sessionStorage: storage(session),
    ZDWA_I18N: { getLanguage: () => language },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      let resolve, reject;
      const result = new Promise((done, fail) => { resolve = done; reject = fail; });
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      requests.push({ url, options, resolve, reject });
      return result;
    },
  });
  const options = { window: host, document: doc, now: () => clock };
  const controller = initializeDeploymentNotice(options);
  const notice = (id = "release-1", milliseconds = 330000) => ({ id,
    restart_at: new Date(clock + 30000).toISOString(), expires_at: new Date(clock + milliseconds).toISOString() });
  const reply = async (payload, index = requests.length - 1, ok = true) => {
    requests[index].resolve({ ok, json: async () => payload }); await settle();
  };
  const runTimer = async delay => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `missing timer ${delay}`);
    timers.delete(entry[0]); entry[1].callback(); await settle();
  };
  const event = (target, type, properties = {}) => { const e = new Event(type); Object.assign(e, properties); target.dispatchEvent(e); };
  return { host, doc, requests, saved, session, options, controller, notice, reply, runTimer, event, timers,
    advance: milliseconds => { clock += milliseconds; },
    get banner() { return doc.body.children[0]; },
    get button() { return doc.body.children[0]?.children[1]; },
  };
}

test("local practice never creates a poller, even online or restored at an online URL", () => {
  for (const options of [
    { offlineMarker: true, path: "/spiel/restored-online-path" },
    { legacyOffline: true, path: "/spiel/restored-online-path" },
    { path: "/offline-spielen" }, { path: "/zilch/offline-spielen" }, { path: "/zdwa/offline-spielen" },
  ]) {
    const app = setup("de", options);
    assert.equal(app.controller, null);
    for (const type of ["online", "pageshow", "offline", "online"]) app.event(app.host, type);
    app.event(app.doc, "visibilitychange");
    assert.equal(app.requests.length, 0);
    assert.equal(app.timers.size, 0);
    assert.equal(app.banner, undefined);
  }
});

test("only a bounded id and valid future time range form an active announcement", () => {
  const now = Date.now(), value = { id: "release.4-1_0", restart_at: new Date(now + 30000).toISOString(), expires_at: new Date(now + 90000).toISOString() };
  assert.equal(normalizeDeploymentNotice(value, now).id, value.id);
  for (const change of [{ id: "<script>" }, { id: "x".repeat(81) }, { restart_at: "bad" }, { expires_at: "bad" }, { expires_at: value.restart_at }]) {
    assert.equal(normalizeDeploymentNotice({ ...value, ...change }, now), null);
  }
  assert.equal(normalizeDeploymentNotice(value, now + 90001), null);
});

for (const language of ["de", "en"]) {
  test(`${language}: localized non-modal warning has OK and keeps the current page interactive`, async () => {
    const app = setup(language);
    assert.equal(app.requests[0].url, "/api/deployment-notice");
    assert.equal(app.requests[0].options.cache, "no-store");
    assert.equal(app.requests[0].options.credentials, "same-origin");
    assert.equal(app.requests[0].options.keepalive, true);
    await app.reply({ notice: app.notice() });
    assert.equal(app.banner.children[0].attributes.get("role"), "status");
    assert.equal(app.banner.children[0].children[0].textContent, DEPLOYMENT_NOTICE_MESSAGES[language].title);
    assert.equal(app.banner.children[0].children[1].textContent, DEPLOYMENT_NOTICE_MESSAGES[language].message);
    assert.equal(app.button.textContent, "OK");
    app.button.dispatchEvent(new Event("click"));
    assert.equal(app.banner, undefined);
    assert.equal(app.saved.size, 1);
    await app.runTimer(3000);
    await app.reply({ notice: app.notice() });
    assert.equal(app.banner, undefined);
    app.controller.destroy();
  });
}

test("acknowledgement survives navigation and a new rollout is independently visible", async () => {
  const app = setup();
  await app.reply({ notice: app.notice() });
  app.button.dispatchEvent(new Event("click"));
  app.controller.destroy();
  const next = initializeDeploymentNotice(app.options);
  await app.reply({ notice: app.notice() });
  assert.equal(app.banner, undefined);
  await app.runTimer(3000);
  await app.reply({ notice: app.notice("release-2") });
  assert.equal(app.banner.attributes.get("data-deployment-notice"), "release-2");
  next.destroy();
});

test("another tab's OK hides the same notice and duplicate initialization cannot double poll", async () => {
  const app = setup();
  assert.equal(initializeDeploymentNotice(app.options), app.controller);
  assert.equal(app.requests.length, 1);
  const notice = app.notice();
  await app.reply({ notice });
  app.event(app.host, "storage", { key: "rollthedice.deployment-notice.ack.release-other", newValue: String(Date.parse(notice.expires_at)) });
  assert.ok(app.banner);
  app.event(app.host, "storage", { key: "rollthedice.deployment-notice.ack.release-1", newValue: String(Date.parse(notice.expires_at)) });
  assert.equal(app.banner, undefined);
  app.controller.destroy();
});

test("blocked storage preserves current-page OK and does not break the game", async () => {
  const app = setup("de", { storageBlocked: true });
  await app.reply({ notice: app.notice() });
  app.button.dispatchEvent(new Event("click"));
  await app.runTimer(3000);
  await app.reply({ notice: app.notice() });
  assert.equal(app.banner, undefined);
  app.controller.destroy();
});

test("server clear and local expiry remove warnings even while polling is offline", async () => {
  const app = setup();
  await app.reply({ notice: app.notice() });
  await app.runTimer(3000);
  await app.reply({ notice: null });
  assert.equal(app.banner, undefined);
  await app.runTimer(3000);
  await app.reply({ notice: app.notice("release-2") });
  app.host.navigator.onLine = false;
  app.event(app.host, "offline");
  app.advance(330001);
  await app.runTimer(330000);
  assert.equal(app.banner, undefined);
  assert.equal(app.timers.size, 0);
  app.controller.destroy();
});

test("malformed responses and network errors retain a warning with bounded backoff", async () => {
  const app = setup();
  await app.reply({ notice: app.notice() });
  await app.runTimer(3000);
  await app.reply({ notice: { id: "bad", expires_at: "bad" } });
  assert.ok(app.banner);
  await app.runTimer(6000);
  app.requests.at(-1).reject(new Error("offline")); await settle();
  assert.ok(app.banner);
  await app.runTimer(6000);
  await app.reply({ notice: null });
  assert.equal(app.banner, undefined);
  assert.ok([...app.timers.values()].some(timer => timer.delay === 3000));
  app.controller.destroy();
});

test("initial pageshow, visibility and online events reuse the pending startup read", async () => {
  const app = setup();
  app.event(app.host, "pageshow");
  app.event(app.doc, "visibilitychange");
  app.event(app.host, "online");
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].options.signal.aborted, false);
  await app.reply({ notice: app.notice() });
  assert.ok(app.banner);
  app.controller.destroy();
});

test("hidden and offline pages let pending reads settle without rendering or scheduling more reads", async () => {
  const app = setup();
  app.doc.visibilityState = "hidden";
  app.event(app.doc, "visibilitychange");
  assert.equal(app.requests[0].options.signal.aborted, false);
  await app.reply({ notice: app.notice() });
  assert.equal(app.banner, undefined);
  assert.equal(app.timers.size, 0);
  app.event(app.host, "online");
  assert.equal(app.requests.length, 1);
  app.doc.visibilityState = "visible";
  app.event(app.doc, "visibilitychange");
  assert.equal(app.requests.length, 2);
  await app.reply({ notice: app.notice() });
  app.event(app.host, "pagehide");
  assert.equal(app.timers.size, 1); // Only expiry, no network polling.
  app.event(app.host, "pageshow");
  assert.equal(app.requests.length, 3);
  app.event(app.host, "pagehide");
  app.event(app.host, "pageshow");
  assert.equal(app.requests.length, 3);
  assert.equal(app.requests[2].options.signal.aborted, false);
  await app.reply({ notice: null });
  await app.runTimer(3000);
  app.host.navigator.onLine = false; app.event(app.host, "offline");
  assert.equal(app.requests[3].options.signal.aborted, false);
  await app.reply({ notice: app.notice() });
  assert.equal(app.banner, undefined);
  assert.equal(app.timers.size, 0);
  app.host.navigator.onLine = true; app.event(app.host, "online");
  assert.equal(app.requests.length, 5);
  await app.reply({ notice: null });
  app.controller.destroy();
});

test("only timeout and explicit destruction abort a pending read and never schedule stale work", async () => {
  const app = setup();
  await app.runTimer(5000);
  assert.equal(app.requests[0].options.signal.aborted, true);
  await app.runTimer(6000);
  assert.equal(app.requests.length, 2);
  app.controller.destroy();
  assert.equal(app.requests.at(-1).options.signal.aborted, true);
  await app.reply({ notice: app.notice() });
  app.event(app.host, "pageshow");
  assert.equal(app.banner, undefined);
  assert.equal(app.requests.length, 2);
  assert.equal(app.timers.size, 0);
});
