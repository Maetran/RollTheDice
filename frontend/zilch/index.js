import { escapeHtml, loadAuth, logout } from "../shared/auth.js";
import { initializeAppMode } from "../multigame/app-mode.js";

const root = document.querySelector("[data-zilch-root]");
const content = document.getElementById("zilchContent");
const gameIdMatch = window.location.pathname.match(/^\/zilch\/spiel\/([^/]+)$/);
const gameId = gameIdMatch ? decodeURIComponent(gameIdMatch[1]) : null;
const state = {
  auth: null,
  game: null,
  socket: null,
  playerId: null,
  reconnectTimer: null,
  stopped: false,
};

function t(value) {
  return window.ZDWA_I18N?.t?.(value) || value;
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

function renderShell() {
  const username = state.auth?.user?.username || "";
  const account = username
    ? `<span class="zilch-account">${escapeHtml(username)} <span class="zilch-preview-badge">${t("Intern")}</span></span>`
    : "";
  root?.classList.remove("zilch-loading");
  document.getElementById("zilchAccount")?.replaceChildren();
  const accountSlot = document.getElementById("zilchAccount");
  if (accountSlot) accountSlot.innerHTML = account;
}

function renderNotice(message, { kind = "info" } = {}) {
  if (!content) return;
  content.innerHTML = `<section class="zilch-card zilch-notice zilch-notice--${kind}" role="status"><p>${escapeHtml(t(message))}</p></section>`;
}

function gameCard(game) {
  const joined = Number(game.players || 0);
  const expected = Number(game.expected || 0);
  const names = Array.isArray(game.waiting) && game.waiting.length
    ? game.waiting.map(name => escapeHtml(name)).join(", ")
    : t("Noch keine Spieler");
  const status = game.started ? t("Läuft") : t("Wartet auf Mitspieler");
  return `<article class="zilch-game-card">
    <div>
      <h3>${escapeHtml(game.name || "Zilch")}</h3>
      <p>${t("Spieler")}: <strong>${joined}/${expected}</strong> · ${status}</p>
      <p class="zilch-muted">${names}</p>
    </div>
    <a class="button-link small secondary" data-zilch-join href="/zilch/spiel/${encodeURIComponent(game.id)}">${game.started ? t("Öffnen") : t("Beitreten")}</a>
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
  content.innerHTML = `<section class="zilch-intro">
      <p class="eyebrow">${t("Interne Vorschau")}</p>
      <h1>${t("Zilch-Preview")}</h1>
      <p>${t("Separater Spielmodus mit sechs Würfeln und Ziel 10’000. Der serverseitige Regelvertrag ist festgelegt; die taktile Spieloberfläche folgt später.")}</p>
    </section>
    <section class="zilch-card">
      <p class="eyebrow">${t("Neue Zilch-Partie")}</p>
      <h2>${t("Zilch erstellen")}</h2>
      <form id="zilchCreateForm" class="zilch-create-form">
        <label><span>${t("Name der Partie")}</span><input id="zilchGameName" maxlength="80" required value="${escapeHtml(`Zilch · ${state.auth?.user?.username || "Mani"}`)}"></label>
        <label><span>${t("Spieleranzahl")}</span><select id="zilchMode"><option value="1">${t("1 Spieler")}</option><option value="2">${t("2 Spieler")}</option></select></label>
        <button type="submit">${t("Zilch-Vorschau starten")}</button>
      </form>
      <p id="zilchCreateError" class="zilch-muted" role="status"></p>
    </section>
    <section class="zilch-card">
      <div class="zilch-section-heading"><div><p class="eyebrow">${t("Zilch-Lobby")}</p><h2>${t("Offene Zilch-Partien")}</h2></div><button id="zilchRefresh" class="small ghost" type="button">${t("Aktualisieren")}</button></div>
      <div id="zilchGames" class="zilch-game-list" aria-live="polite">${t("Zilch-Partien werden geladen …")}</div>
    </section>
    <section class="zilch-card zilch-scaffold-note">
      <h2>${t("Regel-Engine, noch keine Spieloberfläche")}</h2>
      <p>${t("Wertung, Quick-Hold-Prüfung und aktive Zustände werden bereits serverseitig getrennt berechnet. Die taktile Zilch-Bedienung folgt; diese Vorschau löst keine ZDWA-Erfolge, Statistiken oder Leaderboards aus.")}</p>
    </section>`;

  const gamesSlot = document.getElementById("zilchGames");
  const refreshGames = async () => {
    try {
      const games = await fetchZilchGames();
      gamesSlot.innerHTML = games.length
        ? games.map(gameCard).join("")
        : `<p class="zilch-muted">${t("Noch keine Zilch-Partien")}</p>`;
    } catch (_) {
      gamesSlot.innerHTML = `<p class="zilch-error">${t("Zilch-Lobby konnte nicht geladen werden.")}</p>`;
    }
  };
  document.getElementById("zilchRefresh")?.addEventListener("click", refreshGames);
  document.getElementById("zilchCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorSlot = document.getElementById("zilchCreateError");
    if (errorSlot) errorSlot.textContent = "";
    const name = document.getElementById("zilchGameName")?.value?.trim() || "Zilch";
    const mode = document.getElementById("zilchMode")?.value || "1";
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode, game_type: "zilch" }),
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

function boardCard(player, board) {
  const roundPoints = Number(board?.round_points || 0);
  const totalPoints = Number(board?.total_points || 0);
  return `<article class="zilch-board" data-zilch-board-id="${escapeHtml(player.id)}">
    <h3>${playerName(player)}</h3>
    <dl><div><dt>${t("Rundenpunkte")}</dt><dd>${roundPoints}</dd></div><div><dt>${t("Gesamtpunkte")}</dt><dd>${totalPoints}</dd></div></dl>
    <p class="zilch-muted">${t("Eigenes Zilch-Board — die serverseitige Wertungsengine ist getrennt; die Bedienoberfläche folgt später.")}</p>
  </article>`;
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
  const dice = Array.isArray(snapshot._dice) ? snapshot._dice.slice(0, 6) : [0, 0, 0, 0, 0, 0];
  const gameName = escapeHtml(snapshot._name || "Zilch");
  const target = Number(snapshot._target_score || 10000);
  const currentPlayer = players.find(player => String(player.id) === String(snapshot?._turn?.player_id));
  const chatRows = (Array.isArray(snapshot._chat_history) ? snapshot._chat_history : []).map((entry) => (
    `<li><strong>${escapeHtml(entry.sender || t("Spieler"))}</strong><span>${escapeHtml(entry.text || "")}</span></li>`
  )).join("");
  content.innerHTML = `<section class="zilch-game-head">
      <p class="eyebrow">${t("Zilch-Spielraum")}</p>
      <h1>${gameName}</h1>
      <p>${t("Ziel")}: <strong>${target.toLocaleString(window.ZDWA_I18N?.locale?.() || "de-CH")}</strong> ${t("Punkte")}</p>
      <p class="zilch-muted">${snapshot._started ? `${t("Am Zug")}: ${playerName(currentPlayer)}` : t("Wartet auf Mitspieler")}</p>
    </section>
    <section class="zilch-card zilch-dice-card">
      <h2>${t("Sechs Würfel")}</h2>
      <div class="zilch-dice" aria-label="${t("Sechs Würfel")}">${dice.map((die, index) => `<span class="zilch-die" aria-label="${t("Würfel")} ${index + 1}">${die || "–"}</span>`).join("")}</div>
      <div class="zilch-actions"><button type="button" data-zilch-roll disabled title="${t("Die serverseitige Zilch-Engine ist vorhanden; die Bedienoberfläche folgt später.")}">${t("Würfeln")}</button><button type="button" data-zilch-score disabled title="${t("Manuelle Punkteingabe ist in Zilch derzeit nicht vorgesehen.")}">${t("Punkte eintragen")}</button></div>
      <p class="zilch-muted">${t("Interne Regel-Engine aktiv: Zilch-Wertung bleibt getrennt von ZDWA; Quick Holds werden erst mit der späteren Bedienoberfläche auswählbar.")}</p>
    </section>
    <section class="zilch-board-grid" aria-label="${t("Zilch-Boards")}">${players.map(player => boardCard(player, boards[player.id] || {})).join("")}</section>
    <section class="zilch-card zilch-chat">
      <h2>${t("Chat")}</h2>
      <ul id="zilchChatHistory" class="zilch-chat-history">${chatRows || `<li class="zilch-muted">${t("Noch keine Nachrichten")}</li>`}</ul>
      <form id="zilchChatForm" class="zilch-chat-form"><label class="visually-hidden" for="zilchChatInput">${t("Nachricht")}</label><input id="zilchChatInput" maxlength="400" placeholder="${t("Nachricht eingeben …")}"><button type="submit" class="secondary">${t("Senden")}</button></form>
    </section>`;
  document.getElementById("zilchChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("zilchChatInput");
    const text = input?.value?.trim();
    if (!text || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    state.socket.send(JSON.stringify({ action: "chat_message", text }));
    input.value = "";
  });
}

function renderSocketError(message) {
  const error = document.createElement("p");
  error.className = "zilch-error";
  error.textContent = t(message);
  content?.prepend(error);
}

function connectGameSocket() {
  if (!gameId || state.stopped) return;
  state.socket?.close();
  const socket = new WebSocket(socketUrl(gameId));
  state.socket = socket;
  socket.addEventListener("open", () => {
    const knownPlayerId = localValue("player");
    if (knownPlayerId) {
      socket.send(JSON.stringify({ action: "rejoin_game", player_id: knownPlayerId, resume_token: localValue("resume") }));
    } else {
      socket.send(JSON.stringify({ action: "join_game" }));
    }
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.player_id) {
      state.playerId = String(message.player_id);
      setLocalValue("player", state.playerId);
    }
    if (message.resume_token) setLocalValue("resume", message.resume_token);
    if (message.scoreboard) {
      state.game = message.scoreboard;
      renderGameState();
    }
    if (message.error) {
      if (message.fatal) {
        state.stopped = true;
        clearLocalSession();
      }
      renderSocketError(message.error);
    }
  });
  socket.addEventListener("close", () => {
    if (state.stopped || socket !== state.socket) return;
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
  if (!appMode.canUseZilch()) return;
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

void initialize();
