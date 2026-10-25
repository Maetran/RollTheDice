const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const path = require('node:path');
const { readFile, writeFile } = require('node:fs/promises');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

const TABLETS = [{ width: 1024, height: 1366 }, { width: 1366, height: 1024 },
  { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1440, height: 900 }, { width: 768, height: 1024 },
  { width: 1024, height: 768 }, { width: 1280, height: 800 }];

async function settleViewport(page, viewport) {
  await page.setViewportSize(viewport);
  // The game's viewport bridge can settle after Playwright's resize promise.
  // Do not sample an absolute felt and a fixed action from different frames.
  await expect.poll(() => page.evaluate(() => Math.abs(
    document.querySelector('[data-wt-felt]').getBoundingClientRect().bottom - innerHeight))).toBeLessThan(1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('tablet layout fixtures: shared axes, long identities, 1–4 packets and passive/active Blödeln', async ({ browser, baseURL }, info) => {
  test.setTimeout(90_000);
  const players = [];
  try {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: TABLETS[0], deviceScaleFactor: 2, serviceWorkers: 'block' }) };
    for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL));
    await create(players, { count: 4, target: 15, determination: 'normal' });
    await normalCall(players);
    const fullOwnHand = structuredClone(players[0].traffic.snapshot.engine.hand);
    for (let card = 0; card < 4; card++) await playOne(players);
    await expect.poll(() => players[0].traffic.snapshot.engine.last_trick?.cards.length).toBe(4);
    const snapshot = structuredClone(players[0].traffic.snapshot);
    // Retain the genuine, previously delivered full own hand for maximum width.
    snapshot.engine.hand = fullOwnHand;
    const bundle = await build({ entryPoints: [path.resolve('frontend/watten/table.js')],
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent',
      plugins: [{ name: 'fixture-svg-namespace', setup(build) {
        // A separately bundled renderer owns a separate SVG counter. Only its
        // clip namespace/visibility differ: re-rendered hidden SVG defs need an
        // explicit paint state in this synthetic lifecycle. Geometry/card values
        // remain real; this is not a product-artwork regression claim.
        build.onLoad({ filter: /frontend\/hausdepp\/cards\.js$/ }, async ({ path: source }) => ({
          contents: (await readFile(source, 'utf8')).replace('`hd-card-paper-${++artSequence}`',
            '`tablet-fixture-card-paper-${++artSequence}`')
            .replace('<clipPath id=', '<clipPath visibility="visible" id=')
            .replace('<image decoding=', '<image visibility="visible" decoding='), loader: 'js' }));
      } }] });
    const page = players[0].page;
    await page.evaluate(async ({ code, snapshot }) => {
      const module = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`);
      const root = document.createElement('section');
      root.dataset.tabletFixture = 'true';
      const original = document.querySelector('[data-wt-table]');
      root.style.cssText = `position:fixed;inset:${original.getBoundingClientRect().top}px 0 0;z-index:1000`;
      // A separately bundled renderer has its own SVG ID counter. Remove the
      // original table to keep its clip IDs from colliding with this fixture.
      original.remove();
      document.body.append(root);
      const view = module.createTableView(root, { onCard() {} });
      window.tabletLayoutFixture = { root, view, snapshot };
    }, { code: bundle.outputFiles[0].text, snapshot });
    const report = [];
    for (const viewport of TABLETS) {
      await settleViewport(page, viewport);
      for (const count of [1, 2, 3, 4]) for (const kind of count === 4
        ? ['trick', ...(viewport.width > viewport.height && [1024, 1280].includes(viewport.width)
          ? Array.from({ length: 5 }, (_, cards) => `trick-${cards}cards`) : []),
        'passive', 'active', 'active-inspection', 'accepted', 'thanks-role', 'thanks-no-role'] : ['passive']) {
        await page.evaluate(({ count, kind }) => {
          const { view, snapshot } = window.tabletLayoutFixture;
          // DISPLAY FIXTURES, not engine states: public packet counts include
          // four as deliberate stress, even if the real deal ends sooner.
          // Start from a real personal DTO; never read the server's hidden hands.
          const copy = structuredClone(snapshot), engine = copy.engine;
          const observedTrick = structuredClone(engine.last_trick);
          const own = engine.viewer.seat;
          const fanCards = /^trick-(\d)cards$/.exec(kind);
          const opponentCardCount = fanCards ? Number(fanCards[1]) : 5;
          const title = copy.room.seats.find(seat => seat.public_title)?.public_title;
          if (!title) throw new Error('The real DTO must supply a public title');
          for (const seat of copy.room.seats) {
            seat.name = `LangerSpielernameNummer${seat.seat ?? copy.room.seats.indexOf(seat)}`;
            seat.public_title = structuredClone(title);
          }
          copy.room.seats[1].public_title = count % 2 ? null : structuredClone(title);
          engine.phase = 'show_ready'; engine.current_trick = { ...engine.current_trick, cards: [] };
          engine.last_trick = null; engine.trick_history = [];
          engine.announcement_roles = { ...engine.announcement_roles, strike: 1, colour: own };
          engine.seats.forEach(seat => { seat.tricks_won = count; seat.card_count = opponentCardCount; });
          const active = kind.startsWith('active');
          const responder = active ? own : 3;
          engine.preplay = { ...engine.preplay, pending: kind === 'accepted' ? null
            : { kind: 'bloedeln', requester: 1, responder }, bloedeln_status: kind === 'accepted' ? 'accepted' : 'pending' };
          let actions = active ? ['preplay_accept', 'preplay_decline'] : ['show_ready'];
          if (kind.startsWith('trick')) {
            engine.phase = 'play'; engine.last_trick = observedTrick;
            engine.preplay.pending = null; actions = [];
          }
          if (kind.startsWith('thanks-')) {
            engine.preplay.pending = null;
            engine.transcript = engine.seats.map(seat => ({ kind: 'watten_thanks', seat: seat.seat }));
            engine.announcement_roles = { ...engine.announcement_roles,
              strike: kind === 'thanks-role' ? 2 : null, colour: kind === 'thanks-role' ? own : null };
          }
          if (kind === 'active-inspection') {
            engine.phase = 'inspection';
            engine.inspection = { cards: observedTrick.cards.slice(0, 2).map((item, index) => ({
              card: item.card, role: index ? 'colour' : 'strike' })) };
            actions.push('inspection_ack');
          }
          const vm = { snapshot: copy, engine, room: copy.room, count: 4, viewerSeat: own,
            anchorSeat: own, playerId: copy.viewer.participant_id, spectator: false,
            actions, busy: false, paused: false, awaited: [], canResume: false,
            isHost: true, canLeave: true, bubbles: [], freshTrickEnd: false,
            feedbackDismissed: true, liveMessage: '' };
          window.tabletLayoutFixture.opponentCardCount = opponentCardCount;
          view.update(vm);
        }, { count, kind });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (kind === 'active-inspection') {
          await expect.poll(() => page.locator('[data-tablet-fixture] .wt-inspection .wt-card').evaluateAll(nodes =>
            nodes.filter(node => getComputedStyle(node).visibility === 'visible').length)).toBe(2);
          await page.evaluate(async () => {
            const urls = [...new Set([...document.querySelectorAll('[data-tablet-fixture] .wt-inspection image')]
              .map(node => node.getAttribute('href')))];
            await Promise.all(urls.map(url => { const image = new Image(); image.src = url; return image.decode(); }));
          });
        }
        const measured = await page.evaluate(() => {
          const root = window.tabletLayoutFixture.root;
          const box = node => node?.getBoundingClientRect();
          const visible = node => !node.closest('[hidden]') && box(node).width > 0 && box(node).height > 0
            && getComputedStyle(node).visibility !== 'hidden';
          const union = selector => {
            const boxes = [...root.querySelectorAll(selector)].filter(visible).map(box);
            if (!boxes.length) return null;
            const left = Math.min(...boxes.map(b => b.left)), top = Math.min(...boxes.map(b => b.top));
            const right = Math.max(...boxes.map(b => b.right)), bottom = Math.max(...boxes.map(b => b.bottom));
            return { left, top, right, bottom, x: (left + right) / 2, y: (top + bottom) / 2 };
          };
          const errors = [], felt = box(root.querySelector('[data-wt-felt]'));
          const fan = position => union(`.wt-seat--${position} .wt-backs > i:not([hidden])`);
          const top = fan('top'), left = fan('left'), right = fan('right');
          const trick = box(root.querySelector('[data-wt-trick]'));
          const table = box(root.querySelector('[data-wt-table]'));
          if (Math.abs(felt.top - table.top - 58) > 1) errors.push('felt/table topbar contract changed');
          if (top && Math.abs(top.x - felt.left - felt.width / 2) > 1) errors.push('top fan off axis');
          if (left && right && Math.abs(left.y - right.y) > 1) errors.push('side fans at different heights');
          if (left && Math.abs(left.y - trick.top - trick.height / 2) > 1) errors.push('side fan and trick axes differ');
          const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          const obstacles = [...root.querySelectorAll('.wt-backs > i:not([hidden]), [data-wt-hand] > *, .wt-seat-badge, .wt-taken i, .wt-inspection .wt-card')]
            .filter(visible).map(box);
          const controls = [...root.querySelectorAll('.wt-bloedeln-status, .wt-preplay-pending, .wt-bloedeln-start')].filter(visible);
          for (const control of controls) {
            const bounds = box(control);
            if (obstacles.some(other => overlaps(bounds, other))) errors.push(`${control.className} overlaps a hand, identity or packet`);
            if (bounds.left < 0 || bounds.right > innerWidth || bounds.top < felt.top || bounds.bottom > innerHeight) errors.push('Blödeln leaves viewport');
          }
          let activeButtons = 0;
          for (const button of root.querySelectorAll('.wt-bloedeln-dock button')) if (visible(button)) {
            activeButtons++;
            const bounds = box(button);
            if (bounds.width < 44 || bounds.height < 44) errors.push('Blödeln target below 44px');
            if (!button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))) errors.push('Blödeln target is covered');
          }
          const packets = [...root.querySelectorAll('.wt-taken i')].filter(visible);
          for (const packet of packets) {
            const bounds = box(packet);
            if (bounds.left < -1 || bounds.right > innerWidth + 1 || bounds.top < felt.top - 1 || bounds.bottom > innerHeight + 1) errors.push('captured packet leaves felt');
            if (packets.some(other => other.closest('[data-wt-seat]') !== packet.closest('[data-wt-seat]')
              && overlaps(bounds, box(other)))) errors.push('captured packets from different players overlap');
          }
          const own = box(root.querySelector('.wt-seat--bottom.is-own .wt-seat-badge'));
          const show = box(root.querySelector('[data-watten-action="show_ready"]'));
          if (innerWidth < innerHeight && show && Math.abs(own.bottom - show.bottom) > 1) errors.push('own row has different baselines');
          const ownHand = [...root.querySelectorAll('[data-wt-hand] > *')].filter(visible).map(box);
          const played = [...root.querySelectorAll('.wt-trick-card, .wt-trick-label')].filter(visible);
          const badges = [...root.querySelectorAll('.wt-seat-badge')].filter(visible);
          const opponentCards = [...root.querySelectorAll('.wt-backs > i:not([hidden])')].filter(visible);
          if (opponentCards.length !== window.tabletLayoutFixture.opponentCardCount * 3) errors.push('opponent fan card count changed');
          for (const card of played.filter(node => node.matches('.wt-trick-card'))) {
            if (opponentCards.some(back => overlaps(box(card), box(back)))) errors.push('played card overlaps an opponent fan');
          }
          for (const packet of packets) if (badges.some(badge => overlaps(box(packet), box(badge)))) errors.push('captured packet overlaps an identity');
          for (const packet of packets) if (played.filter(node => node.matches('.wt-trick-card'))
            .some(card => overlaps(box(packet), box(card)))) errors.push('captured packet overlaps a trick card');
          const caption = root.querySelector('.wt-trick-label');
          if (visible(caption) && caption.textContent.trim() && [...root.querySelectorAll('.wt-trick-card')]
            .filter(visible).some(card => overlaps(box(caption), box(card)))) errors.push('winner caption overlaps a trick card');
          for (const node of played) if (node.textContent.trim() || node.matches('.wt-trick-card')) {
            if ([own, ...ownHand].some(other => overlaps(box(node), other))) errors.push(`${node.className} overlaps own identity or hand`);
          }
          for (const bubble of [...root.querySelectorAll('.wt-bubble--thanks')].filter(visible)) {
            const badge = bubble.closest('.wt-seat-badge');
            if ([...badge.querySelectorAll('.wt-seat-name, .wt-seat-call-role, .wt-seat-public-title, .wt-seat-tags')]
              .filter(visible).some(other => overlaps(box(bubble), box(other)))) errors.push('Thanks covers identity metadata');
          }
          return { errors: [...new Set(errors)], top, left, right, own: own.toJSON(), activeButtons,
            inspectionFaces: [...root.querySelectorAll('[data-wt-reveal] .wt-inspection .wt-card')].map(node => ({
              card: node.dataset.card, image: node.querySelector('image')?.getAttribute('href'),
              clipId: node.querySelector('clipPath')?.id,
              clipDuplicates: document.querySelectorAll(`[id="${node.querySelector('clipPath')?.id}"]`).length,
              clipVisibility: getComputedStyle(node.querySelector('clipPath')).visibility,
              imageVisibility: getComputedStyle(node.querySelector('image')).visibility,
              visible: visible(node), bounds: box(node).toJSON(), svg: node.querySelector('svg')?.getBoundingClientRect().toJSON(),
              width: getComputedStyle(node).width, height: getComputedStyle(node).height, opacity: getComputedStyle(node).opacity, visibility: getComputedStyle(node).visibility,
              hiddenAncestor: node.closest('[hidden]')?.className, inlineStyle: node.getAttribute('style'),
              revealPositioned: node.closest('.wt-reveal').dataset.wtInspectionPositioned })),
            trickWidth: trick.width / 2.9,
            handWidth: getComputedStyle(root.querySelector('[data-wt-hand] > *')).width,
            backWidth: getComputedStyle(root.querySelector('.wt-backs > i')).width,
            opponentCards: opponentCards.map(node => ({ seat: node.closest('[data-wt-seat]').dataset.wtSeat, bounds: box(node).toJSON() })),
            played: played.map(node => ({ className: node.className, bounds: box(node).toJSON() })),
            badges: badges.map(node => ({ seat: node.closest('[data-wt-seat]').dataset.wtSeat, bounds: box(node).toJSON() })),
            packets: packets.map(node => ({ seat: node.closest('[data-wt-seat]').dataset.wtSeat, bounds: box(node).toJSON() })),
            controls: controls.map(node => ({ className: node.className, bounds: box(node).toJSON() })) };
        });
        report.push({ viewport, count, kind, ...measured });
        if (['passive', 'active', 'active-inspection'].includes(kind) && !measured.controls.length) measured.errors.push('forced Blödeln state is missing');
        if (kind === 'accepted') {
          await expect(page.locator('[data-tablet-fixture] [data-wt-bloedeln] .wt-card--back')).toHaveCount(2);
          await expect(page.locator('[data-tablet-fixture] [data-wt-bloedeln] [data-card]')).toHaveCount(0);
          await expect(page.locator('[data-tablet-fixture] [data-watten-bloedeln-status]')).toHaveCount(0);
        }
        if (kind === 'active-inspection' && measured.inspectionFaces.filter(face => face.visible && face.bounds.width >= 44 && face.bounds.height >= 44).length !== 2) measured.errors.push('two painted inspection faces are missing');
        if (kind.startsWith('active') && measured.activeButtons !== 2) measured.errors.push('forced active Blödeln answer pair is missing');
        if (count === 4 || viewport.width === 1366) await page.screenshot({
          path: info.outputPath(`LAYOUT-fixture-${kind}-${count}packets-${viewport.width}x${viewport.height}.png`), scale: 'css' });
      }
    }
    await writeFile(info.outputPath('layout-fixtures.json'), JSON.stringify(report, null, 2));
    expect(report.filter(scene => scene.errors.length).map(scene => ({ viewport: scene.viewport,
      count: scene.count, kind: scene.kind, errors: scene.errors }))).toEqual([]);
    await page.evaluate(() => { const f = window.tabletLayoutFixture; f.view.destroy(); f.root.remove(); delete window.tabletLayoutFixture; });
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});

test('tablet layout leaves two/three-seat tables and compact phone geometry outside its scope', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  for (const count of [2, 3, 4]) {
    const players = [];
    try {
      for (let seat = 0; seat < count; seat++) players.push(await player(browser, baseURL));
      await create(players, { count, target: 15, determination: 'normal' });
      const viewports = count === 4
        ? [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]
        : [TABLETS[0], TABLETS[1]];
      for (const viewport of viewports) {
        await settleViewport(players[0].page, viewport);
        const legacy = await players[0].page.evaluate(() => {
          const table = document.querySelector('[data-wt-table]'), felt = document.querySelector('[data-wt-felt]');
          const own = document.querySelector('.wt-seat--bottom.is-own');
          return { tabletAnchor: getComputedStyle(table).getPropertyValue('--wt-play-ratio').trim(),
            ownLeft: own.getBoundingClientRect().left - felt.getBoundingClientRect().left,
            ownBottom: felt.getBoundingClientRect().bottom - own.getBoundingClientRect().bottom,
            feltWidth: felt.getBoundingClientRect().width, feltHeight: felt.getBoundingClientRect().height };
        });
        expect(legacy.tabletAnchor, `${count} seats ${viewport.width}x${viewport.height}`).toBe('');
        if (count < 4) {
          // Existing >=761px layout contract: own badge left4%, bottom7%.
          expect(Math.abs(legacy.ownLeft - legacy.feltWidth * .04)).toBeLessThan(1);
          expect(Math.abs(legacy.ownBottom - legacy.feltHeight * .07)).toBeLessThan(1);
        }
      }
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  }
});
