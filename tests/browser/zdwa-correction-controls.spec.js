const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

function correctionSnapshot() {
  return {
    _name: "Korrekturfläche", _hardcore: false,
    _players: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Ben" }],
    _players_joined: 2, _expected: 2, _started: true, _finished: false,
    _aborted: false, _paused: false, _offline_players: [],
    _connected: { p1: true, p2: true },
    _turn: { player_id: "p2", roll_index: 0 },
    _dice: [0, 0, 0, 0, 0], _holds: [false, false, false, false, false],
    _rolls_used: 0, _rolls_max: 3,
    _scoreboards: { p1: { "0,free": 3 }, p2: {} },
    _admin_edits: {}, _superadmin_active: false,
    _announced_row4: null, _announced_by: null, _announced_board: null,
    _correction: { active: false }, _mode: "2", _teams: [],
    _scoreboards_by_team: {}, _results: null,
    _last_write_public: { p1: [0, "free", 1] },
    _has_last: { p1: true, p2: false },
    _can_request_correction: { p1: true, p2: false },
    _auto_single: false, _chat_history: [], suggestions: [],
  };
}

async function fixture(page, { initial = correctionSnapshot(), theme = "classic", language = "de", spectator = false } = {}) {
  await page.addInitScript(({ theme, language }) => {
    localStorage.setItem("wuerfler_theme", theme);
    localStorage.setItem("zdwa_language", language);
  }, { theme, language });
  let socket;
  let current = structuredClone(initial);
  const actions = [];
  await page.routeWebSocket(/\/ws\/correction-controls-fixture$/, route => {
    socket = route;
    route.onMessage(raw => {
      const message = JSON.parse(String(raw));
      actions.push(message);
      if (["join_game", "rejoin_game", "spectate_game"].includes(message.action)) {
        route.send(JSON.stringify(spectator ? { spectator_id: "s1" } : { player_id: "p1", resume_token: "correction-fixture" }));
        route.send(JSON.stringify({ scoreboard: current }));
      }
    });
  });
  await page.goto(`/spiel/correction-controls-fixture?name=Anna${spectator ? "&spectator=1" : ""}`);
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  return {
    actions,
    push(next) {
      current = structuredClone(next);
      socket.send(JSON.stringify({ scoreboard: current }));
    },
  };
}

async function dockGeometry(page) {
  return page.evaluate(() => {
    const box = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return { dock: box(document.querySelector(".topbar")), roll: box(document.querySelector("#rollBtnInline")) };
  });
}

for (const theme of ["classic", "light", "dark"]) {
  for (const width of [320, 390]) {
    test(`${theme} ${width}px uses one stable touch row for eraser and announcement`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      const state = correctionSnapshot();
      const room = await fixture(page, { theme, initial: state });
      const correction = page.locator("#requestCorrectionBtn");
      await expect(correction).toBeEnabled();
      await expect(correction).toHaveAccessibleName("Letzten Eintrag ändern");
      await expect(correction).toHaveAttribute("title", "Letzten Eintrag ändern");
      await expect(correction).toHaveAttribute("aria-keyshortcuts", "k");
      await expect(correction.locator("svg")).toBeVisible();
      await expect(correction).toHaveText("");
      await expect(page.locator("#announceBtnInline")).toHaveCount(0);
      const before = await dockGeometry(page);
      const icon = await correction.boundingBox();
      expect(icon.width).toBeGreaterThanOrEqual(44);
      expect(icon.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(icon.y - before.roll.y)).toBeLessThan(1);
      expect(icon.x + icon.width).toBeLessThan(before.roll.x);
      expect(icon.height).toBeLessThanOrEqual(45);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (theme === "classic") {
        const path = `/tmp/rollthedice-correction-${width}-eraser.png`;
        await testInfo.attach(`eraser-${width}`, { body: await page.screenshot({ path }), contentType: "image/png" });
      }

      state._rolls_used = 1;
      state._turn.roll_index = 1;
      state._dice = [1, 2, 3, 4, 5];
      state._can_request_correction.p1 = false;
      room.push(state);
      await expect(correction).toHaveCount(0);
      await expect(page.locator("#announceBtnInline")).toBeVisible();
      await expect(page.locator("#announceBtnInline")).toBeDisabled();
      const after = await dockGeometry(page);
      expect(after.dock.height).toBeCloseTo(before.dock.height, 1);
      expect(after.roll).toEqual(before.roll);

      state._turn = { player_id: "p1", roll_index: 0 };
      state._rolls_used = 0;
      room.push(state);
      await expect(page.locator("#announceBtnInline")).toBeHidden();
      await expect(page.locator("#rollBtnInline")).toBeEnabled();
      expect((await dockGeometry(page)).roll).toEqual(before.roll);

      state._rolls_used = 1;
      state._turn.roll_index = 1;
      room.push(state);
      await expect(page.locator("#announceBtnInline")).toBeEnabled();
      if (theme === "classic") {
        const path = `/tmp/rollthedice-correction-${width}-announce.png`;
        await testInfo.attach(`announce-${width}`, { body: await page.screenshot({ path }), contentType: "image/png" });
      }
      await page.locator("#announceBtnInline").click();
      await expect(page.locator("#mobileAnnouncePicker")).toBeVisible();
      await page.locator('#mobileAnnouncePicker [data-field="full"]').click();
      expect(room.actions).toContainEqual({ action: "announce_row4", field: "full" });
    });
  }
}

test("correction respects exact server permission, teams and direct unannounced entries", async ({ page }) => {
  const state = correctionSnapshot();
  const room = await fixture(page, { initial: state, language: "en" });
  await expect(page.locator("#requestCorrectionBtn")).toHaveAccessibleName("Change last entry");
  await page.keyboard.press("k");
  expect(room.actions).toContainEqual({ action: "request_correction" });
  for (const patch of [
    { _can_request_correction: { p1: false } },
    { _paused: true },
    { _superadmin_active: true },
    { _correction: { active: true, player_id: "p1" } },
    { _expected: 1 },
    { _hardcore: true },
  ]) {
    room.push({ ...state, ...patch });
    await expect(page.locator("#requestCorrectionBtn")).toHaveCount(0);
  }
  // A direct first-roll entry in the ❗ column has not necessarily been
  // announced. The server permission wins over the previous cell's column.
  const direct = { ...state, _last_write_public: { p1: [13, "ang", 1] } };
  room.push(direct);
  await expect(page.locator("#requestCorrectionBtn")).toBeEnabled();
  delete direct._can_request_correction;
  room.push(direct);
  await expect(page.locator("#requestCorrectionBtn")).toBeEnabled();
  const team = {
    ...state, _mode: "2v2", _expected: 4, _players_joined: 4,
    _players: [...state._players, { id: "p3", name: "Cora" }, { id: "p4", name: "Dan" }],
    _teams: [{ id: "A", name: "Team A", members: ["p1", "p3"] }, { id: "B", name: "Team B", members: ["p2", "p4"] }],
    _scoreboards_by_team: { A: { "0,free": 3 }, B: {} },
  };
  room.push(team);
  await expect(page.locator(".player-card")).toHaveCount(2);
  await expect(page.locator("#requestCorrectionBtn")).toBeEnabled();
});

test("mandatory announcement remains reachable and spectators never get correction", async ({ page, context }) => {
  const state = correctionSnapshot();
  state._turn = { player_id: "p1", roll_index: 1 };
  state._rolls_used = 1;
  state._dice = [1, 2, 3, 4, 5];
  for (const column of ["down", "free", "up"]) {
    for (const row of [0, 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15]) state._scoreboards.p1[`${row},${column}`] = 0;
  }
  const room = await fixture(page, { initial: state });
  await expect(page.locator("#rollBtnInline")).toBeDisabled();
  await expect(page.locator("#announceBtnInline")).toBeEnabled();
  await expect(page.locator("#requestCorrectionBtn")).toHaveCount(0);
  await page.keyboard.press("a");
  await expect(page.locator("#mobileAnnouncePicker")).toBeVisible();
  await page.locator('#mobileAnnouncePicker [data-field="full"]').click();
  expect(room.actions).toContainEqual({ action: "announce_row4", field: "full" });
  const watcher = await context.newPage();
  await fixture(watcher, { spectator: true });
  await expect(watcher.locator("#requestCorrectionBtn")).toHaveCount(0);
  await expect(watcher.locator("#rollBtnInline")).toBeDisabled();
  await watcher.close();
});
