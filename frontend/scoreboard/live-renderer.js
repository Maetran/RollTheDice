function renderScoreboard(mount, sb, {
  myPlayerId, iAmTurn, rollsUsed, rollsMax, announcedRow4, canRequestCorrection = false, readOnly = false,
  animateWrites = false, resetWrites = false, displayedDiceHolds = null
} = {}) {
  if (!sb) { if (mount) mount.innerHTML = ""; return; }

  const isTeamMode = isTeamModeSnapshot(sb);

  const nameEl   = document.getElementById("roomGameName");
  const contentEl= mount || document.getElementById("scoreOut");
  const writing = prepareClassicWriting(contentEl, sb, { animateWrites, resetWrites, readOnly });

  const dice  = sb._dice  || [];
  const logicalHolds = sb._holds || [false,false,false,false,false];
  const holds = displayedDiceHolds || logicalHolds;
  const turnPid  = sb?._turn?.player_id || null;
  const turnPlayer = (sb?._players || []).find(p => String(p.id) === String(turnPid));
  const turnName = turnPlayer?.name || "—";

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
    ? `<button id="requestCorrectionBtn" class="small correction-icon-button" type="button" aria-label="Letzten Eintrag ändern" title="Letzten Eintrag ändern" aria-keyshortcuts="k"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 3 7 7-10 10H6l-4-4L14 3Z"/><path d="m8 10 7 7M10 20h11"/></svg></button>`
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
              `<button type="button" class="die ${holds[i] ? "held" : ""}" data-i="${i}" data-logical-held="${logicalHolds[i] ? "true" : "false"}" aria-label="Würfel ${i + 1} halten oder lösen" aria-pressed="${holds[i] ? "true" : "false"}" title="halten/lösen">${dieSVG(d || 0)}</button>`
            ).join("")}
          </div>
          <div class="dice-actions">
            ${requestBtnHTML || (isHC ? '' : `<button id="announceBtnInline" class="small" ${announceDisabledAttr} ${rollsNum < 1 ? 'hidden' : ''}>Ansagen</button>`)}
            ${isHC ? '<span class="tray-mode-note">Hardcore: 1 Wurf, kein Halten</span>' : `<button id="rollBtnInline" data-action="roll" ${rollDisabledAttr}>🎲 Würfeln${rollCountMarkup(rollsNum, rollsCap)}</button>`}
          </div>
        </div>
      </div>
      ${isHC ? '' : `<section id="mobileAnnouncePicker" class="mobile-announce-picker" aria-label="Ansagefeld auswählen" hidden></section>`}
    </div>
    <div class="muted turn-status">
      <span id="mobileReactionsBar" class="mobile-reactions-host" aria-label="Reaktionen"></span>
      <span class="turn-status-text">Am Zug: ${playerNameMarkup(turnPlayer, { name: turnName, showRank: false, showAdminBadge: true, avatarKey: "score-turn" })} • ${isHC ? '<span class="hc-badge">Hardcore</span>' : `Würfe: ${rollsUsed ?? 0}/${rollsMax ?? 3} <span id="announceHint"></span>`}</span>
    </div>
  `;

  let grid = `<div class="players-grid">`;
  const tiles = [];
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
      const members = (ent.members || [])
        .map(pid => sb._players.find(p => String(p.id) === String(pid)) || { id: pid, name: pid })
        .filter(Boolean);
      membersHTML = members.map(player => `<span class="badge">${playerNameMarkup(player, { compactRank: true, showAdminBadge: true, profileLink: true, avatarKey: `board:${id}:member:${player.id}` })}</span>`).join(" ");
    }
    if (!readOnly) {
      tiles.push(playerTile(sb, ent, {
        id, overall, isTeamMode, isMyBoard,
        isTurn: isTurn && !sb._finished && entities.length > 1,
        turnPid,
      }));
    }

    grid += `
      <div class="player-card${isTurn ? " turn": ""}${isMyBoard ? " me": ""}" data-board-id="${esc(id)}">
        <div class="pc-head">
          <div class="pc-name">${isTeamMode ? esc(ent.name || "—") : playerNameMarkup(ent, { compactRank: true, showAdminBadge: true, fallback: "—", profileLink: true, avatarKey: `board:${id}` })}</div>
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
                writing,
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

  replaceChildrenPreservingAvatars(contentEl || mount,
    dicebar +
    (readOnly ? "" : `<div class="suggestions-area"><div id="suggestions" class="suggestions"></div></div>`) +
    `<div id="overlayMount"></div>` +
    grid);
  if (!readOnly) renderPlayerTiles(document.getElementById("roomPlayerTiles"), tiles);
}

/**
 * Design 2026 player tiles in the room header: one per player (per team in
 * 2v2) in sheet order, with avatar, name, live total and the turn mark. The
 * previous design hides the mount. Room code (board-navigation.js) wires taps
 * and the pressed state of the sheets in view.
 */
function playerTile(sb, ent, { id, overall, isTeamMode, isMyBoard, isTurn, turnPid }){
  const players = sb?._players || [];
  const members = isTeamMode
    ? (ent.members || []).map(pid => players.find(p => String(p.id) === String(pid)) || { id: pid, name: pid })
    : [ent];
  const name = isTeamMode
    ? (members.map(player => player?.name).filter(Boolean).join(" & ") || ent.name || "—")
    : (ent?.name || "—");
  const avatars = members.map(player => {
    const active = isTurn && isTeamMode && String(player?.id) === String(turnPid);
    // The tiles replace the header turn text, which showed the admin badge.
    const image = playerAvatarMarkup(player, { avatarKey: `tile:${id}:${player?.id ?? ""}`, showAdminBadge: true });
    return active ? `<span class="room-player-tile-active">${image}</span>` : image;
  }).join("");
  const classes = ["room-player-tile"];
  if (isTurn) classes.push("is-turn");
  if (isMyBoard) classes.push("is-me");
  if (isTeamMode) classes.push("is-team");
  const title = isTeamMode ? `${ent.name || "Team"}: ${name}` : name;
  // Longer names (team names above all) may widen the tile where the header
  // has room (table-top.css); the tile's own size containment hides its text.
  const nameLength = Array.from(name).length;
  return {
    id: String(id),
    className: classes.join(" "),
    nameSize: nameLength > 22 ? "xl" : nameLength > 16 ? "l" : nameLength > 10 ? "m" : "s",
    title,
    // The body lays out the tile, so container queries on the tile can switch
    // between one line (wide) and name over total (narrow).
    html: `<span class="room-player-tile-body">`
      + `<span class="room-player-tile-avatars" aria-hidden="true">${avatars}</span>`
      + `<span class="room-player-tile-name" translate="no">${esc(name)}</span>`
      + `<span class="room-player-tile-score"><span class="room-player-tile-total">${esc(String(overall))}</span><span class="visually-hidden"> Punkte</span></span>`
      + (isTurn ? `<span class="room-player-tile-turn">am Zug</span>` : "")
      + `</span>`,
  };
}

/**
 * Design 2026 shows the rolls of the current turn in the dice tray, on the
 * roll button (the previous design hides it and keeps "Würfe: n/m" in the
 * header). Screen readers hear the count from the header turn status.
 */
function rollCountMarkup(used, max){
  const cap = Math.max(0, Math.min(6, Math.trunc(Number(max) || 0)));
  const count = Math.max(0, Math.min(cap, Math.trunc(Number(used) || 0)));
  if (!cap) return "";
  const pips = Array.from({ length: cap }, (_, index) => `<i${index < count ? ' class="is-used"' : ""}></i>`).join("");
  return `<span class="roll-count" aria-hidden="true" data-rolls="${count}/${cap}"><span class="roll-count-pips">${pips}</span><span class="roll-count-text">${count}/${cap}</span></span>`;
}

/**
 * Updates the tiles in place while the same sheets are shown, so a focused
 * tile keeps its focus and decoded avatars stay painted across snapshots.
 */
function renderPlayerTiles(mount, tiles){
  if (!mount) return;
  const current = Array.from(mount.children);
  const sameTiles = current.length === tiles.length
    && current.every((tile, index) => tile.dataset.boardId === tiles[index].id);
  if (!sameTiles) {
    replaceChildrenPreservingAvatars(mount, tiles.map(tile =>
      `<button type="button" class="${tile.className}" data-board-id="${esc(tile.id)}" data-name-size="${tile.nameSize}" aria-pressed="false" title="${esc(tile.title)}">${tile.html}</button>`
    ).join(""));
    Array.from(mount.children).forEach((element, index) => {
      element._tileHtml = tiles[index].html;
      element._tileTitle = tiles[index].title;
    });
    mount.dataset.count = String(tiles.length);
    return;
  }
  current.forEach((element, index) => {
    const tile = tiles[index];
    // aria-pressed (the sheet in view) stays with room code. Title and content
    // compare with what was rendered, not the DOM, which i18n may translate.
    element.className = tile.className;
    if (element.dataset.nameSize !== tile.nameSize) element.dataset.nameSize = tile.nameSize;
    if (element._tileTitle !== tile.title) {
      element.setAttribute("title", tile.title);
      element._tileTitle = tile.title;
    }
    if (element._tileHtml !== tile.html) {
      replaceChildrenPreservingAvatars(element, tile.html);
      element._tileHtml = tile.html;
    }
  });
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

  // Server-computed points for writable fields (design preview). Only the
  // active player's own board carries them; the attributes are inert unless a
  // stylesheet renders them. The server flags at most one field as worth
  // writing now (`best`); without it the player is better off rolling on.
  const previewPoints = new Map();
  let bestPreviewKey = null;
  if (ctx.isMyBoard && ctx.iAmTurn && !ctx.correctionActive && Array.isArray(sb?.field_previews)) {
    for (const preview of sb.field_previews) {
      const key = `${preview.row},${preview.col}`;
      previewPoints.set(key, Number(preview.points) || 0);
      if (preview.best === true && bestPreviewKey === null) bestPreviewKey = key;
    }
  }

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
        (rolledYet || lastCellMode) &&
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
        } else if (!rolledYet && !lastCellMode) {
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

      const previewKey = `${ri},${colKey}`;
      const previewAttr = (mayClickNormal && previewPoints.has(previewKey))
        ? ` data-preview-points="${previewPoints.get(previewKey)}"${previewKey === bestPreviewKey ? " data-preview-best" : ""}`
        : "";
      const dataAttr  = rowFieldKey ? ` data-row="${ri}" data-field="${colKey}"${previewAttr}` : "";
      const titleAttr = titleText ? ` title="${esc(titleText)}"` : "";
      const valueMarkup = has
        ? (rowFieldKey ? classicWrittenScore(val, ctx.pid, ri, colKey, ctx.writing) : esc(String(val)))
        : "";
      return `<td class="${classes.join(" ")}"${dataAttr}${titleAttr}>${valueMarkup}</td>`;
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
