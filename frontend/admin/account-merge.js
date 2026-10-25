import { loadAuth } from '../shared/auth.js';
import { passkeysSupported, requestPasskeyAssertion } from '../shared/passkeys.js';

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const language = () => window.ZDWA_I18N?.getLanguage?.() === 'en' ? 'en' : 'de';
const games = { zdwa: 'ZDWA', zilch: 'Zilch', hausdepp: 'Hausdepp', watten: 'Watten' };
const owner = auth => Boolean(auth?.authenticated && auth.user?.is_admin && (auth.user.is_owner || auth.user.is_founder));
const number = value => Number.isFinite(value) ? new Intl.NumberFormat(language() === 'en' ? 'en-GB' : 'de-CH').format(value) : '–';
const rank = value => {
  const label = typeof value === 'string' ? t(value) : value?.[language()] || value?.de || value?.en;
  return typeof label === 'string' ? label : '–';
};
const errors = {
  merge_same_account: 'Quelle und Ziel müssen verschiedene Konten sein.',
  merge_account_already_retired: 'Eines dieser Konten wurde bereits zusammengeführt. Suche die Konten erneut.',
  merge_target_inactive: 'Das Zielkonto muss aktiv sein.',
  merge_source_staff_protected: 'Admin- und Owner-Konten können nicht als Quelle verwendet werden.',
  merge_account_at_table: 'Ein beteiligtes Konto ist noch an ein laufendes Spiel oder einen wartenden Folgetisch gebunden. Beendet das Spiel oder schliesst den wartenden Tisch zuerst.',
  merge_pending_invitation: 'Es gibt noch eine offene Revanche oder Einladung. Klärt diese zuerst.',
  merge_recovery_state_unknown: 'Ein gespeicherter Tisch konnte nicht sicher geprüft werden. Die Zusammenführung wurde nicht gestartet.',
  merge_preview_stale: 'Die Kontodaten haben sich geändert. Erstelle eine neue Vorschau.',
  merge_source_changed: 'Die Kontodaten haben sich geändert. Erstelle eine neue Vorschau.',
  merge_game_validation_failed: 'Die Spielbelege konnten nicht sicher geprüft werden. Die Konten bleiben getrennt.',
  merge_identity_restricted_target_protected: 'Sperren dieses Kontos können nicht auf ein geschütztes Zielkonto übertragen werden.',
  merge_idempotency_conflict: 'Dieser Auftrag passt nicht zur gespeicherten Bestätigung. Lade die Seite neu.',
  current_password_invalid: 'Das aktuelle Passwort ist nicht korrekt. Bitte bestätige erneut.',
  password_change_required: 'Ändere zuerst dein temporäres Passwort in den Kontoeinstellungen.',
  passkey_cancelled: 'Die Passkey-Bestätigung wurde abgebrochen. Es wurde kein Auftrag gesendet.',
  passkey_verification_failed: 'Der Passkey konnte nicht bestätigt werden. Bitte bestätige erneut.',
  passkey_reauthentication_invalid: 'Die Bestätigung ist abgelaufen. Bitte bestätige erneut.',
  passkey_ceremony_invalid: 'Die Bestätigung ist abgelaufen. Bitte bestätige erneut.',
  passkeys_unavailable: 'Passkeys sind momentan nicht verfügbar. Verwende dein Passwort, falls eingerichtet.',
};
class MergeError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}
function node(tag, value, className) {
  const item = document.createElement(tag);
  if (value !== undefined) item.textContent = String(value);
  if (className) item.className = className;
  return item;
}
function button(value, className = 'secondary') {
  const item = node('button', t(value), className); item.type = 'button'; return item;
}
function accountName(account) { return `${account.username} · #${account.id}`; }
function unavailable(account, kind) {
  if (account.is_merged) return 'Dieses Konto wurde bereits zusammengeführt.';
  if (kind === 'source' && (account.role !== 'user' || account.is_owner || account.is_founder)) {
    return 'Admin- und Owner-Konten können nicht als Quelle verwendet werden.';
  }
  if (kind === 'target' && !account.is_active) return 'Das Zielkonto muss aktiv sein.';
  return '';
}

/** Owner-only workflow; all authority remains in the atomic server operation. */
export function mountAdminAccountMerge(panel = document.getElementById('accountMergePanel')) {
  const tile = document.getElementById('accountMergeTile');
  const controls = panel?.querySelector('[data-account-merge-controls]');
  const status = panel?.querySelector('[data-account-merge-status]');
  if (!tile || !controls || !status || panel.dataset.accountMergeMounted) return;
  panel.dataset.accountMergeMounted = 'true';
  let mountedId = null, allowed = false, suspended = false, busy = false, epoch = 0;
  let authData = null, preview = null, uncertain = false, applySent = false;
  let controller = new AbortController();
  const selected = { source: null, target: null };
  const selectors = {};
  const columns = node('div', undefined, 'merge-selectors');
  const previewButton = button('Vorschau erstellen', 'primary merge-preview-button');
  const summary = node('div', undefined, 'merge-summary');
  const confirmation = node('form', undefined, 'merge-confirm-form'); confirmation.hidden = true;
  const checkLabel = node('label', undefined, 'merge-confirmation');
  const check = node('input'); check.type = 'checkbox'; check.required = true;
  checkLabel.append(check, node('span', t('Ich habe Quelle und Ziel geprüft. Das Quellkonto wird stillgelegt; seine alten Zugangsdaten werden verworfen.')));
  const methodLabel = node('label', t('Bestätigung für dein Owner-Konto'));
  const method = node('select'); method.id = 'accountMergeMethod';
  for (const [value, label] of [['password', 'Aktuelles Passwort'], ['passkey', 'Passkey']]) {
    const option = node('option', t(label)); option.value = value; method.append(option);
  }
  methodLabel.append(method);
  const passwordLabel = node('label', t('Aktuelles Passwort'));
  const password = node('input'); password.type = 'password'; password.autocomplete = 'current-password';
  password.maxLength = 256; password.id = 'accountMergePassword'; password.name = 'current_password';
  passwordLabel.append(password);
  const proofHint = node('p', '', 'muted small');
  const applyButton = button('Konten jetzt zusammenführen', 'primary'); applyButton.type = 'submit';
  const actions = node('div', undefined, 'merge-actions'); actions.append(applyButton);
  confirmation.append(checkLabel, methodLabel, passwordLabel, proofHint, actions);

  function current(token) { return allowed && !suspended && token === epoch && panel.isConnected; }
  function message(value, { error = false, focus = false } = {}) {
    status.textContent = t(value); status.dataset.error = String(error);
    if (focus && !panel.hidden) status.focus();
  }
  function clearProof() { password.value = ''; check.checked = false; }
  function renewEpoch() { epoch += 1; controller.abort(); controller = new AbortController(); }
  function invalidate({ preserveAttempt = false } = {}) {
    renewEpoch(); clearProof(); busy = false;
    if (preserveAttempt && preview && (applySent || uncertain)) uncertain = true;
    else { preview = null; uncertain = false; applySent = false; summary.replaceChildren(); confirmation.hidden = true; }
    updateControls();
  }
  function stop() {
    allowed = false; invalidate(); tile.hidden = true; panel.hidden = true; controls.hidden = true;
    for (const kind of Object.keys(selected)) { selected[kind] = null; selectors[kind]?.results.replaceChildren(); }
  }
  async function verify(token) {
    const auth = await loadAuth({ refresh: true });
    if (!current(token)) return null;
    if (!owner(auth) || auth.user.id !== mountedId) { stop(); return null; }
    authData = auth; return auth;
  }
  async function request(url, { token, auth, body } = {}) {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { 'X-Account-Expected-Id': String(mountedId), ...(body === undefined ? {} : {
        'Content-Type': 'application/json', 'X-CSRF-Token': auth.user.csrf_token,
      }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!current(token) || !await verify(token)) return null;
    let payload;
    try { payload = await response.json(); }
    catch { throw new MergeError('invalid_response', response.status); }
    if (!current(token)) return null;
    if (!response.ok) throw new MergeError(typeof payload.detail === 'string' ? payload.detail : 'invalid_request', response.status);
    return payload;
  }
  function updateControls() {
    const unavailableUI = busy || suspended || !allowed;
    for (const control of columns.querySelectorAll('input, button')) {
      control.disabled = unavailableUI || uncertain || control.dataset.ineligible === 'true';
    }
    previewButton.disabled = unavailableUI || uncertain || !selected.source || !selected.target
      || selected.source.id === selected.target.id;
    const canPasskey = Boolean(authData?.passkeys?.enabled && authData.passkeys.has_credentials && passkeysSupported());
    const canPassword = authData?.user?.has_password !== false;
    method.options[0].disabled = !canPassword; method.options[1].disabled = !canPasskey;
    if (method.value === 'passkey' && !canPasskey && canPassword) method.value = 'password';
    if (method.value === 'password' && !canPassword && canPasskey) method.value = 'passkey';
    method.disabled = unavailableUI;
    passwordLabel.hidden = method.value !== 'password' || !canPassword;
    password.disabled = unavailableUI || passwordLabel.hidden;
    password.required = !passwordLabel.hidden;
    check.disabled = unavailableUI;
    applyButton.disabled = unavailableUI || !preview || !check.checked
      || (method.value === 'passkey' ? !canPasskey : !canPassword || !password.value);
    applyButton.textContent = t(uncertain ? 'Ergebnis dieses Auftrags prüfen' : 'Konten jetzt zusammenführen');
    proofHint.textContent = t(method.value === 'passkey' && canPasskey
      ? 'Beim Bestätigen öffnet sich die Gerätebestätigung für genau diese Zusammenführung.'
      : canPassword ? 'Bestätige mit deinem aktuellen Owner-Passwort. Das Passwort wird danach aus diesem Formular entfernt.'
        : 'Für diese Aktion brauchst du einen unterstützten Browser und deinen eingerichteten Passkey.');
    controls.setAttribute('aria-busy', String(busy));
  }
  function failure(error, { sent = false } = {}) {
    if ([401, 403].includes(error.status) || error.code === 'account_changed') {
      stop(); document.getElementById('adminMessage').textContent = t('Die Anmeldung oder Berechtigung hat sich geändert. Lade den Adminbereich neu.'); return;
    }
    if (sent && (!error.status || error.status >= 500 || error.code === 'invalid_response')) {
      uncertain = true;
      message('Das Ergebnis ist noch unklar. Bestätige erneut, um denselben Auftrag zu prüfen. Es wird kein zweiter Auftrag angelegt.', { error: true, focus: true });
    } else {
      if (sent && error.status >= 400 && error.status < 500 && !uncertain) applySent = false;
      if (error.status === 409) invalidate();
      message(errors[error.code] || 'Die Anfrage konnte nicht abgeschlossen werden. Bitte prüfe die Auswahl und versuche es erneut.', { error: true, focus: true });
    }
  }
  function selectedLabel(kind) {
    const area = selectors[kind].selection; area.replaceChildren();
    area.append(node('small', t(kind === 'source' ? 'Quelle wird stillgelegt' : 'Ziel bleibt bestehen')));
    area.append(node('strong', selected[kind] ? accountName(selected[kind]) : t('Noch kein Konto ausgewählt.')));
  }
  for (const [kind, title] of [['source', '1. Altes Konto · Quelle'], ['target', '2. Neues Konto · Ziel']]) {
    const section = node('section', undefined, 'merge-selector');
    section.append(node('h3', t(title)));
    const form = node('form', undefined, 'merge-search-form');
    const label = node('label', t('Benutzername suchen'));
    const input = node('input'); input.type = 'search'; input.autocomplete = 'off'; input.maxLength = 80;
    input.id = `accountMerge${kind === 'source' ? 'Source' : 'Target'}Search`; label.htmlFor = input.id;
    label.append(input);
    const search = button('Suchen'); search.type = 'submit'; form.append(label, search);
    const selection = node('div', undefined, 'merge-selected');
    const results = node('div', undefined, 'merge-results'); results.id = `${input.id}Results`;
    input.setAttribute('aria-controls', results.id);
    const hint = node('p', '', 'muted small'); hint.setAttribute('role', 'status');
    selectors[kind] = { input, selection, results, hint };
    selectedLabel(kind); section.append(form, selection, hint, results); columns.append(section);
    input.addEventListener('input', () => {
      if (uncertain || busy) return;
      selected[kind] = null; invalidate(); selectedLabel(kind); results.replaceChildren(); hint.textContent = ''; message('');
    });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || uncertain || !allowed || suspended) return;
      invalidate(); message(''); results.replaceChildren(); busy = true; updateControls();
      const token = epoch;
      hint.textContent = t('Konten werden gesucht …');
      try {
        const auth = await verify(token); if (!auth) return;
        const payload = await request(`/api/admin/users?${new URLSearchParams({ limit: '20', offset: '0', query: input.value.trim() })}`, { token, auth });
        if (!current(token) || !payload) return;
        if (!Array.isArray(payload.users)) throw new MergeError('invalid_response');
        for (const account of payload.users) {
          if (!Number.isSafeInteger(account.id) || account.id < 1 || typeof account.username !== 'string') continue;
          const result = button('', 'secondary merge-result');
          result.append(node('strong', accountName(account)));
          const reason = unavailable(account, kind);
          result.dataset.ineligible = String(Boolean(reason));
          result.append(node('small', t(reason || (account.is_active ? 'Aktives Konto' : 'Inaktives Konto · als Quelle möglich'))));
          result.addEventListener('click', () => {
            if (busy || uncertain || reason) return;
            invalidate(); selected[kind] = account; selectedLabel(kind); results.replaceChildren(); hint.textContent = ''; message('');
            if (selected.source?.id === selected.target?.id) message('Quelle und Ziel müssen verschiedene Konten sein.', { error: true });
            updateControls();
          });
          results.append(result);
        }
        hint.textContent = t(payload.users.length === 20
          ? 'Bis zu 20 Treffer. Grenze die Suche mit einem genaueren Namen ein.'
          : results.childElementCount ? 'Wähle das passende Konto anhand von Name und ID.' : 'Keine passenden Konten gefunden.');
      } catch (error) { if (current(token) && error.name !== 'AbortError') failure(error); }
      finally { if (current(token)) { busy = false; updateControls(); } }
    });
  }
  controls.append(columns, previewButton, summary, confirmation);

  function renderSummary(payload, attempt, success = false) {
    summary.replaceChildren();
    const heading = node('h3', t(success ? 'Zusammenführung abgeschlossen.' : 'Vorschau der Zusammenführung'));
    heading.tabIndex = -1; if (success) heading.className = 'merge-success';
    summary.append(heading, node('p', `${accountName(attempt.source)} → ${accountName(attempt.target)}`, 'merge-direction'));
    const grid = node('div', undefined, 'merge-game-grid');
    for (const [key, name] of Object.entries(games)) {
      const value = payload.games?.[key]; if (!value || typeof value !== 'object') continue;
      const card = node('section', undefined, 'merge-game'); card.append(node('h4', name));
      const list = node('dl');
      const pairs = [
        ['Punkte / XP', `${number(value.before_points)} → ${number(value.after_points)}`],
        ['Rang', `${rank(value.before_rank)} → ${rank(value.after_rank)}`],
        ['Erfolge nachher', number(value.achievement_count)],
        ['Übernommene Erfolge', number(value.inherited_achievement_count)],
        ['Neue Erfolge', number(value.new_achievement_count)],
        ['Spiele nachher', number(value.games_played)],
      ];
      for (const [label, amount] of pairs) list.append(node('dt', t(label)), node('dd', amount));
      card.append(list); grid.append(card);
    }
    summary.append(grid); heading.focus();
  }
  previewButton.addEventListener('click', async () => {
    if (previewButton.disabled || busy) return;
    invalidate(); busy = true; updateControls(); message('Vorschau wird berechnet …');
    const token = epoch, source = selected.source, target = selected.target;
    try {
      const auth = await verify(token); if (!auth) return;
      const payload = await request('/api/admin/account-merges/preview', {
        token, auth, body: { source_user_id: source.id, target_user_id: target.id },
      });
      if (!current(token) || !payload) return;
      if (!/^[a-f0-9]{64}$/.test(payload.fingerprint) || payload.source?.id !== source.id || payload.target?.id !== target.id
          || !payload.games || typeof payload.games !== 'object') throw new MergeError('invalid_response');
      if (typeof payload.source.username !== 'string' || typeof payload.target.username !== 'string') throw new MergeError('invalid_response');
      selected.source = { ...source, username: payload.source.username };
      selected.target = { ...target, username: payload.target.username };
      selectedLabel('source'); selectedLabel('target');
      preview = { fingerprint: payload.fingerprint, key: crypto.randomUUID(), source: selected.source, target: selected.target };
      method.value = auth.passkeys?.enabled && auth.passkeys.has_credentials && passkeysSupported() ? 'passkey' : 'password';
      renderSummary(payload, preview); confirmation.hidden = false; message('Prüfe die Vorschau und bestätige Quelle und Ziel.');
    } catch (error) { if (current(token) && error.name !== 'AbortError') failure(error); }
    finally { if (current(token)) { busy = false; updateControls(); } }
  });
  check.addEventListener('change', updateControls);
  password.addEventListener('input', updateControls);
  method.addEventListener('change', () => { password.value = ''; updateControls(); });
  confirmation.addEventListener('submit', async event => {
    event.preventDefault(); if (applyButton.disabled || busy || !preview || !check.checked) return;
    const token = epoch, attempt = preview;
    busy = true; updateControls(); message(uncertain ? 'Gespeichertes Ergebnis wird geprüft …' : 'Konten werden zusammengeführt …');
    let sent = false;
    try {
      let auth = await verify(token); if (!auth) return;
      let proof;
      if (method.value === 'passkey') {
        const options = await request('/api/auth/passkeys/reauthentication/options', {
          token, auth, body: { action: 'merge_accounts', target: `${attempt.source.id}:${attempt.target.id}:${attempt.fingerprint}` },
        });
        if (!current(token) || !options) return;
        const credential = await requestPasskeyAssertion(options.options);
        if (!current(token)) return;
        proof = { passkey: { token: options.token, credential } };
      } else {
        if (!password.value) throw new MergeError('current_password_invalid');
        proof = { current_password: password.value };
      }
      auth = await verify(token); if (!auth || preview !== attempt || !check.checked) return;
      sent = true; applySent = true;
      const payload = await request('/api/admin/account-merges/apply', {
        token, auth, body: { source_user_id: attempt.source.id, target_user_id: attempt.target.id,
          fingerprint: attempt.fingerprint, idempotency_key: attempt.key, confirmed: true, ...proof },
      });
      proof = null;
      if (!current(token) || !payload) return;
      if (payload.target_user_id !== attempt.target.id || typeof payload.operation_id !== 'string' || !payload.games) {
        throw new MergeError('invalid_response', 200);
      }
      renderSummary(payload, attempt, true); confirmation.hidden = true;
      preview = null; uncertain = false; applySent = false; clearProof();
      for (const kind of Object.keys(selected)) { selected[kind] = null; selectedLabel(kind); selectors[kind].results.replaceChildren(); }
      message('Das Zielkonto behält seine Anmeldung und Einstellungen. Die Zusammenführung ist gespeichert.', { focus: true });
    } catch (error) { if (current(token) && error.name !== 'AbortError') failure(error, { sent }); }
    finally { password.value = ''; if (current(token)) { busy = false; updateControls(); } }
  });
  const observer = new MutationObserver(() => {
    if (panel.hidden) { invalidate({ preserveAttempt: true }); message(''); }
    else if (!allowed) panel.hidden = true;
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('zdwa:auth-state', event => {
    if (mountedId !== null && (!owner(event.detail) || event.detail.user.id !== mountedId)) stop();
  });
  window.addEventListener('pagehide', () => {
    suspended = true; invalidate({ preserveAttempt: true }); controls.inert = true;
  });
  window.addEventListener('pageshow', async event => {
    if (!event.persisted) return;
    suspended = false;
    if (mountedId === null) { void start(); return; }
    if (!allowed) return;
    busy = true; updateControls();
    const token = epoch;
    try { if (await verify(token)) { controls.inert = false; if (uncertain) message('Das Ergebnis ist noch unklar. Bestätige erneut, um denselben Auftrag zu prüfen. Es wird kein zweiter Auftrag angelegt.', { error: true }); } }
    catch { if (current(token)) stop(); }
    finally { if (current(token)) { busy = false; updateControls(); } }
  });
  // Leaving the module clears secrets. A sent, ambiguous attempt retains its
  // one key; returning requires a fresh identity and explicit confirmation.
  for (const item of document.querySelectorAll('[data-admin-panel]')) {
    item.addEventListener('click', event => { if (busy) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  }
  async function start() {
    const token = epoch;
    try {
      const auth = await loadAuth({ refresh: true });
      if (!owner(auth) || token !== epoch || suspended || !panel.isConnected) return;
      mountedId = auth.user.id; authData = auth; allowed = true;
      tile.hidden = false; controls.hidden = false; updateControls();
    } catch { /* Owner-only module stays hidden until an authenticated load. */ }
  }
  void start();
}

mountAdminAccountMerge();
