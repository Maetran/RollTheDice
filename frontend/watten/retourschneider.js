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
    <button type="button" class="wt-primary" data-watten-command="engine" data-kind="retourschneider" data-watten-action="retourschneider" data-value="accept" ${vm.busy ? "disabled" : ""}>${esc(t("retour.accept"))}</button>
    <button type="button" data-watten-command="engine" data-kind="retourschneider" data-watten-action="retourschneider" data-value="decline" ${vm.busy ? "disabled" : ""}>${esc(t("retour.decline"))}</button></div>`
    : `<p class="wt-note" role="status">${esc(t(ownAccepted ? "retour.partnerWaiting" : "retour.teamWaiting", { names: waiting }))}</p>`;
  return `<section class="wt-retour" data-watten-retourschneider-choice>
    <h3>${esc(t("retour.title"))}</h3><p>${esc(t("retour.offer"))}</p>${actions}
  </section>`;
}

export function createRetourAnnouncement(node, { accountId = null, liveNode = null } = {}) {
  // The table isolates its stacking context; a body portal lets this purely
  // decorative banner cover the suite header and public chat as well.
  document.body.append(node);
  const shown = new Set();
  let timer = 0, liveTimer = 0;
  const hide = () => {
    clearTimeout(timer); clearTimeout(liveTimer);
    node.hidden = true; delete node.dataset.active; node.replaceChildren();
    if (liveNode) liveNode.textContent = "";
  };
  function update(vm) {
    const choice = vm.engine.retourschneider;
    if (choice?.status !== "active") { hide(); return; }
    const key = `watten:retour-announced:${accountId ?? "spectator"}:${vm.snapshot.id}:${choice.after_deal_id}`;
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
  return { update, destroy() { hide(); node.remove(); } };
}
