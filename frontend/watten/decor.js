import { mountConsumable, updateDrink, eatPiece } from "../hausdepp/decor-consumables.js";
import { clearTableEffects, wipeSpill } from "../hausdepp/decor-play.js";
import { WATTEN_DECOR_MESSAGES } from "../i18n/catalog.js";

export const DECOR_ITEMS = Object.freeze({
  beer: { sheet: "base", cell: 0, drink: "#d99a2b" },
  tea: { sheet: "snacks", cell: 1, drink: "#9a5a2a" },
  lemonade: { sheet: "evening", cell: 3, drink: "#f2d04a" },
  nuts: { sheet: "base", cell: 2, food: true },
  chips: { sheet: "snacks", cell: 2, food: true },
  pretzel: { sheet: "evening", cell: 0, food: true },
  sweets: { sheet: "evening", cell: 1, food: true },
  dice: { sheet: "snacks", cell: 0 },
});
export const DECOR_PROTECTED = ".wt-seat, .wt-seat-slot, [data-wt-hand-area], [data-wt-hand], [data-wt-trick], "
  + "[data-wt-reference], [data-wt-bubbles], [data-wt-panel], [data-wt-private], [data-wt-history], [data-wt-scores], "
  + "[data-wt-tools], [data-watten-inspection], [data-watten-bid], [data-watten-paused], [data-watten-match-result], "
  + "[data-watten-deal-result], [data-watten-match-progress], [data-watten-rematch], [data-watten-social], "
  + ".wt-bubble, .wt-call-announcement, .wt-status-bar, [data-watten-decor-controls], "
  + "button, a[href], input, select, textarea, [role='button'], [role='dialog'], dialog[open]";
const SIDE = 64, LIMIT = 8, GAP = 8;
const PHASES = new Set(["preview", "waiting", "closed", "strike", "colour", "show_ready", "inspection", "play",
  "bid_response", "deal_complete", "match_complete", "paused", "offline"]);
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const finite = rect => rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
  && rect.right > rect.left && rect.bottom > rect.top;
const overlap = (a, b, gap = GAP) => a.left < b.right + gap && a.right > b.left - gap
  && a.top < b.bottom + gap && a.bottom > b.top - gap;

/** Reserve a full future five-card band, including when this hand is empty. */
export function fiveCardReserve(hand, table, cardWidth = 64) {
  if (!finite(hand) || !finite(table)) return null;
  const width = Math.max(hand.right - hand.left, 5 * Math.max(44, cardWidth) + 32);
  const middle = (hand.left + hand.right) / 2;
  return { left: Math.max(table.left, middle - width / 2), right: Math.min(table.right, middle + width / 2),
    top: Math.min(hand.top - 20, table.bottom - Math.max(44, cardWidth) * 1.583 - 20), bottom: table.bottom };
}

export function fitsDecor(rect, geometry, occupied = []) {
  return finite(rect) && geometry.regions.some(region => rect.left >= region.left + GAP && rect.top >= region.top + GAP
    && rect.right <= region.right - GAP && rect.bottom <= region.bottom - GAP)
    && ![...geometry.protectedRects, ...occupied].some(other => finite(other) && overlap(rect, other));
}

export function findDecorPosition(geometry, occupied = [], side = SIDE) {
  for (const region of geometry.regions) {
    for (let top = region.top + GAP; top + side <= region.bottom - GAP; top += 16) {
      for (let left = region.left + GAP; left + side <= region.right - GAP; left += 16) {
        const rect = box(left, top, side, side);
        if (fitsDecor(rect, geometry, occupied)) return { region: region.name,
          x: (left - region.left) / Math.max(1, region.right - region.left - side),
          y: (top - region.top) / Math.max(1, region.bottom - region.top - side) };
      }
    }
  }
  return null;
}

/** Local presentation only. The caller supplies a public phase and DOM, no game view. */
export function createDecor({ container, root, getExpectedAccountId, isCurrent, escapeHtml: esc,
  language = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de",
  dom = document, win = window, consumables = { mount: mountConsumable, drink: updateDrink, eat: eatPiece },
  spills = { clear: clearTableEffects, create: wipeSpill } }) {
  const accountId = getExpectedAccountId(), lifecycle = new AbortController(), items = new Map(), animations = new Set();
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  let opened = false, destroyed = false, phase = "preview", selected = null, serial = 0, drag = null, ignoreClick = null;
  let geometry = { regions: [], protectedRects: [] }, notice = "", hidden = false;
  const current = () => !destroyed && Number.isSafeInteger(accountId) && accountId > 0
    && isCurrent() && getExpectedAccountId() === accountId;
  const t = (key, values = {}) => WATTEN_DECOR_MESSAGES[language() === "en" ? "en" : "de"][key]
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  container.innerHTML = `<section class="wt-decor" aria-label="${esc(t("title"))}">
    <div class="wt-decor-toolbar" data-watten-decor-controls><button type="button" data-watten-decor-action="toggle" aria-expanded="false">${esc(t("open"))}</button></div>
    <div data-watten-decor-panel hidden><div data-watten-decor-controls><p class="wt-note">${esc(t("help"))}</p>
      <div class="wt-decor-palette">${Object.keys(DECOR_ITEMS).map(kind => `<button type="button" data-watten-decor-add="${kind}">${esc(t(kind))}</button>`).join("")}</div>
      <p class="wt-note" data-watten-decor-status role="status"></p>
      <div class="wt-actions">${["use", "refill", "rotate", "remove", "wipe", "clear", "close"].map(action =>
        `<button type="button" data-watten-decor-action="${action}">${esc(t(action))}</button>`).join("")}</div></div>
      <div class="wt-decor-corner" data-watten-decor-corner role="group" aria-label="${esc(t("corner"))}"><span>${esc(t("corner"))}</span></div>
    </div><div class="wt-decor-layer" data-watten-decor-layer></div></section>`;
  container.hidden = false;
  const $ = selector => container.querySelector(selector);
  const ui = { panel: $("[data-watten-decor-panel]"), corner: $("[data-watten-decor-corner]"),
    status: $("[data-watten-decor-status]"), layer: $("[data-watten-decor-layer]"),
    toggle: $('[data-watten-decor-action="toggle"]') };
  const effects = { layer: ui.layer, nodes: new Map(), effects: new Set(), reduced };
  const listen = (node, name, callback) => node?.addEventListener(name, callback, { signal: lifecycle.signal });
  function visible(node) { return node && node.getClientRects().length && !node.closest("[hidden]"); }
  function rectFor(item) {
    const region = geometry.regions.find(area => area.name === item.position?.region);
    return region ? box(region.left + item.position.x * (region.right - region.left - SIDE),
      region.top + item.position.y * (region.bottom - region.top - SIDE), SIDE, SIDE) : null;
  }
  function occupied(except) { return [...items.values()].filter(item => item !== except && !item.node.hidden).map(rectFor).filter(finite); }
  function cancelDrag(restore = true) {
    if (!drag) return;
    const { item, pointer, origin } = drag;
    drag = null;
    if (restore) item.position = origin;
    item.node.dataset.dragging = "false";
    if (item.node.hasPointerCapture?.(pointer)) item.node.releasePointerCapture(pointer);
  }
  function stopEffects() {
    cancelDrag();
    for (const animation of animations) animation.cancel();
    animations.clear(); spills.clear(effects);
  }
  function controls() {
    const item = items.get(selected), kind = item && DECOR_ITEMS[item.kind];
    for (const action of ["use", "refill", "rotate", "remove"]) {
      const control = $(`[data-watten-decor-action="${action}"]`);
      control.disabled = !item || action === "use" && kind.drink && item.level === 0
        || action === "use" && kind.food && item.remaining === 0 || action === "refill" && !kind.drink && !kind.food;
    }
    ui.status.textContent = notice || (item ? t("selected", { name: t(item.kind) }) : t("choose"));
    for (const entry of items.values()) {
      entry.node.setAttribute("aria-pressed", String(entry.id === selected));
      entry.node.title = t("itemHelp", { name: t(entry.kind) });
      entry.node.setAttribute("aria-label", t("itemHelp", { name: t(entry.kind) }));
    }
    refreshSpillControl();
  }
  function measure() {
    const blocked = root.querySelector('[data-watten-social-drawer]:not([hidden]), dialog[open]');
    const table = root.querySelector("[data-wt-table]"), felt = root.querySelector("[data-wt-felt]");
    const hand = root.querySelector("[data-wt-hand-area]");
    const protectedRects = [...root.querySelectorAll(DECOR_PROTECTED)]
      .filter(node => !node.closest("[data-watten-decor-layer]") && visible(node)).map(node => node.getBoundingClientRect());
    if (visible(hand) && visible(table)) {
      const reserve = fiveCardReserve(hand.getBoundingClientRect(), table.getBoundingClientRect());
      if (reserve) protectedRects.push(reserve);
    }
    const regions = [];
    const region = (node, name) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, name };
    };
    if (!hidden && !visible(blocked)) {
      if (phase === "play" && visible(felt)) regions.push(region(felt, "table"));
      if (opened && visible(ui.corner)) regions.push(region(ui.corner, "corner"));
    }
    geometry = { regions, protectedRects };
  }
  function layout() {
    if (!current()) { destroy(); return; }
    measure();
    const used = [];
    for (const item of items.values()) {
      let rect = rectFor(item);
      if (!fitsDecor(rect, geometry, used)) {
        const replacement = opened || geometry.regions.some(region => region.name === item.position?.region)
          ? findDecorPosition(geometry, used) : null;
        if (replacement) { item.position = replacement; rect = rectFor(item); }
        else rect = null;
      }
      item.node.hidden = !rect;
      if (rect) {
        item.node.style.left = `${rect.left}px`; item.node.style.top = `${rect.top}px`;
        used.push(rect);
      }
    }
    for (const effect of [...effects.effects]) if (!fitsDecor(effect.getBoundingClientRect(), geometry)) effect._finish();
    controls();
  }
  function open(value) {
    stopEffects(); opened = value; ui.panel.hidden = !value;
    ui.toggle.setAttribute("aria-expanded", String(value));
    ui.toggle.textContent = t(value ? "close" : "open");
    layout();
    if (!value) ui.toggle.focus({ preventScroll: true });
  }
  function add(kind) {
    if (!opened || !DECOR_ITEMS[kind] || !current()) return;
    if (items.size >= LIMIT) { notice = t("limit", { count: LIMIT }); controls(); return; }
    measure();
    let position = findDecorPosition(geometry, occupied());
    if (position?.region === "table") {
      const area = geometry.regions.find(region => region.name === "table");
      const top = area.top + position.y * (area.bottom - area.top - SIDE);
      if (top < 0 || top + SIDE > win.innerHeight) {
        position = findDecorPosition({ ...geometry, regions: geometry.regions.filter(region => region.name === "corner") }, occupied());
      }
    }
    if (!position) { notice = t("noSpace"); controls(); return; }
    const node = dom.createElement("button"), art = dom.createElement("span"), badge = dom.createElement("span");
    const config = DECOR_ITEMS[kind], suffix = config.sheet === "base" ? "" : `-${config.sheet}`;
    node.type = "button"; node.className = "wt-decor-prop"; node.dataset.wattenDecorItem = String(++serial);
    node.dataset.wattenDecorKind = kind;
    art.className = "wt-decor-art"; art.setAttribute("aria-hidden", "true");
    art.style.backgroundImage = `url("/static/hausdepp-table-props${suffix}-v1.webp")`;
    art.style.backgroundSize = "200% 200%";
    art.style.backgroundPosition = `${config.cell % 2 * 100}% ${Math.floor(config.cell / 2) * 100}%`;
    badge.className = "wt-decor-badge"; badge.setAttribute("aria-hidden", "true");
    node.append(art, badge); ui.layer.append(node);
    const serving = consumables.mount(art, kind);
    const item = { id: String(serial), kind, node, art, badge, position, turn: 0, level: 4,
      total: serving?.portions || 0, remaining: serving?.portions || 0, events: new AbortController() };
    const listenItem = (name, callback) => node.addEventListener(name, callback, { signal: item.events.signal });
    if (config.drink) consumables.drink(art, 4);
    items.set(item.id, item); effects.nodes.set(item.id, node); selected = item.id; notice = "";
    node._cancelDrag = cancelDrag;
    listenItem("pointerdown", event => {
      if (!current() || event.button > 0 || drag || node.hidden) return;
      ignoreClick = null;
      selected = item.id; notice = "";
      drag = { item, pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
        origin: { ...item.position }, rect: rectFor(item), moved: false };
      node.setPointerCapture?.(event.pointerId); controls();
    });
    listenItem("pointermove", event => {
      if (!drag || drag.item !== item || event.pointerId !== drag.pointer) return;
      if (!current()) { destroy(); return; }
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 7) return;
      drag.moved = true; node.dataset.dragging = "true";
      move(item, box(drag.rect.left + dx, drag.rect.top + dy, SIDE, SIDE));
    });
    listenItem("pointerup", event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      if (drag.moved) ignoreClick = { id: item.id, until: Date.now() + 500 };
      cancelDrag(false); layout();
    });
    for (const name of ["pointercancel", "lostpointercapture"]) listenItem(name, () => { cancelDrag(); layout(); });
    listenItem("click", () => {
      if (!current()) { destroy(); return; }
      if (ignoreClick?.id === item.id && Date.now() <= ignoreClick.until) { ignoreClick = null; return; }
      selected = item.id; notice = ""; open(true);
    });
    listenItem("keydown", event => {
      if (!current()) { destroy(); return; }
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (directions[event.key]) {
        event.preventDefault(); measure(); const rect = rectFor(item), [x, y] = directions[event.key];
        if (rect) move(item, box(rect.left + x * 16, rect.top + y * 16, SIDE, SIDE));
      }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); selected = item.id; act("remove"); }
      if (event.key === "Escape") { event.stopPropagation?.(); cancelDrag(); open(false); }
    });
    if (position.region === "corner") ui.corner.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
    layout(); node.focus({ preventScroll: true });
  }
  function move(item, rect) {
    measure();
    if (!fitsDecor(rect, geometry, occupied(item))) return false;
    const region = geometry.regions.find(area => rect.left >= area.left && rect.right <= area.right && rect.top >= area.top && rect.bottom <= area.bottom);
    item.position = { region: region.name, x: (rect.left - region.left) / Math.max(1, region.right - region.left - SIDE),
      y: (rect.top - region.top) / Math.max(1, region.bottom - region.top - SIDE) };
    item.node.style.left = `${rect.left}px`; item.node.style.top = `${rect.top}px`; return true;
  }
  function animate(item) {
    if (reduced.matches || !item.art.animate) return;
    const animation = item.art.animate([{ scale: 1 }, { scale: .9 }, { scale: 1 }], { duration: 180 });
    animations.add(animation); animation.finished.catch(() => {}).finally(() => animations.delete(animation));
  }
  function spill(item) {
    measure();
    if (item.node.hidden || item.level === 0) return;
    let patch;
    if (!reduced.matches) {
      patch = spills.create(ui.layer, effects, item.node, DECOR_ITEMS[item.kind].drink, item.level,
        rect => current() && fitsDecor(rect, geometry));
    } else {
      const rect = rectFor(item), footprint = box(rect.left + 10, rect.top + 10, 44, 44);
      if (!fitsDecor(footprint, geometry)) return;
      item.node._spillEffect?._finish();
      if (effects.effects.size >= 3) [...effects.effects][0]._finish();
      patch = dom.createElement("button"); patch.type = "button"; patch.className = "wt-decor-static-spill";
      patch.setAttribute("aria-label", t("wipe")); patch.style.left = `${footprint.left}px`; patch.style.top = `${footprint.top}px`;
      patch.style.setProperty("--spill-color", DECOR_ITEMS[item.kind].drink);
      const events = new AbortController();
      patch._finish = () => { events.abort(); patch.remove(); effects.effects.delete(patch); if (item.node._spillEffect === patch) item.node._spillEffect = null; };
      patch.addEventListener("click", patch._finish, { signal: events.signal });
      item.node._spillEffect = patch; ui.layer.append(patch); effects.effects.add(patch);
    }
    if (!patch) { notice = t("noSpace"); return; }
    patch.dataset.wattenDecorSpill = "true";
    item.level = 0; consumables.drink(item.art, 0); item.badge.textContent = t("empty"); notice = t("spilled");
  }
  function act(action) {
    if (!current()) { destroy(); return; }
    const item = items.get(selected), config = item && DECOR_ITEMS[item.kind];
    if (action === "toggle" || action === "close") { open(action === "toggle" && !opened); return; }
    if (action === "clear") {
      stopEffects(); for (const entry of items.values()) { entry.events.abort(); entry.node.remove(); }
      items.clear(); effects.nodes.clear(); selected = null; notice = t("cleared");
    } else if (action === "wipe") { stopEffects(); notice = t("wiped"); }
    else if (item) {
      if (action === "remove") {
        stopEffects(); item.events.abort(); item.node.remove(); items.delete(item.id); effects.nodes.delete(item.id); selected = null; notice = "";
        ui.toggle.focus({ preventScroll: true });
      } else if (action === "rotate") {
        cancelDrag(); item.turn = (item.turn + 15) % 360; item.art.style.rotate = `${item.turn}deg`;
      } else if (action === "refill") {
        if (config.drink) { item.level = 4; consumables.drink(item.art, 4); }
        if (config.food) { item.remaining = item.total; consumables.eat(item.art, item.remaining); }
        item.badge.textContent = ""; notice = t("filled");
      } else if (action === "use") {
        if (config.drink && item.level) { item.level -= 1; consumables.drink(item.art, item.level); notice = t("drink"); }
        else if (config.food && item.remaining) { item.remaining -= 1; consumables.eat(item.art, item.remaining); notice = t("eat"); }
        else if (item.kind === "dice") { const value = 1 + Math.floor(Math.random() * 6); item.badge.textContent = String(value); notice = t("rolled", { value }); }
        if (config.drink && !item.level || config.food && !item.remaining) item.badge.textContent = t("empty");
        animate(item);
      } else if (action === "spill" && config.drink) spill(item);
    }
    layout();
  }
  // This extra action is present for drinks only, with no hidden gesture.
  const spillControl = dom.createElement("button"); spillControl.type = "button";
  spillControl.dataset.wattenDecorAction = "spill"; spillControl.textContent = t("spill");
  $('[data-watten-decor-action="refill"]').after(spillControl);
  function refreshSpillControl() { const item = items.get(selected); spillControl.disabled = !item || !DECOR_ITEMS[item.kind].drink || item.level === 0; }
  listen(container, "click", event => {
    const control = event.target.closest?.("[data-watten-decor-action], [data-watten-decor-add]");
    if (!control || control.disabled || !container.contains(control)) return;
    if (control.dataset.wattenDecorAdd) add(control.dataset.wattenDecorAdd);
    else act(control.dataset.wattenDecorAction);
    controls();
  });
  listen(container, "keydown", event => {
    if (event.key === "Escape" && opened) { event.preventDefault(); cancelDrag(); open(false); }
  });
  function suspend() { stopEffects(); for (const item of items.values()) item.node.hidden = true; }
  function update({ publicPhase }) {
    if (!current()) { destroy(); return; }
    if (!PHASES.has(publicPhase)) { phase = "offline"; suspend(); return; }
    if (phase !== publicPhase) stopEffects();
    phase = publicPhase; layout();
  }
  function resized() { stopEffects(); layout(); }
  listen(win, "resize", resized); listen(win, "orientationchange", resized); listen(win, "scroll", resized);
  listen(win.visualViewport, "resize", resized); listen(win.visualViewport, "scroll", resized);
  listen(reduced, "change", resized);
  listen(dom, "visibilitychange", () => { hidden = dom.hidden; if (hidden) suspend(); else layout(); });
  listen(win, "pagehide", () => destroy());
  const observer = win.ResizeObserver ? new win.ResizeObserver(resized) : null;
  observer?.observe(root); observer?.observe(ui.corner);
  const mutation = win.MutationObserver ? new win.MutationObserver(resized) : null;
  const view = root.querySelector("[data-watten-view]");
  if (view) mutation?.observe(view, { childList: true, subtree: true });
  for (const selector of ["[data-watten-social]", "[data-watten-leave-dialog]"]) {
    const node = root.querySelector(selector);
    if (node) mutation?.observe(node, { attributes: true, subtree: true, attributeFilter: ["hidden", "open"] });
  }
  function destroy() {
    if (destroyed) return;
    stopEffects(); destroyed = true; lifecycle.abort(); observer?.disconnect(); mutation?.disconnect();
    for (const item of items.values()) item.events.abort();
    items.clear(); effects.nodes.clear(); selected = null; container.replaceChildren(); container.hidden = true;
  }
  controls();
  return { update, suspend, destroy };
}
