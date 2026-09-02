  function closeChatSheet(){
    try {
      const chatPanel = document.getElementById("chatPanel");
      const chatToggle = document.getElementById("chatToggle");
      const chatBackdrop = document.getElementById("chatBackdrop");
      if (chatPanel) chatPanel.classList.remove("open");
      if (chatToggle) chatToggle.setAttribute("aria-expanded", "false");
      if (chatBackdrop) chatBackdrop.hidden = true;
      document.body.classList.remove("chat-open");
      document.documentElement.classList.remove("chat-open");
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    } catch {}
  }

  function closeRulesSheet(){
    try {
      const sheet = document.getElementById("rulesSheet");
      const backdrop = document.getElementById("rulesSheetBackdrop");
      if (sheet) sheet.hidden = true;
      if (backdrop) backdrop.hidden = true;
      document.body.classList.remove("rules-open");
      document.documentElement.classList.remove("rules-open");
    } catch {}
  }

  function bindRulesFrameScroll(frame){
    if (!frame || frame._rulesScrollBound) return;
    frame._rulesScrollBound = true;

    const scrollByDelta = (deltaY) => {
      try {
        const win = frame.contentWindow;
        if (!win || !deltaY) return;
        win.scrollBy({ top: deltaY, left: 0, behavior: "auto" });
      } catch {}
    };

    const bindTouchScroll = (target) => {
      if (!target || target._rulesTouchScrollBound) return;
      target._rulesTouchScrollBound = true;
      let lastTouchY = null;
      target.addEventListener("touchstart", (e) => {
        lastTouchY = e.touches && e.touches.length ? e.touches[0].clientY : null;
      }, { passive: true });
      target.addEventListener("touchmove", (e) => {
        if (!e.touches || !e.touches.length || lastTouchY == null) return;
        const y = e.touches[0].clientY;
        scrollByDelta(lastTouchY - y);
        lastTouchY = y;
        e.preventDefault();
      }, { passive: false });
      target.addEventListener("touchend", () => { lastTouchY = null; }, { passive: true });
      target.addEventListener("touchcancel", () => { lastTouchY = null; }, { passive: true });
    };

    const bindInnerDocument = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || doc._rulesWheelScrollBound) return;
        doc._rulesWheelScrollBound = true;
        doc.addEventListener("wheel", (e) => {
          scrollByDelta(e.deltaY);
          e.preventDefault();
        }, { passive: false });
        bindTouchScroll(doc);
      } catch {}
    };

    frame.addEventListener("wheel", (e) => {
      scrollByDelta(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    bindTouchScroll(frame);
    frame.addEventListener("load", bindInnerDocument);
    bindInnerDocument();
  }

  function openRulesSheet(){
    try {
      closeChatSheet();
      const sheet = document.getElementById("rulesSheet");
      const backdrop = document.getElementById("rulesSheetBackdrop");
      const frame = document.getElementById("rulesFrame");
      if (!sheet || !backdrop) return;
      bindRulesFrameScroll(frame);
      if (frame && !frame.getAttribute("src")) {
        frame.setAttribute("src", frame.dataset.src || "/regeln?embed=1");
      }
      sheet.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("rules-open");
      document.documentElement.classList.add("rules-open");
      const closeBtn = document.getElementById("rulesSheetClose");
      setTimeout(() => {
        try { (closeBtn || sheet).focus({ preventScroll: true }); }
        catch { (closeBtn || sheet).focus(); }
      }, 0);
    } catch {}
  }

  function bindRulesSheet(){
    try {
      const openBtn = document.getElementById("rulesSheetOpen");
      const closeBtn = document.getElementById("rulesSheetClose");
      const backdrop = document.getElementById("rulesSheetBackdrop");
      if (openBtn && !openBtn._bound) {
        openBtn._bound = true;
        openBtn.addEventListener("click", (e) => {
          e.preventDefault();
          openRulesSheet();
        });
      }
      if (closeBtn && !closeBtn._bound) {
        closeBtn._bound = true;
        closeBtn.addEventListener("click", closeRulesSheet);
      }
      if (backdrop && !backdrop._bound) {
        backdrop._bound = true;
        backdrop.addEventListener("click", closeRulesSheet);
      }
      if (!window.__rt_rulesEscapeBound) {
        window.__rt_rulesEscapeBound = true;
        window.addEventListener("keydown", (e) => {
          const sheet = document.getElementById("rulesSheet");
          if (e.key === "Escape" && sheet && !sheet.hidden) closeRulesSheet();
        });
      }
    } catch {}
  }

  function bindShareGameButton() {
    const button = document.getElementById("shareGameBtn");
    if (!button || button._bound) return;
    button._bound = true;
    button.addEventListener("click", async () => {
      const url = new URL(location.href);
      url.searchParams.delete("pass");
      url.searchParams.delete("name");
      const shareData = {
        title: "ZDWA – Zock die Wand an",
        text: "Komm zu meiner ZDWA-Runde!",
        url: url.toString(),
      };
      try {
        if (navigator.share) {
          await navigator.share(shareData);
          return;
        }
        await navigator.clipboard.writeText(shareData.url);
        showToast("Spielelink kopiert.", { kind: "success" });
      } catch (error) {
        if (error?.name !== "AbortError") showToast("Spielelink konnte nicht geteilt werden.", { kind: "error" });
      }
    });
  }

  function closeLeaveGameDialog(){
    try {
      const dialog = document.getElementById("leaveGameDialog");
      const backdrop = document.getElementById("leaveGameBackdrop");
      if (dialog) dialog.hidden = true;
      if (backdrop) backdrop.hidden = true;
      document.body.classList.remove("leave-dialog-open");
      document.documentElement.classList.remove("leave-dialog-open");
    } catch {}
  }

  function openLeaveGameDialog(){
    try {
      const dialog = document.getElementById("leaveGameDialog");
      const backdrop = document.getElementById("leaveGameBackdrop");
      const text = document.getElementById("leaveGameText");
      if (!dialog || !backdrop) return;
      closeChatSheet();
      closeRulesSheet();
      const holdFor = pauseDurationLabel(sb);
      if (text) {
        text.textContent = `Pause hält das Spiel bis zu ${holdFor} offen. Zur Lobby bricht das Spiel ab und schickt alle zurück.`;
      }
      dialog.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("leave-dialog-open");
      document.documentElement.classList.add("leave-dialog-open");
      const pauseBtn = document.getElementById("leavePauseBtn");
      setTimeout(() => {
        try { (pauseBtn || dialog).focus({ preventScroll: true }); }
        catch { (pauseBtn || dialog).focus(); }
      }, 0);
    } catch {}
  }

  function bindLeaveGameDialog(){
    try {
      const pauseBtn = document.getElementById("leavePauseBtn");
      const abortBtn = document.getElementById("leaveAbortBtn");
      const stayBtn = document.getElementById("leaveStayBtn");
      const backdrop = document.getElementById("leaveGameBackdrop");
      const who = () => (myName || "Spieler").trim();
      if (pauseBtn && !pauseBtn._bound) {
        pauseBtn._bound = true;
        pauseBtn.addEventListener("click", () => {
          if (window._pauseRequested) return;
          window._pauseRequested = true;
          safeSend(ws, { action: "pause_game", by: who() });
          closeLeaveGameDialog();
          setTimeout(() => {
            if (window._pauseRequested) {
              window._fatalWsClose = true;
              location.href = "/";
            }
          }, 600);
        });
      }
      if (abortBtn && !abortBtn._bound) {
        abortBtn._bound = true;
        abortBtn.addEventListener("click", () => {
          if (window._abortRequested) return;
          window._abortRequested = true;
          safeSend(ws, { action: "end_game", by: who() });
          closeLeaveGameDialog();
        });
      }
      if (stayBtn && !stayBtn._bound) {
        stayBtn._bound = true;
        stayBtn.addEventListener("click", closeLeaveGameDialog);
      }
      if (backdrop && !backdrop._bound) {
        backdrop._bound = true;
        backdrop.addEventListener("click", closeLeaveGameDialog);
      }
      if (!window.__rt_leaveDialogEscapeBound) {
        window.__rt_leaveDialogEscapeBound = true;
        window.addEventListener("keydown", (e) => {
          const dialog = document.getElementById("leaveGameDialog");
          if (e.key === "Escape" && dialog && !dialog.hidden) closeLeaveGameDialog();
        });
      }
    } catch {}
  }

  function syncRoomLayoutSoon({ scrollTop = false } = {}){
	    requestAnimationFrame(() => {
	      try {
	        syncChatWidth();
	        syncSideChatAnchor();
	        syncReactionsMount();
	        applyAnnounceModeButtonVisibility(mount);
        const grid = document.querySelector("#scoreOut .players-grid");
        if (scrollTop && grid) grid.scrollLeft = 0;
        if (scrollTop) {
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        }
      } catch {}
    });
  }

  function normalizeTransientLayoutForAdmin({ scrollTop = false } = {}){
    try {
      announcePickMode = false;
      closeChatSheet();
      $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
      _userScrollOverride = false;
      if (_pendingFollowTimer) {
        try { clearTimeout(_pendingFollowTimer); } catch {}
        _pendingFollowTimer = null;
      }
      syncRoomLayoutSoon({ scrollTop });
    } catch {}
  }

  // Das Ansage-Fenster ist nur direkt nach Wurf 1 für den aktuellen Spieler offen.
