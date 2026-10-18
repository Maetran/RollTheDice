// Rare table surprises. Purely decorative: they play below table objects,
// cards and controls and never touch game state.
const active = new WeakMap();
const noop = () => {};
let serial = 0;
// Cards, piles, names and controls stay clear of a surprise where possible.
const guarded = ".hd-seat, .hd-room-heading, .hd-stock-group, .hd-pile-group, .hd-burned, .hd-hand-heading, "
  + "#hausdeppHand, #hausdeppStatus, #hausdeppEvent, .hd-action-guide, #hausdeppPeek:not([hidden]), #hausdeppResult:not([hidden]), "
  + ":is(button, a[href], input, select, textarea, [role='button']):not(.hd-table-prop)";
const middle = [[.5, .5], [.5, .4], [.38, .46], [.62, .46], [.5, .32], [.3, .38], [.7, .38], [.42, .6], [.58, .6], [.22, .5], [.78, .5],
  [.16, .34], [.84, .34], [.16, .66], [.84, .66]];
const upper = [[.5, .3], [.36, .3], [.64, .3], [.24, .34], [.76, .34], [.5, .42], [.36, .44], [.64, .44], [.5, .55]];
const sides = [[.3, .42], [.7, .42], [.28, .6], [.72, .6], [.2, .34], [.8, .34], [.5, .44], [.5, .6]];
const edges = [[.06, .42], [.94, .42], [.06, .58], [.94, .58], [.06, .3], [.94, .3], [.06, .7], [.94, .7]];
const polar = (angle, radius, cx = 50, cy = 50) => [(cx + Math.sin(angle) * radius).toFixed(1), (cy - Math.cos(angle) * radius).toFixed(1)];
const point = (...args) => polar(...args).join(" ");
const svg = (body, view = "0 0 100 100") => `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;
const brass = id => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".45" stop-color="#d9a83f"/><stop offset="1" stop-color="#8a5a1c"/></linearGradient>`;
const uid = () => `hd-surprise-${++serial}-`;

const arts = {
  star(id) {
    // Faceted compass star: each ray has a lit and a shaded half.
    let lit = "", shade = "";
    for (let ray = 0; ray < 8; ray++) {
      const angle = ray * Math.PI / 4, tip = ray % 2 ? 33 : 48, side = Math.PI / 8;
      lit += `M50 50L${point(angle, tip)}L${point(angle - side, 17)}Z`;
      shade += `M50 50L${point(angle, tip)}L${point(angle + side, 17)}Z`;
    }
    return svg(`<defs>${brass(`${id}b`)}<linearGradient id="${id}d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d49b3e"/><stop offset="1" stop-color="#74491a"/></linearGradient>`
      + `<radialGradient id="${id}h"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".5"/><stop offset=".55" stop-color="#9b7be0" stop-opacity=".16"/><stop offset="1" stop-color="#9b7be0" stop-opacity="0"/></radialGradient>`
      + `<radialGradient id="${id}c" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#fff4cf"/><stop offset=".16" stop-color="#c7a6ff"/><stop offset=".48" stop-color="#5a2f9e"/><stop offset=".82" stop-color="#1d1238"/><stop offset="1" stop-color="#0b0a18"/></radialGradient></defs>`
      + `<circle cx="50" cy="50" r="49" fill="url(#${id}h)"/><path d="${lit}" fill="url(#${id}b)"/><path d="${shade}" fill="url(#${id}d)"/>`
      + `<path d="${lit}${shade}" fill="none" stroke="#5a3a12" stroke-width=".7" stroke-linejoin="round"/>`
      + `<circle cx="50" cy="50" r="13" fill="url(#${id}c)" stroke="url(#${id}b)" stroke-width="2.4"/>`
      + `<path d="M43 53c1-7 9-10 14-5-4-1-9 0-10 5" fill="none" stroke="#e2cfff" stroke-width="1" stroke-linecap="round" opacity=".75"/>`
      + `<g fill="#fff6dc"><circle cx="45" cy="45" r=".9"/><circle cx="56" cy="55" r=".7"/><circle cx="54.5" cy="44.5" r=".5"/></g>`);
  },
  hammer(id) {
    // Short-hafted hammer with flared iron head, brass bands and inlaid runes.
    return svg(`<defs>${brass(`${id}b`)}<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4ccd0"/><stop offset=".45" stop-color="#7a8489"/><stop offset="1" stop-color="#363d41"/></linearGradient>`
      + `<linearGradient id="${id}w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9a6633"/><stop offset=".5" stop-color="#6e4220"/><stop offset="1" stop-color="#4a2a12"/></linearGradient></defs>`
      + `<g transform="rotate(-28 50 50)"><rect x="45.5" y="38" width="9" height="46" rx="3" fill="url(#${id}w)" stroke="#2e1a0b" stroke-width=".8"/>`
      + `<path d="M46 63l8-4m-8 10 8-4m-8 10 8-4m-8 10 8-4" stroke="#2b190c" stroke-width="2" opacity=".75"/>`
      + `<rect x="43" y="40" width="14" height="5" rx="1.5" fill="url(#${id}b)" stroke="#5a3a12" stroke-width=".6"/>`
      + `<path d="M20 14 39 18h22l19-4v30l-19-4H39l-19 4z" fill="url(#${id}s)" stroke="#1f2427" stroke-width="1.2" stroke-linejoin="round"/>`
      + `<path d="M22 16.5 39 20h22l17-3.5" fill="none" stroke="#eef3f4" stroke-width="1" opacity=".55"/>`
      + `<path d="M36 18h4v22h-4zm24 0h4v22h-4z" fill="url(#${id}b)"/>`
      + `<path d="M46 23v12m0-12 5 3-5 3 5 6m3-12v12l-3-4M26 22l4 7-4 7m48-14-4 7 4 7" fill="none" stroke="#f0cf6e" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<circle cx="50" cy="88" r="5" fill="url(#${id}b)" stroke="#5a3a12" stroke-width=".8"/><circle cx="50" cy="88" r="1.8" fill="#2b190c"/></g>`);
  },
  ufo(id) {
    // Fifties saucer: brushed hull, brass trim, green glass dome, warm rim lights.
    return svg(`<defs>${brass(`${id}b`)}<radialGradient id="${id}g" cx=".4" cy=".3" r=".75"><stop offset="0" stop-color="#eafff0"/><stop offset=".35" stop-color="#9fe8b9"/><stop offset=".75" stop-color="#3f9a6e"/><stop offset="1" stop-color="#1d5a40"/></radialGradient>`
      + `<linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1ee"/><stop offset=".5" stop-color="#a9b2ae"/><stop offset="1" stop-color="#5b6561"/></linearGradient></defs>`
      + `<path d="M50 23v-9" stroke="#8d969a" stroke-width="1.6"/><circle cx="50" cy="13" r="2.6" fill="#ffd36b" stroke="#a5702a" stroke-width=".6"/>`
      + `<path d="M31 52c0-18 8-29 19-29s19 11 19 29z" fill="url(#${id}g)" fill-opacity=".92" stroke="#2c6b4c" stroke-width="1"/>`
      + `<path d="M38 45c0-10 4-16 10-18" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>`
      + `<ellipse cx="50" cy="61" rx="46" ry="13" fill="url(#${id}m)" stroke="#3d4542" stroke-width="1.2"/>`
      + `<path d="M13 57c10-6 23-8 37-8s27 2 37 8" fill="none" stroke="url(#${id}b)" stroke-width="3"/>`
      + `<ellipse cx="50" cy="69" rx="25" ry="5.5" fill="#4a524f"/><ellipse cx="50" cy="73" rx="9" ry="3" fill="#8ff0b8" opacity=".85"/>`
      + `<g fill="#ffd36b" stroke="#a5702a" stroke-width=".6"><circle cx="18" cy="62" r="2.4"/><circle cx="34" cy="66" r="2.4"/><circle cx="50" cy="67.5" r="2.4"/><circle cx="66" cy="66" r="2.4"/><circle cx="82" cy="62" r="2.4"/></g>`);
  },
  portal(id) {
    // Brass-rimmed gate with a teal-to-violet swirl.
    let studs = "";
    for (let stud = 0; stud < 8; stud++) {
      const [cx, cy] = polar(stud * Math.PI / 4 + Math.PI / 8, 44);
      studs += `<circle cx="${cx}" cy="${cy}" r="1.7"/>`;
    }
    return svg(`<defs>${brass(`${id}b`)}<radialGradient id="${id}p"><stop offset="0" stop-color="#f4fffb"/><stop offset=".2" stop-color="#7ff3e1"/><stop offset=".48" stop-color="#3a9fc9"/><stop offset=".78" stop-color="#4b2d8f"/><stop offset="1" stop-color="#160d33"/></radialGradient></defs>`
      + `<circle cx="50" cy="50" r="44" fill="url(#${id}p)"/>`
      + `<g fill="none" stroke="#d6fff6" stroke-linecap="round"><path d="M50 50c0-8 9-12 15-6s3 19-8 22-25-4-26-17 11-27 25-27" stroke-width="2" opacity=".75"/><path d="M50 50c0 8-9 12-15 6s-3-19 8-22 25 4 26 17-11 27-25 27" stroke-width="1.4" opacity=".5"/></g>`
      + `<circle cx="50" cy="50" r="44" fill="none" stroke="url(#${id}b)" stroke-width="6"/><circle cx="50" cy="50" r="47.3" fill="none" stroke="#5a3a12" stroke-width="1"/>`
      + `<circle cx="50" cy="50" r="40.7" fill="none" stroke="#5a3a12" stroke-width=".8"/><g fill="#fff0b8" stroke="#8a5a1c" stroke-width=".5">${studs}</g>`);
  },
  dragon(id) {
    // Legless brass wyrm with membrane wings and an emerald eye.
    const body = "M32 82c12-2 22-8 22-20s-12-16-6-26 16-10 22-8";
    return svg(`<defs>${brass(`${id}b`)}<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2a24a" stop-opacity=".92"/><stop offset="1" stop-color="#6e3a14" stop-opacity=".88"/></linearGradient></defs>`
      + `<g class="hd-wing-b" opacity=".85"><path d="M58 44 66 18 78 4Q76 18 80 20Q72 24 84 30Q70 30 70 40Z" fill="url(#${id}m)" stroke="#5a3a12" stroke-linejoin="round"/><path d="M66 18 80 20M66 18l18 12M66 18l4 22" fill="none" stroke="#5a3a12" stroke-width=".8"/></g>`
      + `<g class="hd-wing-a"><path d="M54 46 40 22 24 10Q30 24 26 26Q34 30 22 34Q36 38 36 44Z" fill="url(#${id}m)" stroke="#5a3a12" stroke-linejoin="round"/><path d="M40 22 26 26M40 22 22 34M40 22l-4 22" fill="none" stroke="#5a3a12" stroke-width=".8"/></g>`
      + `<path d="M32 82c-8 1-16-2-18-8" fill="none" stroke="url(#${id}b)" stroke-width="5" stroke-linecap="round"/><path d="M15 75l-8-3 4 8z" fill="url(#${id}b)" stroke="#5a3a12" stroke-width=".8" stroke-linejoin="round"/>`
      + `<path d="${body}" fill="none" stroke="#5a3a12" stroke-width="11" stroke-linecap="round"/><path d="${body}" fill="none" stroke="url(#${id}b)" stroke-width="9" stroke-linecap="round"/>`
      + `<path d="${body}" fill="none" stroke="#fff4c8" stroke-width="2.4" stroke-dasharray="2 3.5" opacity=".55"/>`
      + `<path d="M66 30C66 22 72 17 80 17L92 21L84 25L89 28L78 31Z" fill="url(#${id}b)" stroke="#5a3a12" stroke-linejoin="round"/>`
      + `<path d="M71 19 66 8l9 8zm5-1.5 1-10.5 3 10z" fill="#c8923a" stroke="#5a3a12" stroke-width=".8" stroke-linejoin="round"/>`
      + `<circle cx="77" cy="22.5" r="1.9" fill="#5fe0a8"/><path d="M77 21v3" stroke="#10241b" stroke-width=".9"/>`);
  },
  kraken(id) {
    // Deep-sea kraken with brass goggle rims.
    return svg(`<defs>${brass(`${id}b`)}<radialGradient id="${id}k" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#9fd8d0"/><stop offset=".45" stop-color="#3f7f86"/><stop offset="1" stop-color="#1d2f4a"/></radialGradient>`
      + `<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f7f86"/><stop offset="1" stop-color="#22385a"/></linearGradient></defs>`
      + `<g fill="none" stroke="url(#${id}t)" stroke-width="6" stroke-linecap="round"><path d="M38 58c-8 10-20 8-22 20s10 12 12 4"/><path d="M44 62c-4 12-12 18-8 28s12 2 8-4"/>`
      + `<path d="M50 63c0 12 2 20 8 26s10-4 4-8"/><path d="M56 62c6 10 14 14 18 22s-6 10-8 2"/><path d="M62 58c10 6 20 2 24 12s-6 12-10 6"/></g>`
      + `<g fill="#e9d6bd" opacity=".85"><circle cx="20" cy="74" r="1.3"/><circle cx="38" cy="80" r="1.3"/><circle cx="55" cy="80" r="1.3"/><circle cx="70" cy="78" r="1.3"/><circle cx="84" cy="68" r="1.3"/></g>`
      + `<path d="M30 50c0-22 9-36 20-36s20 14 20 36c0 8-9 14-20 14s-20-6-20-14z" fill="url(#${id}k)" stroke="#13233a" stroke-width="1.2"/>`
      + `<path d="M38 26c3-6 8-9 13-9" fill="none" stroke="#d8fff6" stroke-width="2" stroke-linecap="round" opacity=".5"/>`
      + `<g fill="#10202e" stroke="url(#${id}b)" stroke-width="2.4"><circle cx="42" cy="46" r="5"/><circle cx="58" cy="46" r="5"/></g><path d="M47 46h6" stroke="url(#${id}b)" stroke-width="1.6"/>`
      + `<g fill="#f4e7a1"><rect x="39.5" y="45" width="5" height="2" rx="1"/><rect x="55.5" y="45" width="5" height="2" rx="1"/></g>`
      + `<g fill="#6fb7b0" opacity=".6"><circle cx="50" cy="30" r="1.6"/><circle cx="44" cy="36" r="1.1"/><circle cx="57" cy="34" r="1.2"/></g>`);
  },
  clock(id, live = false) {
    // Brass hunter watch; the effect version closes its lid and moves its hands.
    let marks = "";
    for (let hour = 0; hour < 12; hour++) marks += `M${point(hour * Math.PI / 6, hour % 3 ? 28.5 : 26, 50, 58)}L${point(hour * Math.PI / 6, 31, 50, 58)}`;
    const hand = (name, angle, d) => live ? `<path class="hd-hand ${name}" d="${d}"/>` : `<path d="${d}" transform="rotate(${angle} 50 58)"/>`;
    return svg(`<defs>${brass(`${id}b`)}<radialGradient id="${id}f" cx=".45" cy=".4"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#eadcbc"/></radialGradient></defs>`
      + (live ? "" : `<ellipse cx="17" cy="58" rx="11" ry="35" fill="url(#${id}b)" stroke="#5a3a12"/>`)
      + `<circle cx="50" cy="12" r="6" fill="none" stroke="url(#${id}b)" stroke-width="3"/><rect x="45" y="16" width="10" height="7" rx="2" fill="url(#${id}b)" stroke="#5a3a12" stroke-width=".8"/>`
      + `<circle cx="50" cy="58" r="37" fill="url(#${id}b)" stroke="#5a3a12" stroke-width="1.2"/><circle cx="50" cy="58" r="33" fill="url(#${id}f)" stroke="#8a5a1c" stroke-width="1.2"/>`
      + `<path d="${marks}" stroke="#3a2a18" stroke-width="1.4" stroke-linecap="round"/><circle cx="50" cy="71" r="5.5" fill="none" stroke="#8a5a1c" stroke-width=".8"/>`
      + `<g fill="#2a1d10">${hand("hd-hand-h", -60, "M48.6 58 50 39l1.4 19z")}${hand("hd-hand-m", 60, "M49.2 58 50 31l.8 27z")}</g>`
      + `<circle cx="50" cy="58" r="2.4" fill="url(#${id}b)" stroke="#5a3a12" stroke-width=".6"/>`
      + (live ? `<g class="hd-lid"><circle cx="50" cy="58" r="37" fill="url(#${id}b)" stroke="#5a3a12" stroke-width="1.2"/><circle cx="50" cy="58" r="27" fill="none" stroke="#8a5a1c"/>`
        + `<path d="M50 40v36M32 58h36M37 45l26 26M63 45 37 71" stroke="#8a5a1c" stroke-width=".8" opacity=".7"/></g>` : ""));
  },
  blackhole(id) {
    // Compact black hole: photon ring, lensed arc and a tilted accretion disc.
    return svg(`<defs><radialGradient id="${id}g"><stop offset="0" stop-color="#000"/><stop offset=".34" stop-color="#000"/><stop offset=".4" stop-color="#ffd890"/><stop offset=".55" stop-color="#c8682a" stop-opacity=".55"/><stop offset=".8" stop-color="#6a2fa0" stop-opacity=".2"/><stop offset="1" stop-color="#6a2fa0" stop-opacity="0"/></radialGradient>`
      + `<linearGradient id="${id}d" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6a2fa0"/><stop offset=".3" stop-color="#ffcf73"/><stop offset=".5" stop-color="#fff3cf"/><stop offset=".72" stop-color="#e0782e"/><stop offset="1" stop-color="#4a1e70"/></linearGradient></defs>`
      + `<circle cx="50" cy="50" r="48" fill="url(#${id}g)"/><path d="M8 52a42 12 0 0 1 84 0" fill="none" stroke="url(#${id}d)" stroke-width="5" opacity=".75"/>`
      + `<path d="M27 44a24 20 0 0 1 46 0" fill="none" stroke="#ffe3a3" stroke-width="2" opacity=".75"/>`
      + `<circle cx="50" cy="50" r="17" fill="#050308"/><circle cx="50" cy="50" r="18" fill="none" stroke="#ffd78a" stroke-width="1.4" opacity=".9"/>`
      + `<path d="M8 52a42 12 0 0 0 84 0" fill="none" stroke="url(#${id}d)" stroke-width="6.5"/>`
      + `<g fill="#fff4dc"><circle cx="16" cy="22" r=".9"/><circle cx="84" cy="28" r=".7"/><circle cx="78" cy="80" r=".8"/><circle cx="22" cy="78" r=".6"/></g>`);
  },
};

// Separately drawn pieces for the effects; real table objects are never used.
const walnut = svg(`<path d="M50 10c22 0 37 17 37 40S72 90 50 90 13 73 13 50s15-40 37-40z" fill="#a8743f" stroke="#5c3a1a" stroke-width="3"/>`
  + `<path d="M50 13v74M28 30c7 5 7 12 0 17s0 15 7 18m37-35c-7 5-7 12 0 17s0 15-7 18M38 20c2 7 9 7 9 15m15-15c-2 7-9 7-9 15" fill="none" stroke="#6b4422" stroke-width="3" stroke-linecap="round"/>`
  + `<path d="M30 25c5-7 12-10 18-10" fill="none" stroke="#e2b277" stroke-width="3" stroke-linecap="round" opacity=".7"/>`);
const cracks = "l-9-4-6-9-10-2M50 50l8-6 4-10 10-5M50 50l11 3 7 7 11 1M50 50l-3 11-8 6-2 10M50 50l-12 5-8 9";
const crack = svg(`<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M50 50${cracks}" stroke="#1d1009" stroke-width="2.4" opacity=".8"/>`
  + `<path d="M50 50${cracks}" stroke="#f0d6a0" stroke-width=".8" opacity=".45" transform="translate(1 1)"/></g>`);
let spiral = "M50 50", bezel = "";
for (let step = 1; step <= 60; step++) spiral += `L${point(step / 60 * Math.PI * 5, 2 + step / 60 * 46)}`;
for (let hour = 0; hour < 12; hour++) bezel += `M${point(hour * Math.PI / 6, 44)}L${point(hour * Math.PI / 6, 48)}`;
const vortex = svg(`<g fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"><path d="${spiral}" stroke="#f0cf7a" stroke-width="3" opacity=".85" vector-effect="non-scaling-stroke"/>`
  + `<path d="${spiral}" stroke="#8fe3d0" stroke-width="1.5" opacity=".6" transform="rotate(180 50 50)" vector-effect="non-scaling-stroke"/><path d="${bezel}" stroke="#f0cf7a" stroke-width="3" opacity=".7" vector-effect="non-scaling-stroke"/></g>`);
const tentacle = id => svg(`<defs><linearGradient id="${id}t" x1="0" y1="120" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1d2f4a"/><stop offset=".6" stop-color="#3f7f86"/><stop offset="1" stop-color="#7cc4bd"/></linearGradient></defs>`
  + `<g fill="none" stroke="url(#${id}t)" stroke-linecap="round"><path d="M20 120C18 94 26 76 22 58" stroke-width="15"/><path d="M22 58C19 42 30 32 28 21" stroke-width="10"/><path d="M28 21C27 10 16 8 15 15s7 9 10 4" stroke-width="5.5"/></g>`
  + `<g fill="#e9d6bd" opacity=".8"><circle cx="14" cy="104" r="2.4"/><circle cx="15" cy="90" r="2.2"/><circle cx="17" cy="76" r="2"/><circle cx="16.5" cy="63" r="1.8"/><circle cx="17" cy="49" r="1.5"/><circle cx="20.5" cy="37" r="1.2"/></g>`, "0 0 40 120");

export function tableSurpriseArt(effect) {
  return arts[effect]?.(uid()) || "";
}

// Covered area of a table-relative box. Table objects lie above the surprise,
// so they would hide it just like cards and controls.
function coverage(table, box) {
  const blocked = [...table.querySelectorAll(`${guarded}, .hd-table-decor .hd-table-prop:not([hidden])`)]
    .filter(element => !element.closest(".hd-surprise-layer") && (element.classList.contains("hd-table-prop") || !element.closest(".hd-table-decor"))
      && element.getClientRects().length)
    .map(element => element.getBoundingClientRect());
  return (left, top, right, bottom) => blocked.reduce((sum, rect) => sum + Math.max(0, Math.min(rect.right, box.left + right) - Math.max(rect.left, box.left + left))
    * Math.max(0, Math.min(rect.bottom, box.top + bottom) - Math.max(rect.top, box.top + top)), 0);
}

function freeSpot(table, box, size, spots, tall = size, avoid = []) {
  const covered = coverage(table, box);
  const inside = (value, length, extent) => Math.min(Math.max(value, extent / 2), length - extent / 2);
  let best = null;
  // The lower middle is mostly cards on phones. If the preferred story spots
  // are occupied, also search the actual free wood above and beside them.
  const fallback = [.14, .24, .34, .44, .54, .64, .74, .84, .94]
    .flatMap(y => [.5, .35, .65, .2, .8, .08, .92].map(x => [x, y]));
  for (const [fx, fy] of [...spots, ...fallback]) {
    const x = inside(box.width * fx, box.width, size), y = inside(box.height * fy, box.height, tall);
    const left = x - size / 2, top = y - tall / 2, right = x + size / 2, bottom = y + tall / 2;
    const overlap = covered(left, top, right, bottom) + avoid.reduce((sum, rect) => sum
      + Math.max(0, Math.min(rect.right, right) - Math.max(rect.left, left))
      * Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top)), 0);
    if (!overlap) return { x, y };
    // On a crowded table, the least covered spot; the surprise plays underneath.
    if (!best || overlap < best.overlap) best = { x, y, overlap };
  }
  return best;
}

const at = (x, y, width, height = width) => `translate(${(x - width / 2).toFixed(1)}px,${(y - height / 2).toFixed(1)}px)`;
// Ease each step on its own, so keyframe offsets stay real moments in time.
const smooth = frames => frames.map(frame => ({ easing: "ease-in-out", ...frame }));
// Only the pictures of table objects move; their hit boxes stay put.
const decorArts = table => [...table.querySelectorAll(".hd-table-decor .hd-table-prop:not([hidden]) > .hd-prop-art")].slice(0, 14);

function burst({ add, play }, x, y, { count, size, colors, reach, kind = "spark", delay = 0, duration = 800, angle = 0, spread = 360, drop = 0, stagger = 0 }) {
  const full = spread >= 360;
  for (let index = 0; index < count; index++) {
    const spark = add(kind, size);
    spark.style.setProperty("--spark", colors[index % colors.length]);
    const share = full ? index / count : index / Math.max(1, count - 1) - .5;
    const turn = (angle + share * spread + Math.random() * 14 - 7) * Math.PI / 180, far = reach * (.75 + Math.random() * .45);
    const dx = Math.cos(turn) * far, dy = Math.sin(turn) * far;
    play(spark, [{ transform: `${at(x, y, size)} scale(1)`, opacity: 0 }, { opacity: 1, offset: .1 },
      { transform: `${at(x + dx * .85, y + dy * .85 + drop * .3, size)} scale(1)`, opacity: 1, offset: .55 },
      { transform: `${at(x + dx, y + dy + drop, size)} scale(.3)`, opacity: 0 }], { duration, delay: delay + index * stagger, easing: "cubic-bezier(.1,.8,.3,1)" });
  }
}

function star(fx) {
  const { add, play, unit, spot, rich } = fx;
  const { x, y } = spot(unit * 2.2, middle);
  const glow = add("glow", unit * 2.4), ring = add("ring", unit * 1.2), body = add("body", unit * 1.15, unit * 1.15, tableSurpriseArt("star"));
  play(glow, [{ transform: `${at(x, y, unit * 2.4)} scale(.3)`, opacity: 0 }, { opacity: .7, offset: .22 }, { transform: `${at(x, y, unit * 2.4)} scale(1.25)`, opacity: 0 }],
    { duration: 900, easing: "ease-out" });
  play(ring, [{ transform: `${at(x, y, unit * 1.2)} scale(.25)`, opacity: 0 }, { opacity: .95, offset: .12 }, { transform: `${at(x, y, unit * 1.2)} scale(3)`, opacity: 0 }],
    { duration: 950, delay: 200, easing: "cubic-bezier(.15,.75,.3,1)" });
  const place = at(x, y, unit * 1.15);
  play(body, [{ transform: `${place} scale(.2) rotate(-30deg)`, opacity: 0 }, { transform: `${place} scale(1.15) rotate(0deg)`, opacity: 1, offset: .22 },
    { transform: `${place} scale(1) rotate(8deg)`, opacity: 1, offset: .5 }, { transform: `${place} scale(.55) rotate(26deg)`, opacity: 0 }],
  { duration: 1150, easing: "cubic-bezier(.2,.7,.3,1)" });
  burst(fx, x, y, { count: rich ? 14 : 10, size: Math.max(3, unit * .08), colors: ["#f4d27a", "#b49cff", "#fff4d6"], reach: unit * 1.5, delay: 250, duration: 850, drop: unit * .35 });
}

function hammer(fx) {
  const { table, box, add, play, unit, spot, local, extra, timers, rich } = fx;
  const size = unit * 1.45, hit = 420;
  const { x, y } = spot(size * 1.3, middle);
  const split = add("crack", unit * 1.6, unit * 1.6, crack);
  play(split, [{ transform: `${at(x, y, unit * 1.6)} scale(.5)`, opacity: 0 }, { transform: `${at(x, y, unit * 1.6)} scale(1)`, opacity: .9, offset: .08 },
    { opacity: .75, offset: .7 }, { transform: `${at(x, y, unit * 1.6)} scale(1)`, opacity: 0 }], { duration: 680, delay: hit });
  const tool = add("hammer", size, size, tableSurpriseArt("hammer"));
  // The head (40%/31%) lands on the spot; the swing pivots at the pommel.
  tool.style.transformOrigin = "68% 84%";
  const base = `translate(${(x - size * .4).toFixed(1)}px,${(y - size * .31).toFixed(1)}px)`;
  play(tool, [
    { transform: `${base} rotate(22deg) scale(1.35)`, opacity: 0 },
    { transform: `${base} rotate(30deg) scale(1.4)`, opacity: 1, offset: .15, easing: "cubic-bezier(.55,0,1,.5)" },
    { transform: `${base} rotate(0deg) scale(1)`, opacity: 1, offset: .38, easing: "ease-out" },
    { transform: `${base} rotate(-3deg) scale(1.03)`, opacity: 1, offset: .46 },
    { transform: `${base} rotate(0deg) scale(1)`, opacity: 1, offset: .74 },
    { transform: `${base} rotate(6deg) scale(1.08)`, opacity: 0 },
  ], { duration: 1100 });
  const impact = add("impact", unit);
  play(impact, [{ transform: `${at(x, y, unit)} scale(.3)`, opacity: 0 }, { opacity: .85, offset: .06 }, { transform: `${at(x, y, unit)} scale(2.2)`, opacity: 0 }],
    { duration: 520, delay: hit, easing: "ease-out" });
  burst(fx, x, y, { kind: "dust", count: rich ? 6 : 4, size: Math.max(3, unit * .07), colors: ["#d8b27a"], reach: unit * .65, angle: 45, delay: hit, duration: 480 });
  for (const art of decorArts(table)) {
    const rect = art.getBoundingClientRect();
    if (!rect.width) continue;
    const distance = Math.hypot(rect.left + rect.width / 2 - box.left - x, rect.top + rect.height / 2 - box.top - y);
    const amp = Math.max(.6, 2.6 - distance / (unit * 2.5));
    extra.push(art.animate([{ translate: "0 0" }, { translate: `${amp}px ${-amp * .6}px` }, { translate: `${-amp * .8}px ${amp * .4}px` }, { translate: `${amp * .4}px 0` }, { translate: "0 0" }],
      { duration: 240, delay: hit }));
  }
  if (local) timers.push(setTimeout(() => {
    if (document.hidden) return;
    try { navigator.vibrate?.([20, 25, 35]); } catch { /* Haptics are an optional decoration. */ }
  }, hit));
}

function ufo({ box, add, play, unit, spot }) {
  const width = unit * 1.15, nutSize = Math.max(14, unit * .32), column = width * .4 + unit * 1.05 + nutSize / 2;
  // The whole column from saucer to nut is kept clear, not just the nut.
  const middleOf = spot(width, upper, column);
  const hover = { x: middleOf.x, y: middleOf.y - column / 2 + width * .4 }, nut = { x: hover.x, y: hover.y + unit * 1.05 };
  const fromLeft = nut.x < box.width / 2, side = fromLeft ? 1 : -1;
  const enter = fromLeft ? -width : box.width + width, leave = fromLeft ? box.width + width : -width;
  const saucer = add("ufo", width, width, tableSurpriseArt("ufo"));
  play(saucer, [
    { transform: `${at(enter, hover.y - unit * .3, width)} rotate(${side * 10}deg)`, easing: "cubic-bezier(.2,.8,.3,1)" },
    { transform: `${at(hover.x, hover.y, width)} rotate(0deg)`, offset: .3 },
    { transform: `${at(hover.x, hover.y + 2, width)} rotate(${-side * 2}deg)`, offset: .5 },
    { transform: `${at(hover.x, hover.y, width)} rotate(0deg)`, offset: .7, easing: "cubic-bezier(.6,0,.9,.4)" },
    { transform: `${at(leave, hover.y - unit * .7, width)} rotate(${side * 12}deg)` },
  ], { duration: 1400 });
  const top = hover.y + width * .22, bottom = nut.y + nutSize * .5, beamWidth = Math.max(nutSize * 2.2, width * .5);
  const beam = add("beam", beamWidth, Math.max(1, bottom - top));
  beam.style.transformOrigin = "50% 0";
  const beamAt = `translate(${(hover.x - beamWidth / 2).toFixed(1)}px,${top.toFixed(1)}px)`;
  play(beam, [{ transform: `${beamAt} scaleY(0)`, opacity: 0 }, { transform: `${beamAt} scaleY(0)`, opacity: 0, offset: .31 },
    { transform: `${beamAt} scaleY(1)`, opacity: .85, offset: .38 }, { transform: `${beamAt} scaleY(1)`, opacity: .85, offset: .62 },
    { transform: `${beamAt} scaleY(1)`, opacity: 0, offset: .7 }, { transform: `${beamAt} scaleY(1)`, opacity: 0 }], { duration: 1400 });
  const shell = add("nut", nutSize, nutSize, walnut);
  play(shell, [{ transform: `${at(nut.x, nut.y, nutSize)} rotate(0deg) scale(1)`, opacity: 0 }, { opacity: 1, offset: .12 },
    { transform: `${at(nut.x, nut.y, nutSize)} rotate(0deg) scale(1)`, opacity: 1, offset: .38, easing: "cubic-bezier(.4,0,.6,1)" },
    { transform: `${at(nut.x, top + nutSize * .2, nutSize)} rotate(200deg) scale(.55)`, opacity: 1, offset: .62 },
    { transform: `${at(nut.x, top, nutSize)} rotate(220deg) scale(.4)`, opacity: 0, offset: .67 }, { opacity: 0 }], { duration: 1400 });
}

function portal(fx) {
  const { box, add, play, unit, spot, rich } = fx;
  const size = unit * 1.45, nutSize = Math.max(14, unit * .34);
  const from = spot(size, middle, size * .6);
  const apart = middle.filter(([px, py]) => Math.hypot(px * box.width - from.x, py * box.height - from.y) > unit * 2.4);
  const to = spot(size, apart.length ? apart : middle, size * .6,
    [{ left: from.x - size * .75, right: from.x + size * .75, top: from.y - size, bottom: from.y + size }]);
  const gate = (where, delay) => {
    const node = add("portal", size, size, tableSurpriseArt("portal")), place = at(where.x, where.y, size);
    play(node, smooth([{ transform: `${place} scale(0,0) rotate(0deg)`, opacity: 0 }, { transform: `${place} scale(1.12,.52) rotate(-120deg)`, opacity: 1, offset: .14 },
      { transform: `${place} scale(1,.46) rotate(-200deg)`, opacity: 1, offset: .24, easing: "linear" }, { transform: `${place} scale(1,.46) rotate(-560deg)`, opacity: 1, offset: .84 },
      { transform: `${place} scale(0,0) rotate(-680deg)`, opacity: 0 }]), { duration: 1400 - delay, delay });
  };
  gate(from, 0);
  gate(to, 120);
  // A streak of light carries the nut from one gate to the other.
  const left = Math.min(from.x, to.x) - 10, top = Math.min(from.y, to.y) - unit * 1.1, width = Math.abs(to.x - from.x) + 20, height = Math.max(from.y, to.y) - top + 10;
  const arc = add("arc", width, height, svg(`<path d="M${(from.x - left).toFixed(1)} ${(from.y - top).toFixed(1)}Q${((from.x + to.x) / 2 - left).toFixed(1)} 0 ${(to.x - left).toFixed(1)} ${(to.y - top).toFixed(1)}" fill="none" stroke="#d6fff6" stroke-width="3" stroke-linecap="round"/>`,
    `0 0 ${width.toFixed(1)} ${height.toFixed(1)}`));
  arc.style.transform = `translate(${left.toFixed(1)}px,${top.toFixed(1)}px)`;
  const path = arc.querySelector("path"), length = path.getTotalLength(), dash = `${length * .3} ${length * 1.4}`;
  play(path, [{ strokeDasharray: dash, strokeDashoffset: length * .3, opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 1, offset: .8 },
    { strokeDasharray: dash, strokeDashoffset: -length, opacity: 0 }], { duration: 300, delay: 560, easing: "ease-in-out" });
  const shell = add("nut", nutSize, nutSize, walnut), sink = at(from.x, from.y + unit * .06, nutSize), rest = at(to.x, to.y - unit * .05, nutSize);
  play(shell, [
    { transform: `${at(from.x, from.y - unit * .05, nutSize)} scale(1) rotate(0deg)`, opacity: 0 },
    { transform: `${at(from.x, from.y - unit * .05, nutSize)} scale(1) rotate(0deg)`, opacity: 1, offset: .14 },
    { transform: `${at(from.x, from.y - unit * .05, nutSize)} scale(1) rotate(0deg)`, opacity: 1, offset: .26, easing: "cubic-bezier(.5,0,.9,.6)" },
    { transform: `${sink} scale(.25) rotate(220deg)`, opacity: 0, offset: .42 },
    { transform: `${at(to.x, to.y + unit * .06, nutSize)} scale(.25) rotate(220deg)`, opacity: 0, offset: .5, easing: "cubic-bezier(.2,.8,.4,1)" },
    { transform: `${at(to.x, to.y - unit * .6, nutSize)} scale(1.15) rotate(400deg)`, opacity: 1, offset: .62, easing: "cubic-bezier(.5,0,.8,.5)" },
    { transform: `${rest} scale(1) rotate(430deg)`, opacity: 1, offset: .72 },
    { transform: `${rest} scale(1) rotate(430deg)`, opacity: 1, offset: .88 },
    { transform: `${rest} scale(.9) rotate(430deg)`, opacity: 0 },
  ], { duration: 1400 });
  const sparkle = { count: rich ? 7 : 5, size: Math.max(3, unit * .07), colors: ["#7ff3e1", "#b49cff", "#f4fffb"], reach: unit * .8, duration: 600, drop: -unit * .25 };
  burst(fx, from.x, from.y, { ...sparkle, delay: 420 });
  burst(fx, to.x, to.y, { ...sparkle, delay: 720 });
}

function dragon(fx) {
  const { table, box, add, play, unit, spot, rich } = fx;
  const size = unit * 1.5, length = unit * (rich ? 2.8 : 2.3), height = unit * .9;
  const { x, y } = spot(size, sides);
  // Breathe towards the centre unless the other side has more open table.
  const covered = coverage(table, box), mouthY = y - size * .25, toward = x < box.width / 2 ? 1 : -1;
  const blocked = side => {
    const from = x + side * size * .38, to = from + side * length;
    const left = Math.min(from, to), right = Math.max(from, to), top = mouthY - height / 2, bottom = mouthY + height / 2;
    const visible = Math.max(0, Math.min(box.width, right) - Math.max(0, left))
      * Math.max(0, Math.min(box.height, bottom) - Math.max(0, top));
    return covered(left, top, right, bottom) + ((right - left) * height - visible) * 2;
  };
  const dir = blocked(-toward) < blocked(toward) ? -toward : toward, place = at(x, y, size);
  const wyrm = add("dragon", size, size, tableSurpriseArt("dragon"));
  const pose = (scale, turn = 0, shift = 0, rise = 0) => `${place} translate(${dir * shift}px,${rise}px) rotate(${dir * turn}deg) scale(${dir * scale},${scale})`;
  play(wyrm, smooth([{ transform: pose(.5, 0, 0, 8), opacity: 0 }, { transform: pose(1.06, 0, 0, -2), opacity: 1, offset: .12 }, { transform: pose(1), opacity: 1, offset: .2 },
    { transform: pose(1, -7, -3), opacity: 1, offset: .4 }, { transform: pose(1.04, 5, 5), opacity: 1, offset: .48 }, { transform: pose(1, 2, 3), opacity: 1, offset: .74 },
    { transform: pose(1), opacity: 1, offset: .86 }, { transform: pose(.8, 0, 0, 4), opacity: 0 }]), { duration: 1500 });
  // Wings unfold from the shoulder, beat once and fold again.
  const wing = (selector, sign) => play(wyrm.querySelector(selector), smooth([
    { transform: `rotate(${sign * 24}deg) scale(.3)` }, { transform: `rotate(${sign * 24}deg) scale(.3)`, offset: .14 },
    { transform: "rotate(0deg) scale(1.08)", offset: .28 }, { transform: `rotate(${sign * 12}deg) scale(.84)`, offset: .38 },
    { transform: "rotate(0deg) scale(1)", offset: .46 }, { transform: "rotate(0deg) scale(1)", offset: .84 },
    { transform: `rotate(${sign * 20}deg) scale(.4)` }]), { duration: 1500 });
  wing(".hd-wing-a", 1);
  wing(".hd-wing-b", -1);
  const mouth = { x: x + dir * size * .38, y: mouthY };
  const flame = add("breath", length, height);
  flame.style.transformOrigin = "0 50%";
  const start = `translate(${mouth.x.toFixed(1)}px,${(mouth.y - height / 2).toFixed(1)}px) scaleX(${dir}) rotate(8deg)`;
  play(flame, [{ transform: `${start} scale(0,.4)`, opacity: 0 }, { transform: `${start} scale(1,1)`, opacity: .95, offset: .3 },
    { transform: `${start} scale(1.1,1.2)`, opacity: 0 }], { duration: 620, delay: 690, easing: "ease-out" });
  burst(fx, mouth.x, mouth.y, { count: rich ? 14 : 9, size: Math.max(3, unit * .075), colors: ["#ffe08a", "#ffb347", "#fff6dc", "#e9a23b"], reach: length * .95,
    angle: dir > 0 ? 8 : 172, spread: 34, delay: 690, duration: 620, stagger: 12, drop: unit * .15 });
}

function kraken(fx) {
  const { box, add, play, unit, spot, rich } = fx;
  const anchor = spot(unit * 1.6, edges, unit * 2.4);
  const left = anchor.x < box.width / 2, edge = left ? 0 : box.width, base = left ? 90 : -90, inward = left ? 1 : -1;
  [-.8, 0, .75].forEach((offset, index) => {
    const height = unit * (index === 1 ? 2.3 : 1.8) * (rich ? 1.15 : 1), width = height / 3;
    const arm = add("tentacle", width, height, tentacle(uid()));
    arm.style.transformOrigin = "50% 100%";
    const root = `translate(${(edge - width / 2).toFixed(1)}px,${(anchor.y + offset * unit - height).toFixed(1)}px)`;
    const pose = (turn, out) => `${root} rotate(${base + inward * turn}deg) translateY(${(height * out).toFixed(1)}px) scaleX(${index % 2 ? -1 : 1})`;
    play(arm, [{ transform: pose(-6, 1.05) }, { transform: pose(14, .18), offset: .3, easing: "ease-in-out" }, { transform: pose(-10, .1), offset: .5, easing: "ease-in-out" },
      { transform: pose(6, .2), offset: .66, easing: "cubic-bezier(.5,0,.9,.5)" }, { transform: pose(-4, 1.05) }], { duration: 1250, delay: index * 110 });
  });
  // The retreating kraken leaves a shimmering ink bubble that pops.
  const size = unit * .85, inkX = edge + inward * unit * 1.2, inkY = anchor.y + unit * .1, place = at(inkX, inkY, size);
  const ink = add("ink", size);
  play(ink, [{ transform: `${place} scale(.2)`, opacity: 0, filter: "hue-rotate(0deg)" }, { transform: `${place} scale(.2)`, opacity: 0, offset: .52 },
    { transform: `${place} scale(1.12)`, opacity: .95, offset: .62 }, { transform: `${place} scale(.92,1.04)`, opacity: .95, offset: .69 },
    { transform: `${place} scale(1.04,.97)`, opacity: .95, offset: .76 }, { transform: `${place} scale(1)`, opacity: .95, offset: .86 },
    { transform: `${place} scale(1.3)`, opacity: 0, filter: "hue-rotate(80deg)" }], { duration: 1550 });
  burst(fx, inkX, inkY, { kind: "drop", count: rich ? 6 : 4, size: Math.max(3, unit * .09), colors: ["#2b1f4f"], reach: unit * .7, delay: 1330, duration: 220 });
}

function clock(fx) {
  const { table, box, add, play, unit, spot, extra } = fx;
  const size = unit * 1.25;
  const { x, y } = spot(size * 1.2, middle);
  const watch = add("clock", size, size, arts.clock(uid(), true)), place = at(x, y, size);
  play(watch, smooth([{ transform: `${place} scale(.5) rotate(-12deg)`, opacity: 0 }, { transform: `${place} scale(1.06) rotate(3deg)`, opacity: 1, offset: .12 },
    { transform: `${place} scale(1) rotate(0deg)`, opacity: 1, offset: .2 }, { transform: `${place} scale(1) rotate(0deg)`, opacity: 1, offset: .82 },
    { transform: `${place} scale(.85) rotate(6deg)`, opacity: 0 }]), { duration: 1450 });
  play(watch.querySelector(".hd-lid"), [{ transform: "scaleX(1)" }, { transform: "scaleX(1)", offset: .12, easing: "ease-out" },
    { transform: "scaleX(-.42)", offset: .26 }, { transform: "scaleX(-.42)", offset: .84 }, { transform: "scaleX(.2)" }], { duration: 1450 });
  for (const [selector, from, to] of [[".hd-hand-m", 60, 780], [".hd-hand-h", -60, 0]]) {
    play(watch.querySelector(selector), [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from}deg)`, offset: .26, easing: "cubic-bezier(.55,0,.35,1)" },
      { transform: `rotate(${to}deg)`, offset: .7 }, { transform: `rotate(${to}deg)` }], { duration: 1450 });
  }
  // A time swirl sweeps the whole table; table objects sway as it passes.
  const reach = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y)), swirlSize = reach * 2;
  const swirl = add("vortex", swirlSize, swirlSize, vortex), swirlAt = at(x, y, swirlSize);
  play(swirl, [{ transform: `${swirlAt} scale(.06) rotate(0deg)`, opacity: 0 }, { transform: `${swirlAt} scale(.3) rotate(-70deg)`, opacity: .9, offset: .25 },
    { transform: `${swirlAt} scale(1) rotate(-220deg)`, opacity: 0 }], { duration: 900, delay: 520, easing: "cubic-bezier(.3,.5,.5,1)" });
  for (const art of decorArts(table)) {
    const rect = art.getBoundingClientRect();
    if (!rect.width) continue;
    const distance = Math.hypot(rect.left + rect.width / 2 - box.left - x, rect.top + rect.height / 2 - box.top - y);
    extra.push(art.animate([{ rotate: "0deg" }, { rotate: "8deg" }, { rotate: "-5deg" }, { rotate: "0deg" }],
      { duration: 420, delay: Math.min(1020, 560 + distance / reach * 700), easing: "ease-in-out" }));
  }
}

function blackhole(fx) {
  const { add, play, unit, spot, rich } = fx;
  const size = unit * 1.45;
  const { x, y } = spot(size * 2, middle);
  const hole = add("hole", size, size, tableSurpriseArt("blackhole")), place = at(x, y, size);
  play(hole, smooth([{ transform: `${place} scale(0) rotate(-20deg)`, opacity: 0 }, { transform: `${place} scale(1.08) rotate(-6deg)`, opacity: 1, offset: .16 },
    { transform: `${place} scale(1) rotate(0deg)`, opacity: 1, offset: .24 }, { transform: `${place} scale(.86) rotate(10deg)`, opacity: 1, offset: .6, easing: "cubic-bezier(.3,1.6,.5,1)" },
    { transform: `${place} scale(1.18) rotate(12deg)`, opacity: 1, offset: .68 }, { transform: `${place} scale(.25) rotate(40deg)`, opacity: 0 }]), { duration: 1500 });
  // Crumbs spiral into the disc, which lies flat on the table.
  const crumbs = rich ? 10 : 7;
  for (let index = 0; index < crumbs; index++) {
    const grain = Math.max(4, unit * (.08 + index % 3 * .025)), crumb = add("crumb", grain);
    const start = index / crumbs * Math.PI * 2 + Math.random() * .5, far = unit * (1.3 + Math.random() * .7);
    play(crumb, [0, .2, .5, .78, 1].map((offset, step) => {
      const t = step / 4, turn = start + t * 2.4, radius = far * (1 - t) ** 1.3 + unit * .3 * t;
      return { offset, opacity: step && step < 4 ? 1 : 0,
        transform: `${at(x + Math.cos(turn) * radius, y + Math.sin(turn) * radius * (1 - t * .6), grain)} scale(${1 - t * .7}) rotate(${t * 300}deg)` };
    }), { duration: 820, delay: 150 + index * 25, easing: "cubic-bezier(.45,0,.75,.6)" });
  }
  // ...and a small star escapes.
  const ring = add("ring", unit * .8), little = unit * .6, spark = add("body", little, little, tableSurpriseArt("star"));
  play(ring, [{ transform: `${at(x, y, unit * .8)} scale(.3)`, opacity: 0 }, { opacity: .9, offset: .1 }, { transform: `${at(x, y, unit * .8)} scale(2.6)`, opacity: 0 }],
    { duration: 480, delay: 990, easing: "ease-out" });
  play(spark, [{ transform: `${at(x, y, little)} scale(0) rotate(-40deg)`, opacity: 0 }, { transform: `${at(x, y - unit * .55, little)} scale(1.3) rotate(0deg)`, opacity: 1, offset: .35 },
    { transform: `${at(x, y - unit * .7, little)} scale(1) rotate(15deg)`, opacity: 1, offset: .7 }, { transform: `${at(x, y - unit * .85, little)} scale(.8) rotate(25deg)`, opacity: 0 }],
  { duration: 500, delay: 990, easing: "cubic-bezier(.2,.8,.3,1)" });
}

// Reduced motion: the symbol only fades in and out where it would have played.
function quiet({ add, play, unit, spot }, effect) {
  const { x, y } = spot(unit * 1.2, middle);
  const symbol = add("quiet", unit, unit, tableSurpriseArt(effect));
  symbol.style.transform = at(x, y, unit);
  play(symbol, [{ opacity: 0 }, { opacity: .9, offset: .25 }, { opacity: .9, offset: .7 }, { opacity: 0 }], { duration: 1000 });
}

const effects = { star, hammer, ufo, portal, dragon, kraken, clock, blackhole };

export function playTableSurprise(table, effect, { local = false } = {}) {
  active.get(table)?.();
  if (!table?.isConnected || !effects[effect] || document.hidden) return noop;
  const layer = document.createElement("div");
  layer.className = "hd-surprise-layer";
  layer.setAttribute("aria-hidden", "true");
  table.append(layer);
  const box = layer.getBoundingClientRect();
  if (!box.width || !box.height) { layer.remove(); return noop; }
  const own = [], extra = [], timers = [];
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    for (const animation of [...own, ...extra]) animation.cancel();
    layer.remove();
    if (active.get(table) === cleanup) active.delete(table);
  };
  active.set(table, cleanup);
  const add = (kind, width, height = width, html = "") => {
    const node = document.createElement("div");
    node.className = `hd-surprise-node hd-surprise-${kind}`;
    node.setAttribute("aria-hidden", "true");
    node.style.width = `${width.toFixed(1)}px`;
    node.style.height = `${height.toFixed(1)}px`;
    node.innerHTML = html;
    layer.append(node);
    return node;
  };
  const play = (node, frames, options) => { own.push(node.animate(frames, { fill: "both", ...options })); };
  const unit = Math.round(Math.max(40, Math.min(76, Math.min(box.width, box.height) * .14)));
  const fx = { table, box, add, play, unit, local, extra, timers, rich: box.width >= 700, spot: (...args) => freeSpot(table, box, ...args) };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) quiet(fx, effect);
  else effects[effect](fx);
  // Any finish or outside cancel ends the whole surprise.
  Promise.all(own.map(animation => animation.finished)).then(cleanup, cleanup);
  return cleanup;
}
