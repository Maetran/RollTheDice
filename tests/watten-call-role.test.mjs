import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const table = await readFile(new URL("../frontend/watten/table.js", import.meta.url), "utf8");
const positions = table.slice(table.indexOf("export function seatPosition"), table.indexOf("const names =")).replace("export ", "");
const badge = table.slice(table.indexOf("function seatBadge"), table.indexOf("function inspectionMarkup"));
const seatBadge = runInNewContext(`${positions};${badge};seatBadge`, {
  POSITIONS: { 3: ["bottom", "left", "right"] },
  t: value => value,
  esc: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  partyMembers: (engine, party) => engine.seats.filter(seat => seat.party === party),
  seatName: (vm, seat) => vm.room.seats[seat].name,
  publicTitleMarkup: () => "",
  window: {},
});

function fixture() {
  return { count: 3, viewerSeat: 0, anchorSeat: 0, awaited: [],
    room: { seats: [0, 1, 2].map(seat => ({ name: `Player ${seat}` })) },
    engine: { announcement_roles: { strike: 1, colour: 1 }, dealer_seat: 2, bid: {},
      seats: [0, 1, 2].map(seat => ({ player_id: `p${seat}`, party: seat === 1 ? 1 : 0, card_count: 5, tricks_won: 0 })) },
    bubbles: [{ seat: 1, text: "Strike: <Seven>" }, { seat: 1, text: "Trump: Bells & more" }] };
}

test("a three-seat solo caller retains both escaped deliveries and reserves both role lines", () => {
  const html = seatBadge(fixture(), 1).badge;
  assert.equal((html.match(/data-watten-role-call="1"/g) || []).length, 2);
  assert.ok(html.includes("Strike: &lt;Seven>"));
  assert.ok(html.includes("Trump: Bells &amp; more"));
  assert.ok(html.includes("--wt-role-lines:2"));
  assert.equal((html.match(/class="wt-role-name"/g) || []).length, 2);
});

test("a spectator's bottom anchor uses only the own-call slot, never a duplicate badge call", () => {
  const vm = fixture();
  vm.viewerSeat = null;
  vm.anchorSeat = 1;
  assert.ok(!seatBadge(vm, 1).badge.includes("data-watten-role-call"));
  vm.anchorSeat = 0;
  assert.equal((seatBadge(vm, 1).badge.match(/data-watten-role-call/g) || []).length, 2);
});

test("retiring the deliveries restores the two static roles without changing their reserved lines", () => {
  const vm = fixture();
  vm.bubbles = [];
  const html = seatBadge(vm, 1).badge;
  assert.ok(!html.includes("data-watten-role-call"));
  assert.ok(html.includes("--wt-role-lines:2"));
  assert.equal((html.match(/class="wt-role-name"/g) || []).length, 2);
});
