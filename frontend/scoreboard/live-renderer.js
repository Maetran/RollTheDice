function renderScoreboard(mount, sb, {
  myPlayerId, iAmTurn, rollsUsed, rollsMax, announcedRow4, canRequestCorrection = false, readOnly = false
} = {}) {
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
      <div id="actionFeedback" class="action-feedback" role="status" aria-live="polite"></div>
      <div id="diceBar">
        <div id="mobileRowQuickActions" class="mobile-row-quick-actions" aria-label="Mobile Schnelleingabe" hidden>
          <button type="button" class="mobile-row-quick-button" data-quick-field="down" aria-label="Nächstes Feld der Abwärtsreihe eintragen" title="Abwärtsreihe schnell eintragen">⬇︎</button>
          <button type="button" class="mobile-row-quick-button" data-quick-field="up" aria-label="Nächstes Feld der Aufwärtsreihe eintragen" title="Aufwärtsreihe schnell eintragen">⬆︎</button>
        </div>
        <div class="dice-main">
          <div class="dice-row">
            ${dice.map((d,i)=>
              `<button type="button" class="die ${holds[i] ? "held" : ""}" data-i="${i}" aria-label="Würfel ${i + 1} halten oder lösen" aria-pressed="${holds[i] ? "true" : "false"}" title="halten/lösen">${dieSVG(d || 0)}</button>`
            ).join("")}
          </div>
          <div class="dice-actions">
            ${isHC ? '' : `<button id="announceBtnInline" class="small" ${announceDisabledAttr}>Ansagen</button>`}
            ${isHC ? '' : `<button id="rollBtnInline" data-action="roll" ${rollDisabledAttr}>🎲 Würfeln</button>`}
            ${requestBtnHTML}
          </div>
        </div>
      </div>
      ${isHC ? '' : `<section id="mobileAnnouncePicker" class="mobile-announce-picker" aria-label="Ansagefeld auswählen" hidden></section>`}
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
