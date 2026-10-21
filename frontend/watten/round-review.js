// Only presentation is timed here. The accepted server checkpoint owns the
// review deadline, the next deal and every legal action, including after reload.
export function createRoundReview({ onChange, motion, now = () => performance.now(),
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let key = "", collectUntil = 0, reviewUntil = 0, timer = null, stage = "ready";
  function cancel() { if (timer !== null) unschedule(timer); timer = null; }
  function refresh() {
    cancel();
    const time = now(), active = Boolean(key && motion?.collectionActive?.());
    if (active) {
      collectUntil = Math.max(collectUntil, time + (motion.collectionRemaining?.() || 0));
      reviewUntil = Math.max(reviewUntil, collectUntil + 3000);
    }
    const next = !key ? "ready" : time < collectUntil || active ? "collect" : time < reviewUntil ? "review" : "ready";
    const changed = stage !== next; stage = next;
    const deadline = stage === "collect" ? collectUntil : reviewUntil;
    if (stage !== "ready") timer = schedule(() => { timer = null; if (refresh()) onChange?.(); }, Math.max(20, deadline - time));
    return changed;
  }
  return {
    update(snapshot, accepted = false) {
      const review = snapshot?.round_review, engine = snapshot?.engine;
      const valid = review && review.deal_id === engine?.deal_id
        && ["deal_complete", "match_complete"].includes(engine?.phase)
        && Number.isFinite(review.collect_remaining_ms) && Number.isFinite(review.review_remaining_ms);
      const next = valid ? `${review.deal_id}:${review.started_at}` : "";
      if (next !== key) {
        key = next;
        collectUntil = valid ? now() + Math.max(0, review.collect_remaining_ms) : 0;
        reviewUntil = valid ? now() + Math.max(0, review.review_remaining_ms) : 0;
      } else if (valid && accepted) {
        // A repeated projection can shorten the public deadline, never restart it.
        collectUntil = Math.min(collectUntil, now() + Math.max(0, review.collect_remaining_ms));
        reviewUntil = Math.min(reviewUntil, now() + Math.max(0, review.review_remaining_ms));
      }
      refresh();
      return { stage, autoAdvance: review?.auto_advance === true, blocked: review?.blocked || null };
    },
    afterMotion() { if (refresh()) onChange?.(); },
    discard() { cancel(); key = ""; stage = "ready"; collectUntil = reviewUntil = 0; },
  };
}
