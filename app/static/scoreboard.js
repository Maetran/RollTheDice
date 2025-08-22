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

const ANNOUNCE_FIELDS = ["1","2","3","4","5","6","max","min","kenter","full","poker","60"];
const COMPUTE_ROWS = new Set([6,7,8,11,16,17]);

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
  const diff = (one !== null && vmax !== null && vmin !== null) ? (one * (vmax - vmin)) : null;

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

// -------- Haupt-Renderer --------
function renderScoreboard(mount, sb, {
  myPlayerId, iAmTurn, rollsUsed, rollsMax, announcedRow4, canRequestCorrection = false
} = {}) {
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
                <th class="sticky"></th>
                <th title="Abwärts">⬇︎</th>
                <th title="Freireihe">／</th>
                <th title="Aufwärts">⬆︎</th>
                <th title="Angesagt">❗</th>
              </tr>
            </thead>
            <tbody>
              ${renderRows(sc, sb, { myPlayerId, pid: id, iAmTurn, rollsUsed, correctionActive })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  grid += `</div>`;

  const announceSlot = renderAnnounceSlot(sb, myPlayerId, iAmTurn, rollsUsed);
  (contentEl || mount).innerHTML = dicebar + announceSlot + `<div id="overlayMount"></div>` + grid;
}

function renderRows(sc, sb, ctx){
  const announced = sb._announced_row4 || null;
  const rolledYet = (ctx.rollsUsed ?? 0) > 0;
  const isMe = String(ctx.pid) === String(ctx.myPlayerId); // bei Team-Mode: pid = teamId -> dann false, und das ist OK (Schreiben regelt der Server)
  const correctionForMe = !!(ctx.correctionActive && sb?._correction?.player_id && String(sb._correction.player_id) === String(ctx.myPlayerId));

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
        // isMe bleibt bei Team-Mode i.d.R. false; Klickbarkeit wird nicht mehr allein hier entschieden,
        // sondern der Server validiert. Wir lassen Klick trotzdem zu, wenn ich am Zug bin:
        ctx.iAmTurn &&
        rolledYet &&
        (!announced ? true : isAnnouncedCell);

      const mayClickCorrection = correctionForMe && !isCompute && !hasRaw;

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

window.renderScoreboard = renderScoreboard;