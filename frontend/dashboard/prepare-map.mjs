// One-time, offline preparation. Input files come from the public-domain
// Natural Earth maintainer repository; this script is never sent to browsers.
// node frontend/dashboard/prepare-map.mjs /tmp/land.geojson /tmp/countries.geojson
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const [landPath, countriesPath] = process.argv.slice(2);
if (!landPath || !countriesPath) throw new Error("Pass Natural Earth 110m land and 50m countries GeoJSON files.");
const landRaw = await readFile(landPath, "utf8");
const countriesRaw = await readFile(countriesPath, "utf8");
const land = JSON.parse(landRaw).features.flatMap(feature => (
  feature.geometry.type === "Polygon" ? [feature.geometry.coordinates[0]]
    : feature.geometry.coordinates.map(polygon => polygon[0])
)).map(ring => ring.map(([longitude, latitude]) => [Math.round(longitude * 1000) / 1000, Math.round(latitude * 1000) / 1000]));
const centers = {};
for (const feature of JSON.parse(countriesRaw).features) {
  const properties = feature.properties;
  const code = [properties.ISO_A2, properties.ISO_A2_EH, properties.WB_A2].find(value => /^[A-Z]{2}$/.test(value || ""));
  if (!code || centers[code]) continue;
  const lon = Number(properties.LABEL_X);
  const lat = Number(properties.LABEL_Y);
  if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
    // Cartographic label centers describe countries only, never visitors.
    centers[code] = [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];
  }
}
const source = {
  dataset: "Natural Earth", license: "public domain", retrieved: "2026-10-04",
  land: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson",
  countries: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
  terms: "https://www.naturalearthdata.com/about/terms-of-use/",
  sha256: [landRaw, countriesRaw].map(value => createHash("sha256").update(value).digest("hex")),
};
await writeFile(new URL("./world-map.json", import.meta.url), JSON.stringify({ source, land, centers }) + "\n");
console.log(`${land.length} land rings, ${Object.keys(centers).length} country centers prepared.`);
