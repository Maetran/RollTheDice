import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/watten/waiting-room-chrome.js", import.meta.url), "utf8");
const { createWaitingRoomChrome } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

// DOM relocation boundary: removing a focused ancestor blurs, as in browsers.
// The actual lifecycle implementation runs unchanged against these nodes.
class Node {
  constructor(dom, tag = "div") {
    this.dom = dom; this.tag = tag; this.children = []; this.parentNode = null;
    this.dataset = {}; this.attributes = {}; this.hidden = false;
  }
  get isConnected() { return this === this.dom.body || Boolean(this.parentNode?.isConnected); }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  remove() {
    if (this.contains(this.dom.activeElement)) this.dom.activeElement = this.dom.body;
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentNode = this; } }
  before(node) {
    const parent = this.parentNode; node.remove();
    parent.children.splice(parent.children.indexOf(this), 0, node); node.parentNode = parent;
  }
  after(node) {
    const parent = this.parentNode; node.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node); node.parentNode = parent;
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  matches(selector) {
    return selector === "[hidden]" ? this.hidden : selector === "label" || selector === "h2" ? this.tag === selector
      : selector === ".wt-waiting" ? this.className === "wt-waiting"
        : selector === "[data-language-switcher]" ? this.language : selector === "[data-watten-voice]" && this.voice;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelector(selector) { return this.children.find(node => node.matches(selector))
    || this.children.map(node => node.querySelector(selector)).find(Boolean) || null; }
  focus() { if (this.isConnected) this.dom.activeElement = this; }
}

function fixture({ hidden = false } = {}) {
  const dom = { documentElement: { dataset: {} }, createElement: tag => new Node(dom, tag), createComment: () => new Node(dom, "#comment") };
  const body = dom.body = new Node(dom, "body"); dom.activeElement = body;
  const header = new Node(dom, "header"), root = new Node(dom, "main"), language = new Node(dom, "label"), select = new Node(dom, "select");
  header.hidden = hidden; select.language = true; select.value = "en"; select.changeHandler = () => "still bound";
  language.append(select); header.append(language);
  const voice = new Node(dom), summary = new Node(dom, "summary"), room = new Node(dom), title = new Node(dom, "h2"), slot = new Node(dom);
  voice.voice = true; voice.controller = { audio: true, microphone: false }; voice.open = true; voice.append(summary);
  room.className = "wt-waiting"; room.append(title, slot); root.append(room, voice); body.append(header, root);
  const chrome = createWaitingRoomChrome({ root, header, dom });
  const config = { member: true, canLeave: true, busy: false, lobbyUrl: "/watten", rulesUrl: "/watten/regeln?lang=en",
    leaveLabel: "Leave waiting room", lobbyLabel: "Lobby", rulesLabel: "Rules" };
  return { dom, body, header, root, room, title, slot, language, select, voice, summary, chrome, config,
    show() { chrome.show(slot, config); },
    rerender() { chrome.park(); slot.remove(); room.append(slot); chrome.show(slot, config); } };
}

test("waiting room owns one live language/voice instance and restores their original hosts", () => {
  const f = fixture(); f.show();
  assert.equal(f.header.hidden, true); assert.equal(f.dom.documentElement.dataset.wattenWaiting, "true");
  assert.ok(f.slot.contains(f.language)); assert.ok(f.slot.contains(f.voice));
  const tools = f.slot.children[0], voiceState = f.voice.controller;
  f.rerender();
  assert.equal(f.slot.children.length, 1); assert.equal(f.slot.children[0], tools);
  assert.equal(f.voice.controller, voiceState); assert.equal(f.voice.open, true);
  assert.equal(f.select.changeHandler(), "still bound");
  assert.equal(tools.children[0].dataset.wattenCommand, "waiting-back");
  assert.equal(tools.children[0].hidden, false); assert.equal(tools.children[1].hidden, true);
  f.chrome.restore();
  assert.equal(f.header.hidden, false); assert.equal(f.language.parentNode, f.header);
  assert.equal(f.voice.parentNode, f.root); assert.equal(f.slot.children.length, 0);
  assert.equal(f.dom.documentElement.dataset.wattenWaiting, undefined);
});

test("language and voice focus survive waiting snapshots and return to the active-table host", () => {
  const f = fixture(); f.show(); f.select.focus(); f.rerender();
  assert.equal(f.dom.activeElement, f.select); assert.equal(f.select.value, "en");
  f.summary.focus(); f.rerender(); assert.equal(f.dom.activeElement, f.summary);
  f.chrome.restore(); assert.equal(f.dom.activeElement, f.summary);
  f.select.focus(); f.chrome.restore();
  assert.equal(f.dom.activeElement, f.select, "unchanged active-table renders must not move or blur header controls");
});

test("hiding the suite header moves its remaining navigation focus into the waiting room", () => {
  const f = fixture(), navigation = f.dom.createElement("a");
  f.header.append(navigation); navigation.focus(); f.show();
  assert.equal(f.dom.activeElement, f.title);
  assert.equal(f.header.contains(f.dom.activeElement), false);
});

test("preview back is navigation, busy member back stays revision-bound, teardown restores initial header state", () => {
  const f = fixture({ hidden: true });
  f.config.member = false; f.show();
  const [leave, lobby, rules] = f.slot.children[0].children;
  assert.equal(leave.hidden, true); assert.equal(lobby.hidden, false); assert.equal(lobby.href, "/watten");
  assert.equal(rules.href, "/watten/regeln?lang=en"); assert.equal(rules.textContent, "Rules");
  f.config.member = true; f.config.busy = true; f.rerender();
  assert.equal(leave.disabled, true); assert.equal(lobby.hidden, true);
  f.chrome.destroy(); f.chrome.destroy();
  assert.equal(f.header.hidden, true); assert.equal(f.voice.parentNode, f.root);
  assert.equal(f.root.children.some(node => node.tag === "#comment"), false);
  assert.equal(f.header.children.some(node => node.tag === "#comment"), false);
});
