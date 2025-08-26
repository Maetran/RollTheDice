// static/scoreboard.js
// Einzel- & Team-Mode (2v2) – robust gegen verschiedene Snapshot-Formate

const ROW_LABELS = [
  "1","2","3","4","5","6",
  "ZwSumme","Bonus","ZwTotalOben",
  "Max","Min","Diff",
  "Kenter","Full","Poker","60",
  "ZwTotalUnten","Reihentotal"
];

const ROW_FIELD_KEYS = [
  "1","2","3","4","5","6",
  null, null, null,
  "max","min",
  null,
  "kenter","full","poker","60",
  null, null, null
];

const ROW_TOOLTIPS = [
  "Summe der ⚀ (nur Einsen)",
  "Summe der ⚁ (nur Zweien)",
  "Summe der ⚂ (nur Dreien)",
  "Summe der ⚃ (nur Vieren)",
  "Summe der ⚄ (nur Fünfen)",
  "Summe der ⚅ (nur Sechsen)",
  "Zwischensumme oben (1–6)",
  "Bonus +30, wenn ZwSumme ≥ 60",
  "ZwTotalOben = ZwSumme + Bonus",
  "Max: Summe aller 5 Würfel (höchster Wurf)",
  "Min: Summe aller 5 Würfel (niedrigster Wurf)",
  "Diff = Einsen × (Max − Min), niemals negativ",
  "Kenter: immer 35 Punkte, wenn alle 5 Augen verschieden",
  "Full House: 3 gleiche + 2 gleiche → 40 + 3×Augenzahl der Drilling-Augen",
  "Poker (Vierling): genau 4 gleiche im Wurf → 50 + 4×Augenzahl; 5 gleiche zählt separat",
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
  "ZwSumme": "Summe der Felder 1–6",
  "Bonus": "+30 bei ZwSumme ≥ 60",
  "ZwTotalOben": "ZwSumme + Bonus",
  "Max": "Summe aller fünf Würfel",
  "Min": "Summe aller fünf Würfel",
  "Diff": "1 × (Max − Min), nie negativ",
  "Kenter": "Fünf unterschiedliche (35 Punkte)",
  "Full": "40 + 3×Wert der Drilling-Augen",
  "Poker": "50 + 4×Wert der Vierling-Augen (nur im Wurf erreicht; bei 5 gleichen jederzeit)",
  "60": "60 + 5×Wert der Fünfling-Augen",
  "ZwTotalUnten": "Kenter + Full + Poker + 60",
  "Reihentotal": "ZwTotalOben + Diff + ZwTotalUnten"
};

function hintForLabel(lbl){
  return FIELD_HINTS[lbl] || "";
}

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

function getCell(sc, ri, colKey){ return sc[`${ri},${colKey}`]; }

function computeColumnTotals(sc, colKey){
  let sumTop = 0;
  for (let ri=0; ri<=5; ri++){
    const v = num(getCell(sc, ri, colKey));
    if (v !== null) sumTop += v;
  }
  const bonusVal = (sumTop >= 60) ? 30 : 0;
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

function computeOverall(sc){
  const cols = ["down","free","up","ang"];
  return cols.reduce((acc, c) => acc + computeColumnTotals(sc, c).totalColumn, 0);
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

function teamIdForPlayer(sb, pid){
  const teams = normalizeTeams(sb);
  for (const t of teams){
    if ((t.members||[]).some(m => String(m) === String(pid))) return t.id;
  }
  return null;
}

// -------- Announce-UI --------
function renderAnnounceSlot(sb, myId, iAmTurn, rollsUsed){
  const ann = sb._announced_row4 || null;
  const correctionActive = !!(sb?._correction?.active);
  const showSelector = iAmTurn && rollsUsed === 1 && !correctionActive;

  const isTeamMode = isTeamModeSnapshot(sb);
  const boardKey = isTeamMode ? (teamIdForPlayer(sb, myId) || "A") : myId;

  const myBoard = isTeamMode
    ? (sb._scoreboards_by_team?.[boardKey] || {})
    : (sb._scoreboards?.[boardKey] || {});

  const taken = new Set();
  for (const k of Object.keys(myBoard)) {
    const [rStr, col] = k.split(",", 2);
    if (col === "ang") {
      const r = parseInt(rStr, 10);
      const fkey = ROW_FIELD_KEYS[r];
      if (fkey) taken.add(fkey);
    }
  }

  const options = ANNOUNCE_FIELDS.filter(f => !taken.has(f) || f === ann);
  const selectorHTML = options.length
    ? `<select id="announceSelect">
         <option value="">— wählen —</option>
         ${options.map(v => `<option value="${v}" ${ann===v ? "selected":""}>${v}</option>`).join("")}
       </select>`
    : `<span class="muted">Alle ❗-Felder bereits befüllt</span>`;

  const btnLabel = ann ? "Ändern" : "OK";
  const inner = showSelector
    ? `<div class="announce-box">
         <label for="announceSelect">❗ Ansage:</label>
         ${selectorHTML}
         ${options.length ? `<button id="announceBtn" class="small">${btnLabel}</button>` : ``}
         ${ann ? `<button id="unannounceBtn" class="small danger" style="margin-left:.4rem;">Aufheben</button>` : ``}
         <span class="muted">nur direkt nach dem 1. Wurf</span>
       </div>`
    : `<div class="announce-status"><span class="label">Angesagt:</span> <span class="value">${ann ? esc(ann) : "—"}</span></div>`;

  return `<div id="announceSlot" class="announce-slot">${inner}</div>`;
}

// -------- Misc Utils --------
function numOrEmpty(v){ const n = num(v); return (n === null) ? "" : String(n); }
function dieFace(v){ const f=["","⚀","⚁","⚂","⚃","⚄","⚅"]; return f[v]||"·"; }
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
  
    /* responsive select */
    #announceSlot select { max-width: 100%; }
  `;

  const style = document.createElement('style');
  style.id = 'scoreboard-inline-css';
  style.textContent = css;
  document.head.appendChild(style);
}

// -------- Haupt-Renderer --------
function renderScoreboard(mount, sb, {
  myPlayerId, iAmTurn, rollsUsed, rollsMax, announcedRow4, canRequestCorrection = false
} = {}) {
  ensureInlineScoreboardCSS();
  if (!sb) { if (mount) mount.innerHTML = ""; return; }

  const isTeamMode = isTeamModeSnapshot(sb);

  const nameEl   = document.getElementById("roomGameName");
  const bubblesEl= document.getElementById("roomPlayerBubbles");
  const statusEl = document.getElementById("roomStatusLine");
  const contentEl= mount || document.getElementById("scoreOut");

  const dice  = sb._dice  || [];
  const holds = sb._holds || [false,false,false,false,false];
  const turnPid  = sb?._turn?.player_id || null;
  const turnName = (sb?._players || []).find(p => String(p.id) === String(turnPid))?.name || "—";

  const corr = sb?._correction || { active:false };
  const correctionActive = !!corr.active;
  const correctionForMe  = correctionActive && String(corr.player_id) === String(myPlayerId);

  const ann = announcedRow4 || sb._announced_row4 || null;

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

  if (bubblesEl) {
    // Obere Bubbles werden nicht mehr angezeigt – Team/Spieler-Chips wandern in die Cards
    bubblesEl.innerHTML = "";
  }

  if (statusEl) {
    const turnChip = iAmTurn
      ? `<span class="chip ok">Du bist dran</span>`
      : `<span class="chip wait">Warte auf Gegner</span>`;
    const annChip = ann
      ? `<span class="chip warn">❗ nur Feld ${esc(ann)} erlaubt</span>`
      : `<span class="chip info">❗ Nichts wurde angesagt</span>`;
    const corrChip = correctionActive
      ? (correctionForMe
          ? `<span class="chip warn">Korrekturmodus aktiv (du)</span>`
          : `<span class="chip warn">Gegner korrigiert – bitte warten</span>`)
      : ``;
    statusEl.innerHTML = `${turnChip} ${annChip} ${corrChip}`;
  }

  const requestBtnHTML = canRequestCorrection
    ? `<button id="requestCorrectionBtn" class="small" style="margin-left:.5rem;">Letzten Eintrag ändern</button>`
    : ``;

  const dicebar = `
    <div class="topbar">
      <div id="diceBar">
        ${dice.map((d,i)=>
          `<button class="die ${holds[i] ? "held" : ""}" data-i="${i}" title="halten/lösen">${dieFace(d)}</button>`
        ).join("")}
        <button id="rollBtnInline" ${correctionActive ? "disabled":""}>🎲 Würfeln</button>
        ${requestBtnHTML}
      </div>
    </div>
    <div class="muted">
      Am Zug: ${esc(turnName)} • Würfe: ${rollsUsed ?? 0}/${rollsMax ?? 3}
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
    const overall = computeOverall(sc);

    // NEU: Bestimmen, ob dieses Board "meins" ist (Player vs Team)
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
      <div class="player-card ${isTurn ? "turn": ""}">
        <div class="pc-head">
          <div class="pc-name">${esc(ent.name || "—")}</div>
          <div class="pc-total">Total: ${overall}</div>
        </div>
        ${isTeamMode ? `<div class="pc-members" style="margin: .25rem 0 .5rem 0;">${membersHTML}</div>` : ``}
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
                iAmTurn,
                rollsUsed,
                correctionActive,
                highlightAnnounce: isMyBoard   // << nur eigenes Board hervorgehoben + klickbar
              })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  grid += `</div>`;

  const announceSlot = renderAnnounceSlot(sb, myPlayerId, iAmTurn, rollsUsed);
  // NEU: Suggestions-Container zwischen Dicebar und Ansage
  (contentEl || mount).innerHTML =
    dicebar +
    `<div class="suggestions-area">
       <div id="suggestions" class="suggestions"></div>
     </div>` +
    announceSlot +
    `<div id="overlayMount"></div>` +
    grid;
}

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
  for (const c of cols) live[c] = computeColumnTotals(sc, c);

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

      // Klicklogik
      const announceOk = (!announced || isAnnouncedCell || rowFieldKey === "poker");
      const mayClickNormal =
        !ctx.correctionActive &&
        !isCompute &&
        !hasRaw &&
        ctx.iAmTurn &&
        rolledYet;

      const mayClickCorrection = correctionForMe && !isCompute && !hasRaw;

      let clickable = (mayClickNormal || mayClickCorrection);

      // Robustheit: Nach "Zocken" (Wurf >=2) darf Poker in der Freireihe immer gestrichen werden (0).
      // Server erzwingt die Regeln; hier nur sicherstellen, dass der Klick durchgeht.
      if (!clickable && rowFieldKey === "poker" && colKey === "free" && ctx.iAmTurn && (ctx.rollsUsed ?? 0) > 0 && !ctx.correctionActive) {
        clickable = true;
      }


      // Tooltip-Text bestimmen
      let titleText = ROW_TOOLTIPS[ri] || ""; // Basis: Feld-Erklärung
      if (!isCompute) {
        if (hasRaw) {
          titleText = "Bereits befüllt";
        } else if (ctx.correctionActive && !correctionForMe) {
          titleText = "Gegner korrigiert – bitte warten";
        } else if (mayClickCorrection) {
          titleText = "Klicke, um deinen letzten Eintrag hierher zu verschieben";
        } else if (!ctx.iAmTurn) {
          titleText = (titleText ? titleText + " • " : "") + "Nicht an der Reihe";
        } else if (!rolledYet) {
          titleText = (titleText ? titleText + " • " : "") + "Erst würfeln";
        } else if (announced && !isAnnouncedCell && !lastCellMode) {
          titleText = "Ansage aktiv: Nur ❗ (angekündigtes Feld) ist erlaubt";
        } else if (clickable) {
          if (rowFieldKey === "poker" && colKey === "free" && (ctx.rollsUsed ?? 0) > 1) {
            titleText = (titleText ? titleText + " • " : "") + "Klicke, um Poker mit 0 zu streichen";
          } else {
            titleText = (titleText ? titleText + " • " : "") + "Klicke, um zu schreiben";
          }
        }
      }

      const classes = ["cell"];
      if (isCompute) classes.push("compute");
      if (isAnnouncedCell) classes.push("announced");
      if (isLastWrittenCell) classes.push("last-write");
      if (isOppLastCell) classes.push("last-write");
      if (clickable) classes.push("clickable");

      const dataAttr  = clickable ? ` data-row="${ri}" data-field="${colKey}"` : "";
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