export const dom = {
  nameInput: document.getElementById("playerName"),
  passInput: document.getElementById("passInput"),
  modeSelect: document.getElementById("gameMode"),
  createButton: document.getElementById("createBtn"),
  createError: document.getElementById("createErr"),
  gamesList: document.getElementById("gamesList"),
  refreshButton: document.getElementById("refreshBtn"),
  runningList: document.getElementById("runningList"),
  setupGrid: document.getElementById("setupGrid"),
  openGamesCard: document.getElementById("openGamesCard"),
  runningGamesCard: document.getElementById("runningGamesCard"),
  runningGamesTitle: document.getElementById("runningGamesTitle"),
  refreshRunningButton: document.getElementById("refreshRunningBtn"),
  onlineUsers: document.getElementById("onlineUsers"),
  recentBox: document.getElementById("recentBox"),
  alltimeBox: document.getElementById("alltimeBox"),
  recentTitle: document.getElementById("recentTitle"),
  alltimeTitle: document.getElementById("alltimeTitle"),
  recentTable: document.querySelector("#recentTable tbody"),
  alltimeTable: document.querySelector("#alltimeTable tbody"),
  gamesPlayed: document.getElementById("gamesPlayed"),
  averageNormalPoints: document.getElementById("avgNormalPoints"),
  averageHardcorePoints: document.getElementById("avgHardcorePoints"),
  averageNormalTrend: document.getElementById("avgNormalTrend"),
  averageHardcoreTrend: document.getElementById("avgHardcoreTrend"),
  hardcoreCheckbox: document.getElementById("hardcoreChk"),
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  registerButton: document.getElementById("registerBtn"),
  registrationChallenge: document.getElementById("registrationChallenge"),
  loginError: document.getElementById("loginError"),
  playerSetupCard: document.getElementById("playerSetupCard"),
  playerSectionTitle: document.getElementById("playerSectionTitle"),
  playerNameRow: document.getElementById("playerNameRow"),
  authBadge: document.getElementById("authBadge"),
  authActions: document.getElementById("authActions"),
  adminLink: document.getElementById("adminLink"),
  headerAccountLink: document.getElementById("headerAccountLink"),
  logoutButton: document.getElementById("logoutBtn"),
  leaderboardNormalTab: document.getElementById("lbTabNormal"),
  leaderboardHardcoreTab: document.getElementById("lbTabHC"),
  leaderboardShameTab: document.getElementById("lbTabShame"),
  leaderboardLastTab: document.getElementById("lbTabLast"),
  modeButtons: Array.from(document.querySelectorAll("[data-game-mode]")),
  hardcoreModeButtons: Array.from(document.querySelectorAll("[data-hardcore]")),
  hardcoreHelp: document.getElementById("hardcoreHelp"),
  createGameCard: document.getElementById("createGameCard"),
};

export const storageKeys = {
  name: "wuerfler_name",
  playerIdPrefix: "wuerfler_pid_",
  tokenPrefix: "wuerfler_token_",
  passPrefix: "wuerfler_pass_",
  playerNamePrefix: "wuerfler_player_name_",
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function escapeAttribute(value) {
  return String(value).replace(/"/g, "&quot;");
}

export async function requestPassphrase() {
  if (window.ZDWA_UI?.prompt) {
    const value = await window.ZDWA_UI.prompt({
      title: "Passphrase erforderlich",
      message: "Dieses Spiel ist passwortgeschützt.",
      label: "Passphrase",
      confirmLabel: "Weiter",
      input: {
        label: "Passphrase",
        type: "password",
        autocomplete: "current-password",
      },
    });
    return value == null ? null : String(value).trim();
  }
  return (prompt("Dieses Spiel ist passwortgeschützt. Bitte Passwort eingeben:") || "").trim();
}

export function lobbyNotice(message, { title = "Hinweis", kind = "warning" } = {}) {
  if (window.ZDWA_UI?.notice) return window.ZDWA_UI.notice({ title, message, kind });
  alert(message);
  return Promise.resolve();
}

export function storeGamePass(gameId, passphrase) {
  if (!gameId || !passphrase) return;
  try {
    sessionStorage.setItem(`${storageKeys.passPrefix}${gameId}`, passphrase);
    localStorage.removeItem(`${storageKeys.passPrefix}${gameId}`);
  } catch {}
}

export function localPlayerIdFor(gameId) {
  try {
    return localStorage.getItem(`${storageKeys.playerIdPrefix}${gameId}`) || "";
  } catch {
    return "";
  }
}

export function localPassFor(gameId) {
  try {
    const passphrase = sessionStorage.getItem(`${storageKeys.passPrefix}${gameId}`)
      || localStorage.getItem(`${storageKeys.passPrefix}${gameId}`)
      || "";
    if (passphrase) storeGamePass(gameId, passphrase);
    return passphrase;
  } catch {
    return "";
  }
}

export function localNameFor(gameId) {
  try {
    return localStorage.getItem(`${storageKeys.playerNamePrefix}${gameId}`) || "";
  } catch {
    return "";
  }
}

export function rememberPlayerName(gameId, name) {
  try {
    localStorage.setItem(`${storageKeys.playerNamePrefix}${gameId}`, name);
  } catch {}
}

export function roomUrl(gameId, spectator = false) {
  const base = `/spiel/${encodeURIComponent(gameId)}`;
  return spectator ? `${base}/zuschauen` : base;
}

export function defaultGameName(playerName, mode) {
  const modeText = mode === "2v2" ? "2 vs 2" : `${mode || 2} Spieler`;
  return `${modeText} · ${playerName}`;
}

export function formatDateTime(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
