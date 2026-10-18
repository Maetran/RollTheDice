// Presentation only. The accepted model is already rendered when any of this
// runs; animations never gate commands and are dropped on rotation/resize.
// Only faces already visible to this viewer in the new DOM are animated.

const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

export function createMotion() {
  const running = new Set();
  let epoch = 0;
  let width = window.innerWidth, height = window.innerHeight;

  const enabled = () => !reducedMotion?.matches;

  function cancel() {
    epoch += 1;
    for (const animation of running) animation.cancel();
    running.clear();
  }

  function track(animation) {
    running.add(animation);
    const done = () => running.delete(animation);
    animation.finished.then(done, done);
    return animation;
  }

  // Rotation invalidates any captured geometry. Cancelling restores every
  // element to its accepted final position immediately.
  const geometryChanged = () => {
    if (window.innerWidth === width && window.innerHeight === height) return;
    width = window.innerWidth; height = window.innerHeight;
    cancel();
  };
  window.addEventListener("resize", geometryChanged, { passive: true });
  window.addEventListener("orientationchange", cancel, { passive: true });
  window.screen.orientation?.addEventListener?.("change", cancel);

  /** Rectangles of keyed nodes before an update, bound to this geometry epoch. */
  function capture(nodes, key) {
    const rects = new Map();
    for (const node of nodes) {
      const id = key(node);
      if (id) rects.set(id, node.getBoundingClientRect());
    }
    return { epoch, rects };
  }

  /** Slide an already placed element in from where its source used to be. */
  function arrive(element, from, captured, { duration = 260 } = {}) {
    if (!enabled() || !element?.isConnected || !from || captured?.epoch !== epoch) return;
    const to = element.getBoundingClientRect();
    if (!to.width || !from.width) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const scale = Math.max(.4, Math.min(1.6, from.width / to.width));
    // Individual translate/scale compose with the card's own CSS placement.
    track(element.animate([
      { translate: `${dx}px ${dy}px`, scale: String(scale), opacity: .85 },
      { translate: "0 0", scale: "1", opacity: 1 },
    ], { duration, easing: "cubic-bezier(.2,.7,.2,1)" }));
  }

  /** A modest staggered deal of the viewer's own, already visible hand. */
  function deal(elements) {
    if (!enabled()) return;
    elements.forEach((element, index) => {
      if (!element?.isConnected) return;
      track(element.animate([
        { translate: "0 18px", opacity: 0 },
        { translate: "0 0", opacity: 1 },
      ], { duration: 220, delay: index * 55, easing: "ease-out", fill: "backwards" }));
    });
  }

  return { enabled, cancel, capture, arrive, deal };
}
