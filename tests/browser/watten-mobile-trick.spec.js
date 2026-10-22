const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { player, create, action, answerPartnerFeedback, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');
const { expectLandscapeTable } = require('./helpers/watten-landscape.cjs');
const { expectHandFans, expectLargerBackCards } = require('./helpers/watten-hand-fans.cjs');
const { exportTableReview } = require('./helpers/watten-review.cjs');
const { expectFixedTable, expectReachable } = require('./table-viewport');

test.setTimeout(90_000);

async function expectPlainAccessibleTrick(peer) {
  await expect(peer.page.locator('[data-wt-trick] .wt-card-owner')).toHaveCount(0);
  const engine = peer.traffic.snapshot.engine;
  const cards = engine.current_trick.cards.length ? engine.current_trick.cards : engine.last_trick?.cards || [];
  for (const item of cards) {
    const card = peer.page.locator(`[data-wt-trick] > [data-key="${item.card}"]`);
    await expect(card).toHaveCount(1);
    expect(await card.getAttribute('aria-label')).toContain(` · ${peer.traffic.snapshot.room.seats[item.seat].name}`);
  }
}

async function expectCloverGeometry(page) {
  await expect.poll(() => page.locator('[data-wt-trick] > .wt-trick-card').evaluateAll(cards => {
    const errors = [];
    const shapes = Object.fromEntries(cards.map(card => {
      const rect = card.getBoundingClientRect();
      return [card.dataset.position, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }];
    }));
    if (cards.length !== 4 || !shapes.left || !shapes.right || !shapes.top || !shapes.bottom) return ['four source positions required'];
    if (shapes.left.x >= shapes.top.x || shapes.right.x <= shapes.top.x) errors.push('left/right clover petals lost');
    if (shapes.top.y >= shapes.left.y || shapes.bottom.y <= shapes.left.y) errors.push('top/bottom clover petals lost');
    if (Math.abs(shapes.top.x - shapes.bottom.x) > 2 || Math.abs(shapes.left.y - shapes.right.y) > 2) errors.push('opposite clover petals are not symmetric');
    const faces = Object.values(shapes);
    for (let first = 0; first < faces.length; first++) for (let second = first + 1; second < faces.length; second++) {
      if (Math.min(faces[first].right, faces[second].right) - Math.max(faces[first].left, faces[second].left) <= 1
        || Math.min(faces[first].bottom, faces[second].bottom) - Math.max(faces[first].top, faces[second].top) <= 1) errors.push('clover petals do not overlap');
    }
    return errors;
  }), { message: 'four cards form symmetric overlapping clover petals toward their source players' }).toEqual([]);
}

async function expectExposedFaces(page, minimum = .25) {
  await expect.poll(() => page.locator('.wt-trick-card').evaluateAll((cards, minimum) => cards.flatMap(card => {
    const box = card.getBoundingClientRect();
    let visible = 0;
    for (let x = 0; x < 8; x++) for (let y = 0; y < 10; y++) {
      if (card.contains(document.elementFromPoint(box.left + box.width * (x + .5) / 8,
        box.top + box.height * (y + .5) / 10))) visible++;
    }
    return visible / 80 < minimum ? [{ card: card.dataset.card, visibleFraction: visible / 80 }] : [];
  }), minimum), { message: `each played card retains at least ${minimum * 100}% of its visible face in the spread pile` }).toEqual([]);
}

async function expectPortraitSeatLabelsClear(page) {
  await expect.poll(() => page.evaluate(() => {
    const visible = node => {
      const bounds = node.getBoundingClientRect(), style = getComputedStyle(node);
      return !node.hidden && style.display !== 'none' && style.visibility !== 'hidden'
        && bounds.width > 0 && bounds.height > 0;
    };
    const labels = [...document.querySelectorAll('.wt-seat-name, .wt-seat-call-role')].filter(visible);
    const surfaces = [...document.querySelectorAll('.wt-trick-card, .wt-trick-label, [data-wt-history]:not([open])')]
      .filter(node => visible(node) && (node.matches('.wt-trick-card') || node.textContent.trim()));
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    return labels.flatMap(label => surfaces.filter(surface => intersects(label.getBoundingClientRect(), surface.getBoundingClientRect()))
      .map(surface => ({ label: label.textContent.trim(), labelClass: label.className, surface: surface.className,
        labelBounds: label.getBoundingClientRect().toJSON(), surfaceBounds: surface.getBoundingClientRect().toJSON() })));
  }), { message: 'played cards, winner caption and closed review keep the actual player names and call roles clear' }).toEqual([]);
}

async function expectLargerLandscapeCards(page, viewport, { trick = false } = {}) {
  const ownWidth = viewport.width === 568 ? 60 : 76;
  const trickWidth = viewport.height <= 360 ? 48 : viewport.height <= 410 ? 52 : 64;
  await expect.poll(() => page.locator('[data-wt-hand] button').evaluateAll(cards =>
    Math.min(...cards.map(node => Number.parseFloat(getComputedStyle(node).width)))))
    .toBeGreaterThanOrEqual(ownWidth - .1);
  if (trick) await expect.poll(() => page.locator('.wt-trick-card').evaluateAll(cards =>
    Math.min(...cards.map(node => Number.parseFloat(getComputedStyle(node).width)))))
    .toBeGreaterThanOrEqual(trickWidth - .1);
}

async function expectInspectionActionByHand(page) {
  await expectReachable(page, '[data-watten-action=show_ready]');
  await expect.poll(() => page.locator('[data-watten-action=show_ready]').evaluate(node => {
    const button = node.getBoundingClientRect();
    const felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
    const own = document.querySelector('.wt-seat--bottom .wt-avatar').getBoundingClientRect();
    return button.left >= felt.left && button.right <= felt.right && button.bottom <= felt.bottom
      && button.top >= felt.top + felt.height * .55
      && button.x + button.width / 2 > own.x + own.width / 2 + 20
      && button.width >= 44 && button.height >= 44;
  }), { message: 'Schlag/Farbe stays next to the future own hand, to the right of its player, in the lower table' }).toBe(true);
}

async function recordLayout(page, info, stage) {
  const path = info.outputPath(`${stage}-portrait-layout.json`);
  const geometry = await page.evaluate(() => {
    const rect = node => { const { x, y, width, height, top, right, bottom, left } = node.getBoundingClientRect(); return { x, y, width, height, top, right, bottom, left }; };
    return {
      centre: { ...document.querySelector('.wt-centre').dataset }, felt: rect(document.querySelector('.wt-felt')),
      label: document.querySelector('.wt-trick-label').textContent,
      obstacles: [...document.querySelectorAll('.wt-seat-badge, .wt-seat-name, .wt-seat-call-role, .wt-backs > i:not([hidden]), .wt-taken[data-filled="true"], .wt-stock, [data-wt-hand-area], [data-wt-panel], [data-wt-private] button, [data-wt-stake], [data-wt-history]:not([open])')]
        .filter(node => !node.hidden && getComputedStyle(node).display !== 'none')
        .map(node => ({ tag: node.tagName, class: node.className, rect: rect(node) })),
      reference: document.querySelector('.wt-reference') ? rect(document.querySelector('.wt-reference')) : null,
    };
  });
  await writeFile(path, JSON.stringify(geometry, null, 2));
  await info.attach(`${stage}-portrait-layout`, { path, contentType: 'application/json' });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }]) {
  test(`four-player portrait ${viewport.width}x${viewport.height}: spatial trick stack, clear winner and readable review`, async ({ browser, baseURL }, info) => {
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options, viewport, serviceWorkers: 'block' }) };
      for (let index = 0; index < 4; index++) players.push(await player(wrapped, baseURL));
      await create(players, { determination: 'normal', target: 15 });
      await normalCall(players);
      await expectLargerBackCards(players[0].page);
      for (let index = 0; index < 3; index++) {
        await playOne(players);
        await expect.poll(() => players[0].traffic.snapshot?.engine?.current_trick?.cards.length).toBe(index + 1);
      }
      const page = players[0].page;
      await expect(page.locator('.wt-trick-card')).toHaveCount(3);
      await expect(page.locator('[data-watten-call]')).toHaveCount(0);
      await expectTableHeaderReachable(page);
      await recordLayout(page, info, 'live');
      await expect.poll(() => page.locator('.wt-trick-card').first().evaluate(node => Number.parseFloat(getComputedStyle(node).width)))
        .toBeGreaterThanOrEqual(viewport.width <= 350 ? 64 : 76);
      await expect.poll(() => page.evaluate(() => {
        const errors = [], cards = [...document.querySelectorAll('.wt-trick-card')];
        const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
        const protectedNodes = [...document.querySelectorAll('.wt-seat-badge, .wt-seat-name, .wt-seat-call-role, .wt-backs > i:not([hidden]), [data-wt-hand-area], [data-wt-panel], [data-wt-stake]')].filter(visible);
        const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        for (const card of cards) {
          const bounds = card.getBoundingClientRect();
          if (bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight) errors.push('card outside viewport');
          if (protectedNodes.some(node => intersects(bounds, node.getBoundingClientRect()))) errors.push('card overlaps hand, avatar or control');
          if (card.querySelector('.wt-card-owner')) errors.push('trick card has an unwanted visible owner/order label');
        }
        const positions = Object.fromEntries(cards.map(card => [card.dataset.position, card.getBoundingClientRect()]));
        if (positions.left && positions.right && positions.left.x >= positions.right.x) errors.push('left/right source placement lost');
        if (positions.top && positions.bottom && positions.top.y >= positions.bottom.y) errors.push('top/bottom source placement lost');
        const bounds = cards.map(card => card.getBoundingClientRect());
        const connected = new Set([0]);
        for (let step = 0; step < bounds.length; step++) {
          for (let index = 0; index < bounds.length; index++) {
            if ([...connected].some(other => intersects(bounds[index], bounds[other]))) connected.add(index);
          }
        }
        if (connected.size !== bounds.length) errors.push('played cards do not form one connected pile');
        return errors;
      }), { message: 'plain cards overlap toward their source seats while player badges and controls stay clear' }).toEqual([]);
      await expectPlainAccessibleTrick(players[0]);
      await expectPortraitSeatLabelsClear(page);
      await expect(page.locator('.wt-centre')).toHaveAttribute('data-wt-portrait-trick-mode', 'stack');
      await expectExposedFaces(page);
      await exportTableReview(players[0], 'live-trick');
      await page.screenshot({ path: info.outputPath(`watten-current-${viewport.width}x${viewport.height}.png`) });
      await playOne(players);
      await expect.poll(() => players[0].traffic.snapshot?.engine?.last_trick?.cards.length).toBe(4);
      await expect(page.locator('.wt-trick[data-state="last"] .wt-trick-card')).toHaveCount(4);
      await expectPlainAccessibleTrick(players[0]);
      const winningCard = players[0].traffic.snapshot.engine.last_trick.cards.find(item =>
        item.seat === players[0].traffic.snapshot.engine.last_trick.winner).card;
      await expect(page.locator(`.wt-trick-card.is-winning-card[data-card="${winningCard}"]`)).toHaveCount(1);
      await expectExposedFaces(page);
      await recordLayout(page, info, 'completed');
      await expect.poll(() => page.locator('.wt-trick-card').first().evaluate(node => Number.parseFloat(getComputedStyle(node).width)))
        .toBeGreaterThanOrEqual(viewport.width <= 350 ? 64 : 76);
      await expect.poll(() => page.locator('.wt-trick-label').evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), { message: 'completed trick keeps its larger faces and a visible winner label' }).toBe(true);
      await expectPortraitSeatLabelsClear(page);
      await expect.poll(() => page.locator('.wt-trick-card.is-winning-card').evaluate(node => {
        const pose = () => {
          const { x, y, width, height } = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return { x, y, width, height, zIndex: style.zIndex, rotate: style.rotate };
        };
        const highlighted = pose();
        const highlight = getComputedStyle(node).outlineStyle;
        node.classList.remove('is-winning-card');
        const original = pose();
        const ordinary = getComputedStyle(node).outlineStyle;
        node.classList.add('is-winning-card');
        return JSON.stringify(highlighted) === JSON.stringify(original) && highlight === 'solid' && ordinary === 'none';
      }), { message: 'winner highlight preserves its original card position and overlap order' }).toBe(true);
      await exportTableReview(players[0], 'completed-trick');
      await page.screenshot({ path: info.outputPath(`watten-completed-${viewport.width}x${viewport.height}.png`) });
      const history = page.locator('[data-wt-history]');
      if (!await history.evaluate(node => node.open)) await history.locator('summary').click();
      await expect(history.locator('.wt-history > li').last().locator('.wt-card--mini')).toHaveCount(4);
      await expect(history.locator('.wt-history > li').last().locator('figcaption')).toHaveText(
        players[0].traffic.snapshot.engine.last_trick.cards.map(item => players[0].traffic.snapshot.room.seats[item.seat].name));
      await expect.poll(() => history.locator('.wt-card--mini').first().evaluate(node => Number.parseFloat(getComputedStyle(node).width))).toBeGreaterThanOrEqual(60);
      await expect.poll(() => history.evaluate(node => {
        const cards = [...node.querySelectorAll('.wt-history > li:last-child .wt-mini-cards > figure')];
        return cards.every(figure => {
          const rect = figure.getBoundingClientRect(), port = node.querySelector('.wt-history').getBoundingClientRect();
          return rect.left >= port.left - 1 && rect.right <= port.right + 1 && rect.top >= port.top - 1 && rect.bottom <= port.bottom + 1
            && figure.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
      }), { message: 'all four larger review cards and their names fit together without scrolling' }).toBe(true);
      await page.screenshot({ path: info.outputPath(`watten-review-${viewport.width}x${viewport.height}.png`) });
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

for (const viewport of [{ width: 852, height: 393 }, { width: 568, height: 320 }]) {
test(`four-player mobile landscape ${viewport.width}x${viewport.height}: left rail, mirrored table, centered trick and bid review`, async ({ browser, baseURL }, info) => {
  const players = [];
  let spectator;
  try {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport, serviceWorkers: 'block' }) };
    for (let index = 0; index < 4; index++) players.push(await player(wrapped, baseURL));
    const path = await create(players, { determination: 'normal', target: 15 });
    await normalCall(players);
    await expectLandscapeTable(players[0].page);
    const page = players[0].page;
    await expectLargerLandscapeCards(page, viewport);
    await expectHandFans(page);
    if (viewport.width === 852) {
      spectator = await player(wrapped, baseURL);
      await spectator.page.goto(`${path}/zuschauen`);
      await expect(spectator.page.locator('[data-wt-table]')).toBeVisible();
      await exportTableReview(spectator, 'spectator-full', { spectator: true });
      for (const fanViewport of [viewport, { width: 568, height: 320 }, { width: 393, height: 852 }, { width: 320, height: 568 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(fanViewport);
        await spectator.page.setViewportSize(fanViewport);
        await expectHandFans(page);
        await expectHandFans(spectator.page, { spectator: true });
        if (fanViewport.width > fanViewport.height && fanViewport.height <= 700) await expectLandscapeTable(spectator.page);
        await page.screenshot({ path: info.outputPath(`watten-hand-fans-${fanViewport.width}x${fanViewport.height}.png`) });
        await spectator.page.screenshot({ path: info.outputPath(`watten-spectator-fans-${fanViewport.width}x${fanViewport.height}.png`) });
      }
      await page.setViewportSize(viewport);
    }
    for (let index = 0; index < 3; index++) await playOne(players);
    await expect(page.locator('.wt-trick-card')).toHaveCount(3);
    await expectPlainAccessibleTrick(players[0]);
    await expectLandscapeTable(page);
    await expectLargerLandscapeCards(page, viewport, { trick: true });
    await expectExposedFaces(page, viewport.height <= 360 ? .075 : .2);
    await page.screenshot({ path: info.outputPath(`watten-live-${viewport.width}x${viewport.height}.png`) });
    await playOne(players);
    await expect(page.locator('.wt-trick[data-state="last"] .wt-trick-card')).toHaveCount(4);
    await expectPlainAccessibleTrick(players[0]);
    await expectCloverGeometry(page);
    await expectLandscapeTable(page, { completedPile: true });
    await expectLargerLandscapeCards(page, viewport, { trick: true });
    await expectFixedTable(page, ['[data-wt-felt]', '[data-wt-scores]', '[data-wt-hand-area]']);
    // Compact short-screen clovers expose a smaller edge band. Require the
    // clover's full geometry above as well as a painted part of every face.
    await expectExposedFaces(page, viewport.height <= 360 ? .075 : .2);
    await exportTableReview(players[0], `completed-trick-landscape-${viewport.width}`);
    if (viewport.width === 852) await exportTableReview(players[0], 'completed-trick-landscape');
    await page.screenshot({ path: info.outputPath(`watten-completed-${viewport.width}x${viewport.height}.png`) });
    await expect.poll(() => players.every(item => item.traffic.snapshot.engine.last_trick?.cards.length === 4)).toBe(true);
    const nextPlayer = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
    const liveReview = nextPlayer.page.locator('[data-wt-history]');
    if (!await liveReview.evaluate(node => node.open)) await liveReview.locator('summary').click();
    await liveReview.locator('[data-wt-history-pin]').check();
    await expect(liveReview).toHaveAttribute('data-pinned', 'true');
    await expectLandscapeTable(nextPlayer.page);
    expect(await nextPlayer.page.locator('[data-wt-hand] button:enabled').count()).toBeGreaterThan(0);
    for (const card of await nextPlayer.page.locator('[data-wt-hand] button:enabled').all()) await expectReachable(nextPlayer.page,
      `[data-wt-hand] button[data-card="${await card.getAttribute('data-card')}"]`);
    await nextPlayer.page.screenshot({ path: info.outputPath(`watten-pinned-review-${viewport.width}x${viewport.height}.png`) });
    await liveReview.locator('[data-wt-history-close]').click();
    await action(players, 'bid');
    await answerPartnerFeedback(players);
    const decider = players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold'));
    await expectLandscapeTable(decider.page);
    for (const value of ['hold', 'go', 'counter']) await expectReachable(decider.page,
      `[data-watten-bid] [data-kind="respond"][data-value="${value}"]`);
    const history = decider.page.locator('[data-wt-history]');
    if (!await history.evaluate(node => node.open)) await history.locator('summary').click();
    await expect(history).toHaveAttribute('open', '');
    await expect(history.locator('.wt-history > li').last().locator('.wt-card--mini')).toHaveCount(4);
    await expect(history.locator('.wt-history > li').last().locator('figcaption')).toHaveText(
      decider.traffic.snapshot.engine.last_trick.cards.map(item => decider.traffic.snapshot.room.seats[item.seat].name));
    await expect.poll(() => history.locator(':scope > .wt-history').evaluate(node => node.clientHeight)).toBeGreaterThan(0);
    await expectLandscapeTable(decider.page);
    await expectReachable(decider.page, '[data-wt-history-close]');
    for (const value of ['hold', 'go', 'counter']) await expectReachable(decider.page,
      `[data-watten-bid] [data-kind="respond"][data-value="${value}"]`);
    await exportTableReview(decider, `bid-landscape-${viewport.width}`);
    await decider.page.screenshot({ path: info.outputPath(`watten-bid-review-${viewport.width}x${viewport.height}.png`) });
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled([...players, spectator].filter(Boolean).map(item => item.context.close())); }
});

test(`four-player mobile landscape ${viewport.width}x${viewport.height}: left rail and mirrored blind inspection${viewport.width === 568 ? ' during pending Blödeln' : ''}`, async ({ browser, baseURL }, info) => {
  const players = [];
  try {
    const wrapped = { newContext: options => browser.newContext({ ...options, viewport, serviceWorkers: 'block' }) };
    for (let index = 0; index < 4; index++) players.push(await player(wrapped, baseURL));
    await create(players, { target: 15, reference: true });
    await expect.poll(() => players.every(item => item.traffic.snapshot?.engine?.phase === 'show_ready')).toBe(true);
    const inspectors = players.filter(item => item.traffic.snapshot.engine.actions.includes('show_ready'));
    const viewer = inspectors[0];
    await expectLandscapeTable(viewer.page);
    await expect(viewer.page.locator('[data-watten-reference]')).toHaveCount(0);
    for (const inspector of inspectors) {
      const roles = inspector.traffic.snapshot.engine.announcement_roles;
      const scene = roles.strike === inspector.traffic.snapshot.engine.viewer.seat ? 'show-strike' : 'show-colour';
      await expect(inspector.page.locator('[data-watten-action=show_ready]')).toHaveText(scene === 'show-strike' ? 'Schlag zeigen' : 'Farbe zeigen');
      await expectInspectionActionByHand(inspector.page);
      await exportTableReview(inspector, `${scene}-landscape-${viewport.width}`);
      if (viewport.width === 852) await exportTableReview(inspector, scene);
    }
    await viewer.page.screenshot({ path: info.outputPath(`watten-show-by-hand-${viewport.width}x${viewport.height}.png`) });
    let responder;
    if (viewport.width === 568) {
      await action(players, 'request_bloedeln');
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln')).toBe(true);
      const seat = viewer.traffic.snapshot.engine.preplay.pending.responder;
      responder = players.find(item => item.traffic.snapshot.engine.viewer.seat === seat);
      await expectReachable(responder.page, '[data-watten-action=preplay_decline]');
    }
    await expectReachable(viewer.page, '[data-watten-action=show_ready]');
    await action(players, 'show_ready');
    await action(players, 'show_ready');
    await expect(viewer.page.locator('[data-watten-inspection]')).toBeVisible();
    await expect(viewer.page.locator('[data-watten-inspection] .wt-card')).toHaveCount(2);
    await expect(viewer.page.locator('[data-watten-reference]')).toHaveCount(0);
    await expectLandscapeTable(viewer.page, { inspection: true });
    await expectReachable(viewer.page, '[data-watten-action=inspection_ack]');
    await exportTableReview(viewer, `inspection-landscape-${viewport.width}`);
    await viewer.page.screenshot({ path: info.outputPath(`watten-inspection-${viewport.width}x${viewport.height}.png`) });
    for (const inspector of inspectors) await expectReachable(inspector.page, '[data-watten-action=inspection_ack]');
    await action(players, 'inspection_ack');
    await action(players, 'inspection_ack');
    if (responder) {
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'play'
        && item.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln')).toBe(true);
      await expectReachable(responder.page, '[data-watten-action=preplay_decline]');
      await action(players, 'preplay_decline');
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.preplay.pending === null)).toBe(true);
      const actor = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
      await expectLandscapeTable(actor.page);
      await expectReachable(actor.page, '[data-wt-hand] button:enabled:first-child');
    } else {
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'play')).toBe(true);
      await exportTableReview(viewer, 'hand-full');
      await expectHandFans(viewer.page);
      await expectLargerLandscapeCards(viewer.page, viewport);
    }
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
}
