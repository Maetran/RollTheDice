// Pre-play choices use only the accepted public request and own legal actions.
// In particular, Blödeln faces exist here only after both players consented.
import { escapeHtml as esc } from "../shared/auth.js";
import { t, cardFace, isCard } from "./cards.js";

const OPTIONS = ["schoeneres", "schlagwechsel", "bloedeln"];
const playerName = (vm, seat) => vm.room.seats[seat]?.name || t("seat.unknown");
const commandButton = (vm, kind, label, primary = false) => `<button type="button" ${primary ? 'class="wt-primary"' : ""}
  data-watten-command="engine" data-kind="${kind}" data-watten-action="${kind}" ${vm.busy ? "disabled" : ""}>${esc(label)}</button>`;

function bloedelnConsentMarkup(vm) {
  const consent = vm.engine.preplay?.bloedeln_consent;
  if (!consent || !Array.isArray(consent.decisions) || consent.decisions.length !== 2
      || vm.engine.last_trick || (!consent.pending && vm.engine.current_trick?.cards?.length)
      || ["deal_complete", "match_complete"].includes(vm.engine.phase)) return "";
  const canChoose = vm.actions.includes("bloedeln_accept") && vm.actions.includes("bloedeln_decline");
  const agreed = consent.decisions.every(item => item.accepted === true);
  const decisions = consent.decisions.map(item => {
    const choice = item.accepted === true ? "yes" : item.accepted === false ? "no" : "waiting";
    return `<li data-watten-bloedeln-seat="${item.seat}" data-decision="${choice}"><span translate="no">${esc(playerName(vm, item.seat))}</span><strong>${esc(t(`roundOptions.bloedeln.${choice}`))}</strong></li>`;
  }).join("");
  return `<section class="${consent.pending ? "wt-bloedeln-consent" : "wt-bloedeln-status"}" data-watten-bloedeln-consent="${consent.pending ? "pending" : "settled"}" role="group" aria-labelledby="wattenBloedelnTitle">
    <h3 id="wattenBloedelnTitle">${esc(t(consent.pending ? "roundOptions.bloedeln.request" : agreed ? "roundOptions.bloedeln.enabled" : "roundOptions.bloedeln.disabled"))}</h3>
    ${canChoose ? `<p class="wt-note">${esc(t("roundOptions.bloedeln.description"))}</p><div class="wt-bloedeln-controls">${commandButton(vm, "bloedeln_accept", t("roundOptions.bloedeln.acceptChoice"), true)}${commandButton(vm, "bloedeln_decline", t("roundOptions.bloedeln.declineChoice"))}</div>` : ""}
    <ul class="wt-bloedeln-decisions" aria-live="polite">${decisions}</ul>
    ${consent.pending ? `<p class="wt-note" data-watten-bloedeln-waiting>${esc(t("roundOptions.bloedeln.waitBoth"))}</p>` : ""}
  </section>`;
}

export function roundOptionsMarkup(vm) {
  if (vm.paused) return "";
  const consent = bloedelnConsentMarkup(vm);
  const pending = vm.engine.preplay?.pending;
  if (pending && OPTIONS.includes(pending.kind)) {
    const canRespond = vm.actions.includes("preplay_accept") && vm.actions.includes("preplay_decline");
    return `${consent}<section class="wt-preplay-pending" data-watten-preplay-pending="${pending.kind}" role="group" aria-labelledby="wattenPreplayTitle">
      <h3 id="wattenPreplayTitle">${esc(t(`roundOptions.${pending.kind}.pending`, { name: playerName(vm, pending.requester) }))}</h3>
      <p class="wt-note">${esc(t(`roundOptions.${pending.kind}.description`))}</p>
      ${canRespond ? `<div class="wt-choice-row">${commandButton(vm, "preplay_accept", t(`roundOptions.${pending.kind}.accept`), true)}${commandButton(vm, "preplay_decline", t(`roundOptions.${pending.kind}.decline`))}</div>`
        : `<p class="wt-note" role="status">${esc(t("roundOptions.waiting", { name: playerName(vm, pending.responder) }))}</p>`}
    </section>`;
  }
  const available = OPTIONS.filter(kind => (kind !== "bloedeln" || !vm.engine.preplay?.bloedeln_consent) && vm.actions.includes(`request_${kind}`));
  if (!available.length) return consent;
  return `${consent}<details class="wt-preplay-options" data-watten-preplay-options>
    <summary>${esc(t("roundOptions.title"))}</summary>
    <div class="wt-preplay-choices">${available.map(kind => `<div class="wt-preplay-choice">
      ${commandButton(vm, `request_${kind}`, t(`roundOptions.${kind}.request`))}
      <p class="wt-note">${esc(t(`roundOptions.${kind}.description`))}</p></div>`).join("")}</div>
  </details>`;
}

export function bloedelnCardsMarkup(vm) {
  // Reveal the agreed original bottoms before play. During the trick, own
  // forced cards stay marked in the hand and the public centre belongs to plays.
  if (vm.engine.last_trick || vm.engine.current_trick?.cards?.length
      || !["show_ready", "inspection", "play", "bid_response"].includes(vm.engine.phase)) return "";
  const played = new Set((vm.engine.current_trick?.cards || []).map(item => item.card));
  const cards = (vm.engine.preplay?.bloedeln_cards || []).filter(item => isCard(item.card) && !played.has(item.card));
  if (!cards.length) return "";
  return `<section class="wt-bloedeln-preparation" data-watten-bloedeln-cards aria-label="${esc(t("roundOptions.bloedeln.public"))}">
    <h3>${esc(t("roundOptions.bloedeln.public"))}</h3>
    <div class="wt-bloedeln-cards">${cards.map(item => `<figure>${cardFace(item.card, { className: "wt-card--mini" })}<figcaption translate="no">${esc(playerName(vm, item.seat))}</figcaption></figure>`).join("")}</div>
    <p class="wt-note">${esc(t("roundOptions.bloedeln.first"))}</p>
  </section>`;
}
