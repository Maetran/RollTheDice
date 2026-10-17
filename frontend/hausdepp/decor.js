// Presentation only: one stable arrangement per round. Optional prop input
// never sends a game command; motion stays outside the measured play areas.
// Large props come from the three 2×2 atlases, small scatter pieces from the
// 4×3 scatter atlas. `size` is the drawn size relative to a large prop.
const catalog = {
  beer: { sheet: "base", cell: 0, label: "Bierglas anstupsen", liquid: true },
  can: { sheet: "base", cell: 1, label: "Dose anstupsen" },
  nuts: { sheet: "base", cell: 2, label: "Nussschale verschieben", crumbs: ["#c99a5b", "#8f4d2c", "#e0bb7b"] },
  marend: { sheet: "base", cell: 3, label: "Jausenbrett anschieben" },
  dice: { sheet: "snacks", cell: 0, label: "Würfel anrollen" },
  tea: { sheet: "snacks", cell: 1, label: "Teetasse anstupsen", liquid: true },
  chips: { sheet: "snacks", cell: 2, label: "Chipsschale verschieben", crumbs: ["#e9c66f", "#d7a94b", "#f3dc98"] },
  flips: { sheet: "snacks", cell: 3, label: "Flipsschale verschieben", crumbs: ["#e98d2c", "#f0a640", "#c96f1d"] },
  pretzel: { sheet: "evening", cell: 0, label: "Brezel drehen", crumbs: ["#fffaf0", "#f3eee2", "#ffffff"] },
  sweets: { sheet: "evening", cell: 1, label: "Süssigkeitenschale verschieben", crumbs: ["#d8262e", "#f0b52d", "#4c9a2a", "#f4e1c0"] },
  lantern: { sheet: "evening", cell: 2, label: "Windlicht anstupsen" },
  lemonade: { sheet: "evening", cell: 3, label: "Limonade anstupsen", liquid: true },
  cap: { sheet: "scatter", cell: 0, size: .38, label: "Kronkorken schnippen", motion: "cap-spin" },
  opener: { sheet: "scatter", cell: 1, size: .7, label: "Flaschenöffner drehen", motion: "spin" },
  "praline-gold": { sheet: "scatter", cell: 2, size: .36, label: "Goldene Praline anstupsen", motion: "roll" },
  "praline-red": { sheet: "scatter", cell: 3, size: .36, label: "Rote Praline anstupsen", motion: "roll" },
  die: { sheet: "scatter", cell: 4, size: .4, label: "Würfel werfen", motion: "die-roll" },
  "loose-nuts": { sheet: "scatter", cell: 5, size: .5, label: "Nüsse anstupsen", motion: "hop", crumbs: ["#c99a5b", "#8f4d2c"] },
  "loose-chips": { sheet: "scatter", cell: 6, size: .62, label: "Chips anstupsen", motion: "hop", crumbs: ["#e9c66f", "#f3dc98"] },
  "loose-flips": { sheet: "scatter", cell: 7, size: .62, label: "Flips anstupsen", motion: "hop", crumbs: ["#e98d2c", "#f0a640"] },
  coaster: { sheet: "scatter", cell: 8, size: .66, label: "Bierdeckel drehen", motion: "coaster-turn", flat: true },
  pencil: { sheet: "scatter", cell: 9, size: .72, label: "Bleistift drehen", motion: "spin", flat: true },
};
const sheets = { base: [2, 2], snacks: [2, 2], evening: [2, 2], scatter: [4, 3] };
const large = Object.keys(catalog).filter(prop => !catalog[prop].size);
const scatter = Object.keys(catalog).filter(prop => catalog[prop].size);
const upright = ["beer", "tea", "lemonade", "can", "lantern"];
// Some large props already carry these pieces in their own picture.
const duplicates = { lemonade: ["opener", "cap"], dice: ["die"], sweets: ["praline-gold", "praline-red"],
  chips: ["loose-chips"], flips: ["loose-flips"], nuts: ["loose-nuts"] };
const layouts = new WeakMap();
const gap = 12;
const protectedAreas = ".hd-seat, .hd-room-heading, .hd-stock-group, .hd-pile-group, .hd-burned, .hd-hand-heading, "
  + "#hausdeppHand button, #hausdeppStatus, #hausdeppEvent, .hd-action-guide, #hausdeppPeek:not([hidden]), #hausdeppResult:not([hidden]), "
  + ":is(button, a[href], input, select, textarea, [role='button']):not(.hd-table-prop)";
const copy = value => window.ZDWA_I18N?.t?.(value) || value;

// Cards, piles, names and controls. Other table objects may overlap a pushed
// or nudged object, just as a nut can roll against a glass.
function controlRects(table) {
  return [...table.querySelectorAll(protectedAreas)]
    .filter(element => !element.closest(".hd-table-decor") && element.getClientRects().length)
    .map(element => element.getBoundingClientRect());
}

// A hand grows during play. Keep the band a five- to seven-card fan will
// need, so a later pickup does not bury an object under the cards.
function handReserve(table) {
  const hand = table.querySelector("#hausdeppHand");
  if (!hand?.getClientRects().length) return null;
  const area = hand.getBoundingClientRect();
  const fan = hand.querySelector(".hd-hand-fan");
  const rect = fan?.getClientRects().length ? fan.getBoundingClientRect() : area;
  const card = hand.querySelector(".hausdepp-card")?.getBoundingClientRect();
  const cardWidth = card?.width || parseFloat(getComputedStyle(hand).getPropertyValue("--hd-hand-card")) || 126;
  const width = Math.max(rect.width && fan?.childElementCount ? rect.width : 0, cardWidth * 4.2);
  const center = area.left + area.width / 2;
  return { left: center - width / 2, right: center + width / 2, top: Math.min(rect.top, area.top) - 20, bottom: table.getBoundingClientRect().bottom };
}

function fits(table, box, others, spacing = gap, inside = true) {
  const bounds = table.getBoundingClientRect();
  if (inside && (box.left < bounds.left || box.top < bounds.top || box.right > bounds.right || box.bottom > bounds.bottom)) return false;
  return !others.some(other => intersects(box, other, spacing));
}

function roomAround(sprite, table, margin, spacing = gap, inside = false) {
  const rect = sprite.getBoundingClientRect();
  const box = { left: rect.left - margin, top: rect.top - margin, right: rect.right + margin, bottom: rect.bottom + margin };
  return fits(table, box, controlRects(table), spacing, inside);
}

function burst(sprite, colors, count = 7) {
  if (!colors) return;
  const art = sprite.firstElementChild;
  const width = art.offsetWidth;
  for (let index = 0; index < count; index += 1) {
    const crumb = document.createElement("span");
    crumb.className = "hd-prop-crumb";
    crumb.setAttribute("aria-hidden", "true");
    const size = 2 + Math.random() * Math.max(2, width / 40);
    crumb.style.cssText = `width:${size}px;height:${size}px;background:${colors[index % colors.length]};left:${30 + Math.random() * 40}%;top:${35 + Math.random() * 35}%`;
    sprite.append(crumb);
    const angle = Math.random() * Math.PI * 2;
    const distance = width * (.18 + Math.random() * .22);
    const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance;
    crumb.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${x * .6}px,${y * .6 - 10}px) scale(1)`, opacity: 1, offset: .45 },
      { transform: `translate(${x}px,${y}px) scale(.7)`, opacity: 0 },
    ], { duration: 520 + Math.random() * 260, easing: "cubic-bezier(.2,.7,.3,1)" })
      .finished.catch(() => {}).finally(() => crumb.remove());
  }
}

function ripple(sprite) {
  const ring = document.createElement("span");
  ring.className = "hd-prop-ripple";
  ring.setAttribute("aria-hidden", "true");
  sprite.firstElementChild.append(ring);
  ring.animate([{ transform: "scale(.2)", opacity: .7 }, { transform: "scale(1)", opacity: 0 }],
    { duration: 700, easing: "cubic-bezier(.2,.65,.3,1)" }).finished.catch(() => {}).finally(() => ring.remove());
}

function moveProp(table, state, sprite, automatic = false) {
  if (sprite.hidden || state.reduced.matches || sprite.dataset.moving === "true" || !table.isConnected) return;
  const art = sprite.firstElementChild;
  const prop = sprite.dataset.prop;
  const item = catalog[prop];
  const turn = Number(art.dataset.turn || 0);
  const restX = Number(art.dataset.restX || 0);
  const direction = state.random() < .5 ? -1 : 1;
  const rotate = degrees => `rotate(${degrees}deg)`;
  const base = rotate(turn);
  let frames, duration = 700, motion, crumbs = false;
  if (prop === "can" && sprite.dataset.fallen === "true") {
    if (automatic) return; // A can needs a person to stand it up again.
    const fallen = Number(art.dataset.fallAngle);
    frames = [rotate(fallen), rotate(fallen * .8), rotate(-direction * 4), "rotate(0deg)"];
    sprite.dataset.fallen = "false";
    sprite.setAttribute("aria-pressed", "false");
    sprite.setAttribute("aria-label", copy(item.label));
    motion = "can-stand";
    duration = 800;
  } else if (prop === "can" && !automatic && roomAround(sprite, table, sprite.offsetWidth * .65, gap, true)) {
    const fallen = direction * 76;
    frames = ["rotate(0deg)", rotate(direction * 7), rotate(direction * 30), rotate(direction * 81), rotate(direction * 73), rotate(fallen)];
    art.dataset.fallAngle = fallen;
    art.style.setProperty("--prop-rest-angle", `${fallen}deg`);
    sprite.dataset.fallen = "true";
    sprite.setAttribute("aria-pressed", "true");
    sprite.setAttribute("aria-label", copy("Dose wieder aufstellen"));
    motion = "can-fall";
    duration = 1050;
  } else if (!roomAround(sprite, table, sprite.offsetWidth * (upright.includes(prop) ? .12 : .06), 4)) {
    if (automatic) return; // Even a decorative gesture must leave cards and controls clear.
    const rest = `translateX(${restX}px) rotate(${prop === "can" ? Number(art.dataset.fallAngle || 0) * (sprite.dataset.fallen === "true") : turn}deg)`;
    frames = [rest, `${rest} scale(.95)`, `${rest} scale(1.015)`, rest];
    motion = "squish"; // Shrinking in place always stays inside its own footprint.
    duration = 360;
  } else if (prop === "dice") {
    const next = turn + direction * 90;
    frames = [base, `translate(2px,-5px) rotate(${turn + direction * 40}deg)`, `translate(5px,0) rotate(${next + direction * 9}deg)`, `translate(1px,-1px) rotate(${next - direction * 3}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = "dice-roll";
  } else if (upright.includes(prop)) {
    const tilt = (prop === "lantern" ? 3 : prop === "can" ? 10 : 6) * direction;
    frames = [base, `rotate(${tilt * .3}deg)`, rotate(tilt), rotate(-tilt * .2), base];
    motion = prop === "can" ? "can-rock" : prop === "lantern" ? "lantern-settle" : "cup-rock";
    duration = prop === "lantern" ? 600 : 950;
    if (item.liquid && !automatic) ripple(sprite);
    if (prop === "lantern") {
      sprite.classList.remove("is-flaring");
      void sprite.offsetWidth;
      sprite.classList.add("is-flaring");
      setTimeout(() => sprite.classList.remove("is-flaring"), 1400);
    }
  } else if (prop === "pretzel") {
    const next = turn + direction * 24;
    frames = [base, `translateY(-2px) rotate(${turn + direction * 12}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = "pretzel-turn";
    crumbs = !automatic;
  } else if (item.motion === "cap-spin") {
    const next = turn + direction * 200;
    frames = [`${base} scaleX(1)`, `translateY(-6px) rotate(${turn + direction * 60}deg) scaleX(.15)`, `translateY(-8px) rotate(${turn + direction * 120}deg) scaleX(1)`,
      `translateY(-3px) rotate(${turn + direction * 170}deg) scaleX(.25)`, `rotate(${next}deg) scaleX(1)`];
    art.dataset.turn = next;
    motion = "cap-spin";
    duration = 900;
  } else if (item.motion === "spin") {
    const next = turn + direction * (prop === "pencil" ? 200 : 150);
    frames = [base, `rotate(${turn + direction * 120}deg)`, `rotate(${next + direction * 8}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = `${prop}-spin`;
    duration = 1000;
  } else if (item.motion === "roll" || item.motion === "die-roll") {
    const nextX = Math.max(-10, Math.min(10, restX + direction * 7));
    const next = turn + direction * (item.motion === "die-roll" ? 90 : 75);
    frames = [`translateX(${restX}px) ${base}`, `translate(${(restX + nextX) / 2}px,${item.motion === "die-roll" ? -9 : 0}px) rotate(${turn + direction * 45}deg)`,
      `translateX(${nextX + direction * 1.5}px) rotate(${next + direction * 6}deg)`, `translateX(${nextX}px) rotate(${next}deg)`];
    art.dataset.turn = next;
    art.dataset.restX = nextX;
    motion = item.motion === "die-roll" ? "die-roll" : "praline-roll";
  } else if (item.motion === "hop") {
    frames = [`translateX(${restX}px) ${base}`, `translate(${restX}px,-7px) ${base} scale(1.03,.97)`, `translateX(${restX}px) ${base} scale(1.04,.94)`, `translateX(${restX}px) ${base}`];
    motion = "hop";
    duration = 520;
    crumbs = !automatic;
  } else if (item.motion === "coaster-turn") {
    const next = turn + direction * 32;
    frames = [base, `translate(${direction * 3}px,-1px) rotate(${turn + direction * 22}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = "coaster-turn";
    duration = 600;
  } else {
    const slide = prop === "marend" ? 2 : 5;
    const next = Math.max(-6, Math.min(6, restX + direction * slide));
    frames = [`translateX(${restX}px)`, `translateX(${next}px) rotate(${direction * .8}deg)`, `translateX(${next}px)`];
    art.dataset.restX = next;
    motion = prop === "marend" ? "board-slide" : "bowl-slide";
    duration = prop === "marend" ? 450 : 700;
    crumbs = !automatic && prop !== "marend";
  }
  if (motion === "can-stand") art.style.setProperty("--prop-rest-angle", "0deg");
  else if (prop !== "can" && motion !== "squish") art.style.setProperty("--prop-rest-angle", `${Number(art.dataset.turn || 0)}deg`);
  art.style.setProperty("--prop-rest-x", `${Number(art.dataset.restX || 0)}px`);
  sprite.title = sprite.getAttribute("aria-label");
  sprite.dataset.moving = "true";
  sprite.dataset.lastMotion = motion;
  art.style.transformOrigin = upright.includes(prop) ? "50% 82%" : "50% 50%";
  if (crumbs) burst(sprite, item.crumbs);
  const animation = art.animate(frames.map((transform, index) => ({
    transform, easing: index === 0 ? "cubic-bezier(.42,0,.9,.45)" : "cubic-bezier(.18,.65,.35,1)",
  })), { duration, fill: "none" });
  animation.finished.catch(() => {}).finally(() => { sprite.dataset.moving = "false"; });
}

// Pointer drag: push an object a little across the wood. It only stays where
// it fits beside cards, controls and the other objects; otherwise it glides back.
function enableDrag(table, state, sprite) {
  let start = null;
  sprite.addEventListener("pointerdown", event => {
    if (sprite.disabled || event.button > 0 || sprite.dataset.moving === "true") return;
    start = { x: event.clientX, y: event.clientY, left: sprite.offsetLeft, top: sprite.offsetTop, id: event.pointerId, dragging: false };
  });
  sprite.addEventListener("pointermove", event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.dragging) {
      if (Math.hypot(dx, dy) < 7) return;
      start.dragging = true;
      sprite.setPointerCapture?.(event.pointerId);
      sprite.dataset.dragging = "true";
    }
    sprite.style.translate = `${dx}px ${dy}px`;
  });
  const finish = event => {
    if (!start || event.pointerId !== start.id) return;
    const drag = start;
    start = null;
    if (!drag.dragging) return;
    sprite.dataset.dragging = "false";
    state.swallowClick = sprite;
    setTimeout(() => { if (state.swallowClick === sprite) state.swallowClick = null; }, 0);
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    sprite.style.translate = "";
    const rect = sprite.getBoundingClientRect();
    const box = { left: rect.left + dx, right: rect.right + dx, top: rect.top + dy, bottom: rect.bottom + dy };
    if (event.type === "pointerup" && fits(table, box, controlRects(table), 6)) {
      sprite.style.left = `${drag.left + dx}px`;
      sprite.style.top = `${drag.top + dy}px`;
      sprite.style.zIndex = String(state.lift = (state.lift || 1) + 1);
      sprite.dataset.lastMotion = "drag-drop";
      sprite.firstElementChild.animate([{ scale: "1.06" }, { scale: ".97" }, { scale: "1" }], { duration: 260, easing: "ease-out" });
      if (catalog[sprite.dataset.prop].liquid) ripple(sprite);
    } else {
      sprite.dataset.lastMotion = "drag-return";
      sprite.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }],
        { duration: 380, easing: "cubic-bezier(.2,.9,.3,1.15)" });
    }
  };
  sprite.addEventListener("pointerup", finish);
  sprite.addEventListener("pointercancel", finish);
}

function scheduleMotion(table, state) {
  state.timer = setTimeout(() => {
    if (!table.isConnected) return;
    if (!document.hidden && state.phase === "playing" && !state.reduced.matches
      && !document.querySelector("dialog[open], [data-game-tour]")) {
      const visible = [...state.nodes.values()].filter(node => !node.hidden && node !== document.activeElement
        && !catalog[node.dataset.prop].size && node.dataset.dragging !== "true");
      const sprite = visible[Math.floor(state.random() * visible.length)];
      if (sprite) moveProp(table, state, sprite, true);
    }
    scheduleMotion(table, state);
  }, 20000 + state.random() * 25000);
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

function intersects(first, second, spacing = gap) {
  return first.left < second.right + spacing && first.right > second.left - spacing
    && first.top < second.bottom + spacing && first.bottom > second.top - spacing;
}

function spriteFor(table, state, prop) {
  if (state.nodes.has(prop)) return state.nodes.get(prop);
  const item = catalog[prop];
  const sprite = document.createElement("button");
  sprite.type = "button";
  sprite.className = `hd-table-prop hd-table-prop--${prop}${item.size ? " hd-table-prop--small" : ""}${item.flat ? " hd-table-prop--flat" : ""}`;
  sprite.dataset.prop = prop;
  sprite.setAttribute("aria-label", copy(item.label));
  sprite.title = copy(item.label);
  if (prop === "can") sprite.setAttribute("aria-pressed", "false");
  const art = document.createElement("span");
  art.className = "hd-prop-art";
  art.dataset.sheet = item.sheet;
  const [columns, rows] = sheets[item.sheet];
  art.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
  art.style.backgroundPosition = `${(item.cell % columns) / (columns - 1) * 100}% ${Math.floor(item.cell / columns) / (rows - 1) * 100}%`;
  art.setAttribute("aria-hidden", "true");
  sprite.append(art);
  sprite.addEventListener("click", event => {
    if (state.swallowClick === sprite) { event.preventDefault(); state.swallowClick = null; return; }
    moveProp(table, state, sprite);
  });
  enableDrag(table, state, sprite);
  state.layer.append(sprite);
  state.nodes.set(prop, sprite);
  return sprite;
}

function positionDecor(table, state) {
  const layer = state.layer;
  if (["waiting", "finished"].includes(state.phase)) { layer.hidden = true; return; }
  layer.hidden = false;
  const bounds = table.getBoundingClientRect();
  if (bounds.width < 260 || bounds.height < 290) { layer.hidden = true; return; }
  // Hand growth is ordinary play, not a reason to move the table objects.
  // Reuse their positions until the viewport/format or the round changes.
  const layoutKey = `${Math.round(bounds.width)}:${innerWidth}:${innerHeight}`;
  if (state.layoutKey === layoutKey) return;
  for (const sprite of layer.children) sprite.hidden = true;
  const hand = handReserve(table);
  const occupied = hand ? [...controlRects(table), hand] : controlRects(table);
  const phone = innerWidth < 768;
  const landscape = innerWidth > innerHeight;
  const wide = innerWidth >= 1200;
  const limits = phone ? landscape ? [2, 2] : [1, 3] : wide ? [state.count, state.scatterCount] : [3, state.scatterCount - 1];
  const side = Math.min(phone ? landscape ? 82 : 68 : wide ? 168 : 128, bounds.width * .16);
  const chosen = state.props.slice(0, limits[0]);
  const shown = new Set(chosen.flatMap(prop => duplicates[prop] || []));
  const wanted = [...chosen, ...state.scatter.filter(prop => !shown.has(prop)).slice(0, limits[1])];
  const used = [];
  let index = 0;
  for (const prop of wanted) {
    const item = catalog[prop];
    let placed = false;
    for (const scale of [1, .8]) {
      const art = item.size ? Math.max(24, side * item.size * scale) : Math.max(44, side * scale);
      const hit = Math.max(44, art);
      for (const candidate of state.positions) {
        const left = bounds.left + 8 + candidate.x * (bounds.width - hit - 16);
        const top = bounds.top + 64 + candidate.y * Math.max(0, bounds.height - hit - 90);
        const reserve = state.nodes.get(prop)?.dataset.fallen === "true" ? hit * .65 : 0;
        const box = { left: left - reserve, top: top - reserve, right: left + hit + reserve, bottom: top + hit + reserve };
        if (!fits(table, box, [...occupied, ...used], item.size ? 8 : gap)) continue;
        const sprite = spriteFor(table, state, prop);
        sprite.style.cssText = `left:${left - bounds.left}px;top:${top - bounds.top}px;width:${hit}px;height:${hit}px;`
          + `--prop-art:${art}px;--prop-angle:${state.angles[index % state.angles.length]}deg;--prop-delay:${index * 90}ms`;
        if (state.painted) sprite.style.animation = "none";
        sprite.hidden = false;
        sprite.disabled = state.reduced.matches;
        used.push(box);
        placed = true;
        index += 1;
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

function resetMotion(state) {
  for (const node of state.nodes.values()) {
    node.disabled = state.reduced.matches;
    if (!state.reduced.matches) continue;
    const art = node.firstElementChild;
    for (const animation of art.getAnimations()) animation.cancel();
    node.dataset.fallen = "false";
    art.dataset.turn = "0";
    art.dataset.restX = "0";
    art.style.setProperty("--prop-rest-angle", "0deg");
    art.style.setProperty("--prop-rest-x", "0px");
    if (node.dataset.prop === "can") {
      node.setAttribute("aria-pressed", "false");
      node.setAttribute("aria-label", copy(catalog.can.label));
      node.title = copy(catalog.can.label);
    }
  }
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
    const count = 4 + Math.floor(random() * 3);
    const scatterCount = 4 + Math.floor(random() * 3);
    // Mostly along the rim of the table, sometimes further in; every spot
    // is still checked against the measured play areas before use.
    const positions = shuffled(Array.from({ length: 64 }, (_, spot) => {
      const rim = spot % 3 !== 0;
      const x = rim ? (random() < .5 ? random() * .22 : .78 + random() * .22) : random();
      return { x, y: random() };
    }), random);
    state = { key, layer, phase, count, scatterCount, random, reduced: matchMedia("(prefers-reduced-motion: reduce)"),
      props: shuffled(large, random), scatter: shuffled(scatter, random), positions,
      angles: Array.from({ length: 10 }, () => Math.round(random() * 16 - 8)), frame: null, nodes: new Map() };
    state.onMotionPreference = () => resetMotion(state);
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
