const { test, expect } = require('@playwright/test');
const { mkdir, readFile } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

test.afterEach(async ({ page }) => {
  try {
    await page.unrouteAll({ behavior: 'wait' });
  } finally {
    await Promise.all((page.hausdeppDecorContexts || []).map(async context => {
      try {
        await Promise.all(context.pages().map(member => member.unrouteAll({ behavior: 'wait' })));
      } finally {
        await context.close();
      }
    }));
  }
});

async function table(page, viewport, { browser, baseURL, reducedMotion = 'no-preference' }) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion });
  const signedIn = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  const pages = [page];
  page.hausdeppDecorContexts = [];
  // Six real isolated human sessions let us select the actual first player
  // after the random dealer. One table is sufficient for every dealer outcome.
  const namespace = Date.now();
  for (let seat = 1; seat < 6; seat += 1) {
    const username = `Decor${namespace}${seat}`;
    const temporary = 'decor-temporary-password-123', password = 'decor-final-password-123';
    const created = await page.request.post('/api/admin/users', {
      headers, data: { username, temporary_password: temporary, role: 'user' },
    });
    expect(created.status()).toBe(201);
    const context = await browser.newContext({ baseURL, viewport, reducedMotion, serviceWorkers: 'block' });
    page.hausdeppDecorContexts.push(context);
    const member = await context.newPage();
    const login = await member.request.post('/api/auth/login', { data: { username, password: temporary } });
    expect(login.ok()).toBeTruthy();
    const initial = (await login.json()).user;
    const changed = await member.request.post('/api/auth/change-password', {
      headers: { 'X-CSRF-Token': initial.csrf_token }, data: { current_password: temporary, new_password: password },
    });
    expect(changed.ok()).toBeTruthy();
    expect((await member.request.post('/api/auth/login', { data: { username, password } })).ok()).toBeTruthy();
    pages.push(member);
  }
  const created = await page.request.post('/api/games', {
    headers, data: { name: 'Dekoration · sechs Plätze', mode: '6', game_type: 'hausdepp', play_mode: 'multiplayer', cpu_count: 0 },
  });
  expect(created.ok()).toBeTruthy();
  const gameId = (await created.json()).game_id;
  const latestByPage = new Map();
  const admissionByPage = new Map();
  const sharedByPage = new Map(), propEventsByPage = new Map();
  for (const member of pages) {
    await member.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
    // Optional beginner offers have separate coverage; the real room, private
    // projection, cards and every game command below use the delivered backend.
    await member.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
    member.on('websocket', socket => {
      if (new URL(socket.url()).pathname !== `/ws/${gameId}`) return;
      const admission = { playerId: null, room: null, closed: false };
      admissionByPage.set(member, admission);
      socket.on('close', () => { admission.closed = true; });
      socket.on('framereceived', event => {
        if (admissionByPage.get(member) !== admission) return;
        try {
          const payload = JSON.parse(String(event.payload));
          if (payload.player_id) admission.playerId = payload.player_id;
          if (payload.scoreboard) {
            admission.room = payload.scoreboard;
            if (payload.scoreboard._hausdepp_table_props) sharedByPage.set(member, payload.scoreboard._hausdepp_table_props);
          }
          if (payload.hausdepp_table_props) sharedByPage.set(member, payload.hausdepp_table_props);
          if (payload.hausdepp_table_prop) propEventsByPage.set(member, payload.hausdepp_table_prop);
          const state = payload.scoreboard?._hausdepp;
          if (state) latestByPage.set(member, state);
        } catch { /* Protocol frames carry no JSON. */ }
      });
    });
    await member.goto(`/hausdepp/spiel/${gameId}`);
    // Document load can precede account-language reload and socket admission.
    // The creator must really join first; every next human waits for their own
    // accepted ID and connected room membership, before _hausdepp exists.
    await expect.poll(() => {
      const admission = admissionByPage.get(member), id = admission?.playerId;
      return Boolean(id && !admission.closed && admission.room?._connected?.[id] === true
        && admission.room?._participants?.some(player => player.id === id && !player.is_cpu));
    }, { message: 'The real account must be admitted before opening the next player page' }).toBe(true);
  }
  await expect.poll(() => pages.filter(member => latestByPage.get(member)?.viewer_id).length).toBe(6);
  expect(new Set(pages.map(member => latestByPage.get(member).viewer_id)).size).toBe(6);
  const opening = latestByPage.get(page), ids = opening.players.map(player => player.id);
  expect(ids).toHaveLength(6);
  expect(opening.players.every(player => !player.is_cpu)).toBe(true);
  const dealer = ids.indexOf(opening.dealer_id);
  expect(dealer).toBeGreaterThanOrEqual(0);
  const viewerId = ids[(dealer + 1) % ids.length];
  const viewer = pages.find(member => latestByPage.get(member).viewer_id === viewerId);
  const peeker = pages.find(member => latestByPage.get(member).viewer_id === opening.peek.player_id);
  expect(viewer).toBeTruthy();
  expect(peeker).toBeTruthy();
  expect(viewer).not.toBe(peeker);
  await expect(viewer.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
  await expect(viewer.locator('.hd-seat')).toHaveCount(5);
  await expect(viewer.locator('#hausdeppHand [data-card-id]')).toHaveCount(0);
  // Complete the real human peek: at most four aces can precede its final card.
  // These are legal game actions, not retries or replacement random deals.
  for (let inspected = 0; inspected < 5 && latestByPage.get(peeker).phase === 'peeking'; inspected += 1) {
    const version = latestByPage.get(peeker).version;
    await expect(peeker.locator('#hausdeppStock')).toBeEnabled();
    await peeker.locator('#hausdeppStock').click();
    await expect.poll(() => latestByPage.get(peeker).version).toBeGreaterThan(version);
  }
  await expect(viewer.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  expect(latestByPage.get(viewer).current_player_id).toBe(viewerId);
  await expect(viewer.locator('.hd-seat')).toHaveCount(5);
  await expect(viewer.locator('#hausdeppHand [data-card-id]')).toHaveCount(3);
  await expect(viewer.locator('#hausdeppHand [data-card-id]').first()).toBeVisible();
  await expect(viewer.locator('#hausdeppStock')).toBeEnabled();
  viewer.hausdeppDecorPeers = pages;
  viewer.hausdeppDecorShared = sharedByPage;
  viewer.hausdeppDecorEvents = propEventsByPage;
  viewer.hausdeppDecorBoards = latestByPage;
  viewer.hausdeppDecorAdmissions = admissionByPage;
  return viewer;
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1600, height: 1000 }]) {
  test(`six-seat table decoration respects play areas at ${viewport.width}x${viewport.height}`, async ({ page, browser, baseURL }) => {
    page = await table(page, viewport, { browser, baseURL });
    const visibleProps = page.locator('.hd-table-prop:visible');
    // Phones carry one large object (two in landscape) plus a few small
    // scatter pieces; every one of them must still find free wood.
    if (viewport.width < 768) await expect.poll(() => visibleProps.count()).toBeLessThanOrEqual(4);
    else if (viewport.height < 600) await expect.poll(() => visibleProps.count()).toBeLessThanOrEqual(4);
    else {
      try { await expect.poll(() => visibleProps.count()).toBeGreaterThan(0); }
      catch (error) {
        console.log('Decor placement diagnostic', JSON.stringify(await page.evaluate(() => {
          const rect = element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
          return { table: rect(document.getElementById('hausdeppTable')), candidates: [...document.querySelectorAll('.hd-table-prop')].length,
            controls: [...document.querySelectorAll('.hd-seat, .hd-room-heading, .hd-stock-group, .hd-pile-group, .hd-burned, .hd-hand-heading, #hausdeppHand button, #hausdeppStatus, #hausdeppEvent, .hd-action-guide, #hausdeppPeek:not([hidden]), #hausdeppResult:not([hidden])')]
              .filter(element => element.getClientRects().length).map(element => [element.className || element.id, rect(element)]) };
        })));
        throw error;
      }
    }
    const geometry = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return {
        props: [...document.querySelectorAll('.hd-table-prop:not([hidden])')].map(element => ({ ...rect(element), pointerEvents: getComputedStyle(element).pointerEvents })),
        controls: [...document.querySelectorAll('.hd-seat, #hausdeppStock, #hausdeppPile, #hausdeppHand button, .hd-room-heading, .hd-hand-heading, #hausdeppStatus, #hausdeppEvent')]
          .filter(element => element.getClientRects().length).map(rect),
      };
    });
    for (const prop of geometry.props) {
      expect(prop.pointerEvents).toBe('auto');
      for (const control of geometry.controls) {
        expect(prop.left < control.right && prop.right > control.left && prop.top < control.bottom && prop.bottom > control.top).toBe(false);
      }
    }
    await expect(page.locator('#hausdeppStock')).toBeEnabled();
  });
}

test('table props retain their nodes across updates and respect reduced motion', async ({ page, browser, baseURL }) => {
  page = await table(page, { width: 1600, height: 1000 }, { browser, baseURL, reducedMotion: 'reduce' });
  const props = page.locator('.hd-table-prop:visible');
  await expect.poll(() => props.count()).toBeGreaterThan(0);
  const before = await props.evaluateAll(elements => {
    window.hausdeppDecorQaNodes = elements;
    return elements.map(element => ({ className: element.className, animations: [
      getComputedStyle(element).animationName, getComputedStyle(element.firstElementChild).animationName,
      getComputedStyle(element.firstElementChild, '::after').animationName,
    ] }));
  });
  expect(before.every(prop => prop.animations.every(animation => animation === 'none'))).toBe(true);
  // A reaction causes real server traffic without changing the round or cards.
  await page.locator('[data-hausdepp-reaction]').first().click();
  await expect(props).toHaveCount(before.length);
  expect(await props.evaluateAll(elements => elements.every((element, index) => element === window.hausdeppDecorQaNodes[index]))).toBe(true);
  expect(await props.evaluateAll(elements => elements.map(element => element.className))).toEqual(before.map(prop => prop.className));
  if (process.env.HAUSDEPP_CAPTURE === '1') {
    await mkdir('/tmp/rollthedice-playful-decor-qa', { recursive: true });
    await page.screenshot({ path: '/tmp/rollthedice-playful-decor-qa/hausdepp-table-decor-desktop.png', fullPage: true });
  }
});

// Isolated renderer fixture for deterministic object types. It creates no
// account, table, result or score; the real six-seat integration above checks
// the same delivered renderer against occupied game controls.
async function motionFixture(page, prop, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/hausdepp/regeln');
  await expect(page.locator('#hausdeppHeader .hd-header-tools')).toBeVisible();
  const [source, consumables, play, surprises, snapshots, mouse, css, consumableCss, playCss, surpriseCss] = await Promise.all([
    readFile('frontend/hausdepp/decor.js', 'utf8'),
    readFile('frontend/hausdepp/decor-consumables.js', 'utf8'),
    readFile('frontend/hausdepp/decor-play.js', 'utf8'),
    readFile('frontend/hausdepp/surprise-effects.js', 'utf8'),
    readFile('frontend/hausdepp/surprise-snapshots.js', 'utf8'),
    readFile('frontend/hausdepp/surprise-mouse.js', 'utf8'),
    readFile('frontend/styles/hausdepp-decor.css', 'utf8'),
    readFile('frontend/styles/hausdepp-decor-consumables.css', 'utf8'),
    readFile('frontend/styles/hausdepp-decor-play.css', 'utf8'),
    readFile('frontend/styles/hausdepp-surprise-effects.css', 'utf8'),
  ]);
  await page.route('**/__test__/decor.mjs', route => route.fulfill({ body: source, contentType: 'text/javascript' }));
  await page.route('**/__test__/decor-consumables.js', route => route.fulfill({ body: consumables, contentType: 'text/javascript' }));
  await page.route('**/__test__/decor-play.js', route => route.fulfill({ body: play, contentType: 'text/javascript' }));
  await page.route('**/__test__/surprise-effects.js', route => route.fulfill({ body: surprises, contentType: 'text/javascript' }));
  await page.route('**/__test__/surprise-snapshots.js', route => route.fulfill({ body: snapshots, contentType: 'text/javascript' }));
  await page.route('**/__test__/surprise-mouse.js', route => route.fulfill({ body: mouse, contentType: 'text/javascript' }));
  await page.setContent(`<style>${css}${consumableCss}${playCss}${surpriseCss}html,body{margin:0}#fixture{position:relative;width:1400px;height:900px;background:#492c1d}</style><section id="fixture" class="hd-table" aria-label="Labelled prop renderer"></section>`);
  await page.evaluate(async ({ moduleUrl, prop }) => {
    const module = await import(moduleUrl);
    const table = document.getElementById('fixture');
    window.__decorFixture = { module, table };
    for (let i = 0; i < 100; i++) {
      module.renderTableDecor(table, { gameId: `labelled-props-${i}`, roundNumber: 1, phase: 'playing' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sprite = table.querySelector(`[data-prop="${prop}"]:not([hidden])`);
      if (sprite) {
        window.__decorFixture.gameId = `labelled-props-${i}`;
        // Guarantee open space around this specific object; no production
        // placement is overridden by this component-only motion fixture.
        for (const other of table.querySelectorAll('.hd-table-prop')) if (other !== sprite) other.hidden = true;
        Object.assign(sprite.style, { left: '600px', top: '330px', width: '140px', height: '140px' });
        return;
      }
    }
    throw new Error(`Fixture could not select ${prop}`);
  }, { moduleUrl: new URL('/__test__/decor.mjs', page.url()).href, prop });
  return page.locator(`[data-prop="${prop}"]:visible`);
}

async function sharedFixture(page, prop, object) {
  await motionFixture(page, prop);
  await page.evaluate(({ prop, object }) => {
    const fixture = window.__decorFixture;
    window.__propRequests = [];
    fixture.props = { schema_version: 1, game_id: fixture.gameId, round_number: 1, revision: 0,
      server_now_ms: Date.now(), layout: { props: [prop], scatter: [], count: 1, scatter_count: 0 },
      objects: { [prop]: object } };
    if (['coin', 'coaster', 'pencil', 'die'].includes(prop)) fixture.props.layout = { props: [], scatter: [prop], count: 0, scatter_count: 1 };
    fixture.render = (objects, revision, event, extra = {}) => {
      fixture.props = { ...fixture.props, objects, revision, server_now_ms: Date.now() };
      fixture.module.renderTableDecor(fixture.table, { gameId: fixture.gameId, roundNumber: 1, phase: 'playing',
        props: fixture.props, onPropAction: gesture => { window.__propRequests.push(gesture); return true; }, ...extra });
      if (event) fixture.module.presentTableProp(fixture.table, { id: `${fixture.gameId}:1:${revision}`,
        game_id: fixture.gameId, round_number: 1, revision, object_id: prop, ...event });
    };
    fixture.render(fixture.props.objects, 0);
  }, { prop, object });
  const sprite = page.locator(`[data-prop="${prop}"]:visible`);
  await expect(sprite).toBeVisible();
  return sprite;
}

test('shared snacks wait for confirmation and hydrate used portions without replay or echo', async ({ page }) => {
  const nuts = await sharedFixture(page, 'nuts', { uses: 0, remaining: 16, total: 16, keeps_container: true });
  await nuts.click();
  await expect(nuts.locator('.hd-food-piece:not([hidden])')).toHaveCount(16);
  expect(await page.evaluate(() => window.__propRequests)).toEqual([expect.objectContaining({ object_id: 'nuts', operation: 'tap' })]);
  await page.evaluate(() => {
    const fixture = window.__decorFixture, before = fixture.props.objects.nuts;
    const after = { ...before, uses: 1, remaining: 15 };
    fixture.render({ nuts: after }, 1, { effect: 'bite', before, after });
  });
  await expect(nuts.locator('.hd-food-piece:not([hidden])')).toHaveCount(15);
  await expect(nuts).toHaveAttribute('data-last-motion', 'bite');
  await expect(nuts).toHaveAttribute('data-moving', 'false');
  await page.evaluate(() => {
    const fixture = window.__decorFixture, after = fixture.props.objects.nuts;
    fixture.module.presentTableProp(fixture.table, { game_id: fixture.gameId, round_number: 1, revision: 1,
      object_id: 'nuts', effect: 'bite', after, before: { ...after, remaining: 16 } });
  });
  await expect(nuts).toHaveAttribute('data-moving', 'false');
  expect(await page.evaluate(() => window.__propRequests.length)).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nuts.locator('.hd-food-piece:not([hidden])')).toHaveCount(15);
  await page.evaluate(() => {
    const fixture = window.__decorFixture;
    const replacement = fixture.table.cloneNode(false);
    fixture.table.replaceWith(replacement); fixture.table = replacement;
    fixture.render(fixture.props.objects, 1);
  });
  await expect(nuts.locator('.hd-food-piece:not([hidden])')).toHaveCount(15);
  await expect(nuts).not.toHaveAttribute('data-last-motion', /./);
  expect(await page.evaluate(() => window.__propRequests.length)).toBe(1);
});

test('shared spills send only completed wiping and wait for authoritative cleanup', async ({ page }) => {
  await sharedFixture(page, 'beer', { uses: 0, level: 4, fallen: false, fallen_at: 0, foam_flat: false, spill: null });
  await page.evaluate(() => {
    const fixture = window.__decorFixture, before = fixture.props.objects.beer;
    const after = { ...before, uses: 1, level: 0, foam_flat: true, spill: { id: '1:1', amount: 4, cleaned: 0 } };
    fixture.render({ beer: after }, 1, { effect: 'spill', before, after });
  });
  const patch = page.locator('.hd-prop-spill[data-source="beer"]'), cloth = patch.locator('button');
  await expect(patch).toBeVisible();
  for (let tap = 0; tap < 3; tap++) await cloth.dispatchEvent('click');
  expect(await page.evaluate(() => window.__propRequests.length)).toBe(0);
  await cloth.dispatchEvent('click');
  await expect(patch).toHaveAttribute('data-wipe-state', 'pending');
  expect(await page.evaluate(() => window.__propRequests)).toEqual([expect.objectContaining({ object_id: 'beer', operation: 'wipe' })]);
  await page.evaluate(() => {
    const fixture = window.__decorFixture, before = fixture.props.objects.beer;
    const after = { ...before, uses: 2, spill: null };
    fixture.render({ beer: after }, 2, { effect: 'wipe', before, after });
  });
  await expect(patch).toHaveCount(0);
  expect(await page.evaluate(() => window.__propRequests.length)).toBe(1);
});

test('reduced motion retains shared fallen glasses and ignores local input', async ({ page }) => {
  const beer = await sharedFixture(page, 'beer', { uses: 1, level: 0, fallen: true, fallen_at: Date.now(), foam_flat: true,
    spill: { id: '1:1', amount: 2, cleaned: 0 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(beer).toHaveAttribute('data-fallen', 'true');
  await expect(beer).toBeDisabled();
  await expect.poll(() => beer.locator('.hd-prop-art').evaluate(art => art.style.getPropertyValue('--prop-rest-angle'))).toBe('80deg');
  const cloth = page.locator('.hd-prop-cloth');
  await expect(cloth).toBeVisible(); await expect(cloth).toBeDisabled();
  await beer.dispatchEvent('click');
  expect(await page.evaluate(() => window.__propRequests.length)).toBe(0);
});

test('shared dice show the server result and stale events never reroll it', async ({ page }) => {
  const dice = await sharedFixture(page, 'dice', { uses: 0, value: null });
  await dice.click();
  await expect(dice).toHaveAttribute('data-value', '');
  await page.evaluate(() => {
    const fixture = window.__decorFixture, before = fixture.props.objects.dice;
    const after = { uses: 1, value: 5 };
    fixture.render({ dice: after }, 1, { effect: 'dice-throw', before, after });
  });
  await expect(dice).toHaveAttribute('data-value', '5');
  await expect(dice).toHaveAttribute('aria-label', /– 5$/);
  await expect(dice).toHaveAttribute('data-moving', 'false');
  await page.evaluate(() => {
    const fixture = window.__decorFixture;
    fixture.module.presentTableProp(fixture.table, { game_id: fixture.gameId, round_number: 0, revision: 99,
      object_id: 'dice', effect: 'dice-throw', before: {}, after: { value: 1 } });
    fixture.render(fixture.props.objects, 1, undefined, { interactive: false });
  });
  await expect(dice).toBeDisabled(); await dice.dispatchEvent('click');
  await expect(dice).toHaveAttribute('data-value', '5');
  expect(await page.evaluate(() => window.__propRequests.length)).toBe(1);
});

test('reusing a shared lantern snapshot never postpones its confirmed relight', async ({ page }) => {
  const lantern = await sharedFixture(page, 'lantern', { uses: 0, lit: true, relight_at: null });
  await page.clock.install();
  await page.evaluate(() => {
    const fixture = window.__decorFixture, before = fixture.props.objects.lantern;
    const after = { uses: 1, lit: false, relight_at: Date.now() + 1500 };
    fixture.render({ lantern: after }, 1, { effect: 'candle-shake-out', before, after });
  });
  await expect(lantern).toHaveAttribute('data-lit', 'false');
  await page.clock.runFor(800);
  await page.evaluate(() => {
    const fixture = window.__decorFixture;
    fixture.module.renderTableDecor(fixture.table, { gameId: fixture.gameId, roundNumber: 1, phase: 'playing', props: fixture.props });
  });
  await page.clock.runFor(750);
  await expect(lantern).toHaveAttribute('data-lit', 'true');
  expect(await page.evaluate(() => window.__propRequests.length)).toBe(0);
});

test('real accounts share ordinary table use across phone and desktop and reload the current state', async ({ page, browser, baseURL }, testInfo) => {
  page = await table(page, { width: 1600, height: 1000 }, { browser, baseURL });
  const other = page.hausdeppDecorPeers.find(peer => peer !== page);
  const shared = page.hausdeppDecorShared, events = page.hausdeppDecorEvents, boards = page.hausdeppDecorBoards;
  const admissions = page.hausdeppDecorAdmissions;
  async function reloadFresh(member) {
    const previousAdmission = admissions.get(member), previousProjection = shared.get(member);
    await member.reload();
    await expect.poll(() => {
      const admission = admissions.get(member), id = admission?.playerId;
      const room = admission?.room, projection = shared.get(member);
      return Boolean(admission && admission !== previousAdmission && !admission.closed
        && id === previousAdmission.playerId && room?._connected?.[id] === true
        && room?._participants?.some(player => player.id === id && !player.is_cpu)
        && room?._hausdepp?.phase === 'playing' && room._hausdepp.viewer_id === id
        && projection && projection !== previousProjection && projection.schema_version === 1
        && projection === room._hausdepp_table_props && projection.revision >= previousProjection.revision);
    }, { message: 'Reload must deliver a fresh admitted player and canonical prop projection' }).toBe(true);
    const state = admissions.get(member).room._hausdepp;
    expect(state.hand).toHaveLength(3);
    await expect(member.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    await expect(member.locator('#hausdeppHand [data-card-id]')).toHaveCount(state.hand.length);
    await expect(member.locator('#hausdeppHand [data-card-id]').first()).toBeVisible();
    await expect.poll(() => member.locator('.hd-table-prop:visible').count()).toBeGreaterThan(0);
    return shared.get(member);
  }
  // Start with the complete playing layout. An arrangement retained from the
  // peek phase can use wood that a fresh full hand must later reserve.
  await reloadFresh(page);
  const visible = await page.locator('.hd-table-prop:visible').evaluateAll(nodes => nodes.map(node => node.dataset.prop));
  const objectId = visible.find(id => shared.get(page).objects[id]?.remaining > 1)
    || visible.find(id => shared.get(page).objects[id] && shared.get(page).objects[id].remaining === undefined);
  expect(objectId).toBeTruthy();
  const before = structuredClone(shared.get(page).objects[objectId]);
  const version = boards.get(page).version, revision = shared.get(page).revision;
  await other.setViewportSize({ width: 390, height: 844 });
  await page.locator(`.hd-table-prop[data-prop="${objectId}"]:visible`).click();
  await expect.poll(() => shared.get(other)?.revision).toBe(revision + 1);
  await expect.poll(() => shared.get(page)?.revision).toBe(revision + 1);
  const after = structuredClone(shared.get(page).objects[objectId]);
  expect(shared.get(other).objects[objectId]).toEqual(after);
  expect(after.uses).toBe(before.uses + 1);
  if (before.remaining !== undefined) expect(after.remaining).toBe(before.remaining - 1);
  expect(boards.get(page).version).toBe(version);
  expect(events.get(other).id).toBe(events.get(page).id);
  await other.setViewportSize({ width: 1600, height: 1000 });
  const otherProjection = await reloadFresh(other);
  expect(otherProjection.objects[objectId]).toEqual(after);
  // Each display places only the objects that fit its own free wood. Every
  // ordinary prop it does place must hydrate from the fresh shared projection.
  const otherProps = await other.locator('.hd-table-prop:visible').evaluateAll(nodes => nodes.map(node => node.dataset.prop));
  const ordinaryOtherProps = otherProps.filter(id => otherProjection.objects[id]);
  expect(ordinaryOtherProps.length).toBeGreaterThan(0);
  for (const id of ordinaryOtherProps) {
    const prop = other.locator(`.hd-table-prop[data-prop="${id}"]`), canonical = otherProjection.objects[id];
    await expect(prop).toHaveAttribute('data-uses', String(canonical.uses));
    if (canonical.remaining !== undefined) await expect(prop).toHaveAttribute('data-bites', String(canonical.remaining));
    await expect(prop).not.toHaveAttribute('data-last-motion', /./);
  }
  const actorProjection = await reloadFresh(page);
  expect(actorProjection.objects[objectId]).toEqual(after);
  expect(boards.get(page).version).toBe(version);
  const hydrated = page.locator(`.hd-table-prop[data-prop="${objectId}"]`);
  await expect(hydrated).toBeVisible();
  await expect(hydrated).toHaveAttribute('data-uses', String(after.uses));
  if (after.remaining !== undefined) await expect(hydrated).toHaveAttribute('data-bites', String(after.remaining));
  await expect(hydrated).not.toHaveAttribute('data-last-motion', /./);
  testInfo.annotations.push({ type: 'shared-object', description: objectId });
  await page.screenshot({ path: testInfo.outputPath('shared-use-desktop.png'), fullPage: true });
  await other.setViewportSize({ width: 390, height: 844 });
  const closeChat = other.locator('#chatClose');
  if (await closeChat.isVisible()) await closeChat.click();
  await expect(other.locator('#chatBackdrop')).toBeHidden();
  await other.screenshot({ path: testInfo.outputPath('shared-use-phone.png'), fullPage: true });
});

async function pointerGesture(page, points, { touch = false, cancel = false } = {}) {
  if (!touch) {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 2 });
    await page.mouse.up();
    return;
  }
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
    for (const point of points.slice(1)) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

async function shakeProp(page, prop, { touch = false } = {}) {
  const box = await prop.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  const reach = Math.max(36, box.width * .3);
  await pointerGesture(page, [{ x, y }, ...Array.from({ length: 7 }, (_, index) => ({ x: x + (index % 2 ? -reach : reach), y }))], { touch });
}

async function spilledBeer(page) {
  const beer = await motionFixture(page, 'beer');
  for (let tap = 0; tap < 3; tap += 1) await beer.dispatchEvent('click');
  const patch = page.locator('.hd-prop-spill');
  await expect(patch).toHaveCount(1);
  return { beer, patch, cloth: patch.locator('button.hd-prop-cloth') };
}

async function wipeCloth(page, patch, cloth, { touch = false } = {}) {
  const box = await patch.boundingBox(), handle = await cloth.boundingBox();
  const left = box.x + box.width * .2, right = box.x + box.width * .8, y = box.y + box.height * .5;
  await pointerGesture(page, [{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    { x: handle.x + handle.width / 2 + 10, y: handle.y + handle.height / 2 + 2 },
    ...Array.from({ length: 8 }, (_, index) => ({ x: index % 2 ? left : right, y: y + (index % 3 - 1) * 8 }))], { touch });
}

test('three quick taps open a sealed can with foam and preserve its opened state across updates', async ({ page }) => {
  const can = await motionFixture(page, 'can');
  await expect(can).toHaveAttribute('data-can-state', 'sealed');
  await can.focus();
  for (const key of ['Enter', 'Space', 'Enter']) await page.keyboard.press(key);
  await expect(can).toHaveAttribute('data-can-state', 'open');
  await expect(can.locator('.hd-can-opening')).toBeVisible();
  await expect(can.locator('.hd-can-foam')).toBeVisible();
  await page.evaluate(() => {
    const { module, table, gameId } = window.__decorFixture;
    module.renderTableDecor(table, { gameId, roundNumber: 1, phase: 'playing' });
  });
  await expect(can).toHaveAttribute('data-can-state', 'open');
  await expect(can.locator('.hd-can-opening')).toBeVisible();
  await expect(can).not.toHaveAttribute('data-fallen', 'true');
});

test('a deliberate mouse shake bursts a can once and leaves a manually cleanable spill', async ({ page }) => {
  const can = await motionFixture(page, 'can');
  await expect(can).not.toHaveAttribute('data-moving', 'true');
  await shakeProp(page, can);
  await expect(can).toHaveAttribute('data-last-gesture', 'shake');
  await expect(can).toHaveAttribute('data-shake-count', '1');
  await expect(can).toHaveAttribute('data-can-state', 'burst');
  await expect(can.locator('.hd-can-burst')).toBeVisible();
  const patch = page.locator('.hd-prop-spill[data-source="can"]');
  await expect(patch).toHaveCount(1);
  await expect(patch.locator('button.hd-prop-cloth')).toBeEnabled();
});

test('dice are thrown to a random result', async ({ page }) => {
  const dice = await motionFixture(page, 'dice');
  await dice.click();
  await expect(dice).toHaveAttribute('data-last-motion', 'dice-throw');
  await expect(dice).toHaveAttribute('data-moving', 'false');
  expect(await dice.locator('.hd-prop-art').evaluate(element => Math.abs(Number(element.dataset.turn)))).toBe(180);
  await expect(dice).toHaveAttribute('aria-label', /– [1-6]$/);
});

for (const prop of ['marend', 'nuts', 'chips', 'flips', 'sweets']) {
  test(`${prop} loses individual pieces while its empty container remains on the table`, async ({ page }) => {
    const food = await motionFixture(page, prop);
    const total = Number(await food.getAttribute('data-total-bites'));
    expect(total).toBeGreaterThan(1);
    await expect(food.locator('.hd-food-piece:not([hidden])')).toHaveCount(total);
    const container = food.locator('.hd-consumable-container');
    await expect(container).toBeVisible();
    for (let remaining = total - 1; remaining >= 0; remaining -= 1) {
      await expect(food).not.toHaveAttribute('data-moving', 'true');
      await food.click();
      await expect(food).toHaveAttribute('data-bites', String(remaining));
      await expect(food.locator('.hd-food-piece:not([hidden])')).toHaveCount(remaining);
      await expect(food.locator('.hd-consumable-original')).toBeHidden();
    }
    await expect(food).toHaveAttribute('data-empty', 'true');
    await expect(food).toBeVisible();
    await expect(container).toBeVisible();
    // Server updates preserve the empty board/bowl, including every eaten piece.
    await page.evaluate(() => {
      const { module, table, gameId } = window.__decorFixture;
      module.renderTableDecor(table, { gameId, roundNumber: 1, phase: 'playing' });
    });
    await expect(food).toHaveAttribute('data-empty', 'true');
    await expect(food.locator('.hd-food-piece:not([hidden])')).toHaveCount(0);
    await expect(container).toBeVisible();
  });
}

test('a coin lands on heads or tails and says which', async ({ page }) => {
  const coin = await motionFixture(page, 'coin');
  const faces = new Set();
  for (let toss = 0; toss < 12 && faces.size < 2; toss += 1) {
    await expect(coin).not.toHaveAttribute('data-moving', 'true');
    await coin.click();
    await expect(coin).toHaveAttribute('data-last-motion', 'coin-toss');
    const face = await coin.getAttribute('data-face');
    faces.add(face);
    await expect(coin).toHaveAttribute('aria-label', face === 'heads' ? /Kopf$/ : /Zahl$/);
    await expect(coin.locator(face === 'heads' ? '.hd-coin-heads' : '.hd-coin-tails')).toBeVisible();
  }
  expect(faces).toEqual(new Set(['heads', 'tails']));
});

for (const prop of ['beer', 'tea', 'lemonade']) {
  test(`${prop} visibly empties with four calm sips and can be refilled`, async ({ page }) => {
    await page.clock.install();
    const drink = await motionFixture(page, prop);
    const art = drink.locator('.hd-prop-art');
    const meniscus = drink.locator('.hd-drink-meniscus');
    const surface = meniscus.locator('.hd-drink-surface');
    await expect(drink).toHaveAttribute('data-level', '4');
    // A full glass uses the untouched photograph; its reconstructed fill edge
    // becomes visible after the first sip and then drops with each later sip.
    let edge = null;
    for (let level = 3; level >= 0; level -= 1) {
      // Each sip is deliberate; fast-forward only the tap-burst window.
      await expect(drink).not.toHaveAttribute('data-moving', 'true');
      await page.clock.fastForward(2800);
      await drink.click();
      await expect(drink).toHaveAttribute('data-last-motion', 'glass-sip');
      await expect(drink).toHaveAttribute('data-level', String(level));
      await expect(art).toHaveAttribute('data-drink-level', String(level));
      await expect(drink.locator('.hd-consumable-original')).toBeHidden();
      await expect(drink).toHaveAttribute('data-moving', 'false');
      if (level > 0) {
        await expect(surface).toBeVisible();
        const lowerEdge = await surface.boundingBox();
        if (edge) expect(lowerEdge.y).toBeGreaterThan(edge.y);
        edge = lowerEdge;
      }
    }
    await expect(drink.locator('.hd-drink-liquid')).toBeHidden();
    await expect(meniscus).toBeHidden();
    await expect(drink.locator('.hd-consumable-container')).toBeVisible();
    await expect(drink).toHaveAttribute('aria-label', 'Nachschenken');
    await page.clock.fastForward(2800);
    await drink.click();
    await expect(drink).toHaveAttribute('data-last-motion', 'glass-refill');
    await expect(drink).toHaveAttribute('data-level', '4');
    await expect(art).toHaveAttribute('data-drink-level', '4');
    await expect(drink.locator('.hd-consumable-original')).toBeVisible();
    if (prop === 'beer') await expect(drink).toHaveAttribute('data-foam', 'fresh');
  });
}

test('wild tapping empties a beer and its spill waits for a deliberate mouse wipe', async ({ page }) => {
  const { beer, patch, cloth } = await spilledBeer(page);
  await expect(beer).toHaveAttribute('data-last-motion', 'glass-spill');
  await expect(beer).toHaveAttribute('data-level', '0');
  await expect(beer.locator('.hd-drink-liquid')).toBeHidden();
  await expect(beer.locator('.hd-consumable-original')).toBeHidden();
  await expect(patch).toHaveAttribute('data-cleaned', '0');
  await expect(patch).toHaveAttribute('data-wipe-state', 'waiting');
  await expect(cloth).toBeEnabled();
  await page.waitForTimeout(4500);
  await expect(patch).toHaveAttribute('data-cleaned', '0');
  await expect(patch.locator('.hd-prop-puddle')).toHaveCount(1);
  await wipeCloth(page, patch, cloth);
  await expect(patch).toHaveCount(0);
  await expect(page.locator('.hd-prop-puddle, .hd-prop-cloth')).toHaveCount(0);
});

test('Enter and Space clean one quarter of a spill per activation', async ({ page }) => {
  const { patch, cloth } = await spilledBeer(page);
  await cloth.focus();
  await expect(cloth).toBeFocused();
  for (const [index, key] of ['Enter', 'Space', 'Enter', 'Space'].entries()) {
    await page.keyboard.press(key);
    if (index < 3) await expect(patch).toHaveAttribute('data-cleaned', String((index + 1) * 25));
  }
  await expect(patch).toHaveCount(0);
});

test('a fast mouse swipe captures the cloth even when its first move leaves the small handle', async ({ page }) => {
  const { patch, cloth } = await spilledBeer(page);
  const box = await patch.boundingBox(), handle = await cloth.boundingBox();
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // A real browser can coalesce the entire initial move into one pointer frame.
  await page.mouse.move(box.x + box.width * .85, box.y + box.height * .7);
  await expect(patch).toHaveAttribute('data-wipe-state', 'wiping');
  expect(Number(await patch.getAttribute('data-cleaned'))).toBeGreaterThan(0);
  for (let stroke = 0; stroke < 5 && await patch.count(); stroke += 1) {
    await page.mouse.move(box.x + box.width * (stroke % 2 ? .85 : .15), box.y + box.height * .5);
  }
  await page.mouse.up();
  await expect(patch).toHaveCount(0);
});

test.describe('native touch table gestures', () => {
  test.use({ hasTouch: true });

  test('a touch swipe moves the cloth and cleans the spill without an accidental extra click', async ({ page }) => {
    const { patch, cloth } = await spilledBeer(page);
    await wipeCloth(page, patch, cloth, { touch: true });
    await expect(patch).toHaveCount(0);
    await expect(page.locator('.hd-prop-cloth')).toHaveCount(0);
  });

  test('touch cancellation preserves the partly wiped spill and keyboard cleaning can continue', async ({ page }) => {
    const { patch, cloth } = await spilledBeer(page);
    const handle = await cloth.boundingBox(), x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await pointerGesture(page, [{ x, y }, { x: x + 22, y: y + 4 }], { touch: true, cancel: true });
    await expect(patch).toHaveAttribute('data-wipe-state', 'waiting');
    const cleaned = Number(await patch.getAttribute('data-cleaned'));
    expect(cleaned).toBeGreaterThan(0);
    expect(cleaned).toBeLessThan(100);
    await page.waitForTimeout(150);
    await expect(patch).toHaveAttribute('data-cleaned', String(cleaned));
    await cloth.focus();
    for (let press = 0; press < 4 && await patch.count(); press += 1) await page.keyboard.press('Enter');
    await expect(patch).toHaveCount(0);
  });

  test('a native touch shake bursts a sealed can exactly once', async ({ page }) => {
    const can = await motionFixture(page, 'can');
    await shakeProp(page, can, { touch: true });
    await expect(can).toHaveAttribute('data-can-state', 'burst');
    await expect(can).toHaveAttribute('data-shake-count', '1');
    await expect(page.locator('.hd-prop-spill[data-source="can"]')).toHaveCount(1);
  });
});

test('wilder tapping topples an empty glass without creating another puddle', async ({ page }) => {
  const beer = await motionFixture(page, 'beer');
  for (let tap = 0; tap < 6; tap += 1) await beer.dispatchEvent('click');
  await expect(beer).toHaveAttribute('data-fallen', 'true');
  await expect(beer).toHaveAttribute('data-level', '0');
  // The first spill emptied the glass; the later fall adds no second spill.
  await expect(page.locator('.hd-prop-puddle')).toHaveCount(1);
  await expect(page.locator('.hd-prop-cloth')).toHaveCount(1);
  await expect(beer).toHaveAttribute('aria-label', 'Glas wieder aufstellen');
  await expect(beer).toHaveAttribute('data-moving', 'false');
  await page.waitForTimeout(1300);
  await beer.click();
  await expect(beer).toHaveAttribute('data-fallen', 'false');
  await expect(beer).toHaveAttribute('data-level', '0');
});

test('a compact fallen glass stays small and centred until its standing animation ends', async ({ page }) => {
  const beer = await motionFixture(page, 'beer');
  await page.evaluate(() => {
    const stock = document.createElement('button'); stock.id = 'hausdeppStock';
    Object.assign(stock.style, { position: 'absolute', left: '750px', top: '330px', width: '80px', height: '100px' });
    window.__decorFixture.table.append(stock);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.hd-table-prop--beer > .hd-prop-art') && this.parentElement.dataset.lastMotion === 'glass-stand') {
        animation.pause(); window.__standingGlass = animation;
      }
      return animation;
    };
  });
  for (let tap = 0; tap < 6; tap += 1) await beer.dispatchEvent('click');
  await expect(beer).toHaveAttribute('data-compact-fall', 'true');
  await expect(beer).toHaveAttribute('data-moving', 'false');
  await page.waitForTimeout(1300);
  await beer.click();
  await expect(beer).toHaveAttribute('data-last-motion', 'glass-stand');
  await expect(beer).toHaveAttribute('data-fallen', 'false');
  await expect(beer).toHaveAttribute('data-moving', 'true');
  await expect(beer).toHaveAttribute('data-compact-fall', 'true');
  await expect(beer.locator('.hd-prop-art')).toHaveCSS('scale', '0.62');
  expect(await beer.locator('.hd-prop-art').evaluate(element => {
    const [x, y] = getComputedStyle(element).transformOrigin.split(' ').map(parseFloat);
    return [x, y, element.offsetWidth / 2, element.offsetHeight / 2];
  })).toEqual([70, 70, 70, 70]);
  await page.evaluate(() => window.__standingGlass.play());
  await expect(beer).toHaveAttribute('data-moving', 'false');
  await expect(beer).toHaveAttribute('data-compact-fall', 'false');
  await page.mouse.move(0, 0);
  await expect(beer.locator('.hd-prop-art')).toHaveCSS('scale', 'none');
});

async function dockFixture(page) {
  await motionFixture(page, 'beer');
  await page.evaluate(() => {
    const { table } = window.__decorFixture;
    table.style.height = '250px';
    const heading = document.createElement('div'); heading.className = 'hd-room-heading';
    Object.assign(heading.style, { position: 'relative', display: 'flex', width: '100%', height: '54px' });
    heading.textContent = 'Labelled dock heading'; table.prepend(heading);
    window.__dockOptions = { gameId: 'docked-surprise-fixture', roundNumber: 1, phase: 'playing', surprise: 'star',
      onSurprise: () => { window.__dockRequests = (window.__dockRequests || 0) + 1; return true; } };
  });
}

test('a docked surprise becomes reachable again when the same offer returns after a pause', async ({ page }) => {
  await dockFixture(page);
  await page.evaluate(() => {
    const { module, table } = window.__decorFixture;
    module.renderTableDecor(table, window.__dockOptions);
  });
  const star = page.locator('.hd-surprise-dock [data-prop="star"]');
  await expect(star).toBeVisible();
  await page.evaluate(() => {
    const { module, table } = window.__decorFixture;
    module.renderTableDecor(table, { ...window.__dockOptions, surprise: null });
  });
  await expect(star).toBeHidden();
  await page.evaluate(() => {
    const { module, table } = window.__decorFixture;
    module.renderTableDecor(table, window.__dockOptions);
  });
  await expect(star).toBeEnabled();
  await star.click();
  expect(await page.evaluate(() => window.__dockRequests)).toBe(1);
});

test('a new round before first paint docks only its own surprise once', async ({ page }) => {
  await dockFixture(page);
  await page.evaluate(() => {
    const { module, table } = window.__decorFixture;
    module.renderTableDecor(table, window.__dockOptions);
    module.renderTableDecor(table, { ...window.__dockOptions, roundNumber: 2, surprise: 'hammer' });
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('.hd-surprise-dock')).toHaveCount(1);
  await expect(page.locator('.hd-surprise-dock [data-prop="hammer"]')).toBeVisible();
  await expect(page.locator('[data-prop="star"]')).toHaveCount(0);
});

test('enabling reduced motion while a cloth wipes removes the cloth and puddle', async ({ page }) => {
  const { beer, patch, cloth } = await spilledBeer(page);
  await expect(cloth).toBeVisible();
  const handle = await cloth.boundingBox(), x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 22, y + 4, { steps: 3 });
  await expect(patch).toHaveAttribute('data-wipe-state', 'wiping');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.up();
  await expect(page.locator('.hd-prop-cloth')).toHaveCount(0);
  await expect(page.locator('.hd-prop-puddle')).toHaveCount(0);
  await expect(beer).toBeDisabled();
});

test('a spill survives ordinary updates but clears at game end and never enters the next round', async ({ page }) => {
  const beer = await motionFixture(page, 'beer');
  for (let tap = 0; tap < 3; tap += 1) await beer.dispatchEvent('click');
  await expect(page.locator('.hd-prop-spill')).toHaveCount(1);
  await page.evaluate(() => {
    const { module, table, gameId } = window.__decorFixture;
    window.__previousDecorBeer = table.querySelector('[data-prop="beer"]');
    module.renderTableDecor(table, { gameId, roundNumber: 1, phase: 'playing' });
  });
  await expect(page.locator('.hd-prop-spill')).toHaveCount(1);
  await expect(page.locator('.hd-prop-cloth')).toHaveCount(1);
  await page.evaluate(() => {
    const { module, table, gameId } = window.__decorFixture;
    module.renderTableDecor(table, { gameId, roundNumber: 1, phase: 'finished' });
  });
  await expect(page.locator('.hd-prop-spill, .hd-prop-cloth')).toHaveCount(0);
  await page.evaluate(() => {
    const { module, table, gameId } = window.__decorFixture;
    module.renderTableDecor(table, { gameId, roundNumber: 2, phase: 'playing' });
  });
  await expect(page.locator('.hd-prop-spill, .hd-prop-cloth, .hd-table-prop[data-level="0"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__previousDecorBeer.isConnected)).toBe(false);
});

test('a spill and cloth fit beside a nearby stock button and cannot intercept its input', async ({ page }) => {
  const beer = await motionFixture(page, 'beer');
  await beer.evaluate(element => element.style.setProperty('--prop-angle', '0deg'));
  await page.evaluate(() => {
    const stock = document.createElement('button');
    stock.id = 'hausdeppStock'; stock.textContent = 'Labelled stock';
    Object.assign(stock.style, { position: 'absolute', left: '745px', top: '380px', width: '80px', height: '100px' });
    stock.addEventListener('click', () => { window.__decorStockTaps = (window.__decorStockTaps || 0) + 1; });
    window.__decorFixture.table.append(stock);
  });
  for (let tap = 0; tap < 3; tap += 1) await beer.dispatchEvent('click');
  const spill = page.locator('.hd-prop-spill');
  await expect(spill).toHaveCount(1);
  const patch = await spill.boundingBox();
  const stock = await page.locator('#hausdeppStock').boundingBox();
  // The full splash would touch the nearby stock; the smaller patch remains free.
  expect(patch.width).toBeLessThan(140);
  expect(patch.x + patch.width).toBeLessThan(stock.x);
  expect(await spill.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  expect(await spill.locator('button.hd-prop-cloth').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('auto');
  await page.locator('#hausdeppStock').click();
  expect(await page.evaluate(() => window.__decorStockTaps)).toBe(1);
});

test('an untouched beer loses its head of foam', async ({ page }) => {
  await page.clock.install();
  const beer = await motionFixture(page, 'beer');
  await expect(beer).toHaveAttribute('data-foam', 'fresh');
  await page.clock.fastForward(200000);
  await expect(beer).toHaveAttribute('data-foam', 'flat');
});

test('a coaster collects tally marks in groups of five and flips to a clean side after twenty', async ({ page }) => {
  const coaster = await motionFixture(page, 'coaster');
  await expect(coaster).toHaveAttribute('data-tally', '0');
  for (let count = 1; count <= 20; count += 1) {
    await expect(coaster).not.toHaveAttribute('data-moving', 'true');
    await coaster.click();
    await expect(coaster).toHaveAttribute('data-tally', String(count));
    await expect(coaster.locator('.hd-prop-tally path')).toHaveCount(count);
    await expect(coaster).toHaveAttribute('aria-label', new RegExp(`– ${count}/20$`));
    if (count === 5) {
      const strokes = await coaster.locator('.hd-prop-tally path').evaluateAll(paths => paths.map(path => {
        const box = path.getBBox(); return { width: box.width, height: box.height };
      }));
      // The fifth stroke crosses the first four rather than adding a fifth upright.
      expect(strokes.slice(0, 4).every(stroke => stroke.height > stroke.width)).toBe(true);
      expect(strokes[4].width).toBeGreaterThan(strokes[4].height);
    }
  }
  await expect(coaster).toHaveAttribute('data-moving', 'false');
  await coaster.click();
  await expect(coaster).toHaveAttribute('data-tally', '0');
  await expect(coaster.locator('.hd-prop-tally path')).toHaveCount(0);
  await expect(coaster.locator('.hd-prop-caption')).toHaveText('Neue Runde, leere Rückseite');
});

test('the lantern can be blown out and relit without changing the table', async ({ page }) => {
  const lantern = await motionFixture(page, 'lantern');
  await expect(lantern).toHaveAttribute('data-lit', 'true');
  await lantern.click();
  await expect(lantern).toHaveAttribute('data-lit', 'false');
  await expect(lantern).toHaveAttribute('data-last-motion', 'candle-out');
  await expect(lantern).toHaveAttribute('aria-label', 'Windlicht anzünden');
  expect(await lantern.locator('.hd-prop-art').evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0');
  await expect(lantern).toHaveAttribute('data-moving', 'false');
  await lantern.focus();
  await page.keyboard.press('Enter');
  await expect(lantern).toHaveAttribute('data-lit', 'true');
  await expect(lantern).toHaveAttribute('data-last-motion', 'candle-light');
  await expect(lantern).toHaveAttribute('aria-label', 'Windlicht auspusten');
});

test('shaking a lantern blows it out briefly and it relights after 2.8 seconds', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T12:00:00Z') });
  const lantern = await motionFixture(page, 'lantern');
  await page.clock.pauseAt('2026-10-18T12:00:10Z');
  await shakeProp(page, lantern);
  await expect(lantern).toHaveAttribute('data-lit', 'false');
  await expect(lantern).toHaveAttribute('data-relighting', 'true');
  await expect(lantern).toHaveAttribute('data-last-motion', 'candle-shake-out');
  await page.clock.fastForward(2799);
  await expect(lantern).toHaveAttribute('data-lit', 'false');
  await page.clock.fastForward(2);
  await expect(lantern).toHaveAttribute('data-lit', 'true');
  await expect(lantern).not.toHaveAttribute('data-relighting', 'true');
  await expect(lantern).toHaveAttribute('data-last-motion', 'candle-relight');
});

test('reduced motion cancels a pending lantern relight and leaves the manual state quiet', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T12:00:00Z') });
  const lantern = await motionFixture(page, 'lantern');
  await page.clock.pauseAt('2026-10-18T12:00:10Z');
  await shakeProp(page, lantern);
  await expect(lantern).toHaveAttribute('data-relighting', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(lantern).toBeDisabled();
  await page.clock.fastForward(10000);
  await expect(lantern).toHaveAttribute('data-lit', 'false');
  await expect(lantern).not.toHaveAttribute('data-relighting', 'true');
  expect(await lantern.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running').length)).toBe(0);
});

for (const ending of ['hidden', 'pagehide', 'round']) {
  test(`${ending} cancels a pending lantern relight without reviving an old object`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-18T12:00:00Z') });
    const lantern = await motionFixture(page, 'lantern');
    await page.clock.pauseAt('2026-10-18T12:00:10Z');
    await shakeProp(page, lantern);
    await expect(lantern).toHaveAttribute('data-relighting', 'true');
    await lantern.evaluate(node => { window.__oldLantern = node; });
    await page.evaluate(ending => {
      if (ending === 'hidden') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (ending === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      else {
        const { module, table, gameId } = window.__decorFixture;
        module.renderTableDecor(table, { gameId, roundNumber: 2, phase: 'playing' });
      }
    }, ending);
    await page.clock.fastForward(10000);
    expect(await page.evaluate(() => ({ lit: window.__oldLantern.dataset.lit,
      relighting: window.__oldLantern.dataset.relighting }))).toEqual({ lit: 'false', relighting: 'false' });
  });
}

test('reduced motion keeps interactive props still and disabled', async ({ page }) => {
  const can = await motionFixture(page, 'can', true);
  await expect(can).toBeDisabled();
  await page.clock.install();
  await page.clock.fastForward(70000);
  await expect(can).not.toHaveAttribute('data-fallen', 'true');
  expect(await can.locator('.hd-prop-art').evaluate(element => element.getAnimations().length)).toBe(0);
});

test('enabling reduced motion during a coin toss cancels motion and its delayed caption', async ({ page }) => {
  await page.clock.install();
  const coin = await motionFixture(page, 'coin');
  await coin.click();
  await expect(coin).toHaveAttribute('data-last-motion', 'coin-toss');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(coin).toBeDisabled();
  await expect(coin).toHaveAttribute('data-moving', 'false');
  await page.clock.fastForward(1500);
  await expect(coin.locator('.hd-prop-caption')).toHaveCount(0);
  expect(await coin.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('enabling reduced motion cancels a drag before release without a drop or ripple', async ({ page }) => {
  const beer = await motionFixture(page, 'beer');
  const before = await beer.boundingBox();
  const x = before.x + before.width / 2, y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 25, { steps: 4 });
  await expect(beer).toHaveAttribute('data-dragging', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(beer).toBeDisabled();
  await expect(beer).toHaveAttribute('data-dragging', 'false');
  await page.mouse.move(x + 80, y + 50, { steps: 4 });
  await page.mouse.up();
  expect(await beer.boundingBox()).toEqual(before);
  expect(await beer.evaluate(element => element.style.translate)).toBe('');
  await expect(beer).not.toHaveAttribute('data-last-motion', 'drag-drop');
  await expect(page.locator('.hd-prop-ripple, .hd-prop-glass-ring')).toHaveCount(0);
  expect(await beer.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('a growing hand covers a prop without relocating it or passing a card tap through', async ({ page }) => {
  const prop = await motionFixture(page, 'nuts');
  const before = await prop.boundingBox();
  await page.evaluate(() => {
    const { module, table, gameId } = window.__decorFixture;
    const sprite = table.querySelector('[data-prop="nuts"]');
    const region = document.createElement('div'); region.className = 'hd-hand-region';
    Object.assign(region.style, { position: 'absolute', left: sprite.style.left, top: sprite.style.top, width: '200px', height: '200px' });
    const hand = document.createElement('div'); hand.id = 'hausdeppHand'; hand.className = 'hd-hand-fan';
    hand.style.position = 'relative';
    const card = document.createElement('button'); card.textContent = 'Labelled covering card';
    Object.assign(card.style, { width: '170px', height: '180px', background: '#fff' });
    card.addEventListener('click', () => { window.__coveringCardTaps = (window.__coveringCardTaps || 0) + 1; });
    hand.append(card); region.append(hand); table.append(region);
    module.renderTableDecor(table, { gameId, roundNumber: 1, phase: 'playing' });
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await prop.boundingBox()).toEqual(before);
  await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
  expect(await page.evaluate(() => window.__coveringCardTaps)).toBe(1);
  await expect(prop).not.toHaveAttribute('data-moving', 'true');
});

test('small scatter pieces react with their own motion and leave crumbs that clean up', async ({ page }) => {
  const cap = await motionFixture(page, 'cap');
  await cap.click();
  await expect(cap).toHaveAttribute('data-last-motion', 'cap-spin');
  await expect(cap).toHaveAttribute('data-moving', 'false');
  const pencil = await motionFixture(page, 'pencil');
  await pencil.click();
  await expect(pencil).toHaveAttribute('data-last-motion', 'pencil-spin');
  const chips = await motionFixture(page, 'loose-chips');
  const bites = Number(await chips.getAttribute('data-total-bites'));
  for (let remaining = bites - 1; remaining >= 0; remaining -= 1) {
    await expect(chips).not.toHaveAttribute('data-moving', 'true');
    await chips.click();
    await expect(chips).toHaveAttribute('data-bites', String(remaining));
  }
  // The last loose chip disappears; flying crumbs clean up, a few stay behind.
  const eaten = page.locator('[data-prop="loose-chips"]');
  await expect(eaten).toHaveAttribute('data-last-motion', 'eaten');
  expect(await eaten.locator('.hd-prop-crumb').count()).toBeGreaterThan(0);
  await expect(eaten.locator('.hd-prop-crumb')).toHaveCount(0, { timeout: 2000 });
  await expect(eaten).toBeHidden();
  expect(await page.locator('.hd-prop-leftover').count()).toBeGreaterThan(0);
});

test('an object can be pushed across free wood but glides back from a control', async ({ page }) => {
  const beer = await motionFixture(page, 'beer');
  await page.evaluate(() => {
    const control = document.createElement('button');
    control.className = 'hd-seat'; control.textContent = 'Labelled seat';
    Object.assign(control.style, { position: 'absolute', left: '900px', top: '330px', width: '120px', height: '120px' });
    window.__decorFixture.table.append(control);
  });
  const start = await beer.boundingBox();
  const drag = async (dx, dy) => {
    const box = await beer.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx / 2, box.y + box.height / 2 + dy / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
    await page.mouse.up();
  };
  await drag(-80, 40);
  await expect(beer).toHaveAttribute('data-last-motion', 'drag-drop');
  const moved = await beer.boundingBox();
  expect(Math.round(moved.x - start.x)).toBe(-80);
  expect(Math.round(moved.y - start.y)).toBe(40);
  // A push never ends on a seat, card or control, and the release is no tap.
  await drag(340, -40);
  await expect(beer).toHaveAttribute('data-last-motion', 'drag-return');
  await page.waitForTimeout(450);
  const back = await beer.boundingBox();
  expect(Math.round(back.x)).toBe(Math.round(moved.x));
  expect(Math.round(back.y)).toBe(Math.round(moved.y));
});
