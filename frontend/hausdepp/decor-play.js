// Small, local table surprises. Effects stay inside a collision-checked patch
// of free wood; they never receive input or outlive their table round.
const clothArt = '<svg viewBox="0 0 80 60" aria-hidden="true"><path d="M9 14Q26 2 44 9L70 17 65 49Q49 56 32 48L7 43Z" fill="#d4d0b8" stroke="#8e9585" stroke-width="2"/><path d="m14 20 48 12m-49 0 45 11M25 13l-4 30m20-29-5 32m21-27-6 30" stroke="#6c8276" stroke-width="3" opacity=".65"/><path d="m10 41 23 6 17-1 16 3" fill="none" stroke="#f1ebd8" stroke-width="3"/></svg>';

function transient(state, node, frames, options) {
  state.effects ||= new Set();
  const finish = () => {
    for (const child of node.getAnimations({ subtree: true })) child.cancel();
    node.remove();
    state.effects.delete(node);
  };
  node._finish = finish;
  state.effects.add(node);
  node.animate(frames, options).finished.catch(() => {}).finally(finish);
  return node;
}

export function clearTableEffects(state) {
  state.surpriseCleanup?.();
  state.surpriseCleanup = null;
  for (const node of [...(state.effects || [])]) node._finish();
  // Short-lived captions and crumbs use their own completion handlers.
  for (const node of state.layer.querySelectorAll('.hd-prop-caption, .hd-prop-crumb:not(.hd-prop-leftover), .hd-prop-ripple')) {
    for (const animation of node.getAnimations()) animation.cancel();
    node.remove();
  }
}

export function wipeSpill(table, state, sprite, color, amount, fits) {
  if (amount <= 0 || state.reduced.matches || document.hidden) return;
  sprite._spillEffect?._finish();
  // Bound repeated tapping across several glasses as well as one glass.
  const spills = [...(state.effects || [])].filter(node => node.classList.contains('hd-prop-spill'));
  if (spills.length >= 3) spills[0]._finish();
  const bounds = table.getBoundingClientRect();
  const rect = sprite.getBoundingClientRect();
  let width = Math.min(rect.width * (1 + amount * .12), 185);
  let height = width * .65;
  let left = rect.left + (rect.width - width) / 2;
  let top = rect.top + rect.height * .35;
  if (!fits({ left, top, right: left + width, bottom: top + height })) {
    width = rect.width * .8; height = rect.height * .48;
    left = rect.left + rect.width * .1; top = rect.top + rect.height * .4;
    if (!fits({ left, top, right: left + width, bottom: top + height })) return;
  }
  const patch = document.createElement('span');
  patch.className = 'hd-prop-spill';
  patch.setAttribute('aria-hidden', 'true');
  patch.style.cssText = `left:${left - bounds.left}px;top:${top - bounds.top}px;width:${width}px;height:${height}px;--spill-color:${color}`;
  patch.innerHTML = `<span class="hd-prop-puddle"></span><span class="hd-prop-cloth">${clothArt}</span>`;
  state.layer.prepend(patch);
  sprite._spillEffect = patch;
  transient(state, patch, [{ opacity: 1 }, { opacity: 1, offset: .94 }, { opacity: 0 }], { duration: 3800 });
  patch.querySelector('.hd-prop-puddle').animate([
    { transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1)', opacity: .65, offset: .08 },
    { transform: 'scale(1)', opacity: .6, offset: .4 }, { transform: 'scale(.7,1)', opacity: .2, offset: .72 },
    { transform: 'scale(.3,1)', opacity: 0, offset: .9 }, { opacity: 0 },
  ], { duration: 3600, fill: 'forwards', easing: 'ease-out' });
  patch.querySelector('.hd-prop-cloth').animate([
    { transform: 'translate(-120%,5%) rotate(-12deg)', opacity: 0 },
    { transform: 'translate(-120%,5%) rotate(-12deg)', opacity: 0, offset: .3 },
    { transform: 'translate(-20%,0) rotate(10deg)', opacity: 1, offset: .42 },
    { transform: 'translate(105%,15%) rotate(-14deg)', opacity: 1, offset: .57 },
    { transform: 'translate(0,35%) rotate(12deg)', opacity: 1, offset: .71 },
    { transform: 'translate(125%,20%) rotate(-8deg)', opacity: 1, offset: .86 },
    { transform: 'translate(210%,10%) rotate(10deg)', opacity: 0 },
  ], { duration: 3600, fill: 'forwards', easing: 'ease-in-out' });
}

export function leaveGlassRing(table, state, sprite, fits) {
  if (state.reduced.matches || Number(sprite.dataset.level ?? 4) === 0) return;
  const rect = sprite.getBoundingClientRect();
  const bounds = table.getBoundingClientRect();
  const width = rect.width * .48, height = rect.height * .23;
  const left = rect.left + rect.width * .2, top = rect.top + rect.height * .66;
  if (!fits({ left, top, right: left + width, bottom: top + height })) return;
  const rings = [...(state.effects || [])].filter(node => node.classList.contains('hd-prop-glass-ring'));
  if (rings.length >= 3) rings[0]._finish();
  const ring = document.createElement('span');
  ring.className = 'hd-prop-glass-ring';
  ring.setAttribute('aria-hidden', 'true');
  ring.style.cssText = `left:${left - bounds.left}px;top:${top - bounds.top}px;width:${width}px;height:${height}px`;
  state.layer.prepend(ring);
  transient(state, ring, [{ opacity: .25 }, { opacity: .18, offset: .6 }, { opacity: 0 }], { duration: 16000 });
}

// Four downstrokes per group; the fifth crosses them.
function tallyStroke(index) {
  const group = Math.floor(index / 5), within = index % 5;
  const x = 22 + group % 2 * 33, y = 22 + Math.floor(group / 2) * 30;
  return within === 4 ? [x - 3, y + 18, 27, -16] : [x + within * 6, y, -2, 20];
}

function coasterFace(count, worn) {
  const ink = 'fill="none" stroke="#4d4b41" stroke-linecap="round" stroke-width="1.8"';
  let strokes = '', used = '';
  for (let index = 0; index < count; index++) {
    const [x, y, dx, dy] = tallyStroke(index);
    strokes += `<path d="M${x} ${y}l${dx} ${dy}"/>`;
  }
  // The used side turning away is drawn without paths, so the path count always equals the tally.
  for (let index = 0; index < worn; index++) {
    const [x, y, dx, dy] = tallyStroke(index);
    used += `<line x1="${x}" y1="${y}" x2="${x + dx}" y2="${y + dy}"/>`;
  }
  return `<svg class="hd-prop-tally" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#d6c5a0" stroke="#a68d5d" stroke-width="2"/><circle cx="50" cy="50" r="40" fill="#e8dbbc" stroke="#baa77c" stroke-dasharray="1 3"/><g ${ink}>${strokes}</g>${used && `<g class="hd-prop-tally-worn" opacity="0" ${ink}>${used}</g>`}</svg>`;
}

export function markCoaster(sprite) {
  const tally = Number(sprite.dataset.tally || 0);
  const next = tally >= 20 ? 0 : tally + 1;
  sprite.dataset.tally = String(next);
  const art = sprite.firstElementChild;
  const face = art.querySelector('.hd-prop-tally');
  // A quick tap settles an unfinished turn before the pencil touches the clean side.
  if (face?.querySelector('.hd-prop-tally-worn')) {
    for (const animation of face.getAnimations({ subtree: true })) animation.finish();
    face.querySelector('.hd-prop-tally-worn')?.remove();
  }
  // Mounting and reduced motion show the result at once; only a visible tap animates.
  const animate = face && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden;
  const ink = face?.querySelector('g');
  if (next && ink?.childElementCount === tally) {
    const [x, y, dx, dy] = tallyStroke(tally);
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    stroke.setAttribute('d', `M${x} ${y}l${dx} ${dy}`);
    ink.append(stroke);
    // Earlier strokes stay untouched; only the new one is pencilled in.
    const length = Math.hypot(dx, dy), dash = `${length} ${length + 4}`;
    if (animate) stroke.animate({ strokeDasharray: [dash, dash], strokeDashoffset: [length, 0] }, { duration: 230, easing: 'cubic-bezier(.35,0,.25,1)' });
    return next;
  }
  const turn = animate && !next;
  art.innerHTML = coasterFace(next, turn ? Math.min(tally, 20) : 0);
  if (turn) {
    // The coaster turns within its own footprint; the used side drops out when edge-on.
    const card = art.querySelector('.hd-prop-tally'), worn = card.lastElementChild;
    const timing = { duration: 440, easing: 'ease-in-out' };
    card.animate([{ transform: 'none' }, { transform: 'scale(.04,.96) rotate(-5deg)' }, { transform: 'none' }], timing);
    worn.animate([{ opacity: 1 }, { opacity: 1, offset: .5 }, { opacity: 0, offset: .5 }, { opacity: 0 }], timing)
      .finished.catch(() => {}).finally(() => worn.remove());
  }
  return next;
}
