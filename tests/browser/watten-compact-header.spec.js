const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');
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
}

for (const language of ['de', 'en']) {
  test(`${language}: compact landscape menu preserves table geometry, floating scores and portrait controls`, async ({ browser, baseURL }, info) => {
    const mobile = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 2; seat++) players.push(await player(mobile, baseURL, language));
      const [host] = players, { page } = host;
      await voiceAvailable(page);
      await create(players, { count: 2, target: 11, determination: 'normal' });
      await normalCall(players);
      const toggle = page.locator('[data-watten-header-toggle]');
      for (const viewport of [{ width: 568, height: 320 }, { width: 720, height: 360 }]) {
        await page.setViewportSize(viewport);
        await expectCompactHeader(page, language, false);
        const before = await tableGeometry(page), opportunity = host.traffic.snapshot.engine.opportunity;
        await toggle.click();
        await expectCompactHeader(page, language, true);
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
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
