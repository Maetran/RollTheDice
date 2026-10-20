import { WATTEN_REMATCH_MESSAGES } from "../i18n/catalog.js";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && value.length === 16 && /^[0-9a-f]+$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const lang = language => language === "en" ? "en" : "de";
const message = (language, key, values = {}) => WATTEN_REMATCH_MESSAGES[lang(language)][key]
  .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));

/** The server projects only this account's reservation; it never claims a seat. */
export function reservationMarkup(reservation, { language, escapeHtml: esc, canDecline = false, busy = false }) {
  if (!object(reservation) || !integer(reservation.seat) || reservation.seat > 3
      || typeof reservation.expires_at !== "string" || !Number.isFinite(Date.parse(reservation.expires_at))) return "";
  const expires = new Intl.DateTimeFormat(lang(language) === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich",
  }).format(new Date(reservation.expires_at));
  return `<p class="wt-note wt-note--strong" data-watten-rematch-reservation>${esc(message(language, "reservation", {
    seat: reservation.seat + 1, expires,
  }))}${canDecline ? ` <button type="button" data-watten-command="decline-reservation" ${busy ? "disabled" : ""}>${esc(message(language, "declineReservation"))}</button>` : ""}</p>`;
}

/** Explicit new-room intent; no automatic join, seat, team confirmation or start. */
export function createRematch({ gameId, fetcher, loadAuth, escapeHtml: esc,
  getExpectedAccountId, isCurrent, onAccountChanged, navigate, makeCommandId,
  language = () => globalThis.window?.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de" }) {
  const accountId = getExpectedAccountId();
  let container = null, snapshot = null, active = false, destroyed = false, serial = 0, controller = null;
  let busy = false, blocked = false, error = "", envelope = null, markup = null;
  const current = token => !destroyed && active && token === serial && isCurrent()
    && getExpectedAccountId() === accountId;
  const t = (key, values) => message(language(), key, values);
  const target = () => id(snapshot?.room?.rematch?.game_id) && snapshot.room.rematch.game_id !== gameId
    ? snapshot.room.rematch.game_id : null;

  function render() {
    if (!container) return;
    if (!current(serial)) { container.replaceChildren(); container.hidden = true; markup = null; return; }
    const existing = target(), disabled = busy || blocked;
    const action = existing ? "open" : envelope ? error === "stale" ? "reload" : "retry" : "create";
    const content = `<section class="wt-card-panel wt-rematch" aria-labelledby="wattenRematchTitle">
      <h3 id="wattenRematchTitle">${esc(t("heading"))}</h3>
      <button type="button" class="wt-primary" data-watten-rematch-action="${action}"${disabled ? " disabled" : ""}>${esc(t(busy ? "busy" : action))}</button>
      <p class="wt-error" role="alert" data-watten-rematch-error>${esc(error ? t(error) : "")}</p></section>`;
    container.hidden = false;
    if (content !== markup) { container.innerHTML = content; markup = content; }
  }

  function changedAccount() { destroy(); onAccountChanged(); }

  async function verify(token, afterBody = false) {
    let auth;
    for (let index = 0; index < (afterBody ? 2 : 1); index += 1) {
      auth = await loadAuth({ refresh: true });
      if (!current(token)) return null;
      if (!auth?.authenticated || auth.user?.id !== accountId) { changedAccount(); return null; }
    }
    return auth;
  }

  async function send() {
    if (!current(serial) || busy || blocked || target()) return;
    const revision = snapshot.room.revision;
    const token = ++serial;
    busy = true; error = ""; render();
    controller?.abort(); controller = new AbortController();
    try {
      const auth = await verify(token); if (!auth) return;
      if (!envelope) {
        if (typeof auth.user.csrf_token !== "string" || !auth.user.csrf_token) throw new Error("missing csrf");
        envelope = {
          body: JSON.stringify({ command_id: makeCommandId(), revision }),
          csrf: auth.user.csrf_token,
        };
      }
      const captured = envelope;
      const response = await fetcher(`/api/watten/games/${gameId}/rematch`, {
        method: "POST", cache: "no-store", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": captured.csrf,
          "X-Watten-Expected-Account-Id": String(accountId) }, body: captured.body,
      });
      if (!current(token)) return;
      const result = await response.json().catch(() => null);
      if (!current(token)) return;
      if (response.status === 401 || (response.status === 409 && result?.detail === "watten_account_changed")) {
        changedAccount(); return;
      }
      if (!await verify(token, true)) return;
      if (!response.ok) {
        error = response.status === 409 || response.status === 403 && result?.detail === "csrf_rejected" ? "stale" : "unavailable";
        throw new Error("rematch unavailable");
      }
      if (!object(result) || result.schema_version !== 1 || result.game_type !== "watten"
          || result.source_game_id !== gameId || !id(result.game_id) || result.game_id === gameId
          || typeof result.created !== "boolean" || !integer(result.source_revision) || !integer(result.room_revision)) {
        throw new Error("invalid rematch response");
      }
      envelope = null;
      navigate(`/watten/spiel/${result.game_id}`);
    } catch (failure) {
      if (!current(token) || failure.name === "AbortError") return;
      if (!error) error = "unavailable";
    } finally {
      if (current(token)) { busy = false; render(); }
    }
  }

  async function open() {
    if (!current(serial) || busy || blocked || !target()) return;
    const token = ++serial, destination = target();
    busy = true; error = ""; render();
    try {
      if (await verify(token) && target() === destination) navigate(`/watten/spiel/${destination}`);
    } catch { if (current(token)) error = "unavailable"; }
    finally { if (current(token)) { busy = false; render(); } }
  }

  function click(event) {
    const control = event.target.closest?.("[data-watten-rematch-action]");
    if (!control || control.disabled || !container?.contains(control)) return;
    if (["create", "retry"].includes(control.dataset.wattenRematchAction)) void send();
    if (control.dataset.wattenRematchAction === "open") void open();
    if (control.dataset.wattenRematchAction === "reload" && current(serial) && !busy) {
      envelope = null; navigate(`/watten/spiel/${gameId}`);
    }
  }
  function detach() {
    if (!container) return;
    for (const [name, handler] of [["click", click]]) {
      container.removeEventListener(name, handler);
    }
    container.replaceChildren(); container.hidden = true;
  }
  function update({ container: next, snapshot: latest, playerId, spectator, busy: externallyBusy = false }) {
    if (destroyed) return;
    if (next !== container) {
      detach(); container = next; markup = null;
      for (const [name, handler] of [["click", click]]) {
        container?.addEventListener(name, handler);
      }
    }
    snapshot = latest; blocked = externallyBusy;
    active = Boolean(container && id(gameId) && Number.isSafeInteger(accountId) && accountId > 0
      && latest?.id === gameId && latest.game_type === "watten" && integer(latest.room?.revision)
      && ["finished", "closed"].includes(latest.room?.status) && !spectator && typeof playerId === "string"
      && latest.viewer?.participant_id === playerId && object(latest.room.rematch)
      && (latest.room.rematch.can_create === true || target()));
    if (!active) { serial += 1; controller?.abort(); envelope = null; busy = false; }
    if (target()) envelope = null;
    render();
  }
  function destroy() {
    destroyed = true; active = false; serial += 1; controller?.abort(); envelope = null;
    detach(); container = null;
  }
  return { update, destroy };
}
