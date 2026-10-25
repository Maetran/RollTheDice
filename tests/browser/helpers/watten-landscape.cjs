const { expect } = require('@playwright/test');
const { expectTableHeaderReachable } = require('./watten-header.cjs');

async function expectLandscapeTable(page, { completedPile = false, inspection = false } = {}) {
  await expect(page.locator('[data-wt-felt]')).toBeVisible();
  await expect(page.locator('.wt-seat .wt-avatar')).toHaveCount(4);
  await expectTableHeaderReachable(page);
  await expect.poll(() => page.evaluate(({ completedPile, inspection }) => {
    const errors = [];
    const bidding = document.querySelector('[data-wt-table]').dataset.phase === 'bid_response';
    const rect = node => node.getBoundingClientRect();
    const visible = node => rect(node).width > 0 && rect(node).height > 0;
    const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const felt = rect(document.querySelector('[data-wt-felt]')), midpoint = center(felt);
    const avatars = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(position =>
      [position, center(rect(document.querySelector(`.wt-seat--${position} .wt-avatar`)))]));
    const near = (a, b) => Math.abs(a - b) <= 6;
    if (!near(avatars.top.x, midpoint.x) || !near(avatars.bottom.x, midpoint.x)) errors.push('opposite top/bottom players are not centered');
    if (!near(avatars.left.y, avatars.right.y) || !near(avatars.left.y, midpoint.y)) errors.push('opposite side players are not centered at the same height');
    if (!near((avatars.left.x + avatars.right.x) / 2, midpoint.x)
      || !near((avatars.top.y + avatars.bottom.y) / 2, midpoint.y)) errors.push('opposite players are not mirrored around the table');
    const cards = [...document.querySelectorAll('.wt-trick-card')].filter(visible);
    if (completedPile) {
      if (cards.length !== 4) errors.push('completed pile does not show all four cards');
      if (cards.length) {
        const boxes = cards.map(rect);
        const x = (Math.min(...boxes.map(box => box.left)) + Math.max(...boxes.map(box => box.right))) / 2;
        const y = (Math.min(...boxes.map(box => box.top)) + Math.max(...boxes.map(box => box.bottom))) / 2;
        const topFan = [...document.querySelectorAll('.wt-seat--top .wt-backs > i:not([hidden])')].filter(visible).map(rect);
        const ownHand = [...document.querySelectorAll('[data-wt-hand] button')].filter(visible).map(rect);
        // Larger playable cards reserve more of the lower table. Center the
        // pile in the wood between the inward-facing top fan and own hand.
        const woodTop = topFan.length ? Math.max(...topFan.map(box => box.bottom)) : felt.top;
        const woodBottom = ownHand.length ? Math.min(...ownHand.map(box => box.top)) : felt.bottom;
        const woodCenter = (woodTop + woodBottom) / 2;
        if (Math.abs(x - midpoint.x) > 10 || Math.abs(y - woodCenter) > 12) errors.push(`played pile is not centered in the clear right table: x=${x - midpoint.x}, y=${y - woodCenter}, wood=${woodTop}..${woodBottom}`);
      }
    }
    const protectedNodes = [...document.querySelectorAll('.wt-seat-badge, .wt-backs > i:not([hidden]), [data-wt-hand-area], [data-wt-panel], [data-wt-stake], .wt-stock, [data-watten-reference]')].filter(visible);
    const played = inspection ? [...document.querySelectorAll('[data-watten-inspection] .wt-card')].filter(visible) : cards;
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    if (inspection) {
      const reveal = document.querySelector('[data-wt-reveal]');
      if (reveal?.dataset.wtInspectionFit === 'unfit') errors.push(`inspection did not fit: ${reveal.dataset.wtInspectionReason}`);
      if (played.length !== 2) errors.push('inspection must paint exactly two faces');
      // Rotated faces on the callers' line: test their real outline against
      // painted cards and identities. A caller's own fan may only be brushed.
      const callers = played.map(card => document.querySelector(`[data-wt-seat="${card.closest('[data-wt-inspection-seat]').dataset.wtInspectionSeat}"]`));
      const outline = card => {
        const style = getComputedStyle(card), angle = (Number.parseFloat(style.rotate) || 0) * Math.PI / 180;
        return { ...center(rect(card)), hw: Number.parseFloat(style.width) / 2, hh: Number.parseFloat(style.height) / 2,
          u: { x: Math.sin(angle), y: -Math.cos(angle) }, n: { x: Math.cos(angle), y: Math.sin(angle) } };
      };
      const hits = (face, box) => [{ x: 1, y: 0 }, { x: 0, y: 1 }, face.u, face.n].every(axis => {
        const a = face.x * axis.x + face.y * axis.y, ra = face.hw * Math.abs(face.n.x * axis.x + face.n.y * axis.y) + face.hh * Math.abs(face.u.x * axis.x + face.u.y * axis.y);
        const c = center(box), b = c.x * axis.x + c.y * axis.y, rb = box.width / 2 * Math.abs(axis.x) + box.height / 2 * Math.abs(axis.y);
        return Math.abs(a - b) < ra + rb - 2;
      });
      const inside = (face, point) => Math.abs((point.x - face.x) * face.u.x + (point.y - face.y) * face.u.y) < face.hh
        && Math.abs((point.x - face.x) * face.n.x + (point.y - face.y) * face.n.y) < face.hw;
      const guarded = [...document.querySelectorAll('.wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-backs > i:not([hidden]), [data-wt-hand] > *, '
        + '[data-wt-panel] > *, [data-wt-stake], .wt-stock, [data-watten-reference], [data-watten-action=inspection_ack]')].filter(visible);
      for (const card of played) {
        const box = rect(card), face = outline(card);
        if (box.left < felt.left - 1 || box.right > felt.right + 1 || box.top < felt.top - 1 || box.bottom > felt.bottom + 1) errors.push('public card escapes the right table');
        const collisions = guarded.filter(node => !(node.matches('.wt-backs > i') && callers.includes(node.closest('[data-wt-seat]')))
          && hits(face, rect(node)));
        // A caller's fan may be brushed: never its middle, at most half its backs.
        for (const seat of callers) {
          const backs = [...seat.querySelectorAll('.wt-backs > i:not([hidden])')].filter(visible).map(rect);
          if (!backs.length) continue;
          const middle = { x: (Math.min(...backs.map(b => b.left)) + Math.max(...backs.map(b => b.right))) / 2,
            y: (Math.min(...backs.map(b => b.top)) + Math.max(...backs.map(b => b.bottom))) / 2 };
          if (inside(face, middle) || backs.filter(back => inside(face, center(back))).length > Math.floor(backs.length / 2)) {
            errors.push(`inspection card ${card.dataset.card} hides too much of seat ${seat.dataset.wtSeat}'s fan`);
          }
        }
        if (collisions.length) errors.push(`inspection card ${card.dataset.card} overlaps ${collisions.map(node => node.className).join(', ')}`);
      }
    } else for (const card of played) {
      const box = rect(card);
      if (box.left < felt.left - 1 || box.right > felt.right + 1 || box.top < felt.top - 1 || box.bottom > felt.bottom + 1) errors.push('public card escapes the right table');
      const collisions = protectedNodes.filter(node => (!bidding || !node.matches('[data-wt-panel], [data-wt-stake]'))
        && intersects(box, rect(node)));
      if (collisions.length) errors.push(`public card ${card.dataset.card} overlaps ${collisions.map(node => node.className).join(', ')}`);
    }
    const hands = [...document.querySelectorAll('.wt-backs > i:not([hidden]), [data-wt-hand] button')].filter(visible);
    const handObstacles = [...document.querySelectorAll('.wt-seat-badge, [data-wt-panel], [data-wt-stake], [data-wt-private] button, [data-wt-history] > summary, [data-wt-history-close]')].filter(visible);
    for (const card of hands) {
      const box = rect(card);
      if (box.left < felt.left - 1 || box.right > felt.right + 1 || box.top < felt.top - 1 || box.bottom > felt.bottom + 1) errors.push('hand card escapes the right table');
      // Bidding freezes the hand. Its decision sheet can cover frozen cards;
      // ordinary play and inspection keep every card clear of controls.
      const collisions = handObstacles.filter(node => (!bidding || node.matches('.wt-seat-badge'))
        && intersects(box, rect(node)));
      if (collisions.length) errors.push(`hand ${card.dataset.card || card.closest('[data-wt-seat]')?.dataset.wtSeat} overlaps ${collisions.map(node => `${node.className || node.tagName} at ${rect(node).x},${rect(node).y},${rect(node).width},${rect(node).height}`).join(', ')}`);
    }
    return [...new Set(errors)];
  }, { completedPile, inspection }), { message: 'landscape keeps opposite players mirrored and the public cards clear within the right table' }).toEqual([]);
}

module.exports = { expectLandscapeTable };
