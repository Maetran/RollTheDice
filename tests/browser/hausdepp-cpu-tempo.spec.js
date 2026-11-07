const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'CPU tempo tests require an isolated test server').not.toBe('8000');
});

test.afterEach(async ({ page }) => {
  if (page.tempoOwner) await page.request.put('/api/auth/preferences/language', {
    headers: page.tempoOwner.headers, data: { preferred_language: page.tempoOwner.language },
  });
});

// A real account and CPU table; only the renderer receives the labelled
// "you finished, CPUs keep playing" projection. No result or reward is written.
async function finishedFixture(page, language) {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.tempoOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  const created = await page.request.post('/api/games', { headers, data: {
    name: 'CPU-Tempo · Fertig', mode: '4', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 3,
  } });
  expect(created.ok()).toBeTruthy();
  const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
  let original;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) original = message.scoreboard; } catch { /* Protocol frames. */ }
  }));
  await page.goto(room);
  await expect.poll(() => !!original?._hausdepp?.viewer_id).toBe(true);
  const board = structuredClone(original);
  const self = board._hausdepp.viewer_id;
  const cpu = board._hausdepp.players.find(player => player.id !== self).id;
  Object.assign(board, { _paused: false, _finished: false, _aborted: false, _hausdepp_tournament: null,
    _cpu_tempo: { can_speed_up: true, fast: false } });
  Object.assign(board._hausdepp, {
    phase: 'playing', hand: [], discard: ['hearts-6', 'bells-7'], deck_count: 0, burned_count: 4,
    current_player_id: cpu, available_actions: [], playable_cards: [], afterthrow: null,
    pending_refill: null, pending_refills: [], draw_required: false, draw_urgent: false, stock_blocked_by: null,
    private_peek: [], peek: { player_id: self, success: false, complete: true }, deal: null,
    last_event: { type: 'play', player_id: self, cards: ['bells-7'] }, finished_order: [self], loser_id: null,
  });
  board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player, hand_count: player.id === self ? 0 : 3, finished: player.id === self }));
  let socket;
  const commands = [];
  await page.routeWebSocket(new RegExp(`/ws/${room.split('/').pop()}$`), active => {
    socket = active;
    active.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (handleDisabledHausdeppVoice(active, message)) return;
      if (message.action === 'join_game') active.send(JSON.stringify({ player_id: self, scoreboard: board }));
      else commands.push(message);
    });
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  if (await page.locator('#chatToggle').getAttribute('aria-expanded') === 'true') await page.locator('#chatToggle').click();
  return { board, cpu, commands, send: (next, extra = {}) => socket.send(JSON.stringify({ scoreboard: next, ...extra })) };
}

function cpuPlays(board, cpu, version, card) {
  const next = structuredClone(board);
  next._hausdepp.version = version;
  next._hausdepp.discard = [...board._hausdepp.discard, card];
  next._hausdepp.last_event = { type: 'play', player_id: cpu, cards: [card] };
  next._hausdepp.players = next._hausdepp.players.map(player => player.id === cpu ? { ...player, hand_count: 2 } : player);
  return next;
}

for (const language of ['de', 'en']) {
  test(`${language}: speeding up CPUs works mid-flight, above table objects and with a stable label`, async ({ page }) => {
    for (const [width, height] of [[390, 844], [844, 390], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const fixture = await finishedFixture(page, language);
      const button = page.locator('#hausdeppSpeedUpCpus');
      await expect(button).toBeVisible();
      await expect(button).toHaveText(language === 'de' ? 'CPUs schneller' : 'Speed up CPUs');
      await expect(button).toBeEnabled();
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);

      // A pushed snack or glass over the control must never take its tap.
      const covered = await button.evaluate(node => {
        const layer = document.querySelector('.hd-table-decor');
        const table = document.getElementById('hausdeppTable').getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        const prop = document.createElement('button');
        prop.className = 'hd-table-prop';
        prop.dataset.testProp = 'true';
        prop.style.cssText = `left:${rect.left - table.left - 10}px;top:${rect.top - table.top - 10}px;width:${rect.width + 20}px;height:${rect.height + 20}px;animation:none`;
        layer.append(prop);
        const hits = [];
        for (const fx of [.08, .5, .92]) for (const fy of [.15, .5, .85]) hits.push(node.contains(document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy)));
        return { layer: !!layer, hits };
      });
      expect(covered.layer).toBe(true);
      expect(covered.hits.every(Boolean), `${width}x${height}: every point of the button stays clickable`).toBe(true);

      // The label node survives a CPU move, so a finger resting on it keeps its tap.
      await button.evaluate(node => { window.__tempoLabel = node.firstChild; });
      fixture.send(cpuPlays(fixture.board, fixture.cpu, fixture.board._hausdepp.version + 1, 'leaves-8'));
      await expect(page.locator('.hd-deal-card[data-target="pile"]')).not.toHaveCount(0);
      expect(await button.evaluate(node => node.firstChild === window.__tempoLabel)).toBe(true);
      // The pile is still in motion; the tap is sent anyway.
      await button.click();
      await expect.poll(() => fixture.commands.filter(command => command.action === 'hausdepp_speed_up_cpus').length).toBe(1);
      const sent = fixture.commands.find(command => command.action === 'hausdepp_speed_up_cpus');
      expect(sent).toMatchObject({ round_number: 1, version: fixture.board._hausdepp.version + 1 });
      expect(fixture.commands.some(command => /pickup|play|draw|gamble/.test(command.action))).toBe(false);

      const fast = cpuPlays(fixture.board, fixture.cpu, fixture.board._hausdepp.version + 2, 'leaves-8');
      fast._cpu_tempo = { can_speed_up: false, fast: true };
      fixture.send(fast, { hausdepp_command: { command_id: sent.command_id, accepted: true, version: fast._hausdepp.version } });
      await expect(button).toHaveText(language === 'de' ? 'Schnelles CPU-Tempo' : 'Faster CPU play');
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#hausdeppCpuTempoStatus')).toHaveText(language === 'de'
        ? 'Die CPUs spielen diese Runde zügiger zu Ende.' : 'The CPUs will finish this round more quickly.');
      await page.locator('[data-test-prop]').evaluate(node => node.remove());
    }
  });
}
