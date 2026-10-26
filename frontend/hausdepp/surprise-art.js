// Premium raster cut-outs for the rare table surprises of Hausdepp and Watten.
// Every subject is a transparent WebP; the markup stays inert and decorative so
// it never reaches the accessibility tree, pointer input or drag and drop.
// URLs stay literal so scripts/sync_static_versions.py can stamp their hash.
const sources = {
  star: "/static/table-surprises/star.webp?v=ASSET_VERSION",
  hammer: "/static/table-surprises/hammer.webp?v=ASSET_VERSION",
  ufo: "/static/table-surprises/ufo.webp?v=ASSET_VERSION",
  portal: "/static/table-surprises/portal.webp?v=ASSET_VERSION",
  dragon: "/static/table-surprises/dragon.webp?v=ASSET_VERSION",
  kraken: "/static/table-surprises/kraken.webp?v=ASSET_VERSION",
  clock: "/static/table-surprises/clock.webp?v=ASSET_VERSION",
  blackhole: "/static/table-surprises/blackhole.webp?v=ASSET_VERSION",
  mouse: "/static/table-surprises/mouse.webp?v=ASSET_VERSION",
  tentacle: "/static/table-surprises/tentacle.webp?v=ASSET_VERSION",
};
const effects = new Set(["star", "hammer", "ufo", "portal", "dragon", "kraken", "clock", "blackhole"]);
const own = key => Object.prototype.hasOwnProperty.call(sources, key);

const image = (key, live) => `<img class="hd-art-img" src="${sources[key]}" alt="" aria-hidden="true" draggable="false" decoding="async" loading="${live ? "eager" : "lazy"}">`;
const frame = (key, live, overlay = "") => `<span class="hd-art${live ? " hd-art--live" : ""}" data-art="${key}" aria-hidden="true">${image(key, live)}${overlay}</span>`;

// Blued steel hands above the raster dial. The live effect rotates them itself
// (.hd-hand-h/.hd-hand-m); the resting prop shows ten past ten.
function dial(live) {
  const hand = (name, angle, d) => `<path class="hd-dial-hand ${name}" d="${d}"${live ? "" : ` transform="rotate(${angle} 50 50)"`}/>`;
  return `<svg class="hd-art-dial" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g fill="#18202e" stroke="#0a0d14" stroke-width=".4" stroke-linejoin="round">`
    + hand("hd-hand-h", -90, "M49 54 48.5 50 50 30.5 51.5 50 51 54z")
    + hand("hd-hand-m", 30, "M49.5 55 49.3 50 50 21 50.7 50 50.5 55z")
    + `</g><circle cx="50" cy="50" r="2" fill="#c99a4a" stroke="#5a3a12" stroke-width=".5"/></svg>`;
}

export function premiumSurpriseArt(effect, { live = false } = {}) {
  if (!effects.has(effect)) return "";
  return frame(effect, live, effect === "clock" ? dial(live) : "");
}

export function premiumTentacleArt() { return frame("tentacle", true); }

export function premiumMouseArt() {
  return frame("mouse", true);
}

// Optional prefetch for one known subject, e.g. when its prop appears. Never
// runs on import; at most one request per known image for the page lifetime.
const warmed = new Map();
export function warmSurpriseArt(effect) {
  const key = String(effect);
  if (!own(key) || typeof Image !== "function") return Promise.resolve(false);
  if (!warmed.has(key)) {
    const probe = new Image();
    probe.decoding = "async";
    probe.src = sources[key];
    const loaded = (probe.decode ? probe.decode() : Promise.resolve()).then(() => true, () => false);
    const companion = key === "clock" ? "mouse" : key === "kraken" ? "tentacle" : null;
    const ready = companion
      ? Promise.all([loaded, warmSurpriseArt(companion)]).then(results => results.every(Boolean)) : loaded;
    warmed.set(key, ready);
    ready.then(ok => { if (!ok && warmed.get(key) === ready) warmed.delete(key); });
  }
  return warmed.get(key);
}
