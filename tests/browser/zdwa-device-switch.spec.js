const { test, expect } = require("@playwright/test");

const credentials = { username: "Admin", password: "temporary-password-123" };

async function deviceContext(browser, baseURL, viewport) {
  const context = await browser.newContext({ baseURL, viewport, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const login = await context.request.post("/api/auth/login", { data: credentials });
  expect(login.ok()).toBeTruthy();
  return context;
}

function watchRoom(page) {
  const received = [];
  const sent = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on("console", message => {
    if (message.type() === "error" || message.text().startsWith("Serverfehler:")) errors.push(message.text());
  });
  page.on("websocket", socket => {
    socket.on("framesent", frame => sent.push(JSON.parse(String(frame.payload))));
    socket.on("framereceived", frame => {
      const message = JSON.parse(String(frame.payload));
      received.push(message);
      if (message.error) errors.push(message.error);
    });
  });
  return {
    received, sent, errors,
    snapshot: () => received.findLast(message => message.scoreboard)?.scoreboard,
  };
}

async function createTabletGame(tablet, room) {
  await tablet.goto("/");
  await expect(tablet.locator("#authBadge")).toContainText(credentials.username);
  await tablet.locator('[data-game-mode="2"]').click();
  await Promise.all([
    tablet.waitForURL(/\/spiel\/[^/?]+$/),
    tablet.locator("#createBtn").click(),
  ]);
  await expect(tablet.locator(".player-card.me")).toContainText(credentials.username);
  await expect.poll(() => room.snapshot()?._players_joined).toBe(1);
  expect(room.snapshot()._started).toBe(false);
  const gameId = decodeURIComponent(new URL(tablet.url()).pathname.split("/").pop());
  const playerId = room.snapshot()._players[0].id;
  expect(room.received.some(message => message.player_id === playerId && message.resume_token)).toBe(true);
  return { gameId, playerId, url: tablet.url() };
}

async function expectNoLocalSeat(page, gameId) {
  expect(await page.evaluate(id => ({
    player: localStorage.getItem(`wuerfler_pid_${id}`),
    sessionPlayer: sessionStorage.getItem(`wuerfler_pid_${id}`),
    token: localStorage.getItem(`wuerfler_token_${id}`),
  }), gameId)).toEqual({ player: null, sessionPlayer: null, token: null });
}

async function expectOriginalSeat(page, room, game, playerCount) {
  await expect(page.locator(".player-card.me")).toContainText(credentials.username);
  await expect.poll(() => room.snapshot()?._players_joined).toBe(playerCount);
  await expect.poll(() => room.received.some(message => message.player_id === game.playerId && message.resume_token)).toBe(true);
  const players = room.snapshot()._players;
  expect(players[0].id).toBe(game.playerId);
  expect(players.filter(player => player.name === credentials.username)).toHaveLength(1);
  expect(await page.evaluate(id => localStorage.getItem(`wuerfler_pid_${id}`), game.gameId)).toBe(game.playerId);
  expect(room.errors).toEqual([]);
}

test("ZDWA tablet host can notify, share, close, then watch and resume the waiting game on a phone", async ({ browser, baseURL }) => {
  const tabletContext = await deviceContext(browser, baseURL, { width: 820, height: 1180 });
  const phoneContext = await deviceContext(browser, baseURL, { width: 390, height: 844 });
  try {
    const tablet = await tabletContext.newPage();
    const tabletRoom = watchRoom(tablet);
    await tablet.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: async data => { window.__sharedGameUrl = data.url; } });
    });
    const game = await createTabletGame(tablet, tabletRoom);
    let notifications = 0;
    // Only the Push boundary is mocked: this regression must never send a
    // notification, while game identity and WebSocket traffic stay real.
    await tablet.route(`**/api/games/${game.gameId}/notify-open-seat`, route => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-csrf-token"]).toBeTruthy();
      notifications += 1;
      return route.fulfill({ json: { ok: true, notified: true } });
    });
    await tablet.locator("#roomHeaderMenuToggle").click();
    await tablet.locator("#notifyOpenSeatBtn").click();
    await expect(tablet.getByText("Spieler mit aktivierten Push-Benachrichtigungen wurden informiert.")).toBeVisible();
    expect(notifications).toBe(1);
    await tablet.locator("#roomHeaderMenuToggle").click();
    await tablet.locator("#shareGameBtn").click();
    await expect.poll(() => tablet.evaluate(() => window.__sharedGameUrl)).toBe(game.url);
    expect(tabletRoom.errors).toEqual([]);
    await tablet.close();

    const phone = await phoneContext.newPage();
    const phoneRoom = watchRoom(phone);
    await phone.goto("/");
    await expect(phone.locator("#authBadge")).toContainText(credentials.username);
    await expectNoLocalSeat(phone, game.gameId);
    const row = phone.locator("#gamesList .game-row").filter({ has: phone.locator(`.resumeBtn[data-id="${game.gameId}"]`) });
    await expect(row.locator(".resumeBtn")).toHaveText("Wieder aufnehmen");
    await expect(row.locator(".joinBtn")).toHaveCount(0);
    await expect(row.locator(".spectateBtn")).toHaveText("Zuschauen");

    await row.locator(".spectateBtn").click();
    await expect(phone).toHaveURL(`${game.url}/zuschauen`);
    await expect(phone.locator(".player-card")).toHaveCount(1);
    await expect(phone.locator(".player-card.me")).toHaveCount(0);
    await expect.poll(() => phoneRoom.received.some(message => message.spectator_id)).toBe(true);
    expect(phoneRoom.snapshot()._players_joined).toBe(1);
    expect(phoneRoom.snapshot()._players[0].id).toBe(game.playerId);
    await expectNoLocalSeat(phone, game.gameId);

    await phone.locator("#backToLobbyBtn").click();
    await expect(row.locator(".resumeBtn")).toBeVisible();
    await row.locator(".resumeBtn").click();
    await expect(phone).toHaveURL(game.url);
    await expectOriginalSeat(phone, phoneRoom, game, 1);
    expect(phoneRoom.snapshot()._started).toBe(false);
    expect(phoneRoom.sent).toContainEqual(expect.objectContaining({ action: "rejoin_game", player_id: game.playerId, resume_token: "" }));
  } finally {
    await phoneContext.close();
    await tabletContext.close();
  }
});

for (const started of [false, true]) {
  test(`ZDWA shared link restores the host without local credentials in a ${started ? "full running" : "waiting"} game`, async ({ browser, baseURL }) => {
    const tabletContext = await deviceContext(browser, baseURL, { width: 820, height: 1180 });
    const phoneContext = await deviceContext(browser, baseURL, { width: 390, height: 844 });
    const opponentContext = started ? await browser.newContext({ baseURL, serviceWorkers: "block" }) : null;
    try {
      const tablet = await tabletContext.newPage();
      const tabletRoom = watchRoom(tablet);
      const game = await createTabletGame(tablet, tabletRoom);
      let opponentRoom;
      if (opponentContext) {
        const opponent = await opponentContext.newPage();
        opponentRoom = watchRoom(opponent);
        await opponent.goto(`${game.url}?name=DeviceSwitchOpponent`);
        await expect(opponent.locator(".player-card.me")).toContainText("DeviceSwitchOpponent");
        await expect.poll(() => tabletRoom.snapshot()?._started).toBe(true);
        expect(tabletRoom.snapshot()._players_joined).toBe(2);
      }
      expect(tabletRoom.errors).toEqual([]);
      await tablet.close();

      const phone = await phoneContext.newPage();
      const phoneRoom = watchRoom(phone);
      await phone.goto("/");
      await expect(phone.locator("#authBadge")).toContainText(credentials.username);
      await expectNoLocalSeat(phone, game.gameId);
      // Opening the canonical shared URL bypasses the lobby's resume button;
      // a fresh device initially sends join_game without a player ID/token.
      await phone.goto(game.url);
      await expectOriginalSeat(phone, phoneRoom, game, started ? 2 : 1);
      expect(phoneRoom.snapshot()._started).toBe(started);
      expect(phoneRoom.sent).toContainEqual(expect.objectContaining({ action: "join_game" }));
      expect(phoneRoom.sent.some(message => message.action === "rejoin_game")).toBe(false);
      if (opponentRoom) {
        await expect.poll(() => opponentRoom.snapshot()?._connected?.[game.playerId]).toBe(true);
        expect(opponentRoom.snapshot()._players_joined).toBe(2);
        expect(opponentRoom.errors).toEqual([]);
      }
    } finally {
      await phoneContext.close();
      await tabletContext.close();
      await opponentContext?.close();
    }
  });
}

test("ZDWA phone takeover keeps the original tablet from reconnecting and taking the seat back", async ({ browser, baseURL }) => {
  const tabletContext = await deviceContext(browser, baseURL, { width: 820, height: 1180 });
  const phoneContext = await deviceContext(browser, baseURL, { width: 390, height: 844 });
  const opponentContext = await browser.newContext({ baseURL, serviceWorkers: "block" });
  try {
    const tablet = await tabletContext.newPage();
    const tabletRoom = watchRoom(tablet);
    const game = await createTabletGame(tablet, tabletRoom);
    const opponent = await opponentContext.newPage();
    const opponentRoom = watchRoom(opponent);
    await opponent.goto(`${game.url}?name=DeviceSwitchOpponent`);
    await expect.poll(() => tabletRoom.snapshot()?._started).toBe(true);

    const phone = await phoneContext.newPage();
    const phoneRoom = watchRoom(phone);
    await phone.goto("/");
    await expectNoLocalSeat(phone, game.gameId);
    await phone.goto(game.url);
    await expectOriginalSeat(phone, phoneRoom, game, 2);
    const takeoverMessage = "Das Spiel wurde auf einem anderen Gerät fortgesetzt.";
    await expect(tablet.getByRole("dialog")).toContainText(takeoverMessage);
    expect(tabletRoom.received).toContainEqual(expect.objectContaining({ error: takeoverMessage, fatal: true }));
    // The first automatic reconnect would run after one second. Keep the old
    // tab open past that point to catch clients that steal the seat back.
    await tablet.waitForTimeout(1500);
    expect(tabletRoom.sent.filter(message => ["join_game", "rejoin_game"].includes(message.action))).toHaveLength(1);
    expect(tabletRoom.errors.filter(error => !error.includes(takeoverMessage))).toEqual([]);

    await expect(phone.locator("#rollBtnInline")).toBeEnabled();
    const rollsBefore = phoneRoom.snapshot()._rolls_used;
    await phone.locator("#rollBtnInline").click();
    await expect.poll(() => phoneRoom.snapshot()?._rolls_used).toBeGreaterThan(rollsBefore);
    expect(phoneRoom.snapshot()._players[0].id).toBe(game.playerId);
    expect(phoneRoom.snapshot()._players_joined).toBe(2);
    expect(phoneRoom.errors).toEqual([]);
    expect(opponentRoom.errors).toEqual([]);
  } finally {
    await phoneContext.close();
    await tabletContext.close();
    await opponentContext.close();
  }
});
