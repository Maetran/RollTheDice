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

async function signOutFromLobby(page) {
  const [response] = await Promise.all([
    page.waitForResponse(candidate => (
      new URL(candidate.url()).pathname === "/api/auth/logout"
      && candidate.request().method() === "POST"
    )),
    page.click("#logoutBtn"),
  ]);
  expect(response.ok()).toBeTruthy();
  await expect(page.locator("#loginForm")).toBeVisible();
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

  await signOutFromLobby(page);
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
  await signOutFromLobby(page);

  await page.goto("/zilch/anmelden?return_to=/zilch/statistiken");
  await page.fill("#zilchLoginUsername", "Mani");
  await page.fill("#zilchLoginPassword", "mani-preview-password-123");
  await Promise.all([
    page.waitForURL(/\/zilch\/statistiken$/),
    page.locator("#zilchLoginForm button[type=submit]").click(),
  ]);
  await expect(page.getByRole("heading", { name: /Zilch.*Statistiken|Zilch statistics/i })).toBeVisible();
});

test("a fresh Apex login preserves the fixed Zilch subdomain continuation", async ({ page }) => {
  await signInAsPreviewMani(page);
  await signOutFromLobby(page);

  const continuation = "/auth/continue?app=zilch&path=%2Fstatistiken%3Fscope%3Dmine";
  await page.goto(`/zilch/anmelden?return_to=${encodeURIComponent(continuation)}`);
  await page.fill("#zilchLoginUsername", "Mani");
  await page.fill("#zilchLoginPassword", "mani-preview-password-123");
  await Promise.all([
    page.waitForURL(url => (
      url.pathname === "/auth/continue"
      && url.searchParams.get("app") === "zilch"
      && url.searchParams.get("path") === "/statistiken?scope=mine"
    )),
    page.locator("#zilchLoginForm button[type=submit]").click(),
  ]);
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
    scoring: { straight: 2000, three_pairs: 1500, nothing_bonus: 500 },
  });
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("[data-zilch-root]")).toBeVisible();
  await expect(page.getByText(/Alles Wichtige für deine nächste Partie|Everything important for your next game/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Zilch(?:-| )(?:Regeln|rules)$/i })).toBeVisible();
  await expect(page.locator(".zilch-rules-head h1")).toHaveCSS("color", "rgb(255, 253, 245)");
  await expect(page.getByText(/Erreiche 10.?000 Punkte/)).toBeVisible();
  await expect(page.locator(".zilch-rule-facts")).toHaveCount(0);
  await expect(page.locator("#zilchNavigation a[href='/zilch/regeln']")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Zur Zilch-Lobby" })).toHaveCount(0);

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
  await expect(page.locator(".zilch-header [data-zilch-logout]")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Einstellungen" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#zilchAccountPanel-settings")).toBeVisible();
  await expect(page.locator("#zilchPasswordHint")).toBeVisible();
  await page.getByRole("tab", { name: "Statistiken" }).click();
  await expect(page.locator("#zilchAccountPanel-statistics")).toBeVisible();
  await expect(page.locator("#zilchAchievementsBody")).toBeHidden();
  await page.getByRole("tab", { name: "Statistiken" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Erfolge" })).toBeFocused();
  await expect(page.locator("#zilchAccountPanel-achievements")).toBeVisible();
  await expect(page.locator("#zilchAchievementsBody")).toBeVisible();
  await page.getByRole("tab", { name: "Einstellungen" }).click();
  await expect(page).toHaveURL(/\/zilch\/konto#settings$/);
  await expect(page.locator("#zilchAccountPanel-settings")).toBeVisible();
  await expect(page.locator("#zilchLanguagePreferencesForm")).toBeVisible();
  await expect(page.locator("#zilchPasswordForm")).toBeVisible();
  await expect(page.locator("#zilchAccountLogout")).toBeVisible();
  await expect(page.locator("#zilchAccountLogout")).toHaveText("Abmelden");
  const languageUpdate = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/auth/preferences/language"
    && response.request().method() === "PUT"
  ));
  await page.locator("#zilchLanguagePreferencesForm button[type=submit]").click();
  expect((await languageUpdate).ok()).toBeTruthy();
  await expect(page.locator("#zilchLanguagePreferencesMessage")).toHaveText("Sprache gespeichert.");
  await page.fill("#zilchCurrentPassword", "mani-preview-password-123");
  await page.fill("#zilchNewPassword", "different-password-123");
  await page.fill("#zilchConfirmPassword", "another-password-123");
  await page.locator("#zilchPasswordForm button[type=submit]").click();
  await expect(page.locator("#zilchPasswordMessage")).toHaveText("Die neuen Passwörter stimmen nicht überein.");
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(page.getByRole("link", { name: "Zur Zilch-Lobby" })).toHaveCount(0);

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

test("Zilch account keeps the player rank and statistic modes compact on mobile", async ({ page }) => {
  await signInAsPreviewMani(page);
  await page.goto("/zilch/konto");

  await expect(page.locator(".zilch-account-head h1")).toHaveCSS("color", "rgb(255, 253, 245)");
  await expect(page.locator("#zilchAccountRank .zilch-rank-badge")).toBeVisible();
  await page.getByRole("tab", { name: "Statistiken" }).click();
  await page.setViewportSize({ width: 375, height: 844 });

  const statisticsTabRows = await page.locator("[data-zilch-stats-mode]").evaluateAll(tabs => (
    [...new Set(tabs.map(tab => Math.round(tab.getBoundingClientRect().top)))]
  ));
  expect(statisticsTabRows).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  const zilchGameSwitch = page.locator(".zilch-header [data-game-switch]");
  await expect(zilchGameSwitch).toBeVisible();
  await expect(zilchGameSwitch).toHaveAttribute("aria-label", /^(?:ZDWA öffnen|Open ZDWA) \(Alt\+Shift\+Z\)$/);
  await expect(zilchGameSwitch.locator(".game-switch-icon")).toHaveText("🎲");
  await expect(zilchGameSwitch).toContainText("ZDWA");
  await expect(zilchGameSwitch.locator("span").last()).toBeVisible();
  const identity = page.locator(".zilch-lobby-identity");
  await expect(identity).toContainText("Du spielst als");
  await expect(identity).toContainText("Mani");
  await expect(identity.getByRole("button", { name: "Mein Konto" })).toHaveAttribute("data-zilch-navigate", "/zilch/konto");
  await expect(page.getByRole("button", { name: "Alle Bestenlisten" })).toHaveAttribute("data-zilch-navigate", "/zilch/bestenlisten");
  await expect(page.locator("#zilchAccount")).toBeHidden();
  await expect(page.locator(".zilch-header [data-zilch-logout]")).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  await expect(zilchGameSwitch.locator(".game-switch-icon")).toBeVisible();
  await expect(zilchGameSwitch.locator("span").last()).toBeHidden();
  const lobbyAlignment = await page.evaluate(() => {
    const modes = [...document.querySelectorAll(".zilch-mode-option")].map(option => {
      const style = getComputedStyle(option);
      const box = option.getBoundingClientRect();
      const label = option.querySelector("strong").getBoundingClientRect();
      return {
        justifyContent: style.justifyContent,
        textAlign: style.textAlign,
        centerDelta: Math.abs((box.left + box.width / 2) - (label.left + label.width / 2)),
      };
    });
    const identity = document.querySelector(".zilch-lobby-identity");
    const identityBox = identity.getBoundingClientRect();
    const childCenters = [...identity.children].map(child => {
      const box = child.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    return {
      modes,
      identityHeight: identityBox.height,
      identityCenterSpread: Math.max(...childCenters) - Math.min(...childCenters),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(lobbyAlignment.modes).toHaveLength(3);
  expect(lobbyAlignment.modes.every(mode => mode.justifyContent === "center" && mode.textAlign === "center")).toBe(true);
  expect(lobbyAlignment.modes.every(mode => mode.centerDelta <= 1)).toBe(true);
  expect(lobbyAlignment.identityCenterSpread).toBeLessThanOrEqual(1);
  expect(lobbyAlignment.identityHeight).toBeLessThanOrEqual(48);
  expect(lobbyAlignment.documentWidth).toBeLessThanOrEqual(lobbyAlignment.viewportWidth);
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
  await expect(page.locator(".zilch-lobby-identity")).toContainText("Playing as");
  await expect(page.locator(".zilch-lobby-identity").getByRole("button", { name: "My Account" })).toHaveAttribute("data-zilch-navigate", "/zilch/konto");

  await page.goto("/zilch/konto");
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.locator("#zilchAccountLogout")).toHaveText("Sign out");
  await expect(page.locator(".zilch-header [data-zilch-logout]")).toHaveCount(0);

  await page.goto("/zilch/regeln");
  await expect(page.getByRole("heading", { name: /zilch.*rules/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /points/i })).toBeVisible();
  await expect(page.getByText(/Reach 10,000 points/)).toBeVisible();
  await expect(page.getByRole("link", { name: /back to zilch lobby/i })).toHaveCount(0);

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

  // The account preference is persisted in the shared browser-test database.
  // This fixture asserts the German projection below, so restore its explicit
  // starting locale even when an earlier independent spec exercised English.
  const languageSwitcher = page.locator("[data-language-switcher]");
  if (await languageSwitcher.inputValue() !== "de") {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      languageSwitcher.selectOption("de"),
    ]);
  }
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

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
    const zilchRank = {
      key: "player", title: "Spieler", title_key: "zilch.rank.player", stars: 2,
      points: 42, points_possible: 273, minimum_points: 22, next_minimum_points: 46, points_to_next_rank: 4,
    };
    const entry = category === "solo_sprint"
      ? {
        rank: 1, user_id: 2, username: "Mani", display_name: "Mani", primary_value: 12, games: 1, is_current_user: true,
        zilch_achievement_rank: zilchRank,
        values: {
          turns: 12, rolls: 28, zilchs: 1, active_duration_seconds: 740,
          highest_banked_round: 2000, finished_at: "2026-09-03T10:00:00+00:00",
        },
        tie_breaks: { rolls: 28, zilchs: 1, active_duration_seconds: 740, finished_at: "2026-09-03T10:00:00+00:00" },
      }
      : category === "achievement_points"
        ? {
          rank: 1, user_id: 2, username: "Mani", display_name: "Mani", primary_value: 42, games: 7, is_current_user: true,
          zilch_achievement_rank: zilchRank,
          values: { points: 42, achievement_points: 42, points_possible: 273 },
          achievement_rank: {
            key: "player", title: "Spieler", title_key: "zilch.rank.player", stars: 2,
            points: 42, points_possible: 273, minimum_points: 22, next_minimum_points: 46, points_to_next_rank: 4,
          },
          tie_breaks: {},
        }
        : {
        rank: 1, user_id: 2, username: "Mani", display_name: "Mani", primary_value: 2, games: 3, is_current_user: true,
        zilch_achievement_rank: zilchRank,
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
  await expect(page.getByRole("button", { name: "Zu den Bestenlisten" })).toHaveAttribute("data-zilch-navigate", "/zilch/bestenlisten");
  await expect(page.getByText("Partien nach Spielart")).toBeVisible();
  await expect(page.getByText("Gesicherte Gesamtpunkte")).toHaveCount(0);

  const multiplayerTab = page.getByRole("tab", { name: "Zwei Spieler" });
  await multiplayerTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Gegen den Würfelwirt" })).toBeFocused();
  await expect(page.getByText("Alle Partien gegen den Würfelwirt", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Aggressiv" }).click();
  await expect(page.getByText("Spielweise des Würfelwirts: Aggressiv", { exact: true })).toBeVisible();
  await expect(page.getByText("Bilanz (S–N–U)", { exact: true })).toBeVisible();
  await expect(page.getByText("Nicht vollständig verfügbar", { exact: true })).toHaveCount(0);

  await page.goto("/zilch/bestenlisten");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { name: "Zilch-Bestenlisten" })).toBeVisible();
  await expect(page.locator("#zilchNavigation a[href='/zilch/bestenlisten']")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".zilch-leaderboard-table")).toBeVisible();
  await expect(page.locator("tr[data-own-entry='true']")).toContainText("Du");
  await expect(page.locator("tr[data-own-entry='true']")).toContainText("Mani");
  await expect(page.locator(".zilch-leaderboard-table .zilch-rank-badge")).toContainText("Spieler");
  await expect(page.getByRole("button", { name: "Deine Statistiken" })).toHaveAttribute("data-zilch-navigate", "/zilch/statistiken");
  await expect(page.getByRole("button", { name: "Deine Statistiken" })).toHaveClass(/zilch-header-action/);
  await expect(page.getByRole("button", { name: "Zilch-Awards" })).toHaveAttribute("data-zilch-navigate", "/zilch/erfolge");
  await expect(page.getByRole("button", { name: "Zilch-Awards" })).toHaveClass(/zilch-header-action/);
  await expect(page.getByText("Ziel:", { exact: false })).toBeVisible();
  await expect(page.locator(".zilch-leaderboard-table thead")).toContainText("Abgeschlossen am");
  await expect(page.getByRole("button", { name: "Nächste" })).toBeEnabled();

  const cpuRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/zilch/leaderboards" && url.searchParams.get("category") === "cpu_wins";
  });
  const category = page.locator("[data-zilch-leaderboard-category='cpu_wins']");
  const categoryTiles = page.locator("[data-zilch-leaderboard-category]");
  await expect(categoryTiles).toHaveCount(4);
  const firstTile = await categoryTiles.nth(0).boundingBox();
  const secondTile = await categoryTiles.nth(1).boundingBox();
  expect(secondTile.x).toBeGreaterThan(firstTile.x);
  await category.focus();
  await expect(category).toBeFocused();
  await category.click();
  await cpuRequest;
  await expect(category).toBeFocused();
  await expect(category).toHaveAttribute("aria-pressed", "true");
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

  const pointsRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/zilch/leaderboards"
      && url.searchParams.get("category") === "achievement_points";
  });
  await page.locator("[data-zilch-leaderboard-category='achievement_points']").click();
  await pointsRequest;
  await expect(page.locator("#zilchLeaderboardStrategyFilter")).toBeHidden();
  await expect(page.locator(".zilch-leaderboard-table thead")).toContainText("Zilch-Punkte");
  await expect(page.locator("tr[data-own-entry='true']")).toContainText("Spieler");
  await expect(page.locator("tr[data-own-entry='true']")).toContainText("42");

  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator(".zilch-leaderboard-table-wrap").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.locator(".zilch-leaderboard-table tbody tr").first().locator("[data-label='Zilch-Punkte']")).toHaveCount(1);
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
        points: 1,
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
        points: 2,
      },
      {
        key: "zilch.banked_round_1000",
        definition_version: 1,
        category: "entry",
        category_key: "zilch.achievement.category.entry",
        icon_key: "star",
        title_key: "zilch.achievement.banked_round_1000.title",
        description_key: "zilch.achievement.banked_round_1000.description",
        eligible_modes: ["multiplayer", "cpu", "solo"],
        points: 3,
      },
      {
        key: "zilch.community_games_100",
        definition_version: 1,
        category: "community",
        category_key: "zilch.achievement.category.community",
        icon_key: "star",
        title_key: "zilch.achievement.community_games_100.title",
        description_key: "zilch.achievement.community_games_100.description",
        eligible_modes: ["multiplayer", "cpu", "solo"],
        points: 0,
        missed: true,
      },
    ];
    const unlocked = definitions.slice(0, 2).map((definition, index) => ({
      ...definition,
      unlocked_at: `2026-09-0${index + 1}T10:00:00+00:00`,
    }));
    let pending = unlocked.map(award => ({ ...award, queued_at: award.unlocked_at }));
    const acknowledgements = [];
    const rankAcknowledgements = [];
    let rankUpgrade = {
      previous: {
        key: "newbie", title: "Newbie", title_key: "zilch.rank.newbie", stars: 0,
        points: 3, points_possible: 273, minimum_points: 0,
      },
      current: {
        key: "rookie", title: "Rookie", title_key: "zilch.rank.rookie", stars: 1,
        points: 7, points_possible: 273, minimum_points: 7,
      },
      source_game_id: "retro-rank-fixture",
      queued_at: "2026-09-03T10:00:00+00:00",
    };

    await page.route("**/api/zilch/achievement-ranks", async route => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          version: 2,
          points_possible: 273,
          ranks: [
            { key: "newbie", title: "Newbie", title_key: "zilch.rank.newbie", stars: 0, minimum_points: 0 },
            { key: "rookie", title: "Rookie", title_key: "zilch.rank.rookie", stars: 1, minimum_points: 7 },
            { key: "player", title: "Spieler", title_key: "zilch.rank.player", stars: 2, minimum_points: 22 },
          ],
        }),
      });
    });

    await page.route("**/api/zilch/achievements**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/zilch/achievements/pending") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            version: 2,
            points: 3,
            points_possible: 273,
            rank: {
              key: "newbie", title: "Newbie", title_key: "zilch.rank.newbie", stars: 0,
              points: 3, points_possible: 273, minimum_points: 0, next_minimum_points: 7, points_to_next_rank: 4,
            },
            awards: pending,
            rank_upgrade: rankUpgrade,
          }),
        });
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
            version: 2,
            player: { username: "Mani" },
            points: 3,
            points_possible: 273,
            rank: {
              key: "newbie", title: "Newbie", title_key: "zilch.rank.newbie", stars: 0,
              points: 3, points_possible: 273, minimum_points: 0, next_minimum_points: 7, points_to_next_rank: 4,
            },
            categories: [
              { key: "entry", title_key: "zilch.achievement.category.entry" },
              { key: "multiplayer", title_key: "zilch.achievement.category.multiplayer" },
              { key: "community", title_key: "zilch.achievement.category.community" },
            ],
            unlocked,
            locked: definitions.slice(2),
          }),
        });
        return;
      }
      await route.fallback();
    });
    await page.route("**/api/zilch/achievement-rank/acknowledge", async route => {
      rankAcknowledgements.push("rookie");
      rankUpgrade = null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, rank_key: "rookie", acknowledged_at: "2026-09-03T10:02:00+00:00" }),
      });
    });
    await page.route("**/api/zilch/players/Mani/achievements", async route => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          version: 2,
          player: { username: "Mani" },
          points: 1,
          points_possible: 273,
          rank: {
            key: "newbie", title: "Newbie", title_key: "zilch.rank.newbie", stars: 0,
            points: 1, points_possible: 273, minimum_points: 0, next_minimum_points: 7, points_to_next_rank: 6,
          },
          categories: ["entry"],
          unlocked: [unlocked[0]],
          locked: [definitions[2]],
        }),
      });
    });

    await page.goto("/zilch/erfolge");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Zilch-Awards" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Einstieg" })).toBeVisible();
    await expect(page.locator(".zilch-achievement-card.is-unlocked")).toHaveCount(2);
    await expect(page.locator(".zilch-achievement-card.is-locked")).toHaveCount(2);
    await expect(page.locator(".zilch-achievement-card.is-missed")).toContainText("Verpasst");
    await expect(page.locator(".zilch-achievement-sequence")).toHaveCount(3);
    await expect(page.locator("#zilchAchievementUnlocked + .zilch-achievement-sequence .zilch-achievement-card")).toHaveClass([
      /is-unlocked/,
      /is-unlocked/,
    ]);
    await expect(page.locator("#zilchAchievementCategory-entry + .zilch-achievement-sequence .zilch-achievement-card")).toHaveClass(/is-locked/);
    await expect(page.locator(".zilch-achievement-card").first()).toContainText("Tischsieger");
    await expect(page.locator(".zilch-achievement-summary")).toContainText("3 / 273");
    await expect(page.locator(".zilch-achievement-summary")).toContainText("Newbie");
    await expect(page.locator("[data-zilch-rank-legend]")).toContainText("Ränge und Mindestwerte");
    await expect(page.locator("[data-zilch-rank-legend] .is-current")).toContainText("Newbie");
    await expect(page.locator(".zilch-achievement-card").first()).toContainText("+2 Zilch-Punkte");
    await expect(page.locator(".zilch-achievement-card").nth(1)).toContainText("+1 Zilch-Punkt");
    await expect(page.locator(".zilch-achievement-card__category")).toHaveCount(0);
    await expect(page.locator(".zilch-achievement-card time")).toHaveCount(2);
    await expect(page.locator(".zilch-achievement-card time").first()).toHaveAttribute("datetime", "2026-09-02T10:00:00+00:00");
    await expect(page.locator(".zilch-achievement-card time").first()).toContainText("Freigeschaltet am");
    await expect(page.locator("[data-rank-legend], .player-rank")).toHaveCount(0);

    const dialog = page.locator("#appDialog");
    await expect(dialog).toHaveAttribute("data-kind", "zilch-award");
    await expect(dialog).toContainText("Zilch-Award freigeschaltet!");
    await expect(dialog).toContainText("Erster Wurf");
    await expect(dialog).toContainText("Belohnung: +1 Zilch-Punkt");
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
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect.poll(() => acknowledgements).toEqual(["zilch.first_game"]);
    await expect(dialog).toContainText("Tischsieger");
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect.poll(() => acknowledgements).toEqual(["zilch.first_game", "zilch.first_hvh_win"]);
    await expect(dialog).toHaveAttribute("data-kind", "zilch-rank-up");
    await expect(dialog).toContainText("RANGAUFSTIEG!");
    await expect(dialog).toContainText("Newbie → Rookie");
    await expect(dialog).toContainText("7 Zilch-Punkte");
    await expect.poll(async () => dialog.evaluate(element => getComputedStyle(element).animationName)).toContain("zilch-rank-up-arrival");
    await page.keyboard.press("Escape");
    await expect.poll(() => rankAcknowledgements).toEqual([]);
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();

    // The rank moment follows the same explicit acknowledgement rule as an
    // award card: closing it keeps the retrospective delivery available.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Zilch-Awards" })).toBeVisible();
    await expect(dialog).toHaveAttribute("data-kind", "zilch-rank-up");
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect.poll(() => rankAcknowledgements).toEqual(["rookie"]);
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Zilch-Awards" })).toBeVisible();
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();

    await page.goto("/zilch/spieler/Mani");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Zilch-Awards eines Spielers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mani" })).toBeVisible();
    await expect(page.locator(".zilch-achievement-card.is-unlocked")).toHaveCount(1);
    await expect(page.locator(".zilch-achievement-summary")).toContainText("1 / 273");

    await page.goto("/zilch/erfolge");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator("[data-language-switcher]").selectOption("en"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Zilch awards" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
    await expect(page.locator(".zilch-achievement-card").first()).toContainText("Table Victor");
    await expect(page.locator(".zilch-achievement-summary")).toContainText("Zilch points");
    await expect(page.locator("[data-zilch-rank-legend]")).toContainText("Ranks and minimums");
    await expect(page.locator(".zilch-achievement-card.is-missed")).toContainText("Missed");

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
