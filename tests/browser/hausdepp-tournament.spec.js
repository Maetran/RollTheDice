const { handleDisabledHausdeppVoice, isHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');
const { startHausdeppCpuGame } = require('./hausdepp-create');
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
  // These scenarios verify gameplay/layout independently of the beginner offer.
  // Full offer, dismissal and tour hit tests remain in game-tours.spec.js.
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: {
    show: false, enabled: true, games: { zdwa: 'unseen', zilch: 'unseen', hausdepp: 'dismissed' },
  } }));
  return headers;
}

test.afterEach(async ({ page }) => {
  const saved = page.hausdeppTournamentOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', { headers: saved.headers, data: { preferred_language: saved.language } });
});

async function realTournament(page, language = 'de', { players = 2 } = {}) {
  await owner(page, language);
  let scoreboard;
  const commands = [], voiceCommands = [];
  page.on('websocket', socket => {
    socket.on('framereceived', event => {
      try { const message = JSON.parse(String(event.payload)); if (message.scoreboard?._hausdepp) scoreboard = message.scoreboard; } catch {}
    });
    socket.on('framesent', event => {
      try {
        const command = JSON.parse(String(event.payload));
        (isHausdeppVoice(command) ? voiceCommands : commands).push(command);
      } catch {}
    });
  });
  await page.goto('/hausdepp');
  await startHausdeppCpuGame(page, { players, cpu: players - 1, tournament: true });
  await expect.poll(() => scoreboard?._hausdepp_tournament?.round_number).toBe(1);
  return { get scoreboard() { return scoreboard; }, commands, voiceCommands, room: page.url() };
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
      if (handleDisabledHausdeppVoice(socket, message)) return;
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

  test(`${language}: first full HAUSDEPP clearly completes the tournament while seven letters keep the round break`, async ({ page }, testInfo) => {
    const traffic = await realTournament(page, language);
    await page.setViewportSize({ width: 390, height: 844 });
    const seven = labelledRoundEnd(traffic.scoreboard);
    const other = seven._hausdepp.loser_id;
    const tournament = seven._hausdepp_tournament;
    tournament.round_number = 7;
    tournament.losses[other] = 7;
    tournament.letters[other] = 'HAUSDEP';
    const mocked = await installLabelledTournament(page, traffic.room, seven);
    let listed = seven;
    const id = new URL(traffic.room).pathname.split('/').pop();
    await page.route('**/api/games?game_type=hausdepp', route => route.fulfill({ json: [{
      id, name: 'UI-Test · Turnierabschluss', mode: '2', expected: 2, started: true, finished: true,
      my_player_id: listed._hausdepp.viewer_id, participants: listed._hausdepp.players,
      tournament: { round_number: listed._hausdepp_tournament.round_number, completed: listed._hausdepp_tournament.completed },
    }] }));
    const complete = language === 'de' ? 'Turnier beendet' : 'Tournament complete';
    const ready = language === 'de' ? 'Bereit für die nächste Runde' : 'Ready for the next round';
    await page.goto(traffic.room);
    await expect(page.locator('#hausdeppNextRound')).toBeVisible();
    await expect(page.locator('#hausdeppResult h2')).not.toContainText(complete);
    await expect(page.locator('#hausdeppTournamentBanner')).toContainText(language === 'de' ? 'Runde 7' : 'Round 7');
    await page.goto('/hausdepp');
    const row = page.locator(`article[data-table-id="${id}"]`);
    await expect(row.locator('.hd-table-status')).toHaveText(ready);
    await expect(row.locator('.hd-table-card-action a')).toHaveAttribute('href', `/hausdepp/spiel/${id}`);

    await page.goto(traffic.room);
    const eight = structuredClone(seven);
    Object.assign(eight._hausdepp_tournament, { round_number: 8, completed: true, tages_hausdepp_id: other, can_start_next_round: false });
    eight._hausdepp_tournament.losses[other] = 8;
    eight._hausdepp_tournament.letters[other] = 'HAUSDEPP';
    mocked.send(eight);
    await expect(page.locator('#hausdeppResult h2')).toContainText(complete);
    await expect(page.locator('#hausdeppResult h2')).toContainText(language === 'de' ? 'Tages-Hausdepp' : 'today’s Hausdepp');
    await expect(page.locator('#hausdeppResult h2')).toBeVisible();
    await expect(page.locator('#hausdeppTournamentBanner')).toContainText(complete);
    await expect(page.locator('#hausdeppNextRound, #hausdeppEndTournament')).toHaveCount(0);
    await expect(page.locator('.hd-tournament-score .is-hausdepp')).toContainText('HAUSDEPP');
    await page.reload();
    await expect(page.locator('#hausdeppResult h2')).toContainText(complete);
    if (language === 'de') await page.screenshot({ path: testInfo.outputPath('tournament-complete-phone.png') });
    listed = eight;
    await page.goto('/hausdepp');
    await expect(row.locator('.hd-table-status')).toHaveText(complete);
    await expect(row.locator('.hd-table-card-action a')).toHaveAttribute('href', '/hausdepp/konto#runden');
    expect(mocked.commands).toEqual([]);
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

for (const language of ['de', 'en']) {
  test(`${language}: six-seat tournament letters keep their own readable line beside every opponent`, async ({ page }, testInfo) => {
    const traffic = await realTournament(page, language, { players: 6 });
    const board = structuredClone(traffic.scoreboard), s = board._hausdepp;
    const self = s.viewer_id;
    Object.assign(board, { _finished: false, _aborted: false, _paused: false });
    Object.assign(s, {
      version: s.version + 1, phase: 'playing', hand: ['hearts-6', 'bells-U', 'acorns-A'],
      discard: ['leaves-7'], deck_count: 9, burned_count: 0, current_player_id: self,
      available_actions: ['play', 'pickup', 'gamble'], playable_cards: ['hearts-6', 'bells-U', 'acorns-A'],
      finished_order: [], loser_id: null, pending_refill: null, pending_refills: [], afterthrow: null,
      draw_required: false, draw_urgent: false, private_peek: [], private_peek_in_stock: [],
      stock_blocked_by: null, peek: null, deal: null, last_event: { type: 'round_started' },
    });
    const ownSeat = s.players.findIndex(player => player.id === self);
    const opponents = [...s.players.slice(ownSeat + 1), ...s.players.slice(0, ownSeat)];
    const names = ['Zenzi', 'Fanni', 'Liesl', 'Hiasl', 'Vroni'];
    const counts = [1, 2, 3, 7, 10];
    opponents.forEach((player, index) => Object.assign(player, { name: names[index], hand_count: counts[index], finished: false }));
    const prefixes = ['H', 'HAU', 'HAUSD', 'HAUSDEP', 'HAUSDEPP'];
    Object.assign(board._hausdepp_tournament, { round_number: 27, completed: false, round_complete: false,
      can_start_next_round: false, letters: Object.fromEntries(opponents.map((player, index) => [player.id, prefixes[index]])) });
    const mocked = await installLabelledTournament(page, traffic.room, board);
    await page.goto(traffic.room);
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('.hd-seat')).toHaveCount(5);
    for (const [width, height, docked = false] of [[390, 844], [320, 568], [568, 320], [844, 390], [768, 1024], [1024, 768], [1440, 900], [320, 568, true]]) {
      await page.setViewportSize({ width, height });
      if (await page.locator('#chatToggle').getAttribute('aria-expanded') === 'true') {
        if (await page.locator('#chatClose').isVisible()) await page.locator('#chatClose').click();
        else await page.locator('#chatToggle').click();
      }
      for (const full of [false, true]) {
        const expected = full ? prefixes.map(() => 'HAUSDEPP') : prefixes;
        board._hausdepp_tournament.letters = Object.fromEntries(opponents.map((player, index) => [player.id, expected[index]]));
        if (docked) board._hausdepp_table_surprises = { round_number: 27, effect: 'star' };
        mocked.send(board);
        await expect(page.locator('.hd-seat > .hd-tournament-prefix')).toHaveText(expected);
        if (docked) await expect(page.locator('.hd-surprise-dock [data-prop="star"]')).toBeVisible();
        const geometry = await page.evaluate(() => {
          const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          const intersects = (a, b) => a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5;
          const obstacles = [...document.querySelectorAll('.hd-seat .hd-opponent-card, .hd-seat .hd-seat-avatar, .hd-seat .hd-seat-plate, #hausdeppStock, #hausdeppPile, .hd-room-heading')]
            .filter(node => node.getClientRects().length).map(node => ({ name: node.id || node.className, box: rect(node) }));
          const prefixes = [...document.querySelectorAll('.hd-seat > .hd-tournament-prefix')];
          return prefixes.map((node, index) => {
            const box = rect(node), plate = rect(node.parentElement.querySelector('.hd-seat-plate'));
            const range = document.createRange(); range.selectNodeContents(node);
            const text = range.getBoundingClientRect();
            return { text: node.textContent, font: parseFloat(getComputedStyle(node).fontSize),
              visible: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
              ownLine: box.top >= plate.bottom + 1,
              clipped: node.scrollWidth > node.clientWidth + 1 || text.left < box.left || text.right > box.right + .5,
              overlap: [...obstacles.filter(other => intersects(box, other.box)).map(other => other.name),
                ...prefixes.filter((other, otherIndex) => otherIndex !== index && intersects(box, rect(other))).map(other => other.textContent)] };
          });
        });
        for (const prefix of geometry) {
          expect(prefix, `${language} ${width}×${height} ${full ? 'all full' : 'mixed'}${docked ? ' with rare dock' : ''}`).toMatchObject({ visible: true, ownLine: true, clipped: false, overlap: [] });
          expect(prefix.font).toBeGreaterThanOrEqual(10);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (language === 'de' && full) await page.screenshot({ path: testInfo.outputPath(`tournament-prefix-${width}x${height}${docked ? '-docked' : ''}.png`) });
      }
    }
    await page.locator('#hausdeppHand [data-card-id="hearts-6"]').click();
    await expect.poll(() => mocked.commands.some(message => message.action === 'hausdepp_play' && message.cards?.[0] === 'hearts-6')).toBe(true);
  });
}
