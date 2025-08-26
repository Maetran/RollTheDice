// static/room.js
// Orchestriert den Room-Client (WS, UI-Events, Scoreboard-Render, Reactions) – konsolidiert (game.js -> room.js)

import { initChat, addChatMessage } from "./chat.js";

(() => {
  // ---------- Helpers ----------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getQS() {
    const u = new URL(location.href);
    return {
      game_id: u.searchParams.get("game_id") || "",
      name:   (u.searchParams.get("name") || "Gast").trim() || "Gast",
      pass:   u.searchParams.get("pass") || ""
    };
  }

  function wsURL(gid) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/${encodeURIComponent(gid)}`;
  }

  function safeSend(ws, obj) {
    try { ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj)); } catch {}
  }

  // --- Client-Punkteberechnung (nur für 0-Confirm UX) ---
  // Map der schreibbaren Reihen -> Feldkey
  const WRITABLE_MAP = {
    0:"1",1:"2",2:"3",3:"4",4:"5",5:"6",
    9:"max",10:"min",12:"kenter",13:"full",14:"poker",15:"60"
  };

  function calculatePoints(fieldKey, dice) {
    const cnt = {};
    let total = 0;
    for (const d of (dice || [])) {
      if (d > 0) { cnt[d] = (cnt[d] || 0) + 1; total += d; }
    }
    if (["1","2","3","4","5","6"].includes(fieldKey)) {
      const face = parseInt(fieldKey, 10);
      return (cnt[face] || 0) * face;
    }
    if (fieldKey === "max" || fieldKey === "min") return total;
    if (fieldKey === "kenter") return Object.keys(cnt).length === 5 ? 35 : 0;
    if (fieldKey === "full") {
      const values = Object.values(cnt).sort((a,b)=>a-b);
      if (values.length === 1 && values[0] === 5) {
        const face = parseInt(Object.keys(cnt)[0], 10);
        return 40 + 3 * face;
      }
      if (values.length === 2 && values[0] === 2 && values[1] === 3) {
        const face3 = parseInt(Object.keys(cnt).find(k => cnt[k] === 3), 10);
        return 40 + 3 * face3;
      }
      return 0;
    }
    if (fieldKey === "poker") {
      for (const [face, n] of Object.entries(cnt)) if (n === 4) return 50 + 4*parseInt(face,10);
      return 0;
    }
    if (fieldKey === "60") {
      for (const [face, n] of Object.entries(cnt)) if (n === 5) return 60 + 5*parseInt(face,10);
      return 0;
    }
    return 0;
  }

  // ---------- State ----------
  const qs = getQS();
  if (!qs.game_id) { alert("Fehlende game_id. Zur Lobby."); location.href = "/"; return; }

  const PID_KEY = `wuerfler_pid_${qs.game_id}`;
  let myId   = sessionStorage.getItem(PID_KEY) || null;
  let myName = qs.name;

  let ws = null;
  let sb = null; // letzter Snapshot
  let sendLock = { write:false, roll:false };
  let autoRollLock = false;
  const DEBUG_P_HOTKEY = false; // optionaler Debug-Hotkey "p" -> Poker/Free

  // Mounts
  const mount = document.getElementById("scoreOut") || (() => {
    const d = document.createElement("div"); d.id = "scoreOut"; document.body.appendChild(d); return d;
  })();
  const reactionsMount = document.getElementById("reactionsBar") || (() => {
    const r = document.createElement("div"); r.id = "reactionsBar"; r.style.margin = ".5rem 0"; document.body.prepend(r); return r;
  })();

  // ---------- WebSocket ----------
  function connect() {
    ws = new WebSocket(wsURL(qs.game_id));

    ws.addEventListener("open", () => {
      initChat(ws, { meName: myName });
      if (myId) safeSend(ws, { action: "rejoin_game", player_id: myId });
      else      safeSend(ws, { action: "join_game", name: myName, pass: qs.pass });
    });

    ws.addEventListener("message", (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }

      // Join-Response
      if (msg.player_id && !myId) {
        myId = String(msg.player_id);
        sessionStorage.setItem(PID_KEY, myId);
      }

      // Fehler
      if (msg.error) {
        console.warn("Serverfehler:", msg.error);
        if (/passphrase/i.test(msg.error) || /pass/i.test(msg.error)) {
          alert("Beitritt abgelehnt: " + msg.error);
          location.href = "/static/index.html";
          return;
        }
      }

      // Scoreboard-Update
      if (msg.scoreboard) {
        sb = msg.scoreboard;
        renderFromSnapshot(sb);

        // Spielende
        if (sb && sb._finished) {
          try {
            const res = (sb._results || sb.results) || [];
            if (Array.isArray(res) && res.length > 0) {
              const top = res[0];
              alert(`Spiel beendet – Sieger: ${top.player} (${top.total} Punkte)`);
            } else {
              alert("Spiel beendet.");
            }
          } catch {}
          setTimeout(() => { location.href = "/static/index.html"; }, 600);
          return;
        }
      }

      // Quick-Reaction
      if (msg.emoji && window.QuickReactions?.show) window.QuickReactions.show(msg.emoji);

      // Chat-Varianten
      if (msg.chat && typeof msg.chat === "object") {
        const sender = msg.chat.sender || "???"; const text = msg.chat.text || ""; if (text) addChatMessage(sender, text);
      } else if (msg.type === "chat" && msg.text) {
        addChatMessage(msg.sender || "???", msg.text);
      } else if (msg.message && msg.sender) {
        addChatMessage(msg.sender, msg.message);
      } else if (msg.kind === "chat" && msg.payload?.text) {
        addChatMessage(msg.payload.sender || "???", msg.payload.text);
      }

      if (Array.isArray(msg.chat_history)) {
        msg.chat_history.forEach(m => { if (m?.text) addChatMessage(m.sender || "???", m.text); });
      }
    });

    ws.addEventListener("close", () => setTimeout(connect, 1000));
  }
  connect();

  // ---------- Render & Events ----------
  function renderFromSnapshot(snapshot) {
    const turnPid   = snapshot?._turn?.player_id || null;
    const iAmTurn   = turnPid && String(turnPid) === String(myId);
    const rollsUsed = snapshot?._rolls_used ?? 0;
    const rollsMax  = snapshot?._rolls_max ?? 3;
    const announced = snapshot?._announced_row4 || null;

    window.renderScoreboard(mount, snapshot, {
      myPlayerId: myId,
      iAmTurn,
      rollsUsed,
      rollsMax,
      announcedRow4: announced,
      canRequestCorrection: canRequestCorrection(snapshot)
    });

    wireDiceBar();
    wireAnnounceUI();
    wireGridClicks();
    ensureKeybindings(); // alle Hotkeys hier

    if (window.QuickReactions?.init) {
      window.QuickReactions.init({ mount: reactionsMount, ws, me: { id: myId, name: myName } });
    }

    // Suggestions (informativ)
    renderSuggestions(Array.isArray(snapshot.suggestions) ? snapshot.suggestions : []);

    // 1P Auto-Roll
    if (snapshot._auto_single && iAmTurn) safeSend(ws, { action: "roll_dice" });

    // Chat-Breite angleichen
    syncChatWidth();
  }

  function canRequestCorrection(snapshot) {
    const isSingle  = Number(snapshot?._expected || 0) === 1;
    if (isSingle) return false;
    const hasLast   = snapshot?._has_last && snapshot._has_last[myId];
    const corrActive= !!(snapshot?._correction?.active);
    return !!(hasLast && !corrActive);
  }

  // --- Chatbreite ---
  function syncChatWidth() {
    try {
      const grid = document.querySelector("#scoreOut .players-grid");
      const chat = document.querySelector(".chat-panel");
      if (!grid || !chat) return;
      const w = Math.ceil(grid.getBoundingClientRect().width);
      chat.style.maxWidth = w + "px";
      chat.style.marginLeft = "1rem";
      chat.style.marginRight = "1rem";
    } catch {}
  }
  window.addEventListener("resize", syncChatWidth);

  // --- Suggestions (nur Anzeige) ---
  function renderSuggestions(suggestions){
    try{
      const mountEl = document.querySelector("#suggestions");
      if (!mountEl) return;
      const items = (suggestions || []).filter(s => s && s.eligible);
      const order = { POKER:0, SIXTY:1, FULL:2, KENTER:3, MAX:4, MIN:5 };
      items.sort((a,b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
      const html = items.map(s => {
        const label = s.label || s.type || "";
        const pts = (typeof s.points === "number") ? ` (<span class="points">${s.points}</span>)` : "";
        return `<div class="suggestion-btn" aria-hidden="true">${label}${pts}</div>`;
      }).join("");
      mountEl.innerHTML = html;
    } catch {}
  }

  // --- DiceBar: Hold/Unhold, Roll, Correction-Request, ESC-Cancel ---
  function wireDiceBar() {
    const rollBtn = $("#rollBtnInline", mount);

    if (rollBtn && !rollBtn._shakeBound) {
      rollBtn._shakeBound = true;
      rollBtn.addEventListener("click", () => {
        const diceEls = $$("#diceBar .die", mount);
        diceEls.forEach(el => el.classList.remove("shaking"));
        diceEls.forEach(el => { if (!el.classList.contains("held")) el.classList.add("shaking"); });
        setTimeout(() => { safeSend(ws, { action: "roll_dice" }); }, 120);
        setTimeout(() => { $$("#diceBar .die", mount).forEach(el => el.classList.remove("shaking")); }, 520);
      });
    }

    $$("#diceBar .die", mount).forEach(btn => {
      if (btn._holdBound) return;
      btn._holdBound = true;
      btn.addEventListener("click", () => {
        btn.classList.remove("shaking");
        const i = Number(btn.dataset.i);
        const holds = $$("#diceBar .die", mount).map(b => b.classList.contains("held"));
        holds[i] = !holds[i];
        safeSend(ws, { action: "set_hold", holds });
      });
    });

    const reqBtn = $("#requestCorrectionBtn", mount);
    if (reqBtn && !reqBtn._bound) {
      reqBtn._bound = true;
      reqBtn.addEventListener("click", () => safeSend(ws, { action: "request_correction" }));
    }

    if (!document._escCorrBound) {
      document._escCorrBound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && sb?._correction?.active && String(sb._correction.player_id) === String(myId)) {
          safeSend(ws, { action: "cancel_correction" });
        }
      });
    }
  }

  // --- Ansage (❗) ---
  function wireAnnounceUI() {
    const btn   = $("#announceBtn", mount);
    const sel   = $("#announceSelect", mount);
    const unbtn = $("#unannounceBtn", mount);

    if (btn && sel && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", () => {
        const val = sel.value || "";
        if (!val) return;
        safeSend(ws, { action: "announce_row4", field: val });
      });
    }
    if (unbtn && !unbtn._bound) {
      unbtn._bound = true;
      unbtn.addEventListener("click", () => safeSend(ws, { action: "unannounce_row4" }));
    }
  }

  // --- Grid-Klicks (mit 0-Confirm) ---
  function wireGridClicks() {
    if (mount._gridBound) return;
    mount._gridBound = true;

    mount.addEventListener("click", (e) => {
      const td = e.target.closest("td.cell.clickable");
      if (!td) return;
      const row   = Number(td.getAttribute("data-row"));
      const field = td.getAttribute("data-field");
      if (!Number.isFinite(row) || !field) return;

      const correctionActive = !!(sb?._correction?.active);
      const iAmCorrector = correctionActive && String(sb._correction.player_id) === String(myId);

      // 0-Confirm (Clientseitig)
      const fieldKey    = WRITABLE_MAP[row];
      const diceForEval = iAmCorrector && Array.isArray(sb?._correction?.dice)
        ? sb._correction.dice
        : (sb?._dice || []);

      if (fieldKey) {
        const points  = calculatePoints(fieldKey, diceForEval);
        const isPoker = fieldKey === "poker";

        // Poker mit Punkten? -> immer sofort schreiben, KEIN Strike-Dialog
        if (isPoker && points > 0) {
          if (iAmCorrector) {
            safeSend(ws, { action: "write_field_correction", row, field });
          } else {
            safeSend(ws, { action: "write_field", row, field });
          }
          return;
        }

        // Nur wenn der berechnete Wert wirklich 0 ist, nachfragen (Strike)
        if (points === 0) {
          const ok = confirm("Willst du dieses Feld wirklich streichen?");
          if (!ok) return;
        }
      }

      if (iAmCorrector) {
        safeSend(ws, { action: "write_field_correction", row, field });
      } else {
        safeSend(ws, { action: "write_field", row, field });
      }
    });
  }

  // ---------- Hotkeys ----------
  function canRollNow() {
    if (!sb) return false;
    const iAmTurn = sb?._turn && String(sb._turn.player_id) === String(myId);
    return iAmTurn && !(sb?._correction?.active) && ((sb?._rolls_used || 0) < (sb?._rolls_max || 3));
  }

  function safeRoll() {
    if (!canRollNow() || sendLock.roll) return;
    sendLock.roll = true;
    try { safeSend(ws, { action: "roll_dice" }); }
    finally { setTimeout(() => { sendLock.roll = false; }, 200); }
  }

  function ensureKeybindings() {
    if (document._roomKeysBound) return;
    document._roomKeysBound = true;

    document.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();

      // Korrektur abbrechen (ESC) – bereits global in wireDiceBar gesetzt; hier nur Guard
      if (key === "escape") {
        if (sb?._correction?.active && String(sb._correction.player_id) === String(myId)) {
          safeSend(ws, { action: "cancel_correction" });
          e.preventDefault();
        }
        return;
      }

      // Inputs nicht hijacken
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // 1..5: Hold toggle (Zuginhaber oder eigener Korrekturmodus)
      if (["1","2","3","4","5"].includes(key)) {
        const idx = parseInt(key, 10) - 1;
        const iAmTurn = sb?._turn && String(sb._turn.player_id) === String(myId);
        const iCorrectingMine = !!(sb?._correction?.active && String(sb._correction.player_id) === String(myId));
        if (!iAmTurn && !iCorrectingMine) return;

        const holdsEls = $$("#diceBar .die", mount);
        const next = holdsEls.map(b => b.classList.contains("held"));
        next[idx] = !next[idx];
        safeSend(ws, { action: "set_hold", holds: next });
        e.preventDefault();
        return;
      }

      // Space / r: würfeln
      if (key === " " || key === "spacebar" || key === "r") {
        if (canRollNow()) { safeRoll(); e.preventDefault(); }
        return;
      }

      // a: Ansage (falls UI vorhanden)
      if (key === "a") {
        const btn = $("#announceBtn", mount);
        const sel = $("#announceSelect", mount);
        if (btn && sel && !btn.disabled && !sel.disabled) { btn.click(); e.preventDefault(); }
        return;
      }

      // u: Ansage aufheben
      if (key === "u") {
        const btn = $("#unannounceBtn", mount);
        if (btn && !btn.disabled) { btn.click(); e.preventDefault(); }
        return;
      }

      // k: Korrektur anfragen
      if (key === "k") {
        const btn = $("#requestCorrectionBtn", mount);
        if (btn && !btn.disabled) { btn.click(); e.preventDefault(); }
        return;
      }

      // p: (optional) Debug – Poker/Free schreiben
      if (DEBUG_P_HOTKEY && key === "p") {
        safeSend(ws, { action: "write_field", row: 14, field: "free" }); // 14 = poker
        e.preventDefault();
        return;
      }
    });
  }

  // ---------- Utils ----------
  function esc(s){
    return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  }
})();