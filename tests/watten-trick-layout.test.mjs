import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/watten/trick-layout.js", import.meta.url), "utf8");
const { fitPortraitTrick, fitPortraitPrompt, fitPortraitTrickView, createTrickLayout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const valid = (result, bounds, obstacles) => {
  assert.ok(result);
  assert.ok(result.left >= bounds.left && result.top >= bounds.top);
  assert.ok(result.right <= bounds.right && result.bottom <= bounds.bottom);
  assert.ok(result.height >= result.cardWidth * 570 / 360 + 40, "card faces and both name/winner labels fit together");
  for (const obstacle of obstacles) {
    assert.equal(overlap(result, rect(obstacle.left - 4, obstacle.top - 4, obstacle.width + 8, obstacle.height + 8)), false);
  }
};

test("four complete cards remain readable within a 320px portrait table", () => {
  const bounds = rect(12, 156, 296, 390);
  const obstacles = [rect(13, 174, 100, 132), rect(210, 174, 98, 132), rect(82, 163, 140, 72), rect(14, 480, 292, 66)];
  const result = fitPortraitTrick({ bounds, obstacles, count: 4 });
  valid(result, bounds, obstacles);
  assert.equal(result.cardWidth, 68);
  assert.equal(result.width, 296);
  assert.ok(result.top >= 311 && result.bottom <= 475);
});

test("320x568 normal play makes a 64px row possible by using the spare space above the actual hand", () => {
  const bounds = rect(12, 156, 296, 390);
  const fixed = [rect(5.46, 219.8, 85.05, 56.205), rect(236.03, 220.21, 71.97, 55.05), rect(100, 158, 120, 65),
    rect(40, 210, 24, 38), rect(9.59, 416, 65, 24), rect(8, 440, 304, 116)];
  assert.equal(fitPortraitTrick({ bounds, obstacles: [...fixed, rect(151, 392, 157, 44)], count: 4, labelHeight: 0 }), null);
  const fit = fitPortraitTrick({ bounds, obstacles: [...fixed, rect(158, 408, 150, 44)], count: 4, labelHeight: 0 });
  assert.ok(fit);
  assert.equal(fit.mode, "row");
  assert.equal(fit.cardWidth, 64);
  assert.ok(fit.top >= 281 && fit.bottom <= 403);
});

for (const count of [2, 3, 4]) {
  test(`${count} players: spare portrait space goes to larger faces while names and controls remain clear`, () => {
    const bounds = rect(12, 156, 366, 660);
    const obstacles = [rect(20, 204, 114, 174), rect(260, 204, 114, 174), rect(128, 178, 140, 100), rect(12, 650, 366, 166)];
    const result = fitPortraitTrick({ bounds, obstacles, count });
    valid(result, bounds, obstacles);
    assert.ok(result.cardWidth >= 85);
    assert.ok(result.cardWidth <= 104);
  });
}

test("a decision dock or small visual viewport never forces cards over protected controls", () => {
  const bounds = rect(12, 156, 296, 390);
  const obstacles = [rect(12, 156, 296, 170), rect(12, 450, 296, 96)];
  assert.equal(fitPortraitTrick({ bounds, obstacles, count: 4 }), null);
  assert.equal(fitPortraitTrick({ bounds: rect(12, 156, 296, 140), count: 4 }), null);
});

test("fitting respects a higher existing readable size and ignores empty hidden obstacles", () => {
  const bounds = rect(12, 156, 366, 660);
  const result = fitPortraitTrick({ bounds, count: 4, minimumWidth: 80,
    obstacles: [rect(0, 0, 0, 100), rect(0, 0, 100, 0)] });
  valid(result, bounds, []);
  assert.ok(result.cardWidth >= 80);
  assert.equal(fitPortraitTrick({ bounds: rect(12, 156, 296, 130), count: 4, minimumWidth: 80 }), null);
});

test("a two-by-two fallback exposes ranks without covering most of each face", () => {
  const bounds = rect(12, 156, 366, 660);
  const obstacles = [rect(12, 156, 110, 660), rect(268, 156, 110, 660)];
  const fit = fitPortraitTrick({ bounds, obstacles, count: 4, labelHeight: 0 });
  assert.ok(fit);
  assert.equal(fit.mode, "grid");
  assert.ok(fit.cardWidth >= 76);
  for (const [index, position] of fit.positions.entries()) {
    const rank = rect(position.x + fit.cardWidth * .05, position.y + fit.cardWidth * .05, fit.cardWidth * .16, fit.cardWidth * .2);
    for (const later of fit.positions.slice(index + 1)) {
      assert.equal(overlap(rank, rect(later.x, later.y, fit.cardWidth, fit.cardWidth * 570 / 360)), false);
    }
  }
});

test("the small noninteractive prompt uses spare wood without overlapping a trick or a control", () => {
  const bounds = rect(12, 156, 296, 390), cards = rect(30, 270, 260, 150), hand = rect(12, 450, 296, 96);
  const prompt = fitPortraitPrompt(bounds, [cards, hand]);
  assert.ok(prompt);
  assert.equal(prompt.height, 20);
  assert.equal(overlap(prompt, cards), false);
  assert.equal(overlap(prompt, hand), false);
  assert.equal(fitPortraitPrompt(bounds, [bounds]), null);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 568, height: 320 }]) {
  test(`${viewport.width}x${viewport.height}: leaving portrait restores the original trick styles and removes observers`, () => {
    const style = () => {
      const values = new Map([["--wt-portrait-x", "12px"], ["--wt-portrait-card-x", "20px"]]);
      return { values, setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) };
    };
    const card = { style: style() }, table = { querySelector: () => null };
    const felt = { closest: () => table }, centre = { parentElement: felt, dataset: { wtPortraitTrick: "true" }, style: style() };
    const trick = { parentElement: centre, children: [card] }, listeners = new Map();
    const win = { innerWidth: viewport.width, innerHeight: viewport.height,
      addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
      requestAnimationFrame() {}, cancelAnimationFrame() {} };
    const layout = createTrickLayout(trick, { win });
    layout.update({ count: 4 });
    assert.equal(centre.dataset.wtPortraitTrick, undefined);
    assert.equal(centre.style.values.has("--wt-portrait-x"), false);
    assert.equal(card.style.values.has("--wt-portrait-card-x"), false);
    layout.destroy();
    assert.equal(listeners.size, 0);
  });
}

test("closed review uses a clear 44px target and leaves a separate winner label beside the complete trick", () => {
  const bounds = rect(12, 156, 296, 404);
  const occupied = [rect(5.46, 219.8, 85.05, 56.205), rect(236.03, 220.21, 71.97, 55.05), rect(60, 182.09, 100, 24),
    rect(172.81, 166.62, 71.97, 55.04), rect(38.39, 190, 24, 38), rect(9.59, 416, 65, 24), rect(8, 440, 304, 116)];
  const history = fitPortraitPrompt(bounds, occupied, { height: 44, widths: [136, 128, 112] });
  assert.ok(history);
  assert.equal(history.height, 44);
  const obstacles = [...occupied, history, rect(158, 408, 150, 44)];
  const fit = fitPortraitTrick({ bounds, obstacles, count: 4, labelHeight: 0 });
  assert.ok(fit);
  assert.equal(fit.cardWidth, 64);
  const winner = fitPortraitPrompt(bounds, [...obstacles, fit]);
  assert.ok(winner);
  assert.equal(overlap(winner, fit), false);
  assert.equal(overlap(winner, history), false);
});

test("review toggle schedules layout immediately and its listener is cleaned up", () => {
  const callbacks = new Map(), history = { addEventListener: (type, callback) => callbacks.set(type, callback), removeEventListener: type => callbacks.delete(type) };
  const table = { querySelector: selector => selector === "[data-wt-history]" ? history : null };
  const felt = { closest: () => table }, centre = { parentElement: felt, dataset: {}, style: { removeProperty() {} } };
  const trick = { parentElement: centre, children: [] };
  let scheduled = 0, cancelled = 0;
  const win = { innerWidth: 320, innerHeight: 568, addEventListener() {}, removeEventListener() {},
    requestAnimationFrame() { scheduled++; return 1; }, cancelAnimationFrame() { cancelled++; } };
  const layout = createTrickLayout(trick, { win });
  callbacks.get("toggle")();
  assert.equal(scheduled, 1);
  layout.destroy();
  assert.equal(cancelled, 1);
  assert.equal(callbacks.size, 0);
});

const portraitFixtures = JSON.parse(await readFile(new URL("./fixtures/watten-portrait-tricks.json", import.meta.url), "utf8"));
for (const fixture of portraitFixtures) for (const [seatIndex, seat] of ["bottom", "left", "top", "right"].entries()) for (const packets of [1, 3]) {
  test(`${fixture.name}: completed trick stays readable with ${packets} captured packet(s) at ${seat}`, () => {
    const bounds = rect(12, 156, fixture.width - 24, fixture.height - 164);
    const short = fixture.width <= 350;
    const ownRoleOffset = !short && fixture.obstacles.find(item => item[0] === "bottom")[4] > 60 ? 20.4 : 0;
    const obstacles = fixture.obstacles.map(([region, left, top, width, height]) => rect(left,
      top + (region === "bottom" ? short ? 14 : ownRoleOffset : short && /^(left|right)(-hand)?$/.test(region) ? -6 : 0), width, height));
    let [left, top, width, height] = fixture.piles[seatIndex];
    if (seat === "bottom") top += ownRoleOffset;
    if (short) top += seat === "bottom" ? 14 : ["left", "right"].includes(seat) ? -6 : 0;
    const extra = (packets - 1) * (width + 12);
    if (["right", "top"].includes(seat)) left -= extra;
    obstacles.push(rect(left, top, width + extra, height));
    const result = fitPortraitTrickView({ bounds, obstacles, count: 4, minimumWidth: short ? 64 : 76, labelHeight: 24, history: true });
    assert.ok(result.fit);
    assert.ok(result.fit.cardWidth >= (short ? 64 : 76));
    assert.ok(result.historyFit);
    assert.equal(result.historyFit.height, 44);
    for (const box of [result.fit, result.historyFit, result.labelFit].filter(Boolean)) {
      for (const obstacle of obstacles) assert.equal(overlap(box, obstacle), false);
    }
    assert.equal(overlap(result.fit, result.historyFit), false);
    if (result.labelFit) {
      assert.equal(overlap(result.labelFit, result.fit), false);
      assert.equal(overlap(result.labelFit, result.historyFit), false);
    }
  });
}
