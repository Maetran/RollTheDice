import '../i18n/index.js';
import { authError, escapeHtml as esc, loadAuth, login, loginWithPasskey, logout,
  mountAccountVerification, mountEmailSettings, mountPasskeySettings, mountUsernameSettings,
  passkeysSupported } from '../shared/auth.js';
import { initializeAvatarFallbacks } from '../shared/avatar.js';
import { mountAvatarUpload } from '../shared/avatar-upload.js';
import { mountRegistrationForm, registrationFormMarkup } from '../shared/registration.js';
import { wattenAccountReturnPath } from '../multigame/routes.js';
import { initializeWattenPwa } from './pwa.js';
import { friendSettingsText, mountFriendSettings } from './friend-settings.js';
import { initializeSuiteHeader } from '../shell/header.js';
import { initializeAppMode } from '../multigame/app-mode.js';
import { mountWattenPushSettings, pushSettingsMarkup } from './push-settings.js';
import { mountTourSettings } from '../shared/game-tours.js';

initializeWattenPwa();
initializeSuiteHeader();

const root = document.getElementById('wattenAccount');
const page = document.documentElement.dataset.accountPage;
document.querySelector(`[data-watten-nav] a[href="${page === 'home' ? '/watten' : '/watten/konto/einstellungen'}"]`)
  ?.setAttribute('aria-current', 'page');
const t = value => window.ZDWA_I18N.t(value);
const copy = value => esc(t(value));
const destination = wattenAccountReturnPath(new URLSearchParams(location.search).get('return_to')) || '/watten/konto/einstellungen';
let viewerId = null;
let navigating = false;
let generation = 0;
let friendSettings = null;
let pushSettings = null;

function clearPushSettings() { const previous = pushSettings; pushSettings = null; previous?.destroy(); }

function clearFriendSettings() {
  const previous = friendSettings;
  friendSettings = null;
  previous?.destroy();
}

function navigate(path) {
  if (navigating) return;
  navigating = true;
  clearFriendSettings();
  clearPushSettings();
  root.replaceChildren();
  location.assign(path);
}

function message(value, kind = '') {
  const node = root.querySelector('[data-account-message]');
  if (!node) return;
  node.textContent = t(value || '');
  node.dataset.kind = kind;
}

async function run(form, action) {
  const expected = { viewerId, generation };
  const button = form.querySelector('button[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  const status = form.querySelector('[role=status]');
  status.textContent = t('Bitte warte …');
  try { await action(expected); if (form.isConnected) status.textContent = t('Gespeichert.'); }
  catch (error) { if (form.isConnected) status.textContent = t(error.message || 'Einstellungen konnten nicht gespeichert werden.'); }
  finally { button.disabled = false; }
}

async function update(path, body, expected, method = 'POST') {
  const auth = await loadAuth();
  if (navigating || expected.generation !== generation || viewerId !== expected.viewerId
    || !auth.authenticated || auth.user.id !== expected.viewerId) {
    throw new Error(t('Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.'));
  }
  // Bind this mutation to the account that mounted the form. A refreshed
  // identity must never replace its CSRF proof with another account's token.
  const response = await fetch(path, { method, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.user.csrf_token }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) navigate('/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen');
  if (!response.ok) throw new Error(authError(result.detail));
  return result;
}

function renderLogin() {
  document.title = `Watten · ${t('Anmelden')}`;
  root.innerHTML = `<h1>${copy('Bei Watten anmelden')}</h1><p>${copy('Ein Konto für alle unsere Spiele. Dein bestehender Passkey funktioniert hier ebenfalls.')}</p>
    <button data-passkey-login type="button" hidden>${copy('Mit Passkey anmelden')}</button>
    <details open><summary>${copy('Mit Passwort anmelden')}</summary><form data-login>
      <label>${copy('Benutzername oder E-Mail-Adresse')}<input name="username" autocomplete="username" required></label>
      <label>${copy('Passwort')}<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">${copy('Anmelden')}</button><p role="status"></p>
    </form></details><p><a class="button-link ghost" data-forgot href="/passwort-vergessen?app=watten">${copy('Passwort vergessen?')}</a></p>
    ${registrationFormMarkup('wattenRegistration')}<p data-account-message role="status"></p>`;
  const form = root.querySelector('[data-login]');
  form.addEventListener('submit', event => {
    event.preventDefault();
    void run(form, async () => { await login(form.elements.username.value, form.elements.password.value); navigate(destination); });
  });
  const passkey = root.querySelector('[data-passkey-login]');
  passkey.addEventListener('click', async () => {
    if (passkey.disabled) return;
    passkey.disabled = true;
    try { await loginWithPasskey(); navigate(destination); }
    catch (error) { message(error.message, 'error'); }
    finally { passkey.disabled = false; }
  });
  root.querySelector('[data-forgot]').href = `/passwort-vergessen?app=watten&return_to=${encodeURIComponent(destination)}`;
  mountRegistrationForm(root.querySelector('[data-registration-form]'), {
    onAuthenticated: () => navigate(destination), onMessage: message,
  });
  void loadAuth().then(auth => {
    if (auth.authenticated) return navigate(destination);
    passkey.hidden = !auth.passkeys?.enabled || !passkeysSupported();
  }).catch(() => message('Der Anmeldestatus konnte nicht geladen werden. Bitte versuche es erneut.', 'error'));
}

function renderSettings(auth) {
  clearPushSettings();
  const user = auth.user;
  const publicPush = (auth.game_access || user.game_access)?.watten_public === true;
  if ((auth.game_access || user.game_access)?.watten_preview === true || (auth.game_access || user.game_access)?.watten_public === true) initializeAppMode({ mode: 'watten' });
  viewerId = user.id;
  document.title = `Watten · ${t('Kontoeinstellungen')}`;
  root.innerHTML = `<h1>${copy('Kontoeinstellungen')}</h1><p>${copy('Ein Konto für alle unsere Spiele. Dein bestehender Passkey funktioniert hier ebenfalls.')}</p>
    <p data-account-name translate="no">${esc(user.username)}</p>
    <details><summary>${copy('Passkeys')}</summary><div data-passkey-settings></div></details>
    <details${user.must_change_password ? ' open' : ''}><summary>${copy('Passwort ändern')}</summary>
      <form data-password><div data-account-verification></div>
        <label>${copy('Neues Passwort')}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label>
        <label>${copy('Neues Passwort wiederholen')}<input name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label>
        <button type="submit">${copy('Passwort speichern')}</button><p role="status"></p></form></details>
    <details><summary>${copy('E-Mail-Adresse')}</summary><div data-email-settings></div></details>
    <details><summary>${copy('Benutzername ändern')}</summary><div data-username-settings></div></details>
    <details><summary>${copy('Dein Profilbild')}</summary><div data-avatar-upload></div></details>
    <details><summary>${esc(friendSettingsText('settingsTitle'))}</summary><div data-watten-friend-settings></div></details>
    <details><summary>${copy('Sprache')}</summary><form data-language><label>${copy('Sprache')}<select name="language"><option value="de">Deutsch</option><option value="en">English</option></select></label><button type="submit">${copy('Sprache speichern')}</button><p role="status"></p></form></details>
    ${publicPush ? pushSettingsMarkup(copy) : ""}
    <details><summary>${copy('Einsteigertouren')}</summary><div data-game-tour-settings></div></details>
    <div class="actions"><a class="button-link ghost" href="/watten">${copy('Zurück')}</a><a class="button-link ghost" href="/watten/konto/fortschritt">${copy('Erfolge & Titel')}</a><button data-logout type="button">${copy('Abmelden')}</button></div><p data-account-message role="status"></p>`;
  mountUsernameSettings(root.querySelector('[data-username-settings]'), { user, onChanged: changed => {
    const name = root.querySelector('[data-account-name]');
    if (name && changed.user.id === viewerId) name.textContent = changed.user.username;
  } });
  void mountTourSettings(root.querySelector('[data-game-tour-settings]'));
  void mountPasskeySettings(root.querySelector('[data-passkey-settings]'));
  void mountEmailSettings(root.querySelector('[data-email-settings]'));
  mountAvatarUpload(root.querySelector('[data-avatar-upload]'));
  clearFriendSettings();
  const mountedGeneration = generation;
  friendSettings = mountFriendSettings({ container: root.querySelector('[data-watten-friend-settings]'), viewerId: user.id,
    isCurrent: () => !navigating && generation === mountedGeneration && viewerId === user.id,
    onAccountChanged: () => {
      generation += 1;
      root.replaceChildren();
      navigate('/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen');
    },
    loadAuth, escapeHtml: esc });
  if (publicPush) pushSettings = mountWattenPushSettings({ container: root.querySelector('[data-watten-push-settings]'), viewerId: user.id,
    isCurrent: () => !navigating && generation === mountedGeneration && viewerId === user.id,
    onAccountChanged: () => { generation += 1; navigate('/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen'); },
    loadAuth, translate: t });
  const password = root.querySelector('[data-password]');
  const verification = mountAccountVerification(password.querySelector('[data-account-verification]'));
  password.addEventListener('submit', event => {
    event.preventDefault();
    if (password.elements.password.value !== password.elements.confirmation.value) {
      password.querySelector('[role=status]').textContent = t('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    void run(password, async expected => {
      const proof = await verification.proof('change_password');
      await update('/api/auth/change-password', { ...proof, new_password: password.elements.password.value }, expected);
      verification.clear();
      navigate('/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen');
    });
  });
  const language = root.querySelector('[data-language]');
  language.elements.language.value = user.preferences?.preferred_language || document.documentElement.lang;
  language.addEventListener('submit', event => {
    event.preventDefault();
    void run(language, async expected => {
      const selected = language.elements.language.value;
      await update('/api/auth/preferences/language', { preferred_language: selected }, expected, 'PUT');
      window.ZDWA_I18N.setLanguage(selected, { persist: false });
    });
  });
  root.querySelector('[data-logout]').addEventListener('click', async () => {
    try { await logout(); }
    catch (error) { message(error.message, 'error'); }
  });
}

if (page === 'home') {
  root.innerHTML = `<h1 translate="no">Watten</h1><p>${copy('Watten ist noch nicht verfügbar. Dein Konto kannst du hier verwalten.')}</p>
    <div class="actions"><a class="button-link" href="/watten/anmelden">${copy('Anmelden')}</a><a class="button-link ghost" href="/watten/konto/einstellungen">${copy('Kontoeinstellungen')}</a></div>`;
} else if (page === 'login') renderLogin();
else if (page === 'settings') {
  initializeAvatarFallbacks();
  window.addEventListener('zdwa:auth-state', event => {
    if (viewerId !== null && (!event.detail?.authenticated || event.detail.user?.id !== viewerId)) {
      // Clearing precedes navigation; late requests may only update detached UI.
      generation += 1;
      clearFriendSettings();
      clearPushSettings();
      root.replaceChildren();
      navigate(event.detail?.authenticated ? '/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen' : '/watten');
    }
  });
  const refresh = () => {
    const expectedGeneration = generation;
    return loadAuth({ refresh: true }).then(auth => {
      if (expectedGeneration !== generation || navigating) return;
      if (!auth.authenticated) return navigate('/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen');
      if (viewerId === null) renderSettings(auth);
    }).catch(() => {
      if (expectedGeneration !== generation || navigating) return;
      viewerId = null;
      root.innerHTML = `<h1>${copy('Kontoeinstellungen')}</h1><p role="alert">${copy('Einstellungen konnten nicht geladen werden.')}</p><button type="button">${copy('Erneut versuchen')}</button>`;
      root.querySelector('button').addEventListener('click', () => { void refresh(); });
    });
  };
  const clearPrivatePage = () => {
    generation += 1;
    viewerId = null;
    clearFriendSettings();
    clearPushSettings();
    root.replaceChildren();
  };
  window.addEventListener('pagehide', clearPrivatePage);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    clearPrivatePage();
    // Reload discards shared auth promises that may predate BFCache entry.
    // A new refresh must never reuse an old account's delayed response.
    navigating = true;
    location.reload();
  });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
  void refresh();
}
