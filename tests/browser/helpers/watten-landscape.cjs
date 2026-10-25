const { expect } = require('@playwright/test');
const { expectTableHeaderReachable } = require('./watten-header.cjs');

async function expectLandscapeTable(page, { completedPile = false, inspection = false } = {}) {
  await expect(page.locator('[data-wt-felt]')).toBeVisible();
  await expect(page.locator('.wt-seat .wt-avatar')).toHaveCount(4);
  await expectTableHeaderReachable(page);
  await expect.poll(() => page.evaluate(({ completedPile, inspection }) => {
    const errors = [];
    const table = document.querySelector('[data-wt-table]');
    const bidding = table.dataset.phase === 'bid_response';
    const rect = node => node.getBoundingClientRect();
    const visible = node => rect(node).width > 0 && rect(node).height > 0;
    const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    // Independent convex-polygon check: transform every physical card's four
    // corners, then project both outlines onto every edge normal.
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
      const middle = center(box);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
        x: middle.x + scale * (x * width / 2 * cos - y * height / 2 * sin),
        y: middle.y + scale * (x * width / 2 * sin + y * height / 2 * cos),
      }));
    };
    const hits = (one, two) => [...one, ...two].every((_, index) => {
      const polygon = index < 4 ? one : two, start = polygon[index % 4], end = polygon[(index + 1) % 4];
      const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
      const project = point => (-dy * point.x + dx * point.y) / length;
      const a = one.map(project), b = two.map(project);
      return Math.min(...a) < Math.max(...b) - 2 && Math.max(...a) > Math.min(...b) + 2;
    });
    const felt = rect(document.querySelector('[data-wt-felt]')), midpoint = center(felt);
    const avatars = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(position =>
      [position, center(rect(document.querySelector(`.wt-seat--${position} .wt-avatar`)))]));
    const near = (a, b) => Math.abs(a - b) <= 6;
    if (!near(avatars.top.x, midpoint.x) || !near(avatars.bottom.x, midpoint.x)) errors.push('opposite top/bottom players are not centered');
    const preparation = innerHeight <= 360 && table.dataset.viewer === 'player' && ['show_ready', 'inspection'].includes(table.dataset.phase);
    const sideAxis = midpoint.y - (preparation ? 72 : 0);
    if (!near(avatars.left.y, avatars.right.y) || !near(avatars.left.y, sideAxis)) errors.push('opposite side players are not centered on their phase axis');
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
    const protectedNodes = [...document.querySelectorAll('.wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-backs > i:not([hidden]), [data-wt-hand] > *, [data-wt-panel], [data-wt-stake], .wt-stock, [data-watten-reference]')].filter(visible);
    const played = inspection ? [...document.querySelectorAll('[data-watten-inspection] .wt-card')].filter(visible) : cards;
    if (inspection) {
      const reveal = document.querySelector('[data-wt-reveal]');
      if (reveal?.dataset.wtInspectionFit === 'unfit') errors.push(`inspection did not fit: ${reveal.dataset.wtInspectionReason}`);
      if (played.length !== 2) errors.push('inspection must paint exactly two faces');
      // Rotated faces on the callers' line: test their real outline against
      // painted cards and identities. A caller's own fan may only be brushed.
      const callers = played.map(card => document.querySelector(`[data-wt-seat="${card.closest('[data-wt-inspection-seat]').dataset.wtInspectionSeat}"]`));
      const inside = (face, point) => {
        const cross = face.map((start, index) => {
          const end = face[(index + 1) % face.length];
          return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
        });
        return cross.every(value => value > 0) || cross.every(value => value < 0);
      };
      const guarded = [...document.querySelectorAll('.wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-backs > i:not([hidden]), [data-wt-hand] > *, '
        + '[data-wt-panel] > *, [data-wt-stake], .wt-stock, [data-watten-reference], [data-watten-action=inspection_ack]')].filter(visible);
      for (const card of played) {
        const box = rect(card), face = outline(card);
        if (box.left < felt.left - 1 || box.right > felt.right + 1 || box.top < felt.top - 1 || box.bottom > felt.bottom + 1) errors.push('public card escapes the right table');
        const collisions = guarded.filter(node => !(node.matches('.wt-backs > i') && callers.includes(node.closest('[data-wt-seat]')))
          && hits(face, outline(node)));
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
        && hits(outline(card), outline(node)));
      if (collisions.length) errors.push(`public card ${card.dataset.card} overlaps ${collisions.map(node => node.className).join(', ')}`);
    }
    const hands = [...document.querySelectorAll('.wt-backs > i:not([hidden]), [data-wt-hand] > *')].filter(visible);
    const handObstacles = [...document.querySelectorAll('.wt-seat-badge, [data-wt-panel], [data-wt-stake], [data-wt-private] button, [data-wt-history] > summary, [data-wt-history-close]')].filter(visible);
    for (const card of hands) {
      const box = rect(card);
      if (box.left < felt.left - 1 || box.right > felt.right + 1 || box.top < felt.top - 1 || box.bottom > felt.bottom + 1) errors.push('hand card escapes the right table');
      // Bidding freezes the hand. Its decision sheet can cover frozen cards;
      // ordinary play and inspection keep every card clear of controls.
      const collisions = handObstacles.filter(node => (!bidding || node.matches('.wt-seat-badge'))
        && hits(outline(card), outline(node)));
      if (collisions.length) errors.push(`hand ${card.dataset.card || card.closest('[data-wt-seat]')?.dataset.wtSeat} overlaps ${collisions.map(node => `${node.className || node.tagName} at ${rect(node).x},${rect(node).y},${rect(node).width},${rect(node).height}`).join(', ')}`);
    }
    return [...new Set(errors)];
  }, { completedPile, inspection }), { message: 'landscape keeps opposite players mirrored and the public cards clear within the right table' }).toEqual([]);
}

module.exports = { expectLandscapeTable };
