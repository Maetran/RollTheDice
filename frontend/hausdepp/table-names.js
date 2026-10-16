// Cosmetic table titles only. Gameplay randomness remains on the server.
export const HOUSE_TABLE_NAME_TEMPLATES = Object.freeze([
  { de: "{namePossessive} Gsuff", en: "{namePossessive} nightcap" },
  { de: "{namePossessive} Kartenecke", en: "{namePossessive} card corner" },
  { de: "{namePossessive} Stammtisch", en: "{namePossessive} regulars’ table" },
  { de: "{namePossessive} Zehnerstube", en: "{namePossessive} room of tens" },
  { de: "{namePossessive} Herzbude", en: "{namePossessive} hearts nook" },
  { de: "{namePossessive} Eichelrunde", en: "{namePossessive} acorn club" },
  { de: "{namePossessive} Wirtshaus", en: "{namePossessive} inn" },
  { de: "{namePossessive} Kartenbank", en: "{namePossessive} card bench" },
  { de: "{namePossessive} Hinterzimmer", en: "{namePossessive} backroom" },
  { de: "{namePossessive} Feierabend", en: "{namePossessive} after-hours table" },
  { de: "{namePossessive} Zapfhahn", en: "{namePossessive} taproom" },
  { de: "{namePossessive} Zehnerjagd", en: "{namePossessive} ten hunt" },
  { de: "{namePossessive} Holzbank", en: "{namePossessive} wooden bench" },
  { de: "{namePossessive} Schankstube", en: "{namePossessive} snug" },
  { de: "{namePossessive} Kartenkeller", en: "{namePossessive} card cellar" },
  { de: "{namePossessive} Eckbank", en: "{namePossessive} corner bench" },
  { de: "{namePossessive} Glücksecke", en: "{namePossessive} lucky corner" },
  { de: "{namePossessive} Wilder Tisch", en: "{namePossessive} wild table" },
  { de: "{namePossessive} Kartenalm", en: "{namePossessive} alpine card hut" },
  { de: "{namePossessive} Zockerstube", en: "{namePossessive} players’ nook" },
  { de: "{namePossessive} Hausrunde", en: "{namePossessive} house table" },
  { de: "{namePossessive} Letzte Runde", en: "{namePossessive} last round" },
  { de: "{namePossessive} Kurze Pause", en: "{namePossessive} quick break" },
  { de: "{namePossessive} Kartenchaos", en: "{namePossessive} card chaos" },
  { de: "{namePossessive} Zehnerzimmer", en: "{namePossessive} tens hideaway" },
  { de: "{namePossessive} Gute Stube", en: "{namePossessive} best room" },
  { de: "{namePossessive} Gaudistube", en: "{namePossessive} jolly table" },
  { de: "{namePossessive} Wackelbank", en: "{namePossessive} wobbly bench" },
  { de: "{namePossessive} Gläserklang", en: "{namePossessive} clinking glasses" },
  { de: "{namePossessive} Unterstand", en: "{namePossessive} Unter hideout" },
  { de: "{namePossessive} Oberstübchen", en: "{namePossessive} Ober loft" },
  { de: "{namePossessive} Kartenlaube", en: "{namePossessive} card porch" },
  { de: "{namePossessive} Roter Zehner", en: "{namePossessive} red ten" },
  { de: "{namePossessive} Grüner Tisch", en: "{namePossessive} green table" },
  { de: "{namePossessive} Feierabendalm", en: "{namePossessive} mountain retreat" },
  { de: "{namePossessive} Kartenscheune", en: "{namePossessive} card barn" },
  { de: "{namePossessive} Hinterbank", en: "{namePossessive} back bench" },
  { de: "{namePossessive} Hausdeppstube", en: "{namePossessive} Hausdepp den" },
  { de: "Bei {name} wird gezockt", en: "Cards at {namePossessive}" },
  { de: "Bei {name} am Tisch", en: "At {namePossessive} table" },
  { de: "Heute bei {name}", en: "Tonight at {namePossessive}" },
  { de: "Zu Gast bei {name}", en: "Guests of {name}" },
  { de: "Abendrunde bei {name}", en: "Evening cards with {name}" },
  { de: "Zehnerjagd bei {name}", en: "Hunting tens with {name}" },
  { de: "Kartenabend mit {name}", en: "Card night with {name}" },
  { de: "Stammtisch bei {name}", en: "{namePossessive} regulars" },
  { de: "In {namePossessive} Stube", en: "In {namePossessive} snug" },
  { de: "Willkommen bei {name}", en: "Welcome to {namePossessive}" },
  { de: "Ein Blatt mit {name}", en: "A hand with {name}" },
  { de: "Auf einen Zehner mit {name}", en: "One more ten with {name}" },
].map(template => Object.freeze(template)));

const TABLE_NAME_LIMIT = 80;

function randomTemplateIndex() {
  const count = HOUSE_TABLE_NAME_TEMPLATES.length;
  try {
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const sample = new Uint32Array(1);
      const limit = 2 ** 32 - (2 ** 32 % count);
      // Rejection avoids a modulo bias; the bound also keeps a broken or
      // mocked random provider from preventing table creation.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        globalThis.crypto.getRandomValues(sample);
        if (sample[0] < limit) return sample[0] % count;
      }
    }
  } catch (_) { /* Restricted browser contexts still get a cosmetic title. */ }
  try {
    const sample = Math.random();
    if (Number.isFinite(sample) && sample >= 0 && sample < 1) return Math.floor(sample * count);
  } catch (_) { /* A title must never prevent creating a table. */ }
  return 0;
}

function possessive(name, language) {
  if (language === "en") return /s$/iu.test(name) ? `${name}’` : `${name}’s`;
  return /[sßxz]$/iu.test(name) ? `${name}’` : `${name}s`;
}

/** Return plain text; callers escape it when inserting HTML, not for JSON. */
export function generateHouseTableName(username, language = "de") {
  const locale = typeof language === "string" && /^en(?:-|$)/iu.test(language) ? "en" : "de";
  const name = (typeof username === "string" ? username : "")
    .normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim()
    || (locale === "en" ? "Guest" : "Gast");
  const owner = possessive(name, locale);
  const title = HOUSE_TABLE_NAME_TEMPLATES[randomTemplateIndex()][locale]
    .replace(/\{(name|namePossessive)\}/gu, (_, field) => field === "name" ? name : owner);
  if (Array.from(title).length <= TABLE_NAME_LIMIT) return title;
  // Real account names fit the API's64-character username limit. Prefer a
  // shorter decoration over cutting the owner's name to fit the80-char title.
  const compact = `${owner} ${locale === "en" ? "table" : "Tisch"}`;
  if (Array.from(compact).length <= TABLE_NAME_LIMIT) return compact;
  if (Array.from(name).length <= TABLE_NAME_LIMIT) return name;
  return `${Array.from(name).slice(0, TABLE_NAME_LIMIT - 1).join("")}…`;
}

export { generateHouseTableName as generateTableName };
