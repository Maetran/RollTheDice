  // ---------- Render & Events ----------
  /**
   * Gibt allen verbundenen Clients einen kurzen visuellen Impuls, wenn das
   * 60er-Feld erfolgreich gewertet wurde. Gestrichene 60er lösen nichts aus.
   */
  function celebrateSixtyScore(scoreEvent) {
    if (String(scoreEvent?.field || "") !== "60" || Number(scoreEvent?.points || 0) <= 0) return;
    const page = document.body;
    if (!page) return;
    const duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 500;
    if (sixtyCelebrationTimer) clearTimeout(sixtyCelebrationTimer);
    clearAutoRollRetry();
    clearRollAnimation();
    sixtyCelebrationUntil = performance.now() + duration;
    page.classList.remove("sixty-score-celebration");
    void page.offsetWidth;
    page.classList.add("sixty-score-celebration");
    sixtyCelebrationTimer = window.setTimeout(() => {
      page.classList.remove("sixty-score-celebration");
      sixtyCelebrationUntil = 0;
      sixtyCelebrationTimer = null;
      syncActionButtons(sb);
    }, duration);
  }

  function sixtyCelebrationRemaining() {
    return Math.max(0, sixtyCelebrationUntil - performance.now());
  }

/**
 * Rendert die komplette Room-Ansicht aus einem Server-Snapshot.
 * Aktualisiert Dicebar, Scoreboards, Vorschläge, Reactions und UI-Zustände
 * (Ansage, Korrektur, Auto-Follow, Mobile-Layout).
 * @param {object} snapshot - Server-Snapshot der aktuellen Spielsituation
 */
function renderFromSnapshot(snapshot) {
    settlePendingRollFromSnapshot(snapshot);
    const turnPid   = snapshot?._turn?.player_id || null;
    const iAmTurn   = turnPid && String(turnPid) === String(myId);
    const isHC      = !!(snapshot && snapshot._hardcore);
    // aktuelle Scrollposition des alten Grids sichern (wichtig fuer Mobile)
    const _oldGrid = document.querySelector("#scoreOut .players-grid");
    const _oldScrollLeft = _oldGrid ? _oldGrid.scrollLeft : 0;
    const rollsUsed = snapshot?._rolls_used ?? 0;
    const rollsMax  = snapshot?._rolls_max ?? 3;
    const announced = snapshot?._announced_row4 || null;
    if (lastHapticTurnPid !== null && String(lastHapticTurnPid) !== String(turnPid) && iAmTurn) {
      haptic([18, 45, 18]);
    }
    lastHapticTurnPid = turnPid;
    syncScreenWakeLock(snapshot);

    window.renderScoreboard(mount, snapshot, {
      myPlayerId: myId,
      iAmTurn,
      rollsUsed,
      rollsMax,
      announcedRow4: announced,
      canRequestCorrection: canRequestCorrection(snapshot)
    });
    syncBoardCountClasses();
    syncHeaderTurnStatus(snapshot);
    syncActionFeedback(snapshot);
    applyRollAnimation();

    wireDiceBar();
    wireGridClicks();
    applySuperadminUiState();
    ensureKeybindings(); // alle Hotkeys hier

    // --- Auto-Beenden des Pick-Modes außerhalb des Fensters ---
    try{
      const ann = getAnnounceAvailability(snapshot);
      if (!announceWindowOpen(snapshot) || !ann.usable || ann.mode !== "announce") {
        if (announcePickMode) {
          announcePickMode = false;
          $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
          // Sichtbarkeit des Würfeln-Buttons nach Pick-Mode beenden zurücksetzen
          if (!isHC) applyAnnounceModeButtonVisibility(mount);
        }
      }
    } catch {}

    // Ansage-/Würfeln-Buttons aus demselben Benutzbarkeitsmodell setzen.
    syncActionButtons(snapshot);
    renderAnnouncePicker(snapshot);
    scheduleAutoWriteAnnouncedField(snapshot);
    renderSuperadminLockNotice(snapshot);
    renderMultiplayerPauseNotice(snapshot);

    // Hinweiszeile (falls vorhanden)
    try{
      const hint = document.getElementById("announceHint");
      if (hint){
        const blockRoll = !isHC && isRollingBlocked(snapshot);
        hint.textContent = blockRoll ? "Bitte ein ❗-Feld ansagen, bevor du weiter würfelst." : "";
      }
    } catch {}

    // Während des Ansage-Pick-Modes den Würfeln-Button unsichtbar schalten,
    // ohne das Layout zu verschieben (visibility statt display)
    applyAnnounceModeButtonVisibility(mount);

    // Im Pick-Mode nur freie, beschreibbare ❗-Zellen des eigenen Boards markieren.
    try{
      $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));

      if (!isHC && announcePickMode && userGameplayPreferences().announceSelectionMode === "table"){
        const boardRoot = $(".player-card.me");

        if (boardRoot){
          const tds = $$("table.grid tbody tr td.cell:nth-child(5)", boardRoot);
          tds.forEach(td => {
            const hasVal    = td.textContent.trim().length > 0;
            const isCompute = td.classList.contains("compute");
            if (!hasVal && !isCompute) {
              td.classList.add("announce-pickable");
            }
          });
        }
      }
    } catch {}

    // Emoji-FAB nach jedem Render an den passenden Mount setzen:
    // Desktop im Header, mobile links neben der Chatbar.
    if (window.emojiUI && typeof window.emojiUI.init === "function") {
      window.emojiUI.init({ mount: currentReactionsMount(), ws, getMyName: () => myName });
    }

    // Suggestions (informativ), aber erst nach Ende der lokalen Roll-Animation.
    renderSuggestionsForSnapshot(snapshot);

    // 1P Auto-Roll
    if (snapshot._auto_single && iAmTurn) requestRoll({ animate: true, auto: true });

	    // Chat-Breite angleichen
	    syncChatWidth();
	    syncSideChatAnchor();

	    // --- Scrollposition nach Re-Render bewahren, ausser bei gewolltem Fokuswechsel (Write+TurnChange)
    const filledNow = countFilledWritableCells(snapshot);
    const turnChanged = String(_lastTurnPid) !== String(turnPid);
    const wroteHappened = (_lastFilledCount !== null) ? (filledNow > _lastFilledCount) : false;

    const _newGrid = document.querySelector("#scoreOut .players-grid");
    // Immer die vorherige Scrollposition wiederherstellen, solange der Nutzer
    // nicht manuell uebersteuert hat. So bleibt der zuletzt sichtbare Board-Fokus
    // fuer ~1s bestehen, bevor der Auto-Follow greift – fuer alle Nutzer.
    if (_newGrid) {
      _newGrid.scrollLeft = _oldScrollLeft;
    }

    // --- Swipe-Override Binding (einmalig pro DOM-Aufbau) ---
    bindSwipeOverride();

    // --- Auto-Follow auf Mobile (Option D) ---
    autoFollowTurn(snapshot);
  }
    // --- Auto-Follow & Swipe-Override Helpers ---
