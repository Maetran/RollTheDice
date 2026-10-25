const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

const VIEWPORTS = [{ width: 320, height: 568 }, { width: 440, height: 956 }, { width: 568, height: 320 },
  { width: 820, height: 1180 }, { width: 1180, height: 820 }];

async function expectNativeMount(page) {
  const measured = await page.evaluate(() => {
    const { root, nativeRoot, nativeTable } = window.followup;
    const delta = (left, right) => Math.max(...['left', 'top', 'width', 'height'].map(key => Math.abs(left[key] - right[key])));
    const nativeIds = new Set([...nativeRoot.querySelectorAll('[id]')].map(node => node.id));
    return { sameParent: root.parentElement === nativeRoot.parentElement,
      sameMain: root.closest('.wt-main') === nativeRoot.closest('.wt-main'), nativeConnected: nativeTable.isConnected,
      nativeOwnsTable: nativeRoot.querySelector('[data-wt-table]') === nativeTable,
      rootDelta: delta(root.getBoundingClientRect(), nativeRoot.getBoundingClientRect()),
      tableDelta: delta(root.querySelector('[data-wt-table]').getBoundingClientRect(), nativeTable.getBoundingClientRect()),
      sharedIds: [...root.querySelectorAll('[id]')].map(node => node.id).filter(id => nativeIds.has(id)) };
  });
  expect(measured.sameParent).toBe(true); expect(measured.sameMain).toBe(true);
  expect(measured.nativeConnected).toBe(true); expect(measured.nativeOwnsTable).toBe(true);
  expect(measured.rootDelta).toBeLessThanOrEqual(1); expect(measured.tableDelta).toBeLessThanOrEqual(1);
  expect(measured.sharedIds).toEqual([]);
}

async function collectionGeometry(page) {
  return page.evaluate(() => {
    const table = document.querySelector('[data-layout-followup] [data-wt-table]');
    const cards = [...table.querySelectorAll('.wt-trick-card')].map(card => card.getBoundingClientRect());
    const frame = table.querySelector('[data-wt-hand-area]'), area = frame.getBoundingClientRect();
    const slots = [area, ...[...frame.querySelectorAll('[data-wt-hand] > *')].map(card => card.getBoundingClientRect())]
      .filter(rect => rect.width > 0 && rect.height > 0);
    return { phase: table.dataset.phase, stage: table.dataset.roundStage, count: cards.length, bottom: Math.max(...cards.map(card => card.bottom)),
      reserveTop: Math.min(...slots.map(rect => rect.top)), handHeight: area.height,
      hidden: getComputedStyle(frame).visibility === 'hidden', removed: frame.hidden };
  });
}

async function inspectionClearance(page, primary) {
  return page.evaluate(primary => {
    const { root, boxesHit, paintedBox, rectOf } = window.followup;
    const box = node => {
      const bounds = node.getBoundingClientRect(), angle = Number.parseFloat(getComputedStyle(node).rotate) || 0;
      return paintedBox(rectOf(bounds.left, bounds.top, bounds.width, bounds.height),
        { width: node.offsetWidth, height: node.offsetHeight }, angle * Math.PI / 180);
    };
    const backs = [...root.querySelectorAll('[data-wt-bloedeln] .wt-card')];
    const faces = [...root.querySelectorAll('[data-wt-reveal] .wt-card, [data-wt-reveal] figcaption')];
    const button = root.querySelector(`[data-watten-action="${primary}"]`);
    const errors = [];
    for (const back of backs) {
      if (back.offsetWidth < 36 || back.offsetWidth > 48) errors.push('secondary back size');
      for (const target of [...faces, button].filter(Boolean)) {
        if (boxesHit(box(back), box(target))) errors.push(`secondary overlaps ${target.className || target.tagName}`);
      }
      for (const face of faces.filter(node => node.classList.contains('wt-card'))) {
        if (back.offsetWidth >= face.offsetWidth) errors.push('secondary is not smaller than the primary face');
      }
    }
    return [...new Set(errors)];
  }, primary);
}

async function finishInspectionFlights(page) {
  await page.evaluate(async () => {
    const figures = [...window.followup.root.querySelectorAll('.wt-reveal-card')];
    await Promise.allSettled(figures.flatMap(node => node.getAnimations()).map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

for (const language of ['de', 'en']) test(`${language}: queued table geometry keeps collection, showing and Retour on the table`, async ({ browser, baseURL }, info) => {
  test.setTimeout(90_000);
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(browser, baseURL, language));
    await create(players, { count: 4, target: 15, determination: 'normal' });
    await normalCall(players);
    const initial = structuredClone(players[0].traffic.snapshot);
    for (let card = 0; card < 4; card++) await playOne(players);
    const snapshot = structuredClone(players[0].traffic.snapshot);
    expect(snapshot.engine.last_trick.cards).toHaveLength(4);
    const bundle = await build({ stdin: { resolveDir: path.resolve('.'), contents:
      'export { createTableView } from "./frontend/watten/table.js"; export { boxesHit, paintedBox, rectOf } from "./frontend/watten/inspection-geometry.js";' },
      bundle: true, write: false, format: 'iife', globalName: 'WattenLayoutFixture', platform: 'browser', target: 'es2020', logLevel: 'silent',
      plugins: [{ name: 'followup-fixture-id-namespace', setup(builder) {
        // This independent renderer must not reuse the live controller's
        // document-wide SVG/ARIA IDs. Only identifiers differ, never geometry.
        builder.onLoad({ filter: /frontend\/(hausdepp\/cards|watten\/(table|round-options|scorepad))\.js$/ }, async ({ path: file }) => {
          let contents = await readFile(file, 'utf8');
          for (const id of ['wattenTableTitle', 'wattenInspectionTitle', 'wattenPreplayTitle', 'wattenBidTitle', 'wattenFeedbackTitle', 'wattenScorepadTitle']) {
            contents = contents.replaceAll(id, `followup-${id}`);
          }
          contents = contents.replace('`hd-card-paper-${++artSequence}`', '`followup-card-paper-${++artSequence}`');
          return { contents, loader: 'js' };
        });
      } }] });
    const page = players[0].page;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // A synchronous IIFE has no transient dynamic-import Promise to be
    // collected while the fixture constructor has already changed the DOM.
    await page.evaluate(bundle.outputFiles[0].text);
    const mounted = await page.evaluate(({ snapshot, initial }) => {
      const module = window.WattenLayoutFixture;
      const nativeTable = document.querySelector('[data-wt-table]'), nativeRoot = nativeTable.parentElement;
      if (!nativeRoot.closest('.wt-main')) throw new Error('Missing native table mount');
      const before = nativeRoot.getBoundingClientRect();
      const root = document.createElement(nativeRoot.tagName);
      root.className = nativeRoot.className;
      root.dataset.layoutFollowup = 'true';
      // Both .wt-view mounts occupy the real second main-grid row. They follow
      // the native header/landscape rail on rotation; no body/fixed inset exists.
      // Preserve the live controller's original target so later snapshots cannot
      // overwrite the display fixture's phase through container.querySelector.
      nativeRoot.style.gridArea = root.style.gridArea = '2 / 1';
      nativeRoot.style.visibility = 'hidden'; nativeRoot.inert = true;
      nativeRoot.setAttribute('aria-hidden', 'true');
      nativeRoot.after(root);
      window.followup = { root, nativeRoot, nativeTable, view: module.createTableView(root, { onCard() {} }), snapshot, initial,
        boxesHit: module.boxesHit, paintedBox: module.paintedBox, rectOf: module.rectOf, revision: 0 };
      const after = root.getBoundingClientRect();
      return { initialDelta: Math.max(...['left', 'top', 'width', 'height'].map(key => Math.abs(before[key] - after[key]))) };
    }, { snapshot, initial });
    expect(mounted.initialDelta).toBeLessThanOrEqual(1);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const scene of ['collect', 'collect-empty', 'retour', 'bloedeln', 'bloedeln-inspection']) {
        await page.evaluate(scene => {
          const { view, snapshot, initial } = window.followup;
          // These are explicitly display fixtures. Preplay starts with the
          // untouched five-card state, never already captured packets.
          const copy = structuredClone(scene.startsWith('bloedeln') ? initial : snapshot), engine = copy.engine, own = copy.viewer.seat;
          engine.deal_revision = ++window.followup.revision;
          engine.actions = [];
          engine.phase = scene.startsWith('bloedeln') ? 'show_ready' : 'deal_complete';
          engine.current_trick.cards = [];
          engine.hand = scene === 'collect-empty' ? [] : scene === 'collect' ? snapshot.engine.hand.slice(0, 1) : structuredClone(initial.engine.hand);
          if (scene.startsWith('collect')) {
            // Legal end-of-deal public shape from the owner screenshot:
            // four tricks played, the own side wins 3:1, one card remains.
            engine.seats.forEach(seat => { seat.tricks_won = seat.seat === own ? 2
              : [((own + 1) % 4), ((own + 2) % 4)].includes(seat.seat) ? 1 : 0; });
            engine.last_trick.winner = own;
          }
          engine.retourschneider = scene === 'retour' ? { status: 'available', after_deal_id: engine.deal_id,
            members: [copy.room.seats[own].participant_id, copy.room.seats[(own + 2) % 4].participant_id], accepted_by: [] } : null;
          let actions = scene === 'retour' ? ['retourschneider'] : [];
          if (scene.startsWith('bloedeln')) {
            engine.last_trick = null; engine.trick_history = [];
            engine.dealer_seat = own;
            engine.announcement_roles = { strike: own, colour: (own + 1) % 4 };
            engine.preplay = { ...engine.preplay, pending: null, bloedeln_status: 'accepted' };
            actions = ['show_ready'];
            if (scene === 'bloedeln-inspection') {
              engine.phase = 'inspection'; actions = ['inspection_ack'];
              engine.inspection = { cards: snapshot.engine.last_trick.cards.slice(0, 2).map((item, index) => ({
                card: item.card, role: index ? 'colour' : 'strike' })) };
            }
          }
          view.update({ snapshot: copy, engine, room: copy.room, count: 4, viewerSeat: own, anchorSeat: own,
            playerId: copy.viewer.participant_id, spectator: false, actions, busy: false, paused: false,
            awaited: [], canResume: false, canLeave: true, bubbles: [], freshTrickEnd: false,
            feedbackDismissed: true, liveMessage: '', roundPresentation: { stage: scene.startsWith('collect') ? 'collect' : 'ready' } });
        }, scene);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expectNativeMount(page);
        if (scene.startsWith('collect')) {
          await expect(page.locator('[data-layout-followup] .wt-trick-card').first()).toBeVisible();
          const geometry = await collectionGeometry(page);
          expect(geometry.count).toBe(4); expect(geometry.phase).toBe('deal_complete'); expect(geometry.stage).toBe('collect');
          expect(geometry.hidden).toBe(true); expect(geometry.removed).toBe(false); expect(geometry.handHeight).toBeGreaterThan(0);
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.reserveTop + 1);
          const rotated = { width: viewport.height, height: viewport.width };
          await page.setViewportSize(rotated);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await expectNativeMount(page);
          const afterRotation = await collectionGeometry(page);
          expect(afterRotation.phase).toBe('deal_complete'); expect(afterRotation.stage).toBe('collect');
          expect(afterRotation.hidden).toBe(true); expect(afterRotation.removed).toBe(false); expect(afterRotation.handHeight).toBeGreaterThan(0);
          expect(afterRotation.bottom).toBeLessThanOrEqual(afterRotation.reserveTop + 1);
          await page.screenshot({ path: info.outputPath(`${scene}-rotated-${rotated.width}x${rotated.height}.png`) });
          await page.setViewportSize(viewport);
        }
        if (scene === 'retour') {
          await expect(page.locator('[data-layout-followup] [data-watten-retourschneider-choice]')).toBeVisible();
          await expect(page.locator('[data-layout-followup] [data-wt-history]')).not.toHaveAttribute('open', '');
          for (const name of await page.locator('[data-layout-followup] .wt-seat-name').all()) await expect(name).toBeVisible();
          await expect(page.locator('[data-layout-followup] [data-wt-hand] > *').first()).toBeVisible();
          const choices = page.locator('[data-layout-followup] [data-watten-retourschneider-choice] button');
          for (const choice of await choices.all()) {
            await choice.click({ trial: true });
            const target = await choice.boundingBox();
            expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
          }
          await choices.first().focus();
          await page.keyboard.press('Tab'); await expect(choices.last()).toBeFocused();
          if (viewport.width <= 350 && viewport.width < viewport.height) {
            await expect(page.locator('[data-layout-followup] [data-wt-panel]')).toHaveAttribute('data-wt-retour-fit', 'clear');
            const errors = await page.evaluate(() => {
              const root = window.followup.root, panel = root.querySelector('[data-wt-panel]'), area = panel.getBoundingClientRect();
              const overlaps = [...root.querySelectorAll('.wt-seat-name, .wt-seat-badge, .wt-seat-call-role, .wt-backs > i:not([hidden]), [data-wt-hand-area], [data-wt-hand] > *')]
                .filter(node => getComputedStyle(node).visibility !== 'hidden').filter(node => {
                  const rect = node.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0 && Math.min(rect.right, area.right) > Math.max(rect.left, area.left)
                    && Math.min(rect.bottom, area.bottom) > Math.max(rect.top, area.top);
                }).map(node => node.className);
              const title = panel.querySelector('.wt-retour > h3'), text = title.firstChild;
              const index = text.textContent.indexOf('Retourschneider'), range = document.createRange();
              range.setStart(text, index); range.setEnd(text, index + 'Retourschneider'.length);
              if (range.getClientRects().length !== 1) overlaps.push('broken Retourschneider word');
              if (panel.scrollWidth > panel.clientWidth + 1) overlaps.push('horizontal overflow');
              return overlaps;
            });
            expect(errors).toEqual([]);
            const rules = page.locator('[data-layout-followup] .wt-retour-rules');
            await rules.focus(); await expect(rules).toBeFocused();
            const scrollable = await rules.evaluate(node => node.scrollHeight > node.clientHeight + 1);
            if (scrollable) {
              await page.keyboard.press('End');
              expect(await rules.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
              await page.keyboard.press('Home');
            }
          }
        }
        if (scene.startsWith('bloedeln')) {
          await expect(page.locator('[data-layout-followup] [data-watten-bloedeln-status]')).toHaveCount(0);
          await expect(page.locator('[data-layout-followup] [data-wt-bloedeln] .wt-card--back')).toHaveCount(2);
          await expect(page.locator('[data-layout-followup] [data-wt-bloedeln] [data-card]')).toHaveCount(0);
          const primary = scene === 'bloedeln' ? 'show_ready' : 'inspection_ack';
          await expect(page.locator(`[data-layout-followup] [data-watten-action="${primary}"]`)).toBeVisible();
          if (scene === 'bloedeln-inspection') {
            await expect(page.locator('[data-layout-followup] [data-wt-reveal]')).toHaveAttribute('data-wt-inspection-positioned', 'true');
            for (const card of await page.locator('[data-layout-followup] [data-wt-reveal] .wt-card').all()) await expect(card).toBeVisible();
          }
          {
            await expect(page.locator('[data-layout-followup] [data-wt-bloedeln]')).toHaveAttribute('data-wt-inspection-positioned', 'true');
            for (const card of await page.locator('[data-layout-followup] [data-wt-bloedeln] .wt-card').all()) await expect(card).toBeVisible();
            const flying = await page.evaluate(() => [...window.followup.root.querySelectorAll('.wt-reveal-card')]
              .flatMap(node => node.getAnimations()).filter(animation => animation.playState === 'running').length);
            expect(flying).toBeGreaterThan(0);
            expect(await inspectionClearance(page, primary)).toEqual([]);
            await page.screenshot({ path: info.outputPath(`${scene}-in-flight-${viewport.width}x${viewport.height}.png`) });
            await finishInspectionFlights(page);
            expect(await inspectionClearance(page, primary)).toEqual([]);
            if (scene === 'bloedeln-inspection') {
              await page.setViewportSize({ width: viewport.height, height: viewport.width });
              await finishInspectionFlights(page);
              await expectNativeMount(page);
              expect(await inspectionClearance(page, primary)).toEqual([]);
              await page.screenshot({ path: info.outputPath(`${scene}-rotated-${viewport.height}x${viewport.width}.png`) });
              await page.setViewportSize(viewport); await finishInspectionFlights(page);
              expect(await inspectionClearance(page, primary)).toEqual([]);
            }
          }
        }
        await page.screenshot({ path: info.outputPath(`${scene}-${viewport.width}x${viewport.height}.png`) });
      }
    }
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
