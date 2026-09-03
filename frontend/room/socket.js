  // ---------- WebSocket ----------
  /**
   * Stellt die WebSocket-Verbindung her und verarbeitet Server-Events.
   * Verantwortlich für Join/Rejoin/Spectate, Snapshot-Handling,
   * Abbruch-Notices, Chat-Weiterleitung und Auto-Reconnect.
   */
  function connect() {
      // --- "Zurück zur Lobby" mit Auswahl: pausieren oder abbrechen ---
    bindRulesSheet();
    bindShareGameButton();
    bindLeaveGameDialog();
    (function bindBackToLobby() {
      const btn = document.getElementById("backToLobbyBtn");
      if (!btn || btn._bound) return;
      btn._bound = true;
      if (IS_SPECTATOR) {
        btn.textContent = "Lobby";
        btn.classList.remove("danger", "leave-game-trigger");
      } else {
        btn.setAttribute("aria-haspopup", "dialog");
        btn.setAttribute("aria-controls", "leaveGameDialog");
      }
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (IS_SPECTATOR) { location.href = "/"; return; }  // Zuschauer: nur verlassen
        openLeaveGameDialog();
      });
    })();
    setConnectionStatus(reconnectAttempts ? "reconnecting" : "connecting", reconnectAttempts ? "Verbindung wird wiederhergestellt …" : "Verbindung wird hergestellt …");
    ws = new WebSocket(wsURL(qs.game_id));

	    ws.addEventListener("open", () => {
	      reconnectAttempts = 0;
	      setConnectionStatus("online", "Verbunden", { hideAfter: 1400 });
	      initChat(ws, { meName: myName });
	      syncSideChatAnchor();
	      if (IS_SPECTATOR) {
        safeSend(ws, { action: "spectate_game", name: myName, pass: qs.pass });
      } else if (myId) {
        safeSend(ws, {
          action: "rejoin_game",
          player_id: myId,
          resume_token: localStorage.getItem(TOKEN_KEY) || "",
          pass: qs.pass
        });
      } else {
        safeSend(ws, { action: "join_game", name: myName, pass: qs.pass });
      }
    });

    ws.addEventListener("message", (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.auth) {
        authState = msg.auth;
        if (authState?.user?.username) myName = String(authState.user.username);
      }

      // Abbruch-Notice (kommt vor dem Snapshot)
      if (msg.notice && msg.notice.type === "ended") {
        window._lastEndedBy = msg.notice.by || null;
      }

      // Join-Response
      if (msg.player_id) {
        myId = String(msg.player_id);
        sessionStorage.setItem(PID_KEY, myId);
        localStorage.setItem(PID_KEY, myId);
        localStorage.setItem(PLAYER_NAME_KEY, myName);
        if (qs.pass) sessionStorage.setItem(PASS_KEY, qs.pass);
      }
      if (msg.resume_token) {
        localStorage.setItem(TOKEN_KEY, String(msg.resume_token));
      }
      if (msg.spectator_id) {
        mySpectatorId = String(msg.spectator_id);
      }
      if (msg.paused) {
        const label = msg.pause_remaining_label || pauseDurationLabel(sb);
        window._fatalWsClose = true;
        try { ws.close(1000); } catch {}
        showNotice({
          title: "Spiel pausiert",
          message: `Du kannst es innerhalb von ${label} wieder aufnehmen.`,
          kind: "info",
          buttonLabel: "Zur Lobby",
        }).finally(() => { location.href = "/"; });
        return;
      }

      // Fehler
      if (msg.error) {
        console.warn("Serverfehler:", msg.error);
        clearPendingWrite();
        if (rollRequestPending) {
          clearPendingRoll();
          clearRollAnimation();
          syncActionButtons(sb);
        }
        if (msg.fatal) {
          if (/Spieler-Sitzung nicht gefunden/i.test(String(msg.error || ""))) {
            localStorage.removeItem(PID_KEY);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(PID_KEY);
          }
          if (/Wiederaufnahme abgelehnt/i.test(String(msg.error || ""))) {
            localStorage.removeItem(PID_KEY);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(PID_KEY);
          }
          leaveRoomAfterFatalError(msg.error);
          return;
        }
        if (/passphrase/i.test(msg.error) || /pass/i.test(msg.error)) {
          leaveRoomAfterFatalError("Beitritt abgelehnt: " + msg.error);
          return;
        }
        showToast(msg.error, { kind: "error", duration: 5000 });
      }

      if (msg.superadmin && msg.superadmin.active) {
        superadminState = { active: true, boardId: String(msg.superadmin.board_id || ""), draft: {} };
        normalizeTransientLayoutForAdmin({ scrollTop: false });
        applySuperadminUiState();
      }
      if (msg.superadmin && msg.superadmin.dice_rolled) {
        startRollAnimation(sb, msg.superadmin.changed_indices || []);
      }
      if (msg.superadmin && msg.superadmin.saved) {
        superadminState.draft = {};
        applySuperadminUiState();
      }
      if (msg.superadmin && msg.superadmin.active === false) {
        superadminState = { active: false, boardId: null, draft: {} };
        resetAfterSuperadminExit({ scrollTop: false });
      }

      // Scoreboard-Update
      if (msg.scoreboard) {
        clearPendingWrite();
        const wasSuperadminActive = lastSuperadminSnapshotActive;
        celebrateSixtyScore(msg.score_event);
        sb = msg.scoreboard;
        const isSuperadminActive = !!sb?._superadmin_active;
        lastSuperadminSnapshotActive = isSuperadminActive;
        seedChatHistoryFromSnapshot(sb);
        // A terminal result must still be shown if a non-essential renderer
        // enhancement fails (for example a malformed rank badge). Rendering
        // cannot be allowed to swallow the only completion frame.
        try {
          renderFromSnapshot(sb);
        } catch (error) {
          console.error("Spielstand konnte nicht vollständig gerendert werden:", error);
        }
        if (wasSuperadminActive && !isSuperadminActive) {
          resetAfterSuperadminExit({ scrollTop: true });
        }

        // Spielende
        if (sb && sb._finished) {
          if (sb._aborted) {
            if (window._abortAlerted) return;
            window._abortAlerted = true;
            window._fatalWsClose = true;
            const by = window._lastEndedBy;
            showNotice({
              title: "Spiel abgebrochen",
              message: by ? `${by} hat das Spiel beendet.` : "Das Spiel wurde beendet.",
              kind: "warning",
              buttonLabel: "Zur Lobby",
            }).finally(() => { location.href = "/"; });
            return;
          }
          const unlockedAchievements = msg.achievement_unlocks?.[String(myId)] || [];
          const achievementRankUp = msg.achievement_rank_ups?.[String(myId)] || null;
          const finalizationPending = msg.finalization_pending === true
            || sb._finalization_pending === true
            || sb.finalization_pending === true;
          showGameResults(sb, Array.isArray(unlockedAchievements) ? unlockedAchievements : [], {
            finalizationPending,
            achievementRankUp,
          });
          return;
        }
      }

      // Quick-Reaction
      if (msg.emoji && window.emojiUI && typeof window.emojiUI.handleRemote === "function") {
        window.emojiUI.handleRemote(msg.emoji);
        addChatMessage(msg.emoji.from || "???", msg.emoji.emoji || "", {
          ts: msg.emoji.ts,
          kind: "reaction",
          achievement_rank: msg.emoji.achievement_rank,
        });
      }

      // Chat-Varianten
      if (msg.chat && typeof msg.chat === "object") {
        const sender = msg.chat.sender || "???";
        const text = msg.chat.text || "";
        if (text) {
          addChatMessage(sender, text, {
            ts: msg.chat.ts,
            kind: msg.chat.kind,
            achievement_rank: msg.chat.achievement_rank,
          });
          const ownIds = [myId, mySpectatorId ? `S-${mySpectatorId}` : null].filter(Boolean).map(String);
          const isOwn = msg.chat.from_id && ownIds.includes(String(msg.chat.from_id));
          if (!isOwn && window.emojiUI && typeof window.emojiUI.handleChat === "function") {
            window.emojiUI.handleChat(msg.chat);
          }
        }
      } else if (msg.type === "chat" && msg.text) {
        addChatMessage(msg.sender || "???", msg.text);
      } else if (msg.message && msg.sender) {
        addChatMessage(msg.sender, msg.message);
      } else if (msg.kind === "chat" && msg.payload?.text) {
        addChatMessage(msg.payload.sender || "???", msg.payload.text);
      }

      // Zuschauer-Toast
      if (msg.spectator && typeof msg.spectator.name === "string") {
        showSpectatorToast(msg.spectator); // Objekt übergeben, kein fertiger Text
      }

      if (Array.isArray(msg.chat_history)) {
        msg.chat_history.forEach(m => {
          if (m?.text) addChatMessage(m.sender || "???", m.text, {
            ts: m.ts,
            kind: m.kind,
            achievement_rank: m.achievement_rank,
          });
        });
      }
    });

    ws.addEventListener("close", () => {
      clearPendingWrite();
      clearPendingRoll();
      clearAutoRollRetry();
      clearRollAnimation();
      syncActionButtons(sb);
      if (window._fatalWsClose) return;
      reconnectAttempts += 1;
      setConnectionStatus(navigator.onLine ? "reconnecting" : "offline", navigator.onLine ? "Verbindung unterbrochen – neuer Versuch …" : "Offline – warte auf eine Internetverbindung");
      const delay = Math.min(1000 * Math.pow(1.6, reconnectAttempts - 1), 10000);
      setTimeout(connect, delay);
    });
  }
  window.addEventListener("offline", () => setConnectionStatus("offline", "Offline – warte auf eine Internetverbindung"));
  window.addEventListener("online", () => {
    if (!ws || ws.readyState === WebSocket.CLOSED) setConnectionStatus("reconnecting", "Internetverbindung verfügbar – verbinde neu …");
  });
  if (qs.game_id) connect();

  function seedChatHistoryFromSnapshot(snapshot){
    try {
      if (chatHistorySeeded) return;
      chatHistorySeeded = true;
      const hist = Array.isArray(snapshot?._chat_history) ? snapshot._chat_history : [];
      if (!hist.length) return;
      hist.forEach(m => {
        if (m && m.text) addChatMessage(m.sender || "???", m.text, {
          ts: m.ts,
          kind: m.kind,
          achievement_rank: m.achievement_rank,
        });
      });
    } catch {}
  }
