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

import { initChat, addChatMessage } from "./chat.js?v=6";

(() => {
  // ---------- Helpers ----------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getQS() {
    const u = new URL(location.href);
    return {
      game_id: u.searchParams.get("game_id") || "",
      name:   (u.searchParams.get("name") || "Gast").trim() || "Gast",
      pass:   u.searchParams.get("pass") || "",
      spectator: u.searchParams.get("spectator") === "1"
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
  const AUTO_ANNOUNCE_WRITE_DELAY_MS = 500;

  function isRollAction(obj) {
    return obj && (
      obj.action === 'roll_dice' || obj.type === 'roll_dice' || obj.t === 'roll_dice' ||
      obj.type === 'roll'       || obj.t === 'roll'        || obj.action === 'roll'
    );
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
        return true;
      }
    } catch (e) {
      // bewusst leise – wir wollen UI nicht blockieren; Logging kann bei Bedarf ergänzt werden
    }
    return false;
  }

  function leaveRoomAfterFatalError(message) {
    window._fatalWsClose = true;
    alert(message);
    location.href = "/";
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

  // --- Client-Punkteberechnung (nur für 0-Confirm UX) ---
  // Map der schreibbaren Reihen -> Feldkey
  const WRITABLE_MAP = {
    0:"1",1:"2",2:"3",3:"4",4:"5",5:"6",
    9:"max",10:"min",12:"kenter",13:"full",14:"poker",15:"60"
  };
  const MOBILE_ANNOUNCE_FIELDS = [
    [
      { row:0, field:"1", label:"1" }, { row:1, field:"2", label:"2" },
      { row:2, field:"3", label:"3" }, { row:3, field:"4", label:"4" },
      { row:4, field:"5", label:"5" }, { row:5, field:"6", label:"6" }
    ],
    [
      { row:9, field:"max", label:"+" }, { row:10, field:"min", label:"−" },
      { row:12, field:"kenter", label:"K" }, { row:13, field:"full", label:"F" },
      { row:14, field:"poker", label:"P" }, { row:15, field:"60", label:"60" }
    ]
  ];
  /**
   * Berechnet clientseitig die Punkte für ein Feld anhand der aktuellen Würfel.
   * Hinweis: Dient der Anzeige/Vorschlags-UX; serverseitig ist die Bewertung autoritativ.
   * @param {string} fieldKey - Feldname ("1".."6","max","min","kenter","full","poker","60")
   * @param {number[]} dice - Aktuelle Würfel (Länge 5)
   * @returns {number} Punktewert
   */
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
      // 4 ODER 5 gleiche zählen als Poker (Client-Logik an Server angleichen)
      for (const [face, n] of Object.entries(cnt)) if (n >= 4) return 50 + 4*parseInt(face,10);
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
  const IS_SPECTATOR = !!qs.spectator;
  if (!qs.game_id) { alert("Fehlende game_id. Zur Lobby."); location.href = "/"; return; }

  const PID_KEY = `wuerfler_pid_${qs.game_id}`;
  const TOKEN_KEY = `wuerfler_token_${qs.game_id}`;
  const PASS_KEY = `wuerfler_pass_${qs.game_id}`;
  const PLAYER_NAME_KEY = `wuerfler_player_name_${qs.game_id}`;
  if (!qs.pass && localStorage.getItem(PASS_KEY)) qs.pass = localStorage.getItem(PASS_KEY) || "";
  if (qs.pass) localStorage.setItem(PASS_KEY, qs.pass);
  if (qs.name) localStorage.setItem(PLAYER_NAME_KEY, qs.name);
  let myId = IS_SPECTATOR ? null : (localStorage.getItem(PID_KEY) || sessionStorage.getItem(PID_KEY) || null);
  let mySpectatorId = null;
  let myName = qs.name;

  let ws = null;
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
  let deferredSuggestionSnapshot = null;
  let chatHistorySeeded = false;
  let lastSuperadminSnapshotActive = false;
  const DEBUG_P_HOTKEY = false; // optionaler Debug-Hotkey "p" -> Poker/Free

  // UI-State für die Ansage-Auswahl per Button oder Hotkey.
  let announcePickMode = false;
  let authState = { authenticated: false, user: null };
  let superadminState = { active: false, boardId: null, draft: {} };
  let superadminTapState = { boardId: null, count: 0, lastTs: 0 };

  // Steuerung der Sichtbarkeit des Wuerfeln-Buttons im Ansage-Pick-Mode.
  // Wichtig: Wir verwenden `visibility:hidden` (nicht `display:none`),
  // damit der reservierte Platz erhalten bleibt und sich der Dice-Row-Layout
  // (Abstände/Wrap) *nicht* verschiebt.
  function applyAnnounceModeButtonVisibility(root){
    try{
      const rollBtn = root ? root.querySelector('#rollBtnInline') : null;
      if (!rollBtn) return;
      if (announcePickMode){
        rollBtn.style.visibility = 'hidden';
        rollBtn.style.pointerEvents = 'none';
      } else {
        rollBtn.style.visibility = '';
        rollBtn.style.pointerEvents = '';
      }
    }catch{}
  }

  function closeAnnouncePickMode({ rerender = false } = {}){
    announcePickMode = false;
    $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
    const picker = document.getElementById("mobileAnnouncePicker");
    if (picker) picker.hidden = true;
    applyAnnounceModeButtonVisibility(mount);
    if (rerender && sb) renderFromSnapshot(sb);
    else if (sb) syncActionButtons(sb);
  }

  function renderMobileAnnouncePicker(snapshot){
    const picker = document.getElementById("mobileAnnouncePicker");
    if (!picker) return;

    const availability = getAnnounceAvailability(snapshot);
    const visible = isMobileNarrow()
      && announcePickMode
      && availability.usable
      && availability.mode === "announce";
    picker.hidden = !visible;
    if (!visible) {
      picker.replaceChildren();
      return;
    }

    const board = getMyBoard(snapshot);
    picker.replaceChildren(...MOBILE_ANNOUNCE_FIELDS.map((fields, rowIndex) => {
      const row = document.createElement("div");
      row.className = "mobile-announce-picker-row";
      row.setAttribute("aria-label", rowIndex === 0 ? "Zahlenfelder" : "Sonderfelder");
      fields.forEach(({ row: scoreRow, field, label }) => {
        const value = board?.[`${scoreRow},ang`];
        const filled = !(value === undefined || value === null || value === "");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mobile-announce-option";
        button.dataset.field = field;
        button.dataset.row = String(scoreRow);
        button.textContent = label;
        button.disabled = filled;
        button.setAttribute("aria-label", `${label} ansagen${filled ? " – bereits ausgefüllt" : ""}`);
        button.title = filled ? "Bereits ausgefüllt" : `${label} ansagen`;
        row.appendChild(button);
      });
      return row;
    }));
  }

  function autoAnnounceSnapshotKey(snapshot){
    const dice = Array.isArray(snapshot?._dice) ? snapshot._dice.join("") : "";
    return [
      snapshot?._turn?.player_id || "",
      snapshot?._turn?.roll_index || 0,
      snapshot?._rolls_used || 0,
      snapshot?._announced_row4 || "",
      dice
    ].join(":");
  }

  function isLastAllowedRoll(snapshot){
    const rollsUsed = Number(snapshot?._rolls_used || 0);
    const rollsMax = Number(snapshot?._rolls_max || 3);
    return rollsMax > 0 && rollsUsed >= rollsMax;
  }

  function scheduleAutoWriteAnnouncedField(snapshot){
    const announced = snapshot?._announced_row4 || null;
    const row = Object.keys(WRITABLE_MAP).find(key => WRITABLE_MAP[key] === announced);
    const turnPid = snapshot?._turn?.player_id || null;
    const board = getMyBoard(snapshot);
    const targetIsFree = row !== undefined && !Object.prototype.hasOwnProperty.call(board || {}, `${row},ang`);
    const shouldWrite = !IS_SPECTATOR
      && !snapshot?._finished
      && !snapshot?._paused
      && !snapshot?._superadmin_active
      && !snapshot?._correction?.active
      && String(turnPid) === String(myId)
      && !!announced
      && isLastAllowedRoll(snapshot)
      && targetIsFree;

    if (!shouldWrite) {
      if (autoAnnounceWriteTimer) clearTimeout(autoAnnounceWriteTimer);
      autoAnnounceWriteTimer = null;
      autoAnnounceWriteKey = null;
      return;
    }

    const key = autoAnnounceSnapshotKey(snapshot);
    if (autoAnnounceWriteKey === key) return;
    if (autoAnnounceWriteTimer) clearTimeout(autoAnnounceWriteTimer);
    autoAnnounceWriteKey = key;
    // Erst den letzten Wurf vollständig anzeigen und danach noch eine kurze
    // Lesepause lassen, bevor das angesagte Feld den Zug automatisch beendet.
    const wait = Math.max(0, rollAnimationUntil - Date.now()) + AUTO_ANNOUNCE_WRITE_DELAY_MS;
    autoAnnounceWriteTimer = setTimeout(() => {
      autoAnnounceWriteTimer = null;
      if (!sb || autoAnnounceSnapshotKey(sb) !== key) return;
      const currentBoard = getMyBoard(sb);
      if (Object.prototype.hasOwnProperty.call(currentBoard || {}, `${row},ang`)) return;
      if (!safeSend(ws, { action:"write_field", row:Number(row), field:"ang" })) {
        autoAnnounceWriteKey = null;
      }
    }, wait);
  }

  function closeChatSheet(){
    try {
      const chatPanel = document.getElementById("chatPanel");
      const chatToggle = document.getElementById("chatToggle");
      const chatBackdrop = document.getElementById("chatBackdrop");
      if (chatPanel) chatPanel.classList.remove("open");
      if (chatToggle) chatToggle.setAttribute("aria-expanded", "false");
      if (chatBackdrop) chatBackdrop.hidden = true;
      document.body.classList.remove("chat-open");
      document.documentElement.classList.remove("chat-open");
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    } catch {}
  }

  function closeRulesSheet(){
    try {
      const sheet = document.getElementById("rulesSheet");
      const backdrop = document.getElementById("rulesSheetBackdrop");
      if (sheet) sheet.hidden = true;
      if (backdrop) backdrop.hidden = true;
      document.body.classList.remove("rules-open");
      document.documentElement.classList.remove("rules-open");
    } catch {}
  }

  function bindRulesFrameScroll(frame){
    if (!frame || frame._rulesScrollBound) return;
    frame._rulesScrollBound = true;

    const scrollByDelta = (deltaY) => {
      try {
        const win = frame.contentWindow;
        if (!win || !deltaY) return;
        win.scrollBy({ top: deltaY, left: 0, behavior: "auto" });
      } catch {}
    };

    const bindTouchScroll = (target) => {
      if (!target || target._rulesTouchScrollBound) return;
      target._rulesTouchScrollBound = true;
      let lastTouchY = null;
      target.addEventListener("touchstart", (e) => {
        lastTouchY = e.touches && e.touches.length ? e.touches[0].clientY : null;
      }, { passive: true });
      target.addEventListener("touchmove", (e) => {
        if (!e.touches || !e.touches.length || lastTouchY == null) return;
        const y = e.touches[0].clientY;
        scrollByDelta(lastTouchY - y);
        lastTouchY = y;
        e.preventDefault();
      }, { passive: false });
      target.addEventListener("touchend", () => { lastTouchY = null; }, { passive: true });
      target.addEventListener("touchcancel", () => { lastTouchY = null; }, { passive: true });
    };

    const bindInnerDocument = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || doc._rulesWheelScrollBound) return;
        doc._rulesWheelScrollBound = true;
        doc.addEventListener("wheel", (e) => {
          scrollByDelta(e.deltaY);
          e.preventDefault();
        }, { passive: false });
        bindTouchScroll(doc);
      } catch {}
    };

    frame.addEventListener("wheel", (e) => {
      scrollByDelta(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    bindTouchScroll(frame);
    frame.addEventListener("load", bindInnerDocument);
    bindInnerDocument();
  }

  function openRulesSheet(){
    try {
      closeChatSheet();
      const sheet = document.getElementById("rulesSheet");
      const backdrop = document.getElementById("rulesSheetBackdrop");
      const frame = document.getElementById("rulesFrame");
      if (!sheet || !backdrop) return;
      bindRulesFrameScroll(frame);
      if (frame && !frame.getAttribute("src")) {
        frame.setAttribute("src", frame.dataset.src || "/static/rules.html?embed=1");
      }
      sheet.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("rules-open");
      document.documentElement.classList.add("rules-open");
      const closeBtn = document.getElementById("rulesSheetClose");
      setTimeout(() => {
        try { (closeBtn || sheet).focus({ preventScroll: true }); }
        catch { (closeBtn || sheet).focus(); }
      }, 0);
    } catch {}
  }

  function bindRulesSheet(){
    try {
      const openBtn = document.getElementById("rulesSheetOpen");
      const closeBtn = document.getElementById("rulesSheetClose");
      const backdrop = document.getElementById("rulesSheetBackdrop");
      if (openBtn && !openBtn._bound) {
        openBtn._bound = true;
        openBtn.addEventListener("click", (e) => {
          e.preventDefault();
          openRulesSheet();
        });
      }
      if (closeBtn && !closeBtn._bound) {
        closeBtn._bound = true;
        closeBtn.addEventListener("click", closeRulesSheet);
      }
      if (backdrop && !backdrop._bound) {
        backdrop._bound = true;
        backdrop.addEventListener("click", closeRulesSheet);
      }
      if (!window.__rt_rulesEscapeBound) {
        window.__rt_rulesEscapeBound = true;
        window.addEventListener("keydown", (e) => {
          const sheet = document.getElementById("rulesSheet");
          if (e.key === "Escape" && sheet && !sheet.hidden) closeRulesSheet();
        });
      }
    } catch {}
  }

  function closeLeaveGameDialog(){
    try {
      const dialog = document.getElementById("leaveGameDialog");
      const backdrop = document.getElementById("leaveGameBackdrop");
      if (dialog) dialog.hidden = true;
      if (backdrop) backdrop.hidden = true;
      document.body.classList.remove("leave-dialog-open");
      document.documentElement.classList.remove("leave-dialog-open");
    } catch {}
  }

  function openLeaveGameDialog(){
    try {
      const dialog = document.getElementById("leaveGameDialog");
      const backdrop = document.getElementById("leaveGameBackdrop");
      const text = document.getElementById("leaveGameText");
      if (!dialog || !backdrop) return;
      closeChatSheet();
      closeRulesSheet();
      const holdFor = pauseDurationLabel(sb);
      if (text) {
        text.textContent = `Pause hält das Spiel bis zu ${holdFor} offen. Zur Lobby bricht das Spiel ab und schickt alle zurück.`;
      }
      dialog.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("leave-dialog-open");
      document.documentElement.classList.add("leave-dialog-open");
      const pauseBtn = document.getElementById("leavePauseBtn");
      setTimeout(() => {
        try { (pauseBtn || dialog).focus({ preventScroll: true }); }
        catch { (pauseBtn || dialog).focus(); }
      }, 0);
    } catch {}
  }

  function bindLeaveGameDialog(){
    try {
      const pauseBtn = document.getElementById("leavePauseBtn");
      const abortBtn = document.getElementById("leaveAbortBtn");
      const stayBtn = document.getElementById("leaveStayBtn");
      const backdrop = document.getElementById("leaveGameBackdrop");
      const who = () => (myName || "Spieler").trim();
      if (pauseBtn && !pauseBtn._bound) {
        pauseBtn._bound = true;
        pauseBtn.addEventListener("click", () => {
          if (window._pauseRequested) return;
          window._pauseRequested = true;
          safeSend(ws, { action: "pause_game", by: who() });
          closeLeaveGameDialog();
          setTimeout(() => {
            if (window._pauseRequested) {
              window._fatalWsClose = true;
              location.href = "/";
            }
          }, 600);
        });
      }
      if (abortBtn && !abortBtn._bound) {
        abortBtn._bound = true;
        abortBtn.addEventListener("click", () => {
          if (window._abortRequested) return;
          window._abortRequested = true;
          safeSend(ws, { action: "end_game", by: who() });
          closeLeaveGameDialog();
        });
      }
      if (stayBtn && !stayBtn._bound) {
        stayBtn._bound = true;
        stayBtn.addEventListener("click", closeLeaveGameDialog);
      }
      if (backdrop && !backdrop._bound) {
        backdrop._bound = true;
        backdrop.addEventListener("click", closeLeaveGameDialog);
      }
      if (!window.__rt_leaveDialogEscapeBound) {
        window.__rt_leaveDialogEscapeBound = true;
        window.addEventListener("keydown", (e) => {
          const dialog = document.getElementById("leaveGameDialog");
          if (e.key === "Escape" && dialog && !dialog.hidden) closeLeaveGameDialog();
        });
      }
    } catch {}
  }

  function syncRoomLayoutSoon({ scrollTop = false } = {}){
	    requestAnimationFrame(() => {
	      try {
	        syncChatWidth();
	        syncSideChatAnchor();
	        syncReactionsMount();
	        applyAnnounceModeButtonVisibility(mount);
        const grid = document.querySelector("#scoreOut .players-grid");
        if (scrollTop && grid) grid.scrollLeft = 0;
        if (scrollTop) {
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        }
      } catch {}
    });
  }

  function normalizeTransientLayoutForAdmin({ scrollTop = false } = {}){
    try {
      announcePickMode = false;
      closeChatSheet();
      $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
      _userScrollOverride = false;
      if (_pendingFollowTimer) {
        try { clearTimeout(_pendingFollowTimer); } catch {}
        _pendingFollowTimer = null;
      }
      syncRoomLayoutSoon({ scrollTop });
    } catch {}
  }

  // Das Ansage-Fenster ist nur direkt nach Wurf 1 für den aktuellen Spieler offen.
  function announceWindowOpen(snapshot){
    const rolls = Number(snapshot?._rolls_used || 0);
    const iAmTurn = (snapshot?._turn && String(snapshot._turn.player_id) === String(myId));
    const corrActive = !!(snapshot?._correction?.active);
    const announced = snapshot?._announced_row4 || null;
    return iAmTurn && !corrActive && rolls === 1 && !announced;
  }

  // Eigenes Zielboard: im Teammodus das gemeinsame Teamboard, sonst das Spielerboard.
  function getMyBoard(snapshot){
    const mode = String(snapshot?._mode || "").toLowerCase();
    if (mode === "2v2" && Array.isArray(snapshot?._teams)) {
      const myTeam = (snapshot._teams.find(t => (t.members || []).some(m => String(m) === String(myId))) || {}).id;
      return myTeam ? (snapshot._scoreboards_by_team?.[myTeam] || {}) : {};
    }
    return (snapshot?._scoreboards?.[myId]) || {};
  }

  function isColFull(sc, colKey){
    try{
      const need = Object.keys(WRITABLE_MAP).map(k => Number(k));
      for (const ri of need){
        const key = `${ri},${colKey}`;
        const v = sc[key];
        if (v === undefined || v === null || v === "") return false;
      }
      return true;
    }catch{ return false; }
  }

  function emptyCountAng(sc){
    try{
      let cnt = 0;
      for (const ri of Object.keys(WRITABLE_MAP).map(k => Number(k))){
        const key = `${ri},ang`;
        const v = sc[key];
        if (v === undefined || v === null || v === "") cnt++;
      }
      return cnt;
    }catch{ return 0; }
  }

  function totalOpenWritable(sc){
    try{
      let cnt = 0;
      const cols = ["down","free","up","ang"];
      for (const ri of Object.keys(WRITABLE_MAP).map(k => Number(k))){
        for (const c of cols){
          const v = sc[`${ri},${c}`];
          if (v === undefined || v === null || v === "") cnt++;
        }
      }
      return cnt;
    }catch{ return 0; }
  }

  // Ansagepflicht verhindert ein Sackgassen-Endspiel, wenn nur noch ❗ sinnvoll offen ist.
  function mustAnnounceAfterFirst(snapshot){
    const sc = getMyBoard(snapshot);
    const colFull = isColFull(sc, "down") && isColFull(sc, "free") && isColFull(sc, "up");
    const freeAng = emptyCountAng(sc);
    const openAll = totalOpenWritable(sc);
    // Pflicht nur, wenn 3 Reihen voll sind, in ❗ mind. zwei frei und nicht im "letztes Feld" Sonderfall
    return Boolean(colFull && freeAng >= 2 && openAll !== 1);
  }

  function isRollingBlocked(snapshot){
    const rolls = Number(snapshot?._rolls_used || 0);
    const announced = snapshot?._announced_row4 || null;
    return (rolls >= 1) && mustAnnounceAfterFirst(snapshot) && !announced;
  }

  function rollSnapshotKey(snapshot){
    try{
      const turnPid = snapshot?._turn?.player_id || "";
      const rolls = Number(snapshot?._rolls_used || 0);
      const dice = Array.isArray(snapshot?._dice) ? snapshot._dice.join(",") : "";
      const corr = snapshot?._correction?.active ? "1" : "0";
      const finished = snapshot?._finished ? "1" : "0";
      return `${turnPid}|${rolls}|${dice}|${corr}|${finished}`;
    }catch{
      return "";
    }
  }

  function rollCooldownRemaining(){
    const nextByLock = Number(window.__rt_rollLockedUntil || 0);
    const nextByLastSend = Number(window.__rt_lastRollSent || 0) + ROLL_GUARD_MS;
    const nextAllowed = Math.max(nextByLock, nextByLastSend);
    return Math.max(0, nextAllowed - Date.now());
  }

  function scheduleRollAvailabilityRefresh(){
    try{
      if (rollCooldownTimer) clearTimeout(rollCooldownTimer);
      const wait = rollCooldownRemaining();
      if (wait <= 0) return;
      rollCooldownTimer = setTimeout(() => {
        rollCooldownTimer = null;
        syncActionButtons(sb);
      }, wait + 25);
    }catch{}
  }

  function stopDiceShake(){
    try{ $$("#diceBar .die", mount).forEach(el => el.classList.remove("shaking")); }
    catch{}
  }

  function dieSVGMarkup(v){
    const L=30, C=50, R=70, T=30, M=50, B=70;
    const pips = {
      1: [[C,M]],
      2: [[L,T],[R,B]],
      3: [[L,T],[C,M],[R,B]],
      4: [[L,T],[R,T],[L,B],[R,B]],
      5: [[L,T],[R,T],[C,M],[L,B],[R,B]],
      6: [[L,T],[L,M],[L,B],[R,T],[R,M],[R,B]]
    }[Number(v)] || [];
    const dots = pips.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="8"></circle>`).join("");
    return `
      <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="Würfel ${Number(v) || 0}">
        <rect x="5" y="5" width="90" height="90" rx="12" ry="12" fill="white" stroke="black" stroke-width="6"></rect>
        <g fill="black">${dots}</g>
      </svg>
    `;
  }

  function randomFaceExcept(prev){
    let next = 1 + Math.floor(Math.random() * 6);
    if (next === Number(prev)) next = (next % 6) + 1;
    return next;
  }

  function restoreDiceFacesFromSnapshot(snapshot){
    try {
      const dice = Array.isArray(snapshot?._dice) ? snapshot._dice : [];
      $$("#diceBar .die", mount).forEach(el => {
        const i = Number(el.dataset.i);
        el.removeAttribute("data-rolling-face");
        el.innerHTML = dieSVGMarkup(Number(dice[i] || 0));
      });
    } catch {}
  }

  function renderRollingDiceFaces(){
    try {
      const active = isRollAnimationActive();
      if (!active) return;
      const animated = new Set(rollAnimationIndices.map(Number));
      $$("#diceBar .die", mount).forEach(el => {
        const i = Number(el.dataset.i);
        if (!animated.has(i)) return;
        const prev = Number(el.dataset.rollingFace || sb?._dice?.[i] || 0);
        const face = randomFaceExcept(prev);
        el.dataset.rollingFace = String(face);
        el.innerHTML = dieSVGMarkup(face);
      });
    } catch {}
  }

  function stopRollFaceTimer(){
    if (rollFaceTimer) {
      try{ clearInterval(rollFaceTimer); }catch{}
      rollFaceTimer = null;
    }
  }

  function clearRollAnimation(){
    rollAnimationUntil = 0;
    rollAnimationIndices = [];
    if (rollAnimationTimer) {
      try{ clearTimeout(rollAnimationTimer); }catch{}
      rollAnimationTimer = null;
    }
    stopRollFaceTimer();
    stopDiceShake();
    restoreDiceFacesFromSnapshot(sb);
    const suggestionSnapshot = deferredSuggestionSnapshot || sb;
    deferredSuggestionSnapshot = null;
    renderSuggestionsForSnapshot(suggestionSnapshot);
  }

  function isRollAnimationActive(){
    return rollAnimationUntil > Date.now() && rollAnimationIndices.length > 0;
  }

  function activeRollDiceIndices(snapshot){
    const holds = Array.isArray(snapshot?._holds) ? snapshot._holds : [false,false,false,false,false];
    return [0,1,2,3,4].filter(i => !holds[i]);
  }

  function applyRollAnimation(){
    try{
      const active = isRollAnimationActive();
      const diceEls = $$("#diceBar .die", mount);
      diceEls.forEach(el => el.classList.remove("shaking"));
      if (!active) return;
      const animated = new Set(rollAnimationIndices.map(Number));
      diceEls.forEach(el => {
        const i = Number(el.dataset.i);
        if (animated.has(i)) el.classList.add("shaking");
      });
      renderRollingDiceFaces();
    }catch{}
  }

  function startRollAnimation(snapshot){
    rollAnimationIndices = activeRollDiceIndices(snapshot);
    rollAnimationUntil = Date.now() + ROLL_ANIMATION_MS;
    applyRollAnimation();
    if (rollAnimationTimer) {
      try{ clearTimeout(rollAnimationTimer); }catch{}
    }
    stopRollFaceTimer();
    renderRollingDiceFaces();
    rollFaceTimer = setInterval(() => {
      if (rollAnimationUntil <= Date.now()) {
        clearRollAnimation();
        return;
      }
      renderRollingDiceFaces();
    }, ROLL_FACE_ANIMATION_STEP_MS);
    rollAnimationTimer = setTimeout(clearRollAnimation, ROLL_ANIMATION_MS + 40);
  }

  function clearPendingRoll(){
    rollRequestPending = false;
    pendingRollSnapshotKey = null;
    if (rollSendTimer) { try{ clearTimeout(rollSendTimer); }catch{} rollSendTimer = null; }
    if (rollPendingTimer) { try{ clearTimeout(rollPendingTimer); }catch{} rollPendingTimer = null; }
  }

  function clearAutoRollRetry(){
    if (autoRollRetryTimer) {
      try{ clearTimeout(autoRollRetryTimer); }catch{}
      autoRollRetryTimer = null;
    }
  }

  function settlePendingRollFromSnapshot(snapshot){
    if (!rollRequestPending) return;
    const nextKey = rollSnapshotKey(snapshot);
    if (pendingRollSnapshotKey && nextKey && nextKey !== pendingRollSnapshotKey) {
      clearPendingRoll();
    }
  }

  function hasOpenAnnounceField(snapshot){
    const sc = getMyBoard(snapshot);
    try{
      for (const ri of Object.keys(WRITABLE_MAP).map(k => Number(k))){
        const v = sc[`${ri},ang`];
        if (v === undefined || v === null || v === "") return true;
      }
    }catch{}
    return false;
  }

  function getRollAvailability(snapshot){
    if (IS_SPECTATOR) return { usable:false, reason:"Zuschauer können nicht würfeln", code:"spectator" };
    if (!snapshot || snapshot._finished) return { usable:false, reason:"Spiel ist nicht aktiv", code:"inactive" };
    if (snapshot?._paused) return { usable:false, reason:snapshot._pause_reason || "Spiel pausiert, bis alle Spieler wieder verbunden sind", code:"paused" };
    if (snapshot?._superadmin_active) return { usable:false, reason:"Während Superadmin-Edit gesperrt", code:"superadmin" };
    const turn = snapshot?._turn || null;
    const iAmTurn = turn && String(turn.player_id) === String(myId);
    if (!iAmTurn) return { usable:false, reason:"Nicht an der Reihe", code:"not_turn" };
    if (snapshot?._correction?.active) return { usable:false, reason:"Während Korrektur nicht erlaubt", code:"correction" };
    const rolls = Number(snapshot?._rolls_used || 0);
    const max = Number(snapshot?._rolls_max || 3);
    if (rolls >= max) return { usable:false, reason:"Keine Würfe mehr", code:"no_rolls_left" };
    if (!snapshot._hardcore && isRollingBlocked(snapshot)) {
      return { usable:false, reason:"Weiter würfeln erst nach Ansage möglich (Pflicht nach Wurf 1).", code:"announce_required" };
    }
    if (rollRequestPending) return { usable:false, reason:"Wurf läuft", code:"pending" };
    const wait = rollCooldownRemaining();
    if (wait > 0) return { usable:false, reason:"Kurz warten", code:"cooldown" };
    return { usable:true, reason:"Würfeln", code:"ready" };
  }

  function getAnnounceAvailability(snapshot){
    if (IS_SPECTATOR) return { usable:false, reason:"Zuschauer können nicht ansagen", mode:"announce" };
    if (!snapshot || snapshot._finished) return { usable:false, reason:"Spiel ist nicht aktiv", mode:"announce" };
    if (snapshot?._paused) return { usable:false, reason:snapshot._pause_reason || "Spiel pausiert, bis alle Spieler wieder verbunden sind", mode:"announce" };
    if (snapshot?._superadmin_active) return { usable:false, reason:"Während Superadmin-Edit gesperrt", mode:"announce" };
    if (snapshot?._hardcore) return { usable:false, reason:"Ansage ist im Hardcore-Modus deaktiviert", mode:"announce" };
    const announced = snapshot?._announced_row4 || null;
    const mode = announced ? "unannounce" : "announce";
    const turn = snapshot?._turn || null;
    const iAmTurn = turn && String(turn.player_id) === String(myId);
    if (!iAmTurn) return { usable:false, reason:"Nicht an der Reihe", mode };
    if (snapshot?._correction?.active) return { usable:false, reason:"Während Korrektur nicht erlaubt", mode };
    const rolls = Number(snapshot?._rolls_used || 0);
    if (rolls < 1) return { usable:false, reason:"Ansage erst nach dem ersten Wurf möglich", mode };
    if (rolls !== 1) return { usable:false, reason:"Ansage nur direkt nach Wurf 1 möglich", mode };
    if (announced) return { usable:true, reason:"Ansage aufheben", mode };
    if (!hasOpenAnnounceField(snapshot)) return { usable:false, reason:"Keine freien ❗-Felder für eine Ansage", mode };
    return { usable:true, reason:"Ansagen", mode };
  }

  function syncActionButtons(snapshot){
    try{
      const rollBtn = $("#rollBtnInline", mount);
      if (rollBtn){
        const roll = getRollAvailability(snapshot);
        rollBtn.disabled = !roll.usable;
        rollBtn.title = roll.reason || "Würfeln";
        rollBtn.setAttribute("aria-disabled", roll.usable ? "false" : "true");
      }

      const ab = $("#announceBtnInline", mount);
      if (ab){
        const ann = getAnnounceAvailability(snapshot);
        const announced = snapshot?._announced_row4 || null;
        ab.disabled = !ann.usable;
        ab.title = ann.reason || "Ansagen";
        ab.dataset.state = ann.mode || "announce";
        ab.setAttribute("aria-disabled", ann.usable ? "false" : "true");
        if (ann.mode === "unannounce" || announced){
          ab.textContent = "Ansage aufheben";
          announcePickMode = false;
        } else {
          ab.textContent = announcePickMode ? "Ansage wählen" : "Ansagen";
        }
        // Lange Labels muessen umbrechen, damit die Buttonbreite konstant bleibt
        ab.style.whiteSpace = 'normal';
        ab.style.lineHeight = '1.15';
      }

      scheduleRollAvailabilityRefresh();
    }catch{}
  }

  function renderSuperadminLockNotice(snapshot){
    try {
      let el = document.getElementById("superadminLockNotice");
      if (!snapshot?._superadmin_active) {
        if (el) el.remove();
        return;
      }
      const score = document.querySelector("#scoreOut");
      if (!score) return;
      if (!el) {
        el = document.createElement("div");
        el.id = "superadminLockNotice";
        el.className = "superadmin-lock-notice";
        const anchor = score.querySelector(".suggestions-area") || score.querySelector(".players-grid");
        score.insertBefore(el, anchor || score.firstChild);
      }
      el.textContent = "Superadmin-Edit aktiv: Würfeln, Halten, Ansagen und Schreiben sind pausiert.";
    } catch {}
  }

  function renderMultiplayerPauseNotice(snapshot){
    try {
      let el = document.getElementById("multiplayerPauseNotice");
      if (!snapshot?._paused) {
        if (el) el.remove();
        return;
      }
      const score = document.querySelector("#scoreOut");
      if (!score) return;
      if (!el) {
        el = document.createElement("div");
        el.id = "multiplayerPauseNotice";
        el.className = "multiplayer-pause-notice";
        const anchor = score.querySelector(".suggestions-area") || score.querySelector(".players-grid");
        score.insertBefore(el, anchor || score.firstChild);
      }
      const offline = Array.isArray(snapshot._offline_players) ? snapshot._offline_players : [];
      const names = offline.map(p => p && p.name).filter(Boolean).join(", ");
      el.textContent = names
        ? `Spiel pausiert. Weiter geht es, sobald wieder verbunden sind: ${names}.`
        : "Spiel pausiert. Weiter geht es, sobald alle Spieler wieder verbunden sind.";
    } catch {}
  }

  function scheduleAutoRollRetry(snapshot){
    try{
      if (autoRollRetryTimer) return;
      const targetKey = rollSnapshotKey(snapshot);
      const wait = rollCooldownRemaining();
      autoRollRetryTimer = setTimeout(() => {
        autoRollRetryTimer = null;
        const stillSameAutoTurn = sb?._auto_single && rollSnapshotKey(sb) === targetKey;
        if (stillSameAutoTurn) requestRoll({ animate: true, auto: true });
      }, Math.max(wait, 0) + 25);
    }catch{}
  }

  function requestRoll({ animate = true, auto = false } = {}) {
    const availability = getRollAvailability(sb);
    if (!availability.usable) {
      if (auto && availability.code === "cooldown") scheduleAutoRollRetry(sb);
      syncActionButtons(sb);
      return false;
    }

    clearAutoRollRetry();
    rollRequestPending = true;
    pendingRollSnapshotKey = rollSnapshotKey(sb);
    window.__rt_rollLockedUntil = Date.now() + ROLL_GUARD_MS;
    syncActionButtons(sb);

    if (rollSendTimer) { try{ clearTimeout(rollSendTimer); }catch{} }
    rollSendTimer = setTimeout(() => {
      rollSendTimer = null;
      const sent = safeSend(ws, { action: "roll_dice" });
      if (!sent) {
        clearPendingRoll();
        clearRollAnimation();
        syncActionButtons(sb);
      }
    }, animate ? ROLL_ANIMATION_SEND_DELAY_MS : 0);

    if (rollPendingTimer) { try{ clearTimeout(rollPendingTimer); }catch{} }
    rollPendingTimer = setTimeout(() => {
      if (!rollRequestPending) return;
      clearPendingRoll();
      clearRollAnimation();
      syncActionButtons(sb);
    }, ROLL_PENDING_TIMEOUT_MS);

    if (animate) {
      startRollAnimation(sb);
    }
    return true;
  }

    // --- Mobile-Autofocus (Swipe vs. Auto-Follow) ---
  let _lastTurnPid = null;
  let _userScrollOverride = false;
  let _lastFilledCount = null; // Anzahl gefuellter schreibbarer Zellen
  // Verzögertes Auto-Follow nach Schreibaktion (Mobile):
  // Nach einem Schreibvorgang und Zugwechsel soll der Fokus ~1s auf dem soeben
  // beschriebenen Board bleiben, bevor zum neuen Zug gescrollt wird.
  let _pendingFollowTimer = null;

  // Mounts
  const mount = document.getElementById("scoreOut") || (() => {
    const d = document.createElement("div"); d.id = "scoreOut"; document.body.appendChild(d); return d;
  })();
  const reactionsMount = document.getElementById("reactionsBar") || (() => {
    const r = document.createElement("div"); r.id = "reactionsBar"; r.style.margin = ".5rem 0"; document.body.prepend(r); return r;
  })();

  // ---------- WebSocket ----------
  /**
   * Stellt die WebSocket-Verbindung her und verarbeitet Server-Events.
   * Verantwortlich für Join/Rejoin/Spectate, Snapshot-Handling,
   * Abbruch-Notices, Chat-Weiterleitung und Auto-Reconnect.
   */
  function connect() {
      // --- "Zurück zur Lobby" mit Auswahl: pausieren oder abbrechen ---
    bindRulesSheet();
    bindLeaveGameDialog();
    (function bindBackToLobby() {
      const btn = document.getElementById("backToLobbyBtn");
      if (!btn || btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (IS_SPECTATOR) { location.href = "/"; return; }  // Zuschauer: nur verlassen
        openLeaveGameDialog();
      });
    })();
    ws = new WebSocket(wsURL(qs.game_id));

	    ws.addEventListener("open", () => {
	      initChat(ws, { meName: myName });
	      syncSideChatAnchor();
	      if (IS_SPECTATOR) {
        safeSend(ws, { action: "spectate_game", name: myName, pass: qs.pass });
      } else if (myId) {
        safeSend(ws, {
          action: "rejoin_game",
          player_id: myId,
          resume_token: localStorage.getItem(TOKEN_KEY) || "",
          pass: qs.pass
        });
      } else {
        safeSend(ws, { action: "join_game", name: myName, pass: qs.pass });
      }
    });

    ws.addEventListener("message", (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.auth) {
        authState = msg.auth;
        if (authState?.user?.username) myName = String(authState.user.username);
      }

      // Abbruch-Notice (kommt vor dem Snapshot)
      if (msg.notice && msg.notice.type === "ended") {
        window._lastEndedBy = msg.notice.by || null;
        // Sofort informieren (nur einmal)
        if (!window._abortAlerted) {
          alert(`${window._lastEndedBy || "Ein Spieler"} hat das Spiel abgebrochen.`);
          window._abortAlerted = true;
        }
        // kein return nötig; der folgende Snapshot erledigt den Redirect
      }

      // Join-Response
      if (msg.player_id) {
        myId = String(msg.player_id);
        sessionStorage.setItem(PID_KEY, myId);
        localStorage.setItem(PID_KEY, myId);
        localStorage.setItem(PLAYER_NAME_KEY, myName);
        if (qs.pass) localStorage.setItem(PASS_KEY, qs.pass);
      }
      if (msg.resume_token) {
        localStorage.setItem(TOKEN_KEY, String(msg.resume_token));
      }
      if (msg.spectator_id) {
        mySpectatorId = String(msg.spectator_id);
      }
      if (msg.paused) {
        const label = msg.pause_remaining_label || pauseDurationLabel(sb);
        alert(`Spiel pausiert. Du kannst es innerhalb von ${label} wieder aufnehmen.`);
        window._fatalWsClose = true;
        try { ws.close(1000); } catch {}
        location.href = "/";
        return;
      }

      // Fehler
      if (msg.error) {
        console.warn("Serverfehler:", msg.error);
        if (superadminState.active || /superadmin/i.test(String(msg.error || ""))) {
          alert(msg.error);
        }
        if (rollRequestPending) {
          clearPendingRoll();
          clearRollAnimation();
          syncActionButtons(sb);
        }
        if (msg.fatal) {
          if (/Spieler-Sitzung nicht gefunden/i.test(String(msg.error || ""))) {
            localStorage.removeItem(PID_KEY);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(PID_KEY);
          }
          if (/Wiederaufnahme abgelehnt/i.test(String(msg.error || ""))) {
            localStorage.removeItem(PID_KEY);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(PID_KEY);
          }
          leaveRoomAfterFatalError(msg.error);
          return;
        }
        if (/passphrase/i.test(msg.error) || /pass/i.test(msg.error)) {
          leaveRoomAfterFatalError("Beitritt abgelehnt: " + msg.error);
          return;
        }
      }

      if (msg.superadmin && msg.superadmin.active) {
        superadminState = { active: true, boardId: String(msg.superadmin.board_id || ""), draft: {} };
        normalizeTransientLayoutForAdmin({ scrollTop: false });
        applySuperadminUiState();
      }
      if (msg.superadmin && msg.superadmin.saved) {
        superadminState.draft = {};
        applySuperadminUiState();
      }
      if (msg.superadmin && msg.superadmin.active === false) {
        superadminState = { active: false, boardId: null, draft: {} };
        resetAfterSuperadminExit({ scrollTop: false });
      }

      // Scoreboard-Update
      if (msg.scoreboard) {
        const wasSuperadminActive = lastSuperadminSnapshotActive;
        sb = msg.scoreboard;
        const isSuperadminActive = !!sb?._superadmin_active;
        lastSuperadminSnapshotActive = isSuperadminActive;
        seedChatHistoryFromSnapshot(sb);
        renderFromSnapshot(sb);
        if (wasSuperadminActive && !isSuperadminActive) {
          resetAfterSuperadminExit({ scrollTop: true });
        }

        // Spielende
        if (sb && sb._finished) {
          // --- Sonderfall: Abbruch ---
          if (sb._aborted) {
            // Falls Notice schon gezeigt wurde, nicht doppelt alerten.
            if (!window._abortAlerted) {
              const by = window._lastEndedBy;
              alert(`Spiel abgebrochen${by ? ` – ${by} hat das Spiel beendet.` : ""}`);
              window._abortAlerted = true;
            }
            setTimeout(() => { location.href = "/"; }, 400);
            return;
          }

          // --- Reguläres Ende (Sieger/Platzierungen) ---
          try {
            const res = (sb._results || sb.results) || [];
            const asNumber = (v) => (typeof v === "number" && isFinite(v)) ? v : null;
            const humanList = (arr) => {
              const names = (arr || []).filter(Boolean);
              if (names.length <= 1) return names[0] || "";
              return names.slice(0, -1).join(", ") + " und " + names[names.length - 1];
            };
            const toLabel = (entry) => {
              if (!entry) return { label: "Unbekannt", score: null };
              const isTeam = entry.is_team || Array.isArray(entry.members) || entry.team || entry.team_name;
              if (isTeam) {
                const teamName = entry.name || entry.team || entry.team_name || "Team";
                const members = entry.members || entry.players || [];
                const label = members && members.length
                  ? `${teamName}, mit ${humanList(members)}`
                  : `${teamName}`;
                return { label, score: asNumber(entry.total) };
              }
              const label = entry.player || entry.name || "Spieler";
              return { label, score: asNumber(entry.total) };
            };

            if (Array.isArray(res) && res.length > 0) {
              if (res.length === 1) {
                const top = toLabel(res[0]);
                alert(`Spiel beendet – Sieger: ${top.label}${top.score != null ? ` (${top.score} Punkte)` : ""}`);
              } else {
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
          setTimeout(() => { location.href = "/"; }, 600);
          return;
        }
      }

      // Quick-Reaction
      if (msg.emoji && window.emojiUI && typeof window.emojiUI.handleRemote === "function") {
        window.emojiUI.handleRemote(msg.emoji);
        addChatMessage(msg.emoji.from || "???", msg.emoji.emoji || "", {
          ts: msg.emoji.ts,
          kind: "reaction",
        });
      }

      // Chat-Varianten
      if (msg.chat && typeof msg.chat === "object") {
        const sender = msg.chat.sender || "???";
        const text = msg.chat.text || "";
        if (text) {
          addChatMessage(sender, text, { ts: msg.chat.ts, kind: msg.chat.kind });
          const ownIds = [myId, mySpectatorId ? `S-${mySpectatorId}` : null].filter(Boolean).map(String);
          const isOwn = msg.chat.from_id && ownIds.includes(String(msg.chat.from_id));
          if (!isOwn && window.emojiUI && typeof window.emojiUI.handleChat === "function") {
            window.emojiUI.handleChat(msg.chat);
          }
        }
      } else if (msg.type === "chat" && msg.text) {
        addChatMessage(msg.sender || "???", msg.text);
      } else if (msg.message && msg.sender) {
        addChatMessage(msg.sender, msg.message);
      } else if (msg.kind === "chat" && msg.payload?.text) {
        addChatMessage(msg.payload.sender || "???", msg.payload.text);
      }

      // Zuschauer-Toast
      if (msg.spectator && typeof msg.spectator.name === "string") {
        showSpectatorToast(msg.spectator); // Objekt übergeben, kein fertiger Text
      }

      if (Array.isArray(msg.chat_history)) {
        msg.chat_history.forEach(m => { if (m?.text) addChatMessage(m.sender || "???", m.text, { ts: m.ts, kind: m.kind }); });
      }
    });

    ws.addEventListener("close", () => {
      clearPendingRoll();
      clearAutoRollRetry();
      clearRollAnimation();
      syncActionButtons(sb);
      if (window._fatalWsClose) return;
      setTimeout(connect, 1000);
    });
  }
  connect();

  function seedChatHistoryFromSnapshot(snapshot){
    try {
      if (chatHistorySeeded) return;
      chatHistorySeeded = true;
      const hist = Array.isArray(snapshot?._chat_history) ? snapshot._chat_history : [];
      if (!hist.length) return;
      hist.forEach(m => {
        if (m && m.text) addChatMessage(m.sender || "???", m.text, { ts: m.ts, kind: m.kind });
      });
    } catch {}
  }

  // ---------- Render & Events ----------
/**
 * Rendert die komplette Room-Ansicht aus einem Server-Snapshot.
 * Aktualisiert Dicebar, Scoreboards, Vorschläge, Reactions und UI-Zustände
 * (Ansage, Korrektur, Auto-Follow, Mobile-Layout).
 * @param {object} snapshot - Server-Snapshot der aktuellen Spielsituation
 */
function renderFromSnapshot(snapshot) {
    settlePendingRollFromSnapshot(snapshot);
    const turnPid   = snapshot?._turn?.player_id || null;
    const iAmTurn   = turnPid && String(turnPid) === String(myId);
    const isHC      = !!(snapshot && snapshot._hardcore);
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
    syncBoardCountClasses();
    syncHeaderTurnStatus(snapshot);
    applyRollAnimation();

    wireDiceBar();
    wireGridClicks();
    applySuperadminUiState();
    ensureKeybindings(); // alle Hotkeys hier

    // --- Auto-Beenden des Pick-Modes außerhalb des Fensters ---
    try{
      const ann = getAnnounceAvailability(snapshot);
      if (!announceWindowOpen(snapshot) || !ann.usable || ann.mode !== "announce") {
        if (announcePickMode) {
          announcePickMode = false;
          $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
          // Sichtbarkeit des Würfeln-Buttons nach Pick-Mode beenden zurücksetzen
          if (!isHC) applyAnnounceModeButtonVisibility(mount);
        }
      }
    } catch {}

    // Ansage-/Würfeln-Buttons aus demselben Benutzbarkeitsmodell setzen.
    syncActionButtons(snapshot);
    renderMobileAnnouncePicker(snapshot);
    scheduleAutoWriteAnnouncedField(snapshot);
    renderSuperadminLockNotice(snapshot);
    renderMultiplayerPauseNotice(snapshot);

    // Hinweiszeile (falls vorhanden)
    try{
      const hint = document.getElementById("announceHint");
      if (hint){
        const blockRoll = !isHC && isRollingBlocked(snapshot);
        hint.textContent = blockRoll ? "Bitte ein ❗-Feld ansagen, bevor du weiter würfelst." : "";
      }
    } catch {}

    // Während des Ansage-Pick-Modes den Würfeln-Button unsichtbar schalten,
    // ohne das Layout zu verschieben (visibility statt display)
    applyAnnounceModeButtonVisibility(mount);

    // Im Pick-Mode nur freie, beschreibbare ❗-Zellen des eigenen Boards markieren.
    try{
      $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));

      if (!isHC && announcePickMode){
        let boardRoot = null;
        const mode = String(snapshot?._mode || "").toLowerCase();
        if (mode === "2v2"){
          const myTeam = (snapshot._teams || []).find(t => (t.members || []).some(m => String(m) === String(myId)));
          if (myTeam){
            const cards = $$(".player-card");
            boardRoot = Array.from(cards).find(c => c.classList.contains("me")) || null;
          }
        } else {
          const cards = $$(".player-card");
          boardRoot = Array.from(cards).find(c => c.classList.contains("me")) || null;
        }

        if (boardRoot){
          const tds = $$("table.grid tbody tr td.cell:nth-child(5)", boardRoot);
          tds.forEach(td => {
            const hasVal    = td.textContent.trim().length > 0;
            const isCompute = td.classList.contains("compute");
            if (!hasVal && !isCompute) {
              td.classList.add("announce-pickable");
            }
          });
        }
      }
    } catch {}

    // Emoji-FAB nach jedem Render an den passenden Mount setzen:
    // Desktop im Header, mobile links neben der Chatbar.
    if (window.emojiUI && typeof window.emojiUI.init === "function") {
      window.emojiUI.init({ mount: currentReactionsMount(), ws, getMyName: () => myName });
    }

    // Suggestions (informativ), aber erst nach Ende der lokalen Roll-Animation.
    renderSuggestionsForSnapshot(snapshot);

    // 1P Auto-Roll
    if (snapshot._auto_single && iAmTurn) requestRoll({ animate: true, auto: true });

	    // Chat-Breite angleichen
	    syncChatWidth();
	    syncSideChatAnchor();

	    // --- Scrollposition nach Re-Render bewahren, ausser bei gewolltem Fokuswechsel (Write+TurnChange)
    const filledNow = countFilledWritableCells(snapshot);
    const turnChanged = String(_lastTurnPid) !== String(turnPid);
    const wroteHappened = (_lastFilledCount !== null) ? (filledNow > _lastFilledCount) : false;

    const _newGrid = document.querySelector("#scoreOut .players-grid");
    // Immer die vorherige Scrollposition wiederherstellen, solange der Nutzer
    // nicht manuell uebersteuert hat. So bleibt der zuletzt sichtbare Board-Fokus
    // fuer ~1s bestehen, bevor der Auto-Follow greift – fuer alle Nutzer.
    if (_newGrid) {
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

  function currentReactionsMount(){
    const mobileMount = document.getElementById("chatReactionsBar");
    return mobileMount || reactionsMount;
  }

  function syncBoardCountClasses() {
    try {
      const grid = document.querySelector("#scoreOut .players-grid");
      const count = grid ? grid.querySelectorAll(":scope > .player-card").length : 0;
      const targets = [document.body, grid].filter(Boolean);
      targets.forEach((el) => {
        el.classList.remove(
          "board-count-0",
          "board-count-1",
          "board-count-2",
          "board-count-3",
          "board-count-4",
          "board-count-many"
        );
        el.classList.add(count > 4 ? "board-count-many" : `board-count-${count}`);
      });
    } catch {}
  }

  function syncHeaderTurnStatus(snapshot){
    try {
      const el = document.getElementById("headerTurnStatus");
      if (!el) return;
      if (!snapshot || snapshot._finished) {
        el.textContent = "";
        return;
      }
      if (snapshot?._paused) {
        el.innerHTML = `
          <span class="line">Spiel pausiert</span>
          <span class="line secondary">Warte auf Mitspieler</span>
        `;
        return;
      }
      const turnPid = snapshot?._turn?.player_id || null;
      const turnName = (snapshot?._players || []).find(p => String(p.id) === String(turnPid))?.name || "—";
      const rolls = Number(snapshot?._rolls_used || 0);
      const max = Number(snapshot?._rolls_max || 3);
      const isHC = !!snapshot?._hardcore;
      el.innerHTML = `
        <span class="line">Am Zug: ${esc(turnName)}</span>
        <span class="line secondary">${isHC ? "Hardcore" : `Würfe: ${rolls}/${max}`}</span>
      `;
    } catch {}
  }

  function syncReactionsMount(){
    try {
      if (window.emojiUI && typeof window.emojiUI.init === "function") {
        window.emojiUI.init({ mount: currentReactionsMount(), ws, getMyName: () => myName });
      }
    } catch {}
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
        scrollGridToCard(grid0, target0, "smooth");
        return;
      }

      const turnChanged = String(_lastTurnPid) !== String(turnPid);
      const wroteHappened = (filledNow > _lastFilledCount);

      // Gewünscht: Beim Schreibereignis + Zugwechsel NICHT sofort springen,
      // sondern ~1s warten, damit Spieler/Gegner den Eintrag sehen können.
      if (turnChanged && wroteHappened) {
        _userScrollOverride = false; // manueller Fokus endet beim Zugwechsel
        // Bereits laufenden Timer zurücksetzen
        if (_pendingFollowTimer) { try { clearTimeout(_pendingFollowTimer); } catch {} }
        const targetTurnPid = turnPid; // Ziel-Zug nach der Wartezeit
        _pendingFollowTimer = setTimeout(() => {
          // Nur auto-follow, wenn Nutzer nicht manuell gescrollt hat und
          // der Zug immer noch derselbe ist wie vor 1 Sekunde.
          if (_userScrollOverride) { _pendingFollowTimer = null; return; }
          const curTurn = (sb && sb._turn) ? sb._turn.player_id : (snapshot?._turn?.player_id || null);
          if (String(curTurn) !== String(targetTurnPid)) { _pendingFollowTimer = null; return; }

          const grid = document.querySelector("#scoreOut .players-grid");
          const target = grid ? grid.querySelector(".player-card.turn") : null;
          scrollGridToCard(grid, target, "smooth");
          _pendingFollowTimer = null;
        }, 1000);
      }

      // Baselines aktualisieren (immer)
      _lastTurnPid = turnPid;
      _lastFilledCount = filledNow;

    } catch {}
  }

  function scrollGridToCard(grid, card, behavior = "smooth"){
    try {
      if (!grid || !card) return;
      const gridRect = grid.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const left = grid.scrollLeft + cardRect.left - gridRect.left;
      grid.scrollTo({ left: Math.max(0, left), behavior });
    } catch {
      try { if (grid && card) grid.scrollLeft = card.offsetLeft; } catch {}
    }
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
    const isHC      = !!(snapshot && snapshot._hardcore);
    if (snapshot?._paused) return false;
    if (isSingle || isHC) return false;
    const hasLast   = snapshot?._has_last && snapshot._has_last[myId];
    const corrActive= !!(snapshot?._correction?.active);
    return !!(hasLast && !corrActive);
  }

  // --- Chatbreite ---
	  function syncChatWidth() {
	    try {
	      const score = document.querySelector("#scoreOut");
	      const grid = document.querySelector("#scoreOut .players-grid");
	      const chat = document.querySelector(".chat-panel");
      if (!grid || !chat) return;
      const source = score || grid;
      const w = Math.ceil(source.getBoundingClientRect().width);
      chat.style.maxWidth = w + "px";
      chat.style.marginLeft = "auto";
	      chat.style.marginRight = "auto";
	    } catch {}
	  }

	  function syncSideChatAnchor() {
	    try {
	      const root = document.documentElement;
	      if (!window.matchMedia || !window.matchMedia("(min-width: 900px)").matches) {
	        root.style.removeProperty("--desktop-side-chat-center-y");
	        return;
	      }
	      const selectors = [
	        ".room-header",
	        "#scoreOut .players-grid",
	        "#scoreOut .suggestions-area",
	        "#scoreOut .topbar"
	      ];
	      const rects = selectors
	        .map(sel => document.querySelector(sel))
	        .filter(Boolean)
	        .map(el => el.getBoundingClientRect())
	        .filter(r => r.width > 0 && r.height >= 0);
	      if (!rects.length) {
	        root.style.removeProperty("--desktop-side-chat-center-y");
	        return;
	      }
	      const top = Math.min(...rects.map(r => r.top));
	      const bottom = Math.max(...rects.map(r => r.bottom));
	      const center = Math.round((top + bottom) / 2);
	      root.style.setProperty("--desktop-side-chat-center-y", `${center}px`);
	    } catch {}
	  }

	  window.addEventListener("resize", () => {
	    syncChatWidth();
	    syncSideChatAnchor();
	    syncReactionsMount();
	  });

  // --- Suggestions (nur Anzeige) ---
  /**
   * Zeigt serverseitige Vorschläge an (rein informativ, keine Logik).
   * @param {Array<{type:string,label:string,points:number,eligible:boolean}>} suggestions
   */
  function renderSuggestions(suggestions){
    try{
      const mountEl = document.querySelector("#suggestions");
      if (!mountEl) return;
      const items = (suggestions || []).filter(s => s && s.eligible);
      const order = { POKER:0, SIXTY:1, FULL:2, KENTER:3, MAX:4, MIN:5 };
      const shortLabels = {
        POKER: "Poker",
        SIXTY: "60er",
        FULL: "Full",
        KENTER: "Kenter",
        MAX: "Max",
        MIN: "Min",
        "Gutes Maximum": "Max",
        "Gutes Minimum": "Min",
        "Full House": "Full"
      };
      items.sort((a,b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
      const html = items.map(s => {
        const label = shortLabels[s.type] || shortLabels[s.label] || s.label || s.type || "";
        const pts = (typeof s.points === "number") ? ` <span class="points">${s.points}</span>` : "";
        return `<div class="suggestion-btn" aria-hidden="true">${label}${pts}</div>`;
      }).join("");
      mountEl.innerHTML = html;
    } catch {}
  }

  function renderSuggestionsForSnapshot(snapshot){
    try {
      if (isRollAnimationActive()) {
        deferredSuggestionSnapshot = snapshot || null;
        renderSuggestions([]);
        return;
      }
      renderSuggestions(Array.isArray(snapshot?.suggestions) ? snapshot.suggestions : []);
    } catch {}
  }
  if (new URLSearchParams(location.search).get("__test") === "1") {
    window.__rtDebugRenderSuggestionsForSnapshot = renderSuggestionsForSnapshot;
    window.__rtDebugIsLastAllowedRoll = isLastAllowedRoll;
  }

  // --- DiceBar: Hold/Unhold, Roll, Correction-Request, ESC-Cancel ---
  /**
   * Verdrahtet die Würfel-Leiste: Hold/Unhold, Würfeln, Korrekturanfrage,
   * sowie ESC-Handling zum Abbrechen des Korrekturmodus.
   */
  function wireDiceBar() {
    if (IS_SPECTATOR) {
      const rollBtn0 = $("#rollBtnInline", mount);
      if (rollBtn0) { rollBtn0.disabled = true; rollBtn0.title = "Zuschauer können nicht würfeln"; }
      $$("#diceBar .die", mount).forEach(btn => { btn.style.pointerEvents = "none"; btn.title = "Nur Spieler"; btn.classList.remove("shaking"); });
      const reqBtn0 = $("#requestCorrectionBtn", mount);
      if (reqBtn0) { reqBtn0.disabled = true; reqBtn0.title = "Nur Spieler"; }
      return;
    }
    const rollBtn = $("#rollBtnInline", mount);

    // Ein Button setzt eine neue Ansage oder hebt die aktive Ansage wieder auf.
    const announceBtn = $("#announceBtnInline", mount);
    if (announceBtn && !announceBtn._bound){
      announceBtn._bound = true;
      announceBtn.addEventListener("click", () => {
        if (!sb) return;
        const availability = getAnnounceAvailability(sb);
        if (!availability.usable) {
          syncActionButtons(sb);
          return;
        }
        const state = announceBtn.dataset.state || "announce";

        if (state === "unannounce" && sb?._announced_row4){
          safeSend(ws, { action: "unannounce_row4" });
          return;
        }
        announcePickMode = !announcePickMode;
        applyAnnounceModeButtonVisibility(mount);
        renderFromSnapshot(sb);
      });
    }

    const announcePicker = $("#mobileAnnouncePicker", mount);
    if (announcePicker && !announcePicker._bound) {
      announcePicker._bound = true;
      announcePicker.addEventListener("click", (event) => {
        const option = event.target.closest(".mobile-announce-option");
        if (!option || option.disabled || !announcePickMode || !announceWindowOpen(sb)) return;
        const field = option.dataset.field;
        if (!field) return;
        if (safeSend(ws, { action: "announce_row4", field })) {
          closeAnnouncePickMode();
        }
      });
    }

    if (!document._announceOutsideBound) {
      document._announceOutsideBound = true;
      document.addEventListener("click", (event) => {
        if (!announcePickMode || !isMobileNarrow()) return;
        if (event.target.closest("#mobileAnnouncePicker, #announceBtnInline")) return;
        closeAnnouncePickMode({ rerender:true });
      });
    }

    if (rollBtn && !rollBtn._shakeBound) {
      rollBtn._shakeBound = true;
      rollBtn.addEventListener("click", () => {
        requestRoll({ animate: true });
      });
    }

    $$("#diceBar .die", mount).forEach(btn => {
      if (sb?._superadmin_active) {
        btn.disabled = true;
        btn.title = "Während Superadmin-Edit gesperrt";
        btn.classList.remove("shaking");
        return;
      }
      if (btn._holdBound) return;
      btn._holdBound = true;
      btn.addEventListener("click", () => {
        btn.classList.remove("shaking");

        // Blockiere Hold für "leere" Würfel (Wert 0)
        const i = Number(btn.dataset.i);
        const val = Array.isArray(sb?._dice) ? Number(sb._dice[i] || 0) : 0;
        if (!val) {
          // Sicherheitsnetz: ggf. versehentlich gesetzte UI-Zustaende entfernen
          btn.classList.remove("held");
          return;
        }

        const iAmTurn = (sb?._turn && String(sb._turn.player_id) === String(myId));
        if (!iAmTurn || (sb?._correction?.active)) return;

        // Den Hold sofort darstellen. Zuvor wurde die Markierung erst mit dem
        // Server-Snapshot sichtbar, was sich besonders mobil verzögert anfühlte.
        const nextHeld = !btn.classList.contains("held");
        btn.classList.toggle("held", nextHeld);
        btn.setAttribute("aria-pressed", String(nextHeld));

        const holds = $$("#diceBar .die", mount).map(b => b.classList.contains("held"));
        if (!safeSend(ws, { action: "set_hold", holds })) {
          // Ohne offene Verbindung bleibt kein Zustand stehen, den der Server
          // nie erhalten hat.
          btn.classList.toggle("held", !nextHeld);
          btn.setAttribute("aria-pressed", String(!nextHeld));
        }
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

  // --- Grid-Klicks (mit 0-Confirm) ---
  /**
   * Aktiviert 0-Confirm-Klicks im Scoreboard-Grid. Prüft lokal Sonderfälle
   * wie Poker-Zockerregel für Confirm-Dialoge; Server bleibt autoritativ.
   */
  function wireGridClicks() {
    if (mount._gridBound) return;
    mount._gridBound = true;

    mount.addEventListener("click", (e) => {
      if (IS_SPECTATOR) return;
      const totalEl = e.target.closest(".pc-total");
      if (totalEl && handleSuperadminTap(totalEl)) return;

      if (superadminState.active && handleSuperadminEditClick(e)) return;
      if (sb?._superadmin_active) return;

      const td = e.target.closest("td.cell.clickable");
      if (!td) return;
      const card = td.closest(".player-card");
      if (!card || !card.classList.contains("me")) return;
      const row   = Number(td.getAttribute("data-row"));
      const field = td.getAttribute("data-field");
      // Im Pick-Mode setzt der Klick auf eine freie ❗-Zelle die Ansage statt zu schreiben.
      if (announcePickMode) {
        if (!announceWindowOpen(sb)) return;
        if (field !== "ang") return;
        if (!card.classList.contains("me")) return;
        if (td.textContent && td.textContent.trim().length > 0) return;

        const fieldKey = WRITABLE_MAP[row];
        if (!fieldKey) return;
        safeSend(ws, { action: "announce_row4", field: fieldKey });
        closeAnnouncePickMode();
        return;
      }
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
          // Korrekturmodus: verwende die gespeicherten Meta-Daten aus _correction
          const turn    = sb?._turn || {};
          const corr    = sb?._correction || {};
          const rollIdx = iAmCorrector
            ? Number(corr.roll_index || 0)
            : Number(turn.roll_index || 0);
          let first4    = iAmCorrector
            ? (corr.first4oak_roll ?? null)
            : (turn.first4oak_roll ?? null);

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
          if (iAmCorrector) {
            // Korrektur: Ansage spielt keine Rolle. Nutze gespeicherte Metadaten.
            allowedPoints = (has5 || (has4 && first4 && rollIdx === Number(first4)));
          } else if (inAng && announcedPoker) {
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

        // Generelle Reihenfolge-Prüfung für ⬇︎/⬆︎: wenn nicht „dran“, dann Aktion unterbinden
        if (field === "down" || field === "up") {
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
            // Nicht „dran“ -> keinerlei Aktion; Strike-Dialog NICHT anzeigen.
            return;
          }
        }

        // Nur wenn der berechnete Wert wirklich 0 ist, nachfragen (Strike).
        // Hinweis: Bei ⬇︎/⬆︎ wurde oben bereits auf „dran“ geprüft und ggf. abgebrochen.
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

  function handleSuperadminTap(totalEl){
    try {
      if (!authState?.user?.is_admin) return false;
      const card = totalEl.closest(".player-card");
      const boardId = card ? String(card.dataset.boardId || "") : "";
      if (!boardId) return false;

      const now = Date.now();
      if (superadminTapState.boardId !== boardId || now - superadminTapState.lastTs > 2500) {
        superadminTapState = { boardId, count: 1, lastTs: now };
      } else {
        superadminTapState.count += 1;
        superadminTapState.lastTs = now;
      }

      if (superadminTapState.count >= 10) {
        superadminTapState = { boardId: null, count: 0, lastTs: 0 };
        safeSend(ws, { action: "superadmin_activate", board_id: boardId });
      }
      return true;
    } catch {
      return false;
    }
  }

  function handleSuperadminEditClick(e){
    try {
      const td = e.target.closest("td.cell[data-row][data-field]");
      if (!td) return false;
      const card = td.closest(".player-card");
      const boardId = card ? String(card.dataset.boardId || "") : "";
      if (!boardId || boardId !== String(superadminState.boardId || "")) return false;
      if (td.classList.contains("compute")) return true;

      const row = Number(td.getAttribute("data-row"));
      const field = td.getAttribute("data-field");
      if (!Number.isFinite(row) || !field) return true;

      const key = `${row},${field}`;
      const board = getSnapshotBoard(superadminState.boardId);
      const hasOriginal = Object.prototype.hasOwnProperty.call(board, key);
      const original = hasOriginal ? String(board[key]) : "";
      const existingDraft = superadminState.draft[key];
      const current = existingDraft
        ? (existingDraft.delete ? "" : String(existingDraft.value))
        : original;
      const promptText = hasOriginal
        ? "Neuer Wert. Leer lassen, um dieses Feld zu löschen."
        : "Wert für leeres Feld. Speichern ist nur mit gleichzeitiger Löschung möglich.";
      const next = prompt(promptText, current || (hasOriginal ? "" : "0"));
      if (next === null) return true;

      const trimmed = String(next).trim();
      if (trimmed === "") {
        if (!hasOriginal) {
          alert("Ein leeres Feld kann nicht gelöscht werden.");
          return true;
        }
        superadminState.draft[key] = { row, field, value: null, delete: true };
      } else {
        const value = Number(trimmed);
        if (!Number.isInteger(value) || value < 0 || value > 9999) {
          alert("Bitte eine ganze Zahl zwischen 0 und 9999 eingeben.");
          return true;
        }
        if (hasOriginal && String(value) === original) {
          delete superadminState.draft[key];
        } else {
          superadminState.draft[key] = { row, field, value, delete: false };
        }
      }
      applySuperadminUiState();
      return true;
    } catch {
      return false;
    }
  }

  function applySuperadminUiState(){
    try {
      document.body.classList.toggle("superadmin-active", !!superadminState.active);
      $$(".player-card").forEach(card => {
        const isTarget = superadminState.active && String(card.dataset.boardId || "") === String(superadminState.boardId || "");
        card.classList.toggle("admin-target", !!isTarget);
      });
      renderSuperadminToolbar();
      applySuperadminDraftPreview();
    } catch {}
  }

  function getSnapshotBoard(boardId){
    const bid = String(boardId || "");
    const mode = String(sb?._mode || "").toLowerCase();
    if (mode === "2v2") return (sb?._scoreboards_by_team?.[bid]) || {};
    return (sb?._scoreboards?.[bid]) || {};
  }

  function adminDraftEntries(){
    return Object.values(superadminState.draft || {});
  }

  function validateAdminDraftClient(){
    const changes = adminDraftEntries();
    if (!changes.length) return "Keine Änderungen vorhanden.";
    const board = getSnapshotBoard(superadminState.boardId);
    const deletes = changes.filter(c => c.delete);
    const writes = changes.filter(c => !c.delete);
    if (deletes.length) {
      const emptyWrites = writes.filter(c => !Object.prototype.hasOwnProperty.call(board, `${c.row},${c.field}`));
      const existingWrites = writes.filter(c => Object.prototype.hasOwnProperty.call(board, `${c.row},${c.field}`));
      if (existingWrites.length) return "Beim Löschen dürfen nur leere Felder neu beschrieben werden.";
      if (deletes.length !== emptyWrites.length) return "Jede Löschung braucht genau ein neu beschriebenes leeres Feld.";
    } else {
      const emptyWrites = writes.filter(c => !Object.prototype.hasOwnProperty.call(board, `${c.row},${c.field}`));
      if (emptyWrites.length) return "Leere Felder dürfen nur zusammen mit einer Löschung beschrieben werden.";
    }
    return "";
  }

  function saveSuperadminDraft(){
    const validation = validateAdminDraftClient();
    if (validation) {
      alert(validation);
      return;
    }
    safeSend(ws, {
      action: "superadmin_save",
      board_id: superadminState.boardId,
      changes: adminDraftEntries(),
    });
  }

  function discardSuperadminDraft(){
    superadminState.draft = {};
    applySuperadminUiState();
  }

  function exitSuperadminMode(){
    if (adminDraftEntries().length && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    superadminState = { active: false, boardId: null, draft: {} };
    resetAfterSuperadminExit({ scrollTop: false });
    safeSend(ws, { action: "superadmin_deactivate" });
  }

  function resetAfterSuperadminExit({ scrollTop = true } = {}){
    try {
      superadminState = { active: false, boardId: null, draft: {} };
      document.body.classList.remove("superadmin-active");
      normalizeTransientLayoutForAdmin({ scrollTop });

      const bar = document.getElementById("superadminBar");
      if (bar) bar.remove();
      const notice = document.getElementById("superadminLockNotice");
      if (notice) notice.remove();
      $$(".admin-target").forEach(el => el.classList.remove("admin-target"));
      $$(".admin-draft").forEach(td => td.classList.remove("admin-draft", "admin-draft-delete"));

      syncRoomLayoutSoon({ scrollTop });
    } catch {}
  }

  function renderSuperadminToolbar(){
    let bar = document.getElementById("superadminBar");
    if (!superadminState.active) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "superadminBar";
      bar.className = "superadmin-bar";
      bar.innerHTML = `
        <span class="superadmin-bar-label"></span>
        <button id="superadminSave" class="small primary" type="button">Speichern</button>
        <button id="superadminDiscard" class="small" type="button">Verwerfen</button>
        <button id="superadminExit" class="small ghost" type="button">Beenden</button>
      `;
      document.body.appendChild(bar);
      bar.querySelector("#superadminSave").addEventListener("click", saveSuperadminDraft);
      bar.querySelector("#superadminDiscard").addEventListener("click", discardSuperadminDraft);
      bar.querySelector("#superadminExit").addEventListener("click", exitSuperadminMode);
    }
    const count = adminDraftEntries().length;
    const label = bar.querySelector(".superadmin-bar-label");
    if (label) label.textContent = `Superadmin aktiv • ${count} Änderung${count === 1 ? "" : "en"}`;
    const saveBtn = bar.querySelector("#superadminSave");
    const discardBtn = bar.querySelector("#superadminDiscard");
    if (saveBtn) saveBtn.disabled = count === 0;
    if (discardBtn) discardBtn.disabled = count === 0;
  }

  function applySuperadminDraftPreview(){
    $$(".admin-draft").forEach(td => td.classList.remove("admin-draft", "admin-draft-delete"));
    if (!superadminState.active) return;
    const card = document.querySelector(`.player-card[data-board-id="${cssEscape(superadminState.boardId)}"]`);
    if (!card) return;
    adminDraftEntries().forEach(change => {
      const td = card.querySelector(`td.cell[data-row="${change.row}"][data-field="${cssEscape(change.field)}"]`);
      if (!td) return;
      td.classList.add("admin-draft");
      if (change.delete) {
        td.classList.add("admin-draft-delete");
        td.textContent = "";
      } else {
        td.textContent = String(change.value);
      }
    });
  }

  function cssEscape(value){
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  // ---------- Hotkeys ----------
  /**
   * Prüft, ob aktuell ein Wurf zulässig ist (Client-Guards). Der Server
   * validiert zusätzlich inkl. Cooldown und Spielzustand.
   * @returns {boolean}
   */
  function canRollNow() {
    return getRollAvailability(sb).usable;
  }

  /**
   * Sendet einen manuellen Roll-Request mit derselben Animation/Guard-Logik
   * wie der Würfeln-Button.
   */
  function safeRoll() {
    requestRoll({ animate: true });
  }

  /**
   * Registriert Hotkeys: ESC (Cancel/Pick-Mode), 1..5 (Holds),
   * Space/r (Roll), a (Ansage), u (Ansage aufheben), k (Korrektur anfragen).
   */
  function ensureKeybindings() {
    if (document._roomKeysBound) return;
    document._roomKeysBound = true;

    document.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      if (IS_SPECTATOR) return;

      // Korrektur abbrechen (ESC) – bereits global in wireDiceBar gesetzt; hier nur Guard
      if (key === "escape") {
        // 1) Ansage-Pick-Mode verlassen
        if (announcePickMode) {
          closeAnnouncePickMode({ rerender:true });
          e.preventDefault();
          return;
        }
        // 2) Korrekturmodus abbrechen (wie gehabt)
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
        const inCorr = !!(sb?._correction?.active);
        if (!iAmTurn || inCorr) return;

        const holdsEls = $$("#diceBar .die", mount);
        const next = holdsEls.map(b => b.classList.contains("held"));
        next[idx] = !next[idx];
        safeSend(ws, { action: "set_hold", holds: next });
        e.preventDefault();
        return;
      }

      // Space / r: würfeln
      if (key === " " || key === "spacebar" || key === "r") {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (canRollNow()) safeRoll();
        e.preventDefault();
        return;
      }

      // u: Ansage aufheben (nutzt den Ein-Button #announceBtnInline im Zustand "unannounce")
      if (key === "u") {
        const btn = $("#announceBtnInline", mount);
        if (btn && !btn.disabled && btn.dataset.state === "unannounce") {
          btn.click();
          e.preventDefault();
        }
        return;
      }

      // k: Korrektur anfragen
      if (key === "k") {
        const btn = $("#requestCorrectionBtn", mount);
        if (btn && !btn.disabled) { btn.click(); e.preventDefault(); }
        return;
      }

      // a: Ansage-Button (toggle / aufheben) – nur im erlaubten Fenster (Wurf 1)
      if (key === "a") {
        const btn = $("#announceBtnInline", mount);
        if (btn && !btn.disabled) {
          btn.click();
          e.preventDefault();
        }
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
  /**
   * Zeigt einen kurzen Hinweis, wenn Zuschauer beitreten/verlassen.
   * @param {{event:string,name:string}} evt
   */
  function showSpectatorToast(evt){
    try {
      const { event, name } = evt || {};
      const host = reactionsMount || document.body;
      const el = document.createElement("div");
      el.className = "spectator-toast";
      el.textContent = event === "left"
        ? `Zuschauer hat verlassen: ${name}`
        : `Zuschauer verbunden: ${name}`;
      el.style.display = "inline-block";
      el.style.marginLeft = ".5rem";
      el.style.padding = ".35rem .55rem";
      el.style.borderRadius = "8px";
      el.style.background = "rgba(0,0,0,.85)";
      el.style.color = "#fff";
      el.style.fontSize = ".92rem";
      el.style.pointerEvents = "none";
      host.appendChild(el);
      setTimeout(() => { el.style.transition = "opacity .35s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 380); }, 1400);
    } catch {}
  }

  /**
   * HTML-Escaping für sichere Anzeige von Text (z. B. in Tooltips).
   * @param {string} s
   * @returns {string}
   */
  function esc(s){
    return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  }
})();
