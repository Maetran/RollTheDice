import "../i18n/index.js";
import { loadAuth, apiFetch, escapeHtml as esc } from "../shared/auth.js";
import { wattenAccountReturnPath } from "../multigame/routes.js";
import { initializeWattenPwa } from "./pwa.js";
import { WATTEN_PROGRESS_MESSAGES } from "../i18n/catalog.js";

initializeWattenPwa({ registerWorker: false, installControls: false });
const root = document.getElementById("wattenProgress");
const page = document.documentElement.dataset.wattenProgressPage;
const language = () => window.ZDWA_I18N.getLanguage() === "en" ? "en" : "de";
const t = (key, values = {}) => String(WATTEN_PROGRESS_MESSAGES[language()][key] ?? key)
  .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
const localText = value => value?.[language()] ?? "";
const date = value => new Intl.DateTimeFormat(language() === "de" ? "de-CH" : "en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich",
}).format(new Date(value));
const number = value => new Intl.NumberFormat(language() === "de" ? "de-CH" : "en-GB").format(value);
let accountId = null, epoch = 0, rankingSerial = 0, feedSerial = 0, feedPage = 1, data = null, history = [], navigating = false;
const controllers = new Set();

function clear() { epoch += 1; for (const controller of controllers) controller.abort(); controllers.clear(); root.replaceChildren(); }
function refresh() { if (navigating) return; navigating = true; clear(); location.reload(); }
window.addEventListener("zdwa:auth-state", event => {
  if (accountId !== null && (!event.detail?.authenticated || event.detail.user.id !== accountId)) refresh();
});
window.addEventListener("pagehide", clear);
window.addEventListener("pageshow", event => { if (event.persisted) refresh(); });
window.addEventListener("focus", () => { if (!navigating) void loadAuth({ refresh: true }).catch(() => undefined); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !navigating) void loadAuth({ refresh: true }).catch(() => undefined);
});

function navigation() {
  return `<nav class="wt-progress-tabs" aria-label="${esc(t("navigation"))}">${[
    ["progress", "/watten/konto/fortschritt"], ["history", "/watten/konto/verlauf"], ["leaderboard", "/watten/rangliste"],
  ].map(([key, url]) => `<a href="${url}"${page === key ? ' aria-current="page"' : ""}>${esc(t(key))}</a>`).join("")}</nav>`;
}

function shell(content) {
  root.innerHTML = `<h1>${esc(t(page))}</h1>${navigation()}
    <p class="wt-draft-note">${esc(t("draft"))}</p>
    <p class="wt-error" data-progress-error role="alert"></p>${content}`;
}

function failure(message = t("unavailable")) {
  if (navigating) return;
  root.querySelector("[data-progress-loading]")?.remove();
  const node = root.querySelector("[data-progress-error]");
  if (node) {
    node.textContent = message;
    const retry = document.createElement("button"); retry.type = "button";
    retry.dataset.progressAction = "retry"; retry.textContent = t("retry"); node.append(" ", retry);
  }
  else shell(`<section class="wt-card-panel"><p role="alert">${esc(message)}</p>
    <button type="button" data-progress-action="retry">${esc(t("retry"))}</button></section>`);
}

async function request(url, options = {}) {
  const current = epoch;
  const controller = new AbortController(); controllers.add(controller);
  const headers = new Headers(options.headers || {}); headers.set("X-Watten-Expected-Account-Id", String(accountId));
  try {
    const response = await apiFetch(url, { ...options, headers, cache: "no-store", signal: controller.signal });
    if (current !== epoch || navigating) return null;
    if (response.status === 401) { refresh(); return null; }
    if (response.status === 409) {
      const error = await response.json().catch(() => ({}));
      if (error.detail === "watten_account_changed") { refresh(); return null; }
      throw new Error(t("stale"));
    }
    if (!response.ok) throw new Error(t("unavailable"));
    const result = await response.json();
    await loadAuth({ refresh: true });
    if (current !== epoch || navigating) return null;
    const auth = await loadAuth({ refresh: true });
    if (current !== epoch || navigating) return null;
    if (!auth.authenticated || auth.user.id !== accountId) { refresh(); return null; }
    return result;
  } catch (error) {
    if (current !== epoch || navigating || error.name === "AbortError") return null;
    throw error;
  } finally { controllers.delete(controller); }
}

function statistic(label, value) {
  return `<div><dt>${esc(t(label))}</dt><dd>${esc(number(value))}</dd></div>`;
}

function progressMarkup(account) {
  const value = account.progress, stats = account.statistics;
  const title = value.title, next = value.next_title;
  return `<section class="wt-card-panel wt-progress-title" aria-labelledby="wattenCurrentTitle">
    <p class="wt-kicker">${esc(t("title"))}</p><h2 id="wattenCurrentTitle">${esc(localText(title.name))}</h2>
    <p><strong>${esc(number(value.total_xp))} XP</strong> · ${esc(t("level", { level: title.level }))}</p>
    ${next ? `<progress aria-label="${esc(t("nextTitle", { name: localText(next.name) }))}"
      max="${Math.max(1, next.threshold - title.threshold)}" value="${Math.max(0, value.total_xp - title.threshold)}"></progress>
      <p>${esc(t("remaining", { xp: number(value.xp_to_next), name: localText(next.name) }))}</p>` : `<p>${esc(t("highest"))}</p>`}
    <p class="wt-note">${esc(t("xpMeaning"))}</p>
    <dl class="wt-progress-stats">${statistic("matchXP", value.match_xp)}${statistic("achievementXP", value.achievement_xp)}
      ${statistic("allMatches", stats.all_matches)}${statistic("creditedMatches", stats.credited_matches)}${statistic("wins", stats.all_wins)}</dl>
    ${stats.uncredited_matches ? `<p class="wt-note">${esc(t("uncredited", { count: stats.uncredited_matches }))}</p>` : ""}
  </section>
  <section class="wt-card-panel wt-progress-pending" data-progress-pending>
    <h2>${esc(t("newMoments"))}</h2>${pendingMarkup(value)}
  </section>
  <section aria-labelledby="wattenAchievements"><h2 id="wattenAchievements">${esc(t("achievements"))}</h2>
    <p>${esc(t("achievementsHelp"))}</p><ul class="wt-achievement-grid">${value.achievements.map(item => `
      <li class="wt-card-panel${item.earned_at ? " is-earned" : ""}">
        <h3>${esc(localText(item.name))}</h3><p>${esc(localText(item.description))}</p>
        <progress value="${Math.min(item.progress, item.target)}" max="${item.target}" aria-label="${esc(localText(item.name))}"></progress>
        <p>${esc(t("achievementProgress", { current: number(item.progress), target: number(item.target) }))} · ${esc(number(item.draft_xp))} XP</p>
        ${item.earned_at ? `<p class="wt-note">${esc(t("earned", { date: date(item.earned_at), xp: number(item.granted_xp) }))}</p>` : ""}
      </li>`).join("")}</ul></section>
    ${value.archived_achievements.length ? `<section class="wt-card-panel"><h2>${esc(t("archived"))}</h2><ul>${value.archived_achievements.map(item =>
      `<li>${esc(localText(item.name))} · ${esc(t("earned", { date: date(item.earned_at), xp: number(item.granted_xp) }))}</li>`).join("")}</ul></section>` : ""}
    <section class="wt-card-panel" data-progress-feed aria-labelledby="wattenFeedTitle"><h2 id="wattenFeedTitle">${esc(t("feed"))}</h2><div data-progress-feed-entries></div></section>`;
}

function pendingMarkup(progress) {
  const pending = progress.pending;
  if (!pending.credits.length && !pending.achievements.length) return `<p>${esc(t("noNewMoments"))}</p>`;
  const matchXP = pending.credits.reduce((sum, item) => sum + item.xp, 0);
  const awardXP = pending.achievements.reduce((sum, item) => sum + item.xp, 0);
  const names = new Map(progress.achievements.filter(item => item.unlocked).map(item => [item.id, localText(item.name)]));
  return `<p>${esc(t("pendingMatches", { count: pending.credits.length, xp: number(matchXP) }))}</p>
    <p>${esc(t("pendingAwards", { count: pending.achievements.length, xp: number(awardXP) }))}</p>
    ${pending.achievements.length ? `<ul>${pending.achievements.map(item => `<li>${esc(names.get(item.id) || t("archivedAchievement"))} · ${esc(number(item.xp))} XP</li>`).join("")}</ul>` : ""}
    <button type="button" data-progress-action="acknowledge">${esc(t("acknowledge"))}</button>`;
}

function historyMarkup() {
  return `<section class="wt-card-panel"><p>${esc(t("historyHelp"))}</p><ol class="wt-match-history">${history.map(match => {
    const names = new Map(match.participants.map(item => [item.id, item.name]));
    return `<li data-progress-match="${esc(match.game_id)}"><h2>${esc(t(match.outcome === "won" ? "won" : "lost"))}</h2>
      <p><time datetime="${esc(match.finished_at)}">${esc(date(match.finished_at))}</time> · ${esc(t("players", { count: match.player_count }))}
        · ${esc(t("cpus", { count: match.cpu_count }))}</p>
      <ul>${match.scores.map(score => `<li><span translate="no">${esc(score.members.map(id => names.get(id)).join(" & "))}</span>: ${esc(number(score.points))}</li>`).join("")}</ul>
      <p class="wt-note">${esc(match.profile === "unknown" ? t("unknownProfile") : t(match.profile.blind ? "blind" : "open"))}</p></li>`;
  }).join("")}</ol>${!history.length ? `<p>${esc(t("emptyHistory"))}</p>` : ""}
  ${data.history.next_cursor ? `<button type="button" data-progress-action="more">${esc(t("more"))}</button>` : ""}</section>`;
}

function leaderboardForm() {
  return `<form class="wt-rank-filters" data-progress-ranking>
    <label>${esc(t("metric"))}<select name="metric"><option value="xp">${esc(t("xpMetric"))}</option><option value="wins">${esc(t("wins"))}</option><option value="win_rate">${esc(t("rate"))}</option></select></label>
    <label>${esc(t("playerCount"))}<select name="players"><option value="">${esc(t("all"))}</option>${[2, 3, 4].map(count => `<option value="${count}">${esc(t("players", { count }))}</option>`).join("")}</select></label>
    <label>${esc(t("opponents"))}<select name="opponents">${["all", "human", "cpu"].map(key => `<option value="${key}">${esc(t(key))}</option>`).join("")}</select></label>
    <button type="submit">${esc(t("apply"))}</button></form><div data-progress-ranking-result role="region" aria-label="${esc(t("leaderboard"))}"></div>`;
}

function rankingMarkup(result) {
  const row = item => `<tr${item.is_self ? ' class="is-own"' : ""}><td>${item.place ?? "—"}</td><th scope="row" translate="no">${esc(item.display_name)}${item.is_self ? ` <span class="wt-tag">${esc(t("you"))}</span>` : ""}</th>
    <td>${esc(number(result.metric === "win_rate" ? item.win_rate : item.value))}${result.metric === "win_rate" ? "%" : ""}</td><td>${esc(number(item.matches))}</td></tr>`;
  return `<p>${esc(localText(result.definition))}</p><p class="wt-note">${esc(localText(result.cohort_definition))}</p>${result.minimum_matches ? `<p class="wt-note">${esc(t("minimum", { count: result.minimum_matches }))}</p>` : ""}
    ${result.entries.length ? `<div class="wt-ranking-scroll"><table class="wt-ranking"><caption>${esc(t("ranked", { count: result.total_players }))}</caption>
      <thead><tr><th scope="col">${esc(t("place"))}</th><th scope="col">${esc(t("player"))}</th><th scope="col">${esc(t(result.metric === "xp" ? "xpMetric" : result.metric === "wins" ? "wins" : "rate"))}</th><th scope="col">${esc(t("allMatches"))}</th></tr></thead>
      <tbody>${result.entries.map(row).join("")}</tbody></table></div>` : `<p>${esc(t("emptyRanking"))}</p>`}
    ${result.own_entry && !result.entries.some(item => item.is_self) ? `<h3>${esc(t("ownPlace"))}</h3><table class="wt-ranking"><tbody>${row(result.own_entry)}</tbody></table>` : ""}`;
}

async function ranking(form) {
  const serial = ++rankingSerial;
  const metric = form.elements.metric.value;
  form.elements.players.disabled = metric === "xp";
  form.elements.opponents.disabled = metric === "xp";
  if (metric === "xp") { form.elements.players.value = ""; form.elements.opponents.value = "all"; }
  const query = new URLSearchParams({ metric, opponents: form.elements.opponents.value });
  if (form.elements.players.value) query.set("players", form.elements.players.value);
  form.querySelector("button").disabled = true;
  try {
    const result = await request(`/api/watten/leaderboard?${query}`);
    if (!result || serial !== rankingSerial) return;
    if (result.game_type !== "watten" || result.schema_version !== 1 || !result.coverage?.complete) throw new Error(t("unavailable"));
    root.querySelector("[data-progress-ranking-result]").innerHTML = rankingMarkup(result);
  } catch (error) { if (serial === rankingSerial && !navigating) failure(error.message); }
  finally { if (form.isConnected && serial === rankingSerial) form.querySelector("button").disabled = false; }
}

async function feed(requestedPage = feedPage) {
  const serial = ++feedSerial;
  let result;
  try { result = await request(`/api/watten/achievements/feed?page=${requestedPage}`); }
  catch (error) { if (serial === feedSerial && !navigating) failure(error.message); return; }
  if (!result || serial !== feedSerial) return;
  if (result.game_type !== "watten" || result.schema_version !== 1 || !result.coverage?.complete) throw new Error(t("unavailable"));
  const node = root.querySelector("[data-progress-feed-entries]"); if (!node) return;
  feedPage = requestedPage;
  node.innerHTML = `<p class="wt-note">${esc(t("feedHelp"))}</p>${result.entries.length ? `<ol class="wt-feed">${result.entries.map(item =>
    `<li><p><strong translate="no">${esc(item.player.display_name)}</strong>${item.player.is_self ? ` · ${esc(t("you"))}` : ""}
      · ${esc(localText(item.player.title.name))}</p><h3>${esc(localText(item.achievement.name))}</h3>
      <p>${esc(localText(item.achievement.description))}</p><p>${esc(number(item.achievement.actual_xp))} XP · <time datetime="${esc(item.reached_at)}">${esc(date(item.reached_at))}</time></p></li>`).join("")}</ol>` : `<p>${esc(t("emptyFeed"))}</p>`}
    <div class="wt-actions">${result.pagination.has_previous ? `<button type="button" data-progress-action="feed-previous">${esc(t("previous"))}</button>` : ""}
      ${result.pagination.has_next ? `<button type="button" data-progress-action="feed-next">${esc(t("next"))}</button>` : ""}</div>`;
}

root.addEventListener("submit", event => {
  if (!event.target.matches("[data-progress-ranking]")) return;
  event.preventDefault(); void ranking(event.target).catch(error => failure(error.message));
});
root.addEventListener("change", event => {
  if (event.target.name === "metric") void ranking(event.target.form).catch(error => failure(error.message));
});
root.addEventListener("click", async event => {
  const control = event.target.closest("[data-progress-action]");
  if (!control || control.disabled) return;
  if (control.dataset.progressAction === "retry") { refresh(); return; }
  control.disabled = true;
  try {
    if (control.dataset.progressAction.startsWith("feed-")) {
      await feed(feedPage + (control.dataset.progressAction === "feed-next" ? 1 : -1));
    } else if (control.dataset.progressAction === "more") {
      const result = await request(`/api/watten/account?before=${encodeURIComponent(data.history.next_cursor)}`);
      if (!result) return;
      validateAccount(result); data = result;
      const seen = new Set(history.map(item => item.game_id));
      history.push(...result.history.matches.filter(item => !seen.has(item.game_id)));
      shell(historyMarkup());
    } else if (control.dataset.progressAction === "acknowledge") {
      const result = await request("/api/watten/account/acknowledge", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation: data.progress.generation, through_sequence: data.progress.grant_sequence }) });
      if (result) await accountView();
    }
  } catch (error) { failure(error.message); }
  finally { if (control.isConnected) control.disabled = false; }
});

function validateAccount(result) {
  if (result.game_type !== "watten" || result.schema_version !== 1 || result.status !== "draft" || !result.coverage?.complete) throw new Error(t("unavailable"));
}
async function accountView() {
  const result = await request("/api/watten/account");
  if (!result) return;
  validateAccount(result); data = result; history = result.history.matches;
  shell(page === "history" ? historyMarkup() : progressMarkup(result));
  if (page === "progress") await feed();
}
async function mount() {
  const current = epoch;
  document.title = `${t(page)} · Watten`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("description"));
  const nav = document.querySelector("[data-watten-progress-nav]");
  if (nav) nav.innerHTML = `<a href="/watten">Lobby</a><a href="/watten/regeln">${esc(t("rules"))}</a><a href="/watten/konto/einstellungen">${esc(t("settings"))}</a>`;
  shell(`<p role="status" data-progress-loading>${esc(t("loading"))}</p>`);
  try {
    const auth = await loadAuth({ refresh: true });
    if (current !== epoch || navigating) return;
    if (!auth.authenticated) {
      const path = wattenAccountReturnPath(location.pathname) || "/watten";
      shell(`<section class="wt-card-panel"><p>${esc(t("signIn"))}</p><a class="wt-button" href="/watten/anmelden?return_to=${encodeURIComponent(path)}">${esc(t("signInButton"))}</a></section>`);
      return;
    }
    accountId = auth.user.id;
    if (page === "leaderboard") { shell(`<section class="wt-card-panel">${leaderboardForm()}</section>`); await ranking(root.querySelector("form")); }
    else await accountView();
  } catch (error) { if (current === epoch && !navigating) failure(error.message); }
}
if (root && ["progress", "history", "leaderboard"].includes(page)) void mount();
