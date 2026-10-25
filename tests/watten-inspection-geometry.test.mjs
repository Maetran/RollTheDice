import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/watten/inspection-geometry.js", import.meta.url), "utf8");
const { fitInspectionAxis, outermostCard, unionOf, cardHitsRect, cardBounds, rectOf: rect } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const centre = box => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Felt-local painted geometry ESTIMATED by eye from the owner's 440x956
// portrait screenshots (felt below a ~165px header), cards at
// clamp(64, 20vw, 112). Not browser measurements; the browser specs measure.
const portrait = {
  region: rect(6, 6, 428, 779),
  hand: [rect(38, 600, 81, 157), rect(105, 600, 72, 157), rect(174, 600, 70, 157), rect(229, 600, 86, 157), rect(287, 600, 114, 157)],
  right: Array.from({ length: 5 }, (_, index) => rect(339, 272 + index * 14, 79, 52)),
  left: Array.from({ length: 5 }, (_, index) => rect(21, 253 + index * 13, 82, 52)),
  identities: [rect(351, 193, 24, 24), rect(341, 223, 44, 18), rect(340, 244, 46, 17), rect(62, 193, 29, 24), rect(50, 223, 53, 18),
    rect(117, 64, 26, 27), rect(105, 95, 51, 19), rect(14, 576, 29, 28), rect(54, 580, 47, 19), rect(5, 9, 28, 43)],
  top: Array.from({ length: 5 }, (_, index) => rect(172 + index * 15, 52, 45, 79)),
  ack: rect(308, 547, 120, 43),
  cards: [{ width: 88, height: 88 * 570 / 360 }, { width: 88, height: 88 * 570 / 360 }],
  captions: [{ width: 60, height: 26 }, { width: 56, height: 26 }],
};

function own(hand, target) { return { anchor: centre(outermostCard(hand, target)), protect: hand, fan: [] }; }
function opponent(fan) { return { anchor: centre(unionOf(fan)), protect: [], fan }; }
const boxOf = (fit, index) => ({ x: fit.poses[index].x, y: fit.poses[index].y, u: fit.axis.unit,
  n: { x: -fit.axis.unit.y, y: fit.axis.unit.x }, hw: fit.poses[index].width / 2, hh: fit.poses[index].height / 2 });
const inside = (box, point) => {
  const dx = point.x - box.x, dy = point.y - box.y;
  return Math.abs(dx * box.u.x + dy * box.u.y) < box.hh && Math.abs(dx * box.n.x + dy * box.n.y) < box.hw;
};

function verify(fit, { actors, region, controls, ownIndex }) {
  assert.equal(fit.status, "fit", "a placement exists");
  const { from, unit, length } = fit.axis;
  assert.deepEqual(from, actors[0].anchor);
  for (const [index, pose] of fit.poses.entries()) {
    const dx = pose.x - from.x, dy = pose.y - from.y;
    assert.ok(Math.abs(dx * -unit.y + dy * unit.x) < 1e-6, `face ${index} stays on the callers' connecting line`);
    assert.ok(pose.t >= 0 && pose.t <= length);
    assert.ok(pose.width >= 51.9, "readable printed width");
    const bounds = cardBounds(boxOf(fit, index));
    assert.ok(bounds.left >= region.left && bounds.right <= region.right && bounds.top >= region.top && bounds.bottom <= region.bottom);
    for (const control of controls) assert.equal(cardHitsRect(boxOf(fit, index), control), false, `face ${index} leaves controls reachable`);
    for (const card of actors[ownIndex].protect) assert.equal(cardHitsRect(boxOf(fit, index), card, 3.9), false, `face ${index} clears the painted own hand`);
    // Opponent fan: at most a minimal edge, never the centre of a painted back.
    for (const back of actors[1 - ownIndex].fan) assert.equal(inside(boxOf(fit, index), centre(back)), false, `face ${index} leaves every opponent back identifiable`);
  }
  assert.ok(fit.poses[0].t < fit.poses[1].t, "each face stays on its own source's side");
  assert.ok(fit.overlap <= .45 + 1e-9, "both faces keep more than half of their length visible");
  for (const label of fit.labels) {
    assert.ok(label.left >= region.left && label.right <= region.right && label.top >= region.top && label.bottom <= region.bottom);
    for (const control of controls) assert.equal(overlap(label, control), false);
  }
  assert.equal(overlap(fit.labels[0], fit.labels[1]), false);
}

test("the own source is the outermost hand card towards the other caller", () => {
  const hand = [rect(0, 10, 60, 90), rect(50, 4, 60, 90), rect(100, 0, 60, 90), rect(150, 4, 60, 90), rect(200, 10, 60, 90)];
  assert.equal(outermostCard(hand, { x: 600, y: -300 }), hand[4], "pointing right starts beyond the fifth card");
  assert.equal(outermostCard(hand, { x: -400, y: -300 }), hand[0], "pointing left starts beyond the first card");
  assert.equal(outermostCard(hand, { x: 130, y: -500 }), hand[2], "straight across starts from the raised middle");
  assert.equal(outermostCard([], { x: 0, y: 0 }), null);
});

test("a caller only slightly right or left but far above still means the fifth or first card", () => {
  // Raised middle card: a diagonal projection would wrongly prefer it.
  const hand = [rect(0, 30, 60, 90), rect(50, 15, 60, 90), rect(100, 0, 60, 90), rect(150, 15, 60, 90), rect(200, 30, 60, 90)];
  const middle = 130;
  assert.equal(outermostCard(hand, { x: middle + 10, y: -3000 }), hand[4]);
  assert.equal(outermostCard(hand, { x: middle - 10, y: -3000 }), hand[0]);
  assert.equal(outermostCard(hand, { x: middle + 1, y: -3000 }), hand[2], "within the tiny alignment epsilon it is straight across");
  // Card order in the DOM does not matter; the horizontal extreme does.
  const shuffled = [hand[3], hand[0], hand[4], hand[2], hand[1]];
  assert.equal(outermostCard(shuffled, { x: middle + 10, y: -3000 }), hand[4]);
  assert.equal(outermostCard(shuffled, { x: middle - 10, y: -3000 }), hand[0]);
});

test("owner screenshot 440x956 bottom→right: both faces leave the playfield middle for the line to the right caller", () => {
  const actors = [own(portrait.hand, centre(unionOf(portrait.right))), opponent(portrait.right)];
  assert.equal(actors[0].anchor.x, centre(portrait.hand[4]).x, "pointing right uses the fifth card");
  const controls = [portrait.ack];
  const fit = fitInspectionAxis({ region: portrait.region, actors, cards: portrait.cards, captions: portrait.captions,
    controls, obstacles: [...portrait.identities, ...portrait.left, ...portrait.top] });
  verify(fit, { actors, region: portrait.region, controls, ownIndex: 0 });
  assert.equal(fit.constrained, false);
  for (const pose of fit.poses) assert.ok(pose.x > portrait.region.left + portrait.region.width / 2, "no return to the table middle");
});

test("without the action row on that line both full-width faces stay near their own sources", () => {
  const actors = [own(portrait.hand, centre(unionOf(portrait.right))), opponent(portrait.right)];
  const controls = [rect(12, 547, 120, 43)];
  const fit = fitInspectionAxis({ region: portrait.region, actors, cards: portrait.cards, captions: portrait.captions,
    controls, obstacles: [...portrait.identities, ...portrait.left, ...portrait.top] });
  verify(fit, { actors, region: portrait.region, controls, ownIndex: 0 });
  assert.equal(fit.relaxed, false, "the opponent fan stays completely clear");
  assert.ok(fit.scale >= .9);
  assert.ok(fit.poses[0].t < fit.axis.length / 2 && fit.poses[1].t > fit.axis.length / 2,
    "each face is closer to its source than the generic midpoint");
});

test("reversed left→bottom caller order keeps the own face beyond the first card and above the own identity", () => {
  const actors = [opponent(portrait.left), own(portrait.hand, centre(unionOf(portrait.left)))];
  assert.equal(actors[1].anchor.x, centre(portrait.hand[0]).x, "pointing left uses the first card");
  const controls = [portrait.ack];
  const obstacles = [...portrait.identities, ...portrait.right, ...portrait.top];
  const fit = fitInspectionAxis({ region: portrait.region, actors, cards: portrait.cards, captions: portrait.captions, controls, obstacles });
  verify(fit, { actors, region: portrait.region, controls, ownIndex: 1 });
  assert.equal(fit.constrained, false);
  for (const pose of fit.poses) assert.ok(pose.x < portrait.region.left + portrait.region.width / 2);
  for (const identity of obstacles) for (const index of [0, 1]) assert.equal(cardHitsRect(boxOf(fit, index), identity), false);
});

test("956x440 landscape bottom→right travels up the diagonal without touching the ACK corner", () => {
  const region = rect(6, 6, 944, 428);
  const hand = Array.from({ length: 5 }, (_, index) => rect(330 + index * 58, 320, 66, 104));
  const right = Array.from({ length: 5 }, (_, index) => rect(860, 170 + index * 12, 60, 40));
  const actors = [own(hand, centre(unionOf(right))), opponent(right)];
  const controls = [rect(840, 362, 104, 44)];
  const card = { width: 83.6, height: 83.6 * 570 / 360 };
  const fit = fitInspectionAxis({ region, actors, cards: [card, card], captions: portrait.captions,
    controls, obstacles: [rect(868, 120, 24, 24), rect(850, 146, 60, 18)] });
  verify(fit, { actors, region, controls, ownIndex: 0 });
  assert.equal(fit.constrained, false);
  for (const pose of fit.poses) assert.ok(pose.x > region.left + region.width / 2);
});

test("two opponents (right→top) use their painted fans as both sources", () => {
  const region = rect(6, 6, 1012, 700);
  const right = Array.from({ length: 5 }, (_, index) => rect(930, 300 + index * 14, 70, 48));
  const top = Array.from({ length: 5 }, (_, index) => rect(440 + index * 18, 20, 48, 70));
  const actors = [opponent(right), opponent(top)];
  const card = { width: 112, height: 112 * 570 / 360 };
  const fit = fitInspectionAxis({ region, actors, cards: [card, card], captions: portrait.captions, controls: [] });
  verify(fit, { actors: [actors[0], { protect: [], fan: top }], region, controls: [], ownIndex: 1 });
  assert.equal(fit.overlap, 0, "ample space keeps both faces apart");
});

test("degenerate sources and impossible tables are reported unfit without any poses", () => {
  const point = { anchor: { x: 50, y: 50 }, protect: [], fan: [] };
  const degenerate = fitInspectionAxis({ region: rect(0, 0, 100, 100), actors: [point, point], cards: portrait.cards, captions: portrait.captions });
  assert.equal(degenerate.status, "unfit");
  assert.equal(degenerate.reason, "degenerate");
  assert.equal(degenerate.poses, undefined);
  const actors = [{ anchor: { x: 20, y: 20 }, protect: [], fan: [] }, { anchor: { x: 80, y: 20 }, protect: [], fan: [] }];
  const tiny = fitInspectionAxis({ region: rect(0, 0, 100, 40), actors, cards: portrait.cards, captions: portrait.captions });
  assert.equal(tiny.status, "unfit", "a face that cannot stay inside the viewport is not painted");
  assert.equal(tiny.reason, "no-clear-position");
  assert.equal(tiny.poses, undefined);
});

test("a control spanning the callers' line is never covered: the result is unfit, not a midpoint", () => {
  const actors = [own(portrait.hand, centre(unionOf(portrait.right))), opponent(portrait.right)];
  // A full-width band between the own hand and the right fan, like a
  // left/right-inset Blödeln status row during inspection.
  const band = rect(12, 420, 416, 120);
  const fit = fitInspectionAxis({ region: portrait.region, actors, cards: portrait.cards, captions: portrait.captions,
    controls: [band, portrait.ack], obstacles: portrait.identities });
  assert.equal(fit.status, "unfit");
  assert.equal(fit.poses, undefined);
  assert.equal(fit.reason, "no-clear-position");
  assert.deepEqual(fit.clear, [null, null], "neither face has a clear spot between the band, the ACK, the hand and the fan");
  assert.ok(fit.required > 0);
});

test("a thin control between both sources is respected and the faces sit on either side of it", () => {
  const actors = [own(portrait.hand, centre(unionOf(portrait.right))), opponent(portrait.right)];
  const band = rect(12, 470, 416, 20);
  const fit = fitInspectionAxis({ region: portrait.region, actors, cards: portrait.cards, captions: portrait.captions,
    controls: [band], obstacles: portrait.identities });
  verify(fit, { actors, region: portrait.region, controls: [band], ownIndex: 0 });
  assert.ok(fit.poses[0].y > band.bottom && fit.poses[1].y < band.top);
});

test("the own hand is hard even when nothing else fits", () => {
  // The other caller sits so close above that every point of the line is
  // inside or right beside the own hand.
  const hand = [rect(100, 300, 200, 150)];
  const actors = [own(hand, { x: 260, y: 290 }), { anchor: { x: 260, y: 290 }, protect: [], fan: [] }];
  const fit = fitInspectionAxis({ region: rect(0, 0, 400, 460), actors, cards: portrait.cards, captions: portrait.captions });
  assert.equal(fit.status, "unfit");
  assert.equal(fit.poses, undefined);
});
