// Nockerl totals are a public server projection. No browser-side accumulation.
import { escapeHtml as esc } from "../shared/auth.js";
import { t } from "./cards.js";

const sameSeats = (a, b) => a.length === b.length && a.every(seat => b.includes(seat));
export function seriesMarks(room, seats, engine = null) {
  const series = room.series;
  if (!series) {
    // Older completed checkpoints predate persistent series. Their public
    // terminal result is still authoritative for this first game's marks.
    if (engine?.phase !== "match_complete" || !Array.isArray(engine.nockerl)) return null;
    const players = engine.seats.filter(item => seats.includes(item.seat)).map(item => item.player_id);
    return engine.nockerl.filter(item => sameSeats(item.members, players)).reduce((sum, item) => sum + item.count, 0);
  }
  if (series.pending_roster) return null;
  const value = series.nockerl?.find(group => sameSeats(group.seats, seats))?.count;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function seriesTargetMarkup(room) {
  return room.series?.target ? `<li class="wt-series-target">${esc(t("series.target", { count: room.series.target }))}</li>` : "";
}

export function seriesFinishedTitle(vm) {
  const series = vm.room.series;
  if (!series?.finished || !series.target) return "";
  return t(vm.spectator ? "series.finished" : series.winner_seats.includes(vm.viewerSeat) ? "series.won" : "series.lost");
}

export function seriesSummaryMarkup(vm) {
  const series = vm.room.series;
  if (!series) return "";
  if (series.pending_roster) return `<p class="wt-series-summary wt-note">${esc(t("series.pending"))}</p>`;
  const label = seats => !vm.spectator && seats.includes(vm.viewerSeat) ? t("team.own")
    : !vm.spectator && vm.count !== 3 ? t("team.opponent")
      : vm.count === 4 ? t("team.label", { team: seats.includes(0) ? "A" : "B" })
        : seats.map(seat => vm.room.seats[seat]?.name || t("seat.number", { seat: seat + 1 })).join(" & ");
  const groups = (series.nockerl || []).slice().sort((a, b) => Number(b.seats.includes(vm.viewerSeat)) - Number(a.seats.includes(vm.viewerSeat)));
  return `<section class="wt-series-summary${series.finished ? " wt-series-result" : ""}" data-watten-series aria-label="${esc(t("series.standing"))}">
    <p class="wt-series-caption">${esc(t(series.target ? "series.tournamentStanding" : "series.standing"))}</p>
    <dl class="wt-series-standings">${groups.map(group => `<div><dt>${esc(label(group.seats))}</dt><dd>${esc(t("series.marks", { count: group.count }))}</dd></div>`).join("")}</dl>
  </section>`;
}
