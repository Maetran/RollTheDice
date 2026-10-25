import { loadAuth, escapeHtml as esc } from "./auth.js";
import { GAME_TOUR_MESSAGES } from "../i18n/catalog.js";
import { zdwaAppEntryUrl, zilchAppEntryUrl, hausdeppAppEntryUrl, wattenAppEntryUrl } from "../multigame/routes.js";

const games = { zdwa: "Zock die Wand an", zilch: "Zilch", hausdepp: "Hausdepp", watten: "Watten" };
// Add games only once their room integration and browser checks are ready.
const availableGames = ["zdwa", "zilch", "hausdepp", "watten"];
const guideRevisions = { hausdepp: 1, watten: 1 };
const key = "rollthedice.tours.v1";
const t = (id, params = {}) => String(GAME_TOUR_MESSAGES[window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de"][id] || id)
  .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
const defaults = () => ({ enabled: true, games: { zdwa: "unseen", zilch: "unseen", hausdepp: "unseen" } });
const read = (storage, name, fallback = null) => { try { return JSON.parse(storage.getItem(name)) ?? fallback; } catch { return fallback; } };
const write = (storage, name, value) => { try { storage.setItem(name, JSON.stringify(value)); } catch { /* The current page still works. */ } };
let identity, preferences, preferenceRequest;
let identityRevision = 0;
let mutations = Promise.resolve();
let viewerEpoch = 0, preferenceRevision = 0;
const settings = new Set();
const previews = new Map();
let currentTour;
let guidePreferences, guideRequest;

function viewerId(auth = identity) { return auth?.authenticated && auth?.user?.id ? `user.${auth.user.id}` : "guest"; }
function cacheKey(viewer = viewerId()) { return `${key}.${viewer}`; }
function sameViewer(epoch) { return epoch === viewerEpoch; }
function fetchForViewer(path, options = {}, epoch = viewerEpoch) {
  if (!sameViewer(epoch) || !identity?.authenticated) throw new Error("tour_viewer_changed");
  const headers = new Headers(options.headers || {});
  headers.set("X-Watten-Expected-Account-Id", String(identity.user.id));
  if (!["GET", "HEAD", "OPTIONS"].includes(String(options.method || "GET").toUpperCase())) {
    // Bind queued mutations to this identity. A cookie switch between request
    // dispatch and login notification must reject, never use a new account's CSRF.
    headers.set("X-CSRF-Token", identity.user.csrf_token || "");
  }
  return fetch(path, { ...options, headers, cache: "no-store" });
}

function adoptIdentity(next) {
  const changed = identity !== undefined && viewerId(identity) !== viewerId(next);
  identity = next;
  identityRevision++;
  for (const container of settings) {
    if (container.isConnected) syncTourSettingsGames(container);
    else settings.delete(container);
  }
  if (!changed) return;
  viewerEpoch++;
  preferences = undefined;
  preferenceRequest = undefined;
  guidePreferences = undefined;
  guideRequest = undefined;
  mutations = Promise.resolve();
  currentTour?.discard();
  // A manual request belongs to the person who made it, not the next login.
  for (const game of Object.keys(games)) write(sessionStorage, startKey(game), false);
  for (const container of settings) {
    if (container.isConnected) void refreshTourSettings(container);
    else settings.delete(container);
  }
}

window.addEventListener("zdwa:auth-state", event => adoptIdentity(event.detail));

function normalized(data) {
  const result = defaults();
  if (typeof data?.enabled === "boolean") result.enabled = data.enabled;
  for (const game of Object.keys(games)) {
    if (["unseen", "dismissed", "started", "completed"].includes(data?.games?.[game])) result.games[game] = data.games[game];
  }
  return result;
}

async function loadPreferences() {
  if (preferences) return preferences;
  if (preferenceRequest) return preferenceRequest;
  const request = (async () => {
    const beforeAuth = viewerEpoch;
    const beforeIdentity = identityRevision;
    const auth = await loadAuth();
    if (!sameViewer(beforeAuth)) throw new Error("tour_viewer_changed");
    // A newer auth event may already have changed this viewer's access flags.
    if (identityRevision === beforeIdentity) adoptIdentity(auth);
    const epoch = viewerEpoch, viewer = viewerId(), storageKey = cacheKey(viewer);
    const local = read(localStorage, storageKey);
    if (!identity.authenticated) return preferences = normalized(local);
    const response = await fetchForViewer("/api/auth/tours", {}, epoch);
    if (!response.ok) throw new Error("tour_preferences_unavailable");
    const data = await response.json();
    if (!sameViewer(epoch)) throw new Error("tour_viewer_changed");
    preferences = normalized(data);
    // A locally closed tour stays closed if its last save was interrupted.
    // Guest choices are imported once for this account, not on every login.
    const importKey = `${storageKey}.guest-imported`;
    const guest = read(localStorage, importKey, false) ? null : read(localStorage, `${key}.guest`);
    const pending = read(localStorage, `${storageKey}.pending`, {});
    for (const source of [guest, local]) {
      for (const game of Object.keys(games)) {
        const state = source?.games?.[game];
        if (preferences.games[game] === "unseen" && ["dismissed", "started", "completed"].includes(state)) {
          void savePreferences({ game_type: game, state });
        }
      }
    }
    if (guest?.enabled === false && preferences.enabled) void savePreferences({ enabled: false });
    write(localStorage, importKey, true);
    if (typeof pending.enabled === "boolean") void savePreferences({ enabled: pending.enabled });
    for (const game of Object.keys(games)) {
      if (["dismissed", "started", "completed"].includes(pending.games?.[game])) {
        void savePreferences({ game_type: game, state: pending.games[game] });
      }
    }
    write(localStorage, storageKey, preferences);
    return preferences;
  })();
  preferenceRequest = request;
  try { return await request; }
  finally { if (preferenceRequest === request) preferenceRequest = undefined; }
}

function savePreferences(patch) {
  const epoch = viewerEpoch, storageKey = cacheKey();
  preferenceRevision++;
  if (preferences) {
    if (typeof patch.enabled === "boolean") preferences.enabled = patch.enabled;
    if (patch.game_type) preferences.games[patch.game_type] = patch.state;
    write(localStorage, storageKey, preferences);
  }
  if (!identity?.authenticated) return Promise.resolve(true);
  const pendingKey = `${storageKey}.pending`;
  const pending = read(localStorage, pendingKey, {});
  if (typeof patch.enabled === "boolean") pending.enabled = patch.enabled;
  if (patch.game_type) pending.games = { ...pending.games, [patch.game_type]: patch.state };
  write(localStorage, pendingKey, pending);
  mutations = mutations.catch(() => {}).then(async () => {
    if (!sameViewer(epoch)) return false;
    const response = await fetchForViewer("/api/auth/tours", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    }, epoch);
    if (!sameViewer(epoch) || !response.ok) return false;
    const remaining = read(localStorage, pendingKey, {});
    if (typeof patch.enabled === "boolean" && remaining.enabled === patch.enabled) delete remaining.enabled;
    if (patch.game_type && remaining.games?.[patch.game_type] === patch.state) delete remaining.games[patch.game_type];
    write(localStorage, pendingKey, remaining);
    return true;
  }).catch(() => false);
  return mutations;
}

function tourGameAvailable(game) {
  return game !== "watten" || document.documentElement.dataset.game === "watten"
    || identity?.game_access?.watten_public || identity?.game_access?.watten_preview;
}

function syncTourSettingsGames(container) {
  const list = container.querySelector("[data-tour-settings-games]");
  if (!list) return;
  for (const game of availableGames) {
    const existing = list.querySelector(`[data-tour-settings-game="${game}"]`);
    if (!tourGameAvailable(game)) { existing?.remove(); continue; }
    if (existing) continue;
    const row = document.createElement("div");
    row.dataset.tourSettingsGame = game;
    row.innerHTML = `<strong>${esc(games[game])}</strong><div><button type="button" data-tour-action="start" data-tour-game="${game}">${esc(t("start"))}</button><button type="button" data-tour-action="view" data-tour-game="${game}">${esc(t("view"))}</button></div>`;
    list.append(row);
  }
}

async function refreshTourSettings(container) {
  syncTourSettingsGames(container);
  const epoch = viewerEpoch;
  const toggle = container.querySelector("[data-tour-enabled]");
  const status = container.querySelector("[data-tour-settings-status]");
  if (!toggle || !status) return;
  toggle.disabled = true;
  status.textContent = "";
  try {
    const data = await loadPreferences();
    if (!sameViewer(epoch) || !container.isConnected) return;
    syncTourSettingsGames(container);
    toggle.checked = data.enabled;
    toggle.disabled = false;
  } catch {
    if (sameViewer(epoch) && container.isConnected) status.textContent = t("loadFailed");
  }
}

function guideCacheKey() { return `${cacheKey()}.guides`; }

async function loadGuidePreferences() {
  if (guidePreferences) return guidePreferences;
  if (guideRequest) return guideRequest;
  const request = (async () => {
    await loadPreferences();
    const epoch = viewerEpoch;
    const local = read(localStorage, guideCacheKey(), {});
    if (!identity?.authenticated) return guidePreferences = { enabled: preferences.enabled, acknowledged: local };
    const response = await fetchForViewer("/api/auth/game-guides", {}, epoch);
    if (!response.ok) throw new Error("guide_preferences_unavailable");
    const data = await response.json();
    if (!sameViewer(epoch)) throw new Error("tour_viewer_changed");
    guidePreferences = { enabled: data.enabled !== false, acknowledged: { ...data.acknowledged } };
    for (const game of Object.keys(guideRevisions)) {
      if (local[game] === guideRevisions[game] && (guidePreferences.acknowledged[game] || 0) < local[game]) {
        void acknowledgeGuide(game);
      }
    }
    return guidePreferences;
  })();
  guideRequest = request;
  try { return await request; }
  finally { if (guideRequest === request) guideRequest = undefined; }
}

async function acknowledgeGuide(game) {
  const epoch = viewerEpoch;
  const storageKey = guideCacheKey();
  const acknowledged = { ...read(localStorage, storageKey, {}), [game]: guideRevisions[game] };
  if (guidePreferences) guidePreferences.acknowledged[game] = guideRevisions[game];
  write(localStorage, storageKey, acknowledged);
  if (!identity?.authenticated) return;
  try {
    const response = await fetchForViewer("/api/auth/game-guides", { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game_type: game }) }, epoch);
    if (!response.ok) throw new Error("guide_acknowledgement_unavailable");
  } catch { /* Retry the same viewer's explicit acknowledgement on the next visit. */ }
}

function startKey(game) { return `${key}.start.${game}`; }

function captureEntry() {
  const game = document.documentElement.dataset.game;
  const url = new URL(location.href);
  if (!availableGames.includes(game) || url.searchParams.get("tour") !== game) return;
  write(sessionStorage, startKey(game), true);
  url.searchParams.delete("tour");
  history.replaceState(null, "", url);
  if (!/\/spiel\//.test(location.pathname)) {
    const notice = document.createElement("aside");
    notice.className = "game-tour-entry";
    notice.setAttribute("role", "status");
    notice.innerHTML = `<p>${esc(t("entry"))}</p><button type="button" data-tour-cancel-entry>${esc(t("end"))}</button>`;
    notice.querySelector("button").onclick = () => { write(sessionStorage, startKey(game), false); notice.remove(); };
    document.body.append(notice);
  }
}

function destination(game) {
  const entry = game === "zdwa" ? zdwaAppEntryUrl() : game === "zilch" ? zilchAppEntryUrl()
    : game === "watten" ? wattenAppEntryUrl(window.location, globalThis, { publicBeta: true }) : hausdeppAppEntryUrl();
  const url = new URL(entry, location.href);
  url.searchParams.set("tour", game);
  return url.href;
}

function stepsFor(game, context = {}) {
  if (game === "zdwa") {
    const list = [
      { id: "welcome", title: "zdwaWelcome", body: context.team ? "zdwaTeam" : "zdwaGoal", target: ".player-card.me, #scoreOut" },
      ...(!context.hardcore ? [
        { id: "hold", title: "holdTitle", body: "holdBody", target: "#diceBar", ready: c => c.rolls > 0, waiting: "firstRoll" },
        { id: "roll", title: "rollTitle", body: context.solo ? "soloRollBody" : "rollBody", target: "#rollBtnInline" },
      ] : [{ id: "hardcore", title: "hardcoreTitle", body: "hardcoreBody", target: "#diceBar" }]),
      { id: "write", title: "writeTitle", body: "writeBody", target: ".player-card.me td.cell.clickable, .player-card.me .table-wrap, #scoreOut", ready: c => c.rolls > 0, waiting: "firstRoll" },
      ...(!context.hardcore && context.announcePossible !== false ? [{ id: "announce", title: "announceTitle", body: "announceBody", target: "#announceBtnInline", ready: c => c.rolls === 1 && c.canAnnounce !== false, waiting: "firstRollAgain" }] : []),
      { id: "finish", title: "finishTitle", body: "finishBody", target: "#roomHeaderMenuToggle" },
    ];
    return list;
  }
  if (game === "zilch") return [
    { id: "welcome", title: "zilchWelcome", body: "zilchGoal", target: ".zilch-play-layout__notebook" },
    { id: "roll", title: "zilchRoll", body: "zilchRollBody", target: "[data-zilch-roll], [data-zilch-start-roll]" },
    { id: "select", title: "zilchSelect", body: "zilchSelectBody", target: ".zilch-recommendations__rail, .zilch-dice-dock", ready: c => c.canSelect, waiting: "firstRoll" },
    { id: "risk", title: "zilchRisk", body: "zilchRiskBody", target: "[data-zilch-roll]" },
    { id: "bank", title: "zilchBank", body: "zilchBankBody", target: "[data-zilch-bank]" },
    { id: "finish", title: "finishTitle", body: "finishBody", target: "a[href*='regeln'], .zilch-dice-dock" },
  ];
  if (game === "hausdepp") return [
    { id: "welcome", title: "hausdeppWelcome", body: "hausdeppGoal", target: "#hausdeppHand" },
    { id: "play", title: "hausdeppPlay", body: "hausdeppPlayBody", target: "#hausdeppHand", ready: c => c.canPlay },
    { id: "multiple", title: "hausdeppMultiple", body: "hausdeppMultipleBody", target: "#hausdeppHand" },
    { id: "stock", title: "hausdeppStock", body: "hausdeppStockBody", target: "#hausdeppStock", ready: c => c.canDraw },
    { id: "pile", title: "hausdeppPile", body: "hausdeppPileBody", target: "#hausdeppPile", ready: c => c.canPickup },
    { id: "inspect", title: "hausdeppInspect", body: "hausdeppInspectBody", target: "#hausdeppPile" },
    { id: "special", title: "hausdeppSpecial", body: "hausdeppSpecialBody", target: "#hausdeppPile" },
    { id: "finish", title: "finishTitle", body: "guideFinishBody", target: ".hd-social-rules, #hausdeppStatus" },
  ];
  if (game === "watten") return [
    { id: "welcome", title: "wattenWelcome", body: "wattenGoal", target: "[data-wt-hand], .wt-table" },
    { id: "calls", title: "wattenCalls", body: "wattenCallsBody", target: "[data-wt-panel], [data-wt-hand]" },
    { id: "play", title: "wattenPlay", body: "wattenPlayBody", target: "[data-wt-hand]" },
    { id: "bid", title: "wattenBid", body: "wattenBidBody", target: "[data-wt-panel], [data-wt-hand]" },
    { id: "partner", title: "wattenPartner", body: "wattenPartnerBody", target: "[data-wt-panel], [data-wt-hand]" },
    { id: "history", title: "wattenHistory", body: "wattenHistoryBody", target: "[data-wt-history-toggle], [data-wt-hand]" },
    { id: "finish", title: "finishTitle", body: "guideFinishBody", target: ".wt-header, [data-wt-hand]" },
  ];
  return [];
}

function exampleFor(game) {
  return ["hausdepp", "watten"].includes(game) ? "7 · 9 · K · A · 10" : game === "zilch" ? "⚀ ⚀ ⚄ ⚂ ⚃ ⚅" : "⚂ ⚂ ⚄ ⚀ ⚅";
}

function onScreen(node) {
  // A sheet scrolled sideways out of the grid (a swipe or a player tile) keeps
  // its client rects, so check the box against the viewport as well.
  const rect = node.getBoundingClientRect();
  return node.getClientRects().length && rect.right > 0 && rect.left < innerWidth
    && getComputedStyle(node).visibility !== "hidden";
}

function findTarget(selectors) {
  // These are ordered fallbacks, not one CSS selector list: querySelector on
  // the joined list would select an ancestor before the intended score cell.
  for (const selector of selectors.split(",")) {
    const target = [...document.querySelectorAll(selector.trim())].find(onScreen);
    if (target) return target;
  }
  return null;
}

export function createGameTour(game) {
  const guide = Boolean(guideRevisions[game]);
  let guideDeferredEpoch = -1;
  let context = {}, mode = "", index = 0, card, highlighted, lastMarkup = "", offerInFlight = false;
  let lastFocus;
  const controller = { update, end: () => end(false), discard: () => end(false, false) };

  function clearTarget() { highlighted?.classList.remove("game-tour-target"); highlighted = null; }
  function end(completed, persist = true) {
    const wasView = mode === "view";
    const hadMode = Boolean(mode);
    clearTarget();
    card?.remove(); card = null; mode = ""; lastMarkup = "";
    if (currentTour === controller) currentTour = null;
    if (guide && !wasView && hadMode) {
      if (persist) guideDeferredEpoch = viewerEpoch;
      write(sessionStorage, startKey(game), false);
      if (persist && completed) void acknowledgeGuide(game);
    } else if (persist && !wasView && hadMode) {
      write(sessionStorage, startKey(game), false);
      void savePreferences({ game_type: game, state: completed ? "completed" : "dismissed" });
    }
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }
  function begin(view = false) {
    if (currentTour && currentTour !== controller) {
      if (view) currentTour.discard();
      else currentTour.end();
    }
    currentTour = controller;
    lastFocus = document.activeElement;
    mode = view ? "view" : "active"; index = 0;
    if (!view && !guide) void savePreferences({ game_type: game, state: "started" });
    render();
    card?.querySelector("[data-tour-end]")?.focus({ preventScroll: true });
  }
  function position(target) {
    if (!card) return;
    const margin = 12;
    const height = card.offsetHeight, width = card.offsetWidth;
    const top = Math.min(Math.max(margin, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-header-height")) || 72), Math.max(margin, innerHeight - height - margin));
    const rect = target?.getBoundingClientRect();
    const reserved = [...document.querySelectorAll("#diceBar, .zilch-dice-dock, .zilch-chat, .hd-centre, #hausdeppHand, [data-wt-hand], [data-wt-panel]")]
      .filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect());
    const candidates = [
      [Math.max(margin, innerWidth - width - margin), top], [margin, top],
      [Math.max(margin, innerWidth - width - margin), Math.max(top, innerHeight - height - margin)],
      [margin, Math.max(top, innerHeight - height - margin)],
    ];
    // A phone often has usable space between the score field and the dice.
    // Consider that gap too, instead of covering either the target or controls.
    const clampY = value => Math.max(top, Math.min(value, innerHeight - height - margin));
    for (const box of [rect, ...reserved].filter(Boolean)) {
      candidates.push([Math.max(margin, innerWidth - width - margin), clampY(box.bottom + margin)],
        [Math.max(margin, innerWidth - width - margin), clampY(box.top - height - margin)]);
    }
    const area = ([left, y], box) => box ? Math.max(0, Math.min(left + width, box.right) - Math.max(left, box.left)) * Math.max(0, Math.min(y + height, box.bottom) - Math.max(y, box.top)) : 0;
    const overlap = point => area(point, rect) + reserved.reduce((sum, box) => sum + 4 * area(point, box), 0);
    const best = candidates.reduce((best, next) => overlap(next) < overlap(best) ? next : best);
    card.style.left = `${best[0]}px`; card.style.top = `${best[1]}px`;
  }
  function render() {
    clearTarget();
    if (!mode) return;
    if (!card) {
      card = document.createElement("aside"); card.className = "game-tour"; card.dataset.gameTour = game;
      card.setAttribute("role", "region"); card.setAttribute("aria-label", t("title"));
      card.setAttribute("aria-live", "polite");
      document.body.append(card);
      card.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button || button.disabled) return;
        if (button.matches("[data-tour-end], [data-tour-close], [data-tour-dismiss]")) end(false);
        else if (button.matches("[data-tour-start]")) begin();
        else if (button.matches("[data-tour-next]")) {
          if (index >= stepsFor(game, context).length - 1) end(mode !== "view");
          else { index++; render(); }
        } else if (button.matches("[data-tour-back]")) { index = Math.max(0, index - 1); render(); }
      });
    }
    const steps = stepsFor(game, context), step = steps[Math.min(index, steps.length - 1)];
    if (!step) { end(false); return; }
    const target = mode === "view" || mode === "offer" ? null : findTarget(step.target);
    const missingTarget = mode !== "view" && mode !== "offer" && (!target || !target.getClientRects().length);
    const paused = !guide && mode !== "view" && (!context.canAct || context.busy || missingTarget || (step.ready && !step.ready(context)));
    if (mode !== "view" && !paused && mode !== "offer") {
      if (target && target.getClientRects().length) { highlighted = target; target.classList.add("game-tour-target"); }
    }
    card.dataset.tourMode = mode === "offer" ? "offer" : paused ? "paused" : mode;
    card.dataset.tourStep = mode === "offer" ? "offer" : step.id;
    const body = mode === "offer" ? `<h2>${esc(t("offer", { game: games[game] }))}</h2><p>${esc(t("offerBody"))}</p><div class="game-tour-actions"><button type="button" data-tour-start>${esc(t("start"))}</button><button type="button" data-tour-dismiss>${esc(t("without"))}</button></div>`
      : `<p class="game-tour-progress">${esc(games[game])} · ${esc(t("progress", { current: index + 1, total: steps.length }))}${mode === "view" ? ` · ${esc(t("example"))}` : ""}</p><h2>${esc(t(step.title))}</h2><p aria-live="polite">${esc(t(paused ? !context.canAct ? "waitTurn" : context.busy ? "waitMotion" : step.waiting || "waitTarget" : step.body))}</p>${mode === "view" ? `<div class="game-tour-example"><span>${esc(t("example"))}</span><strong>${exampleFor(game)}</strong></div>` : ""}<div class="game-tour-actions"><button type="button" data-tour-back ${index === 0 ? "disabled" : ""}>${esc(t("back"))}</button><button type="button" data-tour-next ${paused ? "disabled" : ""}>${esc(t(index === steps.length - 1 ? guide ? "understood" : "done" : "next"))}</button><button type="button" data-tour-end>${esc(t(guide ? "later" : "end"))}</button></div>`;
    const markup = `<button type="button" class="game-tour-close" data-tour-close aria-label="${esc(t(guide ? "later" : "end"))}">×</button>${body}`;
    if (markup !== lastMarkup) {
      const focused = card.contains(document.activeElement) ? document.activeElement?.getAttributeNames().find(name => name.startsWith("data-tour-")) : null;
      card.innerHTML = markup; lastMarkup = markup;
      if (focused) card.querySelector(`[${focused}]`)?.focus({ preventScroll: true });
    }
    position(highlighted);
  }
  async function maybeOffer() {
    if (guide) { await maybeGuide(); return; }
    if (offerInFlight || mode || !context.eligible || !context.canAct || context.busy
      || (currentTour && currentTour !== controller)) return;
    offerInFlight = true;
    const epoch = viewerEpoch;
    try {
      const data = await loadPreferences();
      if (!sameViewer(epoch) || !context.eligible || !context.canAct || context.busy || mode
        || (currentTour && currentTour !== controller)) return;
      if (read(sessionStorage, startKey(game), false)) {
        write(sessionStorage, startKey(game), false); begin(); return;
      }
      if (!data.enabled || data.games[game] !== "unseen") return;
      let show = false;
      if (identity.authenticated) {
        const revision = preferenceRevision;
        const response = await fetchForViewer("/api/auth/tours/offer", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game_type: game }),
        }, epoch);
        if (!response.ok) return;
        const claimed = await response.json();
        if (!sameViewer(epoch) || revision !== preferenceRevision) return;
        show = claimed.show === true;
        preferences = normalized(claimed);
      } else {
        // Check storage again: another tab may have made the choice meanwhile.
        preferences = normalized(read(localStorage, cacheKey(), data));
        show = preferences.enabled && preferences.games[game] === "unseen";
        if (show) preferences.games[game] = "dismissed";
      }
      write(localStorage, cacheKey(), preferences);
      if (show && !mode && context.eligible && context.canAct && !context.busy
        && (!currentTour || currentTour === controller)) { mode = "offer"; currentTour = controller; render(); }
    } catch { /* An unavailable account service never blocks playing or forces a tour. */ }
    finally { offerInFlight = false; }
  }
  async function maybeGuide() {
    if (offerInFlight || mode || !context.eligible || context.busy
      || (currentTour && currentTour !== controller)) return;
    offerInFlight = true;
    const epoch = viewerEpoch;
    try {
      const data = await loadGuidePreferences();
      if (!sameViewer(epoch) || !context.eligible || context.busy || mode
        || (currentTour && currentTour !== controller)) return;
      if (read(sessionStorage, startKey(game), false)) {
        write(sessionStorage, startKey(game), false); begin(); return;
      }
      if (guideDeferredEpoch === viewerEpoch || !data.enabled || preferences?.enabled === false
        || (data.acknowledged[game] || 0) >= guideRevisions[game]) return;
      begin();
    } catch { /* Reading a guide never delays or blocks a running game. */ }
    finally { offerInFlight = false; }
  }
  function update(next) {
    context = next;
    if (!next.eligible && mode) { end(false); return; }
    if (mode) render();
    else void maybeOffer();
  }
  controller.view = () => { context = {}; begin(true); };
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && mode) { event.stopImmediatePropagation(); end(false); }
    else if (mode && event.target instanceof Element && event.target.closest("[data-game-tour]")) {
      // Native button activation remains available; game hotkeys must not
      // treat Space or a letter typed inside the tour as a live game action.
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("resize", () => { if (mode) render(); });
  // Capture also catches the score grid's sideways scroll, so a target that
  // left the screen pauses the step instead of keeping an invisible highlight.
  let scrollFrame = 0;
  document.addEventListener("scroll", () => {
    if (!mode || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; if (mode) render(); });
  }, { passive: true, capture: true });
  return controller;
}

export async function mountTourSettings(container) {
  if (!container) return;
  if (settings.has(container)) return refreshTourSettings(container);
  settings.add(container);
  container.innerHTML = `<h3>${esc(t("title"))}</h3><p>${esc(t("settingsBody"))}</p><p data-tour-settings-status role="status"></p><label class="game-tour-toggle"><input type="checkbox" data-tour-enabled checked> ${esc(t("auto"))}</label><div class="game-tour-settings-games" data-tour-settings-games></div>`;
  syncTourSettingsGames(container);
  const toggle = container.querySelector("[data-tour-enabled]");
  // Visible guide actions must already work while the initial account read is
  // pending. Only the preference toggle depends on that read and stays disabled.
  toggle.onchange = async () => {
    if (toggle.disabled) return;
    const epoch = viewerEpoch, enabled = toggle.checked;
    if (guidePreferences) guidePreferences.enabled = enabled;
    if (!enabled) currentTour?.end();
    const saved = await savePreferences({ enabled });
    if (!sameViewer(epoch) || !container.isConnected) return;
    container.querySelector("[role='status']").textContent = t(saved ? "saved" : "saveFailed");
  };
  container.addEventListener("click", event => {
    const button = event.target.closest("[data-tour-action]");
    if (!button) return;
    const game = button.dataset.tourGame;
    if (!availableGames.includes(game) || !tourGameAvailable(game)) return;
    if (button.dataset.tourAction === "view") {
      if (!previews.has(game)) previews.set(game, createGameTour(game));
      previews.get(game).view();
    }
    else location.assign(destination(game));
  });
  await refreshTourSettings(container);
}

captureEntry();
