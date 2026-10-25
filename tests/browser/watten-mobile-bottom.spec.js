const { test, expect } = require('@playwright/test');
const { player, create, action, normalCall, answerPartnerFeedback } = require('./helpers/watten-journey.cjs');

const VIEWPORTS = [{ width: 320, height: 568 }, { width: 390, height: 844 },
  { width: 430, height: 932 }, { width: 440, height: 956 },
  { width: 568, height: 320 }, { width: 852, height: 393 },
  { width: 768, height: 1024 }, { width: 1024, height: 768 }];

async function expectBottomZones(page, viewport, phase) {
  await page.setViewportSize(viewport);
  // Fixed actions and felt-relative identities must be sampled after the
  // viewport bridge has applied the same resize to both coordinate systems.
  await expect.poll(() => page.evaluate(() => Math.abs(
    document.querySelector('[data-wt-felt]').getBoundingClientRect().bottom - innerHeight))).toBeLessThan(1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(() => page.evaluate(() => {
    const rect = node => node.getBoundingClientRect();
    const shown = node => !node.closest('[hidden]') && rect(node).width > 1 && rect(node).height > 1
      && getComputedStyle(node).visibility !== 'hidden';
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const identities = [...document.querySelectorAll('.wt-seat--bottom.is-own .wt-avatar, '
      + '.wt-seat--bottom.is-own .wt-seat-name, .wt-seat--bottom.is-own .wt-seat-call-role')].filter(shown);
    const hand = [...document.querySelectorAll('[data-wt-hand] > .wt-hand-card')].filter(shown);
    const controls = [...document.querySelectorAll('.wt-bloedeln-start, .wt-preplay-pending, .wt-bloedeln-status, '
      + '[data-wt-panel] > .wt-bid, [data-wt-stake] > button, [data-watten-action=show_ready], [data-watten-action=inspection_ack]')].filter(shown);
    const hints = [...document.querySelectorAll('[data-wt-panel] > .wt-prompt:only-child')].filter(shown);
    const failures = [];
    for (const node of [...identities, ...controls, ...hints]) {
      const box = rect(node);
      if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) failures.push(`${node.className} leaves viewport`);
      if (hand.some(card => overlap(box, rect(card)))) failures.push(`${node.className} overlaps painted own hand`);
    }
    for (const identity of identities) for (const control of [...controls, ...hints]) {
      if (overlap(rect(identity), rect(control))) failures.push(`${identity.className} overlaps ${control.className}`);
    }
    for (const hint of hints) for (const control of controls) {
      if (overlap(rect(hint), rect(control))) failures.push(`waiting hint overlaps ${control.className}`);
    }
    const buttons = [...document.querySelectorAll('.wt-bloedeln-dock button, [data-watten-action=show_ready], '
      + '[data-watten-action=inspection_ack], [data-wt-panel] .wt-bid button, [data-wt-stake] > button')].filter(shown);
    for (const button of buttons) {
      const box = rect(button);
      if (box.width < 43.9 || box.height < 43.9) failures.push(`${button.dataset.wattenAction || 'stake'} lacks a 44px target`);
      if (!button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))) failures.push(`${button.dataset.wattenAction || 'stake'} is covered`);
    }
    const reference = document.querySelector('.wt-reference > .wt-card');
    if (reference && shown(reference) && (innerWidth <= 760 || innerHeight <= 700)) {
      const width = Number.parseFloat(getComputedStyle(reference).width);
      const minimum = innerWidth > innerHeight ? 44 : Math.min(58, Math.max(42, innerWidth * .13));
      if (width < minimum - .1) failures.push(`reference is only ${width}px wide`);
      const figure = reference.closest('figure');
      for (const badge of document.querySelectorAll('.wt-seat-badge')) {
        if (shown(badge) && overlap(rect(figure), rect(badge))) failures.push('reference overlaps a player identity');
      }
    }
    return [...new Set(failures)];
  }), { message: `${viewport.width}×${viewport.height} ${phase}: identities, choices and waiting text clear the painted hand` }).toEqual([]);
}

async function allViewports(players, phase) {
  for (const viewport of VIEWPORTS) for (const peer of players) await expectBottomZones(peer.page, viewport, phase);
}

for (const language of ['de', 'en']) {
  test(`${language}: blind mobile bottom zones stay clear through request, inspection and normal bidding`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options,
        viewport: VIEWPORTS[3], serviceWorkers: 'block' }) };
      for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, language));
      await create(players, { count: 4, target: 11, reference: true });
      await allViewports(players, 'show-ready');
      const requester = await action(players, 'request_bloedeln');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln')).toBe(true);
      await allViewports(players, 'Blödeln request');
      await action(players, 'show_ready'); await action(players, 'show_ready');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'inspection')).toBe(true);
      // The non-callers retain their real painted blind hand, name and the
      // waiting sentence while one has the active two-choice request.
      await allViewports(players, 'inspection with pending Blödeln');
      await action(players, 'preplay_decline');
      await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
      await allViewports(players, 'play with role and reference');
      expect(requester.traffic.errors).toEqual([]);
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });

  test(`${language}: open mobile bid controls leave own name and role above all five cards`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options,
        viewport: VIEWPORTS[3], serviceWorkers: 'block' }) };
      for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, language));
      await create(players, { count: 4, target: 15, determination: 'normal', reference: true });
      await allViewports(players, 'announce strike');
      await normalCall(players);
      await allViewports(players, 'ordinary stake');
      await action(players, 'bid');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
      await answerPartnerFeedback(players, 'good');
      await allViewports(players, 'bid response with partner advice');
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
