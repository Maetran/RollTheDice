const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
test.beforeAll(({ baseURL }) => expect(['8000', '8001']).not.toContain(new URL(baseURL).port));

async function setup(page, language = 'de') {
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.roundResultRestore = { headers, language: user.preferences.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', {
    headers, data: { preferred_language: language },
  });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 0 } }));
  await page.route('**/api/hausdepp/invitations', route => route.fulfill({ json: { invitations: [] } }));

  const response = await page.request.get('/api/hausdepp/account');
  expect(response.ok()).toBeTruthy();
  const account = await response.json();
  account.scoring = { ...account.scoring, available: true, points: 932 };
  account.rank = { ...account.rank, name: { de: 'Stammgast', en: 'Regular' }, threshold: 500,
    next: { name: { de: 'Tischlegende', en: 'Table legend' }, threshold: 1000 },
    progress: { current: 432, target: 500, percent: 86.4 } };
  // This receipt includes older rounds: it must never become this round's XP.
  account.presentation = { revision: 9001, pending: {
    revision: 9001, points_earned: 900, achievement_ids: [], rank_up: false,
  } };
  let accountReads = 0, accountAcks = 0;
  await page.route('**/api/hausdepp/account?limit=1', route => {
    accountReads++;
    return route.fulfill({ json: account });
  });
  await page.route('**/api/hausdepp/account/acknowledge', route => {
    accountAcks++;
    return route.fulfill({ json: { acknowledged: true } });
  });

  async function create() {
    const created = await page.request.post('/api/games', { headers, data: {
      name: 'Browser Test · Rundenbilanz', mode: '3', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 2,
    } });
    expect(created.ok()).toBeTruthy();
    return (await created.json()).game_id;
  }
  return { user, account, create, accountReads: () => accountReads, accountAcks: () => accountAcks };
}

test.afterEach(async ({ page }) => {
  if (page.roundResultRestore) await page.request.put('/api/auth/preferences/language', {
    headers: page.roundResultRestore.headers,
    data: { preferred_language: page.roundResultRestore.language },
  });
});

async function finishedRenderer(page, fixture, { spectator = false, tournament = false } = {}) {
  const id = await fixture.create();
  let projection;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try {
      const message = JSON.parse(String(payload));
      if (message.scoreboard?._hausdepp) projection = message.scoreboard;
    } catch {}
  }));
  await page.goto(`/hausdepp/spiel/${id}`);
  await expect.poll(() => Boolean(projection?._hausdepp?.viewer_id)).toBe(true);

  // Keep the real authentication, participant IDs and server projection; only
  // the finished renderer state is controlled so the values stay deterministic.
  const board = structuredClone(projection), self = board._hausdepp.viewer_id;
  const others = board._hausdepp.players.filter(player => player.id !== self);
  const loser = others.at(-1).id;
  board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player,
    name: player.id === loser ? 'Rosi' : player.id === self ? 'Admin' : 'Hilde',
    hand_count: player.id === loser ? 1 : 0, finished: player.id !== loser,
  }));
  Object.assign(board, { _finished: true, _aborted: false, _paused: false,
    _hausdepp_tournament: tournament ? {
      round_number: 4, completed: false, round_complete: true, can_start_next_round: true,
      letters: { [loser]: 'HA' }, losses: { [loser]: 2 }, tages_hausdepp_id: null,
      dealer_id: loser, target_word: 'HAUSDEPP',
    } : null,
    _hausdepp_round_summary: { round_id: `${id}:round-4`, players: {
      [self]: { xp: 27, round_xp: 2, achievements: [{ id: 'round-result-award', points: 25,
        name: { de: 'Vier auf einen Streich', en: 'Four in one go' } }] },
    } },
  });
  Object.assign(board._hausdepp, { phase: 'finished', hand: [], discard: [], deck_count: 0,
    available_actions: [], playable_cards: [], current_player_id: null,
    finished_order: [self, ...others.filter(player => player.id !== loser).map(player => player.id)],
    loser_id: loser, deal: null, pending_refills: [], pending_refill: null, afterthrow: null,
    private_peek: [], draw_required: false, draw_urgent: false, stock_blocked_by: null,
    viewer_id: spectator ? null : self,
  });
  const sent = [];
  await page.routeWebSocket(new RegExp(`/ws/${id}$`), socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (handleDisabledHausdeppVoice(socket, message)) return;
      if (['join_game', 'spectate_game'].includes(message.action)) {
        socket.send(JSON.stringify({ scoreboard: board, player_id: spectator ? null : self }));
      } else sent.push(message);
    });
  });
  if (spectator) await page.goto(`/hausdepp/spiel/${id}/zuschauen`);
  else await page.reload();
  await expect(page.locator('#hausdeppResult')).toBeVisible();
  return { id, board, self, loser, sent };
}

async function expectCompactGeometry(page, width, height) {
  await page.setViewportSize({ width, height });
  const result = page.locator('#hausdeppResult');
  await expect(result).toBeVisible();
  const geometry = await result.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      overflow: node.scrollWidth > node.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      headingSize: Number.parseFloat(getComputedStyle(node.querySelector('h2')).fontSize),
      controls: [...node.querySelectorAll('button, a[href]')].map(control => {
        const controlRect = control.getBoundingClientRect();
        return { width: controlRect.width, height: controlRect.height };
      }),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.overflow).toBe(false);
  expect(geometry.pageOverflow).toBe(false);
  expect(geometry.headingSize).toBeLessThanOrEqual(24);
  if (width >= 1200) expect(geometry.width).toBeLessThanOrEqual(620);
  expect(geometry.controls.length).toBeGreaterThan(0);
  for (const control of geometry.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
}

for (const language of ['de', 'en']) {
  test(`${language}: compact result shows the actual round, earned XP and account context`, async ({ page }, info) => {
    const fixture = await setup(page, language);
    await finishedRenderer(page, fixture);
    const result = page.locator('#hausdeppResult');
    const xp = language === 'de' ? 'EP' : 'XP';
    await expect(result.locator('h2')).toContainText('Rosi');
    await expect(result.locator('h2')).toContainText('Hausdepp');
    await expect(result.locator('.hd-result-context')).toContainText('3');
    await expect(result.locator('.hd-result-context')).toContainText('2');
    await expect(result.locator('.hd-result-context')).toContainText(/Computer/i);
    await expect(result.locator('.hd-result-place')).toHaveCount(3);
    await expect(result.locator('.hd-result-place.is-self')).toContainText(`+27 ${xp}`);
    await expect(result.locator('.hd-result-place.is-self .hd-result-awards')).toContainText(
      language === 'de' ? 'Vier auf einen Streich' : 'Four in one go');
    await expect(result.locator('.hd-round-earned')).toContainText(`+27 ${xp}`);
    await expect(result.locator('.hd-round-earned')).toContainText(`+2 ${xp}`);
    await expect(result.locator('.hd-round-earned')).toContainText(`+25 ${xp}`);
    await expect(result.locator('.hd-round-account')).toContainText(`932 ${xp}`);
    await expect(result.locator('.hd-round-account')).toContainText(language === 'de' ? 'Stammgast' : 'Regular');
    await expect(result.locator('.hd-round-account')).toContainText('68');
    await expect(result.locator('.hd-round-account')).toContainText(language === 'de' ? 'Tischlegende' : 'Table legend');
    await expect(result).not.toContainText(`+900 ${xp}`);
    await expect(result.locator('.hd-progress-notice')).toHaveCount(0);
    await expect(result).not.toContainText(/Ein Abend, der zählt|An evening that counts|Gleiche Tischgrösse|Same table size/);
    await expect(page.locator('#hausdeppRecreate')).toHaveText(language === 'de' ? 'Neu erstellen' : 'Create again');

    const deScenario = language === 'de';
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
      await expectCompactGeometry(page, width, height);
      // deScenario: keep mobile and desktop evidence with the same earned data.
      if (deScenario && (width === 390 || width === 1440)) {
        await page.screenshot({ path: info.outputPath(`round-result-${width}x${height}.png`) });
      }
    }
  });

  test(`${language}: account rank survives acknowledged notices and missing round data invents no XP`, async ({ page }) => {
    const fixture = await setup(page, language);
    fixture.account.presentation.pending = null;
    const source = await finishedRenderer(page, fixture);
    const result = page.locator('#hausdeppResult');
    const xp = language === 'de' ? 'EP' : 'XP';
    await expect(result.locator('.hd-round-account')).toContainText(`932 ${xp}`);
    await expect(result.locator('.hd-round-earned')).toContainText(`+27 ${xp}`);
    await expect(result.locator('.hd-round-account')).toContainText(language === 'de' ? 'Stammgast' : 'Regular');

    source.board._hausdepp_round_summary = null;
    fixture.account.presentation.pending = { revision: 9002, points_earned: 900, achievement_ids: [], rank_up: false };
    await page.reload();
    await expect(result.locator('.hd-round-account')).toContainText(`932 ${xp}`);
    expect((await result.locator('.hd-round-earned').allTextContents()).join(' ')).not.toMatch(/\+\s*\d/);
    await expect(result).not.toContainText(`+900 ${xp}`);
    await expect(result.locator('.hd-result-place.is-self .hd-result-reward')).toHaveCount(0);
    await expect(page.locator('#hausdeppRecreate')).toBeEnabled();
  });

  test(`${language}: tournament summary names the round and retains its next-round action`, async ({ page }) => {
    const fixture = await setup(page, language);
    const source = await finishedRenderer(page, fixture, { tournament: true });
    const result = page.locator('#hausdeppResult');
    await expect(result.locator('.hd-result-context')).toContainText(language === 'de' ? 'Runde 4' : 'Round 4');
    await expect(result.locator('.hd-tournament-score')).toContainText('HA');
    await expect(page.locator('#hausdeppNextRound')).toBeVisible();
    await expect(page.locator('#hausdeppNextRound')).toContainText('5');
    await expect(page.locator('#hausdeppRecreate')).toHaveCount(0);
    await expectCompactGeometry(page, 320, 568);
    await page.locator('#hausdeppNextRound').click();
    await expect.poll(() => source.sent.some(message => message.action === 'hausdepp_next_round')).toBe(true);
  });
}

test('spectators see the public round result without requesting private account progress', async ({ page }) => {
  const fixture = await setup(page);
  await finishedRenderer(page, fixture, { spectator: true });
  const result = page.locator('#hausdeppResult');
  await expect(result.locator('.hd-result-places')).toBeVisible();
  await expect(result.locator('h2')).toContainText('Rosi');
  await expect(result.locator('.hd-round-account')).toHaveCount(0);
  await expect(result.locator('.hd-round-earned')).toHaveCount(0);
  await expect(page.locator('#hausdeppRecreate, #hausdeppNextRound')).toHaveCount(0);
  expect(fixture.accountReads()).toBe(0);
});

test('equal XP and achievements only acknowledge the currently displayed round source', async ({ page }) => {
  const fixture = await setup(page);
  fixture.account.presentation.pending = {
    revision: 9001, points_earned: 27, achievement_ids: ['round-result-award'], rank_up: false,
  };
  fixture.account.history = { rounds: [] };
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', {
    configurable: true, get: () => window.__roundSummaryHidden !== false,
  }));
  const source = await finishedRenderer(page, fixture);
  const summary = page.locator('#hausdeppRoundProgress');
  async function showInForeground() {
    await expect(summary.locator('.hd-round-earned')).toContainText('+27 EP');
    await summary.scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      window.__roundSummaryHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      // Let visibility and intersection delivery complete before checking the
      // absence of a receipt. The matching case below verifies the same path.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  // Missing source data cannot prove that this table presents the pending XP.
  await showInForeground();
  expect(fixture.accountAcks()).toBe(0);

  // Another tab can finish a different round with identical XP and badges.
  fixture.account.history.rounds = [{ game_id: 'another-table:round-5' }];
  await page.reload();
  await showInForeground();
  expect(fixture.accountAcks()).toBe(0);

  fixture.account.history.rounds = [{ game_id: source.board._hausdepp_round_summary.round_id }];
  await page.reload();
  await expect(summary.locator('.hd-round-earned')).toContainText('+27 EP');
  expect(fixture.accountAcks()).toBe(0);
  await showInForeground();
  await expect.poll(() => fixture.accountAcks()).toBe(1);
});
