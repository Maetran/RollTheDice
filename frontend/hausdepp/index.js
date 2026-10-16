import { loadAuth, apiFetch, escapeHtml as esc } from "../shared/auth.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import { mountLobbyChat } from "../shared/lobby-chat.js";
import { initChat, addChatMessage } from "../room/chat.js";
import { HAUSDEPP_MESSAGES } from "../i18n/catalog.js";
import { cardArt } from "./cards.js";
import { prepareCardMotion, animateCardMotion, resetCardMotion } from "./motion.js";

const root = document.getElementById("hausdeppApp");
const page = root?.dataset.page || "lobby";
const gameId = decodeURIComponent(location.pathname.match(/\/hausdepp\/spiel\/([^/]+)/)?.[1] || "");
const spectating = location.pathname.endsWith("/zuschauen");
const ranks = ["6", "7", "8", "9", "U", "O", "K", "A", "10"];
let auth, socket, snapshot, reconnectTimer, lobbyTimer, pendingTimer;
let playerId = null, pending = false, stopped = false, tournamentEnding = false;
let commandInFlight = null, commandSequence = 0, peekSignature = "", peekTimer;
let tablesLoading = false, tablesSignature = "", accountLoading = false, accountCursor = null;
const accountRoundIds = new Set();
let accountProgress = null, acknowledgedProgressRevision = -1, achievementSearch = "", achievementStatus = "all", achievementCategory = "all";
const queuedCards = [];
const seenChat = new Set();
const $ = id => document.getElementById(id);
const lang = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
const t = (key, params = {}) => String(HAUSDEPP_MESSAGES[lang()][key] || key)
  .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
const counted = (key, count, params = {}) => t(count === 1 && HAUSDEPP_MESSAGES[lang()][`${key}One`] ? `${key}One` : key, { ...params, count });
const icon = (name, cls = "") => `<svg class="hd-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${{
  house: "M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7",
  switch: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
  chat: "M4 4h16v12H9l-5 4V4",
  cards: "M7 4h12v17H7zM4 17 2 3l11-1",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
}[name] || "M12 5v14M5 12h14"}"/></svg>`;

function cardName(card) {
  const [suit, rank] = card.split("-");
  return `${t(suit)} ${t(`rank${rank}`)}`;
}

function cardMarkup(card, { interactive = false, playable = false, committed = false, index = 0, count = 1 } = {}) {
  const art = cardArt(card);
  const offset = index - (count - 1) / 2;
  const angle = count > 1 ? offset / Math.max((count - 1) / 2, 1) * Math.min(14, count * 3.5) : 0;
  const drop = Math.pow(Math.abs(angle) / 14, 2) * 17;
  const attrs = `class="hausdepp-card ${playable ? "is-playable" : ""} ${committed ? "is-committed" : ""}" data-card-id="${esc(card)}" aria-label="${esc(cardName(card))}"`;
  return interactive
    ? `<button type="button" ${attrs} style="--card-index:${index};--fan-offset:${offset};--fan-angle:${angle}deg;--fan-drop:${drop}px" ${!playable || committed ? "disabled" : ""}>${art}</button>`
    : `<span ${attrs} role="img">${art}</span>`;
}

function opponentHand(player) {
  const count = Math.max(0, Math.min(36, Number(player.hand_count) || 0));
  const backs = Array.from({ length: count }, (_, index) => {
    const position = count > 1 ? index / (count - 1) : .5;
    const angle = count > 1 ? (position - .5) * Math.min(24, count * 7) : 0;
    return `<span class="hd-opponent-card" style="--back-position:${position};--back-angle:${angle}deg;--back-index:${index}"></span>`;
  }).join("");
  return `<div class="hd-opponent-hand" data-player-hand="${esc(player.id)}" data-card-count="${count}" style="--opponent-gaps:${Math.max(0, count - 1)}" aria-hidden="true">${backs}<span class="hd-seat-avatar">${esc(player.name.slice(0,1).toUpperCase())}</span></div>`;
}

function syncAttributes(element, next) {
  for (const attribute of [...element.attributes]) {
    if (!next.hasAttribute(attribute.name)) element.removeAttribute(attribute.name);
  }
  for (const attribute of next.attributes) {
    if (element.getAttribute(attribute.name) !== attribute.value) element.setAttribute(attribute.name, attribute.value);
  }
}

// Keep receiving card nodes alive across ACKs, chat updates and immediate plays.
function renderHand(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const next = template.content.firstElementChild;
  const container = $("hausdeppHand");
  let fan = container.firstElementChild;
  if (!fan) { container.append(next); return; }
  syncAttributes(fan, next);
  const existing = new Map([...fan.children].map(card => [card.dataset.cardId, card]));
  const nextCards = [...next.children];
  const retained = new Set(nextCards.map(card => card.dataset.cardId));
  for (const card of [...fan.children]) if (!retained.has(card.dataset.cardId)) card.remove();
  nextCards.forEach((nextCard, index) => {
    const card = existing.get(nextCard.dataset.cardId) || nextCard;
    syncAttributes(card, nextCard);
    if (fan.children[index] !== card) fan.insertBefore(card, fan.children[index] || null);
  });
}

function renderOpponents(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const container = $("hausdeppPlayers");
  const existing = new Map([...container.children].map(seat => [seat.dataset.playerId, seat]));
  const nextSeats = [...template.content.children];
  const retained = new Set(nextSeats.map(seat => seat.dataset.playerId));
  for (const seat of [...container.children]) if (!retained.has(seat.dataset.playerId)) seat.remove();
  nextSeats.forEach((nextSeat, index) => {
    const seat = existing.get(nextSeat.dataset.playerId) || nextSeat;
    if (seat !== nextSeat) {
      syncAttributes(seat, nextSeat);
      const hand = seat.firstElementChild;
      const nextHand = nextSeat.firstElementChild;
      syncAttributes(hand, nextHand);
      const backs = [...hand.querySelectorAll(".hd-opponent-card")];
      const nextBacks = [...nextHand.querySelectorAll(".hd-opponent-card")];
      backs.slice(nextBacks.length).forEach(card => card.remove());
      nextBacks.forEach((nextBack, backIndex) => {
        if (backs[backIndex]) syncAttributes(backs[backIndex], nextBack);
        else hand.insertBefore(nextBack, hand.lastElementChild);
      });
      hand.lastElementChild.textContent = nextHand.lastElementChild.textContent;
      // Only the public name/count labels change; the receiving fan stays mounted.
      for (const label of [...seat.children].slice(1)) label.remove();
      seat.append(...[...nextSeat.children].slice(1));
    }
    if (container.children[index] !== seat) container.insertBefore(seat, container.children[index] || null);
  });
}

function header() {
  $("hausdeppHeader").innerHTML = `<a class="hd-brand" href="/hausdepp">${icon("cards")}<span>Hausdepp</span></a>
    <nav class="hd-nav" aria-label="${esc(t("navigation"))}"><a href="/hausdepp" ${page === "lobby" ? 'aria-current="page"' : ""}>${t("lobby")}</a><a href="/hausdepp/regeln" ${page === "rules" ? 'aria-current="page"' : ""}>${t("rules")}</a><a href="/hausdepp/konto" ${page === "account" ? 'aria-current="page"' : ""}>${t("account")}</a><a href="/hausdepp/rangliste" ${page === "leaderboard" ? 'aria-current="page"' : ""}>${t("leaderboard")}</a></nav>
    <div class="hd-header-tools"><label class="hd-language"><span class="hd-sr">${t("language")}</span><select data-language-switcher aria-label="${t("language")}"><option value="de">DE</option><option value="en">EN</option></select></label><button type="button" data-game-switch class="hd-switch" aria-label="${t("switch")}">${icon("switch")}<span>${t("games")}</span></button></div>`;
  const language = $("hausdeppHeader").querySelector("select");
  language.value = lang();
  language.addEventListener("change", () => window.ZDWA_I18N.setLanguage(language.value));
  initializeAppMode({ mode: "hausdepp" });
}

function footer() {
  return `<footer class="hd-footer"><span>Hausdepp · ZDWA · Zilch</span><a href="/hausdepp/regeln#karten">${t("cardCredits")}</a></footer>`;
}

async function json(url, options) {
  const response = await apiFetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(t(response.status === 403 ? "accessDenied" : "requestFailed"));
  return result;
}

function renderLobby() {
  document.title = t("lobbyTitle");
  root.innerHTML = `<div class="hd-lobby-layout"><section class="hd-welcome"><h1>Hausdepp</h1><p class="hd-motto">${t("motto")}</p><p class="hd-intro">${t("intro")}</p><div class="hd-lobby-cards" aria-hidden="true">${["hearts-U", "acorns-A", "hearts-10"].map(card => cardMarkup(card)).join("")}</div><a class="hd-rules-link" href="/hausdepp/regeln">${t("learnRules")} ${icon("arrow")}</a></section>
    <section class="hd-create" aria-labelledby="hausdeppStartTitle"><h2 id="hausdeppStartTitle">${t("startTable")}</h2><p>${t("startHint")}</p><form id="hausdeppCreateForm"><label>${t("tableName")}<input name="name" value="${esc(t("defaultTable"))}" maxlength="64" required></label><div class="hd-form-row"><label>${t("totalPlayers")}<select name="players" aria-describedby="hausdeppSeatHint">${[2,3,4,5,6].map(n => `<option value="${n}">${n}</option>`).join("")}</select></label><label>${t("computers")}<select name="cpu_count" aria-describedby="hausdeppSeatHint">${[0,1,2,3,4,5].map(n => `<option value="${n}" ${n === 1 ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><fieldset class="hd-game-format"><legend>${t("gameFormat")}</legend><label><input name="tournament" type="radio" value="false" checked><span><strong>${t("singleRound")}</strong><small>${t("singleRoundHint")}</small></span></label><label><input name="tournament" type="radio" value="true"><span><strong>${t("tournament")}</strong><small>${t("tournamentHint")}</small></span></label></fieldset><div id="hausdeppSeatPreview" class="hd-seat-preview" aria-label="${t("seatPreview")}"></div><p id="hausdeppSeatHint" class="hd-fine" aria-live="polite">${t("cpuHint")}</p><button id="hausdeppCreate" class="hd-primary" type="submit">${t("takeSeat")} ${icon("arrow")}</button><p id="hausdeppCreateError" class="hd-error" role="alert"></p></form></section></div>
    <section class="hd-rounds" aria-labelledby="hausdeppTablesTitle"><div class="hd-section-heading"><h2 id="hausdeppTablesTitle">${t("yourTables")}</h2><button id="hausdeppRefresh" class="hd-text-button" type="button">${t("refresh")}</button></div><p id="hausdeppTablesError" class="hd-table-error" role="alert" hidden></p><div id="hausdeppRounds" aria-live="polite"><p>${t("loadingTables")}</p></div><a class="hd-history-link" href="/hausdepp/konto#runden">${t("openHistory")} ${icon("arrow")}</a></section><div id="hausdeppLobbyChat" class="hd-lobby-chat"></div>${footer()}`;
  const form = $("hausdeppCreateForm");
  const updateSeats = () => {
    const total = Number(form.elements.players.value);
    const cpu = Number(form.elements.cpu_count.value);
    for (const option of form.elements.cpu_count.options) option.disabled = Number(option.value) >= total;
    if (cpu >= total) form.elements.cpu_count.value = String(total - 1);
    const humans = total - Number(form.elements.cpu_count.value);
    $("hausdeppSeatHint").textContent = humans === 1 ? t("cpuHint") : t("humanHint", { count: humans });
    $("hausdeppSeatPreview").innerHTML = Array.from({ length: total }, (_, index) => `<span class="hd-seat-chip ${index === 0 ? "is-yours" : index >= humans ? "is-cpu" : "is-open"}"><span aria-hidden="true">${index === 0 ? esc(auth.user.username.slice(0,1).toUpperCase()) : index >= humans ? icon("cards") : "+"}</span>${esc(t(index === 0 ? "yourSeat" : index >= humans ? "computer" : "humanSeat"))}</span>`).join("");
  };
  form.elements.players.addEventListener("change", updateSeats);
  form.elements.cpu_count.addEventListener("change", updateSeats);
  updateSeats();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    $("hausdeppCreate").disabled = true;
    $("hausdeppCreate").setAttribute("aria-busy", "true");
    $("hausdeppCreate").textContent = t("creatingTable");
    $("hausdeppCreateError").textContent = "";
    try {
      const cpu = Number(form.elements.cpu_count.value);
      const result = await json("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.elements.name.value.trim(), mode: form.elements.players.value, game_type: "hausdepp", play_mode: cpu ? "cpu" : "multiplayer", cpu_count: cpu, tournament: form.elements.tournament.value === "true" }) });
      const id = result.id || result.game_id;
      if (!id) throw new Error(t("requestFailed"));
      location.assign(`/hausdepp/spiel/${encodeURIComponent(id)}`);
    } catch (error) {
      $("hausdeppCreateError").textContent = error.message;
      $("hausdeppCreate").disabled = false;
      $("hausdeppCreate").removeAttribute("aria-busy");
      $("hausdeppCreate").innerHTML = `${t("takeSeat")} ${icon("arrow")}`;
    }
  });
  $("hausdeppRefresh").addEventListener("click", refreshTables);
  mountLobbyChat($("hausdeppLobbyChat"), { context: "zdwa", initialAuth: auth });
  refreshTables();
  lobbyTimer = setInterval(refreshTables, 15000);
}

async function refreshTables() {
  if (stopped || tablesLoading || !$("hausdeppRounds")) return;
  tablesLoading = true;
  $("hausdeppRounds").setAttribute("aria-busy", "true");
  $("hausdeppRefresh").disabled = true;
  $("hausdeppRefresh").textContent = t("refreshing");
  try {
    const data = await json("/api/games?game_type=hausdepp");
    const games = Array.isArray(data) ? data : data.games || [];
    const sorted = [...games].sort((a,b) => tablePriority(a) - tablePriority(b) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    const signature = JSON.stringify(sorted);
    if (signature !== tablesSignature) {
      $("hausdeppRounds").innerHTML = sorted.length ? sorted.map(tableRow).join("") : `<div class="hd-empty"><p>${t("noTables")}</p><span>${t("noTablesHint")}</span></div>`;
      tablesSignature = signature;
    }
    $("hausdeppTablesError").hidden = true;
  } catch (error) {
    $("hausdeppTablesError").hidden = false;
    $("hausdeppTablesError").innerHTML = `${esc(error.message || t("tablesUnavailable"))} <button type="button" class="hd-text-button" id="hausdeppRetry">${t("retry")}</button>`;
    $("hausdeppRetry").addEventListener("click", refreshTables);
    if (!tablesSignature) $("hausdeppRounds").innerHTML = "";
  } finally {
    tablesLoading = false;
    $("hausdeppRounds")?.removeAttribute("aria-busy");
    if ($("hausdeppRefresh")) { $("hausdeppRefresh").disabled = false; $("hausdeppRefresh").textContent = t("refresh"); }
  }
}

function completedTable(game) {
  return Boolean(game.aborted || (game.finished && (!game.tournament || game.tournament.completed)));
}

function tablePriority(game) {
  return completedTable(game) ? 3 : game.my_player_id ? 0 : game.started ? 2 : 1;
}

function tableRow(game) {
  const participants = Array.isArray(game.participants) ? game.participants : [];
  const total = Math.max(2, Math.min(6, Number(game.expected_participants || game.expected || game.mode) || 2));
  const occupied = participants.length;
  const cpu = participants.filter(player => player.is_cpu).length;
  const completed = completedTable(game);
  const full = occupied >= total;
  const status = t(game.aborted ? "abortedTable" : game.finished ? game.tournament && !game.tournament.completed ? "roundBreak" : "finishedTable" : game.paused ? "pausedTable" : game.started ? "liveTable" : "waitingTable");
  const action = completed ? "openHistory" : game.my_player_id ? "continue" : game.started ? "watch" : full ? "fullTable" : "join";
  const url = completed ? "/hausdepp/konto#runden" : `/hausdepp/spiel/${encodeURIComponent(game.id || game.game_id)}${game.started && !game.my_player_id ? "/zuschauen" : ""}`;
  const seats = Array.from({ length: total }, (_, index) => {
    const player = participants[index];
    return `<li class="hd-table-seat ${player ? player.is_cpu ? "is-cpu" : "is-human" : "is-open"}" aria-label="${esc(`${t("seatNumber", { number: index + 1 })}: ${player ? `${player.name}${player.is_cpu ? `, ${t("computer")}` : ""}` : t("humanSeat")}`)}"><span aria-hidden="true">${player ? player.is_cpu ? icon("cards") : esc(player.name.slice(0,1).toUpperCase()) : "+"}</span><span>${player ? esc(player.name) : t("humanSeat")}</span></li>`;
  }).join("");
  return `<article class="hd-table-card" data-table-id="${esc(game.id || game.game_id)}"><div class="hd-table-card-heading"><h3>${esc(game.name || t("defaultTable"))}</h3><span class="hd-table-status ${game.started && !completed ? "is-live" : ""}">${status}</span></div><p class="hd-table-meta">${game.tournament ? `${t("tournamentRoundShort", { round: game.tournament.round_number })} · ` : ""}${t("seatSummary", { occupied, total })} · ${counted("humanCount", occupied - cpu)}${cpu ? ` · ${t("cpuCount", { count: cpu })}` : ""}</p><ul class="hd-table-seats">${seats}</ul><div class="hd-table-card-action">${full && !game.started && !game.my_player_id ? `<span>${t(action)}</span>` : `<a class="hd-round-row" href="${url}" aria-label="${esc(`${t("tableDetails", { name: game.name || t("defaultTable"), status, occupied, total })} ${t(action)}`)}">${t(action)} ${icon("arrow")}</a>`}</div></article>`;
}

function renderAccount() {
  document.title = `${t("accountTitle")} · Hausdepp`;
  root.innerHTML = `<div class="hd-account"><header class="hd-account-heading"><p class="hd-account-identity">${esc(t("signedInAs", { name: auth.user.username }))}</p><h1>${t("accountTitle")}</h1><p>${t("accountIntro")}</p><nav class="hd-account-shortcuts" aria-label="${t("accountContents")}"><a href="#fortschritt">${t("rankHeading")}</a><a href="#erfolge">${t("achievementCollection")}</a><a href="#runden">${t("historyHeading")}</a><a href="/hausdepp/rangliste">${t("leaderboard")}</a></nav></header><section id="fortschritt" class="hd-account-progression" aria-labelledby="hausdeppRankTitle"><div id="hausdeppProgressNotice" hidden></div><div id="hausdeppRank" aria-live="polite"><h2 id="hausdeppRankTitle">${t("rankHeading")}</h2><p>${t("progressLoading")}</p></div></section><section class="hd-account-overview" aria-labelledby="hausdeppAccountStatsTitle"><h2 id="hausdeppAccountStatsTitle">${t("accountStatsTitle")}</h2><div id="hausdeppAccountStats" aria-live="polite"><p>${t("accountLoading")}</p></div></section><section id="erfolge" class="hd-account-achievements" aria-labelledby="hausdeppAchievementsTitle"><div class="hd-section-heading"><div><p class="hd-account-kicker">${t("achievementsDirection")}</p><h2 id="hausdeppAchievementsTitle">${t("achievementCollection")}</h2></div><span id="hausdeppAchievementCount" class="hd-achievement-count"></span></div><p class="hd-account-muted">${t("achievementIntro")}</p><p class="hd-fine hd-achievement-rules">${t("achievementRules")}</p><div id="hausdeppAchievementControls" class="hd-achievement-controls" hidden><label class="hd-achievement-search">${t("searchAchievements")}<input id="hausdeppAchievementSearch" type="search" maxlength="120" placeholder="${t("achievementSearchHint")}" aria-controls="hausdeppAchievements"></label><label>${t("achievementStatus")}<select id="hausdeppAchievementStatus"><option value="all">${t("achievementAll")}</option><option value="unlocked">${t("achievementUnlocked")}</option><option value="locked">${t("achievementLocked")}</option></select></label><label>${t("achievementCategory")}<select id="hausdeppAchievementCategory"><option value="all">${t("allCategories")}</option>${achievementCategories.map(category => `<option value="${category}">${t(`category_${category}`)}</option>`).join("")}</select></label></div><p id="hausdeppAchievementResults" class="hd-fine" role="status"></p><div id="hausdeppAchievements"><p>${t("progressLoading")}</p></div><p class="hd-fine hd-achievement-privacy">${t("achievementPrivacy")}</p></section><section id="runden" class="hd-account-history" aria-labelledby="hausdeppHistoryTitle"><div class="hd-section-heading"><h2 id="hausdeppHistoryTitle">${t("historyHeading")}</h2><a href="/hausdepp">${t("lobby")} ${icon("arrow")}</a></div><p class="hd-account-muted">${t("historyIntro")}</p><div id="hausdeppHistory" aria-live="polite"></div><p id="hausdeppAccountError" class="hd-error" role="alert" hidden></p><button id="hausdeppHistoryMore" class="hd-secondary" type="button" hidden>${t("moreRounds")}</button><p id="hausdeppHistoryComplete" class="hd-fine" hidden>${t("historyComplete")}</p></section><section class="hd-account-settings" aria-labelledby="hausdeppSettingsTitle"><h2 id="hausdeppSettingsTitle">${t("accountSettings")}</h2><p>${t("accountSettingsHint")}</p><a class="hd-secondary" href="/konto#settings">${t("accountSettings")} ${icon("arrow")}</a></section><a class="hd-back-link" href="/hausdepp">${t("accountBack")} ${icon("arrow")}</a></div>${footer()}`;
  $("hausdeppHistoryMore").addEventListener("click", () => loadAccount({ more: true }));
  $("hausdeppAchievementSearch").addEventListener("input", event => { achievementSearch = event.target.value; renderAchievementCollection(); });
  $("hausdeppAchievementStatus").addEventListener("change", event => { achievementStatus = event.target.value; renderAchievementCollection(); });
  $("hausdeppAchievementCategory").addEventListener("change", event => { achievementCategory = event.target.value; renderAchievementCollection(); });
  void loadAccount();
}

const achievementCategories = ["participation", "community", "cut_gamble", "tens", "four", "tempo", "mishaps", "endgame", "comebacks", "style", "tournament"];
const localized = value => typeof value === "object" && value ? value[lang()] || value.de || value.en || "" : String(value ?? "");
const nonnegative = value => Math.max(0, Number(value) || 0);
const pointNumber = value => new Intl.NumberFormat(lang() === "en" ? "en-GB" : "de-CH").format(nonnegative(value));
const xp = value => t("experiencePoints", { points: pointNumber(value) });

function renderAccountProgress(data) {
  accountProgress = data;
  const scoring = data.scoring;
  const rank = data.rank;
  if (!scoring?.available || !rank) {
    $("hausdeppRank").innerHTML = `<h2 id="hausdeppRankTitle">${t("rankHeading")}</h2><p class="hd-account-muted">${t("progressUnavailable")}</p>`;
    $("hausdeppAchievements").innerHTML = `<p>${t("progressUnavailable")}</p>`;
    return;
  }
  const progress = rank.progress || {};
  const percent = Math.min(100, nonnegative(progress.percent));
  const current = nonnegative(scoring.points);
  const next = rank.next;
  const ladder = Array.isArray(data.ranks) ? data.ranks : [];
  $("hausdeppRank").innerHTML = `<div class="hd-rank-overview"><div class="hd-rank-identity"><p class="hd-account-kicker">${t("permanentRank")}</p><h2 id="hausdeppRankTitle" tabindex="-1">${esc(localized(rank.name))}</h2><p class="hd-rank-flavor">${esc(localized(rank.quote))}</p><span class="hd-rank-level">${t("rankLevel", { level: rank.level, total: ladder.length || 24 })}</span></div><div class="hd-xp-total"><strong>${esc(pointNumber(current))}</strong><span>${t("experienceLabel")}</span></div></div><div class="hd-rank-progress"><div class="hd-rank-progress-label"><span>${next ? esc(t("nextRank", { name: localized(next.name) })) : t("topRank")}</span><strong>${next ? esc(t("pointsRemaining", { points: pointNumber(nonnegative(next.threshold) - current) })) : t("topRankHint")}</strong></div><progress max="100" value="${next ? percent : 100}" aria-label="${esc(next ? t("rankProgressLabel", { name: localized(next.name), current: pointNumber(progress.current), target: pointNumber(progress.target) }) : t("topRank"))}"></progress></div><dl class="hd-xp-breakdown"><div><dt>${t("roundExperience")}</dt><dd>${esc(xp(scoring.round_points))}</dd></div><div><dt>${t("achievementExperience")}</dt><dd>${esc(xp(scoring.achievement_points))}</dd></div></dl><p class="hd-fine hd-xp-guide">${esc(t("experienceGuide", { points: scoring.round_reward || 10 }))}</p><details class="hd-rank-ladder"><summary>${t("viewRankLadder")}</summary><p class="hd-account-muted">${t("rankLadderHint")}</p><ol>${ladder.map(item => `<li class="${item.id === rank.id ? "is-current" : item.level < rank.level ? "is-reached" : ""}" ${item.id === rank.id ? 'aria-current="step"' : ""}><span class="hd-ladder-step" aria-hidden="true">${nonnegative(item.level)}</span><div><div class="hd-ladder-heading"><strong>${esc(localized(item.name))}</strong><span>${esc(xp(item.threshold))}${item.id === rank.id ? ` · ${t("currentRank")}` : ""}</span></div><p>${esc(localized(item.quote))}</p></div></li>`).join("")}</ol></details>`;
  $("hausdeppAchievementControls").hidden = false;
  $("hausdeppAchievementCount").textContent = t("achievementTotal", { count: data.achievements?.unlocked_count || 0, total: data.achievements?.total || 100 });
  renderAchievementCollection();
  renderProgressNotice($("hausdeppProgressNotice"), data);
}

function renderAchievementCollection() {
  const all = accountProgress?.achievements?.items;
  if (!Array.isArray(all)) return;
  const normalize = value => String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const search = normalize(achievementSearch.trim());
  const filtered = all.filter(item => (achievementStatus === "all" || Boolean(item.unlocked) === (achievementStatus === "unlocked")) && (achievementCategory === "all" || item.category === achievementCategory) && (!search || normalize(`${localized(item.name)} ${localized(item.description)} ${t(`category_${item.category}`)}`).includes(search)));
  const narrowed = Boolean(search || achievementStatus !== "all" || achievementCategory !== "all");
  const existingOpen = new Set([...$("hausdeppAchievements").querySelectorAll("details[open]")].map(element => element.dataset.category));
  $("hausdeppAchievementResults").textContent = t("achievementResults", { count: filtered.length, total: all.length });
  $("hausdeppAchievements").innerHTML = filtered.length ? achievementCategories.map(category => {
    const items = filtered.filter(item => item.category === category);
    if (!items.length) return "";
    const categoryUnlocked = all.filter(item => item.category === category && item.unlocked).length;
    return `<details class="hd-achievement-group" data-category="${category}" ${narrowed || existingOpen.has(category) || (!existingOpen.size && category === "participation") ? "open" : ""}><summary><span>${t(`category_${category}`)}</span><span class="hd-achievement-group-count">${categoryUnlocked} / ${all.filter(item => item.category === category).length}</span></summary><div class="hd-achievement-grid">${items.map(achievementMarkup).join("")}</div></details>`;
  }).join("") : `<div class="hd-achievement-empty"><p>${t("noAchievementsMatch")}</p><button id="hausdeppAchievementReset" class="hd-secondary" type="button">${t("resetAchievementFilters")}</button></div>`;
  $("hausdeppAchievementReset")?.addEventListener("click", () => {
    achievementSearch = ""; achievementStatus = "all"; achievementCategory = "all";
    $("hausdeppAchievementSearch").value = ""; $("hausdeppAchievementStatus").value = "all"; $("hausdeppAchievementCategory").value = "all";
    renderAchievementCollection(); $("hausdeppAchievementSearch").focus();
  });
}

function achievementMarkup(item) {
  const progress = item.progress || {};
  const current = Math.min(nonnegative(progress.current), Math.max(1, nonnegative(progress.target)));
  const target = Math.max(1, nonnegative(progress.target));
  return `<article class="hd-achievement-card ${item.unlocked ? "is-unlocked" : "is-locked"}" data-achievement-id="${esc(item.id)}"><div class="hd-achievement-card-top"><span class="hd-achievement-symbol" aria-hidden="true">${item.unlocked ? icon("check") : icon("cards")}</span><span class="hd-achievement-points">${esc(xp(item.points))}</span></div><h3>${esc(localized(item.name))}</h3><p>${esc(localized(item.description))}</p><div class="hd-achievement-card-bottom"><span class="hd-achievement-state">${t(item.unlocked ? "achievementEarned" : "achievementNotEarned")}</span>${item.unlocked && item.unlocked_at ? `<time datetime="${esc(item.unlocked_at)}">${esc(formatRoundDate(item.unlocked_at))}</time>` : `<span class="hd-achievement-fraction">${pointNumber(current)} / ${pointNumber(target)}</span>`}</div>${item.unlocked ? "" : `<progress max="${target}" value="${current}" aria-label="${esc(t("achievementProgressLabel", { name: localized(item.name), current: pointNumber(current), target: pointNumber(target) }))}"></progress>`}</article>`;
}

function renderProgressNotice(container, data) {
  const notice = data.presentation?.pending;
  if (!container) return;
  if (!notice || notice.revision <= acknowledgedProgressRevision) { container.hidden = true; return; }
  const rankUp = Boolean(notice.rank_up);
  const awards = (data.achievements?.items || []).filter(item => notice.achievement_ids?.includes(item.id));
  container.hidden = false;
  container.className = "hd-progress-notice";
  container.setAttribute("role", "status");
  container.innerHTML = `<p class="hd-account-kicker">${t(rankUp ? "rankUpLabel" : awards.length ? "newAchievements" : "newProgress")}</p><h3>${esc(rankUp ? localized(notice.message) || t("rankCongratulations") : t(awards.length ? "achievementCongratulations" : "roundCongratulations"))}</h3>${rankUp ? `<p class="hd-notice-new-rank">${esc(t("newRank", { name: localized(notice.to_rank?.name) }))}</p><p class="hd-notice-quote">${esc(localized(notice.quote || notice.to_rank?.quote))}</p>${nonnegative(notice.to_rank?.level) - nonnegative(notice.from_rank?.level) > 1 ? `<p class="hd-fine">${esc(t("ranksSkipped", { count: notice.to_rank.level - notice.from_rank.level }))}</p>` : ""}` : ""}<p class="hd-notice-reward">+${esc(xp(notice.points_earned))}${awards.length ? ` · ${esc(counted("newAchievementCount", awards.length))}` : ""}</p>${awards.length ? `<details><summary>${t("showNewAchievements")}</summary><ul>${awards.map(item => `<li><span>${esc(localized(item.name))}</span><strong>+${esc(xp(item.points))}</strong></li>`).join("")}</ul></details>` : ""}<button class="hd-primary" type="button" data-progress-ack>${t("continueProgress")}</button><p class="hd-notice-error" role="alert" hidden></p>`;
  container.querySelector("[data-progress-ack]").addEventListener("click", async event => {
    const button = event.currentTarget;
    const error = container.querySelector(".hd-notice-error");
    button.disabled = true; button.setAttribute("aria-busy", "true"); error.hidden = true;
    try {
      await json("/api/hausdepp/account/acknowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: notice.revision }) });
      acknowledgedProgressRevision = Math.max(acknowledgedProgressRevision, notice.revision);
      container.hidden = true;
      if (page === "account") $("hausdeppRankTitle")?.focus({ preventScroll: true });
      else $("hausdeppResult")?.querySelector(".hd-result-links a")?.focus({ preventScroll: true });
    } catch {
      error.textContent = t("progressAcknowledgeError"); error.hidden = false;
      button.disabled = false; button.removeAttribute("aria-busy");
    }
  });
}

let leaderboardRequest = 0;

function renderLeaderboard() {
  document.title = `${t("leaderboard")} · Hausdepp`;
  root.innerHTML = `<div class="hd-leaderboard"><header class="hd-account-heading"><p class="hd-account-identity">${t("leaderboardKicker")}</p><h1>${t("leaderboardTitle")}</h1><p>${t("leaderboardIntro")}</p></header><section class="hd-leaderboard-paper" aria-labelledby="hausdeppLeaderboardTitle"><div class="hd-section-heading"><h2 id="hausdeppLeaderboardTitle">${t("leaderboardWins")}</h2><label class="hd-leaderboard-filter">${t("leaderboardTableSize")}<select id="hausdeppLeaderboardSize"><option value="all">${t("allTableSizes")}</option>${[2,3,4,5,6].map(count => `<option value="${count}">${t("roundPeople", { count })}</option>`).join("")}</select></label></div><p id="hausdeppLeaderboardScoring" class="hd-account-muted">${t("leaderboardScoring")}</p><p class="hd-fine">${t("leaderboardPrivacy")}</p><p id="hausdeppLeaderboardStatus" class="hd-fine" role="status"></p><div id="hausdeppLeaderboardRows"><p>${t("leaderboardLoading")}</p></div><p id="hausdeppLeaderboardError" class="hd-error" role="alert" hidden></p></section><div class="hd-leaderboard-links"><a class="hd-primary" href="/hausdepp">${t("takeSeat")} ${icon("arrow")}</a><a href="/hausdepp/konto">${t("accountBackProfile")} ${icon("arrow")}</a></div></div>${footer()}`;
  $("hausdeppLeaderboardSize").addEventListener("change", loadLeaderboard);
  void loadLeaderboard();
}

async function loadLeaderboard() {
  const request = ++leaderboardRequest;
  const filter = $("hausdeppLeaderboardSize");
  const rows = $("hausdeppLeaderboardRows");
  const status = $("hausdeppLeaderboardStatus");
  rows.setAttribute("aria-busy", "true");
  status.textContent = t("leaderboardLoading");
  $("hausdeppLeaderboardError").hidden = true;
  try {
    const data = await json(`/api/hausdepp/leaderboard?limit=50${filter.value === "all" ? "" : `&players=${filter.value}`}`);
    if (stopped || request !== leaderboardRequest) return;
    const entries = Array.isArray(data.entries) ? data.entries : [];
    $("hausdeppLeaderboardScoring").textContent = data.win_definition ? `${localized(data.win_definition)} ${t("leaderboardTies")}` : t(data.ranking === "first_finishes" ? "leaderboardFirstScoring" : "leaderboardScoring");
    status.textContent = entries.length ? t("leaderboardCount", { shown: entries.length, total: nonnegative(data.total_players) }) : "";
    rows.innerHTML = entries.length ? `<table class="hd-leaderboard-table"><caption class="hd-sr">${t("leaderboardWins")}</caption><thead><tr><th scope="col">${t("leaderboardPlace")}</th><th scope="col">${t("leaderboardPlayer")}</th><th scope="col">${t("leaderboardWins")}</th><th scope="col">${t("roundsPlayed")}</th><th scope="col">${t("leaderboardWinRate")}</th></tr></thead><tbody>${entries.map(entry => `<tr ${entry.is_self ? 'class="is-self"' : ""}><td class="hd-leaderboard-place" data-label="${t("leaderboardPlace")}">${nonnegative(entry.place)}.</td><th scope="row" class="hd-leaderboard-name">${esc(entry.display_name || t("leaderboardUnknownPlayer"))}${entry.is_self ? `<span class="hd-self-tag">${t("yourSeat")}</span>` : ""}</th><td data-label="${t("leaderboardWins")}"><strong>${pointNumber(entry.wins)}</strong></td><td data-label="${t("roundsPlayed")}">${pointNumber(entry.rounds_played)}</td><td data-label="${t("leaderboardWinRate")}">${new Intl.NumberFormat(lang() === "en" ? "en-GB" : "de-CH", { maximumFractionDigits: 1 }).format(nonnegative(entry.win_rate))}%</td></tr>`).join("")}</tbody></table>` : `<div class="hd-account-empty"><p>${t("leaderboardEmpty")}</p><span>${t("leaderboardEmptyHint")}</span></div>`;
  } catch {
    if (stopped || request !== leaderboardRequest) return;
    status.textContent = "";
    if (!rows.querySelector("table")) rows.innerHTML = "";
    $("hausdeppLeaderboardError").hidden = false;
    $("hausdeppLeaderboardError").innerHTML = `${t("leaderboardError")} <button id="hausdeppLeaderboardRetry" class="hd-text-button" type="button">${t("retry")}</button>`;
    $("hausdeppLeaderboardRetry").addEventListener("click", loadLeaderboard);
  } finally {
    if (request === leaderboardRequest) rows.removeAttribute("aria-busy");
  }
}

function formatRoundDate(value) {
  const date = new Date(value || NaN);
  return Number.isNaN(date.getTime()) ? t("unknownDate") : new Intl.DateTimeFormat(lang() === "en" ? "en-GB" : "de-CH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function historyRow(round) {
  const isHausdepp = round.outcome === "hausdepp";
  const players = Array.isArray(round.participants) ? round.participants : [];
  return `<article class="hd-history-round" data-round-id="${esc(round.game_id)}"><div class="hd-history-round-heading"><div><time datetime="${esc(round.finished_at || "")}">${esc(formatRoundDate(round.finished_at))}</time><h3>${esc(round.name || t("defaultTable"))}</h3></div><span class="hd-outcome ${isHausdepp ? "is-hausdepp" : ""}">${t(isHausdepp ? "outcomeHausdepp" : "outcomeFinished")}</span></div><p class="hd-history-meta">${t("roundPeople", { count: Number(round.participant_count) || players.length })}${round.cpu_count ? ` · ${t("cpuCount", { count: round.cpu_count })}` : ""}${!isHausdepp && Number.isInteger(round.finished_position) ? ` · ${t("exitPosition", { position: round.finished_position })}` : ""}</p><details class="hd-history-players"><summary>${t("historyParticipants", { count: players.length })}</summary><ul>${players.map(player => `<li><span>${esc(player.name)}${player.is_cpu ? `<small>${t("computer")}</small>` : ""}</span><span>${t(player.outcome === "hausdepp" ? "outcomeHausdepp" : "outcomeFinished")}${player.outcome !== "hausdepp" && Number.isInteger(player.finished_position) ? ` · ${t("exitPosition", { position: player.finished_position })}` : ""}</span></li>`).join("")}</ul></details></article>`;
}

async function loadAccount({ more = false } = {}) {
  if (stopped || accountLoading || (more && !accountCursor)) return;
  accountLoading = true;
  const moreButton = $("hausdeppHistoryMore");
  const stats = $("hausdeppAccountStats");
  $("hausdeppHistory").setAttribute("aria-busy", "true");
  stats.setAttribute("aria-busy", "true");
  moreButton.disabled = true;
  $("hausdeppAccountError").hidden = true;
  try {
    const data = await json(`/api/hausdepp/account?limit=12${more ? `&before=${encodeURIComponent(accountCursor)}` : ""}`);
    if (stopped) return;
    renderAccountProgress(data);
    const values = data.statistics || {};
    stats.innerHTML = `<dl class="hd-account-stats">${[["roundsPlayed", values.rounds_played], ["roundsFinished", values.finished_rounds], ["roundsHausdepp", values.hausdepp_rounds]].map(([label, count]) => `<div><dt>${t(label)}</dt><dd>${Math.max(0, Number(count) || 0)}</dd></div>`).join("")}</dl>${values.last_finished_at ? `<p class="hd-fine">${esc(t("lastRound", { date: formatRoundDate(values.last_finished_at) }))}</p>` : ""}`;
    const rounds = data.history?.rounds || [];
    if (!more) { accountRoundIds.clear(); $("hausdeppHistory").innerHTML = ""; }
    for (const round of rounds) {
      if (accountRoundIds.has(round.game_id)) continue;
      accountRoundIds.add(round.game_id);
      $("hausdeppHistory").insertAdjacentHTML("beforeend", historyRow(round));
    }
    if (!accountRoundIds.size) $("hausdeppHistory").innerHTML = `<div class="hd-account-empty"><p>${t("noHistory")}</p><span>${t("noHistoryHint")}</span><a href="/hausdepp">${t("takeSeat")} ${icon("arrow")}</a></div>`;
    accountCursor = data.history?.next_cursor || null;
    moreButton.hidden = !accountCursor;
    $("hausdeppHistoryComplete").hidden = Boolean(accountCursor) || !accountRoundIds.size;
  } catch (error) {
    if (stopped) return;
    if (!more) {
      stats.innerHTML = "";
      if (!accountProgress) {
        $("hausdeppRank").innerHTML = `<h2 id="hausdeppRankTitle">${t("rankHeading")}</h2><p class="hd-account-muted">${t("progressLoadError")}</p>`;
        $("hausdeppAchievements").innerHTML = `<p>${t("progressLoadError")}</p>`;
      }
    }
    $("hausdeppAccountError").hidden = false;
    $("hausdeppAccountError").innerHTML = `${esc(t(more ? "historyMoreUnavailable" : "historyUnavailable"))} <button id="hausdeppAccountRetry" type="button" class="hd-text-button">${t("retry")}</button>`;
    $("hausdeppAccountRetry").addEventListener("click", () => loadAccount({ more }));
  } finally {
    accountLoading = false;
    moreButton.disabled = false;
    stats.removeAttribute("aria-busy");
    $("hausdeppHistory")?.removeAttribute("aria-busy");
  }
}

function renderTableShell() {
  document.body.classList.add("hd-playing");
  if (spectating) document.body.classList.add("hd-spectating");
  root.innerHTML = `<div class="hd-room-layout"><section id="hausdeppTable" class="hd-table" aria-label="${t("table")}"><div class="hd-room-heading"><div><h1 id="hausdeppRoomName">${t("defaultTable")}</h1><p id="hausdeppTournamentBanner" class="hd-tournament-banner" hidden></p></div><span id="hausdeppConnection" role="status">${t("connecting")}</span></div><div id="hausdeppPlayers" class="hd-seats"></div><div class="hd-centre"><div class="hd-stock-group"><button id="hausdeppStock" class="hd-card-back" type="button" disabled aria-label="${t("stock")}"></button><span id="hausdeppStockAction" class="hd-stack-action"></span><p id="hausdeppDrawAlert" class="hd-draw-alert" role="status" hidden>${t("mustDraw")}</p><span id="hausdeppStockCount"></span></div><div class="hd-pile-group"><button id="hausdeppPile" class="hd-pile" type="button" disabled aria-label="${t("pickup")}"></button><span id="hausdeppPileCount"></span></div><div class="hd-burned"><span id="hausdeppBurnedCount">0</span><span>${t("outOfPlay")}</span></div></div><p id="hausdeppStatus" class="hd-turn-status" role="status" aria-live="polite">${t("connecting")}</p><p id="hausdeppEvent" class="hd-event" aria-live="polite"></p><section class="hd-hand-region" aria-labelledby="hausdeppHandTitle"><div class="hd-hand-heading"><h2 id="hausdeppHandTitle">${t("yourHand")} <span id="hausdeppOwnPrefix" class="hd-tournament-prefix" hidden></span></h2><span id="hausdeppSelection"></span></div><div id="hausdeppHand" class="hd-hand"></div></section><div class="hd-actions"><p class="hd-action-guide">${t("stackActions")}</p></div><p id="hausdeppActionError" class="hd-action-error" role="alert"></p><details id="hausdeppPeek" class="hd-peek" hidden><summary>${t("peekTitle")}</summary><p id="hausdeppPeekText"></p><div id="hausdeppPeekCards" class="hd-peek-cards"></div><button id="hausdeppPeekContinue" type="button" hidden>${t("peekNext")}</button></details><section id="hausdeppResult" class="hd-result" aria-live="polite" hidden></section></section>
    <aside class="hd-social"><div class="hd-social-tools"><button id="chatToggle" type="button" aria-controls="chatPanel" aria-expanded="false">${icon("chat")} ${t("tableChat")} <span id="chatToggleCount" hidden></span></button><div class="hd-reactions" aria-label="${t("reactions")}">${["👍", "😂", "😮", "🎉"].map(emoji => `<button type="button" data-hausdepp-reaction="${emoji}" aria-label="${esc(t("reaction", { emoji }))}">${emoji}</button>`).join("")}</div></div><section id="chatPanel" class="hd-chat-panel" aria-label="${t("tableChat")}"><div class="chat-content" hidden><div class="hd-chat-heading"><h2>${t("tableChat")}</h2><button id="chatClose" type="button">${t("close")}</button></div><div id="chatBox" class="hd-chat-messages" role="log" aria-live="polite"></div><div class="hd-chat-compose"><label class="hd-sr" for="chatInput">${t("message")}</label><input id="chatInput" type="text" maxlength="400" placeholder="${t("message")}" autocomplete="off"><button id="chatSend" type="button">${t("send")}</button></div></div></section><a class="hd-social-rules" href="/hausdepp/regeln">${t("rules")} ${icon("arrow")}</a></aside></div><button id="chatBackdrop" class="hd-chat-backdrop" type="button" aria-label="${t("close")}" hidden></button>`;
  $("hausdeppTable").insertAdjacentHTML("afterbegin", `<section id="hausdeppWaiting" class="hd-waiting" aria-labelledby="hausdeppWaitingTitle" hidden><h2 id="hausdeppWaitingTitle">${t("waitingHeading")}</h2><p>${t("waitingBody")}</p><ul id="hausdeppWaitingSeats" class="hd-waiting-seats"></ul><p id="hausdeppWaitingCount" class="hd-waiting-count" role="status"></p><div class="hd-waiting-share"><button id="hausdeppCopyTable" type="button">${t("copyTable")}</button><p id="hausdeppCopyStatus" role="status"></p><label id="hausdeppCopyFallback" hidden>${t("copyTable")}<input id="hausdeppTableLink" type="text" readonly value="${esc(`${location.origin}/hausdepp/spiel/${encodeURIComponent(gameId)}`)}"></label></div><p class="hd-fine">${t("privateTableHint")}</p></section>`);
  $("hausdeppCopyTable").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("hausdeppTableLink").value);
      $("hausdeppCopyStatus").textContent = t("tableCopied");
    } catch {
      $("hausdeppCopyFallback").hidden = false;
      $("hausdeppTableLink").focus();
      $("hausdeppTableLink").select();
      $("hausdeppCopyStatus").textContent = t("tableCopyFailed");
    }
  });
  if (spectating) {
    $("hausdeppHandTitle").firstChild.textContent = `${t("watchingHand")} `;
    document.querySelector(".hd-action-guide").textContent = t("watching");
  }
  $("hausdeppStock").addEventListener("click", () => {
    const actions = snapshot?._hausdepp?.available_actions || [];
    command(actions.includes("peek") ? "peek" : actions.includes("draw") ? "draw" : "gamble");
  });
  $("hausdeppPeekContinue").addEventListener("click", () => command("peek"));
  $("hausdeppPile").addEventListener("click", () => command("pickup"));
  $("hausdeppHand").addEventListener("click", event => {
    const card = event.target.closest("button[data-card-id]")?.dataset.cardId;
    const s = snapshot?._hausdepp;
    if (!card || !s?.playable_cards?.includes(card) || queuedCards.includes(card) || commandInFlight?.cards?.includes(card)) return;
    if (pending) {
      if (!commandInFlight?.cards?.length || commandInFlight.cards[0].split("-")[1] !== card.split("-")[1]) return;
      queuedCards.push(card);
      renderState();
      return;
    }
    command(s.available_actions.includes("afterthrow") ? "afterthrow" : "play", [card]);
  });
  $("hausdeppHand").addEventListener("focusin", event => {
    const card = event.target.closest("button[data-card-id]");
    const hand = event.currentTarget;
    if (!card?.matches(":focus-visible")) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== card) return;
      // Native focus scrolling can miss the rotated edge of a fanned card.
      const bounds = hand.getBoundingClientRect();
      const edge = card.getBoundingClientRect();
      const left = bounds.left + 8, right = bounds.right - 8;
      if (edge.left < left) hand.scrollLeft -= left - edge.left;
      else if (edge.right > right) hand.scrollLeft += edge.right - right;
    });
  });
  for (const button of document.querySelectorAll("[data-hausdepp-reaction]")) button.addEventListener("click", () => send({ action: "send_emoji", emoji: button.dataset.hausdeppReaction }));
  connect();
}

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function receiveChat(item) {
  const key = JSON.stringify([item.from_id, item.sender, item.ts, item.text, item.kind]);
  if (seenChat.has(key)) return;
  seenChat.add(key);
  addChatMessage(item.sender, item.text, item);
}

function command(action, cards) {
  const allowed = action === "next_round" ? snapshot?._hausdepp_tournament?.can_start_next_round : snapshot?._hausdepp?.available_actions?.includes(action);
  if (pending || tournamentEnding || !allowed) return;
  pending = true;
  const commandId = `hd-${Date.now().toString(36)}-${++commandSequence}`;
  commandInFlight = { id: commandId, action, cards, acceptedVersion: null };
  $("hausdeppActionError").textContent = "";
  if (!send({ action: `hausdepp_${action}`, command_id: commandId, version: snapshot._hausdepp.version, ...(cards ? { cards } : {}) })) {
    resetCommand();
    $("hausdeppActionError").textContent = t("connectionLost");
  }
  renderState();
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { if (pending && $("hausdeppActionError")) $("hausdeppActionError").textContent = t("waitingConnection"); }, 8000);
}

function resetCommand() {
  pending = false;
  commandInFlight = null;
  queuedCards.length = 0;
  clearTimeout(pendingTimer);
}

function completeCommand() {
  if (!commandInFlight || commandInFlight.acceptedVersion === null || snapshot?._hausdepp?.version < commandInFlight.acceptedVersion) return;
  pending = false;
  commandInFlight = null;
  clearTimeout(pendingTimer);
  const s = snapshot._hausdepp;
  while (queuedCards.length) {
    const card = queuedCards.shift();
    if (!s.hand.includes(card) || !s.playable_cards?.includes(card)) continue;
    const action = s.available_actions.includes("afterthrow") ? "afterthrow" : s.available_actions.includes("play") ? "play" : null;
    if (action) { command(action, [card]); return; }
  }
  renderState();
}

function connect() {
  if (stopped) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws/${encodeURIComponent(gameId)}`);
  socket.addEventListener("open", () => {
    $("hausdeppConnection").textContent = t("connected");
    send({ action: spectating ? "spectate_game" : "join_game", name: auth.user.username });
    initChat(socket, { meName: auth.user.username });
    if (matchMedia("(min-width: 1100px)").matches && $("chatToggle").getAttribute("aria-expanded") !== "true") $("chatToggle").click();
  });
  socket.addEventListener("message", event => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.player_id) playerId = payload.player_id;
    if (payload.scoreboard) {
      snapshot = payload.scoreboard;
      if (!playerId && snapshot._hausdepp?.viewer_id) playerId = snapshot._hausdepp.viewer_id;
      for (const item of snapshot._chat_history || []) receiveChat(item);
      renderState();
      completeCommand();
    }
    if (commandInFlight && payload.hausdepp_command?.command_id === commandInFlight.id && payload.hausdepp_command.accepted) {
      commandInFlight.acceptedVersion = payload.hausdepp_command.version;
      completeCommand();
    }
    if (payload.chat) receiveChat(payload.chat);
    if (Array.isArray(payload.chat_history)) for (const item of payload.chat_history) receiveChat(item);
    if (payload.emoji) addChatMessage(payload.emoji.from, payload.emoji.emoji, { ...payload.emoji, kind: "reaction" });
    if (payload.error) {
      tournamentEnding = false;
      resetCommand();
      const code = payload.hausdepp_error?.code || payload.error;
      $("hausdeppActionError").textContent = t(code.includes("stale") ? "staleAction" : "actionRejected");
      renderState();
      if (payload.fatal) { stopped = true; socket.close(); }
    }
  });
  socket.addEventListener("close", event => {
    tournamentEnding = false;
    resetCommand();
    if ($("hausdeppConnection")) $("hausdeppConnection").textContent = t("connectionLost");
    renderState();
    resetCardMotion(gameId);
    if (!stopped && event.code !== 1008 && event.code !== 4001) reconnectTimer = setTimeout(connect, 1500);
    else if ($("hausdeppActionError")) $("hausdeppActionError").textContent = t("reconnectHint");
  });
}

function renderState() {
  const s = snapshot?._hausdepp;
  if (!s) { if (snapshot) renderWaiting(); return; }
  document.body.classList.remove("hd-waiting-room");
  $("hausdeppWaiting").hidden = true;
  const tournament = snapshot._hausdepp_tournament;
  if (snapshot._aborted) tournamentEnding = false;
  const dealer = s.players.find(player => player.id === tournament?.dealer_id);
  $("hausdeppTournamentBanner").hidden = !tournament;
  if (tournament) $("hausdeppTournamentBanner").textContent = t("tournamentRound", { round: tournament.round_number, name: dealer?.name || "…" });
  const ownLetters = tournament?.letters?.[playerId] || "";
  $("hausdeppOwnPrefix").hidden = !ownLetters;
  $("hausdeppOwnPrefix").textContent = ownLetters;
  $("hausdeppOwnPrefix").setAttribute("aria-label", t("tournamentLetters", { letters: ownLetters, losses: tournament?.losses?.[playerId] || 0 }));
  if (s.phase !== "finished") { $("hausdeppResult").hidden = true; delete $("hausdeppResult").dataset.roundId; }
  const motion = prepareCardMotion(s, { gameId, playerId });
  $("hausdeppTable").dataset.phase = s.phase;
  $("hausdeppRoomName").textContent = snapshot._name || t("defaultTable");
  document.title = `${snapshot._name || "Hausdepp"} · Hausdepp`;
  const connected = socket?.readyState === WebSocket.OPEN;
  const actions = connected && !snapshot._paused ? s.available_actions || [] : [];
  const playable = new Set(s.playable_cards || []);
  const hand = [...s.hand].sort((a,b) => ranks.indexOf(a.split("-")[1]) - ranks.indexOf(b.split("-")[1]) || a.localeCompare(b));
  const oldFocus = document.activeElement?.dataset.cardId;
  const committed = new Set([...(commandInFlight?.cards || []), ...queuedCards]);
  const pendingRank = commandInFlight?.cards?.[0]?.split("-")[1];
  renderHand(`<div class="hd-hand-fan" data-count="${hand.length}" style="--hand-count:${Math.max(1, hand.length)}">${hand.map((card, index) => cardMarkup(card, { interactive: true, playable: (actions.includes("play") || actions.includes("afterthrow")) && playable.has(card) && (!pending || card.split("-")[1] === pendingRank), committed: committed.has(card), index, count: hand.length })).join("")}</div>`);
  if (oldFocus) $("hausdeppHand").querySelector(`[data-card-id="${CSS.escape(oldFocus)}"]`)?.focus({ preventScroll: true });
  $("hausdeppSelection").textContent = s.phase === "peeking" ? "" : counted("cardsInHand", hand.length);
  const mine = s.players.find(p => p.id === playerId);
  const opponents = s.players.filter(p => p.id !== playerId);
  const refillPlayers = new Set((s.pending_refills || []).map(debt => debt.player_id));
  const stockBlocker = s.players.find(p => p.id === s.stock_blocked_by);
  const urgentDraw = Boolean(s.draw_urgent);
  $("hausdeppPlayers").dataset.count = String(opponents.length);
  renderOpponents(opponents.map((p, i) => `<div class="hd-seat ${p.id === s.current_player_id ? "is-active" : ""} ${p.finished ? "is-finished" : ""} ${refillPlayers.has(p.id) ? "needs-draw" : ""} ${p.id === s.stock_blocked_by ? "is-draw-blocker" : ""}" data-player-id="${esc(p.id)}" style="--seat:${i}" aria-label="${esc(`${p.name}: ${p.finished ? t("finished") : counted("cardsInHand", p.hand_count)}`)}">${opponentHand(p)}${tournament?.letters?.[p.id] ? `<b class="hd-tournament-prefix">${esc(tournament.letters[p.id])}</b>` : ""}<strong>${esc(p.name)}</strong><span>${p.finished ? `${icon("check")} ${t("finished")}` : counted("cardsInHand", p.hand_count)}</span>${p.is_cpu ? `<small>${t("computer")}</small>` : ""}</div>`).join(""));
  $("hausdeppStockCount").textContent = t(s.phase === "peeking" ? "undealtCount" : "stockCount", { count: s.deck_count });
  $("hausdeppStock").classList.toggle("is-empty", !s.deck_count);
  $("hausdeppStock").classList.toggle("is-peeking", s.phase === "peeking");
  $("hausdeppStock").closest(".hd-stock-group").classList.toggle("needs-draw", Boolean(s.draw_required));
  $("hausdeppStock").closest(".hd-stock-group").classList.toggle("is-draw-blocker", urgentDraw);
  $("hausdeppDrawAlert").hidden = !urgentDraw;
  $("hausdeppPile").innerHTML = s.discard.length ? s.discard.slice(-3).map(card => cardMarkup(card)).join("") : `<span class="hd-empty-pile">${t(s.phase === "peeking" ? "notDealt" : "tableClear")}</span>`;
  $("hausdeppPileCount").textContent = s.phase === "peeking" ? "" : t("pileCount", { count: s.discard.length });
  $("hausdeppPile").setAttribute("aria-label", s.discard.length ? t("pileLabel", { card: cardName(s.discard.at(-1)), count: s.discard.length }) : t("tableClear"));
  $("hausdeppBurnedCount").textContent = String(s.burned_count);
  const current = s.players.find(p => p.id === s.current_player_id);
  const peeker = s.players.find(p => p.id === s.peek?.player_id);
  const afterthrow = actions.includes("afterthrow");
  $("hausdeppStatus").textContent = snapshot._paused ? t("paused") : s.phase === "peeking" ? t(actions.includes("peek") ? "yourPeek" : "playerPeek", { name: peeker?.name || "…" }) : s.phase === "finished" ? t("roundFinished") : mine?.finished ? t("youFinished") : actions.includes("draw") ? t("drawHint") : afterthrow ? t("afterthrowHint") : current?.id === playerId ? t("yourTurn") : t("playerTurn", { name: current?.name || "…" });
  $("hausdeppStatus").classList.toggle("is-yours", actions.length > 0);
  const stockAction = actions.includes("peek") ? "peek" : actions.includes("draw") ? "draw" : "gamble";
  $("hausdeppStock").disabled = pending || !actions.includes(stockAction);
  $("hausdeppStock").setAttribute("aria-label", `${t(stockAction)}, ${t("stockCount", { count: s.deck_count })}`);
  $("hausdeppStockAction").textContent = stockBlocker ? t("stockWaiting", { name: stockBlocker.name }) : actions.includes(stockAction) ? t(stockAction) : "";
  if (stockBlocker) $("hausdeppStock").setAttribute("aria-label", t("stockWaiting", { name: stockBlocker.name }));
  $("hausdeppPile").disabled = pending || !actions.includes("pickup");
  $("hausdeppPeekContinue").hidden = !actions.includes("peek") || !s.private_peek?.length;
  $("hausdeppPeekContinue").disabled = pending;
  const e = s.last_event || {};
  const actor = s.players.find(p => p.id === e.player_id);
  const eventKey = s.phase === "peeking" ? "eventPeeking" : e.type === "draw" ? "eventDraw" : e.burn_reason ? actor?.finished ? "eventBurnFinished" : "eventBurn" : e.type === "pickup" || (e.type === "gamble" && !e.success) ? "eventPickup" : ["play", "afterthrow", "gamble"].includes(e.type) ? "eventPlay" : "eventStart";
  $("hausdeppEvent").textContent = counted(eventKey, e.drawn_count || e.picked_up_count || e.cards?.length || 0, { name: actor?.name || peeker?.name || "" });
  const known = s.peek?.success ? s.peek.cards : s.private_peek;
  const nextSignature = `${s.phase}:${JSON.stringify(known || [])}:${s.peek?.success}`;
  if (known?.length && nextSignature !== peekSignature) {
    peekSignature = nextSignature;
    clearTimeout(peekTimer);
    $("hausdeppPeek").hidden = false;
    $("hausdeppPeekText").textContent = t(s.peek?.success ? "peekSuccess" : s.phase === "peeking" ? "peekAce" : "peekPrivate");
    $("hausdeppPeekCards").innerHTML = known.map(card => cardMarkup(card)).join("");
    $("hausdeppPeek").open = true;
    if (s.phase !== "peeking") peekTimer = setTimeout(() => { if ($("hausdeppPeek")) $("hausdeppPeek").open = false; }, 4500);
  }
  animateCardMotion(s, { gameId, playerId }, motion);
  if (s.phase === "finished") {
    const loser = s.players.find(p => p.id === s.loser_id);
    const finalLoser = s.players.find(p => p.id === tournament?.tages_hausdepp_id);
    const roundKey = `${gameId}:${tournament?.round_number || 1}:${Boolean(tournament?.completed)}:${Boolean(tournament?.can_start_next_round)}:${Boolean(snapshot._aborted)}`;
    $("hausdeppResult").hidden = false;
    if ($("hausdeppResult").dataset.roundId === roundKey) {
      const next = $("hausdeppNextRound");
      if (next) next.disabled = pending || tournamentEnding || !connected || snapshot._paused;
      const end = $("hausdeppEndTournament");
      if (end) end.disabled = pending || tournamentEnding || !connected;
      return;
    }
    $("hausdeppResult").dataset.roundId = roundKey;
    const title = snapshot._aborted ? t("tournamentStopped") : tournament?.completed ? t("tournamentLoser", { name: finalLoser?.name || "…" }) : t("loser", { name: loser?.name || "…" });
    $("hausdeppResult").innerHTML = `<h2>${esc(title)}</h2><p>${t(snapshot._aborted ? "tournamentStoppedHint" : tournament ? tournament.completed ? "tournamentCompleteHint" : "tournamentRoundHint" : "resultHint")}</p>${tournament ? `<ul class="hd-tournament-score">${s.players.map(player => `<li class="${player.id === tournament.tages_hausdepp_id ? "is-hausdepp" : ""}"><span>${esc(player.name)}</span><strong aria-label="${esc(t("tournamentLetters", { letters: tournament.letters?.[player.id] || "", losses: tournament.losses?.[player.id] || 0 }))}">${esc(tournament.letters?.[player.id] || "—")}</strong><small>${nonnegative(tournament.losses?.[player.id])} / 8</small></li>`).join("")}</ul>` : ""}<div class="hd-result-links">${tournament && !tournament.completed && !snapshot._aborted ? tournament.can_start_next_round ? `<button id="hausdeppNextRound" class="hd-primary" type="button" ${pending || tournamentEnding || !connected || snapshot._paused ? "disabled" : ""}>${t("startNextRound", { round: nonnegative(tournament.round_number) + 1 })} ${icon("arrow")}</button><button id="hausdeppEndTournament" class="hd-secondary" type="button" ${pending || tournamentEnding || !connected ? "disabled" : ""}>${t("endTournament")}</button>` : `<p class="hd-tournament-wait">${t("tournamentHostWait")}</p>` : `<a class="hd-primary" href="/hausdepp">${t(tournament ? "newTournament" : "nextRound")} ${icon("arrow")}</a>`}<a href="/hausdepp/konto#erfolge">${t("accountProgressLink")}</a></div><div id="hausdeppRoundProgress" hidden></div>`;
    $("hausdeppNextRound")?.addEventListener("click", () => command("next_round"));
    $("hausdeppEndTournament")?.addEventListener("click", () => {
      if (!window.confirm(t("endTournamentConfirm"))) return;
      tournamentEnding = true;
      if (!send({ action: "end_game" })) {
        tournamentEnding = false;
        $("hausdeppActionError").textContent = t("connectionLost");
      }
      renderState();
    });
    if (!spectating) void loadRoundProgress(roundKey);
  }
}


async function loadRoundProgress(roundKey) {
  try {
    const data = await json("/api/hausdepp/account?limit=1");
    if (stopped || !$("hausdeppRoundProgress") || $("hausdeppResult").dataset.roundId !== roundKey) return;
    renderProgressNotice($("hausdeppRoundProgress"), data);
  } catch {
    // The final account link remains available when the summary cannot load.
  }
}

function renderWaiting() {
  document.body.classList.add("hd-waiting-room");
  $("hausdeppTable").dataset.phase = "waiting";
  $("hausdeppWaiting").hidden = false;
  $("hausdeppRoomName").textContent = snapshot._name || t("defaultTable");
  document.title = `${snapshot._name || "Hausdepp"} · Hausdepp`;
  const participants = snapshot._participants || [];
  const expected = Math.max(2, Math.min(6, Number(snapshot._expected) || 2));
  const humans = participants.filter(player => !player.is_cpu).length;
  const open = Math.max(0, Number(snapshot._expected_connections || expected) - humans);
  $("hausdeppWaitingCount").textContent = open ? counted("waitingCount", open) : t("waitingReady");
  $("hausdeppWaitingSeats").innerHTML = Array.from({ length: expected }, (_, index) => {
    const player = participants[index];
    return `<li class="${player ? "is-taken" : "is-open"}"><span class="hd-waiting-avatar" aria-hidden="true">${player ? player.is_cpu ? icon("cards") : esc(player.name.slice(0,1).toUpperCase()) : "+"}</span><strong>${player ? esc(player.name) : t("humanSeat")}</strong><small>${player ? player.is_cpu ? t("computer") : player.id === playerId ? t("yourSeat") : t("humanCountOne") : t("seatNumber", { number: index + 1 })}</small></li>`;
  }).join("");
}

function renderRules() {
  document.title = t("rulesTitle");
  const sections = [{ id: "ziel", key: "goal" }, { id: "kartenwerte", key: "deck" }, { id: "abheben", key: "peek", example: true }, { id: "austeilen", key: "deal" }, { id: "dein-zug", key: "moves", example: true }, { id: "abraeumen", key: "burn", example: true }, { id: "auffuellen", key: "refill", example: true }, { id: "nachwerfen", key: "after", example: true }, { id: "endspiel", key: "end", example: true }, { id: "taktik", key: "tips" }, { id: "punkte-erfolge", key: "scoring" }, { id: "turnier", key: "tournament" }];
  const rankLine = `<div class="hd-rank-line" aria-label="${t("rankOrder")}">${ranks.map(rank => `<span>${esc(t(`rank${rank}`))}</span>`).join("<b aria-hidden='true'>‹</b>")}</div>`;
  root.innerHTML = `<article class="hd-rulebook"><div class="hd-rulebook-heading"><h1>${t("rulesTitle")}</h1><p>${t("rulesIntro")}</p></div><section id="schnellstart" class="hd-rules-quickstart" aria-labelledby="hausdeppQuickstartTitle"><h2 id="hausdeppQuickstartTitle">${t("quickstartHeading")}</h2><ol>${["quickstartOne", "quickstartTwo", "quickstartThree"].map(key => `<li>${t(key)}</li>`).join("")}</ol></section><nav class="hd-rules-toc" aria-label="${t("rulesContents")}"><p>${t("rulesContents")}</p><ol>${sections.map(({ id, key }) => `<li><a href="#${id}">${t(`${key}Nav`)}</a></li>`).join("")}</ol></nav>${sections.map(({ id, key, example }) => `<section id="${id}" class="hd-rule-section" aria-labelledby="rule-${id}"><h2 id="rule-${id}">${t(`${key}Heading`)}</h2><p>${t(`${key}Body`)}</p>${key === "deck" ? rankLine : ""}${key === "scoring" ? `<a href="/hausdepp/konto#erfolge">${t("accountProgressLink")} ${icon("arrow")}</a>` : ""}${example ? `<aside class="hd-rule-example"><strong>${t("exampleLabel")}</strong><p>${t(`${key}Example`)}</p></aside>` : ""}</section>`).join("")}<section id="begriffe"><h2>${t("glossaryHeading")}</h2><ul class="hd-rules-glossary">${["glossaryStock", "glossaryPile", "glossaryClear", "glossaryFinish"].map(key => `<li>${t(key)}</li>`).join("")}</ul></section><section id="karten" class="hd-rule-credits"><h2>${t("cardCredits")}</h2><p>${t("creditsBody")} <a href="https://commons.wikimedia.org/wiki/File:Doppeldeutsche_Preference.JPG" target="_blank" rel="noopener noreferrer">FUZxxl / Karl432</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a> · <a href="https://commons.wikimedia.org/wiki/File:Original-Hungarian-Tell-set.jpg" target="_blank" rel="noopener noreferrer">SZERVÁC Attila</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a></p></section><a class="hd-primary" href="/hausdepp">${t("takeSeat")} ${icon("arrow")}</a></article>${footer()}`;
}

async function start() {
  try {
    auth = await loadAuth();
    if (!auth.authenticated || !(auth.game_access || auth.user?.game_access)?.hausdepp_preview) throw new Error(t("accessDenied"));
    header();
    document.querySelector('meta[name="description"]')?.setAttribute("content", t(page === "account" ? "accountMetaDescription" : page === "leaderboard" ? "leaderboardMetaDescription" : "metaDescription"));
    if (page === "rules") renderRules(); else if (page === "account") renderAccount(); else if (page === "leaderboard") renderLeaderboard(); else if (page === "table") renderTableShell(); else renderLobby();
    document.body.classList.remove("hd-loading");
  } catch (error) { root.innerHTML = `<section class="hd-unavailable"><h1>Hausdepp</h1><p role="alert">${esc(error.message || t("requestFailed"))}</p><a href="/">${t("backSuite")}</a></section>`; document.body.classList.remove("hd-loading"); }
}

window.addEventListener("pagehide", () => { stopped = true; clearInterval(lobbyTimer); clearTimeout(reconnectTimer); clearTimeout(pendingTimer); clearTimeout(peekTimer); socket?.close(); });
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void start();
