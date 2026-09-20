const { test, expect } = require("@playwright/test");
const { expectReachable } = require("./table-viewport");
const { openChatWithKeyboardFocus, expectChatAboveKeyboard, exerciseCollapsedChatDock } = require("./chat-mobile");

for (const theme of ["light", "dark", "classic"]) {
  test(`ZDWA ${theme}: iPhone spectator can type and send in a 2v2 chat`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, hasTouch:true, isMobile:true, viewport:{ width:440, height:956 }, serviceWorkers:"block" });
    await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
    const page = await context.newPage();
    const actions = [];
    let activeSocket;
    const players = ["Anna", "Ben", "Clara", "David"].map((name, index) => ({ id:`p${index + 1}`, name }));
    try {
      await page.route("**/api/avatars/4242", route => route.fulfill({
        status:200, contentType:"image/svg+xml",
        body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="purple"/></svg>',
      }));
      await page.routeWebSocket(/\/ws\/spectator-chat-mobile$/, socket => {
        activeSocket = socket;
        socket.onMessage(raw => {
          const message = JSON.parse(String(raw));
          actions.push(message);
          if (message.action === "spectate_game") {
            socket.send(JSON.stringify({ spectator_id:"observer" }));
            socket.send(JSON.stringify({ scoreboard:{
              _name:"Spectator chat", _mode:"2v2", _hardcore:false,
              _players:players, _players_joined:4, _expected:4, _started:true,
              _finished:false, _aborted:false, _paused:false, _manual_pause:false, _offline_players:[],
              _connected:Object.fromEntries(players.map(player => [player.id, true])),
              _turn:{ player_id:"p1", roll_index:1 }, _dice:[2, 2, 3, 4, 5], _holds:[false, false, false, false, false],
              _rolls_used:1, _rolls_max:3,
              _scoreboards:Object.fromEntries(players.map(player => [player.id, {}])),
              _admin_edits:{}, _superadmin_active:false, _announced_row4:null, _announced_by:null,
              _announced_board:null, _correction:{ active:false },
              _teams:[{ id:"A", name:"Anna und Clara", members:["p1", "p3"] }, { id:"B", name:"Ben und David", members:["p2", "p4"] }],
              _scoreboards_by_team:{ A:{}, B:{} },
              _results:null, _last_write_public:{}, _has_last:{}, _auto_single:false,
              _chat_history:Array.from({ length:30 }, (_, index) => ({ from_id:"S-departed", sender:"Observer", user_id:4242, text:`Nachricht ${index}`, ts:"2026-09-20T18:45:00Z", kind:"chat" })),
              suggestions:[],
            } }));
          }
          if (message.action === "chat_message") socket.send(JSON.stringify({ chat:{ from_id:"S-observer", sender:"Observer", user_id:4242, text:message.text, ts:"2026-09-20T18:50:00Z", kind:"chat" } }));
        });
      });
      await page.goto("/spiel/spectator-chat-mobile/zuschauen?name=Observer");
      await expect(page.locator(".player-card")).toHaveCount(2);
      expect(actions.some(action => ["join_game", "rejoin_game"].includes(action.action))).toBe(false);
      await exerciseCollapsedChatDock(page, "zdwa", testInfo);
      await openChatWithKeyboardFocus(page, "#chatToggle", "#chatInput");
      const historyAvatar = page.locator("#chatBox .chat-line", { hasText:"Nachricht 29" }).locator(".player-avatar");
      await expect(historyAvatar).toHaveAttribute("src", "/api/avatars/4242");
      await expect(historyAvatar).toHaveJSProperty("naturalWidth", 20);
      await expectReachable(page, "#chatInput");
      await expectReachable(page, "#chatSend");
      expect(await page.locator("#chatInput").evaluate(input => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
      await page.locator("#chatInput").pressSequentially("Zuschauen und mitreden");
      await expectChatAboveKeyboard(page, "#chatInput", "#chatSend");
      await expect(page.locator("#chatInput")).toHaveValue("Zuschauen und mitreden");
      await page.locator("#chatSend").tap();
      await expect.poll(() => actions.some(action => action.action === "chat_message" && action.text === "Zuschauen und mitreden")).toBe(true);
      await expect(page.locator("#chatBox")).toContainText("Zuschauen und mitreden");
      await expect(page.locator("#chatBox .chat-line", { hasText:"Zuschauen und mitreden" }).locator(".player-avatar")).toHaveAttribute("src", "/api/avatars/4242");
      activeSocket.send(JSON.stringify({ emoji:{ from_id:"S-observer", from:"Observer", user_id:4242, emoji:"😲", ts:"2026-09-20T18:51:00Z" } }));
      await expect(page.locator("#chatBox .chat-line.reaction").locator(".player-avatar")).toHaveAttribute("src", "/api/avatars/4242");
      activeSocket.send(JSON.stringify({ chat_history:[{ from_id:"S-departed", sender:"Observer", user_id:4242, text:"Replayed history", ts:"2026-09-20T18:44:00Z", kind:"chat" }] }));
      await expect(page.locator("#chatBox .chat-line", { hasText:"Replayed history" }).locator(".player-avatar")).toHaveAttribute("src", "/api/avatars/4242");
      await page.screenshot({ path:testInfo.outputPath(`spectator-chat-${theme}.png`) });
      await page.locator("#chatClose").tap();
      await expect(page.locator("#chatPanel")).not.toHaveClass(/open/);
      await expect(page.locator("#chatInput")).not.toBeFocused();
    } finally { await context.close(); }
  });
}
