  // ---------- Hotkeys ----------
  /**
   * Prüft, ob aktuell ein Wurf zulässig ist (Client-Guards). Der Server
   * validiert zusätzlich inkl. Cooldown und Spielzustand.
   * @returns {boolean}
   */
  function canRollNow() {
    return getRollAvailability(sb).usable;
  }

  /**
   * Sendet einen manuellen Roll-Request mit derselben Animation/Guard-Logik
   * wie der Würfeln-Button.
   */
  function safeRoll() {
    requestRoll({ animate: true });
  }

  /**
   * Registriert Hotkeys: ESC (Cancel/Pick-Mode), 1..5 (Holds),
   * Space/r (Roll), a (Ansage), u (Ansage aufheben), k (Korrektur anfragen).
   */
  function ensureKeybindings() {
    if (document._roomKeysBound) return;
    document._roomKeysBound = true;

    document.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      if (IS_SPECTATOR) return;

      // Korrektur abbrechen (ESC) – bereits global in wireDiceBar gesetzt; hier nur Guard
      if (key === "escape") {
        // 1) Ansage-Pick-Mode verlassen
        if (announcePickMode) {
          closeAnnouncePickMode({ rerender:true });
          e.preventDefault();
          return;
        }
        // 2) Korrekturmodus abbrechen (wie gehabt)
        if (sb?._correction?.active && String(sb._correction.player_id) === String(myId)) {
          safeSend(ws, { action: "cancel_correction" });
          e.preventDefault();
        }
        return;
      }

      // Inputs nicht hijacken
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // 1..5: Hold toggle (Zuginhaber oder eigener Korrekturmodus)
      if (["1","2","3","4","5"].includes(key)) {
        const idx = parseInt(key, 10) - 1;
        const iAmTurn = sb?._turn && String(sb._turn.player_id) === String(myId);
        const inCorr = !!(sb?._correction?.active);
        if (!iAmTurn || inCorr) return;

        const holdsEls = $$("#diceBar .die", mount);
        const next = holdsEls.map(b => b.classList.contains("held"));
        next[idx] = !next[idx];
        safeSend(ws, { action: "set_hold", holds: next });
        e.preventDefault();
        return;
      }

      // Space / r: würfeln
      if (key === " " || key === "spacebar" || key === "r") {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (canRollNow()) safeRoll();
        e.preventDefault();
        return;
      }

      // u: Ansage aufheben (nutzt den Ein-Button #announceBtnInline im Zustand "unannounce")
      if (key === "u") {
        const btn = $("#announceBtnInline", mount);
        if (btn && !btn.disabled && btn.dataset.state === "unannounce") {
          btn.click();
          e.preventDefault();
        }
        return;
      }

      // k: Korrektur anfragen
      if (key === "k") {
        const btn = $("#requestCorrectionBtn", mount);
        if (btn && !btn.disabled) { btn.click(); e.preventDefault(); }
        return;
      }

      // a: Ansage-Button (toggle / aufheben) – nur im erlaubten Fenster (Wurf 1)
      if (key === "a") {
        const btn = $("#announceBtnInline", mount);
        if (btn && !btn.disabled) {
          btn.click();
          e.preventDefault();
        }
        return;
      }

      // p: (optional) Debug – Poker/Free schreiben
      if (DEBUG_P_HOTKEY && key === "p") {
        safeSend(ws, { action: "write_field", row: 14, field: "free" }); // 14 = poker
        e.preventDefault();
        return;
      }
    });
  }

  // ---------- Utils ----------
  /**
   * Zeigt einen kurzen Hinweis, wenn Zuschauer beitreten/verlassen.
   * @param {{event:string,name:string}} evt
   */
  function showSpectatorToast(evt){
    try {
      const { event, name, achievement_rank: achievementRank } = evt || {};
      const host = reactionsMount || document.body;
      const el = document.createElement("div");
      el.className = "spectator-toast";
      const nameMarkup = typeof window.ZDWA_PLAYER_NAME_MARKUP === "function"
        ? window.ZDWA_PLAYER_NAME_MARKUP(
          { name: name || "Spieler", achievement_rank: achievementRank },
          { compactRank: true },
        )
        : esc(name || "Spieler");
      el.innerHTML = event === "left"
        ? `Zuschauer hat verlassen: ${nameMarkup}`
        : `Zuschauer verbunden: ${nameMarkup}`;
      el.style.display = "inline-block";
      el.style.marginLeft = ".5rem";
      el.style.padding = ".35rem .55rem";
      el.style.borderRadius = "8px";
      el.style.background = "rgba(0,0,0,.85)";
      el.style.color = "#fff";
      el.style.fontSize = ".92rem";
      el.style.pointerEvents = "none";
      host.appendChild(el);
      setTimeout(() => { el.style.transition = "opacity .35s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 380); }, 1400);
    } catch {}
  }

  /**
   * HTML-Escaping für sichere Anzeige von Text (z. B. in Tooltips).
   * @param {string} s
   * @returns {string}
   */
  function esc(s){
    return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  }
