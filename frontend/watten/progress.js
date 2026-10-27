import "../i18n/index.js";
import { loadAuth, apiFetch, escapeHtml as esc } from "../shared/auth.js";
import { wattenAccountReturnPath } from "../multigame/routes.js";
import { initializeWattenPwa } from "./pwa.js";
import { WATTEN_PROGRESS_MESSAGES } from "../i18n/catalog.js";
import { initializeSuiteHeader } from "../shell/header.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import { accountNavigationMarkup } from "../shared/account-navigation.js";
import { mountAccountMergeNotice } from "../shared/account-merge-notice.js";
import { initializeReleaseNotes } from "../shared/release-notes.js";

initializeWattenPwa({ registerWorker: document.documentElement.dataset.wattenPublicBeta === "true", installControls: false });
initializeSuiteHeader();
const root = document.getElementById("wattenProgress");
const page = document.documentElement.dataset.wattenProgressPage;
document.querySelector(`[data-watten-progress-nav] a[href="${page === 'leaderboard' ? '/watten/rangliste' : '/watten/konto/fortschritt'}"]`)?.setAttribute("aria-current", "page");
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
let achievementStatus = "all", achievementCategory = "all";

function clear() {
  epoch += 1; for (const controller of controllers) controller.abort(); controllers.clear();
  data = null; history = []; achievementStatus = "all"; achievementCategory = "all";
  root.replaceChildren();
}
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
  if (page !== 'leaderboard') return accountNavigationMarkup({ statistics: '/watten/konto/fortschritt#statistics', achievements: '/watten/konto/fortschritt#achievements', settings: '/watten/konto/einstellungen', current: page === 'progress' ? (location.hash === '#achievements' ? 'achievements' : 'statistics') : null })
    + `<nav class="wt-progress-tabs" aria-label="${esc(t("navigation"))}"><a href="/watten/konto/verlauf"${page === 'history' ? ' aria-current="page"' : ''}>${esc(t('history'))}</a><a href="/watten/rangliste">${esc(t('leaderboard'))}</a></nav>`;
  return `<nav class="wt-progress-tabs" aria-label="${esc(t("navigation"))}">${[
    ["progress", "/watten/konto/fortschritt"], ["history", "/watten/konto/verlauf"], ["leaderboard", "/watten/rangliste"],
  ].map(([key, url]) => `<a href="${url}"${page === key ? ' aria-current="page"' : ""}>${esc(t(key))}</a>`).join("")}</nav>`;
}

function shell(content) {
  root.innerHTML = `<h1>${esc(t(page))}</h1>${navigation()}
    ${page === 'leaderboard' ? '' : '<div data-account-merge-notice hidden></div>'}
    ${document.documentElement.dataset.wattenPublicBeta === "true" ? "" : `<p class="wt-draft-note">${esc(t("draft"))}</p>`}
    <p class="wt-error" data-progress-error role="alert"></p>${content}`;
  if (accountId !== null && page !== 'leaderboard') mountAccountMergeNotice(root.querySelector('[data-account-merge-notice]'), {
    userId: accountId, isCurrent: () => !navigating,
  });
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

function achievementItems(progress) {
  return progress.achievements.filter(item =>
    (achievementStatus === "all" || Boolean(item.unlocked) === (achievementStatus === "earned"))
    && (achievementCategory === "all" || item.category === achievementCategory));
}

function achievementMarkup(item, open = false) {
  const earned = Boolean(item.unlocked);
  return `<li id="${esc(item.id)}" class="wt-card-panel${earned ? " is-earned" : ""}">
    <details class="wt-achievement-detail"${open ? " open" : ""}>
      <summary><span class="wt-achievement-copy"><strong>${esc(localText(item.name))}</strong>
        <span class="wt-achievement-state"><span aria-hidden="true">${earned ? "✓" : "○"}</span> ${esc(t(earned ? "achievementEarned" : "achievementOpen"))}</span></span>
        <span class="wt-achievement-points">${esc(t(earned ? "creditedXP" : "rewardXP", { xp: number(earned ? item.granted_xp : item.draft_xp) }))}</span></summary>
      <div class="wt-achievement-body"><p>${esc(localText(item.description))}</p>
        <p class="wt-note">${esc(t(`category_${item.category || "other"}`))}</p>
        <progress value="${Math.min(item.progress, item.target)}" max="${item.target}" aria-label="${esc(localText(item.name))}"></progress>
        <p>${esc(t("achievementProgress", { current: number(item.progress), target: number(item.target) }))}</p>
        ${earned && item.earned_at ? `<p class="wt-achievement-earned"><time datetime="${esc(item.earned_at)}">${esc(t("earned", { date: date(item.earned_at), xp: number(item.granted_xp) }))}</time></p>` : ""}
      </div>
    </details></li>`;
}

function collectionMarkup(progress) {
  const earned = progress.achievements.filter(item => item.unlocked).length;
  const items = achievementItems(progress);
  return `<section class="wt-achievement-collection" aria-labelledby="wattenAchievements">
    <div class="wt-progress-section-heading"><h2 id="wattenAchievements">${esc(t("achievements"))}</h2>
      <span class="wt-collection-total">${esc(t("collectionTotal", { earned: number(earned), total: number(progress.achievements.length) }))}</span></div>
    <p class="wt-note">${esc(t("achievementsHelp"))}</p>
    <div class="wt-collection-controls"><div class="wt-collection-status" role="group" aria-label="${esc(t("collectionStatus"))}">
      ${["all", "earned", "open"].map(status => `<button type="button" data-achievement-status="${status}" aria-pressed="${achievementStatus === status}">${esc(t(`filter_${status}`))}</button>`).join("")}</div>
      <label class="wt-collection-category">${esc(t("collectionCategory"))}<select data-achievement-category aria-controls="wattenAchievementList">
        <option value="all">${esc(t("allCategories"))}</option>${progress.achievement_categories.map(category =>
          `<option value="${esc(category)}"${achievementCategory === category ? " selected" : ""}>${esc(t(`category_${category}`))}</option>`).join("")}</select></label>
      <button type="button" class="wt-collection-reset" data-achievement-reset${achievementStatus === "all" && achievementCategory === "all" ? " hidden" : ""}>${esc(t("resetFilters"))}</button></div>
    <p class="wt-collection-results" role="status" data-achievement-count>${esc(t("collectionResults", { count: number(items.length), total: number(progress.achievements.length) }))}</p>
    <ul id="wattenAchievementList" class="wt-achievement-grid" data-achievement-list>${items.map(item => achievementMarkup(item)).join("")}</ul>
    <p class="wt-collection-empty" data-achievement-empty${items.length ? " hidden" : ""}>${esc(t("emptyCollection"))}</p>
  </section>`;
}

function updateCollection() {
  if (navigating || page !== "progress" || !data) return;
  const list = root.querySelector("[data-achievement-list]"); if (!list) return;
  const resetFocused = document.activeElement === root.querySelector("[data-achievement-reset]");
  const open = new Set([...list.querySelectorAll("details[open]")].map(item => item.parentElement.id));
  const items = achievementItems(data.progress);
  list.innerHTML = items.map(item => achievementMarkup(item, open.has(item.id))).join("");
  root.querySelector("[data-achievement-count]").textContent = t("collectionResults", { count: number(items.length), total: number(data.progress.achievements.length) });
  root.querySelector("[data-achievement-empty]").hidden = items.length !== 0;
  root.querySelector("[data-achievement-reset]").hidden = achievementStatus === "all" && achievementCategory === "all";
  root.querySelectorAll("[data-achievement-status]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.achievementStatus === achievementStatus)));
  root.querySelector("[data-achievement-category]").value = achievementCategory;
  if (resetFocused && achievementStatus === "all" && achievementCategory === "all") root.querySelector('[data-achievement-status="all"]').focus();
}

function revealProgressAnchor() {
  syncAccountPanel();
  if (navigating || page !== "progress" || !data) return;
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  if (!id) return;
  if (data.progress.achievements.some(item => item.id === id)) {
    achievementStatus = "all"; achievementCategory = "all"; updateCollection();
  }
  const target = document.getElementById(id);
  if (!target || !root.contains(target)) return;
  const detail = target.querySelector(".wt-achievement-detail");
  if (detail) { detail.open = true; detail.querySelector("summary").focus({ preventScroll: true }); }
  target.scrollIntoView({ block: "center", behavior: "auto" });
}
window.addEventListener("hashchange", revealProgressAnchor);

function syncAccountPanel() {
  if (page !== 'progress') return;
  const id = location.hash.slice(1);
  const achievementTarget = data?.progress.achievements.some(item => item.id === id);
  const achievements = id === 'achievements' || Boolean(achievementTarget);
  for (const section of root.querySelectorAll(':scope > section')) {
    const collection = section.matches('.wt-achievement-collection, [data-progress-feed], [data-account-archived-achievements]');
    section.hidden = !section.matches('.wt-progress-title, .wt-progress-pending') && (achievements ? !collection : collection);
  }
  for (const link of root.querySelectorAll('[data-account-destination]')) {
    if (link.dataset.accountDestination === (achievements ? 'achievements' : 'statistics')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function favoriteOpponentsMarkup(opponents) {
  return `<section class="wt-card-panel wt-favorite-opponents" aria-labelledby="wattenFavoriteOpponents">
    <h2 id="wattenFavoriteOpponents">${esc(t("favoriteOpponents"))}</h2>
    <p class="wt-note">${esc(t("favoriteHelp"))}</p>
    ${opponents.length ? `<ul class="wt-favorite-list">${opponents.map(item => `<li>
      <strong translate="no">${esc(item.name)}</strong>
      <span class="wt-favorite-record">${esc(t("favoriteRecord", { wins: number(item.wins), losses: number(item.losses), draws: number(item.draws) }))}</span>
      <span class="wt-note">${esc(t("favoriteMatches", { count: number(item.matches) }))}</span>
    </li>`).join("")}</ul>` : `<p>${esc(t("favoriteEmpty"))}</p>`}
  </section>`;
}

function progressMarkup(account) {
  const value = account.progress, stats = account.statistics;
  const title = value.title, next = value.next_title;
  const pending = value.pending.credits.length || value.pending.achievements.length;
  return `<section class="wt-card-panel wt-progress-title" aria-labelledby="wattenCurrentTitle">
    <div class="wt-progress-heading"><div><p class="wt-kicker">${esc(t("title"))}</p><h2 id="wattenCurrentTitle">${esc(localText(title.name))}</h2>
      <p class="wt-note">${esc(t("titleLevel", { level: number(title.level), total: number(value.titles.length) }))}</p></div>
      <p class="wt-progress-total"><strong>${esc(number(value.total_xp))}</strong><span>${esc(t("totalXP"))}</span></p></div>
    <div class="wt-progress-next">${next ? `<p><strong>${esc(t("nextTitle", { name: localText(next.name) }))}</strong></p>
      <progress aria-label="${esc(t("nextTitle", { name: localText(next.name) }))}"
        max="${Math.max(1, next.threshold - title.threshold)}" value="${Math.max(0, value.total_xp - title.threshold)}"></progress>
      <p>${esc(t("remaining", { xp: number(value.xp_to_next), name: localText(next.name) }))}</p>` : `<p>${esc(t("highest"))}</p>`}</div>
    <dl class="wt-progress-stats wt-progress-xp">${statistic("matchXP", value.match_xp)}${statistic("achievementXP", value.achievement_xp)}</dl>
    <p class="wt-note">${esc(t("xpMeaning"))}</p>
    <details class="wt-title-ladder"><summary>${esc(t("allTitles", { count: number(value.titles.length) }))}</summary>
      <ol>${value.titles.map(item => `<li${item.level === title.level ? ' class="is-current" aria-current="step"' : item.level < title.level ? ' class="is-reached"' : ""}>
        <span class="wt-title-step" aria-hidden="true">${esc(number(item.level))}</span><div><strong>${esc(localText(item.name))}</strong>
          <span>${esc(t("titleThreshold", { xp: number(item.threshold) }))}${item.level === title.level ? ` · ${esc(t("currentTitle"))}` : ""}</span></div></li>`).join("")}</ol>
    </details>
    <dl class="wt-progress-stats wt-progress-match-stats">${statistic("allMatches", stats.all_matches)}${statistic("creditedMatches", stats.credited_matches)}${statistic("wins", stats.all_wins)}</dl>
    ${stats.uncredited_matches ? `<p class="wt-note">${esc(t("uncredited", { count: stats.uncredited_matches }))}</p>` : ""}
  </section>
  ${favoriteOpponentsMarkup(account.favorite_opponents || [])}
  <section class="wt-card-panel wt-progress-pending${pending ? "" : " is-empty"}" data-progress-pending>
    <h2>${esc(t("newMoments"))}</h2>${pendingMarkup(value)}
  </section>
  ${collectionMarkup(value)}
    ${value.archived_achievements.length ? `<section class="wt-card-panel" data-account-archived-achievements><h2>${esc(t("archived"))}</h2><ul>${value.archived_achievements.map(item =>
      `<li>${esc(localText(item.name))} · ${esc(t("earned", { date: date(item.earned_at), xp: number(item.granted_xp) }))}</li>`).join("")}</ul></section>` : ""}
    <section class="wt-card-panel" data-progress-feed aria-labelledby="wattenFeedTitle"><h2 id="wattenFeedTitle">${esc(t("feed"))}</h2><div data-progress-feed-entries></div></section>`;
}

function pendingMarkup(progress) {
  const pending = progress.pending;
  if (!pending.credits.length && !pending.achievements.length) return `<p>${esc(t("noNewMoments"))}</p>`;
  const matchXP = pending.credits.reduce((sum, item) => sum + item.xp, 0);
  const awardXP = pending.achievements.reduce((sum, item) => sum + item.xp, 0);
  const names = new Map(progress.achievements.filter(item => item.unlocked).map(item => [item.id, localText(item.name)]));
  return `<p>${esc(t(pending.credits.length === 1 ? "pendingMatch" : "pendingMatches", { count: pending.credits.length, xp: number(matchXP) }))}</p>
    <p>${esc(t(pending.achievements.length === 1 ? "pendingAward" : "pendingAwards", { count: pending.achievements.length, xp: number(awardXP) }))}</p>
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
  if (event.target.matches("[data-achievement-category]")) {
    achievementCategory = event.target.value; updateCollection(); return;
  }
  if (event.target.name === "metric") void ranking(event.target.form).catch(error => failure(error.message));
});
root.addEventListener("click", async event => {
  const filter = event.target.closest("[data-achievement-status], [data-achievement-reset]");
  if (filter) {
    achievementStatus = filter.dataset.achievementStatus || "all";
    if (filter.hasAttribute("data-achievement-reset")) achievementCategory = "all";
    updateCollection(); return;
  }
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
  if (page === "progress") { revealProgressAnchor(); await feed(); }
}
async function mount() {
  const current = epoch;
  document.title = `${t(page)} · Watten`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("description"));
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
    if (page !== 'leaderboard') initializeReleaseNotes({ context: 'watten' });
    if ((auth.game_access || auth.user.game_access)?.watten_preview === true || (auth.game_access || auth.user.game_access)?.watten_public === true) initializeAppMode({ mode: "watten" });
    if (page === "leaderboard") { shell(`<section class="wt-card-panel">${leaderboardForm()}</section>`); await ranking(root.querySelector("form")); }
    else await accountView();
  } catch (error) { if (current === epoch && !navigating) failure(error.message); }
}
if (root && ["progress", "history", "leaderboard"].includes(page)) void mount();
