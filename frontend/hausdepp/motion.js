import { cardArt } from "./cards.js";
import { copyCardScorch } from "./card-scorch.js";
import { createPilePresentation } from "./pile-presentation.js";

const rounds = new Map();
const flights = new Map();
const presentations = new Map();
const launches = new Map();
const pileStates = new Map();
const notifyPile = gameId => window.dispatchEvent(new CustomEvent("hausdepp:pile-presentation", { detail: { gameId } }));
const EASING = "cubic-bezier(.16,1,.3,1)";
const MAX_PRESENTATION_WAIT = 2200;
const PLAY_TRAVEL = 520;
const PLAY_REST = 360;
const PLAY_FADE = 80;
const CARD_RATIO = 36 / 57;
const SHUFFLE_STORAGE_KEY = "hausdepp:shuffle-seen:v1";
const shuffles = new Map();
let seenShuffles;

function rememberShuffle(key) {
  if (!seenShuffles) {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(SHUFFLE_STORAGE_KEY) || "[]"); } catch { saved = []; }
    seenShuffles = new Set(Array.isArray(saved) ? saved.filter(item => typeof item === "string").slice(-79) : []);
  }
  if (seenShuffles.has(key)) return false;
  seenShuffles.add(key);
  if (seenShuffles.size > 80) seenShuffles.delete(seenShuffles.values().next().value);
  try { sessionStorage.setItem(SHUFFLE_STORAGE_KEY, JSON.stringify([...seenShuffles])); } catch { /* Private storage may be unavailable; this page still remembers. */ }
  return true;
}

/** Only the backs move. The real stock stays available throughout the shuffle. */
export function cancelShuffle(gameId) {
  const shuffle = shuffles.get(gameId);
  if (!shuffle) return;
  shuffles.delete(gameId);
  clearTimeout(shuffle.timer);
  for (const animation of shuffle.animations) animation.cancel();
  shuffle.layer.remove();
  window.removeEventListener("resize", shuffle.cancel);
  document.removeEventListener("visibilitychange", shuffle.onVisibility);
  shuffle.motion.removeEventListener("change", shuffle.cancel);
}

/** Present each newly shuffled round once, including a fresh CPU table. */
export function presentShuffle(state, { gameId, roundNumber = 1 }) {
  if (!state) { cancelShuffle(gameId); return; }
  const key = `${gameId}:${roundNumber}`;
  if (state.phase !== "peeking") {
    cancelShuffle(gameId);
    // A late join must never rewind a round that is already being played.
    if (["playing", "finished"].includes(state.phase)) rememberShuffle(key);
    return;
  }
  if (!rememberShuffle(key)) return;
  cancelShuffle(gameId);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const stock = document.getElementById("hausdeppStock");
  const rect = stock?.getBoundingClientRect();
  if (motion.matches || document.hidden || !rect?.width || !rect.height || !stock.animate) return;
  const layer = document.createElement("div");
  layer.className = "hd-shuffle-layer";
  layer.dataset.shuffleKey = key;
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  layer.innerHTML = Array.from({ length: 2 }, () => `<div class="hd-shuffle-half">${'<i class="hd-card-back"></i>'.repeat(3)}</div>`).join("");
  document.body.append(layer);
  const animations = [...layer.children].map((half, index) => {
    const sign = index ? 1 : -1;
    const apart = sign * rect.width * .48;
    return half.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 0 },
      { transform: `translate(${apart}px,-7px) rotate(${sign * 9}deg)`, opacity: 1, offset: .27 },
      { transform: `translate(${sign * rect.width * .16}px,${index ? 3 : -3}px) rotate(${sign * 3}deg)`, opacity: 1, offset: .55 },
      { transform: `translate(${sign * 3}px,0) rotate(0deg)`, opacity: 1, offset: .74 },
      { transform: "translate(0,0) rotate(0deg)", opacity: 1, offset: .87 },
      { transform: "translate(0,0) rotate(0deg)", opacity: 0 },
    ], { duration: 850, easing: "ease-in-out", fill: "both" });
  });
  const cancel = () => cancelShuffle(gameId);
  const onVisibility = () => { if (document.hidden) cancel(); };
  const timer = setTimeout(cancel, 850);
  shuffles.set(gameId, { layer, animations, timer, cancel, onVisibility, motion });
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", cancel);
}

function rectOf(element) {
  const rect = element?.getBoundingClientRect();
  return rect?.width && rect?.height
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height }
    : null;
}

function visibleRect(rect) {
  if (!rect) return null;
  const left = Math.max(0, rect.x - rect.width / 2);
  const top = Math.max(0, rect.y - rect.height / 2);
  const right = Math.min(window.innerWidth, rect.x + rect.width / 2);
  const bottom = Math.min(window.innerHeight, rect.y + rect.height / 2);
  if (right <= left || bottom <= top) return rect;
  return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top };
}

function captureGeometry(playerId) {
  const styles = new Map(), rotations = new Map();
  const styleOf = element => {
    if (!styles.has(element)) styles.set(element, getComputedStyle(element));
    return styles.get(element);
  };
  const rotationOf = element => {
    if (!element) return 0;
    if (rotations.has(element)) return rotations.get(element);
    const style = styleOf(element);
    const matrix = style.transform === "none" ? null : new DOMMatrixReadOnly(style.transform);
    const rotation = (style.rotate || "none").split(" ").at(-1);
    const degrees = (parseFloat(rotation) || 0) * (rotation.endsWith("rad") ? 180 / Math.PI : rotation.endsWith("turn") ? 360 : 1);
    const angle = rotationOf(element.parentElement) + degrees + (matrix ? Math.atan2(matrix.b, matrix.a) * 180 / Math.PI : 0);
    rotations.set(element, angle);
    return angle;
  };
  const cardGeometry = element => {
    const rect = rectOf(element);
    const style = styleOf(element);
    // A rotated bounding box is wider than the paper. Keep its true CSS size
    // and rendered centre separately, including rotation on a pile wrapper.
    const width = parseFloat(style.width) || element.offsetWidth;
    const height = parseFloat(style.height) || element.offsetHeight;
    return { element, card: element.dataset.cardId, rect,
      pose: rect && width > 0 && height > 0 ? { x: rect.x, y: rect.y, width, height, angle: rotationOf(element) } : null };
  };
  const stackGeometry = (id, selector) => {
    const element = document.getElementById(id);
    return { element, rect: rectOf(element), cards: [...(element?.querySelectorAll(selector) || [])].map(cardGeometry) };
  };
  const hands = new Map();
  for (const seat of document.querySelectorAll(".hd-seat[data-player-id]")) {
    const hand = seat.querySelector("[data-player-hand]") || seat;
    hands.set(seat.dataset.playerId, {
      element: hand,
      rect: visibleRect(rectOf(hand)),
      cards: [...hand.querySelectorAll(".hd-opponent-card")].map(cardGeometry),
    });
  }
  const ownHand = document.getElementById("hausdeppHand");
  if (ownHand) {
    hands.set(playerId, {
      element: ownHand,
      rect: visibleRect(rectOf(ownHand)),
      cards: [...ownHand.querySelectorAll("[data-card-id]")].map(cardGeometry),
    });
  }
  return {
    stock: stackGeometry("hausdeppStock", ".hd-stock-card:last-child"),
    pile: stackGeometry("hausdeppPile", ".hausdepp-card"),
    burned: stackGeometry("hausdeppBurnedStack", ".hd-burned-card:last-child"),
    hands,
  };
}

function copyState(state) {
  return {
    version: state.version,
    phase: state.phase,
    hand: [...(state.hand || [])],
    discard: [...(state.discard || [])],
    players: (state.players || []).map(player => ({ id: player.id, hand_count: player.hand_count })),
    peek: state.peek ? { ...state.peek, cards: [...(state.peek.cards || [])] } : null,
    deal: state.deal,
  };
}

/** Capture the old table before rendering an accepted state or a local UI update. */
export function prepareCardMotion(state, { gameId, playerId }) {
  const previous = rounds.get(gameId);
  const resetPresentation = Boolean(previous && state.phase === "peeking" && previous.phase !== "peeking");
  if (!pileStates.has(gameId)) pileStates.set(gameId, createPilePresentation());
  const pile = pileStates.get(gameId);
  const quiet = !previous || resetPresentation || state.version > previous.version + 1 || document.hidden
    || matchMedia("(prefers-reduced-motion: reduce)").matches || !document.body.animate;
  let pileToken = null;
  if (quiet) pile.quiet(state);
  else if (state.version >= previous.version) pileToken = pile.accept(state,
    state.version === previous.version + 1 && (["play", "afterthrow", "gamble", "pickup"].includes(state.last_event?.type)
      || (previous.phase === "peeking" && state.phase === "playing" && state.deal?.version === state.version)));
  return { previous, before: captureGeometry(playerId), version: state.version, pileToken, resetPresentation };
}

export function presentedPile(gameId, state) {
  return pileStates.get(gameId)?.state || { discard: state.discard, burned_count: state.burned_count, pending: false };
}

export function pileMotionPending(gameId) {
  return Boolean(pileStates.get(gameId)?.state.pending || launches.get(gameId)?.size);
}

/**
 * Send the player's own card toward the pile at the tap. Waiting for the
 * server first left a faded copy in the hand and then flew a second one.
 * The accepted state adopts this very element; a rejection removes it.
 */
export function launchOwnPlay(gameId, playerId, cards) {
  if (!cards?.length || document.hidden || !document.body.animate
    || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const geometry = captureGeometry(playerId);
  const hand = geometry.hands.get(playerId);
  const topCard = geometry.pile.cards.at(-1)?.pose;
  const pile = topCard || (geometry.pile.rect && { ...geometry.pile.rect, angle: 0 });
  if (!hand || !pile) return;
  presentationFor(gameId);
  const own = launches.get(gameId) || new Map();
  cards.forEach((card, index) => {
    const pose = hand.cards.find(item => item.card === card)?.pose;
    if (!pose || own.has(card)) return;
    const width = pose.width, height = pose.height || width / CARD_RATIO;
    const left = pose.x - width / 2, top = pose.y - height / 2;
    const spread = cards.length > 1 ? (index - (cards.length - 1) / 2) * Math.min(18, pile.width / 5) : 0;
    const element = document.createElement("div");
    element.className = "hd-deal-card has-face";
    element.setAttribute("aria-hidden", "true");
    element.dataset.motionType = "launch";
    element.innerHTML = cardArt(card);
    copyCardScorch(element, { source: hand.cards.find(item => item.card === card)?.element, card });
    Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    document.body.append(element);
    const end = `translate(${pile.x + spread - pose.x}px,${pile.y - pose.y}px) rotate(${pile.angle || 0}deg) scale(${pile.width / width},${pile.height / height})`;
    const start = `translate(0,0) rotate(${pose.angle || 0}deg)`;
    const animation = element.animate([{ transform: start }, { transform: end }],
      { duration: PLAY_TRAVEL, easing: "cubic-bezier(.22,.61,.36,1)", fill: "forwards" });
    own.set(card, { element, animation, start, left, top, width, height, startedAt: performance.now() });
  });
  if (own.size) launches.set(gameId, own);
}

/** Cards whose picture is already travelling; their hand slot stays empty. */
export function launchedCards(gameId) {
  return new Set(launches.get(gameId)?.keys() || []);
}

/**
 * A rejected or interrupted own play returns the card to the hand. With
 * `returnToHand`, a late afterthrow visibly flies back to its slot (which
 * stays empty meanwhile); `onReturned` then lets the hand show it again.
 */
export function cancelOwnPlay(gameId, cards = null, { returnToHand = false, onReturned } = {}) {
  const own = launches.get(gameId);
  if (!own) return;
  const finish = (card, launch) => {
    launch.animation.cancel();
    launch.back?.cancel();
    launch.element.remove();
    if (own.get(card) === launch) own.delete(card);
    if (!own.size && launches.get(gameId) === own) launches.delete(gameId);
  };
  let returning = 0;
  for (const [card, launch] of [...own]) {
    if (cards && !cards.includes(card)) continue;
    if (!returnToHand || launch.back || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!launch.back) finish(card, launch);
      continue;
    }
    const from = getComputedStyle(launch.element).transform;
    launch.back = launch.element.animate([{ transform: from }, { transform: launch.start }],
      { duration: 260, easing: EASING, fill: "forwards" });
    returning += 1;
    launch.back.finished.then(() => {
      finish(card, launch);
      if (--returning === 0) onReturned?.();
    }, () => {});
  }
}

function adoptLaunches(gameId, cards) {
  const own = launches.get(gameId);
  const adopted = new Map();
  for (const card of cards || []) {
    if (!own?.has(card) || own.get(card).back) continue;
    adopted.set(card, own.get(card));
    own.delete(card);
  }
  if (own && !own.size) launches.delete(gameId);
  return adopted;
}

/** A reconnect starts with a quiet baseline rather than replaying missed actions. */
export function resetCardMotion(gameId) {
  cancelShuffle(gameId);
  rounds.delete(gameId);
  stopPresentation(gameId);
  pileStates.delete(gameId);
}

function stopPresentation(gameId) {
  const presentation = presentations.get(gameId);
  const changed = Boolean(presentation || flights.get(gameId)?.size || launches.get(gameId)?.size
    || pileStates.get(gameId)?.state.pending);
  if (presentation) {
    presentation.mask?.cancel();
    window.removeEventListener("resize", presentation.stop);
    document.removeEventListener("visibilitychange", presentation.onVisibility);
    presentation.motion.removeEventListener("change", presentation.stop);
    for (const cancel of presentation.trackers || []) cancel();
    presentations.delete(gameId);
  }
  for (const flight of flights.get(gameId) || []) {
    flight.animation.cancel();
    flight.reveal?.cancel();
    flight.cue?.cancel();
    flight.element.remove();
  }
  flights.delete(gameId);
  cancelOwnPlay(gameId);
  pileStates.get(gameId)?.settle();
  if (changed) notifyPile(gameId);
}

function presentationFor(gameId) {
  let presentation = presentations.get(gameId);
  if (presentation) return presentation;
  const stop = () => stopPresentation(gameId);
  const onVisibility = () => {
    if (!document.hidden) return;
    stop();
    // Returning to a tab must not replay the last unseen transfer.
    rounds.delete(gameId);
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  presentation = { until: 0, stop, onVisibility, motion, trackers: new Set() };
  presentations.set(gameId, presentation);
  window.addEventListener("resize", stop);
  document.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", stop);
  return presentation;
}

function groupSpan(group) {
  const stagger = Math.min(group.stagger ?? 40, (group.staggerBudget ?? 200) / Math.max(1, group.count - 1));
  return (group.delay || 0) + (group.duration || 380) + Math.max(0, group.count - 1) * stagger;
}

function atCpuTempo(group, fastCpu) {
  if (!fastCpu) return group;
  const paced = { ...group };
  for (const key of ["duration", "travel", "rest", "fade", "delay", "stagger", "staggerBudget"]) {
    if (typeof paced[key] === "number") paced[key] *= .3;
  }
  return paced;
}

function presentGroups(groups, options) {
  groups = groups.map(group => atCpuTempo(group, options.fastCpu));
  if (!groups.length) {
    if (pileStates.get(options.gameId)?.finish(options.pileToken)) notifyPile(options.gameId);
    return;
  }
  if (options.reducedMotion || document.hidden) {
    stopPresentation(options.gameId);
    for (const group of groups) moveCards(group, options);
    return;
  }
  const presentation = presentationFor(options.gameId);
  const now = performance.now();
  const ownLaunch = groups.some(group => group.adopt?.size);
  const ownFlying = ownLaunch || [...(flights.get(options.gameId) || [])].some(flight => flight.ownLaunch && !flight.landed);
  // A fast CPU/human stream can outrun readable motion. Keep the action that
  // is already on the wood, discard only waiting pictures, then show the latest
  // accepted action. Never accumulate seconds of obsolete table history.
  if (!ownFlying && (presentation.until - now > MAX_PRESENTATION_WAIT || pileStates.get(options.gameId)?.queued > 3)) {
    stopPresentation(options.gameId);
    return;
  }
  // The player's own card already left the hand at the tap; it never queues.
  const wait = ownLaunch ? 0 : Math.max(0, presentation.until - now);
  const duration = Math.max(...groups.map(groupSpan));
  const scheduled = { ...options, wait, now };
  const related = groups.flatMap(group => moveCards(group, scheduled));
  trackPileMotion(options.gameId, options.pileToken, related, presentation, ownLaunch);
  presentation.until = now + wait + duration + 70;
}

function trackPileMotion(gameId, token, related, presentation, ownLaunch = false) {
  const pile = pileStates.get(gameId);
  if (!pile?.has(token)) return;
  let frame;
  const waiting = !pile.isFirst(token);
  // Own afterthrows keep flying immediately. Pile mutations still commit in
  // accepted order; a following burn/pickup must wait for its predecessor.
  const heldFlights = waiting ? related.filter(flight => !ownLaunch || flight.target !== "pile") : [];
  const held = [...new Set(heldFlights.flatMap(flight => [flight.animation, flight.reveal, flight.cue]).filter(Boolean))]
    .map(animation => ({ animation, resume: animation.playState === "running" }));
  for (const { animation } of held) animation.pause();
  for (const flight of heldFlights) flight.element.style.visibility = "hidden";
  let released = !waiting;
  const cancel = () => { cancelAnimationFrame(frame); presentation.trackers.delete(cancel); };
  presentation.trackers.add(cancel);
  const check = () => {
    if (!pile.has(token)) { cancel(); return; }
    if (!pile.isFirst(token)) { frame = requestAnimationFrame(check); return; }
    if (!released) {
      released = true;
      for (const { animation, resume } of held) if (resume && animation.playState === "paused") animation.play();
      for (const flight of heldFlights) flight.element.style.visibility = "";
    }
    let changed = false;
    for (const flight of related) {
      const { animation } = flight;
      const finished = ["idle", "finished"].includes(animation.playState);
      const time = typeof animation.currentTime === "number" ? animation.currentTime : -1;
      if (!flight.departed && (finished || time >= flight.startTime)) {
        flight.departed = true;
        if (flight.source === "pile") changed = pile.depart(token, flight.cardId) || changed;
      }
      if (!flight.landed && (finished || time >= flight.arrivalTime)) {
        flight.landed = true;
        if (flight.target === "pile") {
          changed = pile.arrive(token, flight.cardId) || changed;
          // The real paper takes over at arrival, with no resting ghost copy.
          flight.keepUntilLanded = false;
          flight.remove();
        }
      }
    }
    if (related.every(flight => flight.landed)) {
      changed = pile.finish(token) || changed;
      cancel();
    } else frame = requestAnimationFrame(check);
    if (changed) notifyPile(gameId);
  };
  check();
}

function position(geometry, label) {
  return label.startsWith("hand:") ? geometry.hands.get(label.slice(5)) : geometry[label];
}

function fitsHand(rect, handRect) {
  if (!rect || !handRect) return false;
  return rect.x >= handRect.x - handRect.width / 2 && rect.x <= handRect.x + handRect.width / 2
    && rect.y >= handRect.y - handRect.height / 2 && rect.y <= handRect.y + handRect.height / 2;
}

function stationaryReceipt(element) {
  element?.animate?.([
    { outline: "2px solid var(--hd-gold)", outlineOffset: "4px" },
    { outline: "2px solid transparent", outlineOffset: "4px" },
  ], { duration: 240, easing: EASING });
}

function moveCards(group, { gameId, playerId, before, after, reducedMotion, pileToken, wait = 0, now = performance.now() }) {
  const source = group.source === "stock"
    ? position(after, group.source) || position(before, group.source)
    : position(before, group.source) || position(after, group.source);
  const target = position(after, group.target) || position(before, group.target);
  if (!source?.rect || !target?.rect || !group.count) return [];
  const duration = group.duration || 380;
  const delay = wait + (group.delay || 0);
  const stagger = Math.min(group.stagger ?? 40, (group.staggerBudget ?? 200) / Math.max(1, group.count - 1));
  if (group.emit !== false) window.dispatchEvent(new CustomEvent("hausdepp:motion", { detail: {
    type: group.type, source: group.source, target: group.target, count: group.count,
    reducedMotion, from: source.rect, to: target.rect, delay, duration, stagger,
    travel: group.travel || duration * .9, rest: group.rest || 0,
  } }));
  if (reducedMotion) { stationaryReceipt(target.element); return []; }
  if (!document.body.animate) return [];
  const created = [];
  const inHand = group.target.startsWith("hand:");
  const destinationId = inHand ? group.target.slice(5) : null;
  const cue = ["play", "afterthrow"].includes(group.type) ? source.element.animate?.([
    { outline: "2px solid transparent", outlineOffset: "4px" },
    { outline: "2px solid var(--hd-gold)", outlineOffset: "4px", offset: .15 },
    { outline: "2px solid var(--hd-gold)", outlineOffset: "4px", offset: .75 },
    { outline: "2px solid transparent", outlineOffset: "4px" },
  ], { duration, delay, fill: "none", easing: "linear" }) : null;
  for (let index = 0; index < group.count; index += 1) {
    const ownTarget = destinationId === playerId && group.receivedCards?.[index]
      ? target.cards?.find(card => card.card === group.receivedCards[index]) : null;
    const targetCard = ownTarget || (inHand ? target.cards?.[(group.handIndex || 0) + index] : null);
    const cardId = group.cards?.[index];
    const fromCard = (cardId ? source.cards?.find(card => card.card === cardId) : null)
      // Opponent hands carry anonymous backs: use a visible back's pose without
      // assigning any unknown rank or suit to it.
      || (group.source.startsWith("hand:") ? source.cards?.at(-1 - index) : source.cards?.at(-1));
    const pileCard = group.target === "pile" && cardId ? target.cards?.find(card => card.card === cardId) : null;
    const destinationCard = targetCard || pileCard || (!inHand ? target.cards?.at(-1) : null);
    const origin = fromCard?.pose || { ...source.rect, angle: 0 };
    const targetPose = destinationCard?.pose;
    let destination = group.stationary ? origin : targetPose
      || { ...target.rect, width: inHand ? origin.width : target.rect.width,
        height: inHand ? origin.height : target.rect.height, angle: 0 };
    if (!group.stationary && inHand && targetPose && !fitsHand(targetCard?.rect, target.rect)) {
      destination = { ...targetPose, x: target.rect.x, y: target.rect.y };
    }
    // Build each picture at the larger end size and scale it down where it is
    // smaller: an up-scaled layer would blur and inflate its corners.
    const originHeight = origin.height || origin.width / CARD_RATIO;
    const destinationHeight = destination.height || destination.width / CARD_RATIO;
    const larger = destination.width > origin.width;
    const width = group.adopt?.get(cardId)?.width || (larger ? destination.width : origin.width);
    const height = group.adopt?.get(cardId)?.height || (larger ? destinationHeight : originHeight);
    const spread = Math.min(8, Math.max(2, target.rect.width / 12));
    const spreadOffset = group.stationary || destinationCard ? 0 : group.showcase
      ? (index - (group.count - 1) / 2) * Math.min(18, target.rect.width / 5)
      : (index % 3 - 1) * spread;
    const adopted = cardId ? group.adopt?.get(cardId) : null;
    const fromX = adopted ? adopted.left : origin.x - width / 2;
    const fromY = adopted ? adopted.top : origin.y - height / 2;
    const toX = destination.x - width / 2 + spreadOffset;
    const toY = destination.y - height / 2;
    const face = group.face && group.cards?.[index] ? cardArt(group.cards[index]) : "";
    const cardDuration = duration + (group.keepTogether ? (group.count - index - 1) * stagger : 0);
    const ghost = adopted?.element || document.createElement("div");
    ghost.className = `hd-deal-card${face ? " has-face" : ""}`;
    ghost.setAttribute("aria-hidden", "true");
    if (!adopted) ghost.innerHTML = face;
    copyCardScorch(ghost, { source: fromCard?.element || source.element, card: group.face ? cardId : null,
      table: document.getElementById("hausdeppTable") });
    Object.assign(ghost.dataset, {
      motionType: group.type, source: group.source, target: group.target,
      count: String(group.count), index: String(index),
      sourceX: String(origin.x), sourceY: String(origin.y),
      targetX: String(destination.x + spreadOffset), targetY: String(destination.y),
      delay: String(delay + index * stagger), duration: String(cardDuration),
    });
    if (!adopted) {
      Object.assign(ghost.style, {
        left: `${fromX}px`, top: `${fromY}px`, width: `${width}px`, height: `${height}px`,
      });
      // The resting picture of the old pile always lies beneath every moving
      // card, including one that was launched before this picture existed.
      if (group.stationary) ghost.style.zIndex = "64";
      document.body.append(ghost);
    }
    // An adopted launch continues from wherever it is right now.
    const start = adopted ? getComputedStyle(ghost).transform
      : `translate(0,0) rotate(${origin.angle || 0}deg) scale(${origin.width / width},${originHeight / height})`;
    // Native endpoint sizes may differ greatly (tablet packet → small cleared
    // stack). Scaling limits would reintroduce a visible snap at either end.
    const end = `translate(${toX - fromX}px,${toY - fromY}px) rotate(${destination.angle || 0}deg) scale(${destination.width / width},${destinationHeight / height})`;
    const arrival = Math.min(.9, (group.travel || duration * .9) / cardDuration);
    const fade = Math.max(arrival, 1 - (group.fade || PLAY_FADE) / cardDuration);
    const last = group.target === "pile" ? 1 : 0;
    const queued = Boolean(delay + index * stagger);
    const frames = group.stationary ? [
      { transform: end, opacity: queued ? 0 : 1, offset: 0 },
      { transform: end, opacity: 1, offset: .01 },
      { transform: end, opacity: last, offset: 1 },
    ] : [
      // Queued ghosts must not paint at their old source while waiting.
      { transform: start, opacity: queued && !adopted ? 0 : 1, offset: 0 },
      { transform: start, opacity: 1, offset: .01, easing: "cubic-bezier(.22,.61,.36,1)" },
      { transform: end, opacity: 1, offset: arrival },
      { transform: end, opacity: 1, offset: fade },
      { transform: end, opacity: last, offset: 1 },
    ];
    const animation = ghost.animate(frames,
      { duration: cardDuration, delay: delay + index * stagger, fill: "both", easing: "linear" });
    // The launch keeps painting until this flight has taken over its pose.
    if (adopted) adopted.animation.cancel();
    const revealed = targetCard || (group.target === "pile" && !group.stationary && !pileToken ? pileCard : null);
    const reveal = revealed?.element.animate?.(last ? [{ opacity: 0 }, { opacity: 0 }] : [
      { opacity: 0, offset: 0 }, { opacity: 0, offset: .88 }, { opacity: 1, offset: 1 },
    ], { duration: delay + index * stagger + cardDuration, fill: "none", easing: EASING });
    const flight = { animation, reveal, cue, element: ghost,
      cardId, source: group.source, target: group.target, startTime: delay + index * stagger,
      ownLaunch: Boolean(adopted), keepUntilLanded: Boolean(pileToken && group.target === "pile"),
      arrivalTime: group.stationary ? null : delay + index * stagger + arrival * cardDuration,
      sequenceStart: now + wait,
      startAt: now + delay + index * stagger, endAt: now + delay + index * stagger + cardDuration };
    if (!flights.has(gameId)) flights.set(gameId, new Set());
    flights.get(gameId).add(flight);
    created.push(flight);
    const remove = () => {
      ghost.remove();
      flights.get(gameId)?.delete(flight);
      if (!flights.get(gameId)?.size) flights.delete(gameId);
    };
    flight.remove = remove;
    // A concurrent afterthrow may reach the wood before a paused predecessor.
    // Keep its single picture there until ordered pile handover can take over.
    animation.finished.then(() => { if (!flight.keepUntilLanded) remove(); }, remove);
  }
  return created;
}

const REVEAL_TRAVEL = 450;
const REVEAL_HOLD = 1300;

/**
 * A successful cut is public: every seat sees the won cards rise face up from
 * the stock to the table centre, read who receives them, and follow them into
 * that hand before the ordinary deal begins. Returns the time it occupies.
 */
function revealPeek(state, { gameId, playerId, before, after, reducedMotion, peekCaption }) {
  const cards = state.peek?.cards || [];
  const receiver = state.peek?.player_id;
  const stock = after.stock || before.stock;
  const hand = after.hands.get(receiver);
  // Between both live piles: neither is in use while the cut is shown.
  const centre = after.pile?.rect && stock?.rect
    ? { x: (after.pile.rect.x + stock.rect.x) / 2, y: after.pile.rect.y }
    : after.pile?.rect || stock?.rect;
  if (!cards.length || !stock?.rect || !hand?.rect || !centre) return 0;
  const total = REVEAL_TRAVEL * 2 + REVEAL_HOLD;
  const caption = document.createElement("p");
  caption.className = "hd-peek-caption";
  caption.setAttribute("role", "status");
  caption.textContent = peekCaption?.(receiver, cards) || "";
  document.body.append(caption);
  const origin = stock.cards.at(-1)?.pose || { ...stock.rect, angle: 0 };
  const width = origin.width, height = origin.height || width / CARD_RATIO;
  // Every face stays readable, and the fan never leaves the screen.
  const spread = cards.length > 1
    ? Math.min(width * .7, Math.max(0, (innerWidth - 16 - width * 1.08) / (cards.length - 1))) : 0;
  Object.assign(caption.style, { left: `${centre.x}px`, top: `${centre.y + height * .62}px` });
  const register = (element, animation, reveal = null) => {
    const flight = { animation, reveal, cue: null, element, sequenceStart: performance.now(),
      startAt: performance.now(), endAt: performance.now() + total };
    if (!flights.has(gameId)) flights.set(gameId, new Set());
    flights.get(gameId).add(flight);
    const remove = () => { element.remove(); flights.get(gameId)?.delete(flight); };
    animation.finished.then(remove, remove);
  };
  const captionFrames = [{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: 1, offset: .9 }, { opacity: 0 }];
  if (reducedMotion || !document.body.animate) {
    // The public information still needs faces when travel is disabled.
    // Fit complete cards beside one another, with no movement or overlap.
    presentationFor(gameId);
    const hold = element => {
      let finish;
      const finished = new Promise(resolve => { finish = resolve; });
      const timer = setTimeout(finish, total);
      register(element, { finished, cancel() { clearTimeout(timer); finish(); } });
    };
    const gap = 6;
    const faceWidth = Math.min(width * 1.08, (innerWidth - 16 - gap * (cards.length - 1)) / cards.length);
    const faceHeight = faceWidth / CARD_RATIO;
    const groupWidth = faceWidth * cards.length + gap * (cards.length - 1);
    const left = Math.min(Math.max(centre.x - groupWidth / 2, 8), innerWidth - 8 - groupWidth);
    const top = Math.min(Math.max(centre.y - faceHeight / 2, 8), innerHeight - 8 - faceHeight);
    Object.assign(caption.style, { left: `${left + groupWidth / 2}px`, top: `${top + faceHeight + 8}px` });
    hold(caption);
    cards.forEach((card, index) => {
      const face = document.createElement("div");
      face.className = "hd-deal-card has-face";
      face.setAttribute("aria-hidden", "true");
      Object.assign(face.dataset, { motionType: "peek-reveal", target: `hand:${receiver}` });
      face.innerHTML = cardArt(card);
      copyCardScorch(face, { card, table: document.getElementById("hausdeppTable") });
      Object.assign(face.style, { left: `${left + index * (faceWidth + gap)}px`, top: `${top}px`,
        width: `${faceWidth}px`, height: `${faceHeight}px` });
      document.body.append(face);
      hold(face);
    });
    stationaryReceipt(hand.element);
    return total;
  }
  register(caption, caption.animate(captionFrames, { duration: total, fill: "both" }));
  cards.forEach((card, index) => {
    const offset = (index - (cards.length - 1) / 2) * spread;
    const target = receiver === playerId ? hand.cards.find(item => item.card === card)
      : hand.cards[index];
    const landing = target?.pose || { ...hand.rect, width, height, angle: 0 };
    const ghost = document.createElement("div");
    ghost.className = "hd-deal-card has-face";
    ghost.setAttribute("aria-hidden", "true");
    Object.assign(ghost.dataset, { motionType: "peek-reveal", target: `hand:${receiver}` });
    ghost.innerHTML = cardArt(card);
    copyCardScorch(ghost, { card, table: document.getElementById("hausdeppTable") });
    Object.assign(ghost.style, { left: `${origin.x - width / 2}px`, top: `${origin.y - height / 2}px`,
      width: `${width}px`, height: `${height}px` });
    document.body.append(ghost);
    const at = (pose, angle = pose.angle || 0) =>
      `translate(${pose.x - origin.x}px,${pose.y - origin.y}px) rotate(${angle}deg) scale(${pose.width / width},${(pose.height || pose.width / CARD_RATIO) / height})`;
    const shown = { x: Math.min(Math.max(centre.x + offset, 8 + width * .54), innerWidth - 8 - width * .54),
      y: centre.y, width: width * 1.08, height: height * 1.08 };
    const rise = REVEAL_TRAVEL / total, leave = (REVEAL_TRAVEL + REVEAL_HOLD) / total;
    const animation = ghost.animate([
      { transform: at(origin), offset: 0, easing: "cubic-bezier(.22,.61,.36,1)" },
      { transform: at(shown, (index - (cards.length - 1) / 2) * 4), offset: rise },
      { transform: at(shown, (index - (cards.length - 1) / 2) * 4), offset: leave, easing: "cubic-bezier(.22,.61,.36,1)" },
      { transform: at(landing), offset: 1 },
    ], { duration: total, fill: "both", easing: "linear" });
    // The real hand card appears exactly when its picture arrives.
    const reveal = target?.element.animate?.([{ opacity: 0 }, { opacity: 0 }], { duration: total, fill: "none" });
    register(ghost, animation, reveal);
  });
  return total;
}

function receivingGroup(type, source, actorId, count, state, previous, extra = {}) {
  const oldCount = previous.players.find(player => player.id === actorId)?.hand_count || 0;
  const receivedCards = state.hand.filter(card => !previous.hand.includes(card));
  return {
    type, source, target: `hand:${actorId}`, count, handIndex: oldCount,
    receivedCards: actorId === state.viewer_id ? receivedCards : undefined,
    ...extra,
  };
}

/** Explain each new accepted card transfer after rendering its destination. */
export function animateCardMotion(state, context, prepared) {
  explainAcceptedState(state, context, prepared);
  // A launched card that left the hand without being adopted (skipped or
  // quiet versions) has nothing more to explain; it stays on the pile.
  const own = launches.get(context.gameId);
  if (own) cancelOwnPlay(context.gameId, [...own.keys()].filter(card => !state.hand?.includes(card)));
}

/** Resolve at the actual arrival keyframe, before the resting/fading picture. */
export function cardMotionCompletion(gameId, { signal } = {}) {
  const active = [...(flights.get(gameId) || [])]
    .filter(flight => flight.arrivalTime != null && flight.animation.playState !== "idle");
  if (!active.length) return null;
  return new Promise(resolve => {
    let frame;
    const finish = () => {
      cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const check = () => {
      // Inspect WAAPI progress: paused/slowed flights cannot be overtaken by a
      // wall-clock estimate, and the last burn/pickup arrival counts as well.
      const arrived = active.every(({ animation, arrivalTime }) =>
        ["finished", "idle"].includes(animation.playState)
        || (typeof animation.currentTime === "number" && animation.currentTime >= arrivalTime));
      if (signal?.aborted || arrived) finish();
      else frame = requestAnimationFrame(check);
    };
    signal?.addEventListener("abort", finish, { once: true });
    check();
  });
}

function explainAcceptedState(state, { gameId, playerId, peekCaption, fastCpu = false }, prepared) {
  const previous = prepared?.previous;
  if (previous && state.version < previous.version) return;
  const current = copyState(state);
  rounds.set(gameId, current);
  // First load, reload, skipped versions and UI-only renders are quiet by design.
  if (!previous || prepared.resetPresentation || state.version !== previous.version + 1 || document.hidden) {
    if (!previous || prepared.resetPresentation || state.version !== previous.version || document.hidden) stopPresentation(gameId);
    return;
  }
  const before = prepared.before;
  const after = captureGeometry(playerId);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const event = state.last_event || {};
  const options = { gameId, playerId, before, after, reducedMotion, pileToken: prepared.pileToken, fastCpu };
  const actorId = event.player_id;
  const receivedState = { ...state, viewer_id: playerId };
  const groups = [];
  const playDuration = PLAY_TRAVEL + PLAY_REST + PLAY_FADE;
  const publicCard = { face: true, duration: playDuration, travel: PLAY_TRAVEL,
    rest: PLAY_REST, fade: PLAY_FADE, stagger: 80, staggerBudget: 240,
    showcase: true, keepTogether: true };

  if (previous.phase === "peeking" && state.phase === "playing" && state.deal?.version === state.version) {
    const peekCards = state.peek?.success ? state.peek.cards || [] : [];
    const revealed = peekCards.length ? revealPeek(state, { ...options, peekCaption }) : 0;
    const sequence = state.deal.sequence || [];
    const stagger = Math.min(32, 350 / Math.max(1, sequence.length - 1));
    const baseDelay = peekCards.length ? revealed + 80 : 0;
    const ownDeal = state.hand.filter(card => !peekCards.includes(card));
    let ownIndex = 0;
    for (const [index, item] of sequence.entries()) {
      moveCards({ type: "deal", source: "stock", target: `hand:${item.player_id}`, count: 1,
        handIndex: item.hand_index, receivedCards: item.player_id === playerId ? [ownDeal[ownIndex++]] : undefined,
        duration: 350, delay: baseDelay + index * stagger }, options);
    }
    const starter = moveCards({ type: "starter", source: "stock", target: "pile", count: 1,
      cards: [state.deal.starter], face: true, duration: 340,
      delay: baseDelay + Math.max(0, sequence.length - 1) * stagger + 120 }, options);
    if (!reducedMotion) trackPileMotion(gameId, prepared.pileToken, starter, presentationFor(gameId));
    return;
  }

  if (event.type === "draw") {
    // Refilling is a separate hand receipt. It must not erase or postpone the
    // public card being read on the pile, nor visually delay a playable hand.
    moveCards(atCpuTempo(receivingGroup("draw", "stock", actorId, event.drawn_count || 0, receivedState, previous,
      { duration: 380, stagger: 55, staggerBudget: 110 }), fastCpu), options);
  } else if (event.type === "pickup") {
    groups.push(receivingGroup("pickup", "pile", actorId, event.picked_up_count || 0, receivedState, previous,
      { cards: previous.discard, face: actorId === playerId, duration: 400, stagger: 20, staggerBudget: 240 }));
  } else if (event.type === "gamble") {
    groups.push({ type: "gamble", source: "stock", target: "pile", count: event.cards?.length || 1,
      cards: event.cards, ...publicCard });
    if (!event.success) {
      groups.push(receivingGroup("pickup", "pile", actorId, event.picked_up_count || 0, receivedState, previous,
        { cards: [...previous.discard, ...(event.cards || [])], face: actorId === playerId,
          // Leave the pile the moment the gambled card has been read: a gap
          // would show the old packet without it.
          delay: groupSpan(groups[0]), duration: 360, stagger: 16, staggerBudget: 160 }));
    }
  } else if (event.type === "play" || event.type === "afterthrow") {
    const adopt = actorId === playerId && !reducedMotion ? adoptLaunches(gameId, event.cards) : new Map();
    // An adopted card is already under way: only its remaining travel is left.
    const elapsed = adopt.size ? performance.now() - Math.min(...[...adopt.values()].map(launch => launch.startedAt)) : 0;
    const travel = adopt.size ? Math.max(160, PLAY_TRAVEL - elapsed) : PLAY_TRAVEL;
    groups.push({ type: event.type, source: `hand:${actorId}`, target: "pile", count: event.cards?.length || 0,
      cards: event.cards, ...publicCard,
      ...(adopt.size ? { adopt, travel, duration: travel + PLAY_REST + PLAY_FADE, stagger: 0 } : {}) });
  }
  if (event.burn_reason) {
    const play = groups.find(group => ["play", "afterthrow", "gamble"].includes(group.type));
    groups.push({ type: "burn", source: "pile", target: "burned", count: event.burned_count || 0,
      cards: [...previous.discard, ...(event.cards || [])], face: true, duration: 480,
      delay: play ? groupSpan(play) : 0, stagger: 8, staggerBudget: 100 });
  }
  presentGroups(groups, options);
}
