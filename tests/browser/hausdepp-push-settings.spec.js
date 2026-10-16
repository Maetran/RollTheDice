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

async function installedHousePushFixture(page, { missing = false } = {}) {
  const calls = [];
  let subscribed = false;
  let enabled = false;
  await page.route("**/api/web-push/subscription", route => {
    const method = route.request().method();
    calls.push(method);
    if (method === "PUT") subscribed = true;
    if (method === "DELETE") { subscribed = false; enabled = false; }
    return route.fulfill({ json: {
      available: true, subscribed, enabled, game_invites_enabled: enabled,
      daily_reminder_enabled: false, release_notifications_enabled: false,
      game_invite_audience: "all", allowed_sender_usernames: [], public_key: "BA" + "A".repeat(85),
    } });
  });
  await page.route("**/api/web-push/preferences", route => {
    expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
    const payload = route.request().postDataJSON();
    calls.push(payload);
    enabled = payload.game_invites_enabled;
    return route.fulfill({ json: { available: true, subscribed, enabled,
      game_invites_enabled: enabled, daily_reminder_enabled: false, release_notifications_enabled: false } });
  });
  // A fresh Hausdepp installation has only the narrow /hausdepp worker. These
  // shared settings documents have no controlling worker, so ready never fires.
  // The browser permission and subscription transport are labelled test doubles;
  // real worker privacy and notification handling have separate PWA tests.
  await page.addInitScript(({ missing }) => {
    Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
    sessionStorage.setItem("rollthedice:pwa-entry:v1", "hausdepp");
    localStorage.setItem("zdwa_language", "de");
    window.houseRegistrationReads = [];
    window.currentPageReadyReads = 0;
    window.houseUnsubscribes = 0;
    const subscription = {
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/house-settings-fixture",
        keys: { p256dh: "test", auth: "test" } }),
      unsubscribe: async () => { window.houseUnsubscribes += 1; return true; },
    };
    let subscribed = false;
    const worker = { scriptURL: `${location.origin}/hausdepp-sw.js`, state: "activating" };
    const registration = {
      scope: `${location.origin}/hausdepp`, active: worker,
      pushManager: {
        getSubscription: async () => subscribed ? subscription : null,
        subscribe: async () => { subscribed = true; return subscription; },
      },
    };
    Object.defineProperty(navigator.serviceWorker, "ready", { get: () => {
      window.currentPageReadyReads += 1;
      return new Promise(() => {});
    } });
    navigator.serviceWorker.getRegistration = async path => {
      window.houseRegistrationReads.push(path ?? "current-page");
      return !missing && path === "/hausdepp" ? registration : undefined;
    };
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "default" });
    Notification.requestPermission = async () => {
      window.housePushPermissionHadGesture = navigator.userActivation.isActive;
      // Exercise the activation wait, rather than returning a ready worker.
      setTimeout(() => { worker.state = "activated"; }, 180);
      return "granted";
    };
  }, { missing });
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
