import { loadAuth, apiFetch, escapeHtml as esc } from "../shared/auth.js";
import { avatarMarkup, initializeAvatarFallbacks, replaceChildrenPreservingAvatars } from "../shared/avatar.js";
import { renderAccountSettings } from "./settings.js";
import { mountProgressNotices } from "./progress-notices.js";
import { surpriseAchievementBadge } from "./surprise-achievement-badges.js";
import { createRematch, mountRematchInvitations, rematchError } from "./rematch.js";
import { renderTableDecor, presentTableProp, presentTableSurprise, cancelTableSurprises } from "./decor.js";
import { preserveNewerTableProps } from "./decor-sync.js";
import { renderTableAppearance } from "./surprise-state.js";
import { mountLobbyDemo } from "./lobby-demo.js";
import { invitationMarkup, mountInvitations } from "./invitations.js";
import { initializeGameViewport } from "../shared/game-viewport.js";
import { zdwaAppEntryUrl, hausdeppSignInUrl } from "../multigame/routes.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import { initializeSuiteHeader } from "../shell/header.js";
import { initializePushOptInPrompt } from "../shared/push-optin-prompt.js";
import { initializeReleaseNotes } from "../shared/release-notes.js";
import { mountAccountMergeNotice } from "../shared/account-merge-notice.js";
import { accountNavigationMarkup } from "../shared/account-navigation.js";
import { mountLobbyChat } from "../shared/lobby-chat.js";
import { initChat, addChatMessage } from "../room/chat.js";
import { HAUSDEPP_MESSAGES } from "../i18n/catalog.js";
import { cardArt, LOBBY_CARD_ASSET_URL, prepareCardAssets } from "./cards.js";
import { prepareCardMotion, animateCardMotion, cardMotionCompletion, resetCardMotion, presentShuffle, cancelShuffle, launchOwnPlay, launchedCards, cancelOwnPlay, presentedPile, pileMotionPending } from "./motion.js";
import { createGameTour } from "../shared/game-tours.js";
import { mountPileInspector } from "./pile-inspector.js";
import { mountPeekFeedback } from "./peek-feedback.js";
import { mountHandSelection } from "./hand-selection.js";
import { mountGameCreator } from "./game-creator.js";
import { mountReactions } from "./reactions.js";
import { storedTablePassword, rememberTablePassword, requestTablePassword } from "./table-access.js";
import { waitingControlsMarkup, waitingSeatMarkup, mountWaitingControls } from "./waiting-room.js";
import { createHausdeppVoice } from "./voice.js";
import { createVoiceSignaling } from "./voice-signaling.js";
import { mountHausdeppVoiceUI } from "./voice-ui.js";
import { createHausdeppSound } from "./sound.js";
import { mountHausdeppSoundUI } from "./sound-ui.js";
import { mountHausdeppDepartureUI } from "./departure-ui.js";
import { createVoiceTableLifecycle, queueVoiceTableLeft, showVoiceTableLeft } from "../shared/voice-table-lifecycle.js";

const root = document.getElementById("hausdeppApp");
const page = root?.dataset.page || "lobby";
let gameId = decodeURIComponent(location.pathname.match(/\/hausdepp\/spiel\/([^/]+)/)?.[1] || "");
let spectating = location.pathname.endsWith("/zuschauen");
const hausdeppBeginnerTour = createGameTour("hausdepp");
const ranks = ["6", "7", "8", "9", "U", "O", "K", "A", "10"];
let auth, socket, snapshot, reconnectTimer, lobbyTimer, pendingTimer, authUnavailable = false;
let playerId = null, pending = false, stopped = false, tournamentEnding = false;
let waitingLeaving = false, tableStopped = false, gameCreator, waitingControls;
let tablePassword, passwordRequest = false;
let requestedSurprise = null, requestedSurpriseRound = null;
let progressNotices, roundProgressReceipt, popupProgressPending = false;
let roundResultPresentation;
let pileInspector, peekFeedback;
let rematchInvitations, rematchCreating = false;
const rematchLifetime = new AbortController();
let tableLifetime = new AbortController(), viewportInitialized = false;
const tableCleanups = [];
let handSelection;
let commandInFlight = null, commandSequence = 0, autoRefillVersion = null;
let tablesLoading = false, tablesSignature = "", accountLoading = false, accountCursor = null, stopLobbyDemo, invitations;
const accountRoundIds = new Set();
let accountProgress = null, acknowledgedProgressRevision = -1, achievementSearch = "", achievementStatus = "all", achievementCategory = "all";
const queuedCards = [];
const seenChat = new Set();
const seenReactions = new Set(), visibleReactions = new Map();
let reactionObserver, reactionControls;
let voice, voiceUI, voiceLifecycle;
let sound, soundUI;
let departureUI;
const voiceSignaling = createVoiceSignaling({ send: data => send(data) });
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
  account: "M20 21v-2a6 6 0 0 0-12 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  out: "M8 3.5h9v15H8zM4.5 19.5l15-15",
}[name] || "M12 5v14M5 12h14"}"/></svg>`;

function cardName(card) {
  const [suit, rank] = card.split("-");
  return `${t(suit)} ${t(`rank${rank}`)}`;
}

function cardMarkup(card, { interactive = false, playable = false, committed = false, launched = false, selecting = false, selected = false, sameRank = false, index = 0, count = 1, atlasUrl } = {}) {
  const art = cardArt(card, atlasUrl);
  const offset = index - (count - 1) / 2;
  const angle = count > 1 ? offset / Math.max((count - 1) / 2, 1) * Math.min(14, count * 3.5) : 0;
  const drop = Math.pow(Math.abs(angle) / 14, 2) * 17;
  const attrs = `class="hausdepp-card ${playable ? "is-playable" : ""} ${committed ? "is-committed" : ""} ${launched ? "is-launched" : ""} ${selected ? "is-selected" : ""}" data-card-id="${esc(card)}" aria-label="${esc(cardName(card))}"${selecting ? ` aria-pressed="${selected}" aria-describedby="hausdeppMultiHint"` : ""}`;
  return interactive
    ? `<button type="button" ${attrs} data-same-rank="${sameRank}" style="--card-index:${index};--fan-offset:${offset};--fan-angle:${angle}deg;--fan-drop:${drop}px" ${!playable || committed ? "disabled" : ""}>${art}</button>`
    : `<span ${attrs} role="img">${art}</span>`;
}

// A real paper edge per remaining card makes the height change with the count.
// Stock layers carry backs only; the packet adds only its already-public faces.
function topRun(discard) {
  const rank = discard.at(-1)?.split("-")[1];
  let run = 0;
  for (let index = discard.length - 1; index >= 0 && discard[index].split("-")[1] === rank; index -= 1) run += 1;
  return run;
}

function renderStacks(state) {
  const stock = $("hausdeppStock"), pile = $("hausdeppPile");
  const count = Math.max(0, Math.min(36, Number(state.deck_count) || 0));
  if (stock.dataset.cardCount !== String(count)) {
    stock.dataset.cardCount = String(count);
    stock.innerHTML = Array.from({ length: count }, (_, index) =>
      `<span class="hd-stock-card" aria-hidden="true" style="--stack-layer:${count - index - 1}"></span>`).join("");
  }
  pile.dataset.cardCount = String(state.discard.length);
  const edges = Math.max(0, state.discard.length - 3);
  // Equal ranks on top fan out slightly, so their count reads at a glance.
  const run = topRun(state.discard);
  pile.dataset.run = String(run);
  const signature = JSON.stringify([state.phase, state.discard]);
  if (pile.dataset.renderSignature === signature) return;
  pile.dataset.renderSignature = signature;
  pile.innerHTML = state.discard.length
    ? Array.from({ length: edges }, (_, index) => `<span class="hd-pile-edge" aria-hidden="true" style="--stack-layer:${state.discard.length - index - 1}"></span>`).join("") +
      state.discard.slice(-3).map((card, index, cards) => {
        const depth = cards.length - index - 1;
        return `<span class="hd-pile-face"${run > 1 && depth < run ? ` data-run-step="${depth}"` : ""} style="--stack-layer:${depth};--run-step:${depth}">${cardMarkup(card)}</span>`;
      }).join("")
    : `<span class="hd-empty-pile">${t(state.phase === "peeking" ? "notDealt" : "tableClear")}</span>`;
}

function renderPileState(s, actions, busy, measureOnly = false) {
  renderStacks(s);
  const burnedStack = $("hausdeppBurnedStack");
  const burnedCards = Math.min(6, Math.max(0, Number(s.burned_count) || 0));
  if (burnedStack.childElementCount !== burnedCards) burnedStack.innerHTML = Array.from({ length: burnedCards }, (_, index) => `<i class="hd-burned-card" style="--burn-angle:${[-12, 8, -3, 15, -8, 3][index]}deg;--burn-x:${[-3, 4, 0, -4, 3, 1][index]}px;--burn-y:${[-1, -3, 1, -2, -4, 0][index]}px"></i>`).join("");
  burnedStack.classList.toggle("is-empty", !burnedCards);
  if (measureOnly) return;
  $("hausdeppPileCount").textContent = s.phase === "peeking" ? "" : counted("cardsInHand", s.discard.length);
  $("hausdeppPileAction").textContent = s.phase === "peeking" ? "" : t(!busy && actions.includes("pickup") && s.discard.length ? "pickup" : "pileTitle");
  const sameOnTop = topRun(s.discard);
  $("hausdeppPile").setAttribute("aria-label", s.discard.length ? `${t(!busy && actions.includes("pickup") ? "pileLabel" : "pileInspectLabel", { card: cardName(s.discard.at(-1)), count: s.discard.length })}${sameOnTop > 1 ? `. ${t("pileRun", { count: sameOnTop })}` : ""}` : t("tableClear"));
  $("hausdeppBurnedCount").textContent = String(s.burned_count);
  $("hausdeppBurnedUnit").textContent = t(Number(s.burned_count) === 1 ? "cardWordOne" : "cardWord");
  pileInspector.update(s.discard);
  $("hausdeppPile").disabled = !s.discard.length;
  $("hausdeppPile").dataset.pickupAvailable = String(!busy && actions.includes("pickup"));
}

function seatIdentity(player, selfId = playerId) {
  const publicPlayer = snapshot?._players?.find(item => item.id === player.id);
  const userId = player.user_id ?? publicPlayer?.user_id ?? (player.id === selfId ? auth.user.id : null);
  return { ...player, user_id: userId };
}

function seatAvatar(player, { key = `seat-${player.id}`, selfId = playerId, size = "small" } = {}) {
  return player.is_cpu ? icon("cards") : avatarMarkup(seatIdentity(player, selfId), { size, avatarKey: key });
}

function opponentHand(player) {
  const count = Math.max(0, Math.min(36, Number(player.hand_count) || 0));
  const backs = Array.from({ length: count }, (_, index) => {
    const position = count > 1 ? index / (count - 1) : .5;
    const angle = count > 1 ? (position - .5) * Math.min(24, count * 7) : 0;
    return `<span class="hd-opponent-card" style="--back-position:${position};--back-angle:${angle}deg;--back-index:${index}"></span>`;
  }).join("");
  return `<div class="hd-opponent-hand" data-player-hand="${esc(player.id)}" data-card-count="${count}" style="--opponent-gaps:${Math.max(0, count - 1)}" aria-hidden="true">${backs}<span class="hd-seat-avatar">${seatAvatar(player)}</span></div>`;
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
  const existing = new Map([...fan.children].map(card => [card.dataset.cardId, card]));
  // Layout positions only (offsetLeft ignores the fan's own transforms).
  const before = new Map([...existing].map(([id, card]) => [id, card.offsetLeft]));
  syncAttributes(fan, next);
  const nextCards = [...next.children];
  const retained = new Set(nextCards.map(card => card.dataset.cardId));
  for (const card of [...fan.children]) if (!retained.has(card.dataset.cardId)) card.remove();
  nextCards.forEach((nextCard, index) => {
    const card = existing.get(nextCard.dataset.cardId) || nextCard;
    syncAttributes(card, nextCard);
    if (fan.children[index] !== card) fan.insertBefore(card, fan.children[index] || null);
  });
  if (existing.size === nextCards.length && nextCards.every(card => existing.has(card.dataset.cardId))) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Remaining cards close or open the gap smoothly instead of jumping.
  for (const [id, left] of before) {
    const card = existing.get(id);
    const shift = card.isConnected ? left - card.offsetLeft : 0;
    if (Math.abs(shift) < 1) continue;
    card.animate?.([{ translate: `${shift}px 0` }, { translate: "0 0" }],
      { duration: 240, easing: "cubic-bezier(.16,1,.3,1)", composite: "add" });
  }
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
      syncAttributes(hand.lastElementChild, nextHand.lastElementChild);
      replaceChildrenPreservingAvatars(hand.lastElementChild, nextHand.lastElementChild.innerHTML);
      // Only the public name/count labels change; the receiving fan stays mounted.
      for (const label of [...seat.children].slice(1)) label.remove();
      seat.append(...[...nextSeat.children].slice(1));
    }
    if (container.children[index] !== seat) container.insertBefore(seat, container.children[index] || null);
  });
}

function header() {
  const identity = auth?.authenticated && auth.user;
  $("hausdeppHeader").innerHTML = `<a class="hd-brand" href="/hausdepp" aria-label="Hausdepp"><img src="/static/icons/hausdepp-icon-192-v2.png" width="36" height="36" alt=""><span>Hausdepp</span></a>
    <nav class="hd-nav" aria-label="${esc(t("navigation"))}"><a href="/hausdepp" ${page === "lobby" ? 'aria-current="page"' : ""}>${t("lobby")}</a><a href="/hausdepp/rangliste" ${page === "leaderboard" ? 'aria-current="page"' : ""}>${window.ZDWA_I18N.t("Spieler & Ranking")}</a><a href="/hausdepp/regeln" ${page === "rules" ? 'aria-current="page"' : ""}>${t("rules")}</a><a href="/hausdepp/konto/einstellungen" ${["account", "settings"].includes(page) ? 'aria-current="page"' : ""}>${t("account")}</a></nav>
    <div class="hd-header-tools"><a class="hd-profile-button" href="${identity ? "/hausdepp/konto/einstellungen#profilbild" : signInUrl()}" aria-label="${esc(identity ? t("editProfile", { name: identity.username }) : t("signIn"))}" title="${esc(identity ? t("editProfile", { name: identity.username }) : t("signIn"))}">${identity ? avatarMarkup(identity, { size: "small", avatarKey: "header-self" }) : icon("account")}</a><label class="hd-language"><span class="hd-sr">${t("language")}</span><select data-language-switcher aria-label="${t("language")}"><option value="de">DE</option><option value="en">EN</option></select></label><button type="button" data-game-switch class="hd-switch" aria-label="${t("switch")}">${icon("switch")}<span>${t("games")}</span></button></div>`;
  const language = $("hausdeppHeader").querySelector("select");
  language.value = lang();
  language.addEventListener("change", () => window.ZDWA_I18N.setLanguage(language.value));
  initializeAppMode({ mode: "hausdepp" });
  initializeSuiteHeader();
  voiceUI?.attach();
  soundUI?.attach();
}

function signInUrl({ register = false } = {}) {
  const destination = page === "rules" ? "/hausdepp" : `${location.pathname}${location.hash}`;
  return hausdeppSignInUrl(destination, { register });
}

function accountSettingsUrl() {
  return "/hausdepp/konto/einstellungen";
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
  gameCreator?.destroy();
  const renderCard = card => cardMarkup(card, { atlasUrl: LOBBY_CARD_ASSET_URL });
  document.title = t("lobbyTitle");
  root.innerHTML = `<div class="hd-lobby-layout"><section class="hd-welcome"><h1>Hausdepp</h1><p class="hd-motto">${t("motto")}</p><p class="hd-intro">${t("intro")}</p><div class="hd-lobby-cards" aria-hidden="true">${["hearts-U", "acorns-A", "hearts-10"].map(renderCard).join("")}</div><a class="hd-rules-link" href="/hausdepp/regeln">${t("learnRules")} ${icon("arrow")}</a></section>
    <section class="hd-create" aria-labelledby="hausdeppStartTitle"></section></div>
    <section class="hd-rounds" aria-labelledby="hausdeppTablesTitle"><div class="hd-section-heading"><h2 id="hausdeppTablesTitle">${t("yourTables")}</h2><button id="hausdeppRefresh" class="hd-text-button" type="button">${t("refresh")}</button></div><p id="hausdeppTablesError" class="hd-table-error" role="alert" hidden></p><div id="hausdeppRounds" aria-live="polite"><p>${t("loadingTables")}</p></div><a class="hd-history-link" href="/hausdepp/konto#runden">${t("openHistory")} ${icon("arrow")}</a></section><div id="hausdeppLobbyChat" class="hd-lobby-chat"></div>${footer()}`;
  stopLobbyDemo = mountLobbyDemo(root.querySelector(".hd-lobby-cards"), renderCard);
  if (!auth.authenticated) {
    root.querySelector(".hd-create").innerHTML = `<h2 id="hausdeppStartTitle">${t("publicJoinTitle")}</h2><p>${t("publicJoinBody")}</p><div class="hd-onboarding-actions"><a id="hausdeppSignIn" class="hd-primary" href="${signInUrl()}">${t("signIn")} ${icon("arrow")}</a><a id="hausdeppRegister" class="hd-secondary" href="${signInUrl({ register: true })}">${t("createAccount")}</a></div><p class="hd-fine">${t("sharedAccountHint")}</p>${authUnavailable ? `<p class="hd-error" role="status">${t("authUnavailable")}</p>` : ""}`;
    root.querySelector(".hd-rounds").remove();
    $("hausdeppLobbyChat").remove();
    return;
  }
  gameCreator = mountGameCreator(root.querySelector(".hd-create"), { user: auth.user, t, language: lang });
  $("hausdeppRefresh").addEventListener("click", refreshTables);
  mountLobbyChat($("hausdeppLobbyChat"), { context: "hausdepp", initialAuth: auth });
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
      replaceChildrenPreservingAvatars($("hausdeppRounds"), sorted.length ? sorted.map(tableRow).join("") : `<div class="hd-empty"><p>${t("noTables")}</p><span>${t("noTablesHint")}</span></div>`);
      tablesSignature = signature;
      invitations?.sync();
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
  const full = occupied >= total && game.can_join !== true;
  const status = t(game.aborted ? "abortedTable" : game.finished ? game.tournament ? game.tournament.completed ? "tournamentComplete" : "roundBreak" : "finishedTable" : game.paused ? "pausedTable" : game.started ? "liveTable" : "waitingTable");
  const action = completed ? "openHistory" : game.my_player_id ? "continue" : game.started ? "watch" : full ? "fullTable" : "join";
  const url = completed ? "/hausdepp/konto#runden" : `/hausdepp/spiel/${encodeURIComponent(game.id || game.game_id)}${game.started && !game.my_player_id ? "/zuschauen" : ""}`;
  const seats = Array.from({ length: total }, (_, index) => {
    const player = participants[index];
    return `<li class="hd-table-seat ${player ? player.is_cpu ? "is-cpu" : "is-human" : "is-open"}" aria-label="${esc(`${t("seatNumber", { number: index + 1 })}: ${player ? `${player.name}${player.is_cpu ? `, ${t("computer")}` : ""}` : t("humanSeat")}`)}"><span aria-hidden="true">${player ? seatAvatar(player, { key: `lobby-${game.id || game.game_id}-${player.id}`, selfId: game.my_player_id }) : "+"}</span><span>${player ? esc(player.name) : t("humanSeat")}</span></li>`;
  }).join("");
  return `<article class="hd-table-card" data-table-id="${esc(game.id || game.game_id)}"><div class="hd-table-card-heading"><h3>${esc(game.name || t("defaultTable"))}</h3><span class="hd-table-status ${game.started && !completed ? "is-live" : ""}">${status}</span></div><p class="hd-table-meta">${game.tournament ? `${t("tournamentRoundShort", { round: game.tournament.round_number })} · ` : ""}${t("seatSummary", { occupied, total })} · ${counted("humanCount", occupied - cpu)}${cpu ? ` · ${t("cpuCount", { count: cpu })}` : ""}</p><ul class="hd-table-seats">${seats}</ul><div class="hd-table-card-action">${full && !game.started && !game.my_player_id ? `<span>${t(action)}</span>` : `<a class="hd-round-row" href="${url}" aria-label="${esc(`${t("tableDetails", { name: game.name || t("defaultTable"), status, occupied, total })} ${t(action)}`)}">${t(action)} ${icon("arrow")}</a>`}</div>${game.my_player_id && !completed ? invitationMarkup({ id: game.id || game.game_id, name: game.name || t("defaultTable"), canCall: game.can_notify_open_seat === true, retrySeconds: game.invite_retry_after_seconds }, t) : ""}</article>`;
}

function renderAccount() {
  document.title = `${t("accountTitle")} · Hausdepp`;
  root.innerHTML = `<div class="hd-account"><header class="hd-account-heading"><p class="hd-account-identity">${avatarMarkup(auth.user, { size: "small", avatarKey: "account-self" })}${esc(t("signedInAs", { name: auth.user.username }))}</p><h1>${t("accountTitle")}</h1><p>${t("accountIntro")}</p><nav class="hd-account-shortcuts" aria-label="${t("accountContents")}"><a href="#fortschritt">${t("rankHeading")}</a><a href="#erfolge">${t("achievementCollection")}</a><a href="#runden">${t("historyHeading")}</a><a href="/hausdepp/rangliste">${t("leaderboard")}</a></nav></header><section id="fortschritt" class="hd-account-progression" aria-labelledby="hausdeppRankTitle"><div id="hausdeppProgressNotice" hidden></div><div id="hausdeppRank" aria-live="polite"><h2 id="hausdeppRankTitle">${t("rankHeading")}</h2><p>${t("progressLoading")}</p></div></section><section class="hd-account-overview" aria-labelledby="hausdeppAccountStatsTitle"><h2 id="hausdeppAccountStatsTitle">${t("accountStatsTitle")}</h2><div id="hausdeppAccountStats" aria-live="polite"><p>${t("accountLoading")}</p></div></section><section id="erfolge" class="hd-account-achievements" aria-labelledby="hausdeppAchievementsTitle"><div class="hd-section-heading"><div><p class="hd-account-kicker">${t("achievementsDirection")}</p><h2 id="hausdeppAchievementsTitle">${t("achievementCollection")}</h2></div><span id="hausdeppAchievementCount" class="hd-achievement-count"></span></div><p class="hd-account-muted">${t("achievementIntro")}</p><p class="hd-fine hd-achievement-rules">${t("achievementRules")}</p><div id="hausdeppAchievementControls" class="hd-achievement-controls" hidden><label class="hd-achievement-search">${t("searchAchievements")}<input id="hausdeppAchievementSearch" type="search" maxlength="120" placeholder="${t("achievementSearchHint")}" aria-controls="hausdeppAchievements"></label><label>${t("achievementStatus")}<select id="hausdeppAchievementStatus"><option value="all">${t("achievementAll")}</option><option value="unlocked">${t("achievementUnlocked")}</option><option value="locked">${t("achievementLocked")}</option></select></label><label>${t("achievementCategory")}<select id="hausdeppAchievementCategory"><option value="all">${t("allCategories")}</option>${achievementCategories.map(category => `<option value="${category}">${t(`category_${category}`)}</option>`).join("")}</select></label></div><p id="hausdeppAchievementResults" class="hd-fine" role="status"></p><div id="hausdeppAchievements"><p>${t("progressLoading")}</p></div><p class="hd-fine hd-achievement-privacy">${t("achievementPrivacy")}</p></section><section id="runden" class="hd-account-history" aria-labelledby="hausdeppHistoryTitle"><div class="hd-section-heading"><h2 id="hausdeppHistoryTitle">${t("historyHeading")}</h2><a href="/hausdepp">${t("lobby")} ${icon("arrow")}</a></div><p class="hd-account-muted">${t("historyIntro")}</p><div id="hausdeppHistory" aria-live="polite"></div><p id="hausdeppAccountError" class="hd-error" role="alert" hidden></p><button id="hausdeppHistoryMore" class="hd-secondary" type="button" hidden>${t("moreRounds")}</button><p id="hausdeppHistoryComplete" class="hd-fine" hidden>${t("historyComplete")}</p></section><section class="hd-account-settings" aria-labelledby="hausdeppSettingsTitle"><h2 id="hausdeppSettingsTitle">${t("accountSettings")}</h2><p>${t("accountSettingsHint")}</p><a class="hd-secondary" href="${accountSettingsUrl()}">${t("accountSettings")} ${icon("arrow")}</a></section><a class="hd-back-link" href="/hausdepp">${t("accountBack")} ${icon("arrow")}</a></div>${footer()}`;
  const account = root.querySelector('.hd-account');
  account.querySelector('.hd-account-shortcuts').outerHTML = accountNavigationMarkup({ statistics: '/hausdepp/konto#statistics', achievements: '/hausdepp/konto#erfolge', settings: accountSettingsUrl(), current: location.hash === '#erfolge' || location.hash === '#achievements' ? 'achievements' : 'statistics' });
  const mergeNotice = document.createElement('div'); mergeNotice.hidden = true; mergeNotice.dataset.accountMergeNotice = '';
  account.querySelector('.hd-account-heading').after(mergeNotice);
  const showPanel = () => {
    const achievements = ['#erfolge', '#achievements'].includes(location.hash);
    for (const section of account.querySelectorAll(':scope > section')) section.hidden = section.id !== 'fortschritt' && (achievements ? section.id !== 'erfolge' : section.id === 'erfolge');
    for (const link of account.querySelectorAll('[data-account-destination]')) {
      const active = link.dataset.accountDestination === (achievements ? 'achievements' : 'statistics');
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  };
  window.addEventListener('hashchange', showPanel); showPanel();
  mountAccountMergeNotice(mergeNotice, { userId: auth.user.id, isCurrent: () => !stopped });
  $("hausdeppHistoryMore").addEventListener("click", () => loadAccount({ more: true }));
  $("hausdeppAchievementSearch").addEventListener("input", event => { achievementSearch = event.target.value; renderAchievementCollection(); });
  $("hausdeppAchievementStatus").addEventListener("change", event => { achievementStatus = event.target.value; renderAchievementCollection(); });
  $("hausdeppAchievementCategory").addEventListener("change", event => { achievementCategory = event.target.value; renderAchievementCollection(); });
  void loadAccount();
}

const achievementCategories = ["participation", "community", "cut_gamble", "tens", "four", "tempo", "mishaps", "endgame", "comebacks", "style", "tournament", "habits", "surprises_activated", "surprises_witnessed", "zonk"];
const localized = value => typeof value === "object" && value ? value[lang()] || value.de || value.en || "" : String(value ?? "");
const nonnegative = value => Math.max(0, Number(value) || 0);
const pointNumber = value => new Intl.NumberFormat(lang() === "en" ? "en-GB" : "de-CH").format(Math.floor(nonnegative(value)));
const xp = value => t("experiencePoints", { points: pointNumber(value) });
const earnedXp = value => t("experiencePoints", { points: `${nonnegative(value) > 0 ? "+" : ""}${pointNumber(value)}` });
const outcomeLabel = outcome => t(({ hausdepp: "outcomeHausdepp", finished: "outcomeFinished",
  remaining: "outcomeRemaining", withdrawn: "outcomeWithdrawn" })[outcome] || "outcomeUnknown");

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
  $("hausdeppRank").innerHTML = `<div class="hd-rank-overview"><div class="hd-rank-identity"><p class="hd-account-kicker">${t("permanentRank")}</p><h2 id="hausdeppRankTitle" tabindex="-1">${esc(localized(rank.name))}</h2><p class="hd-rank-flavor">${esc(localized(rank.quote))}</p><span class="hd-rank-level">${t("rankLevel", { level: rank.level, total: ladder.length || 24 })}</span></div><div class="hd-xp-total"><strong>${esc(pointNumber(current))}</strong><span>${t("experienceLabel")}</span></div></div><div class="hd-rank-progress"><div class="hd-rank-progress-label"><span>${next ? esc(t("nextRank", { name: localized(next.name) })) : t("topRank")}</span><strong>${next ? esc(t("pointsRemaining", { points: pointNumber(nonnegative(next.threshold) - current) })) : t("topRankHint")}</strong></div><progress max="100" value="${next ? percent : 100}" aria-label="${esc(next ? t("rankProgressLabel", { name: localized(next.name), current: pointNumber(progress.current), target: pointNumber(progress.target) }) : t("topRank"))}"></progress></div><dl class="hd-xp-breakdown"><div><dt>${t("roundExperience")}</dt><dd>${esc(xp(scoring.round_points))}</dd></div><div><dt>${t("achievementExperience")}</dt><dd>${esc(xp(scoring.achievement_points))}</dd></div></dl><p class="hd-fine hd-xp-guide">${esc(t("experienceGuide", { points: pointNumber(scoring.round_reward ?? 10), cpuPoints: pointNumber(scoring.cpu_round_reward ?? 2), reduction: scoring.cpu_reduction_percent ?? 75 }))}</p><details class="hd-rank-ladder"><summary>${t("viewRankLadder")}</summary><p class="hd-account-muted">${t("rankLadderHint")}</p><ol>${ladder.map(item => `<li class="${item.id === rank.id ? "is-current" : item.level < rank.level ? "is-reached" : ""}" ${item.id === rank.id ? 'aria-current="step"' : ""}><span class="hd-ladder-step" aria-hidden="true">${nonnegative(item.level)}</span><div><div class="hd-ladder-heading"><strong>${esc(localized(item.name))}</strong><span>${esc(xp(item.threshold))}${item.id === rank.id ? ` · ${t("currentRank")}` : ""}</span></div><p>${esc(localized(item.quote))}</p></div></li>`).join("")}</ol></details>`;
  $("hausdeppAchievementControls").hidden = false;
  $("hausdeppAchievementCount").textContent = t("achievementTotal", { count: data.achievements?.unlocked_count || 0, total: data.achievements?.total ?? data.achievements?.items?.length ?? 0 });
  renderAchievementCollection();
  renderProgressNotice($("hausdeppProgressNotice"), data);
}

function compareAchievements(first, second) {
  return Number(Boolean(second.unlocked)) - Number(Boolean(first.unlocked))
    || String(first.id).localeCompare(String(second.id), "en", { numeric: true });
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
    const items = filtered.filter(item => item.category === category).sort(compareAchievements);
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
  return `<article class="hd-achievement-card ${item.unlocked ? "is-unlocked" : "is-locked"}" data-achievement-id="${esc(item.id)}"><div class="hd-achievement-card-top"><span class="hd-achievement-symbol" aria-hidden="true">${surpriseAchievementBadge(item.id) || (item.unlocked ? icon("check") : icon("cards"))}</span><span class="hd-achievement-points">${esc(xp(item.points))}</span></div><h3>${esc(localized(item.name))}</h3><p>${esc(localized(item.description))}</p><div class="hd-achievement-card-bottom"><span class="hd-achievement-state">${t(item.unlocked ? "achievementEarned" : "achievementNotEarned")}</span>${item.unlocked && item.unlocked_at ? `<time datetime="${esc(item.unlocked_at)}">${esc(formatRoundDate(item.unlocked_at))}</time>` : `<span class="hd-achievement-fraction">${pointNumber(current)} / ${pointNumber(target)}</span>`}</div>${item.unlocked ? "" : `<progress max="${target}" value="${current}" aria-label="${esc(t("achievementProgressLabel", { name: localized(item.name), current: pointNumber(current), target: pointNumber(target) }))}"></progress>`}</article>`;
}

function renderProgressNotice(container, data, { acknowledge = true } = {}) {
  const notice = data.presentation?.pending;
  if (!container) return;
  if (popupProgressPending || !notice || notice.revision <= acknowledgedProgressRevision) { container.hidden = true; return; }
  const rankUp = Boolean(notice.rank_up);
  const knownReward = notice.points_earned !== null && notice.points_earned !== undefined;
  const awards = (data.achievements?.items || []).filter(item => notice.achievement_ids?.includes(item.id));
  const reward = knownReward ? `+${xp(notice.points_earned)}${awards.length ? ` · ${counted("newAchievementCount", awards.length)}` : ""}` : awards.length ? counted("newAchievementCount", awards.length) : "";
  container.hidden = false;
  container.className = "hd-progress-notice";
  container.setAttribute("role", "status");
  container.innerHTML = `<p class="hd-account-kicker">${t(rankUp ? "rankUpLabel" : awards.length ? "newAchievements" : "newProgress")}</p><h3>${esc(rankUp ? localized(notice.message) || t("rankCongratulations") : t(!knownReward ? "progressRecorded" : awards.length ? "achievementCongratulations" : "roundCongratulations"))}</h3>${rankUp ? `<p class="hd-notice-new-rank">${esc(t("newRank", { name: localized(notice.to_rank?.name) }))}</p><p class="hd-notice-quote">${esc(localized(notice.quote || notice.to_rank?.quote))}</p>${nonnegative(notice.to_rank?.level) - nonnegative(notice.from_rank?.level) > 1 ? `<p class="hd-fine">${esc(t("ranksSkipped", { count: notice.to_rank.level - notice.from_rank.level }))}</p>` : ""}` : ""}${reward ? `<p class="hd-notice-reward">${esc(reward)}</p>` : ""}${awards.length ? `<details><summary>${t("showNewAchievements")}</summary><ul>${awards.map(item => `<li><span class="hd-notice-achievement">${surpriseAchievementBadge(item.id)}<span>${esc(localized(item.name))}</span></span><strong>${esc(earnedXp(item.points))}</strong></li>`).join("")}</ul></details>` : ""}${acknowledge ? `<button class="hd-primary" type="button" data-progress-ack>${t("continueProgress")}</button><p class="hd-notice-error" role="alert" hidden></p>` : ""}`;
  if (!acknowledge) return;
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
  root.innerHTML = `<div class="hd-leaderboard"><header class="hd-account-heading"><p class="hd-account-identity">${t("leaderboardKicker")}</p><h1>${t("leaderboardTitle")}</h1><p>${t("leaderboardIntro")}</p></header><section class="hd-leaderboard-paper" aria-labelledby="hausdeppLeaderboardTitle"><div class="hd-section-heading"><h2 id="hausdeppLeaderboardTitle">${t("leaderboardWins")}</h2><label class="hd-leaderboard-filter">${t("leaderboardTableSize")}<select id="hausdeppLeaderboardSize"><option value="all">${t("allTableSizes")}</option>${[2,3,4,5,6].map(count => `<option value="${count}">${t("roundPeople", { count })}</option>`).join("")}</select></label></div><p id="hausdeppLeaderboardScoring" class="hd-account-muted">${t("leaderboardScoring")}</p><p class="hd-fine">${t("leaderboardPrivacy")}</p><p id="hausdeppLeaderboardStatus" class="hd-fine" role="status"></p><div id="hausdeppLeaderboardRows"><p>${t("leaderboardLoading")}</p></div><p id="hausdeppLeaderboardError" class="hd-error" role="alert" hidden></p></section><section id="hausdeppAchievementFeed" class="hd-leaderboard-paper hd-feed" aria-labelledby="hausdeppFeedTitle"><div class="hd-section-heading"><div><p class="hd-account-kicker">${t("feedKicker")}</p><h2 id="hausdeppFeedTitle" tabindex="-1">${t("feedTitle")}</h2></div><div class="hd-feed-filters" role="group" aria-label="${t("feedFilter")}">${feedDifficulties.map(level => `<button type="button" class="hd-feed-filter" data-feed-difficulty="${level}" aria-pressed="false">${t(`difficulty_${level}`)}</button>`).join("")}</div></div><p class="hd-account-muted">${t("feedIntro")}</p><p class="hd-fine">${t("feedPrivacy")}</p><p id="hausdeppFeedStatus" class="hd-fine" role="status"></p><div id="hausdeppFeedList"><p>${t("feedLoading")}</p></div><p id="hausdeppFeedError" class="hd-error" role="alert" hidden></p><nav id="hausdeppFeedPagination" class="hd-feed-pagination" aria-label="${t("feedPagination")}" hidden><button id="hausdeppFeedPrevious" class="hd-text-button" type="button">${t("feedPrevious")}</button><span id="hausdeppFeedPage"></span><button id="hausdeppFeedNext" class="hd-text-button" type="button">${t("feedNext")}</button></nav></section><div class="hd-leaderboard-links"><a class="hd-primary" href="/hausdepp">${t("takeSeat")} ${icon("arrow")}</a><a href="/hausdepp/konto">${t("accountBackProfile")} ${icon("arrow")}</a></div></div>${footer()}`;
  $("hausdeppLeaderboardSize").addEventListener("change", loadLeaderboard);
  void loadLeaderboard();
  feedState.page = 1; feedState.difficulty = null;
  $("hausdeppAchievementFeed").addEventListener("click", event => {
    const filter = event.target instanceof Element ? event.target.closest("[data-feed-difficulty]") : null;
    if (!filter) return;
    const level = filter.dataset.feedDifficulty;
    feedState.difficulty = feedState.difficulty === level ? null : level;
    feedState.page = 1;
    void loadAchievementFeed();
  });
  $("hausdeppFeedPrevious").addEventListener("click", () => { feedState.page -= 1; void loadAchievementFeed({ focus: true }); });
  $("hausdeppFeedNext").addEventListener("click", () => { feedState.page += 1; void loadAchievementFeed({ focus: true }); });
  void loadAchievementFeed();
}

// Newest unlocks of every account. The API returns names only, never account
// IDs, rounds or cards, so the entries are plain text without profile links.
const feedDifficulties = ["easy", "medium", "hard"];
const feedState = { page: 1, pages: 1, difficulty: null, request: 0 };

function feedItemMarkup(item) {
  const achievement = item && typeof item.achievement === "object" && item.achievement ? item.achievement : {};
  const player = item && typeof item.player === "object" && item.player ? item.player : {};
  const level = feedDifficulties.includes(achievement.difficulty) ? achievement.difficulty : "medium";
  return `<li class="hd-feed-item${player.is_self ? " is-self" : ""}" data-feed-item data-feed-item-difficulty="${level}"><span class="hd-achievement-symbol" aria-hidden="true">${surpriseAchievementBadge(achievement.id) || icon("check")}</span><div class="hd-feed-copy"><p class="hd-feed-earned"><strong class="hd-feed-player" translate="no">${esc(player.display_name || t("leaderboardUnknownPlayer"))}</strong>${player.is_self ? `<span class="hd-self-tag">${t("yourSeat")}</span>` : ""}<time datetime="${esc(item.unlocked_at || "")}">${esc(formatRoundDate(item.unlocked_at))}</time></p><h3>${esc(localized(achievement.name))}</h3><p>${esc(localized(achievement.description))}</p><p class="hd-feed-meta"><span class="hd-feed-difficulty hd-feed-difficulty--${level}">${t(achievement.points === 0 ? "category_zonk" : `difficulty_${level}`)}</span><span class="hd-achievement-points">${esc(xp(achievement.points))}</span></p></div></li>`;
}

async function loadAchievementFeed({ focus = false } = {}) {
  const request = ++feedState.request;
  const list = $("hausdeppFeedList"), status = $("hausdeppFeedStatus"), error = $("hausdeppFeedError");
  const pagination = $("hausdeppFeedPagination");
  document.querySelectorAll("[data-feed-difficulty]").forEach(button => {
    const active = button.dataset.feedDifficulty === feedState.difficulty;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  list.setAttribute("aria-busy", "true");
  status.textContent = t("feedLoading");
  error.hidden = true;
  try {
    const params = new URLSearchParams({ page: String(feedState.page) });
    if (feedState.difficulty) params.set("difficulty", feedState.difficulty);
    const data = await json(`/api/hausdepp/achievements/recent?${params}`);
    if (stopped || request !== feedState.request) return;
    const items = Array.isArray(data.items) ? data.items : [];
    feedState.page = Math.max(1, Math.floor(nonnegative(data.page)) || 1);
    feedState.pages = Math.max(1, Math.floor(nonnegative(data.pages)) || 1);
    const total = Math.floor(nonnegative(data.total));
    status.textContent = total ? counted("feedCount", total) : "";
    list.innerHTML = items.length ? `<ol class="hd-feed-list">${items.map(feedItemMarkup).join("")}</ol>` : `<div class="hd-account-empty"><p>${t("feedEmpty")}</p><span>${t("feedEmptyHint")}</span></div>`;
    pagination.hidden = feedState.pages <= 1;
    $("hausdeppFeedPage").textContent = t("feedPage", { page: pointNumber(feedState.page), pages: pointNumber(feedState.pages) });
    $("hausdeppFeedPrevious").disabled = feedState.page <= 1;
    $("hausdeppFeedNext").disabled = feedState.page >= feedState.pages;
    if (focus) $("hausdeppFeedTitle")?.focus();
  } catch {
    if (stopped || request !== feedState.request) return;
    status.textContent = "";
    list.innerHTML = "";
    pagination.hidden = true;
    error.hidden = false;
    error.innerHTML = `${t("feedError")} <button id="hausdeppFeedRetry" class="hd-text-button" type="button">${t("retry")}</button>`;
    $("hausdeppFeedRetry").addEventListener("click", () => void loadAchievementFeed());
  } finally {
    if (request === feedState.request) list.removeAttribute("aria-busy");
  }
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
    rows.innerHTML = entries.length ? `<table class="hd-leaderboard-table"><caption class="hd-sr">${t("leaderboardWins")}</caption><thead><tr><th scope="col">${t("leaderboardPlace")}</th><th scope="col">${t("leaderboardPlayer")}</th><th scope="col">${t("leaderboardWins")}</th><th scope="col">${t("roundsPlayed")}</th><th scope="col">${t("leaderboardWinRate")}</th></tr></thead><tbody>${entries.map(entry => `<tr ${entry.is_self ? 'class="is-self"' : ""}><td class="hd-leaderboard-place" data-label="${t("leaderboardPlace")}">${nonnegative(entry.place)}.</td><th scope="row" class="hd-leaderboard-name">${esc(entry.display_name || t("leaderboardUnknownPlayer"))}${entry.is_self ? `<span class="hd-self-tag">${t("yourSeat")}</span>` : ""}${entry.rank ? `<span class="hd-leaderboard-rank" data-player-rank="${esc(entry.rank.id)}">${esc(t("playerCurrentRank"))}: ${esc(localized(entry.rank.name))}</span>` : ""}</th><td data-label="${t("leaderboardWins")}"><strong>${pointNumber(entry.wins)}</strong></td><td data-label="${t("roundsPlayed")}">${pointNumber(entry.rounds_played)}</td><td data-label="${t("leaderboardWinRate")}">${new Intl.NumberFormat(lang() === "en" ? "en-GB" : "de-CH", { maximumFractionDigits: 1 }).format(nonnegative(entry.win_rate))}%</td></tr>`).join("")}</tbody></table>` : `<div class="hd-account-empty"><p>${t("leaderboardEmpty")}</p><span>${t("leaderboardEmptyHint")}</span></div>`;
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
  return `<article class="hd-history-round" data-round-id="${esc(round.game_id)}"><div class="hd-history-round-heading"><div><time datetime="${esc(round.finished_at || "")}">${esc(formatRoundDate(round.finished_at))}</time><h3>${esc(round.name || t("defaultTable"))}</h3></div><span class="hd-outcome ${isHausdepp ? "is-hausdepp" : ""}">${outcomeLabel(round.outcome)}</span></div><p class="hd-history-meta">${t("roundPeople", { count: Number(round.participant_count) || players.length })}${round.cpu_count ? ` · ${t("cpuCount", { count: round.cpu_count })}` : ""}${round.outcome === "finished" && Number.isInteger(round.finished_position) ? ` · ${t("exitPosition", { position: round.finished_position })}` : ""}</p><details class="hd-history-players"><summary>${t("historyParticipants", { count: players.length })}</summary><ul>${players.map(player => `<li><span>${esc(player.name)}${player.is_cpu ? `<small>${t("computer")}</small>` : ""}</span><span>${outcomeLabel(player.outcome)}${player.outcome === "finished" && Number.isInteger(player.finished_position) ? ` · ${t("exitPosition", { position: player.finished_position })}` : ""}</span></li>`).join("")}</ul></details></article>`;
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
  if (!viewportInitialized) { initializeGameViewport(); viewportInitialized = true; }
  if (spectating) document.body.classList.add("hd-spectating");
  root.innerHTML = `<div class="hd-room-layout"><section id="hausdeppTable" class="hd-table" aria-label="${t("table")}"><div class="hd-room-heading"><div><h1 id="hausdeppRoomName">${t("defaultTable")}</h1><p id="hausdeppTournamentBanner" class="hd-tournament-banner" hidden></p></div><span id="hausdeppConnection" role="status">${t("connecting")}</span></div><div id="hausdeppPlayers" class="hd-seats"></div><div class="hd-centre"><div class="hd-stock-group"><div id="hausdeppCutPreview" class="hd-cut-preview" role="status" aria-live="polite" aria-label="${esc(t("peekTitle"))}" hidden></div><div id="hausdeppKnownBottomCards" class="hd-known-bottom-cards" aria-hidden="true" hidden><span class="hd-known-bottom-fan"></span><span id="hausdeppKnownBottom" class="hd-known-bottom" hidden></span></div><button id="hausdeppStock" class="hd-card-back" type="button" disabled aria-label="${t("stock")}"></button><span id="hausdeppStockAction" class="hd-stack-action"></span><p id="hausdeppDrawAlert" class="hd-draw-alert" role="status" hidden>${t("mustDraw")}</p><span id="hausdeppStockCount"></span></div><div class="hd-pile-group"><button id="hausdeppPile" class="hd-pile" type="button" disabled aria-label="${t("pickup")}" aria-describedby="hausdeppPileTip"></button><span id="hausdeppPileTip" class="hd-pile-tip" role="tooltip">${t("inspectPileTip")}</span><span id="hausdeppPileAction" class="hd-stack-action"></span><span id="hausdeppPileCount"></span></div><div class="hd-burned" title="${t("outOfPlay")}"><div id="hausdeppBurnedStack" class="hd-burned-stack is-empty" aria-hidden="true"></div><span class="hd-stack-action hd-sr">${t("outOfPlay")}</span><span class="hd-burned-meta">${icon("out", "hd-burned-icon")}<span id="hausdeppBurnedCount">0</span><span class="hd-sr"> <span id="hausdeppBurnedUnit">${t("cardWord")}</span></span></span></div></div><p id="hausdeppStatus" class="hd-turn-status" role="status" aria-live="polite">${t("connecting")}</p><section class="hd-hand-region" aria-labelledby="hausdeppHandTitle"><div class="hd-hand-heading"><div class="hd-own-identity">${avatarMarkup(auth.user, { size: "small", avatarKey: "hand-self" })}<div><h2 id="hausdeppHandTitle">${t("yourHand")} <span id="hausdeppOwnPrefix" class="hd-tournament-prefix" hidden></span></h2><span class="hd-own-name" translate="no">${esc(auth.user.username)}</span></div></div><span id="hausdeppSelection"></span></div><div id="hausdeppHand" class="hd-hand"></div></section><details id="hausdeppTools" class="hd-actions"><summary aria-label="${esc(t("tableTools"))}" title="${esc(t("tableTools"))}">${icon("cards")}<span class="hd-tools-label">${t("tableTools")}</span></summary><div class="hd-game-help"><h2>${t("tableTools")}</h2><p id="hausdeppEvent" class="hd-event" aria-live="polite"></p><p class="hd-action-guide">${t("stackActions")}</p><button id="hausdeppInspectPile" class="hd-secondary hd-inspect-pile" type="button" disabled>${t("inspectPile")}</button><p class="hd-inspect-hint">${t("inspectPileGesture")}</p><a class="hd-secondary" href="/hausdepp/regeln">${t("rules")} ${icon("arrow")}</a><div id="hausdeppRoomInvitation" hidden>${invitationMarkup({ id: gameId, name: t("defaultTable") }, t)}</div><button class="hd-tools-close" type="button">${t("close")}</button></div></details><p id="hausdeppActionError" class="hd-action-error" role="alert"></p><details id="hausdeppPeek" class="hd-peek" hidden><summary>${t("peekTitle")}</summary><p id="hausdeppPeekText"></p><div id="hausdeppPeekCards" class="hd-peek-cards"></div></details><section id="hausdeppResult" class="hd-result" aria-live="polite" hidden></section><div id="hausdeppReactionLayer" class="hd-reaction-layer" aria-hidden="true"></div><p id="hausdeppReactionAnnouncement" class="hd-sr" role="status" aria-live="polite" aria-atomic="true"></p></section>
    <aside class="hd-social"><div class="hd-social-tools"><button id="chatToggle" type="button" aria-controls="chatPanel" aria-expanded="false">${icon("chat")} <span class="hd-chat-label">${t("tableChat")}</span> <span id="chatToggleCount" hidden></span></button><div class="hd-reactions" aria-label="${t("reactions")}"></div></div><section id="chatPanel" class="hd-chat-panel" aria-label="${t("tableChat")}"><div class="chat-content" hidden><div class="hd-chat-heading"><h2>${t("tableChat")}</h2><button id="chatClose" type="button">${t("close")}</button></div><div id="chatBox" class="hd-chat-messages" role="log" aria-live="polite"></div><div class="hd-chat-compose"><label class="hd-sr" for="chatInput">${t("message")}</label><input id="chatInput" type="text" maxlength="400" placeholder="${t("message")}" autocomplete="off"><button id="chatSend" type="button">${t("send")}</button></div></div></section><a class="hd-social-rules" href="/hausdepp/regeln">${t("rules")} ${icon("arrow")}</a></aside></div><button id="chatBackdrop" class="hd-chat-backdrop" type="button" aria-label="${t("close")}" hidden></button>`;
  $("hausdeppTable").insertAdjacentHTML("afterbegin", `<section id="hausdeppWaiting" class="hd-waiting" aria-labelledby="hausdeppWaitingTitle" hidden><div class="hd-waiting-heading"><h2 id="hausdeppWaitingTitle">${t("waitingHeading")}</h2><button id="hausdeppLeaveWaiting" class="hd-secondary" type="button" hidden>${t("leaveWaiting")}</button></div><p id="hausdeppLeaveWaitingError" class="hd-error" role="alert" hidden></p>${waitingControlsMarkup(t)}${invitationMarkup({ id: gameId, name: t("defaultTable"), waiting: true }, t)}</section>`);
  waitingControls?.destroy();
  waitingControls = mountWaitingControls($("hausdeppWaiting"), { t, send, connected: () => socket?.readyState === WebSocket.OPEN });
  const copyWaiting = $("hausdeppWaiting").querySelector('[data-invite-action="copy"]');
  copyWaiting.setAttribute("aria-label", t("copyTable"));
  copyWaiting.textContent = "⧉";
  if (spectating) {
    $("hausdeppHandTitle").firstChild.textContent = `${t("watchingHand")} `;
    document.querySelector(".hd-action-guide").textContent = t("watching");
  }
  $("hausdeppLeaveWaiting").addEventListener("click", () => {
    if (waitingLeaving || !snapshot?._waiting_permissions?.can_leave || snapshot?._started) return;
    waitingLeaving = true;
    $("hausdeppLeaveWaiting").disabled = true;
    $("hausdeppLeaveWaitingError").hidden = true;
    if (!send({ action: "leave_waiting_game" })) {
      waitingLeaving = false;
      $("hausdeppLeaveWaiting").disabled = false;
      $("hausdeppLeaveWaitingError").textContent = t("connectionLost");
      $("hausdeppLeaveWaitingError").hidden = false;
    }
  });
  $("hausdeppTools").querySelector(".hd-tools-close").addEventListener("click", () => { $("hausdeppTools").open = false; $("hausdeppTools").querySelector("summary").focus(); });
  $("hausdeppHand").insertAdjacentHTML("afterend", `<div id="hausdeppCpuTempo" class="hd-cpu-tempo" hidden><button id="hausdeppSpeedUpCpus" class="hd-secondary" type="button" aria-describedby="hausdeppCpuTempoHint">${t("speedUpCpus")}</button><p id="hausdeppCpuTempoHint">${t("speedUpCpusHint")}</p><span id="hausdeppCpuTempoStatus" class="hd-sr" role="status" aria-live="polite"></span></div>`);
  $("hausdeppSpeedUpCpus").addEventListener("click", () => command("speed_up_cpus"));
  $("hausdeppStock").addEventListener("click", () => {
    const actions = snapshot?._hausdepp?.available_actions || [];
    command(actions.includes("peek") ? "peek" : actions.includes("draw") ? "draw" : "gamble");
  });
  $("hausdeppTools").querySelector(".hd-game-help").append($("hausdeppPeek"));
  peekFeedback = mountPeekFeedback({ history: $("hausdeppPeek"), text: $("hausdeppPeekText"),
    cards: $("hausdeppPeekCards"), preview: $("hausdeppCutPreview"), t, cardMarkup });
  // Wide tables keep help and invitations in the side column beside chat and
  // rules; the hand area below the cards stays for playing them.
  const toolsWide = matchMedia("(min-width: 1100px)");
  const placeTools = () => {
    const tools = $("hausdeppTools"), aside = document.querySelector(".hd-social");
    if (!tools || !aside) return;
    if (toolsWide.matches) aside.insertBefore(tools, aside.querySelector(".hd-social-rules"));
    else if (tools.parentElement !== $("hausdeppTable")) $("hausdeppActionError").before(tools);
  };
  placeTools();
  toolsWide.addEventListener("change", placeTools);
  tableCleanups.push(() => toolsWide.removeEventListener("change", placeTools));
  pileInspector = mountPileInspector({ pile: $("hausdeppPile"), inspectButton: $("hausdeppInspectPile"), table: $("hausdeppTable"), t, cardMarkup });
  let presentationRenderQueued = false;
  window.addEventListener("hausdepp:pile-presentation", event => {
    if (event.detail.gameId !== gameId || presentationRenderQueued) return;
    presentationRenderQueued = true;
    const lifetime = tableLifetime;
    queueMicrotask(() => {
      presentationRenderQueued = false;
      if (stopped || lifetime.signal.aborted || lifetime !== tableLifetime) return;
      completeCommand();
      renderState();
    });
  }, { signal: tableLifetime.signal });
  handSelection = mountHandSelection({
    handRegion: document.querySelector(".hd-hand-region"), tools: document.querySelector(".hd-social-tools"), reactions: document.querySelector(".hd-reactions"), t,
    onChange: () => renderState(),
    onPlay: () => {
      // Refresh the version-bound selection immediately before submitting it.
      renderState();
      const selection = handSelection.selection.take();
      if (selection) command(selection.action, selection.cards);
    },
  });
  $("hausdeppPile").addEventListener("click", () => command("pickup"));
  // Holding a playable card selects all cards of its rank for one throw.
  let hold = null, suppressClick = false, pointerTap = null;
  const endHold = () => { if (hold) clearTimeout(hold.timer); hold = null; };
  tableCleanups.push(endHold);
  const startSelection = card => {
    if (!card || handSelection.selection.enabled || !handSelection.selection.startWith(card)) return false;
    navigator.vibrate?.(12);
    renderState();
    return true;
  };
  $("hausdeppHand").addEventListener("pointerdown", event => {
    const button = event.target.closest("button[data-card-id]");
    // A server update can enable or move cards before touch release. The
    // eventual click belongs only to the card that was usable at touch-down.
    pointerTap = { pointerId: event.pointerId, pointerType: event.pointerType, card: button?.dataset.cardId,
      enabled: !!button && !button.disabled && event.button === 0, selecting: handSelection.selection.enabled };
    endHold();
    suppressClick = false;
    if (!pointerTap.enabled) return;
    hold = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      hold = null;
      if (startSelection(button.dataset.cardId)) suppressClick = true;
    }, 420) };
  }, { capture: true });
  $("hausdeppHand").addEventListener("pointermove", event => {
    if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) { endHold(); pointerTap = null; }
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) $("hausdeppHand").addEventListener(type, endHold);
  $("hausdeppHand").addEventListener("pointercancel", () => { pointerTap = null; });
  // No browser callout or menu over a held card; right-click selects too.
  $("hausdeppHand").addEventListener("contextmenu", event => {
    const button = event.target.closest("button[data-card-id]");
    if (!button) return;
    event.preventDefault();
    if (!button.disabled && startSelection(button.dataset.cardId)) suppressClick = false;
  });
  $("hausdeppHand").addEventListener("keydown", event => {
    const button = event.target.closest("button[data-card-id]:not(:disabled)");
    if (!button || !(event.key === "ContextMenu" || (event.key === "Enter" && event.shiftKey))) return;
    event.preventDefault();
    startSelection(button.dataset.cardId);
  });
  $("hausdeppHand").addEventListener("click", event => {
    const button = event.target.closest("button[data-card-id]");
    const card = button?.dataset.cardId;
    const s = snapshot?._hausdepp;
    const tap = pointerTap;
    pointerTap = null;
    if (suppressClick) { suppressClick = false; return; }
    if (!button || button.disabled) return;
    // Keyboard and assistive activation have no pointer gesture. Touch/mouse
    // clicks must not inherit a newly enabled card or a replacement target.
    if ((event.pointerType || event.detail > 0) && (!tap?.enabled || tap.card !== card ||
      // WebKit can synthesize a mouse click with a different ID after touch-up.
      // IDs identify a gesture only within the same pointer type.
      (event.pointerType === tap.pointerType && event.pointerId > 0 && event.pointerId !== tap.pointerId) ||
      tap.selecting !== handSelection.selection.enabled)) return;
    if (handSelection.selection.enabled) {
      if (card && handSelection.selection.select(card)) renderState();
      return;
    }
    if (!card || !s?.playable_cards?.includes(card) || queuedCards.some(item => item.card === card) || commandInFlight?.cards?.includes(card)) return;
    if (pending) {
      // A follow-up card may wait behind an automatic or manual refill tap.
      const behindDraw = commandInFlight?.action === "draw" && s.available_actions.includes("afterthrow");
      if (!behindDraw && (!commandInFlight?.cards?.length || commandInFlight.cards[0].split("-")[1] !== card.split("-")[1])) return;
      // Remember what was possible at the tap. A queued card is never replayed
      // later as a different action (for example as a fresh play on a new turn).
      queuedCards.push({ card, behindDraw });
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
  reactionControls?.destroy();
  reactionControls = mountReactions(root.querySelector(".hd-reactions"), { userId: auth.user.id, t, send, isOwnReaction: reaction => reaction.from_id === playerId, connected: () => socket?.readyState === WebSocket.OPEN });
  reactionObserver = new ResizeObserver(positionReactions);
  reactionObserver.observe($("hausdeppTable"));
  if (!spectating && auth.authenticated) {
    if (!sound) {
      sound = createHausdeppSound();
      soundUI = mountHausdeppSoundUI({ controller: sound, t });
    }
    if (!voice) {
      const controller = createHausdeppVoice({ send: (operation, payload) => voiceSignaling.request(operation, payload), t, userId: auth.user.id });
      voiceLifecycle = createVoiceTableLifecycle({ controller, userId: auth.user.id, gameType: "hausdepp",
        defaultListening: auth.user.preferences?.voice_listening_default === true,
        notify: key => window.ZDWA_UI?.toast?.(t(key), { duration: 6000 }) });
      voice = voiceLifecycle.controller;
      voiceUI = mountHausdeppVoiceUI({ controller: voice, t, userId: auth.user.id, sound,
        getPlayers: () => (snapshot?._participants || snapshot?._hausdepp?.players || snapshot?._players || []).map(player => seatIdentity(player)),
      });
    }
    voiceLifecycle.enter({ gameId });
    voiceUI.attach();
    soundUI.attach();
  } else {
    voice?.destroy(); voiceUI?.destroy(); voice = null; voiceUI = null;
    sound?.destroy(); soundUI?.destroy(); sound = null; soundUI = null;
  }
  departureUI?.destroy();
  departureUI = mountHausdeppDepartureUI({ t, send, onLeft: leaveTableForLobby, handControls: handSelection.controls,
    spectatorControls: $("hausdeppTable").querySelector(".hd-room-heading"),
    getState: () => ({ permissions: snapshot?._departure_permissions, version: snapshot?._hausdepp?.version,
      connected: socket?.readyState === WebSocket.OPEN, busy: pending || tournamentEnding, spectating }),
    onPendingChange: value => { pending = value; renderState(); },
  });
  connect();
}

// A new round with the same people keeps page-owned services (voice and sound)
// alive. Only the old table's transport, gestures and temporary presentation end.
function disposeTable() {
  departureUI?.destroy(); departureUI = null;
  voiceSignaling.reset();
  voice?.disconnected();
  const previousSocket = socket;
  socket = null;
  clearTimeout(reconnectTimer);
  clearTimeout(pendingTimer);
  tableLifetime.abort();
  previousSocket?.close();
  cancelTableSurprises($("hausdeppTable"));
  roundProgressReceipt?.();
  cancelRoundResultPresentation();
  progressNotices?.pause();
  hausdeppBeginnerTour.discard();
  waitingControls?.destroy(); waitingControls = null;
  reactionControls?.destroy(); reactionControls = null;
  handSelection?.destroy(); handSelection = null;
  pileInspector?.destroy(); pileInspector = null;
  peekFeedback?.destroy(); peekFeedback = null;
  reactionObserver?.disconnect(); reactionObserver = null;
  for (const cleanup of tableCleanups.splice(0)) cleanup();
  for (const entry of visibleReactions.values()) clearTimeout(entry.timer);
  visibleReactions.clear();
  seenReactions.clear();
  seenChat.clear();
  cancelOwnPlay(gameId);
  resetCardMotion(gameId);
  queuedCards.length = 0;
  playerId = snapshot = commandInFlight = autoRefillVersion = null;
  pending = tournamentEnding = waitingLeaving = passwordRequest = rematchCreating = tableStopped = false;
  requestedSurprise = requestedSurpriseRound = null;
  tablePassword = undefined;
  document.body.classList.remove("hd-waiting-room", "hd-spectating", "chat-open");
  document.documentElement.classList.remove("chat-open");
}

function switchTable(path, { historyMode = "push", sourceGameId } = {}) {
  let target, id;
  try {
    target = new URL(path, location.href);
    const match = target.pathname.match(/^\/hausdepp\/spiel\/([a-zA-Z0-9-]{1,64})(\/zuschauen)?$/);
    if (page !== "table" || target.origin !== location.origin || !match || !auth?.authenticated || stopped) {
      location.assign(path);
      return;
    }
    id = match[1];
  } catch { return; }
  const watching = target.pathname.endsWith("/zuschauen");
  if (gameId === id && spectating === watching) return;
  const previousGameId = gameId;
  if (sourceGameId === previousGameId) voiceLifecycle?.handoff(id);
  voiceLifecycle?.enter({ gameId: id });
  disposeTable();
  gameId = id;
  spectating = watching;
  tableLifetime = new AbortController();
  if (historyMode === "push") history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
  document.title = "Hausdepp";
  renderTableShell();
  window.dispatchEvent(new CustomEvent("hausdepp:table-switch", { detail: { gameId, previousGameId, spectating } }));
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

function positionReactions() {
  const table = $("hausdeppTable");
  if (!table) return;
  const bounds = table.getBoundingClientRect();
  for (const [senderId, entry] of visibleReactions) {
    const anchor = senderId === playerId ? table.querySelector(".hd-own-identity")
      : table.querySelector(`.hd-seat[data-player-id="${CSS.escape(senderId)}"] .hd-seat-avatar`);
    const rect = (anchor || $("hausdeppRoomName")).getBoundingClientRect();
    entry.node.style.left = `${Math.min(Math.max(48, rect.x + rect.width / 2 - bounds.x), Math.max(48, bounds.width - 48))}px`;
    entry.node.style.top = `${Math.max(54, rect.y - bounds.y - 8)}px`;
  }
}

function receiveReaction(reaction) {
  const senderId = String(reaction.from_id || "");
  const key = `${senderId}:${reaction.ts || ""}:${reaction.emoji || ""}`;
  if (!senderId || !reaction.emoji || seenReactions.has(key) || !$("hausdeppReactionLayer")) return;
  seenReactions.add(key);
  reactionControls?.confirm(reaction);
  if (seenReactions.size > 100) seenReactions.delete(seenReactions.values().next().value);
  addChatMessage(reaction.from, reaction.emoji, { ...reaction, kind: "reaction" });
  const previous = visibleReactions.get(senderId);
  if (previous) { clearTimeout(previous.timer); previous.node.remove(); }
  const node = document.createElement("span");
  node.className = "hd-seat-reaction";
  node.dataset.reactionSender = senderId;
  node.innerHTML = `<span>${esc(reaction.emoji)}</span><small>${esc(reaction.from || "")}</small>`;
  $("hausdeppReactionLayer").appendChild(node);
  const timer = setTimeout(() => {
    node.remove();
    if (visibleReactions.get(senderId)?.node === node) visibleReactions.delete(senderId);
  }, 3000);
  visibleReactions.set(senderId, { node, timer });
  positionReactions();
  const announcement = $("hausdeppReactionAnnouncement");
  announcement.textContent = "";
  requestAnimationFrame(() => { if (!stopped) announcement.textContent = t("reactionAnnouncement", { name: reaction.from || "", emoji: reaction.emoji }); });
}

function motionBlocksAction(action) {
  // Refills affect the hand; a legal afterthrow continues the open throw.
  // Both may run while earlier cards fly, without acting on an unlanded pile.
  const ownThrowOpen = snapshot?._hausdepp?.afterthrow?.player_id === playerId;
  return pileMotionPending(gameId) && !(action === "afterthrow" || (action === "draw" && ownThrowOpen));
}

function command(action, cards) {
  const allowed = action === "next_round" ? snapshot?._hausdepp_tournament?.can_start_next_round
    : action === "speed_up_cpus" ? snapshot?._cpu_tempo?.can_speed_up : snapshot?._hausdepp?.available_actions?.includes(action);
  if (pending || motionBlocksAction(action) || tournamentEnding || !allowed) return;
  handSelection?.selection.clear();
  cancelShuffle(gameId);
  pending = true;
  const commandId = `hd-${Date.now().toString(36)}-${++commandSequence}`;
  commandInFlight = { id: commandId, action, cards, acceptedVersion: null };
  $("hausdeppActionError").textContent = "";
  if (!send({ action: `hausdepp_${action}`, command_id: commandId, version: snapshot._hausdepp.version,
    ...(action === "speed_up_cpus" ? { round_number: snapshot._hausdepp_tournament?.round_number || 1 } : {}), ...(cards ? { cards } : {}) })) {
    resetCommand();
    $("hausdeppActionError").textContent = t("connectionLost");
  } else if (["play", "afterthrow"].includes(action)) launchOwnPlay(gameId, playerId, cards);
  renderState();
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { if (pending && $("hausdeppActionError")) $("hausdeppActionError").textContent = t("waitingConnection"); }, 8000);
}

function resetCommand({ returnToHand = false } = {}) {
  cancelOwnPlay(gameId, null, { returnToHand, onReturned: () => { if (!stopped) renderState(); } });
  pending = false;
  commandInFlight = null;
  queuedCards.length = 0;
  clearTimeout(pendingTimer);
}

function completeCommand() {
  if (commandInFlight) {
    if (commandInFlight.acceptedVersion === null || snapshot?._hausdepp?.version < commandInFlight.acceptedVersion) return;
    // Acknowledgement releases the command, independently of its picture.
    // A queued fresh play after own clearance stays tied to this exact state.
    for (const item of queuedCards) item.acceptedVersion = commandInFlight.acceptedVersion;
    pending = false;
    commandInFlight = null;
    clearTimeout(pendingTimer);
  } else if (!queuedCards.length) return;
  const s = snapshot._hausdepp;
  while (queuedCards.length) {
    const item = queuedCards.shift();
    const { card, behindDraw, acceptedVersion } = item;
    if (!s.hand.includes(card) || !s.playable_cards?.includes(card)) continue;
    // An afterthrow that is still open stays valid. A fresh play counts only
    // right after the player's own clearance, with nobody acting in between.
    const action = s.available_actions.includes("afterthrow") ? "afterthrow"
      : !behindDraw && s.version === acceptedVersion && s.available_actions.includes("play") ? "play" : null;
    if (action) {
      if (motionBlocksAction(action)) { queuedCards.unshift(item); return; }
      command(action, [card]);
      return;
    }
    queuedCards.length = 0;
    break;
  }
  renderState();
}

function connect() {
  if (stopped || tableStopped) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const connection = new WebSocket(`${protocol}//${location.host}/ws/${encodeURIComponent(gameId)}`);
  const lifetime = tableLifetime;
  socket = connection;
  const current = () => !stopped && socket === connection && tableLifetime === lifetime;
  connection.addEventListener("open", () => {
    if (!current()) return;
    $("hausdeppConnection").textContent = t("connected");
    reactionControls?.updateConnection();
    tablePassword ??= storedTablePassword(auth.user.id, gameId);
    send({ action: spectating ? "spectate_game" : "join_game", name: auth.user.username, ...(tablePassword ? { pass: tablePassword } : {}) });
    initChat(connection, { meName: auth.user.username, reset: !snapshot });
    if (matchMedia("(min-width: 1100px)").matches && $("chatToggle").getAttribute("aria-expanded") !== "true") $("chatToggle").click();
  });
  connection.addEventListener("message", event => {
    if (!current()) return;
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.hausdepp_voice) {
      voiceSignaling.receive(payload.hausdepp_voice);
      if (payload.hausdepp_voice.event === "state") void voice?.receive(payload.hausdepp_voice);
      return;
    }
    if (departureUI?.receive(payload)) return;
    if (payload.left_waiting_game) {
      leaveTableForLobby();
      return;
    }
    if (payload.player_id) {
      playerId = payload.player_id;
      if (!spectating) void voice?.connected();
    }
    if (payload.hausdepp_invitation) rematchInvitations?.refresh(payload.hausdepp_invitation);
    if (payload.scoreboard) {
      waitingControls?.acknowledge();
      snapshot = preserveNewerTableProps(snapshot, payload.scoreboard, gameId);
      if (!playerId && snapshot._hausdepp?.viewer_id) playerId = snapshot._hausdepp.viewer_id;
      for (const item of snapshot._chat_history || []) receiveChat(item);
      renderState();
      completeCommand();
    }
    if (departureUI?.reject(payload)) return;
    if (payload.hausdepp_table_props && snapshot?._hausdepp
      && payload.hausdepp_table_props.game_id === gameId
      && payload.hausdepp_table_props.round_number === (snapshot._hausdepp_tournament?.round_number || 1)
      && payload.hausdepp_table_props.revision >= (snapshot._hausdepp_table_props?.revision ?? -1)) {
      snapshot._hausdepp_table_props = payload.hausdepp_table_props;
      renderState();
    }
    if (payload.hausdepp_table_prop) presentTableProp($("hausdeppTable"), payload.hausdepp_table_prop);
    if (String(payload.error_code || payload.error || "").startsWith("hausdepp_table_prop_")) return;
    if (payload.hausdepp_table_effects && snapshot?._hausdepp) {
      snapshot._hausdepp_table_effects = payload.hausdepp_table_effects;
      renderTableAppearance($("hausdeppTable"), snapshot._hausdepp_table_effects);
    }
    if (payload.hausdepp_table_surprises && snapshot?._hausdepp
      && payload.hausdepp_table_surprises.round_number === (snapshot._hausdepp_tournament?.round_number || 1)) {
      snapshot._hausdepp_table_surprises = payload.hausdepp_table_surprises;
      renderState();
    }
    if (payload.hausdepp_table_surprise) {
      const surprise = payload.hausdepp_table_surprise;
      const local = surprise.actor_id === playerId && requestedSurprise === surprise.effect;
      requestedSurprise = null;
      presentTableSurprise($("hausdeppTable"), surprise, { local });
    }
    if (String(payload.error_code || payload.error || "").startsWith("hausdepp_table_surprise_")) {
      requestedSurprise = null;
      cancelTableSurprises($("hausdeppTable"));
      if (snapshot?._hausdepp_table_surprises && !payload.hausdepp_table_surprises
        && payload.error_code !== "hausdepp_table_surprise_rate_limited") snapshot._hausdepp_table_surprises.effect = null;
      renderState();
      return;
    }
    if (commandInFlight && payload.hausdepp_command?.command_id === commandInFlight.id && payload.hausdepp_command.accepted) {
      commandInFlight.acceptedVersion = payload.hausdepp_command.version;
      completeCommand();
    }
    if (payload.chat) receiveChat(payload.chat);
    if (Array.isArray(payload.chat_history)) for (const item of payload.chat_history) receiveChat(item);
    if (payload.emoji) receiveReaction(payload.emoji);
    if (payload.error === "Falsche Passphrase") {
      if (!passwordRequest) {
        passwordRequest = true;
        const incorrect = Boolean(tablePassword);
        tablePassword = "";
        rememberTablePassword(auth.user.id, gameId, "");
        void requestTablePassword(t, { incorrect, signal: lifetime.signal }).then(value => {
          if (tableLifetime !== lifetime) return;
          passwordRequest = false;
          if (stopped) return;
          if (value === null) { location.assign("/hausdepp"); return; }
          tablePassword = value;
          rememberTablePassword(auth.user.id, gameId, value);
          connect();
        });
      }
      return;
    }
    if (payload.error) {
      if (!snapshot?._started && String(payload.error).startsWith("hausdepp_")) waitingControls?.reject(payload.error);
      waitingLeaving = false;
      tournamentEnding = false;
      const code = payload.hausdepp_error?.code || payload.error;
      // The next player's card was accepted first: this throw arrived too late.
      const lateThrow = commandInFlight?.action === "afterthrow" && /stale|afterthrow_expired/.test(code);
      resetCommand({ returnToHand: true });
      if (["hausdepp_waiting_leave_not_seated", "hausdepp_waiting_already_started"].includes(code)) {
        waitingLeaving = false;
        $("hausdeppLeaveWaiting").disabled = false;
        const output = snapshot?._hausdepp ? $("hausdeppActionError") : $("hausdeppLeaveWaitingError");
        output.textContent = t(code === "hausdepp_waiting_already_started" ? "leaveWaitingStarted" : "leaveWaitingNotSeated");
        output.hidden = false;
        return;
      }
      $("hausdeppActionError").textContent = t(lateThrow ? "afterthrowLate" : code.includes("stale") ? "staleAction" : "actionRejected");
      renderState();
      if (payload.fatal) { tableStopped = true; socket.close(); }
    }
  });
  connection.addEventListener("close", event => {
    if (!current()) return;
    voiceSignaling.reset();
    departureUI?.disconnected();
    if ([1008, 4001].includes(event.code)) {
      voiceLifecycle?.revoke();
      voice?.destroy(); voiceUI?.destroy(); voice = null; voiceUI = null;
      sound?.destroy(); soundUI?.destroy(); sound = null; soundUI = null;
    }
    else voice?.disconnected();
    requestedSurprise = null;
    cancelTableSurprises($("hausdeppTable"));
    pileInspector?.close();
    peekFeedback?.disconnect();
    waitingControls?.disconnect();
    reactionControls?.updateConnection();
    waitingLeaving = false;
    tournamentEnding = false;
    resetCommand();
    if ($("hausdeppConnection")) $("hausdeppConnection").textContent = t("connectionLost");
    renderState();
    resetCardMotion(gameId);
    if (!stopped && !tableStopped && !snapshot?._aborted && event.code !== 1008 && event.code !== 4001) reconnectTimer = setTimeout(connect, 1500);
    else if (!snapshot?._aborted && $("hausdeppActionError")) $("hausdeppActionError").textContent = t("reconnectHint");
  });
}

function renderState() {
  const resultExitFocused = document.activeElement?.id === "hausdeppLeaveGameResult";
  renderStateContent();
  voiceUI?.render();
  soundUI?.render();
  departureUI?.render();
  const tableExit = $("hausdeppLeaveGame");
  if (resultExitFocused && tableExit?.getClientRects().length) {
    tableExit.focus({ preventScroll: true });
  }
}

function leaveTableForLobby() {
  stopped = true;
  pending = waitingLeaving = false;
  departureUI?.destroy();
  voiceLifecycle?.leave();
  queueVoiceTableLeft({ userId: auth.user?.id, gameType: "hausdepp" });
  voice?.destroy(); voiceUI?.destroy(); voiceSignaling.reset();
  sound?.destroy(); soundUI?.destroy();
  socket?.close();
  location.assign("/hausdepp");
}

function renderStateContent() {
  if (snapshot?._hausdepp?.phase !== "finished" || snapshot?._aborted) {
    progressNotices?.pause();
    roundProgressReceipt?.();
    cancelRoundResultPresentation();
  }
  if (snapshot?._aborted) { peekFeedback?.update(null); renderAbortedTable(); return; }
  const s = snapshot?._hausdepp;
  renderTableAppearance($("hausdeppTable"), snapshot?._hausdepp_table_effects);
  if (!s) { peekFeedback?.update(null); handSelection?.selection.cancel(); hausdeppBeginnerTour.update({ eligible: false }); if (snapshot) renderWaiting(); return; }
  document.body.classList.remove("hd-waiting-room");
  $("hausdeppWaiting").hidden = true;
  const tournament = snapshot._hausdepp_tournament;
  $("hausdeppRoomInvitation").hidden = spectating || snapshot._aborted || (s.phase === "finished" && (!tournament || tournament.completed));
  $("hausdeppRoomInvitation").querySelector("[data-invite-game]").dataset.inviteName = snapshot._name || t("defaultTable");
  if (snapshot._aborted) tournamentEnding = false;
  const dealer = s.players.find(player => player.id === tournament?.dealer_id);
  $("hausdeppTournamentBanner").hidden = !tournament;
  if (tournament) $("hausdeppTournamentBanner").textContent = t(tournament.completed ? "tournamentCompleteRound" : "tournamentRound", { round: tournament.round_number, name: dealer?.name || "…" });
  const ownLetters = tournament?.letters?.[playerId] || "";
  $("hausdeppOwnPrefix").hidden = !ownLetters;
  $("hausdeppOwnPrefix").textContent = ownLetters;
  $("hausdeppOwnPrefix").setAttribute("aria-label", t("tournamentLetters", { letters: ownLetters, losses: tournament?.losses?.[playerId] || 0 }));
  if (s.phase !== "finished") { $("hausdeppResult").hidden = true; delete $("hausdeppResult").dataset.roundId; }
  const motion = prepareCardMotion(s, { gameId, playerId });
  $("hausdeppTable").dataset.phase = s.phase;
  const roundNumber = tournament?.round_number || 1;
  if (s.phase !== "playing" || requestedSurpriseRound !== `${gameId}:${roundNumber}`) requestedSurprise = null;
  const surprise = snapshot._hausdepp_table_surprises;
  renderTableDecor($("hausdeppTable"), {
    gameId, roundNumber, phase: s.phase,
    props: snapshot._hausdepp_table_props,
    interactive: !spectating && !snapshot._paused && socket?.readyState === WebSocket.OPEN && ["peeking", "playing"].includes(s.phase),
    onPropAction: gesture => {
      if (spectating || snapshot?._paused || !["peeking", "playing"].includes(snapshot?._hausdepp?.phase)) return false;
      try { return send({ action: "hausdepp_table_prop", round_number: roundNumber, ...gesture }); }
      catch { return false; }
    },
    surprise: surprise?.round_number === roundNumber ? surprise.effect : null,
    onSurprise: effect => {
      if (spectating || requestedSurprise || snapshot?._paused || s.phase !== "playing") return false;
      if (!send({ action: "hausdepp_table_surprise", effect, round_number: roundNumber })) return false;
      requestedSurprise = effect;
      requestedSurpriseRound = `${gameId}:${roundNumber}`;
      return true;
    },
  });
  $("hausdeppRoomName").textContent = snapshot._name || t("defaultTable");
  document.title = `${snapshot._name || "Hausdepp"} · Hausdepp`;
  const connected = socket?.readyState === WebSocket.OPEN;
  const actions = connected && !snapshot._paused ? s.available_actions || [] : [];
  const motionBusy = pileMotionPending(gameId), busy = pending || motionBusy;
  const playable = new Set(s.playable_cards || []);
  const hand = [...s.hand].sort((a,b) => ranks.indexOf(a.split("-")[1]) - ranks.indexOf(b.split("-")[1]) || a.localeCompare(b));
  const selectionAction = actions.includes("afterthrow") ? "afterthrow" : actions.includes("play") ? "play" : null;
  const roundKey = `${gameId}:${tournament?.round_number || 1}`;
  handSelection.update({
    key: `${roundKey}:${s.version}`, roundKey, version: s.version, phase: s.phase, action: selectionAction,
    hand, playable: [...playable], pending: pending || (motionBusy && !actions.includes("afterthrow")), viewer: playerId, event: s.last_event,
    identity: JSON.stringify([s.phase, s.current_player_id, s.afterthrow, hand, [...actions].sort(), [...playable].sort(), s.discard]),
  });
  const selecting = handSelection.selection.enabled;
  const selected = new Set(handSelection.selection.cards);
  const oldFocus = document.activeElement?.dataset.cardId;
  const committed = new Set([...(commandInFlight?.cards || []), ...queuedCards.map(item => item.card)]);
  const launched = launchedCards(gameId);
  const pendingRank = commandInFlight?.cards?.[0]?.split("-")[1];
  const canThrow = card => {
    const queuedFollowup = pending && (card.split("-")[1] === pendingRank
      || (commandInFlight?.action === "draw" && actions.includes("afterthrow")));
    return (actions.includes("play") || actions.includes("afterthrow")) && playable.has(card)
      && (!pending || queuedFollowup) && (!motionBusy || actions.includes("afterthrow") || queuedFollowup);
  };
  renderHand(`<div class="hd-hand-fan" data-count="${hand.length}" data-compact="${hand.length >= 8}" style="--hand-count:${Math.max(1, hand.length)}">${hand.map((card, index) => cardMarkup(card, { interactive: true, playable: selecting ? handSelection.selection.canSelect(card) : canThrow(card), committed: committed.has(card), launched: launched.has(card), selecting, selected: selected.has(card), sameRank: index > 0 && hand[index - 1].split("-")[1] === card.split("-")[1], index, count: hand.length })).join("")}</div>`);
  if (oldFocus) $("hausdeppHand").querySelector(`[data-card-id="${CSS.escape(oldFocus)}"]`)?.focus({ preventScroll: true });
  $("hausdeppSelection").textContent = s.phase === "peeking" ? "" : counted("cardsInHand", hand.length);
  const mine = s.players.find(p => p.id === playerId);
  const cpuTempo = snapshot._cpu_tempo || {};
  const showCpuTempo = !spectating && mine?.finished && s.phase === "playing" && (cpuTempo.can_speed_up || cpuTempo.fast);
  $("hausdeppCpuTempo").hidden = !showCpuTempo;
  document.querySelector(".hd-hand-region").classList.toggle("has-cpu-tempo", !!showCpuTempo);
  const tempoButton = $("hausdeppSpeedUpCpus");
  tempoButton.textContent = t(cpuTempo.fast ? "fastCpuTempo" : "speedUpCpus");
  tempoButton.disabled = !!cpuTempo.fast || pending || !connected || !!snapshot._paused;
  tempoButton.setAttribute("aria-pressed", String(!!cpuTempo.fast));
  $("hausdeppCpuTempoHint").textContent = t(cpuTempo.fast ? "fastCpuTempoHint" : "speedUpCpusHint");
  $("hausdeppCpuTempoStatus").textContent = showCpuTempo && cpuTempo.fast ? t("fastCpuTempoHint") : "";
  const ownSeat = s.players.findIndex(player => player.id === playerId);
  const opponents = ownSeat < 0 ? s.players : [...s.players.slice(ownSeat + 1), ...s.players.slice(0, ownSeat)];
  const refillPlayers = new Set((s.pending_refills || []).map(debt => debt.player_id));
  const stockBlocker = s.players.find(p => p.id === s.stock_blocked_by);
  const urgentDraw = Boolean(s.draw_urgent);
  $("hausdeppPlayers").dataset.count = String(opponents.length);
  renderOpponents(opponents.map((p, i) => `<div class="hd-seat ${p.id === s.current_player_id ? "is-active" : ""} ${p.finished ? "is-finished" : ""} ${p.withdrawn ? "is-withdrawn" : ""} ${refillPlayers.has(p.id) ? "needs-draw" : ""} ${p.id === s.stock_blocked_by ? "is-draw-blocker" : ""}" data-player-id="${esc(p.id)}" style="--seat:${i};--seat-x:${(50 + 40 * Math.cos(opponents.length === 1 ? Math.PI / 2 : Math.PI - i * Math.PI / (opponents.length - 1))).toFixed(4)}%;--seat-depth:${(1 - Math.sin(opponents.length === 1 ? Math.PI / 2 : Math.PI - i * Math.PI / (opponents.length - 1))).toFixed(4)}" aria-label="${esc(`${p.name}${p.is_cpu ? `, ${t("computer")}` : ""}: ${p.withdrawn ? t("outcomeWithdrawn") : p.finished ? t("finished") : counted("cardsInHand", p.hand_count)}`)}">${opponentHand(p)}${tournament?.letters?.[p.id] ? `<b class="hd-tournament-prefix">${esc(tournament.letters[p.id])}</b>` : ""}<div class="hd-seat-plate"><strong>${esc(p.name)}</strong><span class="hd-seat-count">${p.withdrawn ? t("outcomeWithdrawn") : p.finished ? `${icon("check")} ${t("finished")}` : `<span class="hd-seat-count-n">${p.hand_count}</span><span class="hd-seat-count-unit"> ${t(p.hand_count === 1 ? "cardWordOne" : "cardWord")}</span>`}</span></div>${p.is_cpu ? `<small>${t("computer")}</small>` : ""}</div>`).join(""));
  $("hausdeppStockCount").textContent = t(s.phase === "peeking" ? "undealtCount" : "stockCount", { count: s.deck_count });
  $("hausdeppStock").classList.toggle("is-empty", !s.deck_count);
  $("hausdeppStock").classList.toggle("is-peeking", s.phase === "peeking");
  $("hausdeppStock").closest(".hd-stock-group").classList.toggle("needs-draw", Boolean(s.draw_required));
  $("hausdeppStock").closest(".hd-stock-group").classList.toggle("is-draw-blocker", urgentDraw);
  $("hausdeppDrawAlert").hidden = !urgentDraw;
  // Measure the accepted paper pose, then restore the landed projection below
  // before the browser paints. No accepted destination face is shown early.
  renderPileState(s, actions, busy, true);
  const current = s.players.find(p => p.id === s.current_player_id);
  const peeker = s.players.find(p => p.id === s.peek?.player_id);
  const afterthrow = actions.includes("afterthrow");
  $("hausdeppStatus").textContent = snapshot._paused ? t("paused") : s.phase === "peeking" ? t(actions.includes("peek") ? "yourPeek" : "playerPeek", { name: peeker?.name || "…" }) : s.phase === "finished" ? t("roundFinished") : mine?.finished ? t("youFinished") : actions.includes("draw") ? t("drawHint") : afterthrow ? t("afterthrowHint") : current?.id === playerId ? t("yourTurn") : t("playerTurn", { name: current?.name || "…" });
  $("hausdeppStatus").classList.toggle("is-yours", actions.length > 0);
  // Newer players see a short tactical tip in their own turn line; the line
  // keeps its place and highlight, so nothing on the table moves or is covered.
  const tip = !busy && !selecting && actions.includes("pickup") && !snapshot._paused ? s.table_tip : null;
  $("hausdeppStatus").classList.toggle("has-tip", Boolean(tip));
  if (tip) $("hausdeppStatus").textContent = t(tip.key, { rank: t(`rank${tip.rank}`) });
  const stockAction = actions.includes("peek") ? "peek" : actions.includes("draw") ? "draw" : "gamble";
  $("hausdeppStock").disabled = pending || motionBlocksAction(stockAction) || !actions.includes(stockAction);
  $("hausdeppStock").dataset.action = actions.includes(stockAction) ? stockAction : "";
  const stockLabel = t(stockAction === "peek" && s.private_peek?.length ? "peekNext" : stockAction);
  $("hausdeppStock").setAttribute("aria-label", `${stockLabel}, ${t("stockCount", { count: s.deck_count })}`);
  $("hausdeppStockAction").textContent = stockBlocker ? t("stockWaiting", { name: stockBlocker.name }) : actions.includes(stockAction) ? stockLabel : "";
  if (stockBlocker) $("hausdeppStock").setAttribute("aria-label", t("stockWaiting", { name: stockBlocker.name }));
  // Reading public cards stays available between turns; command() still
  // authoritatively gates the tap-to-pickup action and its pending state.
  const knownBottom = s.phase === "playing" ? s.private_peek_in_stock || [] : [];
  $("hausdeppKnownBottom").hidden = !knownBottom.length;
  $("hausdeppKnownBottomCards").hidden = !knownBottom.length;
  const knownFan = $("hausdeppKnownBottomCards").querySelector(".hd-known-bottom-fan");
  if (knownFan.dataset.cards !== knownBottom.join()) {
    knownFan.dataset.cards = knownBottom.join();
    knownFan.innerHTML = knownBottom.slice(0, 3).map(card => cardMarkup(card)).join("");
  }
  $("hausdeppKnownBottom").textContent = knownBottom.length ? t("knownBottom", { cards: knownBottom.map(card => t(`rank${card.split("-")[1]}`)).join(" · ") }) : "";
  if (knownBottom.length && !stockBlocker) $("hausdeppStock").setAttribute("aria-label", `${$("hausdeppStock").getAttribute("aria-label")}. ${t("knownBottomLabel", { cards: knownBottom.map(cardName).join(", ") })}`);
  // Refilling is mandatory, so the stock is tapped once for everyone as soon
  // as the own refill is due. A manual tap remains a harmless fallback.
  if (!pending && !motionBlocksAction("draw") && !spectating && actions.includes("draw") && autoRefillVersion !== s.version) {
    autoRefillVersion = s.version;
    queueMicrotask(() => { if (!pending && !motionBlocksAction("draw") && snapshot?._hausdepp?.available_actions?.includes("draw")) command("draw"); });
  }
  const e = s.last_event || {};
  const actor = s.players.find(p => p.id === e.player_id);
  const eventKey = e.type === "withdraw" ? "eventWithdraw" : s.phase === "peeking" ? "eventPeeking" : e.type === "draw" ? "eventDraw" : e.burn_reason ? actor?.finished ? "eventBurnFinished" : "eventBurn" : e.type === "pickup" || (e.type === "gamble" && !e.success) ? "eventPickup" : ["play", "afterthrow", "gamble"].includes(e.type) ? "eventPlay" : "eventStart";
  $("hausdeppEvent").textContent = counted(eventKey, e.drawn_count || e.picked_up_count || e.cards?.length || 0, { name: actor?.name || peeker?.name || "" });
  peekFeedback.update(s, roundKey, playerId);
  animateCardMotion(s, { gameId, playerId, fastCpu: !!cpuTempo.fast, peekCaption: (receiver, cards) => {
    const names = cards.map(card => t(`rank${card.split("-")[1]}`)).join(" · ");
    return receiver === playerId ? t("peekRevealSelf", { cards: names })
      : t("peekRevealOther", { name: s.players.find(player => player.id === receiver)?.name || "…", cards: names });
  } }, motion);
  renderPileState({ ...s, ...presentedPile(gameId, s) }, actions, pending || pileMotionPending(gameId));
  presentShuffle(connected && !pending ? s : null, { gameId, roundNumber: tournament?.round_number || 1 });
  hausdeppBeginnerTour.update({
    eligible: !spectating && !!playerId && !snapshot._aborted && s.phase === "playing" && !mine?.finished,
    canAct: connected && !snapshot._paused && actions.length > 0,
    busy,
    canPlay: actions.includes("play") || actions.includes("afterthrow"),
    canDraw: actions.includes("draw") || actions.includes("gamble"),
    canPickup: actions.includes("pickup"),
  });
  requestAnimationFrame(positionReactions);
  if (s.phase === "finished") {
    if (!roundResultReady(`${gameId}:${tournament?.round_number || 1}`, Boolean(motion.previous && motion.previous.phase !== "finished"))) return;
    const loser = s.players.find(p => p.id === s.loser_id);
    const finalLoser = s.players.find(p => p.id === tournament?.tages_hausdepp_id);
    const roundKey = `${gameId}:${tournament?.round_number || 1}:${Boolean(tournament?.completed)}:${Boolean(tournament?.can_start_next_round)}:${Boolean(snapshot._aborted)}:${JSON.stringify(tournament?.departed_ids || [])}`;
    $("hausdeppResult").hidden = false;
    if ($("hausdeppResult").dataset.roundId === roundKey) {
      const recreate = $("hausdeppRecreate");
      if (recreate) recreate.disabled = rematchCreating;
      const next = $("hausdeppNextRound");
      if (next) next.disabled = pending || tournamentEnding || !connected || snapshot._paused;
      const end = $("hausdeppEndTournament");
      if (end) end.disabled = pending || tournamentEnding || !connected;
      return;
    }
    $("hausdeppResult").dataset.roundId = roundKey;
    const title = snapshot._aborted ? t("tournamentStopped") : tournament?.completed ? finalLoser
      ? `${t("tournamentComplete")}. ${t("tournamentLoser", { name: finalLoser.name })}` : t("tournamentWithoutHausdepp")
      : loser ? t("loser", { name: loser.name }) : t("roundWithoutHausdepp");
    $("hausdeppResult").innerHTML = `<h2>${esc(title)}</h2><p class="hd-result-context">${esc(roundResultContext(s, tournament))}</p>${snapshot._aborted ? "" : roundPlacements(s, snapshot._hausdepp_round_summary)}${tournamentScoreboard(tournament, snapshot._participants?.length ? snapshot._participants.map(player => seatIdentity(player)) : s.players)}<div id="hausdeppRoundProgress" hidden></div><div class="hd-result-links">${tournament && !tournament.completed && !snapshot._aborted ? tournament.can_start_next_round ? `<button id="hausdeppNextRound" class="hd-primary" type="button" ${pending || tournamentEnding || !connected || snapshot._paused ? "disabled" : ""}>${t("startNextRound", { round: nonnegative(tournament.round_number) + 1 })} ${icon("arrow")}</button><button id="hausdeppEndTournament" class="hd-secondary" type="button" ${pending || tournamentEnding || !connected ? "disabled" : ""}>${t("endTournament")}</button>` : `<p class="hd-tournament-wait">${t("tournamentHostWait")}</p>` : `<a class="hd-primary" href="/hausdepp">${t(tournament ? "newTournament" : "nextRound")} ${icon("arrow")}</a>`}<a href="/hausdepp/konto#erfolge">${t("resultAccountLink")}</a></div>`;
    if (snapshot._finished && (!tournament || tournament.completed) && hasPreviousSeat()) appendRematchAction();
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
    if (!spectating) { renderRoundProgress($("hausdeppRoundProgress")); void loadRoundProgress(roundKey); }
  }
}

function cancelRoundResultPresentation() {
  const presentation = roundResultPresentation;
  if (!presentation) return;
  roundResultPresentation = null;
  clearTimeout(presentation.timer);
  presentation.controller.abort();
  presentation.motion.removeEventListener("change", presentation.onMotion);
  document.removeEventListener("visibilitychange", presentation.onVisibility);
}

function roundResultVisible() {
  return Boolean($("hausdeppResult")?.getClientRects().length);
}

function roundResultReady(key, liveEnd) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  if (roundResultPresentation?.key === key) {
    if (motion.matches || socket?.readyState !== WebSocket.OPEN) {
      roundResultPresentation.ready = true;
      clearTimeout(roundResultPresentation.timer);
      roundResultPresentation.controller.abort();
      roundResultPresentation.motion.removeEventListener("change", roundResultPresentation.onMotion);
      document.removeEventListener("visibilitychange", roundResultPresentation.onVisibility);
    }
    return roundResultPresentation.ready;
  }
  cancelRoundResultPresentation();
  // Reloads/reconnects hydrate the final state without replaying a last turn.
  if (motion.matches || document.hidden || socket?.readyState !== WebSocket.OPEN) return true;
  const controller = new AbortController();
  const completion = cardMotionCompletion(gameId, { signal: controller.signal });
  if (!completion && !liveEnd) return true;
  const presentation = { key, ready: false, timer: null, motion, controller };
  const show = () => {
    if (stopped || roundResultPresentation !== presentation) return;
    presentation.ready = true;
    clearTimeout(presentation.timer);
    controller.abort();
    motion.removeEventListener("change", presentation.onMotion);
    document.removeEventListener("visibilitychange", presentation.onVisibility);
    renderState();
  };
  presentation.onMotion = () => { if (motion.matches) show(); };
  presentation.onVisibility = () => { if (document.hidden) show(); };
  motion.addEventListener("change", presentation.onMotion);
  document.addEventListener("visibilitychange", presentation.onVisibility);
  roundResultPresentation = presentation;
  void (completion || Promise.resolve()).then(() => {
    if (roundResultPresentation !== presentation || presentation.ready || stopped) return;
    if (motion.matches || document.hidden) show();
    else presentation.timer = setTimeout(show, 750);
  });
  return false;
}


function hasPreviousSeat() {
  return !spectating && snapshot?._participants?.some(player => !player.is_cpu && (player.id === playerId || player.user_id === auth?.user?.id));
}

function roundResultContext(state, tournament) {
  const cpuCount = state.players.filter(player => player.is_cpu).length;
  return [tournament ? t("tournamentRoundShort", { round: tournament.round_number }) : "",
    counted("roundPeople", state.players.length), cpuCount ? counted("roundCpuCount", cpuCount) : t("roundHumansOnly")]
    .filter(Boolean).join(" · ");
}

// The table shows this round's credit separately from the current account.
// Account catch-up notices never stand in for a round's actual earnings.
function renderRoundProgress(container, data) {
  const earned = snapshot?._hausdepp_round_summary?.players?.[playerId];
  const hasCredit = Number.isFinite(earned?.xp) && Number.isFinite(earned?.round_xp);
  const scoring = data?.scoring;
  const hasAccount = scoring?.available && Number.isFinite(scoring.points) && data?.rank?.name;
  container.hidden = !hasCredit && !hasAccount;
  container.className = "hd-round-progress";
  const awards = hasCredit ? (earned.achievements || []).reduce((sum, award) => sum + nonnegative(award.points), 0) : 0;
  const creditDetail = hasCredit ? awards
    ? t("roundCreditBreakdown", { round: pointNumber(earned.round_xp), awards: pointNumber(awards) })
    : t(snapshot._hausdepp.players.some(player => player.is_cpu) ? "roundCreditCpu" : "roundCreditHuman", { points: pointNumber(earned.round_xp) }) : "";
  const rank = data?.rank;
  const next = rank?.next;
  container.innerHTML = `${hasCredit ? `<p class="hd-round-earned"><strong>${esc(t("roundEarned", { points: pointNumber(earned.xp) }))}</strong><span>${esc(creditDetail)}</span></p>` : ""}${hasAccount ? `<div class="hd-round-account"><p><span>${t("currentRank")}: <strong>${esc(localized(rank.name))}</strong></span><span>${esc(t("roundAccountTotal", { points: pointNumber(scoring.points) }))}</span></p>${next && Number.isFinite(next.threshold) ? `<p class="hd-round-next">${esc(t("roundRankNext", { points: pointNumber(Math.max(0, next.threshold - scoring.points)), name: localized(next.name) }))}</p>` : ""}</div>` : ""}`;
}

// Everyone's place in the round just played, with what each person earned.
function roundPlacements(s, summary) {
  const order = [...(s.finished_order || []), ...(s.loser_id ? [s.loser_id] : s.remaining_player_id ? [s.remaining_player_id] : []), ...(s.withdrawn_ids || [])];
  const missing = s.players.filter(player => !order.includes(player.id)).map(player => player.id);
  const rows = [...order, ...missing].map((id, index) => {
    const player = s.players.find(item => item.id === id);
    if (!player) return "";
    const loser = id === s.loser_id;
    const withdrawn = player.withdrawn || player.outcome === "withdrawn" || s.withdrawn_ids?.includes(id);
    const remaining = player.outcome === "remaining" || id === s.remaining_player_id;
    const earned = summary?.players?.[id];
    const awards = (earned?.achievements || []).map(award => `<li><span class="hd-result-award-name">${esc(award.name?.[lang()] || award.name?.de || "")}</span><small>${esc(earnedXp(award.points))}</small></li>`).join("");
    const reward = player.is_cpu ? `<span class="hd-result-reward is-cpu">${t("computer")}</span>`
      : earned?.xp != null ? `<span class="hd-result-reward">${esc(earnedXp(earned.xp))}</span>` : "";
    const place = withdrawn ? t("outcomeWithdrawn") : remaining ? t("outcomeRemaining") : loser ? t("resultHausdepp")
      : s.finished_order?.includes(id) ? t("resultPlace", { place: index + 1 }) : t("outcomeUnknown");
    return `<li class="hd-result-place${loser ? " is-hausdepp" : ""}${id === playerId ? " is-self" : ""}"><span class="hd-result-rank">${place}</span><span class="hd-result-avatar">${seatAvatar(player, { key: `result-${player.id}` })}</span><span class="hd-result-name" translate="no">${esc(player.name)}</span>${reward}${awards ? `<ul class="hd-result-awards" aria-label="${esc(t("resultAwards"))}">${awards}</ul>` : ""}</li>`;
  }).join("");
  return `<ol class="hd-result-places" aria-label="${esc(t("resultPlacements"))}">${rows}</ol>`;
}

function tournamentScoreboard(tournament, players) {
  if (!tournament) return "";
  const departed = new Set(tournament.departed_ids || []);
  return `<ul class="hd-tournament-score">${players.map(player => `<li class="${player.id === tournament.tages_hausdepp_id ? "is-hausdepp" : ""}"><span>${esc(player.name)}${departed.has(player.id) ? `<small class="hd-tournament-departed">${t("outcomeWithdrawn")}</small>` : ""}</span><strong aria-label="${esc(t("tournamentLetters", { letters: tournament.letters?.[player.id] || "", losses: tournament.losses?.[player.id] || 0 }))}">${esc(tournament.letters?.[player.id] || "—")}</strong><small>${nonnegative(tournament.losses?.[player.id])} / 8</small></li>`).join("")}</ul>`;
}

function renderAbortedTable() {
  resetCardMotion(gameId);
  hausdeppBeginnerTour.update({ eligible: false });
  pileInspector?.close();
  handSelection?.update({ phase: "finished", action: null, hand: [], playable: [], pending: false });
  document.body.classList.remove("hd-waiting-room");
  $("hausdeppWaiting").hidden = true;
  $("hausdeppTable").classList.add("is-aborted");
  $("hausdeppTable").dataset.phase = "finished";
  $("hausdeppRoomName").textContent = snapshot._name || "Hausdepp";
  const tournament = snapshot._hausdepp_tournament;
  renderTableDecor($("hausdeppTable"), { gameId, roundNumber: tournament?.round_number || 1, phase: "finished" });
  const result = $("hausdeppResult");
  result.hidden = false;
  const abortKey = `${gameId}:aborted:${snapshot._abort_reason || ""}:${Boolean(snapshot._started)}:${tournament?.round_number || 0}`;
  if (result.dataset.roundId === abortKey) return;
  result.dataset.roundId = abortKey;
  const reason = snapshot._abort_reason === "inactivity_timeout" && !snapshot._started ? "waitingExpired" : "abortedNoScore";
  result.innerHTML = `<h2>${t(tournament ? "tournamentStopped" : "abortedTable")}</h2><p>${t(tournament ? "tournamentStoppedHint" : reason)}</p>${tournamentScoreboard(tournament, snapshot._hausdepp?.players || snapshot._participants || [])}<div class="hd-result-links"><a class="hd-primary" href="/hausdepp">${t("lobby")}</a>${tournament ? `<a href="/hausdepp/konto#erfolge">${t("accountProgressLink")}</a>` : ""}</div>`;
  if (hasPreviousSeat()) appendRematchAction();
}

function appendRematchAction() {
  const previous = $("hausdeppResult").querySelector(".hd-result-links > .hd-primary");
  if (!previous) return;
  const button = document.createElement("button");
  button.id = "hausdeppRecreate";
  button.className = "hd-primary";
  button.type = "button";
  button.textContent = t("rematchCreate");
  button.disabled = rematchCreating;
  previous.replaceWith(button);
  const lobby = document.createElement("a");
  lobby.className = "hd-secondary";
  lobby.href = "/hausdepp";
  lobby.textContent = t("lobby");
  button.after(lobby);
  const output = document.createElement("p");
  output.id = "hausdeppRematchError";
  output.className = "hd-error";
  output.setAttribute("role", "alert");
  $("hausdeppResult").append(output);
  button.addEventListener("click", async () => {
    if (rematchCreating || stopped) return;
    rematchCreating = true;
    button.disabled = true;
    output.textContent = "";
    const lifetime = tableLifetime;
    try {
      const target = await createRematch(gameId, { signal: lifetime.signal });
      if (!stopped && tableLifetime === lifetime) {
        voiceLifecycle?.handoff(decodeURIComponent(target.split("/").at(-1)));
        switchTable(target);
      }
    } catch (error) {
      if (!stopped && tableLifetime === lifetime) output.textContent = rematchError(error, t);
    } finally {
      if (tableLifetime === lifetime) rematchCreating = false;
      if (button.isConnected) button.disabled = false;
    }
  });
}

// The round summary stays visible. Its receipt is presentation bookkeeping,
// so only a foreground, on-screen summary is confirmed, without another tap.
function acknowledgeRoundProgressWhenVisible(container, notice, roundKey) {
  roundProgressReceipt?.();
  if (container.hidden || !notice || notice.revision <= acknowledgedProgressRevision) return;
  let onScreen = false;
  const current = () => !stopped && container.isConnected && !container.hidden
    && $("hausdeppResult")?.dataset.roundId === roundKey;
  const cleanup = () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", acknowledge);
    if (roundProgressReceipt === cleanup) roundProgressReceipt = null;
  };
  const acknowledge = () => {
    if (!current()) { cleanup(); return; }
    if (document.hidden || !onScreen) return;
    cleanup();
    void json("/api/hausdepp/account/acknowledge", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: notice.revision }),
    }).then(() => {
      if (!stopped) acknowledgedProgressRevision = Math.max(acknowledgedProgressRevision, notice.revision);
    }).catch(() => {
      // Keep the saved points and actions visible. A failed receipt can be
      // retried on the next visit; it never blocks leaving or playing again.
    });
  };
  const observer = new IntersectionObserver(entries => {
    onScreen = entries.some(entry => entry.isIntersecting);
    acknowledge();
  });
  roundProgressReceipt = cleanup;
  document.addEventListener("visibilitychange", acknowledge);
  observer.observe(container);
}

async function loadRoundProgress(roundKey) {
  try {
    const data = await json("/api/hausdepp/account?limit=1");
    if (stopped || !$("hausdeppRoundProgress") || $("hausdeppResult").dataset.roundId !== roundKey) return;
    const container = $("hausdeppRoundProgress");
    renderRoundProgress(container, data);
    const earned = snapshot?._hausdepp_round_summary?.players?.[playerId];
    const notice = data.presentation?.pending;
    // Pending account notices may cover several rounds. Only acknowledge this
    // round automatically when every part of that notice is actually visible.
    const roundAwards = (earned?.achievements || []).map(award => award.id).sort();
    if (data.history?.rounds?.[0]?.game_id === snapshot?._hausdepp_round_summary?.round_id
        && (!notice?.rank_up || (data.scoring?.available && data.rank?.name))
        && earned?.xp != null && notice?.points_earned === earned.xp
        && JSON.stringify([...(notice.achievement_ids || [])].sort()) === JSON.stringify(roundAwards)) {
      acknowledgeRoundProgressWhenVisible(container, notice, roundKey);
    }
    if (!snapshot?._aborted) void progressNotices?.refresh();
  } catch {
    // The final account link remains available when the summary cannot load.
  }
}

function renderWaiting() {
  pileInspector?.close();
  document.body.classList.add("hd-waiting-room");
  $("hausdeppTable").dataset.phase = "waiting";
  $("hausdeppWaiting").hidden = false;
  $("hausdeppLeaveWaiting").hidden = spectating || snapshot._waiting_permissions?.can_leave !== true;
  $("hausdeppLeaveWaiting").disabled = waitingLeaving || socket?.readyState !== WebSocket.OPEN;
  $("hausdeppRoomName").textContent = snapshot._name || t("defaultTable");
  document.title = `${snapshot._name || "Hausdepp"} · Hausdepp`;
  const participants = snapshot._participants || [];
  const expected = Math.max(2, Math.min(6, Number(snapshot._expected) || 2));
  const free = Math.max(0, expected - participants.length);
  const isHost = !spectating && snapshot._waiting_permissions?.is_host === true;
  const invitation = $("hausdeppWaiting").querySelector("[data-invite-game]");
  invitation.dataset.inviteName = snapshot._name || t("defaultTable");
  invitation.dataset.inviteCanCall = !spectating && !snapshot.locked && !snapshot._started && !snapshot._finished && !snapshot._aborted && (free > 0 || snapshot._replaceable_cpus > 0) && participants.some(player => player.id === playerId && !player.is_cpu) ? "1" : "0";
  invitations?.sync();
  $("hausdeppRoomInvitation").hidden = true;
  $("hausdeppWaitingMode").textContent = `${t(snapshot._waiting_mode === "open" ? "creatorOpenMode" : "creatorFixed")} · ${t(snapshot._hausdepp_tournament_enabled ? "tournament" : "quickGame")}${snapshot.locked ? ` · ${t("creatorProtected")}` : ""}`;
  const reason = snapshot._waiting_permissions?.start_reason;
  $("hausdeppWaitingCount").textContent = isHost && reason === "hausdepp_waiting_minimum_players" ? t("waitingNeedOne")
    : isHost && reason === "hausdepp_waiting_not_full" ? t("waitingNeedSeats", { count: free })
    : isHost && reason === "hausdepp_waiting_players_offline" ? t("waitingOffline")
    : t("seatSummary", { occupied: participants.length, total: expected });
  const focus = $("hausdeppWaitingSeats").contains(document.activeElement) ? document.activeElement?.dataset.participantId : null;
  replaceChildrenPreservingAvatars($("hausdeppWaitingSeats"), Array.from({ length: expected }, (_, index) => waitingSeatMarkup(participants[index], { t, avatar: player => seatAvatar(player, { key: `waiting-${player.id}` }), isHost, selfId: playerId })).join(""));
  waitingControls?.update(snapshot);
  if (focus) {
    const same = [...$("hausdeppWaitingSeats").querySelectorAll("[data-participant-id]")].find(button => button.dataset.participantId === focus);
    (same || $("hausdeppAddCpu"))?.focus({ preventScroll: true });
  }
}

function renderRules() {
  document.title = t("rulesTitle");
  const sections = [{ id: "ziel", key: "goal" }, { id: "kartenwerte", key: "deck" }, { id: "abheben", key: "peek", example: true }, { id: "austeilen", key: "deal" }, { id: "dein-zug", key: "moves", example: true }, { id: "abraeumen", key: "burn", example: true }, { id: "auffuellen", key: "refill", example: true }, { id: "nachwerfen", key: "after", example: true }, { id: "endspiel", key: "end", example: true }, { id: "taktik", key: "tips" }, { id: "bedienung", key: "interface" }, { id: "punkte-erfolge", key: "scoring" }, { id: "turnier", key: "tournament" }, { id: "neu-erstellen", key: "rematch" }];
  const rankLine = `<div class="hd-rank-line" aria-label="${t("rankOrder")}">${ranks.map(rank => `<span>${esc(t(`rank${rank}`))}</span>`).join("<b aria-hidden='true'>‹</b>")}</div>`;
  root.innerHTML = `<article class="hd-rulebook"><div class="hd-rulebook-heading"><h1>${t("rulesTitle")}</h1><p>${t("rulesIntro")}</p></div><section id="schnellstart" class="hd-rules-quickstart" aria-labelledby="hausdeppQuickstartTitle"><h2 id="hausdeppQuickstartTitle">${t("quickstartHeading")}</h2><ol>${["quickstartOne", "quickstartTwo", "quickstartThree"].map(key => `<li>${t(key)}</li>`).join("")}</ol></section><nav class="hd-rules-toc" aria-label="${t("rulesContents")}"><p>${t("rulesContents")}</p><ol>${sections.map(({ id, key }) => `<li><a href="#${id}">${t(`${key}Nav`)}</a></li>`).join("")}</ol></nav>${sections.map(({ id, key, example }) => `<section id="${id}" class="hd-rule-section" aria-labelledby="rule-${id}"><h2 id="rule-${id}">${t(`${key}Heading`)}</h2><p>${t(`${key}Body`)}</p>${key === "deck" ? rankLine : ""}${key === "scoring" ? `<h3>${t("surpriseAchievementsHeading")}</h3><p>${t("surpriseAchievementsBody")}</p><a href="/hausdepp/konto#erfolge">${t("accountProgressLink")} ${icon("arrow")}</a>` : ""}${example ? `<aside class="hd-rule-example"><strong>${t("exampleLabel")}</strong><p>${t(`${key}Example`)}</p></aside>` : ""}</section>`).join("")}<section id="begriffe"><h2>${t("glossaryHeading")}</h2><ul class="hd-rules-glossary">${["glossaryStock", "glossaryPile", "glossaryClear", "glossaryFinish"].map(key => `<li>${t(key)}</li>`).join("")}</ul></section><section id="einsteigertouren" class="hd-rule-section"><h2>${t("tourHeading")}</h2><p>${t("tourBody")}</p></section><section id="tisch-eroeffnen" class="hd-rule-section"><h2>${t("setupHeading")}</h2><p>${t("setupBody")}</p></section><section id="sprachchat" class="hd-rule-section"><h2>${t("voiceRulesHeading")}</h2><p>${t("voiceRulesBody")}</p></section><section id="wirtshauskulisse" class="hd-rule-section"><h2>${t("soundRulesHeading")}</h2><p>${t("soundRulesBody")}</p></section><section id="aussteigen" class="hd-rule-section"><h2>${t("departureRulesHeading")}</h2><p>${t("departureRulesBody")}</p></section><section id="karten" class="hd-rule-credits"><h2>${t("cardCredits")}</h2><p>${t("creditsBody")} <a href="https://commons.wikimedia.org/wiki/File:Doppeldeutsche_Preference.JPG" target="_blank" rel="noopener noreferrer">FUZxxl / Karl432</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a> · <a href="https://commons.wikimedia.org/wiki/File:Original-Hungarian-Tell-set.jpg" target="_blank" rel="noopener noreferrer">SZERVÁC Attila</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a></p></section><a class="hd-primary" href="/hausdepp">${t("takeSeat")} ${icon("arrow")}</a></article>${footer()}`;
}

async function start() {
  try {
    initializeAvatarFallbacks();
    try { auth = await loadAuth(); }
    catch (error) {
      if (!["lobby", "rules"].includes(page)) throw error;
      authUnavailable = true;
      auth = { authenticated: false, user: null };
    }
    if (!auth.authenticated && !["lobby", "rules"].includes(page)) { location.replace(signInUrl()); return; }
    const access = auth.game_access || auth.user?.game_access;
    if (auth.authenticated && !access?.hausdepp_public && !access?.hausdepp_preview) throw new Error(t("accessDenied"));
    header();
    document.querySelector('meta[name="description"]')?.setAttribute("content", t(page === "account" ? "accountMetaDescription" : page === "leaderboard" ? "leaderboardMetaDescription" : page === "rules" ? "rulesMetaDescription" : "metaDescription"));
    if (page === "table") {
      try { await prepareCardAssets(); } catch { throw new Error(t("cardsLoadFailed")); }
    }
    if (page === "rules") renderRules(); else if (page === "settings") renderAccountSettings(root, auth, { onUserChanged: data => { auth = data; header(); } }); else if (page === "account") renderAccount(); else if (page === "leaderboard") renderLeaderboard(); else if (page === "table") renderTableShell(); else renderLobby();
    if (page === "lobby" || page === "table") invitations = mountInvitations(root, t);
    document.body.classList.remove("hd-loading");
    if (page === "lobby") showVoiceTableLeft({ userId: auth.user?.id, gameType: "hausdepp", t });
    if (["lobby", "account", "settings"].includes(page)) initializeReleaseNotes({ context: "hausdepp" });
    if (page === "lobby") initializePushOptInPrompt({ context: "hausdepp" });
    if (auth.authenticated && !spectating) {
      progressNotices = mountProgressNotices({
        userId: auth.user.id,
        canPresent: () => !stopped && (page !== "table" || Boolean(snapshot?._hausdepp?.phase === "finished" && !snapshot?._aborted && roundResultVisible())),
        onPending: () => {
          popupProgressPending = true;
          if ($("hausdeppProgressNotice")) $("hausdeppProgressNotice").hidden = true;
        },
        onComplete: data => { acknowledgedProgressRevision = Math.max(acknowledgedProgressRevision, data.revision); },
      });
      if (page !== "table") void progressNotices.refresh();
    }
    if (auth.authenticated) rematchInvitations = mountRematchInvitations({
      userId: auth.user.id, t,
      navigate: switchTable,
      canPresent: () => !stopped && (page !== "table" || (
        (spectating || Boolean(snapshot && (!snapshot._started || snapshot._finished)))
        && (!(snapshot?._finished || snapshot?._hausdepp?.phase === "finished") || roundResultVisible())
      )),
    });
  } catch (error) { root.innerHTML = `<section class="hd-unavailable"><h1>Hausdepp</h1><p role="alert">${esc(error.message || t("requestFailed"))}</p><a class="hd-secondary" href="${zdwaAppEntryUrl()}">${t("backSuite")}</a></section>`; document.body.classList.remove("hd-loading"); }
}

window.addEventListener("resize", positionReactions);
window.addEventListener("popstate", () => {
  if (page !== "table" || stopped) return;
  switchTable(location.href, { historyMode: "none" });
});
window.addEventListener("zdwa:auth-state", event => {
  if (stopped || !auth || (auth.user?.id || null) === (event.detail?.user?.id || null)) return;
  // Public discovery must not leave the preceding account's private table or
  // progress mounted after sign-out or an account change in another tab.
  stopped = true;
  voiceLifecycle?.revoke();
  voice?.destroy(); voiceUI?.destroy(); voiceSignaling.reset();
  sound?.destroy(); soundUI?.destroy();
  departureUI?.destroy();
  cancelTableSurprises($("hausdeppTable"));
  roundProgressReceipt?.();
  cancelRoundResultPresentation();
  clearInterval(lobbyTimer);
  gameCreator?.destroy();
  waitingControls?.destroy();
  reactionControls?.destroy();
  root.replaceChildren();
  progressNotices?.destroy();
  rematchInvitations?.destroy();
  rematchLifetime.abort();
  socket?.close();
  if (page === "settings" && !event.detail?.user) location.replace("/hausdepp");
  else location.reload();
});
window.addEventListener("pagehide", () => { voice?.destroy(); voiceUI?.destroy(); voiceSignaling.reset(); sound?.destroy(); soundUI?.destroy(); departureUI?.destroy(); stopped = true; disposeTable(); gameCreator?.destroy(); progressNotices?.destroy(); rematchLifetime.abort(); stopLobbyDemo?.(); invitations?.destroy(); clearInterval(lobbyTimer); });
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void start();
