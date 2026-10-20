// The browser reports transport payload, never an authoritative billing total.
export function renderVoiceUsage(data, { byId, t, e, number, timestamp, utcDay, locale }) {
  const usage = data.voice_usage;
  const panel = byId("voiceUsagePanel");
  panel.hidden = !usage;
  for (const id of ["voiceUsageSummary", "voiceUsageDaily", "voiceUsageUpdated"]) byId(id).replaceChildren();
  if (!usage) return;
  const volume = value => {
    if (value == null) return "—";
    const amount = Math.max(0, Number(value) || 0);
    const unit = amount >= 1e9 ? "GB" : amount >= 1e6 ? "MB" : amount >= 1e3 ? "kB" : "B";
    const divisor = unit === "GB" ? 1e9 : unit === "MB" ? 1e6 : unit === "kB" ? 1e3 : 1;
    return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(amount / divisor)} ${unit}`;
  };
  if (!usage.first_reported_at) {
    byId("voiceUsageSummary").innerHTML = `<div class="empty-state"><strong>${e(t("Noch keine Audio-Messmeldungen"))}</strong><p>${e(t("Die Messung beginnt mit dem ersten aktiven Sprachchat. Fehlende Meldungen sind kein Beleg für null Verbrauch."))}</p></div>`;
    return;
  }
  const metrics = [
    ["Empfangen im Zeitraum", usage.period?.reports ? usage.period.received_bytes : null, "Vom Audiodienst zu den Spielern"],
    ["Gesendet im Zeitraum", usage.period?.reports ? usage.period.sent_bytes : null, "Von den Spielern zum Audiodienst"],
    ["Empfangen im laufenden Monat", usage.month?.reports ? usage.month.received_bytes : null, "UTC-Kalendermonat, unabhängig vom Zeitraumfilter"],
    ["Gesendet im laufenden Monat", usage.month?.reports ? usage.month.sent_bytes : null, "UTC-Kalendermonat, unabhängig vom Zeitraumfilter"],
  ];
  byId("voiceUsageSummary").innerHTML = metrics.map(([label, value, hint]) => `<div class="request-metric"><span>${e(t(label))}</span><strong>${e(volume(value))}</strong><small>${e(t(hint))}</small></div>`).join("");
  byId("voiceUsageUpdated").textContent = `${t("Letzte Audio-Messmeldung")}: ${timestamp(usage.last_reported_at)} · ${number(usage.period?.reports)} ${t("Messmeldungen im Zeitraum")}`;
  const rows = usage.daily || [];
  byId("voiceUsageDaily").innerHTML = `<div class="data-scroll"><table><caption>${e(t("Audio-Nutzdaten je UTC-Tag"))}</caption><thead><tr>${["UTC-Tag", "Empfang", "Versand", "Meldungen"].map(label => `<th scope="col">${e(t(label))}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${e(utcDay(`${row.day}T00:00:00Z`))}</th><td>${e(row.reports ? volume(row.received_bytes) : "—")}</td><td>${e(row.reports ? volume(row.sent_bytes) : "—")}</td><td>${e(number(row.reports))}</td></tr>`).join("")}</tbody></table></div>`;
}
