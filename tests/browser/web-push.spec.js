const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

async function signIn(page) {
  const admin = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(admin.ok()).toBeTruthy();
  const adminUser = (await admin.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": adminUser.csrf_token },
    data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
  });
  expect([201, 400]).toContain(created.status());
  await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": adminUser.csrf_token } });
  const signedIn = await page.request.post("/api/auth/login", {
    data: { username: "Mani", password: "mani-preview-password-123" },
  });
  expect(signedIn.ok()).toBeTruthy();
}

async function mockPush(page, { enabled = false, available = true, denied = false } = {}) {
  const calls = [];
  let subscribed = enabled;
  let gameInvites = enabled;
  let dailyReminder = false;
  let releaseAlerts = false;
  let audience = "all";
  let allowedSenders = [];
  const status = () => ({
    available, enabled: gameInvites || dailyReminder || releaseAlerts, subscribed,
    game_invites_enabled: gameInvites, daily_reminder_enabled: dailyReminder,
    release_notifications_enabled: releaseAlerts, game_invite_audience: audience, allowed_sender_usernames: allowedSenders,
    daily_reminder_window_start: "17:00", daily_reminder_window_end: "21:00", daily_reminder_timezone: "Europe/Zurich",
    public_key: "BA" + "A".repeat(85),
  });
  await page.route("**/api/web-push/subscription", async route => {
    const method = route.request().method();
    calls.push(method);
    if (method === "PUT") { subscribed = true; if (!dailyReminder && !releaseAlerts) gameInvites = true; }
    if (method === "DELETE") { subscribed = false; gameInvites = false; dailyReminder = false; releaseAlerts = false; }
    await route.fulfill({ json: status() });
  });
  await page.route("**/api/web-push/preferences", async route => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
    const payload = route.request().postDataJSON();
    calls.push(payload);
    if (payload.allowed_sender_usernames?.includes("UnknownPlayer")) {
      await route.fulfill({ status: 400, json: { detail: "push_allowlist_invalid" } });
      return;
    }
    gameInvites = payload.game_invites_enabled;
    dailyReminder = payload.daily_reminder_enabled;
    releaseAlerts = payload.release_notifications_enabled ?? releaseAlerts;
    audience = payload.game_invite_audience ?? audience;
    allowedSenders = payload.allowed_sender_usernames ?? allowedSenders;
    await route.fulfill({ json: status() });
  });
  await page.addInitScript(({ denied }) => {
    const subscription = {
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/browser-test", keys: { p256dh: "test", auth: "test" } }),
      unsubscribe: async () => { throw new Error("Local browser cleanup is unavailable"); },
    };
    const registration = {
      pushManager: { getSubscription: async () => null, subscribe: async () => subscription },
    };
    Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve(registration) });
    navigator.serviceWorker.getRegistration = async () => ({
      pushManager: { getSubscription: async () => subscription },
    });
    Notification.requestPermission = async () => {
      window.pushPermissionHadUserGesture = navigator.userActivation.isActive;
      return denied ? "denied" : "granted";
    };
  }, { denied });
  return calls;
}

for (const product of [
  { name: "ZDWA", path: "/konto", enable: "#enableGameInvitePush", disable: "#disableGameInvitePush", status: "#gameInvitePushStatus" },
  { name: "Zilch", path: "/zilch/konto", enable: "#zilchEnableGameInvitePush", disable: "#zilchDisableGameInvitePush", status: "#zilchGameInvitePushStatus" },
]) {
  test(`${product.name} push permission preserves the click and account opt-out survives browser failure`, async ({ page }) => {
    await signIn(page);
    const calls = await mockPush(page);
    await page.goto(product.path);
    await expect(page.locator(product.enable)).toBeEnabled();
    await page.locator(product.enable).click();
    await expect(page.locator(product.status)).toContainText("sind aktiviert");
    expect(await page.evaluate(() => window.pushPermissionHadUserGesture)).toBe(true);
    expect(calls).toContain("PUT");
    // Registering another device stays possible even when the account is on.
    await expect(page.locator(product.enable)).toHaveText("Dieses Gerät für Push anmelden");
    await page.locator(product.disable).click();
    await expect(page.locator(product.status)).toContainText("sind ausgeschaltet");
    expect(calls).toContain("DELETE");
  });

  test(`${product.name} preserves permission errors and allows opt-out when push is unavailable`, async ({ page }) => {
    await signIn(page);
    const calls = await mockPush(page, { denied: true });
    await page.goto(product.path);
    await expect(page.locator(product.enable)).toBeEnabled();
    await page.locator(product.enable).click();
    await expect(page.locator(product.status)).toHaveText("Die Push-Berechtigung wurde nicht erteilt.");
    expect(calls).not.toContain("PUT");
    await page.unroute("**/api/web-push/subscription");
    const unavailableCalls = await mockPush(page, { available: false, enabled: true });
    await page.reload();
    await expect(page.locator(product.enable)).toBeDisabled();
    await expect(page.locator(product.disable)).toBeVisible();
    await page.locator(product.disable).click();
    await expect(page.locator(product.disable)).toBeHidden();
    expect(unavailableCalls).toContain("DELETE");
  });

  test(`${product.name} lets users choose reminders independently and preserves the choice on reload`, async ({ page }) => {
    await signIn(page);
    const calls = await mockPush(page, { enabled: true });
    await page.goto(product.path);
    const invites = page.locator('input[name="gameInvites"]');
    const daily = page.locator('input[name="dailyReminder"]');
    await expect(invites).toBeChecked();
    await expect(daily).not.toBeChecked();
    await expect(page.locator('[data-push-reminder-schedule]')).toHaveText("Nur wenn du heute weder ZDWA noch Zilch gespielt hast: höchstens einmal, zufällig zwischen 17:00 und 21:00 Uhr (Schweizer Zeit).");
    await invites.uncheck();
    await daily.check();
    await page.getByRole("button", { name: "Push-Auswahl speichern" }).click();
    await expect(page.locator('[data-push-preferences-message]')).toHaveText("Push-Auswahl gespeichert.");
    expect(calls).toContainEqual(expect.objectContaining({ game_invites_enabled: false, daily_reminder_enabled: true }));
    await page.reload();
    await expect(invites).not.toBeChecked();
    await expect(daily).toBeChecked();
    const changeLanguage = async language => {
      if (product.name === "ZDWA") {
        await page.locator(`input[name="preferredLanguage"][value="${language}"]`).check();
        await page.locator("#preferencesForm button").click();
      } else {
        await page.locator("[data-language-switcher]").selectOption(language);
      }
      await expect(page.locator("html")).toHaveAttribute("lang", language);
    };
    await changeLanguage("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByLabel("Receive a daily play reminder", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Receive app update alerts", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Accept invitations from")).toHaveValue("all");
    await expect(page.locator('[data-push-reminder-schedule]')).toHaveText("Only if you haven't played ZDWA or Zilch today: at most once, at a random time between 17:00 and 21:00 (Swiss time).");
    await changeLanguage("de");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.locator(product.disable).click();
    await expect(daily).toBeHidden();
  });

  test(`${product.name} release consent and private allowlist persist on mobile without changing other categories`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const calls = await mockPush(page, { enabled: true });
    await page.goto(product.path);
    const releases = page.getByLabel("Versionshinweise erhalten", { exact: true });
    const audience = page.getByLabel("Einladungen akzeptieren von");
    const names = page.getByLabel("Erlaubte Spieler", { exact: true });
    await expect(releases).not.toBeChecked();
    await expect(names).toBeHidden();
    await releases.check();
    await audience.selectOption("allowlist");
    await names.fill("Admin\nAllowedFriend");
    await expect(names).toBeVisible();
    await expect(page.locator('input[name="dailyReminder"]')).not.toBeChecked();
    await page.getByRole("button", { name: "Push-Auswahl speichern" }).click();
    await expect(page.locator('[data-push-preferences-message]')).toHaveText("Push-Auswahl gespeichert.");
    expect(calls).toContainEqual({ game_invites_enabled: true, daily_reminder_enabled: false, release_notifications_enabled: true,
      game_invite_audience: "allowlist", allowed_sender_usernames: ["Admin", "AllowedFriend"] });
    await page.reload();
    await expect(releases).toBeChecked();
    await expect(audience).toHaveValue("allowlist");
    await expect(names).toHaveValue("Admin\nAllowedFriend");
    const box = await names.boundingBox();
    expect(box.width).toBeGreaterThan(150);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const card = page.locator(product.name === "ZDWA" ? ".password-card:has(#pushPreferencesForm)" : ".zilch-account-settings-card:has(#zilchPushPreferencesForm)");
    await page.evaluate(() => document.activeElement?.blur());
    await card.screenshot({ path: testInfo.outputPath("push-settings-mobile.png") });
    await names.fill("");
    await page.getByRole("button", { name: "Push-Auswahl speichern" }).click();
    await expect(page.locator('[data-push-preferences-message]')).toHaveText("Push-Auswahl gespeichert.");
    await page.reload();
    await expect(audience).toHaveValue("allowlist");
    await expect(names).toBeEmpty();
    await page.locator(product.disable).click();
    await expect(releases).toBeHidden();
    await page.reload();
    await expect(page.locator(product.status)).toContainText("sind ausgeschaltet");
  });

  test(`${product.name} invalid and oversized allowlists show an actionable error without losing input`, async ({ page }) => {
    await signIn(page);
    const calls = await mockPush(page, { enabled: true });
    await page.goto(product.path);
    await page.getByLabel("Einladungen akzeptieren von").selectOption("allowlist");
    const names = page.getByLabel("Erlaubte Spieler", { exact: true });
    await names.fill("UnknownPlayer");
    await page.getByRole("button", { name: "Push-Auswahl speichern" }).click();
    await expect(page.locator('[data-push-preferences-message]')).toHaveText("Bitte verwende nur bestehende, aktive Benutzernamen und nicht deinen eigenen Namen.");
    await expect(names).toHaveValue("UnknownPlayer");
    const requests = calls.length;
    await names.fill(Array.from({ length: 101 }, (_, index) => `Player${index}`).join("\n"));
    await page.getByRole("button", { name: "Push-Auswahl speichern" }).click();
    await expect(page.locator('[data-push-preferences-message]')).toHaveText("Du kannst höchstens 100 Spieler auswählen.");
    expect(calls.length).toBe(requests);
  });
}

test("both lobby buttons dispatch invitations and show the account flood limit without a dialog", async ({ page }) => {
  await signIn(page);
  const auth = await (await page.request.get("/api/auth/me")).json();
  const game = { id: "push-ui-test", game_type: "zdwa", mode: 2, expected: 2, players: 1, my_player_id: "seat", started: false, finished: false, locked: false,
    player_statuses: [{ id: "seat", name: "Mani", user_id: auth.user.id, connected: true }] };
  await page.route("**/api/games", route => route.request().method() === "GET"
    ? route.fulfill({ json: { games: [game], online_users: 1 } }) : route.continue());
  await page.route("**/api/games?game_type=zilch", route => route.fulfill({ json: { games: [{ ...game, game_type: "zilch", play_mode: "multiplayer" }] } }));
  let attempts = 0;
  await page.route("**/api/games/push-ui-test/notify-open-seat", route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
    attempts += 1;
    return route.fulfill(attempts === 1 ? { json: { ok: true, notified: true } } : {
      status: 429, json: { detail: { code: "game_invite_account_cooldown", retry_after_seconds: 59 } },
    });
  });
  await page.goto("/");
  await page.locator(".notifyOpenSeatBtn").click();
  await expect(page.getByText("Spieler mit aktivierten Push-Benachrichtigungen wurden informiert.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/zilch");
  await page.locator("[data-zilch-game-invite-push]").click();
  await expect(page.getByText("Du kannst höchstens eine Einladung pro Minute senden – auch über mehrere Spielräume hinweg.")).toBeVisible();
  expect(attempts).toBe(2);
});

for (const worker of ["sw.js", "zilch-sw.js"]) {
  for (const tag of ["daily-reminder-2026-09-06", "app-release-" + "a".repeat(40)]) {
  test(`${worker} opens the ${tag.split("-")[0]} lobby and focuses an existing matching window`, async () => {
    const fs = require("node:fs");
    const vm = require("node:vm");
    const path = require("node:path");
    const origin = worker === "sw.js" ? "https://zockdiewandan.online" : "https://zilch.zockdiewandan.online";
    const handlers = {};
    let visibleNotification;
    let opened;
    let focused = false;
    let windows = [];
    let pending;
    const self = {
      location: { origin },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      registration: { showNotification: async (title, options) => { visibleNotification = { title, ...options }; } },
      clients: { matchAll: async () => windows, openWindow: async url => { opened = url; } },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../app/static", worker), "utf8"), { self, URL });
    handlers.push({ data: { json: () => ({ title: "Neuigkeiten", body: "Die Würfel warten.", url: origin + "/", tag }) }, waitUntil: promise => { pending = promise; } });
    await pending;
    expect(visibleNotification.tag).toBe(tag);
    const click = () => handlers.notificationclick({ notification: { ...visibleNotification, close() {} }, waitUntil: promise => { pending = promise; } });
    click();
    await pending;
    expect(opened).toBe(origin + "/");
    opened = null;
    windows = [{ url: origin + "/", focus: async () => { focused = true; } }];
    click();
    await pending;
    expect(focused).toBe(true);
    expect(opened).toBeNull();
  });
  }
}
