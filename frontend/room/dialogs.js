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
      const rankLegendOpenBtn = document.getElementById("rankLegendSheetOpen");
      const closeBtn = document.getElementById("rulesSheetClose");
      const backdrop = document.getElementById("rulesSheetBackdrop");
      if (openBtn && !openBtn._bound) {
        openBtn._bound = true;
        openBtn.addEventListener("click", (e) => {
          e.preventDefault();
          openRulesSheet();
        });
      }
      if (rankLegendOpenBtn && !rankLegendOpenBtn._bound) {
        rankLegendOpenBtn._bound = true;
        rankLegendOpenBtn.addEventListener("click", event => {
          event.preventDefault();
          openRankLegendSheet();
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

  function bindRoomHeaderMenu(){
    const toggle = document.getElementById("roomHeaderMenuToggle");
    const panel = document.getElementById("roomHeaderMenuPanel");
    const container = toggle?.closest(".room-header-overflow");
    if (!toggle || !panel || !container || toggle._bound) return;
    toggle._bound = true;

    const isOpen = () => !panel.hidden;
    const menuItems = () => [...panel.querySelectorAll('[role="menuitem"]')]
      .filter(item => !item.disabled && item.getClientRects().length);
    const close = ({ restoreFocus = false } = {}) => {
      if (!isOpen()) return;
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (restoreFocus) {
        try { toggle.focus({ preventScroll: true }); } catch { toggle.focus(); }
      }
    };
    const open = () => {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      const [first] = menuItems();
      if (first) {
        try { first.focus({ preventScroll: true }); } catch { first.focus(); }
      }
    };

    toggle.addEventListener("click", () => {
      if (isOpen()) close();
      else open();
    });
    panel.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest('[role="menuitem"]')) close();
    });
    panel.addEventListener("keydown", event => {
      const items = menuItems();
      const current = event.target instanceof Element ? items.indexOf(event.target.closest('[role="menuitem"]')) : -1;
      if (event.key === "Escape") {
        event.preventDefault();
        close({ restoreFocus: true });
        return;
      }
      if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
          : event.key === "ArrowUp" ? (current <= 0 ? items.length - 1 : current - 1)
            : (current + 1) % items.length;
      try { items[next].focus({ preventScroll: true }); } catch { items[next].focus(); }
    });
    document.addEventListener("pointerdown", event => {
      if (isOpen() && event.target instanceof Node && !container.contains(event.target)) close();
    });
  }

  let rankLegendPreviousFocus = null;
  let rankLegendRequestId = 0;

  function rankLegendText(value){
    return window.ZDWA_I18N?.t?.(value) || value;
  }

  function rankLegendNumber(value){
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return new Intl.NumberFormat(window.ZDWA_I18N?.locale?.() || "de-CH", {
      maximumFractionDigits: 0,
    }).format(Math.max(0, Math.trunc(numeric)));
  }

  function rankLegendKey(value){
    return String(value || "newbie").replace(/[^a-z0-9-]/gi, "") || "newbie";
  }

  function rankLegendStars(value){
    const count = Math.max(0, Math.min(5, Math.trunc(Number(value) || 0)));
    return count ? "★".repeat(count) : "☆";
  }

  function ensureRankLegendSheet(){
    let sheet = document.getElementById("rankLegendSheet");
    if (sheet) return sheet;

    const backdrop = document.createElement("div");
    backdrop.id = "rankLegendSheetBackdrop";
    backdrop.className = "rules-sheet-backdrop rank-legend-sheet-backdrop";
    backdrop.hidden = true;

    sheet = document.createElement("section");
    sheet.id = "rankLegendSheet";
    sheet.className = "rules-sheet rank-legend-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "rankLegendSheetTitle");
    sheet.tabIndex = -1;
    sheet.hidden = true;

    const head = document.createElement("div");
    head.className = "rules-sheet-head";
    const title = document.createElement("h2");
    title.id = "rankLegendSheetTitle";
    title.textContent = rankLegendText("Rangabzeichen");
    const close = document.createElement("button");
    close.id = "rankLegendSheetClose";
    close.className = "small ghost rules-sheet-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", rankLegendText("Rangabzeichen schließen"));
    head.append(title, close);

    const content = document.createElement("div");
    content.className = "rank-legend-content";
    const introduction = document.createElement("p");
    introduction.id = "rankLegendSheetIntroduction";
    introduction.textContent = rankLegendText(
      "Sterne zeigen deinen Rang. Die Mindestwerte skalieren mit dem Erfolgskatalog.",
    );
    const current = document.createElement("section");
    current.id = "rankLegendSheetCurrent";
    current.className = "rank-legend-current";
    current.hidden = true;
    const summary = document.createElement("div");
    summary.id = "rankLegendSheetSummary";
    summary.className = "rank-legend-summary";
    const heading = document.createElement("h3");
    heading.id = "rankLegendSheetListTitle";
    heading.textContent = rankLegendText("Ränge und Mindestwerte");
    const list = document.createElement("ol");
    list.id = "rankLegendSheetList";
    list.className = "rank-legend-list";
    content.append(introduction, current, summary, heading, list);
    sheet.append(head, content);
    document.body.append(backdrop, sheet);

    close.addEventListener("click", closeRankLegendSheet);
    backdrop.addEventListener("click", closeRankLegendSheet);
    return sheet;
  }

  function closeRankLegendSheet(){
    const sheet = document.getElementById("rankLegendSheet");
    const backdrop = document.getElementById("rankLegendSheetBackdrop");
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.getElementById("rankLegendSheetOpen")?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("rank-legend-open");
    document.documentElement.classList.remove("rank-legend-open");
    const previousFocus = rankLegendPreviousFocus;
    rankLegendPreviousFocus = null;
    try { previousFocus?.focus?.({ preventScroll: true }); } catch {}
  }

  function selectedRankForPoints(ranks, points){
    const eligible = ranks.filter(rank => points >= Number(rank?.minimum_points || 0));
    return eligible.at(-1) || ranks[0] || null;
  }

  function renderRankLegendSheet(payload, context = {}){
    const sheet = ensureRankLegendSheet();
    const ranks = Array.isArray(payload?.ranks) ? payload.ranks : [];
    const maximum = Math.max(0, Math.trunc(Number(payload?.points_possible) || 0));
    const suppliedPoints = Number(context?.points);
    const viewerPoints = Number(payload?.current?.points);
    const points = Number.isFinite(suppliedPoints)
      ? Math.max(0, Math.trunc(suppliedPoints))
      : Number.isFinite(viewerPoints)
        ? Math.max(0, Math.trunc(viewerPoints))
        : null;
    const selected = points === null ? null : selectedRankForPoints(ranks, points);
    const owner = String(context?.owner || "").trim();
    const current = document.getElementById("rankLegendSheetCurrent");
    const summary = document.getElementById("rankLegendSheetSummary");
    const list = document.getElementById("rankLegendSheetList");
    const introduction = document.getElementById("rankLegendSheetIntroduction");
    if (!current || !summary || !list) return;
    if (introduction) {
      introduction.textContent = rankLegendText(
        "Sterne zeigen deinen Rang. Die Mindestwerte skalieren mit dem Erfolgskatalog.",
      );
    }

    current.replaceChildren();
    current.hidden = false;
    if (selected) {
      const title = document.createElement("strong");
      title.textContent = owner ? `${rankLegendText("Rang von")} ${owner}` : rankLegendText("Dein Rang");
      const description = document.createElement("p");
      description.textContent = `${rankLegendStars(selected.stars)} ${rankLegendText(selected.title || "Newbie")} · ${rankLegendNumber(points)} / ${rankLegendNumber(maximum)} ${rankLegendText("Ehrenberg-Marken")}`;
      current.append(title, description);
    } else {
      const description = document.createElement("p");
      description.textContent = rankLegendText(
        "Melde dich an oder öffne ein Rangabzeichen eines Spielers, um den aktuellen Stand zu sehen.",
      );
      current.append(description);
    }

    summary.replaceChildren();
    for (const [label, value] of [
      [rankLegendText("Aktuell möglich"), `${rankLegendNumber(maximum)} ${rankLegendText("Ehrenberg-Marken")}`],
      [rankLegendText("Rangstufen"), String(ranks.length)],
    ]) {
      const stat = document.createElement("div");
      stat.className = "rank-legend-stat";
      const caption = document.createElement("small");
      caption.textContent = label;
      const amount = document.createElement("strong");
      amount.textContent = value;
      stat.append(caption, amount);
      summary.appendChild(stat);
    }

    list.replaceChildren(...ranks.map(rank => {
      const item = document.createElement("li");
      const key = rankLegendKey(rank?.key);
      item.className = `rank-legend-row${selected?.key === rank?.key ? " is-current" : ""}`;
      const insignia = document.createElement("span");
      insignia.className = `rank-legend-insignia rank-legend-insignia--${key}`;
      insignia.textContent = rankLegendStars(rank?.stars);
      insignia.setAttribute("aria-label", `${rankLegendNumber(rank?.stars)} ${rankLegendText("Sterne")}`);
      const title = document.createElement("span");
      title.className = "rank-legend-title";
      const name = document.createElement("strong");
      name.textContent = rankLegendText(rank?.title || "Newbie");
      const detail = document.createElement("small");
      detail.textContent = rankLegendText("Ab diesem Wert trägst du dieses Rangabzeichen.");
      title.append(name, detail);
      const minimum = document.createElement("span");
      minimum.className = "rank-legend-minimum";
      minimum.textContent = `${rankLegendText("ab")} ${rankLegendNumber(rank?.minimum_points)} ${rankLegendText("Ehrenberg-Marken")}`;
      item.append(insignia, title, minimum);
      return item;
    }));
    sheet.removeAttribute("aria-busy");
  }

  async function openRankLegendSheet(context = {}){
    closeChatSheet();
    closeRulesSheet();
    const sheet = ensureRankLegendSheet();
    const backdrop = document.getElementById("rankLegendSheetBackdrop");
    rankLegendPreviousFocus = document.activeElement;
    sheet.hidden = false;
    sheet.setAttribute("aria-busy", "true");
    if (backdrop) backdrop.hidden = false;
    document.getElementById("rankLegendSheetOpen")?.setAttribute("aria-expanded", "true");
    document.body.classList.add("rank-legend-open");
    document.documentElement.classList.add("rank-legend-open");
    const close = document.getElementById("rankLegendSheetClose");
    setTimeout(() => {
      try { (close || sheet).focus({ preventScroll: true }); } catch {}
    }, 0);

    const requestId = ++rankLegendRequestId;
    try {
      const response = await fetch("/api/achievement-ranks", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (requestId !== rankLegendRequestId) return;
      renderRankLegendSheet(payload, context);
    } catch {
      if (requestId !== rankLegendRequestId) return;
      const introduction = document.getElementById("rankLegendSheetIntroduction");
      if (introduction) introduction.textContent = rankLegendText("Ranglegende konnte nicht geladen werden.");
      sheet.removeAttribute("aria-busy");
    }
  }

  if (!window.__rt_rankLegendEscapeBound) {
    window.__rt_rankLegendEscapeBound = true;
    window.addEventListener("keydown", event => {
      const sheet = document.getElementById("rankLegendSheet");
      if (event.key === "Escape" && sheet && !sheet.hidden) {
        event.preventDefault();
        closeRankLegendSheet();
      }
    });
  }
  window.ZDWA_OPEN_RANK_LEGEND = openRankLegendSheet;

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
              location.href = zdwaPath("/");
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
