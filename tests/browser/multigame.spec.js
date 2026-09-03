const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createManiAdmin(page) {
  return page.evaluate(async () => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({
        username: "Mani",
        temporary_password: "mani-preview-password-123",
        role: "admin",
      }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
}

test("Zilch is a separate, permission-gated app mode and its hotkey respects inputs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-game-switch]")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();

  // The bootstrap admin is deliberately not the allowed preview identity.
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await expect(page.locator("[data-game-switch]")).toBeHidden();
  const created = await createManiAdmin(page);
  expect(created.status).toBe(201);

  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  await expect(page.locator("#authBadge")).toContainText("Mani");
  const switchButton = page.locator("[data-game-switch]");
  await expect(switchButton).toBeVisible();

  // The default view is still the fully mounted ZDWA lobby until the explicit
  // switch is used; no Zilch root is present in that document.
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);

  await Promise.all([
    page.waitForURL(/\/zilch$/),
    switchButton.click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator("[data-zilch-root]")).toBeVisible();
  await expect(page.locator("#createGameCard")).toHaveCount(0);
  await expect(page.locator("#zilchCreateForm")).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/zilch\/spiel\/[^/]+$/),
    page.locator("#zilchCreateForm button[type=submit]").click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator(".zilch-die")).toHaveCount(6);
  await expect(page.locator("[data-zilch-board-id]")).toHaveCount(1);
  await expect(page.locator("[data-zilch-roll]")).toBeDisabled();
  await expect(page.locator("#createGameCard")).toHaveCount(0);

  // Alt+Shift+Z is intentionally ignored while typing into the Zilch chat.
  const gameUrl = page.url();
  await page.locator("#zilchChatInput").focus();
  await page.keyboard.press("Alt+Shift+Z");
  await expect.poll(() => page.url()).toBe(gameUrl);

  await page.evaluate(() => document.activeElement?.blur());
  await Promise.all([
    page.waitForURL(/\/$/),
    page.keyboard.press("Alt+Shift+Z"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
  await expect(page.locator("#createGameCard")).toBeVisible();

  // Returning to Zilch and logging out unmounts it and restores ZDWA.
  await page.locator("[data-game-switch]").click();
  await page.waitForURL(/\/zilch$/);
  await page.click("#zilchLogout");
  await page.waitForURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
  await expect(page.locator("#createGameCard")).toBeVisible();
  await expect(page.locator("[data-game-switch]")).toBeHidden();
});

test("direct Zilch URLs remain server-protected", async ({ page }) => {
  const response = await page.goto("/zilch");
  expect(response?.status()).toBe(401);
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
});
