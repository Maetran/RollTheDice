const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function account(page, username, language = 'de') {
  const password = 'passkey-prompt-browser-password';
  const adminLogin = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(adminLogin.ok()).toBeTruthy();
  const admin = (await adminLogin.json()).user;
  const created = await page.request.post('/api/admin/users', {
    headers: { 'X-CSRF-Token': admin.csrf_token }, data: { username, temporary_password: 'temporary-prompt-password' },
  });
  expect(created.status()).toBe(201);
  const initial = await page.request.post('/api/auth/login', { data: { username, password: 'temporary-prompt-password' } });
  const initialUser = (await initial.json()).user;
  const headers = { 'X-CSRF-Token': initialUser.csrf_token };
  expect((await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/auth/change-password', { headers,
    data: { current_password: 'temporary-prompt-password', new_password: password },
  })).ok()).toBeTruthy();
  const signedIn = await page.request.post('/api/auth/login', { data: { username, password } });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  const state = { enabled: true, has_credentials: false, forced: false };
  await page.route('**/api/auth/me', async route => {
    const response = await route.fetch();
    const auth = await response.json();
    await route.fulfill({ response, json: { ...auth, user: auth.user ? { ...auth.user, must_change_password: state.forced } : null,
      passkeys: { enabled: state.enabled, has_credentials: state.has_credentials } } });
  });
  await page.route('**/api/auth/passkeys', route => route.fulfill({ json: {
    enabled: state.enabled, credentials: state.has_credentials ? [{ id: 1, label: 'Existing passkey' }] : [],
  } }));
  await page.route('**/api/releases**', route => route.fulfill({ json: {
    viewer_id: user.id,
    can_prompt: new URL(route.request().headers().referer || 'https://example.test').pathname.endsWith('/konto'),
    releases: [{ revision: 'passkey-entry-news', title: 'News', changes: ['A release'], can_announce: true, acknowledged: false }],
  } }));
  return state;
}

for (const game of ['zdwa', 'zilch']) {
  const lobby = game === 'zilch' ? '/zilch' : '/';
  const accountPath = game === 'zilch' ? '/zilch/konto' : '/konto';
  for (const language of ['de', 'en']) {
    test(`${game}: no-passkey reminder leads directly to setup and disappears with a credential (${language})`, async ({ page }, testInfo) => {
      const state = await account(page, `PasskeyPrompt_${game}_${language}`, language);
      // Keep the landing page free of a separate release dialog; the setup
      // destination deliberately receives an unread, announceable release.
      await page.goto(lobby);
      const prompt = page.locator('[data-passkey-prompt]');
      await expect(prompt).toBeVisible();
      await expect(prompt.getByRole('heading')).toHaveText(language === 'en' ? 'Set up your passkey now' : 'Richte jetzt deinen Passkey ein');
      await page.locator('[data-passkey-prompt-link]').click();
      await expect(page).toHaveURL(new RegExp(`${accountPath}\\?passkey=1#settings$`));
      const password = page.locator('[data-passkey-settings] [name=current_password]');
      await expect(password).toBeVisible();
      await expect(password).toBeFocused();
      await expect(page.locator('.release-notes-dialog[open]')).toHaveCount(0);
      await page.setViewportSize({ width: 375, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await testInfo.attach(`${game}-passkey-prompt-${language}`, {
        body: await prompt.screenshot({ path: `/tmp/rollthedice-passkey-prompt-${game}-${language}.png` }), contentType: 'image/png',
      });
      state.has_credentials = true;
      await page.reload();
      await expect(prompt).toBeHidden();
      await expect(page.locator('[data-passkey-list]')).toContainText('Existing passkey');
    });
  }

  test(`${game}: reminder respects capability, required password and logout`, async ({ page }) => {
    const state = await account(page, `PasskeyGuard_${game}`);
    const prompt = page.locator('[data-passkey-prompt]');
    await page.goto(`${accountPath}?passkey=1#settings`);
    await expect(prompt).toBeVisible();
    state.forced = true;
    await page.reload();
    await expect(prompt).toBeHidden();
    await expect(page.locator('details[data-account-action=password]')).toHaveAttribute('open');
    state.forced = false;
    state.enabled = false;
    await page.reload();
    await expect(prompt).toBeHidden();
    state.enabled = true;
    await page.addInitScript(() => Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true }));
    await page.reload();
    await expect(prompt).toBeHidden();
    // Auth events from another bundle must also clear any displayed account hint.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('zdwa:auth-state', { detail: { authenticated: false, user: null } })));
    await expect(prompt).toBeEmpty();
  });
}
