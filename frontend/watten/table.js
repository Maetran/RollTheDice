// Table rendering from the accepted own projection only. Nothing here filters
// legal cards, infers a hidden call or reads another participant's view.
import { cardArt } from "../hausdepp/cards.js";
import { escapeHtml as esc } from "../shared/auth.js";
import { t, lang, cardFace, cardBack, cardName, sortHand, suitName, strikeName, SUITS, STRIKES, isCard } from "./cards.js";
import { teamName } from "./waiting-room.js";
import { publicTitleMarkup } from "./match-progress.js";
import { roundOptionsMarkup, bloedelnCardsMarkup } from "./round-options.js";
import { retourschneiderChoiceMarkup, createRetourAnnouncement } from "./retourschneider.js";
import { seriesMarks, seriesTargetMarkup, seriesFinishedTitle } from "./series.js";
import { createScorepad, nockerlMarksMarkup } from "./scorepad.js";
import { createTrickLayout } from "./trick-layout.js";
import { resultReactionsMarkup } from "./social.js";

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

export function leaveMatchMarkup(disabled = false) {
  const label = t("leave.button");
  return `<button type="button" class="wt-button--ghost wt-button--small wt-leave-icon" title="${esc(label)}" aria-label="${esc(label)}"
    data-watten-command="leave-match" data-watten-action="leave" ${disabled ? "disabled" : ""}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10"/></svg>
    <span class="wt-visually-hidden">${esc(t("leave.short"))}</span></button>`;
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
    const controllerSlot = incoming.hasAttribute("data-watten-rematch") || incoming.hasAttribute("data-watten-match-progress");
    for (const attribute of [...current.attributes]) {
      if (attribute.name === "open" && ["DETAILS", "DIALOG"].includes(incoming.nodeName) || controllerSlot && attribute.name === "hidden") continue;
      if (!incoming.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of incoming.attributes) {
      if (controllerSlot && attribute.name === "hidden") continue;
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
    // These slots belong to their mounted controllers, including focused controls.
    if (!controllerSlot) reconcile(current, incoming);
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
    const seats = engine.seats.filter(seat => score.members.includes(seat.player_id)).map(seat => seat.seat);
    const marks = seriesMarks(vm.room, seats, engine);
    const struck = score.points >= engine.target_points - 2;
    return `<li class="wt-score${own ? " is-own" : ""}${won ? " is-winner" : ""}${struck ? " is-gestrichen" : ""}">
      <button type="button" class="wt-score-open" data-wt-score-open="${seats.join(",")}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(t("scorepad.open", { name: label, points: score.points }) + (marks === null ? "" : ` · ${t("series.marks", { count: marks })}`))}">
      <span class="wt-score-caption"><span class="wt-score-name"${vm.count === 3 && !own ? " translate=\"no\"" : ""}>${esc(label)}</span>
        <span class="wt-score-tricks">${esc(t(tricks === 1 ? "score.trick" : "score.tricks", { count: tricks }))}</span>
        ${nockerlMarksMarkup(marks)}</span>
      <strong class="wt-score-points" aria-label="${esc(t("score.aria", { points: score.points, target: engine.target_points }))}">${score.points}</strong></button>
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
  const strikeSeat = engine.announcement_roles?.strike;
  const colourSeat = engine.announcement_roles?.colour;
  const roles = [seat === strikeSeat ? t("inspection.strike") : "", seat === colourSeat ? t("inspection.colour") : ""].filter(Boolean);
  const tags = [
    own ? t("seat.you") : "",
    vm.room.seats[seat]?.is_cpu ? t("seat.cpu") : "",
    seat === engine.dealer_seat ? t("seat.dealer") : "",
    solo ? t("seat.solo") : "",
    awaited ? t("seat.away") : "",
  ].filter(Boolean);
  const turn = engine.card_turn === seat && !engine.bid.pending;
  const decider = engine.bid.pending?.decider === info.player_id;
  const thanks = !engine.last_trick && engine.transcript?.some(item => item.kind === "watten_thanks" && item.seat === seat);
  const name = seatName(vm, seat);
  const initial = Array.from(name.trim())[0] || "?";
  const tricks = Math.max(0, Math.min(5, Number.isInteger(info.tricks_won) ? info.tricks_won : 0));
  const trickLabel = t(tricks === 1 ? "score.trick" : "score.tricks", { count: tricks });
  return { position, own, turn, decider, awaited, count: Math.max(0, Math.min(5, info.card_count)),
    badge: `<span class="wt-avatar" aria-hidden="true">${esc(initial.toLocaleUpperCase())}</span>
    <span class="wt-seat-name-row"><span class="wt-seat-name" translate="no" title="${esc(name)}">${esc(name)}</span>
      <span class="wt-taken" data-wt-catch="${seat}" data-count="${tricks}" data-filled="${tricks > 0}" role="img" aria-label="${esc(trickLabel)}" title="${esc(trickLabel)}" ${tricks ? "" : "hidden"}>${Array.from({ length: tricks }, () => '<span class="wt-taken-packet" aria-hidden="true"><i></i><i></i><i></i></span>').join("")}</span></span>
    ${roles.length ? `<span class="wt-seat-call-role">${roles.map(esc).join(" · ")}</span>` : ""}
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
  // These public roles identify the source seats, never an additional card.
  const strikeSeat = vm.engine.announcement_roles?.strike;
  const colourSeat = vm.engine.announcement_roles?.colour;
  return `<div class="wt-inspection" data-watten-inspection role="group" aria-labelledby="wattenInspectionTitle">
    <h3 id="wattenInspectionTitle" class="wt-visually-hidden">${esc(t("inspection.title"))}</h3>
    <div class="wt-inspection-cards">${cards.map(item => `<figure class="wt-reveal-card wt-reveal-card--${item.role}" data-wt-inspection-seat="${item.role === "strike" ? strikeSeat : colourSeat}">${cardFace(item.card)}<figcaption>${esc(t(item.role === "strike" ? "inspection.strike" : "inspection.colourShort"))}</figcaption></figure>`).join("")}</div>
    ${button(t("inspection.ack"), `data-watten-command="engine" data-kind="inspection_ack" data-watten-action="inspection_ack"`, { disabled: vm.busy, className: "wt-primary" })}
  </div>`;
}

function createInspectionMotion(reveal, seatNodes) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const centre = rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  const clamp = (value, min, max) => max < min ? (min + max) / 2 : Math.max(min, Math.min(value, max));
  const clearance = 4;
  const overlaps = (a, b) => a.left < b.right + clearance && a.right > b.left - clearance
    && a.top < b.bottom + clearance && a.bottom > b.top - clearance;
  let key = "", playedKey = "", figures = [], observer = null, flights = [], geometry = "", frame = 0;
  const settle = () => { flights.forEach(flight => flight.cancel()); flights = []; };
  const stop = () => {
    settle(); observer?.disconnect(); observer = null;
    cancelAnimationFrame(frame); frame = 0;
    key = ""; figures = []; geometry = "";
    reveal.closest(".wt-table")?.style.removeProperty("--wt-inspection-ack-height");
    delete reveal.dataset.wtInspectionPositioned;
  };

  function position() {
    if (!reveal.isConnected || figures.length !== 2 || !figures.every(figure => figure.isConnected)) { stop(); return; }
    const felt = reveal.parentElement, bounds = felt.getBoundingClientRect();
    const table = felt.closest(".wt-table");
    if (!bounds.width || !bounds.height) return;
    const origins = figures.map(figure => {
      const player = seatNodes.get(Number(figure.dataset.wtInspectionSeat));
      const source = player?.querySelector(".wt-avatar")?.getBoundingClientRect();
      if (!source) return null;
      const point = centre(source);
      const position = ["bottom", "left", "right", "top"].find(value => player.classList.contains(`wt-seat--${value}`));
      // The own hand occupies the bottom centre even when its name badge
      // sits at the edge.
      if (position === "bottom") point.x = bounds.left + bounds.width / 2;
      return { x: point.x - bounds.left, y: point.y - bounds.top };
    });
    if (origins.some(origin => !origin)) return;
    const delta = { x: origins[1].x - origins[0].x, y: origins[1].y - origins[0].y };
    const distance = Math.hypot(delta.x, delta.y) || 1;
    // The meeting point belongs to the two announcing hands. Keep both
    // cards on their connecting line in every orientation.
    const shortPortrait = bounds.height > bounds.width;
    const unit = { x: delta.x / distance, y: delta.y / distance };
    const angle = Math.atan2(unit.y, unit.x) * 180 / Math.PI + 90;
    const cards = figures.map(figure => figure.querySelector(".wt-card"));
    const captions = figures.map(figure => figure.querySelector("figcaption"));
    const ack = reveal.querySelector('[data-kind="inspection_ack"]');
    if (!ack) return;
    const hand = table?.querySelector(".wt-hand-area:not([hidden])")?.getBoundingClientRect();
    const region = { left: 10, top: 10, right: bounds.width - 10,
      bottom: Math.min(bounds.height - 10, hand?.height ? hand.top - bounds.top - 12 : bounds.height - 10) };
    cards.forEach(card => card.style.removeProperty("width"));
    const baseWidths = cards.map(card => card.offsetWidth);
    const labelSizes = captions.map(caption => ({ width: caption.offsetWidth, height: caption.offsetHeight }));
    const obstacles = [...felt.querySelectorAll('.wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-seat-public-title, .wt-seat-tags, .wt-bubble--thanks, .wt-backs:not([hidden]) > i:not([hidden]), .wt-stock'), ...table.querySelectorAll('[data-wt-preplay]:not(:empty), [data-watten-action=inspection_ack]')]
      .map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height)
      .map(rect => ({ left: rect.left - bounds.left, right: rect.right - bounds.left,
        top: rect.top - bounds.top, bottom: rect.bottom - bounds.top }));
    function arrangement(scale, separation = .5) {
      cards.forEach((card, index) => { card.style.width = `${baseWidths[index] * scale}px`; });
      const poses = cards.map((card, index) => {
        const width = card.offsetWidth, height = card.offsetHeight, rotation = angle + index * 180;
        const radians = rotation * Math.PI / 180, direction = index ? 1 : -1;
        const x = direction * unit.x * (height * separation + (separation === .5 ? 2 : 0)), y = direction * unit.y * (height * separation + (separation === .5 ? 2 : 0));
        const extentX = (Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height) / 2;
        const extentY = (Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height) / 2;
        return { x, y, width, height, rotation, left: x - extentX, right: x + extentX, top: y - extentY, bottom: y + extentY };
      });
      // The smallest portrait uses the outer short edges for labels, leaving
      // the side fans clear. Other screens keep the upright long-edge badges.
      const labels = poses.map((pose, index) => {
        const size = labelSizes[index], side = index ? -1 : 1;
        if (shortPortrait) {
          const x = pose.x, y = pose.y + unit.y * -side * pose.height / 2;
          return { x, top: y - size.height / 2, left: x - size.width / 2,
            right: x + size.width / 2, bottom: y + size.height / 2 };
        }
        const normal = { x: -unit.y * side, y: unit.x * side };
        const offset = pose.width / 2 + (Math.abs(normal.x) * size.width + Math.abs(normal.y) * size.height) / 2 + 2;
        const x = pose.x + normal.x * offset, y = pose.y + normal.y * offset;
        return { x, top: y - size.height / 2, left: x - size.width / 2,
          right: x + size.width / 2, bottom: y + size.height / 2 };
      });
      const faceTop = Math.min(...poses.map(pose => pose.top), ...labels.map(label => label.top));
      const faceBottom = Math.max(...poses.map(pose => pose.bottom), ...labels.map(label => label.bottom));
      const faceRight = Math.max(...poses.map(pose => pose.right), ...labels.map(label => label.right));
      const faceLeft = Math.min(...poses.map(pose => pose.left), ...labels.map(label => label.left));
      return { poses, labels, left: faceLeft, right: faceRight, top: faceTop, bottom: faceBottom,
        width: faceRight - faceLeft, height: faceBottom - faceTop };
    }
    function placement(value) {
      if (value.width > region.right - region.left || value.height > region.bottom - region.top) return null;
      const xMin = region.left - value.left, xMax = region.right - value.right;
      const yMin = region.top - value.top, yMax = region.bottom - value.bottom;
      const desired = { x: (origins[0].x + origins[1].x) / 2,
        y: (origins[0].y + origins[1].y) / 2 };
      const parts = [...value.poses, ...value.labels];
      // Prefer the exact midpoint. A small inward clearance may skirt a
      // source packet, while the pair stays in its two announcers' sector.
      const normal = { x: -unit.y, y: unit.x };
      const towardCentre = (bounds.width / 2 - desired.x) * normal.x + (bounds.height / 2 - desired.y) * normal.y;
      const direction = towardCentre < 0 ? -1 : 1;
      let best = null, bestDistance = Infinity;
      for (let offset = 0; offset <= 64; offset += 4) for (const fraction of [.5, .45, .55, .4, .6, .35, .65]) {
        const x = origins[0].x + delta.x * fraction + normal.x * offset * direction;
        const y = origins[0].y + delta.y * fraction + normal.y * offset * direction;
        if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
        if (parts.some(part => obstacles.some(obstacle => overlaps({ left: x + part.left, right: x + part.right,
          top: y + part.top, bottom: y + part.bottom }, obstacle)))) continue;
        const distance = ((x - desired.x) / bounds.width) ** 2 + ((y - desired.y) / bounds.height) ** 2;
        if (distance < bestDistance) { best = { x, y, distance }; bestDistance = distance; }
      }
      return best;
    }
    let arranged, midpoint;
    // Keep the short edges together wherever space allows. On a small table
    // the same two faces may overlap, preserving at least 52px printed width.
    for (const separation of [.5, .35, .25, .2]) {
      arranged = arrangement(1, separation);
      midpoint = placement(arranged);
      if (midpoint) break;
      let low = Math.min(1, 52 / Math.min(...baseWidths)), high = 1;
      arranged = arrangement(low, separation);
      midpoint = placement(arranged);
      if (!midpoint) continue;
      for (let step = 0; step < 8; step += 1) {
        const middle = (low + high) / 2;
        const point = placement(arrangement(middle, separation));
        if (point) low = middle; else high = middle;
      }
      arranged = arrangement(low, separation);
      midpoint = placement(arranged);
      break;
    }
    // Only a severely constrained viewport can exhaust the free region. Keep
    // the complete group inside the table rather than returning to source hands.
    midpoint ??= { x: (origins[0].x + origins[1].x) / 2,
      y: (origins[0].y + origins[1].y) / 2 };
    arranged.poses.forEach((pose, index) => {
      const figure = figures[index], card = cards[index], caption = captions[index], label = arranged.labels[index];
      figure.style.left = `${midpoint.x + pose.x}px`; figure.style.top = `${midpoint.y + pose.y}px`;
      card.style.left = `${-pose.width / 2}px`; card.style.top = `${-pose.height / 2}px`; card.style.rotate = `${pose.rotation}deg`;
      caption.style.left = `${label.x - pose.x}px`; caption.style.top = `${label.top - pose.y}px`;
    });
    reveal.dataset.wtInspectionPositioned = "true";
    geometry = [bounds.width, bounds.height].join(":");
    if (playedKey === key || document.hidden) return;
    if (reduced?.matches || cards.some(card => typeof card.animate !== "function")) { playedKey = key; return; }
    playedKey = key;
    flights = figures.map((figure, index) => figure.animate([
      { translate: `${origins[index].x - midpoint.x - arranged.poses[index].x}px ${origins[index].y - midpoint.y - arranged.poses[index].y}px` },
      { translate: "0 0" },
    ], { duration: 1500, easing: "cubic-bezier(.22,.65,.25,1)", fill: "backwards" }));
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = 0; position(); }); };
  const visibilityChanged = () => { if (document.hidden) settle(); else if (key && playedKey !== key) schedule(); };
  const preferenceChanged = () => { settle(); if (key) schedule(); };
  document.addEventListener("visibilitychange", visibilityChanged);
  reduced?.addEventListener?.("change", preferenceChanged);

  const update = vm => {
    const nextFigures = [...reveal.querySelectorAll("[data-wt-inspection-seat]")];
    if (!nextFigures.length) { stop(); return; }
    const nextKey = `${vm.engine.deal_id}:${vm.engine.deal_revision ?? 0}`;
    if (key === nextKey && figures.every((figure, index) => figure === nextFigures[index])) { schedule(); return; }
    settle(); observer?.disconnect();
    figures = nextFigures; key = nextKey;
    schedule();
    if (typeof ResizeObserver !== "function") return;
    observer = new ResizeObserver(() => {
      if (!reveal.isConnected) { stop(); return; }
      const bounds = reveal.parentElement.getBoundingClientRect();
      if (geometry !== [bounds.width, bounds.height].join(":")) { settle(); schedule(); }
    });
    observer.observe(reveal.parentElement);
  };
  update.destroy = () => {
    stop(); playedKey = "";
    document.removeEventListener("visibilitychange", visibilityChanged);
    reduced?.removeEventListener?.("change", preferenceChanged);
  };
  return update;
}

function bidMarkup(vm) {
  const engine = vm.engine, pending = engine.bid.pending;
  const bidders = vm.count === 4 ? partyLabel(vm, pending.party)
    : names(partyMembers(engine, pending.party).map(id => nameOf(vm, id)));
  const decider = nameOf(vm, pending.decider);
  const respond = RESPONSES.filter(([, action]) => vm.actions.includes(action));
  const partner = partnerOf(vm);
  const received = engine.feedback?.find(item => item.recipient === vm.playerId);
  const adviceName = partner ? seatName(vm, partner.seat) : "";
  const adviceText = partner ? t(received ? "feedback.advice" : "feedback.waiting", {
    name: "{partner}", value: received ? t(`feedback.${received.value}`) : "",
  }) : "";
  const adviceContent = esc(adviceText).replace("{partner}",
    `<span class="wt-advice-name" translate="no" title="${esc(adviceName)}">${esc(adviceName)}</span>`);
  const advice = partner && respond.length ? `<p class="wt-feedback-received wt-partner-advice" data-watten-partner-advice
    ${received ? `data-watten-feedback-received data-feedback-value="${esc(received.value)}"` : ""} role="status">${adviceContent}</p>` : "";
  return `<div class="wt-bid" data-watten-bid role="group" aria-labelledby="wattenBidTitle">
    <h3 id="wattenBidTitle">${esc(t("bid.pendingShort", { points: pending.points }))}</h3>
    <p class="wt-bid-speaker" title="${esc(bidders)}" translate="no">${esc(bidders)}</p>
    <p>${esc(respond.length ? t("bid.yourDecision") : t("bid.waitingFor", { name: decider }))}</p>
    ${advice}
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

function roundSummaryMarkup(vm) {
  const summary = vm.engine.round_summary;
  if (!summary || !["deal_complete", "match_complete"].includes(vm.engine.phase)) return "";
  return `<section class="wt-round-call" data-watten-round-call aria-label="${esc(t("round.call"))}">
    <dl><div><dt>${esc(t("inspection.strike"))}</dt><dd>${esc(strikeName(summary.strike_rank))}</dd></div>
      <div><dt>${esc(t("inspection.colour"))}</dt><dd>${esc(suitName(summary.trump_suit))}</dd></div></dl>
    <figure>${isCard(summary.rechter) ? cardFace(summary.rechter, { className: "wt-card--mini" }) : ""}
      <figcaption>${esc(t(isCard(summary.rechter) ? "reference.label" : "round.noRechter"))}</figcaption></figure>
  </section>`;
}

function panelMarkup(vm) {
  const engine = vm.engine, actions = vm.actions;
  const phase = engine.phase;
  if (["deal_complete", "match_complete"].includes(phase) && vm.roundPresentation?.stage === "collect") return "";
  if (phase === "match_complete" && vm.roundPresentation?.stage === "review") return roundSummaryMarkup(vm);
  if (phase === "match_complete") {
    const winners = engine.winners.flat().map(id => nameOf(vm, id));
    const mine = engine.winners.some(group => group.includes(vm.playerId));
    return `<div class="wt-final" data-watten-match-result data-outcome="${vm.spectator ? "neutral" : mine ? "won" : "lost"}">
      <h3 class="wt-final-heading">${esc(seriesFinishedTitle(vm) || t(vm.spectator ? "match.over" : mine ? "match.youWon" : "match.youLost"))}</h3>
      <p class="wt-final-winner">${esc(t("match.wonBy", { names: names(winners) }))}</p>
      ${resultReactionsMarkup(lang(), esc)}
      <div data-watten-rematch hidden></div>
      <details class="wt-final-call"><summary>${esc(t("match.details"))}</summary>
        ${(engine.nockerl || []).map(item => `<p class="wt-final-award" data-loss-kind="${esc(item.reason)}">
          ${item.reason === "loss" ? "" : `<strong>${esc(t(`match.lossType.${item.reason}`))}</strong> · `}${esc(t("match.awarded", { count: item.count, names: names(item.members.map(id => nameOf(vm, id))) }))}
        </p>`).join("")}
        ${roundSummaryMarkup(vm)}
        <div data-watten-match-progress hidden></div>
        <a class="wt-button wt-button-secondary wt-final-progress" href="/watten/konto/fortschritt">${esc(t("nav.progress"))}</a>
      </details>
      <p class="wt-visually-hidden" role="status">${esc(vm.snapshot.result_persisted ? t("match.saved") : t("match.saving"))}</p>
      <div class="wt-final-actions"><a class="wt-button wt-button-secondary" href="/watten">${esc(t("match.toLobby"))}</a></div>
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
      ${roundSummaryMarkup(vm)}
      ${engine.retourschneider?.status === "available" ? retourschneiderChoiceMarkup(vm)
        : `<p class="wt-note" role="status">${esc(t("deal.autoNext"))}</p>`}
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
      const role = engine.announcement_roles?.strike === vm.viewerSeat ? "strike" : "colour";
      return `<div class="wt-announce">${button(t(`inspection.show.${role}`), `data-watten-command="engine" data-kind="show_ready" data-watten-action="show_ready"`, { disabled: vm.busy, className: "wt-primary" })}</div>`;
    }
    return "";
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
    const sent = engine.feedback?.find(item => item.sender === vm.playerId);
    if (!sent && vm.actions.includes("partner_feedback") && !vm.feedbackDismissed) {
      parts.push(`<dialog class="wt-feedback wt-feedback-dialog" data-watten-feedback-dialog aria-labelledby="wattenFeedbackTitle">
        <h3 id="wattenFeedbackTitle">${esc(t("feedback.question"))}</h3>
        <p class="wt-note">${esc(t("feedback.title", { name: partnerName }))}</p>
        <div class="wt-choice-row">${FEEDBACK.map(value => `<button type="button" data-watten-command="feedback" data-value="${value}" data-watten-action="partner_feedback" aria-label="${esc(t(`feedback.${value}`))}" title="${esc(t(`feedback.${value}`))}" ${vm.busy ? "disabled" : ""}><span class="wt-feedback-symbol" aria-hidden="true">${{ good: "👍", bad: "👎", unsure: "?" }[value]}</span></button>`).join("")}</div>
        <p class="wt-note">${esc(t("feedback.privacy"))}</p>
      </dialog>`);
    }
  }
  if (engine.partner_hand?.cards?.length) {
    const title = t("partnerHand.title", { name: nameOf(vm, engine.partner_hand.player_id) });
    parts.push(`<details class="wt-partner-hand"><summary title="${esc(title)}">${esc(title)}</summary>
      <div class="wt-partner-popover"><h3>${esc(title)}</h3><div class="wt-mini-cards">${sortHand(engine.partner_hand.cards.map(card => ({ card }))).map(item => cardFace(item.card, { className: "wt-card--mini" })).join("")}</div></div>
    </details>`);
  }
  return parts.join("");
}

function historyMarkup(vm, pinned) {
  const history = (Array.isArray(vm.engine.trick_history) ? vm.engine.trick_history
    : vm.engine.last_trick ? [vm.engine.last_trick] : []).slice(-5);
  const finished = ["deal_complete", "match_complete"].includes(vm.engine.phase);
  if (!history.length && !finished) return "";
  return `<summary>${esc(t(finished ? "history.round" : Array.isArray(vm.engine.trick_history) ? "history.title" : "history.last", { count: history.length }))}</summary>
    <button type="button" class="wt-history-close" data-wt-history-close aria-label="${esc(t("history.close"))}" title="${esc(t("history.close"))}"><span aria-hidden="true">×</span></button>
    ${finished ? "" : `<label class="wt-history-pin" title="${esc(t("history.pin"))}"><input type="checkbox" data-wt-history-pin aria-label="${esc(t("history.pin"))}" ${pinned ? "checked" : ""}><span class="wt-history-pin-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M7 4h10v16l-5-3-5 3z"/></svg></span><span class="wt-history-pin-copy">${esc(t("history.pin"))}</span></label>`}
    ${history.length ? `<ol class="wt-history">${history.map(trick => `
    <li data-wt-trick-team="${trickRelation(vm, trick.winner)}"><div class="wt-mini-cards">${trick.cards.map(item => `<figure class="${item.seat === trick.winner ? "is-winning-card" : ""}">${cardFace(item.card, { className: "wt-card--mini" })}<figcaption translate="no">${esc(seatName(vm, item.seat))}</figcaption></figure>`).join("")}</div>
      <span>${esc(t("history.winner", { name: seatName(vm, trick.winner) }))}</span></li>`).join("")}</ol>` : `<p class="wt-note">${esc(t("history.empty"))}</p>`}`;
}

function referenceMarkup(vm) {
  const reference = vm.engine.reference_card;
  // The optional reference belongs to card play. A face-down placeholder
  // before the call adds a stray card beside the unopened packets.
  if (!reference || !["play", "bid_response", "deal_complete", "match_complete"].includes(vm.engine.phase)) return "";
  const face = reference.face === "card" && isCard(reference.card)
    ? cardFace(reference.card, { className: "wt-card--mini" })
    : cardBack({ className: "wt-card--mini", label: t("reference.hidden") });
  return `<figure class="wt-reference" data-watten-reference>${face}<figcaption>${esc(t("reference.label"))}</figcaption></figure>`;
}

export function createTableView(container, { onCard, accountId = null }) {
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
        <div data-wt-bloedeln></div>
        <div class="wt-trick" data-wt-trick role="group" aria-label="${esc(t("trick.current"))}"></div>
        <p class="wt-trick-label" data-wt-trick-label></p>
        <div class="wt-bubbles" data-wt-bubbles></div>
      </div>
    </div>
    <div class="wt-end-sheet">
      <div class="wt-private" data-wt-private></div>
      <details class="wt-history-box" data-wt-history hidden></details>
      <div class="wt-panel" data-wt-panel role="region" aria-label="${esc(t("panel.label"))}"></div>
      <div class="wt-stake" data-wt-stake></div>
    </div>
    <div class="wt-bloedeln-dock" data-wt-preplay></div>
    <div class="wt-hand-area" data-wt-hand-area>
      <div class="wt-hand" data-wt-hand role="group" aria-label="${esc(t("hand.label"))}"></div>
    </div>
    <p class="wt-visually-hidden" data-wt-live aria-live="polite"></p>
    <div class="wt-retour-announcement" data-wt-retour-announcement aria-hidden="true" hidden></div>
    <p class="wt-visually-hidden" data-wt-retour-live aria-live="polite" aria-atomic="true"></p>
  </section>`;
  const $ = selector => container.querySelector(selector);
  const elements = {
    reveal: $("[data-wt-reveal]"), title: $("[data-wt-title]"), scores: $("[data-wt-scores]"), tools: $("[data-wt-tools]"), seats: $("[data-wt-seats]"),
    reference: $("[data-wt-reference]"), bloedeln: $("[data-wt-bloedeln]"), trick: $("[data-wt-trick]"), trickLabel: $("[data-wt-trick-label]"),
    preplay: $("[data-wt-preplay]"), bubbles: $("[data-wt-bubbles]"), panel: $("[data-wt-panel]"), private: $("[data-wt-private]"),
    hand: $("[data-wt-hand]"), handArea: $("[data-wt-hand-area]"), history: $("[data-wt-history]"), live: $("[data-wt-live]"), stake: $("[data-wt-stake]"), retour: $("[data-wt-retour-announcement]"),
  };
  const handNodes = new Map();
  const trickNodes = new Map();
  const seatNodes = new Map();
  const positionInspection = createInspectionMotion(elements.reveal, seatNodes);
  const positionTrick = createTrickLayout(elements.trick);
  const retourAnnouncement = createRetourAnnouncement(elements.retour, { accountId, liveNode: $("[data-wt-retour-live]") });
  const scorepad = createScorepad(elements.scores);
  const signatures = {};
  let layout = 0, pressed = null, lastLive = "";
  const pinKey = accountId ? `watten:history-pinned:${accountId}` : null;
  let historyPinned = false, historyWasFinished = false;
  try { historyPinned = Boolean(pinKey && localStorage.getItem(pinKey) === "true"); } catch { /* Optional local display preference. */ }
  function setHistoryPinned(value) {
    historyPinned = value;
    elements.history.dataset.pinned = String(value);
    const input = elements.history.querySelector("[data-wt-history-pin]");
    if (input) input.checked = value;
    try { if (pinKey) localStorage.setItem(pinKey, String(value)); } catch { /* Session-only fallback. */ }
  }
  function closeHistory() {
    if (elements.history.dataset.finished !== "true") setHistoryPinned(false);
    elements.history.open = false;
  }
  const outsideHistory = event => {
    if (elements.history.dataset.finished !== "true" && elements.history.open && !historyPinned
        && !elements.history.contains(event.target)) elements.history.open = false;
  };
  document.addEventListener("pointerdown", outsideHistory, { passive: true });
  elements.history.addEventListener("click", event => {
    if (event.target.closest("[data-wt-history-close]")) closeHistory();
  });
  elements.history.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !elements.history.open) return;
    closeHistory();
    elements.history.querySelector("summary")?.focus({ preventScroll: true });
  });
  elements.history.addEventListener("change", event => {
    if (!event.target.matches("[data-wt-history-pin]")) return;
    setHistoryPinned(event.target.checked);
    if (historyPinned) elements.history.open = true;
  });
  elements.history.addEventListener("toggle", () => {
    if (elements.history.dataset.finished !== "true" && !elements.history.open && historyPinned) setHistoryPinned(false);
    // State keeps updating during a review; motion discards its pending ghosts.
    document.dispatchEvent(new CustomEvent("watten:review-change"));
  });

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
    // Card artwork has fresh SVG clip IDs on each render. Keep the history's
    // close/pin controls and scroll container in place during those repaints.
    if (key === "preplay" || key === "panel" || key === "private" || key === "tools" || key === "history" || key.startsWith("badge-")) {
      const template = document.createElement("template");
      template.innerHTML = markup;
      reconcile(element, template.content);
    } else element.innerHTML = markup;
    return true;
  }

  function renderHand(vm) {
    const hand = vm.engine.hand ? sortHand(vm.engine.hand) : [];
    // Only the own private forced card is projected after Blödeln is agreed. Other
    // legality (trump, strike, bids) stays entirely with the engine.
    const forced = !vm.engine.last_trick
      ? vm.engine.preplay?.bloedeln_cards?.find(item => item.seat === vm.viewerSeat)?.card : null;
    // The server plays the packet bottom as part of the turn transition.
    // A stale/recovered projection must not turn it into a manual choice.
    const playable = vm.actions.includes("play_card") && !vm.busy && !hand.some(item => item.card === forced);
    // A blind packet still occupies the owner's hand. Only the active two-card
    // inspection uses this area for its reveal/ACK; no hidden face is inferred.
    elements.handArea.hidden = !hand.length || Boolean(vm.engine.inspection && vm.actions.includes("inspection_ack"));
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
        const enabled = playable;
        node.disabled = !enabled;
        node.dataset.wattenPlayable = String(enabled);
      }
    });
    elements.hand.style.setProperty("--count", String(Math.max(1, keys.length)));
    elements.hand.dataset.state = !hand.length ? "empty" : hand.every(item => !isCard(item.card)) ? "blind" : playable ? "playable" : "idle";
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
          <span class="wt-backs" data-key="seat-${seat}" aria-hidden="true">${Array.from({ length: 5 }, (_, index) => `<i style="--i:${index}" hidden></i>`).join("")}</span>`;
        seatNodes.set(seat, node);
        elements.seats.append(node);
      }
      node.className = `wt-seat wt-seat--${data.position}${data.own ? " is-own" : ""}${data.turn ? " is-turn" : ""}${data.decider ? " is-decider" : ""}${data.awaited ? " is-away" : ""}`;
      patch(node.querySelector(".wt-seat-badge"), `badge-${seat}`, data.badge);
      const backs = node.querySelector(".wt-backs");
      backs.hidden = data.own;
      backs.style.setProperty("--count", String(Math.max(1, data.count)));
      [...backs.children].forEach((back, index) => { back.hidden = data.own || index >= data.count; });
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
      node.setAttribute("aria-label", `${t("trick.playOrder", { number: index + 1 })} · ${cardName(item.card)} · ${seatName(vm, item.seat)}${last && item.seat === last.winner ? ` · ${t("trick.winner")}` : ""}`);
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
    container.querySelector("[data-wt-table]").dataset.roundStage = vm.roundPresentation?.stage || "ready";
    container.querySelector("[data-wt-table]").dataset.viewer = vm.spectator ? "spectator" : "player";
    const canBid = vm.actions.includes("bid");
    const stake = vm.engine.bid.pending?.points ?? vm.engine.bid.accepted_stake;
    patch(elements.scores, "scores", scoreMarkup(vm) + `<li class="wt-target">${esc(t("score.target", { target: vm.engine.target_points }))}</li>${seriesTargetMarkup(vm.room)}
      ${vm.engine.retourschneider?.status === "active" ? `<li class="wt-retour-tag">${esc(t("retour.active"))}</li>` : ""}`);
    scorepad.update(vm);
    patch(elements.stake, "stake", `<button type="button" ${canBid ? 'data-watten-command="engine" data-kind="bid" data-watten-action="bid"' : ""}
        ${!canBid || vm.busy ? "disabled" : ""} aria-label="${esc(t(canBid ? "bid.tapOffer" : "bid.stake", { points: stake }))}">
        <span>${esc(t(vm.engine.bid.pending ? "bid.offered" : "bid.running"))}</span><strong>${stake}</strong>${canBid ? `<span class="wt-stake-action">${esc(t("bid.raise"))} ＋</span>` : ""}</button>`);
    elements.stake.dataset.points = String(stake);
    elements.stake.hidden = !["play", "bid_response"].includes(vm.engine.phase);
    patch(elements.tools, "tools", vm.canLeave
      ? leaveMatchMarkup(vm.busy)
      : vm.spectator ? `<span class="wt-tag">${esc(t("spectator.kicker"))}</span>` : "");
    renderSeats(vm);
    patch(elements.reference, "reference", referenceMarkup(vm));
    patch(elements.bloedeln, "bloedeln", bloedelnCardsMarkup(vm));
    patch(elements.reveal, "reveal", vm.engine.inspection && vm.actions.includes("inspection_ack") ? inspectionMarkup(vm) : "");
    const roundOptions = roundOptionsMarkup(vm);
    const exclusiveRequest = vm.engine.preplay?.pending && vm.engine.preplay.pending.kind !== "bloedeln";
    const dockedBloedeln = /wt-bloedeln|data-watten-preplay-pending="bloedeln"/.test(roundOptions);
    patch(elements.preplay, "preplay", dockedBloedeln ? roundOptions : "");
    patch(elements.panel, "panel", !vm.paused && exclusiveRequest ? roundOptions : panelMarkup(vm) + (dockedBloedeln ? "" : roundOptions));
    patch(elements.private, "private", privateMarkup(vm));
    const feedbackDialog = elements.private.querySelector("[data-watten-feedback-dialog]");
    if (feedbackDialog && !feedbackDialog.open && typeof feedbackDialog.showModal === "function") feedbackDialog.showModal();
    patch(elements.bubbles, "bubbles", vm.bubbles.map(bubble =>
      `<span class="wt-bubble wt-bubble--${seatPosition(bubble.seat, vm.anchorSeat, vm.count)}" data-watten-call>${esc(bubble.text)}</span>`).join(""));
    const history = historyMarkup(vm, historyPinned);
    const historyFinished = ["deal_complete", "match_complete"].includes(vm.engine.phase);
    const reviewReady = !vm.roundPresentation || vm.roundPresentation.stage === "ready";
    elements.history.hidden = !history || historyFinished && !reviewReady;
    if (elements.history.hidden) elements.history.open = false;
    elements.history.dataset.finished = String(historyFinished);
    patch(elements.history, "history", history);
    elements.history.dataset.pinned = String(historyPinned && !historyFinished);
    if (historyFinished && reviewReady && !historyWasFinished) elements.history.open = vm.engine.phase === "deal_complete";
    else if (history && !historyFinished && historyPinned) elements.history.open = true;
    historyWasFinished = historyFinished && reviewReady;
    elements.handArea.hidden = vm.spectator;
    container.querySelector("[data-wt-table]").dataset.playable = String(vm.actions.includes("play_card"));
    const hand = vm.spectator ? { created: [], nodes: [] } : renderHand(vm);
    positionInspection(vm);
    const trick = renderTrick(vm);
    const reviewing = ["deal_complete", "match_complete"].includes(vm.engine.phase)
      && vm.roundPresentation && vm.roundPresentation.stage !== "collect";
    elements.trick.hidden = Boolean(reviewing);
    elements.trickLabel.hidden = Boolean(reviewing);
    positionTrick.update(vm);
    retourAnnouncement.update(vm);
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

  return { update, destroy() { document.removeEventListener("pointerdown", outsideHistory); positionInspection.destroy(); positionTrick.destroy(); retourAnnouncement.destroy(); scorepad.destroy(); }, motionSources, seatNode, trickNode: () => elements.trick,
    deckNode: () => $("[data-wt-deck]"), collectionNode: seat => elements.seats.querySelector(`[data-wt-catch="${seat}"]`),
    backNodes: () => [...elements.seats.querySelectorAll(".wt-backs:not([hidden]) > i:not([hidden])")] };
}
