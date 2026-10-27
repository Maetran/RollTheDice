/** Presentation only: public pile faces keep their DOM and slide between fan poses.
 *  Poses come from computed style, so a redraw mid-slide continues from the visible pose. */
const PROPS = ["transform", "translate", "rotate"];
const DURATION = 260;
const REDUCED = "(prefers-reduced-motion: reduce)";
const held = new WeakMap(), shown = new WeakMap();
let bound = false;

const poseOf = node => {
  const style = getComputedStyle(node);
  return Object.fromEntries(PROPS.map(prop => [prop, style[prop] || "none"]));
};
const animations = pile => pile.getAnimations?.({ subtree: true }) || [];

// One set of listeners for the page: resize, a hidden tab or reduced motion settle paper.
function bind() {
  if (bound) return;
  bound = true;
  const settle = () => { const pile = document.getElementById("hausdeppPile"); if (pile) animations(pile).forEach(animation => animation.cancel()); };
  window.addEventListener("resize", settle);
  document.addEventListener("visibilitychange", () => { if (document.hidden) settle(); });
  matchMedia(REDUCED).addEventListener("change", event => { if (event.matches) settle(); });
}

const parse = html => { const template = document.createElement("template"); template.innerHTML = html; return [...template.content.childNodes]; };

function nodesOf({ edges, faces, empty }, reuse) {
  if (!faces.length) return parse(empty);
  return [...parse(edges), ...faces.map(face => {
    const node = reuse?.get(face.key) || parse(face.html)[0];
    if (reuse?.has(face.key)) {
      if (face.step === null) delete node.dataset.runStep; else node.dataset.runStep = String(face.step);
      node.style.setProperty("--stack-layer", String(face.layer));
      node.style.setProperty("--run-step", String(face.layer));
    }
    return node;
  })];
}

/** Measuring renders the accepted pile from fresh nodes and parks the visible ones. */
export function measurePile(pile, spec) {
  if (!held.has(pile)) held.set(pile, [...pile.childNodes]);
  pile.replaceChildren(...nodesOf(spec));
}

/** Put the parked visible nodes back, untouched, with their running animations. */
export function restorePile(pile) {
  const nodes = held.get(pile);
  if (!nodes) return;
  held.delete(pile);
  pile.replaceChildren(...nodes);
}

/** Reconcile keyed faces in place; retained paper slides from its current pose. */
export function reconcilePile(pile, spec, animate) {
  bind();
  const reuse = new Map();
  for (const node of pile.children) if (node.dataset.pileCard) reuse.set(node.dataset.pileCard, node);
  const wanted = new Set(spec.faces.map(face => face.key));
  const play = animate && !document.hidden && pile.animate && !matchMedia(REDUCED).matches;
  const first = new Map();
  for (const [key, node] of reuse) {
    if (wanted.has(key)) first.set(key, poseOf(node));
    else reuse.delete(key);
  }
  // Only a pure append of new public ids counts as a batch landing on the top pose.
  const before = shown.get(pile), discard = spec.discard;
  shown.set(pile, discard);
  const added = before && discard.length > before.length && before.every((card, index) => card === discard[index])
    ? new Set(discard.slice(before.length)) : new Set();
  for (const animation of animations(pile)) animation.cancel();
  pile.replaceChildren(...nodesOf(spec, reuse));
  if (!play) return;
  const options = { duration: DURATION, easing: "cubic-bezier(.22,.8,.3,1)" };
  const faces = new Map([...pile.children].filter(node => node.dataset.pileCard).map(node => [node.dataset.pileCard, node]));
  for (const [key, from] of first) {
    const node = faces.get(key), to = poseOf(node);
    if (PROPS.some(prop => from[prop] !== to[prop])) node.animate([from, to], options);
  }
  // Ghosts land on the top paper; deeper new papers of the same batch fan from there.
  const top = spec.faces.at(-1)?.key, topPose = top && poseOf(faces.get(top));
  for (const key of added) {
    const node = faces.get(key);
    if (!node || key === top) continue;
    const to = poseOf(node);
    if (PROPS.some(prop => topPose[prop] !== to[prop])) node.animate([topPose, to], options);
  }
}
