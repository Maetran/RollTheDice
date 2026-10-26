// Inert visual doubles. Never move, hide, pause or restyle a live game node.
const painted = ['display', 'box-sizing', 'overflow', 'border-radius', 'border', 'box-shadow', 'background', 'background-image', 'background-size', 'background-position', 'background-repeat', 'color', 'font', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'text-align', 'text-shadow', 'padding', 'margin', 'opacity', 'filter', 'clip-path', 'mask-image', 'mask-size', 'mask-position', 'mix-blend-mode', 'object-fit', 'object-position', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'visibility'];
const layout = ['position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'transform', 'transform-origin', 'translate', 'rotate', 'scale', 'z-index', 'flex', 'flex-direction', 'align-items', 'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows'];
let serial = 0;
const handSelector = '#hausdeppHand,[data-wt-hand]';
const cardSelector = '.hausdepp-card,.wt-hand-card';
const rareEffects = new Set(['star', 'hammer', 'ufo', 'portal', 'dragon', 'kraken', 'clock', 'blackhole']);
const hausdeppTargets = '#hausdeppHand .hausdepp-card, .hd-pile-group .hd-pile-face, .hd-pile-group > .hausdepp-card, .hd-stock-group > .hd-card-back, .hd-opponent-hand, #hausdeppBurnedStack:not(.is-empty), .hd-table-prop:not([hidden])';
const wattenTargets = '[data-wt-hand] > .wt-hand-card,.wt-trick-card,.wt-backs,.wt-stock,.wt-taken-packet,[data-wt-reference] .wt-card';
const isWatten = table => table.matches('[data-wt-table]');
const opticalBox = table => (table.querySelector('.hd-surprise-layer') || table).getBoundingClientRect();
const handClip = (hand, box) => {
  if (!hand) return box;
  if (!hand.matches('[data-wt-hand]')) return hand.getBoundingClientRect();
  const style = getComputedStyle(hand);
  return [style.overflowX, style.overflowY].some(value => value !== 'visible') ? hand.getBoundingClientRect() : box;
};
const visible = node => {
  // Fixed descendants of a closed details can still expose layout bounds.
  // Only its summary is painted; their controls must not punch phantom holes.
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS' && !parent.open) {
      const summary = [...parent.children].find(child => child.tagName === 'SUMMARY');
      if (!summary?.contains(node)) return false;
    }
  }
  if (node.closest('[hidden]')) return false;
  const box = node.getBoundingClientRect(), style = getComputedStyle(node);
  return box.width > 2 && box.height > 2 && style.display !== 'none' && style.visibility !== 'hidden';
};

export function snapshotTargets(table, { limit = 24, only = null, groupHand = true } = {}) {
  const box = opticalBox(table), hand = table.querySelector(handSelector);
  const handCards = hand?.querySelectorAll(cardSelector).length || 0;
  let nodes = [...table.querySelectorAll(isWatten(table) ? wattenTargets : hausdeppTargets)];
  // Watten's local props live in a sibling fixed layer. Never search the whole
  // document: another mounted preview or table must not leak into this scene.
  if (isWatten(table)) nodes.push(...(table.closest('#wattenApp')?.querySelectorAll('[data-watten-decor-layer] > .wt-decor-prop:not(.wt-decor-prop--rare)') || []));
  nodes = nodes.filter(node => !node.closest('.hd-surprise-layer')
    && !node.matches('.hd-table-prop--small:has([data-sheet="surprise"])')
    && !rareEffects.has(node.dataset.prop || node.dataset.wattenDecorKind) && visible(node));
  if (groupHand && handCards > 7) nodes = nodes.filter(node => !hand.contains(node)).concat(hand);
  nodes = nodes.filter(node => {
    if (node.matches('.hd-opponent-hand') && !node.querySelector('.hd-opponent-card')) return false;
    if (node.matches('.hd-card-back.is-empty')) return false;
    if (node.matches('.wt-backs') && ![...node.children].some(child => visible(child))) return false;
    const rect = node.getBoundingClientRect(), clip = node !== hand && hand?.contains(node) ? handClip(hand, box) : box;
    return Math.min(rect.right, clip.right, box.right) - Math.max(rect.left, clip.left, box.left) > 2
      && Math.min(rect.bottom, clip.bottom, box.bottom) - Math.max(rect.top, clip.top, box.top) > 2;
  });
  return nodes.map(node => {
    const rect = node.getBoundingClientRect();
    const kind = node.id === 'hausdeppBurnedStack' ? 'burned' : node.matches('.hd-table-prop,.wt-decor-prop') ? 'prop' : 'card';
    return { node, kind, prop: node.dataset.prop || node.dataset.wattenDecorKind || '', left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height,
      x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 };
  }).filter(target => !only || only(target)).slice(0, limit);
}

// A card's axis-aligned wood patch would also erase its overlapping neighbours.
// Reconstruct the visible hand once, preserving layout while its chosen cards
// travel. Only this optical copy omits them; the live hand is never touched.
export function handTransferCluster(table, targets) {
  const hand = table.querySelector(handSelector);
  if (!hand) return null;
  const movingNodes = targets.filter(target => target.node !== hand && hand.contains(target.node)).map(target => target.node);
  if (!movingNodes.length) return null;
  const box = opticalBox(table), viewport = hand.getBoundingClientRect(), clip = handClip(hand, box);
  const cards = [...hand.querySelectorAll(cardSelector)].map(node => node.getBoundingClientRect())
    .map(rect => ({ left: Math.max(rect.left, clip.left, box.left), right: Math.min(rect.right, clip.right, box.right),
      top: Math.max(rect.top, clip.top, box.top), bottom: Math.min(rect.bottom, clip.bottom, box.bottom) }))
    .filter(rect => rect.right > rect.left && rect.bottom > rect.top);
  if (!cards.length) return null;
  const left = Math.max(box.left, Math.min(...cards.map(rect => rect.left)) - 6) - box.left;
  const top = Math.max(box.top, Math.min(...cards.map(rect => rect.top)) - 6) - box.top;
  const right = Math.min(box.right, Math.max(...cards.map(rect => rect.right)) + 6) - box.left;
  const bottom = Math.min(box.bottom, Math.max(...cards.map(rect => rect.bottom)) + 6) - box.top;
  return { movingNodes, target: { node: hand, kind: 'card', prop: '', left, top, width: right - left, height: bottom - top,
    x: (left + right) / 2, y: (top + bottom) / 2,
    sourceRect: { left: viewport.left - box.left, top: viewport.top - box.top, width: viewport.width, height: viewport.height } } };
}

export function drawSnapshot(fx, target, { omitNodes = [] } = {}) {
  const host = fx.add('snapshot', target.width, target.height);
  host.dataset.sourceKind = target.kind;
  if (target.node.matches(handSelector) || target.node.closest(handSelector)) host.dataset.fromHand = 'true';
  host.inert = true;
  host.style.transform = `translate(${target.left}px,${target.top}px)`;
  // Closed shadow scopes keep SVG paint-server identifiers private and prevent
  // any game CSS, delegated selectors or accessibility controls seeing doubles.
  const shadow = host.attachShadow({ mode: 'closed' });
  const copy = target.node.cloneNode(true), originals = [target.node, ...target.node.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
  const prefix = `surprise-paint-${++serial}-`, ids = new Map();
  for (const node of copies) if (node.id) ids.set(node.id, `${prefix}${ids.size}`);
  originals.forEach((node, index) => {
    const clone = copies[index], style = getComputedStyle(node);
    for (const name of [...painted, ...layout]) clone.style.setProperty(name, style.getPropertyValue(name));
    for (const attr of [...clone.attributes]) {
      if (/^(?:on|aria-|data-)/i.test(attr.name) || ['id', 'name', 'value', 'title', 'role', 'tabindex', 'autofocus', 'contenteditable', 'form'].includes(attr.name)) clone.removeAttribute(attr.name);
    }
    if (node.id && node.namespaceURI === 'http://www.w3.org/2000/svg') clone.id = ids.get(node.id);
    for (const attr of [...clone.attributes]) {
      let value = attr.value;
      for (const [id, replacement] of ids) value = value.replaceAll(`url("#${id}")`, `url("#${replacement}")`).replaceAll(`url(#${id})`, `url(#${replacement})`).replaceAll(`url('${id}')`, `url('${replacement}')`);
      // Computed SVG fills can resolve a paint URL to the document's full URL.
      value = value.replace(/url\(["']?[^)]*#([^)'" ]+)["']?\)/g, (whole, id) => ids.has(id) ? `url(#${ids.get(id)})` : whole);
      if (attr.name === 'href' && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
      clone.setAttribute(attr.name, value);
    }
    clone.style.setProperty('pointer-events', 'none', 'important');
    clone.style.setProperty('animation', 'none', 'important');
    clone.style.setProperty('transition', 'none', 'important');
    // Freeze photographic highlights and already scorched card edges too.
    // Pseudo-elements do not participate in cloneNode's visual tree.
    if (node.namespaceURI === 'http://www.w3.org/1999/xhtml') for (const pseudo of ['::before', '::after']) {
      const paint = getComputedStyle(node, pseudo), content = paint.content;
      if (!content || content === 'none' || content === 'normal' || paint.display === 'none') continue;
      const decoration = document.createElement('span');
      for (const name of [...painted, ...layout]) decoration.style.setProperty(name, paint.getPropertyValue(name));
      decoration.style.pointerEvents = 'none';
      if (content !== '""' && content !== "''") decoration.textContent = content.slice(1, -1);
      if (pseudo === '::before') clone.prepend(decoration); else clone.append(decoration);
    }
  });
  const style = getComputedStyle(target.node);
  const sourceRect = target.sourceRect || target;
  copy.style.position = 'absolute'; copy.style.inset = 'auto';
  copy.style.left = `${sourceRect.left - target.left + sourceRect.width / 2}px`;
  copy.style.top = `${sourceRect.top - target.top + sourceRect.height / 2}px`;
  copy.style.margin = '0';
  copy.style.width = style.width; copy.style.height = style.height; copy.style.minWidth = '0'; copy.style.maxWidth = 'none'; copy.style.minHeight = '0'; copy.style.maxHeight = 'none';
  copy.style.translate = 'none'; copy.style.rotate = 'none'; copy.style.scale = 'none'; copy.style.transformOrigin = '50% 50%';
  if (isWatten(fx.table)) {
    // Separate rotate is used by the opponent fans; own cards rotate around a
    // pivot below their edge. The measured rectangle already includes that
    // displacement. Preserve its linear pose, centred on the painted bounds,
    // without applying the original CSS translation a second time.
    const scale = style.scale === 'none' ? [1, 1] : style.scale.split(' ').map(Number);
    const pose = new DOMMatrix().rotate(Number.parseFloat(style.rotate) || 0)
      .scale(scale[0], scale[1] ?? scale[0]).multiply(new DOMMatrix(style.transform === 'none' ? undefined : style.transform));
    pose.e = 0; pose.f = 0;
    copy.style.transform = `translate(-50%,-50%) ${pose.toString()}`;
  } else copy.style.transform = `translate(-50%,-50%) ${style.transform === 'none' ? '' : style.transform}`;
  for (const node of omitNodes) {
    const index = originals.indexOf(node);
    if (index >= 0) copies[index].style.setProperty('opacity', '0', 'important');
  }
  shadow.append(copy);
  originals.forEach((node, index) => { copies[index].scrollLeft = node.scrollLeft; copies[index].scrollTop = node.scrollTop; });
  return { ...target, host, place: `translate(${target.left.toFixed(1)}px,${target.top.toFixed(1)}px)` };
}

export function paintTableWood(fx, node, left = 0, top = 0) {
  const paint = document.createElement('span');
  paint.className = 'hd-surprise-wood-paint';
  paint.setAttribute('aria-hidden', 'true');
  Object.assign(paint.style, { position: 'absolute', pointerEvents: 'none' });
  const carving = isWatten(fx.table) ? getComputedStyle(fx.table, '::before') : null;
  if (carving && carving.borderImageSource !== 'none') {
    // The real Watten surface is a nine-slice, filled border-image on the
    // table's pseudo-element. Repaint that exact viewport-sized surface and
    // crop it, so optical gaps keep the same grain and carved frame.
    const table = fx.table.getBoundingClientRect();
    for (const name of ['box-sizing', 'width', 'height', 'border', 'border-image', 'background', 'border-radius'])
      paint.style.setProperty(name, carving.getPropertyValue(name));
    paint.style.left = `${table.left - fx.box.left - left + (Number.parseFloat(carving.left) || 0)}px`;
    paint.style.top = `${table.top - fx.box.top - top + (Number.parseFloat(carving.top) || 0)}px`;
  } else {
    let source = fx.table;
    while (source.parentElement && getComputedStyle(source).backgroundImage === 'none') source = source.parentElement;
    const style = getComputedStyle(source), rect = source.getBoundingClientRect();
    Object.assign(paint.style, {
      left: `${rect.left - fx.box.left - left}px`, top: `${rect.top - fx.box.top - top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      background: style.backgroundImage === 'none'
        ? '#35271f url("/static/zilch-wood-table-v1.jpg") center / 1024px' : style.background,
    });
  }
  // Preserve the ancestor's full background geometry, including lighting
  // gradients. Cropping a fresh centred tile would expose a rectangular seam.
  node.style.overflow = 'hidden';
  node.style.background = 'none';
  node.style.boxShadow = 'none';
  node.append(paint);
  return node;
}

export function woodenStage(fx) {
  const stage = fx.add('wood-stage', fx.box.width, fx.box.height);
  paintTableWood(fx, stage);
  return stage;
}

export function protectControls(layer, table, box) {
  const selectors = '.hd-room-heading,.hd-seat-plate,.hd-seat-avatar,.hd-hand-heading,#hausdeppStatus,#hausdeppEvent,.hd-actions,.hd-hand-actions,#hausdeppPeek:not([hidden]),#hausdeppResult:not([hidden]),.hd-action-error:not(:empty),button:not(.hausdepp-card):not(.wt-hand-card):not(.hd-table-prop):not(.wt-decor-prop):not(#hausdeppStock):not(#hausdeppPile),a[href],input,select,textarea,summary';
  // Watten's bubble host spans the complete centre even when empty. Protect
  // its painted .wt-bubble children, never that transparent layout container.
  const wattenControls = '.wt-topbar,.wt-seat-badge,.wt-seat-name,.wt-avatar,.wt-seat-call-role,.wt-seat-public-title,.wt-seat-tags,.wt-bubble,.wt-trick-label,.wt-reference figcaption,[data-wt-private],[data-wt-panel],[data-wt-stake],[data-wt-preplay],[data-wt-own-call],[data-wt-retour-announcement]';
  const holes = [...table.querySelectorAll(isWatten(table) ? `${selectors},${wattenControls}` : selectors)].filter(node => !node.closest('.hd-surprise-layer,.hd-table-decor,[data-watten-decor-layer]') && visible(node)).map(node => {
    const r = node.getBoundingClientRect();
    return { left: Math.max(0, r.left - box.left - 2), top: Math.max(0, r.top - box.top - 2), right: Math.min(box.width, r.right - box.left + 2), bottom: Math.min(box.height, r.bottom - box.top + 2) };
  }).filter(r => r.right > r.left && r.bottom > r.top);
  // Merge intersecting holes: evenodd paths otherwise fill their intersections.
  for (let index = 0; index < holes.length; index++) for (let next = index + 1; next < holes.length; next++) {
    const a = holes[index], b = holes[next];
    if (a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top) {
      holes[index] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
      holes.splice(next, 1); index = -1; break;
    }
  }
  const rect = (l, t, r, b) => `M${l.toFixed(1)} ${t.toFixed(1)}H${r.toFixed(1)}V${b.toFixed(1)}H${l.toFixed(1)}Z`;
  layer.style.clipPath = `path(evenodd, "${rect(0, 0, box.width, box.height)}${holes.map(r => rect(r.left, r.top, r.right, r.bottom)).join('')}")`;
}
