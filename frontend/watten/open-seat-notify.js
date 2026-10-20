// A general invitation is sent only after the seated host's explicit click.
const COPY = {
  de: {
    call: "Mitspieler benachrichtigen", busy: "Einladung wird gesendet …",
    sent: "Die Einladung wurde an erreichbare Mitspieler gesendet.",
    empty: "Zurzeit sind keine Mitspieler über Push erreichbar.",
    cooldown: "In {seconds} Sekunden wieder möglich.",
    unavailable: "Einladen ist gerade nicht möglich. Versuche es später nochmals.",
    stale: "Der Tisch hat sich geändert. Prüfe die freien Plätze und versuche es nochmals.",
  },
  en: {
    call: "Notify players", busy: "Sending invitation …",
    sent: "The invitation was sent to reachable players.",
    empty: "No players are currently reachable by push.",
    cooldown: "Available again in {seconds} seconds.",
    unavailable: "Invitations are unavailable right now. Please try again later.",
    stale: "The table has changed. Check the open seats and try again.",
  },
};
const text = (language, key, seconds) => COPY[language === "en" ? "en" : "de"][key].replace("{seconds}", String(seconds));
const languageOfPage = () => globalThis.window?.ZDWA_I18N?.getLanguage?.();

export function canNotifyOpenSeat(snapshot, viewerId = snapshot?.viewer?.participant_id) {
  const room = snapshot?.room;
  if (!viewerId || room?.status !== "waiting" || snapshot.started || room.recipe?.password_required
      || room.series?.teams_locked || viewerId !== room.host_participant_id) return false;
  const member = room.members?.find(member => member.participant_id === viewerId);
  if (!Number.isInteger(member?.seat) || member.seat < 0) return false;
  const cpus = room.seats?.filter(seat => seat.is_cpu).length || 0;
  return room.members.length + cpus < room.recipe.player_count
    && room.seats.some(seat => !seat.participant_id && !seat.is_cpu);
}

export function openSeatNotifyMarkup(snapshot, { member, viewerId, busy = false, language = languageOfPage() }) {
  if (!member || !canNotifyOpenSeat(snapshot, viewerId)) return "";
  return `<div class="wt-open-seat-notify"><button type="button" class="wt-button--ghost wt-button--small" data-watten-notify-open-seat${busy ? " disabled" : ""}>${text(language, "call")}</button>
    <p class="wt-note" data-watten-notify-status role="status"></p><small data-watten-notify-cooldown aria-live="off"></small></div>`;
}

export function createOpenSeatNotifications({ root, gameId, apiFetch, loadAuth, getSnapshot,
  getExpectedAccountId, isCurrent, onAccountChanged, isBusy = () => false,
  language = languageOfPage, win = globalThis.window, now = () => Date.now() }) {
  const accountId = getExpectedAccountId(), lifetime = new AbortController();
  let destroyed = false, busy = false, until = 0, timer = null, status = "";
  const current = () => !destroyed && isCurrent() && getExpectedAccountId() === accountId;
  const allowed = () => current() && canNotifyOpenSeat(getSnapshot());
  const stopTimer = () => { if (timer !== null) win.clearTimeout(timer); timer = null; };
  const seconds = () => Math.max(0, Math.ceil((until - now()) / 1000));
  function paint() {
    stopTimer();
    const button = root.querySelector("[data-watten-notify-open-seat]");
    if (!current() || !button) return;
    button.hidden = !allowed(); button.disabled = busy || isBusy() || seconds() > 0 || !allowed();
    button.textContent = text(language(), busy ? "busy" : "call");
    const output = root.querySelector("[data-watten-notify-status]");
    const message = status ? text(language(), status) : "";
    if (output && output.textContent !== message) output.textContent = message;
    const cooldown = root.querySelector("[data-watten-notify-cooldown]");
    if (cooldown) cooldown.textContent = seconds() ? text(language(), "cooldown", seconds()) : "";
    if (allowed() && seconds()) timer = win.setTimeout(paint, 1000);
  }
  function changedAccount() { destroy(); onAccountChanged(); }
  async function verify() {
    const auth = await loadAuth({ refresh: true });
    if (!current()) return false;
    if (!auth?.authenticated || auth.user?.id !== accountId) { changedAccount(); return false; }
    return true;
  }
  async function send() {
    if (!allowed() || busy || isBusy() || seconds()) return;
    const revision = getSnapshot().room.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) return;
    busy = true; status = ""; paint();
    try {
      if (!await verify() || !allowed()) return;
      const response = await apiFetch(`/api/games/${gameId}/notify-open-seat`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: lifetime.signal,
        headers: { "Content-Type": "application/json", "X-Watten-Expected-Account-Id": String(accountId) },
        body: JSON.stringify({ revision }),
      });
      if (!current()) return;
      const result = await response.json().catch(() => null);
      if (!current()) return;
      if (response.status === 401 || response.status === 409 && result?.detail === "watten_account_changed") {
        changedAccount(); return;
      }
      if (!await verify() || !await verify()) return;
      const retry = Number(result?.retry_after_seconds ?? result?.detail?.retry_after_seconds ?? response.headers?.get("Retry-After"));
      if (Number.isFinite(retry) && retry > 0) until = now() + Math.ceil(retry) * 1000;
      if (response.status === 429) {
        if (!seconds()) until = now() + 60000;
        status = "";
      } else if (response.ok && result?.ok === true && typeof result.notified === "boolean") {
        status = result.notified ? "sent" : "empty";
      } else status = response.status === 409 ? "stale" : "unavailable";
    } catch (error) {
      if (current() && error.name !== "AbortError") status = "unavailable";
    } finally { if (current()) { busy = false; paint(); } }
  }
  const click = event => {
    const button = event.target.closest?.("[data-watten-notify-open-seat]");
    if (button && root.contains(button) && !button.disabled) void send();
  };
  root.addEventListener("click", click);
  function destroy() { destroyed = true; stopTimer(); lifetime.abort(); root.removeEventListener("click", click); }
  return { update: paint, destroy };
}
