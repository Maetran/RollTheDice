const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

const { player, create, action, answerPartnerFeedback, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');
const { exportTableReview } = require('./helpers/watten-review.cjs');
const { expectReachable } = require('./table-viewport');

for (const language of ['de', 'en']) {
  test(`${language}: public lobby survives unavailable auth without reading games`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
    const privateReads = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/games')) privateReads.push(request.url()); });
    await page.route('**/api/auth/me', route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
    await page.goto(`/watten${language === 'en' ? '?lang=en' : ''}`);
    await expect(page.locator('[data-watten-signin]')).toBeVisible();
    const guide = page.locator('[data-watten-lobby-guide]');
    await expect(guide).toBeVisible();
    await expect(guide.locator('h2')).toHaveText(language === 'en' ? 'Watten rules at a glance' : 'Watten-Regeln kurz erklärt');
    await expect(guide).toContainText(language === 'en' ? 'Everyone receives five cards.' : 'Jede Person bekommt fünf Karten.');
    await expect(page.locator('[data-watten-create]')).toHaveCount(0);
    for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const play = await page.locator('[data-watten-signin]').boundingBox();
      expect(play.y + play.height).toBeLessThan(viewport.height);
      await page.screenshot({ path: testInfo.outputPath(`watten-lobby-${language}-${viewport.width}.png`), fullPage: true });
    }
    await page.locator('[data-watten-nav] a[href^="/watten/regeln"]').click();
    await expect(page).toHaveURL(new RegExp(`/watten/regeln${language === 'en' ? '\\?lang=en' : ''}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    expect(privateReads).toEqual([]);
  });
}

test('two real human accounts bid, pause with an open bid, return and finish a durable match', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL, 'en')];
  try {
    for (const [index, item] of players.entries()) {
      await item.page.goto(`/watten${index ? '?lang=en' : ''}`);
      await expect(item.page.locator('[data-watten-create-open]')).toBeVisible();
      const guide = item.page.locator('[data-watten-lobby-guide]');
      await expect(guide).toBeVisible();
      await expect(guide.locator('h2')).toHaveText(index ? 'Watten rules at a glance' : 'Watten-Regeln kurz erklärt');
      await expect(guide).toContainText(index ? 'Everyone receives five cards.' : 'Jede Person bekommt fünf Karten.');
    }
    const path = await create(players);
    await normalCall(players);
    for (const item of players) {
      expect(item.traffic.snapshot.engine.round_summary).toBeUndefined();
      expect(item.traffic.snapshot.engine.trick_history).toBeNull();
      await expect(item.page.locator('[data-watten-round-call]')).toHaveCount(0);
    }
    await playOne(players);
    await action(players, 'bid');
    await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
    const decider = players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold'));
    const hands = players.map(item => item.traffic.snapshot.engine.hand);
    await decider.page.locator('[data-watten-command=leave-match]').click();
    await decider.page.locator('[data-watten-command=leave-confirm]').click();
    await expect(decider.page).toHaveURL(/\/watten$/);
    const other = players.find(item => item !== decider);
    await expect(other.page.locator('[data-watten-paused]')).toBeVisible();
    expect(other.traffic.snapshot.engine.bid.pending.points).toBe(3);
    await decider.page.goto(path);
    await expect(decider.page.locator('[data-watten-command=resume]')).toBeVisible();
    expect(decider.traffic.snapshot.paused).toBe(true);
    await decider.page.locator('[data-watten-command=resume]').click();
    await expect.poll(() => players.every(item => !item.traffic.snapshot.paused)).toBe(true);
    expect(players.map(item => item.traffic.snapshot.engine.hand)).toEqual(hands);
    await action(players, 'respond_hold', 'hold');
    for (let count = 0; count < 12 && players[0].traffic.snapshot.engine.phase === 'play'; count += 1) await playOne(players);
    for (const item of players) {
      await expect(item.page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 10000 });
      expect(item.traffic.snapshot.result_persisted).toBe(true);
      expect(item.traffic.snapshot.engine.scores.some(score => score.points === 3)).toBe(true);
      const engine = item.traffic.snapshot.engine;
      expect(engine.round_summary).toEqual({ strike_rank: '7', trump_suit: 'bells', rechter: 'bells-7' });
      expect(engine.options.trick_history).toBe(false);
      expect(engine.trick_history.length).toBeGreaterThan(0);
      expect(engine.trick_history.length).toBeLessThanOrEqual(5);
      const language = await item.page.locator('html').getAttribute('lang');
      const roundCall = item.page.locator('[data-watten-round-call]');
      await item.page.locator('.wt-final-call > summary').click();
      await expect(roundCall).toBeVisible();
      await expect(roundCall.locator('dt')).toHaveText(language === 'en' ? ['Strike', 'Trump suit'] : ['Schlag', 'Farbe']);
      await expect(roundCall.locator('figure [data-card]')).toHaveAttribute('data-card', 'bells-7');
      const history = item.page.locator('[data-wt-history]');
      await expect(history).toBeVisible();
      const historyLabel = language === 'en'
        ? `Round history (${engine.trick_history.length})` : `Rundenverlauf (${engine.trick_history.length})`;
      await expect(history.locator('summary')).toHaveText(historyLabel, { useInnerText: true });
      await expect(history.locator('summary')).toHaveAccessibleName(historyLabel);
      if (!await history.evaluate(node => node.open)) await history.locator('summary').click();
      await expect(history.locator('.wt-history > li')).toHaveCount(engine.trick_history.length);
      expect(await history.locator('.wt-history [data-card]').evaluateAll(nodes => nodes.map(node => node.dataset.card)))
        .toEqual(engine.trick_history.flatMap(trick => trick.cards.map(card => card.card)));
      expect(await history.locator('.wt-history > li').evaluateAll(nodes => nodes.every((node, index) =>
        !index || node.getBoundingClientRect().top >= nodes[index - 1].getBoundingClientRect().bottom - 1))).toBe(true);
      expect(item.traffic.errors).toEqual([]);
      expect(item.traffic.commands.filter(command => ['join_game', 'rejoin_game'].includes(command.action))
        .every(command => command.expected_account_id === item.user.id)).toBe(true);
    }
    // The final call and all played tricks are reconstructed on a real reload;
    // the table option restricts live history, rather than the finished round.
    const finalTricks = players[0].traffic.snapshot.engine.trick_history;
    await players[0].page.reload();
    await expect(players[0].page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 10000 });
    expect(players[0].traffic.snapshot.engine.round_summary).toEqual({ strike_rank: '7', trump_suit: 'bells', rechter: 'bells-7' });
    expect(players[0].traffic.snapshot.engine.trick_history).toEqual(finalTricks);
    await expect(players[0].page.locator('[data-wt-history]')).toBeVisible();
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

for (const language of ['de', 'en']) {
test(`${language}: three-player solo owns both normal calls and private partner advice stays above the receiving choices`, async ({ browser, baseURL }) => {
  const players = await Promise.all([0, 1, 2].map(index => player(browser, baseURL, language, { role: index === 0 ? 'admin' : 'user' })));
  try {
    await create(players, { partnerHand: true });
    const { striker, colourer } = await normalCall(players);
    expect(striker).toBe(colourer);
    const solo = striker;
    const pair = players.filter(item => item !== solo);
    for (const item of players) await expect(item.page.locator('[data-watten-feedback-dialog]')).toHaveCount(0);
    await playOne(players);
    await action(pair, 'bid');
    for (const bidder of pair) await expect(bidder.page.locator('[data-watten-feedback-dialog]')).toHaveCount(0);
    // The solo's counteroffer makes the pair the receiving team. Advice is
    // available to both receivers and remains private to that pair.
    await action([solo], 'respond_counter', 'counter');
    for (const receiver of pair) await expect(receiver.page.locator('[data-watten-feedback-dialog]')).toBeVisible();
    await expect(solo.page.locator('[data-watten-feedback-dialog]')).toHaveCount(0);
    const decider = pair.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold'));
    const adviser = pair.find(item => item !== decider);
    const advice = decider.page.locator('[data-watten-bid] [data-watten-partner-advice]');
    await expect(advice).toHaveText(language === 'de'
      ? `Von ${adviser.user.username} noch keine Auskunft` : `No advice from ${adviser.user.username} yet`);
    await expect(advice).not.toHaveAttribute('data-feedback-value');
    await expect(decider.page.locator('[data-watten-bid] .wt-choice-row'))
      .toHaveCount(1);
    expect(await advice.evaluate(node => node.nextElementSibling.matches('.wt-choice-row'))).toBe(true);
    await exportTableReview(decider, `bid-none-${language}`);
    const feedbackValue = language === 'de' ? 'good' : 'bad';
    const feedbackText = language === 'de' ? 'Fühl mich gut' : 'Feeling bad';
    await adviser.page.locator(`[data-watten-command=feedback][data-value=${feedbackValue}]`).click();
    await expect(adviser.page.locator('[data-watten-feedback-dialog]')).toHaveCount(0);
    await answerPartnerFeedback([decider], 'good');
    await expect(decider.page.locator('[data-watten-feedback-received]')).toBeVisible();
    await expect(decider.page.locator('[data-watten-bid] [data-watten-feedback-received]'))
      .toHaveText(language === 'de'
        ? `${adviser.user.username} meint: ${feedbackText}` : `${adviser.user.username} says: ${feedbackText}`);
    await exportTableReview(decider, `bid-${feedbackValue}-${language}`);
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }]) {
      await decider.page.setViewportSize(viewport);
      await expect.poll(() => advice.evaluate(node => {
        const line = node.getBoundingClientRect(), choices = node.nextElementSibling.getBoundingClientRect();
        const pseudo = getComputedStyle(node, '::before');
        return { above: line.height > 0 && line.bottom <= choices.top + 1,
          noPseudo: pseudo.display === 'none' || ['none', 'normal'].includes(pseudo.content),
          textFits: node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight };
      }), { message: 'full named advice stays above hold/go/counter without an overlaid symbol' })
        .toEqual({ above: true, noPseudo: true, textFits: true });
      for (const value of ['hold', 'go', 'counter']) {
        await expectReachable(decider.page, `[data-watten-bid] [data-kind="respond"][data-value="${value}"]`);
      }
    }
    await expect(solo.page.locator('[data-watten-feedback-received]')).toHaveCount(0);
    expect(decider.traffic.snapshot.engine.feedback.some(item => item.value === feedbackValue)).toBe(true);
    expect(solo.traffic.snapshot.engine.feedback).toEqual([]);
    const viewer = pair[0];
    await expect(viewer.page.locator('.wt-partner-hand')).toBeVisible();
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 600 }, { width: 568, height: 320 }, { width: 667, height: 600 }, { width: 760, height: 600 }]) {
      await viewer.page.setViewportSize(viewport);
      await viewer.page.evaluate(() => scrollTo(0, 0));
      await expectTableHeaderReachable(viewer.page);
      const disclosure = viewer.page.locator('details.wt-partner-hand > summary');
      if (await disclosure.count()) {
        await disclosure.click();
        await expect(viewer.page.locator('.wt-partner-popover')).toBeVisible();
        await expectTableHeaderReachable(viewer.page);
        await disclosure.click();
      }
    }
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
}

test('account changes during card decoding bind the new mount before opening a socket', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL, 'en')];
  try {
    const tablePath = await create(players, { start: false });
    const original = players[0];
    await original.page.addInitScript(() => {
      const decode = Image.prototype.decode;
      Image.prototype.decode = async function () {
        if (!sessionStorage.getItem('watten-test-decode-held')) {
          sessionStorage.setItem('watten-test-decode-held', '1');
          await new Promise(resolve => { window.releaseWattenDecode = resolve; });
        }
        return decode.call(this);
      };
    });
    const before = original.traffic.commands.length;
    const unexpectedHome = [];
    original.page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === original.page.mainFrame()
        && new URL(request.url()).pathname === '/') unexpectedHome.push(request.url());
    });
    await original.page.goto(tablePath);
    await expect.poll(() => original.page.evaluate(() => typeof window.releaseWattenDecode)).toBe('function');
    await original.context.clearCookies();
    await original.context.addCookies(await players[1].context.cookies());
    await original.page.evaluate(() => window.releaseWattenDecode());
    await expect(original.page.locator('[data-watten-nav] a[href="/watten/konto/fortschritt"]'))
      .toHaveAttribute('aria-label', new RegExp(`${players[1].user.username}$`));
    await expect(original.page.locator('.wt-seat-slot.is-own')).toContainText(players[1].user.username);
    await expect(original.page).toHaveURL(new RegExp(`${tablePath}$`));
    expect(unexpectedHome).toEqual([]);
    const bindings = original.traffic.commands.slice(before).filter(command => ['join_game', 'rejoin_game'].includes(command.action));
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.every(command => command.expected_account_id === players[1].user.id)).toBe(true);
    expect(original.traffic.errors).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

test('page lifecycle handlers clear private state synchronously and restore through fresh authentication', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL)];
  try {
    await create(players);
    await normalCall(players);
    const original = players[0];
    await expect(original.page.locator('[data-wt-hand] button')).toHaveCount(5);
    // Exercise the persisted-page event contract explicitly. Physical browser
    // BFCache eligibility is a separate browser/device acceptance check.
    const cleared = await original.page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      return document.querySelector('#wattenApp').childElementCount;
    });
    expect(cleared).toBe(0);
    const before = original.traffic.commands.length;
    await original.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(original.page.locator('[data-wt-hand] button')).toHaveCount(5);
    expect(original.traffic.commands.slice(before).filter(command => command.action === 'rejoin_game')
      .every(command => command.expected_account_id === original.user.id)).toBe(true);
    expect(original.traffic.errors).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

for (const count of [2, 3, 4]) {
  test(`${count}-player host fills CPU seats in creation, adjusts them and starts autonomous play manually`, async ({ browser, baseURL }) => {
    test.setTimeout(90000);
    const host = await player(browser, baseURL, count === 3 ? 'en' : 'de', { role: 'admin' });
    if (count === 4) await host.page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      await create([host], { count, reference: true, start: false, cpuFill: true });
      for (let seat = 1; seat < count; seat += 1) {
        await expect.poll(() => host.traffic.snapshot?.room.seats[seat].is_cpu).toBe(true);
        await expect(host.page.locator(`[data-watten-seat="${seat}"] strong`)).not.toHaveText('');
      }
      await host.page.locator('[data-watten-command=remove-cpu][data-seat="1"]').click();
      await expect.poll(() => host.traffic.snapshot.room.seats[1].is_cpu).toBe(false);
      await host.page.locator('[data-watten-command=place-cpu][data-seat="1"]').click();
      await expect.poll(() => host.traffic.snapshot.room.seats.every(seat => seat.participant_id)).toBe(true);
      expect(host.traffic.snapshot.started).toBe(false);
      expect(host.traffic.snapshot.room.seats.filter(seat => seat.is_cpu)).toHaveLength(count - 1);
      expect(new Set(host.traffic.snapshot.room.seats.map(seat => seat.name)).size).toBe(count);
      await host.page.locator('[data-watten-command=start]').click();
      let observedPlay = false;
      let continuedDeal = false;
      // Optional requests remain available while a CPU owns the next move.
      // Only an actual human progress action may release this driver.
      const progressActions = new Set(['show_ready', 'inspection_ack', 'announce_strike', 'announce_colour',
        'respond_go', 'respond_hold', 'bid', 'play_card', 'preplay_decline']);
      for (let turn = 0; turn < 60; turn += 1) {
        await expect.poll(() => {
          const engine = host.traffic.snapshot?.engine;
          return engine && (engine.actions.some(kind => progressActions.has(kind))
            || ['deal_complete', 'match_complete'].includes(engine.phase));
        }, { timeout: 20000 }).toBeTruthy();
        const engine = host.traffic.snapshot.engine;
        if (engine.phase === 'match_complete') break;
        if (engine.phase === 'deal_complete') {
          if (engine.retourschneider?.status === 'available') {
            const choice = engine.retourschneider;
            // This host is the only human: only its mixed team can receive an
            // offer. Its CPU partner waits and follows the human's choice.
            expect(choice.members).toContain(host.traffic.snapshot.viewer.participant_id);
            expect(engine.actions).toContain('retourschneider');
            await action([host], 'retourschneider', 'decline');
            continue;
          }
          const previousDeal = engine.deal_id;
          await expect.poll(() => host.traffic.snapshot.engine.deal_id, { timeout: 10000 }).not.toBe(previousDeal);
          continuedDeal = true;
          continue;
        }
        if (engine.actions.includes('preplay_decline')) {
          // CPUs may offer Blödeln. Ordinary play needs no preliminary vote;
          // answer only the real request addressed to this human seat.
          expect(engine.preplay.pending).toMatchObject({ kind: 'bloedeln', responder: engine.viewer.seat });
          expect(engine.preplay.bloedeln_status).toBe('pending');
          await action([host], 'preplay_decline');
          continue;
        }
        if (engine.actions.includes('partner_feedback')) {
          await answerPartnerFeedback([host]);
          continue;
        }
        const before = engine.opportunity;
        let kind, value;
        if (engine.actions.includes('show_ready')) kind = 'show_ready';
        else if (engine.actions.includes('inspection_ack')) kind = 'inspection_ack';
        else if (engine.actions.includes('announce_strike')) { kind = 'announce_strike'; value = '7'; }
        else if (engine.actions.includes('announce_colour')) { kind = 'announce_colour'; value = 'bells'; }
        else if (count === 2 && !continuedDeal && engine.actions.includes('respond_go')) { kind = 'respond_go'; value = 'go'; }
        else if (engine.actions.includes('respond_hold')) { kind = 'respond_hold'; value = 'hold'; }
        else if ((count !== 2 || continuedDeal) && engine.actions.includes('bid')) kind = 'bid';
        if (kind) {
          await host.page.locator(`[data-watten-action="${kind}"]${value ? `[data-value="${value}"]` : ''}`).click();
        } else {
          expect(engine.actions).toContain('play_card');
          const { strike, suit } = host.traffic.call;
          const knows = !host.traffic.snapshot.room.recipe.blind || engine.reference_card?.face === 'card';
          if (knows) { expect(strike).toBeTruthy(); expect(suit).toBeTruthy(); }
          const cards = engine.hand.map(item => item.card);
          const isStrike = card => strike === 'weli' ? card === 'bells-6' : card.endsWith(`-${strike}`);
          const isTrump = card => card === 'bells-6' || card.startsWith(`${suit}-`);
          const lead = engine.current_trick.cards[0]?.card;
          const ordinaryTrump = cards.find(card => isTrump(card) && !isStrike(card));
          // A losing strike cannot replace a trump. Prefer the ordinary trump
          // rather than duplicating the complete trick ranking in this driver.
          const card = knows && lead && isTrump(lead) && ordinaryTrump ? ordinaryTrump : cards[0];
          await host.page.locator(`[data-wt-hand] button[data-card="${card}"]`).press('Enter');
          observedPlay = true;
        }
        await expect.poll(() => host.traffic.snapshot.engine.opportunity).not.toBe(before);
        if (count !== 2 && observedPlay) break;
      }
      if (count === 2) {
        expect(continuedDeal).toBe(true);
        await expect(host.page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 10000 });
        expect(host.traffic.snapshot.result_persisted).toBe(true);
      } else if (!observedPlay) {
        // The confirmed house rule permits folding before the first card.
        // A wholly autonomous completed match is valid only with a scored fold.
        expect(host.traffic.snapshot.engine.phase).toBe('match_complete');
        expect(host.traffic.snapshot.engine.bid.result.reason).toBe('go');
        expect(host.traffic.snapshot.result_persisted).toBe(true);
      } else expect(observedPlay).toBe(true);
      expect(host.traffic.errors).toEqual([]);
    } finally { await host.context.close(); }
  });
}

test('four manually chosen seats preserve teams and blind inspection/reference roles', async ({ browser, baseURL }, testInfo) => {
  const players = [];
  for (let index = 0; index < 4; index += 1) players.push(await player(browser, baseURL, 'de', { role: index === 0 ? 'admin' : 'user' }));
  try {
    await create(players, { reference: true });
    await expect.poll(() => players.every(item => item.traffic.snapshot?.engine?.phase === 'show_ready')).toBe(true);
    expect(players[0].traffic.snapshot.room.seats.map(seat => seat.team)).toEqual([0, 1, 0, 1]);
    const inspectors = players.filter(item => item.traffic.snapshot.engine.actions.includes('show_ready'));
    expect(inspectors).toHaveLength(2);
    for (const item of players) {
      await expect(item.page.locator('[data-watten-reference]')).toHaveCount(0);
      const panel = item.page.locator('[data-wt-panel]');
      if (inspectors.includes(item)) {
        const role = item.traffic.snapshot.engine.announcement_roles.strike === item.traffic.snapshot.viewer.seat
          ? 'Schlag' : 'Farbe';
        await expect(panel.locator('[data-watten-action=show_ready]')).toHaveText(`${role} zeigen`);
        await expect(panel).toHaveText(`${role} zeigen`);
        await expect(panel.locator('h3, p')).toHaveCount(0);
        await exportTableReview(item, role === 'Schlag' ? 'show-strike' : 'show-colour');
      } else await expect(panel.locator('.wt-prompt')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-bloedeln-status=declined]')).toHaveCount(0);
    }
    await action(players, 'show_ready');
    await action(players, 'show_ready');
    for (const item of players) {
      await expect(item.page.locator('[data-watten-reference]')).toHaveCount(0);
      if (inspectors.includes(item)) await expect(item.page.locator('[data-watten-inspection]')).toBeVisible();
      else {
        await expect(item.page.locator('[data-watten-inspection]')).toHaveCount(0);
        expect(item.traffic.snapshot.engine.inspection).toBeNull();
        expect(item.traffic.snapshot.engine.hand.every(card => card.back === true)).toBe(true);
      }
    }
    await action(players, 'inspection_ack');
    await action(players, 'inspection_ack');
    for (const item of players) {
      await expect(item.page.locator('[data-watten-inspection]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-bloedeln-status=declined]')).toHaveCount(0);
      const reference = item.page.locator('[data-watten-reference] .wt-card--back');
      await expect(reference).toHaveCount(inspectors.includes(item) ? 0 : 1);
      expect(item.traffic.snapshot.engine.hand.every(card => typeof card.card === 'string')).toBe(true);
    }
    const page = players[0].page;
    for (const [width, height] of [[320, 568], [568, 320], [667, 375], [768, 700]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => scrollTo(0, 0));
      await expectTableHeaderReachable(page);
      await page.screenshot({ path: testInfo.outputPath(`blind-table-${width}x${height}.png`), fullPage: true });
      const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
        outside: [...document.querySelectorAll('body *')].map(node => {
          const rect = node.getBoundingClientRect();
          return { tag: node.tagName, class: String(node.className), left: rect.left, right: rect.right };
        }).filter(rect => rect.left < -1 || rect.right > innerWidth + 1).slice(0, 12) }));
      expect(geometry.overflow, JSON.stringify({ width, height, outside: geometry.outside })).toBeLessThanOrEqual(1);
    }
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

test('reference-OFF renderer clears announcements and accepts a fresh pointer while rejecting an old-layout press', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL)];
  try {
    await create(players);
    await normalCall(players);
    const item = players[0];
    const bundle = await build({ entryPoints: [path.resolve('frontend/watten/table.js')], bundle: true,
      write: false, format: 'esm', platform: 'browser', target: 'es2020' });
    const result = await item.page.evaluate(async ({ code, snapshot }) => {
      // Test the actual renderer's event semantics in a separate fixture mount.
      // This is distinct from the real server/UI journeys above.
      const module = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`);
      const root = document.createElement('section');
      document.body.append(root);
      const cards = [];
      const view = module.createTableView(root, { onCard: card => cards.push(card) });
      const seat = snapshot.engine.viewer.seat;
      const vm = { snapshot, engine: snapshot.engine, room: snapshot.room, count: 2, viewerSeat: seat,
        anchorSeat: seat, playerId: snapshot.viewer.participant_id, spectator: false, actions: ['play_card'],
        busy: false, paused: false, awaited: [], canResume: false, isHost: true, canLeave: true,
        bubbles: [], freshTrickEnd: false, liveMessage: 'Schlag: Sieben' };
      view.update(vm);
      const before = root.querySelector('[data-wt-live]').textContent;
      view.update({ ...vm, liveMessage: '' });
      const after = root.querySelector('[data-wt-live]').textContent;
      const old = root.querySelector('[data-wt-card]');
      const oldCard = old.dataset.card;
      old.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      const engine = { ...vm.engine, hand: vm.engine.hand.filter(card => card.card !== oldCard) };
      view.update({ ...vm, engine, liveMessage: '' });
      const next = root.querySelector('[data-wt-card]');
      next.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      const afterStalePress = cards.length;
      next.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      next.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      const afterFreshPress = cards.length;
      root.remove();
      return { before, after, afterStalePress, afterFreshPress };
    }, { code: bundle.outputFiles[0].text, snapshot: item.traffic.snapshot });
    expect(result).toEqual({ before: 'Schlag: Sieben', after: '', afterStalePress: 0, afterFreshPress: 1 });
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

test('card decoding gates private table requests and a decode failure has an explicit retry', async ({ browser, baseURL }) => {
  const item = await player(browser, baseURL);
  try {
    await create([item], { count: 2, start: false });
    const destination = new URL(item.page.url()).pathname;
    await item.page.addInitScript(() => {
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        if (!sessionStorage.getItem('watten_test_decode_failed')) {
          sessionStorage.setItem('watten_test_decode_failed', '1');
          return Promise.reject(new Error('controlled card decode failure'));
        }
        return original.call(this);
      };
    });
    const reads = [];
    item.page.on('request', request => {
      if (/^\/api\/games\//.test(new URL(request.url()).pathname)) reads.push(request.url());
    });
    await item.page.goto(destination);
    await expect(item.page.locator('[data-watten-command=retry-assets]')).toBeVisible();
    expect(reads).toEqual([]);
    await expect(item.page.locator('[data-watten-command=take-seat]')).toHaveCount(0);
    await item.page.locator('[data-watten-command=retry-assets]').click();
    await expect(item.page.locator('[data-watten-command=take-seat]')).toBeVisible();
    expect(reads).toHaveLength(1);
    expect(item.traffic.errors).toEqual([]);
  } finally { await item.context.close(); }
});

test('a committed waiting-room departure with a lost ACK never auto-admits the leaver', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL)];
  try {
    await players[1].page.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        send(message) {
          try {
            const data = JSON.parse(message);
            if (data.action === 'leave_waiting_game') this.leaveId = data.command_id;
          } catch { /* Non-JSON frame. */ }
          return super.send(message);
        }
        addEventListener(type, callback, options) {
          if (type !== 'message') return super.addEventListener(type, callback, options);
          return super.addEventListener(type, event => {
            const data = JSON.parse(event.data);
            if (this.leaveId && data.watten_command?.command_id === this.leaveId) { this.close(1000); return; }
            callback.call(this, event);
          }, options);
        }
      };
    });
    await create(players, { start: false });
    const id = players[1].traffic.snapshot.viewer.participant_id;
    await players[1].page.locator('[data-watten-command=leave-waiting]').click();
    await expect(players[1].page).toHaveURL(/\/watten$/);
    await expect.poll(() => players[0].traffic.snapshot.room.members.some(member => member.participant_id === id)).toBe(false);
    const commands = players[1].traffic.commands;
    const departure = commands.findIndex(command => command.action === 'leave_waiting_game');
    expect(departure).toBeGreaterThan(-1);
    expect(commands.slice(departure + 1).some(command => ['join_game', 'rejoin_game'].includes(command.action))).toBe(false);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
