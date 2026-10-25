const { test, expect } = require('@playwright/test');
const { player, create, action, answerPartnerFeedback, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { expectFixedTable, expectReachable } = require('./table-viewport');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');
const { expectLandscapeTable } = require('./helpers/watten-landscape.cjs');

// Each case checks four viewport sizes before and during a real bid; the
// four-player case also admits one spectator for the neutral score labels.
// Keep individual assertions at their normal timeout.
test.setTimeout(90_000);

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 568, height: 320 }, { width: 1280, height: 800 }, { width: 320, height: 568 }];
const gameBrowser = browser => ({ newContext: options => browser.newContext({ ...options,
  viewport: VIEWPORTS[0], serviceWorkers: 'block' }) });

async function settled(players, phase) {
  await expect.poll(() => {
    const first = players[0].traffic.snapshot;
    return players.every(item => item.traffic.snapshot?.id === first?.id
      && item.traffic.snapshot?.engine?.phase === phase
      && item.traffic.snapshot?.engine?.opportunity === first?.engine?.opportunity);
  }).toBe(true);
  for (const item of players) await expect(item.page.locator('[data-wt-table]')).toHaveAttribute('data-phase', phase);
}

async function clickNeutralWood(page) {
  let point;
  await expect.poll(async () => {
    point = await page.evaluate(() => {
      const felt = document.querySelector('[data-wt-felt]');
      const bounds = felt.getBoundingClientRect();
      const excluded = [...document.querySelectorAll('button, a, input, select, textarea, summary, [role="button"], '
        + '[tabindex]:not([tabindex="-1"]), [data-wt-seat], [data-wt-hand-area], .wt-card, .wt-hand-card, .wt-backs, .wt-taken, '
        + '[data-wt-panel], [data-wt-history], [data-wt-private], [data-wt-stake], .wt-scorepad, dialog, '
        + '[data-watten-decor-item], .wt-stock, .wt-reference, .wt-reveal')]
        .map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
      for (let y = Math.max(8, bounds.top + 8); y < Math.min(innerHeight - 8, bounds.bottom - 8); y += 12) {
        for (let x = Math.max(8, bounds.left + 8); x < Math.min(innerWidth - 8, bounds.right - 8); x += 12) {
          if (excluded.some(rect => x >= rect.left - 6 && x <= rect.right + 6
            && y >= rect.top - 6 && y <= rect.bottom + 6)) continue;
          if (document.elementFromPoint(x, y) === felt) return { x, y };
        }
      }
      return null;
    });
    return point !== null;
  }, { message: 'a clear wooden table point is available outside controls, cards, review and decoration' }).toBe(true);
  await page.mouse.click(point.x, point.y);
}

async function expectStage(item, count) {
  const { page, traffic } = item;
  await expect(page.locator('html')).toHaveAttribute('data-watten-active', 'true');
  await expect(page.locator('[data-wt-seat]')).toHaveCount(count);
  const engine = traffic.snapshot.engine;
  const language = await page.locator('html').getAttribute('lang');
  const ownId = traffic.snapshot.viewer.participant_id;
  const scores = [...engine.scores].sort((a, b) =>
    Number(b.members.includes(ownId)) - Number(a.members.includes(ownId)));
  await expect(page.locator('.wt-score')).toHaveCount(scores.length);
  await expect(page.locator('.wt-score').first()).toHaveClass(/is-own/);
  if (count === 4 || count === 2) {
    await expect(page.locator('.wt-score-name')).toHaveText(language === 'en' ? ['Us', 'Them'] : ['Mir', 'Dir']);
  }
  for (const [index, score] of scores.entries()) {
    const party = engine.seats.find(seat => score.members.includes(seat.player_id)).party;
    await expect(page.locator('.wt-score').nth(index).locator('.wt-score-points')).toHaveText(String(score.points));
    const tricks = engine.party_tricks[party];
    await expect(page.locator('.wt-score').nth(index).locator('.wt-score-tricks'))
      .toHaveText(`${tricks} ${language === 'en' ? (tricks === 1 ? 'trick' : 'tricks') : (tricks === 1 ? 'Stich' : 'Stiche')}`);
  }
  // Card/trick-count metadata is gone; public tavern titles remain valid.
  await expect(page.locator('.wt-seat-meta:not(.wt-seat-public-title)')).toHaveCount(0);
  for (const seat of engine.seats) {
    const title = traffic.snapshot.room.seats[seat.seat]?.public_title;
    const label = page.locator(`[data-wt-seat="${seat.seat}"] .wt-seat-public-title`);
    if (title) await expect(label).toHaveText(title.name[language]);
    else await expect(label).toHaveCount(0);
  }
  const strikeSeat = engine.announcement_roles?.strike ?? (engine.dealer_seat + 1) % count;
  const colourSeat = engine.announcement_roles?.colour
    ?? (count === 3 && engine.profile.determination === 'normal' ? strikeSeat : engine.dealer_seat);
  await expect(page.locator(`[data-wt-seat="${strikeSeat}"] .wt-seat-call-role`))
    .toContainText(language === 'en' ? 'Strike' : 'Schlag');
  await expect(page.locator(`[data-wt-seat="${colourSeat}"] .wt-seat-call-role`))
    .toContainText(language === 'en' ? 'Trump suit' : 'Farbe');
  await expect(page.locator('[data-wt-tools] [data-watten-action="leave"]'))
    .toHaveText(language === 'en' ? 'Leave' : 'Verlassen');
  await expect(page.locator('[data-watten-decor-action="toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-wt-scores] .wt-stake')).toHaveCount(0);
  const viewport = page.viewportSize();
  const landscapeRail = viewport.width > viewport.height && viewport.height < 520;
  const compactBid = landscapeRail && engine.phase === 'bid_response';
  const stake = page.locator('.wt-end-sheet > [data-wt-stake]');
  await expect(stake).toBeVisible();
  await expect(stake).toHaveAttribute('data-points', String(engine.bid.pending?.points ?? engine.bid.accepted_stake));
  await expect(stake.locator('button > strong')).toHaveText(String(engine.bid.pending?.points ?? engine.bid.accepted_stake));
  await expectReachable(page, '.wt-end-sheet > [data-wt-stake] > button');
  const stakeBox = await stake.locator('button').boundingBox();
  expect(stakeBox.width).toBeGreaterThanOrEqual(44);
  expect(stakeBox.height).toBeGreaterThanOrEqual(44);
  if (compactBid && engine.actions.includes('respond_go')) await expect(page.locator('[data-watten-action=respond_go]'))
    .toContainText(String(engine.bid.accepted_stake));
  const reviewing = await page.locator('[data-wt-history]').evaluate(node => node.open);
  const ownSeat = engine.viewer.seat;
  const backCount = engine.seats.filter(seat => seat.seat !== ownSeat).reduce((sum, seat) => sum + seat.card_count, 0);
  await expect(page.locator('.wt-backs > i:not([hidden])')).toHaveCount(backCount);
  await expect(page.locator('[data-wt-hand] button')).toHaveCount(engine.hand.length);
  for (const seat of engine.seats) {
    const pile = page.locator(`[data-wt-catch="${seat.seat}"]`);
    await expect(pile).toHaveAttribute('data-count', String(seat.tricks_won));
    await expect(pile.locator('.wt-taken-packet')).toHaveCount(seat.tricks_won);
    if (seat.tricks_won) {
      if (reviewing) await expect(pile).toBeHidden();
      else await expect(pile).toBeVisible();
      await expect(pile).toHaveAttribute('aria-label', `${seat.tricks_won} ${language === 'en'
        ? (seat.tricks_won === 1 ? 'trick' : 'tricks') : (seat.tricks_won === 1 ? 'Stich' : 'Stiche')}`);
    } else await expect(pile).toBeHidden();
  }
  await expectFixedTable(page, ['[data-wt-felt]', '[data-wt-scores]', '[data-wt-hand-area]']);
  await expect.poll(() => page.evaluate(() => {
    const violations = [];
    const rect = node => node.getBoundingClientRect();
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const shown = node => rect(node).width > 0 && rect(node).height > 0 && getComputedStyle(node).visibility !== 'hidden';
    const label = node => node.matches('.wt-backs > i') ? `opponent card at seat ${node.closest('[data-wt-seat]').dataset.wtSeat}`
      : node.getAttribute('data-wt-card') || node.className;
    const cards = [...document.querySelectorAll('.wt-backs > i:not([hidden]), [data-wt-hand] button, .wt-trick-card, .wt-taken[data-filled="true"] i')].filter(shown);
    for (const node of cards) {
      const box = rect(node);
      if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) {
        violations.push(`${label(node)} outside viewport`);
      }
      // A fan may intentionally overlap its own cards, but no clipping
      // ancestor may cut off any rotated card or its outer corners.
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = rect(ancestor);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)
          && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) violations.push(`${label(node)} clipped horizontally`);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
          && (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1)) violations.push(`${label(node)} clipped vertically`);
      }
    }
    for (const name of document.querySelectorAll('.wt-seat-name')) {
      const box = rect(name);
      if (box.left < -1 || box.right > innerWidth + 1) violations.push(`seat ${name.closest('[data-wt-seat]').dataset.wtSeat} name outside ${innerWidth}x${innerHeight}: ${box.left}–${box.right}`);
    }
    const frozenBid = innerWidth > innerHeight && innerHeight < 520
      && document.querySelector('[data-wt-table]').dataset.phase === 'bid_response';
    const protectedAreas = [...document.querySelectorAll('[data-wt-hand-area], [data-wt-panel], [data-wt-stake], [data-wt-history]:not([open]), [data-wt-private] button, .wt-trick-card')]
      .filter(shown).filter(area => !frozenBid || !area.matches('[data-wt-panel]'));
    for (const back of [...document.querySelectorAll('.wt-backs > i:not([hidden])')].filter(shown)) {
      const box = rect(back);
      const overlaps = protectedAreas.filter(area => intersects(box, rect(area)));
      if (overlaps.length) violations.push(`${label(back)} overlaps ${overlaps.map(area => area.className || area.tagName).join(', ')} at ${innerWidth}x${innerHeight}`);
      const seat = back.closest('[data-wt-seat]');
      if ([...seat.querySelectorAll('.wt-seat-name, .wt-seat-call-role, .wt-seat-tags, .wt-seat-meta')].filter(shown)
        .some(name => intersects(box, rect(name)))) violations.push(`${label(back)} covered by seat label`);
    }
    return [...new Set(violations)];
  }), { message: 'all five-card opponent fans and the own hand remain complete and clear' }).toEqual([]);

  if (await page.locator('[data-wt-history]').evaluate(node => node.open)) {
    await expect(page.locator('[data-wt-hand]')).toBeHidden();
    if (viewport.width < viewport.height && viewport.width <= 760) {
      await expect.poll(() => page.evaluate(() => document.querySelector('[data-wt-history]').getBoundingClientRect().top
        - document.querySelector('.wt-topbar').getBoundingClientRect().bottom), {
        message: 'the open review reuses hidden-hand space and clears the score row after resize or pinned reload',
      }).toBeGreaterThanOrEqual(4);
    }
  } else await expectReachable(page, '[data-wt-hand] button:first-child');
  // The score list includes intentional gaps; each score opens its own pad.
  for (let index = 0; index < scores.length; index += 1) {
    await expectReachable(page, `[data-wt-scores] > .wt-score:nth-child(${index + 1}) > [data-wt-score-open]`);
  }
  if (engine.last_trick) {
    const portraitPhone = viewport.width < viewport.height && viewport.width <= 760;
    const reviewWidth = { minimum: portraitPhone ? 60 : 44, maximum: portraitPhone ? 72 : 56 };
    const history = page.locator('.wt-end-sheet > [data-wt-history]');
    await expect(history).toBeVisible();
    const winnerParty = engine.seats[engine.last_trick.winner].party;
    const ownParty = engine.seats[engine.viewer.seat].party;
    await expect(history.locator('.wt-history > li').last())
      .toHaveAttribute('data-wt-trick-team', winnerParty === ownParty ? 'own' : 'opponent');
    if (!await history.evaluate(node => node.open)) await history.locator('summary').click();
    await expectReachable(page, '[data-wt-history] > summary');
    await expect.poll(() => history.evaluate((node, landscapeRail) => {
      const rect = node.getBoundingClientRect();
      const panel = node.parentElement.querySelector('[data-wt-panel]');
      const panelRect = panel.getBoundingClientRect();
      const stake = node.parentElement.querySelector('[data-wt-stake]');
      const stakeRect = stake.getBoundingClientRect();
      const summaryRect = node.querySelector('summary').getBoundingClientRect();
      const hand = document.querySelector('[data-wt-hand-area]').getBoundingClientRect();
      const felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
      const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
      return {
        abovePanel: !panelRect.height || rect.bottom <= panelRect.top + 1,
        // The 52px compact rail deliberately allows its 68px stake tab to
        // extend onto the wood. Protect real targets rather than the old rail edge.
        stakeSeparate: landscapeRail ? !overlap(rect, stakeRect) && stakeRect.left >= -1
          && stakeRect.right <= innerWidth + 1 && rect.left >= felt.left - 1
          : (!stakeRect.height || rect.bottom <= stakeRect.top + 1)
            && (!panelRect.height || !stakeRect.height || panelRect.bottom <= stakeRect.top + 1),
        beforePanel: Boolean(node.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING),
        clearOfHand: !overlap(summaryRect, hand),
        controlsClearOfHistory: [...panel.querySelectorAll('button'), ...stake.querySelectorAll('button')]
          .every(button => !overlap(rect, button.getBoundingClientRect())),
      };
    }, landscapeRail), { message: 'review stays above decisions while the stake uses its own reachable area' })
      .toEqual({ abovePanel: true, stakeSeparate: true, beforePanel: true,
        clearOfHand: true, controlsClearOfHistory: true });
    const miniWidth = await history.locator('.wt-card--mini').first().evaluate(node => Number.parseFloat(getComputedStyle(node).width));
    expect(miniWidth).toBeGreaterThanOrEqual(reviewWidth.minimum);
    expect(miniWidth).toBeLessThanOrEqual(reviewWidth.maximum);
    await expect(history.locator('.wt-history > li').first().locator('.wt-mini-cards > figure'))
      .toHaveCount(engine.last_trick.cards.length);
    await expect.poll(() => history.evaluate((node, { reviewWidth, compactBid }) => {
      const failures = [];
      const scroller = node.querySelector(':scope > .wt-history');
      const bounds = scroller.getBoundingClientRect();
      const port = { left: bounds.left + scroller.clientLeft, top: bounds.top + scroller.clientTop,
        right: bounds.left + scroller.clientLeft + scroller.clientWidth,
        bottom: bounds.top + scroller.clientTop + scroller.clientHeight };
      const inside = (rect, area) => rect.left >= area.left - 1 && rect.top >= area.top - 1
        && rect.right <= area.right + 1 && rect.bottom <= area.bottom + 1;
      const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const figures = [...scroller.querySelectorAll(':scope > li:first-child > .wt-mini-cards > figure')];
      if (compactBid && scroller.clientHeight <= 0) failures.push('compact bid review has no scrollable height');
      let rowTop = Infinity, rowBottom = -Infinity;
      for (const [index, figure] of figures.entries()) {
        const card = figure.querySelector('.wt-card--mini');
        const svg = card?.querySelector('svg');
        const caption = figure.querySelector('figcaption');
        if (!card || !svg || !caption) { failures.push(`mini ${index}: card SVG or player name missing`); continue; }
        const width = Number.parseFloat(getComputedStyle(card).width);
        if (width < reviewWidth.minimum || width > reviewWidth.maximum) failures.push(`mini ${index}: width ${width} outside ${reviewWidth.minimum}–${reviewWidth.maximum}px`);
        if (!caption.textContent.trim()) failures.push(`mini ${index}: player name is empty`);
        for (const [label, element] of [['card', card], ['SVG', svg], ['player name', caption]]) {
          const rect = element.getBoundingClientRect();
          rowTop = Math.min(rowTop, rect.top); rowBottom = Math.max(rowBottom, rect.bottom);
          if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(element).visibility !== 'visible'
            || Number.parseFloat(getComputedStyle(element).opacity) === 0
            || (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) {
            failures.push(`mini ${index} ${label}: not rendered`);
          }
          if (compactBid) {
            // A live decision has priority in short landscape. The review
            // scrolls so both the face and its name remain inspectable.
            if (!['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) failures.push('compact bid review cannot scroll');
            for (const edge of ['top', 'bottom']) {
              const before = element.getBoundingClientRect();
              const point = edge === 'top' ? before.top + 3 : before.bottom - 3;
              scroller.scrollTop += point - (port.top + port.bottom) / 2;
              const after = element.getBoundingClientRect();
              const y = edge === 'top' ? after.top + 3 : after.bottom - 3;
              const x = after.x + after.width / 2;
              if (x < port.left || x > port.right || y < port.top || y > port.bottom
                || x < 0 || x > innerWidth || y < 0 || y > innerHeight
                || !figure.contains(document.elementFromPoint(x, y))) failures.push(`mini ${index} ${label}: ${edge} cannot be reached by scrolling`);
            }
          } else {
            if (!inside(rect, port)) failures.push(`mini ${index} ${label}: clipped by history scroller`);
            if (!inside(rect, viewport)) failures.push(`mini ${index} ${label}: outside viewport`);
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            if (!figure.contains(hit)) failures.push(`mini ${index} ${label}: center covered by ${hit?.tagName || 'nothing'}`);
          }
        }
      }
      // Ordinary review shows the complete card/name row together. A live
      // bid on a short screen keeps its controls clear and allows review scrolling.
      if (!figures.length || !compactBid && scroller.clientHeight < rowBottom - rowTop - 1) {
        failures.push(`history card/name row needs ${rowBottom - rowTop}px; scroller offers ${scroller.clientHeight}px`);
      }
      if (compactBid) scroller.scrollTop = 0;
      return failures;
    }, { reviewWidth, compactBid }), { message: 'the first history trick keeps mini-card faces and names readable, with scrolling beside a short-screen bid' }).toEqual([]);
    if (['deal_complete', 'match_complete'].includes(engine.phase)) {
      await expect(history.locator('[data-wt-history-pin]')).toHaveCount(0);
      await expect(history).toHaveAttribute('data-pinned', 'false');
      await expect(history).toHaveAttribute('data-finished', 'true');
    } else {
      await expect(history.locator('[data-wt-history-pin]')).toBeVisible();
      await expectReachable(page, '[data-wt-history-pin]');
    }
    await expectReachable(page, '[data-wt-history-close]');
    const closeBox = await history.locator('[data-wt-history-close]').boundingBox();
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
  }
  if (page.viewportSize().width >= 761 && page.viewportSize().height >= 520 && await page.locator('.wt-trick-card').count()) {
    for (const card of await page.locator('.wt-trick-card').all()) {
      const width = await card.evaluate(node => Number.parseFloat(getComputedStyle(node).width));
      expect(width).toBeGreaterThanOrEqual(90);
      expect(width).toBeLessThanOrEqual(160);
    }
  }
  const desktop = page.viewportSize().width >= 761 && page.viewportSize().height >= 520;
  for (const card of await page.locator('.wt-backs > i:not([hidden])').all()) {
    expect(await card.evaluate(node => Number.parseFloat(getComputedStyle(node).width)))
      .toBeGreaterThanOrEqual(desktop ? 56 : 28);
  }
  for (const pile of await page.locator('.wt-taken[data-filled="true"] .wt-taken-packet').all()) {
    // Non-interactive top packets use the stock-to-fan corridor on four-seat
    // tall tables. Other packets and every interactive control keep their limits.
    const compactTop = count === 4 && viewport.width >= 761 && viewport.height >= 701
      && await pile.evaluate(node => Boolean(node.closest('.wt-seat--top'))
        && getComputedStyle(node.closest('.wt-table')).getPropertyValue('--wt-play-ratio').trim() !== '');
    const width = await pile.evaluate(node => Number.parseFloat(getComputedStyle(node).width));
    expect(width).toBeGreaterThanOrEqual(compactTop ? 26 : desktop ? 44 : 26);
    if (compactTop) expect(width).toBeLessThanOrEqual(40);
  }
  for (const control of await page.locator('[data-wt-panel] button, [data-wt-private] button, [data-wt-tools] button, [data-wt-stake] button').all()) {
    if (!await control.isVisible()) continue;
    await expect.poll(() => control.evaluate(node => {
      const box = node.getBoundingClientRect();
      return { width: box.width >= 44, height: box.height >= 44 };
    }), { message: 'current visible control settles at a complete 44px touch target after resize' })
      .toEqual({ width: true, height: true });
    await expectReachable(page, await control.evaluate(node => {
      // Existing commands have stable public action identifiers, not test IDs.
      if (!node.hasAttribute('data-watten-action') && !node.hasAttribute('data-watten-command')) {
        return '.wt-end-sheet > [data-wt-stake] > button';
      }
      const attribute = node.hasAttribute('data-watten-action') ? 'data-watten-action' : 'data-watten-command';
      const value = node.getAttribute(attribute);
      const kind = node.getAttribute('data-value');
      return `[${attribute}="${value}"]${kind === null ? '' : `[data-value="${kind}"]`}`;
    }));
  }
  await expectTableHeaderReachable(page);
}

for (const language of ['de', 'en']) {
  for (const count of [2, 3, 4]) {
    test(`${language}: ${count} real humans keep complete fans and bid decisions on one fixed table`, async ({ browser, baseURL }, testInfo) => {
      const players = [];
      let spectator;
      try {
        for (let index = 0; index < count; index += 1) players.push(await player(gameBrowser(browser), baseURL, language));
        const path = await create(players, { determination: 'normal', target: 15 });
        await normalCall(players);
        await settled(players, 'play');
        if (count === 4) {
          spectator = await player(gameBrowser(browser), baseURL, language);
          await spectator.page.goto(`${path}/zuschauen`);
          await expect(spectator.page.locator('[data-wt-table]')).toBeVisible();
          await expect(spectator.page.locator('.wt-score-name')).toHaveText(['Team A', 'Team B']);
          await expect(spectator.page.locator('.wt-score.is-own')).toHaveCount(0);
        }
        for (const viewport of VIEWPORTS) {
          for (const item of players) {
            await item.page.setViewportSize(viewport);
            await expect(item.page.locator('html')).toHaveAttribute('lang', language);
            await expectStage(item, count);
          }
          if (spectator && viewport.width > viewport.height && viewport.height < 520) {
            await spectator.page.setViewportSize(viewport);
            await expectLandscapeTable(spectator.page);
          }
        }
        for (let card = 0; card < count; card += 1) {
          await playOne(players);
          await settled(players, 'play');
        }
        await expect.poll(() => players.every(item => item.traffic.snapshot.engine.last_trick?.cards.length === count)).toBe(true);
        await action(players, 'bid');
        await settled(players, 'bid_response');
        await answerPartnerFeedback(players);
        const before = players.map(item => ({ hand: item.traffic.snapshot.engine.hand,
          opportunity: item.traffic.snapshot.engine.opportunity, pending: item.traffic.snapshot.engine.bid.pending,
          seat: item.traffic.snapshot.viewer.seat, participant: item.traffic.snapshot.viewer.participant_id }));
        for (const item of players) await item.page.evaluate(() => {
          window.stageHandNodes = [...document.querySelectorAll('[data-wt-hand] button')];
        });
        const decider = players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold'));
        expect(decider).toBeTruthy();
        for (const viewport of VIEWPORTS) {
          for (const [index, item] of players.entries()) {
            await item.page.setViewportSize(viewport);
            await expectStage(item, count);
            expect(item.traffic.snapshot.engine.opportunity).toBe(before[index].opportunity);
            expect(item.traffic.snapshot.engine.bid.pending).toEqual(before[index].pending);
            expect(await item.page.evaluate(() => window.stageHandNodes.every((node, position) =>
              node === document.querySelectorAll('[data-wt-hand] button')[position]))).toBe(true);
          }
          await expect(decider.page.locator('[data-watten-bid] [data-kind="respond"]')).toHaveCount(3);
          for (const response of await decider.page.locator('[data-watten-bid] [data-kind="respond"]').all()) await expect(response).toBeEnabled();
          await decider.page.screenshot({ path: testInfo.outputPath(`table-bid-${language}-${count}-${viewport.width}x${viewport.height}.png`) });
        }
        const pinnedHistory = decider.page.locator('[data-wt-history]');
        await expect(pinnedHistory.locator('[data-wt-history-pin]')).not.toBeChecked();
        await pinnedHistory.locator('[data-wt-history-pin]').check();
        await expect(pinnedHistory).toHaveAttribute('data-pinned', 'true');
        await expect(pinnedHistory).toHaveAttribute('open', '');
        const boundPreferences = await decider.page.evaluate(({ own, others }) => ({
          own: localStorage.getItem(`watten:history-pinned:${own}`),
          others: others.map(id => localStorage.getItem(`watten:history-pinned:${id}`)),
        }), { own: decider.user.id, others: players.filter(item => item !== decider).map(item => item.user.id) });
        expect(boundPreferences).toEqual({ own: 'true', others: players.filter(item => item !== decider).map(() => null) });
        // A real reconnect must hydrate this same frozen bid and hand. Observe
        // a NEW socket frame, rather than accepting the collector's old state.
        const rejoined = [];
        const id = decider.traffic.snapshot.id;
        const onSocket = socket => {
          if (new URL(socket.url()).pathname !== `/ws/${id}`) return;
          socket.on('framereceived', frame => {
            const message = JSON.parse(String(frame.payload));
            if (message.scoreboard?.id === id) rejoined.push(message.scoreboard);
          });
        };
        decider.page.on('websocket', onSocket);
        try {
          await decider.page.reload();
          await expect.poll(() => rejoined.some(snapshot => snapshot.viewer?.participant_id === before[players.indexOf(decider)].participant)).toBe(true);
          await expect(decider.page.locator('[data-wt-history-pin]')).toBeChecked();
          await expect(decider.page.locator('[data-wt-history]')).toHaveAttribute('open', '');
          await expectStage(decider, count);
          const original = before[players.indexOf(decider)];
          expect(decider.traffic.snapshot.engine.hand).toEqual(original.hand);
          expect(decider.traffic.snapshot.engine.opportunity).toBe(original.opportunity);
          expect(decider.traffic.snapshot.engine.bid.pending).toEqual(original.pending);
          expect(decider.traffic.snapshot.viewer.seat).toBe(original.seat);
          await expect(decider.page.locator('[data-watten-action="respond_hold"]')).toBeEnabled();
          await action(players, 'respond_hold', 'hold');
          await settled(players, 'play');
          await expect(decider.page.locator('[data-wt-history-pin]')).toBeChecked();
          await expect(decider.page.locator('[data-wt-history]')).toHaveAttribute('open', '');
          // A pinned review ignores outside taps. Its explicit close unpins;
          // an ordinary review then closes on an outside tap or Escape.
          const reviewOpportunity = decider.traffic.snapshot.engine.opportunity;
          await clickNeutralWood(decider.page);
          await expect(decider.page.locator('[data-wt-history]')).toHaveAttribute('open', '');
          await decider.page.locator('[data-wt-history-close]').click();
          await expect(decider.page.locator('[data-wt-history]')).not.toHaveAttribute('open', '');
          await expect(decider.page.locator('[data-wt-history-pin]')).not.toBeChecked();
          await decider.page.locator('[data-wt-history] > summary').click();
          await clickNeutralWood(decider.page);
          await expect(decider.page.locator('[data-wt-history]')).not.toHaveAttribute('open', '');
          await decider.page.locator('[data-wt-history] > summary').click();
          await decider.page.keyboard.press('Escape');
          await expect(decider.page.locator('[data-wt-history]')).not.toHaveAttribute('open', '');
          expect(decider.traffic.snapshot.engine.opportunity).toBe(reviewOpportunity);
        } finally { decider.page.off('websocket', onSocket); }
        expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
      } finally { await Promise.allSettled([...players, spectator].filter(Boolean).map(item => item.context.close())); }
    });
  }
}

test('normal motion: an actual completed trick travels to its winner, who leads the next card', async ({ browser, baseURL }) => {
  const players = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const item = await player(gameBrowser(browser), baseURL, index ? 'en' : 'de');
      await item.page.emulateMedia({ reducedMotion: 'no-preference' });
      await item.page.setViewportSize({ width: 1280, height: 800 });
      players.push(item);
    }
    await create(players, { target: 15 });
    await normalCall(players);
    await settled(players, 'play');
    await playOne(players);
    await settled(players, 'play');
    const viewer = players[0];
    await viewer.page.evaluate(() => {
      // Pause only this real presentation animation at creation, so protocol
      // polling cannot outrun the geometry measurement on a busy test machine.
      // Server state, WebSockets and every other animation remain genuine.
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('[data-wt-motion="collect"]')) animation.pause();
        return animation;
      };
    });
    const collecting = viewer.page.waitForSelector('[data-wt-motion="collect"]', { state: 'visible' });
    await playOne(players);
    await settled(players, 'play');
    const last = viewer.traffic.snapshot.engine.last_trick;
    expect(last.cards).toHaveLength(2);
    const collection = await collecting;
    expect(await collection.getAttribute('data-target-seat')).toBe(String(last.winner));
    const geometry = await collection.evaluate(node => {
      const animation = node.getAnimations()[0];
      if (!animation) throw new Error('The real collecting wrapper has no animation');
      const center = element => {
        const box = element.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      };
      // Inspect the actual WAAPI endpoints deterministically, not a fake engine
      // event or a wall-clock sleep. Finishing resumes the real cleanup path.
      animation.pause();
      const duration = animation.effect.getComputedTiming().activeDuration;
      animation.currentTime = 0;
      const from = center(node), trick = center(document.querySelector('[data-wt-trick]'));
      animation.currentTime = duration;
      const to = center(node);
      const target = center(document.querySelector(`[data-wt-catch="${node.dataset.targetSeat}"]`));
      animation.finish();
      return { from, to, trick, target, duration };
    });
    expect(geometry.duration).toBeGreaterThanOrEqual(3000);
    expect(Math.hypot(geometry.from.x - geometry.trick.x, geometry.from.y - geometry.trick.y)).toBeLessThanOrEqual(3);
    expect(Math.hypot(geometry.to.x - geometry.target.x, geometry.to.y - geometry.target.y)).toBeLessThanOrEqual(3);
    expect(Math.hypot(geometry.from.x - geometry.to.x, geometry.from.y - geometry.to.y)).toBeGreaterThan(20);
    await expect(viewer.page.locator('[data-wt-motion="collect"]')).toHaveCount(0);
    const next = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
    expect(next.traffic.snapshot.viewer.seat).toBe(last.winner);
    expect(players.every(item => item.traffic.snapshot.engine.card_turn === last.winner)).toBe(true);
    await expect(next.page.locator(`[data-wt-seat="${last.winner}"]`)).toHaveClass(/is-turn/);
    await playOne(players);
    await settled(players, 'play');
    expect(viewer.traffic.snapshot.engine.current_trick.cards).toEqual([
      expect.objectContaining({ seat: last.winner }),
    ]);
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

for (const count of [3, 4]) {
  test(`${count}: an optional open partner hand stays clear of the own hand in small landscape`, async ({ browser, baseURL }) => {
    const players = [];
    try {
      for (let index = 0; index < count; index += 1) players.push(await player(gameBrowser(browser), baseURL));
      await create(players, { determination: 'normal', partnerHand: true, target: 15 });
      await normalCall(players);
      await settled(players, 'play');
      const partner = players.find(item => item.traffic.snapshot.engine.partner_hand?.cards.length === 5);
      expect(partner).toBeTruthy();
      for (const viewport of [VIEWPORTS[1], VIEWPORTS[0], VIEWPORTS[3], { width: 390, height: 600 }, { width: 760, height: 600 }]) {
        await partner.page.setViewportSize(viewport);
        await expectStage(partner, count);
        const details = partner.page.locator('.wt-partner-hand');
        if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
        await expect(partner.page.locator('.wt-partner-popover')).toBeVisible();
        await expect(partner.page.locator('.wt-partner-popover .wt-card')).toHaveCount(5);
        expect(await partner.page.locator('[data-wt-hand] button').evaluateAll(nodes => nodes.every(node => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }))).toBe(true);
      }
      await playOne(players);
      await expect(partner.page.locator('.wt-partner-hand')).toHaveAttribute('open', '');
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
