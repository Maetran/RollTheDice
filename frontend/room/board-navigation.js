  const RESPONSIVE_SCORE_SHEET_QUERY = "(max-width: 767px), (min-width: 561px) and (max-height: 600px), (any-pointer: coarse) and (min-width: 768px) and (min-height: 600px) and (max-width: 1600px)";
  const TABLET_SCORE_SHEET_QUERY = "(any-pointer: coarse) and (min-width: 768px) and (min-height: 601px) and (max-width: 1600px)";

  function fitResponsiveScoreSheets(grid, cards){
    const responsive = window.matchMedia?.(RESPONSIVE_SCORE_SHEET_QUERY).matches;
    const tablet = window.matchMedia?.(TABLET_SCORE_SHEET_QUERY).matches;
    const properties = [
      "--responsive-score-row",
      "--responsive-score-fixed-row",
      "--responsive-score-font",
      "--responsive-score-fixed-font",
      "--responsive-score-pad-y",
      "--responsive-score-fixed-pad-y",
    ];
    if (!responsive) {
      cards.forEach(card => {
        properties.forEach(property => card.style.removeProperty(property));
        card.classList.remove("score-sheet-fitted");
      });
      return;
    }

    const styleHeight = (element, names) => {
      const style = getComputedStyle(element);
      return names.reduce((sum, name) => sum + (Number.parseFloat(style[name]) || 0), 0);
    };
    const gridPadding = styleHeight(grid, ["paddingTop", "paddingBottom"]);
    cards.forEach(card => {
      const sheet = card.querySelector(".table-wrap");
      const table = sheet?.querySelector("table.grid");
      if (!sheet || !table) return;
      const writableRows = Array.from(table.querySelectorAll("tbody tr:not(.is-compute)"));
      const fixedRows = Array.from(table.rows).filter(row => !writableRows.includes(row));
      if (!writableRows.length || !fixedRows.length) return;

      const cardEdges = styleHeight(card, ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]);
      const sheetEdges = styleHeight(sheet, ["borderTopWidth", "borderBottomWidth"]);
      const headings = Array.from(card.children)
        .filter(child => child !== sheet && !child.classList.contains("tablet-sheet-scroll-hint"))
        .reduce((sum, child) => sum + child.getBoundingClientRect().height + styleHeight(child, ["marginTop", "marginBottom"]), 0);
      const available = Math.max(1, grid.clientHeight - gridPadding - cardEdges - sheetEdges - headings);
      const writeCount = writableRows.length;
      const fixedCount = fixedRows.length;
      // Cells use border-box sizing, so separators are already included in
      // their measured row height and must not be reserved a second time.
      const rowSpace = available;

      let writeHeight;
      let fixedHeight;
      let writeFont;
      let fixedFont;
      if (tablet) {
        const minimumWrite = 22;
        const minimumFixed = 14;
        const minimumTotal = minimumWrite * writeCount + minimumFixed * fixedCount;
        if (rowSpace < minimumTotal) {
          const scale = rowSpace / minimumTotal;
          writeHeight = minimumWrite * scale;
          fixedHeight = minimumFixed * scale;
        } else {
          const average = rowSpace / (writeCount + fixedCount);
          const desiredFixed = Math.max(minimumFixed, Math.min(26, average * .78));
          const fixedLimit = (rowSpace - minimumWrite * writeCount) / fixedCount;
          fixedHeight = Math.max(minimumFixed, Math.min(desiredFixed, fixedLimit));
          writeHeight = Math.max(minimumWrite, Math.min(56, (rowSpace - fixedHeight * fixedCount) / writeCount));
        }
        writeFont = Math.max(12, Math.min(16, writeHeight * .48));
        fixedFont = Math.max(12, Math.min(13.6, fixedHeight * .75));
      } else {
        const rowCount = writeCount + fixedCount;
        const rowMaximum = window.matchMedia?.("(max-height: 600px)").matches ? 22.08 : 29.44;
        writeHeight = fixedHeight = Math.max(8, Math.min(rowMaximum, rowSpace / rowCount));
        writeFont = fixedFont = Math.max(10, Math.min(13.44, writeHeight * .72));
      }

      const writePadding = Math.max(0, Math.min(2, (writeHeight - writeFont * (tablet ? 1.15 : 1.05) - 1) / 2));
      const fixedPadding = Math.max(0, Math.min(1.4, (fixedHeight - fixedFont * (tablet ? 1.08 : 1.05) - 1) / 2));
      const setPixels = (property, value) => card.style.setProperty(property, `${Math.floor(value * 100) / 100}px`);
      const suggestionInset = Number.parseFloat(getComputedStyle(card).getPropertyValue("--responsive-score-suggestion-inset")) || 0;
      const minimumFont = tablet ? 12 : (window.matchMedia?.("(max-height: 480px)").matches ? 9.8 : 10);
      let fitted = { writeHeight, fixedHeight, writeFont, fixedFont, writePadding, fixedPadding };
      const applyFit = () => {
        setPixels("--responsive-score-row", fitted.writeHeight + suggestionInset);
        setPixels("--responsive-score-fixed-row", fitted.fixedHeight + suggestionInset);
        setPixels("--responsive-score-font", fitted.writeFont);
        setPixels("--responsive-score-fixed-font", fitted.fixedFont);
        setPixels("--responsive-score-pad-y", fitted.writePadding);
        setPixels("--responsive-score-fixed-pad-y", fitted.fixedPadding);
      };
      applyFit();
      // Content can still impose a slightly larger used row height (for
      // example on an exceptionally short legacy viewport). Refine from the
      // rendered result; a second pass covers nonlinear text/border rounding.
      for (let pass = 0; pass < 3; pass += 1) {
        const renderedHeight = table.getBoundingClientRect().height;
        if (renderedHeight <= available + .5) break;
        const scale = available / renderedHeight;
        fitted = {
          writeHeight:fitted.writeHeight * scale,
          fixedHeight:fitted.fixedHeight * scale,
          writeFont:Math.max(minimumFont, fitted.writeFont * scale),
          fixedFont:Math.max(minimumFont, fitted.fixedFont * scale),
          writePadding:fitted.writePadding * scale,
          fixedPadding:fitted.fixedPadding * scale,
        };
        applyFit();
      }
      card.classList.add("score-sheet-fitted");
      sheet.scrollTop = 0;
    });
  }

  function refitResponsiveScoreSheets(){
    const grid = document.querySelector("#scoreOut .players-grid");
    if (!grid) return;
    fitResponsiveScoreSheets(grid, Array.from(grid.querySelectorAll(":scope > .player-card")));
  }

  function syncTabletTableExtras(snapshot){
    const score = document.querySelector("#scoreOut");
    const grid = score?.querySelector(".players-grid");
    if (!grid) return;
    grid._tabletSheetObserver?.disconnect();
    delete grid._tabletSheetObserver;
    if (grid._tabletNavigationUpdate) {
      grid.removeEventListener("scroll", grid._tabletNavigationUpdate);
      delete grid._tabletNavigationUpdate;
    }
    score.querySelectorAll(".tablet-column-guide, .tablet-board-navigation, .tablet-sheet-scroll-hint").forEach(element => element.remove());
    const cards = Array.from(grid.querySelectorAll(":scope > .player-card"));
    const translate = value => window.ZDWA_I18N?.t?.(value) || value;
    const tablet = window.matchMedia?.(TABLET_SCORE_SHEET_QUERY).matches;
    if (tablet && cards.length === 1) {
      const guide = document.createElement("aside");
      guide.className = "tablet-column-guide";
      const guideTitle = cards[0].classList.contains("me") ? "Deine vier Spalten" : "Reihen-Regeln (Spalten)";
      guide.setAttribute("aria-label", translate(guideTitle));
      const columns = [
        ["down", "⬇︎", "Abwärts", "Von 1 bis 60"],
        ["free", "／", "Freireihe", "Freie Reihenfolge"],
        ["up", "⬆︎", "Aufwärts", "Von 60 bis 1"],
        ["ang", "❗", "Angesagt", snapshot?._hardcore ? "Freie Reihenfolge" : "Nach dem ersten Wurf wählen"],
      ];
      guide.innerHTML = `<h2>${esc(translate(guideTitle))}</h2>` + columns.map(([field, icon, name, hint]) => {
        const open = Array.from(cards[0].querySelectorAll(`td.cell[data-field="${field}"]`))
          .filter(cell => !cell.textContent.trim()).length;
        return `<article><div><span aria-hidden="true">${icon}</span><strong>${esc(translate(name))}</strong></div><p>${esc(translate(hint))}</p><small><span>${esc(translate("Offene Felder"))}</span><b>${open}</b></small></article>`;
      }).join("");
      score.appendChild(guide);
    }
    if (tablet && cards.length > 2) {
      const navigation = document.createElement("nav");
      navigation.className = "tablet-board-navigation";
      const previous = document.createElement("button");
      const next = document.createElement("button");
      const position = document.createElement("span");
      previous.type = next.type = "button";
      previous.textContent = "←";
      next.textContent = "→";
      previous.setAttribute("aria-label", translate("Vorherige Spielzettel"));
      next.setAttribute("aria-label", translate("Nächste Spielzettel"));
      const cardStep = () => cards[0].getBoundingClientRect().width + (Number.parseFloat(getComputedStyle(grid).columnGap) || 0);
      const update = () => {
        const first = Math.min(cards.length - 2, Math.max(0, Math.round(grid.scrollLeft / cardStep())));
        position.textContent = `${first + 1}–${Math.min(cards.length, first + 2)} / ${cards.length}`;
        previous.disabled = grid.scrollLeft < 4;
        next.disabled = grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 4;
      };
      const move = direction => {
        _userScrollOverride = true;
        const index = Math.round(grid.scrollLeft / cardStep());
        scrollGridToCard(grid, cards[Math.max(0, Math.min(cards.length - 2, index + direction))]);
      };
      previous.addEventListener("click", () => move(-1));
      next.addEventListener("click", () => move(1));
      grid._tabletNavigationUpdate = update;
      grid.addEventListener("scroll", update, { passive:true });
      navigation.append(previous, position, next);
      score.appendChild(navigation);
      requestAnimationFrame(update);
    }
    const fitScoreSheets = () => fitResponsiveScoreSheets(grid, cards);
    let frame = 0;
    const scheduleFit = () => {
      if (!grid.isConnected) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        fitScoreSheets();
      });
    };
    fitScoreSheets();
    if (window.matchMedia?.(RESPONSIVE_SCORE_SHEET_QUERY).matches && typeof ResizeObserver === "function") {
      grid._tabletSheetObserver = new ResizeObserver(scheduleFit);
      grid._tabletSheetObserver.observe(grid);
      cards.forEach(card => {
        grid._tabletSheetObserver.observe(card);
        const sheet = card.querySelector(".table-wrap");
        if (sheet) grid._tabletSheetObserver.observe(sheet);
      });
    }
    document.fonts?.ready?.then(scheduleFit);
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
      const turnPlayer = (snapshot?._players || []).find(p => String(p.id) === String(turnPid));
      const turnName = turnPlayer?.name || "—";
      const turnMarkup = typeof window.ZDWA_PLAYER_NAME_MARKUP === "function"
        ? window.ZDWA_PLAYER_NAME_MARKUP(turnPlayer, { name: turnName, showRank: false, showAdminBadge: true, fallback: "—", avatarKey: "header-turn" })
        : esc(turnName);
      const rolls = Number(snapshot?._rolls_used || 0);
      const max = Number(snapshot?._rolls_max || 3);
      const isHC = !!snapshot?._hardcore;
      replaceChildrenPreservingAvatars(el, `
        <span class="line">Am Zug: ${turnMarkup}</span>
        <span class="line secondary">${isHC ? "Hardcore" : `Würfe: ${rolls}/${max}`}</span>
      `);
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

      let gestureStart = null;
      const startGesture = point => {
        gestureStart = point ? { x:point.clientX, y:point.clientY } : null;
      };
      const moveGesture = point => {
        if (!gestureStart || !point) return;
        if (point.buttons === 0) return;
        const horizontal = Math.abs(point.clientX - gestureStart.x);
        const vertical = Math.abs(point.clientY - gestureStart.y);
        if (horizontal > 8 && horizontal > vertical) _userScrollOverride = true;
      };
      // Nur horizontales Navigieren waehlt einen Zettel manuell. Ein blosses
      // Antippen oder vertikales Scrollen darf Auto-Follow nicht abschalten.
      grid.addEventListener("touchstart", event => startGesture(event.touches[0]), { passive:true });
      grid.addEventListener("touchmove", event => moveGesture(event.touches[0]), { passive:true });
      grid.addEventListener("touchend", () => { gestureStart = null; }, { passive:true });
      grid.addEventListener("touchcancel", () => { gestureStart = null; }, { passive:true });
      grid.addEventListener("pointerdown", startGesture, { passive:true });
      grid.addEventListener("pointermove", moveGesture, { passive:true });
      grid.addEventListener("pointerup", () => { gestureStart = null; }, { passive:true });
      grid.addEventListener("pointercancel", event => {
        if (event.pointerType !== "touch") gestureStart = null;
      }, { passive:true });
      grid.addEventListener("wheel", event => {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || (event.shiftKey && event.deltaY)) {
          _userScrollOverride = true;
        }
      }, { passive:true });
    } catch {}
  }

  function autoFollowTurn(snapshot){
    try {
      const turnPid = snapshot?._turn?.player_id || null;
      const filledNow = countFilledWritableCells(snapshot);
      const firstSnapshot = _lastFilledCount === null;
      const turnChanged = !firstSnapshot && String(_lastTurnPid) !== String(turnPid);
      const wroteHappened = !firstSnapshot && filledNow > _lastFilledCount;

      // Eine manuelle Auswahl gilt nur fuer den aktuellen Spielerzug. Auch
      // Zugwechsel ohne neues Feld (z.B. Korrekturen) stellen Auto-Follow her.
      if (firstSnapshot || turnChanged) {
        _userScrollOverride = false;
        if (_pendingFollowTimer) clearTimeout(_pendingFollowTimer);
        _pendingFollowTimer = null;
      }
      _lastTurnPid = turnPid;
      _lastFilledCount = filledNow;

      if (!window.matchMedia?.(RESPONSIVE_SCORE_SHEET_QUERY).matches) return;
      const followCurrentBoard = behavior => {
        const grid = document.querySelector("#scoreOut .players-grid");
        scrollGridToCard(grid, grid?.querySelector(".player-card.turn"), behavior);
      };

      // Den neuen Eintrag weiterhin eine Sekunde lesbar lassen. Weitere
      // Snapshots desselben Zugs duerfen diese Wartezeit nicht neu starten.
      if (turnChanged && wroteHappened) {
        const targetTurnPid = turnPid;
        _pendingFollowTimer = setTimeout(() => {
          _pendingFollowTimer = null;
          if (_userScrollOverride || String(sb?._turn?.player_id || null) !== String(targetTurnPid)) return;
          followCurrentBoard("smooth");
        }, 1000);
      } else if (!_userScrollOverride && !_pendingFollowTimer) {
        // Ein Snapshot ersetzt das Grid und kann laufendes Smooth-Scrolling
        // abbrechen. Ohne manuelle Auswahl den aktiven Zettel sofort ausrichten,
        // statt eine unterbrochene Zwischenposition dauerhaft zu uebernehmen.
        followCurrentBoard(turnChanged ? "smooth" : "auto");
      }
    } catch {}
  }

  // --- Design 2026: player tiles in the header ---
  // live-renderer.js renders one tile per sheet (#roomPlayerTiles). A tap
  // shows that sheet like a swipe does; the tile of the active sheet resumes
  // auto-follow. Tiles of sheets in view are pressed.
  function sheetsInView(grid){
    const view = grid.getBoundingClientRect();
    return new Set(Array.from(grid.querySelectorAll(":scope > .player-card"))
      .filter(card => {
        const box = card.getBoundingClientRect();
        if (!box.width) return false;
        const visible = Math.min(box.right, view.right) - Math.max(box.left, view.left);
        return visible >= box.width * .6;
      })
      .map(card => String(card.dataset.boardId || "")));
  }

  function syncPlayerTilesPressed(){
    const tiles = document.getElementById("roomPlayerTiles");
    const grid = document.querySelector("#scoreOut .players-grid");
    if (!tiles || !grid) return;
    const shown = sheetsInView(grid);
    const buttons = Array.from(tiles.querySelectorAll(":scope > [data-board-id]"));
    buttons.forEach(tile => {
      const pressed = shown.has(String(tile.dataset.boardId));
      if (tile.getAttribute("aria-pressed") !== String(pressed)) tile.setAttribute("aria-pressed", String(pressed));
    });
    // Side by side every sheet is in view; the pressed mark then says nothing.
    tiles.classList.toggle("is-all-visible", buttons.length > 0 && buttons.every(tile => shown.has(String(tile.dataset.boardId))));
    // Four tiles can overflow a very small phone: keep the shown one in reach.
    const focus = buttons.find(tile => tile.getAttribute("aria-pressed") === "true");
    if (focus && tiles.scrollWidth > tiles.clientWidth + 1) {
      const bar = tiles.getBoundingClientRect();
      const box = focus.getBoundingClientRect();
      if (box.left < bar.left) tiles.scrollLeft -= bar.left - box.left + 4;
      else if (box.right > bar.right) tiles.scrollLeft += box.right - bar.right + 4;
    }
    syncPlayerTilesOverflow(tiles);
    // The connection pill sits below the header while tiles fill it.
    syncRoomHeaderBottom();
  }

  // A tile row wider than the header fades out on the side that hides tiles
  // (table-top.css), so a cut tile reads as "scroll for more".
  function syncPlayerTilesOverflow(tiles){
    const hidden = tiles.scrollWidth - tiles.clientWidth;
    const start = hidden > 1 && tiles.scrollLeft > 1;
    const end = hidden > 1 && tiles.scrollLeft < hidden - 1;
    const value = start && end ? "both" : start ? "start" : end ? "end" : "";
    if ((tiles.dataset.overflow || "") === value) return;
    if (value) tiles.dataset.overflow = value;
    else delete tiles.dataset.overflow;
  }

  // Snapshots read the sheets in view in the next frame, before it paints:
  // reading layout inside the snapshot render would force an extra layout
  // pass while the table is still being rebuilt.
  let playerTilesPressedFrame = 0;
  function schedulePlayerTilesPressed(){
    if (playerTilesPressedFrame) return;
    playerTilesPressedFrame = requestAnimationFrame(() => {
      playerTilesPressedFrame = 0;
      syncPlayerTilesPressed();
    });
  }

  function sheetCard(grid, boardId){
    return Array.from(grid?.querySelectorAll(":scope > .player-card") || [])
      .find(element => String(element.dataset.boardId) === String(boardId)) || null;
  }

  function sheetFullyInView(grid, card){
    const view = grid.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    return box.left >= view.left - 2 && box.right <= view.right + 2;
  }

  // The sheet a tile tap is still scrolling to. A snapshot rebuilds the grid
  // and would otherwise keep the half-way position of the smooth scroll.
  let playerTileTarget = null;

  function showSheetFromTile(boardId){
    const grid = document.querySelector("#scoreOut .players-grid");
    const card = sheetCard(grid, boardId);
    if (!grid || !card) return;
    const active = card.classList.contains("turn");
    _userScrollOverride = !active;
    if (active && _pendingFollowTimer) {
      clearTimeout(_pendingFollowTimer);
      _pendingFollowTimer = null;
    }
    playerTileTarget = sheetFullyInView(grid, card) ? null : String(boardId);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scrollGridToCard(grid, card, reduced ? "auto" : "smooth");
    schedulePlayerTilesPressed();
  }

  function syncPlayerTiles(){
    const tiles = document.getElementById("roomPlayerTiles");
    if (!tiles) return;
    if (!tiles._tileTapBound) {
      tiles._tileTapBound = true;
      tiles.addEventListener("click", event => {
        const tile = event.target.closest("[data-board-id]");
        if (!tile || !tiles.contains(tile)) return;
        if (!IS_SPECTATOR) countSuperadminTap(String(tile.dataset.boardId || ""));
        showSheetFromTile(tile.dataset.boardId);
      });
      let overflowFrame = 0;
      tiles.addEventListener("scroll", () => {
        if (overflowFrame) return;
        overflowFrame = requestAnimationFrame(() => {
          overflowFrame = 0;
          syncPlayerTilesOverflow(tiles);
        });
      }, { passive:true });
    }
    const grid = document.querySelector("#scoreOut .players-grid");
    if (!grid) return;
    if (!grid._tileScrollBound) {
      grid._tileScrollBound = true;
      let frame = 0;
      grid.addEventListener("scroll", () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const target = playerTileTarget && sheetCard(grid, playerTileTarget);
          if (target && sheetFullyInView(grid, target)) playerTileTarget = null;
          syncPlayerTilesPressed();
        });
      }, { passive:true });
    }
    if (!_userScrollOverride) playerTileTarget = null;
    const target = playerTileTarget && sheetCard(grid, playerTileTarget);
    if (target) scrollGridToCard(grid, target, "auto");
    else playerTileTarget = null;
    schedulePlayerTilesPressed();
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
    if (IS_SPECTATOR || !snapshot || snapshot._finished || snapshot._paused || snapshot._superadmin_active) return false;
    if (isSingle || isHC) return false;
    const turn = snapshot._turn;
    if (!turn || String(turn.player_id) === String(myId) || Number(snapshot._rolls_used || 0) > 0) return false;
    if (snapshot._correction?.active) return false;
    // New snapshots can prove the full server permission, including whether
    // the previous write came from an explicit announcement.
    if (typeof snapshot._can_request_correction?.[myId] === "boolean") {
      return snapshot._can_request_correction[myId];
    }
    const hasLast   = snapshot?._has_last && snapshot._has_last[myId];
    return !!hasLast;
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
	    syncTabletTableExtras(sb);
	    syncChatWidth();
	    syncSideChatAnchor();
	    syncReactionsMount();
	    syncPlayerTilesPressed();
	  });

  // --- Suggestions (nur Anzeige) ---
  /**
   * Zeigt serverseitige Vorschläge an (rein informativ, keine Logik).
   * @param {Array<{type:string,label:string,points:number,eligible:boolean}>} suggestions
   */
