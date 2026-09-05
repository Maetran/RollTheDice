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

async function selectableQuickHold(pages) {
  for (const page of pages) {
    // Prefer a regular score. Every recommendation, including Hot Dice, is a
    // reversible draft until the player explicitly rolls or banks.
    const regular = page.locator("[data-zilch-recommendation]:not(.is-hot):not([disabled])").first();
    if (await regular.count()) {
      return {
        page,
        optionId: await regular.getAttribute("data-zilch-recommendation"),
        hotDice: false,
      };
    }
    const hotDice = page.locator("[data-zilch-recommendation].is-hot:not([disabled])").first();
    if (await hotDice.count()) {
      return {
        page,
        optionId: await hotDice.getAttribute("data-zilch-recommendation"),
        hotDice: true,
      };
    }
  }
  return null;
}

async function lockQuickHold(choice) {
  const { page, optionId } = choice;
  if (!optionId) throw new Error("quick hold has no option id");
  const option = page.locator(`[data-zilch-recommendation=${JSON.stringify(optionId)}]`);
  await expect(option).toBeEnabled();
  if (!await option.evaluate(node => node.classList.contains("is-selected"))) {
    await option.click();
    await expect(option).toHaveClass(/is-selected/);
  }
  const roll = page.locator("[data-zilch-roll]");
  await expect(roll).toBeEnabled();
  await roll.click();
  await page.waitForTimeout(680);
}

async function rollUntilQuickHold(pages) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const existing = await selectableQuickHold(pages);
    if (existing) return existing;
    for (const page of pages) {
      const roll = await enabledLocator(page, "[data-zilch-roll]");
      if (!roll) continue;
      await roll.click();
      // The shared server coordinator deliberately rate-limits successive
      // rolls. Waiting here also gives both WebSocket clients a snapshot.
      await page.waitForTimeout(680);
      const quickHold = await selectableQuickHold(pages);
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
        const activeBefore = await page.locator(".zilch-board--active").getAttribute("data-zilch-board-id");
        await bank.click();
        // A snapshot can turn stale between the enabled-state check and the
        // click. Treat such a rejected request as a retry, not as a completed
        // bank action; successful banking must advance the authoritative turn.
        try {
          await expect.poll(
            () => page.locator(".zilch-board--active").getAttribute("data-zilch-board-id"),
            { timeout: 1_500, intervals: [100, 250, 500] },
          ).not.toBe(activeBefore);
          return {
            page,
            activeBefore,
            activeAfter: await page.locator(".zilch-board--active").getAttribute("data-zilch-board-id"),
          };
        } catch {
          await page.waitForTimeout(120);
        }
      }
    }
    const quickHold = await selectableQuickHold(pages);
    if (quickHold) {
      const { page, optionId } = quickHold;
      const option = page.locator(`[data-zilch-recommendation=${JSON.stringify(optionId)}]`);
      if (!await option.evaluate(node => node.classList.contains("is-selected"))) {
        await option.click();
        await expect(option).toHaveClass(/is-selected/);
      }
      const bank = await enabledLocator(page, "[data-zilch-bank]");
      if (bank) {
        const activeBefore = await page.locator(".zilch-board--active").getAttribute("data-zilch-board-id");
        await bank.click();
        try {
          await expect.poll(
            () => page.locator(".zilch-board--active").getAttribute("data-zilch-board-id"),
            { timeout: 1_500, intervals: [100, 250, 500] },
          ).not.toBe(activeBefore);
          return {
            page,
            activeBefore,
            activeAfter: await page.locator(".zilch-board--active").getAttribute("data-zilch-board-id"),
          };
        } catch {
          await page.waitForTimeout(120);
        }
        continue;
      }
      const roll = await enabledLocator(page, "[data-zilch-roll]");
      if (roll) {
        await roll.click();
        await page.waitForTimeout(680);
      }
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
      values: [board.querySelector("[data-zilch-total]")?.dataset.zilchTotal || ""],
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
    // The report gets a deliberately presentation-safe event projection: it
    // identifies the participant at this table, but never exposes internal
    // users, evidence, or a later account state.
    moments: {
      status: "ready",
      participants: [{
        participant_id: "p1",
        awards: [{
          key: "zilch.first_game",
          icon_key: "die",
          title_key: "zilch.achievement.first_game.title",
          description_key: "zilch.achievement.first_game.description",
          points: 1,
          unlocked_at: "2026-09-03T12:10:00+00:00",
          source_kind: "game",
        }],
        rank_ups: [{
          previous: {
            key: "newbie",
            title_key: "zilch.rank.newbie",
            stars: 1,
          },
          current: {
            key: "rookie",
            title_key: "zilch.rank.rookie",
            stars: 2,
          },
          recorded_at: "2026-09-03T12:10:00+00:00",
        }],
      }],
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
  await expect(page.getByRole("heading", { name: "Zilch die Wand an – Würfelspiel online" })).toBeVisible();
  await expect(page.locator(".zilch-lobby-leaderboard-box")).toHaveCount(3);
  await expect(page.getByText(/Interne Vorschau|Private Zilch-Vorschau/)).toHaveCount(0);
  await expect(page.locator("[data-theme-toggle]")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.evaluate(() => window.ZDWA_UI.toast("Positionstest", { duration: 0 }));
  const toast = page.locator(".app-toast").last();
  await expect(toast).toBeVisible();
  const toastBox = await toast.boundingBox();
  expect(toastBox.y).toBeLessThan(100);
  expect(toastBox.x).toBeGreaterThan(400);
  await toast.locator(".app-toast-close").click();

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.locator("#zilchNavToggle");
  const navigation = page.locator("#zilchNavigation");
  await expect(menu).toHaveCount(0);
  await expect(navigation).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/zilch\/bestenlisten$/),
    navigation.getByRole("link", { name: "Spieler & Ranking" }).click(),
  ]);
  await page.goto("/zilch");
  await page.setViewportSize({ width: 1280, height: 720 });

  // Alt+Shift+Z is intentionally ignored while typing into a Zilch input.
  const lobbyUrl = page.url();
  await page.locator('[data-zilch-play-mode="multiplayer"]').click();
  await page.locator(".zilch-create-options").evaluate(element => { element.open = true; });
  await page.locator("#zilchGamePassphrase").focus();
  await expect(page.locator("#zilchGamePassphrase")).toBeFocused();
  await page.keyboard.press("Alt+Shift+Z");
  await expect.poll(() => page.url()).toBe(lobbyUrl);

  await page.locator("#zilchGamePassphrase").evaluate(element => element.blur());
  await Promise.all([
    page.waitForURL(/\/$/),
    page.keyboard.press("Alt+Shift+Z"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
  await expect(page.locator("#createGameCard")).toBeVisible();

  await page.locator("[data-game-switch]").click();
  await page.waitForURL(/\/zilch$/);
  await Promise.all([
    page.waitForURL(/\/zilch\/konto$/),
    page.locator("#zilchNavigation a[href='/zilch/konto']").click(),
  ]);
  await expect(page.locator("#zilchAccountLogout")).toBeVisible();
  await page.click("#zilchAccountLogout");
  await page.waitForURL(/\/$/);
  await expect(page.locator("[data-game-switch]")).toBeHidden();
});

test("a permitted user can create and reload a private CPU game through the normal server path", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await ensurePreviewAccounts(page);

  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  await expect(page.locator("[data-game-switch]")).toBeVisible();
  await page.locator("[data-game-switch]").click();
  await page.waitForURL(/\/zilch$/);

  await page.locator("[data-zilch-play-mode='cpu']").click();
  await expect(page.locator("#zilchCpuStrategy")).toBeVisible();
  await page.locator("#zilchCpuStrategySelect").selectOption("aggressive");
  await Promise.all([
    page.waitForURL(/\/zilch\/spiel\/[^/]+$/),
    page.locator("#zilchCreateForm button[type='submit']").click(),
  ]);
  const gamePath = new URL(page.url()).pathname;
  const gameId = gamePath.split("/").at(-1);

  // Navigation reaches the protected shell before its normal WebSocket join
  // completes. Wait for the authoritative snapshot rather than assuming a
  // transport player exists as soon as the URL changes.
  await expect(page.locator("[data-zilch-board-id]")).toHaveCount(2);

  // The public projection proves that the CPU is a durable second seat but
  // not a second browser/WebSocket connection. This is the ordinary private
  // API used by the game screen, not a test fixture or server hook.
  const details = await page.evaluate(async id => {
    const response = await fetch(`/api/games/${encodeURIComponent(id)}`, { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, gameId);
  expect(details.status).toBe(200);
  expect(details.body).toMatchObject({
    game_type: "zilch",
    play_mode: "cpu",
    expected_connections: 1,
    expected_participants: 2,
  });
  expect(details.body.players).toBe(1);
  const cpuParticipant = details.body.participants.find(participant => participant.participant_type === "cpu");
  expect(cpuParticipant).toMatchObject({
    is_cpu: true,
    connected: null,
    user_id: null,
    cpu_strategy: "aggressive",
  });

  const cpuBoard = page.locator(`[data-zilch-board-id="${cpuParticipant.id}"]`);
  await expect(cpuBoard).toContainText(/CPU/);
  // CPU strategy is durable API metadata, not a distracting score-sheet label.
  await expect(cpuBoard).not.toContainText(/Aggressiv|Aggressive/);
  await expect(cpuBoard).not.toHaveClass(/zilch-board--offline/);
  await expect(cpuBoard.locator(".zilch-connection-dot")).toHaveCount(0);

  // The human produces only their own opening roll. The runner then performs
  // the dice keeper's server-authoritative opening roll with the normal fair
  // RNG. A tie is legitimate, so observe its visible activity rather than
  // forcing a result.
  const openingRoll = page.locator("[data-zilch-start-roll]");
  await expect(openingRoll).toBeEnabled();
  await openingRoll.click();
  const cpuActivity = page.locator("#zilchLiveStatus, .zilch-start-roll, .zilch-event");
  await expect.poll(
    async () => (await cpuActivity.allTextContents()).join(" "),
    { timeout: 5_000, intervals: [50, 100, 200] },
  ).toMatch(/(?:Würfelwirt.*(?:überlegt|würfelt)|dice keeper.*(?:thinking|rolls))/i);

  // Reload uses the real resume-token path. It must retain the active game
  // and the CPU domain seat rather than creating a fake user or offline CPU.
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${gamePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(page.locator("[data-zilch-board-id]")).toHaveCount(2);
  const rejoinedCpuBoard = page.locator(`[data-zilch-board-id="${cpuParticipant.id}"]`);
  await expect(rejoinedCpuBoard).toContainText(/CPU/);
  await expect(rejoinedCpuBoard.locator(".zilch-connection-dot")).toHaveCount(0);
  await expect(page.locator("#zilchLiveStatus")).not.toContainText(/CPU-Spiel kann nicht fortgesetzt werden|CPU game cannot continue/i);
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
    await mani.locator('[data-zilch-play-mode="multiplayer"]').click();
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
    await expect(preview.getByRole("heading", { name: "Zilch die Wand an – Play the dice game online" })).toBeVisible();
    await Promise.all([
      preview.waitForURL(new RegExp(`${gamePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
      preview.locator(`a[href="${gamePath}"]`).click(),
    ]);

    await expect(mani.locator(".zilch-start-roll")).toBeVisible();
    await expect(preview.locator(".zilch-start-roll")).toBeVisible();
    await completeOpeningRoll([mani, preview]);
    await expect(mani.locator("[data-zilch-start-roll]")).toHaveCount(0);
    await expect(preview.locator("[data-zilch-start-roll]")).toHaveCount(0);
    // Once the fair opening roll is resolved, its replay card must leave the
    // active playing surface instead of competing with score and actions.
    await expect(mani.locator(".zilch-start-roll--resolved")).toHaveCount(0);
    await expect(preview.locator(".zilch-start-roll--resolved")).toHaveCount(0);
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await expect(preview.locator("[data-zilch-board-id]")).toHaveCount(2);

    // The compact game dock deliberately keeps chat closed until requested.
    await mani.locator("[data-zilch-chat-toggle]").click();
    await preview.locator("[data-zilch-chat-toggle]").click();
    await expect(mani.locator("#zilchChatInput")).toBeVisible();
    await mani.locator("#zilchChatInput").fill("server chat stays shared");
    await mani.locator("#zilchChatForm button[type=submit]").click();
    await expect(preview.locator("#zilchChatHistory")).toContainText("server chat stays shared");
    await expect(preview.locator(".emoji-pop.chat-pop")).toContainText("server chat stays shared");
    await expect(mani.locator(".emoji-pop.chat-pop")).toHaveCount(0);
    await mani.locator("[data-zilch-chat-toggle]").click();
    await preview.locator("[data-zilch-chat-toggle]").click();

    await mani.setViewportSize({ width: 1280, height: 900 });
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await mani.setViewportSize({ width: 390, height: 844 });
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    expect(await mani.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mani.emulateMedia({ reducedMotion: "reduce" });

    const selected = await rollUntilQuickHold([mani, preview]);
    const selectedOption = selected.page.locator(`[data-zilch-recommendation=${JSON.stringify(selected.optionId)}]`);
    await selectedOption.click();
    await expect(selectedOption).toHaveClass(/is-selected/);
    const waitingOpponent = selected.page === mani ? preview : mani;
    // The selected draft is a live, read-only projection for the other seat:
    // it mirrors the active person's scoring tile without committing a hold.
    const mirroredOption = waitingOpponent.locator(`[data-zilch-recommendation=${JSON.stringify(selected.optionId)}]`);
    await expect(mirroredOption).toBeDisabled();
    await expect(mirroredOption).toHaveClass(/is-selected/);
    await expect(waitingOpponent.locator(".zilch-die--selected")).toHaveCount(
      await selected.page.locator(".zilch-die--selected").count(),
    );
    await lockQuickHold(selected);
    // A full-dice special can legitimately reset the rack for Hot Dice;
    // ordinary holds mark dice unavailable. In both cases the authoritative
    // snapshot is shared by the two clients.
    await expect.poll(async () => selected.page.locator(".zilch-die").count()).toBe(6);
    expect(await visibleGameFacts(mani)).toEqual(await visibleGameFacts(preview));

    await mani.reload();
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await expect(mani.locator("[data-zilch-root]")).toBeVisible();

    const banked = await bankWhenPossible([mani, preview]);
    // The helper may need to resolve a preceding Zilch before it reaches a
    // bankable turn, so the active seat can legitimately match the state from
    // before the helper began. Assert the actual bank transition and that the
    // rejoined client receives that same authoritative turn instead.
    expect(banked.activeAfter).not.toBe(banked.activeBefore);
    await expect.poll(async () => mani.locator(".zilch-board--active").getAttribute("data-zilch-board-id")).toBe(banked.activeAfter);

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

    await page.goto("/zilch/historie");
    await expect(page.getByRole("heading", { name: "Deine abgeschlossenen Zilch-Partien" })).toBeVisible();
    const resultLink = page.getByRole("link", { name: "Ergebnis ansehen" });
    await expect(resultLink).toBeVisible();
    await expect(page.locator("#createGameCard")).toHaveCount(0);
    await resultLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/zilch/ergebnis/${result.game_id}$`));

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByText("Der Tisch ist abgerechnet", { exact: true })).toBeVisible();
    await expect(page.locator(".zilch-result-head h1")).toHaveText("Mani gewinnt die Partie.");
    await expect(page.locator(".zilch-result-metrics")).toContainText("Höchste gesicherte Runde");
    await expect(page.locator(".zilch-result-metrics")).toContainText(/8.?000/);
    await expect(page.locator(".zilch-result-metrics")).toContainText("Zilch-Runden");
    await expect(page.locator(".zilch-result-board")).toHaveCount(2);
    await expect(page.locator(".zilch-result-board").nth(0)).toContainText(/10.?000/);
    await expect(page.locator(".zilch-result-board").nth(1)).toContainText("500");
    const histories = page.locator("details.zilch-result-history, .zilch-result-history details");
    await expect(histories).toHaveCount(2);
    await expect(histories.first()).not.toHaveAttribute("open", "");
    await expect(histories.first().locator("summary")).toContainText("Was am Tisch geschah");
    await histories.first().locator("summary").click();
    await expect(histories.first()).toHaveAttribute("open", "");
    await expect(histories.first()).toContainText("Runde 1");

    const tableMoments = page.locator(".zilch-result-moments");
    await expect(tableMoments).toBeVisible();
    await expect(tableMoments).toContainText("Tischmomente");
    await expect(tableMoments).toContainText("Mani");
    await expect(tableMoments).toContainText("Erster Wurf");
    await expect(tableMoments).toContainText("Newbie → Rookie");
    await expect(tableMoments).not.toContainText("source_kind");
    await expect(page.locator(".zilch-result-actions a[href='/zilch']")).toBeVisible();
    await expect(page.locator(".zilch-result-actions a[href='/zilch/historie']")).toBeVisible();
    await expect(page.getByText("Gleichstand – Startwurf wiederholt")).toBeVisible();
    await expect(page.locator(".zilch-result-final-round")).toContainText("hat die letzte Runde eingeläutet.");
    await expect(page.locator("#createGameCard")).toHaveCount(0);

    // The hero sits on dark wood while the result eyebrow sits on paper. Both
    // contrast regressions have happened before; verify the intended light /
    // dark directions without coupling the test to one exact paint value.
    const contrastColors = await page.evaluate(() => {
      const rgb = selector => {
        const value = getComputedStyle(document.querySelector(selector)).color;
        const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [];
        return channels;
      };
      const luminance = channels => {
        const linear = channels.map(channel => {
          const value = channel / 255;
          return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return .2126 * (linear[0] || 0) + .7152 * (linear[1] || 0) + .0722 * (linear[2] || 0);
      };
      return {
        heroHeading: luminance(rgb(".zilch-result-head h1")),
        summaryEyebrow: luminance(rgb(".zilch-result-summary .eyebrow")),
        metricsEyebrow: luminance(rgb(".zilch-result-metrics .eyebrow")),
      };
    });
    expect(contrastColors.heroHeading).toBeGreaterThan(.75);
    expect(contrastColors.summaryEyebrow).toBeLessThan(.3);
    expect(contrastColors.metricsEyebrow).toBeLessThan(.3);

    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator(".zilch-result-summary")).toBeVisible();
      await expect(tableMoments).toBeVisible();
    }
    await page.reload();
    await expect(page.locator(".zilch-result-board")).toHaveCount(2);
    await expect(page.locator(".zilch-result-moments")).toContainText("Erster Wurf");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator("[data-language-switcher]").selectOption("en"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("The table is settled", { exact: true })).toBeVisible();
    await expect(page.locator(".zilch-result-moments")).toContainText("Table moments");
    await expect(page.locator(".zilch-result-moments")).toContainText("First Roll");
    await expect(page.locator(".zilch-result-moments")).toContainText("Newbie → Rookie");
    await expect(page.getByText("Total points", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#zilchNavigation a[href='/zilch']")).toBeVisible();

    // This suite shares the preview account across several fixtures. Restore
    // the explicit German baseline after exercising the translated report so
    // the following game-screen fixtures keep testing their German copy.
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator("[data-language-switcher]").selectOption("de"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
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
