import "./i18n/index.js";
import { escapeHtml, loadAuth } from "./shared/auth.js";
import { createAnalysisVisuals } from "./dashboard/analysis.js";
import { createGlobe } from "./dashboard/globe.js";
import { createFavorites } from "./dashboard/favorites.js";
import {
  DASHBOARD_GAMES, countText, createDashboardLifecycle, dashboardGameName, gameSelection, overviewCoverage, presentGeography,
  trafficMeasured, trafficSourceNote, unmeasuredCopy, visibleGames, wattenGameCard, wattenModeLabel, wattenMonitoringNote,
} from "./dashboard/watten.js";

const REFRESH_MS = 30000;
const byId = id => document.getElementById(id);
const t = value => window.ZDWA_I18N?.t(value) || value;
const e = value => escapeHtml(String(value ?? ""));
const locale = () => window.ZDWA_I18N?.locale() || "de-CH";
const number = value => value == null ? "—" : new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Number(value) || 0);
const percent = value => value == null ? "—" : new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value);
const count = value => Math.max(0, Number(value) || 0);
const DESIGN_KEY = "rollthedice:dashboard:design";
const DESIGNS = new Set(["mission", "lcars", "nexus"]);
function storedDesign() {
  try { const value = localStorage.getItem(DESIGN_KEY); return DESIGNS.has(value) ? value : "mission"; }
  catch { return "mission"; }
}
// Dashboard appearance is a local preference, separate from either game's skin.
document.body.dataset.dashboardDesign = storedDesign();
byId("dashboardDesign").value = document.body.dataset.dashboardDesign;
const gameName = game => dashboardGameName(game) || t("Beide Spiele");
const gameBadge = game => DASHBOARD_GAMES.includes(game) ? `<span class="game-badge">${gameName(game)}</span>` : "";
const duration = seconds => {
  if (seconds == null) return "—";
  const value = Math.round(count(seconds));
  if (value < 60) return `${number(value)} s`;
  if (value < 3600) return `${number(Math.floor(value / 60))} min ${number(value % 60)} s`;
  if (value < 86400) return `${number(Math.floor(value / 3600))} h ${number(Math.floor(value % 3600 / 60))} min`;
  return `${number(Math.floor(value / 86400))} ${t("Tage")} ${number(Math.floor(value % 86400 / 3600))} h`;
};
const bytes = value => {
  if (value == null) return "—";
  if (value < 1024 ** 3) return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value / 1024 ** 2)} MiB`;
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
};
const timestamp = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};
const utcDay = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
};

const REFERRER_LABELS = { direct: "Direkt / ohne Herkunft", internal: "Aus dem eigenen Spiel", search: "Suchmaschinen", social: "Social Media", other: "Andere Websites" };
const DEVICE_LABELS = { mobile: "Smartphone", tablet: "Tablet", desktop: "Desktop", unknown: "Unbekannt" };
const OS_LABELS = { android: "Android", ios: "iOS", ipados: "iPadOS", fireos: "Fire OS", windows: "Windows", macos: "macOS", linux: "Linux", chromeos: "ChromeOS", unknown: "Unbekannt" };
const HARDWARE_LABELS = { ipad: "iPad", iphone: "iPhone", fire_tablet: "Fire-Tablet", android_tablet: "Android-Tablet", android_phone: "Android-Smartphone", mac: "Mac", windows_pc: "Windows-PC", linux_pc: "Linux-PC", chromebook: "Chromebook", unknown: "Unbekannt" };
const APP_MODE_LABELS = { pwa: "PWA / Appfenster", browser: "Browser-Tab", unknown: "Unbekannt" };
const BROWSER_LABELS = { chrome: "Chrome / Chromium", safari: "Safari / WebKit", edge: "Edge", firefox: "Firefox", samsung_internet: "Samsung Internet", opera: "Opera", silk: "Amazon Silk", other: "Andere Browser", unknown: "Unbekannt" };
const REQUEST_AGENT_LABELS = { googlebot: "Googlebot", google_other: "Weitere Google-Kennungen", bingbot: "Bingbot", applebot: "Applebot", duckduckbot: "DuckDuckBot", yandexbot: "YandexBot", baiduspider: "Baiduspider", meta_bot: "Meta-Bots", openai_bot: "OpenAI-Bots", anthropic_bot: "Anthropic-Bots", uptime_bot: "Monitoring-Kennungen", curl: "curl", python_client: "Python-Clients", node_client: "Node.js-Clients", go_client: "Go-Clients", other_bot: "Andere Bot-Kennungen", browser: "Browserkennung", unknown: "Unbekannt" };
const REQUEST_CHANNEL_LABELS = { api: "API", asset: "Dateien", page: "Seiten", other: "Sonstiges" };
const ACTION_LABELS = {
  create_game: "Partie erstellen", join_game: "Partie beitreten", watch_game: "Partie zuschauen", roll_dice: "Würfeln",
  score: "Wertung wählen", hold_dice: "Würfel halten", bank: "Punkte sichern", game_leave: "Partie verlassen",
  game_invite: "Zur Partie einladen", open_rules: "Spielregeln öffnen", open_players: "Spieler öffnen",
  open_achievements: "Erfolge öffnen", open_leaderboard: "Bestenlisten öffnen", open_history: "Historie öffnen",
  open_statistics: "Statistiken öffnen", navigate: "Seite wechseln", mode_solo: "Solo wählen", mode_duo: "Zu zweit wählen",
  mode_trio: "Zu dritt wählen", mode_team: "Teamspiel wählen", mode_normal: "Normal wählen", mode_hardcore: "Hardcore wählen",
  mode_computer: "Würfelwirt wählen", mode_multiplayer: "Mehrspieler wählen", mode_offline: "Offline-Spiel wählen",
  open_account: "Konto öffnen", open_settings: "Einstellungen öffnen", theme_change: "Darstellung wechseln",
  language_change: "Sprache wechseln", game_restart: "Neue Partie starten", game_created: "Spielraum angelegt",
  game_aborted: "Partie abgebrochen",
};
const PAGE_LABELS = { "/": "Lobby", "/spiel": "Am Spieltisch", "/zuschauen": "Zuschauen", "/regeln": "Spielregeln", "/spieler": "Spieler & Ranking", "/rangabzeichen": "Rangabzeichen", "/bestenlisten": "Bestenlisten", "/historie": "Historie", "/statistiken": "Statistiken", "/erfolge": "Erfolge", "/offline": "Offline-Seite", "/ergebnis": "Spielergebnis", "/konto": "Konto" };
const MODE_LABELS = { "1": "Solo", "2": "Zu zweit", "3": "Zu dritt", "2v2": "Teamspiel", solo: "Solo", duo: "Zu zweit", trio: "Zu dritt", four: "Zu viert", five: "Zu fünft", six: "Zu sechst", team: "Teamspiel", multiplayer: "Zu zweit", cpu: "Gegen den Würfelwirt", normal: "Normal", hardcore: "Hardcore" };
// Design comparison: each look names one game, design and colour scheme.
// Side "a" is the new ZDWA design or the Zilch tavern table, side "b" the
// previous ZDWA design or LCARS; colours follow the side everywhere.
const DESIGN_GROUPS = [
  { title: "ZDWA Neu", game: "zdwa", looks: [["zdwa:new:light", "Hell"], ["zdwa:new:dark", "Dunkel"], ["zdwa:new:classic", "Classic"]] },
  { title: "ZDWA Bisher", game: "zdwa", looks: [["zdwa:old:light", "Hell"], ["zdwa:old:dark", "Dunkel"], ["zdwa:old:classic", "Classic"]] },
  { title: "Zilch", game: "zilch", looks: [["zilch:tavern", "Wirtshaustisch"], ["zilch:lcars", "LCARS"]] },
];
const DESIGN_SIDES = {
  zdwa: [{ label: "Neu", looks: DESIGN_GROUPS[0].looks.map(([look]) => look) }, { label: "Bisher", looks: DESIGN_GROUPS[1].looks.map(([look]) => look) }],
  zilch: [{ label: "Wirtshaustisch", looks: ["zilch:tavern"] }, { label: "LCARS", looks: ["zilch:lcars"] }],
};

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let motionPaused = motionQuery.matches;
try { motionPaused ||= localStorage.getItem("rollthedice:dashboard:motion") === "paused"; } catch { /* Motion controls remain available without browser storage. */ }
const favorites = createFavorites({ t, number });

function empty(title = "Noch keine Messwerte", description = "Die Besuchsmessung beginnt mit diesem Release.") {
  return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌁</span><strong>${e(t(title))}</strong><p>${e(t(description))}</p></div>`;
}

function sparkline(values) {
  if (!values.length) return `<svg class="metric-spark" viewBox="0 0 200 27" preserveAspectRatio="none" aria-hidden="true"><path d="M0 24H200" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5"/></svg>`;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${index * 200 / Math.max(1, values.length - 1)},${25 - value / max * 22}`).join(" ");
  return `<svg class="metric-spark" viewBox="0 0 200 27" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function overview(data) {
  favorites.beforeMetricsRender();
  const totals = data.overview || {};
  const days = data.daily || [];
  const metrics = [
    { id: "live-sessions", label: "Aktive Besuche", value: totals.live_sessions, hint: "Letzte 2 Minuten", live: true },
    { id: "sessions", label: "Besuche", value: totals.sessions, hint: "Anonyme Tab-Sitzungen", series: "sessions", comparison: "sessions" },
    { id: "page-views", label: "Seitenaufrufe", value: totals.page_views, hint: "Im gewählten Zeitraum", series: "page_views", comparison: "page_views" },
    { id: "active-seconds", label: "Aktive Zeit", value: duration(totals.active_seconds), hint: "Sichtbar und aktiv", series: "active_seconds", comparison: "active_seconds" },
    { id: "avg-active-seconds", label: "Ø Zeit je Besuch", value: duration(totals.avg_active_seconds), hint: "Sichtbar und aktiv", series: "active_seconds", comparison: "avg_active_seconds" },
    { id: "completed-games", label: "Partien beendet", value: totals.completed_games, hint: "Gespeicherte Ergebnisse", series: "completed_games", comparison: "completed_games" },
  ];
  const coverage = overviewCoverage(data);
  const comparison = metric => {
    if (coverage.unknown && metric.comparison !== "completed_games") return "";
    const previous = data.comparison?.overview?.[metric.comparison];
    if (!previous) return "";
    if (metric.comparison !== "completed_games" && data.comparison?.previous_data_coverage !== "complete") return `<span class="metric-delta neutral">${e(t(data.comparison?.previous_data_coverage === "partial" ? "Vorperiode unvollständig" : "Keine Vergleichsbasis"))}</span>`;
    if (previous.change_percent == null) return `<span class="metric-delta neutral">${e(t("Vorperiode"))}: ${number(previous.previous)}</span>`;
    const change = Number(previous.change_percent) || 0;
    return `<span class="metric-delta ${change >= 0 ? "positive" : "negative"}"><span aria-hidden="true">${change >= 0 ? "↗" : "↘"}</span> ${change > 0 ? "+" : ""}${percent(change)}% <small>${e(t("zur Vorperiode"))}</small></span>`;
  };
  byId("overviewMetrics").innerHTML = metrics.map(metric => {
    const unknown = coverage.unknown && metric.id !== "completed-games";
    const label = metric.id === "completed-games" ? coverage.completedLabel : metric.label;
    return `<article class="metric-card" data-favorite-id="metric-${metric.id}" data-favorite-kind="metric"><p class="metric-label">${e(t(label))}${metric.live ? '<span class="signal-dot" aria-hidden="true" style="margin-left:8px"></span>' : ""}</p><div class="metric-value">${unknown ? "—" : metric.series === "active_seconds" ? e(metric.value) : number(metric.value)}</div><p class="metric-hint">${e(t(unknown ? coverage.hint : metric.hint))}</p>${comparison(metric)}${sparkline(!unknown && metric.series ? days.map(day => count(day[metric.series])) : [])}</article>`;
  }).join("");
  const sources = trafficSourceNote(data, { t });
  byId("comparisonNote").textContent = data.comparison ? `${t("Heute (UTC) ist noch unvollständig. Verglichen wird mit den vorangehenden Kalendertagen; fehlende ältere Messwerte ergeben keinen Wachstumstrend.")}${sources ? ` ${sources}` : ""}` : "";
}

function dailyChart(data) {
  const rows = data.daily || [];
  if (!rows.some(row => count(row.sessions) || count(row.page_views))) {
    byId("dailyChart").innerHTML = empty();
  } else {
    const width = 720;
    const height = 224;
    const left = 37;
    const right = 13;
    const top = 15;
    const bottom = 28;
    const maximum = Math.max(1, ...rows.map(row => Math.max(count(row.sessions), count(row.page_views))));
    const niceMax = Math.max(4, Math.ceil(maximum / (10 ** Math.floor(Math.log10(maximum)))) * (10 ** Math.floor(Math.log10(maximum))));
    const plotHeight = height - top - bottom;
    const x = index => left + index * (width - left - right) / Math.max(1, rows.length - 1);
    const y = value => top + plotHeight - count(value) / niceMax * plotHeight;
    const points = key => rows.map((row, index) => `${x(index).toFixed(2)},${y(row[key]).toFixed(2)}`).join(" ");
    const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) / 3), Math.floor((rows.length - 1) * 2 / 3), rows.length - 1])];
    const axis = Array.from({ length: 5 }, (_, index) => {
      const value = niceMax * index / 4;
      return `<line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-axis" x="${left - 10}" y="${y(value) + 3}" text-anchor="end">${number(value)}</text>`;
    }).join("");
    const labels = labelIndexes.map(index => `<text class="chart-axis" x="${x(index)}" y="${height - 4}" text-anchor="${index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}">${e(new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${rows[index].date}T00:00:00Z`)))}</text>`).join("");
    const title = `${t("Besuche")}: ${number(data.overview?.sessions)} · ${t("Seitenaufrufe")}: ${number(data.overview?.page_views)}`;
    byId("dailyChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="dailyChartTitle"><title id="dailyChartTitle">${e(title)}</title><defs><linearGradient id="trafficFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6ee7de" stop-opacity=".19"/><stop offset="1" stop-color="#6ee7de" stop-opacity="0"/></linearGradient></defs>${axis}<polygon points="${x(0)},${y(0)} ${points("sessions")} ${x(rows.length - 1)},${y(0)}" fill="url(#trafficFade)"/><polyline class="chart-line" stroke="#f4c77b" points="${points("page_views")}"/><polyline class="chart-line" stroke="#6ee7de" points="${points("sessions")}"/>${rows.length === 1 ? `<circle cx="${x(0)}" cy="${y(rows[0].sessions)}" r="4" fill="#6ee7de"/><circle cx="${x(0)}" cy="${y(rows[0].page_views)}" r="4" fill="#f4c77b"/>` : ""}${labels}</svg>`;
  }
  byId("dailyTable").innerHTML = `<div class="data-scroll"><table><caption class="sr-only">${e(t("Besuche und Seitenaufrufe je UTC-Tag"))}</caption><thead><tr>${["UTC-Tag", "Besuche", "Seitenaufrufe", "Aktive Zeit", "Partien beendet"].map(label => `<th scope="col">${e(t(label))}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr><td>${e(row.date)}</td><td>${number(row.sessions)}</td><td>${number(row.page_views)}</td><td>${e(duration(row.active_seconds))}</td><td>${number(row.completed_games)}</td></tr>`).join("")}</tbody></table></div>`;
}

function hourlyChart(rows = [], copy = null) {
  if (copy || !rows.some(row => count(row.page_views))) {
    byId("hourlyChart").innerHTML = copy ? empty(copy.title, copy.description) : empty();
    byId("hourlyChart").classList.remove("hourly-chart");
    return;
  }
  byId("hourlyChart").classList.add("hourly-chart");
  const max = Math.max(1, ...rows.map(row => count(row.page_views)));
  byId("hourlyChart").innerHTML = Array.from({ length: 24 }, (_, hour) => {
    const row = rows.find(item => Number(item.hour) === hour);
    const value = count(row?.page_views);
    const label = `${String(hour).padStart(2, "0")}:00 UTC · ${number(value)} ${t("Seitenaufrufe")} · ${t("Aktive Zeit")}: ${duration(row?.active_seconds || 0)}`;
    return `<div class="hour-cell" role="img" aria-label="${e(label)}" title="${e(label)}"><div class="hour-bar-track" aria-hidden="true"><div class="hour-bar" style="height:${value / max * 100}%"></div></div><span class="hour-label" aria-hidden="true">${String(hour).padStart(2, "0")}</span><span class="hour-total" aria-hidden="true">${number(value)}</span></div>`;
  }).join("");
}

function ranks(id, rows, key, valueKey, label, options = {}) {
  if (!rows?.length) { byId(id).innerHTML = empty(options.emptyTitle, options.emptyDescription); return; }
  const total = rows.reduce((sum, row) => sum + count(row[valueKey]), 0);
  const maximum = Math.max(1, ...rows.map(row => count(row[valueKey])));
  byId(id).innerHTML = `<ol class="rank-list">${rows.slice(0, options.limit || 6).map(row => `<li><div class="rank-copy"><span class="rank-label">${options.flags ? `<span class="country-flag" aria-hidden="true">${countryFlag(row[key])}</span>` : ""}${e(label(row[key]))}${options.game ? gameBadge(row.game) : ""}${options.game && row.source === "server" ? `<span class="game-badge" title="${e(t("Vom Server bestätigt"))}">${e(t("Bestätigt"))}</span>` : ""}</span><span class="rank-amount">${number(row[valueKey])}${options.share ? `<small>${percent(total ? count(row[valueKey]) / total * 100 : 0)}%</small>` : ""}</span></div><div class="rank-track" aria-hidden="true"><div class="rank-fill" style="width:${count(row[valueKey]) / maximum * 100}%"></div></div></li>`).join("")}</ol>`;
}

function countryFlag(value) {
  const code = String(value || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "ZZ") return "◇";
  return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)));
}

function requestTraffic(data) {
  const traffic = data.request_traffic || {};
  const measured = Boolean(traffic.first_recorded_at);
  byId("requestBreakdown").hidden = !measured;
  byId("requestRecordedAt").textContent = measured ? `${t("Frühester gespeicherter UTC-Tag")}: ${utcDay(traffic.first_recorded_at)}` : t("Noch keine Anfrage-Messwerte");
  byId("requestDroppedNote").hidden = !count(traffic.dropped);
  byId("requestDroppedNote").textContent = count(traffic.dropped) ? `${t("Bei Überlastung nicht erfasst")}: ${number(traffic.dropped)} ${t("Anfragen")}. ${t("Diese Messung kann unvollständig sein.")}` : "";
  if (!measured) {
    byId("requestTrafficSummary").innerHTML = empty("Noch keine Anfrage-Messwerte", "Die HTTP-Messung beginnt mit diesem Release.");
    byId("requestCountryRanks").replaceChildren();
    byId("requestStatusRanks").replaceChildren();
    byId("requestAgentRanks").replaceChildren();
    byId("requestChannelRanks").replaceChildren();
    return;
  }
  const total = count(traffic.total);
  const statuses = traffic.statuses || [];
  const statusCount = code => statuses.filter(row => row.status_class === code).reduce((sum, row) => sum + count(row.requests), 0);
  const metrics = [["Anfragen gesamt", total, ""], ["4xx-Antworten", statusCount("4xx"), "warning"], ["5xx-Antworten", statusCount("5xx"), "error"]];
  byId("requestTrafficSummary").innerHTML = metrics.map(([label, value, tone]) => `<div class="request-metric ${tone}"><span>${e(t(label))}</span><strong>${number(value)}</strong><small>${label === "Anfragen gesamt" ? e(t("Alle Spiele · Website gesamt")) : `${percent(total ? value / total * 100 : 0)}% ${e(t("aller Anfragen"))}`}</small></div>`).join("");
  const options = { share: true, emptyTitle: "Keine Anfragen im gewählten Zeitraum", emptyDescription: "HTTP-Anfragen werden direkt an der App gezählt." };
  ranks("requestCountryRanks", traffic.countries, "country", "requests", countryName, { ...options, flags: true, limit: 10 });
  ranks("requestStatusRanks", statuses, "status_class", "requests", value => ["2xx", "3xx", "4xx", "5xx"].includes(value) ? value : t("Andere Antworten"), { ...options, limit: 5 });
  ranks("requestAgentRanks", traffic.agents, "agent_family", "requests", value => t(REQUEST_AGENT_LABELS[value] || "Unbekannt"), { ...options, limit: 18 });
  ranks("requestChannelRanks", traffic.channels, "channel", "requests", value => t(REQUEST_CHANNEL_LABELS[value] || "Sonstiges"), { ...options, limit: 4 });
}

function browserLanguageName(value) {
  if (!value || value === "unknown" || !/^[a-z]{2,3}$/.test(String(value))) return t("Unbekannt");
  try { const label = new Intl.DisplayNames([locale()], { type: "language" }).of(value); return label && label !== value ? label : String(value).toUpperCase(); }
  catch { return String(value).toUpperCase(); }
}

function clientContext(data, copy = null) {
  const modes = (data.app_modes || []).filter(row => count(row.sessions));
  const total = modes.reduce((sum, row) => sum + count(row.sessions), 0);
  const emptyCopy = copy ? { emptyTitle: copy.title, emptyDescription: copy.description } : {};
  if (copy || !total) byId("appModeChart").innerHTML = copy ? empty(copy.title, copy.description) : empty();
  else {
    const pwa = modes.filter(row => row.app_mode === "pwa").reduce((sum, row) => sum + count(row.sessions), 0);
    const known = modes.some(row => row.app_mode === "pwa" || row.app_mode === "browser");
    const share = pwa / total * 100;
    const circumference = 2 * Math.PI * 44;
    byId("appModeChart").innerHTML = `<div class="launch-summary"><div class="launch-orbit" aria-hidden="true"><svg viewBox="0 0 110 110"><circle class="launch-orbit-track" cx="55" cy="55" r="44"/>${pwa ? `<circle class="launch-orbit-meter" cx="55" cy="55" r="44" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - share / 100)}"/>` : ""}</svg><span>${known ? `${percent(share)}<small>%</small>` : "—"}</span></div><div class="launch-copy"><strong>${e(t(known ? "Als PWA geöffnet" : "Startkontext unbekannt"))}</strong><p>${known ? `${number(pwa)} ${e(t("Besuche"))} · ${e(t("Anteil aller Besuche"))}` : e(t("Ältere Angaben bleiben unbekannt."))}</p></div></div><div class="launch-stack" aria-hidden="true">${modes.map(row => `<span class="launch-segment launch-${["pwa", "browser"].includes(row.app_mode) ? row.app_mode : "unknown"} rank-fill" style="width:${count(row.sessions) / total * 100}%"></span>`).join("")}</div>`;
  }
  ranks("appModeRanks", modes, "app_mode", "sessions", value => t(APP_MODE_LABELS[value] || "Unbekannt"), { share: true, limit: 3, ...emptyCopy });
  // Unknown counters stay unknown instead of becoming a measured zero.
  byId("pwaInstalledCount").textContent = countText(data.pwa?.confirmed_installations, number);
  byId("pwaFirstOpenCount").textContent = countText(data.pwa?.first_detected_starts, number);
  ranks("browserRanks", data.browsers, "browser", "sessions", value => t(BROWSER_LABELS[value] || "Unbekannt"), { share: true, limit: 9, ...emptyCopy });
  ranks("browserLanguageRanks", data.browser_languages, "browser_language", "sessions", browserLanguageName, { share: true, limit: 8, ...emptyCopy });
}

function countryName(value) {
  if (!value || value === "unknown" || value === "ZZ") return t("Unbekannt");
  try { return new Intl.DisplayNames([locale()], { type: "region" }).of(String(value).toUpperCase()) || value; } catch { return value; }
}

function pageLabel(value) {
  const path = String(value || "/");
  const normalized = ["/zilch", "/hausdepp"].includes(path) ? "/" : path.replace(/^\/(zilch|hausdepp)\//, "/");
  return t(PAGE_LABELS[normalized] || "Andere Seite");
}

function pageRanks(rows = [], copy = null) {
  if (!rows.length) { byId("pageRanks").innerHTML = copy ? empty(copy.title, copy.description) : empty(); return; }
  byId("pageRanks").innerHTML = `<div class="page-row head" aria-hidden="true"><span>${e(t("Seite"))}</span><span>${e(t("Aufrufe"))}</span><span>${e(t("Aktive Zeit"))}</span><span>${e(t("Ø je Besuch"))}</span></div><ol class="rank-list" style="gap:0">${rows.slice(0, 12).map(row => `<li class="page-row"><span class="page-label"><i class="page-bar" aria-hidden="true"></i><span>${e(pageLabel(row.page))}${gameBadge(row.game)}</span></span><span><span class="sr-only">${e(t("Aufrufe"))}: </span>${number(row.views)}</span><span><span class="sr-only">${e(t("Aktive Zeit"))}: </span>${e(duration(row.active_seconds))}</span><span><span class="sr-only">${e(t("Ø je Besuch"))}: </span>${e(duration(row.avg_active_seconds))}</span></li>`).join("")}</ol>`;
}

function gameCards(data) {
  const games = visibleGames(data);
  byId("gameCards").innerHTML = games.map(game => {
    const row = data.games?.find(item => item.game === game) || {};
    if (game === "watten") return wattenGameCard(row, { t, e, number, duration });
    const details = [["Teilnahmen", number(row.participants || 0)], [game === "hausdepp" ? "Ø Rundendauer" : "Ø Partiedauer", duration(row.avg_duration_seconds)]];
    if (game === "hausdepp") details.push(
      ["Tische live", number(row.live?.active_tables)], ["Menschen verbunden", number(row.live?.connected_humans)],
      ["Computerplätze", number(row.live?.cpu_seats)], ["Aktive Turniere", number(row.live?.active_tournaments)],
      ["Rundenpausen", number(row.live?.interround_tables)], ["Turniere beendet", number(row.completed_tournaments)],
      ["Erfasste Abbrüche", number(row.abandoned_games)],
    );
    return `<div class="game-card" data-game="${e(game)}"><div class="game-card-header"><strong>${gameName(game)}</strong><span aria-hidden="true">${game === "hausdepp" ? "♠" : game === "zdwa" ? "⚄" : "⚅"}</span></div><div class="game-card-number">${number(row.completed_games || 0)}</div><p class="game-card-caption">${e(t(game === "hausdepp" ? "Runden beendet" : "Partien beendet"))}</p><div class="game-card-details">${details.map(([label, value]) => `<span>${e(t(label))}<strong>${e(value)}</strong></span>`).join("")}</div></div>`;
  }).join("");
  const hausdepp = games.includes("hausdepp");
  byId("hausdeppMonitoringNote").hidden = !hausdepp;
  byId("hausdeppMonitoringNote").textContent = hausdepp ? t("Hausdepp: Ergebnisse und Live-Tische werden serverseitig gezählt. Browserbesuche wurden bisher nicht erfasst. Dauer bleibt bei älteren Ergebnissen unbekannt. Abbrüche werden ab dieser Version erfasst; ältere Abbrüche werden nicht nachgetragen.") : "";
  const watten = wattenMonitoringNote(data, { t, number, duration });
  byId("wattenMonitoringNote").hidden = !watten;
  byId("wattenMonitoringNote").textContent = watten;
  // Watten result modes are seat counts; they carry no rule profile.
  const modeLabel = row => row.game === "watten" ? t(wattenModeLabel(row.mode)) : `${t(MODE_LABELS[row.mode] || "Anderer Modus")}${row.hardcore ? " · Hardcore" : ""}`;
  byId("gameModes").innerHTML = (data.modes || []).filter(row => games.includes(row.game)).slice(0, 8).map(row => `<span class="mode-chip">${gameName(row.game)} · ${e(modeLabel(row))}<strong>${number(row.completed_games)}</strong></span>`).join("");
}

// The stored account choice only applies while the 2026 design is released
// for everyone (ROLLTHEDICE_ZDWA_DESIGN=all, app/zdwa_design.py).
const DESIGN_MODE_NOTES = {
  owner: "Design 2026 ist derzeit nur für Owner freigegeben (ROLLTHEDICE_ZDWA_DESIGN=owner). Alle anderen Konten sehen das bisherige Design; ihre gespeicherte Wahl greift erst nach der Freigabe.",
  off: "Design 2026 ist derzeit abgeschaltet (ROLLTHEDICE_ZDWA_DESIGN=off). Alle Konten sehen das bisherige Design; die gespeicherte Wahl greift erst nach der Freigabe.",
};

// Every account starts with the new design, so the stored split is mostly
// defaults. The answers of accounts from before the update are the signal.
function designAccounts(choices, mode, share) {
  const pair = (entries, label) => {
    const sum = entries.reduce((total, [, value]) => total + value, 0);
    const bar = `<div class="design-split design-account-split" role="img" aria-label="${e(`${t(label)}: ${entries.map(([name, value]) => `${t(name)} ${number(value)}`).join(", ")}`)}">${entries.map(([, value], index) => `<span class="${index ? "is-b" : "is-a"}" style="width:${share(value, sum)}%"></span>`).join("")}</div>`;
    return { sum, bar, shareOf: value => sum ? `${percent(share(value, sum))}%` : "—" };
  };
  const stored = [["Konten mit neuem Design", count(choices.new)], ["Konten mit bisherigem Design", count(choices.old)]];
  const answered = [["Neu behalten", count(choices.answered?.new)], ["Zurück zum bisherigen", count(choices.answered?.old)]];
  const storedPair = pair(stored, "Gespeicherte Wahl der Konten");
  const answerPair = pair(answered, "Antwort nach dem Update");
  const neverAsked = Math.min(count(choices.never_asked_new), stored[0][1]);
  const modeNote = DESIGN_MODE_NOTES[mode] ? `<p class="design-mode-note" role="note"><span class="signal-dot warning" aria-hidden="true"></span><span>${e(t(DESIGN_MODE_NOTES[mode]))}</span></p>` : "";
  const storedRows = stored.map(([label, value], index) => `<div class="design-account ${index ? "is-b" : "is-a"}"><dt><i class="legend-dot" aria-hidden="true"></i><span>${e(t(label))}${index ? "" : `<small class="design-account-detail">${e(t("davon nie gefragt"))}: ${number(neverAsked)}</small>`}</span></dt><dd><strong>${number(value)}</strong><small>${storedPair.shareOf(value)}</small></dd></div>`).join("");
  const answerRows = answered.map(([label, value], index) => `<div class="design-answer ${index ? "is-b" : "is-a"}"><dt><i class="legend-dot" aria-hidden="true"></i>${e(t(label))}</dt><dd><strong>${number(value)}</strong><small>${answerPair.shareOf(value)}</small></dd></div>`).join("");
  const answers = answerPair.sum ? `${answerPair.bar}<dl class="design-answer-list">${answerRows}</dl>` : `<p class="design-answers-empty">${e(t("Noch keine Antworten"))}</p>`;
  return `${modeNote}${storedPair.bar}<dl class="design-account-list">${storedRows}</dl><section class="design-answers" aria-labelledby="designAnswersTitle"><h4 id="designAnswersTitle">${e(t("Antwort nach dem Update"))}</h4>${answers}<p class="design-answers-note">${e(t("Konten von vor dem Update, denen die Frage gezeigt wurde oder die im Konto gewählt haben. Wer die Frage schließt, behält das neue Design."))} ${e(t("Noch nicht gefragt"))}: ${number(count(choices.awaiting_prompt))}.</p></section>`;
}

function designUsage(data) {
  const usage = data.design_usage || {};
  const filter = data.period?.game || "all";
  const games = filter === "hausdepp" || filter === "watten" ? [] : filter === "zdwa" || filter === "zilch" ? [filter] : ["zdwa", "zilch"];
  const times = new Map();
  const known = new Set(DESIGN_GROUPS.flatMap(group => group.looks.map(([look]) => look)));
  for (const row of usage.looks || []) {
    if (!known.has(row?.look)) continue;
    const seconds = count(row.seconds);
    times.set(row.look, { seconds, table: Math.min(seconds, count(row.table_seconds)) });
  }
  const time = look => times.get(look) || { seconds: 0, table: 0 };
  const total = looks => looks.reduce((sum, look) => ({ seconds: sum.seconds + time(look).seconds, table: sum.table + time(look).table }), { seconds: 0, table: 0 });
  const gameSeconds = Object.fromEntries(games.map(game => [game, total(DESIGN_SIDES[game].flatMap(entry => entry.looks)).seconds]));
  const tone = look => DESIGN_SIDES[look.startsWith("zilch:") ? "zilch" : "zdwa"][0].looks.includes(look) ? "is-a" : "is-b";
  const share = (value, of) => of ? value / of * 100 : 0;
  // Totals stay in hours (no day unit) so designs compare at a glance; the
  // exact seconds are one hover away and listed in the table.
  const span = seconds => {
    const value = Math.round(count(seconds));
    if (value < 60) return `${number(value)} s`;
    if (value < 3600) return `${number(Math.floor(value / 60))} min${value % 60 ? ` ${number(value % 60)} s` : ""}`;
    const minutes = Math.floor(value % 3600 / 60);
    return `${number(Math.floor(value / 3600))} h${minutes ? ` ${number(minutes)} min` : ""}`;
  };
  const clock = seconds => `<span class="design-time" title="${e(`${number(seconds)} s`)}">${e(span(seconds))}</span>`;
  const firstDay = /^\d{4}-\d{2}-\d{2}$/.test(String(usage.first_day || "")) ? usage.first_day : null;
  const measured = games.some(game => gameSeconds[game] > 0);
  byId("designComparison").innerHTML = measured ? games.map(game => {
    const [a, b] = DESIGN_SIDES[game].map(entry => ({ ...entry, ...total(entry.looks) }));
    const sum = a.seconds + b.seconds;
    const name = gameName(game);
    if (!sum) return `<div class="design-duel is-empty" data-game="${game}"><div class="design-duel-head"><h4>${e(name)}</h4></div><p class="design-duel-empty">${e(t("Keine sichtbare Zeit im gewählten Zeitraum"))}</p></div>`;
    const label = `${name}: ${[a, b].map(entry => `${t(entry.label)} ${percent(share(entry.seconds, sum))}%`).join(", ")}`;
    const values = [a, b].map((entry, index) => `<div class="design-side ${index ? "is-b" : "is-a"}"><dt><i class="legend-dot" aria-hidden="true"></i>${e(t(entry.label))}</dt><dd><strong class="design-share">${percent(share(entry.seconds, sum))}<small>%</small></strong>${clock(entry.seconds)}<small class="design-side-table">${e(t("Am Spieltisch"))}: ${e(span(entry.table))}</small></dd></div>`).join("");
    return `<div class="design-duel" data-game="${game}"><div class="design-duel-head"><h4>${e(name)}</h4><span>${e(t("Gesamt"))} ${clock(sum)}</span></div><div class="design-split" role="img" aria-label="${e(label)}"><span class="is-a" style="width:${share(a.seconds, sum)}%"></span><span class="is-b" style="width:${share(b.seconds, sum)}%"></span></div><dl class="design-sides">${values}</dl></div>`;
  }).join("") : filter === "watten" ? empty("Für Watten nicht erfasst", "Design-Nutzung wird für Watten nicht erfasst.") : empty(firstDay ? "Keine Design-Messwerte im Zeitraum" : "Noch keine Design-Messwerte", firstDay ? "Im gewählten Zeitraum wurde keine sichtbare Zeit gemessen." : "Sobald jemand die Spiele nutzt, erscheint hier die sichtbare Zeit je Design.");
  const choices = usage.zdwa_account_choices && games.includes("zdwa") ? usage.zdwa_account_choices : null;
  byId("designAccountsPanel").hidden = !choices;
  byId("designGrid").classList.toggle("is-single", !choices);
  byId("designAccounts").innerHTML = choices ? designAccounts(choices, usage.zdwa_design_mode, share) : "";
  const groups = DESIGN_GROUPS.filter(group => games.includes(group.game));
  byId("designLooksPanel").hidden = !measured;
  byId("designLooks").style.setProperty("--design-groups", String(groups.length));
  byId("designLooks").dataset.groups = String(groups.length);
  byId("designLooks").innerHTML = measured ? groups.map(group => {
    const sum = total(group.looks.map(([look]) => look));
    const of = gameSeconds[group.game];
    const rows = group.looks.map(([look, label]) => {
      const value = time(look);
      const tableWidth = share(value.table, of);
      const siteWidth = share(value.seconds - value.table, of);
      return `<li class="design-look ${tone(look)}" data-look="${look}"><div class="design-look-copy"><span class="design-look-name">${e(t(label))}</span><span class="design-look-values">${clock(value.seconds)}<small>${percent(share(value.seconds, of))}%</small></span></div><div class="design-look-track" aria-hidden="true"><span class="design-look-table" style="width:${tableWidth}%"></span><span class="design-look-site" style="width:${siteWidth}%"></span></div><p class="design-look-split"><span class="design-look-part is-table"><i aria-hidden="true"></i>${e(t("Am Spieltisch"))} ${e(span(value.table))}</span><span class="design-look-part is-site"><i aria-hidden="true"></i>${e(t("Übrige Seiten"))} ${e(span(value.seconds - value.table))}</span></p></li>`;
    }).join("");
    const groupShare = group.game === "zdwa" ? `<small>${percent(share(sum.seconds, of))}%</small>` : "";
    return `<div class="design-group"><h4><span>${e(t(group.title))}</span><span class="design-group-total">${clock(sum.seconds)}${groupShare}</span></h4><ol class="design-look-list">${rows}</ol></div>`;
  }).join("") : "";
  byId("designTable").innerHTML = measured ? `<div class="data-scroll"><table><caption class="sr-only">${e(t("Sichtbare Sekunden je Design"))}</caption><thead><tr>${["Design", "Sekunden", "Am Spieltisch", "Übrige Seiten", "Anteil im Spiel"].map(label => `<th scope="col">${e(t(label))}</th>`).join("")}</tr></thead><tbody>${groups.flatMap(group => group.looks.map(([look, label]) => {
    const value = time(look);
    return `<tr><th scope="row">${e(t(group.title))} · ${e(t(label))}</th><td>${number(value.seconds)}</td><td>${number(value.table)}</td><td>${number(value.seconds - value.table)}</td><td>${percent(share(value.seconds, gameSeconds[group.game]))}%</td></tr>`;
  })).join("")}</tbody></table></div>` : "";
  byId("designCollectionNote").textContent = filter === "watten" ? t("Design-Nutzung wird für Watten nicht erfasst.") : firstDay ?`${t("Design-Nutzung erfasst seit")} ${utcDay(`${firstDay}T00:00:00Z`)} (UTC). ${t("Aufbewahrung")}: ${number(count(usage.retention_days))} ${t("Tage")}.` : t("Die Messung der Design-Nutzung beginnt mit diesem Release.");
}

function serverMetrics(server = {}) {
  const gauges = [
    { title: "CPU-Auslastung", metric: server.cpu, capacity: `${number(server.cpu?.cores)} ${t("Kerne")}`, detail: `${t("Last")}: ${percent(server.cpu?.load1)} / ${percent(server.cpu?.load5)} / ${percent(server.cpu?.load15)}` },
    { title: "Arbeitsspeicher", metric: server.memory, capacity: `${bytes(server.memory?.used_bytes)} / ${bytes(server.memory?.total_bytes)}`, detail: t("Belegt / verfügbar gesamt") },
    { title: "Festplatte", metric: server.disk, capacity: `${bytes(server.disk?.used_bytes)} / ${bytes(server.disk?.total_bytes)}`, detail: `${bytes(server.disk?.free_bytes)} ${t("frei")}` },
  ];
  byId("serverGauges").innerHTML = gauges.map(gauge => {
    const value = gauge.metric?.percent;
    const normalized = Math.min(100, count(value));
    const circle = 2 * Math.PI * 43;
    const tone = normalized >= 90 ? "danger" : normalized >= 75 ? "warning" : "";
    return `<div class="server-gauge"><div class="gauge-visual" role="img" aria-label="${e(t(gauge.title))}: ${value == null ? e(t("Nicht verfügbar")) : `${percent(value)}%`}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="gauge-track" cx="50" cy="50" r="43"/><circle class="gauge-meter ${tone}" cx="50" cy="50" r="43" stroke-dasharray="${circle}" stroke-dashoffset="${circle * (1 - normalized / 100)}"/></svg><span class="gauge-number" aria-hidden="true">${value == null ? "—" : number(value)}${value == null ? "" : "<small>%</small>"}</span></div><div class="gauge-copy"><h3>${e(t(gauge.title))}</h3><p class="capacity">${e(gauge.capacity)}</p><p>${e(gauge.detail)}</p></div></div>`;
  }).join("");
  const vitals = [["Server-Uptime", duration(server.host_uptime_seconds)], ["App-Uptime", duration(server.app_uptime_seconds)], ["App-Speicher", bytes(server.process_memory_bytes)], ["Aktive Räume", number(server.active_rooms)], ["Spieler verbunden", number(server.players_online)]];
  byId("serverVitals").innerHTML = vitals.map(([label, value]) => `<div class="server-vital"><p>${e(t(label))}</p><strong>${e(value)}</strong></div>`).join("");
  const scope = server.cpu?.scope === "container" || server.memory?.scope === "container" ? "Container-Ressourcen" : "Host-Ressourcen";
  byId("serverNote").textContent = `${t(scope)} · ${t("CPU ist eine Momentaufnahme; Last zeigt 1 / 5 / 15 Minuten.")} ${t("Striche bedeuten: Messwert nicht verfügbar.")}`;
}

function render(data) {
  syncGameOptions(data.available_games || ["zdwa", "zilch"]);
  // Browser panels of a product without a collector show "not measured",
  // never an empty measurement that reads like zero visitors.
  const copy = unmeasuredCopy(data);
  const emptyCopy = copy ? { emptyTitle: copy.title, emptyDescription: copy.description } : {};
  overview(data);
  dailyChart(data);
  hourlyChart(data.hourly, copy);
  ranks("referrerRanks", data.referrers, "source", "sessions", value => REFERRER_LABELS[value] ? t(REFERRER_LABELS[value]) : String(value || t("Andere Websites")), { share: true, ...emptyCopy });
  ranks("deviceRanks", data.devices, "device", "sessions", value => t(DEVICE_LABELS[value] || "Unbekannt"), { share: true, ...emptyCopy });
  ranks("deviceSoftwareRanks", data.device_software, "os", "sessions", value => t(OS_LABELS[value] || "Unbekannt"), { share: true, limit: 10, ...emptyCopy });
  ranks("deviceHardwareRanks", data.device_hardware, "device_family", "sessions", value => t(HARDWARE_LABELS[value] || "Unbekannt"), { share: true, limit: 10, ...emptyCopy });
  clientContext(data, copy);
  ranks("countryRanks", data.countries, "country", "sessions", countryName, { share: true, ...emptyCopy });
  byId("countryNote").textContent = t(copy ? data.period?.game === "watten" ? "Herkunft wird für Watten nicht erfasst." : copy.description : ["trusted_proxy", "cloudflare_verified_peer"].includes(data.collection?.country_source) ? "Länder stammen aus einem vertrauenswürdigen Geo-Proxy; unbekannte Herkunft bleibt unbekannt." : "Ohne vertrauenswürdigen Geo-Proxy bleibt die Herkunft unbekannt. Es gibt keine IP-Geolokalisierung.");
  pageRanks(data.pages, copy);
  ranks("actionRanks", data.actions, "action", "count", value => t(ACTION_LABELS[value] || "Andere Bedienaktion"), { game: true, limit: 10, ...emptyCopy });
  gameCards(data);
  designUsage(data);
  serverMetrics(data.server);
  analysis.update(data);
  presentGeography(data, { viz: byId("geographyViz"), note: byId("geographyUnmeasured"), globe, t, e });
  requestTraffic(data);
  byId("nexusRooms").textContent = number(data.server?.active_rooms);
  byId("nexusPlayers").textContent = number(data.server?.players_online);
  const days = data.period?.days;
  byId("nexusWindow").textContent = days === 1 ? t("Heute (UTC)") : `${number(days)} ${t("Tage")} · UTC`;
  favorites.refresh();
  syncMotion();
  const firstSeen = data.collection?.first_seen_at;
  byId("collectionNote").textContent = copy ? t(data.period?.game === "watten" ? "Für Watten werden keine Browserbesuche erfasst; Partien und Live-Tische stammen vom Server." : copy.description) : firstSeen ? `${t("Messwerte verfügbar seit")} ${timestamp(firstSeen)}` : t("Die Besuchsmessung beginnt mit diesem Release.");
  const dropped = count(data.collection?.dropped);
  byId("queueNote").hidden = !dropped && !data.collection?.cap_reached;
  byId("queueNote").textContent = data.collection?.cap_reached ? t("Die Ereignisgrenze ist erreicht. Ältere Messwerte werden entfernt; der Zeitraum kann unvollständig sein.") : `${t("Verworfene Ereignisse bei Überlastung")}: ${number(dropped)}. ${t("Diese Messung kann unvollständig sein.")}`;
}

function syncGameOptions(games) {
  const selector = byId("dashboardGame");
  const selection = gameSelection(games, selector.value);
  selector.innerHTML = `<option value="all">${e(t(selection.allLabel))}</option>${selection.allowed.map(game => `<option value="${game}">${e(gameName(game))}</option>`).join("")}`;
  selector.value = selection.value;
  for (const scope of document.querySelectorAll("[data-dashboard-game-scope]")) scope.textContent = selection.allowed.map(gameName).join(" + ");
  byId("dashboardSuiteDescription").textContent = t(selection.description);
}

function connection(label, tone = "") {
  byId("connectionLabel").textContent = t(label);
  byId("connectionDot").className = `signal-dot ${tone}`;
}

function message(text, { retry = true, login = false } = {}) {
  byId("dashboardMessage").hidden = false;
  byId("dashboardMessageText").textContent = t(text);
  byId("dashboardRetry").hidden = !retry;
  byId("dashboardLogin").hidden = !login;
}

function denied(status) {
  byId("dashboardData").hidden = true;
  byId("dashboardFilters").hidden = true;
  byId("dashboardLogin").href = "/zilch/anmelden?return_to=%2Fadmin%2Fdashboard";
  connection("Zugriff erforderlich", "warning");
  message(status === 401 ? "Bitte melde dich an, um Mission Control zu öffnen." : "Bitte den Gründer um Zugriff auf Mission Control.", { retry: false, login: status === 401 });
}

// shared/auth.js keeps its in-flight /me read on this cross-bundle symbol.
const authInFlight = () => window[Symbol.for("rollthedice.auth-state")]?.request || null;
const lifecycle = createDashboardLifecycle({
  win: window, doc: document, loadAuth, authInFlight, fetch: (...args) => window.fetch(...args), refreshMs: REFRESH_MS,
  hooks: {
    filters: () => ({ days: byId("dashboardDays").value, game: byId("dashboardGame").value }),
    canMonitor: user => Boolean(user?.is_founder || user?.can_view_analytics || user?.analytics_access),
    bound(user) {
      favorites.setUser(user.id);
      favorites.setEnabled(document.body.dataset.dashboardDesign === "nexus");
      byId("dashboardFilters").hidden = false;
    },
    busy(active, { connecting = false } = {}) {
      byId("dashboardData").setAttribute("aria-busy", String(active));
      byId("dashboardRefresh").disabled = active;
      if (active && connecting) connection("Verbindung wird aufgebaut …");
    },
    render(data) {
      byId("dashboardData").hidden = false;
      byId("dashboardMessage").hidden = true;
      render(data);
      connection("Telemetrie verbunden");
      byId("lastUpdated").textContent = `${t("Aktualisiert")}: ${timestamp(data.generated_at)}`;
    },
    failed({ retained }) {
      connection("Verbindung unterbrochen", "warning");
      message(retained ? "Aktualisierung fehlgeschlagen. Die letzten Messwerte bleiben sichtbar. Bitte versuche es erneut." : "Das Dashboard konnte nicht geladen werden. Bitte versuche es erneut.");
      if (!retained) byId("lastUpdated").textContent = t("Keine Datenverbindung");
    },
    denied,
    // A restored document or another account must verify its current
    // permission before any private snapshot becomes visible again.
    clear() {
      clearPrivateData();
      byId("dashboardData").hidden = true;
    },
    // A product removed from this account's audience falls back to all games.
    unavailable() {
      clearPrivateData();
      byId("dashboardData").hidden = true;
      byId("dashboardGame").value = "all";
    },
    retry(enabled) { byId("dashboardRetry").disabled = !enabled; },
  },
});

byId("dashboardFilters").addEventListener("submit", event => event.preventDefault());
byId("dashboardDays").addEventListener("change", () => lifecycle.refresh());
byId("dashboardGame").addEventListener("change", () => lifecycle.refresh());
byId("dashboardRefresh").addEventListener("click", () => lifecycle.refresh());
byId("dashboardRetry").addEventListener("click", () => lifecycle.retry());
document.addEventListener("visibilitychange", () => syncMotion());

const analysis = createAnalysisVisuals({ t, e, number, percent, duration, gameName, pageLabel, locale, measured: trafficMeasured, unmeasuredCopy });
const globe = createGlobe(byId("geographyViz"), { t, number, locale, countryName });
byId("dashboardDesign").addEventListener("change", event => {
  const design = DESIGNS.has(event.target.value) ? event.target.value : "mission";
  document.body.dataset.dashboardDesign = design;
  try { localStorage.setItem(DESIGN_KEY, design); } catch { /* This document can still switch designs. */ }
  favorites.setEnabled(design === "nexus" && lifecycle.ready && !lifecycle.disposed);
  analysis.refreshLayout();
  globe.refreshDesign();
});
function clearPrivateData() {
  favorites.clear();
  analysis.resetSession();
  globe.clear();
  globe.suspend();
  syncGameOptions(["zdwa", "zilch"]);
  for (const id of ["hausdeppMonitoringNote", "wattenMonitoringNote", "geographyUnmeasured"]) {
    byId(id).hidden = true;
    byId(id).textContent = "";
  }
  byId("geographyViz").hidden = false;
  for (const id of ["overviewMetrics", "comparisonNote", "dailyChart", "dailyTable", "dailySelection", "hourlyChart", "activityHeatmap", "heatmapSelection", "pageRanks", "pageBubbles", "pageDetail", "pageFocus", "journeyFlow", "journeyDetail", "journeyTable", "journeyFocus", "journeySample", "referrerRanks", "deviceRanks", "deviceSoftwareRanks", "deviceHardwareRanks", "deviceDonut", "appModeChart", "appModeRanks", "pwaInstalledCount", "pwaFirstOpenCount", "browserRanks", "browserLanguageRanks", "requestTrafficSummary", "requestCountryRanks", "requestStatusRanks", "requestAgentRanks", "requestChannelRanks", "requestRecordedAt", "requestDroppedNote", "countryRanks", "gameCards", "gameModes", "actionRanks", "designComparison", "designAccounts", "designLooks", "designTable", "designCollectionNote", "serverGauges", "serverVitals", "queueNote", "collectionNote", "lastUpdated", "nexusRooms", "nexusPlayers", "nexusWindow"]) byId(id).replaceChildren();
}
function syncMotion() {
  const paused = motionPaused || motionQuery.matches;
  const live = lifecycle.ready && !lifecycle.disposed;
  document.documentElement.dataset.motion = paused || document.hidden || !live ? "paused" : "running";
  byId("dashboardMotion").setAttribute("aria-pressed", paused);
  byId("dashboardMotion").disabled = motionQuery.matches;
  byId("dashboardMotion").innerHTML = `<span aria-hidden="true">${paused ? "▷" : "Ⅱ"}</span><span>${e(t(motionQuery.matches ? "Reduzierte Bewegung aktiv" : paused ? "Animation fortsetzen" : "Animation pausieren"))}</span>`;
  globe.setPaused(paused);
  if (document.hidden || !live) globe.suspend(); else globe.resume();
}
function setMotion(paused, persist = true) {
  motionPaused = Boolean(paused);
  if (persist) {
    try { localStorage.setItem("rollthedice:dashboard:motion", motionPaused ? "paused" : "running"); }
    catch { /* The pause choice still applies to this document. */ }
  }
  syncMotion();
}
byId("dashboardMotion").addEventListener("click", () => setMotion(!motionPaused));
window.addEventListener("mission:motion", event => setMotion(Boolean(event.detail?.paused)));
motionQuery.addEventListener("change", () => { if (motionQuery.matches) setMotion(true, false); else syncMotion(); });
syncMotion();
overview({});
lifecycle.start();
lifecycle.initialize();
