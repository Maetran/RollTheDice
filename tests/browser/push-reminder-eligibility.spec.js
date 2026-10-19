const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function fixture(page, { language = "de", permission = "default", localDevice = false, show = true, manualInstallHint = false, holdClaim = false } = {}) {
  const login = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  page.reminderOwner = { headers: { "X-CSRF-Token": user.csrf_token }, language: user.preferences?.preferred_language || "de" };
  expect((await page.request.put("/api/auth/preferences/language", {
    headers: page.reminderOwner.headers, data: { preferred_language: language },
  })).ok()).toBeTruthy();
  await page.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
  await page.route("**/api/releases**", route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route("**/api/auth/tours/offer", route => route.fulfill({ json: { show: false, enabled: true, games: {} } }));
  await page.route("**/api/hausdepp/progress-notices", route => route.fulfill({ json: { notices: [] } }));
  await page.route("**/api/hausdepp/invitations", route => route.fulfill({ json: { invitations: [] } }));
  const claims = [], checks = [], writes = [];
  let heldClaim = null;
  // Another registered account device already has every voluntary category
  // enabled. This browser's registration is modelled independently below.
  const status = {
    viewer_id: user.id, available: true, subscribed: true, enabled: true,
    game_invites_enabled: true, daily_reminder_enabled: true, release_notifications_enabled: true,
    is_admin: true, admin_help_enabled: false, public_key: "BA" + "A".repeat(85),
  };
  await page.route("**/api/web-push/subscription", route => {
    if (route.request().method() !== "GET") writes.push(route.request().method());
    return route.fulfill({ json: status });
  });
  await page.route("**/api/web-push/subscription/check", async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBe(user.csrf_token);
    expect(route.request().headers()["x-push-expected-account-id"]).toBe(String(user.id));
    const payload = route.request().postDataJSON();
    expect(payload.product_context).toBe("hausdepp");
    await route.fulfill({ json: { ...status, device_subscribed: localDevice } });
    checks.push(payload);
  });
  await page.route("**/api/web-push/opt-in-prompt", route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBe(user.csrf_token);
    expect(route.request().headers()["x-push-expected-account-id"]).toBe(String(user.id));
    const payload = route.request().postDataJSON();
    expect(payload).toEqual({ device_missing: true });
    claims.push(payload);
    if (holdClaim && claims.length === 1) { heldClaim = route; return; }
    // A successful reservation is spent. Repeating the POST cannot recover a
    // delayed dialog; the server's account-wide cooldown now rejects it.
    return route.fulfill({ json: { show: holdClaim ? false : show, interval_days: 14 } });
  });
  await page.addInitScript(({ permission: initialPermission, localDevice, manualInstallHint }) => {
    if (manualInstallHint) {
      // Labelled iPhone capability fixture: the app's real toast, translations,
      // layout, dismissal and coordination with Push remain under test.
      Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
      Object.defineProperty(navigator, "standalone", { configurable: true, get: () => false });
    }
    let permission = initialPermission;
    window.reminderPermissionRequests = 0;
    window.reminderSubscriptions = 0;
    const subscription = {
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/house-reminder-fixture", keys: { p256dh: "test", auth: "test" } }),
    };
    const registration = {
      scope: `${location.origin}/hausdepp`,
      active: { scriptURL: `${location.origin}/hausdepp-sw.js`, state: "activated" },
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async () => { window.reminderSubscriptions += 1; return subscription; },
      },
    };
    navigator.serviceWorker.getRegistration = async path => localDevice && path === "/hausdepp" ? registration : undefined;
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => permission });
    Notification.requestPermission = async () => {
      window.reminderPermissionRequests += 1;
      window.reminderPermissionHadGesture = navigator.userActivation.isActive;
      permission = "granted";
      return permission;
    };
  }, { permission, localDevice, manualInstallHint });
  await page.goto("/hausdepp");
  await expect(page.locator("#hausdeppCreateForm")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.ZDWA_PUSH_OPT_IN_PROMPT));
  return { claims, checks, writes,
    hasHeldClaim: () => Boolean(heldClaim),
    resolveClaim: async () => {
      expect(heldClaim).not.toBeNull();
      const route = heldClaim;
      heldClaim = null;
      const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === "/api/web-push/opt-in-prompt"
        && candidate.request().method() === "POST");
      await route.fulfill({ json: { show: true, interval_days: 14 } });
      await (await response).finished();
      await page.evaluate(() => Promise.resolve());
    },
  };
}

async function expectDialogWithClock(page, dialog) {
  // A retry can await a fresh network status before scheduling its next timer.
  // Advance while observing the visible result, rather than advancing once
  // before the response and leaving a later timer frozen indefinitely.
  await expect.poll(async () => {
    await page.clock.runFor(500);
    return dialog.isVisible();
  }).toBe(true);
}

test.afterEach(async ({ page }) => {
  const saved = page.reminderOwner;
  if (saved) await page.request.put("/api/auth/preferences/language", { headers: saved.headers, data: { preferred_language: saved.language } });
});

for (const language of ["de", "en"]) {
  test(`${language}: the Hausdepp lobby offers this missing device despite another active device and opens its own settings`, async ({ page }, testInfo) => {
    const state = await fixture(page, { language });
    const dialog = page.getByRole("dialog", { name: language === "de" ? "Lust auf eine Runde?" : "Fancy a game?" });
    await expect(dialog).toBeVisible();
    expect(state.claims).toEqual([{ device_missing: true }]);
    expect(state.checks).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(await page.evaluate(() => window.reminderPermissionRequests)).toBe(0);
    const close = dialog.locator("#appDialogClose");
    await expect(close).toHaveAccessibleName(language === "de" ? "Dialog schließen" : "Close dialog");
    await expect(close).toBeInViewport();
    expect(await close.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`hausdepp-push-reminder-${language}-mobile.png`) });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: testInfo.outputPath(`hausdepp-push-reminder-${language}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });

    // A missing local worker cannot prepare transport. The explicit action
    // still takes the player to the correct settings and preserves consent.
    await page.clock.install();
    await dialog.getByRole("button", { name: language === "de" ? "Push zulassen & auswählen" : "Allow push & choose", exact: true }).click();
    await page.clock.runFor(15_200);
    await expect(page).toHaveURL(/\/hausdepp\/konto\/einstellungen#hausdeppPushSettings$/);
    await expect(page.locator("#hausdeppPushSettings")).toHaveJSProperty("open", true);
    await expect(page.locator('input[name="gameInvites"]')).toBeChecked();
    await expect(page.locator('input[name="dailyReminder"]')).toBeChecked();
    await expect(page.locator('input[name="releaseNotifications"]')).toBeChecked();
    expect(state.writes).toEqual([]);
  });
}

for (const language of ["de", "en"]) {
  test(`${language}: the native Hausdepp install hint stays readable and defers the Push dialog until dismissed`, async ({ page }, testInfo) => {
    const state = await fixture(page, { language, manualInstallHint: true });
    const hint = page.locator("[data-pwa-install-hint]");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(language === "de" ? "Zum Home-Bildschirm" : "Add to Home Screen");
    await page.clock.install();
    await page.evaluate(() => window.ZDWA_PUSH_OPT_IN_PROMPT.refresh());
    await page.clock.runFor(1_600);
    expect(state.claims).toEqual([]);
    await expect(page.getByRole("dialog")).toBeHidden();
    const close = hint.getByRole("button", { name: language === "de" ? "Hinweis schließen" : "Close notice", exact: true });
    await expect(close).toBeInViewport();
    expect(await close.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`hausdepp-install-hint-${language}-mobile.png`) });
    await close.click();
    await expect(hint).toHaveCount(0);
    await expectDialogWithClock(page, page.getByRole("dialog", { name: language === "de" ? "Lust auf eine Runde?" : "Fancy a game?" }));
    expect(state.claims).toEqual([{ device_missing: true }]);
    expect(state.writes).toEqual([]);
  });
}

test("an enabled and confirmed local Hausdepp device does not claim another prompt", async ({ page }) => {
  const state = await fixture(page, { permission: "granted", localDevice: true });
  await expect.poll(() => state.checks.length).toBeGreaterThan(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  expect(state.claims).toEqual([]);
  expect(state.writes).toEqual([]);
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.evaluate(() => ({ permission: window.reminderPermissionRequests, subscriptions: window.reminderSubscriptions })))
    .toEqual({ permission: 0, subscriptions: 0 });
});

test("a denied browser permission does not claim a Hausdepp prompt or ask permission again", async ({ page }) => {
  const state = await fixture(page, { permission: "denied" });
  await page.clock.install();
  await page.evaluate(() => window.ZDWA_PUSH_OPT_IN_PROMPT.refresh());
  await page.clock.runFor(2_000);
  expect(state.claims).toEqual([]);
  expect(state.checks).toEqual([]);
  expect(state.writes).toEqual([]);
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.evaluate(() => window.reminderPermissionRequests)).toBe(0);
});

test("the server cooldown keeps an eligible missing Hausdepp device quiet", async ({ page }) => {
  const state = await fixture(page, { show: false });
  await expect.poll(() => state.claims.length).toBe(1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(state.writes).toEqual([]);
  expect(await page.evaluate(() => window.reminderPermissionRequests)).toBe(0);
});

for (const blocker of ["install hint", "modal", "hidden page"]) {
  test(`a claimed Hausdepp reminder survives a ${blocker} appearing while its response is pending`, async ({ page }) => {
    const state = await fixture(page, { holdClaim: true });
    await expect.poll(state.hasHeldClaim).toBe(true);
    await page.clock.install();
    await page.evaluate(kind => {
      if (kind === "install hint") {
        const hint = document.createElement("aside");
        hint.dataset.pwaInstallHint = "true";
        hint.textContent = "Labelled transient install hint";
        document.body.append(hint);
      } else if (kind === "modal") {
        void window.ZDWA_UI.dialog({
          id: "reminder-transient-modal", title: "Transient fixture dialog",
          actions: [{ id: "close", label: "Close fixture dialog" }],
        });
      } else {
        // A visibility capability fixture keeps the real page and prompt
        // controller alive, modelling a tab hidden after its claim was sent.
        window.reminderPageHidden = true;
        Object.defineProperty(document, "hidden", { configurable: true, get: () => window.reminderPageHidden });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.reminderPageHidden ? "hidden" : "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      }
    }, blocker);
    await state.resolveClaim();
    await page.clock.runFor(2_400);
    const reminder = page.getByRole("dialog", { name: "Lust auf eine Runde?" });
    await expect(reminder).toBeHidden();
    expect(state.claims).toEqual([{ device_missing: true }]);

    if (blocker === "modal") {
      await page.getByRole("dialog", { name: "Transient fixture dialog" }).getByRole("button", { name: "Close fixture dialog" }).click();
    } else {
      await page.evaluate(kind => {
        if (kind === "install hint") document.querySelector("[data-pwa-install-hint]").remove();
        else {
          window.reminderPageHidden = false;
          document.dispatchEvent(new Event("visibilitychange"));
        }
      }, blocker);
    }
    await expectDialogWithClock(page, reminder);
    expect(state.claims).toEqual([{ device_missing: true }]);
    expect(state.writes).toEqual([]);
    expect(await page.evaluate(() => window.reminderPermissionRequests)).toBe(0);
  });
}
