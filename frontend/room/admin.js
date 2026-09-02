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

  function activeTurnBoardId(snapshot){
    const turnPlayerId = String(snapshot?._turn?.player_id || "");
    if (!turnPlayerId) return "";
    if (String(snapshot?._mode || "").toLowerCase() === "2v2") {
      const team = (snapshot?._teams || []).find(item =>
        (item?.members || []).some(member => String(member) === turnPlayerId)
      );
      return String(team?.id || "");
    }
    return turnPlayerId;
  }

  function getSuperadminDiceAvailability(snapshot){
    if (!superadminState.active) return { usable:false, reason:"Superadmin-Modus nicht aktiv" };
    if (!snapshot || snapshot._finished || snapshot._aborted || !snapshot._started) {
      return { usable:false, reason:"Spiel ist nicht aktiv" };
    }
    if (snapshot?._correction?.active) return { usable:false, reason:"Während Korrektur nicht erlaubt" };
    if (String(superadminState.boardId || "") !== activeTurnBoardId(snapshot)) {
      return { usable:false, reason:"Nur beim aktuell aktiven Spieler verfügbar" };
    }
    if (Number(snapshot?._rolls_used || 0) < 1) {
      return { usable:false, reason:"Erst nach dem ersten regulären Wurf verfügbar" };
    }
    return { usable:true, reason:"Freie Würfel zusätzlich würfeln" };
  }

  function requestSuperadminRoll(){
    const availability = getSuperadminDiceAvailability(sb);
    if (!availability.usable) {
      alert(availability.reason);
      return;
    }
    safeSend(ws, { action: "superadmin_roll_dice" });
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
        <button id="superadminRoll" class="small primary" type="button">Zusatzwurf</button>
        <button id="superadminSave" class="small primary" type="button">Speichern</button>
        <button id="superadminDiscard" class="small" type="button">Verwerfen</button>
        <button id="superadminExit" class="small ghost" type="button">Beenden</button>
      `;
      document.body.appendChild(bar);
      bar.querySelector("#superadminRoll").addEventListener("click", requestSuperadminRoll);
      bar.querySelector("#superadminSave").addEventListener("click", saveSuperadminDraft);
      bar.querySelector("#superadminDiscard").addEventListener("click", discardSuperadminDraft);
      bar.querySelector("#superadminExit").addEventListener("click", exitSuperadminMode);
    }
    const count = adminDraftEntries().length;
    const label = bar.querySelector(".superadmin-bar-label");
    if (label) label.textContent = `Superadmin aktiv • Würfel antippen = sofort setzen • ${count} Tabellenänderung${count === 1 ? "" : "en"}`;
    const rollBtn = bar.querySelector("#superadminRoll");
    const saveBtn = bar.querySelector("#superadminSave");
    const discardBtn = bar.querySelector("#superadminDiscard");
    if (rollBtn) {
      const availability = getSuperadminDiceAvailability(sb);
      rollBtn.disabled = !availability.usable;
      rollBtn.title = availability.reason;
    }
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
