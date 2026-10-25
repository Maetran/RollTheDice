import { escapeHtml as esc } from "../shared/auth.js";
import { t } from "./cards.js";

export function retourschneiderChoiceMarkup(vm) {
  const choice = vm.engine.retourschneider;
  if (choice?.status !== "available") return "";
  const accepted = choice.accepted_by || [];
  const ownAccepted = accepted.includes(vm.playerId);
  const waiting = choice.members.filter(id => !accepted.includes(id)).map(id =>
    vm.room.seats.find(seat => seat.participant_id === id)?.name || t("seat.unknown")).join(" & ");
  const canChoose = !ownAccepted && vm.actions.includes("retourschneider");
  const actions = canChoose ? `<div class="wt-choice-row">
    <button type="button" class="wt-primary" aria-label="${esc(t("retour.accept"))}" data-watten-command="engine" data-kind="retourschneider" data-watten-action="retourschneider" data-value="accept" ${vm.busy ? "disabled" : ""}><span class="wt-retour-choice-full">${esc(t("retour.accept"))}</span><span class="wt-retour-choice-short" aria-hidden="true">${esc(t("retour.acceptShort"))}</span></button>
    <button type="button" aria-label="${esc(t("retour.decline"))}" data-watten-command="engine" data-kind="retourschneider" data-watten-action="retourschneider" data-value="decline" ${vm.busy ? "disabled" : ""}><span class="wt-retour-choice-full">${esc(t("retour.decline"))}</span><span class="wt-retour-choice-short" aria-hidden="true">${esc(t("retour.declineShort"))}</span></button></div>`
    : `<p class="wt-note" role="status">${esc(t(ownAccepted ? "retour.partnerWaiting" : "retour.teamWaiting", { names: waiting }))}</p>`;
  return `<section class="wt-retour" data-watten-retourschneider-choice>
    <h3 aria-label="${esc(t("retour.title"))}"><span class="wt-retour-title-full">${esc(t("retour.title"))}</span><span class="wt-retour-title-short" aria-hidden="true">${esc(t("retour.titleShort"))}</span></h3><p class="wt-retour-rules" role="region" tabindex="0" aria-label="${esc(t("retour.details"))}">${esc(t("retour.offer"))}</p>${actions}
  </section>`;
}

export function createRetourAnnouncement(node, { accountId = null, liveNode = null } = {}) {
  // The table isolates its stacking context; a body portal lets this purely
  // decorative banner cover the suite header and public chat as well.
  document.body.append(node);
  const shown = new Set();
  const offered = new Set();
  const declined = document.createElement("section");
  declined.className = "wt-retour-declined";
  declined.dataset.wattenRetourDeclined = "";
  declined.hidden = true;
  document.body.append(declined);
  let declinedKey = null;
  const dismissDeclined = () => { declined.hidden = true; declined.replaceChildren(); };
  declined.addEventListener("click", event => {
    if (event.target.closest("[data-watten-retour-dismiss]")) dismissDeclined();
  });
  let timer = 0, liveTimer = 0;
  const hide = () => {
    clearTimeout(timer); clearTimeout(liveTimer);
    node.hidden = true; delete node.dataset.active; node.replaceChildren();
    if (liveNode) liveNode.textContent = "";
  };
  function update(vm) {
    const choice = vm.engine.retourschneider;
    const key = choice && `watten:retour-announced:${accountId ?? "spectator"}:${vm.snapshot.id}:${choice.after_deal_id}`;
    if (choice?.status === "available" && choice.members?.includes(vm.playerId)) offered.add(key);
    if (choice?.status === "declined" && choice.members?.includes(vm.playerId)) {
      hide();
      const outcomeKey = `${key}:declined`;
      // A late snapshot or immediate automatic deal must not erase the
      // explanation. Re-entering a later deal must not replay an old choice.
      if (declinedKey === outcomeKey) return;
      dismissDeclined();
      if ((!offered.has(key) && choice.after_deal_id !== vm.engine.deal_id) || shown.has(outcomeKey)) return;
      shown.add(outcomeKey);
      try {
        if (sessionStorage.getItem(outcomeKey) === "true") return;
        sessionStorage.setItem(outcomeKey, "true");
      } catch { /* The mounted table still prevents repeats. */ }
      declinedKey = outcomeKey;
      declined.innerHTML = `<div role="status"><strong>${esc(t("retour.declinedTitle"))}</strong>
        <p>${esc(t("retour.declined"))}</p></div>
        <button type="button" data-watten-retour-dismiss>${esc(t("retour.dismiss"))}</button>`;
      declined.hidden = false;
      return;
    }
    dismissDeclined();
    declinedKey = null;
    if (choice?.status !== "active") { hide(); return; }
    if (shown.has(key)) return;
    shown.add(key);
    try {
      if (sessionStorage.getItem(key) === "true") return;
      sessionStorage.setItem(key, "true");
    } catch { /* The current mounted table still prevents repeats. */ }
    hide();
    node.innerHTML = `<p class="wt-retour-announcement-title">${esc(t("retour.announcementTitle"))}</p>
      <p class="wt-retour-announcement-subtitle">${esc(t("retour.announcementSubtitle"))}</p>`;
    node.hidden = false;
    node.dataset.active = "true";
    // The stable, initially empty live region also works when a cold snapshot
    // mounts an already active challenge. The visual banner stays decorative.
    liveTimer = setTimeout(() => {
      if (liveNode?.isConnected) liveNode.textContent = `${t("retour.announcementTitle")}. ${t("retour.announcementSubtitle")}.`;
    }, 0);
    timer = setTimeout(hide, 2500);
  }
  return { update, destroy() { hide(); dismissDeclined(); declined.remove(); node.remove(); } };
}
