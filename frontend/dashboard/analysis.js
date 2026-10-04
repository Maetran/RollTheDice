// Interactive views of the aggregate API. Selections stay in this document;
// no visitor IDs or individual browsing histories are exposed to the client.
export function createAnalysisVisuals({ t, e, number, percent, duration, gameName, pageLabel, locale }) {
  const $ = id => document.getElementById(id);
  const count = value => Math.max(0, Number(value) || 0);
  const fields = { sessions: "Besuche", page_views: "Seitenaufrufe", active_seconds: "Aktive Zeit" };
  const days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  let data = null;
  let dateIndex = 0;
  let selectedDate = null;
  let selectedPage = null;
  let selectedJourney = null;
  let selectedCell = { weekday: 0, hour: 18 };
  let heatmapMetric = "page_views";
  const visibleSeries = new Set(["sessions", "page_views"]);
  let serverSamples = [];

  const blank = (title = "Noch keine Messwerte", description = "Die Besuchsmessung beginnt mit diesem Release.") => `<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌁</span><strong>${e(t(title))}</strong><p>${e(t(description))}</p></div>`;
  const key = row => `${row.game || "zdwa"}:${row.page}`;
  const route = (page, game) => `${pageLabel(page)} · ${gameName(game)}`;
  const dayDate = value => new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

  function trafficSelection(index) {
    const rows = data?.daily || [];
    if (!rows.length) return;
    dateIndex = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[dateIndex];
    selectedDate = row.date;
    $("dailyCursor").value = dateIndex;
    $("dailySelection").innerHTML = `<strong>${e(dayDate(row.date))} <small>UTC</small></strong><span><i class="legend-dot cyan"></i>${e(t("Besuche"))}<b>${number(row.sessions)}</b></span><span><i class="legend-dot amber"></i>${e(t("Seitenaufrufe"))}<b>${number(row.page_views)}</b></span><span>${e(t("Aktive Zeit"))}<b>${e(duration(row.active_seconds))}</b></span>`;
    const svg = $("dailyChart").querySelector("svg");
    if (!svg) return;
    const max = Number(svg.dataset.maximum);
    const x = 43 + dateIndex * 654 / Math.max(1, rows.length - 1);
    const y = value => 16 + 179 - count(value) / max * 179;
    $("dailyCursorLine").setAttribute("x1", x);
    $("dailyCursorLine").setAttribute("x2", x);
    for (const metric of ["sessions", "page_views"]) {
      const marker = svg.querySelector(`[data-marker="${metric}"]`);
      if (marker) { marker.setAttribute("cx", x); marker.setAttribute("cy", y(row[metric])); }
    }
  }

  function traffic() {
    const rows = data.daily || [];
    $("trafficControls").hidden = !rows.length || !rows.some(row => count(row.sessions) || count(row.page_views));
    if ($("trafficControls").hidden) { $("dailyChart").innerHTML = blank(); return; }
    const maxValue = Math.max(1, ...rows.flatMap(row => [...visibleSeries].map(metric => count(row[metric]))));
    const scale = 10 ** Math.floor(Math.log10(maxValue));
    const maximum = Math.max(4, Math.ceil(maxValue / scale) * scale);
    const x = index => 43 + index * 654 / Math.max(1, rows.length - 1);
    const y = value => 195 - count(value) / maximum * 179;
    const points = metric => rows.map((row, index) => `${x(index).toFixed(2)},${y(row[metric]).toFixed(2)}`).join(" ");
    const axes = Array.from({ length: 5 }, (_, index) => `<line class="chart-gridline" x1="43" x2="697" y1="${y(maximum * index / 4)}" y2="${y(maximum * index / 4)}"/><text class="chart-axis" x="32" y="${y(maximum * index / 4) + 3}" text-anchor="end">${number(maximum * index / 4)}</text>`).join("");
    const labels = [...new Set([0, Math.floor((rows.length - 1) / 3), Math.floor((rows.length - 1) * 2 / 3), rows.length - 1])].map(index => `<text class="chart-axis" x="${x(index)}" y="222" text-anchor="${index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}">${e(dayDate(rows[index].date).replace(/[^0-9]*\d{4}$/, ""))}</text>`).join("");
    const lines = [...visibleSeries].map(metric => `<polyline class="chart-line chart-line-draw" stroke="${metric === "sessions" ? "#6ee7de" : "#f4c77b"}" points="${points(metric)}"/><circle data-marker="${metric}" r="4" fill="${metric === "sessions" ? "#6ee7de" : "#f4c77b"}" stroke="#101925" stroke-width="2"/>`).join("");
    $("dailyChart").innerHTML = `<svg viewBox="0 0 720 230" data-maximum="${maximum}" role="img" aria-label="${e(t("Besuche und Seitenaufrufe je UTC-Tag"))}"><defs><linearGradient id="trafficFade" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#6ee7de" stop-opacity=".25"/><stop offset="1" stop-color="#6ee7de" stop-opacity="0"/></linearGradient></defs>${axes}${visibleSeries.has("sessions") ? `<polygon points="43,195 ${points("sessions")} ${x(rows.length - 1)},195" fill="url(#trafficFade)"/>` : ""}${labels}<line id="dailyCursorLine" class="chart-cursor" y1="16" y2="195"/>${lines}</svg>`;
    $("dailyCursor").max = rows.length - 1;
    const previousIndex = rows.findIndex(row => row.date === selectedDate);
    trafficSelection(previousIndex < 0 ? rows.length - 1 : previousIndex);
  }

  function heatmapSelection(weekday, hour) {
    selectedCell = { weekday, hour };
    $("heatmapDay").value = weekday;
    $("heatmapHour").value = hour;
    const row = (data?.heatmap || []).find(row => Number(row.weekday) === weekday && Number(row.hour) === hour) || {};
    $("heatmapSelection").innerHTML = `<strong>${e(t(days[weekday]))} · ${String(hour).padStart(2, "0")}:00 UTC</strong><span>${e(t("Besuche"))}<b>${number(row.sessions || 0)}</b></span><span>${e(t("Seitenaufrufe"))}<b>${number(row.page_views || 0)}</b></span><span>${e(t("Aktive Zeit"))}<b>${e(duration(row.active_seconds || 0))}</b></span>`;
    for (const cell of $("activityHeatmap").querySelectorAll("[data-weekday]")) cell.classList.toggle("is-selected", Number(cell.dataset.weekday) === weekday && Number(cell.dataset.hour) === hour);
  }

  function heatmap() {
    const rows = data.heatmap || [];
    const maximum = Math.max(1, ...rows.map(row => count(row[heatmapMetric])));
    const byCell = new Map(rows.map(row => [`${row.weekday}:${row.hour}`, row]));
    const cells = Array.from({ length: 168 }, (_, index) => {
      const weekday = Math.floor(index / 24);
      const hour = index % 24;
      const row = byCell.get(`${weekday}:${hour}`) || {};
      const value = count(row[heatmapMetric]);
      const opacity = value ? .15 + Math.sqrt(value / maximum) * .85 : 0;
      return `<rect data-weekday="${weekday}" data-hour="${hour}" x="${54 + hour * 26}" y="${29 + weekday * 23}" width="22" height="18" rx="3" fill="${value ? `rgba(110,231,222,${opacity})` : "#1d2a3a"}"><title>${e(t(days[weekday]))} ${String(hour).padStart(2, "0")}:00 UTC · ${heatmapMetric === "active_seconds" ? e(duration(value)) : number(value)} ${e(t(fields[heatmapMetric]))}</title></rect>`;
    }).join("");
    const rowLabels = days.map((day, index) => `<text class="chart-axis" x="41" y="${42 + index * 23}" text-anchor="end">${e(t(day).slice(0, 2))}</text>`).join("");
    const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21, 23].map(hour => `<text class="chart-axis" x="${65 + hour * 26}" y="16" text-anchor="middle">${String(hour).padStart(2, "0")}</text>`).join("");
    $("activityHeatmap").innerHTML = `<svg viewBox="0 0 700 198" role="img" aria-label="${e(t("Aktivität nach Wochentag und UTC-Stunde"))}">${hourLabels}${rowLabels}${cells}</svg>`;
    $("heatmapEmpty").hidden = rows.some(row => count(row.page_views) || count(row.active_seconds));
    heatmapSelection(selectedCell.weekday, selectedCell.hour);
  }

  function choosePage(index) {
    const rows = (data?.pages || []).slice(0, 12);
    const row = rows[index];
    if (!row) return;
    selectedPage = key(row);
    $("pageFocus").value = index;
    $("pageDetail").innerHTML = `<div class="detail-title"><strong>${e(pageLabel(row.page))}</strong><span class="game-badge">${gameName(row.game)}</span></div><div class="detail-metrics">${[["Aufrufe", number(row.views)], ["Besuche", number(row.sessions)], ["Aktive Zeit", duration(row.active_seconds)], ["Ø je Besuch", duration(row.avg_active_seconds)]].map(([label, value]) => `<span>${e(t(label))}<b>${e(value)}</b></span>`).join("")}</div>`;
    for (const point of $("pageBubbles").querySelectorAll("[data-page-index]")) {
      const selected = Number(point.dataset.pageIndex) === index;
      point.classList.toggle("is-selected", selected);
      point.setAttribute("aria-pressed", selected);
    }
  }

  function bubbles() {
    const rows = (data.pages || []).slice(0, 12);
    $("pageBubbleControls").hidden = !rows.length;
    if (!rows.length) { $("pageBubbles").innerHTML = blank(); $("pageDetail").innerHTML = ""; return; }
    const maxViews = Math.max(1, ...rows.map(row => count(row.views))) * 1.15;
    const maxDuration = Math.max(1, ...rows.map(row => count(row.avg_active_seconds))) * 1.18;
    const maxVisits = Math.max(1, ...rows.map(row => count(row.sessions)));
    const x = value => 69 + count(value) / maxViews * 548;
    const y = value => 237 - count(value) / maxDuration * 199;
    const grid = [0, .25, .5, .75, 1].map(fraction => `<line class="chart-gridline" x1="69" x2="617" y1="${y(fraction * maxDuration)}" y2="${y(fraction * maxDuration)}"/><text class="chart-axis" x="56" y="${y(fraction * maxDuration) + 3}" text-anchor="end">${e(duration(fraction * maxDuration))}</text><text class="chart-axis" x="${x(fraction * maxViews)}" y="261" text-anchor="middle">${number(fraction * maxViews)}</text>`).join("");
    const points = rows.map((row, index) => `<g class="page-point" data-page-index="${index}" role="button" tabindex="0" aria-pressed="false" aria-label="${e(route(row.page, row.game))}, ${number(row.views)} ${e(t("Aufrufe"))}, ${e(duration(row.avg_active_seconds))} ${e(t("Ø je Besuch"))}"><circle class="bubble-halo" cx="${x(row.views)}" cy="${y(row.avg_active_seconds)}" r="${Math.max(5, Math.sqrt(count(row.sessions) / maxVisits) * 27) + 7}"/><circle class="bubble-core" cx="${x(row.views)}" cy="${y(row.avg_active_seconds)}" r="${Math.max(5, Math.sqrt(count(row.sessions) / maxVisits) * 27)}" fill="${row.game === "zilch" ? "#f4c77b" : "#6ee7de"}"/><text class="bubble-label" x="${x(row.views)}" y="${y(row.avg_active_seconds) - Math.max(5, Math.sqrt(count(row.sessions) / maxVisits) * 27) - 11}" text-anchor="middle">${index + 1}</text></g>`).join("");
    $("pageBubbles").innerHTML = `<svg viewBox="0 0 680 287" role="group" aria-label="${e(t("Aufrufe gegen durchschnittliche aktive Zeit"))}">${grid}${points}<text class="chart-axis axis-name" x="345" y="285" text-anchor="middle">${e(t("Aufrufe"))} →</text></svg>`;
    $("pageFocus").innerHTML = rows.map((row, index) => `<option value="${index}">${index + 1}. ${e(route(row.page, row.game))}</option>`).join("");
    const retained = rows.findIndex(row => key(row) === selectedPage);
    choosePage(retained < 0 ? 0 : retained);
  }

  function chooseJourney(index) {
    const row = data?.journeys?.links?.[index];
    if (!row) return;
    selectedJourney = `${row.from_game}:${row.from}:${row.to_game}:${row.to}`;
    $("journeyFocus").value = index;
    $("journeyDetail").innerHTML = `<strong>${e(route(row.from, row.from_game))}<span aria-hidden="true"> → </span>${e(route(row.to, row.to_game))}</strong><span>${e(t("Gemessene Wechsel"))}<b>${number(row.count)}</b></span>`;
    for (const edge of $("journeyFlow").querySelectorAll("[data-journey-index]")) {
      const selected = Number(edge.dataset.journeyIndex) === index;
      edge.classList.toggle("is-selected", selected);
      edge.setAttribute("aria-pressed", selected);
    }
  }

  function journeys() {
    const rows = data.journeys?.links || [];
    $("journeyControls").hidden = !rows.length;
    if (!rows.length) { $("journeyFlow").innerHTML = blank("Noch keine gemessenen Seitenwechsel", "Direkte Besuche oder einzelne Seitenaufrufe ergeben noch keinen Weg."); $("journeyDetail").innerHTML = ""; }
    else {
      const shown = rows.slice(0, 10);
      const fromNodes = [...new Map(shown.map(row => [`${row.from_game}:${row.from}`, { page: row.from, game: row.from_game }])).values()];
      const toNodes = [...new Map(shown.map(row => [`${row.to_game}:${row.to}`, { page: row.to, game: row.to_game }])).values()];
      const height = Math.max(220, Math.max(fromNodes.length, toNodes.length) * 54 + 50);
      const maxCount = Math.max(1, ...shown.map(row => count(row.count)));
      const position = (nodes, page, game) => 42 + nodes.findIndex(node => node.page === page && node.game === game) * (height - 84) / Math.max(1, nodes.length - 1);
      const links = shown.map((row, index) => {
        const sourceY = position(fromNodes, row.from, row.from_game);
        const targetY = position(toNodes, row.to, row.to_game);
        const path = `M178 ${sourceY} C310 ${sourceY},410 ${targetY},542 ${targetY}`;
        return `<g class="journey-link" data-journey-index="${index}" role="button" tabindex="0" aria-pressed="false" aria-label="${e(route(row.from, row.from_game))} → ${e(route(row.to, row.to_game))}: ${number(row.count)}"><path d="${path}" fill="none" stroke="${row.from_game === "zilch" ? "#f4c77b" : "#6ee7de"}" stroke-width="${2 + Math.sqrt(count(row.count) / maxCount) * 12}" class="flow-strand"/><path d="${path}" fill="none" stroke="transparent" stroke-width="24"/><title>${number(row.count)} ${e(t("Gemessene Wechsel"))}</title></g>`;
      }).join("");
      const nodes = (items, side) => items.map(node => { const y = position(items, node.page, node.game); return `<g><rect x="${side === "from" ? 169 : 537}" y="${y - 15}" width="9" height="30" rx="3" fill="${node.game === "zilch" ? "#f4c77b" : "#6ee7de"}"/><text class="flow-node-name" x="${side === "from" ? 156 : 557}" y="${y - 2}" text-anchor="${side === "from" ? "end" : "start"}">${e(pageLabel(node.page))}</text><text class="flow-node-game" x="${side === "from" ? 156 : 557}" y="${y + 13}" text-anchor="${side === "from" ? "end" : "start"}">${gameName(node.game)}</text></g>`; }).join("");
      $("journeyFlow").innerHTML = `<svg viewBox="0 0 720 ${height}" role="group" aria-label="${e(t("Direkt gemessene Seitenwechsel"))}">${links}${nodes(fromNodes, "from")}${nodes(toNodes, "to")}</svg>`;
      $("journeyFocus").innerHTML = rows.map((row, index) => `<option value="${index}">${e(route(row.from, row.from_game))} → ${e(route(row.to, row.to_game))} (${number(row.count)})</option>`).join("");
      const retained = rows.findIndex(row => `${row.from_game}:${row.from}:${row.to_game}:${row.to}` === selectedJourney);
      chooseJourney(retained < 0 ? 0 : retained);
    }
    const sample = data.journeys?.sample;
    $("journeySample").textContent = sample ? `${t(sample.truncated ? "Stichprobe der neuesten Seitenaufrufe" : "Ausgewertete Seitenaufrufe")}: ${number(sample.page_views)} / ${number(sample.total_page_views)}. ${t("Nur direkt aufeinanderfolgende Aufrufe im selben Tab, mit höchstens 30 Minuten Abstand.")}` : t("Nur direkt aufeinanderfolgende Aufrufe im selben Tab, mit höchstens 30 Minuten Abstand.");
    $("journeyTable").innerHTML = `<div class="data-scroll"><table><caption class="sr-only">${e(t("Direkt gemessene Seitenwechsel"))}</caption><thead><tr>${["Von", "Nach", "Gemessene Wechsel"].map(label => `<th scope="col">${e(t(label))}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr><td>${e(route(row.from, row.from_game))}</td><td>${e(route(row.to, row.to_game))}</td><td>${number(row.count)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function devices() {
    const rows = data.devices || [];
    const total = rows.reduce((sum, row) => sum + count(row.sessions), 0);
    if (!total) { $("deviceDonut").innerHTML = ""; return; }
    let offset = 0;
    const circumference = 2 * Math.PI * 42;
    const colors = ["#6ee7de", "#9dbcd4", "#f4c77b", "#67768a"];
    const segments = rows.map((row, index) => { const length = count(row.sessions) / total * circumference; const segment = `<circle cx="55" cy="55" r="42" fill="none" stroke="${colors[index % colors.length]}" stroke-width="8" stroke-dasharray="${Math.max(0, length - 3)} ${circumference - Math.max(0, length - 3)}" stroke-dashoffset="${-offset}"/>`; offset += length; return segment; }).join("");
    $("deviceDonut").innerHTML = `<svg viewBox="0 0 110 110" role="img" aria-label="${e(t("Geräteverteilung nach Besuchen"))}"><g transform="rotate(-90 55 55)">${segments}</g><text x="55" y="54" text-anchor="middle" class="donut-count">${number(total)}</text><text x="55" y="70" text-anchor="middle" class="donut-caption">${e(t("Besuche"))}</text></svg>`;
  }

  function serverTrend() {
    const snapshot = data.server || {};
    const measurement = snapshot.measurement_at || data.generated_at;
    if (serverSamples.at(-1)?.time !== measurement) serverSamples.push({ time: measurement, cpu: snapshot.cpu?.percent, memory: snapshot.memory?.percent, disk: snapshot.disk?.percent });
    serverSamples = serverSamples.slice(-120);
    $("serverTrendNote").textContent = `${t("Nur Messpunkte seit dem Öffnen dieses Dashboards. Kein gespeicherter Serververlauf.")} ${serverSamples.length ? `${t("Beginn")}: ${new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(serverSamples[0].time))}` : ""}`;
    if (serverSamples.length < 2) { $("serverTrend").innerHTML = blank("Verlauf beginnt jetzt", "Nach zwei Aktualisierungen erscheinen die ersten Verbindungslinien."); return; }
    const series = ["cpu", "memory", "disk"].filter(metric => serverSamples.some(row => row[metric] != null));
    if (!series.length) { $("serverTrend").innerHTML = blank("Noch keine Messwerte", "Striche bedeuten: Messwert nicht verfügbar."); return; }
    const first = new Date(serverSamples[0].time).getTime();
    const last = new Date(serverSamples.at(-1).time).getTime();
    const x = row => 40 + (new Date(row.time).getTime() - first) / Math.max(1, last - first) * 650;
    const y = value => 110 - count(value) / 100 * 88;
    const colors = { cpu: "#6ee7de", memory: "#9dbcd4", disk: "#f4c77b" };
    const lines = series.map(metric => {
      const paths = [];
      let continuous = false;
      for (const row of serverSamples) {
        if (row[metric] == null) { continuous = false; continue; }
        paths.push(`${continuous ? "L" : "M"}${x(row).toFixed(2)},${y(row[metric]).toFixed(2)}`);
        continuous = true;
      }
      return `<path d="${paths.join(" ")}" fill="none" stroke="${colors[metric]}" stroke-width="2"/>`;
    }).join("");
    const axis = [0, 50, 100].map(value => `<line class="chart-gridline" x1="40" x2="690" y1="${y(value)}" y2="${y(value)}"/><text class="chart-axis" x="30" y="${y(value) + 3}" text-anchor="end">${value}%</text>`).join("");
    $("serverTrend").innerHTML = `<svg viewBox="0 0 720 137" role="img" aria-label="${e(t("Serverauslastung seit dem Öffnen"))}">${axis}${lines}</svg>`;
  }

  $("dailyCursor").addEventListener("input", event => trafficSelection(Number(event.target.value)));
  $("dailyChart").addEventListener("pointermove", event => {
    const svg = $("dailyChart").querySelector("svg");
    if (!svg || !data?.daily?.length) return;
    const box = svg.getBoundingClientRect();
    const position = (event.clientX - box.left) / box.width * 720;
    trafficSelection(Math.round((position - 43) / 654 * (data.daily.length - 1)));
  });
  $("trafficSeries").addEventListener("click", event => {
    const button = event.target.closest("[data-series]");
    if (!button) return;
    const metric = button.dataset.series;
    if (visibleSeries.has(metric) && visibleSeries.size === 1) return;
    if (visibleSeries.has(metric)) visibleSeries.delete(metric); else visibleSeries.add(metric);
    for (const toggle of $("trafficSeries").querySelectorAll("[data-series]")) toggle.setAttribute("aria-pressed", visibleSeries.has(toggle.dataset.series));
    traffic();
  });
  $("heatmapDay").innerHTML = days.map((day, index) => `<option value="${index}">${e(t(day))}</option>`).join("");
  $("heatmapHour").innerHTML = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}">${String(hour).padStart(2, "0")}:00 UTC</option>`).join("");
  $("heatmapDay").addEventListener("change", event => heatmapSelection(Number(event.target.value), selectedCell.hour));
  $("heatmapHour").addEventListener("change", event => heatmapSelection(selectedCell.weekday, Number(event.target.value)));
  $("heatmapMetric").addEventListener("change", event => { heatmapMetric = event.target.value; heatmap(); });
  $("activityHeatmap").addEventListener("click", event => { const cell = event.target.closest("[data-weekday]"); if (cell) heatmapSelection(Number(cell.dataset.weekday), Number(cell.dataset.hour)); });
  $("pageFocus").addEventListener("change", event => choosePage(Number(event.target.value)));
  $("pageBubbles").addEventListener("click", event => { const point = event.target.closest("[data-page-index]"); if (point) choosePage(Number(point.dataset.pageIndex)); });
  $("pageBubbles").addEventListener("keydown", event => { const point = event.target.closest("[data-page-index]"); if (point && ["Enter", " "].includes(event.key)) { event.preventDefault(); choosePage(Number(point.dataset.pageIndex)); } });
  $("journeyFocus").addEventListener("change", event => chooseJourney(Number(event.target.value)));
  $("journeyFlow").addEventListener("click", event => { const link = event.target.closest("[data-journey-index]"); if (link) chooseJourney(Number(link.dataset.journeyIndex)); });
  $("journeyFlow").addEventListener("keydown", event => { const link = event.target.closest("[data-journey-index]"); if (link && ["Enter", " "].includes(event.key)) { event.preventDefault(); chooseJourney(Number(link.dataset.journeyIndex)); } });

  return {
    update(next) { data = next; traffic(); heatmap(); bubbles(); journeys(); devices(); serverTrend(); },
    resetSession() { data = null; serverSamples = []; $("serverTrend").innerHTML = ""; $("serverTrendNote").textContent = ""; },
  };
}
