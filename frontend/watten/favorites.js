import { WATTEN_FAVORITE_MESSAGES } from "../i18n/catalog.js";

const currentLanguage = () => globalThis.window?.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const recipeKeys = new Set(["kind", "schema_version", "ruleset_id", "ruleset_version", "player_count", "determination", "blind",
  "critical", "target_points", "cpu_seats", "show_rechter", "trick_history", "partner_hand", "password_required"]);
const flags = ["blind", "critical", "show_rechter", "trick_history", "partner_hand", "password_required"];

export function favoriteText(key, values = {}, language = currentLanguage()) {
  return WATTEN_FAVORITE_MESSAGES[language === "en" ? "en" : "de"][key]
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function validRecipe(recipe) {
  return object(recipe) && Object.keys(recipe).length === recipeKeys.size && Object.keys(recipe).every(key => recipeKeys.has(key))
    && recipe.kind === "watten_recipe" && recipe.schema_version === 1 && recipe.ruleset_id === "watten-house" && recipe.ruleset_version === 1
    && [2, 3, 4].includes(recipe.player_count) && ["normal", "ladinisch"].includes(recipe.determination)
    && flags.every(key => typeof recipe[key] === "boolean") && integer(recipe.target_points, 3)
    && Array.isArray(recipe.cpu_seats) && recipe.cpu_seats.length < recipe.player_count
    && recipe.cpu_seats.every((seat, index) => integer(seat) && seat < recipe.player_count && (!index || seat > recipe.cpu_seats[index - 1]))
    && (recipe.player_count !== 3 || recipe.determination === "normal")
    && (!recipe.blind || recipe.player_count === 4 && recipe.determination === "ladinisch")
    && (!recipe.partner_hand || recipe.player_count !== 2 && !recipe.blind);
}

export function syncCreatorProtection(form) {
  const required = form.elements.password_required.checked;
  form.elements.password.disabled = !required;
  form.elements.password.required = required;
  if (!required) form.elements.password.value = "";
}

/** A save can retain protection without a secret; creation requires a new one. */
export function readCreatorRecipe(form, { requirePassword = false, language = currentLanguage() } = {}) {
  const protectedTable = form.elements.password_required.checked;
  const password = protectedTable ? form.elements.password.value.trim() : "";
  const recipe = {
    kind: "watten_recipe", schema_version: 1, ruleset_id: "watten-house", ruleset_version: 1,
    player_count: Number(form.elements.count.value), determination: form.elements.determination.value,
    blind: form.elements.blind.checked, critical: form.elements.critical.checked,
    target_points: Number(form.elements.target.value), cpu_seats: [...form.querySelectorAll("[data-watten-cpu-seat]")]
      .filter(control => control.checked && !control.disabled).map(control => Number(control.value)).sort((a, b) => a - b),
    show_rechter: form.elements.show_rechter.checked, trick_history: form.elements.trick_history.checked,
    partner_hand: form.elements.partner_hand.checked, password_required: protectedTable,
  };
  if (recipe.cpu_seats.length >= recipe.player_count) throw new Error(favoriteText("allCpu", {}, language));
  if (!validRecipe(recipe)) throw new Error(favoriteText("invalid", {}, language));
  if (requirePassword && protectedTable && !password) throw new Error(favoriteText("passwordRequired", {}, language));
  return { recipe, password };
}

/** Explicit apply changes settings only, clears the secret, and never submits. */
export function applyFavoriteToCreator(form, recipe) {
  if (!validRecipe(recipe)) throw new Error(favoriteText("invalid"));
  form.elements.count.value = String(recipe.player_count);
  form.elements.determination.value = recipe.determination;
  if (![...form.elements.target.options].some(option => option.value === String(recipe.target_points))) {
    const option = form.ownerDocument.createElement("option");
    option.value = String(recipe.target_points);
    option.textContent = String(recipe.target_points);
    form.elements.target.add(option);
  }
  form.elements.target.value = String(recipe.target_points);
  for (const key of flags) form.elements[key].checked = recipe[key];
  for (const control of form.querySelectorAll("[data-watten-cpu-seat]")) control.checked = recipe.cpu_seats.includes(Number(control.value));
  form.elements.password.value = "";
  syncCreatorProtection(form);
  const advanced = form.querySelector("[data-watten-advanced]");
  if (advanced && (recipe.password_required || recipe.cpu_seats.length)) advanced.open = true;
}

/** Account-bound private favorite controls; no automatic apply/create/start. */
export function createFavorites({ container, apiFetch, loadAuth, escapeHtml: esc, getRecipe, applyRecipe,
  getExpectedAccountId, isCurrent, onAccountChanged, language = currentLanguage }) {
  const expectedId = getExpectedAccountId();
  const t = (key, values = {}) => favoriteText(key, values, language());
  let destroyed = false, serial = 0, controller = null, favorite = null, busy = false;
  let message = "loading", failed = false, lastOperation = { method: "GET" };
  const current = token => !destroyed && token === serial && isCurrent() && getExpectedAccountId() === expectedId;

  function render() {
    if (!current(serial)) { container.replaceChildren(); return; }
    container.innerHTML = `<h3>${esc(t("heading"))}</h3><p class="wt-note">${esc(t("help"))}</p>
      ${favorite ? `<p>${esc(t("summary", { players: favorite.player_count, target: favorite.target_points, cpus: favorite.cpu_seats.length }))}
        ${favorite.password_required ? `<strong>${esc(t("protected"))}</strong>` : ""}</p>` : ""}
      <div class="wt-actions"><button type="button" data-watten-favorite-action="save"${busy ? " disabled" : ""}>${esc(t("save"))}</button>
      <button type="button" data-watten-favorite-action="apply"${busy || !favorite ? " disabled" : ""}>${esc(t("apply"))}</button>
      <button type="button" data-watten-favorite-action="delete"${busy || !favorite ? " disabled" : ""}>${esc(t("delete"))}</button>
      ${failed ? `<button type="button" data-watten-favorite-action="retry">${esc(t("retry"))}</button>` : ""}</div>
      <p data-watten-favorite-status class="${failed ? "wt-error" : "wt-note"}" role="${failed ? "alert" : "status"}">${esc(t(message))}</p>`;
  }

  function accountChanged() { destroy(); onAccountChanged(); }
  async function verify(token, afterBody = false) {
    for (let index = 0; index < (afterBody ? 2 : 1); index += 1) {
      const auth = await loadAuth({ refresh: true });
      if (!current(token)) return false;
      if (!auth?.authenticated || auth.user?.id !== expectedId) { accountChanged(); return false; }
    }
    return true;
  }

  async function send(operation) {
    if (busy || !current(serial)) return;
    lastOperation = operation;
    const token = ++serial;
    controller?.abort(); controller = new AbortController(); busy = true; failed = false;
    message = operation.method === "GET" ? "loading" : "saving"; render();
    try {
      if (!await verify(token)) return;
      const headers = { "X-Watten-Expected-Account-Id": String(expectedId) };
      const options = { method: operation.method, headers, cache: "no-store", signal: controller.signal };
      if (operation.method === "PUT") {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify({ recipe: operation.recipe });
      }
      const response = await apiFetch("/api/watten/favorite", options);
      if (!current(token)) return;
      const data = await response.json().catch(() => null);
      if (!current(token)) return;
      if (response.status === 401 || response.status === 409 && data?.detail === "watten_account_changed") { accountChanged(); return; }
      if (!response.ok) throw new Error("watten_favorite_unavailable");
      if (!await verify(token, true)) return;
      if (!object(data) || data.schema_version !== 1 || data.game_type !== "watten"
          || (data.recipe !== null && !validRecipe(data.recipe))) throw new Error("watten_favorite_invalid_response");
      favorite = data.recipe === null ? null : structuredClone(data.recipe);
      message = operation.method === "PUT" ? "saved" : operation.method === "DELETE" ? "deleted" : favorite ? "ready" : "empty";
    } catch (error) {
      if (!current(token) || error.name === "AbortError") return;
      failed = true; message = "unavailable";
    } finally {
      if (current(token)) { busy = false; render(); }
    }
  }

  function clicked(event) {
    const control = event.target.closest?.("[data-watten-favorite-action]");
    if (!control || control.disabled || !container.contains(control) || busy || !current(serial)) return;
    const action = control.dataset.wattenFavoriteAction;
    if (action === "apply" && favorite) {
      applyRecipe(structuredClone(favorite));
      message = favorite.password_required ? "appliedProtected" : "applied"; failed = false; render();
    } else if (action === "save") {
      try {
        const recipe = getRecipe();
        if (!validRecipe(recipe)) throw new Error("invalid");
        void send({ method: "PUT", recipe: structuredClone(recipe) });
      } catch { message = "invalid"; failed = false; render(); }
    } else if (action === "delete" && favorite) void send({ method: "DELETE" });
    else if (action === "retry" && failed) void send(lastOperation);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true; serial += 1; controller?.abort(); favorite = null;
    container.removeEventListener("click", clicked); container.replaceChildren();
  }

  container.addEventListener("click", clicked);
  if (integer(expectedId, 1)) void send({ method: "GET" });
  return { destroy };
}
