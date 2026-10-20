// One stable local arrangement per round. Ordinary prop use is confirmed by
// the room; coordinates and motion stay outside the card engine and play areas.
// Large props come from the three 2×2 atlases, small scatter pieces from the
// 4×3 scatter atlas. `size` is the drawn size relative to a large prop.
import { mountConsumable, updateDrink, eatPiece } from "./decor-consumables.js";
import { clearTableEffects, wipeSpill, leaveGlassRing, markCoaster, mountCanDetails, schedulePropEffect } from "./decor-play.js";
import { tableSurpriseArt, playTableSurprise } from "./surprise-effects.js";

const catalog = {
  beer: { sheet: "base", cell: 0, label: "Vom Bier trinken", liquid: true, drink: "#d99a2b", foam: true },
  can: { sheet: "base", cell: 1, label: "Dose anstupsen" },
  nuts: { sheet: "base", cell: 2, label: "Nüsse knabbern", crumbs: ["#c99a5b", "#8f4d2c", "#e0bb7b"], bites: 4 },
  marend: { sheet: "base", cell: 3, label: "Von der Jause essen", crumbs: ["#c9474b", "#f1d58a", "#8a5a33"], bites: 4 },
  dice: { sheet: "snacks", cell: 0, label: "Würfeln", roll: true },
  tea: { sheet: "snacks", cell: 1, label: "Vom Tee trinken", liquid: true, drink: "#9a5a2a" },
  chips: { sheet: "snacks", cell: 2, label: "Chips essen", crumbs: ["#e9c66f", "#d7a94b", "#f3dc98"], bites: 4 },
  flips: { sheet: "snacks", cell: 3, label: "Flips essen", crumbs: ["#e98d2c", "#f0a640", "#c96f1d"], bites: 4 },
  pretzel: { sheet: "evening", cell: 0, label: "Von der Brezel abbeissen", crumbs: ["#fffaf0", "#f3eee2", "#c58a4b"], bites: 3 },
  sweets: { sheet: "evening", cell: 1, label: "Süssigkeiten naschen", crumbs: ["#d8262e", "#f0b52d", "#4c9a2a", "#f4e1c0"], bites: 4 },
  lantern: { sheet: "evening", cell: 2, label: "Windlicht anstupsen" },
  lemonade: { sheet: "evening", cell: 3, label: "Von der Limonade trinken", liquid: true, drink: "#f2d04a" },
  cap: { sheet: "scatter", cell: 0, size: .38, label: "Kronkorken schnippen", motion: "cap-spin" },
  opener: { sheet: "scatter", cell: 1, size: .7, label: "Flaschenöffner drehen", motion: "spin" },
  "praline-gold": { sheet: "scatter", cell: 2, size: .36, label: "Goldene Praline essen", motion: "roll", crumbs: ["#e3b341", "#5a3018"], bites: 1 },
  "praline-red": { sheet: "scatter", cell: 3, size: .36, label: "Rote Praline essen", motion: "roll", crumbs: ["#c8202a", "#5a3018"], bites: 1 },
  die: { sheet: "scatter", cell: 4, size: .4, label: "Würfeln", motion: "die-roll", roll: true },
  "loose-nuts": { sheet: "scatter", cell: 5, size: .5, label: "Nüsse essen", motion: "hop", crumbs: ["#c99a5b", "#8f4d2c"], bites: 1 },
  "loose-chips": { sheet: "scatter", cell: 6, size: .62, label: "Chips essen", motion: "hop", crumbs: ["#e9c66f", "#f3dc98"], bites: 1 },
  "loose-flips": { sheet: "scatter", cell: 7, size: .62, label: "Flips essen", motion: "hop", crumbs: ["#e98d2c", "#f0a640"], bites: 1 },
  coin: { sheet: "svg", size: .34, label: "Münze werfen", motion: "coin", toss: true },
  coaster: { sheet: "scatter", cell: 8, size: .66, label: "Strich auf den Bierdeckel machen", motion: "coaster-turn", flat: true },
  pencil: { sheet: "scatter", cell: 9, size: .72, label: "Bleistift drehen", motion: "spin", flat: true },
  star: { sheet: "surprise", size: .42, rare: true, label: "Kosmischen Stern antippen" },
  hammer: { sheet: "surprise", size: .5, rare: true, label: "Runenhammer auf den Tisch hauen" },
  ufo: { sheet: "surprise", size: .55, rare: true, label: "Unbekanntes Knabberobjekt antippen" },
  portal: { sheet: "surprise", size: .48, rare: true, label: "Kleines Portal öffnen" },
  dragon: { sheet: "surprise", size: .55, rare: true, label: "Schlafenden Drachen wecken" },
  kraken: { sheet: "surprise", size: .52, rare: true, label: "Kraken aus der Tiefe locken" },
  clock: { sheet: "surprise", size: .46, rare: true, label: "Geheimnisvolle Taschenuhr aufziehen" },
  blackhole: { sheet: "surprise", size: .48, rare: true, label: "Schwarzes Loch antippen" },
};
const sheets = { base: [2, 2], snacks: [2, 2], evening: [2, 2], scatter: [4, 3] };
const large = Object.keys(catalog).filter(prop => !catalog[prop].size);
const scatter = Object.keys(catalog).filter(prop => catalog[prop].size && !catalog[prop].rare);
const upright = ["beer", "tea", "lemonade", "can", "lantern"];
// Some large props already carry these pieces in their own picture.
const duplicates = { lemonade: ["opener", "cap"], dice: ["die"], sweets: ["praline-gold", "praline-red"],
  chips: ["loose-chips"], flips: ["loose-flips"], nuts: ["loose-nuts"] };
const layouts = new WeakMap();
const gap = 12;
const protectedAreas = ".hd-seat, .hd-room-heading, .hd-stock-group, .hd-pile-group, .hd-burned, .hd-hand-heading, "
  + "#hausdeppHand button, #hausdeppStatus, #hausdeppEvent, .hd-action-guide, #hausdeppPeek:not([hidden]), #hausdeppResult:not([hidden]), "
  + ":is(button, a[href], input, select, textarea, [role='button']):not(.hd-table-prop)";
const copy = value => window.ZDWA_I18N?.t?.(value) || value;

// Cards, piles, names and controls. Other table objects may overlap a pushed
// or nudged object, just as a nut can roll against a glass.
function controlRects(table) {
  return [...table.querySelectorAll(protectedAreas)]
    .filter(element => !element.closest(".hd-table-decor") && element.getClientRects().length)
    .map(element => element.getBoundingClientRect());
}

// A hand grows during play. Keep the band a five- to seven-card fan will
// need, so a later pickup does not bury an object under the cards.
function handReserve(table) {
  const hand = table.querySelector("#hausdeppHand");
  if (!hand?.getClientRects().length) return null;
  const area = hand.getBoundingClientRect();
  const fan = hand.querySelector(".hd-hand-fan");
  const rect = fan?.getClientRects().length ? fan.getBoundingClientRect() : area;
  const card = hand.querySelector(".hausdepp-card")?.getBoundingClientRect();
  const cardWidth = card?.width || parseFloat(getComputedStyle(hand).getPropertyValue("--hd-hand-card")) || 126;
  const width = Math.max(rect.width && fan?.childElementCount ? rect.width : 0, cardWidth * 4.2);
  const center = area.left + area.width / 2;
  return { left: center - width / 2, right: center + width / 2, top: Math.min(rect.top, area.top) - 20, bottom: table.getBoundingClientRect().bottom };
}

function fits(table, box, others, spacing = gap, inside = true) {
  const bounds = table.getBoundingClientRect();
  if (inside && (box.left < bounds.left || box.top < bounds.top || box.right > bounds.right || box.bottom > bounds.bottom)) return false;
  return !others.some(other => intersects(box, other, spacing));
}

function roomAround(sprite, table, margin, spacing = gap, inside = false) {
  const rect = sprite.getBoundingClientRect();
  const box = { left: rect.left - margin, top: rect.top - margin, right: rect.right + margin, bottom: rect.bottom + margin };
  return fits(table, box, controlRects(table), spacing, inside);
}

function burst(sprite, colors, count = 7) {
  if (!colors) return;
  const art = sprite.firstElementChild;
  const width = art.offsetWidth;
  for (let index = 0; index < count; index += 1) {
    const crumb = document.createElement("span");
    crumb.className = "hd-prop-crumb";
    crumb.setAttribute("aria-hidden", "true");
    const size = 2 + Math.random() * Math.max(2, width / 40);
    crumb.style.cssText = `width:${size}px;height:${size}px;background:${colors[index % colors.length]};left:${30 + Math.random() * 40}%;top:${35 + Math.random() * 35}%`;
    sprite.append(crumb);
    const angle = Math.random() * Math.PI * 2;
    const distance = width * (.18 + Math.random() * .22);
    const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance;
    crumb.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${x * .6}px,${y * .6 - 10}px) scale(1)`, opacity: 1, offset: .45 },
      { transform: `translate(${x}px,${y}px) scale(.7)`, opacity: 0 },
    ], { duration: 520 + Math.random() * 260, easing: "cubic-bezier(.2,.7,.3,1)" })
      .finished.catch(() => {}).finally(() => crumb.remove());
  }
}

function ripple(sprite) {
  const ring = document.createElement("span");
  ring.className = "hd-prop-ripple";
  ring.setAttribute("aria-hidden", "true");
  sprite.firstElementChild.append(ring);
  ring.animate([{ transform: "scale(.2)", opacity: .7 }, { transform: "scale(1)", opacity: 0 }],
    { duration: 700, easing: "cubic-bezier(.2,.65,.3,1)" }).finished.catch(() => {}).finally(() => ring.remove());
}

function moveProp(table, state, sprite, automatic = false) {
  if (sprite.hidden || state.reduced.matches || sprite.dataset.moving === "true" || !table.isConnected) return;
  const art = sprite.firstElementChild;
  const prop = sprite.dataset.prop;
  const item = catalog[prop];
  const turn = Number(art.dataset.turn || 0);
  const restX = Number(art.dataset.restX || 0);
  const direction = state.random() < .5 ? -1 : 1;
  const rotate = degrees => `rotate(${degrees}deg)`;
  const base = rotate(turn);
  let frames, duration = 700, motion, crumbs = false;
  if (!roomAround(sprite, table, sprite.offsetWidth * (upright.includes(prop) ? .12 : .06), 4)) {
    if (automatic) return; // Even a decorative gesture must leave cards and controls clear.
    const rest = `translateX(${restX}px) rotate(${prop === "can" ? Number(art.dataset.fallAngle || 0) * (sprite.dataset.fallen === "true") : turn}deg)`;
    frames = [rest, `${rest} scale(.95)`, `${rest} scale(1.015)`, rest];
    motion = "squish"; // Shrinking in place always stays inside its own footprint.
    duration = 360;
  } else if (prop === "dice") {
    const next = turn + direction * 90;
    frames = [base, `translate(2px,-5px) rotate(${turn + direction * 40}deg)`, `translate(5px,0) rotate(${next + direction * 9}deg)`, `translate(1px,-1px) rotate(${next - direction * 3}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = "dice-roll";
  } else if (upright.includes(prop)) {
    const tilt = (prop === "lantern" ? 3 : prop === "can" ? 10 : 6) * direction;
    frames = [base, `rotate(${tilt * .3}deg)`, rotate(tilt), rotate(-tilt * .2), base];
    motion = prop === "can" ? "can-rock" : prop === "lantern" ? "lantern-settle" : "cup-rock";
    duration = prop === "lantern" ? 600 : 950;
    if (item.liquid && !automatic) ripple(sprite);
    if (prop === "lantern") {
      sprite.classList.remove("is-flaring");
      void sprite.offsetWidth;
      sprite.classList.add("is-flaring");
      setTimeout(() => sprite.classList.remove("is-flaring"), 1400);
    }
  } else if (prop === "pretzel") {
    const next = turn + direction * 24;
    frames = [base, `translateY(-2px) rotate(${turn + direction * 12}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = "pretzel-turn";
    crumbs = !automatic;
  } else if (item.motion === "cap-spin") {
    const next = turn + direction * 200;
    frames = [`${base} scaleX(1)`, `translateY(-6px) rotate(${turn + direction * 60}deg) scaleX(.15)`, `translateY(-8px) rotate(${turn + direction * 120}deg) scaleX(1)`,
      `translateY(-3px) rotate(${turn + direction * 170}deg) scaleX(.25)`, `rotate(${next}deg) scaleX(1)`];
    art.dataset.turn = next;
    motion = "cap-spin";
    duration = 900;
  } else if (item.motion === "spin") {
    const next = turn + direction * (prop === "pencil" ? 200 : 150);
    frames = [base, `rotate(${turn + direction * 120}deg)`, `rotate(${next + direction * 8}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = `${prop}-spin`;
    duration = 1000;
  } else if (item.motion === "roll" || item.motion === "die-roll") {
    const nextX = Math.max(-10, Math.min(10, restX + direction * 7));
    const next = turn + direction * (item.motion === "die-roll" ? 90 : 75);
    frames = [`translateX(${restX}px) ${base}`, `translate(${(restX + nextX) / 2}px,${item.motion === "die-roll" ? -9 : 0}px) rotate(${turn + direction * 45}deg)`,
      `translateX(${nextX + direction * 1.5}px) rotate(${next + direction * 6}deg)`, `translateX(${nextX}px) rotate(${next}deg)`];
    art.dataset.turn = next;
    art.dataset.restX = nextX;
    motion = item.motion === "die-roll" ? "die-roll" : "praline-roll";
  } else if (item.motion === "hop") {
    frames = [`translateX(${restX}px) ${base}`, `translate(${restX}px,-7px) ${base} scale(1.03,.97)`, `translateX(${restX}px) ${base} scale(1.04,.94)`, `translateX(${restX}px) ${base}`];
    motion = "hop";
    duration = 520;
    crumbs = !automatic;
  } else if (item.motion === "coaster-turn") {
    const next = turn + direction * 32;
    frames = [base, `translate(${direction * 3}px,-1px) rotate(${turn + direction * 22}deg)`, rotate(next)];
    art.dataset.turn = next;
    motion = "coaster-turn";
    duration = 600;
  } else {
    const slide = prop === "marend" ? 2 : 5;
    const next = Math.max(-6, Math.min(6, restX + direction * slide));
    frames = [`translateX(${restX}px)`, `translateX(${next}px) rotate(${direction * .8}deg)`, `translateX(${next}px)`];
    art.dataset.restX = next;
    motion = prop === "marend" ? "board-slide" : "bowl-slide";
    duration = prop === "marend" ? 450 : 700;
    crumbs = !automatic && prop !== "marend";
  }
  if (motion === "can-stand") art.style.setProperty("--prop-rest-angle", "0deg");
  else if (prop !== "can" && motion !== "squish") art.style.setProperty("--prop-rest-angle", `${Number(art.dataset.turn || 0)}deg`);
  art.style.setProperty("--prop-rest-x", `${Number(art.dataset.restX || 0)}px`);
  sprite.title = sprite.getAttribute("aria-label");
  sprite.dataset.moving = "true";
  sprite.dataset.lastMotion = motion;
  art.style.transformOrigin = upright.includes(prop) ? "50% 82%" : "50% 50%";
  if (crumbs) burst(sprite, item.crumbs);
  const animation = art.animate(frames.map((transform, index) => ({
    transform, easing: index === 0 ? "cubic-bezier(.42,0,.9,.45)" : "cubic-bezier(.18,.65,.35,1)",
  })), { duration, fill: "none" });
  animation.finished.catch(() => {}).finally(() => { sprite.dataset.moving = "false"; });
}

// A coin drawn in place: heads shows a crown, tails a one. Both faces stay in
// the picture; the landing side decides which one is visible.
const coinArt = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="hdCoinGold" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff2b3"/><stop offset=".45" stop-color="#e8b84a"/><stop offset="1" stop-color="#9a6a17"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#hdCoinGold)" stroke="#7d5410" stroke-width="2"/><circle cx="32" cy="32" r="23" fill="none" stroke="#a87719" stroke-width="1.5" stroke-dasharray="2 2"/><g class="hd-coin-heads" fill="#8a5d12"><path d="M19 39h26l3-15-8 7-8-11-8 11-8-7z"/><rect x="19" y="41" width="26" height="4" rx="1"/></g><g class="hd-coin-tails"><text x="32" y="44" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#8a5d12">1</text></g></svg>';

function caption(sprite, text) {
  const state = layouts.get(sprite.closest(".hd-table"));
  if (!sprite.isConnected || !state || state.reduced.matches || document.hidden
    || ["waiting", "finished"].includes(state.phase)) return;
  sprite.querySelector(".hd-prop-caption")?.remove();
  const label = document.createElement("span");
  label.className = "hd-prop-caption";
  label.setAttribute("aria-hidden", "true");
  label.textContent = text;
  sprite.append(label);
  label.animate([{ opacity: 0, transform: "translate(-50%, 4px)" }, { opacity: 1, transform: "translate(-50%, -6px)", offset: .15 },
    { opacity: 1, transform: "translate(-50%, -8px)", offset: .8 }, { opacity: 0, transform: "translate(-50%, -12px)" }],
  { duration: 1600, easing: "ease-out" }).finished.catch(() => {}).finally(() => label.remove());
}

function announce(sprite, label) {
  sprite.setAttribute("aria-label", label);
  sprite.title = label;
}

function puddle(sprite, color, size) {
  const table = sprite.closest(".hd-table");
  const state = layouts.get(table);
  wipeSpill(table, state, sprite, color, size, box => fits(table, box, controlRects(table), 2));
}

function foamCan(state, sprite) {
  sprite._cancelFoam?.();
  sprite.dataset.foaming = "false";
  void sprite.offsetWidth;
  sprite.dataset.foaming = "true";
  const settle = () => { sprite.dataset.foaming = "false"; sprite._cancelFoam = null; };
  sprite._cancelFoam = schedulePropEffect(state, settle, 1800, settle);
  puddle(sprite, "#c8a25c", 1);
}

function shakeProp(table, state, sprite) {
  if (state.reduced.matches || document.hidden || state.phase !== "playing"
    || document.querySelector("dialog[open], [data-game-tour]")) return false;
  const prop = sprite.dataset.prop;
  if (state.shared) return requestProp(state, prop, "shake");
  if (prop === "can" && sprite.dataset.canState !== "burst") {
    sprite.dataset.canState = "burst";
    sprite.dataset.bursting = "true";
    const settle = () => { sprite.dataset.bursting = "false"; };
    schedulePropEffect(state, settle, 380, settle);
    sprite.dataset.lastMotion = "can-burst";
    sprite.setAttribute("aria-pressed", "true");
    foamCan(state, sprite);
    burst(sprite, ["#e6e9da", "#fff0c8", "#d4b36b"], 7);
    announce(sprite, copy("Geplatzte Dose verschieben"));
    caption(sprite, copy("Dose geplatzt!"));
  } else if (prop === "lantern" && (sprite.dataset.lit !== "false" || sprite.dataset.relighting === "true")) {
    sprite._cancelRelight?.();
    sprite.dataset.lit = "false";
    sprite.dataset.relighting = "true";
    sprite.dataset.lastMotion = "candle-shake-out";
    sprite.classList.remove("is-flaring");
    announce(sprite, copy("Windlicht anzünden"));
    caption(sprite, copy("Windlicht ausgegangen"));
    const cancel = () => { sprite.dataset.relighting = "false"; sprite._cancelRelight = null; };
    sprite._cancelRelight = schedulePropEffect(state, () => {
      cancel();
      if (layouts.get(table) !== state || !sprite.isConnected || state.phase !== "playing"
        || state.reduced.matches || document.hidden) return;
      sprite.dataset.lit = "true";
      sprite.dataset.lastMotion = "candle-relight";
      sprite.classList.add("is-flaring");
      announce(sprite, copy("Windlicht auspusten"));
      caption(sprite, copy("Windlicht brennt wieder"));
    }, 2800, cancel);
  } else return false;
  sprite.dataset.lastGesture = "shake";
  sprite.dataset.shakeCount = String(Number(sprite.dataset.shakeCount || 0) + 1);
  return true;
}

// Playful use of an object. Returns false when the object only gets nudged.
function playWithProp(table, state, sprite) {
  const prop = sprite.dataset.prop;
  const item = catalog[prop];
  const art = sprite.firstElementChild;
  if (state.reduced.matches || document.hidden || ["waiting", "finished"].includes(state.phase)
    || document.querySelector("dialog[open], [data-game-tour]")) return true;
  if (sprite.dataset.empty === "true") return true;
  if (item.rare) {
    if (!state.surprisePending && state.surprise === prop && state.onSurprise?.(prop)) {
      state.surprisePending = true;
      sprite.disabled = true;
    }
    return true;
  }
  // Wild tapping counts even while the glass still moves: that is how it spills.
  const now = Date.now();
  if (item.drink) {
    if (sprite.dataset.moving === "true" && sprite.dataset.lastMotion === "glass-stand") return true;
    state.idleSince = now;
    sprite._taps = [...(sprite._taps || []).filter(time => now - time < 2600), now];
  }
  if (prop === "can") sprite._canTaps = [...(sprite._canTaps || []).filter(time => now - time < 2600), now];
  const wild = item.drink && sprite.dataset.fallen !== "true" && sprite._taps.length >= 3;
  const openCan = prop === "can" && sprite.dataset.canState === "sealed" && sprite._canTaps.length >= 3;
  if (sprite.dataset.moving === "true" && !wild && !openCan) return true;
  const run = (frames, duration, motion, origin = "50% 50%") => {
    for (const animation of art.getAnimations()) animation.cancel();
    sprite.dataset.moving = "true";
    sprite.dataset.lastMotion = motion;
    art.style.transformOrigin = origin;
    const animation = art.animate(frames, { duration, easing: "cubic-bezier(.2,.7,.3,1)" });
    animation.finished.catch(() => {}).finally(() => { if (sprite._motion === animation) sprite.dataset.moving = "false"; });
    sprite._motion = animation;
    return animation;
  };
  const rest = `translateX(${Number(art.dataset.restX || 0)}px) rotate(${Number(art.dataset.turn || 0)}deg)`;
  if (prop === "can") {
    if (openCan) {
      sprite.dataset.canState = "open";
      sprite.setAttribute("aria-pressed", "true");
      foamCan(state, sprite);
      announce(sprite, copy("Offene Dose schütteln"));
      caption(sprite, copy("Dose geöffnet"));
    }
    run([{ transform: rest }, { transform: `${rest} scale(.96)`, offset: .35 }, { transform: rest }],
      280, openCan ? "can-open" : "can-nudge");
    return true;
  }
  if (prop === "coaster" || prop === "pencil") {
    const coaster = prop === "coaster" ? sprite : state.nodes.get("coaster");
    if (coaster && !coaster.hidden) {
      const count = markCoaster(coaster);
      announce(coaster, `${copy(catalog.coaster.label)} – ${count}/20`);
      if (!count) caption(coaster, copy("Neue Runde, leere Rückseite"));
      if (count) {
        state.totalTallies = (state.totalTallies || 0) + 1;
        if (state.totalTallies === 42) caption(coaster, copy("42. Die Antwort auf alles."));
      }
    }
    moveProp(table, state, sprite);
    return true;
  }
  if (prop === "lantern") {
    sprite._cancelRelight?.();
    const lit = sprite.dataset.lit !== "false";
    sprite.dataset.lit = lit ? "false" : "true";
    sprite.classList.remove("is-flaring");
    if (!lit) sprite.classList.add("is-flaring");
    announce(sprite, copy(lit ? "Windlicht anzünden" : "Windlicht auspusten"));
    run([{ transform: rest }, { transform: `${rest} rotate(2deg)`, offset: .4 }, { transform: rest }], 450, lit ? "candle-out" : "candle-light");
    return true;
  }
  if (item.toss) {
    const heads = Math.random() < .5;
    sprite.dataset.face = heads ? "heads" : "tails";
    run([{ transform: `${rest} translateY(0) scaleY(1)` }, { transform: `${rest} translateY(-34px) scaleY(-1)`, offset: .25 },
      { transform: `${rest} translateY(-46px) scaleY(1)`, offset: .45 }, { transform: `${rest} translateY(-30px) scaleY(-1)`, offset: .65 },
      { transform: `${rest} translateY(0) scaleY(1)`, offset: .88 }, { transform: `${rest} translateY(-3px) scaleY(1)`, offset: .94 },
      { transform: `${rest} translateY(0) scaleY(1)` }], 1100, "coin-toss");
    setTimeout(() => caption(sprite, copy(heads ? "Kopf" : "Zahl")), 1000);
    announce(sprite, `${copy(item.label)} – ${copy(heads ? "Kopf" : "Zahl")}`);
    return true;
  }
  if (item.roll) {
    const value = 1 + Math.floor(Math.random() * 6);
    const direction = Math.random() < .5 ? -1 : 1;
    const next = Number(art.dataset.turn || 0) + direction * 180;
    art.dataset.turn = next;
    art.style.setProperty("--prop-rest-angle", `${next}deg`);
    run([{ transform: rest }, { transform: `translate(${direction * 6}px,-14px) rotate(${next - direction * 110}deg)`, offset: .35 },
      { transform: `translate(${direction * 10}px,0) rotate(${next - direction * 30}deg)`, offset: .7 },
      { transform: `translateX(${Number(art.dataset.restX || 0)}px) rotate(${next}deg)` }], 900, "dice-throw");
    setTimeout(() => caption(sprite, String(value)), 820);
    announce(sprite, `${copy(item.label)} – ${value}`);
    return true;
  }
  if (item.drink) {
    const taps = sprite._taps;
    const level = Number(sprite.dataset.level ?? 4);
    const setLevel = value => {
      sprite.dataset.level = String(value);
      if (item.foam) sprite.dataset.foam = "flat";
      updateDrink(art, value, sprite.dataset.foam === "flat");
      announce(sprite, copy(value > 0 ? item.label : "Nachschenken"));
    };
    if (sprite.dataset.fallen === "true") {
      // Ignore the rest of a wild burst; standing it up is a deliberate tap.
      if (now - Number(sprite.dataset.fallenAt || 0) < 1200 || sprite.dataset.moving === "true") return true;
      // Stand it up again, empty: what was in it is on the table now.
      sprite.dataset.fallen = "false";
      sprite._taps = [];
      art.style.setProperty("--prop-rest-angle", "0deg");
      const standing = run([{ transform: "rotate(80deg)" }, { transform: "rotate(-6deg)", offset: .75 }, { transform: "rotate(0deg)" }], 800, "glass-stand", "50% 82%");
      standing.finished.catch(() => {}).finally(() => {
        if (sprite._motion === standing && sprite.dataset.fallen !== "true") sprite.dataset.compactFall = "false";
      });
      announce(sprite, copy("Nachschenken"));
      return true;
    }
    if (taps.length >= 6) {
      sprite.dataset.compactFall = String(!roomAround(sprite, table, sprite.offsetWidth * .65, 2, true));
      sprite.dataset.fallen = "true";
      sprite.dataset.fallenAt = String(now);
      setLevel(0);
      art.style.setProperty("--prop-rest-angle", "80deg");
      if (level > 0) {
        burst(sprite, [item.drink, item.drink, "#fff8e8"], 10);
        puddle(sprite, item.drink, level);
      }
      run([{ transform: "rotate(0deg)" }, { transform: "rotate(30deg)", offset: .3 }, { transform: "rotate(88deg)", offset: .7 },
        { transform: "rotate(80deg)" }], 900, "glass-fall", "50% 82%");
      caption(sprite, copy("Umgekippt!"));
      announce(sprite, copy("Glas wieder aufstellen"));
      return true;
    }
    if (taps.length >= 3) {
      if (level > 0) {
        burst(sprite, [item.drink, item.drink, "#fff8e8"], 6);
        puddle(sprite, item.drink, level);
        setLevel(0);
      }
      run([{ transform: rest }, { transform: "rotate(9deg)", offset: .3 }, { transform: "rotate(-7deg)", offset: .6 }, { transform: rest }],
        650, "glass-spill", "50% 82%");
      if (level > 0) caption(sprite, copy("Verschüttet!"));
      return true;
    }
    if (level <= 0) {
      sprite.dataset.level = "4";
      sprite.dataset.foam = item.foam ? "fresh" : "";
      sprite._taps = [];
      updateDrink(art, 4, false);
      run([{ transform: rest, opacity: 1 }, { transform: `${rest} translateY(-6px)`, opacity: .6, offset: .4 }, { transform: rest, opacity: 1 }],
        700, "glass-refill", "50% 82%");
      caption(sprite, copy("Nachgeschenkt"));
      announce(sprite, copy(item.label));
      return true;
    }
    setLevel(level - 1);
    run([{ transform: rest }, { transform: `${rest} translateY(-8px) rotate(-10deg)`, offset: .35 },
      { transform: `${rest} translateY(-8px) rotate(-14deg)`, offset: .6 }, { transform: rest }], 900, "glass-sip", "50% 82%");
    ripple(sprite);
    if (level - 1 === 0) { caption(sprite, copy("Leer")); announce(sprite, copy("Nachschenken")); }
    return true;
  }
  if (item.bites) {
    const total = Number(sprite.dataset.totalBites || item.bites);
    const left = Math.max(0, Number(sprite.dataset.bites ?? total) - 1);
    sprite.dataset.bites = String(left);
    eatPiece(art, left, total);
    burst(sprite, item.crumbs, 4);
    if (left > 0) {
      run([{ transform: rest }, { transform: `${rest} scale(.94)`, offset: .3 }, { transform: `${rest} scale(1.02)`, offset: .65 },
        { transform: rest }], 420, "bite");
      return true;
    }
    if (sprite.dataset.keepsContainer === "true") {
      sprite.dataset.empty = "true";
      announce(sprite, copy("Aufgegessen – weiter verschiebbar"));
      caption(sprite, copy("Aufgegessen"));
      run([{ transform: rest }, { transform: `${rest} scale(.97)`, offset: .4 }, { transform: rest }], 420, "eaten");
      return true;
    }
    // Finished: the food disappears, a few crumbs stay on the wood.
    state.gone.add(prop);
    caption(sprite, copy("Aufgegessen"));
    run([{ transform: rest, opacity: 1 }, { transform: `${rest} scale(.6)`, opacity: 0 }], 520, "eaten").finished
      .catch(() => {}).finally(() => { sprite.hidden = true; });
    for (let index = 0; index < 5; index += 1) {
      const crumb = document.createElement("span");
      crumb.className = "hd-prop-crumb hd-prop-leftover";
      crumb.setAttribute("aria-hidden", "true");
      const size = 2 + Math.random() * 3;
      crumb.style.cssText = `width:${size}px;height:${size}px;background:${item.crumbs[index % item.crumbs.length]};`
        + `left:${sprite.offsetLeft + sprite.offsetWidth * (.3 + Math.random() * .4)}px;top:${sprite.offsetTop + sprite.offsetHeight * (.4 + Math.random() * .4)}px`;
      sprite.parentElement.prepend(crumb);
    }
    return true;
  }
  return false;
}

// An untouched beer slowly loses its head of foam.
function settleFoam(state) {
  if (state.shared) return;
  if (Date.now() - (state.idleSince || 0) < 150000) return;
  for (const sprite of state.nodes.values()) {
    if (catalog[sprite.dataset.prop].foam && sprite.dataset.foam !== "flat") {
      sprite.dataset.foam = "flat";
      updateDrink(sprite.firstElementChild, Number(sprite.dataset.level ?? 4), true);
    }
  }
}

// Pointer drag: push an object a little across the wood. It only stays where
// it fits beside cards, controls and the other objects; otherwise it glides back.
function enableDrag(table, state, sprite) {
  let start = null;
  sprite._cancelDrag = () => {
    if (start && sprite.hasPointerCapture?.(start.id)) sprite.releasePointerCapture(start.id);
    start = null;
    sprite.dataset.dragging = "false";
    sprite.style.translate = "";
  };
  sprite.addEventListener("pointerdown", event => {
    if (sprite.closest(".hd-surprise-dock")) return;
    if (sprite.disabled || event.button > 0 || sprite.dataset.moving === "true") return;
    start = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
      left: sprite.offsetLeft, top: sprite.offsetTop, id: event.pointerId, dragging: false,
      time: Date.now(), distance: 0, reversals: 0, direction: 0, shaken: false };
  });
  sprite.addEventListener("pointermove", event => {
    if (state.reduced.matches || sprite.disabled) { sprite._cancelDrag(); return; }
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.dragging) {
      if (Math.hypot(dx, dy) < 7) return;
      start.dragging = true;
      sprite.setPointerCapture?.(event.pointerId);
      sprite.dataset.dragging = "true";
    }
    sprite.style.translate = `${dx}px ${dy}px`;
    if (["can", "lantern"].includes(sprite.dataset.prop) && !start.shaken && Date.now() - start.time < 1800) {
      start.axis ||= Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      const position = start.axis === "x" ? event.clientX : event.clientY;
      const first = start.axis === "x" ? start.x : start.y;
      const leg = Math.max(14, Math.min(26, sprite.offsetWidth * .16));
      start.distance += Math.hypot(event.clientX - start.lastX, event.clientY - start.lastY);
      if (!start.direction && Math.abs(position - first) >= leg) {
        start.direction = Math.sign(position - first);
        start.peak = position;
      } else if (start.direction) {
        if ((position - start.peak) * start.direction >= 0) start.peak = position;
        else if (Math.abs(position - start.peak) >= leg) {
          start.direction *= -1;
          start.peak = position;
          start.reversals += 1;
        }
      }
      start.lastX = event.clientX; start.lastY = event.clientY;
      if (start.reversals >= 3 && start.distance >= Math.max(120, sprite.offsetWidth * 1.4)) {
        start.shaken = shakeProp(table, state, sprite);
      }
    }
  });
  const finish = event => {
    if (state.reduced.matches || sprite.disabled) { sprite._cancelDrag(); return; }
    if (!start || event.pointerId !== start.id) return;
    const drag = start;
    start = null;
    if (!drag.dragging) return;
    sprite.dataset.dragging = "false";
    state.swallowClick = sprite;
    setTimeout(() => { if (state.swallowClick === sprite) state.swallowClick = null; }, 0);
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    sprite.style.translate = "";
    const rect = sprite.getBoundingClientRect();
    const box = { left: rect.left + dx, right: rect.right + dx, top: rect.top + dy, bottom: rect.bottom + dy };
    if (event.type === "pointerup" && fits(table, box, controlRects(table), 6)) {
      if (catalog[sprite.dataset.prop].liquid && Math.hypot(dx, dy) > rect.width * .25) {
        leaveGlassRing(table, state, sprite, area => fits(table, area, controlRects(table), 2));
      }
      sprite.style.left = `${drag.left + dx}px`;
      sprite.style.top = `${drag.top + dy}px`;
      sprite.style.zIndex = String(state.lift = (state.lift || 1) + 1);
      if (!drag.shaken) sprite.dataset.lastMotion = "drag-drop";
      sprite.firstElementChild.animate([{ scale: "1.06" }, { scale: ".97" }, { scale: "1" }], { duration: 260, easing: "ease-out" });
      if (catalog[sprite.dataset.prop].liquid) ripple(sprite);
    } else {
      if (!drag.shaken) sprite.dataset.lastMotion = "drag-return";
      sprite.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }],
        { duration: 380, easing: "cubic-bezier(.2,.9,.3,1.15)" });
    }
  };
  sprite.addEventListener("pointerup", finish);
  sprite.addEventListener("pointercancel", finish);
}

function scheduleMotion(table, state) {
  state.timer = setTimeout(() => {
    if (!table.isConnected) {
      clearTableEffects(state);
      state.observer.disconnect();
      state.reduced.removeEventListener("change", state.onMotionPreference);
      document.removeEventListener("visibilitychange", state.onVisibility);
      window.removeEventListener("pagehide", state.onPageHide);
      return;
    }
    if (!document.hidden && state.phase === "playing" && !state.reduced.matches
      && !document.querySelector("dialog[open], [data-game-tour]")) {
      const visible = [...state.nodes.values()].filter(node => !node.hidden && node !== document.activeElement
        && !catalog[node.dataset.prop].size && node.dataset.dragging !== "true");
      const sprite = visible[Math.floor(state.random() * visible.length)];
      if (sprite) moveProp(table, state, sprite, true);
      settleFoam(state);
    }
    scheduleMotion(table, state);
  }, 20000 + state.random() * 25000);
}

function randomFor(key) {
  let seed = 2166136261;
  for (const letter of key) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619) >>> 0;
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  return [...items].map(item => ({ item, random: random() }))
    .sort((first, second) => first.random - second.random).map(entry => entry.item);
}

function intersects(first, second, spacing = gap) {
  return first.left < second.right + spacing && first.right > second.left - spacing
    && first.top < second.bottom + spacing && first.bottom > second.top - spacing;
}

function spriteFor(table, state, prop) {
  if (state.nodes.has(prop)) return state.nodes.get(prop);
  const item = catalog[prop];
  const sprite = document.createElement("button");
  sprite.type = "button";
  sprite.className = `hd-table-prop hd-table-prop--${prop}${item.size ? " hd-table-prop--small" : ""}${item.flat ? " hd-table-prop--flat" : ""}`;
  sprite.dataset.prop = prop;
  sprite.setAttribute("aria-label", copy(item.label));
  sprite.title = copy(item.label);
  if (prop === "can") sprite.setAttribute("aria-pressed", "false");
  const art = document.createElement("span");
  art.className = "hd-prop-art";
  art.dataset.sheet = item.sheet;
  if (item.rare) {
    art.dataset.sheet = "svg";
    art.innerHTML = tableSurpriseArt(prop);
  } else if (item.sheet === "svg") {
    art.innerHTML = coinArt;
    sprite.dataset.face = "heads";
  } else {
    const [columns, rows] = sheets[item.sheet];
    art.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
    art.style.backgroundPosition = `${(item.cell % columns) / (columns - 1) * 100}% ${Math.floor(item.cell / columns) / (rows - 1) * 100}%`;
  }
  art.setAttribute("aria-hidden", "true");
  sprite.append(art);
  state.layer.append(sprite);
  const consumable = mountConsumable(art, prop, item);
  if (consumable) {
    sprite.dataset.totalBites = String(consumable.portions || 0);
    sprite.dataset.keepsContainer = String(consumable.keepsContainer);
  }
  if (item.drink) { sprite.dataset.level = "4"; updateDrink(art, 4); }
  if (item.foam) sprite.dataset.foam = "fresh";
  if (prop === "can") {
    sprite.dataset.canState = "sealed";
    sprite.dataset.foaming = "false";
    mountCanDetails(art);
  }
  if (prop === "lantern") {
    sprite.dataset.lit = "true";
    sprite.dataset.relighting = "false";
    announce(sprite, copy("Windlicht auspusten"));
  }
  if (prop === "coaster") { sprite.dataset.tally = "20"; markCoaster(sprite); }
  sprite.addEventListener("click", event => {
    if (state.swallowClick === sprite) { event.preventDefault(); state.swallowClick = null; return; }
    if (state.shared && !item.rare) { requestProp(state, prop, "tap"); return; }
    if (state.reduced.matches || !playWithProp(table, state, sprite)) moveProp(table, state, sprite);
  });
  enableDrag(table, state, sprite);
  state.nodes.set(prop, sprite);
  if (state.shared?.objects[prop]) hydrateProp(table, state, sprite, state.shared.objects[prop]);
  return sprite;
}

function dockSurprise(table, state) {
  const heading = table.querySelector(".hd-room-heading");
  if (!heading || !state.surprise || state.docked) return false;
  const dock = document.createElement("span");
  dock.className = "hd-surprise-dock";
  heading.append(dock);
  const sprite = spriteFor(table, state, state.surprise);
  dock.append(sprite);
  sprite.hidden = false;
  sprite.disabled = state.reduced.matches || state.surprisePending;
  state.dock = dock;
  state.docked = true;
  table.style.setProperty("--hd-surprise-heading", "44px");
  state.layoutKey = null;
  state.frame = requestAnimationFrame(() => positionDecor(table, state));
  return true;
}

function positionDecor(table, state) {
  if (layouts.get(table) !== state || !table.isConnected) return;
  const layer = state.layer;
  if (state.dock) state.dock.style.visibility = ["waiting", "finished"].includes(state.phase) ? "hidden" : "";
  if (["waiting", "finished"].includes(state.phase)) { layer.hidden = true; return; }
  layer.hidden = false;
  const bounds = table.getBoundingClientRect();
  if (bounds.width < 260 || bounds.height < 290) { layer.hidden = true; dockSurprise(table, state); return; }
  // Hand growth is ordinary play, not a reason to move the table objects.
  // Reuse their positions until the viewport/format or the round changes.
  const layoutKey = `${Math.round(bounds.width)}:${innerWidth}:${innerHeight}`;
  if (state.layoutKey === layoutKey) { syncSpills(table, state); return; }
  for (const effect of [...(state.effects || [])]) {
    if (effect.classList.contains("hd-prop-spill") && !fits(table, effect.getBoundingClientRect(), controlRects(table), 2)) effect._finish();
  }
  for (const sprite of layer.querySelectorAll(":scope > .hd-table-prop")) sprite.hidden = true;
  const hand = handReserve(table);
  const occupied = hand ? [...controlRects(table), hand] : controlRects(table);
  const phone = innerWidth < 768;
  const landscape = innerWidth > innerHeight;
  const wide = innerWidth >= 1200;
  const limits = phone ? landscape ? [2, 2] : [1, 3] : wide ? [state.count, state.scatterCount] : [3, state.scatterCount - 1];
  const side = Math.min(phone ? landscape ? 82 : 68 : wide ? 168 : 128, bounds.width * .16);
  const chosen = state.props.slice(0, limits[0]);
  const shown = new Set(chosen.flatMap(prop => duplicates[prop] || []));
  const small = [...(state.surprise && !state.docked ? [state.surprise] : []), ...state.scatter.filter(prop => !shown.has(prop))];
  const wanted = [...chosen, ...small.slice(0, limits[1])];
  const used = [];
  let index = 0;
  for (const prop of wanted) {
    const item = catalog[prop];
    if (state.gone.has(prop)) continue; // Eaten this round; only crumbs remain.
    let placed = false;
    for (const scale of [1, .8]) {
      const art = item.size ? Math.max(24, side * item.size * scale) : Math.max(44, side * scale);
      const hit = Math.max(44, art);
      for (const candidate of state.positions) {
        const left = bounds.left + 8 + candidate.x * (bounds.width - hit - 16);
        const top = bounds.top + 64 + candidate.y * Math.max(0, bounds.height - hit - 90);
        const reserve = state.nodes.get(prop)?.dataset.fallen === "true" ? hit * .65 : 0;
        const box = { left: left - reserve, top: top - reserve, right: left + hit + reserve, bottom: top + hit + reserve };
        if (!fits(table, box, [...occupied, ...used], item.size ? 8 : gap)) continue;
        const sprite = spriteFor(table, state, prop);
        sprite.style.cssText = `left:${left - bounds.left}px;top:${top - bounds.top}px;width:${hit}px;height:${hit}px;`
          + `--prop-art:${art}px;--prop-angle:${state.angles[index % state.angles.length]}deg;--prop-delay:${index * 90}ms`;
        if (state.painted) sprite.style.animation = "none";
        sprite.hidden = false;
        if (state.shared?.objects[prop]?.fallen) hydrateProp(table, state, sprite, state.shared.objects[prop]);
        sprite.disabled = state.reduced.matches || (item.rare ? state.surprisePending : state.shared && !state.interactive);
        used.push(box);
        placed = true;
        index += 1;
        break;
      }
      if (placed) break;
    }
  }
  if (state.surprise && !state.docked && !state.nodes.get(state.surprise)?.getClientRects().length) {
    if (dockSurprise(table, state)) return;
  }
  state.painted = true;
  // A preparatory snapshot can precede the table's first complete layout.
  // Freeze only an arrangement that has actually put an object on the wood.
  if (used.length) state.layoutKey = layoutKey;
  syncSpills(table, state);
}

function resetMotion(state) {
  if (state.reduced.matches) clearTableEffects(state);
  for (const node of state.nodes.values()) {
    node.disabled = state.reduced.matches || (state.shared && !catalog[node.dataset.prop].rare && !state.interactive);
    if (!state.reduced.matches) continue;
    node._cancelDrag?.();
    const art = node.firstElementChild;
    for (const animation of node.getAnimations({ subtree: true })) animation.cancel();
    node.dataset.moving = "false";
    node.dataset.fallen = "false";
    node.dataset.compactFall = "false";
    art.dataset.turn = "0";
    art.dataset.restX = "0";
    art.style.setProperty("--prop-rest-angle", "0deg");
    art.style.setProperty("--prop-rest-x", "0px");
    if (node.dataset.prop === "can") node._canTaps = [];
  }
  if (state.shared) {
    for (const [prop, node] of state.nodes) if (state.shared.objects[prop]) hydrateProp(state.table, state, node, state.shared.objects[prop]);
    syncSpills(state.table, state);
  }
}

function requestProp(state, prop, operation) {
  if (!state.shared?.objects[prop] || !state.interactive || state.reduced.matches || document.hidden
    || !["peeking", "playing"].includes(state.phase) || document.querySelector("dialog[open], [data-game-tour]")) return false;
  const actionId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}:${++state.actionSerial}:${Math.random().toString(36).slice(2)}`;
  return Boolean(state.onPropAction?.({ object_id: prop, operation, action_id: actionId }));
}

function hydrateProp(table, state, sprite, value) {
  const prop = sprite.dataset.prop, item = catalog[prop], art = sprite.firstElementChild;
  sprite.dataset.uses = String(value.uses);
  if (value.remaining !== undefined) {
    sprite.dataset.totalBites = String(value.total);
    sprite.dataset.keepsContainer = String(value.keeps_container);
    sprite.dataset.bites = String(value.remaining);
    sprite.dataset.empty = String(value.remaining === 0);
    eatPiece(art, value.remaining);
    if (value.remaining === 0) {
      announce(sprite, copy("Aufgegessen – weiter verschiebbar"));
      if (!value.keeps_container) { state.gone.add(prop); sprite.hidden = true; }
    }
  }
  if (value.level !== undefined) {
    const changed = Number(sprite.dataset.level) !== value.level || sprite.dataset.foam !== (value.foam_flat ? "flat" : "fresh");
    sprite.dataset.level = String(value.level);
    sprite.dataset.foam = value.foam_flat ? "flat" : "fresh";
    sprite.dataset.fallen = String(value.fallen);
    sprite.dataset.fallenAt = String(value.fallen_at);
    if (value.fallen) sprite.dataset.compactFall = String(!roomAround(sprite, table, sprite.offsetWidth * .65, 2, true));
    else sprite.dataset.compactFall = "false";
    art.style.setProperty("--prop-rest-angle", value.fallen ? "80deg" : "0deg");
    if (changed) updateDrink(art, value.level, value.foam_flat);
    announce(sprite, copy(value.fallen ? "Glas wieder aufstellen" : value.level ? item.label : "Nachschenken"));
  }
  if (value.can_state) {
    sprite.dataset.canState = value.can_state;
    sprite.setAttribute("aria-pressed", String(value.can_state !== "sealed"));
    announce(sprite, copy(value.can_state === "burst" ? "Geplatzte Dose verschieben" : value.can_state === "open" ? "Offene Dose schütteln" : item.label));
  }
  if (value.face) {
    sprite.dataset.face = value.face;
    announce(sprite, `${copy(item.label)} – ${copy(value.face === "heads" ? "Kopf" : "Zahl")}`);
  }
  if (value.value !== undefined) {
    sprite.dataset.value = value.value === null ? "" : String(value.value);
    announce(sprite, `${copy(item.label)}${value.value === null ? "" : ` – ${value.value}`}`);
  }
  if (value.tally !== undefined) {
    if (Number(sprite.dataset.tally) !== value.tally) markCoaster(sprite, { value: value.tally, animate: false });
    announce(sprite, `${copy(item.label)} – ${value.tally}/20`);
  }
  if (value.lit !== undefined) {
    const pending = value.relight_at && value.relight_at > Date.now() + state.serverOffset;
    sprite.dataset.lit = String(pending ? value.lit : value.relight_at ? true : value.lit);
    sprite.dataset.relighting = String(Boolean(pending));
    announce(sprite, copy(sprite.dataset.lit === "false" ? "Windlicht anzünden" : "Windlicht auspusten"));
    if (sprite._sharedRelightAt !== (pending ? value.relight_at : null)) {
      sprite._cancelRelight?.();
      sprite._sharedRelightAt = pending ? value.relight_at : null;
      if (pending) sprite._cancelRelight = schedulePropEffect(state, () => {
        sprite._sharedRelightAt = null; sprite._cancelRelight = null;
        if (layouts.get(table) === state) hydrateProp(table, state, sprite, state.shared.objects[prop]);
      }, Math.max(0, value.relight_at - Date.now() - state.serverOffset), () => { sprite._sharedRelightAt = null; });
    }
  }
}

function syncSpills(table, state) {
  if (!state.shared || ["waiting", "finished"].includes(state.phase) || document.hidden) return;
  for (const [prop, sprite] of state.nodes) {
    const spill = state.shared.objects[prop]?.spill;
    if (!spill || sprite.hidden) { sprite._spillEffect?._finish(); continue; }
    if (sprite._spillEffect?.dataset.spillId === spill.id) {
      const cloth = sprite._spillEffect.querySelector("button");
      cloth.disabled = state.reduced.matches || !state.interactive || sprite._spillEffect.dataset.wipeState === "pending";
      continue;
    }
    const patch = wipeSpill(table, state, sprite, catalog[prop].drink || "#c8a25c", spill.amount,
      box => fits(table, box, controlRects(table), 2), { shared: true, onComplete: () => requestProp(state, prop, "wipe") });
    if (patch) patch.dataset.spillId = spill.id;
  }
}

/** Confirmed live gestures animate at each display's local object position. */
export function presentTableProp(table, event) {
  const state = layouts.get(table);
  if (!state?.shared || state.key !== `${event.game_id}:${event.round_number}`
    || event.revision !== state.shared.revision || event.revision <= state.lastPropRevision) return;
  state.lastPropRevision = event.revision;
  if (!event.effect || !["peeking", "playing"].includes(state.phase) || state.reduced.matches || document.hidden
    || document.querySelector("dialog[open], [data-game-tour]")) return;
  const sprite = state.nodes.get(event.object_id), item = catalog[event.object_id];
  if (!sprite || !item || (sprite.hidden && !(event.effect === "bite" && event.after.remaining === 0))) return;
  const art = sprite.firstElementChild;
  if (event.effect === "bite" && !event.after.keeps_container && event.after.remaining === 0) sprite.hidden = false;
  if (!sprite.getClientRects().length) return;
  const rest = `translateX(${Number(art.dataset.restX || 0)}px) rotate(${Number(art.dataset.turn || 0)}deg)`;
  const run = (frames, duration, motion, origin = "50% 50%") => {
    for (const animation of art.getAnimations()) animation.cancel();
    sprite.dataset.moving = "true"; sprite.dataset.lastMotion = motion;
    art.style.transformOrigin = origin;
    const animation = art.animate(frames, { duration, easing: "cubic-bezier(.2,.7,.3,1)" });
    sprite._motion = animation;
    animation.finished.catch(() => {}).finally(() => {
      if (sprite._motion === animation) {
        sprite.dataset.moving = "false";
        if (state.gone.has(event.object_id)) sprite.hidden = true;
      }
    });
  };
  const rock = (motion, duration = 450) => run([{ transform: rest }, { transform: `${rest} scale(.96) rotate(3deg)` }, { transform: rest }], duration, motion);
  switch (event.effect) {
    case "bite":
      burst(sprite, item.crumbs, 4);
      if (event.after.remaining === 0) caption(sprite, copy("Aufgegessen"));
      if (event.after.remaining === 0 && !event.after.keeps_container) run([{ transform: rest, opacity: 1 }, { transform: `${rest} scale(.6)`, opacity: 0 }], 520, "eaten");
      else rock(event.after.remaining ? "bite" : "eaten", 420);
      break;
    case "sip":
      run([{ transform: rest }, { transform: `${rest} translateY(-8px) rotate(-14deg)` }, { transform: rest }], 900, "glass-sip", "50% 82%");
      ripple(sprite); if (!event.after.level) caption(sprite, copy("Leer")); break;
    case "spill":
      rock("glass-spill", 650); if (event.before.level) { burst(sprite, [item.drink, "#fff8e8"], 6); caption(sprite, copy("Verschüttet!")); } break;
    case "fall":
      run([{ transform: "rotate(0deg)" }, { transform: "rotate(88deg)" }, { transform: "rotate(80deg)" }], 900, "glass-fall", "50% 82%");
      caption(sprite, copy("Umgekippt!")); break;
    case "stand":
      run([{ transform: "rotate(80deg)" }, { transform: "rotate(-6deg)" }, { transform: "rotate(0deg)" }], 800, "glass-stand", "50% 82%"); break;
    case "refill": rock("glass-refill", 700); caption(sprite, copy("Nachgeschenkt")); break;
    case "can-open": case "can-burst":
      sprite._cancelFoam?.(); sprite.dataset.foaming = "true";
      sprite._cancelFoam = schedulePropEffect(state, () => { sprite.dataset.foaming = "false"; }, 1800, () => { sprite.dataset.foaming = "false"; });
      if (event.effect === "can-burst") {
        sprite.dataset.bursting = "true";
        schedulePropEffect(state, () => { sprite.dataset.bursting = "false"; }, 380, () => { sprite.dataset.bursting = "false"; });
      }
      caption(sprite, copy(event.effect === "can-open" ? "Dose geöffnet" : "Dose geplatzt!")); rock(event.effect, 280); break;
    case "can-nudge": rock(event.effect, 280); break;
    case "candle-out": case "candle-light": case "candle-shake-out":
      sprite.classList.toggle("is-flaring", event.effect === "candle-light");
      rock(event.effect); break;
    case "coin-toss":
      run([{ transform: rest }, { transform: `${rest} translateY(-40px) scaleY(-1)` }, { transform: `${rest} translateY(-12px) scaleY(1)` }, { transform: rest }], 1100, event.effect);
      schedulePropEffect(state, () => caption(sprite, copy(event.after.face === "heads" ? "Kopf" : "Zahl")), 1000); break;
    case "dice-throw":
      run([{ transform: rest }, { transform: `${rest} translateY(-14px) rotate(110deg)` }, { transform: rest }], 900, event.effect);
      schedulePropEffect(state, () => caption(sprite, String(event.after.value)), 820); break;
    case "coaster-mark": {
      const coaster = state.nodes.get("coaster"), value = state.shared.objects.coaster;
      if (coaster && !coaster.hidden && value) {
        markCoaster(coaster, { value: value.tally ? value.tally - 1 : 20, animate: false });
        markCoaster(coaster, { value: value.tally });
        if (!value.tally) caption(coaster, copy("Neue Runde, leere Rückseite"));
        if (value.total_tallies === 42) caption(coaster, copy("42. Die Antwort auf alles."));
      }
      moveProp(table, state, sprite); break;
    }
    case "nudge": moveProp(table, state, sprite); break;
    default: break;
  }
}

export function renderTableDecor(table, { gameId, roundNumber, phase, surprise = null, onSurprise, props = null, onPropAction, interactive = true }) {
  if (!table) return;
  const key = `${gameId}:${roundNumber}`;
  let state = layouts.get(table);
  if (!state || state.key !== key) {
    if (state) clearTableEffects(state);
    cancelAnimationFrame(state?.frame);
    state?.observer.disconnect();
    clearTimeout(state?.timer);
    if (state) state.reduced.removeEventListener("change", state.onMotionPreference);
    if (state) document.removeEventListener("visibilitychange", state.onVisibility);
    if (state) window.removeEventListener("pagehide", state.onPageHide);
    state?.layer.remove();
    state?.dock?.remove();
    table.style.removeProperty("--hd-surprise-heading");
    const layer = document.createElement("div");
    layer.className = "hd-table-decor";
    layer.setAttribute("role", "group");
    layer.setAttribute("aria-label", copy("Gegenstände auf dem Tisch"));
    table.append(layer);
    const random = randomFor(key);
    const count = 4 + Math.floor(random() * 3);
    const scatterCount = 4 + Math.floor(random() * 3);
    // Mostly along the rim of the table, sometimes further in; every spot
    // is still checked against the measured play areas before use.
    const positions = shuffled(Array.from({ length: 64 }, (_, spot) => {
      const rim = spot % 3 !== 0;
      const x = rim ? (random() < .5 ? random() * .22 : .78 + random() * .22) : random();
      return { x, y: random() };
    }), random);
    state = { key, table, layer, phase, count, scatterCount, random, reduced: matchMedia("(prefers-reduced-motion: reduce)"),
      props: shuffled(large, random), scatter: shuffled(scatter, random), positions,
      angles: Array.from({ length: 10 }, () => Math.round(random() * 16 - 8)), frame: null, nodes: new Map(),
      gone: new Set(), idleSince: Date.now(), actionSerial: 0 };
    state.onMotionPreference = () => resetMotion(state);
    state.onVisibility = () => {
      if (document.hidden) clearTableEffects(state);
      else if (state.shared) {
        for (const [prop, node] of state.nodes) if (state.shared.objects[prop]) hydrateProp(table, state, node, state.shared.objects[prop]);
        syncSpills(table, state);
      }
    };
    state.onPageHide = () => { clearTableEffects(state); clearTimeout(state.timer); cancelAnimationFrame(state.frame); };
    state.reduced.addEventListener("change", state.onMotionPreference);
    document.addEventListener("visibilitychange", state.onVisibility);
    window.addEventListener("pagehide", state.onPageHide);
    state.observer = new ResizeObserver(() => {
      cancelAnimationFrame(state.frame);
      state.frame = requestAnimationFrame(() => positionDecor(table, state));
    });
    state.observer.observe(table);
    layouts.set(table, state);
    scheduleMotion(table, state);
  }
  state.onPropAction = onPropAction;
  state.interactive = interactive;
  if (props?.schema_version === 1 && `${props.game_id}:${props.round_number}` === key
    && props.layout && props.objects && (!state.shared || props.revision >= state.shared.revision)) {
    if (!state.shared) {
      state.lastPropRevision = props.revision;
      state.layoutKey = null;
    }
    if (state.shared !== props) state.serverOffset = props.server_now_ms - Date.now();
    state.shared = props;
    state.props = props.layout.props.filter(prop => large.includes(prop));
    state.scatter = props.layout.scatter.filter(prop => scatter.includes(prop));
    state.count = props.layout.count;
    state.scatterCount = props.layout.scatter_count;
    for (const [prop, node] of state.nodes) if (props.objects[prop]) hydrateProp(table, state, node, props.objects[prop]);
    for (const [prop, value] of Object.entries(props.objects)) {
      if (value.remaining === 0 && !value.keeps_container) state.gone.add(prop);
    }
  }
  for (const [prop, node] of state.nodes) if (!catalog[prop].rare) node.disabled = state.reduced.matches || (state.shared && !interactive);
  state.onSurprise = onSurprise;
  const offered = catalog[surprise]?.rare ? surprise : null;
  if (state.surprise !== offered) {
    // Consumption hides only the rare prop; the ordinary arrangement stays put.
    if (state.surprise) state.nodes.get(state.surprise)?.setAttribute("hidden", "");
    if (offered) state.layoutKey = null;
    state.surprise = offered;
    state.surprisePending = false;
    if (offered && state.docked) {
      const sprite = spriteFor(table, state, offered);
      state.dock.append(sprite);
      sprite.hidden = false;
      sprite.disabled = state.reduced.matches;
    }
  }
  if (state.phase !== phase && ["waiting", "finished"].includes(phase)) clearTableEffects(state);
  state.phase = phase;
  cancelAnimationFrame(state.frame);
  state.frame = requestAnimationFrame(() => positionDecor(table, state));
}

/** Live room events only; snapshots never replay an old surprise. */
export function presentTableSurprise(table, event, { local = false } = {}) {
  const state = layouts.get(table);
  if (!state || state.phase !== "playing" || state.key !== `${event.game_id}:${event.round_number}`
    || !catalog[event.effect]?.rare || !event.id || state.lastSurprise
    || document.querySelector("dialog[open], [data-game-tour], #appDialogBackdrop:not([hidden])")) return;
  state.lastSurprise = event.id;
  state.surpriseCleanup?.();
  state.surpriseCleanup = playTableSurprise(table, event.effect, { local, seed: event.id });
}

export function cancelTableSurprises(table) {
  const state = layouts.get(table);
  state?.surpriseCleanup?.();
  if (state) {
    state.surprisePending = false;
    for (const [prop, node] of state.nodes) if (catalog[prop].rare) node.disabled = state.reduced.matches;
  }
}
