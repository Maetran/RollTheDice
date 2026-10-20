const { test, expect } = require('@playwright/test');
const { player, finishOpenMatch } = require('./helpers/watten-journey.cjs');

for (const language of ['de', 'en']) {
  test(`${language}: the score opens a private paper journal on demand and crosses out a gestrichen score`, async ({ browser, baseURL }) => {
    const players = await Promise.all([0, 1].map(() => player(browser, baseURL, language)));
    try {
      await finishOpenMatch(players, { target: 3 });
      const item = players.find(item => item.traffic.snapshot.engine.winners.flat().includes(item.traffic.snapshot.viewer.participant_id));
      const pad = item.page.locator('.wt-scorepad');
      const score = item.page.locator('.wt-score.is-own .wt-score-open');
      const journal = item.traffic.snapshot.score_history;
      expect(journal.length).toBeGreaterThan(0);
      await expect(pad).toBeHidden();
      await expect(score).toHaveAttribute('aria-expanded', 'false');
      await expect(item.page.locator('.wt-score.is-own')).toHaveClass(/is-gestrichen/);
      await score.click();
      await expect(pad).toBeVisible();
      await expect(score).toHaveAttribute('aria-expanded', 'true');
      await expect(pad.locator('.wt-scorepad-names')).toContainText(item.user.username);
      const ownSeat = item.traffic.snapshot.viewer.seat;
      const ownRows = journal.filter(entry => entry.winning_seats.includes(ownSeat));
      await expect(pad.locator('.wt-scorepad-lines li:not(.wt-scorepad-reset)')).toHaveCount(ownRows.length);
      const total = item.traffic.snapshot.engine.scores.find(group => group.members.includes(item.traffic.snapshot.viewer.participant_id)).points;
      await expect(pad.locator('.wt-scorepad-total strong')).toHaveText(String(total));
      expect(await pad.locator('.wt-scorepad-number').evaluateAll(numbers => numbers.every(number => getComputedStyle(number).textDecorationLine.includes('line-through')))).toBe(true);
      await pad.locator('[data-wt-scorepad-close]').click();
      await expect(pad).toBeHidden();
      await expect(score).toBeFocused();
      await score.press('Enter');
      await expect(pad).toBeVisible();
      await item.page.keyboard.press('Escape');
      await expect(pad).toBeHidden();
      await score.click();
      await item.page.locator('.wt-final-heading').click();
      await expect(pad).toBeHidden();
      await item.page.reload();
      await expect(item.page.locator('[data-watten-match-result]')).toBeVisible();
      await expect(item.page.locator('.wt-scorepad')).toBeHidden();
      await item.page.locator('.wt-score.is-own .wt-score-open').click();
      await expect(item.page.locator('.wt-scorepad-total strong')).toHaveText(String(total));
      expect(players.every(item => item.traffic.errors.length === 0)).toBe(true);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
