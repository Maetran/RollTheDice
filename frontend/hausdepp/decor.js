// Presentation only: one stable random arrangement per round. Props never
// receive input, enter snapshots or cover a measured game control or card.
const props = ["beer", "can", "nuts", "marend", "dice", "tea", "chips", "flips", "pretzel", "sweets", "lantern", "lemonade"];
const layouts = new WeakMap();
const gap = 12;

function randomFor(key) {
  let seed = 2166136261;
  for (const letter of key) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619) >>> 0;
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  return [...items].map(item => ({ item, random: random() }))
    .sort((first, second) => first.random - second.random).map(entry => entry.item);
}

function intersects(first, second) {
  return first.left < second.right + gap && first.right > second.left - gap
    && first.top < second.bottom + gap && first.bottom > second.top - gap;
}

function positionDecor(table, state) {
  const layer = state.layer;
  for (const sprite of layer.children) sprite.hidden = true;
  if (["waiting", "finished"].includes(state.phase)) return;
  const bounds = table.getBoundingClientRect();
  if (bounds.width < 260 || bounds.height < 290) return;
  const occupied = [...table.querySelectorAll(
    ".hd-seat, .hd-room-heading, .hd-stock-group, .hd-pile-group, .hd-burned, .hd-hand-heading, "
    + "#hausdeppHand button, #hausdeppStatus, #hausdeppEvent, .hd-action-guide, #hausdeppPeek:not([hidden]), #hausdeppResult:not([hidden])",
  )].filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect());
  const phone = innerWidth < 768;
  const landscape = innerWidth > innerHeight;
  const limit = phone ? landscape ? 2 : 1 : innerWidth >= 1200 ? state.count : 2;
  const size = Math.min(phone ? landscape ? 82 : 64 : innerWidth >= 1200 ? 168 : 128, bounds.width * .16);
  const used = [];
  for (const [index, prop] of state.props.slice(0, limit).entries()) {
    let placed = false;
    for (const scale of [1, .8]) {
      const side = size * scale;
      for (const candidate of state.positions) {
        const left = bounds.left + 8 + candidate.x * (bounds.width - side - 16);
        const top = bounds.top + 70 + candidate.y * Math.max(0, bounds.height - side - 100);
        const box = { left, top, right: left + side, bottom: top + side };
        if ([...occupied, ...used].some(other => intersects(box, other))) continue;
        const sprite = state.nodes.get(prop) || document.createElement("span");
        if (!state.nodes.has(prop)) {
          sprite.className = `hd-table-prop hd-table-prop--${prop}`;
          layer.append(sprite);
          state.nodes.set(prop, sprite);
        }
        sprite.style.cssText = `left:${left - bounds.left}px;top:${top - bounds.top}px;width:${side}px;height:${side}px;--prop-angle:${state.angles[index]}deg;--prop-delay:${index * 90}ms`;
        if (state.painted) sprite.style.animation = "none";
        sprite.hidden = false;
        used.push(box);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  state.painted = true;
}

export function renderTableDecor(table, { gameId, roundNumber, phase }) {
  if (!table) return;
  const key = `${gameId}:${roundNumber}`;
  let state = layouts.get(table);
  if (!state || state.key !== key) {
    state?.observer.disconnect();
    state?.layer.remove();
    const layer = document.createElement("div");
    layer.className = "hd-table-decor";
    layer.setAttribute("aria-hidden", "true");
    table.append(layer);
    const random = randomFor(key);
    const count = 2 + Math.floor(random() * 3);
    state = { key, layer, phase, count, props: shuffled(props, random).slice(0, 4),
      positions: shuffled([0, .14, .3, .5, .7, .86, 1].flatMap(y => [0, 1, .1, .9].map(x => ({ x, y }))), random),
      angles: Array.from({ length: 4 }, () => Math.round(random() * 16 - 8)), frame: null, nodes: new Map() };
    state.observer = new ResizeObserver(() => {
      cancelAnimationFrame(state.frame);
      state.frame = requestAnimationFrame(() => positionDecor(table, state));
    });
    state.observer.observe(table);
    layouts.set(table, state);
  }
  state.phase = phase;
  cancelAnimationFrame(state.frame);
  state.frame = requestAnimationFrame(() => positionDecor(table, state));
}
