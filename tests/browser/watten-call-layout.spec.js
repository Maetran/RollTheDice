const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { player, create, action, answerPartnerFeedback, playOne } = require('./helpers/watten-journey.cjs');

const PORTRAITS = [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }];

async function pauseClock(page) {
  // Freeze wall time while pauseAt crosses the browser transport. Restore
  // advancing virtual dates once paused, so later runFor still moves time.
  const time = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(time);
  await page.clock.pauseAt(time);
  await page.clock.setSystemTime(time);
}

async function settleCalls(page) {
  await page.clock.runFor(100);
  // The fake clock controls the 5200ms product deadline, not CSS animation
  // timelines. Hold the native chip animation in its readable plateau.
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('[data-watten-call]')) for (const animation of node.getAnimations()) {
      animation.pause();
      animation.currentTime = 400;
    }
  });
}

async function resize(page, viewport) {
  // Let native resize/compositor deliveries and the product's RAF run
  // together; pause again before the multi-viewport assertions/retire check.
  await page.clock.resume();
  await page.setViewportSize(viewport);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(() => page.locator('[data-wt-felt]').evaluate((node, height) =>
    Math.abs(node.getBoundingClientRect().bottom - height) < 1, viewport.height)).toBe(true);
  await pauseClock(page);
  await settleCalls(page);
}

async function expectVisibleBadges(page, measurements) {
  const badges = await page.locator('.wt-seat-badge').evaluateAll(nodes => {
    const visible = node => node.checkVisibility() && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const box = node => node.getBoundingClientRect().toJSON();
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return nodes.filter(visible).map(badge => {
      const parts = [...badge.querySelectorAll('.wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-tag')].filter(visible)
        .map(node => ({ class: node.className, text: node.textContent, box: box(node) }));
      return { seat: badge.closest('[data-wt-seat]').dataset.wtSeat,
        bottom: badge.closest('.wt-seat').classList.contains('wt-seat--bottom'),
        count: Number(badge.closest('[data-count]').dataset.count), parts,
        overlaps: parts.flatMap((part, index) => parts.slice(index + 1)
          .map(other => ({ first: part.class, second: other.class, area: overlap(part.box, other.box) }))
          .filter(pair => pair.area > 0)) };
    });
  });
  measurements.push({ badgeContents: badges, viewport: page.viewportSize() });
  expect(badges.length).toBeGreaterThan(0);
  for (const badge of badges) {
    expect(badge.parts.some(part => part.class === 'wt-avatar')).toBe(true);
    expect(badge.parts.some(part => part.class === 'wt-seat-name')).toBe(true);
    expect(badge.overlaps, `painted content inside seat ${badge.seat}`).toEqual([]);
    if (badge.bottom && badge.count < 4) {
      expect(badge.parts.find(part => part.class === 'wt-seat-name').box.width).toBeGreaterThanOrEqual(40);
    }
  }
}

async function geometry(page) {
  return page.evaluate(() => {
    const visible = node => node.checkVisibility() && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const box = node => node.getBoundingClientRect().toJSON();
    const transparent = color => ['transparent', 'rgba(0, 0, 0, 0)'].includes(color);
    const unpaintedBadge = node => {
      if (!node.matches('.wt-seat-badge')) return false;
      const style = getComputedStyle(node);
      return transparent(style.backgroundColor) && style.backgroundImage === 'none' && style.boxShadow === 'none'
        && (style.outlineStyle === 'none' || Number.parseFloat(style.outlineWidth) === 0)
        && ['Top', 'Right', 'Bottom', 'Left'].every(side => Number.parseFloat(style[`border${side}Width`]) === 0 || transparent(style[`border${side}Color`]))
        && !node.matches('button, a[href], input, select, textarea, [role="button"], [tabindex], [data-watten-command], [data-watten-action]')
        && !node.querySelector('button, a[href], input, select, textarea, [role="button"], [tabindex], [data-watten-command], [data-watten-action]');
    };
    const own = document.querySelector('[data-wt-own-call] .wt-bubble');
    const dock = [...document.querySelectorAll('.wt-end-sheet > :not(.wt-own-call)')].filter(visible);
    const obstacles = [...new Set([...dock, ...document.querySelectorAll('[data-watten-call], [data-watten-role-call], .wt-seat-badge, .wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-seat-tags, .wt-seat-meta, .wt-seat-public-title, '
      + '.wt-bubble--thanks, .wt-backs > i:not([hidden]), .wt-taken[data-filled="true"], .wt-taken[data-filled="true"] i, .wt-stock, .wt-stock > i, .wt-reference, [data-wt-preplay], [data-wt-bloedeln]:not(:empty), .wt-trick-label:not(:empty), .wt-prompt, .wt-partner-popover, .wt-retour-tag')].filter(visible))];
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const ownBox = own ? box(own) : null;
    const calls = [...document.querySelectorAll('[data-watten-call], [data-watten-role-call]')].filter(visible);
    const callBox = node => box(node.hasAttribute('data-watten-role-call') ? node.parentElement : node);
    const seatOf = node => ['bottom', 'left', 'right', 'top'].find(seat => node.classList.contains(`wt-bubble--${seat}`)
      || node.closest(`[data-wt-seat].wt-seat--${seat}`));
    // Only CSS-placed labels/deck may cross a transparent, non-interactive
    // wrapper gap. Own-call/trick/prompt guarantees retain the whole badge.
    const cssWrapperExempt = (node, other) => node.matches('[data-watten-role-call], .wt-stock, .wt-stock > i') && unpaintedBadge(other);
    const deck = document.querySelector('[data-wt-deck]');
    const deckNodes = [deck, ...deck.children];
    const deckBoxes = deckNodes.map(box);
    const upperRole = document.querySelector('.wt-seat--top .wt-seat-call-role');
    const upperBox = upperRole && visible(upperRole) ? box(upperRole) : null;
    return {
      own: ownBox,
      phase: document.querySelector('[data-wt-table]').dataset.phase,
      obstacles: obstacles.map(node => ({ class: node.className, box: box(node) })),
      deck: { box: box(deck), children: deckBoxes.slice(1), ariaHidden: deck.getAttribute('aria-hidden'), pointer: getComputedStyle(deck).pointerEvents,
        covered: deckNodes.flatMap(node => obstacles.filter(other => !deckNodes.includes(other) && !cssWrapperExempt(node, other))
          .map(other => ({ class: other.className, area: overlap(box(node), box(other)) })).filter(item => item.area > 0)),
        upperRoleGap: upperBox ? Math.min(...deckBoxes.map(rect => Math.max(upperBox.left - rect.right, rect.left - upperBox.right,
          upperBox.top - rect.bottom, rect.top - upperBox.bottom))) : null },
      table: document.querySelector('[data-wt-felt]').getBoundingClientRect().toJSON(),
      visibleOwn: [...document.querySelectorAll('.wt-bubble--bottom[data-watten-call]')].filter(visible).length,
      overlaps: own ? obstacles.filter(node => node !== own).map(node => ({ class: node.className, box: box(node), area: overlap(ownBox, box(node)) })).filter(item => item.area > 0) : [],
      centeredOwnObstacles: !own ? [] : (() => {
        const table = box(document.querySelector('[data-wt-felt]'));
        const left = table.left + (table.width - ownBox.width) / 2;
        const centred = { ...ownBox, left, right: left + ownBox.width };
        return obstacles.filter(node => node !== own).filter(node => {
          const other = box(node);
          return overlap(centred, { left: other.left - 4, right: other.right + 4,
            top: other.top - 4, bottom: other.bottom + 4 }) > 0;
        }).map(node => node.className);
      })(),
      calls: calls.map(node => ({ text: node.textContent, box: callBox(node), own: node === own,
        seat: seatOf(node), inline: node.hasAttribute('data-watten-role-call'),
        roleSeat: node.dataset.wattenRoleCall, ownerSeat: node.closest('[data-wt-seat]')?.dataset.wtSeat,
        textBox: box(node),
        covered: obstacles.filter(other => other !== node && !other.contains(node) && !cssWrapperExempt(node, other)
          && !(node.hasAttribute('data-watten-role-call') && other.parentElement === node.parentElement))
          .map(other => ({ class: other.className, area: overlap(callBox(node), box(other)) })).filter(item => item.area > 0) })),
      expectedCalls: [...document.querySelectorAll('.wt-bubbles > [data-watten-call]')].map(node => ({ text: node.textContent, seat: seatOf(node) })),
      visibleFloating: [...document.querySelectorAll('.wt-bubbles > [data-watten-call]')].filter(visible).length,
      fallback: own?.parentElement.dataset.wtCallFallback ?? null,
      fallbacks: [...document.querySelectorAll('[data-wt-call-fallback]')].map(node => node.dataset.wtCallFallback),
      slot: !own ? null : (() => {
        const node = own.parentElement, actual = box(node), sheet = box(node.parentElement);
        return { actual, sheet, transition: getComputedStyle(node).transitionProperty,
          left: node.style.getPropertyValue('--wt-own-call-left'), bottom: node.style.getPropertyValue('--wt-own-call-bottom'),
          expected: { left: sheet.left + Number.parseFloat(node.style.getPropertyValue('--wt-own-call-left')) - actual.width / 2,
            bottom: sheet.bottom - Number.parseFloat(node.style.getPropertyValue('--wt-own-call-bottom')) } };
      })(),
      pointer: own ? [getComputedStyle(own.parentElement).pointerEvents, getComputedStyle(own).pointerEvents] : [],
      capturesPointer: own ? Boolean(document.elementFromPoint(ownBox.x + ownBox.width / 2, ownBox.y + ownBox.height / 2)?.closest('[data-wt-own-call]')) : false,
    };
  });
}

async function expectOwnCall(page, measurements) {
  await expectVisibleBadges(page, measurements);
  const result = await geometry(page);
  measurements.push({ viewport: page.viewportSize(), ...result });
  expect(result.visibleOwn).toBe(1);
  expect(result.overlaps).toEqual([]);
  expect(result.calls.flatMap(call => call.covered)).toEqual([]);
  const middle = result.table.left + result.table.width / 2;
  // These are text announcements, separate from the inspection-card axis.
  // Prefer the middle; a lateral fit must clear an actual 4px obstruction
  // that the same label would otherwise meet on the middle line.
  if (Math.abs(result.own.left + result.own.width / 2 - middle) > 1) {
    expect(result.centeredOwnObstacles).not.toEqual([]);
  }
  for (const call of result.calls.filter(call => !call.own)) {
    expect(call.box.bottom, 'own call stays nearest the own controls').toBeLessThanOrEqual(result.own.bottom + 1);
  }
  expectCallBindings(result);
  expect(result.fallback).toBeNull();
  expect(result.fallbacks).toEqual([]);
  expect(result.slot.transition).toBe('none');
  expect(Math.abs(result.slot.actual.left - result.slot.expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.slot.actual.bottom - result.slot.expected.bottom)).toBeLessThanOrEqual(1);
  expect(result.pointer).toEqual(['none', 'none']);
  expect(result.capturesPointer).toBe(false);
  expect(result.own.x).toBeGreaterThanOrEqual(0);
  expect(result.own.right).toBeLessThanOrEqual((await page.viewportSize()).width);
  expect(result.own.y).toBeGreaterThanOrEqual(0);
  expect(result.own.y).toBeGreaterThanOrEqual(result.table.top);
  await expect(page.locator('[data-wt-own-call]')).toHaveAttribute('aria-hidden', 'true');
  return result;
}

function expectCallBindings(result) {
  expect(result.deck.covered).toEqual([]);
  expect(result.deck.ariaHidden).toBe('true');
  expect(result.deck.pointer).toBe('none');
  for (const rect of result.deck.children) {
    expect(rect.left).toBeGreaterThanOrEqual(result.table.left);
    expect(rect.right).toBeLessThanOrEqual(result.table.right);
    expect(rect.top).toBeGreaterThanOrEqual(result.table.top);
    expect(rect.bottom).toBeLessThanOrEqual(result.table.bottom);
  }
  if (result.deck.upperRoleGap !== null) expect(result.deck.upperRoleGap).toBeGreaterThanOrEqual(2);
  expect(result.visibleFloating).toBe(0);
  expect(result.calls).toHaveLength(result.expectedCalls.length);
  for (const expected of result.expectedCalls) {
    const shown = result.calls.filter(call => call.seat === expected.seat && call.text === expected.text);
    expect(shown).toHaveLength(1);
    const call = shown[0];
    expect(call.inline).toBe(expected.seat !== 'bottom');
    if (call.inline) expect(call.roleSeat).toBe(call.ownerSeat);
    expect(call.box.left).toBeGreaterThanOrEqual(0);
    expect(call.box.right).toBeLessThanOrEqual(result.table.right);
    expect(call.box.top).toBeGreaterThanOrEqual(result.table.top);
    expect(call.textBox.left).toBeGreaterThanOrEqual(call.box.left);
    expect(call.textBox.right).toBeLessThanOrEqual(call.box.right);
    expect(call.textBox.top).toBeGreaterThanOrEqual(call.box.top);
    expect(call.textBox.bottom).toBeLessThanOrEqual(call.box.bottom);
  }
}

async function expectPeerCalls(page, measurements) {
  await expectVisibleBadges(page, measurements);
  const result = await geometry(page);
  measurements.push({ noncaller: true, viewport: page.viewportSize(), ...result });
  expect(result.visibleOwn).toBe(0);
  expect(result.own).toBeNull();
  expect(result.calls).toHaveLength(2);
  expect(result.calls.flatMap(call => call.covered)).toEqual([]);
  expect(result.fallbacks).toEqual([]);
  expectCallBindings(result);
}

async function controlRects(page) {
  return page.locator('[data-wt-stake] button, [data-wt-panel] button, [data-wt-hand] button').evaluateAll(nodes => nodes
    .filter(node => node.checkVisibility())
    .map(node => ({ action: node.dataset.wattenAction || node.dataset.card || 'stake', rect: node.getBoundingClientRect().toJSON() })));
}

async function roleRows(page) {
  return page.locator('.wt-seat:not(.is-own) .wt-seat-call-role').evaluateAll(nodes => nodes.map(node => {
    const role = node.getBoundingClientRect(), badge = node.closest('.wt-seat-badge').getBoundingClientRect();
    return { seat: node.closest('[data-wt-seat]').dataset.wtSeat, roleHeight: role.height,
      badgeHeight: badge.height, rowTop: role.top - badge.top };
  }));
}

async function expectThreeSeatTrick(page, measurements, historyExpected) {
  await expectVisibleBadges(page, measurements);
  const result = await page.evaluate(() => {
    const visible = node => node.checkVisibility() && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const box = node => node.getBoundingClientRect().toJSON();
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const centre = document.querySelector('.wt-centre');
    const protectedNodes = [...document.querySelectorAll('.wt-seat-badge, .wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-seat-tags, .wt-seat-meta, .wt-seat-public-title, '
      + '.wt-backs > i:not([hidden]), .wt-taken[data-filled="true"], .wt-taken[data-filled="true"] i, .wt-stock, .wt-stock > i, .wt-reference, [data-wt-hand-area], [data-wt-stake]')].filter(visible);
    const cards = [...document.querySelectorAll('[data-wt-trick] > .wt-trick-card')].filter(visible);
    const extras = [...document.querySelectorAll('[data-wt-panel]:has(> .wt-prompt:only-child), [data-wt-history]:not([hidden])')].filter(visible);
    return { table: box(document.querySelector('[data-wt-felt]')), centre: box(centre), fallback: centre.dataset.wtPortraitTrickFallback ?? null,
      cards: cards.map(node => ({ box: box(node), covered: protectedNodes.map(other => ({ class: other.className, area: overlap(box(node), box(other)) })).filter(item => item.area > 0) })),
      extras: extras.map(node => ({ class: node.className, box: box(node), history: node.matches('[data-wt-history]'),
        covered: [...protectedNodes, ...cards, ...document.querySelectorAll('.wt-card-owner, .wt-trick-label:not(:empty)'), ...extras]
          .filter(other => other !== node && !other.contains(node) && !node.contains(other) && visible(other))
          .map(other => ({ class: other.className, area: overlap(box(node), box(other)) })).filter(item => item.area > 0) })) };
  });
  measurements.push({ threeSeatTrick: result });
  expect(result.fallback).toBeNull();
  // The public trick may shift slightly to leave room for a captured packet
  // or review. It still spans the middle and preserves every painted card.
  const middle = result.table.left + result.table.width / 2;
  expect(result.centre.left).toBeLessThan(middle);
  expect(result.centre.right).toBeGreaterThan(middle);
  expect(result.cards.length).toBeGreaterThan(0);
  expect(result.cards.flatMap(card => card.covered)).toEqual([]);
  expect(result.extras.flatMap(extra => extra.covered)).toEqual([]);
  expect(result.extras.some(extra => extra.history)).toBe(historyExpected);
  for (const item of [...result.cards, ...result.extras]) {
    expect(item.box.left).toBeGreaterThanOrEqual(result.table.left);
    expect(item.box.right).toBeLessThanOrEqual(result.table.right);
    expect(item.box.top).toBeGreaterThanOrEqual(result.table.top);
    expect(item.box.bottom).toBeLessThanOrEqual(result.table.bottom);
  }
}

async function badgeBaseline(page) {
  return page.evaluate(() => {
    const slot = document.querySelector('[data-wt-own-call]'), parent = slot.parentElement, next = slot.nextSibling;
    const sample = () => {
      const badge = document.querySelector('.wt-seat--bottom .wt-seat-badge');
      const avatar = badge.querySelector('.wt-avatar').getBoundingClientRect();
      const panel = document.querySelector('[data-wt-panel]').getBoundingClientRect();
      const left = Math.max(avatar.left, panel.left), top = Math.max(avatar.top, panel.top);
      const right = Math.min(avatar.right, panel.right), bottom = Math.min(avatar.bottom, panel.bottom);
      return { badge: badge.getBoundingClientRect().toJSON(), avatar: avatar.toJSON(), panel: panel.toJSON(),
        avatarOverlap: Math.max(0, right - left) * Math.max(0, bottom - top),
        badgeActions: badge.querySelectorAll('button, a, input, [data-watten-command]').length,
        coveredBy: right > left && bottom > top ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2)?.className : null };
    };
    const before = sample();
    slot.remove();
    const withoutCallSlot = sample();
    parent.insertBefore(slot, next);
    return { before, withoutCallSlot };
  });
}

for (const language of ['de', 'en']) for (const { count, reference = false } of [{ count: 2 }, { count: 4 }, { count: 4, reference: true }]) {
  test(`${language}: ${count} real callers stay above the growing portrait bid dock${reference ? ' with reference' : ''}`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options, reducedMotion: reference ? 'no-preference' : options.reducedMotion, viewport: PORTRAITS[0], serviceWorkers: 'block' }) };
    const players = [];
    const measurements = [];
    const squareRows = [];
    try {
      for (let index = 0; index < count; index += 1) {
        const item = await player(wrapped, baseURL, language);
        await item.page.clock.install();
        players.push(item);
      }
      await create(players, { determination: 'normal', target: 15, reference });
      for (const { page } of players) {
        await page.evaluate(() => document.fonts.ready);
        await pauseClock(page);
      }
      if (reference) for (const { page } of players) {
        await resize(page, { width: 600, height: 600 });
        squareRows.push(await roleRows(page));
        await resize(page, PORTRAITS[0]);
      }
      for (const { page } of players) measurements.push({ beforeCall: true, viewport: page.viewportSize(), ...await geometry(page) });
      const striker = await action(players, 'announce_strike', '7');
      await settleCalls(striker.page);
      await expectOwnCall(striker.page, measurements);
      const firstCall = await striker.page.locator('[data-wt-own-call] .wt-bubble').elementHandle();
      const colourer = await action(players, 'announce_colour', 'bells');
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'play')).toBe(true);
      const callers = [...new Set([striker, colourer])];
      for (const { page } of callers) await settleCalls(page);
      expect(await firstCall.evaluate(node => node.isConnected)).toBe(true);
      const originalOverlaps = [];
      for (const { page } of callers) {
        const settled = await expectOwnCall(page, measurements);
        await page.clock.runFor(20);
        expect((await expectOwnCall(page, measurements)).slot).toEqual(settled.slot);
        if (reference) {
          await page.evaluate(() => {
            for (const node of document.querySelectorAll('.wt-bubbles [data-watten-call]')) for (const animation of node.getAnimations()) animation.currentTime = 0;
          });
          await expectOwnCall(page, measurements);
          await settleCalls(page);
        }
        if (reference) continue;
        // The original bottom anchor intersects the real stake at 320px.
        const oldAnchor = await page.addStyleTag({ content: '.wt-own-call {display:none!important}.wt-bubbles>.wt-bubble--bottom {display:block!important}' });
        const oldOverlap = await page.evaluate(() => {
          const a = document.querySelector('.wt-bubbles .wt-bubble--bottom').getBoundingClientRect();
          const b = document.querySelector('[data-wt-stake]').getBoundingClientRect();
          return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        });
        originalOverlaps.push(oldOverlap);
        await oldAnchor.evaluate(node => node.remove());
      }
      measurements.push({ originalOverlaps });
      if (!reference) expect(Math.max(...originalOverlaps)).toBeGreaterThan(0);
      const portraits = reference ? [PORTRAITS[0], PORTRAITS[2]] : PORTRAITS;
      for (const viewport of portraits) for (const { page } of callers) {
        await resize(page, viewport);
        await expectOwnCall(page, measurements);
      }
      const shiftedOverlaps = [];
      for (const { page } of callers) {
        await resize(page, PORTRAITS[0]);
      }
      await action(players, 'bid');
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
      if (count === 4) {
        await answerPartnerFeedback(players, 'good');
        await expect(players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold')).page.locator('[data-watten-feedback-received]')).toBeVisible();
      }
      const noncallers = players.filter(item => !callers.includes(item));
      for (const { page } of noncallers) {
        await settleCalls(page);
        await expectPeerCalls(page, measurements);
      }
      if (reference) {
        // Preserve the original own-trump/partner-decision view, then exercise
        // the opposite offer through the real counterbid without a new table.
        for (const [index, { page }] of callers.entries()) {
          await expectOwnCall(page, measurements);
          await page.screenshot({ path: info.outputPath(`first-bid-${language}-${count}-320-${index}.png`) });
        }
        await action(players, 'respond_counter', 'counter');
        await answerPartnerFeedback(players, 'good');
        await expect(players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold')).page.locator('[data-watten-feedback-received]')).toBeVisible();
      }
      for (const { page } of callers) {
        if (reference) continue;
        const offset52 = await page.addStyleTag({ content: '.wt-own-call {display:none!important}.wt-bubbles>.wt-bubble--bottom {display:block!important;bottom:52px!important}' });
        const covered = await page.evaluate(() => {
          const a = document.querySelector('.wt-bubbles .wt-bubble--bottom').getBoundingClientRect();
          const b = document.querySelector('[data-wt-panel]').getBoundingClientRect();
          return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        });
        shiftedOverlaps.push(covered);
        await offset52.evaluate(node => node.remove());
      }
      measurements.push({ shiftedOverlaps });
      if (!reference) expect(Math.max(...shiftedOverlaps)).toBeGreaterThan(0);
      for (const viewport of portraits) for (const { page } of callers) {
        await resize(page, viewport);
        await expectOwnCall(page, measurements);
        if (language === 'en' && count === 2 && viewport.width === 390) {
          const baseline = await badgeBaseline(page);
          measurements.push({ badgeBaseline: baseline });
          expect(baseline.withoutCallSlot).toEqual(baseline.before);
        }
        if (viewport.width === 320) await page.screenshot({ path: info.outputPath(`bid-${language}-${count}-320-${page === callers[0].page ? 'first' : 'second'}.png`) });
      }
      for (const viewport of portraits) for (const [index, { page }] of noncallers.entries()) {
        await resize(page, viewport);
        await expectPeerCalls(page, measurements);
        if (viewport.width === 320) await page.screenshot({ path: info.outputPath(`noncaller-${language}-${count}-320-${index}.png`) });
      }
      await callers[0].page.screenshot({ path: info.outputPath(`bid-${language}-${count}-390.png`) });
      for (const viewport of [{ width: 568, height: 320 }, { width: 1280, height: 800 }]) for (const item of players) {
        const { page } = item;
        await resize(page, viewport);
        await expect(page.locator('[data-wt-own-call]')).toBeHidden();
        await expect(page.locator('.wt-bubbles > [data-watten-call]:visible')).toHaveCount(2);
        await expect(page.locator('[data-watten-role-call]:visible')).toHaveCount(0);
        expect(await page.locator('[data-wt-own-call]').evaluate(node => node.style.cssText)).toBe('');
        await expect(page.locator('[data-wt-own-call]')).not.toHaveAttribute('data-wt-call-fallback');
      }
      for (const { page } of callers) {
        await resize(page, PORTRAITS[0]);
        await expectOwnCall(page, measurements);
      }
      for (const item of players) {
        await resize(item.page, { width: 600, height: 600 });
        if (callers.includes(item)) await expectOwnCall(item.page, measurements);
        else await expectPeerCalls(item.page, measurements);
        if (reference) expect(await roleRows(item.page)).toEqual(squareRows[players.indexOf(item)]);
      }
      if (language === 'de') {
        for (const { page } of players) await resize(page, PORTRAITS[0]);
        await action(players, 'respond_hold', 'hold');
        await playOne(players);
        for (const { page } of players) {
          await page.clock.runFor(1000);
          await expect(page.locator('[data-wt-trick] > .wt-trick-card')).toHaveCount(1);
          await expect(page.locator('.wt-centre')).not.toHaveAttribute('data-wt-portrait-trick-fallback');
        }
      } else {
        const controls = await Promise.all(callers.map(item => controlRects(item.page)));
        for (const { page } of players) await page.clock.runFor(5300);
        for (const [index, { page }] of callers.entries()) await expect.poll(() => controlRects(page)).toEqual(controls[index]);
      }
      for (const { page, traffic } of players) {
        await expect(page.locator('[data-watten-call], [data-watten-role-call]')).toHaveCount(0);
        expect(await page.locator('.wt-role-static').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width > 1))).toBe(true);
        expect(traffic.errors).toEqual([]);
        if (reference && language === 'en') expect(await roleRows(page)).toEqual(squareRows[players.findIndex(item => item.page === page)]);
      }
    } finally {
      const geometryPath = info.outputPath('geometry.json');
      await writeFile(geometryPath, JSON.stringify(measurements, null, 2));
      await info.attach('call-layout-geometry', { path: geometryPath, contentType: 'application/json' });
      await Promise.allSettled(players.map(item => item.context.close()));
    }
  });
}

test('de: three-seat solo announcements retain both values at the same peer seat', async ({ browser, baseURL }, info) => {
  const wrapped = { newContext: options => browser.newContext({ ...options, reducedMotion: 'no-preference', viewport: PORTRAITS[0], serviceWorkers: 'block' }) };
  const players = [], measurements = [];
  try {
    for (let index = 0; index < 3; index += 1) {
      const item = await player(wrapped, baseURL);
      await item.page.clock.install();
      await item.page.addInitScript(() => {
        const animate = Element.prototype.animate;
        window.__wattenDealOrigins = [];
        Element.prototype.animate = function (frames, options) {
          if (this.dataset.wtMotion === 'deal') {
            const deck = document.querySelector('[data-wt-deck]').getBoundingClientRect();
            const target = this.getBoundingClientRect();
            const [x, y] = frames[0].translate.split(' ').map(Number.parseFloat);
            window.__wattenDealOrigins.push({ deck: deck.toJSON(),
              x: target.left + target.width / 2 + x, y: target.top + target.height / 2 + y });
          }
          return animate.call(this, frames, options);
        };
      });
      players.push(item);
    }
    await create(players, { determination: 'normal', target: 15 });
    for (const { page } of players) {
      await page.evaluate(() => document.fonts.ready);
      const origins = await page.evaluate(() => window.__wattenDealOrigins);
      measurements.push({ dealOrigins: origins });
      expect(origins.length).toBeGreaterThan(0);
      for (const origin of origins) {
        expect(Math.abs(origin.deck.left + origin.deck.width / 2 - PORTRAITS[0].width / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(origin.x - (origin.deck.left + origin.deck.width / 2))).toBeLessThanOrEqual(1);
        expect(Math.abs(origin.y - (origin.deck.top + origin.deck.height / 2))).toBeLessThanOrEqual(1);
      }
      await expect(page.locator('[data-wt-motion="deal"]')).toHaveCount(0);
      await pauseClock(page);
    }
    for (const { page } of players) {
      await expectVisibleBadges(page, measurements);
      measurements.push({ beforeCall: true, viewport: page.viewportSize(), ...await geometry(page) });
    }
    const solo = await action(players, 'announce_strike', '7');
    const caller = await action(players, 'announce_colour', 'bells');
    expect(caller).toBe(solo);
    for (const { page } of players) await settleCalls(page);
    await expect(solo.page.locator('[data-wt-own-call] > [data-watten-call]:visible')).toHaveCount(2);
    await expect(solo.page.locator('[data-wt-own-call]')).not.toHaveAttribute('data-wt-call-fallback');
    await expectVisibleBadges(solo.page, measurements);
    const ownRoles = await solo.page.locator('.wt-seat--bottom .wt-role-name').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
    expect(ownRoles).toHaveLength(2);
    expect(ownRoles[0].bottom).toBeLessThanOrEqual(ownRoles[1].top);
    await solo.page.screenshot({ path: info.outputPath('solo-own-320.png') });
    for (const item of players.filter(item => item !== solo)) {
      const labels = item.page.locator(`[data-wt-seat="${solo.traffic.snapshot.viewer.seat}"] [data-watten-role-call]`);
      await expect(labels).toHaveText(['Schlag: Sieben', 'Farbe: Schellen']);
      for (const viewport of [PORTRAITS[0], PORTRAITS[2]]) {
        await resize(item.page, viewport);
        await expectPeerCalls(item.page, measurements);
        if (viewport.width === 320) await item.page.screenshot({ path: info.outputPath(`solo-peer-${players.indexOf(item)}-320.png`) });
      }
      await item.page.screenshot({ path: info.outputPath(`solo-peer-${players.indexOf(item)}.png`) });
    }
    for (const { page } of players) await page.clock.runFor(5300);
    for (const { page, traffic } of players) {
      await expect(page.locator('[data-watten-call], [data-watten-role-call]')).toHaveCount(0);
      await expectVisibleBadges(page, measurements);
      expect(traffic.errors).toEqual([]);
    }
    for (const { page } of players) await resize(page, PORTRAITS[0]);
    for (let index = 0; index < 3; index += 1) {
      await playOne(players);
      for (const { page } of players) {
        await page.clock.runFor(4000);
        await expect(page.locator('[data-wt-motion]')).toHaveCount(0);
        await expectThreeSeatTrick(page, measurements, index === 2);
      }
    }
    for (const [index, { page }] of players.entries()) {
      await page.screenshot({ path: info.outputPath(`solo-trick-${index}.png`) });
      const history = page.locator('[data-wt-history]');
      await history.evaluate(node => {
        node.addEventListener('toggle', () => { node.dataset.testNativeToggle = node.open ? 'open' : 'closed'; });
      });
      await history.locator('summary').click();
      await expect(history).toHaveAttribute('open');
      // Native toggle is a separate task. Observe it before advancing the
      // paused RAF clock; the synchronous open attribute is not that event.
      await expect(history).toHaveAttribute('data-test-native-toggle', 'open');
      await page.clock.runFor(20);
      await expect(history).not.toHaveAttribute('data-wt-portrait-history');
      await history.locator('[data-wt-history-close]').click();
      await expect(history).not.toHaveAttribute('open');
      await expect(history).toHaveAttribute('data-test-native-toggle', 'closed');
      await page.clock.runFor(20);
      await expectThreeSeatTrick(page, measurements, true);
    }
  } finally {
    await writeFile(info.outputPath('geometry.json'), JSON.stringify(measurements, null, 2));
    await Promise.allSettled(players.map(item => item.context.close()));
  }
});
