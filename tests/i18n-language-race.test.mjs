import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (await readFile(new URL("../frontend/i18n/index.js", import.meta.url), "utf8"))
  .replace('import { DE_MESSAGES, EN, EN_MESSAGES } from "./catalog.js";', "");
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(initial = "de") {
  const saved = new Map([["zdwa_language", initial]]), requests = [];
  const html = { lang: initial };
  let reloads = 0;
  const window = { alert() {}, confirm() {}, prompt() {} };
  vm.runInNewContext(source, {
    window, document: { documentElement: html, querySelector: () => null, addEventListener() {} },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    location: { reload() { reloads++; } },
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
  return { i18n: window.ZDWA_I18N, html, requests, replyAuth, replySaved, get reloads() { return reloads; } };
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
