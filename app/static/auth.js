let authCache = null;

export async function loadAuth({ refresh = false } = {}) {
  if (authCache && !refresh) return authCache;
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  authCache = await response.json();
  return authCache;
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
  if (response.status === 401) authCache = null;
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
  authCache = data;
  return data;
}

export async function register(username, password, turnstileToken = null) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, turnstile_token: turnstileToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(authError(data.detail));
  authCache = data;
  return data;
}

export async function logout() {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Abmelden fehlgeschlagen');
  authCache = null;
}

export function authError(detail) {
  const messages = {
    invalid_credentials: 'Benutzername oder Passwort ist falsch.',
    login_temporarily_blocked: 'Zu viele Fehlversuche. Bitte später erneut versuchen.',
    registration_temporarily_blocked: 'Zu viele Registrierungen. Bitte warte kurz und versuche es später erneut.',
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
  return new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 }).format(Number(value));
}
