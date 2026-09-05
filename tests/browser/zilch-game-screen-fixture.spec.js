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
    _gameplay_status: "playable",
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
        follow_up_actions: ["zilch_roll_dice"],
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
    _zilch_last_event: {
      type: "zilch",
      reason: "no_scoring_option",
      player_id: "p1",
      penalty: 500,
      rolled_dice: [1, 1, 1, 2, 3, 4],
      held_dice_indices: [0, 1, 2],
    },
  });

  return { hotDice, holdOptions, heldForConfirmation, thirdZilch };
}

function hotDiceChoiceSnapshot() {
  return baseSnapshot({
    _turn: { player_id: "p1" },
    _dice: [1, 2, 3, 4, 5, 6],
    _holds: [false, false, false, false, false, false],
    _rolls_used: 2,
    _zilch_boards: {
      p1: board({ playerId: "p1", totalPoints: 4200, roundPoints: 0, active: true }),
      p2: board({ playerId: "p2", totalPoints: 3600, roundPoints: 0 }),
    },
    _round_points: { p1: 0, p2: 0 },
    _total_points: { p1: 4200, p2: 3600 },
    _zilch_turn_state: {
      turn_id: 17,
      version: 8,
      phase: "awaiting_hold",
      roll_id: 12,
      rolls_used: 2,
      available_dice_indices: [0, 1, 2, 3, 4, 5],
      held_dice_indices: [],
      committed_holds: [],
      round_points: 0,
      confirmation_required: false,
      confirmation_reasons: [],
      can_roll: false,
      can_select_hold: true,
      can_bank: false,
      bank_block_reason: "zilch_hold_required",
    },
    _zilch_quick_holds: [
      {
        id: "fixture-hot-straight",
        combination_type: "straight",
        dice_indices: [0, 1, 2, 3, 4, 5],
        dice_values: [1, 2, 3, 4, 5, 6],
        points: 2000,
        label_key: "zilch.option.straight",
        label_params: {},
        roll_id: 12,
        requires_confirmation: true,
        hot_dice: true,
        free_roll: true,
        all_available_dice: true,
        follow_up_actions: ["zilch_roll_dice"],
      },
      {
        id: "fixture-single-one-hot-compatible",
        combination_type: "single_one",
        dice_indices: [0],
        dice_values: [1],
        points: 100,
        label_key: "zilch.option.single_one",
        label_params: { count: 1 },
        roll_id: 12,
        requires_confirmation: false,
        hot_dice: false,
        free_roll: false,
        all_available_dice: false,
        follow_up_actions: ["zilch_roll_dice"],
      },
    ],
    _zilch_last_event: { type: "roll" },
  });
}

function equalScoreRecommendationSnapshot() {
  const option = ({
    id,
    combinationType,
    diceIndices,
    diceValues,
    points,
    labelKey,
    labelParams = {},
  }) => ({
    id,
    combination_type: combinationType,
    components: [],
    dice_indices: diceIndices,
    dice_values: diceValues,
    points,
    label_key: labelKey,
    label_params: labelParams,
    roll_id: 22,
    requires_confirmation: false,
    confirmation_reasons: [],
    hot_dice: false,
    free_roll: false,
    all_available_dice: false,
    follow_up_actions: ["zilch_roll_dice", "zilch_bank_points"],
  });
  return baseSnapshot({
    _turn: { player_id: "p1" },
    _dice: [6, 5, 4, 4, 5, 1],
    _holds: [false, false, false, false, false, false],
    _rolls_used: 2,
    _zilch_boards: {
      p1: board({ playerId: "p1", totalPoints: 4200, roundPoints: 400, active: true }),
      p2: board({ playerId: "p2", totalPoints: 3600, roundPoints: 0 }),
    },
    _round_points: { p1: 400, p2: 0 },
    _total_points: { p1: 4200, p2: 3600 },
    _zilch_turn_state: {
      turn_id: 27,
      version: 9,
      phase: "awaiting_hold",
      roll_id: 22,
      rolls_used: 2,
      available_dice_indices: [0, 1, 2, 3, 4, 5],
      held_dice_indices: [],
      committed_holds: [{ id: "previous-hold", points: 400 }],
      round_points: 400,
      confirmation_required: false,
      confirmation_reasons: [],
      can_roll: false,
      can_select_hold: true,
      can_bank: false,
      bank_block_reason: "zilch_hold_required",
    },
    _zilch_quick_holds: [
      option({
        id: "fixture-one-two-fives",
        combinationType: "combined",
        diceIndices: [1, 4, 5],
        diceValues: [5, 5, 1],
        points: 200,
        labelKey: "zilch.option.combined",
        labelParams: { component_count: 3 },
      }),
      option({
        id: "fixture-one-one-five",
        combinationType: "combined",
        diceIndices: [1, 5],
        diceValues: [5, 1],
        points: 150,
        labelKey: "zilch.option.combined",
        labelParams: { component_count: 2 },
      }),
      // The second physical five produces the same visible 1+5 choice and
      // must therefore be deduplicated, while 1 and 5+5 remain distinct 100s.
      option({
        id: "fixture-one-one-five-duplicate",
        combinationType: "combined",
        diceIndices: [4, 5],
        diceValues: [5, 1],
        points: 150,
        labelKey: "zilch.option.combined",
        labelParams: { component_count: 2 },
      }),
      option({
        id: "fixture-two-fives",
        combinationType: "combined",
        diceIndices: [1, 4],
        diceValues: [5, 5],
        points: 100,
        labelKey: "zilch.option.combined",
        labelParams: { component_count: 2 },
      }),
      option({
        id: "fixture-single-one",
        combinationType: "single_one",
        diceIndices: [5],
        diceValues: [1],
        points: 100,
        labelKey: "zilch.option.single_one",
        labelParams: { count: 1, face: 1 },
      }),
      option({
        id: "fixture-single-five",
        combinationType: "single_five",
        diceIndices: [1],
        diceValues: [5],
        points: 50,
        labelKey: "zilch.option.single_five",
        labelParams: { count: 1, face: 5 },
      }),
      option({
        id: "fixture-single-five-duplicate",
        combinationType: "single_five",
        diceIndices: [4],
        diceValues: [5],
        points: 50,
        labelKey: "zilch.option.single_five",
        labelParams: { count: 1, face: 5 },
      }),
    ],
    _zilch_last_event: { type: "roll" },
  });
}

function openingRollShortcutSnapshot() {
  const snapshot = baseSnapshot({
    _turn: { player_id: "p1" },
    _dice: [0, 0, 0, 0, 0, 0],
    _zilch_start_roll: {
      phase: "awaiting_rolls",
      player_ids: ["p1", "p2"],
      pending_player_ids: ["p1", "p2"],
      rolls: {},
      winner_id: null,
      version: 3,
    },
    _zilch_turn_state: {
      turn_id: 1,
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
  });
  return snapshot;
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
        const socketPath = new URL(url, window.location.href).pathname;
        if (socketPath === `/ws/${encodeURIComponent(fixtureGameId)}`) {
          // Deterministic server-frame seam for presentation-only assertions.
          // It does not bypass any production endpoint or expose state outside
          // this isolated browser context.
          window.__zilchGameScreenFixturePush = payload => {
            this._emit("message", { data: JSON.stringify(payload) });
          };
        }
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
          const next = message.option_id
            ? (fixtureSnapshots.thirdZilch || fixtureSnapshots.heldForConfirmation || fixtureSnapshots.initial)
            : (fixtureSnapshots.holdOptions || fixtureSnapshots.initial);
          this._message({ scoreboard: next, zilch_event: next._zilch_last_event });
        } else if (message.action === "zilch_select_hold") {
          this._message({ scoreboard: fixtureSnapshots.heldForConfirmation, zilch_event: fixtureSnapshots.heldForConfirmation._zilch_last_event });
        } else if (message.action === "send_emoji") {
          // The social transport echoes reactions to the sender as well as to
          // the opponent. This is intentionally different from text chat.
          this._message({ emoji: {
            from_id: "p1",
            from: "Mani",
            emoji: message.emoji,
            ts: "2026-09-04T12:00:00+00:00",
          } });
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

test("the private CPU create selects send only the selected strategy", async ({ browser, baseURL }) => {
  // Service workers intentionally keep authenticated Zilch documents
  // network-only, but a fresh blocked context also makes this request-payload
  // assertion independent from a prior suite's cached shell.
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    await page.goto("/zilch");

    const solo = page.locator("[data-zilch-play-mode='solo']");
    const cpu = page.locator("[data-zilch-play-mode='cpu']");
    const strategy = page.locator("#zilchCpuStrategy");
    const strategySelect = page.locator("#zilchCpuStrategySelect");

    await expect(solo).toHaveAttribute("aria-checked", "true");
    expect(await page.locator("[data-zilch-play-mode]").evaluateAll(nodes => nodes.map(node => node.dataset.zilchPlayMode))).toEqual(["solo", "multiplayer", "cpu"]);
    await expect(strategy).toBeHidden();

    await cpu.click();
    await expect(cpu).toHaveAttribute("aria-checked", "true");
    await expect(strategy).toBeVisible();
    await expect(strategySelect).toHaveValue("normal");
    await strategySelect.selectOption("aggressive");
    await expect(strategySelect).toHaveValue("aggressive");

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

    const solo = page.locator("[data-zilch-play-mode='solo']");
    await solo.click();
    await expect(solo).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#zilchSoloObjective")).toBeVisible();
    await expect(page.locator("#zilchSoloObjective")).toContainText(/10(?:'|,|’|\s)000/);
    await expect(page.locator("#zilchCpuStrategy")).toBeHidden();
    await expect(page.locator(".zilch-create-options")).toBeHidden();

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
    await expect(running).toContainText(/Solo-Sprint|Solo sprint/);
    await expect(running).toContainText(/Solo-Lauf fortsetzen|Continue solo run/);
    await expect(running.getByRole("link", { name: /Solo-Lauf fortsetzen|Continue solo run/ })).toHaveAttribute("href", "/zilch/spiel/solo-owned-lobby-fixture");
    await expect(running).not.toContainText(/Beitreten|Join/);
    await expect(page.locator("#zilchWaitingGames")).not.toContainText("Mein Sprint");
  } finally {
    await context.close();
  }
});

test("a private solo result keeps the objective compact and the score sheet in focus", async ({ browser, baseURL }) => {
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
    await expect(page.locator(".zilch-result-summary")).toContainText(/10(?:'|,|’|\s)000/);
    // The result still identifies the sprint, but does not repeat the target,
    // progress and telemetry in a second card beside the actual score sheet.
    await expect(page.locator(".zilch-solo-objective, .zilch-solo-metrics")).toHaveCount(0);
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
    await expect(cpuBoard.locator(".zilch-connection-dot")).toHaveCount(0);
    await expect(page.locator("#zilchLiveStatus")).toContainText(/CPU überlegt|CPU is thinking/);
    await expect(page.locator(".zilch-event")).toHaveCount(0);
    await expect(page.locator("[data-zilch-commit-hold]")).toHaveCount(0);
    await expect(page.locator("[data-zilch-roll]")).toBeDisabled();
    await expect(page.locator("[data-zilch-bank]")).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("a Zilch roll remains visible for 500 ms before the overlay and turn handoff", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-09-04T12:00:00Z") });
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const snapshots = fixtureSnapshots();
    const gameId = "zilch-roll-reveal-fixture";
    await installGameScreenFixture(page, gameId, { initial: snapshots.heldForConfirmation });
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-active/);
    await expect.poll(() => page.evaluate(() => typeof window.__zilchGameScreenFixturePush)).toBe("function");
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

    await page.evaluate(zilchSnapshot => {
      window.__zilchGameScreenFixturePush({
        scoreboard: zilchSnapshot,
        zilch_event: zilchSnapshot._zilch_last_event,
      });
    }, snapshots.thirdZilch);

    const visibleFaces = () => page.locator(".zilch-die__pips").evaluateAll(groups => (
      groups.map(group => group.querySelectorAll("circle").length)
    ));
    const overlay = page.locator("[data-zilch-event-overlay]");
    await expect(page.locator(".zilch-dice")).toHaveClass(/is-landing/);
    expect(await visibleFaces()).toEqual([1, 1, 1, 2, 3, 4]);
    await expect(page.locator(".zilch-die--held")).toHaveCount(3);
    await expect(overlay).toBeHidden();
    await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-zilch-board-id="p2"]')).toHaveClass(/is-inactive/);

    await page.clock.runFor(499);
    expect(await visibleFaces()).toEqual([1, 1, 1, 2, 3, 4]);
    await expect(overlay).toBeHidden();
    await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-active/);

    await page.clock.runFor(1);
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("ZILCH!");
    await expect(overlay).toContainText("−500");
    await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-active/);

    await page.clock.runFor(1_351);
    await expect(overlay).toBeHidden();
    await expect(page.locator('[data-zilch-board-id="p2"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-inactive/);
  } finally {
    await context.close();
  }
});

test("an incoming CPU roll lands visibly without a local roll action", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const cpuRoll = cpuTurnSnapshot();
    const cpuRollEvent = {
      type: "roll",
      player_id: "cpu-river",
      actor_participant_id: "cpu-river",
      turn_id: 19,
      roll_id: 4,
      cpu_reason_key: "zilch.cpu_reason.roll_for_target",
    };
    cpuRoll._zilch_last_event = cpuRollEvent;
    const cpuReady = {
      ...cpuRoll,
      _dice: [0, 0, 0, 0, 0, 0],
      _zilch_turn_state: {
        ...cpuRoll._zilch_turn_state,
        version: 2,
        phase: "ready_to_roll",
        roll_id: 3,
        rolls_used: 1,
        can_roll: true,
        can_select_hold: false,
        can_bank: false,
      },
      _zilch_quick_holds: [],
      _zilch_last_event: {
        type: "cpu_thinking",
        actor_participant_id: "cpu-river",
      },
    };
    const gameId = "cpu-roll-landing-fixture";
    await installGameScreenFixture(
      page,
      gameId,
      { initial: cpuReady },
      { play_mode: "cpu", participants: cpuReady._participants },
    );
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    await expect.poll(() => page.evaluate(() => typeof window.__zilchGameScreenFixturePush)).toBe("function");
    await expect(page.locator(".zilch-dice")).not.toHaveClass(/is-landing/);
    expect(await page.evaluate(() => window.__zilchGameScreenFixtureMessages.some(
      message => message.action === "zilch_roll_dice",
    ))).toBe(false);

    await page.evaluate(({ scoreboard, event }) => {
      window.__zilchGameScreenFixturePush({ scoreboard, zilch_event: event });
    }, { scoreboard: cpuRoll, event: cpuRollEvent });

    await expect(page.locator(".zilch-dice")).toHaveClass(/is-landing/);
    expect(await page.locator(".zilch-die__pips").evaluateAll(groups => (
      groups.map(group => group.querySelectorAll("circle").length)
    ))).toEqual([4, 4, 4, 5, 2, 6]);
    expect(await page.evaluate(() => window.__zilchGameScreenFixtureMessages.some(
      message => message.action === "zilch_roll_dice",
    ))).toBe(false);
  } finally {
    await context.close();
  }
});

test("a finished Zilch game starts the same mode again with one click", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const gameId = "finished-restart-fixture";
    const finished = baseSnapshot({
      _finished: true,
      _turn: null,
      _zilch_outcome: { tied: false, winner_ids: ["p1"] },
      _zilch_boards: {
        p1: board({ playerId: "p1", totalPoints: 10400, roundPoints: 0 }),
        p2: board({ playerId: "p2", totalPoints: 9300, roundPoints: 0 }),
      },
      _zilch_turn_state: null,
      _zilch_quick_holds: [],
    });
    await installGameScreenFixture(page, gameId, { initial: finished }, { play_mode: "multiplayer" });
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));

    let createPayload = null;
    await page.route("**/api/games", async route => {
      if (route.request().method() !== "POST") return route.continue();
      createPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ game_id: "restarted-ui-fixture" }),
      });
    });
    await page.route("**/zilch/spiel/restarted-ui-fixture", route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>Restart fixture</title>",
    }));

    await page.goto(`/zilch/spiel/${gameId}`);
    const restart = page.locator("[data-zilch-new-round]");
    await expect(restart).toBeVisible();
    await Promise.all([
      page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/games"),
      restart.click(),
    ]);
    expect(createPayload).toMatchObject({
      name: "Tischprobe",
      game_type: "zilch",
      mode: "2",
      play_mode: "multiplayer",
    });
  } finally {
    await context.close();
  }
});

test("an abandoned solo run keeps score and result balanced with clear actions", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const gameId = "abandoned-solo-layout-fixture";
    const finished = baseSnapshot({
      _players: [{ id: "p1", name: "Mani", user_id: 2, connected: true }],
      _participants: [{ id: "p1", name: "Mani", type: "human", user_id: 2 }],
      _play_mode: "solo",
      _mode: "1",
      _turn: null,
      _finished: true,
      _zilch_outcome: { status: "abandoned", tied: false, winner_ids: [] },
      _zilch_result: {
        game_id: gameId,
        route: `/zilch/ergebnis/${gameId}`,
        result_url: `/zilch/ergebnis/${gameId}`,
      },
      _zilch_boards: {
        p1: board({
          playerId: "p1",
          totalPoints: 1800,
          roundPoints: 0,
          rounds: [
            { round: 1, event: "bank", points: 1000, total_points: 1000 },
            { round: 2, event: "bank", points: 800, total_points: 1800 },
          ],
        }),
      },
      _round_points: { p1: 0 },
      _total_points: { p1: 1800 },
      _zilch_turn_state: null,
      // A stale server payload must not put scoring choices above the result.
      _zilch_quick_holds: [{ id: "stale-finished-option", points: 100 }],
      _zilch_can_abandon: false,
    });
    await installGameScreenFixture(page, gameId, { initial: finished }, {
      mode: "1",
      play_mode: "solo",
      participants: [{ id: "p1", name: "Mani", type: "human", user_id: 2 }],
    });
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));

    const currentAward = {
      key: "zilch.first_game",
      source_game_id: gameId,
      category: "entry",
      icon_key: "dice",
      title_key: "zilch.achievement.first_game.title",
      description_key: "zilch.achievement.first_game.description",
      unlocked_at: "2026-09-04T12:00:00+00:00",
      queued_at: "2026-09-04T12:00:00+00:00",
    };
    const olderAward = {
      key: "zilch.banked_round_500",
      source_game_id: "older-zilch-game",
      category: "scoring",
      icon_key: "star",
      title_key: "zilch.achievement.banked_round_500.title",
      description_key: "zilch.achievement.banked_round_500.description",
      unlocked_at: "2026-09-03T12:00:00+00:00",
      queued_at: "2026-09-03T12:00:00+00:00",
    };
    const currentCommunityAward = {
      key: "zilch.community_games_100",
      source_game_id: null,
      presentation_game_id: gameId,
      source_kind: "community",
      category: "community",
      icon_key: "star",
      title_key: "zilch.achievement.community_games_100.title",
      description_key: "zilch.achievement.community_games_100.description",
      points: 0,
      unlocked_at: "2026-09-04T12:00:01+00:00",
      queued_at: "2026-09-04T12:00:01+00:00",
    };
    const unrelatedCommunityAward = {
      key: "zilch.community_games_500",
      source_game_id: null,
      presentation_game_id: null,
      source_kind: "community",
      category: "community",
      icon_key: "star",
      title_key: "zilch.achievement.community_games_500.title",
      description_key: "zilch.achievement.community_games_500.description",
      points: 0,
      unlocked_at: "2026-09-03T12:00:01+00:00",
      queued_at: "2026-09-03T12:00:01+00:00",
    };
    const acknowledgements = [];
    let pendingAwards = [olderAward, unrelatedCommunityAward, currentAward, currentCommunityAward];
    await page.route("**/api/zilch/achievements**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/zilch/achievements/pending") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ version: 1, awards: pendingAwards }),
        });
        return;
      }
      if (request.method() === "POST" && /\/acknowledge$/.test(url.pathname)) {
        const key = decodeURIComponent(url.pathname.split("/").at(-2));
        acknowledgements.push(key);
        pendingAwards = pendingAwards.filter(award => award.key !== key);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, acknowledged_at: "2026-09-04T12:01:00+00:00" }),
        });
        return;
      }
      if (url.pathname === "/api/zilch/achievements") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            version: 2,
            categories: [],
            unlocked: [olderAward, unrelatedCommunityAward, currentAward, currentCommunityAward],
            locked: [],
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`/zilch/spiel/${gameId}`);

    const result = page.locator(".zilch-final-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText(/Solo-Lauf aufgegeben|Solo run abandoned/);
    const finalAwards = page.locator(".zilch-final-awards");
    await expect(finalAwards).toContainText(/In dieser Partie erreicht|Earned in this game/);
    await expect(finalAwards.locator(".zilch-final-award")).toHaveCount(2);
    await expect(finalAwards).toContainText(/Erster Wurf|First Roll/);
    await expect(finalAwards).toContainText(/Die ersten Hundert|The First Hundred/);
    await expect(finalAwards).not.toContainText(/Erste sichere Runde|First Safe Round/);
    await expect(finalAwards).not.toContainText(/Das Wirtshaus füllt sich|The House Is Filling Up/);
    await expect(page.locator("#appDialog")).toContainText(/Erster Wurf|First Roll/);
    await page.getByRole("button", { name: /Weiter|Continue/ }).click();
    await expect(page.locator("#appDialog")).toContainText(/Die ersten Hundert|The First Hundred/);
    await page.getByRole("button", { name: /Weiter|Continue/ }).click();
    await expect.poll(() => acknowledgements).toEqual([
      "zilch.first_game",
      "zilch.community_games_100",
    ]);
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();
    await expect(page.locator(".zilch-recommendation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Neue Runde|New round/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Ergebnis ansehen|View result/ })).toHaveAttribute(
      "href",
      `/zilch/ergebnis/${gameId}`,
    );
    await expect(page.locator(".zilch-final-actions").getByRole("link", { name: /Zur Zilch-Lobby|Back to Zilch lobby/ })).toHaveAttribute("href", "/zilch");

    const geometry = await page.evaluate(() => {
      const compactRect = element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const notebook = compactRect(document.querySelector(".zilch-play-layout__notebook"));
      const resultCard = compactRect(document.querySelector(".zilch-final-result"));
      const actionBoxes = [...document.querySelectorAll(".zilch-final-actions > *")]
        .map(compactRect);
      const die = compactRect(document.querySelector(".zilch-die"));
      const title = document.querySelector(".zilch-final-result h2");
      return {
        notebook,
        resultCard,
        actionBoxes,
        die,
        titleFits: title.scrollWidth <= title.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(Math.abs(geometry.notebook.height - geometry.resultCard.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.notebook.width - geometry.resultCard.width)).toBeLessThanOrEqual(1);
    expect(geometry.resultCard.x).toBeGreaterThan(geometry.notebook.x);
    expect(geometry.titleFits).toBe(true);
    expect(geometry.actionBoxes).toHaveLength(3);
    expect(geometry.actionBoxes.every(box => Math.abs(box.width - geometry.actionBoxes[0].width) <= 1)).toBe(true);
    expect(geometry.actionBoxes[1].y).toBeGreaterThanOrEqual(geometry.actionBoxes[0].y + geometry.actionBoxes[0].height);
    expect(geometry.actionBoxes[2].y).toBeGreaterThanOrEqual(geometry.actionBoxes[1].y + geometry.actionBoxes[1].height);
    expect(Math.abs(geometry.die.width - geometry.die.height)).toBeLessThanOrEqual(1);
    expect(geometry.die.width).toBeGreaterThan(54);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    await page.setViewportSize({ width: 320, height: 800 });
    const narrowGeometry = await page.evaluate(() => {
      const notebook = document.querySelector(".zilch-play-layout__notebook").getBoundingClientRect();
      const resultCard = document.querySelector(".zilch-final-result").getBoundingClientRect();
      const title = document.querySelector(".zilch-final-result h2");
      const actions = [...document.querySelectorAll(".zilch-final-actions > *")]
        .map(element => element.getBoundingClientRect());
      const die = document.querySelector(".zilch-die").getBoundingClientRect();
      return {
        notebookWidth: notebook.width,
        notebookHeight: notebook.height,
        resultWidth: resultCard.width,
        resultHeight: resultCard.height,
        titleFits: title.scrollWidth <= title.clientWidth,
        actionsStack: actions.every((box, index) => index === 0 || box.y >= actions[index - 1].bottom),
        squareDie: Math.abs(die.width - die.height) <= 1,
        dieWidth: die.width,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(Math.abs(narrowGeometry.notebookHeight - narrowGeometry.resultHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(narrowGeometry.notebookWidth - narrowGeometry.resultWidth)).toBeLessThanOrEqual(1);
    expect(narrowGeometry.titleFits).toBe(true);
    expect(narrowGeometry.actionsStack).toBe(true);
    expect(narrowGeometry.squareDie).toBe(true);
    expect(narrowGeometry.dieWidth).toBeGreaterThanOrEqual(49);
    expect(narrowGeometry.documentWidth).toBeLessThanOrEqual(narrowGeometry.viewportWidth);

    // Acknowledgement empties the current game's delivery queue, but the
    // durable private profile still restores both the source-linked personal
    // award and the separately projected community milestone.
    await page.reload();
    await expect(page.locator(".zilch-final-awards .zilch-final-award")).toHaveCount(2);
    await expect(page.locator(".zilch-final-awards")).toContainText(/Erster Wurf|First Roll/);
    await expect(page.locator(".zilch-final-awards")).toContainText(/Die ersten Hundert|The First Hundred/);
    await expect(page.locator(".zilch-final-awards")).not.toContainText(/Erste sichere Runde|First Safe Round/);
    await expect(page.locator(".zilch-final-awards")).not.toContainText(/Das Wirtshaus füllt sich|The House Is Filling Up/);
    await expect(page.locator("#appDialogBackdrop")).toBeHidden();
    expect(acknowledgements).toEqual(["zilch.first_game", "zilch.community_games_100"]);

    // A recipient who did not play the milestone's trigger game gets no
    // presentation game id. The award remains private and appears only in
    // the ordinary account-level pending flow, alongside other older awards.
    await page.goto("/zilch");
    await expect(page.locator("#appDialog")).toContainText(/Erste sichere Runde|First Safe Round/);
    await page.getByRole("button", { name: /Weiter|Continue/ }).click();
    await expect(page.locator("#appDialog")).toContainText(/Das Wirtshaus füllt sich|The House Is Filling Up/);
    await page.getByRole("button", { name: /Weiter|Continue/ }).click();
    await expect.poll(() => acknowledgements).toEqual([
      "zilch.first_game",
      "zilch.community_games_100",
      "zilch.banked_round_500",
      "zilch.community_games_500",
    ]);
  } finally {
    await context.close();
  }
});

test("a server-driven solo snapshot keeps the score sheet focused and offers abandon from the compact header", async ({ browser, baseURL }) => {
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
    await expect(page.locator("#zilchChatForm")).toHaveCount(1);
    await expect(page.locator(".zilch-score-notebook")).toContainText(/10(?:'|,|’|\s)000/);
    await expect(page.locator(".zilch-solo-metrics")).toHaveCount(0);
    await expect(page.locator("[data-zilch-abandon-solo-header]")).toBeEnabled();

    await page.evaluate(() => {
      window.ZDWA_UI = { ...(window.ZDWA_UI || {}), confirm: () => Promise.resolve(true) };
    });
    await page.locator("[data-zilch-abandon-solo-header]").click();
    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "zilch_abandon_solo", turn_id: 41, version: 7, confirmed: true }),
    ]));
  } finally {
    await context.close();
  }
});

test("equal-score recommendations stay distinct and game hotkeys respect interaction guards", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const gameId = "recommendation-hotkeys-fixture";
    await installGameScreenFixture(page, gameId, { initial: equalScoreRecommendationSnapshot() });
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    const recommendations = page.locator("[data-zilch-recommendation]");
    await expect(recommendations).toHaveCount(5);
    expect(await recommendations.evaluateAll(nodes => nodes.map(node => node.dataset.zilchShortcut))).toEqual([
      "q", "w", "e", "r", "t",
    ]);
    expect(await recommendations.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-keyshortcuts")))).toEqual([
      "q", "w", "e", "r", "t",
    ]);
    expect(await page.locator(".zilch-recommendation__shortcut").allTextContents()).toEqual([
      "Q", "W", "E", "R", "T",
    ]);

    await page.setViewportSize({ width: 390, height: 827 });
    const mobileRecommendationLayout = await page.evaluate(() => {
      const rail = document.querySelector(".zilch-recommendations").getBoundingClientRect();
      const cards = [...document.querySelectorAll("[data-zilch-recommendation]")].map(card => {
        const box = card.getBoundingClientRect();
        return {
          shortcut: card.dataset.zilchShortcut,
          top: box.top,
          bottom: box.bottom,
        };
      });
      const best = cards.find(card => card.shortcut === "q");
      const firstCard = document.querySelector("[data-zilch-recommendation]");
      const turnScore = document.querySelector(".zilch-turn-score").getBoundingClientRect();
      const notebook = document.querySelector(".zilch-play-layout__notebook").getBoundingClientRect();
      const diceDock = document.querySelector(".zilch-dice-dock").getBoundingClientRect();
      return {
        topToBottom: cards.sort((first, second) => first.top - second.top).map(card => card.shortcut),
        bestBottom: best.bottom,
        railBottom: rail.bottom,
        turnScoreTop: turnScore.top,
        turnScoreBottom: turnScore.bottom,
        notebookHeight: notebook.height,
        notebookBottom: notebook.bottom,
        diceDockTop: diceDock.top,
        scoreFontSize: Number.parseFloat(getComputedStyle(firstCard.querySelector("strong")).fontSize),
        labelFontSize: Number.parseFloat(getComputedStyle(firstCard.querySelector("span")).fontSize),
      };
    });
    expect(mobileRecommendationLayout.topToBottom).toEqual(["t", "r", "e", "w", "q"]);
    // Recommendations fill the extended score-sheet edge. The running total
    // gets its own immediately following tile, before the dice dock.
    expect(Math.abs(mobileRecommendationLayout.railBottom - mobileRecommendationLayout.notebookBottom)).toBeLessThanOrEqual(2);
    expect(mobileRecommendationLayout.turnScoreTop - mobileRecommendationLayout.railBottom).toBeGreaterThanOrEqual(0);
    expect(mobileRecommendationLayout.turnScoreTop - mobileRecommendationLayout.railBottom).toBeLessThanOrEqual(12);
    expect(mobileRecommendationLayout.diceDockTop - mobileRecommendationLayout.turnScoreBottom).toBeGreaterThanOrEqual(6);
    expect(mobileRecommendationLayout.scoreFontSize).toBeGreaterThanOrEqual(17);
    expect(mobileRecommendationLayout.labelFontSize).toBeGreaterThanOrEqual(12);

    const compactRecommendationLayout = await page.evaluate(() => {
      const rail = document.querySelector(".zilch-recommendations");
      rail.style.height = "8rem";
      const railBox = rail.getBoundingClientRect();
      const bestBox = document.querySelector('[data-zilch-shortcut="q"]').getBoundingClientRect();
      const turnScoreBox = document.querySelector(".zilch-turn-score").getBoundingClientRect();
      return {
        overflows: rail.scrollHeight > rail.clientHeight,
        bestBottom: bestBox.bottom,
        railBottom: railBox.bottom,
        turnScoreTop: turnScoreBox.top,
        turnScoreBottom: turnScoreBox.bottom,
      };
    });
    expect(compactRecommendationLayout.overflows).toBe(true);
    expect(compactRecommendationLayout.turnScoreTop - compactRecommendationLayout.bestBottom).toBeGreaterThanOrEqual(0);
    expect(compactRecommendationLayout.turnScoreTop - compactRecommendationLayout.railBottom).toBeGreaterThanOrEqual(0);
    await page.locator(".zilch-recommendations").evaluate(rail => rail.style.removeProperty("height"));

    // Once the running-total tile disappears, the paper must retain the same
    // footprint rather than snapping back to the older, shorter board.
    const noTurnScoreLayout = await page.evaluate(() => {
      document.querySelector(".zilch-play-layout--has-turn-score")?.classList.remove("zilch-play-layout--has-turn-score");
      document.querySelector(".zilch-play-layout__turn-score")?.remove();
      const notebook = document.querySelector(".zilch-play-layout__notebook").getBoundingClientRect();
      const rail = document.querySelector(".zilch-recommendations").getBoundingClientRect();
      return { notebookHeight: notebook.height, notebookBottom: notebook.bottom, railBottom: rail.bottom };
    });
    expect(Math.abs(noTurnScoreLayout.notebookHeight - mobileRecommendationLayout.notebookHeight)).toBeLessThanOrEqual(2);
    expect(Math.abs(noTurnScoreLayout.railBottom - noTurnScoreLayout.notebookBottom)).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 1280, height: 720 });
    expect(await recommendations.evaluateAll(nodes => nodes
      .map(node => ({ shortcut: node.dataset.zilchShortcut, top: node.getBoundingClientRect().top }))
      .sort((first, second) => first.top - second.top)
      .map(item => item.shortcut))).toEqual(["q", "w", "e", "r", "t"]);

    const twoFives = page.locator('[data-zilch-recommendation="fixture-two-fives"]');
    const singleOne = page.locator('[data-zilch-recommendation="fixture-single-one"]');
    await expect(twoFives).toHaveAttribute("aria-label", /\+100.*5 \+ 5/);
    await expect(singleOne).toHaveAttribute("aria-label", /\+100.*1/);
    await expect(twoFives).toContainText("5 + 5");
    await expect(singleOne).toContainText(/(?:^|\D)1(?:\D|$)/);
    expect(await twoFives.getAttribute("aria-label")).not.toBe(await singleOne.getAttribute("aria-label"));

    const dispatchKey = (key, options = {}) => page.evaluate(({ pressed, init }) => {
      const event = new KeyboardEvent("keydown", {
        key: pressed,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    }, { pressed: key, init: options });
    expect(await dispatchKey("B")).toBe(false);
    expect(await dispatchKey("r", { ctrlKey: true })).toBe(false);
    expect(await page.evaluate(() => {
      const input = document.getElementById("zilchChatInput");
      const event = new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(false);
    expect(await page.evaluate(() => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.textContent = "Fixture dialog";
      document.body.append(dialog);
      const event = new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      dialog.remove();
      return event.defaultPrevented;
    })).toBe(false);
    await expect(page.locator(".zilch-die--selected")).toHaveCount(0);

    expect(await dispatchKey("r")).toBe(true);
    await expect(singleOne).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-zilch-die-index="5"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-zilch-chat-toggle]").click();
    await expect(page.locator("#zilchChatInput")).toBeVisible();
    await page.locator("#zilchChatInput").focus();
    const messagesBeforeInputShortcuts = await page.evaluate(() => window.__zilchGameScreenFixtureMessages.length);
    for (const key of [" ", "B", "6"]) {
      expect(await dispatchKey(key)).toBe(false);
    }
    await expect(page.locator('[data-zilch-die-index="5"]')).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.__zilchGameScreenFixtureMessages.length)).toBe(messagesBeforeInputShortcuts);
    await page.locator("#zilchChatInput").blur();
    expect(await dispatchKey("6")).toBe(true);
    await expect(page.locator(".zilch-die--selected")).toHaveCount(0);
    expect(await dispatchKey("1")).toBe(false);

    expect(await dispatchKey("r")).toBe(true);
    expect(await dispatchKey("B", { shiftKey: true })).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "zilch_bank_points",
        turn_id: 27,
        version: 9,
        roll_id: 22,
        option_id: "fixture-single-one",
        dice_indices: [5],
        points: 100,
        combination_type: "single_one",
      }),
    ]));
  } finally {
    await context.close();
  }
});

test("Space uses the enabled start roll first and otherwise the current roll action", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const startPage = await context.newPage();
  try {
    await signInAsPreviewMani(startPage);
    const lobbyResponse = await startPage.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const startGameId = "start-roll-space-fixture";
    await installGameScreenFixture(startPage, startGameId, { initial: openingRollShortcutSnapshot() });
    await startPage.route(`**/zilch/spiel/${startGameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await startPage.goto(`/zilch/spiel/${startGameId}`);
    await expect(startPage.locator("[data-zilch-start-roll]")).toBeEnabled();
    await expect(startPage.locator("[data-zilch-roll]")).toBeEnabled();

    await test.step("the mobile opening roll uses the unused rail and clears rounded chat corners", async () => {
      await startPage.setViewportSize({ width: 390, height: 844 });
      await expect(startPage.locator(".zilch-start-roll-rail")).toBeVisible();
      await expect(startPage.locator(".emoji-fab")).toBeVisible();
      const geometry = await startPage.evaluate(() => {
        const box = selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        return {
          notebook: box(".zilch-play-layout__notebook"),
          openingRoll: box(".zilch-start-roll-rail"),
          chatToggle: box("[data-zilch-chat-toggle]"),
          reaction: box(".emoji-fab"),
          bodyUsesOnlyScrollAttachments: getComputedStyle(document.body).backgroundAttachment
            .split(",")
            .every(value => value.trim() === "scroll"),
          viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "",
        };
      });
      expect(geometry.openingRoll.left, "opening roll is in the right rail").toBeGreaterThanOrEqual(geometry.notebook.right - 1);
      expect(Math.abs(geometry.openingRoll.top - geometry.notebook.top), "opening roll begins beside the notebook").toBeLessThanOrEqual(1);
      expect(geometry.chatToggle.left, "the complete Chat hit target clears the left corner").toBeGreaterThanOrEqual(15);
      expect(geometry.reaction.right, "the reaction hit target clears the right corner").toBeLessThanOrEqual(375);
      expect(geometry.reaction.width).toBeGreaterThanOrEqual(33);
      expect(geometry.reaction.height).toBeGreaterThanOrEqual(33);
      expect(geometry.bodyUsesOnlyScrollAttachments, "the PWA does not use a blurry fixed wood bitmap").toBe(true);
      expect(geometry.viewport).toContain("viewport-fit=cover");
    });

    await startPage.evaluate(() => {
      const dialog = document.createElement("div");
      dialog.id = "space-fixture-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.textContent = "Fixture dialog";
      document.body.append(dialog);
    });
    await startPage.keyboard.press("Space");
    expect(await startPage.evaluate(() => window.__zilchGameScreenFixtureMessages.some(message => (
      message.action === "zilch_start_roll" || message.action === "zilch_roll_dice"
    )))).toBe(false);
    await startPage.locator("#space-fixture-dialog").evaluate(node => node.remove());

    await startPage.keyboard.press("Space");
    await expect.poll(() => startPage.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "zilch_start_roll", start_roll_version: 3 }),
    ]));
    expect(await startPage.evaluate(() => window.__zilchGameScreenFixtureMessages.some(message => message.action === "zilch_roll_dice"))).toBe(false);

    const rollPage = await context.newPage();
    const rollGameId = "current-roll-space-fixture";
    await installGameScreenFixture(
      rollPage,
      rollGameId,
      { initial: soloTurnSnapshot() },
      {
        mode: "1",
        play_mode: "solo",
        participants: [{ id: "p1", type: "human", user_id: 2, connection_player_id: "p1" }],
      },
    );
    await rollPage.route(`**/zilch/spiel/${rollGameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await rollPage.goto(`/zilch/spiel/${rollGameId}`);
    await expect(rollPage.locator("[data-zilch-start-roll]")).toHaveCount(0);
    await expect(rollPage.locator("[data-zilch-roll]")).toBeEnabled();

    await rollPage.keyboard.press("Space");
    await expect.poll(() => rollPage.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "zilch_roll_dice", turn_id: 41, version: 7 }),
    ]));
  } finally {
    await context.close();
  }
});

test("a Hot Dice choice stays optional until Weiterwürfeln commits it atomically", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();
    const gameId = "hot-dice-direct-fixture";
    const snapshot = hotDiceChoiceSnapshot();
    await installGameScreenFixture(page, gameId, { initial: snapshot, heldForConfirmation: snapshot });
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    const hotDice = page.locator("[data-zilch-recommendation='fixture-hot-straight']");
    await expect(hotDice).toContainText("Hot Dice");
    await page.locator("[data-zilch-die-index='0']").click();
    await expect(hotDice).toBeEnabled();
    await hotDice.click();
    await expect(page.locator(".zilch-die--selected")).toHaveCount(6);
    expect(await page.evaluate(() => window.__zilchGameScreenFixtureMessages.some(message => message.action === "zilch_select_hold"))).toBe(false);

    // Removing one die from a straight also removes the now invalid dependent
    // draft; the committed state still remains untouched.
    await page.locator("[data-zilch-die-index='0']").click();
    await expect(page.locator(".zilch-die--selected")).toHaveCount(0);
    await hotDice.click();
    await page.locator("[data-zilch-roll]").click();
    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "zilch_roll_dice",
        turn_id: 17,
        version: 8,
        roll_id: 12,
        option_id: "fixture-hot-straight",
        dice_indices: [0, 1, 2, 3, 4, 5],
        points: 2000,
      }),
    ]));
  } finally {
    await context.close();
  }
});

test("a selected score is banked atomically with its exact server option", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await signInAsPreviewMani(page);
    const lobbyResponse = await page.goto("/zilch");
    expect(lobbyResponse?.status()).toBe(200);
    const shellHtml = await lobbyResponse.text();

    const bankable = JSON.parse(JSON.stringify(fixtureSnapshots().holdOptions));
    bankable._zilch_turn_state.confirmation_required = false;
    bankable._zilch_turn_state.confirmation_reasons = [];
    bankable._zilch_quick_holds = bankable._zilch_quick_holds.map(option => (
      option.id === "fixture-single-five"
        ? { ...option, follow_up_actions: ["zilch_roll_dice", "zilch_bank_points"] }
        : option
    ));

    const gameId = "atomic-bank-fixture";
    await installGameScreenFixture(page, gameId, { initial: bankable });
    await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: shellHtml,
    }));
    await page.goto(`/zilch/spiel/${gameId}`);

    const option = page.locator('[data-zilch-recommendation="fixture-single-five"]');
    await expect(option).toBeEnabled();
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-zilch-bank]")).toBeEnabled();
    await page.locator("[data-zilch-bank]").click();

    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "zilch_bank_points",
        turn_id: 11,
        version: 5,
        roll_id: 8,
        option_id: "fixture-single-five",
        dice_indices: [3],
        points: 50,
        combination_type: "single_five",
      }),
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
    await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-active/);
    await expect(page.locator(".zilch-score-notebook")).not.toContainText(/Gegenzug offen|Reply pending|Schlussrunde ausgelöst|Final round triggered/);
    await expect(page.locator(".zilch-header [data-zilch-logout]")).toHaveCount(0);
    await expect(page.locator("#zilchAccountLogout")).toHaveCount(0);
    await expect(page.locator("#zilchRoomLobby")).toBeVisible();
    await expect(page.locator("#zilchRoomLobby")).toHaveAttribute("href", "/zilch");
    await expect(page.locator("#zilchRoomLobby .zilch-control-label")).toHaveText(/Lobby/i);
    await expect(page.locator("#zilchRoomRules")).toBeVisible();
    await expect(page.locator("#zilchRoomRules .zilch-control-label")).toHaveText(/Regeln|Rules/i);
    await expect(page.locator(".zilch-header-tools [data-game-switch]")).toBeVisible();
    await expect(page.locator(".zilch-header-tools [data-game-switch]")).toContainText("ZDWA");

    const dice = page.locator(".zilch-die");
    await expect(dice).toHaveCount(6);
    await expect(dice.first()).toHaveAttribute("role", "img");
    await expect(dice.first()).toHaveAttribute("aria-label", /(?:Würfel 1: Noch nicht gewürfelt|Die 1: Not rolled yet)/);
    expect(await dice.evaluateAll(nodes => nodes.every(node => !node.hasAttribute("tabindex")))).toBe(true);
    await expect(page.locator(".zilch-event")).toHaveCount(0);
    await expect(page.locator("[data-zilch-event-overlay]")).toBeHidden();
    await expect(page.locator("#zilchLiveStatus")).toContainText("Hot Dice");
    await expect(page.locator("[data-zilch-roll]")).toContainText(/Bestätigen|confirm/i);
    await expect(page.locator("[data-zilch-bank]")).toBeDisabled();
    // A confirmed Hot-Dice hold has no new selectable score option yet, but
    // the running total remains visible in the reserved right rail.
    await expect(page.locator(".zilch-play-layout")).toHaveClass(/zilch-play-layout--has-choices/);
    await expect(page.locator(".zilch-recommendations")).toHaveCount(1);
    await expect(page.locator("[data-zilch-recommendation]")).toHaveCount(0);
    await expect(page.locator(".zilch-turn-score")).toContainText(/2(?:'|,|’|\s)000/);
    const initialNotebookWidths = new Map();
    // Even before the first recommendation exists, the score sheet keeps the
    // left-hand playing zone and leaves the right thumb rail ready. This avoids
    // a full-width-to-split layout jump as soon as the first roll arrives.
    for (const viewport of [
      { name: "narrow-phone", width: 320, height: 800 },
      { name: "phone", width: 390, height: 827 },
      { name: "desktop", width: 1280, height: 900 },
    ]) {
      await test.step(`initial room reserves its recommendation rail on ${viewport.name}`, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const geometry = await page.evaluate(() => new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const layout = document.querySelector(".zilch-play-layout");
            const notebook = document.querySelector(".zilch-play-layout__notebook");
            const layoutBox = layout.getBoundingClientRect();
            const notebookBox = notebook.getBoundingClientRect();
            const tracks = getComputedStyle(layout).gridTemplateColumns
              .split(/\s+/)
              .map(value => Number.parseFloat(value))
              .filter(Number.isFinite);
            resolve({
              layoutLeft: layoutBox.left,
              layoutRight: layoutBox.right,
              layoutWidth: layoutBox.width,
              notebookLeft: notebookBox.left,
              notebookRight: notebookBox.right,
              notebookWidth: notebookBox.width,
              tracks,
            });
          }));
        }));
        const notebookShare = geometry.notebookWidth / geometry.layoutWidth;
        const reservedShare = (geometry.layoutRight - geometry.notebookRight) / geometry.layoutWidth;
        initialNotebookWidths.set(viewport.name, geometry.notebookWidth);
        expect(Math.abs(geometry.notebookLeft - geometry.layoutLeft), `${viewport.name}: notebook starts on the left`).toBeLessThanOrEqual(2);
        expect(notebookShare, `${viewport.name}: notebook is roughly the left half`).toBeGreaterThanOrEqual(0.4);
        expect(notebookShare, `${viewport.name}: notebook does not consume the recommendation rail`).toBeLessThanOrEqual(0.65);
        expect(reservedShare, `${viewport.name}: right recommendation rail remains available`).toBeGreaterThanOrEqual(0.3);
        expect(geometry.tracks, `${viewport.name}: initial layout retains two grid tracks`).toHaveLength(2);
        expect(geometry.tracks[1] / geometry.layoutWidth, `${viewport.name}: second grid track remains useful`).toBeGreaterThanOrEqual(0.3);
      });
    }

    // Reactions follow ZDWA's social path: the server echoes them to the
    // sender and a transient bubble appears without adding a chat line.
    await expect(page.locator(".emoji-fab")).toBeVisible();
    await page.locator(".emoji-fab").click();
    await page.locator(".emoji-btn").first().click();
    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "send_emoji", emoji: "👍" }),
    ]));
    await expect(page.locator(".emoji-pop")).toContainText("Mani");
    await expect(page.locator("#zilchChatHistory")).not.toContainText("👍");

    await page.locator("[data-zilch-roll]").click();
    await expect(page.locator(".zilch-die")).toHaveCount(6);
    await expect(page.locator(".zilch-die").nth(0)).toHaveAttribute("aria-label", /(?:Würfel 1: zeigt 1|Die 1: shows 1)/);
    await expect(page.locator(".zilch-die--non-scoring")).toHaveCount(2);
    await expect(page.locator("[data-zilch-roll]")).toContainText(/Weiterwürfeln|roll again/i);

    for (const viewport of [
      { name: "narrow-phone", width: 320, height: 800, minimumDie: 50 },
      { name: "phone", width: 390, height: 827, minimumDie: 62 },
      { name: "desktop", width: 1280, height: 900, minimumDie: 63 },
    ]) {
      await test.step(`first scoring roll preserves notebook geometry on ${viewport.name}`, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const geometry = await page.evaluate(() => new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const notebook = document.querySelector(".zilch-play-layout__notebook").getBoundingClientRect();
            const choices = document.querySelector(".zilch-recommendations").getBoundingClientRect();
            const die = document.querySelector(".zilch-die").getBoundingClientRect();
            resolve({
              notebookWidth: notebook.width,
              notebookX: notebook.x,
              choicesX: choices.x,
              dieWidth: die.width,
              dieHeight: die.height,
              documentWidth: document.documentElement.scrollWidth,
              viewportWidth: window.innerWidth,
            });
          }));
        }));
        expect(
          Math.abs(geometry.notebookWidth - initialNotebookWidths.get(viewport.name)),
          `${viewport.name}: score sheet does not resize after the first roll`,
        ).toBeLessThanOrEqual(1);
        expect(geometry.choicesX, `${viewport.name}: choices remain to the right`).toBeGreaterThan(geometry.notebookX);
        expect(Math.abs(geometry.dieWidth - geometry.dieHeight), `${viewport.name}: die stays square`).toBeLessThanOrEqual(1);
        expect(geometry.dieWidth, `${viewport.name}: dice remain comfortably tappable`).toBeGreaterThanOrEqual(viewport.minimumDie);
        expect(geometry.documentWidth, `${viewport.name}: no horizontal overflow`).toBeLessThanOrEqual(geometry.viewportWidth);
      });
    }

    // The active room is deliberately mobile-first: at a regular phone
    // width the shared score sheet stays on the left and the actionable
    // score choices stay in the right thumb zone, without horizontal scroll.
    await page.setViewportSize({ width: 390, height: 827 });
    const [notebookBox, choicesBox, pageWidths, headerGeometry] = await Promise.all([
      page.locator(".zilch-play-layout__notebook").boundingBox(),
      page.locator(".zilch-recommendations").boundingBox(),
      page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      })),
      page.evaluate(() => {
        const header = document.querySelector(".zilch-header").getBoundingClientRect();
        const context = document.querySelector("#zilchRoomContext").getBoundingClientRect();
        const controls = [...document.querySelectorAll(".zilch-header-tools > *")]
          .filter(element => element.getClientRects().length && !element.matches("[data-game-switch]"))
          .map(element => element.getBoundingClientRect().height);
        const gameSwitchHeight = document.querySelector(".zilch-header-tools [data-game-switch]")
          ?.getBoundingClientRect().height || 0;
        return {
          headerHeight: header.height,
          contextCenter: context.top + context.height / 2,
          headerCenter: header.top + header.height / 2,
          controlHeights: controls,
          gameSwitchHeight,
        };
      }),
    ]);
    expect(notebookBox).not.toBeNull();
    expect(choicesBox).not.toBeNull();
    expect(notebookBox.x).toBeLessThan(choicesBox.x);
    expect(Math.abs(notebookBox.y - choicesBox.y)).toBeLessThanOrEqual(1);
    expect(pageWidths.scroll).toBeLessThanOrEqual(pageWidths.client);
    expect(pageWidths.scrollHeight).toBeLessThanOrEqual(pageWidths.viewportHeight);
    expect(headerGeometry.headerHeight).toBeLessThanOrEqual(56);
    expect(Math.abs(headerGeometry.contextCenter - headerGeometry.headerCenter)).toBeLessThanOrEqual(3);
    expect(headerGeometry.controlHeights.length).toBeGreaterThanOrEqual(2);
    expect(headerGeometry.controlHeights.every(height => Math.abs(height - headerGeometry.controlHeights[0]) <= 1)).toBe(true);
    expect(headerGeometry.gameSwitchHeight).toBeGreaterThanOrEqual(headerGeometry.controlHeights[0]);

    const scoringDice = page.locator("[data-zilch-die-index]");
    await expect(scoringDice).toHaveCount(4);
    await scoringDice.nth(0).click();
    await scoringDice.nth(1).click();
    await scoringDice.nth(2).click();
    const selectedScore = page.locator("[data-zilch-recommendation='fixture-three-ones']");
    await expect(selectedScore).toContainText(/1(?:'|,|’|\s)000/);
    await expect(selectedScore).toBeEnabled();
    await expect(selectedScore).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".zilch-die--selected")).toHaveCount(3);
    await expect(page.locator("[data-zilch-bank]")).toBeDisabled();

    await page.locator("[data-zilch-roll]").click();
    await expect.poll(() => page.evaluate(() => window.__zilchGameScreenFixtureMessages)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "zilch_roll_dice",
        turn_id: 11,
        version: 5,
        roll_id: 8,
        option_id: "fixture-three-ones",
        dice_indices: [0, 1, 2],
        points: 1000,
      }),
    ]));

    await expect(page.locator(".zilch-event")).toHaveCount(0);
    await expect(page.locator("#zilchLiveStatus")).toContainText(/Zilch-Serie|Zilch streak/);
    const zilchOverlay = page.locator("[data-zilch-event-overlay]");
    await expect(zilchOverlay).toBeVisible();
    await expect(zilchOverlay).toContainText("ZILCH!");
    await expect(zilchOverlay).toContainText("−500");
    await expect(page.locator("#zilchRoomContext")).toContainText("ZILCH!");
    await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-zilch-board-id="p2"]')).toHaveClass(/is-inactive/);
    await expect(page.locator('[data-zilch-board-id="p1"] .zilch-notebook-entry__divider')).toHaveCount(1);
    await expect(page.locator('[data-zilch-board-id="p1"]')).toContainText(/7(?:'|,|’|\s)900.*Zilch|Zilch.*7(?:'|,|’|\s)900/);
    const overlayGeometry = await page.evaluate(() => {
      const overlay = document.querySelector("[data-zilch-event-overlay]").getBoundingClientRect();
      const notebook = document.querySelector(".zilch-play-layout__notebook").getBoundingClientRect();
      return {
        overlay: { left: overlay.left, top: overlay.top, right: overlay.right, bottom: overlay.bottom },
        notebook: { left: notebook.left, top: notebook.top, right: notebook.right, bottom: notebook.bottom },
      };
    });
    expect(Math.abs(overlayGeometry.overlay.left - overlayGeometry.notebook.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayGeometry.overlay.top - overlayGeometry.notebook.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayGeometry.overlay.right - overlayGeometry.notebook.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayGeometry.overlay.bottom - overlayGeometry.notebook.bottom)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-zilch-board-id="p1"]')).toContainText(/(?:Zilch.*500|500.*Zilch|−500)/);
    await expect(zilchOverlay).toBeHidden({ timeout: 2_500 });
    await expect(page.locator('[data-zilch-board-id="p2"]')).toHaveClass(/is-active/);
    await expect(page.locator("#zilchRoomContext")).toContainText(/PreviewFriend|Am Zug|turn/i);
    await expect(page.locator(".zilch-die")).toHaveCount(6);
  } finally {
    await context.close();
  }
});
