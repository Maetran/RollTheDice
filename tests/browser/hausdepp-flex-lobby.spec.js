const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });
test.beforeAll(({ baseURL }) => expect(new URL(baseURL).port).not.toBe('8000'));

async function setup(page, language = 'de') {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  page.flexRestore = { language: user.preferences.preferred_language, csrf: user.csrf_token };
  await page.request.put('/api/auth/preferences/language', { headers: { 'X-CSRF-Token': user.csrf_token }, data: { preferred_language: language } });
  await page.request.delete('/api/hausdepp/favourite', { headers: { 'X-CSRF-Token': user.csrf_token } });
  await page.addInitScript(lang => localStorage.setItem('zdwa_language', lang), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  await page.goto('/hausdepp');
  return user;
}

test.afterEach(async ({ page }) => {
  if (!page.flexRestore) return;
  const headers = { 'X-CSRF-Token': page.flexRestore.csrf };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: page.flexRestore.language } });
  await page.request.delete('/api/hausdepp/favourite', { headers });
});

for (const language of ['de', 'en']) {
  for (const [device, viewport] of [['mobile', { width: 320, height: 568 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1440, height: 900 }]]) {
    test(`${language} ${device}: open place cards, CPUs, favourite and invitations stay usable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await setup(page, language);
      await page.locator('#hausdeppCreate').click();
      await expect(page.locator('.hd-create-dialog')).toBeVisible();
      await page.locator('[data-create-define]').click();
      await expect(page.locator('[name=waiting_mode][value=open]')).toBeChecked();
      await page.locator('#hausdeppOpenWaiting').click();
      await expect(page).toHaveURL(/\/hausdepp\/spiel\//);
      await expect(page.locator('#hausdeppWaitingSeats > li')).toHaveCount(6);
      await expect(page.locator('#hausdeppHand')).toBeHidden();
      await expect(page.locator('.hd-hand-region')).toBeHidden();
      await expect(page.locator('#hausdeppStartGame')).toBeDisabled();
      await expect(page.locator('#hausdeppAddCpu')).toBeEnabled();
      await expect(page.locator('#hausdeppWaiting [data-invite-action=share]')).toBeVisible();
      await expect(page.locator('#hausdeppWaiting [data-invite-action=call]')).toBeVisible();
      await expect(page.locator('#hausdeppWaiting [data-invite-action=copy]')).toHaveAccessibleName(language === 'de' ? 'Tischlink kopieren' : 'Copy table link');
      await page.locator('#hausdeppAddCpu').click();
      await expect(page.locator('#hausdeppStartGame')).toBeEnabled();
      await expect(page.locator('[data-waiting-action=remove]')).toHaveCount(1);
      await page.locator('#hausdeppAddCpu').click();
      await expect(page.locator('[data-waiting-action=remove]')).toHaveCount(2);
      await page.locator('[data-waiting-action=remove]').first().click();
      await expect(page.locator('[data-waiting-action=remove]')).toHaveCount(1);
      await page.locator('#hausdeppSaveFavourite').click();
      await expect(page.locator('#hausdeppWaitingFeedback')).toContainText(language === 'de' ? 'gespeichert' : 'saved');
      if (process.env.HAUSDEPP_CAPTURE_DIR && language === 'de') {
        await page.locator('#hausdeppTable').evaluate(table => { table.scrollTop = 0; });
        await page.screenshot({ path: `${process.env.HAUSDEPP_CAPTURE_DIR}/${device}-place-cards.png`, fullPage: true });
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(overflow).toBe(false);
      for (const selector of ['#hausdeppAddCpu', '#hausdeppStartGame', '[data-waiting-action=remove]']) {
        const box = await page.locator(selector).first().boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await page.locator('#hausdeppLeaveWaiting').click();
      await expect(page).toHaveURL(/\/hausdepp$/);
      await page.locator('#hausdeppCreate').click();
      await expect(page.locator('[data-create-favourite]')).toBeEnabled();
      await page.locator('[data-create-favourite]').click();
      await expect(page.locator('[data-waiting-action=remove]')).toHaveCount(1);
      await expect(page.locator('#hausdeppStartGame')).toBeEnabled();
      await page.locator('#hausdeppStartGame').click();
      await expect(page.locator('#hausdeppWaiting')).toBeHidden();
      expect(errors).toEqual([]);
    });
  }
}

test('fixed password favourite asks for a fresh password and remains manual until full', async ({ page }) => {
  await setup(page);
  await page.locator('#hausdeppCreate').click();
  await page.locator('[data-create-define]').click();
  await page.locator('[name=waiting_mode][value=fixed]').check();
  await page.locator('[name=players]').selectOption('3');
  await page.locator('[name=tournament][value=true]').check();
  await page.locator('[name=password_required]').check();
  await page.locator('[name=passphrase]').fill('table-password');
  await page.locator('#hausdeppOpenWaiting').click();
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  await expect(page.locator('#hausdeppWaitingSeats > li')).toHaveCount(3);
  await expect(page.locator('#hausdeppWaitingMode')).toContainText(/turnier/i);
  await expect(page.locator('#hausdeppWaiting [data-invite-action=call]')).toBeHidden();
  await page.locator('#hausdeppAddCpu').click();
  await expect(page.locator('#hausdeppStartGame')).toBeDisabled();
  await page.locator('#hausdeppAddCpu').click();
  await expect(page.locator('#hausdeppStartGame')).toBeEnabled();
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  await page.locator('#hausdeppSaveFavourite').click();
  await expect(page.locator('#hausdeppWaitingFeedback')).toContainText('gespeichert');
  await page.locator('#hausdeppLeaveWaiting').click();
  await expect(page).toHaveURL(/\/hausdepp$/);
  await page.locator('#hausdeppCreate').click();
  await page.locator('[data-create-favourite]').click();
  await expect(page.locator('[name=passphrase]')).toHaveValue('');
  await page.locator('[name=passphrase]').fill('fresh-table-password');
  await page.locator('#hausdeppOpenWaiting').click();
  await expect(page.locator('[data-waiting-action=remove]')).toHaveCount(2);
  await expect(page.locator('#hausdeppWaitingMode')).toContainText(/turnier/i);
});

test('a failed favourite read remains visible across reopen, with custom creation available', async ({ page }) => {
  await setup(page);
  await page.route('**/api/hausdepp/favourite', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { detail: 'unavailable' } }) : route.continue());
  await page.reload();
  await page.locator('#hausdeppCreate').click();
  await expect(page.locator('#hausdeppFavouriteError')).toContainText('nicht geladen');
  await page.locator('[data-create-close]').click();
  await page.locator('#hausdeppCreate').click();
  await expect(page.locator('#hausdeppFavouriteError')).toContainText('nicht geladen');
  await page.locator('[data-create-define]').click();
  await expect(page.locator('#hausdeppOpenWaiting')).toBeEnabled();
});

test('creation failure stays in the dialog and enables retry and close', async ({ page }) => {
  await setup(page);
  await page.route('**/api/games', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { detail: 'temporary_error' } }) : route.continue());
  await page.locator('#hausdeppCreate').click();
  await page.locator('[data-create-define]').click();
  await page.locator('#hausdeppOpenWaiting').click();
  await expect(page.locator('#hausdeppCreateError')).not.toBeEmpty();
  await expect(page.locator('#hausdeppOpenWaiting')).toBeEnabled();
  await page.locator('[data-create-close]').click();
  await expect(page.locator('.hd-create-dialog')).not.toBeVisible();
});

test('a shared password link retries securely and a human replaces a full CPU seat', async ({ page, browser }) => {
  const owner = await setup(page);
  await page.locator('#hausdeppCreate').click();
  await page.locator('[data-create-define]').click();
  await page.locator('[name=waiting_mode][value=fixed]').check();
  await page.locator('[name=players]').selectOption('2');
  await page.locator('[name=password_required]').check();
  await page.locator('[name=passphrase]').fill('shared-table-password');
  await page.locator('#hausdeppOpenWaiting').click();
  await expect(page.locator('#hausdeppAddCpu')).toBeEnabled();
  await page.locator('#hausdeppAddCpu').click();
  await expect(page.locator('[data-waiting-action=remove]')).toHaveCount(1);
  const username = `FlexGuest_${Date.now()}`;
  expect((await page.request.post('/api/admin/users', { headers: { 'X-CSRF-Token': owner.csrf_token }, data: { username, temporary_password: 'temporary-flex-password', role: 'user' } })).status()).toBe(201);
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 320, height: 568 }, serviceWorkers: 'block' });
  try {
    const guest = await context.newPage();
    const login = await guest.request.post('/api/auth/login', { data: { username, password: 'temporary-flex-password' } });
    const identity = (await login.json()).user;
    expect((await guest.request.post('/api/auth/change-password', { headers: { 'X-CSRF-Token': identity.csrf_token }, data: { current_password: 'temporary-flex-password', new_password: 'final-flex-password' } })).ok()).toBeTruthy();
    await guest.request.post('/api/auth/login', { data: { username, password: 'final-flex-password' } });
    await guest.goto(page.url());
    await expect(guest.locator('#hausdeppAccessTitle')).toBeVisible();
    await guest.locator('.hd-create-dialog input').fill('wrong-table-password');
    await guest.locator('.hd-create-dialog button[type=submit]').click();
    await expect(guest.locator('.hd-create-dialog [role=alert]')).toBeVisible();
    await guest.locator('.hd-create-dialog input').fill('shared-table-password');
    await guest.locator('.hd-create-dialog button[type=submit]').click();
    await expect(guest.locator('#hausdeppWaiting')).toBeVisible();
    await expect(page.locator('#hausdeppWaitingSeats')).toContainText(username);
    await expect(page.locator('[data-waiting-action=remove]')).toHaveCount(0);
    await expect(guest.locator('#hausdeppHostControls')).toBeHidden();
    await expect(page.locator('#hausdeppStartGame')).toBeEnabled();
    expect(guest.url()).not.toContain('password');
  } finally { await context.close(); }
});
