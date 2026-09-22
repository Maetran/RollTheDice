const { test, expect } = require("@playwright/test");
const { expectReachable } = require("./table-viewport");

const devices = [
  { name:"iPhone", width:390, height:844 },
  { name:"iPhone Pro Max", width:440, height:956 },
  { name:"iPad", width:1024, height:1366 },
];

async function openGame(page) {
  const actions = [];
  const players = ["Anna", "Ben", "Clara", "David"].map((name, index) => ({ id:`p${index + 1}`, name }));
  await page.routeWebSocket(/\/ws\/orientation-fixture$/, socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      actions.push(message);
      if (["join_game", "rejoin_game"].includes(message.action)) {
        socket.send(JSON.stringify({ player_id:"p1", resume_token:"orientation-fixture" }));
        socket.send(JSON.stringify({ scoreboard:{
          _name:"Orientation table", _mode:"2v2", _hardcore:false,
          _players:players, _players_joined:4, _expected:4, _started:true,
          _finished:false, _aborted:false, _paused:false, _manual_pause:false, _offline_players:[],
          _connected:Object.fromEntries(players.map(player => [player.id, true])),
          _turn:{ player_id:"p1", roll_index:1 }, _dice:[2, 2, 3, 4, 5], _holds:[false, false, false, false, false],
          _rolls_used:1, _rolls_max:3, _scoreboards:Object.fromEntries(players.map(player => [player.id, {}])),
          _admin_edits:{}, _superadmin_active:false, _announced_row4:null, _announced_by:null,
          _announced_board:null, _correction:{ active:false },
          _teams:[{ id:"A", name:"Anna und Clara", members:["p1", "p3"] }, { id:"B", name:"Ben und David", members:["p2", "p4"] }],
          _scoreboards_by_team:{ A:{}, B:{} }, _results:null, _last_write_public:{}, _has_last:{},
          _auto_single:false, _chat_history:[], suggestions:[],
        } }));
      }
      if (message.action === "chat_message") socket.send(JSON.stringify({
        chat:{ from_id:"p1", sender:"Anna", text:message.text, ts:"2026-09-22T16:00:00Z", kind:"chat" },
      }));
    });
  });
  await page.goto("/spiel/orientation-fixture?name=Anna");
  await expect(page.locator(".player-card.me")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Exercise the installed-app CSS, including the home-indicator inset.
    const visit = rules => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes("display-mode: standalone")) rule.media.mediaText = "all";
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
    document.body.style.setProperty("--room-safe-bottom", "34px");
  });
  return actions;
}

async function tapPaintedCenter(page, selector) {
  await expectReachable(page, selector);
  await expect.poll(() => page.locator(selector).evaluate(element => new Promise(resolve => {
    const before = element.getBoundingClientRect();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const after = element.getBoundingClientRect();
      resolve(["x", "y", "width", "height"].every(key => Math.abs(before[key] - after[key]) < .5));
    }));
  })), { message:`${selector} finishes moving before its painted center is tapped` }).toBe(true);
  const box = await page.locator(selector).boundingBox();
  // Use coordinates from the rendered control, with no locator actionability
  // retry, scroll or DOM click that could conceal a stale mobile hit-test map.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function expectPortraitRestored(page, headerTop) {
  await expect.poll(() => page.locator(".room-header").evaluate(element => element.getBoundingClientRect().top), {
    message:"returning to portrait keeps the header at its original painted position",
  }).toBeCloseTo(headerTop, 0);
  await expect.poll(() => page.locator("#chatPanel").evaluate(element => Math.abs(element.getBoundingClientRect().bottom - innerHeight)), {
    message:"the collapsed chat returns to the visible bottom edge",
  }).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => ({ x:scrollX, y:scrollY }))).toEqual({ x:0, y:0 });
  await tapPaintedCenter(page, "#roomHeaderMenuToggle");
  await expect(page.locator("#roomHeaderMenuPanel")).toBeVisible();
  await tapPaintedCenter(page, "#roomHeaderMenuToggle");
  await expect(page.locator("#roomHeaderMenuPanel")).toBeHidden();
  await tapPaintedCenter(page, "#chatToggle");
  await expect(page.locator("#chatToggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#chatInput")).toBeFocused();
  await tapPaintedCenter(page, "#chatToggle");
  await expect(page.locator("#chatToggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#chatInput")).not.toBeFocused();
}

async function rotate(page, viewport) {
  await page.setViewportSize(viewport);
  // setViewportSize changes mobile geometry but does not consistently emit
  // the physical-device orientation events in the desktop browser engines.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("orientationchange"));
    screen.orientation?.dispatchEvent(new Event("change"));
  });
}

for (const theme of ["light", "dark", "classic"]) {
  for (const device of devices) {
    test(`ZDWA ${theme} ${device.name}: portrait survives rotation, delayed viewport settlement and chat keyboard`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(60000);
      const portrait = { width:device.width, height:device.height };
      const landscape = { width:device.height, height:device.width };
      const context = await browser.newContext({ baseURL, viewport:portrait, isMobile:true, hasTouch:true, serviceWorkers:"block", reducedMotion:"reduce" });
      await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
      const page = await context.newPage();
      try {
        const actions = await openGame(page);
        const headerTop = await page.locator(".room-header").evaluate(element => element.getBoundingClientRect().top);
        for (let cycle = 0; cycle < 2; cycle += 1) {
          await rotate(page, landscape);
          await tapPaintedCenter(page, "#chatToggle");
          await expect(page.locator("#chatInput")).toBeFocused();
          await page.locator("#chatInput").fill("Entwurf bleibt beim Drehen erhalten");
          await rotate(page, portrait);
          await expect(page.locator("#chatInput")).toHaveValue("Entwurf bleibt beim Drehen erhalten");
          await tapPaintedCenter(page, "#chatToggle");
          await expect(page.locator("#chatToggle")).toHaveAttribute("aria-expanded", "false");
          await expectPortraitRestored(page, headerTop);
        }

        await rotate(page, landscape);
        await page.evaluate(({ width, height }) => {
          // Mobile WebKit can report the previous orientation and a displaced
          // visual viewport during rotation, then settle without another event.
          for (const [key, value] of Object.entries({ width, height, offsetTop:120 })) {
            Object.defineProperty(visualViewport, key, { configurable:true, value });
          }
        }, landscape);
        await rotate(page, portrait);
        await page.evaluate(() => {
          setTimeout(() => {
            for (const key of ["width", "height", "offsetTop"]) delete visualViewport[key];
          }, 120);
        });
        await expectPortraitRestored(page, headerTop);

        await page.evaluate(() => {
          // A toolbar-sized difference after rotation is not an on-screen
          // keyboard. A leftover offset must not move the whole game even if
          // WebKit keeps reporting it, including after tapping the chat input.
          Object.defineProperty(visualViewport, "height", { configurable:true, value:innerHeight - 48 });
          Object.defineProperty(visualViewport, "offsetTop", { configurable:true, value:62 });
          visualViewport.dispatchEvent(new Event("resize"));
          visualViewport.dispatchEvent(new Event("scroll"));
        });
        await expectPortraitRestored(page, headerTop);
        await page.evaluate(() => {
          delete visualViewport.height;
          delete visualViewport.offsetTop;
          visualViewport.dispatchEvent(new Event("resize"));
        });

        await tapPaintedCenter(page, "#chatToggle");
        await page.locator("#chatInput").fill("Chat nach dem Drehen");
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, "height", { configurable:true, value:380 });
          Object.defineProperty(visualViewport, "offsetTop", { configurable:true, value:24 });
          visualViewport.dispatchEvent(new Event("resize"));
          visualViewport.dispatchEvent(new Event("scroll"));
        });
        await expect.poll(() => page.locator("#chatSend").evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(404);
        if (theme === "light" && device.width === 440) {
          await page.evaluate(() => {
            Object.defineProperty(visualViewport, "scale", { configurable:true, value:1.5 });
            visualViewport.dispatchEvent(new Event("resize"));
          });
          await expect.poll(() => page.evaluate(() => ["height", "top", "bottom"].map(name => (
            document.documentElement.style.getPropertyValue(`--game-viewport-${name}`)
          ))), { message:"pinch zoom returns viewport placement to the browser" }).toEqual(["", "", ""]);
          await page.evaluate(() => {
            delete visualViewport.scale;
            visualViewport.dispatchEvent(new Event("resize"));
          });
          await expect.poll(() => page.locator("#chatSend").evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(404);
        }
        await tapPaintedCenter(page, "#chatSend");
        await expect.poll(() => actions.some(action => action.action === "chat_message" && action.text === "Chat nach dem Drehen")).toBe(true);
        await tapPaintedCenter(page, "#chatToggle");
        await page.evaluate(() => {
          delete visualViewport.height;
          delete visualViewport.offsetTop;
          visualViewport.dispatchEvent(new Event("resize"));
          visualViewport.dispatchEvent(new Event("scroll"));
        });
        await expectPortraitRestored(page, headerTop);
        await page.screenshot({ path:testInfo.outputPath(`rotation-${theme}-${device.width}.png`) });
      } finally { await context.close(); }
    });
  }
}
