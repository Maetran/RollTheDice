const STORAGE_PREFIX = "rollthedice:dashboard:favorites:";
const PRIMARY_PANELS = {
  geography: "panel-geography", traffic: "panel-traffic", games: "panel-games",
  designs: "panel-design-comparison", server: "panel-server",
};
const PANEL_TARGETS = [
  ["geographyViz", "geography"], ["requestTrafficSummary", "http-requests"],
  ["dailyChart", "traffic"], ["hourlyChart", "hourly"], ["activityHeatmap", "heatmap"],
  ["referrerRanks", "referrers"], ["deviceRanks", "devices"], ["countryRanks", "countries"],
  ["appModeChart", "launch"], ["browserRanks", "browsers"], ["browserLanguageRanks", "browser-languages"],
  ["pwaInstalledCount", "pwa-growth"], ["pageBubbles", "pages"], ["journeyFlow", "journeys"],
  ["gameCards", "games"], ["actionRanks", "actions"], ["designComparison", "design-comparison"],
  ["designAccounts", "design-accounts"], ["designLooks", "design-looks"], ["serverGauges", "server"],
];

/** Move the real dashboard elements, keeping their controls and IDs intact. */
export function createFavorites({ t, number, doc = document } = {}) {
  const entries = new Map();
  const section = doc.getElementById("dashboardFavorites");
  const grid = doc.getElementById("dashboardFavoritesGrid");
  const empty = doc.getElementById("dashboardFavoritesEmpty");
  const count = doc.getElementById("dashboardFavoritesCount");
  const status = doc.getElementById("dashboardFavoritesStatus");
  let userId = null;
  let selected = [];
  let enabled = false;
  let persistent = true;
  let pendingFocus = null;
  let initialHashResolved = false;

  const labelFor = node => {
    const metric = node.querySelector(".metric-label");
    if (metric) return metric.textContent.trim();
    const labelled = element => (element?.getAttribute("aria-labelledby") || "").split(/\s+/)
      .map(id => doc.getElementById(id)?.textContent.trim()).filter(Boolean).join(" ");
    return labelled(node)
      || node.querySelector(":scope > .panel-heading h3")?.textContent.trim()
      || labelled(node.closest(".dashboard-section"))
      || node.querySelector("h3")?.textContent.trim()
      || "";
  };

  function persistenceNote() {
    return t(persistent ? "Favoriten werden nur in diesem Browser gespeichert."
      : "Browserspeicher nicht verfügbar. Favoriten gelten nur für diese geöffnete Seite.");
  }

  function restore(entry) {
    const { node, anchor } = entry;
    if (anchor.parentNode && anchor.nextSibling !== node) anchor.parentNode.insertBefore(node, anchor.nextSibling);
  }

  function pinnedHashTarget(hash) {
    if (!enabled || userId === null) return null;
    const id = PRIMARY_PANELS[String(hash).replace(/^#/, "")];
    const entry = entries.get(id);
    return entry && selected.includes(id) && entry.node.parentElement === grid && !entry.node.hidden ? entry.node : null;
  }

  function showPinnedHash(hash, focus = false) {
    const node = pinnedHashTarget(hash);
    if (!node) return false;
    if (focus) {
      const target = node.querySelector(":scope > .panel-heading h3")
        || node.querySelector("button:not(.favorite-toggle):not([hidden]), h3")
        || node;
      if (!target.matches("button, a, input, select, textarea, [tabindex]")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    const paused = doc.documentElement.dataset.motion === "paused"
      || doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "start", behavior: focus && !paused ? "smooth" : "instant" });
    return true;
  }

  // Section links keep their public fragment, even when their main panel has
  // moved into the private focus area. Back/forward and bookmarked fragments
  // consequently reach the same chart without changing its favorite state.
  doc.addEventListener("click", event => {
    const link = event.target.closest?.('.mission-sections a[href^="#"]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !pinnedHashTarget(link.hash)) return;
    event.preventDefault();
    if (doc.defaultView.location.hash !== link.hash) doc.defaultView.history.pushState(null, "", link.hash);
    showPinnedHash(link.hash, true);
  });
  doc.defaultView.addEventListener("hashchange", () => showPinnedHash(doc.defaultView.location.hash, true));

  function sync() {
    const active = enabled && userId !== null;
    const focused = doc.activeElement;
    const visible = selected.map(id => entries.get(id)).filter(entry => entry && !entry.node.hidden);
    const pinned = new Set(active ? visible.map(entry => entry.node) : []);
    for (const entry of entries.values()) {
      entry.button.hidden = !active;
      const isSelected = selected.includes(entry.id);
      entry.button.setAttribute("aria-pressed", String(isSelected));
      entry.button.setAttribute("aria-label", `${t(isSelected ? "Aus Favoriten entfernen" : "Als Favorit merken")}: ${labelFor(entry.node)}`);
      if (!pinned.has(entry.node)) restore(entry);
    }
    if (active && grid) {
      visible.forEach((entry, index) => {
        if (grid.children[index] !== entry.node) grid.insertBefore(entry.node, grid.children[index] || null);
      });
    }
    if (section) section.hidden = !active;
    if (empty) empty.hidden = active && visible.length > 0;
    if (count) count.textContent = number(active ? visible.length : 0);
    if (focused?.isConnected && doc.activeElement !== focused && !focused.hidden) focused.focus({ preventScroll: true });
    if (pendingFocus) {
      const button = entries.get(pendingFocus)?.button;
      if (active && button) button.focus({ preventScroll: true });
      pendingFocus = null;
    }
  }

  function toggle(id) {
    if (!enabled || userId === null) return;
    const entry = entries.get(id);
    if (!entry) return;
    const label = labelFor(entry.node);
    const remove = selected.includes(id);
    selected = remove ? selected.filter(value => value !== id) : [...selected, id];
    try {
      doc.defaultView.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(selected));
      persistent = true;
    } catch { persistent = false; }
    sync();
    if (status) status.textContent = `${label}: ${t(remove ? "Aus Favoriten entfernt." : "Zu Favoriten hinzugefügt.")} ${persistenceNote()}`;
    // Moving an element can release browser focus; keep the action reachable.
    entry.button.focus({ preventScroll: true });
    const paused = doc.documentElement.dataset.motion === "paused"
      || doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;
    entry.button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: paused ? "instant" : "smooth" });
  }

  function register(node, id, kind) {
    if (!node || !grid || entries.has(id)) return;
    const anchor = doc.createComment(`favorite:${id}`);
    node.before(anchor);
    node.dataset.favoriteId = id;
    node.dataset.favoriteKind = kind;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "favorite-toggle";
    button.dataset.favoriteToggle = id;
    button.hidden = true;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.64L21 9.55l-4.5 4.39 1.06 6.2L12 17.21l-5.56 2.93 1.06-6.2L3 9.55l6.22-.91Z"/></svg>';
    button.addEventListener("click", () => toggle(id));
    node.prepend(button);
    entries.set(id, { id, node, anchor, button, kind });
  }

  return {
    setUser(value) {
      const nextUser = /^\d+$/.test(String(value)) ? String(value) : null;
      if (nextUser === userId) return;
      userId = nextUser;
      selected = [];
      persistent = true;
      if (userId !== null) {
        let raw = "[]";
        try {
          raw = doc.defaultView.localStorage.getItem(`${STORAGE_PREFIX}${userId}`) || "[]";
        } catch { persistent = false; }
        try {
          const stored = JSON.parse(raw);
          if (Array.isArray(stored)) selected = [...new Set(stored.filter(id => typeof id === "string" && /^(metric|panel)-[a-z0-9-]{1,80}$/.test(id)))].slice(0, 100);
        } catch { /* Ignore corrupt preferences; the next selection repairs them. */ }
      }
      if (status) status.textContent = userId === null ? "" : persistenceNote();
      sync();
    },
    setEnabled(value) {
      enabled = Boolean(value);
      sync();
    },
    beforeMetricsRender() {
      const focused = doc.activeElement;
      for (const [id, entry] of entries) {
        if (entry.kind !== "metric") continue;
        if (entry.button === focused) pendingFocus = id;
        restore(entry);
        entry.anchor.remove();
        entry.button.remove();
        entries.delete(id);
      }
    },
    refresh() {
      for (const metric of doc.querySelectorAll("#overviewMetrics .metric-card[data-favorite-id]")) {
        register(metric, metric.dataset.favoriteId, "metric");
      }
      for (const [target, id] of PANEL_TARGETS) register(doc.getElementById(target)?.closest("article.panel"), `panel-${id}`, "panel");
      sync();
      if (!initialHashResolved && enabled && userId !== null) {
        initialHashResolved = true;
        showPinnedHash(doc.defaultView.location.hash);
      }
    },
    clear() {
      enabled = false;
      userId = null;
      selected = [];
      pendingFocus = null;
      initialHashResolved = false;
      for (const entry of entries.values()) {
        restore(entry);
        entry.anchor.remove();
        entry.button.remove();
      }
      entries.clear();
      grid?.replaceChildren();
      if (status) status.replaceChildren();
      if (count) count.replaceChildren();
      if (section) section.hidden = true;
      if (empty) empty.hidden = false;
    },
  };
}
