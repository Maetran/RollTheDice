/*
  scoreboard.js – Scoreboard Rendering & Hints
  -------------------------------------------
  Verantwortlich für:
  - Rendering des Spielstands für Spieler/Teams (inkl. Summen und Bonus)
  - Tooltips, Clickability (welche Zellen sind interaktiv), Markierungen (❗ Ansage,
    letzte Schreibzelle), sowie Read-Only-Views (Leaderboard Replay)

  Wichtige Snippets:
  - computeColumnTotals(): Berechnet Top-Summe, Bonus, Differenz (1×(max−min)) und
    Bottom-Summe (Kenter/Full/Poker/60) pro Spalte. Rein Anzeige – die echte Logik
    und Validierung passieren serverseitig.
  - renderRows(): Markiert Zellen als "clickable" nur, wenn der Server dies implizit
    erlaubt (iAmTurn, gerollt, Ansage-Regeln). Hinweise/Tooltips spiegeln die selben
    Regeln wider wie `can_write_now` auf dem Server.
  - buildClientSnapshotFromLeaderboard(): Wandelt einen Leaderboard-Eintrag wieder in
    einen Client-Snapshot für die Read-Only-Ansicht um.

  Hinweis: Die Poker- und Ansagelogik wird serverseitig bewertet. Dieses Modul zeigt
  lediglich die Entscheidungen an und leitet Klicks weiter.
*/
// static/scoreboard.js
// Einzel- & Team-Mode (2v2) – robust gegen verschiedene Snapshot-Formate

const ROW_LABELS = [
  "1","2","3","4","5","6",
  "S","B","ZTO",
  "+","-","D",
  "K","F","P","60",
  "ZTU","T"
];

const ROW_FIELD_KEYS = [
  "1","2","3","4","5","6",
  null, null, null,
  "max","min",
  null,
  "kenter","full","poker","60",
  null, null
];

const ROW_TOOLTIPS = [
  "Summe der ⚀ (nur Einsen)",
  "Summe der ⚁ (nur Zweien)",
  "Summe der ⚂ (nur Dreien)",
  "Summe der ⚃ (nur Vieren)",
  "Summe der ⚄ (nur Fünfen)",
  "Summe der ⚅ (nur Sechsen)",
  "Zwischensumme oben (1–6)",
  "Bonus +30 (Normal: ≥ 60 • Hardcore: ≥ 40)",
  "ZwTotalOben = ZwSumme + Bonus",
  "Max: Summe aller 5 Würfel (höchster Wurf)",
  "Min: Summe aller 5 Würfel (niedrigster Wurf)",
  "Diff = Einsen × (Max − Min), niemals negativ",
  "Kenter: immer 35 Punkte, wenn alle 5 Augen verschieden",
  "Full House: 3 gleiche + 2 gleiche → 40 + 3×Augenzahl der Drilling-Augen",
  "Poker (Vierling): ⬇︎／／⬆︎ → Punkte nur im Wurf des ersten Vierlings oder bei 5 gleichen; ❗ + aktive Poker-Ansage → Punkte in jedem späteren Wurf, solange 4/5 gleiche liegen",
  "60 (Fünfling): 5 gleiche → 60 + 5×Augenzahl",
  "ZwTotalUnten = Kenter + Full + Poker + 60",
  "Reihentotal = ZwTotalOben + Diff + ZwTotalUnten"
];

const ANNOUNCE_FIELDS = ["1","2","3","4","5","6","max","min","kenter","full","poker","60"];
const COMPUTE_ROWS = new Set([6,7,8,11,16,17]);

// Kurzerklärung je Feld (für Mouseover/On-Tap)
const FIELD_HINTS = {
  "1": "Summe aller 1er",
  "2": "Summe aller 2er",
  "3": "Summe aller 3er",
  "4": "Summe aller 4er",
  "5": "Summe aller 5er",
  "6": "Summe aller 6er",
  "S": "Summe der Felder 1–6",
  "B": "+30 (Normal: ≥ 60 • Hardcore: ≥ 40)",
  "ZTO": "Zwischentotal oben",
  "ZTU": "Zwischentotal unten",
  "+": "Summe aller fünf Würfel",
  "-": "Summe aller fünf Würfel",
  "D": "1 × (Max − Min), nie negativ",
  "K": "Fünf unterschiedliche (35 Punkte)",
  "F": "40 + 3×Wert der Drilling-Augen",
  "P": "⬇︎／／⬆︎: Punkte nur im ersten Vierlings-Wurf oder bei 5 gleichen • ❗+Ansage: Punkte in jedem späteren Wurf, solange 4/5 gleiche liegen (50 + 4×Wert)",
  "T": "ZwTotalOben + Diff + ZwTotalUnten",
  "ZwSumme": "Summe der Felder 1–6",
  "Bonus": "+30 (Normal: ≥ 60 • Hardcore: ≥ 40)",
  "ZwTotalOben": "ZwSumme + Bonus",
  "Max": "Summe aller fünf Würfel",
  "Min": "Summe aller fünf Würfel",
  "Diff": "1 × (Max − Min), nie negativ",
  "Kenter": "Fünf unterschiedliche (35 Punkte)",
  "Full": "40 + 3×Wert der Drilling-Augen",
  "Poker": "⬇︎／／⬆︎: Punkte nur im ersten Vierlings-Wurf oder bei 5 gleichen • ❗+Ansage: Punkte in jedem späteren Wurf, solange 4/5 gleiche liegen (50 + 4×Wert)",
  "60": "60 + 5×Wert der Fünfling-Augen",
  "ZwTotalUnten": "Kenter + Full + Poker + 60",
  "Reihentotal": "ZwTotalOben + Diff + ZwTotalUnten"
};

/**
 * Liefert eine Kurzbeschreibung für ein Feld-Label.
 * @param {string} lbl
 * @returns {string}
 */
function hintForLabel(lbl){
  return FIELD_HINTS[lbl] || "";
}

/**
 * Gruppierungs-Metadaten für Tabellenzeilen (Top/Diff/Bottom-Bereiche).
 * @param {number} ri - row index
 * @returns {{group:string|null,start:boolean,end:boolean}}
 */
function rowGroupMeta(ri){
  if (ri >= 6 && ri <= 8)   return { group: "top",    start: ri === 6,  end: ri === 8  };
  if (ri === 11)            return { group: "diff",   start: true,      end: true      };
  if (ri >= 16 && ri <= 17) return { group: "bottom", start: ri === 16, end: ri === 17 };
  return { group: null, start: false, end: false };
}

const num = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Liest den Rohwert einer Zelle aus einem Scoreboard-Objekt.
 * @param {Object} sc - Scoreboard-Mapping {"row,col": value}
 * @param {number} ri - row index
 * @param {string} colKey - Spalte (down|free|up|ang)
 * @returns {number|string|undefined}
 */
function getCell(sc, ri, colKey){ return sc[`${ri},${colKey}`]; }

/**
 * Berechnet Summen/Totalwerte für eine Spalte.
 * Hinweis: Anzeige-Logik – Server ist autoritativ.
 * @param {Object} sc
 * @param {string} colKey
 * @returns {{sumTop:number, bonusVal:number, totalTop:number, diff:number|null, sumBottom:number, totalColumn:number}}
 */
function computeColumnTotals(sc, colKey, { hardcore = false } = {}){
  let sumTop = 0;
  for (let ri=0; ri<=5; ri++){
    const v = num(getCell(sc, ri, colKey));
    if (v !== null) sumTop += v;
  }
  const threshold = hardcore ? 40 : 60;
  const bonusVal = (sumTop >= threshold) ? 30 : 0;
  const totalTop = sumTop + bonusVal;

  const one  = num(getCell(sc, 0,  colKey));
  const vmax = num(getCell(sc, 9,  colKey));
  const vmin = num(getCell(sc, 10, colKey));
  let diff = (one !== null && vmax !== null && vmin !== null) ? (one * (vmax - vmin)) : null;
  if (diff !== null && diff < 0) diff = 0;

  const kenter = num(getCell(sc,12, colKey)) || 0;
  const full   = num(getCell(sc,13, colKey)) || 0;
  const poker  = num(getCell(sc,14, colKey)) || 0;
  const sixty  = num(getCell(sc,15, colKey)) || 0;
  const sumBottom = kenter + full + poker + sixty;

  const totalColumn = totalTop + (diff ?? 0) + sumBottom;
  return { sumTop, bonusVal, totalTop, diff, sumBottom, totalColumn };
}

function computeOverall(sc, { hardcore = false } = {}){
  const cols = ["down","free","up","ang"];
  return cols.reduce((acc, c) => acc + computeColumnTotals(sc, c, { hardcore }).totalColumn, 0);
}

// -------- Team-Helpers --------
function isTeamModeSnapshot(sb){
  // ausschließlich per _mode, um Fehl-Erkennungen zu vermeiden
  const m = sb && sb._mode != null ? String(sb._mode).toLowerCase() : "";
  return m === "2v2";
}

function normalizeTeams(sb){
  // Liefert [{id:"A",name:"Team A",members:[pid,...]}, {id:"B",...}]
  if (!sb) return [];
  if (Array.isArray(sb._teams)) return sb._teams.map(t => ({
    id: t.id, name: t.name || `Team ${t.id}`, members: t.members || []
  }));
  if (sb._teams && typeof sb._teams === "object"){
    return Object.keys(sb._teams).map(k => {
      const t = sb._teams[k] || {};
      return { id: t.id || k, name: t.name || `Team ${k}`, members: t.members || [] };
    });
  }
  // Fallback: nur anhand _scoreboards_by_team
  const keys = Object.keys(sb._scoreboards_by_team || {});
  return keys.map(k => ({ id: k, name: `Team ${k}`, members: [] }));
}

/**
 * Liefert die Team-ID für einen Spieler basierend auf dem Snapshot.
 * @param {Object} sb
 * @param {string} pid
 * @returns {string|null}
 */
function teamIdForPlayer(sb, pid){
  const teams = normalizeTeams(sb);
  for (const t of teams){
    if ((t.members||[]).some(m => String(m) === String(pid))) return t.id;
  }
  return null;
}

// -------- Misc Utils --------
/**
 * Konvertiert einen numerischen Wert in Text, leer bei null.
 * @param {number|null} v
 * @returns {string}
 */
function numOrEmpty(v){ const n = num(v); return (n === null) ? "" : String(n); }

// SVG-Würfel
/**
 * Erzeugt SVG-Markup für eine Würfelanzeige (1..6).
 * @param {number} v - Augenzahl (1..6)
 * @returns {string} SVG-String
 */
function dieSVG(v){
  // Koordinaten im 100x100 ViewBox-Raster
  const L=30, C=50, R=70, T=30, M=50, B=70;
  const pips = {
    1: [[C,M]],
    2: [[L,T],[R,B]],
    3: [[L,T],[C,M],[R,B]],
    4: [[L,T],[R,T],[L,B],[R,B]],
    5: [[L,T],[R,T],[C,M],[L,B],[R,B]],
    6: [[L,T],[L,M],[L,B],[R,T],[R,M],[R,B]]
  }[v] || [];

  const dots = pips.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="8"></circle>`).join("");
  return `
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="Würfel ${v}">
      <rect x="5" y="5" width="90" height="90" rx="12" ry="12" fill="white" stroke="black" stroke-width="6"></rect>
      <g fill="black">${dots}</g>
    </svg>
  `;
}

function esc(s){
  return String(s).replace(/[&<>"]/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"
  }[c]));
}
// function colIndexFromKey(k){ return k === "down" ? 1 : k === "free" ? 2 : k === "up" ? 3 : k === "ang" ? 4 : null; }

// -------- Inline CSS (injected once) --------
function ensureInlineScoreboardCSS(){
  if (document.getElementById('scoreboard-inline-css')) return;

  const css = `
    /* keep your base flex layout from style.css */
    .player-card .table-wrap { overflow: auto; max-width: 100%; }
    table.grid.compact { width: 100%; table-layout: fixed; border-collapse: collapse; }
    table.grid.compact th, table.grid.compact td { padding: 4px 6px; }
  
    /* highlight marks */
    td.cell.last-write { box-shadow: inset 0 0 0 2px rgba(255,165,0,.95); }
    td.cell.announced   { outline: 2px solid rgba(0,120,255,.8); }
  
    /* announce pick highlight (used by room.js) */
    td.announce-pickable{ outline: 2px dashed var(--accent); outline-offset: -2px; background: #eef7ff; }
    /* announce button sizing next to roll button */
    #diceBar #announceBtnInline{ flex: 0 0 25%; min-width: 96px; }
    #diceBar #rollBtnInline{ flex: 1 1 auto; }
    .hc-badge { color:#b71c1c; font-weight:700; }
  `;

  const style = document.createElement('style');
  style.id = 'scoreboard-inline-css';
  style.textContent = css;
  document.head.appendChild(style);
}

// -------- Haupt-Renderer --------
/**
 * Rendert das Scoreboard (Einzel oder Team) inklusive Dicebar, Suggestions
 * und Grid pro Entity.
 * @param {HTMLElement} mount
 * @param {Object} sb - Server-Snapshot
 * @param {Object} opts - Anzeigeoptionen
 */
function renderScoreboard(mount, sb, {
  myPlayerId, iAmTurn, rollsUsed, rollsMax, announcedRow4, canRequestCorrection = false, readOnly = false
} = {}) {
  ensureInlineScoreboardCSS();
  if (!sb) { if (mount) mount.innerHTML = ""; return; }

  const isTeamMode = isTeamModeSnapshot(sb);

  const nameEl   = document.getElementById("roomGameName");
  const contentEl= mount || document.getElementById("scoreOut");

  const dice  = sb._dice  || [];
  const holds = sb._holds || [false,false,false,false,false];
  const turnPid  = sb?._turn?.player_id || null;
  const turnName = (sb?._players || []).find(p => String(p.id) === String(turnPid))?.name || "—";

  const corr = sb?._correction || { active:false };
  const correctionActive = !!corr.active;
  const correctionForMe  = correctionActive && String(corr.player_id) === String(myPlayerId);

  if (nameEl) nameEl.textContent = sb?._name || "";

  // Entities = Teams oder Spieler
  const teams = isTeamMode ? normalizeTeams(sb) : [];
  let entities = isTeamMode ? teams : (sb._players || []);

  // Eigene Einheit (Team oder Spieler) links
  if (isTeamMode) {
    const myTeam = teamIdForPlayer(sb, myPlayerId);
    entities = entities.slice().sort((a,b) =>
      (a.id === myTeam ? -1 : (b.id === myTeam ? 1 : 0))
    );
  } else {
    entities = entities.slice().sort((a,b) =>
      (String(a.id) === String(myPlayerId) ? -1 :
       (String(b.id) === String(myPlayerId) ? 1 : 0))
    );
  }

  const isHC = !!(sb && sb._hardcore);
  const rollsNum = Number(rollsUsed ?? sb?._rolls_used ?? 0);
  const rollsCap = Number(rollsMax ?? sb?._rolls_max ?? 3);
  const announceDisabledAttr = (!iAmTurn || correctionActive || rollsNum !== 1) ? "disabled" : "";
  const rollDisabledAttr = (!iAmTurn || correctionActive || rollsNum >= rollsCap) ? "disabled" : "";

  const requestBtnHTML = (canRequestCorrection && !isHC)
    ? `<button id="requestCorrectionBtn" class="small">Letzten Eintrag ändern</button>`
    : ``;

  const dicebar = readOnly ? "" : `
    <div class="topbar">
      <div id="diceBar">
        ${dice.map((d,i)=>
          `<button type="button" class="die ${holds[i] ? "held" : ""}" data-i="${i}" aria-label="Würfel ${i + 1} halten oder lösen" aria-pressed="${holds[i] ? "true" : "false"}" title="halten/lösen">${dieSVG(d || 0)}</button>`
        ).join("")}
        ${isHC ? '' : `<button id="announceBtnInline" class="small" ${announceDisabledAttr}>Ansagen</button>`}
        ${isHC ? '' : `<button id="rollBtnInline" data-action="roll" ${rollDisabledAttr}>🎲 Würfeln</button>`}
        ${requestBtnHTML}
      </div>
    </div>
    <div class="muted turn-status">
      <span id="mobileReactionsBar" class="mobile-reactions-host" aria-label="Reaktionen"></span>
      <span class="turn-status-text">Am Zug: ${esc(turnName)} • ${isHC ? '<span class="hc-badge">Hardcore</span>' : `Würfe: ${rollsUsed ?? 0}/${rollsMax ?? 3} <span id="announceHint"></span>`}</span>
    </div>
  `;

  let grid = `<div class="players-grid">`;
  for (const ent of entities) {
    const id = ent.id;
    const sc = isTeamMode
      ? (sb._scoreboards_by_team?.[id] || {})
      : (sb._scoreboards?.[id] || {});
    const isTurn = isTeamMode
      ? (teamIdForPlayer(sb, turnPid) === id)
      : (String(turnPid) === String(id));
    const overall = computeOverall(sc, { hardcore: isHC });

    const isMyBoard = isTeamMode
      ? (teamIdForPlayer(sb, myPlayerId) === id)
      : (String(id) === String(myPlayerId));

    // Team-Mitglieder-Namen für Chips zusammensetzen (nur 2v2)
    let membersHTML = "";
    if (isTeamMode) {
      const memberNames = (ent.members || [])
        .map(pid => sb._players.find(p => String(p.id) === String(pid))?.name || pid)
        .filter(Boolean);
      membersHTML = memberNames.map(n => `<span class="badge">${esc(n)}</span>`).join(" ");
    }

    grid += `
      <div class="player-card${isTurn ? " turn": ""}${isMyBoard ? " me": ""}" data-board-id="${esc(id)}">
        <div class="pc-head">
          <div class="pc-name">${esc(ent.name || "—")}</div>
          <div class="pc-total">Total: ${overall}</div>
        </div>
        ${isTeamMode ? `<div class="pc-members">${membersHTML}</div>` : ``}
        <div class="table-wrap">
          <table class="grid compact">
            <thead>
              <tr>
                <th class="sticky" title="Feld"></th>
                <th title="Abwärts">⬇︎</th>
                <th title="Freireihe">／</th>
                <th title="Aufwärts">⬆︎</th>
                <th title="Angesagt">❗</th>
              </tr>
            </thead>
            <tbody>
              ${renderRows(sc, sb, {
                myPlayerId,
                pid: id,
                isMyBoard,
                iAmTurn,
                rollsUsed,
                correctionActive,
                highlightAnnounce: (
                  isTeamMode
                    ? (id === (sb._announced_board || null))
                    : (String(id) === String(sb._announced_by || ""))
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  grid += `</div>`;

  (contentEl || mount).innerHTML =
    dicebar +
    (readOnly ? "" : `<div class="suggestions-area"><div id="suggestions" class="suggestions"></div></div>`) +
    `<div id="overlayMount"></div>` +
    grid;
}

/**
 * Rendert die Tabellenzeilen inklusive Clickability/Tooltips pro Zelle.
 * @param {Object} sc - Scoreboard-Daten für eine Entity
 * @param {Object} sb - Gesamtsnapshot
 * @param {Object} ctx - Kontext (mein Spieler, Zuginhaber, Korrekturstatus, etc.)
 * @returns {string}
 */
function renderRows(sc, sb, ctx){
  const announced = sb._announced_row4 || null;
  const rolledYet = (ctx.rollsUsed ?? 0) > 0;
  // Ausnahme "letztes Feld": offene, noch leere, beschreibbare Zellen zaehlen
  const remainingOpen = (() => {
    let cnt = 0;
    const cols = ["down","free","up","ang"];
    for (let ri = 0; ri < ROW_LABELS.length; ri++) {
      if (!ROW_FIELD_KEYS[ri]) continue;        // nur echte Wertungszeilen
      for (const col of cols) {
        const key = `${ri},${col}`;
        const v = sc[key];
        if (v === undefined || v === null || v === "") cnt++;
      }
    }
    return cnt;
  })();
  const lastCellMode = (remainingOpen === 1);

  const correctionForMe = !!(ctx.correctionActive && sb?._correction?.player_id && String(sb._correction.player_id) === String(ctx.myPlayerId));
  // Normalize and guard last-write logic
  const lastWrites = (!isTeamModeSnapshot(sb) && sb._last_write_public) ? sb._last_write_public : null;
  const lastForThisBoard = (lastWrites && lastWrites[ctx.pid]) ? lastWrites[ctx.pid] : null; // [row, colKey]

  const cols = ["down","free","up","ang"];
  const live = {};
  const isHC = !!(sb && sb._hardcore);
  for (const c of cols) live[c] = computeColumnTotals(sc, c, { hardcore: isHC });

  const lastWriteMap = Array.isArray(sb?._last_write) || typeof sb?._last_write === 'object' ? sb._last_write : null;
  let oppLast = null; // [row, colKey]
  if (!isTeamModeSnapshot(sb) && lastWriteMap) {
    for (const [pid, rc] of Object.entries(lastWriteMap)) {
      if (String(pid) !== String(ctx.myPlayerId)) { oppLast = rc; break; }
    }
  }

  return ROW_LABELS.map((label, ri) => {
    const meta = rowGroupMeta(ri);
    const isCompute = COMPUTE_ROWS.has(ri);
    const tip = ROW_TOOLTIPS[ri] || "";

    function displayFor(colKey){
      if (ri === 6)   return numOrEmpty(live[colKey].sumTop);
      if (ri === 7)   return numOrEmpty(live[colKey].bonusVal);
      if (ri === 8)   return numOrEmpty(live[colKey].totalTop);
      if (ri === 11)  return (live[colKey].diff === null ? "" : String(live[colKey].diff));
      if (ri === 16)  return numOrEmpty(live[colKey].sumBottom);
      if (ri === 17)  return numOrEmpty(live[colKey].totalColumn);
      const v = getCell(sc, ri, colKey);
      return (v === undefined || v === null || v === "") ? "" : String(v);
    }

    function cell(colKey, colIdx){
      const rawVal = getCell(sc, ri, colKey);
      const hasRaw = !(rawVal === undefined || rawVal === null || rawVal === "");
      const val = displayFor(colKey);
      const has = val !== "" && val !== undefined && val !== null;

      const rowFieldKey = ROW_FIELD_KEYS[ri];
      const adminEdit = rowFieldKey
        ? (sb?._admin_edits?.[ctx.pid]?.[`${ri},${colKey}`] || null)
        : null;

      // announced-Markierung nur auf dem eigenen Board
      const isAnnouncedCell = Boolean(
        announced && colIdx === 4 && rowFieldKey === announced && ctx.highlightAnnounce
      );

      // Last-write highlight
      const isLastWrittenCell = (!ctx.highlightAnnounce
        && Array.isArray(lastForThisBoard)
        && ri === Number(lastForThisBoard[0])
        && String(colKey) === String(lastForThisBoard[1]));
      const isOpponentBoard = !isTeamModeSnapshot(sb) && String(ctx.pid) !== String(ctx.myPlayerId);
      const isOppLastCell = Boolean(
        isOpponentBoard && Array.isArray(oppLast)
        && ri === Number(oppLast[0])
        && String(colKey) === String(oppLast[1])
      );

      const isCompute = COMPUTE_ROWS.has(ri);
      const rolledYet = (ctx.rollsUsed ?? 0) > 0;
      const correctionForMe = !!(ctx.correctionActive && sb?._correction?.player_id && String(sb._correction.player_id) === String(ctx.myPlayerId));
      const corrRollIdx = Number(sb?._correction?.roll_index || 0);

      // Klicklogik
      const announceOk = (!announced || isAnnouncedCell || rowFieldKey === "poker");
      const mayClickNormal =
        ctx.isMyBoard &&
        !ctx.correctionActive &&
        !isCompute &&
        !hasRaw &&
        ctx.iAmTurn &&
        rolledYet &&
        (announceOk || lastCellMode);

      // In Korrektur: ❗ (ang) nur, wenn roll_index == 1 (Ansagefenster). Sonst gesperrt.
      const mayClickCorrection = ctx.isMyBoard && correctionForMe && !isCompute && !hasRaw && (colKey !== "ang" || corrRollIdx <= 1);

      const clickable = (mayClickNormal || mayClickCorrection);

      // Tooltip-Text bestimmen
      let titleText = ROW_TOOLTIPS[ri] || ""; // Basis: Feld-Erklärung
      if (!isCompute) {
        if (hasRaw) {
          titleText = "Bereits befüllt";
        } else if (!ctx.isMyBoard) {
          titleText = "Nur dein eigenes Board ist beschreibbar";
        } else if (ctx.correctionActive && !correctionForMe) {
          titleText = "Gegner korrigiert – bitte warten";
        } else if (ctx.correctionActive && correctionForMe && colKey === "ang" && corrRollIdx > 1) {
          titleText = "❗ im Korrekturmodus nur im 1. Wurf erlaubt";
        } else if (mayClickCorrection) {
          titleText = "Klicke, um deinen letzten Eintrag hierher zu verschieben";
        } else if (!ctx.iAmTurn) {
          titleText = (titleText ? titleText + " • " : "") + "Nicht an der Reihe";
        } else if (!rolledYet) {
          titleText = (titleText ? titleText + " • " : "") + "Erst würfeln";
        } else if (announced && !isAnnouncedCell && !lastCellMode) {
          titleText = "Ansage aktiv: Nur ❗ (angekündigtes Feld) ist erlaubt";
        } else if (clickable) {
          titleText = (titleText ? titleText + " • " : "") + "Klicke, um zu schreiben";
        }
      }

      const classes = ["cell"];
      if (isCompute) classes.push("compute");
      if (adminEdit) classes.push("admin-edited");
      if (isAnnouncedCell) classes.push("announced");
      if (isLastWrittenCell) classes.push("last-write");
      if (isOppLastCell) classes.push("last-write");
      if (clickable) classes.push("clickable");

      if (adminEdit) {
        const oldVal = adminEdit.old ?? "";
        const newVal = adminEdit.new ?? "";
        const byName = adminEdit.by_name ? ` durch ${adminEdit.by_name}` : "";
        titleText = `${titleText ? titleText + " • " : ""}Superadmin-Änderung${byName}: ${oldVal} → ${newVal}`;
      }

      const dataAttr  = rowFieldKey ? ` data-row="${ri}" data-field="${colKey}"` : "";
      const titleAttr = titleText ? ` title="${esc(titleText)}"` : "";
      return `<td class="${classes.join(" ")}"${dataAttr}${titleAttr}>${has ? esc(String(val)) : ""}</td>`;
    }

    const rowClasses = [];
    if (meta.group) rowClasses.push(`grp-${meta.group}`);
    if (meta.start) rowClasses.push("grp-start");
    if (meta.end)   rowClasses.push("grp-end");
    if (isCompute)  rowClasses.push("is-compute");

    return `
      <tr class="${rowClasses.join(" ")}">
        <td class="desc sticky${isCompute ? " compute" : ""}" title="${esc(tip)}">${esc(label)}</td>        ${cell("down", 1)}
        ${cell("free", 2)}
        ${cell("up",   3)}
        ${cell("ang",  4)}
      </tr>
    `;
  }).join("");
}

window.renderScoreboard = renderScoreboard;

/**
 * Baut aus einem Leaderboard-Eintrag einen Client-Snapshot zur Anzeige.
 * @param {Object} lv
 * @returns {Object|null}
 */
function buildClientSnapshotFromLeaderboard(lv){
  if (!lv || typeof lv !== "object") return null;

  const mode = (lv.mode || "").toString().toLowerCase();
  const isTeam = mode === "2v2";

  const rowIndexForKey = (key) => {
    for (let i = 0; i < ROW_FIELD_KEYS.length; i++){
      if (ROW_FIELD_KEYS[i] === key) return i;
    }
    return null;
  };

  const fromReihen = (reihenArr) => {
    const sc = {};
    const idxToCol = {1:"down", 2:"free", 3:"up", 4:"ang"};
    (reihenArr || []).forEach(r => {
      const col = idxToCol[r.index] || null;
      if (!col) return;
      const rows = r.rows || {};
      Object.keys(rows).forEach(fk => {
        const ri = rowIndexForKey(fk);
        if (ri === null || ri === undefined) return;
        const v = rows[fk];
        if (typeof v === "number" && Number.isFinite(v)){
          sc[`${ri},${col}`] = v;
        }
      });
    });
    return sc;
  };

  if (isTeam){
    const teams = [{"id":"A","name":"Team A","members":[]},{"id":"B","name":"Team B","members":[]}];
    (lv.players || []).forEach(p => {
      const t = (p && p.team) ? String(p.team) : null;
      if (t === "A" || t === "B"){
        const tgt = teams.find(tt => tt.id === t);
        if (tgt && p.id) tgt.members.push(String(p.id));
      }
    });

    const sbByTeam = {};
    Object.keys(lv.scoreboards || {}).forEach(entId => {
      const entry = lv.scoreboards[entId] || {};
      sbByTeam[String(entId)] = fromReihen(entry.reihen || []);
    });

    return {
      _name: lv.gamename || "",
      _mode: "2v2",
      _hardcore: !!lv.hardcore,
      _players: (lv.players || []).map(p => ({id:String(p.id), name:String(p.name||"Player")})),
      _teams: teams,
      _scoreboards_by_team: sbByTeam,
      _scoreboards: {},
      _admin_edits: lv.admin_edits || {},
      _turn: null,
      _dice: [0,0,0,0,0],
      _holds: [false,false,false,false,false],
      _rolls_used: 0,
      _rolls_max: 0,
      _announced_row4: null,
      _correction: {active:false},
      suggestions: []
    };
  } else {
    const sb = {};
    Object.keys(lv.scoreboards || {}).forEach(pid => {
      const entry = lv.scoreboards[pid] || {};
      sb[String(pid)] = fromReihen(entry.reihen || []);
    });
    return {
      _name: lv.gamename || "",
      _mode: lv.mode,
      _hardcore: !!lv.hardcore,
      _players: (lv.players || []).map(p => ({id:String(p.id), name:String(p.name||"Player")})),
      _teams: [],
      _scoreboards_by_team: {},
      _scoreboards: sb,
      _admin_edits: lv.admin_edits || {},
      _turn: null,
      _dice: [0,0,0,0,0],
      _holds: [false,false,false,false,false],
      _rolls_used: 0,
      _rolls_max: 0,
      _announced_row4: null,
      _correction: {active:false},
      suggestions: []
    };
  }
}

window.renderReadOnlyFromLeaderboard = function(mount, leaderboardView){
  const sb = buildClientSnapshotFromLeaderboard(leaderboardView);
  if (!sb){
    if (mount) mount.innerHTML = "<div class='muted'>Kein Inhalt</div>";
    return;
  }
  window.renderScoreboard(mount, sb, {
    myPlayerId: null,
    iAmTurn: false,
    rollsUsed: 0,
    rollsMax: 0,
    announcedRow4: null,
    canRequestCorrection: false,
    readOnly: true
  });
  renderReadOnlyChatHistory(mount, leaderboardView.chat_history || []);
};

function renderReadOnlyChatHistory(mount, history){
  if (!mount || !Array.isArray(history) || history.length === 0) return;
  const rows = history.slice().reverse().map(m => {
    const ts = m && m.ts ? new Date(m.ts) : null;
    const stamp = ts && !Number.isNaN(ts.getTime())
      ? ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";
    const sender = (m && m.sender) ? m.sender : "System";
    const text = (m && m.text) ? m.text : "";
    const kind = (m && m.kind) ? String(m.kind) : "chat";
    return `<div class="readonly-chat-line ${esc(kind)}">
      <span class="ts">${esc(stamp)}</span><b>${esc(sender)}:</b> ${esc(text)}
    </div>`;
  }).join("");
  mount.insertAdjacentHTML("beforeend", `
    <section class="readonly-chat">
      <h2>Chatverlauf</h2>
      <div class="readonly-chat-box">${rows}</div>
    </section>
  `);
}
