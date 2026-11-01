/** Public presentation only. Accepted state and card legality stay on the server. */
export function createPilePresentation() {
  let latest = null, discard = [], burned = 0;
  const pending = new Map();
  const projection = state => ({ version: state.version, discard: [...(state.discard || [])], burned_count: state.burned_count || 0,
    phase: state.phase, current_player_id: state.current_player_id,
    clearance_player_id: state.last_event?.burn_reason ? state.last_event.player_id : null });
  const settle = () => {
    pending.clear();
    discard = [...(latest?.discard || [])];
    burned = latest?.burned_count || 0;
  };
  return {
    accept(state, animate = false) {
      if (latest && state.version <= latest.version) return null;
      latest = projection(state);
      if (!animate) {
        if (!pending.size) settle();
        return null;
      }
      const token = {};
      pending.set(token, latest);
      return token;
    },
    quiet(state) { latest = projection(state); settle(); },
    has(token) { return pending.has(token); },
    isFirst(token) { return pending.keys().next().value === token; },
    canReplay(playerId, version) {
      // A private refill may arrive during a burn. The newest public transfer
      // still identifies whose clearance kept this empty table and turn.
      const publicState = [...pending.values()].at(-1);
      return latest?.version === version && latest?.phase === "playing" && latest.current_player_id === playerId && !latest.discard.length
        && publicState?.clearance_player_id === playerId;
    },
    get queued() { return pending.size; },
    arrive(token, card) {
      if (!pending.has(token) || !card || discard.includes(card)) return false;
      discard.push(card);
      return true;
    },
    depart(token, card) {
      if (!pending.has(token) || !discard.includes(card)) return false;
      discard = discard.filter(item => item !== card);
      return true;
    },
    finish(token) {
      const accepted = pending.get(token);
      if (!accepted) return false;
      pending.delete(token);
      burned = Math.max(burned, accepted.burned_count);
      if (!pending.size) settle();
      return true;
    },
    settle,
    get state() { return { discard: [...discard], burned_count: burned, pending: pending.size > 0 }; },
  };
}
