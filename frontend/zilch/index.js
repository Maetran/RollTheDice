import { apiFetch, escapeHtml, loadAuth, logout } from "../shared/auth.js";
import { initializeAppMode } from "../multigame/app-mode.js";

const root = document.querySelector("[data-zilch-root]");
const content = document.getElementById("zilchContent");
const liveAnnouncements = document.getElementById("zilchLiveAnnouncements");
const gameIdMatch = window.location.pathname.match(/^\/zilch\/spiel\/([^/]+)$/);
const resultIdMatch = window.location.pathname.match(/^\/zilch\/ergebnis\/([^/]+)$/);
const gameId = gameIdMatch ? decodeURIComponent(gameIdMatch[1]) : null;
const resultId = resultIdMatch ? decodeURIComponent(resultIdMatch[1]) : null;
const historyRoute = window.location.pathname === "/zilch/historie";
const rulesRoute = window.location.pathname === "/zilch/regeln";
const ZILCH_ACTIVE_GAME_STORAGE_KEY = "zilch_active_game_id";
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
  status: null,
  statusKind: "info",
  activeGameId: gameId || "",
  gamePassphrase: "",
  navigationOpen: false,
  navigationBound: false,
  rules: null,
};

function t(value) {
  return window.ZDWA_I18N?.t?.(value) || String(value || "");
}

function message(key, params = {}) {
  return window.ZDWA_I18N?.message?.(key, params) || t(key);
}

function sameId(first, second) {
  return String(first || "") === String(second || "");
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

function playerForId(snapshot, playerId) {
  return (snapshot?._players || []).find(player => sameId(player.id, playerId));
}

function localPlayerIs(snapshot, playerId) {
  return Boolean(state.playerId && sameId(state.playerId, playerId) && playerForId(snapshot, playerId));
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
    ? `<span class="zilch-account">${escapeHtml(username)} <span class="zilch-preview-badge">${escapeHtml(t("Intern"))}</span></span>`
    : "";
  root?.classList.remove("zilch-loading");
  const accountSlot = document.getElementById("zilchAccount");
  if (accountSlot) accountSlot.innerHTML = account;
  renderNavigation();
}

function routeKind() {
  if (gameId) return "game";
  if (resultId) return "result";
  if (historyRoute) return "history";
  if (rulesRoute) return "rules";
  return "lobby";
}

function mobileNavigation() {
  return window.matchMedia?.("(max-width: 760px)").matches === true;
}

function closeNavigation({ restoreFocus = false } = {}) {
  if (!state.navigationOpen) return;
  state.navigationOpen = false;
  renderNavigation();
  if (restoreFocus) document.getElementById("zilchNavToggle")?.focus();
}

function renderNavigation() {
  const navigation = document.getElementById("zilchNavigation");
  const toggle = document.getElementById("zilchNavToggle");
  if (!navigation || !toggle) return;
  const activeGame = state.activeGameId || rememberedActiveGameId();
  const current = routeKind();
  const entries = [
    { key: "lobby", href: "/zilch", label: t("Lobby") },
    ...(activeGame ? [{
      key: "game",
      href: `/zilch/spiel/${encodeURIComponent(activeGame)}`,
      label: t("Zurück zum Spiel"),
    }] : []),
    { key: "history", href: "/zilch/historie", label: t("Abgeschlossene Spiele") },
    { key: "rules", href: "/zilch/regeln", label: t("Regeln") },
    {
      key: "account",
      href: "/konto?return_to=zilch#settings",
      label: t("Konto & Einstellungen"),
    },
  ];
  navigation.innerHTML = `<ul class="zilch-nav-list">${entries.map(entry => `<li><a href="${escapeHtml(entry.href)}"${entry.key === current ? ' aria-current="page"' : ""}>${escapeHtml(entry.label)}</a></li>`).join("")}</ul>`;
  const compact = mobileNavigation();
  toggle.hidden = !compact;
  toggle.setAttribute("aria-expanded", String(compact && state.navigationOpen));
  navigation.hidden = compact && !state.navigationOpen;
  if (!state.navigationBound) {
    state.navigationBound = true;
    toggle.addEventListener("click", () => {
      state.navigationOpen = !state.navigationOpen;
      renderNavigation();
    });
    navigation.addEventListener("click", event => {
      if (event.target instanceof HTMLAnchorElement) closeNavigation();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && state.navigationOpen) {
        event.preventDefault();
        closeNavigation({ restoreFocus: true });
      }
    });
    window.addEventListener("resize", () => {
      if (!mobileNavigation()) state.navigationOpen = false;
      renderNavigation();
    });
  }
}

function renderNotice(messageText, { kind = "info" } = {}) {
  if (!content) return;
  content.innerHTML = `<section class="zilch-card zilch-notice zilch-notice--${escapeHtml(kind)}" role="status"><p>${escapeHtml(t(messageText))}</p></section>`;
}

function gameStatus(game) {
  if (game.finished) return t("Beendet");
  if (game.paused) return t("Pausiert");
  if (game.started) return t("Läuft");
  return t("Wartet auf Mitspieler");
}

function gameStatusKind(game) {
  if (game?.finished) return "finished";
  if (game?.paused) return "paused";
  if (game?.started) return "running";
  return "waiting";
}

function lobbyPlayerRows(game) {
  const statuses = Array.isArray(game?.player_statuses) ? game.player_statuses : [];
  if (!statuses.length) return `<span class="zilch-muted">${escapeHtml(t("Noch keine Spieler"))}</span>`;
  return statuses.map(player => {
    const online = Boolean(player?.connected);
    return `<span class="zilch-player-chip${online ? "" : " zilch-player-chip--offline"}"><span class="zilch-connection-dot" aria-hidden="true"></span>${escapeHtml(player?.name || t("Spieler"))}<span class="visually-hidden"> ${escapeHtml(online ? t("Online") : t("Offline"))}</span></span>`;
  }).join("");
}

function gamePoints(game) {
  const progress = Array.isArray(game?.progress) ? game.progress : [];
  if (!progress.length) return "";
  return progress.map(player => `${player?.name || t("Spieler")}: ${number(player?.points)}`).join(" · ");
}

function lobbyTurnText(game) {
  const currentId = String(game?.current_player_id || "");
  const player = (Array.isArray(game?.player_statuses) ? game.player_statuses : [])
    .find(candidate => sameId(candidate?.id, currentId));
  const finalRound = game?.final_round && typeof game.final_round === "object" ? game.final_round : null;
  if (finalRound?.pending_player_ids?.length) return t("Schlussrunde: Gegenzug offen");
  if (finalRound?.triggered_by) return t("Schlussrunde läuft");
  if (player?.name) return `${player.name} ${t("ist am Zug.")}`;
  if (game?.paused) return t("Spiel pausiert");
  return "";
}

function gameCard(game, { running = false } = {}) {
  const joined = Number(game.players || 0);
  const expected = Number(game.expected || 2);
  const mine = Boolean(game.my_player_id);
  const action = mine ? (running ? t("Zurück zum Spiel") : t("Wartesaal öffnen")) : t("Beitreten");
  const detail = lobbyTurnText(game);
  const points = gamePoints(game);
  const lock = game.locked ? `<span class="zilch-board-marker zilch-lock-label">${escapeHtml(t("Geschützter Raum"))}</span>` : "";
  const pause = game.paused
    ? `<p class="zilch-game-card__notice">${escapeHtml(Array.isArray(game.offline) && game.offline.length ? t("Ein Teilnehmer ist offline") : t("Spiel pausiert"))}</p>`
    : "";
  return `<article class="zilch-game-card${running ? " zilch-game-card--running" : ""}">
    <div>
      <div class="zilch-card-title"><h3>${escapeHtml(game.name || "Zilch")}</h3><span class="zilch-status-pill" data-status="${gameStatusKind(game)}">${escapeHtml(gameStatus(game))}</span>${lock}</div>
      <p>${escapeHtml(t("Teilnehmer"))}: <strong>${joined}/${expected}</strong></p>
      <p class="zilch-game-card__players">${lobbyPlayerRows(game)}</p>
      ${detail ? `<p class="zilch-game-card__turn">${escapeHtml(detail)}</p>` : ""}
      ${points ? `<p class="zilch-game-card__points">${escapeHtml(t("Punktestand"))}: <strong>${escapeHtml(points)}</strong></p>` : ""}
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
  const participants = resultParticipants(result);
  const scores = participants.map(player => {
    const board = resultBoardFor(result, player);
    return `${resultPlayerName(player)} ${resultTotalFor(result, player, board)}`;
  }).join(" · ");
  const name = String(result?.game_name || result?.name || "Zilch");
  return `<article class="zilch-result-history-card">
    <div>
      <p class="eyebrow">${escapeHtml(t("Abgeschlossene Partie"))}</p>
      <h3>${escapeHtml(name)}</h3>
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

async function renderLobby() {
  if (!content) return;
  content.innerHTML = `<section class="zilch-intro zilch-intro--alpha">
      <p class="eyebrow">${escapeHtml(t("Interne Vorschau"))}</p>
      <h1>${escapeHtml(t("Dein Zilch-Tisch"))}</h1>
      <p>${escapeHtml(t("Spiele Zilch privat zu zweit: sechs Würfel, serverseitige Quick Holds und ein Ziel von 10’000 Punkten."))}</p>
    </section>
    <section class="zilch-card zilch-create-card">
      <p class="eyebrow">${escapeHtml(t("Neue Zilch-Partie"))}</p>
      <h2>${escapeHtml(t("Zilch erstellen"))}</h2>
      <form id="zilchCreateForm" class="zilch-create-form">
        <label><span>${escapeHtml(t("Name der Partie"))}</span><input id="zilchGameName" maxlength="80" required value="${escapeHtml(`Zilch · ${state.auth?.user?.username || "Mani"}`)}"></label>
        <label><span>${escapeHtml(t("Raumcode (optional)"))}</span><input id="zilchGamePassphrase" type="password" maxlength="100" autocomplete="new-password" placeholder="${escapeHtml(t("Nur zum privaten Beitritt"))}"></label>
        <div class="zilch-player-count"><span>${escapeHtml(t("Spielmodus"))}</span><strong>${escapeHtml(t("2 Menschen"))}</strong></div>
        <button type="submit">${escapeHtml(t("Partie erstellen"))}</button>
      </form>
      <p class="zilch-muted">${escapeHtml(t("Solo und CPU folgen später. Diese Vorschau unterstützt ausschließlich zwei angemeldete Menschen."))}</p>
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
    <section class="zilch-card zilch-results-history" aria-labelledby="zilchHistoryTitle">
      <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Private Historie"))}</p><h2 id="zilchHistoryTitle">${escapeHtml(t("Deine abgeschlossenen Zilch-Partien"))}</h2></div><a class="small ghost button-link" href="/zilch/historie">${escapeHtml(t("Alle ansehen"))}</a></div>
      <div id="zilchResultsHistory" class="zilch-result-history-list" aria-live="polite">${escapeHtml(t("Zilch-Historie wird geladen …"))}</div>
    </section>
    <section class="zilch-card zilch-alpha-note">
      <h2>${escapeHtml(t("Human-vs-Human-Alpha"))}</h2>
      <p>${escapeHtml(t("Quick Holds, Würfel und Punkte werden ausschließlich auf dem Server geprüft. Zilch-Partien bleiben von ZDWA-Statistiken, Erfolgen und Bestenlisten getrennt."))}</p>
    </section>`;

  const runningSlot = document.getElementById("zilchRunningGames");
  const waitingSlot = document.getElementById("zilchWaitingGames");
  const resultsSlot = document.getElementById("zilchResultsHistory");
  const refreshGames = async () => {
    try {
      const games = await fetchZilchGames();
      const alphaGames = games.filter(game => String(game.mode) === "2" && !game.finished && !game.aborted);
      const runningGames = alphaGames.filter(game => game.started && game.my_player_id);
      const waitingGames = alphaGames.filter(game => !game.started);
      const active = runningGames[0] || waitingGames.find(game => game.my_player_id);
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
  const refreshResults = async () => {
    if (!resultsSlot) return;
    try {
      const results = await fetchZilchResults();
      resultsSlot.innerHTML = results.length
        ? results.slice(0, 3).map(resultHistoryCard).join("")
        : `<p class="zilch-muted">${escapeHtml(t("Noch keine abgeschlossenen Zilch-Partien"))}</p>`;
    } catch (_) {
      // A history request is intentionally optional for the active lobby. A
      // private endpoint may be unavailable while an older server is running.
      resultsSlot.innerHTML = `<p class="zilch-muted">${escapeHtml(t("Zilch-Historie ist derzeit nicht verfügbar."))}</p>`;
    }
  };
  document.getElementById("zilchRefresh")?.addEventListener("click", () => {
    void refreshGames();
    void refreshResults();
  });
  document.getElementById("zilchCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorSlot = document.getElementById("zilchCreateError");
    if (errorSlot) errorSlot.textContent = "";
    const name = document.getElementById("zilchGameName")?.value?.trim() || "Zilch";
    const passphrase = document.getElementById("zilchGamePassphrase")?.value || "";
    const submit = event.currentTarget?.querySelector("button[type='submit']");
    if (submit) submit.disabled = true;
    try {
      const response = await apiFetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode: "2", game_type: "zilch", pass: passphrase }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.game_id) throw new Error(payload.detail || "zilch_create_failed");
      if (passphrase) {
        try { sessionStorage.setItem(`zilch_pass_${payload.game_id}`, passphrase); } catch (_) {}
      }
      rememberActiveGame(payload.game_id);
      window.location.assign(`/zilch/spiel/${encodeURIComponent(payload.game_id)}`);
    } catch (_) {
      if (errorSlot) errorSlot.textContent = t("Zilch-Partie konnte nicht erstellt werden.");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  await refreshGames();
  await refreshResults();
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
  const ruleset = String(facts?.ruleset || t("Nicht verfügbar"));
  return `<section class="zilch-game-head zilch-rules-head">
      <div><p class="eyebrow">${escapeHtml(t("Private Hilfe"))}</p><h1>${escapeHtml(t("Zilch-Regeln"))}</h1><p>${escapeHtml(t("Diese Kurzfassung folgt dem verbindlichen serverseitigen Regelvertrag."))}</p></div>
      <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
    </section>
    <section class="zilch-card zilch-rules-overview" data-zilch-ruleset="${escapeHtml(ruleset)}">
      <h2>${escapeHtml(t("Ziel der Partie"))}</h2>
      <p>${escapeHtml(t("Sichere Punkte, bis mindestens das Ziel erreicht ist. Danach erhält der andere Teilnehmer einen vollständigen Gegenzug."))}</p>
      <dl class="zilch-rule-facts">
        <div><dt>${escapeHtml(t("Regelset"))}</dt><dd>${escapeHtml(ruleset)}</dd></div>
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
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Halten und Quick Holds"))}</h2><p>${escapeHtml(t("Wähle mindestens eine serverseitig geprüfte Quick-Hold-Karte. Gehaltene Würfel bleiben gehalten; du kannst sie nicht zurücknehmen."))}</p><p>${escapeHtml(t("Du darfst wertende Teile frei wählen: Bei vier Fünfen sind etwa nur eine Fünf oder ein Drilling plus eine Fünf möglich."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Würfeln oder sichern"))}</h2><p>${escapeHtml(t("Nach dem dritten Wurf müssen mindestens 300 Rundenpunkte gehalten sein. Sichern ist ab 400 Punkten möglich, solange kein Bestätigungswurf offen ist."))}</p><p>${escapeHtml(t("Quick Holds und Punktwerte werden immer auf dem Server geprüft; der Browser entscheidet nie über die Wertung."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Hot Dice und Bestätigungswurf"))}</h2><p>${escapeHtml(t("Wenn alle sechs Würfel Punkte geben, werden sie wieder frei: Hot Dice. Die Rundenpunkte bleiben bestehen."))}</p><p>${escapeHtml(t("Nach drei Einsen oder einem vollständigen Hold muss ein weiterer Punktewurf von mindestens 50 Punkten bestätigt werden, bevor du sichern darfst."))}</p></section>
      <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Zilch-Serie"))}</h2><p>${escapeHtml(t("Ein Wurf ohne gültige Wertung – oder eine nicht erreichbare 300er-Regel nach Wurf drei – beendet den Zug als Zilch. Ungesicherte Punkte verfallen."))}</p><p>${escapeHtml(t("Beim Übergang vom zweiten zum dritten Zilch in Folge werden einmalig 500 Punkte abgezogen, niemals unter null."))}</p></section>
    </section>
    <section class="zilch-card zilch-rules-section"><h2>${escapeHtml(t("Start und Spielende"))}</h2><ol class="zilch-rule-steps"><li>${escapeHtml(t("Beide Teilnehmer würfeln zu Beginn einmal serverseitig. Der höhere Wurf beginnt; Gleichstände werden wiederholt."))}</li><li>${escapeHtml(t("Erreicht ein Teilnehmer mindestens das Ziel, beginnt die Schlussrunde."))}</li><li>${escapeHtml(t("Der andere Teilnehmer spielt einen vollständigen normalen Gegenzug."))}</li><li>${escapeHtml(t("Danach gewinnt der höchste Gesamtstand. Bei Gleichstand gibt es keinen Stechwurf."))}</li></ol><p class="zilch-muted">${escapeHtml(t("Manuelle Punkteingabe und manuelle Einzelwürfelauswahl sind nicht Teil dieser privaten Vorschau."))}</p></section>
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

function connectionLabel(player) {
  return player?.connected ? t("Online") : t("Offline");
}

function roundHistory(entry) {
  if (!entry || typeof entry !== "object") return "";
  const round = Number(entry.round || 0);
  if (entry.event === "bank") {
    return `${t("Runde")} ${round}: +${number(entry.points)} ${t("gesichert")}`;
  }
  if (entry.event === "zilch") {
    const penalty = Number(entry.penalty || 0);
    return penalty
      ? `${t("Runde")} ${round}: ${t("Zilch")} · −${number(penalty)}`
      : `${t("Runde")} ${round}: ${t("Zilch")}`;
  }
  return `${t("Runde")} ${round}`;
}

function boardCard(player, board) {
  const active = Boolean(board?.active);
  const offline = !board?.connected;
  const classes = ["zilch-board", active ? "zilch-board--active" : "", offline ? "zilch-board--offline" : ""].filter(Boolean).join(" ");
  const status = active ? `${t("Am Zug")} · ${connectionLabel(player)}` : connectionLabel(player);
  const history = Array.isArray(board?.rounds) ? board.rounds.slice(-4).reverse() : [];
  const finalMarkers = [
    board?.final_round_triggered_by ? `<span class="zilch-board-marker">${escapeHtml(t("Schlussrunde ausgelöst"))}</span>` : "",
    board?.final_reply_pending ? `<span class="zilch-board-marker">${escapeHtml(t("Gegenzug offen"))}</span>` : "",
  ].join("");
  return `<article class="${classes}" data-zilch-board-id="${escapeHtml(player.id)}">
    <header class="zilch-board-head"><div><h3>${playerName(player)}</h3><p><span class="zilch-connection-dot" aria-hidden="true"></span>${escapeHtml(status)}</p></div>${finalMarkers}</header>
    <dl>
      <div><dt>${escapeHtml(t("Gesamtpunkte"))}</dt><dd>${number(board?.total_points)}</dd></div>
      <div><dt>${escapeHtml(t("Rundenpunkte"))}</dt><dd>${number(board?.round_points)}</dd></div>
      <div><dt>${escapeHtml(t("Zilch-Serie"))}</dt><dd>${number(board?.zilch_streak)}</dd></div>
    </dl>
    <ol class="zilch-round-history" aria-label="${escapeHtml(t("Rundenhistorie"))}">${history.length ? history.map(entry => `<li>${escapeHtml(roundHistory(entry))}</li>`).join("") : `<li class="zilch-muted">${escapeHtml(t("Noch keine Runde abgeschlossen"))}</li>`}</ol>
  </article>`;
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
    <header class="zilch-board-head"><div><h3>${escapeHtml(playerNameValue)}</h3><p>${escapeHtml(t("Abgeschlossen"))}</p></div></header>
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
  if (resultIsTied(result)) return t("Gleichstand");
  const winnerIds = resultWinnerIds(result);
  const names = resultParticipants(result)
    .filter(player => winnerIds.some(id => sameId(id, resultPlayerId(player))))
    .map(resultPlayerName);
  return names.length ? `${names.join(", ")} ${t("gewinnt die Partie.")}` : t("Spiel beendet");
}

function resultSummary(result) {
  const ruleset = String(result?.ruleset || result?.rule_set || t("Nicht verfügbar"));
  return `<section class="zilch-card zilch-final-result zilch-result-summary" role="status" aria-labelledby="zilchResultTitle">
    <p class="eyebrow">${escapeHtml(t("Zilch-Ergebnis"))}</p>
    <h2 id="zilchResultTitle">${escapeHtml(resultHeadline(result))}</h2>
    <dl class="zilch-result-facts">
      <div><dt>${escapeHtml(t("Spiel-ID"))}</dt><dd><code>${escapeHtml(resultIdFor(result))}</code></dd></div>
      <div><dt>${escapeHtml(t("Regelset"))}</dt><dd>${escapeHtml(ruleset)}</dd></div>
      <div><dt>${escapeHtml(t("Beendet am"))}</dt><dd>${escapeHtml(formattedDateTime(result?.finished_at))}</dd></div>
      <div><dt>${escapeHtml(t("Spieldauer"))}</dt><dd>${escapeHtml(formattedDuration(result?.duration_seconds ?? result?.duration))}</dd></div>
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
    const gameName = String(result?.game_name || result?.name || "Zilch");
    document.title = `${gameName} – ${t("Zilch-Ergebnis")}`;
    content.innerHTML = `<section class="zilch-game-head zilch-result-head">
        <div><p class="eyebrow">${escapeHtml(t("Privater Ergebnisbericht"))}</p><h1>${escapeHtml(gameName)}</h1><p>${escapeHtml(t("Read-only Ergebnis einer privaten Zilch-Partie."))}</p></div>
        <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
      </section>
      ${resultSummary(result)}
      <section class="zilch-board-grid zilch-result-board-grid" aria-label="${escapeHtml(t("Zilch-Ergebnisboards"))}">${participants.map(player => resultBoardCard(result, player)).join("") || `<p class="zilch-muted">${escapeHtml(t("Keine Teilnehmerdaten verfügbar"))}</p>`}</section>
      ${resultStartRollCard(result)}
      ${resultFinalRoundCard(result)}`;
  } catch (_) {
    // The server intentionally answers private result access with an opaque
    // failure; preserve that non-disclosing behaviour in the view as well.
    renderNotice("Zilch-Ergebnis nicht verfügbar.", { kind: "error" });
  }
}

function diePips(value) {
  if (!value) return "<span class=\"zilch-die__dash\" aria-hidden=\"true\">—</span>";
  const positions = {
    1: ["middle"],
    2: ["top-left", "bottom-right"],
    3: ["top-left", "middle", "bottom-right"],
    4: ["top-left", "top-right", "bottom-left", "bottom-right"],
    5: ["top-left", "top-right", "middle", "bottom-left", "bottom-right"],
    6: ["top-left", "middle-left", "bottom-left", "top-right", "middle-right", "bottom-right"],
  };
  return (positions[value] || []).map(position => `<span class="zilch-pip zilch-pip--${position}" aria-hidden="true"></span>`).join("");
}

function dieState(index, value, turnState, quickHolds) {
  const held = Array.isArray(turnState?.held_dice_indices) && turnState.held_dice_indices.includes(index);
  const serverScoring = quickHolds.some(option => Array.isArray(option.dice_indices) && option.dice_indices.includes(index));
  const quickSelection = state.pendingOptionId
    && quickHolds.some(option => option.id === state.pendingOptionId && option.dice_indices?.includes(index));
  if (!value) return "zilch-die--unrolled";
  if (held) return "zilch-die--held zilch-die--unavailable";
  if (quickSelection) return "zilch-die--selected";
  if (turnState?.phase === "awaiting_hold" && !serverScoring) return "zilch-die--non-scoring";
  return "zilch-die--available";
}

function dieDescription(index, value, turnState, quickHolds) {
  const held = Array.isArray(turnState?.held_dice_indices) && turnState.held_dice_indices.includes(index);
  const pending = Boolean(
    state.pendingOptionId
    && quickHolds.some(option => option.id === state.pendingOptionId && option.dice_indices?.includes(index)),
  );
  const scoreable = quickHolds.some(option => Array.isArray(option.dice_indices) && option.dice_indices.includes(index));
  const stateLabel = !value
    ? t("Noch nicht gewürfelt")
    : held
      ? t("Verbindlich gehalten")
      : pending
        ? t("Quick Hold wird geprüft")
        : turnState?.phase === "awaiting_hold" && !scoreable
          ? t("Nicht wertend")
          : t("Verfügbar");
  const valueLabel = value ? `${t("zeigt")} ${value}` : t("Noch nicht gewürfelt");
  return `${t("Würfel")} ${index + 1}: ${valueLabel}. ${stateLabel}.`;
}

function diceRack(snapshot, turnState, quickHolds) {
  const dice = Array.isArray(snapshot._dice) ? snapshot._dice.slice(0, 6) : [0, 0, 0, 0, 0, 0];
  while (dice.length < 6) dice.push(0);
  return `<div class="zilch-dice" aria-label="${escapeHtml(t("Sechs Würfel"))}" aria-busy="${state.pendingAction ? "true" : "false"}">${dice.map((die, index) => {
    const label = dieDescription(index, die, turnState, quickHolds);
    // Dice remain descriptive rather than buttons until manual selection has
    // a real domain action. Quick Holds are the only actionable selection.
    return `<span class="zilch-die ${dieState(index, die, turnState, quickHolds)}${state.pendingAction ? " zilch-die--pending" : ""}" role="img" aria-label="${escapeHtml(label)}"><span class="zilch-die__face" data-value="${die || 0}">${diePips(die)}</span></span>`;
  }).join("")}</div>`;
}

function orderedQuickHolds(options) {
  // Presentation order only. The server still exposes every valid option and
  // remains authoritative for its score, selection and expiration.
  return [...options].sort((first, second) => (
    Number(Boolean(second.all_available_dice)) - Number(Boolean(first.all_available_dice))
    || Number(Boolean(second.hot_dice)) - Number(Boolean(first.hot_dice))
    || Number(second.dice_indices?.length || 0) - Number(first.dice_indices?.length || 0)
    || Number(second.points || 0) - Number(first.points || 0)
    || String(first.id || "").localeCompare(String(second.id || ""))
  ));
}

function optionDiceReference(option) {
  const indices = Array.isArray(option?.dice_indices) ? option.dice_indices : [];
  const values = Array.isArray(option?.dice_values) ? option.dice_values : [];
  if (!indices.length) return "";
  return indices.map((index, position) => {
    const value = values[position];
    return Number.isInteger(value) ? `${Number(index) + 1} (${value})` : String(Number(index) + 1);
  }).join(", ");
}

function quickHoldCards(snapshot, turnState, isMyTurn) {
  const options = Array.isArray(snapshot._zilch_quick_holds) ? snapshot._zilch_quick_holds : [];
  const selectable = Boolean(isMyTurn && turnState?.can_select_hold && !snapshot._paused && !snapshot._finished && !state.pendingAction);
  if (!options.length) {
    const explanation = turnState?.phase === "awaiting_hold"
      ? t("Dieser Wurf enthält keine gültige Quick-Hold-Auswahl.")
      : t("Nach einem Wurf erscheinen hier die serverseitigen Quick Holds.");
    return `<div class="zilch-quick-holds zilch-quick-holds--empty"><p class="zilch-muted">${escapeHtml(explanation)}</p></div>`;
  }
  return `<div class="zilch-quick-holds" aria-label="${escapeHtml(t("Quick Holds"))}">${orderedQuickHolds(options).map(option => {
    const title = message(option.label_key, { ...(option.label_params || {}), points: number(option.points) });
    const diceReference = optionDiceReference(option);
    const tags = [
      option.hot_dice ? `<span>${escapeHtml(t("Hot Dice"))}</span>` : "",
      option.requires_confirmation ? `<span>${escapeHtml(t("Bestätigungswurf"))}</span>` : "",
      option.free_roll ? `<span>${escapeHtml(t("Freier Wurf"))}</span>` : "",
    ].join("");
    const disabled = !selectable || state.pendingOptionId === option.id;
    const accessibleLabel = [title, diceReference ? `${t("Betroffene Würfel")}: ${diceReference}` : ""].filter(Boolean).join(". ");
    return `<button class="zilch-quick-hold${option.hot_dice ? " zilch-quick-hold--hot" : ""}" type="button" data-zilch-option="${escapeHtml(option.id)}" ${disabled ? "disabled" : ""} aria-label="${escapeHtml(accessibleLabel)}">
      <span class="zilch-quick-hold__title">${escapeHtml(title)}</span>
      <span class="zilch-quick-hold__points">${number(option.points)}</span>
      ${diceReference ? `<span class="zilch-quick-hold__dice">${escapeHtml(`${t("Würfel")}: ${diceReference}`)}</span>` : ""}
      <span class="zilch-quick-hold__tags">${tags}</span>
    </button>`;
  }).join("")}</div>`;
}

function waitingRoomPanel(snapshot) {
  if (snapshot?._started || snapshot?._finished) return "";
  const players = Array.isArray(snapshot?._players) ? snapshot._players : [];
  const expected = Number(snapshot?._expected || 2);
  const playerRows = players.map(player => `<li><span>${playerName(player)}</span><strong>${escapeHtml(connectionLabel(player))}</strong></li>`).join("");
  return `<section class="zilch-card zilch-start-roll" aria-labelledby="zilchWaitingRoomTitle">
    <p class="eyebrow">${escapeHtml(t("Wartesaal"))}</p>
    <h2 id="zilchWaitingRoomTitle">${escapeHtml(t("Bereit für den Startwurf"))}</h2>
    <p>${escapeHtml(players.length < expected
      ? t("Sobald zwei Teilnehmer beigetreten sind, wird der Startspieler mit einem serverseitigen Startwurf ermittelt.")
      : t("Beide Teilnehmer sind da. Der Startwurf wird vorbereitet."))}</p>
    <ol class="zilch-start-rolls">${playerRows || `<li class="zilch-muted">${escapeHtml(t("Noch keine Spieler"))}</li>`}</ol>
    <p class="zilch-muted">${escapeHtml(`${t("Teilnehmer")}: ${players.length}/${expected}`)}</p>
  </section>`;
}

function openingRollPanel(snapshot) {
  const start = snapshot._zilch_start_roll;
  if (!snapshot._started || !start) return "";
  const playerIds = Array.isArray(start.player_ids) ? start.player_ids : [];
  const pending = Array.isArray(start.pending_player_ids) ? start.pending_player_ids : [];
  const rolls = start.rolls || {};
  const resolved = start.phase === "resolved";
  const ownTurn = Boolean(state.playerId && pending.some(playerId => sameId(playerId, state.playerId)));
  const disabled = !ownTurn || snapshot._paused || Boolean(state.pendingAction);
  const attemptRows = playerIds.map(playerId => {
    const player = playerForId(snapshot, playerId);
    const rolled = Number(rolls[playerId] || 0);
    const result = rolled ? String(rolled) : t("wartet");
    return `<li><span>${playerName(player)}</span><strong>${escapeHtml(result)}</strong></li>`;
  }).join("");
  const priorTie = start.tied ? `<p class="zilch-event zilch-event--zilch">${escapeHtml(t("Gleichstand beim Startwurf – beide würfeln erneut."))}</p>` : "";
  const winner = resolved ? playerForId(snapshot, start.winner_id) : null;
  if (resolved) {
    return `<section class="zilch-card zilch-start-roll zilch-start-roll--resolved" aria-labelledby="zilchStartRollTitle">
      <p class="eyebrow">${escapeHtml(t("Startwurf"))}</p>
      <h2 id="zilchStartRollTitle">${escapeHtml(t("Startwurf abgeschlossen"))}</h2>
      <p>${escapeHtml(winner ? `${winner.name} ${t("beginnt die Partie.")}` : t("Der Startspieler steht fest."))}</p>
      <ol class="zilch-start-rolls">${attemptRows}</ol>
    </section>`;
  }
  return `<section class="zilch-card zilch-start-roll" aria-labelledby="zilchStartRollTitle">
      <p class="eyebrow">${escapeHtml(t("Startwurf"))}</p>
      <h2 id="zilchStartRollTitle">${escapeHtml(t("Wer höher würfelt, beginnt."))}</h2>
      <p>${escapeHtml(t("Beide Teilnehmer würfeln serverseitig einmal. Bei Gleichstand wird wiederholt."))}</p>
      ${priorTie}
      <ol class="zilch-start-rolls">${attemptRows}</ol>
      <button type="button" data-zilch-start-roll ${disabled ? "disabled" : ""}>${escapeHtml(ownTurn ? t("Startwurf ausführen") : t("Warte auf den anderen Startwurf"))}</button>
    </section>`;
}

function finalResult(snapshot) {
  const outcome = snapshot._zilch_outcome;
  if (!snapshot._finished || !outcome) return "";
  const winners = Array.isArray(outcome.winner_ids) ? outcome.winner_ids : [];
  const winnerNames = winners.map(playerId => playerName(playerForId(snapshot, playerId))).join(", ");
  const headline = outcome.tied ? t("Gleichstand") : t("Spiel beendet");
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
  return `<section class="zilch-card zilch-final-result" role="status"><p class="eyebrow">${escapeHtml(t("Endstand"))}</p><h2>${escapeHtml(headline)}</h2><p>${detail}</p><div class="zilch-actions">${resultLink}<a class="button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a></div></section>`;
}

function statusText(snapshot, turnState) {
  if (state.status) return state.status;
  if (snapshot._paused) {
    return Array.isArray(snapshot._offline_players) && snapshot._offline_players.length
      ? t("Ein Teilnehmer ist offline. Das Spiel ist pausiert, bis die Verbindung wiederhergestellt ist.")
      : t("Spiel pausiert");
  }
  if (snapshot._finished) return snapshot._zilch_outcome?.tied ? t("Gleichstand") : t("Spiel beendet");
  const start = snapshot._zilch_start_roll;
  if (!snapshot._started) return t("Wartet auf zweiten Teilnehmer");
  if (start?.phase === "awaiting_rolls") return t("Startspieler wird ermittelt.");
  if (turnState?.confirmation_required) return t("Bestätigungswurf erforderlich");
  if (turnState?.phase === "awaiting_hold") return t("Wähle eine Quick-Hold-Karte.");
  const current = playerForId(snapshot, snapshot?._turn?.player_id);
  return current ? `${current.name} ${t("ist am Zug.")}` : t("Spielstand wird aktualisiert.");
}

function eventBanner(snapshot) {
  const event = snapshot._zilch_last_event;
  if (!event || typeof event !== "object") return "";
  let text = "";
  let classes = "zilch-event";
  if (event.type === "hold" && event.option?.combination_type === "nothing_bonus") {
    text = t("500 für nichts – alle Würfel werden erneut frei.");
    classes += " zilch-event--hot";
  } else if (event.type === "hold" && event.option?.hot_dice) {
    text = t("Hot Dice – alle sechs Würfel werden erneut frei.");
    classes += " zilch-event--hot";
  } else if (event.type === "hold" && event.option?.requires_confirmation) {
    text = t("Bestätigungswurf erforderlich");
    classes += " zilch-event--confirmation";
  } else if (event.type === "zilch") {
    const penalty = Number(event.penalty || 0);
    text = penalty
      ? `${t("Dritter Zilch – 500 Punkte Abzug.")}`
      : event.reason?.startsWith("third_roll_")
        ? t("300-Punkte-Regel nicht erreichbar – Zilch.")
        : message("zilch.event.zilch");
    classes += " zilch-event--zilch";
  } else if (event.type === "bank" && event.final_round_started) {
    text = t("Punkte gesichert – die Schlussrunde beginnt.");
    classes += " zilch-event--final";
  } else if (event.type === "start_roll_tie") {
    text = message("zilch.event.start_roll_tie");
  } else if (event.type) {
    text = message(`zilch.event.${event.type}`);
  }
  // New events are announced through the dedicated live region. Keeping this
  // banner static prevents the same update from being read twice.
  return text ? `<p class="${classes}">${escapeHtml(text)}</p>` : "";
}

function bankBlockText(snapshot, turnState, isMyTurn) {
  if (state.pendingAction) return t("Aktion wird vom Server geprüft …");
  if (snapshot?._finished) return t("Die Partie ist beendet.");
  if (snapshot?._paused) return t("Das Spiel ist pausiert, solange ein Teilnehmer offline ist.");
  if (!isMyTurn) return message("zilch.error.zilch_not_your_turn");
  const reason = String(turnState?.bank_block_reason || "");
  if (reason) return message(`zilch.error.${reason}`);
  return t("Beendet deinen Zug sicher.");
}

function actionCards(snapshot, turnState, isMyTurn) {
  const blocked = Boolean(state.pendingAction || snapshot._paused || snapshot._finished || !isMyTurn);
  const canRoll = Boolean(!blocked && turnState?.can_roll);
  const canBank = Boolean(!blocked && turnState?.can_bank);
  const rollLabel = turnState?.confirmation_required
    ? t("Bestätigungswurf würfeln")
    : turnState?.rolls_used
      ? t("Weiterwürfeln")
      : t("Würfeln");
  const bankExplanation = canBank
    ? t("Beendet deinen Zug sicher.")
    : bankBlockText(snapshot, turnState, isMyTurn);
  return `<section class="zilch-action-cards" aria-label="${escapeHtml(t("Spielaktionen"))}">
    <button type="button" class="zilch-action-card zilch-action-card--roll" data-zilch-roll ${canRoll ? "" : "disabled"}>
      <span class="zilch-action-card__eyebrow">${escapeHtml(t("Risiko"))}</span><strong>${escapeHtml(rollLabel)}</strong><small>${escapeHtml(t("Der Server würfelt nur freie Würfel."))}</small>
    </button>
    <button type="button" class="zilch-action-card zilch-action-card--bank" data-zilch-bank ${canBank ? "" : "disabled"}>
      <span class="zilch-action-card__eyebrow">${escapeHtml(t("Sichern"))}</span><strong>${escapeHtml(t("Punkte sichern"))}</strong><small>${escapeHtml(canBank ? t("Beendet deinen Zug sicher.") : t("Siehe Sperrgrund unter den Aktionen."))}</small>
    </button>
  </section><p class="zilch-bank-reason"${canBank ? " hidden" : ""}>${escapeHtml(bankExplanation)}</p>`;
}

function scoreOverview(players, boards) {
  if (!players.length) return "";
  return `<section class="zilch-score-overview" aria-label="${escapeHtml(t("Kompakter Punktestand"))}">${players.map(player => {
    const board = boards?.[player.id] || {};
    const active = Boolean(board.active);
    return `<div${active ? ' class="is-active" aria-current="true"' : ""}><span>${playerName(player)}${active ? ` · ${escapeHtml(t("Am Zug"))}` : ""}</span><strong>${number(board.total_points)}</strong><small>${escapeHtml(`${t("Runde")}: ${number(board.round_points)}`)}</small></div>`;
  }).join("")}</section>`;
}

function reconnectControl() {
  if (!state.game || (state.socket && state.socket.readyState === WebSocket.OPEN)) return "";
  return `<button type="button" class="small ghost" data-zilch-reconnect>${escapeHtml(t("Jetzt erneut verbinden"))}</button>`;
}

function renderGameState() {
  if (!content) return;
  const snapshot = state.game;
  if (!snapshot) {
    renderNotice("Zilch-Spiel wird geladen …");
    return;
  }
  const players = Array.isArray(snapshot._players) ? snapshot._players : [];
  const boards = snapshot._zilch_boards || {};
  const turnState = snapshot._zilch_turn_state;
  const quickHolds = Array.isArray(snapshot._zilch_quick_holds) ? snapshot._zilch_quick_holds : [];
  const currentPlayerId = snapshot?._turn?.player_id;
  const isMyTurn = localPlayerIs(snapshot, currentPlayerId);
  const gameName = escapeHtml(snapshot._name || "Zilch");
  const target = number(snapshot._target_score || 10000);
  const chatRows = (Array.isArray(snapshot._chat_history) ? snapshot._chat_history : []).map((entry) => (
    `<li><strong>${escapeHtml(entry.sender || t("Spieler"))}</strong><span>${escapeHtml(entry.text || "")}</span></li>`
  )).join("");
  const offline = Array.isArray(snapshot._offline_players) && snapshot._offline_players.length
    ? `<p class="zilch-offline-note">${escapeHtml(t("Ein Teilnehmer ist offline. Das Spiel ist pausiert, bis die Verbindung wiederhergestellt ist."))}</p>`
    : "";
  content.innerHTML = `<section class="zilch-game-head">
      <div><p class="eyebrow">${escapeHtml(t("Zilch-Spielraum"))}</p><h1>${gameName}</h1><p>${escapeHtml(t("Ziel"))}: <strong>${target}</strong> ${escapeHtml(t("Punkte"))}</p></div>
      <a class="small ghost button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a>
    </section>
    <p id="zilchLiveStatus" class="zilch-live-status zilch-live-status--${escapeHtml(state.statusKind)}">${escapeHtml(statusText(snapshot, turnState))}</p>
    ${offline}
    ${reconnectControl()}
    ${scoreOverview(players, boards)}
    <section class="zilch-game-workspace" aria-label="${escapeHtml(t("Zilch-Spielbereich"))}">
      <section class="zilch-board-grid" aria-label="${escapeHtml(t("Zilch-Boards"))}">${players.map(player => boardCard(player, boards[player.id] || {})).join("")}</section>
      <div class="zilch-game-center">
        ${waitingRoomPanel(snapshot)}
        ${openingRollPanel(snapshot)}
        ${eventBanner(snapshot)}
        <section class="zilch-table" aria-labelledby="zilchDiceTitle">
          <div class="zilch-table__heading"><div><p class="eyebrow">${escapeHtml(t("Aktueller Wurf"))}</p><h2 id="zilchDiceTitle">${escapeHtml(t("Sechs Würfel"))}</h2></div><p>${escapeHtml(t("Die Werte kommen ausschließlich aus dem Server-Snapshot."))}</p></div>
          ${diceRack(snapshot, turnState, quickHolds)}
          ${actionCards(snapshot, turnState, isMyTurn)}
        </section>
        <section class="zilch-card zilch-quick-hold-card" aria-labelledby="zilchQuickHoldTitle">
          <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Auswahl"))}</p><h2 id="zilchQuickHoldTitle">${escapeHtml(t("Quick Holds"))}</h2></div><p class="zilch-muted">${escapeHtml(t("Wähle eine vom Server geprüfte Wertung."))}</p></div>
          ${quickHoldCards(snapshot, turnState, isMyTurn)}
        </section>
        ${finalResult(snapshot)}
      </div>
    </section>
    <section class="zilch-card zilch-chat">
      <h2>${escapeHtml(t("Chat"))}</h2>
      <ul id="zilchChatHistory" class="zilch-chat-history">${chatRows || `<li class="zilch-muted">${escapeHtml(t("Noch keine Nachrichten"))}</li>`}</ul>
      <form id="zilchChatForm" class="zilch-chat-form"><label class="visually-hidden" for="zilchChatInput">${escapeHtml(t("Nachricht"))}</label><input id="zilchChatInput" maxlength="400" placeholder="${escapeHtml(t("Nachricht eingeben …"))}"><button type="submit" class="secondary">${escapeHtml(t("Senden"))}</button></form>
    </section>`;
  wireGameInteractions(snapshot, turnState, quickHolds);
}

function requestAction(action, payload = {}, { optionId = null } = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || state.pendingAction) {
    updateStatus(t("Verbindung wird wiederhergestellt …"), "error");
    renderGameState();
    return;
  }
  state.pendingAction = action;
  state.pendingOptionId = optionId;
  updateStatus(t("Aktion wird vom Server geprüft …"));
  renderGameState();
  state.socket.send(JSON.stringify({ action, ...payload }));
}

function wireGameInteractions(snapshot, turnState, quickHolds) {
  document.querySelector("[data-zilch-reconnect]")?.addEventListener("click", () => {
    if (state.stopped) return;
    window.clearTimeout(state.reconnectTimer);
    connectGameSocket();
  });
  document.querySelector("[data-zilch-start-roll]")?.addEventListener("click", () => {
    const start = snapshot._zilch_start_roll;
    requestAction("zilch_start_roll", { start_roll_version: start?.version });
  });
  document.querySelector("[data-zilch-roll]")?.addEventListener("click", () => {
    requestAction("zilch_roll_dice", { turn_id: turnState?.turn_id, version: turnState?.version });
  });
  document.querySelector("[data-zilch-bank]")?.addEventListener("click", () => {
    requestAction("zilch_bank_points", { turn_id: turnState?.turn_id, version: turnState?.version });
  });
  for (const button of document.querySelectorAll("[data-zilch-option]")) {
    button.addEventListener("click", () => {
      const option = quickHolds.find(candidate => candidate.id === button.dataset.zilchOption);
      if (!option) return;
      requestAction("zilch_select_hold", {
        turn_id: turnState?.turn_id,
        version: turnState?.version,
        roll_id: option.roll_id,
        option_id: option.id,
        dice_indices: option.dice_indices,
        points: option.points,
        combination_type: option.combination_type,
      }, { optionId: option.id });
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

function messageForEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "hold" && event.option?.hot_dice) return t("Hot Dice – alle sechs Würfel werden erneut frei.");
  if (event.type === "zilch" && Number(event.penalty || 0)) return t("Dritter Zilch – 500 Punkte Abzug.");
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
      state.game = payload.scoreboard;
      if (payload.scoreboard._finished) clearRememberedActiveGame(gameId);
      state.pendingAction = null;
      state.pendingOptionId = null;
      const eventText = messageForEvent(payload.zilch_event || payload.scoreboard._zilch_last_event);
      updateStatus(eventText || null);
      renderGameState();
    }
    if (payload.chat && state.game) {
      const history = Array.isArray(state.game._chat_history) ? state.game._chat_history : [];
      state.game = { ...state.game, _chat_history: [...history, payload.chat].slice(-80) };
      renderGameState();
    }
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
    if (String(details.mode) !== "2") {
      renderNotice("Solo und CPU folgen später. Diese Alpha unterstützt ausschließlich zwei angemeldete Menschen.");
      return;
    }
    state.details = details;
    rememberActiveGame(gameId);
    const passphrase = await resolveGamePassphrase(details);
    if (passphrase === null) return;
    state.gamePassphrase = passphrase;
    const ownPlayer = (details.player_statuses || []).find(player => Number(player.user_id) === Number(state.auth?.user?.id));
    if (ownPlayer?.id) state.playerId = String(ownPlayer.id);
    connectGameSocket();
  } catch (_) {
    renderNotice("Zilch-Spiel konnte nicht geladen werden.", { kind: "error" });
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
  else if (historyRoute) await renderHistory();
  else if (rulesRoute) await renderRules();
  else await renderLobby();
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
