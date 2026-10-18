const { test, expect } = require('@playwright/test');
const { mkdir, readFile } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function table(page, viewport) {
  await page.setViewportSize(viewport);
  const signedIn = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  // Remember states per table: a previous table keeps streaming computer moves
  // and must never be mistaken for the table that was just opened.
  const latestByGame = new Map();
  page.on('websocket', socket => {
    const gameId = decodeURIComponent(socket.url().split('/ws/')[1] || '');
    socket.on('framereceived', event => {
      try {
        const state = JSON.parse(String(event.payload)).scoreboard?._hausdepp;
        if (state) latestByGame.set(gameId, state);
      } catch { /* Protocol frames carry no JSON. */ }
    });
  });
  // The first dealer is random. The decor is checked on the opening table the
  // viewer sees when sitting right after the dealer (cards in hand, a computer
  // peeking), so open tables until the deal lands there (one in six).
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const created = await page.request.post('/api/games', {
      headers: { 'X-CSRF-Token': user.csrf_token },
      data: { name: 'Dekoration · sechs Plätze', mode: '6', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 5 },
    });
    expect(created.ok()).toBeTruthy();
    const gameId = (await created.json()).game_id;
    await page.goto(`/hausdepp/spiel/${gameId}`);
    await expect.poll(() => latestByGame.get(gameId)?.viewer_id).toBeTruthy();
    const latest = latestByGame.get(gameId);
    const ids = latest.players.map(player => player.id);
    if (ids[(ids.indexOf(latest.dealer_id) + 1) % ids.length] !== latest.viewer_id) continue;
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
    await expect(page.locator('.hd-seat')).toHaveCount(5);
    return;
  }
  throw new Error('No six-seat table with the viewer right after the dealer in 30 random deals');
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1600, height: 1000 }]) {
  test(`six-seat table decoration respects play areas at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await table(page, viewport);
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

test('table props retain their nodes across updates and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await table(page, { width: 1600, height: 1000 });
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
    await mkdir('.impeccable/review', { recursive: true });
    await page.screenshot({ path: '.impeccable/review/hausdepp-table-decor-desktop.png', fullPage: true });
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
  const [source, consumables, play, surprises, css, consumableCss, playCss, surpriseCss] = await Promise.all([
    readFile('frontend/hausdepp/decor.js', 'utf8'),
    readFile('frontend/hausdepp/decor-consumables.js', 'utf8'),
    readFile('frontend/hausdepp/decor-play.js', 'utf8'),
    readFile('frontend/hausdepp/surprise-effects.js', 'utf8'),
    readFile('frontend/styles/hausdepp-decor.css', 'utf8'),
    readFile('frontend/styles/hausdepp-decor-consumables.css', 'utf8'),
    readFile('frontend/styles/hausdepp-decor-play.css', 'utf8'),
    readFile('frontend/styles/hausdepp-surprise-effects.css', 'utf8'),
  ]);
  await page.route('**/__test__/decor.mjs', route => route.fulfill({ body: source, contentType: 'text/javascript' }));
  await page.route('**/__test__/decor-consumables.js', route => route.fulfill({ body: consumables, contentType: 'text/javascript' }));
  await page.route('**/__test__/decor-play.js', route => route.fulfill({ body: play, contentType: 'text/javascript' }));
  await page.route('**/__test__/surprise-effects.js', route => route.fulfill({ body: surprises, contentType: 'text/javascript' }));
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

test('a can falls around its foot, stays down across updates, and can be stood up with the keyboard', async ({ page }) => {
  const can = await motionFixture(page, 'can');
  await can.click();
  await expect(can).toHaveAttribute('data-last-motion', 'can-fall');
  await expect(can).toHaveAttribute('aria-pressed', 'true');
  await expect(can).toHaveAttribute('data-moving', 'false');
  expect(await can.locator('.hd-prop-art').evaluate(element => Math.abs(Number(element.dataset.fallAngle)))).toBe(76);
  await page.evaluate(() => {
    const { module, table, gameId } = window.__decorFixture;
    module.renderTableDecor(table, { gameId, roundNumber: 1, phase: 'playing' });
  });
  await expect(can).toHaveAttribute('aria-pressed', 'true');
  await expect(can).toHaveAttribute('data-fallen', 'true');
  await can.focus();
  await page.keyboard.press('Enter');
  await expect(can).toHaveAttribute('data-last-motion', 'can-stand');
  await expect(can).toHaveAttribute('aria-pressed', 'false');
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

test('wild tapping empties a beer and a cleaning cloth wipes up its spill', async ({ page }) => {
  const beer = await motionFixture(page, 'beer');
  await expect(beer).toHaveAttribute('data-foam', 'fresh');
  for (let tap = 0; tap < 3; tap += 1) await beer.dispatchEvent('click');
  await expect(beer).toHaveAttribute('data-last-motion', 'glass-spill');
  await expect(beer).toHaveAttribute('data-level', '0');
  await expect(beer.locator('.hd-drink-liquid')).toBeHidden();
  await expect(beer.locator('.hd-consumable-original')).toBeHidden();
  await expect(page.locator('.hd-prop-puddle')).toHaveCount(1);
  await expect(page.locator('.hd-prop-cloth')).toHaveCount(1);
  await expect(page.locator('.hd-prop-puddle')).toHaveCount(0, { timeout: 6000 });
  await expect(page.locator('.hd-prop-cloth')).toHaveCount(0);
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
  const beer = await motionFixture(page, 'beer');
  for (let tap = 0; tap < 3; tap += 1) await beer.dispatchEvent('click');
  const cloth = page.locator('.hd-prop-cloth');
  await expect(cloth).toBeVisible();
  // Start during the wipe itself, after the cloth has travelled onto the spill.
  await expect.poll(() => cloth.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(.5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  expect(await spill.locator('.hd-prop-cloth').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
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
