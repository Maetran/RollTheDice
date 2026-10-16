const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');
const { openPasswordLogin } = require('./password-login');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  ['mobile-portrait', { width: 390, height: 844 }],
  ['mobile-landscape', { width: 844, height: 390 }],
  ['tablet-portrait', { width: 768, height: 1024 }],
  ['tablet-landscape', { width: 1024, height: 768 }],
  ['desktop-landscape', { width: 1440, height: 900 }],
  ['desktop-portrait', { width: 900, height: 1440 }],
  ['narrow-mobile', { width: 320, height: 568 }],
];

async function ownerSession(page, language = 'de') {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  expect(user).toMatchObject({ id: 1, is_owner: true, is_founder: true });
  page.hausdeppOwner = { csrf: user.csrf_token, language: user.preferences?.preferred_language || 'de' };
  const saved = await page.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': user.csrf_token }, data: { preferred_language: language },
  });
  expect(saved.ok()).toBeTruthy();
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  return user;
}

test.afterEach(async ({ page }) => {
  if (page.hausdeppOwner) {
    await page.request.put('/api/auth/preferences/language', {
      headers: { 'X-CSRF-Token': page.hausdeppOwner.csrf },
      data: { preferred_language: page.hausdeppOwner.language },
    });
  }
});

function watchGame(page) {
  const traffic = { state: null, scoreboard: null, messages: [], commands: [], pageErrors: [] };
  page.on('pageerror', error => traffic.pageErrors.push(error.message));
  page.on('websocket', socket => {
    socket.on('framesent', event => {
      try { traffic.commands.push(JSON.parse(String(event.payload))); } catch { /* Protocol-level frames have no JSON. */ }
    });
    socket.on('framereceived', event => {
      let message;
      try { message = JSON.parse(String(event.payload)); } catch { return; }
      traffic.messages.push(message);
      if (message.scoreboard?._hausdepp) {
        traffic.scoreboard = message.scoreboard;
        traffic.state = message.scoreboard._hausdepp;
      }
    });
  });
  return traffic;
}

async function createCpuTable(page, traffic, { players = 2, cpu = 1 } = {}) {
  await page.goto('/hausdepp');
  await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
  await page.locator('#hausdeppCreateForm [name="name"]').fill('Browser-Stammtisch');
  await page.locator('#hausdeppCreateForm [name="players"]').selectOption(String(players));
  await page.locator('#hausdeppCreateForm [name="cpu_count"]').selectOption(String(cpu));
  await page.locator('#hausdeppCreate').click();
  await expect(page).toHaveURL(/\/hausdepp\/spiel\/[^/?]+/);
  await expect(page.locator('#hausdeppTable')).toBeVisible();
  await expect.poll(() => Boolean(traffic.state?.viewer_id && traffic.scoreboard?._started)).toBe(true);
  await expect(page.locator('#hausdeppHand .hausdepp-card[data-card-id]')).toHaveCount(traffic.state.hand.length);
  expect(traffic.state.hand.length).toBeGreaterThanOrEqual(3);
  expect(traffic.state.hand.length).toBeLessThanOrEqual(5);
  expect(traffic.state.players.filter(player => player.is_cpu)).toHaveLength(cpu);
  expect(traffic.state.players.every(player => !Object.hasOwn(player, 'hand'))).toBe(true);
  expect(traffic.state).not.toHaveProperty('deck');
  await expectDescribedPile(page, traffic.state);
  return page.url();
}

async function expectDescribedPile(page, state) {
  if (!state.discard.length) return;
  const language = await page.locator('html').getAttribute('lang');
  const [suit, rank] = state.discard.at(-1).split('-');
  const suits = language === 'en'
    ? { hearts: 'Hearts', bells: 'Bells', leaves: 'Leaves', acorns: 'Acorns' }
    : { hearts: 'Herz', bells: 'Schellen', leaves: 'Laub', acorns: 'Eichel' };
  const ranks = language === 'en' ? { U: 'Unter', O: 'Ober', K: 'King', A: 'Ace' }
    : { U: 'Unter', O: 'Ober', K: 'König', A: 'Ass' };
  const label = await page.locator('#hausdeppPile').getAttribute('aria-label');
  expect(label).toContain(suits[suit]);
  expect(label).toContain(ranks[rank] || rank);
  expect(label).toContain(`, ${state.discard.length} `);
}

async function openTableChat(page) {
  if (await page.locator('#chatToggle').getAttribute('aria-expanded') !== 'true') {
    await page.locator('#chatToggle').click();
  }
  await expect(page.locator('#chatInput')).toBeVisible();
}

async function completeRequiredDraw(page, traffic) {
  if (!traffic.state?.available_actions.includes('draw')) return;
  const before = traffic.state;
  const expectedCount = Math.min(3, before.hand.length + before.deck_count);
  expect(before.current_player_id).toBe(before.viewer_id);
  expect(before.available_actions).toEqual(['draw']);
  await page.locator('#hausdeppStock').click();
  await expect.poll(() => traffic.state?.version || 0).toBeGreaterThan(before.version);
  expect(traffic.commands.some(command => command.action === 'hausdepp_draw' && command.version === before.version)).toBe(true);
  const drawn = traffic.messages.find(message => message.scoreboard?._hausdepp?.version === before.version + 1)?.scoreboard?._hausdepp;
  expect(drawn).toBeTruthy();
  expect(drawn.pending_refill).toBeNull();
  expect(drawn.hand).toHaveLength(expectedCount);
}

async function playLegalHandCard(page, traffic) {
  // The deck is genuinely shuffled. If our opening hand is below the starter,
  // use real legal actions until the server offers a hand play.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await expect.poll(() => traffic.state?.current_player_id === traffic.state?.viewer_id).toBe(true);
    const state = traffic.state;
    if (state.available_actions.includes('play')) {
      const card = state.playable_cards[0];
      await page.locator(`#hausdeppHand [data-card-id="${card}"]`).click();
      await expect(page.locator(`#hausdeppHand [data-card-id="${card}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#hausdeppPlay')).toBeEnabled();
      await page.locator('#hausdeppPlay').click();
      await expect.poll(() => traffic.state?.version || 0).toBeGreaterThan(state.version);
      expect(traffic.commands.some(command => command.action === 'hausdepp_play'
        && command.version === state.version && command.cards?.includes(card))).toBe(true);
      expect(traffic.messages.some(message => message.scoreboard?._hausdepp?.last_event?.player_id === state.viewer_id
        && message.scoreboard._hausdepp.last_event.cards?.includes(card))).toBe(true);
      await completeRequiredDraw(page, traffic);
      return state;
    }
    await page.locator(state.available_actions.includes('gamble') ? '#hausdeppStock' : '#hausdeppPile').click();
    await expect.poll(() => traffic.state?.version || 0).toBeGreaterThan(state.version);
    await completeRequiredDraw(page, traffic);
  }
  throw new Error('The real game did not offer a legal hand play in twelve turns.');
}

for (const language of ['de', 'en']) {
  test(`${language}: founder creates a real CPU table, plays, chats, reacts and reconnects to the same seat`, async ({ page }) => {
    test.setTimeout(60000);
    await ownerSession(page, language);
    const traffic = watchGame(page);
    const room = await createCpuTable(page, traffic);
    const playerId = traffic.state.viewer_id;
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('#hausdeppStatus')).toHaveAttribute('role', 'status');
    await expect(page.locator('#hausdeppPlayers')).toContainText(/CPU/);

    await playLegalHandCard(page, traffic);
    // A ten can grant another human play; advance normally until the CPU has
    // a genuine turn. No fixture bypasses the authoritative action handler.
    for (let attempt = 0; attempt < 8 && !traffic.messages.some(message =>
      message.scoreboard?._hausdepp?.last_event?.player_id?.startsWith('cpu-')); attempt += 1) {
      if (traffic.state.current_player_id === playerId) {
        const before = traffic.state.version;
        if (traffic.state.available_actions.includes('pickup')) await page.locator('#hausdeppPile').click();
        else await playLegalHandCard(page, traffic);
        await expect.poll(() => traffic.state.version).toBeGreaterThan(before);
        await completeRequiredDraw(page, traffic);
      }
      if (traffic.state.current_player_id !== playerId) {
        await expect.poll(() => traffic.messages.some(message =>
          message.scoreboard?._hausdepp?.last_event?.player_id?.startsWith('cpu-')), { timeout: 12000 }).toBe(true);
      }
    }
    expect(traffic.messages.some(message => message.scoreboard?._hausdepp?.last_event?.player_id?.startsWith('cpu-'))).toBe(true);

    await openTableChat(page);
    const text = language === 'de' ? 'Noch eine Runde am Stammtisch!' : 'One more round at this table!';
    await page.locator('#chatInput').fill(text);
    await page.locator('#chatSend').click();
    await expect.poll(() => traffic.messages.some(message => message.chat?.text === text)).toBe(true);
    await expect(page.locator('#chatPanel')).toContainText(text);
    await page.locator('[data-hausdepp-reaction]').first().click();
    await expect.poll(() => traffic.messages.some(message => message.emoji?.from_id === playerId)).toBe(true);

    const version = traffic.state.version;
    traffic.state = null;
    await page.reload();
    await expect.poll(() => traffic.state?.viewer_id).toBe(playerId);
    expect(traffic.state.version).toBeGreaterThanOrEqual(version);
    expect(traffic.state.players).toHaveLength(2);
    await expect(page.locator('#hausdeppHand .hausdepp-card[data-card-id]')).toHaveCount(traffic.state.hand.length);
    expect(page.url()).toBe(room);
    await openTableChat(page);
    await expect(page.locator('#chatPanel')).toContainText(text);
    expect(traffic.messages.filter(message => message.error_code)).toEqual([]);
    expect(traffic.pageErrors).toEqual([]);
  });

  test(`${language}: owner lobby links reach rules, account and the suite switch`, async ({ page }) => {
    await ownerSession(page, language);
    await page.goto('/hausdepp');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('#hausdeppCreate')).toHaveText(language === 'de' ? /Platz|Tisch|Runde|Partie/ : /seat|table|round|game/i);
    await expect(page.locator('#hausdeppRounds')).toBeVisible();
    const rules = page.locator('a[href="/hausdepp/regeln"]').first();
    await rules.click();
    await expect(page).toHaveURL(/\/hausdepp\/regeln$/);
    await expect(page.locator('h1')).toContainText('Hausdepp');
    await expect(page.locator('body')).toContainText(language === 'de' ? /Nachwerfen|nachwerfen/ : /follow|throw|matching/i);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await page.goto('/hausdepp');
    const switcher = page.locator('[data-game-switch]');
    await expect(switcher).toBeVisible();
    await switcher.click();
    const menu = page.locator('#suiteGameMenu');
    await expect(menu.getByRole('link', { name: 'Hausdepp', exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'ZDWA', exact: true })).toBeVisible();
    const currentAuth = await (await page.request.get('/api/auth/me')).json();
    const access = currentAuth.game_access || currentAuth.user?.game_access || {};
    const hasZilch = access.zilch_preview || access.zilch_public;
    await expect(menu.getByRole('link', { name: 'Zilch', exact: true })).toHaveCount(hasZilch ? 1 : 0);
    if (hasZilch) await expect(menu.getByRole('link', { name: 'Zilch', exact: true })).toBeVisible();
    await page.goto('/hausdepp/konto');
    await expect(page).toHaveURL(/\/konto$/);
    await expect(page.locator('[data-account-section]')).not.toHaveCount(0);
  });
}

test('private Hausdepp pages keep guests and unrelated accounts outside the owner development build', async ({ page, browser, baseURL }) => {
  const guest = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const unrelated = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto('/hausdepp');
    await expect(guestPage).toHaveURL(/\/anmelden\?/);
    await expect(guestPage.locator('#hausdeppCreateForm')).toHaveCount(0);
    const owner = await ownerSession(page);
    const traffic = watchGame(page);
    const room = await createCpuTable(page, traffic);
    const spectatorPath = `${new URL(room).pathname}/zuschauen`;
    await guestPage.goto(spectatorPath);
    await expect(guestPage).toHaveURL(/\/anmelden\?/);
    expect(new URL(guestPage.url()).searchParams.get('return_to')).toBe(spectatorPath);
    await openPasswordLogin(guestPage, true);
    await guestPage.locator('#zilchLoginUsername').fill('Admin');
    await guestPage.locator('#zilchLoginPassword').fill('temporary-password-123');
    await guestPage.locator('#zilchLoginForm button[type="submit"]').click();
    await expect(guestPage).toHaveURL(new URL(spectatorPath, baseURL).href);
    await expect(guestPage.locator('#hausdeppTable')).toBeVisible();
    const username = `HDGuard${Date.now()}`;
    const password = 'hausdepp-browser-password-123';
    const created = await page.request.post('/api/admin/users', {
      headers: { 'X-CSRF-Token': owner.csrf_token },
      data: { username, temporary_password: password, role: 'user' },
    });
    expect(created.status()).toBe(201);
    const login = await unrelated.request.post('/api/auth/login', { data: { username, password } });
    expect(login.ok()).toBeTruthy();
    const regularUser = (await login.json()).user;
    expect(regularUser.is_owner).toBeFalsy();
    const changed = await unrelated.request.post('/api/auth/change-password', {
      headers: { 'X-CSRF-Token': regularUser.csrf_token },
      data: { current_password: password, new_password: `${password}-final` },
    });
    expect(changed.ok()).toBeTruthy();
    expect((await unrelated.request.post('/api/auth/login', {
      data: { username, password: `${password}-final` },
    })).ok()).toBeTruthy();
    const other = await unrelated.newPage();
    for (const path of ['/hausdepp', '/hausdepp/regeln', '/hausdepp/konto', '/hausdepp/spiel/not-public', '/hausdepp/spiel/not-public/zuschauen']) {
      const denied = await other.goto(path);
      expect(denied.status()).toBe(403);
      await expect(other.locator('#hausdeppCreateForm, #hausdeppHand')).toHaveCount(0);
    }
  } finally {
    await guest.close();
    await unrelated.close();
  }
});

test('lobby and table keep mobile, tablet and desktop portrait/landscape controls reachable', async ({ page }) => {
  test.setTimeout(90000);
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  for (const [name, viewport] of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/hausdepp');
    await expect(page.locator('#hausdeppCreate')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: lobby width`).toBe(true);
    if (name.startsWith('mobile-') || name === 'narrow-mobile') {
      const input = page.locator('[data-lobby-chat-input]');
      await expect(input).toBeVisible();
      const box = await input.boundingBox();
      expect(box.width, `${name}: usable lobby composer`).toBeGreaterThan(100);
    }
    await page.goto(room);
    await expect(page.locator('#hausdeppTable')).toBeVisible();
    await expect(page.locator('#hausdeppHand .hausdepp-card').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expectDescribedPile(page, traffic.state);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: table width`).toBe(true);
    for (const selector of ['#hausdeppPlay', '#hausdeppStock', '#hausdeppPile', '#chatToggle']) {
      await expect(page.locator(selector)).toBeVisible();
      const box = await page.locator(selector).boundingBox();
      expect(box.x, `${name}: ${selector} left`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${name}: ${selector} right`).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.height, `${name}: ${selector} target`).toBeGreaterThanOrEqual(40);
    }
    if (name === 'mobile-landscape' || name === 'tablet-landscape') {
      if (traffic.state.private_peek.length && !traffic.state.peek.success) {
        await expect(page.locator('#hausdeppPeek')).not.toHaveAttribute('open', '');
      }
      const play = await page.locator('#hausdeppPlay').boundingBox();
      expect(play.y + play.height, `${name}: play remains in the first viewport`).toBeLessThanOrEqual(viewport.height + 1);
    }
  }
  expect(traffic.pageErrors).toEqual([]);
});

test('a six-seat table keeps all five opponents inside mobile and tablet widths', async ({ page }) => {
  await ownerSession(page);
  const traffic = watchGame(page);
  await createCpuTable(page, traffic, { players: 6, cpu: 5 });
  for (const [name, viewport] of VIEWPORTS.slice(0, 4)) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('#hausdeppPlayers .hd-seat')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
    for (const seat of await page.locator('#hausdeppPlayers .hd-seat').all()) {
      await expect(seat).toBeVisible();
      const box = await seat.boundingBox();
      expect(box.x, `${name}: opponent left`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${name}: opponent right`).toBeLessThanOrEqual(viewport.width + 1);
    }
    if (name === 'tablet-landscape') {
      const geometry = await page.evaluate(() => {
        const seatBottom = Math.max(...[...document.querySelectorAll('#hausdeppPlayers .hd-seat')]
          .map(seat => seat.getBoundingClientRect().bottom));
        const stockTop = document.querySelector('#hausdeppStock').getBoundingClientRect().top;
        const pileTop = document.querySelector('#hausdeppPile').getBoundingClientRect().top;
        return {
          seatBottom, stockTop, pileTop, gap: Math.min(stockTop, pileTop) - seatBottom,
          playBottom: document.querySelector('#hausdeppPlay').getBoundingClientRect().bottom,
          viewportHeight: innerHeight,
        };
      });
      expect(geometry.gap, 'tablet landscape: cards clear every opponent label by at least four pixels').toBeGreaterThanOrEqual(4);
      expect(geometry.playBottom, 'tablet landscape: six-seat play button remains visible').toBeLessThanOrEqual(viewport.height + 1);
      console.log('Hausdepp six-seat tablet landscape geometry:', JSON.stringify(geometry));
    }
  }
});

test('capture approved Hausdepp responsive review screens', async ({ page }) => {
  test.skip(process.env.HAUSDEPP_SCREENSHOTS !== '1', 'Explicit final review batch; interaction checks run first.');
  test.setTimeout(180000);
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  await mkdir('.impeccable/review', { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const capture = async name => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const url of ['/static/hausdepp/cards-source.jpg', '/static/hausdepp/card-back.png']) {
        const image = new Image();
        image.src = url;
        await image.decode();
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path: `.impeccable/review/hausdepp-${name}.png`, fullPage: true });
  };
  for (const [name, viewport] of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/hausdepp');
    await expect(page.locator('#hausdeppCreate')).toBeVisible();
    await capture(`lobby-${name}`);
    await page.goto(room);
    await expect(page.locator('#hausdeppHand .hausdepp-card').first()).toBeVisible();
    await capture(`table-${name}`);
    await page.goto('/hausdepp/regeln');
    await expect(page.locator('.hd-rulebook')).toBeVisible();
    await capture(`rules-${name}`);
  }

  await createCpuTable(page, traffic, { players: 6, cpu: 5 });
  for (const [name, viewport] of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#hausdeppPlayers .hd-seat')).toHaveCount(5);
    await capture(`six-seats-${name}`);
  }

  // Deliberately a layout-only WebSocket fixture, never a production endpoint
  // or claimed proof of a naturally reached game state. All 36 physical
  // cards are accounted for: the owner has 35, the opponent the remaining one.
  const fixture = JSON.parse(JSON.stringify(traffic.scoreboard));
  const viewerId = fixture._hausdepp.viewer_id;
  const cpu = fixture._hausdepp.players.find(player => player.is_cpu);
  const allCards = ['hearts', 'bells', 'leaves', 'acorns'].flatMap(suit =>
    ['6', '7', '8', '9', 'U', 'O', 'K', 'A', '10'].map(rank => `${suit}-${rank}`));
  const hand = allCards.filter(card => card !== 'acorns-10');
  const viewer = fixture._hausdepp.players.find(player => player.id === viewerId);
  fixture._name = 'Layouttest · grosse Hand';
  fixture._participants = fixture._participants.filter(player => [viewerId, cpu.id].includes(player.id))
    .map(player => ({ ...player, hand_count: player.id === viewerId ? 35 : 1, finished: false }));
  fixture._mode = '2';
  fixture._expected = 2;
  fixture._turn = { player_id: viewerId };
  fixture._chat_history = [];
  fixture._hausdepp = {
    ...fixture._hausdepp, phase: 'playing', current_player_id: viewerId, dealer_id: cpu.id, hand,
    players: [{ ...viewer, hand_count: 35, finished: false }, { ...cpu, hand_count: 1, finished: false }],
    discard: [], deck_count: 0, burned_count: 0, pending_refill: null, afterthrow: null,
    available_actions: ['play'], playable_cards: hand, finished_order: [], loser_id: null,
    peek: { player_id: viewerId, success: false }, private_peek: [],
    peek_information: { player_id: viewerId, success: false, cards: [] },
    last_event: { type: 'round_started' },
  };
  const fixtureRoom = page.url();
  const fixtureId = new URL(fixtureRoom).pathname.split('/').pop();
  await page.routeWebSocket(new RegExp(`/ws/${fixtureId}$`), socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action === 'join_game') socket.send(JSON.stringify({ player_id: viewerId, scoreboard: fixture }));
    });
  });
  const geometry = [];
  for (const [name, viewport] of VIEWPORTS.slice(0, 2)) {
    await page.setViewportSize(viewport);
    await page.goto(fixtureRoom);
    await expect(page.locator('#hausdeppHand .hausdepp-card')).toHaveCount(35);
    await expect(page.locator('#hausdeppRoomName')).toHaveText('Layouttest · grosse Hand');
    await capture(`large-hand-${name}`);
    geometry.push({ name, ...await page.locator('#hausdeppHand').evaluate(element => ({
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      bodyWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
    })) });
    await page.locator('#hausdeppHand').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await capture(`large-hand-${name}-end`);
  }
  await test.info().attach('hausdepp-large-hand-layout', {
    body: JSON.stringify(geometry, null, 2), contentType: 'application/json',
  });
});
