import { loadAuth } from './auth.js';
import { ACCOUNT_MERGE_MESSAGES } from '../i18n/catalog.js';

const games = { zdwa: 'ZDWA', zilch: 'Zilch', hausdepp: 'Hausdepp', watten: 'Watten' };
const noticeKey = Symbol.for('rollthedice.account-merge-notice');
const language = () => window.ZDWA_I18N?.getLanguage?.() === 'en' ? 'en' : 'de';
const text = key => ACCOUNT_MERGE_MESSAGES[language()][key];
const number = value => new Intl.NumberFormat(language() === 'en' ? 'en-GB' : 'de-CH').format(Math.max(0, Number(value) || 0));
const rank = value => {
  const label = typeof value === 'string' ? value : value?.title || value?.name || value;
  return typeof label === 'string' ? label : label?.[language()] || value?.key || '—';
};
function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = String(value);
  if (className) element.className = className;
  return element;
}

/** Independent private notice; acknowledging this never consumes game awards. */
export function mountAccountMergeNotice(container, { userId, isCurrent = () => true } = {}) {
  if (!container || !Number.isInteger(userId)) return { destroy() {}, refresh: async () => {} };
  window[noticeKey]?.destroy();
  let epoch = 0, retired = false, suspended = false, inFlight = false, saving = false;
  let controller = new AbortController();
  const current = token => !retired && !suspended && token === epoch && isCurrent() && container.isConnected;
  function clear() { epoch += 1; inFlight = false; saving = false; controller.abort(); controller = new AbortController(); container.replaceChildren(); container.hidden = true; }
  function destroy() {
    if (retired) return;
    retired = true; clear();
    window.removeEventListener('zdwa:auth-state', onAuth);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  async function verify(token) {
    const auth = await loadAuth({ refresh: true });
    if (!current(token)) return null;
    if (!auth.authenticated || auth.user?.id !== userId) { destroy(); return null; }
    return auth;
  }
  async function acknowledge(operation, card, button, status) {
    if (!current(epoch) || button.disabled || saving) return;
    // Invalidate a pending GET before writing, so its earlier unread snapshot
    // cannot restore the acknowledged operation after this request completes.
    epoch += 1; inFlight = false; controller.abort(); controller = new AbortController();
    const token = epoch;
    saving = token; status.textContent = '';
    for (const control of container.querySelectorAll('button')) control.disabled = true;
    try {
      const auth = await verify(token);
      if (!auth || !current(token)) return;
      // Keep the exact mounted account's proof. apiFetch must never substitute
      // another account's cached CSRF token after a late account switch.
      const response = await fetch(`/api/account/merges/${encodeURIComponent(operation.operation_id)}/acknowledge`, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        headers: { 'X-CSRF-Token': auth.user.csrf_token, 'X-Account-Expected-Id': String(userId) },
      });
      if (!current(token)) return;
      if ([401, 409].includes(response.status)) { destroy(); return; }
      if (!await verify(token)) return;
      if (!response.ok) throw new Error('acknowledge');
      card.remove(); container.hidden = container.childElementCount === 0;
    } catch (error) { if (current(token) && error.name !== 'AbortError') status.textContent = text('failed'); }
    finally {
      // An older verification may finish after BFCache restoration and a new
      // ACK. It must not release that newer request's busy state.
      if (saving === token) {
        saving = false;
        if (current(token)) for (const control of container.querySelectorAll('button')) control.disabled = false;
      }
    }
  }
  function render(operations) {
    container.replaceChildren();
    for (const operation of operations) {
      if (operation.acknowledged || operation.target_user_id !== userId || typeof operation.operation_id !== 'string') continue;
      const card = node('section', undefined, 'account-merge-notice');
      card.dataset.accountMergeOperation = operation.operation_id;
      card.append(node('h2', text('title')), node('p', text('intro')));
      const list = node('dl', undefined, 'account-merge-notice__games');
      for (const [key, name] of Object.entries(games)) {
        const value = operation.games?.[key];
        if (!value) continue;
        const row = node('div');
        row.append(node('dt', name));
        const details = node('dd');
        details.append(node('strong', `${number(value.before_points)} → ${number(value.after_points)} ${text('points')}`));
        details.append(node('span', `${rank(value.before_rank)} → ${rank(value.after_rank)}`));
        details.append(node('span', text('counts').replace('{achievements}', number(value.achievement_count))
          .replace('{inherited}', number(value.inherited_achievement_count)).replace('{new}', number(value.new_achievement_count))
          .replace('{games}', number(value.games_played))));
        row.append(details); list.append(row);
      }
      const button = node('button', text('acknowledge'), 'primary'); button.type = 'button';
      const status = node('p', '', 'account-merge-notice__status'); status.setAttribute('role', 'status');
      button.addEventListener('click', () => { void acknowledge(operation, card, button, status); });
      card.append(list, button, status); container.append(card);
    }
    container.hidden = container.childElementCount === 0;
  }
  async function refresh() {
    if (retired || suspended || inFlight || saving || !isCurrent() || !container.isConnected) return;
    inFlight = true;
    const token = epoch;
    try {
      if (!await verify(token)) return;
      const response = await fetch('/api/account/merges/pending', { cache: 'no-store', credentials: 'same-origin',
        headers: { 'X-Account-Expected-Id': String(userId) }, signal: controller.signal });
      if (!current(token)) return;
      if ([401, 409].includes(response.status)) { destroy(); return; }
      if (!response.ok) return;
      const result = await response.json();
      if (!current(token) || !await verify(token)) return;
      if (result.viewer_id !== userId || !Array.isArray(result.operations)) { clear(); return; }
      render(result.operations);
    } catch (error) { /* An unavailable optional notice never blocks the account. */ }
    finally { if (token === epoch) inFlight = false; }
  }
  function onAuth(event) { if (!event.detail?.authenticated || event.detail.user?.id !== userId) destroy(); }
  function onHide() { suspended = true; clear(); }
  function onShow(event) { if (event.persisted && !retired) { suspended = false; void refresh(); } }
  function onFocus() { void refresh(); }
  function onVisibility() { if (document.visibilityState === 'visible') void refresh(); }
  window.addEventListener('zdwa:auth-state', onAuth);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  const api = { destroy, refresh }; window[noticeKey] = api;
  void refresh();
  return api;
}
