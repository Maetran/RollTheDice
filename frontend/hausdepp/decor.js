// Presentation only: one stable arrangement per round. Optional prop input
// never sends a game command; motion stays outside the measured play areas.
const props = ["beer", "can", "nuts", "marend", "dice", "tea", "chips", "flips", "pretzel", "sweets", "lantern", "lemonade"];
const layouts = new WeakMap();
const gap = 12;
const labels = {
  beer: "Bierglas anstupsen", can: "Dose anstupsen", nuts: "Nussschale verschieben", marend: "Jausenbrett anschieben",
  dice: "Würfel anrollen", tea: "Teetasse anstupsen", chips: "Chipsschale verschieben", flips: "Flipsschale verschieben",
  pretzel: "Brezel drehen", sweets: "Süssigkeitenschale verschieben", lantern: "Windlicht anstupsen", lemonade: "Limonade anstupsen",
};
const protectedAreas = ".hd-seat, .hd-room-heading, .hd-stock-group, .hd-pile-group, .hd-burned, .hd-hand-heading, "
  + "#hausdeppHand button, #hausdeppStatus, #hausdeppEvent, .hd-action-guide, #hausdeppPeek:not([hidden]), #hausdeppResult:not([hidden])";
const copy = value => window.ZDWA_I18N?.t?.(value) || value;

function roomAround(sprite, table, margin) {
  const rect = sprite.getBoundingClientRect();
  const bounds = table.getBoundingClientRect();
  const box = { left: rect.left - margin, top: rect.top - margin, right: rect.right + margin, bottom: rect.bottom + margin };
  if (box.left < bounds.left || box.top < bounds.top || box.right > bounds.right || box.bottom > bounds.bottom) return false;
  return ![...table.querySelectorAll(protectedAreas), ...table.querySelectorAll('.hd-table-prop:not([hidden])')]
    .filter(element => element !== sprite && element.getClientRects().length)
    .some(element => intersects(box, element.getBoundingClientRect()));
}

function moveProp(table, state, sprite, automatic = false) {
  if (sprite.hidden || state.reduced.matches || sprite.dataset.moving === "true" || !table.isConnected) return;
  const art = sprite.firstElementChild;
  const prop = sprite.dataset.prop;
  const turn = Number(art.dataset.turn || 0);
  const direction = state.random() < .5 ? -1 : 1;
  const rotate = degrees => `rotate(${degrees}deg)`;
  const base = rotate(turn);
  let frames, duration = 700, motion;
  if (prop === "can" && sprite.dataset.fallen === "true") {
    if (automatic) return; // A can needs a person to stand it up again.
    const fallen = Number(art.dataset.fallAngle);
    frames = [rotate(fallen), rotate(fallen * .8), rotate(-direction * 4), "rotate(0deg)"];
    sprite.dataset.fallen = "false";
    sprite.setAttribute("aria-pressed", "false");
    sprite.setAttribute("aria-label", copy(labels.can));
    motion = "can-stand";
    duration = 800;
  } else if (prop === "can" && roomAround(sprite, table, sprite.offsetWidth * .65)) {
    const fallen = direction * 76;
    frames = ["rotate(0deg)", rotate(direction * 7), rotate(direction * 30), rotate(direction * 81), rotate(direction * 73), rotate(fallen)];
    art.dataset.fallAngle = fallen;
    art.style.setProperty("--prop-rest-angle", `${fallen}deg`);
    sprite.dataset.fallen = "true";
    sprite.setAttribute("aria-pressed", "true");
    sprite.setAttribute("aria-label", copy("Dose wieder aufstellen"));
    motion = "can-fall";
    duration = 1050;
  } else if (!roomAround(sprite, table,
    ["dice", "pretzel"].includes(prop) ? sprite.offsetWidth * .25 + 6
      : ["beer", "tea", "lemonade", "can", "lantern"].includes(prop) ? sprite.offsetWidth * .18 + 4 : 8)) {
    return; // Even a decorative gesture must leave cards and controls clear.
  } else if (prop === "dice") {
    const next = turn + direction * 90;
    frames = [base, `translate(2px,-5px) rotate(${turn + direction * 40}deg)`, `translate(5px,0) rotate(${next + direction * 9}deg)`, `translate(1px,-1px) rotate(${next - direction * 3}deg)`, rotate(next)];
    art.dataset.turn = next;
    art.style.setProperty("--prop-rest-angle", `${next}deg`);
    motion = "dice-roll";
  } else if (["beer", "tea", "lemonade", "can", "lantern"].includes(prop)) {
    const tilt = (prop === "lantern" ? 3 : prop === "can" ? 10 : 6) * direction;
    frames = [base, `rotate(${tilt * .3}deg)`, rotate(tilt), rotate(-tilt * .2), base];
    motion = prop === "can" ? "can-rock" : prop === "lantern" ? "lantern-settle" : "cup-rock";
    duration = prop === "lantern" ? 600 : 950;
  } else if (prop === "pretzel") {
    const next = turn + direction * 24;
    frames = [base, `translateY(-2px) rotate(${turn + direction * 12}deg)`, rotate(next)];
    art.dataset.turn = next;
    art.style.setProperty("--prop-rest-angle", `${next}deg`);
    motion = "pretzel-turn";
  } else {
    const slide = prop === "marend" ? 2 : 5;
    const previous = Number(art.dataset.restX || 0);
    const next = Math.max(-6, Math.min(6, previous + direction * slide));
    frames = [`translateX(${previous}px)`, `translateX(${next}px) rotate(${direction * .8}deg)`, `translateX(${next}px)`];
    art.dataset.restX = next;
    art.style.setProperty("--prop-rest-x", `${next}px`);
    motion = prop === "marend" ? "board-slide" : "bowl-slide";
    duration = prop === "marend" ? 450 : 700;
  }
  if (motion === "can-stand") art.style.setProperty("--prop-rest-angle", "0deg");
  sprite.title = sprite.getAttribute("aria-label");
  sprite.dataset.moving = "true";
  sprite.dataset.lastMotion = motion;
  art.style.transformOrigin = ["beer", "can", "tea", "lemonade", "lantern"].includes(prop) ? "50% 82%" : "50% 50%";
  const animation = art.animate(frames.map((transform, index) => ({
    transform, easing: index === 0 ? "cubic-bezier(.42,0,.9,.45)" : "cubic-bezier(.18,.65,.35,1)",
  })), { duration, fill: "none" });
  animation.finished.catch(() => {}).finally(() => { sprite.dataset.moving = "false"; });
}

function scheduleMotion(table, state) {
  state.timer = setTimeout(() => {
    if (!table.isConnected) return;
    if (!document.hidden && state.phase === "playing" && !state.reduced.matches
      && !document.querySelector("dialog[open], [data-game-tour]")) {
      const visible = [...state.nodes.values()].filter(node => !node.hidden && node !== document.activeElement);
      const sprite = visible[Math.floor(state.random() * visible.length)];
      if (sprite) moveProp(table, state, sprite, true);
    }
    scheduleMotion(table, state);
  }, 30000 + state.random() * 35000);
}

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
  if (["waiting", "finished"].includes(state.phase)) { layer.hidden = true; return; }
  layer.hidden = false;
  const bounds = table.getBoundingClientRect();
  if (bounds.width < 260 || bounds.height < 290) { layer.hidden = true; return; }
  // Hand growth is ordinary play, not a reason to move the table objects.
  // Reuse their positions until the viewport/format or the round changes;
  // cards naturally cover anything underneath their growing fan.
  const layoutKey = `${Math.round(bounds.width)}:${innerWidth}:${innerHeight}`;
  if (state.layoutKey === layoutKey) return;
  for (const sprite of layer.children) sprite.hidden = true;
  const occupied = [...table.querySelectorAll(protectedAreas)]
    .filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect());
  const phone = innerWidth < 768;
  const landscape = innerWidth > innerHeight;
  const limit = phone ? landscape ? 2 : 1 : innerWidth >= 1200 ? state.count : 2;
  const size = Math.min(phone ? landscape ? 82 : 64 : innerWidth >= 1200 ? 168 : 128, bounds.width * .16);
  const used = [];
  for (const [index, prop] of state.props.slice(0, limit).entries()) {
    let placed = false;
    for (const scale of [1, .8]) {
      const side = Math.max(44, size * scale);
      for (const candidate of state.positions) {
        const left = bounds.left + 8 + candidate.x * (bounds.width - side - 16);
        const top = bounds.top + 70 + candidate.y * Math.max(0, bounds.height - side - 100);
        const reserve = state.nodes.get(prop)?.dataset.fallen === "true" ? side * .65 : 0;
        const box = { left: left - reserve, top: top - reserve, right: left + side + reserve, bottom: top + side + reserve };
        if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) continue;
        if ([...occupied, ...used].some(other => intersects(box, other))) continue;
        const sprite = state.nodes.get(prop) || document.createElement("button");
        if (!state.nodes.has(prop)) {
          sprite.type = "button";
          sprite.className = `hd-table-prop hd-table-prop--${prop}`;
          sprite.dataset.prop = prop;
          sprite.setAttribute("aria-label", copy(labels[prop]));
          sprite.title = copy(labels[prop]);
          if (prop === "can") sprite.setAttribute("aria-pressed", "false");
          const art = document.createElement("span");
          art.className = "hd-prop-art";
          art.setAttribute("aria-hidden", "true");
          sprite.append(art);
          sprite.addEventListener("click", () => moveProp(table, state, sprite));
          layer.append(sprite);
          state.nodes.set(prop, sprite);
        }
        sprite.style.cssText = `left:${left - bounds.left}px;top:${top - bounds.top}px;width:${side}px;height:${side}px;--prop-angle:${state.angles[index]}deg;--prop-delay:${index * 90}ms`;
        if (state.painted) sprite.style.animation = "none";
        sprite.hidden = false;
        sprite.disabled = state.reduced.matches;
        used.push(box);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  state.painted = true;
  // A preparatory snapshot can precede the table's first complete layout.
  // Freeze only an arrangement that has actually put an object on the wood.
  if (used.length) state.layoutKey = layoutKey;
}

export function renderTableDecor(table, { gameId, roundNumber, phase }) {
  if (!table) return;
  const key = `${gameId}:${roundNumber}`;
  let state = layouts.get(table);
  if (!state || state.key !== key) {
    state?.observer.disconnect();
    clearTimeout(state?.timer);
    if (state) state.reduced.removeEventListener("change", state.onMotionPreference);
    state?.layer.remove();
    const layer = document.createElement("div");
    layer.className = "hd-table-decor";
    layer.setAttribute("role", "group");
    layer.setAttribute("aria-label", copy("Gegenstände auf dem Tisch"));
    table.append(layer);
    const random = randomFor(key);
    const count = 2 + Math.floor(random() * 3);
    state = { key, layer, phase, count, random, reduced: matchMedia("(prefers-reduced-motion: reduce)"), props: shuffled(props, random).slice(0, 4),
      positions: shuffled([0, .14, .3, .5, .7, .86, 1].flatMap(y => [0, 1, .1, .9].map(x => ({ x, y }))), random),
      angles: Array.from({ length: 4 }, () => Math.round(random() * 16 - 8)), frame: null, nodes: new Map() };
    state.onMotionPreference = () => {
      for (const node of state.nodes.values()) {
        node.disabled = state.reduced.matches;
        if (state.reduced.matches) {
          for (const animation of node.firstElementChild.getAnimations()) animation.cancel();
          node.dataset.fallen = "false";
          node.firstElementChild.dataset.turn = "0";
          node.firstElementChild.dataset.restX = "0";
          node.firstElementChild.style.setProperty("--prop-rest-angle", "0deg");
          node.firstElementChild.style.setProperty("--prop-rest-x", "0px");
          if (node.dataset.prop === "can") {
            node.setAttribute("aria-pressed", "false");
            node.setAttribute("aria-label", copy(labels.can));
            node.title = copy(labels.can);
          }
        }
      }
    };
    state.reduced.addEventListener("change", state.onMotionPreference);
    state.observer = new ResizeObserver(() => {
      cancelAnimationFrame(state.frame);
      state.frame = requestAnimationFrame(() => positionDecor(table, state));
    });
    state.observer.observe(table);
    layouts.set(table, state);
    scheduleMotion(table, state);
  }
  state.phase = phase;
  cancelAnimationFrame(state.frame);
  state.frame = requestAnimationFrame(() => positionDecor(table, state));
}
