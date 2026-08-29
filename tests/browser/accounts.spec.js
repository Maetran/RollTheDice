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
  await page.goto("/");
  await expect(page.locator("#onlineUsers")).toContainText(/[1-9]\d* Nutzer online/);
  await page.goto("/spieler");
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


test("mobile quick entry is opt-in for new accounts and writes the next ordered field", async ({ page }) => {
  await page.setViewportSize({ width: 472, height: 1024 });
  await page.goto("/");
  await page.fill("#loginUsername", "Admin");
  await page.fill("#loginPassword", "temporary-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("Admin");

  await page.goto("/konto#settings");
  const preference = page.locator('input[name="mobileRowQuickEntry"]');
  await expect(preference).not.toBeChecked();
  await preference.check();
  await page.click("#preferencesForm button");
  await expect(page.locator("#preferencesMessage")).toHaveText("Spieleinstellungen gespeichert.");

  const gameId = await page.evaluate(async () => {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Mobile quick entry", mode: 1 }),
    });
    return (await response.json()).game_id;
  });
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=ignored`);

  const quickActions = page.locator("#mobileRowQuickActions");
  await expect(quickActions).toBeVisible({ timeout: 6000 });
  const downButton = page.locator('[data-quick-field="down"]');
  await expect(downButton).toBeEnabled();
  await downButton.click();
  if (await page.locator("#appDialogBackdrop:not([hidden])").isVisible()) {
    await expect(page.locator("#appDialog")).toContainText("0 Punkte");
    await page.click('[data-dialog-action="confirm"]');
  }
  await expect(page.locator('.player-card.me td[data-row="0"][data-field="down"]')).not.toBeEmpty();

  const layout = await page.evaluate(() => {
    const bar = document.querySelector("#diceBar").getBoundingClientRect();
    const actions = document.querySelector(".dice-actions").getBoundingClientRect();
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const chat = document.querySelector("#chatToggle").getBoundingClientRect();
    const dice = Array.from(document.querySelectorAll("#diceBar .die")).map(die => die.getBoundingClientRect());
    const quickButtons = Array.from(document.querySelectorAll(".mobile-row-quick-button"))
      .map(button => button.getBoundingClientRect());
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      barRight: bar.right,
      barWidth: bar.width,
      actionsRight: actions.right,
      actionsWidth: actions.width,
      actionsTop: actions.top,
      actionsBottom: actions.bottom,
      topbarBottom: topbar.bottom,
      chatTop: chat.top,
      diceSpan: dice.at(-1).right - dice[0].left,
      dieWidth: dice[0].width,
      diceTop: dice[0].top,
      diceLeft: dice[0].left,
      diceRight: dice.at(-1).right,
      diceBottom: dice[0].bottom,
      quickButtons: quickButtons.map(rect => ({
        top: rect.top, bottom: rect.bottom, right: rect.right, height: rect.height,
      })),
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.barRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.barWidth).toBeGreaterThanOrEqual(layout.viewportWidth - 36);
  expect(layout.actionsRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.actionsTop).toBeGreaterThanOrEqual(layout.diceBottom);
  expect(Math.abs(layout.quickButtons[0].top - layout.diceTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.quickButtons[0].height - layout.quickButtons[1].height)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.quickButtons[1].bottom - layout.actionsBottom)).toBeLessThanOrEqual(1);
  expect(layout.diceLeft).toBeGreaterThanOrEqual(layout.actionsRight - layout.actionsWidth - 1);
  expect(layout.diceRight).toBeLessThanOrEqual(layout.actionsRight + 1);
  expect(layout.diceLeft - layout.quickButtons[0].right).toBeGreaterThanOrEqual(9);
  expect(layout.dieWidth).toBeGreaterThanOrEqual(58);
  expect(layout.topbarBottom).toBeLessThanOrEqual(layout.chatTop - 5);

  await page.click("#backToLobbyBtn");
  await expect(page.locator("#leaveGameDialog")).toBeVisible();
  await page.click("#leaveAbortBtn");
  await expect(page.locator("#appDialog")).toContainText("Spiel abgebrochen");
  await page.click('[data-dialog-action="ok"]');
  await page.waitForURL("/");
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


test("lobby game choices stay synchronized with the existing creation form", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Schnell spielen" })).toBeVisible();
  await expect(page.getByText("Du kannst ohne Konto spielen.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "1 Spieler, Solo" })).toBeChecked();
  await expect(page.locator("#gameMode")).toHaveValue("1");
  await expect(page.getByRole("radio", { name: "Normal" })).toBeChecked();
  await expect(page.locator("#hardcoreChk")).not.toBeChecked();
  await expect(page.locator("#hardcoreHelp")).toBeHidden();

  await page.getByRole("radio", { name: "3 Spieler" }).click();
  await expect(page.locator("#gameMode")).toHaveValue("3");
  await expect(page.getByRole("radio", { name: "3 Spieler" })).toBeChecked();

  await page.getByRole("radio", { name: "3 Spieler" }).press("ArrowRight");
  await expect(page.locator("#gameMode")).toHaveValue("2v2");
  await expect(page.getByRole("radio", { name: "2 gegen 2" })).toBeFocused();

  await page.getByRole("radio", { name: "Hardcore" }).click();
  await expect(page.locator("#hardcoreChk")).toBeChecked();
  await expect(page.getByRole("radio", { name: "Hardcore" })).toBeChecked();
  await expect(page.locator("#hardcoreHelp")).toBeVisible();
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
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /\/manifest-en\.webmanifest\?v=[a-f0-9]{12}$/);
  await expect(page.getByRole("link", { name: "Players & Ranking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New Game" })).toBeVisible();
  await expect(page.getByPlaceholder("Your name")).toBeVisible();
  await expectNoGermanUi(page);

  await page.goto("/regeln");
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
  await page.goto("/konto#settings");
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

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin Area" })).toBeVisible();
  await expectNoGermanUi(page);
  for (const panel of ["usersPanel", "assignmentsPanel", "completedGamesPanel"]) {
    await page.locator(`[data-admin-panel="${panel}"]`).click();
    await expect(page.locator(`#${panel}`)).toBeVisible();
    await expectNoGermanUi(page);
  }

  await page.goto("/spieler");
  await expect(page.getByRole("heading", { name: "Find Players" })).toBeVisible();
  await expectNoGermanUi(page);

  await page.goto("/spieler/Admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expectNoGermanUi(page);

  await page.goto("/ergebnis");
  await expect(page.getByText("No game specified.", { exact: true })).toBeVisible();
  await expectNoGermanUi(page);

  const gameId = await page.evaluate(async () => {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "English UI", mode: 1 }),
    });
    return (await response.json()).game_id;
  });
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=ignored`);
  await expect(page.locator("#rollBtnInline")).toContainText("Roll", { timeout: 6000 });
  await expect(page.locator("#announceBtnInline")).toContainText("Announce");
  await expect(page.locator(".turn-status-text")).toContainText("Turn:");
  await expectNoGermanUi(page);

  await page.goto("/konto#settings");
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
  await page.waitForURL(/\/admin$/);
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

  await page.goto("/spieler/RegisteredSmoke");
  await expect(page.getByRole("heading", { name: "RegisteredSmoke" })).toBeVisible();
  await expect(page.locator(".stat-bucket")).toHaveCount(3);
  await expect(page.locator(".stat-bucket").first()).toContainText("Spiele");
  await expect(page.locator(".stat-bucket").first()).not.toContainText("Maximum");
  await expect(page.locator(".stat-bucket").nth(1)).toContainText("Maximum");
  await expect(page.locator(".stat-bucket").nth(1)).toContainText("Trend (3 Spiele)");
});

test("superadmin can make a neutral extra roll and set a die", async ({ page }) => {
  await page.goto("/");
  await page.fill("#loginUsername", "Admin");
  await page.fill("#loginPassword", "temporary-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("Admin");

  const gameId = await page.evaluate(async () => {
    const response = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Admin dice edit", mode: 1 }),
    });
    return (await response.json()).game_id;
  });
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=ignored`);
  await expect(page.locator(".turn-status-text")).toContainText("Würfe: 1/", { timeout: 6000 });

  const dice = page.locator("#diceBar .die");
  await dice.nth(0).click();
  const heldFace = await dice.nth(0).locator("svg").getAttribute("aria-label");
  const rollsBefore = await page.locator(".turn-status-text").textContent();

  for (let i = 0; i < 10; i += 1) await page.locator(".pc-total").click();
  await expect(page.locator("#superadminBar")).toBeVisible();
  await page.locator("#superadminRoll").click();
  await expect(dice.nth(0).locator("svg")).toHaveAttribute("aria-label", heldFace);
  await expect(page.locator(".turn-status-text")).toHaveText(rollsBefore);

  page.once("dialog", dialog => dialog.accept("5"));
  await dice.nth(4).click();
  await expect(dice.nth(4).locator("svg")).toHaveAttribute("aria-label", "Würfel 5");
  await expect(page.locator(".turn-status-text")).toHaveText(rollsBefore);
});


test("logged-in user sees the personal landing page", async ({ page }) => {
  await page.goto("/");
  await page.fill("#loginUsername", "RegisteredSmoke");
  await page.fill("#loginPassword", "registered-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");

  await page.getByRole("link", { name: "Mein Konto" }).click();
  await page.waitForURL(/\/konto(?:#|$)/);
  await expect(page.getByRole("heading", { name: "RegisteredSmoke" })).toBeVisible();
  await page.getByRole("tab", { name: "Statistik" }).click();
  await expect(page.getByRole("tab", { name: "Statistik" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Statistiken" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deine letzten Spiele" })).toBeVisible();
  await expect(page.locator("[data-history-limit]")).toHaveCount(4);
  await expect(page.locator("#historyChart svg, #historyChart .muted")).toBeVisible();
  await expect(page.locator(".stat-bucket")).toHaveCount(3);
  await expect(page.locator(".stat-bucket").first()).not.toContainText("Durchschnitt");
  await expect(page.locator(".stat-bucket").nth(2)).toContainText("Durchschnitt");
  await expect(page.locator(".stat-bucket").nth(2)).toContainText("Trend (3 Spiele)");
  await page.getByRole("tab", { name: "Einstellungen" }).click();
  await expect(page.getByRole("heading", { name: "Spieleinstellungen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passwort ändern" })).toBeVisible();
});


test("account history keeps Normal and Hardcore in separate chart datasets", async ({ page }) => {
  await page.goto("/");
  await page.fill("#loginUsername", "RegisteredSmoke");
  await page.fill("#loginPassword", "registered-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");

  const games = [
    { game_id: "normal-new", finished_at: "2026-08-28T12:00:00Z", mode: "1", hardcore: false, points: 1200 },
    { game_id: "hardcore-new", finished_at: "2026-08-27T12:00:00Z", mode: "1", hardcore: true, points: 500 },
    { game_id: "normal-old", finished_at: "2026-08-26T12:00:00Z", mode: "1", hardcore: false, points: 900 },
    { game_id: "hardcore-old", finished_at: "2026-08-25T12:00:00Z", mode: "1", hardcore: true, points: 400 },
  ];
  await page.addInitScript(({ historyGames }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.origin);
      if (url.pathname !== "/api/users/me/game-history") return nativeFetch(input, init);
      const mode = url.searchParams.get("mode") || "normal";
      const selected = mode === "all"
        ? historyGames
        : historyGames.filter(game => game.hardcore === (mode === "hardcore"));
      const modeSummary = hardcore => {
        const points = selected.filter(game => game.hardcore === hardcore).map(game => game.points).sort((a, b) => a - b);
        const middle = Math.floor(points.length / 2);
        const median = points.length ? (points.length % 2 ? points[middle] : (points[middle - 1] + points[middle]) / 2) : null;
        return { games: points.length, median_points: median, average_points: points.length ? points.reduce((a, b) => a + b, 0) / points.length : null };
      };
      return new Response(JSON.stringify({
        games: selected,
        selection: url.searchParams.get("limit") || "10",
        mode,
        summary: {
          games: selected.length,
          points_total: selected.reduce((sum, game) => sum + game.points, 0),
          normal: modeSummary(false),
          hardcore: modeSummary(true),
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  }, { historyGames: games });

  await page.goto("/konto#statistics");
  await page.getByRole("tab", { name: "Statistik" }).click();
  await expect(page.locator('[data-history-mode="normal"]')).toHaveClass(/active/);
  await expect(page.locator('[data-history-point="normal"]')).toHaveCount(2);
  await expect(page.locator('[data-history-point="hardcore"]')).toHaveCount(0);

  await page.locator('[data-history-mode="hardcore"]').click();
  await expect(page.locator('[data-history-point="hardcore"]')).toHaveCount(2);
  await expect(page.locator('[data-history-point="normal"]')).toHaveCount(0);

  await page.locator('[data-history-mode="all"]').click();
  await expect(page.locator('[data-history-point="normal"]')).toHaveCount(2);
  await expect(page.locator('[data-history-point="hardcore"]')).toHaveCount(2);
  await expect(page.locator('[data-history-dataset="normal"]')).toHaveCount(1);
  await expect(page.locator('[data-history-dataset="hardcore"]')).toHaveCount(1);
  await expect(page.locator(".history-median-line")).toHaveCount(0);
  await expect(page.locator("#recentGames .history-mode-badge.normal")).toHaveCount(2);
  await expect(page.locator("#recentGames .history-mode-badge.hardcore")).toHaveCount(2);
});


test("account gameplay preferences persist and control announce behavior", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.fill("#loginUsername", "RegisteredSmoke");
  await page.fill("#loginPassword", "registered-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("RegisteredSmoke");

  await page.goto("/konto#settings");
  await expect(page.locator('input[name="announceSelectionMode"][value="overlay"]')).toBeChecked();
  await expect(page.locator('input[name="autoWriteAnnounced"][value="true"]')).toBeChecked();
  await expect(page.locator('input[name="hapticFeedback"]')).not.toBeChecked();
  await expect(page.locator('input[name="keepScreenAwake"]')).not.toBeChecked();
  await page.check('input[name="announceSelectionMode"][value="table"]');
  await page.check('input[name="autoWriteAnnounced"][value="false"]');
  await page.check('input[name="hapticFeedback"]');
  await page.check('input[name="keepScreenAwake"]');
  await page.click("#preferencesForm button");
  await expect(page.locator("#preferencesMessage")).toHaveText("Spieleinstellungen gespeichert.");
  await page.reload();
  await expect(page.locator('input[name="announceSelectionMode"][value="table"]')).toBeChecked();
  await expect(page.locator('input[name="autoWriteAnnounced"][value="false"]')).toBeChecked();
  await expect(page.locator('input[name="hapticFeedback"]')).toBeChecked();
  await expect(page.locator('input[name="keepScreenAwake"]')).toBeChecked();

  const gameId = await page.evaluate(async () => {
    const response = await fetch('/api/games', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Preference behavior', mode: 1 }),
    });
    return (await response.json()).game_id;
  });
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=ignored`);
  await expect(page.locator("#announceBtnInline")).toBeEnabled({ timeout: 6000 });
  await page.locator("#announceBtnInline").click();
  await expect(page.locator("#mobileAnnouncePicker")).toBeHidden();
  await expect(page.locator(".player-card.me td.announce-pickable")).toHaveCount(12);

  const pokerAnnounced = page.locator('.player-card.me td.cell[data-row="14"][data-field="ang"]');
  await pokerAnnounced.click();
  await expect(page.locator("#announceBtnInline")).toContainText("Ansage aufheben");
  const announceLayout = await page.locator("#announceBtnInline").evaluate(button => ({
    clientHeight: button.clientHeight,
    scrollHeight: button.scrollHeight,
    clientWidth: button.clientWidth,
    scrollWidth: button.scrollWidth,
  }));
  expect(announceLayout.scrollHeight).toBeLessThanOrEqual(announceLayout.clientHeight + 1);
  expect(announceLayout.scrollWidth).toBeLessThanOrEqual(announceLayout.clientWidth + 1);
  const rollButton = page.locator("#rollBtnInline");
  await rollButton.click();
  await expect(rollButton).toBeEnabled();
  await rollButton.click();
  await expect(rollButton).toBeDisabled();
  await page.waitForTimeout(1300);
  await expect(pokerAnnounced).toHaveText("");

  await page.goto("/konto#settings");
  await page.check('input[name="announceSelectionMode"][value="overlay"]');
  await page.check('input[name="autoWriteAnnounced"][value="true"]');
  await page.uncheck('input[name="hapticFeedback"]');
  await page.uncheck('input[name="keepScreenAwake"]');
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
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=ignored`);
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
  await secondPage.waitForURL(/\/spiel\//);
  await expect(secondPage.locator(".player-card", { hasText: "RegisteredSmoke" })).toBeVisible();
  await secondContext.close();
});
