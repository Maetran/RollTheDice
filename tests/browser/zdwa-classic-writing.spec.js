const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");

test.describe.configure({ mode: "parallel" });
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 } });

const SCORE = ".classic-written-score";
const STROKE = ".classic-written-score__stroke";
const FONT = /\/static\/[^/?]*classic[^/?]*\.woff2(?:\?.*)?$/;
const cellSelector = (player = "p2", row = 14, column = "free") =>
  `.player-card[data-board-id="${player}"] td.cell[data-row="${row}"][data-field="${column}"]`;

function snapshot() {
  return {
    _name: "Classic Schreibpfade", _hardcore: false,
    _players: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Ben" }],
    _players_joined: 2, _expected: 2, _started: true, _finished: false,
    _aborted: false, _paused: false, _manual_pause: false,
    _offline_players: [], _connected: { p1: true, p2: true },
    _turn: { player_id: "p2", roll_index: 1, first4oak_roll: 1 },
    _dice: [6, 6, 6, 6, 4], _holds: [false, false, false, false, false],
    _rolls_used: 1, _rolls_max: 3,
    _scoreboards: { p1: { "0,down": 3 }, p2: { "0,down": 2 } },
    _admin_edits: {}, _superadmin_active: false,
    _announced_row4: null, _announced_by: null, _announced_board: null,
    _correction: { active: false }, _mode: "2", _teams: [],
    _scoreboards_by_team: {}, _results: null, _last_write_public: {},
    _has_last: { p1: false, p2: false }, _auto_single: false,
    _chat_history: [], suggestions: [],
  };
}

async function fixture(page, { theme = "classic", initial = snapshot(), blockedFont = false } = {}) {
  await page.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
  if (blockedFont) await page.route(FONT, route => route.abort());
  let current = structuredClone(initial);
  let activeSocket;
  let connections = 0;
  const actions = [];
  await page.routeWebSocket(/\/ws\/classic-writing-fixture$/, socket => {
    activeSocket = socket;
    connections += 1;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      actions.push(message);
      if (["join_game", "rejoin_game"].includes(message.action)) {
        socket.send(JSON.stringify({ player_id: "p1", resume_token: "classic-writing-fixture" }));
        socket.send(JSON.stringify({ scoreboard: current }));
      }
    });
  });
  await page.goto("/spiel/classic-writing-fixture?name=Anna", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".player-card")).toHaveCount(2);
  await expect(page.locator('.player-card.me td.cell[data-row="0"][data-field="down"]')).toHaveText("3");
  return {
    actions,
    get connections() { return connections; },
    push(next) {
      current = structuredClone(next);
      activeSocket.send(JSON.stringify({ scoreboard: current }));
    },
    repeat() { activeSocket.send(JSON.stringify({ scoreboard: current })); },
    reconnect(next = current) {
      current = structuredClone(next);
      return activeSocket.close({ code: 1012, reason: "Regression reconnect" });
    },
  };
}

function withWrite(original, value = 74) {
  const next = structuredClone(original);
  next._scoreboards.p2["14,free"] = value;
  next._last_write_public.p2 = [14, "free"];
  next._turn = { player_id: "p1", roll_index: 0, first4oak_roll: null };
  next._rolls_used = 0;
  return next;
}

async function recordFrames(page, selector) {
  await page.evaluate(target => {
    const frames = [];
    let stopped = false;
    window.__classicWritingRecording = {
      frames,
      stop() { stopped = true; return frames; },
    };
    const inspect = () => {
      if (stopped) return;
      const cell = document.querySelector(target);
      const score = cell?.querySelector(".classic-written-score");
      const ink = score?.querySelector("svg");
      if (ink) {
        const box = ink.getBoundingClientRect();
        frames.push({
          time: performance.now(), text: cell.textContent.trim(),
          writing: score.classList.contains("is-writing"),
          visible: getComputedStyle(ink).display !== "none",
          geometry: [box.width, box.height],
          paths: [...ink.querySelectorAll("path")].map(path => ({
            d: path.getAttribute("d"),
            offset: Number.parseFloat(getComputedStyle(path).strokeDashoffset),
            opacity: Number.parseFloat(getComputedStyle(path).opacity),
            animation: getComputedStyle(path).animationName,
          })),
        });
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  }, selector);
}

async function recording(page) {
  return page.evaluate(() => window.__classicWritingRecording.stop());
}

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await fs.writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}

async function expectSettled(cell) {
  await expect.poll(() => cell.locator(STROKE).evaluateAll(paths =>
    paths.length > 0 && paths.every(path => Math.abs(Number.parseFloat(getComputedStyle(path).strokeDashoffset)) < 0.001)
  )).toBe(true);
}

function assertHandDrawn(frames, value) {
  expect(frames.length).toBeGreaterThan(8);
  expect(frames.every(frame => frame.text === String(value))).toBe(true);
  expect(frames.every(frame => frame.visible)).toBe(true);
  const movingFrames = frames.filter(frame => frame.paths.some(path => path.offset > 0.01 && path.offset < 0.99));
  expect(movingFrames.length, "real intermediate ink lengths, not a delayed whole-number reveal").toBeGreaterThanOrEqual(5);
  expect(new Set(movingFrames.map(frame => frame.paths.map(path => path.offset.toFixed(3)).join(","))).size).toBeGreaterThanOrEqual(5);
  expect(frames.every(frame => frame.paths.every(path => path.opacity === 1))).toBe(true);
  expect(frames.at(-1).paths.every(path => Math.abs(path.offset) < 0.001)).toBe(true);
  expect(frames.at(-1).paths.map(path => path.d)).toEqual(frames[0].paths.map(path => path.d));
  expect(frames.at(-1).geometry).toEqual(frames[0].geometry);
}

test("Classic draws new opponent points along sequential pen paths without delaying the next turn", async ({ page }, testInfo) => {
  const server = await fixture(page, { blockedFont: true });
  const selector = cellSelector();
  const cell = page.locator(selector);
  const old = page.locator(cellSelector("p1", 0, "down"));
  await expectSettled(old);
  const oldBox = await old.boundingBox();
  await recordFrames(page, selector);
  server.push(withWrite(snapshot()));
  await expect(cell).toHaveText("74");
  await expect(cell.locator(`${SCORE}[data-value="74"]`)).toHaveCount(1);
  await expect(cell.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(cell.locator("svg text")).toHaveCount(0);
  expect(await cell.locator(".classic-written-score__text").evaluate(element => getComputedStyle(element).clipPath)).not.toBe("none");
  await expect(page.locator("#rollBtnInline")).toBeEnabled();
  // Server-owned turn state and the old entry remain immediately usable even
  // while the opponent's visible ink is still being drawn.
  expect(await old.boundingBox()).toEqual(oldBox);
  await page.locator("#rollBtnInline").click();
  await expect.poll(() => server.actions.some(action => action.action === "roll_dice")).toBe(true);
  await expectSettled(cell);
  await page.waitForTimeout(60);
  const frames = await recording(page);
  assertHandDrawn(frames, 74);
  const firstDrawn = frames.find(frame => frame.paths.some(path => path.offset < 0.99));
  const done = frames.find(frame => frame.paths.every(path => path.offset < 0.001));
  expect(done.time - firstDrawn.time).toBeGreaterThan(300);
  expect(done.time - firstDrawn.time).toBeLessThan(850);
  expect(frames.some(frame => frame.paths[0].offset < 0.99 && frame.paths.at(-1).offset > 0.99), "the later digit waits while the first is written").toBe(true);
  const finishedSVG = await cell.locator("svg").innerHTML();
  await page.waitForTimeout(150);
  expect(await cell.locator("svg").innerHTML()).toBe(finishedSVG);
  await attachJSON(testInfo, "classic-writing-frame-progress.json", frames);
  await testInfo.attach("classic-written-opponent.png", { body: await page.screenshot({ path: testInfo.outputPath("classic-written-opponent.png") }), contentType: "image/png" });
});

test("repeated snapshots preserve writing progress and reload or reconnect never rewrite existing scores", async ({ page }, testInfo) => {
  const server = await fixture(page);
  const selector = cellSelector();
  const cell = page.locator(selector);
  await recordFrames(page, selector);
  server.push(withWrite(snapshot()));
  await expect(cell).toHaveText("74");
  await page.waitForTimeout(240);
  server.repeat();
  await page.waitForTimeout(130);
  server.repeat();
  await expectSettled(cell);
  await page.waitForTimeout(60);
  const frames = await recording(page);
  assertHandDrawn(frames, 74);
  for (let index = 1; index < frames.length; index += 1) {
    for (let path = 0; path < frames[index].paths.length; path += 1) {
      expect(frames[index].paths[path].offset, "duplicate authoritative frames must not restart a pen stroke")
        .toBeLessThanOrEqual(frames[index - 1].paths[path].offset + 0.035);
    }
  }
  const ink = await cell.locator(STROKE).evaluateAll(paths => paths.map(path => path.getAttribute("d")));
  server.repeat();
  await expectSettled(cell);
  expect(await cell.locator(STROKE).evaluateAll(paths => paths.map(path => path.getAttribute("d")))).toEqual(ink);
  const beforeReconnect = server.connections;
  const missedWhileOffline = withWrite(snapshot());
  missedWhileOffline._scoreboards.p2["13,free"] = 52;
  await server.reconnect(missedWhileOffline);
  await expect.poll(() => server.connections).toBe(beforeReconnect + 1);
  await expect(cell).toHaveText("74");
  const missedCell = page.locator(cellSelector("p2", 13));
  await expect(missedCell).toHaveText("52");
  await expectSettled(missedCell);
  await expect(missedCell.locator(`${SCORE}.is-writing`)).toHaveCount(0);
  await expectSettled(cell);
  await expect(cell.locator(`${SCORE}.is-writing`)).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(cell).toHaveText("74");
  await expectSettled(cell);
  await expect(cell.locator(`${SCORE}.is-writing`)).toHaveCount(0);
  await attachJSON(testInfo, "classic-writing-duplicate-frames.json", frames);
});

test("reduced motion writes immediately and Light or Dark keep their ordinary numeric presentation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const server = await fixture(page);
  const cell = page.locator(cellSelector());
  server.push(withWrite(snapshot(), 0));
  await expect(cell).toHaveText("0");
  await expectSettled(cell);
  const strokes = await cell.locator(STROKE).evaluateAll(paths => paths.map(path => ({
    animation: getComputedStyle(path).animationName,
    offset: Number.parseFloat(getComputedStyle(path).strokeDashoffset),
  })));
  expect(strokes.every(stroke => stroke.animation === "none" && stroke.offset === 0)).toBe(true);

  const theme = page.locator("#roomHeaderMenuPanel [data-theme-toggle]");
  for (const expectedTheme of ["light", "dark"]) {
    await page.locator("#roomHeaderMenuToggle").click();
    await theme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);
    await expect(cell).toHaveText("0");
    await expect(cell.locator("svg")).toBeHidden();
    expect(await cell.locator(".classic-written-score__text").evaluate(element => {
      const style = getComputedStyle(element);
      return style.position !== "absolute" && style.opacity !== "0" && style.visibility !== "hidden";
    })).toBe(true);
    server.repeat();
    await expect(cell.locator(`${SCORE}.is-writing`)).toHaveCount(0);
  }
  await page.locator("#roomHeaderMenuToggle").click();
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
  await expectSettled(cell);
  await expect(cell.locator(`${SCORE}.is-writing`)).toHaveCount(0);
});

test("a real two-guest write animates on both clients while the opponent can already roll", async ({ browser, baseURL, request }, testInfo) => {
  const firstContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const secondContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  for (const context of [firstContext, secondContext]) {
    await context.addInitScript(() => localStorage.setItem("wuerfler_theme", "classic"));
  }
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    const created = await request.post("/api/games", { data: { name: "Genuine handwriting regression", mode: 2 } });
    expect(created.ok()).toBeTruthy();
    const gameId = (await created.json()).game_id;
    await first.goto(`/spiel/${encodeURIComponent(gameId)}?name=Anna`, { waitUntil: "domcontentloaded" });
    await expect(first.locator(".player-card.me")).toBeVisible();
    await second.goto(`/spiel/${encodeURIComponent(gameId)}?name=Ben`, { waitUntil: "domcontentloaded" });
    await expect(second.locator(".player-card.me")).toBeVisible();
    await expect(first.locator("#rollBtnInline")).toBeEnabled();
    await first.locator("#rollBtnInline").click();
    await expect(first.locator("#diceBar .die.shaking")).toHaveCount(0);
    const face = await first.locator("#diceBar .die svg").first().locator("circle").count();
    expect(face).toBeGreaterThanOrEqual(1);
    expect(face).toBeLessThanOrEqual(6);
    const playerId = await first.locator(".player-card.me").getAttribute("data-board-id");
    const selector = cellSelector(playerId, face - 1, "free");
    await Promise.all([recordFrames(first, selector), recordFrames(second, selector)]);
    await first.locator(selector).click();
    await expect(first.locator(selector)).not.toHaveText("");
    const value = await first.locator(selector).textContent();
    await expect(second.locator(selector)).toHaveText(value);
    await expect(second.locator("#rollBtnInline")).toBeEnabled();
    await Promise.all([expectSettled(first.locator(selector)), expectSettled(second.locator(selector))]);
    await Promise.all([first.waitForTimeout(60), second.waitForTimeout(60)]);
    const [localFrames, opponentFrames] = await Promise.all([recording(first), recording(second)]);
    assertHandDrawn(localFrames, value.trim());
    assertHandDrawn(opponentFrames, value.trim());
    await attachJSON(testInfo, "classic-real-multiplayer-writing.json", { localFrames, opponentFrames });
  } finally {
    await secondContext.close();
    await firstContext.close();
  }
});

test("2v2 writes on the shared opponent sheet while zero and three-digit historical entries remain steady", async ({ page }, testInfo) => {
  const initial = snapshot();
  initial._mode = "2v2";
  initial._players.push({ id: "p3", name: "Clara" }, { id: "p4", name: "David" });
  initial._players_joined = 4;
  initial._expected = 4;
  initial._connected = { p1: true, p2: true, p3: true, p4: true };
  initial._teams = [
    { id: "A", name: "Anna und Clara", members: ["p1", "p3"] },
    { id: "B", name: "Ben und David", members: ["p2", "p4"] },
  ];
  initial._scoreboards = {};
  // Include a three-digit imported/admin value to exercise display geometry,
  // not to claim that a normal single field can legally score 128 points.
  initial._scoreboards_by_team = { A: { "0,down": 3 }, B: { "0,down": 2, "12,free": 0, "13,free": 128 } };
  const server = await fixture(page, { initial });
  await page.evaluate(() => document.fonts.ready);
  const selector = cellSelector("B");
  const cell = page.locator(selector);
  const historic = [page.locator(cellSelector("B", 12)), page.locator(cellSelector("B", 13))];
  for (const entry of historic) {
    await expectSettled(entry);
    await expect(entry.locator(`${SCORE}.is-writing`)).toHaveCount(0);
  }
  await recordFrames(page, selector);
  const next = structuredClone(initial);
  next._scoreboards_by_team.B["14,free"] = 74;
  next._turn = { player_id: "p1", roll_index: 0, first4oak_roll: null };
  next._rolls_used = 0;
  server.push(next);
  await expect(cell).toHaveText("74");
  await expect(page.locator("#rollBtnInline")).toBeEnabled();
  await expectSettled(cell);
  await page.waitForTimeout(60);
  const frames = await recording(page);
  assertHandDrawn(frames, 74);
  await expect(page.locator("td.cell.compute .classic-written-score")).toHaveCount(0);
  for (const entry of historic) await expect(entry.locator(`${SCORE}.is-writing`)).toHaveCount(0);
  await attachJSON(testInfo, "classic-writing-team-frames.json", frames);
  const team = page.locator('.player-card[data-board-id="B"]');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await team.scrollIntoViewIfNeeded();
    const name = `classic-written-team-${viewport.width}x${viewport.height}.png`;
    await testInfo.attach(name, { body: await team.screenshot({ path: testInfo.outputPath(name) }), contentType: "image/png" });
  }
});
