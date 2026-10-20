import { apiFetch, loadAuth as sharedLoadAuth } from "../shared/auth.js";
import { devicePushStatusMessage, disableGameInvitePush, enableGameInvitePush,
  getGameInvitePushStatus, syncPushPreferences, webPushErrorMessage } from "../shared/web-push.js";

export function pushSettingsMarkup(copy) {
  return `<details id="wattenPushSettings" data-watten-push-settings><summary>${copy("Push-Benachrichtigungen")}</summary>
    <p>${copy("Verpass keinen freien Platz: Mitspieler-Rufe bringen dich direkt in öffentliche Runden unserer Spiele. Erlaube zuerst Push auf diesem Gerät und wähle danach selbst, welche Hinweise zu dir passen.")}</p>
    <div class="actions"><button type="button" data-watten-push-enable disabled>${copy("Push auf diesem Gerät zulassen")}</button>
      <button type="button" data-watten-push-disable hidden>${copy("Push-Benachrichtigungen deaktivieren")}</button>
      <button type="button" data-watten-push-retry hidden>${copy("Erneut versuchen")}</button></div>
    <p data-watten-push-status role="status">${copy("Bitte warte …")}</p>
    <form data-watten-push-preferences hidden>
      <label><input name="gameInvites" type="checkbox"> ${copy("Mitspieler-Rufe erhalten (wenn ein Platz frei ist)")}</label>
      <label><input name="dailyReminder" type="checkbox"> ${copy("Tägliche Spielerinnerung erhalten")}</label><p data-push-reminder-schedule></p>
      <label><input name="releaseNotifications" type="checkbox"> ${copy("Versionshinweise erhalten")}</label>
      <button type="submit">${copy("Push-Auswahl speichern")}</button><p data-push-preferences-message role="status"></p>
    </form></details>`;
}

/** Device permission remains inside the explicit enable click's user gesture. */
export function mountWattenPushSettings({ container, viewerId, isCurrent, onAccountChanged,
  loadAuth = sharedLoadAuth, fetcher = apiFetch, translate = value => window.ZDWA_I18N?.t?.(value) || value,
  push = { status: getGameInvitePushStatus, enable: enableGameInvitePush, disable: disableGameInvitePush,
    sync: syncPushPreferences, message: devicePushStatusMessage, error: webPushErrorMessage } }) {
  const lifetime = new AbortController();
  const enable = container.querySelector("[data-watten-push-enable]");
  const disable = container.querySelector("[data-watten-push-disable]");
  const retry = container.querySelector("[data-watten-push-retry]");
  const output = container.querySelector("[data-watten-push-status]");
  const form = container.querySelector("[data-watten-push-preferences]");
  const save = form.querySelector("button[type=submit]");
  const saved = form.querySelector("[data-push-preferences-message]");
  let destroyed = false, busy = false, status = null, serial = 0;
  const current = token => !destroyed && isCurrent() && container.isConnected && (token === undefined || token === serial);
  function destroy() {
    if (destroyed) return;
    destroyed = true; serial += 1; lifetime.abort();
    enable.removeEventListener("click", onEnable); disable.removeEventListener("click", onDisable);
    retry.removeEventListener("click", onRetry); form.removeEventListener("submit", onSubmit);
    status = null; container.replaceChildren();
  }
  function changed() { destroy(); onAccountChanged(); }
  async function verify(token, count = 1) {
    for (let index = 0; index < count; index += 1) {
      const auth = await loadAuth({ refresh: true });
      if (!current(token)) return false;
      if (!auth?.authenticated || auth.user?.id !== viewerId) { changed(); return false; }
    }
    return true;
  }
  function controls() {
    enable.disabled = busy || !status?.available || !status?.browser_supported || status?.permission === "denied";
    disable.disabled = busy; retry.disabled = busy; save.disabled = busy;
  }
  async function refresh() {
    const token = ++serial;
    try {
      if (!await verify(token)) return;
      const result = await push.status({ signal: lifetime.signal });
      if (!current(token) || !await verify(token, 2)) return;
      if (result.viewer_id !== viewerId) { changed(); return; }
      status = result; push.sync(form, status);
      disable.hidden = !status.subscribed;
      enable.hidden = status.device_subscribed === true;
      enable.textContent = translate(status.subscribed ? "Dieses Gerät für Push anmelden" : "Push auf diesem Gerät zulassen");
      retry.hidden = true;
      output.textContent = translate(!status.available ? "Push-Benachrichtigungen sind momentan noch nicht eingerichtet."
        : !status.browser_supported ? "Dieser Browser unterstützt keine Push-Benachrichtigungen."
          : status.permission === "denied" ? "Die Push-Berechtigung wurde nicht erteilt." : push.message(status));
    } catch (error) {
      if (!current(token) || error.name === "AbortError") return;
      if (error.code === "web_push_account_changed") { changed(); return; }
      status = null; output.textContent = push.error(error); retry.hidden = false;
    } finally { if (current(token)) controls(); }
  }
  async function change(kind) {
    if (!current() || busy || !status || (kind === "enable" && enable.disabled)) return;
    busy = true; controls(); output.textContent = translate("Bitte warte …");
    const token = serial;
    try {
      // No await before enable(): Safari requires the original click gesture.
      if (kind === "enable") await push.enable({ signal: lifetime.signal });
      else if (await verify(token)) await push.disable({ signal: lifetime.signal });
      if (!current(token) || !await verify(token, 2)) return;
      await refresh();
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      if (error.code === "web_push_account_changed") { changed(); return; }
      output.textContent = push.error(error);
    } finally { if (current()) { busy = false; controls(); } }
  }
  async function submit(event) {
    event.preventDefault();
    if (!current() || busy || !status?.subscribed) return;
    const token = serial;
    const body = { game_invites_enabled: form.elements.gameInvites.checked,
      daily_reminder_enabled: form.elements.dailyReminder.checked,
      release_notifications_enabled: form.elements.releaseNotifications.checked };
    busy = true; controls(); saved.textContent = translate("Push-Einstellung wird gespeichert …");
    try {
      if (!await verify(token)) return;
      const response = await fetcher("/api/web-push/preferences", { method: "PUT", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Push-Expected-Account-Id": String(viewerId) },
        signal: lifetime.signal, body: JSON.stringify(body) });
      if (!current(token)) return;
      const result = await response.json().catch(() => null);
      if (!current(token)) return;
      if (response.status === 401 || response.status === 409 && result?.detail === "web_push_account_changed") { changed(); return; }
      if (!await verify(token, 2)) return;
      if (!response.ok) { const error = new Error("push preferences"); error.code = result?.detail; throw error; }
      await refresh();
      if (current()) saved.textContent = translate("Push-Auswahl gespeichert.");
    } catch (error) {
      if (current() && error.name !== "AbortError") saved.textContent = push.error(error);
    } finally { if (current()) { busy = false; controls(); } }
  }
  const onEnable = () => { void change("enable"); }, onDisable = () => { void change("disable"); };
  const onRetry = () => { if (current() && !busy) void refresh(); }, onSubmit = event => { void submit(event); };
  enable.addEventListener("click", onEnable); disable.addEventListener("click", onDisable);
  retry.addEventListener("click", onRetry); form.addEventListener("submit", onSubmit);
  void refresh();
  return { destroy };
}
