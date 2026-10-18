// Table rendering from the accepted own projection only. Nothing here filters
// legal cards, infers a hidden call or reads another participant's view.
import { cardArt } from "../hausdepp/cards.js";
import { escapeHtml as esc } from "../shared/auth.js";
import { t, cardFace, cardBack, cardName, sortHand, suitName, strikeName, SUITS, STRIKES, isCard } from "./cards.js";
import { teamName } from "./waiting-room.js";
import { publicTitleMarkup } from "./match-progress.js";

const POSITIONS = { 2: ["bottom", "top"], 3: ["bottom", "left", "right"], 4: ["bottom", "left", "top", "right"] };
const FEEDBACK = ["good", "bad", "unsure"];
const RESPONSES = [["hold", "respond_hold"], ["go", "respond_go"], ["counter", "respond_counter"]];

export function seatPosition(seat, anchor, count) {
  return POSITIONS[count]?.[(seat - anchor + count) % count] ?? "top";
}

const names = list => list.filter(Boolean).join(" & ");

function partyMembers(engine, party) {
  return engine.seats.filter(item => item.party === party).map(item => item.player_id);
}

function nameOf(vm, participantId) {
  return vm.room.seats.find(item => item.participant_id === participantId)?.name || t("seat.unknown");
}

function seatName(vm, seat) {
  return vm.room.seats[seat]?.name || t("seat.unknown");
}

function partnerOf(vm) {
  const own = vm.engine.seats[vm.viewerSeat];
  if (!own) return null;
  return vm.engine.seats.find(item => item.party === own.party && item.seat !== own.seat) || null;
}

function button(label, attributes, { disabled = false, className = "" } = {}) {
  return `<button type="button" class="${className}" ${attributes} ${disabled ? "disabled" : ""}>${esc(label)}</button>`;
}

function scoreMarkup(vm) {
  const engine = vm.engine;
  return engine.scores.map(score => {
    const own = score.members.includes(vm.playerId);
    const won = engine.winners.some(group => group.length === score.members.length && group.every(id => score.members.includes(id)));
    const label = vm.count === 4
      ? t("team.label", { team: teamName(engine.seats.find(item => item.player_id === score.members[0])?.party ?? 0) })
      : names(score.members.map(id => nameOf(vm, id)));
    return `<li class="wt-score${own ? " is-own" : ""}${won ? " is-winner" : ""}">
      <span class="wt-score-name"${vm.count === 4 ? "" : " translate=\"no\""}>${esc(label)}</span>
      <strong class="wt-score-points" aria-label="${esc(t("score.aria", { points: score.points, target: engine.target_points }))}">${score.points}<small>/${engine.target_points}</small></strong>
    </li>`;
  }).join("");
}

function seatBadge(vm, seat) {
  const engine = vm.engine;
  const info = engine.seats[seat];
  const position = seatPosition(seat, vm.anchorSeat, vm.count);
  const own = seat === vm.viewerSeat;
  const partner = !own && vm.viewerSeat !== null && info.party === engine.seats[vm.viewerSeat]?.party;
  const solo = vm.count === 3 && partyMembers(engine, info.party).length === 1;
  const awaited = vm.awaited.includes(info.player_id);
  const tags = [
    own ? t("seat.you") : "",
    vm.room.seats[seat]?.is_cpu ? t("seat.cpu") : "",
    partner ? t("seat.partner") : "",
    vm.count === 4 ? t("team.label", { team: teamName(info.party) }) : "",
    seat === engine.dealer_seat ? t("seat.dealer") : "",
    solo ? t("seat.solo") : "",
    awaited ? t("seat.away") : "",
  ].filter(Boolean);
  const turn = engine.card_turn === seat && !engine.bid.pending;
  const decider = engine.bid.pending?.decider === info.player_id;
  const thanks = engine.transcript?.some(item => item.kind === "watten_thanks" && item.seat === seat);
  const tricks = engine.party_tricks?.[info.party] ?? 0;
  const backs = own ? "" : `<span class="wt-backs" aria-hidden="true">${"<i></i>".repeat(Math.max(0, Math.min(5, info.card_count)))}</span>`;
  return `<div class="wt-seat wt-seat--${position}${own ? " is-own" : ""}${turn ? " is-turn" : ""}${decider ? " is-decider" : ""}${awaited ? " is-away" : ""}"
      data-wt-seat="${seat}" data-key="seat-${seat}">
    <span class="wt-seat-name" translate="no">${esc(seatName(vm, seat))}</span>
    ${publicTitleMarkup(vm.room.seats[seat]?.public_title, {
      language: window.ZDWA_I18N?.getLanguage?.(), escapeHtml: esc,
    })}
    <span class="wt-seat-tags">${tags.map(tag => `<span class="wt-tag">${esc(tag)}</span>`).join("")}</span>
    <span class="wt-seat-meta">${esc(t("seat.cards", { count: info.card_count }))} · ${esc(t("seat.tricks", { count: tricks }))}</span>
    ${backs}
    ${turn ? `<span class="wt-visually-hidden">${esc(t("seat.turn"))}</span>` : ""}
    ${thanks ? `<span class="wt-bubble wt-bubble--thanks">${esc(t("call.thanks"))}</span>` : ""}
  </div>`;
}

function inspectionMarkup(vm) {
  const cards = vm.engine.inspection?.cards || [];
  return `<div class="wt-inspection" data-watten-inspection role="group" aria-labelledby="wattenInspectionTitle">
    <h3 id="wattenInspectionTitle">${esc(t("inspection.title"))}</h3>
    <p>${esc(t("inspection.body"))}</p>
    <div class="wt-inspection-cards">${cards.map(item => `<figure>${cardFace(item.card)}<figcaption>${esc(t(item.role === "strike" ? "inspection.strike" : "inspection.colour"))}</figcaption></figure>`).join("")}</div>
    ${button(t("inspection.ack"), `data-watten-command="engine" data-kind="inspection_ack" data-watten-action="inspection_ack"`, { disabled: vm.busy, className: "wt-primary" })}
  </div>`;
}

function bidMarkup(vm) {
  const engine = vm.engine, pending = engine.bid.pending;
  const bidders = names(partyMembers(engine, pending.party).map(id => nameOf(vm, id)));
  const decider = nameOf(vm, pending.decider);
  const respond = RESPONSES.filter(([, action]) => vm.actions.includes(action));
  return `<div class="wt-bid" data-watten-bid role="group" aria-labelledby="wattenBidTitle">
    <h3 id="wattenBidTitle">${esc(t("bid.pending", { names: bidders, points: pending.points }))}</h3>
    <p>${esc(respond.length ? t("bid.yourDecision") : t("bid.waitingFor", { name: decider }))}</p>
    ${respond.length ? `<div class="wt-choice-row">${respond.map(([value, action]) => button(t(`bid.${value}`, { points: pending.points }),
      `data-watten-command="engine" data-kind="respond" data-value="${value}" data-watten-action="${action}"`,
      { disabled: vm.busy, className: value === "hold" ? "wt-primary" : "" })).join("")}</div>` : ""}
    <p class="wt-note">${esc(t("bid.stake", { points: engine.bid.accepted_stake }))}</p>
  </div>`;
}

function resultMarkup(vm) {
  const engine = vm.engine, result = engine.bid.result;
  if (!result) return "";
  const winners = names(partyMembers(engine, result.winning_party).map(id => nameOf(vm, id)));
  return `<p class="wt-result-line">${esc(t(result.reason === "go" ? "result.go" : "result.tricks", { names: winners, points: result.points }))}</p>`;
}

function panelMarkup(vm) {
  const engine = vm.engine, actions = vm.actions;
  const phase = engine.phase;
  if (phase === "match_complete") {
    const winners = engine.winners.flat().map(id => nameOf(vm, id));
    const mine = engine.winners.some(group => group.includes(vm.playerId));
    return `<div class="wt-final" data-watten-match-result>
      <h3>${esc(mine ? t("match.youWon") : t("match.over"))}</h3>
      ${resultMarkup(vm)}
      <p><strong translate="no">${esc(winners.join(", "))}</strong> · ${esc(t("match.winners", { count: winners.length }))}</p>
      <p class="wt-note">${esc(vm.snapshot.result_persisted ? t("match.saved") : t("match.saving"))}</p>
      <div data-watten-match-progress hidden></div>
      <a class="wt-button" href="/watten">${esc(t("nav.lobby"))}</a>
    </div>`;
  }
  if (vm.paused) {
    const waiting = vm.awaited.map(id => nameOf(vm, id));
    return `<div class="wt-pause" data-watten-paused>
      <h3>${esc(t("pause.title"))}</h3>
      <p>${esc(vm.canResume ? t("pause.self") : t("pause.waiting", { names: waiting.join(", ") }))}</p>
      ${vm.canResume ? button(t("pause.resume"), `data-watten-command="resume" data-watten-action="resume"`, { disabled: vm.busy, className: "wt-primary" }) : ""}
      <p class="wt-note">${esc(t("pause.note"))}</p>
    </div>`;
  }
  if (phase === "bid_response" && engine.bid.pending) return bidMarkup(vm);
  if (phase === "deal_complete") {
    return `<div class="wt-deal-result" data-watten-deal-result>
      <h3>${esc(t("deal.over"))}</h3>${resultMarkup(vm)}
      ${vm.isHost && !vm.spectator ? button(t("deal.next"), `data-watten-command="next-deal" data-watten-action="next_deal"`, { disabled: vm.busy, className: "wt-primary" })
        : `<p class="wt-note">${esc(t("deal.waitHost", { name: nameOf(vm, vm.room.host_participant_id) }))}</p>`}
    </div>`;
  }
  if (phase === "strike") {
    if (!actions.includes("announce_strike")) return `<p class="wt-prompt">${esc(t("phase.strikeWait"))}</p>`;
    const strikes = STRIKES.filter(rank => rank !== "weli" || !engine.profile.critical);
    return `<div class="wt-announce"><h3>${esc(t("phase.strike"))}</h3><div class="wt-choice-grid">${strikes.map(rank =>
      button(strikeName(rank), `data-watten-command="engine" data-kind="announce_strike" data-value="${rank}" data-watten-action="announce_strike"`, { disabled: vm.busy })).join("")}</div></div>`;
  }
  if (phase === "colour") {
    const strike = engine.announced_strike ? `<p class="wt-note">${esc(t("phase.strikeIs", { rank: strikeName(engine.announced_strike) }))}</p>` : "";
    if (!actions.includes("announce_colour")) return `<p class="wt-prompt">${esc(t("phase.colourWait"))}</p>${strike}`;
    return `<div class="wt-announce"><h3>${esc(t("phase.colour"))}</h3>${strike}<div class="wt-choice-grid wt-choice-grid--suits">${SUITS.map(suit =>
      button(suitName(suit), `data-watten-command="engine" data-kind="announce_colour" data-value="${suit}" data-watten-action="announce_colour"`, { disabled: vm.busy, className: `wt-suit wt-suit--${suit}` })).join("")}</div></div>`;
  }
  if (phase === "show_ready") {
    if (actions.includes("show_ready")) {
      return `<div class="wt-announce"><h3>${esc(t("phase.show"))}</h3><p>${esc(t("phase.showBody"))}</p>
        ${button(t("phase.showButton"), `data-watten-command="engine" data-kind="show_ready" data-watten-action="show_ready"`, { disabled: vm.busy, className: "wt-primary" })}</div>`;
    }
    return `<p class="wt-prompt">${esc(t("phase.showWait"))}</p>`;
  }
  if (phase === "inspection") {
    if (engine.inspection && actions.includes("inspection_ack")) return inspectionMarkup(vm);
    return `<p class="wt-prompt">${esc(t("phase.inspectionWait"))}</p>`;
  }
  if (phase === "play") {
    const bid = actions.includes("bid")
      ? button(t("bid.offer"), `data-watten-command="engine" data-kind="bid" data-watten-action="bid"`, { disabled: vm.busy }) : "";
    if (actions.includes("play_card")) {
      return `<div class="wt-turn"><p class="wt-prompt wt-prompt--turn">${esc(t("play.yourTurn"))}</p>${bid}
        <p class="wt-note">${esc(t("bid.stake", { points: engine.bid.accepted_stake }))}</p></div>`;
    }
    const current = engine.card_turn === null ? "" : seatName(vm, engine.card_turn);
    return `<p class="wt-prompt">${esc(current ? t("play.waiting", { name: current }) : t("play.waitingGeneric"))}</p>
      <p class="wt-note">${esc(t("bid.stake", { points: engine.bid.accepted_stake }))}</p>`;
  }
  return "";
}

function privateMarkup(vm) {
  if (vm.spectator || vm.viewerSeat === null) return "";
  const engine = vm.engine;
  const partner = partnerOf(vm);
  const parts = [];
  if (partner && (vm.actions.includes("partner_feedback") || engine.feedback?.length)) {
    const partnerName = seatName(vm, partner.seat);
    const received = engine.feedback?.find(item => item.recipient === vm.playerId);
    const sent = engine.feedback?.find(item => item.sender === vm.playerId);
    parts.push(`<section class="wt-feedback" data-watten-feedback aria-labelledby="wattenFeedbackTitle">
      <h3 id="wattenFeedbackTitle">${esc(t("feedback.title", { name: partnerName }))}</h3>
      <p class="wt-note">${esc(t("feedback.privacy"))}</p>
      ${vm.actions.includes("partner_feedback") ? `<div class="wt-choice-row">${FEEDBACK.map(value =>
        button(t(`feedback.${value}`), `data-watten-command="feedback" data-value="${value}" data-watten-action="partner_feedback"`, { disabled: vm.busy })).join("")}</div>` : ""}
      ${received ? `<p class="wt-feedback-received" data-watten-feedback-received>${esc(t("feedback.received", { name: partnerName, value: t(`feedback.${received.value}`) }))}</p>` : ""}
      ${sent ? `<p class="wt-note">${esc(t("feedback.sent", { value: t(`feedback.${sent.value}`) }))}</p>` : ""}
    </section>`);
  }
  if (engine.partner_hand?.cards?.length) {
    parts.push(`<section class="wt-partner-hand" aria-label="${esc(t("partnerHand.title", { name: nameOf(vm, engine.partner_hand.player_id) }))}">
      <h3>${esc(t("partnerHand.title", { name: nameOf(vm, engine.partner_hand.player_id) }))}</h3>
      <div class="wt-mini-cards">${sortHand(engine.partner_hand.cards.map(card => ({ card }))).map(item => cardFace(item.card, { className: "wt-card--mini" })).join("")}</div>
    </section>`);
  }
  return parts.join("");
}

function historyMarkup(vm) {
  const history = vm.engine.trick_history;
  if (!Array.isArray(history)) return "";
  return `<summary>${esc(t("history.title", { count: history.length }))}</summary>${history.length ? `<ol class="wt-history">${history.map(trick => `
    <li><div class="wt-mini-cards">${trick.cards.map(item => cardFace(item.card, { className: "wt-card--mini" })).join("")}</div>
      <span>${esc(t("history.winner", { name: seatName(vm, trick.winner) }))}</span></li>`).join("")}</ol>` : `<p class="wt-note">${esc(t("history.empty"))}</p>`}`;
}

function referenceMarkup(vm) {
  const reference = vm.engine.reference_card;
  if (!reference) return "";
  const face = reference.face === "card" && isCard(reference.card)
    ? cardFace(reference.card, { className: "wt-card--mini" })
    : cardBack({ className: "wt-card--mini", label: t("reference.hidden") });
  return `<figure class="wt-reference" data-watten-reference>${face}<figcaption>${esc(t("reference.label"))}</figcaption></figure>`;
}

export function createTableView(container, { onCard }) {
  container.innerHTML = `<section class="wt-table" data-wt-table aria-labelledby="wattenTableTitle">
    <h2 id="wattenTableTitle" class="wt-visually-hidden" data-wt-title></h2>
    <div class="wt-topbar">
      <ul class="wt-scores" data-wt-scores aria-label="${esc(t("score.title"))}"></ul>
      <div class="wt-topbar-actions" data-wt-tools></div>
    </div>
    <div class="wt-felt" data-wt-felt>
      <div class="wt-seats" data-wt-seats></div>
      <div class="wt-centre">
        <div data-wt-reference></div>
        <div class="wt-trick" data-wt-trick role="group" aria-label="${esc(t("trick.current"))}"></div>
        <p class="wt-trick-label" data-wt-trick-label></p>
        <div class="wt-bubbles" data-wt-bubbles></div>
      </div>
    </div>
    <div class="wt-panel" data-wt-panel role="region" aria-label="${esc(t("panel.label"))}"></div>
    <div data-watten-rematch hidden></div>
    <div class="wt-private" data-wt-private></div>
    <div class="wt-hand-area" data-wt-hand-area>
      <div class="wt-hand" data-wt-hand role="group" aria-label="${esc(t("hand.label"))}"></div>
    </div>
    <details class="wt-history-box" data-wt-history hidden></details>
    <p class="wt-visually-hidden" data-wt-live aria-live="polite"></p>
  </section>`;
  const $ = selector => container.querySelector(selector);
  const elements = {
    title: $("[data-wt-title]"), scores: $("[data-wt-scores]"), tools: $("[data-wt-tools]"), seats: $("[data-wt-seats]"),
    reference: $("[data-wt-reference]"), trick: $("[data-wt-trick]"), trickLabel: $("[data-wt-trick-label]"),
    bubbles: $("[data-wt-bubbles]"), panel: $("[data-wt-panel]"), private: $("[data-wt-private]"),
    hand: $("[data-wt-hand]"), handArea: $("[data-wt-hand-area]"), history: $("[data-wt-history]"), live: $("[data-wt-live]"),
  };
  const handNodes = new Map();
  const trickNodes = new Map();
  const signatures = {};
  let layout = 0, pressed = null, lastLive = "";

  // Only a press that started on this exact card in the current layout can
  // play it. A reflow after the previous play cannot hand a tap to its neighbour.
  elements.hand.addEventListener("pointerdown", event => {
    const node = event.target.closest("[data-wt-card]");
    pressed = node ? { key: node.dataset.key, layout } : null;
  });
  elements.hand.addEventListener("click", event => {
    const node = event.target.closest("[data-wt-card]");
    if (!node || node.disabled) return;
    const pointer = event.detail > 0;
    if (pointer && (!pressed || pressed.key !== node.dataset.key || pressed.layout !== layout)) return;
    pressed = null;
    onCard(node.dataset.card);
  });

  function patch(element, key, markup) {
    if (signatures[key] === markup) return false;
    signatures[key] = markup;
    element.innerHTML = markup;
    return true;
  }

  function renderHand(vm) {
    const hand = vm.engine.hand ? sortHand(vm.engine.hand) : [];
    const playable = vm.actions.includes("play_card") && !vm.busy;
    const keys = hand.map((item, index) => isCard(item.card) ? item.card : `back-${index}`);
    let changed = false;
    const created = [];
    for (const [key, node] of handNodes) {
      if (!keys.includes(key)) { node.remove(); handNodes.delete(key); changed = true; }
    }
    keys.forEach((key, index) => {
      let node = handNodes.get(key);
      const card = hand[index].card;
      if (!node) {
        if (isCard(card)) {
          node = document.createElement("button");
          node.type = "button";
          node.className = "wt-hand-card";
          node.dataset.wtCard = "";
          node.dataset.card = card;
          node.setAttribute("aria-label", cardName(card));
          node.innerHTML = cardArt(card);
        } else {
          node = document.createElement("span");
          node.className = "wt-hand-card wt-hand-card--back";
          node.setAttribute("role", "img");
          node.setAttribute("aria-label", t("card.back"));
        }
        node.dataset.key = key;
        handNodes.set(key, node);
        created.push(node);
        changed = true;
      }
      if (elements.hand.children[index] !== node) elements.hand.insertBefore(node, elements.hand.children[index] || null);
      node.style.setProperty("--i", String(index));
      if (node.tagName === "BUTTON") {
        node.disabled = !playable;
        node.dataset.wattenPlayable = String(playable);
      }
    });
    elements.hand.style.setProperty("--count", String(Math.max(1, keys.length)));
    elements.hand.dataset.state = !hand.length ? "empty" : playable ? "playable" : "idle";
    if (changed) { layout += 1; pressed = null; }
    return { created, nodes: keys.map(key => handNodes.get(key)) };
  }

  function renderTrick(vm) {
    const engine = vm.engine;
    const current = engine.current_trick?.cards || [];
    const last = !current.length && engine.last_trick ? engine.last_trick : null;
    const cards = current.length ? current : last ? last.cards : [];
    const keys = cards.map(item => item.card);
    const created = [];
    for (const [key, node] of trickNodes) {
      if (!keys.includes(key)) { node.remove(); trickNodes.delete(key); }
    }
    cards.forEach((item, index) => {
      let node = trickNodes.get(item.card);
      if (!node) {
        const holder = document.createElement("div");
        holder.innerHTML = cardFace(item.card, { className: "wt-trick-card" });
        node = holder.firstElementChild;
        node.dataset.key = item.card;
        trickNodes.set(item.card, node);
        created.push({ node, seat: item.seat, card: item.card });
      }
      node.dataset.position = seatPosition(item.seat, vm.anchorSeat, vm.count);
      node.style.setProperty("--order", String(index));
      if (elements.trick.children[index] !== node) elements.trick.insertBefore(node, elements.trick.children[index] || null);
    });
    elements.trick.dataset.state = last ? "last" : current.length ? "current" : "empty";
    elements.trick.classList.toggle("is-collecting", Boolean(last && vm.freshTrickEnd));
    elements.trickLabel.textContent = last ? t("trick.wonBy", { name: seatName(vm, last.winner) })
      : current.length ? "" : t("trick.empty");
    return created;
  }

  function update(vm) {
    elements.title.textContent = vm.snapshot.name || "";
    container.querySelector("[data-wt-table]").dataset.count = String(vm.count);
    container.querySelector("[data-wt-table]").dataset.phase = vm.engine.phase;
    container.querySelector("[data-wt-table]").dataset.viewer = vm.spectator ? "spectator" : "player";
    patch(elements.scores, "scores", scoreMarkup(vm) + `<li class="wt-stake">${esc(t("bid.stakeShort", { points: vm.engine.bid.accepted_stake }))}</li>`);
    patch(elements.tools, "tools", vm.canLeave
      ? button(t("leave.button"), `data-watten-command="leave-match" data-watten-action="leave"`, { disabled: vm.busy, className: "wt-button--ghost wt-button--small" })
      : vm.spectator ? `<span class="wt-tag">${esc(t("spectator.kicker"))}</span>` : "");
    patch(elements.seats, "seats", vm.engine.seats.map(item => seatBadge(vm, item.seat)).join(""));
    patch(elements.reference, "reference", referenceMarkup(vm));
    patch(elements.panel, "panel", panelMarkup(vm));
    patch(elements.private, "private", privateMarkup(vm));
    patch(elements.bubbles, "bubbles", vm.bubbles.map(bubble =>
      `<span class="wt-bubble wt-bubble--${seatPosition(bubble.seat, vm.anchorSeat, vm.count)}" data-watten-call>${esc(bubble.text)}</span>`).join(""));
    const history = historyMarkup(vm);
    elements.history.hidden = !history;
    patch(elements.history, "history", history);
    elements.handArea.hidden = vm.spectator;
    const hand = vm.spectator ? { created: [], nodes: [] } : renderHand(vm);
    const trick = { created: renderTrick(vm) };
    const live = vm.liveMessage || "";
    if (live !== lastLive) elements.live.textContent = live;
    lastLive = live;
    return { hand, trick };
  }

  function motionSources() {
    return [...elements.hand.querySelectorAll("[data-key]"), ...elements.seats.querySelectorAll("[data-key]")];
  }

  function seatNode(seat) {
    return elements.seats.querySelector(`[data-wt-seat="${seat}"]`);
  }

  return { update, motionSources, seatNode };
}
