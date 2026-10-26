import { escapeHtml as esc } from "../shared/auth.js";
import { t } from "./cards.js";
import { lobbyText as lt } from "./lobby-copy.js";

export const WATTEN_FEATURE_FIELDS = Object.freeze({
  "watten.schoeneres": "schoeneres_enabled", "watten.schlagwechsel": "schlagwechsel_enabled",
  "watten.critical": "critical", "watten.show_rechter": "show_rechter",
  "watten.trick_history": "trick_history", "watten.open_partner_hand": "partner_hand",
});
const text = value => globalThis.window?.ZDWA_I18N?.t(value) ?? value;

export function featureLabel(key) {
  if (key === "watten.schoeneres") return lt("schoeneres");
  if (key === "watten.schlagwechsel") return text("Schlagwechsel erlauben");
  return t({ "watten.critical": "create.critical", "watten.show_rechter": "create.showRechter",
    "watten.trick_history": "create.trickHistory", "watten.open_partner_hand": "create.partnerHand" }[key]);
}

export function featureBetaMarkup(setting, key) {
  return setting?.status === "public" && setting.beta === true
    ? `<span class="wt-tag" data-watten-feature-beta="${esc(key)}">Beta</span>` : "";
}

/** A favorite and a count change must pass through the same availability gate. */
export function restrictCreatorFeatures(form, features) {
  const removed = [];
  let visible = false;
  for (const [key, field] of Object.entries(WATTEN_FEATURE_FIELDS)) {
    const input = form.elements[field];
    const setting = features?.[key];
    const available = setting?.can_select === true && ["internal", "public"].includes(setting.status);
    visible ||= available;
    input.closest("[data-watten-create-feature]").hidden = !available;
    const badge = form.querySelector(`[data-watten-feature-beta="${key}"]`);
    if (badge) badge.hidden = !available || setting.status !== "public" || setting.beta !== true;
    if (!available) {
      if (input.checked) removed.push(key);
      input.checked = false;
      input.disabled = true;
    }
  }
  const advanced = form.querySelector("[data-watten-advanced]");
  if (advanced) advanced.hidden = !visible;
  return removed;
}

export function waitingFeatureControlsMarkup(room, { member = false, busy = false } = {}) {
  if (!member || room.status !== "waiting") return "";
  const controls = Object.keys(WATTEN_FEATURE_FIELDS).filter(key => room.feature_controls?.[key]?.can_select === true);
  if (!controls.length) return "";
  return `<details class="wt-more" data-watten-table-features><summary>${esc(text("Spielfunktionen"))}</summary>
    <p class="wt-note">${esc(text("Interne Funktionen können mit allen Mitspielern getestet werden. Ein Owner oder Admin muss dafür mitspielen."))}</p>
    ${controls.map(key => {
      const setting = room.feature_controls[key];
      return `<label class="wt-check"><input type="checkbox" data-watten-command="set-feature" data-feature="${esc(key)}"
        data-enabled="${setting.enabled ? "false" : "true"}"${setting.enabled ? " checked" : ""}${busy || !setting.enabled && setting.can_enable !== true ? " disabled" : ""}>
        <span>${esc(featureLabel(key))} ${featureBetaMarkup(setting, key)}${setting.status === "internal" ? ` <small>${esc(text("Intern"))}</small>` : ""}</span></label>`;
    }).join("")}</details>`;
}

function validFeatures(data, accountId) {
  if (data?.viewer_id !== accountId) return null;
  for (const key of Object.keys(WATTEN_FEATURE_FIELDS)) {
    const entry = data.features?.[key];
    if (!entry || !["off", "internal", "public"].includes(entry.status) || typeof entry.beta !== "boolean"
        || typeof entry.can_select !== "boolean" || entry.status === "off" && entry.can_select
        || entry.status !== "public" && entry.beta) return null;
  }
  return data.features;
}

/** A late policy response must never expose the previous account's controls. */
export function createCreatorFeaturePolicy({ accountId, fetcher, loadAuth, isCurrent, onAccountChanged, onChange }) {
  let destroyed = false, serial = 0, controller = null;
  let state = { loading: false, failed: false, features: null };
  const current = token => !destroyed && token === serial && isCurrent();
  const notify = next => { state = next; onChange(state); };
  function changedAccount() { destroy(); onAccountChanged(); }
  async function verify(token) {
    const auth = await loadAuth({ refresh: true });
    if (!current(token)) return false;
    if (!auth?.authenticated || auth.user?.id !== accountId) { changedAccount(); return false; }
    return true;
  }
  async function refresh() {
    if (destroyed || !isCurrent()) return;
    const token = ++serial;
    controller?.abort(); controller = new AbortController();
    notify({ loading: true, failed: false, features: null });
    try {
      if (!await verify(token)) return;
      const response = await fetcher("/api/features", { cache: "no-store", credentials: "same-origin",
        headers: { "X-Watten-Expected-Account-Id": String(accountId) }, signal: controller.signal });
      if (!current(token)) return;
      const data = await response.json().catch(() => null);
      if (!current(token)) return;
      if (response.status === 401 || response.status === 409 && ["account_changed", "watten_account_changed"].includes(data?.detail)) {
        changedAccount(); return;
      }
      if (!await verify(token)) return;
      if (response.ok && data && Object.hasOwn(data, "viewer_id") && data.viewer_id !== accountId) { changedAccount(); return; }
      const features = response.ok ? validFeatures(data, accountId) : null;
      if (!features) throw new Error("feature_policy_unavailable");
      notify({ loading: false, failed: false, features });
    } catch (error) {
      if (current(token) && error.name !== "AbortError") notify({ loading: false, failed: true, features: null });
    }
  }
  function destroy() { destroyed = true; serial += 1; controller?.abort(); state = { loading: false, failed: false, features: null }; }
  return { refresh, destroy, getState: () => state };
}
