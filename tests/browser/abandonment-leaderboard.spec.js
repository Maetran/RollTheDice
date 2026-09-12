const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

const dangerousName = '<img src=x onerror="alert(1)">';
const longName = "AlexandriaMitEinemSehrLangenNamen";
const recentEntries = [
  { rank: 1, user_id: 101, username: longName, count: 79 },
  { rank: 2, user_id: 102, username: dangerousName, count: 45 },
  { rank: 3, user_id: 103, username: "Müller & Freunde/Team", count: 12 },
  { rank: 4, user_id: 104, username: "RecentFourth", count: 9 },
];
const alltimeEntries = [
  { rank: 1, user_id: 103, username: "Müller & Freunde/Team", count: 987 },
  { rank: 1, user_id: 101, username: longName, count: 987 },
  { rank: 3, user_id: 102, username: dangerousName, count: 321 },
  { rank: 4, user_id: 105, username: "AlltimeFourth", count: 100 },
];

function finishedGame(name, points) {
  return {
    game_id: null,
    name,
    points,
    finished_at: "2026-09-12T10:00:00.000Z",
    linked_players: [],
  };
}

function leaderboard(abandonments = { recent: recentEntries, alltime: alltimeEntries }) {
  return {
    recent: {
      normal: [finishedGame("NormalResult", 800)],
      hc: [finishedGame("HardcoreResult", 600)],
    },
    alltime: {
      normal: [finishedGame("NormalAlltimeResult", 900)],
      hc: [finishedGame("HardcoreAlltimeResult", 700)],
    },
    shame: {
      recent: [finishedGame("LowScoreResult", 100)],
      alltime: [finishedGame("LowScoreAlltimeResult", 80)],
    },
    last_games: [finishedGame("LastGameResult", 500)],
    stats: { games_played: 7, average_points: { normal: {}, hc: {} } },
    ...(abandonments === null ? {} : { abandonments }),
  };
}

async function setLanguage(page, language) {
  await page.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
}

async function expectRanking(list, entries) {
  await expect(list).toHaveJSProperty("tagName", "OL");
  const rows = list.locator(":scope > li");
  await expect(rows).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const row = rows.nth(index);
    const entry = entries[index];
    const link = row.getByRole("link");
    await expect(link).toHaveText(entry.username);
    await expect(link).toHaveAttribute("href", `/api/players/by-id/${entry.user_id}/profile?game=zdwa`);
    await expect(row).toHaveAttribute("data-user-id", String(entry.user_id));
    await expect(row.locator(".abandonment-rank")).toHaveText(`${entry.rank}.`);
    await expect(row.locator(".abandonment-count")).toContainText(String(entry.count));
  }
}

test("English abandonment rankings preserve names matching translated UI text after refresh", async ({ page }) => {
  await setLanguage(page, "en");
  await page.clock.install();
  const entry = { rank: 1, user_id: 203, username: "Insgesamt", count: 6 };
  await page.route("**/api/leaderboard", route => route.fulfill({
    json: leaderboard({ recent: [entry], alltime: [entry] }),
  }));
  await page.goto("/");

  async function expectOriginalName() {
    for (const period of ["Recent", "Alltime"]) {
      const link = page.locator(`#abandonment${period}List a`);
      await expect(link).toHaveText("Insgesamt");
      await expect(link).toHaveAttribute("href", "/api/players/by-id/203/profile?game=zdwa");
      await expect(link).toHaveAttribute("translate", "no");
    }
    await expect(page.locator("#abandonmentAlltimeTitle")).toHaveText("All time Top 3");
  }

  await expectOriginalName();
  const refresh = page.waitForResponse("**/api/leaderboard");
  await page.clock.fastForward(10_001);
  await refresh;
  await expectOriginalName();
});

async function expectFitsViewport(page) {
  const layout = await page.evaluate(() => {
    const section = document.querySelector("#abandonmentLeaderboard");
    const selectors = "ol, li, a, h2, h3";
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      sectionWidth: section.clientWidth,
      sectionScrollWidth: section.scrollWidth,
      bounds: [...section.querySelectorAll(selectors)].map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.sectionScrollWidth).toBeLessThanOrEqual(layout.sectionWidth);
  for (const bounds of layout.bounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(layout.viewportWidth);
  }
}

const translations = {
  de: {
    subtitle: "Meiste Spiele abgebrochen",
    recent: "Letzte 10 Tage",
    alltime: "Insgesamt",
    empty: "Noch keine selbst abgebrochenen Partien.",
    error: "Fehler beim Laden",
    lastTab: "Letzte 10 Spiele",
  },
  en: {
    subtitle: "Most games abandoned",
    recent: "Last 10 days",
    alltime: "All time",
    empty: "No games abandoned by their players yet.",
    error: "Unable to load",
    lastTab: "Last 10 Games",
  },
};

for (const [language, copy] of Object.entries(translations)) {
  for (const width of [320, 1280]) {
    test(`abandonment rankings show the top three safely without overflow (${language}, ${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await setLanguage(page, language);
      await page.route("**/api/leaderboard", route => route.fulfill({ json: leaderboard() }));
      await page.goto("/");

      const section = page.locator("#abandonmentLeaderboard");
      await expect(section).toBeVisible();
      await expect(section.getByRole("heading", { name: "Wall of Shame", exact: true })).toBeVisible();
      await expect(section).toContainText(copy.subtitle);
      await expect(section.getByRole("heading", { name: `${copy.recent} Top 3`, exact: true })).toBeVisible();
      await expect(section.getByRole("heading", { name: `${copy.alltime} Top 3`, exact: true })).toBeVisible();
      await expectRanking(page.locator("#abandonmentRecentList"), recentEntries);
      await expectRanking(page.locator("#abandonmentAlltimeList"), alltimeEntries);
      await expect(section).not.toContainText("RecentFourth");
      await expect(section).not.toContainText("AlltimeFourth");
      await expect(section.locator("img, script, [onerror]")).toHaveCount(0);
      await expectFitsViewport(page);
      await section.screenshot({ path: `/tmp/rollthedice-abandonment-${language}-${width}.png` });
    });
  }

  test(`empty and missing abandonment rankings retain their localized empty state (${language})`, async ({ page }) => {
    await setLanguage(page, language);
    await page.clock.install();
    let payload = leaderboard({ recent: [], alltime: [] });
    await page.route("**/api/leaderboard", route => route.fulfill({ json: payload }));
    await page.goto("/");

    for (const period of ["Recent", "Alltime"]) {
      await expect(page.locator(`#abandonment${period}Status`)).toHaveText(copy.empty);
      await expect(page.locator(`#abandonment${period}List`)).toBeHidden();
      await expect(page.locator(`#abandonment${period}List li`)).toHaveCount(0);
    }

    payload = leaderboard(null);
    const refresh = page.waitForResponse("**/api/leaderboard");
    await page.clock.fastForward(10_001);
    await refresh;
    for (const period of ["Recent", "Alltime"]) {
      await expect(page.locator(`#abandonment${period}Status`)).toHaveText(copy.empty);
      await expect(page.locator(`#abandonment${period}List`)).toBeHidden();
      await expect(page.locator(`#abandonment${period}List li`)).toHaveCount(0);
    }
    await expect(page.locator("#recentTable")).toContainText("NormalResult");
  });

  test(`abandonment rankings recover from a failed refresh without reloading the page (${language})`, async ({ page }) => {
    await setLanguage(page, language);
    await page.clock.install();
    let fail = false;
    await page.route("**/api/leaderboard", route => fail
      ? route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } })
      : route.fulfill({ json: leaderboard() }));
    await page.goto("/");
    await expectRanking(page.locator("#abandonmentRecentList"), recentEntries);

    fail = true;
    let refresh = page.waitForResponse("**/api/leaderboard");
    await page.clock.fastForward(10_001);
    await refresh;
    for (const period of ["Recent", "Alltime"]) {
      await expect(page.locator(`#abandonment${period}Status`)).toHaveText(copy.error);
      await expect(page.locator(`#abandonment${period}List`)).toBeHidden();
      await expect(page.locator(`#abandonment${period}List li`)).toHaveCount(0);
    }

    fail = false;
    refresh = page.waitForResponse("**/api/leaderboard");
    await page.clock.fastForward(10_001);
    await refresh;
    await expectRanking(page.locator("#abandonmentRecentList"), recentEntries);
    await expectRanking(page.locator("#abandonmentAlltimeList"), alltimeEntries);
    await expect(page.locator("#abandonmentLeaderboard")).not.toContainText(copy.error);
  });

  test(`existing leaderboard tabs remain independent of the abandonment rankings (${language})`, async ({ page }) => {
    await setLanguage(page, language);
    await page.route("**/api/leaderboard", route => route.fulfill({ json: leaderboard() }));
    await page.goto("/");

    const cases = [
      ["#lbTabHC", "Top Hardcore", "HardcoreResult", "HardcoreAlltimeResult"],
      ["#lbTabShame", "Hall of Shame", "LowScoreResult", "LowScoreAlltimeResult"],
      ["#lbTabLast", copy.lastTab, "LastGameResult", null],
      ["#lbTabNormal", "Top Normal", "NormalResult", "NormalAlltimeResult"],
    ];
    for (const [id, label, recentName, alltimeName] of cases) {
      const tab = page.locator(id);
      await expect(tab).toHaveText(label);
      await tab.click();
      await expect(tab).toHaveClass(/active/);
      await expect(page.locator("#recentTable")).toContainText(recentName);
      if (alltimeName) {
        await expect(page.locator("#alltimeBox")).toBeVisible();
        await expect(page.locator("#alltimeTable")).toContainText(alltimeName);
      } else {
        await expect(page.locator("#alltimeBox")).toBeHidden();
      }
      await expect(page.locator("#abandonmentLeaderboard")).toBeVisible();
      await expectRanking(page.locator("#abandonmentRecentList"), recentEntries);
      await expectRanking(page.locator("#abandonmentAlltimeList"), alltimeEntries);
      const sectionBelowLeaderboard = await page.evaluate(() => {
        const leaderboard = document.querySelector(".leaderboards").getBoundingClientRect();
        const section = document.querySelector("#abandonmentLeaderboard").getBoundingClientRect();
        return section.top >= leaderboard.bottom;
      });
      expect(sectionBelowLeaderboard).toBe(true);
    }
  });
}
