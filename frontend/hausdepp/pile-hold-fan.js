/** Presentation only: while a finger (or button) rests on the open pile, every
 *  public card is fanned out over the table, oldest first, the top card last.
 *  Letting go closes it. The list dialog remains the accessible alternative. */
const REDUCED = "(prefers-reduced-motion: reduce)";
const RATIO = 57 / 36;
// The rank corner stays readable when a neighbour covers at most this much.
const MIN_STEP = .36, MAX_STEP = .8, ROW_STEP = .52;

// Rotated corner cards reach this far beyond their upright box (12° at most).
const TILT_X = .33, TILT_Y = .08;

/** Largest card size whose rows of arcs fit the available box. When even the
 *  smallest card does not fit (tiny landscape screens, a huge pile), rows move
 *  closer and `scale` shrinks the whole fan, so no face ever leaves the box. */
export function holdFanLayout(count, width, height) {
  if (!count || width <= 0 || height <= 0) return { card: 0, rows: [], width: 0, height: 0, scale: 1 };
  const fit = card => {
    const tall = card * RATIO, inner = width - card * TILT_X * 2;
    const perRow = Math.max(1, Math.floor((inner - card) / (card * MIN_STEP)) + 1);
    const rowCount = Math.ceil(count / perRow);
    return { card, rowCount, rowStep: ROW_STEP, used: (rowCount - 1) * tall * ROW_STEP + tall * (1.05 + TILT_Y * 2) };
  };
  let best;
  for (let card = Math.min(116, width / (1 + TILT_X * 2)); card >= 24; card -= 2) {
    best = fit(card);
    if (best.used <= height) break;
  }
  const { card, rowCount } = best, tall = card * RATIO;
  let rowStep = best.rowStep;
  if (best.used > height && rowCount > 1) {
    // Keep at least the rank corner of every covered row visible.
    rowStep = Math.max(.22, (height - tall * (1.05 + TILT_Y * 2)) / ((rowCount - 1) * tall));
  }
  const inner = Math.max(card, width - card * TILT_X * 2);
  const base = Math.floor(count / rowCount), extra = count % rowCount;
  const rows = [];
  let index = 0, widest = card;
  for (let row = 0; row < rowCount; row += 1) {
    const size = base + (row < extra ? 1 : 0);
    const step = size > 1 ? Math.min(card * MAX_STEP, (inner - card) / (size - 1)) : 0;
    const span = card + step * (size - 1);
    widest = Math.max(widest, span);
    const spread = Math.min(12, size * 1.6);
    const slots = [];
    for (let slot = 0; slot < size; slot += 1, index += 1) {
      const offset = size > 1 ? (slot - (size - 1) / 2) / ((size - 1) / 2) : 0;
      slots.push({ index, x: slot * step - span / 2, y: row * tall * rowStep + offset * offset * tall * .05, angle: offset * spread });
    }
    rows.push(slots);
  }
  const fanHeight = (rowCount - 1) * tall * rowStep + tall * 1.05;
  const outerWidth = widest + card * TILT_X * 2, outerHeight = fanHeight + tall * TILT_Y * 2;
  return { card, rows, width: widest, height: fanHeight,
    scale: Math.min(1, width / outerWidth, height / outerHeight) };
}

export function createPileHoldFan({ table, pile, cardMarkup, t }) {
  const overlay = document.createElement("div");
  overlay.id = "hausdeppPileHoldFan";
  overlay.className = "hd-pile-hold-fan";
  overlay.hidden = true;
  // A pointer-held preview; screen readers use the pile's list dialog instead.
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `<p class="hd-pile-hold-count"></p><div class="hd-pile-hold-cards"></div>`;
  // Above the app bars of every layout, not only above the table.
  (table.ownerDocument?.body || table).append(overlay);
  const count = overlay.querySelector(".hd-pile-hold-count");
  const stage = overlay.querySelector(".hd-pile-hold-cards");
  let cards = [];

  const paint = animate => {
    count.textContent = t("pileCount", { count: cards.length });
    // The count chip and the 16px gutters take their room before the cards.
    const box = { width: Math.min(innerWidth - 32, 960), height: innerHeight - 32 - 12 - (count.offsetHeight || 26) };
    const layout = holdFanLayout(cards.length, box.width, box.height);
    stage.style.cssText = `--hold-card:${layout.card}px;width:${Math.ceil(layout.width)}px;height:${Math.ceil(layout.height)}px`
      + (layout.scale < 1 ? `;scale:${layout.scale.toFixed(3)}` : "");
    stage.innerHTML = cards.map(card => cardMarkup(card)).join("");
    const nodes = [...stage.children];
    const origin = pile.getBoundingClientRect(), stageBox = stage.getBoundingClientRect();
    const motion = animate && !matchMedia(REDUCED).matches && typeof stage.animate === "function";
    for (const slot of layout.rows.flat()) {
      const node = nodes[slot.index];
      node.style.left = `${(slot.x + layout.width / 2).toFixed(1)}px`;
      node.style.top = `${slot.y.toFixed(1)}px`;
      node.style.setProperty("--hold-angle", `${slot.angle.toFixed(2)}deg`);
      if (slot.index === cards.length - 1) node.classList.add("is-top");
      if (!motion) continue;
      // Each face leaves the pile and settles into its place in the fan.
      const k = layout.scale || 1;
      const dx = (origin.left + origin.width / 2 - (stageBox.left + (slot.x + layout.width / 2 + layout.card / 2) * k)) / k;
      const dy = (origin.top + origin.height / 2 - (stageBox.top + (slot.y + layout.card * RATIO / 2) * k)) / k;
      node.animate([
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(0deg) scale(.7)`, opacity: .6 },
        { transform: `translate(0px, 0px) rotate(${slot.angle.toFixed(2)}deg) scale(1)`, opacity: 1 },
      ], { duration: 220 + Math.min(160, slot.index * 6), easing: "cubic-bezier(.2,.8,.3,1)" });
    }
  };

  // A rotation or resize while held re-fits the same cards without travel.
  const onResize = () => { if (!overlay.hidden) paint(false); };
  window.addEventListener("resize", onResize);

  return {
    get open() { return !overlay.hidden; },
    show(discard) {
      cards = [...discard];
      if (!cards.length) return false;
      overlay.hidden = false;
      document.documentElement.classList.add("hd-pile-holding");
      paint(true);
      return true;
    },
    update(discard) {
      if (overlay.hidden) return;
      const next = [...discard];
      if (next.length === cards.length && next.every((card, index) => card === cards[index])) return;
      cards = next;
      if (!cards.length) { this.hide(); return; }
      paint(false);
    },
    hide() {
      if (overlay.hidden) return;
      overlay.hidden = true;
      stage.getAnimations?.({ subtree: true }).forEach(animation => animation.cancel());
      stage.replaceChildren();
      document.documentElement.classList.remove("hd-pile-holding");
    },
    destroy() { this.hide(); window.removeEventListener("resize", onResize); overlay.remove(); },
  };
}
