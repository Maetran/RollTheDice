import { loadAuth, escapeHtml as esc } from "./auth.js";
import { VOICE_PREFERENCE_MESSAGES } from "../i18n/catalog.js";

export const voicePreferenceText = key => VOICE_PREFERENCE_MESSAGES[
  window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de"
][key];

// Bind the form to its original viewer. In particular, do not use apiFetch:
// that helper may obtain a different account's CSRF token after a tab switch.
export function mountVoicePreferences(mount, { user, isCurrent = () => true } = {}) {
  if (!mount || !user) return null;
  const text = key => esc(voicePreferenceText(key));
  mount.innerHTML = `<form data-voice-preferences class="form-stack">
    <p>${text("help")}</p><label>${text("label")}<select name="listening">
      <option value="true">${text("on")}</option><option value="false">${text("off")}</option>
    </select></label><button type="submit">${text("save")}</button><p role="status"></p></form>`;
  const form = mount.querySelector("form");
  const select = form.elements.listening;
  const button = form.querySelector("button");
  const message = form.querySelector('[role="status"]');
  select.value = String(user.preferences?.voice_listening_default === true);
  let retired = false;
  let revision = 0;
  const lifetime = new AbortController();
  const current = expected => !retired && mount.isConnected && isCurrent() && expected === revision;
  const destroy = () => { retired = true; revision += 1; lifetime.abort(); button.disabled = true; };
  window.addEventListener("pagehide", destroy, { signal: lifetime.signal, once: true });
  window.addEventListener("zdwa:auth-state", event => {
    if (!event.detail?.authenticated || event.detail.user?.id !== user.id) {
      destroy();
      mount.replaceChildren();
    }
  }, { signal: lifetime.signal });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (button.disabled || !current(revision)) return;
    const expected = ++revision;
    const choice = select.value === "true";
    button.disabled = true;
    select.disabled = true;
    message.textContent = voicePreferenceText("saving");
    void (async () => {
      try {
        const auth = await loadAuth({ refresh: true });
        if (!current(expected)) return;
        if (!auth.authenticated || auth.user?.id !== user.id) throw new Error("account_changed");
        const response = await fetch("/api/auth/preferences/voice", {
          method: "PUT", cache: "no-store", signal: lifetime.signal,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": auth.user.csrf_token },
          body: JSON.stringify({ voice_listening_default: choice }),
        });
        const result = await response.json().catch(() => ({}));
        if (!current(expected)) return;
        if (!response.ok || result.voice_listening_default !== choice) throw new Error("save_failed");
        // Refresh the shared account projection for later consumers of loadAuth.
        await loadAuth({ refresh: true });
        if (current(expected)) message.textContent = voicePreferenceText("saved");
      } catch (error) {
        if (current(expected)) message.textContent = voicePreferenceText(error.message === "account_changed" ? "changed" : "failed");
      } finally {
        if (current(expected)) { button.disabled = false; select.disabled = false; }
      }
    })();
  }, { signal: lifetime.signal });
  return { destroy };
}
