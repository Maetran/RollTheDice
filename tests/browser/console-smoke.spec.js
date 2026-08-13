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

test("lobby can create a game and open spectator view without browser errors", async ({ page, browser }) => {
  const health = watchPageHealth(page);
  await page.goto("/");
  await page.fill("#playerName", "Smoke");
  await page.fill("#passInput", "");
  await page.selectOption("#gameMode", "1");
  await page.click("#createBtn");
  await page.waitForURL(/room\.html\?game_id=/);
  await page.waitForSelector("#diceBar");
  await health.expectClean();

  const spectator = await browser.newPage();
  const spectatorHealth = watchPageHealth(spectator);
  await spectator.goto("/");
  await spectator.fill("#playerName", "Observer");
  await spectator.waitForSelector("button.spectateBtn");
  await spectator.click("button.spectateBtn");
  await spectator.waitForURL(/room\.html\?game_id=.*spectator=1/);
  await spectator.waitForSelector("#diceBar");
  await spectatorHealth.expectClean();
  await spectator.close();
});

test("game creation API flow from lobby and spectator mode both work", async ({ page, browser, request }) => {
  const health = watchPageHealth(page);
  await page.goto("/");
  await page.fill("#playerName", "Creator");
  await page.fill("#passInput", "");
  await page.selectOption("#gameMode", "1");

  const createResponsePromise = page.waitForResponse((res) => {
    return res.url().endsWith("/api/games") &&
      res.request().method() === "POST";
  });
  await page.click("#createBtn");

  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBeTruthy();

  await page.waitForURL(/room\.html\?game_id=/);
  const gameId = new URL(page.url()).searchParams.get("game_id");
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
  await spectateButton.click();
  await spectator.waitForURL(/room\.html\?game_id=.*spectator=1/);
  expect(new URL(spectator.url()).searchParams.get("game_id")).toBe(gameId);
  expect(new URL(spectator.url()).searchParams.get("spectator")).toBe("1");
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

  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=Anna`);
  await page.waitForSelector("#diceBar");
  await expect(page.locator(".player-card")).toContainText("Anna");

  const player2Context = await browser.newContext();
  const player2 = await player2Context.newPage();
  const player2Health = watchPageHealth(player2);
  await player2.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=Ben`);
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
  await resumeButton.click();
  await resumedPlayer2.waitForURL(/room\.html\?game_id=/);
  await resumedPlayer2.waitForSelector("#diceBar");

  await expect(page.locator("#multiplayerPauseNotice")).toBeHidden();
  await expect(page.locator("#rollBtnInline")).toBeEnabled();

  await resumedHealth.expectClean();
  await health.expectClean();
  await resumedPlayer2.close();
  await player2Context.close();
});

test("back to lobby can pause a game and resume it later", async ({ page, request }) => {
  const health = watchPageHealth(page);
  const created = await request.post("/api/games", {
    data: { name: "Manual Pause Smoke", mode: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=Solo`);
  await page.waitForSelector("#diceBar");

  const dialogMessages = [];
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    if (dialog.type() === "prompt") await dialog.accept("P");
    else await dialog.accept();
  });

  await page.click("#backToLobbyBtn");
  await page.waitForURL("/");
  expect(dialogMessages[0]).toContain("P = Spiel pausieren");
  expect(dialogMessages.some((message) => message.includes("Spiel pausiert"))).toBeTruthy();

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
  await resumeButton.click();
  await page.waitForURL(/room\.html\?game_id=/);
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

  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=Smoke&__test=1`);
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
      loadedCss: Array.from(document.styleSheets)
        .map((sheet) => sheet.href)
        .filter(Boolean)
        .find((href) => href.includes("style.css")) || "",
    };
  });

  expect(layout.loadedCss).toContain("style.css?v=");
  expect(layout.headerStatus.bottom).toBeLessThanOrEqual(layout.card.top + 1);
  expect(layout.suggestions.bottom).toBeLessThanOrEqual(layout.topbar.top + 1);
  expect(layout.lastRow.bottom).toBeLessThanOrEqual(layout.topbar.top - 1);
  expect(layout.topbar.bottom).toBeLessThanOrEqual(layout.chatToggle.top + 1);
  expect(layout.chatToggle.top - layout.topbar.bottom).toBeGreaterThanOrEqual(5);
  expect(layout.chatReactions.right).toBeLessThanOrEqual(layout.chatToggle.left + 1);
  expect(layout.chatReactions.top).toBeGreaterThanOrEqual(layout.chatToggle.top);
  expect(layout.chatReactions.top).toBeLessThanOrEqual(layout.chatToggle.top + 2);
  expect(layout.chatReactions.height).toBe(layout.chatToggle.height);
  expect(layout.die.width).toBeGreaterThanOrEqual(48);
  expect(layout.die.width).toBeLessThanOrEqual(57);
  expect(layout.die.height).toBe(layout.die.width);
  expect(layout.heldDieBorderWidth).toBe("2px");
  expect(layout.tableWrap.height).toBeGreaterThanOrEqual(395);

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
  await page.click("#rulesSheetOpen");
  await expect(page.locator("#rulesSheet")).toBeVisible();
  await expect(page.locator("#rulesFrame")).toHaveAttribute("src", /rules\.html\?embed=1/);
  expect(page.url()).toBe(beforeRulesUrl);
  await expect(page.frameLocator("#rulesFrame").locator("h1")).toContainText("Spielanleitung");
  await page.locator("#rulesFrame").hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(async () => {
    const frame = page.frame({ url: /rules\.html\?embed=1/ });
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

  expect(reactionPanel.panel.bottom).toBeLessThanOrEqual(reactionPanel.suggestions.top - 1);
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
