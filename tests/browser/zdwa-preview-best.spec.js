const { test, expect } = require("@playwright/test");

// The 2026 score sheet highlights the field the server flags as worth writing
// now (`best` in field_previews), not the preview with the most points. Without
// a flag the player is better off rolling on and nothing is highlighted.
test.use({ serviceWorkers: "block" });

const cell = (row, field) => `.player-card.me td.cell[data-row="${row}"][data-field="${field}"]`;

// Live 2.51.0: 2,4,2,1,2 on an empty sheet. Roll 1 previews every free and ❗
// field plus the first Abwärts and Aufwärts cells; + is the raw maximum (11).
function previews() {
  const points = { 0: 1, 1: 6, 2: 0, 3: 4, 4: 0, 5: 0, 9: 11, 10: 11, 12: 0, 13: 0, 14: 0, 15: 0 };
  const list = [{ row: 0, col: "down", points: 1 }, { row: 15, col: "up", points: 0 }];
  for (const col of ["free", "ang"]) {
    for (const [row, value] of Object.entries(points)) list.push({ row: Number(row), col, points: value });
  }
  return list;
}

function snapshot() {
  return {
    _name: "Vorschlag", _mode: "2", _hardcore: false,
    _players: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Ben" }],
    _players_joined: 2, _expected: 2, _started: true, _finished: false, _aborted: false,
    _paused: false, _offline_players: [], _connected: { p1: true, p2: true },
    _turn: { player_id: "p1", roll_index: 1, first4oak_roll: null }, _dice: [2, 4, 2, 1, 2],
    _holds: [false, false, false, false, false], _rolls_used: 1, _rolls_max: 3,
    _scoreboards: { p1: {}, p2: {} }, _admin_edits: {}, _superadmin_active: false,
    _announced_row4: null, _announced_by: null, _announced_board: null,
    _correction: { active: false }, _teams: [], _scoreboards_by_team: {},
    _results: null, _last_write_public: {}, _has_last: {}, _auto_single: false,
    _chat_history: [], suggestions: [], field_previews: previews(),
  };
}

async function fixture(page) {
  const state = snapshot();
  let socket;
  await page.routeWebSocket(/\/ws\/preview-best-fixture$/, route => {
    socket = route;
    route.onMessage(raw => {
      const action = JSON.parse(String(raw));
      if (["join_game", "rejoin_game"].includes(action.action)) {
        route.send(JSON.stringify({ player_id: "p1", resume_token: "preview-best-fixture" }));
        route.send(JSON.stringify({ scoreboard: state }));
      }
    });
  });
  await page.goto("/spiel/preview-best-fixture?name=Anna");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  await expect(page.locator(".player-card.me td.cell[data-preview-points]").first()).toBeVisible();
  return { state, push() { socket.send(JSON.stringify({ scoreboard: state })); } };
}

test("the sheet highlights the server's pick, not the most points, and nothing while rolling on pays", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 900 });
  const room = await fixture(page);

  // Roll 1 of 3: no flag, so no highlight, even though + would score 11.
  await expect(page.locator(cell(9, "free"))).toHaveAttribute("data-preview-points", "11");
  await expect(page.locator(".player-card.me td.cell[data-preview-best]")).toHaveCount(0);

  // Last roll: the server flags the 2s in the free column (6 points).
  room.state._rolls_used = 3;
  room.state._turn.roll_index = 3;
  room.state.field_previews = previews()
    .filter(preview => preview.col !== "ang")
    .map(preview => (preview.row === 1 && preview.col === "free" ? { ...preview, best: true } : preview));
  room.push();

  await expect(page.locator(".player-card.me td.cell[data-preview-best]")).toHaveCount(1);
  const best = page.locator(cell(1, "free"));
  await expect(best).toHaveAttribute("data-preview-best", "");
  await expect(best).toHaveAttribute("data-preview-points", "6");
  await expect(page.locator(cell(9, "free"))).not.toHaveAttribute("data-preview-best", /.*/);
  const ring = await best.evaluate(element => getComputedStyle(element).boxShadow);
  expect(ring).toContain("inset");
  expect(await page.locator(cell(9, "free")).evaluate(element => getComputedStyle(element).boxShadow)).not.toBe(ring);

  // A recommended scratch keeps its 0 at full strength; other 0s stay dimmed.
  room.state.field_previews = previews()
    .filter(preview => preview.col !== "ang")
    .map(preview => (preview.row === 15 && preview.col === "up" ? { ...preview, best: true } : preview));
  room.push();
  const scratch = page.locator(cell(15, "up"));
  await expect(scratch).toHaveAttribute("data-preview-best", "");
  const numberOpacity = locator => locator.evaluate(element => getComputedStyle(element, "::after").opacity);
  expect(await numberOpacity(scratch)).toBe("1");
  expect(await numberOpacity(page.locator(cell(15, "free")))).toBe("0.5");

  // A correction never highlights.
  room.state._correction = { active: true, player_id: "p1", dice: [2, 4, 2, 1, 2] };
  room.push();
  await expect(page.locator(".player-card.me td.cell[data-preview-best]")).toHaveCount(0);
});
