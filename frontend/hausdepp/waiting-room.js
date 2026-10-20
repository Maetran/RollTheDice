import { apiFetch, escapeHtml as esc } from "../shared/auth.js";

export function waitingControlsMarkup(t) {
  return `<p id="hausdeppWaitingMode" class="hd-waiting-mode"></p><ul id="hausdeppWaitingSeats" class="hd-waiting-seats hd-place-cards"></ul><p id="hausdeppWaitingCount" class="hd-waiting-count" role="status"></p><div id="hausdeppHostControls" class="hd-host-controls" hidden><button id="hausdeppAddCpu" class="hd-secondary" type="button" data-waiting-action="add">＋ ${t("waitingAddCpu")}</button><button id="hausdeppStartGame" class="hd-primary" type="button" data-waiting-action="start"></button><button id="hausdeppSaveFavourite" class="hd-waiting-favourite" type="button" data-waiting-action="save">☆ ${t("waitingSaveFavourite")}</button></div><p id="hausdeppWaitingFeedback" class="hd-fine" role="status"></p>`;
}

export function mountWaitingControls(container, { t, send, connected }) {
  const lifetime = new AbortController();
  let current, pending = false, timer, saving = false, stopped = false;
  const $ = id => container.querySelector(`#${id}`);
  const feedback = text => { $("hausdeppWaitingFeedback").textContent = text; };
  const finish = () => { pending = false; clearTimeout(timer); update(current); };
  const click = async event => {
    const button = event.target.closest("[data-waiting-action]");
    if (!button || button.disabled || !current?._waiting_permissions?.is_host) return;
    const action = button.dataset.waitingAction;
    feedback("");
    if (action === "save") {
      if (saving) return;
      saving = true; update(current);
      try {
        const response = await apiFetch("/api/hausdepp/favourite", { method: "PUT", signal: lifetime.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waiting_mode: current._waiting_mode || "fixed", players: Number(current._expected), cpu_count: (current._participants || []).filter(player => player.is_cpu).length, tournament: Boolean(current._hausdepp_tournament_enabled), password_required: Boolean(current.locked), voice_enabled: current._voice_enabled !== false }) });
        if (!response.ok) throw new Error("favourite_failed");
        if (!stopped) feedback(t("waitingFavouriteSaved"));
      } catch (error) { if (!stopped && error.name !== "AbortError") feedback(t("requestFailed")); }
      finally { saving = false; if (!stopped) update(current); }
      return;
    }
    if (pending || !connected()) return;
    const messages = { add: "hausdepp_add_cpu", remove: "hausdepp_remove_cpu", start: "hausdepp_start_game" };
    if (!messages[action]) return;
    pending = true;
    update(current);
    if (!send({ action: messages[action], ...(action === "remove" ? { participant_id: button.dataset.participantId } : {}) })) { finish(); feedback(t("connectionLost")); return; }
    timer = setTimeout(() => { finish(); feedback(t("waitingConnection")); }, 8000);
  };
  container.addEventListener("click", click);
  function update(snapshot) {
    if (!snapshot || stopped) return;
    current = snapshot;
    const permissions = current._waiting_permissions || {};
    const available = connected() && !pending && !current._started;
    $("hausdeppHostControls").hidden = !permissions.is_host;
    $("hausdeppAddCpu").disabled = !available || !permissions.can_add_cpu;
    $("hausdeppStartGame").disabled = !available || !permissions.can_start;
    $("hausdeppStartGame").textContent = t("waitingStart", { count: current._participants?.length || 0 });
    $("hausdeppSaveFavourite").disabled = saving || pending || current._started;
    for (const remove of container.querySelectorAll('[data-waiting-action="remove"]')) remove.disabled = !available || !permissions.can_remove_cpu;
  }
  return {
    update, acknowledge: finish,
    reject(code) { finish(); feedback(t(({ hausdepp_waiting_minimum_players: "waitingNeedOne", hausdepp_waiting_not_full: "waitingNeedSeats", hausdepp_waiting_players_offline: "waitingOffline", hausdepp_rematch_reserved_seats: "waitingReserved", hausdepp_game_full: "waitingFull" })[code] || "actionRejected", { count: Math.max(0, Number(current?._expected || 0) - (current?._participants?.length || 0)) })); },
    disconnect() { finish(); },
    destroy() { stopped = true; clearTimeout(timer); lifetime.abort(); container.removeEventListener("click", click); },
  };
}

export function waitingSeatMarkup(player, { t, avatar, isHost, selfId }) {
  return `<li class="${player ? "is-taken" : "is-open"}"><span class="hd-waiting-avatar" aria-hidden="true">${player ? avatar(player) : "+"}</span><strong>${player ? esc(player.name) : t("waitingFreeSeat")}</strong><small>${player ? player.is_cpu ? t("computer") : player.id === selfId ? t("yourSeat") : "" : ""}</small>${player?.is_cpu && isHost ? `<button type="button" class="hd-remove-cpu" data-waiting-action="remove" data-participant-id="${esc(player.id)}" aria-label="${esc(t("waitingRemoveCpu", { name: player.name }))}">×</button>` : ""}</li>`;
}
