// Waiting-room markup only. Every control carries a data-watten-command; the
// page controller binds the click to its mounted account and socket.
import { escapeHtml as esc } from "../shared/auth.js";
import { t } from "./cards.js";

const TEAM_NAMES = ["A", "B"];
const HINT_KEY = "watten_landscape_hint_dismissed";

export const teamName = team => TEAM_NAMES[team] ?? "";

export function landscapeHintDismissed() {
  try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return false; }
}

export function dismissLandscapeHint() {
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* Session-only dismissal. */ }
}

export function recipeSummary(recipe) {
  if (!recipe) return [];
  const items = [
    t("recipe.players", { count: recipe.player_count }),
    t(recipe.blind ? "recipe.blind" : "recipe.open"),
    t(recipe.determination === "ladinisch" ? "recipe.ladinisch" : "recipe.normal"),
    t("recipe.target", { points: recipe.target_points }),
    t(recipe.critical ? "recipe.critical" : "recipe.noCritical"),
  ];
  if (recipe.show_rechter) items.push(t("recipe.showRechter"));
  if (recipe.trick_history) items.push(t("recipe.trickHistory"));
  if (recipe.partner_hand) items.push(t("recipe.partnerHand"));
  if (recipe.password_required) items.push(t("recipe.password"));
  return items;
}

export function recipeMarkup(recipe) {
  return `<ul class="wt-recipe" aria-label="${esc(t("recipe.label"))}">${recipeSummary(recipe)
    .map(item => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function landscapeHint() {
  if (landscapeHintDismissed()) return "";
  return `<aside class="wt-landscape-hint" data-watten-landscape-hint>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8h12v10H4zM18 6a5 5 0 0 0-5-3m5 3-2-1m2 1-1 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    <p>${esc(t("hint.landscape"))}</p>
    <button type="button" class="wt-icon-button" data-watten-command="dismiss-hint" aria-label="${esc(t("hint.dismiss"))}">×</button>
  </aside>`;
}

function seatSlot(room, seat, { member, viewerSeat, busy }) {
  const info = room.seats[seat] || {};
  const count = room.recipe.player_count;
  const own = viewerSeat === seat;
  const host = info.participant_id && info.participant_id === room.host_participant_id;
  const name = info.is_cpu ? t("seat.cpu") : info.name;
  const team = count === 4 ? seat % 2 : null;
  const label = count === 4
    ? t("seat.takeTeam", { seat: seat + 1, team: teamName(team) })
    : t("seat.take", { seat: seat + 1 });
  const free = !info.participant_id && !info.is_cpu;
  const button = member && free && room.status === "waiting"
    ? `<button type="button" data-watten-command="take-seat" data-seat="${seat}" ${busy ? "disabled" : ""}>${esc(label)}</button>` : "";
  return `<li class="wt-seat-slot${own ? " is-own" : ""}${free ? " is-free" : ""}" data-watten-seat="${seat}">
    <span class="wt-seat-number">${esc(t("seat.number", { seat: seat + 1 }))}</span>
    ${free ? `<span class="wt-seat-free">${esc(t("seat.free"))}</span>`
      : `<strong${info.is_cpu ? "" : " translate=\"no\""}>${esc(name || "")}</strong>`}
    ${own ? `<span class="wt-tag">${esc(t("seat.you"))}</span>` : ""}
    ${host ? `<span class="wt-tag wt-tag--host">${esc(t("seat.host"))}</span>` : ""}
    ${button}
  </li>`;
}

function seatsMarkup(room, context) {
  const count = room.recipe.player_count;
  if (count === 4) {
    return `<p class="wt-note">${esc(t("waiting.teamsExplained"))}</p><div class="wt-teams">${[0, 1].map(team => `
      <section class="wt-team" aria-labelledby="wattenTeam${team}">
        <h3 id="wattenTeam${team}">${esc(t("team.label", { team: teamName(team) }))}</h3>
        <ol class="wt-seat-list">${[team, team + 2].map(seat => seatSlot(room, seat, context)).join("")}</ol>
      </section>`).join("")}</div>`;
  }
  return `<ol class="wt-seat-list">${Array.from({ length: count }, (_, seat) => seatSlot(room, seat, context)).join("")}</ol>`;
}

export function joinFormMarkup({ locked, error = "", busy = false, started = false }) {
  if (started) {
    return `<div class="wt-join"><p>${esc(t("join.started"))}</p>
      <a class="wt-button wt-button--ghost" data-watten-spectate-link href="${esc(location.pathname.replace(/\/$/, ""))}/zuschauen">${esc(t("join.spectate"))}</a></div>`;
  }
  return `<form class="wt-join" data-watten-join>
    ${locked ? `<label>${esc(t("join.password"))}<input name="password" type="password" autocomplete="off" maxlength="100" required></label>` : ""}
    <button type="submit" ${busy ? "disabled" : ""}>${esc(t("join.submit"))}</button>
    <p class="wt-error" role="alert">${esc(error)}</p>
  </form>`;
}

export function spectateFormMarkup({ error = "", busy = false }) {
  return `<form class="wt-join" data-watten-spectate>
    <label>${esc(t("join.password"))}<input name="password" type="password" autocomplete="off" maxlength="100" required></label>
    <button type="submit" ${busy ? "disabled" : ""}>${esc(t("spectate.submit"))}</button>
    <p class="wt-error" role="alert">${esc(error)}</p>
  </form>`;
}

/**
 * mode: "member" (seat controls), "preview" (before joining) or "spectator".
 */
export function waitingRoomMarkup(snapshot, { mode, viewerId, busy = false, extra = "" }) {
  const room = snapshot.room;
  const member = mode === "member";
  const viewer = room.members.find(item => item.participant_id === viewerId);
  const viewerSeat = viewer?.seat ?? null;
  const host = room.members.find(item => item.participant_id === room.host_participant_id);
  const isHost = member && viewerId === room.host_participant_id;
  const full = room.seats.every(seat => seat.participant_id);
  const unseated = room.members.filter(item => item.seat === null && item.participant_id !== viewerId);
  const status = room.status === "closed" ? t("waiting.closed") : "";
  return `<section class="wt-waiting" aria-labelledby="wattenWaitingTitle">
    <header class="wt-waiting-head">
      <p class="wt-kicker">${esc(t(mode === "spectator" ? "spectator.kicker" : "waiting.kicker"))}</p>
      <h2 id="wattenWaitingTitle" translate="no">${esc(snapshot.name || "")}</h2>
      ${recipeMarkup(room.recipe)}
    </header>
    ${member ? landscapeHint() : ""}
    ${status ? `<p class="wt-note" role="status">${esc(status)}</p>` : ""}
    ${seatsMarkup(room, { member, viewerSeat, busy })}
    ${unseated.length ? `<p class="wt-note">${esc(t("waiting.unseated", { names: unseated.map(item => item.name).join(", ") }))}</p>` : ""}
    ${member && viewerSeat === null && room.status === "waiting" ? `<p class="wt-note wt-note--strong">${esc(t("waiting.chooseSeat"))}</p>` : ""}
    ${room.status === "waiting" ? `<p class="wt-note">${esc(isHost
      ? t(full ? "waiting.hostReady" : "waiting.hostWaiting")
      : t("waiting.guestWaiting", { name: host?.name || "" }))}</p>` : ""}
    ${extra}
    ${member ? `<div class="wt-actions">
      ${isHost && room.status === "waiting" ? `<button type="button" data-watten-command="start" ${!full || busy ? "disabled" : ""}>${esc(t("waiting.start"))}</button>` : ""}
      <button type="button" class="wt-button--ghost" data-watten-command="copy-link">${esc(t("waiting.copyLink"))}</button>
      ${room.status === "waiting" ? `<button type="button" class="wt-button--ghost" data-watten-command="leave-waiting" ${busy ? "disabled" : ""}>${esc(t("waiting.leave"))}</button>` : ""}
    </div>
    ${room.recipe.password_required ? `<p class="wt-note">${esc(t("waiting.passwordSeparately"))}</p>` : ""}
    <p class="wt-note" data-watten-copy-status role="status"></p>` : ""}
  </section>`;
}
