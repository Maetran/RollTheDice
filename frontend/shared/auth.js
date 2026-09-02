let authCache = null;
let authRequest = null;
let authEpoch = 0;

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
  return data;
}

export async function register(username, password, turnstileToken = null) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      turnstile_token: turnstileToken,
      preferred_language: window.ZDWA_I18N?.getLanguage?.() || 'de',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  authEpoch += 1;
  authRequest = null;
  authCache = data;
  syncLanguage(data);
  return data;
}

export async function logout() {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Abmelden fehlgeschlagen');
  authEpoch += 1;
  authCache = null;
  authRequest = null;
}

export function authError(detail) {
  const messages = {
    invalid_credentials: 'Benutzername oder Passwort ist falsch.',
    login_temporarily_blocked: 'Zu viele Fehlversuche. Bitte später erneut versuchen.',
    registration_temporarily_blocked: 'Zu viele Registrierungen. Bitte warte kurz und versuche es später erneut.',
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
export function playerRankBadge(player, { compact = false } = {}) {
  const rank = player?.achievement_rank;
  if (!rank || typeof rank !== 'object') return '';
  const key = String(rank.key || 'newbie').replace(/[^a-z0-9-]/gi, '') || 'newbie';
  const stars = Math.max(0, Math.min(5, Math.trunc(Number(rank.stars) || 0)));
  const starText = stars ? '★'.repeat(stars) : '☆';
  const label = translate(rank.title || 'Newbie');
  const rankTitle = `${translate('Rang')}: ${label} · ${formatNumber(rank.points, '0')} / ${formatNumber(rank.points_possible, '0')} ${translate('Erfolgspunkte')}`;
  return `<span class="player-rank player-rank--${escapeHtml(key)}${compact ? ' player-rank--compact' : ''}" title="${escapeHtml(rankTitle)}" aria-label="${escapeHtml(rankTitle)}"><span class="player-rank-stars" aria-hidden="true">${starText}</span><span class="player-rank-title">${escapeHtml(label)}</span></span>`;
}

export function playerNameMarkup(player, { name, compactRank = false, fallback = 'Spieler' } = {}) {
  const label = name ?? player?.name ?? player?.username ?? fallback;
  return `<span class="player-name-with-rank"><span class="player-name-label">${escapeHtml(label)}</span>${playerRankBadge(player, { compact: compactRank })}</span>`;
}
