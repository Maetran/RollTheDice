const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });

async function recordDice(page) {
  await page.evaluate(() => {
    window.__diceFrames = [];
    window.__diceRecording = true;
    const frame = () => {
      if (!window.__diceRecording) return;
      window.__diceFrames.push({
        time: performance.now(),
        shaking: [...document.querySelectorAll("#diceBar .die.shaking")].map(die => Number(die.dataset.i)),
        faces: [...document.querySelectorAll("#diceBar .die")].map(die => die.querySelectorAll("circle").length),
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

const frames = page => page.evaluate(() => window.__diceFrames || []);
async function expectRolled(page, indices = [0, 1, 2, 3, 4]) {
  await expect.poll(async () => (await frames(page)).some(frame => JSON.stringify(frame.shaking) === JSON.stringify(indices))).toBe(true);
  await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
}
const faces = page => page.locator("#diceBar .die").evaluateAll(dice => dice.map(die => die.querySelectorAll("circle").length));

function state() {
  return {
    _name: "Remote dice regression", _mode: "2", _hardcore: false,
    _players: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Ben" }],
    _players_joined: 2, _expected: 2, _started: true, _finished: false,
    _aborted: false, _paused: false, _manual_pause: false, _offline_players: [],
    _connected: { p1: true, p2: true }, _turn: { player_id: "p2", roll_index: 1 },
    _dice: [2, 2, 2, 2, 2], _holds: [true, false, true, false, true],
    _rolls_used: 1, _rolls_max: 3, _scoreboards: { p1: {}, p2: {} },
    _admin_edits: {}, _superadmin_active: false, _announced_row4: null,
    _announced_by: null, _announced_board: null, _correction: { active: false },
    _teams: [], _scoreboards_by_team: {}, _results: null, _last_write_public: {},
    _has_last: { p1: false, p2: false }, _auto_single: false, _chat_history: [], suggestions: [],
  };
}

async function fixture(page, { theme = "classic", initial = state() } = {}) {
  await page.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
  let current = structuredClone(initial);
  let socket;
  let connections = 0;
  const actions = [];
  await page.routeWebSocket(/\/ws\/opponent-dice-fixture$/, connected => {
    socket = connected;
    connections += 1;
    connected.onMessage(raw => {
      const message = JSON.parse(String(raw));
      actions.push(message);
      if (["join_game", "rejoin_game"].includes(message.action)) {
        connected.send(JSON.stringify({ player_id: "p1", resume_token: "dice-regression" }));
        connected.send(JSON.stringify({ scoreboard: current }));
      }
    });
  });
  await page.goto("/spiel/opponent-dice-fixture?name=Anna", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  return {
    actions,
    get connections() { return connections; },
    push(next, event) {
      current = structuredClone(next);
      socket.send(JSON.stringify({ scoreboard: current, ...(event ? { roll_event: event } : {}) }));
    },
    reconnect() { return socket.close({ code: 1012, reason: "Regression reconnect" }); },
  };
}

test("two players and a spectator see real rolls while held dice stay still", async ({ browser, request, baseURL }, testInfo) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({
    baseURL, serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  })));
  for (const context of contexts) await context.addInitScript(() => localStorage.setItem("wuerfler_theme", "classic"));
  const [first, second, spectator] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    const response = await request.post("/api/games", { data: { name: "Real shared dice animation", mode: 2 } });
    expect(response.ok()).toBeTruthy();
    const gameId = (await response.json()).game_id;
    await first.goto(`/spiel/${gameId}?name=Anna`, { waitUntil: "domcontentloaded" });
    await expect(first.locator(".player-card.me")).toBeVisible();
    await second.goto(`/spiel/${gameId}?name=Ben`, { waitUntil: "domcontentloaded" });
    await expect(second.locator(".player-card.me")).toBeVisible();
    await spectator.goto(`/spiel/${gameId}/zuschauen?name=Observer`, { waitUntil: "domcontentloaded" });
    await expect(spectator.locator("#diceBar .die")).toHaveCount(5);
    await expect(first.locator("#rollBtnInline")).toBeEnabled();
    await Promise.all([first, second, spectator].map(recordDice));
    await first.locator("#rollBtnInline").click();
    await Promise.all([first, second, spectator].map(page => expectRolled(page)));
    const result = await faces(first);
    expect(await faces(second)).toEqual(result);
    expect(await faces(spectator)).toEqual(result);
    await first.locator('#diceBar .die[data-i="0"]').click();
    for (const page of [first, second, spectator]) await expect(page.locator('#diceBar .die[data-i="0"]')).toHaveClass(/held/);
    await Promise.all([first, second, spectator].map(recordDice));
    await expect(first.locator("#rollBtnInline")).toBeEnabled();
    await first.locator("#rollBtnInline").click();
    await Promise.all([first, second, spectator].map(page => expectRolled(page, [1, 2, 3, 4])));
    for (const page of [first, second, spectator]) {
      const samples = await frames(page);
      expect(samples.every(frame => !frame.shaking.includes(0) && frame.faces[0] === result[0])).toBe(true);
    }
    expect(await faces(second)).toEqual(await faces(first));
    expect(await faces(spectator)).toEqual(await faces(first));
    await spectator.reload({ waitUntil: "domcontentloaded" });
    await expect(spectator.locator("#diceBar .die")).toHaveCount(5);
    await recordDice(spectator);
    await spectator.waitForTimeout(700); // Exceeds a full roll animation after hydration.
    expect((await frames(spectator)).every(frame => frame.shaking.length === 0)).toBe(true);
    await testInfo.attach("opponent-dice-mobile.png", { body: await second.screenshot(), contentType: "image/png" });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

for (const theme of ["classic", "light", "dark"]) {
  test(`${theme}: equal end faces still animate, holds and reconnects do not`, async ({ page }) => {
    const initial = state();
    const server = await fixture(page, { theme, initial });
    const rolled = { ...initial, _rolls_used: 2, _turn: { player_id: "p2", roll_index: 2 } };
    const event = { player_id: "p2", dice_indices: [1, 3] };
    await recordDice(page);
    server.push(rolled, event);
    await expectRolled(page, [1, 3]);
    const samples = await frames(page);
    expect(samples.some(frame => frame.faces[1] !== 2 || frame.faces[3] !== 2)).toBe(true);
    expect(samples.every(frame => [0, 2, 4].every(index => frame.faces[index] === 2))).toBe(true);
    expect(await faces(page)).toEqual([2, 2, 2, 2, 2]);
    await recordDice(page);
    server.push(rolled, event); // Duplicate event cannot restart the same accepted roll.
    server.push({ ...rolled, _holds: [false, false, false, false, false] });
    await server.reconnect();
    await expect.poll(() => server.connections).toBe(2);
    await expect(page.locator("#connectionStatus")).toContainText("Verbunden");
    await page.waitForTimeout(700);
    expect((await frames(page)).every(frame => frame.shaking.length === 0)).toBe(true);
  });
}

test("a quick write and turn change cancel the opponent animation without blocking the next turn", async ({ page }) => {
  const initial = state();
  const server = await fixture(page, { initial });
  server.push({ ...initial, _rolls_used: 2 }, { player_id: "p2", dice_indices: [1, 3] });
  await expect(page.locator("#diceBar .die.shaking")).toHaveCount(2);
  server.push({
    ...initial, _turn: { player_id: "p1", roll_index: 0 }, _rolls_used: 0, _dice: [0, 0, 0, 0, 0],
    _holds: [false, false, false, false, false], _scoreboards: { p1: {}, p2: { "1,free": 10 } },
  });
  await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
  await expect(page.locator("#rollBtnInline")).toBeEnabled();
  expect(await faces(page)).toEqual([0, 0, 0, 0, 0]);
  await page.waitForTimeout(700);
  expect(await faces(page)).toEqual([0, 0, 0, 0, 0]);
});

test("the accepted local roll does not restart its already running animation", async ({ page }) => {
  const initial = { ...state(), _turn: { player_id: "p1", roll_index: 0 }, _rolls_used: 0, _holds: [false, false, false, false, false] };
  const server = await fixture(page, { initial });
  await page.locator("#rollBtnInline").click();
  await expect(page.locator("#diceBar .die.shaking")).toHaveCount(5);
  await expect.poll(() => server.actions.some(action => action.action === "roll_dice")).toBe(true);
  // Simulate a slow server response near the end of the immediate local
  // animation. A duplicate start would keep shaking for another full 600 ms.
  await page.waitForTimeout(300);
  server.push({ ...initial, _rolls_used: 1, _dice: [1, 2, 3, 4, 5] }, { player_id: "p1", dice_indices: [0, 1, 2, 3, 4] });
  await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0, { timeout: 350 });
  expect(await faces(page)).toEqual([1, 2, 3, 4, 5]);
});

test("unchanged avatars stay decoded through hold, roll and score updates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let ownAvatarRequests = 0;
  await page.route(/\/api\/avatars\/(701|702)(?:\?.*)?$/, async route => {
    const userId = new URL(route.request().url()).pathname.split("/").pop();
    if (userId === "701") ownAvatarRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      headers: { "Cache-Control": "no-store" },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="${userId === "701" ? "#d23" : "#27c"}"/></svg>`,
    });
  });
  await page.addInitScript(() => {
    window.__trackedAvatarLoads = 0;
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement
        && event.target.matches('img.player-avatar[data-user-avatar="701"][data-avatar-key]')) {
        window.__trackedAvatarLoads += 1;
      }
    }, true);
  });

  const initial = {
    ...state(),
    _players: [
      { id: "p1", user_id: 701, name: "Anna", is_admin: true },
      { id: "p2", user_id: 702, name: "Ben" },
    ],
    _turn: { player_id: "p1", roll_index: 1 },
    _dice: [1, 2, 3, 4, 5],
    _holds: [false, false, false, false, false],
    _rolls_used: 1,
  };
  const server = await fixture(page, { initial });
  await expect(page.locator("#headerTurnStatus .player-admin-badge")).toHaveCount(1);
  await expect(page.locator(".player-card.me .pc-head .player-admin-badge")).toHaveCount(1);
  const selectors = [
    "#headerTurnStatus img.player-avatar",
    ".turn-status-text img.player-avatar",
    ".player-card.me .pc-head img.player-avatar",
  ];
  await expect.poll(() => page.evaluate(items => items.every((selector, index) => {
    const image = document.querySelector(selector);
    return image instanceof HTMLImageElement
      && (index === 1 || (image.complete && image.naturalWidth > 0));
  }), selectors)).toBe(true);
  await page.evaluate(items => {
    window.__stableAvatarNodes = items.map(selector => document.querySelector(selector));
    window.__stableAvatarSources = window.__stableAvatarNodes.map(image => image.currentSrc);
  }, selectors);
  const initialLoads = await page.evaluate(() => window.__trackedAvatarLoads);
  const initialRequests = ownAvatarRequests;
  expect(initialLoads).toBeGreaterThanOrEqual(2);
  expect(initialRequests).toBeGreaterThan(0);

  const expectStableAvatars = async () => {
    await expect.poll(() => page.evaluate(items => {
      const current = items.map(selector => document.querySelector(selector));
      return current.every((image, index) => image === window.__stableAvatarNodes[index]
        && image.isConnected
        && (index === 1 || (image.complete && image.naturalWidth > 0))
        && image.currentSrc === window.__stableAvatarSources[index]);
    }, selectors)).toBe(true);
    expect(await page.evaluate(() => window.__trackedAvatarLoads)).toBe(initialLoads);
    expect(ownAvatarRequests).toBe(initialRequests);
  };

  await page.locator('#diceBar .die[data-i="0"]').click();
  await expect.poll(() => server.actions.filter(action => action.action === "set_hold").length).toBe(1);
  const held = { ...initial, _holds: [true, false, false, false, false] };
  server.push(held);
  await expect(page.locator('#diceBar .die[data-i="0"]')).toHaveClass(/held/);
  await expectStableAvatars();

  await page.locator('#diceBar .die[data-i="0"]').click();
  await expect.poll(() => server.actions.filter(action => action.action === "set_hold").length).toBe(2);
  const released = { ...held, _holds: [false, false, false, false, false] };
  server.push(released);
  await expect(page.locator('#diceBar .die[data-i="0"]')).not.toHaveClass(/held/);
  await expectStableAvatars();

  await page.locator("#rollBtnInline").click();
  await expect.poll(() => server.actions.filter(action => action.action === "roll_dice").length).toBe(1);
  const rolled = {
    ...released,
    _turn: { player_id: "p1", roll_index: 2 },
    _dice: [1, 1, 2, 3, 4],
    _rolls_used: 2,
  };
  server.push(rolled, { player_id: "p1", dice_indices: [0, 1, 2, 3, 4] });
  await expect.poll(() => faces(page)).toEqual([1, 1, 2, 3, 4]);
  await expectStableAvatars();

  await page.locator('.player-card.me td.cell[data-row="0"][data-field="free"]').click();
  await expect.poll(() => server.actions.filter(action => action.action === "write_field").length).toBe(1);
  const written = {
    ...rolled,
    _scoreboards: { ...rolled._scoreboards, p1: { "0,free": 2 } },
  };
  server.push(written);
  await expect(page.locator('.player-card.me td.cell[data-row="0"][data-field="free"]')).toHaveText("2");
  await expectStableAvatars();
});

test("reduced motion reveals opponent results directly without random face cycling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const initial = state();
  const server = await fixture(page, { initial });
  await recordDice(page);
  server.push({ ...initial, _rolls_used: 2, _dice: [2, 4, 2, 6, 2] }, { player_id: "p2", dice_indices: [1, 3] });
  await expect.poll(() => faces(page)).toEqual([2, 4, 2, 6, 2]);
  await page.waitForTimeout(700);
  expect((await frames(page)).every(frame => frame.shaking.length === 0)).toBe(true);
  expect((await frames(page)).every(frame => [[2, 2, 2, 2, 2].join(), [2, 4, 2, 6, 2].join()].includes(frame.faces.join()))).toBe(true);
});
