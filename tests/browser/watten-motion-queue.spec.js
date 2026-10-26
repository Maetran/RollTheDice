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
