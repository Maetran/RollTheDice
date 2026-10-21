const { test, expect } = require('@playwright/test');
const { player, create, action, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { expectFixedTable, expectReachable } = require('./table-viewport');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');

test.setTimeout(90_000);

async function expectCompactTableHead(page, language) {
  const leave = page.locator('[data-wt-tools] [data-watten-action=leave]');
  const label = language === 'en' ? 'Leave match' : 'Partie verlassen';
  await expect(leave).toHaveAccessibleName(label);
  await expect(leave).toHaveAttribute('title', label);
  await expect(leave.locator('svg[aria-hidden=true]')).toBeVisible();
  await expectReachable(page, '[data-wt-tools] [data-watten-action=leave]');
  await expectTableHeaderReachable(page);
  await expect.poll(() => page.evaluate(() => {
    const failures = [], felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
    const portrait = innerWidth < innerHeight;
    for (const score of document.querySelectorAll('.wt-score')) {
      const rect = score.getBoundingClientRect();
      if (portrait && rect.width > 120.5) failures.push('score grows beyond compact content width');
      if (rect.bottom > felt.top + 1) failures.push('score enters the table');
    }
    const controls = [...document.querySelectorAll('[data-wt-score-open], [data-wt-tools] button, [data-watten-social-action=toggle], .wt-voice-details > summary')]
      .filter(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
    const boxes = controls.map(node => ({ node, rect: node.getBoundingClientRect() }));
    for (const { node, rect } of boxes) {
      if (rect.width < 44 || rect.height < 44) failures.push('header target smaller than 44px');
      if (rect.bottom > felt.top + 1 || rect.left < 0 || rect.right > innerWidth) failures.push('action clipped or enters the table');
      if (!node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))) failures.push('header target covered');
    }
    for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) {
      if (Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1
          && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1) failures.push('header actions overlap');
    }
    return failures;
  }), { message: 'compact scores and aligned icon actions remain separate, visible and touchable' }).toEqual([]);
}

for (const language of ['de', 'en']) {
  test(`${language}: compact mobile scores and icon departure preserve the table and bid target`, async ({ browser, baseURL }, info) => {
    const mobile = { newContext: options => browser.newContext({ ...options, viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 2; seat++) players.push(await player(mobile, baseURL, language));
      await create(players, { count: 2, target: 11, determination: 'normal' });
      await normalCall(players);
      for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 568, height: 320 }]) {
        await players[0].page.setViewportSize(viewport);
        await expectCompactTableHead(players[0].page, language);
        await expectFixedTable(players[0].page, ['[data-wt-felt]', '[data-wt-hand-area]']);
        await expectReachable(players[0].page, '[data-wt-stake] > button');
        await players[0].page.screenshot({ path: info.outputPath(`watten-head-${language}-${viewport.width}x${viewport.height}.png`) });
      }
      const page = players[0].page;
      await page.setViewportSize({ width: 320, height: 568 });
      await page.locator('[data-watten-action=leave]').click();
      await expect(page.locator('[data-watten-leave-dialog]')).toBeVisible();
      await page.locator('[data-watten-command=leave-cancel]').click();
      await expect(page.locator('[data-watten-leave-dialog]')).toBeHidden();
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}

test('a blind non-caller can bid after two cards while the informed opponent answers', async ({ browser, baseURL }, info) => {
  const mobile = { newContext: options => browser.newContext({ ...options, viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(mobile, baseURL));
    await create(players, { count: 4, target: 11 });
    await action(players, 'show_ready'); await action(players, 'show_ready');
    await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
    await playOne(players); await playOne(players);
    await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === 2)).toBe(true);
    const actor = players.find(peer => peer.traffic.snapshot.engine.actions.includes('play_card'));
    const engine = actor.traffic.snapshot.engine;
    expect(engine.profile.blind).toBe(true);
    expect([engine.announcement_roles.strike, engine.announcement_roles.colour]).not.toContain(engine.viewer.seat);
    expect(engine.actions).toContain('bid');
    const bid = actor.page.locator('[data-wt-stake] > [data-watten-action=bid]');
    await expect(bid).toBeEnabled();
    await expect(bid.locator('.wt-stake-action')).toHaveText('Bieten ＋');
    await expectCompactTableHead(actor.page, 'de');
    await expectReachable(actor.page, '[data-wt-stake] > [data-watten-action=bid]');
    const bounds = await bid.boundingBox();
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await actor.page.screenshot({ path: info.outputPath('watten-blind-bid-after-two-cards.png') });
    await bid.click();
    await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
    const pending = actor.traffic.snapshot.engine.bid.pending;
    const decider = players.find(peer => peer.traffic.snapshot.viewer.participant_id === pending.decider);
    const response = decider.traffic.snapshot.engine;
    expect([response.announcement_roles.strike, response.announcement_roles.colour]).toContain(response.viewer.seat);
    expect(response.actions).toContain('respond_hold');
    for (const peer of players.filter(peer => peer !== decider)) expect(peer.traffic.snapshot.engine.actions).not.toContain('respond_hold');
    for (const peer of players) expect(peer.traffic.errors).toEqual([]);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
