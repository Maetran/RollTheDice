import { apiFetch } from "./auth.js";
import { hausdeppSignInUrl, zdwaPath, zilchPath } from "../multigame/routes.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const format = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), t(text));
const endpoint = "/api/web-push/allowlist";
const SEARCH_PAGE = 20;
const SEARCH_DELAY = 300;
const navigationClass = context => context === "hausdepp" ? "hd-secondary" : "button-link small ghost";
let mountCount = 0;

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, className = "small ghost", type = "button") {
  const node = element("button", text, className);
  node.type = type;
  return node;
}

// Account names are literal user content; the i18n observer must not rewrite them.
function playerName(player, context) {
  const name = element(player.active === false ? "span" : "a", player.username, "player-allowlist-name");
  name.setAttribute("translate", "no");
  if (player.active !== false) name.href = playerProfileHref(player.username, context);
  return name;
}

export function playerProfileHref(username, context = "zdwa") {
  return (context === "zilch" ? zilchPath : zdwaPath)(`/spieler/${encodeURIComponent(username)}`);
}

function accountHref(context) {
  if (context === "hausdepp") return "/hausdepp/konto/einstellungen?allowlist=1#spielerauswahl";
  return (context === "zilch" ? zilchPath : zdwaPath)("/konto?allowlist=1#settings");
}

function errorText(error) {
  const messages = {
    push_allowlist_limit: "Du kannst höchstens 100 Spieler auswählen.",
    push_allowlist_invalid: "Dieser Spieler kann nicht hinzugefügt werden. Wähle ein anderes aktives Konto.",
    allowlist_viewer_changed: "Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.",
    authentication_required: "Bitte melde dich an, um deine Spielerauswahl zu verwalten.",
  };
  return t(messages[error?.message] || "Die Spielerauswahl ist gerade nicht erreichbar. Bitte versuche es erneut.");
}

async function request(path = "", options = {}) {
  const response = await apiFetch(endpoint + path, { ...options, signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "allowlist_unavailable");
  return data;
}

async function searchPlayers(query, offset, signal) {
  const params = new URLSearchParams({ query, limit: String(SEARCH_PAGE + 1), offset: String(offset) });
  const timeout = AbortSignal.timeout(10000);
  const response = await apiFetch(`/api/players/search?${params}`, { signal: AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal });
  if (!response.ok) throw new Error("player_search_unavailable");
  const data = await response.json();
  return Array.isArray(data.players) ? data.players : [];
}

function mountController(mount, render, context, reset = () => {}) {
  if (!mount.isConnected) return;
  let data = null;
  let shownViewer = null;
  let epoch = 0;
  let busy = false;
  let retired = false;
  const connected = () => {
    if (!mount.isConnected && !retired) {
      retired = true; epoch += 1; data = null;
      reset();
      window.removeEventListener("zdwa:auth-state", onAuth);
    }
    return !retired;
  };
  const message = element("p", "", "player-allowlist-message");
  message.setAttribute("role", "status");
  const controls = element("div", "", "player-allowlist-controls");
  mount.classList.add("player-allowlist");
  mount.replaceChildren(controls, message);
  const clear = () => { shownViewer = null; reset(); controls.replaceChildren(); };
  const show = result => {
    const fresh = shownViewer !== result.viewer_id;
    shownViewer = result.viewer_id;
    data = result;
    render(controls, data, mutate, fresh);
  };
  // Write controls stay focusable while saving; aria-disabled blocks repeat
  // writes without dropping keyboard focus the way `disabled` would.
  const setWriting = flag => {
    mount.setAttribute("aria-busy", String(flag));
    controls.querySelectorAll("[data-allowlist-write]").forEach(node => node.setAttribute("aria-disabled", String(flag)));
  };

  async function refresh() {
    if (!connected()) return;
    const expectedEpoch = ++epoch;
    try {
      const result = await request();
      if (expectedEpoch !== epoch || !connected()) return;
      message.textContent = "";
      show(result);
    } catch (error) {
      if (expectedEpoch !== epoch || !connected()) return;
      data = null;
      mount.hidden = false;
      clear();
      message.textContent = errorText(error);
      if (error.message === "authentication_required") {
        const link = element("a", t("Anmelden"), navigationClass(context));
        link.href = context === "hausdepp"
          ? hausdeppSignInUrl(window.location.pathname + window.location.search)
          : context === "zilch" ? zilchPath(`/anmelden?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`)
          : zdwaPath("/#accountLogin");
        controls.append(link);
      } else {
        const retry = button(t("Erneut versuchen"));
        retry.addEventListener("click", refresh);
        controls.append(retry);
      }
    }
  }

  async function mutate(path, method, extra = {}, savedText = "Spielerauswahl gespeichert.") {
    if (!connected() || busy || !data) return false;
    busy = true;
    const expectedViewer = data.viewer_id;
    const expectedEpoch = ++epoch;
    setWriting(true);
    message.textContent = t("Spielerauswahl wird gespeichert …");
    try {
      const result = await request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viewer_id: expectedViewer, ...extra }) });
      if (epoch !== expectedEpoch || !connected()) return false;
      if (result.viewer_id !== expectedViewer) throw new Error("allowlist_viewer_changed");
      busy = false;
      setWriting(false);
      show(result);
      message.textContent = t(savedText);
      return true;
    } catch (error) {
      if (epoch === expectedEpoch && connected()) {
        busy = false;
        message.textContent = errorText(error);
        setWriting(false);
      }
      return false;
    } finally { busy = false; }
  }

  mutate.writing = () => busy;

  // An old profile/settings screen must never act on another account's list.
  function onAuth(event) {
    if (!connected()) return;
    const viewer = event.detail?.authenticated ? event.detail.user?.id : null;
    if (data?.viewer_id === viewer) return;
    data = null;
    mount.hidden = false;
    clear();
    void refresh();
  }
  window.addEventListener("zdwa:auth-state", onAuth);
  message.textContent = t("Spielerauswahl wird geladen …");
  void refresh();
}

export function mountProfileAllowlist(mount, { userId, context = "zdwa" }) {
  if (!mount || !Number.isInteger(Number(userId)) || Number(userId) <= 0) return;
  mountController(mount, (controls, data, mutate) => {
    controls.replaceChildren();
    mount.hidden = data.viewer_id === Number(userId);
    if (mount.hidden) return;
    const selected = data.players.some(player => player.id === Number(userId));
    const toggle = button(t(selected ? "Aus Spielerauswahl entfernen" : "Zur Spielerauswahl hinzufügen"));
    toggle.dataset.allowlistWrite = "";
    toggle.setAttribute("aria-pressed", String(selected));
    toggle.addEventListener("click", () => mutate(`/${Number(userId)}`, selected ? "DELETE" : "PUT"));
    const hint = element("p", t(data.audience === "allowlist"
      ? "Nur ausgewählte Spieler dürfen dich per Push einladen, wenn du Mitspieler-Einladungen aktiviert hast."
      : "Aktuell erlaubst du Einladungen von allen Spielern. Im Konto kannst du deine Auswahl als Filter aktivieren."), "player-allowlist-hint");
    const link = element("a", t("Spielerauswahl im Konto verwalten"), navigationClass(context));
    link.href = accountHref(context);
    controls.append(toggle, hint, link);
  }, context);
}

function audienceSection(id, mutate) {
  const form = element("form", "", "player-allowlist-audience");
  const fieldset = element("fieldset");
  fieldset.append(element("legend", t("Einladungen akzeptieren von")));
  const radios = {};
  for (const [value, title, detail] of [
    ["all", "Allen Spielern", "Jedes aktive Konto darf dich zu freien Plätzen rufen."],
    ["allowlist", "Nur Spielern aus deiner Liste", "Nur die Spieler aus deiner Liste unten dürfen dich rufen."],
  ]) {
    const label = element("label", "", "player-allowlist-choice");
    const input = element("input");
    input.type = "radio";
    input.name = `inviteAudience-${id}`;
    input.value = value;
    const text = element("span");
    text.append(element("strong", t(title)), element("small", t(detail)));
    label.append(input, text);
    fieldset.append(label);
    radios[value] = input;
  }
  const warning = element("p", t("Deine Liste ist leer: Mit diesem Filter erreicht dich gerade keine Mitspieler-Einladung."), "player-allowlist-warning");
  const pending = element("p", t("Noch nicht gespeichert."), "player-allowlist-hint");
  const save = button(t("Einladungsauswahl speichern"), "small primary", "submit");
  save.dataset.allowlistWrite = "";
  const hint = element("p", t("Der Filter aktiviert kein Push. Mitspieler-Rufe auf diesem Gerät schaltest du getrennt unter Push-Benachrichtigungen ein."), "player-allowlist-hint");
  form.append(fieldset, warning, pending, save, hint);
  let saved = "all";
  let draft = null;
  let count = 0;
  const selected = () => radios.allowlist.checked ? "allowlist" : "all";
  const sync = () => {
    warning.hidden = !(selected() === "allowlist" && count === 0);
    pending.hidden = draft === null || draft === saved;
  };
  fieldset.addEventListener("change", () => { draft = selected(); sync(); });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (save.getAttribute("aria-disabled") === "true") return;
    void mutate("", "PUT", { audience: selected() });
  });
  return {
    root: form,
    update(data) {
      saved = data.audience;
      count = data.players.length;
      // A pending radio choice survives list edits; a confirmed save clears it.
      if (draft === saved) draft = null;
      radios[draft || saved].checked = true;
      sync();
    },
  };
}

function searchSection(context, mutate) {
  const section = element("section", "", "player-allowlist-search");
  const heading = element("h4", t("Spieler hinzufügen"));
  const form = element("form", "", "player-allowlist-search-form");
  form.setAttribute("role", "search");
  const label = element("label", t("Spielername suchen"));
  const input = element("input");
  input.type = "search";
  input.name = "playerSearch";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 40;
  input.setAttribute("enterkeyhint", "search");
  label.append(input);
  const submit = button(t("Suchen"), "small ghost", "submit");
  form.append(label, submit);
  const status = element("p", "", "player-allowlist-hint");
  status.setAttribute("role", "status");
  const list = element("ul", "", "player-allowlist-list player-allowlist-results");
  const more = button(t("Weitere Treffer laden"));
  const retry = button(t("Suche erneut versuchen"));
  section.append(heading, form, status, list, more, retry);

  const rows = new Map();
  let data = null;
  // `query` is the text whose results are shown; the input may already differ.
  let query = "";
  let results = [];
  let hasMore = false;
  // Search phase is independent of list saves: a save must not end "loading" or hide a retry.
  let phase = "idle";
  let seq = 0;
  let controller = null;
  let timer = null;
  const idle = () => {
    status.textContent = t("Suche nach dem Benutzernamen eines aktiven Kontos und füge es direkt hinzu.");
  };
  const stop = () => {
    seq += 1; controller?.abort(); controller = null;
    if (timer) clearTimeout(timer);
    timer = null;
    list.removeAttribute("aria-busy");
  };

  function rowFor(player) {
    let entry = rows.get(player.id);
    if (entry) return entry;
    const row = element("li");
    row.dataset.playerId = String(player.id);
    const own = player.id === data.viewer_id;
    const action = own ? element("span", t("Dein Konto"), "player-allowlist-badge") : button("");
    if (!own) action.addEventListener("click", () => {
      if (action.dataset.allowlistWrite === undefined || action.getAttribute("aria-disabled") === "true") return;
      void mutate(`/${player.id}`, "PUT", {}, format("{name} ist jetzt in deiner Liste.", { name: player.username }));
    });
    row.append(playerName(player, context), action);
    entry = { row, action, player, own };
    rows.set(player.id, entry);
    return entry;
  }

  function paintRows() {
    const selected = new Set(data.players.map(player => player.id));
    const full = data.players.length >= data.limit;
    results.forEach((player, index) => {
      const { row, action, own } = rowFor(player);
      // Only insert out-of-place rows: moving a focused node would blur it.
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      if (own) return;
      const added = selected.has(player.id);
      action.textContent = t(added ? "Schon in deiner Liste" : "Hinzufügen");
      action.setAttribute("aria-label", format(added ? "{name} ist schon in deiner Liste" : "{name} zur Spielerauswahl hinzufügen", { name: player.username }));
      action.className = added ? "small ghost player-allowlist-added" : "small primary";
      if (added || full) {
        delete action.dataset.allowlistWrite;
        action.setAttribute("aria-disabled", "true");
      } else {
        action.dataset.allowlistWrite = "";
        action.setAttribute("aria-disabled", String(Boolean(mutate.writing?.())));
      }
    });
    while (list.children.length > results.length) list.lastElementChild.remove();
  }

  function paintStatus() {
    if (phase === "loading" || phase === "error") return;
    const full = data.players.length >= data.limit;
    more.hidden = !hasMore;
    if (!query) return idle();
    if (!results.length) status.textContent = format("Kein aktives Konto passt zu „{query}“.", { query });
    else status.textContent = format(hasMore ? "{count} Treffer angezeigt, weitere verfügbar." : "{count} Treffer.", { count: results.length })
      + (full ? ` ${t("Deine Liste ist voll. Entferne zuerst einen Spieler.")}` : "");
  }

  function paint() {
    if (!data) return;
    paintRows();
    paintStatus();
  }

  // `append` continues exactly the loaded query; a fresh search reads the input.
  async function run(append = false) {
    stop();
    const text = append ? query : input.value.trim();
    retry.hidden = true;
    if (!text) { query = ""; phase = "idle"; results = []; hasMore = false; rows.clear(); list.replaceChildren(); paint(); return; }
    const current = seq;
    const offset = append ? results.length : 0;
    controller = new AbortController();
    phase = "loading";
    status.textContent = t("Suche läuft …");
    more.setAttribute("aria-disabled", "true");
    list.setAttribute("aria-busy", "true");
    try {
      const page = await searchPlayers(text, offset, controller.signal);
      if (current !== seq) return;
      const known = new Set(append ? results.map(player => player.id) : []);
      const fresh = page.slice(0, SEARCH_PAGE).filter(player => Number.isInteger(player?.id) && typeof player.username === "string" && !known.has(player.id));
      // Hiding a focused "load more" drops focus to the body, so remember it first.
      const moreFocused = document.activeElement === more;
      if (!append) { rows.clear(); list.replaceChildren(); }
      query = text;
      results = append ? [...results, ...fresh] : fresh;
      hasMore = page.length > SEARCH_PAGE;
      phase = "done";
      paint();
      if (moreFocused && !hasMore) (fresh[0] ? rows.get(fresh[0].id)?.row.querySelector("a, button") : input)?.focus();
    } catch (error) {
      if (current !== seq || error?.name === "AbortError") return;
      phase = "error";
      status.textContent = t("Die Spielersuche ist gerade nicht erreichbar.");
      retry.hidden = false;
      retry.dataset.append = String(append);
    } finally {
      if (current === seq) { list.removeAttribute("aria-busy"); more.setAttribute("aria-disabled", "false"); controller = null; }
    }
  }

  input.addEventListener("input", () => {
    // Typing retires the shown generation at once: neither an in-flight page,
    // "load more" nor retry may mix the old query into the new search.
    stop();
    hasMore = false;
    phase = query ? "done" : "idle";
    retry.hidden = true;
    if (data) paintStatus();
    timer = setTimeout(() => { timer = null; void run(); }, SEARCH_DELAY);
  });
  form.addEventListener("submit", event => { event.preventDefault(); void run(); });
  more.addEventListener("click", () => { if (more.getAttribute("aria-disabled") !== "true") void run(true); });
  retry.addEventListener("click", () => { void run(retry.dataset.append === "true"); });
  more.hidden = true;
  retry.hidden = true;
  idle();
  return { root: section, update(next) { data = next; paint(); }, dispose: stop };
}

function membersSection(context, mutate) {
  const section = element("section", "", "player-allowlist-members");
  const heading = element("h4", t("Deine Liste"));
  heading.tabIndex = -1;
  const count = element("p", "", "player-allowlist-count");
  const full = element("p", t("Deine Liste ist voll. Entferne zuerst einen Spieler, um jemand Neues hinzuzufügen."), "player-allowlist-warning");
  const filterLabel = element("label", t("In deiner Liste filtern"), "player-allowlist-filter");
  const filter = element("input");
  filter.type = "search";
  filter.name = "allowlistFilter";
  filter.autocomplete = "off";
  filter.spellcheck = false;
  filterLabel.append(filter);
  const filterStatus = element("p", "", "player-allowlist-hint");
  filterStatus.setAttribute("role", "status");
  const list = element("ul", "", "player-allowlist-list player-allowlist-members-list");
  const empty = element("p", t("Deine Liste ist noch leer. Suche oben nach Spielern oder tippe in einem Spielerprofil auf „Zur Spielerauswahl hinzufügen“."), "player-allowlist-empty");
  const find = element("a", t("Spieler finden"), navigationClass(context));
  find.href = context === "zilch" ? zilchPath("/bestenlisten#player-search") : zdwaPath("/spieler#player-search");
  section.append(heading, count, full, filterLabel, filterStatus, list, empty, find);
  const rows = new Map();
  let players = [];

  function rowFor(player) {
    let entry = rows.get(player.id);
    if (!entry) {
      const row = element("li");
      row.dataset.playerId = String(player.id);
      const name = element("span", "", "player-allowlist-person");
      const remove = button(t("Entfernen"));
      remove.dataset.allowlistWrite = "";
      remove.addEventListener("click", () => {
        if (remove.getAttribute("aria-disabled") === "true") return;
        void mutate(`/${player.id}`, "DELETE", {}, format("{name} wurde aus deiner Liste entfernt.", { name: entry.player.username }));
      });
      row.append(name, remove);
      entry = { row, name, remove, key: "" };
      rows.set(player.id, entry);
    }
    entry.player = player;
    const key = `${player.username}\u0000${player.active}`;
    if (entry.key !== key) {
      entry.key = key;
      const parts = [playerName(player, context)];
      if (!player.active) parts.push(element("small", t("Konto deaktiviert"), "player-allowlist-badge"));
      entry.name.replaceChildren(...parts);
      entry.remove.setAttribute("aria-label", format("{name} aus Spielerauswahl entfernen", { name: player.username }));
    }
    return entry;
  }

  function applyFilter() {
    const needle = filter.value.trim().toLocaleLowerCase();
    let shown = 0;
    for (const player of players) {
      const visible = !needle || player.username.toLocaleLowerCase().includes(needle);
      rows.get(player.id).row.hidden = !visible;
      if (visible) shown += 1;
    }
    filterStatus.textContent = !needle ? ""
      : shown ? format("{shown} von {count} Spielern angezeigt.", { shown, count: players.length })
        : format("Niemand in deiner Liste passt zu „{query}“.", { query: filter.value.trim() });
  }

  filter.addEventListener("input", applyFilter);
  return {
    root: section,
    update(data) {
      const active = document.activeElement;
      const focusedIndex = players.findIndex(player => rows.get(player.id)?.row.contains?.(active));
      players = data.players;
      const keep = new Set(players.map(player => player.id));
      for (const [id, entry] of rows) if (!keep.has(id)) { entry.row.remove(); rows.delete(id); }
      players.forEach((player, index) => {
        const { row } = rowFor(player);
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      });
      count.textContent = format("{count} von {limit} Spielern in deiner Liste", { count: players.length, limit: data.limit });
      full.hidden = players.length < data.limit;
      filterLabel.hidden = !players.length;
      empty.hidden = Boolean(players.length);
      applyFilter();
      // A removed row took focus with it: continue at its neighbour instead of the page start.
      if (focusedIndex >= 0 && active && !active.isConnected) {
        const visible = players.map(player => rows.get(player.id)).filter(entry => !entry.row.hidden);
        const next = visible[Math.min(focusedIndex, visible.length - 1)];
        (next ? next.remove : players.length ? filter : heading).focus();
      }
    },
  };
}

export function mountAllowlistSettings(mount, { context = "zdwa" } = {}) {
  if (!mount) return;
  const id = ++mountCount;
  let view = null;
  mountController(mount, (controls, data, mutate, fresh) => {
    // Build once per viewer; later saves patch the existing nodes so search
    // text, filter, focus and scroll position survive every list change.
    if (fresh || !view) {
      view?.search.dispose();
      const intro = element("p", t("Deine private Liste gilt für alle unsere Spiele, ohne Freundschaftsanfrage. Niemand wird benachrichtigt, wenn du ihn hinzufügst. Startmeldungen und Push stellst du getrennt ein."), "player-allowlist-hint");
      view = { audience: audienceSection(id, mutate), search: searchSection(context, mutate), members: membersSection(context, mutate) };
      mount.classList.add("player-allowlist-settings");
      controls.replaceChildren(intro, view.audience.root, view.search.root, view.members.root);
    }
    view.audience.update(data);
    view.members.update(data);
    view.search.update(data);
  }, context, () => { view?.search.dispose(); view = null; });
}
