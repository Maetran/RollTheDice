import { snapshotTargets, drawSnapshot, woodenStage, protectControls, paintTableWood, handTransferCluster } from "./surprise-snapshots.js";
import { premiumSurpriseArt, premiumMouseArt, premiumTentacleArt, warmSurpriseArt } from "./surprise-art.js";
// Rare table surprises use inert visual doubles; live cards, controls and
// game state keep their real geometry and continue to accept normal input.
const active = new WeakMap();
const noop = () => {};
let serial = 0;
// Cards, piles, names and controls stay clear of a surprise where possible.
const guarded = ".hd-seat, .hd-room-heading, .hd-stock-group, .hd-pile-group, .hd-burned, .hd-hand-heading, "
  + "#hausdeppHand, #hausdeppStatus, #hausdeppEvent, .hd-action-guide, #hausdeppPeek:not([hidden]), #hausdeppResult:not([hidden]), "
  + ".wt-seat-badge, .wt-seat-name, .wt-scorebar, .wt-panel, .wt-status, [data-wt-hand], .wt-backs, "
  + ":is(button, a[href], input, select, textarea, [role='button']):not(.hd-table-prop)";
const middle = [[.5, .5], [.5, .4], [.38, .46], [.62, .46], [.5, .32], [.3, .38], [.7, .38], [.42, .6], [.58, .6], [.22, .5], [.78, .5],
  [.16, .34], [.84, .34], [.16, .66], [.84, .66]];
const upper = [[.5, .3], [.36, .3], [.64, .3], [.24, .34], [.76, .34], [.5, .42], [.36, .44], [.64, .44], [.5, .55]];
const svg = (body, view = "0 0 100 100") => `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;
const uid = () => `hd-surprise-${++serial}-`;
const effectArt = effect => premiumSurpriseArt(effect, { live: true });

// Separately drawn pieces for the effects; real table objects are never used.
const cracks = "l-9-4-6-9-10-2M50 50l8-6 4-10 10-5M50 50l11 3 7 7 11 1M50 50l-3 11-8 6-2 10M50 50l-12 5-8 9";
const crack = svg(`<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M50 50${cracks}" stroke="#1d1009" stroke-width="2.4" opacity=".8"/>`
  + `<path d="M50 50${cracks}" stroke="#f0d6a0" stroke-width=".8" opacity=".45" transform="translate(1 1)"/></g>`);
export function tableSurpriseArt(effect) {
  warmSurpriseArt(effect);
  return premiumSurpriseArt(effect);
}

// Covered area of a table-relative box. Table objects lie above the surprise,
// so they would hide it just like cards and controls.
function coverage(table, box) {
  const blocked = [...table.querySelectorAll(`${guarded}, .hd-table-decor .hd-table-prop:not([hidden])`)]
    .filter(element => !element.closest(".hd-surprise-layer") && (element.classList.contains("hd-table-prop") || !element.closest(".hd-table-decor"))
      && element.getClientRects().length)
    .map(element => element.getBoundingClientRect());
  return (left, top, right, bottom) => blocked.reduce((sum, rect) => sum + Math.max(0, Math.min(rect.right, box.left + right) - Math.max(rect.left, box.left + left))
    * Math.max(0, Math.min(rect.bottom, box.top + bottom) - Math.max(rect.top, box.top + top)), 0);
}

function freeSpot(table, box, size, spots, tall = size, avoid = []) {
  const covered = coverage(table, box);
  const inside = (value, length, extent) => Math.min(Math.max(value, extent / 2), length - extent / 2);
  let best = null;
  // The lower middle is mostly cards on phones. If the preferred story spots
  // are occupied, also search the actual free wood above and beside them.
  const fallback = [.14, .24, .34, .44, .54, .64, .74, .84, .94]
    .flatMap(y => [.5, .35, .65, .2, .8, .08, .92].map(x => [x, y]));
  for (const [fx, fy] of [...spots, ...fallback]) {
    const x = inside(box.width * fx, box.width, size), y = inside(box.height * fy, box.height, tall);
    const left = x - size / 2, top = y - tall / 2, right = x + size / 2, bottom = y + tall / 2;
    const overlap = covered(left, top, right, bottom) + avoid.reduce((sum, rect) => sum
      + Math.max(0, Math.min(rect.right, right) - Math.max(rect.left, left))
      * Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top)), 0);
    if (!overlap) return { x, y };
    // On a crowded table, the least covered spot; the surprise plays underneath.
    if (!best || overlap < best.overlap) best = { x, y, overlap };
  }
  return best;
}

const at = (x, y, width, height = width) => `translate(${(x - width / 2).toFixed(1)}px,${(y - height / 2).toFixed(1)}px)`;
// Ease each step on its own, so keyframe offsets stay real moments in time.
const smooth = frames => frames.map(frame => ({ easing: "ease-in-out", ...frame }));
function burst({ add, play, random }, x, y, { count, size, colors, reach, kind = "spark", delay = 0, duration = 800, angle = 0, spread = 360, drop = 0, stagger = 0 }) {
  const full = spread >= 360;
  for (let index = 0; index < count; index++) {
    const spark = add(kind, size);
    spark.style.setProperty("--spark", colors[index % colors.length]);
    const share = full ? index / count : index / Math.max(1, count - 1) - .5;
    const turn = (angle + share * spread + random() * 14 - 7) * Math.PI / 180, far = reach * (.75 + random() * .45);
    const dx = Math.cos(turn) * far, dy = Math.sin(turn) * far;
    play(spark, [{ transform: `${at(x, y, size)} scale(1)`, opacity: 0 }, { opacity: 1, offset: .1 },
      { transform: `${at(x + dx * .85, y + dy * .85 + drop * .3, size)} scale(1)`, opacity: 1, offset: .55 },
      { transform: `${at(x + dx, y + dy + drop, size)} scale(.3)`, opacity: 0 }], { duration, delay: delay + index * stagger, easing: "cubic-bezier(.1,.8,.3,1)" });
  }
}

function stageFade(fx, node, duration, { from = 0, until = duration, strength = 1 } = {}) {
  fx.play(node, [{ opacity: 0 }, { opacity: strength, offset: Math.max(.001, from / duration) },
    { opacity: strength, offset: Math.min(.999, until / duration) }, { opacity: 0 }], { duration });
}

function occlude(fx, target, duration, from, until) {
  const patch = fx.add('occlusion', target.width + 8, target.height + 8);
  patch.style.transform = `translate(${target.left - 4}px,${target.top - 4}px)`;
  paintTableWood(fx, patch, target.left - 4, target.top - 4);
  stageFade(fx, patch, duration, { from, until });
  return patch;
}

function transferOcclusions(fx, targets, duration, from, until) {
  const cluster = handTransferCluster(fx.table, targets);
  if (cluster) {
    const hold = Math.max(until, duration * .9);
    occlude(fx, cluster.target, duration, from, hold);
    const rest = drawSnapshot(fx, cluster.target, { omitNodes: cluster.movingNodes });
    rest.host.dataset.restoredHand = 'true';
    // The host crops the original hand viewport, including its scroll offset.
    rest.host.style.overflow = 'hidden';
    stageFade(fx, rest.host, duration, { from, until: hold });
  }
  for (const target of targets) if (!cluster?.movingNodes.includes(target.node)) occlude(fx, target, duration, from, until);
}

function chooseTargets(fx, count = 3) {
  const targets = snapshotTargets(fx.table), cards = targets.filter(target => target.kind === 'card');
  const props = targets.filter(target => target.kind === 'prop');
  const first = cards[Math.floor(fx.random() * cards.length)];
  const second = props[Math.floor(fx.random() * props.length)];
  const chosen = [first, second].filter(Boolean);
  const remaining = targets.filter(target => !chosen.includes(target));
  while (chosen.length < count && remaining.length) chosen.push(remaining.splice(Math.floor(fx.random() * remaining.length), 1)[0]);
  return chosen;
}

function star(fx) {
  const { add, play, unit, spot, box, rich } = fx, duration = 2800;
  const { x, y } = spot(unit * 2.4, middle);
  const aura = add('glamour', box.width, box.height);
  aura.style.setProperty('--origin-x', `${x}px`); aura.style.setProperty('--origin-y', `${y}px`);
  stageFade(fx, aura, duration, { from: 480, until: 1850, strength: .55 });
  const raySize = Math.min(Math.max(box.width, box.height) * .95, unit * 7.5);
  const rays = add('rays', raySize);
  const rayAt = at(x, y, raySize);
  play(rays, smooth([{ transform: `${rayAt} scale(.05) rotate(-30deg)`, opacity: 0 },
    { transform: `${rayAt} scale(.9) rotate(0deg)`, opacity: .75, offset: .28 },
    { transform: `${rayAt} scale(1.15) rotate(22deg)`, opacity: .55, offset: .7 },
    { transform: `${rayAt} scale(1.35) rotate(45deg)`, opacity: 0 }]), { duration });
  for (let index = 0; index < 3; index++) {
    const size = unit * (1.3 + index * .35), ring = add('ring', size), place = at(x, y, size);
    play(ring, [{ transform: `${place} scale(.1)`, opacity: 0 }, { opacity: .85, offset: .13 },
      { transform: `${place} scale(3.3)`, opacity: 0 }], { duration: 1650, delay: 350 + index * 210, easing: 'ease-out' });
  }
  const size = unit * 2.1, body = add('star', size, size, effectArt('star')), place = at(x, y, size);
  play(body, smooth([{ transform: `${at(x - unit * 2.7, y - unit * 2, size)} scale(.12) rotate(-180deg)`, opacity: 0 },
    { transform: `${place} scale(1.15) rotate(0deg)`, opacity: 1, offset: .25 },
    { transform: `${place} scale(.95) rotate(24deg)`, opacity: 1, offset: .52 },
    { transform: `${place} scale(1.2) rotate(65deg)`, opacity: 1, offset: .72 },
    { transform: `${place} scale(.1) rotate(160deg)`, opacity: 0 }]), { duration });
  const constellation = add('constellation', Math.max(1, box.width), Math.max(1, box.height));
  let d = '';
  for (let index = 0; index < 7; index++) {
    const angle = index / 7 * Math.PI * 2;
    const px = Math.max(12, Math.min(box.width - 12, x + Math.cos(angle) * unit * 2.5));
    const py = Math.max(12, Math.min(box.height - 12, y + Math.sin(angle) * unit * 1.8));
    d += `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  constellation.innerHTML = svg(`<path d="${d}Z" fill="none" stroke="#ffe4a4" stroke-width="1.5" stroke-dasharray="3 8"/>`, `0 0 ${box.width} ${box.height}`);
  stageFade(fx, constellation, duration, { from: 700, until: 1900, strength: .8 });
  burst(fx, x, y, { count: rich ? 48 : 30, size: Math.max(3, unit * .07), colors: ['#ffe7a4', '#d3b4ff', '#fff9e5', '#efb945'], reach: unit * 3.4,
    delay: 480, duration: 1700, stagger: 6, drop: unit * .6 });
}

function hammer(fx) {
  const { add, play, unit, spot, box, local, timers } = fx, duration = 3400, hit = 650;
  const x = box.width / 2, y = Math.max(unit * 1.4, Math.min(box.height - unit * 1.4, box.height * .42));
  const stage = woodenStage(fx);
  stageFade(fx, stage, duration, { from: hit, until: 3020 });
  const targets = snapshotTargets(fx.table);
  targets.forEach((target, index) => {
    const copy = drawSnapshot(fx, target), distance = Math.hypot(target.x - x, target.y - y);
    const angle = Math.atan2(target.y - y, target.x - x) + (index % 2 ? .3 : -.3);
    const reach = Math.max(22, Math.min(unit * 1.8, Math.min(box.width, box.height) * .2));
    const dx = Math.cos(angle) * reach, dy = Math.sin(angle) * reach - unit * .4;
    const moved = `translate(${target.left + dx}px,${target.top + dy}px) rotate(${index % 2 ? 28 : -24}deg)`;
    play(copy.host, smooth([{ transform: copy.place, opacity: 0 }, { transform: copy.place, opacity: 0, offset: .18 },
      { transform: copy.place, opacity: 1, offset: hit / duration },
      { transform: `${moved} scale(1.08)`, opacity: 1, offset: .36 + Math.min(.06, distance / 8000) },
      { transform: `${moved} translate(${-dx * .22}px,${-dy * .2}px) rotate(${index % 2 ? -14 : 12}deg)`, opacity: 1, offset: .58 },
      { transform: copy.place, opacity: 1, offset: .86 }, { transform: copy.place, opacity: 0 }]), { duration });
  });
  const crater = add('crack', unit * 3.2, unit * 3.2, crack), craterAt = at(x, y, unit * 3.2);
  play(crater, [{ transform: `${craterAt} scale(.4)`, opacity: 0 }, { transform: `${craterAt} scale(1)`, opacity: .95, offset: .12 },
    { transform: `${craterAt} scale(1.1)`, opacity: .8, offset: .75 }, { opacity: 0 }], { duration: 2300, delay: hit });
  const size = unit * 2.7, tool = add('hammer', size, size, effectArt('hammer'));
  tool.style.transformOrigin = '55% 72%';
  const base = `translate(${x - size * .55}px,${y - size * .72}px)`;
  play(tool, smooth([{ transform: `${base} translate(${unit * .5}px,${-unit}px) rotate(62deg) scale(1.3)`, opacity: 0 },
    { transform: `${base} translate(${unit * .5}px,${-unit}px) rotate(62deg) scale(1.3)`, opacity: 1, offset: .13, easing: 'cubic-bezier(.8,0,1,.6)' },
    { transform: `${base} rotate(0deg) scale(1)`, opacity: 1, offset: hit / duration },
    { transform: `${base} rotate(-8deg) scale(.94)`, opacity: 1, offset: .24 },
    { transform: `${base} rotate(0deg) scale(1)`, opacity: 1, offset: .43 },
    { transform: `${base} translate(${-unit * .2}px,${-unit}px) rotate(-28deg) scale(.7)`, opacity: 0, offset: .7 }, { opacity: 0 }]), { duration });
  for (let index = 0; index < 3; index++) {
    const ring = add(index ? 'shockwave' : 'impact', unit * 1.4), place = at(x, y, unit * 1.4);
    play(ring, [{ transform: `${place} scale(.1)`, opacity: 0 }, { opacity: .95, offset: .1 }, { transform: `${place} scale(${4 + index})`, opacity: 0 }],
      { duration: 900 + index * 150, delay: hit + index * 100, easing: 'ease-out' });
  }
  burst(fx, x, y, { kind: 'dust', count: 24, size: unit * .09, colors: ['#d7ad77', '#ecd5a5', '#93613d'], reach: unit * 2.2, delay: hit, duration: 1400, drop: unit * 1.4 });
  if (local) timers.push(setTimeout(() => { if (!document.hidden) { try { navigator.vibrate?.([35, 30, 65]); } catch { /* Optional local haptics. */ } } }, hit));
}

function ufo(fx) {
  const { add, play, unit, box, spot } = fx, duration = 3600;
  const targets = chooseTargets(fx, fx.random() < .5 ? 2 : 3), size = unit * 2;
  const hover = spot(size * 1.5, upper), saucer = add('ufo', size, size, effectArt('ufo'));
  const from = at(-size, hover.y - unit, size), place = at(hover.x, hover.y, size), leave = at(box.width + size, hover.y - unit, size);
  play(saucer, smooth([{ transform: `${from} rotate(-15deg)`, opacity: 0 }, { transform: place, opacity: 1, offset: .18 },
    { transform: `${place} translateY(-5px)`, opacity: 1, offset: .38 }, { transform: place, opacity: 1, offset: .72 },
    { transform: `${leave} rotate(15deg)`, opacity: 0 }]), { duration });
  transferOcclusions(fx, targets, duration, 940, 2870);
  targets.forEach((target, index) => {
    const copy = drawSnapshot(fx, target); copy.host.dataset.abducted = 'true';
    const beamWidth = Math.max(24, target.width * 1.2), dx = target.x - hover.x, dy = target.y - hover.y;
    const beam = add('beam', beamWidth, Math.max(40, Math.hypot(dx, dy)));
    beam.style.transformOrigin = '50% 0';
    const beamAt = `translate(${hover.x - beamWidth / 2}px,${hover.y}px) rotate(${-Math.atan2(dx, dy) * 180 / Math.PI}deg)`;
    play(beam, [{ transform: `${beamAt} scaleY(0)`, opacity: 0 }, { transform: `${beamAt} scaleY(0)`, opacity: 0, offset: .2 },
      { transform: `${beamAt} scaleY(1)`, opacity: .75, offset: .3 }, { transform: `${beamAt} scaleY(1)`, opacity: .8, offset: .7 },
      { transform: `${beamAt} scaleY(.1)`, opacity: 0, offset: .84 }, { opacity: 0 }], { duration });
    const abduct = `translate(${hover.x - target.width / 2}px,${hover.y - target.height / 2}px) scale(.08) rotate(${index % 2 ? -220 : 220}deg)`;
    play(copy.host, smooth([{ transform: copy.place, opacity: 0 }, { transform: copy.place, opacity: 0, offset: .22 },
      { transform: copy.place, opacity: 1, offset: .27 }, { transform: `${copy.place} translateY(-12px) rotate(-8deg)`, opacity: 1, offset: .38 },
      { transform: abduct, opacity: 0, offset: .59 + index * .025 }, { transform: abduct, opacity: 0, offset: .71 },
      { transform: copy.place, opacity: 1, offset: .85 }, { transform: copy.place, opacity: 0 }]), { duration });
  });
  burst(fx, hover.x, hover.y + size * .2, { count: 18, size: unit * .06, colors: ['#b5ffd0', '#e8fff2', '#73eaaa'], reach: unit * 1.8, delay: 800, duration: 1700, drop: unit });
}

function portal(fx) {
  const { add, play, unit, box, spot } = fx, duration = 3400;
  const targets = chooseTargets(fx, 2), size = unit * 2;
  const from = spot(size * 1.45, [[.24, .47], [.3, .55], [.24, .7]]), to = spot(size * 1.45, [[.76, .47], [.7, .55], [.76, .7]], size * 1.45,
    [{ left: from.x - size, right: from.x + size, top: from.y - size, bottom: from.y + size }]);
  for (const [index, point] of [from, to].entries()) {
    const gate = add('portal', size, size, effectArt('portal')), place = at(point.x, point.y, size);
    gate.dataset.portalSide = index ? 'exit' : 'entry';
    play(gate, smooth([{ transform: `${place} scale(.02) rotate(0deg)`, opacity: 0 }, { transform: `${place} scale(1.2,.65) rotate(-15deg)`, opacity: 1, offset: .15 },
      { transform: `${place} scale(1,.58) rotate(-45deg)`, opacity: 1, offset: .4 },
      { transform: `${place} scale(1.1,.65) rotate(-80deg)`, opacity: 1, offset: .82 },
      { transform: `${place} scale(.01) rotate(-100deg)`, opacity: 0 }]), { duration: duration - index * 80, delay: index * 80 });
  }
  const bridge = add('bridge', box.width, box.height);
  const curve = `M${from.x} ${from.y}Q${box.width / 2} ${Math.max(15, Math.min(from.y, to.y) - unit * 1.6)} ${to.x} ${to.y}`;
  bridge.innerHTML = svg(`<path d="${curve}" fill="none" stroke="#9cf5dd" stroke-width="18" opacity=".15"/><path d="${curve}" fill="none" stroke="#d8fff5" stroke-width="4" stroke-dasharray="10 7"/><path d="${curve}" fill="none" stroke="#b9a1ff" stroke-width="1.5"/>`, `0 0 ${box.width} ${box.height}`);
  stageFade(fx, bridge, duration, { from: 450, until: 2700, strength: .9 });
  transferOcclusions(fx, targets, duration, 560, 2900);
  targets.forEach((target, index) => {
    const entry = index ? to : from, exit = index ? from : to;
    const copy = drawSnapshot(fx, target); copy.host.dataset.traveller = 'true';
    const center = point => `translate(${point.x - target.width / 2}px,${point.y - target.height / 2}px)`;
    play(copy.host, smooth([{ transform: copy.place, opacity: 0 }, { transform: copy.place, opacity: 1, offset: .17 },
      { transform: `${center(entry)} scale(.2) rotate(160deg)`, opacity: .9, offset: .36 },
      { transform: `${center(entry)} scale(.05) rotate(220deg)`, opacity: 0, offset: .4 },
      { transform: `${center(exit)} scale(.05) rotate(220deg)`, opacity: 0, offset: .48 },
      { transform: `${center(exit)} translateY(${-unit}px) scale(1.15) rotate(360deg)`, opacity: 1, offset: .66 },
      { transform: copy.place, opacity: 1, offset: .9 }, { transform: copy.place, opacity: 0 }]), { duration });
  });
  for (const point of [from, to]) burst(fx, point.x, point.y, { count: 12, size: unit * .07, colors: ['#9af9e0', '#c4a5ff', '#fff5ca'], reach: unit * 1.8, delay: 500, duration: 1800, stagger: 12, drop: -unit * .5 });
}

const flameArt = id => svg(`<defs><linearGradient id="${id}f" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#fff8c5"/><stop offset=".35" stop-color="#ffd25a"/><stop offset=".72" stop-color="#f47722"/><stop offset="1" stop-color="#b52c18" stop-opacity="0"/></linearGradient></defs><path d="M50 98C-12 75 12 39 20 20c2 19 15 21 14 2C34 14 43 5 48 0c-2 27 25 26 22 6C91 31 80 40 91 48c-5-18 18 23-3 39C75 99 60 101 50 98Z" fill="url(#${id}f)"/><path d="M48 94C21 77 35 58 39 39c0 17 20 17 20-1 22 26 13 43-11 56Z" fill="#fff5b3" opacity=".9"/>`);

function dragon(fx) {
  const { add, play, unit, spot, box } = fx, duration = 3500;
  const anchor = spot(unit * 2, [[.16, .26], [.84, .26], [.16, .48], [.84, .48]]), direction = anchor.x < box.width / 2 ? 1 : -1;
  const size = unit * 2.2, wyrm = add('dragon', size, size, effectArt('dragon')), place = at(anchor.x, anchor.y, size);
  const pose = (scale, angle = 0) => `${place} rotate(${direction * angle}deg) scale(${direction * scale},${scale})`;
  play(wyrm, smooth([{ transform: `${pose(.2)} translateY(${-unit}px)`, opacity: 0 }, { transform: pose(1.12), opacity: 1, offset: .16 },
    { transform: pose(1, -12), opacity: 1, offset: .26 }, { transform: pose(1.08, 8), opacity: 1, offset: .37 },
    { transform: pose(1, 4), opacity: 1, offset: .78 }, { transform: `${pose(.65, -18)} translateY(${-unit}px)`, opacity: 0 }]), { duration });
  const targets = snapshotTargets(fx.table, { groupHand: false, only: target => target.kind === 'card' || target.kind === 'burned' });
  const mouth = { x: anchor.x + direction * size * .36, y: anchor.y - size * .24 };
  // A curling stream reaches every visible card, then individual edges flare.
  targets.forEach((target, index) => {
    const line = add('breath', box.width, box.height), end = { x: target.x, y: target.y };
    line.innerHTML = svg(`<path d="M${mouth.x} ${mouth.y}Q${(mouth.x + end.x) / 2} ${Math.min(mouth.y, end.y) - unit * .5} ${end.x} ${end.y}" fill="none" stroke="#f37126" stroke-width="15" stroke-linecap="round" opacity=".45"/><path d="M${mouth.x} ${mouth.y}Q${(mouth.x + end.x) / 2} ${Math.min(mouth.y, end.y) - unit * .5} ${end.x} ${end.y}" fill="none" stroke="#ffe9a3" stroke-width="4" stroke-linecap="round"/>`, `0 0 ${box.width} ${box.height}`);
    const delay = 720 + Math.min(index, 9) * 45;
    stageFade(fx, line, 1300, { from: 130, until: 700, strength: .9 });
    line.getAnimations().forEach(animation => animation.effect.updateTiming({ delay }));
    const width = Math.max(32, Math.min(target.width * 1.15, unit * 1.5)), height = Math.min(target.height * .9, unit * 1.8);
    const flame = add('flame', width, height, flameArt(uid())), flameAt = at(target.x, target.y + target.height * .08, width, height);
    play(flame, smooth([{ transform: `${flameAt} scale(.3,.05)`, opacity: 0 }, { transform: `${flameAt} scale(1,1.1)`, opacity: .95, offset: .25 },
      { transform: `${flameAt} scale(.8,1.2) rotate(-5deg)`, opacity: .9, offset: .5 },
      { transform: `${flameAt} scale(1.1,.9) rotate(5deg)`, opacity: .8, offset: .72 }, { transform: `${flameAt} translateY(${-unit * .4}px) scale(.4,1.4)`, opacity: 0 }]), { duration: 1700, delay: 1000 + Math.min(index, 20) * 35 });
  });
  if (!targets.length) {
    const flame = add('flame', unit * 1.6, unit * 2, flameArt(uid()));
    play(flame, [{ transform: `${at(box.width / 2, box.height / 2, unit * 1.6, unit * 2)} scale(.1)`, opacity: 0 }, { opacity: .9, offset: .25 }, { transform: `${at(box.width / 2, box.height / 2, unit * 1.6, unit * 2)} scale(1.2)`, opacity: 0 }], { duration: 2200, delay: 800 });
  }
  burst(fx, mouth.x, mouth.y, { count: 32, size: unit * .07, colors: ['#ffdc7b', '#ff8b3b', '#fff6c8'], reach: unit * 3, angle: direction > 0 ? 15 : 165, spread: 70, delay: 800, duration: 1900, stagger: 10, drop: unit * .8 });
}

function kraken(fx) {
  const { add, play, unit, box, spot } = fx, duration = 3400;
  const all = snapshotTargets(fx.table), burned = all.filter(target => target.kind === 'burned');
  const expendable = all.filter(target => target.kind === 'prop').sort((a, b) => Number(b.prop === 'beer') - Number(a.prop === 'beer'));
  const targets = (burned.length ? burned : expendable).slice(0, 3);
  const anchor = targets[0] || { x: box.width * .85, y: box.height * .62 };
  const edge = anchor.x < box.width / 2 ? -unit * .2 : box.width + unit * .2, inward = edge < 0 ? 1 : -1;
  const size = unit * 2.6, monster = add('kraken', size, size, effectArt('kraken'));
  // The discarded pile can sit inside the lower caption cut-outs. The kraken
  // lives on free upper wood and reaches down, keeping its face in plain sight.
  const berth = spot(size * 1.35, [[.68, .22], [.32, .22], [.5, .28], [.8, .3], [.2, .3]], size * 1.35);
  const monsterAt = at(berth.x, berth.y, size);
  play(monster, smooth([{ transform: `${monsterAt} translateY(${unit * .25}px) scale(.15)`, opacity: 0 },
    { transform: monsterAt, opacity: 1, offset: .2 }, { transform: `${monsterAt} rotate(${inward * 8}deg)`, opacity: 1, offset: .65 },
    { transform: `${monsterAt} translateY(${unit * .25}px) scale(.15)`, opacity: 0 }]), { duration });
  const reaching = targets.length ? targets : [anchor];
  reaching.forEach((target, index) => {
    const start = { x: berth.x + (index - 1) * size * .1, y: berth.y + size * .18 }, end = { x: target.x, y: target.y };
    const dx = end.x - start.x, dy = end.y - start.y;
    const reach = Math.max(unit, Math.hypot(dx, dy)), height = Math.max(unit * .45, Math.min(reach / 3, unit * 1.6));
    const arm = add('tentacle', reach, height, premiumTentacleArt());
    arm.style.transformOrigin = '0 50%';
    const underside = dx < 0 ? ' scaleY(-1)' : '';
    const armAt = `translate(${start.x}px,${start.y - height / 2}px) rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)${underside}`;
    play(arm, smooth([{ transform: `${armAt} scaleX(.02)`, opacity: 0 },
      { transform: `${armAt} scaleX(.15)`, opacity: 1, offset: .18 },
      { transform: `${armAt} scaleX(1)`, opacity: 1, offset: .38 },
      { transform: `${armAt} scaleX(1)`, opacity: 1, offset: .6 },
      { transform: `${armAt} scaleX(.02)`, opacity: 0 }]), { duration: 2500, delay: index * 100 });
    if (target.node) {
      occlude(fx, target, duration, 900, 2900);
      const copy = drawSnapshot(fx, target); copy.host.dataset.taken = 'true';
      play(copy.host, smooth([{ transform: copy.place, opacity: 0 }, { transform: copy.place, opacity: 0, offset: .25 },
        { transform: copy.place, opacity: 1, offset: .3 }, { transform: `${copy.place} rotate(${-inward * 16}deg) scale(1.05)`, opacity: 1, offset: .46 },
        { transform: `translate(${berth.x - target.width / 2}px,${berth.y - target.height / 2}px) rotate(${inward * 95}deg) scale(.2)`, opacity: 0, offset: .8 }, { opacity: 0 }]), { duration });
    }
  });
  const inkSize = unit * 2.5, ink = add('ink', inkSize), inkAt = at(berth.x, berth.y, inkSize);
  play(ink, [{ transform: `${inkAt} scale(.1)`, opacity: 0 }, { transform: `${inkAt} scale(1)`, opacity: .85, offset: .2 },
    { transform: `${inkAt} scale(1.3)`, opacity: .65, offset: .6 }, { transform: `${inkAt} scale(1.6)`, opacity: 0 }], { duration: 1300, delay: 1900 });
}

function clock(fx) {
  const { add, play, unit, spot, box } = fx, duration = 3800;
  const freeze = woodenStage(fx); freeze.dataset.stage = 'freeze'; freeze.dataset.freezeFrom = '120'; freeze.dataset.freezeTo = '2120';
  play(freeze, [{ opacity: 0 }, { opacity: 1, offset: 120 / duration }, { opacity: 1, offset: 2120 / duration }, { opacity: 0, offset: 2420 / duration }, { opacity: 0 }], { duration, easing: 'linear' });
  snapshotTargets(fx.table).forEach(target => {
    const copy = drawSnapshot(fx, target);
    play(copy.host, [{ transform: copy.place, opacity: 0 }, { transform: copy.place, opacity: 1, offset: 120 / duration },
      { transform: copy.place, opacity: 1, offset: 2120 / duration }, { transform: copy.place, opacity: 0, offset: 2420 / duration }, { opacity: 0 }], { duration });
  });
  const cold = add('time-glass', box.width, box.height);
  play(cold, [{ opacity: 0 }, { opacity: .5, offset: 120 / duration }, { opacity: .5, offset: 2120 / duration }, { opacity: 0, offset: 2420 / duration }, { opacity: 0 }], { duration });
  const { x, y } = spot(unit * 2.4, middle), size = unit * 2.4, watch = add('clock', size, size, effectArt('clock')), place = at(x, y, size);
  const exit = { x: box.width + size, y: Math.min(box.height - unit * .7, y + unit * .6) };
  play(watch, smooth([{ transform: `${place} scale(.15) rotate(-20deg)`, opacity: 0 }, { transform: place, opacity: 1, offset: .12 },
    { transform: place, opacity: 1, offset: .66 }, { transform: `${place} translateY(${-unit * .25}px) scale(.7) rotate(25deg)`, opacity: 1, offset: .74 },
    { transform: `${at(exit.x, exit.y - unit * .3, size)} scale(.65) rotate(35deg)`, opacity: 0 }]), { duration });
  // Hands really hold still for the two-second visual time stop.
  for (const [selector, angle] of [['.hd-hand-m', 30], ['.hd-hand-h', -90]]) {
    const hand = watch.querySelector(selector);
    if (hand) play(hand, [{ transform: `rotate(${angle}deg)` }, { transform: `rotate(${angle}deg)`, offset: 2120 / duration }, { transform: `rotate(${angle + 1080}deg)` }], { duration });
  }
  const mouseSize = unit * 1.6, mouse = add('mouse', mouseSize, mouseSize, premiumMouseArt());
  mouse.dataset.arrivesAt = '2100';
  const mouseY = Math.min(box.height - mouseSize / 2, y + size * .45), start = at(-mouseSize, mouseY, mouseSize), near = at(x - size * .4, mouseY, mouseSize);
  play(mouse, smooth([{ transform: start, opacity: 0 }, { transform: start, opacity: 0, offset: 2100 / duration },
    { transform: `${near} rotate(-7deg)`, opacity: 1, offset: .68 }, { transform: `${near} rotate(5deg)`, opacity: 1, offset: .76 },
    { transform: `${at(exit.x, exit.y, mouseSize)} rotate(-5deg)`, opacity: 0 }]), { duration });
  burst(fx, x, y, { count: 20, size: unit * .065, colors: ['#fff2bc', '#c7b2ff', '#aedbe2'], reach: unit * 2, delay: 2200, duration: 1250, stagger: 7, drop: -unit * .4 });
}

function blackhole(fx) {
  const { add, play, unit, box, spot } = fx, duration = 3900;
  const { x, y } = spot(unit * 2.4, middle);
  const blackout = add('blackout', box.width, box.height); blackout.dataset.blackFrom = '1400'; blackout.dataset.blackTo = '2400';
  play(blackout, [{ opacity: 0 }, { opacity: 0, offset: 1000 / duration }, { opacity: 1, offset: 1400 / duration },
    { opacity: 1, offset: 2400 / duration }, { opacity: 0, offset: 3100 / duration }, { opacity: 0 }], { duration, easing: 'linear' });
  // A stationary void hides the live scene while its wooden double shrinks.
  // It stays behind the returning doubles until they exactly reach home.
  const voidStage = add('void', box.width, box.height);
  stageFade(fx, voidStage, duration, { from: duration * .08, until: duration * .94 });
  const wood = woodenStage(fx); wood.style.transformOrigin = `${x}px ${y}px`;
  play(wood, smooth([{ transform: 'scale(1) rotate(0deg)', opacity: 0 }, { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: .08 },
    { transform: 'scale(.01) rotate(210deg)', opacity: 1, offset: 1400 / duration },
    { transform: 'scale(.01) rotate(210deg)', opacity: 0, offset: 2400 / duration },
    { transform: 'scale(.01) rotate(210deg)', opacity: 1, offset: 2500 / duration },
    { transform: 'scale(1) rotate(360deg)', opacity: 1, offset: .93 }, { transform: 'scale(1) rotate(360deg)', opacity: 0 }]), { duration });
  snapshotTargets(fx.table).forEach((target, index) => {
    const copy = drawSnapshot(fx, target), into = `translate(${x - target.width / 2}px,${y - target.height / 2}px) scale(.01) rotate(${index % 2 ? 300 : -300}deg)`;
    play(copy.host, smooth([{ transform: copy.place, opacity: 0 }, { transform: copy.place, opacity: 1, offset: .08 },
      { transform: `${copy.place} translate(${(x - target.x) * .2}px,${(y - target.y) * .2}px) rotate(${index % 2 ? 30 : -30}deg)`, opacity: 1, offset: .2 },
      { transform: into, opacity: 0, offset: 1400 / duration }, { transform: into, opacity: 0, offset: 2400 / duration },
      { transform: into, opacity: 1, offset: 2500 / duration }, { transform: copy.place, opacity: 1, offset: .93 }, { transform: copy.place, opacity: 0 }]), { duration });
  });
  const size = unit * 3.2, hole = add('hole', size, size, effectArt('blackhole')), place = at(x, y, size);
  play(hole, smooth([{ transform: `${place} scale(.05) rotate(-30deg)`, opacity: 0 }, { transform: `${place} scale(1.2) rotate(30deg)`, opacity: 1, offset: .22 },
    { transform: `${place} scale(.05) rotate(150deg)`, opacity: 0, offset: 1400 / duration },
    { transform: `${place} scale(.05) rotate(150deg)`, opacity: 0, offset: 2400 / duration },
    { transform: `${place} scale(1.2) rotate(260deg)`, opacity: 1, offset: .72 }, { transform: `${place} scale(.02) rotate(360deg)`, opacity: 0 }]), { duration });
  burst(fx, x, y, { count: 28, size: unit * .065, colors: ['#ffe3a3', '#bd8fff', '#df914c'], reach: unit * 3.5, delay: 160, duration: 1120, stagger: 3, drop: unit * .2 });
}

// Reduced motion: the symbol only fades in and out where it would have played.
function quiet({ add, play, unit, spot }, effect) {
  const { x, y } = spot(unit * 1.2, middle);
  const symbol = add("quiet", unit, unit, effectArt(effect));
  symbol.style.transform = at(x, y, unit);
  play(symbol, [{ opacity: 0 }, { opacity: .9, offset: .25 }, { opacity: .9, offset: .7 }, { opacity: 0 }], { duration: 1000 });
}

const effects = { star, hammer, ufo, portal, dragon, kraken, clock, blackhole };

function randomFor(seed) {
  let value = 2166136261;
  for (const letter of String(seed)) value = Math.imul(value ^ letter.charCodeAt(0), 16777619) >>> 0;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}

// Reveal a blacked-out table before accepting a blind gameplay activation.
// This guard belongs only to that one pointer/key gesture, never to game time.
function revealActivation(event, table) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type === "keydown") {
    let timer;
    const release = () => {
      clearTimeout(timer);
      window.removeEventListener("keyup", releaseKey, true);
      window.removeEventListener("pointerdown", release, true);
      window.removeEventListener("pagehide", release);
    };
    const releaseKey = keyEvent => {
      if (keyEvent.key !== event.key) return;
      keyEvent.preventDefault(); keyEvent.stopImmediatePropagation(); release();
    };
    window.addEventListener("keyup", releaseKey, true);
    window.addEventListener("pointerdown", release, { capture: true, once: true });
    window.addEventListener("pagehide", release, { once: true });
    timer = setTimeout(release, 5000);
    return;
  }
  let timer;
  const release = () => {
    clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerup", afterRelease, true);
    window.removeEventListener("pointerdown", release, true);
    window.removeEventListener("keydown", release, true);
    window.removeEventListener("pointercancel", release, true);
    window.removeEventListener("pagehide", release);
  };
  const swallow = click => {
    if (table.contains(click.target)) { click.preventDefault(); click.stopImmediatePropagation(); }
    release();
  };
  const afterRelease = () => { clearTimeout(timer); timer = setTimeout(release, 160); };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerup", afterRelease, { capture: true, once: true });
  window.addEventListener("pointerdown", release, { capture: true, once: true });
  window.addEventListener("keydown", release, { capture: true, once: true });
  window.addEventListener("pointercancel", release, { capture: true, once: true });
  window.addEventListener("pagehide", release, { once: true });
  timer = setTimeout(release, 5000);
}

export function playTableSurprise(table, effect, { local = false, seed = effect, activePhase = "playing" } = {}) {
  active.get(table)?.();
  if (!table?.isConnected || !effects[effect] || document.hidden) return noop;
  const allowedPhases = new Set(Array.isArray(activePhase) ? activePhase : [activePhase]);
  if (table.dataset.phase && !allowedPhases.has(table.dataset.phase)) return noop;
  const layer = document.createElement("div");
  layer.className = "hd-surprise-layer";
  layer.dataset.effect = effect;
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  table.append(layer);
  const box = layer.getBoundingClientRect(), tableSize = table.getBoundingClientRect();
  if (!box.width || !box.height) { layer.remove(); return noop; }
  const screen = document.createElement("div");
  screen.className = "hd-surprise-screen";
  layer.append(screen);
  const own = [], timers = [], reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let done = false, observer = null, resize = null;
  const onVisibility = () => { if (document.hidden) cleanup(); };
  // A deliberate game action reveals the live objects without cutting off the
  // rare subject's story. Repeated taps on empty wood/props do neither.
  const revealScene = () => {
    layer.dataset.liveRevealed = "true";
    for (const node of layer.querySelectorAll("[data-source-kind], [data-stage='occlusion'], [data-stage='wood-stage'], [data-stage='freeze'], [data-stage='void'], [data-stage='blackout'], [data-stage='time-glass']")) {
      node.hidden = true;
      node.style.display = "none";
    }
  };
  const onInput = event => {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const target = event.target;
    if (target.closest?.(".hd-table-prop,.wt-decor-prop,.hd-surprise-layer")) return;
    if (!target.closest?.("#hausdeppHand,[data-wt-hand],button,a[href],input,select,textarea,[role='button'],summary")) return;
    const blackout = layer.querySelector("[data-stage='blackout']");
    const obscured = blackout && Number(getComputedStyle(blackout).opacity) > .2;
    const gameplay = target.closest?.("#hausdeppHand .hausdepp-card,#hausdeppStock,#hausdeppPile,.hd-stock-group>.hd-card-back,.hd-pile-group>.hausdepp-card,[data-wt-hand] .wt-hand-card,[data-watten-command],[data-watten-action]");
    if (gameplay && !layer.dataset.liveRevealed && obscured) revealActivation(event, table);
    revealScene();
  };
  const cleanup = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    observer?.disconnect(); resize?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", cleanup);
    window.removeEventListener("resize", cleanup);
    table.removeEventListener("pointerdown", onInput, true);
    table.removeEventListener("keydown", onInput, true);
    reduced.removeEventListener("change", cleanup);
    for (const animation of own) animation.cancel();
    layer.remove();
    if (active.get(table) === cleanup) active.delete(table);
  };
  active.set(table, cleanup);
  const add = (kind, width, height = width, html = "") => {
    const node = document.createElement("div");
    node.className = `hd-surprise-node hd-surprise-${kind}`;
    node.dataset.stage = kind;
    node.setAttribute("aria-hidden", "true");
    node.style.width = `${Math.max(1, width).toFixed(1)}px`;
    node.style.height = `${Math.max(1, height).toFixed(1)}px`;
    node.innerHTML = html;
    // Only the one-second singularity blackout covers names and controls.
    (kind === "blackout" ? layer : screen).append(node);
    return node;
  };
  const play = (node, frames, options) => {
    if (!node) return;
    const animation = node.animate(frames, { fill: "both", ...options });
    own.push(animation);
    return animation;
  };
  const unit = Math.round(Math.max(40, Math.min(76, Math.min(box.width, box.height) * .14)));
  const fx = { table, box, add, play, unit, local, timers, random: randomFor(`${effect}:${seed}`), rich: box.width >= 700, spot: (...args) => freeSpot(table, box, ...args) };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("resize", cleanup);
  table.addEventListener("pointerdown", onInput, { capture: true, passive: false });
  table.addEventListener("keydown", onInput, true);
  reduced.addEventListener("change", cleanup);
  // Remote turns keep running beneath this short theatre. They must not cut
  // off the mouse's late entrance. Local input only reveals the live scene.
  // The round owner also invokes cleanup when its round key changes.
  observer = new MutationObserver(() => {
    if (!table.isConnected || (table.dataset.phase && !allowedPhases.has(table.dataset.phase))) cleanup();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-phase"] });
  resize = new ResizeObserver(() => {
    const next = table.getBoundingClientRect();
    if (Math.abs(next.width - tableSize.width) > 1 || Math.abs(next.height - tableSize.height) > 1) cleanup();
  });
  resize.observe(table);
  // Decode only this subject before the first frame. A late image never
  // restarts an abandoned table or a story already retired by lifecycle.
  warmSurpriseArt(effect).then(ready => {
    if (!ready) { cleanup(); return; }
    if (done || !table.isConnected || document.hidden) return;
    if (reduced.matches) quiet(fx, effect);
    else {
      protectControls(screen, table, box);
      effects[effect](fx);
    }
    if (layer.dataset.liveRevealed) revealScene();
    Promise.all(own.map(animation => animation.finished)).then(cleanup, cleanup);
  }).catch(cleanup);
  return cleanup;
}
