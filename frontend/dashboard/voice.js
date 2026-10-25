// The browser reports transport payload, never an authoritative billing total.
export function renderVoiceUsage(data, context) {
  renderVoiceActivity(data, context);
  const { byId, t, e, number, timestamp, utcDay, locale } = context;
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

export function renderVoiceActivity(data, { byId, t, e, number, timestamp, locale }) {
  const panel = byId("voiceActivityPanel");
  if (!panel) return;
  const activity = data.voice_activity;
  panel.hidden = !activity;
  for (const id of ["voiceActivitySummary", "voiceActivityGames", "voiceActivityUsers", "voiceActivityUpdated", "voiceActivityRetained"]) byId(id).replaceChildren();
  if (!activity) return;
  byId("voiceActivityUpdated").textContent = `${t("Erste aufbewahrte Beobachtung")}: ${timestamp(activity.first_observed_at)} · ${t("Letzte Beobachtung")}: ${timestamp(activity.last_observed_at)} · ${t("Verworfene Beobachtungen seit Serverstart")}: ${number(activity.dropped_observations_since_restart)}`;
  if (!activity.first_observed_at) {
    byId("voiceActivitySummary").innerHTML = `<div class="empty-state"><strong>${e(t("Noch keine bestätigte Audio-Aktivität"))}</strong><p>${e(t("Die Messung beginnt mit autorisiertem aktivem Zuhören. Frühere Nutzung wird nicht nachgetragen."))}</p></div>`;
    return;
  }
  const minutes = value => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Math.max(0, Number(value) || 0));
  const metrics = [["Audiochat aktiviert", number(activity.period?.activations)],
    ["Partien mit Audio", number(activity.period?.games)], ["Eindeutige Konten", number(activity.period?.users)],
    ["Minuten mit aktivem Zuhören", minutes(activity.period?.connected_minutes)]];
  byId("voiceActivitySummary").innerHTML = metrics.map(([label, value]) => `<div class="request-metric"><span>${e(t(label))}</span><strong>${e(value)}</strong><small>${e(t("Im gewählten Zeitraum"))}</small></div>`).join("");
  const games = { zdwa: "ZDWA", hausdepp: "Hausdepp", watten: "Watten" };
  byId("voiceActivityGames").innerHTML = `<div class="data-scroll"><table><caption>${e(t("Audio-Aktivität je Spiel im Zeitraum"))}</caption><thead><tr>${["Spiel", "Aktivierungen", "Partien mit Audio", "Eindeutige Konten", "Minuten"].map(label => `<th scope="col">${e(t(label))}</th>`).join("")}</tr></thead><tbody>${(activity.by_game || []).map(row => `<tr><th scope="row">${e(games[row.game_type] || row.game_type)}</th><td>${e(number(row.activations))}</td><td>${e(number(row.games))}</td><td>${e(number(row.users))}</td><td>${e(minutes(row.connected_minutes))}</td></tr>`).join("")}</tbody></table></div>`;
  byId("voiceActivityUsers").innerHTML = `<div class="data-scroll"><table><caption>${e(t("Aktivste Audiochat-Konten nach Zuhörminuten"))}</caption><thead><tr><th scope="col">${e(t("Konto"))}</th><th scope="col">${e(t("Minuten"))}</th></tr></thead><tbody>${(activity.top_users || []).map(row => `<tr><th scope="row">${e(row.username)}</th><td>${e(minutes(row.connected_minutes))}</td></tr>`).join("")}</tbody></table></div>`;
  if (activity.retained) {
    const retained = activity.retained;
    byId("voiceActivityRetained").textContent = `${t("Aufbewahrter Gesamtzeitraum (höchstens 400 Tage)")}: ${number(retained.activations)} ${t("Aktivierungen")} · ${number(retained.games)} ${t("Partien mit Audio")} · ${number(retained.users)} ${t("Eindeutige Konten")} · ${minutes(retained.connected_minutes)} ${t("Minuten")}`;
  }
}
