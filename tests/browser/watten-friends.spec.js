const { test, expect } = require('@playwright/test');
const { player, create, action, normalCall, playOne } = require('./helpers/watten-journey.cjs');

const settingsRoot = item => item.page.locator('[data-watten-friend-settings]');
const friendAction = (item, name) => settingsRoot(item).locator(`[data-friend-action="${name}"]`);
const notices = item => item.page.locator('[data-watten-friend-activity]');
const authHeaders = item => ({ 'X-CSRF-Token': item.user.csrf_token,
  'X-Watten-Expected-Account-Id': String(item.user.id) });

async function json(item, path) {
  const response = await item.context.request.get(path);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openSettings(item) {
  await item.page.goto('/watten/konto/einstellungen');
  await item.page.locator('details:has([data-watten-friend-settings]) > summary').click();
  await expect(friendAction(item, 'consent-toggle')).toBeEnabled();
  await expect(settingsRoot(item).locator('[data-friend-audience]')).toBeEnabled();
}

async function selectForNotices(viewer, selected) {
  // Real authenticated setup writes. UI mutations and canonical search are
  // exercised separately below; no start event or WebSocket frame is mocked.
  for (const [path, data] of [
    ['/api/friend-activity/preferences', { viewer_id: viewer.user.id, enabled: true }],
    [`/api/web-push/allowlist/${selected.user.id}`, { viewer_id: viewer.user.id }],
  ]) {
    const response = await viewer.context.request.put(path, { headers: authHeaders(viewer), data });
    expect(response.ok()).toBeTruthy();
  }
}

function observeFriends(item) {
  const seen = { ready: [], starts: [], sockets: [] };
  item.page.on('websocket', socket => {
    const url = new URL(socket.url());
    if (url.pathname !== '/ws/friend-activity') return;
    const entry = { url, closed: false, ready: null };
    seen.sockets.push(entry);
    socket.on('close', () => { entry.closed = true; });
    socket.on('framereceived', frame => {
      const message = JSON.parse(String(frame.payload));
      if (message.friend_activity_ready) {
        entry.ready = message.friend_activity_ready;
        seen.ready.push(message.friend_activity_ready);
      }
      if (message.friend_activity) seen.starts.push(message.friend_activity);
    });
  });
  return seen;
}

async function ready(item, seen) {
  await expect.poll(() => seen.sockets.some(entry => !entry.closed
    && entry.ready?.viewer_id === item.user.id && entry.ready.enabled)).toBe(true);
  expect(seen.sockets.every(entry => entry.url.searchParams.get('context') === 'watten'
    && entry.url.searchParams.get('expected_account_id') === String(item.user.id))).toBe(true);
}

for (const language of ['de', 'en']) {
  test(`${language}: private friend consent and canonical player selection persist without activating push`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const [viewer, selected] = players;
    const writes = [], pushWrites = [];
    viewer.page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET') return;
      if (path === '/api/web-push/subscription') pushWrites.push(path);
      if (path.startsWith('/api/web-push/allowlist') || path === '/api/friend-activity/preferences') {
        writes.push({ path, method: request.method(), body: request.postDataJSON(), headers: request.headers() });
      }
    });
    try {
      const pushBefore = await json(viewer, '/api/web-push/subscription');
      await openSettings(viewer);
      const root = settingsRoot(viewer);
      await expect(viewer.page.locator('html')).toHaveAttribute('lang', language);
      await expect(root.locator('h3').first()).toHaveText(language === 'de'
        ? 'Startmeldungen von ausgewählten Spielern' : 'Start notices from selected players');
      await expect(root).toContainText(language === 'de' ? 'Keine Push-Mitteilung' : 'No push notification');

      if ((await json(viewer, '/api/friend-activity/preferences')).enabled) await friendAction(viewer, 'consent-toggle').click();
      await expect.poll(async () => (await json(viewer, '/api/friend-activity/preferences')).enabled).toBe(false);
      await openSettings(viewer);
      await expect(friendAction(viewer, 'consent-toggle')).toHaveText(language === 'de' ? 'Startmeldungen einschalten' : 'Switch start notices on');
      await friendAction(viewer, 'consent-toggle').click();
      await expect.poll(async () => (await json(viewer, '/api/friend-activity/preferences')).enabled).toBe(true);

      await root.locator('[data-friend-query]').fill(selected.user.username);
      await root.locator('[data-friend-search-form]').getByRole('button', { name: language === 'de' ? 'Suchen' : 'Search', exact: true }).click();
      // Select the server-returned fixed account, rather than trusting a name.
      const canonicalAdd = root.locator(`[data-friend-action="add"][data-account-id="${selected.user.id}"]`);
      await expect(canonicalAdd).toBeEnabled();
      await canonicalAdd.click();
      await expect(root.locator('[data-friend-selected]')).toContainText(selected.user.username);
      await root.locator('[data-friend-audience]').selectOption('allowlist');
      await friendAction(viewer, 'audience-save').click();
      await expect.poll(async () => (await json(viewer, '/api/web-push/allowlist')).audience).toBe('allowlist');
      await openSettings(viewer);
      await expect(root.locator('[data-friend-audience]')).toHaveValue('allowlist');
      await expect(root.locator('[data-friend-selected]')).toContainText(selected.user.username);
      expect((await json(viewer, '/api/web-push/allowlist')).players).toEqual([
        { id: selected.user.id, username: selected.user.username, active: true },
      ]);

      await root.locator('[data-friend-query]').fill('Draft kept through rotation');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await viewer.page.setViewportSize(viewport);
        await root.locator('[data-friend-query]').focus();
        expect(await viewer.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        for (const control of [friendAction(viewer, 'consent-toggle'), root.locator('[data-friend-audience]'),
          root.locator('[data-friend-query]'), friendAction(viewer, 'remove')]) {
          const box = await control.boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        await expect(root.locator('[data-friend-query]')).toHaveValue('Draft kept through rotation');
        await root.screenshot({ path: testInfo.outputPath(`friends-${viewport.width}x${viewport.height}.png`) });
      }
      await friendAction(viewer, 'remove').click();
      await expect(root.locator('[data-friend-warning]')).toBeVisible();
      await openSettings(viewer);
      await expect(root.locator('[data-friend-warning]')).toBeVisible();
      expect((await json(viewer, '/api/web-push/allowlist')).players).toEqual([]);
      await friendAction(viewer, 'consent-toggle').click();
      await expect.poll(async () => (await json(viewer, '/api/friend-activity/preferences')).enabled).toBe(false);

      expect(writes.some(write => write.path === `/api/web-push/allowlist/${selected.user.id}`
        && write.method === 'PUT' && JSON.stringify(write.body) === JSON.stringify({ viewer_id: viewer.user.id }))).toBe(true);
      expect(writes.some(write => write.path === `/api/web-push/allowlist/${selected.user.id}` && write.method === 'DELETE')).toBe(true);
      expect(writes.every(write => write.body.viewer_id === viewer.user.id
        && write.headers['x-watten-expected-account-id'] === String(viewer.user.id)
        && write.headers['x-csrf-token'] === viewer.user.csrf_token)).toBe(true);
      const pushAfter = await json(viewer, '/api/web-push/subscription');
      for (const field of ['enabled', 'subscribed', 'game_invites_enabled', 'daily_reminder_enabled', 'release_notifications_enabled']) {
        expect(pushAfter[field]).toBe(pushBefore[field]);
      }
      expect(pushWrites).toEqual([]);
      const cleared = await viewer.page.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        return document.querySelector('#wattenAccount').childElementCount;
      });
      expect(cleared).toBe(0);
      expect(viewer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('a real four-seat friend start offers deliberate lobby watching and stays text-only beside an unanswered human bid', async ({ browser, baseURL }) => {
  test.setTimeout(60000);
  const players = [await player(browser, baseURL), await player(browser, baseURL, 'en'),
    await player(browser, baseURL), await player(browser, baseURL, 'en')];
  const [first, second, selected, lobby] = players;
  const seen = new Map(players.map(item => [item, observeFriends(item)]));
  try {
    for (const viewer of [first, second, lobby]) await selectForNotices(viewer, selected);
    const tablePath = await create([first, second], { target: 15 });
    await normalCall([first, second]);
    await playOne([first, second]);
    await action([first, second], 'bid');
    await expect.poll(() => [first, second].every(item => item.traffic.snapshot?.engine?.phase === 'bid_response')).toBe(true);
    const decider = [first, second].find(item => item.traffic.snapshot.engine.actions.includes('respond_hold'));
    await ready(decider, seen.get(decider));
    await lobby.page.goto('/watten');
    await ready(lobby, seen.get(lobby));
    await expect.poll(() => [first, second].every(item => item.traffic.snapshot.pending_call_events.length === 0)).toBe(true);
    const before = { opportunity: decider.traffic.snapshot.engine.opportunity, revision: decider.traffic.snapshot.room_revision,
      hand: decider.traffic.snapshot.engine.hand, pending: decider.traffic.snapshot.engine.bid.pending,
      commands: decider.traffic.commands.length };
    await decider.page.locator('[data-watten-action="respond_hold"]').focus();
    await decider.page.evaluate(() => {
      window.friendHandNodes = [...document.querySelectorAll('[data-wt-hand] button')];
      window.friendFocus = document.activeElement;
    });
    const selectedPath = await create([selected], { count: 4, start: false, target: 15, determination: 'normal' });
    for (const seat of [1, 2, 3]) {
      await selected.page.locator(`[data-watten-command="place-cpu"][data-seat="${seat}"]`).click();
      await expect.poll(() => selected.traffic.snapshot.room.seats[seat].is_cpu).toBe(true);
    }
    const cpuNames = selected.traffic.snapshot.room.seats.filter(seat => seat.is_cpu).map(seat => seat.name);
    await selected.page.locator('[data-watten-command="start"]').click();
    await expect.poll(() => selected.traffic.snapshot.started).toBe(true);
    await expect(notices(decider)).toContainText(selected.user.username);
    await expect(lobby.page.locator('[data-watten-friend-notice]')).toHaveCount(1);
    const gameId = selectedPath.split('/').at(-1);
    for (const viewer of [decider, lobby]) {
      const messages = seen.get(viewer).starts;
      expect(messages).toHaveLength(1);
      expect(Object.keys(messages[0]).sort()).toEqual(['schema_version', 'id', 'game_id', 'game_type', 'players',
        'player_count', 'mode', 'started_at', 'expires_at', 'spectator_url'].sort());
      expect(messages[0].players).toEqual([{ username: selected.user.username }]);
      expect(messages[0]).toMatchObject({ game_type: 'watten', player_count: 4, mode: '4',
        game_id: gameId, spectator_url: `${selectedPath}/zuschauen` });
      for (const name of cpuNames) await expect(notices(viewer)).not.toContainText(name);
    }
    await expect(decider.page).toHaveURL(new RegExp(`${tablePath}$`));
    await expect(lobby.page).toHaveURL(/\/watten$/);
    await expect(notices(decider).locator('button, a, input, select, textarea')).toHaveCount(0);
    expect(decider.traffic.snapshot.engine.opportunity).toBe(before.opportunity);
    expect(decider.traffic.snapshot.room_revision).toBe(before.revision);
    expect(decider.traffic.snapshot.engine.hand).toEqual(before.hand);
    expect(decider.traffic.snapshot.engine.bid.pending).toEqual(before.pending);
    expect(decider.traffic.commands.slice(before.commands).filter(command => command.action !== 'ping')).toEqual([]);
    expect(await decider.page.evaluate(() => document.activeElement === window.friendFocus
      && window.friendHandNodes.length > 0 && window.friendHandNodes.every((node, index) =>
        node === document.querySelectorAll('[data-wt-hand] button')[index]))).toBe(true);

    await lobby.page.locator('[data-watten-friend-action="watch"]').click();
    await expect(lobby.page).toHaveURL(new RegExp(`${selectedPath}/zuschauen$`));
    await expect.poll(() => lobby.traffic.commands.some(command => command.action === 'spectate_game'
      && command.expected_account_id === lobby.user.id)).toBe(true);
    await expect.poll(() => lobby.traffic.snapshot?.id).toBe(gameId);
    expect(lobby.traffic.snapshot.viewer).toBeNull();

    const optOut = await decider.context.request.put('/api/friend-activity/preferences', {
      headers: authHeaders(decider), data: { viewer_id: decider.user.id, enabled: false },
    });
    expect(optOut.ok()).toBeTruthy();
    // The real focus lifecycle refreshes /me and revokes the mounted notice
    // transport. No synthetic auth/event DTO is injected into the happy path.
    await decider.page.evaluate(() => dispatchEvent(new Event('focus')));
    await expect(notices(decider)).toBeHidden();
    await expect.poll(() => seen.get(decider).sockets.every(socket => socket.closed)).toBe(true);
    expect(decider.traffic.snapshot.engine.bid.pending).toEqual(before.pending);
    const connections = seen.get(decider).sockets.length;
    await decider.page.reload();
    await expect(decider.page.locator('[data-watten-action="respond_hold"]')).toBeEnabled();
    expect(decider.traffic.snapshot.engine.bid.pending).toEqual(before.pending);
    expect(seen.get(decider).sockets).toHaveLength(connections);
    await expect(notices(decider)).toBeHidden();
    for (const item of players) expect(item.traffic.errors).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
