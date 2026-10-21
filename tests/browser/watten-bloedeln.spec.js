const { test, expect } = require('@playwright/test');
const { player, create, action } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(90_000);
const mobile = browser => ({ newContext: options => browser.newContext({ ...options,
  viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) });

async function startBlind(browser, baseURL, language, players) {
  for (let seat = 0; seat < 4; seat++) players.push(await player(mobile(browser), baseURL, language));
  const path = await create(players, { count: 4, target: 11 });
  await expect.poll(() => players.filter(peer => peer.traffic.snapshot?.engine?.actions.includes('request_bloedeln')).length).toBe(2);
  const nonCallers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('request_bloedeln'));
  for (const peer of nonCallers) {
    await expectReachable(peer.page, '[data-watten-action=request_bloedeln]');
    await expect(peer.page.locator('[data-watten-action=request_bloedeln]')).toHaveText('Blödeln?');
    expect(await peer.page.locator('[data-watten-action=request_bloedeln]').evaluate(node => Boolean(node.closest('details')))).toBe(false);
    await expect(peer.page.locator('[data-watten-action=preplay_accept], [data-watten-action=preplay_decline]')).toHaveCount(0);
  }
  return { path, nonCallers };
}

async function inspect(players) {
  await action(players, 'show_ready'); await action(players, 'show_ready');
  await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
  await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
}

async function request(players, nonCallers) {
  const requester = nonCallers[0];
  await requester.page.locator('[data-watten-action=request_bloedeln]').click();
  await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln')).toBe(true);
  const pending = requester.traffic.snapshot.engine.preplay.pending;
  const responder = nonCallers.find(peer => peer.traffic.snapshot.viewer.seat === pending.responder);
  expect(pending.requester).toBe(requester.traffic.snapshot.viewer.seat);
  expect(responder).toBeTruthy();
  for (const peer of players) {
    const question = peer.page.locator('[data-watten-preplay-pending=bloedeln]');
    await expect(question).toBeVisible();
    await expect(question.locator('h3')).toContainText(requester.user.username);
    await expect(peer.page.locator('[data-watten-action=preplay_accept]')).toHaveCount(peer === responder ? 1 : 0);
    await expect(peer.page.locator('[data-watten-action=preplay_decline]')).toHaveCount(peer === responder ? 1 : 0);
    expect(peer.traffic.snapshot.engine.actions).not.toContain('play_card');
    expect(peer.traffic.snapshot.engine.actions).not.toContain('bid');
  }
  return { requester, responder };
}

async function expectClean(players) {
  for (const peer of players) {
    expect(peer.traffic.errors).toEqual([]);
    await expect(peer.page.locator('[data-watten-flash]')).toBeEmpty();
    await expect(peer.page.locator('[data-watten-bloedeln-cards]')).toHaveCount(0);
  }
}

for (const language of ['de', 'en']) {
  test(`blind ${language}: an optional request blocks play until its named recipient declines`, async ({ browser, baseURL }) => {
    const players = [];
    try {
      const { nonCallers } = await startBlind(browser, baseURL, language, players);
      const { responder } = await request(players, nonCallers);
      // The open request blocks card/bid actions, while both callers can still inspect.
      await inspect(players);
      for (const peer of players) {
        expect(peer.traffic.snapshot.engine.preplay.bloedeln_status).toBe('pending');
        expect(peer.traffic.snapshot.engine.current_trick.cards).toEqual([]);
        expect(peer.traffic.snapshot.engine.actions).not.toContain('play_card');
        expect(peer.traffic.snapshot.engine.actions).not.toContain('bid');
        await expect(peer.page.locator('[data-wt-hand] button:enabled')).toHaveCount(0);
      }
      await expectReachable(responder.page, '[data-watten-action=preplay_decline]');
      await responder.page.locator('[data-watten-action=preplay_decline]').click();
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.bloedeln_status === 'declined'
        && peer.traffic.snapshot.engine.preplay.pending === null)).toBe(true);
      for (const peer of players) {
        await expect(peer.page.locator('[data-watten-bloedeln-status=declined]')).toHaveText(language === 'de' ? 'Kein Blödeln' : 'No Blödeln');
        expect(peer.traffic.snapshot.engine.preplay.bloedeln_cards).toEqual([]);
      }
      await expect.poll(() => players.some(peer => peer.traffic.snapshot.engine.actions.includes('play_card'))).toBe(true);
      await expectClean(players);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });

  test(`blind ${language}: without a request, inspection leads straight to normal play`, async ({ browser, baseURL }) => {
    const players = [];
    try {
      await startBlind(browser, baseURL, language, players);
      await inspect(players);
      await expect.poll(() => players.some(peer => peer.traffic.snapshot.engine.actions.includes('play_card'))).toBe(true);
      for (const peer of players) {
        expect(peer.traffic.snapshot.engine.preplay.pending).toBeNull();
        expect(peer.traffic.snapshot.engine.preplay.bloedeln_cards).toEqual([]);
        await expect(peer.page.locator('[data-watten-preplay-pending=bloedeln]')).toHaveCount(0);
      }
      const actor = players.find(peer => peer.traffic.snapshot.engine.actions.includes('play_card'));
      await actor.page.locator(`[data-wt-hand] button[data-card="${actor.traffic.snapshot.engine.hand[0].card}"]`).press('Enter');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === 1)).toBe(true);
      for (const peer of players) await expect(peer.page.locator('[data-watten-action=request_bloedeln]')).toHaveCount(0);
      await expectClean(players);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });

  test(`blind ${language}: agreement keeps both bottom cards private until each owner plays their forced card`, async ({ browser, baseURL }) => {
    const players = [];
    let spectator;
    try {
      const { path, nonCallers } = await startBlind(browser, baseURL, language, players);
      const { responder } = await request(players, nonCallers);
      await responder.page.locator('[data-watten-action=preplay_accept]').click();
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.bloedeln_status === 'accepted')).toBe(true);
      await inspect(players);
      spectator = await player(mobile(browser), baseURL, language);
      await spectator.page.goto(`${path}/zuschauen`);
      await expect(spectator.page.locator('[data-wt-table]')).toBeVisible();
      const all = [...players, spectator];
      const forced = nonCallers.map(peer => {
        const cards = peer.traffic.snapshot.engine.preplay.bloedeln_cards;
        expect(cards).toHaveLength(1);
        expect(cards[0].seat).toBe(peer.traffic.snapshot.viewer.seat);
        return { ...cards[0], owner: peer };
      });
      expect(new Set(forced.map(item => item.card)).size).toBe(2);
      for (const peer of all) {
        const cards = peer.traffic.snapshot.engine.preplay.bloedeln_cards;
        expect(cards.length).toBeLessThanOrEqual(peer === spectator ? 0 : 1);
        for (const card of cards) expect(card.seat).toBe(peer.traffic.snapshot.viewer.seat);
        for (const item of forced.filter(item => item.owner !== peer)) {
          await expect(peer.page.locator(`.wt-card[data-card="${item.card}"]`)).toHaveCount(0);
        }
        await expect(peer.page.locator('[data-wt-trick] .wt-trick-card')).toHaveCount(0);
        await expect(peer.page.locator('[data-watten-bloedeln-cards]')).toHaveCount(0);
      }
      // The leader is informed and may lead any card; the next two seats are
      // precisely the two blind non-callers. Stop before the fourth informed
      // player so this test need not reproduce trump-following rules.
      const played = [];
      for (let index = 0; index < 3; index++) {
        const actor = players.find(peer => peer.traffic.snapshot.engine.actions.includes('play_card'));
        const engine = actor.traffic.snapshot.engine;
        const required = forced.find(item => item.owner === actor);
        const card = required?.card || engine.hand[0].card;
        if (required) {
          await expect(actor.page.locator(`[data-wt-hand] button[data-card="${card}"]`)).toBeEnabled();
          for (const other of engine.hand.filter(item => item.card !== card)) {
            await expect(actor.page.locator(`[data-wt-hand] button[data-card="${other.card}"]`)).toBeDisabled();
          }
        }
        await actor.page.locator(`[data-wt-hand] button[data-card="${card}"]`).press('Enter');
        played.push({ seat: engine.viewer.seat, card });
        await expect.poll(() => all.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === played.length)).toBe(true);
        for (const peer of all) {
          expect(peer.traffic.snapshot.engine.current_trick.cards).toEqual(played);
          await expect(peer.page.locator(`[data-wt-trick] .wt-trick-card[data-card="${card}"]`)).toHaveCount(1);
          if (peer === spectator) expect(peer.traffic.snapshot.engine.preplay.bloedeln_cards).toEqual([]);
          for (const item of forced.filter(item => item.owner !== peer && !played.some(play => play.card === item.card))) {
            await expect(peer.page.locator(`.wt-card[data-card="${item.card}"]`)).toHaveCount(0);
          }
        }
      }
      expect(forced.every(item => played.some(play => play.seat === item.seat && play.card === item.card))).toBe(true);
      for (const peer of all) await expect(peer.page.locator('[data-watten-bloedeln-status]')).toHaveCount(0);
      await expectClean(all);
    } finally { await Promise.allSettled([...players, spectator].filter(Boolean).map(peer => peer.context.close())); }
  });
}
