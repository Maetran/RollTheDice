import "../i18n/index.js";
import { loadAuth, apiFetch, escapeHtml as esc } from "../shared/auth.js";
import { initializeGameViewport } from "../shared/game-viewport.js";
import { wattenAccountReturnPath } from "../multigame/routes.js";
import { initializeWattenPwa } from "./pwa.js";
import { t, prepareWattenCards, strikeName, suitName, STRIKES, SUITS } from "./cards.js";
import { dismissLandscapeHint, joinFormMarkup, recipeMarkup, spectateFormMarkup, waitingRoomMarkup } from "./waiting-room.js";
import { createTableView } from "./table.js";
import { createMotion, sameHandVersion } from "./motion.js";
import { createRoundReview } from "./round-review.js";
import { createMatchProgress } from "./match-progress.js";
import { applyFavoriteToCreator, createFavorites, favoriteText, readCreatorRecipe, syncCreatorProtection } from "./favorites.js";
import { lobbyText as lt } from "./lobby-copy.js";
import { generateWattenTableName } from "./table-names.js";
import { createRematch } from "./rematch.js";
import { createOpenSeatNotifications } from "./open-seat-notify.js";
import { loadWattenDetail } from "./api.js";
import { createSocial } from "./social.js";
import { mountWattenLobbyChat } from "./lobby-chat.js";
import { createDecor } from "./decor.js";
import { createWattenVoice } from "./voice.js";
import { createFriendActivity } from "./friend-activity.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import { initializeSuiteHeader } from "../shell/header.js";
import { createGameTour } from "../shared/game-tours.js";

// Public lobby launches own the install flow; active tables only register.
const publicBetaDocument = document.documentElement.dataset.wattenPublicBeta === "true";
initializeWattenPwa({ registerWorker: publicBetaDocument,
  installControls: publicBetaDocument && document.documentElement.dataset.wattenPage === "lobby" });

const html = document.documentElement;
const page = ["lobby", "table", "spectator", "rules"].includes(html.dataset.wattenPage) ? html.dataset.wattenPage : "lobby";
const gameId = /^[0-9a-f]{16}$/.test(html.dataset.gameId || "") ? html.dataset.gameId : "";
const app = document.getElementById("wattenApp");
const publicLandingMarkup = publicBetaDocument && page === "lobby" ? app.innerHTML : "";
const nav = document.querySelector("[data-watten-nav]");
document.querySelector(".suite-header")?.classList.toggle("suite-header--table", page === "table" || page === "spectator");
initializeSuiteHeader();
const GAME_PATH = /^[0-9a-f]{16}$/;
const STALE = new Set(["watten_stale_room_revision", "watten_stale_revision", "watten_stale_lifecycle", "watten_stale_opportunity"]);
const ERRORS = new Set([
  "watten_wrong_passphrase", "watten_room_full", "watten_room_started", "watten_room_finished", "watten_room_closed",
  "watten_room_expired", "watten_room_protected", "watten_seat_taken", "watten_seat_reserved", "watten_already_on_seat",
  "watten_team_confirmation_required", "watten_seats_incomplete", "watten_players_offline", "watten_host_required",
  "watten_not_your_turn", "watten_trump_required", "watten_card_not_in_hand", "watten_bid_response_pending",
  "watten_first_card_required", "watten_card_turn_required", "watten_gestrichen_cannot_open",
  "watten_alternating_bid_required", "watten_designated_decider_required", "watten_match_paused",
  "watten_action_unavailable", "watten_actor_not_bound", "watten_access_required", "watten_rate_limited",
  "watten_storage_unavailable", "watten_free_weli_strike_with_critical", "watten_leave_unavailable",
  "watten_running_leave_unsupported", "watten_command_conflict", "watten_feedback_unavailable",
  "watten_deal_finished", "watten_already_joined", "watten_not_a_member", "watten_not_started",
  "watten_preplay_response_required", "watten_preplay_unavailable", "watten_schoeneres_requires_two_callers",
  "watten_bloedeln_choice_unavailable", "watten_bloedeln_decision_pending",
  "watten_round_review_pending",
  "watten_retourschneider_decision_pending", "watten_retourschneider_unavailable",
  "watten_round_review_pending",
  "watten_invalid_tournament_target", "watten_tournament_finished", "watten_tournament_roster_locked",
  "game_creation_temporarily_blocked", "authentication_required", "game_not_found", "watten_password_option_mismatch",
]);

let generation = 0;
let account = null;
let latestUserId;
let anonymousMount = false;
let navigating = false;
let matchProgress = null;
let rematch = null;
let openSeatNotifications = null;
let social = null;
let decor = null;
let voice = null;
const cleanups = new Set();
const beginnerGuide = createGameTour("watten");

function errorText(code) {
  if (STALE.has(code)) return t("error.stale");
  return ERRORS.has(code) ? t(`error.${code}`) : t("error.generic");
}

function signInUrl(path = location.pathname) {
  return `/watten/anmelden?return_to=${encodeURIComponent(wattenAccountReturnPath(path) || "/watten")}`;
}

function publicPageUrl(path) {
  return window.ZDWA_I18N?.getLanguage?.() === "en" ? `${path}?lang=en` : path;
}

function renderNav(auth) {
  if (!nav) return;
  const user = auth?.authenticated ? auth.user : null;
  const label = text => esc(window.ZDWA_I18N.t(text));
  nav.innerHTML = `<a href="${publicPageUrl("/watten")}"${page === "lobby" ? " aria-current=\"page\"" : ""}>${esc(t("nav.lobby"))}</a>
    <a href="/watten/rangliste">${label("Spieler & Ranking")}</a>
    <a class="wt-button wt-button--ghost" href="${publicPageUrl("/watten/regeln")}"${page === "rules" ? " aria-current=\"page\"" : ""}>${esc(t("nav.rules"))}</a>
    ${user ? `<a href="/watten/konto/einstellungen" aria-label="${esc(t("nav.accountOf", { name: user.username }))}">${label("Konto")}</a>`
      : `<a href="${esc(signInUrl())}">${label("Konto")}</a>`}`;
}

/** Drop private state synchronously; late callbacks observe a new generation. */
function teardown() {
  roundReview.discard();
  beginnerGuide.discard();
  voice?.destroy(); voice = null;
  generation += 1;
  delete html.dataset.wattenActive;
  for (const cleanup of cleanups) cleanup();
  cleanups.clear();
  closeSocket();
  session.view?.destroy?.();
  if (page !== "rules") app.replaceChildren();
}

function navigate(path) {
  if (navigating) return;
  navigating = true;
  teardown();
  location.assign(path);
}

function reloadFresh() {
  if (navigating) return;
  navigating = true;
  teardown();
  location.reload();
}

window.addEventListener("zdwa:auth-state", event => {
  const detail = event.detail || {};
  const id = detail.authenticated ? detail.user?.id ?? null : null;
  latestUserId = id;
  if (navigating) return;
  if (page === "rules") { renderNav(detail); return; }
  if ((account && id !== account.id) || (anonymousMount && id)) reloadFresh();
});

const refreshAuth = () => {
  if (navigating || document.visibilityState !== "visible") return;
  loadAuth({ refresh: true }).catch(() => undefined);
};
window.addEventListener("focus", refreshAuth);
document.addEventListener("visibilitychange", refreshAuth);
window.addEventListener("pagehide", () => { if (page !== "rules") teardown(); });
window.addEventListener("pageshow", event => {
  // A restored document may carry another account's socket and DOM state.
  if (event.persisted && page !== "rules") reloadFresh();
});

// ---------------------------------------------------------------------------
// Lobby

function lobbyIntro({ signedIn = false, status = "" } = {}) {
  return `<section class="wt-hero wt-lobby-intro" aria-labelledby="wattenTitle">
    <div class="wt-lobby-intro-copy"><h1 id="wattenTitle" translate="no">Watten</h1>
    <p class="wt-lead">${esc(t("lobby.onlineIntro"))}</p></div>
    <div class="wt-actions">
      ${signedIn ? `<button type="button" class="wt-primary" data-watten-create-open>＋ ${esc(lt("open"))}</button>`
        : `<a class="wt-button" href="${esc(signInUrl("/watten"))}" data-watten-signin>${esc(t("lobby.signIn"))}</a>`}
      <a class="wt-button wt-button--ghost" href="${publicPageUrl("/watten/regeln")}">${esc(t("lobby.rules"))}</a>
    </div>
    ${signedIn ? "" : `<p class="wt-note">${esc(t("lobby.signInHint"))}</p>`}
    <p class="wt-note" data-watten-lobby-status role="status">${esc(status)}</p>
  </section>`;
}

function lobbyGuide() {
  return `<section class="wt-lobby-guide" data-watten-lobby-guide aria-labelledby="wattenGuideTitle">
    <h2 id="wattenGuideTitle">${esc(t("lobby.guideTitle"))}</h2>
    <h3>${esc(t("lobby.guidePlayTitle"))}</h3><p>${esc(t("lobby.guidePlay"))}</p>
    <h3>${esc(t("lobby.guideVariantsTitle"))}</h3><p>${esc(t("lobby.guideVariants"))}</p>
    <h3>${esc(t("lobby.guideFriendsTitle"))}</h3><p>${esc(t("lobby.guideFriends"))}</p>
  </section>`;
}

function creatorMarkup() {
  const targets = [3, 5, 7, 11, 13, 15, 18, 21];
  return `<dialog class="wt-create-dialog" data-watten-create-dialog aria-labelledby="wattenCreateTitle">
    <header class="wt-create-heading"><h2 id="wattenCreateTitle">${esc(lt("choose"))}</h2>
      <button type="button" class="wt-icon-button" data-watten-create-close aria-label="${esc(lt("close"))}">×</button></header>
    <section data-watten-create-choice>
      <div class="wt-create-choices">
        <button type="button" class="wt-create-choice" data-watten-create-favourite disabled>
          <span aria-hidden="true">★</span><strong>${esc(lt("favourite"))}</strong>
          <small data-watten-favourite-summary>${esc(favoriteText("loading"))}</small></button>
        <button type="button" class="wt-create-choice" data-watten-create-define>
          <span aria-hidden="true">＋</span><strong>${esc(lt("define"))}</strong><small>${esc(lt("defineHelp"))}</small></button>
      </div>
      <p class="wt-error" role="alert" data-watten-favourite-error></p>
    </section>
    <form class="wt-create-form" data-watten-create novalidate hidden>
      <fieldset class="wt-segmented wt-create-count"><legend>${esc(t("create.players"))}</legend>
        ${[2, 3, 4].map(count => `<label><input type="radio" name="count" value="${count}"${count === 4 ? " checked" : ""}><span>${esc(t(`create.count${count}`))}</span></label>`).join("")}
      </fieldset>
      <p class="wt-note wt-create-count-note" data-watten-count-note></p>
      <div class="wt-create-rule-grid"><fieldset class="wt-segmented"><legend>${esc(t("create.determination"))}</legend>
        <label><input type="radio" name="determination" value="normal"><span>${esc(t("create.normal"))}</span></label>
        <label><input type="radio" name="determination" value="ladinisch" checked><span>${esc(t("create.ladinisch"))}</span></label>
      </fieldset>
      <label>${esc(t("create.target"))}<select name="target">${targets.map(points => `<option value="${points}"${points === 11 ? " selected" : ""}>${esc(t(points === 3 ? "create.targetShort" : "create.targetOption", { points }))}</option>`).join("")}</select></label></div>
      <div class="wt-create-tournament"><label>${esc(lt("tournament"))}<select name="tournament_target">
        <option value="">${esc(lt("singleGame"))}</option>${[3, 5, 8, 10, 15, 20].map(count => `<option value="${count}">${esc(lt("tournamentTarget", { count }))}</option>`).join("")}
        <option value="custom">${esc(lt("tournamentCustom"))}</option></select></label>
        <label data-watten-tournament-custom hidden>${esc(lt("tournamentNumber"))}<input name="tournament_custom" type="number" inputmode="numeric" min="1" max="9007199254740991" step="1" disabled></label>
        <small data-watten-tournament-help hidden>${esc(lt("tournamentHelp"))}</small></div>
      <label class="wt-check"><input type="checkbox" name="blind" checked><span>${esc(t("create.blind"))}<small>${esc(t("create.blindHelp"))}</small></span></label>
      <label class="wt-check"><input type="checkbox" name="cpu_fill"><span>${esc(lt("cpuFill"))}<small>${esc(lt("cpuHelp"))}</small></span></label>
      <label class="wt-check"><input type="checkbox" name="voice_enabled" checked><span>${esc(lt("audio"))}<small>${esc(lt("audioHelp"))}</small></span></label>
      <details class="wt-more" data-watten-advanced><summary>${esc(t("create.more"))}</summary>
        <label class="wt-check"><input type="checkbox" name="critical"><span>${esc(t("create.critical"))}<small>${esc(t("create.criticalHelp"))}</small></span></label>
        <label class="wt-check"><input type="checkbox" name="schoeneres_enabled"><span>${esc(lt("schoeneres"))}<small data-watten-schoeneres-help>${esc(lt("schoeneresHelp"))}</small></span></label>
        <label class="wt-check"><input type="checkbox" name="show_rechter"><span>${esc(t("create.showRechter"))}<small>${esc(t("create.showRechterHelp"))}</small></span></label>
        <label class="wt-check"><input type="checkbox" name="trick_history"><span>${esc(t("create.trickHistory"))}<small>${esc(t("create.trickHistoryHelp"))}</small></span></label>
        <label class="wt-check"><input type="checkbox" name="partner_hand"><span>${esc(t("create.partnerHand"))}<small data-watten-partner-help>${esc(t("create.partnerHandHelp"))}</small></span></label>
      </details>
      <label>${esc(lt("password"))}<input name="password" type="password" autocomplete="new-password" maxlength="100" data-watten-password><small data-watten-password-note>${esc(lt("passwordHelp"))}</small></label>
      <details class="wt-more wt-create-favorite"><summary>☆ ${esc(lt("favoriteSettings"))}</summary><section data-watten-favorite></section></details>
      <p class="wt-error" role="alert" data-watten-create-error></p>
      <footer class="wt-create-footer"><button type="button" class="wt-button--ghost" data-watten-create-back>${esc(lt("back"))}</button>
        <button type="submit" class="wt-primary">${esc(t("create.submit"))}</button></footer>
      <p class="wt-note wt-create-name-note">${esc(lt("tableName"))}</p>
    </form>
  </dialog>`;
}

function syncCreator(form, countChanged) {
  const count = Number(form.elements.count.value);
  const [normal, ladinisch] = form.querySelectorAll("input[name=determination]");
  if (countChanged) {
    // Owner defaults: two and three open normal, four blind Ladinisch.
    (count === 4 ? ladinisch : normal).checked = true;
    form.elements.blind.checked = count === 4;
  }
  ladinisch.disabled = count === 3;
  if (count === 3) normal.checked = true;
  const blindAllowed = count === 4 && ladinisch.checked;
  form.elements.blind.disabled = !blindAllowed;
  if (!blindAllowed) form.elements.blind.checked = false;
  const partnerAllowed = count !== 2 && !form.elements.blind.checked;
  form.elements.partner_hand.disabled = !partnerAllowed;
  if (!partnerAllowed) form.elements.partner_hand.checked = false;
  const schoeneresAllowed = count !== 3;
  form.elements.schoeneres_enabled.disabled = !schoeneresAllowed;
  if (!schoeneresAllowed) form.elements.schoeneres_enabled.checked = false;
  form.querySelector("[data-watten-schoeneres-help]").textContent = lt(schoeneresAllowed ? "schoeneresHelp" : "schoeneresUnavailable");
  const tournament = form.elements.tournament_target;
  tournament.disabled = count === 3;
  if (count === 3) tournament.value = "";
  const customTournament = tournament.value === "custom";
  form.querySelector("[data-watten-tournament-custom]").hidden = !customTournament;
  form.elements.tournament_custom.disabled = !customTournament;
  form.elements.tournament_custom.required = customTournament;
  const tournamentHelp = form.querySelector("[data-watten-tournament-help]");
  tournamentHelp.hidden = !tournament.value && count !== 3;
  tournamentHelp.textContent = lt(count === 3 ? "tournamentUnavailable" : "tournamentHelp");
  syncCreatorProtection(form);
  form.querySelector("[data-watten-count-note]").textContent = t(`create.count${count}Note`);
}

function recipeFromForm(form) {
  return readCreatorRecipe(form);
}

function detailCode(detail) {
  if (typeof detail === "string") return detail;
  return "watten_invalid_create_options";
}

function mountCreator(gen) {
  const dialog = app.querySelector("[data-watten-create-dialog]");
  const form = dialog.querySelector("[data-watten-create]");
  const choice = dialog.querySelector("[data-watten-create-choice]");
  const title = dialog.querySelector("#wattenCreateTitle");
  const error = form.querySelector("[data-watten-create-error]");
  const submit = form.querySelector("button[type=submit]");
  const favoriteButton = dialog.querySelector("[data-watten-create-favourite]");
  const defineButton = dialog.querySelector("[data-watten-create-define]");
  const closeButton = dialog.querySelector("[data-watten-create-close]");
  let busy = false;
  const current = () => gen === generation && !navigating && latestUserId === account?.id;
  function screen(showForm) {
    form.hidden = !showForm; choice.hidden = showForm;
    title.textContent = lt(showForm ? "setup" : "choose");
    if (dialog.open) (showForm ? form.querySelector("input[name=count]:checked") : defineButton)?.focus();
  }
  function close() { if (!busy) dialog.close(); }
  syncCreator(form, true);
  const favorites = createFavorites({ container: form.querySelector("[data-watten-favorite]"), apiFetch, loadAuth, escapeHtml: esc,
    getRecipe: () => readCreatorRecipe(form).recipe,
    applyRecipe: recipe => {
      applyFavoriteToCreator(form, recipe); syncCreator(form, false); error.textContent = ""; screen(true);
      if (recipe.password_required) form.elements.password.focus();
    },
    getExpectedAccountId: () => account?.id, isCurrent: current, onAccountChanged: reloadFresh,
    onState: ({ favorite, busy: favoriteBusy, failed, message }) => {
      favoriteButton.disabled = favoriteBusy || !favorite;
      dialog.querySelector("[data-watten-favourite-summary]").textContent = favorite
        ? favoriteText("summary", { players: favorite.player_count, target: favorite.target_points, cpus: favorite.cpu_seats.length })
          + (favorite.tournament_nockerl_target ? ` · ${lt("tournamentTarget", { count: favorite.tournament_nockerl_target })}` : "")
        : favoriteBusy ? favoriteText("loading") : lt("favouriteEmpty");
      dialog.querySelector("[data-watten-favourite-error]").textContent = failed ? favoriteText(message) : "";
    } });
  const controller = new AbortController();
  cleanups.add(() => { controller.abort(); favorites.destroy(); form.elements.password.value = ""; dialog.close(); });
  const listen = (element, type, handler) => element.addEventListener(type, handler, { signal: controller.signal });
  listen(app.querySelector("[data-watten-create-open]"), "click", () => {
    if (!current()) return;
    screen(false); dialog.showModal(); defineButton.focus();
  });
  listen(defineButton, "click", () => screen(true));
  listen(favoriteButton, "click", () => favorites.applyStored());
  listen(closeButton, "click", close);
  listen(dialog, "cancel", event => { if (busy) event.preventDefault(); });
  listen(dialog, "click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  listen(dialog, "close", () => { form.elements.password.value = ""; });
  listen(form.querySelector("[data-watten-create-back]"), "click", () => { if (!busy) { form.elements.password.value = ""; screen(false); } });
  listen(form, "change", event => syncCreator(form, event.target.name === "count"));
  listen(form, "submit", async event => {
    event.preventDefault();
    if (busy || !current()) return;
    let recipe, password;
    try { ({ recipe, password } = recipeFromForm(form)); }
    catch (failure) { error.textContent = failure.message; return; }
    const name = generateWattenTableName(account.username, window.ZDWA_I18N.getLanguage());
    busy = true;
    const controls = [...form.querySelectorAll("input, select, button, summary")];
    const previouslyDisabled = controls.map(control => control.disabled);
    controls.forEach(control => { if ("disabled" in control) control.disabled = true; });
    closeButton.disabled = true; dialog.setAttribute("aria-busy", "true"); error.textContent = "";
    try {
      // Bind creation to the mounted account; never adopt another's CSRF token.
      const fresh = await loadAuth({ refresh: true });
      if (!current() || !fresh.authenticated || fresh.user.id !== account.id) throw new Error(t("auth.changed"));
      const response = await fetch("/api/games", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": fresh.user.csrf_token,
          "X-Watten-Expected-Account-Id": String(account.id) },
        body: JSON.stringify({ name, mode: String(recipe.player_count), game_type: "watten", watten_recipe: recipe, ...(password ? { pass: password } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!current()) return;
      if (response.status === 401) { refreshAuth(); throw new Error(t("error.authentication_required")); }
      if (!response.ok || !GAME_PATH.test(data.game_id || "")) throw new Error(errorText(detailCode(data.detail)));
      navigate(`/watten/spiel/${data.game_id}`);
    } catch (failure) {
      // Every selected option stays as chosen for a corrected retry.
      if (current() && failure.name !== "AbortError") error.textContent = failure.message || t("error.generic");
    } finally {
      busy = false;
      if (current()) {
        controls.forEach((control, index) => { if ("disabled" in control) control.disabled = previouslyDisabled[index]; });
        submit.disabled = false; closeButton.disabled = false; dialog.removeAttribute("aria-busy");
      }
    }
  });
}

function tablesMarkup() {
  return `<section class="wt-card-panel wt-tables-panel" aria-labelledby="wattenTablesTitle">
    <div class="wt-section-head"><h2 id="wattenTablesTitle">${esc(t("lobby.tables"))}</h2>
      <button type="button" class="wt-button--ghost wt-button--small" data-watten-command="refresh-tables">${esc(t("lobby.refresh"))}</button></div>
    <ul class="wt-table-list" data-watten-tables aria-busy="true"></ul>
    <p class="wt-note" data-watten-tables-status role="status">${esc(t("lobby.loading"))}</p>
  </section>`;
}

function tableEntry(entry) {
  if (!GAME_PATH.test(entry.id || "") || !entry.room) return "";
  const seats = entry.room.seats || [];
  const taken = seats.filter(seat => seat.participant_id).length;
  const status = entry.paused ? t("lobby.paused") : entry.started ? t("lobby.running") : t("lobby.waiting");
  const base = `/watten/spiel/${entry.id}`;
  const links = entry.my_player_id
    ? `<a class="wt-button" href="${base}">${esc(t(entry.can_resume ? "lobby.return" : "lobby.open"))}</a>`
    : entry.started
      ? `<a class="wt-button wt-button--ghost" href="${base}/zuschauen">${esc(t("lobby.spectate"))}</a>`
      : `<a class="wt-button" href="${base}">${esc(t("lobby.join"))}</a>`;
  return `<li class="wt-table-entry" data-watten-table="${entry.id}">
    <div class="wt-table-entry-head"><strong translate="no">${esc(entry.name)}</strong>
      <span class="wt-tag">${esc(status)}</span>${entry.locked ? `<span class="wt-tag">${esc(t("recipe.password"))}</span>` : ""}</div>
    <p class="wt-table-entry-meta">${esc(t("recipe.players", { count: seats.length }))} · ${esc(t("recipe.target", { points: entry.room.recipe.target_points }))} · ${esc(t("lobby.seats", { taken, count: seats.length }))}</p>
    <div class="wt-table-entry-foot"><span class="wt-note">${esc(t(entry.room.recipe.blind ? "recipe.blind" : "recipe.open"))} · ${esc(t(entry.room.recipe.determination === "ladinisch" ? "recipe.ladinisch" : "recipe.normal"))}</span><div class="wt-actions">${links}</div></div>
  </li>`;
}

async function refreshTables(gen) {
  const list = app.querySelector("[data-watten-tables]");
  const status = app.querySelector("[data-watten-tables-status]");
  if (!list) return;
  try {
    const response = await fetch("/api/games?game_type=watten", { cache: "no-store" });
    if (gen !== generation) return;
    if (response.status === 401) { refreshAuth(); return; }
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (gen !== generation) return;
    const games = (Array.isArray(data.games) ? data.games : []).slice().sort((a, b) =>
      Number(Boolean(b.my_player_id)) - Number(Boolean(a.my_player_id)) || Number(a.started) - Number(b.started));
    list.innerHTML = games.map(tableEntry).join("");
    list.setAttribute("aria-busy", "false");
    status.textContent = games.length ? "" : t("lobby.empty");
  } catch {
    if (gen === generation) status.textContent = t("lobby.loadFailed");
  }
}

async function mountLobby() {
  const gen = generation;
  if (!publicLandingMarkup) app.innerHTML = lobbyIntro({ status: t("lobby.loading") }) + lobbyGuide();
  let auth;
  try { auth = await loadAuth({ refresh: true }); } catch {
    if (gen !== generation) return;
    renderNav(null);
    app.innerHTML = publicLandingMarkup || lobbyIntro({ status: t("auth.unavailable") }) + lobbyGuide();
    if (publicLandingMarkup) initializeAppMode({ mode: "watten" });
    return;
  }
  if (gen !== generation) return;
  renderNav(auth);
  if (!auth.authenticated) {
    anonymousMount = true;
    app.innerHTML = publicLandingMarkup || lobbyIntro() + lobbyGuide();
    if (publicLandingMarkup) initializeAppMode({ mode: "watten" });
    return;
  }
  account = { id: auth.user.id, username: auth.user.username };
  latestUserId = account.id;
  initializeAppMode({ mode: "watten" });
  app.innerHTML = `${lobbyIntro({ signedIn: true })}<div class="wt-friend-activity-host" data-watten-friend-activity aria-live="polite" hidden></div>
    <div class="wt-lobby-grid">${tablesMarkup()}<details class="wt-lobby-chat-disclosure"><summary>${esc(lt("chat"))}</summary><div data-watten-lobby-chat></div></details></div>${lobbyGuide()}${creatorMarkup()}`;
  mountCreator(gen);
  mountFriendActivity(gen, "lobby");
  const lobbyChat = mountWattenLobbyChat({ container: app.querySelector("[data-watten-lobby-chat]"), initialAuth: auth,
    getExpectedAccountId: () => account?.id,
    isCurrent: () => gen === generation && !navigating && latestUserId === account?.id,
    onAccountChanged: reloadFresh, loadAuth, escapeHtml: esc });
  cleanups.add(() => lobbyChat.destroy());
  void refreshTables(gen);
  const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshTables(gen); }, 8000);
  cleanups.add(() => clearInterval(timer));
}

/** Lobby notices may offer an explicit Watch; table notices are text only. */
function mountFriendActivity(gen, placement) {
  const container = app.querySelector("[data-watten-friend-activity]");
  if (!container) return;
  const friends = createFriendActivity({ container, placement, loadAuth, escapeHtml: esc,
    getExpectedAccountId: () => account?.id,
    isCurrent: () => gen === generation && !navigating && latestUserId === account?.id,
    onAccountChanged: reloadFresh,
    onWatch: placement === "lobby" ? path => navigate(path) : undefined });
  cleanups.add(() => friends.destroy());
}

// ---------------------------------------------------------------------------
// Table session

const session = {
  socket: null, serial: 0, intent: "rejoin", password: null, spectatorPassword: null,
  bound: false, playerId: null, spectator: page === "spectator", live: false, snapshot: null, preview: null,
  inFlight: null, queued: null, reconnectTimer: 0, reconnectAttempts: 0, rejoinAttempts: 0, joinAttempts: 0,
  fatal: "", joinError: "", spectateError: "", joining: false,
  pendingDeparture: null,
  deliveries: new Map(), ackTimer: 0, bubbles: [], flash: "", flashKind: "", flashTimer: 0,
  view: null, viewKind: "", connection: "",
};
const motion = createMotion();
const roundReview = createRoundReview({ motion, onChange: () => { if (!navigating) render(); } });

function shellMarkup() {
  return `<h1 class="wt-visually-hidden" data-watten-heading translate="no">Watten</h1>
    <div class="wt-status-bar"><p class="wt-connection" data-watten-connection role="status"></p>
      <p class="wt-flash" data-watten-flash role="alert"></p>
      <div class="wt-friend-activity-host wt-friend-activity-host--table" data-watten-friend-activity aria-live="polite" hidden></div></div>
    <div class="wt-view" data-watten-view></div>
    <div data-watten-social hidden></div>
    <div data-watten-decor hidden></div>
    <div data-watten-voice></div>
    <dialog class="wt-dialog" data-watten-leave-dialog aria-labelledby="wattenLeaveTitle">
      <h2 id="wattenLeaveTitle">${esc(t("leave.title"))}</h2>
      <p>${esc(t("leave.body"))}</p>
      <div class="wt-actions"><button type="button" data-watten-command="leave-confirm" class="wt-primary">${esc(t("leave.confirm"))}</button>
        <button type="button" class="wt-button--ghost" data-watten-command="leave-cancel">${esc(t("leave.cancel"))}</button></div>
    </dialog>`;
}

const viewRoot = () => app.querySelector("[data-watten-view]");

function setConnection(state) {
  session.connection = state;
  const node = app.querySelector("[data-watten-connection]");
  if (!node) return;
  node.textContent = state === "cards" ? t("card.loading") : state === "reconnecting" ? t("connection.reconnecting") : state === "connecting" ? t("connection.connecting") : "";
  node.hidden = !node.textContent;
}

function flash(message, kind = "error") {
  session.flash = message;
  session.flashKind = kind;
  const node = app.querySelector("[data-watten-flash]");
  if (node) { node.textContent = message; node.dataset.kind = kind; node.hidden = !message; }
  clearTimeout(session.flashTimer);
  if (message) session.flashTimer = setTimeout(() => flash(""), 6000);
}

function setHeading(name) {
  const heading = app.querySelector("[data-watten-heading]");
  if (heading) heading.textContent = name || "Watten";
  if (name) document.title = `${name} · Watten`;
}

function showMessage(title, body, actions = "") {
  decor?.suspend();
  motion.cancel();
  delete html.dataset.wattenActive;
  session.view?.destroy?.();
  session.view = null;
  session.viewKind = "message";
  const root = viewRoot();
  if (!root) return;
  root.innerHTML = `<section class="wt-card-panel wt-message"><h2>${esc(title)}</h2><p>${esc(body)}</p><div class="wt-actions">${actions}</div></section>`;
  decor?.update({ publicPhase: "offline" });
}

const lobbyLink = () => `<a class="wt-button" href="${publicPageUrl("/watten")}">${esc(t("nav.lobby"))}</a>`;

function closeSocket() {
  voice?.disconnected();
  motion.cancel();
  const socket = session.socket;
  session.socket = null;
  session.serial += 1;
  session.bound = false;
  social?.disconnect();
  clearTimeout(session.reconnectTimer);
  clearTimeout(session.ackTimer);
  clearInFlight();
  session.queued = null;
  if (socket && socket.readyState <= WebSocket.OPEN) {
    try { socket.close(1000); } catch { /* Already closing. */ }
  }
}

function socketOpen() {
  return session.socket?.readyState === WebSocket.OPEN;
}

function sendRaw(payload) {
  if (!socketOpen()) return false;
  session.socket.send(JSON.stringify(payload));
  return true;
}

async function connect(intent, password = null) {
  closeSocket();
  const gen = generation, serial = session.serial;
  try {
    const fresh = await loadAuth({ refresh: true });
    if (gen !== generation || serial !== session.serial || navigating) return;
    if (!fresh.authenticated || fresh.user.id !== account?.id) { reloadFresh(); return; }
  } catch {
    if (gen === generation && serial === session.serial) {
      setConnection("");
      showMessage(t("auth.unavailableTitle"), t("auth.unavailable"),
        `<button type="button" data-watten-command="reconnect">${esc(t("connection.retry"))}</button>${lobbyLink()}`);
    }
    return;
  }
  session.intent = intent;
  session.password = password;
  session.live = false;
  session.fatal = "";
  setConnection(session.snapshot ? "reconnecting" : "connecting");
  let socket;
  try {
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${gameId}`);
  } catch {
    scheduleReconnect();
    return;
  }
  session.socket = socket;
  const current = () => gen === generation && serial === session.serial;
  socket.addEventListener("message", event => {
    if (!current()) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data && typeof data === "object") onMessage(data);
  });
  socket.addEventListener("close", event => { if (current()) onClose(event); });
}

function scheduleReconnect() {
  clearTimeout(session.reconnectTimer);
  if (session.pendingDeparture) return;
  const gen = generation;
  const delay = Math.min(10000, 800 * 2 ** Math.min(session.reconnectAttempts, 4));
  session.reconnectAttempts += 1;
  setConnection("reconnecting");
  session.reconnectTimer = setTimeout(async () => {
    try {
      const auth = await loadAuth({ refresh: true });
      if (gen !== generation || !auth.authenticated || auth.user.id !== account?.id) return;
    } catch {
      if (gen === generation) scheduleReconnect();
      return;
    }
    // Network recovery is a plain rejoin: never a resume or a new join.
    connect(session.spectator ? "spectate" : "rejoin", session.spectator ? session.spectatorPassword : null);
  }, delay);
}

function onMessage(data) {
  if (voice?.receive(data) || decor?.receive(data)) return;
  // Public social frames update their own bounded log, never the card view.
  if (social?.receive(data)) return;
  if (typeof data.error === "string" || typeof data.error_code === "string") { onError(data); return; }
  if (data.capabilities && Number.isInteger(data.room_revision)) { onGreeting(data); return; }
  if (typeof data.player_id === "string" && data.game_type === "watten") {
    session.bound = true;
    session.spectator = false;
    session.playerId = data.player_id;
    session.intent = "rejoin";
    session.password = null;
    session.joining = false;
    session.joinError = "";
    session.reconnectAttempts = 0;
    session.rejoinAttempts = 0;
    setConnection("");
    if (session.inFlight?.action === "resume") clearInFlight();
    syncSocial();
    voice?.connected();
    return;
  }
  if (typeof data.spectator_id === "string") {
    session.bound = true;
    session.spectator = true;
    session.password = null;
    session.reconnectAttempts = 0;
    setConnection("");
    syncSocial();
  }
  if (data.scoreboard) adopt(data.scoreboard, data.watten_public_call_events);
  if (data.watten_command) onAck(data.watten_command);
}

function onGreeting(greeting) {
  if (greeting.id !== gameId) { closeSocket(); showMessage(t("table.notFound"), t("table.notFoundBody"), lobbyLink()); return; }
  const passphrase = session.password ? { passphrase: session.password } : {};
  const expected_account_id = account.id;
  if (session.intent === "spectate") sendRaw({ action: "spectate_game", expected_account_id, ...passphrase });
  else if (session.intent === "join") sendRaw({ action: "join_game", revision: greeting.room_revision, expected_account_id, ...passphrase });
  else sendRaw({ action: "rejoin_game", revision: greeting.room_revision, expected_account_id });
}

function onError(data) {
  const code = data.error_code || data.error;
  if (data.fatal) session.fatal = code;
  if (data.fatal) social?.disconnect(true);
  if (!session.bound) {
    if (session.intent === "join" && STALE.has(code) && session.joinAttempts < 2) {
      // The visitor's join intent is current; only the room revision moved.
      session.joinAttempts += 1;
      connect("join", session.password);
      return;
    }
    if (session.intent === "join") {
      session.joining = false;
      session.joinError = errorText(code);
      closeSocket();
      setConnection("");
      renderJoinPrompt();
      return;
    }
    if (session.intent === "spectate") {
      session.spectatorPassword = null;
      session.spectateError = errorText(code);
      closeSocket();
      setConnection("");
      renderSpectatePrompt();
      return;
    }
    if (STALE.has(code) && session.rejoinAttempts < 3) {
      session.rejoinAttempts += 1;
      connect("rejoin");
      return;
    }
    closeSocket();
    setConnection("");
    showMessage(t("connection.failed"), errorText(code), `<button type="button" data-watten-command="reconnect">${esc(t("connection.retry"))}</button>${lobbyLink()}`);
    return;
  }
  const failed = session.inFlight;
  clearInFlight();
  if (failed?.action === "watten_leave" || failed?.action === "leave_waiting_game") session.pendingDeparture = null;
  if (failed?.action === "watten_delivery_ack") {
    for (const id of failed.ids || []) if (session.deliveries.get(id) === "sending") session.deliveries.set(id, "shown");
  } else {
    flash(failed?.action === "resume" && STALE.has(code) ? t("pause.stale") : errorText(code));
  }
  if (STALE.has(code)) sendRaw({ action: "get_state" });
  render();
  flushQueue();
}

function onClose(event) {
  voice?.disconnected({ revoke: event.code === 1008 || Boolean(session.fatal) });
  motion.cancel();
  const wasBound = session.bound;
  session.socket = null;
  session.bound = false;
  social?.disconnect(event.code === 1008 || Boolean(session.fatal));
  clearInFlight();
  session.queued = null;
  if (session.pendingDeparture) { void reconcileDeparture(); return; }
  if (session.intent === "join" && !wasBound) {
    session.joining = false;
    session.joinError = t("error.network");
    setConnection("");
    renderJoinPrompt();
    return;
  }
  if (event.code === 1008 || session.fatal) {
    setConnection("");
    showMessage(t("connection.ended"), session.fatal ? errorText(session.fatal) : t("connection.replaced"),
      `<button type="button" data-watten-command="reconnect">${esc(t("connection.here"))}</button>${lobbyLink()}`);
    return;
  }
  render();
  scheduleReconnect();
}

async function manualReconnect() {
  session.pendingDeparture = null;
  const gen = generation;
  try {
    const auth = await loadAuth({ refresh: true });
    if (gen !== generation || !auth.authenticated || auth.user.id !== account?.id) return;
  } catch { flash(t("auth.unavailable")); return; }
  session.reconnectAttempts = 0;
  session.rejoinAttempts = 0;
  if (session.spectator) connect("spectate", session.spectatorPassword);
  else if (session.playerId) connect("rejoin");
  else void loadDetail(gen);
}

function clearInFlight() {
  if (session.inFlight) clearTimeout(session.inFlight.timer);
  session.inFlight = null;
}

function commandId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** One authoritative command at a time, bound to the account that mounted it. */
function dispatch(payload, meta) {
  if (!session.bound || session.spectator || navigating || !account) return false;
  if (session.pendingDeparture) return false;
  if (latestUserId !== account.id) { reloadFresh(); return false; }
  if (session.inFlight) {
    if (session.inFlight.action === "watten_delivery_ack" && !meta.background && !session.queued) {
      session.queued = { payload, meta };
      render();
      return true;
    }
    return false;
  }
  if (!sendRaw(payload)) return false;
  if (meta.action === "watten_leave" || meta.action === "leave_waiting_game") session.pendingDeparture = meta.action;
  const gen = generation;
  session.inFlight = { ...meta, id: payload.command_id, timer: setTimeout(() => {
    if (gen !== generation || session.inFlight?.id !== payload.command_id) return;
    clearInFlight();
    if (session.pendingDeparture) { void reconcileDeparture(); return; }
    flash(t("error.noAnswer"));
    sendRaw({ action: "get_state" });
    render();
  }, 10000) };
  if (!meta.background) render();
  return true;
}

function flushQueue() {
  if (session.inFlight || !session.queued) return;
  const { payload, meta } = session.queued;
  session.queued = null;
  dispatch(payload, meta);
}

function roomCommand(action, extra = {}, meta = {}) {
  const snapshot = session.snapshot;
  if (!snapshot) return false;
  return dispatch({ action, command_id: commandId(), revision: snapshot.room.revision,
    lifecycle_revision: snapshot.lifecycle_revision, ...extra }, { action, ...meta });
}

function engineCommand(kind, value = null, privateOpportunity = null) {
  const snapshot = session.snapshot, engine = snapshot?.engine;
  if (!engine) return false;
  return dispatch({
    action: "watten_command", command_id: commandId(), deal_id: engine.deal_id, opportunity: engine.opportunity,
    phase: engine.phase, kind, value, private_opportunity: kind === "partner_feedback" ? privateOpportunity : null,
    lifecycle_revision: snapshot.lifecycle_revision,
  }, { action: "watten_command", kind });
}

function onAck(ack) {
  const done = session.inFlight;
  if (!done || ack.command_id !== done.id) return;
  clearInFlight();
  if (done.action === "watten_leave" || done.action === "leave_waiting_game") {
    voice?.destroy(); voice = null;
    session.pendingDeparture = null;
    // Only an accepted leave returns to the lobby.
    navigate("/watten");
    return;
  }
  if (done.action === "watten_delivery_ack") for (const id of done.ids || []) session.deliveries.set(id, "acked");
  render();
  flushQueue();
  scheduleDeliveryAck();
}

function resume() {
  const snapshot = session.snapshot;
  if (!snapshot?.can_resume || session.inFlight || !session.bound || !account) return;
  if (latestUserId !== account.id) { reloadFresh(); return; }
  // Explicit return in a fresh lifecycle epoch. A stale answer is reported,
  // never retried automatically as a new intent.
  if (!sendRaw({ action: "rejoin_game", revision: snapshot.room.revision, expected_account_id: account.id, resume: true, lifecycle_revision: snapshot.lifecycle_revision })) return;
  const gen = generation;
  session.inFlight = { action: "resume", id: null, timer: setTimeout(() => {
    if (gen !== generation || session.inFlight?.action !== "resume") return;
    clearInFlight();
    render();
  }, 10000) };
  render();
}

async function reconcileDeparture() {
  const gen = generation;
  setConnection("");
  showMessage(t("leave.checking"), t("leave.checkingBody"), lobbyLink());
  try {
    const fresh = await loadAuth({ refresh: true });
    if (gen !== generation || !fresh.authenticated || fresh.user.id !== account?.id) return;
    const response = await fetch(`/api/games/${gameId}`, { cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    if (gen !== generation || !session.pendingDeparture) return;
    if (data?.exists && (!data.viewer?.participant_id || data.can_resume)) { navigate("/watten"); return; }
  } catch { /* Keep the unresolved leave intent; never admit the account again automatically. */ }
  if (gen === generation && !navigating) showMessage(t("leave.uncertain"), t("leave.uncertainBody"),
    `${lobbyLink()}<button type="button" data-watten-command="reconnect">${esc(t("connection.here"))}</button>`);
}

// Normal calls: show each allowed delivery once, then acknowledge it.

function presentCall(event, snapshot) {
  const valid = event.kind === "strike_announced" ? STRIKES.includes(event.value)
    : event.kind === "colour_announced" ? SUITS.includes(event.value) : false;
  if (!valid || !Number.isInteger(event.seat) || !snapshot.room.seats[event.seat]) return;
  const text = event.kind === "strike_announced" ? t("call.strike", { value: strikeName(event.value) })
    : t("call.colour", { value: suitName(event.value) });
  const bubble = { key: `${event.delivery_id || event.kind}-${Date.now()}`, seat: event.seat, text };
  session.bubbles = [...session.bubbles.slice(-3), bubble];
  session.callAnnouncement = t("call.announced", { name: snapshot.room.seats[event.seat].name || "", text });
  const gen = generation;
  const timer = setTimeout(() => {
    cleanups.delete(cancel);
    if (gen !== generation) return;
    // Reference OFF: no persistent call text remains after this moment.
    session.bubbles = session.bubbles.filter(item => item !== bubble);
    render();
  }, 5200);
  const cancel = () => clearTimeout(timer);
  cleanups.add(cancel);
}

function consumeCalls(snapshot) {
  for (const event of Array.isArray(snapshot.pending_call_events) ? snapshot.pending_call_events : []) {
    if (typeof event?.delivery_id !== "string" || session.deliveries.has(event.delivery_id)) continue;
    session.deliveries.set(event.delivery_id, "shown");
    presentCall(event, snapshot);
  }
  while (session.deliveries.size > 24) session.deliveries.delete(session.deliveries.keys().next().value);
}

function scheduleDeliveryAck() {
  clearTimeout(session.ackTimer);
  const gen = generation;
  session.ackTimer = setTimeout(() => {
    if (gen !== generation || session.inFlight || !session.bound || session.spectator) return;
    const pending = session.snapshot?.pending_call_events || [];
    const ids = pending.map(item => item.delivery_id).filter(id => session.deliveries.get(id) === "shown").slice(0, 2);
    if (!ids.length) return;
    for (const id of ids) session.deliveries.set(id, "sending");
    if (!roomCommand("watten_delivery_ack", { delivery_ids: ids }, { background: true, ids })) {
      for (const id of ids) session.deliveries.set(id, "shown");
    }
  }, 700);
}

// Snapshots

function adopt(snapshot, publicCalls) {
  if (!snapshot || snapshot.id !== gameId || snapshot.game_type !== "watten" || !snapshot.room) return;
  // A player only ever adopts their own projection.
  if (!session.spectator && snapshot.viewer?.participant_id !== session.playerId) return;
  const previous = session.snapshot;
  const live = session.live;
  session.snapshot = snapshot;
  if (previous?.engine && snapshot.engine && !sameHandVersion(previous.engine, snapshot.engine)) {
    session.bubbles = [];
    session.callAnnouncement = "";
  }
  session.live = true;
  if (session.pendingDeparture && !session.inFlight) return;
  setConnection("");
  if (!session.spectator) consumeCalls(snapshot);
  else if (Array.isArray(publicCalls)) for (const event of publicCalls) presentCall(event, snapshot);
  render(previous, live, true);
  scheduleDeliveryAck();
}

function preserveFocus(update) {
  const active = document.activeElement;
  const key = active?.closest?.("[data-watten-command]") && app.contains(active)
    ? [active.dataset.wattenCommand, active.dataset.seat, active.dataset.value, active.dataset.kind] : null;
  update();
  if (!key || document.activeElement !== document.body) return;
  const match = [...app.querySelectorAll("[data-watten-command]")].find(node =>
    [node.dataset.wattenCommand, node.dataset.seat, node.dataset.value, node.dataset.kind].join("|") === key.join("|"));
  match?.focus({ preventScroll: true });
}

function liveMessage(snapshot, engine, actions) {
  if (snapshot.paused) return t(snapshot.can_resume ? "pause.self" : "pause.title");
  if (session.callAnnouncement) return session.callAnnouncement;
  if (engine.preplay?.bloedeln_consent?.pending) return t("roundOptions.bloedeln.waitBoth");
  if (actions.includes("preplay_accept") && engine.preplay?.pending) {
    return t(`roundOptions.${engine.preplay.pending.kind}.pending`, { name: snapshot.room.seats[engine.preplay.pending.requester]?.name || t("seat.unknown") });
  }
  if (actions.some(action => action.startsWith("respond_"))) return t("bid.yourDecision");
  if (actions.includes("play_card")) return t("play.yourTurn");
  if (engine.inspection) return t("inspection.title");
  if (engine.phase === "deal_complete") return t("deal.over");
  if (engine.phase === "match_complete") return t("match.over");
  return "";
}

function render(previous = null, live = false, accepted = false) {
  const snapshot = session.snapshot;
  const root = viewRoot();
  if (!snapshot || !root) return;
  decor?.suspend();
  voice?.update(snapshot);
  setHeading(snapshot.name);
  if (!snapshot.engine) {
    roundReview.discard();
    beginnerGuide.update({ eligible: false });
    motion.cancel();
    session.view?.destroy?.();
    delete html.dataset.wattenActive;
    if (snapshot.room.status === "closed") {
      if (session.viewKind !== "closed" || !root.querySelector("[data-watten-rematch]")) {
        showMessage(t("waiting.closedTitle"), t("waiting.closed"), `${lobbyLink()}<div data-watten-rematch hidden></div>`);
        session.view = null;
        session.viewKind = "closed";
      }
      rematch?.update({ container: root.querySelector("[data-watten-rematch]"), snapshot,
        playerId: session.playerId, spectator: session.spectator, busy: Boolean(session.inFlight) });
      syncDecor();
      return;
    }
    session.view = null;
    session.viewKind = "waiting";
    preserveFocus(() => {
      root.innerHTML = waitingRoomMarkup(snapshot, {
        mode: session.spectator ? "spectator" : "member", viewerId: session.playerId,
        busy: Boolean(session.inFlight) || !session.bound,
      });
    });
    openSeatNotifications?.update();
    syncDecor();
    return;
  }
  if (session.viewKind !== "table" || !session.view) {
    motion.cancel();
    session.view?.destroy?.();
    session.viewKind = "table";
    session.view = createTableView(root, { onCard: card => engineCommand("play_card", card), accountId: account?.id });
  }
  html.dataset.wattenActive = "true";
  const engine = snapshot.engine;
  const count = snapshot.room.recipe.player_count;
  const viewerSeat = session.spectator ? null : engine.viewer?.seat ?? null;
  const actions = session.spectator ? [] : Array.isArray(engine.actions) ? engine.actions : [];
  const sameDeal = live && sameHandVersion(previous?.engine, engine);
  const prevTrick = previous?.engine?.current_trick?.cards?.length || 0;
  const vm = {
    snapshot, engine, room: snapshot.room, count, viewerSeat, anchorSeat: viewerSeat ?? 0,
    playerId: session.spectator ? null : session.playerId, spectator: session.spectator, actions,
    busy: Boolean(session.inFlight) || !session.bound,
    paused: Boolean(snapshot.paused), awaited: snapshot.awaited_participant_ids || [], canResume: Boolean(snapshot.can_resume),
    isHost: !session.spectator && snapshot.room.host_participant_id === session.playerId,
    canLeave: !session.spectator && viewerSeat !== null && engine.phase !== "match_complete" && !snapshot.can_resume,
    bubbles: session.bubbles,
    feedbackDismissed: session.inFlight?.kind === "partner_feedback",
    freshTrickEnd: sameDeal && prevTrick > 0 && !engine.current_trick?.cards?.length && Boolean(engine.last_trick),
    roundPresentation: roundReview.update(snapshot, accepted),
    liveMessage: liveMessage(snapshot, engine, actions),
  };
  session.callAnnouncement = "";
  const captured = accepted ? motion.capture(session.view.motionSources()) : null;
  let result;
  preserveFocus(() => { result = session.view.update(vm); });
  if (vm.roundPresentation.stage === "ready") matchProgress?.update({ container: root.querySelector("[data-watten-match-progress]"), snapshot,
    playerId: session.playerId, spectator: session.spectator });
  if (vm.roundPresentation.stage === "ready") rematch?.update({ container: root.querySelector("[data-watten-rematch]"), snapshot,
    playerId: session.playerId, spectator: session.spectator, busy: Boolean(session.inFlight) || !session.bound });
  syncDecor();
  if (accepted) motion.present({ previous: previous?.engine, engine, live, captured, result, view: session.view });
  roundReview.afterMotion();
  beginnerGuide.update({ eligible: !session.spectator && viewerSeat !== null && engine.phase !== "match_complete",
    canAct: session.bound && !snapshot.paused, busy: Boolean(session.inFlight) || !session.bound });
}

function renderJoinPrompt() {
  const data = session.preview;
  const root = viewRoot();
  if (!data || !root) return;
  decor?.suspend();
  motion.cancel();
  delete html.dataset.wattenActive;
  session.view = null;
  session.viewKind = "join";
  setHeading(data.name);
  const locked = data.locked ?? data.room.recipe.password_required;
  root.innerHTML = waitingRoomMarkup(data, {
    mode: "preview", viewerId: null,
    extra: joinFormMarkup({ locked, error: session.joinError, busy: session.joining, started: data.room.status !== "waiting" }),
  });
  decor?.update({ publicPhase: "preview" });
}

function renderSpectatePrompt() {
  const data = session.preview;
  const root = viewRoot();
  if (!data || !root) return;
  decor?.suspend();
  motion.cancel();
  delete html.dataset.wattenActive;
  session.view = null;
  session.viewKind = "spectate";
  setHeading(data.name);
  root.innerHTML = waitingRoomMarkup(data, { mode: "spectator", viewerId: null,
    extra: spectateFormMarkup({ error: session.spectateError, busy: false }) });
  decor?.update({ publicPhase: "preview" });
}

async function loadDetail(gen) {
  const expectedAccountId = account?.id;
  let result;
  try {
    result = await loadWattenDetail({ gameId, accountId: expectedAccountId, fetcher: (url, options) => fetch(url, options), loadAuth,
      isCurrent: () => gen === generation && !navigating && account?.id === expectedAccountId && latestUserId === expectedAccountId,
      onAccountChanged: reloadFresh });
  } catch {
    if (gen === generation) showMessage(t("connection.failed"), t("error.network"), `<button type="button" data-watten-command="reconnect">${esc(t("connection.retry"))}</button>`);
    return;
  }
  if (!result || gen !== generation) return;
  const data = result.data;
  if (!result.ok || !data || data.exists === false || !data.room) {
    showMessage(t("table.notFound"), t("table.notFoundBody"), lobbyLink());
    return;
  }
  session.preview = data;
  const member = Boolean(data.viewer?.participant_id || data.my_player_id);
  if (data.room.status === "closed" && member && page !== "spectator") {
    // Closed rooms need no socket admission. The HTTP projection is already
    // bound to the mounted account before exposing its rematch controls.
    session.snapshot = data;
    session.playerId = data.viewer?.participant_id || data.my_player_id;
    setConnection(""); render(); return;
  }
  if (page === "spectator") {
    const locked = data.locked ?? data.room.recipe.password_required;
    if (locked && !member) renderSpectatePrompt();
    else connect("spectate");
  } else if (member) connect("rejoin");
  else renderJoinPrompt();
}

async function mountTable() {
  const gen = generation;
  app.innerHTML = shellMarkup();
  app.classList.add("wt-main--table");
  setConnection("connecting");
  if (!gameId) { showMessage(t("table.notFound"), t("table.notFoundBody"), lobbyLink()); return; }
  let auth;
  try { auth = await loadAuth({ refresh: true }); } catch {
    if (gen !== generation) return;
    renderNav(null);
    setConnection("");
    showMessage(t("auth.unavailableTitle"), t("auth.unavailable"), `<a class="wt-button" href="${esc(signInUrl())}">${esc(t("nav.signIn"))}</a>`);
    return;
  }
  if (gen !== generation) return;
  renderNav(auth);
  if (!auth.authenticated) {
    anonymousMount = true;
    setConnection("");
    showMessage(t("auth.signedOutTitle"), t("auth.signedOut"), `<a class="wt-button" href="${esc(signInUrl())}">${esc(t("nav.signIn"))}</a>`);
    return;
  }
  account = { id: auth.user.id, username: auth.user.username };
  latestUserId = account.id;
  initializeAppMode({ mode: "watten" });
  matchProgress?.destroy();
  matchProgress = createMatchProgress({ gameId, apiFetch, loadAuth, escapeHtml: esc,
    getExpectedAccountId: () => account?.id,
    isCurrent: () => gen === generation && !navigating && latestUserId === account?.id,
    onAccountChanged: reloadFresh });
  cleanups.add(() => { matchProgress?.destroy(); matchProgress = null; });
  rematch?.destroy();
  rematch = createRematch({ gameId, fetcher: (url, options) => fetch(url, options), loadAuth, escapeHtml: esc,
    makeCommandId: commandId, navigate,
    getExpectedAccountId: () => account?.id,
    isCurrent: () => gen === generation && !navigating && latestUserId === account?.id,
    onAccountChanged: reloadFresh });
  cleanups.add(() => { rematch?.destroy(); rematch = null; });
  openSeatNotifications?.destroy();
  openSeatNotifications = createOpenSeatNotifications({ root: app, gameId, apiFetch, loadAuth,
    getSnapshot: () => session.spectator ? null : session.snapshot,
    getExpectedAccountId: () => account?.id, isBusy: () => Boolean(session.inFlight) || !session.bound,
    isCurrent: () => gen === generation && !navigating && latestUserId === account?.id,
    onAccountChanged: reloadFresh });
  cleanups.add(() => { openSeatNotifications?.destroy(); openSeatNotifications = null; });
  social?.destroy();
  social = createSocial({ gameId, escapeHtml: esc,
    getExpectedAccountId: () => account?.id,
    isCurrent: () => gen === generation && !navigating && latestUserId === account?.id,
    send: payload => session.bound && latestUserId === account?.id && sendRaw(payload) });
  cleanups.add(() => { social?.destroy(); social = null; });
  decor?.destroy();
  decor = createDecor({ container: app.querySelector("[data-watten-decor]"), root: app, escapeHtml: esc,
    onSurprise: payload => session.bound && !session.spectator && latestUserId === account?.id && sendRaw(payload),
    getExpectedAccountId: () => account?.id,
    isCurrent: () => gen === generation && !navigating && latestUserId === account?.id });
  cleanups.add(() => { decor?.destroy(); decor = null; });
  if (page !== "spectator") {
    voice?.destroy();
    voice = createWattenVoice({ send: sendRaw, userId: account.id,
      isCurrent: () => gen === generation && latestUserId === account?.id && !navigating });
    voice.attach(app.querySelector("[data-watten-voice]"));
    cleanups.add(() => { voice?.destroy(); voice = null; });
  }
  mountFriendActivity(gen, "table");
  setConnection("cards");
  try { await prepareWattenCards(); } catch {
    if (gen !== generation) return;
    setConnection("");
    showMessage(t("card.failedTitle"), t("card.failed"),
      `<button type="button" data-watten-command="retry-assets">${esc(t("connection.retry"))}</button>${lobbyLink()}`);
    return;
  }
  if (gen !== generation) return;
  await loadDetail(gen);
}

function syncSocial() {
  social?.update({ container: app.querySelector("[data-watten-social]"),
    bound: session.bound && socketOpen(), authorized: session.bound && (session.spectator || Boolean(session.playerId)) });
}

function syncDecor() {
  decor?.update({ surpriseOffer: session.snapshot?.table_surprise_offer, publicPhase: session.snapshot?.paused ? "paused"
    : session.snapshot?.engine?.phase || session.snapshot?.room?.status || "preview" });
}

function openLeaveDialog() {
  const dialog = app.querySelector("[data-watten-leave-dialog]");
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  dialog.querySelector("[data-watten-command=leave-cancel]")?.focus();
}

function closeLeaveDialog() {
  const dialog = app.querySelector("[data-watten-leave-dialog]");
  if (dialog?.open) { if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); }
}

async function copyLink(control) {
  const status = app.querySelector("[data-watten-copy-status]");
  const link = `${location.origin}/watten/spiel/${gameId}`;
  try {
    await navigator.clipboard.writeText(link);
    if (status) status.textContent = t("waiting.copied");
  } catch {
    if (status) status.textContent = t("waiting.copyManual", { link });
  }
  control.focus({ preventScroll: true });
}

app.addEventListener("click", event => {
  const control = event.target.closest?.("[data-watten-command]");
  if (!control || control.disabled || !app.contains(control)) return;
  const snapshot = session.snapshot;
  switch (control.dataset.wattenCommand) {
    case "refresh-tables": void refreshTables(generation); break;
    case "decline-reservation": roomCommand("watten_decline_reservation"); break;
    case "take-seat": {
      const seat = Number(control.dataset.seat);
      if (!snapshot || !Number.isInteger(seat)) break;
      roomCommand("watten_take_seat", { seat, team: snapshot.room.recipe.player_count === 4 ? seat % 2 : null });
      break;
    }
    case "start": roomCommand("watten_start"); break;
    case "place-cpu": roomCommand("watten_place_cpu", { seat: Number(control.dataset.seat) }); break;
    case "remove-cpu": roomCommand("watten_remove_cpu", { seat: Number(control.dataset.seat) }); break;
    case "leave-waiting": roomCommand("leave_waiting_game"); break;
    case "copy-link": void copyLink(control); break;
    case "dismiss-hint": dismissLandscapeHint(); control.closest("[data-watten-landscape-hint]")?.remove(); break;
    case "engine": engineCommand(control.dataset.kind, control.dataset.value ?? null); break;
    case "feedback": engineCommand("partner_feedback", control.dataset.value, snapshot?.engine?.feedback_opportunity ?? 0); break;
    case "next-deal":
      if (snapshot?.engine) roomCommand("watten_next_deal", { deal_id: snapshot.engine.deal_id, opportunity: snapshot.engine.opportunity });
      break;
    case "resume": resume(); break;
    case "leave-match": openLeaveDialog(); break;
    case "leave-confirm": closeLeaveDialog(); roomCommand("watten_leave"); break;
    case "leave-cancel": closeLeaveDialog(); break;
    case "reconnect": void manualReconnect(); break;
    case "retry-assets": reloadFresh(); break;
    default: break;
  }
});

app.addEventListener("submit", event => {
  const form = event.target;
  if (form.matches("[data-watten-join]")) {
    event.preventDefault();
    if (session.joining) return;
    const password = form.elements.password?.value.trim() || null;
    session.joining = true;
    session.joinError = "";
    session.joinAttempts = 0;
    renderJoinPrompt();
    // The password travels only in this join body, never in a URL or storage.
    connect("join", password);
  } else if (form.matches("[data-watten-spectate]")) {
    event.preventDefault();
    const password = form.elements.password?.value.trim() || null;
    session.spectateError = "";
    session.spectatorPassword = password;
    connect("spectate", password);
  }
});

cleanups.add(() => { closeLeaveDialog(); motion.destroy(); });

if (page === "rules") {
  loadAuth().then(auth => {
    renderNav(auth);
    const access = auth.game_access || auth.user?.game_access;
    if (access?.watten_public === true || (auth.authenticated && access?.watten_preview === true)) {
      initializeAppMode({ mode: "watten" });
    }
  }).catch(() => renderNav(null));
} else if (page === "table" || page === "spectator") {
  initializeGameViewport();
  void mountTable();
} else {
  void mountLobby();
}
