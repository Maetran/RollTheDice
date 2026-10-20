// The beer-pad contains only the public scoring journal, never cards or calls.
import { escapeHtml as esc } from "../shared/auth.js";
import { t } from "./cards.js";

const same = (a, b) => a.length === b.length && a.every(seat => b.includes(seat));
export function nockerlMarksMarkup(count) {
  if (count === null) return "";
  const mark = '<svg class="wt-nockerl-mark" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 10c-2-2-1-6 2-7 3-1 6 1 6 4 0 3-3 5-6 4-2-1-2-3-1-5M2 12l9-1" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return `<span class="wt-series-marks wt-nockerl-marks" role="img" aria-label="${esc(t("series.marks", { count }))}" title="${esc(t("series.marks", { count }))}">
    ${count ? mark.repeat(Math.min(count, 6)) : '<span class="wt-nockerl-zero" aria-hidden="true">—</span>'}${count > 6 ? `<span aria-hidden="true">+${count - 6}</span>` : ""}</span>`;
}

export function createScorepad(scores) {
  const node = document.createElement("section");
  node.className = "wt-scorepad"; node.setAttribute("role", "dialog");
  node.setAttribute("aria-modal", "false"); node.setAttribute("aria-labelledby", "wattenScorepadTitle");
  const native = typeof node.showPopover === "function";
  if (native) node.setAttribute("popover", "auto"); else node.hidden = true;
  document.body.append(node);
  let current = null, selected = null, opened = false, destroyed = false, signature = "";
  const buttons = () => [...scores.querySelectorAll("[data-wt-score-open]")];
  const selectedButton = () => buttons().find(button => button.dataset.wtScoreOpen === selected?.join(","));
  const sync = () => buttons().forEach(button => button.setAttribute("aria-expanded", String(opened && button === selectedButton())));
  function close(focus = false) {
    const source = selectedButton();
    if (native && node.matches(":popover-open")) node.hidePopover();
    else if (!native) node.hidden = true;
    opened = false; sync();
    if (focus) source?.focus({ preventScroll: true });
  }
  const seatNames = seats => seats.map(seat => current.room.seats[seat]?.name || t("seat.unknown")).join(" & ");
  function label(seats) {
    if (!current.spectator && seats.includes(current.viewerSeat)) return t("team.own");
    if (!current.spectator && current.count !== 3) return t("team.opponent");
    return current.count === 4 ? t("team.label", { team: seats.includes(0) ? "A" : "B" }) : seatNames(seats);
  }
  function position() {
    if (!opened) return;
    const source = selectedButton()?.getBoundingClientRect(), rect = node.getBoundingClientRect();
    if (!source) return;
    node.style.left = `${Math.max(12, Math.min(source.left, innerWidth - rect.width - 12))}px`;
    node.style.top = `${Math.max(12, Math.min(source.bottom + 10, innerHeight - rect.height - 12))}px`;
  }
  const number = value => `<span class="wt-scorepad-number">${esc(value)}</span>`;
  function render() {
    if (!current || !selected) return;
    const group = current.groups.find(group => same(group.seats, selected));
    if (!group) { close(); return; }
    const struck = group.points >= current.target - 2;
    const rows = [];
    for (const entry of current.history) {
      const score = entry.scores.find(score => same(score.seats, selected));
      if (!score) continue;
      if (selected.every(seat => entry.winning_seats.includes(seat))) rows.push(`<li>
        <span class="wt-scorepad-round">${esc(t("scorepad.round"))} ${number(entry.round)}<small translate="no">${esc(seatNames(entry.winning_seats))}</small></span>
        <span class="wt-scorepad-add">+${number(entry.points)}</span><strong>${number(score.points)}</strong></li>`);
      if (entry.retourschneider_reset && same(entry.retourschneider_reset.seats, selected)) rows.push(`<li class="wt-scorepad-reset">
        <span class="wt-scorepad-round">${esc(t("scorepad.reset"))}<small>${esc(t("scorepad.round"))} ${number(entry.round)}</small></span>
        <span class="wt-scorepad-add">−${number(entry.retourschneider_reset.erased_points)}</span><strong>${number(0)}</strong></li>`);
    }
    const markup = `<button type="button" class="wt-scorepad-close" data-wt-scorepad-close aria-label="${esc(t("scorepad.close"))}">×</button>
      <p class="wt-scorepad-kicker">${esc(t("scorepad.title"))}</p><h3 id="wattenScorepadTitle">${esc(label(selected))}</h3>
      <p class="wt-scorepad-names" translate="no">${esc(seatNames(selected))}</p>
      <ol class="wt-scorepad-lines">${rows.join("") || `<li class="wt-scorepad-empty">${esc(t("scorepad.empty"))}</li>`}</ol>
      <p class="wt-scorepad-total">${esc(t("scorepad.total"))}<strong>${number(group.points)}</strong></p>`;
    node.classList.toggle("is-gestrichen", struck);
    if (signature !== markup) {
      const focused = node.contains(document.activeElement);
      node.innerHTML = markup; signature = markup;
      if (focused) node.querySelector("button")?.focus({ preventScroll: true });
    }
    position();
  }
  function click(event) {
    const source = event.target.closest("[data-wt-score-open]");
    if (!source || !current) return;
    const seats = source.dataset.wtScoreOpen.split(",").map(Number);
    if (opened && selected && same(selected, seats)) { close(); return; }
    selected = seats; render();
    if (native && !node.matches(":popover-open")) node.showPopover();
    else if (!native) node.hidden = false;
    opened = true; sync(); position(); node.querySelector("button")?.focus({ preventScroll: true });
  }
  const outside = event => { if (!native && opened && !node.contains(event.target) && !scores.contains(event.target)) close(); };
  const toggled = event => { if (!destroyed && event.newState === "closed") { opened = false; sync(); } };
  const keydown = event => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
  const closeClick = event => { if (event.target.closest("[data-wt-scorepad-close]")) close(true); };
  scores.addEventListener("click", click); node.addEventListener("click", closeClick); node.addEventListener("keydown", keydown);
  node.addEventListener("toggle", toggled); document.addEventListener("pointerdown", outside, { passive: true });
  window.addEventListener("resize", position, { passive: true });
  return { update(vm) {
    current = { room: vm.room, viewerSeat: vm.viewerSeat, spectator: vm.spectator, count: vm.count,
      target: vm.engine.target_points, history: vm.snapshot.score_history || [],
      groups: vm.engine.scores.map(group => ({ points: group.points,
        seats: vm.engine.seats.filter(seat => group.members.includes(seat.player_id)).map(seat => seat.seat) })) };
    sync(); if (opened) render();
  }, destroy() {
    destroyed = true; close(); current = null; selected = null;
    scores.removeEventListener("click", click); node.removeEventListener("click", closeClick); node.removeEventListener("keydown", keydown);
    node.removeEventListener("toggle", toggled); document.removeEventListener("pointerdown", outside);
    window.removeEventListener("resize", position); node.remove();
  } };
}
