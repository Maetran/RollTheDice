import { apiFetch, authError, escapeHtml as esc, logout, mountAccountVerification, mountEmailSettings, mountPasskeySettings, mountUsernameSettings } from '../shared/auth.js';
import { avatarMarkup } from '../shared/avatar.js';
import { mountAvatarUpload } from '../shared/avatar-upload.js';
import { mountAllowlistSettings } from '../shared/player-allowlist.js';
import { renderAccountBans } from '../shared/admin-help.js';
import { mountFriendActivitySettings } from '../shared/friend-activity.js';
import { mountTourSettings } from '../shared/game-tours.js';
import { bindPushPreferences, disableGameInvitePush, enableGameInvitePush, getGameInvitePushStatus, syncPushPreferences, webPushErrorMessage } from '../shared/web-push.js';

const t = text => window.ZDWA_I18N?.t?.(text) || text;
const copy = text => esc(t(text));
const block = (title, body, attrs = '') => `<section class="hd-settings-block" ${attrs}><h2>${copy(title)}</h2>${body}</section>`;

export function renderAccountSettings(root, auth, { onUserChanged } = {}) {
  const user = auth.user;
  document.title = `Hausdepp · ${t('Kontoeinstellungen')}`;
  root.innerHTML = `<div class="hd-settings"><header class="hd-settings-heading">${avatarMarkup(user, { size: 'large', avatarKey: 'settings-self' })}<div><p>Hausdepp</p><h1>${copy('Kontoeinstellungen')}</h1><p>${copy('Ein Konto für ZDWA, Zilch und Hausdepp. Dein bestehender Passkey funktioniert hier ebenfalls.')}</p></div></header>
    <nav class="hd-account-shortcuts" aria-label="${copy('Kontoeinstellungen')}"><a href="#zugang">${copy('Konto & Sicherheit')}</a><a href="#mitspieler">${copy('Mitspieler & Hinweise')}</a><a href="/hausdepp/konto">${copy('Zum Konto')}</a></nav>
    <div data-account-bans role="status" hidden></div><div id="zugang" class="hd-settings-grid">
    ${block('Passkeys', '<div data-passkey-settings></div>')}
    ${block('Benutzername ändern', '<div data-username-settings></div>')}
    ${block('Dein Profilbild', '<div data-avatar-upload></div>')}
    ${block('E-Mail-Adresse', '<div data-email-settings></div>', 'data-email-section')}
    ${block('Passwort ändern', `<p>${copy(user.must_change_password ? 'Bitte ändere zuerst dein temporäres Passwort.' : 'Dein Passwort gilt für ZDWA, Zilch und Hausdepp.')}</p><form id="hausdeppPasswordForm" class="form-stack"><div data-account-verification></div><label>${copy('Neues Passwort')}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label><label>${copy('Neues Passwort wiederholen')}<input name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label><button class="primary" type="submit">${copy('Passwort speichern')}</button><p data-message role="status"></p></form>`)}
    ${block('Sprache', `<p>${copy('Diese Einstellung gilt für ZDWA, Zilch und Hausdepp auf allen Geräten.')}</p><form id="hausdeppLanguageForm" class="form-stack"><label>${copy('Sprache')}<select name="language"><option value="de">Deutsch</option><option value="en">English</option></select></label><button class="primary" type="submit">${copy('Sprache speichern')}</button><p data-message role="status"></p></form>`)}
    </div><div id="mitspieler" class="hd-settings-grid">
    ${block('Lobby-Chat', `<form id="hausdeppChatForm" class="form-stack"><label><input name="enabled" type="checkbox"> ${copy('Lobby-Chat aktivieren')}</label><label><input name="popups" type="checkbox"> ${copy('Neue Nachrichten im Lobby-Chat oben einblenden')}</label><button class="primary" type="submit">${copy('Chat-Einstellung speichern')}</button><p data-message role="status"></p></form>`)}
    ${block('Deine Spielerauswahl', '<div data-allowlist-settings></div>')}
    ${block('Startmeldungen deiner Spielerauswahl', '<div data-friend-activity-settings></div>')}
    ${block('Push-Benachrichtigungen', `<p>${copy('Verpass keinen freien Platz: Mitspieler-Rufe bringen dich direkt in öffentliche ZDWA-, Zilch- oder Hausdepp-Runden. Erlaube zuerst Push auf diesem Gerät und wähle danach selbst, welche Hinweise zu dir passen.')}</p><button id="hausdeppPushEnable" class="primary" type="button">${copy('Push auf diesem Gerät zulassen')}</button><button id="hausdeppPushDisable" type="button" hidden>${copy('Push-Benachrichtigungen deaktivieren')}</button><p id="hausdeppPushStatus" role="status"></p><form id="hausdeppPushPreferences" class="form-stack" hidden><label><input name="gameInvites" type="checkbox"> ${copy('Mitspieler-Rufe erhalten (wenn ein Platz frei ist)')}</label><label><input name="dailyReminder" type="checkbox"> ${copy('Tägliche Spielerinnerung erhalten')}</label><p data-push-reminder-schedule></p><label><input name="releaseNotifications" type="checkbox"> ${copy('Versionshinweise erhalten')}</label><label data-admin-help-push-setting hidden><input name="adminHelp" type="checkbox"> ${copy('Hilferufe von Spielern erhalten (Admins)')}</label><button class="primary" type="submit">${copy('Push-Auswahl speichern')}</button><p data-push-preferences-message role="status"></p></form>`, 'id="hausdeppPushSettings"')}
    </div>${block('Hilfe & Neuigkeiten', '<div data-game-tour-settings></div>', 'id="hilfe"')}<footer class="hd-settings-footer"><a class="hd-secondary" href="/hausdepp/konto">${copy('Zum Konto')}</a><a class="hd-secondary" href="/hausdepp">${copy('Hausdepp öffnen')}</a><button id="hausdeppLogout" type="button">${copy('Abmelden')}</button><p id="hausdeppLogoutMessage" role="status"></p></footer></div>`;
  renderAccountBans(root.querySelector('[data-account-bans]'), user);
  mountUsernameSettings(root.querySelector('[data-username-settings]'), { user, onChanged: onUserChanged });
  void mountPasskeySettings(root.querySelector('[data-passkey-settings]'));
  void mountEmailSettings(root.querySelector('[data-email-settings]'));
  mountAvatarUpload(root.querySelector('[data-avatar-upload]'));
  mountAllowlistSettings(root.querySelector('[data-allowlist-settings]'), { context: 'hausdepp' });
  mountFriendActivitySettings(root.querySelector('[data-friend-activity-settings]'));
  void mountTourSettings(root.querySelector('[data-game-tour-settings]'));
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
      pushEnable.hidden = status.subscribed;
      pushStatus.textContent = t(!status.available ? 'Push-Benachrichtigungen sind momentan noch nicht eingerichtet.' : !status.browser_supported ? 'Dieser Browser unterstützt keine Push-Benachrichtigungen.' : status.permission === 'denied' ? 'Die Push-Berechtigung wurde nicht erteilt.' : status.subscribed ? 'Push ist für dieses Gerät bereit. Wähle unten aus, wofür du benachrichtigt werden möchtest.' : 'Push-Benachrichtigungen sind ausgeschaltet.');
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
