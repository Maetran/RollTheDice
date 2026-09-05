const { test, expect } = require("@playwright/test");

function watchPageHealth(page) {
  const issues = [];
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === new URL(page.url()).origin;
    } catch {
      return true;
    }
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    issues.push(`pageerror: ${err.message}`);
  });
  page.on("requestfailed", (req) => {
    if (req.resourceType() === "websocket") return;
    issues.push(`requestfailed: ${req.method()} ${req.url()} ${req.failure()?.errorText || ""}`.trim());
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    if (!sameOrigin(res.url())) return;
    issues.push(`http ${res.status()}: ${res.url()}`);
  });

  return {
    async expectClean() {
      await page.waitForTimeout(250);
      expect(issues).toEqual([]);
    },
  };
}

function activeGameId(url) {
  const match = new URL(url).pathname.match(/^\/spiel\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

test("lobby can create a game and open spectator view without browser errors", async ({ page, browser, request }) => {
  const health = watchPageHealth(page);
  await page.goto("/");
  await page.fill("#playerName", "Smoke");
  await page.fill("#passInput", "");
  await page.getByRole("radio", { name: "1 Spieler, Solo" }).click();
  await Promise.all([
    page.waitForURL(/\/spiel\/[^/?]+/),
    page.click("#createBtn"),
  ]);
  await page.waitForSelector("#diceBar");
  await health.expectClean();

  const spectator = await browser.newPage();
  const spectatorHealth = watchPageHealth(spectator);
  await spectator.goto("/");
  await spectator.fill("#playerName", "Observer");
  await spectator.waitForSelector("button.spectateBtn");
  await Promise.all([
    spectator.waitForURL(/\/spiel\/[^/?]+\/zuschauen$/),
    spectator.click("button.spectateBtn"),
  ]);
  await spectator.waitForSelector("#diceBar");
  await expect(spectator.locator("#backToLobbyBtn")).toHaveText("Lobby");
  await expect(spectator.locator("#backToLobbyBtn")).not.toHaveClass(/danger/);
  await expect.poll(async () => {
    const response = await request.get("/api/games");
    return (await response.json()).online_users;
  }).toBe(2);
  await spectatorHealth.expectClean();
  await spectator.close();
  await expect.poll(async () => {
    const response = await request.get("/api/games");
    return (await response.json()).online_users;
  }).toBe(1);
});

test("legacy room links end on the clean canonical game URL", async ({ page, request }) => {
  const created = await request.post("/api/games", { data: { name: "Legacy URL", mode: 1 } });
  const { game_id: gameId } = await created.json();

  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=LegacyGuest`);
  await page.waitForSelector("#diceBar");

  const url = new URL(page.url());
  expect(url.pathname).toBe(`/spiel/${encodeURIComponent(gameId)}`);
  expect(url.search).toBe("");
  await expect(page.locator(".player-card", { hasText: "LegacyGuest" })).toBeVisible();
});

test("dismissed install prompt stays hidden for seven days or until a new app version", async ({ page }) => {
  await page.goto("/");
  const dispatchInstallPrompt = () => page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {};
    window.dispatchEvent(event);
  });

  await dispatchInstallPrompt();
  const prompt = page.locator(".app-toast", { hasText: "Die App kann installiert werden." });
  await expect(prompt).toBeVisible();
  await prompt.locator(".app-toast-close").click();
  await expect(prompt).toBeHidden();

  await page.reload();
  await dispatchInstallPrompt();
  await expect(prompt).toBeHidden();

  await page.evaluate(() => {
    localStorage.setItem("zdwa_install_prompt_dismissed", JSON.stringify({
      version: "older-service-worker-version",
      dismissedAt: Date.now(),
    }));
  });
  await dispatchInstallPrompt();
  await expect(prompt).toBeVisible();

  await prompt.locator(".app-toast-close").click();
  await page.evaluate(() => {
    const dismissed = JSON.parse(localStorage.getItem("zdwa_install_prompt_dismissed"));
    dismissed.dismissedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem("zdwa_install_prompt_dismissed", JSON.stringify(dismissed));
  });
  await page.reload();
  await dispatchInstallPrompt();
  await expect(prompt).toBeVisible();
});

test("service worker serves core pages while offline", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("service_worker_unavailable");
    await navigator.serviceWorker.ready;
  });
  await page.goto("/regeln");
  await expect(page.getByRole("heading", { name: "Zock die Wand an: Spielregeln" })).toBeVisible();

  await context.setOffline(true);
  try {
    await page.goto("/regeln");
    await expect(page.getByRole("heading", { name: "Zock die Wand an: Spielregeln" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("game creation API flow from lobby and spectator mode both work", async ({ page, browser, request }) => {
  const health = watchPageHealth(page);
  await page.goto("/");
  await page.fill("#playerName", "Creator");
  await page.fill("#passInput", "");
  await page.getByRole("radio", { name: "1 Spieler, Solo" }).click();

  const createResponsePromise = page.waitForResponse((res) => {
    return res.url().endsWith("/api/games") &&
      res.request().method() === "POST";
  });
  const navigationPromise = page.waitForURL(/\/spiel\/[^/?]+/);
  await page.click("#createBtn");

  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBeTruthy();

  await navigationPromise;
  const gameId = activeGameId(page.url());
  expect(gameId).toBeTruthy();
  await page.waitForSelector("#diceBar");
  await expect(page.locator(".player-card")).toContainText("Creator");

  const joinedInfo = await request.get(`/api/games/${encodeURIComponent(gameId)}`);
  expect(joinedInfo.ok()).toBeTruthy();
  const joinedPayload = await joinedInfo.json();
  expect(joinedPayload).toMatchObject({
    exists: true,
    players: 1,
    expected: 1,
    started: true,
    finished: false,
  });

  const spectator = await browser.newPage();
  const spectatorHealth = watchPageHealth(spectator);
  await spectator.goto("/");
  await spectator.fill("#playerName", "Spectator");
  const spectateButton = spectator.locator(`.spectateBtn[data-id="${gameId}"]`);
  await expect(spectateButton).toBeVisible();
  await Promise.all([
    spectator.waitForURL(/\/spiel\/[^/?]+\/zuschauen$/),
    spectateButton.click(),
  ]);
  expect(activeGameId(spectator.url())).toBe(gameId);
  expect(new URL(spectator.url()).pathname).toBe(`/spiel/${encodeURIComponent(gameId)}/zuschauen`);
  await spectator.waitForSelector("#diceBar");
  await expect(spectator.locator(".player-card")).toContainText("Creator");

  const afterSpectateInfo = await request.get(`/api/games/${encodeURIComponent(gameId)}`);
  expect(afterSpectateInfo.ok()).toBeTruthy();
  const afterSpectatePayload = await afterSpectateInfo.json();
  expect(afterSpectatePayload.players).toBe(1);
  expect(afterSpectatePayload.started).toBe(true);

  await spectatorHealth.expectClean();
  await spectator.close();
  await health.expectClean();
});

test("multiplayer game pauses on disconnect and resumes from the lobby", async ({ page, browser, request }) => {
  const health = watchPageHealth(page);
  const created = await request.post("/api/games", {
    data: { name: "Resume Smoke", mode: 2 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Anna`);
  await page.waitForSelector("#diceBar");
  await expect(page.locator(".player-card")).toContainText("Anna");

  const player2Context = await browser.newContext();
  const player2 = await player2Context.newPage();
  const player2Health = watchPageHealth(player2);
  await player2.goto(`/spiel/${encodeURIComponent(gameId)}?name=Ben`);
  await player2.waitForSelector("#diceBar");
  await expect(player2.locator(".player-card", { hasText: "Ben" })).toBeVisible();
  await expect(page.locator(".player-card", { hasText: "Ben" })).toBeVisible();
  await player2Health.expectClean();

  await player2.close();
  await expect(page.locator("#multiplayerPauseNotice")).toContainText("Ben");
  await expect(page.locator("#rollBtnInline")).toBeDisabled();

  const resumedPlayer2 = await player2Context.newPage();
  const resumedHealth = watchPageHealth(resumedPlayer2);
  await resumedPlayer2.goto("/");
  const resumeButton = resumedPlayer2.locator(`.resumeBtn[data-id="${gameId}"]`);
  await expect(resumeButton).toBeVisible();
  await Promise.all([
    resumedPlayer2.waitForURL(/\/spiel\/[^/?]+/),
    resumeButton.click(),
  ]);
  await resumedPlayer2.waitForSelector("#diceBar");

  await expect(page.locator("#multiplayerPauseNotice")).toBeHidden();
  await expect(page.locator("#rollBtnInline")).toBeEnabled();

  await resumedHealth.expectClean();
  await health.expectClean();
  await resumedPlayer2.close();
  await player2Context.close();
});

test("tablet multiplayer layout shows up to three boards side by side", async ({ page, browser, request }) => {
  await page.setViewportSize({ width: 900, height: 780 });
  const created = await request.post("/api/games", {
    data: { name: "Layout Smoke", mode: 3 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  const player2Context = await browser.newContext({ viewport: { width: 900, height: 780 } });
  const player3Context = await browser.newContext({ viewport: { width: 900, height: 780 } });
  const player2 = await player2Context.newPage();
  const player3 = await player3Context.newPage();

  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Anna`);
  await player2.goto(`/spiel/${encodeURIComponent(gameId)}?name=Ben`);
  await player3.goto(`/spiel/${encodeURIComponent(gameId)}?name=Cara`);

  await expect(page.locator(".player-card")).toHaveCount(3);
  await expect(page.locator(".player-card", { hasText: "Anna" })).toBeVisible();
  await expect(page.locator(".player-card", { hasText: "Ben" })).toBeVisible();
  await expect(page.locator(".player-card", { hasText: "Cara" })).toBeVisible();

  const layout = await page.evaluate(() => {
    const grid = document.querySelector(".players-grid");
    const gridRect = grid.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll(".player-card")).map((card) => {
      const r = card.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
      };
    });
    return {
      gridClientWidth: Math.round(grid.clientWidth),
      gridScrollWidth: Math.round(grid.scrollWidth),
      gridLeft: Math.round(gridRect.left),
      gridRight: Math.round(gridRect.right),
      cards,
      viewportWidth: window.innerWidth,
      documentScrollWidth: Math.round(document.documentElement.scrollWidth),
    };
  });

  expect(layout.cards).toHaveLength(3);
  expect(layout.gridScrollWidth).toBeLessThanOrEqual(layout.gridClientWidth + 2);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 2);
  expect(new Set(layout.cards.map((card) => card.top)).size).toBe(1);
  expect(layout.cards[0].left).toBeGreaterThanOrEqual(layout.gridLeft - 1);
  expect(layout.cards[2].right).toBeLessThanOrEqual(layout.gridRight + 1);
  for (const card of layout.cards) {
    expect(card.width).toBeGreaterThanOrEqual(250);
  }

  await player3Context.close();
  await player2Context.close();
});

test("iPad Pro portrait keeps header and quick reactions inside the viewport", async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  const created = await request.post("/api/games", {
    data: { name: "iPad Portrait", mode: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Tablet`);
  await page.waitForSelector("#diceBar");

  const closedLayout = await page.evaluate(() => {
    const header = document.querySelector(".room-header").getBoundingClientRect();
    const reactions = document.querySelector("#chatReactionsBar").getBoundingClientRect();
    const chatToggle = document.querySelector("#chatToggle").getBoundingClientRect();
    return {
      headerTop: Math.round(header.top),
      reactionsLeft: Math.round(reactions.left),
      reactionsRight: Math.round(reactions.right),
      reactionsBottom: Math.round(reactions.bottom),
      chatToggleBottom: Math.round(chatToggle.bottom),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(closedLayout.headerTop).toBeGreaterThanOrEqual(16);
  expect(closedLayout.reactionsLeft).toBeGreaterThanOrEqual(0);
  expect(closedLayout.reactionsRight).toBeLessThanOrEqual(closedLayout.viewportWidth);
  expect(closedLayout.reactionsBottom).toBeLessThanOrEqual(closedLayout.viewportHeight + 1);
  expect(closedLayout.chatToggleBottom).toBeLessThanOrEqual(closedLayout.viewportHeight + 1);

  await page.click("#chatReactionsBar .emoji-fab");
  const openPanel = await page.locator("#chatReactionsBar .emoji-panel").evaluate(panel => {
    const rect = panel.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(openPanel.top).toBeGreaterThanOrEqual(0);
  expect(openPanel.bottom).toBeLessThanOrEqual(openPanel.viewportHeight);
  expect(openPanel.left).toBeGreaterThanOrEqual(0);
  expect(openPanel.right).toBeLessThanOrEqual(openPanel.viewportWidth);
});

test("back to lobby can pause a game and resume it later", async ({ page, request }) => {
  const health = watchPageHealth(page);
  const created = await request.post("/api/games", {
    data: { name: "Manual Pause Smoke", mode: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Solo`);
  await page.waitForSelector("#diceBar");
  await expect(page.locator("#backToLobbyBtn")).toHaveText("Spiel verlassen");
  await expect(page.locator("#backToLobbyBtn")).toHaveClass(/danger/);
  await expect(page.locator("#backToLobbyBtn")).toHaveAttribute("aria-controls", "leaveGameDialog");

  await page.click("#backToLobbyBtn");
  await expect(page.locator("#leaveGameDialog")).toBeVisible();
  await expect(page.locator("#leaveGameDialog")).toContainText("Pause hält das Spiel");
  await expect(page.locator("#leavePauseBtn")).toBeVisible();
  await expect(page.locator("#leaveAbortBtn")).toBeVisible();
  await expect(page.locator("#leaveStayBtn")).toBeVisible();
  await page.click("#leaveStayBtn");
  await expect(page.locator("#leaveGameDialog")).toBeHidden();
  await expect(page.locator("#diceBar")).toBeVisible();

  await page.click("#backToLobbyBtn");
  await expect(page.locator("#leaveGameDialog")).toBeVisible();
  await page.click("#leavePauseBtn");
  await expect(page.locator("#appDialog")).toContainText("Spiel pausiert");
  await Promise.all([
    page.waitForURL("/"),
    page.click('[data-dialog-action="ok"]'),
  ]);

  const info = await request.get(`/api/games/${encodeURIComponent(gameId)}`);
  expect(info.ok()).toBeTruthy();
  const payload = await info.json();
  expect(payload).toMatchObject({
    exists: true,
    started: true,
    finished: false,
    paused: true,
    manual_pause: true,
  });
  expect(payload.pause_remaining_label).toMatch(/h|min/);

  const resumeButton = page.locator(`.resumeBtn[data-id="${gameId}"]`);
  await expect(resumeButton).toBeVisible();
  const gameRow = resumeButton.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' game-row ')][1]");
  await expect(gameRow.locator(".warn-line", { hasText: "Restzeit" })).toBeVisible();
  const storedToken = await page.evaluate((gid) => localStorage.getItem(`wuerfler_token_${gid}`), gameId);
  await page.evaluate((gid) => {
    localStorage.removeItem(`wuerfler_token_${gid}`);
  }, gameId);
  await page.reload();
  await expect(page.locator(`.resumeBtn[data-id="${gameId}"]`)).toBeVisible();
  await page.evaluate(({ gid, token }) => {
    if (token) localStorage.setItem(`wuerfler_token_${gid}`, token);
  }, { gid: gameId, token: storedToken });
  await Promise.all([
    page.waitForURL(/\/spiel\/[^/?]+/),
    page.locator(`.resumeBtn[data-id="${gameId}"]`).click(),
  ]);
  await page.waitForSelector("#diceBar");
  await expect(page.locator("#multiplayerPauseNotice")).toBeHidden();

  const afterResume = await request.get(`/api/games/${encodeURIComponent(gameId)}`);
  expect((await afterResume.json()).paused).toBe(false);
  await health.expectClean();
});

test("mobile game layout keeps totals above the dice bar and has no browser errors", async ({ page, request }) => {
  await page.setViewportSize({ width: 367, height: 703 });
  const health = watchPageHealth(page);
  const created = await request.post("/api/games", {
    data: { name: "Mobile Layout Smoke", mode: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Smoke&__test=1`);
  await page.waitForSelector("#diceBar");
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const rows = Array.from(document.querySelectorAll(".player-card tbody tr"));
    const lastRow = rows[rows.length - 1];
    const lr = lastRow.getBoundingClientRect();
    return {
      headerStatus: rect("#headerTurnStatus"),
      actionFeedback: document.querySelector("#actionFeedback")?.textContent.trim() || "",
      suggestions: rect(".suggestions-area"),
      topbar: rect(".topbar"),
      chatToggle: rect("#chatToggle"),
      chatReactions: rect("#chatReactionsBar"),
      die: rect("#diceBar .die"),
      heldDieBorderWidth: (() => {
        const die = document.querySelector("#diceBar .die");
        die.classList.add("held");
        return window.getComputedStyle(die).borderTopWidth;
      })(),
      card: rect(".player-card"),
      lastRow: {
        top: Math.round(lr.top),
        bottom: Math.round(lr.bottom),
        height: Math.round(lr.height),
      },
      tableWrap: rect(".player-card .table-wrap"),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      loadedCss: Array.from(document.styleSheets)
        .map((sheet) => sheet.href)
        .filter(Boolean)
        .find((href) => href.includes("style.css")) || "",
    };
  });

  expect(layout.loadedCss).toContain("style.css?v=");
  expect(layout.actionFeedback.length).toBeGreaterThan(0);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.headerStatus.bottom).toBeLessThanOrEqual(layout.card.top + 1);
  expect(layout.suggestions.bottom).toBeLessThanOrEqual(layout.topbar.top + 1);
  expect(layout.chatReactions.right).toBeLessThanOrEqual(layout.chatToggle.left + 1);
  expect(layout.chatReactions.top).toBeGreaterThanOrEqual(layout.chatToggle.top);
  expect(layout.chatReactions.top).toBeLessThanOrEqual(layout.chatToggle.top + 2);
  expect(layout.chatReactions.height).toBe(layout.chatToggle.height);
  expect(layout.die.width).toBeGreaterThanOrEqual(65);
  expect(layout.die.width).toBeLessThanOrEqual(75);
  expect(layout.die.height).toBe(layout.die.width);
  expect(layout.heldDieBorderWidth).toBe("2px");
  expect(layout.tableWrap.height).toBeGreaterThanOrEqual(460);
  expect(layout.scrollHeight).toBeGreaterThan(layout.viewportHeight);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const bottomDock = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const chatToggle = document.querySelector("#chatToggle").getBoundingClientRect();
    const rows = Array.from(document.querySelectorAll(".player-card tbody tr"));
    const lastRow = rows.at(-1).getBoundingClientRect();
    return {
      topbarBottom: Math.round(topbar.bottom),
      chatTop: Math.round(chatToggle.top),
      lastRowBottom: Math.round(lastRow.bottom),
      topbarTop: Math.round(topbar.top),
    };
  });
  expect(bottomDock.topbarBottom).toBeLessThanOrEqual(bottomDock.chatTop - 5);
  expect(bottomDock.lastRowBottom).toBeLessThanOrEqual(bottomDock.topbarTop - 1);

  await page.waitForFunction(() => {
    const btn = document.querySelector("#rollBtnInline");
    return btn && !btn.disabled;
  });
  const rollVisual = await page.evaluate(async () => {
    const labels = () => Array.from(document.querySelectorAll("#diceBar .die"))
      .map((die) => die.querySelector("svg")?.getAttribute("aria-label") || "");
    const before = labels();
    document.querySelector("#rollBtnInline").click();
    const frames = [];
    const transforms = [];
    let suggestionsDuring = null;
    let suggestionsAfter = null;
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (i === 1 && window.__rtDebugRenderSuggestionsForSnapshot) {
        window.__rtDebugRenderSuggestionsForSnapshot({
          suggestions: [{ type: "KENTER", label: "Kenter", points: 35, eligible: true }],
        });
        suggestionsDuring = document.querySelector("#suggestions").textContent.trim();
      }
      frames.push(labels());
      transforms.push(Array.from(document.querySelectorAll("#diceBar .die"))
        .map((die) => window.getComputedStyle(die).transform));
    }
    const changedDice = before.filter((label, index) => {
      return frames.some((frame) => frame[index] && frame[index] !== label);
    }).length;
    const shakingCount = document.querySelectorAll("#diceBar .die.shaking").length;
    const transformedFrames = transforms.flat().filter((value) => value && value !== "none").length;
    await new Promise((resolve) => setTimeout(resolve, 250));
    suggestionsAfter = document.querySelector("#suggestions").textContent.trim();
    return { before, frames, changedDice, shakingCount, transformedFrames, suggestionsDuring, suggestionsAfter };
  });
  expect(rollVisual.shakingCount).toBeGreaterThan(0);
  expect(rollVisual.changedDice).toBeGreaterThanOrEqual(3);
  expect(rollVisual.transformedFrames).toBeGreaterThan(0);
  expect(rollVisual.suggestionsDuring).toBe("");
  expect(rollVisual.suggestionsAfter).toContain("Kenter");
  await page.waitForTimeout(350);

  const holdFeedback = await page.evaluate(() => {
    const die = document.querySelector("#diceBar .die");
    const before = die.classList.contains("held");
    die.click();
    return {
      before,
      after: die.classList.contains("held"),
      pressed: die.getAttribute("aria-pressed"),
    };
  });
  expect(holdFeedback).toEqual({ before: false, after: true, pressed: "true" });

  const withSuggestion = await page.evaluate(() => {
    const suggestions = document.querySelector("#suggestions");
    suggestions.innerHTML = `<div class="suggestion-btn" aria-hidden="true">Kenter <span class="points">35</span></div>`;
    const rect = (sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
      };
    };
    return {
      lastRow: rect(".player-card tbody tr:last-child"),
      suggestions: rect(".suggestions-area"),
      suggestionBtn: rect(".suggestion-btn"),
      topbar: rect(".topbar"),
    };
  });

  expect(withSuggestion.lastRow.bottom).toBeLessThanOrEqual(withSuggestion.suggestions.top - 1);
  expect(withSuggestion.suggestions.bottom).toBeLessThanOrEqual(withSuggestion.topbar.top + 1);
  expect(withSuggestion.suggestionBtn.height).toBeGreaterThanOrEqual(15);

  await page.click("#chatToggle");
  await page.waitForTimeout(250);
  const openChat = await page.evaluate(() => {
    const panel = document.querySelector("#chatPanel");
    const toggle = document.querySelector("#chatToggle");
    const reactions = document.querySelector("#chatReactionsBar");
    const pr = panel.getBoundingClientRect();
    const tr = toggle.getBoundingClientRect();
    const rr = reactions.getBoundingClientRect();
    const panelStyle = window.getComputedStyle(panel);
    const toggleStyle = window.getComputedStyle(toggle);
    return {
      panel: {
        left: Math.round(pr.left),
        right: Math.round(pr.right),
        width: Math.round(pr.width),
        zIndex: Number(panelStyle.zIndex),
        borderTopLeftRadius: panelStyle.borderTopLeftRadius,
      },
      toggle: {
        left: Math.round(tr.left),
        width: Math.round(tr.width),
        borderTopLeftRadius: toggleStyle.borderTopLeftRadius,
      },
      reactions: {
        left: Math.round(rr.left),
        right: Math.round(rr.right),
        zIndex: Number(window.getComputedStyle(reactions).zIndex),
      },
      viewportWidth: window.innerWidth,
    };
  });
  expect(openChat.panel.left).toBe(0);
  expect(openChat.panel.width).toBe(openChat.viewportWidth);
  expect(openChat.toggle.left).toBe(0);
  expect(openChat.toggle.width).toBe(openChat.viewportWidth);
  expect(openChat.panel.zIndex).toBeGreaterThan(openChat.reactions.zIndex);
  expect(openChat.panel.borderTopLeftRadius).toBe("8px");
  expect(openChat.toggle.borderTopLeftRadius).toBe("8px");
  await page.click("#chatClose");
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    window.emojiUI.handleChat({ sender: "Other", text: "Ping" });
  });
  const chatPopPosition = await page.evaluate(() => {
    const pop = document.querySelector(".emoji-pop.chat-pop");
    const header = document.querySelector(".room-header");
    const pr = pop.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    return {
      popTop: Math.round(pr.top),
      headerBottom: Math.round(hr.bottom),
    };
  });
  expect(chatPopPosition.popTop).toBeGreaterThanOrEqual(chatPopPosition.headerBottom + 6);
  await page.click(".emoji-pop.chat-pop");
  await page.waitForTimeout(250);
  const openedFromBubble = await page.evaluate(() => {
    const panel = document.querySelector("#chatPanel");
    const input = document.querySelector("#chatInput");
    return {
      isOpen: panel.classList.contains("open"),
      bodyOpen: document.body.classList.contains("chat-open"),
      expanded: document.querySelector("#chatToggle").getAttribute("aria-expanded"),
      activeId: document.activeElement && document.activeElement.id,
      unreadHidden: document.querySelector("#chatToggleCount").hidden,
      inputVisible: (() => {
        const r = input.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })(),
    };
  });
  expect(openedFromBubble).toMatchObject({
    isOpen: true,
    bodyOpen: true,
    expanded: "true",
    activeId: "chatInput",
    unreadHidden: true,
    inputVisible: true,
  });
  await page.click("#chatClose");
  await page.waitForTimeout(250);

  const beforeRulesUrl = page.url();
  await page.click("#roomHeaderMenuToggle");
  await expect(page.locator("#roomHeaderMenuPanel")).toBeVisible();
  await page.click("#rulesSheetOpen");
  await expect(page.locator("#rulesSheet")).toBeVisible();
  await expect(page.locator("#rulesFrame")).toHaveAttribute("src", /\/regeln\?embed=1/);
  expect(page.url()).toBe(beforeRulesUrl);
  await expect(page.frameLocator("#rulesFrame").locator("h1")).toContainText("Zock die Wand an: Spielregeln");
  await page.locator("#rulesFrame").hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(async () => {
    const frame = page.frame({ url: /\/regeln\?embed=1/ });
    return frame ? frame.evaluate(() => window.scrollY) : 0;
  }).toBeGreaterThan(0);
  await page.click("#rulesSheetClose");
  await expect(page.locator("#rulesSheet")).toBeHidden();

  await page.click("#chatReactionsBar .emoji-fab");
  const reactionPanel = await page.evaluate(() => {
    const panel = document.querySelector("#chatReactionsBar .emoji-panel");
    const host = document.querySelector("#chatReactionsBar");
    const pr = panel.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    return {
      emojis: Array.from(panel.querySelectorAll(".emoji-btn")).map((btn) => btn.textContent),
      panel: {
        top: Math.round(pr.top),
        bottom: Math.round(pr.bottom),
        left: Math.round(pr.left),
        right: Math.round(pr.right),
        width: Math.round(pr.width),
        height: Math.round(pr.height),
      },
      host: {
        top: Math.round(hr.top),
        bottom: Math.round(hr.bottom),
      },
      suggestions: (() => {
        const sr = document.querySelector(".suggestions-area").getBoundingClientRect();
        return {
          top: Math.round(sr.top),
          bottom: Math.round(sr.bottom),
        };
      })(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  });

  expect(reactionPanel.panel.bottom).toBeLessThanOrEqual(reactionPanel.host.top - 1);
  expect(reactionPanel.panel.top).toBeGreaterThanOrEqual(0);
  expect(reactionPanel.panel.left).toBeGreaterThanOrEqual(0);
  expect(reactionPanel.panel.right).toBeLessThanOrEqual(reactionPanel.viewport.width);
  expect(reactionPanel.emojis).toEqual([
    "👍", "👎", "🤞", "🙏", "🖕",
    "😂", "😲", "😡", "😜", "🙄", "🤦", "😭", "🤮",
    "🎉", "💩", "FEIG!",
  ]);
  await health.expectClean();
});

test("mobile announce picker shows two rows and disables filled fields", async ({ page, request }) => {
  await page.setViewportSize({ width: 367, height: 703 });
  const health = watchPageHealth(page);
  const created = await request.post("/api/games", {
    data: { name: "Mobile Announce Picker", mode: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Announce&__test=1`);
  await page.waitForSelector("#diceBar");
  const finalRollRules = await page.evaluate(() => ({
    regularThird: window.__rtDebugIsLastAllowedRoll({ _rolls_used: 3, _rolls_max: 3 }),
    specialThird: window.__rtDebugIsLastAllowedRoll({ _rolls_used: 3, _rolls_max: 5 }),
    specialFifth: window.__rtDebugIsLastAllowedRoll({ _rolls_used: 5, _rolls_max: 5 }),
  }));
  expect(finalRollRules).toEqual({ regularThird: true, specialThird: false, specialFifth: true });

  const filledField = page.locator('.player-card.me td.cell[data-row="0"][data-field="ang"]');
  await expect(filledField).toHaveClass(/clickable/);
  await filledField.click();
  if (await page.locator("#appDialogBackdrop:not([hidden])").isVisible()) {
    await expect(page.locator("#appDialog")).toContainText("0 Punkte");
    await page.click('[data-dialog-action="confirm"]');
  }
  await expect(filledField).not.toHaveText("");
  await expect(page.locator("#announceBtnInline")).toBeEnabled();

  const layoutBeforePicker = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const players = document.querySelector(".players-grid").getBoundingClientRect();
    return {
      topbarTop: topbar.top + window.scrollY,
      playersTop: players.top + window.scrollY,
      playersBottom: players.bottom + window.scrollY,
    };
  });
  await page.locator("#announceBtnInline").click();
  const picker = page.locator("#mobileAnnouncePicker");
  await expect(picker).toBeVisible();
  await expect(picker.locator(".mobile-announce-picker-row")).toHaveCount(2);
  await expect(picker.locator(".mobile-announce-option")).toHaveText([
    "1", "2", "3", "4", "5", "6",
    "+", "−", "K", "F", "P", "60",
  ]);
  await expect(picker.locator('.mobile-announce-option[data-field="1"]')).toBeDisabled();
  await expect(picker.locator('.mobile-announce-option[data-field="poker"]')).toBeEnabled();

  const bounds = await picker.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const players = document.querySelector(".players-grid").getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      topbarTop: topbar.top,
      topbarDocumentTop: topbar.top + window.scrollY,
      playersTop: players.top + window.scrollY,
      playersBottom: players.bottom + window.scrollY,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.topbarTop);
  expect(bounds.topbarDocumentTop).toBeCloseTo(layoutBeforePicker.topbarTop, 1);
  expect(bounds.playersTop).toBeCloseTo(layoutBeforePicker.playersTop, 1);
  expect(bounds.playersBottom).toBeCloseTo(layoutBeforePicker.playersBottom, 1);

  await picker.locator('.mobile-announce-option[data-field="poker"]').click();
  await expect(picker).toBeHidden();
  await expect(page.locator("#announceBtnInline")).toContainText("Ansage aufheben");

  const rollButton = page.locator("#rollBtnInline");
  await expect(rollButton).toBeEnabled();
  await rollButton.click();
  await expect(rollButton).toBeEnabled();
  const autoWriteTiming = page.evaluate(() => new Promise((resolve, reject) => {
    let sawAnimation = false;
    let animationEndedAt = null;
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Automatisches Schreiben wurde nicht beobachtet"));
    }, 5000);
    const observer = new MutationObserver(() => {
      const shaking = document.querySelectorAll("#diceBar .die.shaking").length > 0;
      if (shaking) sawAnimation = true;
      if (sawAnimation && !shaking && animationEndedAt === null) {
        animationEndedAt = performance.now();
      }
      const target = document.querySelector('.player-card.me td.cell[data-row="14"][data-field="ang"]');
      if (animationEndedAt !== null && target?.textContent.trim()) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve({ afterAnimationMs: performance.now() - animationEndedAt });
      }
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  }));
  await rollButton.click();
  const pokerAng = page.locator('.player-card.me td.cell[data-row="14"][data-field="ang"]');
  await expect(pokerAng).not.toHaveText("", { timeout: 5000 });
  const timing = await autoWriteTiming;
  expect(timing.afterAnimationMs).toBeGreaterThanOrEqual(450);
  await health.expectClean();
});

test("game result dialog keeps the final standings visible and creates a new round", async ({ page, request }) => {
  const created = await request.post("/api/games", { data: { name: "Result dialog", mode: 1 } });
  const { game_id: gameId } = await created.json();
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Result&__test=1`);
  await page.waitForSelector("#diceBar");

  await page.evaluate(() => {
    window.__rtDebugShowGameResults({
      _results: [{ name: "Result", total: 777 }],
      _mode: "2",
      _hardcore: true,
    });
  });
  await expect(page.locator("#appDialog")).toContainText("1. Result – 777 Punkte");
  await expect(page.getByRole("button", { name: "Neue Runde" })).toBeVisible();
  await Promise.all([
    page.waitForURL(url => (
      /^\/spiel\/[^/]+$/.test(url.pathname)
      && activeGameId(url.toString()) !== gameId
    )),
    page.getByRole("button", { name: "Neue Runde" }).click(),
  ]);
  const nextGameId = activeGameId(page.url());
  expect(nextGameId).toBeTruthy();
  expect(nextGameId).not.toBe(gameId);
  await page.waitForSelector("#diceBar");
  const nextGame = await request.get(`/api/games/${encodeURIComponent(nextGameId)}`);
  expect(nextGame.ok()).toBeTruthy();
  expect(await nextGame.json()).toMatchObject({
    exists: true,
    mode: "2",
    hardcore: true,
    started: false,
    finished: false,
  });
});

test("new achievements are acknowledged individually before the final standings", async ({ page, request }) => {
  const created = await request.post("/api/games", { data: { name: "Achievement queue", mode: 1 } });
  const { game_id: gameId } = await created.json();
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Achievement&__test=1`);
  await page.waitForSelector("#diceBar");

  await page.evaluate(() => {
    void window.__rtDebugShowGameResults({
      _results: [{ name: "Achievement", total: 777 }],
      _mode: "1",
    }, [
      {
        key: "first-achievement",
        name: "Erster Erfolg",
        description: "Die erste Belohnung.",
        points: 3,
      },
      {
        key: "second-achievement",
        name: "Zweiter Erfolg",
        description: "Die zweite Belohnung.",
        points: 7,
      },
    ], {
      achievementRankUp: {
        previous: {
          key: "newbie",
          title: "Newbie",
          stars: 0,
          points: 12,
          minimum_points: 0,
        },
        current: {
          key: "rookie",
          title: "Rookie",
          stars: 1,
          points: 15,
          minimum_points: 13,
        },
      },
    });
  });

  const dialog = page.locator("#appDialog");
  await expect(dialog).toHaveAttribute("data-kind", "achievement");
  await expect(dialog).toContainText("Erster Erfolg");
  await expect(dialog).toContainText("+3 Ehrenberg-Marken");
  await expect(dialog).toContainText("1 / 2");
  await expect(page.getByRole("button", { name: "Neue Runde" })).toHaveCount(0);
  await expect(page.locator("#appDialogClose")).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(dialog).toContainText("Erster Erfolg");

  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-kind", "achievement");
  await expect(dialog).toContainText("Zweiter Erfolg");
  await expect(dialog).toContainText("+7 Ehrenberg-Marken");
  await expect(dialog).toContainText("2 / 2");

  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-kind", "level-up");
  await expect(dialog).toContainText("LEVEL UP!");
  await expect(dialog).toContainText("Newbie → Rookie");
  await expect(dialog).toContainText("15 Ehrenberg-Marken");
  await expect(page.getByRole("button", { name: "Neue Runde" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toContainText("LEVEL UP!");

  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-kind", "success");
  await expect(dialog).toContainText("1. Achievement – 777 Punkte");
  await expect(page.getByRole("button", { name: "Neue Runde" })).toBeVisible();
});

test("the last struck field stays visible while finalization waits for achievements", async ({ page }) => {
  const rows = [0, 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15];
  const columns = ["down", "free", "up", "ang"];
  const board = Object.fromEntries(
    columns.flatMap(column => rows
      .filter(row => !(row === 15 && column === "ang"))
      .map(row => [`${row},${column}`, 0]))
  );
  const snapshot = ({ finished, pending }) => ({
    _name: "Finalisierung",
    _hardcore: false,
    _players: [{ id: "final-player", name: "Finalizer" }],
    _players_joined: 1,
    _expected: 1,
    _started: !finished,
    _finished: finished,
    _aborted: false,
    _paused: false,
    _manual_pause: false,
    _offline_players: [],
    _connected: { "final-player": true },
    _turn: finished ? null : { player_id: "final-player", roll_index: 1, first4oak_roll: null },
    _dice: [1, 2, 3, 4, 5],
    _holds: [false, false, false, false, false],
    _rolls_used: finished ? 0 : 1,
    _rolls_max: finished ? 0 : 5,
    _scoreboards: {
      "final-player": finished ? { ...board, "15,ang": 0 } : board,
    },
    _admin_edits: {},
    _superadmin_active: false,
    _announced_row4: null,
    _announced_by: null,
    _announced_board: null,
    _correction: { active: false },
    _mode: "1",
    _teams: [],
    _scoreboards_by_team: {},
    _results: finished ? [{ player: "Finalizer", total: 0 }] : null,
    _last_write_public: {},
    _has_last: { "final-player": false },
    _auto_single: false,
    _chat_history: [],
    suggestions: [],
    _finalization_pending: pending,
  });
  const writes = [];

  await page.routeWebSocket(/\/ws\/finalization-flow$/, socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action === "join_game") {
        socket.send(JSON.stringify({ player_id: "final-player", resume_token: "terminal-token" }));
        socket.send(JSON.stringify({ scoreboard: snapshot({ finished: false, pending: false }) }));
        return;
      }
      if (message.action !== "write_field") return;
      writes.push(message);
      socket.send(JSON.stringify({
        scoreboard: snapshot({ finished: true, pending: true }),
        finalization_pending: true,
      }));
      setTimeout(() => {
        socket.send(JSON.stringify({
          scoreboard: snapshot({ finished: true, pending: false }),
          finalization_pending: false,
          achievement_unlocks: {
            "final-player": [{
              key: "terminal-achievement",
              name: "Letzter Zug",
              description: "Das letzte Feld sicher abgeschlossen.",
              points: 4,
              unlocked_at: "2026-09-02T12:34:56+00:00",
            }],
          },
          achievement_rank_ups: {
            "final-player": {
              previous: { key: "newbie", title: "Newbie", stars: 0, points: 12, minimum_points: 0 },
              current: { key: "rookie", title: "Rookie", stars: 1, points: 15, minimum_points: 13 },
            },
          },
        }));
      }, 550);
    });
  });

  await page.goto("/spiel/finalization-flow?name=Finalizer&__test=1");
  const lastCell = page.locator('.player-card.me td.cell[data-row="15"][data-field="ang"]');
  await expect(lastCell).toHaveText("");
  await lastCell.click();
  await page.getByRole("button", { name: "Streichen" }).click();
  await expect.poll(() => writes.length).toBe(1);

  const dialog = page.locator("#appDialog");
  await expect(lastCell).toHaveText("0");
  await expect(dialog).toContainText("1. Finalizer – 0 Punkte");
  await expect(dialog).toContainText("Erfolge werden geprüft …");
  await expect(dialog.locator('[data-dialog-action="pending-finalization"]')).toBeDisabled();
  await expect(page.getByRole("button", { name: "Neue Runde" })).toHaveCount(0);

  await expect(dialog).toHaveAttribute("data-kind", "achievement");
  await expect(dialog).toContainText("Letzter Zug");
  await expect(dialog).toContainText("+4 Ehrenberg-Marken");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-kind", "level-up");
  await expect(dialog).toContainText("Newbie → Rookie");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-kind", "success");
  await expect(dialog).toContainText("1. Finalizer – 0 Punkte");
  await expect(page.getByRole("button", { name: "Neue Runde" })).toBeVisible();
});

test("a fast completion cannot leave a queued finalization dialog behind", async ({ page, request }) => {
  const created = await request.post("/api/games", { data: { name: "Fast completion", mode: 1 } });
  const { game_id: gameId } = await created.json();
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Fast&__test=1`);
  await page.waitForSelector("#diceBar");

  await page.evaluate(() => {
    const pendingSnapshot = {
      _name: "Fast completion",
      _mode: "1",
      _results: [{ name: "Fast", total: 555 }],
      _finalization_pending: true,
    };
    const completedSnapshot = {
      ...pendingSnapshot,
      _finalization_pending: false,
    };
    // Simulate the just-closed strike confirmation: another dialog is still
    // active while the first and second terminal WebSocket frames arrive.
    void window.ZDWA_UI.dialog({
      id: "fast-finalization-blocker",
      title: "Bitte warten",
      message: "Kurz noch …",
      dismissible: false,
      actions: [{ id: "hold", label: "Bitte warten", className: "primary", disabled: true }],
    });
    void window.__rtDebugShowGameResults(pendingSnapshot, [], { finalizationPending: true });
    void window.__rtDebugShowGameResults(completedSnapshot, [{
      key: "fast-terminal-achievement",
      name: "Schnelles Finale",
      description: "Die Auswertung kam sofort an.",
      points: 2,
      unlocked_at: "2026-09-02T12:34:56+00:00",
    }], { finalizationPending: false });
    window.ZDWA_UI.dismiss("fast-finalization-blocker", "released");
  });

  const dialog = page.locator("#appDialog");
  await expect(dialog).toHaveAttribute("data-kind", "achievement");
  await expect(dialog).toContainText("Schnelles Finale");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-kind", "success");
  await expect(dialog).toContainText("1. Fast – 555 Punkte");
  await expect(page.getByRole("button", { name: "Neue Runde" })).toBeVisible();
});

test("protected game passphrases use an in-app dialog and stay out of the room URL", async ({ page, request }) => {
  const created = await request.post("/api/games", {
    data: { name: "Protected game", mode: 1, pass: "secret-round" },
  });
  const { game_id: gameId } = await created.json();
  await page.goto("/");
  await page.fill("#playerName", "ProtectedPlayer");
  const join = page.locator(`.joinBtn[data-id="${gameId}"]`);
  await expect(join).toBeVisible();
  await join.click();
  await expect(page.locator("#appDialog")).toContainText("Passphrase erforderlich");
  await page.fill("#appDialogInput", "secret-round");
  await Promise.all([
    page.waitForURL(/\/spiel\/[^/?]+/),
    page.click('[data-dialog-action="confirm"]'),
  ]);
  expect(new URL(page.url()).searchParams.has("pass")).toBe(false);
  const stored = await page.evaluate(gid => sessionStorage.getItem(`wuerfler_pass_${gid}`), gameId);
  expect(stored).toBe("secret-round");
});
