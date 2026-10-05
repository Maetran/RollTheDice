import "./i18n/index.js";
import { escapeHtml, loadAuth } from "./shared/auth.js";
import { createAnalysisVisuals } from "./dashboard/analysis.js";
import { createGlobe } from "./dashboard/globe.js";

const REFRESH_MS = 30000;
const byId = id => document.getElementById(id);
const t = value => window.ZDWA_I18N?.t(value) || value;
const e = value => escapeHtml(String(value ?? ""));
const locale = () => window.ZDWA_I18N?.locale() || "de-CH";
const number = value => value == null ? "—" : new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Number(value) || 0);
const percent = value => value == null ? "—" : new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value);
const count = value => Math.max(0, Number(value) || 0);
const DESIGN_KEY = "rollthedice:dashboard:design";
function storedDesign() {
  try { return localStorage.getItem(DESIGN_KEY) === "lcars" ? "lcars" : "mission"; }
  catch { return "mission"; }
}
// Dashboard appearance is a local preference, separate from either game's skin.
document.body.dataset.dashboardDesign = storedDesign();
byId("dashboardDesign").value = document.body.dataset.dashboardDesign;
const gameName = game => game === "zilch" ? "Zilch" : game === "zdwa" ? "ZDWA" : t("Beide Spiele");
const gameBadge = game => game === "zdwa" || game === "zilch" ? `<span class="game-badge">${gameName(game)}</span>` : "";
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
};
const PAGE_LABELS = { "/": "Lobby", "/spiel": "Am Spieltisch", "/zuschauen": "Zuschauen", "/regeln": "Spielregeln", "/spieler": "Spieler & Ranking", "/rangabzeichen": "Rangabzeichen", "/bestenlisten": "Bestenlisten", "/historie": "Historie", "/statistiken": "Statistiken", "/erfolge": "Erfolge", "/offline": "Offline-Seite", "/ergebnis": "Spielergebnis", "/konto": "Konto" };
const MODE_LABELS = { "1": "Solo", "2": "Zu zweit", "3": "Zu dritt", "2v2": "Teamspiel", solo: "Solo", duo: "Zu zweit", trio: "Zu dritt", team: "Teamspiel", multiplayer: "Zu zweit", cpu: "Gegen den Würfelwirt", normal: "Normal", hardcore: "Hardcore" };

let latest = null;
let authReady = false;
let activeRequest = null;
let generation = 0;
let lastFetched = 0;
let disposed = false;
let refreshTimer = null;
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let motionPaused = motionQuery.matches || localStorage.getItem("rollthedice:dashboard:motion") === "paused";

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
  const totals = data.overview || {};
  const days = data.daily || [];
  const metrics = [
    { label: "Aktive Besuche", value: totals.live_sessions, hint: "Letzte 2 Minuten", live: true },
    { label: "Besuche", value: totals.sessions, hint: "Anonyme Tab-Sitzungen", series: "sessions", comparison: "sessions" },
    { label: "Seitenaufrufe", value: totals.page_views, hint: "Im gewählten Zeitraum", series: "page_views", comparison: "page_views" },
    { label: "Aktive Zeit", value: duration(totals.active_seconds), hint: "Sichtbar und aktiv", series: "active_seconds", comparison: "active_seconds" },
    { label: "Ø Zeit je Besuch", value: duration(totals.avg_active_seconds), hint: "Sichtbar und aktiv", series: "active_seconds", comparison: "avg_active_seconds" },
    { label: "Partien beendet", value: totals.completed_games, hint: "Gespeicherte Ergebnisse", series: "completed_games", comparison: "completed_games" },
  ];
  const comparison = metric => {
    const previous = data.comparison?.overview?.[metric.comparison];
    if (!previous) return "";
    if (metric.comparison !== "completed_games" && data.comparison?.previous_data_coverage !== "complete") return `<span class="metric-delta neutral">${e(t(data.comparison?.previous_data_coverage === "partial" ? "Vorperiode unvollständig" : "Keine Vergleichsbasis"))}</span>`;
    if (previous.change_percent == null) return `<span class="metric-delta neutral">${e(t("Vorperiode"))}: ${number(previous.previous)}</span>`;
    const change = Number(previous.change_percent) || 0;
    return `<span class="metric-delta ${change >= 0 ? "positive" : "negative"}"><span aria-hidden="true">${change >= 0 ? "↗" : "↘"}</span> ${change > 0 ? "+" : ""}${percent(change)}% <small>${e(t("zur Vorperiode"))}</small></span>`;
  };
  byId("overviewMetrics").innerHTML = metrics.map(metric => `<article class="metric-card"><p class="metric-label">${e(t(metric.label))}${metric.live ? '<span class="signal-dot" aria-hidden="true" style="margin-left:8px"></span>' : ""}</p><div class="metric-value">${metric.series === "active_seconds" ? e(metric.value) : number(metric.value)}</div><p class="metric-hint">${e(t(metric.hint))}</p>${comparison(metric)}${sparkline(metric.series ? days.map(day => count(day[metric.series])) : [])}</article>`).join("");
  byId("comparisonNote").textContent = data.comparison ? t("Heute (UTC) ist noch unvollständig. Verglichen wird mit den vorangehenden Kalendertagen; fehlende ältere Messwerte ergeben keinen Wachstumstrend.") : "";
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

function hourlyChart(rows = []) {
  if (!rows.some(row => count(row.page_views))) {
    byId("hourlyChart").innerHTML = empty();
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

function clientContext(data) {
  const modes = (data.app_modes || []).filter(row => count(row.sessions));
  const total = modes.reduce((sum, row) => sum + count(row.sessions), 0);
  if (!total) byId("appModeChart").innerHTML = empty();
  else {
    const pwa = modes.filter(row => row.app_mode === "pwa").reduce((sum, row) => sum + count(row.sessions), 0);
    const known = modes.some(row => row.app_mode === "pwa" || row.app_mode === "browser");
    const share = pwa / total * 100;
    const circumference = 2 * Math.PI * 44;
    byId("appModeChart").innerHTML = `<div class="launch-summary"><div class="launch-orbit" aria-hidden="true"><svg viewBox="0 0 110 110"><circle class="launch-orbit-track" cx="55" cy="55" r="44"/>${pwa ? `<circle class="launch-orbit-meter" cx="55" cy="55" r="44" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - share / 100)}"/>` : ""}</svg><span>${known ? `${percent(share)}<small>%</small>` : "—"}</span></div><div class="launch-copy"><strong>${e(t(known ? "Als PWA geöffnet" : "Startkontext unbekannt"))}</strong><p>${known ? `${number(pwa)} ${e(t("Besuche"))} · ${e(t("Anteil aller Besuche"))}` : e(t("Ältere Angaben bleiben unbekannt."))}</p></div></div><div class="launch-stack" aria-hidden="true">${modes.map(row => `<span class="launch-segment launch-${["pwa", "browser"].includes(row.app_mode) ? row.app_mode : "unknown"} rank-fill" style="width:${count(row.sessions) / total * 100}%"></span>`).join("")}</div>`;
  }
  ranks("appModeRanks", modes, "app_mode", "sessions", value => t(APP_MODE_LABELS[value] || "Unbekannt"), { share: true, limit: 3 });
  ranks("browserRanks", data.browsers, "browser", "sessions", value => t(BROWSER_LABELS[value] || "Unbekannt"), { share: true, limit: 9 });
  ranks("browserLanguageRanks", data.browser_languages, "browser_language", "sessions", browserLanguageName, { share: true, limit: 8 });
}

function countryName(value) {
  if (!value || value === "unknown" || value === "ZZ") return t("Unbekannt");
  try { return new Intl.DisplayNames([locale()], { type: "region" }).of(String(value).toUpperCase()) || value; } catch { return value; }
}

function pageLabel(value) {
  const path = String(value || "/");
  const normalized = path === "/zilch" ? "/" : path.replace(/^\/zilch\//, "/");
  return t(PAGE_LABELS[normalized] || "Andere Seite");
}

function pageRanks(rows = []) {
  if (!rows.length) { byId("pageRanks").innerHTML = empty(); return; }
  byId("pageRanks").innerHTML = `<div class="page-row head" aria-hidden="true"><span>${e(t("Seite"))}</span><span>${e(t("Aufrufe"))}</span><span>${e(t("Aktive Zeit"))}</span><span>${e(t("Ø je Besuch"))}</span></div><ol class="rank-list" style="gap:0">${rows.slice(0, 12).map(row => `<li class="page-row"><span class="page-label"><i class="page-bar" aria-hidden="true"></i><span>${e(pageLabel(row.page))}${gameBadge(row.game)}</span></span><span><span class="sr-only">${e(t("Aufrufe"))}: </span>${number(row.views)}</span><span><span class="sr-only">${e(t("Aktive Zeit"))}: </span>${e(duration(row.active_seconds))}</span><span><span class="sr-only">${e(t("Ø je Besuch"))}: </span>${e(duration(row.avg_active_seconds))}</span></li>`).join("")}</ol>`;
}

function gameCards(data) {
  const gameFilter = data.period?.game || "all";
  const games = gameFilter === "all" ? ["zdwa", "zilch"] : [gameFilter];
  byId("gameCards").innerHTML = games.map(game => {
    const row = data.games?.find(item => item.game === game) || {};
    return `<div class="game-card"><div class="game-card-header"><strong>${gameName(game)}</strong><span aria-hidden="true">${game === "zdwa" ? "⚄" : "⚅"}</span></div><div class="game-card-number">${number(row.completed_games || 0)}</div><p class="game-card-caption">${e(t("Partien beendet"))}</p><div class="game-card-details"><span>${e(t("Teilnahmen"))}<strong>${number(row.participants || 0)}</strong></span><span>${e(t("Ø Partiedauer"))}<strong>${e(duration(row.avg_duration_seconds))}</strong></span></div></div>`;
  }).join("");
  byId("gameModes").innerHTML = (data.modes || []).slice(0, 8).map(row => `<span class="mode-chip">${gameName(row.game)} · ${e(t(MODE_LABELS[row.mode] || "Anderer Modus"))}${row.hardcore ? " · Hardcore" : ""}<strong>${number(row.completed_games)}</strong></span>`).join("");
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
  overview(data);
  dailyChart(data);
  hourlyChart(data.hourly);
  ranks("referrerRanks", data.referrers, "source", "sessions", value => REFERRER_LABELS[value] ? t(REFERRER_LABELS[value]) : String(value || t("Andere Websites")), { share: true });
  ranks("deviceRanks", data.devices, "device", "sessions", value => t(DEVICE_LABELS[value] || "Unbekannt"), { share: true });
  ranks("deviceSoftwareRanks", data.device_software, "os", "sessions", value => t(OS_LABELS[value] || "Unbekannt"), { share: true, limit: 10 });
  ranks("deviceHardwareRanks", data.device_hardware, "device_family", "sessions", value => t(HARDWARE_LABELS[value] || "Unbekannt"), { share: true, limit: 10 });
  clientContext(data);
  ranks("countryRanks", data.countries, "country", "sessions", countryName, { share: true });
  byId("countryNote").textContent = t(["trusted_proxy", "cloudflare_verified_peer"].includes(data.collection?.country_source) ? "Länder stammen aus einem vertrauenswürdigen Geo-Proxy; unbekannte Herkunft bleibt unbekannt." : "Ohne vertrauenswürdigen Geo-Proxy bleibt die Herkunft unbekannt. Es gibt keine IP-Geolokalisierung.");
  pageRanks(data.pages);
  ranks("actionRanks", data.actions, "action", "count", value => t(ACTION_LABELS[value] || "Andere Bedienaktion"), { game: true, limit: 10 });
  gameCards(data);
  serverMetrics(data.server);
  analysis.update(data);
  globe.update(data.geography || data.countries || []);
  requestTraffic(data);
  syncMotion();
  const firstSeen = data.collection?.first_seen_at;
  byId("collectionNote").textContent = firstSeen ? `${t("Messwerte verfügbar seit")} ${timestamp(firstSeen)}` : t("Die Besuchsmessung beginnt mit diesem Release.");
  const dropped = count(data.collection?.dropped);
  byId("queueNote").hidden = !dropped && !data.collection?.cap_reached;
  byId("queueNote").textContent = data.collection?.cap_reached ? t("Die Ereignisgrenze ist erreicht. Ältere Messwerte werden entfernt; der Zeitraum kann unvollständig sein.") : `${t("Verworfene Ereignisse bei Überlastung")}: ${number(dropped)}. ${t("Diese Messung kann unvollständig sein.")}`;
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
  authReady = false;
  clearPrivateData();
  byId("dashboardData").hidden = true;
  byId("dashboardFilters").hidden = true;
  byId("dashboardLogin").href = "/zilch/anmelden?return_to=%2Fadmin%2Fdashboard";
  connection("Zugriff erforderlich", "warning");
  message(status === 401 ? "Bitte melde dich an, um Mission Control zu öffnen." : "Bitte den Gründer um Zugriff auf Mission Control.", { retry: false, login: status === 401 });
}

async function refresh() {
  if (!authReady || disposed) return;
  activeRequest?.abort();
  const requestGeneration = ++generation;
  const controller = new AbortController();
  activeRequest = controller;
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  byId("dashboardData").setAttribute("aria-busy", "true");
  byId("dashboardRefresh").disabled = true;
  if (!latest) connection("Verbindung wird aufgebaut …");
  try {
    const query = new URLSearchParams({ days: byId("dashboardDays").value, game: byId("dashboardGame").value });
    const response = await fetch(`/api/admin/analytics?${query}`, { cache: "no-store", signal: controller.signal });
    if (requestGeneration !== generation) return;
    if (response.status === 401 || response.status === 403) { denied(response.status); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (requestGeneration !== generation) return;
    latest = data;
    lastFetched = Date.now();
    byId("dashboardData").hidden = false;
    byId("dashboardMessage").hidden = true;
    render(data);
    connection("Telemetrie verbunden");
    byId("lastUpdated").textContent = `${t("Aktualisiert")}: ${timestamp(data.generated_at)}`;
  } catch {
    if (requestGeneration !== generation || disposed) return;
    connection("Verbindung unterbrochen", "warning");
    message(latest ? "Aktualisierung fehlgeschlagen. Die letzten Messwerte bleiben sichtbar. Bitte versuche es erneut." : "Das Dashboard konnte nicht geladen werden. Bitte versuche es erneut.");
    if (!latest) byId("lastUpdated").textContent = t("Keine Datenverbindung");
  } finally {
    clearTimeout(timeout);
    if (requestGeneration === generation) {
      activeRequest = null;
      byId("dashboardData").setAttribute("aria-busy", "false");
      byId("dashboardRefresh").disabled = false;
    }
  }
}

async function initialize() {
  authReady = false;
  const identityGeneration = generation;
  byId("dashboardRetry").disabled = true;
  try {
    const auth = await loadAuth({ refresh: true });
    if (disposed || identityGeneration !== generation) return;
    if (!auth?.authenticated) { denied(401); return; }
    if (!(auth.user?.is_founder || auth.user?.can_view_analytics || auth.user?.analytics_access)) { denied(403); return; }
    authReady = true;
    byId("dashboardFilters").hidden = false;
    await refresh();
  } catch {
    if (disposed) return;
    connection("Verbindung unterbrochen", "warning");
    message("Das Dashboard konnte nicht geladen werden. Bitte versuche es erneut.");
  } finally {
    byId("dashboardRetry").disabled = false;
  }
}

byId("dashboardFilters").addEventListener("submit", event => event.preventDefault());
byId("dashboardDays").addEventListener("change", refresh);
byId("dashboardGame").addEventListener("change", refresh);
byId("dashboardRefresh").addEventListener("click", refresh);
byId("dashboardRetry").addEventListener("click", () => authReady ? refresh() : initialize());
document.addEventListener("visibilitychange", () => {
  syncMotion();
  if (!document.hidden && Date.now() - lastFetched >= REFRESH_MS) refresh();
});
function startRefreshTimer() {
  if (refreshTimer !== null) return;
  refreshTimer = window.setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
}
window.addEventListener("pagehide", () => {
  disposed = true;
  authReady = false;
  generation += 1;
  activeRequest?.abort();
  activeRequest = null;
  clearInterval(refreshTimer);
  refreshTimer = null;
  latest = null;
  lastFetched = 0;
  clearPrivateData();
  // A restored document must verify its current permission before displaying
  // a cached snapshot, including when access was revoked on another page.
  byId("dashboardData").hidden = true;
});
window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  disposed = false;
  startRefreshTimer();
  initialize();
});

const analysis = createAnalysisVisuals({ t, e, number, percent, duration, gameName, pageLabel, locale });
const globe = createGlobe(byId("geographyViz"), { t, number, locale, countryName });
byId("dashboardDesign").addEventListener("change", event => {
  const design = event.target.value === "lcars" ? "lcars" : "mission";
  document.body.dataset.dashboardDesign = design;
  try { localStorage.setItem(DESIGN_KEY, design); } catch { /* This document can still switch designs. */ }
  globe.refreshDesign();
});
function clearPrivateData() {
  latest = null;
  analysis.resetSession();
  globe.clear();
  globe.suspend();
  for (const id of ["overviewMetrics", "comparisonNote", "dailyChart", "dailyTable", "dailySelection", "hourlyChart", "activityHeatmap", "heatmapSelection", "pageRanks", "pageBubbles", "pageDetail", "pageFocus", "journeyFlow", "journeyDetail", "journeyTable", "journeyFocus", "journeySample", "referrerRanks", "deviceRanks", "deviceSoftwareRanks", "deviceHardwareRanks", "deviceDonut", "appModeChart", "appModeRanks", "browserRanks", "browserLanguageRanks", "requestTrafficSummary", "requestCountryRanks", "requestStatusRanks", "requestAgentRanks", "requestChannelRanks", "requestRecordedAt", "requestDroppedNote", "countryRanks", "gameCards", "gameModes", "actionRanks", "serverGauges", "serverVitals", "queueNote", "collectionNote", "lastUpdated"]) byId(id).replaceChildren();
}
function syncMotion() {
  const paused = motionPaused || motionQuery.matches;
  document.documentElement.dataset.motion = paused || document.hidden || !authReady || disposed ? "paused" : "running";
  byId("dashboardMotion").setAttribute("aria-pressed", paused);
  byId("dashboardMotion").disabled = motionQuery.matches;
  byId("dashboardMotion").innerHTML = `<span aria-hidden="true">${paused ? "▷" : "Ⅱ"}</span><span>${e(t(motionQuery.matches ? "Reduzierte Bewegung aktiv" : paused ? "Animation fortsetzen" : "Animation pausieren"))}</span>`;
  globe.setPaused(paused);
  if (document.hidden || !authReady || disposed) globe.suspend(); else globe.resume();
}
function setMotion(paused, persist = true) {
  motionPaused = Boolean(paused);
  if (persist) localStorage.setItem("rollthedice:dashboard:motion", motionPaused ? "paused" : "running");
  syncMotion();
}
byId("dashboardMotion").addEventListener("click", () => setMotion(!motionPaused));
window.addEventListener("mission:motion", event => setMotion(Boolean(event.detail?.paused)));
motionQuery.addEventListener("change", () => { if (motionQuery.matches) setMotion(true, false); else syncMotion(); });
syncMotion();
overview({});
startRefreshTimer();
initialize();
