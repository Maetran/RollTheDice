  function announceWindowOpen(snapshot){
    const rolls = Number(snapshot?._rolls_used || 0);
    const iAmTurn = (snapshot?._turn && String(snapshot._turn.player_id) === String(myId));
    const corrActive = !!(snapshot?._correction?.active);
    const announced = snapshot?._announced_row4 || null;
    return iAmTurn && !corrActive && rolls === 1 && !announced;
  }

  // Eigenes Zielboard: im Teammodus das gemeinsame Teamboard, sonst das Spielerboard.
  function getMyBoard(snapshot){
    const mode = String(snapshot?._mode || "").toLowerCase();
    if (mode === "2v2" && Array.isArray(snapshot?._teams)) {
      const myTeam = (snapshot._teams.find(t => (t.members || []).some(m => String(m) === String(myId))) || {}).id;
      return myTeam ? (snapshot._scoreboards_by_team?.[myTeam] || {}) : {};
    }
    return (snapshot?._scoreboards?.[myId]) || {};
  }

  function isColFull(sc, colKey){
    try{
      const need = Object.keys(WRITABLE_MAP).map(k => Number(k));
      for (const ri of need){
        const key = `${ri},${colKey}`;
        const v = sc[key];
        if (v === undefined || v === null || v === "") return false;
      }
      return true;
    }catch{ return false; }
  }

  function emptyCountAng(sc){
    try{
      let cnt = 0;
      for (const ri of Object.keys(WRITABLE_MAP).map(k => Number(k))){
        const key = `${ri},ang`;
        const v = sc[key];
        if (v === undefined || v === null || v === "") cnt++;
      }
      return cnt;
    }catch{ return 0; }
  }

  function totalOpenWritable(sc){
    try{
      let cnt = 0;
      const cols = ["down","free","up","ang"];
      for (const ri of Object.keys(WRITABLE_MAP).map(k => Number(k))){
        for (const c of cols){
          const v = sc[`${ri},${c}`];
          if (v === undefined || v === null || v === "") cnt++;
        }
      }
      return cnt;
    }catch{ return 0; }
  }

  // Ansagepflicht verhindert ein Sackgassen-Endspiel, wenn nur noch ❗ sinnvoll offen ist.
  function mustAnnounceAfterFirst(snapshot){
    const sc = getMyBoard(snapshot);
    const colFull = isColFull(sc, "down") && isColFull(sc, "free") && isColFull(sc, "up");
    const freeAng = emptyCountAng(sc);
    const openAll = totalOpenWritable(sc);
    // Pflicht nur, wenn 3 Reihen voll sind, in ❗ mind. zwei frei und nicht im "letztes Feld" Sonderfall
    return Boolean(colFull && freeAng >= 2 && openAll !== 1);
  }

  function isRollingBlocked(snapshot){
    const rolls = Number(snapshot?._rolls_used || 0);
    const announced = snapshot?._announced_row4 || null;
    return (rolls >= 1) && mustAnnounceAfterFirst(snapshot) && !announced;
  }

  function rollSnapshotKey(snapshot){
    try{
      const turnPid = snapshot?._turn?.player_id || "";
      const rolls = Number(snapshot?._rolls_used || 0);
      const dice = Array.isArray(snapshot?._dice) ? snapshot._dice.join(",") : "";
      const corr = snapshot?._correction?.active ? "1" : "0";
      const finished = snapshot?._finished ? "1" : "0";
      return `${turnPid}|${rolls}|${dice}|${corr}|${finished}`;
    }catch{
      return "";
    }
  }

  function rollCooldownRemaining(){
    const nextByLock = Number(window.__rt_rollLockedUntil || 0);
    const nextByLastSend = Number(window.__rt_lastRollSent || 0) + ROLL_GUARD_MS;
    const nextAllowed = Math.max(nextByLock, nextByLastSend);
    return Math.max(0, nextAllowed - Date.now());
  }

  function scheduleRollAvailabilityRefresh(){
    try{
      if (rollCooldownTimer) clearTimeout(rollCooldownTimer);
      const wait = rollCooldownRemaining();
      if (wait <= 0) return;
      rollCooldownTimer = setTimeout(() => {
        rollCooldownTimer = null;
        syncActionButtons(sb);
      }, wait + 25);
    }catch{}
  }

  function stopDiceShake(){
    try{ $$("#diceBar .die", mount).forEach(el => el.classList.remove("shaking")); }
    catch{}
  }

  function dieSVGMarkup(v){
    const L=30, C=50, R=70, T=30, M=50, B=70;
    const pips = {
      1: [[C,M]],
      2: [[L,T],[R,B]],
      3: [[L,T],[C,M],[R,B]],
      4: [[L,T],[R,T],[L,B],[R,B]],
      5: [[L,T],[R,T],[C,M],[L,B],[R,B]],
      6: [[L,T],[L,M],[L,B],[R,T],[R,M],[R,B]]
    }[Number(v)] || [];
    const dots = pips.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="8"></circle>`).join("");
    return `
      <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="Würfel ${Number(v) || 0}">
        <rect x="5" y="5" width="90" height="90" rx="12" ry="12" fill="white" stroke="black" stroke-width="6"></rect>
        <g fill="black">${dots}</g>
      </svg>
    `;
  }

  function randomFaceExcept(prev){
    let next = 1 + Math.floor(Math.random() * 6);
    if (next === Number(prev)) next = (next % 6) + 1;
    return next;
  }

  function restoreDiceFacesFromSnapshot(snapshot){
    try {
      const dice = Array.isArray(snapshot?._dice) ? snapshot._dice : [];
      $$("#diceBar .die", mount).forEach(el => {
        const i = Number(el.dataset.i);
        el.removeAttribute("data-rolling-face");
        el.innerHTML = dieSVGMarkup(Number(dice[i] || 0));
      });
    } catch {}
  }

  function renderRollingDiceFaces(){
    try {
      const active = isRollAnimationActive();
      if (!active) return;
      const animated = new Set(rollAnimationIndices.map(Number));
      $$("#diceBar .die", mount).forEach(el => {
        const i = Number(el.dataset.i);
        if (!animated.has(i)) return;
        const prev = Number(el.dataset.rollingFace || sb?._dice?.[i] || 0);
        const face = randomFaceExcept(prev);
        el.dataset.rollingFace = String(face);
        el.innerHTML = dieSVGMarkup(face);
      });
    } catch {}
  }

  function stopRollFaceTimer(){
    if (rollFaceTimer) {
      try{ clearInterval(rollFaceTimer); }catch{}
      rollFaceTimer = null;
    }
  }

  function clearRollAnimation(){
    rollAnimationUntil = 0;
    rollAnimationIndices = [];
    if (rollAnimationTimer) {
      try{ clearTimeout(rollAnimationTimer); }catch{}
      rollAnimationTimer = null;
    }
    stopRollFaceTimer();
    stopDiceShake();
    restoreDiceFacesFromSnapshot(sb);
    const suggestionSnapshot = deferredSuggestionSnapshot || sb;
    deferredSuggestionSnapshot = null;
    renderSuggestionsForSnapshot(suggestionSnapshot);
  }

  function isRollAnimationActive(){
    return rollAnimationUntil > Date.now() && rollAnimationIndices.length > 0;
  }

  function activeRollDiceIndices(snapshot){
    const holds = Array.isArray(snapshot?._holds) ? snapshot._holds : [false,false,false,false,false];
    return [0,1,2,3,4].filter(i => !holds[i]);
  }

  function applyRollAnimation(){
    try{
      const active = isRollAnimationActive();
      const diceEls = $$("#diceBar .die", mount);
      diceEls.forEach(el => el.classList.remove("shaking"));
      if (!active) return;
      const animated = new Set(rollAnimationIndices.map(Number));
      diceEls.forEach(el => {
        const i = Number(el.dataset.i);
        if (animated.has(i)) el.classList.add("shaking");
      });
      renderRollingDiceFaces();
    }catch{}
  }

  function startRollAnimation(snapshot, explicitIndices = null){
    rollAnimationIndices = Array.isArray(explicitIndices)
      ? explicitIndices.map(Number).filter(i => i >= 0 && i < 5)
      : activeRollDiceIndices(snapshot);
    rollAnimationUntil = Date.now() + ROLL_ANIMATION_MS;
    applyRollAnimation();
    if (rollAnimationTimer) {
      try{ clearTimeout(rollAnimationTimer); }catch{}
    }
    stopRollFaceTimer();
    renderRollingDiceFaces();
    rollFaceTimer = setInterval(() => {
      if (rollAnimationUntil <= Date.now()) {
        clearRollAnimation();
        return;
      }
      renderRollingDiceFaces();
    }, ROLL_FACE_ANIMATION_STEP_MS);
    rollAnimationTimer = setTimeout(clearRollAnimation, ROLL_ANIMATION_MS + 40);
  }

  function clearPendingRoll(){
    rollRequestPending = false;
    pendingRollSnapshotKey = null;
    if (rollSendTimer) { try{ clearTimeout(rollSendTimer); }catch{} rollSendTimer = null; }
    if (rollPendingTimer) { try{ clearTimeout(rollPendingTimer); }catch{} rollPendingTimer = null; }
  }

  function clearAutoRollRetry(){
    if (autoRollRetryTimer) {
      try{ clearTimeout(autoRollRetryTimer); }catch{}
      autoRollRetryTimer = null;
    }
  }

  function settlePendingRollFromSnapshot(snapshot){
    if (!rollRequestPending) return;
    const nextKey = rollSnapshotKey(snapshot);
    if (pendingRollSnapshotKey && nextKey && nextKey !== pendingRollSnapshotKey) {
      clearPendingRoll();
    }
  }

  function hasOpenAnnounceField(snapshot){
    const sc = getMyBoard(snapshot);
    try{
      for (const ri of Object.keys(WRITABLE_MAP).map(k => Number(k))){
        const v = sc[`${ri},ang`];
        if (v === undefined || v === null || v === "") return true;
      }
    }catch{}
    return false;
  }

  function getRollAvailability(snapshot){
    if (IS_SPECTATOR) return { usable:false, reason:"Zuschauer können nicht würfeln", code:"spectator" };
    if (!snapshot || snapshot._finished) return { usable:false, reason:"Spiel ist nicht aktiv", code:"inactive" };
    if (snapshot?._paused) return { usable:false, reason:snapshot._pause_reason || "Spiel pausiert, bis alle Spieler wieder verbunden sind", code:"paused" };
    if (snapshot?._superadmin_active) return { usable:false, reason:"Während Superadmin-Edit gesperrt", code:"superadmin" };
    const turn = snapshot?._turn || null;
    const iAmTurn = turn && String(turn.player_id) === String(myId);
    if (!iAmTurn) return { usable:false, reason:"Nicht an der Reihe", code:"not_turn" };
    if (snapshot?._correction?.active) return { usable:false, reason:"Während Korrektur nicht erlaubt", code:"correction" };
    if (sixtyCelebrationRemaining() > 0) return { usable:false, reason:"60er! Gleich geht es weiter", code:"sixty_celebration" };
    const rolls = Number(snapshot?._rolls_used || 0);
    const max = Number(snapshot?._rolls_max || 3);
    if (rolls >= max) return { usable:false, reason:"Keine Würfe mehr", code:"no_rolls_left" };
    if (!snapshot._hardcore && isRollingBlocked(snapshot)) {
      return { usable:false, reason:"Weiter würfeln erst nach Ansage möglich (Pflicht nach Wurf 1).", code:"announce_required" };
    }
    if (rollRequestPending) return { usable:false, reason:"Wurf läuft", code:"pending" };
    const wait = rollCooldownRemaining();
    if (wait > 0) return { usable:false, reason:"Kurz warten", code:"cooldown" };
    return { usable:true, reason:"Würfeln", code:"ready" };
  }

  function getAnnounceAvailability(snapshot){
    if (IS_SPECTATOR) return { usable:false, reason:"Zuschauer können nicht ansagen", mode:"announce" };
    if (!snapshot || snapshot._finished) return { usable:false, reason:"Spiel ist nicht aktiv", mode:"announce" };
    if (snapshot?._paused) return { usable:false, reason:snapshot._pause_reason || "Spiel pausiert, bis alle Spieler wieder verbunden sind", mode:"announce" };
    if (snapshot?._superadmin_active) return { usable:false, reason:"Während Superadmin-Edit gesperrt", mode:"announce" };
    if (snapshot?._hardcore) return { usable:false, reason:"Ansage ist im Hardcore-Modus deaktiviert", mode:"announce" };
    const announced = snapshot?._announced_row4 || null;
    const mode = announced ? "unannounce" : "announce";
    const turn = snapshot?._turn || null;
    const iAmTurn = turn && String(turn.player_id) === String(myId);
    if (!iAmTurn) return { usable:false, reason:"Nicht an der Reihe", mode };
    if (snapshot?._correction?.active) return { usable:false, reason:"Während Korrektur nicht erlaubt", mode };
    const rolls = Number(snapshot?._rolls_used || 0);
    if (rolls < 1) return { usable:false, reason:"Ansage erst nach dem ersten Wurf möglich", mode };
    if (rolls !== 1) return { usable:false, reason:"Ansage nur direkt nach Wurf 1 möglich", mode };
    if (announced) return { usable:true, reason:"Ansage aufheben", mode };
    if (!hasOpenAnnounceField(snapshot)) return { usable:false, reason:"Keine freien ❗-Felder für eine Ansage", mode };
    return { usable:true, reason:"Ansagen", mode };
  }

  const QUICK_ROW_ORDER = [0,1,2,3,4,5,9,10,12,13,14,15];

  function getQuickEntryAvailability(snapshot, field){
    if (!userGameplayPreferences().mobileRowQuickEntry) {
      return { usable:false, reason:"Mobile Schnelleingabe ist deaktiviert", cell:null };
    }
    if (IS_SPECTATOR) return { usable:false, reason:"Zuschauer können nicht schreiben", cell:null };
    if (!snapshot || snapshot._finished) return { usable:false, reason:"Spiel ist nicht aktiv", cell:null };
    if (snapshot?._paused) return { usable:false, reason:snapshot._pause_reason || "Spiel pausiert", cell:null };
    if (snapshot?._superadmin_active) return { usable:false, reason:"Während Superadmin-Edit gesperrt", cell:null };
    const iAmTurn = snapshot?._turn && String(snapshot._turn.player_id) === String(myId);
    if (!iAmTurn) return { usable:false, reason:"Nicht an der Reihe", cell:null };
    if (snapshot?._correction?.active) return { usable:false, reason:"Während Korrektur nicht erlaubt", cell:null };

    const order = field === "up" ? QUICK_ROW_ORDER.slice().reverse() : QUICK_ROW_ORDER;
    const board = $(".player-card.me", mount);
    const cell = order
      .map(row => board?.querySelector(`td.cell.clickable[data-row="${row}"][data-field="${field}"]`))
      .find(Boolean) || null;
    // Das letzte freie Feld darf auch nach einem Wiederverbinden ohne
    // gespeicherten Wurf als Streichfeld abgeschlossen werden.
    if (Number(snapshot?._rolls_used || 0) < 1 && !cell) {
      return { usable:false, reason:"Erst würfeln", cell:null };
    }
    if (!cell) return { usable:false, reason:"Reihe vollständig oder derzeit nicht beschreibbar", cell:null };
    return { usable:true, reason:field === "up" ? "Nächstes Feld der Aufwärtsreihe eintragen" : "Nächstes Feld der Abwärtsreihe eintragen", cell };
  }

  function syncActionButtons(snapshot){
    try{
      const rollBtn = $("#rollBtnInline", mount);
      if (rollBtn){
        const roll = getRollAvailability(snapshot);
        rollBtn.disabled = !roll.usable;
        rollBtn.title = roll.reason || "Würfeln";
        rollBtn.setAttribute("aria-disabled", roll.usable ? "false" : "true");
      }

      const ab = $("#announceBtnInline", mount);
      if (ab){
        const ann = getAnnounceAvailability(snapshot);
        const announced = snapshot?._announced_row4 || null;
        ab.disabled = !ann.usable;
        ab.title = ann.reason || "Ansagen";
        ab.dataset.state = ann.mode || "announce";
        ab.setAttribute("aria-disabled", ann.usable ? "false" : "true");
        if (ann.mode === "unannounce" || announced){
          ab.textContent = "Ansage aufheben";
          announcePickMode = false;
        } else {
          ab.textContent = announcePickMode ? "Ansage wählen" : "Ansagen";
        }
        // Lange Labels muessen umbrechen, damit die Buttonbreite konstant bleibt
        ab.style.whiteSpace = 'normal';
        ab.style.lineHeight = '1.15';
      }

      const quickActions = $("#mobileRowQuickActions", mount);
      if (quickActions){
        const enabled = userGameplayPreferences().mobileRowQuickEntry;
        quickActions.hidden = !enabled;
        $$(".mobile-row-quick-button", quickActions).forEach(button => {
          const availability = getQuickEntryAvailability(snapshot, button.dataset.quickField);
          button.disabled = !availability.usable;
          button.title = availability.reason;
          button.setAttribute("aria-disabled", availability.usable ? "false" : "true");
        });
      }

      syncActionFeedback(snapshot);
      scheduleRollAvailabilityRefresh();
    }catch{}
  }

  function renderSuperadminLockNotice(snapshot){
    try {
      let el = document.getElementById("superadminLockNotice");
      if (!snapshot?._superadmin_active) {
        if (el) el.remove();
        return;
      }
      const score = document.querySelector("#scoreOut");
      if (!score) return;
      if (!el) {
        el = document.createElement("div");
        el.id = "superadminLockNotice";
        el.className = "superadmin-lock-notice";
        const anchor = score.querySelector(".suggestions-area") || score.querySelector(".players-grid");
        score.insertBefore(el, anchor || score.firstChild);
      }
      el.textContent = superadminState.active
        ? "Superadmin-Edit aktiv: Zusatzwurf nutzen oder einen Würfel antippen, um ihn sofort zu setzen."
        : "Superadmin-Edit aktiv: Würfeln, Halten, Ansagen und Schreiben sind pausiert.";
    } catch {}
  }

  function renderMultiplayerPauseNotice(snapshot){
    try {
      let el = document.getElementById("multiplayerPauseNotice");
      if (!snapshot?._paused) {
        if (el) el.remove();
        return;
      }
      const score = document.querySelector("#scoreOut");
      if (!score) return;
      if (!el) {
        el = document.createElement("div");
        el.id = "multiplayerPauseNotice";
        el.className = "multiplayer-pause-notice";
        const anchor = score.querySelector(".suggestions-area") || score.querySelector(".players-grid");
        score.insertBefore(el, anchor || score.firstChild);
      }
      const offline = Array.isArray(snapshot._offline_players) ? snapshot._offline_players : [];
      const names = offline.map(p => p && p.name).filter(Boolean).join(", ");
      el.textContent = names
        ? `Spiel pausiert. Weiter geht es, sobald wieder verbunden sind: ${names}.`
        : "Spiel pausiert. Weiter geht es, sobald alle Spieler wieder verbunden sind.";
    } catch {}
  }

  function scheduleAutoRollRetry(snapshot){
    try{
      if (autoRollRetryTimer) return;
      const targetKey = rollSnapshotKey(snapshot);
      const wait = Math.max(rollCooldownRemaining(), sixtyCelebrationRemaining());
      autoRollRetryTimer = setTimeout(() => {
        autoRollRetryTimer = null;
        const stillSameAutoTurn = sb?._auto_single && rollSnapshotKey(sb) === targetKey;
        if (stillSameAutoTurn) requestRoll({ animate: true, auto: true });
      }, Math.max(wait, 0) + 25);
    }catch{}
  }

  function requestRoll({ animate = true, auto = false } = {}) {
    const availability = getRollAvailability(sb);
    if (!availability.usable) {
      if (auto && ["cooldown", "sixty_celebration"].includes(availability.code)) scheduleAutoRollRetry(sb);
      syncActionButtons(sb);
      return false;
    }

    clearAutoRollRetry();
    rollRequestPending = true;
    pendingRollSnapshotKey = rollSnapshotKey(sb);
    window.__rt_rollLockedUntil = Date.now() + ROLL_GUARD_MS;
    syncActionButtons(sb);

    if (rollSendTimer) { try{ clearTimeout(rollSendTimer); }catch{} }
    rollSendTimer = setTimeout(() => {
      rollSendTimer = null;
      const sent = safeSend(ws, { action: "roll_dice" });
      if (!sent) {
        clearPendingRoll();
        clearRollAnimation();
        syncActionButtons(sb);
      }
    }, animate ? ROLL_ANIMATION_SEND_DELAY_MS : 0);

    if (rollPendingTimer) { try{ clearTimeout(rollPendingTimer); }catch{} }
    rollPendingTimer = setTimeout(() => {
      if (!rollRequestPending) return;
      clearPendingRoll();
      clearRollAnimation();
      syncActionButtons(sb);
    }, ROLL_PENDING_TIMEOUT_MS);

    if (animate) {
      startRollAnimation(sb);
    }
    return true;
  }

    // --- Mobile-Autofocus (Swipe vs. Auto-Follow) ---
  let _lastTurnPid = null;
  let _userScrollOverride = false;
  let _lastFilledCount = null; // Anzahl gefuellter schreibbarer Zellen
  // Verzögertes Auto-Follow nach Schreibaktion (Mobile):
  // Nach einem Schreibvorgang und Zugwechsel soll der Fokus ~1s auf dem soeben
  // beschriebenen Board bleiben, bevor zum neuen Zug gescrollt wird.
  let _pendingFollowTimer = null;

  // Mounts
  const mount = document.getElementById("scoreOut") || (() => {
    const d = document.createElement("div"); d.id = "scoreOut"; document.body.appendChild(d); return d;
  })();
  const reactionsMount = document.getElementById("reactionsBar") || (() => {
    const r = document.createElement("div"); r.id = "reactionsBar"; r.style.margin = ".5rem 0"; document.body.prepend(r); return r;
  })();
