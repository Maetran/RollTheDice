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

test("a 320px table keeps an overlapping pile with cards pointing towards their owners", () => {
  const bounds = rect(12, 112, 296, 434);
  const obstacles = [rect(13, 136, 100, 132), rect(210, 136, 98, 132), rect(82, 125, 140, 72), rect(14, 480, 292, 66)];
  const result = fitPortraitTrick({ bounds, obstacles, count: 4 });
  valid(result, bounds, obstacles);
  assert.equal(result.mode, "stack");
  const [bottom, left, top, right] = result.positions;
  assert.ok(left.x < top.x && top.x < right.x);
  assert.equal(bottom.x, top.x);
  assert.ok(top.y < left.y && left.y < bottom.y && right.y < bottom.y);
  const faces = result.positions.map(position => rect(position.x, position.y, result.cardWidth, result.cardWidth * 570 / 360));
  for (const [index, face] of faces.entries()) assert.equal(faces.some((other, otherIndex) => index !== otherIndex && overlap(face, other)), true);
  assert.ok(right.x - left.x >= result.cardWidth * 1.1, "side cards expose more of their faces");
  assert.ok(bottom.y - top.y >= result.cardWidth * 570 / 360 * .35, "top and bottom cards visibly spread towards their seats");
});

test("320x568 keeps the compact pile above the hand while preserving the actual play order", () => {
  const bounds = rect(12, 112, 296, 434);
  const fixed = [rect(5.46, 181.8, 85.05, 56.205), rect(236.03, 182.21, 71.97, 55.05), rect(100, 120, 120, 65),
    rect(40, 172, 24, 38), rect(9.59, 416, 65, 24), rect(8, 440, 304, 116)];
  const fit = fitPortraitTrick({ bounds, obstacles: [...fixed, rect(158, 424, 150, 44)], count: 4, labelHeight: 0,
    positions: ["right", "bottom", "left"] });
  assert.ok(fit);
  assert.equal(fit.mode, "stack");
  assert.ok(fit.cardWidth >= 64);
  const [right, bottom, left] = fit.positions;
  assert.ok(right.x > bottom.x && bottom.x > left.x);
  assert.ok(fit.top >= 242 && fit.bottom <= 419);
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

test("finishing a trick keeps the reserved composition and every existing seat anchor stable", () => {
  const options = { bounds: rect(12, 112, 369, 728), count: 4, obstacles: [], labelHeight: 24, history: false };
  const live = fitPortraitTrickView({ ...options, positions: ["right", "bottom", "left"] });
  const complete = fitPortraitTrickView({ ...options, positions: ["right", "bottom", "left", "top"] });
  assert.ok(live.fit && complete.fit);
  for (const key of ["left", "top", "width", "height", "cardWidth", "rowHeight"]) assert.equal(complete.fit[key], live.fit[key]);
  assert.deepEqual(complete.fit.positions.slice(0, 3), live.fit.positions);
});

test("a narrow free column retains a spatial pile instead of becoming a grid", () => {
  const bounds = rect(12, 112, 366, 704);
  const obstacles = [rect(12, 112, 90, 704), rect(288, 112, 90, 704)];
  const fit = fitPortraitTrick({ bounds, obstacles, count: 4, labelHeight: 0 });
  assert.ok(fit);
  assert.equal(fit.mode, "stack");
  assert.ok(fit.cardWidth >= 64);
  assert.ok(fit.width <= fit.cardWidth * 2.5);
});

test("a later portrait trick stays centred above captured packets instead of growing against the right screen edge", () => {
  const bounds = rect(12, 112, 416, 832);
  const obstacles = [rect(12, 112, 366, 270), rect(12, 650, 150, 150), rect(12, 800, 366, 130)];
  const fit = fitPortraitTrick({ bounds, obstacles, count: 4, minimumWidth: 76 });
  valid(fit, bounds, obstacles);
  assert.equal(fit.left + fit.width / 2, bounds.left + bounds.width / 2);
  assert.ok(fit.cardWidth >= 76);
  assert.ok(fit.cardWidth < 104, "readable central faces take priority over maximum-sized off-centre faces");
});

for (const seats of [["bottom", "top"], ["bottom", "left", "right"], ["bottom", "left", "top", "right"]]) {
  test(`${seats.length} portrait players: every clockwise prefix is connected and preserves the earlier card slots`, () => {
    const options = { bounds: rect(12, 112, 416, 832), obstacles: [], count: seats.length, minimumWidth: 64 };
    for (let leader = 0; leader < seats.length; leader++) {
      const order = [...seats.slice(leader), ...seats.slice(0, leader)];
      const complete = fitPortraitTrick({ ...options, positions: order });
      for (let length = 1; length <= seats.length; length++) {
        const prefix = fitPortraitTrick({ ...options, positions: order.slice(0, length) });
        assert.ok(prefix);
        assert.equal(prefix.left, complete.left); assert.equal(prefix.top, complete.top);
        assert.deepEqual(prefix.positions, complete.positions.slice(0, length));
        const faces = prefix.positions.map(position => rect(position.x, position.y, prefix.cardWidth, prefix.cardWidth * 570 / 360));
        const connected = new Set([0]);
        for (let step = 0; step < length; step++) for (let index = 0; index < length; index++) {
          if ([...connected].some(other => overlap(faces[index], faces[other]))) connected.add(index);
        }
        assert.equal(connected.size, length, `${order.slice(0, length).join(" → ")} must form one pile`);
        for (const [index, position] of prefix.positions.entries()) {
          const caption = rect(position.x + position.ownerX, position.y + position.ownerY, position.ownerWidth, 15);
          for (const face of faces.slice(index + 1)) assert.equal(overlap(caption, face), false, "a later face cannot cover an earlier owner's outward caption");
        }
      }
    }
  });
}

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
  const bounds = rect(12, 112, 296, 448);
  const occupied = [rect(5.46, 181.8, 85.05, 56.205), rect(236.03, 182.21, 71.97, 55.05), rect(60, 144.09, 100, 24),
    rect(172.81, 128.62, 71.97, 55.04), rect(38.39, 152, 24, 38), rect(9.59, 416, 65, 24), rect(8, 440, 304, 116)];
  const history = fitPortraitPrompt(bounds, occupied, { height: 44, widths: [136, 128, 112] });
  assert.ok(history);
  assert.equal(history.height, 44);
  const obstacles = [...occupied, history, rect(158, 424, 150, 44)];
  const fit = fitPortraitTrick({ bounds, obstacles, count: 4, labelHeight: 0 });
  assert.ok(fit);
  assert.ok(fit.cardWidth >= 64);
  const winner = fitPortraitPrompt(bounds, [...obstacles, fit]);
  assert.ok(winner);
  assert.equal(overlap(winner, fit), false);
  assert.equal(overlap(winner, history), false);
});

test("the actual 320x568 own-winner layout retains readable faces beside its captured packet", () => {
  // Native completed-trick bounds from the 902518a35095 browser regression,
  // with the relocated packet and visible external labels measured again in
  // the R7 real own-winner flow. Badge frames alone do not cover these labels.
  const bounds = rect(12, 112, 296, 448);
  const obstacles = [
    rect(38.39062, 150.39062, 24, 38), // stock
    rect(12, 416, 96, 24), // own badge
    rect(6, 188, 84, 44), // left badge and four painted backs
    rect(7.69865, 246.51146, 60.52187, 43.46815),
    rect(10.29508, 258.32944, 57.46836, 38.05453),
    rect(10.29508, 267.45978, 57.46836, 38.05453),
    rect(7.69865, 273.86414, 60.52187, 43.46814),
    rect(147.99219, 112, 24, 24), // top badge and four painted backs
    rect(151.95006, 148.26215, 43.46817, 60.52188),
    rect(145.54570, 150.85858, 38.05455, 57.46835),
    rect(136.41537, 150.85858, 38.05455, 57.46835),
    rect(124.59740, 148.26215, 43.46817, 60.52188),
    rect(230, 188, 84, 44), // right badge and four painted backs
    rect(251.79510, 273.87976, 60.52185, 43.46814),
    rect(252.25218, 267.47540, 57.46837, 38.05453),
    rect(252.25218, 258.34506, 57.46837, 38.05453),
    rect(251.79510, 246.52708, 60.52185, 43.46815),
    rect(150, 408, 158, 44), // actual enabled stake button
    rect(8, 440, 304, 116), // own hand
    rect(45, 419.28125, 57, 17.4375), // own name
    rect(33, 191.28125, 57, 17.4375), // left name
    rect(24.890625, 213.8125, 46.21875, 18.390625), // left Farbe role
    rect(175.9921875, 115, 57, 17.4375), // top name outside its 24px badge
    rect(90.8828125, 115, 53.109375, 18.390625), // top Schlag role
    rect(230, 191.28125, 57, 17.4375), // right name
    // The packet frame is now at x12/y330. Protect the complete measured
    // painted-card and counter envelope as well, beyond its 30px frame.
    rect(3.4706, 324.9458, 47.0588, 59.5386),
  ];
  const result = fitPortraitTrickView({ bounds, obstacles, count: 4, minimumWidth: 64, labelHeight: 24, history: true });
  assert.ok(result.fit, "an own-seat winner keeps the spatial pile instead of falling back to 52px faces");
  assert.ok(result.fit.cardWidth >= 64);
  assert.equal(result.fit.mode, "stack");
  assert.ok(result.historyFit);
  assert.equal(result.historyFit.height, 44);
  const visible = [result.fit, result.historyFit, result.labelFit].filter(Boolean);
  for (const [index, item] of visible.entries()) {
    assert.ok(item.left >= bounds.left && item.right <= bounds.right && item.top >= bounds.top && item.bottom <= bounds.bottom);
    for (const obstacle of obstacles) assert.equal(overlap(item, obstacle), false);
    for (const other of visible.slice(index + 1)) assert.equal(overlap(item, other), false);
  }
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
    // These recorded obstacles used the previous 96px toolbar. The new single
    // 52px row expands the felt upwards; fixed bottom docks stay on baseline.
    const bounds = rect(12, 112, fixture.width - 24, fixture.height - 120);
    const headerOffset = region => /^(left|right)(-hand)?$/.test(region) ? -38 : /^(stock|top)(-hand)?$/.test(region) ? -42 : 0;
    const short = fixture.width <= 350;
    const ownRoleOffset = !short && fixture.obstacles.find(item => item[0] === "bottom")[4] > 60 ? 20.4 : 0;
    const obstacles = fixture.obstacles.map(([region, left, top, width, height]) => rect(left,
      top + headerOffset(region) + (region === "bottom" ? short ? 14 : ownRoleOffset : short && /^(left|right)(-hand)?$/.test(region) ? -6 : 0), width, height));
    let [left, top, width, height] = fixture.piles[seatIndex];
    top += headerOffset(seat);
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
