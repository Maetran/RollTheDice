import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const unused = url("export const mountConsumable=()=>null, updateDrink=()=>{}, eatPiece=()=>{}, clearTableEffects=()=>{}, wipeSpill=()=>null;");
const original = await readFile(new URL("../frontend/watten/decor.js", import.meta.url), "utf8");
const source = original.replace('"../hausdepp/decor-consumables.js"', JSON.stringify(unused))
  .replace('"../hausdepp/decor-play.js"', JSON.stringify(unused)).replace('"../i18n/catalog.js"', JSON.stringify(url(catalog)));
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
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { for (const node of nodes) { node.parent = this; node.isConnected = true; this.children.push(node); } }
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
  getClientRects() { return this.closest("[hidden]") ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left) || this.bounds.left;
    const top = Number.parseFloat(this.style.top) || this.bounds.top;
    // Browser DOMRect accessors are inherited rather than spreadable fields.
    return Object.create(Object.fromEntries(Object.entries(rect(left, top, this.bounds.width, this.bounds.height))));
  }
  querySelector(selector) { return this.children.find(node => matches(node, selector)) || this.children.map(node => node.querySelector(selector)).find(Boolean) || null; }
  setPointerCapture(pointer) { this.captured = pointer; }
  hasPointerCapture(pointer) { return this.captured === pointer; }
  releasePointerCapture() { this.captured = null; this.emit("lostpointercapture"); }
  getAnimations() { return []; }
}
function matches(node, selector) {
  const action = selector.match(/data-watten-decor-action="([^"]+)"/);
  return action ? node.dataset.wattenDecorAction === action[1]
    : selector.includes("data-watten-decor-layer") ? Boolean(node.dataset.wattenDecorLayer) : false;
}
class Container extends Node {
  fields = new Map(); markup = "";
  set innerHTML(value) {
    this.markup = value; this.children = []; this.fields.clear();
    for (const field of ["panel", "corner", "status", "layer"]) {
      const node = new Node(this.dom, field === "corner" ? this.dom.corner : field === "layer" ? this.dom.viewport : rect(0, 400, 300, 44));
      node.hidden = field === "panel"; if (field === "layer") node.dataset.wattenDecorLayer = true;
      this.fields.set(`[data-watten-decor-${field}]`, node); this.append(node);
    }
    this.querySelector("[data-watten-decor-panel]").append(this.querySelector("[data-watten-decor-corner]"));
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
function fixture({ width = 800, height = 700, reducedMotion = false, language = "de" } = {}) {
  const dom = new Events(); dom.hidden = false; dom.activeElement = null;
  dom.corner = rect(8, 500, width - 16, 248); dom.viewport = rect(0, 0, width, height);
  dom.createElement = () => new Node(dom);
  const win = new Events(), reduced = new Events(); reduced.matches = reducedMotion;
  win.innerWidth = width; win.innerHeight = height;
  win.matchMedia = () => reduced; win.visualViewport = new Events();
  const observers = [];
  win.ResizeObserver = win.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
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
  const servingCalls = [], spillCalls = [];
  const client = createDecor({ container, root, dom, win, escapeHtml, language: () => language,
    getExpectedAccountId: () => account, isCurrent: () => current,
    consumables: { mount: (_art, kind) => ({ portions: DECOR_ITEMS[kind].food ? 3 : 0 }),
      drink: (art, level) => servingCalls.push({ art, level }), eat: (art, remaining) => servingCalls.push({ art, remaining }) },
    spills: { clear: state => { for (const effect of [...state.effects]) effect._finish(); },
      create: (_table, state, node, color, amount, fits) => {
        const area = node.getBoundingClientRect(), footprint = rect(area.left, area.top, 44, 44);
        spillCalls.push({ color, amount, fits }); if (!fits(footprint)) return null;
        const effect = new Node(dom, footprint); effect._finish = () => { effect.remove(); state.effects.delete(effect); };
        state.layer.append(effect); state.effects.add(effect); return effect;
      } } });
  clients.add(client);
  return { client, root, container, win, dom, reduced, observers, protectedAreas, modal, servingCalls, spillCalls,
    update: publicPhase => client.update({ publicPhase }),
    props: () => container.querySelector("[data-watten-decor-layer]").children.filter(node => node.dataset.wattenDecorItem),
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
  for (const selector of [".wt-seat", "data-wt-hand", "data-wt-trick", "data-watten-inspection", "data-watten-bid", "data-watten-paused",
    "data-watten-match-result", "data-watten-social", ".wt-bubble", "data-wt-panel", "button", "input"]) assert.ok(DECOR_PROTECTED.includes(selector));
});

test("explicit palette fits eight items in the phone corner, caps count and never creates a game command", () => {
  for (const width of [320, 568]) {
    const f = fixture({ width }); f.update("preview");
    assert.equal(f.props().length, 0); f.container.click("beer", true); assert.equal(f.props().length, 0);
    f.container.click("toggle");
    for (const kind of Object.keys(DECOR_ITEMS)) f.container.click(kind, true);
    assert.equal(f.props().length, 8); assert.ok(f.props().every(node => !node.hidden));
    assert.equal(f.field("corner").scrolled, true);
    const geometry = { regions: [{ ...f.dom.corner, name: "corner" }], protectedRects: [] }, used = [];
    for (const node of f.props()) { const area = node.getBoundingClientRect(); assert.ok(fitsDecor(area, geometry, used)); used.push(area); }
    f.container.click("beer", true); assert.equal(f.props().length, 8); assert.match(f.field("status").textContent, /8/);
  }
  assert.doesNotMatch(original, /fetch\(|WebSocket|sendRaw|localStorage|sessionStorage|\.engine|\.hand\b/);
});

test("stable layout and corner close/reopen preserve nodes, servings and positions", () => {
  const f = fixture(); f.container.click("toggle"); f.container.click("tea", true);
  const node = f.props()[0], before = [node.style.left, node.style.top];
  f.update("preview"); f.update("preview"); assert.equal(f.props()[0], node);
  assert.deepEqual([node.style.left, node.style.top], before);
  f.container.click("close"); assert.equal(node.hidden, true);
  assert.equal(f.dom.activeElement, f.container.querySelector('[data-watten-decor-action="toggle"]'));
  f.container.click("toggle"); assert.equal(node.hidden, false);
  assert.deepEqual([node.style.left, node.style.top], before);
});

test("drag never paints across a protected action and interrupted capture returns to its original valid spot", () => {
  const f = fixture(); f.container.click("toggle"); f.update("play"); f.container.click("beer", true);
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

test("keyboard movement, rotation, consumption, refill and removal keep their local controls", () => {
  const f = fixture({ language: "en" }); f.container.click("toggle"); f.container.click("chips", true);
  const food = f.props()[0], initial = food.style.left;
  food.emit("keydown", { key: "ArrowRight", preventDefault() {} }); assert.notEqual(food.style.left, initial);
  f.container.click("use"); assert.equal(f.servingCalls.at(-1).remaining, 2);
  f.container.click("refill"); assert.equal(f.servingCalls.at(-1).remaining, 3);
  f.container.click("rotate"); assert.equal(food.children[0].style.rotate, "15deg");
  food.emit("keydown", { key: "Delete", preventDefault() {} }); assert.equal(f.props().length, 0);
  assert.ok([...food.handlers.values()].every(handlers => handlers.size === 0));
  f.container.click("beer", true); f.container.click("use"); assert.equal(f.servingCalls.at(-1).level, 3);
  f.container.click("refill"); assert.equal(f.servingCalls.at(-1).level, 4);
});

test("a fresh intentional tap is not swallowed when a previous drag produced no compatibility click", () => {
  const f = fixture(); f.update("play"); f.container.click("toggle"); f.container.click("dice", true);
  const node = f.props()[0], initial = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 1, clientX: initial.left, clientY: initial.top });
  node.emit("pointermove", { pointerId: 1, clientX: initial.left + 16, clientY: initial.top });
  node.emit("pointerup", { pointerId: 1 });
  f.container.click("close");
  assert.equal(node.hidden, false); assert.equal(f.field("panel").hidden, true);
  const area = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 2, clientX: area.left, clientY: area.top });
  node.emit("pointerup", { pointerId: 2 });
  node.emit("click");
  assert.equal(f.field("panel").hidden, false);
});

test("existing spill helper receives the same safety guard; close and fresh protected phases remove effects", () => {
  const f = fixture(); f.container.click("toggle"); f.container.click("beer", true); f.container.click("spill");
  assert.equal(f.spillCalls.length, 1);
  assert.equal(f.spillCalls[0].fits(f.protectedAreas[0].getBoundingClientRect()), false);
  assert.equal(f.servingCalls.at(-1).level, 0);
  assert.equal(f.field("layer").children.length, 2);
  f.container.click("close"); assert.equal(f.field("layer").children.length, 1);
  f.container.click("toggle"); f.container.click("refill"); f.container.click("spill");
  f.update("inspection"); assert.equal(f.field("layer").children.length, 1);
});

test("reduced motion retains static spill/wipe and manual object use without animations", () => {
  const f = fixture({ reducedMotion: true }); f.container.click("toggle"); f.container.click("tea", true);
  f.container.click("spill"); assert.equal(f.spillCalls.length, 0);
  const patch = f.field("layer").children.find(node => node.className === "wt-decor-static-spill"); assert.ok(patch);
  patch.emit("click"); assert.equal(patch.isConnected, false);
  f.container.click("refill"); f.container.click("use"); assert.equal(f.servingCalls.at(-1).level, 3);
});

test("repeated reduced-motion spills stay bounded and Escape ends capture and restores focus", () => {
  const f = fixture({ reducedMotion: true }); f.container.click("toggle"); f.container.click("tea", true);
  for (let index = 0; index < 8; index += 1) { f.container.click("refill"); f.container.click("spill"); }
  assert.equal(f.field("layer").children.length, 2); // one selected prop and one replaceable spill
  const node = f.props()[0], area = node.getBoundingClientRect();
  node.emit("pointerdown", { button: 0, pointerId: 1, clientX: area.left, clientY: area.top });
  f.container.emit("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(node.captured, null); assert.equal(f.field("layer").children.length, 1);
  assert.equal(f.dom.activeElement, f.container.querySelector('[data-watten-decor-action="toggle"]'));
});

test("social/dialog protection immediately hides decoration; phase controls cannot become decoration targets", () => {
  const f = fixture(); f.container.click("toggle"); f.update("play"); f.container.click("dice", true);
  const node = f.props()[0]; assert.equal(node.hidden, false);
  f.modal.hidden = false; f.observers[1].callback(); assert.equal(node.hidden, true);
  f.modal.hidden = true; f.observers[1].callback(); assert.equal(node.hidden, false);
  for (const phase of ["strike", "colour", "show_ready", "inspection", "bid_response", "paused", "deal_complete", "match_complete"]) {
    f.update(phase); const area = node.getBoundingClientRect(); assert.ok(area.top >= f.dom.corner.top);
  }
});

test("clear/account switch/pagehide end captures and remove every item, effect and listener", () => {
  for (const finish of [f => f.container.click("clear"), f => { f.changeAccount(); f.update("play"); }, f => f.win.emit("pagehide")]) {
    const f = fixture(); f.container.click("toggle"); f.container.click("tea", true);
    const node = f.props()[0], area = node.getBoundingClientRect();
    node.emit("pointerdown", { button: 0, pointerId: 1, clientX: area.left, clientY: area.top });
    finish(f); assert.equal(node.captured, null); assert.equal(node.isConnected, false);
    assert.ok([...node.handlers.values()].every(handlers => handlers.size === 0));
    if (f.container.hidden) assert.ok(f.observers.every(observer => observer.disconnected));
  }
});

test("bilingual catalog, protected stable shell and existing serving assets are wired without touching Hausdepp", async () => {
  const values = await import(url(catalog));
  assert.deepEqual(Object.keys(values.WATTEN_DECOR_MESSAGES.de).sort(), Object.keys(values.WATTEN_DECOR_MESSAGES.en).sort());
  const game = await readFile(new URL("../frontend/watten/game.js", import.meta.url), "utf8");
  assert.match(game, /data-watten-view><\/div>\s*<div data-watten-social hidden><\/div>\s*<div data-watten-decor hidden>/);
  assert.match(game, /decor\?\.update\(\{ publicPhase:/); assert.match(game, /decor\?\.suspend\(\)/);
  const css = await readFile(new URL("../frontend/styles/watten-game.css", import.meta.url), "utf8");
  assert.match(css, /hausdepp-decor-consumables\.css/); assert.match(css, /hausdepp-decor-play\.css/);
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /wt-decor-layer[^}]*pointer-events: none/);
  assert.match(original, /hausdepp-table-props/); assert.match(original, /mountConsumable/); assert.match(original, /wipeSpill/);
});
