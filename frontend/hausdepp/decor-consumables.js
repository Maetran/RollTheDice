// The untouched photograph is the full serving. Once somebody takes a sip or
// a bite, its separate photographic pieces sit on a permanent empty vessel.
// Nothing is painted into a canvas: the atlas stays crisp at every table size.
const mounted = new WeakMap();
let serial = 0;
const svgStart = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">';
const ellipse = (x, y, rx, ry) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 -${rx * 2} 0`;

const foods = {
  nuts: {
    bowl: [46, 40, 33, 28], colors: ["#382717", "#826547", "#b6a080"],
    remove: `${ellipse(46, 40, 33, 29)} M58 69H100V100H58Z`,
    outline: ellipse(46, 39, 37, 37),
    pieces: [
      "M74 74Q81 72 84 80Q83 90 76 91Q70 85 74 74Z",
      "M60 72Q68 67 73 73Q74 80 65 83Q57 82 57 78Z",
      "M79 56Q91 52 96 64Q96 75 82 77L74 68Z",
      "M81 42Q90 40 96 50Q98 59 89 59L78 51Z",
      "M34 60L44 57L51 63L48 69L36 70Z",
      "M46 46Q57 42 62 53L58 63L48 64L40 56Z",
      "M18 45L29 44L40 51L39 61L29 67L16 57Z",
      "M61 37L74 34L79 44L75 57L62 62L57 51Z",
      "M28 30L42 29L51 38L47 50L34 51L24 42Z",
      "M53 21L65 18L73 26L74 37L65 45L51 36Z",
      "M29 15L40 13L50 15L57 22L51 33L36 31L28 23Z",
      "M20 20L30 19L35 29L29 42L18 49L12 40L15 28Z",
    ],
  },
  chips: {
    bowl: [47, 37, 37, 22], colors: ["#544d3c", "#a49a7d", "#e4dfcb"],
    remove: `M0 0H100V37H0Z ${ellipse(47, 37, 37, 22)} M43 64H100V100H43Z`,
    outline: "M9 34Q7 18 45 14Q83 14 88 34L80 56Q75 72 45 76Q18 73 12 56Z",
    pieces: [
      "M72 66Q86 58 95 69L99 86Q86 87 73 78Z",
      "M46 76Q57 64 71 70L80 87Q71 98 57 95L44 87Z",
      "M53 32Q70 18 77 30L79 46L68 58L57 54Z",
      "M31 36Q43 27 51 37L59 54L48 59L33 52Z",
      "M15 29Q25 20 35 23L42 39L33 49L16 45Z",
      "M43 18Q55 8 67 14L76 26L65 36L50 33Z",
      "M19 12Q29 4 42 11L48 26L34 35L18 27Z",
      "M27 4Q43 -1 57 6L54 17L41 24L25 20Z",
    ],
  },
  flips: {
    bowl: [46, 38, 36, 23], colors: ["#09271c", "#224e3e", "#659279"],
    remove: `M0 0H100V37H0Z ${ellipse(46, 38, 36, 23)} M58 49H100V100H58Z`,
    outline: "M8 34Q8 11 46 11Q84 11 87 35L80 58Q74 74 46 76Q18 73 12 56Z",
    pieces: [
      "M57 75Q64 70 73 80Q84 83 92 74L97 80Q93 94 80 95Q64 95 57 85Z",
      "M72 61Q78 66 81 56Q86 45 92 51Q96 56 89 69Q84 80 73 77Z",
      "M39 46Q46 43 52 50Q56 57 48 60L36 57L32 51Z",
      "M55 38Q60 32 65 39Q65 51 56 58L47 57Q53 49 55 38Z",
      "M19 42Q25 38 31 43L39 53Q38 61 28 57L19 51Z",
      "M65 32Q73 27 79 34L79 44Q73 51 66 44Z",
      "M28 24Q32 18 37 24Q43 32 36 38L24 43Q17 42 18 35Z",
      "M44 26Q50 20 57 25L64 33Q64 40 53 42L43 36Z",
      "M16 25Q15 17 23 16L31 20L28 28L20 33Z",
      "M28 14Q29 8 38 11L43 20Q45 27 37 31L30 28Z M44 16Q47 7 56 13Q61 19 55 25L47 25Z M59 20Q66 12 73 21L74 29L64 32Z",
    ],
  },
  sweets: {
    bowl: [39, 45, 27, 28], colors: ["#35180f", "#6e3920", "#ac714b"],
    remove: ellipse(39, 45, 27, 28),
    outline: "M12 30Q23 15 40 17Q64 20 70 43Q73 66 58 77Q38 89 19 73Q5 57 12 30Z",
    pieces: [
      "M70 29H97V56H70Z", "M70 54H100V85H70Z",
      "M23 54L30 52L36 61L30 70L23 68L20 61Z",
      "M34 55L42 53L48 66L44 73L36 71L33 63Z",
      "M47 55L55 51L61 61L56 69L49 68Z",
      "M48 38L57 36L64 45L63 53L55 57L48 51Z",
      "M34 42L42 39L49 46L48 57L41 63L35 54Z",
      "M25 37L32 33L37 40L36 52L30 59L23 54Z",
      "M15 36L21 32L28 38L25 48L17 49L14 42Z M22 26L29 25L36 31L30 39L23 37Z",
      "M32 24L36 22L42 28L48 24L56 29L58 36L49 43L40 37L33 34Z",
    ],
  },
  marend: {
    board: true, remove: "M17 13L64 7L84 12L91 36L86 55L72 71L50 79L29 72L11 61L5 43Z",
    pieces: [
      "M35 55Q39 53 44 57L54 67Q60 73 55 75Q48 76 42 69L35 62Q32 58 35 55Z",
      "M44 51Q49 48 54 53L65 61Q72 68 66 70Q62 73 57 68L49 62L43 57Q41 53 44 51Z",
      "M76 14Q82 16 86 26Q92 44 84 54L77 57L74 52Q83 47 81 34Z",
      "M71 9Q78 9 81 19Q88 38 80 49L74 53L69 49Q77 43 75 28Z",
      "M67 9Q72 6 76 14Q82 31 77 44Q74 49 68 51L66 45L69 44L64 32Q62 18 67 9Z",
      "M49 11L59 6Q61 6 62 10L64 29L55 34L49 28Z",
      "M55 23Q56 21 58 24L74 48Q75 49 73 50L62 55L47 43Z",
      "M49 46L63 41Q65 41 66 44L73 63Q74 66 71 65Z",
      "M22 15Q29 12 34 10Q43 8 47 15L49 27Q47 33 41 38L29 36Q24 33 17 32L13 26Q12 21 18 20Z",
      "M8 36Q14 32 20 31Q26 25 31 27L38 35L45 38Q50 44 48 50L43 52Q39 50 35 55L33 60L40 69Q36 73 31 73L22 66Q15 67 12 63L16 54L10 50Q5 46 6 40Z",
    ],
  },
  pretzel: {
    napkin: true, remove: "M27 27Q39 17 58 23L74 29Q87 31 91 48L93 69Q89 84 72 88L48 87Q29 82 25 68L21 49Z",
    pieces: [
      "M48 58L65 55L76 73L72 91L49 89L39 76Z",
      "M71 52L90 45L96 69L89 83L70 91L70 75Z",
      "M57 37L75 27L86 32L94 49L78 65L68 59Z",
      "M28 51L45 47L55 59L45 73L49 88L31 80L23 65Z",
      "M22 35L40 25L49 37L42 53L25 66L19 48Z",
      "M39 19L61 20L78 28L66 45L52 46L43 37L34 32Z",
    ],
  },
  "loose-nuts": { pieces: ["M58 4H98V49H58Z", "M60 49H100V100H60Z", "M0 16H62V89H0Z"] },
  "loose-chips": { pieces: ["M0 48L48 31L76 62L50 100H0Z", "M36 0H100V77L67 68L42 45Z"] },
  "loose-flips": { pieces: ["M33 0H100V58L68 72L35 62Z", "M0 46L36 45L62 63L100 62V100H0Z"] },
  "praline-gold": { pieces: ["M0 0H100V100H0Z"] },
  "praline-red": { pieces: ["M0 0H100V100H0Z"] },
};

// These are individual photographs from the existing scatter atlas. Drawing
// the same arrangement from the first frame means every tap removes exactly
// one intact snack; no other food jumps or acquires a straight clipped edge.
const snackSources = {
  walnut: { sheet: "scatter", cell: 5, bounds: [0, 20, 63, 66], path: "M0 20H63V86H0Z" },
  peanut: { sheet: "scatter", cell: 5, bounds: [62, 0, 38, 50], path: "M62 0H100V50H62Z" },
  rednut: { sheet: "scatter", cell: 5, bounds: [62, 50, 38, 50], path: "M62 50H100V100H62Z" },
  chip: { sheet: "scatter", cell: 6, bounds: [4, 39, 65, 44], path: "M6 53Q12 48 26 47Q39 45 48 39Q57 42 62 51Q70 58 65 67Q57 77 42 81Q25 85 12 77Q5 68 6 53Z" },
  flip: { sheet: "scatter", cell: 7, bounds: [35, 8, 63, 60], path: "M84 9Q101 12 96 27L87 45Q78 61 60 65Q43 66 37 54Q36 47 44 42Q56 47 65 38L72 19Q75 9 84 9Z" },
  bear: { sheet: "evening", cell: 1, bounds: [24, 37, 16, 25], path: "M29 39Q31 37 34 40L35 45Q40 45 38 49L36 53Q40 57 36 60L33 58Q29 61 26 58L27 53Q24 52 26 48L28 46L27 43Q26 40 29 39Z" },
  gold: { sheet: "scatter", cell: 2, bounds: [0, 0, 100, 100], path: "M0 0H100V100H0Z" },
  red: { sheet: "scatter", cell: 3, bounds: [0, 0, 100, 100], path: "M0 0H100V100H0Z" },
};
const snack = (source, x, y, width, turn = 0, filter = "") => ({ source, x, y, width, turn, filter });
const servings = {
  nuts: [
    snack("rednut", 77, 80, 10, 20), snack("peanut", 66, 75, 12, 65), snack("walnut", 87, 64, 18, -12), snack("peanut", 87, 50, 12, -25),
    snack("walnut", 30, 55, 21, -12), snack("peanut", 48, 57, 14, 65), snack("peanut", 60, 56, 14, -35), snack("rednut", 67, 46, 13, 20),
    snack("peanut", 24, 40, 15, 25), snack("peanut", 39, 44, 16, 80), snack("walnut", 61, 32, 21, 15), snack("rednut", 42, 28, 12, -20),
    snack("peanut", 31, 25, 15, 70), snack("peanut", 49, 19, 13, -20), snack("peanut", 52, 43, 14, 75), snack("rednut", 34, 36, 11, 25),
  ],
  chips: [
    snack("chip", 72, 80, 25, -12), snack("chip", 88, 70, 23, 30),
    snack("chip", 30, 42, 27, 15), snack("chip", 50, 44, 28, -15), snack("chip", 65, 40, 26, 45), snack("chip", 39, 33, 30, -30),
    snack("chip", 59, 30, 29, 20), snack("chip", 30, 25, 27, 45), snack("chip", 50, 20, 29, 65), snack("chip", 43, 13, 30, 20),
  ],
  flips: [
    snack("flip", 74, 83, 30, 75), snack("flip", 84, 65, 24, -5),
    snack("flip", 26, 46, 22, 100), snack("flip", 44, 49, 23, 45), snack("flip", 63, 45, 23, -10), snack("flip", 32, 36, 25, -25),
    snack("flip", 54, 37, 24, 65), snack("flip", 69, 33, 20, 140), snack("flip", 22, 29, 22, 140), snack("flip", 42, 25, 24, 100),
    snack("flip", 57, 22, 22, 10), snack("flip", 38, 18, 23, -15),
  ],
  sweets: [
    snack("gold", 82, 43, 24), snack("red", 83, 68, 25),
    snack("bear", 27, 60, 12, -25, "sepia(1) saturate(3) hue-rotate(45deg) brightness(.75)"),
    snack("bear", 41, 65, 12, -10, "sepia(1) saturate(5) hue-rotate(355deg)"),
    snack("bear", 52, 60, 12, 20, "sepia(1) saturate(4) hue-rotate(310deg) brightness(.7)"),
    snack("bear", 57, 49, 12, -40, "sepia(1) saturate(3) hue-rotate(45deg) brightness(.75)"),
    snack("bear", 44, 50, 12, -15, "sepia(1) saturate(4) hue-rotate(310deg) brightness(.7)"),
    snack("bear", 31, 48, 12, 15),
    snack("bear", 20, 45, 12, 20, "sepia(1) saturate(4) hue-rotate(310deg) brightness(.7)"),
    snack("bear", 31, 36, 12, -25, "sepia(1) saturate(3) hue-rotate(45deg) brightness(.75)"),
    snack("bear", 43, 38, 12, 40, "sepia(1) saturate(5) hue-rotate(355deg)"),
    snack("bear", 54, 36, 12, 55, "sepia(1) saturate(5) hue-rotate(355deg)"),
    snack("bear", 40, 28, 12, -30, "sepia(1) saturate(4) hue-rotate(310deg) brightness(.7)"),
    snack("bear", 50, 30, 12, 55, "sepia(1) saturate(4) hue-rotate(310deg) brightness(.7)"),
  ],
};

const drinks = {
  beer: {
    opening: [49, 33, 27, 23], levels: [83, 73, 60, 47, 33], width: [20, 22, 24, 25, 27], depth: [7, 8, 9, 11, 19],
    body: "M22 32C21 17 34 8 49 8C65 8 78 18 78 34L75 72Q72 88 51 89Q29 89 25 74Z",
    empty: "M25 32Q25 54 29 77Q34 86 51 87Q68 85 72 75L75 32",
    support: '<ellipse cx="50" cy="77" rx="32" ry="21" fill="#d9c8a2"/><ellipse cx="50" cy="77" rx="28" ry="18" fill="#e3d9bb" stroke="#984c34" stroke-width="1.7"/><ellipse cx="50" cy="77" rx="24" ry="14.5" fill="none" stroke="#a3593b" stroke-width=".8"/>',
    light: "#f0fcdf", dark: "#6c8361", liquid: ["#f4c156", "#d8951a", "#9c5d06"], textureTop: 59,
  },
  tea: {
    opening: [48, 29, 27, 17], levels: [62, 55, 47, 39, 29], width: [16, 18, 21, 24, 26], depth: [5, 6, 7, 9, 15],
    body: "M21 27C20 13 34 9 49 9C65 9 77 17 77 29L70 50Q65 64 48 65Q31 64 27 51Z",
    empty: "M24 28L29 50Q33 61 48 62Q62 61 67 50L74 28",
    support: '<ellipse cx="48" cy="55" rx="29" ry="20" fill="#e9dfc3"/><ellipse cx="48" cy="55" rx="23" ry="15" fill="#eee5d0" stroke="#cabfa1" stroke-width=".5"/>',
    light: "#f7ffff", dark: "#7c8475", liquid: ["#d9992e", "#9f460b", "#5e2708"], textureTop: 46,
  },
  lemonade: {
    opening: [53, 8, 6, 1.5], levels: [86, 76, 61, 45, 33], width: [10, 12, 13, 14, 13], depth: [2, 2.5, 3, 3, 3],
    centers: [32, 32, 37, 42, 44],
    body: "M49 6L60 8L56 27Q59 36 57 45L49 81Q48 88 43 88L24 84Q17 82 19 75L29 40Q32 31 38 25L45 10Z",
    removeBody: "M44 0H65V14L60 30L61 44L53 88L43 92L15 85L16 73L26 38L37 22Z",
    empty: "M48 10L44 25Q35 34 33 42L23 76Q21 79 25 81M57 10L53 28Q56 37 53 46L46 80Q45 84 42 84",
    support: "", light: "#d6e8a4", dark: "#3f633b", liquid: ["#f6df6d", "#d3b33c", "#a78a24"], textureTop: 77,
    // The label, crown and little accessories are always the original photo.
    preserved: "M29.5 41.5L56.2 48L49.5 71.6L22.5 65Z M46 0H64V10H46Z M65 0H100V100H65Z",
  },
};

function svg(markup) {
  const template = document.createElement("template");
  template.innerHTML = `${svgStart}${markup}</svg>`;
  return template.content.firstElementChild;
}

function mask(element, path, subtract = false, outline = "M0 0H100V100H0Z") {
  // Paint each cut separately: neighbouring outlines may wind in opposite
  // directions, but their overlap must still be removed from the photograph.
  const cuts = subtract ? path.match(/M[^M]*/g).map(cut => `<path fill="black" d="${cut}"/>`).join("") : "";
  const source = subtract
    ? `${svgStart}<defs><mask id="cut"><path d="${outline}" fill="white"/>${cuts}</mask></defs><rect width="100" height="100" fill="white" mask="url(#cut)"/></svg>`
    : `${svgStart}<path fill="white" d="${path}"/></svg>`;
  const value = `url("data:image/svg+xml,${encodeURIComponent(source)}")`;
  element.style.maskImage = value;
  element.style.webkitMaskImage = value;
}

function photo(state, className) {
  const layer = document.createElement("span");
  layer.className = `hd-consumable-photo ${className}`;
  layer.style.backgroundImage = state.image;
  layer.style.backgroundSize = state.size;
  layer.style.backgroundPosition = state.position;
  return layer;
}

function bowlArt(config, id) {
  const [x, y, rx, ry] = config.bowl;
  const [dark, mid, light] = config.colors;
  const depth = ry < 25 ? 18 : 7;
  const bottom = y + ry + depth;
  return `<defs><radialGradient id="${id}" cx="50%" cy="68%" r="70%"><stop stop-color="${mid}"/><stop offset=".68" stop-color="${dark}"/><stop offset="1" stop-color="${mid}"/></radialGradient><linearGradient id="${id}Body"><stop stop-color="${dark}"/><stop offset=".18" stop-color="${mid}"/><stop offset=".38" stop-color="${light}"/><stop offset=".65" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>`
    + `<path d="M${x - rx} ${y}Q${x - rx + 1} ${bottom} ${x} ${bottom}Q${x + rx - 1} ${bottom} ${x + rx} ${y}Z" fill="url(#${id}Body)" stroke="${dark}" stroke-width=".6"/>`
    + Array.from({ length: 7 }, (_, index) => { const offset = (index - 3) * rx * .22; return `<path d="M${x + offset} ${y + ry * .75}Q${x + offset * .82} ${bottom - 4} ${x + offset * .7} ${bottom - .8}" fill="none" stroke="${light}" stroke-opacity=".13" stroke-width="1.1"/>`; }).join("")
    + `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${id})" stroke="${light}" stroke-width="1.4"/>`
    + `<ellipse cx="${x}" cy="${y + 1}" rx="${rx - 2}" ry="${ry - 1.7}" fill="none" stroke="${dark}" stroke-width="1.2"/>`
    + `<path d="M${x - rx + 5} ${y + 9}Q${x} ${y + ry + 4} ${x + rx - 5} ${y + 9}" fill="none" stroke="${light}" stroke-opacity=".22" stroke-width=".7"/>`;
}

function boardArt(id) {
  return `<defs><radialGradient id="${id}"><stop stop-color="#80603e"/><stop offset="1" stop-color="#5c3d26"/></radialGradient><pattern id="${id}Grain" width="17" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-21)"><path d="M0 1Q8 -1 17 1M0 5Q7 8 17 5M0 8Q9 6 17 8" fill="none" stroke="#2f1b0f" stroke-opacity=".17" stroke-width=".22"/><path d="M0 3Q8 5 17 3" fill="none" stroke="#c09866" stroke-opacity=".19" stroke-width=".25"/></pattern></defs>`
    + `<ellipse cx="48" cy="45" rx="46" ry="38" transform="rotate(-15 48 45)" fill="url(#${id})"/><ellipse cx="48" cy="45" rx="46" ry="38" transform="rotate(-15 48 45)" fill="url(#${id}Grain)"/>`;
}

function napkinArt(id) {
  return `<defs><linearGradient id="${id}" x2="1" y2="1"><stop stop-color="#ede8db"/><stop offset=".45" stop-color="#f7f2e7"/><stop offset="1" stop-color="#d5cfc0"/></linearGradient><pattern id="${id}Weave" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M0 0H2M0 0V2" stroke="#736b58" stroke-opacity=".08" stroke-width=".22"/></pattern></defs>`
    + `<path d="M26 11L95 24L87 95L11 82Z" fill="url(#${id})"/><path d="M26 11L95 24L87 95L11 82Z" fill="url(#${id}Weave)"/><path d="M28 14L24 72L85 87M21 81L77 87" fill="none" stroke="#aaa18e" stroke-opacity=".23" stroke-width=".5"/>`;
}

function mountFood(art, prop, state) {
  const config = foods[prop];
  const container = document.createElement("span");
  container.className = "hd-consumable-container";
  if (config.remove) {
    const structure = photo(state, "hd-food-vessel");
    mask(structure, config.remove, true, config.outline);
    const ground = svg(config.bowl ? bowlArt(config, state.id) : config.board ? boardArt(state.id) : napkinArt(state.id));
    ground.classList.add("hd-food-ground");
    container.append(ground);
    if (!config.napkin && !["chips", "flips"].includes(prop)) container.append(structure);
  }
  art.append(container);
  state.reconstructed = Boolean(servings[prop]);
  state.pieces = (servings[prop] || config.pieces).map((portion, index) => {
    const piece = photo(state, "hd-food-piece");
    piece.dataset.piece = String(index);
    if (state.reconstructed) {
      const source = snackSources[portion.source];
      const [x, y, width, height] = source.bounds;
      const scale = portion.width / width;
      const columns = source.sheet === "scatter" ? 4 : 2, rows = source.sheet === "scatter" ? 3 : 2;
      const suffix = source.sheet === "scatter" ? "scatter" : "evening";
      piece.style.backgroundImage = `url("/static/hausdepp-table-props-${suffix}-v1.webp")`;
      piece.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
      piece.style.backgroundPosition = `${source.cell % columns / (columns - 1) * 100}% ${Math.floor(source.cell / columns) / (rows - 1) * 100}%`;
      piece.style.inset = "auto";
      piece.style.width = `${scale * 100}%`;
      piece.style.height = `${scale * 100}%`;
      piece.style.left = `${portion.x - scale * (x + width / 2)}%`;
      piece.style.top = `${portion.y - scale * (y + height / 2)}%`;
      piece.style.transformOrigin = `${x + width / 2}% ${y + height / 2}%`;
      piece.style.transform = `rotate(${portion.turn}deg)`;
      piece.style.filter = `drop-shadow(0 .6px .6px #180c0770) ${portion.filter}`;
      mask(piece, source.path);
    } else mask(piece, portion);
    art.append(piece);
    return piece;
  });
  state.keepsContainer = Boolean(config.remove);
  state.original = photo(state, "hd-consumable-original");
  state.composed = state.reconstructed || prop === "marend";
  state.original.hidden = state.composed;
  art.append(state.original);
  art.dataset.portions = String(state.pieces.length);
  art.dataset.remaining = String(state.pieces.length);
  return { portions: state.pieces.length, keepsContainer: state.keepsContainer };
}

function glassArt(config, id) {
  const [x, y, rx, ry] = config.opening;
  return `<defs><linearGradient id="${id}Glass"><stop stop-color="${config.light}" stop-opacity=".3"/><stop offset=".14" stop-color="${config.light}" stop-opacity=".06"/><stop offset=".55" stop-color="${config.light}" stop-opacity=".025"/><stop offset=".84" stop-color="${config.dark}" stop-opacity=".13"/><stop offset="1" stop-color="${config.light}" stop-opacity=".4"/></linearGradient></defs>`
    + config.support
    + `<path d="${config.body}" fill="url(#${id}Glass)" stroke="${config.dark}" stroke-opacity=".34" stroke-width=".4"/>`
    + `<path d="${config.empty}" fill="none" stroke="${config.light}" stroke-opacity=".48" stroke-width=".55"/>`
    + `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${config.dark}" stroke-opacity=".34" stroke-width=".6"/>`
    + `<ellipse cx="${x}" cy="${y - .4}" rx="${rx - .5}" ry="${ry - .5}" fill="none" stroke="#fffce3" stroke-opacity=".48" stroke-width=".35"/>`;
}

function mountDrink(art, prop, state) {
  const config = drinks[prop];
  const container = document.createElement("span");
  container.className = "hd-consumable-container";
  const structure = photo(state, "hd-drink-vessel");
  mask(structure, config.removeBody || config.body, true);
  container.append(svg(glassArt(config, state.id)), structure);
  state.container = container;
  art.append(container);
  const liquid = document.createElement("span");
  liquid.className = "hd-drink-liquid";
  const [light, mid, dark] = config.liquid;
  liquid.append(svg(`<defs><linearGradient id="${state.id}Liquid" x1="0" x2="1" y2=".7"><stop stop-color="${dark}"/><stop offset=".2" stop-color="${light}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><path d="${config.body}" fill="url(#${state.id}Liquid)" fill-opacity=".86"/>`));
  const texture = photo(state, "hd-drink-texture");
  mask(texture, config.body);
  texture.style.clipPath = `inset(${config.textureTop}% 0 0)`;
  liquid.append(texture);
  state.liquid = liquid;
  const surface = svg(`<defs><radialGradient id="${state.id}Surface"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></radialGradient></defs><ellipse class="hd-drink-surface" fill="url(#${state.id}Surface)" stroke="${light}" stroke-opacity=".8" stroke-width=".55"/><path class="hd-drink-surface-shine" fill="none" stroke="#fff3ca" stroke-opacity=".52" stroke-width=".5"/>`);
  surface.classList.add("hd-drink-meniscus");
  state.surface = surface;
  art.append(liquid, surface);
  const front = svg(`<path d="${config.empty}" fill="none" stroke="${config.light}" stroke-opacity=".38" stroke-width="1.2"/>`);
  front.classList.add("hd-drink-glint");
  state.front = front;
  art.append(front);
  if (config.preserved) {
    const label = photo(state, "hd-drink-label");
    mask(label, config.preserved);
    art.append(label);
  }
  state.original = photo(state, "hd-consumable-original");
  art.append(state.original);
  updateDrink(art, 4);
  return { portions: 0, keepsContainer: true };
}

/** Call once after the atlas background position and size have been assigned. */
export function mountConsumable(art, prop) {
  if (!foods[prop] && !drinks[prop]) return null;
  if (mounted.has(art)) {
    const state = mounted.get(art);
    return { portions: state.pieces?.length || 0, keepsContainer: state.keepsContainer ?? true };
  }
  const computed = getComputedStyle(art);
  const state = { prop, id: `hdServing${++serial}`, image: computed.backgroundImage,
    size: art.style.backgroundSize, position: art.style.backgroundPosition };
  mounted.set(art, state);
  art.classList.add("hd-consumable");
  art.dataset.consumable = drinks[prop] ? "drink" : "food";
  const result = drinks[prop] ? mountDrink(art, prop, state) : mountFood(art, prop, state);
  art.style.backgroundImage = "none";
  return result;
}

/** 4 = full, 0 = empty. The glass and label never fade with the liquid. */
export function updateDrink(art, level, flat = false) {
  const state = mounted.get(art);
  if (!state || !drinks[state.prop]) return;
  const config = drinks[state.prop];
  const amount = Math.max(0, Math.min(4, Math.round(level)));
  art.dataset.drinkLevel = String(amount);
  state.original.hidden = amount !== 4 || (state.prop === "beer" && flat);
  state.liquid.hidden = amount === 0;
  state.surface.toggleAttribute("hidden", amount === 0);
  state.container.hidden = !state.original.hidden;
  state.front.toggleAttribute("hidden", !state.original.hidden);
  state.liquid.hidden = amount === 0 || !state.original.hidden;
  state.surface.toggleAttribute("hidden", amount === 0 || !state.original.hidden);
  if (!amount) return;
  const x = config.centers?.[amount] ?? config.opening[0], y = config.levels[amount], rx = config.width[amount], ry = config.depth[amount];
  const liquidTop = `M${x - rx} ${y}a${rx} ${ry} 0 0 1 ${rx * 2} 0L100 100H0Z`;
  // Two masks intersect: the changing horizontal level and the vessel outline.
  mask(state.liquid, liquidTop);
  const surface = state.surface.querySelector("ellipse");
  for (const [name, value] of Object.entries({ cx: x, cy: y, rx, ry })) surface.setAttribute(name, String(value));
  state.surface.querySelector("path").setAttribute("d", `M${x - rx * .75} ${y - ry * .38}Q${x} ${y - ry * 1.18} ${x + rx * .7} ${y - ry * .38}`);
}

/** Removes whole photographic portions, leaving the bowl, board or napkin. */
export function eatPiece(art, remaining) {
  const state = mounted.get(art);
  if (!state?.pieces) return;
  const count = Math.max(0, Math.min(state.pieces.length, Math.round(remaining)));
  state.original.hidden = state.composed || count !== state.pieces.length;
  art.dataset.remaining = String(count);
  state.pieces.forEach((piece, index) => { piece.hidden = index < state.pieces.length - count; });
}
