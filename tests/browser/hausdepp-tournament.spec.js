const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function owner(page, language = 'de') {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.hausdeppTournamentOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  return headers;
}

test.afterEach(async ({ page }) => {
  const saved = page.hausdeppTournamentOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', { headers: saved.headers, data: { preferred_language: saved.language } });
});

async function realTournament(page, language = 'de', { players = 2 } = {}) {
  await owner(page, language);
  let scoreboard;
  const commands = [];
  page.on('websocket', socket => {
    socket.on('framereceived', event => {
      try { const message = JSON.parse(String(event.payload)); if (message.scoreboard?._hausdepp) scoreboard = message.scoreboard; } catch {}
    });
    socket.on('framesent', event => { try { commands.push(JSON.parse(String(event.payload))); } catch {} });
  });
  await page.goto('/hausdepp');
  await page.locator('input[name="tournament"][value="true"]').check();
  if (players !== 2) {
    await page.locator('[name="players"]').selectOption(String(players));
    await page.locator('[name="cpu_count"]').selectOption(String(players - 1));
  }
  await page.locator('#hausdeppCreate').click();
  await expect.poll(() => scoreboard?._hausdepp_tournament?.round_number).toBe(1);
  return { get scoreboard() { return scoreboard; }, commands, room: page.url() };
}

function labelledRoundEnd(real, { final = false, host = true } = {}) {
  const board = structuredClone(real);
  const self = board._hausdepp.viewer_id;
  const other = board._hausdepp.players.find(player => player.id !== self).id;
  board._name = 'UI-Test · Turnier-Ende';
  board._paused = false; board._finished = true;
  Object.assign(board._hausdepp, {
    phase: 'finished', hand: [], discard: [], deck_count: 0, available_actions: [], playable_cards: [],
    loser_id: other, pending_refills: [], pending_refill: null, afterthrow: null, private_peek: [],
    draw_required: false, draw_urgent: false, stock_blocked_by: null,
    players: board._hausdepp.players.map(player => ({ ...player, hand_count: player.id !== other ? 0 : 1, finished: player.id !== other })),
  });
  const losses = Object.fromEntries(board._hausdepp.players.map((player, index) => [player.id, final ? player.id === self ? 7 : player.id === other ? 8 : index - 1 : player.id === other ? 1 : 0]));
  board._hausdepp_tournament = {
    id: 'labelled-tournament', round_number: Object.values(losses).reduce((sum, count) => sum + count, 0), losses,
    letters: Object.fromEntries(Object.entries(losses).map(([id, count]) => [id, 'HAUSDEPP'.slice(0, count)])),
    completed: final, tages_hausdepp_id: final ? other : null, round_complete: true,
    can_start_next_round: host && !final, dealer_id: other, target_word: 'HAUSDEPP',
  };
  return board;
}

async function installLabelledTournament(page, room, initial, onCommand) {
  let current = initial;
  let activeSocket;
  const commands = [];
  const roomId = new URL(room).pathname.split('/').pop();
  await page.routeWebSocket(new RegExp(`/ws/${roomId}$`), socket => {
    activeSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (['join_game', 'spectate_game'].includes(message.action)) socket.send(JSON.stringify({ player_id: current._hausdepp.viewer_id, scoreboard: current }));
      else { commands.push(message); onCommand?.({ message, socket, current }); }
    });
  });
  return { commands, send: next => { current = next; activeSocket.send(JSON.stringify({ scoreboard: next })); } };
}

for (const language of ['de', 'en']) {
  test(`${language}: real lobby creates a tournament and keeps its round through reload`, async ({ page }) => {
    const traffic = await realTournament(page, language);
    await expect(page.locator('#hausdeppTournamentBanner')).toContainText(language === 'de' ? 'Runde 1' : 'Round 1');
    expect(traffic.scoreboard._hausdepp_tournament.target_word).toBe('HAUSDEPP');
    expect(Object.values(traffic.scoreboard._hausdepp_tournament.losses)).toEqual([0, 0]);
    const dealer = traffic.scoreboard._hausdepp_tournament.dealer_id;
    const participants = traffic.scoreboard._hausdepp.players.map(player => player.id);
    await page.reload();
    await expect(page.locator('#hausdeppTournamentBanner')).toContainText(language === 'de' ? 'Runde 1' : 'Round 1');
    expect(traffic.scoreboard._hausdepp_tournament.dealer_id).toBe(dealer);
    expect(traffic.scoreboard._hausdepp.players.map(player => player.id)).toEqual(participants);
    expect(page.url()).toBe(traffic.room);
  });

  test(`${language}: labelled completed round starts the next round through the host action`, async ({ page }) => {
    const traffic = await realTournament(page, language);
    const fixture = labelledRoundEnd(traffic.scoreboard);
    const self = fixture._hausdepp.viewer_id;
    const initialVersion = fixture._hausdepp.version;
    const mocked = await installLabelledTournament(page, traffic.room, fixture, ({ message, socket, current }) => {
      if (message.action !== 'hausdepp_next_round') return;
      current._finished = false;
      Object.assign(current._hausdepp_tournament, { round_number: 2, round_complete: false, can_start_next_round: false, dealer_id: self });
      Object.assign(current._hausdepp, {
        version: initialVersion + 1, phase: 'playing', hand: ['hearts-6'], current_player_id: self,
        available_actions: ['play'], playable_cards: ['hearts-6'], loser_id: null,
        players: current._hausdepp.players.map(player => ({ ...player, hand_count: 1, finished: false })),
      });
      socket.send(JSON.stringify({ scoreboard: current, hausdepp_command: { command_id: message.command_id, accepted: true, version: current._hausdepp.version } }));
    });
    await page.goto(traffic.room);
    await expect(page.locator('#hausdeppNextRound')).toBeVisible();
    await page.locator('#hausdeppNextRound').click();
    await expect.poll(() => mocked.commands.filter(command => command.action === 'hausdepp_next_round').length).toBe(1);
    expect(mocked.commands.find(command => command.action === 'hausdepp_next_round')).toMatchObject({ version: initialVersion });
    await expect(page.locator('#hausdeppResult')).toBeHidden();
    await expect(page.locator('#hausdeppTournamentBanner')).toContainText(language === 'de' ? 'Runde 2' : 'Round 2');
    await expect(page.locator('#hausdeppTournamentBanner')).toContainText('Admin');
    await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(1);
    expect(page.url()).toBe(traffic.room);
  });
}

test('labelled tournament limits the next-round control to the host and ends at HAUSDEPP', async ({ page }) => {
  const traffic = await realTournament(page);
  const nonhost = labelledRoundEnd(traffic.scoreboard, { host: false });
  const mocked = await installLabelledTournament(page, traffic.room, nonhost);
  await page.goto(traffic.room);
  await expect(page.locator('#hausdeppResult')).toBeVisible();
  await expect(page.locator('#hausdeppNextRound')).toHaveCount(0);
  await expect(page.locator('.hd-tournament-wait')).toBeVisible();
  mocked.send(labelledRoundEnd(traffic.scoreboard, { final: true }));
  await expect(page.locator('#hausdeppResult h2')).toContainText('Tages-Hausdepp');
  await expect(page.locator('#hausdeppOwnPrefix')).toHaveText('HAUSDEP');
  await expect(page.locator('.hd-seat .hd-tournament-prefix')).toHaveText('HAUSDEPP');
  await expect(page.locator('.hd-tournament-score .is-hausdepp')).toContainText('8 / 8');
  await expect(page.locator('#hausdeppNextRound')).toHaveCount(0);
  expect(mocked.commands).toHaveLength(0);
});

test('labelled lobby resumes a tournament between rounds at its existing table', async ({ page }) => {
  const traffic = await realTournament(page);
  const id = new URL(traffic.room).pathname.split('/').pop();
  await page.route('**/api/games?game_type=hausdepp', route => route.fulfill({ json: [{
    id, name: 'UI-Test · Turnier zwischen Runden', mode: '2', expected: 2,
    started: true, finished: true, my_player_id: traffic.scoreboard._hausdepp.viewer_id,
    participants: traffic.scoreboard._hausdepp.players,
    tournament: { round_number: 1, completed: false },
  }] }));
  await page.goto('/hausdepp');
  const row = page.locator(`article[data-table-id="${id}"]`);
  await expect(row).toContainText('Bereit für die nächste Runde');
  await expect(row).toContainText('Turnier · Runde 1');
  await expect(row.locator('a')).toHaveAttribute('href', `/hausdepp/spiel/${id}`);
  await row.locator('a').click();
  await expect(page).toHaveURL(traffic.room);
});

test('labelled host can cancel confirmation or end the tournament without a daily loser', async ({ page }) => {
  const traffic = await realTournament(page);
  const mocked = await installLabelledTournament(page, traffic.room, labelledRoundEnd(traffic.scoreboard), ({ message, socket, current }) => {
    if (message.action !== 'end_game') return;
    current._aborted = true;
    current._hausdepp_tournament.can_start_next_round = false;
    socket.send(JSON.stringify({ scoreboard: current }));
  });
  await page.goto(traffic.room);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#hausdeppEndTournament').click();
  expect(mocked.commands).toHaveLength(0);
  await expect(page.locator('#hausdeppNextRound')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#hausdeppEndTournament').click();
  await expect.poll(() => mocked.commands.some(message => message.action === 'end_game')).toBe(true);
  await expect(page.locator('#hausdeppResult h2')).toHaveText('Turnier beendet.');
  await expect(page.locator('#hausdeppResult')).toContainText('ohne Tages-Hausdepp');
  await expect(page.locator('#hausdeppNextRound, #hausdeppEndTournament')).toHaveCount(0);
});

test('capture labelled tournament round end and final across mobile orientations', async ({ page }) => {
  test.skip(process.env.HAUSDEPP_ACHIEVEMENTS_CAPTURE !== '1', 'One explicit responsive evidence batch.');
  const traffic = await realTournament(page, 'de', { players: 6 });
  const mocked = await installLabelledTournament(page, traffic.room, labelledRoundEnd(traffic.scoreboard));
  await page.goto(traffic.room);
  await mkdir('.impeccable/review', { recursive: true });
  for (const [name, width, height] of [['phone-portrait', 390, 844], ['phone-landscape', 844, 390], ['tablet-landscape', 1024, 768], ['desktop-landscape', 1440, 900]]) {
    await page.setViewportSize({ width, height });
    if (await page.locator('#chatToggle').getAttribute('aria-expanded') === 'true') {
      if (await page.locator('#chatClose').isVisible()) await page.locator('#chatClose').click();
      else await page.locator('#chatToggle').click();
    }
    for (const [scenario, final] of [['round-end', false], ['final', true]]) {
      mocked.send(labelledRoundEnd(traffic.scoreboard, { final }));
      await expect(page.locator('#hausdeppResult')).toBeVisible();
      await page.locator('#hausdeppResult .hd-result-links').locator('button, a').first().focus();
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      await page.screenshot({ path: `.impeccable/review/hausdepp-tournament-labelled-${scenario}-${name}.png`, fullPage: true });
    }
  }
});
