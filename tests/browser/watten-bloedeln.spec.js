const { test, expect } = require('@playwright/test');
const { player, create, action } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(90_000);
const mobile = browser => ({ newContext: options => browser.newContext({ ...options,
  viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) });

async function settledPrimaryTarget(page, viewport, action) {
  return page.evaluate(({ viewport, action }) => new Promise(resolve => {
    const landscape = viewport.width > viewport.height && viewport.height <= 700;
    const expectedWidth = landscape ? (viewport.width <= 720 ? 84 : 104) : 120;
    let previous = '', stable = 0;
    const frame = () => {
      const target = document.querySelector(`[data-watten-action="${action}"]`);
      const anchor = action === 'show_ready' ? target?.closest('.wt-announce') : target;
      const rect = target?.getBoundingClientRect();
      const ready = innerWidth === viewport.width && innerHeight === viewport.height
        && matchMedia('(orientation: landscape)').matches === (viewport.width > viewport.height)
        && rect?.width === expectedWidth && rect.height === 44
        && anchor && getComputedStyle(anchor).position === 'fixed';
      const current = ready ? JSON.stringify([rect.x, rect.y, rect.width, rect.height,
        document.querySelector('[data-wt-felt]')?.getBoundingClientRect().toJSON()]) : '';
      stable = current && current === previous ? stable + 1 : 0; previous = current;
      if (stable >= 3) resolve({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), { viewport, action });
}

test('primary target baseline waits for delayed landscape dock geometry after rotation', async ({ page }) => {
  const viewport = { width: 956, height: 440 };
  await page.setViewportSize(viewport);
  await page.setContent('<div class="wt-announce" style="position:fixed;right:12px;bottom:34px"><button data-watten-action="show_ready" style="box-sizing:border-box;width:120px;height:44px">Show strike</button></div>');
  await page.evaluate(() => {
    window.dockFrames = 0;
    const frame = () => {
      window.dockFrames++;
      if (window.dockFrames === 8) document.querySelector('button').style.width = '104px';
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  expect(await settledPrimaryTarget(page, viewport, 'show_ready')).toEqual({ x: 840, y: 362, width: 104, height: 44 });
  expect(await page.evaluate(() => window.dockFrames)).toBe(8);
});

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
  const viewports = [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 956, height: 440 }, { width: 852, height: 393 }, { width: 568, height: 320 }];
  const primaryTargets = new Map();
  const inspecting = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('show_ready'));
  for (const viewport of viewports) for (const caller of inspecting) {
    await caller.page.setViewportSize(viewport);
    const target = await settledPrimaryTarget(caller.page, viewport, 'show_ready');
    await expectReachable(caller.page, '[data-watten-action=show_ready]');
    primaryTargets.set(`${caller.user.id}:${viewport.width}`, target);
  }
  await action(players, 'show_ready'); await action(players, 'show_ready');
  if (players.some(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln'
      || peer.traffic.snapshot.engine.preplay.bloedeln_status === 'accepted')) {
    const callers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('inspection_ack'));
    expect(callers).toHaveLength(2);
    for (const viewport of viewports) {
      for (const peer of players) await peer.page.setViewportSize(viewport);
      for (const caller of callers) {
        await settledPrimaryTarget(caller.page, viewport, 'inspection_ack');
        await expectReachable(caller.page, '[data-watten-action=inspection_ack]');
        const before = primaryTargets.get(`${caller.user.id}:${viewport.width}`);
        await expect.poll(async () => {
          const current = await caller.page.locator('[data-watten-action=inspection_ack]').boundingBox();
          return ['x', 'y', 'width', 'height'].every(key => Math.abs(before[key] - current[key]) <= 1);
        }, { message: 'showing and ACK keep one primary touch target through inspection' }).toBe(true);
        await expect.poll(() => caller.page.evaluate(() => {
          const rect = node => node.getBoundingClientRect();
          const shown = node => rect(node).width > 0 && rect(node).height > 0 && getComputedStyle(node).visibility !== 'hidden';
          const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
          const obstacles = [...document.querySelectorAll('.wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-seat-public-title, '
            + '.wt-backs > i:not([hidden]), .wt-stock, [data-wt-panel]')].filter(shown);
          const faces = [...document.querySelectorAll('[data-watten-inspection] .wt-card')];
          const captions = [...document.querySelectorAll('[data-watten-inspection] figcaption')];
          const failures = [];
          if (faces.length !== 2) failures.push('inspection must show exactly two permitted faces');
          const reveal = document.querySelector('[data-wt-reveal]');
          if (reveal?.dataset.wtInspectionFit === 'unfit') failures.push(`supported viewport did not fit: ${reveal.dataset.wtInspectionReason}`);
          for (const [index, face] of faces.entries()) {
            const box = rect(face), width = Number.parseFloat(getComputedStyle(face).width);
            if (width < 51.9) failures.push(`face ${index} too small: ${width}px`);
            if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) failures.push(`face ${index} outside viewport`);
          }
          const pointerValues = faces.map(face => face.style.pointerEvents);
          faces.forEach(face => { face.style.pointerEvents = 'auto'; });
          try {
            for (const [index, face] of faces.entries()) {
              const box = rect(face), style = getComputedStyle(face), angle = (Number.parseFloat(style.rotate) || 0) * Math.PI / 180;
              const width = Number.parseFloat(style.width), height = Number.parseFloat(style.height);
              const exposed = (x, y) => {
                const a = (x - .5) * width, b = (y - .5) * height;
                return face.contains(document.elementFromPoint(box.x + box.width / 2 + a * Math.cos(angle) - b * Math.sin(angle),
                  box.y + box.height / 2 + a * Math.sin(angle) + b * Math.cos(angle)));
              };
              let visible = 0;
              for (let x = 0; x < 8; x++) for (let y = 0; y < 10; y++) if (exposed((x + .5) / 8, (y + .5) / 10)) visible++;
              if (visible < 20) failures.push(`face ${index} exposes less than a quarter of its printed area`);
              if (![[.1, .08], [.9, .08], [.1, .92], [.9, .92]].some(([x, y]) => exposed(x, y))) failures.push(`face ${index} has no exposed rank/suit corner`);
            }
          } finally { faces.forEach((face, index) => { face.style.pointerEvents = pointerValues[index]; }); }
          // Owner contract: both faces lie on the straight line between the two
          // callers' painted hands. The own face leaves beyond the outermost own
          // card towards the other caller; overlap of the two faces is allowed.
          const middle = box => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
          const union = boxes => middle({ left: Math.min(...boxes.map(b => b.left)), top: Math.min(...boxes.map(b => b.top)),
            width: Math.max(...boxes.map(b => b.right)) - Math.min(...boxes.map(b => b.left)),
            height: Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.top)) });
          const handCards = [...document.querySelectorAll('[data-wt-hand-area]:not([hidden]) [data-wt-hand] > *')].filter(shown).map(rect);
          const seats = faces.map(face => document.querySelector(`[data-wt-seat="${face.closest('[data-wt-inspection-seat]').dataset.wtInspectionSeat}"]`));
          const fans = seats.map(seat => seat.classList.contains('is-own') ? handCards
            : [...seat.querySelectorAll('.wt-backs:not([hidden]) > i:not([hidden])')].filter(shown).map(rect));
          if (faces.length !== 2 || fans.some(fan => !fan.length)) failures.push('a caller has no painted hand');
          else {
            const rough = fans.map(union);
            // Owner rule, stated directly: other caller right of the own hand →
            // rightmost card; left → leftmost; straight across → topmost.
            const origins = fans.map((fan, index) => {
              if (!seats[index].classList.contains('is-own')) return rough[index];
              const dx = rough[1 - index].x - rough[index].x;
              const xs = fan.map(card => middle(card).x), ys = fan.map(card => middle(card).y);
              const aligned = Math.max(2, (Math.max(...fan.map(card => card.right)) - Math.min(...fan.map(card => card.left))) * .01);
              const pick = Math.abs(dx) <= aligned ? ys.indexOf(Math.min(...ys)) : xs.indexOf(dx > 0 ? Math.max(...xs) : Math.min(...xs));
              return middle(fan[pick]);
            });
            const delta = { x: origins[1].x - origins[0].x, y: origins[1].y - origins[0].y };
            const length = Math.hypot(delta.x, delta.y), unit = { x: delta.x / length, y: delta.y / length };
            const oriented = faces.map(face => {
              const style = getComputedStyle(face), angle = (Number.parseFloat(style.rotate) || 0) * Math.PI / 180;
              return { ...middle(rect(face)), hw: Number.parseFloat(style.width) / 2, hh: Number.parseFloat(style.height) / 2,
                u: { x: Math.sin(angle), y: -Math.cos(angle) }, n: { x: Math.cos(angle), y: Math.sin(angle) } };
            });
            const along = oriented.map(face => ((face.x - origins[0].x) * unit.x + (face.y - origins[0].y) * unit.y) / length);
            oriented.forEach((face, index) => {
              const offset = Math.abs((face.x - origins[0].x) * -unit.y + (face.y - origins[0].y) * unit.x);
              if (offset > 2) failures.push(`face ${index} is ${offset.toFixed(1)}px off the callers' line`);
            });
            if (!(along[0] >= 0 && along[0] < along[1] && along[1] <= 1)) failures.push('faces left their own sides of the callers line');
            // Separating-axis test of a rotated face against an upright box.
            const hits = (face, box, margin = 0) => [{ x: 1, y: 0 }, { x: 0, y: 1 }, face.u, face.n].every(axis => {
              const a = face.x * axis.x + face.y * axis.y, ra = face.hw * Math.abs(face.n.x * axis.x + face.n.y * axis.y) + face.hh * Math.abs(face.u.x * axis.x + face.u.y * axis.y);
              const c = middle(box), b = c.x * axis.x + c.y * axis.y, rb = box.width / 2 * Math.abs(axis.x) + box.height / 2 * Math.abs(axis.y);
              return Math.abs(a - b) < ra + rb + margin;
            });
            const inside = (face, point) => Math.abs((point.x - face.x) * face.u.x + (point.y - face.y) * face.u.y) < face.hh
              && Math.abs((point.x - face.x) * face.n.x + (point.y - face.y) * face.n.y) < face.hw;
            // Own hand cards as painted: layout size rotated by the accumulated
            // CSS rotation, checked against the measured bounds.
            const angleOf = node => {
              let angle = 0;
              for (let item = node; item; item = item.parentElement) {
                const style = getComputedStyle(item);
                if (style.transform !== 'none') { const m = new DOMMatrixReadOnly(style.transform); angle += Math.atan2(m.b, m.a); }
                const turn = /(-?[\d.]+)deg\s*$/.exec(style.rotate || '');
                if (turn) angle += Number(turn[1]) * Math.PI / 180;
              }
              return angle;
            };
            const handOutlines = [...document.querySelectorAll('[data-wt-hand-area]:not([hidden]) [data-wt-hand] > *')].filter(shown).map(node => {
              const box = rect(node), angle = angleOf(node), c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
              const scale = box.width / (node.offsetWidth * c + node.offsetHeight * s);
              const upright = { ...middle(box), hw: box.width / 2, hh: box.height / 2, u: { x: 0, y: 1 }, n: { x: 1, y: 0 } };
              if (!(scale > 0) || Math.abs(scale * (node.offsetWidth * s + node.offsetHeight * c) - box.height) > 1.5 + box.height * .02) return upright;
              return { ...middle(box), hw: node.offsetWidth * scale / 2, hh: node.offsetHeight * scale / 2,
                u: { x: Math.sin(angle), y: -Math.cos(angle) }, n: { x: Math.cos(angle), y: Math.sin(angle) } };
            });
            const boxesHit = (a, b, margin = 0) => [a.u, a.n, b.u, b.n].every(axis => {
              const r = box => box.hw * Math.abs(box.n.x * axis.x + box.n.y * axis.y) + box.hh * Math.abs(box.u.x * axis.x + box.u.y * axis.y);
              return Math.abs((b.x - a.x) * axis.x + (b.y - a.y) * axis.y) < r(a) + r(b) + margin;
            });
            for (const [index, face] of oriented.entries()) {
              if (handOutlines.some(card => boxesHit(face, card, -1))) failures.push(`face ${index} covers the painted own hand`);
              // Owner: minimal fan overlap only; never the fan middle, never more
              // than half of its back centres.
              for (const [source, fan] of fans.entries()) if (!seats[source].classList.contains('is-own')
                && (inside(face, rough[source]) || fan.filter(back => inside(face, middle(back))).length > Math.floor(fan.length / 2))) {
                failures.push(`face ${index} hides too much of an opponent fan`);
              }
              for (const obstacle of obstacles) if (!seats.includes(obstacle.closest('[data-wt-seat]')) || !obstacle.matches('.wt-backs > i')) {
                if (hits(face, rect(obstacle), -2)) failures.push(`face ${index} overlaps ${obstacle.className || 'back card'} at seat ${obstacle.closest('[data-wt-seat]')?.dataset.wtSeat || '-'}`);
              }
            }
            // Extent along the line covers faces along it and quarter-turned ones.
            // Up to half overlap keeps each double-headed face's full outer half.
            const reach = face => face.hw * Math.abs(face.n.x * unit.x + face.n.y * unit.y) + face.hh * Math.abs(face.u.x * unit.x + face.u.y * unit.y);
            if ((along[1] - along[0]) * length < (reach(oriented[0]) + reach(oriented[1])) / 2 * 2 * .5 - 1) failures.push('the two faces overlap by more than half');
          }
          for (const [index, caption] of captions.entries()) {
            const box = rect(caption);
            for (const obstacle of obstacles) {
              const callerBack = seats.includes(obstacle.closest('[data-wt-seat]')) && obstacle.matches('.wt-backs > i');
              const point = { x: rect(obstacle).x + rect(obstacle).width / 2, y: rect(obstacle).y + rect(obstacle).height / 2 };
              if (callerBack ? point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom : overlap(box, rect(obstacle))) {
                failures.push(`caption ${index} overlaps ${obstacle.className || 'back card'} at seat ${obstacle.closest('[data-wt-seat]')?.dataset.wtSeat || '-'}`);
              }
            }
          }
          const ack = document.querySelector('[data-watten-action=inspection_ack]'), ackBox = rect(ack);
          if (ackBox.width < 44 || ackBox.height < 44 || ackBox.left < 0 || ackBox.top < 0
            || ackBox.right > innerWidth || ackBox.bottom > innerHeight) failures.push('ACK lacks a complete 44px target');
          if (overlap(ackBox, rect(document.querySelector('[data-wt-panel]')))) failures.push('ACK overlaps Blödeln panel');
          if (!ack.contains(document.elementFromPoint(ackBox.x + ackBox.width / 2, ackBox.y + ackBox.height / 2))) failures.push('ACK is covered');
          return [...new Set(failures)];
        }), { message: `${viewport.width}px inspection keeps readable faces, role labels and ACK clear of the real Blödeln panel and painted hands` }).toEqual([]);
        await caller.page.screenshot({ path: test.info().outputPath(`inspection-${caller.traffic.snapshot.viewer.seat}-${viewport.width}x${viewport.height}.png`) });
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
  const primaryBefore = new Map(await Promise.all(nonCallers.map(async peer => [peer.user.id,
    await peer.page.locator('[data-watten-action=request_bloedeln]').boundingBox()])));
  await requester.page.locator('[data-watten-action=request_bloedeln]').click();
  const all = [...players, ...observers];
  await expect.poll(() => all.every(peer => peer.traffic.snapshot?.engine?.preplay.pending?.kind === 'bloedeln')).toBe(true);
  const pending = requester.traffic.snapshot.engine.preplay.pending;
  const responder = nonCallers.find(peer => peer.traffic.snapshot.viewer.seat === pending.responder);
  expect(pending.requester).toBe(requester.traffic.snapshot.viewer.seat);
  expect(responder).toBeTruthy();
  await expect.poll(async () => {
    const after = await responder.page.locator('[data-watten-action=preplay_accept]').boundingBox();
    const before = primaryBefore.get(responder.user.id);
    return ['x', 'y', 'width', 'height'].every(key => Math.abs(before[key] - after[key]) <= 1);
  }, { message: 'the Blödeln request and its acceptance share one stable right-hand target' }).toBe(true);
  for (const peer of all) {
    const question = peer.page.locator('[data-watten-preplay-pending=bloedeln]');
    await expect(question).toBeVisible();
    if (peer === requester) {
      await expect(question.locator('h3')).toContainText(language === 'de' ? 'Du fragst' : 'You ask');
      await expect(question.locator('h3')).toContainText(responder.user.username);
    } else {
      await expect(question).toContainText(requester.user.username);
      if (peer !== responder) {
        await expect(question).toContainText(responder.user.username);
        await expect(question.locator('h3, button')).toHaveCount(0);
      }
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

test('landscape cutouts: showing and inspection actions remain inside the safe table', async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'Safe-area override uses the Chromium protocol; geometry also runs in WebKit.');
  const players = [], sessions = [];
  const viewport = { width: 852, height: 393 };
  const wrapped = { newContext: options => browser.newContext({ ...options, viewport, serviceWorkers: 'block' }) };
  const setInsets = async insets => {
    for (const session of sessions) await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, ...insets } });
  };
  const expectSafe = async kind => {
    for (const peer of players) {
      const control = peer.page.locator(`[data-watten-action=${kind}]`);
      if (!await control.count()) continue;
      await expectReachable(peer.page, `[data-watten-action=${kind}]`);
      await expect.poll(() => control.evaluate(node => {
        const button = node.getBoundingClientRect(), felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
        return button.left >= felt.left - 1 && button.right <= felt.right + 1
          && button.top >= felt.top - 1 && button.bottom <= felt.bottom + 1;
      }), { message: `${kind} stays clear of the device cutout on either side` }).toBe(true);
    }
  };
  try {
    for (let seat = 0; seat < 4; seat++) {
      const peer = await player(wrapped, baseURL);
      players.push(peer);
      sessions.push(await peer.context.newCDPSession(peer.page));
    }
    await setInsets({ left: 0, right: 44 });
    await create(players, { count: 4, target: 11 });
    await expectSafe('show_ready');
    const nonCallers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('request_bloedeln'));
    for (const peer of nonCallers) {
      await expectReachable(peer.page, '[data-watten-action=request_bloedeln]');
      const clearFooter = await peer.page.locator('[data-wt-preplay]').evaluate(node => {
        const dock = node.getBoundingClientRect(), footer = document.querySelector('.wt-topbar-actions').getBoundingClientRect();
        return dock.bottom <= footer.top;
      });
      expect(clearFooter, 'Blödeln choices leave the safe-area footer clear').toBe(true);
    }
    await request(players, nonCallers, 'de');
    for (const kind of ['preplay_accept', 'preplay_decline']) {
      const responder = players.find(peer => peer.traffic.snapshot.engine.actions.includes(kind));
      await expectReachable(responder.page, `[data-watten-action=${kind}]`);
    }
    await action(players, 'show_ready'); await action(players, 'show_ready');
    await expectSafe('inspection_ack');
    await setInsets({ left: 44, right: 0 });
    await expectSafe('inspection_ack');
    await expectClean(players);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
