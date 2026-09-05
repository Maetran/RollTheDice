  // ---------- State ----------
  const qs = getQS();
  const IS_SPECTATOR = !!qs.spectator;
  if (!qs.game_id) {
    showNotice({ title: "Spiel nicht gefunden", message: "Die Spiel-ID fehlt.", kind: "error", buttonLabel: "Zur Lobby" })
      .finally(() => { location.href = zdwaPath("/"); });
  }

  const PID_KEY = `wuerfler_pid_${qs.game_id}`;
  const TOKEN_KEY = `wuerfler_token_${qs.game_id}`;
  const PASS_KEY = `wuerfler_pass_${qs.game_id}`;
  const PLAYER_NAME_KEY = `wuerfler_player_name_${qs.game_id}`;
  if (!qs.pass) qs.pass = sessionStorage.getItem(PASS_KEY) || localStorage.getItem(PASS_KEY) || "";
  if (qs.pass) {
    sessionStorage.setItem(PASS_KEY, qs.pass);
    localStorage.removeItem(PASS_KEY);
  }
  const cleanUrl = new URL(location.href);
  cleanUrl.pathname = zdwaPath(`/spiel/${encodeURIComponent(qs.game_id)}${IS_SPECTATOR ? "/zuschauen" : ""}`);
  for (const key of ["game_id", "name", "pass", "spectator"]) cleanUrl.searchParams.delete(key);
  if (cleanUrl.toString() !== location.href) history.replaceState(null, "", cleanUrl);
  if (qs.name) localStorage.setItem(PLAYER_NAME_KEY, qs.name);
  let myId = IS_SPECTATOR ? null : (localStorage.getItem(PID_KEY) || sessionStorage.getItem(PID_KEY) || null);
  let mySpectatorId = null;
  let myName = qs.name;

  let ws = null;
  let reconnectAttempts = 0;
  let connectionHideTimer = null;
  let screenWakeLock = null;
  let lastHapticTurnPid = null;
  let sb = null; // letzter Snapshot
  let rollRequestPending = false;
  let pendingRollSnapshotKey = null;
  let rollSendTimer = null;
  let rollPendingTimer = null;
  let rollCooldownTimer = null;
  let autoRollRetryTimer = null;
  let rollAnimationTimer = null;
  let rollFaceTimer = null;
  let rollAnimationUntil = 0;
  let rollAnimationIndices = [];
  let autoAnnounceWriteTimer = null;
  let autoAnnounceWriteKey = null;
  let sixtyCelebrationTimer = null;
  let sixtyCelebrationUntil = 0;
  let deferredSuggestionSnapshot = null;
  let writeConfirmationPending = false;
  let chatHistorySeeded = false;
  let lastSuperadminSnapshotActive = false;
  const DEBUG_P_HOTKEY = false; // optionaler Debug-Hotkey "p" -> Poker/Free

  // UI-State für die Ansage-Auswahl per Button oder Hotkey.
  let announcePickMode = false;
  let authState = { authenticated: false, user: null };
  let superadminState = { active: false, boardId: null, draft: {} };
  let superadminTapState = { boardId: null, count: 0, lastTs: 0 };
