const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { expectReachable } = require("./table-viewport");
const { expectTextContrast } = require("./contrast");

const entry = product => product === "zilch" ? "/zilch/offline-spielen" : "/offline-spielen";
const storageKey = product => `rollthedice:offline:v1:${product}`;
const confirm = page => page.locator('[data-dialog-action="confirm"]').click();
const cancel = page => page.locator('[data-dialog-action="cancel"]').click();
const state = (page, product) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(product));

async function browserContext(browser, baseURL, { product = "zdwa", theme = "light", lang = "de", saved, dice = [] } = {}) {
  const context = await browser.newContext({ baseURL, serviceWorkers:"block", hasTouch:true, isMobile:true, viewport:{ width:440, height:956 } });
  await context.addInitScript(({ game, design, language, stored, sequence }) => {
    const themeKey = game === "zilch" ? "zilch_theme" : "wuerfler_theme";
    if (!localStorage.getItem(themeKey)) localStorage.setItem(themeKey, design);
    if (!localStorage.getItem("zdwa_language")) localStorage.setItem("zdwa_language", language);
    if (stored && !sessionStorage.getItem("offline-fixture-seeded")) {
      localStorage.setItem(`rollthedice:offline:v1:${game}`, JSON.stringify(stored));
      sessionStorage.setItem("offline-fixture-seeded", "1");
    }
    window.__offlineDiceQueue = [...sequence];
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = array => {
      if (array.length === 1 && ["Uint8Array", "Uint32Array"].includes(array.constructor.name)) {
        array[0] = (window.__offlineDiceQueue.shift() || 2) - 1;
        return array;
      }
      return original(array);
    };
  }, { game:product, design:theme, language:lang, stored:saved, sequence:dice });
  return context;
}

async function begin(page, action = "start") {
  await page.locator(`[data-action="${action}"]`).click();
  await expect(page.locator("#appDialog")).toContainText(/keine Erfolge|no achievements/i);
  await expect(page.locator("#appDialog")).toContainText(/Ranglisten|leaderboard/i);
  await confirm(page);
  await expect(page.locator(".practice-workspace")).toBeVisible();
}

function networkAudit(page) {
  const traffic = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) traffic.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  page.on("websocket", socket => traffic.push(`WS ${socket.url()}`));
  return traffic;
}

async function engine(product) {
  const source = readFileSync(path.resolve(__dirname, `../../frontend/offline/${product}-engine.js`));
  return import(`data:text/javascript;base64,${source.toString("base64")}`);
}

function savedSession(product, game) {
  return { schema:1, product, session:{ id:`fixture-${product}`, startedAt:"2026-09-20T20:00:00Z", data:game }, records:[] };
}

for (const product of ["zdwa", "zilch"]) {
  test(`${product}: local activation, reload and returning online always need explicit confirmation`, async ({ browser, baseURL }) => {
    const context = await browserContext(browser, baseURL, { product });
    const page = await context.newPage();
    const traffic = networkAudit(page);
    try {
      await page.goto(entry(product));
      await page.locator('[data-action="start"]').click();
      await expect(page.locator("#appDialog")).toContainText("keine Erfolge");
      await cancel(page);
      await expect(page.locator(".practice-workspace")).toHaveCount(0);
      expect(await state(page, product)).toBeNull();
      await begin(page);
      const original = await state(page, product);
      expect(original.session.id).toBeTruthy();
      await page.reload();
      await expect(page.locator(".practice-workspace")).toHaveCount(0);
      await page.locator('[data-action="resume"]').click();
      await expect(page.locator("#appDialog")).toContainText("keine Erfolge");
      await cancel(page);
      await expect(page.locator(".practice-workspace")).toHaveCount(0);
      await begin(page, "resume");
      expect((await state(page, product)).session).toEqual(original.session);
      await page.goBack();
      await expect(page.locator("#appDialogTitle")).toHaveText("Zurück in den Online-Modus?");
      await cancel(page);
      await expect(page).toHaveURL(new URL(entry(product), baseURL).href);
      await expect(page.locator(".practice-workspace")).toBeVisible();

      // Language changes are local too: they cannot consult/sync an account.
      await page.locator("select").filter({ has:page.locator('option[value="en"]') }).selectOption("en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("#practiceOnline")).toHaveText("Play online");
      await begin(page, "resume");
      await page.locator("#practiceOnline").click();
      await expect(page.locator("#appDialog")).toContainText(/achievements.*leaderboards/i);
      await cancel(page);
      await expect(page.locator(".practice-workspace")).toBeVisible();
      expect(traffic).toEqual([]);

      await context.setOffline(true);
      await page.locator("#practiceOnline").click();
      await confirm(page);
      await expect(page.locator("#practiceStatus")).toContainText(/connection/i);
      await expect(page.locator(".practice-workspace")).toBeVisible();
      expect(traffic).toEqual([]);
      await context.setOffline(false);
      await page.route("**/api/health", route => route.fulfill({ status:503, contentType:"application/json", body:'{"status":"not_ready"}' }));
      await page.locator("#practiceOnline").click();
      await confirm(page);
      await expect(page.locator("#practiceStatus")).toContainText(/connection/i);
      await expect(page.locator(".practice-workspace")).toBeVisible();
      await page.unroute("**/api/health");
      const home = product === "zilch" ? "/zilch" : "/";
      await page.route(new URL(home, baseURL).href, route => route.fulfill({ contentType:"text/html", body:"<h1>Online home</h1>" }));
      await page.locator("#practiceOnline").click();
      await confirm(page);
      await expect(page).toHaveURL(new URL(home, baseURL).href);
      await expect(page.locator("h1")).toHaveText("Online home");
      expect(traffic).toEqual(["GET /api/health", "GET /api/health"]);
      expect((await state(page, product)).session.id).toBe(original.session.id);
    } finally { await context.close(); }
  });
}

test("ZDWA local controls hold dice, bind announcements and confirm zeroes before writing", async ({ browser, baseURL }) => {
  const context = await browserContext(browser, baseURL, { dice:[1, 2, 3, 4, 5, 6, 6, 6, 6] });
  const page = await context.newPage();
  const traffic = networkAudit(page);
  try {
    await page.goto(entry("zdwa"));
    await begin(page);
    await page.locator('[data-action="hold"][data-index="0"]').click();
    await expect(page.locator('[data-action="hold"][data-index="0"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-action="roll"]').click();
    expect((await state(page, "zdwa")).session.data.dice).toEqual([1, 6, 6, 6, 6]);
    await expect(page.locator('[data-action="announce"]')).toBeDisabled();
    await page.locator('[data-action="write"][data-row="1"][data-col="free"]').click();
    await expect(page.locator("#appDialogTitle")).toHaveText("Null Punkte eintragen?");
    await cancel(page);
    expect((await state(page, "zdwa")).session.data.board).toEqual({});
    await page.locator('[data-action="write"][data-row="1"][data-col="free"]').click();
    await confirm(page);
    expect((await state(page, "zdwa")).session.data.board).toEqual({ "1,free":0 });
    await page.locator('[data-action="announce"]').click();
    await page.locator('[data-dialog-action="field-13"]').click();
    expect((await state(page, "zdwa")).session.data.announced).toBe("full");
    await expect(page.locator('[data-action="write"]:enabled')).toHaveCount(1);
    await expect(page.locator('[data-action="write"]:enabled')).toHaveAttribute("data-col", "ang");
    await page.locator('[data-action="announce"]').click();
    await page.locator('[data-dialog-action="clear"]').click();
    expect((await state(page, "zdwa")).session.data.announced).toBeNull();
    await page.locator('[data-action="pause"]').click();
    await begin(page, "resume");
    expect((await state(page, "zdwa")).session.data.board).toEqual({ "1,free":0 });
    expect(traffic).toEqual([]);
  } finally { await context.close(); }
});

for (const product of ["zdwa", "zilch"]) {
  test(`${product}: completed results stay private and survive reload without any server calls`, async ({ browser, baseURL }) => {
    const rules = await engine(product);
    const game = rules.createGame();
    if (product === "zdwa") {
      while (rules.totals(game).remaining > 1) {
        rules.roll(game, () => 2);
        const cell = rules.allowedCells(game)[0];
        rules.write(game, cell.row, cell.col);
      }
    } else {
      for (let round = 0; round < 8; round += 1) {
        const dice = [6, 6, 6, 6, 2, 3];
        rules.roll(game, () => dice.shift());
        rules.selectHold(game, rules.options(game).find(option => option.points === 1200).id);
        rules.bank(game);
      }
    }
    expect(rules.validateSavedGame(game)).toBe(true);
    const context = await browserContext(browser, baseURL, { product, saved:savedSession(product, game), dice:[6, 6, 6, 2, 3, 4] });
    const page = await context.newPage();
    const traffic = networkAudit(page);
    try {
      await page.goto(entry(product));
      await begin(page, "resume");
      await context.setOffline(true);
      if (product === "zdwa") {
        await page.locator('[data-action="write"]:enabled').click();
        await expect(page.locator("#appDialogTitle")).toHaveText("Null Punkte eintragen?");
        await confirm(page);
      } else {
        await page.locator('[data-action="roll"]').click();
        await page.locator('[data-action="select"]', { hasText:"600 Punkte" }).click();
        await expect(page.locator('[data-action="bank"]')).toBeEnabled();
        await page.locator('[data-action="bank"]').click();
      }
      await expect(page.locator(".practice-end")).toContainText("Offline-Spiel beendet");
      const completed = await state(page, product);
      expect(completed.session.data.finished).toBe(true);
      expect(completed.records).toHaveLength(1);
      expect(completed.records[0].id).toBe(`fixture-${product}`);
      expect(traffic).toEqual([]);
      await context.setOffline(false);
      await page.reload();
      await expect(page.locator('[data-action="resume"]')).toHaveCount(0);
      await expect(page.locator(".practice-records li")).toHaveCount(1);
      await page.locator('[data-action="clear"]').click();
      await cancel(page);
      expect((await state(page, product)).records).toHaveLength(1);
      await page.locator('[data-action="clear"]').click();
      await confirm(page);
      expect((await state(page, product)).records).toHaveLength(0);
      expect(traffic).toEqual([]);
    } finally { await context.close(); }
  });
}

test("Zilch CPU turns run locally and return reachable controls to the player", async ({ browser, baseURL }) => {
  const context = await browserContext(browser, baseURL, { product:"zilch", dice:[6, 1, 6, 6, 6, 2, 3, 4, 6, 6, 6, 2, 3, 4] });
  const page = await context.newPage();
  const traffic = networkAudit(page);
  try {
    await page.goto(entry("zilch"));
    await page.locator("#practiceMode").selectOption("cpu");
    await begin(page);
    await context.setOffline(true);
    await page.locator('[data-action="roll"]').click();
    await page.locator('[data-action="select"]', { hasText:"600 Punkte" }).click();
    await page.locator('[data-action="bank"]').click();
    await expect(page.locator(".practice-board h1")).toContainText("Würfelwirt");
    await expect(page.locator('[data-action="roll"]')).toBeDisabled();
    await page.locator("#practiceOnline").click();
    await cancel(page);
    await expect.poll(async () => (await state(page, "zilch")).session.data.players[1].totalPoints).toBe(600);
    await expect(page.locator(".practice-board h1")).toHaveText("Du bist am Zug");
    await expect(page.locator('[data-action="roll"]')).toBeEnabled();
    expect((await state(page, "zilch")).session.data.players[0].totalPoints).toBe(600);
    expect(traffic).toEqual([]);
  } finally { await context.close(); }
});

test("Zilch quick-hold choices remain editable until banking commits the selected points", async ({ browser, baseURL }) => {
  const context = await browserContext(browser, baseURL, { product:"zilch", dice:[6, 6, 6, 5, 1, 2] });
  const page = await context.newPage();
  const traffic = networkAudit(page);
  try {
    await page.goto(entry("zilch"));
    await begin(page);
    await page.locator('[data-action="roll"]').click();
    const sixes = page.locator('[data-action="select"]', { hasText:"600 Punkte" });
    const sixesAndOne = page.locator('[data-action="select"]', { hasText:"700 Punkte" });
    await sixes.click();
    await expect(sixes).toHaveAttribute("aria-pressed", "true");
    expect((await state(page, "zilch")).session.data.turn.round_points).toBe(0);
    await sixesAndOne.click();
    await expect(sixesAndOne).toHaveAttribute("aria-pressed", "true");
    await expect(sixes).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-action="bank"]')).toBeEnabled();
    await page.locator('[data-action="bank"]').click();
    expect((await state(page, "zilch")).session.data.players[0].totalPoints).toBe(700);
    expect(traffic).toEqual([]);
  } finally { await context.close(); }
});

test("hidden local CPU games pause their timers and resume without contacting an account", async ({ browser, baseURL }) => {
  const context = await browserContext(browser, baseURL, { product:"zilch", dice:[1, 6, 6, 6, 6, 2, 3, 4] });
  const page = await context.newPage();
  const traffic = networkAudit(page);
  try {
    await page.clock.install();
    await page.goto(entry("zilch"));
    await page.locator("#practiceMode").selectOption("cpu");
    await begin(page);
    await context.setOffline(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable:true, get:() => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const before = (await state(page, "zilch")).session;
    await page.clock.fastForward(5000);
    expect((await state(page, "zilch")).session).toEqual(before);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable:true, get:() => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(2700);
    const after = (await state(page, "zilch")).session.data;
    expect(after.players[1].totalPoints).toBe(600);
    expect(after.turn.player_id).toBe("you");
    await expect(page.locator('[data-action="roll"]')).toBeEnabled();
    expect(traffic).toEqual([]);
  } finally { await context.close(); }
});

test("Zilch explains and enforces a confirmation roll before banking three ones", async ({ browser, baseURL }) => {
  const context = await browserContext(browser, baseURL, { product:"zilch", dice:[1, 1, 1, 5, 2, 3, 5, 2] });
  const page = await context.newPage();
  try {
    await page.goto(entry("zilch"));
    await begin(page);
    await page.locator('[data-action="roll"]').click();
    const choice = page.locator('[data-action="select"]', { hasText:"1050 Punkte" });
    await choice.click();
    await expect(page.locator('[data-action="bank"]')).toBeDisabled();
    await expect(page.locator(".practice-board")).toContainText("Bestätigungswurf");
    await page.locator('[data-action="roll"]').click();
    await page.locator('[data-action="select"]', { hasText:"50 Punkte" }).click();
    await expect(page.locator('[data-action="bank"]')).toBeEnabled();
    await page.locator('[data-action="bank"]').click();
    expect((await state(page, "zilch")).session.data.players[0].totalPoints).toBe(1100);
  } finally { await context.close(); }
});

test("Zilch leaves a bust roll visible until the next roll", async ({ browser, baseURL }) => {
  const context = await browserContext(browser, baseURL, { product:"zilch", dice:[6, 6, 6, 2, 3, 4, 2, 3, 4, 1, 2, 3, 4, 5, 6] });
  const page = await context.newPage();
  try {
    await page.goto(entry("zilch"));
    await begin(page);
    await page.locator('[data-action="roll"]').click();
    await page.locator('[data-action="select"]', { hasText:"600 Punkte" }).click();
    await page.locator('[data-action="roll"]').click();
    await expect(page.locator(".practice-event")).toContainText("Zilch!");
    await expect(page.locator(".practice-die")).toHaveText(["⚅", "⚅", "⚅", "⚁", "⚂", "⚃"]);
    expect((await state(page, "zilch")).session.data.turn.rolls_used).toBe(0);
    await page.locator('[data-action="roll"]').click();
    await expect(page.locator(".practice-die")).toHaveText(["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"]);
    await expect(page.locator('[data-action="select"]').first()).toBeVisible();
  } finally { await context.close(); }
});

for (const [product, themes] of [["zdwa", ["light", "dark", "classic"]], ["zilch", ["light", "lcars"]]]) {
  for (const theme of themes) for (const lang of ["de", "en"]) {
    test(`${product} ${theme} ${lang}: local controls fit phones and both tablet orientations`, async ({ browser, baseURL }, testInfo) => {
      const context = await browserContext(browser, baseURL, { product, theme, lang });
      const page = await context.newPage();
      try {
        await page.goto(entry(product));
        await begin(page);
        if (product === "zilch") await expect(page.locator(".practice-board h1")).toHaveText(lang === "en" ? "Your turn" : "Du bist am Zug");
        await expectTextContrast(page.locator('[data-action="roll"]'));
        await expectTextContrast(page.locator(".practice-board h1"));
        for (const viewport of [{ width:440, height:956 }, { width:320, height:568 }, { width:844, height:390 }, { width:820, height:1180 }, { width:1024, height:1366 }, { width:1366, height:1024 }]) {
          await page.setViewportSize(viewport);
          await expectReachable(page, "#practiceOnline");
          await expectReachable(page, "#practiceLanguage");
          await expectReachable(page, "[data-theme-toggle]");
          await expectReachable(page, '[data-action="roll"]');
          await expectReachable(page, '[data-action="pause"]');
          await expectReachable(page, product === "zdwa" ? '[data-action="announce"]' : '[data-action="bank"]');
          const geometry = await page.evaluate(() => {
            const board = document.querySelector(".practice-board").getBoundingClientRect();
            return {
              width:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight,
              viewportWidth:innerWidth, viewportHeight:innerHeight,
              boardHeight:board.height, pageScroll:scrollY,
              targets:[...document.querySelectorAll('.practice-controls button:not(.practice-die), #practiceOnline')].map(button => button.getBoundingClientRect().height),
              headerTargets:[...document.querySelectorAll('.practice-tools button, .practice-tools select')].map(element => {
                const rect = element.getBoundingClientRect();
                return { width:rect.width, height:rect.height };
              }),
            };
          });
          expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth + 1);
          expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight + 1);
          expect(geometry.pageScroll).toBe(0);
          expect(geometry.boardHeight).toBeGreaterThan(100);
          expect(geometry.targets.every(height => height >= 44)).toBe(true);
          expect(geometry.headerTargets.every(target => target.width >= 44 && target.height >= 44)).toBe(true);
          if (product === "zdwa") {
            if (viewport.width === 1366 && viewport.height === 1024) {
              await expect.poll(() => page.locator(".practice-board").evaluate(board => board.scrollHeight - board.clientHeight), {
                message:"The iPad 12.9 landscape score sheet fits completely while retaining touch-sized fields",
              }).toBeLessThanOrEqual(1);
              const rowTargets = await page.locator('.practice-sheet [data-action="write"]').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
              expect(rowTargets.every(height => height >= 44)).toBe(true);
            }
            const last = page.locator(".practice-sheet tbody tr:last-child");
            await last.scrollIntoViewIfNeeded();
            await expect(last).toBeInViewport();
          }
          if (viewport.width >= 768 && viewport.height >= 600) {
            await expect(page.locator(".practice-info")).toBeVisible();
          }
          await page.screenshot({ path:testInfo.outputPath(`${product}-${theme}-${lang}-${viewport.width}x${viewport.height}.png`) });
        }
      } finally { await context.close(); }
    });
  }
}

test("a second local window cannot silently overwrite the first window's active game", async ({ browser, baseURL }) => {
  const context = await browserContext(browser, baseURL);
  const first = await context.newPage();
  const second = await context.newPage();
  const traffic = [networkAudit(first), networkAudit(second)];
  try {
    await first.goto(entry("zdwa"));
    await begin(first);
    const original = (await state(first, "zdwa")).session;
    await second.goto(entry("zdwa"));
    await begin(second, "resume");
    await second.locator('[data-action="roll"]').click();
    await expect(first.locator(".practice-workspace")).toHaveCount(0);
    await expect(first.locator("#practiceStatus")).toContainText("anderen Fenster");
    await first.locator('[data-action="resume"]').click();
    await cancel(first);
    expect((await state(first, "zdwa")).session.id).toBe(original.id);
    await expect(second.locator(".practice-workspace")).toBeVisible();
    expect(traffic.flat()).toEqual([]);
  } finally { await context.close(); }
});
