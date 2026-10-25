// Pure placement for the two permitted inspection faces. Inputs are measured
// felt-local geometry; nothing here knows which cards are shown or who may
// see them. Both faces stay on the straight line between their two sources.

const dot = (a, b) => a.x * b.x + a.y * b.y;
const centreOf = rect => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
const UPRIGHT = { u: { x: 0, y: 1 }, n: { x: 1, y: 0 } };

export const rectOf = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// Rectangles and rotated boxes share one shape: centre x/y, unit long axis u,
// unit short axis n and half extents hh (along u) / hw (along n). Boxes keep
// their upright bounds so source selection can still use left/right.
export function boxOf(item) {
  if (item.u) return item;
  return { ...item, ...UPRIGHT, x: (item.left + item.right) / 2, y: (item.top + item.bottom) / 2,
    hw: (item.right - item.left) / 2, hh: (item.bottom - item.top) / 2 };
}

// A painted card is a rotated rectangle. Its measured upright bounds, its
// layout size and its accumulated rotation give the true outline; the bounds
// alone would add empty corner triangles (tens of px on fanned cards). An
// inconsistent measurement falls back to the conservative bounds.
export function paintedBox(bounds, size, angle) {
  const rect = rectOf(bounds.left, bounds.top, bounds.width, bounds.height);
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const width = size?.width * cos + size?.height * sin, height = size?.width * sin + size?.height * cos;
  if (!(width > 0 && height > 0 && Number.isFinite(angle))) return boxOf(rect);
  const scale = rect.width / width;
  if (Math.abs(scale * height - rect.height) > 1.5 + rect.height * .02) return boxOf(rect);
  return { ...rect, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
    u: { x: Math.sin(angle), y: -Math.cos(angle) }, n: { x: Math.cos(angle), y: Math.sin(angle) },
    hw: size.width * scale / 2, hh: size.height * scale / 2 };
}

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

const radius = (box, axis) => box.hw * Math.abs(dot(box.n, axis)) + box.hh * Math.abs(dot(box.u, axis));

// Separating-axis test of two rotated rectangles; a positive margin demands
// at least that much free wood between both, a negative one tolerates contact.
export function boxesHit(a, b, margin = 0) {
  const one = boxOf(a), two = boxOf(b), d = { x: two.x - one.x, y: two.y - one.y };
  for (const axis of [one.u, one.n, two.u, two.n]) {
    if (Math.abs(dot(d, axis)) >= radius(one, axis) + radius(two, axis) + margin) return false;
  }
  return true;
}
export const cardHitsRect = boxesHit;

export const covers = (box, point) => Math.abs(dot({ x: point.x - box.x, y: point.y - box.y }, box.u)) < box.hh
  && Math.abs(dot({ x: point.x - box.x, y: point.y - box.y }, box.n)) < box.hw;

export function cardBounds(box) {
  const ex = radius(box, { x: 1, y: 0 }), ey = radius(box, { x: 0, y: 1 });
  return { left: box.x - ex, right: box.x + ex, top: box.y - ey, bottom: box.y + ey };
}

const shrink = (box, amount) => amount > 0 ? { ...box, hw: Math.max(.5, box.hw - amount), hh: Math.max(.5, box.hh - amount) } : box;

// actors: [{ anchor, protect: hard outlines (own painted hand), fan: soft
// outlines (an opponent's painted backs) }]; card i belongs to actors[i].
// Hard in every attempt: the region, controls and the own hand. Identities
// (obstacles) yield only in "constrained" attempts. An opponent fan is clear,
// then brushed at its edge, and at most loses half of its back centres but
// never its middle. Without a valid placement the result is { status:
// "unfit" } and has no poses.
export function fitInspectionAxis({ region, actors, cards, captions, controls = [], obstacles = [],
  minimumWidth = 52, clearance = 4, maxOverlap = .45 }) {
  const [a, b] = actors.map(actor => actor.anchor);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 1) || cards.some(card => !(card.width > 0 && card.height > 0))) return { status: "unfit", reason: "degenerate", axis: null };
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, n = { x: -u.y, y: u.x };
  const rotation = Math.atan2(u.y, u.x) * 180 / Math.PI + 90;
  const towardCentre = dot({ x: (region.left + region.right) / 2 - (a.x + b.x) / 2,
    y: (region.top + region.bottom) / 2 - (a.y + b.y) / 2 }, n) < 0 ? -1 : 1;
  const hard = [...controls, ...actors.flatMap(actor => actor.protect || [])].map(boxOf);
  const soft = obstacles.map(boxOf);
  const groups = actors.map(actor => (actor.fan || []).map(boxOf)).filter(group => group.length)
    .map(backs => ({ backs, middle: centreOf(unionOf(backs.map(back => cardBounds(back)))) }));
  const fans = groups.flatMap(group => group.backs);
  const fanSize = Math.min(...fans.map(back => 2 * Math.min(back.hw, back.hh)), Infinity);
  const tolerance = Number.isFinite(fanSize) ? fanSize * .25 : 0;
  const step = Math.max(1, length / 480);

  // turned: the long edge lies across the line, so each face needs only its
  // width along it. Both orientations keep the centre on the line.
  const box = (t, width, height, turned) => ({ x: a.x + u.x * t, y: a.y + u.y * t, t, turned,
    u: turned ? n : u, n: turned ? u : n, hw: width / 2, hh: height / 2 });
  const within = rect => rect.left >= region.left - .01 && rect.right <= region.right + .01
    && rect.top >= region.top - .01 && rect.bottom <= region.bottom + .01;
  // Upright captions sit beside the face, at several heights along it.
  function labels(index, card) {
    const size = captions[index], outward = index ? 1 : -1, along = radius(card, u);
    const lateral = radius(card, n) + (size.width * Math.abs(n.x) + size.height * Math.abs(n.y)) / 2 + 2;
    return [towardCentre, -towardCentre].flatMap(side => [.2, .4, 0, -.2, .8, 1, 1.2, -.8, -1, -1.2].map(shift => {
      const x = card.x + n.x * side * lateral + u.x * outward * along * shift;
      const y = card.y + n.y * side * lateral + u.y * outward * along * shift;
      return { ...boxOf(rectOf(x - size.width / 2, y - size.height / 2, size.width, size.height)), side };
    }));
  }
  function fanClear(item, mode) {
    if (mode === "strict") return !fans.some(back => boxesHit(item, back, clearance));
    if (mode === "partial") return groups.every(group => !covers(item, group.middle)
      && group.backs.filter(back => covers(item, back)).length <= Math.floor(group.backs.length / 2));
    return !fans.some(back => boxesHit(item, shrink(back, mode), 0));
  }
  // Clear face positions, nearest to the face's own source first. Caption
  // slots are evaluated lazily, only for positions the pairing visits.
  function candidates(index, scale, options) {
    const width = cards[index].width * scale, height = cards[index].height * scale;
    const blocked = options.obstacles ? [...hard, ...soft] : hard;
    const captionFans = options.fans === "partial" ? tolerance * 2 : options.fans;
    const found = [];
    for (let i = 0; i <= Math.ceil(length / step); i++) {
      const t = index ? length - Math.min(length, i * step) : Math.min(length, i * step);
      const card = box(t, width, height, options.turned);
      if (!within(cardBounds(card)) || blocked.some(other => boxesHit(card, other, clearance)) || !fanClear(card, options.fans)) continue;
      let free = null;
      found.push({ card, get labels() {
        free ??= labels(index, card).filter(label => within(label)
          && !blocked.some(other => boxesHit(label, other, 2)) && fanClear(label, captionFans));
        return free;
      } });
    }
    return found;
  }
  const extent = (scale, turned) => (turned ? cards[0].width + cards[1].width : cards[0].height + cards[1].height) * scale / 2;
  function attempt(options) {
    const { scale } = options;
    const near = candidates(0, scale, options), far = candidates(1, scale, options);
    const spacing = extent(scale, options.turned), minimum = spacing * (1 - options.overlap);
    // The first face stays as close to its source as possible, the second
    // likewise; any overlap happens in their shared middle.
    let tried = 0;
    for (const first of near) {
      if (!first.labels.length) continue;
      if (++tried > 80) break;
      for (const second of far) {
        if (second.card.t - first.card.t < minimum) break;
        for (const one of first.labels) for (const two of second.labels) {
          if (boxesHit(one, two, 2) || boxesHit(second.card, one, 1) || boxesHit(first.card, two, 1)) continue;
          const turn = options.turned ? 90 : 0;
          return { status: "fit", scale, rotation: rotation + turn, turned: Boolean(options.turned), axis: { from: a, to: b, unit: u, length },
            constrained: Boolean(options.constrained), relaxed: options.fans !== "strict",
            fans: options.fans === "partial" ? "partial" : options.fans === "strict" ? "clear" : "edge",
            overlap: Math.max(0, 1 - (second.card.t - first.card.t) / spacing),
            poses: [first.card, second.card].map((card, index) => ({ x: card.x, y: card.y, t: card.t,
              width: cards[index].width * scale, height: cards[index].height * scale, rotation: rotation + turn + index * 180 })),
            labels: [one, two] };
        }
      }
    }
    return null;
  }

  const smallest = Math.min(1, minimumWidth / Math.min(cards[0].width, cards[1].width));
  const scales = [1];
  while (scales.at(-1) * .92 > smallest) scales.push(scales.at(-1) * .92);
  if (scales.at(-1) > smallest) scales.push(smallest);
  // Double-headed faces stay identifiable at up to half overlap: the upper
  // face leaves the lower one's complete outer half, a full mirrored image.
  const half = Math.max(maxOverlap, .5);
  const plan = [{ scale: 1, fans: "strict", obstacles: true, overlap: 0 },
    ...scales.filter(scale => scale >= .8).map(scale => ({ scale, fans: "strict", obstacles: true, overlap: maxOverlap })),
    ...scales.map(scale => ({ scale, fans: tolerance, obstacles: true, overlap: maxOverlap })),
    // Tight wood: the same line with quarter-turned faces needs only their
    // width along it; a caught corner index stays visible at 45% overlap.
    ...scales.map(scale => ({ scale, fans: tolerance, obstacles: true, overlap: maxOverlap, turned: true })),
    // Severely constrained: controls and the own hand remain hard.
    ...[false, true].flatMap(turned => [
      { scale: smallest, fans: tolerance * 2, obstacles: true, overlap: turned ? maxOverlap : half, turned, constrained: true },
      { scale: smallest, fans: "partial", obstacles: true, overlap: turned ? maxOverlap : half, turned, constrained: true },
      { scale: smallest, fans: "partial", obstacles: false, overlap: turned ? maxOverlap : half, turned, constrained: true }])];
  for (const options of plan) {
    const fit = attempt(options);
    if (fit) return fit;
  }
  // No placement satisfies the hard constraints. Report why instead of
  // painting over a control, the own hand or the viewport edge.
  const loosest = plan.at(-4); // partial fan, no identities, faces along the line
  const clear = [candidates(0, smallest, loosest), candidates(1, smallest, loosest)];
  const range = list => list.length ? [Math.min(...list.map(item => item.card.t)), Math.max(...list.map(item => item.card.t))] : null;
  return { status: "unfit", reason: clear.some(list => !list.length) ? "no-clear-position" : "no-separation",
    axis: { from: a, to: b, unit: u, length }, scale: smallest,
    // Clear along-axis positions per face and the centre distance they need.
    clear: clear.map(range), required: extent(smallest, false) * (1 - half) };
}
