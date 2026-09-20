const { test, expect } = require("@playwright/test");
const { expectReachable } = require("./table-viewport");
const { openChatWithKeyboardFocus, expectChatAboveKeyboard, exerciseCollapsedChatDock } = require("./chat-mobile");

for (const theme of ["light", "dark", "classic"]) {
  for (const profile of ["2v2", "solo", "desktop-solo"]) {
    test(`ZDWA ${theme}: ${profile === "desktop-solo" ? "desktop" : "iPhone"} spectator can type and send in a ${profile} chat`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(90000);
      const desktop = profile === "desktop-solo";
      const solo = profile !== "2v2";
      const context = await browser.newContext({ baseURL, hasTouch:!desktop, isMobile:!desktop, viewport:desktop ? { width:1440, height:900 } : { width:440, height:956 }, serviceWorkers:"block" });
      await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
      const page = await context.newPage();
      const actions = [];
      let activeSocket;
      const players = (solo ? ["Anna"] : ["Anna", "Ben", "Clara", "David"]).map((name, index) => ({ id:`p${index + 1}`, name }));
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
                _name:"Spectator chat", _mode:solo ? "1" : "2v2", _hardcore:false,
                _players:players, _players_joined:players.length, _expected:players.length, _started:true,
                _finished:false, _aborted:false, _paused:false, _manual_pause:false, _offline_players:[],
                _connected:Object.fromEntries(players.map(player => [player.id, true])),
                _turn:{ player_id:"p1", roll_index:1 }, _dice:[2, 2, 3, 4, 5], _holds:[false, false, false, false, false],
                _rolls_used:1, _rolls_max:3,
                _scoreboards:Object.fromEntries(players.map(player => [player.id, {}])),
                _admin_edits:{}, _superadmin_active:false, _announced_row4:null, _announced_by:null,
                _announced_board:null, _correction:{ active:false },
                ...(!solo ? {
                  _teams:[{ id:"A", name:"Anna und Clara", members:["p1", "p3"] }, { id:"B", name:"Ben und David", members:["p2", "p4"] }],
                  _scoreboards_by_team:{ A:{}, B:{} },
                } : {}),
                _results:null, _last_write_public:{}, _has_last:{}, _auto_single:false,
                _chat_history:Array.from({ length:30 }, (_, index) => ({ from_id:"S-departed", sender:"Observer", user_id:4242, text:`Nachricht ${index}`, ts:"2026-09-20T18:45:00Z", kind:"chat" })),
                suggestions:[],
              } }));
            }
            if (message.action === "chat_message") socket.send(JSON.stringify({ chat:{ from_id:"S-observer", sender:"Observer", user_id:4242, text:message.text, ts:"2026-09-20T18:50:00Z", kind:"chat" } }));
          });
        });
        await page.goto("/spiel/spectator-chat-mobile/zuschauen?name=Observer");
        await expect(page.locator(".player-card")).toHaveCount(solo ? 1 : 2);
        expect(actions.some(action => ["join_game", "rejoin_game"].includes(action.action))).toBe(false);
        if (desktop) {
          await expect(page.locator("#chatContent")).toBeHidden();
          await expectReachable(page, "#chatToggle");
          await expectReachable(page, "#chatReactionsBar .emoji-fab");
          const expectCenteredSideChat = () => expect.poll(() => page.evaluate(() => {
            const chat = document.querySelector("#chatPanel").getBoundingClientRect();
            const reaction = document.querySelector("#chatReactionsBar").getBoundingClientRect();
            const header = document.querySelector(".room-header").getBoundingClientRect();
            return {
              besideTable:chat.right <= header.left,
              centeredTogether:Math.abs(chat.top + chat.height / 2 - reaction.top - reaction.height / 2) <= 1,
              centerMatchesAnchor:Math.abs(chat.top + chat.height / 2 - parseFloat(getComputedStyle(document.querySelector("#chatPanel")).top)) <= 1,
            };
          })).toEqual({ besideTable:true, centeredTogether:true, centerMatchesAnchor:true });
          await expectCenteredSideChat();
          // Emulate an additional touchscreen on a wide mouse-first device.
          // Playwright's hasTouch option would also change the primary pointer.
          await page.setViewportSize({ width:1920, height:1080 });
          await page.evaluate(() => {
            const visit = rules => {
              for (const rule of rules) {
                if (rule instanceof CSSMediaRule && rule.conditionText.includes("any-pointer: coarse")) {
                  rule.media.mediaText = rule.conditionText.replace(/\(any-pointer:\s*coarse\)/g, "(min-width: 0px)");
                }
                if (rule.cssRules) visit(rule.cssRules);
              }
            };
            for (const sheet of document.styleSheets) visit(sheet.cssRules);
          });
          await expectCenteredSideChat();
          await page.locator("#chatToggle").click();
          await expect(page.locator("#chatInput")).toBeFocused();
          await page.locator("#chatInput").fill("Desktop-Entwurf");
          await expectReachable(page, "#chatSend");
          await page.locator("#chatToggle").click();
          await expect(page.locator("#chatContent")).toBeHidden();
          await page.locator("#chatToggle").click();
          await expect(page.locator("#chatInput")).toHaveValue("Desktop-Entwurf");
          await page.locator("#chatSend").click();
          await expect.poll(() => actions.some(action => action.action === "chat_message" && action.text === "Desktop-Entwurf")).toBe(true);
          return;
        }
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
}
