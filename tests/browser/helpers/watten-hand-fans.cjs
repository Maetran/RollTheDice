const { expect } = require('@playwright/test');

async function expectLargerBackCards(page) {
  const viewport = page.viewportSize();
  const baseline = viewport.width > viewport.height && viewport.height <= 700 ? 28
    : viewport.width === 393 ? 37.728 : viewport.width === 320 ? 32 : null;
  if (baseline === null) return;
  const factor = viewport.width > viewport.height ? 1.2 : 1.1;
  await expect.poll(() => page.locator('.wt-backs > i:not([hidden])').evaluateAll(cards =>
    Math.min(...cards.map(card => Number.parseFloat(getComputedStyle(card).width)))))
    .toBeGreaterThanOrEqual(baseline * factor - .1);
}

async function expectHandFans(page, { spectator = false } = {}) {
  await expectLargerBackCards(page);
  await expect.poll(() => page.evaluate(({ spectator }) => {
    const errors = [];
    const box = node => node.getBoundingClientRect();
    const visible = node => box(node).width > 0 && box(node).height > 0;
    const groups = [...document.querySelectorAll('.wt-seat .wt-backs')].filter(visible)
      .map(node => ({ node, position: ['top', 'bottom', 'left', 'right'].find(position => node.closest(`.wt-seat--${position}`)),
        cards: [...node.querySelectorAll('i:not([hidden])')].filter(visible) }));
    const own = document.querySelector('[data-wt-hand]');
    if (own && visible(own)) groups.push({ node: own, position: 'bottom', own: true,
      cards: [...own.querySelectorAll('button')].filter(visible) });
    if (groups.length !== 4) errors.push(`expected four full hand fans, received ${groups.length}`);
    if (Boolean(groups.find(group => group.own)) === spectator) errors.push('own hand visibility does not match the viewer');
    const felt = box(document.querySelector('[data-wt-felt]'));
    const badges = [...document.querySelectorAll('.wt-seat-badge')].filter(visible);
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const inward = { top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 }, left: { x: 1, y: 0 }, right: { x: -1, y: 0 } };
    for (const group of groups) {
      const label = group.own ? 'own' : group.position;
      if (group.cards.length !== 5) errors.push(`${label} fan has ${group.cards.length} cards`);
      const aim = inward[group.position], tangent = { x: -aim.y, y: aim.x };
      const tips = [], grips = [], facing = [];
      for (const card of group.cards) {
        // Combine the real card transform and each wrapper's independent rotate.
        // The local upper edge must face into the table at every seat.
        let transform = new DOMMatrix();
        for (let node = card; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          const local = style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform);
          const rotation = style.rotate === 'none' ? 0 : Number.parseFloat(style.rotate);
          transform = new DOMMatrix().rotate(rotation).multiply(local).multiply(transform);
        }
        const length = Math.hypot(transform.c, transform.d);
        const direction = { x: -transform.c / length, y: -transform.d / length };
        facing.push(direction.x * aim.x + direction.y * aim.y);
        const bounds = box(card), height = Number.parseFloat(getComputedStyle(card).height);
        const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        tips.push((center.x + direction.x * height / 2) * tangent.x + (center.y + direction.y * height / 2) * tangent.y);
        grips.push((center.x - direction.x * height / 2) * tangent.x + (center.y - direction.y * height / 2) * tangent.y);
        if (bounds.left < felt.left - 1 || bounds.right > felt.right + 1
          || bounds.top < felt.top - 1 || bounds.bottom > felt.bottom + 1) errors.push(`${label} fan card escapes the ${innerWidth}x${innerHeight} table: ${bounds.left},${bounds.top}..${bounds.right},${bounds.bottom}`);
        const overlaps = badges.filter(badge => intersects(bounds, box(badge)));
        if (overlaps.length) errors.push(`${label} fan overlaps ${overlaps.map(badge => badge.closest('.wt-seat').className).join(', ')}`);
        const covering = document.elementFromPoint(center.x, center.y);
        if (group.own && !card.contains(covering)) errors.push(`own card ${card.dataset.card} center is covered by ${covering?.className}`);
      }
      if (facing.some(value => value < .8)) errors.push(`${label} fan does not face toward the table center`);
      const span = values => Math.max(...values) - Math.min(...values);
      if (span(tips) < span(grips) + 4) errors.push(`${label} fan does not open from a compact outer grip (${span(tips).toFixed(1)} / ${span(grips).toFixed(1)})`);
    }
    // Badge frames can be smaller than their positioned name/role labels.
    // Check the text itself so a frame change cannot hide a card overlap.
    for (const label of [...document.querySelectorAll('.wt-seat-name, .wt-seat-call-role')].filter(visible)) {
      const bounds = box(label);
      const seat = label.closest('.wt-seat').className;
      if (bounds.left < felt.left - 1 || bounds.right > felt.right + 1
        || bounds.top < felt.top - 1 || bounds.bottom > felt.bottom + 1) errors.push(`${seat} label escapes the table`);
      for (const x of [.25, .5, .75]) {
        const covering = document.elementFromPoint(bounds.x + bounds.width * x, bounds.y + bounds.height / 2);
        if (!label.contains(covering)) errors.push(`${seat} ${label.className} is covered by ${covering?.className}`);
      }
    }
    return [...new Set(errors)];
  }, { spectator }), { message: 'all four hands open inward from an outer grip and keep own card centers playable' }).toEqual([]);
}

module.exports = { expectHandFans, expectLargerBackCards };
