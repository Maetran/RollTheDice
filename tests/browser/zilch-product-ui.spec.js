const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createUser(page, username, password, role = "user") {
  return page.evaluate(async ({ username: name, password: secret, role: userRole }) => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({ username: name, temporary_password: secret, role: userRole }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { username, password, role });
}

async function signInAsPreviewMani(page) {
  // Browser tests share a disposable database.  Provisioning is idempotent so
  // this file also works when another Zilch spec has already created Mani.
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  const mani = await createUser(page, "Mani", "mani-preview-password-123", "admin");
  expect([201, 400]).toContain(mani.status);

  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  await expect(page.locator("#authBadge")).toContainText("Mani");
  await expect(page.locator("[data-game-switch]")).toBeVisible();
}

test("Zilch has its own sign-in entry and safely returns preview accounts to the requested view", async ({ page }) => {
  await page.goto("/zilch/anmelden?return_to=/zilch/statistiken");
  await expect(page.locator("#zilchLoginForm")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bei Zilch anmelden" })).toBeVisible();

  // Provision the preview account through the established workflow, then
  // exercise the actual Zilch sign-in page as a logged-out visitor.
  await signInAsPreviewMani(page);
  await page.click("#logoutBtn");

  await page.goto("/zilch/anmelden?return_to=/zilch/statistiken");
  await page.fill("#zilchLoginUsername", "Mani");
  await page.fill("#zilchLoginPassword", "mani-preview-password-123");
  await Promise.all([
    page.waitForURL(/\/zilch\/statistiken$/),
    page.locator("#zilchLoginForm button[type=submit]").click(),
  ]);
  await expect(page.getByRole("heading", { name: /Zilch.*Statistiken|Zilch statistics/i })).toBeVisible();
});

function externalHttpOrigins(requests, origin) {
  return [...new Set(requests
    .map(request => request.url())
    .filter(url => /^https?:/i.test(url))
    .map(url => new URL(url).origin)
    .filter(requestOrigin => requestOrigin !== origin))];
}

test("private Zilch rules, history, and product navigation use the protected noindex shell", async ({ page }) => {
  const anonymousRules = await page.goto("/zilch/regeln");
  expect(anonymousRules?.status()).toBe(401);
  const anonymousHistory = await page.goto("/zilch/historie");
  expect(anonymousHistory?.status()).toBe(401);
  const anonymousStatistics = await page.goto("/zilch/statistiken");
  expect(anonymousStatistics?.status()).toBe(401);
  const anonymousLeaderboards = await page.goto("/zilch/bestenlisten");
  expect(anonymousLeaderboards?.status()).toBe(401);
  const anonymousAchievements = await page.goto("/zilch/erfolge");
  expect(anonymousAchievements?.status()).toBe(401);
  const anonymousPlayerAchievements = await page.goto("/zilch/spieler/Mani");
  expect(anonymousPlayerAchievements?.status()).toBe(401);

  await signInAsPreviewMani(page);
  const requests = [];
  page.on("request", request => requests.push(request));

  const [rulesResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/zilch/rules" && response.status() === 200),
    page.goto("/zilch/regeln"),
  ]);
  expect(await rulesResponse.json()).toMatchObject({
    ruleset: "zilch-house-v1",
    dice_count: 6,
    target_score: 10000,
    bank_minimum: 400,
    third_roll_minimum: 300,
    confirmation_minimum: 50,
    third_zilch_penalty: 500,
    scoring: { straight: 2000, three_pairs: 500, nothing_bonus: 500 },
  });
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("[data-zilch-root]")).toBeVisible();
  await expect(page.getByText(/Alles Wichtige für deine nächste Partie|Everything important for your next game/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Zilch(?:-| )(?:Regeln|rules)$/i })).toBeVisible();
  await expect(page.locator("#zilchNavigation a[href='/zilch/regeln']")).toHaveAttribute("aria-current", "page");

  const navigation = await page.locator("#zilchNavigation a").evaluateAll(links => links.map(link => ({
    href: link.getAttribute("href"),
    text: link.textContent?.trim(),
  })));
  const hrefs = navigation.map(link => link.href);
  expect(hrefs).toEqual([
    "/zilch",
    "/zilch/bestenlisten",
    "/zilch/regeln",
    "/zilch/konto",
  ]);
  expect(navigation.map(link => link.text)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^(Spieler & Ranking|Players & Ranking)$/),
    expect.stringMatching(/^(Regeln|Rules)$/),
    expect.stringMatching(/^(Konto|Account)$/),
  ]));
  expect(page.locator("#createGameCard")).toHaveCount(0);

  await Promise.all([
    page.waitForURL(/\/zilch\/konto$/),
    page.locator("#zilchNavigation a[href='/zilch/konto']").click(),
  ]);
  await expect(page.getByRole("heading", { name: "Mani", exact: true })).toBeVisible();
  await expect(page.locator("#zilchAchievementsBody")).toBeVisible();

  await page.goto("/konto#settings");
  await expect(page.getByRole("heading", { name: /ZDWA(?:-|\s)(Spieleinstellungen|game settings)/i })).toBeVisible();
  await expect(page.getByText(/gelten nur für ZDWA|apply only to ZDWA/i)).toBeVisible();

  // Consume the body as soon as the response arrives. The app can issue a
  // navigation while route initialization finishes, which otherwise makes a
  // retained Playwright response body unavailable on WebKit/Chromium.
  const historyBody = page
    .waitForResponse(response => new URL(response.url()).pathname === "/api/zilch/results" && response.status() === 200)
    .then(response => response.json());
  await page.goto("/zilch/historie");
  expect(await historyBody).toHaveProperty("results");
  await expect(page.locator("#zilchAllResultsHistory")).toBeVisible();
  await expect(page.locator("#zilchAllHistoryTitle")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const origin = new URL(page.url()).origin;
  expect(externalHttpOrigins(requests, origin)).toEqual([]);
});

test("Zilch product navigation is keyboard-friendly, responsive, and localized without mounting ZDWA", async ({ page }) => {
  await signInAsPreviewMani(page);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/zilch$/),
    page.locator("[data-game-switch]").click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator("#createGameCard")).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  const navigation = page.locator("#zilchNavigation");
  const navigationList = page.locator("#zilchNavigation .zilch-nav-list");
  const toggle = page.locator("#zilchNavToggle");
  await expect(toggle).toHaveCount(0);
  await expect(navigation).toHaveJSProperty("hidden", false);
  await expect(navigationList).toBeVisible();
  const navLinks = navigation.getByRole("link");
  await expect(navLinks).toHaveCount(4);
  expect(await navLinks.evaluateAll(links => links.every(link => link.getBoundingClientRect().height >= 40))).toBe(true);
  await navLinks.nth(2).focus();
  await expect(navLinks.nth(2)).toBeFocused();

  const skipLink = page.locator(".zilch-skip-link");
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("zilchContent");

  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motionDuration = await page.locator(".zilch-skip-link").evaluate(element => (
    window.getComputedStyle(element).transitionDuration
  ));
  expect(Number.parseFloat(motionDuration)).toBeLessThanOrEqual(0.01);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("en"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#zilchNavigation a[href='/zilch/regeln']")).toHaveText("Rules");

  await page.goto("/zilch/regeln");
  await expect(page.getByRole("heading", { name: /zilch.*rules/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /points/i })).toBeVisible();

  // Restore the account preference so this file does not leak a language
  // choice into later independent browser specs.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("de"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  await Promise.all([
    page.waitForURL(/\/$/),
    page.locator("[data-game-switch]").click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();
});

test("private Zilch statistics and leaderboards render only server projections accessibly", async ({ browser, baseURL }) => {
  // The private shell registers a service worker in normal contexts.  Use an
  // isolated blocked-SW context so these browser-only projection fixtures
  // exercise the real page while Playwright reliably intercepts only its API
  // reads, never a stale cache response.
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
  await signInAsPreviewMani(page);

  await page.route("**/api/zilch/statistics", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      version: 1,
      overview: {
        completed_records: 7,
        games_by_mode: { multiplayer: 2, cpu: 3, solo: 2 },
        banked_points: 12400,
        banked_rounds: 18,
        highest_banked_round: 1900,
        average_banked_round: 688.89,
        zilchs: 4,
        zilch_penalties: 500,
        hot_dice_events: 2,
        duration_seconds: 4200,
        active_duration_seconds: 900,
      },
      multiplayer: {
        games: 2, wins: 1, losses: 0, ties: 1, win_rate: 1,
        average_final_score: 10100, highest_final_score: 10300,
        highest_banked_round: 1300, average_banked_round: 760,
        zilchs: 1, hot_dice_events: 1, average_duration_seconds: 1200,
      },
      cpu: {
        overall: {
          games: 3, wins: 2, losses: 1, ties: 0, win_rate: 0.67,
          average_final_score: 10050, highest_final_score: 10900,
          highest_banked_round: 1600, average_banked_round: 720,
          zilchs: 2, hot_dice_events: 1, average_duration_seconds: 980,
        },
        by_strategy: {
          conservative: {
            games: 1, wins: 1, losses: 0, ties: 0, win_rate: 1,
            average_final_score: 10100, highest_final_score: 10100,
            highest_banked_round: 800, average_banked_round: 650,
            zilchs: 0, hot_dice_events: 0, average_duration_seconds: 800,
          },
          normal: {
            games: 1, wins: 1, losses: 0, ties: 0, win_rate: 1,
            average_final_score: 10500, highest_final_score: 10500,
            highest_banked_round: 1600, average_banked_round: 840,
            zilchs: 1, hot_dice_events: 1, average_duration_seconds: 1000,
          },
          aggressive: {
            games: 1, wins: 0, losses: 1, ties: 0, win_rate: 0,
            average_final_score: 9550, highest_final_score: 9550,
            highest_banked_round: 1200, average_banked_round: 660,
            zilchs: 1, hot_dice_events: null, hot_dice_events_complete: false, average_duration_seconds: 1140,
          },
        },
      },
      solo: {
        runs: 2, completed: 1, abandoned: 1, completion_rate: 0.5,
        best_run: { turns: 12, rolls: 28, zilchs: 1, active_duration_seconds: 740 },
        lowest_turns: 12, lowest_rolls: 28, lowest_zilchs: 1,
        shortest_active_duration_seconds: 740, highest_banked_round: 2000,
        average_banked_round: 910, average_turns_completed: 12,
        average_rolls_completed: 28, hot_dice_events: 1,
      },
    }),
  }));

  await page.route("**/api/zilch/leaderboards**", async route => {
    const requestUrl = new URL(route.request().url());
    const category = requestUrl.searchParams.get("category") || "solo_sprint";
    const strategy = requestUrl.searchParams.get("strategy");
    const offset = Number(requestUrl.searchParams.get("offset") || "0");
    const common = {
      version: 1,
      category,
      strategy: category === "cpu_wins" ? strategy : null,
      ranking: "competition",
      sorting: { direction: category === "solo_sprint" ? "ascending" : "descending" },
      offset,
      limit: 100,
      total: 101,
      ...(category === "solo_sprint" ? {
        objective: { id: "reach_10000_fewest_turns", version: 1 },
      } : {}),
    };
    const entry = category === "solo_sprint"
      ? {
        rank: 1, user_id: 2, username: "Mani", display_name: "Mani", primary_value: 12, games: 1, is_current_user: true,
        values: {
          turns: 12, rolls: 28, zilchs: 1, active_duration_seconds: 740,
          highest_banked_round: 2000, finished_at: "2026-09-03T10:00:00+00:00",
        },
        tie_breaks: { rolls: 28, zilchs: 1, active_duration_seconds: 740, finished_at: "2026-09-03T10:00:00+00:00" },
      }
      : {
        rank: 1, user_id: 2, username: "Mani", display_name: "Mani", primary_value: 2, games: 3, is_current_user: true,
        values: {
          wins: 2, games: 3, losses: 1, ties: category === "cpu_wins" ? 1 : 0,
          win_rate: 0.67, highest_final_score: 10900, highest_banked_round: 1600,
        },
        tie_breaks: { losses: 1, ties: 0, highest_final_score: 10900, highest_banked_round: 1600 },
      };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...common, entries: [entry], own_entry: entry }) });
  });

  await page.goto("/zilch/statistiken");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { name: /Zilch-(Statistiken|statistics)/i }).first()).toBeVisible();
  await expect(page.getByText("Partien nach Spielart")).toBeVisible();
  await expect(page.getByText("Gesicherte Gesamtpunkte")).toHaveCount(0);

  const multiplayerTab = page.getByRole("tab", { name: "Zwei Spieler" });
  await multiplayerTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Gegen CPU" })).toBeFocused();
  await expect(page.getByText("Alle CPU-Partien", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Aggressiv" }).click();
  await expect(page.getByText("CPU-Strategie: Aggressiv", { exact: true })).toBeVisible();
  await expect(page.getByText("Bilanz (S–N–U)", { exact: true })).toBeVisible();
  await expect(page.getByText("Nicht vollständig verfügbar", { exact: true })).toHaveCount(0);

  await page.goto("/zilch/bestenlisten");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { name: "Zilch-Bestenlisten" })).toBeVisible();
  await expect(page.locator("#zilchNavigation a[href='/zilch/bestenlisten']")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".zilch-leaderboard-table")).toBeVisible();
  await expect(page.locator("tr[data-own-entry='true']")).toContainText("Du");
  await expect(page.locator(".zilch-leaderboard-table a[href='/zilch/spieler/Mani']")).toHaveText("Mani");
  await expect(page.getByText("Objective:", { exact: false })).toBeVisible();
  await expect(page.locator(".zilch-leaderboard-table thead")).toContainText("Abgeschlossen am");
  await expect(page.getByRole("button", { name: "Nächste" })).toBeEnabled();

  const cpuRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/zilch/leaderboards" && url.searchParams.get("category") === "cpu_wins";
  });
  const category = page.locator("#zilchLeaderboardFilters select[name='category']");
  await category.focus();
  await expect(category).toBeFocused();
  await category.selectOption("cpu_wins");
  await cpuRequest;
  await expect(category).toBeFocused();
  await expect(page.locator("#zilchLeaderboardStrategyFilter")).toBeVisible();
  await expect(page.locator(".zilch-leaderboard-table thead")).toContainText("Gleichstände");
  await expect(page.locator(".zilch-leaderboard-table thead")).toContainText("Beste Endpunktzahl");

  const aggressiveRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/zilch/leaderboards"
      && url.searchParams.get("category") === "cpu_wins"
      && url.searchParams.get("strategy") === "aggressive";
  });
  await page.locator("#zilchLeaderboardFilters select[name='strategy']").selectOption("aggressive");
  await aggressiveRequest;
  await expect(page).toHaveURL(/category=cpu_wins.*strategy=aggressive/);

  const nextRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/zilch/leaderboards" && url.searchParams.get("offset") === "100";
  });
  await page.getByRole("button", { name: "Nächste" }).click();
  await nextRequest;

  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("en"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Zilch leaderboards" })).toBeVisible();
  await expect(page.locator("tr[data-own-entry='true']")).toContainText("You");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("de"),
  ]);
  } finally {
    await context.close();
  }
});

test("private Zilch awards use server projections and acknowledge a sequential award queue", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);

    const definitions = [
      {
        key: "zilch.first_game",
        definition_version: 1,
        category: "entry",
        category_key: "zilch.achievement.category.entry",
        icon_key: "die",
        title_key: "zilch.achievement.first_game.title",
        description_key: "zilch.achievement.first_game.description",
        eligible_modes: ["multiplayer", "cpu", "solo"],
      },
      {
        key: "zilch.first_hvh_win",
        definition_version: 1,
        category: "multiplayer",
        category_key: "zilch.achievement.category.multiplayer",
        icon_key: "duel",
        title_key: "zilch.achievement.first_hvh_win.title",
        description_key: "zilch.achievement.first_hvh_win.description",
        eligible_modes: ["multiplayer"],
      },
      {
        key: "zilch.banked_round_1000",
        definition_version: 1,
        category: "scoring",
        category_key: "zilch.achievement.category.scoring",
        icon_key: "star",
        title_key: "zilch.achievement.banked_round_1000.title",
        description_key: "zilch.achievement.banked_round_1000.description",
        eligible_modes: ["multiplayer", "cpu", "solo"],
      },
    ];
    const unlocked = definitions.slice(0, 2).map((definition, index) => ({
      ...definition,
      unlocked_at: `2026-09-0${index + 1}T10:00:00+00:00`,
    }));
    let pending = unlocked.map(award => ({ ...award, queued_at: award.unlocked_at }));
    const acknowledgements = [];

    await page.route("**/api/zilch/achievements**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/zilch/achievements/pending") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 1, awards: pending }) });
        return;
      }
      if (request.method() === "POST" && /\/acknowledge$/.test(url.pathname)) {
        const key = decodeURIComponent(url.pathname.split("/").at(-2));
        acknowledgements.push(key);
        pending = pending.filter(award => award.key !== key);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, acknowledged_at: "2026-09-03T10:01:00+00:00" }) });
        return;
      }
      if (url.pathname === "/api/zilch/achievements") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            version: 1,
            player: { username: "Mani" },
            categories: [
              { key: "entry", title_key: "zilch.achievement.category.entry" },
              { key: "scoring", title_key: "zilch.achievement.category.scoring" },
              { key: "multiplayer", title_key: "zilch.achievement.category.multiplayer" },
            ],
            unlocked,
            locked: definitions.slice(2),
          }),
        });
        return;
      }
      await route.fallback();
    });
    await page.route("**/api/zilch/players/Mani/achievements", async route => {
      // The UI remains tolerant of the earlier nested shape while the current
      // main API uses top-level unlocked/locked lists.
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          player: { username: "Mani" },
          categories: ["entry"],
          achievements: { unlocked: [unlocked[0]], locked: [definitions[2]] },
        }),
      });
    });

    await page.goto("/zilch/erfolge");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Zilch-Awards" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Einstieg" })).toBeVisible();
    await expect(page.locator(".zilch-achievement-card.is-unlocked")).toHaveCount(2);
    await expect(page.locator(".zilch-achievement-card.is-locked")).toHaveCount(1);
    await expect(page.locator(".zilch-achievement-card").first()).toContainText("Zwei Spieler");
    await expect(page.locator("[data-rank-legend], .player-rank")).toHaveCount(0);

    const dialog = page.locator("#appDialog");
    await expect(dialog).toHaveAttribute("data-kind", "zilch-award");
    await expect(dialog).toContainText("Zilch-Award freigeschaltet!");
    await expect(dialog).toContainText("Erster Wurf");
    await expect(page.locator("#appDialogActions .primary")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect.poll(() => acknowledgements).toEqual([]);
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();

    // A dismissed award is intentionally still pending.  The next load
    // resumes the same queue; only the explicit Continue action records an
    // acknowledgement and advances to the following award.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Zilch-Awards" })).toBeVisible();
    await expect(dialog).toContainText("Erster Wurf");
    await page.getByRole("button", { name: "Weiter" }).click();
    await expect.poll(() => acknowledgements).toEqual(["zilch.first_game"]);
    await expect(dialog).toContainText("Tischsieger");
    await page.getByRole("button", { name: "Weiter" }).click();
    await expect.poll(() => acknowledgements).toEqual(["zilch.first_game", "zilch.first_hvh_win"]);
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Zilch-Awards" })).toBeVisible();
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();

    await page.goto("/zilch/spieler/Mani");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Zilch-Awards eines Spielers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mani" })).toBeVisible();
    await expect(page.locator(".zilch-achievement-card.is-unlocked")).toHaveCount(1);

    await page.goto("/zilch/erfolge");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator("[data-language-switcher]").selectOption("en"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Zilch awards" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
    await expect(page.locator(".zilch-achievement-card").first()).toContainText("First Roll");

    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const duration = await page.locator(".zilch-achievement-card").first().evaluate(element => window.getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.01);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator("[data-language-switcher]").selectOption("de"),
    ]);
  } finally {
    await context.close();
  }
});
