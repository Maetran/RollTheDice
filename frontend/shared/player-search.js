import { zdwaPath, zilchPath } from "../multigame/routes.js";
import { avatarMarkup } from "./avatar.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const PAGE_SIZE = 20;

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function mountPlayerSearch(mount, { context = "zdwa", renderPlayer } = {}) {
  if (!mount) return;
  const path = context === "zilch" ? zilchPath : zdwaPath;
  const prefix = context === "zilch" ? "zilchPlayer" : "";
  const id = suffix => prefix ? `${prefix}${suffix}` : `search${suffix}`;
  mount.classList.add("player-finder");
  mount.id = "player-search";
  const heading = element("h2", t("Spieler suchen"));
  heading.id = id("Title");
  mount.setAttribute("aria-labelledby", heading.id);
  const hint = element("p", t("Finde auch Spieler ohne abgeschlossene Partie. Öffne ein Profil, um den Spieler zu deiner Auswahl hinzuzufügen."), "player-finder-hint");
  hint.id = id("Hint");
  const form = element("form", "", "player-finder-form");
  form.id = context === "zilch" ? "zilchPlayerSearchForm" : "searchForm";
  form.setAttribute("role", "search");
  const label = element("label", t("Benutzername"));
  const input = element("input");
  input.id = context === "zilch" ? "zilchPlayerSearchInput" : "searchInput";
  input.type = "search";
  input.autocomplete = "off";
  input.maxLength = 80;
  input.setAttribute("aria-describedby", hint.id);
  label.htmlFor = input.id;
  label.append(input);
  const submit = element("button", t("Suchen"), "primary");
  submit.type = "submit";
  const all = element("button", t("Alle Spieler anzeigen"), "ghost");
  all.type = "button";
  form.append(label, submit, all);
  const message = element("p", t("Benutzername eingeben oder alle anzeigen."), "player-finder-message");
  message.setAttribute("role", "status");
  const results = element("div", "", "player-search-results");
  results.id = context === "zilch" ? "zilchPlayerSearchResults" : "searchResults";
  results.setAttribute("aria-label", t("Gefundene Spieler"));
  const actions = element("div", "", "player-finder-actions");
  const more = element("button", t("Weitere Spieler laden"), "small ghost");
  more.type = "button";
  more.hidden = true;
  const retry = element("button", t("Erneut versuchen"), "small ghost");
  retry.type = "button";
  retry.hidden = true;
  const manage = element("a", t("Spielerauswahl im Konto verwalten"), "player-finder-manage");
  manage.href = path("/konto?allowlist=1#settings");
  actions.append(more, retry, manage);
  mount.replaceChildren(heading, hint, form, message, results, actions);
  let query = "";
  let offset = 0;
  let requestVersion = 0;
  let controller;

  async function search({ append = false } = {}) {
    const version = ++requestVersion;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const timeout = window.setTimeout(() => requestController.abort(), 10000);
    const restorePagingFocus = append && document.activeElement === more;
    if (!append) {
      query = input.value.trim();
      offset = 0;
      results.replaceChildren();
    }
    retry.hidden = true;
    more.hidden = true;
    mount.setAttribute("aria-busy", "true");
    message.textContent = t("Spieler werden gesucht …");
    try {
      // One extra row tells us whether another page exists, without a count
      // request or an empty final page when the result has exactly 20 rows.
      const params = new URLSearchParams({ query, limit: PAGE_SIZE + 1, offset });
      const response = await fetch(`/api/players/search?${params}`, { cache: "no-store", signal: requestController.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.players)) throw new Error("invalid_players");
      if (version !== requestVersion || !mount.isConnected) return;
      const players = payload.players.slice(0, PAGE_SIZE);
      const firstNewResult = results.childElementCount;
      for (const player of players) {
        const link = element("a", "", "player-result");
        link.href = path(`/spieler/${encodeURIComponent(player.username)}`);
        if (renderPlayer) link.innerHTML = renderPlayer(player);
        else {
          link.innerHTML = avatarMarkup(player);
          const name = element("span", player.username);
          name.setAttribute("translate", "no");
          link.append(name);
        }
        results.append(link);
      }
      offset += players.length;
      more.hidden = payload.players.length <= PAGE_SIZE;
      message.textContent = offset
        ? t("Angezeigte Spieler: {count}").replace("{count}", offset)
        : t(query
          ? "Keine Spieler gefunden. Versuche einen anderen Namen oder zeige alle Spieler an."
          : "Noch keine öffentlichen Spielerprofile vorhanden.");
      if (restorePagingFocus) results.children[firstNewResult]?.focus();
    } catch (_) {
      if (version !== requestVersion || !mount.isConnected) return;
      message.textContent = t("Die Spielersuche ist gerade nicht erreichbar. Bitte versuche es erneut.");
      retry.hidden = false;
      retry.onclick = () => { void search({ append }); };
    } finally {
      window.clearTimeout(timeout);
      if (version === requestVersion) mount.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("submit", event => { event.preventDefault(); void search(); });
  all.addEventListener("click", () => { input.value = ""; void search(); });
  more.addEventListener("click", () => { void search({ append: true }); });
  const focusFromHash = () => {
    if (window.location.hash !== "#player-search" || !mount.isConnected) return;
    mount.scrollIntoView({ block: "start" });
    input.focus({ preventScroll: true });
  };
  window.addEventListener("hashchange", focusFromHash);
  window.requestAnimationFrame(focusFromHash);
}
