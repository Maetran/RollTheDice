import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Exercise the real aggregate/DOM pipeline without a canvas renderer. The map
// coordinates are a fixed country reference, not visitor location data.
const source = (await readFile(new URL("../frontend/dashboard/globe.js", import.meta.url), "utf8"))
  .replace('import world from "./world-map.json";', 'const world = { land: [], centers: { CH: [8.2, 46.8] } };');
const { createGlobe } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

class Element {
  children = []; dataset = {}; hidden = false; className = ""; text = "";
  classList = { add() {}, remove() {} }; style = { setProperty() {} };
  constructor(doc) { this.ownerDocument = doc; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.text = ""; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener() {}
  getContext() { return null; }
  getBoundingClientRect() { return { width: 0, height: 0 }; }
}

function fixture() {
  const doc = { body: { dataset: {} }, documentElement: { dataset: {} }, hidden: false, addEventListener() {} };
  doc.defaultView = { AbortController, addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
  doc.createElement = () => new Element(doc);
  doc.createDocumentFragment = () => new Element(doc);
  const element = new Element(doc);
  const globe = createGlobe(element, { number: value => String(value), countryName: code => code });
  const find = (node, className) => node.className.split(" ").includes(className) ? node
    : node.children.map(child => find(child, className)).find(Boolean);
  return { globe, element, find: className => find(element, className) };
}

test("country details show only reported known games, including native values and a real zero", () => {
  const { globe, find } = fixture();
  try {
    globe.update([{ country: "CH", sessions: 9, games: { zdwa: 5, zilch: 4, hausdepp: 2, watten: 0, private_game: 123 } }]);
    const games = find("geo-game-values");
    assert.deepEqual(games.children.map(cell => cell.dataset.game), ["zdwa", "zilch", "hausdepp", "watten"]);
    assert.deepEqual(games.children.map(cell => cell.textContent), ["ZDWA5", "Zilch4", "Hausdepp2", "Watten0"]);
    assert.equal(games.hidden, false);
    assert.equal(find("geo-game-note").hidden, false);
    assert.match(find("geo-game-note").textContent, /mehrere Spiele/);
    assert.ok(!games.textContent.includes("private_game") && !games.textContent.includes("123"));
  } finally { globe.destroy(); }
});

test("filter and access updates remove old native DOM cells rather than retaining or inventing counts", () => {
  const { globe, find } = fixture();
  try {
    const update = games => globe.update([{ country: "CH", sessions: 7, games }]);
    update({ zdwa: 5, zilch: 4, hausdepp: 2, watten: 3 });
    update({ watten: 6 });
    assert.deepEqual(find("geo-game-values").children.map(cell => cell.textContent), ["Watten6"]);
    assert.equal(find("geo-game-note").hidden, true, "a single reported product needs no overlap note");
    update({ zdwa: 7, zilch: 0 });
    assert.deepEqual(find("geo-game-values").children.map(cell => cell.dataset.game), ["zdwa", "zilch"]);
    assert.ok(!find("geo-game-values").textContent.includes("Watten") && !find("geo-game-values").textContent.includes("Hausdepp"));
    update({ hausdepp: null, watten: 8 });
    assert.deepEqual(find("geo-game-values").children.map(cell => cell.textContent), ["Hausdepp—", "Watten8"], "explicit unknown stays unknown");
    update({ private_game: 123 });
    assert.deepEqual(find("geo-game-values").children, []);
    assert.equal(find("geo-game-values").hidden, true);
    assert.equal(find("geo-game-note").hidden, true);
    update({ watten: 8 });
    globe.clear();
    assert.deepEqual(find("geo-game-values").children, [], "clearing private output removes values and labels");
    assert.equal(find("geo-detail").hidden, true);
  } finally { globe.destroy(); }
});
