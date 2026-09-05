  function setConnectionStatus(state, message, { hideAfter = 0 } = {}) {
    const element = document.getElementById("connectionStatus");
    if (!element) return;
    if (connectionHideTimer) {
      clearTimeout(connectionHideTimer);
      connectionHideTimer = null;
    }
    element.dataset.state = state;
    element.textContent = window.ZDWA_I18N?.t?.(message) || message;
    element.hidden = false;
    if (hideAfter > 0) {
      connectionHideTimer = setTimeout(() => { element.hidden = true; }, hideAfter);
    }
  }

  function turnPlayerName(snapshot) {
    const turnId = String(snapshot?._turn?.player_id || "");
    const player = (snapshot?._players || []).find(item => String(item?.id || "") === turnId);
    return player?.name || snapshot?._turn?.name || "";
  }

  function actionGuidance(snapshot) {
    if (!snapshot) return "Spiel wird geladen …";
    if (snapshot._finished) {
      return snapshot._finalization_pending || snapshot.finalization_pending
        ? "Spiel wird ausgewertet …"
        : "Spiel wird abgeschlossen …";
    }
    if (window.__rt_writeRequestPending) return "Feld wird eingetragen …";
    if (snapshot._paused) return snapshot._pause_reason || "Spiel ist pausiert.";
    if (IS_SPECTATOR) return "Du schaust diesem Spiel zu.";
    if (snapshot?._superadmin_active) return "Aktionen sind während der Bearbeitung pausiert.";
    const iAmTurn = snapshot?._turn && String(snapshot._turn.player_id) === String(myId);
    if (!iAmTurn) {
      const name = turnPlayerName(snapshot);
      return name ? `Warte auf ${name}.` : "Warte auf den nächsten Zug.";
    }
    if (snapshot?._correction?.active) return "Wähle das korrigierte Feld oder brich mit Esc ab.";
    const rolls = Number(snapshot?._rolls_used || 0);
    const max = Number(snapshot?._rolls_max || 3);
    if (rolls < 1) return "Du bist am Zug – jetzt würfeln.";
    const roll = getRollAvailability(snapshot);
    if (roll.code === "announce_required") return "Vor dem Weiterwürfeln ein ❗-Feld ansagen.";
    if (rolls >= max) return "Wähle jetzt ein erlaubtes Feld zum Eintragen.";
    return "Würfel halten, weiterwürfeln oder ein erlaubtes Feld eintragen.";
  }

  function syncActionFeedback(snapshot) {
    const element = document.getElementById("actionFeedback");
    if (!element) return;
    element.textContent = window.ZDWA_I18N?.t?.(actionGuidance(snapshot)) || actionGuidance(snapshot);
  }

  function achievementUnlockQueue(unlockedAchievements) {
    if (!Array.isArray(unlockedAchievements)) return [];
    const seen = new Set();
    return unlockedAchievements.filter(achievement => {
      if (!achievement || typeof achievement !== "object") return false;
      const key = String(achievement.key || achievement.name || "").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function achievementUnlockMessage(achievement, index, total) {
    const translate = value => window.ZDWA_I18N?.t?.(value) || String(value ?? "");
    const points = Math.max(0, Math.trunc(Number(achievement?.points) || 0));
    const lines = [translate(achievement?.name || "Erfolg")];
    if (achievement?.description) lines.push(translate(achievement.description));
    if (points) lines.push(`+${points} ${translate("Ehrenberg-Marken")}`);
    if (total > 1) lines.push(`${index + 1} / ${total}`);
    return lines.join("\n\n");
  }

  async function acknowledgeAchievementUnlocks(unlockedAchievements) {
    const queue = achievementUnlockQueue(unlockedAchievements);
    for (const [index, achievement] of queue.entries()) {
      const message = achievementUnlockMessage(achievement, index, queue.length);
      let acknowledged = false;
      if (window.ZDWA_UI?.dialog) {
        try {
          await window.ZDWA_UI.dialog({
            title: "Erfolg erreicht!",
            message,
            kind: "achievement",
            dismissible: false,
            actions: [{ id: "acknowledge", label: "Weiter", className: "primary" }],
          });
          acknowledged = true;
        } catch (error) {
          console.warn("Achievement-Hinweis konnte nicht angezeigt werden:", error);
        }
      }
      // A final-result snapshot must never get stuck because the shared dialog
      // system is unavailable. `alert` still requires an explicit acknowledgement.
      if (!acknowledged) {
        try { window.alert(message); }
        catch (error) { console.warn("Achievement-Hinweis konnte nicht bestätigt werden:", error); }
      }
    }
  }

  function rankUpgradePayload(value) {
    const previous = value?.previous;
    const current = value?.current;
    if (!previous || !current || typeof previous !== "object" || typeof current !== "object") return null;
    if (!current.key || current.key === previous.key) return null;
    const previousMinimum = Number(previous.minimum_points);
    const currentMinimum = Number(current.minimum_points);
    if (!Number.isFinite(previousMinimum) || !Number.isFinite(currentMinimum) || currentMinimum <= previousMinimum) {
      return null;
    }
    return { previous, current };
  }

  function rankUpgradeMessage(value) {
    const rankUpgrade = rankUpgradePayload(value);
    if (!rankUpgrade) return "";
    const translate = text => window.ZDWA_I18N?.t?.(text) || String(text ?? "");
    const previousTitle = translate(rankUpgrade.previous.title || "Newbie");
    const currentTitle = translate(rankUpgrade.current.title || "Newbie");
    const stars = Math.max(1, Math.min(5, Math.trunc(Number(rankUpgrade.current.stars) || 0)));
    const points = Math.max(0, Math.trunc(Number(rankUpgrade.current.points) || 0));
    return [
      "✦".repeat(stars),
      `${translate("Neuer Rang erreicht!")} ${currentTitle}`,
      `${previousTitle} → ${currentTitle}`,
      `${points} ${translate("Ehrenberg-Marken")}`,
    ].join("\n\n");
  }

  async function acknowledgeAchievementRankUp(value) {
    const message = rankUpgradeMessage(value);
    if (!message) return;
    let acknowledged = false;
    if (window.ZDWA_UI?.dialog) {
      try {
        await window.ZDWA_UI.dialog({
          title: "LEVEL UP! ✨",
          message,
          kind: "level-up",
          dismissible: false,
          actions: [{ id: "acknowledge-level-up", label: "Weiter", className: "primary" }],
        });
        acknowledged = true;
      } catch (error) {
        console.warn("Rangaufstieg konnte nicht angezeigt werden:", error);
      }
    }
    // Keep the celebratory moment explicit even if the shared dialog is not
    // available. Just like achievement cards, a rank-up must be acknowledged.
    if (!acknowledged) {
      try { window.alert(`LEVEL UP! ✨\n\n${message}`); }
      catch (error) { console.warn("Rangaufstieg konnte nicht bestätigt werden:", error); }
    }
  }

  let pendingGameFinalization = null;

  function gameResultPresentation(snapshot) {
    const results = Array.isArray(snapshot?._results || snapshot?.results)
      ? (snapshot._results || snapshot.results)
      : [];
    const humanList = values => {
      const names = (values || []).filter(Boolean);
      if (names.length <= 1) return names[0] || "";
      return `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;
    };
    const labelFor = entry => {
      if (!entry) return "Unbekannt";
      const isTeam = entry.is_team || Array.isArray(entry.members) || entry.team || entry.team_name;
      if (!isTeam) {
        const name = entry.player || entry.name || "Spieler";
        const rank = entry.achievement_rank;
        if (!rank || typeof rank !== "object") return name;
        const stars = Math.max(0, Math.min(5, Math.trunc(Number(rank.stars) || 0)));
        const insignia = stars ? "★".repeat(stars) : "☆";
        const title = window.ZDWA_I18N?.t?.(rank.title || "Newbie") || rank.title || "Newbie";
        return `${name} · ${insignia} ${title}`;
      }
      const teamName = entry.name || entry.team || entry.team_name || "Team";
      const members = entry.members || entry.players || [];
      const memberLabels = members.map(member => {
        if (typeof member === "string") return member;
        const name = member?.name || member?.player || "Spieler";
        const rank = member?.achievement_rank;
        if (!rank || typeof rank !== "object") return name;
        const stars = Math.max(0, Math.min(5, Math.trunc(Number(rank.stars) || 0)));
        const insignia = stars ? "★".repeat(stars) : "☆";
        const title = window.ZDWA_I18N?.t?.(rank.title || "Newbie") || rank.title || "Newbie";
        return `${name} · ${insignia} ${title}`;
      });
      return memberLabels.length ? `${teamName} (${humanList(memberLabels)})` : teamName;
    };
    const lines = results.length
      ? results.map((entry, index) => `${index + 1}. ${labelFor(entry)}${Number.isFinite(entry?.total) ? ` – ${entry.total} Punkte` : ""}`)
      : ["Das Spiel wurde erfolgreich beendet."];
    return { results, lines };
  }

  function beginPendingGameFinalization(snapshot) {
    if (pendingGameFinalization) {
      pendingGameFinalization.snapshot = snapshot;
      return;
    }

    window._resultsShown = true;
    // Keep the socket recoverable while persistence and achievement evaluation
    // run. The server follows with a second terminal frame when that work is
    // complete; only then may the final actions be offered.
    window._fatalWsClose = false;
    setConnectionStatus("finalizing", "Spiel wird ausgewertet …");

    const { results, lines } = gameResultPresentation(snapshot);
    const state = { snapshot, pending: true, dialogPromise: null };
    pendingGameFinalization = state;
    if (window.ZDWA_UI?.dialog) {
      state.dialogPromise = window.ZDWA_UI.dialog({
        id: "game-finalization-pending",
        title: results.length > 1 ? "Endstand" : "Spiel beendet",
        message: `${lines.join("\n")}\n\n${window.ZDWA_I18N?.t?.("Erfolge werden geprüft …") || "Erfolge werden geprüft …"}`,
        kind: "success",
        dismissible: false,
        actions: [{
          id: "pending-finalization",
          label: "Erfolge werden geprüft …",
          className: "primary",
          disabled: true,
        }],
      }).catch(error => {
        console.warn("Endstand konnte während der Auswertung nicht geöffnet werden:", error);
      });
    }
  }

  async function completePendingGameFinalization(snapshot, unlockedAchievements, achievementRankUp) {
    const state = pendingGameFinalization;
    if (!state?.pending) return false;
    state.pending = false;
    pendingGameFinalization = null;
    window.ZDWA_UI?.dismiss?.("game-finalization-pending", "finalized");
    if (state.dialogPromise) {
      try { await state.dialogPromise; }
      catch (error) { console.warn("Auswertungsdialog konnte nicht geschlossen werden:", error); }
    }
    window._resultsShown = false;
    await showGameResults(snapshot, unlockedAchievements, { achievementRankUp });
    return true;
  }

  async function showGameResults(
    snapshot,
    unlockedAchievements = [],
    { finalizationPending = false, achievementRankUp = null } = {},
  ) {
    if (finalizationPending) {
      beginPendingGameFinalization(snapshot);
      return;
    }
    if (await completePendingGameFinalization(snapshot, unlockedAchievements, achievementRankUp)) return;
    if (window._resultsShown) return;
    window._resultsShown = true;
    window._fatalWsClose = true;
    setConnectionStatus("online", "Spiel beendet", { hideAfter: 1200 });

    const { results, lines } = gameResultPresentation(snapshot);

    // Achievements are acknowledged one by one before result actions become
    // available. They are presentation-only: the server has already persisted
    // and finalized the game before this local queue is opened.
    try {
      await acknowledgeAchievementUnlocks(unlockedAchievements);
    } catch (error) {
      console.warn("Achievement-Queue konnte nicht geöffnet werden:", error);
    }

    // A title change belongs to this end-of-game celebration too, but only
    // after every individual achievement has been acknowledged.
    try {
      await acknowledgeAchievementRankUp(achievementRankUp);
    } catch (error) {
      console.warn("Rangaufstieg konnte nicht geöffnet werden:", error);
    }

    const choice = window.ZDWA_UI?.dialog
      ? await window.ZDWA_UI.dialog({
          title: results.length > 1 ? "Endstand" : "Spiel beendet",
          message: lines.join("\n"),
          kind: "success",
          dismissible: false,
          actions: [
            { id: "lobby", label: "Zur Lobby", className: "ghost" },
            { id: "new", label: "Neue Runde", className: "primary" },
          ],
        })
      : "lobby";
    if (choice === "new") {
      try {
        const response = await fetch("/api/games", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(snapshot?._name || "Neue Runde"),
            mode: String(snapshot?._mode || "1"),
            hardcore: !!snapshot?._hardcore,
            pass: qs.pass || null,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const created = await response.json();
        if (!created?.game_id) throw new Error("missing_game_id");
        if (qs.pass) sessionStorage.setItem(`wuerfler_pass_${created.game_id}`, qs.pass);
        const nextRoom = new URL(zdwaPath(`/spiel/${encodeURIComponent(created.game_id)}`), location.origin);
        localStorage.setItem(`wuerfler_player_name_${created.game_id}`, myName || "Gast");
        location.href = nextRoom.toString();
      } catch (error) {
        await showNotice({
          title: "Neue Runde konnte nicht erstellt werden",
          message: "Bitte versuche es erneut oder kehre zur Lobby zurück.",
          kind: "error",
        });
        window._resultsShown = false;
        return showGameResults(snapshot);
      }
      return;
    }
    location.href = zdwaPath("/");
  }

  function userGameplayPreferences(){
    const preferences = authState?.user?.preferences || {};
    return {
      announceSelectionMode: preferences.announce_selection_mode === "table" ? "table" : "overlay",
      autoWriteAnnounced: preferences.auto_write_announced !== false,
      mobileRowQuickEntry: preferences.mobile_row_quick_entry === true,
      hapticFeedback: preferences.haptic_feedback === true,
      keepScreenAwake: preferences.keep_screen_awake === true,
    };
  }

  async function syncScreenWakeLock(snapshot = sb) {
    const shouldHold = userGameplayPreferences().keepScreenAwake
      && document.visibilityState === "visible"
      && !!snapshot
      && !snapshot._finished
      && !snapshot._aborted;
    if (!shouldHold) {
      if (screenWakeLock) {
        try { await screenWakeLock.release(); } catch {}
        screenWakeLock = null;
      }
      return;
    }
    if (screenWakeLock || !navigator.wakeLock?.request) return;
    try {
      screenWakeLock = await navigator.wakeLock.request("screen");
      screenWakeLock.addEventListener("release", () => { screenWakeLock = null; }, { once: true });
    } catch {}
  }

  document.addEventListener("visibilitychange", () => syncScreenWakeLock(sb));

  // Steuerung der Sichtbarkeit des Wuerfeln-Buttons im Ansage-Pick-Mode.
  // Wichtig: Wir verwenden `visibility:hidden` (nicht `display:none`),
  // damit der reservierte Platz erhalten bleibt und sich der Dice-Row-Layout
  // (Abstände/Wrap) *nicht* verschiebt.
  function applyAnnounceModeButtonVisibility(root){
    try{
      const rollBtn = root ? root.querySelector('#rollBtnInline') : null;
      if (!rollBtn) return;
      if (announcePickMode){
        rollBtn.style.visibility = 'hidden';
        rollBtn.style.pointerEvents = 'none';
      } else {
        rollBtn.style.visibility = '';
        rollBtn.style.pointerEvents = '';
      }
    }catch{}
  }

  function closeAnnouncePickMode({ rerender = false } = {}){
    announcePickMode = false;
    $$(".announce-pickable").forEach(td => td.classList.remove("announce-pickable"));
    const picker = document.getElementById("mobileAnnouncePicker");
    if (picker) picker.hidden = true;
    applyAnnounceModeButtonVisibility(mount);
    if (rerender && sb) renderFromSnapshot(sb);
    else if (sb) syncActionButtons(sb);
  }

  function renderAnnouncePicker(snapshot){
    const picker = document.getElementById("mobileAnnouncePicker");
    if (!picker) return;

    const availability = getAnnounceAvailability(snapshot);
    const visible = userGameplayPreferences().announceSelectionMode === "overlay"
      && announcePickMode
      && availability.usable
      && availability.mode === "announce";
    picker.hidden = !visible;
    if (!visible) {
      picker.replaceChildren();
      return;
    }

    const board = getMyBoard(snapshot);
    picker.replaceChildren(...ANNOUNCE_FIELDS.map((fields, rowIndex) => {
      const row = document.createElement("div");
      row.className = "mobile-announce-picker-row";
      row.setAttribute("aria-label", rowIndex === 0 ? "Zahlenfelder" : "Sonderfelder");
      fields.forEach(({ row: scoreRow, field, label }) => {
        const value = board?.[`${scoreRow},ang`];
        const filled = !(value === undefined || value === null || value === "");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mobile-announce-option";
        button.dataset.field = field;
        button.dataset.row = String(scoreRow);
        button.textContent = label;
        button.disabled = filled;
        button.setAttribute("aria-label", `${label} ansagen${filled ? " – bereits ausgefüllt" : ""}`);
        button.title = filled ? "Bereits ausgefüllt" : `${label} ansagen`;
        row.appendChild(button);
      });
      return row;
    }));
  }

  function autoAnnounceSnapshotKey(snapshot){
    const dice = Array.isArray(snapshot?._dice) ? snapshot._dice.join("") : "";
    return [
      snapshot?._turn?.player_id || "",
      snapshot?._turn?.roll_index || 0,
      snapshot?._rolls_used || 0,
      snapshot?._announced_row4 || "",
      dice
    ].join(":");
  }

  function isLastAllowedRoll(snapshot){
    const rollsUsed = Number(snapshot?._rolls_used || 0);
    const rollsMax = Number(snapshot?._rolls_max || 3);
    return rollsMax > 0 && rollsUsed >= rollsMax;
  }

  function scheduleAutoWriteAnnouncedField(snapshot){
    const announced = snapshot?._announced_row4 || null;
    const row = Object.keys(WRITABLE_MAP).find(key => WRITABLE_MAP[key] === announced);
    const turnPid = snapshot?._turn?.player_id || null;
    const board = getMyBoard(snapshot);
    const targetIsFree = row !== undefined && !Object.prototype.hasOwnProperty.call(board || {}, `${row},ang`);
    const shouldWrite = !IS_SPECTATOR
      && !snapshot?._finished
      && !snapshot?._paused
      && !snapshot?._superadmin_active
      && !snapshot?._correction?.active
      && String(turnPid) === String(myId)
      && !!announced
      && userGameplayPreferences().autoWriteAnnounced
      && isLastAllowedRoll(snapshot)
      && targetIsFree;

    if (!shouldWrite) {
      if (autoAnnounceWriteTimer) clearTimeout(autoAnnounceWriteTimer);
      autoAnnounceWriteTimer = null;
      autoAnnounceWriteKey = null;
      return;
    }

    const key = autoAnnounceSnapshotKey(snapshot);
    if (autoAnnounceWriteKey === key) return;
    if (autoAnnounceWriteTimer) clearTimeout(autoAnnounceWriteTimer);
    autoAnnounceWriteKey = key;
    // Erst den letzten Wurf vollständig anzeigen und danach noch eine kurze
    // Lesepause lassen, bevor das angesagte Feld den Zug automatisch beendet.
    const wait = Math.max(0, rollAnimationUntil - Date.now()) + AUTO_ANNOUNCE_WRITE_DELAY_MS;
    autoAnnounceWriteTimer = setTimeout(() => {
      autoAnnounceWriteTimer = null;
      if (!sb || autoAnnounceSnapshotKey(sb) !== key) return;
      const currentBoard = getMyBoard(sb);
      if (Object.prototype.hasOwnProperty.call(currentBoard || {}, `${row},ang`)) return;
      if (!safeSend(ws, { action:"write_field", row:Number(row), field:"ang" })) {
        autoAnnounceWriteKey = null;
      }
    }, wait);
  }
