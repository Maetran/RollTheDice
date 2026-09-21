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
          writeFont:Math.max(tablet ? 12 : 7.5, fitted.writeFont * scale),
          fixedFont:Math.max(tablet ? 12 : 7.5, fitted.fixedFont * scale),
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
        ? window.ZDWA_PLAYER_NAME_MARKUP(turnPlayer, { name: turnName, showRank: false, fallback: "—", avatarKey: "header-turn" })
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

      const setOverride = () => { _userScrollOverride = true; };
      // Nutzerinteraktion, die eine manuelle Auswahl signalisiert
      grid.addEventListener("touchstart", setOverride, { passive: true });
      grid.addEventListener("pointerdown", setOverride, { passive: true });
      grid.addEventListener("wheel", setOverride, { passive: true });
    } catch {}
  }

  function autoFollowTurn(snapshot){
    try {
      if (!window.matchMedia?.("(max-width: 560px), (min-width: 561px) and (max-height: 600px), (any-pointer: coarse) and (min-width: 768px) and (min-height: 600px) and (max-width: 1600px)").matches) return;

      const turnPid = snapshot?._turn?.player_id || null;
      const filledNow = countFilledWritableCells(snapshot);

      // Initiales Setup beim ersten Snapshot: baseline setzen und einmal zur aktuellen Karte scrollen
      if (_lastTurnPid === null || _lastFilledCount === null) {
        _lastTurnPid = turnPid;
        _lastFilledCount = filledNow;

        const grid0 = document.querySelector("#scoreOut .players-grid");
        const target0 = grid0 ? grid0.querySelector(".player-card.turn") : null;
        scrollGridToCard(grid0, target0, "smooth");
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
          scrollGridToCard(grid, target, "smooth");
          _pendingFollowTimer = null;
        }, 1000);
      }

      // Baselines aktualisieren (immer)
      _lastTurnPid = turnPid;
      _lastFilledCount = filledNow;

    } catch {}
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
	  });

  // --- Suggestions (nur Anzeige) ---
  /**
   * Zeigt serverseitige Vorschläge an (rein informativ, keine Logik).
   * @param {Array<{type:string,label:string,points:number,eligible:boolean}>} suggestions
   */
