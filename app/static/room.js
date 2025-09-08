/*
  room.js – Raum-Client
  ----------------------
  Verantwortlich für:
  - WebSocket-Interaktion mit dem Server (Join, Würfeln, Schreiben, Korrektur)
  - Rendering von Scoreboard, Würfel-UI, Vorschlägen und Reactions/Chat
  - Clientseitige Guards für bessere UX (z. B. Roll-Button Throttle)

  Wichtige Snippets:
  - safeSend(): Enthält einen kurzen zeitbasierten Throttle für 'roll'-Events, um
    Double-Click/Mehrfachklicks abzufangen. Der Button wird für ~0.5s deaktiviert,
    damit keine Doppelwürfe ausgelöst werden. Das korrespondiert mit einem
    serverseitigen Cooldown.
  - applyAnnounceModeButtonVisibility(): Steuert die Sichtbarkeit des Würfeln-Buttons
    im Ansage-Pick-Modus über visibility, nicht display, damit sich das Layout nicht
    verschiebt.
*/
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
      pass:   u.searchParams.get("pass") || "",
      spectator: u.searchParams.get("spectator") === "1"
    };
  }

  function wsURL(gid) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/${encodeURIComponent(gid)}`;
  }

  function safeSend(ws, obj) {
    /*
      Roll-Event Throttle & Button-Guard (500 ms)
      -------------------------------------------
      Problem: Sehr schnelle Mehrfach-Klicks (oder doppelte Handler) koennen mehrere
               'roll'-Events auf dem WS senden -> fühlt sich an wie "2x gewürfelt".
      Loesung: Für 'roll' wird clientseitig ein kurzer Zeit-Guard aktiviert.
               - Zweite Sendung < 500 ms wird verworfen.
               - Passend dazu wird der Roll-Button visuell für ~0.5 s deaktiviert.
               - Der 3. Wurf funktioniert normal, weil der Guard rein zeitbasiert ist.
    */

    // Erfasst aktuelle und legacy-Felder: action/type/t = 'roll_dice' ODER 'roll'
    const isRoll =
      obj && (
        obj.action === 'roll_dice' || obj.type === 'roll_dice' || obj.t === 'roll_dice' ||
        obj.type === 'roll'       || obj.t === 'roll'        || obj.action === 'roll'
      );

    // Globaler Zeitstempel für den letzten Roll-Send (einmalig initialisieren)
    if (typeof window.__rt_lastRollSent !== 'number') {
      window.__rt_lastRollSent = 0;
    }

    if (isRoll) {
      const now = Date.now();
      // Doppelklick-/Mehrfachklick-Schutz: alles < 500 ms seit letztem Roll wird verworfen
      if (now - window.__rt_lastRollSent < 500) {
        return; // zu schnell hintereinander -> NICHT senden
      }
      window.__rt_lastRollSent = now;

      // UI-Feedback: Roll-Button kurz deaktivieren (ohne hart auf eine einzige ID festzunageln)
      const rollBtn =
        document.querySelector('[data-action="roll"]') ||     // bevorzugtes data-Attribut
        document.getElementById('rollBtnInline') ||           // aktueller Inline-Button
        document.getElementById('btnRoll') ||                 // ältere Variante
        document.querySelector('button.roll');                // Fallback CSS-Klasse

      if (rollBtn && !rollBtn.disabled) {
        rollBtn.disabled = true;
        // 550 ms statt 500 ms, damit UX sicher die Sperre "fühlt" und Text/Focus stabil bleibt
        setTimeout(() => { rollBtn.disabled = false; }, 550);
      }
    }

    // Senden nur, wenn der Socket offen ist – verhindert Fehler bei Race Conditions
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    } catch (e) {
      // bewusst leise – wir wollen UI nicht blockieren; Logging kann bei Bedarf ergänzt werden
    }
  }

  // --- Client-Punkteberechnung (nur für 0-Confirm UX) ---
  // Map der schreibbaren Reihen -> Feldkey
  const WRITABLE_MAP = {
    0:"1",1:"2",2:"3",3:"4",4:"5",5:"6",
    9:"max",10:"min",12:"kenter",13:"full",14:"poker",15:"60"
  };
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
  let myId   = sessionStorage.getItem(PID_KEY) || null;
  let myName = qs.name;

  let ws = null;
  let sb = null; // letzter Snapshot
  let sendLock = { write:false, roll:false };
  let autoRollLock = false;
  const DEBUG_P_HOTKEY = false; // optionaler Debug-Hotkey "p" -> Poker/Free

  // --- NEU: UI-State für Ansage-Auswahlmodus (per Button/Hotkey A) ---
  let announcePickMode = false;

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

  // Helper: prüft, ob das Ansage-Fenster (direkt nach Wurf 1, keine Korrektur, keine bestehende Ansage, ich am Zug) offen ist
  function announceWindowOpen(snapshot){
    const rolls = Number(snapshot?._rolls_used || 0);
    const iAmTurn = (snapshot?._turn && String(snapshot._turn.player_id) === String(myId));
    const corrActive = !!(snapshot?._correction?.active);
    const announced = snapshot?._announced_row4 || null;
    return iAmTurn && !corrActive && rolls === 1 && !announced;
  }

  // --- Helper: eigenes Board (Spieler oder Team) holen ---
  function getMyBoard(snapshot){
    const mode = String(snapshot?._mode || "").toLowerCase();
    if (mode === "2v2" && Array.isArray(snapshot?._teams)) {
      const myTeam = (snapshot._teams.find(t => (t.members || []).some(m => String(m) === String(myId))) || {}).id;
      return myTeam ? (snapshot._scoreboards_by_team?.[myTeam] || {}) : {};
    }
    return (snapshot?._scoreboards?.[myId]) || {};
  }

  // --- Helper: prüft, ob eine Spalte (down/free/up) vollständig ist (alle schreibbaren Reihen belegt) ---
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

  // --- Helper: Anzahl leerer Zellen in ❗ auf dem eigenen Board ---
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

  // --- Helper: Gesamtzahl aller offenen, beschreibbaren Zellen im eigenen Board (Deadlock-Schutz) ---
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

  // --- Policy: Muss nach Wurf 1 angesagt werden (um weiter würfeln zu dürfen)? ---
  function mustAnnounceAfterFirst(snapshot){
    const sc = getMyBoard(snapshot);
    const colFull = isColFull(sc, "down") && isColFull(sc, "free") && isColFull(sc, "up");
    const freeAng = emptyCountAng(sc);
    const openAll = totalOpenWritable(sc);
    // Pflicht nur, wenn 3 Reihen voll sind, in ❗ mind. zwei frei und nicht im "letztes Feld" Sonderfall
    return Boolean(colFull && freeAng >= 2 && openAll !== 1);
  }

  // --- Rolling-Block: gilt nach Wurf ≥1, wenn Pflichtbedingungen erfüllt und (noch) keine Ansage existiert ---
  function isRollingBlocked(snapshot){
    const rolls = Number(snapshot?._rolls_used || 0);
    const announced = snapshot?._announced_row4 || null;
    return (rolls >= 1) && mustAnnounceAfterFirst(snapshot) && !announced;
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
      // --- "Zurück zur Lobby" mit Confirm + Abbruch für alle ---
    (function bindBackToLobby() {
      const btn = document.getElementById("backToLobbyBtn");
      if (!btn || btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (IS_SPECTATOR) { location.href = "/"; return; }  // Zuschauer: nur verlassen
        const who = (myName || "Spieler").trim();
        const ok = confirm("Willst du das Spiel wirklich abbrechen? Alle werden in die Lobby geschickt.");
        if (!ok) return;
        if (!window._abortRequested) {
          window._abortRequested = true;
          safeSend(ws, { action: "end_game", by: who });
        }
      });
    })();
    ws = new WebSocket(wsURL(qs.game_id));

    ws.addEventListener("open", () => {
      initChat(ws, { meName: myName });
      if (myId) {
        safeSend(ws, { action: "rejoin_game", player_id: myId });
      } else if (IS_SPECTATOR) {
        safeSend(ws, { action: "spectate_game", name: myName, pass: qs.pass });
      } else {
        safeSend(ws, { action: "join_game", name: myName, pass: qs.pass });
      }
    });

    ws.addEventListener("message", (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }

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
      if (msg.player_id && !myId) {
        myId = String(msg.player_id);
        sessionStorage.setItem(PID_KEY, myId);
      }

      // Fehler
      if (msg.error) {
        console.warn("Serverfehler:", msg.error);
        if (/passphrase/i.test(msg.error) || /pass/i.test(msg.error)) {
          alert("Beitritt abgelehnt: " + msg.error);
          location.href = "/";
          return;
        }
      }

      // Scoreboard-Update
      if (msg.scoreboard) {
        sb = msg.scoreboard;
        renderFromSnapshot(sb);

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
      }

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

      // Zuschauer-Toast
      if (msg.spectator && typeof msg.spectator.name === "string") {
        showSpectatorToast(msg.spectator); // Objekt übergeben, kein fertiger Text
      }

      if (Array.isArray(msg.chat_history)) {
        msg.chat_history.forEach(m => { if (m?.text) addChatMessage(m.sender || "???", m.text); });
      }
    });

    ws.addEventListener("close", () => setTimeout(connect, 1000));
  }
  connect();

  // ---------- Render & Events ----------
/**
 * Rendert die komplette Room-Ansicht aus einem Server-Snapshot.
 * Aktualisiert Dicebar, Scoreboards, Vorschläge, Reactions und UI-Zustände
 * (Ansage, Korrektur, Auto-Follow, Mobile-Layout).
 * @param {object} snapshot - Server-Snapshot der aktuellen Spielsituation
 */
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

        // --- NEU: Roll-Button sperren, falls nach Wurf 1 eine Ansage Pflicht ist ---
    try{
      const blockRoll = isRollingBlocked(snapshot);
      const rollBtn = $("#rollBtnInline", mount);
      if (rollBtn){
        rollBtn.disabled = blockRoll || !!(snapshot?._correction?.active);
        rollBtn.title = rollBtn.disabled
          ? "Weiter würfeln erst nach Ansage möglich (Pflicht nach Wurf 1)."
          : "Würfeln";
      }
      // Hinweiszeile (falls vorhanden)
      const hint = document.getElementById("announceHint");
      if (hint){
        hint.textContent = (blockRoll ? "Bitte ein ❗-Feld ansagen, bevor du weiter würfelst." : "");
      }
    } catch {}

    // --- NEU: Ansage-Button beschriften/aktivieren ---
    try{
      const ab = $("#announceBtnInline", mount);
      if (ab){
        const announced = snapshot?._announced_row4 || null;
        const rolls = Number(snapshot?._rolls_used || 0);
        const iAmTurn = (snapshot?._turn && String(snapshot._turn.player_id) === String(myId));
        const corrActive = !!(snapshot?._correction?.active);
        // Button ist nur direkt nach Wurf 1 für den Zuginhaber sinnvoll
        const usable = iAmTurn && !corrActive && rolls === 1;
        ab.disabled = !usable;
        // Ein Button für beides: Ansagen ODER Aufheben
        if (announced){
          ab.textContent = "Ansage aufheben";
          ab.dataset.state = "unannounce";
          // Falls eine Ansage existiert, Pick-Mode beenden (UI sauber halten)
          announcePickMode = false;
        } else {
          ab.textContent = announcePickMode ? "Ansage wählen" : "Ansagen";
          ab.dataset.state = "announce";
        }
        // Lange Labels muessen umbrechen, damit die Buttonbreite konstant bleibt
        ab.style.whiteSpace = 'normal';
        ab.style.lineHeight = '1.15';
      }
    } catch {}

    // --- Auto-Beenden des Pick-Modes außerhalb des Fensters ---
    try{
      if (!announceWindowOpen(snapshot)) {
        if (announcePickMode) {
          announcePickMode = false;
          $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
          // Sichtbarkeit des Würfeln-Buttons nach Pick-Mode beenden zurücksetzen
          applyAnnounceModeButtonVisibility(mount);
        }
      }
    } catch {}
    // Während des Ansage-Pick-Modes den Würfeln-Button unsichtbar schalten,
    // ohne das Layout zu verschieben (visibility statt display)
    applyAnnounceModeButtonVisibility(mount);

    // --- NEU: Pick-Mode – ❗-Zellen im eigenen Board als klickbar markieren ---
    try{
      // Zuerst alte Markierungen entfernen
      $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));

      if (announcePickMode){
        // Nur eigenes Board, nur ❗-Spalte, nur **schreibbare** (nicht-compute) leere Zellen
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
          // WICHTIG: compute-Zellen ausschließen → Diff wird nicht mehr markiert
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

    // Emoji-FAB nach jedem Render wieder im Header einsetzen
    if (window.emojiUI && typeof window.emojiUI.init === "function") {
      window.emojiUI.init({ mount: reactionsMount, ws, getMyName: () => myName });
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
    // Immer die vorherige Scrollposition wiederherstellen, solange der Nutzer
    // nicht manuell uebersteuert hat. So bleibt der zuletzt sichtbare Board-Fokus
    // fuer ~1s bestehen, bevor der Auto-Follow greift – fuer alle Nutzer.
    if (_newGrid && !_userScrollOverride) {
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
          if (grid && target && typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
          }
          _pendingFollowTimer = null;
        }, 1000);
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

        // NEU: Ansage-Button (ein Button für Ansage setzen ODER aufheben)
    const announceBtn = $("#announceBtnInline", mount);
    if (announceBtn && !announceBtn._bound){
      announceBtn._bound = true;
      announceBtn.addEventListener("click", () => {
        if (!sb) return;
        const state = announceBtn.dataset.state || "announce";
        const rolls = Number(sb?._rolls_used || 0);
        const iAmTurn = (sb?._turn && String(sb._turn.player_id) === String(myId));
        const corrActive = !!(sb?._correction?.active);
        // Guard: nur direkt nach Wurf 1 vom Zugspieler
        if (!(iAmTurn && !corrActive && rolls === 1)) return;

        if (state === "unannounce" && sb?._announced_row4){
          // Aufheben (gleiches Server-API wie bisher)
          safeSend(ws, { action: "unannounce_row4" });
          return;
        }
        // Ansage setzen → Pick-Mode toggeln
        announcePickMode = !announcePickMode;
        // Sichtbarkeit des Würfeln-Buttons sofort anpassen
        applyAnnounceModeButtonVisibility(mount);
        // Re-Render Markierungen
        renderFromSnapshot(sb);
      });
    }

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

        // Blockiere Hold für "leere" Würfel (Wert 0)
        const i = Number(btn.dataset.i);
        const val = Array.isArray(sb?._dice) ? Number(sb._dice[i] || 0) : 0;
        if (!val) {
          // Sicherheitsnetz: ggf. versehentlich gesetzte UI-Zustaende entfernen
          btn.classList.remove("held");
          return;
        }

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
  /**
   * Bindet die Ansage-UI (❗): Auswahl des Feldes nach Wurf 1,
   * Umschalten/Zurückziehen der Ansage und visuelle Markierungen.
   */
  function wireAnnounceUI() {
    if (IS_SPECTATOR) {
      const sel0 = $("#announceSelect", mount);
      if (sel0) { sel0.disabled = true; sel0.title = "Nur Spieler"; }
      const unbtn0 = $("#unannounceBtn", mount);
      if (unbtn0) { unbtn0.disabled = true; unbtn0.title = "Nur Spieler"; }
      return;
    }
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
  /**
   * Aktiviert 0-Confirm-Klicks im Scoreboard-Grid. Prüft lokal Sonderfälle
   * wie Poker-Zockerregel für Confirm-Dialoge; Server bleibt autoritativ.
   */
  function wireGridClicks() {
    if (mount._gridBound) return;
    mount._gridBound = true;

    mount.addEventListener("click", (e) => {
      if (IS_SPECTATOR) return;
      const td = e.target.closest("td.cell.clickable");
      if (!td) return;
      const row   = Number(td.getAttribute("data-row"));
      const field = td.getAttribute("data-field");
      // --- NEU: Ansage-Pick-Mode ---
      // Wenn aktiv: Klick auf leere ❗-Zelle im eigenen Board setzt die Ansage (statt zu schreiben)
      if (announcePickMode) {
        // Race-Guard: nur im gültigen Zeitfenster (Wurf 1, keine Korrektur, keine bestehende Ansage, ich am Zug)
        if (!announceWindowOpen(sb)) return;
        // Nur ❗-Spalte akzeptieren
        if (field !== "ang") return;
        // nur eigenes Board: .player-card.me
        const card = td.closest(".player-card");
        if (!card || !card.classList.contains("me")) return;
        // nur leere Zelle
        if (td.textContent && td.textContent.trim().length > 0) return;

        const fieldKey = WRITABLE_MAP[row];
        if (!fieldKey) return;
        // Server-Call: Ansage auf das gewählte Feld
        safeSend(ws, { action: "announce_row4", field: fieldKey });
        // Pick-Mode beenden – der Snapshot nach Serverantwort aktualisiert UI/Label
        announcePickMode = false;
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

  // ---------- Hotkeys ----------
  /**
   * Prüft, ob aktuell ein Wurf zulässig ist (Client-Guards). Der Server
   * validiert zusätzlich inkl. Cooldown und Spielzustand.
   * @returns {boolean}
   */
  function canRollNow() {
    // Darf nur würfeln, wenn:
    // - ich am Zug bin
    // - kein Korrekturmodus aktiv
    // - unter Roll-Cap
    // - und NICHT durch „Ansage nach Wurf 1“ gesperrt
    if (!sb) return false;
    const iAmTurn = sb?._turn && String(sb._turn.player_id) === String(myId);
    const underCap = ((sb?._rolls_used || 0) < (sb?._rolls_max || 3));
    const blocked = isRollingBlocked(sb);
    return iAmTurn && !(sb?._correction?.active) && underCap && !blocked;
  }

  /**
   * Sendet einen Roll-Request via safeSend mit kurzem UI-Lock (Throttle),
   * um Doppelwürfe durch Mehrfachklicks zu verhindern.
   */
  function safeRoll() {
    if (!canRollNow() || sendLock.roll) return;
    sendLock.roll = true;
    try { safeSend(ws, { action: "roll_dice" }); }
    finally { setTimeout(() => { sendLock.roll = false; }, 200); }
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
          announcePickMode = false;
          // Sichtbarkeit des Würfeln-Buttons nach Pick-Mode beenden zurücksetzen
          applyAnnounceModeButtonVisibility(mount);
          $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
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