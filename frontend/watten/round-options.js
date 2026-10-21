// Pre-play choices use only the accepted public request and own legal actions.
// Blödeln never exposes a future card in the shared preparation area.
import { escapeHtml as esc } from "../shared/auth.js";
import { t } from "./cards.js";

const OPTIONS = ["schoeneres", "schlagwechsel", "bloedeln"];
const playerName = (vm, seat) => vm.room.seats[seat]?.name || t("seat.unknown");
const commandButton = (vm, kind, label, primary = false) => `<button type="button" ${primary ? 'class="wt-primary"' : ""}
  data-watten-command="engine" data-kind="${kind}" data-watten-action="${kind}" ${vm.busy ? "disabled" : ""}>${esc(label)}</button>`;

function bloedelnMarkup(vm) {
  if (vm.engine.last_trick || vm.engine.current_trick?.cards?.length
      || ["deal_complete", "match_complete"].includes(vm.engine.phase)) return "";
  if (vm.actions.includes("request_bloedeln")) {
    return `<div class="wt-bloedeln-start" data-watten-bloedeln-start>${commandButton(vm, "request_bloedeln", t("roundOptions.bloedeln.request"), true)}</div>`;
  }
  const status = vm.engine.preplay?.bloedeln_status;
  if (!["accepted", "declined"].includes(status)) return "";
  return `<p class="wt-bloedeln-status" data-watten-bloedeln-status="${status}" role="status">${esc(t(status === "accepted" ? "roundOptions.bloedeln.enabled" : "roundOptions.bloedeln.disabled"))}</p>`;
}

export function roundOptionsMarkup(vm) {
  if (vm.paused) return "";
  const bloedeln = bloedelnMarkup(vm);
  const pending = vm.engine.preplay?.pending;
  if (pending && OPTIONS.includes(pending.kind)) {
    const canRespond = vm.actions.includes("preplay_accept") && vm.actions.includes("preplay_decline");
    return `${bloedeln}<section class="wt-preplay-pending" data-watten-preplay-pending="${pending.kind}" role="group" aria-labelledby="wattenPreplayTitle">
      <h3 id="wattenPreplayTitle">${esc(t(`roundOptions.${pending.kind}.pending`, { name: playerName(vm, pending.requester) }))}</h3>
      <p class="wt-note">${esc(t(`roundOptions.${pending.kind}.description`))}</p>
      ${canRespond ? `<div class="wt-choice-row">${commandButton(vm, "preplay_accept", t(`roundOptions.${pending.kind}.accept`), true)}${commandButton(vm, "preplay_decline", t(`roundOptions.${pending.kind}.decline`))}</div>`
        : `<p class="wt-note" role="status">${esc(t("roundOptions.waiting", { name: playerName(vm, pending.responder) }))}</p>`}
    </section>`;
  }
  const available = OPTIONS.filter(kind => kind !== "bloedeln" && vm.actions.includes(`request_${kind}`));
  if (!available.length) return bloedeln;
  return `${bloedeln}<details class="wt-preplay-options" data-watten-preplay-options>
    <summary>${esc(t("roundOptions.title"))}</summary>
    <div class="wt-preplay-choices">${available.map(kind => `<div class="wt-preplay-choice">
      ${commandButton(vm, `request_${kind}`, t(`roundOptions.${kind}.request`))}
      <p class="wt-note">${esc(t(`roundOptions.${kind}.description`))}</p></div>`).join("")}</div>
  </details>`;
}

export function bloedelnCardsMarkup() {
  // Only the own hand may identify its private forced card. Other players
  // learn it when its owner actually plays it into the public trick.
  return "";
}
