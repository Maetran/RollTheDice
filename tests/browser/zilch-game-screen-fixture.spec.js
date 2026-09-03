const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createUser(page, username, password, role = "user") {
  return page.evaluate(async ({ name, secret, userRole }) => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({ username: name, temporary_password: secret, role: userRole }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { name: username, secret: password, userRole: role });
}

async function signInAsPreviewMani(page) {
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  const mani = await createUser(page, "Mani", "mani-preview-password-123", "admin");
  expect([201, 400]).toContain(mani.status);
  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  await expect(page.locator("[data-game-switch]")).toBeVisible();
}

function board({
  playerId,
  totalPoints,
  roundPoints,
  active = false,
  zilchStreak = 0,
  rounds = [],
  finalRoundTriggeredBy = false,
  finalReplyPending = false,
}) {
  return {
    player_id: playerId,
    connected: true,
    active,
    total_points: totalPoints,
    round_points: roundPoints,
    zilch_streak: zilchStreak,
    rounds,
    final_round_triggered_by: finalRoundTriggeredBy,
    final_reply_pending: finalReplyPending,
  };
}

function baseSnapshot(overrides = {}) {
  return {
    _game_type: "zilch",
    _name: "Tischprobe",
    _players: [
      { id: "p1", name: "Mani", user_id: 2, connected: true },
      { id: "p2", name: "PreviewFriend", user_id: 3, connected: true },
    ],
    _participants: [
      { id: "p1", name: "Mani", type: "human", user_id: 2 },
      { id: "p2", name: "PreviewFriend", type: "human", user_id: 3 },
    ],
    _play_mode: "multiplayer",
    _mode: "2",
    _players_joined: 2,
    _expected: 2,
    _started: true,
    _finished: false,
    _aborted: false,
    _paused: false,
    _offline_players: [],
    _target_score: 10000,
    _zilch_ruleset: "zilch-house-v1",
    _zilch_start_roll: {
      phase: "resolved",
      player_ids: ["p1", "p2"],
      pending_player_ids: [],
      rolls: { p1: 6, p2: 3 },
      winner_id: "p1",
      version: 2,
    },
    _zilch_final_round: { triggered_by: "p2", pending_player_ids: ["p1"] },
    _chat_history: [],
    _gameplay_status: "playable_alpha",
    ...overrides,
  };
}

function fixtureSnapshots() {
  const hotDice = baseSnapshot({
    _turn: { player_id: "p1" },
    _dice: [0, 0, 0, 0, 0, 0],
    _holds: [false, false, false, false, false, false],
    _rolls_used: 2,
    _zilch_boards: {
      p1: board({ playerId: "p1", totalPoints: 8400, roundPoints: 2000, active: true, finalReplyPending: true }),
      p2: board({ playerId: "p2", totalPoints: 10100, roundPoints: 0, finalRoundTriggeredBy: true }),
    },
    _round_points: { p1: 2000, p2: 0 },
    _total_points: { p1: 8400, p2: 10100 },
    _zilch_turn_state: {
      turn_id: 11,
      version: 4,
      phase: "confirmation_roll_required",
      roll_id: 7,
      rolls_used: 2,
      available_dice_indices: [0, 1, 2, 3, 4, 5],
      held_dice_indices: [],
      committed_holds: [{ id: "fixture-hot-dice", points: 2000 }],
      round_points: 2000,
      confirmation_required: true,
      confirmation_reasons: ["hot_dice"],
      can_roll: true,
      can_select_hold: false,
      can_bank: false,
      bank_block_reason: "zilch_confirmation_required",
    },
    _zilch_quick_holds: [],
    _zilch_last_event: { type: "hold", option: { hot_dice: true, points: 2000 } },
  });

  const holdOptions = baseSnapshot({
    _turn: { player_id: "p1" },
    _dice: [1, 1, 1, 5, 2, 6],
    _holds: [false, false, false, false, false, false],
    _rolls_used: 3,
    _zilch_boards: {
      p1: board({ playerId: "p1", totalPoints: 8400, roundPoints: 2000, active: true, finalReplyPending: true }),
      p2: board({ playerId: "p2", totalPoints: 10100, roundPoints: 0, finalRoundTriggeredBy: true }),
    },
    _round_points: { p1: 2000, p2: 0 },
    _total_points: { p1: 8400, p2: 10100 },
    _zilch_turn_state: {
      turn_id: 11,
      version: 5,
      phase: "awaiting_hold",
      roll_id: 8,
      rolls_used: 3,
      available_dice_indices: [0, 1, 2, 3, 4, 5],
      held_dice_indices: [],
      committed_holds: [{ id: "fixture-hot-dice", points: 2000 }],
      round_points: 2000,
      confirmation_required: true,
      confirmation_reasons: ["hot_dice"],
      can_roll: false,
      can_select_hold: true,
      can_bank: false,
      bank_block_reason: "zilch_hold_required",
    },
    _zilch_quick_holds: [
      {
        id: "fixture-three-ones",
        combination_type: "three_ones",
        dice_indices: [0, 1, 2],
        dice_values: [1, 1, 1],
        points: 1000,
        label_key: "zilch.option.three_ones",
        label_params: {},
        roll_id: 8,
        requires_confirmation: true,
        hot_dice: false,
        free_roll: false,
        all_available_dice: false,
        follow_up_actions: ["zilch_roll_dice", "zilch_bank_points"],
      },
      {
        id: "fixture-single-five",
        combination_type: "single_five",
        dice_indices: [3],
        dice_values: [5],
        points: 50,
        label_key: "zilch.option.single_five",
        label_params: { count: 1 },
        roll_id: 8,
        requires_confirmation: false,
        hot_dice: false,
        free_roll: false,
        all_available_dice: false,
        follow_up_actions: ["zilch_roll_dice"],
      },
    ],
    _zilch_last_event: { type: "roll" },
  });

  const heldForConfirmation = baseSnapshot({
    _turn: { player_id: "p1" },
    _dice: [1, 1, 1, 5, 2, 6],
    _holds: [true, true, true, false, false, false],
    _rolls_used: 3,
    _zilch_boards: {
      p1: board({ playerId: "p1", totalPoints: 8400, roundPoints: 3000, active: true, finalReplyPending: true }),
      p2: board({ playerId: "p2", totalPoints: 10100, roundPoints: 0, finalRoundTriggeredBy: true }),
    },
    _round_points: { p1: 3000, p2: 0 },
    _total_points: { p1: 8400, p2: 10100 },
    _zilch_turn_state: {
      turn_id: 11,
      version: 6,
      phase: "confirmation_roll_required",
      roll_id: 8,
      rolls_used: 3,
      available_dice_indices: [3, 4, 5],
      held_dice_indices: [0, 1, 2],
      committed_holds: [{ id: "fixture-three-ones", points: 1000 }],
      round_points: 3000,
      confirmation_required: true,
      confirmation_reasons: ["three_ones"],
      can_roll: true,
      can_select_hold: false,
      can_bank: false,
      bank_block_reason: "zilch_confirmation_required",
    },
    _zilch_quick_holds: [],
    _zilch_last_event: {
      type: "hold",
      option: { id: "fixture-three-ones", requires_confirmation: true, points: 1000 },
    },
  });

  const thirdZilch = baseSnapshot({
    _turn: { player_id: "p2" },
    _dice: [0, 0, 0, 0, 0, 0],
    _holds: [false, false, false, false, false, false],
    _rolls_used: 0,
    _zilch_boards: {
      p1: board({
        playerId: "p1",
        totalPoints: 7900,
        roundPoints: 0,
        zilchStreak: 3,
        finalReplyPending: true,
        rounds: [{ turn_id: 11, round: 5, event: "zilch", penalty: 500, total_after: 7900 }],
      }),
      p2: board({ playerId: "p2", totalPoints: 10100, roundPoints: 0, active: true, finalRoundTriggeredBy: true }),
    },
    _round_points: { p1: 0, p2: 0 },
    _total_points: { p1: 7900, p2: 10100 },
    _zilch_turn_state: {
      turn_id: 12,
      version: 0,
      phase: "ready_to_roll",
      roll_id: 0,
      rolls_used: 0,
      available_dice_indices: [0, 1, 2, 3, 4, 5],
      held_dice_indices: [],
      committed_holds: [],
      round_points: 0,
      confirmation_required: false,
      confirmation_reasons: [],
      can_roll: true,
      can_select_hold: false,
      can_bank: false,
      bank_block_reason: "zilch_bank_minimum_not_reached",
    },
    _zilch_quick_holds: [],
    _zilch_last_event: { type: "zilch", reason: "no_scoring_option", penalty: 500 },
  });

  return { hotDice, holdOptions, heldForConfirmation, thirdZilch };
}

function cpuTurnSnapshot() {
  return baseSnapshot({
    _players: [
      { id: "connection-mani", name: "Mani", user_id: 2, connected: true },
    ],
    _participants: [
      { id: "human-mani", name: "Mani", type: "human", user_id: 2, connection_player_id: "connection-mani" },
      { id: "cpu-river", name: "Tischgeist", type: "cpu", user_id: null, connection_player_id: null, cpu_strategy: "aggressive" },
    ],
    _play_mode: "cpu",
    _turn: { player_id: "cpu-river" },
    _dice: [4, 4, 4, 5, 2, 6],
    _holds: [false, false, false, false, false, false],
    _zilch_boards: {
      "human-mani": board({ playerId: "human-mani", totalPoints: 8200, roundPoints: 0 }),
      "cpu-river": board({ playerId: "cpu-river", totalPoints: 7900, roundPoints: 400, active: true }),
    },
    _zilch_turn_state: {
      turn_id: 19,
      version: 3,
      phase: "awaiting_hold",
      roll_id: 4,
      rolls_used: 2,
      available_dice_indices: [0, 1, 2, 3, 4, 5],
      held_dice_indices: [],
      committed_holds: [],
      round_points: 400,
      confirmation_required: false,
      confirmation_reasons: [],
      can_roll: false,
      can_select_hold: true,
      can_bank: true,
      bank_block_reason: "",
    },
    _zilch_quick_holds: [
      {
        id: "cpu-three-fours",
        combination_type: "three_of_a_kind",
        dice_indices: [0, 1, 2],
        dice_values: [4, 4, 4],
        points: 400,
        label_key: "zilch.option.three_of_a_kind",
        label_params: { face: 4 },
        roll_id: 4,
        requires_confirmation: false,
        hot_dice: false,
        free_roll: false,
        all_available_dice: false,
      },
    ],
    _zilch_last_event: {
      type: "hold",
      actor_participant_id: "cpu-river",
      option: {
        combination_type: "three_of_a_kind",
        points: 400,
        label_key: "zilch.option.three_of_a_kind",
        label_params: { face: 4 },
      },
      cpu_reason_key: "zilch.cpu_reason.hold_high_value",
    },
  });
}

function soloTurnSnapshot() {
  return baseSnapshot({
    _players: [
      { id: "p1", name: "Mani", user_id: 2, connected: true },
    ],
    _participants: [
      { id: "p1", name: "Mani", type: "human", user_id: 2, connection_player_id: "p1" },
    ],
    _play_mode: "solo",
    _mode: "1",
    _players_joined: 1,
    _expected: 1,
    _zilch_start_roll: null,
    _zilch_final_round: null,
    _turn: { player_id: "p1" },
    _dice: [0, 0, 0, 0, 0, 0],
    _holds: [false, false, false, false, false, false],
    _zilch_boards: {
      p1: board({
        playerId: "p1",
        totalPoints: 6500,
        roundPoints: 0,
        active: true,
        rounds: [{ round: 3, event: "bank", points: 900 }],
      }),
    },
    _round_points: { p1: 0 },
    _total_points: { p1: 6500 },
    _zilch_turn_state: {
      turn_id: 41,
      version: 7,
      phase: "ready_to_roll",
      roll_id: 0,
      rolls_used: 0,
      available_dice_indices: [0, 1, 2, 3, 4, 5],
      held_dice_indices: [],
      committed_holds: [],
      round_points: 0,
      confirmation_required: false,
      confirmation_reasons: [],
      can_roll: true,
      can_select_hold: false,
      can_bank: false,
      bank_block_reason: "zilch_bank_minimum_not_reached",
    },
    _zilch_quick_holds: [],
    _zilch_solo_objective: {
      id: "reach_10000_fewest_turns",
      version: 1,
      parameters: {},
      progress: {
        target_score: 10000,
        total_points: 6500,
        turns: 3,
        rolls: 5,
        zilchs: 1,
        hot_dice_events: 1,
        highest_banked_round: 1200,
        active_duration_seconds: 420,
      },
      outcome: null,
    },
    _zilch_solo_metrics: {
      turns: 3,
      rolls: 5,
      zilchs: 1,
      hot_dice_events: 1,
      highest_banked_round: 1200,
      active_duration_seconds: 420,
      remaining_points: 3500,
    },
    _zilch_can_abandon: true,
    _zilch_last_event: { type: "bank", points: 900 },
  });
}

async function installGameScreenFixture(page, gameId, snapshots, detailsOverrides = {}) {
  const details = {
    exists: true,
    game_type: "zilch",
    name: "Tischprobe",
    mode: "2",
    locked: false,
    player_statuses: [],
    ...detailsOverrides,
  };
  await page.addInitScript(({ fixtureGameId, fixtureDetails, fixtureSnapshots }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const rawUrl = typeof input === "string" ? input : input?.url;
      const pathname = new URL(rawUrl || window.location.href, window.location.href).pathname;
      if (pathname === `/api/games/${fixtureGameId}`) {
        return Promise.resolve(new Response(JSON.stringify(fixtureDetails), {
          headers: { "Content-Type": "application/json" },
        }));
      }
      return originalFetch(input, init);
    };

    class FixtureWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = FixtureWebSocket.CONNECTING;
        this._listeners = new Map();
        window.__zilchGameScreenFixtureMessages = [];
        window.setTimeout(() => {
          this.readyState = FixtureWebSocket.OPEN;
          this._emit("open", {});
        }, 0);
      }

      addEventListener(type, callback) {
        const callbacks = this._listeners.get(type) || [];
        callbacks.push(callback);
        this._listeners.set(type, callbacks);
      }

      send(rawMessage) {
        const message = JSON.parse(rawMessage);
        window.__zilchGameScreenFixtureMessages.push(message);
        if (message.action === "join_game" || message.action === "rejoin_game") {
          this._message({ player_id: "p1", resume_token: "fixture-resume" });
          this._message({ scoreboard: fixtureSnapshots.initial || fixtureSnapshots.hotDice });
        } else if (message.action === "zilch_roll_dice") {
          const next = window.__zilchGameScreenFixtureMessages
            .some(item => item.action === "zilch_select_hold")
            ? fixtureSnapshots.thirdZilch
            : fixtureSnapshots.holdOptions;
          this._message({ scoreboard: next, zilch_event: next._zilch_last_event });
        } else if (message.action === "zilch_select_hold") {
          this._message({ scoreboard: fixtureSnapshots.heldForConfirmation, zilch_event: fixtureSnapshots.heldForConfirmation._zilch_last_event });
        }
      }

      close() {
        this.readyState = FixtureWebSocket.CLOSED;
        this._emit("close", {});
      }

      _message(payload) {
        window.setTimeout(() => this._emit("message", { data: JSON.stringify(payload) }), 0);
      }

      _emit(type, event) {
        for (const callback of this._listeners.get(type) || []) callback(event);
      }
    }
    FixtureWebSocket.CONNECTING = 0;
    FixtureWebSocket.OPEN = 1;
    FixtureWebSocket.CLOSING = 2;
    FixtureWebSocket.CLOSED = 3;
    window.WebSocket = FixtureWebSocket;
  }, { fixtureGameId: gameId, fixtureDetails: details, fixtureSnapshots: snapshots });
}

test("the private CPU create controls are keyboard-operable and send only the selected strategy", async ({ browser, baseURL }) => {
  // Service workers intentionally keep authenticated Zilch documents
  // network-only, but a fresh blocked context also makes this request-payload
  // assertion independent from a prior suite's cached shell.
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    await page.goto("/zilch");

    const multiplayer = page.locator("input[name='zilchPlayMode'][value='multiplayer']");
    const cpu = page.locator("input[name='zilchPlayMode'][value='cpu']");
    const strategy = page.locator("#zilchCpuStrategy");
    const conservative = page.locator("input[name='zilchCpuStrategy'][value='conservative']");
    const normal = page.locator("input[name='zilchCpuStrategy'][value='normal']");
    const aggressive = page.locator("input[name='zilchCpuStrategy'][value='aggressive']");

    await expect(multiplayer).toBeChecked();
    await expect(strategy).toBeHidden();

    // Native radio semantics make the game mode and strategy usable without a
    // pointer. This intentionally exercises the browser's real radio-group
    // navigation rather than changing a value through page.evaluate().
    await multiplayer.focus();
    await page.keyboard.press("ArrowDown");
    await expect(cpu).toBeChecked();
    await expect(strategy).toBeVisible();
    await expect(normal).toBeChecked();

    await conservative.focus();
    await page.keyboard.press("ArrowRight");
    await expect(normal).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(aggressive).toBeChecked();

    let createPayload = null;
    await page.route("**/api/games", async route => {
      if (route.request().method() !== "POST") return route.continue();
      createPayload = route.request().postDataJSON();
      // A successful, controlled response verifies the real UI request without
      // adding a test-only backend route or weakening production validation.
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ game_id: "cpu-create-ui-fixture" }),
      });
    });
    await page.route("**/zilch/spiel/cpu-create-ui-fixture", route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>CPU fixture</title>",
    }));

    await Promise.all([
      page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/games"),
      page.locator("#zilchCreateForm button[type='submit']").click(),
    ]);
    expect(createPayload).toMatchObject({
      game_type: "zilch",
      mode: "2",
      play_mode: "cpu",
      cpu_strategy: "aggressive",
    });
    expect(Object.keys(createPayload).filter(key => key.includes("strategy"))).toEqual(["cpu_strategy"]);
  } finally {
    await context.close();
  }
});

test("the solo create controls expose the fixed sprint and send no client objective parameters", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    await page.goto("/zilch");

    const solo = page.locator("input[name='zilchPlayMode'][value='solo']");
    await solo.check();
    await expect(solo).toBeChecked();
    await expect(page.locator("#zilchSoloObjective")).toBeVisible();
    await expect(page.locator("#zilchSoloObjective")).toContainText(/10(?:'|,|’|\s)000/);
    await expect(page.locator("#zilchCpuStrategy")).toBeHidden();
    expect(await page.locator("#zilchGamePassphrase").evaluate(input => input.closest("label")?.hidden)).toBe(true);

    let createPayload = null;
    await page.route("**/api/games", async route => {
      if (route.request().method() !== "POST") return route.continue();
      createPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ game_id: "solo-create-ui-fixture" }),
      });
    });
    await page.route("**/zilch/spiel/solo-create-ui-fixture", route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>Solo fixture</title>",
    }));

    await Promise.all([
      page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/games"),
      page.locator("#zilchCreateForm button[type='submit']").click(),
    ]);
    expect(createPayload).toMatchObject({
      game_type: "zilch",
      mode: "1",
      play_mode: "solo",
    });
    expect(Object.keys(createPayload).filter(key => /objective|strategy|pass/i.test(key))).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a newly created owned solo run is presented as continue, never as a joinable seat", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    await page.route(/\/api\/games(?:\?.*)?$/, async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" || url.searchParams.get("game_type") !== "zilch") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          games: [{
            id: "solo-owned-lobby-fixture",
            game_type: "zilch",
            name: "Mein Sprint",
            mode: "1",
            play_mode: "solo",
            started: false,
            finished: false,
            aborted: false,
            participant_count: 1,
            expected_participants: 1,
            my_solo_host: true,
            participants: [{ id: "p1", name: "Mani", type: "human", user_id: 2, connected: true }],
            solo_objective: {
              id: "reach_10000_fewest_turns",
              version: 1,
              parameters: {},
              progress: { target_score: 10000, total_points: 0, turns: 0, rolls: 0, zilchs: 0, hot_dice_events: 0, highest_banked_round: 0, active_duration_seconds: 0 },
              outcome: null,
              name_key: "zilch.solo_objective.reach_10000_fewest_turns.name",
              description_key: "zilch.solo_objective.reach_10000_fewest_turns.description",
              metrics: { target_score: 10000, total_points: 0, turns: 0, rolls: 0, zilchs: 0, hot_dice_events: 0, highest_banked_round: 0, active_duration_seconds: 0, remaining_points: 10000 },
            },
            solo_metrics: { target_score: 10000, total_points: 0, turns: 0, rolls: 0, zilchs: 0, hot_dice_events: 0, highest_banked_round: 0, active_duration_seconds: 0, remaining_points: 10000 },
          }],
          online_users: 1,
        }),
      });
    });
    await page.route("**/api/zilch/results", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    }));

    await page.goto("/zilch");
    const running = page.locator("#zilchRunningGames");
    await expect(running).toContainText("Mein Sprint");
    await expect(running).toContainText(/Solo-Lauf fortsetzen|Continue solo run/);
    await expect(running.getByRole("link", { name: /Solo-Lauf fortsetzen|Continue solo run/ })).toHaveAttribute("href", "/zilch/spiel/solo-owned-lobby-fixture");
    await expect(running).not.toContainText(/Beitreten|Join/);
    await expect(page.locator("#zilchWaitingGames")).not.toContainText("Mein Sprint");
  } finally {
    await context.close();
  }
});

test("a private solo result renders its one board and metrics without match-only sections", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const resultId = "solo-result-screen-fixture";
    const result = {
      schema_version: 2,
      payload_kind: "zilch_solo_result",
      game_type: "zilch",
      game_id: resultId,
      game_name: "Mein Sprint",
      ruleset: "zilch-house-v1",
      play_mode: "solo",
      mode: "1",
      target_score: 10000,
      started_at: "2026-09-03T10:00:00+00:00",
      finished_at: "2026-09-03T10:08:00+00:00",
      duration_seconds: 480,
      participants: [{ participant_id: "p1", display_name: "Mani", participant_type: "human", user_id: 2 }],
      participant_order: ["p1"],
      boards: {
        p1: {
          participant_id: "p1",
          total_points: 10050,
          round_points: 0,
          zilch_streak: 0,
          rounds: [{ turn_id: 1, round: 1, event: "bank", points: 10050, rolls_used: 5, hot_dice_events: 0 }],
        },
      },
      totals: { p1: 10050 },
      objective: {
        id: "reach_10000_fewest_turns",
        version: 1,
        parameters: {},
        progress: { target_score: 10000, total_points: 10050, turns: 1, rolls: 5, zilchs: 0, hot_dice_events: 0, highest_banked_round: 10050, active_duration_seconds: 420 },
        outcome: "completed",
        ranking: { primary: "turns", tie_breakers: ["rolls", "zilchs", "active_duration_seconds"] },
      },
      outcome: { status: "completed", objective_completed: true },
      metrics: {
        turns: 1,
        rolls: 5,
        zilch_count: 0,
        hot_dice_events: 0,
        hot_dice_events_complete: true,
        highest_banked_round: 10050,
        active_duration_seconds: 420,
        remaining_points: 0,
        zilch_penalties: [],
      },
    };
    await page.route(`**/api/zilch/results/${resultId}`, route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result }),
    }));
    await page.route(`**/zilch/ergebnis/${resultId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));

    await page.goto(`/zilch/ergebnis/${resultId}`);
    await expect(page.locator(".zilch-result-board")).toHaveCount(1);
    await expect(page.locator(".zilch-result-summary")).toContainText(/Solo-Ziel erreicht|Solo objective reached/);
    await expect(page.locator(".zilch-solo-objective")).toContainText(/10(?:'|,|’|\s)000/);
    await expect(page.locator(".zilch-solo-metrics")).toContainText(/(?:Züge|Turns).*1/);
    await expect(page.locator(".zilch-result-start-roll")).toHaveCount(0);
    await expect(page.locator(".zilch-result-final-round")).toHaveCount(0);
    await expect(page.locator(".zilch-result-board")).toContainText("Mani");
  } finally {
    await context.close();
  }
});

test("a CPU participant is rendered from the authoritative participant snapshot without a fake online state", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();

    const gameId = "cpu-screen-fixture";
    await installGameScreenFixture(
      page,
      gameId,
      { initial: cpuTurnSnapshot() },
      { play_mode: "cpu", participants: [
        { id: "human-mani", type: "human", user_id: 2, connection_player_id: "connection-mani" },
        { id: "cpu-river", type: "cpu", user_id: null, connection_player_id: null, cpu_strategy: "aggressive" },
      ] },
    );
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    const cpuBoard = page.locator('[data-zilch-board-id="cpu-river"]');
    await expect(cpuBoard).toContainText("Tischgeist");
    await expect(cpuBoard).toContainText(/CPU/);
    await expect(cpuBoard).toContainText(/Aggressiv|Aggressive/);
    await expect(cpuBoard.locator(".zilch-connection-dot")).toHaveCount(0);
    await expect(page.locator("#zilchLiveStatus")).toContainText(/CPU überlegt|CPU is thinking/);
    await expect(page.locator(".zilch-event")).toContainText(/CPU.*(?:hält|holds).*Drilling|CPU.*(?:hält|holds).*Three/);
    await expect(page.locator(".zilch-quick-hold")).toBeDisabled();
    await expect(page.locator("[data-zilch-roll]")).toBeDisabled();
    await expect(page.locator("[data-zilch-bank]")).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("a server-driven solo snapshot renders one board, objective metrics, and a confirmed abandon action", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();

    const gameId = "solo-screen-fixture";
    await installGameScreenFixture(
      page,
      gameId,
      { initial: soloTurnSnapshot() },
      {
        mode: "1",
        play_mode: "solo",
        participants: [{ id: "p1", type: "human", user_id: 2, connection_player_id: "p1" }],
      },
    );
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    await expect(page.locator("[data-zilch-board-id]")).toHaveCount(1);
    await expect(page.locator('[data-zilch-board-id="p1"]')).toContainText("Mani");
    await expect(page.locator(".zilch-start-roll")).toHaveCount(0);
    await expect(page.locator(".zilch-board--cpu")).toHaveCount(0);
    await expect(page.locator("#zilchChatForm")).toHaveCount(0);
    await expect(page.locator(".zilch-solo-objective")).toContainText(/10(?:'|,|’|\s)000/);
    await expect(page.locator(".zilch-solo-metrics")).toContainText(/(?:Züge|Turns).*3/);
    await expect(page.locator(".zilch-solo-metrics")).toContainText(/(?:Würfe|Rolls).*5/);
    await expect(page.locator("[data-zilch-abandon-solo]")).toBeEnabled();

    await page.evaluate(() => {
      window.ZDWA_UI = { ...(window.ZDWA_UI || {}), confirm: () => Promise.resolve(true) };
    });
    await page.locator("[data-zilch-abandon-solo]").click();
    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "zilch_abandon_solo", turn_id: 41, version: 7, confirmed: true }),
    ]));
  } finally {
    await context.close();
  }
});

test("a controlled server snapshot drives both boards, dice, Quick Holds, and high-risk Zilch states", async ({ browser, baseURL }) => {
  // The client fixture intercepts only a private game's detail request and
  // WebSocket frames. It uses the real protected shell and never adds a test
  // endpoint or a client-side scoring path to production.
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();

    const gameId = "product-screen-fixture";
    await installGameScreenFixture(page, gameId, fixtureSnapshots());
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
    await expect(page.locator("#createGameCard")).toHaveCount(0);
    await expect(page.locator("[data-zilch-board-id]")).toHaveCount(2);
    await expect(page.locator('[data-zilch-board-id="p1"]')).toContainText("Mani");
    await expect(page.locator('[data-zilch-board-id="p2"]')).toContainText("PreviewFriend");
    await expect(page.locator('[data-zilch-board-id="p2"]')).toContainText(/Schlussrunde ausgelöst|Final round triggered/);
    await expect(page.locator('[data-zilch-board-id="p1"]')).toContainText(/Gegenzug offen|Reply pending/);

    const dice = page.locator(".zilch-die");
    await expect(dice).toHaveCount(6);
    await expect(dice.first()).toHaveAttribute("role", "img");
    await expect(dice.first()).toHaveAttribute("aria-label", /(?:Würfel 1: Noch nicht gewürfelt|Die 1: Not rolled yet)/);
    expect(await dice.evaluateAll(nodes => nodes.every(node => !node.hasAttribute("tabindex")))).toBe(true);
    await expect(page.locator(".zilch-event--hot")).toContainText("Hot Dice");
    await expect(page.locator("#zilchLiveStatus")).toContainText("Hot Dice");
    await expect(page.locator("[data-zilch-roll]")).toContainText(/Bestätigungswurf|confirmation/i);
    await expect(page.locator("[data-zilch-bank]")).toBeDisabled();
    await expect(page.locator(".zilch-bank-reason")).toContainText(/Bestätigungswurf mit Punkten|scoring confirmation roll/i);

    await page.locator("[data-zilch-roll]").click();
    await expect(page.locator(".zilch-die")).toHaveCount(6);
    await expect(page.locator(".zilch-die").nth(0)).toHaveAttribute("aria-label", /(?:Würfel 1: zeigt 1|Die 1: shows 1)/);
    await expect(page.locator(".zilch-die--non-scoring")).toHaveCount(2);
    await expect(page.locator(".zilch-quick-hold")).toHaveCount(2);

    const tripleOnes = page.locator('[data-zilch-option="fixture-three-ones"]');
    await expect(tripleOnes).toHaveAccessibleName(/(?:Drilling Einsen|Three ones).*(?:Würfel|Affected dice).*1 \(1\).*2 \(1\).*3 \(1\)/);
    await expect(tripleOnes).toContainText(/1(?:'|,|’|\s)000/);
    await tripleOnes.click();
    await expect(page.locator(".zilch-die--held")).toHaveCount(3);
    await expect(page.locator("[data-zilch-roll]")).toContainText(/Bestätigungswurf|confirmation/i);
    await expect(page.locator("[data-zilch-bank]")).toBeDisabled();
    await expect(page.locator(".zilch-bank-reason")).toContainText(/Bestätigungswurf mit Punkten|scoring confirmation roll/i);
    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "zilch_select_hold",
        turn_id: 11,
        version: 5,
        roll_id: 8,
        option_id: "fixture-three-ones",
        dice_indices: [0, 1, 2],
        points: 1000,
      }),
    ]));

    await page.locator("[data-zilch-roll]").click();
    await expect(page.locator(".zilch-event--zilch")).toContainText(/Dritter Zilch|Third Zilch/);
    await expect(page.locator(".zilch-event--zilch")).toContainText(/500 Punkte Abzug|500-point penalty/);
    await expect(page.locator('[data-zilch-board-id="p1"]')).toContainText(/Zilch.*500/);
    await expect(page.locator('[data-zilch-board-id="p2"]')).toContainText(/Am Zug|Active/);
    await expect(page.locator(".zilch-die")).toHaveCount(6);
  } finally {
    await context.close();
  }
});
