import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const catalog = dataUrl(await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8"));
const source = (await readFile(new URL("../frontend/multigame/game-picker.js", import.meta.url), "utf8"))
  .replace('"../i18n/catalog.js"', JSON.stringify(catalog));
const { createGamePicker, gamePickerButtonMarkup } = await import(dataUrl(source));

class Events {
  listeners = new Map();
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
}

// A DOM tree with actual child identity, native-link listeners, focus and modal
// ownership. It exercises the real picker, including its shared open/append path.
class Element extends Events {
  constructor(doc, tag) {
    super(); this.doc = doc; this.tag = tag; this.children = []; this.parentNode = null;
    this.attrs = new Map(); this.dataset = {}; this.style = { removeProperty(name) { delete this[name]; } };
    this.hidden = false; this.disabled = false; this.inert = false;
  }
  setAttribute(key, value) {
    this.attrs.set(key, String(value));
    if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); }
  get id() { return this.getAttribute("id"); }
  set id(value) { this.setAttribute("id", value); }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get href() { return this.getAttribute("href"); }
  set href(value) { this.setAttribute("href", value); }
  get textContent() { return (this.ownText || "") + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { for (const child of [...this.children]) child.remove(); this.ownText = String(value); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
    if (this.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
  }
  contains(node) { for (; node; node = node.parentNode) if (node === this) return true; return false; }
  get isConnected() { return this === this.doc.body || this.doc.body.contains(this); }
  focus() { this.doc.activeElement = this; this.doc.emit("focusin", { target: this }); }
  getBoundingClientRect() { return { left: 12, right: 340, top: 20, bottom: 64, width: 328, height: 44 }; }
  matches(selector) {
    const match = selector.match(/^([a-z][\w-]*)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
    if (!match) throw new Error(`Unsupported test selector: ${selector}`);
    const [, tag, klass, attr, value] = match;
    const dataKey = attr?.startsWith("data-") && attr.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const actual = dataKey ? this.dataset[dataKey] : this.getAttribute(attr);
    return (!tag || this.tag === tag) && (!klass || this.className.split(" ").includes(klass))
      && (!attr || (value === undefined ? actual !== null && actual !== undefined : actual === value));
  }
  querySelectorAll(selector) {
    const matches = [], selectors = selector.split(",").map(value => value.trim());
    const visit = node => { for (const child of node.children) { if (selectors.some(part => child.matches(part))) matches.push(child); visit(child); } };
    visit(this); return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(html) {
    this.markup = html;
    this.ownText = "";
    for (const child of [...this.children]) child.remove();
    const stack = [this];
    for (const match of html.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>|([^<]+)/gi)) {
      if (match[4]) { stack.at(-1).ownText = (stack.at(-1).ownText || "") + match[4]; continue; }
      if (match[1]) { stack.pop(); continue; }
      const child = new Element(this.doc, match[2]);
      for (const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attr[1], attr[2] ?? "");
      stack.at(-1).append(child);
      if (!match[3].endsWith("/") && !["input", "img", "br"].includes(match[2])) stack.push(child);
    }
  }
  get innerHTML() { return this.markup || ""; }
}

const games = [
  { id: "zdwa", name: "ZDWA", href: "/" },
  { id: "hausdepp", name: "Hausdepp", href: "/hausdepp" },
];
const watten = { id: "watten", name: "Watten", href: "/watten", description: "Private preview" };
const utilities = [
  { id: "admin", name: "Admin Center", href: "/admin", description: "Manage the suite" },
  { id: "dashboard", name: "Dashboard", href: "/admin/dashboard", description: "View analytics" },
];
const settle = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

function fixture(compact = false, language = "en", utilityEntries = []) {
  const doc = new Events(), win = new Events(), requests = [], timers = new Map(), selected = [];
  doc.body = new Element(doc, "body"); doc.body.style.overflow = "scroll";
  doc.visibilityState = "visible";
  doc.createElement = tag => new Element(doc, tag);
  const content = doc.createElement("main"), button = doc.createElement("button");
  content.append(button); doc.body.append(content); doc.activeElement = button;
  let timerId = 0;
  Object.assign(win, { innerWidth: 900, innerHeight: 700, matchMedia: () => ({ matches: compact }),
    ZDWA_I18N: { getLanguage: () => language },
    setTimeout: fn => { timerId += 1; timers.set(timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id) });
  Object.assign(globalThis, { document: doc, window: win, HTMLElement: Element,
    fetch: (_url, options) => new Promise(resolve => requests.push({ options, resolve })) });
  const picker = createGamePicker({ button, currentMode: "hausdepp", games, utilities: utilityEntries,
    onSelect: (...args) => selected.push(args) });
  picker.toggle();
  return { doc, win, content, button, picker, requests, timers, selected,
    panel: () => doc.body.querySelector("nav"),
    links: () => doc.body.querySelectorAll("a[data-game-entry]"),
    utilityLinks: () => doc.body.querySelectorAll("a[data-suite-utility-entry]") };
}

for (const compact of [false, true]) {
  test(`an approved end addition preserves the open ${compact ? "modal" : "desktop"} panel, old links and focus`, async () => {
    const f = fixture(compact), panel = f.panel(), links = f.links();
    const oldActivity = f.requests[0];
    f.picker.update({ games: [...games, watten] });
    assert.equal(f.panel() === panel, true, "the same panel must remain mounted");
    assert.deepEqual(f.links().slice(0, 2), links);
    assert.equal(f.doc.activeElement, links[1]);
    assert.equal(f.button.getAttribute("aria-expanded"), "true");
    assert.equal(f.content.inert, compact);
    assert.equal(f.doc.body.style.overflow, compact ? "hidden" : "scroll");
    const added = f.links()[2];
    assert.equal(added.href, "/watten");
    assert.equal(added.getAttribute("aria-label"), "Watten");
    assert.doesNotMatch(added.innerHTML, /\[BETA\]/);
    assert.ok(added.querySelector("[data-game-activity]"));
    assert.equal(oldActivity.options.signal.aborted, true);
    assert.equal(f.requests.length, 2);
    oldActivity.resolve({ ok: true, json: async () => ({ games: { watten: { players: 987 } } }) });
    await settle();
    assert.notEqual(added.querySelector("[data-game-activity]").textContent, "987 people playing now");
    f.requests[1].resolve({ ok: true, json: async () => ({ games: { watten: { players: 2 } } }) });
    await settle();
    assert.equal(added.querySelector("[data-game-activity]").textContent, "2 people playing now");
    assert.equal(f.doc.activeElement, links[1]);
    f.picker.update({ games: [...games, watten] });
    assert.equal(f.links().length, 3);
    added.emit("click", { ctrlKey: true });
    assert.equal(f.selected[0][0], "watten");
    assert.equal(f.selected[0][1], watten);
    assert.equal(f.selected[0][2].ctrlKey, true);
    assert.equal(f.panel(), null);
    assert.equal(f.content.inert, false);
    assert.equal(f.doc.body.style.overflow, "scroll");
    assert.equal(f.timers.size, 0);
    f.picker.destroy();
  });
}

test("only a strict public game descriptor paints the beta badge, ARIA name and localized public description", () => {
  for (const language of ["de", "en"]) {
    for (const publicBeta of [undefined, false, 1, "true", true]) {
      const f = fixture(false, language);
      const game = { id: "watten", name: "Watten", href: "/watten", publicBeta };
      f.picker.update({ currentMode: "watten", games: [...games, game] });
      assert.equal(f.button.getAttribute("aria-label"), `${language === "en" ? "Choose a game" : "Spiel auswählen"}: Watten${publicBeta === true ? " [BETA]" : ""}`);
      f.picker.toggle();
      const link = f.links().at(-1);
      assert.equal(link.getAttribute("aria-label"), `Watten${publicBeta === true ? " [BETA]" : ""}`);
      assert.equal(link.querySelectorAll(".suite-game-beta").length, Number(publicBeta === true));
      const text = publicBeta === true ? language === "en" ? "Public beta" : "Öffentliche Beta"
        : language === "en" ? "Private preview" : "Private Vorschau";
      assert.ok(link.innerHTML.includes(text));
      assert.equal(gamePickerButtonMarkup(game).includes("[BETA]"), publicBeta === true);
      f.picker.destroy();
    }
  }
});

test("a game beta label is independent of public access and applies to all four games", () => {
  for (const id of ["zdwa", "zilch", "hausdepp", "watten"]) {
    assert.match(gamePickerButtonMarkup({ id, name: id, beta: true, publicBeta: false }), /\[BETA\]/);
    assert.doesNotMatch(gamePickerButtonMarkup({ id, name: id, beta: false, publicBeta: true }), /\[BETA\]/);
  }
  const f = fixture(false, "en");
  const game = { id: "watten", name: "Watten", href: "/watten", publicBeta: true, beta: false };
  f.picker.update({ currentMode: "watten", games: [...games, game] });
  f.picker.toggle();
  const link = f.links().at(-1);
  assert.equal(link.href, "/watten");
  assert.equal(link.getAttribute("aria-label"), "Watten");
  assert.doesNotMatch(link.innerHTML, /Public beta|Private preview|\[BETA\]/);
  f.picker.destroy();
});

test("withdrawing the public marker closes an open menu and removes beta branding from its trigger", () => {
  const f = fixture(true);
  const game = { id: "watten", name: "Watten", href: "/watten", publicBeta: true };
  f.picker.update({ currentMode: "watten", games: [...games, game] });
  f.picker.toggle();
  assert.equal(f.button.getAttribute("aria-label"), "Choose a game: Watten [BETA]");
  f.picker.update({ games: [...games, { ...game, publicBeta: false }] });
  assert.equal(f.panel(), null);
  assert.equal(f.button.getAttribute("aria-label"), "Choose a game: Watten");
  assert.doesNotMatch(f.button.innerHTML, /\[BETA\]/);
  assert.equal(f.content.inert, false);
  f.picker.destroy();
});

test("withdrawing an appended private option closes immediately and discards its late activity response", async () => {
  const f = fixture(true);
  f.picker.update({ games: [...games, watten] });
  const pending = f.requests[1];
  f.picker.update({ games });
  assert.equal(f.panel(), null);
  assert.equal(f.content.inert, false);
  assert.equal(f.doc.activeElement, f.button);
  assert.equal(f.doc.body.style.overflow, "scroll");
  assert.equal(pending.options.signal.aborted, true);
  for (const request of f.requests) request.resolve({ ok: true, json: async () => ({ games: { watten: { players: 987 } } }) });
  await settle();
  assert.equal(f.panel(), null);
  assert.equal(f.timers.size, 0);
  f.picker.destroy();
});

test("removal, existing DTO changes, reordered options and current-game changes still close and abort activity", async () => {
  const changes = [
    { games: [games[0]] },
    { games: [games[0], { ...games[1], href: "/elsewhere" }, watten] },
    { games: [games[0], { ...games[1], name: "Changed" }, watten] },
    { games: [games[0], { ...games[1], description: "Changed" }, watten] },
    { games: [games[1], games[0], watten] },
    { games: [games[0], watten, games[1]] },
    { games: [...games, games[0]] },
    { currentMode: "zdwa", games: [...games, watten] },
  ];
  for (const change of changes) {
    const f = fixture(true);
    f.picker.update(change);
    assert.equal(f.panel(), null);
    assert.equal(f.button.getAttribute("aria-expanded"), "false");
    assert.equal(f.content.inert, false);
    assert.equal(f.doc.activeElement, f.button);
    assert.equal(f.doc.body.style.overflow, "scroll");
    assert.equal(f.requests[0].options.signal.aborted, true);
    f.requests[0].resolve({ ok: true, json: async () => ({ games: { watten: { players: 987 } } }) });
    await settle();
    assert.equal(f.panel(), null);
    assert.equal(f.timers.size, 0);
    f.picker.destroy();
  }
});

for (const compact of [false, true]) {
  for (const language of ["de", "en"]) {
    test(`native utility links form a localized group without selecting a game (${language}, ${compact ? "mobile" : "desktop"})`, async () => {
      const f = fixture(compact, language, utilities);
      const triggerLabel = f.button.getAttribute("aria-label");
      const entries = f.utilityLinks();
      assert.deepEqual(f.links().map(link => link.dataset.gameEntry), ["zdwa", "hausdepp"]);
      assert.deepEqual(entries.map(link => link.dataset.suiteUtilityEntry), ["admin", "dashboard"]);
      assert.ok(f.panel().querySelectorAll("h2, h3").some(heading => heading.textContent === (language === "de" ? "Verwaltung" : "Administration")),
        "utilities need their own visible localized heading");
      for (const [index, entry] of entries.entries()) {
        assert.equal(entry.href, utilities[index].href);
        assert.equal(entry.getAttribute("data-game-entry"), null);
        assert.equal(entry.getAttribute("aria-current"), null);
        assert.equal(entry.querySelector("[data-game-activity]"), null);
        assert.ok(entry.textContent.includes(utilities[index].name));
        assert.ok(entry.textContent.includes(utilities[index].description));
      }
      f.requests[0].resolve({ ok: true, json: async () => ({ games: {
        zdwa: { players: 4 }, hausdepp: { players: 2 }, admin: { players: 987 }, dashboard: { players: 987 },
      } }) });
      await settle();
      assert.equal(f.panel().querySelectorAll("[data-game-activity]").length, games.length);
      assert.equal(entries.some(entry => entry.textContent.includes("987")), false);
      let prevented = false;
      entries[1].emit("click", { ctrlKey: true, metaKey: true, shiftKey: true,
        preventDefault() { prevented = true; } });
      assert.equal(prevented, false, "native modified-link navigation must remain available");
      assert.deepEqual(f.selected, [], "utility navigation must not invoke the game-selection callback");
      assert.equal(f.button.dataset.gamePicker, "hausdepp");
      assert.equal(f.button.getAttribute("aria-label"), triggerLabel);
      assert.equal(f.panel(), null);
      assert.equal(f.content.inert, false);
      assert.equal(f.doc.body.style.overflow, "scroll");
      assert.equal(f.timers.size, 0);
      f.picker.toggle();
      assert.equal(f.links().find(link => link.getAttribute("aria-current") === "page").dataset.gameEntry, "hausdepp");
      f.picker.destroy();
    });
  }

  test(`utilities participate in keyboard navigation and withdrawal releases ${compact ? "modal" : "desktop"} focus ownership`, async () => {
    const f = fixture(compact, "en", utilities);
    const key = (name, extra = {}) => {
      let prevented = false;
      f.doc.emit("keydown", { key: name, preventDefault() { prevented = true; }, stopPropagation() {}, ...extra });
      return prevented;
    };
    assert.equal(key("End"), true);
    assert.equal(f.doc.activeElement, f.utilityLinks().at(-1), "the final native utility link must be keyboard reachable");
    assert.equal(key("Home"), true);
    assert.equal(f.doc.activeElement, f.links()[0]);
    key("End");
    const pending = f.requests[0];
    f.picker.update({ utilities: [] });
    assert.equal(f.panel(), null, "withdrawn private links must immediately leave the mounted panel");
    assert.equal(f.doc.activeElement, f.button);
    assert.equal(f.content.inert, false);
    assert.equal(f.doc.body.style.overflow, "scroll");
    assert.equal(pending.options.signal.aborted, true);
    pending.resolve({ ok: true, json: async () => ({ games: { admin: { players: 987 } } }) });
    await settle();
    assert.equal(f.panel(), null);
    assert.equal(f.timers.size, 0);
    f.picker.toggle();
    assert.deepEqual(f.utilityLinks(), []);
    assert.equal(f.panel().querySelectorAll("h2, h3").some(heading => heading.textContent === "Administration"), false);
    assert.equal(f.links().length, games.length);
    f.picker.destroy();
  });
}
