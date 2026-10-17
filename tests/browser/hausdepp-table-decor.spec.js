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
  let latest = null;
  page.on('websocket', socket => socket.on('framereceived', event => {
    try { latest = JSON.parse(String(event.payload)).scoreboard?._hausdepp || latest; } catch { /* Protocol frames carry no JSON. */ }
  }));
  // The first dealer is random. The decor is checked on the opening table the
  // viewer sees when sitting right after the dealer (cards in hand, a computer
  // peeking), so open tables until the deal lands there (one in six).
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const created = await page.request.post('/api/games', {
      headers: { 'X-CSRF-Token': user.csrf_token },
      data: { name: 'Dekoration · sechs Plätze', mode: '6', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 5 },
    });
    expect(created.ok()).toBeTruthy();
    latest = null;
    await page.goto(`/hausdepp/spiel/${(await created.json()).game_id}`);
    await expect.poll(() => latest?.viewer_id).toBeTruthy();
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
  const [source, css] = await Promise.all([
    readFile('frontend/hausdepp/decor.js', 'utf8'), readFile('frontend/styles/hausdepp-decor.css', 'utf8'),
  ]);
  await page.route('**/__test__/decor.mjs', route => route.fulfill({ body: source, contentType: 'text/javascript' }));
  await page.setContent(`<style>${css}html,body{margin:0}#fixture{position:relative;width:1400px;height:900px;background:#492c1d}</style><section id="fixture" class="hd-table" aria-label="Labelled prop renderer"></section>`);
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

test('dice roll into a new resting angle while a heavy board slides without shaking', async ({ page }) => {
  const dice = await motionFixture(page, 'dice');
  await dice.click();
  await expect(dice).toHaveAttribute('data-last-motion', 'dice-roll');
  await expect(dice).toHaveAttribute('data-moving', 'false');
  expect(await dice.locator('.hd-prop-art').evaluate(element => Math.abs(Number(element.dataset.turn)))).toBe(90);
  const board = await motionFixture(page, 'marend');
  await board.click();
  await expect(board).toHaveAttribute('data-last-motion', 'board-slide');
  await expect(board).toHaveAttribute('data-moving', 'false');
  expect(await board.locator('.hd-prop-art').evaluate(element => Math.abs(Number(element.dataset.restX)))).toBe(2);
});

test('reduced motion keeps interactive props still and disabled', async ({ page }) => {
  const can = await motionFixture(page, 'can', true);
  await expect(can).toBeDisabled();
  await page.clock.install();
  await page.clock.fastForward(70000);
  await expect(can).not.toHaveAttribute('data-fallen', 'true');
  expect(await can.locator('.hd-prop-art').evaluate(element => element.getAnimations().length)).toBe(0);
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
  await chips.click();
  await expect(chips).toHaveAttribute('data-last-motion', 'hop');
  expect(await chips.locator('.hd-prop-crumb').count()).toBeGreaterThan(0);
  await expect(chips.locator('.hd-prop-crumb')).toHaveCount(0, { timeout: 2000 });
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
