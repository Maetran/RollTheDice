const seenDeals = new Set();
const peekingGames = new Set();

/** Deal only on a newly observed round; reconnecting never replays old cards. */
export function animateDeal(state, { gameId, playerId }) {
  if (state.phase === "peeking") { peekingGames.add(gameId); return; }
  const deal = state.deal;
  if (!deal?.sequence?.length || !deal.version || state.phase !== "playing") return;
  const key = `hausdepp-deal:${gameId}:${deal.version}`;
  if (seenDeals.has(key)) return;
  seenDeals.add(key);
  let stored = false;
  try { stored = sessionStorage.getItem(key) === "seen"; sessionStorage.setItem(key, "seen"); } catch { /* The in-memory guard still prevents replay. */ }
  const justDealt = state.version === deal.version || peekingGames.has(gameId);
  peekingGames.delete(gameId);
  if (stored || !justDealt || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const source = document.getElementById("hausdeppStock")?.getBoundingClientRect();
  if (!source?.width) return;
  const width = Math.min(66, source.width * .72);
  const height = width * 57 / 36;
  const stagger = Math.min(42, 600 / Math.max(1, deal.sequence.length - 1));
  const ownHand = document.getElementById("hausdeppHand")?.getBoundingClientRect();
  const seats = new Map([...document.querySelectorAll(".hd-seat[data-player-id]")]
    .map(seat => [seat.dataset.playerId, seat.getBoundingClientRect()]));
  const fromX = source.left + (source.width - width) / 2;
  const fromY = source.top + (source.height - height) / 2;
  for (const [index, item] of deal.sequence.entries()) {
    const target = item.player_id === playerId ? ownHand : seats.get(item.player_id);
    if (!target) continue;
    const ghost = document.createElement("div");
    ghost.className = "hd-deal-card";
    ghost.setAttribute("aria-hidden", "true");
    Object.assign(ghost.style, { left: `${fromX}px`, top: `${fromY}px`, width: `${width}px`, height: `${height}px` });
    document.body.append(ghost);
    const x = target.left + target.width / 2 - width / 2 - fromX + (item.hand_index % 3 - 1) * 8;
    const y = target.top + target.height / 2 - height / 2 - fromY;
    const angle = (item.hand_index % 3 - 1) * 7;
    const animation = ghost.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${x}px,${y}px) rotate(${angle}deg)`, opacity: 1, offset: .86 },
      { transform: `translate(${x}px,${y}px) rotate(${angle}deg)`, opacity: 0 },
    ], { duration: 300, delay: index * stagger, fill: "both", easing: "cubic-bezier(.16,1,.3,1)" });
    animation.finished.then(() => ghost.remove()).catch(() => ghost.remove());
  }
}
