import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const tableSource = await readFile(new URL("../frontend/watten/table.js", import.meta.url), "utf8");
const artSource = await readFile(new URL("../frontend/hausdepp/cards.js", import.meta.url), "utf8");
const { cardArt } = await import(`data:text/javascript;base64,${Buffer.from(artSource).toString("base64")}`);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, letter => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[letter]);

// A small DOM boundary, not a replacement render policy. The test runs the
// owning history markup, patch and reconciliation functions with real cardArt,
// whose unique SVG IDs deliberately change for every render.
class DomNode {
  constructor(name, attributes = {}, text = "") {
    this.nodeName = name; this.nodeType = name === "#text" ? 3 : name === "#fragment" ? 11 : 1;
    this.attrs = new Map(Object.entries(attributes)); this.childNodes = []; this.parentNode = null;
    this.text = text; this.scrollTop = 0; this.open = false; this.htmlWrites = 0;
    this.checked = this.attrs.has("checked");
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  hasAttribute(name) { return this.attrs.has(name); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  get dataset() { return Object.fromEntries(this.attributes.filter(item => item.name.startsWith("data-"))
    .map(item => [item.name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), item.value])); }
  get lastChild() { return this.childNodes.at(-1); }
  get textContent() { return this.nodeType === 3 ? this.text : this.childNodes.map(node => node.textContent).join(""); }
  set textContent(value) { if (this.nodeType === 3) this.text = value; else { this.childNodes = []; if (value) this.append(new DomNode("#text", {}, value)); } }
  get isConnected() { return this.nodeName === "DETAILS" || Boolean(this.parentNode?.isConnected); }
  append(node) { node.remove(); node.parentNode = this; this.childNodes.push(node); }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this); this.parentNode.childNodes.splice(index, 1); this.parentNode = null;
  }
  replaceWith(node) {
    const parent = this.parentNode, index = parent.childNodes.indexOf(this);
    this.remove(); node.remove(); node.parentNode = parent; parent.childNodes.splice(index, 0, node);
  }
  cloneNode(deep) {
    const clone = new DomNode(this.nodeName, Object.fromEntries(this.attrs), this.text);
    if (deep) for (const child of this.childNodes) clone.append(child.cloneNode(true));
    return clone;
  }
  set innerHTML(markup) {
    this.htmlWrites++;
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    const destination = this.nodeName === "TEMPLATE" ? this.content = new DomNode("#fragment") : this;
    const stack = [destination];
    for (const token of markup.match(/<[^>]*>|[^<]+/g) || []) {
      if (token.startsWith("</")) { stack.pop(); continue; }
      if (!token.startsWith("<")) { stack.at(-1).append(new DomNode("#text", {}, token)); continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const attributes = {};
      for (const match of token.slice(tag.length + 1, token.endsWith("/>") ? -2 : -1)
        .matchAll(/([^\s=]+)(?:="([^"]*)"|'([^']*)')?/g)) attributes[match[1]] = match[2] ?? match[3] ?? "";
      const element = new DomNode(tag.toUpperCase(), attributes); stack.at(-1).append(element);
      if (!token.endsWith("/>") && !["input", "img", "br", "hr"].includes(tag)) stack.push(element);
    }
  }
  matches(selector) {
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) return this.hasAttribute(attribute[1]) && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
    if (selector.startsWith(".")) return (this.getAttribute("class") || "").split(/\s+/).includes(selector.slice(1));
    return this.nodeName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.childNodes.flatMap(node => [...(node.nodeType === 1 && node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function fixture() {
  const document = { createElement: tag => new DomNode(tag.toUpperCase()) };
  const helpers = tableSource.slice(0, tableSource.indexOf("export function createTableView"))
    .replace(/^import[^\n]*\n/gm, "").replace(/export function /g, "function ");
  const patch = tableSource.slice(tableSource.indexOf("  function patch(element"), tableSource.indexOf("  function renderHand(vm)"));
  const context = { document, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, esc: escapeHtml,
    t: (key, values = {}) => `${key} ${Object.values(values).join(" ")}`.trim(),
    cardFace: card => `<span class="wt-card" data-card="${card}">${cardArt(card)}</span>` };
  const functions = runInNewContext(`${helpers}\nconst signatures = {};\n${patch}\n({ historyMarkup, patch });`, context);
  const node = new DomNode("DETAILS"); node.open = true;
  const vm = { spectator: false, viewerSeat: 0, engine: { phase: "play", seats: [{ party: 0 }, { party: 1 }],
    trick_history: [{ winner: 0, cards: [{ seat: 0, card: "hearts-A" }, { seat: 1, card: "bells-7" }] }] },
  room: { seats: [{ name: "Anna" }, { name: "Ben" }] } };
  return { node, vm, render: (pinned = true) => functions.patch(node, "history", functions.historyMarkup(vm, pinned)) };
}

function assertClipReferences(node) {
  const ids = node.querySelectorAll("[id]").map(item => item.getAttribute("id"));
  assert.equal(new Set(ids).size, ids.length, "every rendered card keeps a unique SVG clip ID");
  for (const item of node.querySelectorAll("[clip-path]")) {
    const id = item.getAttribute("clip-path").match(/^url\(#(.+)\)$/)?.[1];
    assert.ok(ids.includes(id), `clip reference ${id} resolves inside the history`);
  }
}

test("same Watten history and unrelated status renders retain close, pin and scrolling nodes despite fresh SVG IDs", () => {
  const f = fixture(); f.render();
  const close = f.node.querySelector("[data-wt-history-close]"), pin = f.node.querySelector("[data-wt-history-pin]"), list = f.node.querySelector("ol");
  const firstClip = f.node.querySelector("[id]").getAttribute("id"); list.scrollTop = 137;
  for (const busy of [false, true, false]) {
    f.vm.busy = busy; f.vm.liveMessage = `Connection status ${busy}`; f.render();
    assert.equal(f.node.querySelector("[data-wt-history-close]"), close); assert.ok(close.isConnected);
    assert.equal(f.node.querySelector("[data-wt-history-pin]"), pin); assert.equal(pin.checked, true);
    assert.equal(f.node.querySelector("ol"), list); assert.equal(list.scrollTop, 137); assert.equal(f.node.open, true);
    assertClipReferences(f.node);
  }
  assert.notEqual(f.node.querySelector("[id]").getAttribute("id"), firstClip, "the test really exercises cardArt's changing markup");
  assert.equal(f.node.htmlWrites, 0, "history children are reconciled instead of replaced with innerHTML");
});

test("new public tricks and finished-round history update content while retaining the close control and removing the pin", () => {
  const f = fixture(); f.render();
  const close = f.node.querySelector("[data-wt-history-close]"), list = f.node.querySelector("ol");
  f.vm.engine.trick_history.push({ winner: 1, cards: [{ seat: 0, card: "leaves-K" }, { seat: 1, card: "acorns-A" }] });
  f.vm.room.seats[1].name = "Berta"; f.render();
  assert.equal(f.node.querySelector("ol"), list); assert.equal(list.querySelectorAll("li").length, 2);
  assert.ok(f.node.querySelector('[data-card="acorns-A"]')); assert.match(list.textContent, /Berta/);
  assert.equal(f.node.querySelector("[data-wt-history-close]"), close); assertClipReferences(f.node);
  for (const phase of ["deal_complete", "match_complete"]) {
    f.vm.engine.phase = phase; f.render();
    assert.equal(f.node.querySelector("[data-wt-history-close]"), close); assert.ok(close.isConnected);
    assert.equal(f.node.querySelector("[data-wt-history-pin]"), null);
    assert.match(f.node.querySelector("summary").textContent, /history.round/);
    assert.equal(f.node.querySelectorAll("li").length, 2); assertClipReferences(f.node);
  }
});
