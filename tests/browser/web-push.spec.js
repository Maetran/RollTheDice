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
  await page.route("**/api/web-push/subscription", async route => {
    const method = route.request().method();
    calls.push(method);
    if (method === "PUT") enabled = true;
    if (method === "DELETE") enabled = false;
    await route.fulfill({ json: { available, enabled, subscribed: enabled, public_key: "BA" + "A".repeat(85) } });
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
