const { test, expect } = require("@playwright/test");
const { expectReachable } = require("./table-viewport");

const ROWS = [0, 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15];
const COLS = ["down", "free", "up", "ang"];

function boardWithOpenCells(...cells) {
  const board = Object.fromEntries(ROWS.flatMap(row => COLS.map(col => [`${row},${col}`, 0])));
  for (const [row, col] of cells) delete board[`${row},${col}`];
  return board;
}

function snapshot(board, overrides = {}) {
  return {
    _name:"Forced scratch fixture", _mode:"2", _hardcore:false,
    _players:[{ id:"p1", name:"Anna" }, { id:"p2", name:"Ben" }],
    _players_joined:2, _expected:2, _started:true, _finished:false, _aborted:false,
    _paused:false, _manual_pause:false, _offline_players:[], _connected:{ p1:true, p2:true },
    _turn:{ player_id:"p1", roll_index:2, first4oak_roll:null },
    _dice:[2, 2, 4, 5, 6], _holds:[false, false, false, false, false],
    _rolls_used:2, _rolls_max:3, _scoreboards:{ p1:board, p2:{} },
    _admin_edits:{}, _superadmin_active:false, _announced_row4:null,
    _announced_by:null, _announced_board:null, _correction:{ active:false },
    _teams:[], _scoreboards_by_team:{}, _results:null, _last_write_public:{},
    _has_last:{}, _auto_single:false, _chat_history:[], suggestions:[],
    ...overrides,
  };
}

async function fixture(page, initial, { language = "de", preferences = {}, guest = false } = {}) {
  const actions = [];
  await page.addInitScript(lang => localStorage.setItem("zdwa_language", lang), language);
  const auth = {
    authenticated:!guest,
    user:guest ? null : { id:42, username:"Anna", is_admin:false, preferences:{ preferred_language:language, auto_write_announced:false, ...preferences } },
    game_access:{ zilch_preview:false, zilch_public:false },
  };
  await page.route("**/api/auth/me", route => route.fulfill({ json:auth }));
  await page.routeWebSocket(/\/ws\/forced-scratch-fixture$/, socket => {
    socket.onMessage(raw => {
      const action = JSON.parse(String(raw));
      actions.push(action);
      if (["join_game", "rejoin_game"].includes(action.action)) {
        socket.send(JSON.stringify({ player_id:"p1", resume_token:"forced-scratch-fixture", auth }));
        socket.send(JSON.stringify({ scoreboard:initial }));
      }
    });
  });
  await page.goto("/spiel/forced-scratch-fixture?name=Anna");
  await expect(page.locator(".player-card.me")).toBeVisible();
  return actions;
}

function cell(page, row, col) {
  return page.locator(`.player-card.me td.cell[data-row="${row}"][data-field="${col}"]`);
}

function writes(actions) {
  return actions.filter(action => action.action.startsWith("write_field"));
}

async function expectDirectWrite(page, actions, row, field, extra = {}) {
  await cell(page, row, field).click();
  await expect.poll(() => writes(actions)).toEqual([{ action:"write_field", row, field, ...extra }]);
  await expect(page.locator("#appDialog")).toBeHidden();
}

for (const [language, viewport] of [
  ["de", { width:390, height:844 }],
  ["en", { width:768, height:1024 }],
  ["de", { width:1440, height:900 }],
]) {
  test(`only the last field skips the scratch prompt by default (${language}, ${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const actions = await fixture(page, snapshot(boardWithOpenCells([13, "free"])), { language });
    await expectDirectWrite(page, actions, 13, "free");
  });
}

test("guest players also skip the prompt for their only legal field", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([13, "free"])), { guest:true });
  await expectDirectWrite(page, actions, 13, "free");
});

test("the final field can finish a stalled turn without rolling or confirming", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([13, "ang"]), {
    _dice:[0, 0, 0, 0, 0], _rolls_used:0, _turn:{ player_id:"p1", roll_index:0 },
  }));
  await expectDirectWrite(page, actions, 13, "ang");
});

for (const [column, openRows, target] of [["down", [13, 14, 15], 13], ["up", [0, 1, 2], 2]]) {
  test(`${column} order skips the prompt with several open fields but only one legal target`, async ({ page }) => {
    const actions = await fixture(page, snapshot(boardWithOpenCells(...openRows.map(row => [row, column]))));
    await expectDirectWrite(page, actions, target, column);
  });
}

test("an active announcement restricts scratch choices to the announced field", async ({ page }) => {
  const actions = await fixture(page, snapshot({}, {
    _announced_row4:"full", _announced_by:"p1", _announced_board:"p1",
  }));
  await expectDirectWrite(page, actions, 13, "ang");
});

test("unannounced cells after the first roll do not count as legal alternatives", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([13, "down"], [13, "ang"], [14, "ang"])));
  await expectDirectWrite(page, actions, 13, "down");
});

test("team mode counts the shared team sheet instead of the player's individual sheet", async ({ page }) => {
  const initial = snapshot({}, {
    _mode:"2v2", _players_joined:4, _expected:4,
    _players:["Anna", "Ben", "Clara", "David"].map((name, index) => ({ id:`p${index + 1}`, name })),
    _teams:[{ id:"A", name:"Anna und Clara", members:["p1", "p3"] }, { id:"B", name:"Ben und David", members:["p2", "p4"] }],
    _scoreboards_by_team:{ A:boardWithOpenCells([13, "free"]), B:{} },
  });
  const actions = await fixture(page, initial);
  await expectDirectWrite(page, actions, 13, "free");
});

test("another legal column keeps the prompt and cancellation preserves the choice", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([13, "down"], [14, "down"], [15, "down"], [13, "free"])));
  await cell(page, 13, "down").click();
  await expect(page.locator("#appDialogTitle")).toHaveText("Feld streichen?");
  expect(writes(actions)).toEqual([]);
  await page.locator('[data-dialog-action="cancel"]').click();
  expect(writes(actions)).toEqual([]);
  await cell(page, 13, "free").click();
  await expect(page.locator("#appDialogTitle")).toHaveText("Feld streichen?");
  await page.locator('[data-dialog-action="confirm"]').click();
  await expect.poll(() => writes(actions)).toEqual([{ action:"write_field", row:13, field:"free" }]);
});

test("a legal field with points also counts as an alternative to scratching", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([13, "free"], [9, "free"])));
  await cell(page, 13, "free").click();
  await expect(page.locator("#appDialogTitle")).toHaveText("Feld streichen?");
  expect(writes(actions)).toEqual([]);
});

test("turning off the setting restores confirmation even for the last field", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([13, "free"])), {
    language:"en", preferences:{ skip_forced_strike_confirmation:false },
  });
  await cell(page, 13, "free").click();
  await expect(page.locator("#appDialogTitle")).toHaveText("Strike field?");
  expect(writes(actions)).toEqual([]);
  await page.locator('[data-dialog-action="confirm"]').click();
  await expect.poll(() => writes(actions)).toEqual([{ action:"write_field", row:13, field:"free" }]);
});

test("a zero-point Poker in the only remaining field skips the generic prompt", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([14, "free"])));
  await expectDirectWrite(page, actions, 14, "free");
});

for (const onlyChoice of [true, false]) {
  test(`Poker after gambling ${onlyChoice ? "skips" : "keeps"} the specific strike confirmation`, async ({ page }) => {
    const board = onlyChoice ? boardWithOpenCells([14, "free"]) : boardWithOpenCells([14, "free"], [13, "free"]);
    const initial = snapshot(board, { _dice:[2, 2, 2, 2, 6], _turn:{ player_id:"p1", roll_index:2, first4oak_roll:1 } });
    const actions = await fixture(page, initial);
    if (onlyChoice) {
      await expectDirectWrite(page, actions, 14, "free", { strike:true });
    } else {
      await cell(page, 14, "free").click();
      await expect(page.locator("#appDialogTitle")).toHaveText("Poker streichen?");
      expect(writes(actions)).toEqual([]);
      await page.locator('[data-dialog-action="confirm"]').click();
      await expect.poll(() => writes(actions)).toEqual([{ action:"write_field", row:14, field:"free", strike:true }]);
    }
  });
}

test("correction mode still confirms a zero-point replacement", async ({ page }) => {
  const actions = await fixture(page, snapshot(boardWithOpenCells([13, "free"]), {
    _turn:{ player_id:"p2", roll_index:0 }, _rolls_used:0,
    _correction:{ active:true, player_id:"p1", dice:[2, 2, 4, 5, 6], roll_index:2, first4oak_roll:null },
  }));
  await cell(page, 13, "free").click();
  await expect(page.locator("#appDialogTitle")).toHaveText("Feld streichen?");
  expect(writes(actions)).toEqual([]);
  await page.locator('[data-dialog-action="confirm"]').click();
  await expect.poll(() => writes(actions)).toEqual([{ action:"write_field_correction", row:13, field:"free" }]);
});

for (const [language, theme, viewport] of [
  ["de", "light", { width:390, height:844 }],
  ["en", "dark", { width:430, height:932 }],
  ["de", "classic", { width:360, height:640 }],
]) {
  test(`mobile strike dialogs keep actions clear of rounded screen corners (${language}, ${theme})`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile:true, hasTouch:true, serviceWorkers:"block" });
    await context.addInitScript(design => localStorage.setItem("wuerfler_theme", design), theme);
    const page = await context.newPage();
    try {
      const actions = await fixture(page, snapshot(boardWithOpenCells([13, "free"], [14, "free"]), {
        _dice:[2, 2, 2, 2, 6], _turn:{ player_id:"p1", roll_index:2, first4oak_roll:1 },
      }), { language });
      for (const safeBottom of [0, 34]) {
        await page.evaluate(inset => document.body.style.setProperty("--room-safe-bottom", `${inset}px`), safeBottom);
        for (const row of [13, 14]) {
          await cell(page, row, "free").tap();
          await expect(page.locator("#appDialogTitle")).toHaveText(row === 14
            ? language === "en" ? "Strike poker?" : "Poker streichen?"
            : language === "en" ? "Strike field?" : "Feld streichen?");
          for (const action of ["cancel", "confirm"]) await expectReachable(page, `[data-dialog-action="${action}"]`);
          const spacing = await page.locator("#appDialog").evaluate(dialog => {
            const box = dialog.getBoundingClientRect();
            const buttons = Array.from(dialog.querySelectorAll(".app-dialog-actions > button"), button => button.getBoundingClientRect());
            const bottom = Math.max(...buttons.map(button => button.bottom));
            return {
              innerBottom:box.bottom - bottom,
              screenBottom:innerHeight - bottom,
              contentOverflow:dialog.scrollHeight - dialog.clientHeight,
            };
          });
          expect(spacing.innerBottom, "space inside the dialog below its action buttons").toBeGreaterThanOrEqual(32 + safeBottom);
          expect(spacing.screenBottom, "buttons clear the rounded screen edge and home indicator").toBeGreaterThanOrEqual(40 + safeBottom);
          expect(spacing.contentOverflow, "the complete strike message and buttons fit on the phone").toBeLessThanOrEqual(1);
          await page.screenshot({ path:testInfo.outputPath(`strike-${row}-${viewport.width}px-inset-${safeBottom}.png`) });
          await page.locator('[data-dialog-action="cancel"]').tap();
          await expect(page.locator("#appDialog")).toBeHidden();
          expect(writes(actions)).toEqual([]);
        }
      }
      await cell(page, 14, "free").tap();
      await page.locator('[data-dialog-action="confirm"]').tap();
      await expect.poll(() => writes(actions)).toEqual([{ action:"write_field", row:14, field:"free", strike:true }]);
    } finally { await context.close(); }
  });
}
