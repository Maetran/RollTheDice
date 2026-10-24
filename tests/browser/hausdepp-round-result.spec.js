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
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
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
  board._participants = board._participants.map(player => ({ ...player,
    name: board._hausdepp.players.find(person => person.id === player.id)?.name || player.name,
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
  const simulatedSockets = new Set();
  await page.routeWebSocket(new RegExp(`/ws/${id}$`), socket => {
    simulatedSockets.add(socket);
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
  await expect(page.locator('#hausdeppLeaveGame')).toBeHidden();
  await expect(page.locator('#hausdeppLeaveGameResult')).toBeVisible();
  return { id, board, self, loser, sent,
    publish(extra = {}) { for (const socket of simulatedSockets) socket.send(JSON.stringify({ scoreboard: board, ...extra })); },
  };
}

for (const language of ['de', 'en']) {
  test(`finished solo player can speed up CPUs in the vacant hand area (${language})`, async ({ page }) => {
    const fixture = await setup(page, language);
    const live = await finishedRenderer(page, fixture);
    const { board, self } = live;
    board._finished = false;
    board._hausdepp.phase = 'playing';
    board._hausdepp.loser_id = null;
    board._hausdepp.current_player_id = board._hausdepp.players.find(player => player.id !== self).id;
    board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player,
      finished: player.id === self, hand_count: player.id === self ? 0 : 3,
    }));
    board._cpu_tempo = { fast: false, can_speed_up: true };
    live.publish();
    await expect(page.locator('#hausdeppLeaveGame')).toBeVisible();
    await expect(page.locator('#hausdeppLeaveGameResult')).toBeHidden();
    const button = page.getByRole('button', { name: language === 'de' ? 'CPUs schneller' : 'Speed up CPUs', exact: true });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds.width).toBeLessThan(250);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate(node => Boolean(node.closest('.hd-hand-region')))).toBe(true);
      await expect(page.locator('#hausdeppHand')).toBeHidden();
    }
    await button.click();
    await expect.poll(() => live.sent.find(message => message.action === 'hausdepp_speed_up_cpus')).toBeTruthy();
    const command = live.sent.find(message => message.action === 'hausdepp_speed_up_cpus');
    expect(command.round_number).toBe(1);
    board._cpu_tempo = { fast: true, can_speed_up: false };
    live.publish({ hausdepp_command: { command_id: command.command_id, accepted: true, version: board._hausdepp.version } });
    await expect(page.getByRole('button', { name: language === 'de' ? 'Schnelles CPU-Tempo' : 'Faster CPU play', exact: true })).toBeDisabled();
    board._cpu_tempo = { fast: false, can_speed_up: false };
    live.publish();
    await expect(page.locator('#hausdeppCpuTempo')).toBeHidden();
  });
}

async function expectCompactGeometry(page, width, height) {
  await page.setViewportSize({ width, height });
  const result = page.locator('#hausdeppResult');
  await expect(result).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await result.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const bounds = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
    };
    const textBounds = element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].map(box => ({
        left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width,
      }));
    };
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      overflow: node.scrollWidth > node.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      headingSize: Number.parseFloat(getComputedStyle(node.querySelector('h2')).fontSize),
      controls: [...node.querySelectorAll('button, a[href]')].filter(control => control.getClientRects().length).map(control => {
        const controlRect = control.getBoundingClientRect();
        return { width: controlRect.width, height: controlRect.height };
      }),
      rows: [...node.querySelectorAll('.hd-result-place')].map(row => {
        const rank = row.querySelector('.hd-result-rank');
        const name = row.querySelector('.hd-result-name');
        const avatar = row.querySelector('.hd-result-avatar');
        const reward = row.querySelector('.hd-result-reward');
        const rankBox = bounds(rank), rowBox = bounds(row), nameBox = bounds(name);
        const neighbours = [
          { label: 'avatar', ...bounds(avatar) }, { label: 'name', ...nameBox },
          ...(reward ? textBounds(reward).map(box => ({ label: 'XP', ...box })) : []),
        ];
        const statusText = textBounds(rank);
        return {
          status: rank.textContent, name: name.textContent, nameWidth: nameBox.width,
          // Measure the painted glyphs: a fixed grid cell can fit while its
          // unwrapped status text extends into the neighbouring avatar.
          statusText, rankBox, rowBox,
          collisions: statusText.flatMap(text => neighbours.filter(box => overlaps(text, box)).map(box => box.label)),
        };
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
  expect(geometry.rows.length).toBeGreaterThan(0);
  for (const row of geometry.rows) {
    const label = `${width}x${height}: ${row.status} / ${row.name}`;
    expect(row.nameWidth, `${label}: name has usable space`).toBeGreaterThan(0);
    expect(row.collisions, `${label}: painted status must not overlap avatar, name or XP`).toEqual([]);
    for (const text of row.statusText) {
      expect(text.left, `${label}: status fits its column`).toBeGreaterThanOrEqual(row.rankBox.left - 1);
      expect(text.right, `${label}: status fits its column`).toBeLessThanOrEqual(row.rankBox.right + 1);
      expect(text.left, `${label}: status fits the row`).toBeGreaterThanOrEqual(row.rowBox.left - 1);
      expect(text.right, `${label}: status fits the row`).toBeLessThanOrEqual(row.rowBox.right + 1);
    }
  }
}

function useLongResultNames(board) {
  const names = ['Franziska-Maria-vom-Stammtisch', 'Maximilian-Alexander-am-Tisch', 'Sophie-von-der-langen-Tafel'];
  board._hausdepp.players.forEach((player, index) => { player.name = names[index]; });
  board._participants.forEach(player => {
    player.name = board._hausdepp.players.find(person => person.id === player.id)?.name || player.name;
  });
}

test('an insufficient-player tournament ending labels remaining and withdrawn seats without invented places', async ({ page }) => {
  const fixture = await setup(page);
  const rendered = await finishedRenderer(page, fixture, { tournament: true });
  const board = rendered.board, state = board._hausdepp;
  const withdrawn = state.players.filter(player => player.id !== rendered.self).map(player => player.id);
  Object.assign(state, { loser_id: null, finished_order: [], withdrawn_ids: withdrawn,
    round_end_reason: 'insufficient_players', remaining_player_id: rendered.self });
  state.players = state.players.map(player => ({ ...player, finished: false,
    withdrawn: withdrawn.includes(player.id), outcome: player.id === rendered.self ? 'remaining' : 'withdrawn' }));
  Object.assign(board._hausdepp_tournament, { completed: true, end_reason: 'insufficient_players', tages_hausdepp_id: null });
  board._departure_permissions = { can_leave: false, forfeits_round: false, ends_tournament_participation: false };
  board._hausdepp_round_summary.players = { [rendered.self]: { xp: 2, round_xp: 2, achievements: [] } };
  await page.reload();
  await expect(page.locator('#hausdeppResult h2')).toHaveText('Turnier ohne Tages-Hausdepp beendet');
  await expect(page.locator('.hd-result-place.is-self .hd-result-rank')).toHaveText('Verblieben');
  await expect(page.locator('.hd-result-place.is-self .hd-result-reward')).toHaveText('+2 EP');
  await expect(page.locator('.hd-result-place:not(.is-self) .hd-result-rank')).toHaveText(['Ausgestiegen', 'Ausgestiegen']);
  await expect(page.locator('.hd-result-place.is-hausdepp')).toHaveCount(0);
});

test('a departure updates cached tournament standings while preserving a regular round place', async ({ page }) => {
  const fixture = await setup(page);
  const rendered = await finishedRenderer(page, fixture, { tournament: true });
  const departed = rendered.board._hausdepp.finished_order.find(id => id !== rendered.self);
  const person = rendered.board._hausdepp.players.find(player => player.id === departed);
  const place = page.locator('.hd-result-place').filter({ has: page.locator('.hd-result-name', { hasText: person.name }) });
  const previousPlace = await place.locator('.hd-result-rank').innerText();
  rendered.board._hausdepp_tournament.departed_ids = [departed];
  rendered.publish();
  await expect(page.locator('.hd-tournament-score li').filter({ hasText: person.name })).toContainText('Ausgestiegen');
  await expect(place.locator('.hd-result-rank')).toHaveText(previousPlace);
  rendered.board._hausdepp.players = rendered.board._hausdepp.players.filter(player => player.id !== departed);
  rendered.board._hausdepp.finished_order = rendered.board._hausdepp.finished_order.filter(id => id !== departed);
  rendered.board._hausdepp_tournament.round_number++;
  rendered.publish();
  await expect(page.locator('.hd-tournament-score li').filter({ hasText: person.name })).toContainText('Ausgestiegen');
});

for (const language of ['de', 'en']) {
  test(`${language}: two human players retain readable remaining and withdrawn results`, async ({ page }, info) => {
    const fixture = await setup(page, language);
    const rendered = await finishedRenderer(page, fixture);
    const board = rendered.board, state = board._hausdepp;
    const other = state.players.find(player => player.id !== rendered.self).id;
    state.players = [rendered.self, other].map(id => ({
      ...state.players.find(player => player.id === id),
      name: id === rendered.self ? 'Sophie' : 'Mani', is_cpu: false, participant_type: 'human',
      finished: false, withdrawn: id === other, outcome: id === other ? 'withdrawn' : 'remaining',
      hand_count: id === other ? 0 : 1,
    }));
    board._participants = state.players.map(player => ({ ...player }));
    Object.assign(board, { _mode: '2', _expected: 2,
      _departure_permissions: { can_leave: false, forfeits_round: false, ends_tournament_participation: false },
      _hausdepp_round_summary: { round_id: `${rendered.id}:two-human`, players: {
        [rendered.self]: { xp: 10, round_xp: 10, achievements: [] },
        [other]: { xp: 0, round_xp: 0, achievements: [] },
      } },
    });
    Object.assign(state, { loser_id: null, finished_order: [], withdrawn_ids: [other],
      round_end_reason: 'insufficient_players', remaining_player_id: rendered.self });
    await page.reload();
    const result = page.locator('#hausdeppResult');
    const xp = language === 'de' ? 'EP' : 'XP';
    await expect(result.locator('h2')).toHaveText(language === 'de'
      ? 'Runde ohne Hausdepp beendet' : 'Round ended without a Hausdepp');
    await expect(result.locator('.hd-result-place')).toHaveCount(2);
    await expect(result.locator('.hd-result-name')).toHaveText(['Sophie', 'Mani']);
    await expect(result.locator('.hd-result-rank')).toHaveText(language === 'de'
      ? ['Verblieben', 'Ausgestiegen'] : ['Remaining', 'Withdrawn']);
    await expect(result.locator('.hd-result-reward')).toHaveText([`+10 ${xp}`, `0 ${xp}`]);
    await expect(result.locator('.hd-result-place.is-hausdepp, .hd-result-reward.is-cpu')).toHaveCount(0);
    for (const [width, height] of [[375, 812], [320, 568], [390, 844], [844, 390], [1440, 900]]) {
      await expectCompactGeometry(page, width, height);
      if (width === 375) {
        const names = await result.locator('.hd-result-name').evaluateAll(nodes => nodes.map(node => ({
          name: node.textContent, clipped: node.scrollWidth > node.clientWidth + 1,
        })));
        expect(names).toEqual([{ name: 'Sophie', clipped: false }, { name: 'Mani', clipped: false }]);
        await page.screenshot({ path: info.outputPath(`two-human-result-${language}-${width}x${height}.png`) });
      }
    }
  });

  test(`${language}: compact result shows the actual round, earned XP and account context`, async ({ page }, info) => {
    const fixture = await setup(page, language);
    const rendered = await finishedRenderer(page, fixture);
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

    useLongResultNames(rendered.board);
    await page.reload();
    await expect(result.locator('.hd-result-name')).toHaveCount(3);

    const deScenario = language === 'de';
    for (const [width, height] of [[320, 568], [375, 812], [390, 844], [844, 390], [1440, 900]]) {
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
    useLongResultNames(source.board);
    await page.reload();
    await expect(result.locator('.hd-result-name')).toHaveCount(3);
    for (const [width, height] of [[320, 568], [375, 812], [390, 844], [844, 390], [1440, 900]]) {
      await expectCompactGeometry(page, width, height);
    }
    await page.locator('#hausdeppNextRound').click();
    await expect.poll(() => source.sent.some(message => message.action === 'hausdepp_next_round')).toBe(true);
  });
}

test('keyboard focus follows the table exit into the finished result sheet', async ({ page }) => {
  const fixture = await setup(page);
  const live = await finishedRenderer(page, fixture);
  live.board._finished = false;
  live.board._hausdepp.phase = 'playing';
  live.publish();
  const tableExit = page.locator('#hausdeppLeaveGame');
  await expect(tableExit).toBeVisible();
  await tableExit.focus();
  live.board._finished = true;
  live.board._hausdepp.phase = 'finished';
  live.publish();
  await expect(tableExit).toBeHidden();
  await expect(page.locator('#hausdeppLeaveGameResult')).toBeFocused();
});

test('spectators see the public round result without requesting private account progress', async ({ page }) => {
  const fixture = await setup(page);
  const rendered = await finishedRenderer(page, fixture, { spectator: true });
  const result = page.locator('#hausdeppResult');
  await expect(result.locator('.hd-result-places')).toBeVisible();
  await expect(result.locator('h2')).toContainText('Rosi');
  await expect(result.locator('.hd-round-account')).toHaveCount(0);
  await expect(result.locator('.hd-round-earned')).toHaveCount(0);
  await expect(page.locator('#hausdeppRecreate, #hausdeppNextRound')).toHaveCount(0);
  expect(fixture.accountReads()).toBe(0);
  const leave = page.locator('#hausdeppLeaveGameResult');
  await expect(leave).toHaveAccessibleName('Tisch verlassen');
  await expect(leave).toBeEnabled();
  await leave.click();
  await expect(page).toHaveURL(url => url.pathname === '/hausdepp');
  expect(rendered.sent).toEqual([]);
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
