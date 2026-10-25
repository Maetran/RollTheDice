import { prepareLobbyCardAssets } from "./cards.js";

// A decorative, local hand: it never sends a game action or touches a room.
export function mountLobbyDemo(container, renderCard) {
  if (!container) return () => {};
  const cards = ["hearts", "bells", "leaves", "acorns"].flatMap(suit =>
    ["6", "7", "8", "9", "U", "O", "K", "A", "10"].map(rank => `${suit}-${rank}`));
  const ranks = ["6", "7", "8", "9", "U", "O", "K", "A", "10"];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let hand = ["hearts-U", "acorns-A", "hearts-10"], timer, stopped = false, step = 0;
  let assetsReady = false, preparing = false, assetTimer, assetAttempts = 0;
  container.replaceChildren();
  container.dataset.cardAssets = "loading";
  const nodes = new Map();
  const random = count => Math.floor(Math.random() * count);
  const shuffle = values => {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const other = random(index + 1);
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  };
  let deck = shuffle(cards.filter(card => !hand.includes(card))), packet = [], burned = [];

  function arrange() {
    const firstCard = nodes.get(hand[0]);
    const width = firstCard ? parseFloat(getComputedStyle(firstCard).width) : 112;
    const spacing = Math.min(width * .6, Math.max(0, container.clientWidth - width - 20) / Math.max(1, hand.length - 1));
    // Rotation around the bottom edge pushes the outer top corners farther
    // than the unrotated spacing. Keep that real edge inside the window.
    const angleLimit = 13 * Math.PI / 180;
    const extent = (hand.length - 1) / 2 * spacing + width / 2 * Math.cos(angleLimit) + width * 57 / 36 * Math.sin(angleLimit);
    const centre = container.getBoundingClientRect().left + container.clientWidth / 2;
    const correction = Math.max(8 + extent - centre, Math.min(0, innerWidth - 8 - extent - centre));
    for (const [index, card] of hand.entries()) {
      const node = nodes.get(card);
      if (!node) continue;
      const offset = index - (hand.length - 1) / 2;
      const angle = offset / Math.max(1, (hand.length - 1) / 2) * 13;
      node.style.setProperty("--demo-shift", `${offset * spacing + correction}px`);
      node.style.setProperty("--demo-angle", `${angle}deg`);
      node.style.setProperty("--demo-drop", `${Math.pow(Math.abs(angle) / 13, 2) * 14}px`);
      node.style.zIndex = String(index + 1);
    }
    container.dataset.demoCount = String(hand.length);
  }

  function render(entering = []) {
    hand.sort((a, b) => ranks.indexOf(a.split("-")[1]) - ranks.indexOf(b.split("-")[1]));
    for (const card of hand) {
      if (nodes.has(card)) continue;
      const template = document.createElement("template");
      template.innerHTML = renderCard(card);
      const node = template.content.firstElementChild;
      nodes.set(card, node);
      container.append(node);
      if (entering.includes(card) && !reduced.matches) {
        node.animate([{ opacity: 0, translate: "-28px 22px" }, { opacity: 1, translate: "0 0" }],
          { duration: 380, easing: "cubic-bezier(.2,.7,.3,1)" });
      }
    }
    arrange();
  }

  function schedule() {
    clearTimeout(timer);
    if (!stopped && assetsReady && !document.hidden && !reduced.matches) timer = setTimeout(advance, 3000 + random(1001));
  }

  const rankOf = card => ranks.indexOf(card?.split("-")[1]);
  const legal = card => !packet.length || rankOf(card) === 8 || rankOf(card) >= rankOf(packet.at(-1));
  function appendPacket(card) {
    packet.push(card);
    if (rankOf(card) === 8 || packet.length >= 4 && packet.slice(-4).every(item => rankOf(item) === rankOf(card))) {
      burned.push(...packet); packet = [];
    }
  }
  function freshRound() {
    hand = ["hearts-U", "acorns-A", "hearts-10"];
    deck = shuffle(cards.filter(card => !hand.includes(card)));
    packet = []; burned = [];
    container.replaceChildren(); nodes.clear();
    container.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 450, easing: "ease-out" });
  }
  function otherSeatClears() {
    const ten = deck.find(card => rankOf(card) === 8);
    if (ten) { deck.splice(deck.indexOf(ten), 1); appendPacket(ten); return true; }
    const lastRank = rankOf(packet.at(-1));
    let run = 0;
    for (const card of [...packet].reverse()) { if (rankOf(card) !== lastRank) break; run += 1; }
    const needed = 4 - run;
    const matching = deck.filter(card => rankOf(card) === lastRank).slice(0, needed);
    if (!packet.length || matching.length !== needed) return false;
    for (const card of matching) { deck.splice(deck.indexOf(card), 1); appendPacket(card); }
    return !packet.length;
  }

  function advance() {
    if (stopped || document.hidden || reduced.matches) return;
    // Animation promises can settle after a background/accelerated timer.
    // Retire the previous move before that physical card can return in a pickup.
    for (const node of container.querySelectorAll("[data-demo-leaving]")) {
      for (const animation of node.getAnimations()) animation.cancel();
      node.remove();
    }
    const before = hand.length;
    const leaving = [], entering = [];
    let action = "play", topBefore = packet.at(-1) || "";
    if (!deck.length && hand.length <= 3) {
      // A quiet fresh example is distinct from throwing unrelated cards or
      // pretending to refill from an exhausted stock.
      action = "new-round"; freshRound();
    } else {
      const wantsPickup = hand.length === 3 && packet.length <= 5 && random(4) === 0;
      if (wantsPickup) {
        const contributions = Math.max(0, 3 + random(3) - packet.length);
        // Abstract other seats also obey the visible packet's rank. Prefer
        // low cards, so a new large hand can then play down naturally.
        for (let index = 0; index < contributions; index += 1) {
          const available = deck.filter(card => rankOf(card) !== 8 && legal(card)).sort((a, b) => rankOf(a) - rankOf(b));
          if (!available.length) break;
          const repeated = packet.length >= 3 && packet.slice(-3).every(card => rankOf(card) === rankOf(available[0]));
          const card = repeated ? available.find(item => rankOf(item) > rankOf(available[0])) || available[0] : available[0];
          deck.splice(deck.indexOf(card), 1); appendPacket(card);
        }
      }
      let playable = hand.filter(legal).sort((a, b) => rankOf(a) - rankOf(b));
      const pickup = packet.length && hand.length + packet.length <= 8
        && ((!playable.length) || wantsPickup && (packet.length >= 3 || !deck.length));
      if (pickup) {
        action = "pickup"; entering.push(...packet); packet = []; hand.push(...entering);
      } else {
        if (!playable.length && otherSeatClears()) playable = [...hand].sort((a, b) => rankOf(a) - rankOf(b));
        if (!playable.length || hand.length === 3 && !deck.length) {
          // Some real pickups exceed a compact eight-card demonstration.
          // Start a new example calmly rather than making an illegal play.
          action = "new-round"; freshRound();
        } else {
          topBefore = packet.at(-1) || "";
          const matching = playable.filter(card => rankOf(card) === rankOf(playable[0]));
          const pair = matching.length >= 2 && random(2) === 0
            && deck.length >= Math.max(0, 3 - (hand.length - 2));
          leaving.push(...matching.slice(0, pair ? 2 : 1));
          hand = hand.filter(card => !leaving.includes(card));
          action = pair ? "pair" : "play";
          for (const card of leaving) appendPacket(card);
          const refill = Math.max(0, 3 - hand.length);
          for (let index = 0; index < refill && deck.length; index += 1) entering.push(deck.pop());
          hand.push(...entering);
        }
      }
    }
    for (const card of leaving) {
      const node = nodes.get(card);
      nodes.delete(card);
      if (node) node.dataset.demoLeaving = "true";
      node?.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "48px -36px" }],
        { duration: 300, easing: "ease-in", fill: "forwards" }).finished.then(() => node.remove(), () => node.remove());
    }
    container.dataset.demoAction = action;
    container.dataset.demoStep = String(++step);
    container.dataset.demoBefore = String(before);
    container.dataset.demoTopBefore = topBefore;
    container.dataset.demoOut = JSON.stringify(leaving);
    container.dataset.demoIn = JSON.stringify(entering);
    container.dataset.demoDeck = String(deck.length);
    container.dataset.demoLedger = String(new Set([...hand, ...deck, ...packet, ...burned]).size);
    container.dataset.demoLedgerSize = String(hand.length + deck.length + packet.length + burned.length);
    render(entering);
    schedule();
  }

  const observer = new ResizeObserver(arrange);
  observer.observe(container);
  const loadAssets = async () => {
    if (stopped || assetsReady || preparing) return;
    preparing = true;
    clearTimeout(assetTimer);
    try {
      await prepareLobbyCardAssets();
      if (stopped || !container.isConnected) return;
      assetsReady = true;
      container.dataset.cardAssets = "ready";
      // The first SVG filter evaluation must already have decoded pixels,
      // including a warm reload, rather than first painting empty paper.
      render();
      schedule();
    } catch {
      if (stopped) return;
      container.dataset.cardAssets = "unavailable";
      if (!document.hidden && assetAttempts < 3) {
        assetTimer = setTimeout(() => { void loadAssets(); }, 1000 * 2 ** assetAttempts++);
      }
    } finally { preparing = false; }
  };
  const visibility = () => {
    if (!assetsReady) {
      if (!document.hidden) { assetAttempts = 0; void loadAssets(); }
      return;
    }
    if (document.hidden) {
      for (const animation of container.getAnimations({ subtree: true })) animation.pause();
    } else {
      for (const animation of container.getAnimations({ subtree: true })) {
        if (reduced.matches) animation.finish(); else animation.play();
      }
    }
    schedule();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", visibility);
  reduced.addEventListener("change", visibility);
  void loadAssets();
  return () => {
    stopped = true; clearTimeout(timer); clearTimeout(assetTimer); observer.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("focus", visibility);
    reduced.removeEventListener("change", visibility);
    for (const animation of container.getAnimations({ subtree: true })) animation.cancel();
  };
}
