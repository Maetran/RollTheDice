const { test, expect } = require("@playwright/test");


test("public player search and ranking are available to guests", async ({ page }) => {
  await page.goto("/static/players.html");
  await expect(page.getByRole("heading", { name: "Spieler suchen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spieler-Ranking" })).toBeVisible();
  await expect(page.locator("#rankingNormal")).toHaveClass(/active/);
  await page.locator("#rankingHardcore").click();
  await expect(page.locator("#rankingHardcore")).toHaveClass(/active/);
  await expect(page.locator("#rankingBody tr").first()).toBeVisible();
});


test("guest sees login and registration while a new account sees only logout", async ({ page }) => {
  const username = `SelfRegistered${Date.now()}`;
  await page.goto("/");
  await expect(page.locator("#loginForm")).toBeVisible();
  await expect(page.locator("#registerBtn")).toBeVisible();
  await expect(page.locator("#authActions")).toBeHidden();

  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", "self-register-password-123");
  await page.click("#registerBtn");
  await expect(page.locator("#authBadge")).toContainText(username);
  await expect(page.locator("#loginForm")).toBeHidden();
  await expect(page.locator("#logoutBtn")).toBeVisible();
});


test("admin can log in, create a user and open the public profile", async ({ page }) => {
  await page.goto("/");
  await page.fill("#loginUsername", "Admin");
  await page.fill("#loginPassword", "temporary-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await expect(page.locator("#playerName")).toBeDisabled();

  await page.click("#adminLink");
  await page.waitForURL(/admin\.html/);
  await expect(page.getByRole("heading", { name: "Benutzerverwaltung" })).toBeVisible();

  const existing = page.locator("#usersBody tr", { hasText: "RegisteredSmoke" });
  if (await existing.count() === 0) {
    await page.fill("#newUsername", "RegisteredSmoke");
    await page.fill("#newPassword", "registered-password-123");
    await page.selectOption("#newRole", "user");
    await page.click("#createUserForm button");
  }
  await expect(page.locator("#usersBody tr", { hasText: "RegisteredSmoke" })).toBeVisible();

  await page.goto("/static/profile.html?user=RegisteredSmoke");
  await expect(page.getByRole("heading", { name: "RegisteredSmoke" })).toBeVisible();
  await expect(page.locator(".stat-bucket")).toHaveCount(3);
  await expect(page.locator(".stat-bucket").first()).toContainText("Spiele");
  await expect(page.locator(".stat-bucket").first()).not.toContainText("Maximum");
  await expect(page.locator(".stat-bucket").nth(1)).toContainText("Maximum");
});


test("logged-in user sees the personal landing page", async ({ page }) => {
  await page.goto("/");
  await page.fill("#loginUsername", "RegisteredSmoke");
  await page.fill("#loginPassword", "registered-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");

  await page.getByRole("link", { name: "Meine Statistiken" }).click();
  await page.waitForURL(/account\.html/);
  await expect(page.getByRole("heading", { name: "RegisteredSmoke" })).toBeVisible();
  await expect(page.locator(".stat-bucket")).toHaveCount(3);
  await expect(page.locator(".stat-bucket").first()).not.toContainText("Durchschnitt");
  await expect(page.locator(".stat-bucket").nth(2)).toContainText("Durchschnitt");
  await expect(page.getByRole("heading", { name: "Passwort ändern" })).toBeVisible();
});


test("logged-in player can resume on another browser without a local token", async ({ page, browser }) => {
  await page.goto("/");
  await page.fill("#loginUsername", "RegisteredSmoke");
  await page.fill("#loginPassword", "registered-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");
  await page.reload();
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");
  const gameId = await page.evaluate(async () => {
    const response = await fetch('/api/games', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Account resume', mode: 1 }),
    });
    return (await response.json()).game_id;
  });
  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=ignored`);
  await expect(page.locator(".player-card", { hasText: "RegisteredSmoke" })).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto("/");
  await secondPage.fill("#loginUsername", "RegisteredSmoke");
  await secondPage.fill("#loginPassword", "registered-password-123");
  await secondPage.click("#loginForm button[type=submit]");
  await expect(secondPage.locator("#authBadge")).toContainText("RegisteredSmoke");
  const resume = secondPage.locator(`.resumeBtn[data-id="${gameId}"]`);
  await expect(resume).toBeVisible({ timeout: 6000 });
  await resume.click();
  await secondPage.waitForURL(/room\.html/);
  await expect(secondPage.locator(".player-card", { hasText: "RegisteredSmoke" })).toBeVisible();
  await secondContext.close();
});
