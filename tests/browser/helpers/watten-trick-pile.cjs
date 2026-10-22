/** Inspect only accepted public trick DOM and its currently painted copies. */
async function inspectTrickPile(page, { expected, anchorSeat, paintedSelector = '[data-wt-trick]', winner = null }) {
  return page.evaluate(({ expected, anchorSeat, paintedSelector, winner }) => {
    const errors = [];
    const originals = [...document.querySelectorAll('[data-wt-trick] > .wt-trick-card')];
    const painted = [...document.querySelector(paintedSelector)?.children || []]
      .filter(node => node.classList.contains('wt-trick-card'));
    const positions = ['bottom', 'left', 'top', 'right'];
    const order = nodes => nodes.map(node => node.dataset.key);
    const accepted = expected.map(item => item.card);
    if (JSON.stringify(order(originals)) !== JSON.stringify(accepted)) errors.push('DOM order differs from accepted server play order');
    if (JSON.stringify(order(painted)) !== JSON.stringify(accepted)) errors.push('painted pile order differs from accepted server play order');
    for (const [label, nodes] of [['DOM', originals], ['painted', painted]]) {
      let z = -Infinity;
      for (const [index, node] of nodes.entries()) {
        if (!node.querySelector('.wt-card-owner')?.textContent.startsWith(`${index + 1} `)) {
          errors.push(`${label}: card ${index} has no visible play-order label`);
        }
        const next = Number(getComputedStyle(node).zIndex);
        if (!Number.isFinite(next) || next <= z) errors.push(`${label}: card ${index} does not sit above its predecessor`);
        z = next;
        if (!expected[index]) continue;
        const ownerPosition = positions[(expected[index].seat - anchorSeat + 4) % 4];
        if (node.dataset.position !== ownerPosition) errors.push(`${label}: card ${index} lost its owner position`);
      }
    }
    const visible = node => {
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (current.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const cards = painted.map(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      const transform = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
      if (!visible(node) || rect.width <= 0 || rect.height <= 0) errors.push(`card ${node.dataset.key} is not painted`);
      return { card: node.dataset.key, position: node.dataset.position,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height, z: Number(style.zIndex),
        angle: [transform.a, transform.b, transform.c, transform.d] };
    });
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > Math.min(a.width, b.width) * .08
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) * .08;
    // A loose layout can become connected only after card three or four. Check
    // every prefix, particularly the old isolated top/right and left/bottom pair.
    const connected = new Set(cards.length ? [0] : []);
    for (let pass = 0; pass < cards.length; pass++) for (const [index, card] of cards.entries()) {
      if ([...connected].some(other => overlaps(card, cards[other]))) connected.add(index);
    }
    if (connected.size !== cards.length) errors.push('painted cards do not form one connected pile');
    const winning = originals.filter(node => node.classList.contains('is-winning-card')).map(node => node.dataset.key);
    const paintedWinning = painted.filter(node => node.classList.contains('is-winning-card')).map(node => node.dataset.key);
    const expectedWinner = winner === null ? [] : expected.filter(item => item.seat === winner).map(item => item.card);
    if (JSON.stringify(winning) !== JSON.stringify(expectedWinner)) errors.push('DOM winner marker changed the accepted owner');
    if (JSON.stringify(paintedWinning) !== JSON.stringify(expectedWinner)) errors.push('painted winner marker changed the accepted owner');
    const first = cards[0];
    return { errors, cards: cards.map(card => ({ ...card, left: card.left - first.left, top: card.top - first.top })) };
  }, { expected, anchorSeat, paintedSelector, winner });
}

module.exports = { inspectTrickPile };
