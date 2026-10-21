import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../frontend/i18n/index.js", import.meta.url), "utf8"))
  .replace('import { DE_MESSAGES, EN, EN_MESSAGES } from "./catalog.js";', "")
  .replace('import { initializeDeploymentNotice } from "../shared/deployment-notice.js";', "");
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(initial = "de", { seoLanguage, game, storageBlocked = false, href = "https://watten.zockdiewandan.online/watten" } = {}) {
  const saved = new Map([["zdwa_language", initial]]), requests = [];
  const html = { lang: initial, dataset: { ...(seoLanguage ? { wattenSeoLanguage: seoLanguage } : {}), ...(game ? { game } : {}) } };
  const navigations = [];
  let reloads = 0;
  const window = { alert() {}, confirm() {}, prompt() {} };
  vm.runInNewContext(source, {
    window, document: { documentElement: html, querySelector: () => null, addEventListener() {} },
    localStorage: {
      getItem: key => { if (storageBlocked) throw new Error("Storage blocked"); return saved.get(key) ?? null; },
      setItem: (key, value) => { if (storageBlocked) throw new Error("Storage blocked"); saved.set(key, value); },
    },
    URL, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9 },
    location: { href, assign(value) { navigations.push(value); }, reload() { reloads++; } },
    fetch(url, options = {}) {
      let resolve, reject;
      const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
      requests.push({ url, method: options.method || "GET", body: options.body && JSON.parse(options.body), resolve, reject });
      return pending;
    },
    DE_MESSAGES: {}, EN: {}, EN_MESSAGES: {},
  });
  const replyAuth = (request, language) => request.resolve({ ok: true,
    json: async () => ({ authenticated: true, user: { csrf_token: "test-csrf", preferences: { preferred_language: language } } }) });
  const replySaved = request => request.resolve({ ok: true });
  return { i18n: window.ZDWA_I18N, html, saved, requests, navigations, replyAuth, replySaved, get reloads() { return reloads; } };
}

test("an older account-language response cannot undo an explicit change before its reload", async () => {
  const app = setup("en");
  const changing = app.i18n.setLanguage("de");
  await settle();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, "/api/auth/me");
  // A separate, earlier loadAuth() read completes while persistence is waiting.
  assert.equal(app.i18n.syncAccountLanguage("en"), false);
  assert.equal(app.i18n.getLanguage(), "de");
  assert.equal(app.html.lang, "de");
  assert.equal(app.reloads, 0);
  app.replyAuth(app.requests[0], "en");
  await settle();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].method, "PUT");
  assert.equal(app.requests[1].body.preferred_language, "de");
  app.replySaved(app.requests[1]);
  await changing;
  assert.equal(app.reloads, 1);
  // Navigation has been requested but the current document may still receive a response.
  assert.equal(app.i18n.syncAccountLanguage("en"), false);
  assert.equal(app.i18n.getLanguage(), "de");
  assert.equal(app.reloads, 1);
});

test("a superseded account read never writes or reloads an earlier language choice", async () => {
  const app = setup("de");
  const first = app.i18n.setLanguage("en");
  await settle();
  const latest = app.i18n.setLanguage("de");
  app.replyAuth(app.requests[0], "de");
  await settle();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].url, "/api/auth/me");
  assert.equal(app.requests.filter(request => request.method === "PUT").length, 0);
  assert.equal(app.reloads, 0);
  app.replyAuth(app.requests[1], "de");
  await settle();
  assert.equal(app.requests.length, 3);
  assert.equal(app.requests[2].body.preferred_language, "de");
  app.replySaved(app.requests[2]);
  await Promise.all([first, latest]);
  assert.equal(app.reloads, 1);
  assert.equal(app.i18n.getLanguage(), "de");
});

test("an already sent write settles before the latest language is saved and alone reloads", async () => {
  const app = setup("de");
  const first = app.i18n.setLanguage("en");
  await settle(); app.replyAuth(app.requests[0], "de");
  await settle();
  assert.equal(app.requests[1].body.preferred_language, "en");
  const latest = app.i18n.setLanguage("de");
  await settle();
  assert.equal(app.requests.length, 2);
  assert.equal(app.i18n.syncAccountLanguage("en"), false);
  app.replySaved(app.requests[1]);
  await first; await settle();
  assert.equal(app.reloads, 0);
  assert.equal(app.requests[2].url, "/api/auth/me");
  app.replyAuth(app.requests[2], "en");
  await settle();
  assert.equal(app.requests[3].body.preferred_language, "de");
  app.replySaved(app.requests[3]);
  await latest;
  assert.equal(app.reloads, 1);
  assert.equal(app.i18n.getLanguage(), "de");
});

test("ordinary auth sync, invalid choices and explicit changes without persistence or reload retain their behavior", async () => {
  const app = setup("de");
  assert.equal(app.i18n.syncAccountLanguage("en"), true);
  assert.equal(app.i18n.getLanguage(), "en");
  assert.equal(app.reloads, 1);
  assert.equal(app.i18n.syncAccountLanguage("en"), false);
  assert.equal(app.i18n.syncAccountLanguage("fr"), false);
  await app.i18n.setLanguage("fr");
  assert.equal(app.i18n.getLanguage(), "en");
  await app.i18n.setLanguage("de", { persist: false, reload: false });
  assert.equal(app.i18n.getLanguage(), "de");
  assert.equal(app.html.lang, "de");
  assert.equal(app.requests.length, 0);
  assert.equal(app.reloads, 1);
  assert.equal(app.i18n.syncAccountLanguage("en"), true);
  assert.equal(app.reloads, 2);
});

test("public Watten language follows its SSR URL and account sync cannot replace the discovery language", async () => {
  for (const language of ["de", "en"]) {
    const other = language === "de" ? "en" : "de";
    const app = setup(other, { seoLanguage: language });
    assert.equal(app.i18n.getLanguage(), language);
    assert.equal(app.html.lang, language);
    assert.equal(app.i18n.syncAccountLanguage(other), false);
    assert.equal(app.reloads, 0);
    await app.i18n.setLanguage(other, { persist: false });
    assert.equal(app.navigations.length, 1);
    assert.equal(new URL(app.navigations[0]).searchParams.get("lang"), other === "en" ? "en" : null);
    assert.equal(app.reloads, 0);
  }
});

test("public Watten language switches keep the rule path, other query values and fragment", async () => {
  const app = setup("en", { seoLanguage: "en", href: "https://watten.zockdiewandan.online/watten/regeln?lang=en&source=help#bidding" });
  await app.i18n.setLanguage("de", { persist: false });
  assert.equal(app.navigations[0], "https://watten.zockdiewandan.online/watten/regeln?source=help#bidding");
});


test("the initial public language URL is saved locally for login without account writes or reloads", () => {
  for (const language of ["de", "en"]) {
    const app = setup(language === "en" ? "de" : "en", { seoLanguage: language });
    assert.equal(app.saved.get("zdwa_language"), language);
    assert.deepEqual(app.requests, []); assert.deepEqual(app.navigations, []); assert.equal(app.reloads, 0);
    const login = setup(app.saved.get("zdwa_language"), { href: "https://watten.zockdiewandan.online/watten/anmelden" });
    assert.equal(login.i18n.getLanguage(), language);
    assert.equal(login.html.lang, language); assert.deepEqual(login.requests, []);
  }
});

test("a valid public language stays usable with blocked storage; invalid language markers never replace a saved choice", () => {
  for (const language of ["de", "en"]) {
    const app = setup(language === "en" ? "de" : "en", { seoLanguage: language, storageBlocked: true });
    assert.equal(app.i18n.getLanguage(), language); assert.equal(app.html.lang, language);
    assert.equal(app.i18n.syncAccountLanguage(language === "en" ? "de" : "en"), false);
    assert.deepEqual(app.requests, []); assert.equal(app.reloads, 0);
  }
  const invalid = setup("en", { seoLanguage: "fr" });
  assert.equal(invalid.i18n.getLanguage(), "en"); assert.equal(invalid.saved.get("zdwa_language"), "en");
  assert.equal(setup("en", { storageBlocked: true }).i18n.getLanguage(), "de");
});


test("Watten login and dynamically rendered public return links keep English without changing explicit German or private links", () => {
  const anchor = (href, hreflang, tagName = "A") => {
    const attributes = new Map([["href", href], ...(hreflang ? [["hreflang", hreflang]] : [])]);
    return { nodeType: 1, tagName, childNodes: [], querySelectorAll: () => [], closest: () => null,
      hasAttribute: key => attributes.has(key), getAttribute: key => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value) };
  };
  const app = setup("en", { game: "watten", href: "https://watten.zockdiewandan.online/watten/anmelden" });
  for (const [href, hreflang, expected, tag] of [
    ["/watten", undefined, "/watten?lang=en"],
    ["/watten/regeln?source=help#bieten", undefined, "/watten/regeln?source=help&lang=en#bieten"],
    ["/watten/regeln", "de", "/watten/regeln"],
    ["/watten/anmelden", undefined, "/watten/anmelden"],
    ["https://elsewhere.test/watten", undefined, "https://elsewhere.test/watten"],
    ["/watten", undefined, "/watten", "LINK"],
  ]) {
    const node = anchor(href, hreflang, tag); app.i18n.translateElement(node);
    assert.equal(node.getAttribute("href"), expected);
  }
  const otherGame = setup("en", { game: "zdwa" }), untouched = anchor("/watten");
  otherGame.i18n.translateElement(untouched); assert.equal(untouched.getAttribute("href"), "/watten");
});
