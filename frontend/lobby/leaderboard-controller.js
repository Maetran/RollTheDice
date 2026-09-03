import { dom, escapeHtml } from "./context.js";
import { playerNameMarkup } from "../shared/auth.js";

let activeTab = "normal";

function formatRelative(iso) {
  try {
    if (!iso) return "—";
    const difference = new Date() - new Date(iso);
    const minutes = Math.floor(difference / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
    if (hours > 0) return hours === 1 ? "vor 1 Stunde" : `vor ${hours} Stunden`;
    if (minutes > 0) return minutes === 1 ? "vor 1 Minute" : `vor ${minutes} Minuten`;
    return "gerade eben";
  } catch {
    return "—";
  }
}

function formatDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "—";
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)}`;
}

function gameViewLink(gameId) {
  return gameId
    ? `<a href="/ergebnis/${encodeURIComponent(gameId)}" class="leaderboard-view-link" aria-label="Spielansicht" title="Spielansicht">👁️</a>`
    : "—";
}

function playerNames(entry) {
  const links = Array.isArray(entry.linked_players) ? entry.linked_players : [];
  return String(entry.name ?? "—").split(", ").map((name) => {
    const player = links.find((candidate) => String(candidate.display_name) === name);
    return player
      ? `<a href="/spieler/${encodeURIComponent(player.username)}" class="player-profile-link">${playerNameMarkup(player, { name, compactRank: true })}</a>`
      : escapeHtml(name);
  }).join(", ");
}

function localizedNumber(value) {
  return new Intl.NumberFormat(window.ZDWA_I18N?.locale?.() || "de-CH", {
    maximumFractionDigits: 1,
  }).format(value);
}

function renderAverage(bucket, valueElement, trendElement) {
  const value = Number(bucket?.average_points);
  if (valueElement) valueElement.textContent = Number.isFinite(value) ? localizedNumber(value) : "—";
  if (!trendElement) return;

  const recentAverage = Number(bucket?.recent_average_points);
  const detail = Number(bucket?.trend_games) >= 3 && Number.isFinite(recentAverage)
    ? ` (Ø letzte 3: ${localizedNumber(recentAverage)})`
    : " (noch keine 3 Spiele)";
  const trends = {
    up: { text: "↑", className: "avg-trend avg-up", title: `Trend positiv${detail}` },
    down: { text: "↓", className: "avg-trend avg-down", title: `Trend negativ${detail}` },
    same: { text: "–", className: "avg-trend avg-same", title: `Trend stagnierend${detail}` },
  };
  const trend = trends[bucket?.trend] || {
    text: "–",
    className: "avg-trend avg-same",
    title: "Zu wenig Daten",
  };
  trendElement.textContent = trend.text;
  trendElement.className = trend.className;
  trendElement.title = trend.title;
  trendElement.setAttribute("aria-label", trend.title);
}

function renderRows(table, entries, { absolute = false, emptyText = "Keine Einträge" } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  table.innerHTML = rows.map((entry) => {
    const finishedAt = entry.finished_at || entry.ts;
    const date = absolute ? formatDate(finishedAt) : formatRelative(finishedAt);
    return `<tr${entry.hardcore ? ' class="hc-entry"' : ""}>
      <td>${date}</td>
      <td>${playerNames(entry)}</td>
      <td>${entry.points ?? "—"}</td>
      <td>${gameViewLink(entry.game_id)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">${emptyText}</td></tr>`;
}

export async function loadLeaderboard() {
  try {
    const response = await fetch("/api/leaderboard", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const stats = payload.stats || {};
    const averages = stats.average_points || {};
    dom.gamesPlayed.textContent = stats.games_played ?? 0;
    renderAverage(averages.normal, dom.averageNormalPoints, dom.averageNormalTrend);
    renderAverage(averages.hc, dom.averageHardcorePoints, dom.averageHardcoreTrend);

    const recent = payload.recent || { normal: [], hc: [] };
    const alltime = payload.alltime || { normal: [], hc: [] };
    const shame = payload.shame || { recent: [], alltime: [] };
    if (dom.alltimeBox) dom.alltimeBox.hidden = false;
    dom.recentBox?.classList.toggle("wide", activeTab === "last");

    if (activeTab === "shame") {
      if (dom.recentTitle) dom.recentTitle.textContent = "Hall of Shame (letzte 10 Tage)";
      if (dom.alltimeTitle) dom.alltimeTitle.textContent = "Hall of Shame Alltime";
      renderRows(dom.recentTable, shame.recent);
      renderRows(dom.alltimeTable, shame.alltime, { absolute: true });
    } else if (activeTab === "last") {
      if (dom.recentTitle) dom.recentTitle.textContent = "Letzte 10 Spiele";
      if (dom.alltimeBox) dom.alltimeBox.hidden = true;
      renderRows(dom.recentTable, payload.last_games);
      if (dom.alltimeTable) dom.alltimeTable.innerHTML = "";
    } else {
      const bucket = activeTab === "hc" ? "hc" : "normal";
      if (dom.recentTitle) dom.recentTitle.textContent = "Top 10 (letzte 7 Tage)";
      if (dom.alltimeTitle) dom.alltimeTitle.textContent = "Top 10 Alltime";
      renderRows(dom.recentTable, recent[bucket]);
      renderRows(dom.alltimeTable, alltime[bucket], { absolute: true });
    }
  } catch (error) {
    console.warn("Leaderboard konnte nicht geladen werden", error);
    if (dom.recentTable) {
      dom.recentTable.innerHTML = '<tr><td colspan="4" class="muted">Fehler beim Laden</td></tr>';
    }
    if (dom.alltimeTable) {
      dom.alltimeTable.innerHTML = '<tr><td colspan="4" class="muted">Fehler beim Laden</td></tr>';
    }
  }
}

function setActiveTab(tab) {
  activeTab = ["normal", "hc", "shame", "last"].includes(tab) ? tab : "normal";
  for (const [button, key] of [
    [dom.leaderboardNormalTab, "normal"],
    [dom.leaderboardHardcoreTab, "hc"],
    [dom.leaderboardShameTab, "shame"],
    [dom.leaderboardLastTab, "last"],
  ]) {
    button?.classList.toggle("active", activeTab === key);
  }
  void loadLeaderboard();
}

export function initializeLeaderboard() {
  dom.leaderboardNormalTab?.addEventListener("click", () => setActiveTab("normal"));
  dom.leaderboardHardcoreTab?.addEventListener("click", () => setActiveTab("hc"));
  dom.leaderboardShameTab?.addEventListener("click", () => setActiveTab("shame"));
  dom.leaderboardLastTab?.addEventListener("click", () => setActiveTab("last"));
  void loadLeaderboard();
  setInterval(loadLeaderboard, 10_000);
}
