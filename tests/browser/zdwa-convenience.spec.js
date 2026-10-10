const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers:"block" });

function snapshot() {
  return {
    _name:"Spielkomfort", _mode:"2", _hardcore:false,
    _players:[{ id:"p1", name:"Anna" }, { id:"p2", name:"Ben" }],
    _players_joined:2, _expected:2, _started:true, _finished:false, _aborted:false,
    _paused:false, _offline_players:[], _connected:{ p1:true, p2:true },
    _turn:{ player_id:"p1", roll_index:1 }, _dice:[5,5,2,3,4],
    _holds:[true,true,false,false,false], _rolls_used:1, _rolls_max:3,
    _scoreboards:{ p1:{}, p2:{} }, _admin_edits:{}, _superadmin_active:false,
    _announced_row4:"5", _announced_by:"p1", _announced_board:"p1",
    _correction:{ active:false }, _teams:[], _scoreboards_by_team:{},
    _results:null, _last_write_public:{}, _has_last:{}, _auto_single:false,
    _chat_history:[], suggestions:[],
  };
}

async function fixture(page, { language = "de", preferences = {} } = {}) {
  const state = snapshot();
  const auth = { authenticated:true, user:{ id:42, username:"Anna", is_admin:false,
    preferences:{ preferred_language:language, auto_write_announced:false, ...preferences } } };
  await page.addInitScript(lang => localStorage.setItem("zdwa_language", lang), language);
  await page.route("**/api/auth/me", route => route.fulfill({ json:auth }));
  const actions = [];
  let socket;
  await page.routeWebSocket(/\/ws\/convenience-fixture$/, route => {
    socket = route;
    route.onMessage(raw => {
      const action = JSON.parse(String(raw));
      actions.push(action);
      if (["join_game", "rejoin_game"].includes(action.action)) {
        route.send(JSON.stringify({ player_id:"p1", resume_token:"convenience-fixture", auth }));
        route.send(JSON.stringify({ scoreboard:state }));
      }
    });
  });
  await page.goto("/spiel/convenience-fixture?name=Anna");
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  return { state, actions, push() { socket.send(JSON.stringify({ scoreboard:state })); } };
}

for (const width of [390, 768, 1440]) {
  for (const language of ["de", "en"]) {
    test(`${language} ${width}px: announcement becomes Write on roll 2 and writes its field`, async ({ page }) => {
      await page.setViewportSize({ width, height:900 });
      const room = await fixture(page, { language });
      const button = page.locator("#announceBtnInline");
      await expect(button).toHaveText(language === "de" ? "Ansage aufheben" : "cancel announcement");
      await expect(button).toBeEnabled();
      room.state._rolls_used = 2;
      room.state._turn.roll_index = 2;
      room.push();
      await expect(button).toHaveText(language === "de" ? "Schreiben" : "Write");
      await expect(button).toBeEnabled();
      await expect(page.locator("#rollBtnInline")).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await button.click();
      await expect.poll(() => room.actions.some(item => item.action === "write_field")).toBe(true);
      expect(room.actions).toContainEqual({ action:"write_field", row:4, field:"ang" });
      await expect(page.locator("#appDialog")).toHaveCount(0);
      await expect(button).toBeDisabled();
    });
  }
}

test("disabling the write button retains the first-roll cancellation and later disabled button", async ({ page }) => {
  const room = await fixture(page, { preferences:{ announce_button_writes:false } });
  const button = page.locator("#announceBtnInline");
  await expect(button).toHaveText("Ansage aufheben");
  await expect(button).toBeEnabled();
  room.state._rolls_used = 2;
  room.push();
  await expect(button).toHaveText("Ansage aufheben");
  await expect(button).toBeDisabled();
  await page.locator('.player-card.me td.cell[data-row="4"][data-field="ang"]').click();
  await expect.poll(() => room.actions.some(item => item.action === "write_field")).toBe(true);
});

test("Write retains strike confirmation when that independent setting is disabled", async ({ page }) => {
  const room = await fixture(page, { preferences:{ skip_forced_strike_confirmation:false } });
  room.state._dice = [1,2,3,4,6];
  room.state._rolls_used = 2;
  room.push();
  await expect(page.locator("#announceBtnInline")).toHaveText("Schreiben");
  await page.locator("#announceBtnInline").click();
  await expect(page.locator("#appDialogTitle")).toHaveText("Feld streichen?");
  expect(room.actions.filter(item => item.action === "write_field")).toHaveLength(0);
  await page.locator('[data-dialog-action="cancel"]').click();
  await expect(page.locator("#announceBtnInline")).toBeEnabled();
  await page.locator("#announceBtnInline").click();
  await page.locator('[data-dialog-action="confirm"]').click();
  await expect.poll(() => room.actions.some(item => item.action === "write_field")).toBe(true);
});

test("Write follows paused, correction, opponent and completed-game restrictions", async ({ page }) => {
  const room = await fixture(page);
  room.state._rolls_used = 2;
  room.push();
  const button = page.locator("#announceBtnInline");
  await expect(button).toBeEnabled();
  for (const flag of ["_paused", "_superadmin_active"]) {
    room.state[flag] = true;
    room.push();
    await expect(button).toBeDisabled();
    room.state[flag] = false;
    room.push();
    await expect(button).toBeEnabled();
  }
  room.state._correction = { active:true, player_id:"p1", dice:[5,5,2,3,4] };
  room.push();
  await expect(button).toBeDisabled();
  room.state._correction = { active:false };
  room.push();
  await expect(button).toBeEnabled();
  room.state._turn.player_id = "p2";
  room.push();
  await expect(button).toBeDisabled();
  room.state._turn.player_id = "p1";
  room.state._finished = true;
  room.push();
  await expect(button).toBeDisabled();
  expect(room.actions.filter(item => item.action === "write_field")).toHaveLength(0);
});

test("auto-hold opt-out is included in both announcement and roll messages", async ({ page }) => {
  const room = await fixture(page, { preferences:{ auto_hold_announced_numbers:false } });
  room.state._announced_row4 = null;
  room.push();
  await expect(page.locator("#announceBtnInline")).toHaveText("Ansagen");
  await page.locator("#announceBtnInline").click();
  await page.locator('#mobileAnnouncePicker [data-field="5"]').click();
  await expect.poll(() => room.actions.some(item => item.action === "announce_row4")).toBe(true);
  expect(room.actions).toContainEqual({ action:"announce_row4", field:"5", auto_hold_announced_numbers:false });
  room.state._announced_row4 = "5";
  room.push();
  await page.locator("#rollBtnInline").click();
  await expect.poll(() => room.actions.some(item => item.action === "roll_dice")).toBe(true);
  expect(room.actions).toContainEqual({ action:"roll_dice", auto_hold_announced_numbers:false });
});
