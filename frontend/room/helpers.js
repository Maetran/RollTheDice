/*
  room.js – Raum-Client
  ----------------------
  Verantwortlich für:
  - WebSocket-Interaktion mit dem Server (Join, Würfeln, Schreiben, Korrektur)
  - Rendering von Scoreboard, Würfel-UI, Vorschlägen und Reactions/Chat
  - Clientseitige Guards für bessere UX (z. B. Roll-Button Throttle)

  Wichtige Snippets:
  - safeSend(): Enthält einen kurzen zeitbasierten Throttle für 'roll'-Events.
  - requestRoll(): Sperrt weitere Roll-Requests sofort und gibt erst nach einem
    neuen Server-Snapshot wieder frei. Dadurch wird der Buttonzustand nicht durch
    einen Timer gegen den echten Spielzustand reaktiviert.
  - applyAnnounceModeButtonVisibility(): Steuert die Sichtbarkeit des Würfeln-Buttons
    im Ansage-Pick-Modus über visibility, nicht display, damit sich das Layout nicht
    verschiebt.
*/
// Orchestriert den Room-Client (WS, UI-Events, Scoreboard-Render, Reactions)

import { initChat, addChatMessage } from "./chat.js";
import { ANNOUNCE_FIELDS, calculatePoints, WRITABLE_MAP } from "./scoring.js";

  // ---------- Helpers ----------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getQS() {
    const u = new URL(location.href);
    const pathMatch = u.pathname.match(/^\/spiel\/([^/]+)(\/zuschauen)?\/?$/);
    let pathGameId = "";
    try { pathGameId = pathMatch ? decodeURIComponent(pathMatch[1]) : ""; }
    catch { pathGameId = ""; }
    const gameId = pathGameId || u.searchParams.get("game_id") || "";
    const storedName = gameId
      ? localStorage.getItem(`wuerfler_player_name_${gameId}`) || localStorage.getItem("wuerfler_name") || ""
      : "";
    return {
      game_id: gameId,
      name:   (u.searchParams.get("name") || storedName || "Gast").trim() || "Gast",
      pass:   u.searchParams.get("pass") || "",
      spectator: !!pathMatch?.[2] || u.searchParams.get("spectator") === "1"
    };
  }

  function wsURL(gid) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/${encodeURIComponent(gid)}`;
  }

  const ROLL_GUARD_MS = 600;
  const ROLL_ANIMATION_SEND_DELAY_MS = 120;
  const ROLL_ANIMATION_MS = 650;
  const ROLL_FACE_ANIMATION_STEP_MS = 100;
  const ROLL_PENDING_TIMEOUT_MS = 5000;
  const WRITE_PENDING_TIMEOUT_MS = 8000;
  const AUTO_ANNOUNCE_WRITE_DELAY_MS = 500;

  function haptic(pattern = 10) {
    try {
      if (!userGameplayPreferences().hapticFeedback || typeof navigator.vibrate !== "function") return;
      navigator.vibrate(pattern);
    } catch {}
  }

  function isRollAction(obj) {
    return obj && (
      obj.action === 'roll_dice' || obj.type === 'roll_dice' || obj.t === 'roll_dice' ||
      obj.type === 'roll'       || obj.t === 'roll'        || obj.action === 'roll'
    );
  }

  function isWriteAction(obj) {
    return typeof obj?.action === "string" && obj.action.startsWith("write_field");
  }

  function clearPendingWrite() {
    if (window.__rt_writePendingTimer) {
      clearTimeout(window.__rt_writePendingTimer);
      window.__rt_writePendingTimer = null;
    }
    window.__rt_writeRequestPending = false;
  }

  function beginPendingWrite() {
    clearPendingWrite();
    window.__rt_writeRequestPending = true;
    // A dropped connection or an unexpected server response must never leave a
    // player unable to continue. The next snapshot/error normally clears this
    // immediately; this is only a last-resort client-side escape hatch.
    window.__rt_writePendingTimer = setTimeout(() => {
      clearPendingWrite();
      if (typeof syncActionButtons === "function") syncActionButtons(sb);
    }, WRITE_PENDING_TIMEOUT_MS);
  }

  function safeSend(ws, obj) {
    /*
      Roll-Event Throttle (600 ms)
      ----------------------------
      Problem: Sehr schnelle Mehrfach-Klicks (oder doppelte Handler) koennen mehrere
               'roll'-Events auf dem WS senden -> fühlt sich an wie "2x gewürfelt".
      Loesung: Für 'roll' wird clientseitig ein kurzer Zeit-Guard aktiviert; die
               sichtbare Button-Sperre wird in requestRoll()/syncActionButtons()
               aus dem echten Spielzustand abgeleitet.
    */

    // Globaler Zeitstempel für den letzten Roll-Send (einmalig initialisieren)
    if (typeof window.__rt_lastRollSent !== 'number') {
      window.__rt_lastRollSent = 0;
    }

    if (isWriteAction(obj) && window.__rt_writeRequestPending) {
      return false;
    }

    if (isRollAction(obj)) {
      const now = Date.now();
      // Doppelklick-/Mehrfachklick-Schutz: alles < Guard seit letztem Roll wird verworfen
      if (now - window.__rt_lastRollSent < ROLL_GUARD_MS) {
        return false; // zu schnell hintereinander -> NICHT senden
      }
      window.__rt_lastRollSent = now;
    }

    // Senden nur, wenn der Socket offen ist – verhindert Fehler bei Race Conditions
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        if (isRollAction(obj)) haptic(12);
        else if (obj?.action === "set_hold") haptic(8);
        else if (isWriteAction(obj)) {
          beginPendingWrite();
          haptic([12, 24, 12]);
        }
        return true;
      }
    } catch (e) {
      // bewusst leise – wir wollen UI nicht blockieren; Logging kann bei Bedarf ergänzt werden
    }
    return false;
  }

  function showToast(message, options = {}) {
    if (window.ZDWA_UI?.toast) return window.ZDWA_UI.toast(message, options);
    console.info(message);
    return null;
  }

  function showNotice(options) {
    if (window.ZDWA_UI?.notice) return window.ZDWA_UI.notice(options);
    alert(options?.message || options?.title || "Hinweis");
    return Promise.resolve();
  }

  function askForConfirmation(options) {
    if (window.ZDWA_UI?.confirm) return window.ZDWA_UI.confirm(options);
    return Promise.resolve(confirm(options?.message || "Bestätigen?"));
  }

  async function askForWriteConfirmation(options) {
    if (writeConfirmationPending) return false;
    writeConfirmationPending = true;
    try { return await askForConfirmation(options); }
    finally { writeConfirmationPending = false; }
  }

  function leaveRoomAfterFatalError(message) {
    window._fatalWsClose = true;
    showNotice({ title: "Verbindung beendet", message, kind: "error", buttonLabel: "Zur Lobby" })
      .finally(() => { location.href = "/"; });
  }

  function pauseDurationLabel(snapshot){
    const label = snapshot?._timeout_label || snapshot?._pause_remaining_label;
    if (label) return String(label);
    const seconds = Number(snapshot?._timeout_seconds || 3600);
    const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
  }
