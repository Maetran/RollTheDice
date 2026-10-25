import { apiFetch, authError, escapeHtml as esc, logout, mountAccountVerification, mountEmailSettings, mountPasskeySettings, mountUsernameSettings } from '../shared/auth.js';
import { avatarMarkup } from '../shared/avatar.js';
import { mountAvatarUpload } from '../shared/avatar-upload.js';
import { mountAllowlistSettings } from '../shared/player-allowlist.js';
import { renderAccountBans } from '../shared/admin-help.js';
import { mountFriendActivitySettings } from '../shared/friend-activity.js';
import { mountTourSettings } from '../shared/game-tours.js';
import { mountVoicePreferences, voicePreferenceText } from '../shared/voice-preferences.js';
import { bindPushPreferences, devicePushStatusMessage, disableGameInvitePush, enableGameInvitePush, getGameInvitePushStatus, syncPushPreferences, webPushErrorMessage } from '../shared/web-push.js';

const t = text => window.ZDWA_I18N?.t?.(text) || text;
const copy = text => esc(t(text));
let hashListener;
let voicePreferences;
const chevron = '<svg class="hd-settings-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
// Every setting is a collapsed row; a tap opens it in place.
const item = (title, hint, body, attrs = '') => `<details class="hd-settings-item" ${attrs}><summary><span class="hd-settings-summary"><strong>${copy(title)}</strong><small>${copy(hint)}</small></span>${chevron}</summary><div class="hd-settings-body">${body}</div></details>`;
const group = (id, title, items) => `<section id="${id}" class="hd-settings-group" aria-labelledby="${id}Title"><h2 id="${id}Title">${copy(title)}</h2>${items.join('')}</section>`;

export function renderAccountSettings(root, auth, { onUserChanged } = {}) {
  voicePreferences?.destroy();
  const user = auth.user;
  document.title = `Hausdepp · ${t('Kontoeinstellungen')}`;
  root.innerHTML = `<div class="hd-settings"><header class="hd-settings-heading">${avatarMarkup(user, { size: 'large', avatarKey: 'settings-self' })}<div><p>Hausdepp</p><h1>${copy('Kontoeinstellungen')}</h1><p>${copy('Ein Konto für alle unsere Spiele. Dein bestehender Passkey funktioniert hier ebenfalls.')}</p></div></header>
    <nav class="hd-account-shortcuts" aria-label="${copy('Kontoeinstellungen')}"><a href="#zugang">${copy('Anmeldung & Sicherheit')}</a><a href="#profil">${copy('Profil & Sprache')}</a><a href="#spiel">${copy('Spiel')}</a><a href="#mitspieler">${copy('Mitspieler & Chat')}</a><a href="#benachrichtigungen">${copy('Benachrichtigungen')}</a><a href="/hausdepp/konto">${copy('Zum Konto')}</a></nav>
    <div data-account-bans role="status" hidden></div>
    ${group('zugang', 'Anmeldung & Sicherheit', [
      item('Passkeys', 'Ohne Passwort anmelden, auf jedem Gerät.', '<div data-passkey-settings></div>', 'data-passkey-section'),
      item('Passwort ändern', user.must_change_password ? 'Bitte ändere zuerst dein temporäres Passwort.' : 'Gilt für alle unsere Spiele.', `<p>${copy(user.must_change_password ? 'Bitte ändere zuerst dein temporäres Passwort.' : 'Dein Passwort gilt für alle unsere Spiele.')}</p><form id="hausdeppPasswordForm" class="form-stack"><div data-account-verification></div><label>${copy('Neues Passwort')}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label><label>${copy('Neues Passwort wiederholen')}<input name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label><button class="primary" type="submit">${copy('Passwort speichern')}</button><p data-message role="status"></p></form>`, `id="passwort"${user.must_change_password ? ' open' : ''}`),
      item('E-Mail-Adresse', 'Für Wiederherstellung und Hinweise.', '<div data-email-settings></div>', 'data-email-section'),
    ])}
    ${group('profil', 'Profil & Sprache', [
      item('Benutzername ändern', 'So sehen dich deine Mitspieler.', '<div data-username-settings></div>'),
      item('Dein Profilbild', 'Erscheint an deinem Platz am Tisch.', '<div data-avatar-upload></div>', 'id="profilbild"'),
      item('Sprache', 'Deutsch oder Englisch, auf allen Geräten.', `<p>${copy('Diese Einstellung gilt für alle unsere Spiele auf allen Geräten.')}</p><form id="hausdeppLanguageForm" class="form-stack"><label>${copy('Sprache')}<select name="language"><option value="de">Deutsch</option><option value="en">English</option></select></label><button class="primary" type="submit">${copy('Sprache speichern')}</button><p data-message role="status"></p></form>`),
    ])}
    ${group('spiel', 'Spiel', [
      item('Hilfe & Neuigkeiten', 'Einsteigertouren ansehen oder neu starten.', `<div data-game-tour-settings></div><h3>${copy('Neuigkeiten & Versionen')}</h3><p>${copy('Die letzten zehn Releases kannst du jederzeit im Konto nachlesen.')}</p><div data-release-history></div>`, 'id="hilfe"'),
    ])}
    ${group('mitspieler', 'Mitspieler & Chat', [
      item(voicePreferenceText('title'), voicePreferenceText('hint'), '<div data-voice-preference-settings></div>', 'id="sprachchat"'),
      item('Lobby-Chat', 'Chat in der Lobby ein- oder ausschalten.', `<form id="hausdeppChatForm" class="form-stack"><label><input name="enabled" type="checkbox"> ${copy('Lobby-Chat aktivieren')}</label><label><input name="popups" type="checkbox"> ${copy('Neue Nachrichten im Lobby-Chat oben einblenden')}</label><button class="primary" type="submit">${copy('Chat-Einstellung speichern')}</button><p data-message role="status"></p></form>`),
      item('Deine Spielerauswahl', 'Wer dich zu Runden rufen darf.', '<div data-allowlist-settings></div>', 'id="spielerauswahl"'),
      item('Startmeldungen deiner Spielerauswahl', 'Hinweis, wenn deine Leute ein Spiel starten.', '<div data-friend-activity-settings></div>'),
    ])}
    ${group('benachrichtigungen', 'Benachrichtigungen', [
      item('Push-Benachrichtigungen', 'Mitspieler-Rufe, Erinnerungen und Versionshinweise.', `<p>${copy('Verpass keinen freien Platz: Mitspieler-Rufe bringen dich direkt in öffentliche Runden unserer Spiele. Erlaube zuerst Push auf diesem Gerät und wähle danach selbst, welche Hinweise zu dir passen.')}</p><button id="hausdeppPushEnable" class="primary" type="button">${copy('Push auf diesem Gerät zulassen')}</button><button id="hausdeppPushDisable" type="button" hidden>${copy('Push-Benachrichtigungen deaktivieren')}</button><p id="hausdeppPushStatus" role="status"></p><form id="hausdeppPushPreferences" class="form-stack" hidden><label><input name="gameInvites" type="checkbox"> ${copy('Mitspieler-Rufe erhalten (wenn ein Platz frei ist)')}</label><label><input name="dailyReminder" type="checkbox"> ${copy('Tägliche Spielerinnerung erhalten')}</label><p data-push-reminder-schedule></p><label><input name="releaseNotifications" type="checkbox"> ${copy('Versionshinweise erhalten')}</label><label data-admin-help-push-setting hidden><input name="adminHelp" type="checkbox"> ${copy('Hilferufe von Spielern erhalten (Admins)')}</label><button class="primary" type="submit">${copy('Push-Auswahl speichern')}</button><p data-push-preferences-message role="status"></p></form>`, 'id="hausdeppPushSettings"'),
    ])}
    <footer class="hd-settings-footer"><a class="hd-secondary" href="/hausdepp/konto">${copy('Zum Konto')}</a><a class="hd-secondary" href="/hausdepp">${copy('Hausdepp öffnen')}</a><button id="hausdeppLogout" type="button">${copy('Abmelden')}</button><p id="hausdeppLogoutMessage" role="status"></p></footer></div>`;
  // A link to a setting, or to anything inside one, opens that row.
  const openTarget = () => {
    const target = location.hash.length > 1 ? root.querySelector(`[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`) : null;
    const details = target?.closest('details.hd-settings-item') || target?.querySelector?.('details.hd-settings-item');
    if (details) details.open = true;
    // The page renders after the browser's own jump, so bring the row into view.
    (details || target)?.scrollIntoView?.({ block: 'start' });
  };
  openTarget();
  if (hashListener) window.removeEventListener('hashchange', hashListener);
  hashListener = openTarget;
  window.addEventListener('hashchange', hashListener);
  renderAccountBans(root.querySelector('[data-account-bans]'), user);
  mountUsernameSettings(root.querySelector('[data-username-settings]'), { user, onChanged: onUserChanged });
  void mountPasskeySettings(root.querySelector('[data-passkey-settings]'));
  void mountEmailSettings(root.querySelector('[data-email-settings]'));
  mountAvatarUpload(root.querySelector('[data-avatar-upload]'));
  mountAllowlistSettings(root.querySelector('[data-allowlist-settings]'), { context: 'hausdepp' });
  mountFriendActivitySettings(root.querySelector('[data-friend-activity-settings]'));
  void mountTourSettings(root.querySelector('[data-game-tour-settings]'));
  voicePreferences = mountVoicePreferences(root.querySelector('[data-voice-preference-settings]'), { user });
  const passwordForm = root.querySelector('#hausdeppPasswordForm');
  const verification = mountAccountVerification(passwordForm.querySelector('[data-account-verification]'), { passwordId: 'hausdeppCurrentPassword' });
  if (user.must_change_password) verification.focus();
  passwordForm.addEventListener('submit', event => {
    event.preventDefault();
    if (passwordForm.elements.password.value !== passwordForm.elements.confirmation.value) {
      passwordForm.querySelector('[data-message]').textContent = t('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    void save(passwordForm, async () => {
      const proof = await verification.proof('change_password');
      await update('/api/auth/change-password', { ...proof, new_password: passwordForm.elements.password.value });
      location.assign('/hausdepp/anmelden?return_to=%2Fhausdepp%2Fkonto%2Feinstellungen');
      verification.clear();
      passwordForm.reset();
    }, 'Passwort geändert. Bitte erneut anmelden.');
  });
  const languageForm = root.querySelector('#hausdeppLanguageForm');
  languageForm.elements.language.value = user.preferences?.preferred_language || document.documentElement.lang;
  languageForm.addEventListener('submit', event => {
    event.preventDefault();
    void save(languageForm, async () => {
      const language = languageForm.elements.language.value;
      await update('/api/auth/preferences/language', { preferred_language: language });
      window.ZDWA_I18N.setLanguage(language);
    }, 'Sprache gespeichert.');
  });
  const chatForm = root.querySelector('#hausdeppChatForm');
  chatForm.elements.enabled.checked = user.preferences?.lobby_chat_enabled !== false;
  chatForm.elements.popups.checked = user.preferences?.lobby_chat_popups !== false;
  const syncChat = () => { chatForm.elements.popups.disabled = !chatForm.elements.enabled.checked; };
  syncChat();
  chatForm.elements.enabled.addEventListener('change', syncChat);
  chatForm.addEventListener('submit', event => {
    event.preventDefault();
    void save(chatForm, () => update('/api/auth/preferences/lobby-chat', { lobby_chat_enabled: chatForm.elements.enabled.checked, lobby_chat_popups: chatForm.elements.popups.checked }), 'Chat-Einstellung gespeichert.');
  });
  const pushEnable = root.querySelector('#hausdeppPushEnable');
  const pushDisable = root.querySelector('#hausdeppPushDisable');
  const pushStatus = root.querySelector('#hausdeppPushStatus');
  const refreshPush = async () => {
    try {
      const status = await getGameInvitePushStatus();
      syncPushPreferences(root.querySelector('#hausdeppPushPreferences'), status);
      pushDisable.hidden = !status.subscribed;
      pushEnable.disabled = !status.available || !status.browser_supported || status.permission === 'denied';
      pushEnable.hidden = false;
      pushEnable.textContent = t(status.subscribed ? 'Dieses Gerät für Push anmelden' : 'Push auf diesem Gerät zulassen');
      pushStatus.textContent = t(!status.available ? 'Push-Benachrichtigungen sind momentan noch nicht eingerichtet.' : !status.browser_supported ? 'Dieser Browser unterstützt keine Push-Benachrichtigungen.' : status.permission === 'denied' ? 'Die Push-Berechtigung wurde nicht erteilt.' : devicePushStatusMessage(status));
    } catch (error) { pushStatus.textContent = webPushErrorMessage(error); pushEnable.disabled = true; }
  };
  const changePush = async (button, action) => {
    button.disabled = true;
    try { await action(); await refreshPush(); }
    catch (error) { pushStatus.textContent = webPushErrorMessage(error); }
    finally { button.disabled = false; }
  };
  pushEnable.addEventListener('click', () => { void changePush(pushEnable, enableGameInvitePush); });
  pushDisable.addEventListener('click', () => { void changePush(pushDisable, disableGameInvitePush); });
  bindPushPreferences(root.querySelector('#hausdeppPushPreferences'), refreshPush);
  void refreshPush();
  root.querySelector('#hausdeppLogout').addEventListener('click', async () => {
    // The auth-state listener clears private data and owns the one redirect.
    try { await logout(); }
    catch (error) { root.querySelector('#hausdeppLogoutMessage').textContent = t(error.message); }
  });
}

async function update(path, body) {
  const response = await apiFetch(path, { method: path.startsWith('/api/auth/preferences/') ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(payload.detail));
  return payload;
}

async function save(form, action, success) {
  const button = form.querySelector('button[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  const message = form.querySelector('[data-message]');
  message.textContent = t('Bitte warte …');
  try { await action(); message.textContent = t(success); }
  catch (error) { message.textContent = t(error.message || 'Einstellungen konnten nicht gespeichert werden.'); }
  finally { button.disabled = false; }
}
