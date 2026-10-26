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
    const outline = node => {
      const box = rect(node), style = getComputedStyle(node);
      let angle = 0;
      for (let item = node; item && item !== document.querySelector('[data-wt-felt]'); item = item.parentElement) {
        const css = getComputedStyle(item);
        if (css.transform !== 'none') { const matrix = new DOMMatrix(css.transform); angle += Math.atan2(matrix.b, matrix.a); }
        if (css.rotate !== 'none') angle += Number.parseFloat(css.rotate) * Math.PI / 180;
      }
      const width = Number.parseFloat(style.width), height = Number.parseFloat(style.height);
      const cos = Math.cos(angle), sin = Math.sin(angle), expectedWidth = Math.abs(cos) * width + Math.abs(sin) * height;
      const scale = box.width / expectedWidth, expectedHeight = scale * (Math.abs(sin) * width + Math.abs(cos) * height);
      if (!Number.isFinite(scale) || Math.abs(expectedHeight - box.height) > 1.5 + box.height * .02) {
        return [{ x: box.left, y: box.top }, { x: box.right, y: box.top }, { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }];
      }
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
        x: box.x + box.width / 2 + scale * (x * width / 2 * cos - y * height / 2 * sin),
        y: box.y + box.height / 2 + scale * (x * width / 2 * sin + y * height / 2 * cos),
      }));
    };
    // Test the rotated painted outlines, independently of the product fitter.
    const paintedOverlap = (a, b) => {
      const one = outline(a), two = outline(b);
      return [...one, ...two].every((_, index) => {
        const polygon = index < 4 ? one : two, start = polygon[index % 4], end = polygon[(index + 1) % 4];
        const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
        const project = point => (-dy * point.x + dx * point.y) / length;
        const first = one.map(project), second = two.map(project);
        return Math.min(...first) < Math.max(...second) - 1 && Math.max(...first) > Math.min(...second) + 1;
      });
    };
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
      for (const card of hand.filter(card => paintedOverlap(node, card))) {
        failures.push(`${node.className} overlaps painted own hand ${card.dataset.card || card.dataset.key}: `
          + JSON.stringify({ element: box.toJSON(), card: rect(card).toJSON() }));
      }
    }
    for (const identity of identities) for (const control of [...controls, ...hints]) {
      if (overlap(rect(identity), rect(control))) failures.push(`${identity.className} overlaps ${control.className}`);
    }
    for (const hint of hints) for (const control of controls) {
      if (overlap(rect(hint), rect(control))) failures.push(`waiting hint overlaps ${control.className}`);
    }
    if (innerWidth > 760 && innerWidth > innerHeight && innerHeight >= 701
      && ['show_ready', 'inspection'].includes(document.querySelector('[data-wt-table]').dataset.phase)) {
      for (const hint of hints) {
        const panel = hint.parentElement, style = getComputedStyle(panel), background = style.backgroundColor;
        const alpha = background.startsWith('rgba') ? Number(background.match(/[\d.]+/g).at(-1))
          : background === 'transparent' ? 0 : 1;
        if (alpha < .85 || Number.parseFloat(style.paddingTop) < 2 || Number.parseFloat(style.paddingLeft) < 6) {
          failures.push('tablet waiting text lacks padded paper over the carved table edge');
        }
        const text = document.createRange(); text.selectNodeContents(hint);
        const words = text.getBoundingClientRect(), paper = rect(panel);
        if (words.left < paper.left || words.right > paper.right || words.top < paper.top || words.bottom > paper.bottom) {
          failures.push('tablet waiting text escapes its paper');
        }
      }
    }
    for (const status of document.querySelectorAll('.wt-bloedeln-status')) if (shown(status)) {
      for (const back of document.querySelectorAll('.wt-backs:not([hidden]) > i:not([hidden])')) {
        if (shown(back) && paintedOverlap(status, back)) failures.push('passive Blödeln status covers an opponent hand');
      }
    }
    if (document.documentElement.dataset.wtCompactHeader === 'true') {
      const score = document.querySelector('.wt-topbar'), reference = document.querySelector('.wt-reference');
      if (document.documentElement.dataset.wtHeaderOpen !== 'true' && score && reference && shown(score) && shown(reference)
        && paintedOverlap(score, reference)) failures.push('floating scores cover the reference card or its caption');
      const railControls = [...document.querySelectorAll('[data-wt-stake] > button, [data-wt-history]:not([open]) > summary')].filter(shown);
      const opponentBacks = [...document.querySelectorAll('.wt-backs:not([hidden]) > i:not([hidden])')].filter(shown);
      for (const control of railControls) for (const back of opponentBacks) {
        if (paintedOverlap(control, back)) failures.push(`${control.matches('summary') ? 'closed history' : 'stake'} covers the physical opponent hand at seat ${back.closest('[data-wt-seat]').dataset.wtSeat}`);
      }
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

async function allViewports(players, phase, info) {
  for (const viewport of VIEWPORTS) for (const [seat, peer] of players.entries()) {
    await expectBottomZones(peer.page, viewport, phase);
    const caller = peer.traffic.snapshot.engine.actions.includes('inspection_ack');
    if ([440, 568, 768, 1024].includes(viewport.width) && (seat === 0 || phase.startsWith('bid response') || (caller && phase.startsWith('inspection')))) {
      const label = phase.replace(/[^a-zA-Z0-9]+/g, '-');
      await peer.page.screenshot({ path: info.outputPath(`${label}-seat${seat}-${viewport.width}x${viewport.height}.png`) });
    }
  }
}

for (const language of ['de', 'en']) {
  test(`${language}: blind mobile bottom zones stay clear through request, inspection and normal bidding`, async ({ browser, baseURL }, info) => {
    test.setTimeout(180_000);
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options,
        viewport: VIEWPORTS[3], serviceWorkers: 'block' }) };
      for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, language, { role: seat === 0 ? 'admin' : 'user' }));
      await create(players, { count: 4, target: 11, reference: true });
      await allViewports(players, 'show-ready', info);
      const requester = await action(players, 'request_bloedeln');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'bloedeln')).toBe(true);
      await allViewports(players, 'Blödeln request', info);
      await action(players, 'show_ready'); await action(players, 'show_ready');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'inspection')).toBe(true);
      // The non-callers retain their real painted blind hand, name and the
      // waiting sentence while one has the active two-choice request.
      await allViewports(players, 'inspection with pending Blödeln', info);
      await action(players, 'preplay_decline');
      await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
      await allViewports(players, 'play with role and reference', info);
      expect(requester.traffic.errors).toEqual([]);
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });

  test(`${language}: open mobile bid controls leave own name and role above all five cards`, async ({ browser, baseURL }, info) => {
    test.setTimeout(180_000);
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options,
        viewport: VIEWPORTS[3], serviceWorkers: 'block' }) };
      for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, language, { role: seat === 0 ? 'admin' : 'user' }));
      await create(players, { count: 4, target: 15, determination: 'normal', reference: true });
      await allViewports(players, 'announce strike', info);
      await normalCall(players);
      await allViewports(players, 'ordinary stake', info);
      await action(players, 'bid');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
      await answerPartnerFeedback(players, 'good');
      await allViewports(players, 'bid response with partner advice', info);
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
