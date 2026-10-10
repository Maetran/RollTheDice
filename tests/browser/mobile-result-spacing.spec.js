const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { expectReachable } = require("./table-viewport");

async function expectDialogSpacing(page, safeBottom) {
  for (const action of await page.locator("#appDialogActions > button").all()) {
    const selector = `[data-dialog-action="${await action.getAttribute("data-dialog-action")}"]`;
    await expectReachable(page, selector);
  }
  const spacing = await page.locator("#appDialog").evaluate(dialog => {
    const bottom = Math.max(...Array.from(dialog.querySelectorAll(".app-dialog-actions > button"), button => button.getBoundingClientRect().bottom));
    return {
      inside:dialog.getBoundingClientRect().bottom - bottom,
      screen:innerHeight - bottom,
      overflow:dialog.scrollHeight - dialog.clientHeight,
    };
  });
  expect(spacing.inside, "the result actions have padding below them inside the dialog").toBeGreaterThanOrEqual(32 + safeBottom);
  expect(spacing.screen, "the result actions clear rounded screen corners and the home indicator").toBeGreaterThanOrEqual(40 + safeBottom);
  expect(spacing.overflow).toBeLessThanOrEqual(1);
}

for (const [language, theme, action] of [["de", "light", "lobby"], ["en", "classic", "new"]]) {
  test(`ZDWA mobile final result keeps both actions safely above the bottom (${language}, ${theme})`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
    await context.addInitScript(({ language, theme }) => {
      localStorage.setItem("zdwa_language", language);
      localStorage.setItem("wuerfler_theme", theme);
    }, { language, theme });
    const page = await context.newPage();
    const created = [];
    try {
      const auth = { authenticated:false, user:null, game_access:{ zilch_public:true } };
      await page.route("**/api/auth/me", route => route.fulfill({ json:auth }));
      await page.route("**/api/games", async route => {
        created.push(route.request().postDataJSON());
        await route.fulfill({ json:{ game_id:"next-mobile-result" } });
      });
      await page.route("**/spiel/next-mobile-result", route => route.fulfill({ contentType:"text/html", body:'<main id="nextRound">Next round</main>' }));
      await page.route(/\/$/, route => route.fulfill({ contentType:"text/html", body:'<main id="resultLobby">Lobby</main>' }));
      await page.routeWebSocket(/\/ws\/mobile-result-fixture$/, socket => {
        socket.onMessage(raw => {
          const message = JSON.parse(String(raw));
          if (!["join_game", "rejoin_game"].includes(message.action)) return;
          socket.send(JSON.stringify({ player_id:"p1", resume_token:"mobile-result", auth }));
          socket.send(JSON.stringify({ scoreboard:{
            _name:"Mobile final result", _mode:"2", _hardcore:false,
            _players:[{ id:"p1", name:"Anna" }, { id:"p2", name:"Ben" }],
            _players_joined:2, _expected:2, _started:false, _finished:true, _aborted:false,
            _paused:false, _connected:{ p1:true, p2:true }, _offline_players:[],
            _turn:null, _dice:[0, 0, 0, 0, 0], _holds:[false, false, false, false, false],
            _rolls_used:0, _scoreboards:{ p1:{}, p2:{} }, _teams:[], _scoreboards_by_team:{},
            _correction:{ active:false }, _announced_row4:null, _announced_by:null, _announced_board:null,
            _admin_edits:{}, _superadmin_active:false, _has_last:{}, _last_write_public:{},
            _chat_history:[], suggestions:[], _finalization_pending:false,
            _results:[{ player:"Anna", total:1234 }, { player:"Ben", total:999 }],
          }, finalization_pending:false }));
        });
      });
      await page.goto("/spiel/mobile-result-fixture?name=Anna");
      await expect(page.locator("#appDialog")).toHaveAttribute("data-kind", "success");
      await expect(page.locator("#appDialog")).toContainText("Anna");
      for (const inset of [0, 34]) {
        await page.evaluate(value => document.body.style.setProperty("--room-safe-bottom", `${value}px`), inset);
        await expectDialogSpacing(page, inset);
        await page.screenshot({ path:testInfo.outputPath(`zdwa-result-${language}-inset-${inset}.png`) });
      }
      await page.locator(`[data-dialog-action="${action}"]`).tap();
      await expect(page.locator(action === "new" ? "#nextRound" : "#resultLobby")).toBeVisible();
      expect(created).toHaveLength(action === "new" ? 1 : 0);
      if (action === "new") expect(created[0]).toMatchObject({ name:"Mobile final result", mode:"2" });
    } finally { await context.close(); }
  });
}

function zilchTerminal(status) {
  return {
    _game_type:"zilch", _name:"Mobile solo result", _mode:"1", _play_mode:"solo",
    _players:[{ id:"p1", name:"Anna", type:"human", user_id:null, connected:true }],
    _participants:[{ id:"p1", name:"Anna", type:"human", user_id:null, connection_player_id:"p1" }],
    _players_joined:1, _expected:1, _started:true, _finished:true, _aborted:false,
    _paused:false, _offline_players:[], _gameplay_status:"finished", _target_score:10000,
    _zilch_ruleset:"zilch-house-v1", _turn:null, _dice:[0, 0, 0, 0, 0, 0],
    _zilch_turn_state:null, _zilch_start_roll:null, _zilch_final_round:null,
    _zilch_quick_holds:[], _chat_history:[], _finalization_pending:false,
    _zilch_outcome:{ status, winner_ids:[], tied:false },
    _zilch_boards:{ p1:{ player_id:"p1", total_points:status === "completed" ? 10000 : 1800, round_points:0, zilch_streak:0, rounds:[] } },
    _total_points:{ p1:status === "completed" ? 10000 : 1800 }, _round_points:{ p1:0 },
  };
}

for (const [language, theme, status] of [["de", "light", "completed"], ["en", "lcars", "abandoned"]]) {
  test(`Zilch mobile result and feedback dialog keep their actions reachable (${language}, ${theme}, ${status})`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
    await context.addInitScript(({ language, theme }) => {
      localStorage.setItem("zdwa_language", language);
      localStorage.setItem("zilch_theme", theme);
    }, { language, theme });
    const page = await context.newPage();
    const created = [];
    try {
      const shell = await readFile(path.join(__dirname, "../../app/static/zilch.html"), "utf8");
      const terminal = zilchTerminal(status);
      await page.route("**/api/**", route => route.fulfill({ json:{} }));
      await page.route("**/api/auth/me", route => route.fulfill({ json:{ authenticated:false, user:null, game_access:{ zilch_public:true } } }));
      await page.route("**/api/games/mobile-zilch-result", route => route.fulfill({ json:{
        exists:true, game_type:"zilch", name:"Mobile solo result", mode:"1", play_mode:"solo",
        locked:false, participants:terminal._participants, player_statuses:terminal._players,
      } }));
      await page.route("**/api/games", async route => {
        created.push(route.request().postDataJSON());
        await route.fulfill({ json:{ game_id:"next-mobile-zilch-result" } });
      });
      await page.route("**/zilch/spiel/mobile-zilch-result", route => route.fulfill({ contentType:"text/html", body:shell }));
      await page.route("**/zilch/spiel/next-mobile-zilch-result", route => route.fulfill({ contentType:"text/html", body:'<main id="nextSolo">Next solo</main>' }));
      await page.routeWebSocket(/\/ws\/mobile-zilch-result$/, socket => {
        socket.onMessage(raw => {
          const message = JSON.parse(String(raw));
          if (["join_game", "rejoin_game"].includes(message.action)) socket.send(JSON.stringify({ player_id:"p1", scoreboard:terminal }));
        });
      });
      await page.goto("/zilch/spiel/mobile-zilch-result");
      await expect(page.locator(".zilch-result-summary")).toBeVisible();
      await expect(page.locator(".zilch-shell--game")).toHaveCount(0);
      for (const inset of [0, 34]) {
        await page.evaluate(value => document.documentElement.style.setProperty("--zilch-room-safe-bottom", `${value}px`), inset);
        for (const selector of [".zilch-result-actions__new-round", ".zilch-result-actions__lobby"]) {
          await expectReachable(page, selector);
          const bottomGap = await page.locator(selector).evaluate(button => innerHeight - button.getBoundingClientRect().bottom);
          expect(bottomGap, "report actions stay above the rounded edge and home indicator").toBeGreaterThanOrEqual(40 + inset);
        }
        await page.evaluate(() => { void window.ZDWA_UI.confirm({ title:"Spiel beendet", message:"Solo-Ziel erreicht", confirmLabel:"OK" }); });
        await expect(page.locator("#appDialog")).toBeVisible();
        await expectDialogSpacing(page, inset);
        await page.screenshot({ path:testInfo.outputPath(`zilch-result-${theme}-inset-${inset}.png`) });
        await page.locator('[data-dialog-action="cancel"]').tap();
      }
      await page.locator(".zilch-result-actions__new-round").tap();
      await expect(page.locator("#nextSolo")).toBeVisible();
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ game_type:"zilch", play_mode:"solo", mode:"1" });
    } finally { await context.close(); }
  });
}
