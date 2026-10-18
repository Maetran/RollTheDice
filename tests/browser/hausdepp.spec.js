const { test, expect } = require('@playwright/test');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
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
  await page.addInitScript(() => {
    window.hausdeppDealProbe = { created: 0, firstAt: null, lastAt: null };
    window.hausdeppMotionProbe = [];
    window.hausdeppGhostProbe = [];
    // Keep the real projection in this browser task too. Node's frame callback
    // can race another accepted CPU state between sequential DOM assertions.
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          try {
            const message = JSON.parse(event.data);
            if (message.scoreboard?._hausdepp) window.hausdeppObservedState = message.scoreboard._hausdepp;
          } catch { /* Protocol-level frames have no JSON. */ }
        });
      }
    };
    window.addEventListener('hausdepp:motion', event => {
      const source = event.detail.source === 'stock' ? document.getElementById('hausdeppStock')
        : event.detail.source === 'pile' ? document.getElementById('hausdeppPile') : null;
      const rect = source?.getBoundingClientRect();
      window.hausdeppMotionProbe.push({
        ...event.detail, observedAt: performance.now(),
        sourceBounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      });
    });
    new MutationObserver(records => {
      for (const node of records.flatMap(record => [...record.addedNodes])) {
        if (!(node instanceof Element)) continue;
        const cards = [...node.querySelectorAll('.hd-deal-card')];
        if (node.matches('.hd-deal-card')) cards.push(node);
        if (!cards.length) continue;
        window.hausdeppGhostProbe.push(...cards.map(card => ({
          ...card.dataset, width: card.offsetWidth, height: card.offsetHeight,
          hidden: card.getAttribute('aria-hidden'),
        })));
        window.hausdeppDealProbe.created += cards.filter(card => !card.dataset.motionType || card.dataset.motionType === 'deal').length;
        window.hausdeppDealProbe.firstAt ??= performance.now();
        window.hausdeppDealProbe.lastAt = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  // These scenarios verify gameplay/layout independently of the beginner offer.
  // Full offer, dismissal and tour hit tests remain in game-tours.spec.js.
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: {
    show: false, enabled: true, games: { zdwa: 'unseen', zilch: 'unseen', hausdepp: 'dismissed' },
  } }));
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

async function createCpuTable(page, traffic, { players = 2, cpu = 1, resolvePeek = true } = {}) {
  await page.goto('/hausdepp');
  await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
  await expect(page.locator('#hausdeppCreateForm [name="name"]')).toHaveCount(0);
  await page.locator('#hausdeppCreateForm [name="players"]').selectOption(String(players));
  await page.locator('#hausdeppCreateForm [name="cpu_count"]').selectOption(String(cpu));
  const commandsBefore = traffic.commands.length;
  traffic.state = null;
  traffic.scoreboard = null;
  traffic.tableStart = { commands: commandsBefore, messages: traffic.messages.length };
  await page.locator('#hausdeppCreate').click();
  await expect(page).toHaveURL(/\/hausdepp\/spiel\/[^/?]+/);
  await expect(page.locator('#hausdeppTable')).toBeVisible();
  await expect.poll(() => Boolean(traffic.state?.viewer_id && traffic.scoreboard?._started)).toBe(true);
  // The first dealer is random; with two seats either the viewer or the CPU peeks.
  if (players === 2 && traffic.state.peek.player_id !== traffic.state.viewer_id) {
    expect(traffic.state.players.find(player => player.id === traffic.state.peek.player_id)?.is_cpu).toBe(true);
  } else if (players === 2) {
    expect(traffic.state.phase).toBe('peeking');
    expect(traffic.state.peek.player_id).toBe(traffic.state.viewer_id);
    expect(traffic.state.hand).toEqual([]);
    expect(traffic.state.discard).toEqual([]);
    expect(traffic.state.deck_count).toBe(36);
    expect(traffic.state.available_actions).toEqual(['peek']);
    expect(traffic.commands.slice(commandsBefore).filter(command => command.action === 'hausdepp_peek')).toEqual([]);
  }
  if (!resolvePeek) return page.url();
  await completeActivePeek(page, traffic);
  await expect(page.locator('#hausdeppHand .hausdepp-card[data-card-id]')).toHaveCount(traffic.state.hand.length);
  expect(traffic.state.hand.length).toBeGreaterThanOrEqual(3);
  expect(traffic.state.hand.length).toBeLessThanOrEqual(5);
  expect(traffic.state.players.filter(player => player.is_cpu)).toHaveLength(cpu);
  expect(traffic.state.players.every(player => !Object.hasOwn(player, 'hand'))).toBe(true);
  expect(traffic.state).not.toHaveProperty('deck');
  await expectDescribedPile(page);
  return page.url();
}

async function createViewerPeekTable(page, traffic) {
  // The first dealer is random; open tables until the viewer is the one who peeks.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const room = await createCpuTable(page, traffic, { resolvePeek: false });
    if (traffic.state.peek.player_id === traffic.state.viewer_id) return room;
  }
  throw new Error('No table with the viewer as peeker after 12 random deals');
}

async function completeActivePeek(page, traffic, { expectMotion } = {}) {
  expectMotion ??= await page.evaluate(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  for (let inspected = 0; traffic.state?.phase === 'peeking' && inspected < 5; inspected += 1) {
    if (!traffic.state.available_actions.includes('peek')) break;
    const before = traffic.state;
    await expect(page.locator('#hausdeppStock')).toBeEnabled();
    await page.locator('#hausdeppStock').click();
    await expect.poll(() => traffic.state?.version || 0).toBeGreaterThan(before.version);
    expect(traffic.commands.some(command => command.action === 'hausdepp_peek' && command.version === before.version)).toBe(true);
    if (traffic.state.phase === 'peeking') {
      expect(traffic.state.private_peek).toHaveLength((before.private_peek?.length || 0) + 1);
      expect(traffic.state.private_peek.at(-1).endsWith('-A')).toBe(true);
      expect(traffic.state.peek.success).toBeNull();
      expect(traffic.state.peek.cards || []).toEqual([]);
      expect(traffic.state.hand).toEqual([]);
      expect(traffic.state.discard).toEqual([]);
      await expect(page.locator('#hausdeppPeekContinue')).toBeVisible();
    }
  }
  await expect.poll(() => traffic.state?.phase, { timeout: 12000 }).toBe('playing');
  expect(traffic.state.peek.complete).toBe(true);
  if (expectMotion) {
    await expect.poll(() => page.evaluate(() => window.hausdeppDealProbe.created)).toBeGreaterThan(0);
    // Later CPU plays can already be resting on the table. This helper checks
    // the initial deal; public play/burn cleanup has its own motion contracts.
    // A successful cut is first shown to everyone (about 2.2 s), then dealt.
    const revealed = traffic.state.peek.success ? 2300 : 0;
    await expect(page.locator('.hd-deal-card[data-motion-type="deal"]')).toHaveCount(0, { timeout: 1700 + revealed });
  }
}

async function expectNaturalSortedHand(page) {
  const hand = page.locator('#hausdeppHand .hd-hand-fan button.hausdepp-card');
  await expect(page.locator('#hausdeppPlay, .hd-card-index')).toHaveCount(0);
  const cards = await hand.evaluateAll(elements => elements.map(element => ({
    id: element.dataset.cardId,
    angle: parseFloat(element.style.getPropertyValue('--fan-angle')),
    text: element.textContent.trim(),
    pressed: element.getAttribute('aria-pressed'),
    width: element.offsetWidth, height: element.offsetHeight,
    viewBox: element.querySelector('svg.hd-card-art')?.getAttribute('viewBox'),
    clipRadius: Number(element.querySelector('clipPath rect')?.getAttribute('rx')),
  })));
  const ranks = ['6', '7', '8', '9', 'U', 'O', 'K', 'A', '10'];
  const values = cards.map(card => ranks.indexOf(card.id.split('-')[1]));
  expect(values).toEqual([...values].sort((a, b) => a - b));
  expect(cards.every(card => card.text === '' && card.pressed === null)).toBe(true);
  for (const card of cards) {
    expect(Math.abs(card.height / card.width - 57 / 36), `${card.id}: original card aspect`).toBeLessThan(.02);
    expect(card.viewBox, `${card.id}: normalized upright card viewport`).toBe('0 0 360 570');
    expect(card.clipRadius, `${card.id}: paper corners clip away photographed table edges`).toBeGreaterThan(0);
  }
  if (cards.length > 1) {
    expect(cards[0].angle).toBeLessThan(0);
    expect(cards.at(-1).angle).toBeGreaterThan(0);
  }
}

async function expectOpponentHands(page, state, name = 'table') {
  // WebSocket delivery and the app's renderState run synchronously in one task.
  // Read that projection and all corresponding DOM evidence together, so a
  // later refill cannot turn an exact count assertion into a stale-state wait.
  const evidence = await page.evaluate(expected => {
    const projection = expected || window.hausdeppObservedState;
    if (!projection) throw new Error('No observed Hausdepp projection for opponent hand checks');
    return {
      version: projection.version, viewportWidth: innerWidth,
      seatCount: document.querySelectorAll('#hausdeppPlayers .hd-seat').length,
      opponents: projection.players.filter(player => player.id !== projection.viewer_id).map(opponent => {
        const seat = document.querySelector(`.hd-seat[data-player-id="${CSS.escape(opponent.id)}"]`);
        const hand = seat?.querySelector(`.hd-opponent-hand[data-player-hand="${CSS.escape(opponent.id)}"]`);
        const bounds = hand?.getBoundingClientRect();
        return {
          opponent, exists: Boolean(hand), count: hand?.getAttribute('data-card-count'),
          backCount: hand?.querySelectorAll('.hd-opponent-card').length,
          privateFaceCount: hand?.querySelectorAll('[data-card-id], svg:not(.hd-seat-avatar svg), img:not(.hd-seat-avatar img)').length,
          hidden: hand?.getAttribute('aria-hidden'), label: seat?.getAttribute('aria-label'),
          geometry: [...(hand?.querySelectorAll('.hd-opponent-card') || [])].map(card => ({
            width: card.offsetWidth, height: card.offsetHeight,
            background: getComputedStyle(card).backgroundImage, text: card.textContent.trim(),
          })),
          bounds: bounds && { x: bounds.x, width: bounds.width, height: bounds.height },
        };
      }),
    };
  }, state);
  expect(evidence.seatCount, `${name}: one seat for every projected opponent`).toBe(evidence.opponents.length);
  for (const item of evidence.opponents) {
    const { opponent } = item;
    const count = Number(opponent.hand_count || 0);
    expect(item.exists, `${name}: ${opponent.name} hand exists`).toBe(true);
    expect(item.count, `${name}: ${opponent.name} hand at version ${evidence.version}`).toBe(String(count));
    expect(item.backCount, `${name}: one back for each real card`).toBe(count);
    // Account avatars and the computer's neutral card icon belong to the
    // identity badge. Every other descendant must remain a private card back.
    expect(item.privateFaceCount).toBe(0);
    expect(item.hidden).toBe('true');
    expect(item.label).toContain(opponent.name);
    if (!opponent.finished) expect(item.label).toContain(String(count));
    if (count) {
      for (const card of item.geometry) {
        expect(Math.abs(card.height / card.width - 57 / 36), `${name}: opponent native card proportions`).toBeLessThan(.04);
        expect(card.background).toContain('card-back');
        expect(card.text).toBe('');
      }
      expect(item.bounds.width, `${name}: opponent fan remains visible`).toBeGreaterThan(0);
      expect(item.bounds.height, `${name}: opponent fan remains visible`).toBeGreaterThan(0);
      expect(item.bounds.x, `${name}: opponent fan starts in viewport`).toBeGreaterThanOrEqual(-1);
      expect(item.bounds.x + item.bounds.width, `${name}: opponent fan ends in viewport`).toBeLessThanOrEqual(evidence.viewportWidth + 1);
    }
  }
}

async function expectMotionTransfer(page, expected) {
  await expect.poll(async () => page.evaluate(wanted => window.hausdeppMotionProbe.some(motion =>
    Object.entries(wanted).every(([key, value]) => motion[key] === value)), expected)).toBe(true);
  const motion = await page.evaluate(wanted => [...window.hausdeppMotionProbe].reverse().find(item =>
    Object.entries(wanted).every(([key, value]) => item[key] === value)), expected);
  expect(motion.count).toBeGreaterThan(0);
  return motion;
}

async function expectReachableFan(page, name) {
  const geometry = await page.locator('#hausdeppHand').evaluate(container => {
    const clip = container.getBoundingClientRect();
    return [...container.querySelectorAll('button.hausdepp-card')].map(card => {
      const box = card.getBoundingClientRect();
      const left = Math.max(0, clip.left, box.left);
      const right = Math.min(innerWidth, clip.right, box.right);
      const top = Math.max(0, clip.top, box.top);
      const bottom = Math.min(innerHeight, clip.bottom, box.bottom);
      if (right - left < 2 || bottom - top < 2) return null;
      let widest = 0;
      for (let y = top + 4; y < bottom - 4; y += 8) {
        let run = 0;
        for (let x = left + 1; x < right; x += 2) {
          if (document.elementFromPoint(x, y)?.closest('button[data-card-id]') === card) {
            run += 2;
            widest = Math.max(widest, run);
          } else run = 0;
        }
      }
      return { id: card.dataset.cardId, hitWidth: widest, visibleHeight: bottom - top };
    }).filter(Boolean);
  });
  expect(geometry.length, `${name}: at least one visible hand card`).toBeGreaterThan(0);
  for (const card of geometry) {
    // Measure the exposed strip of the overlapping fan, not the misleading
    // full bounding box of a card hidden behind its neighbour.
    expect(card.hitWidth, `${name}: ${card.id} exposed tap width`).toBeGreaterThanOrEqual(40);
    expect(card.visibleHeight, `${name}: ${card.id} visible tap height`).toBeGreaterThanOrEqual(44);
  }
  return geometry;
}

async function expectDescribedPile(page) {
  // Read the label with the projection it was rendered from in one task; the
  // Node-side copy can already hold the next CPU play.
  const { discard, label, language } = await page.evaluate(() => {
    if (!window.hausdeppObservedState) throw new Error('No observed Hausdepp projection for the pile label');
    return {
      discard: window.hausdeppObservedState.discard,
      label: document.getElementById('hausdeppPile').getAttribute('aria-label'),
      language: document.documentElement.lang,
    };
  });
  if (!discard.length) return;
  const [suit, rank] = discard.at(-1).split('-');
  const suits = language === 'en'
    ? { hearts: 'Hearts', bells: 'Bells', leaves: 'Leaves', acorns: 'Acorns' }
    : { hearts: 'Herz', bells: 'Schellen', leaves: 'Laub', acorns: 'Eichel' };
  const ranks = language === 'en' ? { U: 'Unter', O: 'Ober', K: 'King', A: 'Ace' }
    : { U: 'Unter', O: 'Ober', K: 'König', A: 'Ass' };
  expect(label).toContain(suits[suit]);
  expect(label).toContain(ranks[rank] || rank);
  expect(label).toContain(`, ${discard.length} `);
}

async function openTableChat(page) {
  if (await page.locator('#chatToggle').getAttribute('aria-expanded') !== 'true') {
    await page.locator('#chatToggle').click();
  }
  await expect(page.locator('#chatInput')).toBeVisible();
}

async function completeRequiredDraw(page, traffic) {
  if (traffic.state?.pending_refill && !traffic.state.available_actions.includes('draw')) {
    // A preceding player's refill has priority over this player's stock tap.
    // The CPU must settle its earlier debt without moving the active turn.
    await expect.poll(() => traffic.state?.available_actions.includes('draw') || !traffic.state?.pending_refill,
      { timeout: 12000 }).toBe(true);
  }
  if (!traffic.state?.available_actions.includes('draw')) return;
  const before = traffic.state;
  expect(before.pending_refill?.player_id).toBe(before.viewer_id);
  expect(before.available_actions).not.toContain('gamble');
  // The due refill is tapped automatically; a manual tap is never needed.
  const states = () => traffic.messages.slice(traffic.tableStart?.messages)
    .map(message => message.scoreboard?._hausdepp).filter(Boolean);
  const ownDraw = state => state.last_event?.type === 'draw' && state.last_event.player_id === before.viewer_id;
  await expect.poll(() => states().some(state => state.version > before.version && ownDraw(state))).toBe(true);
  const drawn = states().find(state => state.version > before.version && ownDraw(state));
  // That tap can leave before this helper reads the due refill, so count the
  // draws sent since our previous refill was applied, not since this call.
  const previous = Math.max(0, ...states().filter(state => ownDraw(state) && state.version < drawn.version)
    .map(state => state.version));
  expect(traffic.commands.slice(traffic.tableStart?.commands).filter(command => command.action === 'hausdepp_draw'
    && command.version >= previous && command.version < drawn.version)).toHaveLength(1);
  expect(drawn.pending_refill).toBeNull();
  expect(drawn.hand.length === 3 || drawn.deck_count === 0).toBe(true);
  expect(drawn.hand.length).toBeGreaterThan(before.hand.length);
}

async function playLegalHandCard(page, traffic) {
  // The deck is genuinely shuffled. If our opening hand is below the starter,
  // use real legal actions until the server offers a hand play.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await completeRequiredDraw(page, traffic);
    await expect.poll(() => traffic.state?.current_player_id === traffic.state?.viewer_id).toBe(true);
    await completeRequiredDraw(page, traffic);
    const state = traffic.state;
    if (state.available_actions.includes('play')) {
      const card = state.playable_cards[0];
      await page.locator(`#hausdeppHand [data-card-id="${card}"]`).click();
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

function labelledUiFixture(scoreboard, name, hand) {
  // Renderer-only evidence. Real authority/privacy/rules use the live game
  // flows above and the backend's two-account transport tests.
  const fixture = JSON.parse(JSON.stringify(scoreboard));
  const viewerId = fixture._hausdepp.viewer_id;
  const viewer = fixture._hausdepp.players.find(player => player.id === viewerId);
  const cpu = fixture._hausdepp.players.find(player => player.is_cpu);
  fixture._name = `UI-Test · ${name}`;
  fixture._participants = fixture._participants.filter(player => [viewerId, cpu.id].includes(player.id))
    .map(player => ({ ...player, hand_count: player.id === viewerId ? hand.length : 1, finished: false }));
  fixture._mode = '2';
  fixture._expected = 2;
  fixture._turn = { player_id: viewerId };
  fixture._chat_history = [];
  fixture._paused = false;
  fixture._hausdepp = {
    ...fixture._hausdepp, phase: 'playing', current_player_id: viewerId, dealer_id: cpu.id, hand,
    players: [{ ...viewer, hand_count: hand.length, finished: false }, { ...cpu, hand_count: 1, finished: false }],
    discard: [], deck_count: 0, burned_count: 0, pending_refill: null, pending_refills: [], afterthrow: null,
    available_actions: ['play'], playable_cards: hand, finished_order: [], loser_id: null,
    draw_required: false, draw_urgent: false, stock_blocked_by: null, deal: null,
    peek: { player_id: viewerId, success: false, complete: true }, private_peek: [],
    peek_information: { player_id: viewerId, success: false, complete: true, cards: [] },
    last_event: { type: 'round_started' },
  };
  return fixture;
}

async function installUiFixture(page, room, initial, onCommand) {
  let fixture = initial;
  const commands = [];
  let activeSocket;
  let connections = 0;
  const roomId = new URL(room).pathname.split('/').pop();
  await page.routeWebSocket(new RegExp(`/ws/${roomId}$`), socket => {
    activeSocket = socket;
    connections += 1;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action === 'join_game') {
        socket.send(JSON.stringify({ player_id: fixture._hausdepp.viewer_id, scoreboard: fixture }));
      } else {
        commands.push(message);
        onCommand?.({ message, socket, fixture });
      }
    });
  });
  return {
    commands,
    get connections() { return connections; },
    closeConnection: options => activeSocket.close(options),
    setSnapshot: value => { fixture = value; },
    sendSnapshot: value => { fixture = value; activeSocket.send(JSON.stringify({ scoreboard: value })); },
  };
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
    await expect(page.locator('#hausdeppPlayers')).toContainText(traffic.state.players.find(player => player.is_cpu).name);
    await expectNaturalSortedHand(page);
    await expectOpponentHands(page, null, language);

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
    await expect(page.locator('.hd-deal-card[data-motion-type="deal"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.hausdeppDealProbe.created)).toBe(0);
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
    await expect(page).toHaveURL(/\/hausdepp\/konto$/);
    await expect(page.locator('#hausdeppAccountStats')).toBeVisible();
    await expect(page.locator('#hausdeppHistory')).toBeVisible();
  });
}

test('active bottom peek stays private, requires a designated player tap, and deals once with short motion', async ({ page, context }) => {
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createViewerPeekTable(page, traffic);
  const firstVersion = traffic.state.version;
  const spectator = await context.newPage();
  const watching = watchGame(spectator);
  try {
    await spectator.goto('/hausdepp/regeln');
    await spectator.evaluate(roomId => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      window.peekAuditSocket = new WebSocket(`${protocol}//${location.host}/ws/${roomId}`);
      window.peekAuditSocket.addEventListener('open', () => window.peekAuditSocket.send(JSON.stringify({
        action: 'spectate_game', name: 'Private browser observation',
      })));
    }, new URL(room).pathname.split('/').pop());
    await expect.poll(() => watching.state?.phase).toBe('peeking');
    expect(watching.state.viewer_id).toBeNull();
    expect(watching.state.available_actions).toEqual([]);
    expect(watching.state.private_peek).toEqual([]);
    await spectator.evaluate(version => window.peekAuditSocket.send(JSON.stringify({
      action: 'hausdepp_peek', version, command_id: 'spectator-peek-audit',
    })), firstVersion);
    await expect.poll(() => watching.messages.some(message => message.error)).toBe(true);
    expect(traffic.state.phase).toBe('peeking');
    expect(traffic.state.version).toBe(firstVersion);
    await completeActivePeek(page, traffic);
    await expect.poll(() => watching.state?.phase).toBe('playing');
    for (const message of watching.messages) {
      const state = message.scoreboard?._hausdepp;
      if (!state) continue;
      expect(state.private_peek).toEqual([]);
      expect(state.hand).toEqual([]);
      if (!state.peek.success) {
        expect(state.peek.cards || []).toEqual([]);
        expect(state.peek_information.cards).toEqual([]);
      }
    }
    const motion = await page.evaluate(() => ({
      ...window.hausdeppDealProbe, elapsed: performance.now() - window.hausdeppDealProbe.firstAt,
    }));
    expect(motion.created).toBe(traffic.state.deal.sequence.length);
    // The deal stays short; a successful cut is shown to everyone first.
    expect(motion.elapsed).toBeLessThan(1500 + (traffic.state.peek.success ? 2300 : 0));
    await page.reload();
    await expect(page.locator('#hausdeppHand .hausdepp-card')).not.toHaveCount(0);
    await expect(page.locator('.hd-deal-card[data-motion-type="deal"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.hausdeppDealProbe.created)).toBe(0);
  } finally {
    await spectator.evaluate(() => window.peekAuditSocket?.close()).catch(() => {});
    await spectator.close();
  }
});

test('public discovery admits guests while signed-in accounts keep private play and progress', async ({ page, browser, baseURL }) => {
  const guest = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const unrelated = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto('/hausdepp');
    await expect(guestPage).toHaveURL(/\/hausdepp$/);
    await expect(guestPage.locator('#hausdeppSignIn')).toBeVisible();
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
    const regularTraffic = watchGame(other);
    for (const path of ['/hausdepp', '/hausdepp/regeln', '/hausdepp/konto', '/hausdepp/rangliste']) {
      const response = await other.goto(path);
      expect(response.status()).toBe(200);
      await expect(other.locator('#hausdeppApp')).toBeVisible();
    }
    await other.goto('/hausdepp');
    await expect(other.locator('#hausdeppCreateForm')).toBeVisible();
    await other.locator('#hausdeppCreate').click();
    await expect(other).toHaveURL(/\/hausdepp\/spiel\/[^/]+$/);
    await expect.poll(() => regularTraffic.state?.viewer_id).toBeTruthy();
    await expect(other.locator('#hausdeppTable')).toHaveAttribute('data-phase', /^(peeking|playing)$/);
    // The random first dealer can make the computer peek or play first. Check
    // that stock input follows this viewer's real permissions in either case.
    await expect.poll(async () => {
      const allowed = regularTraffic.state.available_actions.some(action => ['peek', 'draw', 'gamble'].includes(action));
      return await other.locator('#hausdeppStock').isEnabled() === allowed;
    }).toBe(true);
    for (const path of ['/hausdepp/spiel/not-public', '/hausdepp/spiel/not-public/zuschauen']) {
      const missing = await other.goto(path);
      expect(missing.status()).toBe(404);
      await expect(other.locator('#hausdeppHand')).toHaveCount(0);
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
    await expectDescribedPile(page);
    await expectNaturalSortedHand(page);
    await expectOpponentHands(page, null, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: table width`).toBe(true);
    for (const selector of ['#hausdeppStock', '#hausdeppPile', '#chatToggle']) {
      await expect(page.locator(selector)).toBeVisible();
      const box = await page.locator(selector).boundingBox();
      expect(box.x, `${name}: ${selector} left`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${name}: ${selector} right`).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.height, `${name}: ${selector} target`).toBeGreaterThanOrEqual(40);
    }
    if (viewport.height > viewport.width) await page.locator('#hausdeppHand').scrollIntoViewIfNeeded();
    await expectReachableFan(page, name);
    if (name === 'mobile-landscape' || name === 'tablet-landscape') {
      const layout = await page.locator('#hausdeppTable').evaluate(table => ({
        table: { top: table.getBoundingClientRect().top, bottom: table.getBoundingClientRect().bottom },
        rows: getComputedStyle(table).gridTemplateRows,
        children: [...table.children].map(element => ({
          name: element.id || element.className, top: element.getBoundingClientRect().top,
          bottom: element.getBoundingClientRect().bottom, height: element.getBoundingClientRect().height,
          row: getComputedStyle(element).gridRow,
        })),
        viewportHeight: innerHeight,
      }));
      console.log(`Hausdepp ${name} table geometry:`, JSON.stringify(layout));
      const hand = await page.locator('#hausdeppHand').boundingBox();
      expect(hand.y + hand.height, `${name}: hand remains in the first viewport`).toBeLessThanOrEqual(viewport.height + 1);
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
    await expectOpponentHands(page, null, `six-seat ${name}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
    for (const seat of await page.locator('#hausdeppPlayers .hd-seat').all()) {
      await expect(seat).toBeVisible();
      const box = await seat.boundingBox();
      expect(box.x, `${name}: opponent left`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${name}: opponent right`).toBeLessThanOrEqual(viewport.width + 1);
    }
    if (name === 'tablet-landscape') {
      const geometry = await page.evaluate(() => {
        const seats = [...document.querySelectorAll('#hausdeppPlayers .hd-seat')]
          .map(seat => seat.getBoundingClientRect());
        const controls = ['#hausdeppStock', '#hausdeppPile']
          .map(selector => document.querySelector(selector).getBoundingClientRect());
        return {
          overlap: seats.some(seat => controls.some(card => seat.left < card.right - 1
            && seat.right > card.left + 1 && seat.top < card.bottom - 1 && seat.bottom > card.top + 1)),
          handBottom: document.querySelector('#hausdeppHand').getBoundingClientRect().bottom,
          viewportHeight: innerHeight,
        };
      });
      console.log('Hausdepp six-seat tablet landscape geometry:', JSON.stringify(geometry));
      expect(geometry.overlap, 'tablet landscape: semicircle seats leave both piles clear').toBe(false);
      expect(geometry.handBottom, 'tablet landscape: six-seat hand remains visible').toBeLessThanOrEqual(viewport.height + 1);
    }
  }
});

test('labelled six-seat tournament keeps long prefixes clear of both piles', async ({ page }) => {
  test.setTimeout(60000);
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic, { players: 6, cpu: 5 });
  const fixture = structuredClone(traffic.scoreboard);
  fixture._name = 'UI-Test · Turnier mit sieben Buchstaben';
  fixture._hausdepp_tournament = {
    id: 'labelled-prefix-layout', round_number: 43, target_word: 'HAUSDEPP', completed: false,
    letters: Object.fromEntries(fixture._hausdepp.players.map(player => [player.id, 'HAUSDEP'])),
    losses: Object.fromEntries(fixture._hausdepp.players.map(player => [player.id, 7])),
    round_complete: false, can_start_next_round: false, tages_hausdepp_id: null,
  };
  await installUiFixture(page, room, fixture);
  for (const [name, viewport] of [VIEWPORTS[6], VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[3]]) {
    await page.setViewportSize(viewport);
    await page.goto(room);
    await expect(page.locator('.hd-seat .hd-tournament-prefix')).toHaveCount(5);
    const overlapping = await page.evaluate(() => {
      const seats = [...document.querySelectorAll('.hd-seat')].map(node => node.getBoundingClientRect());
      const piles = ['hausdeppStock', 'hausdeppPile'].map(id => document.getElementById(id).getBoundingClientRect());
      return seats.some(seat => piles.some(pile => seat.left < pile.right - 1 && seat.right > pile.left + 1
        && seat.top < pile.bottom - 1 && seat.bottom > pile.top + 1));
    });
    expect(overlapping, `${name}: long tournament prefixes leave both card piles clear`).toBe(false);
  }
});

test('labelled UI fixture: FIFO stock lock leaves the next hand tappable and warns the slow drawer', async ({ page }) => {
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  const fixture = labelledUiFixture(traffic.scoreboard, 'Ziehen hat Vorrang', ['hearts-U', 'bells-A', 'leaves-10']);
  const state = fixture._hausdepp;
  const cpu = state.players.find(player => player.is_cpu);
  const debt = { player_id: cpu.id, remaining: 1, continuation: 'advance', rank: '9' };
  Object.assign(state, {
    discard: ['hearts-9'], deck_count: 25, pending_refills: [debt],
    stock_blocked_by: cpu.id, available_actions: ['play', 'pickup'],
  });
  const mocked = await installUiFixture(page, room, fixture);
  await page.goto(room);
  await expect(page.locator('#hausdeppRoomName')).toHaveText('UI-Test · Ziehen hat Vorrang');
  await expect(page.locator('#hausdeppStock')).toBeDisabled();
  await expect(page.locator('#hausdeppDrawAlert')).toBeHidden();
  const card = page.locator('#hausdeppHand [data-card-id="hearts-U"]');
  await expect(card).toBeEnabled();
  await card.click();
  await expect.poll(() => mocked.commands.length).toBe(1);
  expect(mocked.commands[0]).toMatchObject({ action: 'hausdepp_play', cards: ['hearts-U'] });

  const urgent = labelledUiFixture(traffic.scoreboard, 'Du musst ziehen', ['hearts-U', 'bells-A']);
  const own = urgent._hausdepp.viewer_id;
  const ownDebt = { player_id: own, remaining: 1, continuation: 'advance', rank: '9' };
  Object.assign(urgent._hausdepp, {
    current_player_id: cpu.id, deck_count: 25, pending_refills: [ownDebt], pending_refill: ownDebt,
    draw_required: true, draw_urgent: true, stock_blocked_by: null,
    available_actions: ['draw'], playable_cards: [],
  });
  mocked.setSnapshot(urgent);
  await page.goto(room);
  await expect(page.locator('#hausdeppDrawAlert')).toBeVisible();
  await expect(page.locator('#hausdeppDrawAlert')).toHaveText('Du musst ziehen');
  // Refilling is mandatory: the due stock tap is sent automatically, once.
  await expect.poll(() => mocked.commands.filter(command => command.action === 'hausdepp_draw').length).toBe(1);
  await expect(page.locator('#hausdeppHand button').first()).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('#hausdeppDrawAlert').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('labelled UI fixture: rapid matching taps send single cards in order without confirmation or a fixed cooldown', async ({ page }) => {
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  const fixture = labelledUiFixture(traffic.scoreboard, 'Schnell nachwerfen', ['hearts-U', 'bells-U', 'leaves-A']);
  fixture._hausdepp.deck_count = 29;
  const mocked = await installUiFixture(page, room, fixture, ({ message, socket, fixture: current }) => {
    const state = current._hausdepp;
    state.version += 1;
    if (message.action === 'hausdepp_draw') {
      // The automatic refill keeps the open afterthrow window.
      state.hand.push('acorns-6');
      state.pending_refill = null;
      state.pending_refills = [];
      state.available_actions = ['afterthrow'];
      state.last_event = { type: 'draw', player_id: state.viewer_id, drawn_count: 1 };
      socket.send(JSON.stringify({ scoreboard: current, hausdepp_command: {
        command_id: message.command_id, accepted: true, version: state.version } }));
      return;
    }
    state.hand = state.hand.filter(card => !message.cards.includes(card));
    state.discard.push(...message.cards);
    state.current_player_id = state.players.find(player => player.is_cpu).id;
    state.afterthrow = { player_id: state.viewer_id, rank: 'U' };
    state.available_actions = ['draw', 'afterthrow'];
    state.playable_cards = state.hand.filter(card => card.endsWith('-U'));
    state.last_event = { type: message.action.replace('hausdepp_', ''), player_id: state.viewer_id, cards: message.cards };
    state.pending_refill = { player_id: state.viewer_id, remaining: 3 - state.hand.length, rank: 'U', continuation: 'advance' };
    state.pending_refills = [state.pending_refill];
    socket.send(JSON.stringify({ scoreboard: current }));
    setTimeout(() => socket.send(JSON.stringify({ hausdepp_command: {
      command_id: message.command_id, accepted: true, version: state.version,
    } })), 300);
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppRoomName')).toHaveText('UI-Test · Schnell nachwerfen');
  await expect(page.locator('#hausdeppPlay')).toHaveCount(0);
  await page.locator('#hausdeppHand [data-card-id="hearts-U"]').click();
  await page.locator('#hausdeppHand [data-card-id="bells-U"]').click();
  const cardCommands = () => mocked.commands.filter(command => command.action !== 'hausdepp_draw');
  await expect.poll(() => cardCommands().length).toBe(2);
  expect(cardCommands().map(command => ({ action: command.action, cards: command.cards }))).toEqual([
    { action: 'hausdepp_play', cards: ['hearts-U'] },
    { action: 'hausdepp_afterthrow', cards: ['bells-U'] },
  ]);
  await expect(page.locator('#hausdeppHand [data-card-id$="-U"]')).toHaveCount(0);
  await expect(page.locator('#hausdeppActionError')).toBeEmpty();
});

test('labelled UI fixture: every card of a sorted 35-card fan remains reachable by horizontal hand scrolling', async ({ page }) => {
  test.setTimeout(90000);
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  const allCards = ['hearts', 'bells', 'leaves', 'acorns'].flatMap(suit =>
    ['6', '7', '8', '9', 'U', 'O', 'K', 'A', '10'].map(rank => `${suit}-${rank}`));
  const hand = allCards.filter(card => card !== 'acorns-10');
  const largeHand = labelledUiFixture(traffic.scoreboard, '35 Karten im Fächer', hand);
  const ordinaryHand = labelledUiFixture(traffic.scoreboard, 'Drei Karten und zwei volle Stapel', ['hearts-U', 'bells-U', 'leaves-A']);
  Object.assign(ordinaryHand._hausdepp, { deck_count: 20, burned_count: 5,
    discard: ['hearts-6', 'bells-7', 'leaves-8', 'acorns-9', 'hearts-O', 'bells-K', 'acorns-A'] });
  const mocked = await installUiFixture(page, room, largeHand);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [name, viewport] of [...VIEWPORTS, ['short-landscape', { width: 568, height: 320 }]]) {
    await page.setViewportSize(viewport);
    if (process.env.HAUSDEPP_READABLE_SCREENSHOTS === '1') {
      mocked.setSnapshot(ordinaryHand);
      await page.goto(room);
      await expect(page.locator('#hausdeppHand .hausdepp-card')).toHaveCount(3);
      await expect(page.locator('#hausdeppStock .hd-stock-card')).toHaveCount(20);
      await expect(page.locator('#hausdeppPile .hd-pile-edge')).toHaveCount(4);
      await page.screenshot({ path: test.info().outputPath(`readable-three-cards-${name}.png`) });
      mocked.setSnapshot(largeHand);
    }
    await page.goto(room);
    await expect(page.locator('#hausdeppHand .hausdepp-card')).toHaveCount(35);
    await expectNaturalSortedHand(page);
    const grouping = await page.locator('#hausdeppHand .hd-hand-fan').evaluate(fan => {
      const cards = [...fan.children];
      return {
        width: fan.offsetWidth,
        cardWidth: cards[0].offsetWidth,
        steps: cards.slice(1).map((card, index) => ({
          sameRank: card.dataset.cardId.split('-')[1] === cards[index].dataset.cardId.split('-')[1],
          width: card.offsetLeft - cards[index].offsetLeft,
        })),
      };
    });
    const separateRanksStep = Math.max(...grouping.steps.filter(step => !step.sameRank).map(step => step.width));
    expect(grouping.width, `${name}: equal-rank groups compact the fan`).toBeLessThan(grouping.cardWidth + (hand.length - 1) * separateRanksStep);
    for (const step of grouping.steps) {
      if (step.sameRank) {
        expect(step.width, `${name}: matching cards group together`).toBeLessThan(44);
        expect(step.width, `${name}: every matching card retains a visible edge`).toBeGreaterThanOrEqual(24);
      } else expect(step.width, `${name}: distinct ranks keep a clear step`).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
    const width = await page.locator('#hausdeppHand').evaluate(element => ({
      visible: element.clientWidth, scroll: element.scrollWidth,
    }));
    expect(width.scroll, `${name}: hand scrolls without widening the page`).toBeGreaterThan(width.visible);
    await page.locator('#hausdeppHand').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    const freshEndpoint = await page.locator('#hausdeppHand').evaluate(element => ({
      scrollLeft: element.scrollLeft, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      containerRight: element.getBoundingClientRect().right,
      lastRight: element.querySelector('.hd-hand-fan').lastElementChild.getBoundingClientRect().right,
    }));
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const url of new Set(['/static/hausdepp/cards-atlas.webp', '/static/hausdepp/card-back.webp', ...[...document.querySelectorAll('svg image')].map(image => image.getAttribute('href'))])) {
        const image = new Image(); image.src = url; await image.decode();
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const settledEndpoint = await page.locator('#hausdeppHand').evaluate(element => ({
      scrollLeft: element.scrollLeft, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      containerRight: element.getBoundingClientRect().right,
      lastRight: element.querySelector('.hd-hand-fan').lastElementChild.getBoundingClientRect().right,
    }));
    console.log(`Hausdepp ${name} fresh renderer scroll:`, JSON.stringify({ freshEndpoint, settledEndpoint }));
    for (const card of await page.locator('#hausdeppHand .hausdepp-card').all()) {
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeInViewport({ ratio: .4 });
    }
    const last = page.locator('#hausdeppHand .hausdepp-card').last();
    expect((await last.getAttribute('data-card-id')).endsWith('-10')).toBe(true);
    expect(await page.locator('#hausdeppHand').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await page.locator('#hausdeppHand').evaluate(async element => {
      element.scrollLeft = element.scrollWidth;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const measure = () => page.locator('#hausdeppHand').evaluate(element => {
      const fan = element.querySelector('.hd-hand-fan');
      const last = fan.lastElementChild;
      const rect = value => ({ left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height });
      const style = getComputedStyle(element);
      return {
        scrollLeft: element.scrollLeft, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        container: rect(element.getBoundingClientRect()), fan: rect(fan.getBoundingClientRect()),
        last: { id: last.dataset.cardId, offsetLeft: last.offsetLeft, offsetWidth: last.offsetWidth, ...rect(last.getBoundingClientRect()) },
        first: rect(fan.firstElementChild.getBoundingClientRect()),
        styles: { paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, overflowX: style.overflowX,
          scrollBehavior: style.scrollBehavior, font: style.font, fanWidth: getComputedStyle(fan).width,
          transform: getComputedStyle(last).transform },
        bodyWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight,
      };
    });
    const beforeFonts = await measure();
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const afterFonts = await measure();
    await page.locator('#hausdeppHand .hausdepp-card').first().focus();
    for (let index = 1; index < hand.length; index += 1) {
      await page.keyboard.press('Tab');
      const focused = page.locator('#hausdeppHand .hausdepp-card').nth(index);
      await expect(focused).toBeFocused();
      await expect(focused).toBeInViewport({ ratio: .9 });
      expect(await focused.evaluate(card => {
        const bounds = card.getBoundingClientRect();
        return card.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
      }), `${name}: keyboard focus exposes the individual face`).toBe(true);
    }
    await expect(last).toBeFocused();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const afterFocus = await measure();
    await test.info().attach(`hausdepp-${name}-fan-endpoint`, {
      body: JSON.stringify({ beforeFonts, afterFonts, afterFocus }, null, 2), contentType: 'application/json',
    });
    expect(afterFonts.last.right, `${name}: entire last ten fits at maximum hand scroll`).toBeLessThanOrEqual(afterFonts.container.right + 1);
    expect(afterFonts.last.left, `${name}: entire last ten starts inside hand`).toBeGreaterThanOrEqual(afterFonts.container.left - 1);
    expect(afterFonts.last.top, `${name}: entire last ten starts below hand edge`).toBeGreaterThanOrEqual(Math.max(0, afterFonts.container.top) - 1);
    expect(afterFonts.last.bottom, `${name}: entire last ten fits vertically`).toBeLessThanOrEqual(Math.min(afterFonts.container.bottom, viewport.height) + 1);
    await expect(last).toBeFocused();
    expect(afterFocus.last.right, `${name}: keyboard-focused last ten stays fully visible`).toBeLessThanOrEqual(afterFocus.container.right + 1);
    expect(afterFocus.last.bottom, `${name}: keyboard-focused ten fits vertically`).toBeLessThanOrEqual(Math.min(afterFocus.container.bottom, viewport.height) + 1);
    if (process.env.HAUSDEPP_READABLE_SCREENSHOTS === '1') {
      await page.locator('#hausdeppHand').evaluate(element => { element.scrollLeft = 0; });
      await page.locator('#hausdeppHand .hausdepp-card').first().focus();
      await page.screenshot({ path: test.info().outputPath(`readable-large-hand-${name}.png`) });
    }
  }
});

for (const language of ['de', 'en']) {
  test(`${language}: labelled UI fixture shows all 35 opponent cards as compact private backs`, async ({ page }) => {
    test.setTimeout(45000);
    await ownerSession(page, language);
    const traffic = watchGame(page);
    const room = await createCpuTable(page, traffic);
    const fixture = labelledUiFixture(traffic.scoreboard, '35 verdeckte Gegenkarten', ['hearts-6']);
    const opponent = fixture._hausdepp.players.find(player => player.is_cpu);
    opponent.hand_count = 35;
    fixture._participants.find(player => player.id === opponent.id).hand_count = 35;
    await installUiFixture(page, room, fixture);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [name, viewport] of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(room);
      await expect(page.locator('#hausdeppRoomName')).toHaveText('UI-Test · 35 verdeckte Gegenkarten');
      await expectOpponentHands(page, fixture._hausdepp, `${language} ${name}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
      const label = await page.locator(`.hd-seat[data-player-id="${opponent.id}"]`).getAttribute('aria-label');
      expect(label).toContain(language === 'de' ? '35 Karten' : '35 cards');
    }
  });
}

test('real pickup and labelled refill move native-proportion cards between the actual source and hand bounds', async ({ page }) => {
  test.setTimeout(60000);
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  const viewer = traffic.state.viewer_id;
  // Real computers may play or buy the packet first: wait until this account
  // may pick up a non-empty packet, then measure exactly the accepted pickup.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await expect.poll(() => traffic.state?.current_player_id === viewer, { timeout: 15000 }).toBe(true);
    if (traffic.state.available_actions.includes('pickup') && traffic.state.discard.length) break;
    await playLegalHandCard(page, traffic);
  }
  expect(traffic.state.available_actions).toContain('pickup');
  // Measure the pickup itself, not a wait behind a computer card still landing.
  await expect(page.locator('.hd-deal-card')).toHaveCount(0, { timeout: 5000 });
  await page.evaluate(() => { window.hausdeppMotionProbe = []; window.hausdeppGhostProbe = []; });
  const beforePickup = traffic.state.version;
  await page.locator('#hausdeppPile').click();
  await expect.poll(() => traffic.messages.some(message => message.scoreboard?._hausdepp?.version > beforePickup
    && message.scoreboard._hausdepp.last_event?.type === 'pickup'
    && message.scoreboard._hausdepp.last_event.player_id === viewer)).toBe(true);
  const pickupCount = traffic.messages.map(message => message.scoreboard?._hausdepp).find(state =>
    state?.version > beforePickup && state.last_event?.type === 'pickup' && state.last_event.player_id === viewer)
    .last_event.picked_up_count;
  const pickup = await expectMotionTransfer(page, { type: 'pickup', source: 'pile', target: `hand:${viewer}`, count: pickupCount });
  expect(pickup.reducedMotion).toBe(false);
  expect(Math.abs(pickup.to.x - pickup.from.x) + Math.abs(pickup.to.y - pickup.from.y)).toBeGreaterThan(20);
  const pickupGhosts = await page.evaluate(() => window.hausdeppGhostProbe);
  expect(pickupGhosts.filter(ghost => ghost.motionType === 'pickup')).toHaveLength(pickupCount);
  // Refill geometry uses a labelled renderer fixture: random CPU tactics can
  // grow a real hand indefinitely, so they must not decide whether this UI
  // assertion ever runs. Engine and transport tests own refill authority.
  const fixture = labelledUiFixture(traffic.scoreboard, 'Auffüllen zum Kartenfächer', ['hearts-U', 'bells-A']);
  const debt = { player_id: viewer, remaining: 1, continuation: 'advance', rank: 'U' };
  Object.assign(fixture._hausdepp, {
    deck_count: 25, pending_refill: debt, pending_refills: [debt],
    draw_required: true, draw_urgent: true, available_actions: ['draw'], playable_cards: [],
  });
  await installUiFixture(page, room, fixture, ({ message, socket, fixture: current }) => {
    const state = current._hausdepp;
    state.version += 1;
    state.hand.push('leaves-K');
    state.players.find(player => player.id === viewer).hand_count = state.hand.length;
    state.deck_count -= 1;
    state.pending_refill = null;
    state.pending_refills = [];
    state.draw_required = false;
    state.draw_urgent = false;
    state.available_actions = ['play'];
    state.playable_cards = state.hand;
    state.last_event = { type: 'draw', player_id: viewer, drawn_count: 1 };
    socket.send(JSON.stringify({ scoreboard: current, hausdepp_command: { command_id: message.command_id, accepted: true, version: state.version } }));
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppRoomName')).toHaveText('UI-Test · Auffüllen zum Kartenfächer');
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  // The mandatory refill is tapped automatically for everyone.
  const draw = await expectMotionTransfer(page, { type: 'draw', source: 'stock', target: `hand:${viewer}`, count: 1 });
  // Captions can recenter the stock when the debt clears. The flight must
  // start at the source visibly present when that animation begins.
  const visibleStock = draw.sourceBounds;
  expect(Math.abs(draw.from.x - (visibleStock.x + visibleStock.width / 2))).toBeLessThan(2);
  expect(Math.abs(draw.from.y - (visibleStock.y + visibleStock.height / 2))).toBeLessThan(2);
  const receivingHand = await page.locator('#hausdeppHand').boundingBox();
  expect(draw.to.x).toBeGreaterThanOrEqual(receivingHand.x - 1);
  expect(draw.to.x).toBeLessThanOrEqual(receivingHand.x + receivingHand.width + 1);
  expect(draw.to.y).toBeGreaterThanOrEqual(receivingHand.y - 1);
  expect(draw.to.y).toBeLessThanOrEqual(receivingHand.y + receivingHand.height + 1);
  const ghosts = await page.evaluate(() => window.hausdeppGhostProbe);
  expect(ghosts.length).toBe(draw.count);
  const drawnGhosts = ghosts.filter(ghost => ghost.motionType === 'draw' && ghost.target === `hand:${viewer}`);
  expect(drawnGhosts).toHaveLength(draw.count);
  for (const ghost of drawnGhosts) {
    expect(Math.abs(Number(ghost.sourceX) - draw.from.x)).toBeLessThan(2);
    expect(Math.abs(Number(ghost.sourceY) - draw.from.y)).toBeLessThan(2);
    expect(Number(ghost.targetX)).toBeGreaterThanOrEqual(receivingHand.x - 1);
    expect(Number(ghost.targetX)).toBeLessThanOrEqual(receivingHand.x + receivingHand.width + 1);
    expect(Number(ghost.targetY)).toBeGreaterThanOrEqual(receivingHand.y - 1);
    expect(Number(ghost.targetY)).toBeLessThanOrEqual(receivingHand.y + receivingHand.height + 1);
  }
  const motionEvidence = JSON.stringify({ fixture: 'real pickup + labelled refill', pickup, draw, ghosts }, null, 2);
  await test.info().attach('hausdepp-visible-source-and-hand-endpoints', {
    body: motionEvidence, contentType: 'application/json',
  });
  await mkdir('.impeccable/review', { recursive: true });
  await writeFile('.impeccable/review/hausdepp-hands-card-motion-metrics.json', motionEvidence);
  for (const ghost of [...pickupGhosts, ...ghosts]) {
    expect(Number(ghost.delay) + Number(ghost.duration), 'card flight completes within 900ms').toBeLessThanOrEqual(900);
    expect(ghost.hidden).toBe('true');
    expect(Math.abs(ghost.height / ghost.width - 57 / 36)).toBeLessThan(.04);
  }
  expect(traffic.pageErrors).toEqual([]);
});

test('labelled UI fixture: failed gamble travels stock to table before pickup, reduced motion uses no flying cards', async ({ page }) => {
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  const fixture = labelledUiFixture(traffic.scoreboard, 'Zocken und aufnehmen', ['hearts-U', 'bells-A', 'leaves-10']);
  Object.assign(fixture._hausdepp, { deck_count: 30, discard: ['acorns-A'], available_actions: ['play', 'pickup', 'gamble'] });
  const mocked = await installUiFixture(page, room, fixture, ({ message, socket, fixture: current }) => {
    const state = current._hausdepp;
    state.version += 1;
    state.hand.push('acorns-A', 'hearts-6');
    state.players.find(player => player.id === state.viewer_id).hand_count = state.hand.length;
    state.deck_count -= 1;
    state.discard = [];
    state.available_actions = ['play'];
    state.last_event = { type: 'gamble', player_id: state.viewer_id, cards: ['hearts-6'], success: false, picked_up_count: 2 };
    socket.send(JSON.stringify({ scoreboard: current, hausdepp_command: { command_id: message.command_id, accepted: true, version: state.version } }));
  });
  await page.goto(room);
  expect(await page.evaluate(() => window.hausdeppMotionProbe)).toEqual([]);
  await page.locator('#hausdeppStock').click();
  await expect.poll(() => mocked.commands.length).toBe(1);
  const gamble = await expectMotionTransfer(page, { type: 'gamble', source: 'stock', target: 'pile', count: 1 });
  const pickup = await expectMotionTransfer(page, { type: 'pickup', source: 'pile', target: `hand:${fixture._hausdepp.viewer_id}`, count: 2 });
  expect(pickup.delay).toBeGreaterThanOrEqual(gamble.delay + gamble.duration);
  const ghosts = await page.evaluate(() => window.hausdeppGhostProbe);
  expect(ghosts.some(card => card.motionType === 'gamble' && card.source === 'stock' && card.target === 'pile')).toBe(true);
  expect(ghosts.some(card => card.motionType === 'pickup' && card.source === 'pile' && card.target === `hand:${fixture._hausdepp.viewer_id}`)).toBe(true);
  // The failed card must first land and remain readable before pickup starts.
  expect(gamble.travel).toBeGreaterThanOrEqual(500);
  expect(gamble.rest).toBeGreaterThanOrEqual(350);
  for (const ghost of ghosts) expect(Number(ghost.delay) + Number(ghost.duration)).toBeLessThanOrEqual(1600);
  await expect(page.locator('.hd-deal-card')).toHaveCount(0, { timeout: 2000 });
  const connectionsBeforeReload = mocked.connections;
  await page.reload();
  await expect.poll(() => mocked.connections).toBeGreaterThan(connectionsBeforeReload);
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(fixture._hausdepp.hand.length);
  expect(await page.evaluate(() => window.hausdeppMotionProbe)).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const next = JSON.parse(JSON.stringify(fixture));
  next._hausdepp.version += 1;
  next._hausdepp.hand.push('leaves-K');
  next._hausdepp.players.find(player => player.id === next._hausdepp.viewer_id).hand_count = next._hausdepp.hand.length;
  next._hausdepp.last_event = { type: 'draw', player_id: next._hausdepp.viewer_id, drawn_count: 1 };
  mocked.sendSnapshot(next);
  const reduced = await expectMotionTransfer(page, { type: 'draw', source: 'stock', target: `hand:${next._hausdepp.viewer_id}` });
  expect(reduced.reducedMotion).toBe(true);
  expect(await page.evaluate(() => window.hausdeppGhostProbe)).toEqual([]);
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
  expect(traffic.pageErrors).toEqual([]);
});

test('labelled UI fixture: ACK and same-version renders preserve the receiving card and its active opacity animation', async ({ page }) => {
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  const fixture = labelledUiFixture(traffic.scoreboard, 'Ankunft bleibt erhalten', ['hearts-U', 'bells-A']);
  const own = fixture._hausdepp.viewer_id;
  const debt = { player_id: own, remaining: 1, continuation: 'replay', rank: '10' };
  Object.assign(fixture._hausdepp, {
    deck_count: 25, pending_refill: debt, pending_refills: [debt],
    draw_required: true, draw_urgent: true, available_actions: ['draw'], playable_cards: [],
  });
  let acknowledgementSent = false;
  const mocked = await installUiFixture(page, room, fixture, ({ message, socket, fixture: current }) => {
    const state = current._hausdepp;
    state.version += 1;
    state.hand.push('leaves-K');
    state.players.find(player => player.id === own).hand_count = 3;
    state.deck_count -= 1;
    state.pending_refill = null;
    state.pending_refills = [];
    state.draw_required = false;
    state.draw_urgent = false;
    state.available_actions = ['play'];
    state.playable_cards = state.hand;
    state.last_event = { type: 'draw', player_id: own, drawn_count: 1 };
    socket.send(JSON.stringify({ scoreboard: current }));
    socket.send(JSON.stringify({ hausdepp_command: { command_id: message.command_id, accepted: true, version: state.version } }));
    acknowledgementSent = true;
  });
  // The refill is tapped automatically on load: observe from the first frame.
  await page.addInitScript(own => {
    window.arrivalIdentity = {};
    window.addEventListener('hausdepp:motion', event => {
      if (event.detail.type !== 'draw' || event.detail.target !== `hand:${own}`) return;
      const node = document.querySelector('#hausdeppHand [data-card-id="leaves-K"]');
      window.arrivalIdentity.node = node;
      // Pause after the real receipt effect has been created. This makes node
      // survival through subsequent WebSocket tasks deterministic on slow CI.
      queueMicrotask(() => {
        const animation = node.getAnimations().find(item => item.effect.getKeyframes().some(frame => frame.opacity === '0'));
        window.arrivalIdentity.animation = animation;
        if (animation) {
          animation.pause();
          animation.currentTime = 0;
        }
      });
    });
  }, own);
  await page.goto(room);
  await expect(page.locator('#hausdeppRoomName')).toHaveText('UI-Test · Ankunft bleibt erhalten');
  await expect.poll(() => acknowledgementSent).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(window.arrivalIdentity.animation))).toBe(true);
  await expect(page.locator('#hausdeppHand [data-card-id="leaves-K"]')).toBeEnabled();
  const assertReceipt = async () => {
    const evidence = await page.evaluate(() => {
      const { node, animation } = window.arrivalIdentity;
      return {
        sameNode: document.querySelector('#hausdeppHand [data-card-id="leaves-K"]') === node,
        connected: node.isConnected, opacity: Number(getComputedStyle(node).opacity),
        sameAnimation: node.getAnimations().includes(animation), playState: animation.playState,
      };
    });
    expect(evidence).toMatchObject({ sameNode: true, connected: true, opacity: 0, sameAnimation: true, playState: 'paused' });
  };
  await assertReceipt();
  const sameVersion = JSON.parse(JSON.stringify(fixture));
  sameVersion._name = 'UI-Test · Ankunft bleibt erhalten · Bestätigt';
  expect(sameVersion._hausdepp.version).toBe(fixture._hausdepp.version);
  mocked.sendSnapshot(sameVersion);
  await expect(page.locator('#hausdeppRoomName')).toHaveText(sameVersion._name);
  await assertReceipt();
  await expect(page.locator('.hd-deal-card')).toHaveCount(0, { timeout: 1250 });
  await page.evaluate(() => window.arrivalIdentity.animation.finish());
  await expect(page.locator('#hausdeppHand [data-card-id="leaves-K"]')).toHaveCSS('opacity', '1');
  expect(traffic.pageErrors).toEqual([]);
});

test('labelled UI fixture: close-render-reconnect treats exactly one missed version as a quiet baseline', async ({ page }) => {
  await ownerSession(page);
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  const fixture = labelledUiFixture(traffic.scoreboard, 'Still wieder verbinden', ['hearts-U', 'bells-A']);
  fixture._hausdepp.deck_count = 25;
  fixture._hausdepp.available_actions = [];
  fixture._hausdepp.playable_cards = [];
  const mocked = await installUiFixture(page, room, fixture);
  await page.goto(room);
  await expect(page.locator('#hausdeppRoomName')).toHaveText('UI-Test · Still wieder verbinden');
  await expect.poll(() => mocked.connections).toBe(1);
  expect(await page.evaluate(() => window.hausdeppMotionProbe)).toEqual([]);
  const next = JSON.parse(JSON.stringify(fixture));
  next._hausdepp.version += 1;
  next._hausdepp.hand.push('leaves-K');
  next._hausdepp.players.find(player => player.id === next._hausdepp.viewer_id).hand_count = 3;
  next._hausdepp.deck_count -= 1;
  next._hausdepp.last_event = { type: 'draw', player_id: next._hausdepp.viewer_id, drawn_count: 1 };
  mocked.setSnapshot(next);
  mocked.closeConnection({ code: 1012, reason: 'Browser reconnect regression' });
  await expect.poll(() => mocked.connections, { timeout: 5000 }).toBe(2);
  await expect(page.locator('#hausdeppHand .hausdepp-card')).toHaveCount(3);
  expect(next._hausdepp.version - fixture._hausdepp.version).toBe(1);
  expect(await page.evaluate(() => window.hausdeppMotionProbe)).toEqual([]);
  expect(await page.evaluate(() => window.hausdeppGhostProbe)).toEqual([]);
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
  expect(traffic.pageErrors).toEqual([]);
});

async function captureCardContactSheet(page) {
    // Explicit renderer evidence: source module + shipped CSS, no product route.
    const cardModule = await readFile('frontend/hausdepp/cards.js', 'utf8');
    const { cardArt } = await import(`data:text/javascript;base64,${Buffer.from(cardModule).toString('base64')}`);
    const sheetCards = ['hearts', 'bells', 'leaves', 'acorns'].flatMap(suit =>
      ['6', '7', '8', '9', 'U', 'O', 'K', 'A', '10'].map(rank => `${suit}-${rank}`));
    await page.goto('/hausdepp/regeln');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.setContent(`<html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="/static/hausdepp.css"><style>
      body{padding:24px 30px}h1{font-size:22px;margin:0 0 6px}p{margin:0 0 18px;color:#e6c98a}
      .contact-sheet{display:grid;grid-template-columns:repeat(9,1fr);gap:14px 10px}
      figure{margin:0;display:grid;justify-items:center;gap:6px}.contact-sheet .hausdepp-card{width:124px}
      figcaption{font-size:13px;color:#f5efdf}
      </style></head><body><h1>Visuelle Kartenprüfung · alle 36 Karten</h1><p>Beschriftete Kontaktansicht für die Designprüfung · künstliche Testansicht, keine Spielseite</p><main class="contact-sheet">${sheetCards.map(card => `<figure><div class="hausdepp-card">${cardArt(card)}</div><figcaption>${card}</figcaption></figure>`).join('')}</main></body></html>`);
    await expect(page.locator('.contact-sheet .hd-card-art')).toHaveCount(36);
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const url of new Set([...document.querySelectorAll('svg image')].map(image => image.getAttribute('href')))) {
        const image = new Image(); image.src = url; await image.decode();
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await mkdir('.impeccable/review', { recursive: true });
    await page.screenshot({ path: '.impeccable/review/hausdepp-hands-all-36-card-art-contact-sheet.png', fullPage: true });
}

test('lobby demo is a compact local hand and keeps bounded card changes away from real games', async ({ page }) => {
  await ownerSession(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.install();
  const gameWrites = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/api\/games(?:\?|$|\/)/.test(request.url())) gameWrites.push(request.url());
  });
  await page.goto('/hausdepp');
  const demo = page.locator('.hd-lobby-cards');
  await expect(demo).toHaveAttribute('aria-hidden', 'true');
  await expect(demo.locator('.hausdepp-card')).toHaveCount(3);
  await expect(demo.locator('button, a')).toHaveCount(0);
  const initial = await demo.locator('[data-card-id]').evaluateAll(nodes => nodes.map(node => node.dataset.cardId));
  const geometry = await page.evaluate(() => {
    const heading = document.querySelector('.hd-welcome h1').getBoundingClientRect();
    const cards = document.querySelector('.hd-lobby-cards').getBoundingClientRect();
    return { titleRight: heading.right, cardsLeft: cards.left, cardsTop: cards.top,
      titleTop: heading.top, formTop: document.querySelector('.hd-create').getBoundingClientRect().top,
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  expect(geometry.cardsLeft).toBeGreaterThanOrEqual(geometry.titleRight);
  expect(Math.abs(geometry.cardsTop - geometry.titleTop)).toBeLessThan(85);
  expect(geometry.formTop, 'A phone can reach the start form in its first screen').toBeLessThan(500);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  await page.clock.fastForward(4500);
  await expect(demo).toHaveAttribute('data-demo-step', '1');
  expect(await demo.locator('[data-card-id]').evaluateAll(nodes => nodes.map(node => node.dataset.cardId))).not.toEqual(initial);
  for (let turn = 0; turn < 12; turn += 1) {
    await page.clock.fastForward(4100);
    const count = Number(await demo.getAttribute('data-demo-count'));
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(8);
  }
  expect(gameWrites).toEqual([]);
});

test('reduced motion leaves the lobby demonstration hand still', async ({ page }) => {
  await ownerSession(page, 'en');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/hausdepp');
  const demo = page.locator('.hd-lobby-cards');
  await expect(demo.locator('.hausdepp-card')).toHaveCount(3);
  const initial = await demo.innerHTML();
  await page.clock.fastForward(20000);
  expect(await demo.innerHTML()).toBe(initial);
  await expect(demo).not.toHaveAttribute('data-demo-step');
});

test('rotated lobby cards keep their actual outer corners inside compact windows', async ({ page }) => {
  await ownerSession(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/hausdepp');
  for (const [width, height] of [[320, 568], [390, 844], [568, 320], [740, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.hd-lobby-cards [data-card-id]')).toHaveCount(3);
    await expect.poll(() => page.locator('.hd-lobby-cards [data-card-id]').evaluateAll(cards => {
      const rects = cards.map(card => card.getBoundingClientRect());
      return Math.max(...rects.map(rect => rect.right)) <= innerWidth - 7
        && Math.min(...rects.map(rect => rect.left)) >= 7;
    }), { message: `${width}×${height}: rotated artwork keeps an eight-pixel window edge` }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});

test('seeded local demo refills only below three and throws matching pairs from one physical deck', async ({ page }) => {
  await ownerSession(page);
  await page.addInitScript(() => {
    let seed = 123456789;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  });
  await page.clock.install();
  await page.goto('/hausdepp');
  await expect(page.locator('.hd-lobby-cards')).toHaveAttribute('data-card-assets', 'ready');
  const observed = { pair: 0, pickup: 0, bulkPickup: 0, largeNoRefill: 0, refill: 0 };
  for (let turn = 0; turn < 60; turn += 1) {
    await page.clock.fastForward(4100);
    const state = await page.locator('.hd-lobby-cards').evaluate(node => ({
      action: node.dataset.demoAction, before: Number(node.dataset.demoBefore), count: Number(node.dataset.demoCount),
      topBefore: node.dataset.demoTopBefore,
      out: JSON.parse(node.dataset.demoOut), incoming: JSON.parse(node.dataset.demoIn),
      unique: Number(node.dataset.demoLedger), total: Number(node.dataset.demoLedgerSize),
      shown: [...node.querySelectorAll('[data-card-id]')].map(card => card.dataset.cardId),
    }));
    expect(state.unique).toBe(36);
    expect(state.total).toBe(36);
    expect(typeof state.topBefore).toBe('string');
    expect(new Set(state.shown).size).toBe(state.shown.length);
    expect(state.count).toBeGreaterThanOrEqual(3);
    expect(state.count).toBeLessThanOrEqual(8);
    if (state.action === 'new-round') continue;
    expect(state.count).toBe(state.before - state.out.length + state.incoming.length);
    if (state.action === 'pickup') {
      observed.pickup += 1;
      expect(state.out).toEqual([]);
      expect(state.incoming.length).toBeGreaterThanOrEqual(1);
      expect(state.incoming.length).toBeLessThanOrEqual(5);
      if (state.incoming.length >= 3) observed.bulkPickup += 1;
    } else {
      expect([1, 2]).toContain(state.out.length);
      const ranks = ['6', '7', '8', '9', 'U', 'O', 'K', 'A', '10'];
      for (const card of state.out) {
        const rank = card.split('-')[1];
        expect(!state.topBefore || rank === '10' || ranks.indexOf(rank) >= ranks.indexOf(state.topBefore.split('-')[1]),
          `${card} must legally beat or match ${state.topBefore || 'the empty table'}`).toBe(true);
      }
      if (state.out.length === 2) {
        observed.pair += 1;
        expect(state.out[0].split('-')[1]).toBe(state.out[1].split('-')[1]);
      }
      const refill = Math.max(0, 3 - (state.before - state.out.length));
      expect(state.incoming).toHaveLength(refill);
      if (state.before > 3 && state.out.length === 1) observed.largeNoRefill += 1;
      if (refill) observed.refill += 1;
    }
  }
  for (const [kind, count] of Object.entries(observed)) expect(count, `${kind} was exercised by the seeded demo`).toBeGreaterThan(0);
});

for (const language of ['de', 'en']) {
  test(`${language}: creating a table chooses a personal name without another form field`, async ({ page }) => {
    const user = await ownerSession(page, language);
    await page.goto('/hausdepp');
    await expect(page.locator('#hausdeppCreateForm [name="name"]')).toHaveCount(0);
    await page.locator('#hausdeppCreateForm [name="cpu_count"]').selectOption('0');
    const creation = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/games');
    await page.locator('#hausdeppCreate').click();
    const payload = (await creation).postDataJSON();
    expect(payload.name).toContain(user.username);
    expect(payload.name).not.toBe(user.username);
    expect([...payload.name].length).toBeLessThanOrEqual(80);
    await expect(page).toHaveURL(/\/hausdepp\/spiel\/[^/]+$/);
    await expect(page.locator('#hausdeppRoomName')).toHaveText(payload.name);
    await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  });

  test(`${language}: compact phone creation form keeps a larger hand beside the title`, async ({ page }) => {
    await ownerSession(page, language);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/hausdepp');
      await expect(page.locator('#hausdeppCreate')).toBeVisible();
      await expect(page.locator('.hd-lobby-cards')).toHaveAttribute('data-card-assets', 'ready');
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('.hd-create');
        const hand = document.querySelector('.hd-lobby-cards');
        const card = hand.querySelector('.hausdepp-card');
        const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, width: r.width, height: r.height }; };
        return { panel: rect(panel), title: rect(document.querySelector('.hd-welcome h1')), hand: rect(hand),
          cardWidth: card.offsetWidth, padding: parseFloat(getComputedStyle(panel).paddingTop),
          targets: [...panel.querySelectorAll('select, input:not([type="radio"]), button, .hd-game-format label')]
            .map(node => node.getBoundingClientRect().height),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      expect(layout.padding).toBeLessThanOrEqual(16);
      expect(layout.panel.height, `${viewport.width}: complete compact form`).toBeLessThan(750);
      expect(layout.panel.top, `${viewport.width}: start form remains close to the top`).toBeLessThan(viewport.width > viewport.height ? 250 : 530);
      expect(layout.cardWidth).toBeGreaterThanOrEqual(viewport.width > viewport.height ? 90 : 72);
      expect(layout.cardWidth / layout.hand.width, 'The hand uses its reserved upper-right space').toBeGreaterThan(.6);
      expect(layout.hand.left).toBeGreaterThanOrEqual(layout.title.right);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      for (const height of layout.targets) expect(height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('capture actual playing round tables and compact product pages', async ({ page }) => {
  test.skip(process.env.HAUSDEPP_ROUNDTABLE_CAPTURE !== '1', 'One final evidence batch after interaction checks.');
  test.setTimeout(180000);
  expect(new URL(test.info().project.use.baseURL).port).not.toBe('8000');
  await ownerSession(page);
  const traffic = watchGame(page);
  const evidence = [];
  await mkdir('.impeccable/review', { recursive: true });
  const capture = async (name, fullPage = true) => {
    if (await page.locator('#chatClose').isVisible()) await page.locator('#chatClose').click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      const sources = new Set([...document.querySelectorAll('svg image')].map(node => node.getAttribute('href')));
      for (const node of document.querySelectorAll('.hd-table-prop, .hd-table-prop-art, .hd-card-back')) {
        for (const match of getComputedStyle(node).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) sources.add(match[1]);
      }
      await Promise.all([...sources].filter(Boolean).map(async source => { const image = new Image(); image.src = source; await image.decode(); }));
      document.getElementById('hausdeppStock')?.focus({ preventScroll: true });
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const path = `.impeccable/review/hausdepp-roundtable-${name}.png`;
    await page.screenshot({ path, fullPage });
    const state = await page.locator('#hausdeppTable').count() ? traffic.state : null;
    evidence.push({ path, viewport: page.viewportSize(), phase: state?.phase,
      seats: state?.players.length, own_cards: state?.hand.length,
      scripts: await page.locator('script[src*="hausdepp.js"]').evaluateAll(nodes => nodes.map(node => node.src)) });
  };
  const sizes = [...VIEWPORTS.slice(0, 5), ['wide-desktop', { width: 1600, height: 1000 }]];
  for (const count of [3, 5, 6]) {
    const room = await createCpuTable(page, traffic, { players: count, cpu: count - 1 });
    await expect.poll(() => traffic.state?.phase).toBe('playing');
    await expect(page.locator('.hd-deal-card')).toHaveCount(0, { timeout: 3000 });
    for (const [name, viewport] of count === 6 ? [...sizes, VIEWPORTS[6]] : [sizes[0], sizes[1], sizes[4]]) {
      await page.setViewportSize(viewport);
      await page.goto(room);
      await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
      await expect(page.locator('#hausdeppHand [data-card-id]').first()).toBeVisible();
      expect(traffic.state.hand.length).toBeGreaterThanOrEqual(3);
      await capture(`real-${count}-${name}`);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [name, viewport] of [sizes[0], sizes[2], sizes[4]]) {
    await page.setViewportSize(viewport);
    for (const [section, path] of [['lobby', '/hausdepp'], ['account', '/hausdepp/konto'], ['rules', '/hausdepp/regeln']]) {
      await page.goto(path);
      await expect(page.locator('body')).not.toHaveClass(/hd-loading/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await capture(`${section}-${name}`, section !== 'rules');
    }
  }
  await writeFile('.impeccable/review/hausdepp-roundtable-evidence.json', JSON.stringify(evidence, null, 2));
});

test('capture approved Hausdepp responsive review screens', async ({ page }) => {
  test.skip(process.env.HAUSDEPP_SCREENSHOTS !== '1', 'Explicit final review batch; interaction checks run first.');
  test.setTimeout(180000);
  await ownerSession(page);
  if (process.env.HAUSDEPP_REVIEW_CONTACT_ONLY === '1') {
    await captureCardContactSheet(page);
    return;
  }
  const fanOnly = process.env.HAUSDEPP_REVIEW_FAN_ONLY === '1';
  const endpointEvidence = [];
  const traffic = watchGame(page);
  const room = await createCpuTable(page, traffic);
  await mkdir('.impeccable/review', { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fanEndpoint = () => page.locator('#hausdeppHand').evaluate(element => {
    const fan = element.querySelector('.hd-hand-fan');
    const last = fan.lastElementChild;
    const rect = value => ({ left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height });
    return {
      scrollLeft: element.scrollLeft, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      container: rect(element.getBoundingClientRect()), fan: rect(fan.getBoundingClientRect()),
      last: { id: last.dataset.cardId, offsetWidth: last.offsetWidth, offsetHeight: last.offsetHeight, ...rect(last.getBoundingClientRect()) },
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  const capture = async (name, { atFanEnd = false } = {}) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const url of new Set(['/static/hausdepp/cards-atlas.webp', '/static/hausdepp/card-back.webp', ...[...document.querySelectorAll('svg image')].map(image => image.getAttribute('href'))])) {
        const image = new Image();
        image.src = url;
        await image.decode();
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    let before;
    if (atFanEnd) {
      await page.locator('#hausdeppHand').scrollIntoViewIfNeeded();
      // Prepare the endpoint after fonts, images and viewport layout settle.
      // A screenshot of an intermediate scroll position is not tail evidence.
      await page.locator('#hausdeppHand').evaluate(async element => {
        element.scrollTo({ left: element.scrollWidth, behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      before = await fanEndpoint();
      expect(before.scrollLeft).toBeGreaterThanOrEqual(before.scrollWidth - before.clientWidth - 1);
      expect(before.last.right, `${name}: complete last ten before capture`).toBeLessThanOrEqual(before.container.right + 1);
      expect(before.last.left).toBeGreaterThanOrEqual(before.container.left - 1);
      expect(before.last.top).toBeGreaterThanOrEqual(Math.max(0, before.container.top) - 1);
      expect(before.last.bottom, `${name}: whole ten before capture`).toBeLessThanOrEqual(Math.min(before.container.bottom, before.viewport.height) + 1);
      expect(Math.abs(before.last.offsetHeight / before.last.offsetWidth - 57 / 36)).toBeLessThan(.02);
    }
    // Chromium's captureBeyondViewport mutates nested horizontal scrolling.
    // Keep full-page context screens, but record the fan's real endpoint in
    // the unchanged device viewport so that the final ten remains evidence.
    await page.screenshot({ path: `.impeccable/review/hausdepp-hands-${name}.png`, fullPage: !atFanEnd });
    if (atFanEnd) {
      const after = await fanEndpoint();
      endpointEvidence.push({ name, before, after });
      await writeFile('.impeccable/review/hausdepp-hands-large-hand-scroll-metrics.json', JSON.stringify(endpointEvidence, null, 2));
      expect(after.scrollLeft).toBeGreaterThanOrEqual(after.scrollWidth - after.clientWidth - 1);
      expect(after.last.right, `${name}: complete last ten after capture`).toBeLessThanOrEqual(after.container.right + 1);
      expect(after.last.left).toBeGreaterThanOrEqual(after.container.left - 1);
      expect(after.last.top).toBeGreaterThanOrEqual(Math.max(0, after.container.top) - 1);
      expect(after.last.bottom, `${name}: whole ten after capture`).toBeLessThanOrEqual(Math.min(after.container.bottom, after.viewport.height) + 1);
    }
  };
  for (const [name, viewport] of fanOnly ? [] : VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(room);
    await expect(page.locator('#hausdeppHand .hausdepp-card').first()).toBeVisible();
    await capture(`table-${name}`);
  }

  if (!fanOnly) await createCpuTable(page, traffic, { players: 6, cpu: 5 });
  for (const [name, viewport] of fanOnly ? [] : VIEWPORTS.slice(0, 4)) {
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
    discard: [], deck_count: 0, burned_count: 0, pending_refill: null, pending_refills: [], afterthrow: null,
    available_actions: ['play'], playable_cards: hand, finished_order: [], loser_id: null,
    draw_required: false, draw_urgent: false, stock_blocked_by: null, deal: null,
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
    await capture(`large-hand-${name}-end`, { atFanEnd: true });
  }
  await test.info().attach('hausdepp-large-hand-layout', {
    body: JSON.stringify(geometry, null, 2), contentType: 'application/json',
  });
  await writeFile('.impeccable/review/hausdepp-hands-large-hand-scroll-metrics.json', JSON.stringify(endpointEvidence, null, 2));

  if (!fanOnly) {
    const opposing = labelledUiFixture(traffic.scoreboard, '35 verdeckte Gegenkarten', ['hearts-6']);
    const opponent = opposing._hausdepp.players.find(player => player.is_cpu);
    opponent.hand_count = 35;
    opposing._participants.find(player => player.id === opponent.id).hand_count = 35;
    await installUiFixture(page, room, opposing);
    for (const [name, viewport] of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[3], VIEWPORTS[4]]) {
      await page.setViewportSize(viewport);
      await page.goto(room);
      await expect(page.locator('#hausdeppRoomName')).toHaveText('UI-Test · 35 verdeckte Gegenkarten');
      await expectOpponentHands(page, opposing._hausdepp, name);
      await capture(`large-opponent-${name}`);
    }
  }

  for (const language of fanOnly ? [] : ['de', 'en']) {
    await ownerSession(page, language);
    const peekRoom = await createCpuTable(page, traffic, { resolvePeek: false });
    await completeActivePeek(page, traffic);
    const urgent = labelledUiFixture(traffic.scoreboard, language === 'de' ? 'Du musst ziehen' : 'You must draw', ['hearts-U', 'bells-A']);
    const own = urgent._hausdepp.viewer_id;
    const cpu = urgent._hausdepp.players.find(player => player.is_cpu);
    const debt = { player_id: own, remaining: 1, continuation: 'advance', rank: '9' };
    Object.assign(urgent._hausdepp, {
      current_player_id: cpu.id, deck_count: 25, pending_refills: [debt], pending_refill: debt,
      draw_required: true, draw_urgent: true, stock_blocked_by: null,
      available_actions: ['draw'], playable_cards: [],
    });
    await installUiFixture(page, peekRoom, urgent);
    await page.goto(peekRoom);
    await expect(page.locator('#hausdeppDrawAlert')).toBeVisible();
    for (const [name, viewport] of VIEWPORTS.slice(0, 2)) {
      await page.setViewportSize(viewport);
      await capture(`urgent-refill-${language}-${name}`);
    }
  }
  if (!fanOnly) await captureCardContactSheet(page);
});
