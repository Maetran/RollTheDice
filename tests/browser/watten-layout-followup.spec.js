const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const path = require('node:path');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

const VIEWPORTS = [{ width: 320, height: 568 }, { width: 440, height: 956 }, { width: 568, height: 320 },
  { width: 820, height: 1180 }, { width: 1180, height: 820 }];

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
    const bundle = await build({ entryPoints: [path.resolve('frontend/watten/table.js')],
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent' });
    const page = players[0].page;
    await page.evaluate(async ({ code, snapshot, initial }) => {
      const module = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`);
      const root = document.createElement('section'), original = document.querySelector('[data-wt-table]');
      root.dataset.layoutFollowup = 'true';
      root.style.cssText = `position:fixed;inset:${original.getBoundingClientRect().top}px 0 0;z-index:1000`;
      original.remove(); document.body.append(root);
      window.followup = { root, view: module.createTableView(root, { onCard() {} }), snapshot, initial };
    }, { code: bundle.outputFiles[0].text, snapshot, initial });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const scene of ['collect', 'retour', 'bloedeln', 'bloedeln-inspection']) {
        await page.evaluate(scene => {
          const { view, snapshot, initial } = window.followup;
          const copy = structuredClone(snapshot), engine = copy.engine, own = copy.viewer.seat;
          engine.actions = [];
          engine.phase = scene.startsWith('bloedeln') ? 'show_ready' : 'deal_complete';
          engine.current_trick.cards = [];
          engine.hand = scene === 'collect' ? snapshot.engine.hand.slice(0, 1) : structuredClone(initial.engine.hand);
          if (scene === 'collect') {
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
            feedbackDismissed: true, liveMessage: '', roundPresentation: { stage: scene === 'collect' ? 'collect' : 'ready' } });
        }, scene);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (scene === 'collect' && viewport.width < viewport.height) {
          await expect(page.locator('[data-layout-followup] .wt-trick-card').first()).toBeVisible();
          const geometry = await page.evaluate(() => {
            const table = document.querySelector('[data-layout-followup] [data-wt-table]');
            const cards = [...table.querySelectorAll('.wt-trick-card')].map(card => card.getBoundingClientRect());
            const hand = table.querySelector('[data-wt-hand]');
            // Empty cards retain their layout width through a temporary probe;
            // no game face or server state is introduced by this measurement.
            const probe = document.createElement('span'); probe.className = 'wt-hand-card wt-hand-card--back';
            hand.append(probe); const width = parseFloat(getComputedStyle(probe).width); probe.remove();
            const felt = table.querySelector('[data-wt-felt]').getBoundingClientRect();
            return { count: cards.length, bottom: Math.max(...cards.map(card => card.bottom)),
              reserveTop: felt.bottom - width * 1.8 - 20 };
          });
          expect(geometry.count).toBe(4);
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.reserveTop + 1);
        }
        if (scene === 'retour') {
          await expect(page.locator('[data-layout-followup] [data-watten-retourschneider-choice]')).toBeVisible();
          await expect(page.locator('[data-layout-followup] [data-wt-history]')).not.toHaveAttribute('open', '');
          await expect(page.locator('[data-layout-followup] .wt-seat-name').first()).toBeVisible();
          await expect(page.locator('[data-layout-followup] [data-wt-hand] > *').first()).toBeVisible();
          const choices = page.locator('[data-layout-followup] [data-watten-retourschneider-choice] button');
          for (const choice of await choices.all()) {
            await choice.click({ trial: true });
            const target = await choice.boundingBox();
            expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
          }
          await choices.first().focus();
          await page.keyboard.press('Tab'); await expect(choices.last()).toBeFocused();
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
          if (viewport.width > 760) {
            await expect(page.locator('[data-layout-followup] [data-wt-bloedeln]')).toHaveAttribute('data-wt-inspection-positioned', 'true');
            for (const card of await page.locator('[data-layout-followup] [data-wt-bloedeln] .wt-card').all()) await expect(card).toBeVisible();
            const overlap = await page.evaluate(primary => {
              const root = window.followup.root, button = root.querySelector(`[data-watten-action="${primary}"]`).getBoundingClientRect();
              return [...root.querySelectorAll('[data-wt-bloedeln] .wt-card')].some(node => {
                const card = node.getBoundingClientRect();
                return Math.min(card.right, button.right) > Math.max(card.left, button.left)
                  && Math.min(card.bottom, button.bottom) > Math.max(card.top, button.top);
              });
            }, primary);
            expect(overlap).toBe(false);
          }
        }
        await page.screenshot({ path: info.outputPath(`${scene}-${viewport.width}x${viewport.height}.png`) });
      }
    }
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
