const { test, expect } = require('@playwright/test');
const { player, finishOpenMatch } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

test('a tournament rematch keeps loss marks and restores each player’s fixed seat on joining', async ({ browser, baseURL }) => {
  const players = await Promise.all([0, 1].map(() => player(browser, baseURL)));
  const host = players[0];
  try {
    await finishOpenMatch(players, { tournament: 5 });
    const marks = structuredClone(host.traffic.snapshot.room.series.nockerl);
    expect(host.traffic.snapshot.room.series.finished).toBe(false);
    const sourcePath = new URL(host.page.url()).pathname;
    await host.page.locator('[data-watten-rematch-action=create]').click();
    await expect.poll(() => new URL(host.page.url()).pathname).not.toBe(sourcePath);
    const path = new URL(host.page.url()).pathname;
    await players[1].page.locator('[data-watten-rematch-action=open]').click();
    await expect(players[1].page).toHaveURL(new RegExp(`${path}$`));
    await players[1].page.locator('[data-watten-join] button[type=submit]').click();
    for (let seat = 0; seat < players.length; seat += 1) {
      const item = players[seat];
      await expect(item.page.locator('.wt-tournament-locked')).toBeVisible();
      await expect(item.page.locator('[data-watten-command=take-seat]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-command=decline-reservation]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-command=place-cpu], [data-watten-command=remove-cpu]')).toHaveCount(0);
      expect(item.traffic.snapshot.room.required_seat).toBe(seat);
      await expect.poll(() => item.traffic.snapshot.viewer.seat).toBe(seat);
    }
    await host.page.locator('[data-watten-command=start]').click();
    await expect.poll(() => host.traffic.snapshot.started).toBe(true);
    expect(host.traffic.snapshot.room.series.nockerl).toEqual(marks);
    await expect(host.page.locator('.wt-series-target')).toContainText('5');
    await expect(host.page.locator('.wt-series-marks')).toHaveCount(2);
    expect(players.every(item => item.traffic.errors.length === 0)).toBe(true);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

for (const language of ['de', 'en']) {
  test(`${language}: reaching a custom loss-mark target finishes the tournament with a clear result`, async ({ browser, baseURL }) => {
    const players = await Promise.all([0, 1].map(() => player(browser, baseURL, language)));
    try {
      await finishOpenMatch(players, { tournament: 1 });
      for (const item of players) {
        const series = item.traffic.snapshot.room.series;
        expect(series.finished).toBe(true);
        expect(series.loser_seats.length).toBe(1);
        expect(series.winner_seats.length).toBe(1);
        await expect(item.page.locator('.wt-final-heading')).toContainText(language === 'de' ? 'Turnier' : 'Tournament');
        await expect(item.page.locator('.wt-nockerl-marks')).toHaveCount(2);
        await expect(item.page.locator('[data-watten-rematch-action=create], [data-watten-rematch-action=open]')).toHaveCount(0);
      }
      const host = players[0];
      const before = structuredClone(host.traffic.snapshot.room.series);
      await host.page.reload();
      await expect(host.page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 10000 });
      expect(host.traffic.snapshot.room.series).toEqual(before);
      expect(players.every(item => item.traffic.errors.length === 0)).toBe(true);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: a committed next table survives a lost response, restores seats and keeps start explicit`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language, { role: 'admin' }), await player(browser, baseURL, language)];
    const host = players[0], guest = players[1];
    const requests = [];
    let createdTarget;
    try {
      const source = await finishOpenMatch(players, { schoeneres: true });
      const sourceMarks = structuredClone(host.traffic.snapshot.room.series.nockerl);
      expect(host.traffic.snapshot.room.recipe.schoeneres_enabled).toBe(true);
      const original = await (await host.context.request.get('/api/watten/account')).json();
      await expect(host.page.locator('[data-watten-rematch-action=create]')).toBeVisible();
      await expect(guest.page.locator('[data-watten-rematch]')).toBeHidden();
      await expect(host.page.locator('[data-watten-rematch] input, [data-watten-rematch] select, [data-watten-rematch] details')).toHaveCount(0);
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await host.page.setViewportSize(viewport);
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await host.page.locator('[data-watten-rematch]').screenshot({ path: testInfo.outputPath(`rematch-${viewport.width}x${viewport.height}.png`) });
      }
      await host.page.route('**/api/watten/games/*/rematch', async route => {
        requests.push({ body: route.request().postDataJSON(), expected: route.request().headers()['x-watten-expected-account-id'] });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        createdTarget = (await response.json()).game_id;
        await route.abort('failed'); // Server committed; only its HTTP confirmation is lost.
      });
      await host.page.locator('[data-watten-rematch-action=create]').click();
      await expect.poll(() => createdTarget).toMatch(/^[0-9a-f]{16}$/);
      await expect(host.page.locator('[data-watten-rematch-action=open]')).toBeEnabled();
      expect(requests).toHaveLength(1); expect(requests[0].expected).toBe(String(host.user.id));
      expect(Object.keys(requests[0].body).sort()).toEqual(['command_id', 'revision']);
      await host.page.unroute('**/api/watten/games/*/rematch');
      await host.page.locator('[data-watten-rematch-action=open]').click();
      await expect(host.page).toHaveURL(new RegExp(`/watten/spiel/${createdTarget}$`));
      await expect.poll(() => host.traffic.snapshot?.id).toBe(createdTarget);
      expect(host.traffic.snapshot.started).toBe(false);
      expect(host.traffic.snapshot.viewer.seat).toBe(0);
      expect(host.traffic.snapshot.room.recipe.password_required).toBe(false);
      expect(host.traffic.snapshot.room.recipe.schoeneres_enabled).toBe(true);
      await guest.page.locator('[data-watten-rematch-action=open]').click();
      await expect(guest.page).toHaveURL(new RegExp(`/watten/spiel/${createdTarget}$`));
      await expect(guest.page.locator('[data-watten-join] [name=password]')).toHaveCount(0);
      await guest.page.locator('[data-watten-join] button[type=submit]').click();
      await expect.poll(() => guest.traffic.snapshot?.id).toBe(createdTarget);
      await expect.poll(() => guest.traffic.snapshot.viewer?.seat).toBe(1);
      await expect(guest.page.locator('[data-watten-rematch-reservation]')).toHaveCount(0);
      for (let seat = 0; seat < players.length; seat += 1) {
        await expect(players[seat].page.locator('[data-watten-command=take-seat]')).toHaveCount(0);
        await expect.poll(() => players[seat].traffic.snapshot.viewer.seat).toBe(seat);
      }
      expect(host.traffic.snapshot.started).toBe(false);
      await host.page.locator('[data-watten-command=start]').click();
      await expect.poll(() => host.traffic.snapshot.started).toBe(true);
      expect(host.traffic.snapshot.engine.scores.every(item => item.points === 0)).toBe(true);
      expect(host.traffic.snapshot.room.series.nockerl).toEqual(sourceMarks);
      await expect(host.page.locator('.wt-series-marks')).toHaveCount(2);
      const after = await (await host.context.request.get('/api/watten/account')).json();
      expect(after.progress.total_xp).toBe(original.progress.total_xp);
      expect(after.statistics.all_matches).toBe(1);
      await host.page.goto(source);
      await expect(host.page.locator('[data-watten-rematch-action=open]')).toBeVisible();
      await host.page.locator('[data-watten-rematch-action=open]').click();
      await expect(host.page).toHaveURL(new RegExp(`/watten/spiel/${createdTarget}$`));
      expect(requests).toHaveLength(1);
      expect(host.traffic.errors).toEqual([]); expect(guest.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('ordinary four-player rematches retain a compact fixed roster and prominent loss marks', async ({ browser, baseURL }, testInfo) => {
  const players = await Promise.all([0, 1, 2, 3].map(() => player(browser, baseURL)));
  const host = players[0];
  let visitor;
  try {
    const source = await finishOpenMatch(players, { determination: 'normal' });
    const original = await Promise.all(players.map(async item => (await item.context.request.get('/api/watten/account')).json()));
    const sourceMarks = structuredClone(host.traffic.snapshot.room.series.nockerl);
    await host.page.locator('[data-watten-rematch-action=create]').click();
    await expect.poll(() => new URL(host.page.url()).pathname).not.toBe(source);
    const targetId = new URL(host.page.url()).pathname.split('/').pop();
    const rules = host.page.locator('[data-watten-waiting-rules]');
    await expect(rules).not.toHaveAttribute('open', '');
    await expect(host.page.locator('[data-watten-command=copy-link]')).toHaveCount(0);
    await expect(host.page.locator('[data-watten-notify-open-seat]')).toHaveCount(0);
    await rules.locator('summary').focus();
    await host.page.keyboard.press('Enter');
    for (const item of players) {
      if (item !== host) {
        await item.page.locator('[data-watten-rematch-action=open]').click();
        await item.page.locator('[data-watten-join] button[type=submit]').click();
      }
      await expect.poll(() => item.traffic.snapshot?.id === targetId
        && Boolean(item.traffic.snapshot.viewer?.participant_id)).toBe(true);
      await expect(item.page.locator('[data-watten-command=decline-reservation]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-command=place-cpu], [data-watten-command=remove-cpu]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-rematch-reservation]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-command=take-seat]')).toHaveCount(0);
    }
    await expect(rules).toHaveAttribute('open', '');
    await expect(rules.locator('summary')).toBeFocused();
    await rules.locator('summary').click();
    for (const { design, width } of ['classic', 'tirol'].flatMap(design => [320, 390, 768, 1280].map(width => ({ design, width })))) {
      const designSwitch = host.page.locator('[data-watten-waiting-controls] [data-watten-design-toggle]');
      if (await host.page.locator('html').getAttribute('data-watten-design') !== design) await designSwitch.click();
      await expect(host.page.locator('html')).toHaveAttribute('data-watten-design', design);
      await host.page.setViewportSize({ width, height: 844 });
      const room = host.page.locator('.wt-waiting--rematch');
      await expectReachable(host.page, '[data-watten-waiting-controls] [data-watten-design-toggle]');
      const switchBox = await designSwitch.boundingBox();
      expect(switchBox.width).toBe(44);
      expect(switchBox.height).toBe(44);
      if (width <= 600) {
        const ambience = room.locator('.wt-sound button');
        await expect(ambience).toContainText('Kulisse');
        await expectReachable(host.page, '[data-watten-waiting-controls] .wt-sound button');
        const soundBox = await ambience.boundingBox();
        expect(soundBox.width).toBe(44);
        expect(soundBox.height).toBe(44);
        expect(Math.abs(soundBox.y - switchBox.y)).toBeLessThan(1);
      }
      const geometry = await room.evaluate(node => {
        const teams = [...node.querySelectorAll('.wt-team')].map(team => team.getBoundingClientRect());
        const scores = [...node.querySelectorAll('.wt-series-value')];
        return { height: node.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth,
          teams: teams.map(box => ({ x: box.x, right: box.right, y: box.y })),
          sizes: scores.map(score => parseFloat(getComputedStyle(score).fontSize)) };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.teams).toHaveLength(2);
      expect(geometry.teams[0].y).toBeCloseTo(geometry.teams[1].y, 0);
      expect(geometry.teams[0].right).toBeLessThanOrEqual(geometry.teams[1].x);
      expect(geometry.sizes).toHaveLength(2);
      expect(geometry.sizes.every(size => size >= 30)).toBe(true);
      if (width <= 390) expect(geometry.height).toBeLessThan(620);
      await room.screenshot({ path: testInfo.outputPath(`compact-rematch-${design}-${width}.png`) });
    }
    visitor = await player(browser, baseURL);
    await visitor.page.goto('/watten');
    const listing = visitor.page.locator(`[data-watten-table="${targetId}"]`);
    await expect(listing.locator('a')).toHaveCount(0);
    await expect(listing).toContainText('Feste Besetzung');
    await visitor.page.goto(`/watten/spiel/${targetId}`);
    await expect(visitor.page.locator('[data-watten-join]')).toHaveCount(0);
    await expect(visitor.page.locator('[data-watten-spectate-link]')).toHaveCount(0);
    await expect(visitor.page.locator('.wt-join a[href="/watten"]')).toBeVisible();
    for (const [index, seat] of [0, 1, 2, 3].entries()) {
      const item = players[index];
      await expect.poll(() => item.traffic.snapshot.viewer.seat).toBe(seat);
      await expect(item.page.locator('.wt-seat-slot.is-own')).toContainText(item.user.username);
    }
    expect(host.traffic.snapshot.started).toBe(false);
    await host.page.locator('[data-watten-command=start]').click();
    await expect.poll(() => players.every(item => item.traffic.snapshot.started)).toBe(true);
    for (let index = 0; index < players.length; index += 1) {
      expect(players[index].traffic.snapshot.engine.scores.every(score => score.points === 0)).toBe(true);
      expect(players[index].traffic.snapshot.room.series.nockerl).toEqual(sourceMarks);
      const current = (await (await players[index].context.request.get('/api/watten/account')).json());
      expect(current.progress.total_xp).toBe(original[index].progress.total_xp);
      expect(current.statistics.all_matches).toBe(1);
      expect(players[index].traffic.errors).toEqual([]);
    }
  } finally { await Promise.allSettled([...players, visitor].filter(Boolean).map(item => item.context.close())); }
});
