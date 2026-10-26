import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/hausdepp/card-scorch.js", import.meta.url), "utf8");
const { cardScorchStyle, copyCardScorch, captureCardScorch } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("all visible faces get distinct stable paper patterns independent of render order", () => {
  const cards = ["hearts", "bells", "leaves", "acorns"].flatMap(suit => ["6", "7", "8", "9", "10", "U", "O", "K", "A"].map(rank => `${suit}-${rank}`));
  const styles = cards.map(cardScorchStyle);
  assert.equal(new Set(styles).size, 36);
  assert.deepEqual([...cards].reverse().map(cardScorchStyle).reverse(), styles);
  for (const style of styles) assert.match(style, /^(?:--hd-scorch-[\w-]+:\d+%?;)+$/);
  assert.equal(cardScorchStyle('hearts-7'), cardScorchStyle('hearts-7'));
});

test("a detached anonymous back copies only visible paper variables and active appearance", () => {
  const copied = new Map(), classes = new Map();
  const source = { closest: selector => selector.includes("hd-cards-scorched") ? {} : null,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: property =>
      property === "--hd-scorch-left-y" ? "28%" : "" }) } } };
  const target = { classList: { toggle: (key, active) => classes.set(key, active) },
    style: { setProperty: (key, value) => copied.set(key, value) } };
  copyCardScorch(target, { source });
  assert.equal(classes.get("hd-card-scorched"), true);
  assert.equal(copied.get("--hd-scorch-left-y"), "28%");
  assert.equal(copied.get("--hd-scorch-left-size"), "12%", "defaults prevent a detached back inheriting its new sibling slot");
  const appearance = captureCardScorch(source);
  const detached = { ...source, closest: () => null, ownerDocument: null };
  copyCardScorch(target, { source: detached, appearance });
  assert.equal(classes.get("hd-card-scorched"), true, "collection keeps public paper after its source was removed");
  assert.equal(copied.get("--hd-scorch-left-y"), "28%");
  copyCardScorch(target, { source: { ...source, closest: () => null } });
  assert.equal(classes.get("hd-card-scorched"), false);
});
