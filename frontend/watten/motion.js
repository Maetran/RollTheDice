// Presentation only: accepted state and controls update immediately. Ghosts copy
// only currently permitted DOM faces/backs; no hand, stock or call is inferred.
const FLIGHT = 240, HOLD = 3000, COLLECT = 360, MAX_GHOSTS = 24;
const TRICK_TIME = FLIGHT + HOLD + COLLECT, MAX_PRESENTATION = TRICK_TIME * 2;
const easing = "cubic-bezier(.2,.7,.2,1)";
const usable = rect => rect && rect.width > 0 && rect.height > 0;
const centre = rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
let copyId = 0;
const completedKey = (engine) => engine?.last_trick
  ? `${engine.deal_id}:${engine.deal_revision ?? 0}:${engine.last_trick.winner}:${engine.last_trick.cards.map(item => `${item.seat}/${item.card}`).join(",")}` : "";

const multiply = ([a, b, c, d], [e, f, g, h]) => [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h];

/** Preserve the painted card's angle and proportions outside its seat wrapper. */
export function cardCopyPose(rect, styles = []) {
  let matrix = [1, 0, 0, 1];
  for (const style of styles) {
    const values = style.transform?.match(/^matrix(3d)?\(([^)]+)\)$/);
    const numbers = values?.[2].split(",").map(Number);
    const transform = numbers ? values[1] ? [numbers[0], numbers[1], numbers[4], numbers[5]] : numbers.slice(0, 4) : [1, 0, 0, 1];
    const angle = (Number.parseFloat(style.rotate) || 0) * Math.PI / 180;
    const rotation = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle)];
    matrix = multiply(multiply(rotation, transform), matrix);
  }
  const width = Number.parseFloat(styles[0]?.width) || rect.width;
  const height = Number.parseFloat(styles[0]?.height) || rect.height;
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2,
    width, height, transform: `matrix(${matrix.join(",")},0,0)` };
}

export const sameHandVersion = (previous, engine) => Boolean(previous && previous.deal_id === engine.deal_id
  && (previous.deal_revision ?? 0) === (engine.deal_revision ?? 0));

/** Cold snapshots establish a baseline. Only a live waiting/new-deal transition
 * deals cards; joining/reconnecting into an existing deal never pretends to. */
export function motionTransition(previous, engine, live) {
  const sameDeal = Boolean(live && sameHandVersion(previous, engine));
  return {
    sameDeal,
    deal: Boolean(live && (!previous || previous.deal_id !== engine.deal_id)),
    collect: sameDeal && completedKey(previous) !== completedKey(engine) && Boolean(engine.last_trick),
  };
}

export function createMotion({ win = window, doc = document } = {}) {
  const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  const running = new Set(), ghosts = new Set(), arrivals = new Map(), flips = new Map(), hidden = new Map(), settled = new Map();
  let epoch = 0, destroyed = false;
  let collectBatchStart = null;
  let width = win.innerWidth, height = win.innerHeight;
  const now = () => win.performance?.now?.() ?? performance.now();
  const enabled = () => !destroyed && !reduced?.matches && !doc.hidden && doc.visibilityState !== "hidden"
    && typeof doc.body?.animate === "function";

  function hide(node, property = "visibility") {
    if (!hidden.has(node)) hidden.set(node, { count: 0, property, value: node.style[property] });
    hidden.get(node).count += 1;
    node.style[property] = property === "opacity" ? "0" : "hidden";
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = hidden.get(node);
      if (entry && --entry.count === 0) { node.style[entry.property] = entry.value; hidden.delete(node); }
    };
  }

  function animate(node, frames, options, done = () => {}, delay) {
    if (typeof node.animate !== "function") { done(); return null; }
    const animation = node.animate(frames, delay === undefined ? options : { ...options, delay });
    const entry = { cancel: () => { animation.cancel(); finish(); } };
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      running.delete(entry);
      done();
    }
    running.add(entry);
    animation.finished.then(finish, finish);
    return entry;
  }

  function cancel() {
    epoch += 1;
    for (const job of [...ghosts]) job.remove();
    for (const entry of [...running]) entry.cancel();
    for (const release of settled.values()) release();
    settled.clear();
    arrivals.clear(); flips.clear();
    collectBatchStart = null;
  }

  const geometryChanged = () => {
    if (win.innerWidth === width && win.innerHeight === height) return;
    width = win.innerWidth; height = win.innerHeight;
    cancel();
  };
  const visibilityChanged = () => { if (!enabled()) cancel(); };
  win.addEventListener("resize", geometryChanged, { passive: true });
  win.addEventListener("orientationchange", cancel, { passive: true });
  win.addEventListener("scroll", cancel, { passive: true, capture: true });
  // iOS keyboards/panning can change the table's CSS viewport without changing
  // window.innerWidth/innerHeight. Never fly to a stale pre-keyboard anchor.
  win.visualViewport?.addEventListener("resize", cancel, { passive: true });
  win.visualViewport?.addEventListener("scroll", cancel, { passive: true });
  win.screen?.orientation?.addEventListener?.("change", cancel);
  doc.addEventListener("visibilitychange", visibilityChanged);
  reduced?.addEventListener?.("change", cancel);

  function destroy() {
    cancel(); destroyed = true;
    win.removeEventListener("resize", geometryChanged);
    win.removeEventListener("orientationchange", cancel);
    win.removeEventListener("scroll", cancel, true);
    win.visualViewport?.removeEventListener("resize", cancel);
    win.visualViewport?.removeEventListener("scroll", cancel);
    win.screen?.orientation?.removeEventListener?.("change", cancel);
    doc.removeEventListener("visibilitychange", visibilityChanged);
    reduced?.removeEventListener?.("change", cancel);
  }

  /** A render-local geometry map, never an archive of private cards. */
  function capture(nodes, key = node => node.dataset.key) {
    const rects = new Map(), sources = new Map();
    for (const node of nodes) {
      const id = key(node);
      if (id) { rects.set(id, node.getBoundingClientRect()); sources.set(id, node); }
    }
    return { epoch, rects, sources };
  }

  function ghost(kind, rect, targetSeat) {
    while (ghosts.size >= MAX_GHOSTS) ghosts.values().next().value.remove();
    const node = doc.createElement("div");
    node.dataset.wtMotion = kind;
    if (Number.isInteger(targetSeat)) node.dataset.targetSeat = String(targetSeat);
    node.setAttribute("aria-hidden", "true"); node.inert = true;
    Object.assign(node.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: "none", zIndex: "24", margin: "0" });
    const releases = [], animations = [];
    let removed = false;
    const job = { node, animations, releases, remove() {
      if (removed) return;
      removed = true;
      for (const entry of animations) entry?.cancel();
      for (const release of releases) release();
      node.remove(); ghosts.delete(job);
      if (![...ghosts].some(item => item.node.dataset.wtMotion === "collect")) collectBatchStart = null;
    } };
    doc.body.append(node); ghosts.add(job);
    return job;
  }

  function copyCard(source, parent, rect, origin) {
    const styles = [];
    if (win.getComputedStyle) for (let node = source; node; node = node.parentElement) styles.push(win.getComputedStyle(node));
    const pose = cardCopyPose(rect, styles);
    const clone = source.cloneNode(true);
    const freeze = (original, copy) => {
      const style = win.getComputedStyle?.(original);
      if (!style) return;
      for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property));
      Object.assign(copy.style, { visibility: "visible", animation: "none", transition: "none" });
    };
    freeze(source, clone);
    const owners = source.querySelectorAll(".wt-card-owner"), copiedOwners = clone.querySelectorAll(".wt-card-owner");
    owners.forEach((owner, index) => freeze(owner, copiedOwners[index]));
    const nodes = [clone, ...clone.querySelectorAll("*")], ids = new Map();
    // No duplicate focus targets/IDs/commands in a purely decorative ghost.
    // Hausdepp artwork uses SVG clipPaths: keep their fragment references valid
    // even after the original trick/card has been removed by the next CPU play.
    for (const node of nodes) {
      const id = node.getAttribute("id");
      if (id) { const replacement = `wt-motion-${++copyId}`; ids.set(id, replacement); node.setAttribute("id", replacement); }
      for (const attribute of ["data-wt-card", "data-watten-command", "aria-label", "autofocus"]) node.removeAttribute(attribute);
      if (node.matches("button, input, a, [tabindex]")) node.setAttribute("tabindex", "-1");
    }
    for (const node of nodes) for (const attribute of node.getAttributeNames()) {
      const value = node.getAttribute(attribute);
      const replacement = value.replace(/url\(#([^)]*)\)/g, (match, id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
      node.setAttribute(attribute, ids.has(value.slice(1)) && value.startsWith("#") ? `#${ids.get(value.slice(1))}` : replacement);
    }
    Object.assign(clone.style, { position: "absolute", left: `${pose.left - origin.left}px`, top: `${pose.top - origin.top}px`,
      width: `${pose.width}px`, height: `${pose.height}px`, minWidth: "0", margin: "0", transform: pose.transform, transformOrigin: "center", translate: "none",
      rotate: "none", scale: "none", visibility: "visible", opacity: "1", animation: "none", transition: "none", pointerEvents: "none" });
    parent.append(clone);
    return clone;
  }

  const movement = (from, to) => {
    const a = centre(from), b = centre(to);
    return { translate: `${a.x - b.x}px ${a.y - b.y}px`, scale: String(Math.max(.25, Math.min(2, from.width / to.width))) };
  };

  function fly(element, from, kind, card, delay = 0) {
    const to = element?.getBoundingClientRect();
    if (!enabled() || !element?.isConnected || !usable(from) || !usable(to)) return;
    const job = ghost(kind, to);
    job.from = from; job.startsAt = now() + delay;
    // Opponent i elements obtain their existing back artwork through the same
    // ancestor selector as the real fan; no card face is manufactured.
    if (kind === "deal") job.node.className = "wt-backs";
    copyCard(element, job.node, to, to);
    // A new hand keeps its real hit targets and accessible names throughout
    // the deal. Animation never disables or waits to install a legal action.
    job.releases.push(hide(element, kind === "deal" ? "opacity" : "visibility"));
    if (card) arrivals.set(card, job);
    const start = movement(from, to);
    const frames = delay > 0
      ? [{ ...start, opacity: 0, offset: 0 }, { ...start, opacity: 1, offset: .001 }, { translate: "0 0", scale: "1", opacity: 1, offset: 1 }]
      : [start, { translate: "0 0", scale: "1" }];
    job.animations.push(animate(job.node, frames,
      { duration: FLIGHT, delay, fill: "backwards", easing }, () => {
        if (arrivals.get(card) === job) arrivals.delete(card);
        job.remove();
      }));
  }

  function flip(nodes, captured) {
    for (const node of nodes) {
      const from = captured.rects.get(node.dataset.key), to = node.getBoundingClientRect();
      if (!usable(from) || !usable(to) || Math.abs(from.left - to.left) + Math.abs(from.top - to.top) < 1) continue;
      flips.get(node)?.cancel();
      let entry;
      entry = animate(node, [movement(from, to), { translate: "0 0", scale: "1" }],
        { duration: 180, easing }, () => { if (flips.get(node) === entry) flips.delete(node); });
      flips.set(node, entry);
    }
  }

  const collectionDelay = time => Math.max(0, ...[...ghosts]
    .filter(job => job.node.dataset.wtMotion === "collect").map(job => job.endsAt - time));

  function collect(result, captured, view, time, delay) {
    const last = result.trick.last;
    const target = view.collectionNode(last.winner)?.getBoundingClientRect();
    if (!usable(target)) return false;
    // Only copy faces that this render or the immediately previous public trick
    // actually displayed. A coalesced/reconnect snapshot never fabricates faces.
    const items = last.cards.map(item => {
      const rendered = result.trick.cards.find(card => card.card === item.card && card.seat === item.seat);
      const node = rendered ? result.trick.nodes[result.trick.cards.indexOf(rendered)] : captured.sources.get(item.card);
      const rect = rendered ? node?.getBoundingClientRect() : captured.rects.get(item.card);
      return { ...item, node, rect };
    });
    if (items.length < 2 || items.length > 4 || items.some(item => !item.node || !usable(item.rect))) return false;
    const left = Math.min(...items.map(item => item.rect.left)), top = Math.min(...items.map(item => item.rect.top));
    const bounds = { left, top, width: Math.max(...items.map(item => item.rect.left + item.rect.width)) - left,
      height: Math.max(...items.map(item => item.rect.top + item.rect.height)) - top };
    const job = ghost("collect", bounds, last.winner);
    collectBatchStart ??= time;
    job.endsAt = time + delay + TRICK_TIME;
    // During a queued collection its accepted public originals stay hidden,
    // and the group itself has no paint until the previous trick has left.
    job.node.style.opacity = "0";
    for (const item of items) {
      const arriving = arrivals.get(item.card);
      const created = result.trick.created.some(card => card.card === item.card);
      const from = (arriving ? time < arriving.startsAt ? arriving.from : arriving.node.getBoundingClientRect() : null) || (created
        ? captured.rects.get(item.card) || captured.rects.get(`seat-${item.seat}`) : null);
      arriving?.remove(); arrivals.delete(item.card);
      const clone = copyCard(item.node, job.node, item.rect, bounds);
      if (item.node.isConnected) job.releases.push(hide(item.node));
      if (usable(from)) job.animations.push(animate(clone, [movement(from, item.rect), { translate: "0 0", scale: "1" }], { duration: FLIGHT, delay, easing }));
    }
    const a = centre(bounds), b = centre(target), hold = (FLIGHT + HOLD) / (FLIGHT + HOLD + COLLECT);
    job.animations.push(animate(job.node, [
      { translate: "0 0", scale: "1", opacity: 1, offset: 0 },
      { translate: "0 0", scale: "1", opacity: 1, offset: hold, easing },
      { translate: `${b.x - a.x}px ${b.y - a.y}px`, scale: ".18", opacity: 0, offset: 1 },
    ], { duration: FLIGHT + HOLD + COLLECT, easing: "linear", fill: "forwards" }, () => {
      // The accepted last-trick DOM keeps its geometry for the label, but must
      // not reappear at centre when its decorative flight has finished.
      for (const item of items) {
        if (item.node.isConnected && !settled.has(item.node)) settled.set(item.node, hide(item.node));
      }
      job.remove();
    }, delay));
    return true;
  }

  /** Called only for an accepted snapshot, never for an ACK/busy-only repaint. */
  function present({ previous, engine, live, captured, result, view }) {
    if (!live) { cancel(); return; }
    if (!enabled() || captured?.epoch !== epoch) return;
    for (const [node, release] of settled) {
      if (!result.trick.nodes.includes(node)) { release(); settled.delete(node); }
    }
    const transition = motionTransition(previous, engine, live);
    // A Schöneres replaces only the callers' hands. A role swap also advances
    // deal_revision, but keeps every card and must not pretend to deal them.
    const roles = engine.announcement_roles, priorRoles = previous?.announcement_roles;
    const redeal = !transition.sameDeal && previous?.deal_id === engine.deal_id && roles && priorRoles
      && roles.strike === priorRoles.strike && roles.colour === priorRoles.colour;
    if (transition.deal || redeal) {
      cancel();
      const deck = view.deckNode()?.getBoundingClientRect();
      const callers = new Set([roles?.strike, roles?.colour]);
      const hands = !redeal || callers.has(engine.viewer?.seat) ? result.hand.nodes : [];
      const backs = (view.backNodes?.() || []).filter(node => !redeal || callers.has(Number(node.closest("[data-wt-seat]")?.dataset.wtSeat)));
      [...hands, ...backs].forEach((node, index) => fly(node, deck, "deal", null, (index % 5) * 45));
      return;
    }
    if (!transition.sameDeal) return;
    // The final trick owns the terminal review window. Finish any older queued
    // collection now so neither a match result nor the next deal overtakes it.
    if (["deal_complete", "match_complete"].includes(engine.phase)
      && (transition.collect || !["deal_complete", "match_complete"].includes(previous?.phase))
      && collectionDelay(now()) > 0) cancel();
    flip(result.hand.nodes, captured);
    const time = now(), delay = collectionDelay(time);
    if ((transition.collect || result.trick.created.length) && (delay > TRICK_TIME ||
        (collectBatchStart !== null && time + delay + (transition.collect ? TRICK_TIME : FLIGHT) > collectBatchStart + MAX_PRESENTATION + 1))) {
      // Fast repeated whole tricks must not build a playback archive. Restore
      // the current accepted DOM once a further flight would exceed the budget.
      cancel(); return;
    }
    const collected = transition.collect && result.trick.last && collect(result, captured, view, time, delay);
    const completedCards = collected ? new Set(result.trick.last.cards.map(item => item.card)) : new Set();
    for (const item of result.trick.created) {
      if (!completedCards.has(item.card)) fly(item.node,
        captured.rects.get(item.card) || captured.rects.get(`seat-${item.seat}`), "arrive", item.card, delay);
    }
  }

  return { enabled, cancel, destroy, capture, present,
    collectionActive: () => [...ghosts].some(job => job.node.dataset.wtMotion === "collect"),
    collectionRemaining: () => collectionDelay(now()) };
}
