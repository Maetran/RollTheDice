// Watten presentation and the account-bound refresh lifecycle of Mission
// Control. The authorized analytics response is the only source of offered
// games; Watten values are server aggregates without any browser telemetry.

export const DASHBOARD_GAMES = Object.freeze(["zdwa", "zilch", "hausdepp", "watten"]);
const LEGACY_GAMES = Object.freeze(["zdwa", "zilch"]);
const GAME_NAMES = Object.freeze({ zdwa: "ZDWA", zilch: "Zilch", hausdepp: "Hausdepp", watten: "Watten" });
const WATTEN_SEATS = Object.freeze({ 2: "2 Plätze", duo: "2 Plätze", 3: "3 Plätze", trio: "3 Plätze", 4: "4 Plätze", four: "4 Plätze" });

export const dashboardGameName = game => GAME_NAMES[game] || null;

// Never derive a product from account flags, names, URLs or storage.
export function authorizedGames(available) {
  const games = Array.isArray(available) ? available : [];
  return DASHBOARD_GAMES.filter(game => games.includes(game));
}

export function gameSelection(available, selected) {
  const allowed = authorizedGames(available);
  return {
    allowed,
    value: allowed.includes(selected) ? selected : "all",
    allLabel: allowed.length > 2 ? "Alle Spiele" : "Beide Spiele",
    description: allowed.length > 2 ? "Dein Kontrollzentrum für alle Spiele." : "Dein Kontrollzentrum für ZDWA & Zilch.",
  };
}

export function visibleGames(data) {
  const allowed = authorizedGames(data?.available_games || LEGACY_GAMES);
  const filter = data?.period?.game || "all";
  return filter === "all" ? allowed : allowed.filter(game => game === filter);
}

// A filtered response must belong to the requested, still offered product.
export function scopeAuthorized(data, game) {
  if (game === "all") return true;
  if (data?.period?.game != null && data.period.game !== game) return false;
  return authorizedGames(data?.available_games || LEGACY_GAMES).includes(game);
}

export const trafficMeasured = data => data?.metric_coverage?.traffic !== "not_instrumented";

// Unknown stays unknown; only a reported number becomes a (non-negative) count.
export function measuredCount(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : null;
}

export function countText(value, number) {
  const amount = measuredCount(value);
  return amount === null ? "—" : number(amount);
}

export function overviewCoverage(data) {
  if (data?.period?.game === "hausdepp") return { unknown: true, hint: "Browserbesuche bisher nicht erfasst", completedLabel: "Runden beendet" };
  if (!trafficMeasured(data)) return { unknown: true, hint: data?.period?.game === "watten" ? "Für Watten nicht erfasst" : "Nicht erfasst", completedLabel: "Partien beendet" };
  return { unknown: false, hint: null, completedLabel: "Partien beendet" };
}

// Empty-state copy for browser panels that have no collector for this filter.
export function unmeasuredCopy(data) {
  if (trafficMeasured(data)) return null;
  return data?.period?.game === "watten"
    ? { title: "Für Watten nicht erfasst", description: "Für Watten werden keine Browserbesuche gemessen. Partien und Live-Tische stammen vom Server." }
    : { title: "Nicht erfasst", description: "Für diesen Filter werden keine Browserbesuche gemessen." };
}

// The globe reports mapped countries and sessions without a map point. Fed an
// empty list for a product without a collector it would show measured zeros,
// so the visualization and its accessible summary are replaced in place.
export function presentGeography(data, { viz, note, globe, t, e }) {
  const copy = unmeasuredCopy(data);
  viz.hidden = Boolean(copy);
  note.hidden = !copy;
  if (copy) {
    globe.clear();
    const description = data?.period?.game === "watten" ? "Herkunft wird für Watten nicht erfasst." : copy.description;
    note.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌁</span><strong>${e(t(copy.title))}</strong><p>${e(t(description))}</p></div>`;
    return false;
  }
  note.replaceChildren();
  globe.update(data?.geography || data?.countries || []);
  return true;
}

export function trafficSourceNote(data, { t }) {
  if ((data?.period?.game || "all") !== "all" || !Array.isArray(data?.metric_coverage?.traffic_games)) return "";
  const games = authorizedGames(data.available_games);
  const traffic = authorizedGames(data.metric_coverage.traffic_games).filter(game => games.includes(game));
  const unmeasured = games.filter(game => !traffic.includes(game));
  if (!unmeasured.length) return "";
  const names = list => list.map(dashboardGameName).join(" + ") || "—";
  return `${t("Besuchskennzahlen nur aus")}: ${names(traffic)}. ${t("Beendete Partien enthalten zusätzlich")}: ${names(unmeasured)}.`;
}

export const wattenModeLabel = mode => WATTEN_SEATS[String(mode)] || "Andere Platzzahl";

function unknownHtml({ t, e }) {
  return `—<small> / ${e(t("nicht erfasst"))}</small>`;
}

export function wattenDurationNote(row = {}, { t, number, duration }) {
  const known = measuredCount(row.duration_sample_count) ?? 0;
  const unknown = measuredCount(row.duration_unknown_count);
  const parts = [];
  if (known > 0 && row.avg_duration_seconds != null) parts.push(`${t("Ø Partiedauer aus belegten Starts")}: ${duration(row.avg_duration_seconds)} · ${t("Belegte Partien")}: ${number(known)}`);
  else if (measuredCount(row.completed_games)) parts.push(t("Keine Partie mit belegtem Start – Dauer unbekannt."));
  else parts.push(t("Keine beendete Partie im Zeitraum."));
  if (unknown) parts.push(`${t("Ohne belegten Start")}: ${number(unknown)}`);
  if (row.duration_sample_truncated === true) {
    parts.push(`${t("Begrenzte Stichprobe der neuesten Ergebnisse")}: ${number(measuredCount(row.duration_sample_limit) ?? 2000)}. ${t("Ältere Partien sind darin nicht enthalten.")}`);
  }
  return parts.join(" · ");
}

export function wattenGameCard(row = {}, fmt) {
  const { t, e, number, duration } = fmt;
  const live = row.live && typeof row.live === "object" ? row.live : {};
  const value = raw => { const amount = measuredCount(raw); return amount === null ? unknownHtml(fmt) : e(number(amount)); };
  const details = [
    ["Teilnahmen (Plätze inkl. Computer)", value(row.participants)],
    ["Ø Partiedauer", row.avg_duration_seconds == null ? unknownHtml(fmt) : e(duration(row.avg_duration_seconds))],
    ["Dauer belegt", value(row.duration_sample_count)],
    ["Dauer unbekannt", value(row.duration_unknown_count)],
    ["Tische live", value(live.active_tables)],
    ["Davon laufend", value(live.playing_tables)],
    ["Davon wartend", value(live.waiting_tables)],
    ["Davon pausiert", value(live.paused_tables)],
    ["Menschen verbunden", value(live.connected_humans)],
    ["Computerplätze", value(live.cpu_seats)],
    ["Erfasste Abbrüche", value(row.abandoned_games)],
  ];
  return `<div class="game-card" data-game="watten"><div class="game-card-header"><strong>${e(GAME_NAMES.watten)}</strong><span aria-hidden="true">W</span></div><div class="game-card-number">${value(row.completed_games)}</div><p class="game-card-caption">${e(t("Partien beendet"))}</p><div class="game-card-details">${details.map(([label, html]) => `<span>${e(t(label))}<strong>${html}</strong></span>`).join("")}</div><p class="game-card-caption" data-watten-duration>${e(wattenDurationNote(row, fmt))}</p></div>`;
}

export function wattenMonitoringNote(data, fmt) {
  if (!visibleGames(data).includes("watten")) return "";
  const { t } = fmt;
  const row = (Array.isArray(data?.games) ? data.games : []).find(item => item?.game === "watten") || {};
  const parts = [
    t("Watten: Partien, Teilnahmen und Live-Tische werden serverseitig gezählt. Browserbesuche, Seitenwege, Herkunft, Designs und PWA-Starts werden für Watten nicht erfasst."),
    t("Teilnahmen sind gespeicherte Plätze je Partie einschließlich Computer, keine eindeutigen Personen. Menschen verbunden zählt angemeldete Konten ohne Doppelzählung; pausierte Tische sind in den Live-Tischen enthalten. Abbrüche werden nicht erfasst."),
    t("Die Dauer stammt nur aus geprüften, eingefrorenen Partiebelegen; Partien ohne belegten Start bleiben unbekannt."),
  ];
  if (row.live?.active_tables === null) parts.push(t("Live-Quelle derzeit nicht lesbar; Watten-Livewerte bleiben unbekannt."));
  const sources = trafficSourceNote(data, fmt);
  if (sources) parts.push(sources);
  parts.push(t("HTTP-Anfragen und Serverressourcen gelten für die ganze Website; aktive Räume und verbundene Spieler folgen dem Spielfilter. CPU-Auslastung ist Hardwarelast, Computerplätze sind besetzte Spielplätze."));
  return parts.join(" ");
}

// One refresh pipeline bound to the account confirmed by a fresh /me read.
// Account changes, revocation and pagehide clear private output synchronously
// and invalidate every pending response before it can be installed.
export function createDashboardLifecycle({ win, doc, loadAuth, authInFlight = () => null, fetch: request,
  now = () => Date.now(), refreshMs = 30000, timeoutMs = 15000, hooks }) {
  let epoch = 0;
  let generation = 0;
  let viewer = null;
  let ready = false;
  let disposed = false;
  let active = null;
  let activeTimeout = null;
  let timer = null;
  let latest = false;
  let lastFetched = 0;

  function abortActive() {
    generation += 1;
    active?.abort();
    active = null;
    if (activeTimeout !== null) win.clearTimeout(activeTimeout);
    activeTimeout = null;
  }

  function invalidate() {
    epoch += 1;
    ready = false;
    viewer = null;
    latest = false;
    lastFetched = 0;
    abortActive();
    hooks.busy(false);
    hooks.clear();
  }

  function deny(status) {
    invalidate();
    hooks.denied(status);
  }

  // loadAuth shares an in-flight /me read. One that was already running may
  // predate the change this check must observe, so let it finish first.
  async function freshAuth(isCurrent) {
    const shared = authInFlight();
    if (shared) {
      try { await shared; } catch { /* The fresh read below reports failures. */ }
      if (!isCurrent()) return null;
    }
    return loadAuth({ refresh: true });
  }

  async function initialize() {
    if (disposed) return;
    abortActive();
    ready = false;
    viewer = null;
    const ownEpoch = ++epoch;
    hooks.retry(false);
    try {
      const auth = await freshAuth(() => !disposed && ownEpoch === epoch);
      if (disposed || ownEpoch !== epoch) return;
      if (!auth?.authenticated || auth.user?.id == null) { deny(401); return; }
      if (!hooks.canMonitor(auth.user)) { deny(403); return; }
      viewer = auth.user.id;
      ready = true;
      hooks.bound(auth.user);
      await refresh();
    } catch {
      if (disposed || ownEpoch !== epoch) return;
      hooks.failed({ retained: false });
    } finally {
      if (!disposed) hooks.retry(true);
    }
  }

  async function refresh() {
    if (!ready || disposed) return;
    abortActive();
    const own = generation;
    const ownEpoch = epoch;
    const ownViewer = viewer;
    const controller = new AbortController();
    active = controller;
    activeTimeout = win.setTimeout(() => controller.abort(), timeoutMs);
    const current = () => !disposed && own === generation && ownEpoch === epoch && viewer === ownViewer;
    const filters = hooks.filters();
    let unavailable = false;
    hooks.busy(true, { connecting: !latest });
    try {
      let data = null;
      let failure = false;
      try {
        const response = await request(`/api/admin/analytics?${new URLSearchParams(filters)}`, {
          cache: "no-store", signal: controller.signal,
          headers: { "X-Analytics-Expected-Account-Id": String(ownViewer) },
        });
        if (!current()) return;
        if (response.status === 401) { deny(401); return; }
        if (response.status === 403) {
          // A removed product falls back to all games; a general 403 ends access.
          if (filters.game !== "all") unavailable = true; else deny(403);
          return;
        }
        if (response.status === 409) {
          const problem = await response.json();
          if (!current()) return;
          if (problem?.detail === "analytics_account_changed") { invalidate(); void initialize(); return; }
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      } catch {
        failure = true;
      }
      if (!current()) return;
      // The response carries no viewer and the cookie may have changed in
      // another tab without a local auth event. Neither installing it nor
      // keeping earlier values after a failure is allowed until a fresh /me
      // read confirms the bound account and its monitoring capability.
      let auth;
      try {
        auth = await freshAuth(current);
      } catch {
        if (!current()) return;
        invalidate();
        hooks.failed({ retained: false });
        return;
      }
      if (!current()) return;
      if (!auth?.authenticated || auth.user?.id == null) { deny(401); return; }
      if (auth.user.id !== ownViewer) { invalidate(); void initialize(); return; }
      if (!hooks.canMonitor(auth.user)) { deny(403); return; }
      if (failure) { hooks.failed({ retained: latest }); return; }
      if (!scopeAuthorized(data, filters.game)) { unavailable = true; return; }
      latest = true;
      lastFetched = now();
      hooks.render(data);
    } finally {
      if (own === generation) {
        win.clearTimeout(activeTimeout);
        activeTimeout = null;
        active = null;
        hooks.busy(false);
        if (unavailable && current()) {
          latest = false;
          hooks.unavailable();
          void refresh();
        }
      }
    }
  }

  function start() {
    if (timer !== null) return;
    timer = win.setInterval(() => { if (!doc.hidden) void refresh(); }, refreshMs);
  }

  function dispose() {
    disposed = true;
    invalidate();
    win.clearInterval(timer);
    timer = null;
  }

  win.addEventListener("pagehide", dispose);
  win.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    disposed = false;
    start();
    void initialize();
  });
  win.addEventListener("zdwa:auth-state", event => {
    if (viewer === null || disposed) return;
    const detail = event.detail;
    if (detail?.authenticated && detail.user?.id === viewer && hooks.canMonitor(detail.user)) return;
    invalidate();
    void initialize();
  });
  doc.addEventListener("visibilitychange", () => {
    if (!doc.hidden && now() - lastFetched >= refreshMs) void refresh();
  });

  return {
    initialize, refresh, start,
    retry: () => ready ? refresh() : initialize(),
    get ready() { return ready; },
    get disposed() { return disposed; },
  };
}
