import { apiFetch } from "./auth.js";
import { zdwaPath, zilchPath } from "../multigame/routes.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const endpoint = "/api/web-push/allowlist";

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function playerProfileHref(username, context = "zdwa") {
  return (context === "zilch" ? zilchPath : zdwaPath)(`/spieler/${encodeURIComponent(username)}`);
}

function accountHref(context) {
  return (context === "zilch" ? zilchPath : zdwaPath)("/konto#settings");
}

function errorText(error) {
  const messages = {
    push_allowlist_limit: "Du kannst höchstens 100 Spieler auswählen.",
    push_allowlist_invalid: "Dieser Spieler kann nicht hinzugefügt werden. Wähle ein anderes aktives Konto.",
    allowlist_viewer_changed: "Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.",
    authentication_required: "Bitte melde dich an, um deine Spielerauswahl zu verwalten.",
  };
  return t(messages[error?.message] || "Die Spielerauswahl ist gerade nicht erreichbar. Bitte versuche es erneut.");
}

async function request(path = "", options = {}) {
  const response = await apiFetch(endpoint + path, { ...options, signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "allowlist_unavailable");
  return data;
}

function mountController(mount, render, context) {
  let data = null;
  let epoch = 0;
  let busy = false;
  const message = element("p", "", "player-allowlist-message");
  message.setAttribute("role", "status");
  const controls = element("div", "", "player-allowlist-controls");
  mount.classList.add("player-allowlist");
  mount.replaceChildren(controls, message);

  async function refresh() {
    const expectedEpoch = ++epoch;
    try {
      const result = await request();
      if (expectedEpoch !== epoch || !mount.isConnected) return;
      data = result;
      message.textContent = "";
      render(controls, data, mutate);
    } catch (error) {
      if (expectedEpoch !== epoch || !mount.isConnected) return;
      data = null;
      mount.hidden = false;
      controls.replaceChildren();
      message.textContent = errorText(error);
      if (error.message === "authentication_required") {
        const link = element("a", t("Anmelden"));
        link.href = (context === "zilch" ? zilchPath : zdwaPath)("/");
        controls.append(link);
      } else {
        const retry = element("button", t("Erneut versuchen"), "small ghost");
        retry.type = "button";
        retry.addEventListener("click", refresh);
        controls.append(retry);
      }
    }
  }

  async function mutate(path, method, extra = {}) {
    if (busy || !data) return;
    busy = true;
    const expectedViewer = data.viewer_id;
    const expectedEpoch = ++epoch;
    controls.querySelectorAll("button, select").forEach(node => { node.disabled = true; });
    message.textContent = t("Spielerauswahl wird gespeichert …");
    try {
      const result = await request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viewer_id: expectedViewer, ...extra }) });
      if (epoch !== expectedEpoch || !mount.isConnected) return;
      if (result.viewer_id !== expectedViewer) throw new Error("allowlist_viewer_changed");
      data = result;
      render(controls, data, mutate);
      message.textContent = t("Spielerauswahl gespeichert.");
    } catch (error) {
      if (epoch === expectedEpoch && mount.isConnected) {
        message.textContent = errorText(error);
        controls.querySelectorAll("button, select").forEach(node => { node.disabled = false; });
      }
    } finally { busy = false; }
  }

  // An old profile/settings screen must never act on another account's list.
  window.addEventListener("zdwa:auth-state", event => {
    const viewer = event.detail?.authenticated ? event.detail.user?.id : null;
    if (data?.viewer_id === viewer) return;
    data = null;
    mount.hidden = false;
    controls.replaceChildren();
    void refresh();
  });
  message.textContent = t("Spielerauswahl wird geladen …");
  void refresh();
}

export function mountProfileAllowlist(mount, { userId, context = "zdwa" }) {
  if (!mount || !Number.isInteger(Number(userId)) || Number(userId) <= 0) return;
  mountController(mount, (controls, data, mutate) => {
    controls.replaceChildren();
    mount.hidden = data.viewer_id === Number(userId);
    if (mount.hidden) return;
    const selected = data.players.some(player => player.id === Number(userId));
    const button = element("button", t(selected ? "Aus Spielerauswahl entfernen" : "Zur Spielerauswahl hinzufügen"), "small ghost");
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.addEventListener("click", () => mutate(`/${Number(userId)}`, selected ? "DELETE" : "PUT"));
    const hint = element("p", t(data.audience === "allowlist"
      ? "Nur ausgewählte Spieler dürfen dich per Push einladen, wenn du Mitspieler-Einladungen aktiviert hast."
      : "Aktuell erlaubst du Einladungen von allen Spielern. Im Konto kannst du deine Auswahl als Filter aktivieren."), "player-allowlist-hint");
    const link = element("a", t("Spielerauswahl im Konto verwalten"));
    link.href = accountHref(context);
    controls.append(button, hint, link);
  }, context);
}

export function mountAllowlistSettings(mount, { context = "zdwa" } = {}) {
  if (!mount) return;
  mountController(mount, (controls, data, mutate) => {
    const form = element("form", "", "player-allowlist-audience");
    const label = element("label", t("Einladungen akzeptieren von"));
    const select = element("select");
    select.name = "inviteAudience";
    for (const [value, text] of [["all", "Allen Spielern"], ["allowlist", "Nur ausgewählten Spielern"]]) {
      const option = element("option", t(text));
      option.value = value;
      select.append(option);
    }
    select.value = data.audience;
    label.append(select);
    const save = element("button", t("Einladungsauswahl speichern"), "small primary");
    save.type = "submit";
    form.append(label, save);
    form.addEventListener("submit", event => { event.preventDefault(); void mutate("", "PUT", { audience: select.value }); });
    const hint = element("p", t("Deine private Auswahl gilt für beide Spiele, ohne Freundschaftsanfrage. Hinzufügen geht am Spielerprofil. Push wird dadurch nicht aktiviert."), "player-allowlist-hint");
    hint.append(" ", t("Mit dem Filter „Nur ausgewählte Spieler“ blockiert eine leere Liste alle Mitspieler-Einladungen."));
    const count = element("p", t("Ausgewählte Spieler: {count} / {limit}").replace("{count}", data.players.length).replace("{limit}", data.limit), "player-allowlist-count");
    const list = element("ul", "", "player-allowlist-list");
    for (const player of data.players) {
      const row = element("li");
      const name = element(player.active ? "a" : "span", player.username);
      if (player.active) name.href = playerProfileHref(player.username, context);
      const remove = element("button", t("Entfernen"), "small ghost");
      remove.type = "button";
      remove.setAttribute("aria-label", t("{name} aus Spielerauswahl entfernen").replace("{name}", player.username));
      remove.addEventListener("click", () => mutate(`/${player.id}`, "DELETE"));
      row.append(name, remove);
      if (!player.active) row.append(element("small", t("Konto deaktiviert")));
      list.append(row);
    }
    if (!data.players.length) list.append(element("li", t("Noch keine Spieler ausgewählt. Füge Spieler direkt über ihr Profil hinzu.")));
    const find = element("a", t("Spieler finden"));
    find.href = context === "zilch" ? zilchPath("/bestenlisten") : zdwaPath("/spieler");
    controls.replaceChildren(form, hint, count, list, find);
  }, context);
}
