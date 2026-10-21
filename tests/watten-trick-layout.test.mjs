import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/watten/trick-layout.js", import.meta.url), "utf8");
const { fitPortraitTrick, fitPortraitPrompt, createTrickLayout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
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
