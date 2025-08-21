// static/game.js
// Client-Logik für den Spielraum (WebSocket, UI, Click-Handling, Confirm bei 0-Punkten)

(() => {
  // ===== Helpers =====
  const qs = new URLSearchParams(location.search);
  const GAME_ID = qs.get("game_id");
  const MY_NAME = (qs.get("name") || localStorage.getItem("wuerfler_name") || "Gast").trim() || "Gast";
  const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + encodeURIComponent(GAME_ID);

  // Würfel-Zeichen: 1..6 -> ⚀..⚅
  const DIE_FACE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

  // UI-Elemente (optional vorhanden – je nach room.html-Version)
  const diceBar          = document.getElementById("diceBar");            // wird von scoreboard.js gerendert
  const undoBtn          = document.getElementById("undoBtn");
  const announceChip     = document.getElementById("announceChip") || document.getElementById("roomStatusLine");
  const turnChip         = document.getElementById("turnChip") || document.getElementById("roomStatusLine");
  const playerChips      = document.getElementById("playerChips") || document.getElementById("roomPlayerBubbles");
  const gameTitleH       = document.getElementById("gameTitle") || document.getElementById("roomGameName");
  const correctionBanner = document.getElementById("correctionBanner");
  const scoreOut         = document.getElementById("scoreOut") || document.body;

  // ===== Spielzustand (Client) =====
  let ws = null;
  let myPlayerId = localStorage.getItem("pid_" + GAME_ID) || null;

  // Snapshot-Infos vom Server (werden in render() genutzt)
  const S = {
    name: "",
    players: [],
    playersJoined: 0,
    expected: 0,
    started: false,
    finished: false,
    turn: null,
    dice: [0,0,0,0,0],
    holds: [false,false,false,false,false],
    rollsUsed: 0,
    rollsMax: 3,
    scoreboards: {},
    announcedRow4: null,
    correction: { active:false },
    hasLast: {},
  };

  // ===== Mappings (Zeilen) =====
  const WRITABLE_MAP = {
    0: "1", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6",
    9: "max", 10: "min", 12: "kenter", 13: "full", 14: "poker", 15: "60",
  };

  // ===== Punkteberechnung (Client) =====
  function calculatePoints(fieldKey, dice) {
    const cnt = {};
    let total = 0;
    for (const d of (dice || [])) {
      if (d > 0) {
        cnt[d] = (cnt[d] || 0) + 1;
        total += d;
      }
    }
    if (["1","2","3","4","5","6"].includes(fieldKey)) {
      const face = parseInt(fieldKey, 10);
      return (cnt[face] || 0) * face;
    }
    if (fieldKey === "max" || fieldKey === "min") {
      return total;
    }
    if (fieldKey === "kenter") {
      return Object.keys(cnt).length === 5 ? 35 : 0;
    }
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
      for (const [face, n] of Object.entries(cnt)) {
        if (n === 4) return 50 + 4 * parseInt(face, 10);
      }
      return 0;
    }
    if (fieldKey === "60") {
      for (const [face, n] of Object.entries(cnt)) {
        if (n === 5) return 60 + 5 * parseInt(face, 10);
      }
      return 0;
    }
    return 0;
  }

  // ===== WebSocket =====
  function connect() {
    if (!GAME_ID) {
      alert("Kein game_id in der URL.");
      return;
    }
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      if (myPlayerId) {
        ws.send(JSON.stringify({ action: "rejoin_game", player_id: myPlayerId }));
      } else {
        ws.send(JSON.stringify({ action: "join_game", name: MY_NAME }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.player_id) {
          myPlayerId = msg.player_id;
          localStorage.setItem("pid_" + GAME_ID, myPlayerId);
          return;
        }
        if (msg.error) {
          console.warn("Server:", msg.error);
          if (!msg.error.toLowerCase().includes("nicht an der reihe")) {
            alert(msg.error);
          }
          return;
        }
        if (msg.scoreboard) {
          applySnapshot(msg.scoreboard);
          render();
        }
      } catch (e) {
        console.error("WS parse", e);
      }
    };

    ws.onclose = () => {
      console.warn("WS closed, reconnecting in 1.5s…");
      setTimeout(connect, 1500);
    };
  }

  // ===== Snapshot übernehmen =====
  function applySnapshot(s) {
    S._raw         = s;                   // Raw Snapshot für scoreboard.js
    S.name         = s._name;
    S.players      = s._players || [];
    S.playersJoined= s._players_joined || 0;
    S.expected     = s._expected || 0;
    S.started      = !!s._started;
    S.finished     = !!s._finished;
    S.turn         = s._turn || null;
    S.dice         = s._dice || [0,0,0,0,0];
    S.holds        = s._holds || [false,false,false,false,false];
    S.rollsUsed    = s._rolls_used || 0;
    S.rollsMax     = s._rolls_max || 3;
    S.scoreboards  = s._scoreboards || {};
    S.announcedRow4= s._announced_row4 || null;
    S.correction   = s._correction || {active:false};
    S.hasLast      = s._has_last || {};
  }

  // ===== Rendering =====
  function render() {
    if (gameTitleH) {
      gameTitleH.textContent = S.name || "Spiel";
    }

    if (playerChips) {
      playerChips.innerHTML = (S.players || []).map(p => {
        const me  = String(p.id) === String(myPlayerId);
        const extra = me ? " (du)" : "";
        return `<span class="badge">${esc(p.name)}${extra}</span>`;
      }).join(" ");
    }

    const iAmTurn = S.turn && String(S.turn.player_id) === String(myPlayerId);

    if (turnChip) {
      const txt = iAmTurn ? "Du bist dran" : "Warte auf Gegner …";
      turnChip.textContent = txt;
      turnChip.className = "chip " + (iAmTurn ? "ok" : "wait");
    }

    if (announceChip && announceChip.id === "announceChip") {
      announceChip.textContent = "Angesagt: " + (S.announcedRow4 ? S.announcedRow4 : "—");
      announceChip.className = "chip info";
    }

    if (correctionBanner) {
      const show = !!(S.correction && S.correction.active && S.correction.player_id && String(S.correction.player_id) !== String(myPlayerId));
      correctionBanner.style.display = show ? "block" : "none";
    }



    if (undoBtn) {
      const canUndo = !!S.hasLast?.[myPlayerId] && !iAmTurn && S.rollsUsed === 0 && !(S.correction?.active);
      undoBtn.disabled = !canUndo;
    }

    // Scoreboard (liefert u.a. #diceBar und #rollBtnInline)
    if (window.renderScoreboard) {
      window.renderScoreboard(scoreOut, S._raw, {
        myPlayerId,
        iAmTurn,
        rollsUsed: S.rollsUsed,
        rollsMax: S.rollsMax,
        announcedRow4: S.announcedRow4,
        canRequestCorrection: !!S.hasLast?.[myPlayerId] &&
                              !iAmTurn &&
                              S.rollsUsed === 0 &&
                              !(S.correction?.active)
      });
    }

    // Würfel-Controls an bereits gerendertes DOM hängen
    hydrateDiceControls();

    // KEIN renderDice() mehr!
    renderAnnounce();

    // Delegation für Klicks/Keys
    ensureDelegatedHandlers(iAmTurn);
  }

  // ===== Würfel-Controls an bereits gerendertes DOM anhängen =====
  function hydrateDiceControls() {
    const bar = document.getElementById("diceBar");
    if (!bar) return;

    // Würfel-Buttons aktualisieren (Face + held-Status) und Click-Handler setzen
    const dieBtns = bar.querySelectorAll("button.die");
    for (let i = 0; i < 5; i++) {
      const btn = dieBtns[i];
      if (!btn) continue;
      const val = S.dice[i] || 0;
      const held = !!S.holds[i];
      btn.textContent = val ? DIE_FACE[val] : "";
      btn.classList.toggle("held", held);
      btn.dataset.i = String(i);
    }

    // Click-Delegation für Halten/Lösen
    bar.onclick = (ev) => {
      const b = ev.target.closest("button.die");
      if (!b) return;
      // Während Korrektur darf nur der Korrektur-Spieler togglen
      if (S.correction?.active && S.correction?.player_id && String(S.correction.player_id) !== String(myPlayerId)) return;
      const i = parseInt(b.dataset.i, 10);
      const next = S.holds.slice();
      next[i] = !next[i];
      ws.send(JSON.stringify({ action: "set_hold", holds: next }));
    };

    // Inline-Button aus scoreboard.js verwenden
    const rollInline = document.getElementById("rollBtnInline");
    if (rollInline) {
      const iAmTurn = S.turn && String(S.turn.player_id) === String(myPlayerId);
      const canRoll = iAmTurn && !S.correction?.active && (S.rollsUsed < S.rollsMax);
      rollInline.disabled = !canRoll;
      rollInline.onclick = () => {
        if (!canRoll) return;
        ws.send(JSON.stringify({ action: "roll_dice" }));
      };
    }
  }

  // ===== Ansage (UI) =====
  function renderAnnounce() {
    // Elemente JETZT (nach Render) frisch holen – …
    const announceSel  = document.getElementById("announceSelect");
    const announceBtn  = document.getElementById("announceBtn");
    const announceSlot = document.getElementById("announceSlot"); // Container aus scoreboard.js

    // Wenn scoreboard.js gerade den Status ("Angesagt: …") zeigt, existieren Select/Btn nicht – dann nichts tun.
    if (!announceSlot || !announceSel || !announceBtn) return;

    const iAmTurn = S.turn && String(S.turn.player_id) === String(myPlayerId);

    // robust: „nach Wurf 1“ gilt, wenn (rollsUsed === 1) ODER die Würfel schon Werte > 0 tragen
    const afterFirstRoll =
      (S.rollsUsed === 1) ||
      (S.rollsUsed === 0 && Array.isArray(S.dice) && S.dice.some(v => v > 0));

    const canAnnounce = iAmTurn && !S.correction?.active && !S.announcedRow4 && afterFirstRoll;

    // Optional: bereits belegte ❗-Felder filtert scoreboard.js, hier nur Enable/Disable und Handler setzen
    announceSel.disabled = !canAnnounce;
    announceBtn.disabled = !canAnnounce;

    announceBtn.onclick = () => {
      if (!canAnnounce) return;
      const f = announceSel.value;
      if (!f) return;
      ws.send(JSON.stringify({ action: "announce_row4", field: f }));
    };
  }

  // ===== Delegierter Handler für Scoreboard-Zellen =====
  let delegatedBound = false;
  function ensureDelegatedHandlers(iAmTurn) {
    if (delegatedBound) return;
    delegatedBound = true;

    // Klick auf Score-Felder (inkl. Confirm bei 0)
    // Klick auf Score-Felder (inkl. Confirm bei 0)
    document.addEventListener("click", (ev) => {
      const td = ev.target.closest("td.cell.clickable");
      if (!td) return;

      const row = parseInt(td.getAttribute("data-row"), 10);
      const col = td.getAttribute("data-field");
      if (Number.isNaN(row) || !col) return;

      const iCorrecting = !!(S.correction?.active && S.correction?.player_id && String(S.correction.player_id) === String(myPlayerId));
      const myTurn = S.turn && String(S.turn.player_id) === String(myPlayerId);
      if (!myTurn && !iCorrecting) return;

      const fieldKey = WRITABLE_MAP[row];
      const diceForEval = iCorrecting && Array.isArray(S.correction?.dice) ? S.correction.dice : S.dice;
      const points = calculatePoints(fieldKey, diceForEval);

      if (points === 0 && fieldKey) {
        const ok = confirm("Willst du dieses Feld wirklich streichen?");
        if (!ok) return;
      }

      if (iCorrecting) {
        ws.send(JSON.stringify({ action: "write_field_correction", row, field: col }));
      } else {
        if (S.correction?.active && (!iCorrecting)) return;
        ws.send(JSON.stringify({ action: "write_field", row, field: col }));
      }
    });

    // Klick auf „Letzten Eintrag ändern“
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("#requestCorrectionBtn");
      if (!btn) return;
      btn.disabled = true; // Doppelklicks verhindern
      try {
        ws.send(JSON.stringify({ action: "request_correction" }));
      } finally {
        // Server setzt den Button-Zustand beim nächsten Snapshot wieder korrekt
      }
    });

    // Korrektur abbrechen per Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && S.correction?.active && String(S.correction.player_id) === String(myPlayerId)) {
        ws.send(JSON.stringify({ action: "cancel_correction" }));
      }
    });
  }

  // ===== Utilities =====
  function esc(s){ return String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;","&gt;":">","\"":"&quot;"}[c])); }

  // ===== Start =====
  if (!GAME_ID) {
    alert("Kein game_id angegeben.");
    return;
  }
  connect();

  // kleines API für Debug/Extern
  window.__WuerflerClient = {
    getState: () => ({ myPlayerId, S }),
    rerender: () => render()
  };
})();