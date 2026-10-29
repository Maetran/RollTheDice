/** Current cut at the stock; round history is available only on request. */
export function mountPeekFeedback({ history, text, cards, preview, t, cardMarkup }) {
  let roundKey, previousPhase, signature = "", timer;
  const hidePreview = () => {
    clearTimeout(timer);
    preview.hidden = true;
    preview.replaceChildren();
  };
  const reset = () => {
    hidePreview();
    history.hidden = true;
    history.open = false;
    text.textContent = "";
    cards.replaceChildren();
    signature = "";
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
        hidePreview();
        if (liveCut && state.peek?.player_id === playerId && !state.peek?.success) {
          preview.style.setProperty("--cut-count", known.length);
          preview.innerHTML = known.map(card => cardMarkup(card)).join("");
          preview.hidden = false;
          // Keep the receipt brief; the known cards remain hinted under the
          // stock until they actually leave it. A later tap starts a new cue.
          timer = setTimeout(hidePreview, 1100);
        }
      }
      if (state.phase === "finished") hidePreview();
      previousPhase = state.phase;
    },
    disconnect() { hidePreview(); previousPhase = undefined; signature = ""; },
    destroy: reset,
  };
}
