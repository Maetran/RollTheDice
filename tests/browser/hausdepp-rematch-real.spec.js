const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });
test.beforeAll(({ baseURL }) => expect(['8000', '8001']).not.toContain(new URL(baseURL).port));

async function prepare(page, language) {
  await page.addInitScript(value => {
    localStorage.setItem('zdwa_language', value);
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        const game = location.pathname.match(/\/hausdepp\/spiel\/([^/]+)/)?.[1];
        if (game && new URL(url, location.href).pathname === `/ws/${game}`) {
          window.__realRematchSocket = this;
          this.addEventListener('message', event => {
            try {
              const data = JSON.parse(event.data);
              if (data.scoreboard) window.__realRematchBoard = data.scoreboard;
            } catch { /* Ignore unrelated transport messages. */ }
          });
        }
      }
    };
  }, language);
  // Only unrelated optional notices are suppressed. Every room, invitation,
  // acceptance and WebSocket transition in this test uses the real backend.
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 0 } }));
}

test('real retired source recreates a CPU tournament and only explicit invitation acceptance takes the second human seat', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  let hostUser, originalLanguage;
  try {
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    const loggedIn = await host.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
    expect(loggedIn.ok()).toBeTruthy();
    hostUser = (await loggedIn.json()).user;
    originalLanguage = hostUser.preferences.preferred_language || 'de';
    const headers = { 'X-CSRF-Token': hostUser.csrf_token };
    await host.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: 'de' } });
    const registration = await guest.request.post('/api/auth/register', {
      data: { username: 'rematch_real_optin', password: 'rematch-real-password-123', preferred_language: 'en' },
    });
    if (registration.status() !== 201) {
      const retried = await guest.request.post('/api/auth/login', {
        data: { username: 'rematch_real_optin', password: 'rematch-real-password-123' },
      });
      expect(retried.ok()).toBeTruthy();
    }
    const guestUser = (await (await guest.request.get('/api/auth/me')).json()).user;
    expect(guestUser.id).not.toBe(hostUser.id);
    await prepare(host, 'de'); await prepare(guest, 'en');
    const created = await host.request.post('/api/games', { headers, data: {
      name: 'Real rematch · opt-in', game_type: 'hausdepp', mode: '3', play_mode: 'cpu', cpu_count: 1, tournament: true,
    } });
    expect(created.ok()).toBeTruthy();
    const source = (await created.json()).game_id;
    const before = (await (await host.request.get('/api/hausdepp/account')).json()).scoring.points;
    expect(Number.isInteger(before)).toBe(true);
    await host.goto(`/hausdepp/spiel/${source}`);
    await expect(host.locator('#hausdeppWaiting')).toBeVisible();
    await guest.goto(`/hausdepp/spiel/${source}`);
    await expect.poll(() => host.evaluate(() => window.__realRematchBoard?._started)).toBe(true);
    await expect.poll(() => guest.evaluate(() => window.__realRematchBoard?._started)).toBe(true);
    const guestConnections = [];
    guest.on('websocket', socket => guestConnections.push(socket.url()));
    const responses = [];
    guest.on('request', request => {
      if (/\/api\/hausdepp\/invitations\/[^/]+\/(accept|decline)$/.test(request.url())) responses.push(request.url());
    });

    // Actual authenticated game control, actual terminal scoreboard, actual
    // socket retirement and registry removal; no fabricated finished board.
    await host.evaluate(() => window.__realRematchSocket.send(JSON.stringify({ action: 'end_game' })));
    await expect(host.locator('#hausdeppRecreate')).toBeVisible();
    await expect(guest.locator('#hausdeppRecreate')).toBeVisible();
    await expect.poll(async () => (await (await host.request.get(`/api/games/${source}`)).json()).exists).toBe(false);
    const response = host.waitForResponse(value => value.url().endsWith(`/api/hausdepp/games/${source}/rematch`)
      && value.request().method() === 'POST');
    await host.locator('#hausdeppRecreate').click();
    const rematchResponse = await response;
    expect(rematchResponse.ok()).toBeTruthy();
    const target = (await rematchResponse.json()).game_id;
    expect(target).not.toBe(source);
    await expect(host).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
    await expect(host.locator('#hausdeppWaiting')).toBeVisible();
    const waiting = await (await host.request.get(`/api/games/${target}`)).json();
    expect(waiting.started).toBe(false);
    expect(waiting.mode).toBe('3');
    expect(waiting.expected_connections).toBe(2);
    expect(waiting.participants.filter(person => person.is_cpu)).toHaveLength(1);
    expect(waiting.player_statuses.map(person => person.user_id)).toEqual([hostUser.id]);

    await expect(guest.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rematch');
    await expect(guest.locator('#appDialog')).toContainText('Table tournament');
    expect(responses).toEqual([]);
    expect(guestConnections.some(url => url.endsWith(`/ws/${target}`))).toBe(false);
    const ownInvitations = (await (await guest.request.get('/api/hausdepp/invitations')).json()).invitations;
    expect(ownInvitations).toHaveLength(1);
    expect(ownInvitations[0].game_id).toBe(target);
    expect(ownInvitations[0].status).toBe('pending');
    await guest.locator('[data-dialog-action=accept]').click();
    await expect(guest).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
    await expect.poll(() => guest.evaluate(() => window.__realRematchBoard?._started)).toBe(true);
    await expect.poll(() => host.evaluate(() => window.__realRematchBoard?._started)).toBe(true);
    const actual = await guest.evaluate(() => window.__realRematchBoard);
    expect(actual._participants.filter(person => !person.is_cpu).map(person => person.user_id).sort((a, b) => a - b))
      .toEqual([hostUser.id, guestUser.id].sort((a, b) => a - b));
    expect(actual._hausdepp_tournament.round_number).toBe(1);
    expect(actual._hausdepp_tournament.completed).toBe(false);
    expect(responses).toHaveLength(1);
    expect((await (await guest.request.get('/api/hausdepp/invitations')).json()).invitations).toEqual([]);
    expect((await (await host.request.get('/api/hausdepp/account')).json()).scoring.points).toBe(before);
  } finally {
    if (hostUser) await hostContext.request.put('/api/auth/preferences/language', {
      headers: { 'X-CSRF-Token': hostUser.csrf_token }, data: { preferred_language: originalLanguage },
    });
    await hostContext.close(); await guestContext.close();
  }
});
