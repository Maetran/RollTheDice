const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne, finishOpenMatch } = require('./helpers/watten-journey.cjs');

for (const language of ['de', 'en']) {
  test(`${language}: the final sheet keeps result and rematch clear with details closed`, async ({ browser, baseURL }, info) => {
    const players = await Promise.all([0, 1].map(() => player(browser, baseURL, language)));
    const host = players[0];
    try {
      await finishOpenMatch(players);
      const details = host.page.locator('.wt-final-call');
      await expect(details).not.toHaveAttribute('open', '');
      await expect(host.page.locator('[data-wt-history]')).not.toHaveAttribute('open', '');
      await expect(host.page.locator('[data-watten-round-call]')).toBeHidden();
      await expect(host.page.locator('[data-watten-match-progress-action=dismiss]')).toBeHidden();
      await expect(details.locator('summary')).toHaveText(language === 'de' ? 'Spieldetails' : 'Match details');
      await expect(host.page.locator('.wt-final-reactions button')).toHaveCount(4);
      await expect(host.page.locator('[data-watten-social-drawer]')).toBeHidden();
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 956, height: 440 }, { width: 1280, height: 800 }]) {
        await host.page.setViewportSize(viewport);
        const heading = host.page.locator('.wt-final-heading'), rematch = host.page.locator('[data-watten-rematch-action=create]');
        await expect(heading).toBeVisible();
        await expect(rematch).toBeVisible();
        await expect.poll(() => host.page.evaluate(() => {
          const heading = document.querySelector('.wt-final-heading').getBoundingClientRect();
          const action = document.querySelector('[data-watten-rematch-action=create]').getBoundingClientRect();
          const details = document.querySelector('.wt-final-call').getBoundingClientRect();
          const reactions = document.querySelector('.wt-final-reactions').getBoundingClientRect();
          const button = document.querySelector('[data-watten-rematch-action=create]');
          return heading.top >= 0 && reactions.top >= heading.bottom && action.top >= reactions.bottom
            && action.bottom <= innerHeight && action.top >= heading.bottom
            && details.top >= action.bottom && action.width >= 44 && action.height >= 44
            && button.contains(document.elementFromPoint(action.x + action.width / 2, action.y + action.height / 2))
            && document.documentElement.scrollWidth <= innerWidth + 1;
        })).toBe(true);
        await host.page.screenshot({ path: info.outputPath(`quiet-result-${language}-${viewport.width}x${viewport.height}.png`) });
      }
      const before = host.traffic.snapshot.engine.opportunity;
      await host.page.locator('[data-watten-result-emoji="🎉"]').click();
      await expect.poll(() => players[1].traffic.social.some(frame => frame.watten_social_event?.event?.emoji === '🎉')).toBe(true);
      await expect(host.page.locator('[data-watten-social-drawer]')).toBeHidden();
      expect(host.traffic.snapshot.engine.opportunity).toBe(before);
      await host.page.setViewportSize({ width: 393, height: 852 });
      await details.locator('summary').click();
      await expect(host.page.locator('[data-watten-round-call]')).toBeVisible();
      await expect(host.page.locator('[data-watten-match-progress-action=dismiss]')).toBeVisible();
      await expect(host.page.locator('.wt-final-award')).toBeVisible();
      await expect(host.page.locator('.wt-final-progress')).toHaveText(language === 'de' ? 'Erfolge & Titel' : 'Achievements & titles');
      expect(await host.page.locator('.wt-match-progress h4').evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))).toBeLessThanOrEqual(13);
      await details.locator('summary').click();
      await expect(host.page.locator('[data-watten-match-progress-action=dismiss]')).toBeHidden();
      await expect(host.page.locator('[data-watten-rematch-action=create]')).toBeEnabled();
      if (language === 'de') {
        const guest = players[1];
        await guest.page.locator('.wt-final-call > summary').click();
        await expect(guest.page.locator('[data-watten-match-progress-action=dismiss]')).toBeVisible();
        await guest.page.locator('[data-watten-match-progress]').evaluate(node => { window.loadedMatchReceipt = node.firstElementChild; });
        await host.page.locator('[data-watten-rematch-action=create]').click();
        await expect(guest.page.locator('[data-watten-rematch-action=open]')).toBeVisible();
        await expect(guest.page.locator('[data-watten-match-progress-action=dismiss]')).toBeVisible();
        expect(await guest.page.locator('[data-watten-match-progress]').evaluate(node => node.firstElementChild === window.loadedMatchReceipt)).toBe(true);
      }
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

for (const viewport of [{ width: 393, height: 852 }, { width: 852, height: 393 }]) {
  test(`review isolates the last trick during an incoming real throw and resumes current state ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options, viewport, reducedMotion: 'no-preference' }) };
    const players = await Promise.all([0, 1].map(() => player(wrapped, baseURL)));
    try {
      await create(players, { target: 15, determination: 'normal' });
      await normalCall(players);
      await playOne(players); await playOne(players);
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.last_trick?.cards.length === 2)).toBe(true);
      const next = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
      const viewer = players.find(item => item !== next), page = viewer.page;
      const history = page.locator('[data-wt-history]');
      await history.locator('summary').click();
      await expect(history).toHaveAttribute('open', '');
      await expect(page.locator('[data-wt-motion]')).toHaveCount(0);
      await expect(page.locator('[data-wt-felt]')).toBeVisible();
      await expect(page.locator('[data-wt-seats]')).toBeHidden();
      await expect(page.locator('[data-wt-hand]')).toBeHidden();
      const reviewed = await history.locator('[data-card]').evaluateAll(nodes => nodes.map(node => node.dataset.card));
      await playOne(players);
      await expect.poll(() => viewer.traffic.snapshot.engine.current_trick.cards.length).toBe(1);
      const latest = viewer.traffic.snapshot.engine.current_trick.cards[0].card;
      await expect(page.locator(`[data-wt-trick] [data-card="${latest}"]`)).toHaveCount(1);
      await expect(page.locator(`[data-wt-trick] [data-card="${latest}"]`)).toBeHidden();
      expect(await history.locator('[data-card]').evaluateAll(nodes => nodes.map(node => node.dataset.card))).toEqual(reviewed);
      await expect(page.locator('[data-wt-motion]')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`isolated-review-${viewport.width}x${viewport.height}.png`) });
      await history.locator('[data-wt-history-close]').click();
      await expect(history).not.toHaveAttribute('open', '');
      await expect(page.locator(`[data-wt-trick] [data-card="${latest}"]`)).toBeVisible();
      await expect(page.locator('[data-wt-hand]')).toBeVisible();
      await expect(page.locator('[data-wt-motion]')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`resumed-live-${viewport.width}x${viewport.height}.png`) });
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('a completed deal cannot leave the next deal hidden behind an old open review', async ({ browser, baseURL }) => {
  const wrapped = { newContext: options => browser.newContext({ ...options, reducedMotion: 'no-preference' }) };
  const players = await Promise.all([0, 1].map(() => player(wrapped, baseURL)));
  try {
    await create(players, { target: 15, determination: 'normal' });
    await normalCall(players);
    const firstDeal = players[0].traffic.snapshot.engine.deal_id;
    for (let index = 0; index < 10 && players[0].traffic.snapshot.engine.phase === 'play'; index++) await playOne(players);
    await expect.poll(() => players[0].traffic.snapshot.engine.deal_id, { timeout: 15000 }).not.toBe(firstDeal);
    for (const item of players) {
      await expect(item.page.locator('[data-wt-history]')).toBeHidden();
      await expect(item.page.locator('[data-wt-history]')).not.toHaveAttribute('open', '');
      await expect(item.page.locator('[data-wt-hand]')).toBeVisible();
      // Even legacy retained DOM with hidden+open cannot suppress a new deal.
      await item.page.locator('[data-wt-history]').evaluate(node => { node.hidden = true; node.open = true; });
      await expect(item.page.locator('[data-wt-hand]')).toBeVisible();
    }
    await normalCall(players);
    const next = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
    const viewer = players.find(item => item !== next);
    const arriving = viewer.page.waitForSelector('[data-wt-motion="arrive"]');
    await playOne(players);
    expect(await arriving).toBeTruthy();
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
