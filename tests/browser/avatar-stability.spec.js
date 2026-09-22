const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

test.use({ serviceWorkers: "block" });

const anna = { id: "p1", user_id: 701, name: "Anna", username: "Anna", connected: true, is_active: true };
const ben = { id: "p2", user_id: 702, name: "Ben", username: "Ben", connected: true, is_active: true };
const avatarSelector = "#gamesList img.player-avatar, #runningList img.player-avatar, #recentTable img.player-avatar, #alltimeTable img.player-avatar";

function fixtures() {
  const result = (gameId, player, points) => ({ game_id: gameId, name: player.name, points, finished_at: "2026-09-22T10:00:00Z", entry_players: [player] });
  return {
    games: { games: [
      { id: "waiting-a", name: "Waiting A", mode: "2", players: 1, expected: 2, started: false, player_statuses: [anna] },
      { id: "waiting-b", name: "Waiting B", mode: "2", players: 1, expected: 2, started: false, player_statuses: [anna] },
      { id: "running", name: "Running", mode: "2", players: 2, expected: 2, started: true, started_at: "2026-09-22T10:00:00Z", player_statuses: [anna, ben], progress: [anna, ben].map(player => ({ ...player, filled: 7, of: 48, points: 123 })) },
    ], online_users: 2 },
    leaderboard: {
      stats: { games_played: 7, average_points: { normal: {}, hc: {} } },
      recent: { normal: [result("result-a", anna, 456), result("result-b", anna, 345)], hc: [] },
      alltime: { normal: [result("result-b", anna, 345)], hc: [] },
      abandonments: { recent: [], alltime: [] },
    },
  };
}

async function mockAvatars(page) {
  await page.route(/\/api\/avatars\/(701|702)(?:\?.*)?$/, route => route.fulfill({
    contentType: "image/svg+xml",
    headers: { "Cache-Control": "no-store" },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#d23"/></svg>',
  }));
}

async function mockLobby(page, { chat = false } = {}) {
  const data = fixtures();
  const requests = { games: 0, leaderboard: 0 };
  await page.addInitScript(() => {
    localStorage.setItem("zdwa_language", "de");
    window.__avatarLoads = new Map();
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains("player-avatar")) {
        window.__avatarLoads.set(event.target, (window.__avatarLoads.get(event.target) || 0) + 1);
      }
    }, true);
  });
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: true,
    user: { id: 701, username: "Anna", must_change_password: false, preferences: { lobby_chat_enabled: chat, lobby_chat_popups: false } },
    game_access: { zilch_preview: true, zilch_public: true },
    passkeys: { enabled: false }, registration: { email_enabled: false, turnstile_enabled: false },
  } }));
  await page.route(/\/api\/games(?:\?.*)?$/, route => {
    requests.games += 1;
    return route.fulfill({ json: data.games });
  });
  await page.route("**/api/leaderboard", route => {
    requests.leaderboard += 1;
    return route.fulfill({ json: data.leaderboard });
  });
  await page.route(/\/api\/zilch\/leaderboards(?:\?.*)?$/, route => route.fulfill({ json: { entries: [] } }));
  await mockAvatars(page);
  return { data, requests };
}

async function rememberAvatars(page, selector) {
  await page.locator(selector).evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
  await expect.poll(() => page.locator(selector).evaluateAll(images => images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.evaluate(selector => {
    window.__stableAvatars = [...document.querySelectorAll(selector)].map(image => ({
      image, source: image.currentSrc, loads: window.__avatarLoads.get(image) || 0,
    }));
  }, selector);
}

async function expectStableAvatars(page, { allowMore = false, selector = avatarSelector } = {}) {
  const result = await page.evaluate(({ selector, allowMore }) => {
    const current = [...document.querySelectorAll(selector)];
    return (allowMore || current.length === window.__stableAvatars.length)
      && window.__stableAvatars.every(({ image, source, loads }) => current.includes(image)
        && image.isConnected && image.complete && image.naturalWidth > 0 && image.currentSrc === source
        && (window.__avatarLoads.get(image) || 0) === loads);
  }, { selector, allowMore });
  expect(result).toBe(true);
}

for (const width of [1440, 834, 390]) {
  test(`ZDWA lobby and rankings preserve decoded avatars through polling and reordered results (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    const { data, requests } = await mockLobby(page);
    await page.goto("/");
    await expect(page.locator(avatarSelector)).toHaveCount(7);
    await rememberAvatars(page, avatarSelector);

    let gamesBefore = requests.games;
    let rankingsBefore = requests.leaderboard;
    await page.clock.fastForward(10_001);
    await expect.poll(() => requests.games).toBeGreaterThan(gamesBefore);
    await expect.poll(() => requests.leaderboard).toBeGreaterThan(rankingsBefore);
    await page.clock.runFor(100);
    await expectStableAvatars(page);

    data.games.games.reverse();
    data.games.games.find(game => game.started).progress[0].points = 789;
    data.leaderboard.recent.normal.reverse();
    data.leaderboard.recent.normal[0].points = 999;
    gamesBefore = requests.games;
    rankingsBefore = requests.leaderboard;
    await page.clock.fastForward(10_001);
    await expect.poll(() => requests.games).toBeGreaterThan(gamesBefore);
    await expect.poll(() => requests.leaderboard).toBeGreaterThan(rankingsBefore);
    await expect(page.locator("#runningList")).toContainText("789");
    await expect(page.locator("#recentTable")).toContainText("999");
    await expectStableAvatars(page);

    // An actual upload refreshes every occurrence, and later polling must not
    // restore the old base URL or discard the newly decoded images.
    await page.evaluate(async () => {
      const { refreshAccountAvatars } = await import("/static/avatar.js");
      refreshAccountAvatars(701);
    });
    await expect(page.locator('#gamesList img[data-user-avatar="701"]').first()).toHaveAttribute("src", /\?v=\d+$/);
    await rememberAvatars(page, avatarSelector);
    gamesBefore = requests.games;
    rankingsBefore = requests.leaderboard;
    await page.clock.fastForward(10_001);
    await expect.poll(() => requests.games).toBeGreaterThan(gamesBefore);
    await expect.poll(() => requests.leaderboard).toBeGreaterThan(rankingsBefore);
    await page.clock.runFor(100);
    await expectStableAvatars(page);
  });
}

for (const product of ["/", "/zilch"]) {
  test(`shared lobby chat keeps earlier avatars when new messages arrive (${product})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLobby(page, { chat: true });
    if (product === "/zilch") {
      // Serve the shipped lobby without changing the test server's preview
      // audience; route authorization has its own backend/browser contracts.
      const body = await readFile(path.join(__dirname, "../../app/static/zilch-lobby.html"), "utf8");
      await page.route("**/zilch", route => route.fulfill({ contentType: "text/html", body }));
    }
    let socket;
    await page.routeWebSocket(/\/ws\/lobby-chat(?:\?.*)?$/, connection => { socket = connection; });
    await page.goto(product);
    await expect.poll(() => Boolean(socket)).toBe(true);
    const send = (id, userId = 701) => socket.send(JSON.stringify({ lobby_chat_history: true, lobby_chat: {
      id, kind: "message", sender: userId === 701 ? "Anna" : "Ben", user_id: userId,
      text: `Nachricht ${id}`, game_type: "zdwa", sent_at: `2026-09-22T10:00:0${id}Z`,
    } }));
    send(1);
    send(2);
    const selector = "[data-lobby-chat-messages] img.player-avatar";
    await expect(page.locator(selector)).toHaveCount(2);
    await rememberAvatars(page, selector);
    send(3, 702);
    await expect(page.locator(selector)).toHaveCount(3);
    await expectStableAvatars(page, { selector, allowMore: true });
    await expect(page.locator("[data-lobby-chat-messages]")).toContainText("Nachricht 3");
  });
}

test("avatar reuse escapes occurrence keys and replaces a changed player identity", async ({ page }) => {
  await mockAvatars(page);
  await page.goto("/regeln");
  const result = await page.evaluate(async () => {
    const { avatarMarkup, replaceChildrenPreservingAvatars } = await import("/static/avatar.js");
    const container = document.createElement("div");
    document.body.append(container);
    const key = 'slot" onerror="window.__avatarInjected=true';
    replaceChildrenPreservingAvatars(container, avatarMarkup(701, { avatarKey: key }));
    const first = container.querySelector("img");
    replaceChildrenPreservingAvatars(container, avatarMarkup(702, { avatarKey: key }));
    const second = container.querySelector("img");
    const changedIdentity = second !== first && second.dataset.userAvatar === "702" && !first.isConnected;
    const escaped = second.dataset.avatarKey === key && !second.hasAttribute("onerror");
    // Defensive duplicate keys must not make one occurrence disappear.
    replaceChildrenPreservingAvatars(container, avatarMarkup(702, { avatarKey: key }) + avatarMarkup(702, { avatarKey: key }));
    return { changedIdentity, escaped, count: container.querySelectorAll("img").length, unique: new Set(container.querySelectorAll("img")).size };
  });
  expect(result).toEqual({ changedIdentity: true, escaped: true, count: 2, unique: 2 });
});
