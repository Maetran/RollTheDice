const departureErrors = {
  hausdepp_invalid_actor: "departureUnavailable",
  hausdepp_stale_version: "departureChanged",
  hausdepp_game_not_running: "departureUnavailable",
  hausdepp_departure_persistence_failed: "departureFailed",
};
const exitIcon = '<svg class="hd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4"/></svg>';

/** Explicit server-confirmed departure, separate from ending everyone's game. */
export function mountHausdeppDepartureUI({
  t, getState, send, onLeft, onPendingChange = () => {},
  confirm: confirmLeave = message => globalThis.window.confirm(message),
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
  let pending = false, destroyed = false, completed = false, errorKey = "";
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
  const leave = () => {
    const state = getState(), permissions = state.permissions;
    if (destroyed || completed || pending || state.busy || !state.connected || state.spectating || !permissions?.can_leave) return;
    const warning = t(permissions.forfeits_round ? "departureForfeitConfirm" : "departureFinishedConfirm");
    const tournament = permissions.ends_tournament_participation ? `\n\n${t("departureTournamentConfirm")}` : "";
    if (!confirmLeave(`${warning}${tournament}`)) return;
    const latest = getState();
    if (!latest.connected || !latest.permissions?.can_leave || !Number.isSafeInteger(latest.version)
      || latest.version !== state.version
      || latest.permissions.forfeits_round !== permissions.forfeits_round
      || latest.permissions.ends_tournament_participation !== permissions.ends_tournament_participation) { fail("departureChanged"); return; }
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
  tableButton.addEventListener("click", leave);
  resultButton.addEventListener("click", leave);

  function render() {
    if (destroyed) return;
    const state = getState();
    const available = !state.spectating && state.permissions?.can_leave === true;
    const action = t(state.permissions?.ends_tournament_participation ? "departureTournament" : "departureTable");
    document.body.classList.toggle("hd-departure-available", available);
    tableButton.hidden = resultButton.hidden = !available;
    tableButton.disabled = resultButton.disabled = pending || state.busy || !state.connected;
    tableButton.innerHTML = `${exitIcon}<span class="hd-departure-text">${t("departureShort")}</span>`;
    tableButton.setAttribute("aria-label", action);
    tableButton.setAttribute("aria-busy", String(pending));
    resultButton.setAttribute("aria-busy", String(pending));
    tableButton.title = action;
    resultButton.textContent = action;
    notice.hidden = !errorKey;
    notice.textContent = errorKey ? t(errorKey) : "";
    const heading = document.querySelector(".hd-room-heading");
    if (heading && tableButton.parentElement !== heading) heading.append(tableButton);
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
    disconnected() { if (!destroyed && pending) fail("departureConnectionLost"); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearConfirmation();
      tableButton.remove(); resultButton.remove(); notice.remove();
      document.body.classList.remove("hd-departure-available");
    },
  };
}
