import { apiFetch, authError, escapeHtml, loadAuth, logout } from "../shared/auth.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import {
  applyZilchRouteLinks,
  normalizeZilchPageUrl,
  zilchPath,
  zilchRoutePath,
} from "../multigame/routes.js";

const root = document.querySelector("[data-zilch-root]");
const content = document.getElementById("zilchContent");
const liveAnnouncements = document.getElementById("zilchLiveAnnouncements");
applyZilchRouteLinks();
const currentZilchRoute = zilchRoutePath(window.location.pathname);
const gameIdMatch = currentZilchRoute?.match(/^\/spiel\/([^/]+)$/);
const resultIdMatch = currentZilchRoute?.match(/^\/ergebnis\/([^/]+)$/);
function decodedPathSegment(match) {
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch (_) { return null; }
}
const gameId = decodedPathSegment(gameIdMatch);
const resultId = decodedPathSegment(resultIdMatch);
const historyRoute = currentZilchRoute === "/historie";
const rulesRoute = currentZilchRoute === "/regeln";
const statisticsRoute = currentZilchRoute === "/statistiken";
const leaderboardsRoute = currentZilchRoute === "/bestenlisten";
const achievementsRoute = currentZilchRoute === "/erfolge";
const accountRoute = currentZilchRoute === "/konto";
const playerAchievementsMatch = currentZilchRoute?.match(/^\/spieler\/([^/]+)$/);
const playerAchievementsUsername = decodedPathSegment(playerAchievementsMatch);
const ZILCH_ACTIVE_GAME_STORAGE_KEY = "zilch_active_game_id";
const ZILCH_LEADERBOARD_LIMIT = 100;
const ZILCH_ROLL_REVEAL_DURATION_MS = 500;
const ZILCH_EVENT_OVERLAY_DURATION_MS = 1_350;
const ZILCH_RECOMMENDATION_SHORTCUTS = ["q", "w", "e", "r", "t", "z", "u", "i"];
const ZILCH_LEADERBOARD_CATEGORIES = new Set(["solo_sprint", "multiplayer_wins", "cpu_wins", "achievement_points"]);
const state = {
  auth: null,
  details: null,
  game: null,
  result: null,
  socket: null,
  playerId: null,
  reconnectTimer: null,
  stopped: false,
  pendingAction: null,
  pendingOptionId: null,
  draftHoldKey: "",
  draftHoldIndices: [],
  notebookScroll: new Map(),
  notebookTransition: null,
  zilchMoment: null,
  zilchMomentTimer: null,
  presentedZilchEvents: new Set(),
  diceLandingPending: false,
  status: null,
  statusKind: "info",
  activeGameId: gameId || "",
  gamePassphrase: "",
  rules: null,
  confirmingSoloAbandon: false,
  statistics: null,
  statisticsMode: "overview",
  statisticsCpuStrategy: "all",
  leaderboard: null,
  leaderboardCategory: "solo_sprint",
  leaderboardStrategy: "conservative",
  leaderboardOffset: 0,
  achievements: null,
  achievementRankLegend: null,
  playerAchievements: null,
  awardPresentationPromise: null,
  awardPresentationActive: false,
  awardPresentationCheckedScopes: new Set(),
  terminalAwards: [],
  terminalAwardGameId: "",
  chatOpen: false,
  accountTab: "statistics",
  accountHashListenerBound: false,
};

function t(value) {
  return window.ZDWA_I18N?.t?.(value) || String(value || "");
}

function message(key, params = {}) {
  return window.ZDWA_I18N?.message?.(key, params) || t(key);
}

function interpolated(value, params = {}) {
  return String(t(value)).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => String(params?.[name] ?? ""));
}

function localizedServerMessage(key, params = {}, fallback = "") {
  const normalizedKey = String(key || "");
  if (!normalizedKey) return fallback;
  const rendered = message(normalizedKey, params);
  return rendered && rendered !== normalizedKey ? rendered : fallback;
}

function sameId(first, second) {
  return String(first || "") === String(second || "");
}

function samePresentId(first, second) {
  return Boolean(String(first || "") && String(second || "") && sameId(first, second));
}

function number(value) {
  return new Intl.NumberFormat(window.ZDWA_I18N?.locale?.() || "de-CH").format(Number(value || 0));
}

function formattedDateTime(value) {
  if (!value) return t("Nicht verfügbar");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("Nicht verfügbar");
  return new Intl.DateTimeFormat(window.ZDWA_I18N?.locale?.() || "de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formattedDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return t("Nicht verfügbar");
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (hours) return `${hours} ${t("Std.")} ${minutes} ${t("Min.")}`;
  if (minutes) return `${minutes} ${t("Min.")} ${remainingSeconds} ${t("Sek.")}`;
  return `${remainingSeconds} ${t("Sek.")}`;
}

function storageKey(kind) {
  return `zilch_${kind}_${gameId || "lobby"}`;
}

function localValue(kind) {
  try { return localStorage.getItem(storageKey(kind)) || ""; } catch (_) { return ""; }
}

function setLocalValue(kind, value) {
  try { localStorage.setItem(storageKey(kind), String(value || "")); } catch (_) {}
}

function clearLocalSession() {
  try {
    localStorage.removeItem(storageKey("player"));
    localStorage.removeItem(storageKey("resume"));
  } catch (_) {}
  if (gameId) rememberGuestHostToken(gameId, "");
}

function hasStoredGameSession(id) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) return false;
  try {
    return Boolean(
      localStorage.getItem(`zilch_player_${normalizedId}`)
      && localStorage.getItem(`zilch_resume_${normalizedId}`),
    );
  } catch (_) {
    return false;
  }
}

function passphraseStorageKey(id) {
  return `zilch_pass_${String(id || "")}`;
}

function storedPassphrase(id) {
  try { return sessionStorage.getItem(passphraseStorageKey(id)) || ""; } catch (_) { return ""; }
}

function rememberPassphrase(id, value) {
  const passphrase = String(value || "");
  try {
    if (passphrase) sessionStorage.setItem(passphraseStorageKey(id), passphrase);
    else sessionStorage.removeItem(passphraseStorageKey(id));
  } catch (_) {}
  return passphrase;
}

function guestHostTokenStorageKey(id) {
  return `zilch_guest_host_${String(id || "")}`;
}

function storedGuestHostToken(id) {
  try { return sessionStorage.getItem(guestHostTokenStorageKey(id)) || ""; } catch (_) { return ""; }
}

function rememberGuestHostToken(id, value) {
  const token = String(value || "").trim();
  try {
    if (token) sessionStorage.setItem(guestHostTokenStorageKey(id), token);
    else sessionStorage.removeItem(guestHostTokenStorageKey(id));
  } catch (_) {}
  return token;
}

function authenticatedZilchPlayer() {
  return Boolean(state.auth?.authenticated && state.auth?.user?.username);
}

function zilchAccountEntry() {
  return authenticatedZilchPlayer()
    ? { href: zilchPath("/konto"), label: t("Konto") }
    : { href: zilchPath("/anmelden"), label: t("Anmelden") };
}

function zilchNavigationButton(href, label, className = "small ghost") {
  return `<button type="button" class="${escapeHtml(className)}" data-zilch-navigate="${escapeHtml(href)}">${escapeHtml(label)}</button>`;
}

document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target.closest("button[data-zilch-navigate]") : null;
  if (!(target instanceof HTMLButtonElement) || target.disabled) return;
  const destination = String(target.dataset.zilchNavigate || "");
  if (destination) window.location.assign(destination);
});

async function requestPassphrase(gameName) {
  const title = t("Geschützter Raum");
  const messageText = `${t("Für diese Zilch-Partie ist ein Raumcode erforderlich.")} ${gameName || ""}`.trim();
  if (typeof window.ZDWA_UI?.prompt === "function") {
    return window.ZDWA_UI.prompt({
      title,
      message: messageText,
      label: t("Raumcode"),
      input: { label: t("Raumcode"), type: "password", autocomplete: "current-password" },
      confirmLabel: t("Beitreten"),
    });
  }
  return window.prompt(messageText);
}

function rememberedActiveGameId() {
  try { return sessionStorage.getItem(ZILCH_ACTIVE_GAME_STORAGE_KEY) || ""; } catch (_) { return ""; }
}

function rememberActiveGame(gameIdValue) {
  const value = String(gameIdValue || "").trim();
  state.activeGameId = value;
  try {
    if (value) sessionStorage.setItem(ZILCH_ACTIVE_GAME_STORAGE_KEY, value);
    else sessionStorage.removeItem(ZILCH_ACTIVE_GAME_STORAGE_KEY);
  } catch (_) {}
  renderNavigation();
}

function clearRememberedActiveGame(gameIdValue = null) {
  const expected = String(gameIdValue || "").trim();
  if (expected && state.activeGameId && !sameId(expected, state.activeGameId)) return;
  rememberActiveGame("");
}

function socketUrl(id) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/${encodeURIComponent(id)}`;
}

function playerName(player) {
  return String(player?.display_name || player?.name || player?.username || t("Spieler"));
}

const CPU_STRATEGIES = new Set(["conservative", "normal", "aggressive"]);
const SOLO_SPRINT_OBJECTIVE_ID = "reach_10000_fewest_turns";

function zilchPlayMode(value) {
  const explicit = String(value?._play_mode || value?.play_mode || "").toLowerCase();
  if (explicit) return explicit;
  if (String(value?._mode || value?.mode || "") === "1") return "solo";
  return Number(value?._expected_participants ?? value?._expected ?? value?.expected) === 1
    ? "solo"
    : "multiplayer";
}

function isSoloGame(value) {
  return zilchPlayMode(value) === "solo";
}

function soloObjectiveFor(value) {
  const objective = value?._zilch_solo_objective || value?.solo_objective || value?._solo_objective || value?.objective;
  return objective && typeof objective === "object" ? objective : {};
}

function soloObjectiveTitle(value) {
  const objective = soloObjectiveFor(value);
  const key = String(objective?.label_key || objective?.name_key || "");
  if (key) return localizedServerMessage(key, objective?.label_params || objective?.name_params || {}, t("Solo-Ziel"));
  if (String(objective?.id || "") === SOLO_SPRINT_OBJECTIVE_ID) return t("10’000-Punkte-Sprint");
  return t("Solo-Ziel");
}

function soloOutcomeStatus(value) {
  const outcome = value?._zilch_outcome || value?.outcome || {};
  const raw = typeof outcome === "string"
    ? outcome
    : outcome?.status || outcome?.outcome || value?.solo_outcome || "";
  return String(raw).toLowerCase();
}

function soloOutcomeLabel(value) {
  const status = soloOutcomeStatus(value);
  if (status === "completed") return t("Solo-Ziel erreicht");
  if (status === "abandoned") return t("Solo-Lauf aufgegeben");
  return t("Solo-Lauf");
}

function snapshotParticipants(snapshot) {
  const participants = Array.isArray(snapshot?._participants) ? snapshot._participants : [];
  // Older active Zilch states used transport players for both roles. Keep the
  // old projection readable while treating the new domain participants as the
  // source of truth as soon as they are available.
  return participants.length ? participants : (Array.isArray(snapshot?._players) ? snapshot._players : []);
}

function participantType(participant) {
  return String(participant?.type || participant?.participant_type || "human").toLowerCase();
}

function isCpuParticipant(participant) {
  return participantType(participant) === "cpu";
}

function participantConnectionId(participant) {
  return String(participant?.connection_player_id || participant?.connectionPlayerId || "");
}

function participantForId(snapshot, playerId) {
  const id = String(playerId || "");
  if (!id) return null;
  return snapshotParticipants(snapshot).find(participant => (
    sameId(participant?.id, id)
    || sameId(participant?.participant_id, id)
    || (!isCpuParticipant(participant) && sameId(participantConnectionId(participant), id))
  )) || null;
}

function playerForId(snapshot, playerId) {
  return participantForId(snapshot, playerId);
}

function localParticipantId(snapshot) {
  if (!state.playerId) return "";
  const participant = snapshotParticipants(snapshot).find(candidate => (
    !isCpuParticipant(candidate)
    && (sameId(participantConnectionId(candidate), state.playerId) || sameId(candidate?.id, state.playerId))
  ));
  return String(participant?.id || participant?.participant_id || "");
}

function localPlayerIs(snapshot, playerId) {
  const localId = localParticipantId(snapshot);
  return Boolean(localId && sameId(localId, playerId));
}

function strategyLabel(value) {
  const strategy = String(value || "").toLowerCase();
  if (!CPU_STRATEGIES.has(strategy)) return "";
  return strategy === "conservative"
    ? t("Konservativ")
    : strategy === "aggressive"
      ? t("Aggressiv")
      : t("Normal");
}

function participantMeta(player, { compact = false } = {}) {
  if (!isCpuParticipant(player)) return "";
  const strategy = strategyLabel(player?.cpu_strategy || player?.strategy);
  const cpu = `<span class="zilch-participant-badge zilch-participant-badge--cpu">${escapeHtml(t("CPU"))}</span>`;
  if (compact || !strategy) return cpu;
  return `${cpu}<span class="zilch-participant-badge zilch-participant-badge--strategy">${escapeHtml(`${t("Strategie")}: ${strategy}`)}</span>`;
}

function zilchAchievementRank(value) {
  const rank = plainObject(value?.zilch_achievement_rank || value?.zilch_rank);
  return Object.keys(rank).length ? rank : null;
}

function zilchRankBadgeMarkup(value) {
  const rank = zilchAchievementRank(value);
  if (!rank) return "";
  const title = localizedAchievementValue(rank.title_key || rank.title || rank.name, "Zilch-Rang");
  return `<span class="zilch-rank-badge"><span aria-hidden="true">${escapeHtml(achievementRankStars(rank.stars))}</span><span>${escapeHtml(title)}</span></span>`;
}

function playerUsername(value) {
  const direct = String(value?.username || value?.player_username || "").trim();
  if (direct) return direct;
  return typeOfUserId(value?.user_id) ? String(value?.name || "").trim() : "";
}

function typeOfUserId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function playerCollectionMarkup(value) {
  const label = playerName(value);
  const identity = `<span class="zilch-player-name">${escapeHtml(label)}</span>${zilchRankBadgeMarkup(value)}`;
  const username = playerUsername(value);
  if (!username || isCpuParticipant(value)) return `<span class="zilch-player-identity">${identity}</span>`;
  const own = typeOfUserId(value?.user_id) && sameId(value.user_id, state.auth?.user?.id);
  const href = own
    ? zilchPath("/erfolge")
    : zilchPath(`/spieler/${encodeURIComponent(username)}`);
  return `<a class="zilch-player-achievement-link" href="${escapeHtml(href)}">${identity}</a>`;
}

function participantStatusLabel(player, { active = false } = {}) {
  if (isCpuParticipant(player)) return active ? t("CPU überlegt …") : t("CPU bereit");
  const online = player?.connected !== false;
  if (active) return `${t("Am Zug")} · ${online ? t("Online") : t("Offline")}`;
  return online ? t("Online") : t("Offline");
}

function updateStatus(value, kind = "info") {
  const next = value ? String(value) : null;
  const changed = Boolean(next && next !== state.status);
  state.status = next;
  state.statusKind = kind;
  if (changed && liveAnnouncements) liveAnnouncements.textContent = next;
}

function renderShell() {
  const username = state.auth?.user?.username || "";
  const account = username
    ? `<span class="zilch-account">${escapeHtml(username)}</span>`
    : "";
  root?.classList.remove("zilch-loading");
  const accountSlot = document.getElementById("zilchAccount");
  if (accountSlot) {
    accountSlot.innerHTML = account;
    accountSlot.hidden = routeKind() === "lobby";
  }
  const rulesLink = document.getElementById("zilchRoomRules");
  if (rulesLink) {
    rulesLink.setAttribute("aria-label", t("Spielregeln"));
    rulesLink.setAttribute("title", t("Spielregeln"));
    const label = rulesLink.querySelector(".zilch-control-label");
    if (label) label.textContent = t("Regeln");
  }
  const lobbyLink = document.getElementById("zilchRoomLobby");
  if (lobbyLink) {
    lobbyLink.setAttribute("aria-label", t("Zur Zilch-Lobby"));
    lobbyLink.setAttribute("title", t("Zur Zilch-Lobby"));
    const label = lobbyLink.querySelector(".zilch-control-label");
    if (label) label.textContent = t("Lobby");
  }
  renderNavigation();
}

function routeKind() {
  if (gameId) return "game";
  if (resultId) return "result";
  if (playerAchievementsUsername) return "player-achievements";
  if (achievementsRoute) return "achievements";
  if (accountRoute) return "account";
  if (historyRoute) return "history";
  if (rulesRoute) return "rules";
  if (statisticsRoute) return "statistics";
  if (leaderboardsRoute) return "leaderboards";
  return "lobby";
}

function navigationRouteKind() {
  return routeKind() === "player-achievements" ? "achievements" : routeKind();
}

function renderNavigation() {
  const navigation = document.getElementById("zilchNavigation");
  const roomContext = document.getElementById("zilchRoomContext");
  const roomLobby = document.getElementById("zilchRoomLobby");
  const roomRules = document.getElementById("zilchRoomRules");
  if (!navigation) return;
  const inGame = routeKind() === "game";
  root?.classList.toggle("zilch-shell--game", inGame);
  if (roomContext) roomContext.hidden = !inGame;
  if (roomLobby) roomLobby.hidden = !inGame;
  if (roomRules) roomRules.hidden = !inGame;
  if (inGame) {
    navigation.innerHTML = "";
    navigation.hidden = true;
    return;
  }
  const current = navigationRouteKind();
  const accountEntry = zilchAccountEntry();
  const entries = [
    { key: "lobby", href: zilchPath("/"), label: t("Lobby") },
    { key: "leaderboards", href: zilchPath("/bestenlisten"), label: t("Spieler & Ranking") },
    { key: "rules", href: zilchPath("/regeln"), label: t("Regeln") },
    {
      key: "account",
      href: accountEntry.href,
      label: accountEntry.label,
    },
  ];
  navigation.innerHTML = `<ul class="zilch-nav-list">${entries.map(entry => `<li><a href="${escapeHtml(entry.href)}"${entry.key === current ? ' aria-current="page"' : ""}>${escapeHtml(entry.label)}</a></li>`).join("")}</ul>`;
  navigation.hidden = false;
}

function renderNotice(messageText, { kind = "info" } = {}) {
  if (!content) return;
  content.innerHTML = `<section class="zilch-card zilch-notice zilch-notice--${escapeHtml(kind)}" role="status"><p>${escapeHtml(t(messageText))}</p></section>`;
}

function gameStatus(game) {
  if (game.finished) return t("Beendet");
  if (game.paused) return t("Pausiert");
  if (isSoloGame(game)) return game.started ? t("Läuft") : t("Solo-Lauf wird vorbereitet.");
  if (game.started) return t("Läuft");
  return t("Wartet auf Mitspieler");
}

function createGameErrorText(error) {
  const detail = String(error?.message || error || "");
  if (detail.includes("zilch_invalid_cpu_strategy")) return t("Die gewählte CPU-Strategie ist ungültig.");
  return t("Zilch-Partie konnte nicht erstellt werden.");
}

function gameStatusKind(game) {
  if (game?.finished) return "finished";
  if (game?.paused) return "paused";
  if (game?.started) return "running";
  return "waiting";
}

function gameParticipants(game) {
  const participants = Array.isArray(game?.participants) ? game.participants : [];
  const transports = Array.isArray(game?.player_statuses) ? game.player_statuses : [];
  if (!participants.length) return transports;
  return participants.map(participant => {
    if (isCpuParticipant(participant)) return participant;
    const connectionId = participantConnectionId(participant);
    const transport = transports.find(candidate => (
      samePresentId(candidate?.id, connectionId)
      || samePresentId(candidate?.id, participant?.id)
      || samePresentId(candidate?.user_id, participant?.user_id)
    ));
    return {
      ...transport,
      ...participant,
      connected: typeof participant?.connected === "boolean" ? participant.connected : transport?.connected,
    };
  });
}

function gameParticipantId(player) {
  return String(player?.participant_id || player?.id || "");
}

function gameParticipantCount(game) {
  const count = Number(game?.participant_count ?? game?.players);
  return Number.isFinite(count) ? count : gameParticipants(game).length;
}

function expectedParticipantCount(game) {
  const count = Number(game?.expected_participants ?? game?.expected);
  if (Number.isFinite(count) && count > 0) return count;
  return isSoloGame(game) ? 1 : 2;
}

function lobbyPlayerRows(game) {
  const participants = gameParticipants(game);
  if (!participants.length) return `<span class="zilch-muted">${escapeHtml(t("Noch keine Spieler"))}</span>`;
  return participants.map(player => {
    const cpu = isCpuParticipant(player);
    const online = player?.connected !== false;
    const status = participantStatusLabel(player);
    return `<span class="zilch-player-chip${cpu ? " zilch-player-chip--cpu" : online ? "" : " zilch-player-chip--offline"}">${cpu ? "" : '<span class="zilch-connection-dot" aria-hidden="true"></span>'}${playerCollectionMarkup(player)}${participantMeta(player, { compact: true })}<span class="visually-hidden"> ${escapeHtml(status)}</span></span>`;
  }).join("");
}

function gamePoints(game) {
  const progress = Array.isArray(game?.progress) ? game.progress : [];
  if (!progress.length) return "";
  return progress.map(player => `${player?.name || t("Spieler")}: ${number(player?.points)}`).join(" · ");
}

function lobbyTurnText(game) {
  if (isSoloGame(game)) {
    if (game?.finished) return soloOutcomeLabel(game);
    if (game?.paused) return t("Spiel pausiert");
    if (game?.started) return t("Solo-Lauf läuft");
    return t("Solo-Lauf wird vorbereitet.");
  }
  const currentId = String(game?.current_player_id || "");
  const player = currentId ? gameParticipants(game)
    .find(candidate => samePresentId(gameParticipantId(candidate), currentId) || samePresentId(candidate?.connection_player_id, currentId)) : null;
  const finalRound = game?.final_round && typeof game.final_round === "object" ? game.final_round : null;
  if (finalRound?.pending_player_ids?.length) return t("Schlussrunde: Gegenzug offen");
  if (finalRound?.triggered_by) return t("Schlussrunde läuft");
  if (isCpuParticipant(player)) return t("CPU überlegt …");
  if (player?.name) return `${player.name} ${t("ist am Zug.")}`;
  if (game?.current_player_name) return `${game.current_player_name} ${t("ist am Zug.")}`;
  if (game?.paused) return t("Spiel pausiert");
  return "";
}

function gameCard(game, { running = false } = {}) {
  const joined = gameParticipantCount(game);
  const expected = expectedParticipantCount(game);
  const solo = isSoloGame(game);
  const mine = Boolean(
    game.my_participant_id
    || game.my_player_id
    || game.my_cpu_host
    || game.my_solo_host
    || hasStoredGameSession(game.id)
    || storedGuestHostToken(game.id),
  );
  const action = mine
    ? (solo ? t("Solo-Lauf fortsetzen") : running ? t("Partie fortsetzen") : t("Wartesaal öffnen"))
    : t("Beitreten");
  const detail = lobbyTurnText(game);
  const points = gamePoints(game);
  const cpu = zilchPlayMode(game) === "cpu";
  const strategy = strategyLabel(game?.cpu_strategy);
  const soloObjective = solo ? soloObjectiveTitle(game) : "";
  const lock = game.locked ? `<span class="zilch-board-marker zilch-lock-label">${escapeHtml(t("Geschützter Raum"))}</span>` : "";
  const pause = game.paused
    ? `<p class="zilch-game-card__notice">${escapeHtml(Array.isArray(game.offline) && game.offline.length ? t("Ein Teilnehmer ist offline") : t("Spiel pausiert"))}</p>`
    : "";
  const soloProgress = Array.isArray(game?.progress) ? game.progress[0] : null;
  const soloPoints = Number(soloProgress?.points);
  const soloTarget = Number(game?.target_score || game?.target || 10_000);
  const compactTitle = solo
    ? t("Solo-Sprint")
    : cpu
      ? `${t("Gegen CPU")}${strategy ? ` · ${strategy}` : ""}`
      : game.name || "Zilch";
  const runningSummary = solo
    ? `<p class="zilch-game-card__summary"><strong>${escapeHtml(number(Number.isFinite(soloPoints) ? soloPoints : 0))} / ${escapeHtml(number(Number.isFinite(soloTarget) ? soloTarget : 10_000))}</strong> ${escapeHtml(t("Punkte"))}</p>`
    : detail
      ? `<p class="zilch-game-card__summary">${escapeHtml(detail)}</p>`
      : points
        ? `<p class="zilch-game-card__summary">${escapeHtml(points)}</p>`
        : "";
  return `<article class="zilch-game-card${running ? " zilch-game-card--running" : ""}${solo ? " zilch-game-card--solo" : ""}">
    <div>
      <div class="zilch-card-title"><h3>${escapeHtml(running ? compactTitle : game.name || "Zilch")}</h3><span class="zilch-status-pill" data-status="${gameStatusKind(game)}">${escapeHtml(gameStatus(game))}</span>${running ? "" : solo ? `<span class="zilch-participant-badge zilch-participant-badge--solo">${escapeHtml(t("Solo"))}</span>` : ""}${running ? "" : cpu ? `<span class="zilch-participant-badge zilch-participant-badge--cpu">${escapeHtml(t("Gegen CPU"))}${strategy ? ` · ${escapeHtml(strategy)}` : ""}</span>` : ""}${lock}</div>
      ${running ? runningSummary : solo ? `<p class="zilch-game-card__objective"><strong>${escapeHtml(soloObjective)}</strong></p>` : `<p>${escapeHtml(t("Teilnehmer"))}: <strong>${joined}/${expected}</strong></p>`}
      ${running ? "" : `<p class="zilch-game-card__players">${lobbyPlayerRows(game)}</p>`}
      ${running ? "" : detail ? `<p class="zilch-game-card__turn">${escapeHtml(detail)}</p>` : ""}
      ${running || !points ? "" : `<p class="zilch-game-card__points">${escapeHtml(t("Punktestand"))}: <strong>${escapeHtml(points)}</strong></p>`}
      ${pause}
    </div>
    <a class="button-link zilch-lobby-action" href="${escapeHtml(zilchPath(`/spiel/${encodeURIComponent(game.id)}`))}">${escapeHtml(action)}</a>
  </article>`;
}

async function fetchZilchGames() {
  const response = await fetch("/api/games?game_type=zilch", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.games) ? payload.games : [];
}

function resultRecord(payload) {
  const topLevel = payload?.result && typeof payload.result === "object" ? payload.result : payload;
  if (!topLevel || typeof topLevel !== "object") return null;
  const nestedPayload = topLevel.payload && typeof topLevel.payload === "object" ? topLevel.payload : null;
  return nestedPayload ? { ...topLevel, ...nestedPayload } : topLevel;
}

function resultIdFor(result) {
  return String(result?.game_id || result?.id || "");
}

function resultParticipants(result) {
  const participants = result?.participants || result?.player_order || [];
  return Array.isArray(participants) ? participants.filter(player => player && typeof player === "object") : [];
}

function resultPlayerName(player) {
  return String(player?.display_name || player?.name || player?.username || t("Spieler"));
}

function resultPlayerId(player) {
  return String(player?.participant_id || player?.player_id || player?.id || "");
}

function resultParticipantMeta(player) {
  const cpu = participantType(player) === "cpu";
  if (!cpu) return "";
  const strategy = strategyLabel(player?.cpu_strategy || player?.strategy);
  return `<span class="zilch-participant-badge zilch-participant-badge--cpu">${escapeHtml(t("CPU"))}</span>${strategy ? `<span class="zilch-participant-badge zilch-participant-badge--strategy">${escapeHtml(`${t("Strategie")}: ${strategy}`)}</span>` : ""}`;
}

function resultBoardFor(result, player) {
  const boards = result?.boards || result?.zilch_boards || {};
  const playerId = resultPlayerId(player);
  if (Array.isArray(boards)) {
    return boards.find(board => sameId(board?.participant_id || board?.player_id || board?.id, playerId)) || {};
  }
  return boards?.[playerId] || {};
}

function resultTotals(result) {
  return result?.final_scores || result?.totals || result?.outcome?.totals || {};
}

function resultTotalFor(result, player, board) {
  const totals = resultTotals(result);
  const playerId = resultPlayerId(player);
  const raw = totals?.[playerId] ?? board?.total_points ?? board?.final_total_points ?? player?.total_points ?? 0;
  return number(raw);
}

function resultWinnerIds(result) {
  const outcome = result?.outcome || {};
  const winners = outcome.winner_ids || result?.winner_ids || [];
  if (Array.isArray(winners)) return winners.map(value => String(value));
  return winners ? [String(winners)] : [];
}

function resultIsTied(result) {
  return Boolean(result?.outcome?.tied || result?.tied || result?.outcome?.status === "tie");
}

function resultOutcomeLabel(result) {
  if (isSoloGame(result)) return soloOutcomeLabel(result);
  if (resultIsTied(result)) return t("Gleichstand");
  const winnerIds = resultWinnerIds(result);
  const names = resultParticipants(result)
    .filter(player => winnerIds.some(id => sameId(id, resultPlayerId(player))))
    .map(resultPlayerName);
  return names.length ? names.join(", ") : t("Beendet");
}

function resultRoundHistory(entry) {
  if (!entry || typeof entry !== "object") return "";
  const round = Number(entry.round ?? entry.round_number ?? 0);
  const prefix = round ? `${t("Runde")} ${round}: ` : "";
  const event = String(entry.event || entry.type || "");
  if (event === "bank" || event === "banked") return `${prefix}+${number(entry.points ?? entry.banked_points)} ${t("gesichert")}`;
  if (event === "zilch") {
    const penalty = Number(entry.penalty ?? entry.zilch_penalty ?? 0);
    return penalty ? `${prefix}${t("Zilch")} · −${number(penalty)}` : `${prefix}${t("Zilch")}`;
  }
  if (event === "hot_dice") return `${prefix}${t("Hot Dice")}`;
  return prefix || t("Runde abgeschlossen");
}

function resultHistoryCard(result) {
  const id = resultIdFor(result);
  if (!id) return "";
  const solo = isSoloGame(result);
  const participants = resultParticipants(result);
  const scores = participants.map(player => {
    const board = resultBoardFor(result, player);
    const cpu = participantType(player) === "cpu";
    const strategy = strategyLabel(player?.cpu_strategy || player?.strategy);
    const label = cpu ? `${resultPlayerName(player)} (${t("CPU")}${strategy ? ` · ${strategy}` : ""})` : resultPlayerName(player);
    return `${label} ${resultTotalFor(result, player, board)}`;
  }).join(" · ");
  const participantBadges = participants.map(resultParticipantMeta).filter(Boolean).join("");
  const name = String(result?.game_name || result?.name || "Zilch");
  return `<article class="zilch-result-history-card">
    <div>
      <p class="eyebrow">${escapeHtml(solo ? t("Solo-Ergebnis") : t("Abgeschlossene Partie"))}</p>
      <h3>${escapeHtml(name)}</h3>
      ${solo ? `<div class="zilch-participant-badges zilch-result-history-card__badges"><span class="zilch-participant-badge zilch-participant-badge--solo">${escapeHtml(t("Solo"))}</span></div><p class="zilch-result-history-card__objective">${escapeHtml(soloObjectiveTitle(result))}</p>` : ""}${participantBadges ? `<div class="zilch-participant-badges zilch-result-history-card__badges">${participantBadges}</div>` : ""}
      <p class="zilch-muted">${escapeHtml(formattedDateTime(result?.finished_at))}</p>
      <p>${escapeHtml(scores || t("Punktestand nicht verfügbar"))}</p>
      <p class="zilch-result-history-card__outcome">${escapeHtml(t("Ergebnis"))}: <strong>${escapeHtml(resultOutcomeLabel(result))}</strong></p>
    </div>
    <a class="button-link zilch-lobby-action" href="${escapeHtml(zilchPath(`/ergebnis/${encodeURIComponent(id)}`))}">${escapeHtml(t("Ergebnis ansehen"))}</a>
  </article>`;
}

async function fetchZilchResults() {
  const response = await fetch("/api/zilch/results", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map(resultRecord).filter(Boolean);
}

function lobbyLeaderboardShell(category) {
  const title = leaderboardCategoryLabel(category);
  const detail = category === "solo_sprint" ? t("Wenigste Züge") : t("Meiste Siege");
  return `<section class="zilch-lobby-leaderboard-box" data-zilch-lobby-leaderboard="${category}">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(detail)}</p>
    <div class="zilch-lobby-leaderboard-list">${escapeHtml(t("Zilch-Bestenliste wird geladen …"))}</div>
  </section>`;
}

async function fetchLobbyLeaderboard(category) {
  const params = new URLSearchParams({ category, limit: "5", offset: "0" });
  if (category === "cpu_wins") params.set("strategy", "normal");
  const response = await fetch(`/api/zilch/leaderboards?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return leaderboardProjection(await response.json());
}

function lobbyLeaderboardMarkup(leaderboard, category) {
  const entries = Array.isArray(leaderboard?.entries) ? leaderboard.entries.slice(0, 5) : [];
  if (!entries.length) return `<p class="zilch-muted">${escapeHtml(t("Noch keine vergleichbaren Ergebnisse"))}</p>`;
  const valueKeys = category === "solo_sprint" ? ["turns", "turn_count", "primary_value"] : ["wins", "primary_value"];
  const suffix = category === "solo_sprint" ? t("Züge") : t("Siege");
  return `<ol>${entries.map(entry => {
    const rank = leaderboardEntryValue(entry, ["rank"]);
    const value = leaderboardEntryValue(entry, valueKeys);
    return `<li${isOwnLeaderboardEntry(entry) ? ' class="is-own"' : ""}>
      <span class="zilch-lobby-leaderboard-rank">${escapeHtml(rank === null ? "—" : number(rank))}</span>
      <span class="zilch-lobby-leaderboard-name">${zilchPlayerAchievementLink(entry)}</span>
      <strong>${escapeHtml(value === null ? "—" : `${number(value)} ${suffix}`)}</strong>
    </li>`;
  }).join("")}</ol>`;
}

async function refreshLobbyLeaderboards() {
  await Promise.all(["solo_sprint", "multiplayer_wins", "cpu_wins"].map(async category => {
    const box = document.querySelector(`[data-zilch-lobby-leaderboard="${category}"]`);
    const slot = box?.querySelector(".zilch-lobby-leaderboard-list");
    if (!slot) return;
    try {
      slot.innerHTML = lobbyLeaderboardMarkup(await fetchLobbyLeaderboard(category), category);
    } catch (_) {
      slot.innerHTML = `<p class="zilch-muted">${escapeHtml(t("Zilch-Bestenliste nicht verfügbar"))}</p>`;
    }
  }));
}

async function renderLobby() {
  if (!content) return;
  const hasAccount = authenticatedZilchPlayer();
  const username = state.auth?.user?.username || t("Gast");
  const accountEntry = zilchAccountEntry();
  content.innerHTML = `<section class="zilch-intro zilch-intro--lobby">
      <p class="eyebrow">${escapeHtml(t("Online würfeln"))}</p>
      <h1>${escapeHtml(t("Zilch die Wand an – Würfelspiel online"))}</h1>
      <p>${escapeHtml(t("Wähle Solo, CPU oder eine Partie zu zweit. Mit sechs Würfeln sammelst du Punkte, sicherst sie rechtzeitig und erreichst 10’000."))}</p>
    </section>
    <section class="zilch-lobby-identity" aria-label="${escapeHtml(`${t("Du spielst als")} ${username}`)}">
      <span class="eyebrow">${escapeHtml(t("Du spielst als"))}</span>
      <strong>${escapeHtml(username)}</strong>
      ${zilchNavigationButton(accountEntry.href, hasAccount ? t("Mein Konto") : accountEntry.label, "small ghost zilch-inline-navigation")}
    </section>
    <section class="zilch-card zilch-create-card">
      <h2>${escapeHtml(t("Neue Zilch-Partie"))}</h2>
      <form id="zilchCreateForm" class="zilch-create-form">
        <input id="zilchGameName" type="hidden" value="${escapeHtml(`Zilch · ${username}`)}">
        <fieldset class="zilch-mode-choice"><legend>${escapeHtml(t("Spielart"))}</legend><div class="zilch-mode-grid" role="radiogroup" aria-label="${escapeHtml(t("Spielart"))}"><button class="zilch-mode-option zilch-mode-option--solo is-selected" type="button" role="radio" aria-checked="true" data-zilch-play-mode="solo"><strong>${escapeHtml(t("Solo"))}</strong></button><button class="zilch-mode-option" type="button" role="radio" aria-checked="false" data-zilch-play-mode="multiplayer"><strong>${escapeHtml(t("Zu zweit"))}</strong></button><button class="zilch-mode-option" type="button" role="radio" aria-checked="false" data-zilch-play-mode="cpu"><strong>${escapeHtml(t("Gegen CPU"))}</strong></button></div></fieldset>
        <label id="zilchCpuStrategy" class="zilch-create-select zilch-cpu-strategy" for="zilchCpuStrategySelect" hidden><span>${escapeHtml(t("CPU-Strategie"))}</span><select id="zilchCpuStrategySelect" name="zilchCpuStrategy"><option value="conservative">${escapeHtml(t("Konservativ"))}</option><option value="normal" selected>${escapeHtml(t("Normal"))}</option><option value="aggressive">${escapeHtml(t("Aggressiv"))}</option></select></label>
        <section id="zilchSoloObjective" class="zilch-solo-create-objective" aria-labelledby="zilchSoloObjectiveTitle">
          <strong id="zilchSoloObjectiveTitle">${escapeHtml(t("10’000-Punkte-Sprint"))}</strong>
          <span>${escapeHtml(t("In möglichst wenigen Zügen"))}</span>
        </section>
        <button class="zilch-create-submit" type="submit">${escapeHtml(t("Partie erstellen"))}</button>
        <details class="zilch-create-options">
          <summary>${escapeHtml(t("Passwortschutz"))}</summary>
          <label><span>${escapeHtml(t("Raumcode (optional)"))}</span><input id="zilchGamePassphrase" type="password" maxlength="100" autocomplete="new-password" placeholder="${escapeHtml(t("Nur mit Raumcode"))}"></label>
        </details>
      </form>
      <p id="zilchCreateError" class="zilch-error" role="status"></p>
    </section>
    <section class="zilch-lobby-grid" aria-label="${escapeHtml(t("Zilch-Lobby"))}">
      <section class="zilch-card zilch-lobby-section">
        <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Deine Partie"))}</p><h2>${escapeHtml(t("Laufende Spiele"))}</h2></div><button id="zilchRefresh" class="small ghost" type="button">${escapeHtml(t("Aktualisieren"))}</button></div>
        <div id="zilchRunningGames" class="zilch-game-list" aria-live="polite">${escapeHtml(t("Zilch-Partien werden geladen …"))}</div>
      </section>
      <section class="zilch-card zilch-lobby-section">
        <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Offene Plätze"))}</p><h2>${escapeHtml(t("Wartende Spiele"))}</h2></div></div>
        <div id="zilchWaitingGames" class="zilch-game-list" aria-live="polite">${escapeHtml(t("Zilch-Partien werden geladen …"))}</div>
      </section>
    </section>
    <section class="zilch-lobby-ranking" aria-labelledby="zilchLobbyRankingTitle">
      <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Bestenlisten"))}</p><h2 id="zilchLobbyRankingTitle">${escapeHtml(t("Zilch-Ranglisten"))}</h2></div>${zilchNavigationButton(zilchPath("/bestenlisten"), t("Alle Bestenlisten"))}</div>
      <div class="zilch-lobby-leaderboards" aria-live="polite">
        ${lobbyLeaderboardShell("solo_sprint")}
        ${lobbyLeaderboardShell("multiplayer_wins")}
        ${lobbyLeaderboardShell("cpu_wins")}
      </div>
    </section>`;

  const runningSlot = document.getElementById("zilchRunningGames");
  const waitingSlot = document.getElementById("zilchWaitingGames");
  const refreshGames = async () => {
    try {
      const games = await fetchZilchGames();
      const zilchGames = games.filter(game => {
        const mode = zilchPlayMode(game);
        const validMode = (String(game.mode) === "1" && mode === "solo")
          || (String(game.mode) === "2" && (mode === "multiplayer" || mode === "cpu"));
        return validMode && !game.finished && !game.aborted;
      });
      const belongsToMe = (game) => Boolean(
        game.my_participant_id
        || game.my_player_id
        || game.my_cpu_host
        || game.my_solo_host
        || hasStoredGameSession(game.id)
        || storedGuestHostToken(game.id),
      );
      const runningGames = zilchGames.filter(game => belongsToMe(game) && (game.started || isSoloGame(game)));
      // A CPU game has exactly one human seat, so it must never be presented
      // to another signed-in user as a joinable waiting room. The same applies
      // to solo runs: their only seat belongs to their human owner.
      const waitingGames = zilchGames.filter(game => !game.started && (
        zilchPlayMode(game) === "multiplayer"
        || (zilchPlayMode(game) === "cpu" && belongsToMe(game))
      ));
      const active = runningGames[0] || waitingGames.find(belongsToMe);
      if (active?.id) rememberActiveGame(active.id);
      else if (routeKind() === "lobby") clearRememberedActiveGame();
      if (runningSlot) runningSlot.innerHTML = runningGames.length
        ? runningGames.map(game => gameCard(game, { running: true })).join("")
        : `<p class="zilch-muted">${escapeHtml(t("Keine laufende eigene Zilch-Partie"))}</p>`;
      if (waitingSlot) waitingSlot.innerHTML = waitingGames.length
        ? waitingGames.map(game => gameCard(game)).join("")
        : `<p class="zilch-muted">${escapeHtml(t("Keine wartende Zilch-Partie"))}</p>`;
    } catch (_) {
      const failure = `<p class="zilch-error">${escapeHtml(t("Zilch-Lobby konnte nicht geladen werden."))}</p>`;
      if (runningSlot) runningSlot.innerHTML = failure;
      if (waitingSlot) waitingSlot.innerHTML = failure;
    }
  };
  document.getElementById("zilchRefresh")?.addEventListener("click", () => {
    void refreshGames();
    void refreshLobbyLeaderboards();
  });
  const syncCpuCreateOptions = () => {
    const playMode = document.querySelector("[data-zilch-play-mode][aria-checked='true']")?.dataset.zilchPlayMode;
    document.getElementById("zilchCreateForm")?.setAttribute("data-play-mode", playMode || "solo");
    const strategy = document.getElementById("zilchCpuStrategy");
    const soloObjective = document.getElementById("zilchSoloObjective");
    const passphrase = document.getElementById("zilchGamePassphrase")?.closest(".zilch-create-options");
    if (strategy) strategy.hidden = playMode !== "cpu";
    if (soloObjective) soloObjective.hidden = playMode !== "solo";
    if (passphrase) passphrase.hidden = playMode === "solo";
  };
  for (const option of document.querySelectorAll("[data-zilch-play-mode]")) {
    option.addEventListener("click", () => {
      for (const candidate of document.querySelectorAll("[data-zilch-play-mode]")) {
        const selected = candidate === option;
        candidate.classList.toggle("is-selected", selected);
        candidate.setAttribute("aria-checked", String(selected));
      }
      syncCpuCreateOptions();
    });
  }
  syncCpuCreateOptions();
  document.getElementById("zilchCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorSlot = document.getElementById("zilchCreateError");
    if (errorSlot) errorSlot.textContent = "";
    const name = document.getElementById("zilchGameName")?.value?.trim() || "Zilch";
    const selectedMode = document.querySelector("[data-zilch-play-mode][aria-checked='true']")?.dataset.zilchPlayMode;
    const playMode = ["multiplayer", "cpu", "solo"].includes(selectedMode) ? selectedMode : "solo";
    const passphrase = playMode === "solo" ? "" : (document.getElementById("zilchGamePassphrase")?.value || "");
    const selectedStrategy = String(document.getElementById("zilchCpuStrategySelect")?.value || "normal").toLowerCase();
    const cpuStrategy = CPU_STRATEGIES.has(selectedStrategy) ? selectedStrategy : "normal";
    const submit = event.currentTarget?.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;
    try {
      const response = await apiFetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mode: playMode === "solo" ? "1" : "2",
          game_type: "zilch",
          play_mode: playMode,
          ...(playMode === "cpu" ? { cpu_strategy: cpuStrategy } : {}),
          ...(playMode !== "solo" ? { pass: passphrase } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.game_id) throw new Error(payload.detail || "zilch_create_failed");
      if (passphrase) {
        try { sessionStorage.setItem(`zilch_pass_${payload.game_id}`, passphrase); } catch (_) {}
      }
      if (payload.host_token) rememberGuestHostToken(payload.game_id, payload.host_token);
      rememberActiveGame(payload.game_id);
      window.location.assign(zilchPath(`/spiel/${encodeURIComponent(payload.game_id)}`));
    } catch (error) {
      if (errorSlot) errorSlot.textContent = createGameErrorText(error);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  await refreshGames();
  await refreshLobbyLeaderboards();
}

async function renderHistory() {
  if (!content) return;
  content.innerHTML = `<section class="zilch-game-head">
      <div><p class="eyebrow">${escapeHtml(t("Deine Historie"))}</p><h1>${escapeHtml(t("Abgeschlossene Spiele"))}</h1><p>${escapeHtml(t("Deine Zilch-Partien bleiben getrennt von ZDWA-Ergebnissen und -Ranglisten."))}</p></div>
    </section>
    <section class="zilch-card zilch-results-history" aria-labelledby="zilchAllHistoryTitle">
      <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Ergebnisse"))}</p><h2 id="zilchAllHistoryTitle">${escapeHtml(t("Deine abgeschlossenen Zilch-Partien"))}</h2></div></div>
      <div id="zilchAllResultsHistory" class="zilch-result-history-list" aria-live="polite">${escapeHtml(t("Zilch-Historie wird geladen …"))}</div>
    </section>`;
  const slot = document.getElementById("zilchAllResultsHistory");
  try {
    const results = await fetchZilchResults();
    if (slot) slot.innerHTML = results.length
      ? results.map(resultHistoryCard).join("")
      : `<p class="zilch-muted">${escapeHtml(t("Noch keine abgeschlossenen Zilch-Partien"))}</p>`;
  } catch (_) {
    if (slot) slot.innerHTML = `<p class="zilch-error">${escapeHtml(t("Zilch-Historie konnte nicht geladen werden."))}</p>`;
  }
}

// Zilch achievements deliberately remain a separate product projection. The
// browser renders only definitions and unlock state received from the server;
// it never derives an unlock, progress value, or award acknowledgement.
const ZILCH_ACHIEVEMENT_CATEGORY_LABELS = {
  entry: "Einstieg",
  scoring: "Wertungen",
  combinations: "Kombinationen",
  risk: "Risiko",
  multiplayer: "Human-vs-Human",
  cpu: "CPU",
  solo: "Solo",
  milestones: "Meilensteine",
  community: "Community",
};
const ZILCH_ACHIEVEMENT_CATEGORY_ORDER = Object.keys(ZILCH_ACHIEVEMENT_CATEGORY_LABELS);
const ZILCH_ACHIEVEMENT_ICONS = new Set(["dice", "paper", "flame", "shield", "star"]);
const ZILCH_ACHIEVEMENT_ICON_ALIASES = {
  die: "dice",
  games: "dice",
  straight: "dice",
  pairs: "dice",
  ones: "dice",
  duel: "shield",
  cpu: "paper",
  flag: "star",
  target: "star",
  spark: "star",
  comeback: "flame",
};

function objectArray(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
}

function firstObjectArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return objectArray(value);
  }
  return [];
}

function achievementCategories(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.map(item => typeof item === "string" ? { key: item } : item).filter(item => item && typeof item === "object");
    }
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, label]) => ({ key, label }));
    }
  }
  return [];
}

function achievementSources(value) {
  const source = plainObject(value);
  return [source, plainObject(source.definition), plainObject(source.achievement)];
}

function achievementValue(value, keys) {
  for (const source of achievementSources(value)) {
    for (const key of keys) {
      const candidate = source[key];
      if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
    }
  }
  return null;
}

function machineAchievementText(value) {
  return /^(?:zilch|achievement)[.:]/i.test(String(value || ""));
}

function localizedAchievementValue(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return t(fallback);
  const raw = value.trim();
  const serverMessage = message(raw);
  if (serverMessage && serverMessage !== raw) return serverMessage;
  const translated = t(raw);
  return translated !== raw || !machineAchievementText(raw) ? translated : t(fallback);
}

function localizedAchievementText(achievement, field, fallback) {
  const value = achievementValue(achievement, [
    `${field}_key`,
    `${field}Key`,
    field,
    field === "title" ? "name" : "",
  ].filter(Boolean));
  return localizedAchievementValue(value, fallback);
}

function achievementKey(achievement) {
  const value = achievementValue(achievement, ["key", "achievement_key", "id"]);
  return typeof value === "string" && value.length <= 96 ? value : "";
}

function achievementCategoryKey(achievement) {
  const raw = achievementValue(achievement, ["category", "category_key", "categoryKey"]);
  const normalized = String(raw || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ZILCH_ACHIEVEMENT_CATEGORY_LABELS, normalized)
    ? normalized
    : "milestones";
}

function achievementCategoryDefinition(categories, key) {
  const list = objectArray(categories);
  return list.find(category => String(category?.key || category?.id || "").toLowerCase() === key) || {};
}

function achievementCategoryLabel(key, categories = [], achievement = null) {
  const definition = achievementCategoryDefinition(categories, key);
  const declared = achievementValue(achievement, ["category_label_key", "category_title_key", "category_key"])
    || achievementValue(definition, ["title_key", "label_key", "name_key", "title", "label", "name"])
    || `zilch.achievement.category.${key}`;
  return localizedAchievementValue(declared, ZILCH_ACHIEVEMENT_CATEGORY_LABELS[key] || "Meilensteine");
}

function achievementIconKey(achievement) {
  const raw = String(achievementValue(achievement, ["icon_key", "icon", "symbol"]) || "").toLowerCase();
  if (ZILCH_ACHIEVEMENT_ICONS.has(raw)) return raw;
  if (ZILCH_ACHIEVEMENT_ICON_ALIASES[raw]) return ZILCH_ACHIEVEMENT_ICON_ALIASES[raw];
  const category = achievementCategoryKey(achievement);
  if (category === "risk") return "flame";
  if (category === "combinations") return "dice";
  if (category === "milestones") return "star";
  return "paper";
}

function achievementIsHidden(achievement, unlocked) {
  return !unlocked && Boolean(achievementValue(achievement, ["hidden", "is_hidden", "secret"]));
}

function achievementProgressMarkup(achievement) {
  const progress = plainObject(achievementValue(achievement, ["progress"]));
  const current = progress.current;
  const target = progress.target;
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(target)) || Number(target) < 1) return "";
  const label = `${t("Fortschritt")}: ${number(current)} ${t("von")} ${number(target)}`;
  return `<span class="zilch-achievement-card__progress" aria-label="${escapeHtml(label)}">${escapeHtml(`${number(current)} / ${number(target)}`)}</span>`;
}

function achievementPoints(achievement) {
  const value = Number(achievementValue(achievement, ["points"]));
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function zilchPointsText(value, { signed = false } = {}) {
  const points = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  const label = t(points === 1 ? "Zilch-Punkt" : "Zilch-Punkte");
  return `${signed && points > 0 ? "+" : ""}${number(points)} ${label}`;
}

function achievementPointsText(achievement) {
  return zilchPointsText(achievementPoints(achievement), { signed: true });
}

function achievementModeMarkup(achievement) {
  const raw = achievementValue(achievement, ["eligible_modes", "play_modes", "play_mode", "modes"]);
  const modes = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const labels = [...new Set(modes.map(mode => String(mode || "").toLowerCase()))]
    .filter(mode => ["multiplayer", "cpu", "solo"].includes(mode))
    .map(mode => modeLabel(mode));
  return labels.length
    ? `<span class="zilch-achievement-card__mode">${escapeHtml(labels.join(" · "))}</span>`
    : "";
}

function achievementCardMarkup(achievement, { unlocked = false } = {}) {
  const hidden = achievementIsHidden(achievement, unlocked);
  const missed = !unlocked && Boolean(achievementValue(achievement, ["missed"]));
  const title = hidden
    ? t("Versteckter Zilch-Award")
    : localizedAchievementText(achievement, "title", "Zilch-Award");
  const description = hidden
    ? t("Dieser Award wird erst nach seiner Freischaltung sichtbar.")
    : localizedAchievementText(achievement, "description", "Zilch-Leistung");
  const stateLabel = unlocked ? t("Freigeschaltet") : missed ? t("Verpasst") : t("Gesperrt");
  const icon = achievementIconKey(achievement);
  return `<article class="zilch-achievement-card${unlocked ? " is-unlocked" : missed ? " is-locked is-missed" : " is-locked"}" aria-label="${escapeHtml(`${title} · ${stateLabel}`)}">
    <span class="zilch-achievement-card__icon zilch-achievement-card__icon--${escapeHtml(icon)}" aria-hidden="true"></span>
    <div class="zilch-achievement-card__copy">
      <div class="zilch-achievement-card__title"><h3>${escapeHtml(title)}</h3><span class="zilch-achievement-card__points">${escapeHtml(achievementPointsText(achievement))}</span></div>
      <p>${escapeHtml(description)}</p>
      <div class="zilch-achievement-card__status">
        ${achievementModeMarkup(achievement)}
        <span class="zilch-achievement-card__state">${escapeHtml(stateLabel)}</span>
        ${unlocked || missed ? "" : achievementProgressMarkup(achievement)}
      </div>
    </div>
  </article>`;
}

function achievementProjection(payload) {
  const outer = plainObject(payload);
  const nested = plainObject(outer.achievements);
  const profile = plainObject(outer.profile || nested.profile);
  const definitions = firstObjectArray(nested.definitions, outer.definitions);
  const unlocked = firstObjectArray(nested.unlocked, outer.unlocked);
  const lockedValue = Array.isArray(nested.locked) ? nested.locked : outer.locked;
  const hasExplicitLocked = Array.isArray(lockedValue);
  const explicitLocked = objectArray(lockedValue);
  const unlockedKeys = new Set(unlocked.map(achievementKey).filter(Boolean));
  const rank = plainObject(outer.rank || nested.rank || profile.rank);
  const points = outer.points ?? nested.points ?? profile.points ?? rank.points ?? 0;
  const pointsPossible = outer.points_possible ?? nested.points_possible ?? profile.points_possible ?? rank.points_possible ?? 0;
  return {
    version: outer.version ?? nested.version ?? 1,
    player: plainObject(outer.player || nested.player),
    categories: achievementCategories(outer.categories, nested.categories),
    points: Number.isFinite(Number(points)) ? Math.max(0, Math.trunc(Number(points))) : 0,
    points_possible: Number.isFinite(Number(pointsPossible)) ? Math.max(0, Math.trunc(Number(pointsPossible))) : 0,
    rank,
    unlocked,
    locked: hasExplicitLocked ? explicitLocked : definitions.filter(definition => !unlockedKeys.has(achievementKey(definition))),
    pending: firstObjectArray(outer.awards, outer.pending, nested.awards, nested.pending),
    rankUpgrade: plainObject(outer.rank_upgrade || outer.rankUpgrade || nested.rank_upgrade || nested.rankUpgrade),
  };
}

function achievementRankLegendProjection(payload) {
  const legend = plainObject(payload);
  const pointsPossible = Number(legend.points_possible);
  return {
    ranks: objectArray(legend.ranks),
    points_possible: Number.isFinite(pointsPossible) ? Math.max(0, Math.trunc(pointsPossible)) : 0,
  };
}

function achievementRankStars(value) {
  const stars = Math.max(0, Math.min(5, Math.trunc(Number(value) || 0)));
  return stars ? "★".repeat(stars) : "☆";
}

function achievementRankSummaryMarkup(projection) {
  const rank = plainObject(projection?.rank);
  if (!Object.keys(rank).length) return "";
  const points = Math.max(0, Math.trunc(Number(projection?.points) || 0));
  const pointsPossible = Math.max(0, Math.trunc(Number(projection?.points_possible) || 0));
  const stars = achievementRankStars(rank.stars);
  const rankTitle = localizedAchievementValue(rank.title_key || rank.title || rank.name, "Zilch-Rang");
  const unlockedCount = objectArray(projection?.unlocked).length;
  const totalCount = unlockedCount + objectArray(projection?.locked).length;
  const pointsToNextRank = Number(rank.points_to_next_rank);
  const hasNextRank = Number.isFinite(pointsToNextRank) && pointsToNextRank > 0;
  const progressLabel = hasNextRank
    ? zilchPointsText(pointsToNextRank)
    : t("Höchster Rang erreicht");
  return `<section class="zilch-card zilch-achievement-summary" aria-labelledby="zilchAchievementRankTitle">
    <div class="zilch-achievement-summary__rank">
      <span class="zilch-achievement-summary__stars" aria-hidden="true">${stars}</span>
      <div><p class="eyebrow">${escapeHtml(t("Zilch-Rang"))}</p><h2 id="zilchAchievementRankTitle">${escapeHtml(rankTitle)}</h2></div>
    </div>
    <dl class="zilch-achievement-summary__facts">
      <div><dt>${escapeHtml(t("Zilch-Punkte"))}</dt><dd>${escapeHtml(number(points))} <span>/ ${escapeHtml(number(pointsPossible))}</span></dd></div>
      <div><dt>${escapeHtml(t("Erreichte Awards"))}</dt><dd>${escapeHtml(number(unlockedCount))} <span>/ ${escapeHtml(number(totalCount))}</span></dd></div>
      <div><dt>${escapeHtml(t("Bis zum nächsten Rang"))}</dt><dd>${escapeHtml(progressLabel)}</dd></div>
    </dl>
    ${pointsPossible > 0 ? `<progress class="zilch-achievement-summary__progress" max="${pointsPossible}" value="${Math.min(points, pointsPossible)}" aria-label="${escapeHtml(t("Fortschritt der Zilch-Punkte"))}">${escapeHtml(`${number(points)} / ${number(pointsPossible)}`)}</progress>` : ""}
  </section>`;
}

function achievementRankLegendMarkup(projection, rankLegend) {
  const legend = achievementRankLegendProjection(rankLegend);
  const ranks = legend.ranks;
  if (!ranks.length) return "";
  const currentKey = String(plainObject(projection?.rank).key || "").trim();
  const pointsPossible = legend.points_possible || Math.max(0, Math.trunc(Number(projection?.points_possible) || 0));
  return `<section class="zilch-card zilch-achievement-rank-legend" data-zilch-rank-legend aria-labelledby="zilchAchievementRankLegendTitle">
    <div class="zilch-achievement-rank-legend__heading">
      <div><p class="eyebrow">${escapeHtml(t("Zilch-Rang"))}</p><h2 id="zilchAchievementRankLegendTitle">${escapeHtml(t("Ränge und Mindestwerte"))}</h2></div>
      <p>${escapeHtml(t("Sterne zeigen deinen Rang. Die Mindestwerte skalieren mit dem Erfolgskatalog."))}</p>
    </div>
    <ol class="zilch-achievement-rank-legend__list">
      ${ranks.map(rank => {
        const key = String(rank?.key || "").trim();
        const current = key && key === currentKey;
        const title = localizedAchievementValue(rank?.title_key || rank?.title || rank?.name, "Zilch-Rang");
        const minimum = Math.max(0, Math.trunc(Number(rank?.minimum_points) || 0));
        return `<li class="zilch-achievement-rank-legend__row${current ? " is-current" : ""}"${current ? ' aria-current="true"' : ""}>
          <span class="zilch-achievement-rank-legend__stars" aria-hidden="true">${escapeHtml(achievementRankStars(rank?.stars))}</span>
          <span class="zilch-achievement-rank-legend__title"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(t("Ab diesem Wert trägst du dieses Rangabzeichen."))}</small></span>
          <span class="zilch-achievement-rank-legend__minimum">${escapeHtml(`${t("ab")} ${number(minimum)} ${t("Zilch-Punkte")}`)}</span>
        </li>`;
      }).join("")}
    </ol>
    ${pointsPossible > 0 ? `<p class="zilch-achievement-rank-legend__total">${escapeHtml(`${number(pointsPossible)} ${t("Zilch-Punkte")}`)}</p>` : ""}
  </section>`;
}

function achievementFamilyKey(achievement) {
  const key = achievementKey(achievement).replace(/^zilch\./, "");
  const families = [
    [/^games_played_/, "games-played"],
    [/^career_banked_/, "career-banked"],
    [/^competitive_wins_/, "competitive-wins"],
    [/^banked_round_/, "banked-round"],
    [/^final_score_/, "final-score"],
    [/^(?:first_)?hot_dice_/, "hot-dice"],
    [/^(?:ten|twenty)_zilchs_one_game$/, "zilchs-in-game"],
    [/^win_(?:with|after)_/, "win-after-risk"],
    [/^hvh_margin_/, "hvh-margin"],
    [/^hvh_comeback_/, "hvh-comeback"],
    [/^hvh_win_under_/, "hvh-fast-win"],
    [/^marathon_win_/, "competitive-marathon"],
    [/^solo_(?:under_|sprint)/, "solo-sprint"],
    [/^community_games_/, "community-games"],
  ];
  return families.find(([pattern]) => pattern.test(key))?.[1] || key;
}

function achievementFamilyTarget(achievement) {
  const matches = achievementKey(achievement).match(/(\d+)/g) || [];
  return Number(matches.at(-1) || 0);
}

function achievementEntryOrder(first, second) {
  // Keep the personal collection immediately legible: awards already earned
  // come first in each meaningful category, followed by the next goals.
  return Number(second.unlocked) - Number(first.unlocked)
    || achievementFamilyKey(first.achievement).localeCompare(achievementFamilyKey(second.achievement))
    || achievementFamilyTarget(first.achievement) - achievementFamilyTarget(second.achievement)
    || achievementKey(first.achievement).localeCompare(achievementKey(second.achievement));
}

function achievementGroups(projection) {
  const categories = new Map();
  const add = (achievement, unlocked) => {
    const category = achievementCategoryKey(achievement);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push({ achievement, unlocked });
  };
  objectArray(projection?.unlocked).forEach(achievement => add(achievement, true));
  objectArray(projection?.locked).forEach(achievement => add(achievement, false));
  return [...categories.entries()]
    .map(([category, entries]) => [category, entries.sort(achievementEntryOrder)])
    .sort(([first], [second]) => {
      const firstIndex = ZILCH_ACHIEVEMENT_CATEGORY_ORDER.indexOf(first);
      const secondIndex = ZILCH_ACHIEVEMENT_CATEGORY_ORDER.indexOf(second);
      return (firstIndex < 0 ? Number.MAX_SAFE_INTEGER : firstIndex)
        - (secondIndex < 0 ? Number.MAX_SAFE_INTEGER : secondIndex)
        || first.localeCompare(second);
    });
}

function achievementsCatalogMarkup(projection) {
  const groups = achievementGroups(projection);
  if (!groups.length) {
    return `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Noch keine Zilch-Awards verfügbar"))}</h2><p>${escapeHtml(t("Sobald du eine Zilch-Partie abschließt, erscheinen hier deine Awards."))}</p></section>`;
  }
  return `<div class="zilch-achievement-groups">${groups.map(([category, entries]) => {
    const id = `zilchAchievementCategory-${category}`;
    return `<section class="zilch-achievement-group" aria-labelledby="${escapeHtml(id)}">
      <h2 id="${escapeHtml(id)}">${escapeHtml(achievementCategoryLabel(category, projection.categories, entries[0]?.achievement))}</h2>
      <div class="zilch-achievement-sequence">${entries.map(entry => achievementCardMarkup(entry.achievement, {
        unlocked: entry.unlocked,
      })).join("")}</div>
    </section>`;
  }).join("")}</div>`;
}

async function fetchZilchAchievements() {
  const response = await fetch("/api/zilch/achievements", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return achievementProjection(await response.json());
}

async function fetchZilchAchievementRanks() {
  const response = await fetch("/api/zilch/achievement-ranks", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return achievementRankLegendProjection(await response.json());
}

async function fetchZilchPendingAwards() {
  const response = await fetch("/api/zilch/achievements/pending", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return achievementProjection(await response.json());
}

async function acknowledgeZilchAward(award) {
  const key = achievementKey(award);
  if (!key) throw new Error("zilch_award_key_invalid");
  const response = await apiFetch(`/api/zilch/achievements/${encodeURIComponent(key)}/acknowledge`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

async function acknowledgeZilchRankUpgrade() {
  const response = await apiFetch("/api/zilch/achievement-rank/acknowledge", { method: "POST" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

function awardQueue(awards) {
  const seen = new Set();
  return objectArray(awards).filter(award => {
    const key = achievementKey(award);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function awardDialogMessage(award, index, total) {
  const category = achievementCategoryLabel(achievementCategoryKey(award), [], award);
  const description = localizedAchievementText(award, "description", "Zilch-Leistung");
  const lines = [description, `${t("Belohnung")}: ${achievementPointsText(award)}`, `${t("Kategorie")}: ${category}`];
  if (total > 1) lines.push(`${index + 1} / ${total}`);
  return lines.join("\n\n");
}

async function presentZilchAward(award, index, total) {
  const title = localizedAchievementText(award, "title", "Zilch-Award");
  let seen = false;
  if (typeof window.ZDWA_UI?.dialog === "function") {
    const choice = await window.ZDWA_UI.dialog({
      id: `zilch-award-${achievementKey(award)}`,
      title: t("Zilch-Award freigeschaltet!"),
      message: `${title}\n\n${awardDialogMessage(award, index, total)}`,
      kind: "zilch-award",
      dismissible: true,
      actions: [{ id: "acknowledge-zilch-award", label: t("Weiter"), className: "primary" }],
    });
    // Escape, the close button, and a backdrop click intentionally leave the
    // delivery pending.  Only the explicit action acknowledges presentation,
    // so a reload can safely resume an award queue the player chose to close.
    seen = choice === "acknowledge-zilch-award";
  } else {
    seen = window.confirm(`${t("Zilch-Award freigeschaltet!")}\n\n${title}\n\n${awardDialogMessage(award, index, total)}`);
  }
  if (!seen) return false;
  await acknowledgeZilchAward(award);
  return true;
}

function zilchRankUpgradePayload(value) {
  const upgrade = plainObject(value);
  const previous = plainObject(upgrade.previous);
  const current = plainObject(upgrade.current);
  const previousKey = String(previous.key || "").trim();
  const currentKey = String(current.key || "").trim();
  const previousMinimum = Number(previous.minimum_points);
  const currentMinimum = Number(current.minimum_points);
  if (!previousKey || !currentKey || previousKey === currentKey) return null;
  if (!Number.isFinite(previousMinimum) || !Number.isFinite(currentMinimum) || currentMinimum <= previousMinimum) return null;
  return { previous, current, source: upgrade };
}

function zilchRankUpgradeMessage(value) {
  const upgrade = zilchRankUpgradePayload(value);
  if (!upgrade) return "";
  const previousTitle = localizedAchievementValue(
    upgrade.previous.title_key || upgrade.previous.title || upgrade.previous.name,
    "Zilch-Rang",
  );
  const currentTitle = localizedAchievementValue(
    upgrade.current.title_key || upgrade.current.title || upgrade.current.name,
    "Zilch-Rang",
  );
  const stars = Math.max(1, Math.min(5, Math.trunc(Number(upgrade.current.stars) || 0)));
  const points = Math.max(0, Math.trunc(Number(upgrade.current.points) || 0));
  return [
    "✦".repeat(stars),
    `${t("Neuer Zilch-Rang erreicht!")} ${currentTitle}`,
    `${previousTitle} → ${currentTitle}`,
    zilchPointsText(points),
  ].join("\n\n");
}

async function presentZilchRankUpgrade(value) {
  const message = zilchRankUpgradeMessage(value);
  if (!message) return true;
  let seen = false;
  if (typeof window.ZDWA_UI?.dialog === "function") {
    const currentKey = String(plainObject(value?.current).key || "rank").trim() || "rank";
    const choice = await window.ZDWA_UI.dialog({
      id: `zilch-rank-up-${currentKey}`,
      title: t("RANGAUFSTIEG! ✨"),
      message,
      kind: "zilch-rank-up",
      dismissible: true,
      actions: [{ id: "acknowledge-zilch-rank-up", label: t("Weiter"), className: "primary" }],
    });
    seen = choice === "acknowledge-zilch-rank-up";
  } else {
    seen = window.confirm(`${t("RANGAUFSTIEG! ✨")}\n\n${message}`);
  }
  if (!seen) return false;
  await acknowledgeZilchRankUpgrade();
  return true;
}

function terminalAwardScope(snapshot) {
  const result = plainObject(snapshot?._zilch_result);
  const resultIdValue = String(result.game_id || gameId || "").trim();
  if (!authenticatedZilchPlayer() || !snapshot?._finished || snapshot?._finalization_pending || !resultIdValue || !result.result_url) return "";
  return `terminal:${resultIdValue}`;
}

function terminalGameIdFromScope(scope) {
  const prefix = "terminal:";
  const value = String(scope || "");
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : "";
}

function awardSourceGameId(award) {
  return String(achievementValue(award, ["source_game_id", "sourceGameId"]) || "").trim();
}

function awardPresentationGameId(award) {
  return String(achievementValue(award, ["presentation_game_id", "presentationGameId"])
    || awardSourceGameId(award)
    || "").trim();
}

function rankUpgradePresentationGameId(upgrade) {
  const source = plainObject(upgrade);
  return String(source.presentation_game_id || source.presentationGameId || source.source_game_id || source.sourceGameId || "").trim();
}

function renderAwardDependentGameState() {
  if (gameId && state.game?._finished && !state.stopped) renderGameState();
}

function presentPendingZilchAwards({ scope = "page" } = {}) {
  if (!scope || state.awardPresentationCheckedScopes.has(scope)) return state.awardPresentationPromise || Promise.resolve();
  if (state.awardPresentationPromise) return state.awardPresentationPromise;
  state.awardPresentationActive = true;
  renderAwardDependentGameState();
  const presentation = (async () => {
    let acknowledgementsCompleted = false;
    try {
      const pendingProjection = await fetchZilchPendingAwards();
      const pendingAwards = awardQueue(pendingProjection.pending);
      const terminalGameId = terminalGameIdFromScope(scope);
      const awards = terminalGameId
        ? pendingAwards.filter(award => sameId(awardPresentationGameId(award), terminalGameId))
        : pendingAwards;
      const rankUpgrade = zilchRankUpgradePayload(pendingProjection.rankUpgrade);
      const visibleRankUpgrade = rankUpgrade && (!terminalGameId
        || sameId(rankUpgradePresentationGameId(rankUpgrade.source), terminalGameId))
        ? rankUpgrade.source
        : null;
      if (terminalGameId) {
        let unlockedForGame = [];
        try {
          const projection = await fetchZilchAchievements();
          unlockedForGame = objectArray(projection.unlocked)
            .filter(award => sameId(awardPresentationGameId(award), terminalGameId));
        } catch (_) {
          // Pending delivery remains sufficient for the immediate end screen.
          // A later terminal reload can restore the durable profile projection.
        }
        state.terminalAwards = awardQueue([...awards, ...unlockedForGame]);
        state.terminalAwardGameId = terminalGameId;
        renderAwardDependentGameState();
      }
      state.awardPresentationCheckedScopes.add(scope);
      for (const [index, award] of awards.entries()) {
        const acknowledged = await presentZilchAward(award, index, awards.length);
        if (!acknowledged) {
          acknowledgementsCompleted = false;
          break;
        }
        acknowledgementsCompleted = true;
      }
      if (!awards.length) acknowledgementsCompleted = true;
      if (acknowledgementsCompleted && visibleRankUpgrade) {
        acknowledgementsCompleted = await presentZilchRankUpgrade(visibleRankUpgrade);
      }
      if (acknowledgementsCompleted && (achievementsRoute || accountRoute) && state.achievements) {
        try { state.achievements = await fetchZilchAchievements(); } catch (_) {}
      }
    } catch (_) {
      // An acknowledgement failure must never erase a server-side pending
      // award.  Keep the scope retryable on the next snapshot or reload.
      state.awardPresentationCheckedScopes.delete(scope);
      updateStatus(t("Zilch-Award konnte nicht bestätigt werden."), "error");
    } finally {
      state.awardPresentationActive = false;
      state.awardPresentationPromise = null;
      renderAwardDependentGameState();
      if ((achievementsRoute || accountRoute) && state.achievements) renderAchievementsBody();
    }
  })();
  state.awardPresentationPromise = presentation;
  return presentation;
}

function renderAchievementsBody() {
  const slot = document.getElementById("zilchAchievementsBody");
  if (!slot) return;
  const projection = state.achievements || {};
  const rankDetails = (achievementsRoute || (accountRoute && state.accountTab === "achievements"))
    ? `${achievementRankSummaryMarkup(projection)}${achievementRankLegendMarkup(projection, state.achievementRankLegend)}`
    : "";
  slot.innerHTML = `${rankDetails}${achievementsCatalogMarkup(projection)}`;
}

async function renderAchievements() {
  if (!content) return;
  content.innerHTML = `<section class="zilch-game-head zilch-achievements-head">
      <div><p class="eyebrow">${escapeHtml(t("Deine Sammlung"))}</p><h1>${escapeHtml(t("Zilch-Awards"))}</h1><p>${escapeHtml(t("Deine Zilch-Punkte und dein Zilch-Rang entstehen ausschließlich aus Zilch-Awards. ZDWA bleibt davon getrennt."))}</p></div>
    </section>
    <div id="zilchAchievementsBody"><section class="zilch-card zilch-loading-card" role="status"><p>${escapeHtml(t("Zilch-Awards werden geladen …"))}</p></section></div>`;
  try {
    const [achievements, rankLegend] = await Promise.all([
      fetchZilchAchievements(),
      fetchZilchAchievementRanks().catch(() => null),
    ]);
    state.achievements = achievements;
    state.achievementRankLegend = rankLegend;
    renderAchievementsBody();
  } catch (_) {
    const slot = document.getElementById("zilchAchievementsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Awards nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p>${zilchNavigationButton(zilchPath("/"), t("Zur Zilch-Lobby"))}</section>`;
  }
}

const ZILCH_ACCOUNT_TABS = new Set(["statistics", "achievements", "settings"]);

function normalizedZilchAccountTab(value, fallback = "statistics") {
  const candidate = String(value || "").replace(/^#/, "").trim().toLowerCase();
  return ZILCH_ACCOUNT_TABS.has(candidate) ? candidate : fallback;
}

function zilchAccountTabLabel(name) {
  if (name === "achievements") return t("Erfolge");
  if (name === "settings") return t("Einstellungen");
  return t("Statistiken");
}

function zilchAccountTabsMarkup() {
  return `<nav class="zilch-account-tabs" role="tablist" aria-label="${escapeHtml(t("Kontobereiche"))}">
    ${["statistics", "achievements", "settings"].map(name => `<button id="zilchAccountTab-${name}" class="zilch-account-tab${state.accountTab === name ? " is-active" : ""}" type="button" role="tab" data-zilch-account-tab="${name}" aria-selected="${String(state.accountTab === name)}" aria-controls="zilchAccountPanel-${name}" tabindex="${state.accountTab === name ? "0" : "-1"}">${escapeHtml(zilchAccountTabLabel(name))}</button>`).join("")}
  </nav>`;
}

function zilchAccountStatisticsLoadingMarkup() {
  return `<div id="zilchStatisticsBody" aria-live="polite">${statisticsTabMarkup()}<section class="zilch-card zilch-loading-card" role="status"><p>${escapeHtml(t("Zilch-Statistiken werden geladen …"))}</p></section></div>`;
}

function zilchAccountAchievementsLoadingMarkup() {
  return `<div id="zilchAchievementsBody" aria-live="polite"><section class="zilch-card zilch-loading-card" role="status"><p>${escapeHtml(t("Zilch-Awards werden geladen …"))}</p></section></div>`;
}

function zilchAccountSettingsMarkup(username) {
  const preferredLanguage = state.auth?.user?.preferences?.preferred_language === "en" ? "en" : "de";
  const passwordHint = state.auth?.user?.must_change_password
    ? `<p id="zilchPasswordHint" class="zilch-muted">${escapeHtml(t("Das temporäre Passwort muss jetzt geändert werden."))}</p>`
    : "";
  return `<div class="zilch-account-settings-grid">
    <section class="zilch-card zilch-account-settings-card">
      <p class="eyebrow">${escapeHtml(t("Einstellungen"))}</p>
      <h2>${escapeHtml(t("Sprache"))}</h2>
      <p class="zilch-account-settings-card__description">${escapeHtml(t("Die Sprache gilt für ZDWA und Zilch auf allen Geräten."))}</p>
      <form id="zilchLanguagePreferencesForm" class="zilch-settings-form">
        <fieldset>
          <legend>${escapeHtml(t("Bevorzugte Sprache"))}</legend>
          <label><input type="radio" name="zilchPreferredLanguage" value="de"${preferredLanguage === "de" ? " checked" : ""}> ${escapeHtml(t("Deutsch"))}</label>
          <label><input type="radio" name="zilchPreferredLanguage" value="en"${preferredLanguage === "en" ? " checked" : ""}> ${escapeHtml(t("Englisch"))}</label>
        </fieldset>
        <button class="primary" type="submit">${escapeHtml(t("Sprache speichern"))}</button>
      </form>
      <p id="zilchLanguagePreferencesMessage" class="zilch-settings-message" role="status"></p>
    </section>
    <section class="zilch-card zilch-account-settings-card">
      <p class="eyebrow">${escapeHtml(t("Mein Konto"))}</p>
      <h2>${escapeHtml(t("Passwort ändern"))}</h2>
      ${passwordHint}
      <form id="zilchPasswordForm" class="zilch-settings-form">
        <label>${escapeHtml(t("Aktuelles Passwort"))}<input id="zilchCurrentPassword" type="password" autocomplete="current-password" required></label>
        <label>${escapeHtml(t("Neues Passwort"))}<input id="zilchNewPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>${escapeHtml(t("Neues Passwort wiederholen"))}<input id="zilchConfirmPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <button class="primary" type="submit">${escapeHtml(t("Passwort ändern"))}</button>
      </form>
      <p id="zilchPasswordMessage" class="zilch-settings-message" role="status"></p>
    </section>
  </div>
  <section class="zilch-card zilch-account-session" aria-label="${escapeHtml(`${t("Du spielst als")} ${username}`)}">
    <div><p class="eyebrow">${escapeHtml(t("Du spielst als"))}</p><strong class="zilch-account-session__name">${escapeHtml(username)}</strong></div>
    <button id="zilchAccountLogout" class="small ghost" type="button" data-zilch-logout>${escapeHtml(t("Abmelden"))}</button>
  </section>`;
}

function showZilchAccountTab(name, { updateHash = false, focus = false } = {}) {
  const fallback = state.auth?.user?.must_change_password ? "settings" : "statistics";
  const selected = normalizedZilchAccountTab(name, fallback);
  const tabs = [...document.querySelectorAll("[data-zilch-account-tab]")];
  const panels = [...document.querySelectorAll("[data-zilch-account-panel]")];
  if (!tabs.length || !panels.length) return;
  state.accountTab = selected;
  tabs.forEach(tab => {
    const active = tab.dataset.zilchAccountTab === selected;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  panels.forEach(panel => { panel.hidden = panel.dataset.zilchAccountPanel !== selected; });
  if (selected === "achievements" && state.achievements) renderAchievementsBody();
  if (updateHash && window.location.hash !== `#${selected}`) {
    const url = new URL(window.location.href);
    url.hash = selected;
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  if (focus) document.querySelector(`[data-zilch-account-tab="${selected}"]`)?.focus();
}

function bindZilchAccountTabs() {
  const tabs = [...document.querySelectorAll("[data-zilch-account-tab]")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => showZilchAccountTab(tab.dataset.zilchAccountTab, { updateHash: true, focus: true }));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      showZilchAccountTab(tabs[next].dataset.zilchAccountTab, { updateHash: true, focus: true });
    });
  });
  if (!state.accountHashListenerBound) {
    state.accountHashListenerBound = true;
    window.addEventListener("hashchange", () => {
      if (accountRoute) showZilchAccountTab(window.location.hash, { updateHash: false });
    });
  }
  showZilchAccountTab(state.accountTab, { updateHash: false });
}

function bindZilchAccountSettings() {
  const languageForm = document.getElementById("zilchLanguagePreferencesForm");
  const passwordForm = document.getElementById("zilchPasswordForm");
  if (languageForm && !languageForm.dataset.bound) {
    languageForm.dataset.bound = "true";
    languageForm.addEventListener("submit", async event => {
      event.preventDefault();
      const messageSlot = document.getElementById("zilchLanguagePreferencesMessage");
      const selectedLanguage = languageForm.querySelector('input[name="zilchPreferredLanguage"]:checked')?.value;
      if (!messageSlot || !["de", "en"].includes(selectedLanguage)) return;
      const submit = languageForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const response = await apiFetch("/api/auth/preferences/language", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferred_language: selectedLanguage }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          messageSlot.textContent = t(authError(payload.detail));
          return;
        }
        if (state.auth?.user) {
          state.auth.user.preferences = {
            ...(state.auth.user.preferences || {}),
            preferred_language: selectedLanguage,
          };
        }
        messageSlot.textContent = t("Sprache gespeichert.");
        if (selectedLanguage !== window.ZDWA_I18N?.getLanguage?.()) {
          await window.ZDWA_I18N?.setLanguage?.(selectedLanguage, { persist: false, reload: true });
        }
      } catch (_) {
        messageSlot.textContent = t("Einstellungen konnten nicht gespeichert werden.");
      } finally {
        if (submit && document.contains(submit)) submit.disabled = false;
      }
    });
  }
  if (passwordForm && !passwordForm.dataset.bound) {
    passwordForm.dataset.bound = "true";
    passwordForm.addEventListener("submit", async event => {
      event.preventDefault();
      const messageSlot = document.getElementById("zilchPasswordMessage");
      const currentPassword = document.getElementById("zilchCurrentPassword")?.value || "";
      const newPassword = document.getElementById("zilchNewPassword")?.value || "";
      const confirmation = document.getElementById("zilchConfirmPassword")?.value || "";
      if (!messageSlot) return;
      if (newPassword !== confirmation) {
        messageSlot.textContent = t("Die neuen Passwörter stimmen nicht überein.");
        return;
      }
      const submit = passwordForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const response = await apiFetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          messageSlot.textContent = t(authError(payload.detail));
          return;
        }
        messageSlot.textContent = t("Passwort geändert. Bitte erneut anmelden.");
        window.setTimeout(() => window.location.replace(zilchPath("/anmelden")), 1_200);
      } catch (_) {
        messageSlot.textContent = t("Einstellungen konnten nicht gespeichert werden.");
      } finally {
        if (submit && document.contains(submit)) submit.disabled = false;
      }
    });
  }
}

async function renderAccount() {
  if (!content) return;
  const username = state.auth?.user?.username || t("Spieler");
  const defaultTab = state.auth?.user?.must_change_password ? "settings" : "statistics";
  state.accountTab = state.auth?.user?.must_change_password
    ? "settings"
    : normalizedZilchAccountTab(window.location.hash, defaultTab);
  content.innerHTML = `<section class="zilch-game-head zilch-account-head">
      <div><p class="eyebrow">${escapeHtml(t("Mein Zilch-Konto"))}</p><h1>${escapeHtml(username)}</h1><p>${escapeHtml(t("Dein Zilch-Konto bündelt deine privaten Statistiken und Awards."))}</p></div>
    </section>
    ${zilchAccountTabsMarkup()}
    <section id="zilchAccountPanel-statistics" class="zilch-account-panel" data-zilch-account-panel="statistics" role="tabpanel" aria-labelledby="zilchAccountTab-statistics"${state.accountTab === "statistics" ? "" : " hidden"}>${zilchAccountStatisticsLoadingMarkup()}</section>
    <section id="zilchAccountPanel-achievements" class="zilch-account-panel" data-zilch-account-panel="achievements" role="tabpanel" aria-labelledby="zilchAccountTab-achievements"${state.accountTab === "achievements" ? "" : " hidden"}>${zilchAccountAchievementsLoadingMarkup()}</section>
    <section id="zilchAccountPanel-settings" class="zilch-account-panel" data-zilch-account-panel="settings" role="tabpanel" aria-labelledby="zilchAccountTab-settings"${state.accountTab === "settings" ? "" : " hidden"}>${zilchAccountSettingsMarkup(username)}</section>`;
  bindZilchAccountTabs();
  bindZilchAccountSettings();
  const [statisticsResult, achievementsResult] = await Promise.allSettled([
    fetchZilchStatistics(),
    Promise.all([fetchZilchAchievements(), fetchZilchAchievementRanks().catch(() => null)]),
  ]);
  if (statisticsResult.status === "fulfilled") {
    state.statistics = statisticsResult.value;
    renderStatisticsBody();
  } else {
    const slot = document.getElementById("zilchStatisticsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Statistiken nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p>${zilchNavigationButton(zilchPath("/"), t("Zur Zilch-Lobby"))}</section>`;
  }
  if (achievementsResult.status === "fulfilled") {
    [state.achievements, state.achievementRankLegend] = achievementsResult.value;
    renderAchievementsBody();
  } else {
    const slot = document.getElementById("zilchAchievementsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Awards nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p></section>`;
  }
}

async function fetchZilchPlayerAchievements(username) {
  const response = await fetch(`/api/zilch/players/${encodeURIComponent(username)}/achievements`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return achievementProjection(await response.json());
}

async function renderPlayerAchievements() {
  if (!content || !playerAchievementsUsername) return;
  const requestedName = String(playerAchievementsUsername || "").trim();
  content.innerHTML = `<section class="zilch-game-head zilch-achievements-head">
      <div><p class="eyebrow">${escapeHtml(t("Zilch-Sammlung"))}</p><h1>${escapeHtml(t("Zilch-Awards eines Spielers"))}</h1><p>${escapeHtml(t("Diese Ansicht zeigt ausschließlich Zilch-Awards, Zilch-Punkte und Zilch-Ränge. ZDWA bleibt davon getrennt."))}</p></div>
      ${zilchNavigationButton(zilchPath("/erfolge"), t("Meine Zilch-Awards"))}
    </section>
    <div id="zilchPlayerAchievementsBody"><section class="zilch-card zilch-loading-card" role="status"><p>${escapeHtml(t("Zilch-Awards werden geladen …"))}</p></section></div>`;
  try {
    const [playerAchievements, rankLegend] = await Promise.all([
      fetchZilchPlayerAchievements(requestedName),
      fetchZilchAchievementRanks().catch(() => null),
    ]);
    state.playerAchievements = playerAchievements;
    state.achievementRankLegend = rankLegend;
    const slot = document.getElementById("zilchPlayerAchievementsBody");
    const displayName = String(state.playerAchievements.player?.username || state.playerAchievements.player?.display_name || requestedName);
    document.title = `${displayName} – ${t("Zilch-Awards")}`;
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-achievement-profile" aria-labelledby="zilchAchievementProfileTitle"><p class="eyebrow">${escapeHtml(t("Zilch-Sammlung"))}</p><h2 id="zilchAchievementProfileTitle">${escapeHtml(displayName)}</h2></section>${achievementRankSummaryMarkup(state.playerAchievements)}${achievementRankLegendMarkup(state.playerAchievements, state.achievementRankLegend)}${achievementsCatalogMarkup(state.playerAchievements)}`;
  } catch (_) {
    const slot = document.getElementById("zilchPlayerAchievementsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Awards nicht verfügbar"))}</h2><p>${escapeHtml(t("Dieser Zilch-Spieler konnte nicht gefunden werden."))}</p>${zilchNavigationButton(zilchPath("/erfolge"), t("Meine Zilch-Awards"))}</section>`;
  }
}

// Statistics and ranking values are intentionally rendered as a projection of
// the account-scoped API response. The browser never combines results, derives a
// win rate, or rebuilds a ranking tuple: all of that stays in the typed Zilch
// statistics service.
function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function statisticValue(sources, keys) {
  const lookup = Array.isArray(sources) ? sources : [sources];
  for (const source of lookup) {
    const object = plainObject(source);
    for (const key of keys) {
      const value = object[key];
      if (value !== null && value !== undefined && value !== "") return value;
    }
  }
  return null;
}

function statisticSources(value) {
  const source = plainObject(value);
  return [source, plainObject(source.metrics), plainObject(source.values), plainObject(source.summary)];
}

function statisticEntry(label, source, keys, format = "number") {
  const value = statisticValue(statisticSources(source), keys);
  if (value === null) return null;
  return { label, value, format };
}

function matchRecordStatisticEntry(source) {
  const wins = statisticValue(statisticSources(source), ["wins"]);
  const losses = statisticValue(statisticSources(source), ["losses"]);
  const ties = statisticValue(statisticSources(source), ["ties", "draws"]);
  if ([wins, losses, ties].every(value => value === null)) return null;
  return {
    label: t("Bilanz (S–N–U)"),
    value: [wins, losses, ties].map(value => number(value ?? 0)).join("–"),
    format: "text",
  };
}

function formattedPercentage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || t("Nicht verfügbar"));
  const percent = Math.abs(numeric) <= 1 ? numeric : numeric / 100;
  return new Intl.NumberFormat(window.ZDWA_I18N?.locale?.() || "de-CH", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(percent);
}

function formattedStatistic(value, format = "number") {
  if (value === null || value === undefined || value === "") return t("Nicht verfügbar");
  if (format === "duration") return formattedDuration(value);
  if (format === "datetime") return formattedDateTime(value);
  if (format === "percentage") return formattedPercentage(value);
  if (format === "achievement-rank") {
    const rank = plainObject(value);
    const stars = Math.max(0, Math.min(5, Math.trunc(Number(rank.stars) || 0)));
    const title = localizedAchievementValue(rank.title_key || rank.title || rank.name, "Zilch-Rang");
    return `${stars ? `${"★".repeat(stars)} ` : ""}${title}`;
  }
  if (format === "text") return String(value);
  return number(value);
}

function statisticsProjection(payload) {
  const outer = plainObject(payload);
  return plainObject(outer.statistics && typeof outer.statistics === "object" ? outer.statistics : outer);
}

async function fetchZilchStatistics() {
  const response = await fetch("/api/zilch/statistics", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return statisticsProjection(await response.json());
}

function statisticsScope(statistics, key) {
  const source = plainObject(statistics);
  if (key === "overview") return plainObject(source.overview);
  if (key === "multiplayer") return plainObject(source.multiplayer);
  if (key === "cpu") return plainObject(source.cpu);
  if (key === "solo") return plainObject(source.solo);
  return {};
}

function modeLabel(mode) {
  if (mode === "multiplayer") return t("Zwei Spieler");
  if (mode === "cpu") return t("Gegen CPU");
  if (mode === "solo") return t("Solo");
  return t("Übersicht");
}

function statisticsTabMarkup() {
  const tabs = ["overview", "multiplayer", "cpu", "solo"];
  return `<div class="zilch-stats-tabs" role="tablist" aria-label="${escapeHtml(t("Statistikbereich auswählen"))}">
    ${tabs.map(mode => `<button id="zilchStatsTab-${mode}" type="button" class="zilch-stats-tab${state.statisticsMode === mode ? " is-active" : ""}" role="tab" data-zilch-stats-mode="${mode}" aria-selected="${String(state.statisticsMode === mode)}" aria-controls="zilchStatisticsPanel" tabindex="${state.statisticsMode === mode ? "0" : "-1"}">${escapeHtml(modeLabel(mode))}</button>`).join("")}
  </div>`;
}

function metricsMarkup(entries) {
  const present = entries.filter(Boolean);
  if (!present.length) return `<p class="zilch-muted">${escapeHtml(t("Keine vergleichbaren Daten verfügbar."))}</p>`;
  return `<dl class="zilch-stat-metrics">${present.map(entry => `<div><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(formattedStatistic(entry.value, entry.format))}</dd></div>`).join("")}</dl>`;
}

function statisticsSection({ eyebrow, title, description, entries, extra = "" }) {
  return `<section class="zilch-card zilch-statistics-card">
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <h2>${escapeHtml(title)}</h2>
    ${description ? `<p class="zilch-statistics-card__description">${escapeHtml(description)}</p>` : ""}
    ${metricsMarkup(entries)}
    ${extra}
  </section>`;
}

function hasStatisticRecords(source, keys = ["games", "runs", "completed_records"]) {
  const value = statisticValue(statisticSources(source), keys);
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function statisticsEmptyMarkup(title, description) {
  return `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></section>`;
}

function gamesByModeMarkup(source) {
  const modes = plainObject(statisticValue(statisticSources(source), ["games_by_mode", "completed_by_mode", "modes"]));
  const entries = ["multiplayer", "cpu", "solo"].map(mode => {
    const value = statisticValue([modes], [mode]);
    return value === null ? null : { label: modeLabel(mode), value };
  }).filter(Boolean);
  if (!entries.length) return "";
  return `<section class="zilch-card zilch-statistics-card zilch-statistics-card--compact"><p class="eyebrow">${escapeHtml(t("Nach Spielart"))}</p><h2>${escapeHtml(t("Partien nach Spielart"))}</h2>${metricsMarkup(entries)}</section>`;
}

function renderOverviewStatistics(statistics) {
  const overview = statisticsScope(statistics, "overview");
  if (!hasStatisticRecords(overview, ["completed_records", "completed_games_and_runs", "completed", "games"])) {
    return statisticsEmptyMarkup(t("Noch keine Zilch-Partien"), t("Schließe eine Zilch-Partie ab, damit hier deine getrennten Werte erscheinen."));
  }
  const entries = [
    statisticEntry(t("Abgeschlossene Partien und Läufe"), overview, ["completed_records", "completed_games_and_runs", "completed", "completed_count", "games"]),
  ];
  return `${statisticsSection({
    eyebrow: t("Übersicht"),
    title: t("Deine Zilch-Statistiken"),
    description: t("Diese Werte stammen nur aus deinen gespeicherten Zilch-Ergebnissen."),
    entries,
  })}${gamesByModeMarkup(overview)}`;
}

function renderMultiplayerStatistics(statistics) {
  const multiplayer = statisticsScope(statistics, "multiplayer");
  if (!hasStatisticRecords(multiplayer, ["games", "completed_games"])) {
    return statisticsEmptyMarkup(t("Noch keine Human-vs-Human-Partien"), t("Spiele eine Partie gegen einen anderen Menschen, damit diese Werte erscheinen."));
  }
  return statisticsSection({
    eyebrow: t("Zwei Spieler"),
    title: t("Human-vs-Human"),
    description: t("Solo-Läufe und CPU-Partien zählen hier nicht mit."),
    entries: [
      statisticEntry(t("Spiele"), multiplayer, ["games", "completed_games"]),
      matchRecordStatisticEntry(multiplayer),
      statisticEntry(t("Siegquote"), multiplayer, ["win_rate", "win_percentage"], "percentage"),
      statisticEntry(t("Höchste Endpunktzahl"), multiplayer, ["highest_final_score", "best_final_score"]),
    ],
  });
}

function cpuStrategyLabel(strategy) {
  return strategyLabel(strategy) || t("Alle Strategien");
}

function cpuStrategyTabsMarkup(cpu) {
  const byStrategy = plainObject(cpu.by_strategy);
  const available = ["all", "conservative", "normal", "aggressive"].filter(strategy => (
    strategy === "all" || Object.prototype.hasOwnProperty.call(byStrategy, strategy)
  ));
  return `<div class="zilch-stat-subtabs" role="tablist" aria-label="${escapeHtml(t("CPU-Strategie auswählen"))}">
    ${available.map(strategy => `<button type="button" class="zilch-stat-subtab${state.statisticsCpuStrategy === strategy ? " is-active" : ""}" role="tab" data-zilch-stats-cpu-strategy="${strategy}" aria-selected="${String(state.statisticsCpuStrategy === strategy)}" aria-controls="zilchStatisticsPanel" tabindex="${state.statisticsCpuStrategy === strategy ? "0" : "-1"}">${escapeHtml(cpuStrategyLabel(strategy))}</button>`).join("")}
  </div>`;
}

function renderCpuStatistics(statistics) {
  const cpu = statisticsScope(statistics, "cpu");
  const byStrategy = plainObject(cpu.by_strategy);
  const selected = state.statisticsCpuStrategy;
  const scope = selected === "all" ? plainObject(cpu.overall || cpu) : plainObject(byStrategy[selected]);
  const noGames = !hasStatisticRecords(scope, ["games", "completed_games"]);
  if (noGames) {
    return `${cpuStrategyTabsMarkup(cpu)}${statisticsEmptyMarkup(
      selected === "all" ? t("Noch keine CPU-Partien") : t("Noch keine CPU-Partien gegen diese Strategie"),
      t("Erstelle eine Partie gegen die CPU, damit diese Werte erscheinen."),
    )}`;
  }
  return `${cpuStrategyTabsMarkup(cpu)}${statisticsSection({
    eyebrow: t("Gegen CPU"),
    title: selected === "all" ? t("Alle CPU-Partien") : `${t("CPU-Strategie")}: ${cpuStrategyLabel(selected)}`,
    description: t("CPU-Gegner erhalten keinen Account-Rang. Jede Strategie bleibt getrennt auswertbar."),
    entries: [
      statisticEntry(t("Spiele"), scope, ["games", "completed_games"]),
      matchRecordStatisticEntry(scope),
      statisticEntry(t("Siegquote"), scope, ["win_rate", "win_percentage"], "percentage"),
      statisticEntry(t("Höchste Endpunktzahl"), scope, ["highest_final_score", "best_final_score"]),
    ],
  })}`;
}

function personalBestMarkup(solo) {
  const best = plainObject(statisticValue(statisticSources(solo), ["personal_best", "best_run"]));
  if (!Object.keys(best).length) return "";
  const entries = [
    statisticEntry(t("Züge"), best, ["turns", "turn_count"]),
    statisticEntry(t("Würfe"), best, ["rolls", "roll_count"]),
    statisticEntry(t("Zilch-Runden"), best, ["zilchs", "zilch_count"]),
  ];
  return statisticsSection({
    eyebrow: t("Persönliche Bestleistung"),
    title: t("10’000-Punkte-Sprint"),
    description: t("Vergleichbar sind nur erfolgreich abgeschlossene Solo-Sprints derselben Objective-Version."),
    entries,
  });
}

function renderSoloStatistics(statistics) {
  const solo = statisticsScope(statistics, "solo");
  if (!hasStatisticRecords(solo, ["runs", "saved_runs", "started_runs"])) {
    return statisticsEmptyMarkup(t("Noch keine Solo-Läufe"), t("Starte einen Solo-Sprint, damit Fortschritt und Bestleistung hier erscheinen."));
  }
  return `${statisticsSection({
    eyebrow: t("Solo"),
    title: t("Solo-Sprint"),
    description: t("Aufgegebene Läufe bleiben in deiner Historie, sind aber nicht für die Bestenliste qualifiziert."),
    entries: [
      statisticEntry(t("Gespeicherte Läufe"), solo, ["saved_runs", "runs", "started_runs"]),
      statisticEntry(t("Abgeschlossen"), solo, ["completed", "completed_runs"]),
    ],
  })}${personalBestMarkup(solo)}`;
}

function statisticsContentMarkup(statistics) {
  if (state.statisticsMode === "multiplayer") return renderMultiplayerStatistics(statistics);
  if (state.statisticsMode === "cpu") return renderCpuStatistics(statistics);
  if (state.statisticsMode === "solo") return renderSoloStatistics(statistics);
  return renderOverviewStatistics(statistics);
}

function bindStatisticsTabs() {
  const tabs = [...document.querySelectorAll("[data-zilch-stats-mode]")];
  const activate = (button, { focus = false } = {}) => {
    state.statisticsMode = String(button?.dataset?.zilchStatsMode || "overview");
    renderStatisticsBody();
    if (focus) document.querySelector(`[data-zilch-stats-mode="${state.statisticsMode}"]`)?.focus();
  };
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => activate(button, { focus: true }));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let target = index;
      if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = tabs.length - 1;
      activate(tabs[target], { focus: true });
    });
  });
  const cpuTabs = [...document.querySelectorAll("[data-zilch-stats-cpu-strategy]")];
  const activateCpu = (button, { focus = false } = {}) => {
    state.statisticsCpuStrategy = String(button?.dataset?.zilchStatsCpuStrategy || "all");
    renderStatisticsBody();
    if (focus) document.querySelector(`[data-zilch-stats-cpu-strategy="${state.statisticsCpuStrategy}"]`)?.focus();
  };
  cpuTabs.forEach((button, index) => {
    button.addEventListener("click", () => activateCpu(button, { focus: true }));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let target = index;
      if (event.key === "ArrowLeft") target = (index - 1 + cpuTabs.length) % cpuTabs.length;
      if (event.key === "ArrowRight") target = (index + 1) % cpuTabs.length;
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = cpuTabs.length - 1;
      activateCpu(cpuTabs[target], { focus: true });
    });
  });
}

function renderStatisticsBody() {
  const slot = document.getElementById("zilchStatisticsBody");
  if (!slot) return;
  slot.innerHTML = `${statisticsTabMarkup()}<div id="zilchStatisticsPanel" class="zilch-statistics-panel" role="tabpanel" aria-live="polite" aria-labelledby="zilchStatsTab-${escapeHtml(state.statisticsMode)}">${statisticsContentMarkup(state.statistics || {})}</div>`;
  bindStatisticsTabs();
}

async function renderStatistics() {
  if (!content) return;
  content.innerHTML = `<section class="zilch-game-head zilch-statistics-head">
      <div><p class="eyebrow">${escapeHtml(t("Deine Auswertung"))}</p><h1>${escapeHtml(t("Zilch-Statistiken"))}</h1><p>${escapeHtml(t("Deine Zilch-Werte werden getrennt von ZDWA und ausschließlich aus gespeicherten Ergebnissen berechnet."))}</p></div>
      ${zilchNavigationButton(zilchPath("/bestenlisten"), t("Zu den Bestenlisten"))}
    </section>
    <div id="zilchStatisticsBody" aria-live="polite">${statisticsTabMarkup()}<section class="zilch-card zilch-loading-card"><p>${escapeHtml(t("Zilch-Statistiken werden geladen …"))}</p></section></div>`;
  try {
    state.statistics = await fetchZilchStatistics();
    renderStatisticsBody();
  } catch (_) {
    const slot = document.getElementById("zilchStatisticsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Statistiken nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p>${zilchNavigationButton(zilchPath("/"), t("Zur Zilch-Lobby"))}</section>`;
  }
}

function normalizedLeaderboardCategory(value) {
  const category = String(value || "").toLowerCase();
  return ZILCH_LEADERBOARD_CATEGORIES.has(category) ? category : "solo_sprint";
}

function leaderboardCategoryLabel(category) {
  if (category === "multiplayer_wins") return t("Zwei Spieler · Siege");
  if (category === "cpu_wins") return t("Gegen CPU · Siege");
  if (category === "achievement_points") return t("Zilch-Punkte");
  return t("Solo-Sprint");
}

function leaderboardSortingDescription(category) {
  if (category === "multiplayer_wins") return t("Sortierung: Siege, dann weniger Niederlagen, mehr Gleichstände, höhere Endpunktzahl und höchste Runde; Competition Ranking.");
  if (category === "cpu_wins") return t("Sortierung: Siege gegen die gewählte Strategie, dann weniger Niederlagen, mehr Gleichstände, höhere Endpunktzahl und höchste Runde; Competition Ranking.");
  if (category === "achievement_points") return t("Sortierung: meiste Zilch-Punkte; bei Gleichstand wird derselbe Rang geteilt.");
  return t("Sortierung: wenige Züge, wenige Würfe, wenige Zilchs, kurze aktive Dauer, dann älterer Abschluss.");
}

function leaderboardProjection(payload) {
  const outer = plainObject(payload);
  return plainObject(outer.leaderboard && typeof outer.leaderboard === "object" ? outer.leaderboard : outer);
}

async function fetchZilchLeaderboard() {
  const params = new URLSearchParams({
    category: state.leaderboardCategory,
    limit: String(ZILCH_LEADERBOARD_LIMIT),
    offset: String(Math.max(0, Number(state.leaderboardOffset) || 0)),
  });
  if (state.leaderboardCategory === "cpu_wins") params.set("strategy", state.leaderboardStrategy);
  const response = await fetch(`/api/zilch/leaderboards?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return leaderboardProjection(await response.json());
}

function leaderboardEntrySources(entry) {
  const source = plainObject(entry);
  return [source, plainObject(source.values), plainObject(source.tie_breaks), plainObject(source.metrics)];
}

function leaderboardEntryValue(entry, keys) {
  return statisticValue(leaderboardEntrySources(entry), keys);
}

function leaderboardColumns(category) {
  if (category === "achievement_points") {
    return [
      { key: "points", label: t("Zilch-Punkte"), aliases: ["achievement_points", "points", "primary_value"] },
      { key: "achievement-rank", label: t("Zilch-Rang"), aliases: ["zilch_achievement_rank", "achievement_rank"], format: "achievement-rank" },
      { key: "games", label: t("Spiele"), aliases: ["games"] },
    ];
  }
  if (category === "solo_sprint") {
    return [
      { key: "turns", label: t("Züge"), aliases: ["turns", "turn_count"] },
      { key: "rolls", label: t("Würfe"), aliases: ["rolls", "roll_count"] },
      { key: "zilchs", label: t("Zilch-Runden"), aliases: ["zilchs", "zilch_count"] },
      { key: "duration", label: t("Aktive Dauer"), aliases: ["active_duration_seconds", "active_duration"], format: "duration" },
      { key: "finished", label: t("Abgeschlossen am"), aliases: ["finished_at"], format: "datetime" },
    ];
  }
  if (category === "multiplayer_wins") {
    return [
      { key: "wins", label: t("Siege"), aliases: ["wins", "primary_value"] },
      { key: "games", label: t("Spiele"), aliases: ["games"] },
      { key: "losses", label: t("Niederlagen"), aliases: ["losses"] },
      { key: "ties", label: t("Gleichstände"), aliases: ["ties", "draws"] },
      { key: "rate", label: t("Siegquote"), aliases: ["win_rate", "win_percentage"], format: "percentage" },
      { key: "best", label: t("Beste Endpunktzahl"), aliases: ["best_final_score", "highest_final_score", "best_score"] },
      { key: "highest", label: t("Höchste gesicherte Runde"), aliases: ["highest_banked_round", "highest_round"] },
    ];
  }
  return [
    { key: "wins", label: t("Siege"), aliases: ["wins", "primary_value"] },
    { key: "games", label: t("Spiele"), aliases: ["games"] },
    { key: "losses", label: t("Niederlagen"), aliases: ["losses"] },
    { key: "ties", label: t("Gleichstände"), aliases: ["ties", "draws"] },
    { key: "rate", label: t("Siegquote"), aliases: ["win_rate", "win_percentage"], format: "percentage" },
    { key: "best", label: t("Beste Endpunktzahl"), aliases: ["best_final_score", "highest_final_score", "best_score"] },
    { key: "highest", label: t("Höchste gesicherte Runde"), aliases: ["highest_banked_round", "highest_round"] },
  ];
}

function isOwnLeaderboardEntry(entry) {
  if (entry?.is_current_user === true) return true;
  const ownId = state.auth?.user?.id;
  return ownId !== null && ownId !== undefined && samePresentId(entry?.user_id, ownId);
}

function zilchPlayerAchievementLink(entry) {
  return playerCollectionMarkup(entry);
}

function leaderboardTableMarkup(leaderboard) {
  const entries = Array.isArray(leaderboard.entries) ? leaderboard.entries : [];
  const columns = leaderboardColumns(state.leaderboardCategory);
  if (!entries.length) return `<section class="zilch-empty-state"><h2>${escapeHtml(t("Noch keine vergleichbaren Ergebnisse"))}</h2><p>${escapeHtml(t("Sobald eine passende Zilch-Partie abgeschlossen ist, erscheint sie hier."))}</p></section>`;
  const compact = state.leaderboardCategory === "achievement_points";
  return `<div class="zilch-leaderboard-table-wrap${compact ? " zilch-leaderboard-table-wrap--compact" : ""}" tabindex="0" aria-label="${escapeHtml(t("Zilch-Bestenliste"))}">
    <table class="zilch-leaderboard-table">
      <thead><tr><th scope="col">${escapeHtml(t("Rang"))}</th><th scope="col">${escapeHtml(t("Spieler"))}</th>${columns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
      <tbody>${entries.map(entry => {
        const own = isOwnLeaderboardEntry(entry);
        const rank = leaderboardEntryValue(entry, ["rank"]);
        return `<tr${own ? ' class="is-own" data-own-entry="true" aria-label="' + escapeHtml(t("Dein Eintrag")) + '"' : ""}>
          <th scope="row">${escapeHtml(rank === null ? "—" : number(rank))}</th>
          <td>${zilchPlayerAchievementLink(entry)}${own ? `<span class="zilch-own-marker">${escapeHtml(t("Du"))}</span>` : ""}</td>
          ${columns.map(column => {
            const value = leaderboardEntryValue(entry, column.aliases);
            return `<td>${escapeHtml(value === null ? "—" : formattedStatistic(value, column.format))}</td>`;
          }).join("")}
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div>`;
}

function ownLeaderboardEntryMarkup(leaderboard) {
  const own = plainObject(leaderboard.own_entry);
  const entries = Array.isArray(leaderboard.entries) ? leaderboard.entries : [];
  if (!Object.keys(own).length || entries.some(entry => isOwnLeaderboardEntry(entry))) return "";
  const rank = leaderboardEntryValue(own, ["rank"]);
  const primary = leaderboardEntryValue(own, state.leaderboardCategory === "achievement_points"
    ? ["achievement_points", "points", "primary_value"]
    : ["primary_value"]);
  const primaryLabel = state.leaderboardCategory === "achievement_points" && primary !== null
    ? zilchPointsText(primary)
    : primary === null ? "" : formattedStatistic(primary);
  return `<aside class="zilch-card zilch-own-leaderboard-entry" aria-label="${escapeHtml(t("Dein Eintrag"))}"><p class="eyebrow">${escapeHtml(t("Dein Eintrag"))}</p><h2>${zilchPlayerAchievementLink(own)}</h2><p><strong>${escapeHtml(t("Rang"))} ${escapeHtml(rank === null ? "—" : number(rank))}</strong>${primaryLabel ? ` · ${escapeHtml(primaryLabel)}` : ""}</p></aside>`;
}

function leaderboardPaginationMarkup(leaderboard) {
  const offset = Math.max(0, Number(leaderboard.offset ?? state.leaderboardOffset) || 0);
  const limit = Math.max(1, Number(leaderboard.limit) || ZILCH_LEADERBOARD_LIMIT);
  const total = Number(leaderboard.total);
  if (!Number.isFinite(total) || total <= limit) return "";
  const previousDisabled = offset <= 0;
  const nextDisabled = offset + limit >= total;
  return `<nav class="zilch-leaderboard-pagination" aria-label="${escapeHtml(t("Seitennavigation der Bestenliste"))}">
    <button type="button" class="small ghost" data-zilch-leaderboard-page="previous"${previousDisabled ? " disabled" : ""}>${escapeHtml(t("Vorherige"))}</button>
    <p>${escapeHtml(interpolated("{from}–{to} von {total}", { from: number(offset + 1), to: number(Math.min(offset + limit, total)), total: number(total) }))}</p>
    <button type="button" class="small ghost" data-zilch-leaderboard-page="next"${nextDisabled ? " disabled" : ""}>${escapeHtml(t("Nächste"))}</button>
  </nav>`;
}

function leaderboardControlsMarkup() {
  const category = state.leaderboardCategory;
  const cpu = category === "cpu_wins";
  return `<form id="zilchLeaderboardFilters" class="zilch-leaderboard-filters" aria-label="${escapeHtml(t("Bestenliste filtern"))}">
    <label><span>${escapeHtml(t("Kategorie"))}</span><select name="category">
      ${["solo_sprint", "multiplayer_wins", "cpu_wins", "achievement_points"].map(value => `<option value="${value}"${value === category ? " selected" : ""}>${escapeHtml(leaderboardCategoryLabel(value))}</option>`).join("")}
    </select></label>
    <label id="zilchLeaderboardStrategyFilter"${cpu ? "" : " hidden"}><span>${escapeHtml(t("CPU-Strategie"))}</span><select name="strategy">
      ${["conservative", "normal", "aggressive"].map(value => `<option value="${value}"${value === state.leaderboardStrategy ? " selected" : ""}>${escapeHtml(strategyLabel(value))}</option>`).join("")}
    </select></label>
  </form>`;
}

function leaderboardObjectiveMarkup(leaderboard) {
  const objective = plainObject(leaderboard?.objective);
  const objectiveId = String(objective.id || "").trim();
  const version = objective.version;
  if (!objectiveId || version === null || version === undefined || version === "") return "";
  const title = objectiveId === SOLO_SPRINT_OBJECTIVE_ID
    ? t("10’000-Punkte-Sprint")
    : objectiveId;
  return `<p class="zilch-leaderboard-objective"><strong>${escapeHtml(t("Objective"))}:</strong> ${escapeHtml(title)} · ${escapeHtml(t("Version"))} ${escapeHtml(String(version))}</p>`;
}

function updateLeaderboardLocation() {
  const params = new URLSearchParams({ category: state.leaderboardCategory });
  if (state.leaderboardCategory === "cpu_wins") params.set("strategy", state.leaderboardStrategy);
  const query = params.toString();
  window.history.replaceState({}, "", zilchPath(`/bestenlisten${query ? `?${query}` : ""}`));
}

function bindLeaderboardControls() {
  const form = document.getElementById("zilchLeaderboardFilters");
  if (form) form.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.name === "category") state.leaderboardCategory = normalizedLeaderboardCategory(target.value);
    if (target.name === "strategy" && CPU_STRATEGIES.has(target.value)) state.leaderboardStrategy = target.value;
    state.leaderboardOffset = 0;
    updateLeaderboardLocation();
    const focusSelector = target.name === "strategy"
      ? '#zilchLeaderboardFilters select[name="strategy"]'
      : '#zilchLeaderboardFilters select[name="category"]';
    void refreshLeaderboard({ focusSelector });
  });
  document.querySelectorAll("[data-zilch-leaderboard-page]").forEach(button => button.addEventListener("click", () => {
    const direction = button.dataset.zilchLeaderboardPage;
    const limit = Math.max(1, Number(state.leaderboard?.limit) || ZILCH_LEADERBOARD_LIMIT);
    state.leaderboardOffset = direction === "next"
      ? state.leaderboardOffset + limit
      : Math.max(0, state.leaderboardOffset - limit);
    void refreshLeaderboard({ focusSelector: `[data-zilch-leaderboard-page="${direction}"]` });
  }));
}

function renderLeaderboardBody() {
  const slot = document.getElementById("zilchLeaderboardBody");
  if (!slot) return;
  const leaderboard = state.leaderboard || {};
  slot.innerHTML = `<section class="zilch-card zilch-leaderboard-card">
      <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Bestenlisten"))}</p><h2>${escapeHtml(leaderboardCategoryLabel(state.leaderboardCategory))}</h2></div><p class="zilch-leaderboard-sorting">${escapeHtml(leaderboardSortingDescription(state.leaderboardCategory))}</p></div>
      ${leaderboardObjectiveMarkup(leaderboard)}
      ${leaderboardControlsMarkup()}
      ${leaderboardTableMarkup(leaderboard)}
      ${leaderboardPaginationMarkup(leaderboard)}
    </section>${ownLeaderboardEntryMarkup(leaderboard)}`;
  bindLeaderboardControls();
}

async function refreshLeaderboard({ focusSelector = "" } = {}) {
  const slot = document.getElementById("zilchLeaderboardBody");
  if (!slot) return;
  slot.setAttribute("aria-busy", "true");
  try {
    state.leaderboard = await fetchZilchLeaderboard();
    state.leaderboardOffset = Math.max(0, Number(state.leaderboard.offset ?? state.leaderboardOffset) || 0);
    renderLeaderboardBody();
    if (focusSelector) document.querySelector(focusSelector)?.focus();
  } catch (_) {
    slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Bestenliste nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p>${zilchNavigationButton(zilchPath("/"), t("Zur Zilch-Lobby"))}</section>`;
  } finally {
    slot.removeAttribute("aria-busy");
  }
}

async function renderLeaderboards() {
  if (!content) return;
  const params = new URLSearchParams(window.location.search);
  state.leaderboardCategory = normalizedLeaderboardCategory(params.get("category"));
  const strategy = String(params.get("strategy") || state.leaderboardStrategy).toLowerCase();
  state.leaderboardStrategy = CPU_STRATEGIES.has(strategy) ? strategy : "conservative";
  state.leaderboardOffset = 0;
  content.innerHTML = `<section class="zilch-game-head zilch-leaderboards-head">
      <div><p class="eyebrow">${escapeHtml(t("Spieler & Ranking"))}</p><h1>${escapeHtml(t("Zilch-Bestenlisten"))}</h1><p>${escapeHtml(t("Die Ranglisten vergleichen deine besten abgeschlossenen Zilch-Partien."))}</p></div>
      <div class="zilch-actions">${zilchNavigationButton(zilchPath("/statistiken"), t("Deine Statistiken"))}${zilchNavigationButton(zilchPath("/erfolge"), t("Zilch-Awards"))}</div>
    </section>
    <div id="zilchLeaderboardBody" aria-live="polite"><section class="zilch-card zilch-loading-card"><p>${escapeHtml(t("Zilch-Bestenliste wird geladen …"))}</p></section></div>`;
  await refreshLeaderboard();
}

function ruleNumber(value) {
  return Number.isFinite(Number(value)) ? number(value) : t("Nicht verfügbar");
}

async function fetchZilchRules() {
  const response = await fetch("/api/zilch/rules", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : null;
}

function rulesTableRow(label, value, detail) {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></td></tr>`;
}

function renderRulesContent(facts) {
  const scoring = facts?.scoring && typeof facts.scoring === "object" ? facts.scoring : {};
  const target = ruleNumber(facts?.target_score);
  const objective = interpolated("Erreiche {target} Punkte. Danach spielt die andere Person noch einen vollständigen Zug; anschliessend gewinnt der höchste Punktestand.", { target });
  return `<section class="zilch-game-head zilch-rules-head">
      <div><p class="eyebrow">${escapeHtml(t("Spielhilfe"))}</p><h1>${escapeHtml(t("Zilch-Regeln"))}</h1><p>${escapeHtml(t("Alles Wichtige für deine nächste Partie auf einen Blick."))}</p></div>
    </section>
    <section class="zilch-card zilch-rules-overview">
      <h2>${escapeHtml(t("Ziel der Partie"))}</h2>
      <p>${escapeHtml(objective)}</p>
      <p class="zilch-rules-overview__note">${escapeHtml(t("Pro Zug entscheidest du: Punkte sichern oder weiterwürfeln. Bei Zilch verfallen nur die noch nicht gesicherten Punkte."))}</p>
    </section>
    <section class="zilch-card zilch-rules-section" aria-labelledby="zilchScoringTitle">
      <p class="eyebrow">${escapeHtml(t("Wertung"))}</p><h2 id="zilchScoringTitle">${escapeHtml(t("Was Punkte bringt"))}</h2>
      <div class="zilch-rule-table-wrap"><table class="zilch-rule-table"><tbody>
        ${rulesTableRow(t("Einzelne Einsen"), `${ruleNumber(scoring.single_one)} ${t("Punkte")}`, t("Jede einzeln gehaltene 1 zählt."))}
        ${rulesTableRow(t("Einzelne Fünfen"), `${ruleNumber(scoring.single_five)} ${t("Punkte")}`, t("Jede einzeln gehaltene 5 zählt."))}
        ${rulesTableRow(t("Drei Einsen"), `${ruleNumber(scoring.three_ones)} ${t("Punkte")}`, t("Ein Drilling Einsen erfordert danach einen Bestätigungswurf."))}
        ${rulesTableRow(t("Drillinge 2 bis 6"), t("Augenzahl × 100"), t("Drei gleiche Würfel werden als Drilling gewertet."))}
        ${rulesTableRow(t("Vier Gleiche (2 bis 6)"), t("Doppelter Drillingwert"), t("Vier gleiche Würfel zählen doppelt so viel wie der passende Drilling."))}
        ${rulesTableRow(t("Fünf Gleiche (2 bis 6)"), t("Vierfacher Drillingwert"), t("Fünf gleiche Würfel zählen viermal so viel wie der passende Drilling."))}
        ${rulesTableRow(t("Sechs Gleiche (2 bis 6)"), t("Achtfacher Drillingwert"), t("Sechs gleiche Würfel zählen achtmal so viel wie der passende Drilling und lösen Hot Dice aus."))}
        ${rulesTableRow(t("Vier oder mehr Einsen"), t("Keine eigene Gruppe"), t("Einsen bleiben beim 1’000-Punkte-Drilling; zusätzliche Einsen zählen einzeln, Vierlinge oder mehr werden nicht als eigene Gruppe gewertet."))}
        ${rulesTableRow(t("Straße 1–6"), `${ruleNumber(scoring.straight)} ${t("Punkte")}`, t("Alle sechs Würfel werden gehalten."))}
        ${rulesTableRow(t("Drei Paare"), `${ruleNumber(scoring.three_pairs)} ${t("Punkte")}`, t("Drei verschiedene Paare mit allen sechs Würfeln."))}
        ${rulesTableRow(t("Zwei Drillinge"), t("Summe beider Drillinge"), t("Zum Beispiel drei Zweien und drei Vieren ergeben 600 Punkte."))}
        ${rulesTableRow(t("500 für nichts"), `${ruleNumber(scoring.nothing_bonus)} ${t("Punkte")}`, t("Nur mit sechs freien Würfeln ohne andere Wertung; dies ist kein Zilch."))}
      </tbody></table></div>
    </section>
    <section class="zilch-rules-grid">
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Wertungen auswählen"))}</h2><p>${escapeHtml(t("Tippe eine Wertung oder einzelne Würfel an. Die Auswahl bleibt bis zum Weiterwürfeln oder Sichern änderbar."))}</p><p>${escapeHtml(t("Nur eine gemeinsam wertende Auswahl kann übernommen werden; ungültig gewordene Würfel fallen aus der Auswahl."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Würfeln oder sichern"))}</h2><p>${escapeHtml(t("Nach dem dritten Wurf müssen mindestens 300 Rundenpunkte gehalten sein. Sichern ist ab 400 Punkten möglich, solange kein Bestätigungswurf offen ist."))}</p><p>${escapeHtml(t("Vor dem Sichern kannst du deine Würfelauswahl jederzeit anpassen."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Hot Dice und Bestätigungswurf"))}</h2><p>${escapeHtml(t("Wenn alle sechs Würfel Punkte geben, werden sie wieder frei: Hot Dice. Die Rundenpunkte bleiben bestehen."))}</p><p>${escapeHtml(t("Kombinierte Wertung hält alle aktuell punktenden Würfel. Ein möglicher Freier Wurf erscheint dort als Stempel; erst Weiterwürfeln übernimmt die Auswahl."))}</p><p>${escapeHtml(t("Nach drei Einsen oder einem vollständigen Hold muss ein weiterer Punktewurf von mindestens 50 Punkten bestätigt werden, bevor du sichern darfst."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Zilch-Serie"))}</h2><p>${escapeHtml(t("Ein Wurf ohne gültige Wertung – oder eine nicht erreichbare 300er-Regel nach Wurf drei – beendet den Zug als Zilch. Ungesicherte Punkte verfallen."))}</p><p>${escapeHtml(t("Bei einem Zilch bleibt der letzte Wurf sichtbar, bis der nächste Wurf ausgeführt wird."))}</p><p>${escapeHtml(t("Bei jedem dritten Zilch in Folge – also beim dritten, sechsten, neunten und so weiter – werden 500 Punkte abgezogen, niemals unter null."))}</p></section>
    </section>
    <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Start und Spielende"))}</h2><ol class="zilch-rule-steps"><li>${escapeHtml(t("Beide Teilnehmer würfeln zu Beginn einmal. Der höhere Wurf beginnt; Gleichstände werden wiederholt."))}</li><li>${escapeHtml(t("Erreicht ein Teilnehmer mindestens das Ziel, beginnt die Schlussrunde."))}</li><li>${escapeHtml(t("Der andere Teilnehmer spielt einen vollständigen normalen Gegenzug."))}</li><li>${escapeHtml(t("Danach gewinnt der höchste Gesamtstand. Bei Gleichstand gibt es keinen Stechwurf."))}</li></ol><p class="zilch-muted">${escapeHtml(t("Wähle Würfel und entscheide dann: weiterwürfeln oder sichern."))}</p></section>
    <section class="zilch-card zilch-rules-section zilch-rules-section--solo"><p class="eyebrow">${escapeHtml(t("Solo"))}</p><h2>${escapeHtml(t("10’000-Punkte-Sprint"))}</h2><p>${escapeHtml(t("Im Solo-Sprint erreichst du mindestens 10’000 Punkte in möglichst wenigen eigenen Zügen. Der Lauf beginnt direkt mit deinem ersten normalen Zug – ohne Startwurf, Gegner, Schlussrunde oder Gegenzug."))}</p><p>${escapeHtml(t("Bei gleicher Zielerreichung werden später zuerst weniger Züge, dann weniger Würfe, weniger Zilchs und eine kürzere aktive Dauer verglichen. Pausenzeit zählt nicht zur aktiven Dauer."))}</p><p>${escapeHtml(t("Du kannst einen Solo-Lauf nach Bestätigung aufgeben. Er bleibt mit dem Status „Aufgegeben“ in deiner Historie erhalten."))}</p></section>
    <section class="zilch-card zilch-rules-examples"><p class="eyebrow">${escapeHtml(t("Beispiele"))}</p><h2>${escapeHtml(t("Gültige Auswahlen"))}</h2><ul><li><code>5–5–5–5–2–3</code> — ${escapeHtml(t("Drilling Fünfen = 500; vier Fünfen = 1’000; nur eine Fünf = 50."))}</li><li><code>1–1–1–5–5–2</code> — ${escapeHtml(t("Drei Einsen und zwei einzelne Fünfen = 1’100; danach ist ein Bestätigungswurf nötig."))}</li><li><code>1–2–3–4–5–6</code> — ${escapeHtml(t("Straße, 2’000 Punkte, Hot Dice und Bestätigungswurf."))}</li><li><code>2–2–3–4–6–6</code> — ${escapeHtml(t("500 für nichts: alle Würfel werden wieder frei, der Zug läuft weiter."))}</li></ul></section>`;
}

async function renderRules() {
  if (!content) return;
  document.title = t("Zilch die Wand an – Spielregeln");
  renderNotice("Zilch-Regeln werden geladen …");
  try {
    state.rules = await fetchZilchRules();
    if (!state.rules) throw new Error("zilch_rules_unavailable");
    content.innerHTML = renderRulesContent(state.rules);
  } catch (_) {
    renderNotice("Zilch-Regeln sind derzeit nicht verfügbar.", { kind: "error" });
  }
}

function notebookRound(entry) {
  if (!entry || typeof entry !== "object") return "";
  const event = String(entry.event || entry.type || "");
  const total = number(entry.total_after);
  if (event === "bank") {
    return `<span class="zilch-notebook-entry__change">+${number(entry.points)}</span><span class="zilch-notebook-entry__divider" aria-hidden="true"></span><span class="zilch-notebook-entry__total"><strong>${total}<span class="zilch-notebook-entry__unit"> ${escapeHtml(t("Punkte"))}</span></strong></span>`;
  }
  if (event === "zilch") {
    const penalty = Number(entry.penalty || 0);
    const change = penalty ? `−${number(penalty)}` : "+0";
    return `<span class="zilch-notebook-entry__change">${change}</span><span class="zilch-notebook-entry__divider" aria-hidden="true"></span><span class="zilch-notebook-entry__total"><strong>${total}<span class="zilch-notebook-entry__unit"> ${escapeHtml(t("Punkte"))}</span></strong><em>(${escapeHtml(t("Zilch"))})</em></span>`;
  }
  return `${escapeHtml(t("Runde"))} ${number(entry.round)}`;
}

function activeNotebookPlayerId(snapshot) {
  const boards = snapshot?._zilch_boards || {};
  const active = Object.entries(boards).find(([_playerId, board]) => Boolean(board?.active));
  return String(active?.[0] || snapshot?._turn?.player_id || "");
}

function latestZilchRound(snapshot, playerId) {
  const rounds = snapshot?._zilch_boards?.[playerId]?.rounds;
  if (!Array.isArray(rounds)) return null;
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const entry = rounds[index];
    if (String(entry?.event || entry?.type || "") === "zilch") return { entry, index };
  }
  return null;
}

function zilchEventKey(snapshot, event, fallbackPlayerId = "") {
  const playerId = String(event?.player_id || fallbackPlayerId || "");
  const latest = latestZilchRound(snapshot, playerId);
  const roundIdentity = latest?.entry?.turn_id ?? latest?.entry?.round ?? latest?.index ?? "unknown";
  const total = latest?.entry?.total_after ?? snapshot?._zilch_boards?.[playerId]?.total_points ?? "unknown";
  return `${playerId || "unknown"}:${roundIdentity}:${Number(event?.penalty || 0)}:${total}`;
}

function positionZilchEventOverlay() {
  const overlay = document.querySelector("[data-zilch-event-overlay]");
  const notebook = document.querySelector(".zilch-play-layout__notebook");
  if (!overlay || overlay.hidden || !notebook) return;
  const bounds = notebook.getBoundingClientRect();
  overlay.style.left = `${bounds.left}px`;
  overlay.style.top = `${bounds.top}px`;
  overlay.style.width = `${bounds.width}px`;
  overlay.style.height = `${bounds.height}px`;
}

function ensureZilchEventOverlay() {
  let overlay = document.querySelector("[data-zilch-event-overlay]");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "zilch-event-overlay";
  overlay.dataset.zilchEventOverlay = "";
  overlay.setAttribute("aria-hidden", "true");
  overlay.hidden = true;
  document.body.append(overlay);
  return overlay;
}

function syncZilchEventOverlay() {
  const overlay = ensureZilchEventOverlay();
  const moment = state.zilchMoment;
  if (!moment || moment.phase !== "overlay" || !document.querySelector(".zilch-play-layout__notebook")) {
    overlay.hidden = true;
    overlay.classList.remove("is-visible");
    overlay.dataset.eventKey = "";
    return;
  }
  if (overlay.dataset.eventKey !== moment.key) {
    overlay.dataset.eventKey = moment.key;
    overlay.innerHTML = `<strong>ZILCH!</strong>${moment.penalty ? `<span>−${number(moment.penalty)}</span>` : ""}`;
    overlay.classList.remove("is-visible");
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");
  }
  overlay.hidden = false;
  positionZilchEventOverlay();
}

function beginZilchMoment(snapshot, event, { previousPlayerId = "", nextPlayerId = "" } = {}) {
  if (String(event?.type || "") !== "zilch") return false;
  const playerId = String(event?.player_id || previousPlayerId || "");
  const key = zilchEventKey(snapshot, event, playerId);
  if (state.presentedZilchEvents.has(key)) return false;
  state.presentedZilchEvents.add(key);
  if (state.presentedZilchEvents.size > 80) {
    state.presentedZilchEvents.delete(state.presentedZilchEvents.values().next().value);
  }
  window.clearTimeout(state.zilchMomentTimer);
  state.notebookTransition = null;
  const eventDice = Array.isArray(event?.rolled_dice) ? event.rolled_dice.map(Number) : [];
  const rolledDice = eventDice.length === 6 && eventDice.every(value => Number.isInteger(value) && value >= 1 && value <= 6)
    ? eventDice
    : null;
  const heldDiceIndices = rolledDice
    ? normalizedIndices(event?.held_dice_indices).filter(index => index < rolledDice.length)
    : [];
  const baseMoment = {
    key,
    playerId,
    nextPlayerId: String(nextPlayerId || ""),
    penalty: Number(event?.penalty || 0),
  };
  const finishMoment = () => {
    const completedMoment = state.zilchMoment;
    if (!completedMoment || completedMoment.key !== key) return;
    state.zilchMoment = null;
    state.zilchMomentTimer = null;
    const activePlayerId = activeNotebookPlayerId(state.game) || completedMoment.nextPlayerId;
    if (completedMoment.playerId && activePlayerId && !sameId(completedMoment.playerId, activePlayerId)) {
      state.notebookTransition = { from: completedMoment.playerId, to: activePlayerId };
    }
    if (state.game) renderGameState();
    else syncZilchEventOverlay();
  };
  const beginOverlay = () => {
    const currentMoment = state.zilchMoment;
    if (!currentMoment || currentMoment.key !== key) return;
    state.zilchMoment = { ...baseMoment, phase: "overlay" };
    state.zilchMomentTimer = window.setTimeout(finishMoment, ZILCH_EVENT_OVERLAY_DURATION_MS);
    if (state.game) renderGameState();
    else syncZilchEventOverlay();
  };
  if (rolledDice) {
    state.zilchMoment = {
      ...baseMoment,
      phase: "reveal",
      rolledDice,
      heldDiceIndices,
    };
    state.zilchMomentTimer = window.setTimeout(beginOverlay, ZILCH_ROLL_REVEAL_DURATION_MS);
  } else {
    state.zilchMoment = { ...baseMoment, phase: "overlay" };
    state.zilchMomentTimer = window.setTimeout(finishMoment, ZILCH_EVENT_OVERLAY_DURATION_MS);
  }
  return true;
}

function rememberNotebookScroll() {
  for (const log of document.querySelectorAll("[data-zilch-round-log]")) {
    const playerId = String(log.dataset.zilchRoundLog || "");
    if (!playerId) continue;
    const distanceFromBottom = Math.max(0, log.scrollHeight - log.clientHeight - log.scrollTop);
    state.notebookScroll.set(playerId, {
      top: log.scrollTop,
      followLatest: distanceFromBottom < 12,
    });
  }
}

function restoreNotebookScroll() {
  window.requestAnimationFrame(() => {
    for (const log of document.querySelectorAll("[data-zilch-round-log]")) {
      const playerId = String(log.dataset.zilchRoundLog || "");
      const remembered = state.notebookScroll.get(playerId);
      if (!remembered || remembered.followLatest) {
        log.scrollTop = log.scrollHeight;
      } else {
        log.scrollTop = Math.min(remembered.top, Math.max(0, log.scrollHeight - log.clientHeight));
      }
    }
  });
}

function scoreNotebook(players, boards, {
  solo = false,
  target = 10000,
  transition = null,
  activePlayerId = "",
} = {}) {
  if (!players.length) return "";
  const entriesByPlayer = players.map(player => {
    const board = boards?.[player.id] || {};
    return Array.isArray(board.rounds) ? board.rounds : [];
  });
  const lineCount = Math.max(8, ...entriesByPlayer.map(entries => entries.length));
  const switching = Boolean(!solo && transition?.from && transition?.to && !sameId(transition.from, transition.to));
  return `<section class="zilch-score-notebook${solo ? " zilch-score-notebook--solo" : " zilch-score-notebook--duel"}${switching ? " is-turn-switching" : ""}" aria-label="${escapeHtml(t("Punktebuch"))}">${players.map((player, playerIndex) => {
    const board = boards?.[player.id] || {};
    const rounds = entriesByPlayer[playerIndex];
    const active = activePlayerId ? sameId(player.id, activePlayerId) : Boolean(board.active);
    const cpu = isCpuParticipant(player);
    const offline = !cpu && board?.connected === false;
    const entering = switching && sameId(player.id, transition.to);
    const leaving = switching && sameId(player.id, transition.from);
    const classes = [
      "zilch-notebook-player",
      "zilch-board",
      active ? "is-active zilch-board--active" : "is-inactive",
      entering ? "is-turn-entering" : "",
      leaving ? "is-turn-leaving" : "",
      cpu ? "zilch-board--cpu" : "",
      offline ? "zilch-board--offline" : "",
    ].filter(Boolean).join(" ");
    const marker = board?.final_round_triggered_by
      ? t("Schlussrunde ausgelöst")
      : board?.final_reply_pending
      ? t("Gegenzug offen")
        : "";
    const boardLabel = [player?.name || t("Spieler"), marker, active ? t("Am Zug") : ""].filter(Boolean).join(", ");
    const scoreTotal = solo ? `${number(board.total_points)} / ${number(target)}` : number(board.total_points);
    return `<article class="${classes}" data-zilch-board-id="${escapeHtml(player.id)}" aria-label="${escapeHtml(boardLabel)}">
      <header><h2>${playerCollectionMarkup(player)} ${participantMeta(player, { compact: true })}</h2><span class="zilch-notebook-total"><span class="visually-hidden">${escapeHtml(t("Stand"))}: </span>${escapeHtml(scoreTotal)}</span></header>
      <ol data-zilch-round-log="${escapeHtml(player.id)}" style="--zilch-round-rows:${lineCount}">${Array.from({ length: lineCount }, (_unused, index) => {
        const entry = rounds[index];
        return entry ? `<li>${notebookRound(entry)}</li>` : '<li class="zilch-notebook-entry--blank" aria-hidden="true"></li>';
      }).join("")}</ol>
      <footer><span>${escapeHtml(t("Stand"))}</span><strong data-zilch-total="${number(board.total_points)}">${number(board.total_points)}<span class="zilch-notebook-entry__unit"> ${escapeHtml(t("Punkte"))}</span></strong></footer>
    </article>`;
  }).join("")}</section>`;
}

function resultPlayerForId(result, playerId) {
  return resultParticipants(result).find(player => sameId(resultPlayerId(player), playerId));
}

function resultBoardCard(result, player) {
  const board = resultBoardFor(result, player);
  const history = Array.isArray(board?.rounds) ? board.rounds.slice().reverse() : [];
  const penalties = history.filter(entry => String(entry?.event || entry?.type || "") === "zilch" && Number(entry?.penalty ?? entry?.zilch_penalty ?? 0) > 0);
  const playerNameValue = resultPlayerName(player);
  return `<article class="zilch-board zilch-result-board">
    <header class="zilch-board-head"><div><h3>${escapeHtml(playerNameValue)}</h3><p>${escapeHtml(t("Abgeschlossen"))}</p></div><div class="zilch-participant-badges">${resultParticipantMeta(player)}</div></header>
    <dl>
      <div><dt>${escapeHtml(t("Gesamtpunkte"))}</dt><dd>${resultTotalFor(result, player, board)}</dd></div>
      <div><dt>${escapeHtml(t("Zilch-Runden"))}</dt><dd>${number(board?.zilch_count ?? history.filter(entry => String(entry?.event || entry?.type || "") === "zilch").length)}</dd></div>
      <div><dt>${escapeHtml(t("Zilch-Strafen"))}</dt><dd>${number(board?.penalty_total ?? penalties.reduce((total, entry) => total + Number(entry?.penalty ?? entry?.zilch_penalty ?? 0), 0))}</dd></div>
    </dl>
    <h4 class="zilch-result-board__history-title">${escapeHtml(t("Rundenhistorie"))}</h4>
    <ol class="zilch-round-history" aria-label="${escapeHtml(`${t("Rundenhistorie")} ${playerNameValue}`)}">${history.length
      ? history.map(entry => `<li>${escapeHtml(resultRoundHistory(entry))}</li>`).join("")
      : `<li class="zilch-muted">${escapeHtml(t("Keine Rundenhistorie verfügbar"))}</li>`}</ol>
  </article>`;
}

function resultStartRollAttempts(result) {
  const start = result?.start_roll || result?.start_rolls || {};
  const attempts = Array.isArray(start?.attempts) ? start.attempts : Array.isArray(start) ? start : [];
  if (attempts.length) return attempts;
  if (start?.rolls && typeof start.rolls === "object") return [{ rolls: start.rolls, tied: start.tied }];
  return [];
}

function resultStartRollCard(result) {
  if (isSoloGame(result)) return "";
  const attempts = resultStartRollAttempts(result);
  if (!attempts.length) return "";
  const rows = attempts.map((attempt, attemptIndex) => {
    const rolls = attempt?.rolls && typeof attempt.rolls === "object" ? attempt.rolls : {};
    const values = Object.entries(rolls).map(([playerId, value]) => {
      const player = resultPlayerForId(result, playerId);
      const name = player ? resultPlayerName(player) : t("Spieler");
      return `<li><span>${escapeHtml(name)}</span><strong class="zilch-start-roll-value">${number(value)}</strong></li>`;
    }).join("");
    const rollValues = Object.values(rolls);
    const tied = Boolean(attempt?.tied) || (rollValues.length > 1 && new Set(rollValues.map(String)).size === 1);
    const tie = tied ? `<p class="zilch-muted">${escapeHtml(t("Gleichstand – Startwurf wiederholt"))}</p>` : "";
    return `<div class="zilch-result-start-attempt"><h3>${escapeHtml(`${t("Startwurf")} ${attempts.length > 1 ? `· ${attemptIndex + 1}` : ""}`)}</h3><ol class="zilch-start-rolls">${values}</ol>${tie}</div>`;
  }).join("");
  return `<section class="zilch-card zilch-result-start-roll" aria-labelledby="zilchResultStartRollTitle"><p class="eyebrow">${escapeHtml(t("Startwurf"))}</p><h2 id="zilchResultStartRollTitle">${escapeHtml(t("Ermittelte Startreihenfolge"))}</h2>${rows}</section>`;
}

function resultFinalRoundCard(result) {
  if (isSoloGame(result)) return "";
  const finalRound = result?.final_round || result?.outcome?.final_round || {};
  const triggeredBy = finalRound?.triggered_by || finalRound?.triggered_by_id || result?.outcome?.final_round_triggered_by;
  const replyPlayerIds = finalRound?.reply_player_ids
    || finalRound?.reply_participant_ids
    || finalRound?.completed_player_ids
    || finalRound?.participants_with_reply
    || (triggeredBy ? resultParticipants(result).map(resultPlayerId).filter(playerId => !sameId(playerId, triggeredBy)) : []);
  const hasReplyPlayers = Array.isArray(replyPlayerIds) ? replyPlayerIds.length > 0 : Boolean(replyPlayerIds);
  if (!triggeredBy && !hasReplyPlayers) return "";
  const triggerPlayer = resultPlayerForId(result, triggeredBy);
  const replyNames = (Array.isArray(replyPlayerIds) ? replyPlayerIds : [replyPlayerIds])
    .map(playerId => resultPlayerForId(result, playerId))
    .filter(Boolean)
    .map(resultPlayerName);
  return `<section class="zilch-card zilch-result-final-round" aria-labelledby="zilchResultFinalRoundTitle">
    <p class="eyebrow">${escapeHtml(t("Schlussrunde"))}</p>
    <h2 id="zilchResultFinalRoundTitle">${escapeHtml(t("Voller Gegenzug"))}</h2>
    ${triggerPlayer ? `<p>${escapeHtml(t("Ausgelöst von"))}: <strong>${escapeHtml(resultPlayerName(triggerPlayer))}</strong></p>` : ""}
    <p>${escapeHtml(t("Gegenzug abgeschlossen von"))}: <strong>${escapeHtml(replyNames.length ? replyNames.join(", ") : t("Kein Gegenzug erforderlich"))}</strong></p>
  </section>`;
}

function resultHeadline(result) {
  if (isSoloGame(result)) return soloOutcomeLabel(result);
  if (resultIsTied(result)) return t("Gleichstand");
  const winnerIds = resultWinnerIds(result);
  const participants = resultParticipants(result);
  const cpuGame = participants.some(player => participantType(player) === "cpu");
  const cpuWon = winnerIds.some(id => participants.some(player => (
    sameId(id, resultPlayerId(player)) && participantType(player) === "cpu"
  )));
  if (cpuGame && cpuWon) return t("CPU gewinnt");
  if (cpuGame) return t("Sieg gegen CPU");
  const names = participants
    .filter(player => winnerIds.some(id => sameId(id, resultPlayerId(player))))
    .map(resultPlayerName);
  return names.length ? `${names.join(", ")} ${t("gewinnt die Partie.")}` : t("Spiel beendet");
}

function resultSummary(result) {
  const solo = isSoloGame(result);
  return `<section class="zilch-card zilch-final-result zilch-result-summary" role="status" aria-labelledby="zilchResultTitle">
    <p class="eyebrow">${escapeHtml(solo ? t("Solo-Ergebnis") : t("Zilch-Ergebnis"))}</p>
    <h2 id="zilchResultTitle">${escapeHtml(resultHeadline(result))}</h2>
    <dl class="zilch-result-facts">
      ${solo ? `<div><dt>${escapeHtml(t("Solo-Ziel"))}</dt><dd>${escapeHtml(soloObjectiveTitle(result))}</dd></div>` : ""}
      <div><dt>${escapeHtml(t("Beendet am"))}</dt><dd>${escapeHtml(formattedDateTime(result?.finished_at))}</dd></div>
    </dl>
  </section>`;
}

async function fetchZilchResult(id) {
  const response = await fetch(`/api/zilch/results/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return resultRecord(payload);
}

async function renderResult() {
  if (!content || !resultId) return;
  renderNotice("Zilch-Ergebnis wird geladen …");
  try {
    const result = await fetchZilchResult(resultId);
    if (!result || resultIdFor(result) !== resultId) {
      renderNotice("Zilch-Ergebnis nicht verfügbar.", { kind: "error" });
      return;
    }
    state.result = result;
    const participants = resultParticipants(result);
    const solo = isSoloGame(result);
    const gameName = String(result?.game_name || result?.name || "Zilch");
    document.title = `${gameName} – ${t("Zilch-Ergebnis")}`;
    content.innerHTML = `<section class="zilch-game-head zilch-result-head">
        <div><p class="eyebrow">${escapeHtml(solo ? t("Solo-Ergebnis") : t("Abgeschlossene Partie"))}</p><h1>${escapeHtml(gameName)}</h1></div>
      </section>
      ${resultSummary(result)}
      <section class="zilch-board-grid zilch-result-board-grid${solo ? " zilch-result-board-grid--solo" : ""}" aria-label="${escapeHtml(t("Zilch-Ergebnisboards"))}">${participants.map(player => resultBoardCard(result, player)).join("") || `<p class="zilch-muted">${escapeHtml(t("Keine Teilnehmerdaten verfügbar"))}</p>`}</section>
      ${resultStartRollCard(result)}
      ${resultFinalRoundCard(result)}`;
  } catch (_) {
    // The server intentionally answers participant-scoped result access with an opaque
    // failure; preserve that non-disclosing behaviour in the view as well.
    renderNotice("Zilch-Ergebnis nicht verfügbar.", { kind: "error" });
  }
}

function diePips(value, index) {
  const positions = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 28], [28, 50], [28, 72], [72, 28], [72, 50], [72, 72]],
  };
  const dots = (positions[value] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11.2"></circle>`).join("");
  const mark = value
    ? `<g class="zilch-die__pips">${dots}</g>`
    : '<path class="zilch-die__dash" d="M35 50h30" />';
  const gradientId = `zilchDieFace${index}`;
  return `<svg class="zilch-die__face" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#63391f"/><stop offset=".42" stop-color="#321a0f"/><stop offset="1" stop-color="#160b07"/></linearGradient></defs><rect class="zilch-die__body" x="5" y="5" width="90" height="90" rx="18" fill="url(#${gradientId})" stroke="#d7a64c" stroke-width="3.5"/><path class="zilch-die__highlight" d="M22 13h53c7 0 12 5 13 11"/><path class="zilch-die__shade" d="M88 73c0 9-6 15-15 15H27"/>${mark}</svg>`;
}

function holdDraftKey(turnState) {
  return [turnState?.turn_id || "", turnState?.version || "", turnState?.roll_id || ""].join(":");
}

function normalizedIndices(indices) {
  return [...new Set((Array.isArray(indices) ? indices : []).map(Number).filter(Number.isInteger))].sort((first, second) => first - second);
}

function draftHoldIndices(turnState) {
  const key = holdDraftKey(turnState);
  return state.draftHoldKey === key ? state.draftHoldIndices : [];
}

function setDraftHoldIndices(turnState, indices) {
  state.draftHoldKey = holdDraftKey(turnState);
  state.draftHoldIndices = normalizedIndices(indices);
}

function sameIndices(first, second) {
  const left = normalizedIndices(first);
  const right = normalizedIndices(second);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function draftCanContain(options, indices) {
  return options.some(option => {
    const candidate = normalizedIndices(option?.dice_indices);
    return indices.every(index => candidate.includes(index));
  });
}

function exactOptionForDraft(options, indices) {
  if (!indices.length) return null;
  return orderedQuickHolds(options).find(option => sameIndices(option?.dice_indices, indices)) || null;
}

function combinedScoringOption(options) {
  // The server enumerates every valid non-overlapping scoring selection. The
  // union of all scoreable dice is therefore safe only when it is also one of
  // those exact, server-authoritative options.
  const scoreable = normalizedIndices((Array.isArray(options) ? options : []).flatMap(option => option?.dice_indices || []));
  return scoreable.length ? exactOptionForDraft(options, scoreable) : null;
}

function normalizedDraftAfterRemoval(options, remainingIndices) {
  const remaining = normalizedIndices(remainingIndices);
  if (!remaining.length || exactOptionForDraft(options, remaining)) return remaining;
  const validSubsets = orderedQuickHolds(options).filter(option => (
    normalizedIndices(option?.dice_indices).every(index => remaining.includes(index))
  ));
  validSubsets.sort((first, second) => (
    normalizedIndices(second?.dice_indices).length - normalizedIndices(first?.dice_indices).length
    || Number(second?.points || 0) - Number(first?.points || 0)
    || String(first?.id || "").localeCompare(String(second?.id || ""))
  ));
  return normalizedIndices(validSubsets[0]?.dice_indices);
}

function dieState(index, value, turnState, quickHolds) {
  const held = Array.isArray(turnState?.held_dice_indices) && turnState.held_dice_indices.includes(index);
  const serverScoring = quickHolds.some(option => Array.isArray(option.dice_indices) && option.dice_indices.includes(index));
  const selected = draftHoldIndices(turnState).includes(index);
  if (!value) return "zilch-die--unrolled";
  if (held) return "zilch-die--held zilch-die--unavailable";
  if (selected) return "zilch-die--selected";
  if (turnState?.phase === "awaiting_hold" && !serverScoring) return "zilch-die--non-scoring";
  return "zilch-die--available";
}

function dieDescription(index, value, turnState, quickHolds) {
  const held = Array.isArray(turnState?.held_dice_indices) && turnState.held_dice_indices.includes(index);
  const selected = draftHoldIndices(turnState).includes(index);
  const scoreable = quickHolds.some(option => Array.isArray(option.dice_indices) && option.dice_indices.includes(index));
  const stateLabel = turnState?.phase === "zilch_reveal"
    ? t("Letzter Zilch-Wurf")
    : !value
    ? t("Noch nicht gewürfelt")
    : held
      ? t("Verbindlich gehalten")
      : selected
        ? t("Ausgewählt – noch änderbar")
        : turnState?.phase === "awaiting_hold" && !scoreable
          ? t("Nicht wertend")
          : t("Verfügbar");
  const valueLabel = value ? `${t("zeigt")} ${value}` : t("Noch nicht gewürfelt");
  return `${t("Würfel")} ${index + 1}: ${valueLabel}. ${stateLabel}.`;
}

function diceRack(snapshot, turnState, quickHolds, isMyTurn) {
  const revealMoment = state.zilchMoment?.phase === "reveal" ? state.zilchMoment : null;
  const currentDice = Array.isArray(snapshot._dice) ? snapshot._dice.slice(0, 6) : [0, 0, 0, 0, 0, 0];
  const retainedRack = snapshot?._zilch_last_zilch_dice;
  const retainedDice = Array.isArray(retainedRack?.dice) ? retainedRack.dice.map(Number) : [];
  const hasRetainedZilchRack = Boolean(
    !revealMoment
    && currentDice.every(value => !Number(value))
    && retainedDice.length === 6
    && retainedDice.every(value => Number.isInteger(value) && value >= 1 && value <= 6),
  );
  const dice = Array.isArray(revealMoment?.rolledDice)
    ? revealMoment.rolledDice.slice(0, 6)
    : hasRetainedZilchRack ? retainedDice : currentDice;
  while (dice.length < 6) dice.push(0);
  const displayTurnState = revealMoment
    ? { ...turnState, phase: "awaiting_hold", held_dice_indices: revealMoment.heldDiceIndices }
    : hasRetainedZilchRack
      ? { ...turnState, phase: "zilch_reveal", held_dice_indices: normalizedIndices(retainedRack?.held_dice_indices) }
    : turnState;
  const displayQuickHolds = revealMoment || hasRetainedZilchRack ? [] : quickHolds;
  const rolling = state.pendingAction === "zilch_roll_dice";
  const landing = Boolean(state.diceLandingPending || revealMoment);
  return `<div class="zilch-dice${rolling ? " is-rolling" : ""}${landing ? " is-landing" : ""}${revealMoment ? " is-zilch-reveal" : ""}${hasRetainedZilchRack ? " is-zilch-retained" : ""}" aria-label="${escapeHtml(t("Sechs Würfel"))}" aria-busy="${rolling ? "true" : "false"}">${dice.map((die, index) => {
    const baseLabel = dieDescription(index, die, displayTurnState, displayQuickHolds);
    const label = hasRetainedZilchRack ? `${t("Letzter Zilch-Wurf")}. ${baseLabel}` : baseLabel;
    const held = Array.isArray(displayTurnState?.held_dice_indices) && displayTurnState.held_dice_indices.includes(index);
    const scoreable = displayQuickHolds.some(option => Array.isArray(option.dice_indices) && option.dice_indices.includes(index));
    const selectable = Boolean(!revealMoment && !hasRetainedZilchRack && isMyTurn && displayTurnState?.can_select_hold && die && !held && scoreable && !snapshot._paused && !snapshot._finished && !state.pendingAction);
    const classes = `zilch-die ${dieState(index, die, displayTurnState, displayQuickHolds)}${hasRetainedZilchRack ? " zilch-die--zilch-retained" : ""}${state.pendingAction ? " zilch-die--pending" : ""}`;
    const face = diePips(die, index);
    return selectable
      ? `<button type="button" class="${classes}" style="--die-index:${index}" data-zilch-die-index="${index}" aria-keyshortcuts="${index + 1}" aria-pressed="${draftHoldIndices(displayTurnState).includes(index) ? "true" : "false"}" aria-label="${escapeHtml(label)}">${face}</button>`
      : `<span class="${classes}" style="--die-index:${index}" role="img" aria-label="${escapeHtml(label)}">${face}</span>`;
  }).join("")}</div>`;
}

function optionTitle(option) {
  if (!option || typeof option !== "object") return t("Wertung");
  return localizedServerMessage(
    option.label_key,
    { ...(option.label_params || {}), points: number(option.points) },
    t("Wertung"),
  );
}

function compactOptionTitle(option) {
  const values = Array.isArray(option?.dice_values)
    ? option.dice_values.map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= 6)
    : [];
  const face = values[0];
  if (face && values.length && values.every(value => value === face)) {
    const count = values.length;
    const english = String(window.ZDWA_I18N?.getLanguage?.() || document.documentElement.lang || "de").startsWith("en");
    if (english) {
      const names = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };
      const singular = names[face] || String(face);
      const plural = `${singular}s`;
      return `${count} ${count === 1 ? singular : plural}`;
    }
    const name = face === 1 ? "Einser" : face === 5 ? "Fünfer" : `${face}er`;
    return `${count} ${name}`;
  }
  return optionTitle(option).replace(/\s*·\s*[+−-]?[\d'’.,\s]+$/, "").trim();
}

function orderedQuickHolds(options) {
  return [...options].sort((first, second) => (
    Number(Boolean(second.all_available_dice)) - Number(Boolean(first.all_available_dice))
    || Number(Boolean(second.hot_dice)) - Number(Boolean(first.hot_dice))
    || Number(second.points || 0) - Number(first.points || 0)
  ));
}

function isLeanRecommendation(option) {
  const components = Array.isArray(option?.components) ? option.components : [];
  if (components.length <= 1) return true;
  const componentTypes = components.map(component => String(component?.combination_type || ""));
  return componentTypes.length > 0
    && (componentTypes.every(type => type === "single_one") || componentTypes.every(type => type === "single_five"));
}

function recommendationOptions(snapshot, options, draft) {
  const dice = Array.isArray(snapshot?._dice) ? snapshot._dice : [];
  const unique = [];
  const signatures = new Set();
  const source = options.filter(option => (
    optionMatchesDraft(option, draft)
    && (isLeanRecommendation(option) || sameIndices(option?.dice_indices, draft))
  ));
  for (const option of source) {
    const values = normalizedIndices(option?.dice_indices).map(index => Number(dice[index] || 0)).sort((a, b) => a - b);
    const signature = [
      Number(option?.points || 0),
      option?.combination_type || "",
      Number(Boolean(option?.hot_dice)),
      Number(Boolean(option?.all_available_dice)),
      values.join(","),
    ].join("|");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    unique.push(option);
  }
  unique.sort((first, second) => {
    const firstExact = Number(sameIndices(first?.dice_indices, draft));
    const secondExact = Number(sameIndices(second?.dice_indices, draft));
    const firstExtra = normalizedIndices(first?.dice_indices).length - draft.length;
    const secondExtra = normalizedIndices(second?.dice_indices).length - draft.length;
    return secondExact - firstExact
      || (draft.length ? firstExtra - secondExtra : 0)
      || Number(Boolean(second?.hot_dice)) - Number(Boolean(first?.hot_dice))
      || Number(Boolean(second?.all_available_dice)) - Number(Boolean(first?.all_available_dice))
      || Number(second?.points || 0) - Number(first?.points || 0);
  });
  if (unique.length <= ZILCH_RECOMMENDATION_SHORTCUTS.length) return unique;

  // Keep the thumb rail focussed on one clear, holdable group per card.
  // Reserve room for the selected draft, a free roll, and both single-die
  // families before filling the remaining bounded slots.
  const reserved = [];
  const reserve = predicate => {
    const option = unique.find(predicate);
    if (option && !reserved.includes(option)) reserved.push(option);
  };
  reserve(option => sameIndices(option?.dice_indices, draft));
  reserve(option => Boolean(option?.hot_dice || option?.all_available_dice));
  reserve(option => option?.combination_type === "single_one");
  reserve(option => option?.combination_type === "single_five");
  for (const option of unique) {
    if (reserved.length >= ZILCH_RECOMMENDATION_SHORTCUTS.length) break;
    if (!reserved.includes(option)) reserved.push(option);
  }
  const rank = new Map(unique.map((option, index) => [option, index]));
  return reserved.sort((first, second) => rank.get(first) - rank.get(second));
}

function optionMatchesDraft(option, indices) {
  const selected = normalizedIndices(indices);
  const candidate = normalizedIndices(option?.dice_indices);
  return selected.every(index => candidate.includes(index));
}

function recommendationCards(snapshot, turnState, isMyTurn) {
  const options = Array.isArray(snapshot._zilch_quick_holds) ? snapshot._zilch_quick_holds : [];
  const selectable = Boolean(isMyTurn && turnState?.can_select_hold && !snapshot._paused && !snapshot._finished && !state.pendingAction);
  if (!options.length) return "";
  const draft = draftHoldIndices(turnState);
  const recommendations = recommendationOptions(snapshot, orderedQuickHolds(options), draft);
  if (!recommendations.length) return "";
  return `<div class="zilch-recommendations__rail"><ol class="zilch-recommendations__list">${recommendations.map((option, index) => {
    const selected = sameIndices(option.dice_indices, draft);
    const hotDice = Boolean(option.hot_dice);
    const label = compactOptionTitle(option);
    const shortcut = ZILCH_RECOMMENDATION_SHORTCUTS[index];
    const accessibleLabel = `+${number(option.points)} ${label}${hotDice ? ` · ${t("Freier Wurf")}` : ""}`;
    return `<li><button type="button" class="zilch-recommendation${selected ? " is-selected" : ""}${hotDice ? " is-hot" : ""}" data-zilch-recommendation="${escapeHtml(option.id)}" data-zilch-shortcut="${shortcut}" ${selectable ? "" : "disabled"} aria-keyshortcuts="${shortcut}" aria-label="${escapeHtml(accessibleLabel)}" aria-pressed="${selected ? "true" : "false"}">
      <strong aria-hidden="true">${selected ? "✓ " : ""}+${number(option.points)}</strong><span aria-hidden="true">${escapeHtml(label)}</span><kbd class="zilch-recommendation__shortcut" aria-hidden="true">${shortcut.toUpperCase()}</kbd>
    </button></li>`;
  }).join("")}</ol>
  </div>`;
}

function turnScoreMarkup(snapshot, turnState, quickHolds, isMyTurn) {
  // ``round_points`` contains every already committed hold. A draft is not
  // yet authoritative, so only an exact server option may be added to the
  // visible total. With no draft, the compact readout previews the complete
  // server-approved combined choice beside it.
  if (!isMyTurn || !turnState || snapshot?._finished || snapshot?._paused || state.zilchMoment) return "";
  const heldPoints = Math.max(0, Number(turnState.round_points) || 0);
  const combined = combinedScoringOption(quickHolds);
  const selected = exactOptionForDraft(quickHolds, draftHoldIndices(turnState));
  const selectedPoints = Math.max(0, Number((selected || combined)?.points) || 0);
  const potential = heldPoints + selectedPoints;
  if (!potential) return "";
  const selectable = Boolean(
    combined
    && turnState?.can_select_hold
    && !state.pendingAction,
  );
  const combinedSelected = Boolean(combined && sameIndices(combined.dice_indices, draftHoldIndices(turnState)));
  const freeRoll = Boolean(combined?.hot_dice);
  const combinedLabel = t("Kombinierte Wertung");
  const accessibleLabel = `${combinedLabel}: +${number(combined?.points)}${freeRoll ? ` · ${t("Freier Wurf")}` : ""}`;
  return `<div class="zilch-play-layout__current-score"><section class="zilch-turn-score" aria-live="polite" aria-label="${escapeHtml(t("Aktueller Wurf"))}">
    <span>${escapeHtml(t("Aktueller Wurf"))}</span>
    <strong>${escapeHtml(number(potential))}</strong>
  </section></div>${combined ? `<div class="zilch-play-layout__combined-score"><button type="button" class="zilch-combined-score${combinedSelected ? " is-selected" : ""}${freeRoll ? " is-hot" : ""}" data-zilch-combined-score ${selectable ? "" : "disabled"} aria-label="${escapeHtml(accessibleLabel)}" aria-pressed="${combinedSelected ? "true" : "false"}">
    <span aria-hidden="true">${escapeHtml(combinedLabel)}</span><strong aria-hidden="true">+${escapeHtml(number(combined.points))}</strong>${freeRoll ? `<span class="zilch-combined-score__stamp" aria-hidden="true"><strong>${escapeHtml(t("Freier Wurf!"))}</strong></span>` : ""}
  </button></div>` : ""}`;
}

function waitingRoomPanel(snapshot) {
  if (isSoloGame(snapshot)) return "";
  if (snapshot?._started || snapshot?._finished) return "";
  const participants = snapshotParticipants(snapshot);
  const expected = Number(snapshot?._expected_participants || snapshot?._expected || 2);
  const playerRows = participants.map(player => `<li><span>${playerCollectionMarkup(player)} ${participantMeta(player, { compact: true })}</span><strong>${escapeHtml(participantStatusLabel(player))}</strong></li>`).join("");
  return `<section class="zilch-card zilch-start-roll" aria-labelledby="zilchWaitingRoomTitle">
    <p class="eyebrow">${escapeHtml(t("Wartesaal"))}</p>
    <h2 id="zilchWaitingRoomTitle">${escapeHtml(t("Bereit für den Startwurf"))}</h2>
    <p>${escapeHtml(participants.length < expected
      ? t("Sobald ihr zu zweit seid, bestimmt ein Startwurf, wer beginnt.")
      : t("Beide Teilnehmer sind da. Der Startwurf wird vorbereitet."))}</p>
    <ol class="zilch-start-rolls">${playerRows || `<li class="zilch-muted">${escapeHtml(t("Noch keine Spieler"))}</li>`}</ol>
    <p class="zilch-muted">${escapeHtml(`${t("Teilnehmer")}: ${participants.length}/${expected}`)}</p>
  </section>`;
}

function openingRollPanel(snapshot) {
  if (isSoloGame(snapshot)) return "";
  const start = snapshot._zilch_start_roll;
  if (!snapshot._started || !start) return "";
  // The start roll explains the transition into a game. Once resolved it has
  // no place on the permanent play surface.
  if (start.phase === "resolved") return "";
  const playerIds = Array.isArray(start.player_ids) ? start.player_ids : [];
  const pending = Array.isArray(start.pending_player_ids) ? start.pending_player_ids : [];
  const rolls = start.rolls || {};
  const ownParticipantId = localParticipantId(snapshot);
  const humanTurn = Boolean(ownParticipantId && pending.some(playerId => sameId(playerId, ownParticipantId)));
  const cpuPending = pending.some(playerId => isCpuParticipant(participantForId(snapshot, playerId)));
  const disabled = !humanTurn || snapshot._paused || Boolean(state.pendingAction);
  const attemptRows = playerIds.map(playerId => {
    const player = playerForId(snapshot, playerId);
    const rolled = Number(rolls[playerId] || 0);
    const result = rolled ? String(rolled) : t("wartet");
    return `<li><span>${playerCollectionMarkup(player)} ${participantMeta(player, { compact: true })}</span><strong>${escapeHtml(result)}</strong></li>`;
  }).join("");
  const priorTie = start.tied ? `<p class="zilch-event zilch-event--zilch">${escapeHtml(t("Gleichstand beim Startwurf – beide würfeln erneut."))}</p>` : "";
  return `<section class="zilch-card zilch-start-roll" aria-labelledby="zilchStartRollTitle">
      <p class="eyebrow">${escapeHtml(t("Startwurf"))}</p>
      <h2 id="zilchStartRollTitle">${escapeHtml(t("Wer höher würfelt, beginnt."))}</h2>
      <p>${escapeHtml(t("Beide würfeln einmal. Bei Gleichstand wird wiederholt."))}</p>
      ${priorTie}
      <ol class="zilch-start-rolls">${attemptRows}</ol>
      <button type="button" data-zilch-start-roll aria-keyshortcuts="Space" ${disabled ? "disabled" : ""}>${escapeHtml(humanTurn ? t("Startwurf ausführen") : cpuPending ? t("CPU würfelt für den Start …") : t("Warte auf den anderen Startwurf"))}</button>
  </section>`;
}

function finalResultActions(resultLink) {
  if (state.awardPresentationActive) {
    return `<p class="zilch-award-finalization-note" role="status">${escapeHtml(t("Neue Zilch-Awards werden vorbereitet. Danach kannst du das Ergebnis öffnen."))}</p>`;
  }
  return `<div class="zilch-final-actions" role="group" aria-label="${escapeHtml(t("Nächster Schritt"))}">
    <button type="button" class="zilch-final-action zilch-final-action--primary" data-zilch-new-round>${escapeHtml(t("Neue Runde"))}</button>
    ${resultLink}
    <a class="zilch-final-action zilch-final-action--quiet" href="${escapeHtml(zilchPath("/"))}">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
  </div>`;
}

function zilchResultRoute(candidate) {
  const normalized = normalizeZilchPageUrl(candidate);
  if (!normalized) return null;
  const url = new URL(normalized, window.location.origin);
  const route = zilchRoutePath(url.pathname);
  return route && /^\/ergebnis\/[^/?#]+$/.test(route) ? normalized : null;
}

function finalResultAwards(snapshot) {
  const result = plainObject(snapshot?._zilch_result);
  const currentGameId = String(result.game_id || gameId || "").trim();
  if (!currentGameId || !sameId(state.terminalAwardGameId, currentGameId)) return "";
  const awards = awardQueue(state.terminalAwards)
    .filter(award => sameId(awardPresentationGameId(award), currentGameId));
  if (!awards.length) return "";
  return `<section class="zilch-final-awards" aria-labelledby="zilchFinalAwardsTitle">
    <h3 id="zilchFinalAwardsTitle">${escapeHtml(t("In dieser Partie erreicht"))}</h3>
    <ul>${awards.map(award => {
      const title = localizedAchievementText(award, "title", "Zilch-Award");
      const description = localizedAchievementText(award, "description", "Zilch-Leistung");
      const icon = achievementIconKey(award);
      return `<li class="zilch-final-award">
        <span class="zilch-achievement-card__icon zilch-achievement-card__icon--${escapeHtml(icon)}" aria-hidden="true"></span>
        <span class="zilch-final-award__copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small><small class="zilch-final-award__points">${escapeHtml(achievementPointsText(award))}</small></span>
      </li>`;
    }).join("")}</ul>
  </section>`;
}

function finalResult(snapshot) {
  const outcome = snapshot._zilch_outcome;
  if (!snapshot._finished || !outcome) return "";
  if (isSoloGame(snapshot)) {
    const completed = soloOutcomeStatus(snapshot) === "completed";
    const detail = authenticatedZilchPlayer() && completed
      ? t("Du hast das Solo-Ziel erreicht. Dein Ergebnis wird privat gespeichert.")
      : authenticatedZilchPlayer()
        ? t("Dieser Solo-Lauf wurde aufgegeben. Dein Ergebnis bleibt privat in deiner Zilch-Historie.")
        : "";
    const candidateResultRoute = snapshot?._zilch_result?.route || snapshot?._zilch_result?.result_route || snapshot?._zilch_result?.result_url;
    const resultRoute = zilchResultRoute(candidateResultRoute);
    const resultLink = authenticatedZilchPlayer() && resultRoute
      ? `<a class="zilch-final-action zilch-final-action--secondary" data-zilch-final-result-link href="${escapeHtml(resultRoute)}">${escapeHtml(t("Ergebnis ansehen"))}</a>`
      : "";
    return `<section class="zilch-card zilch-final-result zilch-final-result--solo" role="status"><p class="eyebrow">${escapeHtml(t("Solo-Ergebnis"))}</p><h2>${escapeHtml(soloOutcomeLabel(snapshot))}</h2>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}${finalResultAwards(snapshot)}${finalResultActions(resultLink)}</section>`;
  }
  const winners = Array.isArray(outcome.winner_ids) ? outcome.winner_ids : [];
  const participants = snapshotParticipants(snapshot);
  const cpuGame = participants.some(isCpuParticipant);
  const cpuWon = winners.some(playerId => isCpuParticipant(playerForId(snapshot, playerId)));
  const winnerNames = winners.map(playerId => playerName(playerForId(snapshot, playerId))).join(", ");
  const headline = outcome.tied
    ? t("Gleichstand")
    : cpuGame && cpuWon
      ? t("CPU gewinnt")
      : cpuGame
        ? t("Sieg gegen CPU")
        : t("Spiel beendet");
  const detail = outcome.tied
    ? t("Die Schlussrunde endet mit Gleichstand.")
    : `${winnerNames} ${t("gewinnt die Partie.")}`;
  const candidateResultRoute = snapshot?._zilch_result?.route || snapshot?._zilch_result?.result_route || snapshot?._zilch_result?.result_url;
  const resultRoute = zilchResultRoute(candidateResultRoute);
  const resultLink = authenticatedZilchPlayer() && resultRoute
    ? `<a class="zilch-final-action zilch-final-action--secondary" data-zilch-final-result-link href="${escapeHtml(resultRoute)}">${escapeHtml(t("Ergebnis ansehen"))}</a>`
    : "";
  return `<section class="zilch-card zilch-final-result" role="status"><p class="eyebrow">${escapeHtml(t("Endstand"))}</p><h2>${escapeHtml(headline)}</h2><p>${escapeHtml(detail)}</p>${finalResultAwards(snapshot)}${finalResultActions(resultLink)}</section>`;
}

async function createNewZilchRound(snapshot, button) {
  if (!snapshot?._finished || button?.disabled) return;
  const playMode = zilchPlayMode(snapshot);
  const cpu = snapshotParticipants(snapshot).find(isCpuParticipant);
  const selectedStrategy = String(cpu?.cpu_strategy || cpu?.strategy || "normal").toLowerCase();
  const cpuStrategy = CPU_STRATEGIES.has(selectedStrategy) ? selectedStrategy : "normal";
  const passphrase = playMode === "solo" ? "" : state.gamePassphrase;
  if (button) button.disabled = true;
  try {
    const response = await apiFetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(snapshot?._name || snapshot?.name || `Zilch · ${state.auth?.user?.username || t("Gast")}`).slice(0, 80),
        mode: playMode === "solo" ? "1" : "2",
        game_type: "zilch",
        play_mode: playMode,
        ...(playMode === "cpu" ? { cpu_strategy: cpuStrategy } : {}),
        ...(playMode !== "solo" ? { pass: passphrase } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.game_id) throw new Error(payload.detail || "zilch_create_failed");
    rememberPassphrase(payload.game_id, passphrase);
    if (payload.host_token) rememberGuestHostToken(payload.game_id, payload.host_token);
    rememberActiveGame(payload.game_id);
    window.location.assign(zilchPath(`/spiel/${encodeURIComponent(payload.game_id)}`));
  } catch (_) {
    window.ZDWA_UI?.toast?.(t("Neue Runde konnte nicht erstellt werden"), { kind: "error" });
    if (button) button.disabled = false;
  }
}

function statusText(snapshot, turnState) {
  if (snapshot?._zilch_cpu_error) return t("CPU-Spiel kann nicht fortgesetzt werden.");
  if (snapshot._paused) {
    return hasOfflineHuman(snapshot)
      ? t("Ein Teilnehmer ist offline. Das Spiel ist pausiert, bis die Verbindung wiederhergestellt ist.")
      : t("Spiel pausiert");
  }
  if (snapshot._finished) return isSoloGame(snapshot)
    ? soloOutcomeLabel(snapshot)
    : snapshot._zilch_outcome?.tied ? t("Gleichstand") : t("Spiel beendet");
  if (isSoloGame(snapshot) && !snapshot._started) return t("Solo-Lauf wird vorbereitet.");
  const start = snapshot._zilch_start_roll;
  if (!snapshot._started) return t("Wartet auf zweiten Teilnehmer");
  if (start?.phase === "awaiting_rolls") return t("Startspieler wird ermittelt.");
  const current = playerForId(snapshot, snapshot?._turn?.player_id);
  if (isCpuParticipant(current) && state.statusKind !== "error") return t("CPU überlegt …");
  if (state.status) return state.status;
  if (turnState?.confirmation_required) return t("Bestätigungswurf erforderlich");
  if (turnState?.phase === "awaiting_hold") return t("Wähle eine Wertung.");
  return current ? `${current.name} ${t("ist am Zug.")}` : t("Spielstand wird aktualisiert.");
}

function hasOfflineHuman(snapshot) {
  const offline = Array.isArray(snapshot?._offline_players) ? snapshot._offline_players : [];
  return offline.some(playerId => {
    const participant = participantForId(snapshot, playerId);
    return !participant || !isCpuParticipant(participant);
  });
}

function eventActor(snapshot, event) {
  return participantForId(
    snapshot,
    event?.actor_participant_id || event?.participant_id || event?.actor_id || event?.player_id,
  );
}

function cpuReasonText(event, fallback = "") {
  const key = String(event?.cpu_reason_key || "");
  // CPU rationale is a controlled server vocabulary. Unknown keys deliberately
  // stay invisible instead of turning internal or stale protocol values into
  // user-facing text.
  if (!key.startsWith("zilch.cpu_reason.")) return fallback;
  return localizedServerMessage(key, event?.cpu_reason_params || {}, fallback);
}

function cpuEventText(snapshot, event) {
  const actor = eventActor(snapshot, event);
  if (!isCpuParticipant(actor)) return "";
  const actorName = actor?.name || t("CPU");
  const actorLabel = actor?.name ? `${t("CPU")} ${actorName}` : actorName;
  const eventType = String(event?.type || event?.action || "");
  const points = Number(event?.points ?? event?.banked_points ?? event?.option?.points);
  let text = "";
  if (eventType === "hold") {
    text = `${actorLabel} ${t("hält")} ${optionTitle(event?.option)}.`;
  } else if (eventType === "roll") {
    text = `${actorLabel} ${t("würfelt weiter.")}`;
  } else if (eventType === "bank") {
    text = Number.isFinite(points) ? `${actorLabel} ${t("sichert")} ${number(points)} ${t("Punkte")}.` : `${actorLabel} ${t("sichert Punkte.")}`;
  } else if (eventType === "zilch") {
    text = `${actorLabel} ${t("hat Zilch.")}`;
  } else if (["start_roll", "start_roll_tie", "start_roll_resolved"].includes(eventType)) {
    text = t("CPU würfelt für den Start …");
  } else if (eventType === "cpu_thinking") {
    text = t("CPU überlegt …");
  }
  // The start-roll event already says exactly what the CPU is doing. Avoid
  // announcing that sentence twice when the runner adds its explanatory key.
  const reason = ["start_roll", "start_roll_tie", "start_roll_resolved"].includes(eventType)
    ? ""
    : cpuReasonText(event);
  return [text, reason].filter(Boolean).join(" · ");
}

function optionActionPayload(option) {
  if (!option) return {};
  return {
    roll_id: option.roll_id,
    option_id: option.id,
    dice_indices: option.dice_indices,
    points: option.points,
    combination_type: option.combination_type,
  };
}

function optionAllows(option, action) {
  return Array.isArray(option?.follow_up_actions) && option.follow_up_actions.includes(action);
}

function actionCards(snapshot, turnState, quickHolds, isMyTurn) {
  const blocked = Boolean(state.pendingAction || snapshot._paused || snapshot._finished || !isMyTurn);
  const selectedOption = exactOptionForDraft(quickHolds, draftHoldIndices(turnState));
  const canRoll = Boolean(!blocked && (
    turnState?.can_roll
    || (turnState?.can_select_hold && selectedOption && optionAllows(selectedOption, "zilch_roll_dice"))
  ));
  const canBank = Boolean(!blocked && (
    turnState?.can_bank
    || (turnState?.can_select_hold && selectedOption && optionAllows(selectedOption, "zilch_bank_points"))
  ));
  const rollLabel = turnState?.phase === "awaiting_hold"
    ? t("Weiterwürfeln")
    : turnState?.confirmation_required
      ? t("Bestätigen")
      : turnState?.rolls_used
        ? t("Weiterwürfeln")
        : t("Würfeln");
  return `<section class="zilch-action-cards" aria-label="${escapeHtml(t("Spielaktionen"))}">
    <button type="button" class="zilch-action-card zilch-action-card--roll" data-zilch-roll aria-keyshortcuts="Space" ${canRoll ? "" : "disabled"}>
      <strong>${escapeHtml(rollLabel)}</strong>
    </button>
    <button type="button" class="zilch-action-card zilch-action-card--bank" data-zilch-bank aria-keyshortcuts="b B" ${canBank ? "" : "disabled"}>
      <strong>${escapeHtml(t("Sichern"))}</strong>
    </button>
  </section>`;
}

function reconnectControl() {
  if (!state.game || (state.socket && state.socket.readyState === WebSocket.OPEN)) return "";
  return `<button type="button" class="small ghost" data-zilch-reconnect>${escapeHtml(t("Jetzt erneut verbinden"))}</button>`;
}

function updateGameHeader(snapshot) {
  const context = document.getElementById("zilchRoomContext");
  if (!context) return;
  const current = playerForId(snapshot, snapshot?._turn?.player_id);
  const currentLabel = state.zilchMoment
    ? (state.zilchMoment.phase === "reveal" ? t("Letzter Wurf") : "ZILCH!")
    : snapshot?._finished
      ? (isSoloGame(snapshot) ? soloOutcomeLabel(snapshot) : t("Spiel beendet"))
      : snapshot?._paused
        ? t("Spiel pausiert")
        : current
          ? (localPlayerIs(snapshot, snapshot?._turn?.player_id) ? t("Dein Zug") : `${current.name || t("Spieler")} · ${t("Am Zug")}`)
          : t("Wartet auf zweiten Teilnehmer");
  context.innerHTML = `<strong>${escapeHtml(snapshot?._name || "Zilch")}</strong><span>${escapeHtml(currentLabel)}</span>`;
  context.hidden = false;
}

function renderGameState() {
  if (!content) return;
  root?.classList.add("zilch-shell--game");
  const snapshot = state.game;
  if (!snapshot) {
    renderNotice("Zilch-Spiel wird geladen …");
    return;
  }
  const players = snapshotParticipants(snapshot);
  const boards = snapshot._zilch_boards || {};
  const turnState = snapshot._zilch_turn_state;
  const quickHolds = Array.isArray(snapshot._zilch_quick_holds) ? snapshot._zilch_quick_holds : [];
  const solo = isSoloGame(snapshot);
  const currentPlayerId = snapshot?._turn?.player_id;
  const isMyTurn = localPlayerIs(snapshot, currentPlayerId);
  const canInteract = Boolean(isMyTurn && !state.zilchMoment);
  syncSoloAbandonControl(snapshot, turnState, canInteract);
  updateGameHeader(snapshot);
  const gameName = escapeHtml(snapshot._name || "Zilch");
  const target = Number(snapshot._target_score || 10000);
  const transition = state.notebookTransition;
  const recommendations = snapshot._finished ? "" : recommendationCards(snapshot, turnState, canInteract);
  const turnScore = snapshot._finished ? "" : turnScoreMarkup(snapshot, turnState, quickHolds, canInteract);
  const resultMarkup = finalResult(snapshot);
  const hasChoices = Boolean(recommendations || turnScore || resultMarkup);
  const finished = Boolean(resultMarkup);
  const openingPanel = openingRollPanel(snapshot);
  const waitingPanel = waitingRoomPanel(snapshot);
  // With both human seats filled, the waiting-room card is the next action,
  // not an afterthought below the paper. Put it into the otherwise unused
  // right rail; a one-player waiting room still keeps its roomy status card.
  const waitingPanelUsesRail = Boolean(waitingPanel && players.length > 1);
  const sideRail = openingPanel
    ? `<aside class="zilch-start-roll-rail">${openingPanel}</aside>`
    : waitingPanelUsesRail
      ? `<aside class="zilch-start-roll-rail">${waitingPanel}</aside>`
    : hasChoices
      ? `<aside class="zilch-recommendations" aria-label="${escapeHtml(finished ? t("Spielergebnis") : t("Mögliche Wertungen"))}">${recommendations}${resultMarkup}</aside>`
      : "";
  // The current roll and its all-at-once hold sit directly under their
  // respective columns: score sheet on the left, choice rail on the right.
  // This keeps every recommendation slot free while making the full scoring
  // action a clear, thumb-sized control.
  const turnScoreControls = turnScore;
  const chatRows = (Array.isArray(snapshot._chat_history) ? snapshot._chat_history : []).map(entry => {
    const sender = participantForId(snapshot, entry?.from_id || entry?.player_id || entry?.participant_id);
    const identity = sender
      ? playerCollectionMarkup(sender)
      : `<span class="zilch-player-identity">${escapeHtml(entry?.sender || t("Spieler"))}</span>`;
    return `<li><strong>${identity}</strong><span>${escapeHtml(entry?.text || "")}</span></li>`;
  }).join("");
  const offline = hasOfflineHuman(snapshot)
    ? `<p class="zilch-offline-note">${escapeHtml(t("Ein Teilnehmer ist offline. Das Spiel ist pausiert, bis die Verbindung wiederhergestellt ist."))}</p>`
    : "";
  const cpuError = snapshot?._zilch_cpu_error
    ? `<p class="zilch-error" role="status">${escapeHtml(t("CPU-Spiel kann nicht fortgesetzt werden."))}</p>`
    : "";
  rememberNotebookScroll();
  content.innerHTML = `<h1 class="visually-hidden">${gameName}</h1>
    <p id="zilchLiveStatus" class="visually-hidden zilch-live-status--${escapeHtml(state.statusKind)}">${escapeHtml(statusText(snapshot, turnState))}</p>
    ${offline}
    ${cpuError}
    ${reconnectControl()}
    <section class="zilch-play-layout${hasChoices ? " zilch-play-layout--has-choices" : " zilch-play-layout--no-choices"}${turnScore ? " zilch-play-layout--has-turn-score" : ""}${solo ? " zilch-play-layout--solo" : " zilch-play-layout--duel"}${finished ? " zilch-play-layout--finished" : ""}" aria-label="${escapeHtml(t("Zilch-Spielbereich"))}">
      <div class="zilch-play-layout__notebook">${scoreNotebook(players, boards, {
        solo,
        target,
        transition: state.zilchMoment ? null : transition,
        activePlayerId: state.zilchMoment?.playerId || "",
      })}</div>
      ${sideRail}
      ${turnScoreControls}
    </section>
    ${waitingPanelUsesRail ? "" : waitingPanel}
    <section class="zilch-dice-dock">
      <section class="zilch-table" aria-labelledby="zilchDiceTitle">
        <h2 id="zilchDiceTitle" class="visually-hidden">${escapeHtml(t("Sechs Würfel"))}</h2>
        ${diceRack(snapshot, turnState, quickHolds, canInteract)}
        ${actionCards(snapshot, turnState, quickHolds, canInteract)}
      </section>
    </section>
    <section class="zilch-chat${state.chatOpen ? " is-open" : ""}">
      <div class="zilch-chat__bar"><button type="button" class="zilch-chat__toggle" data-zilch-chat-toggle aria-expanded="${state.chatOpen ? "true" : "false"}">${escapeHtml(t("Chat"))}<span class="zilch-chat__toggle-icon" aria-hidden="true">⌃</span></button><div id="zilchChatReactionsBar" class="zilch-chat-reactions-host" aria-label="${escapeHtml(t("Schnellreaktionen"))}"></div></div>
      <div class="zilch-chat__content"><ul id="zilchChatHistory" class="zilch-chat-history">${chatRows || `<li class="zilch-muted">${escapeHtml(t("Noch keine Nachrichten"))}</li>`}</ul><form id="zilchChatForm" class="zilch-chat-form"><label class="visually-hidden" for="zilchChatInput">${escapeHtml(t("Nachricht"))}</label><input id="zilchChatInput" maxlength="400" placeholder="${escapeHtml(t("Nachricht eingeben …"))}"><button type="submit" class="secondary">${escapeHtml(t("Senden"))}</button></form></div>
    </section>`;
  wireGameInteractions(snapshot, turnState, quickHolds);
  mountZilchEmojiToolbar(snapshot);
  syncZilchEventOverlay();
  state.notebookTransition = null;
  state.diceLandingPending = false;
  restoreNotebookScroll();
}

function syncSoloAbandonControl(snapshot, turnState, isMyTurn) {
  const existing = document.querySelector("[data-zilch-abandon-solo-header]");
  const available = Boolean(
    isSoloGame(snapshot)
    && !snapshot?._finished
    && localParticipantId(snapshot)
    && snapshot?._zilch_can_abandon
    && isMyTurn
    && !snapshot?._paused,
  );
  if (!available) {
    existing?.remove();
    return;
  }
  const button = existing || document.createElement("button");
  button.type = "button";
  button.className = "small ghost zilch-room-abandon";
  button.dataset.zilchAbandonSoloHeader = "";
  button.setAttribute("aria-label", t("Solo-Lauf aufgeben"));
  button.disabled = Boolean(state.pendingAction || state.confirmingSoloAbandon);
  if (!existing) {
    button.addEventListener("click", () => {
      void confirmSoloAbandon(state.game, state.game?._zilch_turn_state);
    });
    document.querySelector(".zilch-header-tools")?.append(button);
  }
}

function mountZilchEmojiToolbar(snapshot) {
  const mount = document.getElementById("zilchChatReactionsBar");
  if (!mount || !window.emojiUI?.init) return;
  const ownParticipant = playerForId(snapshot, localParticipantId(snapshot));
  window.emojiUI.init({
    mount,
    ws: state.socket,
    getMyName: () => ownParticipant?.name || state.auth?.user?.username || t("Spieler"),
  });
}

function requestAction(action, payload = {}, { optionId = null } = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || state.pendingAction) {
    updateStatus(t("Verbindung wird wiederhergestellt …"), "error");
    renderGameState();
    return;
  }
  state.pendingAction = action;
  state.pendingOptionId = optionId;
  updateStatus(t("Dein Zug wird aktualisiert …"));
  renderGameState();
  state.socket.send(JSON.stringify({ action, ...payload }));
}

function visibleEnabledControl(selector) {
  return [...document.querySelectorAll(selector)].find(control => (
    !control.disabled
    && control.getAttribute("aria-disabled") !== "true"
    && control.getClientRects().length > 0
  )) || null;
}

function zilchShortcutTargetIsEditable(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
  ));
}

function zilchDialogIsOpen() {
  if (document.documentElement.classList.contains("app-dialog-open")) return true;
  return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
    .some(dialog => !dialog.hidden && dialog.getClientRects().length > 0);
}

function handleZilchGameShortcut(event) {
  if (!gameId || !state.game || state.game?._finished || state.pendingAction || state.zilchMoment) return;
  if (event.defaultPrevented || event.repeat || event.isComposing) return;
  const key = String(event.key || "");
  const normalizedKey = key.toLowerCase();
  const shiftedBank = event.shiftKey && normalizedKey === "b";
  if (event.altKey || event.ctrlKey || event.metaKey || (event.shiftKey && !shiftedBank)) return;
  if (
    zilchDialogIsOpen()
    || zilchShortcutTargetIsEditable(event.target)
    || zilchShortcutTargetIsEditable(document.activeElement)
  ) return;

  let control = null;
  if (/^[1-6]$/.test(key)) {
    control = visibleEnabledControl(`[data-zilch-die-index="${Number(key) - 1}"]`);
  } else if (key === " " || key === "Spacebar" || event.code === "Space") {
    control = visibleEnabledControl("[data-zilch-start-roll]")
      || visibleEnabledControl("[data-zilch-roll]");
  } else if (normalizedKey === "b") {
    control = visibleEnabledControl("[data-zilch-bank]");
  } else if (ZILCH_RECOMMENDATION_SHORTCUTS.includes(normalizedKey)) {
    control = visibleEnabledControl(`[data-zilch-shortcut="${normalizedKey}"]`);
  }
  if (!control) return;
  event.preventDefault();
  control.click();
}

async function confirmSoloAbandon(snapshot, turnState) {
  if (state.confirmingSoloAbandon || state.pendingAction || !isSoloGame(snapshot)) return;
  if (!snapshot?._zilch_can_abandon || !localPlayerIs(snapshot, snapshot?._turn?.player_id) || snapshot?._finished || snapshot?._paused) return;
  state.confirmingSoloAbandon = true;
  let restoreFocus = false;
  renderGameState();
  try {
    const confirmation = {
      title: t("Solo-Lauf aufgeben?"),
      message: t("Möchtest du diesen Solo-Lauf wirklich aufgeben? Der bisherige Verlauf wird in deiner Historie gespeichert."),
      confirmLabel: t("Lauf aufgeben"),
      cancelLabel: t("Weiter spielen"),
      danger: true,
    };
    const accepted = typeof window.ZDWA_UI?.confirm === "function"
      ? await window.ZDWA_UI.confirm(confirmation)
      : window.confirm(confirmation.message);
    // A server snapshot may have arrived while the dialog was open. Never
    // send an abandon action against that stale turn/version.
    if (!accepted) {
      restoreFocus = true;
      return;
    }
    if (state.game !== snapshot || state.pendingAction || !snapshot?._zilch_can_abandon || snapshot?._finished || snapshot?._paused) return;
    if (!localPlayerIs(snapshot, snapshot?._turn?.player_id)) return;
    requestAction("zilch_abandon_solo", {
      turn_id: turnState?.turn_id,
      version: turnState?.version,
      confirmed: true,
    });
  } finally {
    state.confirmingSoloAbandon = false;
    if (!state.pendingAction && state.game) renderGameState();
    if (restoreFocus) window.requestAnimationFrame(() => {
      document.querySelector("[data-zilch-abandon-solo-header]")?.focus();
    });
  }
}

function wireGameInteractions(snapshot, turnState, quickHolds) {
  document.querySelector("[data-zilch-new-round]")?.addEventListener("click", event => {
    void createNewZilchRound(snapshot, event.currentTarget);
  });
  document.querySelector("[data-zilch-reconnect]")?.addEventListener("click", () => {
    if (state.stopped) return;
    window.clearTimeout(state.reconnectTimer);
    connectGameSocket();
  });
  document.querySelector("[data-zilch-start-roll]")?.addEventListener("click", () => {
    const start = snapshot._zilch_start_roll;
    const ownParticipantId = localParticipantId(snapshot);
    if (!ownParticipantId || !Array.isArray(start?.pending_player_ids) || !start.pending_player_ids.some(playerId => sameId(playerId, ownParticipantId))) return;
    requestAction("zilch_start_roll", { start_roll_version: start?.version });
  });
  document.querySelector("[data-zilch-roll]")?.addEventListener("click", () => {
    if (state.zilchMoment || !localPlayerIs(snapshot, snapshot?._turn?.player_id)) return;
    const selectedOption = exactOptionForDraft(quickHolds, draftHoldIndices(turnState));
    if (turnState?.can_select_hold && (!selectedOption || !optionAllows(selectedOption, "zilch_roll_dice"))) return;
    requestAction("zilch_roll_dice", {
      turn_id: turnState?.turn_id,
      version: turnState?.version,
      ...(turnState?.can_select_hold ? optionActionPayload(selectedOption) : {}),
    }, { optionId: selectedOption?.id || null });
  });
  document.querySelector("[data-zilch-bank]")?.addEventListener("click", () => {
    if (state.zilchMoment || !localPlayerIs(snapshot, snapshot?._turn?.player_id)) return;
    const selectedOption = exactOptionForDraft(quickHolds, draftHoldIndices(turnState));
    if (turnState?.can_select_hold && (!selectedOption || !optionAllows(selectedOption, "zilch_bank_points"))) return;
    requestAction("zilch_bank_points", {
      turn_id: turnState?.turn_id,
      version: turnState?.version,
      ...(turnState?.can_select_hold ? optionActionPayload(selectedOption) : {}),
    }, { optionId: selectedOption?.id || null });
  });
  for (const die of document.querySelectorAll("[data-zilch-die-index]")) {
    die.addEventListener("click", () => {
      if (state.zilchMoment || !localPlayerIs(snapshot, snapshot?._turn?.player_id) || state.pendingAction) return;
      const index = Number(die.dataset.zilchDieIndex);
      const current = draftHoldIndices(turnState);
      const removing = current.includes(index);
      const candidate = removing ? current.filter(value => value !== index) : [...current, index];
      const next = removing ? normalizedDraftAfterRemoval(quickHolds, candidate) : candidate;
      if (!removing && !draftCanContain(quickHolds, next)) return;
      setDraftHoldIndices(turnState, next);
      renderGameState();
    });
  }
  document.querySelector("[data-zilch-chat-toggle]")?.addEventListener("click", () => {
    state.chatOpen = !state.chatOpen;
    renderGameState();
  });
  for (const reaction of document.querySelectorAll("[data-zilch-recommendation]")) {
    reaction.addEventListener("click", () => {
      const option = quickHolds.find(candidate => candidate.id === reaction.dataset.zilchRecommendation);
      if (!option || state.zilchMoment || !localPlayerIs(snapshot, snapshot?._turn?.player_id) || state.pendingAction) return;
      const draft = draftHoldIndices(turnState);
      if (!optionMatchesDraft(option, draft)) return;
      setDraftHoldIndices(turnState, sameIndices(option.dice_indices, draft) ? [] : option.dice_indices);
      renderGameState();
    });
  }
  document.querySelector("[data-zilch-combined-score]")?.addEventListener("click", () => {
    if (
      state.zilchMoment
      || !turnState?.can_select_hold
      || !localPlayerIs(snapshot, snapshot?._turn?.player_id)
      || snapshot?._paused
      || snapshot?._finished
      || state.pendingAction
    ) return;
    const option = combinedScoringOption(quickHolds);
    if (!option) return;
    const draft = draftHoldIndices(turnState);
    setDraftHoldIndices(turnState, sameIndices(option.dice_indices, draft) ? [] : option.dice_indices);
    renderGameState();
  });
  document.getElementById("zilchChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("zilchChatInput");
    const text = input?.value?.trim();
    if (!text || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    state.socket.send(JSON.stringify({ action: "chat_message", text }));
    input.value = "";
  });
}

function renderSocketError(value) {
  updateStatus(value, "error");
  state.pendingAction = null;
  state.pendingOptionId = null;
  if (state.game) renderGameState();
}

function friendlySocketError(value) {
  // The shared socket layer intentionally returns stable machine codes for
  // creator-only guest seats. Translate those codes at the product boundary
  // so a player never sees an implementation detail in the game room.
  const messages = {
    zilch_cpu_host_required: "Dieses CPU-Spiel kann nur von der Person fortgesetzt werden, die es erstellt hat.",
    zilch_solo_host_required: "Diesen Solo-Lauf kann nur die Person fortsetzen, die ihn gestartet hat.",
    zilch_cpu_human_seat_taken: "Dieses CPU-Spiel ist bereits besetzt.",
    zilch_solo_human_seat_taken: "Dieser Solo-Lauf ist bereits geöffnet.",
  };
  const raw = String(value || "");
  if (messages[raw]) return t(messages[raw]);
  if (raw.startsWith("zilch_")) return t("Verbindung zur Partie nicht möglich.");
  return t(raw || t("Unbekannter Fehler"));
}

function messageForEvent(snapshot, event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "cpu_unavailable") {
    return cpuReasonText(event, t("CPU-Spiel kann nicht fortgesetzt werden."));
  }
  const cpuText = cpuEventText(snapshot, event);
  if (cpuText) return cpuText;
  if (event.type === "hold" && event.option?.hot_dice) return t("Hot Dice – alle sechs Würfel werden erneut frei.");
  if (event.type === "zilch" && Number(event.penalty || 0)) return t("Zilch-Serie – 500 Punkte Abzug.");
  if (["solo_completed", "solo_complete", "objective_completed"].includes(event.type)) return t("Solo-Ziel erreicht");
  if (["solo_abandoned", "abandon_solo"].includes(event.type)) return t("Solo-Lauf aufgegeben");
  return message(`zilch.event.${event.type}`);
}

function connectGameSocket() {
  if (!gameId || state.stopped) return;
  state.socket?.close();
  const socket = new WebSocket(socketUrl(gameId));
  state.socket = socket;
  socket.addEventListener("open", () => {
    const knownPlayerId = state.playerId || localValue("player");
    if (knownPlayerId) {
      socket.send(JSON.stringify({
        action: "rejoin_game",
        player_id: knownPlayerId,
        resume_token: localValue("resume"),
        pass: state.gamePassphrase,
      }));
    } else {
      const hostToken = storedGuestHostToken(gameId);
      socket.send(JSON.stringify({
        action: "join_game",
        pass: state.gamePassphrase,
        ...(hostToken ? { host_token: hostToken } : {}),
      }));
    }
  });
  socket.addEventListener("message", (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch (_) { return; }
    if (payload.player_id) {
      state.playerId = String(payload.player_id);
      setLocalValue("player", state.playerId);
    }
    if (payload.resume_token) setLocalValue("resume", payload.resume_token);
    if (payload.scoreboard) {
      const previousActivePlayerId = activeNotebookPlayerId(state.game);
      const nextActivePlayerId = activeNotebookPlayerId(payload.scoreboard);
      const activePlayerChanged = Boolean(
        previousActivePlayerId
        && nextActivePlayerId
        && !sameId(previousActivePlayerId, nextActivePlayerId),
      );
      const incomingEvent = payload.zilch_event || payload.scoreboard?._zilch_last_event;
      if (state.pendingAction === "zilch_roll_dice" || String(incomingEvent?.type || "") === "roll") {
        state.diceLandingPending = true;
      }
      const previousDraftKey = state.game ? holdDraftKey(state.game?._zilch_turn_state) : "";
      state.game = payload.scoreboard;
      const startedZilchMoment = beginZilchMoment(state.game, payload.zilch_event, {
        previousPlayerId: previousActivePlayerId,
        nextPlayerId: nextActivePlayerId,
      });
      if (activePlayerChanged && !startedZilchMoment && !state.zilchMoment) {
        state.notebookTransition = { from: previousActivePlayerId, to: nextActivePlayerId };
      }
      if (previousDraftKey !== holdDraftKey(payload.scoreboard?._zilch_turn_state)) {
        state.draftHoldKey = "";
        state.draftHoldIndices = [];
      }
      if (payload.scoreboard._finished) clearRememberedActiveGame(gameId);
      state.pendingAction = null;
      state.pendingOptionId = null;
      const eventText = messageForEvent(payload.scoreboard, payload.zilch_event || payload.scoreboard._zilch_last_event);
      updateStatus(eventText || null);
      const awardScope = terminalAwardScope(payload.scoreboard);
      if (awardScope) void presentPendingZilchAwards({ scope: awardScope });
      renderGameState();
    }
    if (payload.chat && state.game) {
      const ownParticipantId = localParticipantId(state.game);
      const ownChat = Boolean(
        payload.chat?.from_id
        && ownParticipantId
        && sameId(payload.chat.from_id, ownParticipantId),
      );
      const history = Array.isArray(state.game._chat_history) ? state.game._chat_history : [];
      state.game = { ...state.game, _chat_history: [...history, payload.chat].slice(-80) };
      renderGameState();
      // Match ZDWA's social convention: a received text gets a brief bubble,
      // while the sender only sees it in the shared chat history.
      if (!ownChat && payload.chat?.text) window.emojiUI?.handleChat?.(payload.chat);
    }
    // Unlike text chat, reactions are deliberately broadcast back to the
    // sender too. ZDWA uses the same behaviour: every player gets one clear
    // transient bubble, while no reaction is stored as a chat line.
    if (payload.emoji) window.emojiUI?.handleRemote?.(payload.emoji);
    if (payload.zilch_error) {
      renderSocketError(message(payload.zilch_error.message_key, payload.zilch_error.params || {}));
    } else if (payload.error) {
      if (payload.fatal) {
        state.stopped = true;
        clearLocalSession();
      }
      renderSocketError(friendlySocketError(payload.error));
    }
  });
  socket.addEventListener("close", () => {
    if (state.stopped || socket !== state.socket) return;
    state.pendingAction = null;
    state.pendingOptionId = null;
    updateStatus(t("Verbindung wird wiederhergestellt …"), "error");
    if (state.game) renderGameState();
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = window.setTimeout(connectGameSocket, 1_500);
  });
}

async function resolveGamePassphrase(details) {
  if (!details?.locked || !gameId) return "";
  const stored = storedPassphrase(gameId);
  const candidate = stored || await requestPassphrase(details.name);
  if (candidate === null) return null;
  const passphrase = String(candidate || "").trim();
  try {
    const url = new URL(`/api/games/${encodeURIComponent(gameId)}`, window.location.origin);
    url.searchParams.set("check", "1");
    url.searchParams.set("pass", passphrase);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("wrong_passphrase");
    return rememberPassphrase(gameId, passphrase);
  } catch (_) {
    rememberPassphrase(gameId, "");
    renderNotice("Der Raumcode ist nicht gültig. Bitte öffne die Partie erneut.", { kind: "error" });
    return null;
  }
}

async function renderGame() {
  renderNotice("Zilch-Spiel wird geladen …");
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, { cache: "no-store" });
    const details = response.ok ? await response.json() : null;
    if (!details?.exists || details.game_type !== "zilch") {
      renderNotice("Zilch-Spiel nicht gefunden.", { kind: "error" });
      return;
    }
    const playMode = zilchPlayMode(details);
    const supported = (String(details.mode) === "1" && playMode === "solo")
      || (String(details.mode) === "2" && ["multiplayer", "cpu"].includes(playMode));
    if (!supported) {
      renderNotice("Dieser Zilch-Spielmodus ist noch nicht verfügbar.");
      return;
    }
    state.details = details;
    rememberActiveGame(gameId);
    const passphrase = await resolveGamePassphrase(details);
    if (passphrase === null) return;
    state.gamePassphrase = passphrase;
    const ownParticipant = (Array.isArray(details.participants) ? details.participants : [])
      .find(player => !isCpuParticipant(player) && Number(player.user_id) === Number(state.auth?.user?.id));
    const ownPlayer = (details.player_statuses || []).find(player => Number(player.user_id) === Number(state.auth?.user?.id));
    const connectionPlayerId = participantConnectionId(ownParticipant) || ownPlayer?.id;
    if (connectionPlayerId) state.playerId = String(connectionPlayerId);
    connectGameSocket();
  } catch (_) {
    renderNotice(state.details?.play_mode === "cpu" ? "CPU-Spiel kann nicht fortgesetzt werden." : "Zilch-Spiel konnte nicht geladen werden.", { kind: "error" });
  }
}

async function initialize() {
  if (!root || !content) return;
  const appMode = initializeAppMode({ mode: "zilch" });
  try {
    state.auth = await loadAuth({ refresh: true });
  } catch (_) {
    return;
  }
  if (!appMode.applyAuth(state.auth)) return;
  renderShell();
  if (gameId) document.addEventListener("keydown", handleZilchGameShortcut);
  document.addEventListener("click", async (event) => {
    const logoutButton = event.target instanceof Element
      ? event.target.closest("[data-zilch-logout]")
      : null;
    if (!logoutButton || logoutButton.disabled) return;
    logoutButton.disabled = true;
    logoutButton.setAttribute("aria-busy", "true");
    try { await logout(); } catch (_) {} finally { window.location.replace(zilchPath("/")); }
  });
  if (resultId) await renderResult();
  else if (gameId) await renderGame();
  else if (playerAchievementsUsername) await renderPlayerAchievements();
  else if (accountRoute) await renderAccount();
  else if (achievementsRoute) await renderAchievements();
  else if (historyRoute) await renderHistory();
  else if (statisticsRoute) await renderStatistics();
  else if (leaderboardsRoute) await renderLeaderboards();
  else if (rulesRoute) await renderRules();
  else await renderLobby();
  if (authenticatedZilchPlayer() && !gameId && !playerAchievementsUsername) {
    void presentPendingZilchAwards({ scope: "page" });
  }
}

window.addEventListener("beforeunload", () => {
  state.stopped = true;
  window.clearTimeout(state.reconnectTimer);
  window.clearTimeout(state.zilchMomentTimer);
  state.socket?.close();
});

window.addEventListener("resize", positionZilchEventOverlay);
window.addEventListener("scroll", positionZilchEventOverlay, { passive: true });

window.addEventListener("online", () => {
  if (gameId && !state.stopped && (!state.socket || state.socket.readyState === WebSocket.CLOSED)) connectGameSocket();
});

void initialize();
