const RATIO = 570 / 360;
const CAPTION = 11, LABEL = 24;
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const usable = rect => rect && rect.width > 0 && rect.height > 0;

/** Fit the complete public clover between the two inward-facing hands. */
export function fitLandscapeTrick({ top, bottom, desiredWidth, minimumWidth = 48 }) {
  if (![top, bottom, desiredWidth, minimumWidth].every(Number.isFinite) || bottom <= top || desiredWidth < minimumWidth) return null;
  for (const padding of [7, 1]) for (const spread of [.52, .44, .36, .24]) {
    const compact = spread === .24;
    const angle = compact ? 0 : 2 * Math.PI / 180;
    const heightPerWidth = RATIO * (spread + Math.cos(angle)) + Math.sin(angle);
    const cardWidth = Math.min(Math.floor(desiredWidth), Math.floor((bottom - top - padding * 2) / heightPerWidth));
    if (cardWidth < minimumWidth) continue;
    const height = cardWidth * heightPerWidth;
    return { cardWidth, height, y: (top + bottom) / 2, spread, compact, insetWinner: padding < 7,
      top: (top + bottom - height) / 2, bottom: (top + bottom + height) / 2 };
  }
  return null;
}

export function fitPortraitPrompt(bounds, obstacles, { height = 20, widths = [180, 140, 100, 80], accept = null, bottomFirst = false, centerFirst = false } = {}) {
  const blocked = obstacles.filter(usable).map(rect => ({ left: rect.left - 4, right: rect.right + 4, top: rect.top - 4, bottom: rect.bottom + 4 }));
  for (const width of widths.filter(width => width <= bounds.width)) {
    const xs = [...new Set([bounds.left + (bounds.width - width) / 2, bounds.left, bounds.right - width,
      ...blocked.flatMap(rect => [rect.left - width, rect.right])])];
    const ys = [...new Set([bounds.top, bounds.bottom - height,
      ...blocked.flatMap(rect => [rect.top - height, rect.bottom])])].sort((a, b) => bottomFirst ? b - a : a - b);
    for (const centred of centerFirst ? [true, false] : [false]) for (const top of ys) for (const left of centred ? xs.slice(0, 1) : xs) {
      const result = { left, top, right: left + width, bottom: top + height, width, height };
      if (left >= bounds.left && top >= bounds.top && result.right <= bounds.right && result.bottom <= bounds.bottom
          && !blocked.some(obstacle => intersects(result, obstacle)) && (!accept || accept(result))) return result;
    }
  }
  return null;
}

/** Fit a public trick as one overlapping pile, preserving the players' seats. */
export function fitPortraitTrick({ bounds, obstacles = [], count, positions = null, desiredWidth = 104, minimumWidth = 64, labelHeight = LABEL, accept = null, measureFaces = false }) {
  if (!usable(bounds) || ![2, 3, 4].includes(count)) return null;
  const padding = 5;
  const blocked = obstacles.filter(usable).map(rect => ({ left: rect.left - padding, right: rect.right + padding,
    top: rect.top - padding, bottom: rect.bottom + padding }));
  const seats = positions || (count === 2 ? ["bottom", "top"] : count === 3 ? ["bottom", "left", "right"] : ["bottom", "left", "top", "right"]);
  // Keep the pile on the table's centre line even when a captured packet would
  // permit a larger face only at a screen edge. Use that edge space only when
  // no readable centred composition can fit at all.
  // Prefer the existing rectangular clearance. On a tight phone, the empty
  // upper corners of that rectangle may meet a side badge while every card
  // face stays clear. Only then measure the complete eventual card shape.
  const painted = measureFaces;
  for (const centred of [true, false]) for (const spread of [.52, .44, .36]) for (let cardWidth = Math.floor(desiredWidth); cardWidth >= minimumWidth; cardWidth--) {
    const cardHeight = cardWidth * RATIO;
    // The side cards reach towards their owners; the top and bottom cards
    // share a centre line. Captions stay outside the other card faces while
    // the original play order determines which cards overlap in front.
    // Three seats have no upper player to join the two side cards. Their
    // side faces must overlap directly, including a left→right opening.
    const sideReach = cardWidth * (count === 3 ? .9 : 1.5);
    const inset = count === 3 ? cardWidth * .15 : 0;
    const width = cardWidth + sideReach + inset * 2;
    const rowHeight = cardHeight * (1 + spread) + CAPTION;
    const captionHeight = CAPTION;
    const height = rowHeight + captionHeight + labelHeight;
    if (width > bounds.width || height > bounds.height) continue;
    const anchors = {
      top: { x: inset + sideReach / 2, y: CAPTION, ownerX: 0, ownerY: -CAPTION, ownerWidth: cardWidth },
      bottom: { x: inset + sideReach / 2, y: CAPTION + cardHeight * spread, ownerX: 0, ownerY: cardHeight, ownerWidth: cardWidth },
      left: { x: inset, y: CAPTION + cardHeight * spread / 2,
        ownerX: -inset, ownerY: cardHeight * .53, ownerWidth: cardWidth * .6 },
      right: { x: inset + sideReach, y: CAPTION + cardHeight * spread / 2,
        ownerX: cardWidth * (count === 3 ? .55 : .4), ownerY: cardHeight * .53, ownerWidth: cardWidth * .6 },
    };
    const cardPositions = seats.map(seat => anchors[seat] || anchors.bottom);
    // Reserve all seats from the first throw. Fitting only the currently
    // painted prefix would move earlier cards when another player follows.
    const reservedSeats = count === 2 ? ["bottom", "top"] : count === 3 ? ["bottom", "left", "right"] : ["bottom", "left", "top", "right"];
    const footprints = painted ? reservedSeats.map(seat => ({ left: anchors[seat].x, top: anchors[seat].y,
      right: anchors[seat].x + cardWidth, bottom: anchors[seat].y + cardHeight, width: cardWidth, height: cardHeight }))
      : [{ left: 0, top: 0, right: width, bottom: height, width, height }];
    if (painted && labelHeight) footprints.push({ left: 0, top: rowHeight + captionHeight,
      right: width, bottom: height, width, height: labelHeight });
    const preferredX = bounds.left + (bounds.width - width) / 2;
    const preferredY = bounds.top + bounds.height * .56 - height / 2;
    const clampX = x => Math.max(bounds.left, Math.min(bounds.right - width, x));
    const clampY = y => Math.max(bounds.top, Math.min(bounds.bottom - height, y));
    const xs = centred ? [preferredX] : [...new Set([preferredX, bounds.left, bounds.right - width,
      ...blocked.flatMap(rect => footprints.flatMap(face => [rect.left - face.right, rect.right - face.left]))].map(clampX))];
    const ys = [...new Set([preferredY, bounds.top, bounds.bottom - height,
      ...blocked.flatMap(rect => footprints.flatMap(face => [rect.top - face.bottom, rect.bottom - face.top]))].map(clampY))];
    const candidates = [];
    for (const left of xs) for (const top of ys) {
      // Reject occupied origins before allocating/sorting complete shapes.
      // Most edge candidates are blocked by a hand on a small phone.
      if (footprints.some(face => blocked.some(obstacle => left + face.left < obstacle.right && left + face.right > obstacle.left
        && top + face.top < obstacle.bottom && top + face.bottom > obstacle.top))) continue;
      candidates.push({ left, top, right: left + width, bottom: top + height,
        width, height, rowHeight, cardWidth, mode: "stack", captionHeight, positions: cardPositions,
        ...(painted ? { painted: footprints.map(face => ({ ...face, left: left + face.left, right: left + face.right,
          top: top + face.top, bottom: top + face.bottom })) } : {}) });
    }
    candidates.sort((a, b) => Math.abs(a.left - preferredX) + Math.abs(a.top - preferredY)
      - Math.abs(b.left - preferredX) - Math.abs(b.top - preferredY));
    const result = candidates.find(candidate => !accept || accept(candidate));
    if (result) return result;
  }
  return null;
}

/** Fit the trick and its optional review/winner labels as one composition. */
export function fitPortraitTrickView({ bounds, obstacles, count, positions = null, minimumWidth, labelHeight = 0, history = false }) {
  for (const measureFaces of [false, true]) for (const separateLabel of labelHeight ? measureFaces ? [true, false] : [false, true] : [false]) {
    let extras;
    const fit = fitPortraitTrick({ bounds, obstacles, count, positions, minimumWidth, measureFaces, labelHeight: separateLabel ? 0 : labelHeight,
      accept: candidate => {
        const occupied = [...obstacles, ...(candidate.painted || [candidate])];
        let labelFit = null;
        const acceptHistory = historyFit => {
          labelFit = separateLabel ? fitPortraitPrompt(bounds, historyFit ? [...occupied, historyFit] : occupied,
            { widths: [180, 140, 100, 80, 72, 64] }) : null;
          return !separateLabel || Boolean(labelFit);
        };
        const historyFit = history ? fitPortraitPrompt(bounds, occupied,
          { height: 44, widths: [136, 128, 112, 96, 80, 64], accept: acceptHistory }) : null;
        if (history ? !historyFit : !acceptHistory(null)) return false;
        extras = { labelFit, historyFit };
        return true;
      } });
    if (fit) return { fit, ...extras };
  }
  return { fit: null, labelFit: null, historyFit: null };
}

/** Presentation only: public faces already present in the trick DOM. */
export function createTrickLayout(trick, { win = window } = {}) {
  const centre = trick.parentElement, felt = centre.parentElement, table = felt.closest("[data-wt-table]");
  const ownCall = table.querySelector("[data-wt-own-call]");
  const variables = ["--wt-landscape-x", "--wt-landscape-y", "--wt-landscape-card-width", "--wt-landscape-height", "--wt-landscape-reach",
    "--wt-portrait-x", "--wt-portrait-y", "--wt-portrait-width", "--wt-portrait-card-width", "--wt-portrait-row-height", "--wt-portrait-caption-height",
    "--wt-portrait-reference-left", "--wt-portrait-reference-top", "--wt-portrait-label-x", "--wt-portrait-label-y", "--wt-portrait-label-width"];
  let count = 0, queued = null, destroyed = false, landscape = null, deal = "";
  const clear = () => {
    ownCall?.style.removeProperty("--wt-own-call-left");
    ownCall?.style.removeProperty("--wt-own-call-bottom");
    if (ownCall) delete ownCall.dataset.wtCallFallback;
    delete centre.dataset.wtLandscapeTrick;
    delete centre.dataset.wtLandscapeCompact;
    delete centre.dataset.wtLandscapeInsetWinner;
    delete centre.dataset.wtPortraitTrick;
    delete centre.dataset.wtPortraitTrickMode;
    delete centre.dataset.wtPortraitTrickFallback;
    delete centre.dataset.wtPortraitLabel;
    for (const variable of variables) centre.style.removeProperty(variable);
    for (const card of trick.children) for (const variable of ["--wt-portrait-card-x", "--wt-portrait-card-y", "--wt-portrait-owner-x", "--wt-portrait-owner-y", "--wt-portrait-owner-width"]) card.style.removeProperty(variable);
    const history = table.querySelector("[data-wt-portrait-history]");
    if (history) {
      delete history.dataset.wtPortraitHistory;
      for (const variable of ["--wt-portrait-history-x", "--wt-portrait-history-y", "--wt-portrait-history-width"]) history.style.removeProperty(variable);
    }
    const prompt = table.querySelector("[data-wt-portrait-prompt]");
    if (prompt) {
      delete prompt.dataset.wtPortraitPrompt;
      for (const variable of ["--wt-portrait-prompt-x", "--wt-portrait-prompt-y", "--wt-portrait-prompt-width"]) prompt.style.removeProperty(variable);
    }
  };
  const box = node => {
    if (!node || node.hidden) return null;
    const style = win.getComputedStyle(node);
    // Deal flights hide accepted opponent slots only while their copies fly.
    // Their physical fan still occupies the same space when the flight ends.
    const physicalBack = node.matches(".wt-backs > i");
    if (style.display === "none" || (!physicalBack
      && (style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0"))) return null;
    const rect = node.getBoundingClientRect();
    return usable(rect) ? rect : null;
  };
  const counterBox = node => {
    const frame = box(node);
    if (!frame) return null;
    const style = win.getComputedStyle(node, "::after");
    if (style.content === "none" || style.content === "normal" || style.display === "none" || style.visibility === "hidden") return null;
    const px = value => Number.parseFloat(value) || 0;
    const borderBox = style.boxSizing === "border-box";
    const width = px(style.width) + (borderBox ? 0 : px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth));
    const height = px(style.height) + (borderBox ? 0 : px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth));
    const right = frame.right - px(style.right), bottom = frame.bottom - px(style.bottom);
    const result = { left: right - width, top: bottom - height, right, bottom, width, height };
    return usable(result) ? result : null;
  };
  function positionCalls() {
    if (!ownCall?.children.length || !win.matchMedia("(orientation: portrait) and (max-width: 760px)").matches) return;
    const sheet = ownCall.parentElement, sheetBox = sheet.getBoundingClientRect(), area = felt.getBoundingClientRect();
    const visibleBox = node => node.checkVisibility?.() === false ? null : box(node);
    const dockChildren = [...sheet.children].filter(node => node !== ownCall);
    // Flex children can extend above a max-height dock. Use their painted
    // edges, excluding pinned content which is an obstacle, not the floor.
    const inFlow = node => !["absolute", "fixed"].includes(win.getComputedStyle(node).position);
    const dock = dockChildren.filter(inFlow).map(visibleBox).filter(Boolean);
    const bottom = Math.min(sheetBox.top, ...dock.map(rect => rect.top)) - 6;
    const left = Math.max(12, area.left + 8), right = Math.min(win.innerWidth - 12, area.right - 8);
    const top = Math.max(8, area.top + 8);
    const bounds = { left, top, right, bottom, width: right - left, height: bottom - top };
    const obstacles = [...table.querySelectorAll(".wt-seat-badge, .wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-seat-tags, .wt-seat-meta, "
      + ".wt-bubble--thanks, .wt-backs > i:not([hidden]), .wt-stock, .wt-reference, [data-wt-preplay], [data-wt-bloedeln]:not(:empty), .wt-trick-label:not(:empty), .wt-prompt, .wt-partner-popover, .wt-retour-tag"),
    ...dockChildren.filter(node => !inFlow(node))].map(visibleBox).filter(Boolean);
    const middle = (bounds.left + bounds.right) / 2;
    let ownFit = null;
    if (ownCall.children.length && box(ownCall)) {
      const size = ownCall.getBoundingClientRect(), left = middle - size.width / 2;
      const column = { ...bounds, left, right: left + size.width, width: size.width };
      ownFit = fitPortraitPrompt(column, obstacles, { height: size.height, widths: [size.width], bottomFirst: true });
      if (!ownFit) ownCall.dataset.wtCallFallback = "space";
      else {
        ownCall.style.setProperty("--wt-own-call-left", `${middle - sheetBox.left}px`);
        ownCall.style.setProperty("--wt-own-call-bottom", `${sheetBox.bottom - ownFit.bottom}px`);
        obstacles.push(ownFit);
      }
    }

  }
  function layout() {
    queued = null;
    if (destroyed) return;
    clear();
    // Calls precede every trick card, so fit them before the empty-trick return.
    positionCalls();
    if (trick.hidden || !trick.children.length) { landscape = null; return; }
    if (win.innerWidth >= win.innerHeight && win.innerHeight <= 700) {
      const area = felt.getBoundingClientRect();
      const key = [deal, trick.firstElementChild.dataset.key, count, win.innerWidth, win.innerHeight,
        area.left, area.top, area.width, area.height].join(":");
      if (landscape?.key !== key) {
        // Arrival animations can hide a face temporarily without removing its
        // physical slot. Measure the accepted DOM geometry, including those
        // slots, then retain this complete footprint until the next trick.
        const frames = selector => [...table.querySelectorAll(selector)].filter(node => !node.hidden)
          .map(node => node.getBoundingClientRect()).filter(usable);
        const topHand = frames(".wt-seat--top .wt-backs > i:not([hidden])");
        const ownHand = frames("[data-wt-hand-area]:not([hidden]) [data-wt-hand] > *, .wt-seat--bottom .wt-backs > i:not([hidden])");
        const top = topHand.length ? Math.max(...topHand.map(rect => rect.bottom)) : area.top + 40;
        const bottom = ownHand.length ? Math.min(...ownHand.map(rect => rect.top)) : area.bottom - 40;
        const desiredWidth = Number.parseFloat(win.getComputedStyle(trick.firstElementChild).width);
        landscape = { key, fit: fitLandscapeTrick({ top, bottom, desiredWidth }) };
      }
      if (landscape.fit) {
        const fit = landscape.fit;
        centre.dataset.wtLandscapeTrick = "true";
        if (fit.compact) centre.dataset.wtLandscapeCompact = "true";
        if (fit.insetWinner) centre.dataset.wtLandscapeInsetWinner = "true";
        for (const [name, value] of [["x", area.width / 2], ["y", fit.y - area.top],
          ["card-width", fit.cardWidth], ["height", fit.height]]) centre.style.setProperty(`--wt-landscape-${name}`, `${value}px`);
        centre.style.setProperty("--wt-landscape-reach", `${fit.spread * 50}%`);
      }
      return;
    }
    landscape = null;
    if (win.innerWidth > 760 || win.innerWidth >= win.innerHeight) return;
    const area = felt.getBoundingClientRect();
    const left = Math.max(12, area.left + 8), top = Math.max(8, area.top + 8);
    const right = Math.min(win.innerWidth - 12, area.right - 8), bottom = Math.min(win.innerHeight - 8, area.bottom - 8);
    const bounds = { left, top, right, bottom, width: right - left, height: bottom - top };
    const reference = box(centre.querySelector(".wt-reference"));
    const panel = table.querySelector("[data-wt-panel]");
    const neutralPrompt = panel?.children.length === 1 && panel.firstElementChild.matches(".wt-prompt") ? panel : null;
    // Names and roles can extend outside the small badge frames. Captured
    // packets likewise paint rotated corners and a counter beyond their box.
    const protectedNodes = [...table.querySelectorAll(".wt-seat-badge, .wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-seat-tags, .wt-seat-meta, .wt-bubble--thanks, "
      + ".wt-backs > i:not([hidden]), .wt-taken[data-filled='true'], .wt-taken[data-filled='true'] i, .wt-stock, "
      + "[data-wt-hand-area], [data-wt-panel], [data-wt-private] button, [data-wt-stake], [data-wt-history]:not([open])")].filter(node => node !== neutralPrompt);
    const history = table.querySelector("[data-wt-history]:not([open])"), historyBox = box(history);
    const moveHistory = Boolean(historyBox && table.dataset.phase === "play" && (!panel?.children.length || neutralPrompt));
    // Remove the extra dock row before measuring. Its final 44px position is
    // chosen together with the trick, rather than consuming the first gap.
    if (moveHistory) {
      history.dataset.wtPortraitHistory = "true";
      for (const [key, value] of [["x", historyBox.left], ["y", historyBox.top], ["width", historyBox.width]]) history.style.setProperty(`--wt-portrait-history-${key}`, `${value}px`);
    }
    const obstacles = protectedNodes.filter(node => !moveHistory || node !== history).map(box).filter(Boolean);
    obstacles.push(...[...table.querySelectorAll(".wt-taken[data-filled='true']")].map(counterBox).filter(Boolean));
    if (reference) obstacles.push(reference);
    const originalWidth = Number.parseFloat(win.getComputedStyle(trick.firstElementChild).width) || 0;
    const minimumWidth = Math.max(win.innerWidth >= 360 ? 76 : 64, Math.ceil(originalWidth));
    // Reserve the eventual winner caption while the trick is still live, so
    // completing it does not move the pile merely to make room for that label.
    const label = centre.querySelector(".wt-trick-label"), labelHeight = LABEL;
    if (label) label.title = label.textContent.trim();
    const positions = [...trick.children].map(card => card.dataset.position);
    const resolve = occupied => fitPortraitTrickView({ bounds, obstacles: occupied, count, positions, labelHeight, minimumWidth, history: moveHistory });
    let { fit, labelFit, historyFit } = resolve(obstacles);
    if (!fit) { clear(); centre.dataset.wtPortraitTrickFallback = "space"; return; }
    const promptFit = neutralPrompt ? fitPortraitPrompt(bounds, [...obstacles, ...(fit.painted || [fit]), labelFit, historyFit].filter(Boolean)) : null;
    if (neutralPrompt && !promptFit) {
      const promptBox = box(neutralPrompt);
      ({ fit, labelFit, historyFit } = resolve(promptBox ? [...obstacles, promptBox] : obstacles));
      if (!fit) { clear(); centre.dataset.wtPortraitTrickFallback = "prompt"; return; }
    }
    if (historyFit) for (const [key, value] of [["x", historyFit.left], ["y", historyFit.top], ["width", historyFit.width]]) history.style.setProperty(`--wt-portrait-history-${key}`, `${value}px`);
    const set = (name, value) => {
      const next = `${Math.round(value * 100) / 100}px`;
      if (centre.style.getPropertyValue(name) !== next) centre.style.setProperty(name, next);
    };
    centre.dataset.wtPortraitTrick = "true";
    centre.dataset.wtPortraitTrickMode = fit.mode;
    set("--wt-portrait-x", fit.left - area.left);
    set("--wt-portrait-y", fit.top - area.top);
    set("--wt-portrait-width", fit.width);
    set("--wt-portrait-card-width", fit.cardWidth);
    set("--wt-portrait-row-height", fit.rowHeight);
    set("--wt-portrait-caption-height", fit.captionHeight);
    if (labelFit) {
      centre.dataset.wtPortraitLabel = "true";
      set("--wt-portrait-label-x", labelFit.left);
      set("--wt-portrait-label-y", labelFit.top);
      set("--wt-portrait-label-width", labelFit.width);
    }
    if (reference) {
      set("--wt-portrait-reference-left", reference.left);
      set("--wt-portrait-reference-top", reference.top);
    }
    if (neutralPrompt && promptFit) {
      neutralPrompt.dataset.wtPortraitPrompt = "true";
      neutralPrompt.style.setProperty("--wt-portrait-prompt-x", `${promptFit.left}px`);
      neutralPrompt.style.setProperty("--wt-portrait-prompt-y", `${promptFit.top}px`);
      neutralPrompt.style.setProperty("--wt-portrait-prompt-width", `${promptFit.width}px`);
    }
    [...trick.children].forEach((card, index) => {
      const position = fit.positions[index];
      if (!position) return;
      for (const [property, value] of Object.entries(position)) {
        const name = property === "x" || property === "y" ? `card-${property}` : property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        card.style.setProperty(`--wt-portrait-${name}`, `${value}px`);
      }
    });
  }
  const schedule = () => { if (!destroyed && queued === null) queued = win.requestAnimationFrame(layout); };
  const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(schedule) : null;
  observer?.observe(felt);
  if (ownCall) {
    observer?.observe(ownCall);
    observer?.observe(ownCall.parentElement);
  }
  const hand = table.querySelector("[data-wt-hand-area]");
  if (hand) observer?.observe(hand);
  const history = table.querySelector("[data-wt-history]");
  history?.addEventListener("toggle", schedule);
  win.addEventListener("resize", schedule, { passive: true });
  win.visualViewport?.addEventListener("resize", schedule, { passive: true });
  return {
    update(vm) {
      count = vm.count;
      deal = `${vm.engine?.deal_id ?? ""}:${vm.engine?.deal_revision ?? 0}`;
      if (queued !== null) win.cancelAnimationFrame(queued);
      layout();
      // A compact dock can move after its DOM/CSS update without resizing.
      // Recheck calls once on the next frame; the size observer cannot see it.
      if (ownCall?.children.length && win.matchMedia("(orientation: portrait) and (max-width: 760px)").matches) schedule();
    },
    destroy() {
      destroyed = true;
      if (queued !== null) win.cancelAnimationFrame(queued);
      observer?.disconnect();
      history?.removeEventListener("toggle", schedule);
      win.removeEventListener("resize", schedule);
      win.visualViewport?.removeEventListener("resize", schedule);
      clear();
    },
  };
}
