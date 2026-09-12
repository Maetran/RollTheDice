import { avatarMarkup } from "./avatar.js";
import { createPasskeyCredential, requestPasskeyAssertion, passkeysSupported } from "./passkeys.js";

export { passkeysSupported };

let authCache = null;
let authRequest = null;
let authEpoch = 0;

function notifyAuthState(data) {
  window.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: data || { authenticated: false, user: null } }));
}

function syncLanguage(data) {
  const language = data?.user?.preferences?.preferred_language;
  if (language && window.ZDWA_I18N) window.ZDWA_I18N.syncAccountLanguage(language);
}

export function loadAuth({ refresh = false } = {}) {
  if (authCache && !refresh) return Promise.resolve(authCache);
  // One identity request is enough even when multiple UI components mount together.
  if (authRequest) return authRequest;
  const requestEpoch = authEpoch;
  const request = (async () => {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    // A successful login/logout supersedes an older in-flight /me response.
    if (requestEpoch !== authEpoch) {
      return authCache ?? data;
    }
    authCache = data;
    syncLanguage(authCache);
    notifyAuthState(authCache);
    return authCache;
  })();
  authRequest = request;
  return request.finally(() => {
    if (authRequest === request) authRequest = null;
  });
}

export async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const auth = await loadAuth();
    const csrf = auth?.user?.csrf_token;
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  const response = await fetch(url, { ...options, headers, cache: options.cache || 'no-store' });
  if (response.status === 401) {
    authEpoch += 1;
    authCache = null;
    authRequest = null;
  }
  return response;
}

export async function login(username, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  authEpoch += 1;
  authRequest = null;
  authCache = data;
  syncLanguage(data);
  notifyAuthState(data);
  return data;
}

async function publicAuthPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  return data;
}

export async function loginWithPasskey() {
  try {
    const { options } = await publicAuthPost('/api/auth/passkeys/authentication/options', {});
    const credential = await requestPasskeyAssertion(options);
    const data = await publicAuthPost('/api/auth/passkeys/authentication/verify', { credential });
    authEpoch += 1;
    authRequest = null;
    authCache = data;
    syncLanguage(data);
    notifyAuthState(data);
    return data;
  } catch (error) {
    throw new Error(authError(error.code || error.message));
  }
}

async function passkeyRequest(path = '', body, method = 'POST') {
  const response = await apiFetch(`/api/auth/passkeys${path}`, body === undefined
    ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  return data;
}

export async function mountPasskeySettings(container, { zilch = false } = {}) {
  if (!container || container.dataset.bound) return;
  container.dataset.bound = 'true';
  try {
    const auth = await loadAuth();
    if (!auth.passkeys?.enabled) {
      container.closest('section')?.setAttribute('hidden', '');
      return;
    }
    const render = async (notice = '') => {
      const status = await passkeyRequest();
      container.innerHTML = `
        <p>${escapeHtml(translate('Mit einem Passkey meldest du dich per Fingerabdruck, Gesichtserkennung oder Geräte-PIN an. Dein Passwort bleibt als Alternative verfügbar.'))}</p>
        <ul data-passkey-list>${(status.credentials || []).map(key => `<li><span>${escapeHtml(key.label || translate('Passkey'))}</span> <button class="small ghost" type="button" data-remove-passkey="${Number(key.id)}">${escapeHtml(translate('Entfernen'))}</button></li>`).join('')}</ul>
        ${status.credentials?.length ? '' : `<p>${escapeHtml(translate('Noch kein Passkey eingerichtet.'))}</p>`}
        <form class="${zilch ? 'zilch-settings-form' : 'form-stack'}" data-passkey-form>
          <label>${escapeHtml(translate('Aktuelles Passwort'))}<input name="current_password" type="password" autocomplete="current-password" maxlength="256" required></label>
          <label>${escapeHtml(translate('Name für den Passkey (optional)'))}<input name="label" maxlength="64" autocomplete="off" placeholder="${escapeHtml(translate('Zum Beispiel: Mein Handy'))}"></label>
          <button class="primary" type="submit"${passkeysSupported() ? '' : ' disabled'}>${escapeHtml(translate('Passkey hinzufügen'))}</button>
        </form>
        ${passkeysSupported() ? '' : `<p>${escapeHtml(translate('Dieser Browser unterstützt keine Passkeys. Nutze einen aktuellen Browser auf einem unterstützten Gerät.'))}</p>`}
        <p data-passkey-message role="status">${escapeHtml(translate(notice))}</p>`;
      const form = container.querySelector('form');
      const message = container.querySelector('[data-passkey-message]');
      let busy = false;
      const run = async action => {
        if (busy) return;
        busy = true;
        container.querySelectorAll('button').forEach(button => { button.disabled = true; });
        message.textContent = translate('Bitte warte …');
        try {
          await action();
        } catch (error) {
          message.textContent = translate(authError(error.code || (error instanceof TypeError ? 'Einstellungen konnten nicht gespeichert werden.' : error.message)));
          container.querySelectorAll('button').forEach(button => { button.disabled = false; });
          form.querySelector('button').disabled = !passkeysSupported();
        } finally {
          busy = false;
          form.elements.current_password.value = '';
        }
      };
      form.addEventListener('submit', event => {
        event.preventDefault();
        void run(async () => {
          const { options } = await passkeyRequest('/registration/options', { current_password: form.elements.current_password.value });
          form.elements.current_password.value = '';
          const credential = await createPasskeyCredential(options);
          await passkeyRequest('/registration/verify', { credential, label: form.elements.label.value.trim() });
          await render('Passkey gespeichert. Du kannst dich jetzt damit anmelden.');
        });
      });
      container.querySelectorAll('[data-remove-passkey]').forEach(button => {
        button.addEventListener('click', () => {
          if (!form.elements.current_password.reportValidity()) return;
          if (!window.confirm(translate('Diesen Passkey entfernen? Du kannst dich weiterhin mit deinem Passwort anmelden.'))) return;
          void run(async () => {
            await passkeyRequest(`/${button.dataset.removePasskey}`, { current_password: form.elements.current_password.value }, 'DELETE');
            await render('Passkey entfernt.');
          });
        });
      });
    };
    await render();
  } catch (error) {
    container.textContent = translate(error instanceof TypeError ? 'Einstellungen konnten nicht geladen werden.' : error.message);
  }
}

export async function register(username, email, turnstileToken = null, password = null) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: email || null,
      password: password || null,
      turnstile_token: turnstileToken,
      preferred_language: window.ZDWA_I18N?.getLanguage?.() || 'de',
    }),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  if (data.authenticated) {
    authEpoch += 1;
    authRequest = null;
    authCache = data;
    syncLanguage(data);
    notifyAuthState(data);
  }
  return data;
}

export const requestRegistration = register;

export function inspectRegistration(token) {
  return publicAuthPost('/api/auth/registration/inspect', { token });
}

export async function completeRegistration(token, password) {
  const data = await publicAuthPost('/api/auth/registration/complete', { token, password });
  authEpoch += 1;
  authRequest = null;
  authCache = data;
  syncLanguage(data);
  notifyAuthState(data);
  return data;
}

export function requestPasswordReset(email) {
  return publicAuthPost('/api/auth/password-reset', {
    email,
    preferred_language: window.ZDWA_I18N?.getLanguage?.() || 'de',
  });
}

export function inspectPasswordReset(token) {
  return publicAuthPost('/api/auth/password-reset/inspect', { token });
}

export function completePasswordReset(token, password) {
  return publicAuthPost('/api/auth/password-reset/complete', { token, password });
}

export function inspectEmailConfirmation(token) {
  return publicAuthPost('/api/auth/email/inspect', { token });
}

export function confirmEmail(token) {
  return publicAuthPost('/api/auth/email/confirm', { token });
}

export async function getEmailStatus() {
  const response = await apiFetch('/api/auth/email');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  return data;
}

export async function requestAccountEmail(email, currentPassword) {
  const response = await apiFetch('/api/auth/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, current_password: currentPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  return data;
}

export async function logout() {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Abmelden fehlgeschlagen');
  // An anonymous visitor may still use a public game. Preserve that
  // server-confirmed capability for the logout notification so a mounted
  // product shell does not briefly revoke a public route before navigation.
  const gameAccess = authCache?.game_access || authCache?.user?.game_access;
  authEpoch += 1;
  authCache = null;
  authRequest = null;
  notifyAuthState({
    authenticated: false,
    user: null,
    ...(gameAccess ? { game_access: gameAccess } : {}),
  });
}

export async function changeUsername(username, currentPassword) {
  const response = await apiFetch('/api/auth/change-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, current_password: currentPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(Array.isArray(data.detail) ? 'username_invalid' : data.detail));
  authEpoch += 1;
  authRequest = null;
  authCache = data;
  notifyAuthState(data);
  return data;
}

export function mountUsernameSettings(container, { user, onChanged, zilch = false }) {
  if (!container || container.dataset.bound) return;
  container.dataset.bound = 'true';
  container.innerHTML = `
    <p>${escapeHtml(translate('Dein Benutzername gilt für ZDWA und Zilch sowie für die Anmeldung. Statistiken, Erfolge und deine Spielerauswahl bleiben erhalten.'))}</p>
    <p class="muted small">${escapeHtml(translate('Auch abgeschlossene Partien zeigen deinen aktuellen Kontonamen. Gastnamen und Nachrichtentexte bleiben unverändert. Dein Profillink ändert sich; der alte Name wird wieder frei.'))}</p>
    <form class="${zilch ? 'zilch-settings-form' : 'form-stack'}" data-username-form>
      <label>${escapeHtml(translate('Neuer Benutzername'))}<input name="username" autocomplete="username" minlength="3" maxlength="32" required aria-describedby="usernameRules"></label>
      <p id="usernameRules" class="muted small">${escapeHtml(translate('3–32 Zeichen: Buchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich. Kein Punkt oder Bindestrich am Anfang.'))}</p>
      <label>${escapeHtml(translate('Aktuelles Passwort'))}<input name="current_password" type="password" autocomplete="current-password" maxlength="256" required></label>
      <button type="submit" class="primary">${escapeHtml(translate('Benutzername speichern'))}</button>
    </form>
    <p data-username-message role="status" aria-live="polite"></p>`;
  const form = container.querySelector('form');
  const username = form.elements.username;
  const password = form.elements.current_password;
  const button = form.querySelector('button');
  const message = container.querySelector('[data-username-message]');
  username.value = user.username;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    message.textContent = translate('Benutzername wird gespeichert …');
    try {
      const data = await changeUsername(username.value.trim(), password.value);
      username.value = data.user.username;
      password.value = '';
      onChanged(data);
      message.textContent = translate('Benutzername geändert. Melde dich künftig mit dem neuen Namen an.');
    } catch (error) {
      message.textContent = translate(error instanceof TypeError ? 'Einstellungen konnten nicht gespeichert werden.' : error.message);
    } finally {
      button.disabled = false;
    }
  });
}

export async function mountEmailSettings(container, { zilch = false } = {}) {
  if (!container || container.dataset.bound) return;
  container.dataset.bound = 'true';
  const formClass = zilch ? 'zilch-settings-form' : 'form-stack';
  const render = status => {
    const confirmed = status?.email_confirmed && status?.email;
    const pending = status?.pending_email;
    const unavailable = status?.delivery_available === false;
    container.innerHTML = unavailable
      ? `<p>${escapeHtml(translate('E-Mail-Anmeldung und Passwort-Reset werden für dieses Konto noch vorbereitet.'))}</p>`
      : `<p>${escapeHtml(confirmed
        ? translate('Bestätigte E-Mail-Adresse:')
        : translate('Hinterlege eine bestätigte E-Mail-Adresse für Anmeldung und Passwort-Reset.'))} ${confirmed ? `<strong>${escapeHtml(status.email)}</strong>` : ''}</p>
        ${pending ? `<p class="muted small">${escapeHtml(translate('Bestätigung ausstehend für'))} <strong>${escapeHtml(pending)}</strong>.</p>` : ''}
        <form class="${formClass}" data-email-form>
          <label>${escapeHtml(translate('E-Mail-Adresse'))}<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
          <label>${escapeHtml(translate('Aktuelles Passwort'))}<input name="current_password" type="password" autocomplete="current-password" maxlength="256" required></label>
          <button type="submit" class="primary">${escapeHtml(translate('Bestätigungs-E-Mail senden'))}</button>
        </form>
        <p data-email-message role="status" aria-live="polite"></p>`;
    if (unavailable) return;
    const form = container.querySelector('[data-email-form]');
    const message = container.querySelector('[data-email-message]');
    const button = form?.querySelector('button');
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      if (button?.disabled) return;
      button.disabled = true;
      message.textContent = translate('Bestätigungs-E-Mail wird gesendet …');
      try {
        const result = await requestAccountEmail(form.elements.email.value.trim(), form.elements.current_password.value);
        form.elements.current_password.value = '';
        const notice = result.already_confirmed
          ? translate('Diese E-Mail-Adresse ist bereits bestätigt.')
          : translate('Bestätigungs-E-Mail gesendet. Öffne den Link in der Nachricht.');
        const updated = await getEmailStatus();
        render(updated);
        container.querySelector('[data-email-message]').textContent = notice;
      } catch (error) {
        message.textContent = translate(error instanceof TypeError ? 'Einstellungen konnten nicht gespeichert werden.' : error.message);
      } finally {
        if (button && document.contains(button)) button.disabled = false;
      }
    });
  };
  try {
    render(await getEmailStatus());
  } catch (error) {
    container.innerHTML = `<p role="status">${escapeHtml(translate(error instanceof TypeError ? 'Einstellungen konnten nicht geladen werden.' : error.message))}</p>`;
  }
}

export function authError(detail) {
  const messages = {
    passkeys_unavailable: 'Passkeys sind momentan nicht verfügbar.',
    passkey_temporarily_blocked: 'Zu viele Passkey-Anfragen. Bitte versuche es später erneut.',
    passkey_not_found: 'Dieser Passkey wurde bereits entfernt.',
    password_change_required: 'Bitte ändere zuerst dein temporäres Passwort.',
    passkey_not_supported: 'Dieser Browser unterstützt keine Passkeys. Nutze einen aktuellen Browser auf einem unterstützten Gerät.',
    passkey_cancelled: 'Die Passkey-Anmeldung wurde abgebrochen oder ist abgelaufen. Versuche es erneut oder nutze dein Passwort.',
    passkey_browser_failed: 'Der Passkey konnte nicht verwendet werden. Versuche es erneut oder nutze dein Passwort.',
    passkey_verification_failed: 'Der Passkey konnte nicht bestätigt werden. Versuche es erneut oder nutze dein Passwort.',
    passkey_ceremony_invalid: 'Die Passkey-Anfrage ist abgelaufen. Bitte starte erneut.',
    passkey_already_registered: 'Dieser Passkey ist bereits registriert.',
    passkey_limit_reached: 'Du hast bereits die maximale Anzahl Passkeys. Entferne zuerst einen alten Passkey.',
    passkey_label_invalid: 'Bitte wähle einen Passkey-Namen mit höchstens 64 Zeichen.',
    passkey_options_invalid: 'Die Passkey-Anfrage ist ungültig. Bitte starte erneut.',
    passkey_response_invalid: 'Der Passkey konnte nicht bestätigt werden. Versuche es erneut oder nutze dein Passwort.',
    username_taken: 'Benutzername ist bereits vergeben',
    username_invalid: 'Bitte prüfe deinen neuen Benutzernamen und das aktuelle Passwort.',
    username_preview_managed: 'Dieser Name ist an einen Zilch-Testzugang gebunden. Bitte wende dich an die Administration.',
    invalid_credentials: 'Benutzername oder Passwort ist falsch.',
    login_temporarily_blocked: 'Zu viele Fehlversuche. Bitte später erneut versuchen.',
    registration_temporarily_blocked: 'Zu viele Registrierungen. Bitte warte kurz und versuche es später erneut.',
    email_request_temporarily_blocked: 'Zu viele E-Mail-Anfragen. Bitte warte kurz und versuche es später erneut.',
    email_delivery_unavailable: 'Die E-Mail-Funktion ist momentan nicht verfügbar.',
    email_taken: 'Diese E-Mail-Adresse wird bereits für ein Konto verwendet.',
    username_or_email_taken: 'Benutzername oder E-Mail-Adresse ist bereits vergeben.',
    registration_pending: 'Für diesen Benutzernamen oder diese E-Mail läuft bereits eine Bestätigung.',
    registration_token_invalid: 'Dieser Bestätigungslink ist ungültig oder abgelaufen.',
    password_reset_token_invalid: 'Dieser Passwort-Link ist ungültig oder abgelaufen.',
    email_verification_token_invalid: 'Dieser E-Mail-Link ist ungültig oder abgelaufen.',
    preferred_language_invalid: 'Bitte wähle eine unterstützte Sprache.',
    game_creation_temporarily_blocked: 'Zu viele neue Spiele. Bitte warte kurz und versuche es später erneut.',
    captcha_required: 'Bitte bestätige zuerst, dass du kein Bot bist.',
    captcha_invalid: 'Die Sicherheitsprüfung ist abgelaufen oder ungültig. Bitte versuche es erneut.',
    captcha_unavailable: 'Die Sicherheitsprüfung ist momentan nicht erreichbar. Bitte versuche es später erneut.',
    game_delete_confirmation_mismatch: 'Die eingegebene Spiel-ID stimmt nicht überein.',
    deletion_reason_too_short: 'Die Begründung muss mindestens 10 Zeichen lang sein.',
    game_already_deleted: 'Dieses Spiel wurde bereits gelöscht.',
    game_not_found: 'Das Spiel wurde nicht gefunden.',
    current_password_invalid: 'Das aktuelle Passwort ist falsch.',
    password_unchanged: 'Das neue Passwort muss sich vom bisherigen unterscheiden.',
    authentication_required: 'Bitte zuerst anmelden.',
    admin_required: 'Admin-Berechtigung erforderlich.',
  };
  return messages[String(detail || '')] || String(detail || 'Unbekannter Fehler');
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

export function formatNumber(value, fallback = '—') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return fallback;
  const locale = window.ZDWA_I18N?.getLanguage?.() === 'en' ? 'en-GB' : 'de-CH';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value));
}

function translate(value) {
  return window.ZDWA_I18N?.t?.(value) || String(value ?? '');
}

/**
 * Render the account-only achievement title that accompanies a player name.
 * Guests deliberately have no rank payload and therefore no badge.
 */
export function playerRankBadge(player, { compact = false, owner = '' } = {}) {
  const rank = player?.achievement_rank;
  if (!rank || typeof rank !== 'object') return '';
  const key = String(rank.key || 'newbie').replace(/[^a-z0-9-]/gi, '') || 'newbie';
  const stars = Math.max(0, Math.min(6, Math.trunc(Number(rank.stars) || 0)));
  const points = Math.max(0, Math.trunc(Number(rank.points) || 0));
  const pointsPossible = Math.max(0, Math.trunc(Number(rank.points_possible) || 0));
  const starText = stars ? '★'.repeat(stars) : '☆';
  const label = translate(rank.title || 'Newbie');
  const rankTitle = `${translate('Rang')}: ${label} · ${formatNumber(points, '0')} / ${formatNumber(pointsPossible, '0')} ${translate('Ehrenberg-Marken')} · ${translate('Rangabzeichen öffnen')}`;
  return `<span class="player-rank player-rank--${escapeHtml(key)}${compact ? ' player-rank--compact' : ''}" role="link" tabindex="0" data-rank-legend data-rank-key="${escapeHtml(key)}" data-rank-points="${points}" data-rank-points-possible="${pointsPossible}"${owner ? ` data-rank-owner="${escapeHtml(owner)}"` : ''} title="${escapeHtml(rankTitle)}" aria-label="${escapeHtml(rankTitle)}"><span class="player-rank-stars" aria-hidden="true">${starText}</span><span class="player-rank-title">${escapeHtml(label)}</span></span>`;
}

export function playerNameMarkup(player, { name, compactRank = false, fallback = 'Spieler', profileLink = false, avatarSize = 'tiny' } = {}) {
  const label = name ?? player?.name ?? player?.username ?? fallback;
  const username = player?.username || player?.name;
  const userId = Number(player?.user_id ?? player?.id);
  const nameMarkup = profileLink && Number.isInteger(userId) && userId > 0 && username
    ? `<a class="player-name-label" href="/api/players/by-id/${userId}/profile?game=zdwa">${escapeHtml(label)}</a>`
    : `<span class="player-name-label">${escapeHtml(label)}</span>`;
  return `<span class="player-name-with-rank">${avatarMarkup(player, { size: avatarSize })}${nameMarkup}${playerRankBadge(player, { compact: compactRank, owner: label })}</span>`;
}
