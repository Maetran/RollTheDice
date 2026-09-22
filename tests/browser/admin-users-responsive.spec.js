const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [320, 390, 768, 1024, 1440];
const LONG_NAME = 'PlayerWithALongAccountName123456';
const LONG_REASON = `Repeated <misuse> ${'LongUnbrokenReason'.repeat(24)}`;

async function openCard(card) {
  if (await card.getAttribute('open') === null) await card.locator(':scope > summary').click();
}

async function fixture(page, { language = 'de', theme = 'light', width = 390 } = {}) {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(({ language, theme }) => {
    localStorage.setItem('zdwa_language', language);
    localStorage.setItem('wuerfler_theme', theme);
  }, { language, theme });
  const users = Array.from({ length: 65 }, (_, index) => ({
    id: index + 1, username: `Player${String(index + 1).padStart(3, '0')}`, role: 'user', is_active: true,
    is_owner: false, is_founder: false, lobby_chat_muted: false, lobby_chat_excluded: false,
    must_change_password: false, bans: [],
  }));
  Object.assign(users[0], { username: 'ProtectedFounder', role: 'admin', is_owner: true, is_founder: true });
  Object.assign(users[1], { username: 'DelegatedOwner', role: 'admin', is_owner: true });
  Object.assign(users[2], { username: 'SupportAdmin', role: 'admin' });
  Object.assign(users[3], { username: LONG_NAME, bans: [{ id: 1, scope: 'help', reason: LONG_REASON, created_at: '2026-09-22T00:00:00Z', expires_at: '2099-09-22T00:00:00Z' }] });
  const viewer = { is_owner: true, is_founder: true, can_create_admin: true };
  const project = user => ({ ...user,
    can_change_role: !user.is_owner,
    can_reset_password: !user.is_founder,
    can_toggle_active: !user.is_owner,
    can_moderate_chat: !user.is_owner,
    can_set_ban: !user.is_owner && user.role !== 'admin', can_revoke_ban: !user.is_owner,
    can_grant_owner: !user.is_owner && user.role === 'admin' && user.is_active && !user.lobby_chat_muted && !user.lobby_chat_excluded && !user.bans.length,
    can_revoke_owner: user.is_owner && !user.is_founder,
    ...(user.id === 6 ? { can_toggle_active: false, can_reset_password: false } : {}),
  });
  const state = { failNextList: false, rejectNextMutation: false, delays: new Map(), lists: [], changes: [] };
  const shell = await readFile(path.join(__dirname, '../../app/static/admin.html'), 'utf8');
  await page.route('**/api/**', route => route.fulfill({ json: { participants: [], games: [] } }));
  await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body: shell }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    authenticated: true, user: { ...users[0], is_admin: true, csrf_token: 'responsive-csrf', preferences: { preferred_language: language } },
    game_access: { zilch_preview: false, zilch_public: false }, passkeys: { enabled: false },
  } }));
  await page.route('**/api/admin/users?*', async route => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('query') || '';
    const limit = Number(url.searchParams.get('limit') || 100);
    const offset = Number(url.searchParams.get('offset') || 0);
    // The historical assignment picker separately loads its established
    // 200-account list; record only the paged user-management requests.
    if (limit === 31) state.lists.push({ query, limit, offset });
    if (state.failNextList) { state.failNextList = false; return route.fulfill({ status: 503, json: { detail: 'unavailable' } }); }
    const matches = users.filter(user => user.username.toLowerCase().includes(query.trim().toLowerCase()));
    const result = { users: matches.slice(offset, offset + limit).map(project), viewer, limit, offset };
    if (state.delays.has(query)) await new Promise(resolve => setTimeout(resolve, state.delays.get(query)));
    return route.fulfill({ json: result }).catch(() => {});
  });
  await page.route(/\/api\/admin\/users(?:\/\d+(?:\/reset-password)?)?$/, async route => {
    const request = route.request();
    expect(request.headers()['x-csrf-token']).toBe('responsive-csrf');
    const pathname = new URL(request.url()).pathname;
    const payload = request.postDataJSON();
    state.changes.push({ method: request.method(), path: pathname, body: payload });
    if (state.mutationWait) await state.mutationWait;
    if (state.rejectNextMutation) { state.rejectNextMutation = false; return route.fulfill({ status: 403, json: { detail: 'staff_protected' } }); }
    const id = Number(pathname.match(/\/users\/(\d+)/)?.[1]);
    const user = users.find(item => item.id === id);
    if (pathname.endsWith('/reset-password')) user.must_change_password = true;
    else if (user) Object.assign(user, payload);
    else users.push({ ...users[4], id: 66, username: payload.username, role: payload.role,
      is_active: true, lobby_chat_muted: false, lobby_chat_excluded: false, must_change_password: true });
    return route.fulfill({ json: { ok: true, user: user ? project(user) : project(users.at(-1)) } });
  });
  await page.goto('/admin');
  await page.locator('[data-admin-panel="usersPanel"]').click();
  await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(30);
  return { state, card: id => page.locator(`[data-user-id="${id}"]`) };
}

async function expectResponsiveControls(page) {
  const geometry = await page.locator('#usersPanel').evaluate(panel => ({
    documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
    controls: [...panel.querySelectorAll('a,button,input:not([type="hidden"]),select,textarea,summary')]
      .filter(element => element.checkVisibility())
      .map(element => { const rect = element.getBoundingClientRect(); return { tag: element.tagName, id: element.id, text: element.textContent.slice(0, 50), left: rect.left, right: rect.right, width: rect.width, height: rect.height }; }),
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  for (const control of geometry.controls) {
    expect(control.left, JSON.stringify(control)).toBeGreaterThanOrEqual(-1);
    expect(control.right, JSON.stringify(control)).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(control.height, JSON.stringify(control)).toBeGreaterThanOrEqual(44);
    expect(control.width, JSON.stringify(control)).toBeGreaterThanOrEqual(44);
  }
}

for (const language of ['de', 'en']) {
  for (const theme of ['light', 'dark', 'classic']) {
    test(`${language} ${theme}: user cards remain readable and touch sized at every responsive width`, async ({ page }, testInfo) => {
      const { card } = await fixture(page, { language, theme });
      for (const width of VIEWPORTS) {
        await page.setViewportSize({ width, height: 1000 });
        await openCard(card(1));
        await expect(card(1).locator('[data-staff-label]')).toHaveText(language === 'en' ? 'Founder' : 'Gründer');
        await expect(card(1).locator('.reset-password')).toBeDisabled();
        await expectResponsiveControls(page);
        await openCard(card(4));
        await expect(card(1)).not.toHaveAttribute('open');
        await expect(page.locator('.admin-user-card[open]')).toHaveCount(1);
        await expect(card(4).locator('.admin-user-profile')).toHaveText(language === 'en' ? 'Open profile ↗' : 'Profil öffnen ↗');
        await expect(card(4).locator('.admin-ban-list')).toContainText(LONG_REASON);
        await expect(card(4).locator('.admin-ban-list misuse')).toHaveCount(0);
        await card(4).locator('[data-ban-editor]').evaluate(details => { details.open = true; });
        await card(4).locator('[data-password-editor]').evaluate(details => { details.open = true; });
        await expectResponsiveControls(page);
        await page.locator('#createUserDetails').evaluate(details => { details.open = true; });
        await expectResponsiveControls(page);
        await page.locator('#createUserDetails').evaluate(details => { details.open = false; });
        if (width === 390 || width === 1440) {
          await card(4).locator(':scope > summary').evaluate(summary => summary.scrollIntoView({ block: 'start', behavior: 'instant' }));
          await page.screenshot({ path: testInfo.outputPath(`users-${language}-${theme}-${width}.png`) });
        }
      }
    });
  }

  test(`${language}: server search, clearing, pagination, empty results, retry and stale replies work together`, async ({ page }) => {
    const { state, card } = await fixture(page, { language });
    expect(state.lists.at(-1)).toEqual({ query: '', limit: 31, offset: 0 });
    await expect(page.locator('#userResultCount')).toContainText('1–30');
    await expect(page.locator('#previousUsers')).toBeDisabled();
    await page.locator('#nextUsers').click();
    await expect(card(31)).toBeVisible();
    await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(30);
    expect(state.lists.at(-1).offset).toBe(30);
    await page.locator('#nextUsers').click();
    await expect(card(61)).toBeVisible();
    await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(5);
    await expect(page.locator('#userResultCount')).toContainText('61–65');
    await expect(page.locator('#nextUsers')).toBeDisabled();
    await page.locator('#previousUsers').click();
    await expect(card(31)).toBeVisible();
    await page.locator('#userQuery').fill('Player050');
    await expect(card(50)).toBeVisible();
    await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(1);
    expect(state.lists.at(-1)).toEqual({ query: 'Player050', limit: 31, offset: 0 });
    await page.locator('#clearUserSearch').click();
    await expect(page.locator('#userQuery')).toHaveValue('');
    await expect(page.locator('#userQuery')).toBeFocused();
    await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(30);
    await page.locator('#userQuery').fill('NoSuchAccount');
    await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(0);
    await expect(page.locator('#userListStatus')).toBeVisible();
    await expect(page.locator('#userListStatus')).toContainText(language === 'en' ? /No matching users/i : /Keine .*gefunden/i);
    await expect(page.locator('[data-retry-users]')).toBeHidden();
    await page.locator('#clearUserSearch').click();
    await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(30);
    state.failNextList = true;
    await page.locator('#reloadUsers').click();
    await expect(page.locator('[data-retry-users]')).toBeVisible();
    await expect(page.locator('#userListStatus')).toContainText(language === 'en' ? /load/i : /laden/i);
    await page.locator('[data-retry-users]').click();
    await expect(page.locator('#userListStatus')).toBeHidden();
    await expect(page.locator('#usersBody [data-user-id]')).toHaveCount(30);
    state.delays.set('Player020', 700);
    const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('query') === 'Player020');
    await Promise.all([
      page.waitForRequest(request => new URL(request.url()).searchParams.get('query') === 'Player020'),
      page.locator('#userQuery').fill('Player020'),
    ]);
    await page.locator('#userQuery').fill('Player050');
    await expect(card(50)).toBeVisible();
    await oldResponse;
    await expect(card(50)).toBeVisible();
    await expect(card(20)).toHaveCount(0);
  });

  test(`${language}: account actions keep feedback and focus, reset passwords inline, and honor explicit server restrictions`, async ({ page }) => {
    const { state, card } = await fixture(page, { language, width: 390 });
    await openCard(card(6));
    await expect(card(6).locator('.toggle-active')).toBeDisabled();
    await expect(card(6).locator('.reset-password')).toBeDisabled();
    await openCard(card(5));
    await card(5).locator('.toggle-active').click();
    await expect.poll(() => state.changes.length).toBe(1);
    expect(state.changes[0]).toMatchObject({ method: 'PATCH', path: '/api/admin/users/5', body: { is_active: false } });
    await expect(card(5)).toHaveAttribute('open');
    await expect(card(5).locator('.toggle-active')).toBeFocused();
    await expect(card(5).locator('[data-user-feedback]')).not.toHaveText('');
    await card(5).locator('.toggle-chat-muted').click();
    await expect.poll(() => state.changes.length).toBe(2);
    expect(state.changes[1].body).toEqual({ lobby_chat_muted: true });
    await expect(card(5).locator('.toggle-chat-muted')).toBeFocused();
    await card(5).locator('[data-password-editor] > summary').click();
    const password = card(5).locator('[data-password-form]');
    await password.locator('button[type="submit"]').click();
    await expect(password.locator('input[name="temporary_password"]')).toBeFocused();
    expect(state.changes).toHaveLength(2);
    await password.locator('input[name="temporary_password"]').fill('responsive-password-123');
    await password.locator('button[type="submit"]').click();
    await expect.poll(() => state.changes.length).toBe(3);
    expect(state.changes[2]).toMatchObject({ method: 'POST', path: '/api/admin/users/5/reset-password', body: { temporary_password: 'responsive-password-123' } });
    await expect(password.locator('input[name="temporary_password"]')).toHaveValue('');
    await expect(card(5)).toHaveAttribute('open');
    await expect(card(5).locator('[data-password-editor]')).toHaveAttribute('open', '');
    await expect(card(5).locator('.reset-password')).toBeFocused();
    await expect(card(5).locator('[data-user-feedback]')).toContainText(language === 'en' ? /password/i : /Passwort/i);
    state.rejectNextMutation = true;
    await card(5).locator('.toggle-chat-excluded').click();
    await expect.poll(() => state.changes.length).toBe(4);
    await expect(card(5).locator('[data-user-feedback]')).toContainText(language === 'en' ? /owners/i : /Owner/);
    await expect(card(5).locator('.toggle-chat-excluded')).toBeEnabled();
    await expect(card(5).locator('.toggle-chat-excluded')).toContainText(language === 'en' ? /Exclude/i : /ausschließen/);
    await page.locator('#createUserDetails > summary').click();
    await page.locator('#newUsername').fill('ResponsiveNewPlayer');
    await page.locator('#newPassword').fill('responsive-new-password-123');
    let releaseCreation;
    state.mutationWait = new Promise(resolve => { releaseCreation = resolve; });
    try {
      await page.locator('#createUserForm button[type="submit"]').click();
      await expect.poll(() => state.changes.length).toBe(5);
      await expect(page.locator('#createUserForm')).toHaveJSProperty('inert', true);
      await expect(page.locator('#usersBody')).toHaveJSProperty('inert', true);
      await expect(page.locator('#userQuery')).toBeDisabled();
      for (const tile of await page.locator('[data-admin-panel]').all()) await expect(tile).toBeDisabled();
    } finally { releaseCreation(); }
    expect(state.changes[4]).toMatchObject({ method: 'POST', path: '/api/admin/users', body: { username: 'ResponsiveNewPlayer', role: 'user' } });
    await expect(card(66)).toHaveAttribute('open');
    await expect(card(66).locator(':scope > summary')).toBeFocused();
    await expect(page.locator('#createUserFeedback')).not.toHaveText('');
    await expect(page.locator('#adminMessage')).toHaveAttribute('aria-live', 'off');
    await page.locator('[data-admin-panel="assignmentsPanel"]').click();
    await expect(page.locator('#adminMessage')).toHaveAttribute('aria-live', 'polite');
  });
}
