import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../frontend/hausdepp/pile-hold-fan.js', import.meta.url), 'utf8');
const { holdFanLayout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const RATIO = 57 / 36;

// Painted bounds of every rotated face (origin: bottom centre), after the
// optional whole-fan scale around the stage centre, relative to the box centre.
function paintedBounds(layout) {
  const tall = layout.card * RATIO;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const slot of layout.rows.flat()) {
    const angle = slot.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const originX = slot.x + layout.width / 2 + layout.card / 2, originY = slot.y + tall;
    for (const [x, y] of [[-layout.card / 2, -tall], [layout.card / 2, -tall], [-layout.card / 2, 0], [layout.card / 2, 0]]) {
      const px = originX + x * cos - y * sin, py = originY + x * sin + y * cos;
      const sx = (px - layout.width / 2) * layout.scale, sy = (py - layout.height / 2) * layout.scale;
      left = Math.min(left, sx); right = Math.max(right, sx); top = Math.min(top, sy); bottom = Math.max(bottom, sy);
    }
  }
  return { left, right, top, bottom };
}

const VIEWPORTS = [[320, 568], [390, 844], [568, 320], [480, 260], [640, 280], [844, 390], [1440, 900], [260, 200]];

test('every pile size from one card to a full deck stays inside small portrait and landscape screens', () => {
  for (const [viewWidth, viewHeight] of VIEWPORTS) {
    // The same box the overlay offers: 16px gutters and the count chip.
    const width = Math.min(viewWidth - 32, 960), height = viewHeight - 32 - 12 - 28;
    for (let count = 1; count <= 36; count += 1) {
      const layout = holdFanLayout(count, width, height);
      const label = `${viewWidth}x${viewHeight}, ${count} cards`;
      assert.equal(layout.rows.flat().length, count, label);
      assert.deepEqual(layout.rows.flat().map(slot => slot.index), [...Array(count).keys()], `${label}: oldest first, top card last`);
      assert.ok(layout.scale > 0 && layout.scale <= 1, label);
      const bounds = paintedBounds(layout);
      assert.ok(bounds.left >= -width / 2 - .5 && bounds.right <= width / 2 + .5, `${label}: horizontal ${JSON.stringify(bounds)}`);
      assert.ok(bounds.top >= -height / 2 - .5 && bounds.bottom <= height / 2 + .5, `${label}: vertical ${JSON.stringify(bounds)}`);
    }
  }
});

test('large piles keep readable cards and corners on common phones', () => {
  for (const [viewWidth, viewHeight] of [[320, 568], [390, 844], [568, 320]]) {
    const layout = holdFanLayout(36, viewWidth - 32, viewHeight - 72);
    assert.equal(layout.scale, 1, `${viewWidth}x${viewHeight} needs no emergency scale`);
    assert.ok(layout.card >= 44, `${viewWidth}x${viewHeight}: card ${layout.card}px`);
    for (const row of layout.rows) {
      for (let index = 1; index < row.length; index += 1) {
        assert.ok(row[index].x - row[index - 1].x >= layout.card * .35, 'each rank corner stays uncovered');
      }
    }
  }
});

test('an empty or degenerate box yields an empty fan', () => {
  assert.deepEqual(holdFanLayout(0, 300, 300).rows, []);
  assert.deepEqual(holdFanLayout(5, 0, 300).rows, []);
});
