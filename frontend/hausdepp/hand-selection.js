const rankOf = card => card.split("-")[1];

// A selection belongs to one observed opportunity, never to a future turn.
// The only advancing version we can prove harmless is a single foreign refill
// with the full visible hand, actions and table opportunity unchanged.
export function createHandSelection() {
  let enabled = false, context = null, notice = "";
  const cards = new Set();
  const clear = () => cards.clear();
  return {
    get enabled() { return enabled; },
    get cards() { return [...cards]; },
    get notice() { return notice; },
    get canEnable() { return !!context?.action && !context.pending; },
    sync(next) {
      if (cards.size) {
        const harmlessRefill = context && context.roundKey === next.roundKey &&
          next.version === context.version + 1 && next.event?.type === "draw" && !!next.event.player_id && !!next.viewer &&
          next.event.player_id !== next.viewer && context.identity === next.identity;
        const changed = !context || (context.key !== next.key && !harmlessRefill) || context.identity !== next.identity || context.action !== next.action ||
          [...cards].some(card => !next.hand.includes(card) || !next.playable.includes(card));
        if (changed) {
          notice = context?.action === "afterthrow" && next.action !== "afterthrow"
            ? "multiAfterthrowExpired" : "multiSelectionUpdated";
          clear();
          // A selection serves one throw only; a closed opportunity ends it.
          enabled = false;
        }
      }
      context = next;
      if (next.phase !== "playing") { enabled = false; clear(); notice = ""; }
    },
    toggle() {
      if (!enabled && !this.canEnable) return;
      enabled = !enabled;
      clear();
      notice = "";
    },
    cancel() { enabled = false; clear(); notice = ""; },
    // Long press: select every playable card of that rank for this one throw.
    startWith(card) {
      if (!this.canEnable || !context.playable.includes(card)) return false;
      enabled = true;
      clear();
      notice = "";
      return this.select(card);
    },
    canSelect(card) {
      return enabled && !!context?.action && !context.pending && context.hand.includes(card) &&
        context.playable.includes(card) && (!cards.size || rankOf([...cards][0]) === rankOf(card));
    },
    select(card) {
      if (!this.canSelect(card)) return false;
      // The first tap picks every playable card of that rank; further taps
      // deselect or reselect single cards.
      if (!cards.size) { cards.add(card); for (const other of context.hand) if (this.canSelect(other) && rankOf(other) === rankOf(card)) cards.add(other); }
      else if (cards.has(card)) cards.delete(card); else cards.add(card);
      notice = "";
      return true;
    },
    take() {
      if (!cards.size || ![...cards].every(card => this.canSelect(card))) return null;
      const selection = { action: context.action, cards: [...cards] };
      clear();
      notice = "";
      // One throw, one selection: the next tap plays a single card again.
      enabled = false;
      return selection;
    },
    clear() { clear(); notice = ""; },
  };
}

export function mountHandSelection({ handRegion, tools, reactions, t, onChange, onPlay }) {
  const selection = createHandSelection();
  const toggle = document.createElement("button");
  toggle.id = "hausdeppMultiToggle";
  toggle.type = "button";
  toggle.className = "hd-multi-toggle";
  toggle.setAttribute("aria-pressed", "false");
  toggle.setAttribute("aria-controls", "hausdeppHand hausdeppMultiActions");
  toggle.innerHTML = '<svg class="hd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h11v16H9zM5 18 2 4l9-2M12 12l2 2 4-5"/></svg><span class="hd-multi-label" aria-hidden="true"></span>';
  const hint = document.createElement("span");
  hint.id = "hausdeppMultiHint";
  hint.className = "hd-sr";
  hint.textContent = t("multiSelectHint");
  toggle.setAttribute("aria-describedby", hint.id);
  handRegion.append(toggle, hint);

  // The toggle itself ends a selection, so there is no separate cancel button.
  const actions = document.createElement("div");
  actions.id = "hausdeppMultiActions";
  actions.className = "hd-multi-actions";
  actions.hidden = true;
  const play = document.createElement("button");
  play.id = "hausdeppMultiPlay";
  play.className = "hd-primary";
  play.type = "button";
  actions.append(play);

  // Wide tables put both controls in one bar right under the hand; narrower
  // fixed windows keep the toggle beside the hand and the play button in the
  // bottom dock, where the reactions make room for it.
  const bar = document.createElement("div");
  bar.id = "hausdeppHandActions";
  bar.className = "hd-hand-actions";
  handRegion.append(bar);
  const wide = matchMedia("(min-width: 1100px)");
  const place = () => {
    if (wide.matches) bar.append(toggle, actions);
    else { handRegion.insertBefore(toggle, hint); tools.append(actions); }
    reactions.hidden = selection.enabled && !wide.matches;
  };
  place();
  wide.addEventListener("change", place);

  const notice = document.createElement("p");
  notice.id = "hausdeppMultiNotice";
  notice.className = "hd-multi-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.hidden = true;
  handRegion.append(notice);

  toggle.addEventListener("click", () => { selection.toggle(); onChange(); });
  play.addEventListener("click", onPlay);
  handRegion.addEventListener("keydown", event => {
    if (event.key === "Escape" && selection.enabled) {
      event.preventDefault();
      selection.cancel();
      onChange();
      toggle.focus({ preventScroll: true });
    }
  });

  return {
    selection,
    update(context) {
      selection.sync(context);
      const count = selection.cards.length;
      toggle.disabled = !selection.enabled && !selection.canEnable;
      toggle.setAttribute("aria-pressed", String(selection.enabled));
      // One stable name; aria-pressed and the filled style carry the state.
      toggle.setAttribute("aria-label", t("multiSelect"));
      toggle.title = t(selection.enabled ? "multiSelectEnd" : "multiSelect");
      toggle.querySelector(".hd-multi-label").textContent = t("multiSelect");
      handRegion.classList.toggle("is-multi-selecting", selection.enabled);
      actions.hidden = !selection.enabled;
      reactions.hidden = selection.enabled && !wide.matches;
      play.textContent = t(count === 1 ? "multiPlayOne" : "multiPlay", { count });
      play.disabled = !count || context.pending || !context.action;
      notice.textContent = selection.notice ? t(selection.notice) : "";
      notice.hidden = !selection.notice;
    },
  };
}
