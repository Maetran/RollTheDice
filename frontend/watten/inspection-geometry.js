// Pure placement for the two permitted inspection faces. Inputs are measured
// felt-local rectangles; nothing here knows which cards are shown or who may
// see them. Both faces stay on the straight line between their two sources.

const X = { x: 1, y: 0 }, Y = { x: 0, y: 1 };
const dot = (a, b) => a.x * b.x + a.y * b.y;
const centreOf = rect => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });

export const rectOf = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// The own hand card the shown face leaves from. Owner rule: a caller to the
// right, however far above, means the fifth/rightmost card; to the left the
// first/leftmost. Only a caller straight across uses the card reaching
// furthest towards it (the raised middle of the fan).
export function outermostCard(cards, target) {
  if (!cards.length) return null;
  const left = Math.min(...cards.map(card => card.left)), right = Math.max(...cards.map(card => card.right));
  const top = Math.min(...cards.map(card => card.top)), bottom = Math.max(...cards.map(card => card.bottom));
  const middle = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const dx = target.x - middle.x, epsilon = Math.max(2, (right - left) * .01);
  if (Math.abs(dx) > epsilon) {
    const sign = Math.sign(dx);
    return cards.reduce((best, card) => sign * (centreOf(card).x - centreOf(best).x) > .5 ? card : best);
  }
  const vertical = target.y < middle.y ? -1 : 1;
  return cards.reduce((best, card) => vertical * (centreOf(card).y - centreOf(best).y) > .5 ? card : best);
}

export function unionOf(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map(rect => rect.left)), top = Math.min(...rects.map(rect => rect.top));
  return rectOf(left, top, Math.max(...rects.map(rect => rect.right)) - left, Math.max(...rects.map(rect => rect.bottom)) - top);
}

function projectBox(box, axis) {
  const middle = box.x * axis.x + box.y * axis.y;
  const radius = box.hw * Math.abs(dot(box.n, axis)) + box.hh * Math.abs(dot(box.u, axis));
  return [middle - radius, middle + radius];
}

function projectRect(rect, axis) {
  const middle = dot(centreOf(rect), axis);
  const radius = (rect.right - rect.left) / 2 * Math.abs(axis.x) + (rect.bottom - rect.top) / 2 * Math.abs(axis.y);
  return [middle - radius, middle + radius];
}

// Separating-axis test of a rotated card against an upright rectangle; a
// positive margin demands at least that much free wood between both.
export function cardHitsRect(box, rect, margin = 0) {
  for (const axis of [X, Y, box.u, box.n]) {
    const [a0, a1] = projectBox(box, axis), [b0, b1] = projectRect(rect, axis);
    if (a1 + margin <= b0 || b1 + margin <= a0) return false;
  }
  return true;
}

export function cardBounds(box) {
  const ex = box.hw * Math.abs(box.n.x) + box.hh * Math.abs(box.u.x);
  const ey = box.hw * Math.abs(box.n.y) + box.hh * Math.abs(box.u.y);
  return { left: box.x - ex, right: box.x + ex, top: box.y - ey, bottom: box.y + ey };
}

const rectsHit = (a, b, margin = 0) => a.left < b.right + margin && a.right > b.left - margin
  && a.top < b.bottom + margin && a.bottom > b.top - margin;
const inset = (rect, amount) => amount <= 0 ? rect : rectOf(rect.left + Math.min(amount, rect.width / 2 - .5),
  rect.top + Math.min(amount, rect.height / 2 - .5), Math.max(1, rect.width - 2 * amount), Math.max(1, rect.height - 2 * amount));

// actors: [{ anchor, protect: hard rects (own painted hand), fan: soft rects
// (an opponent's painted backs) }]; card i belongs to actors[i]. The region,
// controls and own hand are hard in every attempt; identities (obstacles)
// yield only in the "constrained" attempts, an opponent fan only at its edge.
// Without a valid placement the result is { status: "unfit" } and has no poses.
export function fitInspectionAxis({ region, actors, cards, captions, controls = [], obstacles = [],
  minimumWidth = 52, clearance = 4, maxOverlap = .45 }) {
  const [a, b] = actors.map(actor => actor.anchor);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 1) || cards.some(card => !(card.width > 0 && card.height > 0))) return { status: "unfit", reason: "degenerate", axis: null };
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, n = { x: -u.y, y: u.x };
  const rotation = Math.atan2(u.y, u.x) * 180 / Math.PI + 90;
  const towardCentre = dot({ x: (region.left + region.right) / 2 - (a.x + b.x) / 2,
    y: (region.top + region.bottom) / 2 - (a.y + b.y) / 2 }, n) < 0 ? -1 : 1;
  const protect = actors.flatMap(actor => actor.protect || []);
  const fans = actors.flatMap(actor => actor.fan || []);
  const fanSize = Math.min(...fans.map(rect => Math.min(rect.width, rect.height)), Infinity);
  const step = Math.max(2, length / 240);

  const box = (t, width, height) => ({ x: a.x + u.x * t, y: a.y + u.y * t, u, n, hw: width / 2, hh: height / 2, t });
  const within = rect => rect.left >= region.left && rect.right <= region.right && rect.top >= region.top && rect.bottom <= region.bottom;
  // Upright captions sit beside the long edge, nudged towards their owner.
  function label(index, card, side) {
    const size = captions[index], outward = index ? 1 : -1;
    const lateral = card.hw + (size.width * Math.abs(n.x) + size.height * Math.abs(n.y)) / 2 + 2;
    const x = card.x + n.x * side * lateral + u.x * outward * card.hh * .2;
    const y = card.y + n.y * side * lateral + u.y * outward * card.hh * .2;
    return { ...rectOf(x - size.width / 2, y - size.height / 2, size.width, size.height), x, side };
  }
  function candidates(index, scale, options) {
    const width = cards[index].width * scale, height = cards[index].height * scale;
    const fanRects = options.fans ? fans.map(rect => inset(rect, options.tolerance)) : [];
    const blocked = [...controls, ...protect, ...(options.obstacles ? obstacles : [])];
    const found = [];
    for (let i = 0; i <= Math.ceil(length / step); i++) {
      const t = index ? length - Math.min(length, i * step) : Math.min(length, i * step);
      const card = box(t, width, height);
      if (!within(cardBounds(card))) continue;
      if (blocked.some(rect => cardHitsRect(card, rect, clearance))) continue;
      if (fanRects.some(rect => cardHitsRect(card, rect, options.tolerance ? 0 : clearance))) continue;
      const labels = [towardCentre, -towardCentre].map(side => label(index, card, side)).filter(rect => within(rect)
        && ![...blocked, ...fanRects].some(other => rectsHit(rect, other, 2)));
      if (labels.length) found.push({ card, labels });
    }
    return found;
  }
  function attempt(scale, options) {
    const near = candidates(0, scale, options), far = candidates(1, scale, options);
    const minimum = (cards[0].height + cards[1].height) * scale / 2 * (1 - options.overlap);
    // The first card stays as close to its source as possible, the second
    // likewise; any overlap happens in their shared middle.
    for (const first of near.slice(0, 40)) for (const second of far) {
      if (second.card.t - first.card.t < minimum) break;
      for (const one of first.labels) for (const two of second.labels) {
        if (rectsHit(one, two, 2) || cardHitsRect(second.card, one, 1) || cardHitsRect(first.card, two, 1)) continue;
        const spacing = (cards[0].height + cards[1].height) * scale / 2;
        return { status: "fit", scale, rotation, axis: { from: a, to: b, unit: u, length }, constrained: Boolean(options.constrained),
          relaxed: Boolean(options.tolerance), overlap: Math.max(0, 1 - (second.card.t - first.card.t) / spacing),
          poses: [first.card, second.card].map((card, index) => ({ x: card.x, y: card.y, t: card.t,
            width: cards[index].width * scale, height: cards[index].height * scale, rotation: rotation + index * 180 })),
          labels: [one, two] };
      }
    }
    return null;
  }

  const smallest = Math.min(1, minimumWidth / Math.min(cards[0].width, cards[1].width));
  const scales = [1];
  while (scales.at(-1) * .92 > smallest) scales.push(scales.at(-1) * .92);
  if (scales.at(-1) > smallest) scales.push(smallest);
  const tolerance = Number.isFinite(fanSize) ? fanSize * .25 : 0;
  const strict = { fans: true, obstacles: true, tolerance: 0 };
  const plan = [{ scale: 1, ...strict, overlap: 0 },
    ...scales.filter(scale => scale >= .8).map(scale => ({ scale, ...strict, overlap: maxOverlap })),
    ...scales.map(scale => ({ scale, ...strict, tolerance, overlap: maxOverlap })),
    // Severely constrained screens: keep controls and the own hand clear,
    // then let the faces brush identities before covering a source fan.
    { scale: smallest, fans: true, obstacles: false, tolerance, overlap: maxOverlap, constrained: true },
    { scale: smallest, fans: true, obstacles: false, tolerance: tolerance * 2, overlap: maxOverlap, constrained: true }];
  for (const options of plan) {
    const fit = attempt(options.scale, options);
    if (fit) return fit;
  }
  // No placement satisfies the hard constraints. Report why instead of
  // painting over a control, the own hand or the viewport edge.
  const loosest = plan.at(-1);
  const clear = [candidates(0, smallest, loosest), candidates(1, smallest, loosest)];
  const range = list => list.length ? [Math.min(...list.map(item => item.card.t)), Math.max(...list.map(item => item.card.t))] : null;
  return { status: "unfit", reason: clear.some(list => !list.length) ? "no-clear-position" : "no-separation",
    axis: { from: a, to: b, unit: u, length }, scale: smallest,
    // Clear along-axis positions per face and the centre distance they need.
    clear: clear.map(range), required: (cards[0].height + cards[1].height) * smallest / 2 * (1 - maxOverlap) };
}
