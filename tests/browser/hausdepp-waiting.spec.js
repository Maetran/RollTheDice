const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', viewport: { width: 320, height: 568 } });
test.beforeAll(({ baseURL }) => expect(new URL(baseURL).port).not.toBe('8000'));

async function hostTable(page, language) {
  const signedIn = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  page.waitingRestore = { headers: { 'X-CSRF-Token': user.csrf_token }, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers: page.waitingRestore.headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  const created = await page.request.post('/api/games', {
    headers: { 'X-CSRF-Token': user.csrf_token },
    data: { name: 'Browser-Test · Wartetisch verlassen', mode: '4', game_type: 'hausdepp', play_mode: 'multiplayer', cpu_count: 0 },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).game_id;
  const room = `/hausdepp/spiel/${id}`;
  await page.goto(room);
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  await expect(page.locator('#hausdeppLeaveWaiting')).toBeEnabled();
  return { user, room, id };
}

async function waitingGuest(browser, page, owner, room, language) {
  const username = `WaitingGuest_${Date.now()}`;
  const temporary = 'temporary-waiting-password-123';
  const password = 'final-waiting-password-123';
  expect((await page.request.post('/api/admin/users', {
    headers: { 'X-CSRF-Token': owner.csrf_token }, data: { username, temporary_password: temporary, role: 'user' },
  })).status()).toBe(201);
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 320, height: 568 }, serviceWorkers: 'block' });
  const guest = await context.newPage();
  await guest.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await guest.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  const login = await guest.request.post('/api/auth/login', { data: { username, password: temporary } });
  expect(login.ok()).toBeTruthy();
  const identity = (await login.json()).user;
  expect((await guest.request.post('/api/auth/change-password', {
    headers: { 'X-CSRF-Token': identity.csrf_token }, data: { current_password: temporary, new_password: password },
  })).ok()).toBeTruthy();
  const finalLogin = await guest.request.post('/api/auth/login', { data: { username, password } });
  expect(finalLogin.ok()).toBeTruthy();
  await guest.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': (await finalLogin.json()).user.csrf_token }, data: { preferred_language: language },
  });
  await guest.goto(room);
  await expect(guest.locator('#hausdeppLeaveWaiting')).toBeEnabled();
  return { guest, context, username };
}

test.afterEach(async ({ page }) => {
  if (page.waitingRestore) await page.request.put('/api/auth/preferences/language', {
    headers: page.waitingRestore.headers, data: { preferred_language: page.waitingRestore.language },
  });
});

for (const language of ['de', 'en']) {
  for (const hostLeavesFirst of [false, true]) {
    test(`${language}: ${hostLeavesFirst ? 'the host transfers' : 'a guest leaves'} a waiting table without cancelling another player`, async ({ page, browser }) => {
      const owner = await hostTable(page, language);
      const { guest, context, username } = await waitingGuest(browser, page, owner.user, owner.room, language);
      try {
        await expect(page.locator('#hausdeppWaitingSeats')).toContainText(username);
        const leaving = hostLeavesFirst ? page : guest;
        const staying = hostLeavesFirst ? guest : page;
        let dialogs = 0;
        leaving.on('dialog', dialog => { dialogs += 1; void dialog.dismiss(); });
        const button = leaving.locator('#hausdeppLeaveWaiting');
        await expect(button).toHaveText(language === 'de' ? 'Tisch verlassen' : 'Leave table');
        const rect = await button.boundingBox();
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.y + rect.height).toBeLessThanOrEqual(leaving.viewportSize().height + 1);
        await button.click();
        await expect(leaving).toHaveURL(/\/hausdepp$/);
        await expect(leaving.locator('#hausdeppCreateForm')).toBeVisible();
        expect(dialogs).toBe(0);
        await expect(staying).toHaveURL(owner.room);
        await expect(staying.locator('#hausdeppWaiting')).toBeVisible();
        await expect(staying.locator('#hausdeppLeaveWaiting')).toBeEnabled();
        await staying.locator('#hausdeppLeaveWaiting').click();
        await expect(staying).toHaveURL(/\/hausdepp$/);
        await expect(staying.locator('#hausdeppCreateForm')).toBeVisible();
      } finally { await context.close(); }
    });
  }

  test(`${language}: a labelled start-race rejection keeps the player at the table and never sends an end-game action`, async ({ page }) => {
    const { room } = await hostTable(page, language);
    let actual;
    page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      try { const message = JSON.parse(String(payload)); if (message.scoreboard) actual = message.scoreboard; } catch {}
    }));
    await page.reload();
    await expect.poll(() => Boolean(actual?._waiting_permissions?.can_leave)).toBe(true);
    const commands = [];
    await page.routeWebSocket(new RegExp(`/ws/${room.split('/').pop()}$`), socket => socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action === 'join_game') socket.send(JSON.stringify({ scoreboard: actual, player_id: actual._players.find(player => player.name === 'Admin').id }));
      else {
        commands.push(message.action);
        socket.send(JSON.stringify({ error: 'hausdepp_waiting_already_started' }));
      }
    }));
    await page.goto(room);
    await page.locator('#hausdeppLeaveWaiting').click();
    await expect(page.locator('#hausdeppLeaveWaitingError')).toHaveText(language === 'de'
      ? 'Die Runde hat gerade begonnen. Du bleibst am Tisch.' : 'The round has just started. You are staying at the table.');
    await expect(page).toHaveURL(room);
    expect(commands).toEqual(['leave_waiting_game']);
  });
}
