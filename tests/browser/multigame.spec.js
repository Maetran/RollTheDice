const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createUser(page, username, password, role = "user") {
  return page.evaluate(async ({ username, password, role }) => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({ username, temporary_password: password, role }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { username, password, role });
}

async function ensurePreviewAccounts(page) {
  const mani = await createUser(page, "Mani", "mani-preview-password-123", "admin");
  const preview = await createUser(page, "PreviewFriend", "preview-friend-password-123", "user");
  expect([201, 400]).toContain(mani.status);
  expect([201, 400]).toContain(preview.status);
}

async function enabledLocator(page, selector) {
  const locator = page.locator(selector);
  if (await locator.count() && await locator.first().isEnabled()) return locator.first();
  return null;
}

async function completeOpeningRoll(pages) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await pages[0].locator("[data-zilch-start-roll]").count() === 0) return;
    let clicked = false;
    for (const page of pages) {
      const button = await enabledLocator(page, "[data-zilch-start-roll]");
      if (!button) continue;
      await button.click();
      clicked = true;
      await page.waitForTimeout(120);
    }
    if (!clicked) await pages[0].waitForTimeout(180);
  }
  throw new Error("opening roll did not resolve after repeated attempts");
}

async function selectableQuickHold(pages, { preferNonHot = false } = {}) {
  const selectors = preferNonHot
    ? [".zilch-quick-hold:not(.zilch-quick-hold--hot)", ".zilch-quick-hold"]
    : [".zilch-quick-hold"];
  for (const selector of selectors) {
    for (const page of pages) {
      const quickHold = await enabledLocator(page, selector);
      if (quickHold) return { page, quickHold };
    }
  }
  return null;
}

async function rollUntilQuickHold(pages) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const existing = await selectableQuickHold(pages, { preferNonHot: true });
    if (existing) return existing;
    for (const page of pages) {
      const roll = await enabledLocator(page, "[data-zilch-roll]");
      if (!roll) continue;
      await roll.click();
      // The shared server coordinator deliberately rate-limits successive
      // rolls. Waiting here also gives both WebSocket clients a snapshot.
      await page.waitForTimeout(680);
      const quickHold = await selectableQuickHold(pages, { preferNonHot: true });
      if (quickHold) return quickHold;
    }
    await pages[0].waitForTimeout(120);
  }
  throw new Error("no selectable Quick Hold appeared");
}

async function bankWhenPossible(pages) {
  for (let attempt = 0; attempt < 28; attempt += 1) {
    for (const page of pages) {
      const bank = await enabledLocator(page, "[data-zilch-bank]");
      if (bank) {
        await bank.click();
        await page.waitForTimeout(220);
        return page;
      }
    }
    const quickHold = await selectableQuickHold(pages, { preferNonHot: true });
    if (quickHold) {
      await quickHold.quickHold.press("Enter");
      await quickHold.page.waitForTimeout(180);
      continue;
    }
    await rollUntilQuickHold(pages);
  }
  throw new Error("could not reach a bankable Zilch turn");
}

async function visibleGameFacts(page) {
  return page.evaluate(() => ({
    boards: [...document.querySelectorAll("[data-zilch-board-id]")].map(board => ({
      id: board.dataset.zilchBoardId,
      // Number grouping differs deliberately between the German and English
      // contexts; compare the shown score values, not their locale glyph.
      values: [...board.querySelectorAll("dd")].map(value => value.textContent.replace(/[^0-9-]/g, "")),
    })),
    dice: [...document.querySelectorAll(".zilch-die__face")].map(face => face.dataset.value),
  }));
}

function completedZilchResultFixture() {
  return {
    schema_version: 1,
    payload_kind: "zilch_result",
    game_type: "zilch",
    game_id: "browser-zilch-result",
    game_name: "Browser Ergebnis",
    ruleset: "zilch-house-v1",
    play_mode: "multiplayer",
    mode: "2",
    target_score: 10000,
    started_at: "2026-09-03T12:00:00+00:00",
    finished_at: "2026-09-03T12:10:00+00:00",
    duration_seconds: 600,
    participants: [
      {
        position: 0,
        participant_id: "p1",
        player_key: "p1",
        display_name: "Mani",
        username: "Mani",
        user_id: 1,
        participant_type: "human",
        cpu_strategy: null,
      },
      {
        position: 1,
        participant_id: "p2",
        player_key: "p2",
        display_name: "PreviewFriend",
        username: "PreviewFriend",
        user_id: 2,
        participant_type: "human",
        cpu_strategy: null,
      },
    ],
    participant_order: ["p1", "p2"],
    start_roll: {
      attempts: [
        { attempt: 1, rolls: { p1: 2, p2: 2 } },
        { attempt: 2, rolls: { p1: 6, p2: 3 } },
      ],
      winner_id: "p1",
      final_rolls: { p1: 6, p2: 3 },
    },
    boards: {
      p1: {
        participant_id: "p1",
        total_points: 10000,
        round_points: 0,
        zilch_streak: 0,
        rounds: [
          { turn_id: 1, round: 1, event: "bank", points: 8000, total_after: 8000, rolls_used: 2, committed_holds: [] },
          { turn_id: 3, round: 2, event: "zilch", reason: "no_scoring_option", discarded_points: 150, penalty: 0, total_after: 8000, zilch_streak: 1, rolls_used: 1 },
          { turn_id: 5, round: 3, event: "bank", points: 2000, total_after: 10000, rolls_used: 2, committed_holds: [] },
        ],
      },
      p2: {
        participant_id: "p2",
        total_points: 9700,
        round_points: 0,
        zilch_streak: 0,
        rounds: [
          { turn_id: 2, round: 1, event: "bank", points: 9700, total_after: 9700, rolls_used: 2, committed_holds: [] },
          { turn_id: 4, round: 2, event: "zilch", reason: "no_scoring_option", discarded_points: 50, penalty: 500, total_after: 9200, zilch_streak: 3, rolls_used: 1 },
          { turn_id: 6, round: 3, event: "bank", points: 500, total_after: 9700, rolls_used: 2, committed_holds: [] },
        ],
      },
    },
    totals: { p1: 10000, p2: 9700 },
    final_round: { triggered_by: "p1", target_score: 10000, pending_player_ids: [] },
    outcome: {
      status: "completed",
      target_score: 10000,
      totals: { p1: 10000, p2: 9700 },
      winner_ids: ["p1"],
      winner_id: "p1",
      tied: false,
    },
    metrics: {
      highest_banked_round: 8000,
      zilch_count: 2,
      zilch_penalties: [{ participant_id: "p2", turn_id: 4, round: 2, points: 500 }],
      hot_dice_events: 0,
      hot_dice_events_complete: true,
    },
  };
}

async function mockPrivateZilchResultEndpoints(page, result) {
  const history = {
    results: [{
      game_id: result.game_id,
      game_name: result.game_name,
      finished_at: result.finished_at,
      participants: result.participants,
      totals: result.totals,
      outcome: result.outcome,
      result_url: `/zilch/ergebnis/${result.game_id}`,
    }],
  };
  // The installed PWA service worker intentionally owns ordinary fetches in
  // this suite. Stub `fetch` in every future document instead of relying on a
  // route that a service worker may answer before Playwright sees it. This is
  // client-only fixture data; no production test endpoint is introduced.
  await page.addInitScript(({ gameId, historyPayload, resultPayload }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const rawUrl = typeof input === "string" ? input : input?.url;
      const pathname = new URL(rawUrl || window.location.href, window.location.href).pathname;
      if (pathname === "/api/zilch/results") {
        return Promise.resolve(new Response(JSON.stringify(historyPayload), {
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (pathname === `/api/zilch/results/${gameId}`) {
        return Promise.resolve(new Response(JSON.stringify({ result: resultPayload }), {
          headers: { "Content-Type": "application/json" },
        }));
      }
      return originalFetch(input, init);
    };
  }, { gameId: result.game_id, historyPayload: history, resultPayload: result });
}

test("Zilch is a separate permission-gated app mode and its hotkey respects inputs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-game-switch]")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();

  // The bootstrap admin is deliberately not the allowed preview identity.
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await expect(page.locator("[data-game-switch]")).toBeHidden();
  await ensurePreviewAccounts(page);

  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  const switchButton = page.locator("[data-game-switch]");
  await expect(switchButton).toBeVisible();
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
  await expect(page.locator("#zilchMode")).toHaveCount(0);

  // Alt+Shift+Z is intentionally ignored while typing into a Zilch input.
  const lobbyUrl = page.url();
  await page.locator("#zilchGameName").focus();
  await page.keyboard.press("Alt+Shift+Z");
  await expect.poll(() => page.url()).toBe(lobbyUrl);

  await page.locator("#zilchGameName").evaluate(element => element.blur());
  await Promise.all([
    page.waitForURL(/\/$/),
    page.keyboard.press("Alt+Shift+Z"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
  await expect(page.locator("#createGameCard")).toBeVisible();

  await page.locator("[data-game-switch]").click();
  await page.waitForURL(/\/zilch$/);
  await page.click("#zilchLogout");
  await page.waitForURL(/\/$/);
  await expect(page.locator("[data-game-switch]")).toBeHidden();
});

test("two explicitly allowed humans can create, rejoin, and play a private Zilch alpha", async ({ browser, page }) => {
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await ensurePreviewAccounts(page);

  const maniContext = await browser.newContext();
  const previewContext = await browser.newContext();
  const blockedContext = await browser.newContext();
  const mani = await maniContext.newPage();
  const preview = await previewContext.newPage();
  const blocked = await blockedContext.newPage();

  try {
    await mani.goto("/");
    await signIn(mani, "Mani", "mani-preview-password-123");
    await expect(mani.locator("#authBadge")).toContainText("Mani");
    await mani.locator("[data-game-switch]").click();
    await mani.waitForURL(/\/zilch$/);
    await mani.locator("#zilchGameName").fill("Zwei Menschen Alpha");
    await Promise.all([
      mani.waitForURL(/\/zilch\/spiel\/[^/]+$/),
      mani.locator("#zilchCreateForm button[type=submit]").click(),
    ]);
    const gamePath = new URL(mani.url()).pathname;
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(1);
    await expect(mani.locator("[data-zilch-start-roll]")).toHaveCount(0);

    await preview.goto("/");
    await signIn(preview, "PreviewFriend", "preview-friend-password-123");
    await expect(preview.locator("#authBadge")).toContainText("PreviewFriend");
    await Promise.all([
      preview.waitForNavigation({ waitUntil: "domcontentloaded" }),
      preview.locator("[data-language-switcher]").selectOption("en"),
    ]);
    await expect(preview.locator("html")).toHaveAttribute("lang", "en");
    await expect(preview.locator("[data-game-switch]")).toBeVisible();
    await preview.locator("[data-game-switch]").click();
    await preview.waitForURL(/\/zilch$/);
    await expect(preview.getByRole("heading", { name: "Zilch Preview" })).toBeVisible();
    await Promise.all([
      preview.waitForURL(new RegExp(`${gamePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
      preview.locator(`a[href="${gamePath}"]`).click(),
    ]);

    await expect(mani.locator(".zilch-start-roll")).toBeVisible();
    await expect(preview.locator(".zilch-start-roll")).toBeVisible();
    await completeOpeningRoll([mani, preview]);
    await expect(mani.locator("[data-zilch-start-roll]")).toHaveCount(0);
    await expect(preview.locator("[data-zilch-start-roll]")).toHaveCount(0);
    await expect(mani.locator(".zilch-start-roll--resolved")).toBeVisible();
    await expect(preview.locator(".zilch-start-roll--resolved")).toBeVisible();
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await expect(preview.locator("[data-zilch-board-id]")).toHaveCount(2);

    await mani.locator("#zilchChatInput").fill("server chat stays shared");
    await mani.locator("#zilchChatForm button[type=submit]").click();
    await expect(preview.locator("#zilchChatHistory")).toContainText("server chat stays shared");

    await mani.setViewportSize({ width: 1280, height: 900 });
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await mani.setViewportSize({ width: 390, height: 844 });
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    expect(await mani.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mani.emulateMedia({ reducedMotion: "reduce" });

    const selected = await rollUntilQuickHold([mani, preview]);
    await selected.quickHold.press("Enter");
    await selected.page.waitForTimeout(220);
    // A full-dice special can legitimately reset the rack for Hot Dice;
    // ordinary holds mark dice unavailable. In both cases the selected card
    // disappears because the server moved to the next authoritative phase.
    await expect.poll(async () => selected.page.locator(".zilch-quick-hold").count()).toBe(0);
    expect(await visibleGameFacts(mani)).toEqual(await visibleGameFacts(preview));

    await mani.reload();
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await expect(mani.locator("[data-zilch-root]")).toBeVisible();

    const beforeBank = await mani.locator(".zilch-board--active").getAttribute("data-zilch-board-id");
    await bankWhenPossible([mani, preview]);
    await expect.poll(async () => mani.locator(".zilch-board--active").getAttribute("data-zilch-board-id")).not.toBe(beforeBank);

    await blocked.goto("/");
    await signIn(blocked, "Admin", "temporary-password-123");
    await expect(blocked.locator("#authBadge")).toContainText("Admin");
    await expect(blocked.locator("[data-game-switch]")).toBeHidden();
    const invisible = await blocked.evaluate(async () => (await fetch("/api/games?game_type=zilch")).json());
    expect(invisible.games).toEqual([]);
    const forbidden = await blocked.goto(gamePath);
    expect(forbidden?.status()).toBe(403);
  } finally {
    await maniContext.close();
    await previewContext.close();
    await blockedContext.close();
  }
});

test("direct Zilch URLs remain server-protected", async ({ page }) => {
  const response = await page.goto("/zilch");
  expect(response?.status()).toBe(401);
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
  const resultPage = await page.goto("/zilch/ergebnis/not-a-private-result");
  expect(resultPage?.status()).toBe(401);
  const resultsApi = await page.request.get("/api/zilch/results");
  expect(resultsApi.status()).toBe(401);
  const resultApi = await page.request.get("/api/zilch/results/not-a-private-result");
  expect(resultApi.status()).toBe(401);
  const rawStatic = await page.goto("/static/zilch.html");
  expect(rawStatic?.status()).toBe(404);
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
});

test("private Zilch result history and read-only report stay separate from ZDWA", async ({ browser, baseURL }) => {
  // The production PWA service worker can satisfy navigation before a test
  // route sees it. This isolated context keeps the fixture private to the
  // browser test and lets the result shell be exercised without a product
  // seed endpoint.
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await signIn(page, "Admin", "temporary-password-123");
    await expect(page.locator("#authBadge")).toContainText("Admin");
    await ensurePreviewAccounts(page);

    await page.click("#logoutBtn");
    await expect(page.locator("#loginForm")).toBeVisible();
    await signIn(page, "Mani", "mani-preview-password-123");
    await expect(page.locator("[data-game-switch]")).toBeVisible();

    const result = completedZilchResultFixture();
    await mockPrivateZilchResultEndpoints(page, result);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    await page.route(`**/zilch/ergebnis/${result.game_id}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));

    await expect(page.getByRole("heading", { name: "Deine abgeschlossenen Zilch-Partien" })).toBeVisible();
    const resultLink = page.getByRole("link", { name: "Ergebnis ansehen" });
    await expect(resultLink).toBeVisible();
    await expect(page.locator("#createGameCard")).toHaveCount(0);
    await resultLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/zilch/ergebnis/${result.game_id}$`));

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Mani gewinnt die Partie." })).toBeVisible();
    await expect(page.locator(".zilch-result-board")).toHaveCount(2);
    await expect(page.locator(".zilch-result-board").nth(0)).toContainText(/10.?000/);
    await expect(page.locator(".zilch-result-board").nth(1)).toContainText("500");
    await expect(page.getByText("Gleichstand – Startwurf wiederholt")).toBeVisible();
    await expect(page.getByText("Gegenzug abgeschlossen von")).toBeVisible();
    await expect(page.locator("#createGameCard")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(page.locator(".zilch-result-board")).toHaveCount(2);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator("[data-language-switcher]").selectOption("en"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("Private result report")).toBeVisible();
    await expect(page.getByText("Ruleset")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Zilch lobby" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a signed-in non-preview account cannot read private Zilch result endpoints", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");

  const history = await page.request.get("/api/zilch/results");
  expect(history.status()).toBe(403);
  const detail = await page.request.get("/api/zilch/results/not-a-private-result");
  expect(detail.status()).toBe(403);
  const route = await page.goto("/zilch/ergebnis/not-a-private-result");
  expect(route?.status()).toBe(403);
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
});
