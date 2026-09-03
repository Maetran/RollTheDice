import { escapeHtml, loadAuth, logout } from "../shared/auth.js";
import { initializeAppMode } from "../multigame/app-mode.js";

const root = document.querySelector("[data-zilch-root]");
const content = document.getElementById("zilchContent");
const gameIdMatch = window.location.pathname.match(/^\/zilch\/spiel\/([^/]+)$/);
const gameId = gameIdMatch ? decodeURIComponent(gameIdMatch[1]) : null;
const state = {
  auth: null,
  details: null,
  game: null,
  socket: null,
  playerId: null,
  reconnectTimer: null,
  stopped: false,
  pendingAction: null,
  pendingOptionId: null,
  status: null,
  statusKind: "info",
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
  state.status = value ? String(value) : null;
  state.statusKind = kind;
}

function renderShell() {
  const username = state.auth?.user?.username || "";
  const account = username
    ? `<span class="zilch-account">${escapeHtml(username)} <span class="zilch-preview-badge">${escapeHtml(t("Intern"))}</span></span>`
    : "";
  root?.classList.remove("zilch-loading");
  const accountSlot = document.getElementById("zilchAccount");
  if (accountSlot) accountSlot.innerHTML = account;
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

function gameCard(game) {
  const joined = Number(game.players || 0);
  const expected = Number(game.expected || 2);
  const names = Array.isArray(game.waiting) && game.waiting.length
    ? game.waiting.map(name => escapeHtml(name)).join(", ")
    : escapeHtml(t("Noch keine Spieler"));
  const mine = Boolean(game.my_player_id);
  const action = mine ? t("Wieder beitreten") : game.started ? t("Öffnen") : t("Beitreten");
  return `<article class="zilch-game-card">
    <div>
      <div class="zilch-card-title"><h3>${escapeHtml(game.name || "Zilch")}</h3><span class="zilch-status-pill">${escapeHtml(gameStatus(game))}</span></div>
      <p>${escapeHtml(t("Teilnehmer"))}: <strong>${joined}/${expected}</strong></p>
      <p class="zilch-muted">${names}</p>
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

async function renderLobby() {
  if (!content) return;
  content.innerHTML = `<section class="zilch-intro zilch-intro--alpha">
      <p class="eyebrow">${escapeHtml(t("Interne Vorschau"))}</p>
      <h1>${escapeHtml(t("Zilch-Preview"))}</h1>
      <p>${escapeHtml(t("Spiele Zilch privat zu zweit: sechs Würfel, serverseitige Quick Holds und ein Ziel von 10’000 Punkten."))}</p>
    </section>
    <section class="zilch-card zilch-create-card">
      <p class="eyebrow">${escapeHtml(t("Neue Zilch-Partie"))}</p>
      <h2>${escapeHtml(t("Zilch erstellen"))}</h2>
      <form id="zilchCreateForm" class="zilch-create-form">
        <label><span>${escapeHtml(t("Name der Partie"))}</span><input id="zilchGameName" maxlength="80" required value="${escapeHtml(`Zilch · ${state.auth?.user?.username || "Mani"}`)}"></label>
        <div class="zilch-player-count"><span>${escapeHtml(t("Spielmodus"))}</span><strong>${escapeHtml(t("2 Menschen"))}</strong></div>
        <button type="submit">${escapeHtml(t("Partie erstellen"))}</button>
      </form>
      <p class="zilch-muted">${escapeHtml(t("Solo und CPU folgen später. Diese Alpha unterstützt ausschließlich zwei angemeldete Menschen."))}</p>
      <p id="zilchCreateError" class="zilch-error" role="status"></p>
    </section>
    <section class="zilch-card">
      <div class="zilch-section-heading"><div><p class="eyebrow">${escapeHtml(t("Zilch-Lobby"))}</p><h2>${escapeHtml(t("Deine und offene Zilch-Partien"))}</h2></div><button id="zilchRefresh" class="small ghost" type="button">${escapeHtml(t("Aktualisieren"))}</button></div>
      <div id="zilchGames" class="zilch-game-list" aria-live="polite">${escapeHtml(t("Zilch-Partien werden geladen …"))}</div>
    </section>
    <section class="zilch-card zilch-alpha-note">
      <h2>${escapeHtml(t("Human-vs-Human-Alpha"))}</h2>
      <p>${escapeHtml(t("Quick Holds, Würfel und Punkte werden ausschließlich auf dem Server geprüft. Zilch-Partien erzeugen weiterhin keine ZDWA-Ergebnisse, Statistiken oder Erfolge."))}</p>
    </section>`;

  const gamesSlot = document.getElementById("zilchGames");
  const refreshGames = async () => {
    try {
      const games = await fetchZilchGames();
      // A running Alpha is private to its two participants. Waiting games are
      // discoverable so the configured second preview player can join, while
      // another preview account is never invited to open a running board.
      const visibleGames = games.filter(game => String(game.mode) === "2" && (!game.started || game.my_player_id));
      gamesSlot.innerHTML = visibleGames.length
        ? visibleGames.map(gameCard).join("")
        : `<p class="zilch-muted">${escapeHtml(t("Noch keine Zilch-Partien"))}</p>`;
    } catch (_) {
      gamesSlot.innerHTML = `<p class="zilch-error">${escapeHtml(t("Zilch-Lobby konnte nicht geladen werden."))}</p>`;
    }
  };
  document.getElementById("zilchRefresh")?.addEventListener("click", () => { void refreshGames(); });
  document.getElementById("zilchCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorSlot = document.getElementById("zilchCreateError");
    if (errorSlot) errorSlot.textContent = "";
    const name = document.getElementById("zilchGameName")?.value?.trim() || "Zilch";
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode: "2", game_type: "zilch" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.game_id) throw new Error(payload.detail || "zilch_create_failed");
      window.location.assign(`/zilch/spiel/${encodeURIComponent(payload.game_id)}`);
    } catch (_) {
      if (errorSlot) errorSlot.textContent = t("Zilch-Partie konnte nicht erstellt werden.");
    }
  });
  await refreshGames();
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
  const status = active ? t("Am Zug") : connectionLabel(player);
  const history = Array.isArray(board?.rounds) ? board.rounds.slice(-4).reverse() : [];
  const finalMarkers = [
    board?.final_round_triggered_by ? `<span class="zilch-board-marker">${escapeHtml(t("Schlussrunde ausgelöst"))}</span>` : "",
    board?.final_reply_pending ? `<span class="zilch-board-marker">${escapeHtml(t("Gegenzug offen"))}</span>` : "",
  ].join("");
  return `<article class="${classes}" data-zilch-board-id="${escapeHtml(player.id)}" aria-current="${active ? "true" : "false"}">
    <header class="zilch-board-head"><div><h3>${playerName(player)}</h3><p><span class="zilch-connection-dot" aria-hidden="true"></span>${escapeHtml(status)}</p></div>${finalMarkers}</header>
    <dl>
      <div><dt>${escapeHtml(t("Gesamtpunkte"))}</dt><dd>${number(board?.total_points)}</dd></div>
      <div><dt>${escapeHtml(t("Rundenpunkte"))}</dt><dd>${number(board?.round_points)}</dd></div>
      <div><dt>${escapeHtml(t("Zilch-Serie"))}</dt><dd>${number(board?.zilch_streak)}</dd></div>
    </dl>
    <ol class="zilch-round-history" aria-label="${escapeHtml(t("Rundenhistorie"))}">${history.length ? history.map(entry => `<li>${escapeHtml(roundHistory(entry))}</li>`).join("") : `<li class="zilch-muted">${escapeHtml(t("Noch keine Runde abgeschlossen"))}</li>`}</ol>
  </article>`;
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

function diceRack(snapshot, turnState, quickHolds) {
  const dice = Array.isArray(snapshot._dice) ? snapshot._dice.slice(0, 6) : [0, 0, 0, 0, 0, 0];
  while (dice.length < 6) dice.push(0);
  return `<div class="zilch-dice" aria-label="${escapeHtml(t("Sechs Würfel"))}" aria-busy="${state.pendingAction ? "true" : "false"}">${dice.map((die, index) => {
    const label = die ? `${t("Würfel")} ${index + 1}: ${die}` : `${t("Würfel")} ${index + 1}: ${t("Noch nicht gewürfelt")}`;
    return `<span class="zilch-die ${dieState(index, die, turnState, quickHolds)}${state.pendingAction ? " zilch-die--pending" : ""}" role="img" tabindex="0" aria-label="${escapeHtml(label)}"><span class="zilch-die__face" data-value="${die || 0}">${diePips(die)}</span></span>`;
  }).join("")}</div>`;
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
  return `<div class="zilch-quick-holds" aria-label="${escapeHtml(t("Quick Holds"))}">${options.map(option => {
    const title = message(option.label_key, { ...(option.label_params || {}), points: number(option.points) });
    const tags = [
      option.hot_dice ? `<span>${escapeHtml(t("Hot Dice"))}</span>` : "",
      option.requires_confirmation ? `<span>${escapeHtml(t("Bestätigungswurf"))}</span>` : "",
    ].join("");
    const disabled = !selectable || state.pendingOptionId === option.id;
    return `<button class="zilch-quick-hold${option.hot_dice ? " zilch-quick-hold--hot" : ""}" type="button" data-zilch-option="${escapeHtml(option.id)}" ${disabled ? "disabled" : ""} aria-label="${escapeHtml(title)}">
      <span class="zilch-quick-hold__title">${escapeHtml(title)}</span>
      <span class="zilch-quick-hold__points">${number(option.points)}</span>
      <span class="zilch-quick-hold__tags">${tags}</span>
    </button>`;
  }).join("")}</div>`;
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
  return `<section class="zilch-card zilch-final-result" role="status"><p class="eyebrow">${escapeHtml(t("Endstand"))}</p><h2>${escapeHtml(headline)}</h2><p>${detail}</p><a class="button-link" href="/zilch">${escapeHtml(t("Zur Zilch-Lobby"))}</a></section>`;
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
  return text ? `<p class="${classes}" role="status">${escapeHtml(text)}</p>` : "";
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
  return `<section class="zilch-action-cards" aria-label="${escapeHtml(t("Spielaktionen"))}">
    <button type="button" class="zilch-action-card zilch-action-card--roll" data-zilch-roll ${canRoll ? "" : "disabled"}>
      <span class="zilch-action-card__eyebrow">${escapeHtml(t("Risiko"))}</span><strong>${escapeHtml(rollLabel)}</strong><small>${escapeHtml(t("Der Server würfelt nur freie Würfel."))}</small>
    </button>
    <button type="button" class="zilch-action-card zilch-action-card--bank" data-zilch-bank ${canBank ? "" : "disabled"}>
      <span class="zilch-action-card__eyebrow">${escapeHtml(t("Sichern"))}</span><strong>${escapeHtml(t("Punkte sichern"))}</strong><small>${escapeHtml(turnState?.bank_block_reason === "zilch_bank_minimum_not_reached" ? t("Ab 400 Rundenpunkten möglich.") : t("Beendet deinen Zug sicher."))}</small>
    </button>
  </section>`;
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
    <p id="zilchLiveStatus" class="zilch-live-status zilch-live-status--${escapeHtml(state.statusKind)}" role="status" aria-live="polite">${escapeHtml(statusText(snapshot, turnState))}</p>
    ${offline}
    ${openingRollPanel(snapshot)}
    ${eventBanner(snapshot)}
    <section class="zilch-board-grid" aria-label="${escapeHtml(t("Zilch-Boards"))}">${players.map(player => boardCard(player, boards[player.id] || {})).join("")}</section>
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
      socket.send(JSON.stringify({ action: "rejoin_game", player_id: knownPlayerId, resume_token: localValue("resume") }));
    } else {
      socket.send(JSON.stringify({ action: "join_game" }));
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
  if (gameId) await renderGame();
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
