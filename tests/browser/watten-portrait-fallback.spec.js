const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

test('four-player portrait fallback centres the trick and keeps the Rechter in the viewport', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) {
      players.push(await player(browser, baseURL, 'de', { role: seat === 0 ? 'admin' : 'user' }));
    }
    const page = players[0].page;
    await page.setViewportSize({ width: 440, height: 956 });
    await create(players, { count: 4, determination: 'normal', reference: true });
    await normalCall(players);
    for (let i = 0; i < 3; i++) await playOne(players);
    await expect(page.locator('[data-wt-trick] .wt-trick-card')).toHaveCount(3);
    await expect(page.locator('.wt-reference')).toBeVisible();

    // Exercise the actual fallback DOM after a real deal. A tight available
    // layout can enter it with or without a social activity banner.
    for (const withNotice of [false, true]) {
      const geometry = await page.evaluate(async withNotice => {
        const notice = document.querySelector('.wt-friend-activity-host--table');
        notice.hidden = !withNotice;
        notice.innerHTML = withNotice ? '<p class="wt-friend-activity__info">Ein Freund hat ein neues Spiel gestartet und wartet bereits am Tisch. Weitere Spielerinnen und Spieler können nun dazukommen.</p>' : '';
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const live = document.querySelector('.wt-centre');
        const centre = live.cloneNode(true);
        live.style.display = 'none';
        live.after(centre);
        delete centre.dataset.wtPortraitTrick;
        delete centre.dataset.wtPortraitTrickMode;
        centre.removeAttribute('style');
        centre.dataset.wtPortraitTrickFallback = 'space';
        await new Promise(resolve => requestAnimationFrame(resolve));
        const felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
        const trick = centre.querySelector('.wt-trick').getBoundingClientRect();
        // Reproduce the former rule in this fixture: it shifted the whole
        // trick right by half its width and down by half its height.
        centre.style.marginLeft = '0';
        centre.style.marginTop = '0';
        await new Promise(resolve => requestAnimationFrame(resolve));
        const oldTrick = centre.querySelector('.wt-trick').getBoundingClientRect();
        const oldOffset = Math.abs((oldTrick.left + oldTrick.right - felt.left - felt.right) / 2);
        centre.style.removeProperty('margin-left');
        centre.style.removeProperty('margin-top');
        const reference = centre.querySelector('.wt-reference').getBoundingClientRect();
        const hand = document.querySelector('[data-wt-hand-area]').getBoundingClientRect();
        const cards = [...centre.querySelectorAll('.wt-trick-card')].map(card => card.getBoundingClientRect());
        const result = { oldOffset, centreOffset: Math.abs((trick.left + trick.right - felt.left - felt.right) / 2),
          referenceLeft: reference.left, referenceRight: reference.right, referenceTop: reference.top,
          referenceBottom: reference.bottom, handTop: hand.top, cardsBottom: Math.max(...cards.map(card => card.bottom)),
          noticeHeight: notice.getBoundingClientRect().height };
        centre.remove(); live.style.removeProperty('display');
        return result;
      }, withNotice);
      expect(geometry.oldOffset, JSON.stringify(geometry)).toBeGreaterThan(40);
      expect(geometry.centreOffset, JSON.stringify(geometry)).toBeLessThanOrEqual(2);
      expect(geometry.cardsBottom).toBeLessThan(geometry.handTop);
      expect(geometry.referenceLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.referenceRight).toBeLessThanOrEqual(440);
      expect(geometry.referenceTop).toBeGreaterThanOrEqual(0);
      expect(geometry.referenceBottom).toBeLessThanOrEqual(956);
      if (withNotice) expect(geometry.noticeHeight).toBeGreaterThan(35);
    }

    // Rotating to the compact landscape layout must not retain the portrait
    // fallback margins or turn its independently positioned trick into a
    // shifted portrait clover.
    await page.setViewportSize({ width: 956, height: 440 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const landscape = await page.locator('.wt-centre').evaluate(node => {
      const style = getComputedStyle(node);
      return { left: style.marginLeft, top: style.marginTop };
    });
    expect(landscape).toEqual({ left: '0px', top: '0px' });
  } finally {
    for (const item of players) await item.context.close();
  }
});
