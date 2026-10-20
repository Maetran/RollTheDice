import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../frontend/watten/motion.js", import.meta.url), "utf8");
const { createMotion, motionTransition } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const rect = (left, top, width = 50, height = 80) => ({ left, top, width, height });
const centre = value => ({ x: value.left + value.width / 2, y: value.top + value.height / 2 });
const tick = () => new Promise(resolve => setImmediate(resolve));

class Events {
  handlers = new Map();
  addEventListener(name, callback) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.handlers.get(name)?.delete(callback); }
  emit(name) { for (const callback of [...this.handlers.get(name) || []]) callback({}); }
  get listenerCount() { return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0); }
}
class Node {
  constructor(dom, bounds = rect(0, 0), key, face) {
    this.dom = dom; this.bounds = bounds; this.dataset = key ? { key } : {};
    this.face = face; this.style = { visibility: "", opacity: "" }; this.children = []; this.attributes = {};
    this.connected = true; this.animations = []; this.parent = null;
  }
  get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
  getBoundingClientRect() {
    return this.visualRect || rect(Number.parseFloat(this.style.left) || this.bounds.left,
      Number.parseFloat(this.style.top) || this.bounds.top,
      Number.parseFloat(this.style.width) || this.bounds.width, Number.parseFloat(this.style.height) || this.bounds.height);
  }
  append(node) { this.children.push(node); node.parent = this; }
  remove() { this.connected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getAttributeNames() { return Object.keys(this.attributes); }
  removeAttribute(name) { delete this.attributes[name]; }
  matches() { return this.interactive === true; }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll("*")]); }
  cloneNode() {
    const clone = new Node(this.dom, this.bounds, this.dataset.key, this.face);
    clone.attributes = { ...this.attributes }; clone.interactive = this.interactive;
    for (const child of this.children) clone.append(child.cloneNode(true));
    return clone;
  }
  animate(frames, options) {
    let resolve;
    const animation = { node: this, frames, options, cancelled: false, finished: new Promise(done => { resolve = done; }),
      finish() { resolve(); }, cancel() { this.cancelled = true; resolve(); } };
    this.animations.push(animation); this.dom.animations.push(animation);
    return animation;
  }
}
function fixture({ reduced = false } = {}) {
  const doc = new Events(), win = new Events(), media = new Events();
  doc.hidden = false; doc.visibilityState = "visible"; doc.animations = [];
  doc.createElement = () => new Node(doc);
  doc.body = new Node(doc, rect(0, 0, 900, 700));
  media.matches = reduced;
  win.innerWidth = 900; win.innerHeight = 700; win.screen = { orientation: new Events() }; win.visualViewport = new Events(); win.matchMedia = () => media;
  const motion = createMotion({ win, doc });
  const deck = new Node(doc, rect(400, 260, 42, 65), "deck", "back");
  const seats = Array.from({ length: 4 }, (_, seat) => new Node(doc, rect(30 + seat * 190, 20, 60, 90), `seat-${seat}`, "back"));
  const view = { deckNode: () => deck, collectionNode: seat => seats[seat] };
  const node = (key, bounds, face = key) => new Node(doc, bounds, key, face);
  const capture = nodes => motion.capture([...nodes, ...seats, deck]);
  const ghosts = kind => doc.body.children.filter(node => !kind || node.dataset.wtMotion === kind);
  const present = (previous, engine, result, { live = true, captured = capture([]) } = {}) => motion.present({ previous, engine, result, live, captured, view });
  const close = () => motion.destroy();
  return { doc, win, media, motion, deck, seats, view, node, capture, ghosts, present, close };
}
const engine = (last = null, deal = "deal-1") => ({ deal_id: deal, last_trick: last });
const result = ({ hand = [], nodes = [], cards = [], created = [], last = null } = {}) => ({ hand: { nodes: hand, created: [] }, trick: { nodes, cards, created, last } });
const publicTrick = (f, count, winner = count - 1) => {
  const cards = ["hearts-7", "leaves-A", "bells-9", "acorns-K"].slice(0, count).map((card, seat) => ({ card, seat }));
  const nodes = cards.map((item, index) => f.node(item.card, rect(340 + index * 20, 260 + index * 12)));
  return { cards, nodes, winner };
};

test("live waiting and new deal animate; cold entry/reconnect and repeated snapshots do not invent a deal or collection", () => {
  const last = { cards: [{ seat: 0, card: "hearts-7" }, { seat: 1, card: "leaves-A" }], winner: 1 };
  assert.deepEqual(motionTransition(undefined, engine(last), false), { sameDeal: false, deal: false, collect: false });
  assert.equal(motionTransition(undefined, engine(), true).deal, true);
  assert.equal(motionTransition(engine(), engine(null, "deal-2"), true).deal, true);
  assert.equal(motionTransition(engine(last), engine(last), true).collect, false);
  assert.equal(motionTransition(engine(), engine(last), true).collect, true);
});

test("own public play flies from the captured hand position without moving the accepted card node", async () => {
  const f = fixture(), own = f.node("hearts-7", rect(360, 560, 70, 110));
  own.interactive = true; own.setAttribute("id", "private-hand-button"); own.setAttribute("data-wt-card", "");
  const captured = f.capture([own]); own.remove();
  const played = f.node("hearts-7", rect(390, 260));
  f.present(engine(), engine(), result({ nodes: [played], cards: [{ seat: 0, card: "hearts-7" }], created: [{ node: played, seat: 0, card: "hearts-7" }] }), { captured });
  const ghost = f.ghosts("arrive")[0];
  assert.ok(ghost); assert.equal(played.style.visibility, "hidden");
  assert.equal(ghost.attributes["aria-hidden"], "true"); assert.equal(ghost.inert, true);
  assert.equal(ghost.style.pointerEvents, "none"); assert.equal(ghost.children[0].face, "hearts-7");
  assert.deepEqual(ghost.animations[0].frames[0], { translate: "-20px 315px", scale: "1.4" });
  ghost.animations[0].finish(); await tick();
  assert.equal(played.style.visibility, ""); assert.equal(f.ghosts().length, 0);
  f.close();
});

test("an opponent's newly public face starts at its fan; no opponent hand face is requested", () => {
  const f = fixture(), played = f.node("bells-9", rect(410, 300));
  f.present(engine(), engine(), result({ nodes: [played], cards: [{ seat: 2, card: "bells-9" }], created: [{ node: played, seat: 2, card: "bells-9" }] }));
  const ghost = f.ghosts("arrive")[0], from = centre(f.seats[2].bounds), to = centre(played.bounds);
  assert.equal(ghost.animations[0].frames[0].translate, `${from.x - to.x}px ${from.y - to.y}px`);
  assert.deepEqual(ghost.children.map(node => node.face), ["bells-9"]);
  f.close();
});

test("ghost artwork owns fresh SVG clip IDs, retaining its image after the source card disappears", () => {
  const f = fixture(), played = f.node("bells-9", rect(410, 300));
  const clip = f.node(undefined, rect(0, 0)); clip.setAttribute("id", "hd-card-paper-original");
  const image = f.node(undefined, rect(0, 0)); image.setAttribute("clip-path", "url(#hd-card-paper-original)");
  played.append(clip); played.append(image);
  f.present(engine(), engine(), result({ nodes: [played], cards: [{ seat: 2, card: "bells-9" }], created: [{ node: played, seat: 2, card: "bells-9" }] }));
  const copy = f.ghosts("arrive")[0].children[0], newId = copy.children[0].getAttribute("id");
  assert.notEqual(newId, "hd-card-paper-original");
  assert.equal(copy.children[1].getAttribute("clip-path"), `url(#${newId})`);
  played.remove(); assert.equal(copy.isConnected, true); f.close();
});

test("remaining hand uses FLIP on stable nodes and keeps them interactive", async () => {
  const f = fixture(), kept = f.node("leaves-A", rect(400, 560, 60, 95)); kept.interactive = true;
  const captured = f.capture([kept]); kept.bounds = rect(375, 560, 60, 95);
  f.present(engine(), engine(), result({ hand: [kept] }), { captured });
  assert.equal(kept.animations.length, 1); assert.equal(kept.animations[0].frames[0].translate, "25px 0px");
  assert.equal(kept.style.visibility, ""); assert.equal(f.ghosts().length, 0);
  kept.animations[0].finish(); await tick(); f.close();
});

test("actual first deal flies visible faces/backs from the real deck, while a cold existing hand stays still", () => {
  const f = fixture(), hand = Array.from({ length: 5 }, (_, index) => f.node(`back-${index}`, rect(250 + index * 65, 550), "back"));
  f.present(undefined, engine(), result({ hand }), { live: false }); assert.equal(f.ghosts().length, 0);
  f.present(undefined, engine(), result({ hand }));
  assert.equal(f.ghosts("deal").length, 5);
  assert.deepEqual(f.ghosts("deal").map(node => node.animations[0].options.delay), [0, 45, 90, 135, 180]);
  assert.deepEqual(f.ghosts("deal").map(node => node.children[0].face), Array(5).fill("back"));
  assert.ok(hand.every(node => node.style.visibility === "" && node.style.opacity === "0"), "actual hand hit targets remain visible to layout/input");
  assert.ok(f.ghosts("deal").every(node => node.animations[0].frames[0].translate.includes("-")));
  f.close(); assert.ok(hand.every(node => node.style.visibility === "" && node.style.opacity === ""));
});

test("a four-player live deal includes all fifteen currently visible opponent backs without faces or an unbounded stagger", () => {
  const f = fixture(), hand = Array.from({ length: 5 }, (_, index) => f.node(`hand-${index}`, rect(220 + index * 65, 550), "own-visible-face"));
  const backs = Array.from({ length: 15 }, (_, index) => f.node(undefined, rect(100 + index * 12, 30, 11, 18), "back"));
  f.view.backNodes = () => backs;
  f.present(undefined, engine(), result({ hand }));
  assert.equal(f.ghosts("deal").length, 20);
  assert.deepEqual(f.ghosts("deal").slice(5).map(node => node.children[0].face), Array(15).fill("back"));
  assert.equal(Math.max(...f.ghosts("deal").map(node => node.animations[0].options.delay)), 180);
  assert.ok(f.ghosts("deal").slice(5).every(node => node.className === "wt-backs")); f.close();
});

for (const count of [2, 3, 4]) test(`${count} players: completed public trick holds, then goes to the actual winning seat`, async () => {
  const f = fixture(), last = publicTrick(f, count), captured = f.capture(last.nodes);
  f.present(engine(), engine(last), result({ ...last, last }), { captured });
  const group = f.ghosts("collect")[0]; assert.ok(group);
  assert.equal(group.dataset.targetSeat, String(count - 1));
  assert.deepEqual(group.children.map(node => node.face), last.cards.map(item => item.card));
  const frames = group.animations[0].frames, target = centre(f.seats[count - 1].bounds), start = centre(group.getBoundingClientRect());
  assert.equal(frames[0].translate, "0 0"); assert.equal(frames[1].translate, "0 0"); assert.ok(frames[1].offset > .6);
  assert.equal(frames[2].translate, `${target.x - start.x}px ${target.y - start.y}px`);
  assert.equal(group.animations[0].options.duration, 980);
  assert.equal(group.animations[0].options.easing, "linear", "the hold uses wall-clock time, not globally eased progress");
  assert.equal(group.animations[0].options.fill, "forwards", "retain the actual winner endpoint until cleanup removes the ghost");
  assert.ok(frames[1].easing, "ease only the final flight segment");
  group.animations[0].finish(); await tick();
  assert.equal(f.ghosts().length, 0); assert.ok(last.nodes.every(node => node.style.visibility === "hidden"), "collected last trick must not reappear");
  f.present(engine(last), engine(last), result());
  assert.ok(last.nodes.every(node => node.style.visibility === "")); f.close();
});

test("fast CPU next play and duplicate accepted state keep the existing collection flight, without a second collection", () => {
  const f = fixture(), last = publicTrick(f, 4), captured = f.capture(last.nodes);
  f.present(engine(), engine(last), result({ ...last, last }), { captured });
  const collect = f.ghosts("collect")[0], animation = collect.animations[0];
  for (const node of last.nodes) node.remove();
  const next = f.node("hearts-K", rect(390, 280));
  f.present(engine(last), engine(last), result({ nodes: [next], cards: [{ seat: 3, card: "hearts-K" }],
    created: [{ node: next, seat: 3, card: "hearts-K" }], last }));
  f.present(engine(last), engine(last), result({ nodes: [next], cards: [{ seat: 3, card: "hearts-K" }], last }));
  assert.equal(f.ghosts("collect").length, 1); assert.equal(f.ghosts("collect")[0], collect);
  assert.equal(animation.cancelled, false); assert.equal(f.ghosts("arrive").length, 1);
  f.close();
});

test("a still-flying penultimate card continues from its actual displayed geometry inside the collected trick", () => {
  const f = fixture(), last = publicTrick(f, 2);
  f.present(engine(), engine(), result({ nodes: [last.nodes[0]], cards: [last.cards[0]], created: [{ ...last.cards[0], node: last.nodes[0] }] }));
  const arriving = f.ghosts("arrive")[0]; arriving.visualRect = rect(250, 150);
  const captured = f.capture(last.nodes);
  f.present(engine(), engine(last), result({ ...last, created: [{ ...last.cards[1], node: last.nodes[1] }], last }), { captured });
  const group = f.ghosts("collect")[0]; assert.equal(f.ghosts("arrive").length, 0);
  const from = centre(arriving.visualRect), to = centre(last.nodes[0].bounds);
  assert.equal(group.children[0].animations[0].frames[0].translate, `${from.x - to.x}px ${from.y - to.y}px`);
  f.close();
});

test("an unobserved completed face is never reconstructed from the public card ID or a private hand", () => {
  const f = fixture(), last = publicTrick(f, 4);
  const captured = f.capture(last.nodes.slice(0, 3));
  f.present(engine(), engine(last), result({ last }), { captured });
  assert.equal(f.ghosts().length, 0); assert.equal(f.doc.animations.length, 0); f.close();
});

test("reconnect drops old geometry/ghosts and never replays completed cards", () => {
  const f = fixture(), last = publicTrick(f, 2);
  f.present(engine(), engine(last), result({ ...last, last })); assert.equal(f.ghosts().length, 1);
  f.present(engine(), engine(last), result({ ...last, last }), { live: false });
  assert.equal(f.ghosts().length, 0); assert.ok(last.nodes.every(node => node.style.visibility === "")); f.close();
});

for (const reason of ["resize", "orientation", "scroll", "visual resize", "visual scroll", "hidden", "reduced"]) test(`${reason} cancels stale screen geometry and restores accepted DOM immediately`, () => {
  const f = fixture(), last = publicTrick(f, 2), captured = f.capture(last.nodes);
  f.present(engine(), engine(last), result({ ...last, last }), { captured });
  if (reason === "resize") { f.win.innerWidth = 700; f.win.emit("resize"); }
  if (reason === "orientation") f.win.screen.orientation.emit("change");
  if (reason === "scroll") f.win.emit("scroll");
  // Keyboard/visual viewport updates do not require a layout-window resize.
  if (reason === "visual resize") f.win.visualViewport.emit("resize");
  if (reason === "visual scroll") f.win.visualViewport.emit("scroll");
  if (reason === "hidden") { f.doc.hidden = true; f.doc.emit("visibilitychange"); }
  if (reason === "reduced") { f.media.matches = true; f.media.emit("change"); }
  assert.equal(f.ghosts().length, 0); assert.ok(last.nodes.every(node => node.style.visibility === ""));
  f.doc.hidden = false; f.media.matches = false;
  f.present(engine(), engine(last), result({ ...last, last }), { captured });
  assert.equal(f.ghosts().length, 0, "capture from before geometry cancellation cannot be reused"); f.close();
});

test("reduced motion creates no moving ghosts or hidden hand, and destroy removes all listeners", () => {
  const f = fixture({ reduced: true }), last = publicTrick(f, 2);
  f.present(engine(), engine(last), result({ ...last, hand: last.nodes, last }));
  assert.equal(f.ghosts().length, 0); assert.ok(last.nodes.every(node => node.style.visibility === ""));
  f.close(); assert.equal(f.win.listenerCount + f.doc.listenerCount + f.media.listenerCount + f.win.screen.orientation.listenerCount + f.win.visualViewport.listenerCount, 0);
});

test("a browser without WAAPI keeps the accepted DOM visible and interactive", () => {
  const f = fixture(), last = publicTrick(f, 2); f.doc.body.animate = null;
  f.present(engine(), engine(last), result({ ...last, hand: last.nodes, last }));
  assert.equal(f.ghosts().length, 0); assert.ok(last.nodes.every(node => node.style.visibility === "" && node.style.opacity === "")); f.close();
});

test("a burst stays bounded; a new deal removes every old public ghost before its own cards arrive", () => {
  const f = fixture(); let previous = engine();
  for (let index = 0; index < 30; index += 1) {
    const last = publicTrick(f, 2); last.cards = last.cards.map(item => ({ ...item, card: `${item.card}-${index}` }));
    last.nodes.forEach((node, i) => { node.face = last.cards[i].card; node.dataset.key = node.face; });
    const current = engine(last);
    f.present(previous, current, result({ ...last, last })); previous = current;
    assert.ok(f.ghosts().length <= 24);
  }
  const hand = [f.node("back-0", rect(350, 560), "back")];
  f.present(previous, engine(null, "deal-2"), result({ hand }));
  assert.equal(f.ghosts("collect").length, 0); assert.equal(f.ghosts("deal").length, 1);
  f.close(); assert.equal(f.ghosts().length, 0);
});

// Exercise the owning controller's real render function with a small view/DOM
// boundary. This catches accidental baseline resets or motion on ACK repaints;
// geometry/WAAPI above use the actual motion implementation, not a mock policy.
const controllerSource = await readFile(new URL("../frontend/watten/game.js", import.meta.url), "utf8");
function controller(f, acceptedResult) {
  const root = { querySelector: () => null }, html = { dataset: {} };
  const session = { snapshot: null, view: null, viewKind: "waiting", playerId: "p0", spectator: false, bound: true, bubbles: [] };
  const view = { ...f.view, motionSources: () => [...f.seats, f.deck], update: () => acceptedResult };
  const context = { session, html, viewRoot: () => root, decor: null, setHeading() {}, createTableView: () => view,
    motion: f.motion, engineCommand() {}, liveMessage: () => "", preserveFocus: fn => fn(), matchProgress: null, rematch: null,
    syncDecor() {}, waitingRoomMarkup: () => "", showMessage() {}, t: key => key, lobbyLink: () => "" };
  const renderSource = controllerSource.slice(controllerSource.indexOf("function render(previous ="), controllerSource.indexOf("function renderJoinPrompt()"));
  const render = runInNewContext(`${renderSource}; render;`, context);
  const snapshot = currentEngine => ({ name: "Real table", engine: { ...currentEngine, actions: [], viewer: { seat: 0 } }, room: { recipe: { player_count: 2 }, seats: [] } });
  return { render, session, html, snapshot };
}

test("actual controller preserves live waiting→first-deal and does not restart/cancel it on an ACK repaint", () => {
  const f = fixture(), hand = [f.node("hearts-A", rect(350, 550))];
  const c = controller(f, result({ hand })); c.session.snapshot = c.snapshot(engine());
  c.render({ room: {}, engine: null }, true, true);
  assert.equal(f.ghosts("deal").length, 1); assert.equal(c.html.dataset.wattenActive, "true");
  const first = f.ghosts("deal")[0]; c.render();
  assert.equal(f.ghosts("deal").length, 1); assert.equal(f.ghosts("deal")[0], first); assert.equal(first.animations[0].cancelled, false);
  f.close();
});

test("actual controller's cold/reconnect render stays static and waiting removes the active-table viewport marker", () => {
  const f = fixture(), c = controller(f, result({ hand: [f.node("hearts-A", rect(350, 550))] }));
  c.session.snapshot = c.snapshot(engine()); c.render(null, false, true);
  assert.equal(f.ghosts().length, 0); assert.equal(c.html.dataset.wattenActive, "true");
  c.session.snapshot = { name: "Waiting", room: { status: "waiting" } }; c.render();
  assert.equal(c.html.dataset.wattenActive, undefined); assert.equal(f.ghosts().length, 0); f.close();
});
