/** Presentation only: privately known bottom cards rest as a small fan under the
 *  stock. A live own cut slides each newly seen face out from under the stock,
 *  keeps it readable and tucks it back into its slot. Already known cards stay
 *  where they are and only glide when the fan makes room. No command is sent. */
const REDUCED = "(prefers-reduced-motion: reduce)";
// Emerge, stay readable, tuck back. Reduced motion holds the readable pose
// for the same reading time and then shows the resting fan without travel.
export const CUT_EMERGE_MS = 380;
export const CUT_READ_MS = 1100;
export const CUT_TUCK_MS = 420;
export const CUT_REVEAL_MS = CUT_READ_MS + CUT_TUCK_MS;
const SHIFT_MS = 260;
const EASE_OUT = "cubic-bezier(.16,1,.3,1)";
const EASE_IN_OUT = "cubic-bezier(.45,0,.25,1)";

const parse = html => { const template = document.createElement("template"); template.innerHTML = html.trim(); return template.content.firstElementChild; };
const restOf = node => { const value = getComputedStyle(node).transform; return value && value !== "none" ? value : ""; };
const stopAll = node => node.getAnimations?.().forEach(animation => animation.cancel());

/** Screen vector → the rotated fan's own frame, where card translations apply. */
function local(fan, dx, dy) {
  const value = getComputedStyle(fan).transform;
  if (!value || value === "none" || typeof DOMMatrixReadOnly !== "function") return { x: dx, y: dy };
  const matrix = new DOMMatrixReadOnly(value);
  const inverse = new DOMMatrixReadOnly([matrix.a, matrix.b, matrix.c, matrix.d, 0, 0]).inverse();
  const point = inverse.transformPoint({ x: dx, y: dy });
  return { x: point.x, y: point.y };
}

export function mountCutFan({ container, fan, stock, cardMarkup }) {
  let cards = [], timer;
  const nodeFor = card => [...fan.children].find(node => node.dataset.cardId === card);
  const motionAllowed = () => !document.hidden && typeof fan.animate === "function" && !matchMedia(REDUCED).matches;
  const settle = () => { clearTimeout(timer); timer = null; delete container.dataset.revealing; };
  const layout = () => {
    const count = fan.children.length;
    // Up to five faces (four aces and the card above them) share the room of three.
    const spread = count > 3 ? 2 / (count - 1) : 1;
    [...fan.children].forEach((node, index) => node.style.setProperty("--cut-step", String(index * spread)));
    fan.dataset.count = String(count);
  };

  return {
    /** Reconcile the resting fan; retained faces glide to a changed slot. */
    render(next = []) {
      if (next.length === cards.length && next.every((card, index) => card === cards[index])) return;
      const reuse = new Map([...fan.children].map(node => [node.dataset.cardId, node]));
      const before = new Map();
      for (const [card, node] of reuse) if (next.includes(card)) before.set(card, restOf(node));
      for (const node of reuse.values()) stopAll(node);
      fan.replaceChildren(...next.map(card => reuse.get(card) || parse(cardMarkup(card))));
      cards = [...next];
      layout();
      container.hidden = !cards.length;
      if (!cards.length) { settle(); return; }
      if (!motionAllowed()) return;
      for (const [card, from] of before) {
        const node = nodeFor(card), to = restOf(node);
        if (node && from !== to) node.animate([{ transform: from || "none" }, { transform: to || "none" }], { duration: SHIFT_MS, easing: EASE_OUT });
      }
    },

    /** A live own cut: the new faces leave the stock, stay readable, tuck back. */
    reveal(fresh = []) {
      const nodes = fresh.map(nodeFor).filter(Boolean);
      if (!nodes.length || container.hidden) return false;
      clearTimeout(timer);
      container.dataset.revealing = "true";
      const stockBox = stock.getBoundingClientRect();
      const table = container.closest(".hd-table")?.getBoundingClientRect();
      const edge = Math.max(0, table?.left ?? 0) + 4;
      const animate = motionAllowed();
      for (const node of nodes) {
        stopAll(node);
        const rest = restOf(node), box = node.getBoundingClientRect();
        // Readable pose: clear of the stock where the table allows it, never off-screen.
        const wanted = stockBox.left - 6 - box.right;
        const dx = Math.min(0, Math.max(wanted, edge - box.left));
        const out = local(fan, dx, -box.height * .05);
        const shown = `translate(${out.x.toFixed(2)}px, ${out.y.toFixed(2)}px) ${rest}`.trim();
        const home = `translate(0px, 0px) ${rest}`.trim();
        if (typeof node.animate !== "function") continue;
        if (!animate) {
          node.animate([{ transform: shown }, { transform: shown }], { duration: CUT_READ_MS });
          continue;
        }
        // Start completely beneath the stock, so the face really comes from under it.
        const under = local(fan, Math.max(0, stockBox.left + 2 - box.left), 0);
        const hidden = `translate(${under.x.toFixed(2)}px, ${under.y.toFixed(2)}px) ${rest}`.trim();
        node.animate([
          { transform: hidden, offset: 0, easing: EASE_OUT },
          { transform: shown, offset: CUT_EMERGE_MS / CUT_REVEAL_MS },
          { transform: shown, offset: CUT_READ_MS / CUT_REVEAL_MS, easing: EASE_IN_OUT },
          { transform: home, offset: 1 },
        ], { duration: CUT_REVEAL_MS });
      }
      timer = setTimeout(settle, animate ? CUT_REVEAL_MS : CUT_READ_MS);
      return true;
    },

    stop() { for (const node of fan.children) stopAll(node); settle(); },
    destroy() { this.stop(); fan.replaceChildren(); cards = []; container.hidden = true; },
  };
}
