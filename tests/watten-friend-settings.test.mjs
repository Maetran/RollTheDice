import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const source = (await readFile(new URL("../frontend/watten/friend-settings.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`));
const { mountFriendSettings } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition, message = "condition not reached") {
  for (let index = 0; index < 40 && !condition(); index += 1) await tick();
  assert.ok(condition(), message);
}
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, letter => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[letter]);
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const user = id => ({ authenticated: true, user: { id, csrf_token: `csrf-${id}`, preferences: {} } });

class Stub { textContent = ""; innerHTML = ""; hidden = false; disabled = false; value = ""; dataset = {}; }
class Container extends EventTarget {
  innerHTML = "";
  stubs = new Map();
  replaceChildren() { this.innerHTML = ""; this.stubs.clear(); }
  querySelector(selector) {
    if (!this.stubs.has(selector)) this.stubs.set(selector, new Stub());
    return this.stubs.get(selector);
  }
  contains(control) { return control.owner === this; }
  action(name) { return this.querySelector(`[data-friend-action="${name}"]`); }
  click(name, accountId) {
    let disabled = this.action(name).disabled;
    if (accountId !== undefined) {
      const match = this.querySelector(name === "add" ? "[data-friend-results]" : "[data-friend-selected]").innerHTML
        .match(new RegExp(`data-friend-action="${name}" data-account-id="${accountId}"[^>]*?( disabled)?>`));
      // A forged control without a rendered row reaches the controller guard.
      disabled = Boolean(match?.[1]);
    }
    const control = { owner: this, disabled, dataset: { friendAction: name, accountId: accountId === undefined ? undefined : String(accountId) } };
    const event = new Event("click");
    Object.defineProperty(event, "target", { value: { closest: () => control } });
    this.dispatchEvent(event);
  }
  submit(query) {
    this.querySelector("[data-friend-query]").value = query;
    const event = new Event("submit", { cancelable: true });
    Object.defineProperty(event, "target", { value: { matches: selector => selector === "[data-friend-search-form]" } });
    this.dispatchEvent(event);
  }
  choose(audience) {
    const select = this.querySelector("[data-friend-audience]");
    select.value = audience;
    const event = new Event("change");
    Object.defineProperty(event, "target", { value: select });
    this.dispatchEvent(event);
  }
  text(selector) { return this.querySelector(selector).textContent; }
  html(selector) { return this.querySelector(selector).innerHTML; }
}

const DIRECTORY = [
  ...Array.from({ length: 45 }, (_, index) => ({ id: index + 100, username: `Spieler${String(index).padStart(2, "0")}` })),
  { id: 7, username: "Ich" }, { id: 3, username: "<b>Bold</b>" },
].sort((a, b) => a.username.localeCompare(b.username));

function server({ enabled = false, audience = "all", players = [], limit = 100 } = {}) {
  const state = { enabled, audience, players: [...players], limit };
  const payload = () => ({ viewer_id: 7, audience: state.audience, limit: state.limit, players: [...state.players] });
  return { state, handle(url, options) {
    const path = new URL(url, "https://watten.example");
    const body = options.body ? JSON.parse(options.body) : null;
    if (path.pathname === "/api/friend-activity/preferences") {
      if (options.method === "PUT") state.enabled = body.enabled;
      return response({ viewer_id: 7, enabled: state.enabled });
    }
    if (path.pathname === "/api/web-push/allowlist") {
      if (options.method === "PUT") state.audience = body.audience;
      return response(payload());
    }
    const member = path.pathname.match(/^\/api\/web-push\/allowlist\/(\d+)$/);
    if (member) {
      const id = Number(member[1]);
      if (options.method === "DELETE") state.players = state.players.filter(player => player.id !== id);
      else if (state.players.length >= state.limit) return response({ detail: "push_allowlist_limit" }, 409);
      else state.players.push({ ...DIRECTORY.find(player => player.id === id), active: true });
      return response(payload());
    }
    if (path.pathname === "/api/players/search") {
      const query = path.searchParams.get("query").toLowerCase();
      const offset = Number(path.searchParams.get("offset")), size = Number(path.searchParams.get("limit"));
      const found = DIRECTORY.filter(player => player.username.toLowerCase().includes(query));
      return response({ players: found.slice(offset, offset + size).map(player => ({ ...player, achievement_rank: null })), limit: size, offset });
    }
    return response({ detail: "not_found" }, 404);
  } };
}

function fixture({ backend = server(), fetcher, auth } = {}) {
  const container = new Container(), calls = [];
  let changed = 0, reads = 0;
  const client = mountFriendSettings({ container, viewerId: 7, isCurrent: () => true, escapeHtml, language: () => "de",
    onAccountChanged: () => { changed += 1; },
    loadAuth: async options => { assert.equal(options.refresh, true); reads += 1; return auth ? auth(reads) : user(7); },
    fetcher: async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
      return fetcher ? fetcher(url, options, calls.length, backend) : backend.handle(url, options);
    } });
  return { client, container, calls, backend, changed: () => changed, reads: () => reads,
    mutations: () => calls.filter(call => call.options.method !== "GET") };
}
test("controls are bound and visibly disabled before loads; mounting only reads and keeps false consent", async () => {
  const f = fixture();
  assert.equal(f.container.action("consent-toggle").disabled, true);
  assert.equal(f.container.querySelector("[data-friend-audience]").disabled, true);
  assert.equal(f.container.action("audience-save").disabled, true);
  await until(() => f.container.text("[data-friend-consent-status]") === "Startmeldungen sind für dein Konto ausgeschaltet.");
  await until(() => f.container.text("[data-friend-count]") === "0 von 100 ausgewählt.");
  await tick(); await tick();
  assert.deepEqual(f.calls.map(call => [call.options.method, call.url]).sort(), [
    ["GET", "/api/friend-activity/preferences"], ["GET", "/api/web-push/allowlist"]]);
  assert.ok(f.calls.every(call => call.options.headers["X-Watten-Expected-Account-Id"] === "7" && call.options.body === undefined));
  assert.equal(f.backend.state.enabled, false);
  assert.equal(f.container.action("consent-toggle").disabled, false);
  assert.equal(f.container.action("consent-toggle").textContent, "Startmeldungen einschalten");
  f.client.destroy();
});

test("consent save names the captured viewer with its fresh CSRF proof", async () => {
  const f = fixture();
  await until(() => !f.container.action("consent-toggle").disabled);
  f.container.click("consent-toggle");
  await until(() => f.container.text("[data-friend-consent-status]") === "Startmeldungen sind für dein Konto eingeschaltet.");
  const [save] = f.mutations();
  assert.equal(save.url, "/api/friend-activity/preferences");
  assert.equal(save.options.method, "PUT");
  assert.deepEqual(save.body, { enabled: true, viewer_id: 7 });
  assert.equal(save.options.headers["X-CSRF-Token"], "csrf-7");
  assert.equal(save.options.headers["X-Watten-Expected-Account-Id"], "7");
  assert.equal(f.container.action("consent-toggle").textContent, "Startmeldungen ausschalten");
});

test("account A->B before a mutation or during its response body clears without saving or mounting", async () => {
  let switched = false;
  const early = fixture({ auth: () => user(switched ? 8 : 7) });
  await until(() => !early.container.action("consent-toggle").disabled);
  switched = true;
  early.container.click("consent-toggle");
  await until(() => early.changed() === 1);
  assert.equal(early.mutations().length, 0);
  assert.equal(early.container.innerHTML, "");

  let release, bodySwitched = false;
  const gate = new Promise(resolve => { release = resolve; });
  const late = fixture({ auth: () => user(bodySwitched ? 8 : 7), fetcher: (url, options, _count, backend) => {
    if (options.method !== "PUT") return backend.handle(url, options);
    return { ok: true, status: 200, json: async () => { await gate; return { viewer_id: 7, enabled: true }; } };
  } });
  await until(() => !late.container.action("consent-toggle").disabled);
  late.container.click("consent-toggle");
  await until(() => late.mutations().length === 1);
  bodySwitched = true;
  release();
  await until(() => late.changed() === 1);
  assert.equal(late.container.innerHTML, "");
  assert.equal(late.container.stubs.size, 0, "no field of the old account is written after clearing");
});

test("an expected-account conflict clears the private page", async () => {
  const f = fixture({ fetcher: () => response({ detail: "watten_account_changed" }, 409) });
  await until(() => f.changed() >= 1);
  assert.equal(f.container.innerHTML, "");
});

test("a failed save keeps the choice, never repeats itself and retries only explicitly", async () => {
  let failures = 1;
  const f = fixture({ fetcher: (url, options, _count, backend) => {
    if (options.method === "PUT" && failures-- > 0) throw new Error("offline");
    return backend.handle(url, options);
  } });
  await until(() => !f.container.action("consent-toggle").disabled);
  f.container.click("consent-toggle");
  await until(() => f.container.text("[data-friend-consent-status]").startsWith("Die Änderung konnte nicht bestätigt werden"));
  assert.equal(f.container.action("consent-retry").hidden, false);
  assert.equal(f.container.action("consent-retry").textContent, "Dieselbe Änderung erneut versuchen");
  for (let index = 0; index < 5; index += 1) await tick();
  assert.equal(f.mutations().length, 1);
  f.container.click("consent-retry");
  await until(() => f.container.text("[data-friend-consent-status]") === "Startmeldungen sind für dein Konto eingeschaltet.");
  assert.equal(f.mutations().length, 2);
  assert.deepEqual(f.mutations()[1].body, f.mutations()[0].body);
});

test("a failed load offers an explicit reload instead of a fake state", async () => {
  let fail = true;
  const f = fixture({ fetcher: (url, options, _count, backend) => {
    if (url === "/api/friend-activity/preferences" && fail) { fail = false; return response({}, 500); }
    return backend.handle(url, options);
  } });
  await until(() => f.container.text("[data-friend-consent-status]") === "Die Einstellung konnte nicht geladen werden.");
  assert.equal(f.container.action("consent-toggle").hidden, true);
  assert.equal(f.container.action("consent-retry").textContent, "Erneut laden");
  f.container.click("consent-retry");
  await until(() => f.container.text("[data-friend-consent-status]") === "Startmeldungen sind für dein Konto ausgeschaltet.");
});

test("search pages are bounded to 20, explicit and stale pages never merge into a newer search", async () => {
  let hold = false, release;
  const f = fixture({ fetcher: async (url, options, _count, backend) => {
    if (hold && url.includes("offset=20")) { await new Promise(resolve => { release = resolve; }); }
    return backend.handle(url, options);
  } });
  await until(() => f.container.text("[data-friend-count]") !== "");
  f.container.submit("   ");
  assert.equal(f.container.text("[data-friend-search-status]"), "Gib einen Teil des Namens ein oder wähle «Alle zeigen».");
  assert.equal(f.calls.filter(call => call.url.startsWith("/api/players/search")).length, 0);
  f.container.click("show-all");
  await until(() => (f.container.html("[data-friend-results]").match(/<li>/g) || []).length === 20);
  const first = new URL(f.calls.at(-1).url, "https://watten.example");
  assert.deepEqual(Object.fromEntries(first.searchParams), { query: "", limit: "21", offset: "0" });
  assert.equal(f.container.action("load-more").hidden, false);
  hold = true;
  f.container.click("load-more");
  await until(() => typeof release === "function");
  f.container.submit("Spieler4");
  await until(() => f.container.html("[data-friend-results]").includes("Spieler44"));
  release(); await tick(); await tick(); await tick();
  const rows = f.container.html("[data-friend-results]");
  assert.equal((rows.match(/<li>/g) || []).length, 5, "Spieler40..44 only");
  assert.ok(!rows.includes("Spieler20"), "the stale page of the older search was discarded");
  assert.equal(f.container.action("load-more").hidden, true);
});

test("long directory browsing retains a bounded result window while advancing the canonical page offset", async () => {
  const offsets = [];
  const f = fixture({ fetcher: (url, options, _count, backend) => {
    if (!url.startsWith("/api/players/search")) return backend.handle(url, options);
    const offset = Number(new URL(url, "https://watten.example").searchParams.get("offset"));
    offsets.push(offset);
    return response({ players: Array.from({ length: 21 }, (_, index) => ({
      id: 1000 + offset + index, username: `Directory ${offset + index}`,
    })) });
  } });
  await until(() => !f.container.action("audience-save").disabled || f.container.text("[data-friend-count]") !== "");
  f.container.click("show-all");
  for (let page = 0; page < 12; page += 1) {
    await until(() => offsets.length === page + 1 && !f.container.action("load-more").disabled);
    const html = f.container.html("[data-friend-results]");
    assert.equal((html.match(/<li>/g) || []).length, Math.min((page + 1) * 20, 100));
    assert.ok(html.includes(`data-account-id="${1000 + page * 20}"`));
    if (page >= 5) assert.ok(!html.includes('data-account-id="1000"'));
    if (page < 11) f.container.click("load-more");
  }
  assert.deepEqual(offsets, Array.from({ length: 12 }, (_, page) => page * 20));
  assert.equal(f.mutations().length, 0);
  f.client.destroy();
});

test("Add uses the canonical returned account ID only, without Push or friendship side effects", async () => {
  const f = fixture();
  await until(() => f.container.text("[data-friend-count]") !== "");
  f.container.submit("bold");
  await until(() => f.container.html("[data-friend-results]").includes("&lt;b&gt;Bold&lt;/b&gt;"));
  assert.ok(!f.container.html("[data-friend-results]").includes("<b>"));
  f.container.click("add", 999);
  f.container.submit("Ich");
  await until(() => f.container.html("[data-friend-results]").includes("Das bist du"));
  f.container.click("add", 7);
  await tick();
  assert.equal(f.mutations().length, 0, "neither a guessed ID nor the own account is saved");
  f.container.submit("bold");
  await until(() => f.container.html("[data-friend-results]").includes("Bold"));
  f.container.click("add", 3);
  await until(() => f.container.text("[data-friend-count]") === "1 von 100 ausgewählt.");
  assert.deepEqual(f.mutations().map(call => [call.options.method, call.url, call.body]), [
    ["PUT", "/api/web-push/allowlist/3", { viewer_id: 7 }]]);
  assert.equal(f.mutations()[0].options.headers["X-CSRF-Token"], "csrf-7");
  assert.ok(f.calls.every(call => !/subscribe|push\/(?!allowlist)|friend-request|categor/.test(call.url)));
  assert.match(f.container.html("[data-friend-selected]"), /&lt;b&gt;Bold&lt;\/b&gt;/);
  assert.match(f.container.html("[data-friend-results]"), /data-account-id="3"[^>]* disabled>Ausgewählt/);
});

test("inactive players, the limit and removal are visible and explicit", async () => {
  const backend = server({ limit: 2, audience: "allowlist", players: [
    { id: 100, username: "Spieler00", active: false }, { id: 101, username: "Spieler01", active: true }] });
  const f = fixture({ backend });
  await until(() => f.container.text("[data-friend-count]").startsWith("2 von 2 ausgewählt."));
  assert.match(f.container.text("[data-friend-count]"), /Maximum von 2 Spielern/);
  assert.match(f.container.html("[data-friend-selected]"), /Spieler00<\/span> <span class="watten-friends-tag">Inaktiv/);
  f.container.click("show-all");
  await until(() => f.container.html("[data-friend-results]").includes("Spieler02"));
  assert.match(f.container.html("[data-friend-results]"), /data-account-id="102"[^>]* disabled>/);
  f.container.click("add", 102);
  await tick();
  assert.equal(f.mutations().length, 0);
  f.container.click("remove", 100);
  await until(() => f.container.text("[data-friend-count]") === "1 von 2 ausgewählt.");
  assert.deepEqual(f.mutations().map(call => [call.options.method, call.url, call.body]), [
    ["DELETE", "/api/web-push/allowlist/100", { viewer_id: 7 }]]);
});

test("audience edits warn about an empty selection; limit errors are shown without auto retry", async () => {
  const f = fixture({ fetcher: (url, options, _count, backend) => url.startsWith("/api/web-push/allowlist/")
    ? response({ detail: "push_allowlist_limit" }, 409) : backend.handle(url, options) });
  await until(() => f.container.text("[data-friend-count]") !== "");
  assert.equal(f.container.querySelector("[data-friend-warning]").hidden, true);
  f.container.choose("allowlist");
  assert.equal(f.container.querySelector("[data-friend-warning]").hidden, false);
  f.container.click("audience-save");
  await until(() => f.container.text("[data-friend-selection-status]") === "Gespeichert.");
  assert.deepEqual(f.mutations()[0].body, { audience: "allowlist", viewer_id: 7 });
  f.container.click("show-all");
  await until(() => f.container.html("[data-friend-results]").includes("Spieler00"));
  f.container.click("add", 100);
  await until(() => f.container.text("[data-friend-selection-status]") === "Das Maximum ist erreicht. Entferne zuerst jemanden.");
  assert.equal(f.container.action("selection-retry").hidden, true);
  for (let index = 0; index < 5; index += 1) await tick();
  assert.equal(f.mutations().length, 2);
});

test("a failed audience save keeps the edited choice for an explicit retry", async () => {
  let failures = 1;
  const f = fixture({ fetcher: (url, options, _count, backend) => {
    if (options.method === "PUT" && failures-- > 0) throw new Error("offline");
    return backend.handle(url, options);
  } });
  await until(() => f.container.text("[data-friend-count]") !== "");
  f.container.choose("allowlist");
  f.container.click("audience-save");
  await until(() => f.container.action("selection-retry").hidden === false);
  assert.equal(f.container.querySelector("[data-friend-audience]").value, "allowlist");
  f.container.click("selection-retry");
  await until(() => f.backend.state.audience === "allowlist");
  assert.deepEqual(f.mutations().map(call => call.body), [{ audience: "allowlist", viewer_id: 7 }, { audience: "allowlist", viewer_id: 7 }]);
});

test("destroy aborts in-flight requests and late responses never touch the cleared page", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture({ fetcher: () => pending });
  await until(() => f.calls.length === 2);
  f.client.destroy();
  assert.ok(f.calls.every(call => call.options.signal.aborted));
  resolve(response({ viewer_id: 7, enabled: true }));
  await tick(); await tick();
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.container.stubs.size, 0);
});
