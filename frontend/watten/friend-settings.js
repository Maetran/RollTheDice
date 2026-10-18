import { WATTEN_FRIEND_MESSAGES } from "../i18n/catalog.js";

const PAGE = 20;
const SEARCH_WINDOW = 100;
const AUDIENCES = Object.freeze(["all", "allowlist"]);
const ACCOUNT_CHANGED = new Set(["watten_account_changed", "friend_activity_viewer_changed", "allowlist_viewer_changed"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const accountId = value => Number.isSafeInteger(value) && value > 0;
const username = value => typeof value === "string" && value.trim() !== "" && [...value].length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
const languageNow = () => globalThis.window?.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";

export function friendSettingsText(key, values = {}, language = languageNow()) {
  return WATTEN_FRIEND_MESSAGES[language === "en" ? "en" : "de"][key]
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function allowlist(data, viewerId) {
  if (!object(data) || data.viewer_id !== viewerId || !AUDIENCES.includes(data.audience)
      || !Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 1000
      || !Array.isArray(data.players) || data.players.length > data.limit) return null;
  const players = [];
  for (const player of data.players) {
    if (!object(player) || !accountId(player.id) || !username(player.username) || typeof player.active !== "boolean") return null;
    players.push(Object.freeze({ id: player.id, username: player.username, active: player.active }));
  }
  return { audience: data.audience, limit: data.limit, players };
}

/**
 * Own private start-notice consent and account-based player selection. All
 * mutations name the mounted viewer and carry that viewer's fresh CSRF proof;
 * nothing is saved or enabled without an explicit click.
 */
export function mountFriendSettings({ container, viewerId, isCurrent, onAccountChanged, loadAuth,
  fetcher = (url, options) => globalThis.fetch(url, options), escapeHtml: esc, language = languageNow }) {
  const t = (key, values = {}) => friendSettingsText(key, values, language());
  const listeners = new AbortController(), requests = new Set();
  const serials = { consent: 0, selection: 0, search: 0 };
  const consent = { enabled: null, busy: false, status: "loading", failed: null };
  const selection = { loaded: false, audience: null, limit: 0, players: [], busy: false, status: "loading", failed: null, retryable: false };
  const search = { query: null, results: [], offset: 0, more: false, busy: false, status: "", controller: null };
  let destroyed = false;
  const current = () => !destroyed && isCurrent();
  const live = (area, token) => () => current() && serials[area] === token;
  const field = name => container.querySelector(`[data-friend-${name}]`);
  const action = name => container.querySelector(`[data-friend-action="${name}"]`);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const area of Object.keys(serials)) serials[area] += 1;
    for (const controller of requests) controller.abort();
    requests.clear(); listeners.abort();
    selection.players = []; search.results = [];
    container.replaceChildren();
  }
  function changed() { destroy(); onAccountChanged(); }

  async function verify(alive, count) {
    let auth;
    for (let index = 0; index < count; index += 1) {
      auth = await loadAuth({ refresh: true });
      if (!alive()) return null;
      if (!auth?.authenticated || auth.user?.id !== viewerId) { changed(); return null; }
    }
    return auth;
  }

  async function request(alive, path, { method = "GET", body, controller = new AbortController() } = {}) {
    const auth = await verify(alive, 1);
    if (!auth) return null;
    const headers = { "X-Watten-Expected-Account-Id": String(viewerId) };
    const options = { method, headers, cache: "no-store", credentials: "same-origin", signal: controller.signal };
    if (method !== "GET") {
      // Bind the mutation to the mounted viewer and its freshly confirmed token.
      if (typeof auth.user.csrf_token !== "string" || !auth.user.csrf_token) throw new Error("csrf");
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = auth.user.csrf_token;
      options.body = JSON.stringify({ ...body, viewer_id: viewerId });
    }
    requests.add(controller);
    try {
      const response = await fetcher(path, options);
      if (!alive()) return null;
      const data = await response.json().catch(() => null);
      if (!alive()) return null;
      if (response.status === 401 || response.status === 409 && ACCOUNT_CHANGED.has(data?.detail)) { changed(); return null; }
      // Decisive fresh reads after the body: never mount another account's data.
      if (!await verify(alive, 2)) return null;
      return { ok: response.ok, data };
    } finally { requests.delete(controller); }
  }

  function playerRow(player, button) {
    return `<li><span translate="no">${esc(player.username)}</span>${player.active === false ? ` <span class="watten-friends-tag">${esc(t("inactive"))}</span>` : ""}${button}</li>`;
  }
  function update() {
    if (!current()) { container.replaceChildren(); return; }
    const toggle = action("consent-toggle");
    field("consent-status").textContent = t(consent.status);
    field("consent-status").dataset.kind = consent.failed ? "error" : "";
    toggle.textContent = t(consent.enabled ? "disable" : "enable");
    toggle.disabled = consent.busy || consent.enabled === null;
    toggle.hidden = consent.enabled === null && Boolean(consent.failed);
    action("consent-retry").hidden = !consent.failed || consent.busy;
    action("consent-retry").textContent = t(consent.failed?.kind === "load" ? "retryLoad" : "retry");

    const full = selection.loaded && selection.players.length >= selection.limit;
    const audience = field("audience");
    audience.disabled = !selection.loaded || selection.busy;
    action("audience-save").disabled = !selection.loaded || selection.busy || audience.value === selection.audience;
    field("warning").hidden = !selection.loaded || selection.players.length > 0
      || (audience.value !== "allowlist" && selection.audience !== "allowlist");
    field("count").textContent = selection.loaded ? `${t("count", { count: selection.players.length, limit: selection.limit })}${full ? ` ${t("limitReached", { limit: selection.limit })}` : ""}` : "";
    field("selected").innerHTML = !selection.loaded ? "" : selection.players.length ? selection.players.map(player => playerRow(player,
      ` <button type="button" class="ghost" data-friend-action="remove" data-account-id="${player.id}" aria-label="${esc(t("removeLabel", { name: player.username }))}"${selection.busy ? " disabled" : ""}>${esc(t("remove"))}</button>`)).join("")
      : `<li>${esc(t("empty"))}</li>`;
    field("selection-status").textContent = selection.status ? t(selection.status) : "";
    field("selection-status").dataset.kind = selection.failed ? "error" : "";
    action("selection-retry").hidden = !selection.retryable || selection.busy;
    action("selection-retry").textContent = t(selection.failed?.method === "GET" ? "retryLoad" : "retry");

    const chosen = new Set(selection.players.map(player => player.id));
    field("results").innerHTML = search.results.map(player => {
      const own = player.id === viewerId, picked = chosen.has(player.id);
      const disabled = own || picked || full || selection.busy || !selection.loaded;
      return playerRow(player, ` <button type="button" data-friend-action="add" data-account-id="${player.id}" aria-label="${esc(own ? t("self") : picked ? t("selected") : t("addLabel", { name: player.username }))}"${disabled ? " disabled" : ""}>${esc(own ? t("self") : picked ? t("selected") : t("add"))}</button>`);
    }).join("");
    field("search-status").textContent = search.status ? t(search.status) : "";
    field("search-status").dataset.kind = search.status === "searchFailed" ? "error" : "";
    action("load-more").hidden = !search.more;
    action("load-more").disabled = search.busy;
  }

  async function loadConsent() {
    const token = ++serials.consent, alive = live("consent", token);
    consent.busy = true; consent.failed = null; consent.status = "loading"; update();
    try {
      const result = await request(alive, "/api/friend-activity/preferences");
      if (!result) return;
      const data = result.data;
      if (!result.ok || !object(data) || data.viewer_id !== viewerId || typeof data.enabled !== "boolean") throw new Error("invalid");
      consent.enabled = data.enabled; consent.status = data.enabled ? "activityOn" : "activityOff";
    } catch {
      if (!alive()) return;
      consent.failed = { kind: "load" }; consent.status = "loadFailed";
    } finally { if (alive()) { consent.busy = false; update(); } }
  }

  async function saveConsent(enabled) {
    if (consent.busy || !current()) return;
    const token = ++serials.consent, alive = live("consent", token);
    consent.busy = true; consent.failed = null; consent.status = "saving"; update();
    try {
      const result = await request(alive, "/api/friend-activity/preferences", { method: "PUT", body: { enabled } });
      if (!result) return;
      const data = result.data;
      if (!result.ok || !object(data) || data.viewer_id !== viewerId || data.enabled !== enabled) throw new Error("invalid");
      consent.enabled = enabled; consent.status = enabled ? "activityOn" : "activityOff";
    } catch {
      if (!alive()) return;
      // The explicit choice is kept for a deliberate retry; never auto-repeated.
      consent.failed = { kind: "save", enabled }; consent.status = "saveFailed";
    } finally { if (alive()) { consent.busy = false; update(); } }
  }

  async function selectionRequest(operation) {
    if (selection.busy || !current()) return;
    const token = ++serials.selection, alive = live("selection", token);
    selection.busy = true; selection.failed = null; selection.retryable = false;
    selection.status = operation.method === "GET" ? "loading" : "saving"; update();
    try {
      const result = await request(alive, operation.path, { method: operation.method, body: operation.body });
      if (!result) return;
      if (!result.ok) {
        const error = new Error("selection"); error.code = result.data?.detail; throw error;
      }
      const data = allowlist(result.data, viewerId);
      if (!data) throw new Error("invalid");
      selection.loaded = true; selection.audience = data.audience; selection.limit = data.limit; selection.players = data.players;
      if (operation.method === "GET" || operation.kind === "audience") field("audience").value = data.audience;
      selection.status = operation.method === "GET" ? "" : "saved";
    } catch (error) {
      if (!alive()) return;
      selection.failed = operation;
      selection.status = operation.method === "GET" ? "loadFailed" : error.code === "push_allowlist_limit" ? "limitError"
        : error.code === "push_allowlist_invalid" ? "invalidPlayer" : "saveFailed";
      selection.retryable = !["limitError", "invalidPlayer"].includes(selection.status);
    } finally { if (alive()) { selection.busy = false; update(); } }
  }

  async function fetchPage() {
    if (search.query === null || !current()) return;
    const token = ++serials.search, alive = live("search", token);
    search.controller?.abort();
    const controller = new AbortController(), { query, offset } = search;
    search.controller = controller; search.busy = true; search.status = "searching"; update();
    try {
      const params = new URLSearchParams({ query, limit: String(PAGE + 1), offset: String(offset) });
      const result = await request(alive, `/api/players/search?${params}`, { controller });
      if (!result) return;
      const players = result.data?.players;
      if (!result.ok || !Array.isArray(players) || players.length > PAGE + 1) throw new Error("invalid");
      const page = [];
      for (const player of players.slice(0, PAGE)) {
        if (!object(player) || !accountId(player.id) || !username(player.username)) throw new Error("invalid");
        // Only the canonical returned account ID is kept for an explicit Add.
        page.push(Object.freeze({ id: player.id, username: player.username }));
      }
      const known = new Set(search.results.map(player => player.id));
      search.results = [...search.results, ...page.filter(player => !known.has(player.id))].slice(-SEARCH_WINDOW);
      search.offset = offset + PAGE; search.more = players.length > PAGE;
      search.status = search.results.length ? "" : "noResults";
    } catch {
      if (!alive()) return;
      search.status = "searchFailed";
    } finally {
      if (alive()) { search.busy = false; search.controller = null; update(); }
    }
  }
  function startSearch(query) {
    search.query = query; search.results = []; search.offset = 0; search.more = false;
    void fetchPage();
  }

  container.innerHTML = `<section class="watten-friends" aria-labelledby="wattenFriendActivityTitle">
      <h3 id="wattenFriendActivityTitle">${esc(t("activityHeading"))}</h3><p>${esc(t("activityHelp"))}</p>
      <p role="status" data-friend-consent-status>${esc(t("loading"))}</p>
      <div class="actions"><button type="button" data-friend-action="consent-toggle" disabled>${esc(t("enable"))}</button>
        <button type="button" class="ghost" data-friend-action="consent-retry" hidden>${esc(t("retryLoad"))}</button></div>
    </section>
    <section class="watten-friends" aria-labelledby="wattenFriendSelectionTitle">
      <h3 id="wattenFriendSelectionTitle">${esc(t("selectionHeading"))}</h3><p>${esc(t("selectionHelp"))}</p>
      <label>${esc(t("audienceLabel"))}<select data-friend-audience disabled>
        <option value="all">${esc(t("audienceAll"))}</option><option value="allowlist">${esc(t("audienceAllowlist"))}</option></select></label>
      <div class="actions"><button type="button" data-friend-action="audience-save" disabled>${esc(t("audienceSave"))}</button></div>
      <p class="watten-friends-warning" data-friend-warning hidden>${esc(t("emptyAllowlist"))}</p>
      <p data-friend-count></p>
      <ul class="watten-friends-list" data-friend-selected aria-label="${esc(t("selectionHeading"))}"></ul>
      <p role="status" data-friend-selection-status>${esc(t("loading"))}</p>
      <div class="actions"><button type="button" class="ghost" data-friend-action="selection-retry" hidden>${esc(t("retry"))}</button></div>
      <form data-friend-search-form role="search"><label>${esc(t("searchLabel"))}<input type="search" data-friend-query maxlength="64" autocomplete="off" spellcheck="false"></label>
        <div class="actions"><button type="submit">${esc(t("search"))}</button>
          <button type="button" class="ghost" data-friend-action="show-all">${esc(t("showAll"))}</button></div></form>
      <p role="status" data-friend-search-status>${esc(t("searchHint"))}</p>
      <p>${esc(t("searchWindow", { count: SEARCH_WINDOW }))}</p>
      <ul class="watten-friends-list" data-friend-results aria-label="${esc(t("results"))}"></ul>
      <div class="actions"><button type="button" class="ghost" data-friend-action="load-more" hidden>${esc(t("loadMore"))}</button></div>
    </section>`;

  container.addEventListener("click", event => {
    const control = event.target.closest?.("[data-friend-action]");
    if (!control || control.disabled || !container.contains(control) || !current()) return;
    const id = Number(control.dataset.accountId);
    switch (control.dataset.friendAction) {
      case "consent-toggle": if (consent.enabled !== null) void saveConsent(!consent.enabled); break;
      case "consent-retry":
        if (consent.failed?.kind === "save") void saveConsent(consent.failed.enabled);
        else if (consent.failed?.kind === "load") void loadConsent();
        break;
      case "audience-save": {
        const audience = field("audience").value;
        if (selection.loaded && AUDIENCES.includes(audience)) {
          void selectionRequest({ kind: "audience", method: "PUT", path: "/api/web-push/allowlist", body: { audience } });
        }
        break;
      }
      case "selection-retry": if (selection.failed && selection.retryable) void selectionRequest(selection.failed); break;
      case "add": {
        const player = search.results.find(item => item.id === id);
        if (!player || player.id === viewerId || selection.players.some(item => item.id === id)
            || selection.players.length >= selection.limit) break;
        void selectionRequest({ kind: "add", method: "PUT", path: `/api/web-push/allowlist/${player.id}`, body: {} });
        break;
      }
      case "remove": {
        const player = selection.players.find(item => item.id === id);
        if (player) void selectionRequest({ kind: "remove", method: "DELETE", path: `/api/web-push/allowlist/${player.id}`, body: {} });
        break;
      }
      case "show-all": startSearch(""); break;
      case "load-more": if (search.more && !search.busy) void fetchPage(); break;
      default: break;
    }
  }, { signal: listeners.signal });
  container.addEventListener("submit", event => {
    if (!event.target.matches?.("[data-friend-search-form]")) return;
    event.preventDefault();
    if (!current()) return;
    const query = String(field("query").value || "").trim();
    if (!query) { serials.search += 1; search.query = null; search.results = []; search.more = false; search.status = "searchHint"; update(); return; }
    startSearch(query.slice(0, 64));
  }, { signal: listeners.signal });
  container.addEventListener("change", event => {
    if (event.target === field("audience") && current()) update();
  }, { signal: listeners.signal });

  if (!accountId(viewerId) || !current()) { destroy(); return { destroy }; }
  void loadConsent();
  void selectionRequest({ kind: "load", method: "GET", path: "/api/web-push/allowlist" });
  return { destroy };
}
