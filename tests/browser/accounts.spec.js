const { test, expect } = require("@playwright/test");


async function expectNoGermanUi(page) {
  const leftovers = await page.evaluate(() => {
    const pattern = /\b(Spielanleitung|Spielregeln|Spieler|Spiele|Spiel|Würfel|Würfe|Ansage|Felder|Feld|Punkte|Summe|Zurück|Laden|Keine|Noch|Durchschnitt|Abwärts|Aufwärts|Freireihe|Angesagt|Wertung|Hinweis|Beitreten|Zuschauen|Suchen|Benutzer|Passwort|Änderungen?)\b/i;
    const values = [document.title, document.body.innerText];
    for (const element of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
      values.push(element.getAttribute("placeholder") || "");
      values.push(element.getAttribute("title") || "");
      values.push(element.getAttribute("aria-label") || "");
    }
    return values.flatMap(value => String(value).split("\n")).map(value => value.trim()).filter(value => pattern.test(value));
  });
  expect(leftovers).toEqual([]);
}


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
  await expect(page.locator("#playerSectionTitle")).toBeHidden();
  await expect(page.locator("#playerNameRow")).toBeHidden();
  await expect(page.locator("#playerSetupCard")).toHaveClass(/authenticated/);
  await expect(page.locator("#logoutBtn")).toBeVisible();
  expect(await page.locator("#playerSetupCard").evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(120);
});


test("mobile lobby cards and leaderboard tabs stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await page.goto("/");
  await expect(page.locator(".avg-label")).toHaveText("⌀ Punkte");
  await page.locator("#lbTabLast").click();

  const layout = await page.evaluate(() => {
    const right = selector => document.querySelector(selector).getBoundingClientRect().right;
    return {
      viewportWidth: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      cardRights: Array.from(document.querySelectorAll(".card")).map(card => card.getBoundingClientRect().right),
      lastTabRight: right("#lbTabLast"),
      recentBoxRight: right("#recentBox"),
    };
  });

  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  for (const right of layout.cardRights) expect(right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.lastTabRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.recentBoxRight).toBeLessThanOrEqual(layout.viewportWidth);
});


test("tablet new-game controls stay inside their card", async ({ page }) => {
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const layout = await page.evaluate(() => {
      const card = document.querySelector(".setup-grid .setup-card:nth-child(2)").getBoundingClientRect();
      const row = document.querySelector(".create-row").getBoundingClientRect();
      const input = document.querySelector("#passInput").getBoundingClientRect();
      const controls = ["#passInput", ".mode-hardcore-row", ".mode-hardcore-row .toggle-row", "#createBtn"]
        .map(selector => document.querySelector(selector).getBoundingClientRect());
      return {
        cardRight: card.right,
        rowWidth: row.width,
        inputWidth: input.width,
        controlRights: controls.map(control => control.right),
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.inputWidth).toBeGreaterThan(layout.rowWidth - 1);
    for (const right of layout.controlRights) expect(right).toBeLessThanOrEqual(layout.cardRight);
  }
});


test("English localization covers lobby, rules, account preference and game UI", async ({ page }) => {
  await page.goto("/");
  await Promise.all([
    page.waitForNavigation(),
    page.selectOption("[data-language-switcher]", "en"),
  ]);

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest-en.webmanifest?v=1");
  await expect(page.getByRole("link", { name: "Players & Ranking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New Game" })).toBeVisible();
  await expect(page.getByPlaceholder("Your name")).toBeVisible();
  await expectNoGermanUi(page);

  await page.goto("/static/rules.html");
  await expect(page.getByRole("heading", { name: "Game Rules" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn Sequence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fields & Scoring" })).toBeVisible();
  await expect(page.locator("table")).toContainText("FH");
  await expect(page.locator("table")).toContainText("UT + D + LT");
  await expectNoGermanUi(page);

  await page.goto("/");
  await page.fill("#loginUsername", "Admin");
  await page.fill("#loginPassword", "temporary-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await page.goto("/static/account.html");
  await page.check('input[name="preferredLanguage"][value="en"]');
  await page.click("#preferencesForm button");
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "Game Settings" })).toBeVisible();
  await expect(page.locator('input[name="preferredLanguage"][value="en"]')).toBeChecked();
  await expect(page.getByText("Preferred language", { exact: true })).toBeVisible();
  await expectNoGermanUi(page);

  const preferredLanguage = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    return (await response.json()).user.preferences.preferred_language;
  });
  expect(preferredLanguage).toBe("en");

  await page.goto("/static/admin.html");
  await expect(page.getByRole("heading", { name: "Admin Area" })).toBeVisible();
  await expectNoGermanUi(page);
  for (const panel of ["usersPanel", "assignmentsPanel", "completedGamesPanel"]) {
    await page.locator(`[data-admin-panel="${panel}"]`).click();
    await expect(page.locator(`#${panel}`)).toBeVisible();
    await expectNoGermanUi(page);
  }

  await page.goto("/static/players.html");
  await expect(page.getByRole("heading", { name: "Find Players" })).toBeVisible();
  await expectNoGermanUi(page);

  await page.goto("/static/profile.html?user=Admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expectNoGermanUi(page);

  await page.goto("/static/game_view.html");
  await expect(page.getByText("No game specified (?id=...)", { exact: true })).toBeVisible();
  await expectNoGermanUi(page);

  const gameId = await page.evaluate(async () => {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "English UI", mode: 1 }),
    });
    return (await response.json()).game_id;
  });
  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=ignored`);
  await expect(page.locator("#rollBtnInline")).toContainText("Roll", { timeout: 6000 });
  await expect(page.locator("#announceBtnInline")).toContainText("Announce");
  await expect(page.locator(".turn-status-text")).toContainText("Turn:");
  await expectNoGermanUi(page);

  await page.goto("/static/account.html");
  await page.check('input[name="preferredLanguage"][value="de"]');
  await page.click("#preferencesForm button");
  await expect(page.locator("html")).toHaveAttribute("lang", "de", { timeout: 3000 });
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
  await expect(page.getByRole("heading", { name: "Adminbereich" })).toBeVisible();
  await expect(page.locator(".admin-module-tile")).toHaveCount(3);
  await expect(page.locator("#usersPanel")).toBeHidden();
  await expect(page.locator("#completedGamesPanel")).toBeHidden();

  await page.locator('[data-admin-panel="usersPanel"]').click();
  await expect(page.getByRole("heading", { name: "Benutzerverwaltung" })).toBeVisible();
  await page.locator('[data-admin-panel="completedGamesPanel"]').click();
  await expect(page.getByRole("heading", { name: "Abgeschlossene Spiele löschen" })).toBeVisible();
  await expect(page.locator("#usersPanel")).toBeHidden();
  await page.locator('[data-admin-panel="usersPanel"]').click();

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
  await expect(page.locator(".stat-bucket").nth(1)).toContainText("Trend (3 Spiele)");
});


test("logged-in user sees the personal landing page", async ({ page }) => {
  await page.goto("/");
  await page.fill("#loginUsername", "RegisteredSmoke");
  await page.fill("#loginPassword", "registered-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");

  await page.getByRole("link", { name: "Mein Konto" }).click();
  await page.waitForURL(/account\.html/);
  await expect(page.getByRole("heading", { name: "RegisteredSmoke" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Statistiken" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spieleinstellungen" })).toBeVisible();
  await expect(page.locator(".stat-bucket")).toHaveCount(3);
  await expect(page.locator(".stat-bucket").first()).not.toContainText("Durchschnitt");
  await expect(page.locator(".stat-bucket").nth(2)).toContainText("Durchschnitt");
  await expect(page.locator(".stat-bucket").nth(2)).toContainText("Trend (3 Spiele)");
  await expect(page.getByRole("heading", { name: "Passwort ändern" })).toBeVisible();
});


test("account gameplay preferences persist and control announce behavior", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.fill("#loginUsername", "RegisteredSmoke");
  await page.fill("#loginPassword", "registered-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");

  await page.goto("/static/account.html");
  await expect(page.locator('input[name="announceSelectionMode"][value="overlay"]')).toBeChecked();
  await expect(page.locator('input[name="autoWriteAnnounced"][value="true"]')).toBeChecked();
  await page.check('input[name="announceSelectionMode"][value="table"]');
  await page.check('input[name="autoWriteAnnounced"][value="false"]');
  await page.click("#preferencesForm button");
  await expect(page.locator("#preferencesMessage")).toHaveText("Spieleinstellungen gespeichert.");
  await page.reload();
  await expect(page.locator('input[name="announceSelectionMode"][value="table"]')).toBeChecked();
  await expect(page.locator('input[name="autoWriteAnnounced"][value="false"]')).toBeChecked();

  const gameId = await page.evaluate(async () => {
    const response = await fetch('/api/games', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Preference behavior', mode: 1 }),
    });
    return (await response.json()).game_id;
  });
  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=ignored`);
  await expect(page.locator("#announceBtnInline")).toBeEnabled({ timeout: 6000 });
  await page.locator("#announceBtnInline").click();
  await expect(page.locator("#mobileAnnouncePicker")).toBeHidden();
  await expect(page.locator(".player-card.me td.announce-pickable")).toHaveCount(12);

  const pokerAnnounced = page.locator('.player-card.me td.cell[data-row="14"][data-field="ang"]');
  await pokerAnnounced.click();
  await expect(page.locator("#announceBtnInline")).toContainText("Ansage aufheben");
  const rollButton = page.locator("#rollBtnInline");
  await rollButton.click();
  await expect(rollButton).toBeEnabled();
  await rollButton.click();
  await expect(rollButton).toBeDisabled();
  await page.waitForTimeout(1300);
  await expect(pokerAnnounced).toHaveText("");

  await page.goto("/static/account.html");
  await page.check('input[name="announceSelectionMode"][value="overlay"]');
  await page.check('input[name="autoWriteAnnounced"][value="true"]');
  await page.click("#preferencesForm button");
  await expect(page.locator("#preferencesMessage")).toHaveText("Spieleinstellungen gespeichert.");
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
