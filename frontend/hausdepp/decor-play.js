// Small, local table surprises. Effects stay inside a collision-checked patch
// of free wood. Only the cloth receives input; nothing outlives its table round.
const clothArt = '<svg viewBox="0 0 80 60" aria-hidden="true"><path d="M9 14Q26 2 44 9L70 17 65 49Q49 56 32 48L7 43Z" fill="#d4d0b8" stroke="#8e9585" stroke-width="2"/><path d="m14 20 48 12m-49 0 45 11M25 13l-4 30m20-29-5 32m21-27-6 30" stroke="#6c8276" stroke-width="3" opacity=".65"/><path d="m10 41 23 6 17-1 16 3" fill="none" stroke="#f1ebd8" stroke-width="3"/></svg>';
const copy = value => window.ZDWA_I18N?.t?.(value) || value;
let spillSerial = 0;

export function schedulePropEffect(state, callback, delay, onCancel = () => {}) {
  state.propTimers ||= new Set();
  const entry = { cancel: () => {
    clearTimeout(entry.timer);
    state.propTimers.delete(entry);
    onCancel();
  } };
  entry.timer = setTimeout(() => {
    state.propTimers.delete(entry);
    callback();
  }, delay);
  state.propTimers.add(entry);
  return entry.cancel;
}

export function mountCanDetails(art) {
  const details = document.createElement('span');
  details.className = 'hd-can-details';
  details.setAttribute('aria-hidden', 'true');
  details.innerHTML = '<svg class="hd-can-opening" viewBox="0 0 100 100"><ellipse cx="44" cy="27" rx="7" ry="4.5" fill="#18221e" stroke="#8e9994" stroke-width=".8"/><path d="M41 23q-5-8 2-10t8 8l-5 3z" fill="#aab4ad" stroke="#53635a" stroke-width=".7"/><ellipse cx="45" cy="18" rx="2.2" ry="3" fill="#425148"/></svg>'
    + '<svg class="hd-can-foam" viewBox="0 0 100 100"><g fill="#fff4d5" stroke="#d6bc86" stroke-width=".4"><path d="M25 29q-4 12 1 23t6-4l-1-15h29l-1 16q4 9 7-1l-1-20z"/><ellipse cx="45" cy="26" rx="22" ry="11"/><circle cx="28" cy="22" r="6"/><circle cx="37" cy="17" r="7"/><circle cx="49" cy="17" r="8"/><circle cx="59" cy="22" r="7"/></g><g fill="#fffdf0"><circle cx="34" cy="22" r="2"/><circle cx="45" cy="16" r="2.5"/><circle cx="56" cy="24" r="1.8"/></g></svg>'
    + '<svg class="hd-can-burst" viewBox="0 0 100 100"><defs><linearGradient id="hdBurstCanMetal"><stop stop-color="#173c2c"/><stop offset=".35" stop-color="#3e7655"/><stop offset=".7" stop-color="#164632"/><stop offset="1" stop-color="#0b291d"/></linearGradient><linearGradient id="hdBurstCanRim"><stop stop-color="#647870"/><stop offset=".5" stop-color="#d5dbd4"/><stop offset="1" stop-color="#73867b"/></linearGradient><clipPath id="hdBurstCanBody"><path d="M24 25l7 2 3-10 8 9 8-11 5 9 10-7 2 13 6-1-3 17 5 16-7 8 1 13q-22 12-44-1l2-19-7-12 8-8z"/></clipPath></defs><path d="M24 25l7 2 3-10 8 9 8-11 5 9 10-7 2 13 6-1-3 17 5 16-7 8 1 13q-22 12-44-1l2-19-7-12 8-8z" fill="url(#hdBurstCanMetal)" stroke="#173e2c" stroke-width="1"/><g clip-path="url(#hdBurstCanBody)"><image href="/static/hausdepp-table-props-v1.webp" x="-100" y="0" width="200" height="200" transform="matrix(1 0 -.05 .88 2 8)"/></g><path d="M24 25l7 2 3-10 8 9 8-11 5 9 10-7 2 13 6-1-3 17-10-8-7 5-9-9-6 8-10-5z" fill="url(#hdBurstCanRim)" stroke="#52675b" stroke-width=".7"/><path d="m30 30 6 12-5 23 6 14m29-44-8 12 5 26-8 10m-27-2q20 7 40 0" fill="none" stroke="#b1c0ab" stroke-opacity=".55" stroke-width="1.3"/></svg>';
  art.append(details);
}

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
  for (const entry of [...(state.propTimers || [])]) entry.cancel();
  for (const node of state.nodes?.values() || []) node._cancelDrag?.();
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
  let width = Math.max(64, Math.min(rect.width * (1 + amount * .12), 185));
  let height = Math.max(56, width * .65);
  let left = rect.left + (rect.width - width) / 2;
  let top = rect.top + rect.height * .35;
  if (!fits({ left, top, right: left + width, bottom: top + height })) {
    width = Math.max(56, rect.width * .8); height = Math.max(48, rect.height * .48);
    left = rect.left + (rect.width - width) / 2; top = rect.top + (rect.height - height) / 2;
    if (!fits({ left, top, right: left + width, bottom: top + height })) {
      width = 44; height = 44;
      left = rect.left + (rect.width - width) / 2; top = rect.top + (rect.height - height) / 2;
      if (!fits({ left, top, right: left + width, bottom: top + height })) return;
    }
  }
  const patch = document.createElement('span');
  patch.className = 'hd-prop-spill';
  patch.dataset.source = sprite.dataset.prop;
  patch.dataset.cleaned = '0';
  patch.dataset.wipeState = 'waiting';
  patch.style.cssText = `left:${left - bounds.left}px;top:${top - bounds.top}px;width:${width}px;height:${height}px;--spill-color:${color}`;
  const id = `hdSpill${++spillSerial}`;
  patch.innerHTML = `<span class="hd-prop-puddle" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><radialGradient id="${id}Color" cx=".4" cy=".3" r=".7"><stop stop-color="#fff0c0" stop-opacity=".45"/><stop offset=".42" stop-color="${color}"/><stop offset="1" stop-color="#9c7439"/></radialGradient><mask id="${id}"><rect width="100" height="100" fill="white"/><path class="hd-prop-wipe-trail" fill="none" stroke="black" stroke-width="29" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><path d="M9 47Q0 26 27 19Q45 7 63 22Q94 14 92 39Q106 60 82 74Q64 91 46 77Q18 91 9 69Q0 59 9 47Z" fill="url(#${id}Color)" stroke="#fff0c0" stroke-opacity=".38" stroke-width=".7" mask="url(#${id})"/></svg></span><button type="button" class="hd-prop-cloth">${clothArt}</button>`;
  state.layer.append(patch);
  sprite._spillEffect = patch;
  const cloth = patch.querySelector('.hd-prop-cloth');
  const puddle = patch.querySelector('.hd-prop-puddle');
  const trail = patch.querySelector('.hd-prop-wipe-trail');
  const events = new AbortController();
  const listen = (name, callback) => cloth.addEventListener(name, callback, { signal: events.signal });
  let start = null, clean = 0, x = 0, y = 0, ignoreClick = false;
  const points = [];
  const stopDrag = () => {
    if (start && cloth.hasPointerCapture?.(start.id)) cloth.releasePointerCapture(start.id);
    start = null;
    cloth.dataset.dragging = 'false';
    if (patch.isConnected && clean < 1) patch.dataset.wipeState = 'waiting';
  };
  const finish = (restoreFocus = false) => {
    const focused = document.activeElement === cloth;
    stopDrag(); events.abort();
    for (const animation of patch.getAnimations({ subtree: true })) animation.cancel();
    patch.remove(); state.effects.delete(patch);
    if (sprite._spillEffect === patch) sprite._spillEffect = null;
    if (restoreFocus && focused && sprite.isConnected && !sprite.hidden && !sprite.disabled) sprite.focus({ preventScroll: true });
  };
  patch._finish = finish;
  state.effects ||= new Set();
  state.effects.add(patch);
  const wipe = (amount, point) => {
    clean = Math.min(1, clean + amount);
    patch.dataset.cleaned = String(Math.round(clean * 100));
    cloth.setAttribute('aria-label', `${copy('Pfütze aufwischen')} – ${Math.round(clean * 100)}%`);
    cloth.title = copy('Pfütze aufwischen');
    puddle.style.opacity = String(.62 * (1 - clean * .75));
    if (point) {
      points.push(`${point[0].toFixed(1)} ${point[1].toFixed(1)}`);
      if (points.length > 96) points.shift();
      trail.setAttribute('d', `M${points.join('L')}`);
    }
    if (clean >= 1) { patch.dataset.wipeState = 'clean'; finish(true); }
  };
  wipe(0);
  listen('pointerdown', event => {
    if (event.button > 0 || state.reduced.matches || document.hidden) return;
    // Keep even a fast first mouse step that leaves the small cloth hit box.
    cloth.setPointerCapture?.(event.pointerId);
    const area = patch.getBoundingClientRect();
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, left: x, top: y, dragging: false,
      pointX: Math.max(0, Math.min(width, event.clientX - area.left)),
      pointY: Math.max(0, Math.min(height, event.clientY - area.top)) };
  });
  listen('pointermove', event => {
    if (!start || start.id !== event.pointerId) return;
    if (state.reduced.matches || document.hidden) { stopDrag(); return; }
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.dragging) {
      if (Math.hypot(dx, dy) < 7) return;
      start.dragging = true;
      cloth.setPointerCapture?.(event.pointerId);
      cloth.dataset.dragging = 'true';
      patch.dataset.wipeState = 'wiping';
    }
    const nextX = Math.max(0, Math.min(width - 44, start.left + dx));
    const nextY = Math.max(0, Math.min(height - 44, start.top + dy));
    const area = patch.getBoundingClientRect();
    const pointX = Math.max(0, Math.min(width, event.clientX - area.left));
    const pointY = Math.max(0, Math.min(height, event.clientY - area.top));
    // Count the finger's path across the patch, including a 44px patch whose
    // equally large hit target cannot translate any further inside it.
    const distance = Math.hypot(pointX - start.pointX, pointY - start.pointY);
    start.pointX = pointX; start.pointY = pointY;
    x = nextX; y = nextY;
    cloth.style.translate = `${x}px ${y}px`;
    if (width === 44 && height === 44) {
      cloth.firstElementChild.style.transform = `translate(${(pointX - 22) * .12}px,${(pointY - 22) * .12}px) rotate(${(pointX - 22) * .25}deg)`;
    }
    if (distance) wipe(distance / (width * 1.5), [pointX / width * 100, pointY / height * 100]);
  });
  for (const type of ['pointerup', 'pointercancel']) listen(type, () => {
    if (start?.dragging) {
      ignoreClick = true;
      setTimeout(() => { ignoreClick = false; }, 0);
    }
    stopDrag();
  });
  listen('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (ignoreClick) { ignoreClick = false; return; }
    if (!state.reduced.matches && !document.hidden) {
      cloth.firstElementChild.animate([{ rotate: '0deg' }, { rotate: '7deg' }, { rotate: '-5deg' }, { rotate: '0deg' }], { duration: 220 });
      wipe(.25);
    }
  });
  return patch;
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
