import { GAME_PICKER_MESSAGES } from "../i18n/catalog.js";

const MENU_ID = "suiteGameMenu";
const mobileQuery = "(max-width: 600px)";
const ACTIVITY_REFRESH_MS = 15_000;
const ACTIVITY_TIMEOUT_MS = 8_000;
let closeActivePicker = null;
const language = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
const message = (key, values = {}) => String(GAME_PICKER_MESSAGES[language()][key] || key)
  .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
const escapeMarkup = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const publicWatten = game => game.id === "watten" && game.publicBeta === true;
const beta = game => game.beta === true || (game.beta === undefined && publicWatten(game));
const gameName = game => `${game.name}${beta(game) ? " [BETA]" : ""}`;
const betaBadge = game => beta(game) ? ' <small class="suite-game-beta">[BETA]</small>' : "";
const description = game => game.description || message(game.id === "watten"
  ? !publicWatten(game) ? "wattenPrivateDescription" : !beta(game) ? "wattenReleasedDescription" : "wattenDescription"
  : `${game.id}Description`);

/** Small authored marks remain legible beside each game's full name. */
export function gameIcon(id) {
  const shapes = {
    zdwa: '<rect x="4" y="3" width="16" height="19" rx="2"/><path d="M4 9h16M10 9v13M10 15h10"/><circle cx="8" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="16" cy="6" r=".8" fill="currentColor" stroke="none"/>',
    zilch: '<rect x="3" y="3" width="14" height="14" rx="3"/><path d="M17 8h1a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3v-1"/><circle cx="7" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="7" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
    hausdepp: '<path d="m6 17-3-1.1a1.5 1.5 0 0 1-.9-1.9l3.4-10a1.5 1.5 0 0 1 1.9-.9L12 4.7"/><rect x="8" y="4" width="12" height="17" rx="2"/><path d="M14 16s-3.5-2.2-3.5-4.3a1.9 1.9 0 0 1 3.5-.8 1.9 1.9 0 0 1 3.5.8C17.5 13.8 14 16 14 16Z" fill="currentColor" stroke="none"/>',
    watten: '<path d="m6 18-2.8-1a1.5 1.5 0 0 1-.9-1.9L5.5 5a1.5 1.5 0 0 1 1.9-.9L11 5.3"/><rect x="8" y="3" width="13" height="18" rx="2"/><path d="m14.5 8 3 4-3 4-3-4Z" fill="currentColor" stroke="none"/>',
  };
  return iconSvg(shapes[id] || shapes.zdwa);
}

const iconSvg = shapes => `<svg class="suite-game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes}</svg>`;

/** Management tools share the same drawing style, but are not games. */
function utilityIcon(id) {
  return iconSvg(id === "dashboard"
    ? '<path d="M4 4v16h16"/><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6"/>'
    : '<path d="M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6Z"/><path d="m9 12 2 2 4-4"/>');
}

const UTILITY_IDS = ["admin", "dashboard"];
const utilityName = utility => utility.name || message(utility.id === "dashboard" ? "utilityDashboardName" : "utilityAdminName");
const utilityDescription = utility => utility.description
  || message(utility.id === "dashboard" ? "utilityDashboardDescription" : "utilityAdminDescription");

/** Keep only known, unique management entries with a link target. */
function normalizeUtilities(utilities) {
  const seen = new Set();
  const result = [];
  for (const utility of Array.isArray(utilities) ? utilities : []) {
    if (!UTILITY_IDS.includes(utility?.id) || seen.has(utility.id)
      || typeof utility.href !== "string" || !utility.href) continue;
    seen.add(utility.id);
    result.push({ id: utility.id, href: utility.href, name: utility.name, description: utility.description });
  }
  return result;
}

export function gamePickerButtonMarkup(game) {
  const icon = gameIcon(game.id).replace('class="suite-game-icon"', 'class="suite-game-icon game-switch-icon"');
  return `${icon}<span class="suite-game-trigger__name" translate="no">${escapeMarkup(game.name)}${betaBadge(game)}</span><svg class="suite-game-trigger__chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="m3 4.5 3 3 3-3"/></svg>`;
}

/**
 * A disclosure of native game links. Access and route ownership stay with the
 * caller; this component never grants a game or intercepts native navigation.
 * onSelect receives (id, game, event), including modified link clicks.
 * Optional `utilities` ({ id: "admin" | "dashboard", href }) form a separate
 * management group of native links; onUtilitySelect receives (id, utility, event).
 * Like games, they are only links: the destination's backend owns access.
 */
export function createGamePicker({ button, currentMode, games = [], utilities: initialUtilities = [], onSelect, onUtilitySelect } = {}) {
  if (!(button instanceof HTMLElement)) throw new TypeError("A game picker needs a trigger button");
  let current = currentMode;
  let available = games;
  let utilities = normalizeUtilities(initialUtilities);
  let panel = null;
  let backdrop = null;
  let modal = false;
  let inertElements = [];
  let previousOverflow = "";
  let destroyed = false;
  let activityTimer = null;
  let activityRequest = null;
  let activityRevision = 0;

  function setActivity(state, counts = {}) {
    if (!panel) return;
    for (const entry of panel.querySelectorAll("[data-game-entry]")) {
      const count = counts[entry.dataset.gameEntry]?.players;
      const valid = state === "ready" && Number.isSafeInteger(count) && count >= 0;
      const label = entry.querySelector("[data-game-activity]");
      label.dataset.state = valid ? "ready" : state === "loading" ? "loading" : "unavailable";
      label.textContent = valid ? message(count === 1 ? "activityOne" : "activityMany", { count })
        : message(state === "loading" ? "activityLoading" : "activityUnavailable");
    }
    positionPanel();
  }

  function stopActivity() {
    activityRevision += 1;
    window.clearTimeout(activityTimer);
    activityTimer = null;
    activityRequest?.abort();
    activityRequest = null;
  }

  async function refreshActivity() {
    if (!panel || document.visibilityState === "hidden") return;
    stopActivity();
    const revision = activityRevision;
    const controller = new AbortController();
    activityRequest = controller;
    const timeout = window.setTimeout(() => controller.abort(), ACTIVITY_TIMEOUT_MS);
    try {
      const response = await fetch("/api/game-activity", {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Activity unavailable");
      const payload = await response.json();
      if (!payload?.games || typeof payload.games !== "object" || Array.isArray(payload.games)) {
        throw new Error("Invalid activity projection");
      }
      if (panel && revision === activityRevision) setActivity("ready", payload.games);
    } catch (_) {
      if (panel && revision === activityRevision) setActivity("unavailable");
    } finally {
      window.clearTimeout(timeout);
      if (panel && revision === activityRevision) {
        activityRequest = null;
        activityTimer = window.setTimeout(() => { void refreshActivity(); }, ACTIVITY_REFRESH_MS);
      }
    }
  }

  function visibilityChanged() {
    if (document.visibilityState === "hidden") {
      stopActivity();
      setActivity("loading");
    } else void refreshActivity();
  }

  function updateTrigger() {
    const active = available.find(game => game.id === current) || available[0];
    if (!active) return;
    button.dataset.gamePicker = active.id;
    button.innerHTML = gamePickerButtonMarkup(active);
    button.setAttribute("aria-label", message("trigger", { game: gameName(active) }));
    button.setAttribute("title", `${message("title")} (Alt+Shift+Z)`);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", MENU_ID);
    button.setAttribute("aria-expanded", String(Boolean(panel)));
  }

  function setModal(nextModal) {
    if (nextModal === modal) return;
    modal = nextModal;
    if (modal) {
      panel?.setAttribute("aria-modal", "true");
      backdrop.hidden = false;
      // Preserve any existing modal's ownership when the picker is dismissed.
      inertElements = [...document.body.children]
        .filter(element => element !== panel && element !== backdrop)
        .map(element => ({ element, inert: element.inert }));
      for (const { element } of inertElements) element.inert = true;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    } else {
      panel?.removeAttribute("aria-modal");
      if (backdrop) backdrop.hidden = true;
      for (const { element, inert } of inertElements) element.inert = inert;
      inertElements = [];
      document.body.style.overflow = previousOverflow;
    }
  }

  function positionPanel() {
    if (!panel) return;
    const compact = window.matchMedia(mobileQuery).matches;
    setModal(compact);
    if (compact) {
      panel.style.removeProperty("top");
      panel.style.removeProperty("left");
      return;
    }
    const trigger = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const gutter = 12;
    const left = Math.max(gutter, Math.min(trigger.right - bounds.width, window.innerWidth - bounds.width - gutter));
    const below = trigger.bottom + 10;
    const above = trigger.top - bounds.height - 10;
    const top = below + bounds.height <= window.innerHeight - gutter
      ? below : Math.max(gutter, above >= gutter ? above : window.innerHeight - bounds.height - gutter);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function close({ restoreFocus = false } = {}) {
    if (!panel) return;
    stopActivity();
    setModal(false);
    panel.remove();
    backdrop?.remove();
    panel = null;
    backdrop = null;
    if (closeActivePicker === close) closeActivePicker = null;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outsidePointer);
    document.removeEventListener("keydown", keydown);
    document.removeEventListener("focusin", focusChanged);
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("resize", positionPanel);
    window.removeEventListener("scroll", positionPanel, true);
    if (restoreFocus && button.isConnected && !button.hidden && !button.disabled) button.focus();
  }

  function outsidePointer(event) {
    if (panel && !panel.contains(event.target) && !button.contains(event.target)) close({ restoreFocus: modal });
  }

  function focusChanged(event) {
    if (!panel || panel.contains(event.target) || button.contains(event.target)) return;
    if (modal) (panel.querySelector('a[aria-current="page"]') || panel.querySelector("a, button"))?.focus();
    else close();
  }

  function keydown(event) {
    if (!panel) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close({ restoreFocus: true });
      return;
    }
    // Games come first in the document, followed by the management group.
    const links = [...panel.querySelectorAll("a[data-game-entry], a[data-suite-utility-entry]")];
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const index = links.indexOf(document.activeElement);
      const target = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1
        : event.key === "ArrowDown" ? (index + 1) % links.length : (index - 1 + links.length) % links.length;
      event.preventDefault();
      links[target]?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...panel.querySelectorAll("button, a[href]")];
    const first = controls[0];
    const last = controls.at(-1);
    if (modal && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (!modal && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
      // Returning to the trigger preserves a useful tab sequence, even though
      // the temporary panel is mounted after the page's regular content.
      event.preventDefault();
      close({ restoreFocus: true });
    }
  }

  function appendOption(list, game) {
    const link = document.createElement("a");
    const descriptionId = `${MENU_ID}-${game.id}-description`;
    const activityId = `${MENU_ID}-${game.id}-activity`;
    link.className = "suite-game-option";
    link.href = game.href;
    link.dataset.gameEntry = game.id;
    link.setAttribute("aria-label", gameName(game));
    link.setAttribute("aria-describedby", `${descriptionId} ${activityId}`);
    if (game.id === current) link.setAttribute("aria-current", "page");
    const status = game.id === current
      ? `<span class="suite-game-option__current">${escapeMarkup(message("current"))}</span>`
      : '<svg class="suite-game-option__arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg>';
    link.innerHTML = `<span class="suite-game-option__icon" data-game-icon="${escapeMarkup(game.id)}">${gameIcon(game.id)}</span><span class="suite-game-option__copy"><span class="suite-game-option__name" translate="no">${escapeMarkup(game.name)}${betaBadge(game)}</span><span class="suite-game-option__description" id="${escapeMarkup(descriptionId)}">${escapeMarkup(description(game))}</span><span class="suite-game-option__activity" id="${escapeMarkup(activityId)}" data-game-activity data-state="loading">${escapeMarkup(message("activityLoading"))}</span></span>${status}`;
    link.addEventListener("click", event => {
      onSelect?.(game.id, game, event);
      close();
    });
    list.append(link);
  }

  function utilityList() {
    let group = panel.querySelector("[data-suite-utilities]");
    if (!group) {
      group = document.createElement("div");
      group.className = "suite-game-menu__utilities";
      group.dataset.suiteUtilities = "";
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", `${MENU_ID}-utilities-title`);
      group.innerHTML = `<h3 class="suite-game-menu__group-title" id="${MENU_ID}-utilities-title">${escapeMarkup(message("utilitiesTitle"))}</h3><div class="suite-game-menu__utility-list"></div>`;
      panel.append(group);
    }
    return group.querySelector(".suite-game-menu__utility-list");
  }

  function appendUtility(utility) {
    const link = document.createElement("a");
    const descriptionId = `${MENU_ID}-${utility.id}-utility-description`;
    link.className = "suite-utility-option";
    link.href = utility.href;
    link.dataset.suiteUtilityEntry = utility.id;
    link.setAttribute("aria-label", utilityName(utility));
    link.setAttribute("aria-describedby", descriptionId);
    link.innerHTML = `<span class="suite-utility-option__icon">${utilityIcon(utility.id)}</span><span class="suite-utility-option__copy"><span class="suite-utility-option__name">${escapeMarkup(utilityName(utility))}</span><span class="suite-utility-option__description" id="${escapeMarkup(descriptionId)}">${escapeMarkup(utilityDescription(utility))}</span></span><svg class="suite-utility-option__arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg>`;
    link.addEventListener("click", event => {
      onUtilitySelect?.(utility.id, utility, event);
      close();
    });
    utilityList().append(link);
  }

  function open() {
    if (destroyed || panel || button.disabled || button.hidden || !available.length) return;
    closeActivePicker?.();
    closeActivePicker = close;
    backdrop = document.createElement("div");
    backdrop.className = "suite-game-backdrop";
    backdrop.dataset.gamePickerBackdrop = "";
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    panel = document.createElement("nav");
    panel.id = MENU_ID;
    panel.className = "suite-game-menu";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", message("title"));
    panel.innerHTML = `<div class="suite-game-menu__header"><div><h2 class="suite-game-menu__title">${escapeMarkup(message("title"))}</h2><p class="suite-game-menu__intro">${escapeMarkup(message("intro"))}</p></div><button type="button" class="suite-game-menu__close" data-game-picker-close aria-label="${escapeMarkup(message("close"))}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div><div class="suite-game-menu__games"></div>`;
    panel.querySelector("[data-game-picker-close]").addEventListener("click", () => close({ restoreFocus: true }));
    const list = panel.querySelector(".suite-game-menu__games");
    for (const game of available) appendOption(list, game);
    for (const utility of utilities) appendUtility(utility);
    document.body.append(backdrop, panel);
    button.setAttribute("aria-expanded", "true");
    positionPanel();
    document.addEventListener("pointerdown", outsidePointer);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    (panel.querySelector('a[aria-current="page"]') || panel.querySelector("a"))?.focus();
    void refreshActivity();
  }

  function update({ currentMode: nextMode = current, games: nextGames = available, utilities: nextUtilityInput = utilities } = {}) {
    // A newly confirmed option may arrive after the public menu was opened.
    // Only an unchanged prefix can keep its existing DOM and focused link;
    // withdrawals and changes to any old option still close immediately.
    const nextUtilities = normalizeUtilities(nextUtilityInput);
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const gamesChanged = !same(nextGames, available);
    const utilitiesChanged = !same(nextUtilities, utilities);
    const appended = nextMode === current && nextGames.length > available.length
      && available.every((game, index) => same(game, nextGames[index]))
      && new Set(nextGames.map(game => game.id)).size === nextGames.length;
    const utilitiesAppended = nextUtilities.length > utilities.length
      && utilities.every((utility, index) => same(utility, nextUtilities[index]));
    const keepsMenu = nextMode === current && (!gamesChanged || appended) && (!utilitiesChanged || utilitiesAppended);
    if ((nextMode !== current || gamesChanged || utilitiesChanged) && !keepsMenu) {
      close({ restoreFocus: Boolean(panel?.contains(document.activeElement)) });
    }
    const previousLength = available.length;
    const previousUtilities = utilities.length;
    current = nextMode;
    available = nextGames;
    utilities = nextUtilities;
    if (panel && (appended || utilitiesAppended)) {
      if (appended) {
        const list = panel.querySelector(".suite-game-menu__games");
        for (const game of available.slice(previousLength)) appendOption(list, game);
      }
      if (utilitiesAppended) for (const utility of utilities.slice(previousUtilities)) appendUtility(utility);
      positionPanel();
      // Cancel the earlier audience's count request before reading fresh counts.
      if (appended) void refreshActivity();
    }
    updateTrigger();
  }

  updateTrigger();
  return {
    toggle() { if (panel) close({ restoreFocus: true }); else open(); },
    close,
    update,
    destroy() {
      close();
      destroyed = true;
      delete button.dataset.gamePicker;
      for (const attribute of ["aria-controls", "aria-expanded", "aria-haspopup"]) button.removeAttribute(attribute);
    },
  };
}
