const RATIO = 570 / 360;
const GAP = 8, CAPTION = 20, LABEL = 24;
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const usable = rect => rect && rect.width > 0 && rect.height > 0;

export function fitPortraitPrompt(bounds, obstacles, { height = 20, widths = [180, 140, 100, 80], accept = null } = {}) {
  const blocked = obstacles.filter(usable).map(rect => ({ left: rect.left - 4, right: rect.right + 4, top: rect.top - 4, bottom: rect.bottom + 4 }));
  for (const width of widths.filter(width => width <= bounds.width)) {
    const xs = [...new Set([bounds.left + (bounds.width - width) / 2, bounds.left, bounds.right - width,
      ...blocked.flatMap(rect => [rect.left - width, rect.right])])];
    const ys = [...new Set([bounds.top, bounds.bottom - height,
      ...blocked.flatMap(rect => [rect.top - height, rect.bottom])])].sort((a, b) => a - b);
    for (const top of ys) for (const left of xs) {
      const result = { left, top, right: left + width, bottom: top + height, width, height };
      if (left >= bounds.left && top >= bounds.top && result.right <= bounds.right && result.bottom <= bounds.bottom
          && !blocked.some(obstacle => intersects(result, obstacle)) && (!accept || accept(result))) return result;
    }
  }
  return null;
}

/** Fit a complete public trick between the real table's occupied regions. */
export function fitPortraitTrick({ bounds, obstacles = [], count, desiredWidth = 104, minimumWidth = 64, labelHeight = LABEL, accept = null }) {
  if (!usable(bounds) || ![2, 3, 4].includes(count)) return null;
  const padding = 5;
  const blocked = obstacles.filter(usable).map(rect => ({ left: rect.left - padding, right: rect.right + padding,
    top: rect.top - padding, bottom: rect.bottom + padding }));
  // A fully visible row wins over a larger overlapping layout. Only when no
  // readable row fits do we use a two-by-two group with 25% overlap.
  for (const mode of ["row", "grid"]) {
    if (mode === "grid" && count < 3) continue;
    for (let cardWidth = Math.floor(desiredWidth); cardWidth >= minimumWidth; cardWidth--) {
      const cardHeight = cardWidth * RATIO;
      const width = mode === "row" ? cardWidth * count + GAP * (count - 1) : cardWidth * 1.75;
      const rowHeight = mode === "row" ? cardHeight : cardHeight * 1.75;
      const captionHeight = mode === "row" ? CAPTION : 36;
      const height = rowHeight + captionHeight + labelHeight;
      if (width > bounds.width || height > bounds.height) continue;
      const positions = Array.from({ length: count }, (_, index) => {
        if (mode === "row") return { x: index * (cardWidth + GAP), y: 0,
          ownerX: 0, ownerY: cardHeight + 4, ownerWidth: cardWidth };
        const column = index % 2, row = Math.floor(index / 2), x = column * cardWidth * .75, y = row * cardHeight * .75;
        return { x, y, ownerX: column * width / 2 - x, ownerY: rowHeight + 4 + row * 16 - y, ownerWidth: width / 2 - 3 };
      });
      const preferredX = bounds.left + (bounds.width - width) / 2;
      const preferredY = bounds.top + bounds.height * .56 - height / 2;
      const clampX = x => Math.max(bounds.left, Math.min(bounds.right - width, x));
      const clampY = y => Math.max(bounds.top, Math.min(bounds.bottom - height, y));
      const xs = [...new Set([preferredX, bounds.left, bounds.right - width,
        ...blocked.flatMap(rect => [rect.left - width, rect.right])].map(clampX))];
      const ys = [...new Set([preferredY, bounds.top, bounds.bottom - height,
        ...blocked.flatMap(rect => [rect.top - height, rect.bottom])].map(clampY))];
      const candidates = xs.flatMap(left => ys.map(top => ({ left, top, right: left + width, bottom: top + height,
        width, height, rowHeight, cardWidth, mode, captionHeight, positions })));
      candidates.sort((a, b) => Math.abs(a.left - preferredX) + Math.abs(a.top - preferredY)
        - Math.abs(b.left - preferredX) - Math.abs(b.top - preferredY));
      const result = candidates.find(candidate => !blocked.some(obstacle => intersects(candidate, obstacle)) && (!accept || accept(candidate)));
      if (result) return result;
    }
  }
  return null;
}

/** Fit the trick and its optional review/winner labels as one composition. */
export function fitPortraitTrickView({ bounds, obstacles, count, minimumWidth, labelHeight = 0, history = false }) {
  for (const separateLabel of labelHeight ? [false, true] : [false]) {
    let extras;
    const fit = fitPortraitTrick({ bounds, obstacles, count, minimumWidth, labelHeight: separateLabel ? 0 : labelHeight,
      accept: candidate => {
        const occupied = [...obstacles, candidate];
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
  const variables = ["--wt-portrait-x", "--wt-portrait-y", "--wt-portrait-width", "--wt-portrait-card-width", "--wt-portrait-row-height", "--wt-portrait-caption-height",
    "--wt-portrait-reference-left", "--wt-portrait-reference-top", "--wt-portrait-label-x", "--wt-portrait-label-y", "--wt-portrait-label-width"];
  let count = 0, queued = null, destroyed = false;
  const clear = () => {
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
    if (!node || node.hidden || win.getComputedStyle(node).display === "none") return null;
    const rect = node.getBoundingClientRect();
    return usable(rect) ? rect : null;
  };
  function layout() {
    queued = null;
    if (destroyed) return;
    clear();
    if (win.innerWidth > 760 || win.innerWidth >= win.innerHeight || trick.hidden || !trick.children.length) return;
    const area = felt.getBoundingClientRect();
    const left = Math.max(12, area.left + 8), top = Math.max(8, area.top + 8);
    const right = Math.min(win.innerWidth - 12, area.right - 8), bottom = Math.min(win.innerHeight - 8, area.bottom - 8);
    const bounds = { left, top, right, bottom, width: right - left, height: bottom - top };
    const reference = box(centre.querySelector(".wt-reference"));
    const panel = table.querySelector("[data-wt-panel]");
    const neutralPrompt = panel?.children.length === 1 && panel.firstElementChild.matches(".wt-prompt") ? panel : null;
    const protectedNodes = [...table.querySelectorAll(".wt-seat-badge, .wt-backs > i:not([hidden]), .wt-taken[data-filled='true'], .wt-stock, "
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
    if (reference) obstacles.push(reference);
    const originalWidth = Number.parseFloat(win.getComputedStyle(trick.firstElementChild).width) || 0;
    const minimumWidth = Math.max(win.innerWidth >= 360 ? 76 : 64, Math.ceil(originalWidth));
    const label = centre.querySelector(".wt-trick-label"), labelHeight = label?.textContent.trim() ? LABEL : 0;
    if (label) label.title = label.textContent.trim();
    const resolve = occupied => fitPortraitTrickView({ bounds, obstacles: occupied, count, labelHeight, minimumWidth, history: moveHistory });
    let { fit, labelFit, historyFit } = resolve(obstacles);
    if (!fit) { clear(); centre.dataset.wtPortraitTrickFallback = "space"; return; }
    const promptFit = neutralPrompt ? fitPortraitPrompt(bounds, [...obstacles, fit, labelFit, historyFit].filter(Boolean)) : null;
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
  const hand = table.querySelector("[data-wt-hand-area]");
  if (hand) observer?.observe(hand);
  const history = table.querySelector("[data-wt-history]");
  history?.addEventListener("toggle", schedule);
  win.addEventListener("resize", schedule, { passive: true });
  win.visualViewport?.addEventListener("resize", schedule, { passive: true });
  return {
    update(vm) { count = vm.count; if (queued !== null) win.cancelAnimationFrame(queued); layout(); },
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
