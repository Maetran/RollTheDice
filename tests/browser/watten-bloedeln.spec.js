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
  for (const caller of players.filter(peer => peer.traffic.snapshot.engine.actions.includes('show_ready'))) {
    const role = caller.traffic.snapshot.engine.announcement_roles.strike === caller.traffic.snapshot.viewer.seat
      ? (language === 'de' ? 'Schlag zeigen' : 'Show strike') : (language === 'de' ? 'Farbe zeigen' : 'Show trump suit');
    await expect(caller.page.locator('[data-wt-panel]')).toHaveText(role);
    await expect(caller.page.locator('[data-wt-panel] h3, [data-wt-panel] p')).toHaveCount(0);
  }
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
  if (players.some(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln'
      || peer.traffic.snapshot.engine.preplay.bloedeln_status === 'accepted')) {
    const callers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('inspection_ack'));
    expect(callers).toHaveLength(2);
    for (const viewport of [{ width: 393, height: 852 }, { width: 320, height: 568 }]) {
      for (const peer of players) await peer.page.setViewportSize(viewport);
      for (const caller of callers) {
        await expectReachable(caller.page, '[data-watten-action=inspection_ack]');
        await expect.poll(() => caller.page.evaluate(() => {
          const rect = node => node.getBoundingClientRect();
          const shown = node => rect(node).width > 0 && rect(node).height > 0 && getComputedStyle(node).visibility !== 'hidden';
          const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
          const obstacles = [...document.querySelectorAll('.wt-seat-badge, .wt-seat-name, .wt-seat-call-role, '
            + '.wt-backs > i:not([hidden]), .wt-stock, [data-wt-panel]')].filter(shown);
          const faces = [...document.querySelectorAll('[data-watten-inspection] .wt-card')];
          const captions = [...document.querySelectorAll('[data-watten-inspection] figcaption')];
          const failures = [];
          if (faces.length !== 2) failures.push('inspection must show exactly two permitted faces');
          for (const [index, face] of faces.entries()) {
            const box = rect(face), width = Number.parseFloat(getComputedStyle(face).width);
            if (width < 51.9) failures.push(`face ${index} too small: ${width}px`);
            if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) failures.push(`face ${index} outside viewport`);
          }
          for (const [index, part] of [...faces, ...captions].entries()) {
            const box = rect(part);
            for (const obstacle of obstacles) if (overlap(box, rect(obstacle))) {
              failures.push(`inspection part ${index} overlaps ${obstacle.className || 'back card'} at seat ${obstacle.closest('[data-wt-seat]')?.dataset.wtSeat || '-'}`);
            }
          }
          const ack = document.querySelector('[data-watten-action=inspection_ack]'), ackBox = rect(ack);
          if (ackBox.width < 44 || ackBox.height < 44 || ackBox.left < 0 || ackBox.top < 0
            || ackBox.right > innerWidth || ackBox.bottom > innerHeight) failures.push('ACK lacks a complete 44px target');
          if (overlap(ackBox, rect(document.querySelector('[data-wt-panel]')))) failures.push('ACK overlaps Blödeln panel');
          if (!ack.contains(document.elementFromPoint(ackBox.x + ackBox.width / 2, ackBox.y + ackBox.height / 2))) failures.push('ACK is covered');
          return [...new Set(failures)];
        }), { message: `${viewport.width}px inspection keeps readable faces, role labels and ACK clear of the real Blödeln panel and painted hands` }).toEqual([]);
      }
      for (const peer of players) for (const kind of ['preplay_accept', 'preplay_decline']) {
        if (await peer.page.locator(`[data-watten-action=${kind}]`).count()) await expectReachable(peer.page, `[data-watten-action=${kind}]`);
      }
    }
  }
  await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
  await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
}

async function request(players, nonCallers, language, observers = []) {
  const requester = nonCallers[0];
  await requester.page.locator('[data-watten-action=request_bloedeln]').click();
  const all = [...players, ...observers];
  await expect.poll(() => all.every(peer => peer.traffic.snapshot?.engine?.preplay.pending?.kind === 'bloedeln')).toBe(true);
  const pending = requester.traffic.snapshot.engine.preplay.pending;
  const responder = nonCallers.find(peer => peer.traffic.snapshot.viewer.seat === pending.responder);
  expect(pending.requester).toBe(requester.traffic.snapshot.viewer.seat);
  expect(responder).toBeTruthy();
  for (const peer of all) {
    const question = peer.page.locator('[data-watten-preplay-pending=bloedeln]');
    await expect(question).toBeVisible();
    if (peer === requester) {
      await expect(question.locator('h3')).toContainText(language === 'de' ? 'Du fragst' : 'You ask');
      await expect(question.locator('h3')).toContainText(responder.user.username);
    } else {
      await expect(question.locator('h3')).toContainText(requester.user.username);
      if (peer !== responder) await expect(question.locator('h3')).toContainText(responder.user.username);
    }
    const explanation = question.locator('p').filter({ hasText: language === 'de'
      ? 'ursprüngliche unterste Karte' : 'original bottom cards' });
    await expect(explanation).toHaveCount(nonCallers.includes(peer) ? 1 : 0);
    await expect(peer.page.locator('[data-watten-action=preplay_accept]')).toHaveCount(peer === responder ? 1 : 0);
    await expect(peer.page.locator('[data-watten-action=preplay_decline]')).toHaveCount(peer === responder ? 1 : 0);
    const actions = peer.traffic.snapshot.engine.actions || [];
    expect(actions).not.toContain('play_card');
    expect(actions).not.toContain('bid');
    if (peer !== responder) await expect(peer.page.locator('[data-wt-live]')).toHaveText(language === 'de'
      ? `${responder.user.username} entscheidet über Blödeln.` : `${responder.user.username} is deciding on Blödeln.`);
  }
  return { requester, responder };
}

async function expectNamedAgreement(peers, nonCallers, language) {
  for (const peer of peers) {
    const status = peer.page.locator('[data-watten-bloedeln-status=accepted]');
    await expect(status).toBeVisible();
    if (nonCallers.includes(peer)) {
      const other = nonCallers.find(player => player !== peer);
      await expect(status).toHaveText(language === 'de' ? `Du und ${other.user.username} blödelt.`
        : `You and ${other.user.username} are playing Blödeln.`);
    } else {
      for (const player of nonCallers) await expect(status).toContainText(player.user.username);
      await expect(status).not.toContainText(language === 'de' ? 'Du und' : 'You and');
      for (const player of peers.filter(player => !nonCallers.includes(player))) {
        await expect(status).not.toContainText(player.user.username);
      }
    }
    await expect(status).not.toContainText('Ihr blödelt');
    await expect(peer.page.locator('[data-watten-action=preplay_accept], [data-watten-action=preplay_decline]')).toHaveCount(0);
  }
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
      const { responder } = await request(players, nonCallers, language);
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
        await expect(peer.page.locator('[data-watten-bloedeln-status=declined]')).toHaveCount(0);
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
        await expect(peer.page.locator('[data-watten-bloedeln-status=declined]')).toHaveCount(0);
      }
      const actor = players.find(peer => peer.traffic.snapshot.engine.actions.includes('play_card'));
      await actor.page.locator(`[data-wt-hand] button[data-card="${actor.traffic.snapshot.engine.hand[0].card}"]`).press('Enter');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === 1)).toBe(true);
      for (const peer of players) await expect(peer.page.locator('[data-watten-action=request_bloedeln]')).toHaveCount(0);
      await expectClean(players);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });

  test(`blind ${language}: agreement automatically plays the original bottom cards on their owners' turns`, async ({ browser, baseURL }) => {
    const players = [];
    let spectator;
    try {
      const { path, nonCallers } = await startBlind(browser, baseURL, language, players);
      spectator = await player(mobile(browser), baseURL, language);
      await spectator.page.goto(`${path}/zuschauen`);
      await expect(spectator.page.locator('[data-wt-table]')).toBeVisible();
      const all = [...players, spectator];
      const { responder } = await request(players, nonCallers, language, [spectator]);
      await responder.page.locator('[data-watten-action=preplay_accept]').click();
      await expect.poll(() => all.every(peer => peer.traffic.snapshot.engine.preplay.bloedeln_status === 'accepted')).toBe(true);
      await expectNamedAgreement(all, nonCallers, language);
      await inspect(players);
      await expectNamedAgreement(all, nonCallers, language);
      const forced = nonCallers.map(peer => {
        const cards = peer.traffic.snapshot.engine.preplay.bloedeln_cards;
        expect(cards).toHaveLength(1);
        expect(cards[0].seat).toBe(peer.traffic.snapshot.viewer.seat);
        expect(cards[0].card).toBe(peer.traffic.snapshot.engine.hand.at(-1).card);
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
      // One real human plays the informed leader. Both following non-callers
      // then contribute their original bottom cards without another UI command.
      const leader = players.find(peer => peer.traffic.snapshot.engine.actions.includes('play_card'));
      expect(forced.some(item => item.owner === leader)).toBe(false);
      for (const item of forced) await expect(item.owner.page.locator('[data-wt-hand] button:enabled')).toHaveCount(0);
      const first = { seat: leader.traffic.snapshot.viewer.seat, card: leader.traffic.snapshot.engine.hand[0].card };
      const played = [first, ...forced.toSorted((a, b) => ((a.seat - first.seat + 4) % 4)
        - ((b.seat - first.seat + 4) % 4)).map(({ seat, card }) => ({ seat, card }))];
      await leader.page.locator(`[data-wt-hand] button[data-card="${first.card}"]`).press('Enter');
      await expect.poll(() => all.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === 3)).toBe(true);
      for (const peer of all) {
        expect(peer.traffic.snapshot.engine.current_trick.cards).toEqual(played);
        for (const { card } of played) await expect(peer.page.locator(`[data-wt-trick] .wt-trick-card[data-card="${card}"]`)).toHaveCount(1);
        if (peer === spectator) expect(peer.traffic.snapshot.engine.preplay.bloedeln_cards).toEqual([]);
      }
      for (const item of forced) expect(item.owner.traffic.commands.filter(command => command.action === 'watten_command'
        && command.kind === 'play_card')).toEqual([]);
      expect(forced.every(item => played.some(play => play.seat === item.seat && play.card === item.card))).toBe(true);
      for (const peer of all) await expect(peer.page.locator('[data-watten-bloedeln-status]')).toHaveCount(0);
      await expectClean(all);
    } finally { await Promise.allSettled([...players, spectator].filter(Boolean).map(peer => peer.context.close())); }
  });
}
