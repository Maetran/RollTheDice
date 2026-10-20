import { apiFetch, escapeHtml as esc } from "../shared/auth.js";
import { generateTableName } from "./table-names.js";
import { rememberTablePassword } from "./table-access.js";

/** One account favourite and a compact, native create dialog. */
export function mountGameCreator(container, { user, t, language, navigate = path => location.assign(path) }) {
  const lifetime = new AbortController();
  let favourite = null, loading = true, loadError = false, saving = false, screen = "choice", stopped = false;
  const selected = { waiting_mode: "open", players: 3, tournament: false, password_required: false, cpu_count: 0, voice_enabled: true };
  container.innerHTML = `<h2 id="hausdeppStartTitle">${t("startTable")}</h2><form id="hausdeppCreateForm"><button id="hausdeppCreate" class="hd-primary" type="button">${t("creatorOpen")}</button></form>`;
  const dialog = document.createElement("dialog");
  dialog.className = "hd-create-dialog";
  dialog.setAttribute("aria-labelledby", "hausdeppCreatorTitle");
  container.append(dialog);

  const summary = preset => `${preset.waiting_mode === "open" ? t("creatorOpenCount") : t("creatorFixedCount", { count: preset.players })} · ${t(preset.tournament ? "tournament" : "quickGame")}${preset.cpu_count ? ` · ${t("cpuCount", { count: preset.cpu_count })}` : ""}`;
  const close = () => { if (!saving) dialog.close(); };
  const formValues = () => {
    const form = dialog.querySelector("form");
    if (!form) return;
    selected.waiting_mode = form.elements.waiting_mode.value;
    selected.players = Number(form.elements.players.value);
    selected.tournament = form.elements.tournament.value === "true";
    selected.password_required = form.elements.password_required.checked;
    selected.voice_enabled = form.elements.voice_enabled.checked;
  };
  function render() {
    const choice = screen === "choice", passwordOnly = screen === "password";
    dialog.innerHTML = `<div class="hd-creator-heading"><h2 id="hausdeppCreatorTitle">${t(choice ? "creatorChoose" : passwordOnly ? "creatorPasswordTitle" : "creatorDefine")}</h2><button type="button" class="hd-creator-close" data-create-close aria-label="${t("close")}">×</button></div>${choice ? `
      <div class="hd-creator-choices"><button type="button" class="hd-creator-favourite" data-create-favourite ${!favourite || loading ? "disabled" : ""}><span class="hd-creator-star" aria-hidden="true">★</span><strong>${t("creatorFavourite")}</strong><small>${loading ? t("loadingTables") : favourite ? esc(summary(favourite)) : loadError ? "" : t("creatorNoFavourite")}</small></button><button type="button" data-create-define><span class="hd-creator-symbol" aria-hidden="true">＋</span><strong>${t("creatorDefine")}</strong></button></div><p id="hausdeppFavouriteError" class="hd-error" role="alert">${loadError ? t("creatorFavouriteUnavailable") : ""}</p>` : `
      <form id="hausdeppModeForm">${passwordOnly ? `<p class="hd-creator-preset">${esc(summary(selected))}</p>` : `<div class="hd-creator-fields"><fieldset><legend>${t("totalPlayers")}</legend><div class="hd-creator-segment"><label><input type="radio" name="waiting_mode" value="fixed" ${selected.waiting_mode === "fixed" ? "checked" : ""}><span>${t("creatorFixed")}</span></label><label><input type="radio" name="waiting_mode" value="open" ${selected.waiting_mode === "open" ? "checked" : ""}><span>${t("creatorOpenMode")}</span></label></div><label class="hd-creator-count" ${selected.waiting_mode === "open" ? "hidden" : ""}><span class="hd-sr">${t("totalPlayers")}</span><select name="players">${[2,3,4,5,6].map(count => `<option value="${count}" ${count === selected.players ? "selected" : ""}>${t("creatorFixedCount", { count })}</option>`).join("")}</select></label><p class="hd-creator-open-hint" ${selected.waiting_mode === "fixed" ? "hidden" : ""}>${t("creatorOpenCount")}</p></fieldset><fieldset><legend>${t("gameFormat")}</legend><div class="hd-creator-segment"><label><input type="radio" name="tournament" value="false" ${!selected.tournament ? "checked" : ""}><span>${t("quickGame")}</span></label><label><input type="radio" name="tournament" value="true" ${selected.tournament ? "checked" : ""}><span>${t("tournament")}</span></label></div></fieldset></div><label class="hd-creator-check"><input type="checkbox" name="password_required" ${selected.password_required ? "checked" : ""}>${t("creatorPassword")}</label>`}
      ${passwordOnly ? "" : `<label class="hd-creator-check"><input type="checkbox" name="voice_enabled" ${selected.voice_enabled !== false ? "checked" : ""}>${t("voiceTitle")}</label>`}<label class="hd-creator-password" ${selected.password_required ? "" : "hidden"}>${t("creatorPasswordLabel")}<input type="password" name="passphrase" autocomplete="new-password" maxlength="100" ${selected.password_required ? "required" : ""}></label><p id="hausdeppCreateError" class="hd-error" role="alert"></p><div class="hd-creator-footer"><button type="button" data-create-back>${t("creatorBack")}</button><button id="hausdeppOpenWaiting" class="hd-primary" type="submit">${t("creatorOpenWaiting")}</button></div></form>`}`;
    if (choice) {
      dialog.querySelector("[data-create-favourite]").addEventListener("click", () => {
        if (!favourite || saving) return;
        Object.assign(selected, favourite);
        if (selected.password_required) { screen = "password"; render(); dialog.querySelector('[name="passphrase"]').focus(); }
        else void create();
      });
      dialog.querySelector("[data-create-define]").addEventListener("click", () => { selected.cpu_count = 0; screen = "define"; render(); dialog.querySelector('[name="waiting_mode"]:checked').focus(); });
    } else {
      const form = dialog.querySelector("form");
      form.addEventListener("change", () => {
        if (passwordOnly) return;
        formValues();
        form.querySelector(".hd-creator-count").hidden = selected.waiting_mode === "open";
        form.querySelector(".hd-creator-open-hint").hidden = selected.waiting_mode !== "open";
        const password = form.querySelector('[name="passphrase"]');
        password.required = selected.password_required;
        password.parentElement.hidden = !selected.password_required;
        if (!selected.password_required) password.value = "";
      });
      form.addEventListener("submit", event => { event.preventDefault(); if (!passwordOnly) formValues(); void create(); });
      form.querySelector("[data-create-back]").addEventListener("click", () => { screen = "choice"; render(); dialog.querySelector("[data-create-define]").focus(); });
    }
    dialog.querySelector("[data-create-close]").addEventListener("click", close);
  }

  async function create() {
    if (saving || stopped) return;
    const input = dialog.querySelector('[name="passphrase"]');
    const passphrase = input?.value.trim() || "";
    if (selected.password_required && !passphrase) {
      input?.setCustomValidity(t("creatorPasswordRequired")); input?.reportValidity();
      input?.addEventListener("input", () => input.setCustomValidity(""), { once: true });
      return;
    }
    saving = true;
    for (const button of dialog.querySelectorAll("button")) button.disabled = true;
    dialog.setAttribute("aria-busy", "true");
    try {
      const response = await apiFetch("/api/games", { method: "POST", signal: lifetime.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: generateTableName(user.username, language()), game_type: "hausdepp", mode: String(selected.waiting_mode === "open" ? 6 : selected.players), waiting_mode: selected.waiting_mode, manual_start: true, tournament: selected.tournament, cpu_count: selected.cpu_count, voice_enabled: selected.voice_enabled !== false, play_mode: selected.cpu_count ? "cpu" : "multiplayer", ...(selected.password_required ? { pass: passphrase } : {}) }) });
      const result = await response.json();
      if (!response.ok || !(result.game_id || result.id)) throw new Error("creation_failed");
      if (!stopped) {
        const id = result.game_id || result.id;
        rememberTablePassword(user.id, id, passphrase);
        navigate(`/hausdepp/spiel/${encodeURIComponent(id)}`);
      }
    } catch (error) {
      if (stopped || error.name === "AbortError") return;
      const output = dialog.querySelector("#hausdeppCreateError, #hausdeppFavouriteError");
      if (output) output.textContent = t("requestFailed");
    } finally {
      saving = false;
      dialog.removeAttribute("aria-busy");
      for (const button of dialog.querySelectorAll("button")) button.disabled = false;
      const fav = dialog.querySelector("[data-create-favourite]"); if (fav) fav.disabled = !favourite;
    }
  }

  container.querySelector("#hausdeppCreate").addEventListener("click", () => { screen = "choice"; render(); dialog.showModal(); });
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => { const input = dialog.querySelector('[name="passphrase"]'); if (input) input.value = ""; });
  render();
  void (async () => {
    try {
      const response = await apiFetch("/api/hausdepp/favourite", { signal: lifetime.signal });
      if (!response.ok) throw new Error("favourite_unavailable");
      favourite = (await response.json()).favourite;
    } catch (error) {
      if (error.name !== "AbortError" && !stopped) {
        loadError = true;
      }
    } finally { loading = false; if (!stopped && screen === "choice") render(); }
  })();
  return { destroy() { stopped = true; lifetime.abort(); dialog.remove(); } };
}
