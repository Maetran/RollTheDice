const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

async function signIn(page) {
  const admin = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
  expect(admin.ok()).toBeTruthy();
  const adminUser = (await admin.json()).user;
  for (const [username, role] of [["Mani", "admin"], ["ListFriend", "user"], ["ListFriendTwo", "user"]]) {
    const result = await page.request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": adminUser.csrf_token },
      data: { username, temporary_password: "mani-preview-password-123", role },
    });
    expect([201, 400]).toContain(result.status());
  }
  await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": adminUser.csrf_token } });
  const login = await page.request.post("/api/auth/login", { data: { username: "Mani", password: "mani-preview-password-123" } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const friends = await Promise.all(["ListFriend", "ListFriendTwo"].map(async username => (await (await page.request.get(`/api/players/${username}`)).json()).player));
  for (const friend of friends) await page.request.delete(`/api/web-push/allowlist/${friend.id}`, {
    headers: { "X-CSRF-Token": user.csrf_token }, data: { viewer_id: user.id },
  });
  await page.request.put("/api/web-push/allowlist", { headers: { "X-CSRF-Token": user.csrf_token }, data: { viewer_id: user.id, audience: "all" } });
  return { user, friend: friends[0], second: friends[1] };
}

for (const product of [
  { name: "ZDWA", profile: "/spieler/ListFriend", own: "/spieler/Mani", account: "/konto#settings", other: "/zilch/spieler/ListFriend" },
  { name: "Zilch", profile: "/zilch/spieler/ListFriend", own: "/zilch/spieler/Mani", account: "/zilch/konto#settings", other: "/spieler/ListFriend" },
]) {
  test(`${product.name} profile adds a fixed account and settings remove individually without enabling push`, async ({ page }, testInfo) => {
    const { user, friend, second } = await signIn(page);
    const before = await (await page.request.get("/api/web-push/subscription")).json();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(product.profile);
    const add = page.getByRole("button", { name: "Zur Spielerauswahl hinzufügen", exact: true });
    await expect(add).toHaveAttribute("aria-pressed", "false");
    await add.click();
    await expect(page.getByRole("button", { name: "Aus Spielerauswahl entfernen", exact: true })).toHaveAttribute("aria-pressed", "true");
    let selection = await (await page.request.get("/api/web-push/allowlist")).json();
    expect(selection.players).toContainEqual({ id: friend.id, username: "ListFriend", active: true });
    expect(selection.audience).toBe("all");
    const after = await (await page.request.get("/api/web-push/subscription")).json();
    for (const key of ["subscribed", "game_invites_enabled", "daily_reminder_enabled", "release_notifications_enabled"]) expect(after[key]).toBe(before[key]);
    await page.locator(".player-allowlist").screenshot({ path: testInfo.outputPath("profile-action-mobile.png") });
    await page.goto(product.other);
    await expect(page.getByRole("button", { name: "Aus Spielerauswahl entfernen", exact: true })).toBeVisible();
    await page.goto(product.account);
    const settings = page.locator("[data-allowlist-settings]");
    await expect(settings.getByRole("link", { name: "ListFriend", exact: true })).toBeVisible();
    await expect(settings.locator("textarea")).toHaveCount(0);
    await settings.getByLabel("Einladungen akzeptieren von").selectOption("allowlist");
    // Another tab adds a player while this page still has the older list.
    await page.request.put(`/api/web-push/allowlist/${second.id}`, {
      headers: { "X-CSRF-Token": user.csrf_token }, data: { viewer_id: user.id },
    });
    await settings.getByRole("button", { name: "Einladungsauswahl speichern" }).click();
    await expect(settings.getByRole("link", { name: "ListFriendTwo", exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "ListFriend aus Spielerauswahl entfernen", exact: true }).click();
    await expect(settings.getByRole("link", { name: "ListFriend", exact: true })).toHaveCount(0);
    await expect(settings.getByRole("link", { name: "ListFriendTwo", exact: true })).toBeVisible();
    selection = await (await page.request.get("/api/web-push/allowlist")).json();
    expect(selection.audience).toBe("allowlist");
    expect(selection.players.some(player => player.id === second.id)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await settings.screenshot({ path: testInfo.outputPath("selection-settings-mobile.png") });
  });

  test(`${product.name} self profiles have no add action and failed writes stay retryable`, async ({ page }) => {
    const { friend } = await signIn(page);
    await page.goto(product.own);
    await expect(page.locator(".player-allowlist")).toBeHidden();
    await expect(page.getByRole("button", { name: "Zur Spielerauswahl hinzufügen", exact: true })).toHaveCount(0);
    await page.goto(product.profile);
    await page.route(`**/api/web-push/allowlist/${friend.id}`, route => route.fulfill({ status: 409, json: { detail: "push_allowlist_limit" } }));
    const add = page.getByRole("button", { name: "Zur Spielerauswahl hinzufügen", exact: true });
    await add.click();
    await expect(page.locator(".player-allowlist-message")).toHaveText("Du kannst höchstens 100 Spieler auswählen.");
    await expect(add).toBeEnabled();
    await page.unroute(`**/api/web-push/allowlist/${friend.id}`);
    await add.click();
    await expect(page.getByRole("button", { name: "Aus Spielerauswahl entfernen", exact: true })).toBeVisible();
  });

  test(`${product.name} player selection is translated into English`, async ({ page }) => {
    await signIn(page);
    const auth = await (await page.request.get("/api/auth/me")).json();
    await page.route("**/api/auth/me", route => route.fulfill({ json: { ...auth,
      user: { ...auth.user, preferences: { ...auth.user.preferences, preferred_language: "en" } },
    } }));
    await page.goto(product.profile);
    await page.getByRole("button", { name: "Add to player selection", exact: true }).click();
    await expect(page.locator(".player-allowlist-message")).toHaveText("Player selection saved.");
    await page.goto(product.account);
    await expect(page.getByRole("heading", { name: "Your player selection", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove ListFriend from player selection", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save invitation selection", exact: true })).toBeVisible();
    await expect(page.locator(".player-allowlist-hint")).toContainText("This does not enable push.");
  });
}

test("guests can open a public profile but must sign in to add a player", async ({ page }) => {
  await page.goto("/spieler/Admin");
  await expect(page.locator(".player-allowlist-message")).toHaveText("Bitte melde dich an, um deine Spielerauswahl zu verwalten.");
  await expect(page.locator(".player-allowlist").getByRole("link", { name: "Anmelden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zur Spielerauswahl hinzufügen", exact: true })).toHaveCount(0);
});

test("logout discards an older in-flight list response instead of showing another account's selection", async ({ page }) => {
  const { user, friend } = await signIn(page);
  let releaseOldResponse;
  let delayed = false;
  await page.route("**/api/web-push/allowlist", async route => {
    if (!delayed) {
      delayed = true;
      await new Promise(resolve => { releaseOldResponse = resolve; });
      return route.fulfill({ json: { viewer_id: user.id, audience: "all", limit: 100,
        players: [{ id: friend.id, username: "ListFriend", active: true }],
      } });
    }
    return route.fulfill({ status: 401, json: { detail: "authentication_required" } });
  });
  await page.goto("/spieler/ListFriend");
  await expect.poll(() => Boolean(releaseOldResponse)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: { authenticated: false, user: null } })));
  const message = page.locator(".player-allowlist-message");
  await expect(message).toHaveText("Bitte melde dich an, um deine Spielerauswahl zu verwalten.");
  const response = page.waitForResponse(result => result.url().endsWith("/api/web-push/allowlist") && result.status() === 200);
  releaseOldResponse();
  await response;
  await expect(message).toHaveText("Bitte melde dich an, um deine Spielerauswahl zu verwalten.");
  await expect(page.locator(".player-allowlist button")).toHaveCount(0);
});
