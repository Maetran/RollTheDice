const { test, expect } = require("@playwright/test");
const { expectTextContrast } = require("./contrast");

test.use({ serviceWorkers: "block" });

const products = {
  zdwa: {
    path: "/spieler",
    endpoint: "/api/achievements/recent",
    themeKey: "wuerfler_theme",
    themes: ["light", "dark", "classic"],
  },
  zilch: {
    path: "/zilch/bestenlisten",
    endpoint: "/api/zilch/achievements/recent",
    themeKey: "zilch_theme",
    themes: ["light", "lcars"],
  },
};

const copy = {
  de: {
    achievements: "Neueste Erfolge",
    rankings: "Rankings",
    easy: "Leicht",
    medium: "Mittel",
    hard: "Schwer",
    zdwaTitle: "Warmgelaufen",
    zilchTitle: "Erster Wurf",
  },
  en: {
    achievements: "Latest achievements",
    rankings: "Rankings",
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
    zdwaTitle: "Warming Up",
    zilchTitle: "First Roll",
  },
};

function feedItem(product, { index, page, difficulty }) {
  const number = (page - 1) * 20 + index + 1;
  const resolvedDifficulty = difficulty || ["easy", "medium", "hard"][index % 3];
  const unlockedAt = new Date(Date.UTC(2026, 8, 22, 12, 0, 0) - number * 60_000).toISOString();
  const username = `${difficulty ? `${difficulty}-` : ""}${page === 1 ? "Newest" : "PageTwo"} Player ${String(number).padStart(2, "0")}`;
  const item = {
    id: number,
    unlocked_at: unlockedAt,
    player: {
      id: 10_000 + number,
      username: index === 1 ? "Insgesamt" : index === 2 ? '<img src=x onerror="window.feedInjected=true">' : index === 3 ? `${username} With An Intentionally Long Display Name` : username,
      avatar_url: `/api/avatars/${10_000 + number}`,
      profile_url: `/api/players/by-id/${10_000 + number}/profile?game=${product}`,
    },
    achievement: product === "zilch" ? {
      key: "zilch.first_game",
      title: "Erster Wurf",
      description: "Deine erste abgeschlossene Zilch-Partie wurde gespeichert.",
      title_key: "zilch.achievement.first_game.title",
      description_key: "zilch.achievement.first_game.description",
      icon_key: "die",
      points: resolvedDifficulty === "hard" ? 8 : resolvedDifficulty === "medium" ? 5 : 1,
      difficulty: resolvedDifficulty,
    } : {
      key: "games_played_10",
      title: "Warmgelaufen",
      description: "10 Spiele mit deinem Konto abgeschlossen.",
      icon_key: "games",
      points: resolvedDifficulty === "hard" ? 8 : resolvedDifficulty === "medium" ? 5 : 1,
      difficulty: resolvedDifficulty,
    },
  };
  if (product === "zdwa" && page === 1 && index === 0) item.game_url = "/ergebnis/feed-result-1";
  return item;
}

async function installFeedFixture(page, product, state = {}) {
  const { endpoint } = products[product];
  const requests = [];
  await page.route(`**${endpoint}**`, async route => {
    const url = new URL(route.request().url());
    const requestedPage = Number(url.searchParams.get("page") || 1);
    const difficulty = url.searchParams.get("difficulty");
    requests.push({ page: requestedPage, difficulty, limit: url.searchParams.get("limit") });
    if (state.failures > 0) {
      state.failures -= 1;
      return route.fulfill({ status: 503, json: {} });
    }
    const total = state.empty ? 0 : difficulty ? 20 : 23;
    const pages = Math.ceil(total / 20);
    const itemCount = requestedPage < pages ? 20 : total - ((requestedPage - 1) * 20);
    const items = requestedPage <= pages
      ? Array.from({ length: itemCount }, (_, index) => feedItem(product, {
        index, page: requestedPage, difficulty,
      }))
      : [];
    await route.fulfill({ json: {
      items,
      page: requestedPage,
      page_size: 20,
      total,
      pages,
      has_previous: requestedPage > 1,
      has_next: requestedPage < pages,
      difficulty,
    } });
  });
  await page.route("**/api/avatars/*", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="#777"/></svg>',
  }));
  return requests;
}

async function openFeedPage(browser, baseURL, {
  product,
  language = "de",
  theme = "light",
  viewport = { width: 390, height: 844 },
  suffix = "",
  feedState = {},
} = {}) {
  const context = await browser.newContext({
    baseURL,
    viewport,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    timezoneId: "Europe/Zurich",
  });
  await context.addInitScript(({ language: selectedLanguage, themeKey, selectedTheme }) => {
    localStorage.setItem("zdwa_language", selectedLanguage);
    localStorage.setItem(themeKey, selectedTheme);
  }, { language, themeKey: products[product].themeKey, selectedTheme: theme });
  const page = await context.newPage();
  if (product === "zilch") {
    // The disposable test server keeps Zilch in preview. Authenticate the
    // document request as well as fetches; mocking /auth/me alone cannot do so.
    const admin = await page.request.post("/api/auth/login", {
      data: { username: "Admin", password: "temporary-password-123" },
    });
    expect(admin.ok()).toBeTruthy();
    const created = await page.request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": (await admin.json()).user.csrf_token },
      data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
    });
    expect([201, 400]).toContain(created.status());
    const login = await page.request.post("/api/auth/login", {
      data: { username: "Mani", password: "mani-preview-password-123" },
    });
    expect(login.ok()).toBeTruthy();
    await page.route("**/api/auth/me", async route => {
      const response = await route.fetch();
      const auth = await response.json();
      await route.fulfill({ response, json: {
        ...auth,
        user: {
          ...auth.user,
          must_change_password: false,
          preferences: { ...auth.user.preferences, preferred_language: language },
        },
      } });
    });
  }
  const requests = await installFeedFixture(page, product, feedState);
  await page.goto(`${products[product].path}${suffix}`);
  return { context, page, requests };
}

async function showAchievements(page, language) {
  const rankingsTab = page.locator('[data-achievement-tab="rankings"]');
  const achievementsTab = page.locator('[data-achievement-tab="achievements"]');
  await expect(rankingsTab).toHaveText(copy[language].rankings);
  await expect(rankingsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-achievement-view="rankings"]')).toBeVisible();
  await achievementsTab.tap();
  await expect(achievementsTab).toHaveText(copy[language].achievements);
  await expect(achievementsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-achievement-view="rankings"]')).toBeHidden();
  const panel = page.locator('[data-achievement-view="achievements"]');
  await expect(panel).toBeVisible();
  const feed = page.locator("[data-achievement-feed]");
  await expect(feed).toHaveAttribute("data-achievement-view", "achievements");
  await expect(feed).not.toHaveAttribute("aria-busy", "true");
  return feed;
}

async function expectRequest(requests, expected) {
  await expect.poll(() => requests.at(-1)).toEqual({ ...expected, limit: null });
}

async function tapFilter(feed, requests, difficulty, expectedPage = 1) {
  const button = feed.locator(`[data-achievement-filter="${difficulty}"]`);
  await button.tap();
  await expectRequest(requests, { page: expectedPage, difficulty });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  for (const other of ["easy", "medium", "hard"].filter(value => value !== difficulty)) {
    await expect(feed.locator(`[data-achievement-filter="${other}"]`)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(feed.locator("[data-achievement-item]")).toHaveCount(20);
  await expect(feed.locator("[data-achievement-item]").first()).toHaveAttribute("data-achievement-difficulty", difficulty);
}

async function expectChronologicalPage(feed, count) {
  const items = feed.locator("[data-achievement-item]");
  await expect(items).toHaveCount(count);
  const timestamps = await items.locator("time").evaluateAll(times => times.map(time => ({
    label: time.textContent.trim(),
    value: time.getAttribute("datetime"),
  })));
  expect(timestamps).toHaveLength(count);
  expect(timestamps.every(timestamp => timestamp.label && timestamp.value)).toBe(true);
  expect(timestamps.map(timestamp => Date.parse(timestamp.value))).toEqual(
    [...timestamps].map(timestamp => Date.parse(timestamp.value)).sort((a, b) => b - a),
  );
}

test("ZDWA shows the newest public achievements, result links, paging, and exclusive filters on mobile", async ({ browser, baseURL }) => {
  const { context, page, requests } = await openFeedPage(browser, baseURL, { product: "zdwa", language: "de" });
  try {
    const feed = await showAchievements(page, "de");
    await expectRequest(requests, { page: 1, difficulty: null });
    await expectChronologicalPage(feed, 20);
    await expect(feed.locator('button[data-achievement-page="0"]')).toBeDisabled();

    const first = feed.locator("[data-achievement-item]").first();
    await expect(first.locator(".achievement-feed-player-link")).toContainText("Newest Player 01");
    await expect(first.locator(".achievement-feed-player-link")).toHaveAttribute("href", "/api/players/by-id/10001/profile?game=zdwa");
    await expect(first).toContainText(copy.de.zdwaTitle);
    await expect(first.locator(".achievement-feed-difficulty")).toHaveText(copy.de.easy);
    await expect(first.locator("time")).toHaveAttribute("datetime", "2026-09-22T11:59:00.000Z");
    await expect(first.locator("[data-achievement-game-link]")).toHaveAttribute("href", "/ergebnis/feed-result-1");
    expect((await first.locator("[data-achievement-game-link]").boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(feed.locator("[data-achievement-item]").nth(1).locator("[data-achievement-game-link]")).toHaveCount(0);

    // Follow the real result page through its existing API projection, rather
    // than replacing the destination document with a placeholder page.
    await page.route("**/api/game_from_leaderboard/feed-result-1", route => route.fulfill({ json: {
      game_id: "feed-result-1",
      gamename: "Achievement-Feed-Partie",
      finished_at: "2026-09-22T11:59:00.000Z",
      mode: "1",
      hardcore: false,
      players: [{
        id: "feed-player",
        name: "Newest Player 01",
        earned_achievements: [{ key: "games_played_10", name: "Warmgelaufen", description: "10 Spiele mit deinem Konto abgeschlossen.", icon_key: "games", points: 1 }],
      }],
      scoreboards: { "feed-player": { reihen: [{ index: 1, rows: { "1": 1 } }] } },
      chat_history: [],
      admin_edits: {},
    } }));
    await first.locator("[data-achievement-game-link]").tap();
    await expect(page).toHaveURL(/\/ergebnis\/feed-result-1$/);
    await expect(page.locator(".readonly-achievements")).toContainText("Newest Player 01");
    await expect(page.locator(".readonly-achievements")).toContainText("Warmgelaufen");
    await page.goBack();
    await expect(feed).toBeVisible();
    await expectChronologicalPage(feed, 20);

    await feed.locator('button[data-achievement-page="2"]:visible').last().tap();
    await expectRequest(requests, { page: 2, difficulty: null });
    await expectChronologicalPage(feed, 3);
    await expect(feed.locator("[data-achievement-item]").first()).toContainText("PageTwo Player 21");
    await expect(feed.locator('button[data-achievement-page="3"]')).toBeDisabled();

    await tapFilter(feed, requests, "easy");
    await tapFilter(feed, requests, "medium");
    await tapFilter(feed, requests, "hard");
    await feed.locator('[data-achievement-filter="hard"]').tap();
    await expectRequest(requests, { page: 1, difficulty: null });
    for (const difficulty of ["easy", "medium", "hard"]) {
      await expect(feed.locator(`[data-achievement-filter="${difficulty}"]`)).toHaveAttribute("aria-pressed", "false");
    }
    await expectChronologicalPage(feed, 20);

    await page.locator('[data-achievement-tab="rankings"]').tap();
    await expect(page.locator('[data-achievement-view="rankings"]')).toBeVisible();
    await expect(page.locator('[data-achievement-view="achievements"]')).toBeHidden();
  } finally {
    await context.close();
  }
});

test("Zilch translates the feed without exposing private game links and keeps the same controls", async ({ browser, baseURL }) => {
  const { context, page, requests } = await openFeedPage(browser, baseURL, { product: "zilch", language: "en" });
  try {
    const feed = await showAchievements(page, "en");
    await expectRequest(requests, { page: 1, difficulty: null });
    await expectChronologicalPage(feed, 20);
    const first = feed.locator("[data-achievement-item]").first();
    await expect(first).toContainText(copy.en.zilchTitle);
    await expect(first.locator(".achievement-feed-difficulty")).toHaveText(copy.en.easy);
    await expect(first.locator(".achievement-feed-player-link")).toHaveAttribute("href", "/api/players/by-id/10001/profile?game=zilch");
    await expect(feed.locator("[data-achievement-game-link], a[href^='/ergebnis/']")).toHaveCount(0);
    const names = feed.locator(".achievement-feed-player-name");
    await expect(names.nth(1)).toHaveText("Insgesamt");
    await expect(names.nth(1)).toHaveAttribute("translate", "no");
    await expect(names.nth(2)).toHaveText('<img src=x onerror="window.feedInjected=true">');
    await expect(names.nth(2).locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => window.feedInjected)).toBeUndefined();

    await feed.locator('button[data-achievement-page="2"]:visible').last().tap();
    await expectRequest(requests, { page: 2, difficulty: null });
    await expectChronologicalPage(feed, 3);
    await tapFilter(feed, requests, "easy");
    await tapFilter(feed, requests, "medium");
    await tapFilter(feed, requests, "hard");
    await feed.locator('[data-achievement-filter="hard"]').tap();
    await expectRequest(requests, { page: 1, difficulty: null });
    await expect(feed.locator('[data-achievement-filter="hard"]')).toHaveAttribute("aria-pressed", "false");
    await expect(feed.locator("[data-achievement-item]")).toHaveCount(20);
  } finally {
    await context.close();
  }
});

test("achievement requests recover from an error, show an empty state, and ignore a stale filter response", async ({ browser, baseURL }) => {
  const feedState = { failures: 1, empty: true };
  const { context, page, requests } = await openFeedPage(browser, baseURL, {
    product: "zdwa", suffix: "?view=achievements", feedState,
  });
  let releaseDelayed;
  try {
    const feed = page.locator("[data-achievement-feed]");
    await expect(feed.locator("[data-achievement-feed-status]")).toContainText("Neueste Achievements sind gerade nicht verfügbar.");
    await feed.getByRole("button", { name: "Erneut versuchen", exact: true }).tap();
    await expect(feed.getByText("Noch keine passenden Achievements", { exact: true })).toBeVisible();
    await expect(feed.locator("[data-achievement-item], [data-achievement-page]")).toHaveCount(0);

    feedState.empty = false;
    const delayed = new Promise(resolve => { releaseDelayed = resolve; });
    await page.route(`**${products.zdwa.endpoint}**`, async route => {
      if (new URL(route.request().url()).searchParams.get("difficulty") === "easy") await delayed;
      await route.fallback();
    });
    const easyRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("difficulty") === "easy");
    await feed.locator('[data-achievement-filter="easy"]').tap();
    await easyRequest;
    await tapFilter(feed, requests, "medium");
    const staleResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get("difficulty") === "easy");
    releaseDelayed();
    await (await staleResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(feed).not.toHaveAttribute("aria-busy", "true");
    await expect(feed.locator('[data-achievement-filter="medium"]')).toHaveAttribute("aria-pressed", "true");
    await expect(feed.locator("[data-achievement-item]").first()).toHaveAttribute("data-achievement-difficulty", "medium");
    await expect(feed.locator("[data-achievement-item]").first()).toContainText("medium-Newest Player 01");
  } finally {
    releaseDelayed?.();
    await context.close();
  }
});

for (const product of Object.keys(products)) {
  test(`${product} achievement deep links survive reload and player-search links open the finder`, async ({ browser, baseURL }) => {
    const { context, page } = await openFeedPage(browser, baseURL, {
      product,
      suffix: "?view=achievements",
    });
    try {
      const feed = page.locator("[data-achievement-feed]");
      const achievementsTab = page.locator('[data-achievement-tab="achievements"]');
      await expect(achievementsTab).toHaveAttribute("aria-selected", "true");
      await expect(feed).toBeVisible();
      await expect(feed.locator("[data-achievement-item]")).toHaveCount(20);
      await page.reload();
      await expect(achievementsTab).toHaveAttribute("aria-selected", "true");
      await expect(feed).toBeVisible();
      await expect(feed.locator("[data-achievement-item]")).toHaveCount(20);

      // The account's existing "Find players" action must still reach its
      // useful endpoint, including when sharing an achievements-view URL.
      await page.goto(`${products[product].path}?view=achievements#player-search`);
      await expect(page.locator('[data-achievement-tab="rankings"]')).toHaveAttribute("aria-selected", "true");
      await expect(feed).toBeHidden();
      await expect(page.locator("#player-search").getByRole("searchbox")).toBeFocused();
    } finally {
      await context.close();
    }
  });
}

async function expectTouchLayout(page, feed, viewport) {
  await page.setViewportSize(viewport);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const geometry = await feed.evaluate(element => {
    const bounds = node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const items = [...element.querySelectorAll("[data-achievement-item]")].map(bounds);
    const targets = [...document.querySelectorAll("[data-achievement-tab], [data-achievement-filter], [data-achievement-page], .achievement-feed-player-link, [data-achievement-game-link]")]
      .filter(node => node.getClientRects().length)
      .map(node => ({ ...bounds(node), label: node.textContent.trim() }));
    const labels = [...element.querySelectorAll("time, .achievement-feed-award-copy > strong, .achievement-feed-difficulty")]
      .map(node => ({ ...bounds(node), card: bounds(node.closest("[data-achievement-item]")) }));
    return {
      documentWidth: document.documentElement.scrollWidth,
      feedWidth: element.clientWidth,
      feedScrollWidth: element.scrollWidth,
      items,
      targets,
      labels,
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.feedScrollWidth).toBeLessThanOrEqual(geometry.feedWidth + 1);
  for (const item of geometry.items) {
    expect(item.left).toBeGreaterThanOrEqual(-1);
    expect(item.right).toBeLessThanOrEqual(viewport.width + 1);
  }
  for (const target of geometry.targets) {
    expect(target.width, `${target.label} width`).toBeGreaterThanOrEqual(44);
    expect(target.height, `${target.label} height`).toBeGreaterThanOrEqual(44);
    expect(target.left, `${target.label} left edge`).toBeGreaterThanOrEqual(-1);
    expect(target.right, `${target.label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
  }
  for (const label of geometry.labels) {
    expect(label.left).toBeGreaterThanOrEqual(label.card.left - 1);
    expect(label.right).toBeLessThanOrEqual(label.card.right + 1);
    expect(label.bottom).toBeLessThanOrEqual(label.card.bottom + 1);
  }
  if (viewport.width < 700) {
    expect(geometry.items[1].top).toBeGreaterThanOrEqual(geometry.items[0].bottom);
  }
}

for (const [product, configuration] of Object.entries(products)) {
  for (const [index, theme] of configuration.themes.entries()) {
    const language = index % 2 ? "en" : "de";
    test(`${product} ${theme} keeps the achievement feed touch-friendly on phone and iPad 12.9 orientations`, async ({ browser, baseURL }, testInfo) => {
      const { context, page } = await openFeedPage(browser, baseURL, { product, language, theme });
      try {
        const feed = await showAchievements(page, language);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(feed.getByRole("heading", { name: copy[language].achievements, exact: true })).toBeVisible();
        await expect(feed.locator('[data-achievement-filter="easy"]')).toHaveText(copy[language].easy);
        await expect(feed.locator('[data-achievement-filter="medium"]')).toHaveText(copy[language].medium);
        await expect(feed.locator('[data-achievement-filter="hard"]')).toHaveText(copy[language].hard);
        await expect(feed.locator("[data-achievement-item]").first()).toContainText(copy[language][`${product}Title`]);
        const first = feed.locator("[data-achievement-item]").first();
        await expectTextContrast(first.locator(".achievement-feed-player-name"));
        await expectTextContrast(first.locator("time"));
        await expectTextContrast(first.locator(".achievement-feed-award-copy > strong"));
        await expectTextContrast(feed.locator('[data-achievement-filter="easy"]'));
        await expectTextContrast(page.locator('[data-achievement-tab="achievements"]'));
        const easyFilter = feed.locator('[data-achievement-filter="easy"]');
        await easyFilter.tap();
        await expect(easyFilter).toHaveAttribute("aria-pressed", "true");
        await expectTextContrast(easyFilter);
        await easyFilter.tap();
        await expect(easyFilter).toHaveAttribute("aria-pressed", "false");
        await expect(feed.locator("[data-achievement-item]")).toHaveCount(20);
        if (theme === "lcars") {
          const inactiveBackground = await feed.locator('[data-achievement-filter="medium"]').evaluate(element => getComputedStyle(element).backgroundColor);
          await expect.poll(() => easyFilter.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(inactiveBackground);
        }
        for (const viewport of [
          { width: 390, height: 844 },
          { width: 1024, height: 1366 },
          { width: 1366, height: 1024 },
        ]) {
          await expectTouchLayout(page, feed, viewport);
          if (viewport.width >= 700) await expectTextContrast(feed.locator('[data-achievement-page][aria-current="page"]'));
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: testInfo.outputPath(`achievement-feed-${product}-${theme}-${viewport.width}x${viewport.height}.png`) });
        }
      } finally {
        await context.close();
      }
    });
  }
}
