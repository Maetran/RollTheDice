const { test, expect } = require("@playwright/test");
const { expectTextContrast } = require("./contrast");

test.use({ serviceWorkers: "block" });

const players = [
  { id: "p1", name: "Mani", user_id: 11, connected: true, avatar: { kind: "emoji", value: "🎲" } },
  { id: "p2", name: "Anna", user_id: 12, connected: false },
];
const running = {
  id: "compact-running", game_type: "zdwa", name: "1 Spieler · Mani", mode: "1", players: 1, expected: 1,
  started: true, started_at: "2026-09-20T10:00:00Z", my_player_id: "p1", player_statuses: [players[0]],
  progress: [{ ...players[0], filled: 7, of: 48, points: 123 }],
};
const waiting = {
  id: "compact-waiting", game_type: "zdwa", name: "Abendrunde", mode: "2", players: 1, expected: 2,
  started: false, player_statuses: [players[1]],
};
const leaderboard = {
  stats: { games_played: 42, average_points: { normal: { average_points: 543 }, hc: { average_points: 321 } } },
  abandonments: { recent: [{ rank: 1, user_id: 11, username: "Mani", count: 7 }], alltime: [{ rank: 1, user_id: 12, username: "Anna", count: 8 }] },
};

async function preferences(page, language, theme) {
  await page.addInitScript(({ language, theme }) => {
    localStorage.setItem("zdwa_language", language);
    localStorage.setItem("wuerfler_theme", theme);
    localStorage.setItem("zilch_theme", theme === "classic" ? "light" : theme);
  }, { language, theme });
}

async function expectFits(page, selector) {
  const result = await page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth, scroll: document.documentElement.scrollWidth };
  });
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(result.width + 1);
  expect(result.scroll).toBeLessThanOrEqual(result.width + 1);
}

for (const language of ["de", "en"]) {
  for (const width of [320, 440, 768]) {
    test(`ZDWA keeps games and controls compact (${language}, ${width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 956 });
      await preferences(page, language, "classic");
      await page.route("**/api/auth/me", route => route.fulfill({ json: {
        authenticated: true, user: { id: 11, username: "Mani", settings: {}, must_change_password: false },
        passkeys: { enabled: false }, registration: { email_enabled: false, turnstile_enabled: false },
      } }));
      await page.route("**/api/games", route => route.fulfill({ json: { games: [waiting, running], online_users: 3 } }));
      await page.route("**/api/leaderboard", route => route.fulfill({ json: leaderboard }));
      await page.goto("/");
      const hub = page.locator("#gamesHub");
      await expect(hub.locator(".game-row")).toHaveCount(2);
      await expect(hub.locator("#refreshBtn")).toHaveCount(1);
      await expect(hub.locator(".resumeBtn")).toBeVisible();
      await expect(hub.locator(".spectateBtn")).toHaveCount(2);
      await expect(page.locator("#gamesList .spectateBtn")).toBeVisible();
      await expect(page.locator("#runningList .spectateBtn")).toBeVisible();
      await expect(hub.locator(".joinBtn")).toBeVisible();
      const own = page.locator("#runningList .game-row");
      await expect(own.locator("a.player-name-label")).toHaveCount(1);
      await expect(own).toContainText("7/48");
      await expect(own).toContainText("123");
      await expect(own).not.toContainText("Modus:");
      expect((await own.boundingBox()).height).toBeLessThan(width <= 440 ? 185 : 150);
      await expect(page.locator(".lobby-header #onlineUsers")).toContainText("3");
      await expect(page.locator(".lobby-header #gamesPlayed")).toHaveText("42");
      for (const selector of ["#gamesHub", "#createGameCard", "#abandonmentLeaderboard", ".lobby-header"]) await expectFits(page, selector);
      await expect(page.locator("[data-game-mode]")).toHaveCount(4);
      await page.locator('[data-hardcore="true"]').click();
      await expect(page.locator("#hardcoreHelp")).toBeVisible();
      await page.locator("#passInput").fill("room-secret");
      await expect(page.locator("#createBtn")).toBeVisible();
      await expect(page.locator("#abandonmentRecentList a")).toHaveText("Mani");
      await page.locator(".abandonment-explanation summary").click();
      await expect(page.locator(".abandonment-scope")).toBeVisible();
      await page.locator(".abandonment-explanation summary").click();
      if (width === 440) {
        await page.evaluate(() => scrollTo(0, 0));
        await testInfo.attach(`zdwa-lobby-${language}.png`, { body: await page.screenshot(), contentType: "image/png" });
      }
    });

    test(`Zilch groups games and preserves every setup choice (${language}, ${width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 956 });
      await preferences(page, language, "light");
      await page.route(/\/api\/games(?:\?.*)?$/, route => route.fulfill({ json: { games: [
        { id: "solo-compact", game_type: "zilch", name: "Solo", mode: "1", play_mode: "solo", my_player_id: "p1", started: true, participants: [players[0]], progress: [{ ...players[0], points: 900 }] },
        { id: "waiting-compact", game_type: "zilch", name: "Abendrunde", mode: "2", play_mode: "multiplayer", started: false, participants: [players[1]], participant_count: 1, expected_participants: 2 },
      ] } }));
      const login = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
      expect(login.ok()).toBeTruthy();
      const auth = await login.json();
      const created = await page.request.post("/api/admin/users", {
        headers: { "X-CSRF-Token": auth.user.csrf_token },
        data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
      });
      expect([201, 400]).toContain(created.status());
      const previewLogin = await page.request.post("/api/auth/login", { data: { username: "Mani", password: "mani-preview-password-123" } });
      expect(previewLogin.ok()).toBeTruthy();
      await page.route("**/api/auth/me", async route => {
        const response = await route.fetch();
        const payload = await response.json();
        await route.fulfill({ response, json: { ...payload, user: { ...payload.user, must_change_password: false, preferences: { ...payload.user.preferences, preferred_language: language } } } });
      });
      await page.goto("/zilch");
      const hub = page.locator("#zilchGamesHub");
      await expect(hub.locator(".zilch-game-card")).toHaveCount(2);
      await expect(hub.locator("#zilchRefresh")).toHaveCount(1);
      await expect(hub.locator("a[href='/zilch/spiel/solo-compact']")).toBeVisible();
      await expect(hub.locator("a[href='/zilch/spiel/waiting-compact']")).toBeVisible();
      await expect(page.locator(".zilch-create-card .zilch-lobby-identity")).toBeVisible();
      for (const mode of ["solo", "cpu", "multiplayer"]) {
        await page.locator(`[data-zilch-play-mode="${mode}"]`).click();
        await expect(page.locator(`[data-zilch-play-mode="${mode}"]`)).toHaveAttribute("aria-checked", "true");
        if (mode === "solo") await expect(page.locator("#zilchSoloObjective")).toBeVisible();
        if (mode === "cpu") {
          await page.locator("#zilchCpuStrategySelect").selectOption("aggressive");
          await expect(page.locator("#zilchCpuStrategySelect")).toHaveValue("aggressive");
        }
        if (mode === "multiplayer") {
          await page.locator(".zilch-create-options summary").click();
          await page.locator("#zilchGamePassphrase").fill("secret");
          await expect(page.locator("#zilchGamePassphrase")).toHaveValue("secret");
        }
        await expect(page.locator(".zilch-create-submit")).toBeVisible();
        await expectFits(page, ".zilch-create-card");
        await expectFits(page, "#zilchGamesHub");
      }
      await expect(async () => {
        for (const selector of [".zilch-create-heading .eyebrow", ".zilch-create-heading strong", ".zilch-create-heading button"]) await expectTextContrast(page.locator(selector));
      }).toPass({ timeout: 3000 });
      await page.locator("[data-theme-toggle]").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "lcars");
      await expect(async () => {
        for (const selector of [".zilch-create-heading .eyebrow", ".zilch-create-heading strong", ".zilch-create-heading button"]) await expectTextContrast(page.locator(selector));
      }).toPass({ timeout: 3000 });
      await expectFits(page, ".zilch-create-card");
      await page.locator("[data-theme-toggle]").click();
      if (width === 440) {
        await page.locator('[data-zilch-play-mode="solo"]').click();
        await page.evaluate(() => scrollTo(0, 0));
        await testInfo.attach(`zilch-lobby-${language}.png`, { body: await page.screenshot(), contentType: "image/png" });
      }
    });
  }
}

test("ZDWA team progress retains each player's status and profile once", async ({ page }) => {
  await page.route("**/api/games", route => route.fulfill({ json: { games: [{
    ...running, name: "Teamrunde", mode: "2v2", expected: 4, player_statuses: players,
    progress: [{ name: "Team A", filled: 5, of: 48, points: 74, members: players.map(({ id, name, user_id }) => ({ id, name, user_id })) }],
  }] } }));
  await page.goto("/");
  const row = page.locator("#runningList .game-row");
  await expect(row.locator("a.player-name-label")).toHaveCount(2);
  await expect(row.locator(".lobby-progress-player")).toContainText("Anna offline");
  await expect(row).toContainText("5/48");
});
