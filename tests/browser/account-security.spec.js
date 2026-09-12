const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const guest = {
  authenticated: false, user: null,
  registration: { email_enabled: true, turnstile_enabled: false },
  passkeys: { enabled: true },
};

for (const language of ['de', 'en']) {
  test(`email registration sends no password and remains unconfirmed (${language})`, async ({ page }) => {
    await page.addInitScript(lang => localStorage.setItem('zdwa_language', lang), language);
    await page.route('**/api/auth/me', route => route.fulfill({ json: guest }));
    let body;
    await page.route('**/api/auth/register', async route => {
      body = route.request().postDataJSON();
      await route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.goto('/');
    await page.fill('#registrationUsername', 'MailPlayer');
    await page.fill('#registrationEmail', 'mail@example.test');
    await expect(page.locator('#registrationPassword')).toBeHidden();
    await page.click('#registerBtn');
    await expect(page.locator('#loginError')).toContainText(language === 'en' ? 'confirmation link' : 'Bestätigungslink');
    expect(body).toMatchObject({ username: 'MailPlayer', email: 'mail@example.test', password: null, preferred_language: language });
    await expect(page.locator('#authActions')).toBeHidden();
    await expect(page.locator('#loginForm')).toBeVisible();
  });

  test(`confirmation requires a click and removes the secret from the URL (${language})`, async ({ page }) => {
    const token = 'local-test-token-with-enough-entropy';
    let completions = 0;
    await page.route('**/api/auth/registration/inspect', async route => {
      expect(route.request().postDataJSON()).toEqual({ token });
      await route.fulfill({ json: { valid: true } });
    });
    await page.route('**/api/auth/registration/complete', async route => {
      completions += 1;
      expect(route.request().postDataJSON()).toEqual({ token, password: 'local-strong-password' });
      await route.fulfill({ json: { authenticated: true, user: { username: 'MailPlayer' } } });
    });
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    const response = await page.goto(`/registrierung/bestaetigen?lang=${language}#token=${token}`);
    expect(response.headers()['cache-control']).toContain('no-store');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('[name="password"]')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    expect(completions).toBe(0);
    expect(requests.some(url => url.includes(token))).toBe(false);
    expect(requests.some(url => url.includes('shell.js'))).toBe(false);
    await page.fill('[name="password"]', 'local-strong-password');
    await page.fill('[name="confirmation"]', 'different-password');
    await page.locator('[data-password-form] button').click();
    expect(completions).toBe(0);
    await expect(page.locator('[data-message]')).toContainText(language === 'en' ? 'do not match' : 'nicht überein');
    await page.fill('[name="confirmation"]', 'local-strong-password');
    await page.locator('[data-password-form] button').click();
    await expect(page.getByRole('heading')).toHaveText(language === 'en' ? 'Your account is confirmed.' : 'Dein Konto ist bestätigt.');
    expect(completions).toBe(1);
  });
}

test('passkey login is primary, converts binary values and retains password fallback after cancellation', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ json: guest }));
  await page.route('**/api/auth/passkeys/authentication/options', route => route.fulfill({
    json: { options: { challenge: 'AQID', rpId: 'localhost', userVerification: 'required' } },
  }));
  await page.addInitScript(() => {
    window.PublicKeyCredential ||= function () {};
    navigator.credentials.get = async options => {
      window.__passkeyChallenge = Array.from(options.publicKey.challenge);
      throw new DOMException('Cancelled', 'NotAllowedError');
    };
  });
  await page.goto('/');
  const passkey = page.locator('#passkeyLoginButton');
  await expect(passkey).toBeVisible();
  expect(await passkey.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('#loginForm')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await passkey.click();
  await expect(page.locator('#loginError')).toContainText('Passkey-Anmeldung wurde abgebrochen');
  expect(await page.evaluate(() => window.__passkeyChallenge)).toEqual([1, 2, 3]);
  await expect(page.locator('#loginForm')).toBeVisible();
  await expect(passkey).toBeEnabled();
});

for (const language of ['de', 'en']) {
test(`public profile shows manual counts and zero-point reminders (${language})`, async ({ page }) => {
  await page.addInitScript(lang => localStorage.setItem('zdwa_language', lang), language);
  await page.route('**/api/players/TrackedPlayer', route => route.fulfill({ json: { player: {
    username: 'TrackedPlayer', id: 900,
    statistics: { overall: {}, normal: {}, hardcore: {}, abandoned: { games: 7, self_ended_games: 7, zdwa_games: 5, zilch_games: 2 } },
    achievements: { unlocked: [], locked: [{
      name: 'Offener Zettel I', description: '1 ZDWA-Solopartie selbst abgebrochen. Auch ein unperfekter Zettel verdient ein Ende. Keine Rangpunkte.',
      points: 0, target: 1, current: 0,
    }] }, recent_games: [],
  } } }));
  await page.goto('/spieler/TrackedPlayer');
  const bucket = page.locator('.stat-bucket').filter({ has: page.getByRole('heading', { name: language === 'en' ? 'Abandoned games' : 'Abgebrochene Partien' }) });
  await expect(bucket).toContainText(language === 'en' ? "Timeouts, disconnections and games ended by opponents do not count." : 'Timeouts, Verbindungsabbrüche und Abbrüche durch Mitspieler zählen nicht.');
  await expect(bucket.locator('dd')).toHaveText(['5', '2']);
  await expect(page.locator('#lockedAchievements')).toContainText(language === 'en' ? 'Unfinished Sheet I' : 'Offener Zettel I');
  await expect(page.locator('#lockedAchievements')).toContainText(language === 'en' ? 'No rank points.' : 'Keine Rangpunkte.');
  await expect(page.locator('#lockedAchievements .achievement-points')).toContainText('+0');
});
}
