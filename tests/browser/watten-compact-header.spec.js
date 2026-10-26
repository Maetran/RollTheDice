const { test, expect } = require('@playwright/test');
const { player, create, action, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(90_000);

// Accounts, seats and gameplay use the real server. Only external voice
// availability is supplied, so the entry can be checked without an SFU session.
async function voiceAvailable(page) {
  const state = { event: 'state', available: true, room_id: 'compact-header-test', members: [], publications: [] };
  await page.routeWebSocket(/\/ws\/[a-f0-9]{16}$/, route => {
    const server = route.connectToServer();
    server.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (!message.watten_voice) route.send(raw);
      if (message.scoreboard) route.send(JSON.stringify({ watten_voice: state }));
    });
    route.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action !== 'watten_voice') return server.send(raw);
      route.send(JSON.stringify({ watten_voice: { request_id: message.request_id, ok: true, state } }));
    });
    route.onClose(() => server.close());
    server.onClose((code, reason) => route.close({ code, reason }));
  });
}

async function tableGeometry(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => [...document.querySelectorAll('[data-wt-table], [data-wt-felt], [data-wt-hand-area], .wt-seat .wt-avatar, [data-wt-hand] button')]
    .map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }));
}

async function expectCompactHeader(page, language, expanded) {
  const html = page.locator('html'), toggle = page.locator('[data-watten-header-toggle]');
  await expect(html).toHaveAttribute('data-wt-compact-header', 'true');
  await expect(html).toHaveAttribute('data-wt-header-open', String(expanded));
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
  await expect(toggle).toHaveAccessibleName(language === 'en'
    ? expanded ? 'Close menu' : 'Open menu'
    : expanded ? 'Menü schließen' : 'Menü öffnen');
  await expectTableHeaderReachable(page);
  for (const selector of ['[data-watten-header-toggle]', '[data-wt-tools] [data-watten-action=leave]', '[data-watten-social-action=toggle]', '.wt-voice-details > summary', '#wattenSound']) {
    await expectReachable(page, selector);
    const box = await page.locator(selector).boundingBox();
    expect(box.width, `${selector} touch width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${selector} touch height`).toBeGreaterThanOrEqual(44);
  }
  const scores = page.locator('[data-wt-score-open]');
  await expect(scores).toHaveCount(2);
  for (const score of await scores.all()) {
    await expect(score).toBeVisible();
    await expect.poll(() => score.evaluate(node => {
      const box = node.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44
        && node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), { message: 'each floating score stays touchable with the menu open or closed' }).toBe(true);
  }
  await expect.poll(() => page.evaluate(() => {
    const box = document.querySelector('.wt-topbar').getBoundingClientRect();
    return { left: Math.round(box.left), width: Math.round(box.width), top: Math.round(box.top) };
  })).toEqual({ left: expanded ? page.viewportSize().width - 168 : 56, width: 156, top: 4 });
  await expect.poll(() => page.evaluate(() => Math.round(Number.parseFloat(getComputedStyle(document.body, '::before').width))), {
    message: 'opening the short header leaves the full-height rail at its collapsed width',
  }).toBe(52);
}

async function expectCompactCardsClear(page, { history = false, expanded = false } = {}) {
  await expect(page.locator('.wt-reference > .wt-card')).toBeVisible();
  await expectReachable(page, '[data-wt-stake] > button');
  if (history) await expectReachable(page, '[data-wt-history]:not([open]) > summary');
  await expect.poll(() => page.evaluate(({ history, expanded }) => {
    const shown = node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
    };
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const cards = [...document.querySelectorAll('.wt-backs:not([hidden]) > i:not([hidden]), [data-wt-hand] > .wt-hand-card')].filter(shown);
    const surfaces = [...document.querySelectorAll('.wt-topbar, [data-wt-stake]:not([hidden]), [data-wt-history]:not([hidden]):not([open]), .wt-reference, .wt-table[data-phase=play] .wt-bloedeln-start')].filter(shown);
    const failures = [];
    for (const surface of surfaces) for (const card of cards) {
      if (overlap(surface.getBoundingClientRect(), card.getBoundingClientRect())) {
        failures.push(`${surface.className} covers a painted ${card.className}`);
      }
    }
    const caption = document.querySelector('.wt-trick-label');
    if (caption && caption.textContent.trim() && shown(caption)) {
      const bounds = caption.getBoundingClientRect();
      if (bounds.width < 100 || bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight) {
        failures.push('winner caption lacks a readable slot inside the viewport');
      }
      const protectedNodes = [...cards, ...document.querySelectorAll('.wt-trick-card, .wt-seat .wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-taken:not([hidden]) i, [data-wt-tools], [data-watten-social-action=toggle], .wt-voice-details > summary, [data-wt-stake] > button, [data-wt-history]:not([open]) > summary')].filter(shown);
      for (const node of protectedNodes) if (overlap(bounds, node.getBoundingClientRect())) {
        failures.push(`winner caption covers ${node.className}`);
      }
      for (let column = 0; column < 6; column++) for (let row = 0; row < 2; row++) {
        if (!caption.contains(document.elementFromPoint(bounds.left + bounds.width * (column + .5) / 6,
          bounds.top + bounds.height * (row + .5) / 2))) failures.push('winner caption is painted beneath another surface');
      }
    }
    const reference = document.querySelector('.wt-reference').getBoundingClientRect();
    const face = document.querySelector('.wt-reference > .wt-card').getBoundingClientRect();
    if ((expanded ? Math.abs(reference.left - 164) > 1 || Math.abs(reference.top - 56) > 1
      : Math.abs(reference.right - (innerWidth - 12)) > 1 || Math.abs(reference.top - 8) > 1) || face.width < 44) failures.push('reference lost its clear 44px corner beside the menu');
    if (overlap(reference, document.querySelector('.wt-topbar').getBoundingClientRect())) failures.push('floating points cover the reference');
    const stake = document.querySelector('[data-wt-stake] > button'), box = stake.getBoundingClientRect();
    const request = document.querySelector('.wt-table[data-phase=play] .wt-bloedeln-start > button');
    if (Math.abs(box.left - 6) > 1 || Math.abs(box.bottom - (innerHeight - 62)) > 1
        || Math.abs(box.width - (history || request ? 68 : 144)) > 1 || box.height < 44) failures.push('stake lost its lower 44px target');
    for (const label of stake.children) {
      const text = document.createRange(); text.selectNodeContents(label);
      const textBox = text.getBoundingClientRect();
      if (textBox.left < box.left - 1 || textBox.right > box.right + 1 || textBox.top < box.top - 1 || textBox.bottom > box.bottom + 1) failures.push('stake text escapes its button');
    }
    if (history) {
      const container = document.querySelector('[data-wt-history]').getBoundingClientRect();
      const review = document.querySelector('[data-wt-history] > summary').getBoundingClientRect();
      if (Math.abs(container.left - 80) > 1 || Math.abs(container.bottom - (innerHeight - 62)) > 1 || review.width < 44 || review.height < 44
          || overlap(box, container)) failures.push('closed review does not share the lower row beside the stake');
      const text = document.createRange(); text.selectNodeContents(document.querySelector('[data-wt-history] > summary'));
      for (const line of text.getClientRects()) {
        if (line.left < container.left - 1 || line.right > container.right + 1 || line.top < container.top - 1 || line.bottom > container.bottom + 1) failures.push('closed review clips its label');
      }
    }
    if (request) {
      const target = request.getBoundingClientRect();
      if (Math.abs(target.left - 80) > 1 || Math.abs(target.bottom - (innerHeight - 62)) > 1 || target.width < 68 || target.height < 44
          || overlap(box, target) || !request.contains(document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2))) failures.push('Blödeln does not share the lower row beside the stake');
    }
    return failures;
  }, { history, expanded }), { message: 'compact points, reference and stake/review clear every painted hand and keep their complete text' }).toEqual([]);
}

for (const language of ['de', 'en']) {
  test(`${language}: compact stake and legal Blödeln request share the row before the first card`, async ({ browser, baseURL }) => {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 568, height: 320 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, language, { role: seat === 0 ? 'admin' : 'user' }));
      await create(players, { count: 4, target: 11, reference: true });
      await action(players, 'show_ready'); await action(players, 'show_ready');
      await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
      const eligible = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('request_bloedeln'));
      expect(eligible).toHaveLength(2);
      for (const peer of players) for (const viewport of [{ width: 568, height: 320 }, { width: 720, height: 360 }]) {
        await peer.page.setViewportSize(viewport);
        await expectCompactCardsClear(peer.page);
        if (eligible.includes(peer)) await expectReachable(peer.page, '[data-watten-action=request_bloedeln]');
      }
      await action(players, 'request_bloedeln');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln')).toBe(true);
      await action(players, 'preplay_decline');
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });

  test(`${language}: compact landscape menu preserves table geometry, floating scores and portrait controls`, async ({ browser, baseURL }, info) => {
    const mobile = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 2; seat++) players.push(await player(mobile, baseURL, language, { role: seat === 0 ? 'admin' : 'user' }));
      const [host] = players, { page } = host;
      await voiceAvailable(page);
      await create(players, { count: 2, target: 11, determination: 'normal', reference: true });
      await normalCall(players);
      const toggle = page.locator('[data-watten-header-toggle]');
      for (const viewport of [{ width: 568, height: 320 }, { width: 720, height: 360 }]) {
        await page.setViewportSize(viewport);
        await expectCompactHeader(page, language, false);
        await expectCompactCardsClear(page);
        const before = await tableGeometry(page), opportunity = host.traffic.snapshot.engine.opportunity;
        await toggle.click();
        await expectCompactHeader(page, language, true);
        await expectCompactCardsClear(page, { expanded: true });
        expect(await tableGeometry(page)).toEqual(before);
        const rules = page.locator(`.wt-header a[href="/watten/regeln${language === 'en' ? '?lang=en' : ''}"]`);
        await rules.focus();
        await expect(rules).toBeFocused();
        await page.keyboard.press('Escape');
        await expectCompactHeader(page, language, false);
        await expect(toggle).toBeFocused();
        expect(await tableGeometry(page)).toEqual(before);
        expect(host.traffic.snapshot.engine.opportunity).toBe(opportunity);
        await page.screenshot({ path: info.outputPath(`compact-header-${language}-${viewport.width}x${viewport.height}.png`) });
      }

      // Leave an expanded panel during rotation; the normal header must restore
      // live controls and put the next compact visit back in its closed state.
      await toggle.click();
      await expectCompactHeader(page, language, true);
      await page.setViewportSize({ width: 393, height: 852 });
      await expect(page.locator('html')).not.toHaveAttribute('data-wt-compact-header', 'true');
      await expect(toggle).toBeHidden();
      await expectTableHeaderReachable(page);
      await expect(page.locator('.wt-header [data-language-switcher]')).toHaveValue(language);
      await expectReachable(page, '.wt-voice-details > summary');
      for (const viewport of [{ width: 721, height: 360 }, { width: 720, height: 361 }]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('html')).not.toHaveAttribute('data-wt-compact-header', 'true');
        await expect(toggle).toBeHidden();
        await expectTableHeaderReachable(page);
      }
      await page.setViewportSize({ width: 568, height: 320 });
      await expectCompactHeader(page, language, false);

      // Exercise the persisted lifecycle event path explicitly. This verifies
      // teardown and the application's fresh reload, rather than browser cache eligibility.
      await toggle.click();
      await expectCompactHeader(page, language, true);
      const previousDocument = await page.evaluate(() => performance.timeOrigin);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await expect(page.locator('html')).not.toHaveAttribute('data-wt-compact-header', 'true');
      await expect(page.locator('.wt-header [data-language-switcher]')).toBeVisible();
      const reloaded = page.waitForEvent('domcontentloaded');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await reloaded;
      expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(previousDocument);
      await expectCompactHeader(page, language, false);
      await toggle.click();
      await expectCompactHeader(page, language, true);
      await toggle.click();
      await expectCompactHeader(page, language, false);
      await playOne(players); await playOne(players);
      for (const viewport of [{ width: 568, height: 320 }, { width: 720, height: 360 }]) {
        await page.setViewportSize(viewport);
        await expectCompactHeader(page, language, false);
        await expectCompactCardsClear(page, { history: true });
        await page.screenshot({ path: info.outputPath(`compact-review-${language}-${viewport.width}x${viewport.height}.png`) });
      }
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });

  test(`${language}: four-seat compact Show and OK share a reachable target beside passive Blödeln`, async ({ browser, baseURL }, info) => {
    test.setTimeout(120_000);
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 568, height: 320 }, serviceWorkers: 'block' }) };
    const players = [], viewports = [{ width: 568, height: 320 }, { width: 720, height: 360 }];
    try {
      for (let seat = 0; seat < 4; seat++) {
        const peer = await player(wrapped, baseURL, language, { role: seat === 0 ? 'admin' : 'user' });
        await voiceAvailable(peer.page);
        players.push(peer);
      }
      await create(players, { count: 4, target: 11, reference: true, schoeneres: true });
      await action(players, 'request_bloedeln');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln')).toBe(true);
      const callers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('show_ready'));
      expect(callers).toHaveLength(2);
      const baseline = new Map();
      for (const caller of callers) for (const viewport of viewports) {
        const { page } = caller;
        await page.setViewportSize(viewport);
        await expectCompactHeader(page, language, false);
        await expect(page.locator('.wt-bloedeln-dock > .wt-bloedeln-status')).toBeVisible();
        if (await page.locator('[data-wt-table]').getAttribute('data-wt-caller-axis') === 'bottom-left') {
          await expect.poll(() => page.locator('.wt-bloedeln-dock').boundingBox()).toMatchObject({ x: 52 + (viewport.width - 52) / 2, y: 104, width: 156 });
        }
        await expectReachable(page, '[data-watten-action=show_ready]');
        await tableGeometry(page);
        const target = await page.locator('[data-watten-action=show_ready]').boundingBox();
        baseline.set(`${caller.user.id}:${viewport.width}`, target);
        const before = await tableGeometry(page);
        await page.locator('[data-watten-header-toggle]').click();
        await expectCompactHeader(page, language, true);
        await expectReachable(page, '[data-watten-action=show_ready]');
        expect(await page.locator('[data-watten-action=show_ready]').boundingBox()).toEqual(target);
        expect(await tableGeometry(page)).toEqual(before);
        await page.screenshot({ path: info.outputPath(`four-seat-menu-show-${language}-${caller.traffic.snapshot.viewer.seat}-${viewport.width}.png`) });
        await page.keyboard.press('Escape');
      }
      await action(players, 'show_ready'); await action(players, 'show_ready');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'inspection')).toBe(true);
      for (const caller of callers) for (const viewport of viewports) {
        const { page } = caller;
        await page.setViewportSize(viewport);
        await expectCompactHeader(page, language, false);
        await expectReachable(page, '[data-watten-action=inspection_ack]');
        await expect(page.locator('[data-wt-inspection-positioned]')).toHaveCount(1);
        expect(await page.locator('[data-watten-inspection] .wt-card').evaluateAll(nodes => Math.min(...nodes.map(node => Number.parseFloat(getComputedStyle(node).width))))).toBeGreaterThanOrEqual(52);
        const target = baseline.get(`${caller.user.id}:${viewport.width}`);
        await expect.poll(() => page.locator('[data-watten-action=inspection_ack]').boundingBox(),
          { message: 'both caller axes keep exactly the Show target for OK' }).toEqual(target);
        await page.locator('[data-watten-header-toggle]').click();
        await expectCompactHeader(page, language, true);
        await expectReachable(page, '[data-watten-action=inspection_ack]');
        expect(await page.locator('[data-watten-action=inspection_ack]').boundingBox()).toEqual(target);
        await page.screenshot({ path: info.outputPath(`four-seat-menu-ok-${language}-${caller.traffic.snapshot.viewer.seat}-${viewport.width}.png`) });
        await page.keyboard.press('Escape');
      }
      await action(players, 'preplay_decline');
      for (const caller of callers) for (const viewport of viewports) {
        const { page } = caller;
        await page.setViewportSize(viewport);
        const menu = page.locator('[data-watten-preplay-options]');
        await expect(menu).toBeVisible();
        await expectReachable(page, '[data-watten-preplay-options] > summary');
        await expect(page.locator('[data-wt-inspection-positioned]')).toHaveCount(1);
        if (await page.locator('[data-wt-table]').getAttribute('data-wt-caller-axis') === 'bottom-left') {
          await expect.poll(() => menu.boundingBox()).toMatchObject({ x: 52 + (viewport.width - 52) / 2, y: 104, width: 156 });
        }
        const ack = await page.locator('[data-watten-action=inspection_ack]').boundingBox();
        const widths = await page.locator('[data-watten-inspection] .wt-card').evaluateAll(nodes => nodes.map(node => Number.parseFloat(getComputedStyle(node).width)));
        expect(Math.min(...widths)).toBeGreaterThanOrEqual(52);
        await menu.locator('summary').click();
        await expectReachable(page, '[data-watten-action=request_schoeneres]');
        await expectReachable(page, '[data-watten-action=inspection_ack]');
        expect(await page.locator('[data-watten-action=inspection_ack]').boundingBox()).toEqual(ack);
        expect(await page.locator('[data-watten-inspection] .wt-card').evaluateAll(nodes => nodes.map(node => Number.parseFloat(getComputedStyle(node).width)))).toEqual(widths);
        await menu.locator('summary').click();
      }
      await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
      for (const peer of players) for (const viewport of viewports) {
        await peer.page.setViewportSize(viewport);
        await expectCompactCardsClear(peer.page);
      }
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
