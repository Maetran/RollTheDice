import { apiFetch, escapeHtml, loadAuth, logout } from "../shared/auth.js";
import { initializeAppMode } from "../multigame/app-mode.js";

const root = document.querySelector("[data-zilch-root]");
const content = document.getElementById("zilchContent");
const liveAnnouncements = document.getElementById("zilchLiveAnnouncements");
const gameIdMatch = window.location.pathname.match(/^\/zilch\/spiel\/([^/]+)$/);
const resultIdMatch = window.location.pathname.match(/^\/zilch\/ergebnis\/([^/]+)$/);
function decodedPathSegment(match) {
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch (_) { return null; }
}
const gameId = decodedPathSegment(gameIdMatch);
const resultId = decodedPathSegment(resultIdMatch);
const historyRoute = window.location.pathname === "/zilch/historie";
const rulesRoute = window.location.pathname === "/zilch/regeln";
const statisticsRoute = window.location.pathname === "/zilch/statistiken";
const leaderboardsRoute = window.location.pathname === "/zilch/bestenlisten";
const achievementsRoute = window.location.pathname === "/zilch/erfolge";
const accountRoute = window.location.pathname === "/zilch/konto";
const playerAchievementsMatch = window.location.pathname.match(/^\/zilch\/spieler\/([^/]+)$/);
const playerAchievementsUsername = decodedPathSegment(playerAchievementsMatch);
const ZILCH_ACTIVE_GAME_STORAGE_KEY = "zilch_active_game_id";
const ZILCH_LEADERBOARD_LIMIT = 100;
const ZILCH_LEADERBOARD_CATEGORIES = new Set(["solo_sprint", "multiplayer_wins", "cpu_wins"]);
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
  playerAchievements: null,
  awardPresentationPromise: null,
  awardPresentationActive: false,
  awardPresentationCheckedScopes: new Set(),
  chatOpen: false,
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
  return escapeHtml(player?.name || t("Spieler"));
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
  if (accountSlot) accountSlot.innerHTML = account;
  const logoutButton = document.getElementById("zilchLogout");
  if (logoutButton) {
    logoutButton.setAttribute("aria-label", t("Abmelden"));
    const label = logoutButton.querySelector(".zilch-control-label");
    if (label) label.textContent = t("Abmelden");
  }
  const rulesLink = document.getElementById("zilchRoomRules");
  if (rulesLink) {
    rulesLink.setAttribute("aria-label", t("Spielregeln"));
    rulesLink.setAttribute("title", t("Spielregeln"));
    const label = rulesLink.querySelector(".zilch-control-label");
    if (label) label.textContent = t("Regeln");
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
  const roomRules = document.getElementById("zilchRoomRules");
  if (!navigation) return;
  const inGame = routeKind() === "game";
  if (roomContext) roomContext.hidden = !inGame;
  if (roomRules) roomRules.hidden = !inGame;
  if (inGame) {
    navigation.innerHTML = "";
    navigation.hidden = true;
    return;
  }
  const current = navigationRouteKind();
  const entries = [
    { key: "lobby", href: "/zilch", label: t("Lobby") },
    { key: "leaderboards", href: "/zilch/bestenlisten", label: t("Spieler & Ranking") },
    { key: "rules", href: "/zilch/regeln", label: t("Regeln") },
    {
      key: "account",
      href: "/zilch/konto",
      label: t("Konto"),
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
    return `<span class="zilch-player-chip${cpu ? " zilch-player-chip--cpu" : online ? "" : " zilch-player-chip--offline"}">${cpu ? "" : '<span class="zilch-connection-dot" aria-hidden="true"></span>'}${escapeHtml(player?.name || t("Spieler"))}${participantMeta(player, { compact: true })}<span class="visually-hidden"> ${escapeHtml(status)}</span></span>`;
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
  const mine = Boolean(game.my_participant_id || game.my_player_id || game.my_cpu_host || game.my_solo_host);
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
    <a class="button-link zilch-lobby-action" href="/zilch/spiel/${encodeURIComponent(game.id)}">${escapeHtml(action)}</a>
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
    <a class="button-link zilch-lobby-action" href="/zilch/ergebnis/${encodeURIComponent(id)}">${escapeHtml(t("Ergebnis ansehen"))}</a>
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
  content.innerHTML = `<section class="zilch-intro zilch-intro--lobby">
      <p class="eyebrow">${escapeHtml(t("Online würfeln"))}</p>
      <h1>${escapeHtml(t("Zilch die Wand an – Würfelspiel online"))}</h1>
      <p>${escapeHtml(t("Wähle Solo, CPU oder eine Partie zu zweit. Mit sechs Würfeln sammelst du Punkte, sicherst sie rechtzeitig und erreichst 10’000."))}</p>
    </section>
    <section class="zilch-card zilch-create-card">
      <h2>${escapeHtml(t("Neue Zilch-Partie"))}</h2>
      <form id="zilchCreateForm" class="zilch-create-form">
        <input id="zilchGameName" type="hidden" value="${escapeHtml(`Zilch · ${state.auth?.user?.username || "Mani"}`)}">
        <fieldset class="zilch-mode-choice"><legend>${escapeHtml(t("Spielart"))}</legend><div class="zilch-mode-grid" role="radiogroup" aria-label="${escapeHtml(t("Spielart"))}"><button class="zilch-mode-option zilch-mode-option--solo is-selected" type="button" role="radio" aria-checked="true" data-zilch-play-mode="solo"><strong>${escapeHtml(t("Solo"))}</strong></button><button class="zilch-mode-option" type="button" role="radio" aria-checked="false" data-zilch-play-mode="multiplayer"><strong>${escapeHtml(t("Zu zweit"))}</strong></button><button class="zilch-mode-option" type="button" role="radio" aria-checked="false" data-zilch-play-mode="cpu"><strong>${escapeHtml(t("Gegen CPU"))}</strong></button></div></fieldset>
        <label id="zilchCpuStrategy" class="zilch-create-select zilch-cpu-strategy" for="zilchCpuStrategySelect" hidden><span>${escapeHtml(t("CPU-Strategie"))}</span><select id="zilchCpuStrategySelect" name="zilchCpuStrategy"><option value="conservative">${escapeHtml(t("Konservativ"))}</option><option value="normal" selected>${escapeHtml(t("Normal"))}</option><option value="aggressive">${escapeHtml(t("Aggressiv"))}</option></select></label>
        <section id="zilchSoloObjective" class="zilch-solo-create-objective" aria-labelledby="zilchSoloObjectiveTitle">
          <strong id="zilchSoloObjectiveTitle">${escapeHtml(t("10’000-Punkte-Sprint"))}</strong>
          <span>${escapeHtml(t("In möglichst wenigen Zügen"))}</span>
        </section>
        <button class="zilch-create-submit" type="submit">${escapeHtml(t("Partie erstellen"))}</button>
        <details class="zilch-create-options">
          <summary>${escapeHtml(t("Passwortschutz"))}</summary>
          <label><span>${escapeHtml(t("Raumcode (optional)"))}</span><input id="zilchGamePassphrase" type="password" maxlength="100" autocomplete="new-password" placeholder="${escapeHtml(t("Nur zum privaten Beitritt"))}"></label>
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
      <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Bestenlisten"))}</p><h2 id="zilchLobbyRankingTitle">${escapeHtml(t("Zilch-Ranglisten"))}</h2></div><a class="small ghost button-link" href="/zilch/bestenlisten">${escapeHtml(t("Alle Bestenlisten"))}</a></div>
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
      const alphaGames = games.filter(game => {
        const mode = zilchPlayMode(game);
        const validMode = (String(game.mode) === "1" && mode === "solo")
          || (String(game.mode) === "2" && (mode === "multiplayer" || mode === "cpu"));
        return validMode && !game.finished && !game.aborted;
      });
      const belongsToMe = (game) => Boolean(
        game.my_participant_id
        || game.my_player_id
        || game.my_cpu_host
        || game.my_solo_host,
      );
      const runningGames = alphaGames.filter(game => belongsToMe(game) && (game.started || isSoloGame(game)));
      // A CPU game has exactly one human seat, so it must never be presented
      // to another preview user as a joinable waiting room. The same applies
      // to solo runs: their only seat belongs to their human owner.
      const waitingGames = alphaGames.filter(game => !game.started && (
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
      rememberActiveGame(payload.game_id);
      window.location.assign(`/zilch/spiel/${encodeURIComponent(payload.game_id)}`);
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
      <div><p class="eyebrow">${escapeHtml(t("Private Historie"))}</p><h1>${escapeHtml(t("Abgeschlossene Spiele"))}</h1><p>${escapeHtml(t("Deine privaten Zilch-Partien bleiben getrennt von ZDWA-Ergebnissen und Ranglisten."))}</p></div>
      <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
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

// Zilch achievements deliberately remain a separate private projection.  The
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
};
const ZILCH_ACHIEVEMENT_CATEGORY_ORDER = Object.keys(ZILCH_ACHIEVEMENT_CATEGORY_LABELS);
const ZILCH_ACHIEVEMENT_ICONS = new Set(["dice", "paper", "flame", "shield", "star"]);
const ZILCH_ACHIEVEMENT_ICON_ALIASES = {
  die: "dice",
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
  return `<span class="zilch-achievement-card__progress">${escapeHtml(t("Fortschritt"))}: ${escapeHtml(number(current))} ${escapeHtml(t("von"))} ${escapeHtml(number(target))}</span>`;
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

function achievementCardMarkup(achievement, { unlocked = false, categories = [] } = {}) {
  const hidden = achievementIsHidden(achievement, unlocked);
  const category = achievementCategoryKey(achievement);
  const title = hidden
    ? t("Versteckter Zilch-Award")
    : localizedAchievementText(achievement, "title", "Zilch-Award");
  const description = hidden
    ? t("Dieser Award wird erst nach seiner Freischaltung sichtbar.")
    : localizedAchievementText(achievement, "description", "Private Zilch-Leistung");
  const unlockedAt = achievementValue(achievement, ["unlocked_at", "unlockedAt"]);
  const stateLabel = unlocked ? t("Freigeschaltet") : t("Gesperrt");
  const icon = achievementIconKey(achievement);
  return `<article class="zilch-achievement-card${unlocked ? " is-unlocked" : " is-locked"}" aria-label="${escapeHtml(`${title} · ${stateLabel}`)}">
    <span class="zilch-achievement-card__icon zilch-achievement-card__icon--${escapeHtml(icon)}" aria-hidden="true"></span>
    <div class="zilch-achievement-card__copy">
      <p class="zilch-achievement-card__category">${escapeHtml(achievementCategoryLabel(category, categories, achievement))}</p>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${achievementModeMarkup(achievement)}
    </div>
    <div class="zilch-achievement-card__status">
      <span class="zilch-achievement-card__state">${escapeHtml(stateLabel)}</span>
      ${unlocked && unlockedAt ? `<time datetime="${escapeHtml(String(unlockedAt))}">${escapeHtml(t("Freigeschaltet am"))}: ${escapeHtml(formattedDateTime(unlockedAt))}</time>` : achievementProgressMarkup(achievement)}
    </div>
  </article>`;
}

function achievementProjection(payload) {
  const outer = plainObject(payload);
  const nested = plainObject(outer.achievements);
  const definitions = firstObjectArray(nested.definitions, outer.definitions);
  const unlocked = firstObjectArray(nested.unlocked, outer.unlocked);
  const lockedValue = Array.isArray(nested.locked) ? nested.locked : outer.locked;
  const hasExplicitLocked = Array.isArray(lockedValue);
  const explicitLocked = objectArray(lockedValue);
  const unlockedKeys = new Set(unlocked.map(achievementKey).filter(Boolean));
  return {
    version: outer.version ?? nested.version ?? 1,
    player: plainObject(outer.player || nested.player),
    categories: achievementCategories(outer.categories, nested.categories),
    unlocked,
    locked: hasExplicitLocked ? explicitLocked : definitions.filter(definition => !unlockedKeys.has(achievementKey(definition))),
    pending: firstObjectArray(outer.awards, outer.pending, nested.awards, nested.pending),
  };
}

function achievementGroups(projection) {
  const groups = new Map();
  const add = (achievement, unlocked) => {
    const key = achievementCategoryKey(achievement);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ achievement, unlocked });
  };
  objectArray(projection?.unlocked).forEach(achievement => add(achievement, true));
  objectArray(projection?.locked).forEach(achievement => add(achievement, false));
  return [...groups.entries()].sort(([first], [second]) => (
    ZILCH_ACHIEVEMENT_CATEGORY_ORDER.indexOf(first) - ZILCH_ACHIEVEMENT_CATEGORY_ORDER.indexOf(second)
  ));
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
      <div class="zilch-achievement-grid">${entries.map(entry => achievementCardMarkup(entry.achievement, {
        unlocked: entry.unlocked,
        categories: projection.categories,
      })).join("")}</div>
    </section>`;
  }).join("")}</div>`;
}

async function fetchZilchAchievements() {
  const response = await fetch("/api/zilch/achievements", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return achievementProjection(await response.json());
}

async function fetchZilchPendingAwards() {
  const response = await fetch("/api/zilch/achievements/pending", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return achievementProjection(await response.json()).pending;
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
  const description = localizedAchievementText(award, "description", "Private Zilch-Leistung");
  const lines = [description, `${t("Kategorie")}: ${category}`];
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

function terminalAwardScope(snapshot) {
  const result = plainObject(snapshot?._zilch_result);
  const resultIdValue = String(result.game_id || gameId || "").trim();
  if (!snapshot?._finished || snapshot?._finalization_pending || !resultIdValue || !result.result_url) return "";
  return `terminal:${resultIdValue}`;
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
      const awards = awardQueue(await fetchZilchPendingAwards());
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
      if (acknowledgementsCompleted && achievementsRoute && state.achievements) {
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
      if (achievementsRoute && state.achievements) renderAchievementsBody();
    }
  })();
  state.awardPresentationPromise = presentation;
  return presentation;
}

function renderAchievementsBody() {
  const slot = document.getElementById("zilchAchievementsBody");
  if (!slot) return;
  slot.innerHTML = achievementsCatalogMarkup(state.achievements || {});
}

async function renderAchievements() {
  if (!content) return;
  content.innerHTML = `<section class="zilch-game-head zilch-achievements-head">
      <div><p class="eyebrow">${escapeHtml(t("Private Sammlung"))}</p><h1>${escapeHtml(t("Zilch-Awards"))}</h1><p>${escapeHtml(t("Deine Awards entstehen aus abgeschlossenen Zilch-Partien. Sie verändern weder ZDWA-Ränge noch Ehrenberg-Marken."))}</p></div>
      <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
    </section>
    <div id="zilchAchievementsBody" aria-live="polite"><section class="zilch-card zilch-loading-card"><p>${escapeHtml(t("Zilch-Awards werden geladen …"))}</p></section></div>`;
  try {
    state.achievements = await fetchZilchAchievements();
    renderAchievementsBody();
  } catch (_) {
    const slot = document.getElementById("zilchAchievementsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Awards nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p><a class="button-link small ghost" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a></section>`;
  }
}

async function renderAccount() {
  if (!content) return;
  const username = state.auth?.user?.username || t("Spieler");
  content.innerHTML = `<section class="zilch-game-head zilch-account-head">
      <div><p class="eyebrow">${escapeHtml(t("Mein Zilch-Konto"))}</p><h1>${escapeHtml(username)}</h1><p>${escapeHtml(t("Dein Zilch-Konto bündelt deine privaten Statistiken und Awards."))}</p></div>
      <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
    </section>
    <section class="zilch-account-overview">
      <a class="zilch-card zilch-account-link" href="/zilch/statistiken"><p class="eyebrow">${escapeHtml(t("Deine Statistiken"))}</p><h2>${escapeHtml(t("Deine Zilch-Werte"))}</h2><p>${escapeHtml(t("Behalte Solo-, CPU- und Zwei-Spieler-Partien im Blick."))}</p></a>
      <section class="zilch-card zilch-account-settings"><p class="eyebrow">${escapeHtml(t("Zilch-Einstellungen"))}</p><h2>${escapeHtml(t("Kommt später"))}</h2><p>${escapeHtml(t("Eigene Zilch-Einstellungen ergänzen wir mit den nächsten Spieloptionen."))}</p></section>
    </section>
    <section class="zilch-account-awards" aria-labelledby="zilchAccountAwardsTitle"><div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Zilch-Awards"))}</p><h2 id="zilchAccountAwardsTitle">${escapeHtml(t("Deine Erfolge"))}</h2></div><a class="small ghost button-link" href="/zilch/erfolge">${escapeHtml(t("Alle Awards"))}</a></div><div id="zilchAchievementsBody" aria-live="polite"><section class="zilch-card zilch-loading-card"><p>${escapeHtml(t("Zilch-Awards werden geladen …"))}</p></section></div></section>`;
  try {
    state.achievements = await fetchZilchAchievements();
    renderAchievementsBody();
  } catch (_) {
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
      <div><p class="eyebrow">${escapeHtml(t("Private Zilch-Sammlung"))}</p><h1>${escapeHtml(t("Zilch-Awards eines Spielers"))}</h1><p>${escapeHtml(t("Diese private Ansicht zeigt ausschließlich Zilch-Awards und keine ZDWA-Ränge oder Ehrenberg-Marken."))}</p></div>
      <a class="small ghost button-link" href="/zilch/erfolge">${escapeHtml(t("Meine Zilch-Awards"))}</a>
    </section>
    <div id="zilchPlayerAchievementsBody" aria-live="polite"><section class="zilch-card zilch-loading-card"><p>${escapeHtml(t("Zilch-Awards werden geladen …"))}</p></section></div>`;
  try {
    state.playerAchievements = await fetchZilchPlayerAchievements(requestedName);
    const slot = document.getElementById("zilchPlayerAchievementsBody");
    const displayName = String(state.playerAchievements.player?.username || state.playerAchievements.player?.display_name || requestedName);
    document.title = `${displayName} – ${t("Zilch-Awards")}`;
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-achievement-profile" aria-labelledby="zilchAchievementProfileTitle"><p class="eyebrow">${escapeHtml(t("Private Zilch-Sammlung"))}</p><h2 id="zilchAchievementProfileTitle">${escapeHtml(displayName)}</h2></section>${achievementsCatalogMarkup(state.playerAchievements)}`;
  } catch (_) {
    const slot = document.getElementById("zilchPlayerAchievementsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Awards nicht verfügbar"))}</h2><p>${escapeHtml(t("Dieser private Zilch-Spieler konnte nicht gefunden werden."))}</p><a class="button-link small ghost" href="/zilch/erfolge">${escapeHtml(t("Meine Zilch-Awards"))}</a></section>`;
  }
}

// Statistics and ranking values are intentionally rendered as a projection of
// the private API response.  The browser never combines results, derives a
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
    return statisticsEmptyMarkup(t("Noch keine Zilch-Partien"), t("Schließe eine private Zilch-Partie ab, damit hier deine getrennten Werte erscheinen."));
  }
  const entries = [
    statisticEntry(t("Abgeschlossene Partien und Läufe"), overview, ["completed_records", "completed_games_and_runs", "completed", "completed_count", "games"]),
  ];
  return `${statisticsSection({
    eyebrow: t("Übersicht"),
    title: t("Deine Zilch-Statistiken"),
    description: t("Diese Werte stammen nur aus gespeicherten privaten Zilch-Ergebnissen."),
    entries,
  })}${gamesByModeMarkup(overview)}`;
}

function renderMultiplayerStatistics(statistics) {
  const multiplayer = statisticsScope(statistics, "multiplayer");
  if (!hasStatisticRecords(multiplayer, ["games", "completed_games"])) {
    return statisticsEmptyMarkup(t("Noch keine Human-vs-Human-Partien"), t("Spiele eine private Partie gegen einen anderen Menschen, damit diese Werte erscheinen."));
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
      t("Erstelle eine private Partie gegen die CPU, damit diese Werte erscheinen."),
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
      <div><p class="eyebrow">${escapeHtml(t("Private Auswertung"))}</p><h1>${escapeHtml(t("Zilch-Statistiken"))}</h1><p>${escapeHtml(t("Deine Zilch-Werte werden getrennt von ZDWA und ausschließlich aus gespeicherten Ergebnissen berechnet."))}</p></div>
      <a class="small ghost button-link" href="/zilch/bestenlisten">${escapeHtml(t("Zu den Bestenlisten"))}</a>
    </section>
    <div id="zilchStatisticsBody" aria-live="polite">${statisticsTabMarkup()}<section class="zilch-card zilch-loading-card"><p>${escapeHtml(t("Zilch-Statistiken werden geladen …"))}</p></section></div>`;
  try {
    state.statistics = await fetchZilchStatistics();
    renderStatisticsBody();
  } catch (_) {
    const slot = document.getElementById("zilchStatisticsBody");
    if (slot) slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Statistiken nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p><a class="button-link small ghost" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a></section>`;
  }
}

function normalizedLeaderboardCategory(value) {
  const category = String(value || "").toLowerCase();
  return ZILCH_LEADERBOARD_CATEGORIES.has(category) ? category : "solo_sprint";
}

function leaderboardCategoryLabel(category) {
  if (category === "multiplayer_wins") return t("Zwei Spieler · Siege");
  if (category === "cpu_wins") return t("Gegen CPU · Siege");
  return t("Solo-Sprint");
}

function leaderboardSortingDescription(category) {
  if (category === "multiplayer_wins") return t("Sortierung: Siege, dann weniger Niederlagen, mehr Gleichstände, höhere Endpunktzahl und höchste Runde; Competition Ranking.");
  if (category === "cpu_wins") return t("Sortierung: Siege gegen die gewählte Strategie, dann weniger Niederlagen, mehr Gleichstände, höhere Endpunktzahl und höchste Runde; Competition Ranking.");
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

function leaderboardEntryName(entry) {
  return String(entry?.display_name || entry?.username || t("Spieler"));
}

function zilchPlayerAchievementLink(entry) {
  const username = String(entry?.username || entry?.player_username || "").trim();
  const label = leaderboardEntryName(entry);
  if (!username || entry?.participant_type === "cpu") return `<strong>${escapeHtml(label)}</strong>`;
  return `<a class="zilch-player-achievement-link" href="/zilch/spieler/${encodeURIComponent(username)}">${escapeHtml(label)}</a>`;
}

function leaderboardTableMarkup(leaderboard) {
  const entries = Array.isArray(leaderboard.entries) ? leaderboard.entries : [];
  const columns = leaderboardColumns(state.leaderboardCategory);
  if (!entries.length) return `<section class="zilch-empty-state"><h2>${escapeHtml(t("Noch keine vergleichbaren Ergebnisse"))}</h2><p>${escapeHtml(t("Sobald eine passende private Zilch-Partie abgeschlossen ist, erscheint sie hier."))}</p></section>`;
  return `<div class="zilch-leaderboard-table-wrap" tabindex="0" aria-label="${escapeHtml(t("Zilch-Bestenliste"))}">
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
  const primary = leaderboardEntryValue(own, ["primary_value"]);
  return `<aside class="zilch-card zilch-own-leaderboard-entry" aria-label="${escapeHtml(t("Dein Eintrag"))}"><p class="eyebrow">${escapeHtml(t("Dein Eintrag"))}</p><h2>${zilchPlayerAchievementLink(own)}</h2><p><strong>${escapeHtml(t("Rang"))} ${escapeHtml(rank === null ? "—" : number(rank))}</strong>${primary === null ? "" : ` · ${escapeHtml(formattedStatistic(primary))}`}</p></aside>`;
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
      ${["solo_sprint", "multiplayer_wins", "cpu_wins"].map(value => `<option value="${value}"${value === category ? " selected" : ""}>${escapeHtml(leaderboardCategoryLabel(value))}</option>`).join("")}
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
  window.history.replaceState({}, "", `/zilch/bestenlisten${query ? `?${query}` : ""}`);
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
      <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Private Bestenlisten"))}</p><h2>${escapeHtml(leaderboardCategoryLabel(state.leaderboardCategory))}</h2></div><p class="zilch-leaderboard-sorting">${escapeHtml(leaderboardSortingDescription(state.leaderboardCategory))}</p></div>
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
    slot.innerHTML = `<section class="zilch-card zilch-empty-state" role="status"><h2>${escapeHtml(t("Zilch-Bestenliste nicht verfügbar"))}</h2><p>${escapeHtml(t("Bitte versuche es später erneut oder kehre zur Zilch-Lobby zurück."))}</p><a class="button-link small ghost" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a></section>`;
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
      <div><p class="eyebrow">${escapeHtml(t("Private Auswertung"))}</p><h1>${escapeHtml(t("Zilch-Bestenlisten"))}</h1><p>${escapeHtml(t("Die Ranglisten vergleichen deine besten abgeschlossenen Zilch-Partien."))}</p></div>
      <div class="zilch-actions"><a class="small ghost button-link" href="/zilch/statistiken">${escapeHtml(t("Deine Statistiken"))}</a><a class="small ghost button-link" href="/zilch/erfolge">${escapeHtml(t("Zilch-Awards"))}</a></div>
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
  const dice = ruleNumber(facts?.dice_count);
  return `<section class="zilch-game-head zilch-rules-head">
      <div><p class="eyebrow">${escapeHtml(t("Private Hilfe"))}</p><h1>${escapeHtml(t("Zilch-Regeln"))}</h1><p>${escapeHtml(t("Alles Wichtige für deine nächste Partie auf einen Blick."))}</p></div>
      <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
    </section>
    <section class="zilch-card zilch-rules-overview">
      <h2>${escapeHtml(t("Ziel der Partie"))}</h2>
      <p>${escapeHtml(t("Sichere Punkte, bis mindestens das Ziel erreicht ist. Danach erhält der andere Teilnehmer einen vollständigen Gegenzug."))}</p>
      <dl class="zilch-rule-facts">
        <div><dt>${escapeHtml(t("Würfel"))}</dt><dd>${escapeHtml(dice)}</dd></div>
        <div><dt>${escapeHtml(t("Ziel"))}</dt><dd>${escapeHtml(target)} ${escapeHtml(t("Punkte"))}</dd></div>
        <div><dt>${escapeHtml(t("Sichern ab"))}</dt><dd>${escapeHtml(`${ruleNumber(facts?.bank_minimum)} ${t("Punkte")}`)}</dd></div>
      </dl>
    </section>
    <section class="zilch-card zilch-rules-section" aria-labelledby="zilchScoringTitle">
      <p class="eyebrow">${escapeHtml(t("Wertung"))}</p><h2 id="zilchScoringTitle">${escapeHtml(t("Was Punkte bringt"))}</h2>
      <div class="zilch-rule-table-wrap"><table class="zilch-rule-table"><tbody>
        ${rulesTableRow(t("Einzelne Einsen"), `${ruleNumber(scoring.single_one)} ${t("Punkte")}`, t("Jede einzeln gehaltene 1 zählt."))}
        ${rulesTableRow(t("Einzelne Fünfen"), `${ruleNumber(scoring.single_five)} ${t("Punkte")}`, t("Jede einzeln gehaltene 5 zählt."))}
        ${rulesTableRow(t("Drei Einsen"), `${ruleNumber(scoring.three_ones)} ${t("Punkte")}`, t("Ein Drilling Einsen erfordert danach einen Bestätigungswurf."))}
        ${rulesTableRow(t("Drillinge 2 bis 6"), t("Augenzahl × 100"), t("Drei gleiche Würfel werden als Drilling gewertet."))}
        ${rulesTableRow(t("Vier oder fünf Gleiche"), t("Keine Sonderwertung"), t("Sie bestehen aus einem Drilling und möglichen einzelnen Einsen oder Fünfen."))}
        ${rulesTableRow(t("Sechs Gleiche"), t("Zwei Drillinge"), t("Jedes Drilling-Set zählt getrennt; alle sechs Würfel lösen Hot Dice aus."))}
        ${rulesTableRow(t("Straße 1–6"), `${ruleNumber(scoring.straight)} ${t("Punkte")}`, t("Alle sechs Würfel werden gehalten."))}
        ${rulesTableRow(t("Drei Paare"), `${ruleNumber(scoring.three_pairs)} ${t("Punkte")}`, t("Drei verschiedene Paare mit allen sechs Würfeln."))}
        ${rulesTableRow(t("Zwei Drillinge"), t("Summe beider Drillinge"), t("Zum Beispiel drei Zweien und drei Vieren ergeben 600 Punkte."))}
        ${rulesTableRow(t("500 für nichts"), `${ruleNumber(scoring.nothing_bonus)} ${t("Punkte")}`, t("Nur mit sechs freien Würfeln ohne andere Wertung; dies ist kein Zilch."))}
      </tbody></table></div>
    </section>
    <section class="zilch-rules-grid">
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Wertungen auswählen"))}</h2><p>${escapeHtml(t("Tippe eine Wertung oder einzelne Würfel an. Die Auswahl bleibt bis zum Weiterwürfeln oder Sichern änderbar."))}</p><p>${escapeHtml(t("Nur eine gemeinsam wertende Auswahl kann übernommen werden; ungültig gewordene Würfel fallen aus der Auswahl."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Würfeln oder sichern"))}</h2><p>${escapeHtml(t("Nach dem dritten Wurf müssen mindestens 300 Rundenpunkte gehalten sein. Sichern ist ab 400 Punkten möglich, solange kein Bestätigungswurf offen ist."))}</p><p>${escapeHtml(t("Vor dem Sichern kannst du deine Würfelauswahl jederzeit anpassen."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Hot Dice und Bestätigungswurf"))}</h2><p>${escapeHtml(t("Wenn alle sechs Würfel Punkte geben, werden sie wieder frei: Hot Dice. Die Rundenpunkte bleiben bestehen."))}</p><p>${escapeHtml(t("Ein Tipp auf Hot Dice markiert alle passenden Würfel. Erst Weiterwürfeln übernimmt die Auswahl."))}</p><p>${escapeHtml(t("Nach drei Einsen oder einem vollständigen Hold muss ein weiterer Punktewurf von mindestens 50 Punkten bestätigt werden, bevor du sichern darfst."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Zilch-Serie"))}</h2><p>${escapeHtml(t("Ein Wurf ohne gültige Wertung – oder eine nicht erreichbare 300er-Regel nach Wurf drei – beendet den Zug als Zilch. Ungesicherte Punkte verfallen."))}</p><p>${escapeHtml(t("Beim Übergang vom zweiten zum dritten Zilch in Folge werden einmalig 500 Punkte abgezogen, niemals unter null."))}</p></section>
    </section>
    <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Start und Spielende"))}</h2><ol class="zilch-rule-steps"><li>${escapeHtml(t("Beide Teilnehmer würfeln zu Beginn einmal. Der höhere Wurf beginnt; Gleichstände werden wiederholt."))}</li><li>${escapeHtml(t("Erreicht ein Teilnehmer mindestens das Ziel, beginnt die Schlussrunde."))}</li><li>${escapeHtml(t("Der andere Teilnehmer spielt einen vollständigen normalen Gegenzug."))}</li><li>${escapeHtml(t("Danach gewinnt der höchste Gesamtstand. Bei Gleichstand gibt es keinen Stechwurf."))}</li></ol><p class="zilch-muted">${escapeHtml(t("Wähle Würfel und entscheide dann: weiterwürfeln oder sichern."))}</p></section>
    <section class="zilch-card zilch-rules-section zilch-rules-section--solo"><p class="eyebrow">${escapeHtml(t("Solo"))}</p><h2>${escapeHtml(t("10’000-Punkte-Sprint"))}</h2><p>${escapeHtml(t("Im Solo-Sprint erreichst du mindestens 10’000 Punkte in möglichst wenigen eigenen Zügen. Der Lauf beginnt direkt mit deinem ersten normalen Zug – ohne Startwurf, Gegner, Schlussrunde oder Gegenzug."))}</p><p>${escapeHtml(t("Bei gleicher Zielerreichung werden später zuerst weniger Züge, dann weniger Würfe, weniger Zilchs und eine kürzere aktive Dauer verglichen. Pausenzeit zählt nicht zur aktiven Dauer."))}</p><p>${escapeHtml(t("Du kannst einen Solo-Lauf nach Bestätigung aufgeben. Er bleibt als privates Ergebnis mit dem Status „Aufgegeben“ erhalten."))}</p></section>
    <section class="zilch-card zilch-rules-examples"><p class="eyebrow">${escapeHtml(t("Beispiele"))}</p><h2>${escapeHtml(t("Gültige Auswahlen"))}</h2><ul><li><code>5–5–5–5–2–3</code> — ${escapeHtml(t("Drilling Fünfen = 500; alle vier Fünfen = 550; nur eine Fünf = 50."))}</li><li><code>1–1–1–5–5–2</code> — ${escapeHtml(t("Drei Einsen und zwei einzelne Fünfen = 1’100; danach ist ein Bestätigungswurf nötig."))}</li><li><code>1–2–3–4–5–6</code> — ${escapeHtml(t("Straße, 2’000 Punkte, Hot Dice und Bestätigungswurf."))}</li><li><code>2–2–3–4–6–6</code> — ${escapeHtml(t("500 für nichts: alle Würfel werden wieder frei, der Zug läuft weiter."))}</li></ul></section>`;
}

async function renderRules() {
  if (!content) return;
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
    return `<span class="zilch-notebook-entry__change">+${number(entry.points)}:</span> <strong>${total}<span class="zilch-notebook-entry__unit"> ${escapeHtml(t("Punkte"))}</span></strong>`;
  }
  if (event === "zilch") {
    const penalty = Number(entry.penalty || 0);
    const change = penalty ? `−${number(penalty)}` : "+0";
    return `<span class="zilch-notebook-entry__change">${change}:</span> <strong>${total}<span class="zilch-notebook-entry__unit"> ${escapeHtml(t("Punkte"))}</span></strong> <em>(${escapeHtml(t("Zilch"))})</em>`;
  }
  return `${escapeHtml(t("Runde"))} ${number(entry.round)}`;
}

function activeNotebookPlayerId(snapshot) {
  const boards = snapshot?._zilch_boards || {};
  const active = Object.entries(boards).find(([_playerId, board]) => Boolean(board?.active));
  return String(active?.[0] || snapshot?._turn?.player_id || "");
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

function scoreNotebook(players, boards, { solo = false, target = 10000, transition = null } = {}) {
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
    const active = Boolean(board.active);
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
      <header><h2>${playerName(player)} ${participantMeta(player, { compact: true })}</h2><span class="zilch-notebook-total"><span class="visually-hidden">${escapeHtml(t("Stand"))}: </span>${escapeHtml(scoreTotal)}</span></header>
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
        <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
      </section>
      ${resultSummary(result)}
      <section class="zilch-board-grid zilch-result-board-grid${solo ? " zilch-result-board-grid--solo" : ""}" aria-label="${escapeHtml(t("Zilch-Ergebnisboards"))}">${participants.map(player => resultBoardCard(result, player)).join("") || `<p class="zilch-muted">${escapeHtml(t("Keine Teilnehmerdaten verfügbar"))}</p>`}</section>
      ${resultStartRollCard(result)}
      ${resultFinalRoundCard(result)}`;
  } catch (_) {
    // The server intentionally answers private result access with an opaque
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
  const stateLabel = !value
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
  const dice = Array.isArray(snapshot._dice) ? snapshot._dice.slice(0, 6) : [0, 0, 0, 0, 0, 0];
  while (dice.length < 6) dice.push(0);
  const rolling = state.pendingAction === "zilch_roll_dice";
  const landing = state.diceLandingPending;
  return `<div class="zilch-dice${rolling ? " is-rolling" : ""}${landing ? " is-landing" : ""}" aria-label="${escapeHtml(t("Sechs Würfel"))}" aria-busy="${rolling ? "true" : "false"}">${dice.map((die, index) => {
    const label = dieDescription(index, die, turnState, quickHolds);
    const held = Array.isArray(turnState?.held_dice_indices) && turnState.held_dice_indices.includes(index);
    const scoreable = quickHolds.some(option => Array.isArray(option.dice_indices) && option.dice_indices.includes(index));
    const selectable = Boolean(isMyTurn && turnState?.can_select_hold && die && !held && scoreable && !snapshot._paused && !snapshot._finished && !state.pendingAction);
    const classes = `zilch-die ${dieState(index, die, turnState, quickHolds)}${state.pendingAction ? " zilch-die--pending" : ""}`;
    const face = diePips(die, index);
    return selectable
      ? `<button type="button" class="${classes}" style="--die-index:${index}" data-zilch-die-index="${index}" aria-pressed="${draftHoldIndices(turnState).includes(index) ? "true" : "false"}" aria-label="${escapeHtml(label)}">${face}</button>`
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
  return optionTitle(option).replace(/\s*·\s*[+−-]?[\d'’.,\s]+$/, "").trim();
}

function orderedQuickHolds(options) {
  return [...options].sort((first, second) => (
    Number(Boolean(second.all_available_dice)) - Number(Boolean(first.all_available_dice))
    || Number(Boolean(second.hot_dice)) - Number(Boolean(first.hot_dice))
    || Number(second.points || 0) - Number(first.points || 0)
  ));
}

function recommendationOptions(snapshot, options, draft) {
  const dice = Array.isArray(snapshot?._dice) ? snapshot._dice : [];
  const unique = [];
  const signatures = new Set();
  const source = options.filter(option => optionMatchesDraft(option, draft));
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
  return unique.slice(0, 3);
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
  return `<ol class="zilch-recommendations__list">${recommendationOptions(snapshot, orderedQuickHolds(options), draft).map(option => {
    const selected = sameIndices(option.dice_indices, draft);
    const hotDice = Boolean(option.hot_dice);
    const label = hotDice ? t("Hot Dice") : compactOptionTitle(option);
    return `<li><button type="button" class="zilch-recommendation${selected ? " is-selected" : ""}${hotDice ? " is-hot" : ""}" data-zilch-recommendation="${escapeHtml(option.id)}" ${selectable ? "" : "disabled"} aria-pressed="${selected ? "true" : "false"}">
      <strong>${selected ? "✓ " : ""}+${number(option.points)}</strong><span>${escapeHtml(label)}</span>
    </button></li>`;
  }).join("")}</ol>`;
}

function waitingRoomPanel(snapshot) {
  if (isSoloGame(snapshot)) return "";
  if (snapshot?._started || snapshot?._finished) return "";
  const participants = snapshotParticipants(snapshot);
  const expected = Number(snapshot?._expected_participants || snapshot?._expected || 2);
  const playerRows = participants.map(player => `<li><span>${playerName(player)} ${participantMeta(player, { compact: true })}</span><strong>${escapeHtml(participantStatusLabel(player))}</strong></li>`).join("");
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
    return `<li><span>${playerName(player)} ${participantMeta(player, { compact: true })}</span><strong>${escapeHtml(result)}</strong></li>`;
  }).join("");
  const priorTie = start.tied ? `<p class="zilch-event zilch-event--zilch">${escapeHtml(t("Gleichstand beim Startwurf – beide würfeln erneut."))}</p>` : "";
  return `<section class="zilch-card zilch-start-roll" aria-labelledby="zilchStartRollTitle">
      <p class="eyebrow">${escapeHtml(t("Startwurf"))}</p>
      <h2 id="zilchStartRollTitle">${escapeHtml(t("Wer höher würfelt, beginnt."))}</h2>
      <p>${escapeHtml(t("Beide würfeln einmal. Bei Gleichstand wird wiederholt."))}</p>
      ${priorTie}
      <ol class="zilch-start-rolls">${attemptRows}</ol>
      <button type="button" data-zilch-start-roll ${disabled ? "disabled" : ""}>${escapeHtml(humanTurn ? t("Startwurf ausführen") : cpuPending ? t("CPU würfelt für den Start …") : t("Warte auf den anderen Startwurf"))}</button>
  </section>`;
}

function finalResultActions(resultLink) {
  if (state.awardPresentationActive) {
    return `<p class="zilch-award-finalization-note" role="status">${escapeHtml(t("Neue Zilch-Awards werden vorbereitet. Danach kannst du das Ergebnis öffnen."))}</p>`;
  }
  return `<div class="zilch-actions"><button type="button" class="zilch-lobby-action" data-zilch-new-round>${escapeHtml(t("Neue Runde"))}</button>${resultLink}<a class="button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a></div>`;
}

function finalResult(snapshot) {
  const outcome = snapshot._zilch_outcome;
  if (!snapshot._finished || !outcome) return "";
  if (isSoloGame(snapshot)) {
    const completed = soloOutcomeStatus(snapshot) === "completed";
    const detail = completed
      ? t("Du hast das Solo-Ziel erreicht. Dein Ergebnis wird privat gespeichert.")
      : t("Dieser Solo-Lauf wurde aufgegeben. Dein Ergebnis bleibt privat in deiner Zilch-Historie.");
    const candidateResultRoute = snapshot?._zilch_result?.route || snapshot?._zilch_result?.result_route || snapshot?._zilch_result?.result_url;
    const resultRoute = typeof candidateResultRoute === "string" && /^\/zilch\/ergebnis\/[^/?#]+$/.test(candidateResultRoute)
      ? candidateResultRoute
      : null;
    const resultLink = resultRoute
      ? `<a class="button-link" href="${escapeHtml(resultRoute)}">${escapeHtml(t("Ergebnis ansehen"))}</a>`
      : "";
    return `<section class="zilch-card zilch-final-result zilch-final-result--solo" role="status"><p class="eyebrow">${escapeHtml(t("Solo-Ergebnis"))}</p><h2>${escapeHtml(soloOutcomeLabel(snapshot))}</h2><p>${escapeHtml(detail)}</p>${finalResultActions(resultLink)}</section>`;
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
  const resultRoute = typeof candidateResultRoute === "string" && /^\/zilch\/ergebnis\/[^/?#]+$/.test(candidateResultRoute)
    ? candidateResultRoute
    : null;
  const resultLink = resultRoute
    ? `<a class="button-link" href="${escapeHtml(resultRoute)}">${escapeHtml(t("Ergebnis ansehen"))}</a>`
    : "";
  return `<section class="zilch-card zilch-final-result" role="status"><p class="eyebrow">${escapeHtml(t("Endstand"))}</p><h2>${escapeHtml(headline)}</h2><p>${detail}</p>${finalResultActions(resultLink)}</section>`;
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
        name: String(snapshot?._name || snapshot?.name || `Zilch · ${state.auth?.user?.username || "Mani"}`).slice(0, 80),
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
    rememberActiveGame(payload.game_id);
    window.location.assign(`/zilch/spiel/${encodeURIComponent(payload.game_id)}`);
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
    <button type="button" class="zilch-action-card zilch-action-card--roll" data-zilch-roll ${canRoll ? "" : "disabled"}>
      <strong>${escapeHtml(rollLabel)}</strong>
    </button>
    <button type="button" class="zilch-action-card zilch-action-card--bank" data-zilch-bank ${canBank ? "" : "disabled"}>
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
  const currentLabel = snapshot?._finished
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
  syncSoloAbandonControl(snapshot, turnState, isMyTurn);
  updateGameHeader(snapshot);
  const gameName = escapeHtml(snapshot._name || "Zilch");
  const target = Number(snapshot._target_score || 10000);
  const transition = state.notebookTransition;
  const recommendations = recommendationCards(snapshot, turnState, isMyTurn);
  const resultMarkup = finalResult(snapshot);
  const hasChoices = Boolean(recommendations || resultMarkup);
  const chatRows = (Array.isArray(snapshot._chat_history) ? snapshot._chat_history : []).map((entry) => (
    `<li><strong>${escapeHtml(entry.sender || t("Spieler"))}</strong><span>${escapeHtml(entry.text || "")}</span></li>`
  )).join("");
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
    <section class="zilch-play-layout${hasChoices ? " zilch-play-layout--has-choices" : " zilch-play-layout--no-choices"}${solo ? " zilch-play-layout--solo" : " zilch-play-layout--duel"}" aria-label="${escapeHtml(t("Zilch-Spielbereich"))}">
      <div class="zilch-play-layout__notebook">${scoreNotebook(players, boards, { solo, target, transition })}</div>
      ${hasChoices ? `<aside class="zilch-recommendations" aria-label="${escapeHtml(t("Mögliche Wertungen"))}">${recommendations}${resultMarkup}</aside>` : ""}
    </section>
    ${waitingRoomPanel(snapshot)}
    ${openingRollPanel(snapshot)}
    <section class="zilch-dice-dock">
      <section class="zilch-table" aria-labelledby="zilchDiceTitle">
        <h2 id="zilchDiceTitle" class="visually-hidden">${escapeHtml(t("Sechs Würfel"))}</h2>
        ${diceRack(snapshot, turnState, quickHolds, isMyTurn)}
        ${actionCards(snapshot, turnState, quickHolds, isMyTurn)}
      </section>
    </section>
    <section class="zilch-chat${state.chatOpen ? " is-open" : ""}">
      <div class="zilch-chat__bar"><button type="button" class="zilch-chat__toggle" data-zilch-chat-toggle aria-expanded="${state.chatOpen ? "true" : "false"}">${escapeHtml(t("Chat"))}<span class="zilch-chat__toggle-icon" aria-hidden="true">⌃</span></button><div id="zilchChatReactionsBar" class="zilch-chat-reactions-host" aria-label="${escapeHtml(t("Schnellreaktionen"))}"></div></div>
      <div class="zilch-chat__content"><ul id="zilchChatHistory" class="zilch-chat-history">${chatRows || `<li class="zilch-muted">${escapeHtml(t("Noch keine Nachrichten"))}</li>`}</ul><form id="zilchChatForm" class="zilch-chat-form"><label class="visually-hidden" for="zilchChatInput">${escapeHtml(t("Nachricht"))}</label><input id="zilchChatInput" maxlength="400" placeholder="${escapeHtml(t("Nachricht eingeben …"))}"><button type="submit" class="secondary">${escapeHtml(t("Senden"))}</button></form></div>
    </section>`;
  wireGameInteractions(snapshot, turnState, quickHolds);
  mountZilchEmojiToolbar(snapshot);
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
    document.getElementById("zilchLogout")?.before(button);
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

async function confirmSoloAbandon(snapshot, turnState) {
  if (state.confirmingSoloAbandon || state.pendingAction || !isSoloGame(snapshot)) return;
  if (!snapshot?._zilch_can_abandon || !localPlayerIs(snapshot, snapshot?._turn?.player_id) || snapshot?._finished || snapshot?._paused) return;
  state.confirmingSoloAbandon = true;
  let restoreFocus = false;
  renderGameState();
  try {
    const confirmation = {
      title: t("Solo-Lauf aufgeben?"),
      message: t("Möchtest du diesen Solo-Lauf wirklich aufgeben? Der bisherige Verlauf wird als privates Ergebnis gespeichert."),
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
    if (!localPlayerIs(snapshot, snapshot?._turn?.player_id)) return;
    const selectedOption = exactOptionForDraft(quickHolds, draftHoldIndices(turnState));
    if (turnState?.can_select_hold && (!selectedOption || !optionAllows(selectedOption, "zilch_roll_dice"))) return;
    requestAction("zilch_roll_dice", {
      turn_id: turnState?.turn_id,
      version: turnState?.version,
      ...(turnState?.can_select_hold ? optionActionPayload(selectedOption) : {}),
    }, { optionId: selectedOption?.id || null });
  });
  document.querySelector("[data-zilch-bank]")?.addEventListener("click", () => {
    if (!localPlayerIs(snapshot, snapshot?._turn?.player_id)) return;
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
      if (!localPlayerIs(snapshot, snapshot?._turn?.player_id) || state.pendingAction) return;
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
      if (!option || !localPlayerIs(snapshot, snapshot?._turn?.player_id) || state.pendingAction) return;
      const draft = draftHoldIndices(turnState);
      if (!optionMatchesDraft(option, draft)) return;
      setDraftHoldIndices(turnState, sameIndices(option.dice_indices, draft) ? [] : option.dice_indices);
      renderGameState();
    });
  }
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

function messageForEvent(snapshot, event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "cpu_unavailable") {
    return cpuReasonText(event, t("CPU-Spiel kann nicht fortgesetzt werden."));
  }
  const cpuText = cpuEventText(snapshot, event);
  if (cpuText) return cpuText;
  if (event.type === "hold" && event.option?.hot_dice) return t("Hot Dice – alle sechs Würfel werden erneut frei.");
  if (event.type === "zilch" && Number(event.penalty || 0)) return t("Dritter Zilch – 500 Punkte Abzug.");
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
      socket.send(JSON.stringify({ action: "join_game", pass: state.gamePassphrase }));
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
      if (previousActivePlayerId && nextActivePlayerId && !sameId(previousActivePlayerId, nextActivePlayerId)) {
        state.notebookTransition = { from: previousActivePlayerId, to: nextActivePlayerId };
      }
      if (state.pendingAction === "zilch_roll_dice") state.diceLandingPending = true;
      const previousDraftKey = state.game ? holdDraftKey(state.game?._zilch_turn_state) : "";
      state.game = payload.scoreboard;
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
      renderSocketError(t(payload.error));
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
  document.getElementById("zilchLogout")?.addEventListener("click", async () => {
    try { await logout(); } finally { window.location.replace("/"); }
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
  if (!gameId && !playerAchievementsUsername) void presentPendingZilchAwards({ scope: "page" });
}

window.addEventListener("beforeunload", () => {
  state.stopped = true;
  window.clearTimeout(state.reconnectTimer);
  state.socket?.close();
});

window.addEventListener("online", () => {
  if (gameId && !state.stopped && (!state.socket || state.socket.readyState === WebSocket.CLOSED)) connectGameSocket();
});

void initialize();
