const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

async function signIn(page) {
  const username = "PushSettings";
  const temporaryPassword = "push-temporary-password-123";
  const password = "push-browser-password-123";
  const admin = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(admin.ok()).toBeTruthy();
  const adminUser = (await admin.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": adminUser.csrf_token },
    data: { username, temporary_password: temporaryPassword, role: "admin" },
  });
  expect([201, 400]).toContain(created.status());
  await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": adminUser.csrf_token } });
  if (created.status() === 201) {
    const first = await page.request.post("/api/auth/login", { data: { username, password: temporaryPassword } });
    expect(first.ok()).toBeTruthy();
    const user = (await first.json()).user;
    expect((await page.request.post("/api/auth/change-password", {
      headers: { "X-CSRF-Token": user.csrf_token },
      data: { current_password: temporaryPassword, new_password: password },
    })).ok()).toBeTruthy();
  }
  expect((await page.request.post("/api/auth/login", { data: { username, password } })).ok()).toBeTruthy();
}

async function installedHousePushFixture(page, {
  missing = false, accountSubscribed = false, localSubscribed = false, deviceRegistered = false,
  gameInvites = false, dailyReminder = false, releaseNotifications = false, permission = "default",
  installedEntry = "hausdepp",
} = {}) {
  const authResponse = await page.request.get("/api/auth/me");
  expect(authResponse.ok()).toBeTruthy();
  const viewerId = (await authResponse.json()).user.id;
  const calls = [];
  let subscribed = accountSubscribed;
  let enabled = gameInvites;
  let reminderEnabled = dailyReminder;
  let releasesEnabled = releaseNotifications;
  let registered = deviceRegistered;
  const status = () => ({
    viewer_id: viewerId, available: true, subscribed, enabled: enabled || reminderEnabled || releasesEnabled,
    game_invites_enabled: enabled, daily_reminder_enabled: reminderEnabled,
    release_notifications_enabled: releasesEnabled, game_invite_audience: "all",
    allowed_sender_usernames: [], public_key: "BA" + "A".repeat(85),
  });
  await page.route("**/api/web-push/subscription/check", route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
    expect(route.request().headers()["x-push-expected-account-id"]).toBe(String(viewerId));
    const payload = route.request().postDataJSON();
    expect(payload.product_context).toBe("hausdepp");
    expect(payload.endpoint).toBe("https://fcm.googleapis.com/fcm/send/house-settings-fixture");
    calls.push({ check: payload });
    return route.fulfill({ json: { ...status(), device_subscribed: registered } });
  });
  await page.route("**/api/web-push/subscription", route => {
    const method = route.request().method();
    calls.push(method);
    if (method === "PUT") {
      expect(route.request().headers()["x-push-expected-account-id"]).toBe(String(viewerId));
      // Shared account pages must retain the installed Hausdepp device context
      // so a release cannot turn into an unrelated ZDWA reminder later.
      expect(route.request().postDataJSON().product_context).toBe("hausdepp");
      subscribed = true;
      registered = true;
    }
    if (method === "DELETE") {
      subscribed = false; registered = false; enabled = false; reminderEnabled = false; releasesEnabled = false;
    }
    return route.fulfill({ json: status() });
  });
  await page.route("**/api/web-push/preferences", route => {
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
    const payload = route.request().postDataJSON();
    calls.push(payload);
    enabled = payload.game_invites_enabled;
    reminderEnabled = payload.daily_reminder_enabled;
    releasesEnabled = payload.release_notifications_enabled ?? releasesEnabled;
    return route.fulfill({ json: status() });
  });
  // A fresh Hausdepp installation has only the narrow /hausdepp worker. These
  // shared settings documents have no controlling worker, so ready never fires.
  // The browser permission and subscription transport are labelled test doubles;
  // real worker privacy and notification handling have separate PWA tests.
  await page.addInitScript(({ missing, localSubscribed, permission: initialPermission, installedEntry }) => {
    Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
    sessionStorage.setItem("rollthedice:pwa-entry:v1", installedEntry);
    localStorage.setItem("zdwa_language", "de");
    window.houseRegistrationReads = [];
    window.currentPageReadyReads = 0;
    window.houseUnsubscribes = 0;
    window.houseSubscribes = 0;
    window.housePermissionRequests = 0;
    const subscription = {
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/house-settings-fixture",
        keys: { p256dh: "test", auth: "test" } }),
      unsubscribe: async () => { window.houseUnsubscribes += 1; subscribed = false; return true; },
    };
    let subscribed = localSubscribed;
    let permission = initialPermission;
    const worker = { scriptURL: `${location.origin}/hausdepp-sw.js`, state: localSubscribed || permission === "granted" ? "activated" : "activating" };
    const registration = {
      scope: `${location.origin}/hausdepp`, active: worker,
      pushManager: {
        getSubscription: async () => subscribed ? subscription : null,
        subscribe: async () => { window.houseSubscribes += 1; subscribed = true; return subscription; },
      },
    };
    Object.defineProperty(navigator.serviceWorker, "controller", { configurable: true, get: () => worker });
    Object.defineProperty(navigator.serviceWorker, "ready", { get: () => {
      window.currentPageReadyReads += 1;
      return installedEntry === "hausdepp" ? new Promise(() => {}) : Promise.resolve(registration);
    } });
    navigator.serviceWorker.getRegistration = async path => {
      window.houseRegistrationReads.push(path ?? "current-page");
      return !missing && (path === "/hausdepp" || installedEntry !== "hausdepp") ? registration : undefined;
    };
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => permission });
    Notification.requestPermission = async () => {
      window.housePermissionRequests += 1;
      window.housePushPermissionHadGesture = navigator.userActivation.isActive;
      // Exercise the activation wait, rather than returning a ready worker.
      setTimeout(() => { worker.state = "activated"; }, 180);
      permission = "granted";
      return permission;
    };
  }, { missing, localSubscribed, permission, installedEntry });
  return calls;
}

for (const product of [
  { name: "ZDWA", path: "/konto", enable: "#enableGameInvitePush", disable: "#disableGameInvitePush", status: "#gameInvitePushStatus" },
  { name: "Zilch", path: "/zilch/konto", enable: "#zilchEnableGameInvitePush", disable: "#zilchDisableGameInvitePush", status: "#zilchGameInvitePushStatus" },
]) {
  test(`fresh Hausdepp PWA registers and removes its push subscription from shared ${product.name} settings`, async ({ page }) => {
    await signIn(page);
    const calls = await installedHousePushFixture(page);
    await page.goto(`${product.path}#settings`);
    const section = page.locator('details[data-account-section="social"]');
    if (await section.getAttribute("open") === null) await section.locator(":scope > summary").click();
    await expect(page.locator(product.enable)).toBeEnabled();
    await page.locator(product.enable).click();
    await expect(page.locator(product.status)).toContainText("bereit");
    expect(calls).toContain("PUT");
    // Preparing the device never silently enables the player-call category.
    await expect(page.locator('input[name="gameInvites"]')).not.toBeChecked();
    expect(await page.evaluate(() => window.housePushPermissionHadGesture)).toBe(true);
    expect(await page.evaluate(() => window.currentPageReadyReads)).toBe(0);
    await page.locator('input[name="gameInvites"]').check();
    await page.getByRole("button", { name: "Push-Auswahl speichern" }).click();
    await expect(page.locator(product.status)).toContainText("sind aktiviert");
    await page.locator(product.disable).click();
    await expect(page.locator(product.status)).toContainText("sind ausgeschaltet");
    expect(calls).toContain("DELETE");
    expect(await page.evaluate(() => window.houseUnsubscribes)).toBe(1);
    const reads = await page.evaluate(() => window.houseRegistrationReads);
    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(reads.every(path => path === "/hausdepp")).toBe(true);
  });
}

test("a missing Hausdepp registration fails within the bounded wait without subscribing another worker", async ({ page }) => {
  await signIn(page);
  const calls = await installedHousePushFixture(page, { missing: true });
  await page.goto("/konto#settings");
  const section = page.locator('details[data-account-section="social"]');
  if (await section.getAttribute("open") === null) await section.locator(":scope > summary").click();
  await expect(page.locator("#enableGameInvitePush")).toBeEnabled();
  await page.clock.install();
  await page.locator("#enableGameInvitePush").click();
  await page.clock.runFor(15_200);
  await expect(page.locator("#gameInvitePushStatus")).toHaveText("Push-Benachrichtigungen sind gerade nicht eingerichtet.");
  expect(calls).not.toContain("PUT");
  expect(await page.evaluate(() => window.currentPageReadyReads)).toBe(0);
});

async function openHousePushSettings(page) {
  await page.goto("/hausdepp/konto/einstellungen#hausdeppPushSettings");
  await expect(page.locator("#hausdeppPushSettings")).toHaveJSProperty("open", true);
  await expect(page.locator("#hausdeppPushEnable")).toBeEnabled();
}

test("another account device never marks this missing Hausdepp device ready or hides its registration", async ({ page }) => {
  await signIn(page);
  const calls = await installedHousePushFixture(page, {
    accountSubscribed: true, gameInvites: true, releaseNotifications: true, permission: "granted",
  });
  await openHousePushSettings(page);
  await expect(page.locator("#hausdeppPushEnable")).toBeVisible();
  await expect(page.locator("#hausdeppPushStatus")).toHaveText("Dieses Gerät ist für dieses Spiel noch nicht angemeldet. Melde es für Push an; deine Auswahl bleibt erhalten.");
  await expect(page.locator("#hausdeppPushPreferences")).toBeVisible();
  await expect(page.locator('input[name="gameInvites"]')).toBeChecked();
  await expect(page.locator('input[name="releaseNotifications"]')).toBeChecked();
  expect(calls).not.toContain("PUT");
  expect(calls.filter(call => typeof call === "object" && call.check)).toEqual([]);
  expect(await page.evaluate(() => ({ subscribed: window.houseSubscribes, permission: window.housePermissionRequests })))
    .toEqual({ subscribed: 0, permission: 0 });
});

test("an existing local Hausdepp subscription missing on the server is repaired only by the registration click", async ({ page }) => {
  await signIn(page);
  const calls = await installedHousePushFixture(page, {
    accountSubscribed: true, localSubscribed: true, gameInvites: true, releaseNotifications: true, permission: "granted",
  });
  await openHousePushSettings(page);
  await expect.poll(() => calls.filter(call => typeof call === "object" && call.check).length).toBeGreaterThan(0);
  await expect(page.locator("#hausdeppPushEnable")).toBeVisible();
  await expect(page.locator("#hausdeppPushStatus")).toHaveText("Dieses Gerät ist für dieses Spiel noch nicht angemeldet. Melde es für Push an; deine Auswahl bleibt erhalten.");
  expect(calls).not.toContain("PUT");
  await page.locator("#hausdeppPushEnable").click();
  await expect(page.locator("#hausdeppPushStatus")).toHaveText("Push-Benachrichtigungen sind aktiviert.");
  expect(calls.filter(call => call === "PUT")).toHaveLength(1);
  await expect(page.locator('input[name="gameInvites"]')).toBeChecked();
  await expect(page.locator('input[name="dailyReminder"]')).not.toBeChecked();
  await expect(page.locator('input[name="releaseNotifications"]')).toBeChecked();
  expect(calls.filter(call => typeof call === "object" && !call.check)).toEqual([]);
  expect(await page.evaluate(() => ({ subscribed: window.houseSubscribes, permission: window.housePermissionRequests })))
    .toEqual({ subscribed: 0, permission: 0 });
});

test("a correct local and server Hausdepp subscription is checked without changing delivery identity or consent", async ({ page }) => {
  await signIn(page);
  const calls = await installedHousePushFixture(page, {
    accountSubscribed: true, localSubscribed: true, deviceRegistered: true, releaseNotifications: true, permission: "granted",
  });
  await openHousePushSettings(page);
  await expect.poll(() => calls.filter(call => typeof call === "object" && call.check).length).toBeGreaterThan(0);
  await expect(page.locator("#hausdeppPushStatus")).toHaveText("Push-Benachrichtigungen sind aktiviert.");
  await expect(page.locator('input[name="gameInvites"]')).not.toBeChecked();
  await expect(page.locator('input[name="dailyReminder"]')).not.toBeChecked();
  await expect(page.locator('input[name="releaseNotifications"]')).toBeChecked();
  expect(calls).not.toContain("PUT");
  expect(calls).not.toContain("DELETE");
  expect(calls.filter(call => typeof call === "object" && !call.check)).toEqual([]);
  expect(await page.evaluate(() => ({ subscribed: window.houseSubscribes, permission: window.housePermissionRequests })))
    .toEqual({ subscribed: 0, permission: 0 });
});

test("the actual Hausdepp worker keeps its product context when an installed ZDWA entry changes the manifest", async ({ page }) => {
  await signIn(page);
  const calls = await installedHousePushFixture(page, {
    accountSubscribed: true, localSubscribed: true, releaseNotifications: true,
    permission: "granted", installedEntry: "zdwa",
  });
  await openHousePushSettings(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("data-pwa-product", "zdwa");
  await expect.poll(() => calls.filter(call => typeof call === "object" && call.check).length).toBeGreaterThan(0);
  await page.locator("#hausdeppPushEnable").click();
  await expect.poll(() => calls.filter(call => call === "PUT").length).toBe(1);
  await expect(page.locator("#hausdeppPushStatus")).toHaveText("Push-Benachrichtigungen sind aktiviert.");
  await expect(page.locator('input[name="releaseNotifications"]')).toBeChecked();
  expect(calls.filter(call => typeof call === "object" && !call.check)).toEqual([]);
  expect(await page.evaluate(() => window.houseSubscribes)).toBe(0);
});
