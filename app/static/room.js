// static/room.js
// Orchestriert den Room-Client (WS, UI-Events, Scoreboard-Render, Reactions)

import { initChat, addChatMessage } from "./chat.js";

(() => {
  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getQS() {
    const u = new URL(location.href);
    return {
      game_id: u.searchParams.get("game_id") || "",
      name: u.searchParams.get("name") || "Gast",
      pass: u.searchParams.get("pass") || ""  // kann leer sein
    };
  }

  function wsURL(gid) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/${encodeURIComponent(gid)}`;
  }

  function safeSend(ws, obj) {
    try { ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj)); } catch {}
  }

  // ---------- State ----------
  const qs = getQS();
  if (!qs.game_id) {
    alert("Fehlende game_id. Zur Lobby.");
    location.href = "/"; // FastAPI root -> /static/index.html
    return;
  }

  const PID_KEY = `wuerfler_pid_${qs.game_id}`;
  let myId = sessionStorage.getItem(PID_KEY) || null;
  let myName = (qs.name || "Gast").trim() || "Gast";

  let ws = null;
  let sb = null; // letzter Snapshot
  let justJoined = false;

  // Mount für das Scoreboard
  const mount = document.getElementById("scoreOut") || (()=>{
    const d = document.createElement("div");
    d.id = "scoreOut";
    document.body.appendChild(d);
    return d;
  })();

  // Reactions-Mount optional herstellen, falls nicht bereits in room.html vorhanden
  const reactionsMount = document.getElementById("reactionsBar") || (()=>{
    const r = document.createElement("div");
    r.id = "reactionsBar";
    r.style.margin = ".5rem 0";
    document.body.prepend(r);
    return r;
  })();

  // ---------- WebSocket ----------
  function connect() {
    ws = new WebSocket(wsURL(qs.game_id));

    ws.addEventListener("open", () => {
        initChat(ws);
        if (myId) {
        // Rejoin
        safeSend(ws, { action: "rejoin_game", player_id: myId });
      } else {
        // Join
        justJoined = true;
        safeSend(ws, {
          action: "join_game",
          name: myName,
          pass: qs.pass
        });
      }
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      // Join-Response
      if (msg.player_id && !myId) {
        myId = String(msg.player_id);
        sessionStorage.setItem(PID_KEY, myId);
      }

      // Fehler (z.B. falsche Passphrase)
      if (msg.error) {
        console.warn("Serverfehler:", msg.error);
        // bei Passphrase-Fehler: zurück zur Lobby
        if (/passphrase/i.test(msg.error) || /pass/i.test(msg.error)) {
          alert("Beitritt abgelehnt: " + msg.error);
          location.href = "/static/index.html";
          return;
        }
      }

      // Scoreboard
      if (msg.scoreboard) {
        sb = msg.scoreboard;
        renderFromSnapshot(sb);
      }
    // Quick-Reaction empfangen & anzeigen
      if (msg.emoji && window.QuickReactions && typeof window.QuickReactions.show === "function") {
        window.QuickReactions.show(msg.emoji);
      }
    // Chat: einzelne Nachricht
      if (msg.chat && typeof msg.chat === "object") {
        const sender = msg.chat.sender || "???";
        const text = msg.chat.text || "";
        if (text) addChatMessage(sender, text);
      }

      // Chat: optionale History
      if (Array.isArray(msg.chat_history)) {
        msg.chat_history.forEach(m => {
          if (m && typeof m === "object" && m.text) {
            addChatMessage(m.sender || "???", m.text);
          }
        });
      }
    });

    ws.addEventListener("close", () => {
      // Bei Kick wegen falscher Passphrase o.ä. nicht reconnecten.
      // Ansonsten sanfter Auto-Reconnect
      setTimeout(connect, 1000);
    });
  }
  connect();

  // ---------- Render & Events ----------
  function renderFromSnapshot(snapshot) {
    // UI-Flags vorbereiten
    const turnPid = snapshot?._turn?.player_id || null;
    const iAmTurn = turnPid && String(turnPid) === String(myId);
    const rollsUsed = snapshot?._rolls_used ?? 0;
    const rollsMax = snapshot?._rolls_max ?? 3;
    const announced = snapshot?._announced_row4 || null;

    // Scoreboard zeichnen (kommt aus static/scoreboard.js)
    window.renderScoreboard(mount, snapshot, {
      myPlayerId: myId,
      iAmTurn,
      rollsUsed,
      rollsMax,
      announcedRow4: announced,
      canRequestCorrection: canRequestCorrection(snapshot)
    });

    // Interaktionen verdrahten
    wireDiceBar();
    wireAnnounceUI();
    wireGridClicks();

    // Quick-Reactions andocken (falls Datei geladen wurde)
    if (window.QuickReactions && typeof window.QuickReactions.init === "function") {
      window.QuickReactions.init({
        mount: reactionsMount,
        ws,
        me: { id: myId, name: myName }
      });
    }

    // 1P Auto-Roll Trigger (Server setzt _auto_single)
    if (snapshot._auto_single && iAmTurn) {
      safeSend(ws, { action: "roll_dice" });
    }

    // Abgebrochen? -> Hinweis & ggf. zurück
    if (snapshot._aborted) {
      // keine Leaderboard-Einträge, Spiel ist beendet
      // optional: zurück zur Lobby
      // location.href = "/static/index.html";
    }
  }

  function canRequestCorrection(snapshot) {
    // Button „Letzten Eintrag ändern“ nur zeigen, wenn:
    // - ich einen letzten Eintrag habe (vom Server indirekt über _has_last)
    // - KEIN Ansage-Zug war (wird serverseitig endgültig geprüft)
    // - und momentan keine Korrektur aktiv ist
    const hasLast = snapshot?._has_last && snapshot._has_last[myId];
    const corrActive = !!(snapshot?._correction?.active);
    return !!(hasLast && !corrActive);
  }

  // --- DiceBar, Hold, Roll, Correction ---
  function wireDiceBar() {
    const rollBtn = $("#rollBtnInline", mount);
    if (rollBtn) {
      rollBtn.addEventListener("click", () => safeSend(ws, { action: "roll_dice" }));
    }

    // Würfel halten/lösen
    $$("#diceBar .die", mount).forEach(btn => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        const held = btn.classList.contains("held");
        const holds = $$("#diceBar .die", mount).map(b => b.classList.contains("held"));
        holds[i] = !held;
        safeSend(ws, { action: "set_hold", holds });
      });
    });

    // Korrektur anfragen
    const reqBtn = $("#requestCorrectionBtn", mount);
    if (reqBtn) {
      reqBtn.addEventListener("click", () => safeSend(ws, { action: "request_correction" }));
    }

    // ESC -> Korrektur abbrechen (wenn ich korrigiere)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sb?._correction?.active && String(sb._correction.player_id) === String(myId)) {
        safeSend(ws, { action: "cancel_correction" });
      }
    });
  }

  // --- Ansage UI (❗) ---
  function wireAnnounceUI() {
    const btn = $("#announceBtn", mount);
    const sel = $("#announceSelect", mount);
    const unbtn = $("#unannounceBtn", mount);

    if (btn && sel) {
      btn.addEventListener("click", () => {
        const val = sel.value || "";
        if (!val) return;
        safeSend(ws, { action: "announce_row4", field: val });
      });
    }

    if (unbtn) {
      unbtn.addEventListener("click", () => {
        safeSend(ws, { action: "unannounce_row4" });
      });
    }
  }

  // --- Grid Clicks (write_field / write_field_correction) ---
  function wireGridClicks() {
    // Delegation auf das Table-Grid
    mount.addEventListener("click", (e) => {
      const td = e.target.closest("td.cell.clickable");
      if (!td) return;
      const row = td.getAttribute("data-row");
      const field = td.getAttribute("data-field");
      if (!row || !field) return;

      const correctionActive = !!(sb?._correction?.active);
      const iAmCorrector = correctionActive && String(sb._correction.player_id) === String(myId);

      if (iAmCorrector) {
        safeSend(ws, { action: "write_field_correction", row: Number(row), field });
      } else {
        safeSend(ws, { action: "write_field", row: Number(row), field });
      }
    });
  }
})();