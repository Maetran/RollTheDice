  function wireGridClicks() {
    if (mount._gridBound) return;
    mount._gridBound = true;

    mount.addEventListener("click", async (e) => {
      if (IS_SPECTATOR) return;
      const totalEl = e.target.closest(".pc-total");
      if (totalEl && handleSuperadminTap(totalEl)) return;

      if (superadminState.active && handleSuperadminEditClick(e)) return;
      if (sb?._superadmin_active) return;

      const td = e.target.closest("td.cell.clickable");
      if (!td) return;
      const card = td.closest(".player-card");
      if (!card || !card.classList.contains("me")) return;
      const row   = Number(td.getAttribute("data-row"));
      const field = td.getAttribute("data-field");
      // Im Pick-Mode setzt der Klick auf eine freie ❗-Zelle die Ansage statt zu schreiben.
      if (announcePickMode) {
        if (!announceWindowOpen(sb)) return;
        if (userGameplayPreferences().announceSelectionMode !== "table") return;
        if (field !== "ang") return;
        if (!card.classList.contains("me")) return;
        if (td.textContent && td.textContent.trim().length > 0) return;

        const fieldKey = WRITABLE_MAP[row];
        if (!fieldKey) return;
        safeSend(ws, { action: "announce_row4", field: fieldKey });
        closeAnnouncePickMode();
        return;
      }
      if (!Number.isFinite(row) || !field) return;

      const correctionActive = !!(sb?._correction?.active);
      const iAmCorrector = correctionActive && String(sb._correction.player_id) === String(myId);

      // 0-Confirm (Clientseitig)
      const fieldKey    = WRITABLE_MAP[row];
      const diceForEval = iAmCorrector && Array.isArray(sb?._correction?.dice)
        ? sb._correction.dice
        : (sb?._dice || []);

      if (fieldKey) {
        const points  = calculatePoints(fieldKey, diceForEval);
        const isPoker = fieldKey === "poker";

        // Poker mit Punkten? -> nur confirmen, WENN Punkte nach Zockerregel NICHT erlaubt wären
        if (isPoker && points > 0) {
          // Server-paritätische Prüfung (roll_index / first4oak_roll / ❗-Ansage)
          // Korrekturmodus: verwende die gespeicherten Meta-Daten aus _correction
          const turn    = sb?._turn || {};
          const corr    = sb?._correction || {};
          const rollIdx = iAmCorrector
            ? Number(corr.roll_index || 0)
            : Number(turn.roll_index || 0);
          let first4    = iAmCorrector
            ? (corr.first4oak_roll ?? null)
            : (turn.first4oak_roll ?? null);

          // has4/has5 aus aktuellen (oder Korrektur-)Würfeln
          const counts = {};
          for (const d of (diceForEval || [])) if (d > 0) counts[d] = (counts[d] || 0) + 1;
          const has4 = Object.values(counts).some(n => n >= 4);
          const has5 = Object.values(counts).some(n => n >= 5);

          const announcedPoker = (sb?._announced_row4 === "poker");
          const inAng = (field === "ang");

          // Fallback wie am Server: wenn 4 gleich & kein first4 gesetzt → first4 = aktueller Wurf
          if (has4 && !has5 && (first4 === null || first4 === undefined)) first4 = rollIdx;

          // Punkte erlaubt?
          let allowedPoints;
          if (iAmCorrector) {
            // Korrektur: Ansage spielt keine Rolle. Nutze gespeicherte Metadaten.
            allowedPoints = (has5 || (has4 && first4 && rollIdx === Number(first4)));
          } else if (inAng && announcedPoker) {
            // ❗ + Ansage "poker": Punkte in jedem Wurf mit 4/5 gleichen
            allowedPoints = (has4 || has5);
          } else {
            // ⬇︎／／⬆︎: nur im Wurf des ersten Vierlings ODER bei 5 gleichen
            allowedPoints = (has5 || (has4 && first4 && rollIdx === Number(first4)));
          }

          if (allowedPoints) {
            // Legal → ohne Prompt normal schreiben (KEIN strike)
            if (iAmCorrector) {
              safeSend(ws, { action: "write_field_correction", row, field });
            } else {
              safeSend(ws, { action: "write_field", row, field });
            }
          } else {
            // Nicht legal → Confirm zum Streichen
            const ok = await askForWriteConfirmation({
              title: "Poker streichen?",
              message: 'Nach „zocken“ darf ein Poker nicht mehr geschrieben werden. Willst du das Feld wirklich mit 0 Punkten eintragen?',
              confirmLabel: "Streichen",
              danger: true,
            });
            if (!ok) return; // Spieler darf neu wählen
            if (iAmCorrector) {
              safeSend(ws, { action: "write_field_correction", row, field, strike: true });
            } else {
              safeSend(ws, { action: "write_field", row, field, strike: true });
            }
          }
          return;
        }

        // Generelle Reihenfolge-Prüfung für ⬇︎/⬆︎: wenn nicht „dran“, dann Aktion unterbinden
        if (field === "down" || field === "up") {
          // Reihenfolge lokal prüfen wie am Server (_next_required_row)
          const ORDER_DOWN = [0,1,2,3,4,5,9,10,12,13,14,15];
          const order = field === "down" ? ORDER_DOWN : ORDER_DOWN.slice().reverse();

          // Board bestimmen (Team oder Einzel)
          let board = {};
          const mode = String(sb?._mode || "").toLowerCase();
          if (mode === "2v2" && Array.isArray(sb?._teams)) {
            const myTeam = (sb._teams.find(t => (t.members || []).some(m => String(m) === String(myId))) || {}).id;
            board = (sb._scoreboards_by_team && myTeam) ? (sb._scoreboards_by_team[myTeam] || {}) : {};
          } else {
            board = (sb?._scoreboards?.[myId]) || {};
          }

          const filled = new Set(
            Object.keys(board)
              .filter(k => k.endsWith(`,${field}`))
              .map(k => parseInt(k.split(",")[0], 10))
              .filter(Number.isFinite)
          );
          const nextRow = order.find(r => !filled.has(r));

          if (Number.isFinite(nextRow) && row !== nextRow) {
            // Nicht „dran“ -> keinerlei Aktion; Strike-Dialog NICHT anzeigen.
            return;
          }
        }

        // Nur wenn der berechnete Wert wirklich 0 ist, nachfragen (Strike).
        // Hinweis: Bei ⬇︎/⬆︎ wurde oben bereits auf „dran“ geprüft und ggf. abgebrochen.
        if (points === 0) {
          const ok = await askForWriteConfirmation({
            title: "Feld streichen?",
            message: "Dieses Ergebnis gibt 0 Punkte. Möchtest du das Feld wirklich streichen?",
            confirmLabel: "Streichen",
            danger: true,
          });
          if (!ok) return;
        }
      }

      if (iAmCorrector) {
        safeSend(ws, { action: "write_field_correction", row, field });
      } else {
        safeSend(ws, { action: "write_field", row, field });
      }
    });
  }
