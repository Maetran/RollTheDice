const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");

test.use({ serviceWorkers: "block" });

async function fixture(page, game = "zdwa", language = "de") {
  const response = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(response.ok()).toBeTruthy();
  await page.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
  await page.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    // The actual isolated founder plus the supported public Zilch projection
    // gives all three shells the same three-choice UI. Backend tests exercise
    // the real per-request audience independently of this browser fixture.
    await route.fulfill({ response, json: {
      ...auth, game_access: { ...auth.game_access, zilch_public: true, watten_preview: false },
      user: { ...auth.user, must_change_password: false,
        game_access: { ...auth.user.game_access, watten_preview: false },
        preferences: { ...auth.user.preferences, preferred_language: language } },
    } });
  });
  if (game === "zilch") {
    const template = await readFile("app/static/zilch-lobby.html", "utf8");
    const body = template.includes('data-zilch-public-lobby="true"') ? template
      : template.replace("data-zilch-root", 'data-zilch-root data-zilch-public-lobby="true"');
    await page.route("**/zilch", route => route.fulfill({ contentType: "text/html", body }));
    await page.route("**/api/games?**", route => route.fulfill({ json: { games: [] } }));
    await page.route("**/api/zilch/leaderboards?**", route => route.fulfill({ json: { entries: [] } }));
  }
  await page.goto(game === "hausdepp" ? "/hausdepp/regeln" : game === "zilch" ? "/zilch" : "/regeln");
  await expect(page.locator("[data-game-picker]")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

const projection = (zdwa, zilch, hausdepp) => ({ games: {
  zdwa: { players: zdwa }, zilch: { players: zilch }, hausdepp: { players: hausdepp },
} });
const count = (page, game) => page.locator(`#suiteGameMenu [data-game-entry="${game}"] [data-game-activity]`);
const open = page => page.locator("[data-game-picker]").click();

for (const game of ["zdwa", "zilch", "hausdepp"]) {
  for (const language of ["de", "en"]) {
    test(`${language}: ${game} chooser shows live human counts for every available game`, async ({ page }) => {
      let requests = 0;
      await page.route("**/api/game-activity", route => {
        requests += 1;
        return route.fulfill({ json: projection(0, 1, 2) });
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await fixture(page, game, language);
      expect(requests).toBe(0);
      await open(page);
      await expect(count(page, "zdwa")).toHaveText(language === "de" ? "0 spielen das gerade" : "0 people playing now");
      await expect(count(page, "zilch")).toHaveText(language === "de" ? "1 spielt das gerade" : "1 person playing now");
      await expect(count(page, "hausdepp")).toHaveText(language === "de" ? "2 spielen das gerade" : "2 people playing now");
      await expect(page.locator("#suiteGameMenu [aria-current=page]")).toHaveAttribute("data-game-entry", game);
      expect(requests).toBe(1);
      const bounds = await page.locator("#suiteGameMenu").boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
      expect(bounds.height).toBeLessThanOrEqual(844);
      await page.keyboard.press("Escape");
      await expect(page.locator("#suiteGameMenu")).toHaveCount(0);
    });
  }
}

test("loading, periodic refresh and failures are distinct from zero; a closed picker stops polling", async ({ page }) => {
  let first;
  let requests = 0;
  await page.route("**/api/game-activity", async route => {
    requests += 1;
    if (requests === 1) {
      first = route;
      return;
    }
    if (requests === 3) return route.fulfill({ status: 503, json: { detail: "unavailable" } });
    return route.fulfill({ json: projection(requests, 1, 0) });
  });
  await fixture(page);
  await page.clock.install();
  await open(page);
  await expect(count(page, "zdwa")).toHaveText("Spielerzahl wird geladen …");
  await expect(count(page, "zdwa")).toHaveAttribute("data-state", "loading");
  await expect.poll(() => Boolean(first)).toBe(true);
  await first.fulfill({ json: projection(0, 1, 2) });
  await expect(count(page, "zdwa")).toHaveText("0 spielen das gerade");
  await page.clock.runFor(15_100);
  await expect(count(page, "zdwa")).toHaveText("2 spielen das gerade");
  await page.clock.runFor(15_100);
  for (const game of ["zdwa", "zilch", "hausdepp"]) {
    await expect(count(page, game)).toHaveText("Spielerzahl gerade nicht verfügbar");
    await expect(count(page, game)).toHaveAttribute("data-state", "unavailable");
  }
  await page.keyboard.press("Escape");
  const closedRequests = requests;
  await page.clock.runFor(45_100);
  expect(requests).toBe(closedRequests);
  await open(page);
  await expect(count(page, "zdwa")).toHaveText("4 spielen das gerade");
});

test("an old response cannot replace a reopened picker and missing private counts are unavailable", async ({ page }) => {
  let old;
  let requests = 0;
  await page.route("**/api/game-activity", route => {
    requests += 1;
    if (requests === 1) { old = route; return; }
    return route.fulfill({ json: { games: { zdwa: { players: 5 }, zilch: { players: -1 },
      not_an_available_game: { players: 999 } } } });
  });
  await fixture(page, "hausdepp", "en");
  await open(page);
  await expect(count(page, "zdwa")).toHaveText("Loading player count …");
  await expect.poll(() => Boolean(old)).toBe(true);
  await page.keyboard.press("Escape");
  await open(page);
  await expect(count(page, "zdwa")).toHaveText("5 people playing now");
  await old.fulfill({ json: projection(99, 99, 99) }).catch(() => {});
  await expect(count(page, "zdwa")).toHaveText("5 people playing now");
  for (const game of ["zilch", "hausdepp"]) {
    await expect(count(page, game)).toHaveText("Player count currently unavailable");
  }
  await expect(page.locator("#suiteGameMenu [data-game-entry]")).toHaveCount(3);
  await expect(page.locator("#suiteGameMenu")).not.toContainText("999");
});

test("the public picker requests one scoped projection and never creates a private game row", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: false, user: null,
    game_access: { zilch_public: true, zilch_preview: false, hausdepp_preview: false },
  } }));
  const urls = [];
  await page.route("**/api/game-activity**", route => {
    urls.push(route.request().url());
    return route.fulfill({ json: { games: { zdwa: { players: 3 }, zilch: { players: 0 } } } });
  });
  await page.goto("/regeln");
  await expect(page.locator("[data-game-picker]")).toBeVisible();
  await open(page);
  await expect(count(page, "zdwa")).toHaveText("3 spielen das gerade");
  await expect(count(page, "zilch")).toHaveText("0 spielen das gerade");
  await expect(page.locator("#suiteGameMenu [data-game-entry]")).toHaveCount(2);
  await expect(page.locator('#suiteGameMenu [data-game-entry="hausdepp"]')).toHaveCount(0);
  expect(urls).toHaveLength(1);
  expect(new URL(urls[0]).search).toBe("");
});
