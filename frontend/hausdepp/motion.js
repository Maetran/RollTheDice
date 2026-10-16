import { cardArt } from "./cards.js";

const rounds = new Map();
const flights = new Map();
const EASING = "cubic-bezier(.16,1,.3,1)";
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
  const hands = new Map();
  for (const seat of document.querySelectorAll(".hd-seat[data-player-id]")) {
    const hand = seat.querySelector("[data-player-hand]") || seat;
    hands.set(seat.dataset.playerId, {
      element: hand,
      rect: visibleRect(rectOf(hand)),
      cards: [...hand.querySelectorAll(".hd-opponent-card")].map(element => ({ element, rect: rectOf(element) })),
    });
  }
  const ownHand = document.getElementById("hausdeppHand");
  if (ownHand) {
    hands.set(playerId, {
      element: ownHand,
      rect: visibleRect(rectOf(ownHand)),
      cards: [...ownHand.querySelectorAll("[data-card-id]")].map(element => ({
        element, card: element.dataset.cardId, rect: rectOf(element),
      })),
    });
  }
  return {
    stock: { element: document.getElementById("hausdeppStock"), rect: rectOf(document.getElementById("hausdeppStock")) },
    pile: { element: document.getElementById("hausdeppPile"), rect: rectOf(document.getElementById("hausdeppPile")) },
    burned: { element: document.querySelector(".hd-burned"), rect: rectOf(document.querySelector(".hd-burned")) },
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
  return { previous: rounds.get(gameId), before: captureGeometry(playerId), version: state.version };
}

/** A reconnect starts with a quiet baseline rather than replaying missed actions. */
export function resetCardMotion(gameId) {
  cancelShuffle(gameId);
  rounds.delete(gameId);
  for (const flight of flights.get(gameId) || []) {
    flight.animation.cancel();
    flight.reveal?.cancel();
    flight.element.remove();
  }
  flights.delete(gameId);
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

function moveCards(group, { gameId, playerId, before, after, reducedMotion }) {
  const source = group.source === "stock"
    ? position(after, group.source) || position(before, group.source)
    : position(before, group.source) || position(after, group.source);
  const target = position(after, group.target) || position(before, group.target);
  if (!source?.rect || !target?.rect || !group.count) return;
  const duration = group.duration || 380;
  const delay = group.delay || 0;
  const stagger = Math.min(group.stagger ?? 40, (group.staggerBudget ?? 200) / Math.max(1, group.count - 1));
  window.dispatchEvent(new CustomEvent("hausdepp:motion", { detail: {
    type: group.type, source: group.source, target: group.target, count: group.count,
    reducedMotion, from: source.rect, to: target.rect, delay, duration,
  } }));
  if (reducedMotion) { stationaryReceipt(target.element); return; }
  if (!document.body.animate) return;
  const width = Math.max(30, Math.min(80, source.rect.width, target.rect.width,
    group.source === "stock" || group.source === "pile" ? source.rect.width * .86 : 74));
  const height = width / CARD_RATIO;
  const inHand = group.target.startsWith("hand:");
  const destinationId = inHand ? group.target.slice(5) : null;
  for (let index = 0; index < group.count; index += 1) {
    const ownTarget = destinationId === playerId && group.receivedCards?.[index]
      ? target.cards?.find(card => card.card === group.receivedCards[index]) : null;
    const targetCard = ownTarget || (inHand ? target.cards?.[(group.handIndex || 0) + index] : null);
    const fromCard = group.source.startsWith("hand:") && group.cards?.[index]
      ? source.cards?.find(card => card.card === group.cards[index]) : null;
    const origin = fromCard?.rect || source.rect;
    const destination = fitsHand(targetCard?.rect, target.rect) ? targetCard.rect : target.rect;
    const spread = Math.min(8, Math.max(2, target.rect.width / 12));
    const spreadOffset = targetCard ? 0 : (index % 3 - 1) * spread;
    const fromX = origin.x - width / 2;
    const fromY = origin.y - height / 2;
    const toX = destination.x - width / 2 + spreadOffset;
    const toY = destination.y - height / 2;
    const face = group.face && group.cards?.[index] ? cardArt(group.cards[index]) : "";
    const ghost = document.createElement("div");
    ghost.className = `hd-deal-card${face ? " has-face" : ""}`;
    ghost.setAttribute("aria-hidden", "true");
    ghost.innerHTML = face;
    Object.assign(ghost.dataset, {
      motionType: group.type, source: group.source, target: group.target,
      count: String(group.count), index: String(index),
      sourceX: String(origin.x), sourceY: String(origin.y),
      targetX: String(destination.x + spreadOffset), targetY: String(destination.y),
      delay: String(delay + index * stagger), duration: String(duration),
    });
    Object.assign(ghost.style, {
      left: `${fromX}px`, top: `${fromY}px`, width: `${width}px`, height: `${height}px`,
    });
    document.body.append(ghost);
    const angle = inHand ? (index % 3 - 1) * 5 : 0;
    const destinationWidth = targetCard?.element.offsetWidth
      || (inHand ? width : Math.min(112, target.rect.width));
    const endScale = Math.max(.25, Math.min(1.8, destinationWidth / width));
    const end = `translate(${toX - fromX}px,${toY - fromY}px) rotate(${angle}deg) scale(${endScale})`;
    const animation = ghost.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: end, opacity: 1, offset: .9 },
      { transform: end, opacity: 0 },
    ], { duration, delay: delay + index * stagger, fill: "both", easing: EASING });
    // The real card is already interactive; the visual arrival alone follows the flight.
    const reveal = targetCard?.element.animate?.([
      { opacity: 0, offset: 0 }, { opacity: 0, offset: .88 }, { opacity: 1, offset: 1 },
    ], { duration: delay + index * stagger + duration, fill: "none", easing: EASING });
    const flight = { animation, reveal, element: ghost };
    if (!flights.has(gameId)) flights.set(gameId, new Set());
    flights.get(gameId).add(flight);
    const remove = () => {
      ghost.remove();
      flights.get(gameId)?.delete(flight);
      if (!flights.get(gameId)?.size) flights.delete(gameId);
    };
    animation.finished.then(remove, remove);
  }
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
export function animateCardMotion(state, { gameId, playerId }, prepared) {
  const previous = prepared?.previous;
  if (previous && state.version < previous.version) return;
  const current = copyState(state);
  rounds.set(gameId, current);
  // First load, reload, skipped versions and UI-only renders are quiet by design.
  if (!previous || state.version !== previous.version + 1 || document.hidden) return;
  const before = prepared.before;
  const after = captureGeometry(playerId);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const options = { gameId, playerId, before, after, reducedMotion };
  const event = state.last_event || {};
  const actorId = event.player_id;
  const receivedState = { ...state, viewer_id: playerId };

  if (previous.phase === "peeking" && state.phase === "playing" && state.deal?.version === state.version) {
    const peekCards = state.peek?.success ? state.peek.cards || [] : [];
    if (peekCards.length) {
      moveCards(receivingGroup("peek", "stock", state.peek.player_id, peekCards.length, receivedState, previous,
        { cards: peekCards, receivedCards: state.peek.player_id === playerId ? peekCards : undefined,
          face: state.peek.player_id === playerId, duration: 300, stagger: 28, staggerBudget: 90 }), options);
    }
    const sequence = state.deal.sequence || [];
    const stagger = Math.min(32, 350 / Math.max(1, sequence.length - 1));
    const baseDelay = peekCards.length ? 80 : 0;
    const ownDeal = state.hand.filter(card => !peekCards.includes(card));
    let ownIndex = 0;
    for (const [index, item] of sequence.entries()) {
      moveCards({ type: "deal", source: "stock", target: `hand:${item.player_id}`, count: 1,
        handIndex: item.hand_index, receivedCards: item.player_id === playerId ? [ownDeal[ownIndex++]] : undefined,
        duration: 350, delay: baseDelay + index * stagger }, options);
    }
    moveCards({ type: "starter", source: "stock", target: "pile", count: 1,
      cards: [state.deal.starter], face: true, duration: 340,
      delay: baseDelay + Math.max(0, sequence.length - 1) * stagger + 120 }, options);
    return;
  }

  if (event.type === "draw") {
    moveCards(receivingGroup("draw", "stock", actorId, event.drawn_count || 0, receivedState, previous,
      { duration: 380, stagger: 55, staggerBudget: 110 }), options);
  } else if (event.type === "pickup") {
    moveCards(receivingGroup("pickup", "pile", actorId, event.picked_up_count || 0, receivedState, previous,
      { cards: previous.discard, face: actorId === playerId, duration: 400, stagger: 20, staggerBudget: 240 }), options);
  } else if (event.type === "gamble") {
    moveCards({ type: "gamble", source: "stock", target: "pile", count: event.cards?.length || 1,
      cards: event.cards, face: true, duration: 320 }, options);
    if (!event.success) {
      moveCards(receivingGroup("pickup", "pile", actorId, event.picked_up_count || 0, receivedState, previous,
        { cards: [...previous.discard, ...(event.cards || [])], face: actorId === playerId,
          delay: 380, duration: 360, stagger: 16, staggerBudget: 160 }), options);
    }
  } else if (event.type === "play" || event.type === "afterthrow") {
    moveCards({ type: event.type, source: `hand:${actorId}`, target: "pile", count: event.cards?.length || 0,
      cards: event.cards, face: true, duration: 360, stagger: 35, staggerBudget: 105 }, options);
  }
  if (event.burn_reason) {
    const playedCount = event.cards?.length || 1;
    moveCards({ type: "burn", source: "pile", target: "burned", count: event.burned_count || 0,
      cards: [...previous.discard, ...(event.cards || [])], face: true, duration: 300,
      delay: event.type === "gamble" ? 260 : 280 + Math.min(105, (playedCount - 1) * 35),
      stagger: 10, staggerBudget: 100 }, options);
  }
}
