// static/room.js
// Orchestriert den Room-Client (WS, UI-Events, Scoreboard-Render, Reactions)

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

    // --- Mobile-Autofocus (Swipe vs. Auto-Follow) ---
  let _lastTurnPid = null;
  let _userScrollOverride = false;
  let _lastFilledCount = null; // Anzahl gefuellter schreibbarer Zellen

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

            const asNumber = (v) => (typeof v === "number" && isFinite(v)) ? v : null;
            const humanList = (arr) => {
              const names = (arr || []).filter(Boolean);
              if (names.length <= 1) return names[0] || "";
              return names.slice(0, -1).join(", ") + " und " + names[names.length - 1];
            };
            // Normalisiert verschiedene Ergebnis-Formate in ein {label, score}-Objekt
            const toLabel = (entry) => {
              if (!entry) return { label: "Unbekannt", score: null };

              // Team-Formate: {is_team:true, name, members:[...]} oder {team/team_name, players:[...]}
              const isTeam = entry.is_team || Array.isArray(entry.members) || entry.team || entry.team_name;
              if (isTeam) {
                const teamName = entry.name || entry.team || entry.team_name || "Team";
                const members = entry.members || entry.players || [];
                const label = members && members.length
                  ? `${teamName}, mit ${humanList(members)}`
                  : `${teamName}`;
                return { label, score: asNumber(entry.total) };
              }

              // Solo-Formate: {player, total} oder {name, total}
              const label = entry.player || entry.name || "Spieler";
              return { label, score: asNumber(entry.total) };
            };

            if (Array.isArray(res) && res.length > 0) {
              if (res.length === 1) {
                // Single-Player oder nur ein Teilnehmer → einfacher Sieger-Text
                const top = toLabel(res[0]);
                alert(`Spiel beendet – Sieger: ${top.label}${top.score != null ? ` (${top.score} Punkte)` : ""}`);
              } else {
                // Mehr als 1 Spieler/Team → Sieger + weitere Platzierungen
                const lines = [];
                lines.push("Spiel zu Ende, es gibt folgende Platzierungen:");
                const top = toLabel(res[0]);
                lines.push(`Sieger: ${top.label}${top.score != null ? ` (${top.score} Punkte)` : ""}`);
                if (res.length > 1) {
                  lines.push("Weitere Platzierungen:");
                  for (let i = 1; i < res.length; i++) {
                    const e = toLabel(res[i]);
                    lines.push(`${i + 1}. ${e.label}${e.score != null ? ` (${e.score} Punkte)` : ""}`);
                  }
                }
                alert(lines.join("\n"));
              }
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
    // aktuelle Scrollposition des alten Grids sichern (wichtig fuer Mobile)
    const _oldGrid = document.querySelector("#scoreOut .players-grid");
    const _oldScrollLeft = _oldGrid ? _oldGrid.scrollLeft : 0;
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

    // --- Scrollposition nach Re-Render bewahren, ausser bei gewolltem Fokuswechsel (Write+TurnChange)
    const filledNow = countFilledWritableCells(snapshot);
    const turnChanged = String(_lastTurnPid) !== String(turnPid);
    const wroteHappened = (_lastFilledCount !== null) ? (filledNow > _lastFilledCount) : false;

    const _newGrid = document.querySelector("#scoreOut .players-grid");
    // Wiederherstellen, wenn: Nutzer manuell uebersteuert ODER kein TurnChange ODER kein Schreiben
    if (_newGrid && (_userScrollOverride || !turnChanged || !wroteHappened)) {
      _newGrid.scrollLeft = _oldScrollLeft;
    }

    // --- Swipe-Override Binding (einmalig pro DOM-Aufbau) ---
    bindSwipeOverride();

    // --- Auto-Follow auf Mobile (Option D) ---
    autoFollowTurn(snapshot);
  }
    // --- Auto-Follow & Swipe-Override Helpers ---
  function isMobileNarrow(){
    try { return window.matchMedia && window.matchMedia("(max-width: 560px)").matches; }
    catch { return false; }
  }

  function bindSwipeOverride(){
    try {
      const grid = document.querySelector("#scoreOut .players-grid");
      if (!grid || grid._swipeBound) return;
      grid._swipeBound = true;

      const setOverride = () => { _userScrollOverride = true; };
      // Nutzerinteraktion, die eine manuelle Auswahl signalisiert
      grid.addEventListener("touchstart", setOverride, { passive: true });
      grid.addEventListener("pointerdown", setOverride, { passive: true });
      grid.addEventListener("wheel", setOverride, { passive: true });
    } catch {}
  }

  function autoFollowTurn(snapshot){
    try {
      if (!isMobileNarrow()) return;

      const turnPid = snapshot?._turn?.player_id || null;
      const filledNow = countFilledWritableCells(snapshot);

      // Initiales Setup beim ersten Snapshot: baseline setzen und einmal zur aktuellen Karte scrollen
      if (_lastTurnPid === null || _lastFilledCount === null) {
        _lastTurnPid = turnPid;
        _lastFilledCount = filledNow;

        const grid0 = document.querySelector("#scoreOut .players-grid");
        const target0 = grid0 ? grid0.querySelector(".player-card.turn") : null;
        if (grid0 && target0 && typeof target0.scrollIntoView === "function") {
          target0.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
        }
        return;
      }

      const turnChanged = String(_lastTurnPid) !== String(turnPid);
      const wroteHappened = (filledNow > _lastFilledCount);

      // Gewuenscht: Scroll NUR wenn wirklich geschrieben wurde UND der Zug uebergeht
      if (turnChanged && wroteHappened) {
        _userScrollOverride = false; // manueller Fokus endet beim Zugwechsel

        const grid = document.querySelector("#scoreOut .players-grid");
        const target = grid ? grid.querySelector(".player-card.turn") : null;
        if (grid && target && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
        }
      }

      // Baselines aktualisieren (immer)
      _lastTurnPid = turnPid;
      _lastFilledCount = filledNow;

    } catch {}
  }

  // --- Write-Detection: Anzahl gefuellter beschreibbarer Zellen ---
  function isFilledVal(v){ return !(v === undefined || v === null || v === ""); }
  function isWritableRowIndex(ri){
    // nutzt vorhandene WRITABLE_MAP: nur echte Schreibfelder zaehlen
    return WRITABLE_MAP.hasOwnProperty(ri);
  }

  function countFilledWritableCells(snapshot){
    try{
      let cnt = 0;
      // Einzel: _scoreboards { [pid]: {...} }, Team: _scoreboards_by_team { [teamId]: {...} }
      const bags = [];
      if (snapshot?._scoreboards && typeof snapshot._scoreboards === "object"){
        bags.push(...Object.values(snapshot._scoreboards));
      }
      if (snapshot?._scoreboards_by_team && typeof snapshot._scoreboards_by_team === "object"){
        bags.push(...Object.values(snapshot._scoreboards_by_team));
      }
      for (const sc of bags){
        if (!sc) continue;
        for (const k of Object.keys(sc)){
          const parts = k.split(",", 2);
          const ri = parseInt(parts[0], 10);
          if (!Number.isFinite(ri) || !isWritableRowIndex(ri)) continue;
          if (isFilledVal(sc[k])) cnt++;
        }
      }
      return cnt;
    } catch { return 0; }
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
    const sel   = $("#announceSelect", mount);
    const unbtn = $("#unannounceBtn", mount);

    // Sofort-Ansage bei Auswahl
    if (sel && !sel._bound) {
      sel._bound = true;
      sel.addEventListener("change", () => {
        const val = sel.value || "";
        if (!val) return;
        safeSend(ws, { action: "announce_row4", field: val });
      });
    }

    // "Ändern"-Button (ehem. Aufheben)
    if (unbtn && !unbtn._bound) {
      unbtn._bound = true;
      unbtn.addEventListener("click", () => {
        safeSend(ws, { action: "unannounce_row4" });
      });
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

        // Poker mit Punkten? -> nur confirmen, WENN Punkte nach Zockerregel NICHT erlaubt wären
        if (isPoker && points > 0) {
          // Server-paritätische Prüfung (roll_index / first4oak_roll / ❗-Ansage)
          const turn    = sb?._turn || {};
          const rollIdx = Number(turn.roll_index || 0);
          let   first4  = (turn.first4oak_roll ?? null);

          // has4/has5 aus aktuellen (oder Korrektur-)Würfeln
          const counts = {};
          for (const d of (diceForEval || [])) if (d > 0) counts[d] = (counts[d] || 0) + 1;
          const has4 = Object.values(counts).some(n => n >= 4);
          const has5 = Object.values(counts).some(n => n >= 5);

          const announcedPoker = (sb?._announced_row4 === "poker");
          const inAng = (field === "ang");

          // Fallback wie am Server: wenn 4 gleich & kein first4 gesetzt → first4 = aktueller Wurf
          if (has4 && !has5 && (first4 === null || first4 === undefined)) first4 = rollIdx;

          // Punkte erlaubt?
          let allowedPoints;
          if (inAng && announcedPoker) {
            // ❗ + Ansage "poker": Punkte in jedem Wurf mit 4/5 gleichen
            allowedPoints = (has4 || has5);
          } else {
            // ⬇︎／／⬆︎: nur im Wurf des ersten Vierlings ODER bei 5 gleichen
            allowedPoints = (has5 || (has4 && first4 && rollIdx === Number(first4)));
          }

          if (allowedPoints) {
            // Legal → ohne Prompt normal schreiben (KEIN strike)
            if (iAmCorrector) {
              safeSend(ws, { action: "write_field_correction", row, field });
            } else {
              safeSend(ws, { action: "write_field", row, field });
            }
          } else {
            // Nicht legal → Confirm zum Streichen
            const ok = confirm('Zockerregel: Nach "zocken" darf ein Poker nicht mehr geschrieben werden. Willst du den Poker wirklich streichen?');
            if (!ok) return; // Spieler darf neu wählen
            if (iAmCorrector) {
              safeSend(ws, { action: "write_field_correction", row, field, strike: true });
            } else {
              safeSend(ws, { action: "write_field", row, field, strike: true });
            }
          }
          return;
        }

        // Sonderfall: Poker ohne Punkte, aber Reihenfolge (⬇︎/⬆︎) wäre nicht dran
        // -> keine Strike-Bestätigung anzeigen, da Server das ohnehin ablehnt.
        if (isPoker && points === 0 && (field === "down" || field === "up")) {
          // Reihenfolge lokal prüfen wie am Server (_next_required_row)
          const ORDER_DOWN = [0,1,2,3,4,5,9,10,12,13,14,15];
          const order = field === "down" ? ORDER_DOWN : ORDER_DOWN.slice().reverse();

          // Board bestimmen (Team oder Einzel)
          let board = {};
          const mode = String(sb?._mode || "").toLowerCase();
          if (mode === "2v2" && Array.isArray(sb?._teams)) {
            const myTeam = (sb._teams.find(t => (t.members || []).some(m => String(m) === String(myId))) || {}).id;
            board = (sb._scoreboards_by_team && myTeam) ? (sb._scoreboards_by_team[myTeam] || {}) : {};
          } else {
            board = (sb?._scoreboards?.[myId]) || {};
          }

          const filled = new Set(
            Object.keys(board)
              .filter(k => k.endsWith(`,${field}`))
              .map(k => parseInt(k.split(",")[0], 10))
              .filter(Number.isFinite)
          );
          const nextRow = order.find(r => !filled.has(r));

          if (Number.isFinite(nextRow) && row !== nextRow) {
            // Nicht „dran“ -> Strike-Dialog NICHT zeigen; Aktion abbrechen.
            return;
          }
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