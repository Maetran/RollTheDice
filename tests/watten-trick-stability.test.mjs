import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/watten/trick-layout.js", import.meta.url), "utf8");
const { createTrickLayout, fitPortraitTrickView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

test("a completed portrait trick tries its accepted face size before a smaller rectangular fit", () => {
  const bounds = rect(12, 112, 416, 836);
  const result = fitPortraitTrickView({ bounds, obstacles: [], count: 4, minimumWidth: 76,
    labelHeight: 24, history: true, preferred: { cardWidth: 89, spread: .52 } });
  assert.ok(result.fit && result.historyFit);
  assert.equal(result.fit.cardWidth, 89);
  assert.equal(result.fit.spread, .52);
  assert.equal(result.historyFit.height, 44);
  for (const item of [result.fit, result.historyFit, result.labelFit].filter(Boolean)) {
    assert.ok(item.left >= bounds.left && item.right <= bounds.right && item.top >= bounds.top && item.bottom <= bounds.bottom);
  }
  assert.equal(overlaps(result.fit, result.historyFit), false);
});

test("a new obstacle invalidates a preferred composition instead of retaining a colliding old fit", () => {
  const bounds = rect(12, 112, 376, 720);
  const obstacles = [rect(12, 112, 84, 720), rect(304, 112, 84, 720)];
  const result = fitPortraitTrickView({ bounds, obstacles, count: 4, minimumWidth: 76,
    labelHeight: 24, preferred: { cardWidth: 104, spread: .52 } });
  assert.ok(result.fit);
  assert.ok(result.fit.cardWidth >= 76 && result.fit.cardWidth < 104);
  for (const face of result.fit.painted || [result.fit]) for (const obstacle of obstacles) {
    assert.equal(overlaps(face, obstacle), false);
  }
});

function portraitTable() {
  const style = () => ({ values: new Map(), setProperty(key, value) { this.values.set(key, value); },
    getPropertyValue(key) { return this.values.get(key) || ""; }, removeProperty(key) { this.values.delete(key); } });
  const node = bounds => ({ hidden: false, matches: () => false, getBoundingClientRect: () => bounds });
  const first = { dataset: { key: "leaves-8", position: "top" }, style: style() };
  let obstacles = [node(rect(12, 112, 84, 720)), node(rect(304, 112, 84, 720))];
  const hand = node(rect(8, 832, 384, 112));
  const table = { dataset: { phase: "play" },
    querySelector: selector => selector === "[data-wt-hand-area]" ? hand : null,
    querySelectorAll: selector => selector.includes(".wt-seat-badge") ? obstacles : [] };
  const win = { innerWidth: 400, innerHeight: 956, devicePixelRatio: 1,
    getComputedStyle: () => ({ width: "76px", display: "block", visibility: "visible", opacity: "1" }),
    matchMedia: () => ({ matches: true }), addEventListener() {}, removeEventListener() {},
    requestAnimationFrame() {}, cancelAnimationFrame() {} };
  const felt = { closest: () => table, getBoundingClientRect: () => rect(0, 104, win.innerWidth, 852) };
  const centre = { parentElement: felt, dataset: {}, style: style(), querySelector: () => null };
  const trick = { parentElement: centre, hidden: false, children: [first], firstElementChild: first };
  const layout = createTrickLayout(trick, { win });
  const update = (game = "match-a", deal = "deal-a") => {
    layout.update({ count: 4, anchorSeat: 1, snapshot: { id: game }, engine: { deal_id: deal, deal_revision: 0 } });
    return Number.parseFloat(centre.style.values.get("--wt-portrait-card-width"));
  };
  return { update, layout, win, trick, clearObstacles: () => { obstacles = []; },
    addCard: key => trick.children.push({ dataset: { key }, style: style() }) };
}

test("the same accepted trick keeps its readable face size while later prefixes free more wood", () => {
  const table = portraitTable();
  const first = table.update();
  assert.ok(first >= 76 && first < 104);
  table.clearObstacles();
  table.addCard("acorns-O");
  assert.equal(table.update(), first);
  table.addCard("bells-9");
  assert.equal(table.update(), first);
  table.layout.destroy();
});

for (const change of ["match", "deal", "viewport", "prefix"]) {
  test(`a changed ${change} cannot inherit another portrait trick's smaller face preference`, () => {
    const table = portraitTable();
    assert.ok(table.update() < 104);
    table.clearObstacles();
    if (change === "viewport") table.win.innerWidth = 440;
    if (change === "prefix") table.trick.children[0].dataset.key = "hearts-10";
    const width = table.update(change === "match" ? "match-b" : "match-a", change === "deal" ? "deal-b" : "deal-a");
    assert.equal(width, 104);
    table.layout.destroy();
  });
}

test("a portrait bid moves its closed review off a complete fan even before trick faces render", () => {
  const properties = new Map();
  const history = { hidden: false, dataset: {}, matches: () => false, addEventListener() {}, removeEventListener() {},
    style: { setProperty(key, value) { properties.set(key, value); }, removeProperty(key) { properties.delete(key); } },
    getBoundingClientRect() {
      return this.dataset.wtPortraitHistory ? rect(Number.parseFloat(properties.get("--wt-portrait-history-x")),
        Number.parseFloat(properties.get("--wt-portrait-history-y")), Number.parseFloat(properties.get("--wt-portrait-history-width")), 44)
        : rect(184, 412, 128, 44);
    } };
  const protectedBoxes = [rect(280, 340, 100, 100), rect(120, 466, 258, 136),
    rect(120, 612, 258, 44), rect(8, 690, 374, 142), rect(110, 330, 160, 130)];
  const protectedNodes = protectedBoxes.map(bounds => ({ hidden: false, matches: () => false, getBoundingClientRect: () => bounds }));
  const table = { dataset: { phase: "bid_response" }, querySelector(selector) {
    if (selector === "[data-wt-history]" || selector === "[data-wt-history]:not([open])") return history;
    if (selector === "[data-wt-portrait-history]" && history.dataset.wtPortraitHistory) return history;
    return null;
  }, querySelectorAll: selector => selector.startsWith(".wt-seat-badge") ? protectedNodes : [] };
  const felt = { closest: () => table, getBoundingClientRect: () => rect(0, 104, 390, 740) };
  const centre = { parentElement: felt, querySelector: () => null, dataset: {}, style: { removeProperty() {} } };
  const trick = { parentElement: centre, children: [] };
  const win = { innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame() {}, cancelAnimationFrame() {} };
  const layout = createTrickLayout(trick, { win });
  assert.equal(overlaps(history.getBoundingClientRect(), protectedBoxes[0]), true, "the old dock tab covers the opposing fan");
  layout.update({ count: 4 });
  const fitted = history.getBoundingClientRect();
  assert.equal(history.dataset.wtPortraitHistory, "true");
  assert.equal(fitted.height, 44);
  assert.ok(fitted.width >= 64);
  assert.ok(fitted.left >= 12 && fitted.right <= 378 && fitted.top >= 112 && fitted.bottom <= 836);
  for (const obstacle of protectedBoxes) assert.equal(overlaps(fitted, obstacle), false,
    "the review clears every complete fan, decision, stake, own hand and existing trick");
  assert.ok(fitted.bottom <= protectedBoxes[1].top, "the review remains above the live decision");
  layout.destroy();
  assert.equal(history.dataset.wtPortraitHistory, undefined);
  assert.equal(properties.size, 0);
});
