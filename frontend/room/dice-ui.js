  function wireDiceBar() {
    if (!mount._disabledReasonBound) {
      mount._disabledReasonBound = true;
      mount.addEventListener("pointerdown", event => {
        const button = event.target.closest("#diceBar button:disabled, #requestCorrectionBtn:disabled");
        if (!button) return;
        const reason = button.title || "Diese Aktion ist gerade nicht verfügbar.";
        showToast(reason, { kind: "info", duration: 2400 });
      }, true);
    }
    if (IS_SPECTATOR) {
      const rollBtn0 = $("#rollBtnInline", mount);
      if (rollBtn0) { rollBtn0.disabled = true; rollBtn0.title = "Zuschauer können nicht würfeln"; }
      $$("#diceBar .die", mount).forEach(btn => { btn.style.pointerEvents = "none"; btn.title = "Nur Spieler"; btn.classList.remove("shaking"); });
      const reqBtn0 = $("#requestCorrectionBtn", mount);
      if (reqBtn0) { reqBtn0.disabled = true; reqBtn0.title = "Nur Spieler"; }
      return;
    }
    const rollBtn = $("#rollBtnInline", mount);

    const quickActions = $("#mobileRowQuickActions", mount);
    if (quickActions && !quickActions._bound) {
      quickActions._bound = true;
      quickActions.addEventListener("click", event => {
        const button = event.target.closest(".mobile-row-quick-button");
        if (!button || button.disabled) return;
        const availability = getQuickEntryAvailability(sb, button.dataset.quickField);
        if (!availability.usable || !availability.cell) {
          syncActionButtons(sb);
          return;
        }
        availability.cell.click();
      });
    }

    // Ein Button setzt eine neue Ansage oder hebt die aktive Ansage wieder auf.
    const announceBtn = $("#announceBtnInline", mount);
    if (announceBtn && !announceBtn._bound){
      announceBtn._bound = true;
      announceBtn.addEventListener("click", () => {
        if (!sb) return;
        const availability = getAnnounceAvailability(sb);
        if (!availability.usable) {
          syncActionButtons(sb);
          return;
        }
        const state = announceBtn.dataset.state || "announce";

        if (state === "unannounce" && sb?._announced_row4){
          safeSend(ws, { action: "unannounce_row4" });
          return;
        }
        announcePickMode = !announcePickMode;
        applyAnnounceModeButtonVisibility(mount);
        renderFromSnapshot(sb);
      });
    }

    const announcePicker = $("#mobileAnnouncePicker", mount);
    if (announcePicker && !announcePicker._bound) {
      announcePicker._bound = true;
      announcePicker.addEventListener("click", (event) => {
        const option = event.target.closest(".mobile-announce-option");
        if (!option || option.disabled || !announcePickMode || !announceWindowOpen(sb)) return;
        const field = option.dataset.field;
        if (!field) return;
        if (safeSend(ws, { action: "announce_row4", field })) {
          closeAnnouncePickMode();
        }
      });
    }

    if (!document._announceOutsideBound) {
      document._announceOutsideBound = true;
      document.addEventListener("click", (event) => {
        if (!announcePickMode || userGameplayPreferences().announceSelectionMode !== "overlay") return;
        if (event.target.closest("#mobileAnnouncePicker, #announceBtnInline")) return;
        closeAnnouncePickMode({ rerender:true });
      });
    }

    if (rollBtn && !rollBtn._shakeBound) {
      rollBtn._shakeBound = true;
      rollBtn.addEventListener("click", () => {
        requestRoll({ animate: true });
      });
    }

    $$("#diceBar .die", mount).forEach(btn => {
      const adminDice = getSuperadminDiceAvailability(sb);
      if (sb?._superadmin_active && !adminDice.usable) {
        btn.disabled = true;
        btn.title = "Während Superadmin-Edit gesperrt";
        btn.classList.remove("shaking");
        return;
      }
      if (superadminState.active && adminDice.usable) {
        btn.disabled = false;
        btn.title = "Superadmin: Würfelwert sofort setzen";
        btn.classList.add("superadmin-die-editable");
      } else {
        btn.classList.remove("superadmin-die-editable");
      }
      if (btn._holdBound) return;
      btn._holdBound = true;
      btn.addEventListener("click", () => {
        btn.classList.remove("shaking");

        if (superadminState.active) {
          const availability = getSuperadminDiceAvailability(sb);
          if (!availability.usable) return;
          const index = Number(btn.dataset.i);
          const current = Number(sb?._dice?.[index] || 0);
          const next = prompt(`Würfel ${index + 1}: neue Augenzahl (1–6)`, String(current || 1));
          if (next === null) return;
          const value = Number(String(next).trim());
          if (!Number.isInteger(value) || value < 1 || value > 6) {
            alert("Bitte eine ganze Augenzahl zwischen 1 und 6 eingeben.");
            return;
          }
          safeSend(ws, { action: "superadmin_set_die", index, value });
          return;
        }

        // Blockiere Hold für "leere" Würfel (Wert 0)
        const i = Number(btn.dataset.i);
        const val = Array.isArray(sb?._dice) ? Number(sb._dice[i] || 0) : 0;
        if (!val) {
          // Sicherheitsnetz: ggf. versehentlich gesetzte UI-Zustaende entfernen
          btn.classList.remove("held");
          return;
        }

        const iAmTurn = (sb?._turn && String(sb._turn.player_id) === String(myId));
        if (!iAmTurn || (sb?._correction?.active)) return;

        // Den Hold sofort darstellen. Zuvor wurde die Markierung erst mit dem
        // Server-Snapshot sichtbar, was sich besonders mobil verzögert anfühlte.
        const nextHeld = !btn.classList.contains("held");
        btn.classList.toggle("held", nextHeld);
        btn.setAttribute("aria-pressed", String(nextHeld));

        const holds = $$("#diceBar .die", mount).map(b => b.classList.contains("held"));
        if (!safeSend(ws, { action: "set_hold", holds })) {
          // Ohne offene Verbindung bleibt kein Zustand stehen, den der Server
          // nie erhalten hat.
          btn.classList.toggle("held", !nextHeld);
          btn.setAttribute("aria-pressed", String(!nextHeld));
        }
      });
    });

    const reqBtn = $("#requestCorrectionBtn", mount);
    if (reqBtn && !reqBtn._bound) {
      reqBtn._bound = true;
      reqBtn.addEventListener("click", () => safeSend(ws, { action: "request_correction" }));
    }

    if (!document._escCorrBound) {
      document._escCorrBound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && sb?._correction?.active && String(sb._correction.player_id) === String(myId)) {
          safeSend(ws, { action: "cancel_correction" });
        }
      });
    }
  }

  // --- Grid-Klicks (mit 0-Confirm) ---
  /**
   * Aktiviert 0-Confirm-Klicks im Scoreboard-Grid. Prüft lokal Sonderfälle
   * wie Poker-Zockerregel für Confirm-Dialoge; Server bleibt autoritativ.
   */
