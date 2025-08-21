// static/scoreboard.js
// Rendert direkt in room.html-Container + Live-Subtotals:
// - #roomGameName (nur Name)
// - #roomPlayerBubbles (Spieler-Badges)
// - #roomStatusLine (Status-Chips)
// - #scoreOut (Dicebar, Ansage-Slot, Tabellen)
// Live-Berechnungen: ZwSumme, ZwTotalOben, Diff, ZwTotalUnten, Reihentotal, Overall (im Header)

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

const ANNOUNCE_FIELDS = ["1","2","3","4","5","6","max","min","kenter","full","poker","60"];
const COMPUTE_ROWS = new Set([6,7,8,11,16,17]); // 7=Bonus wird live gerechnet

function rowGroupMeta(ri){
  if (ri >= 6 && ri <= 8)  return { group: "top",    start: ri === 6,  end: ri === 8  };
  if (ri === 11)           return { group: "diff",   start: true,      end: true      };
  if (ri >= 16 && ri <= 18) return { group: "bottom", start: ri === 16, end: ri === 18 };
  return { group: null, start: false, end: false };
}

// ---------- Utils ----------
const num = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Werte aus sc lesen
function getCell(sc, ri, colKey){
  return sc[`${ri},${colKey}`];
}

// Live-Berechnung pro Spalte (down/free/up/ang)
function computeColumnTotals(sc, colKey){
  // Top (1..6)
  let sumTop = 0;
  for (let ri=0; ri<=5; ri++){
    const v = num(getCell(sc, ri, colKey));
    if (v !== null) sumTop += v;
  }

  // BONUS: live rechnen (>=60 => 30), NICHT mehr aus Zelle lesen
  const bonusVal = (sumTop >= 60) ? 30 : 0;
  const totalTop = sumTop + bonusVal;

  // Diff: nur wenn 1, Max, Min vorhanden
  const one  = num(getCell(sc, 0,  colKey));
  const vmax = num(getCell(sc, 9,  colKey));
  const vmin = num(getCell(sc, 10, colKey));
  const diff = (one !== null && vmax !== null && vmin !== null) ? (one * (vmax - vmin)) : null;

  // Bottom (Kenter, Full, Poker, 60)
  const kenter = num(getCell(sc,12, colKey)) || 0;
  const full   = num(getCell(sc,13, colKey)) || 0;
  const poker  = num(getCell(sc,14, colKey)) || 0;
  const sixty  = num(getCell(sc,15, colKey)) || 0;
  const sumBottom = kenter + full + poker + sixty;

  const totalColumn = totalTop + (diff ?? 0) + sumBottom;

  return { sumTop, bonusVal, totalTop, diff, sumBottom, totalColumn };
}

// Gesamttotal (Summe aller 4 Spalten-Reihentotale)
function computeOverall(sc){
  const cols = ["down","free","up","ang"];
  return cols.reduce((acc, c) => acc + computeColumnTotals(sc, c).totalColumn, 0);
}

function renderAnnounceSlot(sb, myId, iAmTurn, rollsUsed){
  const ann = sb._announced_row4 || null;
  const correctionActive = !!(sb?._correction?.active);
  const showSelector = iAmTurn && rollsUsed === 1 && !correctionActive;

  // Belegte ❗ auf meinem Board sammeln
  const myBoard = (sb?._scoreboards && sb._scoreboards[myId]) || {};
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
         <span class="muted">nur direkt nach dem 1. Wurf</span>
       </div>`
    : `<div class="announce-status"><span class="label">Angesagt:</span> <span class="value">${ann ? esc(ann) : "—"}</span></div>`;

  return `<div id="announceSlot" class="announce-slot">${inner}</div>`;
}

function numOrEmpty(v){
  const n = num(v);
  return (n === null) ? "" : String(n);
}

// Helpers
function dieFace(v){ const f=["","⚀","⚁","⚂","⚃","⚄","⚅"]; return f[v]||"·"; }
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;","&gt;":">","\"":"&quot;","'":"&#39;"}[c])); }

/**
 * öffentlicher Renderer (jetzt als global, nicht als ES‑Modul)
 */
function renderScoreboard(mount, sb, {
  myPlayerId, iAmTurn, rollsUsed, rollsMax, announcedRow4, canRequestCorrection = false
} = {}) {
  if (!sb) { if (mount) mount.innerHTML = ""; return; }

  // ---- Header-/Status-Container im room.html ----
  const nameEl   = document.getElementById("roomGameName");
  const bubblesEl= document.getElementById("roomPlayerBubbles");
  const statusEl = document.getElementById("roomStatusLine");

  // ---- Dice/Buttons/Tables Container ----
  const contentEl = mount || document.getElementById("scoreOut");

  const dice  = sb._dice  || [];
  const holds = sb._holds || [false,false,false,false,false];

  const turnPid  = sb?._turn?.player_id || null;
  const turnName = (sb?._players || []).find(p => String(p.id) === String(turnPid))?.name || "—";

  const corr = sb?._correction || { active:false };
  const correctionActive = !!corr.active;
  const correctionForMe  = correctionActive && String(corr.player_id) === String(myPlayerId);

  const ann = announcedRow4 || sb._announced_row4 || null;

  // --------- Header: Spielname + Spielerbadges ----------
  if (nameEl) {
    nameEl.textContent = sb?._name || "";
  }

  // Wir bauen die Grids zuerst, damit wir pro Spieler das Overall berechnen und im Kopf zeigen können
  const pids = (sb._players||[]).map(p=>p.id);
  pids.sort((a,b)=>{
    if (String(a)===String(myPlayerId)) return -1;
    if (String(b)===String(myPlayerId)) return 1;
    return 0;
  });

  // Spieler-Bubbles
  if (bubblesEl) {
    bubblesEl.innerHTML = (sb._players||[]).map(p =>
      `<span class="badge">${esc(p.name)}${String(p.id)===String(myPlayerId) ? " (du)" : ""}</span>`
    ).join(" ");
  }

  // --------- Status-Zeile über Tabellen ----------
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

  // --------- Hauptbereich: Dicebar + Ansage + Tabellen ----------
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

  // Grids rendern
  let grid = `<div class="players-grid">`;
  for (const pid of pids) {
    const p = (sb._players||[]).find(x=>String(x.id)===String(pid));
    if (!p) continue;
    const isTurn = String(turnPid||"")===String(pid);
    const sc = sb._scoreboards?.[pid] || {};

    // Gesamt über alle 4 Spalten
    const overall = computeOverall(sc);

    grid += `
      <div class="player-card ${isTurn ? "turn" : ""}">
        <div class="pc-head">
          <div class="pc-name">${esc(p.name || "Spieler")}</div>
          <div class="pc-total">Total: ${overall}</div>
        </div>
        <div class="table-wrap">
          <table class="grid compact">
            <thead>
              <tr>
                <th class="sticky"></th>
                <th title="Abwärts">⬇︎</th>
                <th title="Freireihe">／</th>
                <th title="Aufwärts">⬆︎</th>
                <th title="Angesagt">❗</th>
              </tr>
            </thead>
            <tbody>
              ${renderRows(sc, sb, { myPlayerId, pid, iAmTurn, rollsUsed, correctionActive })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  grid += `</div>`;

  // Announce-Slot separat (bleibt oberhalb der Tabellen)
  const announceSlot = renderAnnounceSlot(sb, myPlayerId, iAmTurn, rollsUsed);

  (contentEl || mount).innerHTML = dicebar + announceSlot + `<div id="overlayMount"></div>` + grid;
}

function renderRows(sc, sb, ctx){
  const announced = sb._announced_row4 || null;
  const rolledYet = (ctx.rollsUsed ?? 0) > 0;
  const isMe = String(ctx.pid) === String(ctx.myPlayerId);
  const correctionForMe = !!(ctx.correctionActive && sb?._correction?.player_id && String(sb._correction.player_id) === String(ctx.myPlayerId));

  // Live-Berechnungen für jede Spalte vorbereiten
  const cols = ["down","free","up","ang"];
  const live = {};
  for (const c of cols) live[c] = computeColumnTotals(sc, c);

  return ROW_LABELS.map((label, ri) => {
    const meta = rowGroupMeta(ri);
    const isCompute = COMPUTE_ROWS.has(ri);

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
      const isAnnouncedCell = Boolean(announced && colIdx === 4 && rowFieldKey === announced);

      const mayClickNormal =
        !ctx.correctionActive &&
        !isCompute &&
        !hasRaw &&
        isMe &&
        ctx.iAmTurn &&
        rolledYet &&
        (!announced ? true : isAnnouncedCell);

      const mayClickCorrection =
        correctionForMe && !isCompute && !hasRaw;

      const clickable = (mayClickNormal || mayClickCorrection);

      const classes = ["cell"];
      if (isCompute) classes.push("compute");
      if (isAnnouncedCell) classes.push("announced");
      if (clickable) classes.push("clickable");

      const dataAttr  = clickable ? ` data-row="${ri}" data-field="${colKey}"` : "";
      return `<td class="${classes.join(" ")}"${dataAttr}>${has ? esc(String(val)) : ""}</td>`;
    }

    const rowClasses = [];
    if (meta.group) rowClasses.push(`grp-${meta.group}`);
    if (meta.start) rowClasses.push("grp-start");
    if (meta.end)   rowClasses.push("grp-end");
    if (isCompute)  rowClasses.push("is-compute");

    return `
      <tr class="${rowClasses.join(" ")}">
        <td class="desc sticky${isCompute ? " compute" : ""}">${esc(label)}</td>
        ${cell("down", 1)}
        ${cell("free", 2)}
        ${cell("up",   3)}
        ${cell("ang",  4)}
      </tr>
    `;
  }).join("");
}

// --- global export für game.js ---
window.renderScoreboard = renderScoreboard;