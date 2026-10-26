import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const lobbyCopy = await readFile(new URL("../frontend/watten/lobby-copy.js", import.meta.url), "utf8");
const source = (await readFile(new URL("../frontend/watten/favorites.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(catalog).toString("base64")}`))
  .replace('"./lobby-copy.js"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(lobbyCopy).toString("base64")}`));
const { applyFavoriteToCreator, createFavorites, readCreatorRecipe, syncCreatorProtection } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) {
  for (let index = 0; index < 30 && !condition(); index += 1) await tick();
  assert.ok(condition(), "Favorite operation did not finish");
}
const recipe = () => ({ kind: "watten_recipe", schema_version: 1, ruleset_id: "watten-house", ruleset_version: 1,
  player_count: 4, determination: "ladinisch", blind: true, critical: true, target_points: 13, cpu_seats: [1, 2, 3],
  show_rechter: false, trick_history: true, partner_hand: false, password_required: true,
  voice_enabled: false, schoeneres_enabled: true, schlagwechsel_enabled: false, tournament_nockerl_target: null });
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const payload = value => ({ schema_version: 1, game_type: "watten", recipe: value });
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, letter => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[letter]);

function creator() {
  const flags = Object.fromEntries(["blind", "critical", "show_rechter", "trick_history", "partner_hand", "voice_enabled", "schoeneres_enabled", "schlagwechsel_enabled", "cpu_fill"]
    .map(key => [key, { checked: false }]));
  const advanced = { open: false }, passwordNote = { textContent: "" };
  const elements = { ...flags, name: { value: "My chosen table" }, count: { value: "4" },
    determination: { value: "normal" }, password: { value: "old-private-password" },
    tournament_target: { value: "" }, tournament_custom: { value: "" },
    target: { value: "11", options: [{ value: "11" }], add(value) { this.options.push(value); } } };
  return { elements, advanced, passwordNote, ownerDocument: { createElement: () => ({}) },
    querySelector: selector => selector === "[data-watten-password-note]" ? passwordNote : advanced };
}

class Container {
  innerHTML = "";
  handlers = new Map();
  replaceChildren() { this.innerHTML = ""; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  removeEventListener(name, handler) { if (this.handlers.get(name) === handler) this.handlers.delete(name); }
  contains(control) { return control.owner === this; }
  click(action) {
    const control = { owner: this, disabled: false, dataset: { wattenFavoriteAction: action } };
    this.handlers.get("click")?.({ target: { closest: () => control } });
  }
}

function fixture({ fetcher, auth, language = "de" } = {}) {
  const container = new Container(), form = creator(), calls = [], applied = [];
  let changed = 0, authReads = 0, current = true, state;
  const client = createFavorites({ container, escapeHtml, language: () => language,
    getExpectedAccountId: () => 1, isCurrent: () => current,
    onState: value => { state = value; },
    onAccountChanged: () => { changed += 1; },
    getRecipe: () => readCreatorRecipe(form).recipe,
    applyRecipe: value => { applied.push(value); applyFavoriteToCreator(form, value); },
    loadAuth: async options => {
      assert.equal(options.refresh, true);
      authReads += 1;
      return auth ? auth(authReads) : { authenticated: true, user: { id: 1 } };
    },
    apiFetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher ? fetcher(url, options, calls.length)
        : response(payload(options.method === "DELETE" ? null : options.method === "PUT" ? JSON.parse(options.body).recipe : recipe()));
    } });
  return { client, form, container, calls, applied, state: () => state,
    changed: () => changed, invalidate: () => { current = false; } };
}

test("applying a protected favorite clears the secret; only a newly entered password protects creation", () => {
  const form = creator(), favorite = recipe();
  applyFavoriteToCreator(form, favorite);
  assert.equal(form.elements.name.value, "My chosen table");
  assert.equal(form.elements.password.value, "");
  assert.equal(form.elements.password.disabled, false);
  assert.equal(form.advanced.open, true);
  assert.match(form.passwordNote.textContent, /neues/);
  assert.deepEqual(readCreatorRecipe(form).recipe, { ...favorite, password_required: false });
  form.elements.password.value = "new-private-password";
  const protectedCreation = readCreatorRecipe(form);
  assert.equal(protectedCreation.recipe.password_required, true);
  assert.equal(protectedCreation.password, "new-private-password");
  form.elements.password.value = "";
  syncCreatorProtection(form);
  assert.equal(form.elements.password.value, "");
  const unprotectedCreation = readCreatorRecipe(form);
  assert.equal(unprotectedCreation.password, "");
  assert.equal(unprotectedCreation.recipe.password_required, false);
});

test("favorite apply preserves CPU wishes and arbitrary valid target options without submitting", () => {
  const form = creator();
  const favorite = { ...recipe(), target_points: 99 };
  applyFavoriteToCreator(form, favorite);
  assert.deepEqual(readCreatorRecipe(form).recipe, { ...favorite, password_required: false });
  assert.ok(form.elements.target.options.some(option => option.value === "99"));
  assert.equal(form.elements.cpu_fill.checked, true);
  assert.equal(form.elements.schoeneres_enabled.checked, true);
  assert.equal(form.elements.voice_enabled.checked, false);
});

test("older favorites default Schöneres off and audio on while malformed or three-player requests are rejected", () => {
  const form = creator(), legacy = recipe();
  delete legacy.schoeneres_enabled; delete legacy.schlagwechsel_enabled; delete legacy.voice_enabled; delete legacy.tournament_nockerl_target;
  applyFavoriteToCreator(form, legacy);
  assert.equal(form.elements.schoeneres_enabled.checked, false);
  assert.equal(form.elements.schlagwechsel_enabled.checked, false);
  assert.equal(form.elements.voice_enabled.checked, true);
  assert.equal(readCreatorRecipe(form).recipe.tournament_nockerl_target, null);
  for (const value of [null, "true", 1]) {
    assert.throws(() => applyFavoriteToCreator(form, { ...recipe(), schoeneres_enabled: value }));
  }
  const solo = { ...recipe(), player_count: 3, determination: "normal", blind: false, cpu_seats: [1, 2] };
  assert.throws(() => applyFavoriteToCreator(form, solo));
  applyFavoriteToCreator(form, { ...solo, schoeneres_enabled: false });
  assert.equal(readCreatorRecipe(form).recipe.schoeneres_enabled, false);
});

test("strike swap favorites are explicit and historical inert three-player preferences still decode", () => {
  const form = creator();
  applyFavoriteToCreator(form, { ...recipe(), schlagwechsel_enabled: true });
  assert.equal(readCreatorRecipe(form).recipe.schlagwechsel_enabled, true);
  applyFavoriteToCreator(form, { ...recipe(), player_count: 3, determination: "normal",
    blind: false, cpu_seats: [1, 2], schoeneres_enabled: false, schlagwechsel_enabled: true });
  assert.equal(form.elements.schlagwechsel_enabled.checked, true);
});

test("tournament presets and custom positive integer targets survive favorite apply without starting a match", () => {
  for (const target of [3, 5, 8, 10, 15, 20, 1, 37, Number.MAX_SAFE_INTEGER]) {
    const form = creator(), favorite = { ...recipe(), tournament_nockerl_target: target };
    applyFavoriteToCreator(form, favorite);
    assert.equal(form.elements.tournament_target.value, [3, 5, 8, 10, 15, 20].includes(target) ? String(target) : "custom");
    assert.equal(form.elements.tournament_custom.value, String(target));
    assert.deepEqual(readCreatorRecipe(form).recipe, { ...favorite, password_required: false });
  }
  for (const target of [0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1, true, "5"]) {
    assert.throws(() => applyFavoriteToCreator(creator(), { ...recipe(), tournament_nockerl_target: target }));
  }
  const form = creator();
  form.elements.tournament_target.value = "custom";
  for (const value of ["", "0", "-2", "2.5", "9007199254740992"]) {
    form.elements.tournament_custom.value = value;
    assert.throws(() => readCreatorRecipe(form));
  }
  assert.throws(() => applyFavoriteToCreator(creator(), { ...recipe(), player_count: 3, determination: "normal",
    blind: false, cpu_seats: [1, 2], schoeneres_enabled: false, tournament_nockerl_target: 5 }));
});

test("initial GET only loads the own favorite and an explicit apply never creates a table", async () => {
  const f = fixture(); await until(() => f.state()?.message === "ready");
  assert.equal(f.applied.length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/watten/favorite");
  assert.equal(f.calls[0].options.headers["X-Watten-Expected-Account-Id"], "1");
  assert.equal(f.form.elements.password.value, "old-private-password");
  assert.equal(f.client.applyStored(), true);
  assert.equal(f.applied.length, 1);
  assert.equal(f.form.elements.password.value, "");
  assert.match(f.form.passwordNote.textContent, /neues/);
  assert.equal(f.calls.length, 1);
  f.client.destroy();
});

test("save transmits only the canonical current recipe, never a filled passphrase", async () => {
  const f = fixture(); await until(() => f.state()?.message === "ready");
  f.client.applyStored(); f.form.elements.password.value = "must-not-be-saved";
  f.container.click("save"); await until(() => f.calls.length === 2 && f.container.innerHTML.includes("Einstellungen sind gespeichert"));
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { recipe: recipe() });
  assert.equal(f.calls[1].options.headers["X-Watten-Expected-Account-Id"], "1");
  assert.ok(!f.calls[1].options.body.includes("must-not-be-saved"));
  f.container.click("delete"); await until(() => f.calls.length === 3 && f.container.innerHTML.includes("wurde gelöscht"));
  assert.equal(f.calls[2].options.method, "DELETE");
  assert.equal(f.calls[2].options.body, undefined);
  assert.ok(f.calls.every(call => call.url === "/api/watten/favorite"));
  f.client.destroy();
});

test("GET failures offer a local retry and malformed saved recipes are never applied", async () => {
  const f = fixture({ fetcher: async (_url, _options, attempt) => {
    if (attempt === 1) throw new Error("offline");
    return response(payload({ ...recipe(), passphrase: "private-corruption" }));
  } });
  await until(() => f.container.innerHTML.includes('action="retry"'));
  f.container.click("retry"); await until(() => f.calls.length === 2 && f.container.innerHTML.includes('action="retry"'));
  assert.equal(f.client.applyStored(), false);
  assert.equal(f.applied.length, 0);
  assert.ok(!f.container.innerHTML.includes("private-corruption"));
  f.client.destroy();
});

test("mutation retry preserves the original explicit save rather than newer form edits", async () => {
  const f = fixture({ fetcher: async (_url, options, attempt) => {
    if (attempt === 2) throw new Error("offline");
    return response(payload(options.method === "PUT" ? JSON.parse(options.body).recipe : recipe()));
  } });
  await until(() => f.state()?.message === "ready");
  f.client.applyStored(); f.container.click("save");
  await until(() => f.container.innerHTML.includes('action="retry"'));
  f.form.elements.target.value = "21";
  f.container.click("retry"); await until(() => f.calls.length === 3 && f.container.innerHTML.includes("Einstellungen sind gespeichert"));
  assert.equal(f.calls[1].options.body, f.calls[2].options.body);
  f.client.destroy();
});

test("expected-account conflict or a post-body fresh account switch clears private favorite state", async () => {
  for (const config of [
    { fetcher: async () => response({ detail: "watten_account_changed" }, 409) },
    { auth: async attempt => ({ authenticated: true, user: { id: attempt <= 2 ? 1 : 2 } }) },
  ]) {
    const f = fixture(config); await until(() => f.changed() === 1);
    assert.equal(f.container.innerHTML, "");
    assert.equal(f.applied.length, 0);
  }
});

test("destroy aborts an in-flight request and late responses cannot restore the old favorite", async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture({ fetcher: () => pending });
  await until(() => f.calls.length === 1);
  f.client.destroy();
  assert.equal(f.calls[0].options.signal.aborted, true);
  resolve(response(payload(recipe()))); await tick();
  assert.equal(f.container.innerHTML, "");
  assert.equal(f.applied.length, 0);
});

test("favorite controls have English copy and remain separate from create/start", async () => {
  const f = fixture({ language: "en" });
  await until(() => f.state()?.message === "ready");
  assert.match(f.container.innerHTML, /A password is never saved/);
  f.client.applyStored();
  assert.match(f.container.innerHTML, /Favorite applied/);
  assert.equal(f.calls.length, 1);
  f.client.destroy();
});
