import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`;
const source = (await readFile(new URL("../frontend/watten/match-progress.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(catalogUrl));
const { createMatchProgress, publicTitleMarkup } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const gameId = "0123456789abcdef";
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) {
  for (let index = 0; index < 30 && !condition(); index += 1) await tick();
  assert.ok(condition(), "Controller did not finish the expected transition");
}
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const presentation = () => ({ schema_version: 1, game_type: "watten", status: "draft", generation: 1,
  game_id: gameId, through_sequence: 7, credit: { xp: 10, outcome: "won" },
  achievements: [{ id: "own-goal", name: { de: "Gerade geschafft", en: "Just earned" }, xp: 20 }],
  title: { level: 2, threshold: 20, name: { de: "Banklfinder", en: "Bench finder" } } });
const snapshot = () => ({ id: gameId, game_type: "watten", result_persisted: true,
  viewer: { participant_id: "p1" }, engine: { phase: "match_complete", viewer: { player_id: "p1", seat: 0 } } });
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, letter => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[letter]);

class Container {
  hidden = true;
  markup = "";
  writes = 0;
  handlers = new Map();
  set innerHTML(value) { this.markup = value; this.writes += 1; }
  get innerHTML() { return this.markup; }
  replaceChildren() { this.innerHTML = ""; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  removeEventListener(name, handler) { if (this.handlers.get(name) === handler) this.handlers.delete(name); }
  contains(control) { return control.owner === this; }
  click(action) {
    const control = { owner: this, disabled: false, dataset: { wattenMatchProgressAction: action } };
    this.handlers.get("click")?.({ target: { closest: () => control } });
  }
}

function fixture({ fetcher, auth, language = "de" } = {}) {
  const calls = [], container = new Container();
  let identity = 1, current = true, changed = 0, authReads = 0;
  const client = createMatchProgress({ gameId, escapeHtml, language: () => language,
    getExpectedAccountId: () => 1, isCurrent: () => current,
    onAccountChanged: () => { changed += 1; },
    loadAuth: async options => {
      authReads += 1;
      assert.equal(options.refresh, true);
      return auth ? auth(authReads) : { authenticated: identity !== null, user: { id: identity } };
    },
    apiFetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher ? fetcher(url, options, calls.length) : response(options.method === "POST"
        ? { ok: true, game_id: gameId, generation: 1, through_sequence: 7 } : presentation());
    } });
  const update = (extra = {}) => client.update({ container, snapshot: snapshot(), playerId: "p1", spectator: false, ...extra });
  return { client, container, calls, update, changed: () => changed, setIdentity: value => { identity = value; },
    invalidate: () => { current = false; } };
}

test("only a saved terminal own human projection can load match progress", async () => {
  const f = fixture();
  for (const extra of [
    { spectator: true }, { playerId: "p2" },
    { snapshot: { ...snapshot(), result_persisted: false } },
    { snapshot: { ...snapshot(), engine: { phase: "play", viewer: { player_id: "p1", seat: 0 } } } },
    { snapshot: { ...snapshot(), engine: { phase: "match_complete" } } },
  ]) f.update(extra);
  await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.container.innerHTML, "");
  f.client.destroy();
});

test("one GET survives repeated game renders and remounts without automatic acknowledgement", async () => {
  const f = fixture(); f.update();
  await until(() => f.container.innerHTML.includes("+30 XP"));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `/api/watten/account/matches/${gameId}/presentation`);
  assert.equal(f.calls[0].options.headers["X-Watten-Expected-Account-Id"], "1");
  const writes = f.container.writes;
  for (let index = 0; index < 5; index += 1) f.update();
  assert.equal(f.container.writes, writes);
  const next = new Container();
  f.update({ container: next });
  assert.match(next.innerHTML, /Gerade geschafft/);
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.calls.length, 1);
  f.client.destroy();
});

test("dismiss sends only this match's captured generation and sequence, then stays dismissed", async () => {
  const f = fixture(); f.update();
  await until(() => f.container.innerHTML.includes("+30 XP"));
  f.container.click("dismiss");
  await until(() => f.calls.length === 2 && f.container.hidden);
  const ack = f.calls[1];
  assert.equal(ack.url, `/api/watten/account/matches/${gameId}/presentation/acknowledge`);
  assert.equal(ack.options.headers["X-Watten-Expected-Account-Id"], "1");
  assert.deepEqual(JSON.parse(ack.options.body), { generation: 1, through_sequence: 7 });
  for (let index = 0; index < 3; index += 1) f.update();
  assert.equal(f.calls.length, 2);
  assert.equal(f.container.innerHTML, "");
  f.client.destroy();
});

test("already presented matches stay empty without POST or repeated GET", async () => {
  const data = { ...presentation(), through_sequence: 0, credit: null, achievements: [] };
  const f = fixture({ fetcher: async () => response(data) }); f.update();
  await until(() => f.calls.length === 1 && f.container.hidden);
  f.update(); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.container.innerHTML, "");
  f.client.destroy();
});

test("network failure offers local retry; ACK retry preserves the exact original envelope", async () => {
  const f = fixture({ fetcher: async (_url, options, attempt) => {
    if (attempt === 1 || attempt === 3) throw new Error("offline");
    return response(options.method === "POST" ? { ok: true, game_id: gameId, generation: 1, through_sequence: 7 } : presentation());
  } });
  f.update(); await until(() => f.container.innerHTML.includes('action="retry"'));
  f.container.click("retry"); await until(() => f.container.innerHTML.includes("+30 XP"));
  f.container.click("dismiss"); await until(() => f.container.innerHTML.includes('action="retry"'));
  assert.match(f.container.innerHTML, /Gerade geschafft/);
  f.container.click("retry"); await until(() => f.calls.length === 4 && f.container.hidden);
  assert.equal(f.calls[2].options.body, f.calls[3].options.body);
  f.client.destroy();
});

test("destroy aborts and clears synchronously; a late previous-account response cannot mount", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture({ fetcher: () => pending }); f.update();
  await until(() => f.calls.length === 1);
  f.client.destroy();
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.container.innerHTML, "");
  resolve(response(presentation())); await tick();
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.calls.length, 1);
});

test("a fresh post-body account change clears before notifying the owner", async () => {
  const f = fixture({ auth: async attempt => ({ authenticated: true, user: { id: attempt === 1 ? 1 : 2 } }) });
  f.update(); await until(() => f.changed() === 1);
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.container.hidden, true);
  assert.equal(f.calls.length, 1);
});

test("server-side expected-account rejection never mounts private progress", async () => {
  const f = fixture({ fetcher: async () => response({ detail: "watten_account_changed" }, 409) });
  f.update(); await until(() => f.changed() === 1);
  assert.equal(f.container.innerHTML, "");
});

test("post-body verification waits out an old focus read before requesting decisive fresh identity", async () => {
  const f = fixture({ auth: async attempt => ({ authenticated: true, user: { id: attempt <= 2 ? 1 : 2 } }) });
  f.update(); await until(() => f.changed() === 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.container.innerHTML, "");
});

test("stale generation requires an explicit refresh of this match instead of hidden global acknowledgement", async () => {
  const f = fixture({ fetcher: async (_url, _options, attempt) => attempt === 2
    ? response({ detail: "watten_progress_stale_ack" }, 409) : response(presentation()) });
  f.update(); await until(() => f.container.innerHTML.includes("+30 XP"));
  f.container.click("dismiss"); await until(() => f.container.innerHTML.includes('action="retry"'));
  assert.equal(f.calls.length, 2);
  f.container.click("retry"); await until(() => f.calls.length === 3 && f.container.innerHTML.includes("+30 XP"));
  assert.equal(f.calls[2].options.method, undefined);
  assert.ok(f.calls.every(call => call.url.includes(`/matches/${gameId}/presentation`)));
  f.client.destroy();
});

test("foreign-game responses fail locally, and bilingual names are escaped", async () => {
  const foreign = fixture({ fetcher: async () => response({ ...presentation(), game_id: "fedcba9876543210" }) });
  foreign.update(); await until(() => foreign.container.innerHTML.includes('action="retry"'));
  assert.doesNotMatch(foreign.container.innerHTML, /Gerade geschafft/);
  foreign.client.destroy();
  const data = presentation();
  data.achievements[0].name.en = '<img src=x onerror="bad()">';
  const english = fixture({ language: "en", fetcher: async () => response(data) });
  english.update(); await until(() => english.container.innerHTML.includes("+30 XP"));
  assert.match(english.container.innerHTML, /Your progress from this match/);
  assert.match(english.container.innerHTML, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.doesNotMatch(english.container.innerHTML, /<img/);
  english.client.destroy();
});

test("seat titles use only the explicit current-language public projection and keep null empty", () => {
  const options = { language: "en", escapeHtml };
  for (const value of [null, undefined, {}, { level: 1, name: { de: "Erfunden", en: "Invented" } },
    { level: true, threshold: 0, name: { de: "Falsch", en: "Wrong" } }]) assert.equal(publicTitleMarkup(value, options), "");
  const title = { level: 2, threshold: 20, name: { de: "Banklfinder", en: '<b onclick="bad()">Bench finder</b>' } };
  const markup = publicTitleMarkup(title, options);
  assert.match(markup, /Watten title:/);
  assert.match(markup, /&lt;b onclick=&quot;bad\(\)&quot;&gt;Bench finder&lt;\/b&gt;/);
  assert.doesNotMatch(markup, /<b|Banklfinder/);
  assert.match(publicTitleMarkup(title, { ...options, language: "de" }), /Banklfinder/);
});
