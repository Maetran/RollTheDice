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

// -------- Haupt-Renderer --------
/**
 * Rendert das Scoreboard (Einzel oder Team) inklusive Dicebar, Suggestions
 * und Grid pro Entity.
 * @param {HTMLElement} mount
 * @param {Object} sb - Server-Snapshot
 * @param {Object} opts - Anzeigeoptionen
 */
