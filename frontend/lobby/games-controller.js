import {
  defaultGameName,
  dom,
  escapeAttribute,
  escapeHtml,
  formatDateTime,
  lobbyNotice,
  localNameFor,
  localPassFor,
  localPlayerIdFor,
  rememberPlayerName,
  requestPassphrase,
  roomUrl,
  storageKeys,
  storeGamePass,
} from "./context.js";
import { playerNameMarkup } from "../shared/auth.js";
import { replaceChildrenPreservingAvatars } from "../shared/avatar.js";
import { requestGameInvitePush, webPushErrorMessage } from "../shared/web-push.js";

function renderOnlineUsers(value) {
  if (!dom.onlineUsers) return;
  const label = window.ZDWA_I18N?.t?.("Nutzer online") || "Nutzer online";
  const count = value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Math.max(0, Math.floor(Number(value)))
    : "—";
  dom.onlineUsers.innerHTML = `<span class="online-dot" aria-hidden="true"></span><b>${count}</b> ${escapeHtml(label)}`;
}

function renderOpenGames(games) {
  if (!dom.gamesList) return;
  dom.openGamesCard.hidden = games.length === 0;

  const markup = games.map((game, gameIndex) => {
    const joined = game.players ?? 0;
    const expected = game.expected ?? game.mode ?? "?";
    const gameId = game.id || "";
    const disabled = joined >= expected || game.started || game.finished ? "disabled" : "";
    const canResume = Boolean(localPlayerIdFor(gameId) || game.my_player_id);
    const canInvite = Boolean(
      game.my_player_id
      && !game.locked
      && joined < expected
      && !game.started
      && !game.finished
      && !game.aborted,
    );
    const mode = game.mode === "2v2" ? "2 vs 2" : `${game.mode || expected}`;
    const hardcore = game.hardcore ? '<span class="hc-badge">Hardcore</span>' : "";
    const statuses = Array.isArray(game.player_statuses) ? game.player_statuses : [];
    const waiting = Array.isArray(game.waiting) ? game.waiting : [];
    const listedPlayers = statuses.length
      ? statuses
      : waiting.map((name) => ({ name }));
    const badges = listedPlayers.length
      ? listedPlayers.map((player, playerIndex) => `<span class="badge">${playerNameMarkup(player, {
        compactRank: true,
        profileLink: true,
        avatarKey: JSON.stringify(["open-game", gameId || gameIndex, playerIndex]),
      })}</span>`).join(" ")
      : '<span class="muted small">Noch keine Spieler</span>';
    return `<div class="game-row">
      <div class="meta">
        <div class="name">
          ${escapeHtml(game.name || "(ohne Titel)")}
          ${game.locked ? '<span class="locked-label">Passwortgeschützt</span>' : ""}
          ${hardcore}
        </div>
        <div class="sub lobby-player-summary"><span><b>${joined}/${expected}</b> ${game.mode === "2v2" ? mode : "Spieler"}</span>${badges}</div>
      </div>
      <div class="actions">
        ${canResume
          ? `<button class="resumeBtn" data-id="${escapeAttribute(gameId)}" data-player-id="${escapeAttribute(game.my_player_id || "")}" data-pass="${game.locked ? "1" : "0"}">Wieder aufnehmen</button>`
          : `<button class="joinBtn" data-id="${escapeAttribute(gameId)}" data-pass="${game.locked ? "1" : "0"}" ${disabled}>Beitreten</button>`}
        <button class="spectateBtn" data-id="${escapeAttribute(gameId)}" data-pass="${game.locked ? "1" : "0"}">Zuschauen</button>
        ${canInvite ? `<button class="small secondary notifyOpenSeatBtn" type="button" data-id="${escapeAttribute(gameId)}">Mitspieler benachrichtigen</button>` : ""}
      </div>
    </div>`;
  }).join("");
  replaceChildrenPreservingAvatars(dom.gamesList, markup);
}

function prioritizeResumableGames() {
  const hasResumableGame = Boolean(dom.gamesHub?.querySelector(".resumeBtn"));
  dom.gamesHub?.classList.toggle("priority-card", hasResumableGame);
  if (dom.runningGamesTitle) {
    dom.runningGamesTitle.textContent = dom.runningList?.querySelector(".resumeBtn")
      ? "Spiel fortsetzen"
      : "Laufende Spiele";
  }
  if (hasResumableGame) {
    if (dom.gamesHub?.nextElementSibling !== dom.setupGrid) dom.setupGrid?.before(dom.gamesHub);
  } else if (dom.setupGrid?.nextElementSibling !== dom.gamesHub) dom.setupGrid?.after(dom.gamesHub);
}

function renderRunningGames(games) {
  if (!dom.runningList) return;
  dom.runningGamesCard.hidden = games.length === 0;

  const markup = games.map((game, gameIndex) => {
    const gameId = game.id || "";
    const avatarKey = (...slot) => JSON.stringify(["running-game", gameId || gameIndex, ...slot]);
    const mode = game.mode === "2v2" ? "2 vs 2" : `${game.mode || game.expected}`;
    const hardcore = game.hardcore ? '<span class="hc-badge">Hardcore</span>' : "";
    const statuses = Array.isArray(game.player_statuses) ? game.player_statuses : [];
    const players = statuses.length
      ? statuses
      : Array.isArray(game.waiting)
        ? game.waiting.map((name) => ({ name, connected: true }))
        : [];
    const playerBadges = players.length
      ? players.map((player, playerIndex) => {
        const name = typeof player === "string" ? player : player.name || "Spieler";
        const connected = typeof player === "string" || Boolean(player.connected);
        const playerData = typeof player === "string" ? { name } : player;
        return `<span class="badge ${connected ? "online" : "offline"}">${playerNameMarkup(playerData, { compactRank: true, profileLink: true, avatarKey: avatarKey("badge", playerIndex) })}${connected ? "" : " offline"}</span>`;
      }).join(" ")
      : '<span class="muted small">Spieler unbekannt</span>';
    const canResume = Boolean(localPlayerIdFor(gameId) || game.my_player_id);
    const pauseLine = game.paused
      ? (() => {
        const remaining = game.pause_remaining_label || game.timeout_label || "";
        const offline = Array.isArray(game.offline) ? game.offline : [];
        const waitText = offline.length
          ? `wartet auf ${offline.map((player, playerIndex) => playerNameMarkup(player, { compactRank: true, profileLink: true, avatarKey: avatarKey("offline", playerIndex) })).join(", ")}`
          : "manuell pausiert";
        const timeText = remaining ? ` • Restzeit: ${escapeHtml(remaining)}` : "";
        return `<div class="sub warn-line">Pausiert: ${waitText}${timeText}</div>`;
      })()
      : "";
    const progressPlayer = (entry, slot) => {
      const data = typeof entry === "string" ? { name: entry } : entry;
      const status = players.find(player => data.id
        ? player.id === data.id
        : player.name === data.name) || {};
      return `${playerNameMarkup({ ...status, ...data }, { compactRank: true, profileLink: true, avatarKey: avatarKey("progress", ...slot) })}${status.connected === false ? " offline" : ""}`;
    };
    const progressRows = (Array.isArray(game.progress) ? game.progress : []).map((progress, progressIndex) => {
      const translate = window.ZDWA_I18N?.t || ((text) => text);
      const player = progress.members?.length
        ? `${escapeHtml(progress.name)} <span class="muted small">(${progress.members.map((member, memberIndex) => progressPlayer(member, [progressIndex, memberIndex])).join(", ")})</span>`
        : progressPlayer(progress, [progressIndex]);
      return `<div class="muted small progress-line">
        <span class="lobby-progress-player">${player}</span><span class="lobby-progress-score">${escapeHtml(translate("Felder"))} <b>${progress.filled}/${progress.of || 48}</b> · ${escapeHtml(translate("Punkte"))} <b>${progress.points}</b></span>
      </div>`;
    }).join("");

    const modeLabel = game.mode === "2v2" ? mode : `${mode} Spieler`;
    const nameIncludesMode = String(game.name || "").startsWith(`${modeLabel} ·`);
    const defaultName = players.some(player => game.name === defaultGameName(player.name, game.mode));
    return `<div class="game-row">
      <div class="meta">
        <div class="name">
          ${escapeHtml(defaultName ? modeLabel : game.name || modeLabel)}
          ${game.locked ? '<span class="locked-label">Passwortgeschützt</span>' : ""}
          ${hardcore}
        </div>
        <div class="sub game-time">${nameIncludesMode ? "" : `${escapeHtml(modeLabel)} · `}<span>Gestartet:</span> ${formatDateTime(game.started_at)}</div>
        ${progressRows ? `<div class="sub progress-stack">${progressRows}</div>` : `<div class="sub">${playerBadges}</div>`}
        ${pauseLine}
      </div>
      <div class="actions">
        ${canResume ? `<button class="resumeBtn" data-id="${escapeAttribute(gameId)}" data-player-id="${escapeAttribute(game.my_player_id || "")}" data-pass="${game.locked ? "1" : "0"}">Wieder aufnehmen</button>` : ""}
        <button class="spectateBtn" data-id="${escapeAttribute(gameId)}" data-pass="${game.locked ? "1" : "0"}">Zuschauen</button>
      </div>
    </div>`;
  }).join("");
  replaceChildrenPreservingAvatars(dom.runningList, markup);
  prioritizeResumableGames();
}

export async function fetchGames({ showLoading = false } = {}) {
  if (showLoading) {
    dom.openGamesCard?.setAttribute("aria-busy", "true");
    dom.runningGamesCard?.setAttribute("aria-busy", "true");
    dom.refreshButton.disabled = true;
    if (dom.refreshRunningButton) dom.refreshRunningButton.disabled = true;
  }
  try {
    const response = await fetch("/api/games", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const games = Array.isArray(payload.games) ? payload.games : [];
    renderOnlineUsers(payload.online_users);
    const availableGames = games.filter((game) => !game.finished && !game.aborted);
    if (dom.gamesEmpty) dom.gamesEmpty.hidden = availableGames.length > 0;
    renderOpenGames(availableGames.filter((game) => !game.started)
      .sort((left, right) => Number(Boolean(localPlayerIdFor(right.id) || right.my_player_id))
        - Number(Boolean(localPlayerIdFor(left.id) || left.my_player_id))));
    renderRunningGames(
      games
        .filter((game) => game.started && !game.finished && !game.aborted)
        .sort((left, right) => Number(Boolean(localPlayerIdFor(right.id) || right.my_player_id))
          - Number(Boolean(localPlayerIdFor(left.id) || left.my_player_id))
          || Date.parse(right.updated_at || right.started_at || 0)
          - Date.parse(left.updated_at || left.started_at || 0)),
    );
  } catch {
    renderOnlineUsers(null);
    dom.openGamesCard.hidden = false;
    dom.runningGamesCard.hidden = true;
    if (dom.gamesEmpty) dom.gamesEmpty.hidden = true;
    dom.gamesList.innerHTML = '<div class="connection-error">Spielserver nicht erreichbar. Bitte Server starten und die Seite neu laden.</div>';
  } finally {
    dom.openGamesCard?.removeAttribute("aria-busy");
    dom.runningGamesCard?.removeAttribute("aria-busy");
    dom.refreshButton.disabled = false;
    if (dom.refreshRunningButton) dom.refreshRunningButton.disabled = false;
  }
}

async function validateGame(gameId) {
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, { cache: "no-store" });
    const payload = response.ok ? await response.json() : { exists: false };
    if (payload?.exists === false) {
      await lobbyNotice("Game nicht gefunden (Liste evtl. veraltet).");
      await fetchGames();
      return false;
    }
  } catch {}
  return true;
}

async function validatePassphrase(gameId, passphrase) {
  try {
    const response = await fetch(
      `/api/games/${encodeURIComponent(gameId)}?check=1&pass=${encodeURIComponent(passphrase)}`,
      { cache: "no-store" },
    );
    if (response.ok) return true;
    await lobbyNotice("Falsche Passphrase – bitte erneut versuchen.", {
      title: "Beitritt nicht möglich",
      kind: "error",
    });
  } catch {
    await lobbyNotice("Fehler beim Prüfen der Passphrase.", {
      title: "Verbindungsfehler",
      kind: "error",
    });
  }
  return false;
}

async function openExistingGame(event) {
  const resumeButton = event.target.closest(".resumeBtn");
  const button = resumeButton || event.target.closest(".spectateBtn");
  if (!button) return;
  const gameId = button.dataset.id;
  const resume = Boolean(resumeButton);
  if (!gameId) {
    await lobbyNotice("Ungültige Spiel-ID. Bitte aktualisieren.");
    return;
  }
  if (resume && button.dataset.playerId) {
    localStorage.setItem(`${storageKeys.playerIdPrefix}${gameId}`, button.dataset.playerId);
  }
  const playerName = ((resume ? localNameFor(gameId) : "") || dom.nameInput.value || "Gast").trim() || "Gast";
  if (!await validateGame(gameId)) return;

  let passphrase = resume ? localPassFor(gameId) : "";
  if (button.dataset.pass === "1") {
    if (!passphrase) passphrase = await requestPassphrase();
    if (passphrase === null || !await validatePassphrase(gameId, passphrase)) return;
  }
  storeGamePass(gameId, passphrase);
  rememberPlayerName(gameId, playerName);
  location.href = roomUrl(gameId, !resume);
}

async function joinOpenGame(event) {
  if (event.target.closest(".resumeBtn, .spectateBtn")) {
    await openExistingGame(event);
    return;
  }
  const focusCreateButton = event.target.closest(".focus-create-btn");
  if (focusCreateButton) {
    dom.createGameCard?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(
      () => dom.modeButtons.find((button) => button.getAttribute("aria-checked") === "true")?.focus(),
      250,
    );
    return;
  }
  const inviteButton = event.target.closest(".notifyOpenSeatBtn");
  if (inviteButton) {
    const gameId = inviteButton.dataset.id;
    if (!gameId || inviteButton.disabled) return;
    const translate = window.ZDWA_I18N?.t || (value => value);
    inviteButton.disabled = true;
    try {
      const result = await requestGameInvitePush(gameId);
      window.ZDWA_UI?.toast?.(
        translate(result.notified
          ? "Spieler mit aktivierten Push-Benachrichtigungen wurden informiert."
          : "Aktuell konnten keine Spieler mit aktivierten Push-Benachrichtigungen informiert werden."),
        { kind: result.notified ? "success" : "info", duration: 3500 },
      );
    } catch (error) {
      window.ZDWA_UI?.toast?.(webPushErrorMessage(error), {
        kind: "error",
        duration: 5000,
      });
    } finally {
      inviteButton.disabled = false;
      void fetchGames();
    }
    return;
  }
  const button = event.target.closest(".joinBtn");
  if (!button) return;
  const gameId = button.dataset.id;
  const playerName = (dom.nameInput.value || "Gast").trim() || "Gast";
  if (!gameId) {
    await lobbyNotice("Ungültige Spiel-ID. Bitte aktualisieren.");
    return;
  }
  if (!await validateGame(gameId)) return;

  let passphrase = "";
  if (button.dataset.pass === "1") {
    passphrase = await requestPassphrase();
    if (passphrase === null || !await validatePassphrase(gameId, passphrase)) return;
  }
  storeGamePass(gameId, passphrase);
  rememberPlayerName(gameId, playerName);
  location.href = roomUrl(gameId);
}

async function createGame() {
  dom.createError.textContent = "";
  dom.createError.classList.remove("connection-error");
  const playerName = (dom.nameInput.value || "Gast").trim() || "Gast";
  const mode = dom.modeSelect.value || "2";
  localStorage.setItem(storageKeys.name, playerName);
  try {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: defaultGameName(playerName, mode),
        mode,
        pass: dom.passInput.value,
        hardcore: Boolean(dom.hardcoreCheckbox.checked),
      }),
    });
    if (!response.ok) {
      let message = "";
      try {
        const payload = await response.json();
        message = String(payload.message || payload.detail || "");
      } catch {}
      if (response.status === 429) throw new Error("Zu viele neue Spiele. Bitte kurz warten.");
      if (response.status === 503) throw new Error(message || "Der Spielserver ist nicht erreichbar.");
      throw new Error(message || `Serverfehler ${response.status}`);
    }
    const payload = await response.json();
    const gameId = payload.game_id || payload.id;
    if (!gameId) throw new Error("Antwort ohne game_id");
    storeGamePass(gameId, dom.passInput.value);
    rememberPlayerName(gameId, playerName);
    location.href = roomUrl(gameId);
  } catch (error) {
    const raw = String(error?.message || error);
    const offline = error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(raw);
    dom.createError.textContent = offline
      ? "Der Spielserver ist nicht erreichbar. Bitte Server starten und die Seite neu laden."
      : `Fehler: ${raw}`;
    dom.createError.classList.add("connection-error");
  }
}

export function initializeGames() {
  dom.runningList?.addEventListener("click", openExistingGame);
  dom.gamesList.addEventListener("click", joinOpenGame);
  dom.createButton.addEventListener("click", createGame);
  dom.refreshButton.addEventListener("click", () => fetchGames({ showLoading: true }));
  dom.refreshRunningButton?.addEventListener("click", () => fetchGames({ showLoading: true }));
  window.addEventListener("zdwa:presence-connected", () => fetchGames());
  void fetchGames({ showLoading: true });
  setInterval(fetchGames, 4000);
}
