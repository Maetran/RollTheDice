// Original cosmetic names inspired by Alpine inn/card vocabulary:
// https://www.duden.de/rechtschreibung/Stammtisch
// https://www.duden.de/rechtschreibung/Stube
// https://www.piatnik.com/service
// Titles are cosmetic; gameplay randomness stays on the server.
export const WATTEN_TABLE_NAME_TEMPLATES = Object.freeze([
  ["{owner} Watterrunde", "{owner} Watten circle"],
  ["{owner} Stammtisch", "{owner} regulars’ table"],
  ["{owner} Kartenstube", "{owner} card room"],
  ["{owner} Feierabendrunde", "{owner} after-hours table"],
  ["{owner} Wirtshaustisch", "{owner} inn table"],
  ["{owner} Eckbank", "{owner} corner bench"],
  ["{owner} Hüttenrunde", "{owner} cabin circle"],
  ["{owner} Kartenalm", "{owner} alpine card hut"],
  ["{owner} Trumpfstube", "{owner} trump room"],
  ["{owner} Stichrunde", "{owner} trick circle"],
  ["{owner} Herzrunde", "{owner} hearts table"],
  ["{owner} Schellenstube", "{owner} bells room"],
  ["{owner} Eichelrunde", "{owner} acorns table"],
  ["{owner} Laublaube", "{owner} leafy nook"],
  ["{owner} Weliwinkel", "{owner} Weli corner"],
  ["{owner} Gute Stube", "{owner} cozy room"],
  ["{owner} Kartenlaube", "{owner} card porch"],
  ["{owner} Holzbank", "{owner} wooden bench"],
  ["{owner} Hinterzimmer", "{owner} back room"],
  ["{owner} Schankstube", "{owner} taproom"],
  ["{owner} Bergblick", "{owner} mountain view"],
  ["{owner} Alpenglück", "{owner} alpine luck"],
  ["{owner} Glückstisch", "{owner} lucky table"],
  ["{owner} Sonntagsrunde", "{owner} Sunday table"],
  ["{owner} Abendrunde", "{owner} evening circle"],
  ["{owner} Freundesrunde", "{owner} friends’ table"],
  ["{owner} Gemütliche Runde", "{owner} cozy circle"],
  ["{owner} Wilder Tisch", "{owner} wild table"],
  ["{owner} Volles Haus", "{owner} full house"],
  ["{owner} Kartenkeller", "{owner} card cellar"],
  ["{owner} Sonnenterrasse", "{owner} sun terrace"],
  ["{owner} Ofenbank", "{owner} fireside bench"],
  ["{owner} Fensterplatz", "{owner} window seat"],
  ["{owner} Glücksblatt", "{owner} lucky hand"],
  ["{owner} Trümpferunde", "{owner} trump circle"],
  ["{owner} Letzter Stich", "{owner} last trick"],
  ["{owner} Gipfelrunde", "{owner} summit table"],
  ["{owner} Kachelofen", "{owner} warm hearth"],
  ["{owner} Feierabendbank", "{owner} evening bench"],
  ["{owner} Stubenrunde", "{owner} snug circle"],
  ["Kartenabend mit {name}", "Card night with {name}"],
  ["Am Tisch bei {name}", "At {owner} table"],
  ["Auf einen Stich mit {name}", "One more trick with {name}"],
  ["Zu Gast bei {name}", "Guests of {name}"],
  ["Eine Runde mit {name}", "A round with {name}"],
  ["Heute wird bei {name} gewattet", "Watten at {owner} tonight"],
  ["Bergabend bei {name}", "Mountain evening with {name}"],
  ["Noch ein Blatt mit {name}", "One more hand with {name}"],
  ["In {owner} Kartenstube", "In {owner} card room"],
  ["Stammtisch bei {name}", "The regulars at {owner}"],
].map(([de, en]) => Object.freeze({ de, en })));

export function generateWattenTableName(username, language = "de") {
  const locale = /^en(?:-|$)/iu.test(language) ? "en" : "de";
  const name = String(username || (locale === "en" ? "Guest" : "Gast"))
    .normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  const owner = locale === "en" ? /s$/iu.test(name) ? `${name}’` : `${name}’s`
    : /[sßxz]$/iu.test(name) ? `${name}’` : `${name}s`;
  const sample = new Uint32Array(1);
  let index = 0;
  try { globalThis.crypto.getRandomValues(sample); index = sample[0] % WATTEN_TABLE_NAME_TEMPLATES.length; }
  catch { index = Math.floor(Math.random() * WATTEN_TABLE_NAME_TEMPLATES.length); }
  const title = WATTEN_TABLE_NAME_TEMPLATES[index][locale].replace(/\{(owner|name)\}/gu, (_, key) => key === "owner" ? owner : name);
  if ([...title].length <= 80) return title;
  const compact = `${owner} ${locale === "en" ? "table" : "Tisch"}`;
  return [...compact].length <= 80 ? compact : [...name].slice(0, 80).join("");
}
