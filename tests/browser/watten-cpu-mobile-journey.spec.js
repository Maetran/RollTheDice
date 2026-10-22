const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { player, create, action, answerPartnerFeedback } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(180_000);

for (const viewport of [{ width: 440, height: 956 }, { width: 956, height: 440 }]) {
  test(`CPU journey ${viewport.width}x${viewport.height}: two real deals keep later captured piles and animated tricks clear`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options, viewport, serviceWorkers: 'block' }) };
    const host = await player(wrapped, baseURL);
    try {
      await host.page.emulateMedia({ reducedMotion: 'no-preference' });
      await create([host], { count: 4, determination: 'normal', target: 21, cpuFill: true });
      await host.page.evaluate(() => {
        const report = window.wattenMobileJourney = { samples: 0, errors: [], maxPackets: 0, winners: [], piles: [] };
        const add = message => { if (!report.errors.includes(message)) report.errors.push(message); };
        const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        report.timer = setInterval(() => {
          report.maxPackets = Math.max(report.maxPackets, ...[...document.querySelectorAll('.wt-taken[data-count]')].map(node => Number(node.dataset.count)));
          const felt = document.querySelector('[data-wt-felt]')?.getBoundingClientRect();
          if (!felt) return;
          for (const group of document.querySelectorAll('[data-wt-motion="collect"]')) {
            const animation = group.getAnimations()[0];
            const time = animation?.currentTime;
            const delay = animation?.effect.getTiming().delay || 0;
            const activeTime = typeof time === 'number' ? time - delay : null;
            // Measure the real three-second resting presentation, after the
            // final card lands and before the packet travels to its winner.
            if (activeTime === null || activeTime < 300 || activeTime > 3100 || getComputedStyle(group).opacity === '0') continue;
            const cards = [...group.children];
            if (cards.length !== 4) continue;
            report.samples++;
            const keys = cards.map(card => card.dataset.key);
            if (!report.piles.some(pile => JSON.stringify(pile) === JSON.stringify(keys))) report.piles.push(keys);
            const faces = cards.map(card => card.getBoundingClientRect());
            const connected = new Set([0]);
            for (let pass = 0; pass < faces.length; pass++) for (const [index, face] of faces.entries()) {
              if ([...connected].some(other => overlaps(face, faces[other]))) connected.add(index);
            }
            if (connected.size !== cards.length) add('resting cards do not form one connected pile');
            if (innerWidth > innerHeight) for (let index = 1; index < faces.length; index++) {
              if (Math.abs(faces[index].left - faces[index - 1].left - faces[index].width * .6) > 1
                || Math.abs(faces[index].top - faces[index - 1].top) > 1) add('resting cards lost their chronological landscape slots');
            }
            const bounds = group.getBoundingClientRect();
            if (Math.abs(bounds.x + bounds.width / 2 - felt.x - felt.width / 2) > 12) add('completed trick moved away from the table centre');
            const labels = cards.map(card => card.querySelector('.wt-card-owner'));
            for (const [index, label] of labels.entries()) {
              if (!label?.textContent.trim()) { add('public card lost its owner'); continue; }
              const box = label.getBoundingClientRect();
              if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) add('public owner label left the viewport');
              if (labels.slice(index + 1).some(other => overlaps(box, other.getBoundingClientRect()))) {
                add('public owner labels overlap');
                report.labelOverlap ??= { time, delay: animation.effect.getTiming().delay,
                  arrivals: group.getAnimations({ subtree: true }).slice(1).map(flight => ({ time: flight.currentTime, timing: flight.effect.getTiming() })),
                  cards: cards.map(card => {
                  const owner = card.querySelector('.wt-card-owner');
                  return { card: card.dataset.key, name: owner?.textContent,
                    cardBounds: card.getBoundingClientRect().toJSON(), ownerBounds: owner?.getBoundingClientRect().toJSON(),
                    ownerWidth: getComputedStyle(owner).width, order: getComputedStyle(card).zIndex };
                }) };
              }
            }
            const winner = cards.find(card => card.classList.contains('is-winning-card'));
            if (!winner || getComputedStyle(winner).outlineStyle !== 'solid') add('completed trick lost its winner highlight');
            if (!report.winners.includes(group.dataset.targetSeat)) report.winners.push(group.dataset.targetSeat);
          }
        }, 80);
      });
      const completed = new Set(), tricks = new Set(), acceptedPiles = new Set();
      const progress = new Set(['announce_strike', 'announce_colour', 'play_card', 'respond_hold', 'preplay_decline', 'partner_feedback']);
      for (let turn = 0; turn < 100 && completed.size < 2; turn++) {
        await expect.poll(() => {
          const engine = host.traffic.snapshot?.engine;
          return engine && (engine.actions.some(kind => progress.has(kind)) || ['deal_complete', 'match_complete'].includes(engine.phase));
        }, { timeout: 20_000 }).toBeTruthy();
        const engine = host.traffic.snapshot.engine;
        for (const [index, trick] of (engine.trick_history || []).entries()) {
          tricks.add(`${engine.deal_id}:${index}`);
          acceptedPiles.add(JSON.stringify(trick.cards.map(item => item.card)));
        }
        if (['deal_complete', 'match_complete'].includes(engine.phase)) {
          completed.add(engine.deal_id);
          // Take the review image after the final card has landed, including
          // any queued collection delay, rather than halfway through its flight.
          await expect.poll(() => host.page.locator('[data-wt-motion="collect"]').evaluateAll(groups => groups.some(group => {
            const animation = group.getAnimations()[0];
            const active = animation.currentTime - animation.effect.getTiming().delay;
            return active >= 300 && active <= 3100;
          }))).toBe(true);
          await host.page.screenshot({ path: info.outputPath(`cpu-deal-${completed.size}-${viewport.width}x${viewport.height}.png`) });
          if (completed.size === 2 || engine.phase === 'match_complete') break;
          if (engine.retourschneider?.status === 'available' && engine.actions.includes('retourschneider')) {
            await action([host], 'retourschneider', 'decline');
          }
          await expect.poll(() => host.traffic.snapshot.engine.deal_id, { timeout: 20_000 }).not.toBe(engine.deal_id);
          continue;
        }
        if (engine.actions.includes('partner_feedback')) { await answerPartnerFeedback([host]); continue; }
        if (engine.actions.includes('preplay_decline')) { await action([host], 'preplay_decline'); continue; }
        if (engine.actions.includes('announce_strike')) { await action([host], 'announce_strike', '7'); continue; }
        if (engine.actions.includes('announce_colour')) { await action([host], 'announce_colour', 'bells'); continue; }
        if (engine.actions.includes('respond_hold')) { await action([host], 'respond_hold', 'hold'); continue; }
        expect(engine.actions).toContain('play_card');
        const { strike, suit } = host.traffic.call;
        expect(strike).toBeTruthy(); expect(suit).toBeTruthy();
        const cards = engine.hand.map(item => item.card);
        const isStrike = card => strike === 'weli' ? card === 'bells-6' : card.endsWith(`-${strike}`);
        const isTrump = card => card === 'bells-6' || card.startsWith(`${suit}-`);
        const lead = engine.current_trick.cards[0]?.card;
        const ordinaryTrump = cards.find(card => isTrump(card) && !isStrike(card));
        const card = lead && isTrump(lead) && ordinaryTrump ? ordinaryTrump : cards[0];
        const selector = `[data-wt-hand] button[data-card="${card}"]`;
        await expectReachable(host.page, selector);
        const before = engine.opportunity;
        await host.page.locator(selector).click();
        await expect.poll(() => host.traffic.snapshot.engine.opportunity).not.toBe(before);
      }
      const report = await host.page.evaluate(() => {
        const report = window.wattenMobileJourney; clearInterval(report.timer); delete report.timer; return report;
      });
      const reportPath = info.outputPath('real-cpu-journey.json');
      await writeFile(reportPath, JSON.stringify({ completedDeals: completed.size, completedTricks: tricks.size, ...report }, null, 2));
      await info.attach('real-cpu-journey', { path: reportPath, contentType: 'application/json' });
      expect(completed.size).toBe(2);
      expect(report.samples).toBeGreaterThan(0);
      expect(report.errors).toEqual([]);
      for (const pile of report.piles) expect(acceptedPiles.has(JSON.stringify(pile)), 'painted pile retains the accepted server play order').toBe(true);
      expect(host.traffic.errors).toEqual([]);
    } finally { await host.context.close(); }
  });
}
