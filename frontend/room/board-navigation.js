  function isMobileNarrow(){
    try { return window.matchMedia && window.matchMedia("(max-width: 560px)").matches; }
    catch { return false; }
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
        ? window.ZDWA_PLAYER_NAME_MARKUP(turnPlayer, { name: turnName, compactRank: true, fallback: "—" })
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
      if (!isMobileNarrow()) return;

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
    if (snapshot?._paused) return false;
    if (isSingle || isHC) return false;
    const hasLast   = snapshot?._has_last && snapshot._has_last[myId];
    const corrActive= !!(snapshot?._correction?.active);
    return !!(hasLast && !corrActive);
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
	    syncChatWidth();
	    syncSideChatAnchor();
	    syncReactionsMount();
	  });

  // --- Suggestions (nur Anzeige) ---
  /**
   * Zeigt serverseitige Vorschläge an (rein informativ, keine Logik).
   * @param {Array<{type:string,label:string,points:number,eligible:boolean}>} suggestions
   */
