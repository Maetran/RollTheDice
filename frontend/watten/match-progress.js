import { WATTEN_MATCH_PROGRESS_MESSAGES } from "../i18n/catalog.js";

const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0;
const translated = value => object(value) && text(value.de) && text(value.en);

/** Server-projected public title only; null never becomes a guessed default. */
export function publicTitleMarkup(title, { language, escapeHtml: esc }) {
  if (!object(title) || !integer(title.level, 1) || !integer(title.threshold) || !translated(title.name)) return "";
  const lang = language === "en" ? "en" : "de";
  const label = WATTEN_MATCH_PROGRESS_MESSAGES[lang].publicTitle
    .replace(/\{(\w+)\}/g, (_, key) => String(key === "name" ? title.name[lang] : title.level));
  return `<span class="wt-seat-meta wt-seat-public-title" translate="no" aria-label="${esc(label)}">${esc(title.name[lang])}</span>`;
}

function validPresentation(value, gameId) {
  if (!object(value) || value.schema_version !== 1 || value.game_type !== "watten" || value.status !== "draft"
      || value.game_id !== gameId || !integer(value.generation, 1) || !integer(value.through_sequence)
      || !object(value.title) || !integer(value.title.level, 1) || !integer(value.title.threshold)
      || !translated(value.title.name) || !Array.isArray(value.achievements)) return false;
  if (value.credit !== null && (!object(value.credit) || !integer(value.credit.xp)
      || !["won", "lost"].includes(value.credit.outcome))) return false;
  const ids = new Set();
  for (const item of value.achievements) {
    if (!object(item) || !text(item.id) || ids.has(item.id) || !translated(item.name) || !integer(item.xp)) return false;
    ids.add(item.id);
  }
  return (value.through_sequence === 0) === (value.credit === null && value.achievements.length === 0);
}

/** One match's private presentation; transport/auth stay with the native caller. */
export function createMatchProgress({ gameId, apiFetch, loadAuth, escapeHtml,
  getExpectedAccountId, isCurrent, onAccountChanged,
  language = () => globalThis.window?.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de" }) {
  const expectedAccountId = getExpectedAccountId();
  const endpoint = `/api/watten/account/matches/${gameId}/presentation`;
  const esc = escapeHtml;
  let container = null, active = false, destroyed = false, serial = 0, controller = null;
  let state = "idle", value = null, errorStage = "load", errorKey = "unavailable";
  const lang = () => language() === "en" ? "en" : "de";
  const t = (key, values = {}) => WATTEN_MATCH_PROGRESS_MESSAGES[lang()][key]
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  const number = amount => new Intl.NumberFormat(lang() === "de" ? "de-CH" : "en-GB").format(amount);
  const current = token => !destroyed && active && token === serial && isCurrent()
    && expectedAccountId === getExpectedAccountId();

  function render() {
    if (!container) return;
    if (!current(serial) || ["idle", "empty", "dismissed"].includes(state)) {
      container.replaceChildren(); container.hidden = true; return;
    }
    container.hidden = false;
    const body = value ? `<p><strong>${esc(t("xp", { xp: number((value.credit?.xp || 0)
      + value.achievements.reduce((sum, item) => sum + item.xp, 0)) }))}</strong></p>
      <p>${esc(t("title", { name: value.title.name[lang()], level: value.title.level }))}</p>
      ${value.achievements.length ? `<h5>${esc(t("achievements"))}</h5><ul>${value.achievements.map(item =>
        `<li>${esc(item.name[lang()])} · ${esc(t("xp", { xp: number(item.xp) }))}</li>`).join("")}</ul>` : ""}` : "";
    const action = state === "error" ? `<p class="wt-error" role="alert">${esc(t(errorKey))}</p>
      <button type="button" data-watten-match-progress-action="retry">${esc(t("retry"))}</button>`
      : state === "loading" ? `<p role="status">${esc(t("loading"))}</p>`
        : `<button type="button" data-watten-match-progress-action="dismiss"${state === "saving" ? " disabled" : ""}>
          ${esc(t(state === "saving" ? "saving" : "dismiss"))}</button>`;
    container.innerHTML = `<section class="wt-card-panel wt-match-progress" aria-labelledby="wattenMatchProgressTitle">
      <h4 id="wattenMatchProgressTitle">${esc(t("heading"))}</h4>
      <p class="wt-note">${esc(t("draft"))}</p>${body}${action}</section>`;
  }

  function changedAccount() {
    destroy();
    onAccountChanged();
  }

  async function verifyIdentity(token, afterBody = false) {
    // A focus handler may already have an older /me request in flight. Await
    // that shared request first, then require one started after this body.
    for (let index = 0; index < (afterBody ? 2 : 1); index += 1) {
      const auth = await loadAuth({ refresh: true });
      if (!current(token)) return false;
      if (!auth?.authenticated || auth.user?.id !== expectedAccountId) { changedAccount(); return false; }
    }
    return true;
  }

  async function send(acknowledge) {
    if (!current(serial) || ["loading", "saving"].includes(state)) return;
    const token = ++serial;
    controller?.abort(); controller = new AbortController();
    const shown = value;
    state = acknowledge ? "saving" : "loading";
    if (!acknowledge) value = null;
    render();
    try {
      if (!await verifyIdentity(token)) return;
      const headers = { "X-Watten-Expected-Account-Id": String(expectedAccountId) };
      const options = { cache: "no-store", signal: controller.signal, headers };
      if (acknowledge) {
        headers["Content-Type"] = "application/json";
        options.method = "POST";
        options.body = JSON.stringify({ generation: shown.generation, through_sequence: shown.through_sequence });
      }
      const response = await apiFetch(endpoint + (acknowledge ? "/acknowledge" : ""), options);
      if (!current(token)) return;
      const result = await response.json().catch(() => null);
      if (!current(token)) return;
      if (response.status === 401 || (response.status === 409 && result?.detail === "watten_account_changed")) {
        changedAccount(); return;
      }
      if (!response.ok) {
        errorStage = response.status === 409 ? "load" : acknowledge ? "acknowledge" : "load";
        errorKey = response.status === 409 ? "stale" : "unavailable";
        throw new Error("watten_match_presentation_unavailable");
      }
      // The expected-account header binds the request cookie; a new /me after
      // the body also prevents an earlier account's delayed response mounting.
      if (!await verifyIdentity(token, true)) return;
      if (acknowledge) {
        if (!object(result) || result.ok !== true || result.game_id !== gameId || result.generation !== shown.generation
            || !integer(result.through_sequence) || result.through_sequence < shown.through_sequence) {
          throw new Error("watten_match_presentation_invalid_ack");
        }
        value = null; state = "dismissed";
      } else {
        if (!validPresentation(result, gameId)) throw new Error("watten_match_presentation_invalid_response");
        value = result; state = result.through_sequence ? "ready" : "empty";
      }
      render();
    } catch (error) {
      if (!current(token) || error.name === "AbortError") return;
      state = "error";
      render();
    }
  }

  function clicked(event) {
    const control = event.target.closest?.("[data-watten-match-progress-action]");
    if (!control || control.disabled || !container?.contains(control) || !current(serial)) return;
    if (control.dataset.wattenMatchProgressAction === "dismiss" && state === "ready") {
      errorStage = "acknowledge"; errorKey = "unavailable"; void send(true);
    } else if (control.dataset.wattenMatchProgressAction === "retry" && state === "error") {
      const acknowledge = errorStage === "acknowledge" && value !== null;
      errorKey = "unavailable"; void send(acknowledge);
    }
  }

  function update({ container: next, snapshot, playerId, spectator }) {
    if (destroyed) return;
    const changedContainer = next !== container;
    if (changedContainer) {
      container?.removeEventListener("click", clicked); container?.replaceChildren();
      container = next;
      container?.addEventListener("click", clicked);
    }
    const eligible = Boolean(container && /^[0-9a-f]{16}$/.test(gameId) && integer(expectedAccountId, 1)
      && snapshot?.id === gameId && snapshot.game_type === "watten" && snapshot.result_persisted === true
      && snapshot.engine?.phase === "match_complete" && !spectator && text(playerId)
      && snapshot.viewer?.participant_id === playerId && snapshot.engine.viewer?.player_id === playerId
      && integer(snapshot.engine.viewer?.seat));
    if (!eligible || !isCurrent() || getExpectedAccountId() !== expectedAccountId) {
      if (active) { serial += 1; controller?.abort(); value = null; state = "idle"; }
      active = false; render(); return;
    }
    active = true;
    if (changedContainer) render();
    if (state === "idle") void send(false);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true; active = false; serial += 1; controller?.abort(); value = null;
    container?.removeEventListener("click", clicked); container?.replaceChildren();
    if (container) container.hidden = true;
    container = null;
  }

  return { update, destroy };
}
