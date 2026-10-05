import { authError, escapeHtml, loadAuth, passkeysSupported, register, registerWithPasskey } from './auth.js';

const passkeyHint = 'Mit Passkey erstellst du dein Konto sofort – ohne E-Mail oder Passwort. Ein Backup-Passwort kannst du später im Konto einrichten.';
const unavailableMessage = 'Registrierung ist momentan nicht verfügbar. Die Anmeldung funktioniert weiterhin.';
const t = value => window.ZDWA_I18N?.t?.(value) || String(value || '');

export function registrationFormMarkup(prefix) {
  return `<form class="zilch-login-form" data-registration-form>
    <p class="registration-intro">${escapeHtml(t('Neues Konto erstellen'))}</p>
    <label for="${prefix}Username">${escapeHtml(t('Name für dein Konto'))}<input id="${prefix}Username" data-registration-username autocomplete="username" minlength="3" maxlength="32" required></label>
    <label for="${prefix}Method">${escapeHtml(t('Anmeldemethode'))}<select id="${prefix}Method" data-registration-method aria-describedby="${prefix}Hint"><option value="passkey">${escapeHtml(t('Passkey (empfohlen)'))}</option><option value="password">${escapeHtml(t('E-Mail und Passwort (Backup)'))}</option></select></label>
    <p id="${prefix}Hint" class="zilch-muted registration-hint" data-registration-hint>${escapeHtml(t(passkeyHint))}</p>
    <label for="${prefix}Email" hidden>${escapeHtml(t('E-Mail-Adresse'))}<input id="${prefix}Email" data-registration-email type="email" autocomplete="email" maxlength="254"></label>
    <label for="${prefix}Password" hidden>${escapeHtml(t('Passwort'))}<input id="${prefix}Password" data-registration-password type="password" autocomplete="new-password" minlength="8" maxlength="256"></label>
    <div class="zilch-login-actions"><button class="primary" type="submit">${escapeHtml(t('Konto mit Passkey erstellen'))}</button></div>
    <div data-registration-challenge hidden></div>
  </form>`;
}

export function mountRegistrationForm(form, { auth = null, onAuthenticated, onMessage } = {}) {
  if (!form) return;
  const username = form.querySelector('[data-registration-username]');
  const method = form.querySelector('[data-registration-method]');
  const hint = form.querySelector('[data-registration-hint]');
  const email = form.querySelector('[data-registration-email]');
  const password = form.querySelector('[data-registration-password]');
  const submit = form.querySelector('button[type="submit"]');
  const challenge = form.querySelector('[data-registration-challenge]');
  const panel = form.closest('[data-registration-panel]') || form;
  const protection = { enabled: false, token: null, widgetId: null, scriptPromise: null, initializationPromise: null, authenticated: false, epoch: 0 };
  let config = auth;
  let registering = false;
  const message = (value, kind = '') => onMessage?.(t(value), kind);

  function renderMethod() {
    const passkeyAvailable = config?.passkeys?.enabled && passkeysSupported();
    const emailEnabled = config?.registration?.email_enabled !== false;
    method.querySelector('[value="passkey"]').disabled = !passkeyAvailable;
    if (!passkeyAvailable) method.value = 'password';
    const usePasskey = method.value === 'passkey';
    method.querySelector('[value="password"]').textContent = t(emailEnabled
      ? 'E-Mail und Passwort (Backup)' : 'Passwort (Backup)');
    email.closest('label').hidden = usePasskey || !emailEnabled;
    email.required = !usePasskey && emailEnabled;
    email.disabled = usePasskey || !emailEnabled;
    password.closest('label').hidden = usePasskey || emailEnabled;
    password.required = !usePasskey && !emailEnabled;
    password.disabled = usePasskey || emailEnabled;
    hint.textContent = t(usePasskey ? passkeyHint
      : emailEnabled ? 'Neues Konto per E-Mail bestätigen' : 'Passwort (Backup)');
    submit.textContent = t(usePasskey ? 'Konto mit Passkey erstellen'
      : emailEnabled ? 'Konto per E-Mail erstellen' : 'Konto erstellen');
    submit.classList.toggle('primary', usePasskey);
    submit.classList.toggle('ghost', !usePasskey);
  }

  function discardProtection() {
    protection.epoch += 1;
    protection.token = null;
    protection.enabled = false;
    if (protection.widgetId !== null) window.turnstile?.remove(protection.widgetId);
    protection.widgetId = null;
    challenge.replaceChildren();
    challenge.hidden = true;
  }

  function render(nextAuth) {
    config = nextAuth;
    protection.authenticated = Boolean(nextAuth?.authenticated || nextAuth?.user);
    panel.hidden = !nextAuth || protection.authenticated;
    if (protection.authenticated) discardProtection();
    if (nextAuth) renderMethod();
  }

  function loadChallengeScript() {
    if (typeof window.turnstile?.render === 'function') return Promise.resolve();
    if (protection.scriptPromise) return protection.scriptPromise;
    protection.scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const failed = () => {
        window.clearTimeout(timeout);
        script.remove();
        reject(new Error(unavailableMessage));
      };
      const timeout = window.setTimeout(failed, 15000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.addEventListener('load', () => {
        if (typeof window.turnstile?.render !== 'function') return failed();
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      script.addEventListener('error', failed, { once: true });
      document.head.appendChild(script);
    }).catch(error => {
      protection.scriptPromise = null;
      throw error;
    });
    return protection.scriptPromise;
  }

  function initializeProtection() {
    if (protection.authenticated) return Promise.resolve(false);
    if (protection.widgetId !== null) return Promise.resolve(true);
    if (protection.initializationPromise) return protection.initializationPromise;
    const epoch = protection.epoch;
    const isCurrent = () => epoch === protection.epoch && !protection.authenticated && form.isConnected;
    const request = (async () => {
      const identity = await loadAuth();
      if (!isCurrent() || identity?.authenticated || identity?.user) return false;
      const settings = identity?.registration || {};
      if (typeof settings.turnstile_enabled !== 'boolean'
        || (settings.turnstile_enabled && (typeof settings.turnstile_site_key !== 'string' || !settings.turnstile_site_key.trim()))) {
        throw new Error(unavailableMessage);
      }
      if (!settings.turnstile_enabled) return true;
      protection.enabled = true;
      challenge.hidden = false;
      await loadChallengeScript();
      if (!isCurrent()) return false;
      protection.widgetId = window.turnstile.render(challenge, {
        sitekey: settings.turnstile_site_key,
        action: 'register',
        callback: token => { if (isCurrent()) protection.token = token; },
        'expired-callback': () => { if (isCurrent()) protection.token = null; },
        'error-callback': () => { if (isCurrent()) protection.token = null; },
        'timeout-callback': () => { if (isCurrent()) protection.token = null; },
      });
      return true;
    })().catch(error => {
      if (!isCurrent()) return false;
      throw error;
    }).finally(() => {
      if (protection.initializationPromise === request) protection.initializationPromise = null;
    });
    protection.initializationPromise = request;
    return request;
  }

  method.addEventListener('change', renderMethod);
  window.addEventListener('zdwa:auth-state', event => {
    if (!form.isConnected) return;
    render(event.detail);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (registering) return;
    registering = true;
    submit.disabled = true;
    method.disabled = true;
    message('');
    try {
      if (!await initializeProtection()) return;
      if (protection.enabled && !protection.token) {
        message('Bitte bestätige zuerst, dass du kein Bot bist.', 'error');
        return;
      }
      try {
        const result = method.value === 'passkey'
          ? await registerWithPasskey(username.value, protection.token)
          : await register(username.value, email.value, protection.token, password.required ? password.value : null);
        form.reset();
        if (result.authenticated) await onAuthenticated?.(result);
        else {
          renderMethod();
          message('Wenn diese Adresse noch kein Konto hat, erhältst du einen Bestätigungslink. Öffne ihn, um dein Passwort festzulegen.', 'success');
        }
      } finally {
        protection.token = null;
        if (protection.widgetId !== null) window.turnstile?.reset(protection.widgetId);
      }
    } catch (error) {
      message(error.message || authError(), 'error');
    } finally {
      registering = false;
      submit.disabled = false;
      method.disabled = false;
    }
  });
  render(auth);
  if (!auth) void loadAuth().then(render).catch(() => message(unavailableMessage, 'error'));
  return { render };
}
