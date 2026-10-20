const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });
test.beforeAll(({ baseURL }) => expect(['8000', '8001']).not.toContain(new URL(baseURL).port));

async function setup(page, language = 'de') {
  const response = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  const account = await (await page.request.get('/api/hausdepp/account')).json();
  const notices = [{
    key: 'achievement:hausdepp_01', kind: 'achievement', name: { de: 'Stuhl her!', en: 'Pull up a chair!' }, points: 10,
    condition: { de: 'Deine erste Runde abschliessen.', en: 'Complete your first round.' },
    reason: { de: 'Deine gespeicherte Runde belegt 1 von 1 erforderlichen Schritten.', en: 'Your saved round confirms 1 of 1 required steps.' },
    source: { finished_at: '2026-10-16T12:00:00+00:00', players: 3 },
  }, {
    key: 'rank:rank_02', kind: 'rank', name: account.ranks[1].name, points: 0, quote: account.ranks[1].quote,
    condition: { de: '25 EP im Hausdepp-Konto erreichen.', en: 'Reach 25 XP in your Hausdepp account.' },
    reason: { de: 'Du hast 35 EP und damit die Rangschwelle erreicht. Der Aufstieg gibt keine Bonus-EP.', en: 'You have 35 XP, reaching the threshold. Ranking up grants no bonus XP.' },
  }];
  const seen = new Set(), acks = []; let fail = false, reads = 0;
  await page.route('**/api/hausdepp/progress-notices', route => {
    reads++;
    return route.fulfill({ json: { notices: notices.filter(item => !seen.has(item.key)), revision: 50, points: 35 } });
  });
  await page.route('**/api/hausdepp/progress-notices/*/acknowledge', route => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2));
    acks.push(key);
    if (fail) return route.fulfill({ status: 503, json: { detail: 'temporary' } });
    seen.add(key); return route.fulfill({ json: { acknowledged: true, key } });
  });
  await page.route('**/api/hausdepp/account/acknowledge', route => route.fulfill({ json: { acknowledged: true, revision: 50 } }));
  return { user, headers, account, notices, seen, acks, fail(value) { fail = value; }, reads: () => reads };
}

for (const language of ['de', 'en']) {
  test(`${language}: catch-up popups explain earned XP and rank, resume closed items and confirm once`, async ({ page }, testInfo) => {
    const fixture = await setup(page, language);
    await page.goto('/hausdepp');
    const dialog = page.locator('#appDialog');
    await expect(dialog).toHaveAttribute('data-kind', 'hausdepp-achievement');
    await expect(dialog).toContainText(language === 'de' ? 'Stuhl her!' : 'Pull up a chair!');
    await expect(dialog).toContainText(language === 'de' ? '+10 EP' : '+10 XP');
    await expect(dialog).toContainText(language === 'de' ? 'Deine erste Runde abschliessen.' : 'Complete your first round.');
    await expect(dialog).toContainText(language === 'de' ? '1 von 1' : '1 of 1');
    await expect(dialog).toContainText(language === 'de' ? '3 Mitspieler' : '3 players');
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const geometry = await dialog.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return { fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          noOverflow: node.scrollWidth <= node.clientWidth,
          buttons: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) };
      });
      expect(geometry.fits).toBe(true); expect(geometry.noOverflow).toBe(true);
      for (const height of geometry.buttons) expect(height).toBeGreaterThanOrEqual(44);
      if (language === 'de') await page.screenshot({ path: testInfo.outputPath(`progress-${viewport.width}x${viewport.height}.png`) });
    }
    await page.keyboard.press('Escape');
    expect(fixture.acks).toEqual([]);
    await page.reload();
    await expect(dialog).toHaveAttribute('data-kind', 'hausdepp-achievement');
    await page.locator('[data-dialog-action=acknowledge]').click();
    await expect(dialog).toHaveAttribute('data-kind', 'hausdepp-rank');
    await expect(dialog).toContainText('Bohr');
    await expect(dialog).toContainText(language === 'de' ? '25 EP' : '25 XP');
    await expect(dialog).not.toContainText('+0');
    await page.locator('[data-dialog-action=later]').click();
    await page.goto('/hausdepp/konto');
    await expect(dialog).toHaveAttribute('data-kind', 'hausdepp-rank');
    await expect(page.locator('#hausdeppProgressNotice')).toBeHidden();
    await page.locator('[data-dialog-action=acknowledge]').click();
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    await page.reload();
    await expect.poll(() => fixture.reads()).toBeGreaterThanOrEqual(4);
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    expect(fixture.acks).toEqual(['achievement:hausdepp_01', 'rank:rank_02']);
  });

  test(`${language}: failed acknowledgement stays visible and retries without advancing or losing earned context`, async ({ page }) => {
    const fixture = await setup(page, language); fixture.fail(true);
    await page.goto('/hausdepp');
    await page.locator('[data-dialog-action=acknowledge]').click();
    await expect(page.locator('#appDialog [role=alert]')).toHaveText(language === 'de'
      ? 'Die Bestätigung konnte nicht gespeichert werden. Bitte versuche es nochmals.'
      : 'Your confirmation could not be saved. Please try again.');
    await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-achievement');
    expect(fixture.seen.size).toBe(0);
    fixture.fail(false);
    await page.locator('[data-dialog-action=acknowledge]').click();
    await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rank');
    expect(fixture.seen.size).toBe(1);
  });
}

test('beginner tours and existing dialogs take priority, markup is always plain text', async ({ page }) => {
  const fixture = await setup(page);
  fixture.notices[0].name.de = '<img src=x onerror=alert(1)>';
  await page.route('**/api/hausdepp/progress-notices', async route => {
    await page.evaluate(() => { const tour = document.createElement('aside'); tour.dataset.gameTour = 'hausdepp'; document.body.append(tour); });
    await route.fulfill({ json: { notices: fixture.notices, revision: 50, points: 35 } });
  });
  await page.goto('/hausdepp');
  await expect(page.locator('[data-game-tour]')).toHaveCount(1);
  await expect(page.locator('#appDialogBackdrop')).toBeHidden();
  await page.unroute('**/api/hausdepp/progress-notices');
  await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: fixture.notices, revision: 50, points: 35 } }));
  await page.locator('[data-game-tour]').evaluate(node => node.remove());
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-achievement');
  await expect(page.locator('#appDialog')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#appDialog img, #appDialog script')).toHaveCount(0);
});

test('an intentionally open native inspector keeps priority until its close event', async ({ page }) => {
  const fixture = await setup(page); let first = true;
  await page.route('**/api/hausdepp/progress-notices', async route => {
    if (first) {
      first = false;
      await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'native-inspector-priority'; document.body.append(dialog); dialog.showModal(); });
    }
    await route.fulfill({ json: { notices: fixture.notices, revision: 50, points: 35 } });
  });
  await page.goto('/hausdepp');
  await expect(page.locator('#native-inspector-priority')).toBeVisible();
  await expect(page.locator('#appDialogBackdrop')).toBeHidden();
  await page.locator('#native-inspector-priority').evaluate(dialog => dialog.close());
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-achievement');
  expect(fixture.acks).toEqual([]);
});

test('a native inspector opened after a popup suspends its focus trap and resumes the unconfirmed item', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/hausdepp');
  await expect(page.locator('#appDialogBackdrop')).toBeVisible();
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-achievement');
  // A pending long-press may open the native top layer just after a remote
  // round-ending update has opened the shared progress dialog.
  await page.evaluate(() => {
    const dialog = document.createElement('dialog'); dialog.id = 'late-native-inspector';
    const button = document.createElement('button'); button.textContent = 'Native inspector control';
    dialog.append(button); document.body.append(dialog); dialog.showModal(); button.focus();
  });
  await expect(page.locator('#late-native-inspector')).toBeVisible();
  await expect(page.locator('#appDialogBackdrop')).toBeHidden();
  await expect(page.locator('#late-native-inspector button')).toBeFocused();
  expect(fixture.acks).toEqual([]);
  // Escape belongs to the native top layer, not the suspended shared dialog.
  await page.keyboard.press('Escape');
  await expect(page.locator('#late-native-inspector')).toBeHidden();
  await expect(page.locator('#appDialogBackdrop')).toBeVisible();
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-achievement');
  expect(fixture.acks).toEqual([]);
  await page.locator('[data-dialog-action=acknowledge]').click();
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rank');
  expect(fixture.acks).toEqual(['achievement:hausdepp_01']);
});

for (const tournament of [false, true]) {
  test(`${tournament ? 'tournament interround' : 'ordinary round'}: an active table never opens catch-up popups and a new round dismisses them without blocking play`, async ({ page }) => {
    const fixture = await setup(page);
    const created = await page.request.post('/api/games', { headers: fixture.headers, data: {
      name: 'Renderer-Test · Meldungen warten auf Rundenende', mode: '2', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1, tournament,
    } });
    expect(created.ok()).toBeTruthy();
    const gameId = (await created.json()).game_id;
    let actual;
    page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      try { const data = JSON.parse(String(payload)); if (data.scoreboard?._hausdepp) actual = data.scoreboard; } catch {}
    }));
    await page.goto(`/hausdepp/spiel/${gameId}`);
    await expect.poll(() => Boolean(actual?._hausdepp?.viewer_id)).toBe(true);
    expect(fixture.reads()).toBe(0);
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    const board = structuredClone(actual), self = board._hausdepp.viewer_id;
    // The safe presentation boundary is the completed round, independently of
    // whether the surrounding tournament's terminal flag is set.
    board._finished = !tournament; board._aborted = false;
    Object.assign(board._hausdepp, { phase: 'finished', hand: [], available_actions: [], deck_count: 0,
      loser_id: board._hausdepp.players.find(player => player.id !== self).id, finished_order: [self], deal: null });
    if (tournament) Object.assign(board._hausdepp_tournament, { completed: false, round_complete: true, can_start_next_round: true });
    let socket; const commands = [];
    await page.routeWebSocket(new RegExp(`/ws/${gameId}$`), routed => {
      socket = routed;
      routed.onMessage(raw => {
        const data = JSON.parse(raw);
        if (handleDisabledHausdeppVoice(routed, data)) return;
        commands.push(data);
        if (data.action === 'join_game') routed.send(JSON.stringify({ player_id: self, scoreboard: board }));
      });
    });
    await page.reload();
    await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-achievement');
    const playing = structuredClone(board); playing._finished = false;
    if (tournament) Object.assign(playing._hausdepp_tournament, { round_number: board._hausdepp_tournament.round_number + 1, round_complete: false, can_start_next_round: false });
    Object.assign(playing._hausdepp, { phase: 'playing', version: board._hausdepp.version + 2,
      current_player_id: self, hand: ['hearts-6', 'bells-U', 'acorns-10'], discard: ['leaves-6'],
      available_actions: ['play', 'pickup', 'gamble'], playable_cards: ['hearts-6', 'bells-U', 'acorns-10'], deck_count: 14,
      pending_refill: null, pending_refills: [], draw_required: false, draw_urgent: false, afterthrow: null,
      private_peek: [], stock_blocked_by: null, finished_order: [], loser_id: null });
    const peeking = structuredClone(playing);
    Object.assign(peeking._hausdepp, { phase: 'peeking', version: playing._hausdepp.version - 1, available_actions: [], playable_cards: [] });
    socket.send(JSON.stringify({ scoreboard: peeking }));
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    socket.send(JSON.stringify({ scoreboard: playing }));
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    expect(fixture.acks).toEqual([]);
    await page.locator('#hausdeppHand [data-card-id="hearts-6"]').click();
    await expect.poll(() => commands.some(command => command.action === 'hausdepp_play'
      && command.cards?.[0] === 'hearts-6' && command.version === playing._hausdepp.version)).toBe(true);
  });
}
