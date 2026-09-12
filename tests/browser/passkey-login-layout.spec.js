const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const games = [
  { name: 'ZDWA', path: '/', details: '#passwordLogin', form: '#loginForm', key: '#passkeyLoginButton', unavailable: '#passkeyUnavailable', fallback: '#passwordLoginFallback', username: '#loginUsername', password: '#loginPassword', error: '#loginError' },
  { name: 'Zilch', path: '/zilch/anmelden', details: '#zilchPasswordLogin', form: '#zilchLoginForm', key: '#zilchPasskeyLoginButton', unavailable: '#zilchPasskeyUnavailable', fallback: '#zilchPasswordLoginFallback', username: '#zilchLoginUsername', password: '#zilchLoginPassword', error: '#zilchLoginMessage' },
];

async function prepare(page, language, { enabled = true, supported = true } = {}) {
  await page.addInitScript(({ language: lang, supported: supportsPasskeys }) => {
    localStorage.setItem('zdwa_language', lang);
    if (!supportsPasskeys) Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
  }, { language, supported });
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    authenticated: false, user: null,
    registration: { email_enabled: true, turnstile_enabled: false },
    passkeys: { enabled },
  } }));
}

for (const game of games) {
  for (const language of ['de', 'en']) {
    test(`${game.name} offers passkey first and reveals password using the keyboard (${language})`, async ({ page }) => {
      await prepare(page, language);
      await page.goto(game.path);
      const details = page.locator(game.details);
      const summary = details.locator(':scope > summary');
      await expect(page.locator(game.key)).toBeVisible();
      await expect(page.locator(game.form)).toBeHidden();
      await expect(page.locator(game.unavailable)).toBeHidden();
      await expect(summary).toHaveText(language === 'en' ? 'Sign in with password' : 'Mit Passwort anmelden');
      await expect(details).not.toHaveAttribute('open');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(game.username)).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.locator(game.username)).toBeFocused();
      await summary.focus();
      await page.keyboard.press('Space');
      await expect(page.locator(game.password)).toBeHidden();
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `/tmp/rollthedice-passkey-login-${game.name.toLowerCase()}-${language}-${width === 375 ? 'mobile' : 'desktop'}.png`, fullPage: true });
      }
      if (game.name === 'ZDWA') {
        await expect(page.locator('#headerAccountLink')).toHaveAttribute('href', '#accountLogin');
        await page.locator('#headerAccountLink').click();
        await expect(details).not.toHaveAttribute('open');
      }
    });

    for (const reason of ['unsupported', 'disabled']) {
      test(`${game.name} keeps password reachable in one explicit step when passkeys are ${reason} (${language})`, async ({ page }) => {
        await prepare(page, language, { enabled: reason !== 'disabled', supported: reason !== 'unsupported' });
        let loginBody;
        await page.route('**/api/auth/login', async route => {
          loginBody = route.request().postDataJSON();
          await route.fulfill({ status: 401, json: { detail: 'invalid_credentials' } });
        });
        await page.goto(game.path);
        await expect(page.locator(game.key)).toBeHidden();
        await expect(page.locator(game.form)).toBeHidden();
        await expect(page.locator(game.unavailable)).toContainText(language === 'en' ? 'Open “Sign in with password”' : 'Öffne „Mit Passwort anmelden“');
        await page.locator(`${game.details} > summary`).click();
        await expect(page.locator(game.password)).toBeVisible();
        await page.fill(game.username, 'FallbackPlayer');
        await page.fill(game.password, 'fallback-password-123');
        await page.locator(`${game.form} button[type="submit"]`).click();
        await expect.poll(() => loginBody).toMatchObject({ username: 'FallbackPlayer', password: 'fallback-password-123' });
        await expect(page.locator(game.password)).toBeVisible();
      });
    }

    test(`${game.name} cancellation leaves password closed until fallback is requested (${language})`, async ({ page }) => {
      await prepare(page, language);
      await page.addInitScript(() => {
        navigator.credentials.get = async () => { throw new DOMException('Cancelled', 'NotAllowedError'); };
      });
      await page.route('**/api/auth/passkeys/authentication/options', route => route.fulfill({
        json: { options: { challenge: 'AQID', rpId: 'localhost', userVerification: 'required' } },
      }));
      await page.goto(game.path);
      await page.locator(game.key).click();
      await expect(page.locator(game.error)).toContainText(language === 'en' ? 'cancelled' : 'abgebrochen');
      await expect(page.locator(game.form)).toBeHidden();
      await expect(page.locator(game.key)).toBeEnabled();
      await page.locator(game.fallback).click();
      await expect(page.locator(game.password)).toBeVisible();
      await expect(page.locator(game.username)).toBeFocused();
      await expect(page.locator(game.fallback)).toBeHidden();
    });
  }
}
