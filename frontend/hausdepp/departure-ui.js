const departureErrors = {
  hausdepp_invalid_actor: "departureUnavailable",
  hausdepp_stale_version: "departureChanged",
  hausdepp_game_not_running: "departureUnavailable",
  hausdepp_departure_persistence_failed: "departureFailed",
};
const exitIcon = '<svg class="hd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4"/></svg>';
const departureDialogId = "hausdepp-departure";

/** Participants leave with server confirmation; spectators only close their view. */
export function mountHausdeppDepartureUI({
  t, getState, send, onLeft, handControls, spectatorControls, onPendingChange = () => {},
  confirm: confirmLeave = options => globalThis.window?.ZDWA_UI?.confirm?.(options) ?? false,
  dismiss: dismissLeave = () => globalThis.window?.ZDWA_UI?.dismiss?.(departureDialogId, false),
  setTimeout: delay = globalThis.setTimeout, clearTimeout: cancelDelay = globalThis.clearTimeout,
  confirmationTimeoutMs = 10000,
}) {
  const tableButton = document.createElement("button");
  tableButton.id = "hausdeppLeaveGame";
  tableButton.type = "button";
  tableButton.className = "hd-departure-button";
  const resultButton = document.createElement("button");
  resultButton.id = "hausdeppLeaveGameResult";
  resultButton.type = "button";
  resultButton.className = "hd-secondary hd-departure-result";
  const notice = document.createElement("p");
  notice.className = "hd-departure-notice";
  notice.setAttribute("role", "alert");
  notice.hidden = true;
  document.body.append(notice);
  let pending = false, destroyed = false, completed = false, errorKey = "", confirmation = null;
  let confirmationTimer = null;
  const clearConfirmation = () => {
    if (confirmationTimer !== null) cancelDelay(confirmationTimer);
    confirmationTimer = null;
  };
  const fail = key => {
    clearConfirmation();
    pending = false; errorKey = key;
    onPendingChange(false); render();
  };
  const confirmationMatches = (state, expected) => !state.spectating && state.connected && !state.busy
    && state.permissions?.can_leave && Number.isSafeInteger(state.version)
    && state.permissions.forfeits_round === expected.forfeitsRound
    && state.permissions.ends_tournament_participation === expected.endsTournament;
  const restorePromptLabel = prompt => {
    prompt?.restoreLabel?.();
    if (prompt) prompt.restoreLabel = null;
  };
  const cancelPrompt = (key = "") => {
    if (!confirmation) return;
    restorePromptLabel(confirmation);
    confirmation = null;
    if (key) errorKey = key;
    // Dismiss only this prompt, including while queued behind another dialog.
    // Its eventual result cannot act on a destroyed or changed table.
    dismissLeave();
  };
  const leave = event => {
    if (destroyed || completed) return;
    const state = getState(), permissions = state.permissions;
    if (state.spectating) {
      cancelPrompt();
      clearConfirmation();
      completed = true; pending = false; errorKey = "";
      onLeft();
      return;
    }
    if (pending || confirmation || state.busy || !state.connected || !permissions?.can_leave) return;
    const warning = t(permissions.forfeits_round ? "departureForfeitConfirm" : "departureFinishedConfirm");
    const tournament = permissions.ends_tournament_participation ? `\n\n${t("departureTournamentConfirm")}` : "";
    const expected = { forfeitsRound: permissions.forfeits_round,
      endsTournament: permissions.ends_tournament_participation };
    confirmation = expected;
    errorKey = "";
    // Mobile clicks need not focus their button. Give the shared dialog a
    // stable return target before it captures the previously focused element.
    event?.currentTarget?.focus?.({ preventScroll: true });
    const finishPrompt = accepted => {
      if (confirmation !== expected || destroyed || completed) return;
      restorePromptLabel(expected);
      confirmation = null;
      if (accepted !== true) { render(); return; }
      const latest = getState();
      if (!confirmationMatches(latest, expected)) { fail("departureChanged"); return; }
      pending = true; errorKey = "";
      clearConfirmation();
      confirmationTimer = delay(() => {
        confirmationTimer = null;
        if (!destroyed && !completed && pending) fail("departureConnectionLost");
      }, confirmationTimeoutMs);
      onPendingChange(true); render();
      try {
        if (!send({ action: "hausdepp_leave_game", version: latest.version })) fail("departureConnectionLost");
      } catch { fail("departureConnectionLost"); }
    };
    try {
      const action = t(permissions.ends_tournament_participation ? "departureTournament" : "departureTable");
      const choice = confirmLeave({ id: departureDialogId, kind: departureDialogId,
        title: action, message: `${warning}${tournament}`, confirmLabel: action,
        cancelLabel: t("departureStay"), danger: true,
        onOpen({ dialog }) {
          const close = dialog.querySelector(".app-dialog-close");
          if (!close) return;
          const previous = close.getAttribute("aria-label");
          expected.restoreLabel = () => {
            if (previous === null) close.removeAttribute("aria-label");
            else close.setAttribute("aria-label", previous);
          };
          close.setAttribute("aria-label", t("departureStay"));
        },
      });
      if (choice && typeof choice.then === "function") Promise.resolve(choice).then(finishPrompt, () => finishPrompt(false));
      else finishPrompt(choice);
    } catch { finishPrompt(false); }
  };
  tableButton.addEventListener("click", leave);
  resultButton.addEventListener("click", leave);

  function render() {
    if (destroyed) return;
    const state = getState();
    if (confirmation && !confirmationMatches(state, confirmation)) {
      cancelPrompt(state.connected ? "departureChanged" : "departureConnectionLost");
    }
    const spectator = state.spectating === true;
    const available = spectator || state.permissions?.can_leave === true;
    const action = t(!spectator && state.permissions?.ends_tournament_participation ? "departureTournament" : "departureTable");
    document.body.classList.toggle("hd-departure-available", available);
    tableButton.hidden = resultButton.hidden = !available;
    tableButton.disabled = resultButton.disabled = !spectator && (pending || state.busy || !state.connected);
    tableButton.innerHTML = `${exitIcon}<span class="hd-departure-text">${t("departureShort")}</span>`;
    tableButton.setAttribute("aria-label", action);
    tableButton.setAttribute("aria-busy", String(!spectator && pending));
    resultButton.setAttribute("aria-busy", String(!spectator && pending));
    tableButton.title = action;
    resultButton.textContent = action;
    notice.hidden = !errorKey;
    notice.textContent = errorKey ? t(errorKey) : "";
    const controls = spectator ? spectatorControls : handControls;
    if (controls && tableButton.parentElement !== controls) controls.append(tableButton);
    const result = document.querySelector("#hausdeppResult .hd-result-links");
    if (result && resultButton.parentElement !== result) {
      const account = result.querySelector('a[href="/hausdepp/konto#erfolge"]');
      result.insertBefore(resultButton, account);
    }
  }
  render();
  return { render,
    receive(payload) {
      if (destroyed || completed || payload?.left_hausdepp_game !== true) return false;
      cancelPrompt();
      clearConfirmation();
      completed = true; pending = false; errorKey = "";
      onLeft();
      return true;
    },
    reject(payload) {
      const key = departureErrors[payload?.error_code || payload?.error];
      if (destroyed || !pending || !key) return false;
      fail(key); return true;
    },
    disconnected() {
      if (destroyed) return;
      if (confirmation) { cancelPrompt("departureConnectionLost"); render(); }
      if (pending) fail("departureConnectionLost");
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPrompt();
      clearConfirmation();
      tableButton.remove(); resultButton.remove(); notice.remove();
      document.body.classList.remove("hd-departure-available");
    },
  };
}
