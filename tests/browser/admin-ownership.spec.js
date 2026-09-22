const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function openUserCard(card) {
  if (await card.getAttribute('open') === null) await card.locator(':scope > summary').click();
}

test('real founder grants and revokes ownership while protected accounts remain uneditable', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  let founder;
  let founderCsrf;
  let originalLanguage;
  try {
    founder = await contexts[0].newPage();
    const delegate = await contexts[1].newPage();
    const seed = await founder.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
    expect(seed.ok()).toBeTruthy();
    const root = (await seed.json()).user;
    founderCsrf = root.csrf_token;
    originalLanguage = root.preferences?.preferred_language || 'de';
    expect(root).toMatchObject({ id: 1, is_owner: true, is_founder: true });
    expect((await founder.request.put('/api/auth/preferences/language', {
      headers: { 'X-CSRF-Token': root.csrf_token }, data: { preferred_language: 'en' },
    })).ok()).toBeTruthy();
    const username = 'OwnershipBrowserAdmin';
    const temporary = 'ownership-browser-password-123';
    const created = await founder.request.post('/api/admin/users', {
      headers: { 'X-CSRF-Token': root.csrf_token }, data: { username, temporary_password: temporary, role: 'admin' },
    });
    expect(created.status()).toBe(201);
    const firstLogin = await delegate.request.post('/api/auth/login', { data: { username, password: temporary } });
    const first = (await firstLogin.json()).user;
    expect((await delegate.request.put('/api/auth/preferences/language', {
      headers: { 'X-CSRF-Token': first.csrf_token }, data: { preferred_language: 'en' },
    })).ok()).toBeTruthy();
    expect((await delegate.request.post('/api/auth/change-password', {
      headers: { 'X-CSRF-Token': first.csrf_token }, data: { current_password: temporary, new_password: `${temporary}-final` },
    })).ok()).toBeTruthy();
    expect((await delegate.request.post('/api/auth/login', { data: { username, password: `${temporary}-final` } })).ok()).toBeTruthy();
    for (const page of [founder, delegate]) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.addInitScript(() => localStorage.setItem('zdwa_language', 'en'));
      await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
    }
    await founder.goto('/admin');
    await founder.locator('[data-admin-panel="usersPanel"]').click();
    const founderTarget = founder.locator(`[data-user-id="${first.id}"]`);
    await openUserCard(founderTarget);
    await founderTarget.locator('[data-ownership="grant"]').click();
    await founder.getByRole('dialog').getByRole('button', { name: 'Appoint owner', exact: true }).click();
    await expect(founderTarget.locator('[data-staff-label]')).toHaveText('Owner');
    expect((await (await delegate.request.get('/api/auth/me')).json()).user).toMatchObject({ is_owner: true, is_founder: false });
    await delegate.goto('/admin');
    await delegate.locator('[data-admin-panel="usersPanel"]').click();
    const self = delegate.locator(`[data-user-id="${first.id}"]`);
    const protectedFounder = delegate.locator('[data-user-id="1"]');
    await expect(self.locator('[data-staff-label]')).toHaveText('Owner');
    for (const selector of ['.role-select', '.reset-password', '.toggle-active', '.toggle-chat-muted', '.toggle-chat-excluded']) {
      await expect(self.locator(selector)).toBeDisabled();
      await expect(protectedFounder.locator(selector)).toBeDisabled();
    }
    await expect(delegate.locator('#newRole')).toBeEnabled();
    await expect(delegate.locator('[data-ownership]')).toHaveCount(0);
    await openUserCard(founderTarget);
    await founderTarget.locator('[data-ownership="revoke"]').click();
    await founder.getByRole('dialog').getByRole('button', { name: 'Revoke ownership', exact: true }).click();
    await expect(founderTarget.locator('[data-staff-label]')).toHaveText('Admin');
    expect((await (await delegate.request.get('/api/auth/me')).json()).user).toMatchObject({ is_owner: false, is_founder: false, is_admin: true });
    await delegate.reload();
    await delegate.locator('[data-admin-panel="usersPanel"]').click();
    await expect(self.locator('[data-staff-label]')).toHaveText('Admin');
    await expect(self.locator('.role-select')).toBeDisabled();
    await expect(delegate.locator('#newRole')).toBeDisabled();
    await expect(protectedFounder.locator('.reset-password')).toBeDisabled();
    await founder.screenshot({ path: '/tmp/rtd-ownership-real-founder.png' });
    await delegate.screenshot({ path: '/tmp/rtd-ownership-real-revoked.png' });
  } finally {
    if (founderCsrf) {
      // The bootstrap founder is reused by later device and account tests.
      // Restore its preference even when this test fails partway through.
      await founder.request.put('/api/auth/preferences/language', {
        headers: { 'X-CSRF-Token': founderCsrf }, data: { preferred_language: originalLanguage },
      });
    }
    await Promise.all(contexts.map(context => context.close()));
  }
});

async function ownershipFixture(page, language, actor) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
  const users = [
    { id: 1, username: 'ProtectedFounder', role: 'admin', is_owner: true, is_founder: true },
    { id: 2, username: 'DelegatedOwner', role: 'admin', is_owner: true, is_founder: false },
    { id: 3, username: 'SupportAdmin', role: 'admin', is_owner: false, is_founder: false },
    { id: 4, username: 'RegularPlayer', role: 'user', is_owner: false, is_founder: false },
  ].map(user => ({ ...user, is_active: true, bans: [] }));
  const viewer = { is_owner: actor !== 'admin', is_founder: actor === 'founder', can_create_admin: actor !== 'admin' };
  const signedIn = users.find(user => user.id === { founder: 1, owner: 2, admin: 3 }[actor]);
  const project = user => ({ ...user,
    can_change_role: viewer.is_owner && !user.is_owner,
    can_reset_password: !user.is_founder && (user.is_owner ? viewer.is_founder : user.role !== 'admin' || viewer.is_owner),
    can_toggle_active: !user.is_owner && (user.role !== 'admin' || viewer.is_owner),
    can_moderate_chat: !user.is_owner && (user.role !== 'admin' || viewer.is_owner),
    can_set_ban: user.role === 'user', can_revoke_ban: !user.is_owner && (user.role !== 'admin' || viewer.is_owner),
    can_grant_owner: viewer.is_founder && user.role === 'admin' && !user.is_owner,
    can_revoke_owner: viewer.is_founder && user.is_owner && !user.is_founder,
  });
  await page.route('**/admin', async route => route.fulfill({ contentType: 'text/html', body: await readFile('app/static/admin.html', 'utf8') }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { authenticated: true,
    user: { ...signedIn, is_admin: true, csrf_token: 'ownership-csrf', preferences: {} },
    game_access: { zilch_preview: false, zilch_public: false }, passkeys: { enabled: false },
  } }));
  await page.route('**/api/admin-help/status**', route => route.fulfill({ json: { authenticated: true, is_admin: true, requests: [] } }));
  await page.route('**/api/admin/users?*', route => route.fulfill({ json: { users: users.map(project), viewer } }));
  const changes = [];
  await page.route(/\/api\/admin\/users(?:\/\d+(?:\/ownership)?)?$/, async route => {
    const request = route.request();
    expect(request.headers()['x-csrf-token']).toBe('ownership-csrf');
    const url = new URL(request.url());
    const id = Number(url.pathname.match(/\/users\/(\d+)/)?.[1]);
    const user = users.find(user => user.id === id);
    const body = request.postDataJSON();
    changes.push({ path: url.pathname, method: request.method(), body });
    if (url.pathname.endsWith('/ownership')) user.is_owner = request.method() === 'PUT';
    else if (user) Object.assign(user, body);
    await route.fulfill({ json: { user: user && project(user) } });
  });
  await page.goto('/admin');
  await page.locator('[data-admin-panel="usersPanel"]').click();
  return { changes, row: id => page.locator(`[data-user-id="${id}"]`) };
}

for (const language of ['de', 'en']) {
  for (const actor of ['founder', 'owner', 'admin']) {
    test(`${language}: ${actor} sees action-specific ownership safeguards`, async ({ page }) => {
      const { changes, row } = await ownershipFixture(page, language, actor);
      await expect(row(1).locator('[data-staff-label]')).toHaveText(language === 'en' ? 'Founder' : 'Gründer');
      await expect(row(2).locator('[data-staff-label]')).toHaveText('Owner');
      for (const selector of ['.role-select', '.reset-password', '.toggle-active', '.toggle-chat-muted', '.toggle-chat-excluded']) {
        await expect(row(1).locator(selector)).toBeDisabled();
      }
      await expect(row(1).locator('[data-ownership]')).toHaveCount(0);
      await expect(row(1).locator('.reset-password')).toHaveAttribute('title', new RegExp(language === 'en' ? 'personal account recovery' : 'persönliche Wiederherstellung'));
      for (const selector of ['.role-select', '.toggle-active', '.toggle-chat-muted', '.toggle-chat-excluded']) await expect(row(2).locator(selector)).toBeDisabled();

      if (actor === 'founder') {
        await expect(row(2).locator('.reset-password')).toBeEnabled();
        await expect(page.locator('#adminRoleHint')).toContainText(language === 'en' ? 'permanently protected' : 'dauerhaft geschützt');
        await openUserCard(row(3));
        await row(3).locator('[data-ownership="grant"]').click();
        await expect(page.getByRole('dialog')).toContainText(language === 'en' ? 'Only you as the founder' : 'Nur du als Gründer');
        await page.getByRole('dialog').getByRole('button', { name: language === 'en' ? 'Appoint owner' : 'Owner ernennen', exact: true }).click();
        await expect(row(3).locator('[data-staff-label]')).toHaveText('Owner');
        await expect(row(3).locator('.toggle-active')).toBeDisabled();
        await expect(row(3).locator('.reset-password')).toBeEnabled();
        expect(changes[0]).toMatchObject({ path: '/api/admin/users/3/ownership', method: 'PUT' });
        await expect(page.locator('#adminMessage')).toHaveText(language === 'en' ? 'Ownership granted.' : 'Owner-Rechte wurden vergeben.');
        await openUserCard(row(3));
        await row(3).locator('[data-ownership="revoke"]').click();
        await page.getByRole('dialog').getByRole('button', { name: language === 'en' ? 'Revoke ownership' : 'Owner-Rechte entziehen', exact: true }).click();
        await expect(row(3).locator('[data-staff-label]')).toHaveText('Admin');
        await expect(row(3).locator('.role-select')).toBeEnabled();
        expect(changes[1]).toMatchObject({ path: '/api/admin/users/3/ownership', method: 'DELETE' });
      } else {
        await expect(row(2).locator('.reset-password')).toBeDisabled();
        await expect(page.locator('[data-ownership]')).toHaveCount(0);
        if (actor === 'owner') {
          for (const selector of ['.role-select', '.reset-password', '.toggle-active', '.toggle-chat-muted', '.toggle-chat-excluded']) await expect(row(3).locator(selector)).toBeEnabled();
          await openUserCard(row(3));
          await row(3).locator('.role-select').selectOption('user');
          await expect(row(3).locator('[data-staff-label]')).toHaveText(language === 'en' ? 'User' : 'Benutzer');
          expect(changes[0]).toMatchObject({ method: 'PATCH', path: '/api/admin/users/3', body: { role: 'user' } });
        } else {
          for (const selector of ['.role-select', '.reset-password', '.toggle-active', '.toggle-chat-muted', '.toggle-chat-excluded']) await expect(row(3).locator(selector)).toBeDisabled();
          await expect(row(4).locator('.role-select')).toBeDisabled();
          await expect(row(4).locator('.reset-password')).toBeEnabled();
          await expect(row(4).locator('.toggle-active')).toBeEnabled();
          await expect(page.locator('#newRole')).toBeDisabled();
          await page.locator('#createUserDetails > summary').click();
          await page.locator('#newUsername').fill('AnotherPlayer');
          await page.locator('#newPassword').fill('temporary-password-123');
          await page.locator('#createUserForm button').click();
          await expect.poll(() => changes.length).toBe(1);
          expect(changes[0]).toMatchObject({ method: 'POST', path: '/api/admin/users', body: { role: 'user' } });
        }
      }
      await expect(row(1).locator('.reset-password')).toBeDisabled();
      await page.screenshot({ path: `/tmp/rtd-ownership-${actor}-${language}.png` });
    });
  }
}
