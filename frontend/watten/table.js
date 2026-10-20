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
  return `<button type="button" class="${className}" title="${esc(label)}" ${attributes} ${disabled ? "disabled" : ""}>${esc(label)}</button>`;
}

// Reconcile small controls in place. A busy ACK must not replace a focused
// decision button or the private advice controls underneath a pending tap.
function reconcile(parent, next) {
  [...next.childNodes].forEach((incoming, index) => {
    const current = parent.childNodes[index];
    const identity = node => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-watten-command")
      ? [node.dataset.wattenCommand, node.dataset.kind, node.dataset.value, node.dataset.seat].join("|") : null;
    if (!current || current.nodeType !== incoming.nodeType || current.nodeName !== incoming.nodeName || identity(current) !== identity(incoming)) {
      if (current) current.replaceWith(incoming.cloneNode(true));
      else parent.append(incoming.cloneNode(true));
      return;
    }
    if (incoming.nodeType === Node.TEXT_NODE) { current.textContent = incoming.textContent; return; }
    if (incoming.nodeType !== Node.ELEMENT_NODE) return;
    for (const attribute of [...current.attributes]) {
      if (attribute.name === "open" && ["DETAILS", "DIALOG"].includes(incoming.nodeName)) continue;
      if (!incoming.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of incoming.attributes) {
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
    reconcile(current, incoming);
  });
  while (parent.childNodes.length > next.childNodes.length) parent.lastChild.remove();
}

function teamRelation(vm, party) {
  const own = vm.spectator || vm.viewerSeat === null ? null : vm.engine.seats[vm.viewerSeat]?.party;
  return own === null || own === undefined ? "neutral" : party === own ? "own" : "opponent";
}

function partyLabel(vm, party) {
  const relation = teamRelation(vm, party);
  return relation === "neutral" ? t("team.label", { team: teamName(party) }) : t(`team.${relation}`);
}

function trickRelation(vm, seat) {
  const party = vm.engine.seats[seat]?.party;
  return party === undefined ? "neutral" : teamRelation(vm, party);
}

function scoreMarkup(vm) {
  const engine = vm.engine;
  const scores = engine.scores.slice().sort((a, b) =>
    Number(b.members.includes(vm.playerId)) - Number(a.members.includes(vm.playerId)));
  return scores.map(score => {
    const own = score.members.includes(vm.playerId);
    const party = engine.seats.find(item => item.player_id === score.members[0])?.party ?? 0;
    const won = engine.winners.some(group => group.length === score.members.length && group.every(id => score.members.includes(id)));
    const label = vm.count === 4 || vm.count === 2 ? partyLabel(vm, party)
      : own ? t("team.own") : names(score.members.map(id => nameOf(vm, id)));
    const tricks = engine.party_tricks?.[party] ?? 0;
    return `<li class="wt-score${own ? " is-own" : ""}${won ? " is-winner" : ""}">
      <span class="wt-score-caption"><span class="wt-score-name"${vm.count === 3 && !own ? " translate=\"no\"" : ""}>${esc(label)}</span>
        <span class="wt-score-tricks">${esc(t(tricks === 1 ? "score.trick" : "score.tricks", { count: tricks }))}</span></span>
      <strong class="wt-score-points" aria-label="${esc(t("score.aria", { points: score.points, target: engine.target_points }))}">${score.points}</strong>
    </li>`;
  }).join("");
}

function seatBadge(vm, seat) {
  const engine = vm.engine;
  const info = engine.seats[seat];
  const position = seatPosition(seat, vm.anchorSeat, vm.count);
  const own = seat === vm.viewerSeat;
  const solo = vm.count === 3 && partyMembers(engine, info.party).length === 1;
  const awaited = vm.awaited.includes(info.player_id);
  const tags = [
    own ? t("seat.you") : "",
    vm.room.seats[seat]?.is_cpu ? t("seat.cpu") : "",
    seat === engine.dealer_seat ? t("seat.dealer") : "",
    solo ? t("seat.solo") : "",
    awaited ? t("seat.away") : "",
  ].filter(Boolean);
  const turn = engine.card_turn === seat && !engine.bid.pending;
  const decider = engine.bid.pending?.decider === info.player_id;
  const thanks = engine.transcript?.some(item => item.kind === "watten_thanks" && item.seat === seat);
  const name = seatName(vm, seat);
  const initial = Array.from(name.trim())[0] || "?";
  return { position, own, turn, decider, awaited, count: Math.max(0, Math.min(5, info.card_count)),
    badge: `<span class="wt-avatar" aria-hidden="true">${esc(initial.toLocaleUpperCase())}</span>
    <span class="wt-seat-name" translate="no" title="${esc(name)}">${esc(name)}</span>
    ${publicTitleMarkup(vm.room.seats[seat]?.public_title, {
      language: window.ZDWA_I18N?.getLanguage?.(), escapeHtml: esc,
    })}
    <span class="wt-seat-tags">${tags.map(tag => `<span class="wt-tag">${esc(tag)}</span>`).join("")}</span>
    ${turn ? `<span class="wt-visually-hidden">${esc(t("seat.turn"))}</span>` : ""}
    ${thanks ? `<span class="wt-bubble wt-bubble--thanks">${esc(t("call.thanks"))}</span>` : ""}
  ` };
}

function inspectionMarkup(vm) {
  const cards = vm.engine.inspection?.cards || [];
  return `<div class="wt-inspection" data-watten-inspection role="group" aria-labelledby="wattenInspectionTitle">
    <h3 id="wattenInspectionTitle" class="wt-visually-hidden">${esc(t("inspection.title"))}</h3>
    <div class="wt-inspection-cards">${cards.map(item => `<figure class="wt-reveal-card wt-reveal-card--${item.role}">${cardFace(item.card)}<figcaption>${esc(t(item.role === "strike" ? "inspection.strike" : "inspection.colour"))}</figcaption></figure>`).join("")}</div>
    ${button(t("inspection.ack"), `data-watten-command="engine" data-kind="inspection_ack" data-watten-action="inspection_ack"`, { disabled: vm.busy, className: "wt-primary" })}
  </div>`;
}

function bidMarkup(vm) {
  const engine = vm.engine, pending = engine.bid.pending;
  const bidders = vm.count === 4 ? partyLabel(vm, pending.party)
    : names(partyMembers(engine, pending.party).map(id => nameOf(vm, id)));
  const decider = nameOf(vm, pending.decider);
  const respond = RESPONSES.filter(([, action]) => vm.actions.includes(action));
  return `<div class="wt-bid" data-watten-bid role="group" aria-labelledby="wattenBidTitle">
    <h3 id="wattenBidTitle">${esc(t("bid.pendingShort", { points: pending.points }))}</h3>
    <p class="wt-bid-speaker" title="${esc(bidders)}" translate="no">${esc(bidders)}</p>
    <p>${esc(respond.length ? t("bid.yourDecision") : t("bid.waitingFor", { name: decider }))}</p>
    ${respond.length ? `<div class="wt-choice-row">${respond.map(([value, action]) => button(t(value === "counter" ? "bid.counterTo" : value === "go" ? "bid.goStake" : "bid.hold", { points: value === "counter" ? pending.points + 1 : value === "go" ? engine.bid.accepted_stake : pending.points }),
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
      ${(engine.nockerl || []).map(item => `<p class="wt-nockerl">${esc(t(`nockerl.${item.reason}`, { names: names(item.members.map(id => nameOf(vm, id))), count: item.count }))}</p>`).join("")}
      <p><strong translate="no">${esc(winners.join(", "))}</strong> · ${esc(t("match.winners", { count: winners.length }))}</p>
      <p class="wt-note">${esc(vm.snapshot.result_persisted ? t("match.saved") : t("match.saving"))}</p>
      <div data-watten-match-progress hidden></div>
      <a class="wt-button" href="/watten/konto/fortschritt">${esc(t("nav.progress"))}</a>
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
      ${engine.retourschneider?.status === "available" ? `<div class="wt-retour"><h3>${esc(t("retour.title"))}</h3><p>${esc(t("retour.offer"))}</p>
        ${actions.includes("retourschneider") ? `<div class="wt-choice-row">${button(t("retour.accept"), `data-watten-command="engine" data-kind="retourschneider" data-value="accept"`, { disabled: vm.busy, className: "wt-primary" })}${button(t("retour.decline"), `data-watten-command="engine" data-kind="retourschneider" data-value="decline"`, { disabled: vm.busy })}</div>` : `<p>${esc(t("retour.waiting", { name: nameOf(vm, engine.retourschneider.decider) }))}</p>`}</div>` : vm.isHost && !vm.spectator ? button(t("deal.next"), `data-watten-command="next-deal" data-watten-action="next_deal"`, { disabled: vm.busy, className: "wt-primary" })
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
  if (phase === "inspection") return engine.inspection ? "" : `<p class="wt-prompt">${esc(t("phase.inspectionWait"))}</p>`;
  if (phase === "play") return "";
  return "";
}

function privateMarkup(vm) {
  if (vm.spectator || vm.viewerSeat === null) return "";
  const engine = vm.engine;
  const partner = partnerOf(vm);
  const parts = [];
  if (partner && engine.phase === "bid_response" && engine.bid.pending?.party !== engine.seats[vm.viewerSeat]?.party
      && (vm.actions.includes("partner_feedback") || engine.feedback?.length)) {
    const partnerName = seatName(vm, partner.seat);
    const received = engine.feedback?.find(item => item.recipient === vm.playerId);
    const sent = engine.feedback?.find(item => item.sender === vm.playerId);
    if (!sent && vm.actions.includes("partner_feedback") && !vm.feedbackDismissed) {
      parts.push(`<dialog class="wt-feedback wt-feedback-dialog" data-watten-feedback-dialog aria-labelledby="wattenFeedbackTitle">
        <h3 id="wattenFeedbackTitle">${esc(t("feedback.question"))}</h3>
        <p class="wt-note">${esc(t("feedback.title", { name: partnerName }))}</p>
        <div class="wt-choice-row">${FEEDBACK.map(value => `<button type="button" data-watten-command="feedback" data-value="${value}" data-watten-action="partner_feedback" aria-label="${esc(t(`feedback.${value}`))}" title="${esc(t(`feedback.${value}`))}" ${vm.busy ? "disabled" : ""}><span class="wt-feedback-symbol" aria-hidden="true">${{ good: "👍", bad: "👎", unsure: "?" }[value]}</span></button>`).join("")}</div>
        <p class="wt-note">${esc(t("feedback.privacy"))}</p>
      </dialog>`);
    }
    if (received) parts.push(`<p class="wt-feedback-received" data-watten-feedback-received role="status">${esc(t("feedback.received", { name: partnerName, value: t(`feedback.${received.value}`) }))}</p>`);
  }
  if (engine.partner_hand?.cards?.length) {
    const title = t("partnerHand.title", { name: nameOf(vm, engine.partner_hand.player_id) });
    parts.push(`<details class="wt-partner-hand"><summary title="${esc(title)}">${esc(title)}</summary>
      <div class="wt-partner-popover"><h3>${esc(title)}</h3><div class="wt-mini-cards">${sortHand(engine.partner_hand.cards.map(card => ({ card }))).map(item => cardFace(item.card, { className: "wt-card--mini" })).join("")}</div></div>
    </details>`);
  }
  return parts.join("");
}

function historyMarkup(vm) {
  const history = Array.isArray(vm.engine.trick_history) ? vm.engine.trick_history
    : vm.engine.last_trick ? [vm.engine.last_trick] : [];
  if (!history.length) return "";
  return `<summary>${esc(t(Array.isArray(vm.engine.trick_history) ? "history.title" : "history.last", { count: history.length }))}</summary>${history.length ? `<ol class="wt-history">${history.map(trick => `
    <li data-wt-trick-team="${trickRelation(vm, trick.winner)}"><div class="wt-mini-cards">${trick.cards.map(item => `<figure class="${item.seat === trick.winner ? "is-winning-card" : ""}">${cardFace(item.card, { className: "wt-card--mini" })}<figcaption translate="no">${esc(seatName(vm, item.seat))}</figcaption></figure>`).join("")}</div>
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
  document.documentElement.dataset.wattenActive = "true";
  container.innerHTML = `<section class="wt-table" data-wt-table aria-labelledby="wattenTableTitle">
    <h2 id="wattenTableTitle" class="wt-visually-hidden" data-wt-title></h2>
    <div class="wt-topbar">
      <ul class="wt-scores" data-wt-scores aria-label="${esc(t("score.title"))}"></ul>
      <div class="wt-topbar-actions" data-wt-tools></div>
    </div>
    <div class="wt-felt" data-wt-felt>
      <div class="wt-reveal" data-wt-reveal></div>
      <div class="wt-stock" data-wt-deck data-key="deck" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="wt-seats" data-wt-seats></div>
      <div class="wt-centre">
        <div data-wt-reference></div>
        <div class="wt-trick" data-wt-trick role="group" aria-label="${esc(t("trick.current"))}"></div>
        <p class="wt-trick-label" data-wt-trick-label></p>
        <div class="wt-bubbles" data-wt-bubbles></div>
      </div>
    </div>
    <div class="wt-end-sheet">
      <div class="wt-private" data-wt-private></div>
      <details class="wt-history-box" data-wt-history hidden></details>
      <div class="wt-panel" data-wt-panel role="region" aria-label="${esc(t("panel.label"))}"></div>
      <div data-watten-rematch hidden></div>
    </div>
    <div class="wt-hand-area" data-wt-hand-area>
      <div class="wt-hand" data-wt-hand role="group" aria-label="${esc(t("hand.label"))}"></div>
    </div>
    <p class="wt-visually-hidden" data-wt-live aria-live="polite"></p>
  </section>`;
  const $ = selector => container.querySelector(selector);
  const elements = {
    reveal: $("[data-wt-reveal]"), title: $("[data-wt-title]"), scores: $("[data-wt-scores]"), tools: $("[data-wt-tools]"), seats: $("[data-wt-seats]"),
    reference: $("[data-wt-reference]"), trick: $("[data-wt-trick]"), trickLabel: $("[data-wt-trick-label]"),
    bubbles: $("[data-wt-bubbles]"), panel: $("[data-wt-panel]"), private: $("[data-wt-private]"),
    hand: $("[data-wt-hand]"), handArea: $("[data-wt-hand-area]"), history: $("[data-wt-history]"), live: $("[data-wt-live]"),
  };
  const handNodes = new Map();
  const trickNodes = new Map();
  const seatNodes = new Map();
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
    if (key === "panel" || key === "private" || key === "tools" || key.startsWith("badge-")) {
      const template = document.createElement("template");
      template.innerHTML = markup;
      reconcile(element, template.content);
    } else element.innerHTML = markup;
    return true;
  }

  function renderHand(vm) {
    const hand = vm.engine.hand ? sortHand(vm.engine.hand) : [];
    const playable = vm.actions.includes("play_card") && !vm.busy;
    elements.handArea.hidden = !hand.some(item => isCard(item.card));
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

  // Seat/card-back nodes survive turns and ACK renders. Their geometry is a
  // stable source for dealing and playing; a badge never clips a card fan.
  function renderSeats(vm) {
    for (const info of vm.engine.seats) {
      const seat = info.seat, data = seatBadge(vm, seat);
      let node = seatNodes.get(seat);
      if (!node) {
        node = document.createElement("div");
        node.dataset.wtSeat = String(seat);
        node.innerHTML = `<div class="wt-seat-badge"></div>
          <span class="wt-backs" data-key="seat-${seat}" aria-hidden="true">${Array.from({ length: 5 }, (_, index) => `<i style="--i:${index}" hidden></i>`).join("")}</span>
          <span class="wt-taken" data-wt-catch="${seat}" aria-hidden="true"><i></i><i></i><i></i></span>`;
        seatNodes.set(seat, node);
        elements.seats.append(node);
      }
      node.className = `wt-seat wt-seat--${data.position}${data.own ? " is-own" : ""}${data.turn ? " is-turn" : ""}${data.decider ? " is-decider" : ""}${data.awaited ? " is-away" : ""}`;
      patch(node.querySelector(".wt-seat-badge"), `badge-${seat}`, data.badge);
      const backs = node.querySelector(".wt-backs");
      backs.hidden = data.own;
      backs.style.setProperty("--count", String(Math.max(1, data.count)));
      [...backs.children].forEach((back, index) => { back.hidden = data.own || index >= data.count; });
      node.querySelector(".wt-taken").dataset.filled = String(vm.engine.last_trick?.winner === seat);
    }
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
      node.classList.toggle("is-winning-card", Boolean(last && item.seat === last.winner));
      node.setAttribute("aria-label", `${cardName(item.card)} · ${seatName(vm, item.seat)}${last && item.seat === last.winner ? ` · ${t("trick.winner")}` : ""}`);
      let owner = node.querySelector(".wt-card-owner");
      if (!owner) { owner = document.createElement("span"); owner.className = "wt-card-owner"; node.append(owner); }
      owner.textContent = seatName(vm, item.seat);
      owner.setAttribute("translate", "no");
      node.style.setProperty("--order", String(index));
      if (elements.trick.children[index] !== node) elements.trick.insertBefore(node, elements.trick.children[index] || null);
    });
    elements.trick.dataset.state = last ? "last" : current.length ? "current" : "empty";
    elements.trick.classList.toggle("is-collecting", Boolean(last && vm.freshTrickEnd));
    elements.trick.dataset.winnerTeam = last ? trickRelation(vm, last.winner) : "neutral";
    elements.trickLabel.dataset.wtTrickTeam = last ? trickRelation(vm, last.winner) : "neutral";
    elements.trickLabel.textContent = last ? t("trick.wonBy", { name: seatName(vm, last.winner) })
      : "";
    return { created, nodes: cards.map(item => trickNodes.get(item.card)), cards, last: engine.last_trick || null };
  }

  function update(vm) {
    elements.title.textContent = vm.snapshot.name || "";
    container.querySelector("[data-wt-table]").dataset.count = String(vm.count);
    container.querySelector("[data-wt-table]").dataset.phase = vm.engine.phase;
    container.querySelector("[data-wt-table]").dataset.viewer = vm.spectator ? "spectator" : "player";
    const canBid = vm.actions.includes("bid");
    const stake = vm.engine.bid.pending?.points ?? vm.engine.bid.accepted_stake;
    patch(elements.scores, "scores", scoreMarkup(vm) + `<li class="wt-target">${esc(t("score.target", { target: vm.engine.target_points }))}</li>
      <li class="wt-stake" data-points="${stake}"><button type="button" ${canBid ? 'data-watten-command="engine" data-kind="bid" data-watten-action="bid"' : ""}
        ${!canBid || vm.busy ? "disabled" : ""} aria-label="${esc(t(canBid ? "bid.tapOffer" : "bid.stake", { points: stake }))}">
        <span>${esc(t(vm.engine.bid.pending ? "bid.offered" : "bid.running"))}</span><strong>${stake}</strong>${canBid ? '<span aria-hidden="true">＋</span>' : ""}</button></li>
      ${vm.engine.retourschneider?.status === "active" ? `<li class="wt-retour-tag">${esc(t("retour.active"))}</li>` : ""}`);
    patch(elements.tools, "tools", vm.canLeave
      ? button(t("leave.short"), `data-watten-command="leave-match" data-watten-action="leave" aria-label="${esc(t("leave.button"))}"`, { disabled: vm.busy, className: "wt-button--ghost wt-button--small" })
      : vm.spectator ? `<span class="wt-tag">${esc(t("spectator.kicker"))}</span>` : "");
    renderSeats(vm);
    patch(elements.reference, "reference", referenceMarkup(vm));
    patch(elements.reveal, "reveal", vm.engine.inspection && vm.actions.includes("inspection_ack") ? inspectionMarkup(vm) : "");
    patch(elements.panel, "panel", panelMarkup(vm));
    patch(elements.private, "private", privateMarkup(vm));
    const feedbackDialog = elements.private.querySelector("[data-watten-feedback-dialog]");
    if (feedbackDialog && !feedbackDialog.open && typeof feedbackDialog.showModal === "function") feedbackDialog.showModal();
    patch(elements.bubbles, "bubbles", vm.bubbles.map(bubble =>
      `<span class="wt-bubble wt-bubble--${seatPosition(bubble.seat, vm.anchorSeat, vm.count)}" data-watten-call>${esc(bubble.text)}</span>`).join(""));
    const history = historyMarkup(vm);
    elements.history.hidden = !history;
    patch(elements.history, "history", history);
    elements.handArea.hidden = vm.spectator;
    container.querySelector("[data-wt-table]").dataset.playable = String(vm.actions.includes("play_card"));
    const hand = vm.spectator ? { created: [], nodes: [] } : renderHand(vm);
    const trick = renderTrick(vm);
    const live = vm.liveMessage || "";
    if (live !== lastLive) elements.live.textContent = live;
    lastLive = live;
    return { hand, trick };
  }

  function motionSources() {
    return [...elements.hand.querySelectorAll("[data-key]"), ...elements.seats.querySelectorAll(".wt-backs:not([hidden])"),
      ...elements.trick.querySelectorAll("[data-key]"), $("[data-wt-deck]")];
  }

  function seatNode(seat) {
    return elements.seats.querySelector(`[data-wt-seat="${seat}"]`);
  }

  return { update, motionSources, seatNode, trickNode: () => elements.trick,
    deckNode: () => $("[data-wt-deck]"), collectionNode: seat => elements.seats.querySelector(`[data-wt-catch="${seat}"]`),
    backNodes: () => [...elements.seats.querySelectorAll(".wt-backs:not([hidden]) > i:not([hidden])")] };
}
