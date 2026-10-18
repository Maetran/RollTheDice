import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Real ESM sources, loaded without a bundler. catalog.js and analysis.js have
// no imports; watten.js is self-contained.
const load = async path => import(`data:text/javascript;base64,${Buffer.from(
  await readFile(new URL(path, import.meta.url), "utf8")).toString("base64")}`);
const { EN } = await load("../frontend/i18n/catalog.js");
const watten = await load("../frontend/dashboard/watten.js");
const { createAnalysisVisuals } = await load("../frontend/dashboard/analysis.js");

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition, message = "condition not reached") {
  for (let index = 0; index < 40 && !condition(); index += 1) await tick();
  assert.ok(condition(), message);
}
const settle = async () => { for (let index = 0; index < 6; index += 1) await tick(); };
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, letter => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[letter]);
const LOCALES = { de: "de-CH", en: "en-GB" };
function fmt(language) {
  const t = language === "en" ? key => EN[key] ?? `MISSING:${key}` : key => key;
  const number = value => value == null ? "—" : new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const duration = seconds => seconds == null ? "—" : `${Math.round(Number(seconds))} s`;
  return { t, e: escapeHtml, number, duration, percent: value => String(value), locale: () => LOCALES[language] };
}
const ALL = ["zdwa", "zilch", "hausdepp", "watten"];

function native(overrides = {}) {
  return {
    generated_at: "2026-10-18T12:00:00Z", available_games: ALL,
    period: { game: "watten", days: 7, from: "2026-10-12T00:00:00Z", to: "2026-10-18T12:00:00Z", timezone: "UTC" },
    metric_coverage: { traffic: "not_instrumented", traffic_games: [], native_live_humans: "distinct_authenticated_accounts",
      request_traffic: "sitewide", duration: "validated_frozen_public_evidence" },
    overview: { completed_games: 2, sessions: null, page_views: null, active_seconds: null, avg_active_seconds: null, game_clicks: null, live_sessions: null },
    games: [{ game: "watten", completed_games: 2, participants: 4, participants_scope: "recorded_seats_including_cpus",
      avg_duration_seconds: 125, duration_sample_count: 1, duration_sample_limit: 2000, duration_unknown_count: 1,
      duration_sample_truncated: false, abandoned_games: null, abandonments_source: "unavailable", completed_tournaments: null,
      live: { active_tables: 2, playing_tables: 1, waiting_tables: 0, paused_tables: 1, connected_humans: 2, cpu_seats: 3,
        active_tournaments: null, interround_tables: null } }],
    modes: [{ game: "watten", mode: "four", hardcore: false, completed_games: 2 }],
    daily: Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-1${index + 2}`, sessions: null, page_views: null, active_seconds: null, completed_games: index === 6 ? 2 : 0 })),
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, page_views: null, active_seconds: null })),
    heatmap: Array.from({ length: 168 }, (_, index) => ({ weekday: Math.floor(index / 24), hour: index % 24, sessions: null, page_views: null, active_seconds: null })),
    geography_summary: { sessions: null, known_sessions: null, unknown_sessions: null, known_countries: null },
    pages: [], actions: [], geography: [],
    journeys: { links: [], sample: { page_views: null, matching_page_views: null, total_page_views: null, truncated: null, method: "not_instrumented", from: null, to: null } },
    pwa: { confirmed_installations: null, first_detected_starts: null },
    comparison: { previous_data_coverage: "not_instrumented", coverage_basis: "not_instrumented", traffic_retained_from: null,
      overview: { sessions: { current: null, previous: null, delta: null, change_percent: null },
        completed_games: { current: 2, previous: 1, delta: 1, change_percent: 100 } } },
    server: { active_rooms: 2, players_online: 2, cpu: { percent: 12 }, measurement_at: "2026-10-18T12:00:00Z" },
    ...overrides,
  };
}

// Representative measured legacy telemetry including a genuine measured zero.
function legacy(game = "all", overrides = {}) {
  return {
    generated_at: "2026-10-18T12:00:00Z", available_games: ["zdwa", "zilch", "hausdepp"], period: { game, days: 7 },
    metric_coverage: { traffic: "observed_events_only", traffic_games: ["zdwa", "zilch", "hausdepp"], request_traffic: "sitewide", duration: "available_server_samples" },
    overview: { completed_games: 5, sessions: 4, page_views: 9, active_seconds: 60, avg_active_seconds: 15, live_sessions: 0 },
    daily: [{ date: "2026-10-17", sessions: 1, page_views: 2, active_seconds: 10, completed_games: 1 }, { date: "2026-10-18", sessions: 3, page_views: 7, active_seconds: 50, completed_games: 4 }],
    heatmap: [{ weekday: 0, hour: 18, sessions: 0, page_views: 0, active_seconds: 0 }, { weekday: 2, hour: 9, sessions: 2, page_views: 5, active_seconds: 40 }],
    pages: [], journeys: { links: [], sample: { page_views: 5, total_page_views: 9, truncated: true } },
    pwa: { confirmed_installations: 0, first_detected_starts: 0 },
    games: [{ game: "hausdepp", completed_games: 2, live: { active_tournaments: 1, interround_tables: 0 } }],
    server: { active_rooms: 1, players_online: 0, measurement_at: "2026-10-18T12:00:00Z" },
    ...overrides,
  };
}

class FakeElement extends EventTarget {
  innerHTML = ""; textContent = ""; hidden = false; disabled = false; value = ""; max = 0; clientWidth = 0; clientHeight = 0;
  dataset = {}; style = { setProperty() {} }; classList = { add() {}, remove() {}, toggle() {} };
  constructor(children = []) { super(); this.children = children; }
  querySelector() { return null; }
  querySelectorAll() { return this.children; }
  setAttribute(name, value) { this[name] = value; }
  replaceChildren() { this.innerHTML = ""; this.textContent = ""; }
}

function dashboardDom(design = "mission") {
  const toggles = ["sessions", "page_views"].map(series => Object.assign(new FakeElement(), { dataset: { series } }));
  const elements = new Map([["trafficSeries", new FakeElement(toggles)]]);
  globalThis.document = Object.assign(new EventTarget(), { hidden: false, documentElement: { dataset: {} },
    body: { dataset: { dashboardDesign: design } }, querySelectorAll: () => [],
    getElementById: id => { if (!elements.has(id)) elements.set(id, new FakeElement()); return elements.get(id); } });
  globalThis.window = Object.assign(new EventTarget(), { requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  return { $: id => globalThis.document.getElementById(id), toggles };
}

function analysisFor(language, design) {
  const dom = dashboardDom(design);
  const f = fmt(language);
  const analysis = createAnalysisVisuals({ ...f, gameName: game => watten.dashboardGameName(game) || "—", pageLabel: page => page,
    measured: watten.trafficMeasured, unmeasuredCopy: watten.unmeasuredCopy });
  return { ...dom, analysis, f };
}

test("only the authorized available_games list offers Watten; forged founder or game_access flags never do", () => {
  const offered = watten.gameSelection(ALL, "watten");
  assert.deepEqual(offered, { allowed: ALL, value: "watten", allLabel: "Alle Spiele", description: "Dein Kontrollzentrum für alle Spiele." });
  assert.deepEqual(watten.visibleGames(native()), ["watten"]);
  assert.deepEqual(watten.visibleGames(native({ period: { game: "all" } })), ALL);
  assert.equal(watten.dashboardGameName("watten"), "Watten");

  const forged = native({ available_games: ["zdwa", "zilch"], is_founder: true, game_access: { watten: true },
    user: { is_founder: true, is_admin: true, username: "Watten" } });
  assert.deepEqual(watten.gameSelection(forged.available_games, "watten"),
    { allowed: ["zdwa", "zilch"], value: "all", allLabel: "Beide Spiele", description: "Dein Kontrollzentrum für ZDWA & Zilch." });
  assert.deepEqual(watten.visibleGames({ ...forged, period: { game: "all" } }), ["zdwa", "zilch"]);
  assert.deepEqual(watten.visibleGames(forged), [], "a stale Watten filter shows no Watten card");
  assert.equal(watten.scopeAuthorized(forged, "watten"), false);
  assert.equal(watten.scopeAuthorized(native({ period: { game: "zdwa" } }), "watten"), false, "response for another scope");
  assert.equal(watten.wattenMonitoringNote({ ...forged, period: { game: "all" } }, fmt("de")), "");
  assert.deepEqual(watten.authorizedGames(["watten", "WATTEN", "bingo", "zdwa"]), ["zdwa", "watten"]);
  assert.deepEqual(watten.authorizedGames("watten"), []);
  assert.deepEqual(watten.authorizedGames(undefined), []);
});

class FakeDocument extends EventTarget { hidden = false; }
function makeWindow() {
  const win = new EventTarget();
  let sequence = 0;
  win.timers = new Map();
  win.setTimeout = (fn, ms) => { sequence += 1; win.timers.set(sequence, { fn, ms, kind: "timeout" }); return sequence; };
  win.setInterval = (fn, ms) => { sequence += 1; win.timers.set(sequence, { fn, ms, kind: "interval" }); return sequence; };
  win.clearTimeout = id => { if (win.timers.get(id)?.kind === "timeout") win.timers.delete(id); };
  win.clearInterval = id => { if (win.timers.get(id)?.kind === "interval") win.timers.delete(id); };
  win.of = kind => [...win.timers.values()].filter(timer => timer.kind === kind);
  return win;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const account = (id, monitoring = true) => ({ authenticated: true, user: { id, can_view_analytics: monitoring } });
const pageEvent = (type, persisted) => Object.assign(new Event(type), { persisted });

// The real lifecycle with a recorded view: render installs private data,
// clear/unavailable remove it, exactly as the dashboard hooks do. `cookie` is
// the account the server would report for a new /me read; with `hold` set,
// each read stays pending until the test resolves it.
function harness() {
  const win = makeWindow();
  const doc = new FakeDocument();
  const loads = [];
  const requests = [];
  const state = { filters: { days: "7", game: "all" }, view: null, rendered: [], failed: [], denied: [], bound: [],
    busy: [], cleared: 0, unavailable: 0, inflight: null, writes: 0, cookie: account(7), hold: false };
  const lifecycle = watten.createDashboardLifecycle({
    win, doc, now: () => 1_000_000,
    loadAuth: options => {
      assert.equal(options.refresh, true);
      const next = deferred();
      loads.push(next);
      if (!state.hold) next.resolve(state.cookie);
      return next.promise;
    },
    authInFlight: () => state.inflight,
    fetch: (url, init) => { const next = deferred(); requests.push({ url, init, ...next }); return next.promise; },
    hooks: {
      filters: () => ({ ...state.filters }),
      canMonitor: user => Boolean(user?.can_view_analytics),
      bound: user => { state.writes += 1; state.bound.push(user.id); },
      busy: active => { state.writes += 1; state.busy.push(active); },
      render: data => { state.writes += 1; state.view = data; state.rendered.push(data); },
      failed: value => { state.writes += 1; state.failed.push(value); },
      denied: status => { state.writes += 1; state.denied.push(status); },
      clear: () => { state.writes += 1; state.cleared += 1; state.view = null; },
      unavailable: () => { state.writes += 1; state.unavailable += 1; state.view = null; state.filters.game = "all"; },
      retry: () => {},
    },
  });
  return { win, doc, loads, requests, state, lifecycle };
}
async function connected(h, data = native({ period: { game: "all" } })) {
  h.lifecycle.start();
  void h.lifecycle.initialize();
  await until(() => h.requests.length === 1, "analytics request missing");
  assert.equal(h.loads.length, 1, "fresh /me read before the request");
  h.requests[0].resolve(reply(200, data));
  await until(() => h.state.rendered.length === 1, "first render missing");
  assert.equal(h.loads.length, 2, "the body is confirmed by its own /me read");
}

test("a removed Watten audience falls back to all games and clears the private Watten view first", async () => {
  const h = harness();
  await connected(h);
  assert.match(h.requests[0].url, /^\/api\/admin\/analytics\?days=7&game=all$/);
  assert.equal(h.requests[0].init.cache, "no-store");
  h.state.filters.game = "watten";
  void h.lifecycle.refresh();
  h.requests[1].resolve(reply(200, native()));
  await until(() => h.state.rendered.length === 2);
  assert.equal(h.state.view.period.game, "watten");

  void h.lifecycle.refresh();
  h.requests[2].resolve(reply(403, { detail: "analytics_game_unavailable" }));
  await until(() => h.requests.length === 4, "fallback request missing");
  assert.equal(h.state.view, null, "no previous private Watten data stays visible");
  assert.equal(h.state.unavailable, 1);
  assert.deepEqual(h.state.denied, []);
  assert.match(h.requests[3].url, /game=all$/);
  const reduced = legacy("all", { available_games: ["zdwa", "zilch"] });
  h.requests[3].resolve(reply(200, reduced));
  await until(() => h.state.rendered.length === 3);
  assert.deepEqual(watten.visibleGames(h.state.view), ["zdwa", "zilch"]);
  assert.equal(watten.wattenMonitoringNote(h.state.view, fmt("de")), "", "the Watten note is emptied");
  assert.equal(watten.gameSelection(h.state.view.available_games, "watten").value, "all");

  // A successful but out-of-scope Watten answer is never installed either.
  h.state.filters.game = "watten";
  void h.lifecycle.refresh();
  h.requests[4].resolve(reply(200, native({ available_games: ["zdwa", "zilch"] })));
  await until(() => h.requests.length === 6);
  assert.equal(h.state.rendered.length, 3);
  assert.equal(h.state.unavailable, 2);
  assert.equal(h.state.view, null);

  // A 403 for all games ends access instead of looping.
  h.requests[5].resolve(reply(403, { detail: "Forbidden" }));
  await until(() => h.state.denied.length === 1);
  assert.deepEqual(h.state.denied, [403]);
  assert.equal(h.requests.length, 6);
  assert.equal(h.lifecycle.ready, false);
});

for (const language of ["de", "en"]) {
  test(`${language}: native Watten nulls render as unknown, measured zeros stay zero`, () => {
    const f = fmt(language);
    const data = native();
    const unknown = language === "en" ? "Not measured for Watten" : "Für Watten nicht erfasst";
    const coverage = watten.overviewCoverage(data);
    assert.equal(coverage.unknown, true);
    assert.equal(f.t(coverage.hint), unknown);
    assert.equal(f.t(coverage.completedLabel), language === "en" ? "Games completed" : "Partien beendet");
    assert.equal(watten.trafficMeasured(data), false);
    assert.equal(watten.countText(data.pwa.confirmed_installations, f.number), "—");
    assert.equal(watten.countText(data.pwa.first_detected_starts, f.number), "—");
    assert.equal(watten.countText(0, f.number), "0");
    assert.equal(watten.countText("bad", f.number), "—");
    assert.equal(f.t(watten.unmeasuredCopy(data).title), unknown);

    const card = watten.wattenGameCard(data.games[0], f);
    const cell = label => card.match(new RegExp(`<span>${f.t(label).replace(/[.()]/g, "\\$&")}<strong>(.*?)</strong></span>`))?.[1];
    assert.equal(cell("Erfasste Abbrüche"), `—<small> / ${f.t("nicht erfasst")}</small>`);
    assert.equal(cell("Davon wartend"), "0", "a measured zero stays zero");
    assert.equal(cell("Menschen verbunden"), "2");
    assert.equal(cell("Computerplätze"), "3");
    assert.equal(cell("Davon pausiert"), "1");
    assert.match(card, /class="game-card-number">2</);
    assert.ok(!card.includes("MISSING:"), card);
    const offline = watten.wattenGameCard({ ...data.games[0], live: Object.fromEntries(Object.keys(data.games[0].live).map(key => [key, null])) }, f);
    assert.equal((offline.match(new RegExp(f.t("nicht erfasst"), "g")) || []).length, 7, "all native live values unknown");
    const note = watten.wattenMonitoringNote(native({ games: [{ ...data.games[0], live: { active_tables: null } }] }), f);
    assert.ok(note.includes(f.t("Live-Quelle derzeit nicht lesbar; Watten-Livewerte bleiben unbekannt.")));
    assert.ok(!note.includes("MISSING:"), note);

    const { $, toggles, analysis } = analysisFor(language, "mission");
    analysis.update(data);
    for (const id of ["activityHeatmap", "dailyChart", "pageBubbles", "journeyFlow"]) {
      assert.ok($(id).innerHTML.includes(escapeHtml(unknown)), id);
      assert.ok(!$(id).innerHTML.includes("<rect") && !$(id).innerHTML.includes("<svg"), `${id} draws no measurement`);
    }
    assert.equal($("heatmapSelection").innerHTML, "");
    assert.equal($("heatmapEmpty").hidden, true);
    assert.equal($("trafficControls").hidden, true);
    assert.equal($("dailySelection").innerHTML, "");
    for (const id of ["heatmapMetric", "heatmapDay", "heatmapHour"]) assert.equal($(id).disabled, true, id);
    assert.ok(toggles.every(toggle => toggle.disabled));
    assert.equal($("journeySample").textContent, f.t("Seitenwege werden für Watten nicht erfasst."));
    assert.ok(!$("journeySample").textContent.includes("—"));

    // The same instance returns to interactive measured views for legacy data.
    analysis.update(legacy("zdwa"));
    assert.equal(($("activityHeatmap").innerHTML.match(/<rect /g) || []).length, 168);
    assert.match($("heatmapSelection").innerHTML, /<b>0<\/b>/, "a measured empty cell reads as zero");
    for (const id of ["heatmapMetric", "heatmapDay", "heatmapHour"]) assert.equal($(id).disabled, false, id);
    assert.ok(toggles.every(toggle => !toggle.disabled));
    assert.equal($("trafficControls").hidden, false);
  });

  test(`${language}: the all-games filter counts Watten results but claims no Watten browser traffic`, () => {
    const f = fmt(language);
    const all = native({ period: { game: "all", days: 7 },
      metric_coverage: { traffic: "observed_events_only", traffic_games: ["zdwa", "zilch", "hausdepp"], request_traffic: "sitewide" },
      overview: { completed_games: 9, sessions: 4, page_views: 9, active_seconds: 60, avg_active_seconds: 15, live_sessions: 0 } });
    assert.equal(watten.trafficMeasured(all), true);
    assert.equal(watten.overviewCoverage(all).unknown, false, "the three measured products keep their visit metrics");
    const sources = watten.trafficSourceNote(all, f);
    assert.equal(sources, language === "en"
      ? "Visit metrics only from: ZDWA + Zilch + Hausdepp. Completed games also include: Watten."
      : "Besuchskennzahlen nur aus: ZDWA + Zilch + Hausdepp. Beendete Partien enthalten zusätzlich: Watten.");
    const note = watten.wattenMonitoringNote(all, f);
    assert.ok(note.includes(sources));
    assert.ok(note.includes(language === "en" ? "cover the whole website" : "gelten für die ganze Website"), "HTTP stays sitewide");
    assert.ok(note.includes(language === "en" ? "computer seats are occupied game seats" : "Computerplätze sind besetzte Spielplätze"));
    assert.ok(!note.includes("MISSING:"), note);
    assert.equal(watten.trafficSourceNote(native(), f), "", "a single-product filter needs no mixed-source note");
  });
}

test("duration statements distinguish recorded, purely unknown and truncated samples without private fields", () => {
  const f = fmt("de");
  const base = { completed_games: 2, duration_sample_limit: 2000, duration_sample_truncated: false,
    game_id: "game-private-4242", account_id: "acct-private-7731", result_json: '{"hand":"PRIVATE_HAND"}',
    players: [{ username: "PrivateAnna" }], calls: ["PRIVATE_CALL"] };
  const known = watten.wattenDurationNote({ ...base, avg_duration_seconds: 125, duration_sample_count: 1, duration_unknown_count: 1 }, f);
  const unknown = watten.wattenDurationNote({ ...base, completed_games: 1, avg_duration_seconds: null, duration_sample_count: 0, duration_unknown_count: 1 }, f);
  const truncated = watten.wattenDurationNote({ ...base, completed_games: 2500, avg_duration_seconds: 300, duration_sample_count: 1990,
    duration_unknown_count: 10, duration_sample_truncated: true }, f);
  const none = watten.wattenDurationNote({ ...base, completed_games: 0, avg_duration_seconds: null, duration_sample_count: 0, duration_unknown_count: 0 }, f);
  assert.equal(known, "Ø Partiedauer aus belegten Starts: 125 s · Belegte Partien: 1 · Ohne belegten Start: 1");
  assert.equal(unknown, "Keine Partie mit belegtem Start – Dauer unbekannt. · Ohne belegten Start: 1");
  assert.equal(truncated, `Ø Partiedauer aus belegten Starts: 300 s · Belegte Partien: ${f.number(1990)} · Ohne belegten Start: 10 · Begrenzte Stichprobe der neuesten Ergebnisse: ${f.number(2000)}. Ältere Partien sind darin nicht enthalten.`);
  assert.equal(none, "Keine beendete Partie im Zeitraum.");
  assert.equal(new Set([known, unknown, truncated, none]).size, 4);
  assert.ok(!known.includes("Stichprobe") && !unknown.includes("125"));

  const en = fmt("en");
  assert.equal(watten.wattenDurationNote({ ...base, completed_games: 1, avg_duration_seconds: null, duration_sample_count: 0, duration_unknown_count: 1 }, en),
    "No game with a recorded start – duration unknown. · Without a recorded start: 1");
  for (const language of ["de", "en"]) {
    const card = watten.wattenGameCard({ ...base, avg_duration_seconds: null, duration_sample_count: 0, duration_unknown_count: 2 }, fmt(language));
    for (const secret of ["game-private-4242", "acct-private-7731", "PRIVATE", "PrivateAnna"]) assert.ok(!card.includes(secret), secret);
    assert.match(card, /data-watten-duration/);
  }
});

test("account change and pagehide invalidate pending auth and analytics before anything is installed", async () => {
  // Pending /me, then pagehide: no request, no timer, no write afterwards.
  const early = harness();
  early.state.hold = true;
  early.lifecycle.start();
  void early.lifecycle.initialize();
  await until(() => early.loads.length === 1);
  early.win.dispatchEvent(pageEvent("pagehide", true));
  const writes = early.state.writes;
  early.loads[0].resolve(account(7));
  await settle();
  assert.equal(early.requests.length, 0);
  assert.equal(early.win.timers.size, 0);
  assert.equal(early.state.writes, writes);
  // A restored document needs a new fresh read before any display.
  early.win.dispatchEvent(pageEvent("pageshow", true));
  await until(() => early.loads.length === 2);
  assert.equal(early.requests.length, 0);
  early.loads[1].resolve(account(7));
  await until(() => early.requests.length === 1);
  early.state.hold = false;
  early.requests[0].resolve(reply(200, native()));
  await until(() => early.state.rendered.length === 1);
  assert.equal(early.win.of("interval").length, 1);

  // Pending analytics for A, then the shared auth state reports B.
  const switched = harness();
  switched.state.hold = true;
  switched.lifecycle.start();
  void switched.lifecycle.initialize();
  await until(() => switched.loads.length === 1);
  switched.loads[0].resolve(account(7));
  await until(() => switched.requests.length === 1);
  assert.equal(switched.win.of("timeout").length, 1);
  switched.state.cookie = account(8);
  switched.win.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: switched.state.cookie }));
  assert.equal(switched.state.cleared, 1, "private output is removed synchronously");
  assert.equal(switched.requests[0].init.signal.aborted, true);
  assert.equal(switched.win.of("timeout").length, 0, "no orphaned request timeout");
  await until(() => switched.loads.length === 2, "B needs its own fresh /me read");
  switched.requests[0].resolve(reply(200, native()));
  await settle();
  assert.equal(switched.state.rendered.length, 0, "late A is never installed");
  switched.loads[1].resolve(account(8));
  await until(() => switched.requests.length === 2);
  switched.state.hold = false;
  const forB = native({ generated_at: "2026-10-18T12:01:00Z" });
  switched.requests[1].resolve(reply(200, forB));
  await until(() => switched.state.rendered.length === 1);
  assert.equal(switched.state.view, forB);
  assert.deepEqual(switched.state.bound, [7, 8]);

  // An already running /me read from before the change is not a confirmation.
  const shared = harness();
  shared.state.hold = true;
  const old = deferred();
  shared.state.inflight = old.promise;
  void shared.lifecycle.initialize();
  await settle();
  assert.equal(shared.loads.length, 0, "waits for the shared read before its own");
  shared.state.inflight = null;
  old.resolve(account(7));
  await until(() => shared.loads.length === 1);
  assert.equal(shared.requests.length, 0);
  shared.loads[0].resolve(account(8));
  await until(() => shared.requests.length === 1);
  assert.deepEqual(shared.state.bound, [8]);

  // Revoked monitoring for the same account also clears and rechecks.
  const revoked = harness();
  await connected(revoked);
  revoked.state.cookie = account(7, false);
  revoked.win.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: revoked.state.cookie }));
  assert.equal(revoked.state.view, null);
  await until(() => revoked.loads.length === 3);
  await until(() => revoked.state.denied.length === 1);
  assert.deepEqual(revoked.state.denied, [403]);
  // The same account confirmed again is not an account change.
  const same = harness();
  await connected(same);
  same.win.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: account(7) }));
  assert.equal(same.state.cleared, 0);
  assert.equal(same.loads.length, 2);
});

test("pagehide during a pending response leaves no timer, write or display; 401 denies", async () => {
  const h = harness();
  await connected(h);
  void h.lifecycle.refresh();
  assert.equal(h.requests.length, 2);
  h.win.dispatchEvent(pageEvent("pagehide", true));
  assert.equal(h.state.view, null);
  assert.equal(h.requests[1].init.signal.aborted, true);
  assert.equal(h.win.timers.size, 0);
  const writes = h.state.writes;
  h.requests[1].resolve(reply(200, native()));
  await settle();
  assert.equal(h.state.writes, writes, "no late DOM write");
  assert.equal(h.state.view, null);
  void h.lifecycle.refresh();
  assert.equal(h.requests.length, 2, "a disposed document does not fetch");

  const signedOut = harness();
  await connected(signedOut);
  void signedOut.lifecycle.refresh();
  signedOut.requests[1].resolve(reply(401));
  await until(() => signedOut.state.denied.length === 1);
  assert.deepEqual(signedOut.state.denied, [401]);
  assert.equal(signedOut.state.view, null);
});

test("a same-account 503 stays a visible failure and never becomes a measured zero", async () => {
  const h = harness();
  const first = native();
  await connected(h, first);
  void h.lifecycle.refresh();
  h.requests[1].resolve(reply(503, { detail: "unavailable" }));
  await until(() => h.state.failed.length === 1);
  assert.deepEqual(h.state.failed, [{ retained: true }]);
  assert.equal(h.state.view, first, "the last data of the same account stays");
  assert.equal(h.state.rendered.length, 1);
  assert.equal(h.loads.length, 3, "retaining cached data after 503 requires a new /me confirmation");

  const cold = harness();
  cold.lifecycle.start();
  void cold.lifecycle.initialize();
  await until(() => cold.requests.length === 1);
  cold.requests[0].resolve(reply(503));
  await until(() => cold.state.failed.length === 1);
  assert.deepEqual(cold.state.failed, [{ retained: false }]);
  assert.equal(cold.state.rendered.length, 0);
  assert.equal(cold.win.of("timeout").length, 0);

  // After an account change nothing from the old account is retained.
  const moved = harness();
  await connected(moved);
  moved.state.cookie = account(8);
  moved.win.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: moved.state.cookie }));
  await until(() => moved.requests.length === 2);
  moved.requests[1].resolve(reply(503));
  await until(() => moved.state.failed.length === 1);
  assert.deepEqual(moved.state.failed, [{ retained: false }]);
  assert.equal(moved.state.view, null);
});

test("cookie-only account change while an A response body is pending never installs it for B", async () => {
  const h = harness(), body = deferred();
  void h.lifecycle.initialize();
  await until(() => h.requests.length === 1);
  let reading = false;
  h.requests[0].resolve({ status: 200, ok: true, json: () => { reading = true; return body.promise; } });
  await until(() => reading);
  h.state.cookie = account(8); // No zdwa:auth-state event in this document.
  body.resolve(native({ generated_at: "A-private-result" }));
  await until(() => h.requests.length === 2, "B must be freshly bound before requesting its own data");
  assert.equal(h.state.view, null);
  assert.deepEqual(h.state.rendered, []);
  assert.deepEqual(h.state.bound, [7, 8]);
  const forB = native({ generated_at: "B-result" });
  h.requests[1].resolve(reply(200, forB));
  await until(() => h.state.rendered.length === 1);
  assert.equal(h.state.view, forB);
});

test("post-body confirmation drains an already running A auth read before a new cookie-only B read", async () => {
  const h = harness(), oldAuth = deferred();
  void h.lifecycle.initialize();
  await until(() => h.requests.length === 1);
  h.state.inflight = oldAuth.promise;
  h.requests[0].resolve(reply(200, native()));
  await settle();
  assert.equal(h.loads.length, 1, "an old in-flight read is drained, not counted as post-body confirmation");
  assert.equal(h.state.view, null);
  h.state.cookie = account(8);
  h.state.inflight = null;
  oldAuth.resolve(account(7));
  await until(() => h.requests.length === 2);
  assert.deepEqual(h.state.bound, [7, 8]);
  assert.equal(h.state.rendered.length, 0);
  assert.equal(h.loads.length, 3, "B is seen by a new read and then bound by initialization");
});

test("a cookie-only B change during 503 never retains cached A values", async () => {
  const h = harness();
  await connected(h);
  void h.lifecycle.refresh();
  h.state.cookie = account(8);
  h.requests[1].resolve(reply(503));
  await until(() => h.requests.length === 3);
  assert.equal(h.state.view, null, "the old account's cached values are removed");
  assert.equal(h.state.rendered.length, 1);
  assert.deepEqual(h.state.bound, [7, 8]);
  assert.deepEqual(h.state.failed, [], "A's failure cannot become B's retained-data notice");
  h.requests[2].resolve(reply(503));
  await until(() => h.state.failed.length === 1);
  assert.deepEqual(h.state.failed, [{ retained: false }]);
  assert.equal(h.state.view, null);
});

test("analytics always sends the captured viewer ID, even when the request cookie changes", async () => {
  const h = harness();
  h.state.cookie = account(8);
  await connected(h, legacy("all"));
  assert.deepEqual(h.requests[0].init.headers, { "X-Analytics-Expected-Account-Id": "8" });
  h.state.cookie = account(7);
  void h.lifecycle.refresh();
  assert.deepEqual(h.requests[1].init.headers, { "X-Analytics-Expected-Account-Id": "8" }, "a cookie is not authority to replace the bound viewer");
  h.requests[1].resolve(reply(409, { detail: "analytics_account_changed" }));
  await until(() => h.requests.length === 3);
  assert.deepEqual(h.requests[2].init.headers, { "X-Analytics-Expected-Account-Id": "7" }, "only a fresh rebind selects the next request's ID");
  assert.deepEqual(h.state.bound, [8, 7]);
  assert.equal(h.state.view, null);
});

test("a real account-mismatch 409 blocks the delegated B to owner A to B cookie race without retaining data", async () => {
  const h = harness(), body = deferred();
  const forB = legacy("all"), forOwner = native({ period: { game: "all" }, generated_at: "owner-only-four-game-data" });
  h.state.cookie = account(8); // The delegated viewer is B and is not a Watten audience grant.
  await connected(h, forB);
  h.state.cookie = account(7); // Only the server's cookie changes; this document receives no event.
  void h.lifecycle.refresh();
  const request = h.requests[1], serverIdentity = h.state.cookie.user.id;
  const expected = request.init.headers?.["X-Analytics-Expected-Account-Id"];
  // The real endpoint accepts a missing optional header, but rejects a
  // supplied different ID before invoking stats. Its identity is fixed now,
  // not when the response body is eventually delivered.
  const mismatch = expected !== undefined && expected !== String(serverIdentity);
  let statsCalls = 0, reading = false;
  const payload = mismatch ? { detail: "analytics_account_changed" } : (statsCalls += 1, forOwner);
  request.resolve({ status: mismatch ? 409 : 200, ok: !mismatch, json: async () => { reading = true; await body.promise; return payload; } });
  await until(() => reading);
  h.state.cookie = account(8); // B again before body delivery: a post-read alone would accept A's DTO.
  body.resolve();
  await until(() => h.requests.length === 3 || h.state.rendered.length > 1);
  assert.deepEqual(h.state.rendered, [forB], "owner data is never installed, even though post-body auth reports B");
  assert.equal(statsCalls, 0, "the expected-account check rejects before owner stats are produced");
  assert.equal(h.state.view, null, "the mismatch clears cached data as well");
  assert.deepEqual(h.state.failed, [], "account mismatch is not a retained-cache failure");
  assert.deepEqual(h.state.bound, [8, 8], "409 requires a fresh initialization, even for the same returning account");
  assert.deepEqual(h.requests.map(entry => entry.init.headers), Array.from({ length: 3 }, () => ({ "X-Analytics-Expected-Account-Id": "8" })));
  const rebound = legacy("all", { generated_at: "fresh-B-only-data" });
  h.requests[2].resolve(reply(200, rebound));
  await until(() => h.state.rendered.length === 2);
  assert.equal(h.state.view, rebound);
  assert.deepEqual(watten.visibleGames(h.state.view), ["zdwa", "zilch", "hausdepp"]);
});

test("only an actual 409 account-changed body triggers rebinding; other conflicts stay checked failures", async () => {
  for (const conflict of [{ detail: "another_conflict" }, {}, null, "malformed"]) {
    const h = harness(), first = legacy("all");
    await connected(h, first);
    void h.lifecycle.refresh();
    h.requests[1].resolve(conflict === "malformed"
      ? { status: 409, ok: false, json: async () => { throw new SyntaxError("cut"); } }
      : reply(409, conflict));
    await until(() => h.state.failed.length === 1);
    assert.deepEqual(h.state.failed, [{ retained: true }]);
    assert.equal(h.state.view, first);
    assert.deepEqual(h.state.bound, [7]);
    assert.equal(h.requests.length, 2);
    assert.equal(h.loads.length, 3, "a failed conflict still needs fresh same-account confirmation");
  }
});

test("pagehide during post-body auth leaves no timers or late writes", async () => {
  const h = harness();
  h.lifecycle.start();
  void h.lifecycle.initialize();
  await until(() => h.requests.length === 1);
  h.state.hold = true;
  h.requests[0].resolve(reply(200, native()));
  await until(() => h.loads.length === 2, "the result must wait for post-body auth");
  assert.equal(h.state.view, null);
  h.win.dispatchEvent(pageEvent("pagehide", true));
  const writes = h.state.writes;
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.win.timers.size, 0);
  h.loads[1].resolve(account(7));
  await settle();
  assert.equal(h.state.writes, writes);
  assert.equal(h.state.rendered.length, 0);
});

test("unverifiable or revoked post-body auth clears cached data instead of retaining it", async () => {
  for (const result of ["unavailable", "signed-out", "revoked"]) {
    const h = harness();
    await connected(h);
    h.state.hold = true;
    void h.lifecycle.refresh();
    h.requests[1].resolve(reply(503));
    await until(() => h.loads.length === 3);
    assert.equal(h.state.rendered.length, 1);
    if (result === "unavailable") h.loads[2].reject(new Error("auth unavailable"));
    else h.loads[2].resolve(result === "signed-out" ? { authenticated: false, user: null } : account(7, false));
    await until(() => h.state.view === null, result);
    assert.ok(h.state.failed.every(failure => !failure.retained), result);
    assert.equal(h.state.rendered.length, 1, result);
    assert.equal(h.win.of("timeout").length, 0, result);
    if (result !== "unavailable") assert.deepEqual(h.state.denied, [result === "signed-out" ? 401 : 403]);
  }
});

for (const language of ["de", "en"]) {
  test(`${language}: geography hides unmeasured zeros and restores a real measured zero`, () => {
    const f = fmt(language), viz = new FakeElement(), note = new FakeElement();
    let clears = 0;
    const updates = [];
    const globe = { clear() { clears += 1; viz.textContent = "0 / 0"; }, update(rows) { updates.push(rows); viz.textContent = "0 / 0"; } };
    const deps = { viz, note, globe, ...f };
    assert.equal(watten.presentGeography(native(), deps), false);
    assert.equal(viz.hidden, true, "all zero summaries and the map are hidden together");
    assert.equal(note.hidden, false);
    assert.ok(note.innerHTML.includes(escapeHtml(f.t("Für Watten nicht erfasst"))));
    assert.ok(note.innerHTML.includes(escapeHtml(f.t("Herkunft wird für Watten nicht erfasst."))));
    assert.equal(updates.length, 0);
    assert.equal(clears, 1);
    const noCollector = legacy("hausdepp", { metric_coverage: { traffic: "not_instrumented" } });
    watten.presentGeography(noCollector, deps);
    assert.equal(viz.hidden, true);
    assert.ok(!note.innerHTML.includes("Watten"), "an unmeasured legacy filter is not relabelled as Watten");
    const measured = legacy("zdwa", { geography: [] });
    assert.equal(watten.presentGeography(measured, deps), true);
    assert.equal(viz.hidden, false);
    assert.equal(viz.textContent, "0 / 0", "a genuinely measured empty geography is still zero");
    assert.equal(note.hidden, true);
    assert.equal(note.innerHTML, "");
    assert.deepEqual(updates, [[]]);
  });
}

test("the actual dashboard wires geography coverage through its game-filter render", async () => {
  const f = fmt("en"), { $ } = dashboardDom();
  const win = Object.assign(makeWindow(), { requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }), ZDWA_I18N: { t: f.t, locale: f.locale } });
  globalThis.window = win;
  $("dashboardGame").value = "all";
  $("dashboardDays").value = "7";
  win.fetch = async url => {
    const game = new URL(url, "https://example.test").searchParams.get("game");
    return reply(200, game === "watten" ? native() : legacy(game, { available_games: ALL, geography: [],
      ...(game === "hausdepp" ? { metric_coverage: { traffic: "not_instrumented" } } : {}) }));
  };
  const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const auth = moduleUrl(`export const escapeHtml = ${escapeHtml.toString()}; export const loadAuth = async () => (${JSON.stringify(account(7))});`);
  const favorites = moduleUrl('export const createFavorites = () => Object.fromEntries(["beforeMetricsRender", "setUser", "setEnabled", "refresh", "clear"].map(key => [key, () => {}]));');
  const globe = moduleUrl('export const createGlobe = viz => { const update = () => { viz.textContent = "0 mapped / 0 unmapped"; viz.dataset.updates = String(Number(viz.dataset.updates || 0) + 1); }; return { update, clear: update, suspend() {}, resume() {}, setPaused() {}, refreshDesign() {} }; };');
  let dashboard = await readFile(new URL("../frontend/dashboard.js", import.meta.url), "utf8");
  dashboard = dashboard.replace('import "./i18n/index.js";', "");
  for (const [path, replacement] of [["./shared/auth.js", auth], ["./dashboard/favorites.js", favorites], ["./dashboard/globe.js", globe]]) {
    dashboard = dashboard.replace(JSON.stringify(path), JSON.stringify(replacement));
  }
  for (const path of ["./dashboard/watten.js", "./dashboard/analysis.js"]) {
    dashboard = dashboard.replace(JSON.stringify(path), JSON.stringify(moduleUrl(await readFile(new URL(`../frontend/${path.slice(2)}`, import.meta.url), "utf8"))));
  }
  const html = await readFile(new URL("../app/static/dashboard.html", import.meta.url), "utf8");
  assert.match(html, /id="geographyUnmeasured"[^>]*hidden/);
  try {
    await import(moduleUrl(dashboard));
    await until(() => $("geographyViz").dataset.updates === "1");
    assert.equal($("geographyViz").hidden, false);
    $("dashboardGame").value = "watten";
    $("dashboardGame").dispatchEvent(new Event("change"));
    await until(() => $("geographyUnmeasured").hidden === false);
    assert.equal($("geographyViz").hidden, true, "the real dashboard hides its globe's visible zero counters");
    assert.ok($("geographyUnmeasured").innerHTML.includes("Not measured for Watten"));
    assert.equal($("countryNote").textContent, f.t("Herkunft wird für Watten nicht erfasst."));
    assert.equal($("collectionNote").textContent, f.t("Für Watten werden keine Browserbesuche erfasst; Partien und Live-Tische stammen vom Server."));
    $("dashboardGame").value = "hausdepp";
    $("dashboardGame").dispatchEvent(new Event("change"));
    await until(() => $("geographyViz").dataset.updates === "3");
    assert.equal($("geographyViz").hidden, true);
    const generic = f.t("Für diesen Filter werden keine Browserbesuche gemessen.");
    assert.deepEqual({ country: $("countryNote").textContent, collection: $("collectionNote").textContent },
      { country: generic, collection: generic }, "neither actual legacy note may claim that its product is Watten");
    assert.ok(!$("geographyUnmeasured").innerHTML.includes("Watten"));
    $("dashboardGame").value = "zdwa";
    $("dashboardGame").dispatchEvent(new Event("change"));
    await until(() => $("geographyViz").hidden === false);
    assert.equal($("geographyUnmeasured").hidden, true);
    assert.equal($("geographyViz").textContent, "0 mapped / 0 unmapped");
  } finally { win.dispatchEvent(pageEvent("pagehide", true)); }
});

test("existing products, labels and all three dashboard designs keep their measured views; Watten adds no tournaments or profiles", () => {
  assert.deepEqual(watten.gameSelection(["zdwa", "zilch", "hausdepp"], "hausdepp"),
    { allowed: ["zdwa", "zilch", "hausdepp"], value: "hausdepp", allLabel: "Alle Spiele", description: "Dein Kontrollzentrum für alle Spiele." });
  assert.equal(watten.gameSelection(["zdwa", "zilch"], "zilch").allLabel, "Beide Spiele");
  assert.deepEqual(watten.visibleGames({ period: { game: "zilch" } }), ["zilch"], "legacy responses without available_games");
  assert.deepEqual(watten.overviewCoverage({ period: { game: "hausdepp" } }),
    { unknown: true, hint: "Browserbesuche bisher nicht erfasst", completedLabel: "Runden beendet" });
  assert.equal(watten.overviewCoverage(legacy("zdwa")).unknown, false);
  assert.equal(watten.overviewCoverage({}).unknown, false);
  assert.equal(watten.trafficSourceNote(legacy("all"), fmt("de")), "");
  assert.equal(watten.wattenMonitoringNote(legacy("all"), fmt("de")), "");
  assert.equal(watten.unmeasuredCopy(legacy("hausdepp")), null);
  assert.equal(watten.wattenModeLabel("four"), "4 Plätze");
  assert.equal(watten.wattenModeLabel("2"), "2 Plätze");
  assert.equal(watten.wattenModeLabel("trio"), "3 Plätze");
  assert.equal(watten.wattenModeLabel("normal"), "Andere Platzzahl");
  assert.equal(fmt("en").t(watten.wattenModeLabel("4")), "4 seats");
  for (const language of ["de", "en"]) {
    const card = watten.wattenGameCard(native().games[0], fmt(language));
    assert.ok(!/Turnier|Tournament|Rundenpausen|Between rounds|Hardcore|ladin|Profil|profile/i.test(card), card);
  }

  for (const design of ["mission", "lcars", "nexus"]) {
    for (const language of ["de", "en"]) {
      const { $, analysis, f } = analysisFor(language, design);
      analysis.update(legacy("hausdepp"));
      assert.equal(($("activityHeatmap").innerHTML.match(/<rect /g) || []).length, 168, design);
      assert.ok($("journeySample").textContent.startsWith(f.t("Stichprobe der neuesten Seitenaufrufe")), design);
      assert.equal($("trafficControls").hidden, false, design);
      assert.ok($("dailyChart").innerHTML.includes("<svg"), design);
      analysis.update(native());
      assert.ok($("activityHeatmap").innerHTML.includes(escapeHtml(f.t("Für Watten nicht erfasst"))), design);
      assert.equal(globalThis.document.body.dataset.dashboardDesign, design);
    }
  }
});
