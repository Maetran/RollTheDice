/** Current cut at the stock; round history is available only on request. */
export function mountPeekFeedback({ history, text, cards, announce, fan, t, cardMarkup, cardName }) {
  let roundKey, previousPhase, signature = "", seen = [], timer;
  const quiet = () => {
    clearTimeout(timer);
    announce.textContent = "";
  };
  const reset = () => {
    quiet();
    fan?.stop();
    history.hidden = true;
    history.open = false;
    text.textContent = "";
    cards.replaceChildren();
    signature = "";
    seen = [];
    previousPhase = undefined;
  };
  return {
    update(state, key, playerId) {
      if (!state) { reset(); roundKey = undefined; return; }
      if (roundKey !== key) { reset(); roundKey = key; }
      const known = (state.peek?.success ? state.peek.cards : state.private_peek) || [];
      const next = JSON.stringify([state.phase === "peeking", known, state.peek?.success]);
      if (!known.length) {
        reset();
      } else if (next !== signature) {
        signature = next;
        history.hidden = false;
        text.textContent = t(state.peek?.success ? "peekSuccess" : state.phase === "peeking" ? "peekAce" : "peekPrivate");
        cards.innerHTML = known.map(card => cardMarkup(card)).join("");
        // A reload of a dealt round restores its history quietly. Only a live
        // cut may show a private receipt; successes already have a public reveal.
        const liveCut = state.phase === "peeking" || previousPhase === "peeking";
        // Only faces seen by this tap travel; an earlier ace already rests under the stock.
        const fresh = known.filter(card => !seen.includes(card));
        seen = [...known];
        if (liveCut && state.peek?.player_id === playerId && !state.peek?.success && fresh.length) {
          fan?.reveal(fresh);
          quiet();
          announce.textContent = `${t("peekTitle")}: ${fresh.map(cardName).join(", ")}`;
          // Clear the polite receipt so an identical later cut is announced again.
          timer = setTimeout(quiet, 4000);
        }
      }
      if (state.phase === "finished") { quiet(); fan?.stop(); }
      previousPhase = state.phase;
    },
    disconnect() { quiet(); fan?.stop(); previousPhase = undefined; signature = ""; },
    destroy: reset,
  };
}
