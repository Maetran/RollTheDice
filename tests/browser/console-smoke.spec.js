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

test("mobile game layout keeps totals above the dice bar and has no browser errors", async ({ page, request }) => {
  await page.setViewportSize({ width: 367, height: 703 });
  const health = watchPageHealth(page);
  const created = await request.post("/api/games", {
    data: { name: "Mobile Layout Smoke", mode: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/static/room.html?game_id=${encodeURIComponent(gameId)}&name=Smoke`);
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
  expect(layout.die.width).toBeLessThanOrEqual(55);
  expect(layout.die.height).toBe(layout.die.width);
  expect(layout.heldDieBorderWidth).toBe("2px");

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
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 70));
      frames.push(labels());
      transforms.push(Array.from(document.querySelectorAll("#diceBar .die"))
        .map((die) => window.getComputedStyle(die).transform));
    }
    const changedDice = before.filter((label, index) => {
      return frames.some((frame) => frame[index] && frame[index] !== label);
    }).length;
    const shakingCount = document.querySelectorAll("#diceBar .die.shaking").length;
    const transformedFrames = transforms.flat().filter((value) => value && value !== "none").length;
    return { before, frames, changedDice, shakingCount, transformedFrames };
  });
  expect(rollVisual.shakingCount).toBeGreaterThan(0);
  expect(rollVisual.changedDice).toBeGreaterThanOrEqual(3);
  expect(rollVisual.transformedFrames).toBeGreaterThan(0);
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
