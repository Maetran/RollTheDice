  function isMobileNarrow(){
    try { return window.matchMedia && window.matchMedia("(max-width: 560px)").matches; }
    catch { return false; }
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
    if (!window.matchMedia?.("(any-pointer: coarse) and (min-width: 768px) and (min-height: 600px) and (max-width: 1600px)").matches) return;
    const cards = Array.from(grid.querySelectorAll(":scope > .player-card"));
    const translate = value => window.ZDWA_I18N?.t?.(value) || value;
    if (cards.length === 1) {
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
    if (cards.length > 2) {
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
    const updateScrollHints = () => cards.forEach(card => {
      const sheet = card.querySelector(".table-wrap");
      if (!sheet) return;
      const table = sheet.querySelector("table.grid");
      const writableRows = Array.from(table?.querySelectorAll("tbody tr:not(.is-compute)") || []);
      if (writableRows.length) {
        const styleHeight = (element, properties) => {
          const style = getComputedStyle(element);
          return properties.reduce((sum, name) => sum + (Number.parseFloat(style[name]) || 0), 0);
        };
        // Fit to the actual workspace, rather than a viewport estimate that
        // omitted PWA safe areas, team names and the action/chat bars. The
        // minimum remains finger-friendly; shorter tablets keep sheet scroll.
        const gridPadding = styleHeight(grid, ["paddingTop", "paddingBottom"]);
        const cardEdges = styleHeight(card, ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]);
        const sheetEdges = styleHeight(sheet, ["borderTopWidth", "borderBottomWidth"]);
        const headings = Array.from(card.children)
          .filter(child => child !== sheet && !child.classList.contains("tablet-sheet-scroll-hint"))
          .reduce((sum, child) => sum + child.getBoundingClientRect().height + styleHeight(child, ["marginTop", "marginBottom"]), 0);
        const fixedRows = Array.from(table.rows)
          .filter(row => !writableRows.includes(row))
          .reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
        const available = grid.clientHeight - gridPadding - cardEdges - sheetEdges - headings;
        const rowHeight = Math.max(44, Math.min(56, Math.floor((available - fixedRows - 1) / writableRows.length * 10) / 10));
        const nextHeight = `${rowHeight}px`;
        if (card.style.getPropertyValue("--tablet-write-row") !== nextHeight) card.style.setProperty("--tablet-write-row", nextHeight);
      }
      const hint = card.querySelector(".tablet-sheet-scroll-hint");
      // Test the space available without the footer so it cannot create its
      // own overflow. Resizing or opening the keyboard updates this affordance.
      const overflows = sheet.scrollHeight > sheet.clientHeight + (hint?.offsetHeight || 0) + 1;
      if (!overflows) { hint?.remove(); return; }
      if (hint) return;
      const nextHint = document.createElement("div");
      nextHint.className = "tablet-sheet-scroll-hint";
      nextHint.textContent = `↕ ${translate("Weitere Felder durch Wischen")}`;
      card.appendChild(nextHint);
    });
    updateScrollHints();
    if (typeof ResizeObserver === "function") {
      grid._tabletSheetObserver = new ResizeObserver(updateScrollHints);
      grid._tabletSheetObserver.observe(grid);
      cards.forEach(card => grid._tabletSheetObserver.observe(card.querySelector(".table-wrap")));
    }
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
        ? window.ZDWA_PLAYER_NAME_MARKUP(turnPlayer, { name: turnName, showRank: false, fallback: "—" })
        : esc(turnName);
      const rolls = Number(snapshot?._rolls_used || 0);
      const max = Number(snapshot?._rolls_max || 3);
      const isHC = !!snapshot?._hardcore;
      el.innerHTML = `
        <span class="line">Am Zug: ${turnMarkup}</span>
        <span class="line secondary">${isHC ? "Hardcore" : `Würfe: ${rolls}/${max}`}</span>
      `;
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
