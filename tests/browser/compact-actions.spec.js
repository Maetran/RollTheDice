const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");

const viewports = [
  { width: 320, height: 640 }, { width: 390, height: 844 }, { width: 440, height: 956 },
  { width: 667, height: 375 }, { width: 844, height: 390 },
  { width: 768, height: 1024 }, { width: 1024, height: 1366 }, { width: 1366, height: 1024 },
];

function snapshot(game, started) {
  const players = [{ id: "p1", name: "Anna", connected: true }, ...(started ? [{ id: "p2", name: "Ben", connected: true }] : [])];
  return {
    _game_type: game, _name: "Aktionen am Spieltisch", _mode: "2", _play_mode: "multiplayer",
    _players: players, _participants: players.map(player => ({ ...player, type: "human" })),
    _players_joined: players.length, _expected: 2, _started: started,
    _finished: false, _aborted: false, _paused: false, _offline_players: [],
    _connected: { p1: true, p2: true }, _turn: { player_id: "p1", roll_index: 0 },
    _dice: Array(game === "zilch" ? 6 : 5).fill(0), _holds: Array(game === "zilch" ? 6 : 5).fill(false), _rolls_used: 0, _rolls_max: 3,
    _scoreboards: Object.fromEntries(players.map(player => [player.id, {}])),
    _admin_edits: {}, _superadmin_active: false, _announced_row4: null, _correction: { active: false },
    _teams: [], _results: null, _last_write_public: {}, _has_last: {}, _auto_single: false, _chat_history: [], suggestions: [],
    _target_score: 10000, _zilch_ruleset: "zilch-house-v1", _gameplay_status: "playable",
    _zilch_start_roll: started ? { phase: "resolved", player_ids: ["p1", "p2"], pending_player_ids: [], rolls: { p1: 6, p2: 3 }, winner_id: "p1", version: 2 } : null,
    _zilch_final_round: null, _round_points: { p1: 0, p2: 0 }, _total_points: { p1: 0, p2: 0 },
    _zilch_boards: Object.fromEntries(players.map(player => [player.id, { player_id: player.id, connected: true, active: player.id === "p1", total_points: 0, round_points: 0, zilch_streak: 0, rounds: [] }])),
    _zilch_turn_state: { turn_id: 1, version: 1, phase: "ready_to_roll", roll_id: 0, rolls_used: 0, available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [], round_points: 0, confirmation_required: false, confirmation_reasons: [], can_roll: started, can_select_hold: false, can_bank: false },
    _zilch_quick_holds: [], _zilch_last_event: null,
  };
}

async function expectReadableActions(page, selector) {
  const controls = page.locator(selector);
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const layout = await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const clipped = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const parent = node.parentElement;
        if (!parent.getClientRects().length || parent.getBoundingClientRect().width <= 1) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const textBox of range.getClientRects()) {
          if (textBox.width > 0 && (textBox.left < box.left - 1 || textBox.right > box.right + 1 || textBox.top < box.top - 1 || textBox.bottom > box.bottom + 1)) clipped.push(node.textContent);
        }
      }
      return { width: box.width, height: box.height, right: box.right, left: box.left, clipped };
    });
    expect(layout.clipped, `clipped text in ${await control.getAttribute("id") || await control.textContent()}`).toEqual([]);
    expect(layout.width).toBeGreaterThanOrEqual(44);
    expect(layout.height).toBeGreaterThanOrEqual(44);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(page.viewportSize().width + 1);
  }
}

for (const [game, themes] of [["zdwa", ["light", "dark", "classic"]], ["zilch", ["light", "lcars"]]]) {
  for (const theme of themes) {
    test(`${game} ${theme}: compact game, waiting and join controls remain readable in DE/EN`, async ({ browser, baseURL }, testInfo) => {
      const context = await browser.newContext({ baseURL, viewport: viewports[0], hasTouch: true, isMobile: true, serviceWorkers: "block" });
      try {
        for (const language of ["de", "en"]) {
          const page = await context.newPage();
          await page.addInitScript(({ game, theme, language }) => {
            localStorage.setItem(game === "zilch" ? "zilch_theme" : "wuerfler_theme", theme);
            localStorage.setItem("zdwa_language", language);
          }, { game, theme, language });
          await page.route("**/api/auth/me", route => route.fulfill({ json: {
            authenticated: false, user: null, game_access: { zilch_preview: true, zilch_public: true },
            registration: { turnstile_enabled: false, email_enabled: false }, passkeys: { enabled: false },
          } }));
          const gameId = `compact-actions-${game}-${language}`;
          let started = false;
          let socket;
          const roomPath = `${game === "zilch" ? "/zilch" : ""}/spiel/${gameId}`;
          const html = await fs.readFile(`app/static/${game === "zilch" ? "zilch" : "room"}.html`, "utf8");
          await page.route(`**${roomPath}*`, route => route.fulfill({ contentType: "text/html", body: html }));
          await page.route(`**/api/games/${gameId}*`, route => route.fulfill({ json: {
            exists: true, game_type: game, name: "Aktionen am Spieltisch", mode: "2", play_mode: "multiplayer", player_statuses: [], locked: false,
          } }));
          await page.routeWebSocket(new RegExp(`/ws/${gameId}$`), connected => {
            socket = connected;
            connected.onMessage(raw => {
              if (["join_game", "rejoin_game"].includes(JSON.parse(String(raw)).action)) connected.send(JSON.stringify({ player_id: "p1", scoreboard: snapshot(game, started) }));
            });
          });
          await page.goto(`${roomPath}?name=Anna`);
          await expect(page.locator(game === "zilch" ? ".zilch-die" : "#diceBar .die")).toHaveCount(game === "zilch" ? 6 : 5);
          for (const active of [false, true]) {
            started = active;
            socket.send(JSON.stringify({ scoreboard: snapshot(game, started) }));
            for (const viewport of viewports) {
              await page.setViewportSize(viewport);
              if (game === "zilch") {
                await expect(page.locator("#zilchLeaveGameBtn > [aria-hidden='true']")).toBeVisible();
                await expectReadableActions(page, ".zilch-header-tools :is(button, a)");
                await expect(page.locator("#zilchShareGameBtn .zilch-control-label")).toBeVisible();
                await expect(page.locator("#zilchRoomRules .zilch-control-label")).toBeVisible();
              } else {
                await expectReadableActions(page, "#roomHeaderMenuToggle, #backToLobbyBtn");
                await page.locator("#roomHeaderMenuToggle").click();
                await expectReadableActions(page, "#roomHeaderMenuPanel > button");
                await page.locator("#roomHeaderMenuToggle").click();
              }
            }
          }
          await page.setViewportSize(viewports[0]);
          await page.screenshot({ path: testInfo.outputPath(`${game}-${theme}-${language}-game.png`) });
          // Open each product's real protected-game join flow, not a synthetic dialog.
          const locked = { id: `${gameId}-locked`, exists: true, game_type: game, name: "Privater Spieltisch", mode: "2", players: 1, expected: 2, play_mode: "multiplayer", locked: true, player_statuses: [] };
          await page.route(`**/api/games/${locked.id}*`, route => route.fulfill({ json: locked }));
          if (game === "zilch") {
            await page.route(`**/zilch/spiel/${locked.id}`, route => route.fulfill({ contentType: "text/html", body: html }));
            await page.goto(`/zilch/spiel/${locked.id}`);
          } else {
            await page.route("**/api/games", route => route.fulfill({ json: { games: [locked], online_users: 1 } }));
            await page.goto("/");
            await page.locator(`.joinBtn[data-id='${locked.id}']`).click();
          }
          await expect(page.locator("#appDialogClose")).toBeVisible();
          for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            await expectReadableActions(page, "#appDialogClose, .app-dialog-actions > button");
          }
          await page.setViewportSize(viewports[0]);
          await page.screenshot({ path: testInfo.outputPath(`${game}-${theme}-${language}-join.png`) });
          await page.locator("#appDialogClose").click();
          await expect(page.locator("#appDialogClose")).toBeHidden();
          await page.close();
        }
      } finally { await context.close(); }
    });
  }
}
