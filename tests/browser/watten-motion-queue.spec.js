const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const path = require('node:path');

test('a queued collection measures its resting window after the actual WAAPI delay', async ({ page }) => {
  const bundle = await build({ entryPoints: [path.join(__dirname, '../../frontend/watten/motion.js')], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent' });
  await page.setContent(`<style>
    .wt-trick-card, .seat { position:absolute; width:64px; height:101px; }
    .wt-card-owner { position:absolute; top:100%; left:0; width:38px; height:12px; }
  </style>`);
  const timing = await page.evaluate(async source => {
    const { createMotion } = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(source)))}`);
    let clock = 0;
    const win = { innerWidth, innerHeight, performance: { now: () => clock },
      getComputedStyle: window.getComputedStyle.bind(window), matchMedia: window.matchMedia.bind(window),
      addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) };
    const motion = createMotion({ win });
    const seats = Array.from({ length: 4 }, (_, index) => {
      const node = document.createElement('div'); node.className = 'seat'; node.dataset.key = `seat-${index}`;
      node.style.left = `${620 - index * 100}px`; node.style.top = '300px'; document.body.append(node); return node;
    });
    const trick = prefix => {
      const cards = seats.map((_, seat) => ({ seat, card: `${prefix}-${seat}` }));
      const nodes = cards.map((card, index) => {
        const node = document.createElement('div'); node.className = 'wt-trick-card'; node.dataset.key = card.card;
        node.style.left = `${100 + index * 38}px`; node.style.top = '100px';
        node.innerHTML = `<span class="wt-card-owner">${index + 1} Player</span>`; document.body.append(node); return node;
      });
      return { cards, nodes, winner: 0 };
    };
    const engine = last => ({ deal_id: 'public-deal', last_trick: last });
    const first = trick('first');
    motion.present({ previous: engine(null), engine: engine(first), live: true, captured: motion.capture(seats),
      result: { hand: { nodes: [] }, trick: { ...first, last: first, created: [] } }, view: { collectionNode: () => seats[0] } });
    clock = 2600;
    const second = trick('second');
    motion.present({ previous: engine(first), engine: engine(second), live: true, captured: motion.capture(seats),
      result: { hand: { nodes: [] }, trick: { ...second, last: second,
        created: second.cards.map((card, index) => ({ ...card, node: second.nodes[index] })) } }, view: { collectionNode: () => seats[0] } });
    const queued = document.querySelectorAll('[data-wt-motion="collect"]')[1];
    const wrapper = queued.getAnimations()[0], cardFlight = queued.firstElementChild.getAnimations()[0];
    const delay = wrapper.effect.getTiming().delay;
    const sample = currentTime => {
      for (const animation of queued.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = currentTime; }
      const activeTime = wrapper.currentTime - delay;
      const labels = [...queued.querySelectorAll('.wt-card-owner')].map(node => node.getBoundingClientRect());
      const labelsOverlap = labels.some((first, index) => labels.slice(index + 1).some(second =>
        Math.min(first.right, second.right) - Math.max(first.left, second.left) > 2
        && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 2));
      return { currentTime: wrapper.currentTime, activeTime, visible: getComputedStyle(queued).opacity,
        cardProgress: cardFlight.effect.getComputedTiming().progress,
        oldObserverIncludes: wrapper.currentTime >= 300 && wrapper.currentTime <= 3100,
        resting: activeTime >= 300 && activeTime <= 3100, labelsOverlap };
    };
    const arrival = sample(delay + 100), resting = sample(delay + 500);
    motion.destroy();
    return { delay, arrival, resting };
  }, bundle.outputFiles[0].text);
  expect(timing.delay).toBe(1000);
  expect(timing.arrival.visible).toBe('1');
  expect(timing.arrival.cardProgress).toBeGreaterThan(0);
  expect(timing.arrival.cardProgress).toBeLessThan(1);
  expect(timing.arrival.oldObserverIncludes).toBe(true);
  expect(timing.arrival.labelsOverlap).toBe(true);
  expect(timing.arrival.resting).toBe(false);
  expect(timing.resting.activeTime).toBe(500);
  expect(timing.resting.resting).toBe(true);
  expect(timing.resting.labelsOverlap).toBe(false);
});

test('blind trick stays visibly still one second longer than an open trick', async ({ page }) => {
  const bundle = await build({ entryPoints: [path.join(__dirname, '../../frontend/watten/motion.js')], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent' });
  await page.setContent('<style>.card,.seat { position:absolute; width:64px; height:101px; }</style>');
  const timings = await page.evaluate(async source => {
    const { createMotion } = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(source)))}`);
    const sample = blind => {
      const motion = createMotion();
      const target = document.createElement('div'); target.className = 'seat'; target.dataset.key = 'seat-0';
      target.style.left = '600px'; target.style.top = '50px'; document.body.append(target);
      const cards = Array.from({ length: 4 }, (_, seat) => ({ seat, card: `card-${seat}` }));
      const nodes = cards.map((item, index) => {
        const node = document.createElement('div'); node.className = 'card'; node.dataset.key = item.card;
        node.style.left = `${100 + index * 32}px`; node.style.top = '180px'; document.body.append(node); return node;
      });
      const last = { cards, nodes, winner: 0 };
      const engine = value => ({ deal_id: 'deal', last_trick: value, profile: { blind } });
      motion.present({ previous: engine(null), engine: engine(last), live: true, captured: motion.capture([target]),
        result: { hand: { nodes: [] }, trick: { ...last, last, created: [] } }, view: { collectionNode: () => target } });
      const group = document.querySelector('[data-wt-motion="collect"]');
      const animation = group.getAnimations()[0]; animation.pause();
      const duration = animation.effect.getTiming().duration;
      animation.currentTime = 4000;
      const position = getComputedStyle(group).translate, opacity = getComputedStyle(group).opacity;
      motion.destroy(); target.remove(); nodes.forEach(node => node.remove());
      return { duration, position, opacity };
    };
    return { open: sample(false), blind: sample(true) };
  }, bundle.outputFiles[0].text);
  expect(timings.open.duration).toBe(3600);
  expect(timings.blind.duration).toBe(4600);
  expect(timings.blind.position).toBe('0px');
  expect(timings.blind.opacity).toBe('1');
  expect(timings.open.opacity).toBe('0');
});

test('blind reduced motion keeps the trick still over an immediate next play and releases it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const bundle = await build({ entryPoints: [path.join(__dirname, '../../frontend/watten/motion.js')], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent' });
  await page.setContent(`<style>
    .card,.seat { position:absolute; width:64px; height:101px; }
    .card { animation: settle 1s both; } @keyframes settle { to { opacity:.55; } }
    @media (prefers-reduced-motion: reduce) { * { animation-duration:.01ms !important; animation-delay:0s !important; } }
  </style>`);
  const result = await page.evaluate(async source => {
    const { createMotion } = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(source)))}`);
    const motion = createMotion();
    const target = document.createElement('div'); target.className = 'seat'; target.dataset.key = 'seat-0';
    target.style.left = '600px'; target.style.top = '50px'; document.body.append(target);
    const cards = Array.from({ length: 4 }, (_, seat) => ({ seat, card: `card-${seat}` }));
    const nodes = cards.map((item, index) => {
      const node = document.createElement('div'); node.className = 'card'; node.dataset.key = item.card;
      node.style.left = `${100 + index * 32}px`; node.style.top = '180px';
      node.setAttribute('role', 'img'); node.setAttribute('aria-label', `Previous card ${index}`);
      document.body.append(node); return node;
    });
    const last = { cards, nodes, winner: 0 };
    const engine = value => ({ deal_id: 'deal', last_trick: value, profile: { blind: true } });
    const view = { collectionNode: () => target };
    motion.present({ previous: engine(null), engine: engine(last), live: true, captured: motion.capture([target]),
      result: { hand: { nodes: [] }, trick: { ...last, last, created: [] } }, view });
    const group = document.querySelector('[data-wt-motion="collect"]'), animation = group.getAnimations()[0];
    animation.pause(); animation.currentTime = 4000;
    const position = getComputedStyle(group).translate, opacity = getComputedStyle(group).opacity;
    nodes.forEach(node => node.remove()); // The owning render removes the old trick on a real next play.
    const next = document.createElement('div'); next.className = 'card'; next.dataset.key = 'next';
    next.style.left = '250px'; next.style.top = '180px'; next.setAttribute('role', 'img');
    next.setAttribute('aria-label', 'Accepted next card'); document.body.append(next);
    motion.present({ previous: engine(last), engine: engine(last), live: true, captured: motion.capture([target]),
      result: { hand: { nodes: [] }, trick: { nodes: [next], cards: [{ seat: 0, card: 'next' }],
        created: [{ node: next, seat: 0, card: 'next' }], last } }, view });
    const during = getComputedStyle(next).opacity, accessibleVisibility = getComputedStyle(next).visibility;
    const duration = animation.effect.getTiming().duration;
    window.testBlindMotion = { motion, animation, next };
    return { position, opacity, during, accessibleVisibility, duration };
  }, bundle.outputFiles[0].text);
  expect(result.duration).toBe(4600);
  expect(result.position).toBe('none');
  expect(result.opacity).toBe('1');
  expect(result.during).toBe('0');
  expect(result.accessibleVisibility).toBe('visible');
  await expect(page.getByRole('img', { name: 'Accepted next card' })).toHaveCount(1);
  await expect(page.getByRole('img', { name: 'Previous card 0' })).toHaveCount(0);
  const after = await page.evaluate(async () => {
    const { motion, animation, next } = window.testBlindMotion;
    animation.finish(); await animation.finished; await new Promise(resolve => setTimeout(resolve, 0));
    const restored = next.style.opacity === '' && next.style.animation === '';
    const remaining = document.querySelectorAll('[data-wt-motion]').length;
    motion.destroy(); return { restored, remaining };
  });
  expect(after.restored).toBe(true);
  expect(after.remaining).toBe(0);
});
