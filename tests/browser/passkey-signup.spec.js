const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test.use({ serviceWorkers: 'block' });

const entries = [
  { name: 'ZDWA landing', path: '/', form: '#registrationForm', username: '#registrationUsername', method: '#registrationMethod', email: '#registrationEmail', password: '#registrationPassword', error: '#loginError', signedIn: '#authBadge' },
  { name: 'Zilch login', path: '/zilch/anmelden', form: '#zilchRegistrationForm', username: '#zilchRegistrationUsername', method: '#zilchRegistrationMethod', email: '#zilchRegistrationEmail', password: '#zilchRegistrationPassword', error: '#zilchLoginMessage', signedIn: '#zilchLoginAccountName' },
  { name: 'Zilch landing', path: '/zilch', form: '[data-registration-form]', username: '#zilchLandingRegistrationUsername', method: '#zilchLandingRegistrationMethod', email: '#zilchLandingRegistrationEmail', password: '#zilchLandingRegistrationPassword', error: '[data-registration-message]', signedIn: '.zilch-lobby-identity strong' },
];

async function prepare(page, language, { enabled = true, supported = true, emailEnabled = true, captcha = false, cancel = false } = {}) {
  const state = { user: null, options: [], verifications: [], fallback: [] };
  const access = { zilch_preview: false, zilch_public: true };
  await page.addInitScript(({ language: lang, supported: support, cancel: cancelled }) => {
    localStorage.setItem('zdwa_language', lang);
    if (!support) Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
    navigator.credentials.create = async options => {
      window.signupCreationOptions = options;
      if (cancelled) throw new DOMException('Cancelled', 'NotAllowedError');
      return {
        id: 'AQID', rawId: new Uint8Array([1, 2, 3]).buffer, type: 'public-key',
        response: { clientDataJSON: new Uint8Array([4, 5, 6]).buffer, attestationObject: new Uint8Array([7, 8, 9]).buffer },
        getClientExtensionResults: () => ({}),
      };
    };
    window.turnstile = {
      render: (element, options) => { window.signupChallenge = options; element.textContent = 'Test security check'; return 'signup-widget'; },
      reset: () => {}, remove: () => {},
    };
  }, { language, supported, cancel });
  await page.route('**/zilch', route => route.fulfill({
    contentType: 'text/html', body: fs.readFileSync('app/static/zilch-lobby.html', 'utf8')
      .replace('data-zilch-root>', 'data-zilch-root data-zilch-public-lobby="true">'),
  }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    authenticated: Boolean(state.user), user: state.user, game_access: access,
    registration: { email_enabled: emailEnabled, turnstile_enabled: captcha, turnstile_site_key: captcha ? 'signup-test-key' : null },
    passkeys: { enabled, ...(state.user ? { has_credentials: true } : {}) },
  } }));
  await page.route('**/api/auth/passkeys/signup/options', async route => {
    state.options.push(route.request().postDataJSON());
    await route.fulfill({ json: { options: {
      challenge: 'AQID', rp: { id: 'localhost', name: 'RollTheDice test' },
      user: { id: 'AQID', name: 'NewPlayer', displayName: 'NewPlayer' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    } } });
  });
  await page.route('**/api/auth/passkeys/signup/verify', async route => {
    state.verifications.push(route.request().postDataJSON());
    state.user = { id: 701, username: 'NewPlayer', csrf_token: 'signup-test-csrf', has_password: false, game_access: access, preferences: { preferred_language: language } };
    await route.fulfill({ status: 201, json: { authenticated: true, user: state.user } });
  });
  await page.route('**/api/auth/register', async route => {
    state.fallback.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { authenticated: false } });
  });
  await page.route('**/api/games?game_type=zilch', route => route.fulfill({ json: { games: [] } }));
  return state;
}

for (const entry of entries) {
  for (const language of ['de', 'en']) {
    test(`${entry.name}: name-only passkey account creation (${language})`, async ({ page }) => {
      const state = await prepare(page, language);
      await page.goto(entry.path);
      const form = page.locator(entry.form);
      await expect(page.locator(entry.method)).toHaveValue('passkey');
      await expect(page.locator(entry.error)).toBeEmpty();
      await expect(page.locator(entry.email)).toBeHidden();
      await expect(page.locator(entry.password)).toBeHidden();
      await expect(form.locator('button[type="submit"]')).toHaveText(language === 'en' ? 'Create account with passkey' : 'Konto mit Passkey erstellen');
      for (const width of [1280, 768, 375]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `/tmp/rollthedice-signup-${entry.name.toLowerCase().replaceAll(' ', '-')}-${language}-${width}.png`, fullPage: true });
      }
      await page.locator(entry.username).fill('NewPlayer');
      await form.locator('button[type="submit"]').click();
      await expect(page.locator(entry.signedIn)).toContainText('NewPlayer');
      expect(state.options).toHaveLength(1);
      expect(state.options[0]).toMatchObject({ username: 'NewPlayer', preferred_language: language });
      expect(state.options[0]).not.toHaveProperty('email');
      expect(state.options[0]).not.toHaveProperty('password');
      expect(state.verifications).toHaveLength(1);
      expect(state.verifications[0].credential.response.attestationObject).toBe('BwgJ');
      expect(state.fallback).toHaveLength(0);
      await expect(form).toBeHidden();
      expect(new URL(page.url()).pathname).toBe(entry.path);
    });

    test(`${entry.name}: cancellation keeps the name and offers explicit backup (${language})`, async ({ page }) => {
      const state = await prepare(page, language, { cancel: true });
      await page.goto(entry.path);
      await page.locator(entry.username).fill('NewPlayer');
      await page.locator(`${entry.form} button[type="submit"]`).click();
      await expect(page.locator(entry.error)).toContainText(language === 'en' ? 'cancelled' : 'abgebrochen');
      await expect(page.locator(entry.username)).toHaveValue('NewPlayer');
      await expect(page.locator(entry.method)).toHaveValue('passkey');
      await expect(page.locator(`${entry.form} button[type="submit"]`)).toBeEnabled();
      expect(state.verifications).toHaveLength(0);
      await page.locator(entry.method).selectOption('password');
      await expect(page.locator(entry.email)).toBeVisible();
      await page.locator(entry.email).fill('backup@example.test');
      await page.locator(`${entry.form} button[type="submit"]`).click();
      await expect.poll(() => state.fallback.length).toBe(1);
      expect(state.fallback[0]).toMatchObject({ username: 'NewPlayer', email: 'backup@example.test', password: null });
    });

    for (const reason of ['unsupported', 'disabled']) {
      test(`${entry.name}: password signup is usable when passkeys are ${reason} (${language})`, async ({ page }) => {
        const state = await prepare(page, language, { enabled: reason !== 'disabled', supported: reason !== 'unsupported', emailEnabled: false });
        await page.goto(entry.path);
        await expect(page.locator(entry.method)).toHaveValue('password');
        await expect(page.locator(entry.email)).toBeHidden();
        await expect(page.locator(entry.password)).toBeVisible();
        await page.locator(entry.username).fill('NewPlayer');
        await page.locator(entry.password).fill('backup-password-123');
        await page.locator(`${entry.form} button[type="submit"]`).click();
        await expect.poll(() => state.fallback.length).toBe(1);
        expect(state.fallback[0]).toMatchObject({ username: 'NewPlayer', password: 'backup-password-123' });
        expect(state.options).toHaveLength(0);
      });
    }
  }

  test(`${entry.name}: signup waits for the required security check`, async ({ page }) => {
    const state = await prepare(page, 'de', { captcha: true, cancel: true });
    await page.goto(entry.path);
    await page.locator(entry.username).fill('NewPlayer');
    await page.locator(`${entry.form} button[type="submit"]`).click();
    await expect(page.locator(entry.error)).toContainText('Bitte bestätige zuerst');
    expect(state.options).toHaveLength(0);
    await page.evaluate(() => window.signupChallenge.callback('test-turnstile-token'));
    await page.locator(`${entry.form} button[type="submit"]`).click();
    await expect(page.locator(entry.error)).toContainText('abgebrochen');
    expect(state.options).toHaveLength(1);
    expect(state.options[0].turnstile_token).toBe('test-turnstile-token');
    expect(state.verifications).toHaveLength(0);
  });
}
