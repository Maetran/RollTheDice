import world from "./world-map.json";

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const FRAME_MS = 1000 / 24;
const vector = ([lon, lat]) => {
  const latitude = lat * RAD;
  const longitude = lon * RAD;
  return [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
};
const landVectors = world.land.map(ring => ring.map(vector));
const gridVectors = [];
for (let latitude = -60; latitude <= 60; latitude += 30) {
  gridVectors.push(Array.from({ length: 73 }, (_, index) => vector([-180 + index * 5, latitude])));
}
for (let longitude = -180; longitude < 180; longitude += 30) {
  gridVectors.push(Array.from({ length: 37 }, (_, index) => vector([longitude, -90 + index * 5])));
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const shortestAngle = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
const count = value => clamp(Math.floor(Number(value) || 0), 0, 1e9);
const optionalCount = value => value == null ? null : count(value);
const hash = value => [...value].reduce((result, character) => (result * 31 + character.charCodeAt(0)) >>> 0, 0);

// The map contains country reference coordinates, never visitor coordinates.
// The single data input is the existing bounded, anonymous country aggregate.
function normalizeCountries(input) {
  const rows = new Map();
  for (const raw of (Array.isArray(input) ? input : []).slice(0, 256)) {
    const country = String(raw?.country || "ZZ").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) continue;
    const row = {
      country, sessions: count(raw.sessions), page_views: optionalCount(raw.page_views),
      active_seconds: optionalCount(raw.active_seconds),
      games: raw.games ? { zdwa: count(raw.games.zdwa), zilch: count(raw.games.zilch) } : null,
      center: country === "ZZ" ? null : world.centers[country] || null,
    };
    if (rows.has(country)) continue;
    rows.set(country, row);
  }
  return [...rows.values()].sort((a, b) => b.sessions - a.sessions || a.country.localeCompare(b.country));
}

/** Local, dependency-free country visualization. No requests, identities or city data. */
export function createGlobe(element, helpers = {}) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const t = helpers.t || (value => value);
  const number = helpers.number || (value => new Intl.NumberFormat(helpers.locale || "de").format(value));
  const locale = typeof helpers.locale === "function" ? helpers.locale() : helpers.locale || "de";
  const decimal = value => new Intl.NumberFormat(typeof helpers.locale === "function" ? helpers.locale() : locale, { maximumFractionDigits: 1 }).format(value);
  let regionNames;
  try { regionNames = new Intl.DisplayNames([locale], { type: "region" }); } catch { /* Code is the safe fallback. */ }
  const name = country => country === "ZZ" ? t("Unbekannte Herkunft") : helpers.countryName?.(country) || regionNames?.of(country) || country;
  const node = (tag, className, text) => {
    const result = doc.createElement(tag);
    if (className) result.className = className;
    if (text != null) result.textContent = text;
    return result;
  };
  const setText = (target, value) => {
    if (target.textContent !== value) target.textContent = value;
  };
  const controller = new win.AbortController();
  const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: controller.signal });
  const makeButton = (text, callback) => {
    const button = node("button", "geo-button", t(text));
    button.type = "button";
    listen(button, "click", callback);
    return button;
  };

  element.classList.add("geo-mission");
  const toolbar = node("div", "geo-toolbar");
  const viewGroup = node("div", "geo-view-switch");
  viewGroup.setAttribute("role", "group");
  viewGroup.setAttribute("aria-label", t("Kartenansicht"));
  const globeButton = makeButton("Globus", () => setView("globe"));
  const mapButton = makeButton("Weltkarte", () => setView("map"));
  viewGroup.append(globeButton, mapButton);
  const legend = node("p", "geo-legend");
  legend.append(node("span", "geo-legend-dot"), node("span", "", t("Punktgröße: Sitzungen je Land")));
  const pauseButton = makeButton("Bewegung pausieren", () => {
    paused = !paused;
    refreshMotion();
    win.dispatchEvent(new win.CustomEvent("mission:motion", { detail: { paused } }));
  });
  pauseButton.classList.add("geo-pause");
  toolbar.append(viewGroup, legend, pauseButton);

  const layout = node("div", "geo-layout");
  const visualization = node("div", "geo-visualization");
  const stage = node("div", "geo-stage");
  const canvas = node("canvas", "geo-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("Länderherkunft auf dem Globus. Mit den Pfeiltasten drehen oder ein Land in der Liste wählen."));
  const overlay = node("div", "geo-overlay");
  const status = node("span", "geo-status", "");
  const coordinates = node("span", "geo-coordinates", "");
  overlay.append(node("span", "geo-overlay-label", "COUNTRY / TELEMETRY"), status, coordinates);
  const stageHint = node("p", "geo-stage-hint", t("Ziehen zum Drehen · Land auswählen für Details"));
  const empty = node("p", "geo-empty", t("Noch keine kartierbaren Länderwerte"));
  stage.append(canvas, overlay, stageHint, empty);
  const note = node("p", "geo-precision-note", t("Länderwerte am ungefähren Landeszentrum, keine präzisen Besucherstandorte. Impulse zeigen aggregierte Werte, keine Live-Besucher."));
  visualization.append(stage, note);

  const sidebar = node("div", "geo-sidebar");
  const summary = node("div", "geo-summary");
  const summaryKnown = node("strong", "", "0");
  const summaryUnknown = node("strong", "", "0");
  const knownCell = node("div", "");
  knownCell.append(summaryKnown, node("span", "", t("Kartierte Länder")));
  const unknownCell = node("div", "");
  unknownCell.append(summaryUnknown, node("span", "", t("Sitzungen ohne Kartenpunkt")));
  summary.append(knownCell, unknownCell);
  const detail = node("section", "geo-detail");
  detail.setAttribute("aria-label", t("Länderdetails"));
  const detailCode = node("span", "geo-country-code");
  const detailTitle = node("h3", "geo-country-title");
  const detailTag = node("span", "geo-detail-tag");
  const detailHeading = node("div", "geo-detail-heading");
  detailHeading.append(detailCode, detailTitle, detailTag);
  const detailMetrics = node("dl", "geo-detail-metrics");
  const metric = label => {
    const cell = node("div", "");
    const value = node("dd", "", "—");
    cell.append(node("dt", "", t(label)), value);
    detailMetrics.append(cell);
    return value;
  };
  const sessionsValue = metric("Sitzungen");
  const shareValue = metric("Anteil an allen Sitzungen");
  const viewsValue = metric("Seitenaufrufe");
  const activeValue = metric("Aktive Zeit");
  const gameValues = node("div", "geo-game-values");
  const zdwaValue = node("strong", "", "—");
  const zilchValue = node("strong", "", "—");
  const zdwaCell = node("div", "");
  zdwaCell.append(node("span", "", "ZDWA"), zdwaValue);
  const zilchCell = node("div", "");
  zilchCell.append(node("span", "", "Zilch"), zilchValue);
  gameValues.append(zdwaCell, zilchCell);
  const gamesNote = node("p", "geo-game-note", t("Spielsitzungen können sich überschneiden: Ein Tab kann beide Spiele besuchen."));
  detail.append(detailHeading, detailMetrics, gameValues, gamesNote);
  const listHeading = node("div", "geo-list-heading");
  const listTitle = node("h3", "", t("Länder auswählen"));
  const listCount = node("span", "", "");
  listHeading.append(listTitle, listCount);
  const countryList = node("div", "geo-country-list");
  countryList.setAttribute("role", "group");
  countryList.setAttribute("aria-label", t("Länder auswählen"));
  const listEmpty = node("p", "geo-list-empty", t("Noch keine Länderwerte für diesen Zeitraum"));
  const announcement = node("span", "sr-only");
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  sidebar.append(summary, detail, listHeading, countryList, announcement);
  layout.append(visualization, sidebar);
  element.replaceChildren(toolbar, layout);

  const context = canvas.getContext("2d", { alpha: false });
  const reducedMotion = win.matchMedia("(prefers-reduced-motion: reduce)");
  let motionReduced = reducedMotion.matches;
  let rows = [];
  let selected = null;
  let view = "globe";
  let paused = doc.documentElement.dataset.motion === "paused";
  let suspended = false;
  let pageSuspended = false;
  let intersecting = true;
  let destroyed = false;
  let width = 0;
  let height = 0;
  let radius = 1;
  let animation = 0;
  let lastFrame = 0;
  let clock = 0;
  let longitude = 15 * RAD;
  let latitude = 24 * RAD;
  let target = null;
  let holdRotationUntil = 0;
  let drag = null;
  let markerHits = [];
  let maximumSessions = 1;
  let rotation = [1, 0, 1, 0];
  const buttons = new Map();
  let observer;
  let resizeObserver;

  function canAnimate() {
    return !destroyed && !paused && !suspended && !pageSuspended && !doc.hidden && intersecting && !motionReduced && context && width > 0;
  }

  function schedule() {
    if (!animation && canAnimate()) animation = win.requestAnimationFrame(frame);
  }

  function stop() {
    if (animation) win.cancelAnimationFrame(animation);
    animation = 0;
    lastFrame = 0;
  }

  function refreshMotion() {
    motionReduced = reducedMotion.matches;
    const label = t(motionReduced ? "Bewegung reduziert" : paused ? "Bewegung fortsetzen" : "Bewegung pausieren");
    pauseButton.textContent = label;
    pauseButton.setAttribute("aria-label", label);
    pauseButton.setAttribute("aria-pressed", String(paused || motionReduced));
    pauseButton.disabled = motionReduced;
    pauseButton.title = motionReduced ? t("Reduzierte Bewegung durch Systemeinstellung") : "";
    element.dataset.motion = paused || motionReduced ? "paused" : "running";
    stop();
    draw();
    schedule();
  }

  function frame(time) {
    animation = 0;
    if (!canAnimate()) return;
    if (lastFrame && time - lastFrame < FRAME_MS) {
      schedule();
      return;
    }
    const delta = lastFrame ? Math.min((time - lastFrame) / 1000, 0.08) : 0;
    lastFrame = time;
    clock += delta;
    if (view === "globe" && !drag) {
      if (target) {
        const turn = shortestAngle(target[0] - longitude);
        const tilt = target[1] - latitude;
        longitude += turn * Math.min(delta * 5, 1);
        latitude += tilt * Math.min(delta * 5, 1);
        if (Math.abs(turn) + Math.abs(tilt) < 0.003) target = null;
      } else if (clock > holdRotationUntil) longitude += delta * 0.018;
    }
    draw();
    schedule();
  }

  function setView(next) {
    view = next;
    element.dataset.view = next;
    globeButton.setAttribute("aria-pressed", String(next === "globe"));
    mapButton.setAttribute("aria-pressed", String(next === "map"));
    canvas.setAttribute("aria-label", t(next === "globe"
      ? "Länderherkunft auf dem Globus. Mit den Pfeiltasten drehen oder ein Land in der Liste wählen."
      : "Länderherkunft auf der Weltkarte. Ein Land in der Liste wählen für Details."));
    stageHint.textContent = t(next === "globe" ? "Ziehen zum Drehen · Land auswählen für Details" : "Länderpunkte auswählen · Punktgröße zeigt Sitzungen");
    draw();
    schedule();
  }

  function selectCountry(code, announce = true) {
    selected = rows.find(row => row.country === code) || rows[0] || null;
    for (const [country, button] of buttons) button.setAttribute("aria-pressed", String(country === selected?.country));
    if (!selected) {
      detail.hidden = true;
      detailCode.textContent = "";
      detailTitle.textContent = "";
      detailTag.textContent = "";
      for (const value of [sessionsValue, shareValue, viewsValue, activeValue, zdwaValue, zilchValue]) value.textContent = "—";
      announcement.textContent = "";
      return;
    }
    detail.hidden = false;
    detailCode.textContent = selected.country === "ZZ" ? "—" : selected.country;
    detailTitle.textContent = name(selected.country);
    detailTag.textContent = t(selected.center ? "Grobe Länderzuordnung" : "Ohne Kartenpunkt");
    detailTag.dataset.known = String(!!selected.center);
    const total = rows.reduce((sum, row) => sum + row.sessions, 0);
    sessionsValue.textContent = number(selected.sessions);
    shareValue.textContent = `${decimal(total ? selected.sessions / total * 100 : 0)} %`;
    viewsValue.textContent = selected.page_views == null ? "—" : number(selected.page_views);
    activeValue.textContent = selected.active_seconds == null ? "—" : formatDuration(selected.active_seconds);
    zdwaValue.textContent = selected.games == null ? "—" : number(selected.games.zdwa);
    zilchValue.textContent = selected.games == null ? "—" : number(selected.games.zilch);
    gameValues.hidden = selected.games == null;
    gamesNote.hidden = selected.games == null;
    if (announce) announcement.textContent = `${name(selected.country)}: ${number(selected.sessions)} ${t("Sitzungen")}`;
    if (selected.center && view === "globe") {
      target = [selected.center[0] * RAD, clamp(selected.center[1] * RAD, -1.1, 1.1)];
      holdRotationUntil = clock + 12;
      if (!canAnimate()) {
        [longitude, latitude] = target;
        target = null;
      }
    }
    draw();
    schedule();
  }

  function formatDuration(seconds) {
    if (seconds < 60) return `${number(seconds)} s`;
    if (seconds < 3600) return `${number(Math.round(seconds / 60))} min`;
    return `${number(Math.floor(seconds / 3600))} h ${number(Math.floor(seconds % 3600 / 60))} min`;
  }

  function update(countries) {
    if (destroyed) return;
    rows = normalizeCountries(countries);
    markerHits = [];
    if (!rows.length) { target = null; longitude = 15 * RAD; latitude = 24 * RAD; holdRotationUntil = 0; }
    buttons.clear();
    const fragment = doc.createDocumentFragment();
    const maximum = Math.max(1, ...rows.map(row => row.sessions));
    maximumSessions = maximum;
    for (const row of rows) {
      const button = node("button", "geo-country-row");
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.dataset.country = row.country;
      const code = node("span", "geo-list-code", row.country === "ZZ" ? "—" : row.country);
      const copy = node("span", "geo-list-copy");
      copy.append(node("span", "geo-list-name", name(row.country)));
      if (!row.center) copy.append(node("small", "", t("Ohne Kartenpunkt")));
      const amount = node("span", "geo-list-amount", number(row.sessions));
      const bar = node("span", "geo-list-bar");
      bar.style.setProperty("--country-share", String(row.sessions / maximum));
      button.append(code, copy, amount, bar);
      fragment.append(button);
      buttons.set(row.country, button);
    }
    if (!rows.length) fragment.append(listEmpty);
    countryList.replaceChildren(fragment);
    const known = rows.filter(row => row.center && row.sessions > 0);
    summaryKnown.textContent = number(known.length);
    setText(status, `${number(known.length)} ${t("Kartierte Länder")}`);
    summaryUnknown.textContent = number(rows.filter(row => !row.center).reduce((sum, row) => sum + row.sessions, 0));
    listCount.textContent = number(rows.length);
    empty.hidden = known.length > 0;
    const retain = rows.find(row => row.country === selected?.country);
    // Refreshing aggregates must not repeatedly recenter a manually rotated map.
    const previousTarget = target;
    const previousLongitude = longitude;
    const previousLatitude = latitude;
    selectCountry(retain?.country || known[0]?.country || rows[0]?.country, false);
    if (retain) {
      target = previousTarget;
      longitude = previousLongitude;
      latitude = previousLatitude;
    }
    draw();
  }

  function resize() {
    if (destroyed) return;
    const bounds = stage.getBoundingClientRect();
    width = Math.max(0, bounds.width);
    height = Math.max(0, bounds.height);
    // Retina is capped to keep this dashboard inexpensive on tablets and laptops.
    const ratio = Math.min(win.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    radius = Math.min(width * 0.39, height * 0.405);
    draw();
    schedule();
  }

  function viewPoint(point) {
    const [x, y, z] = point;
    const [cosLongitude, sinLongitude, cosLatitude, sinLatitude] = rotation;
    const axial = x * cosLongitude + z * sinLongitude;
    return [z * cosLongitude - x * sinLongitude, axial * sinLatitude - y * cosLatitude, axial * cosLatitude + y * sinLatitude];
  }

  function horizon(a, b) {
    const fraction = a[2] / (a[2] - b[2]);
    const x = a[0] + (b[0] - a[0]) * fraction;
    const y = a[1] + (b[1] - a[1]) * fraction;
    const length = Math.hypot(x, y) || 1;
    return [x / length, y / length, 0];
  }

  function line(points, cx, cy, scale) {
    context.beginPath();
    points.forEach((point, index) => {
      const x = cx + point[0] * scale;
      const y = cy + point[1] * scale;
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
  }

  function landSegment(points, cx, cy, scale, clipped) {
    if (points.length < 3) return;
    line(points, cx, cy, scale);
    if (clipped) {
      const first = points[0];
      const last = points[points.length - 1];
      const start = Math.atan2(last[1], last[0]);
      const end = Math.atan2(first[1], first[0]);
      context.arc(cx, cy, scale, start, start + shortestAngle(end - start), shortestAngle(end - start) < 0);
    }
    context.closePath();
    context.fill();
    // Coastline only: do not turn the horizon clipping arc into a fake border.
    line(points, cx, cy, scale);
    if (!clipped) context.closePath();
    context.stroke();
  }

  function globeLand(cx, cy, scale) {
    context.fillStyle = "rgba(54,137,139,.32)";
    context.strokeStyle = "rgba(113,229,215,.43)";
    context.lineWidth = 0.7;
    for (const ring of landVectors) {
      const points = ring.map(viewPoint);
      const hidden = points.findIndex(point => point[2] < 0);
      if (hidden < 0) { landSegment(points, cx, cy, scale, false); continue; }
      let segment = [];
      let previous = points[hidden];
      for (let offset = 1; offset <= points.length; offset++) {
        const current = points[(hidden + offset) % points.length];
        if (previous[2] < 0 && current[2] >= 0) segment = [horizon(previous, current)];
        if (current[2] >= 0) segment.push(current);
        if (previous[2] >= 0 && current[2] < 0) {
          segment.push(horizon(previous, current));
          landSegment(segment, cx, cy, scale, true);
          segment = [];
        }
        previous = current;
      }
    }
  }

  function globeGrid(cx, cy, scale) {
    context.strokeStyle = "rgba(97,162,182,.2)";
    context.lineWidth = 0.65;
    for (const vectors of gridVectors) {
      const points = vectors.map(viewPoint);
      context.beginPath();
      let previous;
      for (const point of points) {
        if (point[2] >= 0) {
          if (!previous || previous[2] < 0) {
            const entry = previous ? horizon(previous, point) : point;
            context.moveTo(cx + entry[0] * scale, cy + entry[1] * scale);
          }
          context.lineTo(cx + point[0] * scale, cy + point[1] * scale);
        } else if (previous?.[2] >= 0) {
          const exit = horizon(previous, point);
          context.lineTo(cx + exit[0] * scale, cy + exit[1] * scale);
        }
        previous = point;
      }
      context.stroke();
    }
  }

  function background() {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#08131f");
    gradient.addColorStop(1, "#07111c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    // Fixed instrument texture; these dots never represent people or events.
    context.fillStyle = "rgba(125,176,196,.18)";
    for (let index = 0; index < 34; index++) {
      const x = ((index * 1597 + 73) % 1000) / 1000 * width;
      const y = ((index * 233 + 173) % 997) / 997 * height;
      context.fillRect(x, y, index % 5 ? 1 : 1.5, index % 5 ? 1 : 1.5);
    }
    context.strokeStyle = "rgba(106,219,212,.17)";
    context.lineWidth = 1;
    for (const [x, y, dx, dy] of [[17, 17, 1, 1], [width - 17, 17, -1, 1], [17, height - 17, 1, -1], [width - 17, height - 17, -1, -1]]) {
      context.beginPath();
      context.moveTo(x, y + dy * 13);
      context.lineTo(x, y);
      context.lineTo(x + dx * 13, y);
      context.stroke();
    }
  }

  function marker(row, x, y, visibility = 1) {
    if (!row.sessions) return;
    const size = 3 + Math.sqrt(row.sessions / maximumSessions) * 7;
    const isSelected = row.country === selected?.country;
    const color = isSelected ? "244,199,123" : "110,231,222";
    const phase = (clock * 0.25 + hash(row.country) % 100 / 100) % 1;
    context.globalAlpha = clamp(visibility, 0.22, 1);
    const glow = context.createRadialGradient(x, y, 1, x, y, size * 3.8);
    glow.addColorStop(0, `rgba(${color},.38)`);
    glow.addColorStop(1, `rgba(${color},0)`);
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, size * 3.8, 0, TAU);
    context.fill();
    context.strokeStyle = `rgba(${color},${0.4 * (1 - phase)})`;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(x, y, size + 4 + phase * 14, 0, TAU);
    context.stroke();
    context.fillStyle = `rgba(${color},.9)`;
    context.strokeStyle = "#0c1b27";
    context.lineWidth = 1.7;
    context.beginPath();
    context.arc(x, y, size, 0, TAU);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(255,255,255,.7)";
    context.beginPath();
    context.arc(x - size * 0.23, y - size * 0.25, Math.max(1, size * 0.18), 0, TAU);
    context.fill();
    if (isSelected) {
      context.strokeStyle = `rgba(${color},.9)`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x, y, size + 4, 0, TAU);
      context.stroke();
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "center";
      context.fillStyle = "#f5d29a";
      context.fillText(row.country, x, y - size - 12);
    }
    context.globalAlpha = 1;
    markerHits.push({ row, x, y, radius: Math.max(size + 6, 15) });
  }

  function drawGlobe() {
    const cx = width / 2;
    const cy = height / 2 + 3;
    const scale = radius;
    const atmosphere = context.createRadialGradient(cx, cy, scale * 0.94, cx, cy, scale * 1.2);
    atmosphere.addColorStop(0, "rgba(89,231,220,.15)");
    atmosphere.addColorStop(0.35, "rgba(66,166,180,.09)");
    atmosphere.addColorStop(1, "rgba(66,166,180,0)");
    context.fillStyle = atmosphere;
    context.beginPath(); context.arc(cx, cy, scale * 1.2, 0, TAU); context.fill();
    context.strokeStyle = "rgba(99,196,207,.16)";
    context.setLineDash([2, 9]);
    context.beginPath(); context.arc(cx, cy, scale * 1.12, 0, TAU); context.stroke();
    context.setLineDash([]);
    const ocean = context.createRadialGradient(cx - scale * 0.35, cy - scale * 0.4, 0, cx, cy, scale);
    ocean.addColorStop(0, "#14334a");
    ocean.addColorStop(0.6, "#0b2537");
    ocean.addColorStop(1, "#071824");
    context.fillStyle = ocean;
    context.beginPath(); context.arc(cx, cy, scale, 0, TAU); context.fill();
    context.save();
    context.beginPath(); context.arc(cx, cy, scale, 0, TAU); context.clip();
    globeLand(cx, cy, scale);
    globeGrid(cx, cy, scale);
    context.restore();
    context.strokeStyle = "rgba(119,231,225,.37)";
    context.lineWidth = 1;
    context.beginPath(); context.arc(cx, cy, scale, 0, TAU); context.stroke();
    const visible = rows.filter(row => row.center).map(row => ({ row, point: viewPoint(vector(row.center)) })).filter(item => item.point[2] > 0.03).sort((a, b) => a.point[2] - b.point[2]);
    for (const { row, point } of visible) marker(row, cx + point[0] * scale, cy + point[1] * scale, point[2] * 1.6);
    setText(coordinates, `${Math.abs(Math.round(latitude / RAD))}°${latitude >= 0 ? "N" : "S"} / ${Math.abs(Math.round(shortestAngle(longitude) / RAD))}°${shortestAngle(longitude) >= 0 ? "E" : "W"}`);
  }

  function drawMap() {
    const mapWidth = Math.min(width - 50, (height - 100) * 2);
    const mapHeight = mapWidth / 2;
    const left = (width - mapWidth) / 2;
    const top = (height - mapHeight) / 2;
    const project = ([lon, lat]) => [left + (lon + 180) / 360 * mapWidth, top + (90 - lat) / 180 * mapHeight];
    context.fillStyle = "#0b2131";
    context.fillRect(left, top, mapWidth, mapHeight);
    context.save();
    context.beginPath(); context.rect(left, top, mapWidth, mapHeight); context.clip();
    context.fillStyle = "rgba(54,137,139,.36)";
    context.strokeStyle = "rgba(113,229,215,.4)";
    context.lineWidth = 0.7;
    for (const ring of world.land) {
      const unwrapped = [];
      let previous;
      for (const [raw, lat] of ring) {
        let lon = raw;
        if (previous != null) {
          while (lon - previous > 180) lon -= 360;
          while (lon - previous < -180) lon += 360;
        }
        unwrapped.push([lon, lat]);
        previous = lon;
      }
      for (const offset of [-360, 0, 360]) {
        context.beginPath();
        unwrapped.forEach(([lon, lat], index) => {
          const [x, y] = project([lon + offset, lat]);
          if (index) context.lineTo(x, y); else context.moveTo(x, y);
        });
        context.closePath(); context.fill(); context.stroke();
      }
    }
    context.strokeStyle = "rgba(97,162,182,.21)";
    context.lineWidth = 0.7;
    for (let longitude = -180; longitude <= 180; longitude += 30) {
      const [x] = project([longitude, 0]);
      context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + mapHeight); context.stroke();
    }
    for (let latitude = -90; latitude <= 90; latitude += 30) {
      const [, y] = project([0, latitude]);
      context.beginPath(); context.moveTo(left, y); context.lineTo(left + mapWidth, y); context.stroke();
    }
    for (const row of rows.filter(row => row.center)) {
      const [x, y] = project(row.center);
      marker(row, x, y);
    }
    context.restore();
    context.strokeStyle = "rgba(105,212,207,.3)";
    context.strokeRect(left, top, mapWidth, mapHeight);
    context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillStyle = "#7b9eaf";
    context.textAlign = "center";
    for (const longitude of [-180, -90, 0, 90, 180]) {
      const [x] = project([longitude, 0]);
      context.fillText(`${longitude}°`, x, top + mapHeight + 16);
    }
    setText(coordinates, "180°W / 0° / 180°E");
  }

  function draw() {
    // Keep one static frame ready for resizing/export, even below the viewport.
    // Intersection visibility gates animation rather than clearing the canvas.
    if (destroyed || !context || !width || !height || doc.hidden || pageSuspended || suspended) return;
    rotation = [Math.cos(longitude), Math.sin(longitude), Math.cos(latitude), Math.sin(latitude)];
    markerHits = [];
    background();
    if (view === "globe") drawGlobe(); else drawMap();
  }

  listen(canvas, "pointerdown", event => {
    if (event.button !== 0 || view !== "globe") return;
    drag = { x: event.clientX, y: event.clientY, longitude, latitude, moved: false, id: event.pointerId };
    target = null;
    canvas.setPointerCapture?.(event.pointerId);
    stage.classList.add("is-dragging");
  });
  listen(canvas, "pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved ||= Math.hypot(dx, dy) > 6;
    longitude = drag.longitude - dx / Math.max(radius, 1);
    latitude = clamp(drag.latitude + dy / Math.max(radius, 1), -1.2, 1.2);
    holdRotationUntil = clock + 8;
    draw();
  });
  const release = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    stage.classList.remove("is-dragging");
    if (!moved && event.type === "pointerup") selectAt(event.clientX, event.clientY);
    schedule();
  };
  listen(canvas, "pointerup", release);
  listen(canvas, "pointercancel", release);
  listen(canvas, "lostpointercapture", release);
  listen(canvas, "click", event => { if (view === "map") selectAt(event.clientX, event.clientY); });
  // One delegated listener survives aggregate refreshes without retaining old rows.
  listen(countryList, "click", event => {
    const button = event.target.closest?.("button[data-country]");
    if (button && countryList.contains(button)) selectCountry(button.dataset.country);
  });

  function selectAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const closest = markerHits.filter(hit => Math.hypot(hit.x - x, hit.y - y) <= hit.radius).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (closest) selectCountry(closest.row.country);
  }

  listen(canvas, "keydown", event => {
    if (view !== "globe") return;
    const deltas = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12] };
    if (event.key === "Home") { longitude = 15 * RAD; latitude = 24 * RAD; }
    else if (deltas[event.key]) { longitude += deltas[event.key][0]; latitude = clamp(latitude + deltas[event.key][1], -1.2, 1.2); }
    else return;
    event.preventDefault();
    target = null;
    holdRotationUntil = clock + 8;
    draw();
  });
  listen(doc, "visibilitychange", () => {
    stop();
    if (!doc.hidden) { draw(); schedule(); }
  });
  listen(win, "pagehide", () => { pageSuspended = true; stop(); });
  listen(win, "pageshow", () => { pageSuspended = false; resize(); schedule(); });
  listen(reducedMotion, "change", refreshMotion);
  if (win.IntersectionObserver) {
    observer = new win.IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.isIntersecting);
      stop();
      if (intersecting) { draw(); schedule(); }
    }, { threshold: 0.05 });
    observer.observe(stage);
  }
  if (win.ResizeObserver) {
    resizeObserver = new win.ResizeObserver(resize);
    resizeObserver.observe(stage);
  } else listen(win, "resize", resize);

  setView("globe");
  update([]);
  resize();
  refreshMotion();
  return {
    update,
    clear() { update([]); },
    setPaused(value) { if (!destroyed) { paused = !!value; refreshMotion(); } },
    suspend() { suspended = true; stop(); },
    resume() { if (!destroyed) { suspended = false; refreshMotion(); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      controller.abort();
      observer?.disconnect();
      resizeObserver?.disconnect();
      rows = [];
      markerHits = [];
      buttons.clear();
      element.replaceChildren();
      element.classList.remove("geo-mission");
      delete element.dataset.view;
      delete element.dataset.motion;
    },
  };
}
