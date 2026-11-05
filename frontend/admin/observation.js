import { apiFetch, escapeHtml, loadAuth } from '../shared/auth.js';
import { OBSERVATION_MESSAGES } from '../i18n/catalog.js';

// Private administration. The server makes every authorization and recording
// decision; the panel never infers access from the selection itself.
export function mountObservation(panel) {
  const area = panel?.querySelector('[data-observation-panel]');
  const content = area?.querySelector('[data-observation-content]');
  const status = area?.querySelector('[data-observation-status]');
  if (!area || !content || !status || area.dataset.mounted) return;
  area.dataset.mounted = 'true';
  const lang = () => window.ZDWA_I18N?.getLanguage?.() === 'en' ? 'en' : 'de';
  const text = (key, values = {}) => String(OBSERVATION_MESSAGES[lang()][key] || key)
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  const esc = escapeHtml;
  let viewer = null, snapshot = null, draft = null, busy = false, retired = false, dirty = false, epoch = 0;
  let controller = new AbortController(), searchResults = [], searchEpoch = 0;

  function message(key = '', error = false) { status.textContent = key ? text(key) : ''; status.classList.toggle('error', error); }
  function invalidate() { epoch += 1; controller.abort(); controller = new AbortController(); }
  function retire() {
    invalidate(); retired = true; busy = false; snapshot = null; draft = null; searchResults = [];
    content.replaceChildren(); area.setAttribute('aria-busy', 'false'); message('accessLost', true);
  }
  function current(token) { return !retired && token === epoch && area.isConnected; }
  async function verify(token, write = false) {
    const auth = await loadAuth({ refresh: true });
    if (!current(token)) return false;
    if (!auth?.authenticated || auth.user?.id !== viewer || auth.user?.is_admin !== true
        || (write && !auth.user.is_owner && !auth.user.is_founder)) { retire(); return false; }
    return true;
  }
  async function request(url, token, options = {}) {
    const response = await apiFetch(url, { ...options, cache: 'no-store', signal: controller.signal,
      headers: { 'X-Account-Expected-Id': String(viewer), ...(options.headers || {}) } });
    if (!current(token)) throw new DOMException('Obsolete request', 'AbortError');
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403 || payload.detail === 'account_changed') { retire(); throw new Error('accessLost'); }
      throw new Error(response.status === 409 ? 'conflict' : 'failed');
    }
    return response.json();
  }
  function draw() {
    area.querySelector('#observationHeading').textContent = text('heading');
    if (retired) return;
    if (!snapshot || !draft) { content.innerHTML = `<button type="button" class="secondary" data-observation-reload${busy ? ' disabled' : ''}>${esc(text('reload'))}</button>`; return; }
    const disabled = !snapshot.can_manage || busy ? ' disabled' : '';
    const choice = draft.players.length ? draft.players.map(player => `<li><span>${esc(player.username)} · #${player.id}</span>
      <button type="button" class="small secondary" data-observation-remove="${player.id}"${disabled} aria-label="${esc(text('remove'))}: ${esc(player.username)}">${esc(text('remove'))}</button></li>`).join('')
      : `<li>${esc(text('empty'))}</li>`;
    const results = searchResults.map(player => `<li><span>${esc(player.username)} · #${player.id}</span>
      <button type="button" class="small secondary" data-observation-add="${player.id}"${disabled} aria-label="${esc(text('add'))}: ${esc(player.username)}">${esc(text('add'))}</button></li>`).join('');
    content.innerHTML = `<p>${esc(text('intro'))}</p><p class="muted small">${esc(text('retention', { days: snapshot.retention_days }))} ${esc(text('permission'))}</p>
      <form data-observation-form><label class="observation-enabled"><input type="checkbox" name="enabled"${draft.enabled ? ' checked' : ''}${disabled}> ${esc(text('enabled'))}</label>
      <label>${esc(text('scope'))}<select name="mode"${disabled}><option value="all"${draft.mode === 'all' ? ' selected' : ''}>${esc(text('all'))}</option><option value="selected"${draft.mode === 'selected' ? ' selected' : ''}>${esc(text('selected'))}</option></select></label>
      <div data-observation-selection${draft.mode === 'selected' ? '' : ' hidden'}><h4>${esc(text('selectedTitle'))}</h4><ul class="observation-list" data-observation-selected>${choice}</ul>
      <label>${esc(text('searchLabel'))}<input name="query" type="search" maxlength="32" autocomplete="off"${disabled}></label>
      <button type="button" class="secondary" data-observation-search${disabled}>${esc(text('search'))}</button>
      <p class="muted small" role="status" data-observation-search-status></p><ul class="observation-list" data-observation-results>${results}</ul></div>
      <div class="observation-actions"><button class="primary" type="submit"${disabled}>${esc(text('save'))}</button><button class="secondary" type="button" data-observation-reload${busy ? ' disabled' : ''}>${esc(text('reload'))}</button></div></form>
      <div class="observation-actions"><button type="button" class="secondary" data-observation-export${disabled}>${esc(text('export'))}</button></div>
      <details data-observation-delete><summary>${esc(text('deleteTitle'))}</summary><p>${esc(text('deleteHint'))}</p>
      <label class="observation-enabled"><input type="checkbox" data-observation-confirm${disabled}> ${esc(text('deleteConfirm'))}</label>
      <button type="button" class="secondary" data-observation-delete-button disabled>${esc(text('deleteButton'))}</button></details>`;
  }
  function setBusy(value) { busy = value; area.setAttribute('aria-busy', String(value)); draw(); }
  function validSnapshot(value) {
    return value?.viewer_id === viewer && typeof value.can_manage === 'boolean' && typeof value.enabled === 'boolean'
      && ['all', 'selected'].includes(value.mode) && Number.isSafeInteger(value.version)
      && Number.isSafeInteger(value.retention_days) && Array.isArray(value.selected_players)
      && value.selected_players.every(item => Number.isSafeInteger(item.id) && item.id > 0 && typeof item.username === 'string');
  }
  function assign(value) {
    if (!validSnapshot(value)) throw new Error('failed');
    dirty = false; snapshot = value; draft = { enabled: value.enabled, mode: value.mode, players: value.selected_players.map(item => ({ id: item.id, username: item.username })) };
    searchResults = [];
  }
  async function load() {
    if (busy || retired || !viewer) return;
    invalidate(); const token = epoch; setBusy(true); message('loading');
    try {
      if (!await verify(token)) return;
      const value = await request('/api/admin/observation', token); if (!current(token)) return;
      assign(value); message();
    } catch (error) { if (current(token) && error.name !== 'AbortError') { snapshot = null; draft = null; content.replaceChildren(); message('loadFailed', true); } }
    finally { if (current(token)) setBusy(false); }
  }
  async function save(event) {
    if (!event.target.matches('[data-observation-form]')) return;
    event.preventDefault(); if (busy || retired || !snapshot?.can_manage) return;
    const payload = { enabled: draft.enabled, mode: draft.mode, selected_user_ids: draft.players.map(player => player.id), version: snapshot.version };
    invalidate(); const token = epoch; setBusy(true); message('saving');
    try {
      if (!await verify(token, true)) return;
      const value = await request('/api/admin/observation', token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!current(token)) return; assign(value); message('saved');
    } catch (error) { if (current(token) && error.name !== 'AbortError') message(error.message === 'conflict' ? 'conflict' : 'failed', true); }
    finally { if (current(token)) setBusy(false); }
  }
  async function search() {
    if (busy || !snapshot?.can_manage || retired) return;
    const query = content.querySelector('[name="query"]')?.value.trim(); if (!query) return;
    const token = epoch, searchToken = ++searchEpoch; const output = content.querySelector('[data-observation-search-status]'); output.textContent = text('searching');
    try {
      if (!await verify(token, true)) return;
      const payload = await request(`/api/admin/observation/players?${new URLSearchParams({ query })}`, token);
      if (!current(token) || searchToken !== searchEpoch) return;
      if (!Array.isArray(payload.players)) throw new Error('failed');
      searchResults = payload.players.filter(item => Number.isSafeInteger(item.id) && item.id > 0 && typeof item.username === 'string' && !draft.players.some(player => player.id === item.id));
      draw(); content.querySelector('[data-observation-search-status]').textContent = searchResults.length ? '' : text('noResults');
      content.querySelector('[name="query"]').value = query;
    } catch (error) { if (current(token) && searchToken === searchEpoch && error.name !== 'AbortError') output.textContent = text('failed'); }
  }
  async function removeRecordings() {
    if (busy || retired || !snapshot?.can_manage || !content.querySelector('[data-observation-confirm]')?.checked) return;
    const version = snapshot.version; invalidate(); const token = epoch; setBusy(true); message('saving');
    try {
      if (!await verify(token, true)) return;
      await request('/api/admin/observation/recordings', token, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
      if (!current(token)) return; busy = false; await load(); if (snapshot) message('deleted');
    } catch (error) { if (current(token) && error.name !== 'AbortError') message(error.message === 'conflict' ? 'conflict' : 'failed', true); }
    finally { if (current(token)) setBusy(false); }
  }
  async function exportRecordings() {
    if (busy || retired || !snapshot?.can_manage) return;
    invalidate(); const token = epoch; setBusy(true); message('exporting');
    try {
      if (!await verify(token, true)) return;
      const recordings = [], cursors = new Set(); let before = null, eventCount = 0;
      do {
        const query = new URLSearchParams({ limit: '50' }); if (before) query.set('before', before);
        const page = await request(`/api/admin/observation/recordings?${query}`, token);
        if (!Array.isArray(page.items)) throw new Error('failed');
        for (const item of page.items) {
          if (!item || typeof item.id !== 'string' || recordings.length >= 10000) throw new Error('failed');
          const events = []; let after = null; const seen = new Set();
          do {
            const params = new URLSearchParams({ limit: '100' }); if (after !== null) params.set('after', String(after));
            const eventsPage = await request(`/api/admin/observation/recordings/${encodeURIComponent(item.id)}/events?${params}`, token);
            if (!Array.isArray(eventsPage.items) || eventCount + eventsPage.items.length > 200000) throw new Error('failed');
            eventCount += eventsPage.items.length; events.push(...eventsPage.items); after = eventsPage.next_after ?? null;
            if (after !== null && (seen.has(after) || !Number.isSafeInteger(after))) throw new Error('failed');
            if (after !== null) seen.add(after);
          } while (after !== null);
          recordings.push({ ...item, events });
        }
        before = page.next_cursor ?? null;
        if (before !== null && (typeof before !== 'string' || cursors.has(before))) throw new Error('failed');
        if (before !== null) cursors.add(before);
      } while (before !== null);
      if (!await verify(token, true)) return;
      const blob = new Blob([JSON.stringify({ schema_version: 1, recordings }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'spielbeobachtung.json'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000); message('exported');
    } catch (error) { if (current(token) && error.name !== 'AbortError') message('exportFailed', true); }
    finally { if (current(token)) setBusy(false); }
  }
  area.addEventListener('submit', save);
  area.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.name === 'query') { event.preventDefault(); void search(); }
  });
  area.addEventListener('input', event => { if (event.target.name === 'query') searchEpoch += 1; });
  area.addEventListener('change', event => {
    if (!draft) return;
    if (event.target.name === 'enabled') { draft.enabled = event.target.checked; dirty = true; }
    if (event.target.name === 'mode') { draft.mode = event.target.value; dirty = true; content.querySelector('[data-observation-selection]').hidden = draft.mode !== 'selected'; }
    if (event.target.matches('[data-observation-confirm]')) content.querySelector('[data-observation-delete-button]').disabled = !event.target.checked || !snapshot?.can_manage;
  });
  area.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || busy || retired) return;
    if (button.matches('[data-observation-reload]')) void load();
    else if (button.matches('[data-observation-search]')) void search();
    else if (button.matches('[data-observation-export]')) void exportRecordings();
    else if (button.matches('[data-observation-delete-button]')) void removeRecordings();
    else if (button.dataset.observationAdd) {
      const player = searchResults.find(item => item.id === Number(button.dataset.observationAdd));
      if (player && !draft.players.some(item => item.id === player.id)) { draft.players.push(player); dirty = true; }
      searchResults = searchResults.filter(item => item.id !== player?.id); draw();
    } else if (button.dataset.observationRemove) { dirty = true; draft.players = draft.players.filter(item => item.id !== Number(button.dataset.observationRemove)); draw(); }
  });
  window.addEventListener('zdwa:languagechange', draw);
  window.addEventListener('focus', () => { if (!panel.hidden && snapshot && !dirty && !busy && !retired) void load(); });
  window.addEventListener('zdwa:auth-state', event => {
    const auth = event.detail;
    if (viewer && (!auth?.authenticated || auth.user?.id !== viewer || !auth.user?.is_admin
      || (snapshot?.can_manage && !auth.user?.is_owner && !auth.user?.is_founder))) retire();
  });
  window.addEventListener('pagehide', () => { invalidate(); retired = true; snapshot = null; draft = null; searchResults = []; content.replaceChildren(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { retired = false; busy = false; if (!panel.hidden) void load(); } });
  new MutationObserver(() => { if (!panel.hidden && viewer && !retired && !snapshot) void load(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  void loadAuth().then(auth => {
    if (!auth?.authenticated || !auth.user?.is_admin) { retire(); return; }
    viewer = auth.user.id; if (!panel.hidden) void load();
  }).catch(() => { message('loadFailed', true); });
}
