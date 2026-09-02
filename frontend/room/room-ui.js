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
    if (!snapshot || snapshot._finished) return "Spiel wird geladen …";
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

  async function showGameResults(snapshot, unlockedAchievements = []) {
    if (window._resultsShown) return;
    window._resultsShown = true;
    window._fatalWsClose = true;

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
      if (!isTeam) return entry.player || entry.name || "Spieler";
      const teamName = entry.name || entry.team || entry.team_name || "Team";
      const members = entry.members || entry.players || [];
      return members.length ? `${teamName} (${humanList(members)})` : teamName;
    };
    const lines = results.length
      ? results.map((entry, index) => `${index + 1}. ${labelFor(entry)}${Number.isFinite(entry?.total) ? ` – ${entry.total} Punkte` : ""}`)
      : ["Das Spiel wurde erfolgreich beendet."];
    const achievementLines = unlockedAchievements.flatMap(achievement => [
      `🏆 Erfolg erreicht: ${achievement.name || "Erfolg"}`,
      achievement.description || "",
    ]).filter(Boolean);

    const choice = window.ZDWA_UI?.dialog
      ? await window.ZDWA_UI.dialog({
          title: achievementLines.length ? "Erfolg erreicht!" : (results.length > 1 ? "Endstand" : "Spiel beendet"),
          message: [...lines, ...achievementLines].join("\n"),
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
        const nextRoom = new URL(`/spiel/${encodeURIComponent(created.game_id)}`, location.origin);
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
    location.href = "/";
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
