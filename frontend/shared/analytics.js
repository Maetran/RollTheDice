// Product analytics deliberately has no dependency on authentication or game
// state. Its short-lived IDs belong to this tab, never to a player or a room.
const ENDPOINT = "/api/analytics/events";
const SESSION_KEY = "rollthedice:analytics:tab:v1";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const ACTIVE_IDLE_MS = 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;
const MAX_BATCH = 20;
const MAX_ACTIONS_PER_MINUTE = 60;
const ROUTE_NAMES = new Set([
  "/", "/regeln", "/spieler", "/rangabzeichen", "/bestenlisten",
  "/historie", "/statistiken", "/erfolge", "/offline", "/konto",
]);
const ID_ACTIONS = Object.freeze({
  createBtn: "create_game", rollBtnInline: "roll_dice", rollBtn: "roll_dice",
  announceBtnInline: "score", rulesSheetOpen: "open_rules",
  rankLegendSheetOpen: "open_achievements", shareGameBtn: "game_invite",
  notifyOpenSeatBtn: "game_invite", zilchShareGameBtn: "game_invite",
  backToLobbyBtn: "game_leave", zilchLeaveGameBtn: "game_leave",
  lbTabNormal: "open_leaderboard", lbTabHC: "open_leaderboard",
  lbTabShame: "open_leaderboard", lbTabLast: "open_history",
  statisticsTab: "open_statistics", achievementsTab: "open_achievements",
  settingsTab: "open_settings",
});
const MODE_ACTIONS = Object.freeze({
  "1": "mode_solo", "2": "mode_duo", "3": "mode_trio", "2v2": "mode_team",
  solo: "mode_solo", multiplayer: "mode_multiplayer", cpu: "mode_computer",
});
const DESTINATION_ACTIONS = Object.freeze({
  "/": "navigate", "/spiel": "join_game", "/zuschauen": "watch_game",
  "/regeln": "open_rules", "/spieler": "open_players",
  "/rangabzeichen": "open_achievements", "/bestenlisten": "open_leaderboard",
  "/historie": "open_history", "/statistiken": "open_statistics",
  "/erfolge": "open_achievements", "/offline-spielen": "mode_offline",
  "/ergebnis": "open_history",
  "/konto": "open_account",
});

function permitsAnalytics() {
  return navigator.globalPrivacyControl !== true
    && ![navigator.doNotTrack, navigator.msDoNotTrack, window.doNotTrack]
      .some(value => value === "1" || value === "yes");
}

function randomId(bytes = 16) {
  const value = new Uint8Array(bytes);
  // Do not replace unavailable secure randomness with a browser fingerprint.
  if (!globalThis.crypto?.getRandomValues) return null;
  globalThis.crypto.getRandomValues(value);
  return Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizedAnalyticsPage(locationLike = window.location, gameHint = document.documentElement.dataset.game) {
  let path = String(locationLike.pathname || "/");
  let game = gameHint === "zilch" || locationLike.hostname === "zilch.zockdiewandan.online" ? "zilch" : "zdwa";
  if (path === "/zdwa" || path.startsWith("/zdwa/")) {
    path = path.slice(5) || "/";
    game = "zdwa";
  } else if (path === "/zilch" || path.startsWith("/zilch/")) {
    path = path.slice(6) || "/";
    game = "zilch";
  }
  path = path.replace(/\/$/, "") || "/";
  let route = null;
  if (ROUTE_NAMES.has(path)) route = path;
  else if (/^\/spiel\/[^/]+\/zuschauen$/.test(path) || path === "/zuschauen") route = "/zuschauen";
  else if (/^\/spiel\/[^/]+$/.test(path) || path === "/spiel") route = "/spiel";
  else if (/^\/ergebnis(?:\/[^/]+)?$/.test(path)) route = "/ergebnis";
  else if (/^\/spieler\/[^/]+$/.test(path)) route = "/spieler";
  // Admin, auth, dashboard and unknown paths never reach the queue. The account
  // page contributes its category only, never its identity, inputs or settings.
  // Practice games have a separate, intentionally private local-only client.
  if (!route) return null;
  return { game, route, page: game === "zilch" ? `/zilch${route === "/" ? "" : route}` : route };
}

function referrerHost() {
  try {
    const referrer = new URL(document.referrer);
    return ["https:", "http:"].includes(referrer.protocol) ? referrer.hostname.toLowerCase().slice(0, 200) : "";
  } catch {
    return "";
  }
}

// Only fixed, coarse categories leave this function. Never send the UA,
// OS/browser versions, model strings or touch-point count to the server.
// Reduced/desktop UAs can hide hardware; ambiguous Silk devices stay unknown.
export function analyticsDeviceDetails(browserInfo = navigator) {
  const ua = String(browserInfo.userAgent || "").slice(0, 512);
  if (/Kindle Fire|\bKF[A-Z0-9]+\b/i.test(ua)) return { os: "fireos", device_family: "fire_tablet" };
  if (/\bSilk\//i.test(ua)) return { os: "unknown", device_family: "unknown" };
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && Number(browserInfo.maxTouchPoints) > 1)) return { os: "ipados", device_family: "ipad" };
  if (/iPhone/i.test(ua)) return { os: "ios", device_family: "iphone" };
  if (/iPod/i.test(ua)) return { os: "ios", device_family: "unknown" };
  if (/Windows Phone/i.test(ua)) return { os: "windows", device_family: "unknown" };
  if (/Android/i.test(ua)) return { os: "android", device_family: /Mobile/i.test(ua) ? "android_phone" : "android_tablet" };
  if (/CrOS/i.test(ua)) return { os: "chromeos", device_family: "chromebook" };
  if (/Windows NT/i.test(ua)) return { os: "windows", device_family: "windows_pc" };
  if (/Macintosh|Mac OS X/i.test(ua)) return { os: "macos", device_family: "mac" };
  if (/Linux/i.test(ua)) return { os: "linux", device_family: "linux_pc" };
  return { os: "unknown", device_family: "unknown" };
}

function deviceClass(details) {
  if (["ipad", "fire_tablet", "android_tablet"].includes(details.device_family)) return "tablet";
  if (["iphone", "android_phone"].includes(details.device_family)) return "mobile";
  if (["mac", "windows_pc", "linux_pc", "chromebook"].includes(details.device_family)) return "desktop";
  const width = Math.min(window.screen?.width || window.innerWidth, window.innerWidth);
  return width < 768 ? "mobile" : width < 1100 ? "tablet" : "desktop";
}

let initialized = false;

export function initializeAnalytics() {
  if (initialized || !permitsAnalytics()) return;
  initialized = true;
  const deviceDetails = analyticsDeviceDetails();
  let session = null;
  let current = null;
  let currentPath = null;
  let pageId = null;
  let queue = [];
  let activeMs = 0;
  let checkpoint = performance.now();
  let lastActivity = checkpoint;
  let visible = document.visibilityState === "visible" && document.hasFocus();
  let heartbeat = null;
  let mode = "unknown";
  let actionTimes = [];
  const actionDebounce = new Map();

  function rememberSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* Private browsing still works in memory. */ }
  }

  function loadSession() {
    const now = Date.now();
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (/^[a-f0-9]{32}$/.test(stored?.id || "") && Number.isFinite(stored?.lastActivity)
        && now >= stored.lastActivity && now - stored.lastActivity < SESSION_IDLE_MS) session = stored;
    } catch (_) { /* Corrupt or unavailable tab storage is disposable. */ }
    if (!session) session = { id: randomId(), lastActivity: now };
    if (session.id) rememberSession();
  }

  function stopHeartbeat() {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  }

  function flush(beacon = false) {
    if (!permitsAnalytics()) {
      stopHeartbeat();
      queue = [];
      activeMs = 0;
      return;
    }
    if (!queue.length || !session?.id) return;
    const events = queue.splice(0, MAX_BATCH);
    // Keep offline/network errors invisible to the game. There is no durable
    // retry queue and no upload of a private offline game's result.
    if (navigator.onLine === false) return;
    const body = JSON.stringify({ session_id: session.id, device: deviceClass(deviceDetails), ...deviceDetails, referrer: referrerHost(), events });
    try {
      if (beacon && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
      void fetch(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
        credentials: "omit", keepalive: true, referrerPolicy: "no-referrer",
      }).catch(() => {});
    } catch (_) { /* Analytics must never affect navigation or play. */ }
  }

  function enqueue(type, fields = {}) {
    if (!current || !session?.id || !permitsAnalytics()) return;
    const id = randomId(8);
    if (!id) return;
    if (queue.length >= MAX_BATCH) flush();
    queue.push({ id, page_id: pageId, type, page: current.page, game: current.game, mode, ...fields });
  }

  function collectActive(now = performance.now()) {
    if (current && visible) activeMs += Math.max(0, Math.min(now, lastActivity + ACTIVE_IDLE_MS) - checkpoint);
    checkpoint = now;
  }

  function enqueueEngagement() {
    const delta = Math.min(60000, Math.floor(activeMs));
    if (delta > 0) {
      enqueue("engagement", { active_ms: delta });
      activeMs -= delta;
    }
  }

  function startHeartbeat() {
    if (!current || !visible || heartbeat !== null || !permitsAnalytics()) return;
    heartbeat = setInterval(() => {
      collectActive();
      enqueueEngagement();
      flush();
    }, HEARTBEAT_MS);
  }

  function changePage() {
    const next = normalizedAnalyticsPage();
    // Compare the pathname in memory so entering another room is a new view;
    // only its category is sent, and query/hash-only changes stay one view.
    if (window.location.pathname === currentPath) return;
    collectActive();
    enqueueEngagement();
    flush();
    stopHeartbeat();
    current = next;
    currentPath = window.location.pathname;
    pageId = randomId(8);
    mode = "unknown";
    checkpoint = performance.now();
    lastActivity = checkpoint;
    activeMs = 0;
    if (!current || !pageId || !permitsAnalytics()) return;
    if (!session || Date.now() - session.lastActivity >= SESSION_IDLE_MS) {
      session = null;
      loadSession();
    }
    if (session) {
      session.lastActivity = Date.now();
      rememberSession();
    }
    enqueue("page_view");
    flush();
    startHeartbeat();
  }

  function activity() {
    if (!current || !permitsAnalytics()) return;
    const now = Date.now();
    collectActive();
    if (session && now - session.lastActivity >= SESSION_IDLE_MS) {
      enqueueEngagement();
      flush();
      session = { id: randomId(), lastActivity: now };
      pageId = randomId(8);
      enqueue("page_view");
      activeMs = 0;
      actionTimes = [];
      actionDebounce.clear();
    }
    if (session) {
      session.lastActivity = now;
      // Persist at most once a second even during scrolling or mouse movement.
      if (!activity.lastSaved || now - activity.lastSaved >= 1000) {
        rememberSession();
        activity.lastSaved = now;
      }
    }
    lastActivity = performance.now();
  }

  function recordAction(action) {
    if (!current || !action || !permitsAnalytics()) return;
    const now = performance.now();
    if (now - (actionDebounce.get(action) ?? -Infinity) < 1000) return;
    actionTimes = actionTimes.filter(time => now - time < 60000);
    if (actionTimes.length >= MAX_ACTIONS_PER_MINUTE) return;
    actionTimes.push(now);
    actionDebounce.set(action, now);
    enqueue("action", { action });
  }

  function click(event) {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("button, a[href], td.cell.clickable");
    if (!target || target.disabled || target.getAttribute("aria-disabled") === "true" || !current) return;
    activity();
    let action = ID_ACTIONS[target.id];
    if (target.matches("[data-game-mode]")) action = MODE_ACTIONS[target.dataset.gameMode];
    else if (target.matches("[data-zilch-play-mode]")) {
      const selected = target.dataset.zilchPlayMode;
      action = MODE_ACTIONS[selected];
      if (action) mode = selected;
    } else if (target.matches("[data-hardcore]")) {
      if (target.dataset.hardcore === "true") { action = "mode_hardcore"; mode = "hardcore"; }
      else if (target.dataset.hardcore === "false") { action = "mode_normal"; mode = "normal"; }
    } else if (target.matches("#scoreOut .die, [data-zilch-die-index], [data-zilch-recommendation], [data-zilch-combined-score]")) action = "hold_dice";
    else if (target.matches("td.cell.clickable, [data-quick-field]")) action = "score";
    else if (target.matches("[data-zilch-roll], [data-zilch-roll-die-index], [data-zilch-start-roll]")) action = "roll_dice";
    else if (target.matches("[data-zilch-bank]")) action = "bank";
    else if (target.matches("[data-zilch-new-round]")) action = "game_restart";
    else if (target.matches(".joinBtn, .resumeBtn")) action = "join_game";
    else if (target.matches(".spectateBtn")) action = "watch_game";
    else if (target.matches("[data-zilch-game-invite-push], .notifyOpenSeatBtn")) action = "game_invite";
    else if (target.matches("[data-theme-toggle]")) action = "theme_change";
    else if (target.matches("[data-game-switch]")) action = "navigate";
    else if (target.matches("[data-zilch-account-tab]")) action = {
      statistics: "open_statistics", achievements: "open_achievements", settings: "open_settings",
    }[target.dataset.zilchAccountTab];
    else if (target.matches("a[href], [data-zilch-navigate]")) {
      // Only the normalized destination category leaves this function. Never
      // serialize href, button text, datasets, field values, or room tokens.
      try {
        const url = new URL(target.getAttribute("href") || target.dataset.zilchNavigate, window.location.href);
        if (url.origin === window.location.origin) {
          const destination = normalizedAnalyticsPage(url, current.game);
          action = destination ? DESTINATION_ACTIONS[destination.route] : null;
          // Entry intent can be counted without tracking the private practice client.
          if (/^\/(?:zilch\/|zdwa\/)?offline-spielen\/?$/.test(url.pathname)) action = "mode_offline";
        }
      } catch (_) { /* An invalid destination is not an analytics event. */ }
    }
    recordAction(action);
  }

  function visibility() {
    collectActive();
    visible = document.visibilityState === "visible" && document.hasFocus();
    if (!visible) {
      stopHeartbeat();
      enqueueEngagement();
      flush(true);
    } else {
      activity();
      startHeartbeat();
    }
  }

  document.addEventListener("click", click, { capture: true, passive: true });
  document.addEventListener("submit", event => {
    if (event.target instanceof Element && event.target.id === "zilchCreateForm") {
      activity();
      recordAction("create_game");
    }
  }, { capture: true, passive: true });
  document.addEventListener("change", event => {
    if (event.target instanceof Element && event.target.matches("[data-language-switcher]")) {
      activity();
      recordAction("language_change");
    }
  }, { capture: true, passive: true });
  for (const event of ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"]) {
    document.addEventListener(event, activity, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", visibility);
  window.addEventListener("blur", visibility);
  window.addEventListener("pagehide", () => {
    collectActive();
    enqueueEngagement();
    flush(true);
    stopHeartbeat();
  });
  window.addEventListener("pageshow", event => { if (event.persisted) visibility(); });
  window.addEventListener("popstate", changePage);
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = Reflect.apply(original, this, args);
      changePage();
      return result;
    };
  }
  changePage();
}
