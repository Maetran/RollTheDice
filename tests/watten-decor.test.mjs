import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const translations = await import(url(catalog));
const unused = url("export const mountConsumable=()=>null, updateDrink=(art, level)=>art.onDrink?.(level), eatPiece=(art, remaining)=>art.onEat?.(remaining);");
const surprise = url('export const tableSurpriseArt=()=>"", playTableSurprise=()=>()=>{};');
const play = await readFile(new URL("../frontend/hausdepp/decor-play.js", import.meta.url), "utf8");
const shared = await readFile(new URL("../frontend/hausdepp/decor.js", import.meta.url), "utf8");
const sharedUrl = url(shared.replace('"./decor-consumables.js"', JSON.stringify(unused))
  .replace('"./decor-play.js"', JSON.stringify(url(play))).replace('"./surprise-effects.js"', JSON.stringify(surprise)));
const original = await readFile(new URL("../frontend/watten/decor.js", import.meta.url), "utf8");
const source = original.replace('"../hausdepp/decor-consumables.js"', JSON.stringify(unused))
  .replace('"../hausdepp/decor-play.js"', JSON.stringify(unused)).replace('"../i18n/catalog.js"', JSON.stringify(url(catalog)))
  .replace('"../hausdepp/surprise-effects.js"', JSON.stringify(surprise)).replace('"../hausdepp/decor.js"', JSON.stringify(sharedUrl));
const { createDecor, fitsDecor, findDecorPosition, fiveCardReserve, DECOR_ITEMS, DECOR_PROTECTED } = await import(url(source));
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

class Events {
  handlers = new Map();
  addEventListener(name, handler, options = {}) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
    options.signal?.addEventListener("abort", () => this.handlers.get(name).delete(handler), { once: true });
  }
  emit(name, event = {}) { for (const handler of [...this.handlers.get(name) || []]) handler(event); }
}
class Node extends Events {
  constructor(dom, bounds = rect(0, 0, 64, 64)) { super(); this.dom = dom; this.bounds = bounds; }
  hidden = false; disabled = false; connected = true; children = []; dataset = {}; attributes = {}; textContent = "";
  get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
  set isConnected(value) { this.connected = value; }
  className = ""; style = { setProperty(key, value) { this[key] = value; } }; captured = null;
  get classList() { return { contains: value => this.className.split(" ").includes(value),
    add: (...values) => { this.className = [...new Set([...this.className.split(" "), ...values])].join(" "); },
    remove: value => { this.className = this.className.split(" ").filter(name => name !== value).join(" "); } }; }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  get childElementCount() { return this.children.length; }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  get offsetLeft() { return this.getBoundingClientRect().left; }
  get offsetTop() { return this.getBoundingClientRect().top; }
  get parentElement() { return this.parent; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  toggleAttribute(key, force) { if (force) this.setAttribute(key, ""); else this.removeAttribute(key); }
  set innerHTML(value) {
    this.children = []; const stack = [this];
    for (const match of value.matchAll(/<(\/)?([\w-]+)([^>]*?)(\/?)>/g)) {
      if (match[1]) { if (stack.length > 1) stack.pop(); continue; }
      const node = new Node(this.dom); node.tagName = match[2];
      for (const attr of match[3].matchAll(/([\w-]+)="([^"]*)"/g)) {
        node.setAttribute(attr[1], attr[2]); if (attr[1] === "class") node.className = attr[2];
      }
      stack.at(-1).append(node); if (!match[4]) stack.push(node);
    }
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; node.isConnected = true; this.children.push(node); } }
  prepend(node) { node.parent = this; node.isConnected = true; this.children.unshift(node); }
  after(node) { this.parent.append(node); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  replaceChildren() { for (const node of this.children) node.isConnected = false; this.children = []; }
  focus() { this.dom.activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
  closest(selector) {
    if (selector === "[hidden]") return this.hidden ? this : this.parent?.closest(selector) || null;
    if (selector === "[data-watten-decor-layer]") return this.dataset.wattenDecorLayer ? this : this.parent?.closest(selector) || null;
    if (selector.includes("data-watten-decor-action") || selector.includes("data-watten-decor-add")) {
      return this.dataset.wattenDecorAction || this.dataset.wattenDecorAdd ? this : this.parent?.closest(selector) || null;
    }
    return null;
  }
  contains(node) { return node === this || Boolean(node?.parent && this.contains(node.parent)); }
  getClientRects() { return !this.isConnected || this.closest("[hidden]") ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left) || this.bounds.left;
    const top = Number.parseFloat(this.style.top) || this.bounds.top;
    // Browser DOMRect accessors are inherited rather than spreadable fields.
    const side = this.className.split(" ").includes("wt-decor-prop") ? this.dom.propSide : null;
    return Object.create(Object.fromEntries(Object.entries(rect(left, top, side || this.bounds.width, side || this.bounds.height))));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(matches(node, selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  setPointerCapture(pointer) { this.captured = pointer; }
  hasPointerCapture(pointer) { return this.captured === pointer; }
  releasePointerCapture() { this.captured = null; this.emit("lostpointercapture"); }
  animations = [];
  getAnimations({ subtree = false } = {}) { return [...this.animations, ...(subtree ? this.children.flatMap(node => node.getAnimations({ subtree })) : [])]; }
  animate() {
    let resolve;
    const animation = { finished: new Promise(done => { resolve = done; }), cancel() { resolve(); }, finish() { resolve(); } };
    this.animations.push(animation); return animation;
  }
}
function matches(node, selector) {
  if (selector.includes(",")) return selector.split(",").some(part => matches(node, part.trim()));
  if (selector.startsWith(".")) return node.className.split(" ").includes(selector.slice(1).split(":")[0]);
  if (/^[a-z]+$/.test(selector)) return node.tagName === selector;
  const action = selector.match(/data-watten-decor-action="([^"]+)"/);
  return action ? node.dataset.wattenDecorAction === action[1]
    : selector.includes("data-watten-decor-layer") ? Boolean(node.dataset.wattenDecorLayer) : false;
}
class Container extends Node {
  fields = new Map(); markup = "";
  set innerHTML(value) {
    this.markup = value; this.children = []; this.fields.clear();
    for (const field of ["status", "layer"]) {
      const node = new Node(this.dom, field === "corner" ? this.dom.corner : field === "layer" ? this.dom.viewport : rect(0, 400, 300, 44));
      node.hidden = field === "panel"; if (field === "layer") node.dataset.wattenDecorLayer = true;
      this.fields.set(`[data-watten-decor-${field}]`, node); this.append(node);
    }
    for (const match of value.matchAll(/data-watten-decor-(action|add)="([^"]+)"/g)) {
      const node = new Node(this.dom); node.dataset[match[1] === "action" ? "wattenDecorAction" : "wattenDecorAdd"] = match[2];
      this.fields.set(`[data-watten-decor-${match[1]}="${match[2]}"]`, node); this.append(node);
    }
  }
  get innerHTML() { return this.markup; }
  querySelector(selector) { return this.fields.get(selector) || super.querySelector(selector); }
  replaceChildren() { super.replaceChildren(); this.markup = ""; this.fields.clear(); }
  click(action, add = false) {
    const node = this.querySelector(`[data-watten-decor-${add ? "add" : "action"}="${action}"]`);
    assert.ok(node, action); this.emit("click", { target: node });
  }
}
const clients = new Set();
test.afterEach(() => { for (const client of clients) client.destroy(); clients.clear(); });
function fixture({ width = 800, height = 700, reducedMotion = false, language = "de", initialKinds = ["beer", "nuts", "dice"] } = {}) {
  const dom = new Events(); dom.hidden = false; dom.activeElement = null;
  dom.corner = rect(8, 500, width - 16, 248); dom.viewport = rect(0, 0, width, height);
  dom.createElement = tag => { const node = new Node(dom); node.tagName = tag; return node; };
  dom.createElementNS = (_namespace, tag) => dom.createElement(tag);
  dom.querySelector = () => null;
  const win = new Events(), reduced = new Events(); reduced.matches = reducedMotion;
  win.innerWidth = width; win.innerHeight = height;
  dom.propSide = width >= 900 && height >= 520 ? 88 : 56;
  win.getComputedStyle = node => ({ getPropertyValue: () => String(dom.propSide),
    visibility: node?.style.visibility || "visible", display: node?.style.display || "block" });
  win.matchMedia = () => reduced; win.visualViewport = new Events();
  win.intervals = new Set(); win.setInterval = callback => { win.intervals.add(callback); return callback; };
  win.clearInterval = callback => win.intervals.delete(callback);
  win.ZDWA_I18N = { t: value => language === "en" ? translations.EN[value] || value : value };
  globalThis.document = dom; globalThis.window = win; globalThis.matchMedia = win.matchMedia;
  const observers = [];
  win.ResizeObserver = win.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observations = [];
    observe(target, options) { this.observations.push({ target, options }); }
    disconnect() { this.disconnected = true; }
  };
  const container = new Container(dom), root = new Node(dom); root.append(container);
  const felt = new Node(dom, rect(0, 0, width, 260)), table = new Node(dom, rect(0, 0, width, 390));
  const hand = new Node(dom, rect(0, 270, width, 120)), view = new Node(dom), social = new Node(dom), leave = new Node(dom);
  const modal = new Node(dom, dom.viewport); modal.hidden = true;
  const protectedAreas = [new Node(dom, rect(width / 2 - 70, 80, 140, 100)), new Node(dom, rect(0, 400, width, 80))];
  root.querySelector = selector => selector.includes("data-watten-social-drawer") ? modal.hidden ? null : modal
    : ({ "[data-wt-table]": table, "[data-wt-felt]": felt, "[data-wt-hand-area]": hand,
      "[data-watten-view]": view, "[data-watten-social]": social, "[data-watten-leave-dialog]": leave })[selector] || null;
  root.querySelectorAll = () => protectedAreas;
  let current = true, account = 1;
  const servingCalls = [];
  const client = createDecor({ container, root, dom, win, initialKinds, escapeHtml, language: () => language,
    getExpectedAccountId: () => account, isCurrent: () => current,
    consumables: { mount: (art, kind) => {
      art.onDrink = level => servingCalls.push({ art, level }); art.onEat = remaining => servingCalls.push({ art, remaining });
      return { portions: DECOR_ITEMS[kind].food ? 3 : 0, keepsContainer: !kind.startsWith("loose-") && !kind.startsWith("praline-") };
    },
      drink: (art, level) => servingCalls.push({ art, level }), eat: (art, remaining) => servingCalls.push({ art, remaining }) } });
  clients.add(client);
  const props = () => container.querySelector("[data-watten-decor-layer]").children.filter(node => node.dataset.wattenDecorItem);
  return { client, root, container, view, win, dom, reduced, observers, protectedAreas, modal, servingCalls,
    update: publicPhase => client.update({ publicPhase }),
    props,
    resize(nextWidth, nextHeight) {
      win.innerWidth = nextWidth; win.innerHeight = nextHeight;
      dom.propSide = nextWidth >= 900 && nextHeight >= 520 ? 88 : 56;
      felt.bounds = rect(0, 0, nextWidth, 260); table.bounds = rect(0, 0, nextWidth, 390);
      protectedAreas[0].bounds = rect(nextWidth / 2 - 70, 80, 140, 100);
      win.emit("resize");
    },
    attributeChanged(target, attributeName) {
      for (const observer of observers) {
        if (observer.observations.some(({ target: observed, options }) => options?.attributes
          && (!options.attributeFilter || options.attributeFilter.includes(attributeName))
          && (observed === target || options.subtree && observed.contains(target)))) {
          observer.callback([{ type: "attributes", target, attributeName }]);
        }
      }
    },
    field: name => container.querySelector(`[data-watten-decor-${name}]`),
    changeAccount() { account = 2; }, invalidate() { current = false; } };
}

test("geometry protects the full five-card reserve and rejects action overlap at 320 portrait and 568 landscape", () => {
  for (const [width, height] of [[320, 640], [568, 320]]) {
    const region = { ...rect(0, 0, width, height), name: "table" };
    const reserve = fiveCardReserve(rect(0, height - 110, width, 110), region);
    const geometry = { regions: [region], protectedRects: [reserve, rect(60, 40, 140, 70)] };
    assert.equal(fitsDecor(rect(60, 40, 64, 64), geometry), false);
    assert.equal(fitsDecor(rect(10, height - 100, 64, 64), geometry), false);
    assert.equal(fitsDecor(rect(-1, 0, 64, 64), geometry), false);
    const position = findDecorPosition(geometry); assert.ok(position);
  }
  for (const selector of [".wt-seat", ".wt-hand-card", ".wt-trick-card", "data-watten-inspection", "data-watten-bid", "data-watten-paused",
    "data-watten-match-result", "data-watten-social", ".wt-bubble", "data-wt-panel", "button", "input"]) assert.ok(DECOR_PROTECTED.includes(selector));
});

test("random table props remain local and no palette or context menu is mounted", () => {
  const f = fixture(); f.update("preview"); assert.equal(f.props().length, 0);
  f.update("play"); assert.equal(f.props().length, 3);
  assert.doesNotMatch(f.container.markup, /data-watten-decor-(panel|corner|add|action)/);
  const node = f.props()[0]; let prevented = false;
  node.emit("contextmenu", { preventDefault() { prevented = true; } });
  assert.equal(prevented, false); assert.equal(f.props().length, 3);
  assert.doesNotMatch(original, /fetch\(|WebSocket|sendRaw|localStorage|sessionStorage|\.engine|\.hand\b/);
});

test("stable table updates preserve nodes, servings and positions without a decoration menu", () => {
  const f = fixture(); f.update("play");
  const node = f.props()[0], before = [node.style.left, node.style.top];
  node.emit("click"); assert.equal(f.servingCalls.at(-1).level, 3);
  f.update("play"); f.update("play"); assert.equal(f.props()[0], node);
  assert.deepEqual([node.style.left, node.style.top], before);
  assert.doesNotMatch(f.container.markup, /wt-decor-toolbar|data-watten-decor-panel/);
});

test("automatic props leave the actual rest packet and its rotated card corners clear", () => {
  const f = fixture();
  const stock = new Node(f.dom, rect(89, 32, 24, 38));
  const paintedCorner = new Node(f.dom, rect(84, 28, 34, 46));
  const protectedNodes = f.root.querySelectorAll;
  f.root.querySelectorAll = selector => [...protectedNodes(selector),
    ...(selector.includes(".wt-stock") ? [stock] : []), ...(selector.includes(".wt-stock > i") ? [paintedCorner] : [])];
  f.update("play");
  const geometry = { regions: [{ ...rect(0, 0, 800, 260), name: "table" }], protectedRects: [stock.bounds, paintedCorner.bounds] };
  assert.ok(f.props().some(node => !node.hidden));
  for (const node of f.props().filter(node => !node.hidden)) assert.equal(fitsDecor(node.getBoundingClientRect(), geometry), true);
});

test("desktop props grow with their protected footprint and reposition safely on a phone resize", () => {
  const f = fixture({ width: 1280, height: 800 }); f.update("play");
  for (const [width, height, side] of [[1280, 800, 88], [320, 640, 56], [1280, 800, 88]]) {
    f.resize(width, height);
    const geometry = { regions: [{ ...rect(0, 0, width, 260), name: "table" }],
      protectedRects: f.protectedAreas.map(item => item.getBoundingClientRect()) }, occupied = [];
    const shown = f.props().filter(node => !node.hidden); assert.ok(shown.length);
    for (const node of shown) {
      const area = node.getBoundingClientRect(); assert.equal(area.width, side);
      assert.ok(fitsDecor(area, geometry, occupied)); occupied.push(area);
    }
  }
});

test("keyboard menu gestures do not open a decoration panel", () => {
  const f = fixture(); f.update("play"); const node = f.props()[0];
  node.emit("keydown", { key: "F10", shiftKey: true, preventDefault() {} });
  assert.equal(f.field("panel"), null);
});

test("drag never paints across a protected action and interrupted capture returns to its original valid spot", () => {
  const f = fixture(); f.update("play");
  const node = f.props()[0], initial = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 7, clientX: initial.left, clientY: initial.top });
  node.emit("pointermove", { pointerId: 7, clientX: 1000, clientY: 1000 });
  assert.equal(node.style.left, `${initial.left}px`); assert.equal(node.style.top, `${initial.top}px`);
  const action = f.protectedAreas[0].getBoundingClientRect();
  node.emit("pointermove", { pointerId: 7, clientX: action.left, clientY: action.top });
  assert.equal(node.style.left, `${initial.left}px`); assert.equal(node.style.top, `${initial.top}px`);
  node.emit("pointermove", { pointerId: 7, clientX: initial.left + 16, clientY: initial.top });
  node.emit("pointercancel"); assert.equal(node.captured, null);
  assert.equal(node.style.left, `${initial.left}px`); assert.equal(node.style.top, `${initial.top}px`);
  node.emit("pointerdown", { button: 0, pointerId: 8, clientX: initial.left, clientY: initial.top });
  f.win.emit("orientationchange"); assert.equal(node.captured, null);
});

test("keyboard movement, direct consumption and removal remain available", () => {
  const f = fixture({ language: "en" }); f.update("play");
  const food = f.props().find(node => node.dataset.wattenDecorKind === "nuts"), initial = food.style.left;
  food.emit("keydown", { key: "ArrowRight", preventDefault() {} }); assert.notEqual(food.style.left, initial);
  food.emit("click"); assert.equal(f.servingCalls.at(-1).remaining, 2);
  food.emit("keydown", { key: "Delete", preventDefault() {} }); assert.equal(f.props().length, 2);
  assert.ok([...food.handlers.values()].every(handlers => handlers.size === 0));
  f.props().find(node => node.dataset.wattenDecorKind === "beer").emit("click");
  assert.equal(f.servingCalls.at(-1).level, 3);
});

test("a fresh intentional tap is not swallowed when a previous drag produced no compatibility click", () => {
  const f = fixture(); f.update("play");
  const node = f.props().find(item => item.dataset.wattenDecorKind === "dice"), initial = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 1, clientX: initial.left, clientY: initial.top });
  node.emit("pointermove", { pointerId: 1, clientX: initial.left + 16, clientY: initial.top });
  node.emit("pointerup", { pointerId: 1 });
  assert.equal(node.hidden, false); assert.equal(f.field("panel"), null);
  const area = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 2, clientX: area.left, clientY: area.top });
  node.emit("pointerup", { pointerId: 2 });
  node.emit("click");
  assert.equal(f.field("panel"), null);
  assert.match(node.children[1].textContent, /^[1-6]$/);
});



test("reduced motion keeps direct object use and refills an empty glass", () => {
  const f = fixture({ reducedMotion: true }); f.update("play");
  const node = f.props().find(node => node.dataset.wattenDecorKind === "beer");
  for (let i = 0; i < 8; i += 1) node.emit("click");
  assert.equal(f.servingCalls.at(-1).level, 1);
  assert.equal(f.field("layer").children.length, 3);
});

test("all ordinary Hausdepp props are available while automatic tables keep three stable items", () => {
  const expected = ["beer", "can", "nuts", "marend", "dice", "tea", "chips", "flips", "pretzel", "sweets", "lantern", "lemonade",
    "cap", "opener", "praline-gold", "praline-red", "die", "loose-nuts", "loose-chips", "loose-flips", "coin", "coaster", "pencil"];
  assert.deepEqual(Object.keys(DECOR_ITEMS).sort(), expected.sort());
  const f = fixture({ initialKinds: null }); f.update("play");
  assert.equal(f.props().length, 3); assert.equal(f.props()[0].dataset.wattenDecorKind, "beer");
  const kinds = f.props().map(node => node.dataset.wattenDecorKind);
  f.update("strike"); f.update("play"); assert.deepEqual(f.props().map(node => node.dataset.wattenDecorKind), kinds);
});

test("calm sips empty and refill the same glass; rapid taps spill, tip and deliberately stand it up", async () => {
  const originalNow = Date.now; let now = 5000; Date.now = () => now;
  const finish = async node => {
    for (const animation of node.getAnimations({ subtree: true })) animation.finish();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  };
  try {
    const f = fixture(); f.update("play"); const beer = f.props()[0];
    for (let sip = 0; sip < 4; sip++) { beer.emit("click"); await finish(beer); now += 3000; }
    assert.equal(beer.dataset.level, "0"); assert.equal(beer.getAttribute("aria-label"), "Nachschenken");
    beer.emit("click"); assert.equal(beer.dataset.level, "4"); assert.equal(beer.dataset.lastMotion, "glass-refill"); await finish(beer);
    now += 3000;
    for (let tap = 0; tap < 6; tap++) { beer.emit("click"); now += 30; }
    assert.equal(beer.dataset.level, "0"); assert.equal(beer.dataset.fallen, "true"); assert.equal(beer.dataset.lastMotion, "glass-fall");
    const spill = f.field("layer").querySelector(".hd-prop-spill"); assert.ok(spill);
    const cloth = spill.querySelector("button");
    for (let wipe = 0; wipe < 4; wipe++) cloth.emit("click", { preventDefault() {}, stopPropagation() {} });
    assert.equal(spill.isConnected, false);
    await finish(beer); now += 1500; beer.emit("click");
    assert.equal(beer.dataset.fallen, "false"); assert.equal(beer.dataset.level, "0"); assert.equal(beer.dataset.lastMotion, "glass-stand");
    await finish(beer); now += 3000; beer.emit("click"); assert.equal(beer.dataset.level, "4");
  } finally { Date.now = originalNow; }
});

test("can taps open it, deliberate shaking bursts it, and lantern shaking relights only while current", () => {
  const f = fixture({ initialKinds: ["beer", "can", "lantern"] }); f.update("play");
  const can = f.props()[1], lantern = f.props()[2];
  for (let tap = 0; tap < 3; tap++) can.emit("click");
  assert.equal(can.dataset.canState, "open"); assert.equal(can.dataset.foaming, "true");
  const shake = node => {
    const area = node.getBoundingClientRect();
    node.emit("pointerdown", { button: 0, pointerId: 1, clientX: area.left, clientY: area.top });
    for (const delta of [35, -35, 35, -35, 35]) node.emit("pointermove", { pointerId: 1, clientX: area.left + delta, clientY: area.top });
    node.emit("pointerup", { pointerId: 1 });
  };
  shake(can); assert.equal(can.dataset.canState, "burst"); assert.equal(can.dataset.lastGesture, "shake");
  lantern.emit("click"); assert.equal(lantern.dataset.lit, "false");
  f.win.emit("resize"); lantern.emit("click"); assert.equal(lantern.dataset.lit, "true");
  shake(lantern); assert.equal(lantern.dataset.lit, "false"); assert.equal(lantern.dataset.relighting, "true");
  f.changeAccount(); f.update("play"); assert.equal(lantern.dataset.relighting, "false"); assert.equal(lantern.isConnected, false);
});

test("coin/die results and coaster/pencil tallies use the same local prop interactions", () => {
  const f = fixture({ initialKinds: ["coin", "die", "coaster", "pencil"], reducedMotion: true }); f.update("play");
  const [coin, die, coaster, pencil] = f.props();
  coin.emit("click"); assert.ok(["heads", "tails"].includes(coin.dataset.face));
  die.emit("click"); assert.match(die.dataset.value, /^[1-6]$/);
  coaster.emit("click"); pencil.emit("click"); assert.equal(coaster.dataset.tally, "2");
  for (let mark = 0; mark < 19; mark++) coaster.emit("click");
  assert.equal(coaster.dataset.tally, "0");
});

test("a shaken lantern relights while active and cancels its relight on suspension", () => {
  const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map(); let serial = 0;
  globalThis.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  try {
    const f = fixture({ initialKinds: ["lantern"] }); f.update("play"); const lantern = f.props()[0];
    const shake = () => {
      const area = lantern.getBoundingClientRect();
      lantern.emit("pointerdown", { button: 0, pointerId: 3, clientX: area.left, clientY: area.top });
      for (const delta of [35, -35, 35, -35, 35]) lantern.emit("pointermove", { pointerId: 3, clientX: area.left + delta, clientY: area.top });
      lantern.emit("pointerup", { pointerId: 3 });
    };
    shake(); assert.equal(lantern.dataset.lit, "false");
    const [relightId, relight] = [...timers].find(([, timer]) => timer.delay === 2800); assert.ok(relight);
    timers.delete(relightId); relight.callback();
    assert.equal(lantern.dataset.lit, "true"); assert.equal(lantern.dataset.lastMotion, "candle-relight");
    shake(); assert.equal(lantern.dataset.lit, "false"); f.client.suspend();
    assert.equal(lantern.dataset.relighting, "false");
    assert.equal([...timers.values()].filter(timer => timer.delay === 2800).length, 0);
    f.client.destroy();
  } finally { globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
});

test("beer foam settles without changing its serving and dragging leaves a bounded local glass ring", () => {
  const originalNow = Date.now; let now = 5000; Date.now = () => now;
  try {
    const f = fixture(); f.update("play"); const beer = f.props()[0];
    now += 151000; for (const callback of f.win.intervals) callback();
    assert.equal(beer.dataset.foam, "flat"); assert.equal(beer.dataset.level, "4");
    const area = beer.getBoundingClientRect();
    beer.emit("pointerdown", { button: 0, pointerId: 4, clientX: area.left, clientY: area.top });
    beer.emit("pointermove", { pointerId: 4, clientX: area.left + 20, clientY: area.top });
    beer.emit("pointerup", { pointerId: 4 });
    assert.ok(f.field("layer").querySelector(".hd-prop-glass-ring"));
    f.client.destroy(); assert.equal(f.win.intervals.size, 0);
  } finally { Date.now = originalNow; }
});

test("eaten loose snacks disappear; empty dishes remain draggable without resetting on update", () => {
  const f = fixture({ initialKinds: ["nuts", "loose-chips"], reducedMotion: true }); f.update("play");
  const [bowl, loose] = f.props();
  for (let bite = 0; bite < 3; bite++) { bowl.emit("click"); loose.emit("click"); }
  assert.equal(bowl.dataset.empty, "true"); assert.equal(bowl.hidden, false); assert.equal(loose.hidden, true);
  f.update("colour"); assert.equal(bowl.dataset.empty, "true"); assert.equal(loose.hidden, true);
  const before = bowl.style.left; bowl.emit("keydown", { key: "ArrowRight", preventDefault() {} }); assert.notEqual(bowl.style.left, before);
});

test("Escape ends capture directly without focusing a hidden menu control", () => {
  const f = fixture(); f.update("play");
  const node = f.props()[0], area = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 1, clientX: area.left, clientY: area.top });
  node.emit("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(node.captured, null); assert.equal(f.field("panel"), null);
});

test("social/dialog protection immediately hides decoration; phase controls cannot become decoration targets", () => {
  const f = fixture(); f.update("play");
  const node = f.props()[0]; assert.equal(node.hidden, false);
  f.modal.hidden = false; f.observers[1].callback(); assert.equal(node.hidden, true);
  f.modal.hidden = true; f.observers[1].callback(); assert.equal(node.hidden, false);
  for (const phase of ["strike", "colour", "show_ready", "inspection", "bid_response", "paused", "deal_complete", "match_complete"]) {
    f.update(phase); const area = node.getBoundingClientRect();
    if (phase === "paused") assert.equal(node.hidden, true);
    else assert.ok(fitsDecor(area, { regions: [{ ...rect(0, 0, 800, 260), name: "table" }],
      protectedRects: f.protectedAreas.map(item => item.getBoundingClientRect()) }));
  }
});

test("opening last-trick details reflows phone props outside the expanded history without a game rerender", () => {
  const f = fixture({ width: 320, height: 568 }); f.update("play");
  const shown = f.props().filter(node => !node.hidden); assert.ok(shown.length);
  const before = shown.map(node => [node.style.left, node.style.top]);
  const history = new Node(f.dom, rect(0, 0, 320, 120)); f.view.append(history);
  f.protectedAreas.push(history); history.setAttribute("open", "");
  f.attributeChanged(history, "open");
  assert.ok(shown.some((node, index) => node.hidden || node.style.left !== before[index][0] || node.style.top !== before[index][1]));
  const geometry = { regions: [{ ...rect(0, 0, 320, 260), name: "table" }],
    protectedRects: f.protectedAreas.map(node => node.getBoundingClientRect()) };
  for (const node of f.props().filter(item => !item.hidden)) assert.ok(fitsDecor(node.getBoundingClientRect(), geometry));
  history.hidden = true; f.attributeChanged(history, "hidden");
  assert.ok(f.props().some(node => !node.hidden));
});

test("a harmless accepted table repaint keeps a valid decoration drag captured", () => {
  const f = fixture({ width: 1180, height: 820 }); f.update("play");
  const node = f.props()[0], area = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 7, clientX: area.left, clientY: area.top });
  assert.equal(node.captured, 7);
  const back = new Node(f.dom); f.view.append(back);
  // renderSeats reassigns hidden on the accepted backs, including unchanged
  // values. Such a mutation is not an orientation change or lost pointer.
  f.attributeChanged(back, "hidden");
  assert.equal(node.captured, 7, "unrelated native repaint must not release pointer capture");
  f.update("play");
  assert.equal(node.captured, 7, "same-phase accepted snapshots preserve a valid drag too");
  f.modal.hidden = false; f.observers[1].callback();
  assert.equal(node.captured, null, "a real blocking surface still cancels capture immediately");
  assert.equal(node.hidden, true);
});

test("a same-phase accepted obstacle releases capture and reflows the prop away from the new control", () => {
  const f = fixture({ width: 1180, height: 820 }); f.update("play");
  const node = f.props()[0], area = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 9, clientX: area.left, clientY: area.top });
  f.protectedAreas.push(new Node(f.dom, area));
  f.update("play");
  assert.equal(node.captured, null);
  const moved = node.getBoundingClientRect();
  assert.ok(node.hidden || moved.right <= area.left || moved.left >= area.right
    || moved.bottom <= area.top || moved.top >= area.bottom);
});

test("an unpainted inspection slot does not become a phantom drag blocker", () => {
  const f = fixture(); f.update("play");
  const node = f.props()[0], area = node.getBoundingClientRect();
  const unplaced = new Node(f.dom, area); unplaced.style.visibility = "hidden";
  f.protectedAreas.push(unplaced);
  node.emit("pointerdown", { button: 0, pointerId: 3, clientX: area.left, clientY: area.top });
  f.update("play");
  assert.equal(node.captured, 3);
  unplaced.style.visibility = "visible";
  f.attributeChanged(unplaced, "hidden");
  f.update("play");
  assert.equal(node.captured, null);
});

test("a reveal mounted after the decoration controller still protects its asynchronously placed cards", () => {
  const f = fixture(); f.update("play");
  const node = f.props()[0], area = node.getBoundingClientRect(), reveal = new Node(f.dom, area);
  const originalQuery = f.root.querySelectorAll;
  f.root.querySelectorAll = selector => selector === "[data-wt-reveal], [data-wt-bloedeln]" ? [reveal] : originalQuery(selector);
  f.update("play");
  assert.ok(f.observers[1].observations.some(item => item.target === reveal));
  node.emit("pointerdown", { button: 0, pointerId: 6, clientX: area.left, clientY: area.top });
  f.protectedAreas.push(reveal);
  f.attributeChanged(reveal, "style");
  assert.equal(node.captured, null, "freshly positioned showing still wins over the captured prop");
});

test("destroy/account switch/pagehide end captures and remove every item, effect and listener", () => {
  for (const finish of [f => f.client.destroy(), f => { f.changeAccount(); f.update("play"); }, f => f.win.emit("pagehide")]) {
    const f = fixture(); f.update("play");
    const node = f.props()[0], area = node.getBoundingClientRect();
    node.emit("pointerdown", { button: 0, pointerId: 1, clientX: area.left, clientY: area.top });
    finish(f); assert.equal(node.captured, null); assert.equal(node.isConnected, false);
    assert.ok([...node.handlers.values()].every(handlers => handlers.size === 0));
    if (f.container.hidden) assert.ok(f.observers.every(observer => observer.disconnected));
  }
});

test("bilingual catalog, protected stable shell and shared Hausdepp serving/interaction assets are wired", async () => {
  const values = await import(url(catalog));
  assert.deepEqual(Object.keys(values.WATTEN_DECOR_MESSAGES.de).sort(), Object.keys(values.WATTEN_DECOR_MESSAGES.en).sort());
  for (const item of Object.values(DECOR_ITEMS)) assert.ok(values.EN[item.label], `Missing English prop action: ${item.label}`);
  const game = await readFile(new URL("../frontend/watten/game.js", import.meta.url), "utf8");
  assert.match(game, /data-watten-view><\/div>\s*<div data-watten-social hidden><\/div>\s*<div data-watten-decor hidden>/);
  assert.match(game, /decor\?\.update\(\{ publicPhase:/); assert.match(game, /decor\?\.suspend\(\)/);
  const css = await readFile(new URL("../frontend/styles/watten-game.css", import.meta.url), "utf8");
  assert.match(css, /hausdepp-decor-consumables\.css/); assert.match(css, /hausdepp-decor-play\.css/);
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /wt-decor-layer[^}]*pointer-events: none/);
  assert.match(original, /hausdepp-table-props/); assert.match(original, /mountConsumable/);
  assert.match(original, /createLocalTablePropInteractions/); assert.doesNotMatch(original, /data-watten-decor-panel/);
});
